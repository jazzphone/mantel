// hk-sky-surprises.js - the surprises and the planner: which shows when, and the previews.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-surprises'] = function (K) {
    var auroraCanvas = K.auroraCanvas, auroraDraw = K.auroraDraw, BAT_FRAMES = K.BAT_FRAMES, birthdays = K.birthdays,
        clamp = K.clamp, detachStyles = K.detachStyles, frontSync = K.frontSync, LEAF_SPECIES = K.LEAF_SPECIES,
        lvCount = K.lvCount, lvCycleOn = K.lvCycleOn, lvRange = K.lvRange, lvThin = K.lvThin, MOON_DISC = K.MOON_DISC,
        rng = K.rng, roll = K.roll, SCHEDULE = K.SCHEDULE, SH = K.SH, SPOOKY = K.SPOOKY, ST = K.ST,
        windowOf = K.windowOf, witchFly = K.witchFly;

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
    // Particle mean alpha / ink luma, for the estimate. Sparkle and confetti are
    // drawn in CSS and carry no texture.
    var SP_PART = {
      petal:   { a: 0.286, l: 180 },
      heart:   { a: 0.445, l: 173 },
      crystal: { a: 0.290, l: 198 },
      sparkle: { a: 0.600, l: 244 },   // a CSS dot: small, bright, opaque
      confetti:{ a: 1.000, l: 200 }    // a CSS rectangle
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
    function plannedFor(name, d) { return ST.FORCE || schedule(name, d); }
    var PREVIEW_SEASONS = { halloween: 1, thanksgiving: 1, christmas: 1 };
    function preview(id, when) {
      ST.FORCE = null; ST.PIN = null; ST.SURPRISE_FORCE = null; ST.PREVIEW = null;
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
          ST.FORCE = { season: id, show: true, spooky: when === 'spooky', days: 0, p: 1 };
          sky.season = id;
        } else {
          ST.SURPRISE_FORCE = id;
          sky.season = '';
        }
        ST.PIN = sky;
        ST.PREVIEW = { id: id, when: when || 'day' };
      }
      try { stateTick(); } catch (e) { /* not mounted yet: the next tick paints it */ }
      return ST.PREVIEW;
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
    // The season of the LAND (not the holiday seasons of seasonOf): by the
    // month, flipped south of the equator; snow falling makes it winter.
    var LAND_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
                      'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
    var LAND_SOUTH = { winter: 'summer', summer: 'winter', spring: 'fall', fall: 'spring' };

    function teardown() {
      if (!ST.mounted) return;
      // the front layer (Moving Things: In Front) is the sky's sibling and is
      // styled by the sky's sheet: it goes first, or it is left in the page
      // unstyled, and a sky mounted again builds a second one beside it
      frontSync(ST.mounted, false);
      if (ST.mounted._hkNear) ST.mounted._hkNear.dispose();
      detachStyles(ST.mounted);
      ST.mounted.remove();
      ST.mounted = null;
      ST.mountedPath = null;
      ST.mountedVariant = null;
    }

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

    function currentView(cfg, path) {
      if (!cfg || !cfg.views) return null;
      // /<dashboard>/<view>  -- the view segment is either a path or an index
      // (`path`: another page's address, a swipe's -- swipeCover)
      var seg = decodeURIComponent((String(path || location.pathname).split('/')[2] || '').split(/[?#]/)[0]);
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
    function resolve(path) {
      var cfg = lovelaceCfg();
      if (!cfg) return null;
      var flat = !!(window.hkSettings && window.hkSettings.rendering && window.hkSettings.rendering().flat);
      if (!cfg.sky && !flat) return null;
      // A dashboard whose item turns its Live sky off: opted in by its
      // YAML, but no sky on any of its views.
      var M = window.hkCards && window.hkCards.menu;
      if (!flat && M && typeof M.board === 'function' && M.board().sky === false) return false;
      var v = currentView(cfg, path);
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
      var still = null, photo = null, look = null, wall = null;
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
        // 'wallpaper' (2026-10-30): the screen's Wallpaper
        else if (mode === 'wallpaper') {
          wall = typeof HS.wallpaper === 'function' ? HS.wallpaper() : null;
          still = wall ? wall.stops : black;
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
        // a Wallpaper (2026-10-30): its art over its own stops
        else if (bg && bg.mode === 'wallpaper') { wall = bg.wallpaper; still = bg.stops || black; }
        else if (bg && bg.mode === 'photo') { photo = bg.photo || null; look = bg.look || null; if (!photo) still = bg.stops || black; }
      }
      return { variant: variant, backdrop: backdrop, still: still, photo: photo, look: look, wall: wall, page: v.sky_page || null,
               enable: cfg.sky && cfg.sky.enable || null,
               sleep: cfg.sky && cfg.sky.sleep || null };
    }

    // Not a dashboard at all (Settings, Logs, the Map): nothing to resolve, so
    // no walk -- and no sky left behind from the dashboard before.
    function offPanel() {
      var HS = window.hkSettings;
      return !!(HS && HS.lovelacePanel && HS.lovelacePanel() === false);
    }
    function swiping() {
      if (!ST.SWIPE) return undefined;
      var here = String(location.pathname).split('/')[2] || '';
      if (Date.now() > ST.SWIPE.until || here === ST.SWIPE.seg) { ST.SWIPE = null; return undefined; }
      return ST.SWIPE.path;
    }

    function selfRender() {
      if (offPanel()) {
        if (ST.mounted && !ST.mounted.isConnected) teardown();
        return;
      }
      var want = resolve(swiping());
      if (want === null) {                          // not opted in: stay out --
        // -- but a sky left behind by a page that HAD one (Settings after a
        // dashboard) is torn down, not kept alive detached.
        if (ST.mounted && !ST.mounted.isConnected) teardown();
        return;
      }
      if (want === false) { if (ST.mounted) teardown(); return; }
      var client = clientNow();
      if (!client) return;
      // hui-view-container satisfies container()'s very first test, so it is its
      // own anchor and no card is needed.
      var host = viewContainerEl();
      if (!host) return;
      window.hkSky.render(client, host, want);
    }
    function stateTick() {
      if (ST.navPending && Date.now() - ST.navPending < 10000) return;
      ST.navPending = 0;
      selfRender();
    }

    // what the shell and the later parts use of this one
    K.clientNow = clientNow; K.currentView = currentView; K.deepFind = deepFind; K.INSTALLED = INSTALLED;
    K.LAND_MONTH = LAND_MONTH; K.LAND_SOUTH = LAND_SOUTH; K.lovelaceCfg = lovelaceCfg;
    K.NEAR_BALLOONS = NEAR_BALLOONS; K.NEAR_GROUND = NEAR_GROUND; K.NEAR_LAMPS = NEAR_LAMPS;
    K.NEAR_LIGHT = NEAR_LIGHT; K.NEAR_PATCHES = NEAR_PATCHES; K.NEAR_POOLS = NEAR_POOLS;
    K.NEAR_TREE_MASKS = NEAR_TREE_MASKS; K.nearFlat = nearFlat; K.nearThemeOf = nearThemeOf;
    K.nearTouches = nearTouches; K.offPanel = offPanel; K.plannedFor = plannedFor; K.preview = preview;
    K.PREVIEW_SEASONS = PREVIEW_SEASONS; K.resolve = resolve; K.schedule = schedule; K.selfRender = selfRender;
    K.SP_PART = SP_PART; K.stateTick = stateTick; K.surpriseFor = surpriseFor; K.swiping = swiping;
    K.teardown = teardown; K.viewContainerEl = viewContainerEl; K.windBucket = windBucket;
  };
})();
