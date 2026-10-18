// hk-saver-panel.js: the music's Speakers panel -- ticked is where it plays
// (2026-10-14): what Update asks the integration for, and the line that says
// what the ticks do before anything is pressed. (The panel itself, its turn and
// its taps are checked live, headless: hk_house/tools/headless.)
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');

var pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
function same(a, b) { return JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort()); }

load(DIR + 'frontend/modules/hk-saver-panel.js');
var U = window.hkSaverPanel._;
ok('loads: the panel and its CSS', typeof window.hkSaverPanel.create === 'function' && /\.mpanel\{/.test(window.hkSaverPanel.CSS));

var LR = 'lr', K = 'k', O = 'o', L = 'loft', G = 'guest';
var group = [LR, K, O];

// THE TICKS START ON WHERE IT PLAYS: nothing to Update
var p = U.ticksPlan(group, group.slice());
ok('ticks on the rooms playing: Update dimmed', p.update === null && !p.moves);
ok('...in any order', U.ticksPlan(group, [O, LR, K]).update === null);

// ROOMS JOIN: ticked extras
p = U.ticksPlan(group, [LR, K, O, L]);
ok('a room ticked: Update asks for exactly the ticks', same(p.update, [LR, K, O, L]) && same(p.added, [L]) && !p.dropped.length && !p.moves, p);

// ROOMS LET GO: a playing room unticked
p = U.ticksPlan(group, [LR, K]);
ok('a playing room unticked: it stops, the rest stay', same(p.update, [LR, K]) && same(p.dropped, [O]) && !p.added.length && !p.moves, p);

// BOTH AT ONCE: one request
p = U.ticksPlan(group, [LR, O, G]);
ok('a room in and a room out: one request', same(p.update, [LR, O, G]) && same(p.added, [G]) && same(p.dropped, [K]) && !p.moves, p);

// THE MUSIC MOVES: nothing it plays on stays ticked (what Transfer was)
p = U.ticksPlan(group, [L, G]);
ok('none of its rooms ticked: it moves to the ticks', same(p.update, [L, G]) && p.moves, p);

// A PRESET is its rooms ticked
var everywhere = [LR, K, O, L, G, 'bed'];
ok('a preset: Update asks for exactly its rooms (the engine plays its sync group)', same(U.ticksPlan(group, everywhere).update, everywhere));

// THE LINE OVER THE BUTTONS
var names = { lr: 'Living Room', k: 'Kitchen', o: 'Office', loft: 'Loft', guest: 'Guest Bedroom' };
var nm = function (rs) { var n = rs.map(function (e) { return names[e] || e; }); return n.length <= 2 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
var c0 = U.ticksCaption(group, group, 'Piano Man', false, nm);
ok('elsewhere, nothing changed: how it works', /Tap rooms, then <b>Update<\/b>: <b>Piano Man<\/b> plays on the rooms ticked/.test(c0), c0);
var c0m = U.ticksCaption(group, group, 'Piano Man', true, nm);
ok('the Music page, nothing changed: the ticks are for the next pick too', /Tap rooms for your next pick, or to <b>Update<\/b> where <b>Piano Man<\/b> plays/.test(c0m), c0m);
var c1 = U.ticksCaption(group, [LR, K, O, L], 'Piano Man', false, nm);
ok('a room ticked: it joins', /<b>Update<\/b>: Loft joins <b>Piano Man<\/b>\./.test(c1), c1);
var c2 = U.ticksCaption(group, [LR, O, L, G], 'Piano Man', false, nm);
ok('rooms in and out: both said', /Loft and Guest Bedroom join, Kitchen stops\./.test(c2), c2);
var c3 = U.ticksCaption(group, [LR], 'Piano Man', false, nm);
ok('only rooms unticked: who stops', /<b>Update<\/b>: Kitchen and Office stop; the rest play on\./.test(c3), c3);
var c4 = U.ticksCaption(group, [L], 'Piano Man', false, nm);
ok('none of its rooms: it moves', /<b>Update<\/b>: <b>Piano Man<\/b> moves to Loft\./.test(c4), c4);
// the Music page: the next pick first
var c5 = U.ticksCaption(group, [L], 'Piano Man', true, nm);
ok('Music page, other rooms ticked: the next pick plays there, the music keeps its rooms',
   /Your next pick plays on <b>Loft<\/b>; <b>Piano Man<\/b> keeps playing on Living Room, Kitchen and Office\./.test(c5) && /<b>Update<\/b>: <b>Piano Man<\/b> moves to Loft/.test(c5), c5);
var c6 = U.ticksCaption(group, [LR, K, O, L], 'Piano Man', true, nm);
ok('...all its rooms and one more: the next pick replaces it', /Your next pick plays on <b>Living Room, Kitchen, Office and Loft<\/b>, in place of <b>Piano Man<\/b>\./.test(c6), c6);
// A PICK ON THE TICKS (the screensaver's Browse): a preset's exact rooms
// play on its sync group, else the first room and the rest brought in
var PRE = [{ entity: 'grp_down', members: [LR, K] }];
ok('a pick on a preset\'s exact rooms: its sync group, nothing to bring in', JSON.stringify(U.playTarget([K, LR], PRE)) === JSON.stringify({ player: 'grp_down', then: null }));
ok('...on other rooms: the first, then all of them', JSON.stringify(U.playTarget([L, G], PRE)) === JSON.stringify({ player: L, then: [L, G] }));
ok('...on one room: just it', JSON.stringify(U.playTarget([G], PRE)) === JSON.stringify({ player: G, then: null }));
ok('names are escaped', !/<i>/.test(U.ticksCaption(group, ['<i>x'], '<i>song', true, function (rs) { return rs.join(' and '); })));

print('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' SAVER PANEL TESTS PASS');
if (fail) throw new Error(fail + ' failed');
