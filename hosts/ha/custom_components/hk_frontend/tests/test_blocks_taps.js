// EVERY BLOCK DOES SOMETHING WHEN TAPPED (2026-10-31, the owner's note on 0.1.94, item 29: "ALL the blocks should
// do something if you tap on them" -- the Weather block did not open Weather). The catalog's every key, at every
// size it has, on a square cell and on a tile cell, is made the way the Home Grid makes it (the catalog's config,
// the fictional house's client) and its plate is tapped -- a click that lands on no control. It must open
// something: a page (hkShell.navigate), an entity's sheet (hkShell.moreInfo) or a detail sheet (hkDetail.open).
// A key that opens nothing is in NO_TAP below, each with its reason; a new block with no tap fails here, and so
// does a key left in NO_TAP that has gained one.
//
// The jsc DOM does not parse markup, so a plate is reached the way the cards listen for it: a click arriving at
// the card's shadow root (or the card itself) from a target that is no control.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_taps');
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
           doors: ['binary_sensor.front_door'], windows: ['binary_sensor.office_window'], garage: ['cover.garage_door'],
           locks: ['lock.front_door'], leaks: ['binary_sensor.sink_leak'], vacuums: ['vacuum.downstairs'] },
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
var ok = H.ok, eq = H.eq, C = window.hkCards, CAT = window.hkGridCatalog;
// what the Home Grid's view does with a card config: the HK card of that tag
C.createCard = function (cfg, client) {
  var el = C.create(cfg);
  if (el && client) el.hkSetClient(client);
  return el;
};

// ---- where a tap goes
var WENT = [];
window.hkShell.navigate = function (path) { WENT.push(['navigate', path]); };
window.hkShell.moreInfo = function (id) { WENT.push(['moreInfo', id]); };
window.hkDetail = { open: function (id) { WENT.push(['detail', id]); return true; },
                    openGroup: function (title, ids) { WENT.push(['group', title]); return true; } };
// Everything opens the tab bar's More
window.hkTabBar = { open: function (w) { WENT.push(['more', w]); return true; } };
// the screen's pages: a full set for the first pass, none for the second (a screen with no Weather page and so on)
var PAGES = true;
if (C.menu) {
  C.menu.pagePath = function (p) { return PAGES ? '/hk-kitchen/' + p : null; };
  C.menu.roomPath = function (a) { return PAGES && a ? '/hk-kitchen/room-' + a : null; };
  C.menu.tabBar = function () { return true; };
}

// ---- the fictional house
var house = H.house({
  'light.kitchen_pendants': ['on', { friendly_name: 'Kitchen Pendants', brightness: 128, supported_color_modes: ['brightness'] }],
  'light.den_lamp': ['off', { friendly_name: 'Den Lamp' }],
  'scene.good_morning': ['2026-10-22T07:00:00', { friendly_name: 'Good Morning' }],
  'scene.dinner_time': ['2026-10-22T18:00:00', { friendly_name: 'Dinner Time' }],
  'climate.downstairs': ['heat', { friendly_name: 'Downstairs', current_temperature: 68, temperature: 70, hvac_modes: ['off', 'heat', 'cool'],
                                  hvac_action: 'heating', min_temp: 50, max_temp: 90, target_temp_step: 1 }],
  'weather.home': ['partlycloudy', { friendly_name: 'Home', temperature: 62, humidity: 55, wind_speed: 6, temperature_unit: '°F' }],
  'sun.sun': ['above_horizon', { next_setting: '2026-10-31T22:20:00+00:00', next_rising: '2026-11-01T11:10:00+00:00' }],
  'camera.front_door': ['idle', { friendly_name: 'Front Door' }],
  'camera.driveway': ['idle', { friendly_name: 'Driveway' }],
  'alarm_control_panel.house': ['disarmed', { friendly_name: 'House Alarm' }],
  'lock.front_door': ['locked', { friendly_name: 'Front Door Lock' }],
  'binary_sensor.front_door': ['off', { friendly_name: 'Front Door', device_class: 'door' }],
  'binary_sensor.office_window': ['off', { friendly_name: 'Office Window', device_class: 'window' }],
  'cover.garage_door': ['closed', { friendly_name: 'Garage Door', device_class: 'garage' }],
  'binary_sensor.sink_leak': ['off', { friendly_name: 'Sink Leak', device_class: 'moisture' }],
  'vacuum.downstairs': ['docked', { friendly_name: 'Downstairs', battery_level: 92 }],
  'person.sam': ['home', { friendly_name: 'Sam' }],
  'person.alex': ['not_home', { friendly_name: 'Alex' }],
  'media_player.kitchen_speaker': ['playing', { friendly_name: 'Kitchen Speaker', media_title: 'Song', media_artist: 'Band', volume_level: 0.4 }],
  'sensor.home_power': ['1800', { unit_of_measurement: 'W', friendly_name: 'Home Power' }],
  'sensor.solar_power': ['2400', { unit_of_measurement: 'W', friendly_name: 'Solar Power' }],
  'sensor.grid_power': ['-600', { unit_of_measurement: 'W', friendly_name: 'Grid Power' }],
  'sensor.battery_level': ['64', { unit_of_measurement: '%', friendly_name: 'Battery' }],
  'sensor.water_meter': ['4210', { unit_of_measurement: 'gal', friendly_name: 'Water Meter' }],
  'sensor.running_quick_timers': ['1', { running: [{ name: 'Pasta', entity_id: 'timer.quick_1', finishes_at: new Date(Date.now() + 420000).toISOString() }] }],
  'timer.quick_1': ['active', { friendly_name: 'Quick Timer 1', duration: '0:12:00', finishes_at: new Date(Date.now() + 420000).toISOString() }],
  'calendar.family': ['off', { friendly_name: 'Family' }],
  'todo.shopping': ['2', { friendly_name: 'Shopping' }]
});
function hass() {
  var h = house.hass();
  h.areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' } };
  h.floors = {};
  var reg = function (a) { return { area_id: a }; };
  h.entities = { 'light.kitchen_pendants': reg('kitchen'), 'light.den_lamp': reg('den'), 'media_player.kitchen_speaker': reg('kitchen') };
  h.devices = {};
  return h;
}
var client = window.hkHostClient.from(hass());
// the house as the screen sees it (hk-layout.js hands this to the catalog)
var CTX = { cameras: ['camera.front_door', 'camera.driveway'], climate: ['climate.downstairs'], rooms: ['kitchen', 'den'],
            weather: 'weather.home', vacuum: 'vacuum.downstairs',
            battery: { level: 'sensor.battery_level' }, areas: {}, speakers: [{ entity: 'media_player.kitchen_speaker', area: 'kitchen' }], scenes: ['scene.good_morning'] };

// ---- the cell a block sits in: a square (196 x 196, a 13 px gap) or a tile (196 x 150, 10)
var CELLS = { square: { w: 196, h: 196, gap: 13 }, tile: { w: 196, h: 150, gap: 10 } };
var VARS = {};
globalThis.getComputedStyle = function () {
  return { getPropertyValue: function (k) { return VARS[k] === undefined ? '' : String(VARS[k]); }, getPropertyPriority: function () { return ''; } };
};
function cell(name) { var c = CELLS[name]; VARS = { '--hk-cell-w': c.w, '--hk-cell-h': c.h, '--g-gap': c.gap }; }

// the options a block needs to have anything of its own to show
var OPTS = {
  accessory: { entity: 'light.kitchen_pendants' },
  scene: { scene: 'scene.good_morning' },
  accessories: { accessories: [{ entity: 'light.kitchen_pendants' }, { entity: 'light.den_lamp' }] },
  scenes: { scenes: ['scene.good_morning', 'scene.dinner_time'] },
  action: { action: 'lock_up' },
  todo: { entity: 'todo.shopping' },
  room: { area: 'kitchen' }
};

// ---- a tap on the plate: a click from a target that is no control, at the card's root and the card itself, and
// at the cards a block mounts in itself (a panel's, the Vacuum block's)
function clickFrom(isControl) {
  var t = { tagName: 'HK-PLATE', getAttribute: function () { return null; }, hasAttribute: function () { return false; },
            closest: function () { return null; }, matches: function () { return !!isControl; } };
  return { type: 'click', target: t, composedPath: function () { return [t]; }, stopPropagation: function () {}, preventDefault: function () {} };
}
function tapAt(card, ev, seen) {
  seen = seen || [];
  if (!card || seen.indexOf(card) >= 0) return;
  seen.push(card);
  [card._root, card.shadowRoot, card].forEach(function (el) { if (el) (el._listeners.click || []).slice().forEach(function (f) { f(ev); }); });
  // (a card made before the block gave it its size draws again, as the size attribute makes it in a page)
  [].concat(card._kids || [], card._child || [], card._pad || []).forEach(function (k) {
    if (k && k._render && k.getAttribute && k.getAttribute('size')) { try { k._built = false; k._render(); } catch (e) { /* as drawn */ } }
    tapAt(k, ev, seen);
  });
}
function plateTap(card, isControl) {
  WENT.length = 0;
  tapAt(card, clickFrom(isControl));
  return WENT.slice();
}

// make a block: the catalog's config for the item, a card of its tag in the cell
function block(key, size, cellName, extra) {
  cell(cellName);
  var item = { id: 'b', card: key, size: size, opts: Object.assign({}, OPTS[key] || {}, extra || {}) };
  var cfg = CAT.config(item, CTX), tag = String(cfg.type).replace(/^custom:/, '');
  var el = H.make(tag);
  el.setAttribute('size', size);
  hkGive(el, hass());
  el.setConfig(cfg);
  H.attach(el);
  // a to-do list is opened by the block itself, over the page
  if (key === 'todo') el._open = function (eid) { WENT.push(['list', eid]); };
  return { el: el, tag: tag };
}

// ---- WHAT OPENS NOTHING FROM ITS PLATE, and why: a key, or a key and a size ('energy_rings S'). The block is made of
// controls and has no plate of its own between them, or its plate IS a control whose tap does the block's work.
// (The WebKit click-through, tools/headless/block_taps_check.py, holds the same list and taps the real thing.)
var NO_TAP = {
  timeline: 'Recent is the House Timeline\'s, which this host doesn\'t keep: a stand-in that opens nothing (hk-timeline-block.js on a host with the page)',
  accessory: 'the whole block is the accessory\'s control: a tap toggles it, a hold opens its sheet',
  accessories: 'the block is its tiles, each a control: a tap toggles it, a hold opens its sheet',
  scene: 'the whole block is the scene\'s control: a tap runs it',
  scenes: 'the block is its scenes, each a control: a tap runs it',
  action: 'the whole block is the action\'s control: a tap runs it (or opens its sheet)',
  scene_suggested: 'the whole block is the suggested scene\'s control: a tap runs it',
  'vacuum L': 'the block is the vacuum card itself at its larger sizes: its own listener opens the vacuum\'s sheet (hk-home.js)',
  'vacuum XL': 'the block is the vacuum card itself at its larger sizes: its own listener opens the vacuum\'s sheet (hk-home.js)',
  camera: 'the picture is the control: a tap opens the camera, live (hk-cameras.js)',
  cameras: 'the block is its camera tiles, each a control: a tap opens that camera, live (hk-cameras.js)',
  'energy_rings S': 'Small is its own switch: a tap changes the period (the owner\'s mock-up)',
  intercom: 'inside Home Assistant the Intercom has no server to talk to: the block only says it needs one (hk-intercom.js)'
};
function noTap(key, size) { return NO_TAP[key + ' ' + size] || NO_TAP[key] || null; }

var TABLE = CAT.table(), KEYS = Object.keys(TABLE);
H.run('BLOCK TAPS', [
function () {
  H.section('the catalog\'s every key, at every size, on a square cell and a tile cell');
  KEYS.forEach(function (key) {
    TABLE[key].sizes.forEach(function (size) {
      ['square', 'tile'].forEach(function (cellName) {
        var label = key + ' ' + size + ' ' + cellName, got, tag = '?', b = null;
        try { b = block(key, size, cellName); tag = b.tag; got = plateTap(b.el); }
        catch (e) { got = 'threw ' + String(e && e.message || e) + ' @ ' + String(e && e.stack || '').split('\n').slice(0, 2).join(' | ').replace(/\/[^|]*\//g, ''); }
        if (typeof got === 'string') { ok(label + ' is made', false, got); return; }
        if (noTap(key, size)) ok(label + ' (' + tag + ') opens nothing from its plate: ' + noTap(key, size), got.length === 0, got);
        else ok(label + ' (' + tag + ') opens something', got.length > 0, got);
      });
    });
  });
},
function () {
  H.section('a control inside a block keeps its own tap: a click that lands on one opens nothing');
  KEYS.forEach(function (key) {
    if (noTap(key, TABLE[key].sizes[0]) || key === 'vacuum') return;      // (the Vacuum card has its own listener)
    TABLE[key].sizes.forEach(function (size) {
      if (noTap(key, size)) return;
      var b = block(key, size, 'square'), got = plateTap(b.el, true);
      ok(key + ' ' + size + ': a tap on a control opens nothing of the block\'s', got.length === 0, got);
    });
  });
},
function () {
  H.section('a screen without the page: the entity\'s sheet, or nothing, silently');
  PAGES = false;
  var w = plateTap(block('weather', 'L', 'square').el);
  eq('Weather with no Weather page: the weather\'s sheet', w, [['moreInfo', 'weather.home']]);
  eq('Calendar with no Calendar page: the calendar\'s sheet', plateTap(block('calendar', 'L', 'square').el), [['moreInfo', 'calendar.family']]);
  eq('Battery with no Energy page: the level sensor\'s sheet', plateTap(block('battery', 'L', 'square').el), [['moreInfo', 'sensor.battery_level']]);
  eq('Timers with no Timers page: nothing', plateTap(block('timers', 'W', 'square').el), []);
  eq('Energy Rings with no Energy page: nothing', plateTap(block('energy_rings', 'L', 'square').el), []);
  eq('Doors with no page: nothing', plateTap(block('doors', 'L', 'square').el), []);
  PAGES = true;
},
function () {
  H.section('where each block goes, with the screen\'s pages');
  var where = function (key, size) { return plateTap(block(key, size, 'square').el); };
  eq('Weather opens the Weather page', where('weather', 'L'), [['navigate', '/hk-kitchen/weather']]);
  eq('Calendar opens the Calendar page', where('calendar', 'L'), [['navigate', '/hk-kitchen/calendar']]);
  eq('To-do opens its list', where('todo', 'L'), [['list', 'todo.shopping']]);
  eq('Timers open Timers', where('timers', 'W'), [['navigate', '/hk-kitchen/timers']]);
  eq('Battery opens Energy', where('battery', 'L'), [['navigate', '/hk-kitchen/energy']]);
  eq('Energy Rings open Energy', where('energy_rings', 'L'), [['navigate', '/hk-kitchen/energy']]);
  eq('Power opens Power', where('power', 'L'), [['navigate', '/hk-kitchen/power']]);
  eq('Water opens Water', where('water', 'L'), [['navigate', '/hk-kitchen/water']]);
  eq('Doors open Doors & Windows', where('doors', 'L'), [['navigate', '/hk-kitchen/doors-windows']]);
  eq('Live TV opens Live TV', where('live_tv', 'L'), [['navigate', '/hk-kitchen/live-tv']]);
  eq('Who\'s Home opens the person at home', where('people', 'S'), [['moreInfo', 'person.sam']]);
  eq('On Now opens what is on', where('on_now', 'L')[0][0], 'group');
  // (House Status: its plate -- the heading, a gap -- opens the House Status sheet; each section its own page)
  eq('House Status opens its sheet', where('house_status', 'L'), [['detail', null]]);
  eq('...Small too', where('house_status', 'S'), [['detail', null]]);
  eq('Everything opens More', where('everything', 'L'), [['more', 'more']]);
  eq('the Security block opens the alarm\'s sheet', where('security', 'W'), [['moreInfo', 'alarm_control_panel.house']]);
  eq('the room opens its page', where('room', 'L'), [['navigate', '/hk-kitchen/room-kitchen']]);
  eq('the thermostat opens its sheet', where('thermostat', 'L'), [['moreInfo', 'climate.downstairs']]);
  eq('Now Playing opens the Music page', where('now_playing', 'L'), [['navigate', '/hk-kitchen/playmusic']]);
},
function () {
  H.section('When Tapped (the block\'s option, as the Side Pane\'s): Automatic, Page, Detail Sheet, Nothing');
  var tap = function (key, size, mode) { return plateTap(block(key, size, 'square', mode ? { tap: mode } : {}).el); };
  eq('Weather, Automatic: the page', tap('weather', 'L', 'auto'), [['navigate', '/hk-kitchen/weather']]);
  eq('Weather, Page: the page', tap('weather', 'L', 'page'), [['navigate', '/hk-kitchen/weather']]);
  eq('Weather, Detail Sheet: the weather\'s sheet', tap('weather', 'L', 'sheet'), [['moreInfo', 'weather.home']]);
  eq('Weather, Nothing: nothing', tap('weather', 'L', 'none'), []);
  eq('Doors, Detail Sheet: it has no sheet of its own, so its page', tap('doors', 'L', 'sheet'), [['navigate', '/hk-kitchen/doors-windows']]);
  eq('Thermostat, Page: the Climate page', tap('thermostat', 'L', 'page'), [['navigate', '/hk-kitchen/climate']]);
  eq('Thermostat, Automatic: its sheet', tap('thermostat', 'L', 'auto'), [['moreInfo', 'climate.downstairs']]);
  eq('Thermostat panel (Extra Large), Nothing: nothing, the dial inside too', tap('thermostat', 'XL', 'none'), []);
  eq('Security, Nothing: nothing', tap('security', 'W', 'none'), []);
  eq('To-do, Page: it has no page, so its list', tap('todo', 'L', 'page'), [['list', 'todo.shopping']]);
  PAGES = false;
  eq('Weather, Page, on a screen without one: the sheet', tap('weather', 'L', 'page'), [['moreInfo', 'weather.home']]);
  // A ROOM AS A SHEET (2026-11-09, the owner): Detail Sheet opens the room's own sheet (hk-room.js), laid out as its page;
  // a screen with no page for the room opens it too
  eq('Room, Automatic, on a screen without its page: the room\'s sheet', tap('room', 'L', 'auto'), [['detail', null]]);
  eq('...Small too', tap('room', 'S', 'auto'), [['detail', null]]);
  PAGES = true;
  eq('Room, Automatic: its page', tap('room', 'L', 'auto'), [['navigate', '/hk-kitchen/room-kitchen']]);
  eq('Room, Detail Sheet: the room\'s sheet', tap('room', 'L', 'sheet'), [['detail', null]]);
  eq('...Small, the room as one tile, too', tap('room', 'S', 'sheet'), [['detail', null]]);
  eq('Room, Nothing: nothing', tap('room', 'L', 'none'), []);
  (function () {
    // the room's own ways in -- the Small tile, the heading, "N More" -- go where When Tapped says too
    var b = block('room', 'S', 'square', { tap: 'sheet' });
    WENT.length = 0; b.el._openRoom(true);
    eq('the Small tile, Detail Sheet: the sheet', WENT.slice(), [['detail', null]]);
    b = block('room', 'L', 'square', { tap: 'none' });
    WENT.length = 0; b.el._openRoom(true);
    eq('the Small tile, Nothing: nothing (it is the plate)', WENT.slice(), []);
    WENT.length = 0; b.el._openRoom();
    eq('the heading, Nothing: still the room (it says it opens it)', WENT.slice(), [['navigate', '/hk-kitchen/room-kitchen']]);
    // what the sheet is asked for: the room, its name, the page's glyph
    var asked = null, R = window.hkRoom, was = R.openSheet;
    R.openSheet = function (a, o) { asked = [a, o.name]; return true; };
    block('room', 'L', 'square', { tap: 'sheet' }).el._openRoom();
    R.openSheet = was;
    eq('the sheet is the block\'s room', asked, ['kitchen', 'Kitchen']);
  })();
  // every block with the option: each choice does what it says, none opens nothing, and the others open something
  KEYS.filter(function (k) { return TABLE[k].opts && TABLE[k].opts.tap === 'tap_target'; }).forEach(function (key) {
    TABLE[key].sizes.forEach(function (size) {
      if (noTap(key, size)) return;
      eq(key + ' ' + size + ', Nothing: nothing', tap(key, size, 'none'), []);
      ['auto', 'page', 'sheet'].forEach(function (mode) { ok(key + ' ' + size + ', ' + mode + ': opens something', tap(key, size, mode).length > 0, tap(key, size, mode)); });
    });
  });
  ok('the choices are the Side Pane\'s four', CAT.TAP_TARGETS.map(function (t) { return t[0]; }).join() === 'auto,page,sheet,none');
},
function () {
  // A BLOCK'S CUSTOM DETAIL SHEET (2026-11-07): the grid view is the one place a tap is read for it. Every key, at
  // every size, in a real hk-home-grid-view slot: a tap on its plate opens the sheet and nothing of the card's; a tap
  // on a control of a block that is controls and readings keeps the control's; a block that IS one button opens the
  // sheet from anywhere and never toggles; a swipe, a long press or Edit mode opens nothing.
  H.section('Custom Detail Sheet: every key, every size, through the grid view');
  (function () {                 // (the view's slots need what the jsc DOM lacks: test_homegrid.js's shim)
    var E = Object.getPrototypeOf(document.createElement('div'));
    if (!E.insertBefore) {
      E.insertBefore = function (c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        var i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        c.parentNode = this; return c;
      };
    }
    if (!Object.getOwnPropertyDescriptor(E, 'childNodes')) Object.defineProperty(E, 'childNodes', { configurable: true, get: function () { return this.children; } });
    if (!Object.getOwnPropertyDescriptor(E, 'lastChild')) Object.defineProperty(E, 'lastChild', { configurable: true, get: function () { return this.children[this.children.length - 1] || null; } });
    if (!('firstChild' in E)) Object.defineProperty(E, 'firstChild', { configurable: true, get: function () { return this.children[0] || null; } });
  })();
  var SHEETS = [];
  window.hkDetail.openSheet = function (sheet, o) { SHEETS.push([sheet.title || o.title, sheet.entries.length, o.style]); return true; };
  var SH = { v: 1, title: 'Mine', entries: [{ id: 'e1', entity: 'lock.front_door' }, { id: 'e2', entity: 'light.den_lamp' }] };
  var View = customElements.get('hk-home-grid-view');
  function slotFor(key, size, opts) {
    var b = block(key, size, 'square', opts), it = { card: key, size: size, opts: Object.assign({}, OPTS[key] || {}, opts || {}), interaction: { tap: 'custom_sheet', custom_sheet: SH } };
    var v = new View();
    v.setConfig({ grid: { cols: 6, rows: 4, band: false }, cards: [{ hk_cell: { id: 'x', size: size === 'F' ? 'F' : size, at: [0, 0],
      sheet: { sheet: SH, route: CAT.sheetRoute(it), title: CAT.NAMES[key], style: 'centred' } } }] });
    v.cards = [b.el];
    return { slot: v._root.childNodes[0], el: b.el, view: v, route: CAT.sheetRoute(it) };
  }
  // a click at the slot, from a target that is (or is in) a control, the card's whole plate, or neither
  function slotClick(x, kind, moved) {
    WENT.length = 0; SHEETS.length = 0;
    var stopped = false;
    var t = { tagName: 'DIV', classList: { contains: function () { return false; } }, matches: function () { return kind === 'control' || kind === 'plate'; },
              getAttribute: function (n) { return n === 'data-hk-role' && kind === 'plate' ? 'card' : null; } };
    var at = function (type, xx) { return { type: type, pointerId: 1, clientX: xx, clientY: 0, timeStamp: 1000, target: t } };
    (x.slot._listeners.pointerdown || []).forEach(function (f) { f(at('pointerdown', 0)); });
    if (moved) (x.slot._listeners.pointermove || []).forEach(function (f) { f(at('pointermove', 40)); });
    var ev = { type: 'click', target: t, timeStamp: 1100, defaultPrevented: false, composedPath: function () { return [t, x.el, x.slot]; },
               stopPropagation: function () { stopped = true; }, preventDefault: function () { this.defaultPrevented = true; } };
    (x.slot._listeners.click || []).forEach(function (f) { f(ev); });
    // the card's own listeners hear the click only when the view let it through
    if (!stopped) tapAt(x.el, clickFrom(kind === 'control'));
    return { sheets: SHEETS.slice(), went: WENT.slice(), stopped: stopped };
  }
  KEYS.forEach(function (key) {
    TABLE[key].sizes.forEach(function (size) {
      if (size === 'F') return;
      var x = slotFor(key, size), label = key + ' ' + size + ' (' + x.route + ')';
      var plate = slotClick(x, 'surface');
      ok(label + ': a tap on its plate opens the sheet and nothing of the card\'s', plate.sheets.length === 1 && plate.went.length === 0 && plate.stopped, plate);
      var ctl = slotClick(x, 'control');
      if (x.route === 'primary') ok(label + ': a tap anywhere is the sheet, never the card\'s toggle or run', ctl.sheets.length === 1 && ctl.went.length === 0, ctl);
      else ok(label + ': a control inside keeps its own tap', ctl.sheets.length === 0 && !ctl.stopped, ctl);
      var whole = slotClick(x, 'plate');
      ok(label + ': the card\'s whole plate as its one button opens the sheet', whole.sheets.length === 1 && whole.went.length === 0, whole);
      ok(label + ': a swipe opens nothing', slotClick(x, 'surface', true).sheets.length === 0);
      var go = x.slot.children.filter(function (c) { return c.className === 'sheet-go'; });
      ok(label + ': a 44 px corner button where it is controls and readings, none where it is one button', go.length === (x.route === 'surface' ? 1 : 0), go.length);
    });
  });
  var x = slotFor('weather', 'L');
  if (!document.documentElement) document.documentElement = document.createElement('html');
  document.documentElement.setAttribute('data-hk-editing', '');
  ok('Edit mode: a tap moves the block, never opens its sheet', slotClick(x, 'surface').sheets.length === 0);
  document.documentElement.removeAttribute('data-hk-editing');
  ok('...out of Edit mode, it opens again', slotClick(x, 'surface').sheets.length === 1);
  eq('the sheet is the block\'s: its title, its entries, the screen\'s style', slotClick(x, 'surface').sheets[0], ['Mine', 2, 'centred']);
  // the corner button
  var go = x.slot.children.filter(function (c) { return c.className === 'sheet-go'; })[0];
  SHEETS.length = 0;
  (go._listeners.click || []).forEach(function (f) { f({ stopPropagation: function () {}, preventDefault: function () {} }); });
  ok('the corner button opens it, and says what it opens', SHEETS.length === 1 && /Mine: open details/.test(go.attrs['aria-label']), go.attrs);
  // the sheet turned off: the slot forgets it, the button goes, the card's own tap is back
  x.view.setConfig({ grid: { cols: 6, rows: 4, band: false }, cards: [{ hk_cell: { id: 'x', size: 'L', at: [0, 0] } }] });
  x.view.cards = [x.el];
  var off = slotClick(x, 'surface');
  ok('without a sheet the card opens its own again', off.sheets.length === 0 && off.went.length === 1 && !off.stopped, off);
  ok('...and the corner button is gone', x.slot.children.filter(function (c) { return c.className === 'sheet-go'; }).length === 0);
  // a key on the keyboard on a one-button block
  var k = slotFor('accessory', 'S'), kd = 0;
  SHEETS.length = 0;
  (k.slot._listeners.keydown || []).forEach(function (f) { f({ key: 'Enter', stopPropagation: function () { kd++; }, preventDefault: function () {} }); });
  ok('Enter on a one-button block opens its sheet, not the toggle', SHEETS.length === 1 && kd === 1);
},
function () {
  H.section('Security\'s HomeView: what it says of its entries, never "Locked" unless it is');
  var S = window.hkGridCards._.secHv;
  var st = function (s) { return s == null ? null : { state: s, attributes: {} }; };
  [['lock.a', 'locked', 'Locked', 'secure'], ['lock.a', 'unlocked', 'Unlocked', 'open'], ['lock.a', 'open', 'Open', 'open'],
   ['lock.a', 'jammed', 'Jammed', 'jammed'], ['lock.a', 'locking', 'Locking…', 'moving'], ['lock.a', 'unlocking', 'Unlocking…', 'moving'],
   ['lock.a', 'opening', 'Opening…', 'moving'], ['lock.a', 'unknown', 'Unknown', 'unknown'], ['lock.a', 'unavailable', 'Unavailable', 'unknown'],
   ['lock.a', null, 'Unavailable', 'unknown'], ['lock.a', 'weird_state', 'Weird state', 'unknown'],
   ['cover.g', 'closed', 'Closed', 'secure'], ['cover.g', 'open', 'Open', 'open'], ['cover.g', 'opening', 'Opening…', 'moving'],
   ['cover.g', 'closing', 'Closing…', 'moving'], ['cover.g', 'unavailable', 'Unavailable', 'unknown'], ['cover.g', 'stopped', 'Stopped', 'unknown']
  ].forEach(function (r) {
    eq(r[0] + ' ' + r[2], S.entryState(st(r[1]), r[0]), { word: r[2], kind: r[3] });
  });
  // the house: an alarm and five entries, the last (hidden behind N more on a small block) unlocked
  var H2 = function (alarm, crawl, garage) {
    var h = hass();
    h.states['alarm_control_panel.house'] = { entity_id: 'alarm_control_panel.house', state: alarm, attributes: { friendly_name: 'House Alarm' } };
    ['front', 'back', 'entry', 'crawl'].forEach(function (n) {
      h.states['lock.' + n] = { entity_id: 'lock.' + n, state: n === 'crawl' ? crawl : 'locked', attributes: { friendly_name: n.charAt(0).toUpperCase() + n.slice(1) } };
    });
    h.states['cover.garage_door'] = { entity_id: 'cover.garage_door', state: garage, attributes: { friendly_name: 'Garage Door', device_class: 'garage' } };
    return window.hkHostClient.from(h);
  };
  var cfg = { members: ['lock.front', 'lock.back', 'lock.entry', 'cover.garage_door', 'lock.crawl'] };
  var line = function (a, c, g) { return S.line(S.model(H2(a, c, g), cfg)); };
  eq('all secured, disarmed: the alarm\'s state, never "all secured"', line('disarmed', 'locked', 'closed'), 'Disarmed');
  eq('armed: Armed and its mode', line('armed_home', 'locked', 'closed'), 'Armed · Home');
  eq('one entry unlocked, even the last: its name', line('armed_away', 'unlocked', 'closed'), 'Crawl unlocked');
  eq('two not secured', line('disarmed', 'unlocked', 'open'), '2 not secured');
  eq('triggered comes first', line('triggered', 'unlocked', 'open'), 'Triggered');
  eq('moving after not secured', line('disarmed', 'locking', 'closed'), 'Crawl locking…');
  eq('unavailable after moving', line('disarmed', 'unavailable', 'closed'), 'Crawl unavailable');
  eq('arming is the alarm\'s own word', line('arming', 'locked', 'closed'), 'Arming…');
  var m = S.model(H2('disarmed', 'unlocked', 'closed'), { members: ['lock.front', 'lock.gone'] });
  ok('a member gone from the house is Unavailable, never secured', m.entries[1].kind === 'unknown' && m.secure.length === 1, m.entries);
  var noAlarm = S.model(H2('disarmed', 'locked', 'closed'), { members: ['lock.front'], entity: 'alarm_control_panel.none' });
  noAlarm.alarm = null;
  eq('no alarm and all secured: the doors', S.line(noAlarm), 'All doors secured');
  var auto = S.model(client, {});
  eq('Automatic: the house\'s locks, then its garage doors', auto.entries.map(function (e) { return e.id; }), ['lock.front_door', 'cover.garage_door']);
},
function () {
  H.section('Security\'s HomeView: its sizes, its taps, its overview');
  var SHEETS = [];
  window.hkDetail.openSheet = function (sheet, o) { SHEETS.push({ sheet: sheet, o: o }); return true; };
  // (Extra Large keeps the keypad in HomeView too, 2026-11-08: the keypad card, its entries as HomeView tiles or pills)
  var bx = block('security', 'XL', 'square', { presentation: 'homeview' });
  ok('XL in HomeView keeps the keypad (hk-grid-keypad-card)', bx.tag === 'hk-grid-keypad-card', bx.tag);
  ['S', 'W', 'C', 'L'].forEach(function (size) {
    var b = block('security', size, 'square', { presentation: 'homeview' });
    ok(size + ' is the HomeView presentation (' + b.tag + ')', /hk-grid-security-(hv|key)-card/.test(b.tag));
    SHEETS.length = 0; WENT.length = 0;
    tapAt(b.el, clickFrom(false));
    if (size === 'S') {
      // the key's plate is its button
      var plate = b.el._e && b.el._e.card;
      (plate && plate._listeners.click || []).forEach(function (f) { f({ stopPropagation: function () {} }); });
    } else {
      (b.el._e.al._listeners.click || []).forEach(function (f) { f({ stopPropagation: function () {} }); });
    }
    // (2026-11-08, the owner: "Shouldn't tapping arm/disarm text ... open the alarm keypad": the alarm's own sheet; the overview is
    // "+N more"'s and a group's)
    ok(size + ': the alarm opens the alarm\'s own sheet (its keypad), not the overview', SHEETS.length === 0 && WENT.length === 1 && WENT[0][1] === 'alarm_control_panel.house', [SHEETS, WENT]);
    SHEETS.length = 0; WENT.length = 0;
    if (size !== 'S') b.el._overview();
    if (size !== 'S') ok(size + ': the overview: the alarm and every entry as tiles', SHEETS.length === 1 &&
       SHEETS[0].sheet.entries.map(function (e) { return e.entity; }).join() === 'alarm_control_panel.house,lock.front_door,cover.garage_door' && WENT.length === 0, SHEETS);
    WENT.length = 0;
    if (size !== 'S') {
      var slot = b.el._slots[0];
      WENT.length = 0;
      (slot._listeners.click || []).forEach(function (f) { f({ stopPropagation: function () {} }); });
      if (size === 'W') ok('W: the lock\'s line opens its own sheet (one lock: its name)', WENT.length === 1 && WENT[0][1] === 'lock.front_door', WENT);
      else ok(size + ': an entry opens its own sheet, never operates it', WENT.length === 1 && WENT[0][0] === 'moreInfo' && WENT[0][1] === 'lock.front_door', WENT);
    }
  });
  // the block's own custom sheet is the overview when it has one
  var b2 = block('security', 'W', 'square', { presentation: 'homeview' });
  b2.el.setConfig(Object.assign({}, b2.el._config, { custom_sheet: { v: 1, title: 'Doors', entries: [{ id: 'e1', entity: 'lock.front_door' }] } }));
  SHEETS.length = 0;
  (b2.el._e.al._listeners.click || []).forEach(function (f) { f({ stopPropagation: function () {} }); });
  // (the jsc DOM keeps one element per selector across a redraw, so the redrawn block's area may be heard twice here)
  ok('a block\'s own custom sheet is its overview', SHEETS.length >= 1 && SHEETS.every(function (q) { return q.sheet.title === 'Doors'; }), JSON.stringify(SHEETS.map(function (q) { return q.sheet; })));
  // an old Security layout keeps its keypad
  eq('a Large Security block without HomeView keeps the keypad', block('security', 'L', 'square').tag, 'hk-grid-keypad-card');
}
]);
