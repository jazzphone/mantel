// TYPE (design consolidation 3.7, hk_house/docs/DESIGN.md): a font size is a
// role from hkCards.TYPE (44 hero, 36 figure-l, 30 figure, 22 title, 34 page
// title, 17 headline, 15 body, 13 caption / label, 11 label-small / micro) or
// one of the Home-app-measured sizes (tile text 15, the chip's 13.3 / 12.6,
// the section heading 19.7, the clock 72, the weather 76). Everything else
// that was there on 2026-10-13 is recorded per file (fixtures/type_allow.json,
// a ratchet: tests/ratchet.js) -- a file may lose one, never gain one.
// HK Settings (iOS) and the art modules are not checked.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/ratchet.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var TY = window.hkCards.TYPE, pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
ok('TYPE has the roles', TY.hero.size === 44 && TY['figure-l'].size === 36 && TY.figure.size === 30 && TY.title.size === 22 &&
   TY['page-title'].size === 34 && TY.headline.size === 17 && TY.body.size === 15 && TY.caption.size === 13 &&
   TY.label.size === 13 && TY['label-small'].size === 11 && TY.micro.size === 11);
var ON = {};
Object.keys(TY).forEach(function (k) { ON[TY[k].size + 'px'] = 1; });
['15px', '13.3px', '12.6px', '19.7px', '72px', '76px'].forEach(function (s) { ON[s] = 1; });
var FILES = ['cards/hk-base', 'cards/hk-calendar', 'cards/hk-cameras', 'cards/hk-chip', 'cards/hk-control', 'cards/hk-detail',
  'cards/hk-energy', 'cards/hk-headers', 'cards/hk-home', 'cards/hk-layout', 'cards/hk-library', 'cards/hk-media', 'cards/hk-music', 'cards/hk-person',
  'cards/hk-popup', 'cards/hk-room', 'cards/hk-row', 'cards/hk-security', 'cards/hk-stat', 'cards/hk-tile', 'cards/hk-weather',
  'modules/hk-charts', 'modules/hk-header', 'modules/hk-timers', 'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify'];
var found = {}, seen = 0;
FILES.forEach(function (f) {
  var src = read(HK_ROOT + '/frontend/' + f + '.js'), m, re = /font-size:\s*([\d.]+px)/g;
  while ((m = re.exec(src))) {
    seen++;
    if (ON[m[1]]) { pass++; continue; }
    var k = f.split('/')[1] + ' ' + m[1];
    found[k] = (found[k] || 0) + 1;
  }
});
ok('sizes are read (found their places)', seen > 300, seen);
hkRatchet('type', 'type_allow.json', found, ok);
print(fail ? 'FAIL ' + fail + ' TYPE TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' TYPE TESTS PASS');
