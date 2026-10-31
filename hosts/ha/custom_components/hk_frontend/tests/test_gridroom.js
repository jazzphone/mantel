// HOME GRID'S EDITOR MAKES ROOM (panels/hk-grid-editor.js makeRoom;
// 2026-10-30, the owner: "As I move the block, the tiles that become free,
// the tiles that get overlapped, move to those free spots"): a block moved
// onto others goes where it was put and they move out of its way -- into the
// space it left, together as they were; else each to the nearest free place in
// reading order; else one or two others moved aside -- never resized, never
// into another view; no way at all is null. One drop is one Undo.
//
// The layouts are fictional; the first is the owner's tablet's shape (6 x 4).
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run gridroom');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');
load(HK_ROOT + '/frontend/panels/hk-grid-editor.js');

var E = window.hkGridEditor, pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
function grid(cols, rows, items, more) { return Object.assign({ v: 1, cols: cols, rows: rows, frame: [1280, 800], band: true, items: items }, more || {}); }
function b(id, card, size, at, view) { var it = { id: id, card: card, size: size, at: at }; if (view) it.view = view; return it; }
function where(g) { var o = {}; (g ? g.items : []).forEach(function (it) { o[it.id] = it.at.join(','); }); return o; }
function sizes(g) { return g.items.map(function (it) { return it.id + ':' + it.size; }).join(' '); }

// THE OWNER'S SCREEN: Weather, Camera and Now Playing Large across the top;
// four small accessories, the Calendar, a Tall thermostat and two scenes below
function house() {
  return grid(6, 4, [
    b('weather', 'weather', 'L', [0, 0]), b('camera', 'camera', 'L', [2, 0]), b('music', 'now_playing', 'L', [4, 0]),
    b('coffee', 'accessory', 'S', [0, 2]), b('fire', 'accessory', 'S', [1, 2]), b('tread', 'accessory', 'S', [0, 3]), b('lights', 'accessory', 'S', [1, 3]),
    b('cal', 'calendar', 'L', [2, 2]), b('thermo', 'thermostat', 'T', [4, 2]), b('morning', 'scene', 'S', [5, 2]), b('relax', 'scene', 'S', [5, 3])]);
}
var g = house(), before = JSON.stringify(g);
ok('the owner\'s screen is a valid layout', E.valid(g), true);

// 1. onto smaller blocks, with room left behind: the four go together into the camera's old space, as they were
var r = E.makeRoom(g, 'camera', [0, 2]);
ok('the camera onto the four small tiles: it goes there', r && where(r).camera, '0,2');
ok('...and they move into the space it left, in the same arrangement',
   r && [where(r).coffee, where(r).fire, where(r).tread, where(r).lights], ['2,0', '3,0', '2,1', '3,1']);
ok('...nothing else moves', r && [where(r).weather, where(r).music, where(r).cal, where(r).thermo, where(r).morning, where(r).relax],
   ['0,0', '4,0', '2,2', '4,2', '5,2', '5,3']);
ok('...no block changes size, and the layout is valid', r && [sizes(r) === sizes(g), E.valid(r)], [true, true]);
ok('the draft itself is untouched', JSON.stringify(g), before);

// 2. equal sizes still swap
r = E.makeRoom(g, 'camera', [0, 0]);
ok('the camera onto the weather: they swap', r && [where(r).camera, where(r).weather], ['0,0', '2,0']);
ok('...and nothing else moves', r && Object.keys(where(r)).filter(function (k) { return where(r)[k] !== where(g)[k]; }).sort(), ['camera', 'weather']);
r = E.makeRoom(g, 'coffee', [5, 3]);
ok('two small tiles swap', r && [where(r).coffee, where(r).relax], ['5,3', '0,2']);

// partly over a mixed group: the Large one into the space left, the small ones beside
r = E.makeRoom(g, 'camera', [1, 2]);
ok('the camera over a small tile, the Calendar and another: the Calendar takes its old space',
   r && [where(r).camera, where(r).cal, where(r).fire, where(r).lights], ['1,2', '2,0', '3,2', '3,3']);
ok('...valid', r && E.valid(r), true);
r = E.makeRoom(g, 'camera', [0, 1]);
ok('over the Weather and two small tiles: the Weather takes its old space, the two the free cells, still in order',
   r && [where(r).camera, where(r).weather, where(r).coffee, where(r).fire], ['0,1', '2,0', '0,0', '1,0']);

// 3. nearest free place in reading order, when the space left is too small
var n = grid(6, 4, [b('big', 'weather', 'L', [0, 0]), b('wide', 'scene', 'W', [2, 0]), b('dot', 'timers', 'S', [5, 3])]);
r = E.makeRoom(n, 'dot', [0, 0]);
ok('a small tile onto a Large one: the Large one goes to the nearest free place in reading order',
   r && [where(r).dot, where(r).big, where(r).wide], ['0,0', '4,0', '2,0']);

// 4. a small shift: no free place fits, until one other block moves aside (the least far)
var s = grid(6, 2, [b('t', 'calendar', 'T', [0, 0]), b('a', 'timers', 'S', [1, 0]), b('b2', 'timers', 'S', [2, 1]), b('c', 'timers', 'S', [3, 0]),
  b('d', 'timers', 'S', [4, 1]), b('e', 'timers', 'S', [5, 1]), b('x', 'timers', 'S', [5, 0])]);
r = E.makeRoom(s, 'x', [0, 0]);
ok('a Tall block with no free column: one small tile steps aside for it',
   r && [where(r).x, where(r).t, where(r).a], ['0,0', '1,0', '2,0']);
ok('...and only that one', r && ['b2', 'c', 'd', 'e'].map(function (k) { return where(r)[k]; }), ['2,1', '3,0', '4,1', '5,1']);

// 5. impossible: null, and the block stays
var tight = grid(3, 2, [b('a', 'weather', 'L', [0, 0]), b('t', 'calendar', 'T', [2, 0])]);
ok('a Tall block into the middle of a 3 x 2 grid with a Large one: no way', E.makeRoom(tight, 't', [1, 0]), null);
ok('past the edge: no way', E.makeRoom(g, 'camera', [5, 0]), null);
ok('a fractional place: no way', E.makeRoom(g, 'camera', [0.5, 2]), null);
ok('a block that isn\'t there: no way', E.makeRoom(g, 'nope', [0, 0]), null);
ok('its own place: the layout as it was', where(E.makeRoom(g, 'camera', [2, 0])), where(g));
ok('into empty space: only it moves', where(E.makeRoom(n, 'dot', [4, 3])).big, '0,0');

// 6. views: only the moved block's view makes room
var v = grid(6, 4, [b('a', 'weather', 'L', [0, 0]), b('c', 'camera', 'L', [2, 0]),
  b('a1', 'weather', 'L', [0, 0], 1), b('c1', 'camera', 'L', [2, 0], 1), b('s1', 'timers', 'S', [4, 0], 1)], { views: 2 });
r = E.makeRoom(v, 'c', [0, 0]);
ok('view 1 swaps, view 2 untouched', r && [where(r).c, where(r).a, where(r).a1, where(r).c1, where(r).s1], ['0,0', '2,0', '0,0', '2,0', '4,0']);
r = E.makeRoom(v, 'c', [4, 0]);
ok('a place taken only in another view is free', r && [where(r).c, where(r).s1], ['4,0', '4,0']);
ok('...and no block changes view', r && r.items.map(function (it) { return it.view || 0; }), [0, 0, 1, 1, 1]);

// 7. the arrow keys and a drag share it; a resize still never makes room
ok('a resize onto a neighbour is still refused', E.place(g, 'thermo', [4, 2], 'L'), null);

// 8. ONE DROP IS ONE UNDO: the editor, its drawing stubbed (test_grideditor.js's way)
var ed = new (customElements.get('hk-grid-editor'))();
ed.configure({ panel: { data: { versions: {} }, hasAttribute: function () { return false; } }, path: 'dashboard-hall',
  board: { home_style: 'grid', home_grid: house() }, title: 'Hall', onCancel: function () {}, onSaved: function () {} });
ed.saveButton = {}; ed.undoButton = {}; ed.message = { textContent: '' };
ed.overlay = { clientWidth: 1200, clientHeight: 620, querySelector: function () { return null; } };
ed.iframe = { contentWindow: {} };
['blocks', 'side', 'fit', 'preview'].forEach(function (k) { ed[k] = function () {}; });
ed.drop(E.makeRoom(ed.grid, 'camera', [0, 2]), 'camera');
ok('a drop is the draft', [where(ed.grid).camera, where(ed.grid).coffee, ed.undoStack.length], ['0,2', '2,0', 1]);
ed.undo();
ok('...and one Undo puts every block back', JSON.stringify(ed.grid), JSON.stringify(house()));

// 9. A CARD DROPPED WHERE THERE IS NO ROOM (2026-10-31, the owner: "if there's no room for the card, let me drag it
// onto the grid anyway ... it replaces the blocks it covers"; addOver): the others make room when they can, and
// only when they can't the blocks it covers go, and it takes their cells -- never more than it covers
g = house(); before = JSON.stringify(g);
ok('the owner\'s screen is full: no free space for any size', ['S', 'W', 'T', 'L', 'XL'].map(function (z) { return E.firstSpace(g, z); }), [null, null, null, null, null]);
var o = E.addOver(g, 'camera', 'L', [0, 2]);
ok('a Large card onto the four small tiles: they go, it takes their cells', o && [o.removed.map(function (it) { return it.id; }), o.moved, where(o.grid).b1, o.grid.items.length],
   [['coffee', 'fire', 'tread', 'lights'], [], '0,2', 8]);
ok('...nothing else moves, nothing is resized, the layout is valid', o && [where(o.grid).cal, where(o.grid).weather, where(o.grid).thermo, E.valid(o.grid)], ['2,2', '0,0', '4,2', true]);
ok('...the new block is the card at the size asked, last, with an id of its own', o && JSON.stringify(o.grid.items[o.grid.items.length - 1]), JSON.stringify({ id: 'b1', card: 'camera', size: 'L', at: [0, 2] }));
ok('the draft itself is untouched', JSON.stringify(g), before);
o = E.addOver(g, 'clock', 'L', [1, 2]);
ok('a Large card half over a small column and the Calendar: only the blocks it covers go', o && o.removed.map(function (it) { return it.id; }).sort(), ['cal', 'fire', 'lights']);
ok('...the ones it does not cover stay where they are', o && [where(o.grid).coffee, where(o.grid).tread, where(o.grid).thermo], ['0,2', '0,3', '4,2']);
o = E.addOver(g, 'timers', 'S', [5, 2]);
ok('a Small card onto a Small block: that one goes, and only that one', o && [o.removed.map(function (it) { return it.id; }), o.grid.items.length, E.valid(o.grid)], [['morning'], 11, true]);
ok('a card that does not fit the grid there at all: null', [E.addOver(g, 'camera', 'XL', [4, 0]), E.addOver(g, 'camera', 'L', [5, 0]), E.addOver(g, 'camera', 'L', null)], [null, null, null]);

// ...with room somewhere, the others make room instead of going (nothing is lost while there is space)
var some = house();
some.items = some.items.filter(function (it) { return it.id !== 'morning' && it.id !== 'relax'; });
o = E.addOver(some, 'timers', 'S', [0, 2]);
ok('a free grid: the Small card goes onto the tile and that tile moves to a free place, nothing removed', o && [o.removed, o.moved, where(o.grid).b1, where(o.grid).coffee], [[], ['coffee'], '0,2', '5,2']);
ok('...valid, and no block changed size', o && [E.valid(o.grid), o.grid.items.length], [true, 10]);
o = E.addOver(some, 'camera', 'L', [0, 2]);
ok('...a Large card onto the four small tiles with only two cells free: they can\'t all go there, so they are replaced', o && [o.removed.length, o.moved],
   [4, []]);
var open = house();
open.items = open.items.filter(function (it) { return ['coffee', 'fire', 'tread', 'lights', 'morning', 'relax'].indexOf(it.id) < 0; });
o = E.addOver(open, 'camera', 'L', [4, 2]);
ok('...with the room for the thermostat and a Large card, they make room and nothing is removed', o && [o.removed.length, o.moved.length > 0, E.valid(o.grid)], [0, true, true]);
o = E.addOver(open, 'timers', 'S', [0, 2]);
ok('nothing in the way: it goes there, nothing moved or removed', o && [o.removed, o.moved, where(o.grid).b1], [[], [], '0,2']);

// ...never past 24 blocks: a card onto a free cell is refused at 24, onto a block it replaces it
var many = grid(6, 4, []);
for (var i = 0; i < 24; i++) many.items.push(b('c' + i, 'timers', 'S', [i % 6, Math.floor(i / 6)]));
ok('24 blocks: a card onto one replaces it (still 24)', (function () { var r2 = E.addOver(many, 'clock', 'S', [0, 0]); return r2 && [r2.removed.length, r2.grid.items.length]; })(), [1, 24]);
many.items.pop();
ok('...23 blocks and a free cell: it goes there', (function () { var r2 = E.addOver(many, 'clock', 'S', [5, 3]); return r2 && [r2.removed.length, r2.grid.items.length]; })(), [0, 24]);

// a block is covered only in the view it is added to
var two = grid(6, 4, [b('a', 'weather', 'L', [0, 0]), b('v1', 'weather', 'L', [0, 0], 1), b('z', 'timers', 'S', [5, 3])], { views: 2 });
o = E.addOver(two, 'camera', 'L', [0, 0], 1);
ok('another view\'s blocks are never covered: the block in view 1 makes room, the one in view 0 stays', o && [o.removed, o.moved, where(o.grid).a, o.grid.items.slice(-1)[0].view], [[], ['v1'], '0,0', 1]);

ok('what goes, in words', [E.listOf([{ card: 'camera' }]), E.listOf([{ card: 'camera' }, { card: 'clock' }]),
   E.listOf([{ card: 'camera' }, { card: 'clock' }, { card: 'people' }]), E.listOf([{ card: 'camera' }, { card: 'clock' }, { card: 'people' }, { card: 'vacuum' }, { card: 'timers' }])],
   ['Camera', 'Camera and Clock', 'Camera, Clock and People', '5 blocks']);

// 10. ...dropped in the editor: one step, and one Undo puts every block back (the blocks that went too)
ed.grid = house(); ed.undoStack = []; ed.selected = null;
ed.panel.client = { states: {}, entities: {}, devices: {}, areas: {} };
ed.addCard('camera', 'L', [0, 2]);
ok('the drop is the draft: the four are gone, the card is there, the editor says so', [ed.grid.items.length, ed.grid.items.some(function (it) { return it.id === 'coffee'; }), where(ed.grid).b1, ed.undoStack.length],
   [8, false, '0,2', 1]);
ok('...the message says how many went and that Undo brings them back', /^4 blocks were replaced by Camera\. Undo \(⌘Z\) puts them back\.$/.test(ed.message.textContent), true);
ed.undo();
ok('...one Undo puts every block back', JSON.stringify(ed.grid), JSON.stringify(house()));
ed.addCard('timers', 'S');
ok('the Add button\'s own place is the first free one: none on a full grid, and it says what to do', [ed.grid.items.length, /drag the card onto the blocks it should replace/.test(ed.message.textContent)], [11, true]);

print('');
print(fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'ALL ' + pass + ' GRID ROOM TESTS PASS');
