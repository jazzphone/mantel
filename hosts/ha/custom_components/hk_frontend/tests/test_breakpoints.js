// THE BREAKPOINTS (design consolidation, hk_house/docs/DESIGN.md): every
// width a media or container query names is one of hkCards.BP's, so a card
// and the page agree on what "a phone" is.
//
//   * css/hk-responsive.css is a plain stylesheet and keeps its literals:
//     each must be a BP value (or BP.phone + 0.02, the band just above it).
//   * In the cards' and modules' JS, a query writes BP (hkCards.BP.phone ...);
//     a literal width left in one is a named exception below, with why.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var BP = window.hkCards.BP;
var pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }

var VALUES = Object.keys(BP).map(function (k) { return BP[k]; });
ok('BP has the plan\'s screens and card widths',
   BP.phone === 640 && BP.tabletUpright === 860 && BP.wide === 900 && BP.desk === 1176 &&
   BP.cardSide === 560 && BP.cardList === 700 && BP.cardHero === 860 && BP.cardTwo === 1000 && BP.cardRows === 1100);

// the stylesheet
var CSS_EXCEPT = {
  // an upright iPad's band (640-1024): the iPad's own width, screens only
  '1023.98': 'iPad band'
};
var css = read(HK_ROOT + '/frontend/css/hk-responsive.css'), m, re = /\((?:max|min)-width:\s*([\d.]+)px\)/g, seen = 0;
while ((m = re.exec(css))) {
  seen++;
  var w = parseFloat(m[1]);
  ok('hk-responsive.css ' + m[1] + 'px is a BP value',
     VALUES.indexOf(w) >= 0 || Math.abs(w - (BP.phone + 0.02)) < 1e-9 || CSS_EXCEPT[m[1]], m[1]);
}
ok('hk-responsive.css has its queries', seen >= 4, seen);

// the JS: no literal query width but the named exceptions
var JS_EXCEPT = {
  // the timer dock's own row width (a container, not the screen): one timer
  // at a time below 600 px of row
  '599': 'the timer dock',
  // a narrow phone: the calendar event editor's tightest layout
  '460': 'calendar editor',
  // the Energy page's cards, widths of their own (measured against their
  // content: three chips, two chips, the house battery's two columns)
  // a backed-up tile (a container query on the tile itself, inside its
  // padding): narrower, its battery and "12.4 kWh today" don't both fit
  '163': 'backed-up tile',
  '1060': 'energy highlights', '520': 'energy highlights', '720': 'house battery',
  // the screensaver (art, its own scale)
  '470': 'screensaver'
};
// a file that builds its CSS before hk-base.js is ready can't read BP: its
// literal is checked against BP's value instead
var EARLY = { 'hk-row.js': 1 };
var FILES = ['hk-base', 'hk-calendar', 'hk-cameras', 'hk-chip', 'hk-control', 'hk-energy', 'hk-home', 'hk-layout',
  'hk-library', 'hk-media', 'hk-music', 'hk-popup', 'hk-room', 'hk-row', 'hk-security', 'hk-stat', 'hk-tile',
  'hk-weather', 'hk-detail', 'hk-person'].map(function (n) { return 'frontend/cards/' + n + '.js'; })
  .concat(['hk-charts', 'hk-header', 'hk-timers', 'hk-saver', 'hk-saver-panel', 'hk-menu', 'hk-tabbar', 'hk-notify']
  .map(function (n) { return 'frontend/modules/' + n + '.js'; }));
var lit = 0, viaBP = 0;
FILES.forEach(function (f) {
  read(HK_ROOT + '/' + f).split('\n').forEach(function (line, i) {
    if (/^\s*\/\//.test(line)) return;
    var r = /@(?:media|container)[^{'`]*?\((?:max|min)-width:\s*([^)]*)\)/g, q;
    while ((q = r.exec(line))) {
      var w = q[1].trim();
      if (/BP\./.test(w)) { viaBP++; continue; }
      var n = /^([\d.]+)px$/.exec(w);
      if (!n) continue;
      lit++;
      var early = EARLY[f.split('/').pop()] && VALUES.indexOf(parseFloat(n[1])) >= 0;
      ok(f + ':' + (i + 1) + ' ' + w + ' reads hkCards.BP (or is a named exception)', !!JS_EXCEPT[n[1]] || early, w);
    }
  });
});
ok('the cards read BP (found its places)', viaBP > 30, viaBP);
// 3.9: a phone is 640 everywhere -- no sheet, banner or calendar draws its
// own 600 px line, in CSS or in script
FILES.forEach(function (f) {
  ok(f + ' has no 600px phone line', !/max-width:\s*600px/.test(read(HK_ROOT + '/' + f)));
});
print(fail ? 'FAIL ' + fail + ' BREAKPOINT TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' BREAKPOINT TESTS PASS');
