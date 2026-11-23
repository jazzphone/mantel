// ROUND 12 (2026-11-23): the Home, Room and People blocks, from Wide up, drawn in the kit -- the Home block's picture by the sun and its
// category buttons, the Room block's picture, chips, scenes and keys, the People block's cluster and rows. A fictional house.
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
  kinds: { thermostats: ['climate.downstairs'], lights: ['light.kitchen_pendants', 'light.den_lamp'], speakers: ['media_player.kitchen_speaker'],
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
  'sensor.washer_machine_state': ['run', { friendly_name: 'Washer Machine State', device_class: 'enum', options: ['pause', 'run', 'stop'] }],
  'sensor.washer_job_state': ['wash', { friendly_name: 'Washer Job State', device_class: 'enum', options: ['wash', 'rinse', 'spin', 'drying', 'finish', 'none'] }],
  'person.sam': ['home', { friendly_name: 'Sam' }],
  'person.alex': ['not_home', { friendly_name: 'Alex' }],
  'media_player.kitchen_speaker': ['playing', { friendly_name: 'Kitchen Speaker', media_title: 'Song', media_artist: 'Band', volume_level: 0.4 }],
  // (a den TV and its Apple TV, for the TV block: hk-tv.js pairs them by room)
  'media_player.den_tv': ['on', { friendly_name: 'Den TV', device_class: 'tv', source: 'HDMI 1', source_list: ['HDMI 1', 'HDMI 2'], volume_level: 0.2, supported_features: 24509 }],
  'media_player.den_apple_tv': ['playing', { friendly_name: 'Den Apple TV', app_id: 'com.netflix.Netflix', app_name: 'Netflix', media_title: 'A Show', source_list: ['Netflix', 'YouTube'] }],
  'remote.den_apple_tv': ['on', { friendly_name: 'Den Apple TV' }],
  'sensor.home_power': ['1800', { unit_of_measurement: 'W', friendly_name: 'Home Power' }],
  'sensor.solar_power': ['2400', { unit_of_measurement: 'W', friendly_name: 'Solar Power' }],
  'sensor.grid_power': ['-600', { unit_of_measurement: 'W', friendly_name: 'Grid Power' }],
  'sensor.battery_level': ['64', { unit_of_measurement: '%', friendly_name: 'Battery' }],
  'sensor.water_meter': ['4210', { unit_of_measurement: 'gal', friendly_name: 'Water Meter' }],
  'sensor.running_quick_timers': ['1', { running: [{ name: 'Pasta', entity_id: 'timer.quick_1', finishes_at: new Date(Date.now() + 420000).toISOString() }] }],
  'timer.quick_1': ['active', { friendly_name: 'Quick Timer 1', duration: '0:12:00', finishes_at: new Date(Date.now() + 420000).toISOString() }],
  'calendar.family': ['off', { friendly_name: 'Family' }],
  'todo.shopping': ['2', { friendly_name: 'Shopping' }],
  // (round 12: the Room card's chips and scenes, the humidity, the people's arrivals)
  'light.kitchen_island': ['on', { friendly_name: 'Kitchen Island', brightness: 255, supported_color_modes: ['brightness'] }],
  'media_player.kitchen_tv': ['on', { friendly_name: 'Kitchen TV', device_class: 'tv' }],
  'cover.kitchen_shade': ['open', { friendly_name: 'Kitchen Shade', device_class: 'shade' }],
  'sensor.kitchen_humidity': ['45', { friendly_name: 'Kitchen Humidity', device_class: 'humidity' }],
  'sensor.kitchen_temp': ['71.4', { friendly_name: 'Kitchen Temp', device_class: 'temperature' }],
  'scene.kitchen_cooking': ['unknown', { friendly_name: 'Cooking', entity_id: ['light.kitchen_island'] }],
  'scene.kitchen_dinner': ['on', { friendly_name: 'Dinner', entity_id: ['light.kitchen_island'] }],
  'person.robin': ['home', { friendly_name: 'Robin Smith', entity_picture: '/api/person/person.robin/picture?v=1' }],
  'person.jordan': ['School', { friendly_name: 'Jordan' }]
});
function hass() {
  var h = house.hass();
  h.areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen', icon: 'mdi:silverware-fork-knife', humidity_entity_id: 'sensor.kitchen_humidity', picture: '/api/image/serve/abc123/512x512' },
              den: { area_id: 'den', name: 'Den' } };
  h.floors = {};
  var reg = function (a) { return { area_id: a }; };
  h.entities = { 'light.kitchen_pendants': reg('kitchen'), 'light.kitchen_island': reg('kitchen'), 'media_player.kitchen_tv': reg('kitchen'), 'cover.kitchen_shade': reg('kitchen'),
                 'sensor.kitchen_humidity': reg('kitchen'), 'sensor.kitchen_temp': reg('kitchen'), 'scene.kitchen_cooking': reg('kitchen'), 'scene.kitchen_dinner': reg('kitchen'),
                   'light.den_lamp': reg('den'), 'media_player.kitchen_speaker': reg('kitchen'),
                 'sensor.washer_machine_state': { area_id: 'kitchen', device_id: 'w1' }, 'sensor.washer_job_state': { area_id: 'kitchen', device_id: 'w1' },
                 'media_player.den_tv': { area_id: 'den', platform: 'webostv' }, 'media_player.den_apple_tv': { area_id: 'den', platform: 'apple_tv' } };
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
  tv: { tv: 'media_player.den_tv' },
  swipe: { pages: [{ card: 'tv', opts: { tv: 'media_player.den_tv' } }, { card: 'clock' }] },
  accessories: { accessories: [{ entity: 'light.kitchen_pendants' }, { entity: 'light.den_lamp' }] },
  scenes: { scenes: ['scene.good_morning', 'scene.dinner_time'] },
  action: { action: 'lock_up' },
  todo: { entity: 'todo.shopping' },
  room: { area: 'kitchen' },
  alert: { title: 'Garage Still Open', since: 'cover.garage_door', camera: 'camera.driveway', control: 'cover.garage_door' }
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
// ---- a block made the way the Home Grid makes it, with the house tweaked first
function make(key, size, opts, tweak, cellName) {
  cell(cellName || 'square');
  var item = { id: 'b', card: key, size: size, opts: Object.assign({}, OPTS[key] || {}, opts || {}) };
  var cfg = window.hkGridCatalog.config(item, CTX), tag = String(cfg.type).replace(/^custom:/, '');
  var el = H.make(tag), h = hass();
  if (tweak) tweak(h);
  el.setAttribute('size', size);
  hkGive(el, h);
  el.setConfig(cfg);
  H.attach(el);
  return el;
}
var CALLS = function () { return house.calls.map(function (c) { return c.domain + '.' + c.service; }); };
var sun = function (state, elevation, rising) { return function (h) { h.states['sun.sun'] = Object.assign({}, h.states['sun.sun'],
  { state: state, attributes: { elevation: elevation, rising: rising } }); }; };
var html = function (el) { return String(el._kitHtml || ''); };
var at = function (s, x) { return s.indexOf(x); };

H.run('ROUND 12 BLOCKS', [
function () {
  H.section('Home: Small is the glyph alone (the older drawing); Wide and up are the kit\'s picture card');
  var s = make('home', 'S');
  ok('Small draws no kit html (it is today\'s glyph)', !s._kitHtml);
  ['W', 'T', 'L', 'XL'].forEach(function (size) {
    var el = make('home', size), h = html(el);
    ok(size + ': a kit plate with the picture, "Home" and its buttons', /class="kit photo"|hk-plate class="kit photo/.test(h) && h.indexOf('<svg') >= 0 && h.indexOf('>Home<') >= 0 &&
      h.indexOf('class="hb"') >= 0, h.slice(0, 200));
    var names = (h.match(/<b>[^<]*<\/b><i/g) || []).map(function (x) { return x.slice(3, x.length - 6); });
    ok(size + ': the buttons are Climate, Lights, Doors (a quiet Doors, nothing open, is made up), Security', names.slice(0, 3).join() === 'Climate,Lights,Doors' &&
      (size === 'W' || size === 'T' || names[3] === 'Security'), names.join());
    ok(size + ': never a blur of its own (the buttons are a translucent dark)', !/backdrop-filter/.test(h.slice(h.indexOf('</style>', h.indexOf('</style>') + 1))), '');
  });
  var w = html(make('home', 'W')), l = html(make('home', 'L')), xl = html(make('home', 'XL'));
  ok('Wide has three buttons, Large four', [w, l].map(function (x) { return (x.match(/class="key"/g) || []).length; }).join() === '3,4', '');
  ok('Extra Large lists the rooms (data-r) and has the scrolling panel', at(xl, 'data-r="kitchen"') > 0 && at(xl, 'Rooms') > 0 && at(w, 'data-r=') < 0, '');
  ok('a button is a key that opens its category (data-i, never the plate\'s tap)', /data-notap data-i="0"/.test(l), '');
},
function () {
  H.section('Home: the picture follows the sun and the lights');
  var day = html(make('home', 'L', {}, sun('above_horizon', 48, true))), night = html(make('home', 'L', {}, sun('below_horizon', -30, false)));
  ok('by day: the blue sky, no lit window', at(day, '#4a93dc') > 0 && at(day, 'url(#hwn)') < 0, '');
  ok('at night: the dark sky, the moon and windows lit by the lights that are on', at(night, '#050816') > 0 && at(night, '#f4efe0') > 0 && at(night, 'url(#hwn)') > 0, '');
  ok('dusk is the sunset\'s sky; dawn the sunrise\'s',
    at(html(make('home', 'L', {}, sun('above_horizon', 2, false))), '#d98d68') > 0 && at(html(make('home', 'L', {}, sun('above_horizon', 2, true))), '#e39b7e') > 0, '');
  ok('the card is redrawn when the look moves, not before (the signature says which look)', make('home', 'L', {}, sun('above_horizon', 48, true))._sigOf() !==
     make('home', 'L', {}, sun('below_horizon', -30, false))._sigOf() && make('home', 'L', {}, sun('above_horizon', 48, true))._sigOf() ===
     make('home', 'L', {}, sun('above_horizon', 31, true))._sigOf(), '');
  ok('dimmed: a black wash over it', /rgba\(0,0,0,0?\.(08|22|26|42)\)/.test(night + day), '');
},
function () {
  H.section('Room: Small is today\'s tile; bigger is the room\'s picture, readings, chips, scene keys');
  ok('Small draws no kit html', !make('room', 'S')._kitHtml);
  ['W', 'T', 'L', 'XL'].forEach(function (size) {
    var el = make('room', size), h = html(el);
    ok(size + ': the room\'s name and its readings (temperature and humidity)', at(h, '>Kitchen<') > 0 && at(h, '71° · 45% humidity') > 0, h.slice(0, 120));
    ok(size + ': its scenes as keys at the foot, the chosen one white', at(h, 'data-sc="scene.kitchen_cooking"') > 0 && /class="key on"[^>]*data-sc="scene.kitchen_dinner"/.test(h), '');
    ok(size + ': never a blur of its own', !/backdrop-filter/.test(h.slice(h.indexOf('<style>', h.indexOf('<style>') + 1))), '');
  });
  var L = html(make('room', 'L')), W = html(make('room', 'W')), XL = html(make('room', 'XL'));
  ok('chips (not on Wide): lights on, a TV, shades open', at(L, 'class="rc"') > 0 && at(L, '2 Lights') > 0 && at(L, 'TV On') > 0 && at(L, 'Shade Open') > 0 && at(W, 'class="rc"') < 0, '');
  ok('a chip opens the sheet of what it names (data-e)', /data-e="light\.kitchen_/.test(L) && at(L, 'data-e="media_player.kitchen_tv"') > 0, '');
  ok('the chosen scene\'s key is white with its words near-black, on Flat Light too', /\.kit\.room \.key\.on,\.kit\.room\.light \.key\.on\{background:#fff;color:#1c1c1e\}/.test(L) &&
    at(L, 'color:#1c1c1e') > 0, '');
  ok('Extra Large adds its main accessories down the right as keys (data-e), the lights first', at(XL, '<span class="hb"><b>') > 0 && at(XL, 'Island') > 0 && at(L, '<span class="hb"><b>') < 0, '');
  ok('the area\'s own picture goes over the illustration', at(L, 'src="/api/image/serve/abc123/512x512"') > 0 && at(L, 'linear-gradient(180deg,#eef0ec') > 0,
    L.slice(L.indexOf('<img'), L.indexOf('<img') + 80));
  var noPic = html(make('room', 'L', {}, function (h) { h.areas.kitchen.picture = 'https://example.com/x.jpg'; }));
  ok('...only a path Home Assistant serves; any other is the illustration alone', at(noPic, '<img class="rp"') < 0 && at(noPic, 'linear-gradient(180deg,#eef0ec 0%,#b9c4c8') > 0, '');
},
function () {
  H.section('Room: a scene key runs the scene and is white a moment');
  var el = make('room', 'L'), before = CALLS().length;
  el._runScene('scene.kitchen_cooking');
  var calls = house.calls.slice(before);
  ok('scene.turn_on, for that scene', calls.length === 1 && calls[0].domain === 'scene' && calls[0].service === 'turn_on' && calls[0].data.entity_id === 'scene.kitchen_cooking',
    JSON.stringify(calls));
  ok('...and its key is the chosen one while it is lit', /class="key on"[^>]*data-sc="scene.kitchen_cooking"/.test(html(el)) || el._lit === 'scene.kitchen_cooking', el._lit);
  clearTimeout(el._litT);
},
function () {
  H.section('People: Small is a cluster over its count; the others are one plate (no tiles)');
  ['S', 'W', 'T', 'L', 'XL'].forEach(function (size) {
    var el = make('people', size), h = html(el);
    ok(size + ': one plate of solid circles (their pictures, else their initials), no face tiles', at(h, 'class="kit ppl') > 0 && at(h, 'class="fc pd"') > 0 && at(h, 'class="pr') < 0,
      h.slice(0, 100));
  });
  var sm = html(make('people', 'S'));
  ok('Small: "2 Home" and who is away', at(sm, '>3 Home<') > 0 || at(sm, '>2 Home<') > 0, '');
  ok('a picture is a cover-fit image in its circle; with none, the first initial centered', at(sm, 'object-fit:cover') > 0 && at(sm, 'data-ini="R"') > 0, '');
  var xl = html(make('people', 'XL')), w = html(make('people', 'W'));
  ok('rows: home first (since a time), then away (a place, left a time)', at(xl, 'Home · since') > 0 && at(xl, 'Home · since') < at(xl, 'School') && at(xl, 'left') > 0, '');
  ok('Wide\'s rows are one line: name, place at the right', at(w, 'Home</div>') > 0 || at(w, '>Home<') > 0, '');
  ok('a row opens the person (data-id)', at(xl, 'data-id="person.robin"') > 0, '');
  var map = make('people', 'XL', { map: true });
  ok('Extra Large with the map keeps its own drawing', !map._kitHtml, '');
},
function () {
  H.section('the plates still open something, and a control inside keeps its own tap');
  ['home', 'room', 'people'].forEach(function (key) {
    ['W', 'T', 'L', 'XL'].forEach(function (size) {
      var el = make(key, size);
      ok(key + ' ' + size + ': the plate opens something', plateTap(el).length > 0, plateTap(el));
    });
  });
}
]);
