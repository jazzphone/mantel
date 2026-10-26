// WHERE A CATEGORY PAGE'S TILE BELONGS (hk-strategy.js hk_place), for Edit
// mode: which saved list a drag there changes. Lights, Climate (its left
// stack) and Water list room by room and follow each room's Tile Order
// (accessory/order): {area, group, page}. Security and Vacuums keep a page
// order of their own (accessory/page_order): {page}. Room pages and Home
// keep theirs as before ({area, group} and {area}); Favorites none. A
// fictional house.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run categoryplaces');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');

var pass = 0, fail = 0;
function eq(n, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + '   got ' + g + ', want ' + w); }
}
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var S = {};
[st('light.kitchen_pendant', 'on', { friendly_name: 'Kitchen Pendant' }),
 st('light.den_lamp', 'off', { friendly_name: 'Den Lamp' }),
 st('fan.den_fan', 'off', { friendly_name: 'Den Fan' }),
 st('binary_sensor.kitchen_leak', 'off', { friendly_name: 'Kitchen Leak', device_class: 'moisture' }),
 st('lock.front', 'locked', { friendly_name: 'Front Door' }),
 st('cover.garage', 'closed', { friendly_name: 'Garage Door', device_class: 'garage' }),
 st('vacuum.downstairs', 'docked', { friendly_name: 'Downstairs' }),
 st('weather.home', 'sunny', {}), st('sun.sun', 'above_horizon', {}),
 st('alarm_control_panel.house', 'disarmed', { friendly_name: 'House Alarm' })
].forEach(function (s) { S[s.entity_id] = s; });
var client = {
  states: S, themes: { themes: {} },
  floors: {},
  areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' },
           garage: { area_id: 'garage', name: 'Garage' } },
  devices: {},
  entities: { 'light.kitchen_pendant': { area_id: 'kitchen' }, 'light.den_lamp': { area_id: 'den' },
              'fan.den_fan': { area_id: 'den' }, 'binary_sensor.kitchen_leak': { area_id: 'kitchen' },
              'lock.front': { area_id: 'garage' }, 'cover.garage': { area_id: 'garage' },
              'vacuum.downstairs': { area_id: 'kitchen' }, 'alarm_control_panel.house': { area_id: 'garage' } }
};
window.hkSettings = { get: function (p, f) { return f; }, weatherId: function () { return 'weather.home'; } };

// every card for `id` in a view, with its place
function places(view, id) {
  var out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.entity === id && typeof n.type === 'string') out.push(n.hk_place === undefined ? null : n.hk_place);
    Object.keys(n).forEach(function (k) { walk(n[k]); });
  })(view);
  return out;
}

window.hkStrategy.generate({ music: false, popups: false }, client).then(function (m) {
  var v = {};
  m.views.forEach(function (x) { v[x.path] = x; });
  print('\n=== the category pages say where each tile belongs ===');
  eq('Lights: room by room, the room\'s order', places(v.lights, 'light.kitchen_pendant'),
     [{ area: 'kitchen', group: 'Lights', page: 'lights' }]);
  eq('...each room its own', places(v.lights, 'light.den_lamp'), [{ area: 'den', group: 'Lights', page: 'lights' }]);
  eq('Climate\'s left stack: the room\'s fans', places(v.climate, 'fan.den_fan'), [{ area: 'den', group: 'Climate', page: 'climate' }]);
  eq('Water: the leak sensors room by room', places(v.water, 'binary_sensor.kitchen_leak'),
     [{ area: 'kitchen', group: 'Water', page: 'water' }]);
  eq('Security: its own page order', [places(v.security, 'lock.front'), places(v.security, 'cover.garage')],
     [[{ page: 'security' }], [{ page: 'security' }]]);
  eq('Vacuums: its own page order', places(v.vacuums, 'vacuum.downstairs'), [{ page: 'vacuums' }]);

  print('\n=== the room pages and Home as before ===');
  var room = { cards: window.hkStrategy.roomCards(client, ['den'], 'Den', {}) };
  var lamp = places(room, 'light.den_lamp');
  eq('a room page\'s tile: its room and group, no page', lamp.length === 1 && lamp[0].area === 'den' && !!lamp[0].group && !('page' in lamp[0]), true);
  var home = places(v.home, 'light.den_lamp');
  eq('Home\'s room section: its room', home.length >= 1 && home.every(function (p) { return p && p.area === 'den' && !('page' in p); }), true);
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' CATEGORY PLACES TESTS' : 'ALL ' + pass + ' CATEGORY PLACES TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
