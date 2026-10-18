// NO PILL NUMBER OUTSIDE THE TABLE (plan 2026-10-13, the HomeKit match,
// step 1.4). Every pill dimension is read from hk-base.js's TILE / CHIP (JS)
// or --hk-pill / --hk-gap (css/hk-responsive.css), so a change of the pill's
// size is a change in one place. This holds the old literals out of the
// code: a 192px, 152px or 82px written anywhere else (comments aside) is a
// pill number that will not follow the table. Exceptions are listed by file
// with the reason; anything else that matches fails.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond, info) { print((cond ? 'PASS ' : 'FAIL ') + name + (cond || !info ? '' : '  -- ' + info)); cond ? pass++ : fail++; }

var FILES = ['cards/hk-base', 'cards/hk-tile', 'cards/hk-chip', 'cards/hk-stat', 'cards/hk-row', 'cards/hk-layout',
  'cards/hk-strategy', 'cards/hk-detail', 'cards/hk-home', 'cards/hk-media', 'cards/hk-library', 'cards/hk-energy',
  'cards/hk-control', 'cards/hk-cameras', 'cards/hk-weather', 'cards/hk-room', 'cards/hk-security', 'cards/hk-popup',
  'cards/hk-music', 'cards/hk-calendar', 'cards/hk-person',
  'modules/hk-menu', 'modules/hk-tabbar', 'modules/hk-notify', 'modules/hk-header', 'modules/hk-timers'];
var PATTERNS = [/\b192px\b/, /\b152px\b/, /\b82px\b/, /repeat\(2,\s*192px\)/, /\b204 \* /];
// file -> [substring of the offending line, why it stays]
var ALLOWED = {
  'cards/hk-detail': [['.lk .core{width:192px;height:192px', 'the lock sheet\'s 192 px circle: not a pill']],
  'cards/hk-calendar': [['.tm{width:82px;', 'the day list\'s time column: not a pill row']]
};

// comments out: block comments, and whole-line // comments (a CSS comment
// inside a JS string is a comment too)
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, ' '); })
            .split('\n').map(function (l) { return /^\s*\/\//.test(l) ? '' : l; });
}
FILES.forEach(function (f) {
  var lines;
  try { lines = code(readFile(root + '/frontend/' + f + '.js')); }
  catch (e) { check(f + ' readable', false, String(e)); return; }
  var bad = [];
  lines.forEach(function (l, i) {
    if (!PATTERNS.some(function (p) { return p.test(l); })) return;
    var ok = (ALLOWED[f] || []).some(function (a) { return l.indexOf(a[0]) >= 0; });
    if (!ok) bad.push((i + 1) + ': ' + l.trim().slice(0, 110));
  });
  check(f + '.js has no pill literal outside the table', !bad.length, bad.join(' | '));
});
// ...and the CSS file: its pill and gap are variables (comments aside)
var css = code(readFile(root + '/frontend/css/hk-responsive.css')).join('\n');
check('hk-responsive.css: no 192 / 82 literal', !/\b192px\b|\b82px\b/.test(css));
check('hk-responsive.css: the rails read --hk-gap',
      (css.match(/var\(--hk-gap\)/g) || []).length >= 2);

// the table itself
var base = readFile(root + '/frontend/cards/hk-base.js');
check('hk-base.js exports the table', base.indexOf('window.hkCards.TILE = TILE;') >= 0 &&
      base.indexOf('window.hkCards.CHIP = CHIP;') >= 0);

print(fail ? 'FAIL ' + fail + ' PILL GEOMETRY TESTS' : 'ALL ' + pass + ' PILL GEOMETRY TESTS PASS');
