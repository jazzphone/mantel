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
// (v2, phase 13: a piece in a shape; the tests still say it in v1's widget ids, through the v1 map)
var V1OF = {};
Object.keys(L.V1).forEach(function (id) { var m = L.V1[id], k = m[0] + '.' + m[1] + '.' + JSON.stringify(m[2] || {}); if (!V1OF[k]) V1OF[k] = id; });
var v1of = function (w) { return V1OF[w.piece + '.' + w.shape + '.' + JSON.stringify(w.opts || {})] || L.idOf(w); };
var ids = function (ws) { return ws.map(v1of); };
var zs2 = function (zs) { return L.clean({ v: 1, zones: zs }).zones; };
var cat = function (id) { return L.idOf(L.clean({ v: 1, zones: { tl: [{ id: id }] } }).zones.tl[0] || L.clean({ v: 1, zones: { row: [{ id: id }] } }).zones.row[0] || L.clean({ v: 1, zones: { bottom: [{ id: id }] } }).zones.bottom[0]); };
var v2 = function (lay) { return L.clean(lay); };
var hit = function (a, b) { return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y); };

print('=== the checks ===');
ok('no layout: nothing to check', L.check(null), null);
ok('a version this build doesn\'t know, a card in the row, nine units in the row (two lines of four): refused',
   [L.check({ v: 3 }), L.check({ v: 1, zones: { row: [{ id: 'music_card' }] } }),
    L.check({ v: 1, zones: { row: [{ id: 'temp' }, { id: 'next_event' }, { id: 'aqi' }, { id: 'locks' }, { id: 'next_hours' }, { id: 'humidity' }, { id: 'sunset' }] } })], ['saver_layout', 'saver_layout', 'saver_layout']);
var cl = L.clean({ v: 1, big: { size: 99, kind: 'month' }, row_at: 'sideways', zones: { row: [{ id: 'temp' }, { id: 'next_event' }, { id: 'aqi' }, { id: 'locks' }, { id: 'next_hours' }, { id: 'humidity' }, { id: 'sunset' }], tl: [{ id: 'nope' }, { id: 'clock_card' }] } });
ok('the read keeps what it can: the month, the default size, what fits in the row and the corner, the row under the big element',
   [cl.big.kind, cl.big.size, ids(cl.zones.row), ids(cl.zones.tl), cl.row_at], ['month', 24, ['temp', 'next_event', 'aqi', 'locks', 'next_hours', 'humidity'], ['clock_card'], 'under']);
ok('fits: room in a zone for one more of a kind', [L.fits(zs2({ row: [{ id: 'temp' }, { id: 'aqi' }] }), 'row', cat('next_event')),
   L.fits(zs2({ row: [{ id: 'temp' }, { id: 'aqi' }, { id: 'locks' }, { id: 'next_event' }, { id: 'humidity' }] }), 'row', cat('next_hours')),
   L.fits(zs2({ row: [{ id: 'temp' }, { id: 'aqi' }, { id: 'locks' }, { id: 'next_event' }, { id: 'humidity' }, { id: 'sunset' }, { id: 'solar' }] }), 'row', cat('next_hours')),
   L.fits({}, 'bottom', cat('temp')), L.fits({}, 'tl', cat('date'))], [true, true, false, false, true]);
ok('...the row at its one size: a 200% row holds four circular pieces, two to a line',
   [L.fits(zs2({ row: [{ id: 'temp' }, { id: 'aqi' }, { id: 'locks' }] }), 'row', cat('humidity'), 200),
    L.fits(zs2({ row: [{ id: 'temp' }, { id: 'aqi' }, { id: 'locks' }, { id: 'humidity' }] }), 'row', cat('sunset'), 200)], [true, false]);
ok('a size on a widget or a card: kept, its usual 100 not stored, outside 60-200 refused',
   [L.clean({ v: 1, zones: { br: [{ id: 'status_card', size: 80 }], row: [{ id: 'temp', size: 100 }] } }).zones.br[0].size, 'size' in L.clean({ v: 1, zones: { row: [{ id: 'temp', size: 100 }] } }).zones.row[0],
    L.check({ v: 1, zones: { row: [{ id: 'temp', size: 59 }] } }), L.check({ v: 2, zones: { row: [{ piece: 'weather', shape: 'circular', size: 201 }] } }),
    L.check({ v: 2, zones: { tl: [{ piece: 'weather', shape: 'card', size: 200 }] } }), L.check({ v: 1, row_at: 'bottom', upright: { row_at: 'under' } })], [80, false, 'saver_layout', 'saver_layout', null, null]);

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
var up = { v: 2, big: { kind: 'time', size: 40, pos: 'top', align: 'center', depth: 'front' }, zones: tb.zones, upright: { big: { kind: 'time', size: 28, pos: 'upper', align: 'center', depth: 'front' } } };
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
var full = Object.assign({}, tb, { zones: Object.assign({}, tb.zones, { bl: zs2({ bl: [{ id: 'music_card' }, { id: 'clock_card' }] }).bl }) });
var F = L.plan(room, L.oriented(full, 1280, 800), { big: { w: 1200, h: 690, base: 550 } }, { w: 1280, h: 800 });
ok('no room even at the other end: left out, and said so', F.moved.filter(function (m) { return m.to === null; }).length > 0, true);
var row = { v: 1, big: { kind: 'time', size: 26, pos: 'upper', align: 'center', depth: 'front' }, zones: { line: [{ id: 'date' }], row: [{ id: 'temp' }, { id: 'next_event' }, { id: 'aqi' }], tl: [], tr: [], bl: [], br: [], bottom: [] } };
var R = L.plan(room, L.oriented(v2(row), 1280, 800), { big: bigOf(26) }, { w: 1280, h: 800 });
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
  widget: function (w) { return { status_card: { w: 475, h: 40 }, weather_card: { w: 300, h: 44 }, music_card: { w: 360, h: 84 }, timers_card: { w: 246, h: 70 } }[v1of(w)]; } }, { w: 820, h: 1180 });
var ups = [];
Object.keys(upr.corners).forEach(function (z) { upr.corners[z].forEach(function (c) { ups.push(c); }); });
ok('upright, wide cards: nothing on anything else, nothing on the time',
   [ups.some(function (a, i) { return ups.some(function (b, j) { return i < j && hit(a, b); }); }), ups.some(function (c) { return hit(c, upr.col); })], [false, false]);

// TWO LINES, AND THE ROW ALONG THE BOTTOM (2026-11-01, the owner: "I should be able to put more than one... I may want
// it all the way at the bottom and not below the clock... as that tends to be where faces are in pictures")
var two = { v: 1, big: { kind: 'time', size: 26, pos: 'top', align: 'center', depth: 'front' }, row_at: 'under',
  zones: { line: [], row: [{ id: 'temp' }, { id: 'aqi' }, { id: 'next_event' }, { id: 'locks', size: 120 }], tl: [], tr: [], bl: [], br: [], bottom: [] } };
var T2 = L.plan(room, L.oriented(v2(two), 1280, 800), { big: bigOf(26) }, { w: 1280, h: 800 });
ok('a fifth unit starts a second line, under the first; a widget its own size',
   [T2.row.items[3].y > T2.row.items[0].y + T2.row.items[0].h, Math.round(T2.row.items[3].h / T2.row.items[0].h * 100)], [true, 120]);
ok('...each line centered under the time', Math.round(T2.row.items[3].x + T2.row.items[3].w / 2), 640);
var dn = JSON.parse(JSON.stringify(two));
dn.row_at = 'bottom';
dn.zones.bl = [{ id: 'music_card' }]; dn.zones.br = [{ id: 'status_card' }];
dn = v2(dn);
var D = L.plan(room, L.oriented(dn, 1280, 800), { big: bigOf(26), widget: function (w) { return { music_card: { w: 400, h: 90 }, status_card: { w: 420, h: 40 } }[v1of(w)]; } }, { w: 1280, h: 800 });
var foot = 800 - D.m, lowest = Math.max.apply(null, D.row.items.map(function (it) { return it.y + it.h; }));
ok('along the bottom: on the bottom margin, in the middle of the screen, the time\'s column without it',
   [Math.round(lowest), Math.round(D.row.box.x + D.row.box.w / 2), D.row.at, D.col.h < T2.col.h], [Math.round(foot), 640, 'bottom', true]);
var dcs = [].concat(D.corners.bl || [], D.corners.br || []);
ok('...the bottom corners clear of it', dcs.length === 2 && dcs.every(function (c) { return !hit(c, D.row.box); }), true);
ok('...on a phone too, where they would meet: over it', (function () {
  var P2 = L.plan({ x: 0, y: 0, w: 390, h: 844 }, L.oriented(dn, 390, 844), { big: bigOf(26), widget: function (w) { return { music_card: { w: 180, h: 60 }, status_card: { w: 170, h: 30 } }[v1of(w)]; } }, { w: 390, h: 844 });
  var cs = [].concat(P2.corners.bl || [], P2.corners.br || []);
  return cs.length > 0 && cs.every(function (c) { return !hit(c, P2.row.box) && c.y + c.h <= P2.row.box.y; });
})(), true);
// LINED UP BY THEIR INK (2026-11-01, the owner's green lines: "alignment is key here"): the time's figures' top on the
// top corners' words' top, the bottom corners' words on one line, whatever room each box has above and below
var ink = { v: 1, big: { kind: 'time', size: 30, pos: 'top', align: 'center', depth: 'front' }, row_at: 'under',
  zones: { line: [], row: [], tl: [{ id: 'date' }], tr: [{ id: 'status_card' }], bl: [{ id: 'weather_card' }], br: [{ id: 'status_line' }], bottom: [] } };
var sizes = { date: { w: 240, h: 30, t: 7, b: 6 }, status_card: { w: 300, h: 44, t: 11, b: 9 }, weather_card: { w: 260, h: 60, t: 4, b: 16 }, status_line: { w: 300, h: 30, t: 8, b: 5 } };
var I = L.plan(room, L.oriented(v2(ink), 1280, 800), { big: { w: 520, h: 236, base: 200, t: 18, b: 3 }, widget: function (w) { return sizes[v1of(w)]; } }, { w: 1280, h: 800 });
var topInk = [I.big.y + 18, I.corners.tl[0].y + 7, I.corners.tr[0].y + 11].map(Math.round);
var footInk = [I.corners.bl[0].y + I.corners.bl[0].h - 16, I.corners.br[0].y + I.corners.br[0].h - 5].map(Math.round);
ok('the time\'s ink, the top left\'s and the top right\'s on one line: the margin', topInk, [I.m, I.m, I.m].map(Math.round));
ok('...the bottom corners\' ink on one line: the bottom margin', footInk, [800 - I.m, 800 - I.m].map(Math.round));

// A FACT SHOWN ONCE, by what the Today face is set to show (2026-11-02, the owner: Weather a toggle like What's Playing)
var todayO = { big: { kind: 'time' }, zones: { line: [], row: [], tl: [{ piece: 'weather', shape: 'inline' }], tr: [], bl: [{ piece: 'music', shape: 'card' }], br: [], bottom: [] } };
ok('the Today face hides the Weather and Music pieces it shows', Object.keys(L.claims(todayO, { clock_style: 'today' })).sort(), ['bl:0', 'tl:0']);
ok('...not the Weather with its weather off', Object.keys(L.claims(todayO, { clock_style: 'today', clock_today_weather: false })), ['bl:0']);
ok('...not the Music with What\u2019s Playing off', Object.keys(L.claims(todayO, { clock_style: 'today', clock_today_music: false })), ['tl:0']);

// A PIECE'S WORDS (2026-11-03): its Align kept, Auto never stored; a card's title stored only when off
var alO = L.clean({ v: 2, big: { kind: 'time' }, zones: { br: [{ piece: 'status', shape: 'card', align: 'right', title: false }], tl: [{ piece: 'weather', shape: 'card', align: 'auto', title: true }] } });
ok('a piece\'s Align and a card without its title kept; Auto and a title on not stored',
   [alO.zones.br[0].align, alO.zones.br[0].title, 'align' in alO.zones.tl[0], 'title' in alO.zones.tl[0]], ['right', false, false, false]);

print(fail ? 'FAIL ' + fail + ' SAVER ZONES TESTS' : 'ALL ' + pass + ' SAVER ZONES TESTS PASS');
if (fail) throw new Error(fail + ' failed');
