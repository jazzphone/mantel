// @ts-check
// hk-saver-holiday-fx.js -- THE HOLIDAY SLIDE'S EFFECTS (phase 20, docs/phase20/HOLIDAY-SLIDE.md "The rules for the
// effects"): what moves and glows over a holiday's scene -- the tree's chasing lights and the garland's, snow past the
// living room's window and the sleigh now and then, the haunted house's flickering windows, a figure crossing one, a
// loose shutter, bats leaving the attic, distant lightning, candle flames and steam on the Thanksgiving table, leaves
// past its window, the rooftop's string lights and fireworks -- and outdoors snow piling on the number, leaves and
// petals landing on it, hearts and balloons rising, butterflies, bats and fireworks. The approved mock-up's FX
// (docs/phase20/mockup/holiday-slide.html), on the slide's own canvas.
//
// Loaded only by the slide (hk-saver-holiday.js).
//
// WHAT IT COSTS A WALL TABLET, and the rules it keeps:
//   1. ONE canvas, sized once per layout, its device scale capped at 1.5; no DOM per particle, no backdrop-filter, no
//      compositor animation per particle. A glow is a radial gradient drawn once per color and stamped (glowOf).
//   2. A FIXED BUDGET: at most 90 flakes, 46 window flakes, 16 leaves or hearts, 9 window leaves and 260 sparks; 30
//      frames a second at Full, 20 at Gentle with under half the particles.
//   3. ONLY WHILE IT IS UP: the loop starts as the slide is drawn and stops once its fade out is done (stop()); a
//      hidden page draws nothing. Nothing wakes itself.
//   5. A STILL PICTURE under Effects Off, Reduce Motion, Flat or Sky Animations off: the scene and one frame of its
//      effects, mid-fall (the windows are never empty), and no loop.
//
//   hkHolidayFx.create(canvas, env) -> fx
//     env.sprite(name)  the sky's sprite's address;  env.num()  the outdoor number's element (snow and leaves land on it)
//     fx.size(W, H, q)  the room and the device scale;  fx.reset(kind, level, day, scene, h)  what to draw
//     fx.lights(list, W, H)  an outdoor landscape's bulbs (hk-sky holiday.json);  fx.quiet(zones, foot)
//     fx.start(), fx.stop(), fx.running()
(function () {
  'use strict';
  if (window.hkHolidayFx) return;
  var SPRITES = ['sp-heart.webp', 'sp-petal.webp', 'sp-butterfly.webp', 'leaf-maple-f.webp', 'leaf-oak-f.webp', 'leaf-birch-f.webp',
                 'bat1.webp', 'bat2.webp', 'bat3.webp', 'sleigh.webp'];
  var LEAVES = ['leaf-maple-f.webp', 'leaf-oak-f.webp', 'leaf-birch-f.webp'];

  function create(cv, env) {
    var ctx = cv.getContext('2d'), sw = 1280, sh = 800, q = 1, Z = 1, raf = 0, last = 0, kind = '', level = 'full', isDay = false, h = {};
    var ps = [], sparks = [], rockets = [], perched = [], pile = null, spr = {}, bulbL = null, cross = null, crossT = 0, spiders = [];
    var qz = [], qf = null, scene = null, glow = {}, figT = 0, flash = 0, flashT = 22, fwT = 0, tall = false, lastSig = '';
    function img(n) { if (!spr[n]) { var i = new Image(); i.decoding = 'async'; i.src = env.sprite(n); spr[n] = i; } return spr[n]; }
    function ok(i) { return i && i.complete && i.naturalWidth; }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function mz(m) { return Math.max(Z, m); }
    // the outdoor art's frame (2560 x 1600, covered, its foot at the foot): an art px to the screen's
    function artXY(x, y) { var s = Math.max(sw / 2560, sh / 1600); return [(sw - 2560 * s) / 2 + x * s, sh - 1600 * s + y * s, s]; }

    // THE NUMBER'S TOP EDGE, a column at a time: where snow and leaves come to rest (outdoors)
    function buildMask() {
      pile = null;
      var els = env.num ? env.num() : [];
      if (!els || !els.length) return;
      var c = document.createElement('canvas'); c.width = Math.ceil(sw); c.height = Math.ceil(sh);
      var x = c.getContext('2d', { willReadFrequently: true }), sr = cv.getBoundingClientRect(), k = sr.width / sw || 1;
      x.textBaseline = 'alphabetic'; x.fillStyle = '#000';
      els.forEach(function (el) {
        var cs = getComputedStyle(el), r = el.getBoundingClientRect();
        x.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        var m = x.measureText(el.textContent), a = m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.95, d = m.fontBoundingBoxDescent || parseFloat(cs.fontSize) * 0.25;
        var pb = parseFloat(cs.paddingBottom) || 0, boxH = r.height / k - pb, base = (r.top - sr.top) / k + (boxH - (a + d)) / 2 + a;
        x.fillText(el.textContent, (r.left - sr.left) / k + (parseFloat(cs.paddingLeft) || 0), base);
      });
      var data; try { data = x.getImageData(0, 0, c.width, c.height).data; } catch (e) { return; }
      var W0 = c.width, step = 3, cols = Math.ceil(sw / step), top = new Array(cols), hh = new Array(cols);
      for (var i = 0; i < cols; i++) {
        top[i] = -1; hh[i] = 0;
        var xx = i * step;
        for (var y = Math.floor(sh * 0.1); y < c.height; y++) { if (data[(y * W0 + xx) * 4 + 3] > 120) { top[i] = y; break; } }
      }
      c.width = c.height = 0;
      // only surfaces a flake could sit on: a step this steep is a side, not a top
      var cap = new Array(cols), flat = 3.6;
      for (var j = 0; j < cols; j++) {
        var nx = top[j + 1] === undefined || top[j + 1] < 0 ? top[j] + 99 : top[j + 1], pv = top[j - 1] === undefined || top[j - 1] < 0 ? top[j] + 99 : top[j - 1];
        cap[j] = top[j] >= 0 && Math.abs(nx - top[j]) < flat && Math.abs(pv - top[j]) < flat;
      }
      pile = { step: step, top: top, h: hh, cap: cap, max: 19 * Z };
      if (kind === 'snow') for (var q2 = 0; q2 < cols; q2++) if (cap[q2]) hh[q2] = pile.max * (0.42 + 0.2 * Math.sin(q2 * 0.17) * Math.sin(q2 * 0.05));
    }
    // (the day itself: 35 % busier until midnight)
    function count(full) { var k = level === 'full' ? 1 : level === 'gentle' ? 0.45 : 0.8; return Math.round(full * k * (isDay ? 1.35 : 1)); }
    function seed() {
      ps = []; sparks = []; rockets = []; perched = []; cross = null; crossT = 2.5; spiders = [];
      var i;
      if (kind === 'snow') for (i = 0; i < count(90); i++) ps.push(flake(true));
      if (kind === 'room' && scene && scene.win) for (i = 0; i < count(46); i++) ps.push(winFlake(true));
      if (kind === 'leaves') for (i = 0; i < count(16); i++) ps.push(leaf(true));
      if (kind === 'hearts') for (i = 0; i < count(16); i++) ps.push(heart(true));
      if (kind === 'petals') { for (i = 0; i < count(28); i++) ps.push(petal(true)); for (i = 0; i < count(3); i++) ps.push(butterfly()); }
      if (kind === 'butterflies') for (i = 0; i < count(6); i++) ps.push(butterfly());
      if (kind === 'balloons') { for (i = 0; i < count(9); i++) ps.push(balloon(true)); for (i = 0; i < count(26); i++) ps.push(confetti(true)); }
      if ((kind === 'fireworks' || kind === 'newyear') && h.id === 'newyear') for (i = 0; i < count(kind === 'newyear' ? 18 : 30); i++) ps.push(confetti(true));
      if (kind === 'thanks' && scene && scene.win) for (i = 0; i < count(9); i++) ps.push(winLeaf(true));
      if (kind === 'bats') { for (i = 0; i < count(2); i++) spiders.push({ x: sw * rnd(0.3, 0.92), len: sh * rnd(0.1, 0.3), ph: rnd(0, 6) }); }
    }
    function flake(any) { var d = Math.random(); return { t: 'f', x: rnd(0, sw), y: any ? rnd(-20, sh) : -10, r: (d < 0.55 ? rnd(0.9, 1.5) : d < 0.9 ? rnd(1.6, 2.5) : rnd(2.8, 3.8)) * mz(0.7), v: (d < 0.55 ? rnd(22, 36) : d < 0.9 ? rnd(38, 56) : rnd(60, 80)) * mz(0.7), ph: rnd(0, 6), sw: rnd(0.4, 1.1), a: d < 0.55 ? 0.55 : d < 0.9 ? 0.8 : 0.95, near: d >= 0.55 }; }
    function winFlake(any) { var w = scene.win, d = Math.random(); return { t: 'w', x: rnd(w.x, w.x + w.w), y: any ? rnd(w.y, w.y + w.h) : w.y - 4, r: (d < 0.7 ? rnd(0.8, 1.3) : rnd(1.5, 2.3)) * mz(0.6), v: (d < 0.7 ? rnd(14, 24) : rnd(26, 40)) * mz(0.6), ph: rnd(0, 6), sw: rnd(0.45, 1.25), amp: rnd(2, 6) * mz(0.6), a: d < 0.7 ? 0.65 : 0.95 }; }
    // a soft light, drawn once per color and stamped: dozens of these every frame cost almost nothing
    function glowOf(col) {
      if (glow[col]) return glow[col];
      var c = document.createElement('canvas'); c.width = c.height = 64;
      var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(' + col + ',1)'); g.addColorStop(0.28, 'rgba(' + col + ',.42)'); g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return (glow[col] = c);
    }
    function stamp(col, x, y, r, a) { if (!(a > 0) || !(r > 0)) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glowOf(col), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; }
    // a sprite as a dark silhouette (the sleigh against the night)
    function tinted(im, col) {
      var t0 = document.createElement('canvas'); t0.width = 512; t0.height = 171; var c0 = t0.getContext('2d');
      c0.drawImage(im, 0, 0, 512, 171); c0.globalCompositeOperation = 'source-in'; c0.fillStyle = col; c0.fillRect(0, 0, 512, 171);
      return t0;
    }
    // ------------------------------------------------------------ CHRISTMAS
    function roomStep(dt, t) {
      var d = scene, still = level === 'off', u = d.unitRect;
      // nothing of the room's effects in front of the entertainment center, which stands nearest
      if (u) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, sw, sh); ctx.rect(u[0], u[1] + u[3] * 0.01, u[2], u[3]); ctx.clip('evenodd'); }
      // the TV's light on the wall and the carpet, shifting a little as a picture does
      var f = still ? 0.55 : 0.5 + 0.08 * Math.sin(t * 0.0031) + 0.05 * Math.sin(t * 0.0173);
      stamp('70,110,255', d.tv.x + d.tv.w / 2, d.tv.y + d.tv.h / 2, d.tv.w * 1.02, f);
      // through the window: snow (always: decoration, whatever the weather), and now and then the sleigh
      if (d.win) {
        var cb = Math.min(d.win.y + d.win.h, d.clipBottom || 1e9);
        ctx.save(); ctx.beginPath(); ctx.rect(d.win.x, d.win.y, d.win.w, Math.max(0, cb - d.win.y)); ctx.clip();
        crossT -= dt;
        if (!cross && crossT <= 0 && !still) cross = { k: 'sleigh', x: d.win.x + d.win.w + 20, v: -d.win.w / 5.5 };
        if (cross) {
          cross.x += cross.v * dt;
          var im = img('sleigh.webp'), w0 = d.win.w * 0.62;
          if (ok(im)) { if (!cross.tint) cross.tint = tinted(im, '#06101f'); ctx.drawImage(cross.tint, cross.x, d.win.y + d.win.h * 0.2 + Math.sin(t * 0.002) * 3, w0, w0 / 3); }
          if (cross.x < d.win.x - w0 - 10) { cross = null; crossT = level === 'gentle' ? rnd(40, 60) : isDay ? rnd(9, 15) : rnd(16, 26); }
        }
        ctx.fillStyle = '#fff';
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i]; if (p.t !== 'w') continue;
          p.y += p.v * dt;
          if (p.y > d.win.y + d.win.h + 3) { Object.assign(p, winFlake(false)); continue; }
          ctx.globalAlpha = p.a; ctx.beginPath(); ctx.arc(p.x + Math.sin(p.ph + t * 0.0007 * p.sw) * p.amp, p.y, p.r, 0, 6.3); ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.restore();
        // the frame and drapes back over the snow, only within the glass's rows above the couch's back
        if (d.frame) { ctx.save(); ctx.beginPath(); ctx.rect(d.frame.r[0], d.frame.r[1], d.frame.r[2], Math.max(0, (d.clipBottom || 1e9) - d.frame.r[1])); ctx.clip(); ctx.drawImage(d.frame.img, d.frame.r[0], d.frame.r[1], d.frame.r[2], d.frame.r[3]); ctx.restore(); }
      }
      // the tree's lights: colors taking turns, as a store-bought string with a chase setting does
      var speed = isDay ? 0.0034 : 0.0019;
      d.bulbs.forEach(function (b, n) {
        var w = still ? 0.8 : 0.42 + 0.58 * Math.pow(0.5 + 0.5 * Math.sin(t * speed + b.c * 1.57 + n * 0.09), 2);
        stamp(b.col, b.x, b.y, b.r * 5.5, w * 0.95);
        ctx.fillStyle = 'rgba(' + b.col + ',' + (0.45 + w * 0.55) + ')'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.3); ctx.fill();
      });
      if (!still && d.glints.length) for (var g = 0; g < 7; g++) { var gl = d.glints[Math.floor(t / 240 + g * 11) % d.glints.length], v = Math.sin((t / 240 + g * 11) % 1 * Math.PI); stamp('255,250,225', gl[0], gl[1], 6.5 * mz(0.6), v * 0.95); }
      stamp('255,226,120', d.star[0], d.star[1], d.star[2] * (still ? 2.5 : 2.4 + 0.3 * Math.sin(t * 0.002)), 0.75);
      if (u) ctx.restore();
      // the garland's string twinkles in step with the tree
      (d.unitBulbs || []).forEach(function (b, n) {
        var w2 = still ? 0.8 : 0.42 + 0.58 * Math.pow(0.5 + 0.5 * Math.sin(t * speed + b.c * 1.57 + n * 0.09), 2);
        stamp(b.col, b.x, b.y, b.r * 5.5, w2 * 0.9);
        ctx.fillStyle = 'rgba(' + b.col + ',' + (0.45 + w2 * 0.55) + ')'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.3); ctx.fill();
      });
    }
    // ------------------------------------------------------------ THANKSGIVING
    function winLeaf(any) { var w = scene.win; return { t: 'wl', n: LEAVES[Math.floor(rnd(0, 3))], x: rnd(w.x, w.x + w.w), y: any ? rnd(w.y, w.y + w.h) : w.y - 12, s: rnd(9, 16) * mz(0.6), v: rnd(16, 30) * mz(0.6), ph: rnd(0, 6), rot: rnd(0, 6), vr: rnd(-1.5, 1.5) }; }
    function thanksStep(dt, t) {
      var d = scene, still = level === 'off';
      // leaves falling past the window (always), behind the table, the frame back over them only within the glass
      if (d.win) {
        var cb = Math.min(d.win.y + d.win.h, d.clipBottom || 1e9);
        ctx.save(); ctx.beginPath(); ctx.rect(d.win.x, d.win.y, d.win.w, Math.max(0, cb - d.win.y)); ctx.clip();
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i]; if (p.t !== 'wl') continue;
          p.y += p.v * dt; p.rot += p.vr * dt;
          if (p.y > d.win.y + d.win.h + 10) { Object.assign(p, winLeaf(false)); continue; }
          var im = img(p.n); if (ok(im)) { ctx.save(); ctx.translate(p.x + Math.sin(p.ph + t * 0.001) * 14, p.y); ctx.rotate(p.rot); ctx.scale(Math.cos(t * 0.002 + p.ph) * 0.7 + 0.3, 1); ctx.drawImage(im, -p.s / 2, -p.s / 2, p.s, p.s); ctx.restore(); }
        }
        if (d.frame) ctx.drawImage(d.frame.img, d.frame.r[0], d.frame.r[1], d.frame.r[2], d.frame.r[3]);
        ctx.restore();
      }
      // candle flames (none where the board stands in front of them)
      var behind = function (x, y) { var b = d.boardDrawn; return b && x > b[0] && x < b[0] + b[2] && y > b[1] - 8 && y < b[1] + b[3]; };
      d.candles.forEach(function (o, n) {
        if (behind(o[0], o[1])) return;
        var f = still ? 1 : 1 + 0.12 * Math.sin(t * 0.021 + n * 3) + 0.08 * Math.sin(t * 0.057 + n), hh = o[2] * 2.2 * f, w = o[2] * 0.9;
        stamp('255,170,70', o[0], o[1] - hh * 0.5, o[2] * 6, 0.55);
        var g = ctx.createRadialGradient(o[0], o[1] - hh * 0.35, 0, o[0], o[1] - hh * 0.35, hh * 0.7); g.addColorStop(0, 'rgba(255,250,215,1)'); g.addColorStop(0.45, 'rgba(255,190,80,.95)'); g.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(o[0] + (still ? 0 : Math.sin(t * 0.013 + n) * w * 0.15), o[1] - hh * 0.45, w * 0.5, hh * 0.55, 0, 0, 6.3); ctx.fill();
      });
      // steam off the hot food: a few soft puffs rising and fading
      if (!still) d.steam.forEach(function (o, n) {
        if (behind(o[0], o[1])) return;
        for (var j = 0; j < 4; j++) {
          var life = ((t / 2600) + j / 4 + n * 0.37) % 1, k = o[2];
          stamp('255,255,255', o[0] + Math.sin(life * 5 + n + j) * 14 * k, o[1] - life * 150 * k, (18 + life * 30) * k, 0.1 * Math.sin(life * Math.PI));
        }
      });
    }
    // ------------------------------------------------------------ NEW YEAR'S
    function newyearStep(dt, t) {
      var d = scene, still = level === 'off';
      d.bulbs.forEach(function (b, n) {
        var w = still ? 0.85 : 0.7 + 0.3 * Math.sin(t * 0.0021 + n * 1.3) * Math.sin(t * 0.0007 + n);
        stamp('255,214,140', b[0], b[1], 13 * mz(0.6), w * 0.8);
        stamp('255,245,220', b[0], b[1], 4 * mz(0.6), w);
      });
    }
    // ------------------------------------------------------------ HALLOWEEN
    function hauntStep(dt, t) {
      var d = scene, still = level === 'off';
      d.windows.forEach(function (w, n) {
        var a = still ? 0.55 : 0.4 + 0.2 * Math.sin(t * 0.0023 + n * 2) + 0.12 * Math.sin(t * 0.019 + n);
        stamp('255,178,70', w.x + w.w / 2, w.y + w.h / 2, Math.max(w.w, w.h) * 1.5, Math.max(0.08, a));
      });
      d.pumpkins.forEach(function (p, n) {
        var a = still ? 0.55 : 0.42 + 0.22 * Math.sin(t * 0.0091 + n * 2.1) * Math.sin(t * 0.0137 + n) + 0.1 * Math.sin(t * 0.031 + n);
        stamp('255,132,30', p[0], p[1], p[2] * 2.9, a);
      });
      // a shutter on one hinge, loose in the wind (still: hanging half open)
      var S0 = d.shutter;
      if (S0 && S0.img && ok(S0.img)) { var sw1 = still ? 0.58 : 0.58 + 0.36 * Math.sin(t * 0.0011) * Math.sin(t * 0.0007 + 1); ctx.drawImage(S0.img, S0.x - S0.w * sw1, S0.y, S0.w * sw1, S0.h); }
      if (still) return;
      // someone crosses the lit window
      figT -= dt;
      var W0 = d.windows[d.fig];
      if (W0 && figT < 6) {
        var pos = 1 - figT / 6, x0 = W0.x - W0.w * 0.55 + (W0.w * 2.1) * pos;
        ctx.save(); ctx.beginPath(); ctx.rect(W0.x, W0.y, W0.w, W0.h); ctx.clip(); ctx.fillStyle = '#120a10';
        ctx.beginPath(); ctx.arc(x0, W0.y + W0.h * 0.32, W0.w * 0.2, 0, 6.3); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x0, W0.y + W0.h * 0.95, W0.w * 0.34, W0.h * 0.5, 0, 0, 6.3); ctx.fill();
        ctx.restore();
        if (figT <= 0) figT = rnd(12, 22) + 6;
      }
      // bats leave the attic and come toward you
      crossT -= dt;
      if (!cross && crossT <= 0) cross = { life: 0, b: [0, 1, 2, 3, 4, 5, 6].map(function (i) { return { d: i * 0.32, tx: rnd(-0.9, -0.2) * sw * 0.7, ty: rnd(-0.55, -0.05) * sh * 0.6, ph: rnd(0, 6) }; }) };
      if (cross) {
        cross.life += dt; var alive = false;
        cross.b.forEach(function (b) {
          var f0 = (cross.life - b.d) / 6; if (f0 < 0 || f0 > 1) { if (f0 < 0) alive = true; return; } alive = true;
          var fr = img(['bat1.webp', 'bat2.webp', 'bat3.webp'][Math.floor((t / 80 + b.ph) % 3)]), s = (10 + 60 * f0 * f0) * mz(0.55);
          if (ok(fr)) ctx.drawImage(fr, d.attic[0] + b.tx * f0 - s / 2, d.attic[1] + b.ty * f0 + Math.sin(t * 0.004 + b.ph) * 16 * f0 - s / 2, s, s);
        });
        if (!alive) { cross = null; crossT = level === 'gentle' ? rnd(30, 50) : isDay ? rnd(7, 12) : rnd(11, 20); }
      }
      // distant lightning, soft and rare (Full only)
      if (level === 'full') { flashT -= dt; if (flashT <= 0) { flash = 1; flashT = rnd(28, 60); } }
      if (flash > 0) { ctx.fillStyle = 'rgba(190,200,255,' + (0.2 * flash * (Math.sin(flash * 30) * 0.35 + 0.65)) + ')'; ctx.fillRect(0, 0, sw, sh * 0.62); flash = Math.max(0, flash - dt * 2.4); }
    }
    // ------------------------------------------------------------ OUTDOORS
    function leaf(any) { return { t: 's', n: LEAVES[Math.floor(rnd(0, 3))], x: rnd(0, sw), y: any ? rnd(-40, sh) : -40, s: rnd(20, 40) * mz(0.7), v: rnd(32, 62) * mz(0.7), ph: rnd(0, 6), sw: rnd(0.6, 1.3), rot: rnd(0, 6), vr: rnd(-1.4, 1.4), flip: rnd(0, 6), land: true, a: 1 }; }
    function petal(any) { return { t: 's', n: 'sp-petal.webp', x: rnd(0, sw), y: any ? rnd(-30, sh) : -30, s: rnd(12, 22) * mz(0.7), v: rnd(22, 42) * mz(0.7), ph: rnd(0, 6), sw: rnd(0.6, 1.2), rot: rnd(0, 6), vr: rnd(-1, 1), flip: rnd(0, 6), a: 0.95, land: Math.random() < 0.3 }; }
    function heart(any) { return { t: 'h', n: 'sp-heart.webp', x: rnd(0, sw), y: any ? rnd(0, sh) : sh + 30, s: rnd(18, 42) * mz(0.7), v: rnd(22, 46) * mz(0.7), ph: rnd(0, 6), sw: rnd(0.5, 1), a: rnd(0.55, 0.95) }; }
    function butterfly() { return { t: 'b', x: rnd(0, sw), y: rnd(sh * 0.25, sh * 0.75), s: rnd(30, 54) * mz(0.7), ph: rnd(0, 6), r1: rnd(0.07, 0.13), r2: rnd(0.11, 0.2), ax: rnd(0.15, 0.32), ay: rnd(0.06, 0.16), cx: rnd(0.2, 0.8), cy: rnd(0.3, 0.6) }; }
    function balloon(any) { var c = [['#ff7a8a', '#d9304e'], ['#7fc4ff', '#2474d9'], ['#ffd76a', '#d99a1c'], ['#b48cff', '#6a3fd1'], ['#6ee3b5', '#1ea878']][Math.floor(rnd(0, 5))]; return { t: 'l', c: c, x: rnd(0, sw), y: any ? rnd(0, sh + 120) : sh + 100, s: rnd(24, 40) * mz(0.7), v: rnd(20, 38) * mz(0.7), ph: rnd(0, 6), sw: rnd(0.3, 0.7) }; }
    function confetti(any) { var cols = h.id === 'newyear' ? ['#f4cb68', '#fff2c4', '#d7a53e', '#ffffff'] : ['#ff7a8a', '#7fc4ff', '#ffd76a', '#b48cff', '#6ee3b5']; return { t: 'c', c: cols[Math.floor(rnd(0, cols.length))], x: rnd(0, sw), y: any ? rnd(-20, sh) : -14, w: rnd(4, 8) * mz(0.7), h: rnd(7, 12) * mz(0.7), v: rnd(36, 72) * mz(0.7), ph: rnd(0, 6), sw: rnd(0.6, 1.3), rot: rnd(0, 6), vr: rnd(-3, 3) }; }
    // does this come to rest on the number's top?
    function landAt(p, xx) {
      if (!pile) return false;
      var i = Math.round(xx / pile.step);
      if (!pile.cap[i]) return false;
      return p.y >= pile.top[i] - pile.h[i];
    }
    function addSnow(xx, r) {
      var i = Math.round(xx / pile.step), n = 5;
      for (var k = -n; k <= n; k++) { var j = i + k; if (pile.cap[j]) { var w = 1 - Math.abs(k) / (n + 1); pile.h[j] = Math.min(pile.max * (0.75 + 0.25 * Math.sin(j * 0.31)), pile.h[j] + r * 0.42 * w); } }
    }
    function drawPile() {
      if (!pile || kind !== 'snow') return;
      var st = pile.step, cols = pile.top.length, i = 0;
      while (i < cols) {
        if (!pile.cap[i]) { i++; continue; }
        var a = i; while (i < cols && pile.cap[i]) i++;
        var b = i - 1;
        if (b - a < 2) continue;
        ctx.beginPath();
        ctx.moveTo(a * st, pile.top[a] + 3);
        for (var j = a; j <= b; j++) { var e = Math.sqrt(Math.min(1, Math.min(j - a + 1, b - j + 1) / 5)); ctx.lineTo(j * st, pile.top[j] - pile.h[j] * e); }
        for (var r = b; r >= a; r--) ctx.lineTo(r * st, pile.top[r] + 3);   // back along the digit's own edge
        ctx.closePath();
        ctx.fillStyle = '#ffffff'; ctx.fill();
      }
    }
    // an outdoor landscape's bulbs and candles (the sky's holiday.json), glowing
    function lights(t) {
      if (!bulbL || scene) return;
      for (var i = 0; i < bulbL.length; i++) {
        var b = bulbL[i], p = artXY(b[0], b[1]), cand = b[3] === 'candle';
        var w = cand ? 0.55 + 0.45 * Math.sin(t * 0.0071 + i * 2.1) * Math.sin(t * 0.0113 + i) : 0.5 + 0.5 * Math.sin(t * 0.0017 + i * 1.7);
        if (level === 'off') w = cand ? 0.7 : 0.6;
        var col = cand ? '255,150,50' : ['255,210,130', '255,110,90', '120,220,160', '130,180,255'][i % 4];
        stamp(col, p[0], p[1], (cand ? 40 : 10) * p[2] * 2, (cand ? 0.38 : 0.75) * w * 1.6);
      }
    }
    function burst(x, y, big) {
      var pal = h.flag ? [['#ff5a52', '#ffd0cc'], ['#ffffff', '#dfe8ff'], ['#5fa8ff', '#cfe4ff']] : [['#ffd76a', '#fff2c4'], ['#ff8fb0', '#ffe0ea'], ['#8fd1ff', '#e2f4ff'], ['#c7a1ff', '#efe3ff']];
      var c = pal[Math.floor(rnd(0, pal.length))], n = Math.round((big ? 70 : 46) * (level === 'gentle' ? 0.6 : 1)), sp = (big ? 190 : 140) * mz(0.6);
      for (var i = 0; i < n && sparks.length < 260; i++) { var a = Math.PI * 2 * i / n + rnd(-0.05, 0.05), v = sp * rnd(0.55, 1); sparks.push({ x: x, y: y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(1.1, 1.9), c: Math.random() < 0.3 ? c[1] : c[0] }); }
    }
    function fireworks(dt) {
      fwT -= dt;
      if (fwT <= 0 && rockets.length < 3) {
        fwT = (level === 'gentle' ? rnd(2.8, 4.6) : rnd(1.2, 2.6)) / (isDay ? 1.6 : 1);
        rockets.push({ x: sw * rnd(0.3, 0.95), y: kind === 'newyear' && scene && scene.horizon ? scene.horizon : sh * 0.62, ty: sh * rnd(0.1, 0.36), v: rnd(380, 480) * mz(0.6) });
      }
      ctx.lineCap = 'round';
      for (var r = rockets.length - 1; r >= 0; r--) {
        var R = rockets[r]; R.y -= R.v * dt;
        ctx.strokeStyle = 'rgba(255,235,190,.75)'; ctx.lineWidth = 2 * mz(0.6); ctx.beginPath(); ctx.moveTo(R.x, R.y); ctx.lineTo(R.x + rnd(-1, 1), R.y + 18 * mz(0.6)); ctx.stroke();
        if (R.y <= R.ty) { burst(R.x, R.y, Math.random() < 0.3); rockets.splice(r, 1); }
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = sparks.length - 1; i >= 0; i--) {
        var s = sparks[i]; s.life += dt;
        if (s.life >= s.max) { sparks.splice(i, 1); continue; }
        s.px = s.x; s.py = s.y; s.vx *= (1 - 0.9 * dt); s.vy = s.vy * (1 - 0.9 * dt) + 46 * mz(0.6) * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        var f = 1 - s.life / s.max;
        ctx.globalAlpha = f * f; ctx.strokeStyle = s.c; ctx.lineWidth = 2 * mz(0.6); ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.x, s.y); ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // what crosses the sky now and then outdoors: the sleigh, the geese, the bats
    function crossers(dt, t) {
      if (scene || level === 'off') return;
      crossT -= dt;
      if (!cross && crossT <= 0) {
        if (kind === 'snow') cross = { k: 'sleigh', x: sw + 240 * Z, v: -sw / 11, y: sh * (tall ? 0.3 : 0.24) };
        if (kind === 'leaves') cross = { k: 'geese', x: -200 * Z, v: sw / 15, y: sh * rnd(0.14, 0.3) };
        if (kind === 'bats') cross = { k: 'bats', x: sw + 80, v: -sw / 9, y: sh * rnd(0.2, 0.36), b: [0, 1, 2, 3, 4, 5].map(function (i) { return { dx: i * 62 * Z + rnd(-14, 14), dy: rnd(-60, 60) * Z, ph: rnd(0, 6) }; }) };
      }
      if (!cross) return;
      cross.x += cross.v * dt;
      var done = cross.v < 0 ? cross.x < -520 * Math.max(Z, 0.5) : cross.x > sw + 300;
      if (cross.k === 'sleigh') {
        var im = img('sleigh.webp');
        if (ok(im)) { var w0 = 300 * mz(0.55); if (!cross.tint) cross.tint = tinted(im, '#08101f'); ctx.drawImage(cross.tint, cross.x, cross.y + Math.sin(t * 0.0016) * 8 * Z, w0, w0 / 3); }
      } else if (cross.k === 'geese') {
        ctx.strokeStyle = 'rgba(20,14,20,.82)'; ctx.lineWidth = 2 * mz(0.6); ctx.lineCap = 'round';
        for (var g = 0; g < 9; g++) {
          var o = Math.ceil(g / 2) * (g % 2 ? 1 : -1), gx = cross.x - Math.abs(o) * 26 * Z, gy = cross.y + o * 15 * Z, fl = Math.sin(t * 0.007 + g) * 5 * Z, w1 = 11 * Z;
          ctx.beginPath(); ctx.moveTo(gx - w1, gy - fl); ctx.quadraticCurveTo(gx - w1 / 2, gy - 1, gx, gy); ctx.quadraticCurveTo(gx + w1 / 2, gy - 1, gx + w1, gy - fl); ctx.stroke();
        }
      } else if (cross.k === 'bats') {
        cross.b.forEach(function (b) {
          var fr = img(['bat1.webp', 'bat2.webp', 'bat3.webp'][Math.floor((t / 80 + b.ph) % 3)]);
          if (ok(fr)) { var s = 54 * mz(0.6); ctx.drawImage(fr, cross.x + b.dx, cross.y + b.dy + Math.sin(t * 0.003 + b.ph) * 18 * Z, s, s); }
        });
      }
      if (done) { cross = null; crossT = level === 'gentle' ? rnd(30, 50) : isDay ? rnd(10, 16) : rnd(16, 28); }
    }
    function drawSpiders(t) {
      spiders.forEach(function (sp) {
        var len = sp.len * (0.9 + 0.1 * Math.sin(t * 0.0007 + sp.ph)), x = sp.x + Math.sin(t * 0.0009 + sp.ph) * 4;
        ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sp.x, 0); ctx.lineTo(x, len); ctx.stroke();
        var r = 6 * mz(0.7); ctx.fillStyle = '#0a0a10'; ctx.beginPath(); ctx.arc(x, len, r, 0, 7); ctx.fill();
        ctx.strokeStyle = '#0a0a10'; ctx.lineWidth = 1.5;
        for (var a = 0; a < 4; a++) [-1, 1].forEach(function (d) { ctx.beginPath(); ctx.moveTo(x, len); ctx.quadraticCurveTo(x + d * r * 1.6, len - r * (1.2 - a * 0.7), x + d * r * 2.2, len + r * (a * 0.7 - 0.4)); ctx.stroke(); });
      });
    }
    var far = [], mid = [], nearF = [];
    function batch(list, a) { if (!list.length) return; ctx.fillStyle = 'rgba(255,255,255,' + a + ')'; ctx.beginPath(); for (var k = 0; k < list.length; k += 3) { ctx.moveTo(list[k] + list[k + 2], list[k + 1]); ctx.arc(list[k], list[k + 1], list[k + 2], 0, 6.3); } ctx.fill(); }
    function step(dt, t) {
      ctx.setTransform(q, 0, 0, q, 0, 0);
      ctx.clearRect(0, 0, sw, sh);
      lights(t);
      if (kind === 'room' && scene) roomStep(dt, t);
      if (kind === 'haunt' && scene) hauntStep(dt, t);
      if (kind === 'fireworks' || (kind === 'newyear' && level !== 'off')) fireworks(dt);
      if (kind === 'thanks' && scene && scene.candles) thanksStep(dt, t);
      if (kind === 'newyear' && scene && scene.bulbs) newyearStep(dt, t);
      crossers(dt, t);
      if (kind === 'bats') drawSpiders(t);
      // perched leaves and petals
      perched.forEach(function (p) { var i = img(p.n); if (ok(i)) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.drawImage(i, -p.s / 2, -p.s * 0.6, p.s, p.s); ctx.restore(); } });
      far.length = 0; mid.length = 0; nearF.length = 0;
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        if (p.t === 'w' || p.t === 'wl') continue;
        if (p.t === 'f') {
          p.y += p.v * dt; var fx = p.x + Math.sin(p.ph + t * 0.001 * p.sw) * 14; p.x += 5 * dt;
          if (p.near && landAt(p, fx)) { addSnow(fx, p.r); Object.assign(p, flake(false)); continue; }
          if (p.y > sh + 8 || p.x > sw + 20) { Object.assign(p, flake(false)); continue; }
          (p.r < 1.6 * mz(0.7) ? far : p.r < 2.6 * mz(0.7) ? mid : nearF).push(fx, p.y, p.r);
        } else if (p.t === 's') {
          p.y += p.v * dt; p.rot += p.vr * dt; p.flip += dt * 2; var sx = p.x + Math.sin(p.ph + t * 0.001 * p.sw) * 34 * mz(0.7);
          if (p.land && landAt(p, sx)) {
            var idx = Math.round(sx / pile.step);
            if (perched.length > 11) perched.shift();
            perched.push({ n: p.n, x: sx, y: pile.top[idx], s: p.s * 0.92, rot: rnd(-0.5, 0.5) });
            Object.assign(p, p.n === 'sp-petal.webp' ? petal(false) : leaf(false)); continue;
          }
          if (p.y > sh + 40) { Object.assign(p, p.n === 'sp-petal.webp' ? petal(false) : leaf(false)); continue; }
          var im = img(p.n); if (ok(im)) { ctx.save(); ctx.translate(sx, p.y); ctx.rotate(p.rot); ctx.scale(Math.cos(p.flip) * 0.75 + 0.25, 1); ctx.globalAlpha = p.a; ctx.drawImage(im, -p.s / 2, -p.s / 2, p.s, p.s); ctx.restore(); }
        } else if (p.t === 'h') {
          p.y -= p.v * dt;
          if (p.y < -50) { Object.assign(p, heart(false)); continue; }
          var ha = Math.min(1, (p.y + 50) / (sh * 0.25)) * p.a, hx = p.x + Math.sin(p.ph + t * 0.001 * p.sw) * 26, him = img(p.n);
          if (ok(him)) { ctx.save(); ctx.translate(hx, p.y); ctx.rotate(Math.sin(p.ph + t * 0.0012) * 0.22); ctx.globalAlpha = ha; ctx.drawImage(him, -p.s / 2, -p.s / 2, p.s, p.s); ctx.restore(); }
        } else if (p.t === 'b') {
          var bx = sw * (p.cx + p.ax * Math.sin(t * 0.001 * p.r1 + p.ph)), by = sh * (p.cy + p.ay * Math.sin(t * 0.001 * p.r2 * 2 + p.ph * 2)) + Math.sin(t * 0.006 + p.ph) * 5, bim = img('sp-butterfly.webp');
          if (ok(bim)) { ctx.save(); ctx.translate(bx, by); ctx.scale(Math.abs(Math.sin(t * 0.012 + p.ph)) * 0.75 + 0.25, 1); ctx.drawImage(bim, -p.s / 2, -p.s / 2, p.s, p.s); ctx.restore(); }
        } else if (p.t === 'l') {
          p.y -= p.v * dt;
          if (p.y < -140) { Object.assign(p, balloon(false)); continue; }
          var lx = p.x + Math.sin(p.ph + t * 0.001 * p.sw) * 18;
          ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, p.y + p.s * 1.15); ctx.quadraticCurveTo(lx + 8, p.y + p.s * 2.2, lx - 3, p.y + p.s * 3.2); ctx.stroke();
          var bg0 = ctx.createRadialGradient(lx - p.s * 0.3, p.y - p.s * 0.35, p.s * 0.1, lx, p.y, p.s * 1.15); bg0.addColorStop(0, '#fff'); bg0.addColorStop(0.2, p.c[0]); bg0.addColorStop(1, p.c[1]);
          ctx.fillStyle = bg0; ctx.beginPath(); ctx.ellipse(lx, p.y, p.s * 0.86, p.s * 1.08, 0, 0, 7); ctx.fill();
        } else if (p.t === 'c') {
          p.y += p.v * dt; p.rot += p.vr * dt;
          if (p.y > sh + 16) { Object.assign(p, confetti(false)); continue; }
          var cx = p.x + Math.sin(p.ph + t * 0.001 * p.sw) * 24;
          ctx.save(); ctx.translate(cx, p.y); ctx.rotate(p.rot); ctx.scale(Math.cos(p.rot * 1.7), 1); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        }
      }
      batch(far, 0.55); batch(mid, 0.8); batch(nearF, 0.96);
      drawPile();
      // THE QUIET PLACES: what falls fades out behind the corner and the row, so their words stay easy to read
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      if (qf != null) { var gf = ctx.createLinearGradient(0, qf - 34 * Z, 0, qf + 4 * Z); gf.addColorStop(0, 'rgba(0,0,0,0)'); gf.addColorStop(1, 'rgba(0,0,0,.82)'); ctx.fillStyle = gf; ctx.fillRect(0, qf - 34 * Z, sw, sh - qf + 34 * Z); }
      qz.forEach(function (z0) {
        var cx0 = z0.x + z0.w / 2, cy0 = z0.y + z0.h / 2, rx = z0.w / 2 + 46 * Z, ry = z0.h / 2 + 46 * Z;
        ctx.save(); ctx.translate(cx0, cy0); ctx.scale(rx, ry);
        var gz = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1); gz.addColorStop(0, 'rgba(0,0,0,.86)'); gz.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gz; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3); ctx.fill(); ctx.restore();
      });
      ctx.restore();
    }
    function loop(t) {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = t; return; }
      var gap = 1000 / (level === 'gentle' ? 20 : 30);
      if (t - last < gap - 1) return;
      var dt = Math.min(0.12, (t - last) / 1000); last = t;
      step(dt, t);
    }
    // one still picture, a moment into it (fireworks: a few bursts already open)
    function still() {
      fwT = 0;
      if (kind === 'fireworks') { for (var n = 0; n < 3; n++) burst(sw * rnd(0.35, 0.9), sh * rnd(0.12, 0.34), n === 0); for (var k = 0; k < 18; k++) { ctx.clearRect(0, 0, sw, sh); fireworks(0.03); } rockets = []; }
      step(0, 1000);
    }
    return {
      size: function (w, hh, qq) {
        sw = w; sh = hh; q = qq; tall = hh > w * 1.05;
        var cw = Math.round(w * q), ch = Math.round(hh * q);
        if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      },
      // what to draw: the scene ('room', 'haunt', 'thanks', 'newyear') or the outdoor effects ('snow', 'leaves',
      // 'hearts', 'petals', 'butterflies', 'balloons', 'fireworks', 'bats'); its level; the day itself; the scene's data
      // (the same scene again -- the same kind, level, size and painted picture -- keeps what is falling where it is:
      // seeded afresh, every flake jumped to a new place)
      reset: function (k, lv, day, data, hol, z) {
        var sig = [k || '', lv, !!day, sw, sh, z || 1, (hol || {}).id].join('|'), keep = sig === lastSig && (data || null) === scene && ps.length > 0;
        lastSig = sig;
        kind = k || ''; level = lv; isDay = !!day; scene = data || null; h = hol || {}; Z = z || 1;
        SPRITES.forEach(img);
        if (keep) return;
        glow = {};
        if (scene) pile = null; else buildMask();
        seed();
      },
      lights: function (l) { bulbL = l && l.length ? l : null; },
      quiet: function (list, foot) { qz = list || []; qf = foot == null ? null : foot; },
      start: function () {
        cancelAnimationFrame(raf); raf = 0; last = performance.now();
        if (!kind) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); return; }
        if (level === 'off') { still(); return; }
        raf = requestAnimationFrame(loop);
      },
      // a frame drawn now (a layout changed under a still picture)
      frame: function () { if (kind) { if (level === 'off') still(); else step(0, last || 1000); } },
      stop: function () { if (raf) cancelAnimationFrame(raf); raf = 0; },
      running: function () { return !!raf; },
      counts: function () { var p = ps[0]; return { particles: ps.length, sparks: sparks.length, perched: perched.length, first: p ? [Math.round(p.x), Math.round(p.y)] : null }; }
    };
  }

  window.hkHolidayFx = { create: create };
})();
