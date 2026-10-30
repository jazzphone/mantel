// BLUR (design consolidation 3.3, hk_house/docs/DESIGN.md): every backdrop
// blur is one of hkCards.BLUR's three tiers -- light (chips, the Blur look's
// glass), medium (the tab bar, the floating strip, banners), heavy (sheets,
// the menu, the More sheet) -- or a named exception below. HK Settings (its
// iOS nav bar and alert), HA's dialogs and a pop-up's configured blur are
// not cards' and are not checked.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var B = window.hkCards.BLUR, pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
var flat = function (s) { return s.replace(/\s+/g, ''); };
ok('BLUR has the three tiers', flat(B.light) === 'blur(20px)saturate(1.4)brightness(0.82)' &&
   flat(B.medium) === 'blur(24px)saturate(1.6)' && flat(B.heavy) === 'blur(34px)saturate(1.9)');
// ...and Bright Glass's (2026-10-30, DESIGN.md's Blur row): its plates, tab
// bar, menu and chips
ok('BLUR has the bright tier', flat(B.bright) === 'blur(4px)saturate(1.3)brightness(1.08)', B.bright);
var TIERS = [B.light, B.medium, B.heavy, B.bright].map(flat);
var EXCEPT = {
  // the menu's edge tab: a small plate on the page, lighter than a chip
  'hk-menu.js blur(20px)saturate(1.15)brightness(0.86)': 'edge tab',
  // the speaker panel and the Music page's phone sheet sit on the blurred
  // artwork already; theirs is tuned to it
  'hk-media.js blur(28px)saturate(1.4)': 'speaker panel over the artwork',
  'hk-music.js blur(40px)saturate(1.5)': 'phone sheet over the artwork',
  // the banners' small controls (2 more, Clear All)
  'hk-notify.js blur(18px)saturate(1.6)': 'banner controls',
  // the Person sheet's label over its map
  'hk-person.js blur(20px)saturate(1.5)': 'map label',
  // Bright Glass's sheets (DESIGN.md: "its sheets take blur(34px) saturate(2)"):
  // the tab bar's More and Rooms
  'hk-tabbar.js blur(34px)saturate(2)': 'Bright Glass sheets',
  // ...and its side menu open over the page (a sheet, there)
  'hk-menu.js blur(34px)saturate(2)': 'Bright Glass menu over the page'
};
var FILES = ['cards/hk-base', 'cards/hk-calendar', 'cards/hk-cameras', 'cards/hk-chip', 'cards/hk-control', 'cards/hk-detail',
  'cards/hk-energy', 'cards/hk-home', 'cards/hk-layout', 'cards/hk-library', 'cards/hk-media', 'cards/hk-music', 'cards/hk-person',
  'cards/hk-room', 'cards/hk-grid-cards', 'cards/hk-row', 'cards/hk-security', 'cards/hk-stat', 'cards/hk-tile', 'cards/hk-weather',
  'modules/hk-header', 'modules/hk-timers', 'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify'];
var seen = 0;
FILES.forEach(function (f) {
  var src = read(HK_ROOT + '/frontend/' + f + '.js'), m, base = f.split('/')[1] + '.js';
  var re = /backdrop-filter:\s*(?:var\(--[a-z-]+,)?(blur\([^)]*\)(?:\s*(?:saturate|brightness)\([^)]*\))*)/g;
  while ((m = re.exec(src))) {
    seen++;
    var v = flat(m[1]);
    ok(f + ' ' + v + ' is a BLUR tier (or a named exception)', TIERS.indexOf(v) >= 0 || !!EXCEPT[base + ' ' + v], v);
  }
});
ok('the tiers are used (found their places)', seen >= 20, seen);
print(fail ? 'FAIL ' + fail + ' BLUR TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' BLUR TESTS PASS');
