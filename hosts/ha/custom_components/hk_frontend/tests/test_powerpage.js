// hk-strategy.js: the Power page (PLAN-2026-10-12-home-power), drawn from the
// Energy plan's `power` (features/energy/power.py) -- the house, its cards in
// pairs, the battery's own controls, the cars, every device marked backed up
// or not -- and taking over the EcoFlow page's address on every screen that
// lists it.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var S = {};
[st('sensor.main_live', '1.8', { device_class: 'power', unit_of_measurement: 'kW' }), st('light.kitchen', 'on', {})]
  .forEach(function (s) { S[s.entity_id] = s; });
var hass = { states: S, themes: { themes: { 'HK Kiosk': {} } }, areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
             devices: {}, entities: { 'light.kitchen': { area_id: 'kitchen' } } };
var POWER = {
  title: 'Power', path: 'ecoflow', art: '/hk/art/my-house/', picture: true, home: 'sensor.main_live', grid: 'sensor.main_live',
  grid_export: null, grid_status: 'binary_sensor.grid', solar: null, backed_power: 'sensor.panel_out', backs_up: 'some', groups: 'type',
  battery: { level: 'sensor.panel_level', charge: 'sensor.bc', discharge: 'sensor.bd', reserve: 'number.reserve', limit: 'number.limit',
             eps: 'switch.eps', backup: 'sensor.backup', packs: [{ name: 'Pack 1', level: 'sensor.p1' }] },
  mode: { entity: 'select.mode', options: [{ value: 'none', name: 'Off', description: 'Grid passes through.' }] },
  levels: [{ entity: 'number.limit', name: 'Charge Limit', color: 'green' }, { entity: 'number.reserve', name: 'Backup Reserve' },
           { entity: 'number.speed', name: 'Charging Speed' }],
  cars: [{ name: 'Blue Car', level: 'sensor.car_level', power: 'sensor.car_power', home: 'device_tracker.car', plugged: 'binary_sensor.cable',
           charge: 'switch.car_charge', range: 'sensor.car_range' }],
  sections: [
    { id: 'hvac', name: 'Heating & Cooling', items: [{ key: 'k.ac', kind: 'device', name: 'Upstairs AC', icon: 'hk:air-conditioner', color: 'blue',
      power: 'sensor.ac', stat: 'sensor.ac_u', control: null, backed: false }] },
    { id: 'rooms', name: 'Rooms', items: [{ key: 'k.office', kind: 'device', name: 'Office', icon: 'hk:desk', color: 'purple',
      power: 'sensor.office', stat: 'sensor.office_u', control: 'switch.c01', backed: true },
      { key: 'k.rack', kind: 'device', name: 'Network Rack', icon: 'hk:server-network', color: 'yellow',
        power: 'sensor.rack', stat: 'sensor.rack_u', control: null, backed: true, parent: 'k.outlets' }] }]
};
var PLAN = { title: 'Energy', total: { power: 'sensor.main_live', stat: 'sensor.main_u' }, top: [], usages: [], sections: [],
             detail: false, devices: {}, names: {}, sources: {}, power: POWER };
var BOARD = { custom_pages: ['ecoflow'], pages: ['energy', 'ecoflow', 'rooms'] }, ENERGY = PLAN;
window.hkSettings = { get: function (p, f) {
  if (p === 'boards') return { '': BOARD };
  if (p === 'added') return ['energy'];
  if (p === 'energy') return ENERGY;
  if (p === 'custom_pages') return [{ path: 'ecoflow', title: 'EcoFlow', view: { cards: [{ type: 'custom:old-ecoflow-card' }] } }];
  return f;
}, weatherId: function () { return null; } };
function byPath(cfg, p) { return cfg.views.filter(function (v) { return v.path === p; }); }
function flat(v) {
  var out = [];
  (function walk(n) { if (!n || typeof n !== 'object') return; if (n.type) out.push(n);
    Object.keys(n).forEach(function (k) { walk(n[k]); }); })(v);
  return out;
}
function types(v) { return flat(v).map(function (c) { return c.type; }); }
window.hkStrategy.generate({ music: false }, hass).then(function (cfg) {
  var at = byPath(cfg, 'ecoflow');
  ok('the Power page takes the EcoFlow page\'s address: one page there, not the old one', at.length === 1 &&
     types(at[0]).indexOf('custom:hk-power-house-card') >= 0 && types(at[0]).indexOf('custom:old-ecoflow-card') < 0, at.map(function (v) { return v.title; }));
  var v = at[0], cs = flat(v);
  ok('...titled Power, a sub-page with a sky of its own (not the Energy page\'s)', v.title === 'Power' && v.subview === true && v.sky_variant === 'power' && v.background === '#121634');
  var house = cs.filter(function (c) { return c.type === 'custom:hk-power-house-card'; })[0];
  ok('the wall chargers found in the Charging section (not the battery\'s own charge sensor)', JSON.stringify(house.chargers) === '[]', house.chargers);
  ok('the house first, with the whole house, the grid, the battery and the car', house.home === 'sensor.main_live' && house.level === 'sensor.panel_level' &&
     house.cars.length === 1 && house.cars[0].power === 'sensor.car_power', house);
  var grid = cs.filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.type === 'custom:hk-power-status-card'; }); })[0];
  var kinds = grid.cards.map(function (c) { return c.type.replace('custom:hk-', '') + ':' + c.view_layout['grid-column']; });
  ok('in pairs: the status beside the battery, then The House across (no sun)', JSON.stringify(kinds) ===
     '["power-status-card:var(--hk-energy-hl, auto)","house-battery-card:var(--hk-energy-hero, span 2)","power-load-card:1 / -1"]', kinds);
  var load = grid.cards[2];
  ok('The House: every device, the battery panel\'s output, Every device to the Energy page', load.devices.length === 3 &&
     load.backed_power === 'sensor.panel_out' && load.link === './energy' && load.devices[2].parent === true, load);
  var heads = cs.filter(function (c) { return c.type === 'custom:hk-heading-card'; }).map(function (c) { return c.name; });
  ok('headings: Mode, Levels, Charging, then the sections', JSON.stringify(heads.slice(1)) === '["Mode","Levels","Charging","Heating & Cooling","Rooms"]', heads);
  ENERGY = Object.assign({}, PLAN, { power: Object.assign({}, POWER, { sections: POWER.sections.concat([{ id: 'charging', name: 'Charging', items: [
    { key: 'k.wc', kind: 'device', name: 'Left Charger', icon: 'hk:ev-plug-tesla', power: 'sensor.wc', stat: 'sensor.wc_u', backed: false }] }]) }) });
  return window.hkStrategy.generate({ music: false }, hass).then(function (cfg2) {
    var cs2 = flat(byPath(cfg2, 'ecoflow')[0]);
    var h2 = cs2.filter(function (c) { return c.type === 'custom:hk-heading-card'; }).map(function (c) { return c.name; });
    var grids = cs2.filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.name === 'Left Charger'; }); })[0];
    var hc2 = cs2.filter(function (c) { return c.type === 'custom:hk-power-house-card'; })[0];
    ok('...its wall charger handed to the cards (by name: Left Charger)', JSON.stringify(hc2.chargers) === '["sensor.wc"]', hc2.chargers);
    ok('with a Charging section of its own: one Charging heading, the cars before the chargers', h2.filter(function (n) { return n === 'Charging'; }).length === 1 &&
       grids.cards[0].name === 'Blue Car' && grids.cards[1].name === 'Left Charger', h2);
    ENERGY = PLAN;
    return cfg;
  });
}).then(function (cfg) {
  var v = byPath(cfg, 'ecoflow')[0], cs = flat(v);
  var seg = cs.filter(function (c) { return c.type === 'custom:hk-segment-card'; })[0];
  ok('the mode with its own names and lines', seg.entity === 'select.mode' && seg.options[0].name === 'Off');
  var sl = cs.filter(function (c) { return c.type === 'custom:hk-slider-card'; });
  ok('the levels as tiles', sl.length === 3 && sl[0].color === 'green' && sl[0].layout === 'tile');
  var car = cs.filter(function (c) { return c.name === 'Blue Car' && c.type === 'custom:hk-rank-card'; })[0];
  ok('a car: its level, its range, a charging button that asks before stopping', car.mode === 'pct' && car.label_entity === 'sensor.car_range' &&
     car.control === 'switch.car_charge' && car.control_yes === 'Stop Charging', car);
  var office = cs.filter(function (c) { return c.name === 'Office'; })[0], ac = cs.filter(function (c) { return c.name === 'Upstairs AC'; })[0];
  ok('a backed-up circuit: the badge and its power button; one that is not: neither', office.backed === true && office.control === 'switch.c01' &&
     !ac.backed && !ac.control && office.energy === 'now', [office, ac]);
  ENERGY = Object.assign({}, PLAN, { power: Object.assign({}, POWER, { groups: 'backup' }) });
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var heads = flat(byPath(cfg, 'ecoflow')[0]).filter(function (c) { return c.type === 'custom:hk-heading-card'; }).map(function (c) { return c.name; });
  ok('Backed Up first: two groups in place of the sections', heads.slice(-2).join() === 'Backed Up,Not Backed Up', heads);
  ENERGY = Object.assign({}, PLAN, { power: Object.assign({}, POWER, { battery: null, mode: null, levels: [], solar: 'sensor.pv', backs_up: 'none' }) });
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var v = byPath(cfg, 'ecoflow')[0], cs = flat(v);
  var grid = cs.filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.type === 'custom:hk-power-status-card'; }); })[0];
  ok('no battery, with solar: the status beside The House, the sun across', JSON.stringify(grid.cards.map(function (c) { return c.type.replace('custom:hk-', ''); })) ===
     '["power-status-card","power-load-card","power-sun-card"]', grid.cards.map(function (c) { return c.type; }));
  ok('...no Mode, no Levels, no badges', !cs.some(function (c) { return c.name === 'Mode' || c.name === 'Levels' || c.backed; }));
  ENERGY = Object.assign({}, PLAN, { power: null });
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var at = byPath(cfg, 'ecoflow');
  ok('the Power page off: the EcoFlow page as it was', at.length === 1 && types(at[0]).indexOf('custom:old-ecoflow-card') >= 0);
  ENERGY = PLAN;
  BOARD = { home_page: false, menu: 'off', only_pages: ['ecoflow'], custom_pages: ['ecoflow'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('a screen of only that page: the Power page', cfg.views.length === 1 && types(cfg.views[0]).indexOf('custom:hk-power-house-card') >= 0,
     cfg.views.map(function (v) { return v.path; }));
  // A LINK TO A PAGE THIS SCREEN DOES NOT HAVE: "Every device ›" on a screen
  // of only Power goes to a screen that shows the Energy page, or is not drawn
  ENERGY = Object.assign({}, PLAN, { power: Object.assign({}, POWER, { path: 'power' }) });
  BOARD = { home_page: false, menu: 'off', only_pages: ['power'], custom_pages: [] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var load = flat(cfg.views[0]).filter(function (c) { return c.type === 'custom:hk-power-load-card'; })[0];
  ok('only Power, and no screen with the Energy page: no Every device link', load && !('link' in load), load && load.link);
  var get0 = window.hkSettings.get;
  window.hkSettings.get = function (p, f) {
    if (p === 'boards') return { '': BOARD, 'energy-tablet': { home_page: false, only_pages: ['energy'] }, 'home': { pages: ['weather', 'power'] } };
    return get0(p, f);
  };
  return window.hkStrategy.generate({ music: false }, hass).then(function (cfg) {
    window.hkSettings.get = get0;
    return cfg;
  });
}).then(function (cfg) {
  var load = flat(cfg.views[0]).filter(function (c) { return c.type === 'custom:hk-power-load-card'; })[0];
  ok('...with one: the screen of only the Energy page (not a screen whose Pages leave it out)', load && load.link === '/energy-tablet/energy', load && load.link);
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' POWER PAGE TESTS' : 'ALL ' + pass + ' POWER PAGE TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
