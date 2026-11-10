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
load(HK_ROOT + '/frontend/cards/hk-people.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');

var ok = H.ok, eq = H.eq, C = window.hkCards;
// what a block draws: the markup handed to morph (this shim does not parse it)
C.morph = function (el, html) { el.__html = html; };
var SRC = readFile(HK_ROOT + '/frontend/cards/hk-home.js'), PSRC = readFile(HK_ROOT + '/frontend/cards/hk-people.js');

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

// (a block of a given size in px, as the grid measures it)
function sizedAt(tag, size, cfg, w, h) {
  var card = H.make(tag);
  card.setAttribute('size', size);
  card._block = function () { return { w: w, h: h }; };
  hkGive(card, hass());
  card.setConfig(cfg);
  return card;
}

H.run('HOME BLOCKS', [
function () {
  H.section('Timers: each running timer one piece (ring with its time, Pause and Stop under it); Small one, Wide two');
  window.hkTimers = { secs: function (v) { var p = String(v || '0').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0; } };
  var s = sized('hk-timer-strip-card', 'S', { entity: 'sensor.running_quick_timers' }), html = s._e.__html;
  ok('Small: one timer, its name and its time, the soonest', /class="nm">Pasta</.test(html) && html.indexOf('Laundry</b>') < 0);
  ok('...no "+1 more" line on Small: the ring alone', !/\+1 more/.test(html));
  // (mockup 5, approved 2026-11-09: each running timer one piece -- name, ring with the time inside, Pause and Stop under it; Small the ring alone)
  ok('...Small: the ring alone with the time inside it, no keys (the block\'s tap opens the Timers page)', !/class="pr"/.test(html) && !/class="stop"/.test(html) &&
     /<div class="rw"><svg[\s\S]*?<hk-countdown deadline="\d+" total="720"><\/hk-countdown><\/div>/.test(html));
  ok('...the countdown is the ring\'s own child, so the circle reads its fraction (--hk-left)', /<div class="gt"><div class="hd"><b class="nm">Pasta<\/b><\/div><div class="rg"><div class="rw"><svg/.test(html));
  var lx = sized('hk-timer-strip-card', 'L', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('Large: Pause is its own key under the ring, the red Stop beside it, the ring no longer a button',
     /<button class="pr" data-timer="timer.quick_1" data-service="pause" aria-label="Pause Pasta"><hk-icon icon="mdi:pause">/.test(lx) &&
     /<button class="stop" data-timer="timer.quick_1" data-service="cancel" aria-label="Stop Pasta"><hk-icon icon="mdi:stop">/.test(lx) &&
     /<\/div><div class="kk"><button class="pr"/.test(lx) && !/<button class="pr"[^>]*><svg/.test(lx));
  var xt = sized('hk-timer-strip-card', 'XL', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('Extra Large: up to three across', /--cols:3/.test(xt));
  var tall = sized('hk-timer-strip-card', 'T', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('Tall: one, "+1 more" under it', (tall.match(/class="gt/g) || []).length === 1 && /<div class="mf">\+1 more<\/div>/.test(tall));
  var wide = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' })._e.__html;
  // (2026-11-09, mockup 14b: the + at the top right leaves a Wide block no room for a second timer's keys: one timer, "+1 more" at its foot)
  ok('Wide: one timer with its keys, "+1 more"', /--cols:1/.test(wide) && /Pasta/.test(wide) && !/Laundry/.test(wide) && /<div class="mf">\+1 more<\/div>/.test(wide));
  // ALWAYS A WAY TO ADD A TIMER (2026-11-09, mockup 14b): a plain orange + on every running size, opening the New Timer sheet
  ['S', 'W', 'T', 'L', 'XL'].forEach(function (z) {
    var h = sized('hk-timer-strip-card', z, { entity: 'sensor.running_quick_timers' })._e.__html;
    ok(z + ': the + at the top right (a New Timer tap)', /<button class="pl" data-new aria-label="Add a timer"><hk-icon icon="mdi:plus"><\/hk-icon><\/button>/.test(h));
  });
  ok('...the + is a 52 px disc in a 56 px target, orange, a white glyph; the keys 52 in 56 with 14 between', SRC.indexOf("position:absolute;top:6px;right:6px;z-index:2;width:56px;height:56px") > 0 &&
     SRC.indexOf(".pl::before{content:\"\";position:absolute;inset:2px;border-radius:50%;background:' + window.hkCards.ACCENTS.orange") > 0 && SRC.indexOf(".gt .kk{display:flex;gap:10px;flex:none}") > 0 &&
     SRC.indexOf(".gt .pr::before,.gt .stop::before{content:\"\";position:absolute;inset:2px;") > 0);
  var opened = [];
  window.hkDetail = { open: function (a, b, c) { opened.push(c); } };
  var wc = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' });
  wc._newGridTimer();   // (what the +'s tap calls: _gridTap sends data-new here)
  ok('...it opens the New Timer sheet with the wheels', opened.length === 1 && opened[0].cards.cards[0].layout === 'sheet' && SRC.indexOf("button.dataset.new !== undefined) { this._newGridTimer()") > 0);
  delete window.hkDetail;
  // EXTRA LARGE keeps the maker beside one or two timers where they fit (a 288 px maker and 122 px a timer), and has no +
  var xm = sizedAt('hk-timer-strip-card', 'XL', { entity: 'sensor.running_quick_timers' }, 608, 310)._e.__html;
  ok('Extra Large, two running in a 608 px block: both, and the maker beside them -- no +', /class="xm" style="--mw:\d+px"/.test(xm) && /--cols:2/.test(xm) && /Pasta/.test(xm) && /Laundry/.test(xm) &&
     /<div class="mk" data-keep data-notap[^>]*--hk-mk-row:\d+px/.test(xm) && !/class="pl"/.test(xm));
  var xm1 = sizedAt('hk-timer-strip-card', 'XL', { entity: 'sensor.running_quick_timers' }, 455, 300)._e.__html;
  ok('...in a 455 px block one timer fits beside it: "+1 more" and the maker', /class="xm"/.test(xm1) && /--cols:1/.test(xm1) && !/Laundry/.test(xm1) && /\+1 more/.test(xm1) && /--mw:(2[89]\d|3[0-4]\d)px/.test(xm1));
  ok('...where the maker leaves no room for one (a 300 px block) the timers take it, with the +', !/class="xm"/.test(xt) && /class="pl"/.test(xt));
  house.set('timer.quick_1', 'paused', { friendly_name: 'Quick Timer 1', duration: '0:12:00', remaining: '0:04:00' });
  house.set('sensor.running_quick_timers', '1', { running: [{ name: 'Pasta', entity_id: 'timer.quick_1', finishes_at: iso(420) }] });
  var p = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('paused: its key resumes it, play on the key, the time held', /data-service="start" aria-label="Resume Pasta"/.test(p) && /mdi:play/.test(p) && /hold="240"/.test(p));
  ok('...one timer on Wide: its two keys and the + (no "Start another" place any more)', !/Start another/.test(p) && /class="pl"/.test(p) && (p.match(/data-preset=/g) || []).length === 0);
  house.set('sensor.running_quick_timers', '0', { running: [] });
  house.set('timer.quick_1', 'idle', { friendly_name: 'Quick Timer 1' });
  var none = sized('hk-timer-strip-card', 'S', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('none running, Small: no Timers title, "Start a Timer" over its one key, the orange + (2026-11-09: no pill wider than the block)', !/class="nm"/.test(none) &&
     /class="gt idle dg"><span class="dir">Start a Timer<\/span>/.test(none) && (none.match(/data-preset=/g) || []).length === 0 &&
     (none.match(/<button class="rk add" data-new aria-label="Create a Timer">/g) || []).length === 1 && !/rk cap/.test(none));
  none = sized('hk-timer-strip-card', 'W', { entity: 'sensor.running_quick_timers' })._e.__html;
  // (mockup 5, 2026-11-09: "Start a Timer" a direction -- one line over the rings, the two one group centered)
  ok('...Wide: "Start a Timer" over three rings -- the 5 and 10 minute starts as arcs of an hour, and + (three controls at most)',
     /class="gt idle dg"><span class="dir">Start a Timer<\/span>/.test(none) && (none.match(/data-preset=/g) || []).length === 2 &&
     /data-preset="5" style="--a:8\.3\d*"[\s\S]*>5m</.test(none) && />10m</.test(none) && /class="rk add"/.test(none) && />30m</.test(none) === false);
  var xl = sized('hk-timer-strip-card', 'XL', { entity: 'sensor.running_quick_timers' })._e.__html;
  ok('...Extra Large makes one (mockup 5c): six presets under the direction, and a kept place for the New Timer card\'s wheels -- no +, the wheels are there',
     /class="gt idle mkr"><div class="ql"><span class="dir">Start a Timer<\/span>/.test(xl) && (xl.match(/data-preset=/g) || []).length === 6 &&
     /<div class="mk" data-keep data-notap[^>]*--hk-mk-row:\d+px/.test(xl) && !/class="rk add"/.test(xl));
  var big = sized('hk-timer-strip-card', 'L', { entity: 'sensor.running_quick_timers' })._e.__html;
  // LARGE, NOTHING RUNNING (2026-11-09, mockup 14b, the owner: "the roller to create a new timer isn't implemented here"): the headline upper left, four rings across (56 px), the maker's kept place under them
  ok('...Large: "Start a Timer", four rings (5, 10, 15, 30), and the maker\'s place -- no +, the wheels are there', /class="gt idle lg"><span class="dir">Start a Timer<\/span>/.test(big) && (big.match(/data-preset=/g) || []).length === 4 &&
     /class="qs g" style="--k:56px;--qc:4"/.test(big) && />30m</.test(big) && />15m</.test(big) && !/class="rk add"/.test(big) && /<div class="mk" data-keep data-notap[^>]*--hk-mk-row:\d+px;--hk-mk-fs:\d+px;--hk-mk-pad/.test(big));
  ok('...its headline is left-aligned (DESIGN.md: the headline is the upper left)', SRC.indexOf(".gt.lg .dir{text-align:left;margin:0}") > 0);
  ok('the ring is a drawn size (mockup 5), the keys 56 px targets', SRC.indexOf(".gt .rw{position:relative;flex:none;width:var(--ring);height:var(--ring)") > 0 && SRC.indexOf("flex:none;width:56px;height:56px;display:grid") > 0);
  ok('the morph does not leave the countdowns blank: each paints again', /cd\._hkLast = null;[\s\S]*cd\.setAttribute\('total'/.test(SRC));
},
function () {
  H.section('Who\'s Home: Small fills the block with faces, those away dimmed, and says who is where');
  var s = sized('hk-people-card', 'S', {}), html = s._root.__html;
  ok('the heading', /<b class="lab">Who’s Home<\/b>/.test(html));
  eq('every face, A to Z, drawn and not a button (Small: the plate opens the sheet)', (html.match(/<div class="pr/g) || []).length, 3);
  ok('...no face is a button or carries a tap', !/<button/.test(html) && !/data-id=/.test(html));
  ok('...the one away dimmed (class away), those home not', /class="pr away" style="[^"]*" aria-label="Robin/.test(html) || /class="pr away" aria-label="Robin/.test(html) && /class="pr home/.test(html));
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
  var xl = sized('hk-people-card', 'XL', {})._root.__html;
  ok('Extra Large (mockup 13): Home on the left, one person large with their name; Away on the right, 56 px rows with where and since',
     /<b class="lab">Home<\/b>/.test(xl) && /<b class="lab">Away<\/b>/.test(xl) && !/Who’s Home/.test(xl) && (xl.match(/class="xf"/g) || []).length === 2 &&
     (xl.match(/class="xw"/g) || []).length === 1 && /<b>Robin<\/b><span>Work<\/span>/.test(xl));
  var xs = (function () { var c = H.make('hk-people-card'); c._clientExplicit = true; c._hkClient = { states: { 'person.a': { state: 'home', last_changed: '2026-11-09T09:02:00', attributes: { friendly_name: 'Sam' } }, 'person.b': { state: 'Work', last_changed: '2026-11-09T08:00:00', attributes: { friendly_name: 'Robin' } } } }; return c._xl(['person.a', 'person.b']); })();
  ok('...one at home: "Home since" under the name; away: "Since" at the row\'s right', /class="xf x1"/.test(xs) && />Home since \d/.test(xs) && /class="sn">Since \d/.test(xs), xs);
  ok('...each face and row opens its person', (xl.match(/<button class="x[fw][ "][^>]*data-id="person\./g) || []).length === 3);
  ok('...nobody home says so, and who left last', /<b>Nobody Home<\/b><span>\w+ left /.test((function () { var c = H.make('hk-people-card'); c._clientExplicit = true; c._hkClient = { states: { 'person.a': { state: 'not_home', last_changed: '2026-11-09T09:02:00', attributes: { friendly_name: 'Alex Park' } } } }; return c._xl(['person.a']); })()));
  ok('...the two columns\' gap is the block\'s inset, the rows 56 and the lists scroll with a fade', PSRC.indexOf("gap:var(--hk-pad-l,18px)") > 0 && PSRC.indexOf("height:56px;flex:none") > 0 && PSRC.indexOf(".pp .xs.more{") > 0);
  // SHOW MAP (mockup 13b, 2026-11-09): the person sheet's OpenStreetMap tiles, each located person's face, the house; the list
  // grouped Home, then Away with the place and how far; off by default (the block option), and none with no place to show
  var mapOf = function (states) { var c = H.make('hk-people-card'); c._clientExplicit = true; c._config = { map: true }; c._hkClient = { states: states, config: { unit_system: { length: 'mi' } } }; return c._xlMap(Object.keys(states).filter(function (k) { return k.indexOf('person.') === 0; }), 540, 320); };
  var HOME = { latitude: 33.9806, longitude: -117.3755 };
  var mp = mapOf({ 'zone.home': { state: 'zoning', attributes: HOME }, 'person.a': { state: 'home', attributes: Object.assign({ friendly_name: 'Sam' }, HOME) },
                   'person.b': { state: 'Work', attributes: { friendly_name: 'Robin', latitude: 33.9533, longitude: -117.3962 } },
                   'person.c': { state: 'School', attributes: { friendly_name: 'Kit' } } });
  ok('Show Map: tiles from OpenStreetMap, the house marked, a face on the map for each located person, credit given',
     /src="https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png"/.test(mp) && /class="xhm"/.test(mp) && (mp.match(/class="xp"/g) || []).length === 2 && /© OpenStreetMap/.test(mp), mp);
  ok('...the list: Home, then Away with the place and how far (no place: the zone only), each a row that opens its person',
     /<b class="lab">Home<\/b>[\s\S]*<b class="lab">Away<\/b>/.test(mp) && /<b>Robin<\/b><span>Work · 2(\.\d)? mi<\/span>/.test(mp) && /<b>Kit<\/b><span>School<\/span>/.test(mp) &&
     (mp.match(/<button class="xw"[^>]*data-id="person\./g) || []).length === 3, mp);
  ok('...everyone home: Arrived', /<b class="lab">Arrived<\/b>/.test(mapOf({ 'zone.home': { state: 'zoning', attributes: HOME }, 'person.a': { state: 'home', attributes: Object.assign({ friendly_name: 'Sam' }, HOME) } })));
  ok('...no house and nobody located: the two columns without a map', !/tile\.openstreetmap/.test(mapOf({ 'person.a': { state: 'home', attributes: { friendly_name: 'Sam' } } })));
  ok('...off by default: the catalog passes map only when the block asks', /o\.map \? \{ map: true \}/.test(readFile(HK_ROOT + '/frontend/cards/hk-grid-catalog.js')));
  ok('the page card keeps its row of avatars', /class="row" role="list"/.test((function () { var c = H.make('hk-people-card'); hkGive(c, hass()); c.setConfig({}); return c._root.__html; })()));
},
function () {
  H.section('The Vacuum block: big Clean and Dock; rooms to tick from Large up, "Clean 2 rooms"');
  var s = sized('hk-vacuum-card', 'S', { entity: 'vacuum.downstairs' }), html = s._root.__html;
  ok('Small: its name as the heading, battery and state, one key, Clean (Dock is the sheet\'s)', /92%<\/span> \u00B7 /.test(html) && /<b class="nm">Downstairs<\/b>/.test(html) &&
     /class="key go" data-svc="start" aria-label="Clean Downstairs"/.test(html) && !/data-svc="return_to_base"/.test(html));
  house.calls.length = 0;
  tap(s, { 'data-svc': 'start' });
  return H.tick().then(function () {
    eq('...Clean starts it', house.calls.map(function (c) { return [c.domain, c.service, c.data.entity_id]; }), [['vacuum', 'start', 'vacuum.downstairs']]);
    house.set('vacuum.downstairs', 'cleaning', { friendly_name: 'Downstairs', battery_level: 80 });
    var run = sized('hk-vacuum-card', 'W', { entity: 'vacuum.downstairs' })._root.__html;
    ok('cleaning: the key is Pause', /data-svc="pause" aria-label="Pause Downstairs"><hk-icon icon="mdi:pause"><\/hk-icon><span>Pause/.test(run));
    // (THE VACUUM DRAWN, 2026-11-09: the battery in the line under what it is doing)
    ok('Wide: the vacuum drawn, cleaning, the battery in its line, both keys with their words', /class="hkva s-cleaning"/.test(run) && /<b class="state">Cleaning<\/b>/.test(run) &&
       /<span class="sub">80%/.test(run) && /<span>Dock<\/span>/.test(run));
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
      ok('Extra Large: the vacuum drawn on its dock, the battery under its state', /class="hkva s-docked" role="img" aria-label="Downstairs, Docked"/.test(xh) && /<b class="state">Docked<\/b><span class="sub two">92%/.test(xh));
      ok('...the rooms beside it, Dock with its word', /<div class="rcol"><b class="lab">Rooms<\/b>/.test(xh) && /class="key dk" data-svc="return_to_base"[\s\S]*<span>Dock<\/span>/.test(xh));
      // THE RING SHOWS WHAT MATTERS (2026-11-09, the owner: "not sure if the big circle showing clean percentage is relevant here?")
      house.set('vacuum.downstairs', 'docked', { friendly_name: 'Downstairs' });
      var nb = sized('hk-vacuum-card', 'T', { entity: 'vacuum.downstairs' })._root.__html;
      ok('no battery and not cleaning: the vacuum drawn, no dash, the state in words', /class="hkva s-docked"/.test(nb) && !/\u2013/.test(nb) && /<b class="state">Docked<\/b>/.test(nb));
      house.set('sensor.vac_cleaning_progress', '47', { friendly_name: 'Progress' });
      house.set('vacuum.downstairs', 'cleaning', { friendly_name: 'Downstairs', battery_level: 80 });
      var pg = sized('hk-vacuum-card', 'T', { entity: 'vacuum.downstairs', progress: 'sensor.vac_cleaning_progress' })._root.__html;
      ok('while cleaning: drawn cleaning, the progress and the battery in its line', /class="hkva s-cleaning"/.test(pg) && /47% done/.test(pg) && /80%/.test(pg));
      house.set('vacuum.downstairs', 'cleaning', { friendly_name: 'Downstairs' });
      ok('cleaning with no reading at all: drawn cleaning, the words', /<b class="state">Cleaning<\/b>/.test(sized('hk-vacuum-card', 'XL', { entity: 'vacuum.downstairs' })._root.__html));
      house.set('vacuum.downstairs', 'docked', { friendly_name: 'Downstairs', battery_level: 92 });
      ok('docked with a battery: the battery, whatever the progress sensor says', /<b class="state">Docked<\/b><span class="sub two">92%/.test(sized('hk-vacuum-card', 'T', { entity: 'vacuum.downstairs', progress: 'sensor.vac_cleaning_progress' })._root.__html));
      // WHAT THE DRAWING SAYS (hk-vacuum-art.js, 2026-11-09): the water tank and being stuck first, then what it is doing; docked and charging
      var VA = window.hkVacuumArt, lk = function (o) { return VA.look(house.hass(), 'vacuum.downstairs', Object.assign({ error: 'sensor.vac_err', charge: 'sensor.vac_chg' }, o || {})); };
      house.set('sensor.vac_err', 'water_tank_empty', {}); house.set('sensor.vac_chg', 'charging', {});
      ok('the water tank empty: drawn so, in its own words, over docked and charging', lk().state === 'water' && lk().words === 'Water tank empty');
      house.set('sensor.vac_err', 'stuck', {});
      ok('...stuck: the error drawing', lk().state === 'error' && lk().words === 'Stuck');
      house.set('sensor.vac_err', 'no_error', {});
      ok('...no error, docked and charging: charging', lk().state === 'charging');
      house.set('sensor.vac_chg', 'full_charge', {});
      ok('...fully charged: docked', lk().state === 'docked' && /class="hkva s-docked"/.test(VA.html('docked', 'x')));
      // THE WATER TANK, HELD (2026-11-09, the owner): the server catches the one-second report and keeps it in sensor.vacuum_water_tanks
      ok('nothing held: not latched, no Clear on any block', !lk().latched && !/data-clear/.test(sized('hk-vacuum-card', 'XL', { entity: 'vacuum.downstairs' })._root.__html));
      house.set('sensor.vacuum_water_tanks', '1', { tanks: { 'vacuum.downstairs': { since: 1000, words: 'Water tank empty' } } });
      var held = lk();
      ok('held: drawn as the water tank, in the report\'s words, over docked (the report is gone from the sensor)', held.state === 'water' && held.words === 'Water tank empty' && held.latched === true);
      house.set('sensor.vacuum_water_tanks', '1', { tanks: { 'vacuum.downstairs': { since: 1000, words: 'Water tank missing' } } });
      ok('...the words are the report\'s own', lk().words === 'Water tank missing');
      house.set('sensor.vac_err', 'stuck', {});
      ok('...stuck stays first, and Clear is still offered', lk().state === 'error' && lk().words === 'Stuck' && lk().latched === true);
      house.set('sensor.vac_err', 'no_error', {});
      ok('...another vacuum\'s report is not this one\'s', !VA.look(house.hass(), 'vacuum.other', {}).latched && VA.latch(house.hass(), 'vacuum.downstairs').since === 1000);
      var latched = {};
      ['XL', 'T', 'W'].forEach(function (z) {
        var h = sized('hk-vacuum-card', z, { entity: 'vacuum.downstairs', error: 'sensor.vac_err' })._root.__html;
        // (Wide's Clear is a key beside Dock, where the rooms key was: under the words it squeezed the drawing, 2026-11-09)
        ok(z + ': the water badge, the report in words and Clear', /class="hkva s-water"/.test(h) && (z === 'W'
          ? /<b class="state">Water tank missing<\/b><span class="sub">/.test(h) && /<div class="pair"><button type="button" class="key rm" data-clear[^>]*><span>Clear<\/span><\/button>/.test(h)
          : /<b class="state">Water tank missing<\/b><button type="button" class="hkclr" data-clear[^>]*>Clear<\/button>/.test(h)));
      });
      ['S', 'L'].forEach(function (z) {
        var h = sized('hk-vacuum-card', z, { entity: 'vacuum.downstairs', error: 'sensor.vac_err' })._root.__html;
        ok(z + ': says so in its line, no pill, the tap opens the vacuum', /<span class="err">Water tank missing<\/span>/.test(h) && !/data-clear/.test(h));
      });
      var wc = sized('hk-vacuum-card', 'T', { entity: 'vacuum.downstairs' });
      house.calls.length = 0;
      tap(wc, { 'data-clear': '' });
      return H.tick().then(function () {
        eq('...Clear asks Mantel to clear that vacuum for every screen', house.calls.map(function (c) { return [c.domain, c.service, c.data.vacuum]; }), [['script', 'vacuum_water_clear', 'vacuum.downstairs']]);
        ok('...the page card: a Clear key beside Clean, shown only while held (it is 56 px like its siblings)',
           /class="cmd clr" data-clear hidden>Clear/.test(SRC) && /e\.clr\.hidden = !lk\.latched/.test(SRC) && /\.vac \.cmd\.clr\{[^}]*padding:0 20px/.test(SRC));
        house.set('sensor.vacuum_water_tanks', '0', { tanks: {} });
      });
    }).then(function () {
      FEED.added = [];
      var bare = sized('hk-vacuum-card', 'L', { entity: 'vacuum.downstairs' })._root.__html;
      ok('without Clean Areas: no rooms, the battery large instead', !/class="lab">Rooms/.test(bare) && /class="mid"/.test(bare));
      FEED.added = ['clean_areas'];
      ok('the grid\'s Large and Extra Large vacuum is the card\'s own block at that size',
         /this\._mount\(this\._root\.querySelector\('\.body'\), \{ type: 'custom:hk-vacuum-card', entity: this\._config\.entity \}, sizeOf\(this\) \|\| 'L'\)/.test(readFile(HK_ROOT + '/frontend/cards/hk-grid-cards.js')));
      ok('more rooms than fit: each a row of its own size (48 px) and the list scrolls -- no "N more" tile',
         /grid-auto-rows:48px/.test(SRC) && /\.vb \.rooms\{[^}]*overflow-y:auto/.test(SRC) && !/class="vr more"/.test(SRC));
      // TALL AND WIDE: the Rooms key and the sheet that picks (2026-11-08)
      var P = window.hkHome.picked['vacuum.downstairs'];
      P.clear();
      var t = sized('hk-vacuum-card', 'T', { entity: 'vacuum.downstairs' });
      H.attach(t);
      SUBS[SUBS.length - 1].on({ configured: true, areas: ['kitchen', 'living_room', 'hallway'] });
      var th = t._root.__html;
      ok('Tall: a Rooms row saying All rooms, then Clean with Dock', /class="rrow" data-rooms[^>]*><span>All rooms<\/span>/.test(th) && /data-svc="start" aria-label="Clean Downstairs"/.test(th) && /data-svc="return_to_base"/.test(th));
      P.add('kitchen'); P.add('living_room'); t._render();
      th = t._root.__html;
      ok('...one or two picked are named on the row, and Clean sends them (the sheet and the block share the picks)', /class="rrow on" data-rooms[^>]*><span>Kitchen, Living Room<\/span>/.test(th) && /data-svc="rooms" aria-label="Clean Downstairs"/.test(th));
      P.add('hallway'); t._render();
      ok('...three are a count', /<span>3 rooms<\/span>/.test(t._root.__html));
      var w = sized('hk-vacuum-card', 'W', { entity: 'vacuum.downstairs' });
      H.attach(w);
      SUBS[SUBS.length - 1].on({ configured: true, areas: ['kitchen', 'living_room', 'hallway'] });
      var wh = w._root.__html;
      ok('Wide: Clean over Rooms and Dock, the key counting them and the rooms named under the state', /class="key rm on" data-rooms[^>]*><hk-icon icon="mdi:floor-plan"><\/hk-icon><span>3 rooms<\/span>/.test(wh) && /class="rm-note">Hallway, Kitchen, Living Room<\/span>/.test(wh) && /class="pair"/.test(wh));
      ok('the Rooms key opens the vacuum\'s picker sheet: the Vacuums page\'s own picker on this vacuum\'s picks, Done in place of Start Cleaning',
         /pick: this\._config\.entity/.test(SRC) && /pk \? 'Done'/.test(SRC) && /this\._config\.pick \? picked\(this\._config\.pick\)/.test(SRC));
      P.clear();
      house.set('vacuum.downstairs', 'cleaning', { friendly_name: 'Downstairs', battery_level: 80 });
      ok('...while it cleans there is nothing to pick: no Rooms row', !/data-rooms/.test(sized('hk-vacuum-card', 'T', { entity: 'vacuum.downstairs' })._root.__html));
      house.set('vacuum.downstairs', 'docked', { friendly_name: 'Downstairs', battery_level: 92 });
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
