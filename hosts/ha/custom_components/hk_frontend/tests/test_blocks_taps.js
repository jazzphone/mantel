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
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-intercom.js');
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
  PAGES = true;
  // every block with the option: each choice does what it says, none opens nothing, and the others open something
  KEYS.filter(function (k) { return TABLE[k].opts && TABLE[k].opts.tap === 'tap_target'; }).forEach(function (key) {
    TABLE[key].sizes.forEach(function (size) {
      if (noTap(key, size)) return;
      eq(key + ' ' + size + ', Nothing: nothing', tap(key, size, 'none'), []);
      ['auto', 'page', 'sheet'].forEach(function (mode) { ok(key + ' ' + size + ', ' + mode + ': opens something', tap(key, size, mode).length > 0, tap(key, size, mode)); });
    });
  });
  ok('the choices are the Side Pane\'s four', CAT.TAP_TARGETS.map(function (t) { return t[0]; }).join() === 'auto,page,sheet,none');
}
]);
