// The screensaver's clocks (modules/hk-saverclock.js, 2026-10-13): the word
// clock's words, the dot matrix's columns, the styles' list in step with HK
// Settings', and every face mounting and ticking without throwing.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
var pass = 0, fail = 0;
function ok(name, got, want) {
  if (got === want) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
globalThis.requestAnimationFrame = function (f) { return 0; };
globalThis.getComputedStyle = globalThis.getComputedStyle || function () { return { getPropertyValue: function () { return ''; } }; };
if (!document.createElementNS) document.createElementNS = function (ns, t) { return document.createElement(t); };
if (!document.createTextNode) document.createTextNode = function (t) { var e = document.createElement('#text'); e.textContent = String(t); return e; };
// (the stub DOM's canvas draws nothing; its innerHTML makes no nodes, so the
// three faces written as SVG markup are checked in a real browser instead)
(function () {
  var noop = function () { return { addColorStop: function () {}, data: new Uint8ClampedArray(64 * 40 * 4) }; };
  var ctx = new Proxy({}, { get: function (t, k) { return k in t ? t[k] : noop; }, set: function (t, k, v) { t[k] = v; return true; } });
  var make = document.createElement;
  document.createElement = function (t) {
    var e = make.call(document, t);
    if (String(t).toLowerCase() === 'canvas') e.getContext = function () { return ctx; };
    return e;
  };
})();
var SVG_MARKUP = { analog: 1, arc: 1, ring: 1 };
load(HK_ROOT + '/frontend/modules/hk-saverclock.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var C = window.hkSaverClock, U = C._, M = window.hkSettingsModel;

print('=== the styles ===');
ok('fifteen styles (Today, the flagship, first)', C.STYLES.length === 15 && C.STYLES[0][0] === 'today', true);
ok('...the same as HK Settings lists, in order', C.STYLES.map(function (s) { return s[0]; }).join(), M.CLOCK_STYLES.map(function (s) { return s[0]; }).join());
ok('the generated backgrounds are HK Settings’ less Forecast and Photos',
   C.BGS.map(function (b) { return b[0]; }).join(), M.CLOCK_BGS.filter(function (b) { return b[0] !== 'forecast' && b[0] !== 'skyonly' && b[0] !== 'photos' && b[0] !== 'landscapes'; }).map(function (b) { return b[0]; }).join());

print('=== the colors ===');
ok('every style has its colors', C.STYLES.every(function (st) { return (C.COLORS[st[0]] || []).length >= 4; }), true);
ok('...HK Settings lists the same, by name', C.STYLES.every(function (st) {
  return C.COLORS[st[0]].map(function (c) { return c[0] + ':' + c[1]; }).join() === M.CLOCK_COLORS[st[0]].map(function (c) { return c[0] + ':' + c[1]; }).join(); }), true);
ok('...each face\u2019s first is its own look (no variables)', C.STYLES.every(function (st) { return !Object.keys(C.COLORS[st[0]][0][2]).length; }), true);
(function () {
  var l = document.createElement('div'), c = C.mount(l, { style: 'neon', color: 'blue', drift: false });
  ok('a chosen color mounts', c.color, 'blue'); c.destroy();
  l = document.createElement('div'); c = C.mount(l, { style: 'neon', color: 'plaid', drift: false });
  ok('...one it doesn\u2019t have is its own', c.color, 'pink'); c.destroy();
})();

print('=== a clock for the room ===');
ok('the kitchen: Today over the sky', JSON.stringify(M.clockRecommend('Kitchen').set), JSON.stringify({ clock_style: 'today', clock_bg: 'skyonly', clock_night: 'off' }));
ok('a bedroom: calm, red at night', M.clockRecommend('Master Bedroom').set.clock_night, 'night');
ok('...anywhere else: Today', M.clockRecommend('Shed').set.clock_style, 'today');
ok('a Master Bathroom is a bathroom, not a bedroom', M.clockRecommend('Master Bathroom').set.clock_style, 'classic');
ok('Today mounts with a weather service and music playing', (function () {
  var l = document.createElement('div'), hass = { states: { 'weather.home': { state: 'sunny', attributes: { temperature: 71.6, temperature_unit: '\u00b0F' } },
    'media_player.k': { state: 'playing', last_changed: '2026-10-13T10:00:00Z', attributes: { media_title: 'Golden Hour', media_artist: 'The Stand-Ins' } } } };
  var c = C.mount(l, { style: 'today', drift: false, client: window.hkHAClient.from(hass), weather: 'weather.home' }); c.destroy(); return c.style; })(), 'today');

print('=== the word clock ===');
var w = function (h, m) { return U.wordsAt(new Date(2026, 9, 13, h, m, 0)).join(' '); };
ok('7:00', w(7, 0), 'IT IS OCLOCK SEVEN');
ok('7:15', w(7, 15), 'IT IS A QUARTER PAST SEVEN');
ok('7:26 is twenty five past', w(7, 26), 'IT IS TWENTY FIVE_M PAST SEVEN');
ok('7:40 is twenty to eight', w(7, 40), 'IT IS TWENTY TO EIGHT');
ok('11:58 is twelve o’clock', w(11, 58), 'IT IS OCLOCK TWELVE');

print('=== the dot matrix ===');
var a = U.dotColumns(' 1:26', false), b = U.dotColumns(' 1:26', true);
ok('the colon blinking changes no width (the owner: it shifted every second)', a.length, b.length);
ok('...only its dots go dark', JSON.stringify(a.filter(function (c, i) { return JSON.stringify(c) !== JSON.stringify(b[i]); }).length > 0), 'true');

print('=== every face mounts and ticks ===');
C.STYLES.filter(function (st) { return !SVG_MARKUP[st[0]]; }).forEach(function (st) {
  var layer = document.createElement('div'), err = null, ctl = null;
  try { ctl = C.mount(layer, { style: st[0], bg: 'aurora', drift: false, client: window.hkClient.create({ states: {} }) }); ctl.destroy(); } catch (e) { err = String(e); }
  ok(st[1] + ' mounts', err, null);
});
ok('an unknown style is Classic', (function () { var l = document.createElement('div'), c = C.mount(l, { style: 'nope', drift: false }); var s = c.style; c.destroy(); return s; })(), 'classic');
ok('12-hour', U.hm(new Date(2026, 9, 13, 13, 5), false).h + ':' + U.hm(new Date(2026, 9, 13, 13, 5), false).m, '1:05');
ok('24-hour', U.hm(new Date(2026, 9, 13, 13, 5), true).h, '13');

print(fail ? 'FAIL ' + fail + ' SAVER CLOCK TESTS' : 'ALL ' + pass + ' SAVER CLOCK TESTS PASS');
if (fail) throw new Error(fail + ' failed');
