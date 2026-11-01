// The screensaver's layout (modules/hk-saverlayout.js; docs/phase12/SCREENSAVER-EDITOR.md): today's options as a
// layout, the layout for each shape of screen, and the plan -- the column of the big element, the row's units, the
// corners stacked from the edges, and ZONES THAT KNOW ABOUT EACH OTHER (the owner's wall tablet, 2026-11-01: Time
// Behind at its largest ran into Home Status and the weather).
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-saverlayout.js');
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
var L = window.hkSaverLayout;
var ids = function (ws) { return ws.map(function (w) { return w.id; }); };
var hit = function (a, b) { return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y); };

print('=== the checks ===');
ok('no layout: nothing to check', L.check(null), null);
ok('a version this build doesn\'t know, a card in the row, five units in the row: refused',
   [L.check({ v: 2 }), L.check({ v: 1, zones: { row: [{ id: 'music_card' }] } }),
    L.check({ v: 1, zones: { row: [{ id: 'temp' }, { id: 'next_event' }, { id: 'aqi' }, { id: 'locks' }] } })], ['saver_layout', 'saver_layout', 'saver_layout']);
var cl = L.clean({ v: 1, big: { size: 99, kind: 'month' }, zones: { row: [{ id: 'temp' }, { id: 'next_event' }, { id: 'aqi' }, { id: 'locks' }], tl: [{ id: 'nope' }, { id: 'clock_card' }] } });
ok('the read keeps what it can: the month, the default size, what fits in the row and the corner',
   [cl.big.kind, cl.big.size, ids(cl.zones.row), ids(cl.zones.tl)], ['month', 24, ['temp', 'next_event', 'aqi'], ['clock_card']]);
ok('fits: room in a zone for one more of a kind', [L.fits({ row: [{ id: 'temp' }, { id: 'aqi' }] }, 'row', 'next_event'), L.fits({ row: [{ id: 'temp' }, { id: 'aqi' }, { id: 'locks' }] }, 'row', 'next_event'),
   L.fits({}, 'bottom', 'temp'), L.fits({}, 'tl', 'date')], [true, false, false, true]);

print('=== today\'s options as a layout ===');
var tb = L.layoutFrom({ show: 'photos', time_behind: true, tb_size: 40, tb_top: 6 });
ok('Photos with Time Behind: the time behind, as large, at the top; the corners as today',
   [tb.big, ids(tb.zones.tl), ids(tb.zones.tr), ids(tb.zones.bl), ids(tb.zones.br)],
   [{ kind: 'time', size: 40, pos: 'top', align: 'center', depth: 'behind' }, ['weather_card'], ['status_card'], ['music_card'], ['timers_card']]);
var ph = L.layoutFrom({ show: 'photos', photo_titles: true, timers: false });
ok('Photos: no big element, the clock over the weather top left, the title, no timers when they are off',
   [ph.big.kind, ids(ph.zones.tl), ids(ph.zones.line), ids(ph.zones.br)], ['none', ['clock_card', 'weather_card'], ['photo_title'], []]);
var bw = L.layoutFrom({ show: 'forecast', forecast_layout: 'big', forecast_big: 'clock' });
ok('Big Weather with the clock: planted on the ground at the left, the readings along the bottom',
   [bw.big.kind, bw.big.pos, bw.big.align, bw.big.depth, ids(bw.zones.bottom)], ['time', 'ground', 'left', 'planted', ['readings']]);
ok('Big Weather with the temperature: in front', [L.layoutFrom({ show: 'forecast', forecast_layout: 'big' }).big.kind, L.layoutFrom({ show: 'forecast', forecast_layout: 'big' }).big.depth], ['temp', 'front']);
var fc = L.layoutFrom({ show: 'forecast' });
ok('the classic Forecast: no big element, the details along the bottom', [fc.big.kind, ids(fc.zones.tl), ids(fc.zones.bottom)], ['none', ['clock_card'], ['forecast_band']]);
ok('Glance, Month, Day, Clock', ['glance', 'month', 'day', 'clock'].map(function (s) { var x = L.layoutFrom({ show: s }); return x.big.kind + ' ' + x.big.pos; }),
   ['date top', 'month center', 'date center', 'time center']);
ok('every one of them checks', ['photos', 'forecast', 'clock', 'glance', 'month', 'day', 'both'].map(function (s) { return L.check(L.layoutFrom({ show: s, time_behind: s === 'both' })); }),
   [null, null, null, null, null, null, null]);

print('=== sideways and upright ===');
var up = { v: 1, big: { kind: 'time', size: 40, pos: 'top', align: 'center', depth: 'front' }, zones: tb.zones, upright: { big: { kind: 'time', size: 28, pos: 'upper', align: 'center', depth: 'front' } } };
ok('upright takes its own big element, keeps the zones', [L.oriented(up, 820, 1180).big.size, L.oriented(up, 1280, 800).big.size, L.oriented(up, 820, 1180).zones === tb.zones], [28, 40, true]);

print('=== the plan ===');
var room = { x: 0, y: 0, w: 1280, h: 800 };
// the time 40 % of the shorter side, about as Classic draws it
var bigOf = function (size) { var h = size * 8 * 0.95; return { w: h * 2.15, h: h, base: h * 0.8 }; };
var P = L.plan(room, L.oriented(tb, 1280, 800), { big: bigOf(40) }, { w: 1280, h: 800 });
ok('the wall tablet\'s case: Home Status, which the time reached, moves out of its way to the bottom; the weather, clear of it, stays',
   P.moved.map(function (m) { return m.zone + '>' + m.to; }), ['tr>br']);
var wide = L.plan(room, L.oriented(Object.assign({}, tb, { big: Object.assign({}, tb.big, { size: 44 }) }), 1280, 800), { big: { w: 1150, h: 334, base: 267 } }, { w: 1280, h: 800 });
ok('...and a time wide enough to reach both: both move', wide.moved.map(function (m) { return m.zone + '>' + m.to; }), ['tl>bl', 'tr>br']);
var all = [];
Object.keys(P.corners).forEach(function (z) { P.corners[z].forEach(function (c) { all.push(c); }); });
ok('...stacked over the music and the timers, nothing on the time and nothing on each other',
   [all.length, all.some(function (c) { return hit(c, P.col); }), all.some(function (a, i) { return all.some(function (b, j) { return i < j && hit(a, b); }); })], [4, false, false]);
ok('...the music still at the very bottom, the weather above it', [P.corners.bl[0].y > P.corners.tl[0].y, Math.round(P.corners.bl[0].y + P.corners.bl[0].h)], [true, Math.round(800 - P.m)]);
var small = L.plan(room, L.oriented(tb, 1280, 800), { big: bigOf(16) }, { w: 1280, h: 800 });
ok('a small time: nothing moves', small.moved, []);
var full = Object.assign({}, tb, { zones: Object.assign({}, tb.zones, { bl: [{ id: 'music_card' }, { id: 'clock_card' }] }) });
var F = L.plan(room, L.oriented(full, 1280, 800), { big: { w: 1200, h: 690, base: 550 } }, { w: 1280, h: 800 });
ok('no room even at the other end: left out, and said so', F.moved.filter(function (m) { return m.to === null; }).length > 0, true);
var row = { v: 1, big: { kind: 'time', size: 26, pos: 'upper', align: 'center', depth: 'front' }, zones: { line: [{ id: 'date' }], row: [{ id: 'temp' }, { id: 'next_event' }, { id: 'aqi' }], tl: [], tr: [], bl: [], br: [], bottom: [] } };
var R = L.plan(room, row, { big: bigOf(26) }, { w: 1280, h: 800 });
ok('the row: a rectangular widget two units wide, centred under the time',
   [R.row.items.length, Math.round(R.row.items[1].w / R.row.items[0].w * 10) / 10, Math.round(R.row.box.x + R.row.box.w / 2), R.row.box.y > R.big.y + R.big.h],
   [3, 2.2, 640, true]);
ok('the line above the time, the time above the row', [R.line.y + R.line.h <= R.big.y, R.big.y + R.big.h <= R.row.box.y], [true, true]);
var g = L.plan(room, L.oriented(bw, 1280, 800), { big: { w: 560, h: 320, base: 256 } }, { w: 1280, h: 800 });
ok('On the Ground: the baseline on the land\'s ground line (68 % down the art)', Math.round(g.big.y + 256), 544);
ok('...and the band along the bottom, clear of it', g.bottom.y >= g.big.y + g.big.h, true);
var pane = L.plan({ x: 0, y: 0, w: 880, h: 800 }, L.oriented(tb, 880, 800), { big: bigOf(24) }, { w: 1280, h: 800 });
ok('beside the Side Pane: everything in the room it leaves', Object.keys(pane.corners).every(function (z) { return pane.corners[z].every(function (c) { return c.x + c.w <= 880; }); }), true);

// UPRIGHT, WIDE CARDS (2026-11-01, the first layouts in WebKit): Home Status, moved to the bottom, was drawn over the
// weather beside it -- where the two sides' cards would meet they are one stack
var upr = L.plan({ x: 0, y: 0, w: 820, h: 1180 }, L.oriented(tb, 820, 1180), { big: { w: 520, h: 236, base: 200 },
  widget: function (id) { return { status_card: { w: 475, h: 40 }, weather_card: { w: 300, h: 44 }, music_card: { w: 360, h: 84 }, timers_card: { w: 246, h: 70 } }[id]; } }, { w: 820, h: 1180 });
var ups = [];
Object.keys(upr.corners).forEach(function (z) { upr.corners[z].forEach(function (c) { ups.push(c); }); });
ok('upright, wide cards: nothing on anything else, nothing on the time',
   [ups.some(function (a, i) { return ups.some(function (b, j) { return i < j && hit(a, b); }); }), ups.some(function (c) { return hit(c, upr.col); })], [false, false]);

print(fail ? 'FAIL ' + fail + ' SAVER ZONES TESTS' : 'ALL ' + pass + ' SAVER ZONES TESTS PASS');
if (fail) throw new Error(fail + ' failed');
