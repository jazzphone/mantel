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

  function get(id) { return BY_ID[id] || BY_ID[DEFAULT]; }
  // THE SVG of a wallpaper, by day or by night. `uid` keeps its gradients'
  // ids apart where several are drawn in one document (the picker)
  function svg(id, night, uid) {
    var w = get(id), fam = FAMILIES[w.family], u = (uid || 'hkw') + '_';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
      DRAW[w.shape](night ? fam.night : fam.day, u) + (night ? stars() : '') + '</svg>';
  }
  // ...as an address a background or an image takes (made once)
  var urls = {};
  function url(id, night) {
    var k = get(id).id + (night ? ':n' : ':d');
    if (!urls[k]) urls[k] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(id, night, 'w'));
    return urls[k];
  }
  // its four stops, {day, night} -- a Color backdrop's shape
  function stops(id) { var w = get(id); return { day: w.day.slice(), night: w.night.slice() }; }

  window.hkWallpapers = {
    version: '1.0.0',
    DEFAULT: DEFAULT,
    // [{id, shape, family, name}], in settings.py's order
    list: function () {
      return LIST.map(function (w) {
        return { id: w[0], shape: w[1], family: w[2], name: FAMILIES[w[2]].name + ' ' + SHAPES[w[1]] };
      });
    },
    has: function (id) { return !!BY_ID[id]; },
    svg: svg, url: url, stops: stops,
    // the family's five colours (the tests; the stops' measuring tool)
    colors: function (id, night) { var f = FAMILIES[get(id).family]; return (night ? f.night : f.day).slice(); },
    FAMILIES: FAMILIES, SHAPES: SHAPES
  };
})();
