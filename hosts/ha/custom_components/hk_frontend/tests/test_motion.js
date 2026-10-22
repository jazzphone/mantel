// MOTION (design consolidation 3.6, hk_house/docs/DESIGN.md): every curve a
// card or module writes is one of hkCards.EASE's four -- standard (things
// sliding in), spring (a highlight moving, a banner arriving), build (graphs
// drawing), exit (a banner leaving) -- or `ease` / `linear`, or a named
// exception below. The sky and the screensaver are art, not checked.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var E = window.hkCards.EASE, pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
var flat = function (s) { return s.replace(/\s+/g, ''); };
ok('EASE has the four curves', flat(E.standard) === 'cubic-bezier(.32,.72,0,1)' && flat(E.spring) === 'cubic-bezier(.34,1.24,.42,1)' &&
   flat(E.build) === 'cubic-bezier(.22,.8,.25,1)' && flat(E.exit) === 'cubic-bezier(.4,0,.8,.4)');
var ALLOWED = [E.standard, E.spring, E.build, E.exit].map(flat);
var EXCEPT = {
  // the media sheet flung away: an ease-in, the curve leaving the screen
  'hk-media.js cubic-bezier(.4,0,1,1)': 'fling out',
  // the Music page turning to another room's music
  'hk-music.js cubic-bezier(.45,.05,.25,1)': 'page turn'
};
var FILES = ['cards/hk-base', 'cards/hk-calendar', 'cards/hk-cameras', 'cards/hk-chip', 'cards/hk-control', 'cards/hk-detail',
  'cards/hk-energy', 'cards/hk-home', 'cards/hk-layout', 'cards/hk-library', 'cards/hk-media', 'cards/hk-music', 'cards/hk-person',
  'cards/hk-popup', 'cards/hk-room', 'cards/hk-grid-cards', 'cards/hk-row', 'cards/hk-security', 'cards/hk-stat', 'cards/hk-tile', 'cards/hk-weather',
  'modules/hk-charts', 'modules/hk-header', 'modules/hk-timers', 'modules/hk-saver-panel', 'modules/hk-menu', 'modules/hk-tabbar',
  'modules/hk-notify', 'panels/hk-settings-kit'];
var seen = 0;
FILES.forEach(function (f) {
  var src = read(HK_ROOT + '/frontend/' + f + '.js'), m, re = /cubic-bezier\([^)]*\)/g, base = f.split('/')[1] + '.js';
  while ((m = re.exec(src))) {
    seen++;
    var v = flat(m[0]);
    ok(f + ' ' + v + ' is an EASE curve (or a named exception)', ALLOWED.indexOf(v) >= 0 || !!EXCEPT[base + ' ' + v], v);
  }
});
ok('the curves are used (found their places)', seen > 20, seen);
print(fail ? 'FAIL ' + fail + ' MOTION TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' MOTION TESTS PASS');
