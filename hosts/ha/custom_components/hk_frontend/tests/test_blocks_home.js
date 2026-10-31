// THE HOME GROUP'S BLOCKS AS WIDGETS (2026-10-31, the owner's notes on the
// blocks mock-up): Timers (the ring is the pause, a red Stop), Who's Home
// (Small: faces filling the block, those away dimmed, a line saying who is
// where; Wide: spread evenly), the Vacuum (big Clean and Dock; from Large up
// the rooms Clean Areas offers as tiles to tick, "Clean 2 rooms"), and the
// Side Pane's Clock lined up and its Timers rows. A fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_home');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/give.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';

var FEED = { added: ['clean_areas'] }, SUBS = [];
window.hkSettings = {
  version: 1,
  get: function (path, fb) { var v = FEED[path]; return v === undefined || v === null ? fb : v; },
  // (Clean Areas' rooms: the test answers the subscription itself)
  subscribe: function (conn, msg, on) { SUBS.push({ msg: msg, on: on }); return function () {}; }
};
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');

var ok = H.ok, eq = H.eq, C = window.hkCards;
// what a block draws: the markup handed to morph (this shim does not parse it)
C.morph = function (el, html) { el.__html = html; };
var SRC = readFile(HK_ROOT + '/frontend/cards/hk-home.js');

var NOW = Date.now(), iso = function (s) { return new Date(NOW + s * 1000).toISOString(); };
var house = H.house({
  'sensor.running_quick_timers': ['2', { running: [{ name: 'Pasta', entity_id: 'timer.quick_1', finishes_at: iso(420) },
                                                   { name: 'Laundry', entity_id: 'timer.quick_2', finishes_at: iso(1800) }] }],
  'timer.quick_1': ['active', { friendly_name: 'Quick Timer 1', duration: '0:12:00', finishes_at: iso(420) }],
  'timer.quick_2': ['active', { friendly_name: 'Quick Timer 2', duration: '0:45:00', finishes_at: iso(1800) }],
  'person.sam': ['home', { friendly_name: 'Sam' }],
  'person.alex': ['home', { friendly_name: 'Alex' }],
  'person.robin': ['Work', { friendly_name: 'Robin' }],
  'vacuum.downstairs': ['docked', { friendly_name: 'Downstairs', battery_level: 92 }]
});
function hass() {
  var h = house.hass();
  h.areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, living_room: { area_id: 'living_room', name: 'Living Room' },
              hallway: { area_id: 'hallway', name: 'Hallway' } };
  h.floors = {};
  return h;
}
function sized(tag, size, cfg) {
  var card = H.make(tag);
  card.setAttribute('size', size);
  hkGive(card, hass());
  card.setConfig(cfg);
  return card;
}
// a tap on the part of a block that matches `sel` (its data-* attributes)
function tap(card, attrs) {
  var t = { getAttribute: function (k) { return attrs[k] === undefined ? null : attrs[k]; }, hasAttribute: function (k) { return attrs[k] !== undefined; } };
  t.closest = function () { return t; };
  (card._root._listeners.click || []).forEach(function (f) { f({ target: t, stopPropagation: function () {} }); });
}

H.run('HOME BLOCKS', [
function () {
  H.section('Timers: the ring is the pause, a big red Stop; Small one, Wide two');
  window.hkTimers = { secs: function (v) { var p = String(v || '0').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0; } };
  var s = sized('hk-timer-strip-card', 'S', { entity: 'sensor.running_quick_timers' }), html = s._e.__html;
  ok('Small: one timer, its name and its time, the soonest', /class="nm">Pasta</.test(html) && html.indexOf('Laundry</b>') < 0);
  ok('...the other said at its top', /\+1 more/.test(html));
  ok('...the ring is a key that pauses it, pause at its centre',
     /<button class="pr" data-timer="timer.quick_1" data-service="pause" aria-label="Pause Pasta">/.test(html) && /mdi:pause/.test(html));
  ok('...the red Stop cancels it', /<button class="stop" data-timer="timer.quick_1" data-service="cancel" aria-label="Stop Pasta"><hk-icon icon="mdi:stop">/.test(html));
  ok('...the countdown is the column\'s own child, so the ring reads its fraction (--hk-left)',
     /<div class="gt"><div class="hd">[\s\S]*?<\/div><hk-countdown deadline="\d+" total="720">/.test(html));
  var wide = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('Wide: two, side by side', /--cols:2/.test(wide) && /Pasta/.test(wide) && /Laundry/.test(wide) && !/more<\/span>/.test(wide));
  house.set('timer.quick_1', 'paused', { friendly_name: 'Quick Timer 1', duration: '0:12:00', remaining: '0:04:00' });
  house.set('sensor.running_quick_timers', '1', { running: [{ name: 'Pasta', entity_id: 'timer.quick_1', finishes_at: iso(420) }] });
  var p = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('paused: the ring resumes it, play at its centre, the time held', /data-service="start" aria-label="Resume Pasta"/.test(p) && /mdi:play/.test(p) && /hold="240"/.test(p));
  ok('...one timer on Wide: quick starts and + beside it, the timer\'s own layout', /Start another/.test(p) && /class="ft qs">/.test(p) &&
     (p.match(/data-preset=/g) || []).length === 2 && /<button class="add" data-new aria-label="Create a Timer">/.test(p));
  house.set('sensor.running_quick_timers', '0', { running: [] });
  house.set('timer.quick_1', 'idle', { friendly_name: 'Quick Timer 1' });
  var none = sized('hk-timer-strip-card', 'S', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('none running, Small: the orange Timers, None running, two quick starts as keys and +', /<b class="nm">Timers<\/b>/.test(none) && /None running/.test(none) &&
     (none.match(/data-preset=/g) || []).length === 2 && /data-preset="5"[^>]*>5m</.test(none) && /data-new/.test(none));
  none = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('...Wide: five quick starts across the block and +', /class="gt wide"/.test(none) && (none.match(/data-preset=/g) || []).length === 5 && />1h</.test(none) === false && />30m</.test(none));
  ok('a square cell: the mock-up\'s ring and Stop (76 and 52 on Small, 72 and 48 on Wide)',
     SRC.indexOf(":host([size=S]) hk-plate.strip{--ring:76px;--stop:52px}") > 0 && SRC.indexOf(":host([size=W]) hk-plate.strip{--ring:72px;--stop:48px}") > 0);
  ok('...a tile cell\'s at least a finger\'s 44', SRC.indexOf("overflow:hidden;--ring:56px;--stop:44px}") > 0);
  ok('the morph does not leave the countdowns blank: each paints again', /cd\._hkLast = null;[\s\S]*cd\.setAttribute\('total'/.test(SRC));
},
function () {
  H.section('Who\'s Home: Small fills the block with faces, those away dimmed, and says who is where');
  var s = sized('hk-people-card', 'S', {}), html = s._root.__html;
  ok('the heading', /<b class="lab">Who’s Home<\/b>/.test(html));
  eq('every face, A to Z, a button opening their sheet', (html.match(/<button class="pr/g) || []).length, 3);
  ok('...the one away dimmed (class away), those home not', /class="pr away" data-id="person.robin"/.test(html) && /class="pr home" data-id="person.sam"/.test(html));
  ok('...each in a color of its own', /--fc:#ff9f0a/.test(html) && /--fc:#0a84ff/.test(html) && /--fc:#bf5af2/.test(html));
  ok('the line: how many are home, where the one away is', /<div class="line">2 home · Robin at Work<\/div>/.test(html), html);
  var line = function (states) {
    var c = Object.create(s); c._clientExplicit = true; c._hkClient = { states: states };
    return c._line(Object.keys(states));
  };
  eq('...everyone home', line({ 'person.a': { state: 'home', attributes: { friendly_name: 'Sam' } }, 'person.b': { state: 'home', attributes: {} } }), 'Everyone home');
  eq('...one away, not at a zone', line({ 'person.a': { state: 'home', attributes: { friendly_name: 'Sam' } }, 'person.b': { state: 'not_home', attributes: { friendly_name: 'Alex Park' } } }), '1 home · Alex away');
  eq('...nobody home', line({ 'person.a': { state: 'Work', attributes: {} }, 'person.b': { state: 'not_home', attributes: {} } }), 'Nobody home');
  var w = sized('hk-people-card', 'W', {})._root.__html;
  ok('Wide: spread evenly, a column each, name and where', /class="wide" role="list" style="--n:3;/.test(w) && /<b>Robin<\/b><span>Work<\/span>/.test(w) && /<b>Sam<\/b><span>Home<\/span>/.test(w));
  ok('...nobody dimmed there (where each is is under them)', !/class="pr away"/.test(w));
  ok('the page card keeps its row of avatars', /class="row" role="list"/.test((function () { var c = H.make('hk-people-card'); hkGive(c, hass()); c.setConfig({}); return c._root.__html; })()));
},
function () {
  H.section('The Vacuum block: big Clean and Dock; rooms to tick from Large up, "Clean 2 rooms"');
  var s = sized('hk-vacuum-card', 'S', { entity: 'vacuum.downstairs' }), html = s._root.__html;
  ok('Small: its glyph and battery, name, state, Clean and Dock', /class="pct ">92%</.test(html) && /<b class="nm">Downstairs<\/b>/.test(html) &&
     /class="key go" data-svc="start" aria-label="Clean Downstairs"/.test(html) && /class="key dk" data-svc="return_to_base"/.test(html));
  house.calls.length = 0;
  tap(s, { 'data-svc': 'start' });
  return H.tick().then(function () {
    eq('...Clean starts it', house.calls.map(function (c) { return [c.domain, c.service, c.data.entity_id]; }), [['vacuum', 'start', 'vacuum.downstairs']]);
    house.set('vacuum.downstairs', 'cleaning', { friendly_name: 'Downstairs', battery_level: 80 });
    var run = sized('hk-vacuum-card', 'W', { entity: 'vacuum.downstairs' })._root.__html;
    ok('cleaning: the key is Pause', /data-svc="pause" aria-label="Pause Downstairs"><hk-icon icon="mdi:pause"><\/hk-icon><span>Pause/.test(run));
    ok('Wide: the battery large, both keys with their words', /<div class="big ">80%<\/div>/.test(run) && /<span>Dock<\/span>/.test(run));
    house.set('vacuum.downstairs', 'docked', { friendly_name: 'Downstairs', battery_level: 92 });
    var l = sized('hk-vacuum-card', 'L', { entity: 'vacuum.downstairs' });
    H.attach(l);
    ok('Large: it asks Clean Areas for its rooms', SUBS.some(function (x) { return x.msg.type === 'hk_clean_areas/subscribe'; }));
    ok('...reading them until they come', /Reading the rooms…/.test(l._root.__html));
    SUBS[SUBS.length - 1].on({ configured: true, areas: ['kitchen', 'living_room', 'hallway'] });
    var lh = l._root.__html;
    eq('...then each a tile to tick, A to Z', (lh.match(/class="vr" data-area="[a-z_]+"/g) || []).map(function (m) { return m.split('"')[3]; }), ['hallway', 'kitchen', 'living_room']);
    tap(l, { 'data-area': 'kitchen' }); tap(l, { 'data-area': 'living_room' });
    lh = l._root.__html;
    ok('...ticked: white with its check, and the key says how many', /data-area="kitchen" aria-pressed="true"><hk-icon icon="mdi:check">/.test(lh) &&
       /data-svc="rooms" aria-label="Clean 2 rooms Downstairs"[\s\S]*<span>Clean 2 rooms<\/span>/.test(lh));
    house.calls.length = 0;
    tap(l, { 'data-svc': 'rooms' });
    return H.tick().then(function () {
      eq('...Clean sends them through Clean Areas, as the Vacuums page does', house.calls.map(function (c) { return [c.domain, c.service, c.data.areas]; }),
         [['hk_frontend', 'clean_areas', ['kitchen', 'living_room']]]);
      var xl = sized('hk-vacuum-card', 'XL', { entity: 'vacuum.downstairs' });
      H.attach(xl);
      SUBS[SUBS.length - 1].on({ configured: true, areas: ['kitchen'] });
      var xh = xl._root.__html;
      ok('Extra Large: the battery as a ring', /class="ring" role="img" aria-label="92%, Docked"/.test(xh) && /stroke-dasharray="92.0 100"/.test(xh));
      ok('...the rooms beside it, Dock with its word', /<div class="rcol"><b class="lab">Rooms<\/b>/.test(xh) && /class="key dk" data-svc="return_to_base"[\s\S]*<span>Dock<\/span>/.test(xh));
      FEED.added = [];
      var bare = sized('hk-vacuum-card', 'L', { entity: 'vacuum.downstairs' })._root.__html;
      ok('without Clean Areas: no rooms, the battery large instead', !/class="lab">Rooms/.test(bare) && /class="mid"/.test(bare));
      FEED.added = ['clean_areas'];
      ok('the grid\'s Large and Extra Large vacuum is the card\'s own block at that size',
         /this\._mount\(this\._root\.querySelector\('\.body'\), \{ type: 'custom:hk-vacuum-card', entity: this\._config\.entity \}, sizeOf\(this\) \|\| 'L'\)/.test(readFile(HK_ROOT + '/frontend/cards/hk-grid-cards.js')));
      ok('more rooms than fit: whole rows, and "N more" opening every room over the page',
         /class="vr more" data-more/.test(SRC) && /type: 'custom:hk-area-select-card', layout: 'panel'/.test(SRC));
      var page = H.make('hk-vacuum-card'); hkGive(page, hass()); page.setConfig({ entity: 'vacuum.downstairs' });
      ok('a page keeps its card (the chips, the four commands)', page._built === true && !!page._e.meta);
    });
  });
},
function () {
  H.section('The Side Pane: the Clock lined up, Timers rows with the ring the pause and a red Stop');
  var X = window.hkSidePane._, calls = [];
  var st = {
    'sun.sun': { state: 'above_horizon', attributes: { next_setting: iso(3600) } },
    'sensor.running_quick_timers': { state: '1', attributes: { running: [{ name: 'Pasta', entity_id: 'timer.quick_1', finishes_at: iso(300) }] } },
    'timer.quick_1': { state: 'active', attributes: { duration: '0:10:00', finishes_at: iso(300) } },
    'timer.quick_3': { state: 'paused', attributes: { friendly_name: 'Tea', duration: '0:05:00', remaining: '0:02:30' } }
  };
  var c = { states: st, actions: { callService: function (d, s, data, t) { calls.push([d, s, t]); return Promise.resolve(); } } };
  var ctx = { forecast: function () { return []; }, slot: function () { return ''; }, still: function (i, p) { return p; }, redraw: function () {} };
  var ck = X.SEC.clock('more', {}, c, ctx);
  ok('Clock: AM on the digits\' baseline, the digits pulled back to the date\'s edge', /<div class="big2 ck">/.test(ck) &&
     /\.ck \.tm\{display:flex;align-items:baseline;margin-left:-0\.05em\}/.test(readFile(HK_ROOT + '/frontend/modules/hk-sidepane.js')));
  ok('...the date at the left, the sunset at the right', /<div class="sub2 ckd"><span class="dl">[^<]+<\/span><span class="ds">[^<]+<\/span><span class="sun">Sunset /.test(ck), ck);
  var tm = X.SEC.timers('more', {}, c, ctx);
  ok('Timers: the ring pauses a running one', /<button type="button" class="tpr" data-act="tp" data-timer="timer.quick_1" data-paused="0" aria-label="Pause Pasta">/.test(tm));
  ok('...resumes a paused one, play at its centre', /data-timer="timer.quick_3" data-paused="1" aria-label="Resume Tea">[\s\S]*?mdi:play/.test(tm));
  ok('...the time a live countdown, over its name', /<hk-countdown deadline="\d+" total="600">/.test(tm) && /<hk-countdown hold="150" total="300">/.test(tm) && /<span class="tn">Pasta<\/span>/.test(tm));
  ok('...and a red Stop', /class="tst" data-act="tx" data-timer="timer.quick_1" aria-label="Stop Pasta"/.test(tm));
  var pane = { _tap: function () {} }, P = customElements.get('hk-side-pane');
  window.hkCards.client = function () { return c; };
  var hit = function (act, attrs) {
    var b = { getAttribute: function (k) { return k === 'data-act' ? act : attrs[k]; } };
    P.prototype._click.call(pane, { target: { closest: function () { return b; } }, stopPropagation: function () {} });
  };
  hit('tp', { 'data-timer': 'timer.quick_1', 'data-paused': '0' });
  hit('tp', { 'data-timer': 'timer.quick_3', 'data-paused': '1' });
  hit('tx', { 'data-timer': 'timer.quick_1' });
  eq('...the Timers block\'s services: pause, resume (start), stop (cancel)', calls.map(function (x) { return x[1] + ' ' + x[2].entity_id; }),
     ['pause timer.quick_1', 'start timer.quick_3', 'cancel timer.quick_1']);
}
]);
