// hk-sky.js - a live sky behind the weather view.
//
// WHAT IT DOES
// Replaces the flat wallpaper on the weather page with a sky that tracks the
// real one: gradient driven by sun elevation, sun glow placed by azimuth, the
// moon drawn at its actual phase, cloud decks whose density comes from
// cloud_coverage, and rain or snow when it is actually falling.
//
// WHY NOT APPLE'S OWN ART
// There is none to take. Apple's WeatherUI ships 263 individual cloud SPRITES
// (a single Cumulus puff is 613x217) plus four proprietary "aegir" .art scene
// files and two .metallib shader libraries -- the sky is COMPUTED at runtime,
// not stored. Nothing in that bundle is a background image. So this computes
// one too, from noise textures generated locally into frontend/sky/ (generator:
// tools/sky/gen_sky.py, pure Python, no PIL). ~866 KB for the set. No
// downloads, no license question, and the textures tile and recolor -- which
// a stock sky photograph cannot do.
//
// WHERE IT ATTACHES -- AND WHY THAT EXACT SPOT
// hui-root renders <hui-view-container id="view"><hui-view-background>, and
// hui-view-background is the element that paints a view's `background:` key:
//
//     :host([fixed-background]) { position: fixed; z-index: -1 }
//     :host { inset: 0; background: var(--view-background) }
//
// So the wallpaper is already a fixed, z-index:-1 layer. We insert ourselves
// as its NEXT SIBLING with the same position and z-index: equal z-index means
// paint order is document order, so we land ABOVE the wallpaper and BELOW
// every card (in-flow content paints above negative z-index). No !important,
// nothing overriding frontend styles, nothing to re-fix when hui-root changes
// -- and if this module fails to load, the wallpaper is simply still there.
//
// THE LUMINANCE CAP IS THE POINT
// The whole glass palette is tuned against a dark ground: the flat wallpaper
// this replaces measures 162/255 and sits under a scrim that brings it to ~61.
// Matching the Home app's Energy backdrop exactly would mean ~116, and lighter
// scrims than ~61 read too bright on a wall tablet. A bright blue noon sky
// throws all of that away and leaves rgba(255,255,255,0.12) plates invisible.
//
// So every sky is composited to an estimated mean luminance and scrimmed down
// to CAP. The palette below is authored deep for the same reason. CAP is the
// one knob worth touching:
//
//     61   the wallpaper this replaces
//     72   a deeper daytime blue
//     86   here
//    116   the Home app's own backdrop; too bright
//
// Past ~85 it starts costing glass-plate contrast.
//
// PERFORMANCE NOTES, because these run on wall tablets
//  - Every animation is a transform. Nothing animates background-position or
//    mask-position: those repaint the whole layer every frame, and the rain
//    runs at ~8 cycles a second.
//  - Each drifting layer overhangs on ONE side only, by exactly the distance
//    it travels, so the composited texture stays near viewport size instead of
//    three times it.
//  - Layers are only present when they have something to draw; stars do not
//    animate at all, because drift is imperceptible on a star field and it is
//    the one layer that would have to overhang a full tile to loop.
//  - Animations pause on visibilitychange. A wall tablet spends most of its
//    life behind the Fully screensaver, and a running compositor there is the
//    difference between an idle tablet and one warm to the touch all night.
(function () {
  'use strict';

  // Loaded from hk-loader.js on every page; hkReload() and a dev probe can
  // evaluate it again, so running twice has to be harmless: a second copy would own a SECOND
  // `mounted` variable, and the first copy's element would be orphaned on the
  // page with nothing left holding a reference to tear it down.
  if (window.hkSky) return;
  // the host's page (hk-host-shell.js): the view container the sky lives in,
  // the dashboard's config, navigation
  var SH = window.hkShell;

  var CAP = 86;              // mean luminance ceiling, 0-255. See above.

  // IDLE DECKS. The kill switch for the whole optimization below: set to
  // false and every deck animates all the time, visible or not.
  //
  // The weather decks (.rain, .snow x2) and the cloud decks carry
  // `will-change:transform` UNCONDITIONALLY, so each one holds a composited
  // GPU layer LARGER THAN THE VIEWPORT (~1920x1720 for a rain deck, by the
  // arithmetic in the .rain/.snow note) and runs an infinite hk-fall/hk-drift
  // animation -- on a clear day, at opacity 0, for weather that is not
  // happening. That is the same waste the `.static` rule below already names:
  // "opacity:0 still composites every frame, which on a wall tablet is the
  // whole cost with none of the picture." `.bolt` is likewise already gated
  // with display:none. This extends the SAME idea to a LIVE sky in clear
  // weather, which is most of the time.
  //
  // A CLASS, never an inline style. `#hk-sky.static .cl` and friends carry no
  // !important, so an inline `animation:` would beat them and silently kill
  // the static-page optimization. The .idle rule is a class deeper than the
  // base rule, so specificity settles it and source order cannot bite.
  //
  // NO TIMER, deliberately. A deck stops mid-fall and then fades out over its
  // 3-4s opacity transition, i.e. rain hangs frozen in the air while it
  // disappears. That is accepted: it is what keeps this free of teardown
  // races (see watch()). Coming back is
  // seamless for a different reason: the class is dropped in the same paint()
  // where opacity is still 0, so the loop restarts at its origin unseen.
  var IDLE_INVISIBLE = true;
  var IDLE_BELOW = 0.04;           // decks under this opacity count as invisible
  var BASE = '/hk/sky/';
  // NO VERSION TO BUMP. /hk/ is served by custom_components/hk_frontend with
  // Cache-Control: no-cache: the browser revalidates each texture and gets a 304
  // unless gen_sky.py actually rewrote it. Regenerate and refresh; that is all.
  // (Under /local/, with its 31-day cache header, a regenerated texture at the
  // same URL never reaches a browser that already fetched the old one.)
  var VER = '';

  // Measured mean alpha of each generated texture, printed by the generator.
  // These feed the luminance estimate below -- guessing at cloud cover is what
  // would let a midday sky drift over CAP without anything noticing.
  // Re-measure whenever the textures change; the generator prints these.
  // (The WebP masks are a bit-exact re-encode of these same pixels --
  // cloud_webp.py -- so the values hold for the .webp the decks load.)
  var CLOUD_ALPHA = { a: 0.200, b: 0.124, c: 0.130 };

  // ------------------------------------------------------------- seasons
  // Seasonal decoration, driven by the holiday season (hkSettings.seasonName:
  // the sensor chosen in Configure, or computed) and gated by the seasonal
  // switch chosen there. See docs/Seasonal-Decorations.md.
  //
  // EVERYTHING HERE IS A PHOTOGRAPH, and that is not an accident: drawn
  // versions -- a leaf silhouette, a bat, a tree, string lights -- do not
  // survive being looked at on a tablet. If something is added here later,
  // start from a picture.
  //
  // Measured with the same method as CLOUD_ALPHA above -- mean alpha over the
  // whole texture, mean luma over its ink -- because the scrim arithmetic is
  // only honest if these are measured rather than guessed.
  var SEASON = {
    leafA: 0.250, leafL: 123,      // mean of the six leaf faces (3 species x 2)
    branchA: 0.214, branchL: 18,   // full-frame BARE branch art (spooky only)
    canopyA: 0.084, canopyL: 99,   // the leafy autumn canopy (ordinary fall)
    moonA:  0.569, moonL: 177,     // the photographic moon, halo included
    fogA:   0.327, fogL: 161,      // one drifting mist texture
    webA:   0.019, webL: 167,      // the cobweb; almost entirely clear
    decorA: 0.105, decorL: 64,     // the one fixed Christmas decoration master
    xglowA: 0.095, xglowL: 190,    // a bulb halo BEFORE the feather mask
    snowA:  0.112, snowL: 184,     // mean of the three flake sprites
    sleighA: 0.180                 // forced to brightness(0), so luma 0
  };
  // Measured from the ENCODED .webp, not the PNG sources, with `dwebp -pam`
  // parsed in plain Python -- the cap arithmetic should describe what the page
  // actually loads. Conversion moved every figure by under 0.3 luma.
  //
  // Bats and the witch are left out of the estimate deliberately: each covers
  // well under half a percent of the frame (the witch also only 9% of the
  // time), which is below the rounding on CAP.
  //
  // WHY THE BRIGHT ONES ARE SAFE. moon, fog and web are all gated behind
  // `spooky`, which is night-only, and the night sky base is ~16 against a
  // CAP of 86. Composited in order these land at L ~= 28, so no scrim fires
  // at all. The branches actively DARKEN (luma 18 over 0.214 of the frame).

  // Three species, each a FRONT and a BACK face. The back is the real
  // underside -- paler, veined -- not the front mirrored, which is what a
  // single sprite on a rotateY gives you, and which never looks like a leaf
  // turning over.
  var LEAF_SPECIES = [
    [BASE + 'leaf-maple-f.webp', BASE + 'leaf-maple-b.webp'],
    [BASE + 'leaf-oak-f.webp',   BASE + 'leaf-oak-b.webp'],
    [BASE + 'leaf-birch-f.webp', BASE + 'leaf-birch-b.webp']
  ];
  // webp like every other sprite (the -src.png sources live in
  // tools/sky/src/).
  var BAT_FRAMES   = [BASE + 'bat1.webp', BASE + 'bat2.webp', BASE + 'bat3.webp'];
  // ONE full-viewport branch layer, not a pair hung in the corners. The art
  // reaches inward from every edge, so limbs pass BEHIND the cards instead of
  // stopping at a border -- which is the whole point of the composition.
  // Stationary by default: a sway on a full-frame bitmap repaints the entire
  // viewport every frame; a pair of corner branches only gets away with it
  // because each is under half the width.
  var BRANCH_IMG = BASE + 'branches-full.webp';
  // The leafy autumn canopy. Same full-viewport treatment as the bare
  // branches, and its OPPOSITE: one or the other, never both. Spooky nights
  // strip the leaves off the trees.
  var CANOPY_IMG = BASE + 'canopy.webp';
  var MOON_IMG   = BASE + 'moon-hallow.webp';
  var FOG_IMG    = BASE + 'fog-wisp.webp';
  var WEB_IMG    = BASE + 'web.webp';
  // The spooky moon's BOX in CSS px. The visible disc is smaller, because the
  // art carries its own halo (~315px of disc inside a 384px box), against a
  // 197px bare disc.
  var MOON_PX    = 384;
  // ...and the disc inside it: 0.85 of the box, measured on tools/sky/src/moon-hallow-src.png
  // (lit pixels span 872 of 1024 across, 860 down).
  var MOON_DISC  = 0.85;
  // The Christmas moon on the forecast screensaver: this share of MOON_PX.
  var XMAS_MOON  = 0.62;

  // THE WITCH. A solid-black silhouette with real alpha and no color to
  // correct, so she carries NO filter (no brightness(0) to blacken her).
  //   WITCH_INK    her broom tip to bristles, as a fraction of the image width
  //                (x 30..1005 of 1024); the image is 2:1.
  //   WITCH_SPAN   broom tip to bristles against the VISIBLE disc: 55-60%.
  //   WITCH_CYCLE  one flight per this many seconds of VISIBLE time. The whole
  //                sky pauses while hidden or asleep (#hk-sky.hidden), so a
  //                parked tablet never counts toward it.
  //   WITCH_FLIGHT the crossing itself, fade in to fade out.
  //   WITCH_FADE   each end of it.
  var WITCH_IMG    = BASE + 'witch-v2.webp';
  var WITCH_INK    = 975 / 1024;
  var WITCH_SPAN   = 0.575;
  var WITCH_CYCLE  = 170;
  var WITCH_FLIGHT = 13.5;
  var WITCH_FADE   = 0.9;
  //   WITCH_LINE   her flight line, from the moon's center, in discs (negative
  //                is up). NOT the center: at 1280x800 the status-chip row
  //                crosses the moon's middle, and the chips -- rightly in front
  //                of the whole sky -- would hide her body for the entire crossing.
  //                0.28 of a disc up is clear of them, and the disc is still
  //                270px wide there against her 187px.
  var WITCH_LINE   = -0.28;
  // Seconds into the witch's cycle, as a keyframe percentage.
  function pct(sec) { return (sec / WITCH_CYCLE * 100).toFixed(3); }
  // ONE fixed decoration master, full viewport: pine, ornaments, pinecones,
  // stockings, wire and steadily lit bulbs. NOT four frames.
  //
  // Separately generated "light frames" do not work: the pine edges MOVE
  // between them, because regenerating the whole frame regenerates the
  // foliage too. Four full-viewport frames would also cost ~65 MB decoded.
  // So the greenery is one stationary image and only small local halos
  // animate -- 0.4 MB decoded for the glow tile against 16 MB per extra full
  // frame, and the needles provably cannot drift.
  var XDECOR = BASE + 'xdecor.webp';
  // Every full-screen frame is painted at a wall tablet's 16:10 (2560x1600).
  var FRAME_ASPECT = 16 / 10;
  // NARROW SCREENS: each frame is drawn as its two edges, fitted to the
  // height. Each edge is NARROW_HALF of the width and solid over the outer
  // NARROW_SOLID of itself; the rest fades to nothing, so the two overlap
  // and cross-fade through the middle instead of meeting on a hard seam
  // (see .narrow in the CSS, and the bulb placement in cozyWindow).
  var NARROW_HALF = 0.66;
  var NARROW_SOLID = 0.55;
  var XGLOW  = BASE + 'xglow.webp';
  var SLEIGH = BASE + 'sleigh.webp';
  var SNOW_SPRITES = [BASE + 'xsnow1.webp', BASE + 'xsnow2.webp',
                      BASE + 'xsnow3.webp'];
  // New Decorations' woodland art (mountNearScenery): one cut-out per theme,
  // <theme>-v1.webp, plus balloons-v1.webp, from tools/sky/near_webp.py.
  var NEAR_ART = BASE + 'near/';
  // Normalized bulb-core anchors picked off the master by inspection. The
  // glow boxes are placed on these, so they must stay in step with the art --
  // a new master means new anchors.
  var BULBS = [
    [0.035, 0.036], [0.068, 0.020], [0.119, 0.008], [0.225, 0.040],
    [0.342, 0.026], [0.410, 0.043], [0.498, 0.021], [0.559, 0.039],
    [0.704, 0.056], [0.763, 0.040], [0.818, 0.008], [0.925, 0.019],
    [0.968, 0.068], [0.013, 0.206], [0.010, 0.397], [0.010, 0.575],
    [0.015, 0.955], [0.982, 0.224], [0.988, 0.611], [0.985, 0.946]
  ];

  // Deterministic PRNG. NOT Math.random(): paint() runs every 3s and on every
  // navigation, and a random field would be rebuilt differently each time --
  // leaves would jump to new positions whenever you tapped between pages.
  function rng(seed) {
    var a = seed | 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- palette
  // Keyframes by sun elevation, in degrees. Four stops top-to-bottom:
  // zenith, upper, mid, horizon. Authored deep on purpose (see CAP above) --
  // a dusk-weighted sky, not a postcard noon.
  var SKY = [
    [ 60, ['#0d2f57', '#154272', '#256192', '#5b93b8']],
    [ 25, ['#0e2d54', '#17406d', '#2a5f8b', '#6f9dbc']],
    [ 10, ['#122a4a', '#1d3d63', '#3f5c81', '#9b8a92']],
    [  4, ['#141f3d', '#26314f', '#5c4460', '#b06a4a']],
    [  0, ['#101a33', '#1e2742', '#4a3552', '#9a5238']],
    [ -4, ['#0c1428', '#161d35', '#33263f', '#5e3730']],
    [-10, ['#080e1d', '#0e1428', '#1b1a2e', '#2e2233']],
    [-18, ['#04070f', '#060a16', '#0a0f1f', '#111726']]
  ];
  // DAYTIME BRIGHTNESS (s.brightness 0..1, Sky Lab's slider; DAY_BRIGHT
  // when unset): the day stops lean toward a real midday blue and the cap
  // rises with them by as much, so the brighter sky is not simply scrimmed
  // back down. Full from 25 deg of sun, faded out by 10 deg -- golden hour,
  // sunset, dusk and night are untouched (faded only to the horizon, it
  // greyed a sunset's warm horizon). At full: a mean luma near 130 against the deep sky's 75,
  // so the cap rises by up to BRIGHT_CAP. Every screen runs at full since
  // 2026-10-07 (chosen in Sky Lab: "way more natural"); 0 is the deep sky
  // the palette above was authored as. HK Settings -> Sky -> Daytime Sky
  // (sky.daytime, a screen's sky_daytime) sets it: Natural 1, Balanced 0.5,
  // Deep 0 (hk-settings.js skyLook).
  var SKY_BRIGHT = ['#1f5e9e', '#3a7fc0', '#5c9fd6', '#a3cbe6'];
  var BRIGHT_CAP = 60;
  var DAY_BRIGHT = 1;

  // Cloud tint by elevation. Clouds lit warm from below at sunset is the
  // single cue that reads as "sunset" rather than "dark blue picture".
  var CLOUD = [
    [ 25, ['#dbe8f2', '#a8c0d4']],
    [ 10, ['#d6dbe4', '#93a2b6']],
    [  4, ['#e8b79a', '#a2708a']],
    [  0, ['#d99a76', '#7d5570']],
    [ -4, ['#8d6360', '#4b3a52']],
    [-10, ['#3d3948', '#26243a']],
    [-18, ['#1c1f2e', '#141828']]
  ];

  // ------------------------------------------------------------- color util
  function hex(c) {
    return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16),
            parseInt(c.substr(5, 2), 16)];
  }
  function mix(a, b, t) {
    var A = hex(a), B = hex(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ','
                  + Math.round(A[1] + (B[1] - A[1]) * t) + ','
                  + Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  }
  function luma(c) {
    // Rec.709. Accepts both the '#rrggbb' of the tables and the 'rgb()' that
    // mix() returns, because ramp() output feeds straight into the estimate.
    var v = c.charAt(0) === '#' ? hex(c)
                                : c.replace(/[^\d,]/g, '').split(',').map(Number);
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  // Interpolate a keyframe table at elevation `e`. Tables run high -> low.
  function ramp(table, e) {
    if (e >= table[0][0]) return table[0][1].slice();
    var last = table.length - 1;
    if (e <= table[last][0]) return table[last][1].slice();
    for (var i = 0; i < last; i++) {
      var hi = table[i], lo = table[i + 1];
      if (e <= hi[0] && e > lo[0]) {
        var t = (hi[0] - e) / (hi[0] - lo[0]);
        return hi[1].map(function (c, k) { return mix(c, lo[1][k], t); });
      }
    }
    return table[last][1].slice();
  }

  // mix() for either form a ramp() stop can be in ('#rrggbb' or 'rgb()')
  function mixAny(a, b, t) {
    var A = a.charAt(0) === '#' ? hex(a) : a.replace(/[^\d,]/g, '').split(',').map(Number), B = hex(b);
    return 'rgb(' + A.map(function (v, k) { return Math.round(v + (B[k] - v) * t); }).join(',') + ')';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  // ------------------------------------------------------------- conditions
  // HA's weather states, collapsed to what the sky actually has to draw.
  // The seasonal leaves read wind in MPH. A weather entity declares its own
  // wind_speed_unit -- the entity's choice, not a guarantee -- and a units
  // change in HA would silently make every drift and duration wrong rather
  // than fail. So convert from whatever it declares.
  function toMph(v, unit) {
    switch (unit) {
      case 'km/h': return v * 0.621371;
      case 'm/s':  return v * 2.236936;
      case 'kn':   return v * 1.150779;
      case 'ft/s': return v * 0.681818;
      default:     return v;                       // mph, or undeclared
    }
  }

  var WET = {
    rainy:             { kind: 'rain', rate: 0.55 },
    pouring:           { kind: 'rain', rate: 1.00 },
    'lightning-rainy': { kind: 'rain', rate: 0.85, bolt: true },
    lightning:         { kind: 'none', rate: 0,    bolt: true },
    hail:              { kind: 'rain', rate: 0.75 },
    snowy:             { kind: 'snow', rate: 0.70 },
    'snowy-rainy':     { kind: 'snow', rate: 0.50 }
  };

  // Cloud cover to fall back on when the integration gives us no number.
  var FALLBACK_COVER = {
    'clear-night': 2, sunny: 4, partlycloudy: 42, cloudy: 85, fog: 95,
    rainy: 88, pouring: 96, 'lightning-rainy': 96, lightning: 78,
    hail: 92, snowy: 92, 'snowy-rainy': 92, windy: 30, 'windy-variant': 55,
    exceptional: 60
  };

  function read(client) {
    var sun = client.states['sun.sun'];
    // Which weather entity, moon source and seasonal gate: Configure ->
    // Weather and Seasonal sky (hk-settings.js), with generic fallbacks when unset.
    var HS = window.hkSettings;
    var wid = HS ? HS.weatherId(client.states) : null;
    var w = wid ? client.states[wid] : null;
    var a = (w && w.attributes) || {};
    // An entity with no reading (unknown or unavailable -- a weather outage,
    // a restart) is no weather, as no entity is: not the 40 % of cloud a
    // condition the table doesn't know would get.
    var cond = w && w.state && w.state !== 'unknown' && w.state !== 'unavailable' ? w.state : 'sunny';

    // cloud_coverage is an ATTRIBUTE on the weather entity, and the attribute
    // is where it is read from -- not from a sensor. OpenWeatherMap's weather
    // entity, for one, carries cloud_coverage alongside temperature,
    // humidity, wind and the rest.
    //
    // Its separate sensor.openweathermap_cloud_coverage is deliberately not
    // used: the attribute
    // and the sensor come from the same coordinator refresh, and reading one
    // entity for the whole sky rather than two keeps this function a single
    // lookup with a single failure mode.
    //
    // Fall back to the condition when the attribute is missing.
    var cover = a.cloud_coverage;
    if (cover === undefined || cover === null || !isFinite(Number(cover))) {
      cover = FALLBACK_COVER[cond];
      if (cover === undefined) cover = 40;
    }

    var out = {
      elev: num(sun && sun.attributes && sun.attributes.elevation, 0),
      azim: num(sun && sun.attributes && sun.attributes.azimuth, 180),
      cover: clamp(Number(cover), 0, 100) / 100,
      wind: clamp(toMph(num(a.wind_speed, 5), a.wind_speed_unit), 0, 40),
      cond: cond,
      fog: cond === 'fog',
      wet: WET[cond] || { kind: 'none', rate: 0 },
      moon: HS ? HS.moon(client.states) : 0.5,
      season: seasonOf(client),
      // seasonOf() folds this gate in already (it returns '' when the gate is
      // off), but the surprise selector needs it on its own: most surprises
      // fire on days when no season is running at all, so there is no season
      // string to carry the gate for them.
      seasonalOn: HS ? HS.seasonalOn(client.states) : true
    };
    // Sky / Background (hk-settings.js skyLook): this screen's own look,
    // else All Screens'. Weather off leaves the gradient, sun, moon and
    // stars -- no clouds, falling weather or fog. Decorations off empties
    // the season: '' is not in its key, so the next paint clears the field
    // (paintSeason). A non-null backdrop is the fixed all-day gradient
    // paint() paints instead of the live ramp. The PIN below still overrides
    // any of it for the dev probe.
    var look = HS && HS.skyLook ? HS.skyLook() : null;
    if (look) {
      out.animations = look.animations;
      out.weather = look.weather;
      out.precipitation = look.precipitation;
      out.decorations = look.decorations;
      out.decorationStyle = look.decorationStyle;
      out.moving = look.moving;
      out.cloudStyle = look.cloudStyle;
      if (typeof look.brightness === 'number') out.brightness = look.brightness;
      out.backdrop = look.backdrop;
      // Liveliness, and whether Calm When Nobody's Around holds the scene
      // calm right now (lvOf)
      if (look.lively) {
        out.lively = look.lively;
        if (look.lively.calmEmpty && look.lively.room) {
          out.lively = Object.assign({}, look.lively, { quiet: roomQuiet(client, look.lively.room) });
        }
      }
      if (!look.weather) {
        out.cover = 0;
        out.wind = 0;
        out.fog = false;
        out.wet = { kind: 'none', rate: 0 };
      }
      if (!look.decorations) {
        out.season = '';
        out.seasonalOn = false;
      }
    }
    // DEV PIN. Null in normal operation. When set, its fields override the
    // live reading for EVERY tick -- which is the only way to hold a scene
    // still on a tablet. Driving hkSkyAt() on a short interval instead does
    // not work: the module's own 3s tick keeps painting the real, seasonless
    // state in between, so the season key flips and the whole field is torn
    // down and rebuilt every three seconds. That thrash is invisible in a
    // screenshot and shows up as a halved 5th-percentile frame rate, which
    // reads as "the decoration is expensive" when it is nothing of the kind.
    // THE WEATHER PAGE (2026-10-16): its sky and the conditions, no
    // decorations -- the weather is plenty there (the user's ask)
    if (skyPage === 'weather') {
      out.decorations = false;
      out.season = '';
      out.seasonalOn = false;
    }
    if (PIN) for (var k in PIN) if (PIN.hasOwnProperty(k)) out[k] = PIN[k];
    return out;
  }

  // CALM WHEN NOBODY'S AROUND: the screen's room is empty -- every
  // occupancy, motion and presence sensor in it off, and for QUIET_MS -- so
  // its scene is thinned (.lv-quiet). A room with none is never quiet; HK
  // Settings offers the switch only where there are some, by the same rule
  // (hk-settings-model.js roomSensors).
  var QUIET_MS = 5 * 60000, QUIET_CLASSES = { occupancy: 1, motion: 1, presence: 1 }, quietIds = { ents: null, room: '', ids: [] };
  function roomSensorIds(client, room) {
    if (quietIds.ents === client.entities && quietIds.room === room) return quietIds.ids;
    var ents = client.entities || {}, devs = client.devices || {}, ids = [];
    Object.keys(client.states || {}).forEach(function (id) {
      if (id.indexOf('binary_sensor.') !== 0) return;
      var st = client.states[id], e = ents[id];
      if (!QUIET_CLASSES[st.attributes && st.attributes.device_class] || !e || e.hidden) return;
      var area = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
      if (area === room) ids.push(id);
    });
    quietIds = { ents: client.entities, room: room, ids: ids };
    return ids;
  }
  function roomQuiet(client, room) {
    var ids = roomSensorIds(client, room), now = Date.now();
    for (var i = 0; i < ids.length; i++) {
      var st = client.states[ids[i]];
      if (!st) continue;
      if (st.state === 'on') return false;
      var since = Date.parse(st.last_changed || '');
      if (!(now - since >= QUIET_MS)) return false;
    }
    return ids.length > 0;
  }

  // ------------------------------------------------------------------- moon
  // The terminator is an ellipse whose x-radius is R*|cos(2*pi*phase)|.
  // phase 0 is new, 0.5 full; waxing (phase < 0.5) is lit on the right.
  function moonSvg(phase, R) {
    var c = Math.cos(2 * Math.PI * phase);
    var rx = Math.abs(c) * R;
    var outer = phase < 0.5 ? 1 : 0;          // which limb is lit
    // Gibbous: the terminator bulges the SAME way as the outer arc.
    // Crescent: it bulges against it. That is the whole difference.
    var inner = c < 0 ? outer : 1 - outer;
    var d = 'M 0,' + (-R)
          + ' A ' + R + ',' + R + ' 0 0,' + outer + ' 0,' + R
          + ' A ' + rx.toFixed(2) + ',' + R + ' 0 0,' + inner + ' 0,' + (-R);
    var S = R * 2 + 4;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S +
      '" viewBox="' + (-S / 2) + ' ' + (-S / 2) + ' ' + S + ' ' + S + '">' +
      '<defs><radialGradient id="g" cx="38%" cy="34%">' +
      '<stop offset="0" stop-color="#fffdf4"/>' +
      '<stop offset="1" stop-color="#d9d6c4"/></radialGradient></defs>' +
      '<path d="' + d + '" fill="url(#g)"/></svg>');
  }

  // ------------------------------------------------------------------ style
  // NOTE: this is called SHEET, not CSS. Naming it CSS would shadow the global
  // CSS object inside this IIFE and silently break CSS.registerProperty below,
  // which would cost the cross-fade with no error anywhere.
  var FRONT_Z = 1;
  var SHEET = [
    // ITS OWN COLOR IS THE PALETTE'S MIDDLE (2026-10-09). The gradient
    // covers it everywhere, but a wall tablet repainting the gradient after a
    // page change shows the parts it has not drawn yet in this color for a
    // frame: navy under the Lights page's gold was a dark block across the
    // screen (screen-recorded). #05070e where color-mix is not known.
    '#hk-sky{position:fixed;inset:0;z-index:-1;contain:strict;pointer-events:none;',
    '  background:#05070e;background:color-mix(in srgb,var(--sk1,#05070e),var(--sk2,#05070e))}',
    '#hk-sky>*{position:absolute;inset:0}',

    // Sky gradient. The stops are registered custom properties (see register()),
    // so the whole gradient cross-fades on its own as the sun moves.
    '#hk-sky .grad{background:linear-gradient(to bottom,',
    '  var(--sk0) 0%,var(--sk1) 42%,var(--sk2) 72%,var(--sk3) 100%)}',

    // Sun / moon halo, placed by the sun's real azimuth and elevation, so the
    // bright side of the sky is the side it is actually on.
    '#hk-sky .glow{background:radial-gradient(circle var(--glowR) at var(--glowX) var(--glowY),',
    '  var(--glowC) 0%,transparent 70%);opacity:var(--glowO);transition:opacity 3s linear}',

    // Static: drift on a star field is imperceptible, and animating it would
    // mean overhanging a full 1024px tile to loop seamlessly.
    '#hk-sky .stars{background:url(' + BASE + 'stars.png' + VER + ') repeat;',
    '  background-size:1024px 1024px;opacity:var(--starO);transition:opacity 6s linear}',

    '#hk-sky .moon{inset:auto;width:var(--moonS);height:var(--moonS);',
    '  left:var(--moonX);top:var(--moonY);',
    '  margin:calc(var(--moonS)/-2) 0 0 calc(var(--moonS)/-2);',
    '  background:var(--moonI) center/contain no-repeat;opacity:var(--moonO);',
    '  filter:drop-shadow(0 0 12px rgba(214,226,255,.34));transition:opacity 6s linear}',

    // Cloud decks: one texture each, used as a MASK over a gradient fill, so
    // the same three files recolor from noon white through sunset pink to
    // storm gray without needing a variant per condition.
    //
    // repeat-x only, with the band height set per layer: clouds belong in the
    // sky, and tiling vertically would stack cloud bands down to the ground.
    // The overhang is on the RIGHT only and is exactly --tw, the distance the
    // layer travels -- enough to loop seamlessly, and no more texture memory
    // than that costs.
    //
    // SURFACE AREA: the layer's box is exactly its painted band, not a full
    // height with mostly transparent space below -- that idle raster was the
    // Living Room's graphics pressure (hk_house/docs/GRAPHICS-PRESSURE-
    // 2026-10-02.md, rec 3). The old box was 106% of the sky (top/bottom
    // -3%) and the band sat in its top --th of it, so the new box is --thf of
    // 106%: the same top edge, the same mask pixels, the same drift. The mask
    // tile stays --tw WIDE -- never 100%, or the clouds would stretch -- and
    // the gradient's lower stop is pushed out to 100%/--thf, which lands at
    // the same point of the same ramp the taller box used to show, so the
    // colors the band displays are the colors it always had.
    '#hk-sky .cl{top:-3%;height:calc(var(--thf) * 106%);left:0;right:calc(-1 * var(--tw));',
    '  -webkit-mask-repeat:repeat-x;mask-repeat:repeat-x;',
    '  -webkit-mask-size:var(--tw) 100%;mask-size:var(--tw) 100%;',
    '  -webkit-mask-position:0 0;mask-position:0 0;',
    '  background:linear-gradient(to bottom,var(--clTop),var(--clBot) calc(100% / var(--thf)));',
    '  opacity:var(--o);will-change:transform;transition:opacity 4s linear;',
    '  animation:hk-drift var(--d) linear infinite}',
    // --tw is DOUBLE the textures' natural feature width. At 640/440/280 each
    // deck would repeat 2 / 2.9 / 4.6 times across a 1280px tablet and the
    // same cloud shapes would be recognizable more than once. The textures
    // are 2048 wide holding twice as much content at the SAME
    // feature size (gen_sky.py, xrep=2), so drawing them at double the width
    // halves the repetition without changing how big a cloud looks.
    //
    // IF YOU CHANGE THESE, change the `tw` map in paint() too -- the drift
    // duration is derived from it, and a mismatch makes the loop jump.
    //
    // --thf is the old --th: the band as a fraction of the old full-height
    // box (see the SURFACE AREA note above). The values are unchanged, and
    // the art they mask is unchanged.
    //
    // The masks ship as LOSSLESS WebP (cloud_webp.py): 45-55% smaller and
    // faster to decode, the alpha bit-identical -- and the alpha is the whole
    // picture, since the mask is the shape and the gradient is the color.
    // The PNGs remain alongside for the rollout (an old page revalidates the
    // .png it fetched, and a vanished file is a 404 -- and a missing
    // mask-image is a solid tinted slab, not no clouds); they are removed
    // in a later change, once every page has loaded on the .webp URLs.
    '#hk-sky .cl.a{--tw:1280px;--thf:.66;-webkit-mask-image:url(' + BASE + 'clouds-a.webp' + VER + ');',
    '  mask-image:url(' + BASE + 'clouds-a.webp' + VER + ')}',
    '#hk-sky .cl.b{--tw:880px;--thf:.54;-webkit-mask-image:url(' + BASE + 'clouds-b.webp' + VER + ');',
    '  mask-image:url(' + BASE + 'clouds-b.webp' + VER + ')}',
    '#hk-sky .cl.c{--tw:560px;--thf:.42;-webkit-mask-image:url(' + BASE + 'clouds-c.webp' + VER + ');',
    '  mask-image:url(' + BASE + 'clouds-c.webp' + VER + ')}',
    // Clouds: Realistic (paintRealClouds): one box per cloud, moved by its
    // transform alone; its two <i> are its lighting now and, only while the
    // light changes, the next. At rest (Animations off, reduced motion) a
    // cloud stands where it was (--xs), not stacked at the left edge.
    // isolation: the clouds' own z-order (near in front of far) stays among
    // the clouds -- never above the scenery drawn after them
    '#hk-sky .rcl{overflow:hidden;pointer-events:none;isolation:isolate;z-index:0}',
    '#hk-sky .rcl .rc,#hk-sky .rcl .rcd{position:absolute;left:0;will-change:transform;',
    '  transition:opacity 4s linear}',
    '#hk-sky .rcl .rc{transform:translate3d(var(--xs),0,0);animation:hk-rc var(--d) linear var(--dl) 1 both}',
    '#hk-sky .rcl .rcd{animation:hk-rcd var(--d) ease-in-out infinite alternate}',
    '#hk-sky .rcl i{position:absolute;inset:0;background:0 0/100% 100% no-repeat;',
    '  transform:var(--tf,none);transition:opacity 9s linear}',
    // the ceiling's art (ceilCanvases), stretched over its box as the <i> was
    '#hk-sky .rcl canvas{position:absolute;left:0;top:0;width:100%;height:100%;transition:opacity 9s linear}',
    '@keyframes hk-rc{from{transform:translate3d(var(--x0),0,0)}to{transform:translate3d(var(--x1),0,0)}}',
    '@keyframes hk-rc2{from{transform:translate3d(var(--x0),0,0)}to{transform:translate3d(var(--x1),0,0)}}',
    '@keyframes hk-rcd{from{transform:translate3d(0,0,0)}to{transform:translate3d(var(--x1),0,0)}}',

    // Rain: two gradient sheets at slightly different angles and speeds. One
    // sheet alone reads as a moving texture; two read as depth. No per-drop
    // DOM and no canvas -- one composited layer each.
    //
    // The travel is computed in JS along the gradient's own axis and is a whole
    // number of pattern periods, which is the only way the loop is seamless at
    // an arbitrary angle. --pad is that travel, so the overhang again costs
    // exactly what the motion needs.
    // Overhang on the TOP ONLY -- the header's "overhang by exactly the
    // distance it travels" rule. These layers only move down, so padding the
    // other three sides buys nothing and costs real composited area: at a
    // 512px tile on a 1920x1200 tablet, all-sides padding is 2960x2240 per
    // deck against 1920x1720 for this. The element still covers the viewport
    // at the end of the travel, because it starts pad above the top and moves
    // down by pad-8.
    '#hk-sky .rain,#hk-sky .snow{inset:calc(-1 * var(--pad)) 0 0 0;',
    '  opacity:var(--o);will-change:transform;transition:opacity 3s linear;',
    '  animation:hk-fall var(--d) linear infinite}',
    // See IDLE_INVISIBLE. Two classes deep so it outranks the base .rain/.snow
    // and .cl rules whatever the source order; `will-change:auto` is the half
    // that actually hands the GPU layer back, since `animation:none` alone
    // stops the ticks but keeps the texture promoted.
    '#hk-sky .cl.idle,#hk-sky .rain.idle,#hk-sky .snow.idle{',
    '  animation:none;will-change:auto}',
    // ONE RAIN DECK (2026-10-10): the near and the far streaks in one tile
    // (tools/sky/gen_sky.py) -- a second full-screen layer blended on every
    // frame was a wall tablet's GPU's whole extra cost of the rain. Each deck
    // is drawn into its canvas at half the screen's resolution (fallDraw).
    '#hk-sky .rain>canvas,#hk-sky .snow>canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}',

    '#hk-sky .fog{background:linear-gradient(to bottom,',
    '  rgba(178,188,198,.06),rgba(178,188,198,.26));',
    '  opacity:var(--fogO);transition:opacity 4s linear}',
    '#hk-sky .bolt{background:radial-gradient(circle at 62% 22%,',
    '  rgba(226,238,255,.85),transparent 55%);',
    '  opacity:0;animation:hk-bolt 17s linear infinite}',

    // GRAIN. The weather sky always has clouds, stars or rain moving through
    // it, so it never reads as a flat fill. A static palette is a pure
    // four-stop gradient, and a gradient that size looks like exactly what it
    // is. There is a second, duller reason too: an 8-bit gradient across
    // 1280px BANDS visibly, and grain dithers those steps away.
    //
    // `overlay` rather than a plain translucent layer: overlay lightens where
    // the texture is above mid gray and darkens where it is below, so it works
    // on the dark top and the bright horizon of the same gradient without
    // washing either out. The texture is authored around 128 for that reason
    // (tools/sky/gen_sky.py, grain()).
    //
    // ABOVE the weather layers and BELOW the scrim, so the scrim still darkens
    // everything uniformly and CAP's arithmetic is unaffected -- grain has a
    // mean of zero by construction and does not move the luminance the scrim
    // is calibrated against.
    // On /hk/ the grain revalidates like every other texture, so the URL is
    // plain and goes through BASE with the others.
    '#hk-sky .grain{background-image:url(' + BASE + 'grain.png' + VER + ');',
    '  background-repeat:repeat;background-size:512px 512px;',
    '  mix-blend-mode:overlay;opacity:var(--grainO,0);transition:opacity 1.2s linear}',

    // SNAP. Every layer in here carries a multi-second opacity/background
    // transition, which is right while a page is SITTING there -- weather
    // easing from sunny to overcast should ease. It is wrong on NAVIGATION:
    // the sky element survives a view swap (see watch()), so arriving on Timers
    // from Weather would leave the weather sky visibly melting away over the
    // new page for several seconds -- the previous page's background bleeding
    // through.
    //
    // This class is added for the single paint that follows a path change and
    // removed on the next frame, so a navigation is a clean cut and everything
    // afterwards still eases. `*` rather than a list of selectors: it must
    // catch the scrim's `background` transition and the layers' `opacity` ones
    // alike, and any layer added later gets it for free.
    '#hk-sky.hk-snap,#hk-sky.hk-snap *{transition:none !important}',

    // THE ALBUM LAYER. blur is what makes this a WASH rather than a picture:
    // at 72px nothing of the cover survives but its color fields, which is
    // the whole point: a pop of color, not wallpaper.
    //
    // inset is negative and it has to be: a blur samples beyond its own edge,
    // so a layer blurred at 72px and pinned to the viewport fades to
    // transparent for ~72px on every side. Overhanging by more than the blur
    // radius keeps the color running to the screen edge.
    //
    // saturate lifts what the blur averages away; a heavy blur pulls every
    // cover toward its mean, which is duller than any part of it.
    '#hk-sky .art{position:absolute;inset:-120px;background-size:cover;',
    '  background-position:center;filter:blur(72px) saturate(1.5);',
    '  opacity:var(--artO,0);transition:opacity 1.2s linear,background-image 0s}',
    // a photo of your own (paintPhoto): the whole picture, sharp, to the edges
    '#hk-sky.photo .art{inset:var(--phI,0px);filter:var(--phF,none)}',

    // The scrim is what keeps the glass plates readable -- see CAP.
    '#hk-sky .scrim{background:linear-gradient(to bottom,',
    '  rgba(0,0,0,var(--scT)),rgba(0,0,0,var(--scB)));transition:background 4s linear}',

    // var() inside a keyframe resolves per element, so all the drifting and
    // falling layers share one pair of keyframes and differ only in their
    // own --tw / --fx / --fy.
    '@keyframes hk-drift{from{transform:translate3d(0,0,0)}',
    '  to{transform:translate3d(calc(-1 * var(--tw)),0,0)}}',
    '@keyframes hk-fall{from{transform:translate3d(0,0,0)}',
    '  to{transform:translate3d(var(--fx),var(--fy),0)}}',
    '@keyframes hk-bolt{0%,4.6%,100%{opacity:0}4.8%{opacity:.9}5.4%{opacity:.05}',
    '  5.8%{opacity:.7}6.6%{opacity:0}}',

    // ...and hand the GPU layers back while it is paused. animation-play-state
    // alone stops the ticks but `will-change:transform` keeps every deck's
    // composited texture resident -- each one LARGER than the viewport -- so a
    // cloudy night would hold tens of MB frozen behind the WallPanel
    // screensaver for no picture at all. Same lever as the .idle rule (see
    // IDLE_INVISIBLE); the cost is a one-off re-promotion on wake, when the
    // tablet is already re-rendering the whole page anyway.
    '#hk-sky.hidden *{animation-play-state:paused!important;',
    '  will-change:auto!important}',
    // HELD: the dashboard's sky under Kiosk Satellite's Black screensaver,
    // or on a computer whose window is not in focus (applyHidden) -- still, but its layers KEPT, so the wake has nothing to
    // put back (letting them go there made the scenery blink at every wake)
    '#hk-sky.held *{animation-play-state:paused!important}',
    // A static page has no weather, so the drifting and falling layers are not
    // merely invisible at opacity 0 -- they are switched off. opacity:0 still
    // composites every frame, which on a wall tablet is the whole cost with
    // none of the picture. The opacity TRANSITION still runs, so arriving from
    // a weather page still cross-fades them away rather than blinking.
    '#hk-sky.static .rcl{opacity:0;transition:opacity 4s linear}',
    // ...the clouds PAUSED, not stopped (2026-10-11): stopped, they started
    // over from their first frame on every return to a weather page -- the
    // clouds jumped back to where they began, and the Pre-rendered blur's
    // remembered picture of that page no longer matched the sky behind it
    // (measured headless: 7.9/255 on average, 95 in the worst cell, until
    // its next repaint). Paused, they come back where they were, so does the
    // picture; will-change goes, as under .hidden, so no texture is held.
    '#hk-sky.static .rcl *{animation-play-state:paused!important;will-change:auto!important}',
    '#hk-sky.static .cl,#hk-sky.static .rain,#hk-sky.static .snow{',
    // will-change too, for the same reason as the .idle and .hidden rules:
    // stopping the animation leaves the oversized composited texture resident,
    // and a static page is showing none of it.
    '  animation:none;will-change:auto}',
    // A tablet that asks for reduced motion gets a still sky, not a broken one.
    // REDUCED MOTION KILLS THE WHOLE SKY -- and on an Android tablet that flag
    // can be set without anyone having chosen it. WebView derives
    // prefers-reduced-motion:reduce from Settings.Global.ANIMATOR_DURATION_SCALE
    // == 0, which Samsung's Accessibility -> Remove animations, Power saving
    // mode, and Developer options -> Animator duration scale all write to.
    //
    // A STALE ZERO CAN OUTLIVE THE SETTING. On a Samsung tablet (SM-X210) with
    // Remove animations once on, turning it OFF does not clear it, and neither
    // does restarting Fully -- all three animation scales in Developer options
    // read 1x, yet WebView still reports reduce, and the sky is frozen while
    // every other animation on the page runs. Only a full REBOOT of the tablet
    // clears it. So if a sky is frozen on one tablet and nothing else is,
    // reboot it before touching this file.
    //
    // Diagnosing this from a screenshot is impossible (a Fully capture cannot
    // see the #hk-sky layer at all). /hk/pages/skyprobe.html
    // (frontend/pages/skyprobe.html) is the tool: load it on the tablet with
    // Fully Kiosk's load_url and read the answer back out of the tablet's
    // current-page sensor, which reports the full URL. It carries a copy of
    // the rule below, so `guard=0` means this line is what is firing rather
    // than something else.
    // ------------------------------------------------------ seasons
    // The season container sits BELOW .grain and .scrim (see build()), so
    // every seasonal layer is scrimmed with the rest of the sky instead of
    // floating over the cap. The garland is the one where this matters most:
    // it is bright and covers a third of the frame.
    '#hk-sky .season{position:absolute;inset:0;overflow:hidden;',
    '  pointer-events:none;transition:opacity 1.2s linear}',

    // Leaves are INDIVIDUAL ELEMENTS, not a tiled deck like rain and snow.
    // A tiled bitmap bakes each leaf's rotation in permanently -- the deck can
    // only translate -- so no leaf can ever twirl, flip or turn edge-on. Rain
    // gets away with that because a raindrop has no orientation to lose.
    // 20 elements of ~40px also cost far LESS than the two composited layers
    // larger than the viewport that a pair of decks would need.
    // NO FILTER ON THE FIELD. The scene's light (--lbri/--lsat, inherited)
    // is folded into each face's own filter below: a filter here made the
    // whole screen-sized field a surface the GPU filtered again on every
    // frame a leaf moved. Brightness and saturate are linear (brightness a
    // then b is a*b; saturate a then b is a*b) and commute, so the faces lit
    // one by one are the field lit at once.
    '#hk-sky .leaffield{position:absolute;inset:0;overflow:hidden;perspective:650px}',
    // preserve-3d on BOTH the faller and the tumbler, or the two faces
    // collapse into one plane and backface-visibility never gets a chance to
    // hide either of them.
    '#hk-sky .lf{position:absolute;top:-90px;will-change:transform;',
    '  transform-style:preserve-3d;',
    '  animation:hk-leaffall var(--fd) linear var(--fdel) infinite}',
    // NOTHING that groups may sit on this element. `filter` and `opacity`
    // below 1 both force a used transform-style of FLAT, which would flatten
    // the faces into it and show front and back at once. The per-leaf
    // brightness/saturation/opacity therefore live on the faces -- the
    // field-wide light too (.leaffield above).
    '#hk-sky .lf > i{display:block;width:100%;height:100%;position:relative;',
    '  transform-style:preserve-3d;',
    '  animation:hk-leaftumble var(--td) linear var(--tdel) infinite}',
    '#hk-sky .lf u{position:absolute;inset:0;display:block;',
    '  background-repeat:no-repeat;background-position:center;',
    '  background-size:contain;',
    // --a is per-leaf JITTER around 1; --lopa is the scene level, inherited
    // from .season and rewritten on every paint. Splitting them is what lets
    // dusk be gradual instead of a rebuild.
    '  filter:brightness(calc(var(--b) * var(--lbri,1))) saturate(calc(var(--s) * var(--lsat,1)));',
    '  opacity:calc(var(--a) * var(--lopa,.64));',
    '  -webkit-backface-visibility:hidden;backface-visibility:hidden}',
    '#hk-sky .lf u.f{background-image:var(--spf)}',
    // Pre-rotated a half turn so it faces the other way from the start; the
    // tumble then carries the pair round together.
    '#hk-sky .lf u.b{background-image:var(--spb);transform:rotateY(180deg)}',
    // The sway is folded into the FALL keyframes rather than a third nested
    // div: both are translations, so one animation carries them, and it
    // returns to x=0 so the loop is seamless.
    // Sway AND net drift are folded into the fall keyframes rather than given
    // their own wrapper element: all three are translations, so one animation
    // carries them at no extra cost, and --dr/--sw can be rewritten live
    // because a custom property change re-evaluates the keyframes without
    // restarting the animation. Durations cannot, which is why wind is
    // bucketed into the season key instead of applied continuously.
    '@keyframes hk-leaffall{',
    '  0%{transform:translate3d(0,0,0)}',
    '  25%{transform:translate3d(calc(var(--dr) * .25 + var(--sw)),',
    '       calc(var(--dist) * .25),0)}',
    '  50%{transform:translate3d(calc(var(--dr) * .5),calc(var(--dist) * .5),0)}',
    '  75%{transform:translate3d(calc(var(--dr) * .75 - var(--sw)),',
    '       calc(var(--dist) * .75),0)}',
    '  100%{transform:translate3d(var(--dr),var(--dist),0)}}',
    // Spin and flip are WHOLE turns, so this loops seamlessly too. rotateY
    // under the field's perspective is what takes a leaf edge-on and shows
    // its back.
    '@keyframes hk-leaftumble{',
    '  from{transform:rotateZ(var(--z0)) rotateY(0deg) rotateX(0deg)}',
    '  to{transform:rotateZ(calc(var(--z0) + var(--spin))) rotateY(var(--flip))',
    '     rotateX(var(--tilt))}}',

    // Bats: a three-frame flap, one stacked layer per frame, each shown for
    // its quarter(s) of the beat by an OPACITY step. step-end makes each
    // frame hold; without it they cross-fade into three dissolving bats.
    // NOT a background-image keyframe list: Chrome runs an image animation
    // on the main thread, a style recalc and repaint every frame. Measured on
    // a room page at 4x CPU throttle: 59 style recalcs/s and ~10 points of
    // main-thread busy for three bats, on every sky page for the whole
    // season; as opacity steps the compositor runs them (4 recalcs/s, the
    // page's own). The layers start at opacity 0, so with animations off
    // (reduced motion) a bat is invisible.
    '#hk-sky .bat{position:absolute;left:0;will-change:transform;',
    '  animation:hk-batfly var(--bd) linear var(--bdel) infinite}',
    '#hk-sky .bat i{position:absolute;inset:0;opacity:0;',
    '  background-repeat:no-repeat;background-size:contain;',
    '  background-position:center}',
    '#hk-sky .bat .f1{animation:hk-bat1 var(--fl) step-end infinite}',
    '#hk-sky .bat .f2{animation:hk-bat2 var(--fl) step-end infinite}',
    '#hk-sky .bat .f3{animation:hk-bat3 var(--fl) step-end infinite}',
    '@keyframes hk-batfly{',
    '  0%{transform:translate3d(var(--x0),0,0)}',
    '  25%{transform:translate3d(calc(var(--x0) + var(--xd) * .25),-20px,0)}',
    '  50%{transform:translate3d(calc(var(--x0) + var(--xd) * .5),12px,0)}',
    '  75%{transform:translate3d(calc(var(--x0) + var(--xd) * .75),-15px,0)}',
    '  100%{transform:translate3d(calc(var(--x0) + var(--xd)),0,0)}}',
    // frame 1, 2, 3, 2 -- a quarter each
    '@keyframes hk-bat1{0%{opacity:1}25%,100%{opacity:0}}',
    '@keyframes hk-bat2{0%{opacity:0}25%{opacity:1}50%{opacity:0}75%,100%{opacity:1}}',
    '@keyframes hk-bat3{0%,25%{opacity:0}50%{opacity:1}75%,100%{opacity:0}}',

    // Branches: ONE full-viewport photographic layer that reaches in from
    // every edge, so limbs continue behind the cards. 100% 100% rather than
    // cover, because the art is authored at a wall tablet's 16:10 and any
    // other fit crops the inward-reaching limbs off.
    //
    // No animation and no will-change on purpose: it is the size of the
    // screen, so promoting it costs a full-viewport GPU layer to move
    // nothing, and a sway would repaint every pixel each frame.
    '#hk-sky .branches{position:absolute;inset:0;',
    '  background:url(' + BRANCH_IMG + ') center/100% 100% no-repeat;',
    '  opacity:var(--bro,.78)}',

    // The leafy canopy. Lit by the SAME inherited variables as the leaves, so
    // the tree and the leaves falling off it always agree -- and both update
    // on the 3s paint without anything being rebuilt.
    '#hk-sky .canopy{position:absolute;inset:0;',
    '  background:url(' + CANOPY_IMG + ') center/100% 100% no-repeat;',
    '  filter:brightness(var(--lbri,1)) saturate(var(--lsat,1))}',

    // The cobweb, upper right, stationary. 0.019 mean alpha -- it costs
    // essentially nothing and reads only when you look for it.
    '#hk-sky .cobweb{position:absolute;top:0;right:0;',
    '  background:url(' + WEB_IMG + ') top right/100% 100% no-repeat;',
    '  opacity:var(--weo,.28)}',

    // Ground fog: a shallower, denser band than the stock full-height .fog,
    // plus drifting wisps. The flat gradient alone read as haze, because fog
    // MOVES -- the gradient supplies the density, the wisps the life.
    '#hk-sky .gfog{position:absolute;inset:auto 0 0 0;height:62%;',
    '  background:linear-gradient(to bottom,rgba(150,164,178,0),',
    '    rgba(163,172,186,.22) 45%,rgba(186,191,200,.46) 78%,',
    '    rgba(198,200,206,.58));',
    '  opacity:var(--gfo,0);transition:opacity 4s linear}',
    // Wisps are a feathered mist texture rather than a blurred
    // radial gradient -- blur() on a moving element is a per-frame filter pass
    // over its whole box, which is exactly what not to put on a tablet.
    //
    // ALTERNATE, not a loop: the texture is not tileable, so running it one
    // way and wrapping would show a hard seam on every pass.
    '#hk-sky .fwisp{position:absolute;background-repeat:no-repeat;',
    '  background-size:100% 100%;background-image:url(' + FOG_IMG + ');',
    '  opacity:var(--wo);will-change:transform;',
    '  animation:hk-fwisp var(--wt) ease-in-out var(--wdel) infinite alternate}',
    '@keyframes hk-fwisp{from{transform:translate3d(var(--wa),0,0)}',
    '  to{transform:translate3d(var(--wb),0,0)}}',

    // DEPTH INSIDE THE SEASON, BY NUMBER, NOT BY APPEND ORDER. Appended after
    // the branches, the witch would fly IN FRONT of them. Back to
    // front: the moon (a stock layer, before .season in the sky), the mist and
    // bats (no z-index), the witch (1), the branches and cobweb (2), then the
    // cards, which sit above the whole sky. `isolation` makes .season its own
    // stacking context, so these numbers can never lift anything out of it and
    // over .grain and .scrim.
    '#hk-sky .season{isolation:isolate}',
    // BESIDE AN OPEN MENU: a page's decorations start where the page does
    // (hk-menu.js --hk-page-left: the docked menu's right edge, else
    // Home Assistant's sidebar or 0), so a canopy or a garland is never laid
    // out behind the menu; the sky itself still runs under it, blurred by
    // its glass -- the screensaver does the same beside its calendar pane.
    // Not the screensaver's own sky, which fills its screen.
    '#hk-sky:not(.own) .season{left:var(--hk-page-left,0px)}',
    '#hk-sky .season .witch{z-index:1}',
    '#hk-sky .season :is(.branches,.cobweb){z-index:2}',

    // The witch. Transform and opacity only: she is laid out once at the START
    // of her flight (left/top, see witchFly) and the keyframes move her from
    // there, fading in and out INSIDE the viewport. opacity:0 at rest, so a
    // stopped animation (a static page) leaves nothing on screen.
    '#hk-sky .witch{position:absolute;opacity:0;pointer-events:none;',
    '  background:url(' + WITCH_IMG + ') center/100% 100% no-repeat;',
    '  will-change:transform,opacity;',
    '  animation:hk-witchfly ' + WITCH_CYCLE + 's linear var(--wdel) infinite}',
    // The flight is the first WITCH_FLIGHT seconds of the cycle; she is
    // invisible for the rest. That is what makes it an EVENT, not a carousel.
    '@keyframes hk-witchfly{',
    '  0%{transform:translate3d(0,0,0);opacity:0}',
    '  ' + pct(WITCH_FADE) + '%{opacity:1}',
    '  ' + pct(WITCH_FLIGHT - WITCH_FADE) + '%{opacity:1}',
    '  ' + pct(WITCH_FLIGHT) + '%,100%{',
    '    transform:translate3d(var(--wdx),var(--wdy),0);opacity:0}}',
    // No flight at all for reduced motion -- not a witch frozen in the sky.
    '@media (prefers-reduced-motion:reduce){#hk-sky .witch{display:none}}',

    // The spooky moon is a PHOTOGRAPH with its own silver-blue halo baked in,
    // so it takes no warm sepia/hue-rotate "harvest moon" stack -- run on
    // this art that just tints the photo orange.
    // One soft cool bloom to seat it against the sky, nothing more.
    '#hk-sky .moon.hallow{filter:drop-shadow(0 0 26px rgba(186,206,238,.30))}',
    '#hk-sky .moon.woodland{filter:drop-shadow(0 0 12px rgba(186,206,238,.20))}',

    // The Christmas decoration: ONE stationary full-viewport image. inset:0,
    // NOT a cropped 2560x420 band -- the side sprigs and the stockings
    // need the full height, and a band would crop them off.
    '#hk-sky .xdecor{position:absolute;inset:0;',
    '  background:url(' + XDECOR + ') center/100% 100% no-repeat}',

    // NARROW SCREENS -- taller than wide, a phone held upright. Every
    // full-screen frame (canopy, branches, the Christmas decoration, the
    // surprise frames) is painted at a wall tablet's 16:10 and drawn 100%
    // 100%, which is exact there; a portrait phone would squeeze it to a
    // third of its width. Here each frame keeps its true shape: fitted to the HEIGHT, the
    // art's LEFT edge fills the left of the screen and its RIGHT edge the
    // right, so the limbs and corners still reach in from both sides. Only
    // the art's middle -- behind the cards on a tablet -- is left out.
    // (paintSeason sets .narrow; the edges are ::before / ::after, so the
    // layer's own opacity and filter still apply to both.)
    //
    // THE TWO EDGES OVERLAP AND CROSS-FADE. At 50% each they would meet on a
    // hard vertical line down the middle of the phone, with limbs from two
    // unrelated parts of the art cut off against each other. Each edge is
    // NARROW_HALF wide,
    // solid over its outer NARROW_SOLID and masked to nothing over the rest,
    // so through the middle third one set of limbs dissolves while the other
    // appears. Verified at 402x874: no seam, both sides still framed.
    '#hk-sky .canopy{--frame:url(' + CANOPY_IMG + ')}',
    '#hk-sky .branches{--frame:url(' + BRANCH_IMG + ')}',
    '#hk-sky .xdecor{--frame:url(' + XDECOR + ')}',
    '#hk-sky .sp-frame{--frame:var(--spf)}',
    '#hk-sky .season.narrow :is(.canopy,.branches,.xdecor,.sp-frame){background-image:none}',
    '#hk-sky .season.narrow :is(.canopy,.branches,.xdecor,.sp-frame)::before,',
    '#hk-sky .season.narrow :is(.canopy,.branches,.xdecor,.sp-frame)::after{',
    '  content:"";position:absolute;top:0;bottom:0;',
    '  width:' + (NARROW_HALF * 100) + '%;',
    '  background-image:var(--frame);background-repeat:no-repeat;',
    '  background-size:auto 100%}',
    '#hk-sky .season.narrow :is(.canopy,.branches,.xdecor,.sp-frame)::before{',
    '  left:0;background-position:left center;',
    '  -webkit-mask-image:linear-gradient(to right,#000 ' + (NARROW_SOLID * 100) + '%,transparent 100%);',
    '  mask-image:linear-gradient(to right,#000 ' + (NARROW_SOLID * 100) + '%,transparent 100%)}',
    '#hk-sky .season.narrow :is(.canopy,.branches,.xdecor,.sp-frame)::after{',
    '  right:0;background-position:right center;',
    '  -webkit-mask-image:linear-gradient(to left,#000 ' + (NARROW_SOLID * 100) + '%,transparent 100%);',
    '  mask-image:linear-gradient(to left,#000 ' + (NARROW_SOLID * 100) + '%,transparent 100%)}',

    // A bulb halo. THE MASK IS LOAD-BEARING: the raw glow art has a firm amber
    // perimeter that reads as a flat orange disc at this size, so the radial
    // mask eats the rim and keeps only the soft core. Baseline is never zero --
    // the master already contains steady emission, and these add variation on
    // top rather than switching lights on and off.
    '#hk-sky .xlight{position:absolute;width:32px;height:32px;',
    '  transform:translate(-50%,-50%);',
    '  background:url(' + XGLOW + ') center/contain no-repeat;',
    '  -webkit-mask-image:radial-gradient(circle,#000 0%,#0009 12%,',
    '    #0002 27%,transparent 40%);',
    '  mask-image:radial-gradient(circle,#000 0%,#0009 12%,',
    '    #0002 27%,transparent 40%);',
    '  opacity:.04;animation:hk-xtwinkle var(--td) ease-in-out var(--tdel)',
    '    infinite}',
    // Independently phased, so it breathes rather than chasing. No moment has
    // the whole string lit.
    '@keyframes hk-xtwinkle{0%,30%,100%{opacity:.04}',
    '  48%,55%{opacity:.55}72%{opacity:.12}}',

    // Decorative snow. Individual elements like the leaves, for the same
    // reason -- a tiled deck cannot rotate a flake. Far gentler than the
    // leaves though: snow drifts and turns, it does not tumble or flip.
    '#hk-sky .xflake{position:absolute;top:-55px;will-change:transform;',
    '  animation:hk-xfall var(--fd) linear var(--fdel) infinite}',
    '#hk-sky .xflake > i{display:block;width:100%;height:100%;',
    '  background:var(--sp) center/contain no-repeat;',
    '  animation:hk-xspin var(--sd) linear var(--sdel) infinite}',
    '@keyframes hk-xfall{',
    '  0%{transform:translate3d(0,0,0)}',
    '  25%{transform:translate3d(var(--sw),calc(var(--dist) * .25),0)}',
    '  50%{transform:translate3d(calc(var(--dr) * .5),calc(var(--dist) * .5),0)}',
    '  75%{transform:translate3d(calc(var(--dr) * .75 - var(--sw)),',
    '       calc(var(--dist) * .75),0)}',
    '  100%{transform:translate3d(var(--dr),var(--dist),0)}}',
    '@keyframes hk-xspin{from{transform:rotate(0deg)}',
    '  to{transform:rotate(var(--turn))}}',

    // Santa. Same shape as the witch: a rare crossing, parked off-screen for
    // the rest of the cycle, and brightness(0) so he is a clean silhouette
    // rather than a lit cartoon against the sky.
    '#hk-sky .sleigh{position:absolute;left:0;aspect-ratio:3 / 1;',
    '  background:url(' + SLEIGH + ') center/contain no-repeat;',
    '  filter:brightness(0);opacity:.85;will-change:transform;',
    '  animation:hk-sleigh var(--fd) linear var(--fdel) infinite}',
    '@keyframes hk-sleigh{',
    '  0%{transform:translate3d(var(--x0),0,0)}',
    '  3%{transform:translate3d(calc(var(--x0) + var(--xd) * .45),-9px,0)}',
    '  5%{transform:translate3d(calc(var(--x0) + var(--xd) * .72),4px,0)}',
    '  7%{transform:translate3d(calc(var(--x0) + var(--xd)),0,0)}',
    '  100%{transform:translate3d(calc(var(--x0) + var(--xd)),0,0)}}',

    // --------------------------------------------------- the surprises
    // A border frame with an open center. Lit by the same inherited --lbri /
    // --lsat as everything else in .season, so a surprise dims into the
    // evening with the canopy rather than glowing on its own.
    '#hk-sky .sp-frame{position:absolute;inset:0;',
    '  background-repeat:no-repeat;background-size:100% 100%;',
    '  background-image:var(--spf);opacity:.86;',
    '  filter:brightness(var(--lbri,1)) saturate(var(--lsat,1))}',

    // Particles. Individual elements, same reasoning as the leaves and the
    // snow: a tiled deck cannot rotate one.
    '#hk-sky .sp-fall{position:absolute;top:-70px;will-change:transform;',
    '  animation:hk-spfall var(--fd) linear var(--fdel) infinite}',
    '#hk-sky .sp-fall > i{display:block;width:100%;height:100%;',
    '  opacity:var(--pa);',
    '  animation:hk-spspin var(--sd) ease-in-out var(--sdel) infinite alternate}',
    // Textured kinds carry a sprite; sparkle and confetti are drawn in CSS so
    // they cost no texture at all.
    '#hk-sky .sp-fall > i.tex{background:var(--sp) center/contain no-repeat}',
    '#hk-sky .sp-fall > i.dot{border-radius:50%;background:#f4d698;',
    '  box-shadow:0 0 4px #f4d698}',
    '#hk-sky .sp-fall > i.conf{width:55%;height:30%;background:var(--cc)}',
    '@keyframes hk-spfall{',
    '  0%{transform:translate3d(0,0,0)}',
    '  25%{transform:translate3d(calc(var(--dr) * .25 + var(--sw)),',
    '       calc(var(--dist) * .25),0)}',
    '  50%{transform:translate3d(calc(var(--dr) * .5),calc(var(--dist) * .5),0)}',
    '  75%{transform:translate3d(calc(var(--dr) * .75 - var(--sw)),',
    '       calc(var(--dist) * .75),0)}',
    '  100%{transform:translate3d(var(--dr),var(--dist),0)}}',
    '@keyframes hk-spspin{',
    '  from{transform:rotateZ(-35deg) rotateY(0deg)}',
    '  to{transform:rotateZ(230deg) rotateY(280deg)}}',

    // THE RARE EVENT, as a long-cycle CSS animation that parks the element
    // off-screen for the rest of the cycle -- the witch and the sleigh again.
    // No requestAnimationFrame loop and no WAAPI: one engine, no timers.
    '#hk-sky .sp-fly{position:absolute;left:0;',
    '  background:var(--spe) center/contain no-repeat;',
    '  will-change:transform,opacity;opacity:0;',
    '  animation:hk-spfly var(--fd) linear var(--fdel) infinite}',
    '@keyframes hk-spfly{',
    '  0%{transform:translate3d(var(--x0),0,0);opacity:0}',
    '  1%{opacity:.85}',
    '  4%{transform:translate3d(calc(var(--x0) + var(--xd) * .5),-10px,0);opacity:.85}',
    '  7%{transform:translate3d(calc(var(--x0) + var(--xd)),0,0);opacity:0}',
    '  100%{transform:translate3d(calc(var(--x0) + var(--xd)),0,0);opacity:0}}',
    // A firework does not cross; it blooms in place and fades.
    '#hk-sky .sp-burst{position:absolute;',
    '  background:var(--spe) center/contain no-repeat;',
    '  will-change:transform,opacity;opacity:0;',
    '  animation:hk-spburst var(--fd) ease-out var(--fdel) infinite}',
    '@keyframes hk-spburst{',
    '  0%{opacity:0;transform:scale(.1)}',
    '  1%{opacity:.6;transform:scale(.8)}',
    '  3%{opacity:0;transform:scale(1.25)}',
    '  100%{opacity:0;transform:scale(1.25)}}',

    // ---- NEW DECORATIONS (Decoration Style 'new'; mountNearScenery)
    // Close woodland art in place of the frames: a stationary full-height
    // cut-out per theme, relit every paint through --scene-b / --scene-s
    // (quantized there, so the 3s filter transition only runs on a real
    // change) and lit by --scene-light. The canvas is one 1586x992 picture
    // laid out four ways: the far valley (.scenery-depth), a ground wash
    // (.scenery-ground) and the two foreground trees, each cut out of its own
    // edge of the art by an SVG mask so the hills come from one projection.
    // EVERY MASK IS PAIRED WITH -webkit-mask-*, as elsewhere in this sheet:
    // older Android WebViews and Safari before 15.4 ignore the bare property
    // and draw the whole rectangle, hills and all, hard-edged.
    '#hk-sky .near-scenery{position:absolute;inset:0;pointer-events:none;overflow:hidden;',
    '  --scene-b:1;--scene-s:.85;--scene-light:.1}',
    '#hk-sky .near-scenery .scenery-art{position:absolute;inset:0;',
    '  background:var(--scene-image) center/cover no-repeat;',
    '  filter:brightness(var(--scene-b)) saturate(var(--scene-s));transition:filter 3s linear}',
    '#hk-sky .near-scenery .scenery-side{display:block;width:var(--art-w);height:var(--art-h);',
    '  background-size:100% 100%;',
    '  -webkit-mask-size:100% 100%;mask-size:100% 100%;',
    '  -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}',
    '#hk-sky .near-scenery .scenery-side.left{right:auto;background-position:left top;',
    '  -webkit-mask-image:var(--tree-left-mask);mask-image:var(--tree-left-mask)}',
    '#hk-sky .near-scenery .scenery-side.right{left:auto;background-position:right top;',
    '  -webkit-mask-image:var(--tree-right-mask);mask-image:var(--tree-right-mask)}',
    '#hk-sky .near-scenery .scenery-depth{background-position:center top;background-size:200% 100%;',
    '  -webkit-mask-image:linear-gradient(transparent 35%,#000 40%);',
    '  mask-image:linear-gradient(transparent 35%,#000 40%)}',
    // ONE CANVAS FOR THE FOUR (nearFlat): the same art, masks and wash,
    // drawn once at the screen's size; relit by the same filter
    '#hk-sky .near-scenery .scenery-flat{display:block;width:100%;height:100%;background:none}',
    '#hk-sky .near-scenery .scenery-ground{',
    '  background:linear-gradient(transparent 60%,var(--ground-color) 90%);',
    '  -webkit-mask-image:none;mask-image:none}',
    // A phone shows the right tree only, filling the width.
    '#hk-sky .near-scenery.narrow .scenery-side.right{width:100%;',
    '  background-size:var(--art-w) var(--art-h);-webkit-mask-image:none;mask-image:none}',
    '#hk-sky .near-scenery.narrow .scenery-side.left,#hk-sky .near-scenery.narrow .scenery-depth,',
    '#hk-sky .near-scenery.narrow .scenery-ground,#hk-sky .near-scenery.narrow .candle-art.left,',
    '#hk-sky .near-scenery.narrow .balloons.left,#hk-sky .near-scenery.narrow .cafe-wire{display:none}',
    // Halloween's candlelight pooled on the ground round each pumpkin (their
    // lit faces are patches), flickering out of step left and right. A
    // candle, not a strobe: it never drops below 80% (2026-10-04; the old
    // glow dipped to 58% behind a 2 px halo and read as unlit).
    '#hk-sky .near-scenery .candle-art{position:absolute;top:0;width:var(--art-w);height:var(--art-h);',
    '  filter:drop-shadow(0 0 3px #ffbe5c) drop-shadow(0 0 12px #ff7a1acc);',
    '  animation:scenery-candle 5.3s ease-in-out infinite}',
    '#hk-sky .near-scenery .candle-art.left{left:0}',
    '#hk-sky .near-scenery .candle-art.right{right:0;animation-duration:6.7s;animation-delay:-2.1s}',
    '#hk-sky .near-scenery .candle-art svg{width:100%;height:100%;overflow:visible}',
    '@keyframes scenery-candle{0%,100%{opacity:.82}17%{opacity:.97}38%{opacity:.86}',
    '  53%{opacity:1}74%{opacity:.84}89%{opacity:.95}}',
    // The lighting patches (NEAR_PATCHES): what hangs in the trees, lit by the
    // scene like the trees; over it what is lit after dark (--scene-lit),
    // candles flickering, bulbs twinkling one by one.
    '#hk-sky .near-scenery .patches,#hk-sky .near-scenery .patches-lit{position:absolute;inset:0}',
    '#hk-sky .near-scenery .patches-lit{opacity:var(--scene-lit,0);transition:opacity 3s linear}',
    '#hk-sky .near-scenery.lit-out .patches-lit{display:none}',
    // LIVELINESS (lvOf): Lights' twinkle Off holds every light at a steady
    // glow; Calm When Nobody's Around takes every second counted thing out
    '#hk-sky .lv-still .patch.lit{animation:none;opacity:.85}',
    '#hk-sky .lv-still .scenery-bulb.wave{animation:none}',
    '#hk-sky .lv-still .xlight{animation:none;opacity:.45}',
    '#hk-sky.lv-still .hx .tw{display:none}',
    '#hk-sky.lv-still .hx .cf{animation:none;opacity:.7}',
    '#hk-sky.lv-quiet .lv-t,#hk-sky .lv-quiet .lv-t{display:none}',
    '#hk-sky .near-scenery .patch{position:absolute;background-size:100% 100%;background-repeat:no-repeat}',
    '#hk-sky .near-scenery .patch.prop{filter:brightness(var(--scene-b)) saturate(var(--scene-s));',
    '  transition:filter 3s linear}',
    '#hk-sky .near-scenery .patch.candle{animation:scenery-candle 5.3s ease-in-out var(--phase) infinite}',
    '#hk-sky .near-scenery .patch.bulb{animation:scenery-twinkle 5.2s ease-in-out var(--phase) infinite}',
    '@keyframes scenery-twinkle{0%,100%{opacity:.5}45%{opacity:1}}',
    // The birthday's cafe-light wire, and the lamps breathing along it.
    '#hk-sky .near-scenery .cafe-wire{position:absolute;inset:0;width:100%;height:100%;',
    '  filter:brightness(var(--scene-b));opacity:.8}',
    '#hk-sky .near-scenery .scenery-glows{position:absolute;inset:0;',
    '  opacity:var(--scene-light);transition:opacity 3s linear}',
    '#hk-sky .near-scenery .scenery-bulb{position:absolute;',
    '  width:calc(7px * var(--lamp-scale,1));height:calc(7px * var(--lamp-scale,1));',
    '  border-radius:50%;background:#ffd49a;',
    '  box-shadow:0 0 8px 3px #edb25d66,0 0 16px 5px #d99c3522;opacity:.85;',
    '  transform:translate(-50%,-50%)}',
    '#hk-sky .near-scenery .scenery-bulb.wave{animation:scenery-breathe 9s ease-in-out var(--phase) infinite}',
    '@keyframes scenery-breathe{0%,100%{opacity:.72}50%{opacity:1}}',
    '#hk-sky .near-scenery .scenery-warmth{position:absolute;width:18%;height:11%;bottom:3%;',
    '  border-radius:50%;background:radial-gradient(ellipse,#d2ac7422,transparent 70%)}',
    // The moving layers reuse the original builders (leafField, batField,
    // fogWisps, surpriseScene), each in its own .near-motion field, lit by
    // the scene's light instead of .season's. The leaves take full opacity
    // (no --lopa); heavy weather thins them by half.
    '#hk-sky .near-scenery .near-motion{position:absolute;inset:0;',
    '  --lbri:var(--scene-b);--lsat:var(--scene-s);opacity:var(--near-particles,1)}',
    '#hk-sky .near-scenery .near-motion.leaves{opacity:1}',
    '#hk-sky .near-scenery .lf u{opacity:1}',
    '#hk-sky .near-scenery.heavy-weather .lf:nth-child(even){visibility:hidden}',
    // NO LEAVES ON A SPOOKY NIGHT (2026-10-04), as in the original renderer:
    // its measurement on the wall tablet (paintSeason) has leaves halving a
    // spooky night's frame rate once the device is busy, and this scene adds
    // four full-viewport filtered layers on top. display:none, not opacity,
    // so their animations stop; the bats, fog and candles are the scene.
    '#hk-sky .near-scenery.spooky .near-motion.leaves{display:none}',
    '#hk-sky .near-scenery .near-motion.near-mist{opacity:var(--near-mist,1)}',
    // No fade on these two, so off is simply not there (its animations stop).
    '#hk-sky .near-scenery:not(.is-night) .near-motion.night,',
    '#hk-sky .near-scenery:not(.is-day) .near-motion.day{display:none}',
    // Two bats on a long, mostly empty cycle: a brief crossing now and then.
    '#hk-sky .near-scenery .bat{opacity:0;animation-name:near-bat}',
    '@keyframes near-bat{0%{opacity:0;transform:translate3d(var(--x0),0,0)}1%{opacity:.5}',
    '  5%{opacity:.5}7%,100%{opacity:0;transform:translate3d(calc(var(--x0) + var(--xd)),0,0)}}',
    '#hk-sky .near-scenery .confetti{animation:near-confetti 187s linear infinite}',
    '@keyframes near-confetti{0%,6%,100%{opacity:0}1%,4%{opacity:.5}}',
    // ...and on the hour, a minute of it (nearTouches: .burst)
    '#hk-sky .near-scenery.burst .confetti{animation:none;opacity:.85}',
    // Tied to the trunks (left/top/size: update, from NEAR_BALLOONS), each
    // cluster swaying on its knot.
    '#hk-sky .near-scenery .balloons{position:absolute;',
    '  background:url(' + NEAR_ART + 'balloons-v1.webp' + VER + ') left center/200% 100% no-repeat;',
    '  animation:near-sway 19s ease-in-out -7s infinite;',
    '  filter:brightness(var(--scene-b)) saturate(var(--scene-s))}',
    '#hk-sky .near-scenery .balloons.right{background-position:right center;',
    '  animation-duration:23s;animation-delay:-13s}',
    '@keyframes near-sway{0%,100%{transform:rotate(-1deg)}40%{transform:rotate(var(--near-sway,1.3deg))}',
    '  72%{transform:rotate(.3deg)}}',
    // .hidden and .noanim are the sheet-wide rules below and above; a static
    // page drops the scenery like the .season frames.
    '#hk-sky.static .near-scenery{opacity:0}',
    '#hk-sky.static .near-scenery *{animation:none!important;will-change:auto!important}',
    '@media (prefers-reduced-motion:reduce){#hk-sky .near-scenery *{transition:none!important}}',

    // ---- NEW DECORATIONS: THE TOUCHES (nearTouches). Transform and opacity
    // only; what is not on show is display:none, so it does not run.
    '#hk-sky .near-scenery .near-motion.dark{opacity:var(--near-dark,0);transition:opacity 20s linear}',
    '#hk-sky .near-scenery .near-motion.dusk{opacity:var(--near-dusk,0);transition:opacity 20s linear}',
    '#hk-sky .near-scenery .near-motion.glints{opacity:var(--near-moonlit,0);transition:opacity 20s linear}',
    // ...and once faded right out, not there at all (nearTouches: fade)
    '#hk-sky .near-scenery.out-dark .near-motion.dark,#hk-sky .near-scenery.out-dusk .near-motion.dusk,',
    '#hk-sky .near-scenery.out-glints .near-motion.glints{display:none}',
    '#hk-sky .near-scenery .near-motion.windy-only,#hk-sky .near-scenery .near-motion.eve{display:none}',
    '#hk-sky .near-scenery .sleigh{filter:brightness(0) drop-shadow(0 0 2px rgba(206,218,240,.7));opacity:.9}',
    '#hk-sky .near-scenery.windy .near-motion.windy-only,#hk-sky .near-scenery.eve .near-motion.eve{display:block}',
    // Bats in twos and threes: a crossing of ~8 s in each cycle, then gone.
    // A rim of moonlight on each, or a black bat on a night sky is no bat.
    '#hk-sky .near-scenery .flock .bat{animation-name:near-flock;',
    '  filter:drop-shadow(0 0 1.5px rgba(196,210,238,.6)) drop-shadow(0 0 5px rgba(160,180,220,.25))}',
    '@keyframes near-flock{0%{opacity:0;transform:translate3d(var(--x0),0,0)}1%{opacity:.85}',
    '  5%{transform:translate3d(calc(var(--x0) + var(--xd) * .45),-14px,0)}10%{opacity:.85}',
    '  11%,100%{opacity:0;transform:translate3d(calc(var(--x0) + var(--xd)),0,0)}}',
    // The owl: two amber eyes in the tree's hollow that look out, blink, and
    // turn away for a while.
    '#hk-sky .near-scenery .owl{position:absolute;width:calc(30px * var(--owl,1));',
    '  height:calc(11px * var(--owl,1));margin:calc(-6px * var(--owl,1)) 0 0 calc(-15px * var(--owl,1));',
    '  opacity:0;animation:near-owl 47s linear -9s infinite}',
    '#hk-sky .near-scenery .owl .eye{position:absolute;top:0;width:calc(10px * var(--owl,1));',
    '  height:calc(10px * var(--owl,1));border-radius:50%;',
    '  background:radial-gradient(circle at 45% 45%,#fff4b8 0 16%,#ffb12e 30%,#c25f00 62%,transparent 70%);',
    '  box-shadow:0 0 6px 2px rgba(255,165,40,.4);animation:near-blink 6.3s ease-in-out infinite}',
    '#hk-sky .near-scenery .owl .eye:last-child{right:0;animation-delay:.04s}',
    '@keyframes near-owl{0%{opacity:0}5%,54%{opacity:1}59%,100%{opacity:0}}',
    '@keyframes near-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}',
    // Mist drifting across the moon.
    '#hk-sky .near-scenery .moon-mist{position:absolute;pointer-events:none}',
    // A haze, not a beam: faint, soft-edged and taller than a streak.
    '#hk-sky .near-scenery .moon-mist .wisp{position:absolute;left:0;top:-30%;width:62%;height:160%;',
    '  border-radius:50%;opacity:0;',
    '  background:radial-gradient(ellipse at center,rgba(200,208,224,.24),rgba(200,208,224,.09) 42%,transparent 68%);',
    '  animation:near-wisp 84s linear infinite}',
    '#hk-sky .near-scenery .moon-mist .wisp.b{top:42%;height:70%;width:46%;animation-duration:121s;',
    '  animation-delay:-50s}',
    '@keyframes near-wisp{0%{transform:translate3d(-45%,0,0);opacity:0}15%,85%{opacity:1}',
    '  100%{transform:translate3d(210%,0,0);opacity:0}}',
    // Glints on moonlit snow.
    '#hk-sky .near-scenery .glint{position:absolute;width:calc(3px * var(--near-u,1));',
    '  height:calc(3px * var(--near-u,1));border-radius:50%;background:#fff;',
    '  box-shadow:0 0 4px 1px rgba(220,235,255,.8);opacity:0;',
    '  animation:near-glint var(--gd) ease-in-out var(--gdel) infinite}',
    '@keyframes near-glint{0%,82%,100%{opacity:0;transform:scale(.4)}88%{opacity:1;transform:scale(1.25)}',
    '  93%{opacity:.2;transform:scale(.6)}}',
    // The northern lights: two slow curtains behind the trees.
    '#hk-sky .near-scenery .aurora{position:absolute;left:0;right:0;top:0;height:50%;display:none;overflow:hidden;',
    '  -webkit-mask-image:linear-gradient(#000 50%,transparent);mask-image:linear-gradient(#000 50%,transparent)}',
    '#hk-sky .near-scenery.aurora-on .aurora{display:block}',
    '#hk-sky .near-scenery .aurora .band{position:absolute;inset:-10% -20%;opacity:.7;',
    '  background:repeating-linear-gradient(100deg,transparent 0 6%,rgba(90,255,170,.42) 9%,',
    '    rgba(80,220,200,.18) 13%,transparent 18%),',
    '    linear-gradient(transparent 8%,rgba(80,255,170,.5) 42%,rgba(60,180,255,.14) 72%,transparent);',
    '  animation:near-aurora 46s ease-in-out infinite alternate}',
    '#hk-sky .near-scenery .aurora .band.b{animation-duration:63s;animation-delay:-20s;top:-4%}',
    // (drawn: the same gradients on a small canvas -- auroraDraw)
    '#hk-sky .near-scenery .aurora .band.cv{background:none}',
    '#hk-sky .near-scenery .aurora .band canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}',
    '@keyframes near-aurora{0%{transform:translate3d(-6%,0,0) skewX(-8deg);opacity:.45}50%{opacity:.85}',
    '  100%{transform:translate3d(6%,2%,0) skewX(8deg);opacity:.55}}',
    // A rainbow after real rain: an arc behind the trees, fading in.
    '#hk-sky .near-scenery .rainbow{position:absolute;left:50%;top:95%;width:calc(var(--rr,600px) * 2);',
    '  height:calc(var(--rr,600px) * 2);margin:calc(var(--rr,600px) * -1) 0 0 calc(var(--rr,600px) * -1);',
    '  border-radius:50%;opacity:0;transition:opacity 40s linear;',
    '  background:radial-gradient(closest-side,transparent 86%,rgba(150,60,220,.5) 87.5%,',
    '    rgba(60,90,255,.5) 89%,rgba(40,200,120,.5) 90.5%,rgba(250,230,60,.5) 92%,',
    '    rgba(255,150,40,.5) 93.5%,rgba(240,60,50,.45) 95%,transparent 96.5%);',
    '  -webkit-mask-image:linear-gradient(#000 25%,transparent 50%);mask-image:linear-gradient(#000 25%,transparent 50%)}',
    '#hk-sky .near-scenery.rainbow-on .rainbow{opacity:.5}',
    // Fireflies: a slow wander and a glow, dark most of the time.
    '#hk-sky .near-scenery .firefly{position:absolute;width:calc(4px * var(--near-u,1));',
    '  height:calc(4px * var(--near-u,1));border-radius:50%;background:#e8ff8a;',
    '  box-shadow:0 0 6px 3px rgba(214,255,110,.55);opacity:0;',
    '  animation:near-glow var(--fd) ease-in-out var(--fdel) infinite,',
    '    near-wander var(--wd) ease-in-out var(--fdel) infinite alternate}',
    '@keyframes near-glow{0%,55%,100%{opacity:0}70%{opacity:1}80%{opacity:.85}}',
    '@keyframes near-wander{0%{transform:translate3d(0,0,0)}',
    '  50%{transform:translate3d(calc(var(--fx) * .6),calc(var(--fy) * -1),0)}',
    '  100%{transform:translate3d(var(--fx),var(--fy),0)}}',
    // Petals from the blossoms, the full height of the scene.
    '#hk-sky .near-scenery .petal{position:absolute;border-radius:80% 0 80% 0;opacity:0;',
    '  width:calc(var(--ps,10px) * var(--near-u,1));height:calc(var(--ps,10px) * .72 * var(--near-u,1));',
    '  background:linear-gradient(135deg,#fde3ea,#f1a9bd);',
    '  animation:near-petal var(--pd) linear var(--pdel) infinite}',
    '@keyframes near-petal{0%{opacity:0;transform:translate3d(0,0,0) rotate(0)}8%{opacity:.9}',
    '  50%{transform:translate3d(calc(var(--pside) * 70px),45vh,0) rotate(220deg)}92%{opacity:.8}',
    '  100%{opacity:0;transform:translate3d(calc(var(--pside) * 150px),95vh,0) rotate(470deg)}}',
    // A gust: a few leaves swept across the scene, in a real wind.
    '#hk-sky .near-scenery .swirl-leaf{position:absolute;left:-60px;opacity:0;',
    '  width:calc(34px * var(--near-u,1));height:calc(34px * var(--near-u,1));',
    '  background-position:center;background-size:contain;background-repeat:no-repeat;',
    '  animation:near-swirl 31s linear var(--sdel) infinite}',
    '@keyframes near-swirl{0%{opacity:0;transform:translate3d(0,0,0) rotate(0)}2%{opacity:.95}',
    '  8%{transform:translate3d(32vw,-6vh,0) rotate(260deg)}12%{transform:translate3d(48vw,4vh,0) rotate(420deg)}',
    '  16%{transform:translate3d(60vw,-8vh,0) rotate(600deg)}24%{opacity:.9;transform:translate3d(110vw,2vh,0) rotate(900deg)}',
    '  25%,100%{opacity:0;transform:translate3d(110vw,2vh,0) rotate(900deg)}}',
    // Geese in a V, now and then, by day.
    // Each bird an HTML element, its wings' flap a transform the compositor
    // runs: an SVG element's transform animates on the main thread, a style,
    // layout and paint every frame (measured, 2026-10-04: 59 layouts a second).
    '#hk-sky .near-scenery .geese{position:absolute;top:14%;left:0;width:calc(200px * var(--near-u,1));',
    '  height:calc(57.5px * var(--near-u,1));opacity:0;animation:near-geese 240s linear 30s infinite}',
    '#hk-sky .near-scenery .goose{position:absolute;width:12.5%;height:21.7%;background:url("data:image/svg+xml,',
    '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%27-2 -2 20 10%27%3E%3Cpath d=%27M0 4Q4 0 8 4Q12 0 16 4%27 ',
    'fill=%27none%27 stroke=%27%231d2027%27 stroke-width=%272.4%27 stroke-linecap=%27round%27/%3E%3C/svg%3E") 0 0/100% 100%;',
    '  animation:near-flap .7s ease-in-out infinite alternate}',
    '@keyframes near-flap{to{transform:scaleY(.55)}}',
    '@keyframes near-geese{0%{opacity:0;transform:translate3d(105vw,0,0)}1%,11%{opacity:.75}',
    '  12%,100%{opacity:0;transform:translate3d(-20vw,-4vh,0)}}',
    // A harvest moon: warm and low in the first hours of a full-moon night.
    '#hk-sky .moon.woodland.harvest{filter:sepia(.55) saturate(2.3) hue-rotate(-14deg) brightness(1.05)',
    '  drop-shadow(0 0 22px rgba(255,150,70,.35))}',
    // A birthday's pennants, swinging a little on their string.
    '#hk-sky .near-scenery .bday-banner{position:absolute;left:0;right:0;top:0;pointer-events:none;',
    '  filter:brightness(calc(.4 + var(--scene-b) * .7))}',
    '#hk-sky .near-scenery .bday-banner svg{display:block;overflow:visible}',
    // Each pennant an HTML element round its own still drawing, so its swing
    // is a transform the compositor runs (an SVG <g>'s is not: see .goose).
    '#hk-sky .near-scenery .bday-banner text{fill:#fff;font-weight:800;text-anchor:middle;',
    '  paint-order:stroke;stroke:rgba(0,0,0,.28);stroke-width:1.5px;',
    '  dominant-baseline:middle;font-family:-apple-system,"SF Pro Display","SF Pro",system-ui,sans-serif}',
    '#hk-sky .near-scenery .bday-banner .pen{position:absolute;display:block;transform-origin:50% 0;',
    '  animation:near-pen var(--pd) ease-in-out var(--pdel) infinite alternate}',
    '@keyframes near-pen{from{transform:rotate(-3deg)}to{transform:rotate(3deg)}}',

    // Static pages (Energy, EcoFlow, Cameras) are not weather and not
    // seasonal either. Same treatment as the weather decks: fade out, then
    // stop the animations and hand the GPU layers back.
    '#hk-sky.static .season{opacity:0}',
    '#hk-sky.static .season *{animation:none!important;will-change:auto!important}',

    // SKY / BACKGROUND -> ANIMATIONS OFF (hk-settings.js skyLook, toggled in
    // paint): the same treatment as the .static and .idle rules -- stop the
    // ticks AND hand the oversized composited decks back, because
    // animation:none alone leaves them resident. Every animated descendant
    // obeys it, including lightning and the landscape lights and fireflies.
    '#hk-sky.noanim *{',
    '  animation:none!important;will-change:auto!important}',

    '@media (prefers-reduced-motion:reduce){#hk-sky *{animation:none!important}}'
  ].join('');
  // MOVING THINGS IN FRONT (FRONT, below): every rule about the sky's insides
  // reaches the front layer too, where the moving things are drawn over the
  // cards -- only the rules about the sky ELEMENT itself (#hk-sky{...}: its
  // place under the page, its color) stay the sky's.
  SHEET = SHEET.replace(/#hk-sky(?=[ .>:])/g, ':is(#hk-sky,#hk-sky-front)') +
    // over the page's cards, under everything HK puts over the page (the
    // menu, the tab bar, the docked bar, pop-ups); not one touch lands here
    '#hk-sky-front{position:fixed;inset:0;z-index:' + FRONT_Z + ';contain:strict;overflow:hidden}' +
    '#hk-sky-front,#hk-sky-front *{pointer-events:none!important}';

  // Registering the gradient stops as <color> is what lets the sky CROSS-FADE
  // instead of jumping. An unregistered custom property has no type, so it can
  // only ever swap discretely -- sunrise would step through the palette in
  // visible slabs. hk-tap.js already relies on registerProperty for --hk-ring,
  // so support is proven on the same browsers.
  var REG = ['--sk0', '--sk1', '--sk2', '--sk3', '--clTop', '--clBot', '--glowC'];
  var registered = false;
  function register() {
    if (registered || !window.CSS || !window.CSS.registerProperty) return;
    registered = true;
    REG.forEach(function (name) {
      try {
        window.CSS.registerProperty({
          name: name, syntax: '<color>', inherits: true,
          initialValue: 'rgba(0,0,0,0)'
        });
      } catch (e) { /* already registered by an earlier import; harmless */ }
    });
  }

  // ------------------------------------------------------------------ mount
  // Walk UP out of however many shadow roots the card is nested in, rather
  // than querying DOWN from <home-assistant>. The path down changes with the
  // panel wrapper and wallpanel adds its own; up from the card is always the
  // same three hops.
  function container(card) {
    var n = card;
    for (var i = 0; i < 40 && n; i++) {
      if (SH.is(n, 'viewContainer')) return n;
      n = n.parentNode || n.host;
      if (n && n.nodeType === 11) n = n.host;   // ShadowRoot -> its host
    }
    return null;
  }

  // Styles go in as a CONSTRUCTED STYLESHEET, not as a <style> element.
  //
  // A <style> appended here renders as visible text -- the whole stylesheet
  // printed down the left of the page, squeezing the real content into what
  // is left, while its rules apply as well. hui-view-container's own
  // `display: relative` is not a valid display value, so the declaration is
  // dropped and the custom element falls back to display:inline, and a
  // <style> slotted into an inline formatting context in that shadow tree
  // gets laid out as text.
  //
  // adoptedStyleSheets sidesteps the whole question: there is no node in the
  // tree to lay out, and it is the mechanism lit itself uses for every HA
  // component, so support is not in doubt. The <style> path is kept only as a
  // fallback, and appended to the shadow root rather than beside the sky.
  var sheet = null;

  function attachStyles(el) {
    var root = el.getRootNode();
    if (!root) return;
    try {
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(SHEET);
        root.adoptedStyleSheets = root.adoptedStyleSheets.concat(sheet);
        return;
      }
    } catch (e) { sheet = null; }
    var tag = document.createElement('style');
    tag.id = 'hk-sky-style';
    tag.textContent = SHEET;
    (root.appendChild ? root : document.head).appendChild(tag);
  }

  function detachStyles(el) {
    var root = el && el.getRootNode();
    if (root && sheet && root.adoptedStyleSheets) {
      root.adoptedStyleSheets =
        root.adoptedStyleSheets.filter(function (s) { return s !== sheet; });
    }
    sheet = null;
    var tag = (root && root.querySelector && root.querySelector('#hk-sky-style'))
           || document.getElementById('hk-sky-style');
    if (tag) tag.remove();
  }

  // ------------------------------------------------------------ AURORA
  // THE NORTHERN LIGHTS AS SMALL CANVASES (2026-10-11). Each curtain was a
  // box 140% of the screen wide painted with two soft gradients -- about
  // half a screen of a wall tablet's tile memory each, a screen and a half
  // with the container (Christmas night had 2 screens less headroom than
  // the old decorations, measured headless with the budget capped). Nothing
  // in them is finer than a 50 px ramp, so they are drawn at a quarter of
  // their size into a canvas, which keeps its own pixel size on the GPU, and
  // scaled up; the curtains still drift and breathe as before (the band's
  // own animation). The same gradients as the CSS they replace: the
  // vertical glow under the 100deg stripes repeating every 18% of the
  // gradient line, each transparent stop the transparent of its neighbour
  // (CSS mixes premultiplied, so 'transparent' never greys a ramp).
  // (Measured against the CSS curtains: a mean difference of 0.7/255, and
  // Christmas night's headroom 4 -> 6 screens, the old decorations' own.)
  var AUR_RES = 0.25;
  function auroraCanvas(band) {
    var cv = document.createElement('canvas');
    if (!cv.getContext || !cv.getContext('2d')) return;
    band.appendChild(cv);
    band.classList.add('cv');
    band._hkCv = cv;
  }
  function auroraDraw(band) {
    var cv = band._hkCv;
    if (!cv) return;
    var W = band.clientWidth, H = band.clientHeight;
    if (!(W > 0) || !(H > 0)) return;
    var key = W + 'x' + H;
    if (cv._hkKey === key) return;
    cv._hkKey = key;
    cv.width = Math.max(1, Math.round(W * AUR_RES));
    cv.height = Math.max(1, Math.round(H * AUR_RES));
    var x = cv.getContext('2d');
    x.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
    // the glow: transparent to 8%, green by 42%, blue by 72%, gone at the foot
    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.08, 'rgba(80,255,170,0)'); g.addColorStop(0.42, 'rgba(80,255,170,.5)');
    g.addColorStop(0.72, 'rgba(60,180,255,.14)'); g.addColorStop(1, 'rgba(60,180,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // the stripes at 100deg: the CSS gradient line through the centre, its
    // length |W sin| + |H cos|, carried on to a whole number of repeats
    var a = 100 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
    var L = Math.abs(W * dx) + Math.abs(H * dy), P = 0.18, n = Math.ceil(1 / P);
    var x0 = W / 2 - dx * L / 2, y0 = H / 2 - dy * L / 2, span = L * P * n;
    var st = x.createLinearGradient(x0, y0, x0 + dx * span, y0 + dy * span);
    for (var k = 0; k < n; k++) {
      var b = k / n, u = 1 / n / P;      // a stop at fraction f of the line: b + f * u
      st.addColorStop(b, 'rgba(90,255,170,0)');
      st.addColorStop(b + 0.06 * u, 'rgba(90,255,170,0)');
      st.addColorStop(b + 0.09 * u, 'rgba(90,255,170,.42)');
      st.addColorStop(b + 0.13 * u, 'rgba(80,220,200,.18)');
      st.addColorStop(Math.min(1, b + 0.18 * u), 'rgba(80,220,200,0)');
    }
    x.fillStyle = st; x.fillRect(0, 0, W, H);
  }

  // ------------------------------------------------------------ FRONT
  // MOVING THINGS (Sky / Background, 2026-10-11): 'front' draws the rain and
  // snow, the falling leaves and petals, the bats and birds, the flybys, the
  // confetti and the fireflies OVER the cards; fireworks, fog and mist,
  // clouds and the scenery stay behind. The sky is one fixed layer under the
  // page (z-index -1, contain:strict), so nothing in it can be lifted over
  // the cards: the moving things are MOVED into a second layer, #hk-sky-front,
  // over the page and under everything HK lays over it, and back again.
  //   * Each keeps its CSS: every #hk-sky rule reaches #hk-sky-front (SHEET),
  //     and each moved node sits in a SHELL of each parent it had -- same tag,
  //     class and style, kept in step (a MutationObserver) -- so a rule like
  //     ".near-scenery.spooky .near-motion.night" still applies.
  //   * Its builders keep their references (a moved node is the same node);
  //     the lookups by selector look in the front too (skyQ / skyQA).
  //   * A placeholder marks where it was: back there on 'behind', and dropped
  //     with its home when the scene is rebuilt (the placeholder goes too).
  //   * Not one touch: pointer-events:none on the layer and everything in it.
  var FRONT_SEL = [
    ':scope > .rain', ':scope > .snow',
    ':scope > .near-scenery > .near-motion.leaves', ':scope > .near-scenery > .near-motion.swirl',
    ':scope > .near-scenery > .near-motion.petals', ':scope > .near-scenery > .near-motion.confetti',
    ':scope > .near-scenery > .near-motion.dusk', ':scope > .near-scenery > .near-motion.day',
    ':scope > .near-scenery > .near-motion.eve', ':scope > .near-scenery > .near-motion.night:not(.fireworks)',
    ':scope > .near-scenery > .near-motion.dark > .flock',
    ':scope > .season > .bat', ':scope > .season > .witch', ':scope > .season > .xflake',
    ':scope > .season > .sleigh', ':scope > .season > .leaffield', ':scope > .season > .sp-fall',
    ':scope > .season > .sp-fly'
  ].join(',');
  // the node itself, or its moved twin's -- where a moving thing is now
  function skyQ(node, sel) {
    var n = node.querySelector(sel);
    if (!n && node._hkShell) n = node._hkShell.querySelector(sel);
    return n;
  }
  function skyQA(node, sel) {
    var out = Array.prototype.slice.call(node.querySelectorAll(sel));
    if (node._hkShell) out = out.concat(Array.prototype.slice.call(node._hkShell.querySelectorAll(sel)));
    return out;
  }
  function mirror(from, to) {
    var c = String(from.className || '').replace(/\bown\b/, '').trim();
    if (to.className !== c) to.className = c;
    var st = from.getAttribute('style') || '';
    if ((to.getAttribute('style') || '') !== st) to.setAttribute('style', st);
  }
  function frontOf(sky) {
    var F = sky._hkFront;
    if (F && F.el.isConnected) return F;
    var el = document.createElement('div');
    el.id = 'hk-sky-front';
    el.setAttribute('aria-hidden', 'true');
    sky.parentNode.insertBefore(el, sky.nextSibling);
    F = sky._hkFront = { el: el, moved: [], shells: [], mo: null };
    sky._hkShell = el;
    F.mo = typeof MutationObserver === 'function' ? new MutationObserver(function (recs) {
      recs.forEach(function (r) { var t = r.target; if (t._hkShell) mirror(t, t._hkShell); });
    }) : null;
    F.watch = function (orig) { if (F.mo) F.mo.observe(orig, { attributes: true, attributeFilter: ['class', 'style'] }); };
    F.watch(sky);
    mirror(sky, el);
    return F;
  }
  // the shell of `orig` (a parent of a moved node) in the front, made once
  function shellOf(F, sky, orig) {
    if (orig === sky) return F.el;
    if (orig._hkShell && orig._hkShell.isConnected) return orig._hkShell;
    var sh = document.createElement(orig.localName || 'div');
    mirror(orig, sh);
    shellOf(F, sky, orig.parentNode).appendChild(sh);
    orig._hkShell = sh;
    F.shells.push(orig);
    F.watch(orig);
    return sh;
  }
  function frontSync(sky, on) {
    var F = sky._hkFront;
    if (!on) {
      if (!F) return;
      // every moving thing back where it was (gone with its home: gone)
      F.moved.forEach(function (m) {
        if (m.mark.parentNode) m.mark.parentNode.replaceChild(m.node, m.mark); else m.node.remove();
      });
      F.shells.forEach(function (o) { o._hkShell = null; });
      if (F.mo) F.mo.disconnect();
      F.el.remove();
      sky._hkFront = null; sky._hkShell = null;
      return;
    }
    if (!sky.parentNode) return;
    F = frontOf(sky);
    // a scene rebuilt took its placeholders with it: its moved things go too
    F.moved = F.moved.filter(function (m) {
      if (m.mark.isConnected) return true;
      m.node.remove();
      return false;
    });
    F.shells = F.shells.filter(function (o) {
      if (o.isConnected) return true;
      if (o._hkShell) o._hkShell.remove();
      o._hkShell = null;
      return false;
    });
    Array.prototype.forEach.call(sky.querySelectorAll(FRONT_SEL), function (n) {
      var mark = document.createComment('hk-front');
      var home = shellOf(F, sky, n.parentNode);
      n.parentNode.insertBefore(mark, n);
      home.appendChild(n);
      F.moved.push({ node: n, mark: mark });
    });
    mirror(sky, F.el);
  }

  // ------------------------------------------------------------ LIVELINESS
  // How many of the little moving things there are, and how often the ones
  // that cross come by (HK Settings -> Sky / Background: each occasion's and
  // each woodland season's Liveliness, and each screen's; plan:
  // hk_house/docs/PLAN-SKY-LIVELINESS-2026-10-08.md). A KNOB is one setting
  // of one effect; its step 0-4 is Off - Few - Normal - Lots - Max. A preset
  // sets every knob of its occasion at once; Classic (Normal, 2) is the sky
  // exactly as it was drawn before there were knobs.
  //   many   a count: so many leaves, petals, fireflies, bats in a flock
  //   often  a crossing's cycle: a flock, the geese, the witch, the sleigh,
  //          a flyby, a shooting star, a firework (Off: never comes)
  //   show   on or off: the owl, the mist, the rainbow, the balloons, the
  //          lights' twinkle
  // A knob's kind -- what a screen's own Custom scales: Flying, Falling,
  // Glowing, Night Sky. The same table is in settings.py (LIVELY_KNOBS) and
  // panels/hk-settings-model.js (LIVELY); test_season.js holds the three
  // together.
  var LV_KNOBS = {
    bats: ['flying', 'many'], bats_often: ['flying', 'often'], swarm: ['flying', 'many'],
    witch: ['flying', 'often'], geese: ['flying', 'often'], sleigh: ['flying', 'often'],
    flyby: ['flying', 'often'], balloons: ['flying', 'show'],
    leaves: ['falling', 'many'], swirl: ['falling', 'many'], petals: ['falling', 'many'],
    snow: ['falling', 'many'], particles: ['falling', 'many'], mist: ['falling', 'show'],
    fireflies: ['glowing', 'many'], glints: ['glowing', 'many'], lights: ['glowing', 'show'],
    owl: ['glowing', 'show'], rainbow: ['glowing', 'show'],
    stars: ['night', 'many'], meteors: ['night', 'often'], fireworks: ['night', 'often'],
    aurora: ['night', 'often']
  };
  var LV_MANY = [0, 0.5, 1, 1.6, 2.5];          // a count's factor, by step
  var LV_CYCLE = [0, 2, 1, 0.6, 0.4];           // a cycle's factor (0: never comes)
  var LV_PRESETS = { subtle: 1, classic: 2, festive: 3, party: 4 };
  function lvStep(v, dflt) { v = Number(v); return v >= 0 && v <= 4 && Math.round(v) === v ? v : dflt; }
  // The resolved Liveliness for a reading (read() puts skyLook().lively on it
  // as s.lively: this screen's own, or All Screens' -- the same shape at both
  // levels, 2026-10-09). `all`: one preset for every occasion, or 'custom':
  // then `occ` -- each occasion's preset -- and `custom`, a Custom one's
  // knobs. knob(occ, k): this occasion's step for knob k (2 = Normal); many /
  // cycle: the factors to apply; on: whether a `show` or `often` knob is on
  // at all. `sig` changes with every setting that can change what is built,
  // so a scene is rebuilt on a change and never otherwise.
  function lvOf(s) {
    var L = (s && s.lively) || {};
    var all = LV_PRESETS.hasOwnProperty(L.all) || L.all === 'custom' ? L.all : 'classic';
    var occs = L.occ || {}, cust = L.custom || {};
    function preset(occ) { return all === 'custom' ? (occs[occ] || 'classic') : all; }
    function knob(occ, k) {
      var p = preset(occ);
      if (p === 'custom') return lvStep((cust[occ] || {})[k], 2);
      return LV_PRESETS.hasOwnProperty(p) ? LV_PRESETS[p] : 2;
    }
    return {
      knob: knob,
      many: function (occ, k) { return LV_MANY[knob(occ, k)]; },
      cycle: function (occ, k) { return LV_CYCLE[knob(occ, k)]; },
      on: function (occ, k) { return knob(occ, k) !== 0; },
      // Calm When Nobody's Around, right now: thin the scene (lvThin) without
      // a rebuild
      quiet: !!L.quiet,
      sig: JSON.stringify([all, all === 'custom' ? occs : null, all === 'custom' ? cust : null]),
      // what changes THIS occasion's scene: its own setting (another
      // occasion's change rebuilds nothing on show)
      sigFor: function (occ) {
        var p = preset(occ);
        return JSON.stringify([p, p === 'custom' ? cust[occ] || null : null]);
      }
    };
  }
  // A count, scaled: Off is none; anything else at least one when there was
  // one to scale.
  function lvCount(base, f) {
    if (!(f > 0) || !(base > 0)) return 0;
    return Math.max(1, Math.round(base * f));
  }
  // MORE OR FEWER, AND THE REST OF THE SCENE UNMOVED. A builder draws its
  // `base` elements from the scene's own rnd exactly as before -- Classic is
  // byte-for-byte the old scene, and every later builder's draws are the
  // same whatever this one's count -- keeps the first `n` of them, and draws
  // any beyond the base from a stream of its own (`extra`). `each(i, r)`
  // builds element i from r and returns it; lvRange returns the kept ones.
  function lvRange(base, n, rnd, extraSeed, each) {
    var out = [], extra = null;
    for (var i = 0; i < Math.max(base, n); i++) {
      var r = rnd;
      if (i >= base) r = extra || (extra = rng(extraSeed));
      var node = each(i, r, i < n);
      if (i < n && node) out.push(node);
    }
    return out;
  }
  // CALM WHEN NOBODY'S AROUND thins a scene by half with no rebuild: every
  // second element of a count is marked `lv-t`, and a quiet scene
  // (.lv-quiet on its root) takes those out of the render tree.
  function lvThin(nodes) {
    for (var i = 1; i < nodes.length; i += 2) if (nodes[i] && nodes[i].classList) nodes[i].classList.add('lv-t');
    return nodes;
  }

  // A CROSSING THAT COMES MORE OR LESS OFTEN, AT THE SAME SPEED. Its
  // keyframes put the crossing in the first few percent of the cycle; a
  // longer or shorter cycle with the same keyframes would crawl or race
  // across. So a scaled copy is made -- every percentage times base/new --
  // and the element runs that copy for the new cycle. Made once per root
  // and scale (a constructed sheet of its own, beside the sky's).
  var KF_ROOTS = typeof WeakMap === 'function' ? new WeakMap() : null;
  function kfText(base) {
    var css = SHEET + (typeof OWN_CSS === 'string' ? OWN_CSS : '');
    var at = css.indexOf('@keyframes ' + base + '{');
    if (at < 0) return null;
    var i = css.indexOf('{', at) + 1, depth = 1, j = i;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    return css.slice(i, j - 1);
  }
  function kfScale(body, s) {
    // selectors only: the text before each '{' at the top level of the body
    return body.replace(/(^|\})([^{}]*)\{/g, function (m, close, sel) {
      return close + sel.replace(/([0-9.]+)%/g, function (mm, p) {
        var v = Number(p);
        if (v === 0 || v === 100) return mm;
        return Math.min(99.9, v * s).toFixed(3).replace(/\.?0+$/, '') + '%';
      }) + '{';
    });
  }
  function lvKeyframes(ref, base, s) {
    if (!(s > 0) || Math.abs(s - 1) < 1e-3) return base;
    var name = base + '-x' + Math.round(s * 1000);
    try {
      var root = ref && ref.isConnected && ref.getRootNode ? ref.getRootNode() : document;
      var rec = KF_ROOTS && KF_ROOTS.get(root);
      if (!rec) {
        rec = { names: {}, sheet: null, tag: null };
        if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
          rec.sheet = new CSSStyleSheet();
          root.adoptedStyleSheets = root.adoptedStyleSheets.concat(rec.sheet);
        } else {
          rec.tag = document.createElement('style');
          (root.appendChild && root !== document ? root : document.head).appendChild(rec.tag);
        }
        if (KF_ROOTS) KF_ROOTS.set(root, rec);
      }
      if (!rec.names[name]) {
        var body = kfText(base);
        if (body === null) return base;
        rec.names[name] = 1;
        var rule = '@keyframes ' + name + '{' + kfScale(body, s) + '}';
        if (rec.sheet) rec.sheet.insertRule(rule, rec.sheet.cssRules.length);
        else rec.tag.textContent += rule;
      }
    } catch (e) { /* no stylesheet (a test harness): the name still says what was asked */ }
    return name;
  }
  // Run `el` on a crossing `base` keyframes for `baseCycle` seconds at a
  // factor of that cycle: the duration through `durVar` (or the animation
  // itself), the scaled keyframes by name. Returns the new cycle.
  // SHOW ME NOW (Sky Lab): every crosser in `el` -- a flock, the geese, the
  // witch, the sleigh, a flyby, a shooting star, a firework -- sent across at
  // once: each running crossing moved to the start of its next cycle, where
  // its crossing is. Returns how many.
  var CROSSERS = /^(near-flock|near-geese|hk-witchfly|hk-sleigh|hk-spfly|hk-spburst|hk-meteor|hk-fw)(-x[0-9]+)?$/;
  function showNow(el) {
    var n = 0;
    (function walk(node) {
      if (!node || !node.querySelectorAll) return;
      var all = node.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var anims = all[i].getAnimations ? all[i].getAnimations() : [];
        for (var j = 0; j < anims.length; j++) {
          var a = anims[j];
          if (!CROSSERS.test(a.animationName || '') || a.playState !== 'running' || !a.effect) continue;
          var t = a.effect.getComputedTiming();
          if (typeof t.progress !== 'number' || !(t.duration > 0)) continue;
          a.currentTime = a.currentTime + (1 - t.progress) * t.duration + 50;
          n++;
        }
        if (all[i].shadowRoot) walk(all[i].shadowRoot);
      }
    })(el);
    return n;
  }
  function lvCycleOn(el, ref, base, baseCycle, f, durVar) {
    var cyc = baseCycle * f;
    if (Math.abs(f - 1) < 1e-3) return baseCycle;
    var name = lvKeyframes(ref, base, baseCycle / cyc);
    el.style.animationName = name;
    if (durVar) el.style.setProperty(durVar, cyc.toFixed(1) + 's');
    else el.style.animationDuration = cyc.toFixed(1) + 's';
    return cyc;
  }

  // ------------------------------------------------------ season builders
  // Each returns nothing and appends into the .season container. They are
  // called ONLY when the season key changes (see paintSeason), never on the
  // 3s tick -- rebuilding 20 leaf elements every three seconds would be both
  // wasteful and visible, because every leaf would jump to a new position.

  function leafField(host, W, H, o, rnd) {
    var f = document.createElement('div');
    f.className = 'leaffield';
    // NO --lbri/--lsat here. They are set on .season every paint and
    // inherit, so dusk is a gradual change to a live variable rather than a
    // rebuild of the whole field at the moment elevation crosses -4.
    var base = Math.max(6, Math.round(o.count * (W / 1280)));
    var n = o.many === undefined ? base : lvCount(base, o.many);
    // (Liveliness: each leaf made from its draws as before, and kept or not
    // -- lvRange; `rnd` below is the leaf's own stream)
    lvThin(lvRange(base, n, rnd, o.seed || 7907, function (i, rnd, keep) {
      var lf = document.createElement('div');
      lf.className = 'lf';
      // TWO DEPTHS from one draw. One size range for every leaf (18-43px,
      // median 27) reads, on an 800px screen, as a fall far away. So three in
      // four are the distant field (20-46px) and one in four is NEAR,
      // 52-78px, falling faster -- nearer things cross the frame quicker --
      // so the scene has depth rather than every leaf growing. One rnd()
      // decides both, so every later draw in the scene is unaffected. The
      // sprites are 256px: sharp at 78px on a 1.5x screen.
      var u = rnd(), near = u >= 0.75;
      var size = near ? 52 + (u - 0.75) / 0.25 * 26 : 20 + Math.pow(u / 0.75, 1.3) * 26;
      lf.style.left = (rnd() * 100).toFixed(2) + '%';
      lf.style.width = size.toFixed(1) + 'px';
      lf.style.height = size.toFixed(1) + 'px';
      lf.style.setProperty('--dist', (H + 190).toFixed(0) + 'px');
      // Wind shortens the fall and widens the drift. o.wind is already
      // bucketed by the caller, so these change rarely rather than on every
      // weather update.
      var fall = (o.fallMin + rnd() * (o.fallMax - o.fallMin)) *
                 (1 - 0.01 * o.wind) * (near ? 0.8 : 1);
      lf.style.setProperty('--fd', fall.toFixed(2) + 's');
      // Negative delay: the field is already mid-fall on the first frame,
      // instead of every leaf entering from the top together.
      lf.style.setProperty('--fdel', (-rnd() * fall).toFixed(2) + 's');
      lf.style.setProperty('--sw', (20 + rnd() * 40 + o.wind).toFixed(0) + 'px');
      // Net horizontal travel, signed, so the field does not all lean one way
      // in still air but does when it blows.
      var drift = (30 + 4 * o.wind) * (rnd() * 2 - 1);
      lf.style.setProperty('--dr', drift.toFixed(0) + 'px');

      var g = document.createElement('i');
      var sp = LEAF_SPECIES[Math.floor(rnd() * LEAF_SPECIES.length) % LEAF_SPECIES.length];
      var dir = rnd() < 0.5 ? -1 : 1;
      g.style.setProperty('--z0', (rnd() * 360).toFixed(0) + 'deg');
      g.style.setProperty('--spin', dir * 360 * (rnd() < 0.35 ? 2 : 1) + 'deg');
      g.style.setProperty('--flip', 360 * (rnd() < 0.3 ? 0 : (rnd() < 0.6 ? 1 : 2)) + 'deg');
      g.style.setProperty('--tilt', dir * 360 * (rnd() < 0.3 ? 1 : 0) + 'deg');
      g.style.setProperty('--td',
        ((4 + rnd() * 7) * (1 - 0.012 * o.wind)).toFixed(2) + 's');
      g.style.setProperty('--tdel', (-rnd() * 8).toFixed(2) + 's');
      // NO hue-rotate. Randomizing hue produces olive and yellow-green leaves
      // -- hue-rotate on a red sprite walks it straight through green. The
      // three photos already carry the color range.
      g.style.setProperty('--b', (0.88 + rnd() * 0.24).toFixed(2));
      g.style.setProperty('--s', (0.86 + rnd() * 0.26).toFixed(2));
      // Jitter around 1, NOT an absolute opacity -- the scene level is --lopa,
      // inherited and rewritten every paint.
      g.style.setProperty('--a', (0.82 + rnd() * 0.36).toFixed(2));
      // Two faces, same box. The URLs are set on the TUMBLING parent so both
      // faces can read them; the filter/opacity that consume --b/--s/--a sit
      // on the faces themselves, because either property here would flatten
      // the 3D and show both sides at once.
      g.style.setProperty('--spf', 'url(' + sp[0] + ')');
      g.style.setProperty('--spb', 'url(' + sp[1] + ')');
      g.appendChild(document.createElement('u')).className = 'f';
      g.appendChild(document.createElement('u')).className = 'b';
      lf.appendChild(g);
      if (!keep) return null;
      f.appendChild(lf);
      return lf;
    }));
    host.appendChild(f);
  }

  function batField(host, W, n0, rnd, many) {
    lvThin(lvRange(n0, many === undefined ? n0 : lvCount(n0, many), rnd, 7933, function (i, rnd, keep) {
      var b = document.createElement('div');
      b.className = 'bat';
      var size = 26 + Math.pow(rnd(), 1.3) * 34;
      b.style.width = size.toFixed(0) + 'px';
      b.style.height = size.toFixed(0) + 'px';
      b.style.top = (6 + rnd() * 46).toFixed(1) + '%';
      var ltr = rnd() < 0.5;
      b.style.setProperty('--x0', (ltr ? -size - 40 : W + 40) + 'px');
      b.style.setProperty('--xd', (ltr ? W + size + 80 : -(W + size + 80)) + 'px');
      for (var k = 0; k < BAT_FRAMES.length; k++) {
        var fr = b.appendChild(document.createElement('i'));
        fr.className = 'f' + (k + 1);
        fr.style.backgroundImage = 'url(' + BAT_FRAMES[k] + ')';
      }
      b.style.setProperty('--fl', (0.30 + rnd() * 0.22).toFixed(3) + 's');
      var dur = 26 + rnd() * 26;
      b.style.setProperty('--bd', dur.toFixed(1) + 's');
      b.style.setProperty('--bdel', (-rnd() * dur).toFixed(1) + 's');
      if (!keep) return null;
      host.appendChild(b);
      return b;
    }));
  }

  // ONE builder for all seven themes. The differences are data (SURPRISE), not
  // code: seven sets of settings, one runtime.
  function surpriseScene(host, W, H, id, night, heavy, rnd, landed, occ, L) {
    var cfg = SURPRISE[id];
    if (!cfg) return;
    L = L || lvOf(null);
    occ = occ || id;

    if (cfg.frame && !landed) {
      var f = document.createElement('div');
      f.className = 'sp-frame';
      f.style.setProperty('--spf', 'url(' + BASE + cfg.frame + ')');
      host.appendChild(f);
    }

    // Heavy precipitation thins the ornamental particles right down. It never
    // touches the actual weather decks -- this is decoration standing aside,
    // not a forecast being edited.
    var n = Math.max(3, Math.round((heavy ? Math.min(4, cfg.count) : cfg.count) *
                                   (W / 1280)));
    var CONF = ['#e7c986', '#eaa5b9', '#a5d7df', '#c2addf'];
    // Liveliness: petals are Petals (spring), the rest the occasion's Particles
    var pk = cfg.part === 'petal' ? 'petals' : 'particles';
    lvThin(lvRange(n, lvCount(n, L.many(occ, pk)), rnd, 7949, function (i, rnd, keep) {
      var p = document.createElement('div');
      p.className = 'sp-fall';
      var size = cfg.kind === 'sparkle' ? 2 + rnd() * 3 : 8 + rnd() * 12;
      p.style.left = (rnd() * 100).toFixed(2) + '%';
      p.style.width = size.toFixed(1) + 'px';
      p.style.height = size.toFixed(1) + 'px';
      p.style.setProperty('--dist', (H + 140).toFixed(0) + 'px');
      var fall = 23 + rnd() * 17;
      p.style.setProperty('--fd', fall.toFixed(1) + 's');
      p.style.setProperty('--fdel', (-rnd() * fall).toFixed(1) + 's');
      p.style.setProperty('--sw', (10 + rnd() * 30).toFixed(0) + 'px');
      p.style.setProperty('--dr', (-60 + rnd() * 120).toFixed(0) + 'px');

      var g = document.createElement('i');
      if (cfg.part) {
        g.className = 'tex';
        g.style.setProperty('--sp', 'url(' + SP_ASSET[cfg.part] + ')');
      } else if (cfg.kind === 'confetti') {
        g.className = 'conf';
        g.style.setProperty('--cc', CONF[i % CONF.length]);
      } else {
        g.className = 'dot';
      }
      // Sparkles read better against a dark sky, everything else against a
      // light one -- the same inversion the reference design uses.
      g.style.setProperty('--pa', (cfg.kind === 'sparkle'
        ? (night ? 0.55 : 0.35) : (night ? 0.28 : 0.62)).toFixed(2));
      g.style.setProperty('--sd', (6 + rnd() * 9).toFixed(1) + 's');
      g.style.setProperty('--sdel', (-rnd() * 12).toFixed(1) + 's');
      p.appendChild(g);
      if (!keep) return null;
      host.appendChild(p);
      return p;
    }));

    // The flyby, and its day/night gate. Fireworks only after dark; the spring
    // butterfly only by day. Gating at BUILD time rather than at runtime is
    // what keeps this to zero timers -- `night` is in the season key, so
    // crossing dusk rebuilds the scene and the gate re-evaluates.
    if (!cfg.event) return;
    if (cfg.event === 'firework' && !night) return;
    if (cfg.event === 'butterfly' && night) return;

    var e = document.createElement('div');
    e.style.setProperty('--spe', 'url(' + SP_ASSET[cfg.event] + ')');
    // 210s of which the crossing is 7% -- about 15s, then parked. Rare on
    // purpose: a flyby you see every minute stops being a surprise.
    // (Liveliness: the firework is Fireworks, the rest the Flyby; the draws
    // below are made whether it comes or not, for the builders after it)
    var fc = L.cycle(occ, cfg.event === 'firework' ? 'fireworks' : 'flyby');
    e.style.setProperty('--fd', '210s');
    e.style.setProperty('--fdel', (5 + rnd() * 40).toFixed(1) + 's');
    if (cfg.event === 'firework') {
      e.className = 'sp-burst';
      var bs = Math.round(Math.min(W, H) * 0.17);
      e.style.width = bs + 'px';
      e.style.height = bs + 'px';
      e.style.left = (58 + rnd() * 22).toFixed(1) + '%';
      e.style.top = (4 + rnd() * 10).toFixed(1) + '%';
    } else {
      e.className = 'sp-fly';
      var w = cfg.event === 'rocket' ? 88 : cfg.event === 'fairy' ? 30 : 34;
      e.style.width = w + 'px';
      e.style.height = Math.round(w * (cfg.event === 'rocket' ? 0.5 : 1)) + 'px';
      e.style.top = (10 + rnd() * 12).toFixed(1) + '%';
      e.style.setProperty('--x0', (-w - 120) + 'px');
      e.style.setProperty('--xd', (W + w + 260).toFixed(0) + 'px');
    }
    if (!fc) return;
    if (fc !== 1) lvCycleOn(e, host, cfg.event === 'firework' ? 'hk-spburst' : 'hk-spfly', 210, fc, '--fd');
    host.appendChild(e);
  }

  function canopyLayer(host) {
    var d = document.createElement('div');
    d.className = 'canopy';
    host.appendChild(d);
  }

  function branchLayer(host) {
    // One element, no randomization: the art is a single composed frame that
    // already reaches in from all four edges. Nothing to pick and nothing to
    // mirror -- a mirrored full-frame branch reads as mirrored immediately.
    var d = document.createElement('div');
    d.className = 'branches';
    host.appendChild(d);
  }

  function cobweb(host, W) {
    var d = document.createElement('div');
    d.className = 'cobweb';
    var w = Math.round(W * 0.13);
    d.style.width = w + 'px';
    d.style.height = w + 'px';
    host.appendChild(d);
  }

  function fogWisps(host, rnd, on) {
    // TWO instances, not three: each is a real texture rather than a
    // gradient, and a third only buys haze .gfog already supplies.
    // (`on` false -- Liveliness: Mist Off -- draws them and keeps none.)
    for (var i = 0; i < 2; i++) {
      var w = document.createElement('div');
      w.className = 'fwisp';
      var wide = 110 + rnd() * 30;                 // 110-140% of the viewport
      w.style.width = wide.toFixed(0) + '%';
      w.style.height = (20 + rnd() * 10).toFixed(0) + '%';
      w.style.left = '0';
      w.style.bottom = (rnd() * 16).toFixed(0) + '%';
      // Drift is exactly the overhang, so neither end ever brings the
      // texture's own edge inside the viewport.
      var over = wide - 100;
      w.style.setProperty('--wa', '0px');
      w.style.setProperty('--wb', (-over).toFixed(1) + '%');
      w.style.setProperty('--wt', (85 + rnd() * 28).toFixed(0) + 's');
      w.style.setProperty('--wdel', (-rnd() * 90).toFixed(0) + 's');
      w.style.setProperty('--wo', (0.09 + rnd() * 0.09).toFixed(2));
      if (on !== false) host.appendChild(w);
    }
  }

  // Where the witch flies, from the RESOLVED moon: its box size and its center
  // as fractions of the viewport, the same numbers paint() drew it with. Pure,
  // so the geometry is testable (hkSky._witchPath).
  //
  // Sized off the visible DISC, not the moon's box (which carries its halo) and
  // not the viewport: broom tip to bristles is WITCH_SPAN of the disc.
  //
  // Right to left, because she faces left. She fades in just clear of the
  // disc's right edge and out just clear of its left, both INSIDE the viewport
  // (never clipped by it), across the upper disc (WITCH_LINE), drifting down by 3%
  // of the distance flown -- mostly horizontal. A viewport too narrow for that
  // (a phone) keeps the margins and simply flies a shorter line.
  function witchPath(W, H, moonS, moonXf, moonYf) {
    var disc = moonS * MOON_DISC;
    var w = Math.round(disc * WITCH_SPAN / WITCH_INK);
    var h = Math.round(w / 2);
    var cx = W * moonXf, cy = H * moonYf + disc * WITCH_LINE, gap = 8, m = 16;
    var x0 = Math.min(cx + disc / 2 + gap, W - w - m);
    var x1 = Math.max(cx - disc / 2 - gap - w, m);
    var drift = (x0 - x1) * 0.03;
    var y0 = clamp(cy - h / 2 - drift / 2, m, H - h - m);
    var y1 = clamp(cy - h / 2 + drift / 2, m, H - h - m);
    return { w: w, h: h, left: Math.round(x0), top: Math.round(y0),
             dx: Math.round(x1 - x0), dy: Math.round(y1 - y0) };
  }

  function witchFly(host, W, H, moonS, moonXf, moonYf, rnd, cf) {
    var p = witchPath(W, H, moonS, moonXf, moonYf);
    var w = document.createElement('div');
    w.className = 'witch';
    w.style.width = p.w + 'px';
    w.style.height = p.h + 'px';
    w.style.left = p.left + 'px';
    w.style.top = p.top + 'px';
    w.style.setProperty('--wdx', p.dx + 'px');
    w.style.setProperty('--wdy', p.dy + 'px');
    // NOT RIGHT AFTER A LOAD. A negative delay starts the cycle part-way
    // through its invisible stretch, so the first flight comes 45-120s of
    // visible time after the scene is built -- and after a return from a static
    // page, which restarts the animation from the same point. A short
    // positive delay would put her across the moon within seconds of every
    // reload.
    var wait = 45 + rnd() * 75;
    // Liveliness (how often): a longer or shorter cycle, the flight itself the
    // same speed; Off builds no witch (her draw above is made either way)
    if (cf === 0) return;
    var cyc = cf && cf !== 1 ? lvCycleOn(w, host, 'hk-witchfly', WITCH_CYCLE, cf) : WITCH_CYCLE;
    w.style.setProperty('--wdel', (-(cyc - wait)).toFixed(1) + 's');
    host.appendChild(w);
  }

  function cozyWindow(host, W, H, rnd, snowOK, landed, moon, occ, L) {
    L = L || lvOf(null);
    occ = occ || 'christmas';
    // Order matters and mirrors the delivered layering: decoration, then the
    // halos on its bulbs, then snow in front of both, then the flyby. Over a
    // landscape (`landed`) the garland and its halos stand aside: the land's
    // own trees carry the lights.
    if (!landed) {
      var d = document.createElement('div');
      d.className = 'xdecor';
      host.appendChild(d);

      // On a narrow screen the decoration is its two edges at true shape (see
      // .narrow): a bulb sits where ITS edge of the art now is, and one in the
      // art's hidden middle -- or in the edge's fade, where the garland it
      // belongs to is dissolving -- is not drawn at all.
      var art = FRAME_ASPECT * H;                 // the art's width, fitted to H
      var solid = W * NARROW_HALF * NARROW_SOLID; // how far in each edge is solid
      BULBS.forEach(function (b) {
        var x;
        if (W < H) {
          x = b[0] < 0.5 ? b[0] * art : W - (1 - b[0]) * art;
          if (b[0] < 0.5 ? x > solid : x < W - solid) return;
        }
        var l = document.createElement('div');
        l.className = 'xlight';
        l.style.left = W < H ? x.toFixed(1) + 'px' : (b[0] * 100).toFixed(2) + '%';
        l.style.top = (b[1] * 100).toFixed(2) + '%';
        // 7-14s, each with its own negative phase, so no two peak together.
        l.style.setProperty('--td', (7 + rnd() * 7).toFixed(1) + 's');
        l.style.setProperty('--tdel', (-rnd() * 14).toFixed(1) + 's');
        host.appendChild(l);
      });
    }

    // Decorative snow is NOT a forecast. When it is genuinely snowing the
    // weather deck is already running, and adding this on top reads as a
    // doubled blizzard -- so it stands down rather than competing.
    if (snowOK) {
      var n = Math.max(8, Math.round(28 * (W / 1280)));
      lvThin(lvRange(n, lvCount(n, L.many(occ, 'snow')), rnd, 7951, function (i, rnd, keep) {
        var f = document.createElement('div');
        f.className = 'xflake';
        // Biased small: mostly 3-6px specks with the occasional real crystal,
        // which is what keeps it from looking like a field of snowflake icons.
        var size = 3 + Math.pow(rnd(), 1.7) * 7;
        f.style.left = (rnd() * 100).toFixed(2) + '%';
        f.style.width = size.toFixed(1) + 'px';
        f.style.height = size.toFixed(1) + 'px';
        f.style.opacity = (0.2 + rnd() * 0.4).toFixed(2);
        f.style.setProperty('--dist', (H + 110).toFixed(0) + 'px');
        var fall = 21 + rnd() * 22;
        f.style.setProperty('--fd', fall.toFixed(1) + 's');
        f.style.setProperty('--fdel', (-rnd() * fall).toFixed(1) + 's');
        f.style.setProperty('--sw', (8 + rnd() * 24).toFixed(0) + 'px');
        f.style.setProperty('--dr', (-45 + rnd() * 90).toFixed(0) + 'px');
        var g = document.createElement('i');
        g.style.setProperty('--sp', 'url(' + SNOW_SPRITES[i % 3] + ')');
        g.style.setProperty('--sd', (9 + rnd() * 15).toFixed(1) + 's');
        g.style.setProperty('--sdel', (-rnd() * 12).toFixed(1) + 's');
        g.style.setProperty('--turn', (rnd() < 0.5 ? -360 : 360) + 'deg');
        f.appendChild(g);
        if (!keep) return null;
        host.appendChild(f);
        return f;
      }));
    }

    var sl = document.createElement('div');
    sl.className = 'sleigh';
    var sw = 180 + rnd() * 50, top = 14 + rnd() * 4;
    if (moon) {
      // ACROSS THE MOON: three-quarters of its disc wide, its runners a
      // little above the middle of the face
      var disc = moon.s * MOON_DISC;
      sw = disc * 0.75;
      sl.style.top = Math.round(H * moon.y - sw / 3 / 2 - disc * 0.1) + 'px';
    } else {
      sl.style.top = top.toFixed(1) + '%';
    }
    sl.style.width = sw.toFixed(0) + 'px';
    sl.style.setProperty('--x0', (W + 240).toFixed(0) + 'px');
    sl.style.setProperty('--xd', (-(W + sw + 480)).toFixed(0) + 'px');
    // 200s of which the crossing is 7% -- about 14s, then parked off-left.
    // Rare on purpose: a sleigh you see every minute is wallpaper.
    sl.style.setProperty('--fd', '200s');
    // Positive, and staggered, so several wall tablets do not fly him in unison
    // and he is not already mid-flight on the first frame.
    sl.style.setProperty('--fdel', (6 + rnd() * 26).toFixed(1) + 's');
    // Liveliness (how often): Off, no sleigh; otherwise his cycle scaled
    var sc = L.cycle(occ, 'sleigh');
    if (!sc) return;
    if (sc !== 1) lvCycleOn(sl, host, 'hk-sleigh', 200, sc, '--fd');
    host.appendChild(sl);
  }

  // ------------------------------------------------------------- seasons
  // The season comes from hkSettings.seasonName(): the holiday sensor chosen
  // in Configure (a SEASON sensor, not a day-of one), or with none chosen the
  // same windows computed from the date:
  //   Halloween     Sep 22 - Oct 31
  //   Thanksgiving  Nov 1  - Thanksgiving Day
  //   Christmas     the day after - Dec 25
  // so there is no date arithmetic here at all.
  function seasonOf(client) {
    if (!client) return '';
    var HS = window.hkSettings;
    if (!HS || !HS.seasonalOn(client.states)) return '';
    var v = HS.seasonName(client.states);
    // A season turned off in Configure -> Seasonal sky draws nothing.
    if (HS.themeOn && !HS.themeOn(String(v).toLowerCase())) return '';
    if (v === 'Halloween') return 'halloween';
    if (v === 'Thanksgiving') return 'thanksgiving';
    if (v === 'Christmas') return 'christmas';
    return '';
  }

  // --------------------------------------------------------- the schedule
  // NOT EVERY DAY. Decoration that is simply on for the whole season stops
  // being noticed about a week in -- and the garland is the worst of it,
  // because the holiday season calls it Christmas from Thanksgiving, a solid
  // month. So each season rolls a die per day, and the odds RAMP as the
  // holiday approaches: rare and a nice surprise early, near-certain by the
  // end, and guaranteed on the day itself.
  //
  // `within` is how many days before the holiday the season is eligible AT
  // ALL. It is what keeps the garland out of early December rather than a
  // second set of dates: Christmas is eligible from the 7th, so the last ~18
  // days rather than the last ~30.
  //
  // WHERE THE DATES LIVE. A chosen holiday sensor owns which season it is, and
  // other automations (holiday lighting, say) may read that same sensor -- so
  // the window is NOT narrowed there. What is owned here is only how often
  // the SKY dresses up inside a season already declared.
  // WHEN is Configure -> Seasonal sky -> Season dates (hkSettings.skyWindow:
  // built in Halloween 09-22..10-31, Thanksgiving 11-01..US Thanksgiving,
  // Christmas 12-07..12-25), and HOW OFTEN is that page's choice per season:
  //   sometimes  (built in) a daily die whose odds ramp from pFar at the
  //              window's first day to pNear `always` days before its last,
  //              and every one of the last `always` days;
  //   every_day  every day of the window;
  //   near_end   only the last `always` days.
  // The ramp runs over the window itself, so custom dates need nothing else;
  // with the built-in dates it gives exactly the days of a fixed per-season
  // table (checked day by day over three years).
  var SCHEDULE = {
    halloween:    { pFar: 0.45, pNear: 0.90, always: 3 },
    thanksgiving: { pFar: 0.35, pNear: 0.85, always: 1 },
    christmas:    { pFar: 0.30, pNear: 0.90, always: 3 }
  };
  // The spooky night extras -- branches, bats, the witch, the big moon -- roll
  // SEPARATELY and more rarely than the leaves. Leaves are ambience; a witch
  // crossing the moon should be something you catch, not the wallpaper.
  var SPOOKY = { pFar: 0.30, pNear: 0.85, always: 3 };

  // Local calendar day as YYYYMMDD. NOT Math.floor(Date.now()/864e5), which is
  // the UTC day and therefore rolls over at 8pm local -- the field would have
  // rebuilt itself in front of you every evening, mid-Halloween.
  function dayKey(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  // A stable [0,1) from a day and a salt: the same answer all day, on every
  // screen, and a different one tomorrow.
  function roll(d, salt) {
    var n = (dayKey(d) ^ Math.imul(salt, 0x9E3779B1)) >>> 0;
    n = Math.imul(n ^ n >>> 15, 0x85EBCA6B) >>> 0;
    n = Math.imul(n ^ n >>> 13, 0xC2B2AE35) >>> 0;
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
  }

  // The season's window today (hkSettings.skyWindow), or a closed one.
  function windowOf(name, d) {
    var HS = window.hkSettings;
    return (HS && HS.skyWindow) ? HS.skyWindow(name, d) : { inside: false, daysToEnd: -1, length: 0 };
  }
  // Whole days from `d` to the last day of the season's window; -1 outside it.
  function daysUntil(name, d) { return windowOf(name, d).daysToEnd; }

  // Does the sky dress up today, and if so does tonight get the spooky set?
  // ------------------------------------------------------ the surprises
  // Seven occasional themes. They are SURPRISES, not decoration: most days
  // none of them fire at all.
  //
  // ONE SELECTOR AND ONE ENGINE -- not seven schedulers and not seven
  // animation engines. This is a port of the themes' shared schedule.js;
  // tests/test_surprise.js mirrors its assertions, so the port is checked
  // rather than assumed.
  // The household's birthdays: Configure -> Seasonal sky, as
  // [{name, month, day}]. Read per call so an edit applies the same day.
  function birthdays() {
    var HS = window.hkSettings;
    var b = HS ? HS.get('sky.birthdays', []) : [];
    return Array.isArray(b) ? b : [];
  }

  // Deterministic per LOCAL calendar day, so every screen agrees and a
  // refresh, a navigation or a weather update never re-rolls. Same shape as
  // roll() above and for the same reason.
  function sHash(date, salt) {
    var n = (date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 +
             date.getDate()) ^ salt;
    n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  // ONE DAY PER CALENDAR MONTH, not a daily probability.
  //
  // As 1.5% and 1% daily rolls these two would give an expected 5.5 and 3.6
  // days a year -- but a coin flip that rare CLUMPS, and the salt used here
  // produces ZERO space nights in some whole years. A
  // theme you might not see for two years is not a surprise, it is a bug that
  // looks like one. So the day is picked, deterministically, from the month.
  //
  // Hashed off the FIRST of the month so every day in that month computes the
  // same answer, and clamped to the real month length so February works.
  function monthlyDay(date, salt) {
    var y = date.getFullYear(), m = date.getMonth() + 1;
    var dim = new Date(y, m, 0).getDate();
    return 1 + Math.floor(sHash(new Date(y, m - 1, 1), salt) * dim);
  }

  // Space night takes its own day, and steps aside by one if it drew the same
  // day as storybook -- otherwise a collision costs a whole month, because
  // storybook is checked first and would simply win.
  function spaceDay(date) {
    var mine = monthlyDay(date, 991);
    if (mine !== monthlyDay(date, 731)) return mine;
    var dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return (mine % dim) + 1;
  }

  // N DAYS A MONTH (Configure -> Seasonal sky: once, twice or four times).
  // The first is exactly monthlyDay's; each further one comes from its own
  // salt, stepping past days already taken, so the days are distinct and the
  // built-in once-a-month day never moves.
  function monthlyDays(date, salt, n, taken) {
    var dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    var out = [], busy = (taken || []).slice();
    for (var k = 0; k < n && out.length < dim; k++) {
      var day = monthlyDay(date, salt + k * 7919);
      while (busy.indexOf(day) !== -1) day = (day % dim) + 1;
      out.push(day); busy.push(day);
    }
    return out;
  }
  // Space night's days: once a month is spaceDay() exactly; more are drawn
  // like the storybook's, never on one of storybook's days.
  function spaceDays(date, story, n) {
    var dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    var first = spaceDay(date);                 // clear of storybook's first day
    while (story.indexOf(first) !== -1 && story.length < dim) first = (first % dim) + 1;
    if (n <= 1) return [first];
    return [first].concat(monthlyDays(date, 991 + 7919, n - 1, story.concat([first])));
  }

  var ALL_SURPRISES = ['storybook-magic', 'spring-garden', 'fourth-of-july',
                       'birthday', 'winter-wonderland', 'valentines-day',
                       'space-night'];

  // One table, seven themes. `a` and `l` are the frame's measured mean alpha
  // and ink luma, from dwebp -pam on the ENCODED webp -- same basis as SEASON
  // above, so the cap arithmetic describes what the page actually loads.
  //
  // The frames are BORDERS with open centers, which is why the coverage is so
  // much lower than the full-bleed seasonal art: the busiest, Valentine's, is
  // 0.090 against the Christmas decoration's 0.105 and the canopy's 0.084.
  //
  // `event` is a RARE flyby, built as a long-cycle CSS animation that parks the
  // element off-screen for most of the cycle -- the same shape as the witch and
  // the sleigh. Driving these from requestAnimationFrame and WAAPI would add a
  // second animation engine and a timer per theme.
  var SP_ASSET = {
    petal:     BASE + 'sp-petal.webp',
    heart:     BASE + 'sp-heart.webp',
    crystal:   BASE + 'sp-crystal.webp',
    firework:  BASE + 'sp-firework.webp',
    rocket:    BASE + 'sp-rocket.webp',
    butterfly: BASE + 'sp-butterfly.webp',
    fairy:     BASE + 'sp-fairy.webp'
  };
  // Particle mean alpha / ink luma, for the estimate. Sparkle and confetti are
  // drawn in CSS and carry no texture.
  var SP_PART = {
    petal:   { a: 0.286, l: 180 },
    heart:   { a: 0.445, l: 173 },
    crystal: { a: 0.290, l: 198 },
    sparkle: { a: 0.600, l: 244 },   // a CSS dot: small, bright, opaque
    confetti:{ a: 1.000, l: 200 }    // a CSS rectangle
  };
  var SURPRISE = {
    'birthday':          { frame: 'sp-birthday.webp',   a: 0.0775, l: 163,
                           kind: 'confetti', part: null,      count: 14, event: null },
    'fourth-of-july':    { frame: 'sp-july4.webp',      a: 0.0296, l: 94,
                           kind: 'sparkle',  part: null,      count: 5,  event: 'firework' },
    'space-night':       { frame: null,                 a: 0,      l: 0,
                           kind: 'sparkle',  part: null,      count: 7,  event: 'rocket' },
    'spring-garden':     { frame: 'sp-spring.webp',     a: 0.0714, l: 160,
                           kind: 'petal',    part: 'petal',   count: 12, event: 'butterfly' },
    'storybook-magic':   { frame: 'sp-storybook.webp',  a: 0.0496, l: 88,
                           kind: 'sparkle',  part: null,      count: 10, event: 'fairy' },
    'valentines-day':    { frame: 'sp-valentines.webp', a: 0.0899, l: 172,
                           kind: 'petal',    part: 'heart',   count: 10, event: null },
    'winter-wonderland': { frame: 'sp-winter.webp',     a: 0.0584, l: 167,
                           kind: 'crystal',  part: 'crystal', count: 8,  event: null }
  };
  // Which themes are installed. All seven; the selector only picks from this.
  var INSTALLED = ALL_SURPRISES;

  // Returns null, or {id, reason, person?}. `existingActive` is the season
  // already eligible today -- pass it ONLY when its own plan.show is true, not
  // merely because the sensor says Christmas, or a surprise would lose to a
  // season that was not going to draw anything anyway.
  function surpriseFor(date, o) {
    o = o || {};
    if (o.skyEnabled === false || o.seasonalEnabled === false) return null;
    var HS = window.hkSettings;
    var enabled = (o.enabled || ALL_SURPRISES).filter(function (id) {
      return !HS || !HS.themeOn || HS.themeOn(id);
    });
    // SOUTHERN HEMISPHERE: spring and winter are six months away.
    var south = (o.hemisphere || (HS ? HS.get('sky.hemisphere', 'north') : 'north')) === 'south';
    function on(id) { return enabled.indexOf(id) !== -1; }
    var m = date.getMonth() + 1, d = date.getDate(), md = m * 100 + d;

    var BIRTHDAYS = o.birthdays || birthdays();
    for (var i = 0; i < BIRTHDAYS.length; i++) {
      var b = BIRTHDAYS[i];
      if (b.month === m && b.day === d && on('birthday')) {
        // Deliberately an override: a 16 December birthday replaces the
        // Christmas DECORATION for the day. Not any automation, not the
        // sensor, not the weather. Normal scheduling resumes tomorrow.
        return { id: 'birthday', person: b.name, reason: 'birthday' };
      }
    }
    // WHEN and HOW OFTEN: Configure -> Seasonal sky -> Surprise dates
    // (hkSettings.skyWindow / often). Built in: the weeks Jun 28..Jul 4 and
    // Feb 8..14, spring Mar 20..Jun 20 and winter Dec 21..Mar 19 (southern:
    // six months on), storybook and space night once a month.
    function inside(key) {
      if (HS && HS.skyWindow) return HS.skyWindow(key, date).inside;
      var W = { july4: [628, 704], valentines: [208, 214],
                spring: south ? [922, 1220] : [320, 620],
                winter: south ? [621, 921] : [1221, 319] }[key];
      return W[0] <= W[1] ? (md >= W[0] && md <= W[1]) : (md >= W[0] || md <= W[1]);
    }
    function odds(key, base) {
      var how = HS && HS.often ? HS.often(key, 'sometimes') : 'sometimes';
      return base * ({ often: 2, sometimes: 1, rarely: 0.5 }[how] || 1);
    }
    function perMonth(key) {
      var n = Number(HS && HS.often ? HS.often(key, '1') : '1');
      return n > 0 ? n : 1;
    }
    if (inside('july4') && on('fourth-of-july'))
      return { id: 'fourth-of-july', reason: 'holiday-week' };
    if (inside('valentines') && on('valentines-day'))
      return { id: 'valentines-day', reason: 'holiday-week' };
    // The existing seasonal work wins over the ambient surprises below.
    if (o.existingActive) return { id: o.existingActive, reason: 'existing-season' };
    if (inside('spring') && on('spring-garden') && sHash(date, 320) < odds('spring_often', 0.14))
      return { id: 'spring-garden', reason: 'seasonal-surprise' };
    if (inside('winter') && on('winter-wonderland') && sHash(date, 1221) < odds('winter_often', 0.12))
      return { id: 'winter-wonderland', reason: 'seasonal-surprise' };
    var story = monthlyDays(date, 731, perMonth('storybook_per_month'));
    if (on('storybook-magic') && story.indexOf(d) !== -1)
      return { id: 'storybook-magic', reason: 'monthly-surprise' };
    if (on('space-night') && spaceDays(date, story, perMonth('space_per_month')).indexOf(d) !== -1)
      return { id: 'space-night', reason: 'monthly-surprise' };
    return null;
  }

  // DEV OVERRIDE. Null in normal operation. Set through hkSky._force() to
  // preview a season outside its window -- otherwise verifying Halloween in
  // September means editing SCHEDULE and remembering to put it back, which is
  // exactly the kind of temporary edit that gets left in.
  var FORCE = null;
  function plannedFor(name, d) { return FORCE || schedule(name, d); }

  // See read(). Set through hkSky._pin().
  var PIN = null;

  // DEV OVERRIDE for the surprises. Null in normal operation, like FORCE and
  // PIN. It exists because six of the seven themes fire on a handful of days a
  // year -- Space Night can go a whole year without one -- so there is no way
  // to look at them otherwise. It is not a preview control that bypasses the
  // schedule in normal use: nothing sets this but a console call.
  var SURPRISE_FORCE = null;

  // THE SETTINGS PAGE'S PREVIEW (HK Settings -> Sky, and each theme's page):
  // one theme whatever the date, in THIS window only -- the page's preview
  // frame, never a real screen. preview(id, when): id is a theme
  // (hk-settings-model.js SKY_THEMES) or null for today's own sky; when is
  // 'day', 'night' or 'spooky' (Halloween's big moon, fog, bats and witch).
  // The weather is held clear and still, so the theme is what shows -- not
  // tonight's rain over it. The three SEASONS go through FORCE and PIN; the
  // rest are surprises, through SURPRISE_FORCE.
  var PREVIEW = null;
  var PREVIEW_SEASONS = { halloween: 1, thanksgiving: 1, christmas: 1 };
  function preview(id, when) {
    FORCE = null; PIN = null; SURPRISE_FORCE = null; PREVIEW = null;
    if (id) {
      var night = when === 'night' || when === 'spooky';
      var sky = { elev: night ? -25 : 35, azim: night ? 200 : 180, cover: 0.1, wind: 6,
                  cond: night ? 'clear-night' : 'sunny', fog: false, wet: { kind: 'none', rate: 0 },
                  moon: 0.5, seasonalOn: true,
                  // and Decorations on: paint()'s spooky moon and the woodland
                  // test s.decorations, and the preview has to work with the
                  // switch off -- choosing what to switch on is its point.
                  decorations: true };
      if (PREVIEW_SEASONS[id]) {
        FORCE = { season: id, show: true, spooky: when === 'spooky', days: 0, p: 1 };
        sky.season = id;
      } else {
        SURPRISE_FORCE = id;
        sky.season = '';
      }
      PIN = sky;
      PREVIEW = { id: id, when: when || 'day' };
    }
    try { stateTick(); } catch (e) { /* not mounted yet: the next tick paints it */ }
    return PREVIEW;
  }

  // Exported as hkSky._schedule for the test suite and the console.
  function schedule(name, d) {
    d = d || new Date();
    var out = { season: name, show: false, spooky: false, days: 0, p: 0 };
    var cfg = SCHEDULE[name];
    if (!name || !cfg) return out;
    var w = windowOf(name, d);
    var days = out.days = w.daysToEnd;
    if (!w.inside) return out;                 // outside the season's dates
    var HS = window.hkSettings;
    var how = (HS && HS.often) ? HS.often(name + '_often', 'sometimes') : 'sometimes';
    var span = w.length;                       // the ramp runs over the window
    if (days <= cfg.always || how === 'every_day') {
      out.show = true; out.p = 1;
    } else if (how === 'near_end') {
      return out;
    } else {
      // Linear ramp from pFar at the window's first day to pNear at `always`.
      var t = (span - days) / Math.max(1, span - cfg.always);
      out.p = cfg.pFar + (cfg.pNear - cfg.pFar) * clamp(t, 0, 1);
      out.show = roll(d, 1) < out.p;
    }
    if (out.show && name === 'halloween') {
      // SPOOKY NIGHTS, Configure -> Seasonal sky: Sometimes (built in: its own
      // rarer die, and the last 3 nights), Every night, or Never -- leaves
      // without the bats and the witch.
      var spookyHow = (HS && HS.often) ? HS.often('spooky_often', 'sometimes') : 'sometimes';
      if (spookyHow === 'never') out.spooky = false;
      else if (spookyHow === 'every_night' || days <= SPOOKY.always) out.spooky = true;
      else {
        var st = (span - days) / Math.max(1, span - SPOOKY.always);
        out.spooky = roll(d, 2) <
          SPOOKY.pFar + (SPOOKY.pNear - SPOOKY.pFar) * clamp(st, 0, 1);
      }
    }
    return out;
  }

  // ---- New Decorations (Decoration Style 'new', 2026-10-04)
  // Close woodland art -- frontend/sky/near/, written by tools/sky/near_webp.py
  // -- for the themes NEAR_HOLIDAY / NEAR_SURPRISE map; anything else keeps
  // the original renderer (paintSeason, below).
  //
  // NEAR_LIGHT: each theme's [mean alpha, alpha-weighted Rec.709 luma],
  // measured from the source art. near_webp.py writes the same pair to
  // near/manifest.json and its --check fails until this table agrees. The
  // luminance cap reads it, scaled by the scene's live brightness.
  var NEAR_LIGHT = {
    halloween: [0.675, 41.69], christmas: [0.6173, 115.01], fall: [0.6487, 56.92],
    summer: [0.6395, 86.85], july4: [0.6805, 65.61], spring: [0.6622, 93.34],
    winter: [0.6677, 119.19], birthday: [0.6884, 75.27]
  };
  var NEAR_HOLIDAY = { christmas: 'christmas', thanksgiving: 'fall', halloween: 'halloween' };
  var NEAR_SURPRISE = { 'spring-garden': 'spring', 'winter-wonderland': 'winter',
                        'fourth-of-july': 'july4', birthday: 'birthday' };
  // On a day with neither, the land's own season -- if Sky / Background ->
  // Woodland Between Occasions has it (sky.woodland; every season unless
  // set). Its own setting since 2026-10-04: summer's woodland was the Fourth
  // of July's Show, autumn's Thanksgiving's, so leaving out a holiday took a
  // whole season's scenery with it.
  function woodlandOn(season) {
    var hs = window.hkSettings, list = hs && hs.get ? hs.get('sky.woodland', null) : null;
    return !Array.isArray(list) || list.indexOf(season) >= 0;
  }
  // Each theme's ground wash, under the valley.
  var NEAR_GROUND = { christmas: '#8793a7', winter: '#8793a7', spring: '#4b5136',
                      summer: '#263327', birthday: '#263327', july4: '#263327' };
  // Lamps, as fractions of the art (x, y): the birthday's run along the cafe
  // wire, whose curve update() follows. Christmas's are the art's own bulbs,
  // lit (NEAR_PATCHES); Halloween's candles too.
  var NEAR_LAMPS = {
    birthday: [[.326, .08], [.371, .097], [.414, .11], [.487, .122], [.54, .113],
               [.587, .097], [.658, .076], [.695, .049]],
    summer: [[.022, .106], [.091, .087], [.152, .058], [.091, .163], [.13, .197],
             [.213, .233], [.27, .177], [.27, .261], [.686, .19], [.734, .21],
             [.881, .15], [.802, .273], [.879, .248]],
    july4: [[.048, .042], [.141, .126], [.042, .176], [.777, .026], [.836, .092],
            [.99, .133]]
  };
  // These masks retain canopy, trunks, roots and props only. Distant hills
  // must come from one landscape projection, never the differently sized
  // left/right frames. Feather the foreground edge rather than its horizon.
  // Each path runs 48 px PAST the art's outer edges (and the gradient is in
  // the art's own units, so its fade still starts where it did): the mask is
  // blurred, and a shape that stopped at the edge would be blurred there too,
  // leaving the trees see-through along the screen's sides and top -- a pale
  // band of sky down every edge of the dashboard.
  var NEAR_TREE_MASKS = {
    left: 'M-48 -48 H800 V0 L650 190 L420 335 L146 400 L146 565 L310 665 L390 755 L510 850 L540 992 H-48Z',
    right: 'M1634 -48 H786 V0 L936 190 L1166 335 L1440 400 L1440 565 L1276 665 L1196 755 L1076 850 L1046 992 H1634Z'
  };
  // THE LIGHTING ART as patches (tools/sky/near_webp.py; delivery notes in
  // tools/sky/src/near/lighting-artwork-v1.md): [kind, x, y, w, h] in the
  // art's pixels, each kind's files numbered in this order --
  //   lantern   <theme>-lantern-N-v1.webp, hung in the trees, and its lit
  //             twin <theme>-lantern-lit-N-v1.webp over it after dark
  //   pumpkin   <theme>-pumpkin-lit-N-v1.webp: lit ground pumpkins and spill
  //   bulb      <theme>-bulb-lit-N-v1.webp: one lit bulb and its halo
  //   front     <theme>-front-N-v1.webp: the scene's own rock and presents,
  //             over the birthday balloons, which rise from behind them
  // near_webp.py --check fails until this agrees with manifest.json.
  var NEAR_PATCHES = {
    halloween: [
      ['lantern', 344, 48, 64, 160],
      ['lantern', 200, 112, 80, 136],
      ['lantern', 1280, 120, 64, 112],
      ['lantern', 1336, 256, 80, 112],
      ['pumpkin', 0, 672, 384, 152],
      ['pumpkin', 1352, 728, 234, 136]
    ],
    christmas: [
      ['bulb', 122, 58, 44, 44],
      ['bulb', 150, 78, 44, 44],
      ['bulb', 182, 154, 44, 44],
      ['bulb', 78, 222, 44, 44],
      ['bulb', 138, 238, 44, 44],
      ['bulb', 46, 462, 44, 44],
      ['bulb', 1406, 162, 44, 44],
      ['bulb', 1414, 194, 44, 44],
      ['bulb', 1466, 286, 44, 44],
      ['bulb', 1454, 306, 44, 44],
      ['bulb', 1418, 326, 44, 44],
      ['bulb', 1446, 466, 44, 44]
    ],
    birthday: [
      ['front', 148, 769, 196, 118],
      ['front', 1324, 702, 262, 247]
    ]
  };

  // Which near theme this paint draws, or '' for the original renderer. ONE
  // answer for both callers: paintSeason mounts it, and paint() hangs the
  // woodland moon only over it -- an unmapped surprise (Valentine's,
  // Storybook, Space Night) keeps its existing moon as well as its frames.
  // The forecast screensaver's own sky always keeps its distant landscape.
  function nearThemeOf(el, s, route) {
    if (el.classList.contains('own') || s.decorationStyle !== 'new' ||
        s.seasonalOn === false || s.decorations === false) return '';
    // Holiday settings keep their existing scheduling (route).
    var theme = NEAR_HOLIDAY[route.name] || NEAR_SURPRISE[route.surprise] || '';
    if (!route.name && !route.surprise) {
      var ambient = s.land || LAND_MONTH[route.now.getMonth()];
      var hs = window.hkSettings;
      if (!s.land && hs && hs.get('sky.hemisphere') === 'south') ambient = LAND_SOUTH[ambient];
      if (woodlandOn(ambient)) theme = ambient;
    }
    return NEAR_LIGHT[theme] ? theme : '';
  }

  // ---- New Decorations: THE TOUCHES (2026-10-04)
  // What makes a scene feel alive, spread through the whole scene as the real
  // thing would be: a bat crosses at any height, behind the cards as well as
  // the gaps between them, as a bird would behind a window frame. Where a
  // dashboard leaves the sky showing (the band over the header, the gutters,
  // the bottom corners -- hk_house/docs/images/new-decorations-2026-10-04.jpg)
  // is weighed, not obeyed: the moon's touches are there because the moon
  // is. Each is
  // built once with its scene and switched by update() -- night, the real
  // weather, the date -- through classes and variables; anything not on
  // show is display:none, so its animations stop. Transform and opacity
  // only: a wall tablet composites them for nothing.
  //
  //   Halloween   bats every night, in twos and threes, one flock across the
  //               moon (a swarm on a spooky night); an owl in the hollow of
  //               the left tree; mist drifting over the moon; the witch on a
  //               spooky night
  //   Christmas   the lights twinkling along their strands; Santa across the
  //               moon on Christmas Eve; glints on moonlit snow
  //   Winter      snow blowing off the branches in a real wind; the
  //               northern lights on a rare clear night; glints
  //   Autumn      leaves that fall with the real wind and a gust that swirls
  //               a few across the scene; geese; a harvest moon when full
  //   Spring      petals falling from the blossoms; a rainbow
  //               when the sun comes out after real rain (summer too)
  //   Summer      fireflies at dusk low in the scene; the cafe lights
  //               breathing along their wire (the Fourth and birthdays too)
  //   Birthday    a pennant banner from tree to tree, "HAPPY BIRTHDAY EMMA"
  //               (Birthdays' names), balloons rising from behind the
  //               rock and the presents, and
  //               confetti on the hour
  var NEAR_PENNANTS = ['#c8483c', '#e0a43a', '#3f7fbf', '#7b55b3', '#3e9c8a'];
  // The ground pumpkins' centres, in the art's coordinates: the light they
  // throw pools on the ground round them (their lit faces: NEAR_PATCHES).
  var NEAR_POOLS = { left: [[77, 742], [295, 760]], right: [[1437, 808], [1530, 784]] };
  // The owl's hollow in Halloween's left tree, in the art's coordinates.
  var NEAR_OWL = [118, 318];
  // Where each birthday balloon bunch rises from the ground, in the birthday
  // art's coordinates: `at` is its knot's x and the y its ribbons' ends go
  // to, behind the rock (left) and the presents (right) -- the front patches
  // drawn over them. `knot` is where its ribbons gather, as a fraction of its
  // half of balloons-v1.webp. The right bunch's outer balloon runs off the
  // art's edge (the delivered image cuts it there), as the trees do.
  var NEAR_BALLOONS = {
    left: { at: [250, 860], knot: [.33, .57] },
    right: { at: [1540, 830], knot: [.70, .63] }
  };
  // Wind, bucketed so a leaf field is rebuilt a few times a day, not on
  // every weather update: still, a breeze, a blow (mph).
  function windBucket(mph) { return mph < 6 ? 3 : mph < 14 ? 9 : 18; }
  function windy(state) { return (state.wind || 0) >= 10 && state.weather !== false; }

  function nearTouches(sky, root, theme, rnd, field, occ, L) {
    var built = {}, W0 = 0, H0 = 0;
    // each count's extras on a stream of their own (lvRange), by theme
    var xs = theme.length * 7919 + 101;
    function el(parent, cls, tag) {
      var n = parent.appendChild(document.createElement(tag || 'div'));
      n.className = cls;
      return n;
    }
    function bat(host, size, fl) {
      var b = el(host, 'bat');
      b._size = size;                      // at a 1280 px tablet; across() scales it
      for (var k = 0; k < BAT_FRAMES.length; k++) {
        el(b, 'f' + (k + 1), 'i').style.backgroundImage = 'url(' + BAT_FRAMES[k] + ')';
      }
      b.style.setProperty('--fl', fl.toFixed(3) + 's');
      return b;
    }
    // A FLOCK: two or three bats a beat apart, crossing every `cycle`
    // seconds; the first crossing `wait` seconds in, not on load. `n` of
    // them (Liveliness: how many) and the cycle times `cf` (how often; the
    // crossing itself keeps its speed, lvCycleOn).
    function flock(host, base, n, cycle, wait, cf, seed) {
      var f = el(host, 'flock');
      f._ltr = rnd() < 0.5;                // the whole flock one way
      var cyc = cycle * cf, shown = Math.max(n, 1);
      lvThin(lvRange(base, n, rnd, seed, function (i, r, keep) {
        // the draws in their old order: size, wing beat, place, gap
        var size = 32 + r() * 18, fl = 0.28 + r() * 0.2;
        var dy = (i - (shown - 1) / 2) * 16 + (r() - .5) * 10, gap = 0.35 + r() * 0.3;
        if (!keep) return null;
        var b = bat(f, size, fl);
        b._dy = dy;
        if (cf !== 1) lvCycleOn(b, sky, 'near-flock', cycle, cf, '--bd');
        else b.style.setProperty('--bd', cycle + 's');
        b.style.setProperty('--bdel', (-(cyc - wait) + i * gap).toFixed(2) + 's');
        return b;
      }));
      return f;
    }
    if (theme === 'halloween') {
      // every Halloween night -- not only the rare spooky roll (.dark)
      var dark = field('dark');
      var batN = L.many(occ, 'bats'), batC = L.cycle(occ, 'bats_often');
      built.flockA = flock(dark, 3, batC ? lvCount(3, batN) : 0, 71, 9, batC, xs + 1);
      built.flockA._at = rnd();                        // its place in the clear band
      built.flockB = flock(dark, 2, batC ? lvCount(2, batN) : 0, 113, 52, batC, xs + 2);   // across the moon
      built.owl = el(dark, 'owl');
      el(built.owl, 'eye', 'i'); el(built.owl, 'eye', 'i');
      if (!L.on(occ, 'owl')) built.owl.style.display = 'none';
      built.mist = el(dark, 'moon-mist');
      el(built.mist, 'wisp a', 'i'); el(built.mist, 'wisp b', 'i');
      if (!L.on(occ, 'mist')) built.mist.style.display = 'none';
      // a spooky night: a swarm, and the witch across the moon (.night)
      var swarm = field('night');
      built.swarm = flock(swarm, 7, lvCount(7, L.many(occ, 'swarm')), 41, 5, 1, xs + 3);
      built.swarm._at = rnd();
      for (var sb = 0; sb < built.swarm.children.length; sb++) built.swarm.children[sb]._dy *= 2.4;
      built.spooky = swarm;
      built.witchC = L.cycle(occ, 'witch');
    }
    if (theme === 'christmas') {
      built.eve = field('eve');
      built.sleigh = el(built.eve, 'sleigh');
      built.sleigh.style.setProperty('--fd', '150s');
      built.sleigh.style.setProperty('--fdel', (6 + rnd() * 20).toFixed(1) + 's');
      var slC = L.cycle(occ, 'sleigh');
      if (!slC) { built.sleigh.remove(); built.sleigh = null; }
      else if (slC !== 1) lvCycleOn(built.sleigh, sky, 'hk-sleigh', 150, slC, '--fd');
    }
    if (theme === 'christmas' || theme === 'winter') {
      var glints = field('glints');
      lvThin(lvRange(22, lvCount(22, L.many(occ, 'glints')), rnd, xs + 4, function (i, r, keep) {
        // on the snow: the ground and the drifts round the trees' feet
        var left = r() * 100, top = 62 + r() * 36, gd = 5 + r() * 7, gdel = -r() * 12;
        if (!keep) return null;
        var gl = el(glints, 'glint', 'i');
        gl.style.left = left.toFixed(2) + '%';
        gl.style.top = top.toFixed(2) + '%';
        gl.style.setProperty('--gd', gd.toFixed(2) + 's');
        gl.style.setProperty('--gdel', gdel.toFixed(2) + 's');
        return gl;
      }));
      // the northern lights: one clear night in four, at Normal
      built.auroraC = L.cycle(occ, 'aurora');
      // (No snow blown off the branches: drawn on a 2D page it read as a
      // glowing blob, then as a dotted line -- nothing real looks like either.)
      built.aurora = root.insertBefore(document.createElement('div'), root.children[0] || null);
      built.aurora.className = 'aurora';
      built.bands = [el(built.aurora, 'band a', 'i'), el(built.aurora, 'band b', 'i')];
      built.bands.forEach(auroraCanvas);
    }
    if (theme === 'fall') {
      var swirl = field('windy-only swirl');
      lvThin(lvRange(5, lvCount(5, L.many(occ, 'swirl')), rnd, xs + 5, function (w, r, keep) {
        var top = 30 + (w % 5) * 4 + r() * 8;
        if (!keep) return null;
        var sl = el(swirl, 'swirl-leaf', 'i');
        sl.style.backgroundImage = 'url(' + LEAF_SPECIES[w % LEAF_SPECIES.length][0] + ')';
        sl.style.top = top.toFixed(1) + '%';
        sl.style.setProperty('--sdel', (8 + w * 0.45).toFixed(2) + 's');
        return sl;
      }));
      var gC = L.cycle(occ, 'geese');
      if (gC) {
        var geese = el(field('day'), 'geese');
        if (gC !== 1) lvCycleOn(geese, sky, 'near-geese', 240, gC);
        // a V of seven on a 160 x 46 grid
        for (var v = 0; v < 7; v++) {
          var goose = el(geese, 'goose', 'i');
          goose.style.left = ((6 + v * 20) / 1.6).toFixed(2) + '%';
          goose.style.top = ((4 + Math.abs(v - 3) * 9) / .46).toFixed(2) + '%';
        }
      }
    }
    if (theme === 'spring') {
      var petals = field('petals');
      lvThin(lvRange(10, lvCount(10, L.many(occ, 'petals')), rnd, xs + 6, function (p, r, keep) {
        var side = p % 2, ps = 7 + r() * 7, left = side ? 55 + r() * 45 : r() * 45, top = -3 + r() * 26,
            pd = 11 + r() * 7, pdel = -r() * 18;
        if (!keep) return null;
        var pt = el(petals, 'petal', 'i');
        pt.style.setProperty('--ps', ps.toFixed(1) + 'px');
        // from the blossoms: both canopies, out across the top
        pt.style.left = left.toFixed(2) + '%';
        pt.style.top = top.toFixed(2) + '%';
        pt.style.setProperty('--pd', pd.toFixed(2) + 's');
        pt.style.setProperty('--pdel', pdel.toFixed(2) + 's');
        pt.style.setProperty('--pside', side ? '-1' : '1');
        return pt;
      }));
    }
    if ((theme === 'spring' || theme === 'summer') && L.on(occ, 'rainbow')) {
      built.rainbow = root.insertBefore(document.createElement('div'), root.children[0] || null);
      built.rainbow.className = 'rainbow';
    }
    if (theme === 'summer' || theme === 'july4') {
      var flies = field('dusk');
      lvThin(lvRange(14, lvCount(14, L.many(occ, 'fireflies')), rnd, xs + 7, function (f, r, keep) {
        // low over the grass and among the trees' feet
        var left = r() * 100, top = 48 + r() * 48, wd = 7 + r() * 6, fd = 3.5 + r() * 4, fdel = -r() * 8,
            fx = (r() - .5) * 46, fy = (r() - .5) * 30;
        if (!keep) return null;
        var ff = el(flies, 'firefly', 'i');
        ff.style.left = left.toFixed(2) + '%';
        ff.style.top = top.toFixed(2) + '%';
        ff.style.setProperty('--wd', wd.toFixed(2) + 's');
        ff.style.setProperty('--fd', fd.toFixed(2) + 's');
        ff.style.setProperty('--fdel', fdel.toFixed(2) + 's');
        ff.style.setProperty('--fx', fx.toFixed(0) + 'px');
        ff.style.setProperty('--fy', fy.toFixed(0) + 'px');
        return ff;
      }));
    }
    if (theme === 'birthday') built.banner = el(root, 'bday-banner');

    function moonEl() { return sky.querySelector('.moon'); }
    // The moon, as the sky laid it out this paint (paint() runs first).
    function moonAt() {
      var m = moonEl();
      if (!m) return null;
      var mr = m.getBoundingClientRect(), rr = root.getBoundingClientRect();
      if (!mr.width) return null;
      return { x: mr.left - rr.left + mr.width / 2, y: mr.top - rr.top + mr.height / 2, s: mr.width };
    }
    function across(f, W, top, u) {
      var kids = f.children;
      for (var i = 0; i < kids.length; i++) {
        var b = kids[i], size = b._size * u;
        b.style.width = b.style.height = size.toFixed(0) + 'px';
        // never above the screen's top edge: a swarm's spread (its _dy) would
        // otherwise park a bat at a negative top, a crossing nobody sees
        b.style.top = Math.max(0, top + b._dy * u - size / 2).toFixed(0) + 'px';
        b.style.setProperty('--x0', (f._ltr ? -size - 40 : W + 40) + 'px');
        b.style.setProperty('--xd', (f._ltr ? W + size + 80 : -(W + size + 80)) + 'px');
      }
    }
    // A BIRTHDAY'S BANNER: today's names from Birthdays, a pennant a letter,
    // hung along the very top between the trees (the header sits in front).
    function banner(W, now, narrow, u, inset) {
      var names = birthdays().filter(function (b) {
        return b.month === now.getMonth() + 1 && b.day === now.getDate() && b.name;
      }).map(function (b) { return String(b.name).toUpperCase(); });
      var text = 'HAPPY BIRTHDAY' + (names.length ? ' ' + names.join(' & ') : '');
      var key = text + '|' + Math.round(W / 40) + '|' + u + '|' + Math.round(inset);
      if (built.bannerKey === key) return;
      built.bannerKey = key;
      // STRUNG FROM TREE TO TREE, as real bunting is: the string tied high in
      // each tree at the page's edges, sagging a little between, its pennants
      // spread evenly along it. Like the branches, it is behind the cards: a
      // title or a chip in front of it simply hides that stretch. The page's
      // edges: beside an open menu (`inset`), not under it.
      var PW = W - inset, x0 = inset + PW * 0.04, span = PW * 0.92, step = span / text.length;
      // A PHONE'S, THE NAMES ALONE: where HAPPY BIRTHDAY and the names would
      // squeeze the letters too small to read (and a phone's header leaves
      // no room for a second string), the names, at a size that reads.
      if (step * 0.9 < 33 * u && names.length) {
        text = names.join(' & ');
        step = span / text.length;
      }
      var pw = Math.min(44 * u, step * 0.9), ph = pw * 1.15, sag = 18 * u, pens = '';
      // a few letters gather at the middle of the string, a little apart
      step = Math.min(step, pw * 1.2);
      var xs = x0 + (span - text.length * step) / 2;
      function y(x) { var t = (x - x0 - span / 2) / (span / 2); return -2 + sag * (1 - t * t); }
      text.split('').forEach(function (c, i) {
        if (c === ' ') return;
        var x = xs + (i + 0.5) * step, top = y(x);
        var col = NEAR_PENNANTS[i % NEAR_PENNANTS.length];
        pens += '<i class="pen" style="left:' + (x - pw / 2).toFixed(1) + 'px;top:' + top.toFixed(1) + 'px;--pd:' +
          (4 + (i % 3)) + 's;--pdel:' + (-i * 0.4).toFixed(1) + 's"><svg width="' + pw.toFixed(1) + '" height="' +
          ph.toFixed(1) + '"><path d="M0 0 L' + pw.toFixed(1) + ' 0 L' + (pw / 2).toFixed(1) + ' ' + ph.toFixed(1) +
          'Z" fill="' + col + '"/><text x="' + (pw / 2).toFixed(1) + '" y="' + (ph * 0.36).toFixed(1) + '" font-size="' +
          (pw * 0.56).toFixed(1) + '">' + (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c) + '</text></svg></i>';
      });
      built.banner.innerHTML = '<svg width="' + W + '" height="' + Math.ceil(ph + sag + 4) + '" aria-hidden="true">' +
        '<path d="M' + x0.toFixed(1) + ' -2 Q' + (x0 + span / 2).toFixed(1) + ' ' + (-2 + 2 * sag).toFixed(1) + ' ' +
        (x0 + span).toFixed(1) + ' -2" fill="none" stroke="rgba(40,32,26,.75)" stroke-width="1.4"/></svg>' + pens;
    }

    var lastRain = 0, auroraDay = '', auroraOn = false;
    // A FIELD FADED TO NOTHING IS TAKEN OUT (display:none), so its animations
    // stop: opacity 0 alone left a Halloween day running every bat's frames,
    // the owl and the mist (NEW-DECORATIONS-PERF: 76 animations by day, 78 by
    // night). Out once the 20 s fade has finished; back in at 0 and given its
    // value on the NEXT paint, so it still fades in rather than popping.
    // NEVER SHOWN, NOTHING TO FADE (2026-10-10): a field at 0 from its first
    // paint -- the night's bats, owl and mist on a page loaded by day -- is
    // out at once. Waiting out a fade that never began ran 37 invisible
    // animations for the first 21 s of every load.
    var FADE_MS = 20000, zeroSince = {}, shown = {};
    function fade(prop, cls, v) {
      var outCls = 'out-' + cls, out = root.classList.contains(outCls);
      if (v > 0 && out) { root.classList.remove(outCls); root.style.setProperty(prop, '0'); return; }
      root.style.setProperty(prop, String(v));
      if (v > 0) { zeroSince[cls] = 0; shown[cls] = true; return; }
      if (!shown[cls]) { if (!out) root.classList.add(outCls); return; }
      if (!zeroSince[cls]) zeroSince[cls] = Date.now();
      else if (!out && Date.now() - zeroSince[cls] > FADE_MS + 1000) root.classList.add(outCls);
    }
    function update(state, W, H, narrow, artW, artH, real) {
      var now = state.now || new Date(), night = state.elev < -4;
      var moon = night ? moonAt() : null;
      // EVERY SCREEN ITS OWN SCALE: what is drawn at a 1280 x 800 tablet,
      // scaled with the screen -- its width, or its height on a wide one --
      // between a phone's 0.6 and a desk's 1.6. The CSS sizes read --near-u.
      var u = clamp(Math.min(W, H * 1.6) / 1280, 0.6, 1.6);
      root.style.setProperty('--near-u', u.toFixed(2));
      root.classList.toggle('windy', windy(state));
      // not on the mount's placeholder sky (mountNearScenery: `real`): its
      // noon would take a night's bats out before the night's first paint
      if (real) {
        fade('--near-dark', 'dark', night ? 1 : 0);
        fade('--near-dusk', 'dusk', +clamp((3 - state.elev) / 6, 0, 1).toFixed(2));
        var lit = (1 - Math.cos(2 * Math.PI * (state.moon == null ? .5 : state.moon))) / 2;
        fade('--near-moonlit', 'glints', +(night ? lit * (1 - .7 * clamp(state.cover || 0, 0, 1)) : 0).toFixed(1));
      }
      if (built.flockA) {
        if (W !== W0 || H !== H0 || built.moonY !== (moon ? Math.round(moon.y) : -1)) {
          // THE CLEAR BAND: brief flights stay in the sky above the camera
          // mosaic -- behind the header's text, never under an opaque tile.
          // A phone's header is taller. across() is the ONLY thing that
          // places a flock bat (a fixed-row override in update() once fought
          // it on every paint and won).
          var band = narrow ? [185, 245] : [70, 150];
          var inBand = function (f) { return band[0] + f * (band[1] - band[0]); };
          across(built.flockA, W, inBand(built.flockA._at), u);
          across(built.flockB, W, moon ? moon.y : inBand(0.5), u);
          across(built.swarm, W, inBand(built.swarm._at), u);
          // the owl's tree is the left one, which a phone does not show
          built.owl.style.display = narrow || !L.on(occ, 'owl') ? 'none' : '';
          built.owl.style.left = (NEAR_OWL[0] / 1586 * artW).toFixed(0) + 'px';
          built.owl.style.top = (NEAR_OWL[1] / 992 * artH).toFixed(0) + 'px';
          built.owl.style.setProperty('--owl', (artH / 992).toFixed(3));
          if (moon) {
            built.mist.style.left = (moon.x - moon.s * 1.6).toFixed(0) + 'px';
            built.mist.style.top = (moon.y - moon.s * 0.3).toFixed(0) + 'px';
            built.mist.style.width = (moon.s * 3.2).toFixed(0) + 'px';
            built.mist.style.height = (moon.s * 0.6).toFixed(0) + 'px';
          }
          built.moonY = moon ? Math.round(moon.y) : -1;
        }
        // the witch flies when a spooky night has a moon to cross
        var witch = state.spooky === true && moon && built.witchC > 0;
        if (witch && (!built.witch || Math.abs(built.witchAt - moon.x) > 8)) {
          if (built.witch) built.witch.remove();
          witchFly(built.spooky, W, H, moon.s, moon.x / W, moon.y / H, rnd, built.witchC);
          built.witch = built.spooky.querySelector('.witch');
          built.witchAt = moon.x;
        } else if (!witch && built.witch) {
          built.witch.remove();
          built.witch = null;
        }
      }
      if (built.sleigh) {
        var eve = night && now.getMonth() === 11 && now.getDate() === 24 && !!moon;
        root.classList.toggle('eve', eve);
        if (eve) {
          // across the moon, but never smaller than a sleigh can be seen at:
          // a tablet's woodland moon is 76 px
          var sw = Math.max(moon.s * MOON_DISC * 0.75, 104 * u);
          built.sleigh.style.width = sw.toFixed(0) + 'px';
          built.sleigh.style.top = (moon.y - sw / 6 - moon.s * MOON_DISC * 0.1).toFixed(0) + 'px';
          built.sleigh.style.setProperty('--x0', (W + 240).toFixed(0) + 'px');
          built.sleigh.style.setProperty('--xd', (-(W + sw + 480)).toFixed(0) + 'px');
        }
      }
      if (built.aurora) {
        // ONE NIGHT IN FOUR, by the date: every screen agrees, and a clear,
        // dark night is still not a promise
        var day = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
        // (Liveliness: Few half as often, Max nearly every clear night, Off never)
        if (day !== auroraDay) {
          auroraDay = day;
          auroraOn = built.auroraC > 0 &&
                     rng(now.getFullYear() * 400 + now.getMonth() * 31 + now.getDate())() < Math.min(0.95, 0.25 / built.auroraC);
        }
        root.classList.toggle('aurora-on', auroraOn && state.elev < -10 && (state.cover || 0) < 0.25 &&
                                           state.weather !== false && !narrow);
        // drawn while it shows (its size known), again only at a new size
        if (root.classList.contains('aurora-on')) built.bands.forEach(auroraDraw);
      }
      if (built.rainbow) {
        var wet = state.wet && state.wet.kind === 'rain' && state.wet.rate > 0;
        if (wet) lastRain = now.getTime();
        root.classList.toggle('rainbow-on', !wet && lastRain && now.getTime() - lastRain < 40 * 60000 &&
          state.elev > 4 && state.elev < 45 && (state.cover || 0) < 0.7 && state.weather !== false);
        built.rainbow.style.setProperty('--rr', (W * 0.62).toFixed(0) + 'px');
      }
      if (theme === 'fall') {
        // A HARVEST MOON: full, and the first hours of the night (a warm,
        // low moon; it whitens as the night goes on)
        var mo = moonEl();
        if (mo) mo.classList.toggle('harvest', night && state.moon != null && Math.abs(state.moon - 0.5) < 0.08 &&
                                             state.elev > -18);
      }
      if (built.banner) {
        var season = sky.querySelector('.season');
        banner(W, now, narrow, u, season ? parseFloat(getComputedStyle(season).left) || 0 : 0);
        // CONFETTI ON THE HOUR: the first minute of every hour
        root.classList.toggle('burst', now.getMinutes() === 0);
      }
      W0 = W;
      H0 = H;
    }
    return {
      update: update,
      // the moon is the sky's, not the scene's: a harvest tint goes with it
      dispose: function () { var mo = moonEl(); if (mo) mo.classList.toggle('harvest', false); }
    };
  }

  // THE STILL ART AS ONE CANVAS (2026-10-11). The ground wash, the far valley
  // and the two foreground trees were four full-screen layers -- each its
  // own copy of the screen in the tablet's tile memory, the trees masked,
  // all four filtered -- about 3 screens of a wall tablet's budget on Home
  // (measured headless with the budget capped: headroom 2 -> 5 screens
  // without them), which ran out coming back to Home and left parts of the
  // page undrawn for 2-3 frames (screen-recorded on the Living Room
  // tablet). Drawn here exactly as the CSS laid them out -- the same
  // picture, positions, masks and wash, in that order -- at the screen's
  // size and density, again only when the size changes. The relighting is
  // still the CSS filter (.scenery-art, its 3 s transition), now on the one
  // canvas: brightness and saturate are linear, so filtering the four
  // together equals filtering each. Until the art and masks have loaded
  // the canvas is empty, as the backgrounds were.
  // (Measured against the four layers: the same pixels -- a mean difference
  // of 0.3-0.5/255, rounding -- at 1280x800@1.5, 1512x945@2, 1920x1080 and
  // a 390-wide phone, and for every theme.) Null where a canvas cannot be
  // drawn: the four layers, as before.
  function nearFlat(root, src, masks, ground) {
    var cv = document.createElement('canvas');
    if (!cv.getContext || !cv.getContext('2d')) return null;
    root.appendChild(cv);
    cv.className = 'scenery-art scenery-flat';
    var imgs = {}, want = null, drawn = '', scratch = null;
    function load(k, url) {
      var im = new Image();
      im.onload = function () { imgs[k] = im; if (want) draw.apply(null, want); };
      im.src = url;
    }
    load('art', src); load('left', masks.left); load('right', masks.right);
    function rgba(hex, a) {
      var h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    // one piece drawn on its own, cut by its mask, then laid on the canvas
    function piece(x, cw, ch, dpr, paint, cut) {
      if (!scratch) scratch = document.createElement('canvas');
      scratch.width = cw; scratch.height = ch;
      var s = scratch.getContext('2d');
      // (a resize resets the context, but not every engine's -- say it)
      s.globalCompositeOperation = 'source-over';
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.imageSmoothingQuality = 'high';
      paint(s);
      s.globalCompositeOperation = 'destination-in';
      cut(s);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.drawImage(scratch, 0, 0);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(W, H, narrow, artW, artH) {
      want = [W, H, narrow, artW, artH];
      if (!imgs.art || !imgs.left || !imgs.right || !(W > 0) || !(H > 0)) return;
      var dpr = window.devicePixelRatio || 1;
      var key = [W, H, narrow, artW, artH, dpr].join();
      if (key === drawn) return;
      drawn = key;
      var cw = Math.round(W * dpr), ch = Math.round(H * dpr), art = imgs.art;
      cv.width = cw; cv.height = ch;
      var x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.imageSmoothingQuality = 'high';
      // a phone: the right tree alone, filling the width, unmasked
      if (narrow) { x.drawImage(art, W - artW, 0, artW, artH); return; }
      // .scenery-ground: the wash, transparent to 60%, the ground color by 90%
      var g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0.6, rgba(ground, 0)); g.addColorStop(0.9, rgba(ground, 1));
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      // .scenery-depth: the picture at twice the width, centred, from 35-40% down
      piece(x, cw, ch, dpr, function (s) { s.drawImage(art, -W / 2, 0, 2 * W, H); }, function (s) {
        var m = s.createLinearGradient(0, 0, 0, H);
        m.addColorStop(0.35, 'rgba(0,0,0,0)'); m.addColorStop(0.4, 'rgba(0,0,0,1)');
        s.fillStyle = m; s.fillRect(0, 0, W, H);
      });
      // .scenery-side: each tree at the art's size, on its own edge, by its mask
      piece(x, cw, ch, dpr, function (s) { s.drawImage(art, 0, 0, artW, artH); },
            function (s) { s.drawImage(imgs.left, 0, 0, artW, artH); });
      piece(x, cw, ch, dpr, function (s) { s.drawImage(art, W - artW, 0, artW, artH); },
            function (s) { s.drawImage(imgs.right, W - artW, 0, artW, artH); });
      // ...and the working canvas let go: a second screen-sized bitmap
      // (~9 MB at 1920 x 1200) held for nothing until the next resize
      if (scratch) { scratch.width = scratch.height = 0; scratch = null; }
    }
    return { canvas: cv, draw: draw };
  }

  // Build one theme's scenery into the sky, under the fog. Returns its root,
  // update(state) -- every paint: light, size, weather -- and dispose().
  // Built once per theme; nothing here is rebuilt by a paint.
  function mountNearScenery(sky, theme, occ, L) {
    if (!sky) return null;
    L = L || lvOf(null);
    occ = occ || theme;
    var old = sky.querySelectorAll('.near-scenery');
    for (var o = 0; o < old.length; o++) old[o].remove();
    var root = document.createElement('div');
    root.className = 'near-scenery';
    var art = 'url(' + NEAR_ART + theme + '-v1.webp' + VER + ')';
    root.style.setProperty('--scene-image', art);
    root.style.setProperty('--ground-color', NEAR_GROUND[theme] || '#302919');
    // Christmas and the birthday fade their tree feet out later (from 96% of
    // the height, not 86%).
    var tail = theme === 'christmas' || theme === 'birthday' ? '96%' : '86%';
    var maskSvg = {};
    ['left', 'right'].forEach(function (side) {
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1586 992"><defs>' +
        '<linearGradient id="tail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="992">' +
        '<stop offset="' + tail + '" stop-color="white"/>' +
        '<stop offset="100%" stop-color="white" stop-opacity="0"/></linearGradient>' +
        '<filter id="soft" x="-10%" y="-10%" width="120%" height="120%">' +
        '<feGaussianBlur stdDeviation="8"/></filter></defs>' +
        '<path d="' + NEAR_TREE_MASKS[side] + '" fill="url(#tail)" filter="url(#soft)"/></svg>';
      root.style.setProperty('--tree-' + side + '-mask',
        'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")');
      // (sized, for a canvas: an SVG with only a viewBox has no size of its own there)
      maskSvg[side] = 'data:image/svg+xml,' + encodeURIComponent(svg.replace('viewBox=', 'width="1586" height="992" viewBox='));
    });
    var flat = nearFlat(root, NEAR_ART + theme + '-v1.webp' + VER, maskSvg, NEAR_GROUND[theme] || '#302919');
    if (!flat) {
      ['scenery-ground', 'scenery-depth', 'scenery-side left', 'scenery-side right'].forEach(function (cls) {
        root.appendChild(document.createElement('div')).className = 'scenery-art ' + cls;
      });
    }
    // The lighting patches, over the trees they belong to: what hangs there
    // (lit by the scene, like the trees), and over it what is lit after dark
    // -- the candles flickering, the bulbs twinkling one by one along the
    // strands. Small images, not full-screen layers.
    var patches = [], seen = {};
    if (NEAR_PATCHES[theme]) {
      var props = root.appendChild(document.createElement('div'));
      props.className = 'patches';
      var lit = root.appendChild(document.createElement('div'));
      lit.className = 'patches-lit';
      NEAR_PATCHES[theme].forEach(function (p, i) {
        var kind = p[0], n = seen[kind] = (seen[kind] || 0) + 1;
        var file = function (part) { return 'url(' + NEAR_ART + theme + '-' + part + '-' + n + '-v1.webp' + VER + ')'; };
        if (kind === 'lantern' || kind === 'front') {
          var off = props.appendChild(document.createElement('i'));
          off.className = 'patch prop';
          off.style.backgroundImage = file(kind);
          patches.push({ node: off, box: p });
          if (kind === 'front') return;
        }
        var on = lit.appendChild(document.createElement('i'));
        on.className = 'patch lit ' + (kind === 'bulb' ? 'bulb' : 'candle');
        on.style.backgroundImage = file(kind + '-lit');
        on.style.setProperty('--phase', (kind === 'bulb' ? -n * 0.43 : -i * 1.7).toFixed(2) + 's');
        patches.push({ node: on, box: p });
      });
    }
    if (theme === 'birthday') {
      var wire = root.appendChild(document.createElement('div'));
      wire.className = 'cafe-wire';
      wire.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1586 992" ' +
        'preserveAspectRatio="none" style="width:100%;height:100%">' +
        '<path d="M420 15 Q785 230 1150 0" fill="none" stroke="#2c251e" stroke-width="2"/></svg>';
    }
    var glows = root.appendChild(document.createElement('div'));
    glows.className = 'scenery-glows';
    // THE CAFE LIGHTS (summer, the Fourth, birthdays) breathe along the
    // wire, one after another. (Christmas's own bulbs twinkle as patches.)
    var bulbs = (NEAR_LAMPS[theme] || []).map(function (xy, i) {
      var bulb = glows.appendChild(document.createElement('i'));
      bulb.className = 'scenery-bulb wave';
      bulb.style.setProperty('--phase', (-i * 0.7).toFixed(2) + 's');
      return { node: bulb, xy: xy };
    });
    // The light the ground pumpkins throw round them, in the artwork's
    // coordinates and anchored to their tree, under their lit faces (the
    // pumpkin patches).
    if (theme === 'halloween') {
      ['left', 'right'].forEach(function (side) {
        var candle = glows.appendChild(document.createElement('div'));
        candle.className = 'candle-art ' + side;
        var id = 'near-candle-' + side;
        // the light pooled on the ground round each pumpkin, under the faces
        var pools = NEAR_POOLS[side].map(function (c) {
          return '<ellipse cx="' + c[0] + '" cy="' + c[1] + '" rx="105" ry="46" fill="url(#' + id + '-pool)"/>';
        }).join('');
        candle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1586 992"><defs>' +
          '<radialGradient id="' + id + '-pool"><stop offset="0" stop-color="#ff8a2a" stop-opacity=".5"/>' +
          '<stop offset=".55" stop-color="#ff6a12" stop-opacity=".16"/>' +
          '<stop offset="1" stop-color="#ff6a12" stop-opacity="0"/></radialGradient></defs>' + pools + '</svg>';
      });
    }
    if (bulbs.length || theme === 'christmas') {
      [4, 80].forEach(function (left) {
        var glow = glows.appendChild(document.createElement('i'));
        glow.className = 'scenery-warmth';
        glow.style.left = left + '%';
      });
    }

    // The moving layers: the original builders, each in its own field.
    var rnd = rng(theme.length * 7919);
    function field(cls) {
      var node = root.appendChild(document.createElement('div'));
      node.className = 'near-motion ' + cls;
      return node;
    }
    var width = sky.clientWidth || 1280, height = sky.clientHeight || 800;
    var fieldW = Math.min(width, 1280);
    // THE LEAVES FALL WITH THE REAL WIND: rebuilt when it moves between
    // still, a breeze and a blow (windBucket), from the same seed each time
    var leaves = theme === 'fall' || theme === 'halloween' ? field('leaves') : null, leafWind = 0;
    function fallLeaves(wind) {
      if (!leaves || wind === leafWind) return;
      leafWind = wind;
      leaves.textContent = '';
      leafField(leaves, fieldW, height, { count: 6, fallMin: 37, fallMax: 63, wind: wind,
                                          many: L.many(occ, 'leaves'), seed: 7919 + wind + 13 }, rng(7919 + wind));
    }
    fallLeaves(3);
    if (theme === 'halloween') fogWisps(field('near-mist'), rnd, L.on(occ, 'mist'));
    if (theme === 'spring') surpriseScene(field('day'), fieldW, height, 'spring-garden', false, true, rnd, true, occ, L);
    if (theme === 'july4') {
      var fireworks = field('night');
      fireworks.classList.add('fireworks');     // (stays behind: FRONT_SEL)
      surpriseScene(fireworks, fieldW, height, 'fourth-of-july', true, true, rnd, true, occ, L);
      // the bursts only: no drifting sparkles over the trees
      var sparks = fireworks.querySelectorAll('.sp-fall');
      for (var f = 0; f < sparks.length; f++) sparks[f].remove();
    }
    if (theme === 'birthday') {
      surpriseScene(field('confetti'), fieldW, height, 'birthday', false, true, rnd, true, occ, L);
      // behind the rock and the presents (the front patches)
      if (L.on(occ, 'balloons')) {
        root.insertBefore(document.createElement('div'), props || null).className = 'balloons left';
        root.insertBefore(document.createElement('div'), props || null).className = 'balloons right';
      }
    }
    // Lights Off: every candle and bulb at a steady glow (.lv-still)
    root.classList.toggle('lv-still', !L.on(occ, 'lights'));
    var touches = nearTouches(sky, root, theme, rnd, field, occ, L);
    sky.insertBefore(root, sky.querySelector('.fog'));

    var state = { elev: 25, cover: 0 };
    // --scene-b / --scene-s / --scene-light feed the 3s filter and opacity
    // transitions on full-viewport layers. Written raw, they changed in the
    // third decimal on every 3s tick through dusk and dawn, so each tick
    // restarted the filter transition over the whole screen. Steps of 0.02
    // are below what the eye sees and change every few minutes instead; a
    // value is written only when its step changes.
    var written = {}, litZero = 0;
    function setStep(name, v) {
      var q = (Math.round(v / 0.02) * 0.02).toFixed(2);
      if (written[name] === q) return;
      written[name] = q;
      root.style.setProperty(name, q);
    }
    // REAL once a paint has handed over the sky: until then `state` is the
    // placeholder noon above (the mount's own update, the observer's first)
    var real = false;
    function update(next) {
      for (var k in next) if (next.hasOwnProperty(k)) { state[k] = next[k]; real = true; }
      var W = root.clientWidth, H = root.clientHeight, narrow = W < 640;
      root.classList.toggle('narrow', narrow);
      root.classList.toggle('heavy-weather', !!(state.wet && state.wet.rate >= .7));
      root.classList.toggle('lv-quiet', !!(state.lively && state.lively.quiet));
      // paintSeason passes Halloween's own spooky flag (night and the spooky
      // roll); every other theme gets true, which only opens its night field.
      root.classList.toggle('spooky', theme === 'halloween' && state.spooky === true);
      var t = clamp((state.elev + 8) / 14, 0, 1);
      var overcast = state.cover > .75 ? .86 : 1;
      var moonLit = theme === 'halloween' ? 1
        : (1 - Math.cos(2 * Math.PI * (state.moon == null ? .5 : state.moon))) / 2;
      var moonlight = clamp((-4 - state.elev) / 10, 0, 1) *
                      (1 - .5 * clamp(state.cover || 0, 0, 1)) * moonLit;
      setStep('--scene-b', (.43 + .4 * t + .04 * moonlight * (1 - t)) * overcast);
      setStep('--scene-s', .7 + .16 * t);
      setStep('--scene-light', .1 + .65 * (1 - t));
      setStep('--scene-lit', 1 - t);
      // THE LIT PATCHES LEAVE THE RENDER TREE BY DAY: their layer is at
      // opacity 0 from sunrise to dusk, yet every candle's flicker and bulb's
      // twinkle ran all day. Out once the 3 s fade has finished; back in on the
      // first paint that lights them, so they fade up as before.
      if (written['--scene-lit'] !== '0.00') { litZero = 0; root.classList.remove('lit-out'); }
      else if (!litZero) litZero = Date.now();
      else if (Date.now() - litZero > 4000) root.classList.add('lit-out');
      root.style.setProperty('--near-mist', state.weather === false ? '0' : '.65');
      root.classList.toggle('is-night', state.elev < -4 && state.spooky !== false);
      root.classList.toggle('is-day', !(state.elev < -4));
      root.style.setProperty('--near-sway', (.8 + Math.min(25, state.wind || 0) * .06) + 'deg');
      root.style.setProperty('--near-particles', state.wet && state.wet.rate >= .7 ? '.35' : '1');
      fallLeaves(windBucket(state.weather === false ? 0 : state.wind || 0));
      // Foreground roots and the valley share the same vertical projection.
      // Sizing trees to a card gap lifts their bases onto the distant hills;
      // fit the source height to the viewport so the rooted floor stays intact.
      // Props remain in the source's lower edge, inside the visible viewport.
      var artH = H;
      var artW = artH * (theme === 'christmas' || theme === 'fall' ? 1585 : 1586) / 992;
      root.style.setProperty('--art-h', artH + 'px');
      root.style.setProperty('--art-w', artW + 'px');
      if (flat) flat.draw(W, H, narrow, artW, artH);
      var i, nodes = skyQA(root, '.lf,.sp-fall');
      for (i = 0; i < nodes.length; i++) nodes[i].style.setProperty('--dist', (H + 190) + 'px');
      // Keep brief flights in clear sky above the camera mosaic. Their paths
      // stay behind controls, but should not disappear beneath camera tiles.
      // (The Halloween flocks' own band is in nearTouches.)
      nodes = skyQA(root, '.day .sp-fly');
      for (i = 0; i < nodes.length; i++) nodes[i].style.top = (narrow ? 185 : 95) + 'px';
      nodes = root.querySelectorAll('.sp-burst');
      for (i = 0; i < nodes.length; i++) nodes[i].style.top = (narrow ? 180 : 4) + 'px';
      bulbs.forEach(function (bulb) {
        var x = bulb.xy[0], y = bulb.xy[1], st = bulb.node.style;
        st.display = narrow && (x < .5 || theme === 'birthday') ? 'none' : '';
        st.setProperty('--lamp-scale', String(artH / 992));
        // A tree's lamps ride with their tree's edge; the birthday's span the
        // viewport on the wire's quadratic curve (its path in the SVG above).
        st.left = (theme === 'birthday' ? x * W : x < .5 ? x * artW : W - (1 - x) * artW) + 'px';
        var wireT = (x * 1586 - 420) / 730;
        st.top = (theme === 'birthday'
          ? ((1 - wireT) * (1 - wireT) * 15 + 2 * (1 - wireT) * wireT * 230) / 992 * H
          : y * artH) + 'px';
      });
      // each patch on its own tree's frame, as the tree is laid out
      var srcW = theme === 'christmas' || theme === 'fall' ? 1585 : 1586, k = artH / 992;
      patches.forEach(function (p) {
        var b = p.box, st = p.node.style, right = b[1] + b[3] / 2 > srcW / 2;
        st.display = narrow && !right ? 'none' : '';
        st.left = (right ? W - (srcW - b[1]) * k : b[1] * k).toFixed(1) + 'px';
        st.top = (b[2] * k).toFixed(1) + 'px';
        st.width = (b[3] * k).toFixed(1) + 'px';
        st.height = (b[4] * k).toFixed(1) + 'px';
      });
      // each balloon bunch rising from the ground behind the rock or the
      // presents, at the scene's scale -- a balloon about the top present's
      // size -- and swaying from the ground, where it is held
      var balloonNodes = root.querySelectorAll('.balloons');
      for (i = 0; i < balloonNodes.length; i++) {
        var side = balloonNodes[i].className.indexOf('right') >= 0 ? 'right' : 'left';
        var bl = NEAR_BALLOONS[side], bh = 700 * k, bw = bh / 3;
        var tx = side === 'right' ? W - (srcW - bl.at[0]) * k : bl.at[0] * k;
        var bst = balloonNodes[i].style;
        bst.width = bw.toFixed(1) + 'px';
        bst.height = bh.toFixed(1) + 'px';
        bst.left = (tx - bl.knot[0] * bw).toFixed(1) + 'px';
        bst.top = (bl.at[1] * k - bh).toFixed(1) + 'px';
        bst.transformOrigin = Math.round(bl.knot[0] * 100) + '% 100%';
      }
      touches.update(state, W, H, narrow, artW, artH, real);
    }
    var observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(function () { update({}); }) : null;
    if (observer) observer.observe(root);
    update({});
    return {
      root: root,
      update: update,
      dispose: function () {
        if (observer) observer.disconnect();
        touches.dispose();
        root.remove();
      }
    };
  }

  // What today's seasonal layer is: the season's plan, the season it draws
  // ('' when the plan says no) and the surprise that replaces it, with the
  // moment they were decided. paint() resolves it ONCE and hands it to
  // paintSeason, so the moon and the scene can never disagree about the day.
  function routeOf(s, now) {
    var name = s.season || '';
    // The die is rolled here, not in read(): the key has to carry the day and
    // the outcome, so midnight re-rolls and a season that is "off" today
    // clears the container instead of leaving yesterday's field up.
    var plan = plannedFor(name, now);
    if (!plan.show) name = '';

    // ---- the surprise selector
    // ONE routing decision, in one place. `existingActive` is passed ONLY when
    // the existing season's own plan.show is true -- not merely because
    // the holiday season says Christmas -- or a rare surprise would lose to a
    // season that was not going to draw anything today anyway.
    //
    // seasonOf() already returns '' when the seasonal switch is off, so
    // the gate is carried here explicitly for the days when no season is
    // running at all and only a surprise could fire.
    var chosen = surpriseFor(now, {
      seasonalEnabled: s.seasonalOn !== false,
      enabled: INSTALLED,
      existingActive: name || null
    });
    var surprise = (chosen && chosen.reason !== 'existing-season') ? chosen.id : '';
    if (SURPRISE_FORCE) surprise = SURPRISE_FORCE;
    // previewing a season: today's own surprise (a birthday) must not replace it
    if (PREVIEW && PREVIEW_SEASONS[PREVIEW.id]) surprise = '';
    // A surprise REPLACES the seasonal scene for the day rather than stacking
    // on it. Birthday over Christmas is the deliberate case.
    if (surprise) name = '';
    return { now: now, plan: plan, name: name, surprise: surprise };
  }

  // Rebuild only when the KEY changes. The key carries the season and whether
  // it is night, because the Halloween night extras (branches, bats, witch,
  // ground fog) come and go with the sun -- and nothing else, so the field is
  // stable across the 3s tick and across navigation.
  function paintSeason(el, s, W, H, moonS, moonXf, moonYf, route) {
    var host = el.querySelector('.season');
    if (!host) return [];
    // THE FORECAST SCREENSAVER'S OWN SKY (scene() below) stands its landscape
    // where the frames would be: it keeps everything that MOVES -- leaves,
    // bats, the witch, the sleigh, snow, the surprises' particles and flybys --
    // and leaves out the full-frame art (canopy, branches, cobweb, ground fog,
    // the Christmas garland, a surprise's frame). The land itself dresses up
    // instead (holidayLand).
    var landed = el.classList.contains('own');
    // Taller than wide: frames keep their shape (see .narrow in the CSS).
    host.classList.toggle('narrow', W < H);
    route = route || routeOf(s, new Date());
    var now = route.now, plan = route.plan;
    var name = route.name, surprise = route.surprise;
    var night = s.elev < -4;
    var spooky = name === 'halloween' && night && plan.spooky;
    // what the scene's land and lights follow (holidayOf)
    el._hkHoliday = { name: name, surprise: surprise, spooky: spooky };
    var nearTheme = nearThemeOf(el, s, route);
    // LIVELINESS: the occasion whose settings apply -- the holiday or the
    // surprise, else the woodland season itself -- and a rebuild when any of
    // them changes (L.sig), never otherwise
    var L = lvOf(s);
    if (nearTheme) {
      var occ = surprise || name || nearTheme;
      if (!el._hkNear || el._hkNearTheme !== nearTheme || el._hkNearLv !== L.sigFor(occ) + '|' + occ) {
        if (el._hkNear) el._hkNear.dispose();
        host.textContent = '';
        el._hkSeasonKey = null;
        el._hkNear = mountNearScenery(el, nearTheme, occ, L);
        el._hkNearTheme = nearTheme;
        el._hkNearLv = L.sigFor(occ) + '|' + occ;
      }
      el._hkNear.update(Object.assign({}, s, { spooky: nearTheme === 'halloween' ? spooky : true, now: now }));
      var measured = NEAR_LIGHT[nearTheme];
      return [[measured[0], measured[1] * Number(el._hkNear.root.style.getPropertyValue('--scene-b'))]];
    }
    if (el._hkNear) {
      el._hkNear.dispose();
      el._hkNear = null;
      el._hkNearTheme = null;
      el._hkNearLv = null;
    }
    var lvOcc = surprise || name;
    host.classList.toggle('lv-quiet', L.quiet);
    host.classList.toggle('lv-still', !L.on(lvOcc, 'lights'));
    // Decorative snow stands down when it is actually snowing, or the weather
    // deck and this field composite into a doubled blizzard.
    var snowOK = s.weather !== false && !(s.wet && s.wet.kind === 'snow' && s.wet.rate > 0);

    // ---- scene lighting, applied EVERY paint and never baked
    // A continuous ramp on real sun elevation, not the binary `night` above:
    // dusk has to be gradual, and anything baked at build time can only change
    // by rebuilding the field, which resets every leaf mid-fall.
    var t = clamp((s.elev + 8) / 14, 0, 1);
    var dim = (s.cover > 0.75 || (s.wet && s.wet.rate >= 0.7)) ? 0.78 : 1;
    host.style.setProperty('--lbri', ((0.24 + 0.76 * t) * dim).toFixed(3));
    host.style.setProperty('--lsat', (0.46 + 0.54 * t).toFixed(3));
    host.style.setProperty('--lopa', (0.32 + 0.32 * t).toFixed(3));

    // Wind is BUCKETED, because it feeds animation durations and a duration
    // change retimes the animation -- applied continuously, every weather
    // update would visibly restart the field. 6 mph steps, clamped to 25.
    var windB = Math.round(clamp(s.wind, 0, 25) / 6) * 6;
    // Coarse density class only: heavy precipitation thins the leaves out, but
    // drizzle must not trigger a rebuild.
    var heavy = !!(s.wet && s.wet.rate >= 0.7);
    // The moon's center is in the key because the witch is laid out against
    // it: without it she would keep the trajectory from whichever paint first
    // built her. (While spooky it is a fixed 70%/24%, so it never changes.)
    //
    // Wind and heavy precipitation are NOT in a spooky key: they size the leaf
    // field, which a spooky night does not draw, and with them in the key every
    // weather update that crossed a wind bucket would rebuild the scene --
    // restarting the witch's cycle mid-flight.
    // `night` is deliberately NOT in this key. With the leaf brightness baked
    // at build it would have to be, and the entire field would be torn down
    // and rebuilt at the instant elevation crossed -4, in full view. The
    // lighting is a live variable, so only `spooky` (which implies night)
    // needs to force a rebuild, and that is a real scene change anyway.
    // the sleigh crosses the screensaver's Christmas moon (paint())
    var xmasNight = landed && name === 'christmas' && night;
    var moonKeyed = spooky || xmasNight;
    var key = name + '|' + surprise + '|' + (spooky ? 's' : '-') +
              '|' + (night ? 'n' : 'd') + '|' + (s.weather === false ? 'dry' : 'weather') +
              '|' + dayKey(now) + '|' + Math.round(W) + 'x' + Math.round(H) +
              '|' + (moonKeyed ? Math.round(moonXf * 1000) + ',' +
                                 Math.round(moonYf * 1000) + ',' + moonS : 0) +
              '|' + (name === 'christmas' && snowOK ? 'w' : '-') +
              '|' + (spooky ? '-' : windB + (heavy ? 'h' : '-')) + '|' + L.sigFor(lvOcc);

    if (el._hkSeasonKey !== key) {
      el._hkSeasonKey = key;
      host.textContent = '';
      // One seed per season per day: stable while you navigate, different
      // tomorrow, and identical on every screen on the same day.
      // dayKey is the LOCAL day -- Date.now()/864e5 is the UTC day and rolls
      // over at 8pm local, which would rebuild the field in front of you
      // every evening.
      var rnd = rng(dayKey(now) + name.length * 7919);

      if (name === 'halloween' || name === 'thanksgiving') {
        // The leafy canopy is the ORDINARY fall treatment. Spooky nights strip
        // the tree bare, so the two are mutually exclusive -- never stacked.
        //
        // AND NO LEAVES ON A SPOOKY NIGHT EITHER, for two reasons that agree.
        //
        // The scene is already bare branches; leaves falling off a bare tree
        // does not cohere. The leaf field belongs to the ordinary fall
        // treatment, which still runs all day and all through Thanksgiving --
        // the two-sided tumble is not lost anywhere you actually watch it.
        //
        // And leaves make spooky FRAGILE. 18 leaves are 36 two-sided faces,
        // each a filtered render surface with preserve-3d and
        // backface-visibility: the most expensive construction in the sky.
        // Measured on a wall tablet under load, four runs, order
        // alternated: with leaves the MEDIAN frame rate was 30.2, 30.3, 30.2,
        // 30.2 -- half of every frame doubled -- and without them 59.9 in three
        // of four. On a cool tablet spooky holds 60.2 either way; the leaves are
        // what tip it over once the device is already working.
        if (!spooky && !landed) canopyLayer(host);
        var more = name === 'thanksgiving';
        if (!spooky) leafField(host, W, H, {
          // Heavy rain or snow thins the field right out: a full autumn fall
          // through a downpour reads as two weather systems at once.
          count: heavy ? 6 : (more ? 22 : 16),
          fallMin: more ? 16 : 19,
          fallMax: more ? 30 : 36,
          wind: windB,
          many: L.many(lvOcc, 'leaves'), seed: 7927
        }, rnd);
      }
      if (spooky) {
        if (s.weather !== false) fogWisps(host, rnd, L.on(lvOcc, 'mist'));
        batField(host, W, 3, rnd, L.many(lvOcc, 'bats'));
        // The RESOLVED moon center, not a guess, so she and the moon always
        // agree. Appended before the branches to match the depth order -- but
        // the z-index rules are what enforce it. The branches and cobweb draw
        // nothing random, so building her ahead of them leaves every other
        // value from rnd() unaffected.
        witchFly(host, W, H, moonS, moonXf, moonYf, rnd, L.cycle(lvOcc, 'witch'));
        if (!landed) {
          branchLayer(host);
          cobweb(host, W);
          if (s.weather !== false) {
            var gf = document.createElement('div');
            gf.className = 'gfog';
            gf.style.setProperty('--gfo', '0.9');
            host.insertBefore(gf, host.firstChild);
          }
        }
      }
      if (name === 'christmas') cozyWindow(host, W, H, rnd, snowOK, landed,
        xmasNight ? { s: moonS, x: moonXf, y: moonYf } : null, lvOcc, L);
      if (surprise) surpriseScene(host, W, H, surprise, night, heavy, rnd, landed, lvOcc, L);
    }

    // ---- contribution to the luminance estimate
    // Same arithmetic as the cloud decks: the texture's mean alpha times the
    // fraction of the frame the element covers is what it actually composites.
    var cover = [];
    if (name === 'halloween' || name === 'thanksgiving') {
      // The canopy DOMINATES the fall estimate -- full frame, so its mean
      // alpha is its coverage outright, no box fraction. Its luma carries the
      // same brightness ramp the layer is actually drawn with, because a lit
      // canopy and a near-silhouette one do not composite the same.
      var lit = (0.24 + 0.76 * t) * dim;
      if (!spooky && !landed) cover.push([SEASON.canopyA, SEASON.canopyL * lit]);
      // n leaves of mean box area ~1852px^2 (the two-depth size in
      // leafField: 3/4 at 20-46px, 1/4 at 52-78px; sampled). Small, but this
      // is the only seasonal layer ever lit by a DAY sky, so it is not
      // dropped.
      var n = Math.max(6, Math.round(
        (heavy ? 6 : (name === 'thanksgiving' ? 22 : 16)) * (W / 1280)));
      // Not when spooky: the field is not built then (see paintSeason).
      if (!spooky) cover.push([n * 1852 / (W * H) * SEASON.leafA * (0.32 + 0.32 * t),
                               SEASON.leafL * lit]);
    }
    if (spooky) {
      // The moon FIRST, because it is the brightest thing here and the order
      // matters to an alpha composite. Its box is MOON_PX square.
      cover.push([MOON_PX * MOON_PX / (W * H) * SEASON.moonA * 0.78, SEASON.moonL]);
      // Branches cover the WHOLE frame -- 0.214 mean alpha at 0.78 opacity.
      // Luma 18 rather than pure black, so it still darkens hard but is not a
      // hole.
      if (!landed) cover.push([SEASON.branchA * 0.78, SEASON.branchL]);
      // Two mist instances, each ~125% wide by ~25% tall at ~0.135 opacity.
      if (s.weather !== false) {
        cover.push([1.25 * 0.25 * SEASON.fogA * 0.135, SEASON.fogL]);
        cover.push([1.25 * 0.25 * SEASON.fogA * 0.135, SEASON.fogL]);
      }
      // The web is kept in the estimate only because it is trivial to carry;
      // at 0.019 alpha over 1.7% of the frame it rounds away.
      cover.push([0.13 * 0.13 * SEASON.webA * 0.28, SEASON.webL]);
    }
    if (surprise) {
      var sc = SURPRISE[surprise];
      // The frame covers the whole viewport, so its mean alpha IS its coverage,
      // scaled by the .sp-frame opacity and lit by the same ramp as everything
      // else in .season.
      var slit = (0.24 + 0.76 * t) * dim;
      if (sc.frame && !landed) cover.push([sc.a * 0.86, sc.l * slit]);
      // Particles: n boxes averaging ~14px (sparkle ~3.5px), times the kind's
      // own mean alpha. Small, and carried so its absence is not mistaken for
      // an oversight.
      var pk = SP_PART[sc.part || sc.kind] || SP_PART.sparkle;
      var pn = Math.max(3, Math.round(
        (heavy ? Math.min(4, sc.count) : sc.count) * (W / 1280)));
      var pbox = sc.kind === 'sparkle' ? 12 : 196;
      cover.push([pn * pbox / (W * H) * pk.a * 0.5, pk.l * slit]);
    }
    if (name === 'christmas') {
      // The decoration master covers the WHOLE frame, so its mean alpha IS
      // its coverage -- no box fraction to apply. At luma 64 it sits BELOW a
      // daytime sky, so it darkens by day and lifts only slightly at night.
      if (!landed) cover.push([SEASON.decorA, SEASON.decorL]);
      // 20 halos in 32px boxes. The radial mask passes only the soft core --
      // roughly 7% of each box survives it -- and the twinkle averages well
      // under its 0.55 peak. This rounds away against CAP and is carried only
      // because leaving it out would look like an oversight.
      cover.push([20 * 32 * 32 / (W * H) * SEASON.xglowA * 0.07 * 0.12,
                  SEASON.xglowL]);
      if (snowOK) {
        // ~28 flakes averaging ~5px: about 700px^2 of a 1024000px^2 frame.
        var sn = Math.max(8, Math.round(28 * (W / 1280)));
        cover.push([sn * 25 / (W * H) * SEASON.snowA * 0.4, SEASON.snowL]);
      }
      // Santa is black and crosses for 7% of a 200s cycle. Time-averaged he is
      // far below the rounding on CAP; he is here for completeness.
      cover.push([0.0144 * SEASON.sleighA * 0.85 * 0.07, 0]);
    }
    return cover;
  }

  // THE LAYERS, bottom to top. `land`: the forecast screensaver's landscape
  // (scene() below), over the clouds and under the fog, rain and snow, so
  // the weather falls in front of the hills.
  function layersHtml(land) {
    return '<div class="grad"></div>' +
    // THE ALBUM COVER, for the Play Music page. Over the gradient so the
    // palette is its floor -- a cover that fails to load, or a page with
    // nothing playing, simply leaves the purple showing -- and under
    // everything else so grain and the scrim treat it like any other sky.
    '<div class="art"></div>' +
    '<div class="glow"></div>' +
    '<div class="stars"></div>' +
    // the screensaver's own: twinkling stars and the odd shooting star
    (land ? '<div class="twk"></div>' : '') +
    '<div class="moon"></div>' +
    '<div class="cl a"></div>' +
    '<div class="cl b"></div>' +
    '<div class="cl c"></div>' +
    '<div class="rcl"></div>' +
    (land ? '<div class="land"><i></i><i></i></div>' +
            // THE LAND'S OWN BOX: the art's 2560x1600 frame as `cover` lays
            // it out, so anything placed on the land (a holiday's lights, the
            // birthday balloons, fireflies, fireworks over the hills) is
            // placed in the art's own pixels and lands where the art has it
            '<div class="lbox"><div class="hl"><b><i></i><i></i></b></div>' +
            '<div class="hx"></div><div class="bx"></div><div class="life"></div></div>' : '') +
    '<div class="fog"></div>' +
    '<div class="rain"></div>' +
    '<div class="snow s1"></div>' +
    '<div class="snow s2"></div>' +
    '<div class="bolt"></div>' +
    // BEFORE grain and scrim, so the seasonal layers are capped with the
    // rest of the sky rather than floating over CAP.
    '<div class="season"></div>' +
    '<div class="grain"></div>' +
    '<div class="scrim"></div>';
  }

  function build(host) {
    var el = document.createElement('div');
    el.id = 'hk-sky';
    el.innerHTML = layersHtml(false);

    // AFTER hui-view-background, so equal z-index resolves in our favor.
    var bg = SH.viewBackground(host);
    if (bg && bg.nextSibling) host.insertBefore(el, bg.nextSibling);
    else if (bg) host.appendChild(el);
    else host.insertBefore(el, host.firstChild);
    // After insertion: getRootNode() has to see the real shadow root.
    attachStyles(el);
    return el;
  }

  // A SKY OF ITS OWN (HK Frontend 1.3): the forecast screensaver's
  // (hk-saver.js). The page's sky is ONE element in the view, hidden and still
  // behind any screensaver; this is a second one, built into the screensaver's
  // own shadow root with its own stylesheet, painted by the same paint() from
  // the same read() -- so it is the same live sky, weather and all -- plus a
  // landscape (tools/sky/src/land/, frontend/sky/land-*.webp) between the
  // clouds and the falling weather. paint() keeps its per-element state on the
  // element (el._hkSeasonKey), so the two never disturb each other.
  //
  //   var sc = hkSky.scene(container);  sc.update(client);  sc.pause(true);  sc.destroy();
  var OWN_CSS = [
    '#hk-sky.own{z-index:0}',
    '#hk-sky.own.skyonly .land,#hk-sky.own.skyonly .lbox,#hk-sky.own.skyonly .season,#hk-sky.own.skyonly .near-scenery{display:none}',
    '#hk-sky .land>i{position:absolute;inset:0;background-repeat:no-repeat;',
    '  background-position:center bottom;background-size:cover;opacity:0;',
    '  transition:opacity 4s ease;filter:brightness(var(--landB,1));will-change:opacity}',
    '#hk-sky .land>i.on{opacity:1}',
    // with a landscape, the horizon colour belongs where the land meets the
    // sky (the art's horizon is at ~60%), and the season's frame gives way to
    // the season's own land
    '#hk-sky.own.landed .grad{background:linear-gradient(to bottom,',
    '  var(--sk0) 0%,var(--sk1) 24%,var(--sk2) 44%,var(--sk3) 62%)}',
    // (the seasonal layer stays: paintSeason leaves its frames out here)
    // ---- twinkling stars: brighter stars over the star texture, each on its
    // own slow scintillation, faded with the stars (--starO)
    '#hk-sky .twk{opacity:var(--starO,0);transition:opacity 6s linear}',
    '#hk-sky .twk .st{position:absolute;width:var(--s);height:var(--s);',
    '  margin:calc(var(--s) / -2) 0 0 calc(var(--s) / -2);border-radius:50%;',
    '  background:#f6f8ff;box-shadow:0 0 calc(var(--s) * 2.2) rgba(214,226,255,.75);',
    '  opacity:.3;animation:hk-twk1 var(--td) ease-in-out var(--tdel) infinite}',
    // LONG LOOPS, several twinkles each. Every loop's end is a trip to the
    // main thread (the animation's timing is re-synced there), so 34 stars on
    // 3-9 s loops re-styled the page ~24 times a second; on 36-64 s loops
    // holding three or four twinkles, about twice. The same goes for every
    // flame, bulb and firefly below.
    '@keyframes hk-twk1{0%,100%{opacity:.3}6.5%{opacity:.3}8%{opacity:var(--pk)}10.5%{opacity:.3}34.5%{opacity:.3}36%{opacity:var(--pk)}38.5%{opacity:.3}61.5%{opacity:.3}63%{opacity:var(--pk)}65.5%{opacity:.3}86.5%{opacity:.3}88%{opacity:var(--pk)}90.5%{opacity:.3}}',
    '@keyframes hk-twk2{0%,100%{opacity:.3}13.5%{opacity:.3}15%{opacity:var(--pk)}17.5%{opacity:.3}45.5%{opacity:.3}47%{opacity:var(--pk)}49.5%{opacity:.3}69.5%{opacity:.3}71%{opacity:var(--pk)}73.5%{opacity:.3}}',
    '@keyframes hk-twk3{0%,100%{opacity:.3}21.5%{opacity:.3}23%{opacity:var(--pk)}25.5%{opacity:.3}53.5%{opacity:.3}55%{opacity:var(--pk)}57.5%{opacity:.3}80.5%{opacity:.3}82%{opacity:var(--pk)}84.5%{opacity:.3}}',
    // ---- shooting stars: parked at opacity 0 for all but ~1.5% of a long
    // cycle, then a streak along the element's own rotated x-axis. Only on a
    // clear night (.meteors); each crossing re-aims the next (meteorAim)
    '#hk-sky .twk .ss{position:absolute;width:0;height:0;display:none;',
    '  transform:rotate(var(--a))}',
    '#hk-sky.meteors .twk .ss{display:block}',
    '#hk-sky .twk .ss i{position:absolute;right:0;top:-1px;width:var(--len);height:2px;',
    '  border-radius:2px;background:linear-gradient(to right,rgba(236,242,255,0),',
    '  rgba(236,242,255,.55) 70%,#fff);box-shadow:0 0 6px rgba(214,226,255,.6);',
    '  opacity:0;will-change:transform,opacity;',
    '  animation:hk-meteor var(--md) linear var(--mdel) infinite}',
    '@keyframes hk-meteor{0%{transform:translate3d(0,0,0);opacity:0}',
    '  .2%{opacity:1}.9%{opacity:.85}1.2%,100%{transform:translate3d(var(--run),0,0);opacity:0}}',
    // ---- the land's box (see layersHtml)
    // Centred by its LEFT, never a transform: under a transformed box the
    // flames, bulbs and fireflies stop animating on the compositor and redo
    // the page's style every frame (measured: 26 recalcs a second against 2)
    '#hk-sky .lbox{inset:auto;left:calc(50% - var(--lbw,100%) / 2);bottom:0;',
    '  width:var(--lbw,100%);height:var(--lbh,100%)}',
    '#hk-sky .lbox>*{position:absolute;inset:0}',
    // a holiday's LIGHTS LAYER: the full glow over the land's embers, two
    // layers cross-fading like the land's, dimmed with the land
    '#hk-sky .hl{opacity:var(--hlO,0);transition:opacity 4s ease;filter:brightness(var(--hlB,1))}',
    '#hk-sky .hl b,#hk-sky .hl i{position:absolute;inset:0}',
    '#hk-sky .hl i{background:center/100% 100% no-repeat;opacity:0;transition:opacity 4s ease}',
    '#hk-sky .hl i.on{opacity:1}',
    // candles gutter; café lights breathe
    '#hk-sky .hl.flick b{animation:hk-hlflick 17s linear infinite}',
    '@keyframes hk-hlflick{0%,100%{opacity:1}3%{opacity:.86}4%{opacity:.97}10%{opacity:.9}',
    '  12%{opacity:1}18%{opacity:.84}20%{opacity:.95}29%{opacity:.88}31%{opacity:1}',
    '  40%{opacity:.85}42%{opacity:.96}53%{opacity:.9}55%{opacity:1}63%{opacity:.83}',
    '  66%{opacity:.97}75%{opacity:.89}77%{opacity:1}86%{opacity:.86}89%{opacity:.98}}',
    '#hk-sky .hl.breathe b{animation:hk-hlbreathe 16s ease-in-out infinite alternate}',
    '@keyframes hk-hlbreathe{from{opacity:.84}to{opacity:1}}',
    // one candle's own flame, and one bulb's twinkle, from the art's list
    '#hk-sky .hx>*{position:absolute;aspect-ratio:1;transform:translate(-50%,-50%);',
    '  border-radius:50%;opacity:0;will-change:opacity}',
    '#hk-sky .hx .cf{background:radial-gradient(circle,rgba(255,190,96,.62) 0,',
    '  rgba(255,138,40,.26) 32%,rgba(255,110,20,0) 68%);',
    '  animation:hk-candle var(--cd) linear var(--cdl) infinite}',
    '@keyframes hk-candle{0%,100%{opacity:.55}3%{opacity:.85}5%{opacity:.5}9%{opacity:.75}',
    '  12%{opacity:.62}16%{opacity:.95}19%{opacity:.58}24%{opacity:.8}27%{opacity:.66}',
    '  31%{opacity:.9}33%{opacity:.52}38%{opacity:.7}43%{opacity:.6}46%{opacity:.92}',
    '  50%{opacity:.64}54%{opacity:.82}57%{opacity:.5}62%{opacity:.78}66%{opacity:.6}',
    '  71%{opacity:.97}74%{opacity:.62}79%{opacity:.84}83%{opacity:.55}88%{opacity:.76}',
    '  92%{opacity:.6}96%{opacity:.88}}',
    '#hk-sky .hx .tw{background:radial-gradient(circle,#fff6e6 0,rgba(255,236,200,.9) 12%,',
    '  rgba(255,196,120,.35) 30%,rgba(255,170,90,0) 60%);',
    '  animation:hk-bulb var(--td) ease-in-out var(--tdel) infinite}',
'@keyframes hk-bulb{0%,100%{opacity:0}7%{opacity:0}12%{opacity:var(--pk)}21%{opacity:0}40%{opacity:0}45%{opacity:var(--pk)}54%{opacity:0}73%{opacity:0}78%{opacity:var(--pk)}87%{opacity:0}}',
    // the birthday balloons, each cluster swaying on its own knot
    '#hk-sky .bx .bprops{position:absolute;inset:auto;background:center/100% 100% no-repeat;',
    '  filter:brightness(var(--landB,1))}',
    '#hk-sky .bx .bprops.glow{filter:none;mix-blend-mode:screen}',
    '#hk-sky .bx .bln{position:absolute;inset:auto;background:center/100% 100% no-repeat;',
    '  transform-origin:var(--ox) var(--oy);will-change:transform;',
    '  transition:background-image 4s ease;filter:brightness(var(--landB,1));',
    '  animation:hk-sway var(--sd) ease-in-out var(--sdl) infinite alternate}',
    '@keyframes hk-sway{from{transform:rotate(var(--r0))}to{transform:rotate(var(--r1))}}',
    // fireflies over the meadow on a summer night: a slow wander and a blink
    '#hk-sky .life .ff{position:absolute;width:0;height:0;will-change:transform;',
    '  animation:hk-ffwander var(--wd) ease-in-out var(--wdl) infinite}',
    '#hk-sky .life .ff i{position:absolute;left:-2.5px;top:-2.5px;width:5px;height:5px;',
    '  border-radius:50%;background:#f6ffc4;',
    '  box-shadow:0 0 7px 3px rgba(220,255,120,.8),0 0 22px 8px rgba(196,255,96,.3);',
    '  opacity:0;animation:hk-ffblink1 var(--bd) ease-in-out var(--bdl) infinite}',
    '@keyframes hk-ffwander{0%,100%{transform:translate3d(0,0,0)}',
    '  17%{transform:translate3d(var(--dx1),var(--dy1),0)}',
    '  33%{transform:translate3d(var(--dx2),var(--dy2),0)}',
    '  50%{transform:translate3d(var(--dx3),var(--dy3),0)}',
    '  67%{transform:translate3d(var(--dx4),var(--dy4),0)}',
    '  83%{transform:translate3d(var(--dx5),var(--dy5),0)}}',
    '@keyframes hk-ffblink1{0%,100%{opacity:0}4.5%{opacity:0}6%{opacity:1}8%{opacity:.85}10.5%{opacity:0}17.5%{opacity:0}19%{opacity:1}21%{opacity:.85}23.5%{opacity:0}29.5%{opacity:0}31%{opacity:1}33%{opacity:.85}35.5%{opacity:0}45.5%{opacity:0}47%{opacity:1}49%{opacity:.85}51.5%{opacity:0}56.5%{opacity:0}58%{opacity:1}60%{opacity:.85}62.5%{opacity:0}71.5%{opacity:0}73%{opacity:1}75%{opacity:.85}77.5%{opacity:0}84.5%{opacity:0}86%{opacity:1}88%{opacity:.85}90.5%{opacity:0}}',
    '@keyframes hk-ffblink2{0%,100%{opacity:0}1.5%{opacity:0}3%{opacity:1}5%{opacity:.85}7.5%{opacity:0}13.5%{opacity:0}15%{opacity:1}17%{opacity:.85}19.5%{opacity:0}26.5%{opacity:0}28%{opacity:1}30%{opacity:.85}32.5%{opacity:0}38.5%{opacity:0}40%{opacity:1}42%{opacity:.85}44.5%{opacity:0}53.5%{opacity:0}55%{opacity:1}57%{opacity:.85}59.5%{opacity:0}65.5%{opacity:0}67%{opacity:1}69%{opacity:.85}71.5%{opacity:0}78.5%{opacity:0}80%{opacity:1}82%{opacity:.85}84.5%{opacity:0}91.5%{opacity:0}93%{opacity:1}95%{opacity:.85}97.5%{opacity:0}}',
    // Fourth of July fireworks over the hills: one burst per element per
    // cycle, each cycle re-placed (fireworkAim)
    '#hk-sky .life .fw{position:absolute;aspect-ratio:1;opacity:0;',
    '  background:url(' + SP_ASSET.firework + ') center/contain no-repeat;',
    '  filter:hue-rotate(var(--hue)) saturate(1.3);will-change:transform,opacity;',
    '  animation:hk-fw var(--fd) ease-out var(--fdl) infinite}',
    '@keyframes hk-fw{0%{opacity:0;transform:translate(-50%,-50%) scale(.12)}',
    '  .5%{opacity:.95;transform:translate(-50%,-50%) scale(.75)}',
    '  4.5%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}',
    '  100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}',
    // HELD, NOT HIDDEN: the screensaver's sky pauses between forecast slides
    // (and under Fully's dark screensaver) without dropping its layers --
    // .hidden's will-change:auto took the land and the fog off their layers
    // at every slide's start and put them back at its end, and the WebView
    // re-rastered what sits above each time (the flicker at every turn)
    '#hk-sky.own.held *{animation-play-state:paused!important}',
    '@media (prefers-reduced-motion:reduce){#hk-sky .land>i{transition:none}}'
  ].join('');
  // The season of the LAND (not the holiday seasons of seasonOf): by the
  // month, flipped south of the equator; snow falling makes it winter.
  var LAND_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
                    'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
  var LAND_SOUTH = { winter: 'summer', summer: 'winter', spring: 'fall', fall: 'spring' };
  function landSeason(client, s, when) {
    if (s.land) return s.land;                 // a dev pin: hkSky._pin({land:'summer'})
    if (s.wet && s.wet.kind === 'snow' && s.wet.rate > 0) return 'winter';
    var north = LAND_MONTH[(when || new Date()).getMonth()];
    var lat = client && client.config && Number(client.config.latitude);
    return isFinite(lat) && lat < 0 ? LAND_SOUTH[north] : north;
  }
  // day above 6 degrees, dusk (and dawn) down to civil twilight, then night
  function landLight(elev) { return elev > 6 ? 'day' : (elev > -7 ? 'dusk' : 'night'); }
  function landFile(client, s, when) { return 'land-' + landSeason(client, s, when) + '-' + landLight(s.elev) + '.webp'; }

  // ------------------------------------------- the screensaver's own life
  // HK Frontend 1.5: what moves on the forecast screensaver beyond the page's
  // sky -- twinkling stars and the odd shooting star on a clear night,
  // fireflies over a summer meadow, and the holidays dressed onto the land
  // itself. All of it CSS animations on transform and opacity, built once per
  // key and held still with the rest of the scene (.held).
  var OWN_DRIFT = 1.8;               // the screensaver's clouds, x the page's
  var ART_W = 2560, ART_H = 1600;    // the landscapes' frame
  function ax(x) { return (x / ART_W * 100).toFixed(3) + '%'; }
  function ay(y) { return (y / ART_H * 100).toFixed(3) + '%'; }

  // frontend/sky/holiday.json (tools/sky/holiday_webp.py): where each
  // holiday's lights are and where the balloons are tied. Asked for once;
  // until it is here (or when it is not there at all) the lights still
  // glow, only without each flame and bulb of their own.
  var HOL = null, holAsked = false, holWait = [];
  function holData(cb) {
    if (HOL) return HOL;
    if (cb) holWait.push(cb);
    if (holAsked) return null;
    holAsked = true;
    var done = function (j) {
      HOL = j || {};
      holWait.splice(0).forEach(function (f) { try { f(); } catch (e) { /* its scene is gone */ } });
    };
    try {
      fetch(BASE + 'holiday.json' + VER, { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(done, function () { done({}); });
    } catch (e) { done({}); }
    return null;
  }

  // THE HOLIDAY LANDS (tools/sky/src/land-holiday/): the season's own place,
  // decorated. Whatever paintSeason decided today (el._hkHoliday) -- a season
  // that is showing, or a surprise that replaced it -- picks the land:
  //   Halloween      its lanterns and pumpkins, day (when the art has a day:
  //                  land-halloween-day, else plain fall), dusk and night
  //   Christmas      its lights, day, dusk and night
  //   Fourth of July its bunting and flag, day, dusk and night
  //   a birthday     the season's own land, with balloons (holidayBalloons)
  function holidayLand(h, light) {
    if (!h) return null;
    if (h.surprise === 'fourth-of-july') return 'land-july4-' + light;
    if (h.surprise) return null;
    if (h.name === 'halloween') return 'land-halloween-' + light;
    if (h.name === 'christmas') return 'land-christmas-' + light;
    return null;
  }
  // ...and its lights layer: the full glow over the land's embers. July 4 at
  // dusk borrows the night's, fainter.
  function holidayLights(h, light) {
    if (!h || light === 'day') return null;
    var dusk = light === 'dusk';
    if (h.surprise === 'fourth-of-july') return { file: 'land-july4-night-lights', o: dusk ? 0.6 : 1, mode: 'breathe' };
    if (h.surprise) return null;
    if (h.name === 'halloween') return { file: 'land-halloween-' + light + '-lights', o: dusk ? 0.8 : 1, mode: 'flick' };
    if (h.name === 'christmas') return { file: 'land-christmas-' + light + '-lights', o: dusk ? 0.85 : 1, mode: 'twinkle' };
    return null;
  }

  // TWINKLING STARS. Brighter stars than the texture's, each scintillating
  // on its own period, and two shooting stars on long cycles (127 and 193 s,
  // so together one about every 77 s of a clear night) that re-aim at random
  // after every crossing: never the same streak twice.
  var METEOR_CYCLES = [127, 193];

  // RE-AIMED IN THE DARK, FROM A TIMER -- NEVER AN animationiteration
  // LISTENER. One such listener anywhere in the document makes Chromium wake
  // the main thread at every loop end of EVERY CSS animation on the page --
  // every bat wing, candle and twinkle -- for the life of the page; the flag
  // is never cleared (measured on a Halloween night: 18 -> 58 style recalcs a
  // second, busy 3.8 -> 7.0 %, from one listener on a detached element). The
  // screensaver's first forecast slide used to set it on every wall tablet.
  // So `el` is re-aimed once per loop of `anim`, read from its own clock, while
  // the loop is past its streak (which shows only at the loop's start) -- so a
  // sky the saver holds between slides can never move one mid-flight. A few
  // looks a minute: often while it runs, seldom while it is held.
  function reaim(el, anim, period, aim) {
    var ms = period * 1000, seen = false, done = null;
    var RUN = Math.min(5000, ms / 4), HELD = 15000;
    function tick() {
      if (!el.isConnected) { if (!seen) setTimeout(tick, HELD); return; }   // rebuilt: stop
      seen = true;
      var a = anim.getAnimations ? anim.getAnimations()[0] : null;
      var t = a && a.playState === 'running' && a.effect ? a.effect.getComputedTiming() : null;
      if (!t || typeof t.progress !== 'number') { setTimeout(tick, HELD); return; }   // hidden or held
      if (t.currentIteration !== done && t.progress > 0.1 && t.progress < 0.9) { done = t.currentIteration; aim(); }
      setTimeout(tick, RUN);
    }
    setTimeout(tick, RUN);
  }
  function meteorAim(ss, rnd) {
    var right = rnd() < 0.5, a = 16 + rnd() * 24;
    ss.style.left = (right ? 8 + rnd() * 52 : 40 + rnd() * 52).toFixed(1) + '%';
    ss.style.top = (3 + rnd() * 24).toFixed(1) + '%';
    ss.style.setProperty('--a', (right ? a : 180 - a).toFixed(1) + 'deg');
    ss.style.setProperty('--run', (320 + rnd() * 360).toFixed(0) + 'px');
    ss.style.setProperty('--len', (90 + rnd() * 90).toFixed(0) + 'px');
  }
  function twinkles(host, W, H, rnd, L) {
    host.textContent = '';
    L = L || lvOf(null);
    var n = Math.round(clamp(34 * W / 1280, 18, 60));
    // (Liveliness, Night Sky: Twinkling Stars how many, Shooting Stars how often)
    lvThin(lvRange(n, lvCount(n, L.many('night', 'stars')), rnd, 7963, function (i, rnd, keep) {
      var d = document.createElement('div');
      d.className = 'st';
      d.style.left = (rnd() * 100).toFixed(2) + '%';
      // the upper sky: the land covers the rest
      d.style.top = (2 + Math.pow(rnd(), 1.3) * 50).toFixed(2) + '%';
      d.style.setProperty('--s', (1.3 + Math.pow(rnd(), 2) * 2.1).toFixed(2) + 'px');
      var td = 36 + rnd() * 28;
      d.style.animationName = 'hk-twk' + (i % 3 + 1);
      d.style.setProperty('--td', td.toFixed(1) + 's');
      d.style.setProperty('--tdel', (-rnd() * td).toFixed(1) + 's');
      d.style.setProperty('--pk', (0.6 + rnd() * 0.4).toFixed(2));
      if (!keep) return null;
      host.appendChild(d);
      return d;
    }));
    var mc = L.cycle('night', 'meteors');
    METEOR_CYCLES.forEach(function (md0) {
      var md = md0 * (mc || 1);
      var ss = document.createElement('div');
      ss.className = 'ss';
      var i = document.createElement('i');
      i.style.setProperty('--md', md + 's');
      // the first one 20-80 s after the scene is built, not on its first frame
      i.style.setProperty('--mdel', (-(md - 20 - rnd() * 60)).toFixed(1) + 's');
      meteorAim(ss, rnd);
      if (!mc) return;                   // Off: drawn for the streams after, never shown
      if (mc !== 1) lvCycleOn(i, host, 'hk-meteor', md0, mc, '--md');
      reaim(ss, i, md, function () { meteorAim(ss, Math.random); });
      ss.appendChild(i);
      host.appendChild(ss);
    });
  }

  // FIREFLIES: along the foot of the tree line and over the top of the
  // meadow (the art's y 830-1080), above the forecast's own place.
  function fireflies(host, W, rnd, occ, L) {
    L = L || lvOf(null);
    var n = Math.round(clamp(22 * W / 1280, 14, 36));
    lvThin(lvRange(n, lvCount(n, L.many(occ || 'summer', 'fireflies')), rnd, 7969, function (i, rnd, keep) {
      var f = document.createElement('div');
      f.className = 'ff';
      f.style.left = ax(160 + rnd() * 2240);
      f.style.top = ay(830 + rnd() * 250);
      // five waypoints around its spot, one long loop (see hk-twk1)
      for (var k = 1; k <= 5; k++) {
        f.style.setProperty('--dx' + k, (-55 + rnd() * 110).toFixed(0) + 'px');
        f.style.setProperty('--dy' + k, (-28 + rnd() * 50).toFixed(0) + 'px');
      }
      var wd = 50 + rnd() * 40, bd = 40 + rnd() * 24;
      f.style.setProperty('--wd', wd.toFixed(1) + 's');
      f.style.setProperty('--wdl', (-rnd() * wd).toFixed(1) + 's');
      var g = document.createElement('i');
      g.style.animationName = 'hk-ffblink' + (i % 2 + 1);
      g.style.setProperty('--bd', bd.toFixed(1) + 's');
      g.style.setProperty('--bdl', (-rnd() * bd).toFixed(1) + 's');
      f.appendChild(g);
      if (!keep) return null;
      host.appendChild(f);
      return f;
    }));
  }

  // FIREWORKS over the hills on the Fourth's night: five shells on prime-ish
  // cycles, so they never fall into a rhythm, each re-placed and re-coloured
  // after it bursts.
  var FW_CYCLES = [17, 19, 23, 29, 31];
  var FW_HUES = [0, 35, 150, 205, 285, 330];
  function fireworkAim(e, rnd) {
    e.style.left = (14 + rnd() * 66).toFixed(1) + '%';
    e.style.top = ay(300 + rnd() * 300);
    e.style.width = (9 + rnd() * 7).toFixed(1) + '%';
    e.style.setProperty('--hue', FW_HUES[Math.floor(rnd() * FW_HUES.length)] + 'deg');
  }
  function fireworks(host, rnd, L) {
    L = L || lvOf(null);
    var fc = L.cycle('fourth-of-july', 'fireworks');
    FW_CYCLES.forEach(function (fd0, k) {
      var fd = fd0 * (fc || 1);
      var e = document.createElement('div');
      e.className = 'fw';
      e.style.setProperty('--fd', fd + 's');
      e.style.setProperty('--fdl', (-(fd - 2 - k * 3.1 - rnd() * 3)).toFixed(1) + 's');
      fireworkAim(e, rnd);
      if (!fc) return;                   // Off: drawn, never shown
      if (fc !== 1) lvCycleOn(e, host, 'hk-fw', fd0, fc, '--fd');
      reaim(e, e, fd, function () { fireworkAim(e, Math.random); });
      host.appendChild(e);
    });
  }

  // A holiday's own flames and bulbs, from holiday.json's list for its lights
  // layer: every candle flickers on its own; sixty of the bulbs, picked
  // fresh each day, twinkle one at a time over the layer's steady glow.
  function holidayGlints(host, lit, rnd) {
    var list = HOL && HOL.lights && HOL.lights[lit.file];
    if (!list || !list.length) return;
    if (lit.mode === 'flick') {
      list.forEach(function (L) {
        var c = document.createElement('div');
        c.className = 'cf';
        c.style.left = ax(L[0]);
        c.style.top = ay(L[1]);
        c.style.width = ax(Math.max(L[2] * 7, 70));
        var cd = 14 + rnd() * 8;
        c.style.setProperty('--cd', cd.toFixed(1) + 's');
        c.style.setProperty('--cdl', (-rnd() * cd).toFixed(1) + 's');
        host.appendChild(c);
      });
    } else if (lit.mode === 'twinkle') {
      var pick = list.slice();
      for (var i = pick.length - 1; i > 0; i--) {
        var j = Math.floor(rnd() * (i + 1)), t = pick[i]; pick[i] = pick[j]; pick[j] = t;
      }
      pick.slice(0, 60).forEach(function (L) {
        var b = document.createElement('div');
        b.className = 'tw';
        b.style.left = ax(L[0]);
        b.style.top = ay(L[1]);
        // a bulb's own sparkle, not a halo: about four bulbs across
        b.style.width = ax(Math.max(L[2] * 5, 22));
        var td = 40 + rnd() * 30;
        b.style.setProperty('--td', td.toFixed(1) + 's');
        b.style.setProperty('--tdel', (-rnd() * td).toFixed(1) + 's');
        b.style.setProperty('--pk', (0.55 + rnd() * 0.45).toFixed(2));
        host.appendChild(b);
      });
    }
  }

  // THE BIRTHDAY BALLOONS: holiday.json's two clusters, each a sprite cut
  // from the overlay with its knot, drawn at its `scale` with the knot staked
  // at `at` (in the grass beside its tree), swaying a degree or two about it.
  function balloons(host, light, rnd) {
    var list = HOL && HOL.balloons;
    if (!list || !list.length) return;
    list.forEach(function (c) {
      var b = document.createElement('div');
      var k = c.scale || 1, at = c.at || c.knot;
      var w = c.box[2] * k, h = c.box[3] * k;
      var x = at[0] - (c.knot[0] - c.box[0]) * k, y = at[1] - (c.knot[1] - c.box[1]) * k;
      b.className = 'bln';
      b.dataset.cluster = c.cluster;
      b.style.left = ax(x);
      b.style.top = ay(y);
      b.style.width = ax(w);
      b.style.height = ay(h);
      b.style.backgroundImage = 'url("' + BASE + 'birthday-' + c.cluster + '-' + light + '.webp' + VER + '")';
      b.style.setProperty('--ox', ((at[0] - x) / w * 100).toFixed(2) + '%');
      b.style.setProperty('--oy', ((at[1] - y) / h * 100).toFixed(2) + '%');
      var r = 1.4 + rnd() * 1.2;
      b.style.setProperty('--r0', (-r).toFixed(2) + 'deg');
      b.style.setProperty('--r1', (r * (0.8 + rnd() * 0.4)).toFixed(2) + 'deg');
      var sd = 4.5 + rnd() * 2.5;
      b.style.setProperty('--sd', sd.toFixed(1) + 's');
      b.style.setProperty('--sdl', (-rnd() * sd).toFixed(1) + 's');
      host.appendChild(b);
    });
  }

  // A BIRTHDAY'S PROPS (holiday.json props: cafe lights and presents), laid
  // over whichever season's land is showing, as the balloons are; their
  // glow over them at dusk and night.
  function birthdayProps(host, light) {
    var p = HOL && HOL.props;
    if (!p) return;
    var b = p.box;
    ['', light !== 'day' && (p.lights || []).indexOf(light) >= 0 ? '-lights' : null].forEach(function (suffix) {
      if (suffix === null) return;
      var d = document.createElement('div');
      d.className = 'bprops' + (suffix ? ' glow' : '');
      d.dataset.suffix = suffix;
      d.style.left = ax(b[0]); d.style.top = ay(b[1]);
      d.style.width = ax(b[2]); d.style.height = ay(b[3]);
      d.style.backgroundImage = 'url("' + BASE + 'birthday-props-' + light + suffix + '.webp' + VER + '")';
      host.appendChild(d);
    });
  }

  // A pair of layers that cross-fade to whatever image is asked for, once it
  // has decoded; the first of `list` that is there wins. (The land, and a
  // holiday's lights.)
  function fader(layers, shownCb) {
    var top = 0, shown = '', want = '', missing = {}, last = [];
    function show(list) {
      last = list;
      var file = null;
      for (var i = 0; i < list.length; i++) if (list[i] && !missing[list[i]]) { file = list[i]; break; }
      if (!file) {
        if (shown) { layers[top].classList.remove('on'); shown = ''; want = ''; }
        return;
      }
      if (file === shown || file === want) return;
      want = file;
      var url = BASE + file + VER, im = new Image();
      var ready = function () {
        if (want !== file || !layers[0].isConnected) return;
        var next = layers[1 - top];
        next.style.backgroundImage = 'url("' + url + '")';
        next.classList.add('on');
        layers[top].classList.remove('on');
        top = 1 - top; shown = file; want = '';
        if (shownCb) shownCb(file);
      };
      im.onload = function () { (im.decode ? im.decode().catch(function () {}) : Promise.resolve()).then(ready); };
      // art that is not there (not made yet, a 404): the next in the list
      im.onerror = function () { missing[file] = true; if (want === file) want = ''; show(last); };
      im.src = url;
    }
    return { show: show, shown: function () { return shown; } };
  }

  // opts.skyOnly (2026-10-13, the screensaver clock's Sky Only): the sky
  // alone -- clouds, stars, the moon, rain and snow -- with no land, no
  // holiday lights, no decorations
  function scene(host, opts) {
    var skyOnly = !!(opts && opts.skyOnly);
    var el = document.createElement('div');
    el.id = 'hk-sky';
    el.className = 'own' + (skyOnly ? ' skyonly' : '');
    el.innerHTML = layersHtml(true);
    host.appendChild(el);
    // its OWN sheet: attachStyles() keeps one module-level handle, the page
    // sky's, and must not lose it to this one
    var root = el.getRootNode(), own = null, tag = null;
    try {
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
        own = new CSSStyleSheet();
        own.replaceSync(SHEET + OWN_CSS);
        root.adoptedStyleSheets = root.adoptedStyleSheets.concat(own);
      }
    } catch (e) { own = null; }
    if (!own) {
      tag = document.createElement('style');
      tag.textContent = SHEET + OWN_CSS;
      (root.appendChild ? root : document.head).appendChild(tag);
    }
    // A landscape arrives decoded, then cross-fades in over the other layer.
    // Art that is not there (not installed yet, a 404) is simply no land: the
    // sky alone, with the season's frame, as on the pages. A holiday's land
    // that is not there is the season's own.
    // The saver updates the scene only when the sun or the weather changes,
    // so what arrives later -- a land, its lights, holiday.json -- carries on
    // from the last reading itself (again()).
    var last = null;
    // A resize -- an orientation change, an inset dashboard -- carries no
    // weather change, and the saver repaints only on a sun or weather change:
    // a rotated screensaver would otherwise keep its old season layout and
    // its old twinkles. Re-run both passes on a size change; the part() keys
    // and the faders dedupe, so nothing re-rolls or re-fades unless a size
    // actually changed. (Salvaged from the 2026-10-03 cloud commit, which
    // was reverted for its art, not for this.)
    var resize = typeof ResizeObserver === 'function' ? new ResizeObserver(function () {
      if (last && el.isConnected && el.clientWidth) { paint(el, last[1]); again(); }
    }) : null;
    if (resize) resize.observe(el);
    function again() { if (last && el.isConnected) alive(last[0], last[1]); }
    var landF = fader(el.querySelectorAll('.land > i'), function () { el.classList.add('landed'); again(); });
    var hlEl = el.querySelector('.hl');
    var lightF = fader(hlEl.querySelectorAll('i'), again);
    var box = el.querySelector('.lbox');
    var twk = el.querySelector('.twk'), hx = el.querySelector('.hx');
    var bx = el.querySelector('.bx'), life = el.querySelector('.life');
    var keys = {};
    holData(again);

    // Rebuild a part only when its key changes; the day is in each key so a
    // new day re-rolls the stars, the bulbs and the balloons' sway.
    function part(name, key, build) {
      if (keys[name] === key) return;
      keys[name] = key;
      build();
    }

    function alive(client, s) {
      last = [client, s];
      var W = el.clientWidth || 1280, H = el.clientHeight || 800;
      var k = Math.max(W / ART_W, H / ART_H);
      box.style.setProperty('--lbw', (ART_W * k).toFixed(1) + 'px');
      box.style.setProperty('--lbh', (ART_H * k).toFixed(1) + 'px');
      var now = new Date(), day = dayKey(now), size = Math.round(W) + 'x' + Math.round(H);
      var light = landLight(s.elev), h = el._hkHoliday || {};
      var wet = !!(s.wet && s.wet.rate > 0);

      // LIVELINESS: the screen's own (s.lively), in every part's key
      var L = lvOf(s);
      el.classList.toggle('lv-quiet', L.quiet);
      part('twk', day + '|' + size + '|' + L.sigFor('night'), function () { twinkles(twk, W, H, rng(day * 31 + 7), L); });
      var night = clamp((-4 - s.elev) / 10, 0, 1);
      el.classList.toggle('meteors', night > 0.6 && s.cover < 0.3 && !wet && !s.fog);

      var flies = landSeason(client, s) === 'summer' && s.elev < -5 && !wet && s.wind < 18;
      var fw = h.surprise === 'fourth-of-july' && s.elev < -4;
      part('life', day + '|' + (flies ? 'f' : '-') + (fw ? 'w' : '-') + '|' + size + '|' + L.sigFor('summer') + L.sigFor('fourth-of-july'), function () {
        life.textContent = '';
        var rnd = rng(day * 17 + 3);
        if (flies) fireflies(life, W, rnd, 'summer', L);
        if (fw) fireworks(life, rnd, L);
      });

      if (skyOnly) return;
      // the holiday's land, then -- once that land is the one showing -- its lights
      var hol = holidayLand(h, light);
      // (a holiday land the art does not have -- Halloween by day before v6 --
      // is missing, and the fader falls back to the season's own)
      landF.show(hol ? [hol + '.webp', landFile(client, s)] : [landFile(client, s)]);
      var lit = hol && landF.shown() === hol + '.webp' ? holidayLights(h, light) : null;
      lightF.show(lit ? [lit.file + '.webp'] : []);
      var lightsUp = !!(lit && lightF.shown() === lit.file + '.webp');
      hlEl.style.setProperty('--hlO', lightsUp ? String(lit.o) : '0');
      hlEl.classList.toggle('flick', !!(lit && lit.mode === 'flick'));
      hlEl.classList.toggle('breathe', !!(lit && lit.mode === 'breathe'));
      // Lights Off (the holiday's own): its candles and bulbs hold a steady glow
      el.classList.toggle('lv-still', !!(lit && !L.on(h.surprise || h.name, 'lights')));
      part('hx', day + '|' + (lightsUp ? lit.file : '') + '|' + (HOL ? 1 : 0), function () {
        hx.textContent = '';
        if (lightsUp) holidayGlints(hx, lit, rng(day * 13 + 5));
      });

      var bday = h.surprise === 'birthday';
      part('bx', day + '|' + (bday ? 'b' : '-') + '|' + (HOL ? 1 : 0) + '|' + light, function () {
        bx.textContent = '';
        if (bday) { birthdayProps(bx, light); balloons(bx, light, rng(day * 11 + 1)); }
      });
      // the balloons follow the light (their background-image cross-fades)
      // (the props are rebuilt when the light changes: bx's key has it)
      Array.prototype.forEach.call(bx.querySelectorAll('.bln'), function (b) {
        var url = 'url("' + BASE + 'birthday-' + b.dataset.cluster + '-' + light + '.webp' + VER + '")';
        if (b.style.backgroundImage !== url) b.style.backgroundImage = url;
      });
    }

    return {
      el: el,
      update: function (client) {
        if (!client || !client.states) return null;
        var s = read(client);
        if (skyOnly) s.season = '';            // no decorations either
        paint(el, s);
        // an overcast or wet day darkens the land with the sky
        var dim = 1 - 0.3 * clamp((s.cover - 0.4) / 0.6, 0, 1) - (s.wet && s.wet.rate > 0 ? 0.08 : 0);
        el.style.setProperty('--landB', dim.toFixed(3));
        hlEl.style.setProperty('--hlB', (0.85 + 0.15 * dim).toFixed(3));
        alive(client, s);
        return s;
      },
      // the screen is dark (Fully's own screensaver, the page hidden): hold still
      pause: function (on) { el.classList.toggle('held', !!on); },
      landShown: function () { return landF.shown(); },
      lightsShown: function () { return lightF.shown(); },
      destroy: function () {
        if (resize) resize.disconnect();
        el.remove();
        if (own && root.adoptedStyleSheets) {
          root.adoptedStyleSheets = root.adoptedStyleSheets.filter(function (x) { return x !== own; });
        }
        if (tag) tag.remove();
      }
    };
  }

  // EVERY falling layer is a TILED BITMAP, and a tiled bitmap is doubly
  // periodic -- it repeats every tile in x AND in y independently. So it loops
  // seamlessly only if BOTH components of the travel are whole multiples of
  // the tile, which is satisfied here by falling straight down exactly one.
  //
  // Aiming the travel along a CSS gradient's axis is the right rule for a
  // STRIPE pattern -- an infinite line translated along itself is invisible,
  // so only the component along the gradient axis has to divide -- but not
  // for a bitmap: a snow layer traveling (66.5, -313) on a 320px tile,
  // neither component dividing, SNAPS sideways by 66px on every loop, about
  // every 4.6 seconds.
  //
  // The lean is the deliberate casualty. Keeping one exactly seamless would
  // mean either rotating the layer -- which needs a far larger composited
  // surface than the "overhang by exactly the travel" rule in the header
  // allows -- or quantising the lean to whole tiles, which at plausible angles
  // snaps to either 0 or an absurd 45 degrees. Wind drives SPEED instead.
  // Rain falls straight too, which is wanted: angled as a full-height
  // gradient it reads as diagonal hatching rather than weather.
  // FALLING WEATHER, DRAWN INTO A CANVAS (2026-10-10). A rain or snow deck
  // is a layer taller than the screen that the GPU blends on every frame.
  // THE RAIN AT HALF the screen's own resolution, stretched: a quarter of the
  // texture to hold and to read each frame (on a 1920 x 1200 tablet ~15 MB
  // down to ~4 MB of the WebView's tile budget), and its soft streaks look
  // the same. THE SNOW AT FULL: halved, its small flakes went faint (compared
  // side by side at 1.5x). Drawn again only when the deck's size or tile
  // changes, and not while it is idle (nothing falling).
  var fallImgs = {};
  function fallImg(name) {
    var im = fallImgs[name];
    if (!im && typeof Image === 'undefined') return null;          // a test harness
    if (!im) { im = fallImgs[name] = new Image(); im.decoding = 'async'; im.src = BASE + name + VER; }
    return im.complete && im.naturalWidth ? im : null;
  }
  function fallDraw(deckEl, name, tile, res) {
    if (!deckEl) return;
    var cv = deckEl.firstElementChild;
    if (!cv || cv.localName !== 'canvas') { cv = document.createElement('canvas'); deckEl.appendChild(cv); }
    if (deckEl.classList.contains('idle')) return;
    var im = fallImg(name);
    // (the image not here yet: the next paint draws it -- or now, as it lands)
    var pend = fallImgs[name];
    if (!im) { if (pend && !pend.__hkWait) { pend.__hkWait = true; pend.addEventListener('load', function () { fallDraw(deckEl, name, tile, res); }); } return; }
    // (the scale a whole number of pixels a tile: no seams between them)
    var k = Math.max(1, Math.round(tile * Math.min(2, window.devicePixelRatio || 1) * res)) / tile;
    var w = Math.ceil((deckEl.offsetWidth || 0) * k), h = Math.ceil((deckEl.offsetHeight || 0) * k);
    if (!w || !h) return;
    var key = w + 'x' + h + '|' + tile + '|' + name + '|' + res;
    if (cv.__hkKey === key) return;
    cv.__hkKey = key; cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    // the tile at the canvas's scale, from the deck's top-left as a
    // background repeats -- the fall is a whole tile, so the loop is seamless
    var t = tile * k;
    ctx.imageSmoothingQuality = 'high';
    for (var y = 0; y < h; y += t) for (var x = 0; x < w; x += t) ctx.drawImage(im, x, y, t, t);
  }
  function fallTiled(styleObj, tile, periods, pxPerSec) {
    var dist = tile * periods;
    styleObj.setProperty('--fx', '0px');
    styleObj.setProperty('--fy', dist.toFixed(1) + 'px');
    styleObj.setProperty('--pad', (Math.ceil(dist) + 8) + 'px');
    styleObj.setProperty('--d', (dist / pxPerSec).toFixed(3) + 's');
  }

  // ------------------------------------------------------------------ paint
  // ------------------------------------------------------- realistic clouds
  // CLOUDS: REALISTIC (Sky / Background -> Clouds; sky.cloud_style, a
  // screen's sky_cloud_style; skyLook().cloudStyle). Photographic cut-outs in
  // place of the classic decks: 45 clouds in ten sets, each in five lightings
  // (tools/sky/cloud_art.py -> frontend/sky/clouds/, manifest.json measured
  // there). Classic stays the default and stays untouched: this is a second
  // renderer, chosen per screen, not a change to the first.
  //
  // NOTHING TILES AND NOTHING LOOPS. Each cloud crosses the sky ONCE, at its
  // depth's speed, and when it has left (animationend) it comes back as a
  // DIFFERENT cloud -- another of its set, mirrored to face the sun, scaled and
  // tilted a little, at another height in its band. The mix is the day's
  // (seeded by the date), so the sky is steady through a day and new the next.
  //
  // THE WHOLE SKY, DOWN TO THE HORIZON -- not a band along the top. Each set
  // has a band measured as a fraction of the horizon's depth: cirrus high,
  // the big cumulus overhead, smaller and flatter clouds lower, the far ones
  // just above it, haze on it. Lower is further, so it is also smaller. The
  // horizon is the scene's: the woodland's hills (NEAR_HORIZON), the forecast
  // landscape's (~60%), else the gradient's own (72%).
  //
  // THE TABLET'S BUDGET (hk_house/docs/NEW-DECORATIONS-PERF-2026-10-04.md):
  // at most ~28 clouds (most of them small and far), each one composited
  // layer moved by transform only --
  // no filter, no mask, nothing repainted per frame. The lighting is baked
  // into the art: a change of light fades the new lighting in OVER the old on
  // the cloud's second layer, then drops the old one, so only during that fade
  // does a cloud cost two layers. JavaScript runs when a cloud leaves the sky
  // and on the 3 s paint, never per frame.
  var RC_BASE = BASE + 'clouds/';
  // The manifest is fetched on the first paint that wants it, and the sky is
  // painted again the moment it arrives -- not at the next 3 s tick. Until
  // then the sky simply has no clouds: the classic decks are NOT shown in the
  // meantime (they would show for a few seconds and then swap). Only if it
  // cannot be had (RC_FAILED) do the classic decks stand in -- and only for a
  // while: it is asked for again a minute later, then every five (a tablet
  // that loaded while Home Assistant restarted kept Classic clouds until its
  // next reload, 2026-10-07 audit). The classic decks stay up during a retry,
  // so a sky never goes empty waiting for it.
  var RC_MAN = null, RC_LOADING = false, RC_FAILED = false, RC_RETRY = 0, RC_TRIES = 0;
  function rcManifest() {
    if (RC_MAN || RC_LOADING) return RC_MAN;
    if (RC_FAILED && Date.now() < RC_RETRY) return null;
    if (typeof fetch !== 'function') { RC_FAILED = true; RC_RETRY = Infinity; return null; }
    RC_LOADING = true;
    fetch(RC_BASE + 'manifest.json' + VER).then(function (r) {
      if (!r.ok) throw Error(r.status);
      return r.json();
    }).then(function (m) { RC_MAN = m; RC_FAILED = false; RC_LOADING = false; selfRender(); },
            function () {
              RC_FAILED = true; RC_LOADING = false; RC_TRIES++;
              RC_RETRY = Date.now() + (RC_TRIES === 1 ? 60000 : 300000);
              selfRender();
            });
    return null;
  }
  // set: [width at --near-u 1 (px; haze: the screen's 1.6), speed (x the
  // near deck's), band of its BASE (fractions of the horizon's depth, high to
  // low), opacity]
  var RC_SETS = {
    'cirrus':         [760, .40, [.12, .34], .85],
    'altocumulus':    [700, .45, [.22, .46], .8],
    'cumulus-near':   [640, 1.0, [.38, .60], 1],
    'stratocumulus':  [1000, .85, [.40, .66], 1],
    'cumulus-mid':    [400, .62, [.60, .82], .85],
    'cumulus-far':    [300, .32, [.90, 1.0], .65],
    'horizon-haze':   [0, .15, [.99, 1.04], .45],
    'cumulonimbus':   [300, .20, [.99, 1.02], .75],
    'overcast-patch': [640, .90, [.25, .75], .95],
    // v2 (CODEX-BRIEF-v2): rows of far cumulus on the horizon, long cirrus
    // streaks, ragged fractus drifting among the cumulus
    'cumulus-row':    [0, .18, [.95, 1.0], .75],
    'cirrus-streak':  [0, .40, [.08, .3], .6],
    'cumulus-fractus':[170, .7, [.45, .85], .6],
    // under an overcast: fractus as low scud, big, soft and quick
    'scud':           [820, 1.3, [.35, .8], .55]
  };
  // The woodland's horizon: where its hills meet the sky, measured on each
  // theme's art (1586 x 992) down the middle fifth.
  var NEAR_HORIZON = { summer: .708, fall: .569, winter: .596, spring: .574, halloween: .502,
                       christmas: .596, july4: .587, birthday: .578 };
  function rcWet(s) { return /rain|pour|snow|hail|sleet|lightning/.test(String(s.cond || '')); }
  // A THUNDERSTORM IS THE GREY LID, whatever cover the weather reports with
  // it: a storm under a broken, sunlit sky drew white cumulus and a white
  // tower on blue (2026-10-05) -- it should look grey and heavy.
  function rcCover(s) {
    var c = clamp(s.cover || 0, 0, 1);
    return /lightning/.test(String(s.cond || '')) ? Math.max(c, .9) : c;
  }
  // Which clouds the sky has: a few small far ones on a fair day, the big
  // cumulus and broken sheets as it clouds over, the overcast deck (with
  // darker masses drifting over it) when it is a lid.
  function rcPlan(s, r) {
    var c = rcCover(s), sets = [];
    function add(set, n) { for (var i = 0; i < n; i++) sets.push(set); }
    // (the deck alone: the darker masses drifting over it read as pasted
    // on -- their lit rims never match the deck under them)
    // FULL COVER: the deck as a ceiling in perspective (paintRealClouds), with
    // ragged scud drifting under it, faster, and haze on the horizon
    if (c >= .85 || (rcWet(s) && c >= .6)) {
      add('scud', rcWet(s) ? 5 : 3);
      add('horizon-haze', 1);
      return { deck: true, sets: sets };
    }
    // THE CUMULUS FIELD ('cu'): one cloud deck in perspective -- how many
    // grows with the cover; which cloud, how big and how high is decided per
    // cloud by its distance (rcDepth)
    add('cu', c < .04 ? (r() < .5 ? 1 : 0) : Math.min(20, Math.round(2 + c * 34)));
    // the cirrus: v2's long streaks, v1's tufts only now and then
    var wisps = c < .6 && r() < .6 ? (r() < .4 ? 2 : 1) : 0;
    for (var wi = 0; wi < wisps; wi++) add(r() < .8 ? 'cirrus-streak' : 'cirrus', 1);
    // FAR BANKS on the horizon once it clouds up, and fractus among the rest
    add('cumulus-row', c < .2 ? 0 : c < .5 ? 1 : 2);
    add('cumulus-fractus', c < .25 ? 0 : Math.min(2, Math.round(c * 4)));
    // THE CEILING'S DEPTH IN A BROKEN SKY: from a third cover up, the
    // overcast's receding ceiling, faint behind the cumulus -- thin cloud
    // that compresses into the horizon, so the cumulus sit in a sky with
    // depth, not on a clean gradient. Stronger as it clouds over.
    var veil = c < .4 ? 0 : clamp((c - .4) / .45, 0, 1) * .5;
    add('altocumulus', c > .55 && c < .8 && r() < .15 ? 1 : 0);
    add('horizon-haze', c >= .4 ? 1 : 0);
    return { deck: false, veil: veil, sets: sets };
  }
  // A CUMULUS IN PERSPECTIVE (rcSpawn, set 'cu'). Fair-weather cumulus share
  // one base height, so on screen a cloud's distance decides everything: the
  // nearest are big, high and fast, their flat bases well up the sky; further
  // off they shrink, slow, sit lower and fade into the haze, until near the
  // horizon they crowd into rows. `near` is 1 for the nearest, toward 0 at
  // the horizon; drawn evenly over the ground, so most clouds are far.
  function rcDepth(st) {
    var near = .1 + .9 * Math.pow(st.rnd(), 1.5);
    // far rows are puffy cumulus drawn small (the flat far art, now and then)
    // the near: v1's and v2's big cumulus, broken sheets when it clouds up;
    // the rest mostly v2's small cumulus (24 shapes, so nothing repeats)
    var r1 = st.rnd(), set = near > .55
      ? (st.cover > .5 && r1 < .35 ? 'stratocumulus' : r1 < .65 ? 'cumulus-large' : 'cumulus-near')
      : near < .18 && r1 < .12 ? 'cumulus-far' : r1 < .82 ? 'cumulus-small' : 'cumulus-mid';
    return { near: near, set: set,
             w: Math.max(70 * st.u, st.W * .62 * near * (.8 + .45 * st.rnd()) * (.65 + .5 * Math.min(1, st.cover * 1.6))),
             base: st.hy - (st.hy - st.hy * .3) * near,
             o: .55 + .45 * Math.pow(near, .6), speed: .25 + .75 * near };
  }
  // The lighting baked into the art the sky shows now.
  // GREY only under a lid: a shower from a broken sky still has sunlit
  // clouds, and grey ones in a clear blue sky read as cut out.
  function rcLight(s) {
    var c = rcCover(s);
    if (s.elev <= -7) return 'night';
    if (s.elev < 0) return 'dusk';
    if (s.elev < 10) return c >= .9 ? 'grey' : 'golden';
    return c >= .8 ? 'grey' : 'day';
  }
  // An overcast deck under a grey sky is its DAY art: that is already a
  // photograph of an overcast sky, and its grey relight lost the structure.
  // `sw`: one of its smaller soft copies (cloud_art.py SOFT_WIDTHS), or 0
  function rcSrc(c, light, sw) {
    if (light === 'grey' && c.set === 'overcast-deck') light = 'day';
    return RC_BASE + c.id + '-' + light + (sw ? '-w' + sw : '') + '.webp' + VER;
  }
  function rcUrl(c, light, sw) { return 'url(' + rcSrc(c, light, sw) + ')'; }
  // DEPTH OF FIELD: the copy a cloud is drawn from. `soften` is how many
  // screen pixels its detail should spread -- 1 for the nearest, up to ~6
  // far off -- and the copy is the smallest one it is upscaled from by no
  // more than that. The upscale is the blur: no filter, nothing per frame.
  function rcSoft(c, w, soften) {
    var px = w * (window.devicePixelRatio || 1), best = 0;
    (c.soft || []).forEach(function (sw) { if (sw * soften >= px && (!best || sw < best)) best = sw; });
    return best;
  }
  // Bring a cloud in: one of its set not already in the sky, sized for its
  // place in its band, starting off the upwind edge (phase 0) or, on a fresh
  // sky, already part-way across (phase), so the sky is never empty.
  function rcSpawn(st, k, set, phase) {
    var dep = set === 'cu' ? rcDepth(st) : null;
    var art = dep ? dep.set : set === 'scud' ? 'cumulus-fractus' : set;
    var list = RC_MAN.clouds.filter(function (c) { return c.set === art; });
    var used = st.clouds.map(function (x) { return x.c && x.c.id; });
    var pick = list.filter(function (c) { return used.indexOf(c.id) < 0; });
    if (!pick.length) pick = list;
    var c = pick[Math.floor(st.rnd() * pick.length)], cfg = RC_SETS[art];
    var t = st.rnd(), W = st.W, w, h, baseY, speed;
    if (dep) {
      w = dep.w; h = w * c.h / c.w; baseY = dep.base; speed = dep.speed; k.o = dep.o;
    } else if (set === 'cirrus' || set === 'cirrus-streak') {
      // WISPS RUN LONG: a streak across a good part of the sky, thinner
      // than drawn, high up
      w = W * (set === 'cirrus-streak' ? .8 + .5 * t : .55 + .4 * t);
      h = w * c.h / c.w * (set === 'cirrus-streak' ? .8 : .55);
      baseY = st.hy * (.1 + .22 * st.rnd()); speed = cfg[1]; k.o = .6;
    } else if (set === 'cumulus-row') {
      // a far bank: wider than the screen, its base on the horizon
      w = W * (1.0 + .5 * t); h = w * c.h / c.w;
      baseY = st.hy * (cfg[2][0] + (cfg[2][1] - cfg[2][0]) * st.rnd()); speed = cfg[1]; k.o = cfg[3];
    } else {
      w = set === 'horizon-haze' ? W * 1.6 : cfg[0] * st.u * (1.15 - .35 * t) * (.85 + .3 * st.rnd());
      h = w * c.h / c.w;
      baseY = st.hy * (cfg[2][0] + (cfg[2][1] - cfg[2][0]) * t);
      speed = cfg[1]; k.o = cfg[3];
    }
    var x0 = st.dir > 0 ? -w : W, x1 = st.dir > 0 ? W : -w;
    var dur = (W + w) / (st.v * speed);
    k.c = c; k.set = set; k.w = w; k.h = h;
    // DISTANCE SOFTENS: nearest sharp, further ever softer (rcSoft)
    var soften = dep ? 1 + 5 * Math.pow(1 - dep.near, 1.6)
               : set === 'cumulus-row' ? 3.5 : set === 'scud' ? 2.2 : set === 'cumulus-fractus' ? 2 : 1;
    k.sw = rcSoft(c, w, soften);
    var n = k.node, ns = n.style;
    ns.width = w.toFixed(0) + 'px';
    ns.height = h.toFixed(0) + 'px';
    ns.top = (baseY - c.base * h).toFixed(0) + 'px';
    ns.setProperty('--x0', x0.toFixed(0) + 'px');
    ns.setProperty('--x1', x1.toFixed(0) + 'px');
    ns.setProperty('--xs', (x0 + (x1 - x0) * phase).toFixed(0) + 'px');
    ns.setProperty('--d', dur.toFixed(0) + 's');
    ns.setProperty('--dl', (-phase * dur).toFixed(0) + 's');
    // the nearer in front; the haze and the wisps behind every cumulus
    ns.zIndex = dep ? String(10 + Math.round(dep.near * 900))
      // a far bank among the furthest cumulus: the furthest go behind it
      : set === 'cirrus' || set === 'cirrus-streak' || set === 'horizon-haze' ? '1' : set === 'cumulus-row' ? '235' : '300';
    if (set === 'scud') ns.zIndex = '200';
    // the art is lit from the left: mirror it when the light is on the right;
    // under a grey sky the light has no side. NEVER TILTED: a cumulus's base
    // is level, and a tilted one reads as pivoted at once.
    var mirror = st.light === 'grey' ? st.rnd() < .5 : st.lightRight;
    ns.setProperty('--tf', mirror ? 'scaleX(-1)' : 'none');
    // a fresh run restarts the crossing (two names, the same keyframes: a
    // new animation-name restarts it without forcing a layout)
    k.run = !k.run;
    ns.animationName = k.run ? 'hk-rc' : 'hk-rc2';
    k.front = 0;
    n.children[0].style.backgroundImage = rcUrl(c, st.light, k.sw);
    n.children[0].style.opacity = '1';
    n.children[1].style.backgroundImage = 'none';
    n.children[1].style.opacity = '0';
    k.lit = st.light;
  }
  function rcNode(st, cls) {
    var n = document.createElement('div');
    n.className = cls;
    n.appendChild(document.createElement('i'));
    n.appendChild(document.createElement('i'));
    n.style.opacity = '0';
    st.layer.appendChild(n);
    return n;
  }
  // A cloud has left the sky: back as another, or gone if the sky now wants
  // fewer of its set.
  function rcRespawn(st, k) {
    var want = {}, have = {};
    st.plan.sets.forEach(function (x) { want[x] = (want[x] || 0) + 1; });
    st.clouds.forEach(function (x) { if (x !== k && x.set) have[x.set] = (have[x.set] || 0) + 1; });
    var set = (have[k.set] || 0) < (want[k.set] || 0) ? k.set : null;
    if (!set) for (var x in want) if ((have[x] || 0) < want[x]) { set = x; break; }
    if (!set) {
      st.clouds.splice(st.clouds.indexOf(k), 1);
      k.node.remove();
      return;
    }
    rcSpawn(st, k, set, 0);
  }
  // Fade a cloud's lighting to `light`: the new art fades in on the layer
  // above, or the layer above fades out over the new art below; the layer no
  // longer shown is emptied a fade later (rcTidy), so a cloud is one layer
  // again.
  function rcRelight(st, k, light, now) {
    if (k.lit === light) return;
    if (k.cv) { ceilRelight(k, light); return; }
    var a = k.node.children[0].style, b = k.node.children[1].style;
    if (k.front === 0) { b.backgroundImage = rcUrl(k.c, light, k.sw); b.opacity = '1'; k.front = 1; }
    else { a.backgroundImage = rcUrl(k.c, light, k.sw); a.opacity = '1'; b.opacity = '0'; k.front = 0; }
    k.lit = light;
    k.tidy = now + 11000;
  }
  function rcTidy(k, now) {
    if (!k.tidy || now < k.tidy) return;
    k.tidy = 0;
    if (k.cv) { ceilFree(k.node.children[k.front ? 0 : 1]); if (k.front) k.node.children[0].style.opacity = '0'; return; }
    k.node.children[k.front ? 0 : 1].style.backgroundImage = 'none';
    if (k.front) k.node.children[0].style.opacity = '0';
  }
  // THE CEILING IS DRAWN ON A CANVAS (2026-10-09). As a background on a
  // plane tilted in 3D, the browser rasterized it into tiles at the scale of
  // its nearest, most magnified edge, over all the plane it could see -- on
  // the Loft (SM-X210) about six screens of the WebView's tile memory, with
  // the whole page then about one screen under the budget. Anything that
  // added a layer for a moment (the camera strip's stream coming back after
  // the black, the black going up, a rebuilt page) went over it, and the
  // tablet left the scenery's bottom tiles undrawn for three frames
  // (cc/tiles/tile_manager.cc "tile memory limits exceeded" in logcat at
  // that moment). A canvas is one texture of its own size whatever the
  // transform does to it: measured on the Loft, the page went from one
  // screen of headroom to seven, the same as with no ceiling at all, and
  // looked the same (TABLET-INVARIANTS 16q). The plane's fade (it was a
  // mask, a second tiled layer) is drawn into the canvas: the deck only
  // drifts sideways, so a fade from the bottom stays put on it.
  // Two canvases, as the <i> are two: the relight fades the new light in
  // over (or out from over) the old, and the one no longer shown is freed.
  var CEIL_FADE = .22;
  function ceilCanvases(n) {
    var cvs;
    try {
      cvs = [document.createElement('canvas'), document.createElement('canvas')];
      if (!cvs[0].getContext || !cvs[0].getContext('2d') || !cvs[1].getContext('2d')) return false;
    } catch (e) { return false; }
    while (n.firstChild) n.removeChild(n.firstChild);
    cvs.forEach(function (cv, i) {
      cv.style.opacity = i ? '0' : '1';
      // a GPU reset on Android gives a canvas back blank: draw it again
      if (cv.addEventListener) cv.addEventListener('contextrestored', function () { if (cv.__src) ceilDraw(cv, cv.__src); });
      n.appendChild(cv);
    });
    return true;
  }
  // the art at its own size, faded to nothing at the bottom (CEIL_FADE of
  // the height, where the plane meets the flat deck); `done` once it is on
  // the canvas -- a fade begun before would fade in nothing
  function ceilDraw(cv, src, done) {
    cv.__src = src;
    var img = new Image();
    img.onload = function () {
      if (cv.__src !== src) return;            // asked for another light meanwhile
      try {
        var w = img.naturalWidth, h = img.naturalHeight, cx = cv.getContext('2d');
        if (!w || !h || !cx) return;
        cv.width = w; cv.height = h;
        cx.drawImage(img, 0, 0, w, h);
        cx.globalCompositeOperation = 'destination-in';
        var g = cx.createLinearGradient(0, h, 0, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(CEIL_FADE, '#000');
        cx.fillStyle = g;
        cx.fillRect(0, 0, w, h);
        cx.globalCompositeOperation = 'source-over';
      } catch (e) { return; }
      cv.__drawn = src;
      // the ceiling's art is on: say so (a pre-rendered blur paints it in)
      try { window.dispatchEvent(new Event('hk-sky-paint')); } catch (e) { /* no window events */ }
      if (done) done();
    };
    img.src = src;
  }
  function ceilFree(cv) { cv.__src = null; cv.__drawn = null; cv.width = 0; cv.height = 0; }
  function ceilRelight(k, light) {
    var a = k.node.children[0], b = k.node.children[1], src = rcSrc(k.c, light);
    k.lit = light;
    k.tidy = 0;
    var shown = function () { k.tidy = Date.now() + 11000; };
    if (k.front === 0) {
      k.front = 1;
      ceilDraw(b, src, function () { if (k.lit === light) { b.style.opacity = '1'; shown(); } });
    } else {
      k.front = 0;
      ceilDraw(a, src, function () { if (k.lit === light) { a.style.opacity = '1'; b.style.opacity = '0'; shown(); } });
    }
  }
  // Paint the realistic clouds; returns what they composite, [alpha, luma]
  // pairs, for the luminance cap. `light`: which side the sun or moon is on.
  function paintRealClouds(el, s, on, hzFrac, lightRight, nightO) {
    var layer = el.querySelector('.rcl');
    if (!layer) return [];
    layer._rcOn = !!on;
    var st = layer._rc;
    if (!on || !rcManifest()) {
      if (st) { layer.innerHTML = ''; layer._rc = null; }
      return [];
    }
    var W = el.clientWidth || 1280, H = el.clientHeight || 800;
    var now = Date.now(), day = new Date();
    var seed = day.getFullYear() * 400 + day.getMonth() * 31 + day.getDate();
    var light = rcLight(s);
    var v = 4 + clamp(s.wind, 2, 26) * 0.55;
    if (el.classList.contains('own')) v *= OWN_DRIFT;
    var hy = H * hzFrac;
    var r = rng(seed * 7 + 3), plan = rcPlan(s, r);
    var size = [Math.round(W / 40), Math.round(H / 40), Math.round(hy / 20), plan.deck, seed,
                Math.round(clamp(s.cover || 0, 0, 1) * 10)].join('|');
    // THE FIRST SKY THIS LAYER HAS (the page loading, the clouds coming on):
    // nothing to fade from, so its clouds are simply there -- they faded in
    // over 4 s at every load (2026-10-10, the user's report). A sky that
    // replaces another still cross-fades, and arriving from a page with no
    // weather the whole layer fades in (.static .rcl).
    var first = !st;
    if (!st || st.size !== size) {
      // a new sky (another day, another screen size or horizon, the overcast
      // deck arriving or leaving): the old clouds fade out as the new fade in
      var old = layer.querySelectorAll('.rc,.rcd,.rcpl');
      for (var o = 0; o < old.length; o++) {
        old[o].style.opacity = '0';
        old[o].className += ' gone';
      }
      setTimeout(function () {
        var gone = layer.querySelectorAll('.gone');
        for (var g = 0; g < gone.length; g++) gone[g].remove();
      }, 4500);
      st = layer._rc = { size: size, layer: layer, clouds: [], rnd: rng(seed * 13 + 7), deck: null };
      if (!layer._rcEnd && layer.addEventListener) {
        layer._rcEnd = true;
        layer.addEventListener('animationend', function (e) {
          var cur = layer._rc, n = e.target;
          if (!cur || !n.classList || !n.classList.contains('rc') || n.classList.contains('gone')) return;
          for (var i = 0; i < cur.clouds.length; i++) if (cur.clouds[i].node === n) return rcRespawn(cur, cur.clouds[i]);
        });
      }
    }
    st.W = W; st.H = H; st.hy = hy; st.v = v; st.light = light; st.lightRight = lightRight;
    st.u = clamp(Math.min(W, H * 1.6) / 1280, 0.6, 1.6);
    st.cover = clamp(s.cover || 0, 0, 1);
    st.dir = (seed % 2) ? 1 : -1;
    st.plan = plan;
    // the overcast deck: the whole sky, drifting slowly to and fro
    if ((plan.deck || plan.veil) && !st.ceil) {
      var decks = RC_MAN.clouds.filter(function (c) { return c.set === 'overcast-deck'; });
      var dc = decks[seed % decks.length];
      if (plan.deck) {
      // the flat deck: the whole screen, beneath -- what shows below the
      // horizon and through the ceiling's faded edge
      var fh = H * 1.04, fw = Math.max(W * 1.25, fh * dc.w / dc.h);
      var dn = rcNode(st, 'rcd');
      dn.style.zIndex = '0';
      dn.style.width = fw.toFixed(0) + 'px';
      dn.style.height = fh.toFixed(0) + 'px';
      dn.style.top = (-H * .02).toFixed(0) + 'px';
      dn.style.setProperty('--x1', (W - fw).toFixed(0) + 'px');
      dn.style.setProperty('--d', Math.max(60, (fw - W) / (v * .25)).toFixed(0) + 's');
      dn.children[0].style.backgroundImage = rcUrl(dc, light);
      dn.children[0].style.opacity = '1';
      st.deck = { node: dn, c: dc, w: fw, h: fh, o: 1, front: 0, lit: light, set: 'overcast-deck', fresh: true };
      }
      // A CEILING, NOT A BLANKET: over it, the same deck on a plane hinged at
      // the horizon and tilted toward the viewer, so its texture is large
      // overhead and compresses into fine bands toward the skyline; its
      // lowest part fades into the flat deck. One 3D transform and one
      // static mask, drawn by the compositor -- nothing per frame
      var plane = document.createElement('div');
      plane.className = 'rcpl';
      var pw = W * 2.2, ph = hy * 1.9;
      plane.style.cssText = 'position:absolute;z-index:1;left:' + (-(pw - W) / 2).toFixed(0) + 'px;width:' + pw.toFixed(0) +
        'px;top:' + (hy - ph).toFixed(0) + 'px;height:' + ph.toFixed(0) + 'px;transform-origin:50% 100%;' +
        'transform:perspective(' + (H * 1.1).toFixed(0) + 'px) rotateX(-62deg)';
      st.layer.appendChild(plane);
      var ch = ph, cw = Math.max(pw * 1.2, ch * dc.w / dc.h);
      var cn = rcNode(st, 'rcd');
      plane.appendChild(cn);
      cn.style.width = cw.toFixed(0) + 'px';
      cn.style.height = ch.toFixed(0) + 'px';
      cn.style.top = '0px';
      cn.style.setProperty('--x1', (pw - cw).toFixed(0) + 'px');
      cn.style.setProperty('--d', Math.max(60, (cw - pw) / (v * .4)).toFixed(0) + 's');
      // ON A CANVAS, its fade drawn in (ceilCanvases); with no 2D canvas,
      // the art as a background and the fade as the plane's mask
      var cv = ceilCanvases(cn);
      if (cv) ceilDraw(cn.children[0], rcSrc(dc, light));
      else {
        plane.style.webkitMaskImage = plane.style.maskImage = 'linear-gradient(to top,transparent 0,#000 ' + (CEIL_FADE * 100) + '%)';
        cn.children[0].style.backgroundImage = rcUrl(dc, light);
        cn.children[0].style.opacity = '1';
      }
      st.ceil = { node: cn, c: dc, w: cw * .5, h: ch * .5, o: .85, front: 0, lit: light, set: 'overcast-deck', fresh: true, cv: cv };
    }
    if (st.ceil) st.ceil.o = plan.deck ? .85 : plan.veil;
    // FAINT: a texture over the sky, not a lid -- more of it the more
    // complete the cover, a little more in rain
    if (st.deck) {
      st.deck.o = clamp(.35 + (clamp(s.cover || 0, .85, 1) - .85) / .15 * .25 + (rcWet(s) ? .1 : 0), .35, .7);
    }
    // bring the sky up to its plan: a fresh sky spread across already, a
    // sky that wants more clouds gaining them from the upwind edge
    var fresh = !st.clouds.length;
    var have = {};
    st.clouds.forEach(function (x) { have[x.set] = (have[x.set] || 0) + 1; });
    var count = {};
    plan.sets.forEach(function (set) { count[set] = (count[set] || 0) + 1; });
    for (var set in count) {
      for (var i = have[set] || 0; i < count[set]; i++) {
        var k = { node: rcNode(st, 'rc'), fresh: true };
        st.clouds.push(k);
        rcSpawn(st, k, set, fresh ? (set === 'cu' ? st.rnd() : (i + .2 + .6 * st.rnd()) / count[set]) : 0);
      }
    }
    var all = (st.deck ? [st.deck] : []).concat(st.ceil ? [st.ceil] : [], st.clouds), out = [], area = W * H;
    all.forEach(function (k) {
      rcRelight(st, k, light, now);
      rcTidy(k, now);
      var op = k.o * nightO;
      // a cloud made in this paint fades in from the next frame: written in
      // the same task as its opacity 0, a transition would never run
      if (k.fresh && first) {
        k.fresh = false;
        var n0 = k.node.style;
        n0.transition = 'none';
        n0.opacity = op.toFixed(2);
        // the transition back for what comes later (a relight, a new sky),
        // once this opacity has been drawn
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(function () { requestAnimationFrame(function () { n0.transition = ''; }); });
        } else n0.transition = '';
      } else if (k.fresh) {
        k.fresh = false;
        var fadeIn = function () { k.node.style.opacity = op.toFixed(2); };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(function () { requestAnimationFrame(fadeIn); });
        } else fadeIn();
      } else if (k.node.style.opacity !== op.toFixed(2)) k.node.style.opacity = op.toFixed(2);
      out.push([k.c.alpha * Math.min(1, k.w * k.h / area) * op,
        k.c.luma[light === 'grey' && k.set === 'overcast-deck' ? 'day' : light]]);
    });
    return out;
  }

  // The sky painted, then its moving things put where Moving Things says
  // (a screensaver's own sky keeps them: it has no cards to be in front of).
  function paint(el, s) {
    var out = paintSky(el, s);
    if (!el.classList.contains('own')) {
      try { frontSync(el, !!s && s.moving === 'front'); } catch (e) { console.error('[hk-sky] moving things', e); }
    }
    return out;
  }
  function paintSky(el, s) {
    var st = el.style;
    // Sky / Background: a chosen backdrop takes the live ramp's place -- its
    // day set while the sun is above the horizon, its night set below.
    // The --sk0..3 cross-fade is the same either way, and the luma estimate
    // further down reads these same four stops, so a bright custom horizon
    // scrims the glass exactly as the live sky's own 146 does.
    var sky = (s.backdrop && (s.elev > 0 ? s.backdrop.day : s.backdrop.night)) ||
              ramp(SKY, s.elev);
    var bright = s.backdrop ? 0 : clamp(num(s.brightness, DAY_BRIGHT), 0, 1) * clamp((s.elev - 10) / 15, 0, 1);
    // A GREY DAY STAYS GREY: the bright blue is a fair day's. Under an
    // overcast it showed as a pale blue band along the horizon, below the
    // clouds' ceiling -- so it fades out from 55% cover to 85%, and rain,
    // snow, a storm or fog take it away altogether.
    var wetSky = !!(s.fog || (s.wet && (s.wet.kind !== 'none' || s.wet.bolt)));
    bright *= wetSky ? 0 : 1 - clamp((num(s.cover, 0) - 0.55) / 0.3, 0, 1);
    if (bright) sky = sky.map(function (c, k) { return mixAny(c, SKY_BRIGHT[k], bright); });
    for (var i = 0; i < 4; i++) st.setProperty('--sk' + i, sky[i]);
    // Animations off (Sky / Background): still the moving layers -- the
    // decks, the season's motion, the screensaver's twinkle (see .noanim in
    // SHEET, which the screensaver's own sky adopts too). Toggled with a
    // force, so the class always matches the paint that last ran -- a
    // console hkSkyAt preview turns it off for its own picture, and the
    // next real paint restores whatever is set.
    el.classList.toggle('noanim', s.animations === false);
    // Clear the grain. The sky element SURVIVES navigation (see watch()), so a
    // weather page arrived at from a static one inherits whatever the static
    // page set -- the same reason every other layer here is written on every
    // paint rather than only when it changes.
    st.setProperty('--grainO', '0');

    // ---- sun / moon placement
    // Azimuth 90 (due east, sunrise) sits left, 270 (west, sunset) right, so
    // the glow crosses the frame over the day the way the real one does.
    var x = clamp((s.azim - 90) / 180, 0, 1);
    // Elevation 0 lands on the gradient's horizon stop (72%), 90 at the top.
    // Below the horizon it keeps sinking, so the glow slides off-frame instead
    // of sticking to the bottom edge.
    var y = 0.72 - (s.elev / 90) * 0.72;
    var day = clamp((s.elev + 6) / 12, 0, 1);          // 0 night .. 1 day

    st.setProperty('--glowX', (x * 100).toFixed(1) + '%');
    st.setProperty('--glowY', (y * 100).toFixed(1) + '%');
    var glowO;
    if (day > 0.5) {
      st.setProperty('--glowR', '46vmax');
      st.setProperty('--glowC', s.elev < 12 ? 'rgba(255,176,104,.50)'
                                            : 'rgba(255,231,186,.30)');
      glowO = 0.45 + 0.55 * day;
    } else {
      st.setProperty('--glowR', '30vmax');
      st.setProperty('--glowC', 'rgba(150,176,224,.16)');
      glowO = 0.5 * (1 - day);
    }
    st.setProperty('--glowO', glowO.toFixed(2));

    // ---- night sky
    // Stars fade in below civil twilight and are hidden by thick cloud.
    var night = clamp((-4 - s.elev) / 10, 0, 1);
    var clear = 1 - clamp(s.cover, 0, 1);
    st.setProperty('--starO', (night * (0.25 + 0.75 * clear)).toFixed(2));

    st.setProperty('--moonI', 'url("' + moonSvg(s.moon, 26) + '")');
    st.setProperty('--moonS', '58px');

    // ---- seasonal moon
    // A big warm moon on Halloween nights. It lives HERE rather than in
    // paintSeason because the moon is a stock layer that paint() rewrites on
    // every 3s tick -- an override applied once would be erased three seconds
    // later. The witch is sized and flown against this number.
    var moonS = 58;
    // Consult the SAME schedule paintSeason does, or the harvest moon would
    // rise on nights the branches, bats and witch had sat out -- a big warm
    // moon on its own just looks like the sky is broken. Literally the same:
    // this route is resolved once here and handed to paintSeason below.
    var route = routeOf(s, new Date());
    var plan = route.plan;
    // route.name, not s.season: a surprise (a birthday) blanks the season for
    // the day, and the Halloween moon must sit it out with the scene.
    var spooky = route.name === 'halloween' && s.decorations !== false &&
                 plan.spooky && s.elev < -4;
    var moonEl = el.querySelector('.moon');
    if (moonEl) moonEl.classList.toggle('hallow', spooky);
    // Opposite the sun: roughly true near full, and the only placement that
    // never drops the moon inside the sun's own glow.
    //
    // Inset from the edges, because `x` is a CLAMPED value: every azimuth past
    // due west pins it to 1, which would put the moon at 0% and slice it in
    // half against the frame for the whole back end of the night.
    //
    // The forecast screensaver's own sky keeps it out of the top-left, where
    // its clock and date stand: there it crosses the right 54-90% instead
    // (54%: clear of the clock's AM even beside the calendar pane).
    var moonXp = el.classList.contains('own') ? 54 + (1 - x) * 36 : 12 + (1 - x) * 76;
    st.setProperty('--moonX', moonXp.toFixed(1) + '%');
    st.setProperty('--moonY', (16 + (1 - night) * 10).toFixed(1) + '%');
    var moonXf = moonXp / 100;
    var moonYf = (16 + (1 - night) * 10) / 100;
    // A new moon is not drawn at all. moonSvg would render a zero-width
    // sliver, which reads as a rendering fault rather than as a new moon.
    var lit = (1 - Math.cos(2 * Math.PI * s.moon)) / 2;
    st.setProperty('--moonO',
      (night * clear * clamp((lit - 0.04) / 0.2, 0, 1)).toFixed(2));

    // ---- seasonal moon override, LAST
    // AFTER the two assignments above, or the stock sun-opposite position
    // overwrites --moonX and --moonY and only --moonS survives: a harvest
    // moon wherever the azimuth put it, with the witch flying somewhere else.
    // Order is the whole point: set it after, and feed the SAME resolved
    // center to the witch.
    if (spooky) {
      // The forecast screensaver's own sky has its clock top-left and its
      // status top-right: there the moon is under three-quarters the size, between
      // them and clear of the trees.
      var ownSky = el.classList.contains('own');
      moonS = ownSky ? Math.round(MOON_PX * 0.72) : MOON_PX;
      st.setProperty('--moonS', moonS + 'px');
      // Swap the generated SVG disc for the photograph. One variable: the
      // .moon element, its sizing and its opacity transition are untouched,
      // so there is never a second moon on the page.
      st.setProperty('--moonI', 'url(' + MOON_IMG + ')');
      moonXf = ownSky ? 0.56 : 0.70;
      moonYf = ownSky ? 0.25 : 0.24;
      st.setProperty('--moonX', (moonXf * 100) + '%');
      st.setProperty('--moonY', (moonYf * 100) + '%');
      // Phase is deliberately ignored. This is a seasonal full moon, not a
      // phase texture -- and leaving --moonO on the stock phase ramp would
      // give a new-moon Halloween an invisible moon with a witch crossing
      // nothing. Still fades with cloud cover.
      st.setProperty('--moonO', (0.78 * clear).toFixed(2));
    }
    // ---- the Christmas moon, the forecast screensaver's own sky
    // A small phase moon gives Santa nothing to cross: on a Christmas night
    // the screensaver's sky hangs the photographic full moon, smaller than
    // Halloween's, between the clock and Home Status, and the sleigh flies
    // across its face (cozyWindow, from the same resolved center).
    var xmasMoon = !spooky && el.classList.contains('own') && plan.show &&
                   s.season === 'christmas' && s.elev < -4;
    if (xmasMoon) {
      moonS = Math.round(MOON_PX * XMAS_MOON);
      st.setProperty('--moonS', moonS + 'px');
      st.setProperty('--moonI', 'url(' + MOON_IMG + ')');
      moonXf = 0.64;
      moonYf = 0.25;
      st.setProperty('--moonX', (moonXf * 100) + '%');
      st.setProperty('--moonY', (moonYf * 100) + '%');
      st.setProperty('--moonO', (0.85 * clear).toFixed(2));
    }

    // The new woodland keeps its night moon in a header sky opening rather
    // than underneath the opaque camera mosaic. Halloween's decorative full
    // moon is nightly; the rare spooky roll still controls its flybys.
    // Only over a woodland that is actually drawn (nearThemeOf, the same
    // answer paintSeason mounts by): an unmapped surprise keeps its own moon.
    var woodlandMoon = !!nearThemeOf(el, s, route) && s.elev < -4;
    if (moonEl) {
      moonEl.classList.toggle('woodland', woodlandMoon);
      // Decorative moon stays above the cloud decks but behind the real
      // branches and precipitation. Restore the stock ordering for Old and
      // forecast skies, without adding a second disc.
      var moonAnchor = woodlandMoon ? el.querySelector('.near-scenery') || el.querySelector('.fog') : el.querySelector('.cl.a');
      if (moonAnchor && moonEl.nextElementSibling !== moonAnchor) el.insertBefore(moonEl, moonAnchor);
    }
    if (woodlandMoon) {
      var moonW = el.clientWidth || 1280, moonH = el.clientHeight || 800;
      var moonPhone = moonW < 640;
      var seasonNode = el.querySelector('.season');
      var menuInset = seasonNode ? parseFloat(getComputedStyle(seasonNode).left) || 0 : 0;
      var halloweenMoon = route.name === 'halloween';
      moonS = moonPhone ? (halloweenMoon ? 42 : 32) : halloweenMoon ? 168 : 76;
      moonXf = moonPhone ? .16 : menuInset > 0 ? .84 : moonW < 1200 ? .9 : .76;
      moonYf = (moonPhone ? 112 : menuInset > 0 ? 76 : 104) / moonH;
      st.setProperty('--moonS', moonS + 'px');
      st.setProperty('--moonX', (moonXf * 100) + '%');
      st.setProperty('--moonY', (moonYf * 100) + '%');
      if (halloweenMoon) st.setProperty('--moonI', 'url(' + MOON_IMG + ')');
      if (moonEl) moonEl.classList.toggle('hallow', halloweenMoon);
      var moonStrength = night * (1 - (halloweenMoon ? .25 : .5) * clamp(s.cover, 0, 1)) *
                         (halloweenMoon ? .95 : .7 * clamp((lit - .04) / .2, 0, 1));
      st.setProperty('--moonO', moonStrength.toFixed(2));
      st.setProperty('--glowX', (moonXf * 100) + '%');
      st.setProperty('--glowY', (moonYf * 100) + '%');
      st.setProperty('--glowR', '18vmax');
      st.setProperty('--glowC', 'rgba(160,190,225,.22)');
      st.setProperty('--glowO', (moonStrength * .5).toFixed(2));
    }

    // Look the deck up, mark it idle if it is about to be invisible, and hand
    // back its .style so the callers below are unchanged. Written so that
    // flipping IDLE_INVISIBLE to false CLEARS a stale class on the next paint
    // rather than leaving decks frozen.
    // IDLE BELOW 4%. Idling a deck only at exactly zero is not enough: deck A
    // is `cover x 1.5`, so the `sunny` fallback (4%) or a cloud_coverage of
    // 1% would keep a 1280px will-change layer drifting all day at an opacity
    // nobody can see. Below IDLE_BELOW the
    // deck is idled and its --o written as 0, so the fade-out still runs.
    function deck(sel, o) {
      var n = skyQ(el, sel);
      n.classList.toggle('idle', IDLE_INVISIBLE && !(o >= IDLE_BELOW));
      return n.style;
    }
    // The opacity a deck is written with: 0 below the idle threshold.
    function vis(o) { return (o >= IDLE_BELOW ? o : 0).toFixed(2); }

    // ---- clouds
    var tint = ramp(CLOUD, s.elev);
    st.setProperty('--clTop', tint[0]);
    st.setProperty('--clBot', tint[1]);

    // Cover maps onto the three decks unevenly: the high haze arrives first
    // and the near detail last, so a 20% sky is wisps and a 90% sky is a lid.
    // Clouds: Realistic draws its own (paintRealClouds, after the seasons);
    // the classic decks stay off while its manifest loads, and stand in only
    // if it cannot (rcManifest)
    // Weather off draws no clouds in either style: read() zeroes the classic
    // decks' cover, and the realistic plan would still add a cirrus or a far
    // cumulus at cover 0.
    // 'blend' (Sky Lab, on trial): the realistic clouds over the classic
    // decks at half their cover -- the clouds sitting in a veil of haze and
    // thin cloud, not on a clean gradient
    var realOn = (s.cloudStyle === 'realistic' || s.cloudStyle === 'blend') && s.weather !== false &&
                 (rcManifest(), !RC_FAILED);
    var cov = realOn ? (s.cloudStyle === 'blend' ? s.cover * .55 : 0) : s.cover;
    var oA = clamp(cov * 1.5, 0, 0.85);
    var oB = clamp((cov - 0.18) * 1.5, 0, 0.92);
    var oC = clamp((cov - 0.42) * 1.7, 0, 0.95);

    // Cloud drift, authored as a SPEED in px/s and converted to a duration,
    // rather than as a duration multiplier.
    //
    // A multiplier gets two things wrong. It is far too slow -- at 2mph the
    // near deck would move 0.19 px/s, 2.8 hours to cross a 1920px tablet, so
    // the clouds never appear to move. And it gives no parallax at all: the
    // three decks tile at 640/440/280px, so multipliers of 2.4/1.5/1.0 work
    // out to 267/293/280 px per unit time -- all three within 10% of each
    // other, which is a flat field, not depth.
    //
    // Speed makes both explicit. `v` is the nearest deck; the far decks are
    // fractions of it, so the parallax is the ratio you can read here.
    // Calm is a lazy ~6 minutes to cross a 1920px screen, a gale under 2.
    var w = clamp(s.wind, 2, 26);
    var v = 4 + w * 0.55;
    // The forecast screensaver's own sky is the whole picture rather than a
    // backdrop to cards, and at the page's pace it reads as a still: its
    // clouds go OWN_DRIFT times as fast (a calm day crosses in ~3 minutes).
    if (el.classList.contains('own')) v *= OWN_DRIFT;
    [['a', oA, 0.34], ['b', oB, 0.62], ['c', oC, 1.0]].forEach(function (p) {
      var d = deck('.cl.' + p[0], p[1]);
      d.setProperty('--o', vis(p[1]));
      // Travel is exactly one tile width (the layer overhangs right by --tw),
      // so duration = tile / speed and the loop stays seamless.
      // MUST match the --tw values in the deck CSS above. Travel is exactly
      // one tile width, so duration = tile / speed keeps the px/s identical
      // whatever the tile is -- which is why a change of tile width does not
      // change how fast the clouds move.
      var tw = { a: 1280, b: 880, c: 560 }[p[0]];
      d.setProperty('--d', Math.round(tw / (v * p[2])) + 's');
    });

    // ---- weather
    st.setProperty('--fogO', s.fog ? '1' : '0');

    // RAIN & SNOW (Sky / Background, 2026-10-10): off, nothing falls -- the
    // clouds, fog and a wet sky's gray stay. And never while Animations are
    // off: a fall that cannot move hangs over the sky as a still texture.
    var falls = s.precipitation !== false && s.animations !== false;
    var rain = falls && s.wet.kind === 'rain' ? s.wet.rate : 0;
    var snow = falls && s.wet.kind === 'snow' ? s.wet.rate : 0;

    // Wind drives precipitation SPEED, not angle. Both decks are tiled
    // bitmaps, and a tiled bitmap can only fall straight down without
    // seaming -- see fallTiled. Up to +60% in a gale.
    var gust = 1 + clamp(s.wind, 0, 26) / 26 * 0.6;

    // ONE DECK, near and far streaks in its one tile. The depth comes from
    // the CONTRAST between them -- long bright streaks over short dim ones --
    // not from speed; a gradient that leans on speed reads as hatching. (Two
    // decks once, the far one at 0.55/0.90 of this one's opacity: baked into
    // the tile now, so the rain is one full-screen layer, not two.)
    var rn = deck('.rain', rain * 0.90);
    rn.setProperty('--o', vis(rain * 0.90));
    fallTiled(rn, 512, 1, (170 + rain * 130) * gust);
    fallDraw(skyQ(el, '.rain'), 'rain.png', 512, 0.5);

    // (snow keeps its two decks: it falls slowly, and its depth is the big
    // flakes falling faster than the small ones -- one speed looked flat)
    var s1 = deck('.snow.s1', snow * 0.85);
    var s2 = deck('.snow.s2', snow * 0.5);
    s1.setProperty('--o', vis(snow * 0.85));
    fallTiled(s1, 320, 1, (46 + snow * 34) * gust);
    fallDraw(skyQ(el, '.snow.s1'), 'flakes.png', 320, 1);
    s2.setProperty('--o', vis(snow * 0.5));
    fallTiled(s2, 190, 1, (24 + snow * 20) * gust);
    fallDraw(skyQ(el, '.snow.s2'), 'flakes.png', 190, 1);

    el.querySelector('.bolt').style.display = s.wet.bolt ? '' : 'none';

    // ---- seasons
    // Built here, but only actually rebuilt when the season key changes; see
    // paintSeason. Returns what it composites, for the cap below.
    // laid out in the seasonal layer's own box (beside an open menu, the
    // page's), the moon's centre given in that box's fractions
    var sbox = el.querySelector('.season'), EW = el.clientWidth || 1280;
    var SW = (sbox && sbox.clientWidth) || EW, SL = EW - SW;
    var seasonCover = paintSeason(el, s, SW, el.clientHeight || 800, moonS,
      SW ? (moonXf * EW - SL) / SW : moonXf, moonYf, route);

    // ---- realistic clouds, after the seasons: they need the scene's horizon
    // -- the woodland's hills, laid out as its valley is (center/cover in the
    // seasonal box), the forecast landscape's (cover, from the bottom), else
    // the gradient's own
    var EH = el.clientHeight || 800, hz = 0.72;
    if (el._hkNear && NEAR_HORIZON[el._hkNearTheme]) {
      var aH = Math.max(EH, SW * 992 / 1586);
      hz = ((EH - aH) / 2 + NEAR_HORIZON[el._hkNearTheme] * aH) / EH;
    } else if (el.querySelector('.land')) {
      // THE LAND'S HORIZON FROM THE FIRST PAINT, not once its art has faded
      // in ('landed'): laid out against the gradient's until then, the
      // clouds were thrown away and laid out again at the next paint -- on
      // the screensaver, the next forecast slide, a few seconds after it
      // came in (2026-10-10)
      var lH = Math.max(EH, EW * 1600 / 2560);
      hz = (EH - lH + 0.6 * lH) / EH;
    }
    var realCover = paintRealClouds(el, s, realOn, hz, (s.elev > -7 ? x : moonXf) > 0.5,
      s.elev <= -7 ? 0.55 + 0.45 * lit : 1);

    // ---- luminance cap
    // Estimate what all of the above actually composites to, then scrim it
    // down to CAP. Estimated rather than sampled because sampling means a
    // canvas readback on every update on a tablet that cannot spare one --
    // and the inputs (gradient stops, texture mean alpha, layer opacity) are
    // all known exactly, so the estimate is arithmetic, not a guess.
    //
    // Mean of a vertical linear gradient = the sum over segments of each
    // segment's midpoint value weighted by its share of the height.
    var pos = [0, 0.42, 0.72, 1.0];
    var L = 0;
    for (var k = 0; k < 3; k++) {
      L += (luma(sky[k]) + luma(sky[k + 1])) / 2 * (pos[k + 1] - pos[k]);
    }
    // The glow covers roughly a fifth of the frame at its stated alpha.
    L += (day > 0.5 ? 34 : 4) * glowO * 0.2;
    // Each deck is an alpha composite: the texture's mean alpha times the
    // layer opacity is the fraction of the frame it actually covers.
    var ct = (luma(tint[0]) + luma(tint[1])) / 2;
    [[CLOUD_ALPHA.a, oA], [CLOUD_ALPHA.b, oB], [CLOUD_ALPHA.c, oC]]
      .forEach(function (p) {
        var a = p[0] * p[1];
        L = L * (1 - a) + ct * a;
      });
    // THE REALISTIC CLOUDS COUNT AS LIGHTLY AS THE CLASSIC DECKS. Counted at
    // full weight, a partly cloudy sky's bright white cumulus tripped the cap
    // and darkened the whole sky -- the blue as well as the clouds -- twice as
    // much as Classic (a 45% bottom scrim at 40% cover against Classic's 20%):
    // a sunny day looked sad. The cap is for the glass over the sky as a
    // whole; scattered clouds are local, so they weigh in at a third.
    realCover.forEach(function (p) { var a = p[0] * .35; L = L * (1 - a) + p[1] * a; });
    if (s.fog) L = L * 0.84 + 150 * 0.16;

    // Seasonal layers, same alpha-composite arithmetic as the decks. The
    // branches subtract (they are black), the garland adds.
    seasonCover.forEach(function (c) {
      var a = clamp(c[0], 0, 0.9);
      L = L * (1 - a) + c[1] * a;
    });

    applyScrim(el, L, CAP + BRIGHT_CAP * bright);
  }

  function applyScrim(el, L, cap) {
    var st = el.style;
    cap = cap || CAP;
    var k2 = L > cap ? clamp(1 - cap / L, 0, 0.72) : 0;
    // Weight the scrim to the bottom: that is where the pills and the glass
    // plates sit, and it leaves the top of the sky its color.
    st.setProperty('--scT', (k2 * 0.72).toFixed(3));
    st.setProperty('--scB', Math.min(0.86, k2 * 1.28).toFixed(3));

    el._hkRaw = Math.round(L);                       // before scrim
    el._hkL = Math.round(L * (1 - k2 * 0.98));       // after, for verification
  }

  // ---------------------------------------------------------- static skies
  // Energy, EcoFlow and Cameras are not weather pages. Nothing on them is
  // about the sky, so they get a fixed gradient with an identity of their own
  // rather than the live one -- no sun, no moon, no stars, no clouds, no rain.
  //
  // Those layers are faded to zero rather than torn out, because every one of
  // them carries an opacity transition: arriving from the weather page melts
  // them away instead of blinking them off. The `static` class then stops
  // their animations once they are invisible.
  //
  // Stops are zenith / upper / mid / horizon at the same 0-42-72-100 the live
  // gradient uses, and each palette is authored to land UNDER cap so the scrim
  // does nothing to it (energy 81, ecoflow 75, cameras 22 against CAP 86).
  // Cameras is deliberately far darker than the other two -- it sits behind
  // live video and must not compete with it.
  //
  // The HORIZON stop is the one that matters, not the mean. The mean is what
  // CAP scrims, but all three of these land under it, so no scrim runs at all
  // and the bottom of the gradient is whatever it was authored to be -- and
  // the bottom is exactly where the pills and glass plates sit. Both colored
  // palettes are therefore calibrated to the LIVE sky's own horizon stop
  // (rgb(106,154,187), luma 146), which is the ground the glass palette was
  // tuned against: energy 132, ecoflow 148. Horizons at 160 and 181 leave the
  // plates muddy against the bright end.
  // How strong the grain is on a static page. The texture itself is authored
  // faint (gen_sky.py grain(), amplitudes 0.16 coarse / 0.085 fine) and this is
  // the last dial before it ships. The point is that you should not notice it
  // directly, only notice that the page no longer looks like a flat gradient.
  //
  // 0.18, not the ~0.5 a desktop browser suggests. On a desktop the banding
  // it exists to dither is obvious and the grain reads as a faint tooth; on a
  // 1280px wall tablet that much reads as BLOTCH -- a coarse mottle over the
  // whole page, plainly visible as its own thing rather than as a surface,
  // which is exactly the failure mode the paragraph above warns about. The
  // coarse octave is what carries at tablet viewing distance, so the ceiling
  // here is much lower than the ~0.6 a desktop suggests. 0.18 still kills
  // the 8-bit banding (that only needs roughly a half-step of dither, and
  // the coarse amplitude is 0.16 of full range before this multiplier) while
  // dropping the mottle below notice.
  // If it ever needs to go back UP, check it on a tablet, not a monitor.
  var GRAIN = 0.18;

  var STATIC = {
    energy:  ['#171d12', '#3a4020', '#7a5a24', '#b07f38'],   // olive -> amber
    ecoflow: ['#121634', '#183456', '#1e6e7c', '#5aa3ae'],   // indigo -> teal
    // the Power page: the EcoFlow page's own (its house picture was drawn
    // against it), not the Energy page's olive -- the two pages side by side
    power:   ['#121634', '#183456', '#1e6e7c', '#5aa3ae'],   // indigo -> teal
    cameras: ['#080a0e', '#0f1219', '#171b23', '#222833'],   // near-black
    // The category pages. Each takes the hue its own chip already uses on the
    // dashboard, so arriving on the page is a continuation of the tile you
    // tapped rather than a jump. Every one is checked the same way as the
    // first three: mean under CAP, and the HORIZON stop at or under the live
    // sky's own 146, because the horizon is where the plates sit.
    lights:    ['#1c1608', '#3d3211', '#7e6320', '#bb9440'],  // warm amber
    climate:   ['#0d1a1c', '#173437', '#22646a', '#5aa8a8'],  // cool teal
    water:     ['#0c1526', '#132a4c', '#1c5a86', '#4f9dc4'],  // deep blue
    timers:    ['#1e1408', '#402713', '#864a1e', '#c07f3c'],  // ember orange
    doors:     ['#1c0e10', '#3c1a1e', '#7a2f34', '#b0605f'],  // muted crimson
    // SECURITY (2026-10-15, the page headers): navy into a muted mauve,
    // the user's pick from the concept -- calmer than the doors' crimson
    // behind the keypad, and its own from Doors & Windows
    security:  ['#161823', '#202836', '#33405a', '#6a5068'],
    vacuums:   ['#170f14', '#341e28', '#6d3a44', '#a86a63'],  // Home app coral
    playmusic: ['#150e1f', '#2e1b42', '#5c2f76', '#9a6bb0'],  // music purple
    // CALENDAR (2026-10-16): Sage Mist, the calm green the user picked from
    // four previews (settings.py SKY_BACKDROPS sage, its day set)
    calendar:  ['#0e1a18', '#18302b', '#284a42', '#4f7a6c']
  };

  // THE LIGHTS PAGE FOLLOWS THE SUN (2026-10-16; Pages -> Lights ->
  // Background -> Follow the Sun): its amber takes the color temperature of
  // the light outside now -- deep orange at dusk, a pale warm white at
  // midday. The kelvin is Adaptive Lighting's when the house has it (its
  // switches carry color_temp_kelvin, worked out from the sun already --
  // the setting's own switch, else the first, "default" first), otherwise
  // the sun's elevation on Adaptive Lighting's own range: 2000 K at and
  // under the horizon to 5500 K from 30 degrees up.
  //
  // EACH STOP KEEPS ITS LUMA, only its hue changes, so the horizon still
  // sits at the live sky's 146 the plates were tuned against (see STATIC)
  // and no scrim runs. The hue is three-quarters of the kelvin's chroma: a
  // 2000 K at full chroma is a traffic-cone orange behind the glass.
  var KELVIN = { id: null, miss: 0 };
  function kelvinRgb(k) {
    var t = Math.max(1000, Math.min(40000, k)) / 100, r, g, b;
    r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
    return [r, g, b].map(function (c) { return Math.max(0, Math.min(255, c)); });
  }
  function sunKelvin(client, cfg) {
    var st = client.states;
    var pick = cfg && Array.isArray(cfg.sky_source) && cfg.sky_source[0];
    var id = pick && st[pick] ? pick : null;
    if (!id) {
      // found once, not walked on every update (thousands of states)
      if (KELVIN.id && st[KELVIN.id]) id = KELVIN.id;
      else if (Date.now() - KELVIN.miss > 600e3) {
        var al = Object.keys(st).filter(function (k) {
          return k.indexOf('switch.') === 0 && k.indexOf('adaptive_lighting') >= 0 &&
            (st[k].attributes || {}).color_temp_kelvin != null;
        }).sort(function (a, b) { return (/default/.test(b) - /default/.test(a)) || (a < b ? -1 : 1); });
        KELVIN.id = id = al[0] || null;
        if (!id) KELVIN.miss = Date.now();
      }
    }
    var k = id && Number((st[id].attributes || {}).color_temp_kelvin);
    if (k > 0) return { k: k, from: id };
    var sun = st['sun.sun'], e = sun ? Number((sun.attributes || {}).elevation) : NaN;
    if (!isFinite(e)) return null;
    var f = Math.max(0, Math.min(1, e / 30));
    return { k: Math.round(2000 + 3500 * Math.sin(f * Math.PI / 2)), from: 'sun.sun' };
  }
  function tintStops(stops, k) {
    var c = kelvinRgb(k), Lk = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return stops.map(function (s) {
      var L = luma(s), sc = L / Lk;
      var px = c.map(function (x) { return L + (x * sc - L) * 0.75; });
      // over 255 a channel clips and the stop goes dimmer than it should:
      // the others make up the luma it lost
      var over = px.map(function (x) { return Math.max(0, x - 255); });
      var lost = 0.2126 * over[0] + 0.7152 * over[1] + 0.0722 * over[2];
      if (lost > 0) px = px.map(function (x) { return Math.min(255, x) + lost; });
      return '#' + px.map(function (x) { var h = Math.round(Math.max(0, Math.min(255, x))).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
    });
  }

  function paintStatic(el, stops) {
    var st = el.style;
    for (var i = 0; i < 4; i++) st.setProperty('--sk' + i, stops[i]);
    // Grain is a STATIC-PAGE thing. The live sky has clouds and precipitation
    // moving through it and does not need help looking like a surface; adding
    // grain there would only fight them.
    st.setProperty('--grainO', String(GRAIN));
    st.setProperty('--glowO', '0');
    st.setProperty('--starO', '0');
    st.setProperty('--moonO', '0');
    st.setProperty('--fogO', '0');
    ['.cl.a', '.cl.b', '.cl.c', '.rain', '.snow.s1', '.snow.s2']
      .forEach(function (sel) {
        var n = skyQ(el, sel);
        if (n) n.style.setProperty('--o', '0');
      });
    var bolt = el.querySelector('.bolt');
    if (bolt) bolt.style.display = 'none';

    // Same gradient-mean arithmetic paint() uses, minus every layer that a
    // static page does not draw.
    var pos = [0, 0.42, 0.72, 1.0], L = 0;
    for (var k = 0; k < 3; k++) {
      L += (luma(stops[k]) + luma(stops[k + 1])) / 2 * (pos[k + 1] - pos[k]);
    }
    applyScrim(el, L);
  }

  // ---------------------------------------------------- the album backdrop
  // Play Music paints the cover of whatever is playing behind the whole page:
  // big, blurred and subdued.
  //
  // WHY IT LIVES HERE rather than in the card. This module already owns a
  // view's background -- the mounting order against hui-view-background, the
  // teardown rules, and above all the luminance CAP that keeps the glass
  // pills readable. A second module painting its own full-bleed layer would
  // have to re-derive all of it, and would sit outside the cap.
  //
  // THE CARD STILL OWNS THE LOOKUP. hk-media.js resolves which speaker is
  // selected and what its artwork is -- it has the generated speaker map --
  // and publishes the URL. Duplicating that map here would let the two drift
  // apart.
  var ART_O = 0.72;              // how much of the composite is cover
  // A FLOOR AS WELL AS A CEILING: the backdrop must not go too dark either --
  // the color is the point.
  //
  // CAP stops a bright cover washing the glass out. The floor stops the
  // opposite: a black sleeve can measure a mean luma of 9, and at a fixed
  // 0.72 it drags the composite to 21 and drowns the purple palette
  // underneath. No scrim fires -- correctly,
  // there is nothing to darken -- and the page just goes black.
  //
  // So the cover's SHARE is what gives, not its brightness. Brightening a
  // near-black sleeve only makes gray: there is no color in it to amplify.
  // Letting the palette carry more of the composite puts the page back in
  // music purple, which is the page's own identity.
  //
  // 40 and not higher because the palette itself is only 51 -- these skies are
  // authored deep (see CAP) -- so a floor near it would leave the cover
  // contributing nothing at all.
  var ART_FLOOR = 40;
  var artUrl = (typeof window !== 'undefined' && window.hkNowArt) || null;
  var artLuma = {};              // url -> mean luma 0-255, measured once

  // The card publishes; this listens. Reading window.hkNowArt above covers
  // the other order -- a sky that mounts after the card has already drawn.
  if (typeof window !== 'undefined') {
    window.addEventListener('hk-now-art', function (ev) {
      var url = (ev && ev.detail && ev.detail.url) || null;
      if (url === artUrl) return;
      artUrl = url;
      // Only the page that asked for it, and only while it is up.
      if (mounted && mounted.classList.contains('static') &&
          mountedVariant === 'playmusic') {
        paintAlbum(mounted, artUrl, mounted._hkGradL || mounted._hkRaw);
      }
    });
  }

  // MEASURED, NOT ASSUMED, and this is what keeps it from going muddy.
  //
  // The cap arithmetic needs the mean luminance of what is actually painted.
  // For a gradient that is four stops and some algebra; for a cover it is the
  // pixels. So the image is drawn to a tiny canvas and averaged.
  //
  // Keeping the color is the reason this is worth the trouble. A fixed scrim
  // would have to assume the brightest plausible cover and would then crush
  // every dark one. Measuring means a dark cover gets NO scrim at all and
  // keeps its color, and only a genuinely bright one is brought down.
  //
  // Same-origin (/api/media_player_proxy/...), so the canvas is not tainted.
  function measureArt(url, done) {
    if (artLuma[url] !== undefined) { done(artLuma[url]); return; }
    var img = new Image();
    img.onload = function () {
      var L = null;
      try {
        var N = 16, c = document.createElement('canvas');
        c.width = N; c.height = N;
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, N, N);
        var d = x.getImageData(0, 0, N, N).data, sum = 0;
        for (var i = 0; i < d.length; i += 4) {
          // Rec. 709, the same weights luma() uses for the palette stops, so
          // a cover and a gradient are measured on one scale.
          sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        }
        L = sum / (d.length / 4);
      } catch (e) { L = null; }   // tainted or blocked: fall back below
      artLuma[url] = L;
      done(L);
    };
    img.onerror = function () { artLuma[url] = null; done(null); };
    img.src = url;
  }

  // ---------------------------------------------------- a photo of your own
  // THE BACKGROUND'S PHOTO (2026-10-13; Sky / Background -> Photo, for All
  // Screens, a screen or a page): the whole picture, sharp and still, on the
  // .art layer the album uses -- unblurred and edge to edge (.photo). Under
  // it the views' own near-black, for the moment before it loads. Measured
  // like a cover, so the cap darkens only a bright photo (applyScrim): the
  // glass and its text stay readable on any picture. No grain: it is a
  // picture, not a surface.
  var PHOTO_UNDER = ['#05070e', '#05070e', '#05070e', '#05070e'];
  // ITS LOOK (Sky / Background -> Photo -> Look, hkSettings.photoLook):
  // blurred, dimmed and saturated by the layer's own filter -- the glass's
  // Pre-rendered picture redraws the same filter (hk-skyshot) -- and a
  // tint: the backdrop under it (render) showing through at `amount`, the
  // photo's share 1 - amount. A blurred layer overhangs the screen by more
  // than its blur, or its edges would fade to the dark under it.
  function photoVars(el, look) {
    var lk = look || {}, st = el.style, f = [];
    // only what the look asks for: a photo as taken has no filter at all
    if (lk.blur) f.push('blur(' + lk.blur + 'px)');
    if (lk.saturate != null && lk.saturate !== 1) f.push('saturate(' + lk.saturate + ')');
    if (lk.dim) f.push('brightness(' + (1 - lk.dim) + ')');
    st.setProperty('--phF', f.join(' ') || 'none');
    st.setProperty('--phI', (lk.blur ? -Math.ceil(lk.blur * 2.5) : 0) + 'px');
    return 1 - (lk.amount || 0);
  }
  // the composite the cap judges: the photo, dimmed, over its tint
  function photoScrim(el, L, look, gradL) {
    var lum = (L === null ? 200 : L) * (1 - ((look || {}).dim || 0)), o = 1 - ((look || {}).amount || 0);
    applyScrim(el, o * lum + (1 - o) * (gradL || 0));
  }
  function paintPhoto(el, url, look, gradL) {
    el.style.setProperty('--grainO', '0');
    var share = photoVars(el, look);
    if (el._hkPhoto === url && el._hkPhotoL !== undefined) {
      // the album may have used the layer since (Play Music)
      var a0 = el.querySelector('.art');
      el.style.setProperty('--art', 'url("' + url + '")');
      if (a0) a0.style.backgroundImage = 'url("' + url + '")';
      el.style.setProperty('--artO', String(share));
      photoScrim(el, el._hkPhotoL, look, gradL);
      return;
    }
    el._hkPhoto = url;
    el._hkPhotoL = undefined;
    measureArt(url, function (L) {
      if (!el.isConnected || el._hkPhoto !== url) return;
      var art = el.querySelector('.art');
      el.style.setProperty('--art', 'url("' + url + '")');
      if (art) art.style.backgroundImage = 'url("' + url + '")';
      el.style.setProperty('--artO', String(share));
      // one we could not measure is assumed bright, as a cover is
      el._hkPhotoL = L === null ? null : Math.round(L);
      photoScrim(el, el._hkPhotoL, look, gradL);
      if (el === mounted) announce();
    });
  }

  // ONE COVER TO THE NEXT, CROSSFADED (2026-10-14: switching between two
  // groups playing snapped the whole page from one color to the other in a
  // frame -- the user's recording). The cover going out stays on top as a
  // copy of the layer and fades away over the new one, which is already
  // loaded (measureArt). Two blurred layers for ART_FADE ms only, then one.
  var ART_FADE = 900;
  function artFade(el, art, next) {
    var was = art && art.style.backgroundImage;
    var on = parseFloat(el.style.getPropertyValue('--artO')) > 0;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var gone = el.querySelector('.art.was');
    if (gone) gone.remove();
    if (!was || was === next || !on || still) return;
    var old = art.cloneNode(false);
    old.classList.add('was');
    old.style.backgroundImage = was;
    old.style.opacity = getComputedStyle(art).opacity;
    old.style.transition = 'opacity ' + ART_FADE + 'ms ease';
    art.parentNode.insertBefore(old, art.nextSibling);
    void old.offsetWidth;
    old.style.opacity = '0';
    setTimeout(function () { if (old.parentNode) old.remove(); }, ART_FADE + 120);
  }
  function paintAlbum(el, url, gradL) {
    if (!url) {
      el.style.setProperty('--artO', '0');
      el.style.removeProperty('--art');
      applyScrim(el, gradL);
      if (el === mounted) announce();
      return;
    }
    measureArt(url, function (L) {
      if (!el.isConnected) return;
      var art = el.querySelector('.art'), next = 'url("' + url + '")';
      artFade(el, art, next);
      el.style.setProperty('--art', next);
      art.style.backgroundImage = next;
      // The composite the cap has to judge: the cover over the palette at
      // ART_O. A cover we could not measure is assumed BRIGHT, because the
      // failure that matters is unreadable pills, not a dull background.
      var lum = (L === null ? 200 : L);
      // Solve the composite for the cover's share:
      //     C = o*lum + (1-o)*gradL      ->      o = (gradL - C) / (gradL - lum)
      // Only meaningful when the cover is darker than the palette AND the
      // palette can actually reach the floor; otherwise keep the full share.
      var o = ART_O;
      if (lum < ART_FLOOR && gradL > lum) {
        o = Math.min(ART_O, Math.max(0.18,
              (gradL - Math.min(ART_FLOOR, gradL)) / (gradL - lum)));
      }
      el.style.setProperty('--artO', String(o));
      applyScrim(el, o * lum + (1 - o) * gradL);
      el._hkArtL = L === null ? null : Math.round(L);
      el._hkArtO = o;
      if (el === mounted) announce();
    });
  }

  // ------------------------------------------------------------------- API
  var mounted = null;
  var mountedPath = null;
  // Which palette is on the mounted element. The album repaint needs it, and
  // it must not be re-derived from the URL -- a track change arrives with no
  // navigation, so there is nothing to re-resolve from.
  var mountedVariant = null;
  // the page the sky is behind now (resolve: the view's sky_page), for
  // read()'s per-page rules
  var skyPage = null;
  // Set when the next paint must be instant rather than eased -- see the
  // .hk-snap rule in SHEET.
  var snapNext = false, paintSig = '';

  function teardown() {
    if (!mounted) return;
    // the front layer (Moving Things: In Front) is the sky's sibling and is
    // styled by the sky's sheet: it goes first, or it is left in the page
    // unstyled, and a sky mounted again builds a second one beside it
    frontSync(mounted, false);
    if (mounted._hkNear) mounted._hkNear.dispose();
    detachStyles(mounted);
    mounted.remove();
    mounted = null;
    mountedPath = null;
    mountedVariant = null;
  }

  // THE SKY OUTLIVES A VIEW CHANGE, AND NOTHING HERE DECIDES WHEN IT ENDS.
  //
  // hui-root swaps views WITHOUT unmounting hui-view-container, so the sky
  // element survives a navigation untouched and the next view simply repaints
  // it -- a palette change, never an unmount. Tearing it down on every path
  // change would let the wallpaper flash through between two views.
  //
  // The only teardowns are selfRender()'s: a view whose config wants no sky,
  // and the kill switch. Both read the Lovelace config, so neither guesses.
  //
  // NO GRACE TIMER. Waiting a fixed time after a path change to see whether
  // the new view claims the sky races the view build: a tablet's first visit
  // to a page can block the main thread past 1500ms, so such a timer fires
  // before the new view is seen and the sky is torn down and rebuilt from
  // nothing -- the background loading late on page changes (reproduced with
  // a synthetic 1.7s stall: element replaced at ~2000ms). The config is the
  // authority, so nothing here has to wait.
  var watching = false;
  function watch() {
    if (watching) return;
    watching = true;
    document.addEventListener('visibilitychange', applyHidden);
  }

  // Pausing is driven by TWO things, and the second one is what makes the
  // sky safe to leave on a room dashboard.
  //
  // document.hidden alone is not enough. On the room view -- the page a wall
  // tablet shows for its entire life -- the WallPanel screensaver is a DOM
  // overlay in the SAME document, so document.hidden stays false and the
  // compositor would keep running rain and cloud decks all night behind a
  // photo slideshow: precisely the "warm to the touch all night" failure the
  // performance notes at the top of this file warn about.
  //
  // So each dashboard can name its tablet's screensaver boolean (`sleep:` in
  // its `sky:` block -- the one the wake and sleep automations drive) and the
  // sky pauses with the screen.
  //
  // The entity is REMEMBERED rather than read from opts each time: the sky
  // survives navigation, so a plain `opts.sleep || false` would reset asleep
  // to false the moment you opened a page that does not name it.
  var asleep = false;
  var sleepEntity = null;
  // ASLEEP = the tablet's screensaver switch is on, OR HK Frontend's own
  // screensaver is showing (hk-saver.js) -- a screen with no switch (no
  // Tablet Room) still pauses behind its photos.
  //
  // THE SCREEN'S OWN PHOTO SWITCH IS HK-SAVER'S TO READ (2026-10-09). When the
  // sleep entity is the switch hk-saver follows, the sky is asleep only while
  // the photos are actually showing. The house's sleep turns that switch on
  // and puts the kiosk's Black screensaver up; the photos are not shown under
  // the black (hk-saver), yet the sky went .hidden there -- its layers let go
  // -- and took them all back as the wake turned the switch off: the bottom
  // of the scenery vanished for three frames, every scripted wake
  // (screen-recorded on the Loft: a direct wake that left the switch on never
  // did it; turning the switch off made it every time).
  function sleeping() {
    var S = window.hkSaver, running = !!(S && S.running && S.running());
    var c = S && S.config && S.config();
    if (c && c.entity && c.entity === sleepEntity) return running;
    return asleep || running;
  }
  // UNDER THE KIOSK'S BLACK, HELD (2026-10-09). With Kiosk Satellite's
  // "Pause dashboard during screensaver" off, the tablet draws the page
  // behind its black for as long as anything moves on it: the sky and the
  // cards kept animating there and the Loft spent 1.3 cores on nothing
  // (measured). Held: the sky's and the cards' animations paused, the sky's
  // layers kept -- letting them go (.hidden) is for when the photos cover
  // the page; let go under the black, they all came back at the wake and
  // the scenery blinked.
  var ksDark = false;
  ['kiosksatellite:screensaverstart', 'kiosksatellite:screenoff'].forEach(function (t) {
    try { window.addEventListener(t, function () { ksDark = true; applyHidden(); }); } catch (e) { /* no window events */ }
  });
  ['kiosksatellite:screensaverstop', 'kiosksatellite:screenon'].forEach(function (t) {
    try { window.addEventListener(t, function () { ksDark = false; applyHidden(); }); } catch (e) { /* no window events */ }
  });
  // ...and HK's own black screen (hk-saver.js: any black, said after the
  // kiosk's own events, so it has the last word)
  try {
    window.addEventListener('hk-black', function (e) { ksDark = !!(e && e.detail && e.detail.on); applyHidden(); });
  } catch (e) { /* no window events */ }
  // NOT IN FOCUS (Sky / Background -> Pause When Not in Focus, 2026-10-10).
  // A computer leaves the dashboard open beside other work, and while
  // anything moves the browser draws the whole window every frame -- the
  // sky changing under the frosted plates re-blurs them each time. Measured
  // on a Mac (Chrome, Home, 1512x945 at 2x): 31% of a core with nobody
  // looking at it -- GPU process 21, renderer 10, main thread only 3. So
  // while another window has the focus the sky and the cards are HELD, as
  // under the kiosk's black: their layers kept, so the focus coming back
  // starts them on the next frame from where they stood (measured 15 ms,
  // the cloud deck at -9.96 px resuming at -9.99): 3%.
  // ONLY WHERE THERE IS A MOUSE. A wall tablet's or a phone's WebView can
  // report no focus until its first touch -- held there, a screen would sit
  // still from boot -- and nothing on one is ever beside other work.
  // Starts focused: only a real blur holds it.
  var unfocused = false;
  var FOCUS_DEVICE = (function () {
    try { return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (e) { return false; }
  })();
  function focusPause() {
    var S = window.hkSettings, look = null;
    try { look = S && S.skyLook ? S.skyLook() : null; } catch (e) { look = null; }
    return !look || look.focusPause !== false;
  }
  function focusCheck() {
    var u = FOCUS_DEVICE && focusPause() && typeof document.hasFocus === 'function' && !document.hasFocus();
    if (u === unfocused) return;
    unfocused = u;
    applyHidden();
  }
  if (FOCUS_DEVICE) {
    try {
      // after the blur settles: the focus moving into a frame on the page
      // blurs the window, while the document still has it
      window.addEventListener('blur', function () { setTimeout(focusCheck, 0); });
      window.addEventListener('focus', focusCheck);
      // a press or a key means the focus, should its event go missing
      document.addEventListener('pointerdown', focusCheck, true);
      document.addEventListener('keydown', focusCheck, true);
      // the setting changed, or another screen's settings now apply
      window.addEventListener('hk-module-ready', focusCheck);
      SH.onNavigate(focusCheck);
    } catch (e) { /* no window events */ }
  }
  // WHAT THE REALISTIC CLOUDS ARE NOW: how many are up, and how many of the
  // ceiling's canvases have their art on. A pre-rendered blur (hk-glass.js)
  // painted at load came before them -- the manifest and the art arrive
  // after the first paint -- and wore a sky with no clouds, darker than the
  // one behind it, until its next paint 5 s on (2026-10-10).
  function cloudsSig(el) {
    var l = el && el.querySelector ? el.querySelector('.rcl') : null;
    if (!l) return '';
    var n = l.querySelectorAll('.rc:not(.gone),.rcd:not(.gone)').length, d = 0, cvs = l.querySelectorAll('canvas');
    for (var i = 0; i < cvs.length; i++) if (cvs[i].__drawn) d++;
    return n + 'c' + d;
  }
  // WHAT THE SKY SHOWS, as a signature: big -- what is in it (its classes,
  // less the ones that only say how it is shown: hidden, held, cut to,
  // still; and its realistic clouds), small -- its light (the colors and
  // places written on it). It changes when, and only when, the sky's
  // picture does: hk-sky-paint is said then, and a pre-rendered blur
  // (hk-glass.js) paints from it instead of looking every few seconds.
  var SKY_STATES = /(^|\s)(hidden|held|hk-snap|noanim)(?=\s|$)/g;
  // the season's field as built: the old decorations' key, or the new
  // decorations' theme (paintSeason) -- each changes only on a rebuild. A
  // key with no season and no surprise ('||...') is an empty field: its
  // wind and night parts change nothing that shows.
  function seasonSig(el) {
    var k = el._hkSeasonKey || '';
    if (k.indexOf('||') === 0) k = '';
    return k + '|' + (el._hkNear ? el._hkNearTheme + '|' + el._hkNearLv : '');
  }
  function skySig(el) {
    if (!el) return { big: 'none', small: '' };
    // (the Play Music page's album art is what is IN it: a new song's cover
    // is a new picture, not a change of light)
    // (and the season's field, which paintSeason builds inside .season with no
    // class on the sky to say so: Decorations off emptied it and the pills
    // kept the decorated picture until their next timed repaint, 2026-10-13)
    return { big: String(el.className).replace(SKY_STATES, ' ').replace(/\s+/g, ' ').trim() + '|' + cloudsSig(el) +
                  '|' + (el.style.getPropertyValue('--art') || '') + '|' + seasonSig(el),
             small: el.getAttribute('style') || '' };
  }
  // THE SKY CHANGED (skySig, or the page): said once per change, not on
  // every render -- Tint from Background follows its colors
  // (hk-frosttint.js), a pre-rendered blur its picture (hk-glass.js). Said
  // after every render, and as a new song's cover lands on the Play Music
  // page (paintAlbum: no render follows a track change, and the pills kept
  // the last song's blur until their own refresh, 2026-10-10).
  // ...ONCE IT HAS SETTLED. A change fades in -- the album wash's opacity
  // (1.2 s), the scrim (4 s), the light -- and a picture taken at its start
  // kept the fade's first frame, with nothing to say so later: the signature
  // already read as the end. So a change is said when the sky's transitions
  // have finished (the browser's own list of them; the loops that drift and
  // fall are animations, not transitions, and never wait), at most SETTLE_MS on.
  //
  // ...AND AT ONCE, as hk-sky-change, for what can paint the end of a fade
  // before it is reached: a pre-rendered blur (hk-glass.js) paints the sky
  // as it will be (hk-skyshot.js, opts.settle) and fades in with it -- the
  // pills changed only once the song's wash had finished, then faded for
  // 2.5 s more (2026-10-11). Said once per change; what reads colors as
  // they are now (Tint from Background) keeps waiting for hk-sky-paint.
  var SETTLE_MS = 6000, settleGen = 0, saidSig = null, saidFor = null, changeSig = null, changedSig = null, changedFor = null;
  function announce() {
    if (!mounted) return;
    var sg = skySig(mounted), psig = sg.big + '||' + sg.small + '|' + location.pathname;
    if (psig === paintSig) return;
    if (psig !== changeSig) {
      changeSig = psig; changedSig = sg; changedFor = mounted;
      try { window.dispatchEvent(new Event('hk-sky-change')); } catch (e) { /* no window events */ }
    }
    var fading = [];
    try {
      if (mounted.getAnimations && typeof CSSTransition !== 'undefined') {
        fading = mounted.getAnimations({ subtree: true }).filter(function (an) {
          return an instanceof CSSTransition && an.playState === 'running';
        });
      }
    } catch (e) { fading = []; }
    if (fading.length) {
      var gen = ++settleGen;
      Promise.race([
        Promise.all(fading.map(function (an) { return an.finished.catch(function () { /* cancelled: settled */ }); })),
        new Promise(function (ok) { setTimeout(ok, SETTLE_MS); })
      ]).then(function () { if (gen === settleGen) announce(); });
      return;
    }
    settleGen++;
    paintSig = psig;
    saidSig = sg; saidFor = mounted;
    try { window.dispatchEvent(new Event('hk-sky-paint')); } catch (e) { /* no window events */ }
  }
  // WHAT MOVES ACROSS THE SCENE, by the animation that carries it: what
  // flies, falls, bursts, wanders, flashes -- bats, the witch and the
  // sleigh, geese, falling leaves and petals, flakes, fireworks and
  // confetti, meteors, lightning, fireflies, the glints. A still picture of
  // the sky (hk-skyshot.js, the Pre-rendered blur) leaves these out: frozen,
  // each would be a smudge where nothing is a moment later. What drifts
  // slowly stays in (the clouds, the fog's wisps, the aurora), and so do the
  // rain and snow decks (hk-fall): blurred, a veil, which they are live too.
  // Names here are prefixes (the flights' are made per speed: near-flock-x…).
  var MOVERS = ['hk-spfly', 'hk-spfall', 'hk-xfall', 'hk-spburst', 'near-swirl', 'hk-bolt', 'near-confetti',
                'hk-meteor', 'near-glow', 'near-glint', 'hk-ffwander', 'hk-witchfly', 'hk-sleigh', 'hk-batfly',
                'near-flock', 'hk-leaffall', 'hk-leaftumble', 'near-petal', 'near-geese'];
  // WHAT DRIFTS ACROSS THE SKY while staying in its picture: the clouds
  // (realistic and classic decks), the fog's wisps, the moon's mist, the
  // aurora. A pre-rendered blur (hk-glass.js) paints its picture again every
  // couple of seconds while any of these runs -- the pills over a cloud lag
  // it otherwise (the user, 2026-10-11). Not what loops in place (a candle's
  // flicker, a twinkle, a sway, the rain and snow decks): a picture taken at
  // a random moment of a loop would make the glass pulse.
  var DRIFTS = ['hk-rc', 'hk-drift', 'hk-fwisp', 'near-wisp', 'near-aurora'];
  function drifting() {
    var el = mounted && mounted.isConnected ? mounted : null;
    // (paused -- not on screen, the window not in focus, the kiosk's black,
    // a still page -- is not drifting: nothing to follow)
    if (!el || !el.getAnimations || /(^|\s)(static|noanim|hidden|held)(\s|$)/.test(el.className)) return false;
    var list;
    try { list = el.getAnimations({ subtree: true }); } catch (e) { return false; }
    for (var i = 0; i < list.length; i++) {
      var an = list[i], nm = String(an.animationName || '');
      if (an.playState !== 'running' || !nm) continue;
      for (var j = 0; j < DRIFTS.length; j++) if (nm.indexOf(DRIFTS[j]) === 0) return true;
    }
    return false;
  }
  function moves(cs) {
    var names = String(cs && cs.animationName || '').split(',');
    for (var i = 0; i < names.length; i++) {
      var nm = names[i].trim();
      for (var j = 0; j < MOVERS.length; j++) if (nm.indexOf(MOVERS[j]) === 0) return true;
    }
    return false;
  }
  // ...and whether they are still on their way: wanted, but the manifest or
  // the ceiling's art not in yet
  function cloudsPending(el) {
    var l = el && el.querySelector ? el.querySelector('.rcl') : null;
    if (!l || !l._rcOn || RC_FAILED) return false;
    if (!RC_MAN) return true;
    var cvs = l.querySelectorAll('canvas');
    for (var i = 0; i < cvs.length; i++) if (cvs[i].__src && !cvs[i].__drawn) return true;
    return false;
  }
  function applyHidden() {
    var hid = document.hidden || sleeping(), still = ksDark || unfocused, z = sleeping() || still;
    if (mounted) {
      mounted.classList.toggle('hidden', hid);
      mounted.classList.toggle('held', !hid && still);
    }
    // ...and tell the cards, which pause their own animations behind the
    // screensaver and the kiosk's black too (hk-base.js, hk-asleep). Only on
    // a change.
    if (!!window.__hkAsleep !== z) {
      window.__hkAsleep = z;
      try { window.dispatchEvent(new Event('hk-asleep')); } catch (e) { /* no window events: nothing to tell */ }
    }
  }

  window.hkSky = {
    // THE SCREEN IS ASLEEP: this tablet's screensaver boolean is on (the
    // photos are up). WallPanel is an overlay in this same document, so
    // document.hidden stays false behind it; a module with idle work of its
    // own (hk-glass's backstop) asks this too.
    asleep: function () { return sleeping() || ksDark || unfocused; },
    // a black screen is up (the kiosk's or HK's own): the page runs but is
    // not drawn -- a card built meanwhile must not start what nobody sees
    // (hk-cameras.js _resting)
    dark: function () { return ksDark; },
    // the mounted sky element, or null (hk-glass.js paints its pre-rendered
    // frost from it)
    element: function () { return mounted; },
    // the page whose sky this is now -- set as that page's view takes the sky
    // over (render), a frame or two after the view itself is on the page
    // (hk-glass.js wears a page's picture from then, 2026-10-13)
    path: function () { return mounted && mounted.isConnected ? mountedPath : null; },
    // for a pre-rendered blur (hk-glass.js): what the sky shows (skySig),
    // and whether more of it is on its way (the realistic clouds)
    // what the sky SHOWS: the last change said (announce, hk-sky-change) --
    // said the moment it starts, as the picture is painted as it will be
    // once its fades are done (hk-skyshot.js settle); a fade too slow for
    // that is painted again when the sky has settled (hk-sky-paint). (It was
    // the last change SETTLED, as a picture then caught a fade half-way and
    // kept it: the Play Music pills, a page loaded straight onto it.)
    sig: function () {
      if (window.hkSettings && window.hkSettings.rendering && window.hkSettings.rendering().flat) return;
      var el = mounted && mounted.isConnected ? mounted : null;
      if (!el) return skySig(null);
      if (changedSig && changedFor === el) return changedSig;
      return saidSig && saidFor === el ? saidSig : skySig(el);
    },
    cloudsPending: function () { return cloudsPending(mounted); },
    // is anything drifting across the sky now (DRIFTS)?
    drifting: drifting,
    // does this piece move across the scene (MOVERS)? -- given its computed style
    moves: moves,
    // tests: the sleep entity and its state, as render() would read them
    _sleepAs: function (entity, state) { sleepEntity = entity; asleep = state === 'on'; },
    // hk-saver.js calls this when its screensaver starts or stops
    saverChanged: function () { applyHidden(); },
    // the forecast screensaver's own sky + landscape (scene() above)
    scene: scene,
    // which land and lights a holiday dresses the screensaver in (tests)
    _holidayLand: holidayLand,
    _holidayLights: holidayLights,
    _land: { season: landSeason, light: landLight, file: landFile },
    // Called by selfRender() below. Returns '' so it renders nothing of its
    // own.
    //
    // `opts` is optional and carries entity ids from the dashboard's `sky:`
    // block:
    //   enable -- an input_boolean kill switch. Off tears the sky down and
    //             restores whatever `background:` the view declares, with no
    //             config reload. Absent means always on.
    //   sleep  -- the tablet's screensaver boolean; see applyHidden.
    //   variant-- a key into STATIC. Paints that fixed gradient and no
    //             weather at all. Absent means the live sky.
    render: function (client, card, opts) {
      try {
        if (!client || !card) return '';
        opts = opts || {};
        var P = window.hkSettings, policy = P && P.rendering ? P.rendering() : { flat: false };
        if (mounted && !!mounted._hkFlat !== policy.flat) teardown();
        if (policy.flat) { renderFlat(client, card, opts, policy); return ''; }

        // Kill switch first: an explicit `off` tears down a mounted sky rather
        // than just declining to mount one, so flipping it is immediate.
        var en = opts.enable && client.states[opts.enable];
        if (en && en.state === 'off') { teardown(); return ''; }

        if (opts.sleep) sleepEntity = opts.sleep;
        skyPage = opts.page || null;
        var sl = sleepEntity && client.states[sleepEntity];
        if (sl) asleep = sl.state === 'on';

        // Adopt a sky mounted by the PREVIOUS view rather than rebuilding.
        // hui-view-container survives the swap, so the element is still there
        // and still correct; only the path label and the palette change. This
        // is the other half of the note above watch().
        if (mounted && mounted.isConnected && location.pathname !== mountedPath) {
          mountedPath = location.pathname;
          // A different page: cut to the new palette instead of melting into
          // it over four seconds.
          snapNext = true;
        }

        if (!mounted || !mounted.isConnected) {
          var host = container(card);
          if (!host) return '';
          register();
          mounted = build(host);
          mountedPath = location.pathname;
          watch();
          // A brand new element has no previous state worth easing from
          // either, so the first paint is a cut as well.
          snapNext = true;
        }
        // A static page paints a fixed palette and draws no weather at all.
        var snapping = snapNext;
        snapNext = false;
        if (snapping) mounted.classList.add('hk-snap');

        // a page's still backdrop: its day stops while the sun is up, its
        // night ones after
        var up = client.states['sun.sun'] && Number((client.states['sun.sun'].attributes || {}).elevation) > 0;
        // a photo's tint is a backdrop under it, showing through (paintPhoto)
        var tint = opts.photo && opts.look && opts.look.tint;
        var stops = opts.photo ? (tint ? (up ? tint.day : tint.night) : PHOTO_UNDER) : opts.still
          ? (up ? opts.still.day : opts.still.night)
          : opts.variant && STATIC[opts.variant];
        if (stops && opts.variant === 'lights' && !opts.photo && !opts.still) {
          var HS = window.hkSettings, lc = HS && HS.get ? HS.get('headers.lights', null) : null;
          if (!lc || lc.sky_follow !== false) {
            var kv = sunKelvin(client, lc);
            if (kv) stops = tintStops(stops, kv.k);
          }
        }
        if (stops) {
          mounted.classList.add('static');
          mounted.classList.toggle('photo', !!opts.photo);
          paintStatic(mounted, stops);
          mountedVariant = opts.variant || (opts.photo ? 'photo' : 'still');
          // _hkRaw is the PALETTE's own luma, before any scrim. Keep it: the
          // album composite is measured against the gradient underneath it,
          // and paintStatic will not run again on a track change.
          mounted._hkGradL = mounted._hkRaw;
          // playmusic is the one static page whose backdrop is not fixed.
          if (opts.photo) {
            paintPhoto(mounted, opts.photo, opts.look, mounted._hkGradL);
          } else if (opts.variant === 'playmusic') {
            paintAlbum(mounted, artUrl, mounted._hkGradL);
          } else {
            mounted.style.setProperty('--artO', '0');
          }
        } else {
          mounted.classList.remove('static');
          mounted.classList.remove('photo');
          mountedVariant = null;
          mounted.style.setProperty('--artO', '0');
          var rs = read(client);
          // a page's own fixed backdrop, over this screen's (resolve)
          if (opts.backdrop) rs.backdrop = opts.backdrop;
          else if (opts.backdrop === false) rs.backdrop = null;
          paint(mounted, rs);
        }
        applyHidden();
        // THE SKY CHANGED (skySig, or the page): said once per change, not on
        // every render -- Tint from Background follows its colors
        // (hk-frosttint.js), a pre-rendered blur its picture (hk-glass.js)
        announce();

        if (snapping) {
          // Force a style flush WHILE transitions are still off, so the new
          // values become the computed style rather than the start of an
          // animation. Reading offsetWidth is the standard way to do that.
          // Without it, removing the class in the same task would leave the
          // browser free to transition from the old values after all.
          var el = mounted;
          void el.offsetWidth;
          requestAnimationFrame(function () {
            if (el && el.isConnected) el.classList.remove('hk-snap');
          });
        }
      } catch (e) {
        console.error('[hk-sky]', e);
      }
      return '';
    },

    _paint: paint,
    _sunKelvin: sunKelvin, _tintStops: tintStops,
    _nearFlat: nearFlat,
    _auroraDraw: auroraDraw,
    _schedule: schedule,
    _witchPath: witchPath,
    _daysUntil: daysUntil,
    _surprise: surpriseFor,
    get _birthdays() { return birthdays(); },
    // hkSky._force({show:true, spooky:true}) then hkSkyAt(-20,{season:'halloween'})
    // previews a spooky night on any date. hkSky._force(null) restores.
    _force: function (v) { FORCE = v || null; return FORCE; },
    // Sky Lab's Show Me Now: the next crossing of everything that crosses, now
    showNow: function () { return showNow(mounted); },
    // Liveliness internals, for tests/test_liveliness.js
    _lv: { lvOf: lvOf, lvRange: lvRange, lvCount: lvCount, kfScale: kfScale, KNOBS: LV_KNOBS },
    // hkSky._pin({season:'halloween', elev:-20, cond:'clear'}) holds a scene
    // across the 3s tick without a competing timer. _pin(null) restores.
    // It repaints at once (Sky Lab drives a real dashboard's sky with it).
    _pin: function (v) {
      PIN = v || null;
      try { stateTick(); } catch (e) { /* not mounted yet: the next tick paints it */ }
      return PIN;
    },
    // the realistic clouds' choices, for the tests
    _rcPlan: function (s, seed) { return rcPlan(s, rng(seed || 1)); },
    _rcLight: rcLight,
    // ...and the overcast ceiling on its canvas (tests/test_cloudceiling.js):
    // its pieces, and one paint of the realistic clouds with a given manifest
    _ceil: { canvases: ceilCanvases, draw: ceilDraw, relight: ceilRelight, tidy: rcTidy, FADE: CEIL_FADE },
    _rcPaint: function (el, s, man) { RC_MAN = man; return paintRealClouds(el, s, true, .45, false, 1); },
    // HK Settings' preview of a theme (see PREVIEW above)
    preview: preview,
    get previewing() { return PREVIEW; },
    _read: read,                // tests: what the sky reads, pins included
    _planned: function (n, d) { return plannedFor(n, d); },
    // hkSky._surpriseForce('birthday') then hkSkyAt(14) shows a theme on any
    // date. _surpriseForce(null) restores.
    _surpriseForce: function (v) { SURPRISE_FORCE = v || null; return SURPRISE_FORCE; },
    _surprises: SURPRISE,
    _paintStatic: paintStatic,
    _static: STATIC,
    _build: build,
    _mounted: function () { return mounted; },
    // For pages/dev/nav-probe.js: which page the sky is currently painted for.
    _mountedPath: function () { return mountedPath; }
  };

  // ======================================================== SELF-MOUNT
  // The sky reads its own configuration out of Lovelace instead of waiting to
  // be called by an invisible card on every view.
  //
  // WHY NO MOUNT CARD. A zero-height card whose only jobs are to hand the client
  // in and to exist on the right page costs a call site on every view -- and
  // with no way to see the new view's config, a path change could only be
  // answered by waiting to find out whether a card on the new view would
  // claim the sky (see watch()). Reading the config answers that
  // immediately.
  //
  // CONFIG SHAPE. A view opts in for itself; the dashboard supplies the
  // entities, beside its existing `wallpanel:` block:
  //
  //     sky:                                     # dashboard level
  //       enable: input_boolean.sky_background
  //       sleep:  input_boolean.wallpanel_screensaver_living_room
  //
  //     sky: true                                # a view: the live sky
  //     sky_variant: energy                      # a view: a fixed palette
  //
  // The page sky's own look -- animations, weather, the backdrop -- is not
  // YAML: it is the Sky / Background settings (HK Settings), which read()
  // folds in on every tick. A view's sky_variant wins for that view either
  // way (see render below).
  //
  // OPT-IN IS PER DASHBOARD. With no `sky:` block in the dashboard config this
  // driver does nothing at all -- it never mounts and, crucially, never TEARS
  // DOWN -- so a dashboard without a sky is left exactly as it is.
  function deepFind(tag) {
    var seen = new Set(), out = null;
    (function walk(root, d) {
      if (!root || d > 40 || out) return;
      var kids = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var i = 0; i < kids.length; i++) {
        var e = kids[i];
        if (e.tagName === tag) { out = e; return; }
        if (e.shadowRoot && !seen.has(e.shadowRoot)) {
          seen.add(e.shadowRoot); walk(e.shadowRoot, d + 1);
        }
      }
    })(document, 0);
    return out;
  }

  // The host's current client (in Home Assistant, the frontend's root element's).
  function clientNow() {
    var HC = window.hkHostClient;
    return (HC && HC.current && HC.current()) || null;
  }

  // READ THE CONFIG, NEVER SNIFF THE DOM. A probe that looks for a marker
  // element and assumes its absence means something goes wrong.
  // lovelace.config is the authority.
  function lovelaceCfg() {
    var p = lovelacePanelEl();
    return (p && p.lovelace && p.lovelace.config) || SH.dashboardConfig() || null;
  }
  // HOME ASSISTANT'S OWN PATH TO THE PANEL AND ITS VIEW CONTAINER, read
  // straight down (as hk-popup's viewNow does) -- deepFind walked every
  // element and shadow root on the page twice a render: every 3 s tick and
  // every page change (measured headless, 6x slower: ~40 ms per 12 page
  // changes in the walks alone). The walk stays as the fallback should
  // Home Assistant ever move them.
  function lovelacePanelEl() {
    var p = SH.panel();
    if (p) return p;
    return SH.tags.panel ? deepFind(SH.tags.panel.toUpperCase()) : null;   // the walk
  }
  function viewContainerEl() {
    var c = SH.viewContainer(lovelacePanelEl());
    if (c) return c;
    return SH.tags.viewContainer ? deepFind(SH.tags.viewContainer.toUpperCase()) : null;
  }

  function currentView(cfg) {
    if (!cfg || !cfg.views) return null;
    // /<dashboard>/<view>  -- the view segment is either a path or an index
    var seg = decodeURIComponent((location.pathname.split('/')[2] || '').split('?')[0]);
    // NO SEGMENT MEANS VIEW 0, which is what Home Assistant itself does with a
    // bare dashboard URL. Without it a dashboard whose first view has
    // `path: null`, opened at /<dashboard> with no view segment, matches
    // nothing and resolve() says FALSE -- a deliberate teardown. A test that
    // always navigates to an explicit /<view> never sees it.
    if (seg === '') return cfg.views[0] || null;
    for (var i = 0; i < cfg.views.length; i++) {
      var v = cfg.views[i];
      if ((v.path != null && String(v.path) === seg) || String(i) === seg) return v;
    }
    // An unknown segment is not "no sky" -- it is a URL this code does not
    // understand, and tearing the sky down on a guess is the worse failure.
    return cfg.views[0] || null;
  }

  // null  -> this dashboard has not opted in; do nothing whatsoever
  // false -> opted in, but THIS view wants no sky; tear down
  // object-> mount with these options
  function resolve() {
    var cfg = lovelaceCfg();
    if (!cfg) return null;
    var flat = !!(window.hkSettings && window.hkSettings.rendering && window.hkSettings.rendering().flat);
    if (!cfg.sky && !flat) return null;
    // A dashboard whose item turns its Live sky off: opted in by its
    // YAML, but no sky on any of its views.
    var M = window.hkCards && window.hkCards.menu;
    if (!flat && M && typeof M.board === 'function' && M.board().sky === false) return false;
    var v = currentView(cfg);
    if (!v) return false;
    // FLAT (2026-10-16): its own backgrounds (hk-settings.js flatBackground)
    // -- a color or one still photo, never the live sky
    if (flat) {
      var FS = window.hkSettings, FC = window.hkCards, fpage = v.sky_page || 'home';
      var fkeys = v.sky_room ? [v.sky_room, v.sky_page] : v.sky_page;
      // a page with a palette of its own in the other looks (sky_variant:
      // Power, Calendar ...) keeps a tone of its own here too
      var fown = typeof v.sky_variant === 'string' || !!(FC && FC.flatOwnGround && FC.flatOwnGround(fpage));
      // FLAT COLORS (2026-10-17): a chosen Accent Color is the seed of an
      // Automatic ground -- only Automatic: a color, photo or landscape
      // chosen stays as chosen
      var fpal = FC && FC.flatPalette ? FC.flatPalette() : null;
      return { flat: FS && FS.flatBackground ? FS.flatBackground(fkeys, fown) : { color: 'auto' }, page: fpage,
               seed: fpal && fpal.ground || null,
               enable: cfg.sky && cfg.sky.enable || null, sleep: cfg.sky && cfg.sky.sleep || null };
    }
    // A PAGE'S OWN BACKGROUND (Sky / Background -> Pages; the view's
    // `sky_page`, set by the generated screen): its own color ('own'), the
    // live sky ('live'), or a fixed backdrop -- read on every tick, so a
    // change shows within seconds and needs no rebuild. Not chosen: the
    // view's own sky_variant / sky, as written.
    var HS = window.hkSettings;
    // a room's page: the room's own (sky_room, its address), else Room Pages'
    var pkeys = v.sky_room ? [v.sky_room, v.sky_page] : v.sky_page;
    var mode = v.sky_page && HS && typeof HS.pageSky === 'function' ? HS.pageSky(pkeys) : null;
    var wants = flat || v.sky === true || typeof v.sky_variant === 'string' || (!!mode && mode !== 'own');
    if (!wants) return false;
    var variant = (typeof v.sky_variant === 'string') ? v.sky_variant : null, backdrop = null;
    var still = null, photo = null, look = null;
    var black = (HS && HS.BLACK) || null;
    if (mode && mode !== 'own') {
      variant = null;
      // 'live': the live ramp itself, whatever the screen's Backdrop (false).
      // 'photo': the page's photo (else the screen's), still. Any other id:
      // that backdrop as a STILL color, the way a page's own color is -- no
      // clouds, weather, animation or decorations. A color picked for a page
      // is a color; the moving sky is Live sky.
      if (mode === 'live') backdrop = false;
      else if (mode === 'photo') {
        photo = typeof HS.pagePhoto === 'function' ? HS.pagePhoto(pkeys) : null;
        if (!photo) still = black;
        else if (typeof HS.pageLook === 'function') look = HS.pageLook(pkeys);
      }
      // 'landscapes' (2026-10-14): the screen's landscape, as a photo
      else if (mode === 'landscapes') {
        var land = typeof HS.pageLandscape === 'function' ? HS.pageLandscape(pkeys) : null;
        photo = land && land.photo;
        if (!photo) still = black; else look = land.look;
      }
      else still = typeof HS.pageBackdrop === 'function' ? HS.pageBackdrop(mode) : null;
    } else if (!variant && HS && typeof HS.skyLook === 'function') {
      // THE BACKGROUND (2026-10-13): a page that shows the live sky by
      // itself (Home, the room pages, Weather ...) shows the screen's
      // Background instead when that is a Color or a Photo -- a still, with
      // no sun, moon, stars, weather or decorations. (A Backdrop only
      // recolors the live sky; its stars still showed through.)
      var bg = HS.skyLook().background;
      if (bg && bg.mode === 'color') still = bg.stops || black;
      else if (bg && bg.mode === 'photo') { photo = bg.photo || null; look = bg.look || null; if (!photo) still = bg.stops || black; }
    }
    return { variant: variant, backdrop: backdrop, still: still, photo: photo, look: look, page: v.sky_page || null,
             enable: cfg.sky && cfg.sky.enable || null,
             sleep: cfg.sky && cfg.sky.sleep || null };
  }

  // FLAT: one solid color or one still photo under a fixed fade -- no sky
  // layers, canvas, grain, sampling, seasonal scene or blur. `opts.flat` is
  // the page's (resolve: hk-settings.js flatBackground).
  // One bounded bitmap per mounted wallpaper; no work on repeated state pushes.
  // The request is replaced on navigation/settings changes, so a late image
  // load can only paint the latest request. Canvas shares the image's cover fit.
  function renderFlatImage(layer, pic, look, color) {
    var key = (pic.getAttribute('src') || '') + '|' + [look.mode, look.strength, look.depth, look.brightness, color].join('|');
    if (!layer._hkImageCanvas) {
      var canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
      layer.insertBefore(canvas, layer.lastChild); layer._hkImageCanvas = canvas;
    }
    if (layer._hkImageRequest && layer._hkImageRequest.key === key) return;
    layer._hkImageRequest = { key: key, look: look, color: color };
    layer._hkImageCanvas.style.display = 'none'; pic.style.display = 'none';
    var draw = function () {
      var request = layer._hkImageRequest;
      if (!request || request.painted || !pic.getAttribute('src') || !layer.isConnected) return;
      try {
        if (window.hkFlatImage.paint(layer._hkImageCanvas, pic, request.look, request.color)) {
          layer._hkImageCanvas.style.display = 'block';
          request.painted = true;
          layer._hkImagePaints = (layer._hkImagePaints || 0) + 1;
        }
      } catch (e) { console.warn('[hk-flat-image] Photo could not be processed', e); }
    };
    pic.onload = draw;
    if (pic.complete && pic.naturalWidth) draw();
  }

  function renderFlat(client, card, opts, policy) {
    var en = opts.enable && client.states[opts.enable];
    var bg = (en && en.state === 'off') ? { color: 'auto' } : (opts.flat || { color: 'auto' });
    if (!mounted || !mounted.isConnected) {
      var host = container(card); if (!host) return;
      // position:fixed, like the SHEET: the element covers the VIEWPORT.
      // (An absolute element in the scrollable view container sized to the
      // whole content -- 6 000+ px on a tablet -- and the landscape covered
      // under it scaled up with it: the "large blown up version" with no
      // fade. z-index -1 is the wallpaper's place, under the views; contain
      // clips its children to the viewport; overflow:hidden for the same.)
      mounted = document.createElement('div'); mounted.id = 'hk-sky'; mounted._hkFlat = true;
      mounted.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict;isolation:isolate';
      var img = document.createElement('img'); img.alt = '';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
      // a photo that can't be had: the theme's ground at once, not a blank
      img.onerror = function () {
        img.style.display = 'none'; img.removeAttribute('src');
        var layer = img.parentNode;
        if (layer) { layer.lastChild.style.background = 'transparent'; if (layer._hkImageCanvas) layer._hkImageCanvas.style.display = 'none'; }
      };
      var scrim = document.createElement('div');
      scrim.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      // THE TINT (2026-10-17, the user: "convert the picture to grayscale and
      // then apply the tint"): a layer in the tint's color blended as
      // `color` -- the photo keeps its light and dark and takes the tint's
      // hue and saturation, a duotone; its opacity the Tint Strength. Then
      // the Tint Brightness: white or black over it. Still layers, drawn
      // once: no filter, nothing that runs.
      var tintL = document.createElement('div'), lightL = document.createElement('div');
      tintL.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:color;display:none';
      lightL.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none';
      mounted.appendChild(img); mounted.appendChild(tintL); mounted.appendChild(lightL); mounted.appendChild(scrim);
      var vb = SH.viewBackground(host);
      if (vb && vb.nextSibling) host.insertBefore(mounted, vb.nextSibling); else host.insertBefore(mounted, host.firstChild);
      watch();
    }
    mountedPath = location.pathname;
    var C = window.hkCards, page = opts.page || 'home';
    var ground = C && C.flatColorHex ? C.flatColorHex(bg.color || 'auto', policy.theme, page)
               : policy.theme === 'light' ? '#EEECE6' : '#17181A';
    // (a seed's ground in place of Automatic's -- a photo still waiting, or
    // gone, falls back to it too, its choice kept)
    if ((bg.color || 'auto') === 'auto' && opts.seed) ground = opts.seed;
    if (bg.photo) ground = opts.seed || (C && C.flatGround ? C.flatGround('home', policy.theme) : ground);
    mounted.style.background = ground;
    var pic = mounted.firstChild, src = bg.photo || '';
    if (mounted._hkPhoto !== src) {
      mounted._hkPhoto = src;
      if (src) { pic.style.display = 'block'; pic.src = src; }
      else { pic.removeAttribute('src'); pic.style.display = 'none'; }
    }
    // THE FADE: the theme's own ground washed over the photo (Sky /
    // Background -> Fade, 0-100): Light's limestone, Dark's near-black. A
    // fixed flat layer -- no sampled color, no brightness filter.
    mounted.lastChild.style.background = src && pic.getAttribute('src') ? (C && C.flatFade ? C.flatFade(bg.fade, policy.theme) : 'transparent') : 'transparent';
    // THE TINT over the photo (the page's accent, or the user's own: Sky /
    // Background -> Tint), its strength and brightness
    var tint = bg.tint === 'accent' ? (C && C.flatAccentHex ? C.flatAccentHex() : null) : /^#[0-9a-f]{6}$/i.test(bg.tint || '') ? bg.tint : null;
    var tl = mounted.children[1], ll = mounted.children[2];
    if (tl && ll && tl !== mounted.lastChild) {
      var on = !!(tint && src && pic.getAttribute('src'));
      var k = Math.max(0, Math.min(100, bg.tintAmount == null ? 60 : +bg.tintAmount || 0)) / 100;
      var lb = Math.max(-1, Math.min(1, ((bg.tintLight == null ? 50 : +bg.tintLight) - 50) / 50));
      tl.style.display = on && k ? 'block' : 'none';
      if (on) { tl.style.background = tint; tl.style.opacity = String(k); }
      ll.style.display = on && lb ? 'block' : 'none';
      if (on && lb) ll.style.background = lb > 0 ? 'rgba(255,255,255,' + (lb * 0.6).toFixed(3) + ')' : 'rgba(0,0,0,' + (-lb * 0.6).toFixed(3) + ')';
    }
    var imageLook = bg.imageLook;
    if (imageLook && imageLook.mode !== 'legacy' && src && pic.getAttribute('src')) {
      tl.style.display = 'none'; ll.style.display = 'none';
      mounted.lastChild.style.background = window.hkFlatImage ? window.hkFlatImage.fade(imageLook.fade, policy.theme) : 'transparent';
      if (window.hkFlatImage) renderFlatImage(mounted, pic, imageLook, imageLook.color === 'accent' ? (C && C.flatAccentHex ? C.flatAccentHex() : '#64798e') : imageLook.color);
    } else {
      mounted._hkImageRequest = null; pic.onload = null;
      if (mounted._hkImageCanvas) mounted._hkImageCanvas.style.display = 'none';
      if (src && pic.getAttribute('src')) pic.style.display = 'block';
    }
    if (opts.sleep) sleepEntity = opts.sleep;
    var sl = sleepEntity && client.states[sleepEntity]; if (sl) asleep = sl.state === 'on';
    // never hidden while the tab is: a still picture costs nothing there, and
    // an inline hide stayed until the next tick -- the view's navy, then the
    // photo, each time the tab came back (2026-10-16)
    applyHidden();
  }

  // Not a dashboard at all (Settings, Logs, the Map): nothing to resolve, so
  // no walk -- and no sky left behind from the dashboard before.
  function offPanel() {
    var HS = window.hkSettings;
    return !!(HS && HS.lovelacePanel && HS.lovelacePanel() === false);
  }

  function selfRender() {
    if (offPanel()) {
      if (mounted && !mounted.isConnected) teardown();
      return;
    }
    var want = resolve();
    if (want === null) {                          // not opted in: stay out --
      // -- but a sky left behind by a page that HAD one (Settings after a
      // dashboard) is torn down, not kept alive detached.
      if (mounted && !mounted.isConnected) teardown();
      return;
    }
    if (want === false) { if (mounted) teardown(); return; }
    var client = clientNow();
    if (!client) return;
    // hui-view-container satisfies container()'s very first test, so it is its
    // own anchor and no card is needed.
    var host = viewContainerEl();
    if (!host) return;
    window.hkSky.render(client, host, want);
  }

  // Three navigation signals, all proven on wall tablets: location-changed
  // is what HA's own navigate()
  // fires, popstate catches the hardware back button and Fully's navigation,
  // and the poll catches anything that changes the URL without either.
  //
  // The poll doubles as the state tick. It is deliberately NOT a websocket
  // subscription: the sky's inputs are sun, weather, moon and two booleans,
  // and re-reading five states every few seconds is cheaper than managing a
  // subscription's lifecycle across view changes. It also catches a
  // screensaver flip within a tick, where watching sun.sun alone would leave
  // the sky running until the next elevation change.
  // REPAINT WHEN THE NEW VIEW IS ON SCREEN, NOT WHEN THE URL CHANGES.
  //
  // location-changed fires the instant a navigation starts, well before HA has
  // built the incoming view. Repainting there puts the NEW page's background
  // behind the OLD page's content for a beat -- tap Climate and its palette
  // arrives while the previous page is still up. Reading the config is faster
  // than building the view, so the module has to wait for the view on
  // purpose.
  //
  // SO THE VIEW TELLS US. A generated screen's view is `custom:hk-grid-view`, which is
  // our own element, and it announces `hk-view-ready` on window the moment it
  // is attached with its cards in it -- a first build and a return to a cached
  // view alike (cards/hk-layout.js). That is exactly "the new page is up", so
  // the repaint lands in the same frame as the view, however long the build
  // took. No polling, no ceiling, nothing to race.
  //
  // POLLING every 60ms for hui-view to be replaced, with a ~2s ceiling after
  // which it repaints anyway, is wrong at both ends on a slow tablet: a first
  // build past the ceiling gets its palette early, behind the previous page,
  // and every probe walks the whole shadow DOM.
  //
  // The poll is KEPT for a view of any other type, which cannot announce
  // itself, so a stock masonry view added to a sky dashboard degrades to
  // polling rather than never repainting.
  function viewEl() { return SH.tags.view ? deepFind(SH.tags.view.toUpperCase()) : null; }

  var ANNOUNCING = 'custom:hk-grid-view';
  var navWait = null;
  function onNav() {
    if (navWait) { clearInterval(navWait); navWait = null; }
    if (offPanel()) { selfRender(); return; }      // tears a stale sky down; no poll
    var v = currentView(lovelaceCfg());
    if (v && v.type === ANNOUNCING) {           // hk-view-ready will come
      // A hash change (a pop-up) is not a page change and announces nothing.
      if (location.pathname !== mountedPath) navPending = Date.now();
      return;
    }
    var before = viewEl();
    var tries = 0;
    navWait = setInterval(function () {
      var now = viewEl();
      // a different element, with content in it, is the new page being up
      var swapped = now && now !== before && now.children.length > 0;
      if (swapped || ++tries > 33) {           // ~2s ceiling, then repaint anyway
        clearInterval(navWait); navWait = null;
        selfRender();
      }
    }, 60);
  }

  // IN THE FRAME THE PAGE IS FIRST DRAWN IN, AT ITS START. hk-view-ready is
  // said from inside Home Assistant's page build, with the page's cards
  // still drawing: painting then measured (laid out) the half-built page,
  // and the frame laid it out again -- ~60 ms of each page change at 6x
  // (headless), most of the sky's share. At the frame's start the build is
  // done, the paint's measuring IS the frame's layout, and the new palette
  // is still in the same frame as the page.
  var readyFrame = 0;
  function onViewReady() {
    if (navWait) { clearInterval(navWait); navWait = null; }
    if (readyFrame) return;
    readyFrame = requestAnimationFrame(function () {
      readyFrame = 0;
      navPending = 0;
      selfRender();
    });
  }

  // THE 3s STATE TICK MUST NOT JUMP A NAVIGATION. Between location-changed and
  // hk-view-ready the URL already names the new page while the old one is
  // still on screen; a tick landing there would paint the new palette behind
  // the old content -- the very artifact the event exists to prevent. So the
  // tick stands aside while a page change is pending. The 10s cap only matters
  // if an announcement is ever lost, and then it recovers instead of freezing.
  var navPending = 0;
  function stateTick() {
    if (navPending && Date.now() - navPending < 10000) return;
    navPending = 0;
    selfRender();
  }

  // THE FIRST MOUNT NEEDS ITS OWN RAMP, or a cold load shows THREE SECONDS of
  // bare background. MEASURED on a wall tablet's dashboard: the module is
  // live at 5ms, hui-root at 162ms and the view has its cards at 180ms -- but
  // without a ramp the sky appears at 3012ms.
  //
  // The reason is that selfDrive()'s single immediate selfRender() runs at
  // ~5ms, when there is no client and no HUI-VIEW-CONTAINER yet, so it bails --
  // and the next attempt would be the 3000ms backstop tick. Nothing is slow;
  // the retry is just too far away.
  //
  // `location-changed` does not cover this: no navigation has happened on a
  // cold load, so onNav never fires.
  //
  // So: poll every 60ms until the sky actually mounts, with a ceiling. The
  // 3000ms interval stays -- it is the backstop for a URL
  // that changes with no event, and for the state tick.
  var firstWait = null;
  function firstMount() {
    if (firstWait) return;
    var tries = 0;
    firstWait = setInterval(function () {
      selfRender();
      // `mounted` is the honest test. A view that does not want a sky never
      // sets it, so the ceiling is what stops the ramp there -- 60ms x 100 is
      // 6s of two cheap DOM lookups, against a cold start that reaches the
      // view in under 200ms.
      if (mounted || ++tries > 100) {
        clearInterval(firstWait);
        firstWait = null;
      }
    }, 60);
  }

  var selfPoll = null;
  function selfDrive() {
    if (selfPoll) return;
    selfPoll = setInterval(stateTick, 3000);
    SH.onNavigate(onNav);
    window.addEventListener('popstate', onNav);
    window.addEventListener('hk-view-ready', onViewReady);
    // A settings change: a dashboard's Live sky may have been switched.
    if (window.hkSettings && window.hkSettings.onChange) {
      window.hkSettings.onChange(function () { selfRender(); });
    }
    selfRender();
    if (!mounted) firstMount();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', selfDrive);
  } else {
    selfDrive();
  }

  // Console helper: hkSkyAt(-3) previews dusk without waiting for it, and
  // returns the composited luminance so CAP can be checked at any hour.
  window.hkSkyAt = function (elev, opts) {
    if (!mounted) return 'not mounted';
    var s = Object.assign({ elev: elev, azim: 250, cover: 0.3, wind: 6,
                            cond: 'partlycloudy', fog: false,
                            wet: { kind: 'none', rate: 0 }, moon: 0.5,
                            animations: true, decorations: true, backdrop: null },
                          opts || {});
    paint(mounted, s);
    return 'raw ' + mounted._hkRaw + ' -> capped ' + mounted._hkL;
  };
})();
