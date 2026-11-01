// The screensaver's HomeView-style faces (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): Glance, Month,
// Day and Big Weather (modules/hk-saverfaces.js) drawn in a tablet's box either way and a phone's; the month's
// weeks, the Day face's occasion art and look; the weather's readings (hk-weather.js hkWxReadings); and in
// hk-saver.js, the options read, what of a host's cut-out is sound, where the time goes on a photo as it is laid
// out, and the layers Photo Titles and Time Behind put on a photo: the photo, the time, then the photo's subject
// masked over it -- or the time in front.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
var DIR = HK_ROOT + '/';
// the fixtures are of Friday 30 October 2026: the clock is pinned to its noon (fixed_clock.js)
var FIXED_DAY = [2026, 9, 30];
load(DIR + 'tests/fixed_clock.js');
load(DIR + 'tests/dom.js');
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
globalThis.getComputedStyle = globalThis.getComputedStyle || function () { return { getPropertyValue: function () { return ''; } }; };
if (!document.createElementNS) document.createElementNS = function (ns, t) { return document.createElement(t); };
if (!document.createTextNode) document.createTextNode = function (t) { var e = document.createElement('#text'); e.textContent = String(t); return e; };
(function () {
  var noop = function () { return { addColorStop: function () {}, data: new Uint8ClampedArray(64 * 40 * 4) }; };
  var ctx = new Proxy({}, { get: function (t, k) { return k in t ? t[k] : noop; }, set: function (t, k, v) { t[k] = v; return true; } });
  var make = document.createElement;
  document.createElement = function (t) { var e = make.call(document, t); if (String(t).toLowerCase() === 'canvas') e.getContext = function () { return ctx; }; return e; };
})();
load(DIR + 'frontend/modules/hk-saverclock.js');
load(DIR + 'frontend/modules/hk-saverfaces.js');
load(DIR + 'frontend/cards/hk-weather.js');
var F = window.hkSaverFaces, FU = F._, R = window.hkWxReadings;
var walk = function (n, out) { out = out || []; (n.children || []).forEach(function (k) { out.push(k); walk(k, out); }); return out; };
var words = function (n) { return walk(n).map(function (e) { return e.textContent; }).filter(function (t) { return t; }); };

// a fictional house: its weather, a speaker playing, the sun, an air-quality sensor
var STATES = {
  'weather.home': { entity_id: 'weather.home', state: 'partlycloudy', attributes: { temperature: 54.4, temperature_unit: '°F', humidity: 76, wind_speed: 7.2, wind_speed_unit: 'mph' } },
  'media_player.kitchen': { entity_id: 'media_player.kitchen', state: 'playing', last_changed: '2026-10-30T09:00:00Z', attributes: { media_title: 'Late Light', media_artist: 'The Harbor Quartet' } },
  'media_player.den': { entity_id: 'media_player.den', state: 'paused', last_changed: '2026-10-30T09:30:00Z', attributes: { media_title: 'Older', media_artist: 'Someone' } },
  'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { next_setting: '2026-10-30T17:52:00' } },
  'sensor.air_quality': { entity_id: 'sensor.air_quality', state: '21', attributes: { device_class: 'aqi' } }
};
var client = { states: STATES, config: { location_name: 'Fernhill' } };

print('=== the weather now (hkWxReadings) ===');
var w = R.read(client, { daily: [{ temperature: 57.2, templow: 48.6 }] });
ok('temperature, condition and today’s high and low', [w.entity, Math.round(w.temp), w.says, Math.round(w.hi), Math.round(w.lo)], ['weather.home', 54, 'Partly Cloudy', 57, 49]);
ok('the sunset, wind, humidity and air quality', [w.sunset.getHours(), w.sunset.getMinutes(), Math.round(w.wind), w.windUnit, w.humidity, w.aqi], [17, 52, 7, 'mph', 76, 21]);
ok('the place: the house’s name', w.place, 'Fernhill');
ok('no weather in the house: nothing', R.read({ states: {} }), null);

print('=== the month ===');
var M1 = FU.monthGrid(new Date(2026, 9, 30), 0);
ok('October 2026 from Sunday: four of September first, five weeks', [M1.title, M1.cells[0].d, M1.cells[0].other, M1.cells[4].d, M1.weeks], ['October 2026', 27, true, 1, 5]);
ok('...today marked, once', M1.cells.filter(function (c) { return c.today; }).map(function (c) { return c.d; }), [30]);
ok('...it ends on a Saturday: no days after it', M1.cells.slice(-1)[0], { d: 31, today: false });
ok('...a month that doesn\u2019t: the next one\u2019s days faded', FU.monthGrid(new Date(2026, 10, 3), 0).cells.slice(-1)[0], { d: 5, other: true });
var M2 = FU.monthGrid(new Date(2026, 9, 30), 1);
ok('from Monday: the heads and three days before', [M2.heads.join(''), M2.cells[0].d], ['MTWTFSS', 28]);

print('=== the Day face’s art and look ===');
var occ = function (y, m, d, o) { return FU.occasionOf(new Date(y, m - 1, d), o || { birthdays: [] }); };
ok('Halloween: the moon, bats and a web, and a pumpkin', [occ(2026, 10, 30).id, occ(2026, 10, 30).pumpkin], ['halloween', true]);
ok('a birthday first, whatever the day', occ(2026, 10, 30, { birthdays: [{ name: 'Robin', month: 10, day: 30 }] }).id, 'birthday');
ok('Christmas week', occ(2026, 12, 22).id, 'christmas');
ok('the seasons: leaves, frost, blossom, butterflies', [occ(2026, 9, 12).id, occ(2026, 1, 20).id, occ(2026, 4, 20).id, occ(2026, 7, 20).id], ['autumn', 'winter', 'spring', 'summer']);
ok('...six months on in the south', occ(2026, 1, 20, { birthdays: [], hemisphere: 'south' }).id, 'summer');
ok('every picture is the sky’s own', ['2026-10-30', '2026-12-22', '2026-02-10', '2026-07-02', '2026-01-20', '2026-04-20', '2026-07-20', '2026-09-12'].every(function (s) {
  var p = s.split('-'), o = occ(+p[0], +p[1], +p[2]);
  return (o.frame === null || /^[a-z0-9-]+\.webp$/.test(o.frame)) && o.sprites.every(function (x) { return /^[a-z0-9-]+\.webp$/.test(x[0]); });
}), true);
ok('Light, Dark, or by the time of day', [FU.dayDark('light', new Date(2026, 9, 30, 22)), FU.dayDark('dark', new Date(2026, 9, 30, 12)),
   FU.dayDark('auto', new Date(2026, 9, 30, 12)), FU.dayDark('auto', new Date(2026, 9, 30, 21))], [false, true, false, true]);

print('=== what’s playing ===');
ok('the one playing over a paused one', FU.playing(STATES).title, 'Late Light');
ok('...a paused one when nothing plays', FU.playing({ 'media_player.den': STATES['media_player.den'] }).state, 'paused');
ok('...none', FU.playing({}), null);

print('=== each Show draws in the box it has ===');
var SIZES = { tablet: [1180, 820], portrait: [820, 1180], phone: [390, 844], 'beside a pane': [736, 820] };
F.KINDS.forEach(function (kind) {
  var bad = [];
  Object.keys(SIZES).forEach(function (sz) {
    var layer = document.createElement('div'), ctl = null;
    layer.clientWidth = SIZES[sz][0]; layer.clientHeight = SIZES[sz][1];
    __resetTimers();
    try { ctl = F.mount(layer, { kind: kind, client: client, look: 'light' }); } catch (e) { bad.push(sz + ': ' + e); return; }
    var root = layer.children[0], t = words(root).join(' | ');
    if (!/\bhkf\b/.test(root.className) || root.className.indexOf(kind) < 0) bad.push(sz + ': ' + root.className);
    var want = { glance: ['Fri Oct', '30', 'Late Light', 'Playing', 'Fernhill', '54°', 'Partly Cloudy'],
                 month: ['October 2026', '30', 'S', '31'], day: ['Friday', '30'], weather: ['Partly Cloudy', '54°', 'Sunset', '76%', 'AQI', '21'] }[kind];
    want.forEach(function (x) { if (t.indexOf(x) < 0) bad.push(sz + ': no "' + x + '" in ' + t.slice(0, 160)); });
    if (__timers.filter(function (x) { return x && x.ms === 1000; }).length) bad.push(sz + ': a timer every second');
    ctl.night(true);
    if (!/ night\b/.test(root.className)) bad.push(sz + ': Night Mode');
    ctl.destroy();
    if (layer.children.length) bad.push(sz + ': left behind');
  });
  ok(kind + ' draws on a tablet either way, on a phone and beside a pane', bad.join('; '), '');
});
(function () {
  var layer = document.createElement('div');
  var ctl = F.mount(layer, { kind: 'glance', client: client });
  var clk = walk(layer.children[0]).filter(function (e) { return e.className === 'clk'; })[0];
  ok('Glance’s clock is the screensaver’s analog face', !!clk && walk(clk).some(function (e) { return /\bf-(numbers|analog)\b/.test(e.className || ''); }), true);
  ctl.setClient({ states: { 'weather.home': STATES['weather.home'] }, config: {} });
  ok('...the music gone, its corner empties', walk(layer.children[0]).filter(function (e) { return e.className === 'mu'; })[0].style.display, 'none');
  ctl.destroy();
  layer = document.createElement('div');
  ctl = F.mount(layer, { kind: 'day', client: client, look: 'dark' });
  ok('Day, Dark', / dark\b/.test(layer.children[0].className), true);
  ctl.destroy();
  __resetTimers();
  layer = document.createElement('div');
  ctl = F.mount(layer, { kind: 'month', client: client, still: true });
  ok('a still preview schedules nothing', __timers.filter(Boolean).length, 0);
  ctl.destroy();
  ok('Big Weather has no ground of its own: the forecast’s sky is', (function () {
    var l = document.createElement('div'), c2 = F.mount(l, { kind: 'weather', client: client });
    var has = walk(l.children[0]).some(function (e) { return e.className === 'ckbg'; }); c2.destroy(); return has; })(), false);
})();

print('=== the faces’ grounds, the Day face moving, Big Weather beside the music ===');
// THE INK ON EACH FACE (2026-10-31, the owner: the corners white on the light Day face): by its ground's luminance
var noon = new Date(2026, 9, 31, 8, 11), late = new Date(2026, 9, 31, 21, 0);
ok('the grounds’ luminance: Day light and Month light, Glance and Day dark not', [FU.luminance('#eceae5') > 0.6, FU.luminance('#f7f5f2') > 0.6, FU.luminance('#a9bcc6') < 0.6, FU.luminance('#16171b') < 0.1], [true, true, true, true]);
ok('dark ink on Day (light, and By Time of Day in the morning) and Month; light on the rest',
   [FU.inkFor('day', 'light', late), FU.inkFor('day', 'auto', noon), FU.inkFor('day', 'auto', late), FU.inkFor('day', 'dark', noon), FU.inkFor('month', 'auto', noon), FU.inkFor('glance', 'auto', noon), FU.inkFor('weather', 'auto', noon)],
   ['dark', 'dark', 'light', 'light', 'dark', 'light', 'light']);
ok('...and an odd colour reads as dark (white ink)', [FU.inkOn(null), FU.inkOn('red'), FU.luminance('#ffffff'), FU.luminance('#000000')], ['light', 'light', 1, 0]);
// THE DAY FACE MOVING: bats drift, leaves rock, the moon rises a little, the web holds still -- not under Flat or a still preview
ok('how each picture moves (2026-10-31, the owner: "bats flying, leaves falling")', ['bat1.webp', 'moon-hallow.webp', 'leaf-oak-f.webp', 'web.webp', 'sp-petal.webp', 'sp-crystal.webp', 'sp-butterfly.webp', 'sp-heart.webp'].map(FU.motionOf),
   ['fly', 'moon', 'fall', '', 'fall', 'fall', 'flutter', 'drift']);
ok('the moving face’s rules: leaves fall through their places, bats fly across with their wings beating, out of step, none under Reduce Motion',
   [/\.hkf\.day\.live \.art \.fall\{animation:hkf-fall 21s linear infinite\}/.test(FU.CSS), /\.fly\{animation:hkf-fly 19s linear infinite,hkf-flap/.test(FU.CSS),
    /@keyframes hkf-fall\{0%\{translate:0 calc\(-1 \* var\(--y,50cqh\) - 14cqh\)/.test(FU.CSS), FU.CSS.indexOf('animation-delay:var(--k,0s)') >= 0,
    FU.CSS.indexOf('@media (prefers-reduced-motion:reduce){.hkf.day.live .art > *{animation:none}}') >= 0], [true, true, true, true, true]);
ok('...the day and its date move down by what the screensaver says (clear of its corner), the date smaller where it must be',
   [FU.CSS.indexOf('.hkf.day .wd{translate:0 var(--hk-day-push,0px)}') >= 0, FU.CSS.indexOf('.hkf.day .dn{translate:0 var(--hk-day-push-dn,0px);scale:var(--hk-day-scale,1);transform-origin:50% 0}') >= 0], [true, true]);
(function () {
  var mk = function (o) { var l = document.createElement('div'); var c = F.mount(l, Object.assign({ kind: 'day', look: 'light', still: false }, o)); var r = l.children[0]; var cls = r.className; var arts = walk(r).filter(function (e) { return /\b(fly|flutter|fall|moon|drift)\b/.test(e.className || ''); }).length; c.destroy(); return [cls, arts]; };
  var saved = window.hkSettings;
  window.hkSettings = { rendering: function () { return { flat: false }; }, get: function (k, d) { return d; } };
  var live = mk({});
  ok('the Day face moves: .live', /\blive\b/.test(live[0]), true);
  ok('...a still preview doesn’t', /\blive\b/.test(mk({ still: true })[0]), false);
  window.hkSettings = { rendering: function () { return { flat: true }; }, get: function (k, d) { return d; } };
  ok('...nor under Flat', /\blive\b/.test(mk({})[0]), false);
  window.hkSettings = saved;
  ok('...and only the Day face', (function () { var l = document.createElement('div'); var c = F.mount(l, { kind: 'month' }); var k = l.children[0].className; c.destroy(); return /\blive\b/.test(k); })(), false);
})();
// BIG WEATHER WHILE MUSIC PLAYS (2026-10-31): .np, so held sideways its readings move over beside the music
(function () {
  var l = document.createElement('div'), c = F.mount(l, { kind: 'weather', client: { states: STATES, config: {} } });
  var on = /\bnp\b/.test(l.children[0].className);
  var quiet = {}; Object.keys(STATES).forEach(function (k) { if (k.indexOf('media_player.') !== 0) quiet[k] = STATES[k]; });
  c.setClient({ states: quiet, config: {} });
  ok('Big Weather knows when music plays, and when it stops', [on, /\bnp\b/.test(l.children[0].className)], [true, false]);
  c.destroy();
})();

// THE CORNER CLOCK'S OWN MINUTE (2026-10-31, the owner: the preview's clock stood still in a quiet house)
(function () {
  var W = read(DIR + 'frontend/cards/hk-weather.js');
  ok('the clock card asks again on each minute while it is on the page, and lets go when it leaves (chained)',
     [/connectedCallback\(\) \{ super\.connectedCallback\(\); this\._armMinute\(\); \}/.test(W), /disconnectedCallback\(\) \{ clearTimeout\(this\._minT\); this\._minT = null; super\.disconnectedCallback\(\); \}/.test(W),
      /60000 - Date\.now\(\) % 60000 \+ 250/.test(W)], [true, true, true]);
})();

print('=== hk-saver.js: the options, the cut-out, the time’s place ===');
// the page's few pieces hk-saver.js reads at load
location.pathname = '/dashboard-kitchen/0';
location.search = '';
document.body = document.createElement('body');
document.querySelector = function () { return null; };
window.innerWidth = 1180; window.innerHeight = 820;
window.hkCards = { onClient: function () { return function () {}; }, client: function () { return null; } };
load(DIR + 'frontend/modules/hk-saver.js');
var U = window.hkSaver._;
var c0 = U.readCfg({}), c1 = U.readCfg({ show: 'glance', forecast_layout: 'big', photo_titles: true, time_behind: true, day_look: 'dark' });
ok('nothing chosen: as before', [c0.show, c0.forecast_layout, c0.photo_titles, c0.time_behind, c0.day_look], ['photos', 'classic', false, false, 'auto']);
ok('chosen: read', [c1.show, c1.forecast_layout, c1.photo_titles, c1.time_behind, c1.day_look], ['glance', 'big', true, true, 'dark']);
ok('Month and Day are Shows too; anything else is Photos', [U.readCfg({ show: 'month' }).show, U.readCfg({ show: 'day' }).show, U.readCfg({ show: 'week' }).show], ['month', 'day', 'photos']);
ok('...and odd values are their defaults', [U.readCfg({ forecast_layout: 'huge' }).forecast_layout, U.readCfg({ time_behind: 'yes' }).time_behind, U.readCfg({ day_look: 'dusk' }).day_look], ['classic', false, 'auto']);
var MASK = '/api/photos/' + '1'.repeat(32) + '/mask?v=9';
ok('a sound cut-out is kept (a box from before is not)', U.cleanDepth({ depth: { mask: MASK, box: [0.3, 0.1, 0.4, 0.2] } }), { mask: MASK });
ok('...without a box too', U.cleanDepth({ depth: { mask: MASK } }), { mask: MASK });
ok('...an unsound one dropped', [{ depth: { mask: 'x") , url("y' } }, { depth: { mask: '' } }, { depth: { box: [0.1, 0.1, 0.2, 0.2] } }, {}, null].map(U.cleanDepth),
   [null, null, null, null, null]);
// a 3:2 photo filling a 1180 x 820 screen, its focus in the middle: scaled to 1230 x 820, 25 px off each side
var rect = U.drawnRect(3000, 2000, 1180, 820, 'cover', 0.5, 0.5);
ok('where a filled photo is drawn', rect.map(function (v) { return Math.round(v); }), [-25, 0, 1230, 820]);
ok('...and a whole one, letterboxed', U.drawnRect(2000, 3000, 1180, 820, 'contain', 0.5, 0.5).map(function (v) { return Math.round(v); }), [317, 0, 547, 820]);
// THE TIME'S ONE PLACE (2026-10-30): upper centre, the same on every photo -- its figures' box, and where it ends
ok('the figures upper centre: the same box whatever the photo', U.glyphBox(1180, 820, '10:42').map(function (v) { return Math.round(v); }), [332, 93, 516, 142]);
ok('...on a portrait tablet and a phone, from the shorter side', [U.glyphBox(820, 1180, '10:42'), U.glyphBox(390, 844, '9:05')].map(function (b) { return b.map(function (v) { return Math.round(v); }); }),
   [[152, 115, 516, 142], [100, 72, 191, 67]]);
// WHERE THE REST OF THE CORNER GOES (2026-10-31, the owner: "why did the weather leave the upper-left corner?"): the
// corner clock steps aside for the photo's time, and the weather keeps the corner -- no rule moves the corner itself
var TBQ = ':host([tb]:not([forecast]):not([fcslide]):not([muslide]):not([enslide]):not([wxslide]))';
ok('Time Behind: the corner clock steps aside', U.CSS.indexOf(TBQ + ' .info > hk-clock-card{display:none}') >= 0, true);
ok('...and the weather keeps the corner (no rule places the corner under the time)', [U.CSS.indexOf(TBQ + ' .info{'), U.CSS.indexOf('--hk-tb-foot'), U.CSS.indexOf("[tb][pane]")], [-1, -1, -1]);
// A LIGHT FACE'S CORNERS (2026-10-31): the ink the corner cards draw with goes dark, not only the box's colour
ok('a light face: the corners’ ink dark, their glow gone', /:host\(\[ckface\]\[cklight\]:not\(\[cknight\]\)\) \.info\{[^}]*--hk-ink:#1c1c1e[^}]*--hk-glow:none[^}]*--hk-ss-ink:#1c1c1e[^}]*--hk-ss-glow:none/.test(U.CSS), true);
// BIG WEATHER'S CORNERS (2026-10-31, the owner: "Disarmed" over its time): Home Status under the time, the music beside the readings
ok('Big Weather: Home Status under its time, at its edge, at the readings’ sizes', U.CSS.indexOf(':host([fcbig][forecast]:not([pane])) .info,:host([fcbig][fcslide]:not([pane])) .info{--hk-ss-status-top:13.1vmin;--hk-ss-status-right:7.3vmin;\n  --hk-ss-status-width:calc(100vw - 44.6vmin);--hk-ss-status-l1:3.7vmin;--hk-ss-status-l2:2.9vmin;') >= 0, true);
ok('...the music on the face’s bottom row, to its numbers: its margins, a reading’s height, the readings’ sizes',
   U.CSS.indexOf('--hk-ss-now-left:7.3vmin;--hk-ss-now-bottom:6.1vmin;--hk-ss-np-art:14vmin;--hk-ss-np-title:3.7vmin;--hk-ss-np-artist:2.9vmin;--hk-ss-np-gap:2.4vmin;') >= 0, true);
ok('...the row split at 40 % held sideways; upright, a row above the readings', [FU.CSS.indexOf('.hkf.weather.np .rd{left:calc(40cqw + 2.4cqmin);display:flex;justify-content:flex-end;gap:9.8cqmin}') >= 0, U.CSS.indexOf('--hk-ss-now-bottom:calc(6.1vmin + 32vmin + 4vmin)') >= 0, FU.CSS.indexOf('.hkf.weather .rd > div{height:14cqmin;') >= 0], [true, true, true]);
ok('Month: no corner weather over its top line, Home Status under it', [U.CSS.indexOf(':host([ckface=month]) .info hk-weather-strip-card{display:none}') >= 0, /:host\(\[ckface=month\]:not\(\[pane\]\)\) \.info\{--hk-ss-status-top/.test(U.CSS)], [true, true]);
// THE DAY FACE AND THE CORNER (2026-10-31, the owner: the clock "colliding into the name of the Day"): the corner's
// words smaller on it, the weather's glyph in the light face's ink, a phone's Home Status under the corner
ok('the Day face: the corner’s time and weather smaller, smaller still on a phone', [U.CSS.indexOf(':host([ckface=day]) .info > hk-clock-card,:host([ckface=day]) .info > hk-weather-strip-card{zoom:.6}') >= 0,
   U.CSS.indexOf('@media (max-width:599px){:host([ckface=day]:not([pane])) .info > hk-clock-card,:host([ckface=day]:not([pane])) .info > hk-weather-strip-card{zoom:.45}') >= 0], [true, true]);
ok('a light face: the weather glyph’s white in its ink; the pane’s cards keep theirs', [/--hk-wx-w:#1c1c1e\}/.test(U.CSS), U.CSS.indexOf(':host([ckface][cklight][pane]:not([cknight])) .info > hk-screensaver-status-card') >= 0], [true, true]);
// CLOCK ON PHOTOS WITH TIME BEHIND (2026-10-31, the owner: "the clock is dim"): the time over the photos' dark wash
// (.ph::after, z-index 2), and the cut-out over it darkened as much as the wash darkens the photo
ok('the dark wash over the photos is a layer of its own', /:host\(\[ckphotos\]\) \.ph::after\{[^}]*z-index:2/.test(U.CSS), true);
ok('...the time and the titles over it', U.CSS.indexOf(':host([ckphotos]) .ph .tb,:host([ckphotos]) .ph .ttl{z-index:3}') >= 0, true);
ok('...the subject over the time as dark as the photo under the wash', U.CSS.indexOf(':host([ckphotos]) .ph .tb img.tbcut{filter:brightness(calc(1 - var(--hk-ckdim,.35)))}') >= 0, true);
// HOW MUCH THE SUBJECT COVERS: the share of the mask at half or more; behind only from 5 % to 35 %
var px = function (on, n) { var a = []; for (var i = 0; i < n; i++) a.push(0, 0, 0, i < on ? 255 : 0); return a; };
ok('the share of the figures the subject covers', [U.coverShare(px(0, 100)), U.coverShare(px(20, 100)), U.coverShare(px(100, 100)), U.coverShare([])], [0, 0.2, 1, 0]);
ok('behind from 5 % to 35 %: none, a little, some, too much, unread', [0, 0.04, 0.05, 0.2, 0.35, 0.36, 0.9, null].map(U.behindAt),
   [false, false, true, true, true, false, false, false]);

// SETTINGS' OPTIONS, AS THEY CHANGE (2026-10-31): the preview's block is made from the options the page hands it
// (hkSaver.preview's `over`), on this screen's settings -- the screensaver on whatever the screen says
(function () {
  var made = [], HS0 = window.hkSettings, ST0 = window.hkStrategy;
  window.hkSettings = { get: function (k, d) { return k === 'boards' ? { 'dashboard-kitchen': { title: 'Kitchen', screensaver: false, screensaver_options: { show: 'photos' } } } : k === 'look.saver' ? { show: 'forecast' } : d; } };
  window.hkStrategy = { saverBlock: function (c, b) { made.push([b.title, b.screensaver, b.screensaver_options.show]); return { show: b.screensaver_options.show }; } };
  ok('the options handed over make the block, on this screen, the screensaver on', [U.houseBlock({ show: 'day' }), made[0]], [{ show: 'day' }, ['Kitchen', true, 'day']]);
  ok('...none handed over: All Screens’ (the house preview)', U.houseBlock().show, 'forecast');
  window.hkSettings = HS0; window.hkStrategy = ST0;
})();

print('=== Photo Titles and Time Behind on a photo ===');
// a photo's layer, as hk-saver.js builds it (the photo, its scrim)
function layerWith(pos) {
  var lay = document.createElement('div'), fg = document.createElement('img'), scrim = document.createElement('div');
  fg.className = 'fg'; scrim.className = 'phscrim';
  lay.appendChild(fg); lay.appendChild(scrim);
  lay.style.setProperty('--pos', pos || '50% 50%');
  lay.getBoundingClientRect = function () { return { width: 1180, height: 820 }; };
  // (what the saver asks of a layer: its parts by class)
  lay.querySelectorAll = function (sel) { var cs = sel.split(',').map(function (s) { return s.trim().replace(/^\./, ''); });
    return walk(lay).filter(function (e) { return cs.some(function (k) { return (' ' + e.className + ' ').indexOf(' ' + k + ' ') >= 0; }); }); };
  lay.querySelector = function (sel) { return lay.querySelectorAll(sel)[0] || null; };
  lay.insertBefore = function (n, ref) { var i = lay.children.indexOf(ref); n.parentNode = lay; if (i < 0) lay.children.push(n); else lay.children.splice(i, 0, n); return n; };
  return lay;
}
El.prototype.remove = function () { var p = this.parentNode; if (p) p.children = p.children.filter(function (x) { return x !== this; }, this); };
var L = { fit: { fit: 'cover' } };
var PH = { url: '/api/photos/' + '1'.repeat(32) + '/screen', w: 3000, h: 2000,
           item: { id: 'host/p1', album: 'Lake Weekend', year: 2025, depth: { mask: MASK, box: [0.3, 0.1, 0.4, 0.2] } } };
// (the mask's share for this photo on this screen, as weighed once: a fifth of the figures covered)
var KEY = U.tbKey(MASK, 1180, 820, 'cover', [0.5, 0.5], '10:42');
var lay = layerWith();
U.tbShares[KEY] = 0.2; U.tbShares[KEY.replace(/\|5$/, '|4')] = 0.2;
U.photoFaces(lay, PH, L, U.readCfg({ photo_titles: true, time_behind: true }));
var names = lay.children.map(function (e) { return e.className; });
ok('the photo, its time, its title over them, then the scrim', names, ['fg', 'tb behind', 'ttl', 'phscrim']);
var ttl = lay.children[2], tb = lay.children[1];
ok('the title: the album and the year', words(ttl), ['Lake Weekend', '2025']);
var tbt = tb.children[0], cut = tb.children[1];
ok('the time in its one place: nothing set on it here (the stylesheet places it)', [tbt.className, tbt.style.left || '', tbt.style.top || '', tbt.style.fontSize || ''], ['tbt', '', '', '']);
ok('...it tells the time', /^\d{1,2}:\d\d$/.test(tbt.textContent), true);
ok('...and over it the photo again, masked by its cut-out', [cut.tagName, cut.className, cut.src || cut.getAttribute('src'), cut.style['mask-image'], cut.style['-webkit-mask-image']],
   ['img', 'tbcut', PH.url, 'url("' + MASK + '")', 'url("' + MASK + '")']);
// a subject that covers too much of the figures, or none: the time in front, nothing over it
U.tbShares[KEY] = 0.6; U.tbShares[KEY.replace(/\|5$/, '|4')] = 0.6;
lay = layerWith();
U.photoFaces(lay, PH, L, U.readCfg({ time_behind: true }));
ok('a subject over most of the time: in front, nothing masked', [lay.children[1].className, lay.children[1].children.length], ['tb front', 1]);
// a photo without a cut-out: the time in front
lay = layerWith();
U.photoFaces(lay, { url: 'x', w: 3000, h: 2000, item: { id: 'host/p2' } }, L, U.readCfg({ time_behind: true }));
ok('no cut-out: the time in front, and nothing masked', lay.children.map(function (e) { return e.className; }).concat([lay.children[1].children.length]), ['fg', 'tb front', 'phscrim', 1]);
// a mask not yet weighed (here: no Image to read it with): hidden, then in front -- never a guess
lay = layerWith();
U.photoFaces(lay, { url: 'x', w: 3000, h: 2000, item: { id: 'host/p3', depth: { mask: MASK + '0' } } }, L, U.readCfg({ time_behind: true }));
ok('a mask that can\'t be read: in front', lay.children[1].className, 'tb front');
lay = layerWith();
U.photoFaces(lay, PH, L, U.readCfg({}));
ok('neither chosen: the photo as before', lay.children.map(function (e) { return e.className; }), ['fg', 'phscrim']);
U.photoFaces(lay, PH, L, U.readCfg({ photo_titles: true }));
U.photoFaces(lay, PH, L, U.readCfg({ photo_titles: true }));
ok('drawn again: one title, never two', lay.children.map(function (e) { return e.className; }), ['fg', 'ttl', 'phscrim']);
lay = layerWith();
U.photoFaces(lay, { url: 'x', w: 10, h: 10, item: { id: 'host/p4' } }, L, U.readCfg({ photo_titles: true }));
ok('no album and no year: no title', lay.children.map(function (e) { return e.className; }), ['fg', 'phscrim']);
ok('the HomeView-style Shows', Object.keys(U.FACE_SHOWS).sort(), ['day', 'glance', 'month']);
// WHERE THE PHOTO OPTIONS APPLY (2026-10-30): only where the photos are shown as photos -- each saved option either
// has its toggle on that Show's page or does nothing there
var both = { photo_titles: true, time_behind: true };
var where = function (o) { var p = U.photoOpts(U.readCfg(Object.assign({}, both, o))); return [p.titles, p.behind]; };
ok('Photos and Both: as chosen', [where({ show: 'photos' }), where({ show: 'both' })], [[true, true], [true, true]]);
ok('Clock on Photos: as chosen; on Soft photos, Landscapes or its own background: nothing',
   [where({ show: 'clock', clock_bg: 'photos' }), where({ show: 'clock', clock_bg: 'photos', clock_photo_soft: true }),
    where({ show: 'clock', clock_bg: 'landscapes' }), where({ show: 'clock', clock_bg: 'gradient' })],
   [[true, true], [false, false], [false, false], [false, false]]);
ok('the Forecast, Glance, Month and Day: nothing', ['forecast', 'glance', 'month', 'day'].map(function (s) { return where({ show: s }); }),
   [[false, false], [false, false], [false, false], [false, false]]);
lay = layerWith();
U.photoFaces(lay, PH, L, U.readCfg({ show: 'clock', clock_bg: 'photos', clock_photo_soft: true, photo_titles: true, time_behind: true }));
ok('Clock on Soft photos with both saved on: the photo alone (the clock stays the clock)', lay.children.map(function (e) { return e.className; }), ['fg', 'phscrim']);

// THE PLANTED NUMERALS (2026-11-01, hk-saverfaces.js plant()): Big Weather's time standing in the meadow, its
// shadow cast by the scene's sun through one camera fitted to the land
print('=== the planted numerals ===');
ok('Planted Numerals: on unless off', [U.readCfg({}).forecast_planted, U.readCfg({ forecast_planted: false }).forecast_planted, U.readCfg({ forecast_planted: 'no' }).forecast_planted], [true, false, true]);
var rnd = function (p) { return p.map(function (v) { return Math.round(v * 100) / 100; }); };
var G = FU.plGeometry(1280, 800), GU = FU.plGeometry(820, 1180), GW = FU.plGeometry(1920, 1080);
ok('the feet on the land\'s ground line (68 % of the art) at 16:10, upright and 16:9 -- not in the trees upright',
   [Math.round(G.yG * 10) / 10, Math.round(GU.yG * 10) / 10, Math.round(GW.yG * 10) / 10, GU.yG > GU.yT, G.yH < G.yT], [544, 802.4, 696, true, true]);
ok('the figures as Big Weather sets them: 40cqmin sideways, 30 upright, 4.9 in from the left', rnd([G.fs, GU.fs, G.left]), [320, 246, 39.2]);
var apply = function (H3, x, y) { var w = H3[2][0] * x + H3[2][1] * y + H3[2][2]; return [(H3[0][0] * x + H3[0][1] * y + H3[0][2]) / w, (H3[1][0] * x + H3[1][1] * y + H3[1][2]) / w]; };
var morning = FU.castH(G, 2, (128 - 180) * Math.PI / 180), noon = FU.castH(G, 1.7, 0), evening = FU.castH(G, 2, (238 - 180) * Math.PI / 180);
ok('the shadow is attached: every foot stays where it is', [rnd(apply(morning, 100, 544)), rnd(apply(noon, 400, 544)), rnd(apply(evening, 600, 544))], [[100, 544], [400, 544], [600, 544]]);
var top = function (H3) { return apply(H3, 300, 544 - 230); };
ok('...and falls away from the sun: right in the morning, left in the evening, toward us at noon',
   [top(morning)[0] > 300, top(evening)[0] < 300, top(noon)[1] > 544, top(morning)[1] > 544], [true, true, true, true]);
var len = function (e, az) { return FU.castLength(G, e, (az - 180) * Math.PI / 180, 275); };
ok('longer as the sun sinks, eased to a limit near the horizon', [len(30, 200) < len(14, 200), len(14, 200) < len(3, 200), len(0.2, 200) <= 2.6], [true, true, true]);
ok('...never reaching the camera (its far end at least 42 % of the way there)', 1 - 275 * len(1, 180) / G.f >= 0.42 - 1e-9, true);
var sun = function (elev, azim, cover) { return FU.plLight({ elev: elev, azim: azim, cover: cover }, 'fall'); };
ok('the sun\'s shadow: strong on a clear day, faint under cloud, none at night', [sun(30, 180, 0.1).cast > 0.6, sun(24, 160, 0.85).cast < 0.15, sun(-25, 300, 0).cast], [true, true, 0]);
ok('the feet on the grass at every light; the sky\'s soft shadow stronger under cloud', [sun(-25, 300, 0).contact > 0.4, sun(24, 160, 0.85).sky > sun(24, 160, 0.1).sky], [true, true]);
ok('the figures dimmer by night than by day, and readable (never under a third)', [sun(-25, 300, 0).face[0] < sun(30, 180, 0.1).face[0], sun(-25, 300, 0).face[0] > 85], [true, true]);
ok('the side face lit by an afternoon sun on its side, in shade in the morning', sun(20, 230, 0.1).side[0] > sun(20, 130, 0.1).side[0], true);
var lp = document.createElement('div'), cp = F.mount(lp, { kind: 'weather', big: 'clock', planted: false, sky: { elev: 30, azim: 180, cover: 0.1 }, client: client });
var plOf = function (n) { return walk(n).filter(function (e) { return /(^| )pl( |$)/.test(e.className || ''); })[0]; };
ok('Planted Numerals off: nothing planted, the time as before', [plOf(lp).children.length, /planted/.test(lp.children[0].className)], [0, false]);
ok('...and the face takes the sky\'s reading as it changes', typeof cp.light, 'function');
cp.destroy();

print(fail ? 'FAIL ' + fail + ' SAVER FACES TESTS' : 'ALL ' + pass + ' SAVER FACES TESTS PASS');
if (fail) throw new Error(fail + ' failed');
