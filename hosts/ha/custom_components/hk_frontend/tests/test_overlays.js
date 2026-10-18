// OVERLAYS (design consolidation 3.2, hk_house/docs/DESIGN.md): a dark wash a
// surface wears -- a neutral rgba() at most 70 a channel and 0.4 or more
// opaque -- is one of hkCards.OVER's: the overlay over its own blur
// (28,28,32,0.52), the near-solid one with none (24,24,28,0.93), the floating
// strip (28,28,30,0.62); or a named exception below, each with why.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var O = window.hkCards.OVER, T = window.hkCards.T, pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
function norm(r, g, b, a) { return r + ',' + g + ',' + b + ',' + (+a); }
function of(css) { var m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(css.replace(/\s+/g, '')); return norm(m[1], m[2], m[3], m[4]); }
ok('OVER and T agree', of(O.overlay) === of(T.overlay) && of(O.solid) === of(T['overlay-solid']) && of(O.float) === of(T['float-plate']));
ok('the overlays as planned', of(O.overlay) === '28,28,32,0.52' && of(O.solid) === '24,24,28,0.93' && of(O.float) === '28,28,30,0.62');
var ALLOWED = [of(O.overlay), of(O.solid), of(O.float)];
var EXCEPT = {
  // a backdrop dimming the page under a pop-up or a bare sheet (Bubble's)
  '17,17,17,0.8': 'pop-up backdrop',
  // the Frosted look's own plates
  '34,38,56,0.95': 'Frosted menu', '58,60,68,0.55': 'Frosted edge tab',
  // the choose and confirm dialogs: Apple's alert gray, no blur
  '42,42,44,0.94': 'alert gray',
  // scrims over a camera's picture
  '28,28,30,0.66': 'camera scrim', '28,28,30,0.72': 'camera scrim', '28,28,30,0.75': 'camera scrim',
  // the Now Playing bar's opaque plate (np-plate) and the timer dock on it
  '22,23,26,0.9': 'np-plate', '22,23,26,0.92': 'np-plate',
  // the speaker panel and the Music page's surfaces, tinted like the artwork
  '32,30,38,0.86': 'speaker panel', '20,13,30,0.8': 'music sheet', '36,24,52,0.97': 'music page',
  '40,26,58,0.55': 'music page', '29,20,38,0.6': 'text on a white route pill',
  // banners stacked behind the newest, and their controls
  '48,48,54,0.78': 'banner behind', '62,62,68,0.82': 'banner behind', '50,52,60,0.6': 'banner controls',
  // the Person sheet's label over its map
  '30,30,34,0.62': 'map label'
};
var FILES = ['cards/hk-base', 'cards/hk-calendar', 'cards/hk-cameras', 'cards/hk-chip', 'cards/hk-control', 'cards/hk-detail',
  'cards/hk-energy', 'cards/hk-home', 'cards/hk-layout', 'cards/hk-library', 'cards/hk-media', 'cards/hk-music', 'cards/hk-person',
  'cards/hk-popup', 'cards/hk-room', 'cards/hk-row', 'cards/hk-security', 'cards/hk-stat', 'cards/hk-tile', 'cards/hk-weather',
  'modules/hk-header', 'modules/hk-timers', 'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify', 'shell/hk-overlays'];
var seen = 0;
FILES.forEach(function (f) {
  var src = read(HK_ROOT + '/frontend/' + f + '.js'), m, re = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*(0?\.\d+)\s*\)/g;
  while ((m = re.exec(src))) {
    var r = +m[1], g = +m[2], b = +m[3], a = +m[4];
    // a light page's grays (60,60,67) are LIGHT's, not washes
    if (Math.max(r, g, b) > 70 || Math.min(r, g, b) < 10 || a < 0.4 || (r === 60 && g === 60 && b === 67)) continue;
    seen++;
    var k = norm(r, g, b, a);
    ok(f + ' rgba(' + k + ') is an OVER surface (or a named exception)', ALLOWED.indexOf(k) >= 0 || !!EXCEPT[k], k);
  }
});
ok('the overlays are used (found their places)', seen > 20, seen);
print(fail ? 'FAIL ' + fail + ' OVERLAY TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' OVERLAY TESTS PASS');
