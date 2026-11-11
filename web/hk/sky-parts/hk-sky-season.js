// hk-sky-season.js - the seasons, the palette, color, conditions, the moon and the pictures the sky draws with.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-season'] = function (K) {
    var ST = K.ST;

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

    function read(client, weatherEntity) {
      var sun = client.states['sun.sun'];
      // Which weather entity, moon source and seasonal gate: Configure ->
      // Weather and Seasonal sky (hk-settings.js), with generic fallbacks when unset.
      var HS = window.hkSettings;
      var wid = weatherEntity || (HS ? HS.weatherId(client.states) : null);
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
        if (!look.weather && !weatherEntity) {
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
      if (ST.skyPage === 'weather') {
        out.decorations = false;
        out.season = '';
        out.seasonalOn = false;
      }
      if (ST.PIN) for (var k in ST.PIN) if (ST.PIN.hasOwnProperty(k)) out[k] = ST.PIN[k];
      // An explicitly selected weather card describes its own weather,
      // independently of the page's decorative background choice.
      if (weatherEntity) out.backdrop = null;
      return out;
    }

    // CALM WHEN NOBODY'S AROUND: the screen's room is empty -- every
    // occupancy, motion and presence sensor in it off, and for QUIET_MS -- so
    // its scene is thinned (.lv-quiet). A room with none is never quiet; HK
    // Settings offers the switch only where there are some, by the same rule
    // (hk-settings-model.js roomSensors).
    var QUIET_MS = 5 * 60000;
    var QUIET_CLASSES = { occupancy: 1, motion: 1, presence: 1 };
    function roomSensorIds(client, room) {
      if (ST.quietIds.ents === client.entities && ST.quietIds.room === room) return ST.quietIds.ids;
      var ents = client.entities || {}, devs = client.devices || {}, ids = [];
      Object.keys(client.states || {}).forEach(function (id) {
        if (id.indexOf('binary_sensor.') !== 0) return;
        var st = client.states[id], e = ents[id];
        if (!QUIET_CLASSES[st.attributes && st.attributes.device_class] || !e || e.hidden) return;
        var area = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
        if (area === room) ids.push(id);
      });
      ST.quietIds = { ents: client.entities, room: room, ids: ids };
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

    // what the shell and the later parts use of this one
    K.BASE = BASE; K.BAT_FRAMES = BAT_FRAMES; K.BRANCH_IMG = BRANCH_IMG; K.BRIGHT_CAP = BRIGHT_CAP; K.BULBS = BULBS;
    K.CANOPY_IMG = CANOPY_IMG; K.CAP = CAP; K.clamp = clamp; K.CLOUD = CLOUD; K.CLOUD_ALPHA = CLOUD_ALPHA;
    K.DAY_BRIGHT = DAY_BRIGHT; K.FOG_IMG = FOG_IMG; K.FRAME_ASPECT = FRAME_ASPECT; K.IDLE_BELOW = IDLE_BELOW;
    K.IDLE_INVISIBLE = IDLE_INVISIBLE; K.LEAF_SPECIES = LEAF_SPECIES; K.luma = luma; K.mixAny = mixAny;
    K.MOON_DISC = MOON_DISC; K.MOON_IMG = MOON_IMG; K.MOON_PX = MOON_PX; K.moonSvg = moonSvg;
    K.NARROW_HALF = NARROW_HALF; K.NARROW_SOLID = NARROW_SOLID; K.NEAR_ART = NEAR_ART; K.num = num; K.pct = pct;
    K.ramp = ramp; K.read = read; K.rng = rng; K.SEASON = SEASON; K.SH = SH; K.SKY = SKY; K.SKY_BRIGHT = SKY_BRIGHT;
    K.SLEIGH = SLEIGH; K.SNOW_SPRITES = SNOW_SPRITES; K.VER = VER; K.WEB_IMG = WEB_IMG; K.WITCH_CYCLE = WITCH_CYCLE;
    K.WITCH_FADE = WITCH_FADE; K.WITCH_FLIGHT = WITCH_FLIGHT; K.WITCH_IMG = WITCH_IMG; K.WITCH_INK = WITCH_INK;
    K.WITCH_LINE = WITCH_LINE; K.WITCH_SPAN = WITCH_SPAN; K.XDECOR = XDECOR; K.XGLOW = XGLOW; K.XMAS_MOON = XMAS_MOON;
  };
})();
