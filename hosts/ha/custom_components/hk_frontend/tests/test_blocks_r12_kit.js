// THE KIT'S CALENDAR AND DOORS & LOCKS (round 12, the owner: "it would be nice to have a view with the full months calendar. Like in
// XL or maybe even in L" and "Doors & Locks need to be redone with the new style!"): the Calendar block's month (its days, today,
// the dots, the taps), its list plates and Small; the Doors & Locks block's rows (what needs you first, the windows folded), its
// words, Lock All and Close Garage -- which ask first and send only what is still where the question found it. The jsc DOM does not
// parse markup, so these read the html each card draws.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_r12_kit');
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/give.js');

window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

// ---- the settings feed, as the page holds it
var FEED = {
  added: ['energy', 'clean_areas'],
  energy: { sections: [], power: { home: 'sensor.home_power', solar: 'sensor.solar_power', grid: 'sensor.grid_power',
                                   battery: { level: 'sensor.battery_level' } } },
  headers: { water: { meter: 'sensor.water_meter' } },
  weather: { entity: 'weather.home' },
  security: { alarm: 'alarm_control_panel.house' },
  kinds: { lights: ['light.kitchen_pendants', 'light.den_lamp'], speakers: ['media_player.kitchen_speaker'],
           doors: ['binary_sensor.front_door'], windows: ['binary_sensor.office_window', 'binary_sensor.den_window'], garage: ['cover.garage_door'],
           locks: ['lock.front_door', 'lock.back_door'], leaks: ['binary_sensor.sink_leak'], vacuums: ['vacuum.downstairs'] },
  cameras: { order: ['camera.front_door', 'camera.driveway'] }
};
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return null; },
  subscribe: function () { return function () {}; }
};
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');
load(HK_ROOT + '/frontend/modules/hk-header.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-kit.js');       // the kit every card is drawn from (phase 34)
load(HK_ROOT + '/tests/music_house.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
load(HK_ROOT + '/frontend/cards/hk-control.js');
load(HK_ROOT + '/frontend/cards/hk-weather.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-people.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-intercom.js');
load(HK_ROOT + '/frontend/cards/hk-house-status.js');
load(HK_ROOT + '/frontend/cards/hk-home-block.js');
load(HK_ROOT + '/frontend/cards/hk-alert.js');
load(HK_ROOT + '/frontend/cards/hk-laundry-card.js');
load(HK_ROOT + '/frontend/cards/hk-tv-card.js');
load(HK_ROOT + '/frontend/modules/hk-sidepane.js');
load(HK_ROOT + '/frontend/cards/hk-calendar.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');      // hk-key-card: the stand-in of a block this host doesn't have (Recent)
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');


// what the jsc DOM lacks and the blocks reach for
[El.prototype, HTMLElement.prototype].forEach(function (P) {
  P.replaceChildren = function () { var self = this; this.children = []; Array.prototype.forEach.call(arguments, function (c) { self.appendChild(c); }); };
  Object.defineProperty(P, 'firstElementChild', { configurable: true, get: function () { return this.children[0] || this.querySelector('*first'); } });
});
var C = window.hkCards, CAT = window.hkGridCatalog;
var WENT = [];
window.hkShell.navigate = function (path) { WENT.push(['navigate', path]); };
window.hkShell.moreInfo = function (id) { WENT.push(['moreInfo', id]); };
if (C.menu) { C.menu.pagePath = function (p) { return '/hk-kitchen/' + p; }; C.menu.tabBar = function () { return true; }; }
// the cell a block sits in: a square (196 x 196, a 13 px gap)
var VARS = { '--hk-cell-w': 196, '--hk-cell-h': 196, '--g-gap': 13 };
globalThis.getComputedStyle = function () {
  return { getPropertyValue: function (k) { return VARS[k] === undefined ? '' : String(VARS[k]); }, getPropertyPriority: function () { return ''; } };
};
function html(card) { return card._root.__html || ''; }
function count(s, re) { return (s.match(re) || []).length; }

// ---- the house: two locks (one unlocked), a garage door open that can close, a door contact open, two windows closed
function doorsHouse(over) {
  var rows = {
    'lock.front_door': ['unlocked', { friendly_name: 'Front Door Lock' }], 'lock.back_door': ['locked', { friendly_name: 'Back Door Lock' }],
    'cover.garage_door': ['open', { friendly_name: 'Garage Door', device_class: 'garage', supported_features: 3 }],
    'binary_sensor.front_door': ['on', { friendly_name: 'Patio Door', device_class: 'door' }],
    'binary_sensor.office_window': ['off', { friendly_name: 'Office Window', device_class: 'window' }],
    'binary_sensor.den_window': ['off', { friendly_name: 'Den Window', device_class: 'window' }],
    'calendar.family': ['off', { friendly_name: 'Family' }]
  };
  Object.keys(over || {}).forEach(function (k) { rows[k] = over[k]; });
  return H.house(rows);
}
function doorsBlock(size, hs) {
  var el = H.make('hk-grid-panel-card');
  el.setAttribute('size', size);
  hkGive(el, hs.hass());
  el.setConfig(CAT.config({ id: 'b', card: 'doors', size: size, opts: {} }, {}));
  H.attach(el);
  return el;
}
var Panel = customElements.get('hk-grid-panel-card');
var NOW = new Date(), TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
var DIM = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).getDate();
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function at(d, h, m) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }

H.run('KIT: CALENDAR AND DOORS & LOCKS', [
  function () {
    H.section('Doors & Locks: the facts');
    var m = Panel.doorsModel(doorsHouse().hass().states ? { states: doorsHouse().hass().states } : null, { locks: ['lock.front_door', 'lock.back_door'], garage: ['cover.garage_door'],
      doors: ['binary_sensor.front_door'], windows: ['binary_sensor.office_window', 'binary_sensor.den_window'] });
    H.eq('what needs you first (the block\'s own order within each group), the quiet ones after, the closed windows one row',
         m.rows.map(function (r) { return r.name; }), ['Front Door', 'Garage Door', 'Patio Door', 'Back Door', 'Windows']);
    H.eq('...each said as it is', m.rows.map(function (r) { return r.word; }), ['Unlocked', 'Open', 'Open', 'Locked', '2 closed']);
    H.eq('the count in words, over every entry', m.sub, '1 unlocked · 2 open');
    H.eq('Lock All would send the unlocked lock; Close Garage the open garage door that can close', [m.lockIds, m.garageIds], [['lock.front_door'], ['cover.garage_door']]);
    H.eq('a window open is its own row, and the folded one is gone while one is left',
         Panel.doorsModel({ states: doorsHouse({ 'binary_sensor.den_window': ['on', { friendly_name: 'Den Window', device_class: 'window' }] }).hass().states },
           { windows: ['binary_sensor.office_window', 'binary_sensor.den_window'] }).rows.map(function (r) { return r.name + ' ' + r.word; }), ['Den Window Open', 'Office Window Closed']);
    var q = Panel.doorsModel({ states: doorsHouse({ 'lock.front_door': ['locked', {}], 'cover.garage_door': ['closed', {}], 'binary_sensor.front_door': ['off', {}] }).hass().states },
      { locks: ['lock.front_door', 'lock.back_door'], garage: ['cover.garage_door'], doors: ['binary_sensor.front_door'], windows: [] });
    H.ok('all secure: nothing needs you, nothing to lock', q.needs === 0 && q.sub === '' && q.all === 'All Secure' && !q.lockIds.length && !q.garageIds.length);
    var u = Panel.doorsModel({ states: doorsHouse({ 'lock.back_door': ['unavailable', {}], 'lock.front_door': ['jammed', {}] }).hass().states }, { locks: ['lock.front_door', 'lock.back_door'] });
    H.ok('a jammed or unreadable lock is never called locked; Lock All tries the jammed one, not the unreadable', u.needs === 2 && u.sub === '1 jammed · 1 unavailable' &&
         u.lockIds.join() === 'lock.front_door');
  },
  function () {
    H.section('Doors & Locks: each size');
    var s = html(doorsBlock('S', doorsHouse()));
    H.ok('Small: the open lock, "3 Unsecured", their short names', /hk-plate class="kit/.test(s) && s.indexOf('3 Unsecured') > 0 && s.indexOf('Front, Garage, Patio') > 0 &&
      s.indexOf('hk:lock-open-variant') > 0, s.slice(0, 300));
    s = html(doorsBlock('S', doorsHouse({ 'lock.front_door': ['locked', {}], 'cover.garage_door': ['closed', {}], 'binary_sensor.front_door': ['off', {}] })));
    H.ok('...all locked or closed: a closed lock, "All Secure", what it watches', s.indexOf('All Secure') > 0 && s.indexOf('2 locks · 2 doors') > 0 && s.indexOf('hk:lock"') > 0, s);
    s = html(doorsBlock('W', doorsHouse()));
    H.ok('Wide: rows in two columns, no header, no keys', count(s, /class="row"/g) === 5 && s.indexOf('Doors &amp; Locks') < 0 && s.indexOf('data-act') < 0);
    s = html(doorsBlock('T', doorsHouse()));
    H.ok('Tall: the header with the teal summary, the rows, Lock All', s.indexOf('Doors &amp; Locks') > 0 && s.indexOf('1 unlocked · 2 open') > 0 && count(s, /class="row"/g) === 4 &&
         /data-act="lock"/.test(s) && s.indexOf('Close Garage') < 0, s);
    H.ok('...never a needing row behind "N more": the open ones lead, teal', s.indexOf('2 more') > 0 && /Unlocked<\/span>/.test(s) && s.indexOf('Front Door') < s.indexOf('Garage Door'));
    s = html(doorsBlock('L', doorsHouse()));
    H.ok('Large: two columns, every row, Lock All', count(s, /class="row"/g) === 5 && !/\d+ more/.test(s) && /data-act="lock"/.test(s) && s.indexOf('Close Garage') < 0);
    s = html(doorsBlock('XL', doorsHouse()));
    H.ok('Extra Large: three columns, Lock All and Close Garage', count(s, /class="row"/g) === 5 && /data-act="lock"/.test(s) && /data-act="garage"/.test(s) && s.indexOf('Close Garage') > 0);
    s = html(doorsBlock('XL', doorsHouse({ 'lock.front_door': ['locked', {}], 'cover.garage_door': ['closed', { supported_features: 3, device_class: 'garage' }] })));
    H.ok('...with nothing to lock or close the keys are there and dimmed', /disabled aria-disabled="true"[^>]*data-act="lock"/.test(s) && /disabled aria-disabled="true"[^>]*data-act="garage"/.test(s),
      s);
    s = html(doorsBlock('XL', H.house({ 'lock.front_door': ['unlocked', { friendly_name: 'Front Door Lock' }] })));
    H.ok('no garage door in the block: no Close Garage', s.indexOf('Close Garage') < 0 && s.indexOf('Lock All') > 0);
    var el = doorsBlock('L', doorsHouse());
    H.eq('a row opens that entry\'s sheet', WENT.length, 0);
    H.ok('...(the rows say which: data-id on each)', /data-id="lock.front_door"/.test(html(el)) && /data-id="cover.garage_door"/.test(html(el)) && /data-more="1"/.test(html(el)));
    // White glyphs: a quiet glyph the words' own color; a needing one keeps teal
    el = H.make('hk-grid-panel-card'); el.setAttribute('size', 'L'); hkGive(el, doorsHouse().hass());
    el.setConfig(CAT.config({ id: 'b', card: 'doors', size: 'L', opts: { glyphs: 'white' } }, {}));
    H.attach(el);
    H.ok('Glyphs: White turns a quiet glyph the words\' ink and keeps what needs you teal',
         /color:var\(--hk-ink,[^)]*\)\)?"><hk-icon icon="hk:lock"/.test(html(el)) && /color:var\(--hk-teal,[^)]*\)"><hk-icon icon="hk:lock-open-variant"/.test(html(el)), html(el).slice(0, 100));
    H.ok('...else a quiet glyph is the secondary ink', /color:var\(--hk-ink-2,[^)]*\)\)?"><hk-icon icon="hk:lock"/.test(html(doorsBlock('L', doorsHouse()))));
  },
  function () {
    H.section('Doors & Locks: Lock All and Close Garage ask first');
    var hs = doorsHouse(), el = doorsBlock('XL', hs), asked = [];
    C.confirmSheet = function (text, ok, o) { asked.push({ text: text, ok: ok, o: o }); };
    el._doorsAsk('lock');
    H.eq('Lock All asks, naming what it locks', asked.map(function (a) { return a.text; }), ['Lock Front Door?']);
    H.eq('...and has sent nothing yet', hs.calls.length, 0);
    return H.tick(2).then(function () {
      H.eq('...still nothing after the question', hs.calls.length, 0);
      asked[0].ok();
      return H.tick(4);
    }).then(function () {
      H.eq('Confirm sends lock.lock to the unlocked lock only, through the card\'s action port', hs.calls, [{ domain: 'lock', service: 'lock', data: { entity_id: ['lock.front_door'] } }]);
      el._doorsAsk('garage');
      H.eq('Close Garage asks too', asked[1].text, 'Close Garage Door?');
      // the door was locked by someone else while the question was open: nothing is sent
      el.hkSetClient && 0;
      var hs2 = doorsHouse(), el2 = doorsBlock('L', hs2);
      asked.length = 0;
      el2._doorsAsk('lock');
      hs2.set('lock.front_door', 'locked');
      hkGive(el2, hs2.hass());
      asked[0].ok();
      return H.tick(4).then(function () { H.eq('what is no longer unlocked is not sent', hs2.calls.length, 0); });
    }).then(function () {
      var hs3 = doorsHouse({ 'lock.back_door': ['unlocked', { friendly_name: 'Back Door Lock' }] }), el3 = doorsBlock('L', hs3);
      asked.length = 0;
      el3._doorsAsk('lock');
      H.ok('two locks: counted, and named under it', asked[0].text === 'Lock 2 doors?' && asked[0].o.detail === 'Front Door, Back Door', asked[0]);
      // a call that did not go: the key says so for a moment
      el3._call = function () { return Promise.resolve(false); };
      asked[0].ok();
      return H.tick(4).then(function () {
        H.ok('a refused call: "Didn\'t Go Through" on the key', html(el3).indexOf('Didn’t Go Through') > 0, html(el3).slice(-300));
      });
    });
  },
  function () {
    H.section('Calendar: the month');
    var Pane = customElements.get('hk-calendar-pane-card');
    var home = { states: { 'calendar.family': { state: 'off', attributes: { friendly_name: 'Family' } } } };
    var ev = function (id, d, h0, h1, cal) { return { uid: id, title: id, start: at(d, h0), end: at(d, h1), allDay: false, cal: cal || 'calendar.family' }; };
    // February 2026 starts on a Sunday and has 28 days: four weeks, no day outside the month
    var f = Pane.monthModel([ev('a', new Date(2026, 1, 3), 9, 10), ev('b', new Date(2026, 1, 3), 11, 12)], home, new Date(2026, 1, 1), new Date(2026, 1, 10, 12), null);
    H.ok('Feb 2026: four weeks of seven, the 1st first', f.weeks === 4 && f.cells.length === 28 && f.cells[0].n === 1 && f.cells[27].n === 28 && f.name === 'February' && f.year === 2026);
    H.ok('...today and weekends flagged, two events of one calendar one dot', f.cells[9].today && !f.cells[8].today && f.cells[0].weekend && f.cells[6].weekend && !f.cells[1].weekend &&
         f.cells[2].colors.length === 1 && f.cells[2].count === 2 && f.cells[3].colors.length === 0);
    // November 2025 starts on a Saturday: six weeks, six empty cells before the 1st
    var n = Pane.monthModel([], home, new Date(2025, 10, 1), new Date(2025, 10, 1, 12), new Date(2025, 10, 5));
    H.ok('Nov 2025: six weeks, the first six cells outside the month, the 5th chosen', n.weeks === 6 && n.cells.slice(0, 6).every(function (c) { return c === null; }) && n.cells[6].n === 1 &&
      n.cells[10].sel && n.cells[6].today);
    var multi = Pane.monthModel([{ uid: 'trip', title: 'Trip', start: new Date(2026, 1, 4), end: new Date(2026, 1, 9), allDay: true, cal: 'calendar.family' }], home,
      new Date(2026, 1, 1), new Date(2026, 1, 10), null);
    H.ok('a long event dots the day it starts, not every day it spans', multi.cells[3].count === 1 && multi.cells[4].count === 0);
  },
  function () {
    H.section('Calendar: Large is the month, Extra Large the month and the day');
    var Pane = customElements.get('hk-calendar-pane-card'), U = window.hkCalendar._;
    var evs = [
      { uid: 'a', summary: 'Recycling Day', start: { date: ymd(TODAY) }, end: { date: ymd(addDays(TODAY, 1)) } },
      { uid: 'p', summary: 'Piano Lesson', start: { dateTime: U.isoLocal(at(TODAY, 14)) }, end: { dateTime: U.isoLocal(at(TODAY, 15)) } },
      { uid: 'x', summary: 'Breakfast', start: { dateTime: U.isoLocal(at(TODAY, 8)) }, end: { dateTime: U.isoLocal(at(TODAY, 9)) } },
      { uid: 't', summary: 'Dentist', start: { dateTime: U.isoLocal(at(addDays(TODAY, 1), 9)) }, end: { dateTime: U.isoLocal(at(addDays(TODAY, 1), 10)) } }];
    function block(size, cfg, events) {
      U.store.got = {}; U.store.live = {};
      var hs = doorsHouse(), card = H.make('hk-calendar-pane-card');
      card.setAttribute('size', size);
      card.setConfig(Object.assign({ type: 'custom:hk-calendar-pane-card' }, cfg || {}));
      card.hass = hs.hass();
      hs.api.forEach(function (r) { r.resolve(events || evs); });
      return H.tick(8).then(function () { return { card: card, hs: hs }; });
    }
    var first = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), from = U.weekStart(first);
    return block('L').then(function (r) {
      var s = html(r.card);
      H.ok('Large reads the month\'s weeks, with no Month View asked for', r.hs.api[0].path.indexOf(encodeURIComponent(U.isoLocal(from))) > 0 &&
           r.hs.api[0].path.indexOf(encodeURIComponent(U.isoLocal(addDays(from, 42)))) > 0, r.hs.api[0].path);
      H.ok('...the kit\'s plate, the month and the year as the header', /hk-plate class="kit/.test(s) && s.indexOf('>' + TODAY.getFullYear() + '<') > 0 && s.indexOf('class="a kt"') > 0);
      H.eq('...every day of the month a button, none outside it', count(s, /data-day="/g), DIM);
      H.ok('...today a filled red circle, white and bold', new RegExp('data-day="' + ymd(TODAY) + '"[^>]*><span class="a fc num"[^>]*font-weight:700;background:#ff453a;color:#fff').test(s));
      H.ok('...a dot under a day with something on it', /<i style="width:5px;height:5px;border-radius:50%;background:rgba\(/.test(s));
      H.ok('...a day says how many events it has', new RegExp('aria-label="[A-Za-z]+, [A-Za-z]+ ' + TODAY.getDate() + ', 3 events"').test(s), s.slice(0, 200));
      H.ok('...no list beside it, no keys', s.indexOf('class="row"') < 0);
      WENT.length = 0;
      var el = { getAttribute: function (k) { return k === 'data-day' ? ymd(addDays(TODAY, 1)) : null; }, hasAttribute: function (k) { return k === 'data-day'; } };
      window.hkCards.navigate = function (to) { WENT.push(['navigate', to]); };
      r.card._tapOn(el);
      H.ok('a tap on a day opens it on the Calendar page', WENT.length === 1 && WENT[0][1].indexOf('calendar?day=' + ymd(addDays(TODAY, 1))) > 0, WENT);
      return block('XL');
    }).then(function (r) {
      var s = html(r.card), card = r.card;
      H.ok('Extra Large: the month on the left, a hairline, "Today" and the day\'s events as rows', s.indexOf('>Today<') > 0 && count(s, /class="row"/g) === 3 && /class="a sep"/.test(s) &&
        s.indexOf('Recycling Day') > 0);
      H.ok('...the past one in the quiet ink, all-day first', s.indexOf('kt quiet') > 0 && s.indexOf('All day') > 0);
      var other = addDays(TODAY, TODAY.getDate() < 15 ? 1 : -1), went = [];
      window.hkCards.navigate = function (to) { went.push(to); };
      var el = { getAttribute: function (k) { return k === 'data-day' ? ymd(other) : null; }, hasAttribute: function (k) { return k === 'data-day'; } };
      card._tapOn(el);
      s = html(card);
      H.ok('a tap chooses a day: ringed, its name beside the month', went.length === 0 && s.indexOf('box-shadow:inset 0 0 0 2px') > 0 && s.indexOf('>Today<') < 0);
      card._tapOn(el);
      H.ok('...a second opens it on the Calendar page', went.length === 1 && went[0].indexOf('calendar?day=' + ymd(other)) > 0, went);
      return block('T', { month: true });
    }).then(function (r) {
      H.ok('Month View on a Tall block keeps the older drawing', html(r.card).indexOf('class="blk mo T"') >= 0 && html(r.card).indexOf('hk-plate class="kit') < 0);
      return block('T');
    }).then(function (r) {
      var s = html(r.card);
      H.ok('Tall: the list plate -- the day, the date, a row for each event with its color bar',
        s.indexOf('>' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][TODAY.getDay()] + '<') > 0 &&
           count(s, /class="row"/g) >= 3 && /width:4px;height:40px;border-radius:calc\(4px \/ 2\);background:rgba\(/.test(s));
      H.ok('...the past left out, a later day in the row\'s words, the hour on the hour short', s.indexOf('Breakfast') < 0 && s.indexOf('2 PM') > 0 && s.indexOf('Tomorrow, 9 AM') > 0, s);
      return block('W');
    }).then(function (r) {
      var s = html(r.card);
      H.ok('Wide: one row fits under the header, the rest counted', count(s, /class="row"/g) === 1 && s.indexOf('2 more') > 0);
      return block('S');
    }).then(function (r) {
      var s = html(r.card);
      H.ok('Small: the date as the figure, the weekday, the next event', s.indexOf('>' + TODAY.getDate() + '<') > 0 && s.indexOf('Recycling Day') > 0 && /data-go="1"/.test(s));
      var opened = [];
      window.hkDetail = { open: function (cal, x, o) { opened.push(o.event.title); return true; } };
      if (!customElements.get('hk-detail-event')) customElements.define('hk-detail-event', function () {});
      r.card._tapOn({ getAttribute: function () { return '1'; }, hasAttribute: function (k) { return k === 'data-go'; } });
      H.eq('...a tap opens the next event', opened, ['Recycling Day']);
      return block('S', {}, []);
    }).then(function (r) {
      H.ok('Small with nothing on: said so', html(r.card).indexOf('Nothing scheduled') > 0);
    });
  }
]);
