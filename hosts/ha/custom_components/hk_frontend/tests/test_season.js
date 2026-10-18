// The seasonal sky's per-day schedule: does it dress up today, and is tonight
// spooky? The point of these is that the answer must be STABLE for a whole
// local day, identical on every tablet, and guaranteed on the holiday itself.
var root = HK_ROOT, pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

globalThis.window = globalThis;
globalThis.addEventListener = function () {};
globalThis.location = { pathname: '/' };
globalThis.setInterval = function () { return 1; };
globalThis.clearInterval = function () {};
function stub() {
  return { style: { setProperty: function () {}, getPropertyValue: function () { return ''; } },
           classList: { toggle: function () {}, add: function () {} },
           appendChild: function () {}, insertBefore: function () {},
           querySelector: function () { return null; },
           querySelectorAll: function () { return []; },
           getRootNode: function () { return null; },
           remove: function () {}, children: [] };
}
globalThis.document = { createElement: stub, addEventListener: function () {},
  readyState: 'complete', head: { appendChild: function () {} },
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; }, body: stub() };
// hk-settings.js owns the calendar (skyWindow) and is always loaded first on
// a page: a bootstrap module, ahead of hk-loader and so of hk-sky.
globalThis.localStorage = { getItem: function () { return null; }, setItem: function () {} };
load(root + '/frontend/modules/hk-settings.js');
load(root + '/frontend/modules/hk-sky.js');

var S = window.hkSky._schedule, D = window.hkSky._daysUntil;
function d(y, m, day) { return new Date(y, m - 1, day); }   // local, 1-based month

// ---- the holiday itself is never a gamble -------------------------------
check('Halloween is certain on Oct 31',      S('halloween', d(2026,10,31)).show);
check('Halloween is certain on Oct 29',      S('halloween', d(2026,10,29)).show);
check('Christmas is certain on Dec 25',      S('christmas', d(2026,12,25)).show);
check('Christmas is certain on Dec 23',      S('christmas', d(2026,12,23)).show);
check('Thanksgiving is certain on the day',  S('thanksgiving', d(2026,11,26)).show);
check('Halloween night is spooky on Oct 31', S('halloween', d(2026,10,31)).spooky);

// ---- the garland stays out of early December ----------------------------
// This is the whole point of `within`: sensor.us_holidays says Christmas from
// Thanksgiving, which is a solid month, and a month of garland is wallpaper.
var early = [d(2026,11,27), d(2026,11,30), d(2026,12,3), d(2026,12,6)];
check('no garland between Thanksgiving and Dec 6',
      early.every(function (x) { return !S('christmas', x).show; }));
check('Dec 7 is the first eligible garland day',
      D('christmas', d(2026,12,7)) === 18);

// ---- eligibility ends after the day ------------------------------------
check('nothing after Halloween',  !S('halloween', d(2026,11,1)).show);
check('nothing after Christmas',  !S('christmas', d(2026,12,26)).show);

// ---- determinism: same day, same answer ---------------------------------
var a = S('halloween', new Date(2026, 9, 12, 3, 14));
var b = S('halloween', new Date(2026, 9, 12, 23, 59));
check('same local day gives the same answer at any hour',
      a.show === b.show && a.spooky === b.spooky);
// 8pm local is UTC midnight in EDT -- the bug this guards is a field that
// rebuilds itself in front of you every evening.
var e1 = S('halloween', new Date(2026, 9, 12, 19, 59));
var e2 = S('halloween', new Date(2026, 9, 12, 20, 1));
check('the day does not roll over at 8pm local (UTC midnight)',
      e1.show === e2.show && e1.spooky === e2.spooky);
check('consecutive days differ somewhere in the season',
      (function () {
        for (var i = 1; i < 30; i++) {
          var x = S('halloween', d(2026, 10, i)), y = S('halloween', d(2026, 10, i + 1));
          if (x.show !== y.show) return true;
        }
        return false;
      })());

// ---- the odds actually ramp ---------------------------------------------
function rate(name, from, to, key) {
  var on = 0, n = 0;
  for (var m = from[0], day = from[1]; ; ) {
    var x = d(2026, m, day);
    if (x > d(2026, to[0], to[1])) break;
    var r = S(name, x); n++; if (key ? r.spooky : r.show) on++;
    day++; var dim = new Date(2026, m, 0).getDate();
    if (day > dim) { day = 1; m++; }
  }
  return n ? on / n : 0;
}
var farRate  = rate('halloween', [9, 22], [10, 5]);
var nearRate = rate('halloween', [10, 20], [10, 31]);
check('Halloween gets commoner as Oct 31 approaches (' +
      farRate.toFixed(2) + ' -> ' + nearRate.toFixed(2) + ')', nearRate > farRate);
check('Halloween is not on every day early on', farRate < 0.95);
check('the spooky set is rarer than the leaves',
      rate('halloween', [9, 22], [10, 28], true) <= rate('halloween', [9, 22], [10, 28]));

// ---- days-until arithmetic ----------------------------------------------
check('Thanksgiving 2026 is Nov 26', D('thanksgiving', d(2026,11,1)) === 25);
check('Thanksgiving 2027 is Nov 25', D('thanksgiving', d(2027,11,1)) === 24);
check('days to Christmas counts down', D('christmas', d(2026,12,20)) === 5);
check('an unknown season shows nothing', !S('', d(2026,10,31)).show);

// ---- the calendar is configurable ---------------------------------------
var HS = window.hkSettings, W = HS.skyWindow;
check('built in: Halloween starts Sep 22', !W('halloween', d(2026,9,21)).inside && W('halloween', d(2026,9,22)).inside);
check('built in: Christmas is Dec 7..25', !W('christmas', d(2026,12,6)).inside && W('christmas', d(2026,12,7)).inside);
check('built in: Thanksgiving ends on US Thanksgiving', W('thanksgiving', d(2026,11,26)).daysToEnd === 0 &&
      !W('thanksgiving', d(2026,11,27)).inside);
check('built in: winter wraps New Year', W('winter', d(2027,1,10)).inside && W('winter', d(2026,12,21)).inside &&
      !W('winter', d(2026,3,20)).inside);
HS._apply({ configured: true, sky: { hemisphere: 'south' } });
check('south: spring is Sep 22..Dec 20', W('spring', d(2026,10,1)).inside && !W('spring', d(2026,4,1)).inside);
HS._apply({ configured: true, sky: { christmas_from: '12-20', christmas_to: '01-05' } });
check('a custom window may run past New Year', W('christmas', d(2027,1,5)).inside && !W('christmas', d(2027,1,6)).inside &&
      W('christmas', d(2026,12,20)).inside && !W('christmas', d(2026,12,19)).inside);
check('...and counts down to ITS last day', W('christmas', d(2026,12,31)).daysToEnd === 5);
check('...and the sky follows it', S('christmas', d(2027,1,5)).show && !S('christmas', d(2026,12,10)).show);
HS._apply({ configured: true, sky: { halloween_often: 'every_day' } });
var every = true;
for (var i = 22; i <= 30; i++) every = every && S('halloween', d(2026,9,i)).show;
check('every day: every day of the window', every);
HS._apply({ configured: true, sky: { halloween_often: 'near_end' } });
check('only the last days: not before them', !S('halloween', d(2026,10,27)).show && !S('halloween', d(2026,9,24)).show);
check('...and always on them', S('halloween', d(2026,10,29)).show && S('halloween', d(2026,10,31)).show);
HS._apply({ configured: true, sky: { halloween_often: 'every_day', spooky_often: 'never' } });
var anySpooky = false;
for (var j = 22; j <= 30; j++) anySpooky = anySpooky || S('halloween', d(2026,9,j)).spooky;
check('spooky nights never: leaves only', !anySpooky && !S('halloween', d(2026,10,31)).spooky &&
      S('halloween', d(2026,10,31)).show);
HS._apply({ configured: true, sky: { halloween_often: 'every_day', spooky_often: 'every_night' } });
var allSpooky = true;
for (var k = 22; k <= 30; k++) allSpooky = allSpooky && S('halloween', d(2026,9,k)).spooky;
check('spooky nights every night', allSpooky);
HS._apply({ configured: true, sky: { thanksgiving_to: '11-30' } });
check('Thanksgiving can end on a date instead', W('thanksgiving', d(2026,11,30)).daysToEnd === 0);
HS._apply({ configured: true });

// ---- the witch flies against the moon it is given -----------------------
// The spooky moon: a 384px box, 0.85 of it disc, centred at 70% / 24%.
var WP = window.hkSky._witchPath;
function witchChecks(label, VW, VH) {
  var p = WP(VW, VH, 384, 0.70, 0.24), disc = 384 * 0.85, cx = VW * 0.70;
  var span = p.w * 975 / 1024 / disc;
  check(label + 'broom tip to bristles is 55-60% of the visible disc (' + span.toFixed(3) + ')',
        span >= 0.55 && span <= 0.60);
  check(label + 'a 2:1 box, like the art', Math.abs(p.h - p.w / 2) <= 1);
  check(label + 'right to left', p.dx < 0);
  check(label + 'inside the viewport where she appears',
        p.left >= 0 && p.left + p.w <= VW && p.top >= 0 && p.top + p.h <= VH);
  check(label + 'inside the viewport where she fades out',
        p.left + p.dx >= 0 && p.left + p.dx + p.w <= VW && p.top + p.dy >= 0 && p.top + p.dy + p.h <= VH);
  check(label + 'mostly horizontal', Math.abs(p.dy) <= Math.abs(p.dx) * 0.05 && p.dy !== 0);
  return { p: p, cx: cx, disc: disc };
}
var t = witchChecks('1280x800: ', 1280, 800);
check('1280x800: starts clear of the disc on the right',
      t.p.left >= t.cx + t.disc / 2 - 1);
check('1280x800: ends clear of the disc on the left',
      t.p.left + t.p.dx + t.p.w <= t.cx - t.disc / 2 + 1);
// Across the UPPER disc, clear of the status chips over its middle, and with
// the disc still wider than she is at that height.
var lineY = t.p.top + t.p.dy / 2 + t.p.h / 2, moonY = 800 * 0.24, off = moonY - lineY;
check('1280x800: flies the upper disc', off > t.disc * 0.2 && off < t.disc * 0.35);
check('1280x800: the disc is wider than her there',
      2 * Math.sqrt(Math.pow(t.disc / 2, 2) - off * off) > t.p.w * 975 / 1024);
check('1280x800: her whole box stays on the moon vertically',
      t.p.top >= moonY - t.disc / 2 && t.p.top + t.p.dy + t.p.h <= moonY + t.disc / 2);
check('follows the moon, not a constant',
      WP(1280, 800, 384, 0.40, 0.24).left < t.p.left);
witchChecks('phone 390x844: ', 390, 844);

// THE SETTINGS PAGE'S PREVIEW: any theme, any date, in its own window only;
// the weather held clear so the theme is what shows; null is today's sky.
(function () {
  var K = window.hkSky, JUNE = new Date(2026, 5, 10, 12);
  var live = { states: { 'sun.sun': { state: 'above_horizon', attributes: { elevation: 12, azimuth: 100 } },
                         'weather.home': { state: 'rainy', attributes: { cloud_coverage: 95 } } } };
  var p = K.preview('halloween', 'spooky');
  var r = K._read(live), plan = K._planned('halloween', JUNE);
  check('preview: Halloween\'s spooky night in June', p && p.id === 'halloween' && p.when === 'spooky' &&
        plan.show === true && plan.spooky === true && r.season === 'halloween' && r.elev < -4);
  check('...under a clear, dry sky, whatever the real weather', r.cond === 'clear-night' && r.wet.kind === 'none' && r.cover < 0.2 && !r.fog);
  K.preview('christmas', 'day');
  r = K._read(live);
  check('preview: Christmas by day', r.season === 'christmas' && r.elev > 0 && r.cond === 'sunny' &&
        K._planned('christmas', JUNE).show === true && K._planned('christmas', JUNE).spooky === false);
  K.preview('fourth-of-july', 'night');
  r = K._read(live);
  check('preview: a surprise (Fourth of July) replaces any season, at night', r.season === '' && r.elev < -4 &&
        K.previewing.id === 'fourth-of-july');
  check('...and a season is no longer forced', K._planned('halloween', JUNE).show === false);
  K.preview(null);
  r = K._read(live);
  check('preview(null): today\'s own sky again -- the real sun and weather', K.previewing === null &&
        r.elev === 12 && r.cond === 'rainy' && r.wet.kind !== 'none');
})();

// ...and it works with Decorations switched OFF -- choosing what to switch on
// is its point. read() empties the season when Decorations is off and the PIN
// puts it back; paint()'s spooky moon also tests s.decorations, so the PIN has
// to carry that too, or Spooky Night previews the ordinary 58px moon.
(function () {
  var K = window.hkSky, nodes = {};
  function node() {
    var n = stub(), values = {}, classes = {};
    n.style.setProperty = function (k, v) { values[k] = v; };
    n.style.getPropertyValue = function (k) { return values[k] || ''; };
    n.classList = { contains: function (k) { return !!classes[k]; },
      toggle: function (k, on) { classes[k] = on; }, add: function (k) { classes[k] = true; } };
    n.classes = classes;
    return n;
  }
  var el = node(); el.clientWidth = 1280; el.clientHeight = 800;
  // no .season box: this is about the moon, which paint() places first
  el.querySelector = function (sel) { return sel === '.season' ? null : (nodes[sel] || (nodes[sel] = node())); };
  HS._apply({ configured: true, sky: { decorations: false } });
  K.preview('halloween', 'spooky');
  var r = K._read({ states: { 'sun.sun': { state: 'above_horizon', attributes: { elevation: 12, azimuth: 100 } } } });
  K._paint(el, r);
  check('preview with Decorations off: Spooky Night still shows the spooky moon',
        r.decorations === true && el.style.getPropertyValue('--moonS') !== '58px' &&
        el.style.getPropertyValue('--moonI').indexOf('moon-hallow') >= 0 && nodes['.moon'].classes.hallow === true);
  K.preview(null);
  HS._apply({ configured: true });
})();

// THE FORECAST SCREENSAVER'S LAND (hkSky.scene): which landscape, by the
// month and hemisphere, the snow, and the sun
(function () {
  var L = window.hkSky._land, dry = { wet: { kind: 'none', rate: 0 }, elev: 30 };
  var north = { config: { latitude: 34.9 } }, south = { config: { latitude: -33.9 } };
  var on = function (m) { return new Date(2026, m, 15); };
  check('land: March in the north is spring', L.season(north, dry, on(2)) === 'spring');
  check('land: July in the north is summer', L.season(north, dry, on(6)) === 'summer');
  check('land: October in the north is fall', L.season(north, dry, on(9)) === 'fall');
  check('land: January in the north is winter', L.season(north, dry, on(0)) === 'winter');
  check('land: January in the south is summer', L.season(south, dry, on(0)) === 'summer');
  check('land: no latitude reads as the north', L.season({}, dry, on(9)) === 'fall');
  check('land: snow falling makes it winter, whatever the month',
        L.season(north, { wet: { kind: 'snow', rate: 0.4 }, elev: 30 }, on(3)) === 'winter');
  check('land: day above 6 degrees', L.light(20) === 'day' && L.light(6.5) === 'day');
  check('land: dusk (and dawn) from 6 down to civil twilight', L.light(6) === 'dusk' && L.light(-6) === 'dusk');
  check('land: night below', L.light(-7) === 'night' && L.light(-40) === 'night');
  check('land: the file name', L.file(north, { wet: { kind: 'none', rate: 0 }, elev: -20 }, on(9)) === 'land-fall-night.webp');
})();

// the forecast screensaver's holidays: which land, which lights (HK Frontend 1.5)
(function () {
  var HL = window.hkSky._holidayLand, LI = window.hkSky._holidayLights;
  var hal = { name: 'halloween', surprise: '' }, xmas = { name: 'christmas', surprise: '' };
  var j4 = { name: '', surprise: 'fourth-of-july' }, bday = { name: '', surprise: 'birthday' };
  // (v6: Halloween has a day land; until its file ships, the fader falls back to plain fall)
  check('holiday land: Halloween by day has its lanterns and pumpkins', HL(hal, 'day') === 'land-halloween-day');
  check('holiday land: Halloween at dusk and night has its pumpkins',
        HL(hal, 'dusk') === 'land-halloween-dusk' && HL(hal, 'night') === 'land-halloween-night');
  check('holiday land: Christmas all day', HL(xmas, 'day') === 'land-christmas-day' && HL(xmas, 'night') === 'land-christmas-night');
  check('holiday land: the Fourth all day', HL(j4, 'day') === 'land-july4-day' && HL(j4, 'dusk') === 'land-july4-dusk');
  check('holiday land: a birthday keeps the season\'s land', HL(bday, 'day') === null);
  check('holiday land: Thanksgiving and no season have none',
        HL({ name: 'thanksgiving', surprise: '' }, 'night') === null && HL({ name: '', surprise: '' }, 'night') === null && HL(null, 'day') === null);
  check('holiday land: another surprise (spring garden) keeps the season\'s land',
        HL({ name: '', surprise: 'spring-garden' }, 'day') === null);
  check('holiday lights: none by day', LI(xmas, 'day') === null && LI(j4, 'day') === null);
  check('holiday lights: Halloween candles flicker', LI(hal, 'night').file === 'land-halloween-night-lights' && LI(hal, 'night').mode === 'flick');
  check('holiday lights: Christmas bulbs twinkle, fainter at dusk',
        LI(xmas, 'dusk').mode === 'twinkle' && LI(xmas, 'dusk').o < LI(xmas, 'night').o);
  check('holiday lights: the Fourth at dusk borrows the night\'s layer',
        LI(j4, 'dusk').file === 'land-july4-night-lights' && LI(j4, 'dusk').o < 1 && LI(j4, 'night').mode === 'breathe');
  check('holiday lights: a birthday has none', LI(bday, 'night') === null);
})();


// Sky look reaches the renderer: weather is removed before paint, while the
// astronomical inputs stay available. No pins or preview are active here.
HS._apply({ sky: { animations: false, weather: false, decorations: false, gradient: 'fjord' } });
var weatherReading = window.hkSky._read({ states: {
  'sun.sun': { attributes: { elevation: -15, azimuth: 240 } },
  'weather.test': { state: 'lightning-rainy', attributes: { cloud_coverage: 95, wind_speed: 30 } }
} });
check('Weather off removes clouds, precipitation, lightning and fog', weatherReading.cover === 0 && weatherReading.wind === 0 && !weatherReading.fog && weatherReading.wet.kind === 'none' && !weatherReading.wet.bolt && weatherReading.weather === false);
check('the sun and moon inputs survive Weather off', weatherReading.elev === -15 && weatherReading.azim === 240 && typeof weatherReading.moon === 'number');
check('Decorations off empties the season and surprise gate', weatherReading.season === '' && weatherReading.seasonalOn === false);
check('animation and curated backdrop reach paint', weatherReading.animations === false && weatherReading.backdrop.night.length === 4);
HS._apply({});

// Paint a small DOM fixture: the gradient and scrim outputs, the animation
// switch, and the ordinary moon while a forced theme is absent.
(function () {
  var nodes = {}, classes = {};
  function node() {
    var n = stub(), values = {};
    n.style.setProperty = function (k, v) { values[k] = v; };
    n.style.getPropertyValue = function (k) { return values[k] || ''; };
    n.classList = { contains: function (k) { return !!classes[k]; },
      toggle: function (k, on) { classes[k] = on; }, add: function (k) { classes[k] = true; } };
    return n;
  }
  var el = node(); el.clientWidth = 1280; el.clientHeight = 800;
  el.querySelector = function (sel) { return nodes[sel] || (nodes[sel] = node()); };
  var state = { elev: 12, azim: 180, cover: 0, wind: 0, fog: false,
    wet: { kind: 'none', rate: 0 }, moon: .5, season: '', seasonalOn: false,
    animations: false, decorations: false,
    backdrop: { day: ['#ffffff', '#ffffff', '#ffffff', '#ffffff'], night: ['#010203', '#020304', '#030405', '#040506'] } };
  window.hkSky._force({ show: true, spooky: true });
  window.hkSky._paint(el, state);
  check('custom day stops reach the renderer', el.style.getPropertyValue('--sk0') === '#ffffff');
  check('bright custom gradients use the normal renderer scrim', el._hkRaw > 86 && el._hkL < el._hkRaw / 2 && Number(el.style.getPropertyValue('--scB')) > .5);
  check('Animations off marks the real sky element', classes.noanim === true);
  state.elev = -15; state.animations = true;
  window.hkSky._paint(el, state);
  check('custom night stops use the sun elevation', el.style.getPropertyValue('--sk0') === '#010203');
  check('Animations on clears the previous off state', classes.noanim === false);
  check('a forced theme without decorations leaves the ordinary moon', el.style.getPropertyValue('--moonS') === '58px');
  window.hkSky._force(null);
})();

// NO animationiteration LISTENER ANYWHERE (2026-10-07 audit). One listener in
// the document makes Chromium wake the main thread at every loop end of every
// CSS animation on the page, for the page's life (measured 18 -> 58 style
// recalcs a second); the shooting stars and fireworks re-aim from a timer
// instead (hk-sky.js reaim).
(function () {
  var files = ['modules/hk-sky.js', 'modules/hk-saver.js', 'modules/hk-glass.js', 'modules/hk-menu.js',
               'modules/hk-tabbar.js', 'modules/hk-notify.js', 'modules/hk-header.js', 'cards/hk-base.js', 'cards/hk-tile.js',
               'cards/hk-weather.js', 'cards/hk-popup.js', 'cards/hk-media.js', 'cards/hk-cameras.js'];
  var bad = files.filter(function (f) { return /['"]animationiteration['"]/.test(read(root + '/frontend/' + f)); });
  check('no animationiteration listener in the sky, the saver or the cards', bad.length === 0);
})();


// THE LIGHTS PAGE FOLLOWS THE SUN: Adaptive Lighting's kelvin, else the
// sun's; each stop keeps its luma (the horizon stays under the live sky's)
(function () {
  var K = window.hkSky, LIGHTS = ['#1c1608', '#3d3211', '#7e6320', '#bb9440'];
  function L(c) { var v = [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function st(map) { var o = {}; Object.keys(map).forEach(function (k) { o[k] = { state: 'on', attributes: map[k] }; }); return { states: o }; }
  var al = st({ 'switch.adaptive_lighting_rgb': { color_temp_kelvin: 6000 }, 'switch.adaptive_lighting_default': { color_temp_kelvin: 3000 },
                'sun.sun': { elevation: 40 } });
  check('lights: Adaptive Lighting\'s kelvin, its "default" switch first', K._sunKelvin(al, null).k === 3000);
  check('lights: the switch picked in Settings', K._sunKelvin(al, { sky_source: ['switch.adaptive_lighting_rgb'] }).k === 6000);
  var sunOnly = st({ 'sun.sun': { elevation: -10 } });
  check('lights: no Adaptive Lighting -- 2000 K under the horizon', K._sunKelvin(sunOnly, null).k === 2000);
  check('lights: ...5500 K high up', K._sunKelvin(st({ 'sun.sun': { elevation: 45 } }), null).k === 5500);
  [2000, 3000, 5500].forEach(function (k) {
    var t = K._tintStops(LIGHTS, k);
    check('lights at ' + k + ' K: every stop keeps its luma', t.every(function (c, i) { return Math.abs(L(c) - L(LIGHTS[i])) < 2.5; }), t);
  });
  var warm = K._tintStops(LIGHTS, 2000)[3], cool = K._tintStops(LIGHTS, 5500)[3];
  function hexes(c) { return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); }
  check('lights: dusk is warmer than midday (more red over blue)', hexes(warm)[0] - hexes(warm)[2] > hexes(cool)[0] - hexes(cool)[2] + 60, [warm, cool]);
})();
print(fail ?'FAIL ' + fail + ' SEASON TESTS' : 'ALL ' + pass + ' SEASON TESTS PASS');
