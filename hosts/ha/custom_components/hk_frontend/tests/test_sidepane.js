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
            still: function (id) { return ctx.stills[id] || ''; }, stills: {}, slot: function (k) { return '<div class="slot" data-slot="' + k + '"></div>'; } };
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
// THE CLOCK'S LOOK (2026-10-31, item 43): a section that sets none draws today's clock, as it was written before the choices
var ck0 = X.SEC.clock('more', { kind: 'clock' }, client, ctx);
ok('Clock: with no choices, today\'s markup (digits, AM/PM beside them, the long date, the sunset)',
   /^<div class="sec" data-k="clock" data-size="more"><div class="big2 ck"><span class="tm">\d{1,2}:\d\d(<small>[AP]M<\/small>)?<\/span><\/div><div class="sub2 ckd"><span class="dl">[^<]+<\/span><span class="ds">[^<]+<\/span><span class="sun">Sunset [^<]+<\/span><\/div><\/div>$/.test(ck0), ck0);
ok('...and the section\'s own classes only for a choice made', X.SEC.clock('more', { kind: 'clock', align: 'right', scale: 'large', weight: 'bold' }, client, ctx).indexOf('class="sec cka-right cks-large ckw-bold"') > 0);
var ckA = X.SEC.clock('more', { kind: 'clock', ampm: false }, client, ctx);
ok('...AM/PM off takes it out', ckA.indexOf('<small>') < 0 && ck0.indexOf('<small>') > 0);
ok('...a 24-hour clock has none to show either', (function () {
  window.hkLocale = Object.assign({}, window.hkLocale, { is24: function () { return true; } });
  var h = X.SEC.clock('more', { kind: 'clock' }, client, ctx); delete window.hkLocale.is24; return h.indexOf('<small>') < 0; })());
var ckC = X.SEC.clock('more', { kind: 'clock', colon: true, date: 'short', line: 'none' }, client, ctx);
ok('...a flashing colon is its own span, the date short, no second line (and no sunset beside it)', ckC.indexOf('<span class="ckc">:</span>') > 0 &&
   ckC.indexOf('class="ds"') < 0 && ckC.indexOf('Sunset') < 0 && ck0.indexOf('ckc') < 0);
ok('...held while motion is off (Reduce Motion, Animations Off, Flat: skyLook().animations)', (function () {
  var was = window.hkSettings.skyLook; window.hkSettings.skyLook = function () { return { animations: false }; };
  var h = X.SEC.clock('more', { kind: 'clock', colon: true }, client, ctx); window.hkSettings.skyLook = was; return h.indexOf('ckc') < 0 && h.indexOf('<span class="tm">') > 0; })());
var ckD = X.SEC.clock('more', { kind: 'clock', line: 'sunset', date: 'full' }, client, ctx), ckE = X.SEC.clock('more', { kind: 'clock', line: 'weather' }, client, ctx);
ok('...Sunset and Weather are a line of their own under the date', /<div class="sub2 ck2">Sunset [^<]+<\/div>/.test(ckD) && ckD.indexOf('class="sun"') < 0 &&
   /<div class="sub2 ck2">54° [^<]+<\/div>/.test(ckE), [ckD, ckE]);
ok('...Date Off leaves only the second line', X.SEC.clock('more', { kind: 'clock', date: 'off', line: 'none' }, client, ctx).indexOf('ckd') < 0 &&
   X.SEC.clock('tiny', { kind: 'clock', date: 'off' }, client, ctx).indexOf('class="v2"') < 0);
var ckS = X.SEC.clock('more', { kind: 'clock', face: 'stacked' }, client, ctx), ckN = X.SEC.clock('more', { kind: 'clock', face: 'analog', date: 'short' }, client, ctx);
ok('...Stacked: the hours over the minutes; Analog: the small face with the time and date beside it', /class="big2 ck stk"><span class="tm"><span>\d{1,2}<\/span><span>\d\d<\/span>/.test(ckS) &&
   /class="ckan"><svg class="face"/.test(ckN) && /<div class="ckt"><b><span class="tm">/.test(ckN) && ckN.indexOf('class="face"') > 0, [ckS, ckN]);
ok('...Full: the face as today, or the digits stacked', /class="facebox"><svg class="face"/.test(X.SEC.clock('full', { kind: 'clock' }, client, ctx)) &&
   /class="facebox"><div class="big2 ck stk"/.test(X.SEC.clock('full', { kind: 'clock', face: 'stacked' }, client, ctx)));
ok('...one over Security (headings on by default)', X.SEC.security('less', {}, client, ctx).indexOf('class="h2"') > 0);
ok('...its words alone, no glyph (2026-10-31, the owner)', /<div class="h2"><span>Security<\/span><\/div>/.test(X.SEC.security('less', {}, client, ctx)));
ok('Tiny is one line: its glyph, the fact and a value', /class="sec cmp"/.test(X.SEC.weather('tiny', {}, client, ctx)) &&
   X.SEC.weather('tiny', {}, client, ctx).indexOf('54° Sunny') > 0);
ok('...the timer\'s countdown', /Pasta[\s\S]*4:1[0-2]/.test(X.SEC.timers('tiny', {}, client, ctx)));
ok('Security: its state and its locks', X.SEC.security('tiny', {}, client, ctx).indexOf('Armed · Home') > 0 && X.SEC.security('tiny', {}, client, ctx).indexOf('1 unlocked') > 0);
ok('...More lists each lock, Full who changed it', X.SEC.security('more', {}, client, ctx).indexOf('Back Door') > 0 && X.SEC.security('full', {}, client, ctx).indexOf('Alex') > 0);
// only what is open (2026-10-31, the owner: "I just need to know when something opens"): All locked the all-clear
var lockWas = [states['lock.front_door'].state, states['lock.back_door'].state];
states['lock.front_door'].state = states['lock.back_door'].state = 'locked';
SET.kinds.windows = ['binary_sensor.office_window'];
states['binary_sensor.office_window'] = { entity_id: 'binary_sensor.office_window', state: 'off', attributes: { friendly_name: 'Office Window', device_class: 'window' } };
var calm = X.SEC.security('less', {}, client, ctx);
ok('Security Less, all shut: All locked, never "all windows closed"', calm.indexOf('All locked') > 0 && !/closed/i.test(calm), calm);
ok('...More: no Windows row while none is open', X.SEC.security('more', {}, client, ctx).indexOf('Windows') < 0);
states['binary_sensor.office_window'].state = 'on';
ok('...a window open: said, in the singular', X.SEC.security('less', {}, client, ctx).indexOf('All locked · 1 window open') > 0 &&
   X.SEC.security('more', {}, client, ctx).indexOf('1 open') > 0);
SET.kinds.windows = []; delete states['binary_sensor.office_window'];
states['lock.front_door'].state = lockWas[0]; states['lock.back_door'].state = lockWas[1];
var more = X.SEC.now_playing('more', {}, client, ctx);
ok('Now Playing: Tiny the song and a pause; More the mini player a size up (2026-10-31, "one family"), Full the screensaver\'s music pane',
   X.SEC.now_playing('tiny', {}, client, ctx).indexOf('Late Light') > 0 && /data-act="pp"/.test(X.SEC.now_playing('tiny', {}, client, ctx)) &&
   !/data-slot="np"/.test(more) && /class="r2 np np2"/.test(more) && /data-act="spk"/.test(more) && /data-act="brw"/.test(more) &&
   /data-slot="np"/.test(X.SEC.now_playing('full', {}, client, ctx)), more);
ok('...More shows the song\'s progress over the row, Less does not', /class="npp" role="progressbar"/.test(more) && more.indexOf('class="npp"') < more.indexOf('data-act="spk"') &&
   !/class="npp"/.test(X.SEC.now_playing('less', {}, client, ctx)));
ok('...Full takes what the pane has left', /class="sec mp grow"/.test(X.SEC.now_playing('full', {}, client, ctx)));
var less = X.SEC.now_playing('less', {}, client, ctx);
var at = function (h, act) { return h.indexOf('data-act="' + act + '"'); };
ok('...Less, a mini player (2026-10-31, the owner\'s pick): the song, then Speakers, back, play / pause, next, Browse on one row',
   /data-act="spk"[^>]*aria-label="Speakers"/.test(less) && /data-act="brw"[^>]*aria-label="Browse Music"/.test(less) &&
   less.indexOf('Late Light') < at(less, 'spk') && at(less, 'spk') < at(less, 'prev') && at(less, 'prev') < at(less, 'pp') &&
   at(less, 'pp') < at(less, 'next') && at(less, 'next') < at(less, 'brw') && /class="pp big"/.test(less), less);
var src = readFile(HK_ROOT + '/frontend/modules/hk-sidepane.js');
// (as a drawer from the section since 2026-11-01: the player risen to the pane's top, the tabs under it)
ok('...Speakers and Browse open the screensaver\'s panel over the pane, its four tabs', /musicPanel\(this, act === 'spk' \? 'speakers' : 'browse', b\.closest\('\[data-k="now_playing"\]'\), 'drawer'\)/.test(src) &&
   /tabs: \['speakers', 'volume', 'queue', 'browse'\]/.test(src));
ok('...no volume where the player reports none', !/data-act="vol"/.test(less));
client.states['media_player.kitchen'].attributes.volume_level = 0.42;
var lessV = X.SEC.now_playing('less', {}, client, ctx);
ok('...and its volume under the row where it does, set where it is let go', at(lessV, 'brw') < at(lessV, 'vol') && /data-act="vol"[^>]*value="42"/.test(lessV) &&
   /'media_player', 'volume_set', \{ volume_level:/.test(src), lessV);
ok('...a 44 px place for a finger, its track 6 px', /\.vol input\{[^}]*height:44px/.test(src) && /\.vol input::-webkit-slider-runnable-track\{height:6px/.test(src));
ok('...back and next go to the music\'s player', /'media_previous_track' : 'media_next_track'/.test(src));
delete client.states['media_player.kitchen'].attributes.volume_level;

ok('Calendar: the next event, then two, four, five', X.SEC.calendar('tiny', {}, client, ctx).indexOf('Pumpkin carving') > 0 &&
   (X.SEC.calendar('less', {}, client, ctx).match(/class="ev"/g) || []).length === 2);
ok('Who’s Home: home and away counts', X.SEC.people('tiny', {}, client, ctx).indexOf('1 home') > 0 && X.SEC.people('tiny', {}, client, ctx).indexOf('1 away') > 0);
ok('Climate: a room and what it is doing', X.SEC.climate('tiny', {}, client, ctx).indexOf('Living Room 68°') > 0 && X.SEC.climate('tiny', {}, client, ctx).indexOf('Heating') > 0);
ok('Energy: use now', X.SEC.energy('tiny', {}, client, ctx).indexOf('1.4 kW') > 0);
ok('Camera Tiny: its name and the age of its still', X.SEC.camera('tiny', {}, client, ctx).indexOf('Front Door') > 0 &&
   X.SEC.camera('tiny', {}, client, ctx).indexOf('8 s ago') > 0);
// THE STILL (2026-10-31, the owner's item 42: a "?" forever): no picture in the markup until one has loaded -- the
// camera's glyph on the dark plate instead -- then the loaded address, which carries no `hk_n` (Mantel's route
// refuses it, a 400)
var camNone = X.SEC.camera('less', {}, client, ctx);
ok('Camera: before a still has loaded, the glyph and no <img> (never the broken "?")', camNone.indexOf('class="cg"') > 0 && camNone.indexOf('<img') < 0);
ctx.stills['camera.front_door'] = '/api/camera_proxy/camera.front_door?token=t&_hk=1&width=480&height=270';
var camGot = X.SEC.camera('less', {}, client, ctx);
ok('Camera: once loaded, its still over the glyph', /<img[^>]*camera_proxy[^>]*_hk=1/.test(camGot) && camGot.indexOf('hk_n') < 0 && camGot.indexOf('class="cg"') > 0);
ok('Camera: its Name is Hide unless chosen', camGot.indexOf('data-name="hide"') > 0 && X.SEC.camera('less', { name: 'show' }, client, ctx).indexOf('data-name="show"') > 0 &&
   X.SEC.camera('less', { name: 'auto' }, client, ctx).indexOf('data-name="auto"') > 0);
delete ctx.stills['camera.front_door'];

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
  // ---- THE FORECAST (2026-11-01, the owner: under the time only once the Weather page had been opened): asked
  // again at every draw, and the house's forecast sensor first
  var was = window.hkWxForecast, asked = 0, made = 0, port = {};
  window.hkWxForecast = { watch: function (conn) { made++; return { conn: conn, data: function () { return []; }, ensure: function () { asked++; }, release: function () {} }; } };
  // (the element's own method, on a stand-in: the test page does not upgrade custom elements)
  var Pane = customElements.get('hk-side-pane'), pane = { _wx: {}, redraw: function () {}, _forecast: Pane.prototype._forecast }, cl = { states: { 'sensor.fc': { state: 'ok', attributes: { forecast: [{ datetime: 'x', temperature: 60 }] } } }, subscriptions: port };
  pane._forecast(cl, 'weather.home', 'hourly'); pane._forecast(cl, 'weather.home', 'hourly');
  ok('the pane\'s forecast: one watch, asked again at the next draw (after a refusal, or a reconnect)', made === 1 && asked === 1, [made, asked]);
  SET['weather.forecast_daily'] = 'sensor.fc';
  var got = pane._forecast(cl, 'weather.home', 'daily');
  delete SET['weather.forecast_daily'];
  ok('...the house\'s forecast sensor where Configure -> Weather names one, no subscription', got.length === 1 && got[0].temperature === 60 && made === 1, [got, made]);
  window.hkWxForecast = was;
  // ---- NEVER STUCK (2026-11-01, the owner: "occasionally the calendar doesn't load"): a read with no answer given
  // up after LOST and sent again; a failure asked again after LOST, not at every draw
  var K0 = window.hkCalendar, reads = 0, saved = JSON.stringify([X.CAL.evs, X.CAL.at]);
  window.hkCalendar = { ids: function () { return ['calendar.family']; }, load: function () { reads++; return new Promise(function () {}); } };
  X.CAL.evs = null; X.CAL.busy = false; X.CAL.failAt = 0;
  X.calLoad({ states: {} }, 3, function () {}); X.calLoad({ states: {} }, 3, function () {});
  ok('the calendar: one read out at a time', reads === 1, reads);
  X.CAL.busy = Date.now() - X.LOST - 1;
  X.calLoad({ states: {} }, 3, function () {});
  ok('...one unanswered past LOST is given up and asked again', reads === 2, reads);
  window.hkCalendar = { ids: function () { return []; }, load: function () { reads++; return Promise.resolve({ evs: [] }); } };
  X.CAL.busy = false;
  X.calLoad({ states: {} }, 3, function () {});
  ok('...no calendars known yet: nothing read, nothing kept', reads === 2 && X.CAL.evs === null, [reads, X.CAL.evs]);
  window.hkCalendar = K0;
  var sv = JSON.parse(saved); X.CAL.evs = sv[0]; X.CAL.at = sv[1]; X.CAL.busy = false; X.CAL.failAt = 0;
  var tw = 0, tcl = { states: { 'todo.chores': { state: '2', last_updated: 'a' } }, callWS: function () { tw++; return Promise.reject({ code: 'gone' }); } };
  X.todoOf(tcl, 'todo.chores', false, function () {});
  return Promise.resolve().then(function () {}).then(function () {
    X.todoOf(tcl, 'todo.chores', false, function () {});
    ok('a to-do list: a failed read is not sent again at once', tw === 1, tw);
    X.TODO['todo.chores'].failAt = Date.now() - X.LOST - 1;
    X.todoOf(tcl, 'todo.chores', false, function () {});
    ok('...but after LOST, with the list unchanged', tw === 2, tw);
    delete X.TODO['todo.chores'];
  });
}).then(function () {
  print(fail ? '  ' + fail + ' SIDE PANE TESTS FAILED' : '  ALL ' + pass + ' SIDE PANE TESTS PASS');
  if (fail) throw new Error(fail + ' failed');
}).catch(function (e) { print('  FAIL  Exception: ' + e + ' ' + (e.stack || '')); throw e; });
