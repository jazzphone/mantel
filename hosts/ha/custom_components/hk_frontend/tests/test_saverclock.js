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
var SVG_MARKUP = { analog: 1, numbers: 1, arc: 1, ring: 1 };
load(HK_ROOT + '/frontend/modules/hk-saverclock.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var C = window.hkSaverClock, U = C._, M = window.hkSettingsModel;

print('=== the styles ===');
ok('the styles: Today, the flagship, first; Analog Numbers among them, the HomeView-style three last (2026-10-30)',
   C.STYLES.length === 19 && C.STYLES[0][0] === 'today' && C.STYLES.some(function (s) { return s[0] === 'numbers'; }) && C.STYLES.map(function (s) { return s[0]; }).slice(-3).join() === 'liquid,giant,scattered', true);
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

print('=== Analog Numbers (2026-10-30, HOMEVIEW-LOOK.md Phase F) ===');
(function () {
  var svg = U.numbersSvg(), texts = svg.match(/<text [^>]*>(\d+)<\/text>/g) || [];
  ok('after Analog, as HK Settings and the Home Grid list it', C.STYLES.map(function (s) { return s[0]; }).indexOf('numbers'), C.STYLES.map(function (s) { return s[0]; }).indexOf('analog') + 1);
  ok('twelve numerals, 1 to 12, SF Pro 500 at 23 units', texts.length === 12 && /font-size="23" font-weight="500"/.test(texts[0]) && />12</.test(texts[11]), true);
  ok('...at 71 % of the radius (12 on top, 3 at the right)', /x="0.00" y="-62.80"[^>]*>12</.test(svg) && /x="71.00" y="8.20"[^>]*>3</.test(svg), true);
  ok('60 ticks: 12 hours (86-95.5, 2, white .9) and 48 minutes (90.5-95.5, 1.3, .62)',
     [(svg.match(/rgba\(255,255,255,\.9\)" stroke-width="2"/g) || []).length, (svg.match(/rgba\(255,255,255,\.62\)" stroke-width="1.3"/g) || []).length].join(), '12,48');
  ok('the faint disc and its rim fill the face', /<circle r="98" fill="rgba\(20,0,40,\.18\)" stroke="rgba\(255,255,255,\.28\)"/.test(svg), true);
  ok('hands: hour 52 x 6.4, minute 89 x 5.6, on a neck', /y2="-52" style="stroke:var\(--ckm,#fff\)" stroke-width="6.4"/.test(svg) && /y2="-89" style="stroke:var\(--ckm,#fff\)" stroke-width="5.6"/.test(svg) && /y2="-13"/.test(svg), true);
  ok('a slim white second hand with a tail, coloured by --ckh', /y1="14" y2="-96" style="stroke:var\(--ckh,#fff\)" stroke-width="1.2"/.test(svg), true);
  ok('no date', /class="dl/.test(svg), false);
  ok('its colours colour the second hand (White its own)', C.COLORS.numbers[0][0] + ':' + C.COLORS.numbers.slice(1).every(function (c) { return !!c[2]['--ckh']; }), 'white:true');
})();

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

print('=== nothing runs under the black (2026-10-29) ===');
(function () {
  // the stub's timers are by hand: count what is armed, run what a frame would
  var rafs = 0, raf0 = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = function (f) { rafs++; __timers.push({ fn: f, ms: 0 }); return __timers.length; };
  var caf0 = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = function (id) { clearInterval(id); };
  var blackNow = false;
  window.hkSaver = { black: function () { return blackNow; } };
  var live = function () { return __timers.filter(function (t) { return t && t.ms > 0; }).length; };   // (the frame requests are counted apart)
  var tell = function (on) { blackNow = on; window.dispatchEvent(new CustomEvent('hk-black', { detail: { on: on } })); };

  // CONSTELLATION: the 30-a-second loop, plus the face's second
  __resetTimers(); rafs = 0;
  var c = C.mount(document.createElement('div'), { style: 'classic', bg: 'constellation', drift: false, speed: 35 });
  var armed = live(), r0 = rafs;
  ok('a lit screen arms the loop and the second', armed >= 1 && r0 >= 2, true);
  tell(true);
  ok('the black takes down the face’s second', __timers.filter(function (t) { return t && t.ms === 1000; }).length, 0);
  var r1 = rafs; __runTimers();                        // a frame arriving after it
  ok('...and the loop asks for no further frame', rafs, r1);
  tell(false);
  ok('the black ending starts the second again', __timers.filter(function (t) { return t && t.ms === 1000; }).length, 1);
  ok('...and the loop', rafs > r1, true);
  document.hidden = true; __fireVisibility(true);
  ok('a hidden page takes the second down too', __timers.filter(function (t) { return t && t.ms === 1000; }).length, 0);
  __fireVisibility(false);
  ok('...a shown one starts it again', __timers.filter(function (t) { return t && t.ms === 1000; }).length, 1);
  c.destroy();
  ok('destroyed, a black or a shown page starts nothing', (function () { var n = rafs; tell(true); tell(false); return rafs === n && !__timers.filter(function (t) { return t && t.ms === 1000; }).length; })(), true);

  // MORPH: its frame once a second or so
  blackNow = false; __resetTimers();
  c = C.mount(document.createElement('div'), { style: 'classic', bg: 'aurora', drift: false, speed: 35 });
  var n1 = live();
  tell(true);
  ok('a soft background’s timers go under the black', live(), 0);
  tell(false);
  ok('...and come back', live(), n1);
  c.destroy();

  // MOUNTED UNDER A BLACK: nothing armed until it ends
  tell(true); __resetTimers(); rafs = 0;
  c = C.mount(document.createElement('div'), { style: 'classic', bg: 'constellation', drift: false, speed: 35 });
  ok('mounted under the black, nothing is armed', live() === 0 && rafs <= 1, true);
  tell(false);
  ok('...the end of it arms them', live() >= 1 && rafs >= 2, true);
  c.destroy();
  globalThis.requestAnimationFrame = raf0; globalThis.cancelAnimationFrame = caf0; delete window.hkSaver;
})();

print('=== the HomeView-style faces (2026-10-30; HOMEVIEW-LOOK.md, Phase I) ===');
(function () {
  // what a face drew: its elements, walked (the stub DOM keeps what was appended)
  var walk = function (n, out) { out = out || []; (n.children || []).forEach(function (k) { out.push(k); walk(k, out); }); return out; };
  var texts = function (n) { return walk(n).filter(function (e) { return String(e.tagName).toLowerCase() === 'text'; }).map(function (e) { return e.textContent; }); };
  var byTag = function (n, t) { return walk(n).filter(function (e) { return String(e.tagName).toLowerCase() === t; }); };
  var cls = function (n, c) { return walk(n).filter(function (e) { return (' ' + (e.className || (e.attrs && e.attrs['class']) || '') + ' ').indexOf(' ' + c + ' ') >= 0; }); };
  // every size the Clock block offers (Home Grid cells of 196 x 150, 10 apart: hk-grid-catalog.js SIZES), and
  // the screens: the tablet held either way, and a phone
  var SIZES = { S: [196, 150], W: [402, 150], T: [196, 310], L: [402, 310], XL: [608, 310], XXL: [1226, 310],
                tablet: [1180, 820], portrait: [820, 1180], phone: [390, 844] };
  var at = new Date(2026, 9, 30, 10, 42, 7);
  var D0 = Date;
  ['liquid', 'giant', 'scattered'].forEach(function (face) {
    var drew = [];
    Object.keys(SIZES).forEach(function (sz) {
      var layer = document.createElement('div'), err = null, c = null;
      layer.clientWidth = SIZES[sz][0]; layer.clientHeight = SIZES[sz][1];
      __resetTimers();
      try {
        globalThis.Date = function () { return arguments.length ? new (Function.prototype.bind.apply(D0, [null].concat([].slice.call(arguments))))() : new D0(at.getTime()); };
        globalThis.Date.now = function () { return at.getTime(); };
        c = C.mount(layer, { style: face, bg: 'none', drift: false, client: window.hkClient.create({ states: {} }) });
      } catch (e) { err = String(e); } finally { globalThis.Date = D0; }
      if (err) { drew.push(sz + ': ' + err); return; }
      var root = layer.children[0];
      var f = cls(root, 'f-' + face)[0];
      if (!f) { drew.push(sz + ': no face'); return; }
      if (!cls(f, 'ckgnd').length) drew.push(sz + ': no ground of its own');
      if (face === 'liquid') {
        var cv = byTag(f, 'canvas')[0];
        if (!cv || cv.width !== SIZES[sz][0] || cv.height !== SIZES[sz][1]) drew.push(sz + ': the canvas is not its box (' + (cv && cv.width) + 'x' + (cv && cv.height) + ')');
      } else {
        var svgs = byTag(f, 'svg'), t = texts(f), vb = svgs[0] && svgs[0].getAttribute('viewBox');
        var want = face === 'giant' ? ['12', '3', '6', '9'] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
        if (want.some(function (n) { return t.indexOf(n) < 0; })) drew.push(sz + ': numerals ' + t.join(','));
        if (face === 'giant' && t.indexOf('FRI 30') < 0) drew.push(sz + ': no date');
        var shape = U.shapeOf({ w: SIZES[sz][0], h: SIZES[sz][1] });
        if (face === 'giant' && vb !== { wide: '-160 -110 320 220', tall: '-110 -160 220 320', square: '-125 -125 250 250' }[shape]) drew.push(sz + ': drawn ' + vb + ' for a ' + shape + ' box');
        // the hands to the minute: 10:42 -- the hour 321, the minute 252 degrees
        var hands = byTag(svgs[0], 'g').map(function (g) { return g.getAttribute('transform'); }).filter(Boolean);
        if (hands.join() !== 'rotate(321.00),rotate(252)') drew.push(sz + ': hands ' + hands.join());
        var sec = svgs.filter(function (s) { return s.getAttribute('class') === 'cksec'; })[0];
        if (!sec || !/^-7(\.\d+)?s$/.test(sec.style.animationDelay || '')) drew.push(sz + ': second hand ' + (sec && sec.style.animationDelay));
      }
      // once a minute, on the minute: never a second's timer
      if (__timers.filter(function (x) { return x && x.ms === 1000; }).length) drew.push(sz + ': a timer every second');
      if (!__timers.filter(function (x) { return x && x.ms > 0 && x.ms <= 60000; }).length) drew.push(sz + ': nothing to the minute');
      c.destroy();
      if (layer.children.length) drew.push(sz + ': left behind');
    });
    ok(face + ' draws at every size the Clock block offers, and on a tablet and a phone', drew.join('; '), '');
  });
  // its ground off over the photos or the forecast (hk-saver.js: ground false), white numerals there
  var l = document.createElement('div'); l.clientWidth = 1180; l.clientHeight = 820;
  var g = C.mount(l, { style: 'giant', bg: 'none', ground: false, drift: false });
  ok('over the photos: no ground, the face bare', !cls(l.children[0], 'ckgnd').length && / bare\b/.test(l.children[0].className), true);
  g.night(true);
  ok('Night Mode: white numerals on its black', / night\b/.test(l.children[0].className), true);
  g.night(false);
  ok('...and back', / night\b/.test(l.children[0].className), false);
  g.destroy();
  // on a generated background: the face's own ground in its place (no painter, no scrim)
  l = document.createElement('div'); l.clientWidth = 1180; l.clientHeight = 820;
  g = C.mount(l, { style: 'scattered', bg: 'aurora', drift: false, speed: 35 });
  ok('on Show: Clock, its own ground, not the background', byTag(l.children[0], 'canvas').filter(function (x) { return x.className === 'ckbg'; }).length === 0 &&
     !cls(l.children[0], 'ckscrim').length && cls(l.children[0], 'ckgnd').length === 1, true);
  g.destroy();
  // a preview (HK Settings): drawn once, nothing scheduled, nothing listened for
  __resetTimers();
  var before = (__winL['hk-black'] || []).length;
  l = document.createElement('div'); l.clientWidth = 1180; l.clientHeight = 820;
  g = C.mount(l, { style: 'liquid', still: true, drift: false });
  ok('a still preview schedules nothing and listens for nothing', __timers.filter(Boolean).filter(function (x) { return x.ms > 0; }).length === 0 &&
     (__winL['hk-black'] || []).length === before && / still\b/.test(l.children[0].className), true);
  g.destroy();
  ok('each has its own colours, its first its own look', ['liquid', 'giant', 'scattered'].every(function (s) { return C.COLORS[s].length >= 4 && !Object.keys(C.COLORS[s][0][2]).length; }), true);
  ok('...they are the faces with a ground of their own', Object.keys(C.OWN).sort().join(), 'giant,liquid,scattered');
  l = document.createElement('div'); l.clientWidth = 1180; l.clientHeight = 820;
  g = C.mount(l, { style: 'giant', color: 'blue', drift: false });
  ok('a colour reaches the face', l.children[0].style.getPropertyValue('--ckg'), '#2f6fd8');
  g.destroy();
})();

print(fail ? 'FAIL ' + fail + ' SAVER CLOCK TESTS' : 'ALL ' + pass + ' SAVER CLOCK TESTS PASS');
if (fail) throw new Error(fail + ' failed');
