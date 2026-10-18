// Woodland Between Occasions (HK Settings -> Sky / Background): New
// Decorations' seasonal woodland, season by season, apart from the holidays'
// own Show (panels/hk-settings-model.js; the sky's side: test_nearscenery.js).
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var M = (typeof window !== 'undefined' ? window : globalThis).hkSettingsModel;
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
ok('the four seasons, autumn under its own name', M.WOODLAND.map(function (w) { return w[1]; }).join() === 'Spring,Summer,Autumn,Winter');
ok('every season (or never set): All Seasons', M.woodlandSummary(['spring', 'summer', 'fall', 'winter']) === 'All Seasons' &&
   M.woodlandSummary(undefined) === 'All Seasons');
ok('some: named in the year\'s order', M.woodlandSummary(['winter', 'summer']) === 'Summer, Winter', M.woodlandSummary(['winter', 'summer']));
ok('none: None', M.woodlandSummary([]) === 'None');
ok('search finds it by season', M.SEARCH.some(function (e) { return e[1] === 'house/sky/woodland' && /autumn/.test(e[3]); }));
print('\n' + (fail ? 'FAIL ' + fail + ' WOODLAND TESTS' : 'ALL ' + pass + ' WOODLAND TESTS PASS'));
if (fail) throw new Error('woodland tests failed');
