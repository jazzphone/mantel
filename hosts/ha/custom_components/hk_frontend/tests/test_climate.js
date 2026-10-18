// Climate summaries: the same source lists drive ranges and open popups.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
var pass = 0, fail = 0, only;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + ' ' + JSON.stringify(d)); } }
var settings = { status_rows: { climate: { status: ['temperature', 'humidity', 'blinds', 'fans'], exclude_areas: [] } } };
window.hkSettings = { weatherId: function () { return null; }, get: function (path, fallback) {
  var v = settings; path.split('.').forEach(function (k) { v = v && v[k]; });
  return v == null ? fallback : v;
} };
var h = { states: {}, entities: {}, devices: { bedroom: { area_id: 'bedroom' } },
  areas: { den: { name: 'Den', temperature_entity_id: 'sensor.den_t', humidity_entity_id: 'sensor.den_h' },
           bedroom: { name: 'Bedroom' }, outside: { name: 'Outside', temperature_entity_id: 'sensor.outside_t' } },
  config: { unit_system: { temperature: '°F' } } };
function add(id, state, attrs, reg) {
  h.states[id] = { entity_id: id, state: state, attributes: attrs || {} };
  h.entities[id] = reg || { area_id: 'den' };
}
add('sensor.den_t', '71', { device_class: 'temperature', unit_of_measurement: '°F' });
add('sensor.den_h', '36', { device_class: 'humidity', unit_of_measurement: '%' });
add('sensor.cpu_t', '105', { device_class: 'temperature', unit_of_measurement: '°F' });
add('sensor.outside_t', '90', { device_class: 'temperature', unit_of_measurement: '°F' }, { area_id: 'outside' });
add('climate.bedroom', 'cool', { current_temperature: 80, current_humidity: 89, temperature: 62, unit_of_measurement: '°F' }, { device_id: 'bedroom' });
add('fan.den', 'on'); add('fan.bedroom', 'off', {}, { device_id: 'bedroom' });
add('cover.den', 'open', { device_class: 'shade' });
add('cover.garage', 'open', { device_class: 'garage' });
settings.status_rows.climate.exclude_areas = ['outside'];
var sources = window.hkStrategy.climateMembers(h, {});
ok('related sensors and thermostat fallback, not equipment or outdoor readings',
   sources.temperature.join() === 'climate.bedroom,sensor.den_t', sources);
var items = window.hkRoom.climateItems(h, {});
ok('screenshot order and whole-home ranges', items.map(function (x) { return x.kind + ':' + x.value; }).join() ===
   'temperature:71–80°,humidity:36–89%,blinds:Open,fans:1 On', items);
ok('current temperature, never the thermostat setpoint', window.hkRoom.climateReading(h, 'climate.bedroom', 'temperature') === 80);
h.states['sensor.den_t'].state = '21.6666666667'; h.states['sensor.den_t'].attributes.unit_of_measurement = '°C';
ok('mixed units normalize before range calculation', window.hkRoom.climateItems(h, {})[0].value === '71–80°');
h.config.unit_system.temperature = '°C';
ok('Fahrenheit thermostat normalized to Celsius', window.hkRoom.climateItems(h, {})[0].value === '22–27°');
h.config.unit_system.temperature = '°F';
h.states['sensor.den_t'].state = 'unavailable';
items = window.hkRoom.climateItems(h, {});
ok('unavailable sensor remains a popup member without affecting the range', items[0].value === '80°' && items[0].ids.length === 2);
// as Home Assistant has it: an unavailable thermostat loses its current_* attributes
var bedroomAttrs = h.states['climate.bedroom'].attributes;
h.states['climate.bedroom'] = { entity_id: 'climate.bedroom', state: 'unavailable', attributes: {} };
items = window.hkRoom.climateItems(h, {});
ok('all unavailable has an honest label and remains tappable', items[0].value === 'Unavailable' &&
   items[0].ids.indexOf('climate.bedroom') >= 0, items[0]);
h.states['climate.bedroom'] = { entity_id: 'climate.bedroom', state: 'cool', attributes: bedroomAttrs };
h.states['sensor.den_t'].state = '26.6666666667';
ok('equal rounded endpoints collapse to one reading', window.hkRoom.climateItems(h, {})[0].value === '80°');
ok('screen entity and device exclusions apply', window.hkStrategy.climateMembers(h, { exclude_entities: ['sensor.den_t'], exclude_devices: ['bedroom'] }).temperature.length === 0);
settings.kinds = { temperature: ['sensor.den_t'], humidity: ['sensor.den_h'], fans: ['fan.den'], blinds: [] };
ok('server Status & Chips lists are authoritative', window.hkRoom.climateItems(h, {}).map(function (x) { return x.kind; }).join() === 'temperature,humidity,fans');
// blinds and fans read by the one accessory rule every row uses (describe)
settings.kinds.fans = ['fan.den', 'fan.bedroom'];
h.states['fan.bedroom'].state = 'unavailable';
var fanItem = window.hkRoom.climateItems(h, {}).filter(function (x) { return x.kind === 'fans'; })[0];
ok('a fan that cannot answer: "2 Fans -- 1 On · 1 Unavailable", the same words as every row',
   fanItem && fanItem.title === '2 Fans' && fanItem.value === '1 On · 1 Unavailable' &&
   fanItem.value === window.hkRoom._.describe(h, 'fans', ['fan.den', 'fan.bedroom'], false).value, fanItem);
h.states['fan.bedroom'].state = 'off'; settings.kinds.fans = ['fan.den'];
settings.status_rows.climate.status = [];
ok('an explicitly empty status list hides the whole row', window.hkRoom.climateItems(h, {}).length === 0);
settings.status_rows.climate.status = ['temperature', 'humidity', 'blinds', 'fans'];
var opened;
window.hkDetail = { openGroup: function (title, ids, opts) { opened = { title: title, ids: ids, opts: opts }; } };
var Card = customElements.get('hk-climate-status-card'), card = new Card();
card.setConfig({}); card.hass = h;
card._open(card._list[0]);
ok('one source still opens the category popup', opened.title === 'Temperature' && opened.ids.join() === 'sensor.den_t');
settings.kinds.temperature.push('climate.bedroom');
ok('the open popup resolves changed membership from the same lists', opened.opts.resolve(h).ids.length === 2);
var oldRow = card._root.querySelector('.row'); oldRow.scrollLeft = 110;
var h2 = Object.assign({}, h, { states: Object.assign({}, h.states) });
h2.states['climate.bedroom'] = { entity_id: 'climate.bedroom', state: 'cool', attributes: { current_temperature: 85, current_humidity: 89 } };
card.hass = h2;
ok('attribute-only thermostat changes update ranges and preserve scrolling', card._list[0].value === '80–85°' && card._root.querySelector('.row') === oldRow && oldRow.scrollLeft === 110);
var Tile = customElements.get('hk-tile-card'), pill = new Tile();
pill.setConfig({ entity: 'climate.bedroom', room: 'Bedroom', label_mode: 'climate_temperature' }); pill.hass = h2;
ok('thermostat reading pill shows current temperature with units', pill._label(h2.states['climate.bedroom']) === '85°');
h2.states['sensor.den_t'] = { entity_id: 'sensor.den_t', state: '', attributes: { unit_of_measurement: '°C' } };
ok('blank readings never become zero', window.hkRoom.climateReading(h2, 'sensor.den_t', 'temperature') === null);
h2.states['sensor.den_h'].state = '105';
ok('out-of-range humidity is rejected', window.hkRoom.climateReading(h2, 'sensor.den_h', 'humidity') === null);
// Scroll gestures must never activate a popup on touch devices.
var button = { classList: { add: function () {}, remove: function () {} }, getAttribute: function () { return '0'; } };
var event = { target: { closest: function () { return button; } }, clientX: 0, clientY: 0, detail: 1 };
card._root._listeners.pointerdown.forEach(function (f) { f(event); });
card._root._listeners.pointermove.forEach(function (f) { f(Object.assign({}, event, { clientX: 30 })); });
opened = null; card._root._listeners.click.forEach(function (f) { f(event); });
ok('dragging the row does not open a popup', opened === null);
window.hkStrategy.generate({ music: false }, { states: h.states, entities: h.entities, devices: h.devices, areas: h.areas }).then(function (cfg) {
  var view = cfg.views.filter(function (v) { return v.path === 'climate'; })[0];
  ok('generated Climate page places the shared status row immediately below the title', view && view.cards[1].type === 'custom:hk-climate-status-card');
  ok('Climate title, status and devices all occupy the main column, never a gutter',
     view.cards.every(function (c) { return c.view_layout && c.view_layout['grid-column'] === '2'; }));
  only = { states: { 'sensor.den_t': h.states['sensor.den_t'] }, entities: { 'sensor.den_t': h.entities['sensor.den_t'] }, areas: h.areas, devices: {} };
  settings.kinds = { temperature: ['sensor.den_t'], humidity: [], fans: [], blinds: [], thermostats: [] };
  // the ROW leaves the den out: that is the row's business, not whether the
  // house has a Climate page (the build reads no status_rows -- 2026-10-04)
  settings.status_rows.climate.exclude_areas = ['den', 'outside'];
  return window.hkStrategy.generate({ music: false }, only);
}).then(function (cfg) {
  var view = cfg.views.filter(function (v) { return v.path === 'climate'; })[0];
  ok('sensor-only homes get a Climate page without an empty body grid', view && view.cards.length === 2);
  ok('...even while the Climate row leaves out the only room with a reading',
     !!view && window.hkStrategy.climateMembers(only, {}).temperature.length === 0);
  settings.status_rows.climate.exclude_areas = ['outside'];
  print('\n' + (fail ? 'FAIL ' + fail + ' CLIMATE TESTS' : 'ALL ' + pass + ' CLIMATE TESTS PASS'));
  if (fail) throw new Error('climate tests failed');
}).catch(function (e) { print('FAIL ' + e); throw e; });
for (var i = 0; i < 8; i++) drainMicrotasks();
