// hk-sky-builders.js - the season builders (leaves, bats, canopy, fog, the witch, the window) and the schedule.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-builders'] = function (K) {
    var BASE = K.BASE, BAT_FRAMES = K.BAT_FRAMES, BULBS = K.BULBS, clamp = K.clamp, FRAME_ASPECT = K.FRAME_ASPECT,
        LEAF_SPECIES = K.LEAF_SPECIES, lvCount = K.lvCount, lvCycleOn = K.lvCycleOn, lvOf = K.lvOf,
        lvRange = K.lvRange, lvThin = K.lvThin, MOON_DISC = K.MOON_DISC, NARROW_HALF = K.NARROW_HALF,
        NARROW_SOLID = K.NARROW_SOLID, SNOW_SPRITES = K.SNOW_SPRITES, SP_ASSET = K.SP_ASSET,
        WITCH_CYCLE = K.WITCH_CYCLE, WITCH_INK = K.WITCH_INK, WITCH_LINE = K.WITCH_LINE, WITCH_SPAN = K.WITCH_SPAN;

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

    // what the shell and the later parts use of this one
    K.batField = batField; K.birthdays = birthdays; K.branchLayer = branchLayer; K.canopyLayer = canopyLayer;
    K.cobweb = cobweb; K.cozyWindow = cozyWindow; K.dayKey = dayKey; K.daysUntil = daysUntil; K.fogWisps = fogWisps;
    K.leafField = leafField; K.roll = roll; K.SCHEDULE = SCHEDULE; K.SPOOKY = SPOOKY; K.SURPRISE = SURPRISE;
    K.surpriseScene = surpriseScene; K.windowOf = windowOf; K.witchFly = witchFly; K.witchPath = witchPath;
  };
})();
