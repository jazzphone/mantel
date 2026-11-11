// hk-sky-surprises-more.js - the near scenery, and painting and landing a season.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-surprises-more'] = function (K) {
    var attachStyles = K.attachStyles, batField = K.batField, branchLayer = K.branchLayer,
        canopyLayer = K.canopyLayer, clamp = K.clamp, cobweb = K.cobweb, cozyWindow = K.cozyWindow, dayKey = K.dayKey,
        fogWisps = K.fogWisps, INSTALLED = K.INSTALLED, LAND_MONTH = K.LAND_MONTH, LAND_SOUTH = K.LAND_SOUTH,
        leafField = K.leafField, lvOf = K.lvOf, MOON_PX = K.MOON_PX, NEAR_ART = K.NEAR_ART,
        NEAR_BALLOONS = K.NEAR_BALLOONS, NEAR_GROUND = K.NEAR_GROUND, NEAR_LAMPS = K.NEAR_LAMPS,
        NEAR_LIGHT = K.NEAR_LIGHT, NEAR_PATCHES = K.NEAR_PATCHES, NEAR_POOLS = K.NEAR_POOLS,
        NEAR_TREE_MASKS = K.NEAR_TREE_MASKS, nearFlat = K.nearFlat, nearThemeOf = K.nearThemeOf,
        nearTouches = K.nearTouches, plannedFor = K.plannedFor, PREVIEW_SEASONS = K.PREVIEW_SEASONS, rng = K.rng,
        SEASON = K.SEASON, SH = K.SH, skyQA = K.skyQA, SP_PART = K.SP_PART, ST = K.ST, SURPRISE = K.SURPRISE,
        surpriseFor = K.surpriseFor, surpriseScene = K.surpriseScene, VER = K.VER, windBucket = K.windBucket,
        witchFly = K.witchFly;

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
      if (ST.SURPRISE_FORCE) surprise = ST.SURPRISE_FORCE;
      // previewing a season: today's own surprise (a birthday) must not replace it
      if (ST.PREVIEW && PREVIEW_SEASONS[ST.PREVIEW.id]) surprise = '';
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

    // what the shell and the later parts use of this one
    K.build = build; K.landFile = landFile; K.landLight = landLight; K.landSeason = landSeason;
    K.layersHtml = layersHtml; K.paintSeason = paintSeason; K.routeOf = routeOf;
  };
})();
