// hk-wallpapers.js -- THE WALLPAPERS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md
// Phase E): a Background of our own art, window.hkWallpapers.
//
// Twelve wallpapers: four shapes (soft folded ribbons, petals, glass shards,
// pinwheels) in six colour families (Rose, Violet, Blue, Teal, Amber,
// Graphite), each with a darker night version. Each is an SVG drawn here from
// its family's five colours (darkest first) -- the same builder draws the
// screen's background (hk-sky.js, painted once at the screen's size) and the
// picker's previews (HK Settings -> Sky / Background).
//
// THE STOPS. A wallpaper also names four stops, top to bottom, as a Color
// backdrop has: the art's own mean colour across the screen at the sky's stop
// heights (0, .42, .72, 1), measured off the drawn SVG
// (tools/headless/wallpaper_stops.cjs measures them again). hk-sky.js
// publishes them as the sky's --sk0..--sk3, so Frosted's Tint from
// Background (hk-frosttint.js), the Flat image tint and Bright Glass's plate
// mix read a wallpaper as they read the sky. They stay under the sky's luma
// caps, and white text on Bright Glass keeps 4.5:1 over the lightest of them
// (tests/py/test_settings.py).
//
// THE MOTION THEMES (2026-10-31, the owner on 0.1.94: more moving
// backgrounds, one that "takes any color" with presets): six more
// wallpapers -- Aurora, Blobs, Waves, Dot Field, Light Beams, Meteors -- each
// drawn from ONE colour the owner picks (sky.wallpaper_color: a preset of
// COLORS or "#rrggbb"). The colour gives the hue and how vivid; how light
// each shade runs is set here (ramp()), by its luminance, so any colour --
// white, black, a bright yellow -- keeps the sky's caps and white text's
// 4.5:1. A theme is a still ground plus a few layers the sky moves (hk-sky.js
// paintWall): each layer its own small picture, moved by a transform or
// faded, nothing repainted per frame. Without motion (Motion Off, Animations
// Off, Reduce Motion) the layers stand where they start: the still frame.
// The picker's thumbnails, the stops and the screen's ground draw from the
// same builders. Their stops are not measured per colour: each band's mean is
// a fixed blend of the theme's shades (alpha compositing is linear in the
// colours), so the weights are measured once (tools/headless/wallpaper_stops.cjs
// --weights) and any colour's stops follow.
//
// CONTENT, NOT DESIGN (DESIGN.md rule 4): the shapes and palettes stay here,
// as the sky's do. Nothing at load but the global.
(function () {
  'use strict';
  if (window.hkWallpapers) return;

  // THE FAMILIES: five colours each, darkest to lightest (p0..p4), by day and
  // by night. The day versions are the mock-ups' colours deepened, each
  // family by one factor (rose 0.84, violet 0.75, blue 0.65, teal 0.6, amber
  // 0.73, graphite 0.92 of the mock-ups' sRGB), until the art's stops sat
  // under the sky's luma caps and white text on Bright Glass kept 4.5:1 over
  // the lightest of them at its designed Strength (DESIGN.md "Bright Glass")
  var FAMILIES = {
    rose: { name: 'Rose',
      day: ['#23093c', '#591778', '#a31b6b', '#c34c8b', '#cf94b4'], night: ['#12051f', '#300c45', '#5e1050', '#8a2a72', '#b8609c'] },
    violet: { name: 'Violet',
      day: ['#161048', '#2c2084', '#5045b4', '#7d76bf', '#a6a2bf'], night: ['#0b082c', '#1a145a', '#2c238a', '#4a41b2', '#7870d4'] },
    blue: { name: 'Blue',
      day: ['#071739', '#0d3478', '#1f5297', '#5779a6', '#8996a6'], night: ['#05102a', '#0a285e', '#123f8a', '#285fae', '#5a8bd0'] },
    teal: { name: 'Teal',
      day: ['#042320', '#08423d', '#135e55', '#477f75', '#79918c'], night: ['#021a18', '#05332e', '#0a4f47', '#187266', '#3d998b'] },
    amber: { name: 'Amber',
      day: ['#2a1004', '#592606', '#8e450a', '#af702a', '#ba9d70'], night: ['#1a0a02', '#361705', '#5a2a08', '#87491a', '#b87d42'] },
    graphite: { name: 'Graphite',
      day: ['#12151a', '#272b34', '#444b56', '#737a88', '#b3b9c2'], night: ['#08090c', '#121419', '#1f232a', '#363c47', '#5d6572'] }
  };
  var SHAPES = { ribbons: 'Ribbons', petals: 'Petals', shards: 'Shards', pinwheel: 'Pinwheel' };

  // THE TWELVE (settings.py WALLPAPERS, in its order): id, shape, family,
  // and the art's four stops by day and by night
  var LIST = [
    ['ribbons_rose', 'ribbons', 'rose', ['#8a1f74', '#973681', '#46125e', '#42115e'], ['#511250', '#651f5f', '#260a36', '#230935']],
    ['petals_rose', 'petals', 'rose', ['#39104f', '#642674', '#84367e', '#90377f'], ['#20092d', '#41174b', '#5b205a', '#62215d']],
    ['petals_violet', 'petals', 'violet', ['#211a5e', '#3c3283', '#524999', '#584fa1'], ['#120e3f', '#262066', '#342d80', '#373089']],
    ['shards_violet', 'shards', 'violet', ['#564e8f', '#564d9b', '#50469e', '#564da5'], ['#413c78', '#3e387f', '#342d7f', '#352e89']],
    ['shards_blue', 'shards', 'blue', ['#3e5780', '#38588b', '#2d528b', '#315790'], ['#324c78', '#2c4b80', '#204480', '#1e478a']],
    ['ribbons_blue', 'ribbons', 'blue', ['#1f4b8d', '#375b91', '#0d2a5e', '#0b285d'], ['#123a7d', '#1d498d', '#091f4a', '#081e48']],
    ['pinwheel_teal', 'pinwheel', 'teal', ['#1a4f49', '#1a4e48', '#1b4944', '#153e39'], ['#0c443d', '#0d433c', '#0c3e38', '#0a342f']],
    ['ribbons_teal', 'ribbons', 'teal', ['#155750', '#2c645d', '#083732', '#063531'], ['#0a4841', '#12584f', '#042a26', '#042825']],
    ['pinwheel_amber', 'pinwheel', 'amber', ['#6e3b13', '#6a3914', '#623614', '#502b11'], ['#4d270c', '#4b260d', '#46240c', '#3a1d0a']],
    ['petals_amber', 'petals', 'amber', ['#3d1b07', '#613515', '#7b4a1f', '#844f20'], ['#271104', '#46240d', '#5d3314', '#633614']],
    ['shards_graphite', 'shards', 'graphite', ['#53575e', '#52565e', '#4b5059', '#515761'], ['#373a3f', '#34363c', '#282c32', '#272b33']],
    ['pinwheel_graphite', 'pinwheel', 'graphite', ['#3e434c', '#3d414a', '#393d46', '#2f333a'], ['#1d2027', '#1d2026', '#1b1e24', '#16191e']]
  ];
  var BY_ID = {};
  LIST.forEach(function (w) { BY_ID[w[0]] = { id: w[0], shape: w[1], family: w[2], day: w[3], night: w[4] }; });
  var DEFAULT = 'ribbons_rose';

  // ------------------------------------------------------------ the art
  // (drawn for HK, 2026-10-30, as the HomeView-look mock-ups drew them --
  // every shape is ours; a 1000 x 1000 picture cut to the screen, "slice")
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function lg(id, x1, y1, x2, y2, stops) {
    return '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '" stop-opacity="' + (s[2] == null ? 1 : s[2]) + '"/>'; }).join('') +
      '</linearGradient>';
  }
  var DRAW = {
    ribbons: function (p, u) {
      return '<defs>' + lg(u + 'a', 0, 0, 1, 1, [[0, p[2]], [0.55, p[1]], [1, p[0]]]) +
        lg(u + 'b', 0, 0, 1, 0.3, [[0, p[4], 0.9], [0.45, p[3], 0.75], [1, p[2], 0.15]]) +
        lg(u + 'c', 1, 0, 0, 1, [[0, p[3], 0.85], [1, p[1], 0.1]]) +
        lg(u + 'd', 0, 1, 1, 0, [[0, p[0], 0.9], [1, p[1], 0.2]]) + '</defs>' +
        '<rect width="1000" height="1000" fill="url(#' + u + 'a)"/>' +
        '<path d="M-80 300C180 140 420 460 700 330S980 120 1080 160V420C900 380 820 600 620 620S200 420-80 640Z" fill="url(#' + u + 'b)"/>' +
        '<path d="M-80 640C200 420 520 680 640 600S900 400 1080 420V560C900 560 760 820 520 860S120 760-80 900Z" fill="url(#' + u + 'd)"/>' +
        '<path d="M560-60C700 200 600 420 760 640S1000 900 1080 1000V-60Z" fill="url(#' + u + 'c)" opacity=".7"/>' +
        '<path d="M-80 300C180 140 420 460 700 330S980 120 1080 160V190C960 160 860 350 700 372S180 190-80 340Z" fill="' + p[4] + '" opacity=".35"/>' +
        '<path d="M-80 640C200 420 520 680 640 600S900 400 1080 420V444C900 430 800 640 640 640S220 470-80 676Z" fill="' + p[4] + '" opacity=".22"/>';
    },
    petals: function (p, u) {
      var s = '<defs><radialGradient id="' + u + 'a" cx=".85" cy=".95" r="1.15"><stop offset="0" stop-color="' + p[3] + '"/>' +
        '<stop offset=".45" stop-color="' + p[1] + '"/><stop offset="1" stop-color="' + p[0] + '"/></radialGradient>' +
        lg(u + 'p', 0, 0, 0, 1, [[0, p[4], 0.85], [1, p[2], 0.15]]) + lg(u + 'q', 0, 0, 0, 1, [[0, p[3], 0.75], [1, p[1], 0.05]]) + '</defs>' +
        '<rect width="1000" height="1000" fill="url(#' + u + 'a)"/>';
      for (var i = 0; i < 10; i++) {
        s += '<ellipse cx="0" cy="-380" rx="128" ry="390" transform="translate(860 980) rotate(' + (-158 + i * 15) + ')" fill="url(#' + u + 'p)" opacity="' + (i % 2 ? 0.62 : 0.4) + '"/>';
      }
      for (var j = 0; j < 8; j++) {
        s += '<ellipse cx="0" cy="-210" rx="72" ry="215" transform="translate(110 90) rotate(' + (25 + j * 21) + ')" fill="url(#' + u + 'q)" opacity=".5"/>';
      }
      return s;
    },
    shards: function (p, u) {
      var polys = [[[0, 0], [420, 0], [180, 380]], [[420, 0], [1000, 0], [760, 300], [300, 260]], [[1000, 0], [1000, 520], [700, 360]],
        [[0, 380], [260, 300], [420, 700], [0, 820]], [[300, 260], [760, 300], [620, 640], [380, 560]], [[760, 300], [1000, 520], [1000, 820], [640, 660]],
        [[0, 820], [420, 700], [540, 1000], [0, 1000]], [[420, 700], [640, 660], [1000, 820], [1000, 1000], [540, 1000]], [[180, 380], [300, 260], [380, 560], [260, 300]],
        [[620, 640], [760, 300], [700, 360]]];
      var fills = [p[3], p[4], p[2], p[3], p[4], p[2], p[3], p[4], p[2], p[4]], ops = [0.35, 0.2, 0.45, 0.18, 0.3, 0.4, 0.26, 0.32, 0.5, 0.4];
      var s = '<defs>' + lg(u + 'a', 0, 0, 1, 1, [[0, p[0]], [0.5, p[1]], [1, p[2]]]) +
        '<radialGradient id="' + u + 'g" cx=".2" cy=".15" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".22"/>' +
        '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>' +
        '<rect width="1000" height="1000" fill="url(#' + u + 'a)"/>';
      polys.forEach(function (pl, i) {
        s += '<polygon points="' + pl.map(function (q) { return q.join(','); }).join(' ') + '" fill="' + fills[i] + '" fill-opacity="' + ops[i] +
          '" stroke="' + p[4] + '" stroke-opacity=".35" stroke-width="2"/>';
      });
      return s + '<rect width="1000" height="1000" fill="url(#' + u + 'g)"/>';
    },
    pinwheel: function (p, u) {
      var s = '<defs>' + lg(u + 'a', 0, 0, 1, 1, [[0, p[2]], [0.6, p[1]], [1, p[0]]]) +
        '<radialGradient id="' + u + 'f" cx=".32" cy=".33" r=".9"><stop offset="0" stop-color="' + p[0] + '" stop-opacity="0"/>' +
        '<stop offset="1" stop-color="' + p[0] + '" stop-opacity=".55"/></radialGradient></defs>' +
        '<rect width="1000" height="1000" fill="url(#' + u + 'a)"/>';
      function wheel(cx, cy, n, r, tw, o1, o2) {
        for (var i = 0; i < n; i++) {
          var a0 = i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n, am = a0 + tw;
          var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
          var qx = cx + r * 0.55 * Math.cos(am), qy = cy + r * 0.55 * Math.sin(am);
          s += '<path d="M' + cx + ' ' + cy + 'Q' + qx.toFixed(1) + ' ' + qy.toFixed(1) + ' ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
            'L' + x0.toFixed(1) + ' ' + y0.toFixed(1) + 'Z" fill="' + (i % 2 ? p[3] : p[4]) + '" fill-opacity="' + (i % 2 ? o1 : o2) + '"/>';
        }
      }
      wheel(320, 330, 16, 1150, 0.5, 0.32, 0.16);
      wheel(880, 870, 12, 360, 0.55, 0.38, 0.2);
      return s + '<rect width="1000" height="1000" fill="url(#' + u + 'f)"/>';
    }
  };
  // a few still stars on a night version (the sky's own stay off over a
  // wallpaper)
  function stars() {
    var r = rng(11), s = '';
    for (var i = 0; i < 40; i++) {
      s += '<circle cx="' + (r() * 1000).toFixed(0) + '" cy="' + (r() * 520).toFixed(0) + '" r="' + (0.8 + r() * 1.4).toFixed(1) +
        '" fill="#fff" opacity="' + (0.12 + r() * 0.3).toFixed(2) + '"/>';
    }
    return s;
  }

  // ------------------------------------------------------------ the themes
  // THE PRESETS (settings.py WALLPAPER_COLORS, in its order): one tap each;
  // any other colour is "#rrggbb"
  var COLORS = [['rose', 'Rose', '#e0457b'], ['coral', 'Coral', '#f0644a'], ['amber', 'Amber', '#f59e0b'],
    ['green', 'Green', '#34c759'], ['teal', 'Teal', '#14b8a6'], ['blue', 'Blue', '#2f7bf6'],
    ['violet', 'Violet', '#7a5cff'], ['graphite', 'Graphite', '#8a94a6']];
  var COLOR_DEFAULT = 'blue';
  // a stored colour as "#rrggbb": a preset's, your own, else the default's
  function color(v) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i][0] === v) return COLORS[i][2];
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : color(COLOR_DEFAULT);
  }
  function rgbOf(h) { var n = parseInt(h.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
  function hexOf(c) {
    return '#' + c.map(function (v) { var x = Math.round(Math.max(0, Math.min(255, v))).toString(16); return x.length < 2 ? '0' + x : x; }).join('');
  }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function enc(x) { x = Math.max(0, Math.min(1, x)); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055); }
  // THE SHADES OF A COLOUR: its hue and saturation (HSL), at five set
  // luminances (Y, WCAG's), darkest first -- by day, and darker by night. Set
  // by Y, not by lightness: a yellow and a blue of one lightness are far
  // apart in how white text reads on them. Under the colour's own Y a shade
  // is the colour darkened (its hue kept exactly); over it, the colour mixed
  // toward white. The lightest shades are only ever highlights in the art.
  var RAMP = { day: [0.006, 0.022, 0.06, 0.14, 0.32], night: [0.003, 0.01, 0.03, 0.07, 0.16] };
  function hueOf(hex) {
    var c = rgbOf(hex).map(function (v) { return v / 255; }), mx = Math.max.apply(null, c), mn = Math.min.apply(null, c), d = mx - mn, l = (mx + mn) / 2;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), h = 0;
    if (d) h = mx === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return { h: h * 60, s: Math.min(1, s) };
  }
  function ramp(hex, shift, night) {
    var hs = hueOf(hex), h = ((hs.h + shift) % 360 + 360) % 360 / 60, s = Math.min(hs.s, 0.9);
    // the hue at HSL lightness .5
    var x = s * (1 - Math.abs(h % 2 - 1)), k = [[s, x, 0], [x, s, 0], [0, s, x], [0, x, s], [x, 0, s], [s, 0, x]][Math.floor(h) % 6];
    var base = k.map(function (v) { return lin((v + 0.5 - s / 2) * 255); });
    var Yb = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
    return RAMP[night ? 'night' : 'day'].map(function (Y) {
      var t = Y > Yb ? (Y - Yb) / (1 - Yb) : 0;
      return hexOf(base.map(function (v) { return enc(Y <= Yb ? v * Y / Yb : v + (1 - v) * t); }));
    });
  }
  // a radial gradient, as lg above
  function rg(id, cx, cy, r, stops) {
    return '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '">' +
      stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '" stop-opacity="' + (s[2] == null ? 1 : s[2]) + '"/>'; }).join('') +
      '</radialGradient>';
  }
  // a soft round glow filling its box (a blob, a light): shade `c` at its
  // heart, fading through shade `b` to nothing
  function glow(c, a, b) {
    return function (P, u) {
      return '<defs>' + rg(u + 'g', 0.5, 0.5, 0.5, [[0, P[c], a], [0.3, P[c], a * 0.8], [0.65, P[b], a * 0.45], [1, P[b], 0]]) + '</defs>' +
        '<rect width="100" height="100" fill="url(#' + u + 'g)"/>';
    };
  }
  // an aurora's curtain across a 1300 x 400 box: side-by-side rays, each
  // brightest at its own foot and fading upward, their feet along a slow
  // wave (`k` waves across, from `seed`) -- each ray its own gradient box,
  // so the bright edge follows the wave
  function curtain(hi, mid, k, seed) {
    return function (P, u) {
      var r = rng(seed), ph = r() * 6.28, s = '<defs>' + lg(u + 'c', 0, 0, 0, 1, [[0, P[mid], 0], [0.55, P[mid], 0.4], [0.86, P[hi], 0.85], [1, P[hi], 0]]) + '</defs>';
      for (var x = 0; x < 1300;) {
        var w = 7 + r() * 16, a = (x + w / 2) / 1300 * 6.28 * k + ph;
        var foot = 310 + 55 * Math.sin(a) + 14 * Math.sin(a * 2.7), tall = 210 + 70 * Math.sin(a * 0.6 + 1) + r() * 50;
        s += '<rect x="' + x.toFixed(0) + '" y="' + (foot - tall).toFixed(0) + '" width="' + (w + 1).toFixed(0) + '" height="' + tall.toFixed(0) +
          '" fill="url(#' + u + 'c)" opacity="' + (0.45 + r() * 0.55).toFixed(2) + '"/>';
        x += w;
      }
      return s;
    };
  }
  // a wave band, `n` crests across a 1300 x 300 box, filled from its crest
  // down; its crest a lighter line
  function wave(n, amp, top, fill, crest) {
    return function (P, u) {
      var w = 1300 / n, d = 'M0 ' + top;
      for (var i = 0; i < n; i++) {
        var x = i * w;
        d += 'C' + (x + w * 0.2).toFixed(0) + ' ' + (top - amp) + ' ' + (x + w * 0.3).toFixed(0) + ' ' + (top - amp) + ' ' + (x + w * 0.5).toFixed(0) + ' ' + top +
             'S' + (x + w * 0.8).toFixed(0) + ' ' + (top + amp) + ' ' + (x + w).toFixed(0) + ' ' + top;
      }
      return '<defs>' + lg(u + 'w', 0, 0, 0, 1, fill(P)) + '</defs><path d="' + d + 'V300H0Z" fill="url(#' + u + 'w)"/>' +
        '<path d="' + d + '" fill="none" stroke="' + P[crest] + '" stroke-opacity=".38" stroke-width="2.5"/>';
    };
  }
  // a beam of light leaning right, in a 300 x 1200 box: bright through its
  // middle, fading to nothing at its sides and ends
  function beam(c, a) {
    return function (P, u) {
      return '<defs>' + lg(u + 'b', 0, 0, 1, 0, [[0, P[c], 0], [0.5, P[c], a], [1, P[c], 0]]) +
        lg(u + 'f', 0, 0, 0, 1, [[0, '#fff', 0], [0.3, '#fff', 1], [0.75, '#fff', 0.7], [1, '#fff', 0]]) +
        '<mask id="' + u + 'm"><rect width="300" height="1200" fill="url(#' + u + 'f)"/></mask></defs>' +
        '<polygon points="170,0 300,0 130,1200 0,1200" fill="url(#' + u + 'b)" mask="url(#' + u + 'm)"/>';
    };
  }
  // a meteor's streak, its head at the right
  function meteor(P, u) {
    return '<defs>' + lg(u + 't', 0, 0, 1, 0, [[0, P[4], 0], [0.75, P[4], 0.45], [0.96, '#fff', 0.95], [1, '#fff', 0]]) + '</defs>' +
      '<rect y="3" width="400" height="4" rx="2" fill="url(#' + u + 't)"/><circle cx="384" cy="5" r="5" fill="#fff" opacity=".9"/>';
  }
  // still stars over a theme's ground, from a seed of their own (Meteors
  // always; every theme at night)
  function starfield(n, seed, h) {
    var r = rng(seed), s = '';
    for (var i = 0; i < n; i++) {
      s += '<circle cx="' + (r() * 1000).toFixed(0) + '" cy="' + (r() * h).toFixed(0) + '" r="' + (0.7 + r() * 1.3).toFixed(1) +
        '" fill="#fff" opacity="' + (0.15 + r() * 0.4).toFixed(2) + '"/>';
    }
    return s;
  }
  // THE SIX. Each: its name; `hues`, the colour's shades it draws with -- the
  // colour itself, then any partners turned round the colour wheel by that
  // many degrees (P[0..4] the colour's, P[5..9] the first partner's ...);
  // `ground`, the still picture under it all, on a 1000 x 700 frame (a
  // landscape tablet's shape, cut to the screen); `layers`, each a picture
  // of its own in a box (x, y, width, height in % of the screen; `vb` its
  // drawing's size, stretched to the box) with how it moves (`mv`: one of
  // the sky's four keyframes and its values, hk-sky.js), at a speed (`d`:
  // one of the Motion's lengths, a..f). `tile`: a small picture of that many
  // pixels repeated over the screen instead of a box. `rot`: turned so many
  // degrees; `still`: its opacity when nothing moves.
  //
  // WHY EACH IS CHEAP: every layer is drawn once, by the browser, into its
  // own texture; what moves is a transform or an opacity, which the
  // compositor applies with no layout, paint or script per frame. No filter
  // and no blend mode anywhere. Each theme's layers together come to about
  // one and a half screens of texture (the drawn wallpapers' Motion moves one
  // of 1.44), most of them far smaller than the screen.
  var THEMES = {
    // AURORA: two soft curtains of light, the colour and a partner 40 degrees
    // round, swaying sideways and stretching under a dark sky. Two textures,
    // each a wide band; transform and opacity only.
    aurora: { name: 'Aurora', hues: [0, 40],
      ground: function (P, u) {
        return '<defs>' + lg(u + 'g', 0, 0, 0, 1, [[0, P[0]], [0.62, P[1]], [1, P[2]]]) + '</defs><rect width="1000" height="700" fill="url(#' + u + 'g)"/>';
      },
      layers: [
        { box: [-15, 2, 130, 60], vb: [1300, 400], d: 'a', mv: { an: 'sway', tx: '-8%', ts: '1.1', or: '50% 100%' }, draw: curtain(4, 3, 1.3, 5) },
        { box: [-20, 14, 140, 52], vb: [1300, 400], d: 'b', mv: { an: 'sway', tx: '7%', ts: '.88', to: '.45', or: '50% 100%' }, draw: curtain(9, 8, 0.9, 9) }
      ] },
    // BLOBS: three big soft glows -- the colour and partners 45 and 40
    // degrees either side -- wandering slowly round each other. Three
    // textures, each under two thirds of the screen; a transform loop each.
    blobs: { name: 'Blobs', hues: [0, 35, -30],
      ground: function (P, u) {
        return '<defs>' + lg(u + 'g', 0, 0, 1, 1, [[0, P[1]], [1, P[0]]]) + '</defs><rect width="1000" height="700" fill="url(#' + u + 'g)"/>';
      },
      layers: [
        { box: [-14, -20, 72, 100], vb: [100, 100], d: 'a', draw: glow(3, 0.75, 2),
          mv: { an: 'loop', x1: '22%', y1: '12%', s1: '1.12', x2: '6%', y2: '24%', s2: '.92' } },
        { box: [40, 20, 70, 100], vb: [100, 100], d: 'b', draw: glow(8, 0.7, 7),
          mv: { an: 'loop', x1: '-20%', y1: '-14%', s1: '.9', x2: '-8%', y2: '6%', s2: '1.1' } },
        { box: [12, 40, 56, 80], vb: [100, 100], d: 'c', draw: glow(13, 0.6, 12),
          mv: { an: 'loop', x1: '16%', y1: '-22%', s1: '1.15', x2: '-14%', y2: '-8%', s2: '.95' } }
      ] },
    // WAVES: three bands of water rolling side to side at three speeds, the
    // nearest the darkest. Three textures, each a band a little wider than
    // the screen and a third to two thirds of its height; transform only.
    waves: { name: 'Waves', hues: [0],
      ground: function (P, u) {
        return '<defs>' + lg(u + 'g', 0, 0, 0, 1, [[0, P[0]], [0.55, P[1]], [1, P[2]]]) +
          rg(u + 'h', 0.7, 0.18, 0.5, [[0, P[3], 0.35], [1, P[3], 0]]) + '</defs>' +
          '<rect width="1000" height="700" fill="url(#' + u + 'g)"/><rect width="1000" height="700" fill="url(#' + u + 'h)"/>';
      },
      layers: [
        { box: [-15, 38, 130, 64], vb: [1300, 300], d: 'a', mv: { an: 'sway', tx: '-9%', ty: '2%' },
          draw: wave(3, 34, 70, function (P) { return [[0, P[3], 0.5], [0.4, P[2], 0.55], [1, P[1], 0.9]]; }, 4) },
        { box: [-15, 56, 130, 46], vb: [1300, 300], d: 'b', mv: { an: 'sway', tx: '8%', ty: '-3%' },
          draw: wave(4, 30, 60, function (P) { return [[0, P[3], 0.45], [0.35, P[1], 0.75], [1, P[0], 0.95]]; }, 3) },
        { box: [-15, 74, 130, 30], vb: [1300, 300], d: 'c', mv: { an: 'sway', tx: '-7%', ty: '4%' },
          draw: wave(5, 36, 70, function (P) { return [[0, P[2], 0.6], [0.4, P[0], 0.9], [1, P[0], 1]]; }, 3) }
      ] },
    // DOT FIELD: a grid of fine dots drifting slowly corner to corner over
    // a glow that wanders under it. The dots are ONE small tile repeated,
    // moved exactly one tile and round again (seamless, as the rain decks
    // are), so the layer overhangs the screen by one tile only; the glow is
    // one texture under two thirds of the screen.
    dots: { name: 'Dot Field', hues: [0, 40],
      ground: function (P, u) {
        return '<defs>' + lg(u + 'g', 0, 0, 1, 1, [[0, P[1]], [1, P[0]]]) + rg(u + 'h', 0.15, 0.85, 0.55, [[0, P[7], 0.6], [1, P[7], 0]]) + '</defs>' +
          '<rect width="1000" height="700" fill="url(#' + u + 'g)"/><rect width="1000" height="700" fill="url(#' + u + 'h)"/>';
      },
      layers: [
        { box: [42, -14, 68, 92], vb: [100, 100], d: 'b', draw: glow(3, 0.6, 2),
          mv: { an: 'loop', x1: '-24%', y1: '18%', s1: '1.1', x2: '-38%', y2: '-6%', s2: '.9' } },
        { tile: 30, vb: [30, 30], d: 'd', mv: { an: 'tile' },
          draw: function (P) { return '<circle cx="15" cy="15" r="1.9" fill="' + P[4] + '" opacity=".75"/>'; } }
      ] },
    // LIGHT BEAMS: four slanting shafts of light drifting sideways and
    // dimming, over a glow on the floor. Four tall, narrow textures (about
    // a screen between them); transform and opacity only.
    beams: { name: 'Light Beams', hues: [0],
      ground: function (P, u) {
        return '<defs>' + lg(u + 'g', 0, 0, 0, 1, [[0, P[0]], [0.7, P[1]], [1, P[1]]]) + rg(u + 'h', 0.5, 1.05, 0.6, [[0, P[3], 0.5], [1, P[3], 0]]) + '</defs>' +
          '<rect width="1000" height="700" fill="url(#' + u + 'g)"/><rect width="1000" height="700" fill="url(#' + u + 'h)"/>';
      },
      layers: [
        { box: [2, -12, 20, 124], vb: [300, 1200], d: 'a', draw: beam(4, 0.34), mv: { an: 'sway', tx: '70%', to: '.35' } },
        { box: [26, -12, 16, 124], vb: [300, 1200], d: 'b', draw: beam(3, 0.4), mv: { an: 'sway', tx: '-60%', to: '.5' } },
        { box: [50, -12, 22, 124], vb: [300, 1200], d: 'c', draw: beam(4, 0.3), mv: { an: 'sway', tx: '55%', to: '.3' } },
        { box: [74, -12, 18, 124], vb: [300, 1200], d: 'd', draw: beam(3, 0.38), mv: { an: 'sway', tx: '-75%', to: '.45' } }
      ] },
    // METEORS: a still starry sky with a glow low down, and now and then a
    // meteor crossing it. Five streaks, each a few pixels tall, moved by a
    // transform and faded: invisible most of their cycle.
    meteors: { name: 'Meteors', hues: [0, 40],
      ground: function (P, u) {
        return '<defs>' + lg(u + 'g', 0, 0, 0, 1, [[0, P[0]], [0.6, P[1]], [1, P[2]]]) + rg(u + 'h', 0.75, 1, 0.6, [[0, P[8], 0.45], [1, P[8], 0]]) + '</defs>' +
          '<rect width="1000" height="700" fill="url(#' + u + 'g)"/><rect width="1000" height="700" fill="url(#' + u + 'h)"/>' + starfield(90, 7, 640);
      },
      layers: [
        { box: [8, 6, 18, 1], vb: [400, 10], rot: 32, still: 0.8, d: 'e', draw: meteor, mv: { an: 'meteor', dl: '-2s' } },
        { box: [36, 2, 14, 1], vb: [400, 10], rot: 32, still: 0, d: 'f', draw: meteor, mv: { an: 'meteor', dl: '-7s' } },
        { box: [58, 10, 16, 1], vb: [400, 10], rot: 32, still: 0.6, d: 'e', draw: meteor, mv: { an: 'meteor', dl: '-9s' } },
        { box: [20, 24, 12, 1], vb: [400, 10], rot: 32, still: 0, d: 'f', draw: meteor, mv: { an: 'meteor', dl: '-13s' } },
        { box: [70, -2, 15, 1], vb: [400, 10], rot: 32, still: 0, d: 'e', draw: meteor, mv: { an: 'meteor', dl: '-5s' } }
      ] }
  };
  var THEME_IDS = ['aurora', 'blobs', 'waves', 'dots', 'beams', 'meteors'];
  // THE STOPS' WEIGHTS: for each theme, each band's mean as a blend of its
  // shades (w: four rows, one weight per shade) plus what its white stars
  // add (c: by day and by night, four each) -- measured off the still frame
  // by tools/headless/wallpaper_stops.cjs --weights, which also checks the
  // stops they give against the art drawn in each preset (--check)
  var WEIGHTS = {
    aurora: { w: [[0.9581, 0.0313, 0, 0.0098, 0, 0, 0, 0, 0, 0], [0.1282, 0.2668, 0, 0.0619, 0.1164, 0, 0, 0, 0.2322, 0.1932],
      [0, 0.7363, 0.2625, 0, 0, 0, 0, 0, 0, 0], [0, 0.0521, 0.9469, 0, 0, 0, 0, 0, 0, 0]],
      c: { day: [0.0005, 0.0004, 0.0006, 0.0005], night: [0.0007, 0.0005, 0.0006, 0.0005] } },
    blobs: { w: [[0.2408, 0.6093, 0.1328, 0.0162, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0.2952, 0.3141, 0.0833, 0.161, 0, 0, 0, 0.1227, 0.016, 0, 0, 0, 0.0069, 0, 0],
      [0.3201, 0.2329, 0.0308, 0, 0, 0, 0, 0.0597, 0.1821, 0, 0, 0, 0.0646, 0.1086, 0], [0.5379, 0.2033, 0, 0, 0, 0, 0, 0.1193, 0.0146, 0, 0, 0, 0.0887, 0.0354, 0]],
      c: { day: [0.0005, 0.0005, 0.0006, 0.0005], night: [0.0007, 0.0006, 0.0006, 0.0005] } },
    waves: { w: [[0.8446, 0.0315, 0, 0.1232, 0], [0.2137, 0.6929, 0, 0.0924, 0], [0, 0.5958, 0.2291, 0.175, 0], [0.9916, 0.0079, 0, 0, 0]],
      c: { day: [0.0005, 0.0005, 0, 0], night: [0.0007, 0.0007, 0, 0] } },
    dots: { w: [[0.2238, 0.6816, 0.0868, 0.0007, 0.0062, 0, 0, 0, 0, 0], [0.3255, 0.4198, 0.0695, 0.1268, 0.0104, 0, 0, 0.0471, 0, 0],
      [0.4897, 0.2767, 0.0232, 0, 0.0062, 0, 0, 0.2036, 0, 0], [0.6059, 0.1788, 0, 0, 0.0116, 0, 0, 0.2028, 0, 0]],
      c: { day: [0.0005, 0.0005, 0.0005, 0.0005], night: [0.0006, 0.0007, 0.0005, 0.0005] } },
    beams: { w: [[0.9472, 0.0274, 0, 0.0121, 0.0123], [0.3667, 0.5504, 0, 0.0406, 0.0411], [0.0029, 0.8001, 0, 0.1637, 0.0321], [0, 0.705, 0, 0.2838, 0.0104]],
      c: { day: [0.0005, 0.0005, 0.0006, 0.0005], night: [0.0007, 0.0007, 0.0006, 0.0005] } },
    meteors: { w: [[0.9655, 0.0326, 0, 0, 0.0004, 0, 0, 0, 0, 0], [0.2982, 0.6958, 0, 0, 0, 0, 0, 0, 0.0047, 0],
      [0, 0.6074, 0.2592, 0, 0, 0, 0, 0, 0.1321, 0], [0, 0.0386, 0.7378, 0, 0, 0, 0, 0, 0.2229, 0]],
      c: { day: [0.0008, 0.0008, 0.0008, 0.0005], night: [0.0009, 0.001, 0.0008, 0.0005] } }
  };
  function palette(id, hex, night) {
    return THEMES[id].hues.reduce(function (a, sh) { return a.concat(ramp(hex, sh, night)); }, []);
  }
  function themeStops(id, hex, night) {
    var W = WEIGHTS[id], P = palette(id, hex, night).map(rgbOf);
    if (!W) return [0, 1, 2, 3].map(function () { return hexOf(P[1]); });
    return W.w.map(function (row, i) {
      var c = W.c[night ? 'night' : 'day'][i] * 255;
      return hexOf([0, 1, 2].map(function (ch) { return row.reduce(function (s, wk, k) { return s + wk * P[k][ch]; }, c); }));
    });
  }
  // a layer's own picture, as a standalone SVG stretched to its box
  function layerSvg(L, P, u) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.vb[0] + ' ' + L.vb[1] + '" preserveAspectRatio="none" aria-hidden="true">' +
      L.draw(P, u) + '</svg>';
  }
  function dataUrl(text) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text); }
  // THE STILL FRAME: the ground and every layer where it starts, in one
  // picture (the picker's thumbnail, the stops' measure). Frame units:
  // 1000 x 700, a box's % of the screen in them.
  function themeFrame(id, P, night, u) {
    var T = THEMES[id], s = T.ground(P, u + 'g_') + (night ? starfield(40, 11, 420) : '');
    T.layers.forEach(function (L, i) {
      var v = u + 'l' + i + '_', op = L.still == null ? 1 : L.still;
      if (L.tile) {
        // (a tile of L.tile px at a 1180-px-wide screen's scale)
        var t = L.tile * 1000 / 1180;
        s += '<defs><pattern id="' + v + 'p" width="' + t.toFixed(2) + '" height="' + t.toFixed(2) + '" patternUnits="userSpaceOnUse">' +
          '<svg width="' + t.toFixed(2) + '" height="' + t.toFixed(2) + '" viewBox="0 0 ' + L.vb[0] + ' ' + L.vb[1] + '">' + L.draw(P, v) + '</svg></pattern></defs>' +
          '<rect width="1000" height="700" fill="url(#' + v + 'p)"/>';
        return;
      }
      if (!op) return;
      var x = L.box[0] * 10, y = L.box[1] * 7, w = L.box[2] * 10, hh = L.box[3] * 7;
      var inner = '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" viewBox="0 0 ' + L.vb[0] + ' ' + L.vb[1] +
        '" preserveAspectRatio="none">' + L.draw(P, v) + '</svg>';
      s += '<g' + (L.rot ? ' transform="rotate(' + L.rot + ' ' + (x + w / 2) + ' ' + (y + hh / 2) + ')"' : '') +
        (op < 1 ? ' opacity="' + op + '"' : '') + '>' + inner + '</g>';
    });
    return s;
  }

  function isTheme(id) { return Object.prototype.hasOwnProperty.call(THEMES, id); }
  function get(id) { return BY_ID[id] || BY_ID[DEFAULT]; }
  // THE SVG of a wallpaper, by day or by night (a theme's still frame, in
  // its colour `col`). `uid` keeps its gradients' ids apart where several
  // are drawn in one document (the picker)
  function svg(id, night, uid, col) {
    var u = (uid || 'hkw') + '_';
    if (isTheme(id)) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        themeFrame(id, palette(id, color(col), night), night, u) + '</svg>';
    }
    var w = get(id), fam = FAMILIES[w.family];
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      DRAW[w.shape](night ? fam.night : fam.day, u) + (night ? stars() : '') + '</svg>';
  }
  // ...as an address a background or an image takes (made once)
  var urls = {};
  function url(id, night, col) {
    var th = isTheme(id), k = (th ? id + '@' + color(col) : get(id).id) + (night ? ':n' : ':d');
    if (!urls[k]) urls[k] = dataUrl(svg(th ? id : get(id).id, night, 'w', col));
    return urls[k];
  }
  // A THEME ON THE SCREEN (hk-sky.js paintWall): its ground's address and
  // its layers, each {url, box | tile, mv, d, rot, still} -- made once per
  // colour and version
  var scenes = {};
  function scene(id, night, col) {
    if (!isTheme(id)) return null;
    var hex = color(col), k = id + '@' + hex + (night ? ':n' : ':d');
    if (scenes[k]) return scenes[k];
    var T = THEMES[id], P = palette(id, hex, night);
    var ground = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      T.ground(P, 'g_') + (night ? starfield(40, 11, 420) : '') + '</svg>';
    scenes[k] = { id: id, key: k, ground: dataUrl(ground), layers: T.layers.map(function (L, i) {
      return { url: dataUrl(layerSvg(L, P, 'l' + i + '_')), box: L.box || null, tile: L.tile || 0, mv: L.mv, d: L.d,
               rot: L.rot || 0, still: L.still == null ? 1 : L.still };
    }) };
    return scenes[k];
  }
  // ...ITS LAYERS, PUT IN AN ELEMENT (the sky's .wall, the screensaver
  // clock's .ckwall): each an <i> with its picture, in its box (or a tile
  // overhanging one tile), carrying how it moves as custom properties for
  // the keyframes of motionCss() below, named `pre` + its kind (the sky's
  // 'hk-wt-'). `sc` null: emptied. Nothing moves until the page's CSS turns
  // the animation on -- without it each layer stands where it starts.
  function paintScene(layer, sc, pre) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (!sc) return;
    sc.layers.forEach(function (L) {
      var i = document.createElement('i'), st = i.style, mv = L.mv || {};
      i.className = mv.an || '';
      st.backgroundImage = 'url("' + L.url + '")';
      if (L.tile) {
        // one tile past the top and left: it moves one tile and round again
        st.left = st.top = -L.tile + 'px'; st.right = st.bottom = '0px';
        st.backgroundSize = L.tile + 'px ' + L.tile + 'px';
        st.setProperty('--tile', L.tile + 'px');
      } else {
        st.left = L.box[0] + '%'; st.top = L.box[1] + '%'; st.width = L.box[2] + '%'; st.height = L.box[3] + '%';
      }
      if (L.rot) st.setProperty('--bt', 'rotate(' + L.rot + 'deg)');
      if (L.still !== 1) st.opacity = String(L.still);
      st.setProperty('--an', (pre || 'hk-wt-') + mv.an);
      st.setProperty('--ad', 'var(--w' + (L.d || 'a') + ')');
      if (mv.or) st.setProperty('--or', mv.or);
      ['tx', 'ty', 'ts', 'to', 'x1', 'y1', 's1', 'x2', 'y2', 's2', 'dl'].forEach(function (k) { if (mv[k] != null) st.setProperty('--' + k, mv[k]); });
      layer.appendChild(i);
    });
  }
  // THE THEMES' MOTION, as CSS for a page: `layer`, the selector of a
  // scene's <i>s; `moving`, the same while it may move; `pre`, the
  // keyframes' prefix. Four keyframes, transform and opacity only -- sway
  // (out and back), loop (round three points), tile (one tile on, and round
  // again: seamless), a meteor's flight -- at the lengths --wa..--wf the page
  // sets for its speed. The sky (hk-sky.js) and the screensaver's clock
  // (hk-saverclock.js) each take it with their own selectors.
  function motionCss(layer, moving, pre) {
    return [
      layer + '{position:absolute;display:block;background-position:0 0;background-size:100% 100%;background-repeat:no-repeat;' +
        'transform:var(--bt,none);transform-origin:var(--or,50% 50%)}',
      layer + '.tile{background-repeat:repeat}',
      moving + '{will-change:transform,opacity;animation:var(--an) var(--ad) ease-in-out var(--dl,0s) infinite alternate both}',
      moving + '.loop{animation-direction:normal}',
      moving + '.tile,' + moving + '.meteor{animation-timing-function:linear;animation-direction:normal}',
      '@keyframes ' + pre + 'sway{from{transform:none;opacity:1}to{transform:translate3d(var(--tx,0),var(--ty,0),0) scale(var(--ts,1));opacity:var(--to,1)}}',
      '@keyframes ' + pre + 'loop{0%,100%{transform:none}33%{transform:translate3d(var(--x1),var(--y1),0) scale(var(--s1))}' +
        '66%{transform:translate3d(var(--x2),var(--y2),0) scale(var(--s2))}}',
      '@keyframes ' + pre + 'tile{from{transform:none}to{transform:translate3d(var(--tile),var(--tile),0)}}',
      '@keyframes ' + pre + 'meteor{0%{transform:var(--bt) translate3d(0,0,0);opacity:0}2%{opacity:1}' +
        '9%,100%{transform:var(--bt) translate3d(60vw,0,0);opacity:0}}'
    ].join('\n');
  }
  // the lengths --wa..--wf, in seconds, at Motion Slow; Medium half, Fast a
  // quarter or so (hk-sky.js), the screensaver's Speed scales them
  var LENGTHS = { a: 46, b: 61, c: 77, d: 24, e: 13, f: 17 };
  // its four stops, {day, night} -- a Color backdrop's shape (a theme's in
  // its colour)
  function stops(id, col) {
    if (isTheme(id)) { var hex = color(col); return { day: themeStops(id, hex, false), night: themeStops(id, hex, true) }; }
    var w = get(id); return { day: w.day.slice(), night: w.night.slice() };
  }

  window.hkWallpapers = {
    version: '1.1.0',
    DEFAULT: DEFAULT,
    // [{id, shape, family, name, theme}], in settings.py's order: the twelve
    // drawn ones, then the six themes (shape 'theme', no family)
    list: function () {
      return LIST.map(function (w) {
        return { id: w[0], shape: w[1], family: w[2], name: FAMILIES[w[2]].name + ' ' + SHAPES[w[1]], theme: false };
      }).concat(THEME_IDS.map(function (id) { return { id: id, shape: 'theme', family: null, name: THEMES[id].name, theme: true }; }));
    },
    has: function (id) { return !!BY_ID[id] || isTheme(id); },
    isTheme: isTheme,
    svg: svg, url: url, stops: stops, scene: scene, paintScene: paintScene, motionCss: motionCss, LENGTHS: LENGTHS,
    // a theme's colour: the presets ([id, name, hex]), the default, and a
    // stored value as "#rrggbb"
    COLORS: COLORS, COLOR_DEFAULT: COLOR_DEFAULT, color: color,
    // the family's five colours (the tests; the stops' measuring tool); a
    // theme's shades in a colour
    colors: function (id, night, col) {
      if (isTheme(id)) return palette(id, color(col), night);
      var f = FAMILIES[get(id).family]; return (night ? f.night : f.day).slice();
    },
    FAMILIES: FAMILIES, SHAPES: SHAPES,
    // the measuring tool's: a theme's still frame drawn from any shades
    _frame: function (id, P, night) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">' + themeFrame(id, P, night, 'm_') + '</svg>';
    },
    _weights: WEIGHTS
  };
})();
