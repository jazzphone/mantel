// The category pages' status rows (hk-room.js pageItems, hk-page-status-card):
// Lights, Doors & Windows, Water and Security, as the Climate page has. They
// count what the page and the chips count (hkStrategy.pageMembers), in the
// house's order, less the rooms a row leaves out; their sensors name the room.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + '   ' + JSON.stringify(d)); } }

var settings = {
  status_rows: {
    lights: { status: ['lights', 'outlets'], exclude_areas: [] },
    doors_windows: { status: ['doors', 'windows', 'motion', 'occupancy'], exclude_areas: [] },
    water: { status: ['leaks', 'valves'], exclude_areas: [] },
    security: { status: ['security', 'locks', 'garage', 'doors', 'windows', 'leaks'], exclude_areas: [] }
  },
  accessories: { entities: { 'switch.lamp_plug': { show_as: 'light' } } },
  // Status & Chips, as the server resolves it
  kinds: {
    lights: ['light.den', 'light.hall', 'switch.lamp_plug', 'switch.coffee'],
    doors: ['binary_sensor.front_door', 'binary_sensor.back_door'], windows: ['binary_sensor.den_window'],
    garage: ['cover.garage'], locks: ['lock.front'], leaks: ['binary_sensor.sink_leak', 'binary_sensor.shed_leak'],
    motion: ['binary_sensor.emma_motion', 'binary_sensor.hall_motion'],
    occupancy: ['binary_sensor.emma_occ', 'binary_sensor.den_occ', 'binary_sensor.hall_occ'],
    valves: ['valve.sprinkler', 'valve.main_water']
  }
};
window.hkSettings = { weatherId: function () { return null; }, get: function (path, fallback) {
  var v = settings; path.split('.').forEach(function (k) { v = v && v[k]; });
  return v == null ? fallback : v;
} };
var h = { states: {}, entities: {}, devices: {},
  areas: { den: { name: 'Den' }, hall: { name: 'Hall' }, emma: { name: 'Emma’s Room' },
           kitchen: { name: 'Kitchen' }, shed: { name: 'Shed' }, garage: { name: 'Garage' } } };
function add(id, state, attrs, area) {
  h.states[id] = { entity_id: id, state: state, attributes: attrs || {} };
  h.entities[id] = { area_id: area || 'den' };
}
add('light.den', 'on'); add('light.hall', 'off', {}, 'hall'); add('switch.lamp_plug', 'on');
add('switch.coffee', 'off', { device_class: 'outlet' }, 'kitchen');
add('binary_sensor.front_door', 'on', { device_class: 'door' }, 'hall');
add('binary_sensor.back_door', 'off', { device_class: 'door' }, 'kitchen');
add('binary_sensor.den_window', 'off', { device_class: 'window' });
add('cover.garage', 'closed', { device_class: 'garage' }, 'garage');
add('lock.front', 'locked', {}, 'hall');
add('binary_sensor.sink_leak', 'off', { device_class: 'moisture' }, 'kitchen');
add('binary_sensor.shed_leak', 'off', { device_class: 'moisture' }, 'shed');
add('binary_sensor.emma_motion', 'on', { device_class: 'motion' }, 'emma');
add('binary_sensor.hall_motion', 'off', { device_class: 'motion' }, 'hall');
add('binary_sensor.emma_occ', 'on', { device_class: 'occupancy' }, 'emma');
add('binary_sensor.den_occ', 'on', { device_class: 'occupancy' });
add('binary_sensor.hall_occ', 'on', { device_class: 'occupancy' }, 'hall');
add('valve.sprinkler', 'open', { device_class: 'water' }, 'garage');
add('valve.main_water', 'closed', { device_class: 'water' }, 'garage');
add('alarm_control_panel.house', 'disarmed', {}, 'hall');

var R = window.hkRoom;
function row(page, o) { return R.pageItems(h, page, o || {}); }
function say(list) { return list.map(function (i) { return i.title + '=' + i.value; }); }
function find(list, k) { return list.filter(function (i) { return i.kind === k; })[0]; }

print('=== Lights: lights and outlets, the page\'s two halves ===');
var lt = row('lights');
ok('a lamp plug drawn as a light is a light; the coffee outlet is an outlet',
   find(lt, 'lights').ids.join() === 'light.den,light.hall,switch.lamp_plug' && find(lt, 'outlets').ids.join() === 'switch.coffee',
   lt);
ok('the Home app\'s words: "3 Lights -- 2 On", "Outlet -- Off"', JSON.stringify(say(lt)) === '["3 Lights=2 On","Outlet=Off"]', say(lt));
// ONE RULE FOR WHAT CANNOT ANSWER (the 2026-10-04 review): with the hall's
// light gone, the two that answer are both on -- that is "2 On · 1
// Unavailable", never "3 Lights -- On"
h.states['light.hall'].state = 'unavailable';
ok('a light that cannot answer is said, not folded into "On"', find(row('lights'), 'lights').value === '2 On · 1 Unavailable',
   find(row('lights'), 'lights'));
h.states['light.den'].state = 'off'; h.states['switch.lamp_plug'].state = 'off';
ok('...and with none of the rest on: "0 On · 1 Unavailable", as the Climate row says it',
   find(row('lights'), 'lights').value === '0 On · 1 Unavailable', find(row('lights'), 'lights'));
h.states['light.den'].state = 'on'; h.states['switch.lamp_plug'].state = 'on'; h.states['light.hall'].state = 'off';

print('\n=== Doors & Windows: the room it is detected in ===');
var dw = row('doors_windows');
ok('doors, windows, motion, occupancy, in the house\'s order',
   dw.map(function (i) { return i.kind; }).join() === 'doors,windows,motion,occupancy', say(dw));
ok('motion in one room names it: "Motion -- Emma’s Room"', find(dw, 'motion').value === 'Emma’s Room', find(dw, 'motion'));
ok('occupancy in three rooms: "3 Rooms -- Occupied"', find(dw, 'occupancy').title === '3 Rooms' && find(dw, 'occupancy').value === 'Occupied');
h.states['binary_sensor.emma_motion'].state = 'off';
ok('no motion: "Not Detected", dimmed', find(row('doors_windows'), 'motion').value === 'Not Detected' && find(row('doors_windows'), 'motion').dim);
h.states['binary_sensor.emma_motion'].state = 'on'; h.states['binary_sensor.hall_motion'].state = 'on';
ok('motion in two rooms: "2 Rooms"', find(row('doors_windows'), 'motion').value === '2 Rooms');
h.states['binary_sensor.hall_motion'].state = 'off';
['binary_sensor.den_occ', 'binary_sensor.hall_occ'].forEach(function (id) { h.states[id].state = 'off'; });
ok('occupied in one room: "Occupancy -- Emma’s Room"', find(row('doors_windows'), 'occupancy').title === 'Occupancy' &&
   find(row('doors_windows'), 'occupancy').value === 'Emma’s Room');
['binary_sensor.den_occ', 'binary_sensor.hall_occ'].forEach(function (id) { h.states[id].state = 'on'; });
ok('one of two doors open: "2 Doors -- 1 Open"', find(dw, 'doors').title === '2 Doors' && find(dw, 'doors').value === '1 Open');

print('\n=== the house\'s order, and what a page may show ===');
settings.status_rows.doors_windows.status = ['occupancy', 'doors', 'locks', 'occupancy'];
ok('shown in the order chosen, each once; a kind the page cannot show (locks) is not',
   row('doors_windows').map(function (i) { return i.kind; }).join() === 'occupancy,doors', say(row('doors_windows')));
settings.status_rows.doors_windows.status = [];
ok('nothing chosen: no row', row('doors_windows').length === 0);
settings.status_rows.doors_windows.status = ['doors', 'windows', 'motion', 'occupancy'];
ok('a card\'s own items win', row('doors_windows', { items: ['windows'] }).map(function (i) { return i.kind; }).join() === 'windows');

print('\n=== Water: leaks and valves ===');
var wt = row('water');
ok('dry: "2 Leak Sensors" are "Leak -- None", dimmed', find(wt, 'leaks').title === 'Leak' && find(wt, 'leaks').value === 'None' &&
   find(wt, 'leaks').dim === true, find(wt, 'leaks'));
ok('a running sprinkler: "2 Valves -- 1 Running"', find(wt, 'valves').title === '2 Valves' && find(wt, 'valves').value === '1 Running', find(wt, 'valves'));
h.states['binary_sensor.sink_leak'].state = 'on';
var wet = find(row('water'), 'leaks');
ok('wet: the room, in the alert colour', wet.value === 'Kitchen' && wet.alert === true && !wet.dim, wet);
h.states['binary_sensor.sink_leak'].state = 'unknown'; h.states['binary_sensor.shed_leak'].state = 'unknown';
ok('leak sensors that have said nothing since a restart: "No Report", as their tiles say',
   find(row('water'), 'leaks').value === 'No Report' && find(row('water'), 'leaks').dim);
h.states['binary_sensor.shed_leak'].state = 'unavailable';
ok('...one of them gone: "Unavailable"', find(row('water'), 'leaks').value === 'Unavailable');
h.states['binary_sensor.sink_leak'].state = 'off'; h.states['binary_sensor.shed_leak'].state = 'off';
settings.status_rows.water.exclude_areas = ['shed'];
ok('a room left out of the row: the shed\'s sensor is not counted', find(row('water'), 'leaks').ids.join() === 'binary_sensor.sink_leak');
settings.status_rows.water.exclude_areas = [];
h.states['valve.gas'] = { entity_id: 'valve.gas', state: 'closed', attributes: { device_class: 'gas' } };
var gas = R._.describe(h, 'valves', ['valve.gas'], true);
ok('a gas valve opens and closes, it does not run', gas.title === 'Valve' && gas.value === 'Closed', gas);

print('\n=== Security: the system, then what guards the house ===');
var sc = row('security');
ok('Security System, Lock, Garage Door, 2 Doors, Window, Leak -- in that order',
   JSON.stringify(sc.map(function (i) { return i.kind; })) === '["security","locks","garage","doors","windows","leaks"]', say(sc));
ok('the system in its own words: "Security System -- Disarmed"', find(sc, 'security').title === 'Security System' &&
   find(sc, 'security').value === 'Disarmed');
h.states['alarm_control_panel.house'].state = 'armed_night';
ok('...armed: "Armed Night"', find(row('security'), 'security').value === 'Armed Night');
h.states['alarm_control_panel.house'].state = 'triggered';
ok('...triggered: in the alert colour', find(row('security'), 'security').alert === true);
h.states['alarm_control_panel.house'].state = 'disarmed';
h.entities['alarm_control_panel.house'] = { area_id: 'hall', hidden: false };
ok('a screen that leaves the hall out loses its system and its lock too',
   !find(row('security', { exclude_areas: ['hall'] }), 'security') && !find(row('security', { exclude_areas: ['hall'] }), 'locks'));
h.states['lock.front'].state = 'unavailable';
var un = find(row('security'), 'locks');
ok('a lock with nothing to say: "Unavailable", dimmed -- still tappable', un.value === 'Unavailable' && un.dim && un.ids.length === 1, un);
h.states['lock.front'].state = 'locked';

print('\n=== a tap ===');
var opened = null, info = null;
window.hkDetail = { openGroup: function (title, ids, o) { opened = { title: title, ids: ids, o: o }; return true; } };
var Card = customElements.get('hk-page-status-card'), card = new Card();
card.setConfig({ page: 'security' });
card.dispatchEvent = function (e) { if (e.type === 'hass-more-info') info = e.detail.entityId; };
card.hass = h;
card._open(find(card._itemsFor(h), 'security'));
ok('one security system opens its own sheet (the keypad is on the page)', info === 'alarm_control_panel.house' && !opened, info);
card._open(find(card._itemsFor(h), 'doors'));
ok('the doors open as a list that says its rooms and comes back from an accessory',
   opened && opened.ids.length === 2 && opened.o.row && opened.o.kind === 'doors', opened);
var live = opened.o.resolve(h);
ok('...kept live by its resolve', live.kind === 'doors' && live.ids.length === 2, live);
settings.status_rows.security.status = ['locks'];
ok('...and a list whose kind left the row says so, rather than vanishing',
   opened.o.resolve(h).value === 'No accessories' && opened.o.resolve(h).ids.length === 0);
settings.status_rows.security.status = ['security', 'locks', 'garage', 'doors', 'windows', 'leaks'];
ok('the Climate page\'s card is a page row too', customElements.get('hk-climate-status-card').prototype instanceof Card);

print('\n' + (fail ? 'FAIL ' + fail + ' PAGE ROW TESTS' : 'ALL ' + pass + ' PAGE ROW TESTS PASS'));
if (fail) throw new Error('page row tests failed');
