// The slow-tablet ladder's word for what was on screen (2026-10-29): the sampler
// (hk-fps.js) sends hkSettings.ladderSignature() and HK Settings works the same
// word out for the screen it shows (M.ladderSignature(M.ladderFacts(...))). A
// sample is only used while the two read alike, so they must -- for every
// combination of the settings the ladder changes.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
document.documentElement = new El('html');
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
load(HK_ROOT + '/frontend/modules/hk-settings.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var S = window.hkSettings, M = window.hkSettingsModel, pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('PASS ' + n); } else { fail++; print('FAIL ' + n + (d !== undefined ? '   ' + JSON.stringify(d) : '')); } }

// the screen under test is the board kept under '' (no address in a test)
function both(look, sky, board, cameras) {
  S._apply({ configured: true, look: look, sky: sky, cameras: cameras, boards: { '': board } });
  var cams = { live: (cameras || {}).live, strip: true };
  return [S.ladderSignature(), M.ladderSignature(M.ladderFacts(board, look, sky, cams))];
}
var cases = [
  ['Blur and a plain sky', { glass: 'blur' }, {}, {}, {}, 'blur:a1w1r1f0c1'],
  ['Glass, Moving Things in front', { glass: 'clear' }, { moving: 'front' }, {}, {}, 'clear:a1w1r1f1c1'],
  ['Frosted, Rain & Snow off', { glass: 'frosted' }, { precipitation: false }, {}, {}, 'frosted:a1w1r0f0c1'],
  ['Tinted, no weather', { glass: 'tinted' }, { weather: false, moving: 'front' }, {}, {}, 'tinted:a1w0r0f1c1'],
  ['Animations off', { glass: 'blur_pre' }, { animations: false, moving: 'front' }, {}, {}, 'blur_pre:a0w1r0f0c1'],
  ['a screen of its own: Animations off, Rain & Snow on, snapshot camera', { glass: 'clear' }, { moving: 'front' },
   { sky_animations: false, sky_precipitation: true, camera_live_video: false }, {}, 'clear:a0w1r0f0c0'],
  ['a screen of its own: Moving Things in front, Weather off', { glass: 'clear' }, {}, { sky_moving: 'front', sky_weather: false }, {}, 'clear:a1w0r0f1c1'],
  ['All Screens’ Live First Camera off', { glass: 'clear' }, {}, {}, { live: false }, 'clear:a1w1r1f0c0'],
  ['...a screen turning it back on', { glass: 'clear' }, {}, { camera_live_video: true }, { live: false }, 'clear:a1w1r1f0c1'],
  ['a color background', { glass: 'blur' }, { background: 'color', moving: 'front' }, {}, {}, 'blur:a0w0r0f0c1'],
  ['a screen of its own color', { glass: 'blur' }, {}, { sky_background: 'color' }, {}, 'blur:a0w0r0f0c1'],
  ['a photo, a landscape', { glass: 'blur' }, { background: 'photo' }, {}, {}, 'blur:a0w0r0f0c1'],
  ['a screen of its own Flat', { glass: 'blur' }, { moving: 'front' }, { flat: true }, {}, 'flat:a0w0r0f0c0'],
  ['All Screens Flat', { flat: true, glass: 'blur' }, {}, {}, {}, 'flat:a0w0r0f0c0'],
  ['a screen of its own Glass over All Screens’ Flat', { flat: true }, {}, { flat: false, glass: 'clear' }, {}, 'clear:a1w1r1f0c1'],
  // BRIGHT GLASS (2026-10-30): a blur style of its own, over a wallpaper (a
  // still: no sky motion to count)
  ['Bright Glass over a wallpaper', { glass: 'bright' }, { background: 'wallpaper' }, {}, {}, 'bright:a0w0r0f0c1'],
  ['...Pre-rendered, a screen of its own over the live sky', { glass: 'clear' }, {}, { glass: 'bright_pre' }, {}, 'bright_pre:a1w1r1f0c1'],
  ['...a screen of its own wallpaper', { glass: 'bright_each' }, {}, { sky_background: 'wallpaper' }, {}, 'bright_each:a0w0r0f0c1']
];
cases.forEach(function (c) {
  var got = both(c[1], c[2], c[3], c[4]);
  ok(c[0] + ': the sampler says ' + c[5], got[0] === c[5], got);
  ok('...and HK Settings says the same', got[0] === got[1], got);
});
// the word is one the server keeps (page_health.py SIG)
ok('every word is a style, a colon and a few letters and digits', cases.every(function (c) {
  return /^(?:flat|clear|frosted|tinted|blur|blur_pre|blur_each|bright|bright_pre|bright_each):[a-z0-9]{1,24}$/.test(c[5]);
}));
// BRIGHT GLASS IS HEAVY (a blur style): a tablet under 45 fps on it is offered
// Glass first, as on Blur, Frosted and Tinted -- in each of its modes
['bright', 'bright_pre', 'bright_each'].forEach(function (g) {
  var facts = M.ladderFacts({ glass: g }, {}, {}, { strip: true });
  var rec = M.slowRecommend('hall', facts, [{ name: 'Hall', fps: 30, fps_screen: 'hall', fps_sig: M.ladderSignature(facts), fps_at: 1000 }], 1000);
  ok(g + ': the slow-tablet ladder offers Glass first', !!rec && rec.step === 'glass' && rec.label === 'Bright Glass' &&
     rec.change.glass === 'clear' && /Glass looks almost the same/.test(rec.says), rec);
});
print(fail ? 'FAIL ' + fail + ' LADDER TESTS' : 'ALL ' + pass + ' LADDER TESTS PASS');
if (fail) throw new Error(fail + ' failed');
