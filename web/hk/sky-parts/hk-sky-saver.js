// hk-sky-saver.js - the screensaver's own life: holidays, meteors, fireflies, fireworks and the realistic clouds.
//
// PART OF THE LIVE SKY (hk-sky.js). Not a card and not run on its own: it registers one
// function, which hk-sky.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSkyParts = window.hkSkyParts || {})['hk-sky-saver'] = function (K) {
    var BASE = K.BASE, BRIGHT_CAP = K.BRIGHT_CAP, CAP = K.CAP, clamp = K.clamp, CLOUD = K.CLOUD,
        CLOUD_ALPHA = K.CLOUD_ALPHA, DAY_BRIGHT = K.DAY_BRIGHT, dayKey = K.dayKey, frontSync = K.frontSync,
        IDLE_BELOW = K.IDLE_BELOW, IDLE_INVISIBLE = K.IDLE_INVISIBLE, landFile = K.landFile, landLight = K.landLight,
        landSeason = K.landSeason, layersHtml = K.layersHtml, luma = K.luma, lvCount = K.lvCount,
        lvCycleOn = K.lvCycleOn, lvOf = K.lvOf, lvRange = K.lvRange, lvThin = K.lvThin, mixAny = K.mixAny,
        MOON_IMG = K.MOON_IMG, MOON_PX = K.MOON_PX, moonSvg = K.moonSvg, nearThemeOf = K.nearThemeOf, num = K.num,
        OWN_CSS = K.OWN_CSS, paintSeason = K.paintSeason, ramp = K.ramp, read = K.read, rng = K.rng,
        routeOf = K.routeOf, selfRender = K.selfRender, SKY = K.SKY, SKY_BRIGHT = K.SKY_BRIGHT, skyQ = K.skyQ,
        ST = K.ST, VER = K.VER, XMAS_MOON = K.XMAS_MOON;

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
    var holWait = [];
    function holData(cb) {
      if (ST.HOL) return ST.HOL;
      if (cb) holWait.push(cb);
      if (ST.holAsked) return null;
      ST.holAsked = true;
      var done = function (j) {
        ST.HOL = j || {};
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
      var list = ST.HOL && ST.HOL.lights && ST.HOL.lights[lit.file];
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
      var list = ST.HOL && ST.HOL.balloons;
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
      var p = ST.HOL && ST.HOL.props;
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
          own.replaceSync(ST.SHEET + OWN_CSS);
          root.adoptedStyleSheets = root.adoptedStyleSheets.concat(own);
        }
      } catch (e) { own = null; }
      if (!own) {
        tag = document.createElement('style');
        tag.textContent = ST.SHEET + OWN_CSS;
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
        part('hx', day + '|' + (lightsUp ? lit.file : '') + '|' + (ST.HOL ? 1 : 0), function () {
          hx.textContent = '';
          if (lightsUp) holidayGlints(hx, lit, rng(day * 13 + 5));
        });

        var bday = h.surprise === 'birthday';
        part('bx', day + '|' + (bday ? 'b' : '-') + '|' + (ST.HOL ? 1 : 0) + '|' + light, function () {
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
          var s = read(client, opts && opts.entity);
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
    function rcManifest() {
      if (ST.RC_MAN || ST.RC_LOADING) return ST.RC_MAN;
      if (ST.RC_FAILED && Date.now() < ST.RC_RETRY) return null;
      if (typeof fetch !== 'function') { ST.RC_FAILED = true; ST.RC_RETRY = Infinity; return null; }
      ST.RC_LOADING = true;
      fetch(RC_BASE + 'manifest.json' + VER).then(function (r) {
        if (!r.ok) throw Error(r.status);
        return r.json();
      }).then(function (m) { ST.RC_MAN = m; ST.RC_FAILED = false; ST.RC_LOADING = false; selfRender(); },
              function () {
                ST.RC_FAILED = true; ST.RC_LOADING = false; ST.RC_TRIES++;
                ST.RC_RETRY = Date.now() + (ST.RC_TRIES === 1 ? 60000 : 300000);
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
      var list = ST.RC_MAN.clouds.filter(function (c) { return c.set === art; });
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
        var decks = ST.RC_MAN.clouds.filter(function (c) { return c.set === 'overcast-deck'; });
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
                   (rcManifest(), !ST.RC_FAILED);
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

    // what the shell and the later parts use of this one
    K.applyScrim = applyScrim; K.CEIL_FADE = CEIL_FADE; K.ceilCanvases = ceilCanvases; K.ceilDraw = ceilDraw;
    K.ceilRelight = ceilRelight; K.holidayLand = holidayLand; K.holidayLights = holidayLights; K.paint = paint;
    K.paintRealClouds = paintRealClouds; K.rcLight = rcLight; K.rcPlan = rcPlan; K.rcTidy = rcTidy; K.scene = scene;
  };
})();
