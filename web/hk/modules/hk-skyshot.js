// hk-skyshot.js -- THE SKY, AS A PICTURE: window.hkSkyShot.render(sky, opts)
// draws what the live sky (hk-sky.js) shows into a small canvas -- for the
// Pre-rendered blur (hk-glass.js), which wears it blurred instead of blurring
// the moving sky live on every frame.
//
// A browser has no way to turn a part of the page into a picture, so this
// draws it again from what the browser says about each piece, and nothing
// else: no class names, no special cases for this or that piece of the sky
// (2026-10-10, replacing a painter that knew the sky's classes, drew every
// piece unturned and flattened the overcast ceiling's tilted plane).
//
//   WHERE: each piece's own transform and every one above it, composed from
//     the browser's computed matrices (DOMMatrix) and checked against the
//     box the browser itself puts on the screen (check.mismatched counts any
//     piece whose sum does not come out). A 3D one (perspective) is drawn on
//     a texture, and each screen pixel it covers is looked up on it through
//     its matrix's inverse -- or, rows staying rows, a row at a time.
//   WHAT: everything shown -- its background (color, pictures, linear,
//     repeating-linear and radial gradients, as CSS lays them out), a canvas,
//     an inline SVG, a box-shadow glow -- under its opacity, filter, mask and
//     blend mode, each applied to the piece and all inside it, in z-order.
//     Only what moves across the scene is left out (bats, a witch, falling
//     leaves): frozen, it would be a smudge where nothing is. The sky says
//     which pieces those are (hkSky.moves(computedStyle), by animation).
//   BY THE BROWSER, NOT BY SCRIPT: every filter (a piece's own, and the
//     look's blur over the whole picture) is applied by the browser, as SVG
//     filter primitives on the canvas made an image; a 3D plane whose rows
//     stay rows is copied a row at a time. The dashboard's script may run
//     without its JIT (WebKit's EnhancedSecurity content process, which a
//     plain-http address gets: ~30x slower), where loops over the pixels
//     cost tens of milliseconds a picture. A group whose inputs have not
//     changed is not drawn again (groupCache).
//   LOUD, NOT WRONG: a value this cannot draw is counted in
//     check.unsupported (by kind), so a new kind of piece in the sky shows up
//     in the stats and the fidelity tool, not as a quietly wrong picture.
//
// Its pure parts are on hkSkyShot._ for the tests (test_skyshot.js); how
// close the whole picture comes to the browser's own blur is measured by
// hk_house/tools/headless/glass_fidelity.py (2026-10-10, 20 sky states:
// every mean difference under 2 of 255, every worst cell under 9).
(function () {
  'use strict';
  if (window.hkSkyShot) return;

  var IMG_MS = 4000, CPU = { willReadFrequently: true };

  // ---------------------------------------------------------------- values
  function splitTop(v, sep) {
    var out = [], d = 0, cur = '';
    sep = sep || ',';
    for (var i = 0; i < v.length; i++) {
      var ch = v[i];
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === sep && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // tokens at the top level, space-separated
  function words(v) { return splitTop(String(v), ' '); }
  // a length -> px; `ref`: what 100% is; vp: the viewport, for vw/vh/vmin/vmax
  function len(v, ref, vp) {
    v = String(v).trim();
    var n = parseFloat(v);
    if (isNaN(n)) return null;
    if (/%$/.test(v)) return n / 100 * ref;
    if (/vmax$/.test(v)) return n / 100 * Math.max(vp.W, vp.H);
    if (/vmin$/.test(v)) return n / 100 * Math.min(vp.W, vp.H);
    if (/vw$/.test(v)) return n / 100 * vp.W;
    if (/vh$/.test(v)) return n / 100 * vp.H;
    if (/(em|rem)$/.test(v)) return n * 16;
    return n;
  }
  var POS_WORD = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
  // a background-position / gradient position -> [x, y] in px inside a box,
  // for an image of size iw x ih (percentages place the image's own point)
  function place(v, w, h, iw, ih, vp) {
    var t = words(v || '0% 0%').map(function (x) { return POS_WORD[x] || x; });
    if (t.length === 1) t.push('50%');
    // a vertical keyword first ("top left") -- swap
    if (/^(top|bottom)$/.test((v || '').split(/\s+/)[0])) t = [t[1], t[0]];
    var px = /%$/.test(t[0]) ? (w - iw) * parseFloat(t[0]) / 100 : len(t[0], w, vp);
    var py = /%$/.test(t[1]) ? (h - ih) * parseFloat(t[1]) / 100 : len(t[1], h, vp);
    return [px || 0, py || 0];
  }
  // background-size -> [iw, ih] of one tile; natural: the image's own size,
  // or null for a gradient (no size of its own: the box)
  function tileSize(v, w, h, nat, vp) {
    v = (v || 'auto').trim();
    if (v === 'cover' || v === 'contain') {
      if (!nat) return [w, h];
      var k = (v === 'cover' ? Math.max : Math.min)(w / nat[0], h / nat[1]);
      return [nat[0] * k, nat[1] * k];
    }
    var t = words(v), a = t[0], b = t[1] || 'auto';
    var iw = a === 'auto' ? null : len(a, w, vp), ih = b === 'auto' ? null : len(b, h, vp);
    if (iw === null && ih === null) return nat ? [nat[0], nat[1]] : [w, h];
    if (iw === null) iw = nat ? nat[0] * ih / nat[1] : w;
    if (ih === null) ih = nat ? nat[1] * iw / nat[0] : h;
    return [iw, ih];
  }
  // a color stop "rgb(1, 2, 3) 10% 20%" -> {color, at: [positions as written]}
  function stopOf(s) {
    var m = /^((?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]+|[a-z]+)\s*(.*)$/i.exec(s.trim());
    if (!m) return null;
    return { color: m[1], at: m[2] ? words(m[2]) : [] };
  }
  // CSS color-stop fixup (css-images-3 §3.5.3) over a line `L` px long ->
  // [{color, p (px)}]: double positions split, missing ends 0 and L, a
  // position before the one before it raised to it, gaps spread evenly
  function resolveStops(stops, L, vp) {
    var out = [];
    stops.forEach(function (s) {
      if (!s.at.length) out.push({ color: s.color, p: null });
      else s.at.forEach(function (a) { out.push({ color: s.color, p: len(a, L, vp) }); });
    });
    if (!out.length) return out;
    if (out[0].p === null) out[0].p = 0;
    if (out[out.length - 1].p === null) out[out.length - 1].p = L;
    var max = -Infinity;
    out.forEach(function (o) { if (o.p !== null) { if (o.p < max) o.p = max; max = o.p; } });
    for (var i = 1; i < out.length; i++) {
      if (out[i].p !== null) continue;
      var j = i; while (out[j].p === null) j++;
      var a = out[i - 1].p, b = out[j].p;
      for (var k = i; k < j; k++) out[k].p = a + (b - a) * (k - i + 1) / (j - i + 1);
      i = j;
    }
    return out;
  }
  // the gradient line of linear-gradient(<direction>) over a w x h box
  var SIDE = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
  function lineOf(dir, w, h) {
    var a;
    if (!dir) a = 180;
    else if (SIDE.hasOwnProperty(dir)) a = SIDE[dir];
    else if (/^to /.test(dir)) {
      // a corner: perpendicular to the diagonal between the other two
      // corners, pointing into the named one
      var sx = /right/.test(dir) ? 1 : -1, sy = /bottom/.test(dir) ? 1 : -1;
      a = Math.atan2(sx * h, -sy * w) * 180 / Math.PI;
    } else {
      var n = parseFloat(dir);
      a = /turn$/.test(dir) ? n * 360 : /grad$/.test(dir) ? n * 0.9 : /rad$/.test(dir) ? n * 180 / Math.PI : n;
    }
    var r = a * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r);
    var L = Math.abs(w * dx) + Math.abs(h * dy);
    return { x0: w / 2 - dx * L / 2, y0: h / 2 - dy * L / 2, x1: w / 2 + dx * L / 2, y1: h / 2 + dy * L / 2, L: L };
  }
  // radial-gradient's prelude -> {cx, cy, rx, ry}
  function radialOf(pre, w, h, vp) {
    var t = words(pre || ''), at = t.indexOf('at');
    var shapeSize = at >= 0 ? t.slice(0, at) : t, pos = at >= 0 ? t.slice(at + 1).join(' ') : '50% 50%';
    var c = place(pos, w, h, 0, 0, vp), cx = c[0], cy = c[1];
    var circle = shapeSize.indexOf('circle') >= 0, lens = [], key = 'farthest-corner';
    shapeSize.forEach(function (x) {
      if (/^(closest|farthest)-(side|corner)$/.test(x)) key = x;
      else if (x !== 'circle' && x !== 'ellipse') lens.push(x);
    });
    if (lens.length === 1 && shapeSize.indexOf('ellipse') < 0) circle = true;
    if (lens.length) {
      var rx = len(lens[0], w, vp), ry = lens.length > 1 ? len(lens[1], h, vp) : rx;
      return { cx: cx, cy: cy, rx: rx, ry: circle ? rx : ry };
    }
    var sx = [Math.abs(cx), Math.abs(w - cx)], sy = [Math.abs(cy), Math.abs(h - cy)];
    var pick = /^closest/.test(key) ? Math.min : Math.max;
    if (/side$/.test(key)) {
      if (circle) { var s = pick(sx[0], sx[1], sy[0], sy[1]); return { cx: cx, cy: cy, rx: s, ry: s }; }
      return { cx: cx, cy: cy, rx: pick(sx[0], sx[1]), ry: pick(sy[0], sy[1]) };
    }
    // a corner: the circle through it, or the ellipse of the sides' ratio
    var X = pick(sx[0], sx[1]), Y = pick(sy[0], sy[1]);
    if (circle) { var d = Math.sqrt(X * X + Y * Y); return { cx: cx, cy: cy, rx: d, ry: d }; }
    return { cx: cx, cy: cy, rx: X * Math.SQRT2, ry: Y * Math.SQRT2 };
  }
  // a gradient's stops as canvas color stops (0..1) over [0, L]; repeating:
  // the stops laid end to end across it
  function colorStops(stops, L, repeating) {
    if (!stops.length || !(L > 0)) return [];
    if (repeating) {
      var p0 = stops[0].p, P = stops[stops.length - 1].p - p0, out = [];
      if (!(P > 0)) return [{ t: 0, color: stops[stops.length - 1].color }, { t: 1, color: stops[stops.length - 1].color }];
      for (var r = p0 - Math.ceil(p0 / P) * P; r < L; r += P) {
        stops.forEach(function (s) { out.push({ t: (s.p - p0 + r) / L, color: s.color }); });
      }
      stops = out.map(function (o) { return { p: o.t * L, color: o.color }; });
    }
    // canvas takes 0..1 only: what lies outside is cut at the ends, the color
    // there interpolated
    var res = [];
    for (var i = 0; i < stops.length; i++) {
      var t = stops[i].p / L;
      if (t < 0 && i + 1 < stops.length && stops[i + 1].p / L > 0) res.push({ t: 0, color: stops[i].color, lerp: [stops[i], stops[i + 1], 0] });
      else if (t >= 0 && t <= 1) res.push({ t: t, color: stops[i].color });
      else if (t > 1 && i > 0 && stops[i - 1].p / L < 1) res.push({ t: 1, color: stops[i].color, lerp: [stops[i - 1], stops[i], 1] });
    }
    if (!res.length) res = [{ t: 0, color: stops[stops.length - 1].color }];
    return premulStops(res);
  }
  // a computed color -> [r, g, b, a] (0..255, a 0..1), or null for one in a
  // form not read here
  function rgbaOf(c) {
    var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(String(c).trim());
    if (!m) return /^transparent$/i.test(String(c).trim()) ? [0, 0, 0, 0] : null;
    var a = m[4] === undefined ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  // CSS GRADIENTS BLEND IN PREMULTIPLIED COLOR, a canvas gradient does not:
  // from a light to transparent black, the canvas's middle is dragged toward
  // black (the sun's glow came out dim). Where the transparency changes
  // between two stops, stops in between carry the premultiplied blend.
  function premulStops(cs) {
    var out = [];
    for (var i = 0; i < cs.length; i++) {
      out.push(cs[i]);
      var b = cs[i + 1];
      if (!b) break;
      var ca = rgbaOf(cs[i].color), cb = rgbaOf(b.color);
      if (!ca || !cb || ca[3] === cb[3] || b.t - cs[i].t <= 0) continue;
      for (var k = 1; k < 8; k++) {
        var f = k / 8, al = ca[3] + (cb[3] - ca[3]) * f, rgb = [0, 1, 2].map(function (j) {
          var pm = ca[j] * ca[3] + (cb[j] * cb[3] - ca[j] * ca[3]) * f;
          return al > 1e-6 ? Math.round(pm / al) : Math.round(ca[3] > cb[3] ? ca[j] : cb[j]);
        });
        out.push({ t: cs[i].t + (b.t - cs[i].t) * f, color: 'rgba(' + rgb.join(',') + ',' + al.toFixed(4) + ')' });
      }
    }
    return out;
  }
  // CSS filter functions -> [{f, v}] (computed values: numbers, deg, px)
  function filtersOf(v) {
    if (!v || v === 'none') return [];
    var out = [], re = /([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/g, m;
    while ((m = re.exec(v))) out.push({ f: m[1], v: m[2].trim() });
    return out;
  }
  // a color-matrix filter as a 4x5 matrix on unpremultiplied RGBA 0..1
  // (filter-effects-1 §13), or null for the ones done otherwise
  function matrixOf(f, v) {
    var a = parseFloat(v), id = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    if (/%$/.test(v)) a /= 100;
    if (isNaN(a)) a = f === 'opacity' || f === 'brightness' || f === 'contrast' || f === 'saturate' ? 1 : 0;
    switch (f) {
      case 'brightness': return [a, 0, 0, 0, 0, 0, a, 0, 0, 0, 0, 0, a, 0, 0, 0, 0, 0, 1, 0];
      case 'contrast': var o = 0.5 - 0.5 * a; return [a, 0, 0, 0, o, 0, a, 0, 0, o, 0, 0, a, 0, o, 0, 0, 0, 1, 0];
      case 'opacity': return [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, a, 0];
      case 'invert': var b = 1 - 2 * a; return [b, 0, 0, 0, a, 0, b, 0, 0, a, 0, 0, b, 0, a, 0, 0, 0, 1, 0];
      case 'saturate': return [0.213 + 0.787 * a, 0.715 - 0.715 * a, 0.072 - 0.072 * a, 0, 0,
                               0.213 - 0.213 * a, 0.715 + 0.285 * a, 0.072 - 0.072 * a, 0, 0,
                               0.213 - 0.213 * a, 0.715 - 0.715 * a, 0.072 + 0.928 * a, 0, 0, 0, 0, 0, 1, 0];
      case 'grayscale': var g = 1 - Math.min(1, a);
        return [0.2126 + 0.7874 * g, 0.7152 - 0.7152 * g, 0.0722 - 0.0722 * g, 0, 0,
                0.2126 - 0.2126 * g, 0.7152 + 0.2848 * g, 0.0722 - 0.0722 * g, 0, 0,
                0.2126 - 0.2126 * g, 0.7152 - 0.7152 * g, 0.0722 + 0.9278 * g, 0, 0, 0, 0, 0, 1, 0];
      case 'sepia': var s = 1 - Math.min(1, a);
        return [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0, 0,
                0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0, 0,
                0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0, 0, 0, 0, 0, 1, 0];
      case 'hue-rotate':
        var d = /rad$/.test(v) ? a : /turn$/.test(v) ? a * 2 * Math.PI : a * Math.PI / 180, c = Math.cos(d), n = Math.sin(d);
        return [0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0, 0,
                0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283, 0, 0,
                0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072, 0, 0, 0, 0, 0, 1, 0];
    }
    return f === 'none' ? id : null;
  }
  // A SHADOW'S VALUE, "<color> dx dy blur [spread]" in either order ->
  // {color, dx, dy, blur, spread}
  function shadowOf(v) {
    var m = /^((?:rgba?|hsla?|color)\([^)]*\)|#[0-9a-f]+|[a-z]+)\s+(.*)$/i.exec(v) || /^(.*?)\s+((?:rgba?|hsla?|color)\([^)]*\)|#[0-9a-f]+)$/i.exec(v);
    if (!m) return null;
    var colorFirst = !/^[-\d.]/.test(m[1]), nums = words(colorFirst ? m[2] : m[1]).filter(function (t) { return t !== 'inset'; }).map(parseFloat);
    return { color: colorFirst ? m[1] : m[2], dx: nums[0] || 0, dy: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, inset: /\binset\b/.test(v) };
  }
  // A CSS FILTER LIST AS SVG FILTER PRIMITIVES (filter-effects-1: each
  // shorthand function's own definition, in sRGB as CSS's are); `scale`:
  // canvas pixels per CSS pixel
  function fmt(v) { return String(Math.round(v * 10000) / 10000); }
  function svgPrims(list, scale, check) {
    var out = [];
    list.forEach(function (f) {
      var cm = matrixOf(f.f, f.v);
      if (cm) { out.push('<feColorMatrix type="matrix" values="' + cm.map(fmt).join(' ') + '"/>'); return; }
      if (f.f === 'blur') { out.push('<feGaussianBlur stdDeviation="' + fmt((parseFloat(f.v) || 0) * scale) + '"/>'); return; }
      if (f.f === 'drop-shadow') {
        var sh = shadowOf(f.v), c = sh && rgbaOf(sh.color);
        if (!sh) return;
        out.push('<feDropShadow dx="' + fmt(sh.dx * scale) + '" dy="' + fmt(sh.dy * scale) + '" stdDeviation="' + fmt(sh.blur * scale / 2) + '" flood-color="' +
                 (c ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : sh.color) + '" flood-opacity="' + (c ? fmt(c[3]) : '1') + '"/>');
        return;
      }
      if (check) check.unsupported['filter:' + f.f] = (check.unsupported['filter:' + f.f] || 0) + 1;
    });
    return out.join('');
  }
  // THE FILTER DRAWN BY THE BROWSER: the canvas as an image inside an SVG
  // that applies it -> a Promise of the filtered canvas. Native code in
  // WebKit (which ignores a canvas's own filter) and Chrome alike. This
  // page's script may run without its JIT -- WebKit's EnhancedSecurity
  // content process, which a plain-http address gets: measured ~30x slower
  // -- where a loop over the pixels cost tens of milliseconds a picture
  // (2026-10-10). `hold`: the picture's edges held (it is the sky to its
  // edges), its edge pixels drawn out that far first -- Chrome does not
  // honor feGaussianBlur's edgeMode.
  function nativeFilter(src, prims, hold) {
    if (!prims) return Promise.resolve(src);
    var W = src.width, H = src.height, P = hold ? Math.ceil(hold) : 0, c = src;
    if (P) {
      c = newCanvas(W + 2 * P, H + 2 * P);
      var x = ctxOf(c);
      x.drawImage(src, P, P);
      x.drawImage(src, 0, 0, 1, H, 0, P, P, H); x.drawImage(src, W - 1, 0, 1, H, P + W, P, P, H);
      x.drawImage(c, 0, P, W + 2 * P, 1, 0, 0, W + 2 * P, P); x.drawImage(c, 0, P + H - 1, W + 2 * P, 1, 0, P + H, W + 2 * P, P);
    }
    var url, cw = c.width, ch = c.height;
    try { url = c.toDataURL('image/png'); } catch (e) { return Promise.resolve(src); }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + cw + '" height="' + ch + '">' +
      '<filter id="f" filterUnits="userSpaceOnUse" x="0" y="0" width="' + cw + '" height="' + ch + '" color-interpolation-filters="sRGB">' + prims + '</filter>' +
      '<image width="' + cw + '" height="' + ch + '" href="' + url + '" xlink:href="' + url + '" filter="url(#f)"/></svg>';
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { var o = newCanvas(W, H); ctxOf(o).drawImage(im, -P, -P); res(o); };
      im.onerror = function () { res(src); };     // unfiltered rather than nothing
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ------------------------------------------------------------- geometry
  function mat(v) { try { return new DOMMatrix(v); } catch (e) { return null; } }
  // a local point through a 4x4 matrix onto the screen; null behind the eye
  function project(m, x, y) {
    var w = m.m14 * x + m.m24 * y + m.m44;
    if (!(w > 1e-6)) return null;
    return [(m.m11 * x + m.m21 * y + m.m41) / w, (m.m12 * x + m.m22 * y + m.m42) / w];
  }
  function affine(m) { return Math.abs(m.m14) < 1e-9 && Math.abs(m.m24) < 1e-9 && Math.abs(m.m44 - 1) < 1e-9; }
  // A 3D PIECE'S HOMOGRAPHY: its matrix (local x, y on its plane -> the
  // screen) as 3x3, and back. Each pixel the plane covers is looked up on
  // its texture through the inverse -- exact, and the same in every browser
  // (laid down cell by cell, WebKit softened each cell's edges and the sky
  // showed through the seams as streaks).
  function homography(m) { return [m.m11, m.m21, m.m41, m.m12, m.m22, m.m42, m.m14, m.m24, m.m44]; }
  function inv3(a) {
    var A = a[4] * a[8] - a[5] * a[7], B = a[5] * a[6] - a[3] * a[8], C = a[3] * a[7] - a[4] * a[6];
    var det = a[0] * A + a[1] * B + a[2] * C;
    if (Math.abs(det) < 1e-12) return null;
    var r = 1 / det;
    return [A * r, (a[2] * a[7] - a[1] * a[8]) * r, (a[1] * a[5] - a[2] * a[4]) * r,
            B * r, (a[0] * a[8] - a[2] * a[6]) * r, (a[2] * a[3] - a[0] * a[5]) * r,
            C * r, (a[1] * a[6] - a[0] * a[7]) * r, (a[0] * a[4] - a[1] * a[3]) * r];
  }
  // a screen point back onto the plane; null where the plane is not
  function unproject(hi, X, Y) {
    var w = hi[6] * X + hi[7] * Y + hi[8];
    if (Math.abs(w) < 1e-12) return null;
    return [(hi[0] * X + hi[1] * Y + hi[2]) / w, (hi[3] * X + hi[4] * Y + hi[5]) / w];
  }
  // the texture `src` (RGBA, tw x th, of the plane's extent at ts) laid on
  // `dst` (RGBA, dw x dh, at dx0, dy0 on the screen) through `hi`
  function layPlane(src, tw, th, ext, ts, hi, h, dst, dw, dh, dx0, dy0) {
    var e0 = ext[0], e1 = ext[1];
    for (var y = 0; y < dh; y++) {
      var Y = dy0 + y + 0.5;
      for (var x = 0; x < dw; x++) {
        var X = dx0 + x + 0.5, w = hi[6] * X + hi[7] * Y + hi[8];
        if (w > -1e-12 && w < 1e-12) continue;
        var lx = (hi[0] * X + hi[1] * Y + hi[2]) / w, ly = (hi[3] * X + hi[4] * Y + hi[5]) / w;
        // in front of the eye only: the forward map's w for that point
        if (!(h[6] * lx + h[7] * ly + h[8] > 1e-6)) continue;
        var u = (lx - e0) * ts - 0.5, v = (ly - e1) * ts - 0.5;
        if (u < -0.5 || v < -0.5 || u > tw - 0.5 || v > th - 0.5) continue;
        var u0 = u < 0 ? 0 : u | 0, v0 = v < 0 ? 0 : v | 0;
        if (u0 > tw - 1) u0 = tw - 1; if (v0 > th - 1) v0 = th - 1;
        var u1 = u0 + 1 < tw ? u0 + 1 : u0, v1 = v0 + 1 < th ? v0 + 1 : v0;
        var fu = u - u0, fv = v - v0; fu = fu < 0 ? 0 : fu > 1 ? 1 : fu; fv = fv < 0 ? 0 : fv > 1 ? 1 : fv;
        var w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
        var i00 = (v0 * tw + u0) * 4, i10 = (v0 * tw + u1) * 4, i01 = (v1 * tw + u0) * 4, i11 = (v1 * tw + u1) * 4;
        var a00 = src[i00 + 3] * w00, a10 = src[i10 + 3] * w10, a01 = src[i01 + 3] * w01, a11 = src[i11 + 3] * w11, a = a00 + a10 + a01 + a11;
        if (a <= 0) continue;
        var o = (y * dw + x) * 4;
        dst[o] = (src[i00] * a00 + src[i10] * a10 + src[i01] * a01 + src[i11] * a11) / a;
        dst[o + 1] = (src[i00 + 1] * a00 + src[i10 + 1] * a10 + src[i01 + 1] * a01 + src[i11 + 1] * a11) / a;
        dst[o + 2] = (src[i00 + 2] * a00 + src[i10 + 2] * a10 + src[i01 + 2] * a01 + src[i11 + 2] * a11) / a;
        dst[o + 3] = a;
      }
    }
  }


  // ---------------------------------------------------------------- images
  var cache = new Map();
  function loadImg(u) {
    if (cache.has(u)) { var hit = cache.get(u); cache.delete(u); cache.set(u, hit); return hit; }
    // a picture that did not come is not remembered: asked for again next time
    var p = new Promise(function (res) {
      var i = new Image(), t = setTimeout(function () { cache.delete(u); res(null); }, IMG_MS);
      i.onload = function () { clearTimeout(t); res(i); };
      i.onerror = function () { clearTimeout(t); cache.delete(u); res(null); };
      i.src = u;
    });
    cache.set(u, p);
    while (cache.size > 160) cache.delete(cache.keys().next().value);
    return p;
  }
  function urlOf(layer) { return layer.slice(4, -1).replace(/^["']|["']$/g, ''); }

  // ------------------------------------------------------------- settling
  // THE SKY AS IT WILL BE, NOT HALF-WAY THERE (opts.settle, ms). A change
  // fades in -- a new song's cover (1.2 s), the scrim (4 s), the light -- and
  // a computed style mid-fade is the fade's current frame: a picture taken
  // then kept that frame (the pills wore the last song's wash), and waiting
  // for the fades to end kept the old picture on for seconds. So a fade
  // ending within `ahead` is read at its END (the transition's own last
  // keyframe), and the picture is right from the moment the change is said.
  // A slower one (the stars' 6 s, the clouds' 9 s, dusk's 20 s) is read as
  // it is now and counted (check.unsettled): its end is painted when it is
  // reached, never seconds ahead of the sky. check.ahead: the longest fade
  // read at its end, still to run (the glass fades with it).
  function settling(sky, ahead, check) {
    var ends = new Map();
    if (!sky.getAnimations || typeof CSSTransition === 'undefined') return ends;
    var list;
    try { list = sky.getAnimations({ subtree: true }); } catch (e) { return ends; }
    list.forEach(function (an) {
      if (!(an instanceof CSSTransition) || an.playState !== 'running' || !an.effect || !an.effect.target) return;
      if (an.effect.pseudoElement) return;           // pieces are elements: a pseudo-element is never drawn here
      var tm = an.effect.getComputedTiming(), left = (tm.endTime || 0) - (an.currentTime || 0);
      if (!(left > 0)) return;
      if (left > ahead) { check.unsettled++; return; }
      var kf = an.effect.getKeyframes(), last = kf[kf.length - 1];
      if (!last) return;
      var el = an.effect.target, o = ends.get(el) || {};
      Object.keys(last).forEach(function (k) {
        if (k !== 'offset' && k !== 'computedOffset' && k !== 'easing' && k !== 'composite' && last[k] != null) o[k] = String(last[k]);
      });
      ends.set(el, o);
      check.ahead = Math.max(check.ahead, Math.round(left));
    });
    return ends;
  }
  // a computed style with some of its values at their ends
  function asSettled(cs, end) {
    return new Proxy(cs, { get: function (t, k) {
      if (typeof k === 'string' && Object.prototype.hasOwnProperty.call(end, k)) return end[k];
      var v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    } });
  }

  // -------------------------------------------------------------- collect
  // THE PAINT TREE: what each shown piece is, where (its matrix to the
  // screen, `m`), how (opacity, filter, mask, blend), read now -- a computed
  // style is live -- with its children in paint order (z-index).
  // UNDER CSS `zoom` (a car dashboard: tesla-viewport.js zooms the whole
  // document, 0.67 in a Tesla) a piece's offsets and sizes are in the page's
  // own units while the screen is Z times smaller: the tree starts at a
  // scale of Z, and whatever is read off getBoundingClientRect (in screen
  // pixels) is taken back into the page's units. Without it the picture drew
  // the sky 1.5x too big and no pictured pill lined up (2026-10-13; 37 of 38
  // pieces "mismatched", 1200 vs 804).
  function collect(sky, vp, moves, check, ahead, Z) {
    Z = Z || 1;
    var urls = {}, ends = ahead ? settling(sky, ahead, check) : null;
    function want(list) { list.forEach(function (l) { if (l.indexOf('url(') === 0) urls[urlOf(l)] = 1; }); }
    function offsetIn(el, parent) {
      if (el.offsetParent === parent) return [el.offsetLeft, el.offsetTop];
      if (parent && el.offsetParent && el.offsetParent === parent.offsetParent) return [el.offsetLeft - parent.offsetLeft, el.offsetTop - parent.offsetTop];
      var a = el.getBoundingClientRect(), b = parent.getBoundingClientRect();
      check.offsets++;
      return [(a.left - b.left) / Z, (a.top - b.top) / Z];
    }
    function node(el, parent, parentM) {
      var cs = getComputedStyle(el), end = ends && ends.get(el);
      if (end) cs = asSettled(cs, end);
      if (cs.display === 'none') return null;
      var op = parseFloat(cs.opacity);
      if (!(op > 0.004)) return null;
      if (moves && el !== sky && moves(cs)) return null;
      var svg = el.namespaceURI === 'http://www.w3.org/2000/svg';
      var w, h, off;
      if (svg) { var r = el.getBoundingClientRect(); w = r.width / Z; h = r.height / Z; off = parent ? offsetIn(el, parent.el) : [r.left / Z, r.top / Z]; }
      else { w = el.offsetWidth; h = el.offsetHeight; off = parent ? offsetIn(el, parent.el) : (function () { var rr = el.getBoundingClientRect(); return [rr.left / Z, rr.top / Z]; })(); }
      // the piece's own matrix, about its transform-origin, after its offset
      var local = new DOMMatrix().translate(off[0], off[1]);
      if (cs.transform && cs.transform !== 'none') {
        var o = words(cs.transformOrigin).map(function (x) { return parseFloat(x) || 0; }), t = mat(cs.transform);
        if (t) local = local.translate(o[0], o[1], o[2] || 0).multiply(t).translate(-o[0], -o[1], -(o[2] || 0));
        else check.unsupported['transform'] = (check.unsupported['transform'] || 0) + 1;
      }
      ['translate', 'rotate', 'scale'].forEach(function (k) { if (cs[k] && cs[k] !== 'none') check.unsupported[k] = (check.unsupported[k] || 0) + 1; });
      var m = parentM.multiply(local);
      // `local` kept as read: a piece's matrix from its parent is never got
      // back by inverting a 3D one (WebKit's inverse of the tilted ceiling's
      // matrix came out wrong enough to shrink the clouds on it)
      var n = { el: el, w: w, h: h, m: m, local: local, op: op, vis: cs.visibility === 'visible', z: cs.position !== 'static' && cs.zIndex !== 'auto' ? parseInt(cs.zIndex, 10) || 0 : 0,
                filters: filtersOf(cs.filter), blend: cs.mixBlendMode || 'normal', kids: [] };
      // its own paint
      if (n.vis && !svg) {
        n.color = cs.backgroundColor && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor) ? cs.backgroundColor : '';
        n.bg = cs.backgroundImage && cs.backgroundImage !== 'none' ? splitTop(cs.backgroundImage) : [];
        n.bgSize = splitTop(cs.backgroundSize); n.bgPos = splitTop(cs.backgroundPosition); n.bgRep = splitTop(cs.backgroundRepeat);
        want(n.bg);
        n.radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
        n.shadow = cs.boxShadow && cs.boxShadow !== 'none' ? splitTop(cs.boxShadow) : [];
        if (el.tagName === 'CANVAS') n.canvas = el;
        if (el.tagName === 'IMG' && el.complete) n.img = el;
      }
      var mi = cs.maskImage || cs.webkitMaskImage;
      if (mi && mi !== 'none') {
        n.mask = { list: splitTop(mi), size: splitTop(cs.maskSize || cs.webkitMaskSize || 'auto'),
                   pos: splitTop(cs.maskPosition || cs.webkitMaskPosition || '0% 0%'), rep: splitTop(cs.maskRepeat || cs.webkitMaskRepeat || 'repeat') };
        want(n.mask.list);
      }
      if (svg && el.tagName.toLowerCase() === 'svg') {
        // an inline SVG, drawn as the image of itself -- with room round it
        // when it lets its drawing spill past its box (overflow: visible; the
        // pumpkins' pools of light ran off the right edge of theirs)
        var clone = el.cloneNode(true), M = cs.overflow === 'visible' || cs.overflowX === 'visible' ? 0.5 : 0;
        var vb = el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width ? el.viewBox.baseVal : { x: 0, y: 0, width: w, height: h };
        if (M) clone.setAttribute('viewBox', [vb.x - vb.width * M, vb.y - vb.height * M, vb.width * (1 + 2 * M), vb.height * (1 + 2 * M)].join(' '));
        clone.setAttribute('width', w * (1 + 2 * M)); clone.setAttribute('height', h * (1 + 2 * M));
        n.svgM = M;
        if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        n.svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
        urls[n.svgUrl] = 1;
      } else if (!svg) {
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) { var k = node(kids[i], n, m); if (k) n.kids.push(k); }
        // paint order: z-index, then the order in the page
        n.kids.forEach(function (k, idx) { k.idx = idx; });
        n.kids.sort(function (a, b) { return a.z - b.z || a.idx - b.idx; });
      }
      // THE SUM CHECKED against where the browser put it
      if (w * h > 0) {
        check.pieces++;
        var r2 = el.getBoundingClientRect(), bb = bbox(m, 0, 0, w, h);
        // within 2 px, or 0.2% of its size (a tilted plane runs thousands of
        // pixels off the screen; the browser rounds its offsets to whole ones)
        var tol = 2 + 0.002 * Math.max(r2.width, r2.height);
        if (bb && (Math.abs(bb[0] - r2.left) > tol || Math.abs(bb[1] - r2.top) > tol || Math.abs(bb[2] - r2.right) > tol || Math.abs(bb[3] - r2.bottom) > tol)) {
          check.mismatched++;
          if (check.where.length < 6) check.where.push((el.className && el.className.baseVal === undefined ? String(el.className) : el.tagName) + ' ' +
            bb.map(Math.round).join(',') + ' vs ' + [r2.left, r2.top, r2.right, r2.bottom].map(Math.round).join(','));
        }
      }
      return n;
    }
    var tree = node(sky, null, new DOMMatrix().scale(Z, Z));
    return { tree: tree, urls: Object.keys(urls) };
  }
  function bbox(m, x, y, w, h) {
    var pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(function (p) { return project(m, p[0], p[1]); });
    if (pts.some(function (p) { return !p; })) return null;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }

  // ----------------------------------------------------------------- draw
  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  // smoothing at its best: a large picture made 6x smaller came out
  // speckled in WebKit at its default quality (the trees' bark)
  function ctxOf(c) { var x = c.getContext('2d', CPU); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; return x; }
  // the piece's border box as a path (its rounding: 50% = an ellipse)
  function boxPath(x, n) {
    x.beginPath();
    var r = n.radius || [], w = n.w, h = n.h;
    var rad = r.map(function (v) { var t = words(v || '0'); return [len(t[0], w, VP) || 0, len(t[1] || t[0], h, VP) || 0]; });
    if (rad.every(function (q) { return q[0] >= w / 2 - 0.5 && q[1] >= h / 2 - 0.5; })) { x.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI); return; }
    if (rad.some(function (q) { return q[0] > 0 || q[1] > 0; }) && x.roundRect) { x.roundRect(0, 0, w, h, rad.map(function (q) { return Math.min(q[0], q[1]); })); return; }
    x.rect(0, 0, w, h);
  }
  var VP = { W: 0, H: 0 };
  // one background (or mask) layer, in the piece's own coordinates
  function drawLayer(x, layer, n, size, pos, rep, imgs, check) {
    var w = n.w, h = n.h, img = null, nat = null, grad = null;
    if (layer.indexOf('url(') === 0) { img = imgs[urlOf(layer)]; if (!img) return; nat = [img.naturalWidth || img.width, img.naturalHeight || img.height]; if (!nat[0] || !nat[1]) return; }
    else {
      var gm = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/.exec(layer);
      if (!gm) { var kind = (/^([a-z-]+)\(/.exec(layer) || [, 'other'])[1]; check.unsupported[kind] = (check.unsupported[kind] || 0) + 1; return; }
      grad = { rep: !!gm[1], kind: gm[2], args: splitTop(gm[3]) };
    }
    var ts = tileSize(size, w, h, nat, VP), iw = ts[0], ih = ts[1];
    if (!(iw > 0.5 && ih > 0.5)) return;
    var at = place(pos, w, h, iw, ih, VP);
    var rr = words(rep || 'repeat'); if (rr.length === 1) rr = rr[0] === 'repeat-x' ? ['repeat', 'no-repeat'] : rr[0] === 'repeat-y' ? ['no-repeat', 'repeat'] : [rr[0], rr[0]];
    var repX = rr[0] !== 'no-repeat', repY = rr[1] !== 'no-repeat';
    x.save();
    x.beginPath(); x.rect(0, 0, w, h); x.clip();
    if (grad && !repX && !repY) {
      // one gradient: straight onto the piece
      x.translate(at[0], at[1]); paintGradient(x, grad, iw, ih, check); x.restore();
      return;
    }
    var tile = img;
    if (grad) {
      // a repeated gradient: drawn once at the size the screen needs, then laid
      var T = x.getTransform(), ds = Math.max(1 / 64, Math.min(1, 2 * Math.sqrt(Math.abs(T.a * T.d - T.b * T.c))));
      tile = newCanvas(iw * ds, ih * ds);
      var tx = ctxOf(tile); tx.scale(tile.width / iw, tile.height / ih);
      paintGradient(tx, grad, iw, ih, check);
    }
    var x0 = at[0], y0 = at[1];
    if (repX) x0 -= Math.ceil(x0 / iw) * iw;
    if (repY) y0 -= Math.ceil(y0 / ih) * ih;
    var count = (repX ? Math.ceil((w - x0) / iw) : 1) * (repY ? Math.ceil((h - y0) / ih) : 1);
    if (count > 400) { check.unsupported['tiles'] = (check.unsupported['tiles'] || 0) + 1; x.restore(); return; }
    for (var yy = y0; repY ? yy < h : yy === y0; yy += ih)
      for (var xx = x0; repX ? xx < w : xx === x0; xx += iw) x.drawImage(tile, xx, yy, iw, ih);
    x.restore();
  }
  function paintGradient(x, g, w, h, check) {
    var args = g.args.slice(), cg;
    if (g.kind === 'linear') {
      var dir = args.length && !stopOf(args[0]) || (args.length && /^(to |-?[\d.]+(deg|turn|rad|grad))/.test(args[0])) ? args.shift() : null;
      var line = lineOf(dir, w, h);
      var stops = resolveStops(args.map(stopOf).filter(Boolean), line.L, VP);
      cg = x.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
      colorStops(stops, line.L, g.rep).forEach(function (s) { try { cg.addColorStop(Math.max(0, Math.min(1, s.t)), s.color); } catch (e) { check.unsupported['color'] = (check.unsupported['color'] || 0) + 1; } });
      x.fillStyle = cg; x.fillRect(0, 0, w, h);
      return;
    }
    var pre = args.length && /^(circle|ellipse|closest|farthest|at\b|[-\d.])/.test(args[0]) ? args.shift() : '';
    var R = radialOf(pre, w, h, VP);
    if (!(R.rx > 0 && R.ry > 0)) return;
    var rs = resolveStops(args.map(stopOf).filter(Boolean), R.rx, VP);
    x.save();
    x.translate(R.cx, R.cy); x.scale(1, R.ry / R.rx);
    cg = x.createRadialGradient(0, 0, 0, 0, 0, R.rx);
    colorStops(rs, R.rx, g.rep).forEach(function (s) { try { cg.addColorStop(Math.max(0, Math.min(1, s.t)), s.color); } catch (e) { check.unsupported['color'] = (check.unsupported['color'] || 0) + 1; } });
    x.fillStyle = cg;
    x.fillRect(-R.cx, -R.cy * R.rx / R.ry, w, h * R.rx / R.ry);
    x.restore();
  }
  // a box-shadow glow (outer ones), under the piece
  function drawShadows(x, n, k) {
    n.shadow.forEach(function (v) {
      var sh = shadowOf(v);
      if (!sh || sh.inset) return;
      // the shape drawn far off and only its shadow brought back: a shadow's
      // offset and blur are in canvas pixels, whatever the transform
      var T = x.getTransform(), B = 100000;
      x.save();
      x.shadowColor = sh.color; x.shadowBlur = sh.blur * k;
      x.shadowOffsetX = T.a * B + (T.a * sh.dx + T.c * sh.dy); x.shadowOffsetY = T.b * B + (T.b * sh.dx + T.d * sh.dy);
      x.translate(-B, 0);
      x.translate(-sh.spread, -sh.spread);
      boxPath(x, { w: n.w + 2 * sh.spread, h: n.h + 2 * sh.spread, radius: n.radius });
      x.fillStyle = '#000'; x.fill();
      x.restore();
    });
  }
  // the piece's own paint, in its own coordinates (x already transformed)
  function ownPaint(x, n, imgs, check, k) {
    if (!n.vis) return;
    if (n.shadow && n.shadow.length) drawShadows(x, n, k);
    x.save();
    boxPath(x, n); x.clip();
    if (n.color) { x.fillStyle = n.color; x.fillRect(0, 0, n.w, n.h); }
    for (var i = (n.bg || []).length - 1; i >= 0; i--)
      drawLayer(x, n.bg[i], n, n.bgSize[i] || n.bgSize[0], n.bgPos[i] || n.bgPos[0], n.bgRep[i] || n.bgRep[0], imgs, check);
    if (n.canvas) { try { x.drawImage(n.canvas, 0, 0, n.w, n.h); } catch (e) { /* not readable */ } }
    if (n.img) { try { x.drawImage(n.img, 0, 0, n.w, n.h); } catch (e) { /* not readable */ } }
    x.restore();
    // an SVG's drawing is not cut to its box when it lets it spill over
    if (n.svgUrl && imgs[n.svgUrl]) {
      var M = n.svgM || 0;
      if (!M) { x.save(); boxPath(x, n); x.clip(); }
      x.drawImage(imgs[n.svgUrl], -n.w * M, -n.h * M, n.w * (1 + 2 * M), n.h * (1 + 2 * M));
      if (!M) x.restore();
    }
  }
  var SCALE_K = 1 / 6;
  // a piece and all inside it onto `x` (a canvas of the screen at scale k,
  // or a 3D piece's texture: `base` maps the piece's parent to it)
  function paints(n) { return !!(n.vis && (n.color || (n.bg && n.bg.length) || n.canvas || n.img || n.svgUrl || (n.shadow && n.shadow.length))); }
  // each in turn: a Promise of all done, in order
  function seq(list, fn) { return list.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve()); }
  // -> a Promise, done when the piece is on `x` (a native filter answers later)
  function paint(x, n, base, imgs, check, k, alpha) {
    if (alpha === undefined) alpha = 1;
    var m = base.multiply(n.local);
    if (!affine(m)) return paint3d(x, n, m, imgs, check, k, alpha);
    var scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    // OPACITY ALONE NEEDS A GROUP only where two painted things inside it
    // could overlap: with one (a cloud: its node and its picture), the same
    // opacity on that one is the same picture
    var group = n.filters.length || n.mask || n.blend !== 'normal' || (n.op < 1 && n.painters > 1);
    if (!group) {
      var a = alpha * n.op;
      if (paints(n) && a > 0.004) {
        x.save(); x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); x.globalAlpha = a;
        ownPaint(x, n, imgs, check, scale);
        x.restore();
      }
      return seq(n.kids, function (kid) { return paint(x, kid, m, imgs, check, k, a); });
    }
    // A GROUP WORKS IN ITS OWN BOX on the canvas (and what its filter spreads
    // round it), not the whole canvas
    var W = x.canvas.width, H = x.canvas.height, bb = subtreeBox(n, m), pad = Math.ceil(spreadOf(n) * scale) + 2;
    var X0 = 0, Y0 = 0, X1 = W, Y1 = H;
    if (bb) { X0 = Math.max(0, Math.floor(bb[0]) - pad); Y0 = Math.max(0, Math.floor(bb[1]) - pad); X1 = Math.min(W, Math.ceil(bb[2]) + pad); Y1 = Math.min(H, Math.ceil(bb[3]) + pad); }
    if (X1 <= X0 || Y1 <= Y0) return Promise.resolve();
    var lay = function (c) {
      x.save();
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalAlpha = n.op * alpha;
      if (n.blend !== 'normal') x.globalCompositeOperation = n.blend;
      x.drawImage(c, X0, Y0);
      x.restore();
    };
    // A GROUP WHOSE INPUTS ARE THE SAME AS LAST TIME is the same picture: its
    // finished pixels are kept (the scenery under the scene's light, redone
    // on every paint, was most of one on a Mac)
    var key = sigOf(n, m, imgs), kept = key && groupCache.get(n.el);
    if (kept && kept.key === key && kept.x0 === X0 && kept.y0 === Y0 && kept.c.width === X1 - X0 && kept.c.height === Y1 - Y0) {
      check.reused++;
      lay(kept.c);
      return Promise.resolve();
    }
    var gc = newCanvas(X1 - X0, Y1 - Y0), gx = ctxOf(gc), G = new DOMMatrix().translate(-X0, -Y0).multiply(m);
    if (paints(n)) { gx.save(); gx.setTransform(G.a, G.b, G.c, G.d, G.e, G.f); ownPaint(gx, n, imgs, check, scale); gx.restore(); }
    return seq(n.kids, function (kid) { return paint(gx, kid, G, imgs, check, k, 1); }).then(function () {
      // the group's own effects, kept finished (opacity and blending are
      // applied as it is laid on, and so stay out of what is kept)
      return finishGroup(gc, n, G, imgs, check, scale);
    }).then(function (done) {
      if (key) groupCache.set(n.el, { key: key, c: done, x0: X0, y0: Y0 });
      lay(done);
    });
  }
  // what a group is drawn from, as a string -- null if anything inside it
  // can change with nothing here saying so (a canvas, an image element)
  var groupCache = new Map();
  function sigOf(n, m, imgs) {
    if (n.canvas || n.img) return null;
    // nor one drawn with a picture missing (still loading, or failed)
    var need = (n.bg || []).concat(n.mask ? n.mask.list : []).filter(function (l) { return l.indexOf('url(') === 0; }).map(urlOf);
    if (n.svgUrl) need.push(n.svgUrl);
    for (var q = 0; q < need.length; q++) if (!imgs[need[q]]) return null;
    var parts = [[m.a, m.b, m.c, m.d, m.e, m.f].map(function (v) { return Math.round(v * 100) / 100; }).join(','), n.w, n.h,
                 n.vis, n.color || '', (n.bg || []).join('|'), (n.bgSize || []).join('|'), (n.bgPos || []).join('|'), (n.bgRep || []).join('|'),
                 (n.shadow || []).join('|'), JSON.stringify(n.filters), n.mask ? JSON.stringify(n.mask) : '', n.blend, n.svgUrl || '', n.radius ? n.radius.join(',') : ''];
    for (var i = 0; i < n.kids.length; i++) {
      var km = m.multiply(n.kids[i].local);
      if (!affine(km)) return null;
      var ks = sigOf(n.kids[i], km, imgs);
      if (ks === null) return null;
      parts.push('[' + n.kids[i].op + ':' + ks + ']');
    }
    return parts.join(';');
  }
  // the box on the canvas a piece and all inside it cover (null: a 3D one
  // inside, take the whole canvas)
  function subtreeBox(n, m) {
    var b = n.w * n.h > 0 ? bbox(m, -n.w * (n.svgM || 0), -n.h * (n.svgM || 0), n.w * (1 + 2 * (n.svgM || 0)), n.h * (1 + 2 * (n.svgM || 0))) : null;
    if (n.w * n.h > 0 && !b) return null;
    if (b && n.shadow && n.shadow.length) { var sp = shadowReach(n) * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); b = [b[0] - sp, b[1] - sp, b[2] + sp, b[3] + sp]; }
    for (var i = 0; i < n.kids.length; i++) {
      var km = m.multiply(n.kids[i].local);
      if (!affine(km)) return null;
      var kb = subtreeBox(n.kids[i], km);
      if (kb === null && n.kids[i].w * n.kids[i].h > 0) return null;
      if (kb) b = b ? [Math.min(b[0], kb[0]), Math.min(b[1], kb[1]), Math.max(b[2], kb[2]), Math.max(b[3], kb[3])] : kb;
    }
    return b;
  }
  // how far a piece's own filter spreads its group (blur, drop-shadow), and a
  // box-shadow round its box, in its own units
  function spreadOf(n) {
    var r = 0;
    n.filters.forEach(function (f) {
      var nums = (f.v.match(/-?[\d.]+px/g) || []).map(parseFloat);
      if (f.f === 'blur') r += 3 * (nums[0] || 0);
      if (f.f === 'drop-shadow') r += Math.abs(nums[0] || 0) + Math.abs(nums[1] || 0) + 3 * (nums[2] || 0);
    });
    return r;
  }
  function shadowReach(n) {
    var r = 0;
    (n.shadow || []).forEach(function (s) { var nums = (s.match(/-?[\d.]+px/g) || []).map(function (v) { return Math.abs(parseFloat(v)); }); r = Math.max(r, (nums[0] || 0) + (nums[1] || 0) + 2 * (nums[2] || 0) + (nums[3] || 0)); });
    return r;
  }
  // a group's own effects -- filter (by the browser), then mask; opacity and
  // blending as it is laid on (the CSS order) -> a Promise of the canvas
  function finishGroup(gc, n, m, imgs, check, scale) {
    var tg = performance.now();
    check.groups++;
    return nativeFilter(gc, n.filters.length ? svgPrims(n.filters, scale || 1, check) : '', 0).then(function (c) {
      if (n.mask) {
        var W = c.width, H = c.height, mc = newCanvas(W, H), mx = ctxOf(mc), cx = ctxOf(c);
        mx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        for (var i = n.mask.list.length - 1; i >= 0; i--)
          drawLayer(mx, n.mask.list[i], n, n.mask.size[i] || n.mask.size[0], n.mask.pos[i] || n.mask.pos[0], n.mask.rep[i] || n.mask.rep[0], imgs, check);
        cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mc, 0, 0); cx.restore();
      }
      check.ms.groups = (check.ms.groups || 0) + (performance.now() - tg);
      return c;
    });
  }
  // A 3D PIECE (a perspective in its matrix): it and all inside it drawn flat
  // on a texture in its own coordinates, then laid on the screen
  function paint3d(x, n, m, imgs, check, k, alpha) {
    var tp = performance.now(), ext = n.extent || [0, 0, n.w, n.h];
    var ew = ext[2] - ext[0], eh = ext[3] - ext[1];
    var ts = Math.min(k * 1.5, 1024 / Math.max(ew, eh, 1));
    var tex = newCanvas(ew * ts, eh * ts), tc = ctxOf(tex);
    var flat = new DOMMatrix().scale(ts, ts).translate(-ext[0], -ext[1]);
    // the piece itself, flat: its own matrix is what lays the texture down
    var saved = n.local;
    n.local = new DOMMatrix();
    var drawn = paint(tc, n, flat, imgs, check, k);
    n.local = saved;
    return drawn.then(function () {
      var W = x.canvas.width, H = x.canvas.height, bb = bbox(m, ext[0], ext[1], ew, eh);
      var X0 = 0, Y0 = 0, X1 = W, Y1 = H;
      if (bb) { X0 = Math.max(0, Math.floor(bb[0])); Y0 = Math.max(0, Math.floor(bb[1])); X1 = Math.min(W, Math.ceil(bb[2])); Y1 = Math.min(H, Math.ceil(bb[3])); }
      if (X1 > X0 && Y1 > Y0) {
        x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = alpha === undefined ? 1 : alpha;
        if (!layRows(x, tex, m, ext, ts, Y0, Y1)) layPixels(x, tc, tex, m, ext, ts, X0, Y0, X1, Y1, check);
        x.restore();
      }
      check.planes++;
      check.ms.planes = (check.ms.planes || 0) + (performance.now() - tp);
    });
  }
  // ROWS STAY ROWS on a plane turned only about its horizontal axis (no x
  // in the screen's y, nor in the divide): each screen row is a band of the
  // texture, scaled along it -- copied by the browser, a row at a time.
  // false: not such a plane
  function layRows(x, tex, m, ext, ts, Y0, Y1) {
    if (Math.abs(m.m12) > 1e-9 || Math.abs(m.m14) > 1e-9 || !(m.m11 > 0)) return false;
    var th = tex.height, tw = tex.width;
    var yOf = function (Y) { var d = Y * m.m24 - m.m22; return Math.abs(d) < 1e-12 ? null : (m.m42 - Y * m.m44) / d; };
    for (var Y = Y0; Y < Y1; Y++) {
      var ya = yOf(Y), yb = yOf(Y + 1);
      if (ya === null || yb === null) continue;
      var yc = (ya + yb) / 2, w = m.m24 * yc + m.m44;
      if (!(w > 1e-6)) continue;
      var v0 = (Math.min(ya, yb) - ext[1]) * ts, v1 = (Math.max(ya, yb) - ext[1]) * ts;
      if (v1 <= 0 || v0 >= th) continue;
      v0 = Math.max(0, v0); v1 = Math.min(th, Math.max(v1, v0 + 0.01));
      var Xa = (m.m11 * ext[0] + m.m21 * yc + m.m41) / w, Xb = (m.m11 * ext[2] + m.m21 * yc + m.m41) / w;
      x.drawImage(tex, 0, v0, tw, v1 - v0, Xa, Y, Xb - Xa, 1);
    }
    return true;
  }
  // any other plane: each covered screen pixel looked up on the texture
  // through the inverse (in script: slow without a JIT, but no plane in the
  // sky needs it today)
  function layPixels(x, tc, tex, m, ext, ts, X0, Y0, X1, Y1, check) {
    var h = homography(m), hi = inv3(h);
    if (!hi) { check.unsupported['plane'] = (check.unsupported['plane'] || 0) + 1; return; }
    var src = tc.getImageData(0, 0, tex.width, tex.height).data, out = newCanvas(X1 - X0, Y1 - Y0), ox = ctxOf(out);
    var dst = ox.createImageData(X1 - X0, Y1 - Y0);
    layPlane(src, tex.width, tex.height, ext, ts, hi, h, dst.data, X1 - X0, Y1 - Y0, X0, Y0);
    ox.putImageData(dst, 0, 0);
    x.drawImage(out, X0, Y0);
  }
  // a 3D piece's extent: its own box and all its children's, in its own
  // coordinates (through their local matrices)
  function prepare(n) {
    n.kids.forEach(prepare);
    n.painters = (paints(n) ? 1 : 0) + n.kids.reduce(function (a, c) { return a + c.painters; }, 0);
    if (!affine(n.m) || !affine(n.local)) {
      var ex = [0, 0, n.w, n.h];
      (function grow(c, M) {
        c.kids.forEach(function (g) {
          var gm = M.multiply(g.local), b = bbox(gm, 0, 0, g.w, g.h);
          if (b) { ex[0] = Math.min(ex[0], b[0]); ex[1] = Math.min(ex[1], b[1]); ex[2] = Math.max(ex[2], b[2]); ex[3] = Math.max(ex[3], b[3]); }
          grow(g, gm);
        });
      })(n, new DOMMatrix());
      n.extent = ex;
    }
  }

  // ---------------------------------------------------------------- render
  // -> a Promise of { canvas: the sky at `scale` (CPU-backed), check }
  function render(sky, opts) {
    opts = opts || {};
    var k = opts.scale || SCALE_K;
    SCALE_K = k;
    VP = { W: window.innerWidth, H: window.innerHeight };
    var check = { pieces: 0, mismatched: 0, offsets: 0, planes: 0, groups: 0, reused: 0, where: [], unsupported: {}, ms: {},
                  unsettled: 0, ahead: 0 };
    var t0 = performance.now();
    // the page's zoom (collect): a CSS pixel is Z screen pixels, so what is
    // sized in CSS pixels -- shadows, the pieces' own filters, the look's
    // blur -- is drawn at k * Z
    var Z = sky.currentCSSZoom || 1, kz = k * Z;
    var got = collect(sky, VP, opts.moves || null, check, opts.settle || 0, Z);
    check.ms.collect = Math.round(performance.now() - t0);
    if (!got.tree) return Promise.resolve(null);
    return Promise.all(got.urls.map(loadImg)).then(function (loaded) {
      var imgs = {};
      got.urls.forEach(function (u, i) { imgs[u] = loaded[i]; });
      var c = newCanvas(VP.W * k, VP.H * k), x = ctxOf(c);
      // (the paint walks each piece's own `local` from here: the page's zoom
      // goes on at the root, as collect's matrices have it)
      var screen = new DOMMatrix().scale(c.width / VP.W, c.height / VP.H).scale(Z, Z);
      prepare(got.tree);
      groupCache.forEach(function (v, el) { if (!el.isConnected) groupCache.delete(el); });
      var t1 = performance.now();
      return paint(x, got.tree, screen, imgs, check, kz).then(function () {
        check.ms.paint = Math.round(performance.now() - t1);
        // THEN THE LOOK'S OWN FILTER over the whole picture (opts.filter:
        // the --hk-blur-filter it wears), its edges held
        var fl = filtersOf(opts.filter || '');
        if (!fl.length) return c;
        var reach = 0;
        fl.forEach(function (f) { if (f.f === 'blur') reach += 3 * (parseFloat(f.v) || 0) * kz; });
        return nativeFilter(c, svgPrims(fl, kz, check), reach + 2);
      }).then(function (out) {
        check.ms.total = Math.round(performance.now() - t0);
        return { canvas: out, check: check };
      });
    });
  }

  window.hkSkyShot = {
    render: render,
    // the pure parts, for the tests
    _: { settling: settling, asSettled: asSettled, splitTop: splitTop, len: len, place: place, tileSize: tileSize, stopOf: stopOf, resolveStops: resolveStops,
         lineOf: lineOf, radialOf: radialOf, colorStops: colorStops, rgbaOf: rgbaOf, premulStops: premulStops, filtersOf: filtersOf, matrixOf: matrixOf,
         shadowOf: shadowOf, svgPrims: svgPrims, project: project, homography: homography, inv3: inv3, unproject: unproject, layPlane: layPlane }
  };
})();
