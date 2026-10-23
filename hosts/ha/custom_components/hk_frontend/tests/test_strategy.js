// hk-strategy.js: a whole dashboard from a house's registries.
load(HK_ROOT + '/tests/dom.js');
// the pill's table (hkCards.TILE): a page's grids are built from it
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var S = {};
[st('light.kitchen_table_light', 'on', { friendly_name: 'Kitchen Table Light' }),
 st('light.kitchen_lights', 'on', { friendly_name: 'Kitchen Lights', entity_id: ['light.a', 'light.b'] }),
 st('switch.kitchen_coffee', 'off', { friendly_name: 'Kitchen Coffee' }),
 st('lock.front', 'locked', { friendly_name: 'Front Door' }),
 st('cover.garage', 'closed', { friendly_name: 'Garage Door', device_class: 'garage' }),
 st('cover.den_blinds', 'open', { friendly_name: 'Den Blinds' }),
 st('media_player.den_tv', 'off', { friendly_name: 'Den TV', device_class: 'tv' }),
 st('sensor.den_temp', '70', { friendly_name: 'Den Temperature' }),
 st('light.hidden', 'on', {}), st('switch.cfg', 'on', {}),
 st('light.nowhere', 'on', { friendly_name: 'Nowhere' }),
 st('weather.home', 'sunny', {}), st('sun.sun', 'above_horizon', {}),
 st('alarm_control_panel.house', 'disarmed', { friendly_name: 'House Alarm' })
].forEach(function (s) { S[s.entity_id] = s; });
var hass = {
  states: S, themes: { themes: { 'HK Kiosk': {} } },
  floors: { up: { floor_id: 'up', name: 'Upstairs', level: 2 }, main: { floor_id: 'main', name: 'Main', level: 1 } },
  areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'main' },
           den: { area_id: 'den', name: 'Den', floor_id: 'up' },
           garage: { area_id: 'garage', name: 'Garage', floor_id: 'main' },
           empty: { area_id: 'empty', name: 'Empty Room', floor_id: 'main' } },
  devices: { d1: { area_id: 'den' } },
  entities: {
    'light.kitchen_table_light': { area_id: 'kitchen' }, 'light.kitchen_lights': { area_id: 'kitchen' },
    'switch.kitchen_coffee': { area_id: 'kitchen' }, 'lock.front': { area_id: 'garage' },
    'cover.garage': { area_id: 'garage' }, 'cover.den_blinds': { device_id: 'd1' },
    'media_player.den_tv': { device_id: 'd1' }, 'sensor.den_temp': { area_id: 'den' },
    'light.hidden': { area_id: 'kitchen', hidden: true }, 'switch.cfg': { area_id: 'kitchen', entity_category: 'config' },
    'light.nowhere': {}, 'alarm_control_panel.house': { area_id: 'garage' }
  }
};
var asked = 0, unsubbed = 0, WB = null, ACC = null, CP = null;
// Exclusions are now carried by the live Climate row. They are metadata,
// not displayed entities: ignore them when checking the generated cards.
function cards(v) { return JSON.stringify(v, function (key, value) {
  return /^exclude_(entities|devices|areas)$/.test(key) ? undefined : value;
}); }
function roomNames(home) {
  return home.cards.filter(function (c) { return c.type === 'grid' && c.cards && c.cards[0].type === 'custom:hk-heading-card'; })
    .map(function (c) { return c.cards[0].name; });
}
function tilesOf(home, room) {
  var sec = home.cards.filter(function (c) { return c.type === 'grid' && c.cards[0].name === room; })[0];
  return sec ? sec.cards[1].cards : [];
}
window.hkStrategy.generate({}, hass).then(function (cfg) {
  var home = cfg.views[0];
  ok('opts into the live sky', !!cfg.sky && home.sky === true);
  ok('the build\'s own working state never reaches the dashboard', cards(cfg).indexOf('__build') < 0);
  ok('home view uses the hk grid view and the theme', home.type === 'custom:hk-grid-view' && home.theme === 'HK Kiosk');
  ok('the header comes first', home.cards[0].cards[0].type === 'custom:hk-header-card');
  ok('rooms by floor level, then name; empty rooms left out', JSON.stringify(roomNames(home)) === '["Garage","Kitchen","Den"]', roomNames(home));
  var k = tilesOf(home, 'Kitchen');
  ok('hidden, config and area-less entities are not room tiles', k.length === 3 && cards(cfg).indexOf('light.hidden') < 0 && cards(cfg).indexOf('switch.cfg') < 0 && cards(home.cards.slice(1)).indexOf('light.nowhere') < 0);
  ok('lights before switches, then by name', k[0].entity === 'light.kitchen_lights' && k[2].entity === 'switch.kitchen_coffee');
  ok('the room is not repeated in a tile name', k[1].name === 'Table Light', k[1].name);
  ok('a light group gets the group glyph at its measured size', k[0].icon === 'hk:lightbulb-group' && k[0].icon_size === '42px');
  ok('a switch is a state-labeled toggle pill', k[2].type === 'custom:hk-tile-card' && k[2].label_mode === 'state' && k[2].icon_size === '21px');
  var d = tilesOf(home, 'Den');
  ok('an entity inherits its device\'s area', d.length === 2);
  ok('a TV is a source-first media pill', d.filter(function (t) { return t.entity === 'media_player.den_tv'; })[0].label_mode === 'source_first');
  ok('sensors are not tiles', cards(home).indexOf('sensor.den_temp') < 0);
  var g = tilesOf(home, 'Garage');
  var garage = g.filter(function (t) { return t.entity === 'cover.garage'; })[0];
  ok('a garage door is a tall tile with the garage glyphs', garage.type === 'custom:hk-tall-card' && garage.view_layout['grid-row'] === 'span 2' && garage.icon_states.closed === 'hk:garage');
  ok('the alarm tile opens its keypad sheet (no navigation)', !g.filter(function (t) { return t.entity === 'alarm_control_panel.house'; })[0].tap_action);
  var paths = cfg.views.map(function (v) { return v.path; });
  ok('a page per category, weather and security, and one per room; no music (not configured)',
     JSON.stringify(paths) === '["home","weather","security","climate","lights","room-garage","room-kitchen","room-den"]', paths);
  var byPath = {}; cfg.views.forEach(function (v) { byPath[v.path] = v; });
  // --- room pages
  var kr = byPath['room-kitchen'];
  ok('a room page names its area, so the menu lists it and headings link to it', kr.area === 'kitchen' && kr.subview === true && kr.title === 'Kitchen');
  var krTypes = kr.cards.map(function (c) { return c.type; });
  ok('...under a back button, then its status row', kr.cards[0].cards[0].type === 'custom:hk-back-card' &&
     krTypes[1] === 'custom:hk-room-status-card' && kr.cards[1].area === 'kitchen');
  ok('...the back button and the title 20 px apart', kr.cards[0].layout['grid-column-gap'] === '20px');
  var groupsOf = function (v) { return v.cards.filter(function (c) { return c.type === 'grid'; }).map(function (c) { return c.cards[0].name; }); };
  ok('...its devices grouped the Home app\'s way', JSON.stringify(groupsOf(kr)) === '["Lights","Other"]', JSON.stringify(groupsOf(kr)));
  var gr = byPath['room-garage'];
  ok('a garage door is Security, not Climate', groupsOf(gr).indexOf('Security') >= 0 && groupsOf(gr).indexOf('Climate') < 0, JSON.stringify(groupsOf(gr)));
  var krLights = kr.cards.filter(function (c) { return c.type === 'grid' && c.cards[0].name === 'Lights'; })[0].cards[1].cards;
  var names = krLights.map(function (t) { return t.name; });
  ok('lights A to Z, as the Home app lists them', JSON.stringify(names) === JSON.stringify(names.slice().sort()), JSON.stringify(names));
  // a room's cameras: the camera strip, stills only (2026-10-09; one
  // snapshot tile each in a row before)
  var yardHass = { states: { 'camera.yard_left': { entity_id: 'camera.yard_left', state: 'idle', attributes: {} },
                             'camera.yard_right': { entity_id: 'camera.yard_right', state: 'idle', attributes: {} },
                             'light.yard': { entity_id: 'light.yard', state: 'off', attributes: {} } },
                   entities: { 'camera.yard_left': { area_id: 'yard' }, 'camera.yard_right': { area_id: 'yard' },
                               'light.yard': { area_id: 'yard' } },
                   devices: {}, areas: { yard: { area_id: 'yard', name: 'Yard' } } };
  var yc = window.hkStrategy.roomCards(yardHass, ['yard'], 'Yard', {});
  var camSec = yc.filter(function (c) { return c.type === 'grid' && c.cards[0].name === 'Cameras'; })[0];
  var camGrid = camSec && camSec.cards[1];
  var strip = camGrid && camGrid.cards[0];
  ok('a room\'s cameras are the camera strip, in a row that scrolls sideways when it is wider',
     !!camGrid && camGrid.type === 'custom:hk-row-card' && camGrid.card_width === 'fit-content' &&
     camGrid.cards.length === 1 && strip.type === 'custom:hk-camera-mosaic-card' && strip.cameras.length === 2,
     JSON.stringify(camSec));
  ok('...stills only, no stream, and the room\'s own cameras (not the Home strip list)',
     strip.stills_only === true && strip.own_cameras === true && JSON.stringify(yc).indexOf('"live"') === -1);
  // ONE TILE PER CAMERA: a UniFi camera is up to three camera entities, one
  // per channel, and a wall tablet's own camera is not a room camera.
  function camIds(h, areas, o) {
    var sec = window.hkStrategy.roomCards(h, areas, 'Yard', o || {}).filter(function (c) {
      return c.type === 'grid' && c.cards[0].name === 'Cameras'; })[0];
    return sec ? sec.cards[1].cards[0].cameras.map(function (t) { return t.entity; }) : [];
  }
  var chHass = { states: {}, entities: {}, devices: { d1: { area_id: 'yard' }, d2: { area_id: 'yard' }, tab: { area_id: 'yard' } },
                 areas: { yard: { area_id: 'yard', name: 'Yard' } } };
  ['camera.drive_high_resolution_channel', 'camera.drive_medium_resolution_channel', 'camera.drive_low_resolution_channel']
    .forEach(function (id) { chHass.entities[id] = { device_id: 'd1', platform: 'unifiprotect' }; });
  ['camera.porch_high_resolution_channel', 'camera.porch_low_resolution_channel']
    .forEach(function (id) { chHass.entities[id] = { device_id: 'd2', platform: 'unifiprotect' }; });
  chHass.entities['camera.yard_tablet'] = { device_id: 'tab', platform: 'fully_kiosk' };
  chHass.entities['camera.tv_abc'] = { platform: 'hk_frontend', area_id: 'yard' };   // a Live TV channel
  chHass.entities['camera.tv_xyz'] = { platform: 'livetv_host', area_id: 'yard' };    // ...and one the host names
  Object.keys(chHass.entities).forEach(function (id) { chHass.states[id] = { entity_id: id, state: 'idle', attributes: {} }; });
  var shellWas = window.hkShell, base = shellWas || {};
  window.hkShell = Object.assign(Object.create(base), { notHouseCameraPlatforms: function () { return ['livetv_host']; } });
  ok('one tile per camera, its low-resolution channel, never a tablet\'s camera or a TV channel',
     JSON.stringify(camIds(chHass, ['yard'])) === '["camera.drive_low_resolution_channel","camera.porch_low_resolution_channel"]',
     JSON.stringify(camIds(chHass, ['yard'])));
  ok('...the channel this screen lists wins, and its list sets the order',
     JSON.stringify(camIds(chHass, ['yard'], { board: { cameras: ['camera.porch_high_resolution_channel', 'camera.drive_medium_resolution_channel'] } })) ===
     '["camera.porch_high_resolution_channel","camera.drive_medium_resolution_channel"]',
     JSON.stringify(camIds(chHass, ['yard'], { board: { cameras: ['camera.porch_high_resolution_channel', 'camera.drive_medium_resolution_channel'] } })));
  window.hkShell = shellWas;
  ok('...a camera of a platform the host does not name stays a house camera',
     camIds(chHass, ['yard']).indexOf('camera.tv_xyz') >= 0, true);
  // AN hk: ICON SET IN HOME ASSISTANT beats the guess.
  var icHass = { states: { 'switch.coffee': { entity_id: 'switch.coffee', state: 'off', attributes: {} },
                           'light.tree': { entity_id: 'light.tree', state: 'on', attributes: {} },
                           'lock.door': { entity_id: 'lock.door', state: 'locked', attributes: {} },
                           'lock.back': { entity_id: 'lock.back', state: 'locked', attributes: {} },
                           'switch.plain': { entity_id: 'switch.plain', state: 'off', attributes: {} } },
                 entities: { 'switch.coffee': { icon: 'hk:coffee' }, 'light.tree': { icon: 'mdi:string-lights' },
                             'lock.door': { icon: 'mdi:gate' }, 'lock.back': { icon: 'hk:lock' }, 'switch.plain': {} },
                 devices: {} };
  var tf = window.hkStrategy.tileFor;
  ok('an hk: icon set in HA is the tile\'s glyph', tf(icHass, 'switch.coffee', 'Coffee').icon === 'hk:coffee');
  ok('...but an mdi: icon (chosen for HA\'s own screens) is not', tf(icHass, 'light.tree', 'Glow').icon === 'hk:lightbulb');
  icHass.entities['lock.door'].icon = 'hk:gate';
  ok('...and an hk: icon is the glyph in every state', tf(icHass, 'lock.door', 'Door').icon === 'hk:gate' && !tf(icHass, 'lock.door', 'Door').icon_states);
  ok('...but the tile\'s own glyph keeps its open/closed pair', !!tf(icHass, 'lock.back', 'Back').icon_states);
  ok('no icon set: the usual glyph', tf(icHass, 'switch.plain', 'Plain').icon === 'hk:power-socket-us');
  ok('the room prefix drops whichever apostrophe either name uses',
     window.hkStrategy.shortName("Emma's Room Lamp", 'Emma’s Room') === 'Lamp' &&
     window.hkStrategy.shortName('Emma’s Room Lamp', "Emma's Room") === 'Lamp',
     window.hkStrategy.shortName("Emma's Room Lamp", 'Emma’s Room'));
  var homeHeads = home.cards.filter(function (c) { return c.type === 'grid' && c.cards[0].area; }).map(function (c) { return c.cards[0].area; });
  ok('each room heading on Home names its area', homeHeads.indexOf('kitchen') >= 0 && homeHeads.indexOf('den') >= 0, JSON.stringify(homeHeads));
  ok('Weather sits beside Home in the menu', byPath.weather.menu === 'top' && byPath.weather.icon === 'mdi:weather-partly-cloudy');
  ok('the weather view reads the house weather entity', cards(byPath.weather).indexOf('"entity":"weather.home"') > 0);
  // --- chips: the dashboard's own row (hk-chips-card; test_chipkinds.js)
  var row = home.cards[0].cards[1];
  ok('the chip row under the header is the dashboard\'s own, nothing listed', row.type === 'custom:hk-chips-card' &&
     Object.keys(row).length === 2, JSON.stringify(row));
  ok('...and it picks no menu Categories: a generated screen lists every page', row.in_menu === false);
  // --- pages
  ok('Lights page: rooms with lights only', cards(byPath.lights).indexOf('switch.kitchen_coffee') < 0 &&
     cards(byPath.lights).indexOf('light.kitchen_table_light') > 0 && byPath.lights.sky_variant === 'lights');
  ok('Climate page: blinds, not the garage door', cards(byPath.climate).indexOf('cover.den_blinds') > 0 &&
     cards(byPath.climate).indexOf('cover.garage') < 0);
  ok('no Doors & Windows page from locks and a garage door alone: they are Security\'s',
     !byPath['doors-windows'] && cards(byPath.security).indexOf('lock.front') > 0);
  ok('the header links the views it has', home.cards[0].cards[0].weather_path === './weather' && home.cards[0].cards[0].alarm_path === './security');
  // an alarm automation opens <dashboard>/0#alarm on a wall tablet
  var pop = JSON.stringify(home).match(/\{"type":"custom:hk-popup-card"[^}]*\}/);
  ok('Home answers #alarm with the keypad sheet', !!pop && /"hash":"#alarm"/.test(pop[0]) &&
     /"detail":"alarm_control_panel.house"/.test(pop[0]), pop && pop[0]);
  // ...but not when the house has an Alarm pop-up ITEM: that answers #alarm
  // with its own Close after, and a card would claim the hash first
  var prevHS = window.hkSettings;
  window.hkSettings = { get: function (p, f) {
    return p === 'popups' ? [{ hash: 'alarm', kind: 'alarm', dashboards: [], close_after: 3600 }] : f; },
    weatherId: function () { return null; } };
  return window.hkStrategy.generate({}, hass).then(function (withItem) {
    ok('...no #alarm card of its own when an Alarm pop-up item answers it',
       JSON.stringify(withItem.views[0]).indexOf('"hash":"#alarm"') < 0);
    window.hkSettings = { get: function (p, f) {
      return p === 'popups' ? [{ hash: 'alarm', kind: 'alarm', dashboards: ['dashboard-elsewhere'], close_after: 3600 }] : f; },
      weatherId: function () { return null; } };
    return window.hkStrategy.generate({}, hass);
  }).then(function (elsewhere) {
    ok('...but its own card when the item is kept to other dashboards',
       JSON.stringify(elsewhere.views[0]).indexOf('"hash":"#alarm"') > 0);
    window.hkSettings = prevHS;
    return window.hkStrategy.generate({ exclude_areas: ['garage'], areas: [], sky: false, exclude_entities: ['light.kitchen_lights'] }, hass);
  });
}).then(function (cfg) {
  var home = cfg.views[0];
  ok('options: excluded area and entity, no sky', JSON.stringify(roomNames(home)) === '["Kitchen","Den"]' && !cfg.sky && !home.sky && tilesOf(home, 'Kitchen').length === 2);
  return window.hkStrategy.generate({ areas: ['den', 'kitchen'] }, hass);
}).then(function (cfg) {
  ok('options: an explicit area list sets the order', JSON.stringify(roomNames(cfg.views[0])) === '["Den","Kitchen"]');
  var bare = { states: { 'light.x': st('light.x', 'on', {}) }, entities: { 'light.x': {} } };
  return window.hkStrategy.generate({}, bare);
}).then(function (cfg) {
  ok('a house with no areas, weather or alarm still gets a home view (and its Lights page)',
     cfg.views[0].path === 'home' && cfg.views.length === 2 && cfg.views[1].path === 'lights' && !cfg.views[0].theme,
     cfg.views.map(function (v) { return v.path; }));
  ok('...and no #alarm pop-up without an alarm', JSON.stringify(cfg.views[0]).indexOf('hk-popup-card') < 0);
  hass.connection = { subscribeMessage: function (cb, msg) {
    asked++;
    cb({ configured: true, speakers: [{ entity: 'media_player.k' }] });
    return Promise.resolve(function () { unsubbed++; });
  } };
  return window.hkStrategy.generate({}, hass);
}).then(function (m) {
  var paths = m.views.map(function (v) { return v.path; });
  ok('music set up in the integration: Play and Browse Music views', paths.indexOf('playmusic') > 0 && paths.indexOf('music-browse') > 0, paths);
  ok('...the question is asked once and closed', asked === 1 && unsubbed === 1);
  var pm = m.views.filter(function (v) { return v.path === 'playmusic'; })[0];
  ok('Music: the album-art sky, one page (hk-music-card) under its title', pm.sky_variant === 'playmusic' && pm.title === 'Music' &&
     pm.cards.length === 2 && pm.cards[1].cards[0].type === 'custom:hk-music-card' && !pm.cards[1].cards[0].focus_search);
  var mb = m.views.filter(function (v) { return v.path === 'music-browse'; })[0];
  ok('...Browse Music\'s address opens the same page in its search box, out of the menu', mb.cards[1].cards[0].type === 'custom:hk-music-card' &&
     mb.cards[1].cards[0].focus_search === true && mb.menu === false && mb.sky_variant === 'playmusic');
  ok('...reached from the Speakers chip and the menu, not a heading on Home', JSON.stringify(m.views[0]).indexOf('./playmusic') < 0);
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (m) {
  ok('music: false leaves them out without asking', m.views.map(function (v) { return v.path; }).indexOf('playmusic') < 0 && asked === 1);
  return window.hkStrategy.generate({ chips: false, pages: false, music: false }, hass);
}).then(function (m) {
  ok('chips: false, pages: false (the rooms still get their pages)', m.views.length === 6 && m.views[0].cards[0].cards.length === 2,
     m.views.map(function (v) { return v.path; }).join());
  return window.hkStrategy.generate({ chips: false, pages: false, music: false, rooms: false }, hass);
}).then(function (m) {
  ok('rooms: false leaves the room pages out, and Home\'s headings then link nowhere',
     m.views.length === 3 && m.views.every(function (v) { return !v.area; }));
  // Home status in Configure wins over discovery: a "Garage Door" CONTACT
  // that is really the door into the garage is listed as a door.
  S['binary_sensor.garage_entry'] = st('binary_sensor.garage_entry', 'off', { device_class: 'door', friendly_name: 'Garage Door' });
  hass.entities['binary_sensor.garage_entry'] = { area_id: 'garage' };
  window.hkSettings = { get: function (p, f) {
    var v = { 'security': { garage: ['cover.garage'], doors: ['binary_sensor.garage_entry'], locks: ['lock.front'], windows: [] },
              // Security's own order (Accessories -> Page Order)
              'accessories': { entities: {}, rooms: {}, pages: { security: ['cover.garage', 'lock.front'] } } }[p];
    return v === undefined ? f : v; }, weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (m) {
  var secv = m.views.filter(function (v) { return v.path === 'security'; })[0];
  var rail = JSON.stringify(secv);
  ok('Security in its own order: the garage door, then the lock', rail.indexOf('"entity":"cover.garage"') > 0 &&
     rail.indexOf('"entity":"cover.garage"') < rail.indexOf('"entity":"lock.front"'), rail.slice(0, 200));
  // ONE PAGE WITH SECURITY (2026-10-16): beside an alarm's page, no Doors &
  // Windows page -- the chips and a door's Go To open Security instead
  ok('with a Security page, no Doors & Windows page', !m.views.some(function (v) { return v.path === 'doors-windows'; }),
     m.views.map(function (v) { return v.path; }).join());
  window.__secv = secv;
  // a screen without the Security page (its Pages) keeps Doors & Windows
  var get0 = window.hkSettings.get;
  window.__get0 = get0;
  window.hkSettings.get = function (p, f) {
    return p === 'boards' ? new Proxy({}, { get: function () { return { pages: ['doors_windows', 'climate', 'rooms'] }; } }) : get0(p, f);
  };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (m) {
  window.hkSettings.get = window.__get0;
  var secv = window.__secv;
  var dw = m.views.filter(function (v) { return v.path === 'doors-windows'; })[0];
  ok('...a screen without Security keeps it', !!dw && !m.views.some(function (v) { return v.path === 'security'; }));
  ok('Doors & Windows and Security each have a status row under the title, as Climate does',
     dw.cards[1].type === 'custom:hk-page-status-card' && dw.cards[1].page === 'doors_windows' &&
     secv.cards[1].type === 'custom:hk-page-status-card' && secv.cards[1].page === 'security', dw.cards[1]);
  var secs = {}; dw.cards.slice(2).forEach(function (c) { secs[c.cards[0].name] = c.cards[1].cards.map(function (t) { return t.entity; }); });
  var doorTile = dw.cards.slice(2).filter(function (c) { return c.cards[0].name === 'Doors'; })[0].cards[1].cards[0];
  ok('a page that mixes rooms puts the room ABOVE the name, as the favorites do',
     doorTile.type === 'custom:hk-favorite-card' && doorTile.room === 'Garage' && doorTile.name === 'Door', doorTile);
  ok('the settings decide: the entry contact is a Door; the locks and the garage door are not here',
     JSON.stringify(secs.Doors) === '["binary_sensor.garage_entry"]' && !secs.Garage && !secs.Locks, secs);
  ok('...and it opens and shuts: its two glyphs', doorTile.icon === 'hk:door-open' &&
     JSON.stringify(doorTile.icon_states) === '{"off":"hk:door-closed"}', doorTile);
  // THERMOSTATS: a car's cabin climate is a climate entity too.
  S['climate.car'] = st('climate.car', 'off', { friendly_name: 'Family Car Climate', current_temperature: 91 });
  S['climate.den'] = st('climate.den', 'heat', { friendly_name: 'Den Thermostat', current_temperature: 70 });
  hass.entities['climate.car'] = { area_id: 'garage', name: 'Climate' };
  hass.entities['climate.den'] = { area_id: 'den' };
  var base = window.hkSettings.get;
  window.hkSettings.get = function (p, f) {
    if (p === 'features.thermostats') return ['climate.den'];
    if (p === 'features.temperature') return 'sensor.house_temp';
    return base(p, f);
  };
  return window.hkStrategy.generate({ music: false }, hass).then(function (m2) {
    var clim = m2.views.filter(function (v) { return v.path === 'climate'; })[0];
    ok('the Climate page shows the thermostats, not the car', cards(clim).indexOf('climate.den') > 0 &&
       cards(clim).indexOf('climate.car') < 0);
    var dialGrid;
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.cards && n.cards.some(function (c) { return c.type === 'custom:hk-thermostat-card'; })) dialGrid = n;
      Object.keys(n).forEach(function (k) { walk(n[k]); });
    })(clim);
    ok('the thermostats at their own size, left aligned, the pills\' gap apart',
       dialGrid && dialGrid.layout['place-content'] === 'start start' &&
       dialGrid.layout['grid-template-columns'] === 'repeat(auto-fill, minmax(min(100%, var(--hk-dial-min, 340px)), auto))' &&
       dialGrid.cards[0].dial_width === 'var(--hk-dial, 364px)' &&
       dialGrid.layout['grid-column-gap'] === window.hkCards.TILE.gridGap + 'px', dialGrid && dialGrid.layout);
    // THE HEADER (hk-headers.js): the day's heating and cooling beside the
    // weather, on Energy's three columns, before the thermostats
    var hdr = JSON.stringify(clim.cards);
    ok('Climate: the header -- the runtime card on the page\'s thermostats, Energy\'s columns',
       hdr.indexOf('"type":"custom:hk-climate-runtime-card"') > 0 && hdr.indexOf('var(--hk-energy-cols') > 0 &&
       hdr.indexOf('"thermostats":["climate.den"') > 0 && hdr.indexOf('"height":"240px"') > 0,
       hdr.slice(0, 300));
    ok('...before the thermostats', hdr.indexOf('hk-climate-runtime-card') < hdr.indexOf('"name":"Thermostats"'));
    var garage = tilesOf(m2.views[0], 'Garage').filter(function (t) { return t.entity === 'climate.car'; })[0];
    ok('a tile is named by its FULL name, not the registry short name', garage && garage.name === 'Family Car Climate', garage && garage.name);
    // TWO THERMOSTATS: the rooms keep the pills their widest room needs (two
    // to four), and the dials take the rest, side by side where they fit
    window.hkSettings.get = function (p, f) {
      return p === 'features.thermostats' ? ['climate.den', 'climate.car'] : base(p, f);
    };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (m2b) {
    var clim2 = m2b.views.filter(function (v) { return v.path === 'climate'; })[0];
    // the rooms on the left, the thermostats beside them (the user, 2026-10-16)
    ok('Climate: the rooms with the thermostats beside them', JSON.stringify(clim2).indexOf('var(--hk-page-split, minmax(0, ') > 0 &&
       JSON.stringify(clim2).indexOf('"thermostats":["climate.den","climate.car"]') > 0);
    // STATUS & CHIPS answers first: the integration's kinds decide the pages.
    window.hkSettings.get = function (p, f) {
      if (p === 'kinds') return { thermostats: ['climate.car'], lights: ['light.kitchen_table_light'] };
      return base(p, f);
    };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (m3) {
    var clim = m3.views.filter(function (v) { return v.path === 'climate'; })[0];
    ok('Status & Chips decides the thermostats', cards(clim).indexOf('climate.car') > 0 && cards(clim).indexOf('climate.den') < 0);
    var li = m3.views.filter(function (v) { return v.path === 'lights'; })[0];
    ok('light groups remain category controls even when status counts only their bulbs',
       cards(li).indexOf('light.kitchen_table_light') > 0 && cards(li).indexOf('light.kitchen_lights') > 0);
    ok('group tiles do not change status inventory', window.hkStrategy.pageMembers(hass, 'lights', {}).lights.join() === 'light.kitchen_table_light');
    var counted = window.hkSettings.get;
    window.hkSettings.get = function (p, f) {
      return p === 'counts' ? { lights: { exclude: ['light.kitchen_lights'] } } : counted(p, f);
    };
    return window.hkStrategy.generate({ music: false }, hass).then(function (m4) {
      var li4 = m4.views.filter(function (v) { return v.path === 'lights'; })[0];
      ok('explicitly hiding a group from Lights still removes its category tile', cards(li4).indexOf('light.kitchen_lights') < 0);
      delete window.hkSettings;
    });
  });
}).then(function () {
  // --- Accessories -> Hidden from Screens / Also Shown
  S['switch.car_seat'] = st('switch.car_seat', 'off', { friendly_name: 'Car Seat Heater' });
  hass.entities['switch.car_seat'] = { device_id: 'car' };
  hass.devices.car = { area_id: 'garage' };
  S['scene.movie'] = st('scene.movie', 'scening', { friendly_name: 'Den Movie Night' });
  hass.entities['scene.movie'] = { area_id: 'den' };
  S['sensor.outside'] = st('sensor.outside', '61', { friendly_name: 'Outside Temperature' });
  hass.entities['sensor.outside'] = {};
  var G = { exclude_devices: ['car'], exclude_entities: ['light.kitchen_lights'], exclude_areas: [],
            include_entities: ['scene.movie', 'sensor.outside'], chips: true, pages: false, sky: true, music: false };
  window.hkSettings = { get: function (p, f) { return p === 'generated' ? G : f; },
                        weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({}, hass).then(function (g) {
    var home = g.views[0], all = cards(g);
    ok('an excluded DEVICE is gone everywhere', all.indexOf('switch.car_seat') < 0);
    ok('an excluded entity is gone from its room and its pages', all.indexOf('light.kitchen_lights') < 0);
    var den = tilesOf(home, 'Den');
    var movie = den.filter(function (t) { return t.entity === 'scene.movie'; })[0];
    ok('an added scene appears in its own room, as a tap-to-run tile', movie && movie.type === 'custom:hk-scene-card' &&
       movie.tap_action.service === 'scene.turn_on' && movie.name === 'Movie Night', movie);
    var more = tilesOf(home, 'More');
    ok('an added entity with no room goes to More, showing its state', more.length === 1 &&
       more[0].entity === 'sensor.outside' && more[0].label_mode === 'state');
    // (the house-wide Parts are retired: a stored "pages: false" turns nothing
    // off; the dashboard's own YAML and its Pages still do)
    ok('the retired house-wide "pages: false" turns nothing off',
       g.views.map(function (v) { return v.path; }).indexOf('lights') > 0);
    return window.hkStrategy.generate({ pages: false, exclude_entities: ['switch.kitchen_coffee'] }, hass);
  }).then(function (g2) {
    var all2 = cards(g2);
    ok('the YAML\'s own "pages: false" still turns the category pages off', g2.views.map(function (v) { return v.path; }).indexOf('lights') < 0);
    ok('...and ADDS to a list (both exclusions apply)', all2.indexOf('switch.kitchen_coffee') < 0 &&
       all2.indexOf('light.kitchen_lights') < 0);
    // TWO BUILDS AT ONCE (the editor's preview and the dashboard): each keeps
    // its own exclusions across the await in between (never one module-level
    // list).
    return Promise.all([
      window.hkStrategy.generate({ music: true, exclude_entities: ['switch.kitchen_coffee'] }, hass),
      window.hkStrategy.generate({ music: true }, hass)]);
  }).then(function (both) {
    ok('two builds at once keep their own exclusions',
       cards(both[0]).indexOf('switch.kitchen_coffee') < 0 && cards(both[1]).indexOf('switch.kitchen_coffee') > 0);
    // A direct call uses exactly the options it is given, not the last build's.
    var direct = window.hkStrategy.rooms(hass, {});
    var ids = [].concat.apply([], direct.map(function (r) { return r.entities; }));
    ok('rooms() on its own hides nothing it was not told to', ids.indexOf('switch.kitchen_coffee') >= 0 &&
       ids.indexOf('light.kitchen_lights') >= 0, ids);
    delete window.hkSettings;
  });
}).then(function () {
  // --- EACH DASHBOARD'S OWN: its pages, camera strip, scenes, favorites
  S['camera.porch'] = st('camera.porch', 'idle', { friendly_name: 'Porch Camera' });
  hass.entities['camera.porch'] = { area_id: 'kitchen' };
  S['binary_sensor.sink_leak'] = st('binary_sensor.sink_leak', 'off', { device_class: 'moisture', friendly_name: 'Kitchen Sink Leak' });
  hass.entities['binary_sensor.sink_leak'] = { area_id: 'kitchen' };
  var BOARD = { pages: ['security', 'lights', 'cameras', 'water', 'rooms'], favorites: ['lock.front'] };
  window.hkSettings = { get: function (p, f) { return p === 'boards' ? { '': BOARD } : f; },
                        weatherId: function () { return 'weather.home'; }, onChange: function () {} };
  return window.hkStrategy.generate({ music: false }, hass).then(function (g) {
    var paths = g.views.map(function (v) { return v.path; });
    ok('the item decides the pages, in its order', JSON.stringify(paths.filter(function (p) { return p.indexOf('room-') < 0; })) ===
       '["home","security","lights","cameras","water"]', paths);
    ok('...room pages when it lists them', paths.indexOf('room-kitchen') > 0);
    var home = g.views[0];
    ok('no Weather page: the header does not link one', home.cards[0].cards[0].weather_path === undefined &&
       home.cards[0].cards[0].alarm_path === './security');
    var strip = home.cards[1];
    var mosaic = strip.cards[0].cards[1].cards[0].cards[0];
    ok('the camera strip under the chips, its heading opening Cameras', strip.cards[0].cards[0].navigation_path === './cameras' &&
       mosaic.type === 'custom:hk-camera-mosaic-card' && mosaic.cameras[0].entity === 'camera.porch', JSON.stringify(strip).slice(0, 200));
    ok('the camera strip\'s numbers', mosaic.height === 195 && strip.cards[0].cards[1].layout.margin === '-14px -22px -49px -22px');
    ok('then the scenes row (the dashboard\'s, live)', home.cards[2].type === 'custom:hk-scenes-card');
    var fav = home.cards[3].cards[1].cards[0];
    ok('then Favorites, the Home app\'s favorite tile: the room above, a lock says Locked', home.cards[3].cards[0].name === 'Favorites' &&
       fav.entity === 'lock.front' && fav.type === 'custom:hk-favorite-card' && fav.label_mode === 'sentence' && !fav.view_layout, JSON.stringify(fav));
    var water = g.views.filter(function (v) { return v.path === 'water'; })[0];
    ok('Water: the leak sensors, room by room', cards(water).indexOf('binary_sensor.sink_leak') > 0 && cards(water).indexOf('"label_mode":"leak"') > 0);
    var cams = g.views.filter(function (v) { return v.path === 'cameras'; })[0];
    ok('Cameras: every camera live (taking turns), beside Home in the menu', cams.menu === 'top' && cards(cams).indexOf('"type":"custom:hk-camera-live-card"') > 0);
    ok('the category pages carry their icons for the menu', g.views.filter(function (v) { return v.path === 'lights'; })[0].icon === 'mdi:lightbulb');
    ok('no kiosk unless the item asks', !g.kiosk_mode);
    // HomePods and Apple TVs by their device's model
    var T = window.hkStrategy.tile.media_player;
    ok('a HomePod mini is drawn as one', T('media_player.k', 'Kitchen', { attributes: {} }, 'HomePod Mini').icon === 'hk:homepod-mini');
    ok('a HomePod as a HomePod', T('media_player.l', 'Living', { attributes: {} }, 'HomePod 2').icon === 'hk:homepod');
    ok('an Apple TV as the box', T('media_player.a', 'TV', { attributes: {} }, 'Apple TV 4K (gen 3)').icon === 'hk:apple-tv');
    ok('any other speaker is a speaker', T('media_player.s', 'S', { attributes: {} }, 'pi').icon === 'hk:speaker');
    // Security: the keypad with the locks on a rail, under the doors sky
    var sec = g.views.filter(function (v) { return v.path === 'security'; })[0];
    var panel = sec.cards[2].cards[0];
    ok('Security: the keypad boxed beside the header (Your Home), at the keypad\'s 360',
       panel.layout['grid-template-columns'] === 'var(--hk-sec-cols, 368px minmax(0, 1fr))' &&
       panel.cards[0].type === 'custom:hk-alarm-keypad-card' && panel.cards[0].boxed === true &&
       panel.cards[1].type === 'custom:hk-security-overview-card' && sec.sky_variant === 'security',
       JSON.stringify(panel).slice(0, 300));
    ok('...then the locks, full width', cards(sec.cards[3]).indexOf('"name":"Locks"') > 0 && cards(sec.cards[3]).indexOf('lock.front') > 0);
    // Timers and Vacuums, with the quick timers and Clean Areas present
    S['timer.quick_1'] = st('timer.quick_1', 'idle', {}); S['timer.nap'] = st('timer.nap', 'idle', { friendly_name: 'Nap - Timer' });
    S['script.quick_timer_start'] = st('script.quick_timer_start', 'off', {});
    S['input_text.quick_timer_1_name'] = st('input_text.quick_timer_1_name', '', {});
    S['vacuum.robo'] = st('vacuum.robo', 'docked', { friendly_name: 'Robo' });
    S['sensor.robo_current_room'] = st('sensor.robo_current_room', 'Den', {});
    S['sensor.robo_operational_error'] = st('sensor.robo_operational_error', 'none', {});
    hass.entities['vacuum.robo'] = { device_id: 'robo', area_id: 'den' };
    hass.entities['sensor.robo_current_room'] = { device_id: 'robo' };
    hass.entities['sensor.robo_operational_error'] = { device_id: 'robo' };
    BOARD = { pages: ['timers', 'vacuums', 'music'] };
    var getB = window.hkSettings.get;
    // the Clean Areas feature added (the settings feed's `added`)
    window.hkSettings.get = function (p, f) {
      if (p === 'added') return ['clean_areas'];
      return p === 'features.house_timers' ? ['timer.nap', 'timer.gone'] : getB(p, f); };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    var tv = g.views.filter(function (v) { return v.path === 'timers'; })[0];
    // every card of a type, anywhere in a view
    var allOf = function (o, type, out) {
      out = out || [];
      if (o && typeof o === 'object') {
        if (o.type === type) out.push(o);
        Object.keys(o).forEach(function (k) { allOf(o[k], type, out); });
      }
      return out;
    };
    var tc = allOf(tv, 'custom:hk-timers-order-card')[0];
    ok('Timers (2026-10-16): the status row, then Finishing Order in the header', tc && tv.cards[1].type === 'custom:hk-page-status-card' &&
       tv.cards[1].page === 'timers' && tc.timers[0].entity === 'timer.quick_1' && tc.timers[0].label_entity === 'input_text.quick_timer_1_name' &&
       tc.timers.some(function (t) { return t.entity === 'timer.nap'; }), JSON.stringify(tc));
    ok('...its earlier half the timers people start: the quick timers and the house timers', tc && JSON.stringify(tc.past) === '["timer.quick_1","timer.nap"]', tc && tc.past);
    var napRun = tc.timers.filter(function (t) { return t.entity === 'timer.nap'; })[0];
    ok('...a house timer named without its "- Timer", the same in the running list', napRun && napRun.label === 'Nap', napRun);
    var tstart = allOf(tv, 'custom:hk-timers-start-card')[0];
    ok('...Start a Timer beside it: six durations and the six quick names', tstart && tstart.presets.length === 6 && tstart.name_chips.length === 6,
       JSON.stringify(tstart));
    ok('...Running: the running cards, 388 px each', allOf(tv, 'custom:hk-timers-card').length === 1);
    var houseT = allOf(tv, 'custom:hk-tile-card').filter(function (t) { return t.entity === 'timer.nap'; });
    ok('...House Timers: Nap, one tap to start, from Configure -> Features (a timer that is gone left out)', houseT.length === 1 && houseT[0].name === 'Nap' &&
       houseT[0].tap_action.perform_action === 'timer.start' && JSON.stringify(tv).indexOf('timer.gone') < 0, JSON.stringify(houseT));
    var vv = g.views.filter(function (v) { return v.path === 'vacuums'; })[0];
    var vj = cards(vv);
    ok('Vacuums: the vacuum with its own readings', vj.indexOf('"room":"sensor.robo_current_room"') > 0 &&
       vj.indexOf('"error":"sensor.robo_operational_error"') > 0);
    ok('Vacuums: the header reads the vacuum and its error sensor', allOf(vv, 'custom:hk-vacuum-week-card').length === 1 &&
       JSON.stringify(allOf(vv, 'custom:hk-vacuum-last-card')[0].vacuums) === '[{"entity":"vacuum.robo","error":"sensor.robo_operational_error"}]');
    ok('Vacuums: Clean by Area beside them on its plate, its rooms Clean Areas\' own (asked live, none listed)',
       vj.indexOf('{"type":"custom:hk-area-select-card","layout":"panel"}') > 0 && vj.indexOf('"floors"') < 0, vj.slice(vj.indexOf('area-select') - 40, vj.indexOf('area-select') + 80));
    delete hass.services;
    // Rooms on pages: floor by floor (Main, then Upstairs), or in room order
    var litRooms = function (gv) {
      var lv = gv.views.filter(function (v) { return v.path === 'lights'; })[0];
      return lv.cards.slice(2).map(function (c) { return c.cards[0].name; });
    };
    S['light.den_lamp'] = st('light.den_lamp', 'off', { friendly_name: 'Den Lamp' });
    hass.entities['light.den_lamp'] = { area_id: 'den' };
    // PAGES (2026-10-16): Quick Start's durations and names are HK Settings'
    // (headers.timers), and a screen that turns the header off gets Quick
    // Start back on the page
    var getT = window.hkSettings.get;
    window.hkSettings.get = function (p, f) {
      return p === 'headers' ? { timers: { show: true, presets: [3, 45], names: ['Eggs'] } } : getT(p, f);
    };
    var timersOf = function (gv) { return gv.views.filter(function (v) { return v.path === 'timers'; })[0]; };
    return window.hkStrategy.generate({ music: false }, hass).then(function (gt) {
      var st1 = allOf(timersOf(gt), 'custom:hk-timers-start-card')[0];
      ok('Timers: Quick Start\'s durations and names from Pages -> Timers', st1 && JSON.stringify(st1.presets) === '[3,45]' &&
         JSON.stringify(st1.name_chips) === '["Eggs"]', JSON.stringify(st1));
      BOARD = { pages: ['timers', 'vacuums', 'music'], headers: { timers: false } };
      return window.hkStrategy.generate({ music: false }, hass);
    }).then(function (gt2) {
      var tv2 = timersOf(gt2), pc = allOf(tv2, 'custom:hk-timers-page-card')[0];
      ok('...a screen with the header off: no header, Quick Start on the page again (the one-page layout, its presets)',
         allOf(tv2, 'custom:hk-timers-order-card').length === 0 && allOf(tv2, 'custom:hk-timers-start-card').length === 0 &&
         pc && JSON.stringify(pc.presets) === '[3,45]' && pc.house.length === 1 && tv2.cards[1].page === 'timers', JSON.stringify(tv2.cards).slice(0, 300));
      window.hkSettings.get = getT;
      BOARD = { pages: ['lights'] };
      return window.hkStrategy.generate({ music: false }, hass);
    }).then(function (g1) {
      var floorOrder = litRooms(g1);
      ok('Lights: rooms floor by floor by default', floorOrder.indexOf('Kitchen') < floorOrder.indexOf('Den'), JSON.stringify(floorOrder));
      BOARD = { pages: ['lights'], page_rooms: 'order', room_order: ['den', 'kitchen'] };
      return window.hkStrategy.generate({ music: false }, hass);
    }).then(function (g2) {
      var o2 = litRooms(g2);
      ok('Lights: in room order when the item asks', o2.indexOf('Den') < o2.indexOf('Kitchen'), JSON.stringify(o2));
      return g2;
    });
  }).then(function (g) {
    BOARD = { pages: ['lights'], camera_strip: false, sky: false, kiosk: true, chips_row: false };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    var paths = g.views.map(function (v) { return v.path; });
    ok('only the pages it picked; no room pages', JSON.stringify(paths) === '["home","lights"]', paths);
    ok('no camera strip when it is off', JSON.stringify(g.views[0]).indexOf('hk-camera-mosaic-card') < 0);
    ok('no chip row when the item turns it off', JSON.stringify(g.views[0]).indexOf('hk-chips-card') < 0);
    ok('no live sky when the item turns it off', !g.sky && !g.views[0].sky);
    ok('kiosk: HK Frontend hides Home Assistant\'s header and sidebar itself (no plugin block)',
       !g.kiosk_mode && g.hk_kiosk && g.hk_kiosk.header === true && g.hk_kiosk.sidebar === true && g.hk_kiosk.admins === true, [g.kiosk_mode, g.hk_kiosk]);
    BOARD = { pages: ['lights'], kiosk: true, kiosk_header: false, kiosk_admins: false };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('...only what the screen hides, and not for admins when it says so',
       !g.kiosk_mode && g.hk_kiosk && g.hk_kiosk.header === false && g.hk_kiosk.sidebar === true && g.hk_kiosk.admins === false, g.hk_kiosk);
    BOARD = { pages: ['lights'], kiosk: false, kiosk_header: true };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('...and nothing with Hide Header & Sidebar off', !g.kiosk_mode && !g.hk_kiosk, [g.kiosk_mode, g.hk_kiosk]);
    var K = window.hkStrategy.kioskOf;
    ok('kioskOf: a 1.2 screen with Kiosk Mode Options of its own (no kiosk_engine) keeps the plugin',
       K({ kiosk: true, kiosk_options: { hide_header: false } }) === 'kiosk_mode' && K({ kiosk: true, kiosk_options: {} }).header === true &&
       K({ kiosk: true, kiosk_engine: 'hk', kiosk_options: { a: 1 } }).header === true && K(null) === null);
    delete window.hkSettings;
  });
}).then(function () {
  // A GENERATED WALL TABLET: its photo screensaver for its own
  // user, the sky paused behind it and off with the house's switch, and the
  // now-playing bar
  S['input_boolean.wallpanel_screensaver_kitchen'] = st('input_boolean.wallpanel_screensaver_kitchen', 'off', {});
  WB = { screensaver: true, tablet_user: 'kitchen', idle_room: 'kitchen', now_playing: true };
  window.hkSettings = { get: function (p, f) {
    if (p === 'boards') return { '': WB };
    if (p === 'custom_pages') return CP || f;
    if (p === 'look.sky_switch') return 'input_boolean.sky_background';
    if (p === 'look.photos') return 'media-source://media_source/local/photos';
    return f; }, weatherId: function () { return 'weather.home'; } };
  hass.connection = { subscribeMessage: function (cb) { cb({ configured: true, speakers: [{ entity: 'media_player.k' }] });
    return Promise.resolve(function () {}); } };
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  // HK FRONTEND'S OWN SCREENSAVER by default (hk-saver.js reads it)
  var hs = g.hk_screensaver;
  ok('HK\'s screensaver for the tablet\'s own user, and no WallPanel', hs && hs.user === 'kitchen' && !g.wallpanel, g.wallpanel || hs);
  ok('...its switch, the house\'s photos and the five cards',
     hs && hs.entity === 'input_boolean.wallpanel_screensaver_kitchen' && hs.photos === 'media-source://media_source/local/photos' &&
     hs.cards.length === 5 && hs.cards[0].type === 'custom:hk-clock-card' && hs.cards[3].type === 'custom:hk-timer-strip-card' &&
     hs.cards[4].type === 'custom:hk-screensaver-status-card' && !hs.cards[0].music_only, hs);
  ok('...the defaults: 180 s, 30 s a photo, random, filled, no zoom',
     hs && hs.starts_after === 180 && hs.each_photo === 30 && hs.order === 'random' && hs.fill === true && hs.zoom === false, hs);
  ok('the sky pauses behind it and follows the house\'s switch',
     g.sky.sleep === 'input_boolean.wallpanel_screensaver_kitchen' && g.sky.enable === 'input_boolean.sky_background', g.sky);
  WB.screensaver_options = { starts_after: 300, each_photo: 45, order: 'sorted', fill: false, zoom: true, clock: false,
                             weather: true, music: false, timers: true };
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var hs = g.hk_screensaver;
  ok('its options: timing, order, fill, zoom, and only the cards left on',
     hs && hs.starts_after === 300 && hs.each_photo === 45 && hs.order === 'sorted' && hs.fill === false && hs.zoom === true &&
     hs.cards.length === 3 && hs.cards[0].type === 'custom:hk-weather-strip-card' && hs.cards[1].type === 'custom:hk-timer-strip-card' &&
     hs.cards[2].type === 'custom:hk-screensaver-status-card', hs);
  WB.screensaver_options = { show: 'clock', music_first: true };
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  // SHOW: CLOCK WITH MUSIC FIRST (1.8.0): the slide covers the big clock,
  // so the corner clock is kept, marked to show only under the music
  var hs = g.hk_screensaver;
  ok('Show: Clock keeps the corner clock for the music slide only',
     hs && hs.cards.length === 5 && hs.cards[0].type === 'custom:hk-clock-card' && hs.cards[0].music_only === true, hs && hs.cards[0]);
  WB.screensaver_options = { clock_over: 'large' };
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var hs = g.hk_screensaver;
  ok('...as does a Large clock',
     hs && hs.cards[0].type === 'custom:hk-clock-card' && hs.cards[0].music_only === true, hs && hs.cards[0]);
  delete WB.screensaver_options;
  WB.screensaver_engine = 'wallpanel';
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('a screen that chooses WallPanel gets WallPanel, not both', g.wallpanel && !g.hk_screensaver);
  ok('WallPanel for the tablet\'s own user only', g.wallpanel && g.wallpanel.enabled === false &&
     g.wallpanel.profiles['user.kitchen'].enabled === true, g.wallpanel && g.wallpanel.profiles);
  ok('...its screensaver helper and the house\'s photos',
     g.wallpanel.profiles['user.kitchen'].screensaver_entity === 'input_boolean.wallpanel_screensaver_kitchen' &&
     g.wallpanel.image_url === 'media-source://media_source/local/photos' && g.wallpanel.cards.length === 4);
  // WallPanel writes the helper from EVERY browser that opens the dashboard
  // (its element connects enabled or not): only the tablet's user may name it.
  ok('...and only the tablet\'s user names the helper: a desk has none to write',
     !('screensaver_entity' in g.wallpanel), Object.keys(g.wallpanel));
  ok('the sky pauses behind it and follows the house\'s switch',
     g.sky.sleep === 'input_boolean.wallpanel_screensaver_kitchen' && g.sky.enable === 'input_boolean.sky_background', g.sky);
  var home = JSON.stringify(g.views[0]);
  ok('the now-playing bar (#media) on Home', home.indexOf('"hash":"#media"') > 0 && home.indexOf('hk-now-playing-card') > 0);
  WB.screensaver = false; WB.now_playing = false; delete WB.screensaver_engine;
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('...none of it unless asked', !g.wallpanel && !g.hk_screensaver && !g.sky.sleep && JSON.stringify(g.views[0]).indexOf('"#media"') < 0);
  // THE DOCKED BAR'S TWO SWITCHES: the Now Playing Bar (the player) and the
  // Timer Bar (the quick timers), each its own part of the one bar
  hass.states['sensor.running_quick_timers'] = { entity_id: 'sensor.running_quick_timers', state: '0', attributes: { running: [] } };
  WB.timer_bar = true;
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var media = function (gg) {
    var hit = null;
    (function f(o) { if (hit || !o || typeof o !== 'object') return; if (o.hash === '#media') { hit = o; return; } Object.keys(o).forEach(function (k) { f(o[k]); }); })(gg.views[0]);
    return hit;
  };
  var kinds = function (m) { return m ? m.cards.map(function (c) { return c.type; }).join(',') : 'none'; };
  var m = media(g);
  ok('the Timer Bar alone: the docked bar with the timers and no player', m && m.dock === true && kinds(m) === 'custom:hk-timer-strip-card' &&
     JSON.stringify(m.trigger).indexOf('running_quick_timers') > 0 && JSON.stringify(m.trigger).indexOf('music') < 0, kinds(m));
  WB.now_playing = true; WB.timer_bar = false;
  return window.hkStrategy.generate({}, hass).then(function (g2) {
    var m2 = media(g2);
    ok('the Now Playing Bar alone: the player and no timers', kinds(m2) === 'custom:hk-now-playing-card,custom:hk-music-pane-card' &&
       JSON.stringify(m2.trigger).indexOf('running_quick_timers') < 0, kinds(m2));
    // NOW PLAYING'S PLACE (2026-10-15): the same sheet can stand up as the
    // screensaver's music pane (hk-popup.js placeFor), or go along the top
    ok('...with the pane after the player, and the bar\'s place at the top', m2.pane === true &&
       /safe-area-inset-top/.test((m2.top_vars || {})['hk-np-pad'] || ''), JSON.stringify({ pane: m2.pane, top: m2.top_vars }));
    ok('the Timer Bar alone has no pane', m.pane === false, m.pane);
    delete WB.timer_bar;
    return window.hkStrategy.generate({}, hass);
  }).then(function (g3) {
    var m3 = media(g3);
    ok('...a screen saved before the Timer Bar keeps its timers with its Now Playing Bar',
       kinds(m3) === 'custom:hk-timer-strip-card,custom:hk-now-playing-card,custom:hk-music-pane-card', kinds(m3));
    var onPages = function (gg) { return gg.views.filter(function (v) { return JSON.stringify(v).indexOf('"#media"') > 0; }).map(function (v) { return v.path; }); };
    ok('the bar on Home, and the Music page, by default', JSON.stringify(onPages(g3)) === '["home","playmusic","music-browse"]', onPages(g3));
    // THE MUSIC PAGE'S: a phone's only -- while the page says it is one
    // column (`hk-music-mini`), ahead of the bar's own trigger
    var mb = null;
    (function f(o) { if (mb || !o || typeof o !== 'object') return; if (o.hash === '#media') { mb = o; return; } Object.keys(o).forEach(function (k) { f(o[k]); }); })(g3.views.filter(function (v) { return v.path === 'playmusic'; })[0]);
    ok('...the Music page\'s opens on the page\'s flag, then the bar\'s own trigger', mb && mb.trigger[0].condition === 'flag' &&
       mb.trigger[0].flag === 'hk-music-mini' && JSON.stringify(mb.trigger.slice(1)) === JSON.stringify(m3.trigger) && mb.carry === true && m3.carry === true, mb && mb.trigger);
    // (both carried: a phone's Home bar becomes the page's in place)
    ok('...and Home\'s has no flag', JSON.stringify(m3.trigger).indexOf('flag') < 0);
    WB.bar_all_pages = true;
    return window.hkStrategy.generate({}, hass).then(function (g4) {
      var pg = onPages(g4), grid = g4.views.filter(function (v) { return v.type === 'custom:hk-grid-view'; }).map(function (v) { return v.path; });
      ok('On Every Page: every page of HK\'s own kind has it', pg.length > 2 && grid.every(function (p) { return pg.indexOf(p) >= 0; }), [pg, grid]);
      // ...the Music page's once (its flagged one), carried like the rest
      var mp = g4.views.filter(function (v) { return v.path === 'playmusic'; })[0], n = JSON.stringify(mp).split('"#media"').length - 1;
      ok('...the Music page once, its phone-only bar, carried', n === 1 && JSON.stringify(mp).indexOf('hk-music-mini') > 0 && JSON.stringify(mp).indexOf('"carry":true') > 0, n);
      delete WB.bar_all_pages;
      return g4;
    });
    WB.now_playing = false;
    delete hass.states['sensor.running_quick_timers'];
    return g3;
  });
}).then(function () {
  // THE HOUSE'S CUSTOM PAGES: the ones this dashboard lists,
  // from the settings -- nothing fetched
  WB.custom_pages = ['energy', 'nope', 'lights', 'ecoflow'];
  CP = [{ path: 'energy', title: 'Energy', icon: 'mdi:flash', view: { type: 'custom:hk-grid-view', cards: [{ type: 'x' }] } },
        { path: 'ecoflow', title: 'EcoFlow', icon: '', view: {} },
        { path: 'lights', title: 'Not Lights', view: { cards: [] } }];
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var paths = g.views.map(function (v) { return v.path; });
  ok('its custom pages, in its order, before the rooms; not one it already has; not one that is not there',
     paths.indexOf('energy') > 0 && paths.indexOf('ecoflow') === paths.indexOf('energy') + 1 &&
     paths.filter(function (p) { return p === 'lights'; }).length === 1 && paths.indexOf('nope') < 0 &&
     (paths.indexOf('room-kitchen') < 0 || paths.indexOf('ecoflow') < paths.indexOf('room-kitchen')), paths);
  var en = g.views.filter(function (v) { return v.path === 'energy'; })[0];
  ok('...each its own view under its title and icon', en.title === 'Energy' && en.icon === 'mdi:flash' &&
     en.type === 'custom:hk-grid-view' && en.cards[0].type === 'x', en);
  ok('...a page with no cards yet is an empty page', JSON.stringify(g.views.filter(function (v) { return v.path === 'ecoflow'; })[0].cards) === '[]');
  // ORDER -> PAGES: a custom page and Browse Music where placed
  WB.pages = ['music', 'energy', 'browse', 'lights'];
  WB.custom_pages = ['energy', 'ecoflow'];
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var paths = g.views.map(function (v) { return v.path; });
  var at = function (p) { return paths.indexOf(p); };
  ok('the page order places a custom page and Browse Music: Play Music, Energy, Browse Music',
     at('playmusic') > 0 && at('energy') === at('playmusic') + 1 && at('music-browse') === at('energy') + 1, paths);
  ok('...a custom page not placed still comes, before the rooms', at('ecoflow') > at('music-browse') &&
     (at('room-kitchen') < 0 || at('ecoflow') < at('room-kitchen')), paths);
  ok('...and Browse Music follows Music in the menu when placed there', g.views[at('music-browse')].menu_follows === 'playmusic');
  // HOME PAGE OFF: only its custom pages, the first opening
  WB.home_page = false;
  WB.custom_pages = ['ecoflow', 'nope', 'energy'];
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('Home Page off: the screen is only its custom pages, in its order (one not there left out)',
     JSON.stringify(g.views.map(function (v) { return v.path; })) === '["ecoflow","energy"]', g.views.map(function (v) { return v.path; }));
  ok('...the menu names its first item after that page, not Home', g.views[0].menu_title === 'EcoFlow' && !g.views[0].menu_icon, g.views[0]);
  WB.custom_pages = [];
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('...with none listed it is a whole screen as usual', g.views[0].path === 'home' && g.views.length > 3, g.views.map(function (v) { return v.path; }));
  delete WB.home_page;
  // A HOME OF ITS OWN: a custom page as Home, the rest generated (the car)
  WB.home_view = 'energy';
  WB.pages = ['lights', 'climate'];
  WB.custom_pages = ['energy'];
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var paths = g.views.map(function (v) { return v.path; });
  ok('Home = a custom page: the screen opens on it, called Home',
     paths[0] === 'energy' && g.views[0].menu_title === 'Home' && g.views[0].title === 'Home' &&
     g.views[0].cards[0].type === 'x', paths);
  ok('...and its other pages are generated as usual (and it is not there twice)',
     paths.indexOf('lights') > 0 && paths.indexOf('climate') > 0 &&
     paths.filter(function (p) { return p === 'energy'; }).length === 1 && paths.indexOf('home') < 0, paths);
  WB.home_view = 'gone-page';
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('...a Home page that is gone leaves the generated Home', g.views[0].path === 'home', g.views.map(function (v) { return v.path; }));
  delete WB.home_view;
  delete WB.pages;
  window.__fullHome = g.views[0].cards.length;
  // CAR HOME (Car Browser -> Car Layout): no clock, no rooms
  WB.car = true; WB.car_layout = 'car';
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  var home = g.views[0], hdr = home.cards[0].cards[0];
  ok('Car Home: the header without its clock (the car shows the time)', hdr.type === 'custom:hk-header-card' && hdr.clock === false, hdr);
  ok('...and no rooms: fewer sections than the full Home', home.path === 'home' && home.cards.length < window.__fullHome,
     [home.cards.length, window.__fullHome]);
  ok('...the scenes still there', home.cards.some(function (c) { return c.type === 'custom:hk-scenes-card'; }));
  var sec = home.cards.filter(function (c) { return c.cards && c.cards[0] && c.cards[0].name === 'Security'; })[0];
  var hasLock = Object.keys(hass.states).some(function (k) { return k.indexOf('lock.') === 0; });
  ok('...and Security: the locks as the tall tiles a room draws', !hasLock || (sec && sec.cards[1].cards.some(function (t) {
    return t.type === 'custom:hk-tall-card' && t.entity.indexOf('lock.') === 0; })), sec);
  WB.car_layout = 'home';
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('Full Home in a car: the clock and the rooms as on any screen', g.views[0].cards.length === window.__fullHome &&
     g.views[0].cards[0].cards[0].clock === undefined, g.views[0].cards.length);
  WB.car_layout = 'car'; WB.car = false;
  return window.hkStrategy.generate({}, hass);
}).then(function (g) {
  ok('...and Car Home only where Car Browser is on', g.views[0].cards.length === window.__fullHome);
  delete WB.car; delete WB.car_layout;
  CP = null;
  delete window.hkSettings;
  delete S['input_boolean.wallpanel_screensaver_kitchen'];
}).then(function () {
  // ACCESSORY SETTINGS (each detail sheet's gear): the house's
  // name and glyph, what it is shown as, whether Home shows it, the room's order.
  ACC = { entities: {
      'switch.kitchen_coffee': { name: 'Coffee Maker', icon: 'hk:coffee', show_as: 'light' },
      'light.kitchen_table_light': { home: false },
      'light.kitchen_lights': { room: false },
      'lock.front': { names: { '': 'Front', other: 'Elsewhere' }, icon: 'mdi:gate' } },
    rooms: { kitchen: ['switch.kitchen_coffee', 'light.kitchen_lights'] } };
  window.hkSettings = { get: function (p, f) { return p === 'accessories' ? ACC : f; },
                        weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (g) {
  var k = tilesOf(g.views[0], 'Kitchen');
  ok('the room\'s own order first, the rest after', k.map(function (t) { return t.entity; }).join() ===
     'switch.kitchen_coffee,light.kitchen_lights', k.map(function (t) { return t.entity; }));
  ok('Show in Home off: not on Home...', JSON.stringify(g.views[0]).indexOf('light.kitchen_table_light') < 0);
  var kr = g.views.filter(function (v) { return v.path === 'room-kitchen'; })[0];
  ok('...but on its room\'s page', JSON.stringify(kr).indexOf('light.kitchen_table_light') > 0);
  // HIDDEN FROM ITS ROOM PAGE only (Hidden Accessories, room: false): on Home still
  ok('Room Page off: not on its room\'s page...', JSON.stringify(kr).indexOf('light.kitchen_lights') < 0);
  ok('...but on Home', JSON.stringify(g.views[0]).indexOf('light.kitchen_lights') > 0);
  ok('the accessory\'s name, as given', k[0].name === 'Coffee Maker', k[0].name);
  ok('its glyph', k[0].icon === 'hk:coffee');
  ok('...at that glyph\'s measured size', k[0].icon_size === '26px', k[0].icon_size);
  var lock = tilesOf(g.views[0], 'Garage').filter(function (t) { return t.entity === 'lock.front'; })[0];
  ok('a name for this dashboard beats the house\'s', lock.name === 'Front', lock && lock.name);
  ok('an mdi: glyph is drawn from the hk set, in every state', lock.icon === 'hk:gate' && !lock.icon_states);
  ACC.into = { den: 'kitchen' };
  return window.hkStrategy.generate({ music: false }, hass).then(function (g2) {
    ok('a room shown inside another: its things in that room, no section of its own',
       JSON.stringify(roomNames(g2.views[0])).indexOf('Den') < 0 &&
       tilesOf(g2.views[0], 'Kitchen').some(function (t) { return t.entity === 'media_player.den_tv'; }), roomNames(g2.views[0]));
    var kp = g2.views.filter(function (v) { return v.path === 'room-kitchen'; })[0];
    ok('...and its page spans both areas', Array.isArray(kp.area) && kp.area.join() === 'kitchen,den', kp.area);
    delete ACC.into;
    return g;
  });
}).then(function (g) {
  // GLYPH SIZES: every glyph the gear offers that has a measured size
  ACC.entities['switch.kitchen_coffee'] = { icon: 'hk:sword' };
  var sw = window.hkStrategy.tileFor({ states: S, entities: { 'switch.kitchen_coffee': {} } }, 'switch.kitchen_coffee', 'x');
  ok('a measured glyph is drawn at its size (Sword 27 px, not the flat 23)', sw.icon === 'hk:sword' && sw.icon_size === '27px', sw);
  ACC.entities['switch.kitchen_coffee'] = { icon: 'hk:washing-machine' };
  sw = window.hkStrategy.tileFor({ states: S, entities: { 'switch.kitchen_coffee': {} } }, 'switch.kitchen_coffee', 'x');
  ok('...and one with no measured size keeps the card\'s default', sw.icon === 'hk:washing-machine' && !('icon_size' in sw), sw);
  // THE ACCESSORY'S COLOR: one choice, worn by every tile it is drawn as
  ACC.entities['switch.kitchen_coffee'] = { color: 'pink' };
  sw = window.hkStrategy.tileFor({ states: S, entities: { 'switch.kitchen_coffee': {} } }, 'switch.kitchen_coffee', 'x');
  ok('its chosen Color on its tile, on every page', sw.icon_color === 'pink', sw.icon_color);
  ACC.entities['switch.kitchen_coffee'] = {};
  sw = window.hkStrategy.tileFor({ states: S, entities: { 'switch.kitchen_coffee': {} } }, 'switch.kitchen_coffee', 'x');
  ok('...and none chosen keeps its kind\'s', sw.icon_color !== 'pink', sw.icon_color);
  // TILE SIZE (the gear's Size): a light tall, a lock a pill -- the card's
  // size and its cell's two rows, or one
  var H2 = { states: S, entities: { 'switch.kitchen_coffee': {}, 'lock.front': {} } };
  ACC.entities['switch.kitchen_coffee'] = { size: 'tall' };
  var big = window.hkStrategy.tileFor(H2, 'switch.kitchen_coffee', 'x');
  ok('Size Tall: a switch drawn tall, spanning two rows', big.size === 'tall' && big.view_layout && big.view_layout['grid-row'] === 'span 2', big);
  ACC.entities['lock.front'] = { size: 'regular' };
  var small = window.hkStrategy.tileFor(H2, 'lock.front', 'x');
  ok('Size Regular: a lock as a pill, one row', small.size === 'regular' && !small.view_layout, small);
  delete ACC.entities['lock.front'];
  var auto = window.hkStrategy.tileFor(H2, 'lock.front', 'x');
  ok('Automatic: the lock\'s own tall tile', !auto.size && auto.view_layout && auto.view_layout['grid-row'] === 'span 2', auto);
  ACC.entities['switch.kitchen_coffee'] = { name: 'Coffee Maker', icon: 'hk:coffee', show_as: 'light' };
  return g;
}).then(function () {
  // a favorite given its own glyph in the gear is drawn at that glyph's size
  var favHS = { boards: { '': { favorites: ['lock.front'] } },
                accessories: { entities: { 'lock.front': { icon: 'hk:fire' } } } };
  window.hkSettings = { get: function (p, f) { return p in favHS ? favHS[p] : f; },
                        weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({ music: false }, hass).then(function (g) {
    var fav = JSON.parse(JSON.stringify(g.views[0])), found = null;
    (function walk(n) { if (!n || typeof n !== 'object' || found) return;
      if (n.type === 'custom:hk-favorite-card' && n.entity === 'lock.front') { found = n; return; }
      Object.keys(n).forEach(function (k) { walk(n[k]); }); })(fav);
    ok('a favorite\'s own glyph keeps its measured size (not 23 px)',
       found && found.icon === 'hk:fire' && found.icon_size === '26px', found);
    window.hkSettings = { get: function (p, f) { return p === 'accessories' ? ACC : f; },
                          weatherId: function () { return 'weather.home'; } };
    return g;
  });
}).then(function (g) {
  ok('Show as a light: a light\'s glyph unless it has its own', window.hkStrategy.tileFor(
     { states: S, entities: { 'switch.kitchen_coffee': {} } }, 'switch.kitchen_coffee', 'x').icon === 'hk:coffee');
  delete window.hkSettings;
}).then(function () {
  // FAVORITES AND ROOM TILES: a favorite's own name and glyph, lights
  // together, brightness / On-Off; a computer's Wake-on-LAN tile; a room shown
  // inside another keeping its order; Apple TVs and speakers as the room tiles
  // draw them.
  var P = {};
  [st('light.k1', 'on', { friendly_name: 'Kitchen Main Lights', brightness: 128 }),
   st('light.k2', 'on', { friendly_name: 'Kitchen Table Light' }),
   st('switch.s1', 'on', { friendly_name: 'Kitchen Outlet' }),
   st('cover.g', 'closed', { friendly_name: 'Garage Door', device_class: 'garage' }),
   st('button.pc_wake_on_lan', 'unknown', { friendly_name: 'PC - Wake On Lan' }),
   st('button.car_horn', 'unknown', { friendly_name: 'Car Honk Horn' }),
   st('light.flood', 'off', { friendly_name: 'Yard Flood' }),
   st('light.deck1', 'off', { friendly_name: 'Deck One' }), st('light.deck2', 'off', { friendly_name: 'Deck Two' }),
   st('media_player.atv', 'playing', { friendly_name: 'Kitchen Apple TV', app_name: 'YouTube' }),
   st('media_player.spk', 'idle', { friendly_name: 'Kitchen Speaker' }),
   st('light.office_lights', 'on', { friendly_name: 'Office Lights', entity_id: ['light.k1', 'light.k2', 'light.gone'] }),
   st('cover.blinds', 'open', { friendly_name: 'Kitchen Blinds', current_position: 40 }),
   st('weather.home', 'sunny', {})
  ].forEach(function (x) { P[x.entity_id] = x; });
  var ph = { states: P, themes: { themes: {} },
    areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, garage: { area_id: 'garage', name: 'Garage' },
             yard: { area_id: 'yard', name: 'Yard' }, deck: { area_id: 'deck', name: 'Deck' } },
    devices: { atv: { area_id: 'kitchen', model: 'Apple TV 4K' }, spk: { area_id: 'kitchen', model: 'pi' } },
    entities: { 'light.k1': { area_id: 'kitchen' }, 'light.k2': { area_id: 'kitchen' }, 'switch.s1': { area_id: 'kitchen' },
      'light.office_lights': { area_id: 'kitchen' }, 'cover.blinds': { area_id: 'kitchen' },
      'cover.g': { area_id: 'garage' }, 'button.pc_wake_on_lan': { area_id: 'kitchen', platform: 'wake_on_lan' },
      'button.car_horn': { area_id: 'kitchen', platform: 'tesla_fleet' }, 'light.flood': { area_id: 'yard' },
      'light.deck1': { area_id: 'deck' }, 'light.deck2': { area_id: 'deck' },
      'media_player.atv': { device_id: 'atv' }, 'media_player.spk': { device_id: 'spk' } } };
  P['input_boolean.block_game'] = st('input_boolean.block_game', 'on', { friendly_name: 'Block Game' });
  P['input_boolean.block_net'] = st('input_boolean.block_net', 'off', { friendly_name: 'Block Net' });
  var PS = { boards: { '': { favorites: ['light.k1', 'switch.s1', 'cover.g', 'input_boolean.block_game', 'input_boolean.block_net',
                                       'light.office_lights', 'cover.blinds'] } },
    accessories: { entities: {
        'light.k1': { name: 'Lights', fav_name: 'Main + Table Lights', fav_with: ['light.k2', 'light.nope'] },
        'cover.g': { name: 'Door', fav_name: 'Garage Door' },
        'switch.s1': { fav_icon: 'hk:coffee', on_text: 'Brewing' },
        // a helper with no area: its room line, color and state names are its own
        'input_boolean.block_net': { fav_icon: 'hk:server-network', fav_room: 'Block' },
        'input_boolean.block_game': { fav_room: 'Block', color: 'orange',
                                      fav_icon: 'hk:gamepad-variant', on_text: 'Blocked', off_text: 'Allowed' } },
      rooms: { yard: ['light.flood'], deck: ['light.deck2', 'light.deck1'] }, into: { deck: 'yard' } } };
  window.hkSettings = { get: function (p, f) { return p in PS ? PS[p] : f; }, weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({ music: false }, ph).then(function (g) {
    var home = g.views[0], favs = {};
    (function walk(n) { if (!n || typeof n !== 'object') return;
      if (n.type === 'custom:hk-favorite-card') favs[n.entity] = n; Object.keys(n).forEach(function (k) { walk(n[k]); }); })(home);
    var k1 = favs['light.k1'];
    ok('a favorite\'s own name ("Main + Table Lights" where its room tile is "Lights")', k1 && k1.name === 'Main + Table Lights', k1);
    ok('...together with the table light: one group, lit while either is, reading their brightness',
       JSON.stringify(k1.group) === '["light.k1","light.k2"]' && k1.group_lit === 'any' && k1.label_mode === 'group_brightness', k1);
    ok('...a tap toggles both (one that is not there is left out)',
       k1.tap_action.perform_action === 'light.toggle' && JSON.stringify(k1.tap_action.target.entity_id) === '["light.k1","light.k2"]', k1.tap_action);
    ok('...its glyph still toggles it alone', k1.icon_tap_action && k1.icon_tap_action.action === 'toggle');
    ok('a switch favorite reads On / Off, with the glyph picked for it as a favorite, at its size',
       favs['switch.s1'].label_mode === 'on_off' && favs['switch.s1'].icon === 'hk:coffee' && favs['switch.s1'].icon_size === '26px', favs['switch.s1']);
    // what the hand-written favorites read, lost in the move to generated
    // screens (2026-09-28) and back: a light GROUP counts its members "2 On",
    // a blind reads its position
    var og = favs['light.office_lights'];
    ok('a light group favorite reads how many are on, counting its members (one not there left out)',
       og && og.label_mode === 'group_count' && JSON.stringify(og.group) === '["light.k1","light.k2"]', og);
    ok('a blind favorite reads its position', favs['cover.blinds'] && favs['cover.blinds'].label_mode === 'position', favs['cover.blinds']);
    var bg = favs['input_boolean.block_game'];
    ok('the server-network glyph at its size (24), not the card default',
       favs['input_boolean.block_net'] && favs['input_boolean.block_net'].icon_size === '24px', favs['input_boolean.block_net']);
    ok('a favorite\'s own glyph at the favorites\' size where it has one (the gamepad: 24, as the hand-written favorite; 28 on a room tile)',
       bg && bg.icon_size === '24px', bg && bg.icon_size);
    ok('a favorite with its own room line, color and state names; the room line never shortens its name ("Block" over Block Game)',
       bg && bg.room === 'Block' && bg.name === 'Block Game' && bg.icon_color === 'orange' && bg.icon === 'hk:gamepad-variant' &&
       bg.label_map && bg.label_map.on === 'Blocked' && bg.label_map.off === 'Allowed', bg);
    var s1t = tilesOf(home, 'Kitchen').filter(function (t) { return t.entity === 'switch.s1'; })[0];
    ok('...and a switch\'s On name on its room tile too ("Brewing"), Off left as it was',
       s1t && s1t.label_map && s1t.label_map.on === 'Brewing' && !('off' in s1t.label_map), s1t);
    ok('the garage door favorite is named as a favorite, its room tile as the room\'s',
       favs['cover.g'].name === 'Garage Door' && tilesOf(home, 'Garage')[0].name === 'Door', [favs['cover.g'].name, tilesOf(home, 'Garage')[0].name]);
    var kt = tilesOf(home, 'Kitchen');
    var wake = kt.filter(function (t) { return t.entity === 'button.pc_wake_on_lan'; })[0];
    ok('a Wake-on-LAN button is a tile: "PC", Wake, its glyph presses it, its name opens its sheet',
       wake && wake.name === 'PC' && wake.label === 'Wake' && wake.icon === 'hk:desktop-tower' && wake.icon_size === '25px' &&
       wake.icon_tap_action.perform_action === 'button.press' && wake.tap_action.action === 'more-info', wake);
    ok('...and no other button is (a car\'s horn is not a thing in a room)', !kt.some(function (t) { return t.entity === 'button.car_horn'; }));
    ok('a room shown inside another brings its own order along, after the room\'s',
       tilesOf(home, 'Yard').map(function (t) { return t.entity; }).join() === 'light.flood,light.deck2,light.deck1',
       tilesOf(home, 'Yard').map(function (t) { return t.entity; }));
    var atv = kt.filter(function (t) { return t.entity === 'media_player.atv'; })[0];
    var spk = kt.filter(function (t) { return t.entity === 'media_player.spk'; })[0];
    ok('an Apple TV reads like the other room tiles (no source_first)', atv && atv.icon === 'hk:apple-tv' && !atv.label_mode, atv);
    ok('a speaker\'s glyph is 36 px, as the room tiles draw it', spk && spk.icon === 'hk:speaker' && spk.icon_size === '36px', spk);
    delete window.hkSettings;
  });
}).then(function () {
  // a contact's own glyph as its pair; the Vacuums page's own order; the
  // radar map only when the card is installed
  var Q = {};
  [st('binary_sensor.entry', 'on', { device_class: 'door', friendly_name: 'Garage Entry Door' }),
   st('binary_sensor.win', 'off', { device_class: 'window', friendly_name: 'Den Window' }),
   st('vacuum.down', 'docked', { friendly_name: 'Downstairs' }), st('vacuum.office', 'docked', { friendly_name: 'Office' }),
   st('vacuum.up', 'docked', { friendly_name: 'Upstairs' }), st('weather.home', 'sunny', {})
  ].forEach(function (x) { Q[x.entity_id] = x; });
  var qh = { states: Q, themes: { themes: {} }, config: { country: 'US' },
    areas: { garage: { area_id: 'garage', name: 'Garage' }, den: { area_id: 'den', name: 'Den' } }, devices: {},
    entities: { 'binary_sensor.entry': { area_id: 'garage' }, 'binary_sensor.win': { area_id: 'den' },
                'vacuum.down': {}, 'vacuum.office': {}, 'vacuum.up': {} } };
  var QS = { accessories: { entities: { 'binary_sensor.entry': { name: 'Entry', icon: 'hk:garage' },
                                        'binary_sensor.win': { icon: 'hk:lamp' } },
                            rooms: {}, pages: { vacuums: ['vacuum.down', 'vacuum.up'] } },
             extras: { radar: '/hacsfiles/weather-radar-card/weather-radar-card.js?v=1' } };
  window.hkSettings = { get: function (p, f) {
    var parts = p.split('.'), v = QS;
    for (var i = 0; i < parts.length; i++) { if (v == null) return f; v = v[parts[i]]; }
    return v === undefined ? f : v; }, weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({ music: false }, qh).then(function (g) {
    var by = {}; g.views.forEach(function (v) { by[v.path] = v; });
    var tiles = []; (function walk(n) { if (!n || typeof n !== 'object') return;
      if (n.entity && /favorite-card$/.test(n.type || '')) tiles.push(n); Object.keys(n).forEach(function (k) { walk(n[k]); }); })(by['doors-windows']);
    var entry = tiles.filter(function (t) { return t.entity === 'binary_sensor.entry'; })[0];
    var win = tiles.filter(function (t) { return t.entity === 'binary_sensor.win'; })[0];
    ok('a door drawn as a garage in its gear: garage open, garage shut, its own name under its room',
       entry && entry.icon === 'hk:garage-open' && entry.icon_states.off === 'hk:garage' && entry.name === 'Entry' && entry.room === 'Garage', entry);
    ok('...a glyph with no pair is drawn in both states', win && win.icon === 'hk:lamp' && !win.icon_states, win);
    var vac = []; (function walk(n) { if (!n || typeof n !== 'object') return;
      if (n.type === 'custom:hk-vacuum-card') vac.push(n.entity); Object.keys(n).forEach(function (k) { walk(n[k]); }); })(by.vacuums);
    ok('the Vacuums page in its own order, the rest after', vac.join() === 'vacuum.down,vacuum.up,vacuum.office', vac);
    var wx = JSON.stringify(by.weather);
    ok('the Weather page (2026-10-16): the conditions, the hours, the days and the details, in that order',
       wx.indexOf('"section":"hero"') > 0 && wx.indexOf('"section":"hero"') < wx.indexOf('"section":"hourly"') &&
       wx.indexOf('"section":"hourly"') < wx.indexOf('"section":"daily"') && wx.indexOf('hk-weather-details-card') > wx.indexOf('"section":"daily"'), wx.slice(0, 600));
    ok('...no radar while it is off, and never the HACS card, installed or not',
       wx.indexOf('hk-radar-card') < 0 && wx.indexOf('weather-radar-card') < 0);
    window.hkSettings.radarNative = function () { return { enabled: true }; };
    window.hkSettings.weatherPage = function () {
      return { show_current: false, show_hourly: true, show_daily: true, show_alerts: true, details: [] };
    };
    return window.hkStrategy.generate({ music: false }, qh);
  }).then(function (g2) {
    var wx = JSON.stringify(g2.views.filter(function (v) { return v.path === 'weather'; })[0]);
    ok('the radar on: HK’s own beside the days, still not the HACS card',
       wx.indexOf('"type":"custom:hk-radar-card"') > 0 && wx.indexOf('weather-radar-card') < 0 && wx.indexOf('--hk-wx-pair') > 0, wx.slice(0, 900));
    ok('...what the page leaves out is not there (no conditions, no details)',
       wx.indexOf('"section":"hero"') < 0 && wx.indexOf('hk-weather-details-card') < 0);
    ok('...10 px between the cards, exactly (card-margin 0)', wx.indexOf('"card-margin":"0px"') > 0 && wx.indexOf('"grid-row-gap":"10px"') > 0);
    delete window.hkSettings;
  });
}).then(function () {
  // THIRD-PARTY CARDS' OWN OPTIONS (YAML) over the tuned settings
  var O = window.hkStrategy.overlay;
  var base = { a: 1, b: { c: 2, d: 3 }, l: [1, 2], gone: true };
  var o = O(base, { b: { c: 9 }, l: [7], gone: null, n: 'x' });
  ok('options go key by key into nested mappings; a list replaces; null removes',
     JSON.stringify(o) === '{"a":1,"b":{"c":9,"d":3},"l":[7],"n":"x"}' && base.b.c === 2, o);
  ok('...and none (or not a mapping) leaves the tuned settings', JSON.stringify(O(base, null)) === JSON.stringify(base) &&
     JSON.stringify(O(base, [1])) === JSON.stringify(base));
  var R = { states: { 'weather.home': st('weather.home', 'sunny', {}),
                      'input_boolean.wallpanel_screensaver_kitchen': st('input_boolean.wallpanel_screensaver_kitchen', 'off', {}) },
            themes: { themes: {} }, config: { country: 'DE', unit_system: { temperature: '°C' } }, areas: {}, devices: {}, entities: {} };
  var RS = { boards: { '': { kiosk: true, kiosk_engine: 'kiosk_mode', kiosk_options: { admin_settings: { hide_header: false } },
                             screensaver: true, tablet_user: 'kitchen', idle_room: 'kitchen', screensaver_engine: 'wallpanel',
                             wallpanel_options: { idle_time: 300, enabled: null, style: { 'wallpanel-screensaver-info-box': { background: 'red' } } } } },
             weather: { radar: { zoom_level: 8, type: 'custom:not-a-radar' } },
             extras: { radar: '/hacsfiles/weather-radar-card/weather-radar-card.js?v=2' },
             'look.photos': 'media-source://x' };
  window.hkSettings = { get: function (p, f) {
    if (p in RS) return RS[p];
    var parts = p.split('.'), v = RS;
    for (var i = 0; i < parts.length; i++) { if (v == null) return f; v = v[parts[i]]; }
    return v === undefined ? f : v; }, weatherId: function () { return 'weather.home'; } };
  return window.hkStrategy.generate({ music: false }, R).then(function (g) {
    ok('the Kiosk Mode plugin (chosen): the tuned settings, then the dashboard\'s own options, and no hk_kiosk',
       g.kiosk_mode && g.kiosk_mode.hide_header === true && g.kiosk_mode.hide_sidebar === true && !g.hk_kiosk &&
       g.kiosk_mode.admin_settings && g.kiosk_mode.admin_settings.hide_header === false, g.kiosk_mode);
    ok('the screensaver\'s temperature carries Home Assistant\'s unit letter',
       g.wallpanel && g.wallpanel.cards[1].unit === 'C', g.wallpanel && g.wallpanel.cards[1]);
    RS.boards[''].screensaver_engine = 'hk';
    return window.hkStrategy.generate({ music: false }, R).then(function (g2) {
      ok('HK\'s screensaver: the temperature carries Home Assistant\'s unit letter too',
         g2.hk_screensaver && g2.hk_screensaver.cards[1].unit === 'C', g2.hk_screensaver && g2.hk_screensaver.cards[1]);
      var SB = window.hkStrategy.saverBlock, bb = Object.assign({}, RS.boards['']);
      ok('saverBlock (an existing dashboard\'s screensaver): the same block the generated screen gets',
         JSON.stringify(SB(R, bb)) === JSON.stringify(g2.hk_screensaver), SB(R, bb));
      ok('...none for WallPanel, without a Tablet User, or with the screensaver off',
         SB(R, Object.assign({}, bb, { screensaver_engine: 'wallpanel' })) === null &&
         SB(R, Object.assign({}, bb, { tablet_user: '' })) === null && SB(R, Object.assign({}, bb, { screensaver: false })) === null &&
         SB(null, bb) === null);
      RS.boards[''].screensaver_engine = 'wallpanel';
      return g;
    });
  }).then(function (g) {
    ok('WallPanel: its options over the tuned screensaver, the rest kept',
       g.wallpanel && g.wallpanel.idle_time === 300 && g.wallpanel.display_time === 30 && !('enabled' in g.wallpanel) &&
       g.wallpanel.style['wallpanel-screensaver-info-box'].background === 'red' &&
       g.wallpanel.style['wallpanel-screensaver-info-box']['--wp-card-width'] === '600px' &&
       g.wallpanel.profiles['user.kitchen'].enabled === true, g.wallpanel && { idle: g.wallpanel.idle_time, en: g.wallpanel.enabled });
    var wx = JSON.stringify(g.views.filter(function (v) { return v.path === 'weather'; })[0]);
    ok('the Weather Radar Card’s old options draw nothing on the generated page (HK’s radar took over)',
       wx.indexOf('weather-radar-card') < 0 && wx.indexOf('zoom_level') < 0 && wx.indexOf('not-a-radar') < 0, wx.slice(0, 300));
    delete window.hkSettings;
  });
}).then(function () {
  // WHEN HOME ASSISTANT BUILDS AGAIN: only a change the build reads.
  var S = window.hkStrategy;
  var reg = function (extra) {
    return { entities: Object.assign({ 'light.a': { entity_id: 'light.a', area_id: 'kitchen', device_id: 'd1', platform: 'hue', translation_key: 'x' } }, extra || {}),
             devices: { d1: { id: 'd1', area_id: 'kitchen', sw_version: '1.0' } },
             areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'f0', picture: null } },
             floors: { f0: { floor_id: 'f0', name: 'Ground', level: 0 } } };
  };
  var h0 = reg();
  var h1 = reg(); h1.entities['light.a'].translation_key = 'y'; h1.devices.d1.sw_version = '1.1';
  ok('a registry change the build does not read (a firmware version): no rebuild', S.shouldRegenerate({}, h0, h1) === false);
  var h2 = reg(); h2.entities['light.a'].area_id = 'hall';
  ok('an entity moved to another room: rebuild', S.shouldRegenerate({}, h0, h2) === true);
  var h3 = reg({ 'light.b': { entity_id: 'light.b', area_id: 'kitchen' } });
  ok('a new entity: rebuild', S.shouldRegenerate({}, h0, h3) === true);
  var h4 = reg(); h4.areas.kitchen.name = 'Cook Room';
  ok('a room renamed: rebuild', S.shouldRegenerate({}, h0, h4) === true);
  ok('the same registries: no rebuild', S.shouldRegenerate({}, h0, Object.assign({}, h0)) === false);
  var h5 = reg(); h5.devices.d1.name_by_user = 'Desk Lamp';
  ok('a device renamed (its tiles\' names): rebuild', S.shouldRegenerate({}, h0, h5) === true);
  var h6 = reg(); h6.devices.d1.model = 'Apple TV 4K';
  ok('a device\'s model (the Apple TV / HomePod glyph): rebuild', S.shouldRegenerate({}, h0, h6) === true);

  // ...and of the settings, what the build reads
  var ST = { boards: { 'hk-kitchen-ui': { pages: ['lights'], chips: ['security', 'lights'], cameras: ['camera.a'] },
                       'dashboard-loft': { chips: ['climate'], cameras: ['camera.b'] } },
             accessories: { entities: { 'light.a': { name: 'Lamp', status: true } }, rooms: {} } };
  window.hkSettings = { get: function (p, f) {
    var v = ST, parts = p.split('.');
    for (var i = 0; i < parts.length; i++) { if (v == null) return f; v = v[parts[i]]; }
    return v === undefined ? f : v; } };
  var sig = function () { return S.inputs('hk-kitchen-ui'); };
  var s0 = sig();
  ST.boards['hk-kitchen-ui'].chips = ['lights', 'security'];
  ok('this screen\'s chips reordered (a live card): no rebuild', sig() === s0);
  ST.boards['dashboard-loft'].chips = ['lights'];
  ok('another screen\'s chips: no rebuild', sig() === s0);
  ST.accessories.entities['light.a'].status = false;
  ok('an accessory\'s Status & Chips switch (arrives as kinds): no rebuild', sig() === s0);
  ST.accessories.entities['light.a'].when = 'on'; ST.accessories.entities['light.a'].label = 'Lit';
  ok('an accessory\'s chip-only fields (when, label): no rebuild', sig() === s0);
  ST.boards['hk-kitchen-ui'].chips_custom = ['mail'];
  ok('this screen\'s custom chips (a live card): no rebuild', sig() === s0);
  ST.boards['dashboard-loft'].cameras = ['camera.c'];
  var s1 = sig();
  ok('another screen\'s cameras (they pick this one\'s channel): rebuild', s1 !== s0);
  ST.boards['hk-kitchen-ui'].pages = ['lights', 'climate'];
  ok('this screen\'s pages: rebuild', sig() !== s1);
  var s2 = sig();
  ST.accessories.entities['light.a'].name = 'Desk Lamp';
  ok('an accessory renamed: rebuild', sig() !== s2);
  delete window.hkSettings;
}).then(function () {
  // --- On Phones, Lights & Outlets, Sensor Coverage
  S['switch.porch_outlet'] = st('switch.porch_outlet', 'off', { friendly_name: 'Porch Outlet' });
  hass.entities['switch.porch_outlet'] = { area_id: 'kitchen' };
  S['binary_sensor.sink_leak'] = st('binary_sensor.sink_leak', 'unavailable', { device_class: 'moisture', friendly_name: 'Kitchen Sink Leak' });
  hass.entities['binary_sensor.sink_leak'] = { area_id: 'kitchen' };
  var B2 = { phone_header: 'strip' };
  window.hkSettings = { get: function (p, f) {
    if (p === 'boards') return { '': B2 };
    if (p === 'kinds') return { lights: ['light.kitchen_table_light', 'switch.porch_outlet'], leaks: ['binary_sensor.sink_leak'] };
    return f; }, weatherId: function () { return 'weather.home'; }, onChange: function () {} };
  return window.hkStrategy.generate({ music: false }, hass).then(function (g) {
    var home = g.views[0], top = home.cards[0].cards;
    ok('On Phones = Weather Strip: the header over 640 px, the strip under it (Home\'s own layout)',
       top[0].type === 'conditional' && top[0].conditions[0].media_query === '(min-width: 640px)' &&
       top[0].card.type === 'custom:hk-header-card' && top[1].card.type === 'custom:hk-weather-strip-card' &&
       top[1].conditions[0].media_query === '(max-width: 639.98px)' && top[1].card.tap_action.navigation_path === './weather',
       JSON.stringify(top).slice(0, 300));
    var byP = {}; g.views.forEach(function (v) { byP[v.path] = v; });
    ok('an outlet among the lights: the page is Lights & Outlets, the menu says Lights',
       byP.lights.title === 'Lights & Outlets' && byP.lights.menu_title === 'Lights' && cards(byP.lights).indexOf('Lights & Outlets') > 0,
       [byP.lights.title, byP.lights.menu_title]);
    ok('Lights and Water have their status rows', byP.lights.cards[1].page === 'lights' &&
       byP.water.cards[1].type === 'custom:hk-page-status-card' && byP.water.cards[1].page === 'water');
    var whead = byP.water && byP.water.cards[2];
    ok('Water (2026-10-16): the header -- the day\'s water -- and no Sensor Coverage: a quiet sensor\'s No Report is its tile\'s',
       whead && JSON.stringify(whead).indexOf('custom:hk-water-day-card') > 0 && JSON.stringify(byP.water).indexOf('unreported') < 0,
       JSON.stringify(whead).slice(0, 300));
    var leakT = JSON.stringify(byP.water);
    ok('...leak tiles a calm drop while dry or unreported, red with its alert glyph on a leak',
       leakT.indexOf('"icon":"hk:water","icon_states":{"on":"hk:water-alert"},"icon_color":"red","off_icon_color":"blue","label_mode":"leak"') > 0);
    B2.phone_header = 'header';
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g2) {
    ok('On Phones = header (the default): the header alone', g2.views[0].cards[0].cards[0].type === 'custom:hk-header-card');
    // WATER WITH VALVES: a sprinkler's valve has a section of its own, and a
    // house with valves and no leak sensors still has the page
    S['valve.sprinkler'] = st('valve.sprinkler', 'open', { friendly_name: 'Front Sprinkler', device_class: 'water' });
    hass.entities['valve.sprinkler'] = { area_id: 'kitchen' };
    var kinds0 = window.__kinds0 = window.hkSettings.get;
    window.hkSettings.get = function (p, f) {
      return p === 'kinds' ? { lights: ['light.kitchen_table_light'], leaks: [], valves: ['valve.sprinkler'] } : kinds0(p, f);
    };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g3) {
    var w = g3.views.filter(function (v) { return v.path === 'water'; })[0];
    var valves = w && w.cards.filter(function (c) { return c.cards && c.cards[0] && c.cards[0].name === 'Valves'; })[0];
    ok('Water with valves and no leak sensors: the page, its row, a Valves section -- a sprinkler is not the main supply',
       !!w && w.cards[1].page === 'water' && !!valves && cards(valves).indexOf('valve.sprinkler') > 0 &&
       JSON.stringify(w).indexOf('hk-water-supply-card') < 0, w && JSON.stringify(w.cards).slice(0, 300));
    S['valve.main_shutoff'] = st('valve.main_shutoff', 'open', { friendly_name: 'Main Shutoff', device_class: 'water' });
    hass.entities['valve.main_shutoff'] = { area_id: 'kitchen' };
    window.hkSettings.get = function (p, f) {
      return p === 'kinds' ? { lights: ['light.kitchen_table_light'], leaks: [], valves: ['valve.sprinkler', 'valve.main_shutoff'] } : window.__kinds0(p, f);
    };
    return window.hkStrategy.generate({ music: false }, hass).then(function (g4) {
      var w4 = g4.views.filter(function (v) { return v.path === 'water'; })[0], j4 = JSON.stringify(w4);
      var vs4 = w4.cards.filter(function (c) { return c.cards && c.cards[0] && c.cards[0].name === 'Valves'; })[0];
      ok('...the valve named for the main supply is the header\'s supply card; the sprinkler keeps its Valves tile',
         j4.indexOf('"type":"custom:hk-water-supply-card","entity":"valve.main_shutoff"') > 0 && !!vs4 &&
         cards(vs4).indexOf('valve.sprinkler') > 0 && cards(vs4).indexOf('valve.main_shutoff') < 0, j4.slice(0, 400));
      // A SCREEN WITHOUT THE HEADER (Pages, 2026-10-16): the main valve is a
      // Valves tile again
      var k5 = window.hkSettings.get;
      window.hkSettings.get = function (p, f) {
        if (p === 'boards') { var b0 = (k5(p, f) || {})[''] || {}; return { '': Object.assign({}, b0, { headers: { water: false } }) }; }
        return k5(p, f);
      };
      return window.hkStrategy.generate({ music: false }, hass).then(function (g5) {
        var w5 = g5.views.filter(function (v) { return v.path === 'water'; })[0], j5 = JSON.stringify(w5);
        var vs5 = w5.cards.filter(function (c) { return c.cards && c.cards[0] && c.cards[0].name === 'Valves'; })[0];
        ok('...a screen with the Water header off: no header, the main valve a Valves tile again',
           j5.indexOf('hk-water-supply-card') < 0 && j5.indexOf('hk-water-day-card') < 0 && !!vs5 && cards(vs5).indexOf('valve.main_shutoff') > 0, j5.slice(0, 300));
        // ...and the supply and meter chosen on Pages -> Water win over the guess
        window.hkSettings.get = function (p, f) {
          return p === 'headers' ? { water: { show: true, supply: 'valve.sprinkler', meter: 'sensor.water_meter' } } : k5(p, f);
        };
        return window.hkStrategy.generate({ music: false }, hass);
      }).then(function (g6) {
        var j6 = JSON.stringify(g6.views.filter(function (v) { return v.path === 'water'; })[0]);
        ok('...the supply and meter chosen on Pages -> Water win over the guess',
           j6.indexOf('"type":"custom:hk-water-supply-card","entity":"valve.sprinkler"') > 0 && j6.indexOf('"meter":"sensor.water_meter"') > 0, j6.slice(0, 400));
        window.hkSettings.get = k5;
        delete S['valve.main_shutoff']; delete hass.entities['valve.main_shutoff'];
      });
    });
  }).then(function () {
    delete S['valve.sprinkler']; delete hass.entities['valve.sprinkler'];
    delete window.hkSettings;
  });
}).then(function () {
  // LATE ARRIVAL: Home Assistant's 5 s wait ran out before this file loaded
  // (a restart, a slow phone). The error it draws names the element; a
  // generated dashboard showing it is built again once the file is here.
  print('\n=== the strategy arriving after Home Assistant gave up ===');
  var S = window.hkStrategy, hk = { strategy: { type: 'custom:hk-dashboard' } };
  var err = { views: [{ title: 'Error', cards: [{ type: 'markdown', content:
    'Error loading the dashboard strategy:\n> Error: Timeout waiting for strategy element ll-strategy-dashboard-hk-dashboard to be registered' }] }] };
  ok('a generated dashboard showing the timeout is rebuilt', S.lateError({ lovelace: { rawConfig: hk, config: err } }) === true);
  ok('...not a generated dashboard that built', S.lateError({ lovelace: { rawConfig: hk, config: { views: [{ title: 'Home', path: 'home' }] } } }) === false);
  ok('...not another strategy\'s dashboard, nor a hand-written one',
     S.lateError({ lovelace: { rawConfig: { strategy: { type: 'original-states' } }, config: err } }) === false &&
     S.lateError({ lovelace: { rawConfig: { views: [] }, config: err } }) === false);
  ok('...and nothing when no dashboard is open', S.lateError(null) === false && S.lateError({}) === false);
  ok('it runs when the element is defined', /customElements\.define\('ll-strategy-dashboard-hk-dashboard', HkDashboardStrategy\);\s*recoverLate\(\);/.test(
     readFile(HK_ROOT + '/frontend/cards/hk-strategy.js')));
  // HOME ASSISTANT SWAPS THE REGISTRY (its scoped-custom-elements polyfill,
  // with a list of its own): the strategies are defined again in the new one.
  print('\n=== the registry swapped under the strategy ===');
  var native = customElements, before = native.get('ll-strategy-dashboard-hk-dashboard');
  var own = {}, swapped = { get: function (n) { return own[n]; }, define: function (n, c) {
    if (own[n]) throw new Error('already defined'); own[n] = c; } };
  customElements = swapped;
  var made = S.defineHere();
  var D = own['ll-strategy-dashboard-hk-dashboard'], R = own['ll-strategy-view-hk-room'];
  ok('both strategies are defined in the new registry', made === true && !!D && !!R);
  ok('...as subclasses (a constructor registers once), generating as before',
     D !== before && D.generate === before.generate && typeof R.generate === 'function');
  ok('...once: nothing to do the next time', S.defineHere() === false);
  customElements = native;
  ok('the original registry is untouched', customElements.get('ll-strategy-dashboard-hk-dashboard') === before);
}).then(function () {
  // THE CALENDAR PAGE: there when the house has a calendar, after Weather;
  // gone with no calendar, or when a screen's pages leave it out
  print('\n=== the calendar page ===');
  var saved = window.hkSettings, board = {};
  S['calendar.home'] = st('calendar.home', 'off', { friendly_name: 'Home Calendar', supported_features: 7 });
  window.hkSettings = { get: function (p, f) { return p === 'boards' ? { '': board } : f; },
                        weatherId: function () { return 'weather.home'; }, onChange: function () {},
                        calendarIds: function (states) { return Object.keys(states).filter(function (k) { return k.indexOf('calendar.') === 0; }).sort(); } };
  return window.hkStrategy.generate({ music: false }, hass).then(function (g) {
    var paths = g.views.map(function (v) { return v.path; });
    ok('a calendar: a Calendar page, after Weather', paths.indexOf('calendar') === paths.indexOf('weather') + 1, paths);
    var v = g.views.filter(function (x) { return x.path === 'calendar'; })[0];
    ok('...titled, under a back button, the calendar card in its column', v.title === 'Calendar' && v.subview === true &&
       v.cards[0].cards[0].type === 'custom:hk-back-card' && v.cards[1].cards[0].type === 'custom:hk-calendar-card', v);
    board = { pages: ['weather', 'lights'] };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('a screen whose pages leave it out has none', g.views.map(function (v) { return v.path; }).indexOf('calendar') < 0);
    board = { pages: ['calendar', 'weather'] };
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    var paths = g.views.map(function (v) { return v.path; });
    ok('...one that lists it first has it first', paths[1] === 'calendar' && paths[2] === 'weather', paths);
    board = {};
    delete S['calendar.home'];
    return window.hkStrategy.generate({ music: false }, hass);
  }).then(function (g) {
    ok('no calendar: no Calendar page', g.views.map(function (v) { return v.path; }).indexOf('calendar') < 0);
    var sb = window.hkStrategy.saverBlock ? window.hkStrategy.saverBlock(hass, { tablet_user: 'Kitchen', screensaver: true,
      screensaver_options: { calendar: true, calendar_days: 4 } }) : null;
    ok('the screensaver block carries the calendar pane and its days', !!sb && sb.calendar === true && sb.calendar_days === 4, sb);
    ok('...and Fade Back: half a second unless set, 0 kept (at once)', sb.fade_back === 500 &&
       window.hkStrategy.saverBlock(hass, { tablet_user: 'Kitchen', screensaver: true, screensaver_options: { fade_back: 0 } }).fade_back === 0);
    window.hkSettings = saved;
  });
}).then(function () {
  // A ROOM'S SCENES ROW (accessories `scenes`): Automatic is the scenes in
  // the room; a room's own list wins; an empty one is no row
  var saved = window.hkSettings, RS = {};
  window.hkSettings = { get: function (p, f) { return p === 'accessories' ? { entities: {}, rooms: {}, scenes: RS } : f; },
                        weatherId: function () { return 'weather.home'; } };
  S['scene.movie'] = st('scene.movie', 'scening', { friendly_name: 'Den Movie Night' });
  hass.entities['scene.movie'] = { area_id: 'den' };
  S['input_button.nap'] = st('input_button.nap', '2026-10-01', { friendly_name: 'Nap' });
  hass.entities['input_button.nap'] = {};
  var row = function (area) {
    var cs = window.hkStrategy.roomCards(hass, [area], 'Room', {});
    return cs.filter(function (c) { return c.type === 'custom:hk-scenes-card'; })[0] || null;
  };
  var den = row('den');
  ok('Automatic: a room\'s own scenes, as a room row', !!den && den.room === true && den.scenes.join() === 'scene.movie', den);
  var at = window.hkStrategy.roomCards(hass, ['den'], 'Den', {}).map(function (c) { return c.type; });
  ok('...under the status row (and any cameras), above the groups',
     at.indexOf('custom:hk-scenes-card') > at.indexOf('custom:hk-room-status-card'), at);
  ok('a room with no scenes has no row', row('kitchen') === null);
  // WHERE A TILE LIVES, for Arrange in its sheet: a room page's tiles say
  // their room and group
  var grp = window.hkStrategy.roomCards(hass, ['den'], 'Den', {}).filter(function (c) { return c.type === 'grid'; });
  var placedTile = null;
  (function walk(n) { if (!n || typeof n !== 'object' || placedTile) return; if (n.hk_place && n.entity) { placedTile = n; return; }
    Object.keys(n).forEach(function (k) { walk(n[k]); }); })(grp);
  ok('a room page\'s tile knows its room and group', !!placedTile && placedTile.hk_place.area === 'den' && !!placedTile.hk_place.group, placedTile);
  RS.kitchen = ['input_button.nap', 'scene.gone'];
  ok('a room\'s own list: any scene or button, only those that exist', (row('kitchen') || {}).scenes.join() === 'input_button.nap', row('kitchen'));
  RS.den = [];
  ok('an empty list: no row, even with scenes in the room', row('den') === null);
  window.hkSettings = saved;
  // A FAN'S SPIN (the accessory's `anim`): its tile's glyph turns while it is
  // on by default; a chosen icon is not always one that reads as spinning, so
  // the setting is per accessory and lands on the tile -- never on its
  // favorite, whose glyph is still like every favorite's.
  S['fan.den'] = st('fan.den', 'on', { friendly_name: 'Den Fan', percentage: 50, percentage_step: 25 });
  hass.entities['fan.den'] = { area_id: 'den' };
  var ACCS = { entities: {}, rooms: {}, scenes: {} };
  // ITS OWN SETTINGS, delegating to NOTHING: the shared settings object has
  // been re-mocked by earlier blocks (a generated with an excluded device, a
  // kinds with no fans), and inheriting any of it would keep the fan out of
  // the rooms. null everywhere is a fresh house.
  var savedAcc = window.hkSettings;
  window.hkSettings = { get: function (p, f) {
      if (p === 'accessories') return ACCS;
      if (p === 'boards') return { '': { favorites: ['fan.den'] } };
      return f; },
    weatherId: function () { return 'weather.home'; } };
  var denFan = function (cfg) {
    var found = null;
    // the IIFE is CALLED (the suite's thermostat test walks the same way) --
    // an un-called (function(){...}); would fall through to dom.js's global
    // DOM walk and visit nothing at all
    (function walk(n) { if (found || !n || typeof n !== 'object') return;
      if (n.entity === 'fan.den' && n.type === 'custom:hk-fan-card') found = n;
      Object.keys(n).forEach(function (k) { if (!found) walk(n[k]); }); })(cfg);
    return found;
  };
  var denFav = function (cfg) {
    var found = null;
    (function walk(n) { if (found || !n || typeof n !== 'object') return;
      if (n.entity === 'fan.den' && n.type === 'custom:hk-favorite-card') found = n;
      Object.keys(n).forEach(function (k) { if (!found) walk(n[k]); }); })(cfg.views[0]);
    return found;
  };
  return window.hkStrategy.generate({ music: false, popups: false }, hass).then(function (m) {
    ok('a fan without the setting: no animation in its config (its kind decides -- it spins)',
       !!denFan(m) && denFan(m).type === 'custom:hk-fan-card' && !('animation' in denFan(m)), denFan(m));
    ACCS.entities['fan.den'] = { anim: 'none' };
    return window.hkStrategy.generate({ music: false, popups: false }, hass);
  }).then(function (m) {
    var t = denFan(m);
    ok('anim none: the room tile stops spinning', !!t && t.type === 'custom:hk-fan-card' && t.animation === 'none', t);
    ok('...and its favorite on the home row stays still, as every favorite does', !!denFav(m) && !('animation' in denFav(m)), denFav(m));
    ACCS.entities['fan.den'].anim = 'spin';
    return window.hkStrategy.generate({ music: false, popups: false }, hass);
  }).then(function (m) {
    ok('anim spin: said explicitly, the same as its kind', denFan(m).animation === 'spin');
    ok('...and still not on its favorite', !!denFav(m) && !('animation' in denFav(m)), denFav(m));
    // a switch drawn as a fan: still by its own kind's default -- only an
    // explicit spin is new behaviour
    ACCS.entities['fan.den'] = {};
    S['switch.porch_fan_plug'] = st('switch.porch_fan_plug', 'on', { friendly_name: 'Porch Fan' });
    hass.entities['switch.porch_fan_plug'] = { area_id: 'garage' };
    ACCS.entities['switch.porch_fan_plug'] = { show_as: 'fan' };
    return window.hkStrategy.generate({ music: false, popups: false }, hass);
  }).then(function (m) {
    var f = (function () { var r = null;
      (function walk(n) { if (r || !n || typeof n !== 'object') return;
        if (n.entity === 'switch.porch_fan_plug') r = n; Object.keys(n).forEach(function (k) { if (!r) walk(n[k]); }); })(m);
      return r; })();
    ok('a switch drawn as a fan, unset: still (the tile kind does not spin)', !!f && f.type === 'custom:hk-tile-card' && !('animation' in f), f);
    ACCS.entities['switch.porch_fan_plug'].anim = 'spin';
    return window.hkStrategy.generate({ music: false, popups: false }, hass);
  }).then(function (m) {
    var f = (function () { var r = null;
      (function walk(n) { if (r || !n || typeof n !== 'object') return;
        if (n.entity === 'switch.porch_fan_plug') r = n; Object.keys(n).forEach(function (k) { if (!r) walk(n[k]); }); })(m);
      return r; })();
    ok('...with anim spin: it spins, the fan way', f && f.animation === 'spin' && f.icon === 'hk:fan', f);
    window.hkSettings = savedAcc;
    delete S['fan.den']; delete hass.entities['fan.den'];
    delete S['switch.porch_fan_plug']; delete hass.entities['switch.porch_fan_plug'];
  });
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' STRATEGY TESTS' : 'ALL ' + pass + ' STRATEGY TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
