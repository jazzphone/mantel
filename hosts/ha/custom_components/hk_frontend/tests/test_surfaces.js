// THE SURFACES (design consolidation 3.1, hk_house/docs/DESIGN.md): every
// non-text white on dark glass is one of six steps, read from hkCards.T --
//   --hk-line         hairlines, dividers, grid lines     0.10
//   --hk-line-strong  tracks (slider, progress, a bar's empty)  0.18
//   --hk-key          a key, chip or field on a plate     0.10
//   --hk-key-strong   a selected / pressed key            0.18
//   --hk-glyph        an off glyph with no color of its own  0.92
//   --hk-mark         chevrons, ticks, notches, dashed edges  0.32
// -- written var(--hk-line, rgba(255,255,255,0.10)) so a light page's tokens
// (hk-base.js LIGHT) replace them. A fallback that is not T's value fails
// here unless it is a named exception below, each with why.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
var T = window.hkCards.T, LIGHT = window.hkCards.LIGHT;
var TOKENS = ['line', 'line-strong', 'key', 'key-strong', 'glyph', 'mark'];
var EXCEPT = [
  // glyphs over the Music page's artwork tint: white, like the art's own text
  ['hk-music.js', /var\(--hk-glyph,#fff\)/, 'over the artwork'],
  // a glyph standing in for missing artwork: quiet on purpose
  ['hk-music.js', /\.(art|nx \.th|mini \.th|cx \.th) (hk-icon|svg)/, 'artwork placeholder'],
  ['hk-library.js', /color:var\(--hk-glyph,rgba\(255,255,255,0\.(45|7|8)\)\)/, 'artwork placeholder'],
  ['hk-media.js', /color:var\(--hk-glyph,rgba\(255,255,255,0\.7\)\)/, 'artwork placeholder'],
  // the volume row's speaker glyphs, quieter than the controls
  ['hk-music.js', /\.vol svg/, 'volume glyph'],
  // a hollow well (a vacuum or a paused timer): "deliberately not shouting"
  ['hk-home.js', /var\(--hk-glyph,rgba\(255,255,255,0\.80\)\)/, 'hollow well'],
  // an info block's default icon
  ['hk-layout.js', /icon_colors, 'var\(--hk-glyph, rgba\(255,255,255,0\.75\)\)'/, 'info icon'],
  // the speaker route's chevron, drawn with the glyph token
  ['hk-library.js', /\.route svg/, 'route chevron'],
  // the alarm disarmed: its shield quiet
  ['hk-security.js', /hk:shield-off/, 'disarmed shield'],
  // the moon tile's art: the moon and its dark disc
  ['hk-weather.js', /rgba\(226,232,240,0\.95\)|rgba\(0,0,0,0\.28\)/, 'moon art'],
  // a selection ring and a notch drawn over colored bars: they must read
  // against the fill, so stronger than a mark on glass
  ['hk-music.js', /\.cx\.on\{/, 'selection ring'],
  ['hk-stat.js', /stroke:var\(--hk-mark,rgba\(255,255,255,0\.55\)\)/, 'notch over bars'],
  ['hk-charts.js', /background:var\(--hk-mark,rgba\(255,255,255,0\.55\)\)/, 'notch over bars'],
  // a chart's track from its own palette (hk-charts.js C.track)
  ['hk-charts.js', /var\(--hk-line,' \+ C\.track \+ '\)/, 'chart palette']
];
var FILES = ['hk-base', 'hk-calendar', 'hk-cameras', 'hk-chip', 'hk-control', 'hk-energy', 'hk-headers', 'hk-home',
  'hk-layout', 'hk-library', 'hk-media', 'hk-music', 'hk-popup', 'hk-room', 'hk-row', 'hk-security',
  'hk-stat', 'hk-tile', 'hk-weather', 'hk-detail', 'hk-person'].map(function (n) { return 'frontend/cards/' + n + '.js'; })
  .concat(['hk-charts', 'hk-header', 'hk-timers', 'hk-saver-panel', 'hk-menu', 'hk-tabbar', 'hk-notify'].map(function (n) { return 'frontend/modules/' + n + '.js'; }));
var pass = 0, fail = 0, seen = 0, excused = 0;
function ok(name, cond, got) { if (cond) pass++; else { fail++; print('FAIL ' + name + (got !== undefined ? '  got ' + got : '')); } }
var flat = function (s) { return s.replace(/\s+/g, ''); };

ok('T has the six steps', TOKENS.every(function (t) { return typeof T[t] === 'string'; }), TOKENS.filter(function (t) { return !T[t]; }));
ok('T: the steps as planned', flat(T.line) === 'rgba(255,255,255,0.10)' && flat(T['line-strong']) === 'rgba(255,255,255,0.18)' &&
   flat(T.key) === 'rgba(255,255,255,0.10)' && flat(T['key-strong']) === 'rgba(255,255,255,0.18)' &&
   flat(T.glyph) === 'rgba(255,255,255,0.92)' && flat(T.mark) === 'rgba(255,255,255,0.32)');
TOKENS.forEach(function (t) { ok('LIGHT has --hk-' + t, typeof LIGHT['--hk-' + t] === 'string'); });

FILES.forEach(function (f) {
  var base = f.split('/').pop();
  read(HK_ROOT + '/' + f).split('\n').forEach(function (line, i) {
    // hkCards.v('line') writes T's value: right by construction (5.1)
    seen += (line.match(/\bv\('(line-strong|line|key-strong|key|glyph|mark)'\)/g) || []).length;
    var re = /var\(--hk-(line-strong|line|key-strong|key|glyph|mark)\s*,\s*((?:[^()]|\([^()]*\))*)\)/g, m;
    while ((m = re.exec(line))) {
      seen++;
      var got = flat(m[2]);
      if (got === flat(T[m[1]])) { pass++; continue; }
      var ex = EXCEPT.filter(function (e) { return e[0] === base && e[1].test(line); })[0];
      if (ex) { excused++; continue; }
      ok(f + ':' + (i + 1) + ' --hk-' + m[1] + ' falls back to T', false, got);
    }
  });
});
ok('the surfaces are used (found their places)', seen > 100, seen);
ok('the exceptions stay few', excused <= 30, excused);
print(fail ? 'FAIL ' + fail + ' SURFACE TESTS (' + pass + ' passed)' : 'ALL ' + pass + ' SURFACE TESTS PASS');
