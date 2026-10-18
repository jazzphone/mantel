// THE TEXT SCALE (hk_house/docs/PLAN-2026-10-12-text-scale.md, the user's
// choice A, 2026-10-12): every card's text color is one of three, on dark
// glass --
//   --hk-ink    main       rgba(255,255,255,0.94)
//   --hk-ink-2  secondary  rgba(255,255,255,0.68)
//   --hk-ink-3  faint      rgba(255,255,255,0.40)
// -- written var(--hk-ink-2, rgba(255,255,255,0.68)) wherever text is drawn,
// so the light page's tokens (hk-base.js LIGHT) replace it and HK's screens
// get the scale. 24 secondary shades had drifted in before. A fallback that
// is not the scale value fails here, so the drift cannot come back.
// Not text (a mark, a progress fill) uses its own tokens (--hk-mark,
// --hk-track-fill), never these.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var SCALE = { 'ink': '0.94', 'ink-2': '0.68', 'ink-3': '0.40' };
// over photos (the screensaver's plain forecast band): white, on purpose
var EXCEPT = /\.plain /;
var FILES = ['hk-base', 'hk-calendar', 'hk-cameras', 'hk-chip', 'hk-control', 'hk-energy', 'hk-home',
  'hk-layout', 'hk-library', 'hk-media', 'hk-music', 'hk-popup', 'hk-room', 'hk-row', 'hk-security',
  'hk-stat', 'hk-tile', 'hk-weather', 'hk-detail', 'hk-person'].map(function (n) { return 'frontend/cards/' + n + '.js'; })
  .concat(['hk-charts', 'hk-header', 'hk-timers', 'hk-saver', 'hk-saver-panel', 'hk-menu', 'hk-tabbar', 'hk-notify'].map(function (n) { return 'frontend/modules/' + n + '.js'; }));
var pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
var seen = 0;
FILES.forEach(function (f) {
  var src = read(HK_ROOT + '/' + f), lines = src.split('\n');
  lines.forEach(function (line, i) {
    // hkCards.v('ink-2') writes T's value: a use of the scale, right by
    // construction (design consolidation 5.1)
    seen += (line.match(/\bv\('(ink-3|ink-2|ink)'\)/g) || []).length;
    var re = /var\(--hk-(ink-3|ink-2|ink)\s*,\s*([^)]*\)?)\)/g, m;
    while ((m = re.exec(line))) {
      seen++;
      if (EXCEPT.test(line)) continue;
      var want = 'rgba(255,255,255,' + SCALE[m[1]] + ')';
      var got = m[2].replace(/\s+/g, '');
      ok(f + ':' + (i + 1) + ' --hk-' + m[1] + ' falls back to the scale', got === want, got);
    }
  });
});
ok('the scale is used (found its places)', seen > 150, seen);
print(fail ? 'FAIL ' + fail + ' TEXT SCALE TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' TEXT SCALE TESTS PASS');
