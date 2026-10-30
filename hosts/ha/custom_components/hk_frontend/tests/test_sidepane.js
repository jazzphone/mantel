// THE SIDE PANE (modules/hk-sidepane.js, 2026-10-30; docs/phase11/
// HOMEVIEW-LOOK.md "Phase A2"): the fit that never scrolls (sizes step down
// from the bottom, then "+N more"), When There's Something, the doorbell
// taking the top while it rings, where the pane goes on each screen, the
// room it publishes, and every section drawn at each of its four sizes from
// a fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run sidepane');
load(HK_ROOT + '/tests/dom.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

var P = window.hkSidePane, X = P._;
ok('the module is there, its twelve sections in order', !!P && P.ORDER.length === 12 && P.ORDER.every(function (k) { return !!P.KINDS[k]; }));
ok('four sizes and three widths', eq(P.SIZES, ['tiny', 'less', 'more', 'full']) && eq(P.WIDTHS, { narrow: 360, standard: 400, wide: 480 }));

// ------------------------------------------------------------ the fit
// a pane 600 px tall; each kind's height at each size; 12 between; a foot of 20
var H = { tiny: 46, less: 110, more: 220, full: 300 }, GAP = 12, FOOT = 20;
function overFor(room) {
  return function (sizes, n) {
    var t = 0;
    for (var i = 0; i < n; i++) t += H[sizes[i]] + (i ? GAP : 0);
    if (n < sizes.length) t += GAP + FOOT;
    return t > room;
  };
}
var three = [{ kind: 'weather' }, { kind: 'calendar' }, { kind: 'now_playing', size: 'less' }];
var f = X.fit(three, overFor(1000));
ok('the fit: sections keep their Size while they fit', eq(f.sizes, ['more', 'more', 'less']) && f.dropped === 0, f);
f = X.fit(three, overFor(520));
ok('...when they don\'t, sizes step down from the bottom: the last first, as far as Tiny',
   eq(f.sizes, ['more', 'more', 'tiny']) && f.dropped === 0, f);
f = X.fit(three, overFor(400));
ok('...then the one above it', eq(f.sizes, ['more', 'less', 'tiny']) && f.dropped === 0, f);
f = X.fit([{ kind: 'weather' }, { kind: 'clock', size: 'full' }], overFor(400));
ok('...Full steps down through More to Less', eq(f.sizes, ['more', 'less']), f);
var eight = ['clock', 'weather', 'calendar', 'now_playing', 'security', 'timers', 'climate', 'todo'].map(function (k) { return { kind: k }; });
f = X.fit(eight, overFor(300));
ok('...then the last sections are left out, and the foot says how many', f.n < 8 && f.dropped === 8 - f.n && f.sizes.every(function (s) { return s === 'tiny'; }), f);
var used = 0; for (var i = 0; i < f.n; i++) used += H.tiny + (i ? GAP : 0);
ok('...with the "+N more" foot inside the pane', f.n === 4 && used + GAP + FOOT <= 300, [f.n, used]);
ok('...an empty pane needs no fitting', eq(X.fit([], overFor(10)), { sizes: [], n: 0, dropped: 0 }));
ok('...a size it doesn\'t know is More', eq(X.fit([{ kind: 'weather', size: 'huge' }], overFor(1000)).sizes, ['more']));

// ------------------------------------------------------------ When There's Something
var list = [{ kind: 'weather' }, { kind: 'now_playing', when: 'active' }, { kind: 'timers', when: 'active' }, { kind: 'nope' }];
ok('When There\'s Something: shown while it has something', eq(X.shown(list, function (s) { return s.kind === 'timers'; }).map(function (s) { return s.kind; }), ['weather', 'timers']));
ok('...Always shows whatever it has; a kind it doesn\'t know is left out', eq(X.shown(list, function () { return false; }).map(function (s) { return s.kind; }), ['weather']));
ok('...a pane whose sections are all quiet steps aside', X.shown([{ kind: 'now_playing', when: 'active' }], function () { return false; }).length === 0);
ok('...never more than eight', X.shown(eight.concat(eight), function () { return true; }).length === 8);

// the house, for has() and the sections
var NOW = Date.now();
var states = {
  'weather.home': { state: 'sunny', attributes: { friendly_name: 'Home', temperature: 54 }, last_updated: 'a' },
  'sun.sun': { state: 'above_horizon', attributes: { next_setting: new Date(NOW + 3600000).toISOString() } },
  'media_player.kitchen': { state: 'playing', attributes: { friendly_name: 'Kitchen', media_title: 'Late Light', media_artist: 'The Harbor Quartet' } },
  'sensor.running_quick_timers': { state: '1', attributes: { running: [{ name: 'Pasta', finishes_at: new Date(NOW + 252000).toISOString(), duration_s: 600 }] } },
  'alarm_control_panel.house': { state: 'armed_home', attributes: { friendly_name: 'House', changed_by: 'Alex' }, last_changed: new Date(NOW - 60000).toISOString() },
  'lock.front_door': { state: 'locked', attributes: { friendly_name: 'Front Door' } },
  'lock.back_door': { state: 'unlocked', attributes: { friendly_name: 'Back Door' } },
  'binary_sensor.patio_door': { state: 'off', attributes: { friendly_name: 'Patio Door' } },
  'camera.front_door': { state: 'idle', attributes: { friendly_name: 'Front Door', entity_picture: '/api/camera_proxy/camera.front_door?token=t' }, last_updated: new Date(NOW - 8000).toISOString() },
  'sensor.house_power': { state: '1400', attributes: { unit_of_measurement: 'W' } },
  'climate.living_room': { state: 'heat', attributes: { friendly_name: 'Living Room', current_temperature: 68, temperature: 69, hvac_action: 'heating' } },
  'person.alex': { state: 'home', attributes: { friendly_name: 'Alex' } },
  'person.jo': { state: 'Work', attributes: { friendly_name: 'Jo' } },
  'todo.groceries': { state: '4', attributes: { friendly_name: 'Groceries' }, last_updated: 'b' }
};
var calls = [], reads = [];
var client = { states: states, subscriptions: null,
  callWS: function (m) { reads.push(m); return Promise.resolve({ entity_id: m.entity_id, left: 4, items: [{ uid: '1', summary: 'Milk', done: false }, { uid: '2', summary: 'Eggs', done: false }, { uid: '3', summary: 'Coffee beans', done: false }] }); },
  actions: { callService: function (d, s, data, target) { calls.push([d, s, data, target]); return Promise.resolve(); } } };
window.hkHostClient = window.hkHostClient || {};
window.hkCards.client = function () { return client; };
var SET = { 'security.alarm': 'alarm_control_panel.house', 'features.power': 'sensor.house_power', 'weather.entity': 'weather.home',
            kinds: { locks: ['lock.front_door', 'lock.back_door'], doors: ['binary_sensor.patio_door'], windows: [], garage: [] },
            popups: [{ hash: 'doorbell', kind: 'camera', entity: 'camera.front_door' }, { hash: 'alarm', kind: 'alarm' }] };
window.hkSettings = { get: function (k, fb) { return SET[k] !== undefined ? SET[k] : fb; } };
window.hkMusic = { contexts: function () { return [{ key: 'media_player.kitchen', playing: states['media_player.kitchen'].state === 'playing', members: [] }]; },
                   resolve: function () { return null; } };

ok('has: music playing', X.has(client, { kind: 'now_playing' }) === true);
states['media_player.kitchen'].state = 'paused';
ok('...paused, within Hide After a Pause', X.has(client, { kind: 'now_playing' }) === true);
states['media_player.kitchen'].state = 'off';
ok('...stopped, still the grace', X.has(client, { kind: 'now_playing' }) === true);
var npg = window.hkCards.menu.npGrace;
window.hkCards.menu.npGrace = function () { return 0; };
ok('...the grace over, nothing', X.has(client, { kind: 'now_playing' }) === false);
window.hkCards.menu.npGrace = npg;
states['media_player.kitchen'].state = 'playing';
ok('has: a timer running', X.has(client, { kind: 'timers' }) === true);
ok('has: the alarm armed', X.has(client, { kind: 'security' }) === true);
states['alarm_control_panel.house'].state = 'disarmed';
ok('...disarmed and every door shut: nothing', X.has(client, { kind: 'security' }) === false);
states['binary_sensor.patio_door'].state = 'on';
ok('...a door open is something', X.has(client, { kind: 'security' }) === true);
states['binary_sensor.patio_door'].state = 'off'; states['alarm_control_panel.house'].state = 'armed_home';
ok('has: a to-do list with items left', X.has(client, { kind: 'todo', entity: 'todo.groceries' }) === true);
ok('has: the weather always has something', X.has(client, { kind: 'weather' }) === true);

// ------------------------------------------------------------ where it goes
ok('place: a phone never', X.place(390, 844, {}).kind === 'none' && X.place(382, 678, {}).kind === 'none');
ok('...a landscape tablet: its Width, down the side', eq(X.place(1180, 820, { width: 'standard' }), { kind: 'side', w: 400 }) &&
   X.place(1180, 820, { width: 'narrow' }).w === 360 && X.place(1180, 820, { width: 'wide' }).w === 480);
ok('...beside a Home Grid too, its Width: Narrow, Standard, Wide (the grid fits in what is left)',
   [X.place(1180, 820, { width: 'narrow', gridW: 736 }).w, X.place(1180, 820, { width: 'standard', gridW: 736 }).w,
    X.place(1180, 820, { width: 'wide', gridW: 736 }).w].join() === '360,400,480');
ok('...with no page minimum beside a grid, a docked menu off the room first', X.place(1180, 820, { width: 'wide', menu: 260, gridW: 476 }).w === 480);
ok('...a page that is no grid keeps 560 beside the pane', X.place(1180, 820, { width: 'wide', menu: 100 }).kind === 'side' &&
   X.place(1180, 820, { width: 'wide', menu: 200 }).kind === 'none');
ok('...too little left beside it for the page: no pane', X.place(900, 700, { width: 'wide' }).kind === 'none');
ok('...a tablet held upright: a band under the page, 276 tall', eq(X.place(820, 1180, {}), { kind: 'band', h: 276 }));
ok('...the iPhone Duo open, 198', eq(X.place(669, 951, {}), { kind: 'band', h: 198 }));
ok('On the Dashboard: Off, Home Only, Every Page', !X.wants('off', true) && X.wants('home', true) && !X.wants('home', false) && X.wants('all', false));
var spx = { dashboard: { show: 'home', sections: [{ kind: 'weather' }] }, saver: { show: 'same', sections: [{ kind: 'clock' }] } };
ok('In the Screensaver: the Dashboard\'s sections', eq(X.saverList(spx), [{ kind: 'weather' }]));
spx.saver.show = 'own';
ok('...its own', eq(X.saverList(spx), [{ kind: 'clock' }]));
spx.saver.show = 'off';
ok('...or none', eq(X.saverList(spx), []));

// ------------------------------------------------------------ the doorbell
window.hkPopupOpen = 1; location.hash = '#doorbell';
ok('the doorbell: its camera pop-up open is a ring, its camera at the top', X.ringing() === 'camera.front_door');
location.hash = '#alarm';
ok('...another pop-up is not', X.ringing() === null);
location.hash = '#doorbell'; window.hkPopupOpen = 0;
ok('...the pop-up gone, the ring is over', X.ringing() === null);
location.hash = '';

// ------------------------------------------------------------ the room it takes
var de = document.createElement('html');
de.toggleAttribute = function (k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); };
if (!de.removeAttribute) de.removeAttribute = function (k) { delete this.attrs[k]; };
document.documentElement = de;
var heard = 0; window.addEventListener('hk-pane', function () { heard++; });
X.publish('right', 444, 0);
ok('publish: its width on its side of <html>, and the word', de.style.getPropertyValue('--hk-pane-r') === '444px' && !de.style.getPropertyValue('--hk-pane-l') &&
   de.getAttribute('hk-pane') === 'right' && heard === 1);
X.publish('right', 444, 0);
ok('...the same again says nothing', heard === 1);
X.publish('left', 400, 0);
ok('...a left pane', de.style.getPropertyValue('--hk-pane-l') === '400px' && !de.style.getPropertyValue('--hk-pane-r') && de.getAttribute('hk-pane') === 'left');
X.publish(null, 0, 276);
ok('...a band: its height for the page\'s foot', de.style.getPropertyValue('--hk-pane-b') === '276px' && de.getAttribute('hk-pane') === 'band');
X.publish(null, 0, 0);
ok('...gone: nothing left on <html>', !de.style.getPropertyValue('--hk-pane-b') && !de.hasAttribute('hk-pane') && heard === 4);
var flags = 0; window.addEventListener('hk-popup-flags', function () { flags++; });
X.musicFlag(true);
ok('Now Playing in the pane: the docked bar is told (hk-pane-music)', de.hasAttribute('hk-pane-music') && flags === 1);
X.musicFlag(true); X.musicFlag(false);
ok('...once each way', !de.hasAttribute('hk-pane-music') && flags === 2);

// ------------------------------------------------------------ every section, every size
var ctx = { redraw: function () {}, calendar: function () {}, evColor: function () { return '#ff9f0a'; }, forecast: function () { return []; },
            still: function (id, pic) { return pic; }, slot: function (k) { return '<div class="slot" data-slot="' + k + '"></div>'; } };
X.CAL.evs = [{ cal: 'calendar.family', title: 'Pumpkin carving', allDay: false, start: new Date(NOW + 1800000), end: new Date(NOW + 5400000) },
             { cal: 'calendar.home', title: 'Bins out', allDay: false, start: new Date(NOW + 7200000), end: new Date(NOW + 9000000) }];
X.CAL.at = NOW;
var bad = [];
P.ORDER.forEach(function (k) {
  P.SIZES.forEach(function (s) {
    var html = '';
    try { html = X.SEC[k](s, { kind: k }, client, ctx); } catch (e) { bad.push(k + '/' + s + ': ' + e); return; }
    if (html.indexOf('data-k="' + k + '"') < 0 || html.indexOf('data-size="' + s + '"') < 0) bad.push(k + '/' + s);
  });
});
ok('every section draws at every size, saying its kind and size', bad.length === 0, bad);
// THE WEATHER WHILE ITS STATE IS AWAY (2026-10-30): a page narrowed by Mantel, a reconnect -- the last seen,
// never "No weather"; named from the registry, so a page holding no weather state still asks for it
var wxId = Object.keys(client.states).filter(function (k) { return k.indexOf('weather.') === 0; })[0];
X.SEC.weather('less', {}, client, ctx);
var away = Object.assign({}, client, { states: Object.assign({}, client.states), entities: {} });
delete away.states[wxId]; away.entities[wxId] = { entity_id: wxId };
var kept = X.SEC.weather('less', {}, away, ctx);
ok('...the weather away: its last state, not "No weather"', kept.indexOf('No weather') < 0 && /\d+°/.test(kept), kept.slice(0, 160));
// THE CALENDAR'S SIZES (2026-10-30): Less the next two; More and Full every event in its Days, scrolling inside it,
// each a target (data-ev)
var less = X.SEC.calendar('less', {}, client, ctx), more = X.SEC.calendar('more', {}, client, ctx);
ok('...the calendar: Less the next two, not scrolling; More all of its days, scrolling, each a target',
   (less.match(/data-ev=/g) || []).length === 2 && less.indexOf('evs scroll') < 0 && more.indexOf('evs scroll') > 0 && /data-ev="0"/.test(more), [less.length, more.length]);
// WHERE IT SITS and WHAT A TAP DOES: a row names its entity
ok('...a row names what a tap on it opens (Who\'s Home, Full)', /data-ent="person\./.test(X.SEC.people('full', {}, client, ctx)));
// SECTION HEADINGS: never over the Clock or the Weather
ok('...no heading over the Weather or the Clock', X.SEC.weather('less', {}, client, ctx).indexOf('class="h2"') < 0 &&
   X.SEC.clock('less', {}, client, ctx).indexOf('class="h2"') < 0);
ok('...one over Security (headings on by default)', X.SEC.security('less', {}, client, ctx).indexOf('class="h2"') > 0);
ok('Tiny is one line: its glyph, the fact and a value', /class="sec cmp"/.test(X.SEC.weather('tiny', {}, client, ctx)) &&
   X.SEC.weather('tiny', {}, client, ctx).indexOf('54° Sunny') > 0);
ok('...the timer\'s countdown', /Pasta[\s\S]*4:1[0-2]/.test(X.SEC.timers('tiny', {}, client, ctx)));
ok('Security: its state and its locks', X.SEC.security('tiny', {}, client, ctx).indexOf('Armed · Home') > 0 && X.SEC.security('tiny', {}, client, ctx).indexOf('1 unlocked') > 0);
ok('...More lists each lock, Full who changed it', X.SEC.security('more', {}, client, ctx).indexOf('Back Door') > 0 && X.SEC.security('full', {}, client, ctx).indexOf('Alex') > 0);
ok('Now Playing: Tiny the song and a pause; More the screensaver\'s music pane', X.SEC.now_playing('tiny', {}, client, ctx).indexOf('Late Light') > 0 &&
   /data-act="pp"/.test(X.SEC.now_playing('tiny', {}, client, ctx)) && /data-slot="np"/.test(X.SEC.now_playing('more', {}, client, ctx)));
ok('...Full takes what the pane has left', /class="sec mp grow"/.test(X.SEC.now_playing('full', {}, client, ctx)));
ok('Calendar: the next event, then two, four, five', X.SEC.calendar('tiny', {}, client, ctx).indexOf('Pumpkin carving') > 0 &&
   (X.SEC.calendar('less', {}, client, ctx).match(/class="ev"/g) || []).length === 2);
ok('Who’s Home: home and away counts', X.SEC.people('tiny', {}, client, ctx).indexOf('1 home') > 0 && X.SEC.people('tiny', {}, client, ctx).indexOf('1 away') > 0);
ok('Climate: a room and what it is doing', X.SEC.climate('tiny', {}, client, ctx).indexOf('Living Room 68°') > 0 && X.SEC.climate('tiny', {}, client, ctx).indexOf('Heating') > 0);
ok('Energy: use now', X.SEC.energy('tiny', {}, client, ctx).indexOf('1.4 kW') > 0);
ok('Camera: its name and the age of its still; Less up a still', X.SEC.camera('tiny', {}, client, ctx).indexOf('Front Door') > 0 &&
   X.SEC.camera('tiny', {}, client, ctx).indexOf('8 s ago') > 0 && /<img[^>]*camera_proxy/.test(X.SEC.camera('less', {}, client, ctx)));

// ------------------------------------------------------------ to-do
ok('To-do Tiny: the list and how many', X.SEC.todo('tiny', { kind: 'todo' }, client, ctx).indexOf('Groceries') > 0 && X.SEC.todo('tiny', {}, client, ctx).indexOf('4 items') > 0);
reads.length = 0;
delete X.TODO['todo.groceries'];
X.SEC.todo('more', { kind: 'todo', entity: 'todo.groceries' }, client, ctx);
ok('...More reads its items through hk_frontend/todo/items (hk_core over the House port)',
   reads.length === 1 && eq(reads[0], { type: 'hk_frontend/todo/items', entity_id: 'todo.groceries', completed: false }), reads);
X.SEC.todo('more', { kind: 'todo', entity: 'todo.groceries' }, client, ctx);
ok('...and again only when the list changes', reads.length === 1);
Promise.resolve().then(function () { return Promise.resolve(); }).then(function () {
  var html = X.SEC.todo('less', { kind: 'todo', entity: 'todo.groceries' }, client, ctx);
  ok('...Less shows two, each a circle to check it off', (html.match(/data-act="todo"/g) || []).length === 2 && html.indexOf('Milk') > 0, html);
  var full = X.SEC.todo('full', { kind: 'todo', entity: 'todo.groceries' }, client, ctx);
  ok('...Full shows them all, and Add', (full.match(/data-act="todo"/g) || []).length === 3 && /<form class="add"/.test(full));
  X.TODO['todo.groceries'].off['1'] = true;
  ok('...an item checked off is struck through until the list says so', /class="it done"[^>]*data-uid="1"/.test(X.SEC.todo('less', { kind: 'todo', entity: 'todo.groceries' }, client, ctx)));
}).then(function () {
  // ---- one section as a widget on the Pages screen (Phase J)
  var wd = P.section('weather', 'less', { place: 'pages' });
  ok('a section as a widget: the pane element, widget mode, its one section shown', !!wd && wd.getAttribute('mode') === 'widget' && wd.hasAttribute('on'),
     wd && [wd.getAttribute('mode'), wd.hasAttribute('on')]);
  ok('...nothing for a kind the pane has not', P.section('nope', 'less') === null);
}).then(function () {
  print(fail ? '  ' + fail + ' SIDE PANE TESTS FAILED' : '  ALL ' + pass + ' SIDE PANE TESTS PASS');
  if (fail) throw new Error(fail + ' failed');
}).catch(function (e) { print('  FAIL  Exception: ' + e + ' ' + (e.stack || '')); throw e; });
