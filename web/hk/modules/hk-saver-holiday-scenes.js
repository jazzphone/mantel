// @ts-check
// hk-saver-holiday-scenes.js -- THE HOLIDAY SLIDE'S PAINTED SCENES (phase 20, docs/phase20/HOLIDAY-SLIDE.md "The
// scenes"): a 90s living room at night for Christmas, a haunted house on a hill for Halloween, a 90s dining room at
// dusk for Thanksgiving and a rooftop party at midnight for New Year's. Each is a list of painted pieces (Codex's,
// web/hk/holiday/, tools/holiday_art.py) placed by code for the screen it is on and drawn back to front on a background
// canvas -- Halloween's stone, grass and pumpkins on a front canvas, in front of its fog -- with the measurements the
// slide's live parts (the TV picture, the carving, the chalk, the flip board) and the effects need. The layouts are
// the approved mock-up's (docs/phase20/mockup/holiday-slide.html, SCENES), its rough drawings removed: only the
// measurements they made stay, and the paintings draw from them.
//
// Loaded with the slide (hk-saver-holiday.js), never on its own.
//
// THE RULES EVERY SCENE FOLLOWS (the owner's review):
//   - depth: the hero forward at `foot`, big; what stands against the wall on the floor line, smaller; the overlaps
//     deliberate (the couch behind the cabinet, the board in front of the table, the tree in front of the couch's end)
//   - nothing floats: every piece's feet are its lowest solid row (footOf), and its shadow is drawn there (shadowFor)
//   - the bigger window, so you can see outside (rooms; whole and under the corner when narrow or upright)
//   - painted once per layout, cached by scene, size, foot and scale: nothing here runs per frame
//
//   hkHolidayScenes.PIECES                     the pieces each scene draws (tools/holiday_art.py has the same list)
//   hkHolidayScenes.load(sc, done)             asks for a scene's pieces; done(ok) once all have loaded (or one failed)
//   hkHolidayScenes.ready(sc)                  all its pieces are here
//   hkHolidayScenes.paint(sc, cv, cv2, W, H, foot, Z, M, q) -> data: the boxes of its live parts (data.tv, data.vcr,
//       data.stone, data.board), the window's glass and frame, the bulbs, candles, steam, windows... for the effects
(function () {
  'use strict';
  if (window.hkHolidayScenes) return;

  var BASE = '/hk/holiday/', SKY = '/hk/sky/';
  function url(u) { return window.hkV ? window.hkV(u) : u; }
  var PIECES = {
    room: ['room-wall', 'room-wainscot', 'room-carpet', 'room-window-outside', 'room-window', 'room-couch', 'room-tree',
           'room-presents-pile', 'room-entertainment-center', 'room-garland'],
    haunt: ['haunt-sky', 'haunt-house', 'haunt-house-lit', 'haunt-shutter', 'haunt-tree', 'haunt-grounds', 'haunt-stone',
            'haunt-grass', 'haunt-pumpkin-large', 'haunt-pumpkin-small'],
    thanks: ['thanks-wall', 'thanks-wainscot', 'thanks-floor', 'thanks-window-outside', 'thanks-window', 'thanks-table',
             'thanks-hutch', 'thanks-harvest', 'thanks-board', 'thanks-console'],
    newyear: ['ny-sky', 'ny-skyline', 'ny-rooftop', 'ny-board', 'ny-crate', 'ny-party', 'ny-balloons', 'ny-streamers']
  };
  // THE PAINTER'S MEASUREMENTS (web/hk/holiday/scenes.json, full-size px): the tree's bulbs in their painted colors,
  // the haunted house's windows (which one a figure crosses, which has the loose shutter), the table's candle wicks
  // and the hot food's steam. Asked for with the first scene; until it is here a scene is not ready.
  var POS = null, posState = '';
  var REAL = {}, state = {}, waiting = {};
  var moonImg = null;

  function loadPos(then) {
    if (POS) { then(true); return; }
    (waiting.pos = waiting.pos || []).push(then);
    if (posState === 'loading') return;
    posState = 'loading';
    var done = function (ok) { posState = ok ? 'ok' : ''; var w = waiting.pos; waiting.pos = []; w.forEach(function (f) { f(ok); }); };
    try {
      fetch(url(BASE + 'scenes.json')).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.treeBulbs && j.hauntWindows && j.thanksTable) { POS = j; done(true); } else done(false); })
        .catch(function () { done(false); });
    } catch (e) { done(false); }
  }
  // a scene's pieces asked for once; `done(ok)` when every one has loaded, or as soon as one fails (the slide then
  // shows the holiday's outdoor version: rule 7)
  function load(sc, done) {
    if (!PIECES[sc]) { if (done) done(false); return; }
    if (state[sc] === 'ok') { if (done) done(true); return; }
    if (state[sc] === 'fail') { if (done) done(false); return; }
    if (done) (waiting[sc] = waiting[sc] || []).push(done);
    if (state[sc] === 'loading') return;
    state[sc] = 'loading';
    var left = PIECES[sc].length + 1 + (sc === 'haunt' ? 1 : 0);
    var fin = function (ok) {
      if (state[sc] !== 'loading') return;
      if (!ok) state[sc] = 'fail';
      else if (--left > 0) return;
      else state[sc] = 'ok';
      var w = waiting[sc] || []; waiting[sc] = [];
      w.forEach(function (f) { try { f(state[sc] === 'ok'); } catch (e) { /* the slide's */ } });
    };
    loadPos(fin);
    if (sc === 'haunt') {
      if (!moonImg) { moonImg = new Image(); moonImg.decoding = 'async'; moonImg.src = url(SKY + 'moon-hallow.webp'); }
      if (moonImg.complete && moonImg.naturalWidth) fin(true);
      else { moonImg.addEventListener('load', function () { fin(true); }, { once: true }); moonImg.addEventListener('error', function () { fin(true); }, { once: true }); }
    }
    PIECES[sc].forEach(function (n) {
      var i = REAL[n];
      if (!i) { i = REAL[n] = new Image(); i.decoding = 'async'; i.src = url(BASE + n + '.webp'); }
      if (i.complete && i.naturalWidth) { fin(true); return; }
      i.addEventListener('load', function () { fin(true); }, { once: true });
      i.addEventListener('error', function () { fin(false); }, { once: true });
    });
  }
  function ready(sc) { return state[sc] === 'ok' && !!POS; }

  // ---------------------------------------------------------------- placing pieces
  // a piece in its box, at its own shape, standing on the box's foot
  function fitR(im, b) { var k = Math.min(b[2] / im.naturalWidth, b[3] / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; return [b[0] + (b[2] - w) / 2, b[1] + b[3] - h, w, h]; }
  function drawFit(c, n, b) { if (!b) return null; var r = fitR(REAL[n], b); c.drawImage(REAL[n], r[0], r[1], r[2], r[3]); return r; }
  function cover(c, n, b) { var im = REAL[n] || n, k = Math.max(b[2] / im.naturalWidth, b[3] / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; c.save(); c.beginPath(); c.rect(b[0], b[1], b[2], b[3]); c.clip(); c.drawImage(im, b[0] + (b[2] - w) / 2, b[1] + b[3] - h, w, h); c.restore(); }
  // a tile at `scale` px per painted px (the files are half size: 1024 painted px are 512 here)
  function tileAt(c, n, x, y, w, h, scale) {
    var im = REAL[n], tw = im.naturalWidth * scale, th = im.naturalHeight * scale;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    for (var ty = y; ty < y + h; ty += th) for (var tx = x; tx < x + w; tx += tw) c.drawImage(im, tx, ty, tw, th);
    c.restore();
  }
  // a strip across the screen at a height
  function across(c, n, x, y, w, h) { var im = REAL[n], sw0 = im.naturalWidth * h / im.naturalHeight; for (var tx = x; tx < x + w; tx += sw0) c.drawImage(im, tx, y, sw0, h); }

  // WHERE A PIECE MEETS THE FLOOR: the painted foot's own extent (its lowest solid rows), measured once. Some
  // paintings have empty space or a soft painted shadow below their feet (the couch has 7 % of its height)
  var FEET = {};
  function footOf(n) {
    if (FEET[n]) return FEET[n];
    /** @type {any[]} */ var out = [0.06, 0.94, 1];
    try {
      var im = REAL[n], w = 240, h = Math.max(1, Math.round(w * im.naturalHeight / im.naturalWidth)), cv0 = document.createElement('canvas');
      cv0.width = w; cv0.height = h; var x = cv0.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h);
      var a = x.getImageData(0, 0, w, h).data, foot = h - 1;
      for (var y0 = h - 1; y0 > 0; y0--) { var cnt = 0; for (var i0 = 0; i0 < w; i0++) if (a[(y0 * w + i0) * 4 + 3] > 200) cnt++; if (cnt > w * 0.01) { foot = y0; break; } }
      var rows = Math.max(2, Math.round(h * 0.05)), lo = w, hi = -1;
      for (var i = 0; i < w; i++) for (var j = foot - rows; j <= foot; j++) if (j >= 0 && a[(j * w + i) * 4 + 3] > 90) { lo = Math.min(lo, i); hi = Math.max(hi, i); break; }
      if (hi > lo) out = [lo / w, (hi + 1) / w, (foot + 1) / h];
      // ...and the bottom edge, column by column (a pile's gifts each meet the floor at their own depth)
      var prof = [];
      for (var i2 = 0; i2 < w; i2 += 2) { var bot = -1; for (var y2 = h - 1; y2 > h * 0.45; y2--) if (a[(y2 * w + i2) * 4 + 3] > 200) { bot = y2; break; } prof.push(bot < 0 ? null : [(i2 + 1) / w, (bot + 1) / h]); }
      out[3] = prof;
      cv0.width = cv0.height = 0;
    } catch (e) { /* a picture that can't be read: its box */ }
    return (FEET[n] = out);
  }
  // the feet of a placed piece, in px (the checks read it: every floor-standing piece's feet at or above `foot`)
  function feetAt(n, b) { if (!b) return null; var r = fitR(REAL[n], b), f = footOf(n); return r[1] + f[2] * r[3]; }
  // ITS SHADOW: dark where it touches, soft beyond, falling a little left (the room's light is from the right); against
  // a wall, a soft shade on the wall behind it too; a pile, a contact shadow under each part of its bottom edge
  function shadowFor(c, n, b, Z, wall, profile) {
    if (!b) return;
    var r = fitR(REAL[n], b), f = footOf(n), x0 = r[0] + f[0] * r[2], x1 = r[0] + f[1] * r[2], y = r[1] + f[2] * r[3], w = (x1 - x0) / 2, cx = (x0 + x1) / 2;
    var ell = function (ex, ey, rx, ry, a) {
      c.save(); c.translate(ex, ey); c.scale(rx, ry);
      var g = c.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(0.55, 'rgba(0,0,0,' + a * 0.5 + ')'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 1, 0, 6.3); c.fill(); c.restore();
    };
    if (wall) {
      // against the wall, the light in front of it: its shadow falls back, onto the wall and the floor between --
      // none in front of its feet, and a thin dark line where it touches
      ell(cx - w * 0.08, r[1] + r[3] * 0.55, w * 1.15, r[3] * 0.66, 0.42);
      c.save(); c.beginPath(); c.rect(0, 0, c.canvas.width, y + 2 * Z); c.clip();
      ell(cx - w * 0.06, y - 4 * Z, w * 1.12, Math.max(14 * Z, w * 0.12), 0.7);
      c.restore();
      ell(cx, y, w * 1.02, Math.max(3 * Z, w * 0.025), 0.75);
      return;
    }
    // standing in the room: under and behind it, a little left -- never spreading in front of its nearest edge
    var ry = Math.max(12 * Z, w * 0.16);
    c.save(); c.beginPath(); c.rect(0, 0, c.canvas.width, y + 2 * Z); c.clip();
    ell(cx - w * 0.14, y - ry * 0.45, w * 1.25, ry, 0.62);
    c.restore();
    ell(cx - w * 0.03, y - 1 * Z, w * 1.02, Math.max(3 * Z, w * 0.03), 0.8);
    if (profile && f[3]) f[3].forEach(function (q) { if (q) ell(r[0] + q[0] * r[2] - 2 * Z, r[1] + q[1] * r[3] - 1 * Z, 9 * Z, 3.5 * Z, 0.38); });
  }
  // the frame and drapes, kept ready at their size: the effects redraw them over what falls past the glass
  function framed(im, wr, q) {
    var fc = document.createElement('canvas');
    fc.width = Math.max(1, Math.ceil(wr[2] * q)); fc.height = Math.max(1, Math.ceil(wr[3] * q));
    fc.getContext('2d').drawImage(im, 0, 0, fc.width, fc.height);
    return fc;
  }

  // ---------------------------------------------------------------- the rooms' shared layout
  // THE ROOM (the mock-up's room()): the back wall's floor line is foot - 96 Z (34 upright); the chair rail 118 Z
  // above it, the paper border above the rail. The TV's old box (the board's place in the other rooms), the
  // entertainment center in front, the tree forward, the couch against the wall, the window behind it.
  function room(W, H, foot, Z, M) {
    var tall = H > W * 1.05, short = H < 500, data = {};
    var floorY = foot - (tall ? 34 : 96) * Z;
    // the TV's box: as large as the room between the corner and the row along the bottom
    var conH = (tall ? 46 : 58) * Z;
    var topMin = tall ? H * 0.3 : short ? H * 0.13 : H * 0.31;
    var maxH = foot - 6 * Z - conH - topMin, maxW = tall ? W - 2 * M : short ? W * 0.3 : (W < 1000 ? W * 0.47 : 400 * Z);
    var tvH = Math.min(maxH, maxW / 1.32, 384 * Z), tvW = tvH * 1.32;
    var tvX = tall ? (W - tvW) / 2 : short ? W * 0.3 : M, tvY;
    // the stand at the painted stand's own shape, as wide as the TV
    var conX = tvX - 14 * Z, conW = tvW + 28 * Z; conH = conW / 8.64; tvY = foot - 6 * Z - conH - tvH; var conY = foot - 6 * Z - conH;
    // THE ENTERTAINMENT CENTER (3:2, its screen half its width): in front, wide enough that the screen stays large; its
    // left tower off the left edge at wide sizes, so the room shows; centered upright and on a phone sideways
    var uw = tall ? W * 1.04 : short ? W * 0.48 : W < 1000 ? W * 0.72 : 700 * Z, uh = uw / 1.5, ux = tall ? (W - uw) / 2 : short ? W * 0.26 : -uw * 0.1, uy = foot - 6 * Z - uh;
    var rail = floorY - (tall ? 120 : 118) * Z, bh = 24 * Z, by = rail - bh;
    var treeH, treeCx, treeW, treeBase, win, couchB = null, back = null, fBase, fH, fW, fCx;
    if (tall) {
      // on the floor, behind the TV, and rising well above the entertainment center
      treeBase = floorY + 14 * Z; treeH = Math.max(tvY + tvH * 0.4 - Math.max(M + 70 * Z, H * 0.1), treeBase - Math.max(M + 70 * Z, uy - 240 * Z)); treeW = treeH * 0.62; treeCx = Math.min(W - treeW * 0.28, W * 0.78);
      var ww = Math.min(W * 0.5, 330 * Z), wh = ww * 1.12; win = { x: W * 0.06, y: Math.max(H * 0.16, tvY - wh - 40 * Z), w: ww, h: wh };
    } else {
      // the tree in the corner, in front of the couch's far end (beside a side pane it stands partly out of the picture)
      treeH = Math.min(floorY + 26 * Z - Math.max(M + 66 * Z, 92 * Z), 520 * Z); treeW = treeH * 0.64; treeBase = floorY + 26 * Z;
      treeCx = W - treeW * (W < 1000 ? 0.3 : 0.5) - (W < 1000 ? 0 : 10 * Z);
      back = { tree: [treeCx - treeW / 2, treeBase - treeH - 12 * Z, treeW, treeH + 12 * Z], presents: [treeCx - treeW * 0.66, treeBase - 72 * Z, treeW * 1.16, 86 * Z] };
      // forward: nearer the front of the floor, so it stands bigger -- its top still clear of House Status
      fBase = foot - 22 * Z; fH = Math.min(fBase - Math.max(M + 66 * Z, 92 * Z), 640 * Z); fW = fH * 0.64; fCx = W - fW * (W < 1000 ? 0.32 : 0.46);
      // the couch against the back wall, its near end behind the entertainment center and its far end behind the tree
      var cL = ux + uw - 140 * Z, cR = treeCx - treeW * 0.1, cw = Math.min(cR - cL, 560 * Z);
      if (cw > 180 * Z) { var chh = cw * 656 / 1240; couchB = [cL + (cR - cL - cw) / 2, floorY + 18 * Z - chh, cw, chh]; }
      // A BIG PICTURE WINDOW behind it (rule 3, the owner: "a bigger window, so you can see outside"): about 1.4 times
      // the mock-up's, the couch's width and a third, its sill hidden behind the couch's back and, at wide sizes, its
      // top running off the screen's top edge as a photograph would crop it -- clear of House Status at the top right
      var wCx = couchB ? couchB[0] + couchB[2] / 2 : (tvX + tvW + treeCx - treeW / 2) / 2;
      var wBot = couchB ? couchB[1] + couchB[3] * 0.3 : rail;
      // (or, where that leaves it small -- beside a side pane, a phone on its side -- whole, just under House Status)
      var cap = couchB ? couchB[2] * 0.9 : 320 * Z, owA = Math.min(cap, 2 * (W * 0.73 - wCx)), owB = Math.min(couchB ? couchB[2] * 1.05 : 320 * Z, (wBot - M - 46 * Z) * 1160 / 1136);
      var ow = Math.max(owA, owB, 150 * Z);
      if (W >= 1000 && !short && couchB) ow = Math.max(ow, Math.min(ow * 1.4, couchB[2] * 1.34, 2 * (W * 0.76 - wCx)));
      var oh = ow * 1136 / 1160;
      win = { x: wCx - ow / 2 + 20 * Z, y: wBot - oh + 20 * Z, w: ow - 40 * Z, h: oh - 54 * Z };
    }
    data.place = { floorY: floorY, railY: rail, borderY: by, tv: [tvX, tvY, tvW, tvH], stand: [conX, conY, conW, conH],
      window: [win.x - 20 * Z, win.y - 20 * Z, win.w + 40 * Z, win.h + 54 * Z], couch: couchB,
      tree: [treeCx - treeW / 2, treeBase - treeH - 12 * Z, treeW, treeH + 12 * Z], presents: tall ? null : [treeCx - treeW * 0.66, treeBase - 72 * Z, treeW * 1.16, 86 * Z] };
    // the hutch and the harvest stay at the back; the Christmas tree and the balloons come forward
    data.place.treeBack = data.place.tree; data.place.presentsBack = data.place.presents;
    if (!tall) { data.place.tree = [fCx - fW / 2, fBase - fH - 12 * Z, fW, fH + 12 * Z]; data.place.presents = [fCx - fW * 0.66, fBase - 72 * Z, fW * 1.16, 86 * Z]; }
    if (back) { data.place.treeBack = back.tree; data.place.presentsBack = back.presents; }
    data.place.unit = [ux, uy, uw, uh];
    data.place.pile = data.place.presents ? [data.place.presents[0] - data.place.presents[2] * 0.05, data.place.presents[1] - data.place.presents[3] * 1.1, data.place.presents[2] * 1.1, data.place.presents[3] * 2.1] : null;
    // the board's place in the other rooms (the chalkboard, the flip board): the TV's old box
    data.board = [tvX, tvY, tvW, tvH];
    return data;
  }
  // THE HAUNTED HOUSE'S LAYOUT (the mock-up's haunt()): the stone first, the house where it is not, the moon behind
  // the tower, the bare tree, the grounds' band reaching the row, the grass across the stone's foot, the pumpkins
  function haunt(W, H, foot, Z, M) {
    var tall = H > W * 1.05, short = H < 500, data = {};
    var stW = tall ? Math.min(W - 2 * M, 470 * Z) : short ? W * 0.32 : Math.min(W * 0.4, 410 * Z), stBot = foot - 2 * Z,
      stH = Math.min(stW * 1.08, stBot - (tall ? H * 0.4 : short ? H * 0.1 : H * 0.33)), stX = tall ? (W - stW) / 2 : short ? W * 0.32 : M, stY = stBot - stH;
    var hBase = tall ? stY + 30 * Z : foot - (short ? 42 : 112) * Z,
      hs = Math.min(tall ? W / 740 : short ? H / 790 : Z * (W < 1000 ? 0.88 : 1.12), (hBase - Math.max(M * 0.55, 18 * Z)) / 545),
      hx = tall ? W * 0.5 : short ? W * 0.76 : Math.min(W - 290 * hs, stX + stW + 355 * hs);
    var mr = 150 * hs, mx = hx - 130 * hs, my = hBase - 390 * hs;
    var X = function (v) { return hx + v * hs; }, Y = function (v) { return hBase - v * hs; };
    var pump = [];
    (tall ? [[stX - 12 * Z, 25], [stX + stW + 18 * Z, 32]] : [[stX + stW + 54 * Z, 40], [stX + stW + 122 * Z, 26]]).forEach(function (q) {
      var y = foot - q[1] * 0.55 * Z;
      if (q[0] > W - 12 * Z || q[0] < 12 * Z) return;
      pump.push([q[0], y, q[1] * Z]);
    });
    data.place = { horizonY: hBase, house: [X(-282), Y(512), 592 * hs, 512 * hs], moon: [mx - mr, my - mr, mr * 2, mr * 2],
      tree: [hx + (short ? 150 : 215) * hs, Y(330), 240 * hs, 340 * hs], stone: [stX, stY, stW, stH],
      // the painted hilltop is 18.5 % down its band; the band reaches the row along the bottom, however tall the screen
      grounds: (function () { var gh = (foot + 13 * Z - hBase + 22 * hs) / 0.815; return [0, hBase - 22 * hs - 0.185 * gh, W, gh]; })(),
      grass: [0, foot - 34 * Z, W, 46 * Z], pumpkins: pump.map(function (q) { return [q[0] - q[2], q[1] - q[2], q[2] * 2, q[2] * 2]; }) };
    return data;
  }

  // ---------------------------------------------------------------- CHRISTMAS: a 90s living room at night
  var COLS = { red: [0, '255,70,60'], green: [1, '70,220,110'], gold: [2, '255,200,60'], blue: [3, '80,150,255'] };
  function roomReal(c, W, H, Z, d, q) {
    var P = d.place;
    c.clearRect(0, 0, W, H);
    tileAt(c, 'room-wall', 0, 0, W, P.borderY + 2, Z);
    across(c, 'room-wainscot', 0, P.borderY, W, P.floorY - P.borderY);
    tileAt(c, 'room-carpet', 0, P.floorY, W, H - P.floorY, Z);
    // the window: the night view covered into its panes, then its frame and drapes (half-size px of the painting)
    var wr = fitR(REAL['room-window'], P.window), kx = wr[2] / 580, ky = wr[3] / 568, panes = [wr[0] + 90 * kx, wr[1] + 60 * ky, 400 * kx, 380 * ky];
    cover(c, 'room-window-outside', panes);
    c.drawImage(REAL['room-window'], wr[0], wr[1], wr[2], wr[3]);
    d.frame = { img: framed(REAL['room-window'], wr, q), r: wr }; d.win = { x: panes[0], y: panes[1], w: panes[2], h: panes[3] };
    shadowFor(c, 'room-couch', P.couch, Z, true);
    var cr = drawFit(c, 'room-couch', P.couch);
    d.clipBottom = cr ? cr[1] + cr[3] * 0.1 : H;
    shadowFor(c, 'room-tree', P.tree, Z);
    var tr = drawFit(c, 'room-tree', P.tree), k = tr[2] / 1348;
    d.bulbs = POS.treeBulbs.map(function (b) { var col = COLS[b[2]] || COLS.gold; return { x: tr[0] + b[0] * k, y: tr[1] + b[1] * k, r: Math.max(1.6, 9 * k), c: col[0], col: col[1] }; });
    d.glints = d.bulbs.map(function (b) { return [b.x + 18 * k, b.y + 26 * k]; });
    d.star = [tr[0] + tr[2] * 0.5, tr[1] + tr[2] * 0.068, tr[2] * 0.075];
    d.feet = { tree: feetAt('room-tree', P.tree) };
    if (P.pile) { shadowFor(c, 'room-presents-pile', P.pile, Z, false, true); drawFit(c, 'room-presents-pile', P.pile); d.feet.pile = feetAt('room-presents-pile', P.pile); }
    shadowFor(c, 'room-entertainment-center', P.unit, Z, true);
    var un = drawFit(c, 'room-entertainment-center', P.unit), ku = un[2] / 2400;
    d.feet.unit = feetAt('room-entertainment-center', P.unit);
    // the screen in the unit's opening (x 600-1800, y 220-1130 of 2400 x 1600): the TV picture fills it
    d.tv = { x: un[0] + 600 * ku, y: un[1] + 220 * ku, w: 1200 * ku, h: 910 * ku };
    d.unitRect = un;
    // THE GARLAND, the unit's width, along its crown, and its light string -- each bulb found on the swag's lowest solid
    // row in its column, then nudged up into the greenery
    var gim = REAL['room-garland'], gh = un[2] * 520 / 2400;
    c.drawImage(gim, un[0], un[1], un[2], gh);
    var cols4 = ['255,70,60', '70,220,110', '255,200,60', '80,150,255'];
    d.unitBulbs = [];
    try {
      var gw = 240, ghh = 52, gc = document.createElement('canvas'); gc.width = gw; gc.height = ghh;
      var gx = gc.getContext('2d', { willReadFrequently: true }); gx.drawImage(gim, 0, 0, gw, ghh); var ga = gx.getImageData(0, 0, gw, ghh).data;
      for (var gi = 3, n2 = 0; gi < gw - 2; gi += 5, n2++) {
        var gb = -1; for (var gy = ghh - 1; gy >= 0; gy--) if (ga[(gy * gw + gi) * 4 + 3] > 200) { gb = gy; break; }
        if (gb < 4) continue;
        var bx3 = un[0] + (gi + 0.5) / gw * un[2], by3 = un[1] + (gb - 2.2 + (n2 % 2) * 1.2) / ghh * gh;
        if (bx3 < 2) continue;
        d.unitBulbs.push({ x: bx3, y: by3, r: 2.4 * Math.max(Z, 0.6), c: n2 % 4, col: cols4[n2 % 4] });
      }
      gc.width = gc.height = 0;
    } catch (e) { /* a picture that can't be read: the garland without lights */ }
    // the VCR's clock window in the unit (x 1000-1260, y 1290-1360)
    d.vcr = [un[0] + 1000 * ku, un[1] + 1290 * ku, 260 * ku, 70 * ku];
    // the room's light: warm from the tree, the corners falling away, a slight evening dim
    var tx = P.tree[0] + P.tree[2] / 2, ty = P.tree[1] + P.tree[3] * 0.55, warm = c.createRadialGradient(tx, ty, 0, tx, ty, P.tree[3] * 1.15);
    warm.addColorStop(0, 'rgba(255,190,110,.2)'); warm.addColorStop(1, 'rgba(255,190,110,0)'); c.fillStyle = warm; c.fillRect(0, 0, W, H);
    var vg = c.createRadialGradient(W * 0.58, H * 0.55, Math.min(W, H) * 0.25, W * 0.58, H * 0.55, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(10,14,40,.14)'; c.fillRect(0, 0, W, H);
  }
  // ---------------------------------------------------------------- HALLOWEEN: a haunted house on a hill
  function hauntReal(c, c2, W, H, Z, d) {
    var P = d.place;
    c.clearRect(0, 0, W, H); c2.clearRect(0, 0, W, H);
    cover(c, 'haunt-sky', [0, 0, W, H]);
    var m = P.moon, mx = m[0] + m[2] / 2, my = m[1] + m[3] / 2, halo = c.createRadialGradient(mx, my, m[2] * 0.25, mx, my, m[2] * 1.3);
    halo.addColorStop(0, 'rgba(225,215,255,.4)'); halo.addColorStop(1, 'rgba(225,215,255,0)'); c.fillStyle = halo; c.fillRect(0, 0, W, H);
    if (moonImg && moonImg.complete && moonImg.naturalWidth) c.drawImage(moonImg, m[0], m[1], m[2], m[3]);
    drawFit(c, 'haunt-tree', P.tree);
    var hr = drawFit(c, 'haunt-house', P.house), k = hr[2] / 2368;
    c.drawImage(REAL['haunt-house-lit'], hr[0], hr[1], hr[2], hr[3]);
    across(c, 'haunt-grounds', 0, P.grounds[1], W, P.grounds[3]);
    var WIN = POS.hauntWindows;
    d.windows = WIN.windows.map(function (w) { return { x: hr[0] + w.x * k, y: hr[1] + w.y * k, w: w.w * k, h: w.h * k }; });
    d.fig = WIN.figure; var sw = d.windows[WIN.shutter];
    d.shutter = sw ? { x: sw.x, y: sw.y, w: sw.w * 0.62, h: sw.h, img: REAL['haunt-shutter'] } : null;
    d.attic = [hr[0] + hr[2] * 0.5, hr[1] + hr[3] * 0.22];
    // in front of the fog: the stone, the grass at its foot, the pumpkins
    var st = drawFit(c2, 'haunt-stone', P.stone);
    d.stone = st;
    d.feet = { stone: feetAt('haunt-stone', P.stone) };
    across(c2, 'haunt-grass', 0, P.grass[1], W, P.grass[3]);
    d.pumpkins = P.pumpkins.map(function (b, i) { var r = drawFit(c2, i ? 'haunt-pumpkin-small' : 'haunt-pumpkin-large', b); return [r[0] + r[2] / 2, r[1] + r[3] * 0.58, r[2] * 0.34]; });
  }
  // ---------------------------------------------------------------- the rooms' shared back (Thanksgiving)
  function roomBack(c, W, H, Z, d, wall, band, floor, view, frame, q) {
    var P = d.place;
    c.clearRect(0, 0, W, H);
    tileAt(c, wall, 0, 0, W, P.borderY + 2, Z);
    across(c, band, 0, P.borderY, W, P.floorY - P.borderY);
    tileAt(c, floor, 0, P.floorY, W, H - P.floorY, Z);
    var wr = fitR(REAL[frame], P.window), kx = wr[2] / 580, ky = wr[3] / 568, panes = [wr[0] + 90 * kx, wr[1] + 60 * ky, 400 * kx, 380 * ky];
    cover(c, view, panes);
    c.drawImage(REAL[frame], wr[0], wr[1], wr[2], wr[3]);
    d.frame = { img: framed(REAL[frame], wr, q), r: wr }; d.win = { x: panes[0], y: panes[1], w: panes[2], h: panes[3] };
  }
  function mood(c, W, H, at, col, a, dim) {
    var g = c.createRadialGradient(at[0], at[1], 0, at[0], at[1], Math.max(W, H) * 0.55); g.addColorStop(0, 'rgba(' + col + ',' + a + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    var vg = c.createRadialGradient(W * 0.58, H * 0.55, Math.min(W, H) * 0.25, W * 0.58, H * 0.55, Math.max(W, H) * 0.8); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(10,14,40,' + dim + ')'; c.fillRect(0, 0, W, H);
  }
  // ---------------------------------------------------------------- THANKSGIVING: a 90s dining room at dusk
  function thanksReal(c, W, H, Z, d, q) {
    var P = d.place;
    roomBack(c, W, H, Z, d, 'thanks-wall', 'thanks-wainscot', 'thanks-floor', 'thanks-window-outside', 'thanks-window', q);
    // back to front: the hutch against the back wall (the room's original tree place), the harvest at its foot, then
    // the table brought forward -- big, near the front of the floor, the hero -- and the board in front of its near end
    var hb = P.treeBack || P.tree, pb = P.presentsBack || P.presents;
    shadowFor(c, 'thanks-hutch', hb, Z, true);
    drawFit(c, 'thanks-hutch', hb);
    d.feet = { hutch: feetAt('thanks-hutch', hb) };
    if (pb) { var hv = [pb[0] - pb[2] * 0.1, pb[1], pb[2] * 1.2, pb[3]]; shadowFor(c, 'thanks-harvest', hv, Z, false, true); drawFit(c, 'thanks-harvest', hv); }
    var tall = H > W * 1.05, bv = P.tv, foot = P.stand[1] + P.stand[3];
    var tw = tall ? Math.min(W * 0.98, 720 * Z) : Math.min(660 * Z, W - (bv[0] + bv[2] * 0.7) - 4 * Z), th = tw * 656 / 1240;
    var tx = tall ? (W - tw) / 2 : bv[0] + bv[2] * 0.7, tbox = [tx, foot - 4 * Z - th, tw, th];
    shadowFor(c, 'thanks-table', tbox, Z);
    var tr = drawFit(c, 'thanks-table', tbox);
    d.feet.table = feetAt('thanks-table', tbox);
    d.clipBottom = tr ? tr[1] + 2 : H;   // (the candles' tops: the leaves pass behind them)
    var k = tr ? tr[2] / 1240 : 0, T = POS.thanksTable;
    d.candles = tr ? T.candles.map(function (o) { return [tr[0] + o.x * k, tr[1] + o.y * k, 14 * k]; }) : [];
    d.steam = tr ? T.steam.map(function (o) { return [tr[0] + o.x * k, tr[1] + o.y * k, k]; }) : [];
    shadowFor(c, 'thanks-console', P.stand, Z);
    d.boardDrawn = drawFit(c, 'thanks-board', P.tv);       // (flames and steam behind it stay hidden)
    drawFit(c, 'thanks-console', P.stand);
    d.feet.console = feetAt('thanks-console', P.stand);
    mood(c, W, H, [W * 0.62, H * 0.3], '255,170,100', 0.16, 0.1);
  }
  // ---------------------------------------------------------------- NEW YEAR'S: a rooftop party at midnight
  function newyearReal(c, W, H, Z, d, M) {
    var P = d.place, z = Z, skyH = Math.max(W * 900 / 3200 * 0.7, Math.min(P.floorY, H * 0.62)), roofY = P.floorY - 26 * z;
    c.clearRect(0, 0, W, H);
    cover(c, 'ny-sky', [0, 0, W, H]);
    across(c, 'ny-skyline', 0, P.floorY - skyH, W, skyH);
    across(c, 'ny-rooftop', 0, roofY, W, H - roofY + 2);
    // THE STRING LIGHTS, HUNG: one long strand from the board's top right corner to an iron pole on the parapet, and a
    // short run from off the left edge to the board's top left corner -- each a quadratic sag, its bulbs along the curve
    var bv = P.tv, tall = H > W * 1.05, poleX = W - M * 0.7, poleTop = Math.max(bv[1] - (tall ? 150 : 110) * z, M + 60 * z), mz = Math.max(z, 0.6);
    c.strokeStyle = '#141418'; c.lineWidth = 4 * mz; c.lineCap = 'round';
    c.beginPath(); c.moveTo(poleX, roofY + 6 * z); c.lineTo(poleX, poleTop); c.stroke();
    c.fillStyle = '#1c1c22'; c.beginPath(); c.arc(poleX, poleTop, 5 * mz, 0, 7); c.fill();
    /** @type {Array<[number[], number[], number]>} */ var runs = [[[-30 * z, poleTop + 10 * z], [bv[0] + 14 * z, bv[1] + 10 * z], 60 * z], [[bv[0] + bv[2] - 14 * z, bv[1] + 10 * z], [poleX, poleTop + 4 * z], 90 * z]];
    d.bulbs = [];
    runs.forEach(function (r) {
      var a = r[0], b = r[1], cx = (a[0] + b[0]) / 2, cy = Math.max(a[1], b[1]) + r[2] * 2;
      var pt = function (u) { return [(1 - u) * (1 - u) * a[0] + 2 * (1 - u) * u * cx + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * (1 - u) * u * cy + u * u * b[1]]; };
      c.strokeStyle = '#18181c'; c.lineWidth = 1.6 * mz; c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(cx, cy, b[0], b[1]); c.stroke();
      var len = 0, prev = a, /** @type {Array<[number[], number]>} */ pts = [];
      for (var u = 0; u <= 1.0001; u += 0.005) { var p = pt(u); len += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; pts.push([p, len]); }
      var gap = 34 * mz, j = 0;
      for (var dist = gap / 2; dist < len; dist += gap) {
        while (j < pts.length - 1 && pts[j][1] < dist) j++;
        var hit = pts[j][0], bx = hit[0], by = hit[1] + 7 * mz;
        if (bx < -10 || bx > W + 10) continue;
        // a socket on the wire, a round glass globe hanging under it
        c.fillStyle = '#26262b'; c.fillRect(bx - 2 * mz, hit[1], 4 * mz, 5 * mz);
        var g = c.createRadialGradient(bx - 1.5 * z, by - 1.5 * z, 0.5, bx, by, 6 * mz); g.addColorStop(0, '#fffaf0'); g.addColorStop(0.6, '#ffe6b0'); g.addColorStop(1, '#d9a95a');
        c.fillStyle = g; c.beginPath(); c.arc(bx, by, 5 * mz, 0, 7); c.fill();
        d.bulbs.push([bx, by]);
      }
    });
    shadowFor(c, 'ny-balloons', P.tree, Z);
    drawFit(c, 'ny-balloons', P.tree);
    d.feet = { balloons: feetAt('ny-balloons', P.tree) };
    if (P.couch) { shadowFor(c, 'ny-party', P.couch, Z); drawFit(c, 'ny-party', P.couch); d.feet.party = feetAt('ny-party', P.couch); }
    if (P.presents) drawFit(c, 'ny-streamers', [P.presents[0] - P.presents[2] * 0.25, P.presents[1], P.presents[2] * 1.4, P.presents[3]]);
    shadowFor(c, 'ny-crate', P.stand, Z);
    drawFit(c, 'ny-crate', P.stand);
    d.feet.crate = feetAt('ny-crate', P.stand);
    d.horizon = P.floorY - skyH * 0.55;
    d.clipBottom = H; d.win = null;
  }

  // THE PICTURE, painted once per layout: the same scene, size, foot and scale give back the same data
  var last = '', lastData = null;
  function paint(sc, cv, cv2, W, H, foot, Z, M, q) {
    if (!ready(sc)) return null;
    var key = [sc, Math.round(W), Math.round(H), Math.round(foot), Z.toFixed(3), q.toFixed(2)].join();
    if (key === last && lastData && cv.width === Math.round(W * q)) return lastData;
    cv.width = Math.round(W * q); cv.height = Math.round(H * q);
    var c = cv.getContext('2d'); c.setTransform(q, 0, 0, q, 0, 0);
    var data = sc === 'haunt' ? haunt(W, H, foot, Z, M) : room(W, H, foot, Z, M);
    if (sc === 'haunt') {
      if (cv2.width !== cv.width || cv2.height !== cv.height) { cv2.width = cv.width; cv2.height = cv.height; }
      var x2 = cv2.getContext('2d'); x2.setTransform(q, 0, 0, q, 0, 0);
      hauntReal(c, x2, W, H, Z, data);
    } else {
      if (cv2.width) { cv2.width = 0; cv2.height = 0; }
      if (sc === 'room') roomReal(c, W, H, Z, data, q);
      else if (sc === 'thanks') thanksReal(c, W, H, Z, data, q);
      else newyearReal(c, W, H, Z, data, M);
    }
    data.scene = sc; data.foot = foot;
    last = key; lastData = data;
    return data;
  }
  // the pictures let go of (the slide destroyed): what a scene painted stays in the browser's image cache
  function forget() { last = ''; lastData = null; }

  window.hkHolidayScenes = { PIECES: PIECES, load: load, ready: ready, paint: paint, forget: forget,
    _: { room: room, haunt: haunt, fitR: fitR, footOf: footOf, state: function () { return state; } } };
})();
