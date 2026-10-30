// The screensaver's HomeView-style faces (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): Glance, Month,
// Day and Big Weather (modules/hk-saverfaces.js) drawn in a tablet's box either way and a phone's; the month's
// weeks, the Day face's occasion art and look; the weather's readings (hk-weather.js hkWxReadings); and in
// hk-saver.js, the options read, what of a host's cut-out is sound, where the time goes on a photo as it is laid
// out, and the layers Photo Titles and Time Behind put on a photo: the photo, the time, then the photo's subject
// masked over it -- or the time in front.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
var DIR = HK_ROOT + '/';
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
ok('a sound cut-out is kept', U.cleanDepth({ depth: { mask: MASK, box: [0.3, 0.1, 0.4, 0.2] } }), { mask: MASK, box: [0.3, 0.1, 0.4, 0.2] });
ok('...an unsound one dropped', [{ depth: { mask: MASK, box: [0.8, 0.1, 0.4, 0.2] } }, { depth: { mask: MASK, box: [0.1, 0.1, 0, 0.2] } }, { depth: { mask: 'x") , url("y', box: [0.1, 0.1, 0.2, 0.2] } },
   { depth: { box: [0.1, 0.1, 0.2, 0.2] } }, {}, null].map(U.cleanDepth), [null, null, null, null, null, null]);
// a 3:2 photo filling a 1180 x 820 screen, its focus in the middle: scaled to 1230 x 820, 25 px off each side
var rect = U.drawnRect(3000, 2000, 1180, 820, 'cover', 0.5, 0.5);
ok('where a filled photo is drawn', rect.map(function (v) { return Math.round(v); }), [-25, 0, 1230, 820]);
ok('...and a whole one, letterboxed', U.drawnRect(2000, 3000, 1180, 820, 'contain', 0.5, 0.5).map(function (v) { return Math.round(v); }), [317, 0, 547, 820]);
ok('the time’s place through it', U.timePlace([0.3, 0.1, 0.4, 0.2], rect, 1180, 820).map(function (v) { return Math.round(v); }), [344, 82, 492, 164]);
ok('...out of what is seen: no place (the time goes in front)', U.timePlace([0.0, 0.1, 0.4, 0.2], U.drawnRect(3000, 1000, 1180, 820, 'cover', 0.5, 0.5), 1180, 820), null);
// the same photo filling a portrait tablet (820 x 1180): scaled to 1770 x 1180, its middle 820 seen -- the place,
// wider than that, made smaller about its foot to fit (a 4 % margin each side), still behind the head
var tall = U.drawnRect(3000, 2000, 820, 1180, 'cover', 0.5, 0.5), pl = U.timePlace([0.26, 0.1, 0.48, 0.19], tall, 820, 1180);
ok('a place wider than what is seen: smaller, about its foot', pl.map(function (v) { return Math.round(v); }), [33, 143, 754, 199]);
ok('...never below half its size', U.timePlace([0.05, 0.1, 0.9, 0.19], tall, 820, 1180), null);
ok('the time as tall as its place, no wider', [Math.round(U.timeFont(492, 164)), Math.round(U.timeFont(200, 164))], [170, 69]);

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
var lay = layerWith();
U.photoFaces(lay, PH, L, U.readCfg({ photo_titles: true, time_behind: true }));
var names = lay.children.map(function (e) { return e.className; });
ok('the photo, its time, its title over them, then the scrim', names, ['fg', 'tb behind', 'ttl', 'phscrim']);
var ttl = lay.children[2], tb = lay.children[1];
ok('the title: the album and the year', words(ttl), ['Lake Weekend', '2025']);
var tbt = tb.children[0], cut = tb.children[1];
ok('the time in its place, sized to it', [tbt.className, tbt.style.left, tbt.style.top, tbt.style.width, tbt.style.height, tbt.style.fontSize],
   ['tbt', '344.0px', '82.0px', '492.0px', '164.0px', '169.7px']);
ok('...it tells the time', /^\d{1,2}:\d\d$/.test(tbt.textContent), true);
ok('...and over it the photo again, masked by its cut-out', [cut.tagName, cut.className, cut.src || cut.getAttribute('src'), cut.style['mask-image'], cut.style['-webkit-mask-image']],
   ['img', 'tbcut', PH.url, 'url("' + MASK + '")', 'url("' + MASK + '")']);
// a photo without a cut-out, or one whose place is cropped away: the time in front
lay = layerWith();
U.photoFaces(lay, { url: 'x', w: 3000, h: 2000, item: { id: 'host/p2' } }, L, U.readCfg({ time_behind: true }));
ok('no cut-out: the time in front, and nothing masked', lay.children.map(function (e) { return e.className; }).concat([lay.children[1].children.length]), ['fg', 'tb front', 'phscrim', 1]);
lay = layerWith();
U.photoFaces(lay, { url: 'x', w: 3000, h: 1000, item: { id: 'host/p3', depth: { mask: MASK, box: [0.0, 0.1, 0.4, 0.2] } } }, L, U.readCfg({ time_behind: true }));
ok('its place cropped away: in front', lay.children[1].className, 'tb front');
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

print(fail ? 'FAIL ' + fail + ' SAVER FACES TESTS' : 'ALL ' + pass + ' SAVER FACES TESTS PASS');
if (fail) throw new Error(fail + ' failed');
