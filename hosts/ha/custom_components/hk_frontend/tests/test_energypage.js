// hk-strategy.js: the Energy feature's page, drawn from its plan (the
// settings feed's `energy`, features/energy/plan.py), on a whole screen and
// on a screen that is only that page.
load(HK_ROOT + '/tests/dom.js');
// the pill's table (hkCards.TILE): a page's grids are built from it
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }
var S = {};
[st('sensor.main_live', '1.6', { device_class: 'power', unit_of_measurement: 'kW' }),
 st('sensor.office_power', '130', { device_class: 'power', unit_of_measurement: 'W' }),
 st('sensor.outside', '70', { unit_of_measurement: '°F', device_class: 'temperature' }),
 st('climate.down', 'cool', { current_temperature: 72 }), st('climate.up', 'cool', { current_temperature: 74 }),
 st('sensor.car_battery', '79', { device_class: 'battery' }), st('sensor.car_range', '254', {}),
 st('light.kitchen', 'on', { friendly_name: 'Kitchen Light' })
].forEach(function (s) { S[s.entity_id] = s; });
var hass = { states: S, themes: { themes: { 'HK Kiosk': {} } }, areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
             devices: {}, entities: { 'light.kitchen': { area_id: 'kitchen' } } };
var PLAN = {
  title: 'Energy',
  total: { name: 'Whole Home', power: 'sensor.main_live', stat: 'sensor.main_utility', cost: 'sensor.main_utility_cost', price: null },
  top: [{ kind: 'cost' }, { kind: 'climate', entity: 'climate.down', name: 'Downstairs' },
        { kind: 'climate', entity: 'climate.up', name: 'Upstairs' }, { kind: 'temp', entity: 'sensor.outside', name: 'Outside' }],
  usages: [{ entity: 'sensor.main_live', stat: 'sensor.main_utility', name: 'Whole Home', color: 'orange', runtime: false },
           { entity: 'sensor.runtime', stat: 'sensor.runtime', name: 'AC Runtime', color: 'blue', runtime: true }],
  sections: [
    { id: 'rooms', name: 'Rooms', link: { path: '/panel/ecoflow', text: 'EcoFlow' }, items: [
      { key: 'sensor.office_utility', kind: 'device', name: 'Office', icon: 'hk:desk', color: 'purple',
        power: 'sensor.office_power', stat: 'sensor.office_utility', control: null },
      { key: 'sensor.den_utility', kind: 'device', name: 'Den', icon: 'hk:sofa-outline', color: 'orange',
        power: null, stat: 'sensor.den_utility', control: null }] },
    { id: 'charging', name: 'Charging', link: null, items: [
      { key: 'sensor.car_battery', kind: 'battery', entity: 'sensor.car_battery', name: 'Roadster', icon: 'hk:battery-high',
        label: 'sensor.car_range', label_suffix: ' mi range', label_decimals: 0 }] }],
  detail: true, devices: {}, names: {}
};
var BOARD = {}, ADDED = ['energy'], ENERGY = PLAN;
window.hkSettings = { get: function (p, f) {
  if (p === 'boards') return { '': BOARD, panel: { home_page: false, custom_pages: ['ecoflow'] } };
  if (p === 'added') return ADDED;
  if (p === 'energy') return ENERGY;
  if (p === 'custom_pages') return [{ path: 'ecoflow', title: 'EcoFlow', view: { cards: [{ type: 'x' }] } }];
  return f;
}, weatherId: function () { return null; } };
var BASE_GET = window.hkSettings.get;
function byPath(cfg, p) { return cfg.views.filter(function (v) { return v.path === p; })[0]; }
function flat(v) {
  var out = [];
  (function walk(n) { if (!n || typeof n !== 'object') return; if (n.type) out.push(n);
    Object.keys(n).forEach(function (k) { walk(n[k]); }); })(v);
  return out;
}
window.hkStrategy.generate({ music: false }, hass).then(function (cfg) {
  var paths = cfg.views.map(function (v) { return v.path; });
  var ev = byPath(cfg, 'energy');
  ok('a whole screen: the Energy page among its pages, before the rooms', !!ev && paths.indexOf('energy') < paths.indexOf('room-kitchen'), paths);
  ok('...a sub-page with the energy sky and its own background', ev.subview === true && ev.sky_variant === 'energy' &&
     ev.background === '#171d12' && ev.icon === 'mdi:lightning-bolt' && ev.title === 'Energy', ev);
  ok('...its title bar has the back button', ev.cards[0].cards[0].type === 'custom:hk-back-card');
  var cs = flat(ev);
  var types = cs.map(function (c) { return c.type; });
  ok('the tabs come first, then the cards\' grid', types.indexOf('custom:hk-energy-period-card') >= 0 &&
     types.indexOf('custom:hk-energy-period-card') < types.indexOf('custom:hk-energy-hero-card'), types);
  var grid = cs.filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.type === 'custom:hk-energy-hero-card'; }); })[0];
  var kinds = grid.cards.map(function (c) { return c.type.replace('custom:hk-energy-', ''); });
  ok('one grid: summary, highlights, where it went, your day', JSON.stringify(kinds) === '["hero-card","highlights-card","where-card","day-card"]', kinds);
  ok('...three columns, two on the iPad, one on a phone (css vars)', grid.layout['grid-template-columns'] === 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))');
  ok('...the summary two columns wide, where it went all three', grid.cards[0].view_layout['grid-column'] === 'var(--hk-energy-hero, span 2)' &&
     grid.cards[2].view_layout['grid-column'] === '1 / -1');
  ok('...no battery, water or gas: your day takes all three columns', grid.cards[3].view_layout['grid-column'] === '1 / -1', grid.cards[3]);
  ok('...the summary\'s thermostats open the screen\'s Climate page', grid.cards[0].climate_path === './climate', grid.cards[0]);
  ok('the readings row and the live graph are the summary\'s Now: neither is on the page',
     !cs.some(function (c) { return c.value_mode === 'cost_today' || c.type === 'custom:hk-trace-card'; }));
  ok('automatic daily bars are each device\'s sheet now: none on the page', !cs.some(function (c) { return c.type === 'custom:hk-usage-card'; }));
  var heads = cs.filter(function (c) { return c.type === 'custom:hk-heading-card'; }).map(function (c) { return c.name; });
  ok('headings: each section, then Home Assistant\'s Charts', JSON.stringify(heads.slice(1)) === '["Rooms","Charging","Home Assistant\u2019s Charts"]', heads);
  ok('a section heading carries its total on the tab', cs.filter(function (c) { return c.name === 'Rooms'; })[0].energy_section === 'rooms');
  var rooms = cs.filter(function (c) { return c.name === 'Rooms' && c.type === 'custom:hk-heading-card'; })[0];
  ok('a section\'s link is its heading\'s chevron', rooms.navigation_path === '/panel/ecoflow' && rooms.chevron === 'EcoFlow›', rooms);
  var office = cs.filter(function (c) { return c.name === 'Office'; })[0];
  ok('a device tile: live watts, kWh today, against its section; it follows the tabs', office.type === 'custom:hk-rank-card' &&
     office.entity === 'sensor.office_power' && office.stat === 'sensor.office_utility' && office.energy === true && office.section === 'rooms' &&
     JSON.stringify(office.peers) === '["sensor.office_utility","sensor.den_utility"]' && office.icon_color === 'purple', office);
  ok('no Power page: no backed-up badges', !office.backed);
  var den = cs.filter(function (c) { return c.name === 'Den'; })[0];
  ok('...with no power sensor: today\'s kWh is its reading', den.entity === 'sensor.den_utility' && den.mode === 'energy', den);
  var car = cs.filter(function (c) { return c.name === 'Roadster'; })[0];
  ok('a battery: its level, colored by it, with its range', car.mode === 'pct' && car.label_entity === 'sensor.car_range' &&
     car.label_suffix === ' mi range' && car.icon_color_steps.length === 3, car);
  ok('Home Assistant\'s own charts at the end', cs.some(function (c) { return c.card && c.card.type === 'energy-devices-graph'; }));
  ENERGY = Object.assign({}, PLAN, { power: { backs_up: 'some', sections: [{ id: 'rooms', items: [{ key: 'sensor.office_utility', backed: true }, { key: 'sensor.den_utility', backed: false }] }] } });
  return window.hkStrategy.generate({ music: false }, hass).then(function (c2) {
    var cs2 = flat(byPath(c2, 'energy'));
    var o2 = cs2.filter(function (c) { return c.name === 'Office'; })[0], d2 = cs2.filter(function (c) { return c.name === 'Den'; })[0];
    ok('with the Power page: a backed-up device carries the badge here too, one that is not does not', o2.backed === true && !d2.backed, [o2, d2]);
    ENERGY = PLAN;
    return cfg;
  });
}).then(function (cfg) {
  // THE THIRD ROW FOLLOWS WHAT THE HOUSE HAS
  ENERGY = Object.assign({}, PLAN, { sources: { battery: true, water: true, gas: true },
                                     usages_auto: false });
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var g = flat(byPath(cfg, 'energy')).filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.type === 'custom:hk-energy-day-card'; }); })[0];
  var row = g.cards.slice(3).map(function (c) { return c.type.replace('custom:hk-energy-', '') + (c.source ? ':' + c.source : ''); });
  ok('battery, water and gas: your day, then the battery and water (two beside it at most)',
     JSON.stringify(row) === '["day-card","battery-card","water-card:water"]', row);
  ok('...your day one column wide', g.cards[3].view_layout['grid-column'] === 'var(--hk-energy-day, span 1)', g.cards[3]);
  var fl = flat(byPath(cfg, 'energy'));
  var tk = fl.filter(function (c) { return c.type === 'custom:hk-energy-tracking-card'; });
  var hds = fl.filter(function (c) { return c.type === 'custom:hk-heading-card'; }).map(function (c) { return c.name; });
  ok('the bars the house chose are one Tracking card that follows the tabs, under its heading', tk.length === 1 &&
     hds.indexOf('Tracking') > 0 && !fl.some(function (c) { return c.type === 'custom:hk-usage-card'; }), hds);
  ENERGY = Object.assign({}, PLAN, { sources: { gas: true } });
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var g = flat(byPath(cfg, 'energy')).filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.type === 'custom:hk-energy-day-card'; }); })[0];
  ok('gas alone: your day two columns, gas beside it (a full row on the iPad)', g.cards[3].view_layout['grid-column'] === 'var(--hk-energy-day, span 2)' &&
     g.cards[4].source === 'gas' && g.cards[4].view_layout['grid-column'] === 'var(--hk-energy-one, auto)', g.cards.slice(3));
  ENERGY = Object.assign({}, PLAN, { page: { highlights: false } });
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var g = flat(byPath(cfg, 'energy')).filter(function (c) { return c.type === 'custom:hk-grid-card' && (c.cards || []).some(function (k) { return k.type === 'custom:hk-energy-hero-card'; }); })[0];
  ok('highlights off: the summary takes the whole row', g.cards[0].view_layout['grid-column'] === '1 / -1' &&
     !g.cards.some(function (c) { return c.type === 'custom:hk-energy-highlights-card'; }));
  ENERGY = PLAN;
  // NOT ADDED: no page
  ADDED = [];
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('without the Energy feature, no Energy page', !byPath(cfg, 'energy'));
  ADDED = ['energy'];
  // ITS PAGES: left out of a screen whose Pages do not list it
  BOARD = { pages: ['lights'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('a screen whose Pages leave it out has none', !byPath(cfg, 'energy'));
  // AN ENERGY DISPLAY: no Home, only the Energy page
  BOARD = { home_page: false, menu: 'off', custom_pages: ['energy'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('an energy display is only the Energy page', cfg.views.length === 1 && cfg.views[0].path === 'energy', cfg.views.map(function (v) { return v.path; }));
  var ev = cfg.views[0];
  var hero = flat(ev).filter(function (c) { return c.type === 'custom:hk-energy-hero-card'; })[0];
  ok('...no Climate page there: a thermostat opens its sheet', hero && !hero.climate_path, hero);
  ok('...its first page, no menu: no back button, not a sub-page; the menu would call it Energy',
     ev.cards[0].cards.length === 1 && ev.cards[0].cards[0].type === 'custom:hk-heading-card' && ev.subview === false &&
     ev.menu_title === 'Energy', ev.cards[0]);
  // a section linking to a page this screen does not have: that page on a screen that has it
  PLAN.sections[0].link = { path: './ecoflow', text: 'EcoFlow' };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var hd = flat(cfg.views[0]).filter(function (c) { return c.name === 'Rooms' && c.type === 'custom:hk-heading-card'; })[0];
  ok('a link to a page this screen lacks opens it on the screen that has it', hd.navigation_path === '/panel/ecoflow', hd);
  // with a custom page after it
  BOARD = { home_page: false, menu: 'auto', custom_pages: ['energy', 'ecoflow'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var hd = flat(cfg.views[0]).filter(function (c) { return c.name === 'Rooms' && c.type === 'custom:hk-heading-card'; })[0];
  ok('...and stays on this screen when it has the page', hd.navigation_path === './ecoflow', hd);
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('...then its custom pages, in its order', JSON.stringify(cfg.views.map(function (v) { return v.path; })) === '["energy","ecoflow"]');
  ok('...with a menu, the first page keeps its back button', cfg.views[0].cards[0].cards[0].type === 'custom:hk-back-card');
  // nothing in the plan yet: says where to start
  ENERGY = { title: 'Energy', total: {}, top: [], usages: [], sections: [], detail: false };
  BOARD = { home_page: false, menu: 'off', custom_pages: ['energy'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('an empty plan says where to add devices', JSON.stringify(cfg.views[0]).indexOf('Energy settings') > 0);
  // the feature gone, a custom page of that address: it, as before
  ADDED = [];
  window.hkSettings.get = (function (g) { return function (p, f) {
    if (p === 'custom_pages') return [{ path: 'energy', title: 'Old Energy', view: { cards: [{ type: 'y' }] } }];
    return g(p, f); }; })(window.hkSettings.get);
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('no Energy feature: a custom page called energy is still shown', cfg.views.length === 1 && cfg.views[0].title === 'Old Energy', cfg.views);
  // ANY PAGE ALONE: a Home-off screen whose Pages list built-in pages
  ADDED = ['energy'];
  ENERGY = PLAN;
  window.hkSettings.get = BASE_GET;
  S['lock.front'] = st('lock.front', 'locked', { friendly_name: 'Front Door' });
  S['alarm_control_panel.house'] = st('alarm_control_panel.house', 'disarmed', { friendly_name: 'House' });
  hass.entities['lock.front'] = { area_id: 'kitchen' };
  hass.entities['alarm_control_panel.house'] = { area_id: 'kitchen' };
  BOARD = { home_page: false, menu: 'off', only_pages: ['security'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  ok('a Home-off screen of only Security: just that page', JSON.stringify(cfg.views.map(function (v) { return v.path; })) === '["security"]',
     cfg.views.map(function (v) { return v.path; }));
  var v = cfg.views[0];
  ok('...its first page: not a sub-page, no back button with no menu, named in the menu',
     v.subview === false && v.cards[0].cards[0].type === 'custom:hk-heading-card' && v.menu_title === 'Security', v.cards[0]);
  BOARD = { home_page: false, menu: 'auto', only_pages: ['climate', 'cameras', 'energy', 'ecoflow'], pages: ['weather'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var paths = cfg.views.map(function (v) { return v.path; });
  ok('several pages, kinds and custom alike, in its order; one the house lacks left out',
     JSON.stringify(paths) === '["climate","energy","ecoflow"]', paths);
  ok('...with a menu, the first keeps its back button (the menu rides on it)', cfg.views[0].cards[0].cards[0].type === 'custom:hk-back-card');
  ok('...the thermostats open this screen\'s Climate page', JSON.stringify(cfg.views[1]).indexOf('"climate_path":"./climate"') > 0);
  BOARD = { home_page: false, menu: 'off', only_pages: ['lights', 'rooms'] };
  return window.hkStrategy.generate({ music: false }, hass);
}).then(function (cfg) {
  var paths = cfg.views.map(function (v) { return v.path; });
  ok('each page says which it is, for its background', cfg.views[0].sky_page === 'lights' &&
     cfg.views.filter(function (v) { return v.path === 'room-kitchen'; })[0].sky_page === 'rooms' &&
     cfg.views.filter(function (v) { return v.path === 'room-kitchen'; })[0].sky_room === 'room-kitchen', cfg.views.map(function (v) { return v.sky_page; }));
  ok('Room Pages listed: every room\'s page after the others', paths[0] === 'lights' && paths.indexOf('room-kitchen') > 0 && paths.indexOf('home') < 0, paths);
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' ENERGY PAGE TESTS' : 'ALL ' + pass + ' ENERGY PAGE TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
