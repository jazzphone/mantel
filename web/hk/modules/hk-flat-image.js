// Flat's still photo treatment. Pure resolution and a 256-entry color table;
// pixels are processed only when an image or its effective treatment changes.
(function () {
  'use strict';
  var DEFAULTS = { mode: 'legacy', color: 'accent', strength: 80, depth: 40, brightness: 0, fade: 35 };
  var PRESETS = {
    soft: { mode: 'tinted', strength: 60, depth: 15, brightness: 10, fade: 45 },
    balanced: { mode: 'tinted', strength: 80, depth: 40, brightness: 0, fade: 35 },
    rich: { mode: 'tinted', strength: 100, depth: 85, brightness: -5, fade: 15 },
    washed: { mode: 'tinted', strength: 75, depth: 10, brightness: 20, fade: 70 }
  };
  function resolve(sky, board, keys) {
    sky = sky || {}; keys = keys || [];
    var candidates = [], bp = board && board.sky_flat_page_image_looks || {}, hp = sky.flat_page_image_looks || {};
    keys.forEach(function (key) {
      if (board) candidates.push({ value: bp[key], scope: 'screen-page', page: key });
      candidates.push({ value: hp[key], scope: 'house-page', page: key });
    });
    if (board) candidates.push({ value: board.sky_flat_image_look, scope: 'screen' });
    candidates.push({ value: sky.flat_image_look, scope: 'house' });
    return pick(candidates);
  }
  // THE GLASS LOOKS' IMAGE LOOK (2026-10-24, the owner: Flat's treatment
  // for the other looks' Photo and Landscapes too): the same fields, kept
  // apart from Flat's (sky.image_look, a screen's sky_image_look) -- this
  // screen's, else All Screens', else the defaults ('legacy': the photo as
  // it is, with its Photo Look alone)
  function resolveGlass(sky, board) {
    var candidates = [];
    if (board) candidates.push({ value: board.sky_image_look, scope: 'screen' });
    candidates.push({ value: (sky || {}).image_look, scope: 'house' });
    return pick(candidates);
  }
  // each field from the first candidate that stores it, else the default
  function pick(candidates) {
    var value = {}, from = {};
    Object.keys(DEFAULTS).forEach(function (field) {
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.value && c.value[field] != null) {
          value[field] = c.value[field]; from[field] = { scope: c.scope, page: c.page || null }; break;
        }
      }
      if (value[field] == null) { value[field] = DEFAULTS[field]; from[field] = { scope: 'default', page: null }; }
    });
    return { value: value, from: from };
  }
  function preset(look) {
    if (look.mode === 'legacy' || look.mode === 'original') return look.mode;
    var names = Object.keys(PRESETS);
    for (var i = 0; i < names.length; i++) {
      var p = PRESETS[names[i]];
      if (Object.keys(p).every(function (k) { return p[k] === look[k]; })) return names[i];
    }
    return 'custom';
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function rgb(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#64798e';
    return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
  }
  function mix(a, b, t) { return a.map(function (v, i) { return v * (1 - t) + b[i] * t; }); }
  function hsl(a) {
    var r = a[0] / 255, g = a[1] / 255, b = a[2] / 255;
    var hi = Math.max(r, g, b), lo = Math.min(r, g, b), d = hi - lo, l = (hi + lo) / 2, h = 0;
    if (d) h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
  }
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    return (h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x])
      .map(function (v) { return (v + m) * 255; });
  }
  function table(look, color) {
    var tint = rgb(color), hs = hsl(tint), d = clamp(+look.depth || 0, 0, 100) / 100;
    var k = clamp(+look.strength || 0, 0, 100) / 100, gamma = Math.pow(2, -clamp(+look.brightness || 0, -50, 50) / 50);
    var shadow = fromHsl(hs[0] - 16 * d, Math.min(1, hs[1] * (1 + .25 * d)), hs[2] * (.65 - .35 * d));
    var mid = fromHsl(hs[0], Math.min(1, hs[1] * (1 + .15 * d)), hs[2] * (1 - .12 * d));
    var high = mix(fromHsl(hs[0] + 12 * d, hs[1], hs[2]), hs[1] < .02 ? [242, 242, 242] : [244, 242, 238], .95);
    // Keep all channels ordered: neighboring hues must never reverse the
    // light/dark structure, even with very pale or fully saturated seeds.
    for (var c = 0; c < 3; c++) {
      shadow[c] = Math.min(shadow[c], high[c]); mid[c] = clamp(mid[c], shadow[c], high[c]);
    }
    var out = [];
    for (var n = 0; n < 256; n++) {
      var y = Math.pow(n / 255, gamma);
      out[n] = [0, 1, 2].map(function (c) {
        if (look.mode === 'original') return Math.round(y * 255);
        var plain = shadow[c] * (1 - y) + high[c] * y;
        var rich = y < .5 ? shadow[c] * (1 - 2 * y) + mid[c] * 2 * y : mid[c] * (2 - 2 * y) + high[c] * (2 * y - 1);
        return Math.round(clamp((plain * (1 - d) + rich * d) * k + y * 255 * (1 - k), 0, 255));
      });
    }
    return out;
  }
  function pixels(data, look, color) {
    var lut = table(look, color), original = look.mode === 'original';
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      if (original) { data[i] = lut[r][0]; data[i + 1] = lut[g][1]; data[i + 2] = lut[b][2]; }
      else {
        var c = lut[Math.round(.2126 * r + .7152 * g + .0722 * b)];
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
      }
    }
    return data;
  }
  function paint(canvas, image, look, color, max) {
    var w = image.naturalWidth, h = image.naturalHeight;
    if (!w || !h) return false;
    var scale = Math.min(1, (max || 1440) / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    pixels(imageData.data, look, color); ctx.putImageData(imageData, 0, 0);
    return true;
  }
  function fade(amount, theme) {
    return 'rgba(' + (theme === 'light' ? '238,236,230,' : '10,11,12,') + (clamp(+amount || 0, 0, 100) / 100).toFixed(3) + ')';
  }
  window.hkFlatImage = { defaults: DEFAULTS, presets: PRESETS, resolve: resolve, resolveGlass: resolveGlass, preset: preset, table: table, pixels: pixels, paint: paint, fade: fade };
})();
