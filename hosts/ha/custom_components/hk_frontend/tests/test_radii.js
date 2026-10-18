// CORNERS (design consolidation 3.4, hk_house/docs/DESIGN.md): a corner is a
// rule from hkCards.R -- the plate (M.radius / 23.5), inner 12, small 8,
// sheet 38 (30), banner 30 (26), small sheet 28, card in a sheet 20, big art
// 22 -- or a capsule (half its height: calc(h / 2), 50%, or a px radius half
// the height its own rule sets), or square (0). Everything else that was
// there on 2026-10-13 (rounded keys, iOS-style groups, chart bars...) is
// recorded per file (fixtures/radii_allow.json, a ratchet: tests/ratchet.js).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/ratchet.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var R = window.hkCards.R, pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
ok('R has the rules', R.plate === 23.5 && R.inner === 12 && R.small === 8 && R.sheet === 38 && R.sheetPhone === 30 &&
   R.banner === 30 && R.bannerPhone === 26 && R.sheetSmall === 28 && R.cardInSheet === 20 && R.bigArt === 22 &&
   R.capsule('52px') === 'calc(52px / 2)');
var RULES = {};
[R.plate, R.inner, R.small, R.sheet, R.sheetPhone, R.banner, R.bannerPhone, R.sheetSmall, R.cardInSheet, R.bigArt, 0]
  .forEach(function (n) { RULES[n + 'px'] = 1; });
RULES['0'] = RULES['50%'] = RULES.inherit = 1;
var FILES = ['cards/hk-base', 'cards/hk-calendar', 'cards/hk-cameras', 'cards/hk-chip', 'cards/hk-control', 'cards/hk-detail',
  'cards/hk-energy', 'cards/hk-headers', 'cards/hk-home', 'cards/hk-layout', 'cards/hk-library', 'cards/hk-media', 'cards/hk-music', 'cards/hk-person',
  'cards/hk-popup', 'cards/hk-room', 'cards/hk-row', 'cards/hk-security', 'cards/hk-stat', 'cards/hk-tile', 'cards/hk-weather',
  'modules/hk-charts', 'modules/hk-header', 'modules/hk-timers', 'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify'];
var found = {}, seen = 0;
FILES.forEach(function (f) {
  read(HK_ROOT + '/frontend/' + f + '.js').split('\n').forEach(function (line) {
    var m, re = /border-radius:\s*([^;'"}`]+)/g;
    while ((m = re.exec(line))) {
      seen++;
      var v = m[1].trim();
      if (RULES[v] || /^'\s*\+/.test(v) || /M\.radius|\$\{/.test(v) || /calc\([^)]*\/\s*2\)/.test(v) || /^var\(/.test(v)) { pass++; continue; }
      // a capsule: a px radius half the height this rule sets
      var px = /^([\d.]+)px$/.exec(v), h = /(?:^|[;{\s])height:\s*([\d.]+)px/.exec(line);
      if (px && h && Math.abs(+px[1] * 2 - +h[1]) < 0.01) { pass++; continue; }
      var k = f.split('/')[1] + ' ' + v;
      found[k] = (found[k] || 0) + 1;
    }
  });
});
ok('corners are read (found their places)', seen > 300, seen);
hkRatchet('radius', 'radii_allow.json', found, ok);
print(fail ? 'FAIL ' + fail + ' RADII TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' RADII TESTS PASS');
