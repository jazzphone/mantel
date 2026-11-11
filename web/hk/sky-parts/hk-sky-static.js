// hk-sky-static.js - static skies, the album backdrop and a photo of your own.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-static'] = function (K) {
    var applyScrim = K.applyScrim, luma = K.luma, skyQ = K.skyQ, ST = K.ST;

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
      calendar:  ['#0e1a18', '#18302b', '#284a42', '#4f7a6c'],
      timeline:  ['#1a120c', '#36241a', '#684330', '#9c6e52']  // its tile's orange, softer than Timers' (2026-11-05)
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

    // A WALLPAPER (2026-10-30, hk-wallpapers.js): our own art, a still the
    // browser paints once at the screen's size (a background picture, no live
    // filter, nothing per frame) over the stops it publishes as the sky's
    // (paintStatic). Two layers, made the first time one is shown, over the
    // album's and under the grain and the scrim as a photo is: the night
    // version crossfades in at sunset as the stops do. `wall`: {id} or null
    // (none here: the layers fade out and let their pictures go).
    var WALL_FADE_MS = 4500;
    // its Motion, while the sky's Animations are on
    function wallMotion(el, wall) {
      var HS = window.hkSettings, look = HS && HS.skyLook ? HS.skyLook() : null, W = window.hkWallpapers;
      var m = wall && wall.motion && wall.motion !== 'off' && !(look && look.animations === false) ? wall.motion : null;
      if (!el.setAttribute) return;
      // (data-ws: the art's shape, or 'theme' -- an old id its art: W.resolve)
      var shape = !m ? null : W && W.isTheme(wall.id) ? 'theme' : W ? W.resolve(wall.id).id : 'ribbons';
      if (m) { el.setAttribute('data-wm', m); el.setAttribute('data-ws', shape); }
      else { el.removeAttribute('data-wm'); el.removeAttribute('data-ws'); }
    }
    // A MOTION THEME (2026-10-31, hk-wallpapers.js scene()): its ground is the
    // layer's picture, as a drawn wallpaper's is, and its own layers go inside
    // it, each an <i> with its picture and how it moves (the .wall.th rules:
    // they move only while the Motion is on, else they stand where they start
    // -- the still frame). Made again only when the theme, its colour or its
    // version changes; a drawn wallpaper's layer has none.
    function wallScene(layer, sc) {
      layer.classList.toggle('th', !!sc);
      var W = window.hkWallpapers;
      if (W && W.paintScene) W.paintScene(layer, sc, 'hk-wt-');
    }
    function paintWall(el, wall, night) {
      var W = window.hkWallpapers, layers = el.querySelectorAll ? el.querySelectorAll('.wall') : [];
      var sc = wall && W && W.scene ? W.scene(wall.id, night, wall.color) : null;
      // (an art in its colour too, 2026-11-01: item 45)
      var src = wall && W ? (sc ? sc.key : W.url(wall.id, night, wall.color)) : null;
      var rw = wall && W ? W.resolve(wall.id, wall.color) : null;
      wallMotion(el, src ? wall : null);
      if (el._hkWall === src || (!src && !layers.length)) { el._hkWall = src; return; }
      el._hkWall = src;
      el.style.setProperty('--wall', src ? '"' + rw.id + '@' + rw.hex + (night ? ':night' : ':day') + '"' : 'none');
      if (src && layers.length < 2) {
        var art = el.querySelector('.art');
        for (var i = layers.length; i < 2; i++) {
          var d = document.createElement('div');
          d.className = 'wall';
          art.parentNode.insertBefore(d, art.nextSibling);
        }
        layers = el.querySelectorAll('.wall');
      }
      var shown = null;
      for (var j = 0; j < layers.length; j++) if (layers[j].classList.contains('on')) shown = layers[j];
      if (src) {
        var next = layers[0] === shown ? layers[1] : layers[0];
        next.style.backgroundImage = 'url("' + (sc ? sc.ground : src) + '")';
        wallScene(next, sc);
        next.classList.add('on');
        el.style.setProperty('--grainO', '0');
      }
      if (shown) shown.classList.remove('on');
      // the picture faded out is let go once it is gone (a theme's layers too)
      clearTimeout(el._hkWallT);
      el._hkWallT = setTimeout(function () {
        for (var k = 0; k < layers.length; k++) {
          if (!layers[k].classList.contains('on')) { layers[k].style.backgroundImage = ''; wallScene(layers[k], null); }
        }
      }, WALL_FADE_MS);
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
    var artLuma = {};              // url -> mean luma 0-255, measured once

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
        if (el === ST.mounted) announce();
      });
    }

    // THE IMAGE LOOK (2026-10-24, the owner: Flat's treatment for the Glass
    // looks' Photo and Landscapes too; hkSettings.photoLook's `image`): the
    // picture repainted once by hk-flat-image.js -- tinted or as taken, its
    // brightness, and its Fade baked in toward the dark ground -- and handed
    // on as a picture of its own (a blob address), so whatever reads the photo
    // (the cap, a pre-rendered blur) reads the treated one. Kept for the last
    // few pictures; a picture still being painted shows nothing new until it
    // is done, never the untreated one first.
    var TREATED = [], TREATED_MAX = 3;
    function treatedPhoto(src, image, color, done) {
      var key = src + '|' + [image.mode, image.strength, image.depth, image.brightness, image.fade, color].join('|');
      var hit = TREATED.filter(function (t) { return t.key === key; })[0];
      if (hit) { if (hit.url) return hit.url; hit.wait.push(done); return null; }
      var job = { key: key, url: null, wait: [done] };
      TREATED.push(job);
      while (TREATED.length > TREATED_MAX) {
        var old = TREATED.shift();
        // (later: a layer may still be showing it while the next one lands)
        if (old.url) setTimeout(URL.revokeObjectURL.bind(URL, old.url), 10000);
      }
      var settle = function (url) { job.url = url; var w = job.wait; job.wait = []; w.forEach(function (fn) { fn(url); }); };
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas');
          if (!window.hkFlatImage.paint(cv, img, image, color)) throw new Error('no size');
          var ctx = cv.getContext('2d');
          ctx.fillStyle = window.hkFlatImage.fade(image.fade, 'dark');
          ctx.fillRect(0, 0, cv.width, cv.height);
          cv.toBlob(function (blob) { settle(blob ? URL.createObjectURL(blob) : src); }, 'image/jpeg', 0.92);
        } catch (e) { console.warn('[hk-sky] the photo could not be treated', e); settle(src); }
      };
      img.onerror = function () { settle(src); };
      img.src = src;
      return null;
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
        if (el === ST.mounted) announce();
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
        if (el === ST.mounted) announce();
      });
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
      // (and the season's field, built inside .season with no class to say so: Decorations off kept the decorated picture
      // until the next timed repaint, 2026-10-13; and a wallpaper's Motion and speed, data-wm / data-ws, 2026-11-07)
      return { big: String(el.className).replace(SKY_STATES, ' ').replace(/\s+/g, ' ').trim() + '|' + cloudsSig(el) +
                    '|' + (el.style.getPropertyValue('--art') || '') + '|' + seasonSig(el) +
                    '|' + (el.getAttribute('data-wm') || '') + ':' + (el.getAttribute('data-ws') || ''),
               small: el.getAttribute('style') || '' };
    }
    // THE SKY CHANGED (skySig, or the page): said once per change, not on every render -- Tint from Background follows
    // its colors (hk-frosttint.js), a pre-rendered blur its picture (hk-glass.js). Said after every render, and as a new
    // song's cover lands on the Play Music page (paintAlbum: no render follows a track change, and the pills kept the
    // last song's blur until their own refresh, 2026-10-10). ...ONCE IT HAS SETTLED. A change fades in -- the album
    // wash's opacity (1.2 s), the scrim (4 s), the light -- and a picture taken at its start kept the fade's first frame,
    // with nothing to say so later: the signature already read as the end. So a change is said when the sky's transitions
    // have finished (the browser's own list of them; the loops that drift and fall are animations, not transitions, and
    // never wait), at most SETTLE_MS on.
    //
    // ...AND AT ONCE, as hk-sky-change, for what can paint the end of a fade before it is reached: a pre-rendered blur
    // (hk-glass.js) paints the sky as it will be (hk-skyshot.js, opts.settle) and fades in with it -- the pills changed
    // only once the song's wash had finished, then faded for 2.5 s more (2026-10-11). Said once per change; what reads
    // colors as they are now (Tint from Background) keeps waiting for hk-sky-paint. What is fading is asked once the
    // frame is drawn: asked as the sky painted, it worked out the sky's styles there and then, 15-20 ms of a slowed
    // tablet's page swipe as it began and as it landed (2026-11-07)
    var SETTLE_MS = 6000;
    function announce() {
      if (!ST.mounted) return;
      var sg = skySig(ST.mounted), psig = sg.big + '||' + sg.small + '|' + location.pathname;
      if (psig === ST.paintSig) return;
      if (psig !== ST.changeSig) {
        ST.changeSig = psig; ST.changedSig = sg; ST.changedFor = ST.mounted;
        try { window.dispatchEvent(new Event('hk-sky-change')); } catch (e) { /* no window events */ }
      }
      if (ST.asked) return;
      var go = function () { if (ST.asked !== true) return; ST.asked = 1; setTimeout(function () { ST.asked = false; settle(); }, 0); };
      ST.asked = true; requestAnimationFrame(go); setTimeout(go, 100);          // (a hidden window draws no frames)
    }
    function settle() {
      var sg = ST.mounted && skySig(ST.mounted), psig = sg && sg.big + '||' + sg.small + '|' + location.pathname;
      if (!sg || psig === ST.paintSig) return;
      var fading = [];
      try {
        if (ST.mounted.getAnimations && typeof CSSTransition !== 'undefined') {
          fading = ST.mounted.getAnimations({ subtree: true }).filter(function (an) {
            return an instanceof CSSTransition && an.playState === 'running';
          });
        }
      } catch (e) { fading = []; }
      if (fading.length) {
        var gen = ++ST.settleGen;
        Promise.race([
          Promise.all(fading.map(function (an) { return an.finished.catch(function () { /* cancelled: settled */ }); })),
          new Promise(function (ok) { setTimeout(ok, SETTLE_MS); })
        ]).then(function () { if (gen === ST.settleGen) announce(); });
        return;
      }
      ST.settleGen++;
      ST.paintSig = psig;
      ST.saidSig = sg; ST.saidFor = ST.mounted;
      try { window.dispatchEvent(new Event('hk-sky-paint')); } catch (e) { /* no window events */ }
    }

    // what the shell and the later parts use of this one
    K.announce = announce; K.paintAlbum = paintAlbum; K.paintPhoto = paintPhoto; K.paintStatic = paintStatic;
    K.paintWall = paintWall; K.PHOTO_UNDER = PHOTO_UNDER; K.skySig = skySig; K.STATIC = STATIC;
    K.sunKelvin = sunKelvin; K.tintStops = tintStops; K.treatedPhoto = treatedPhoto;
  };
})();
