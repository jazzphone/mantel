// hk-stat-card and hk-rank-card -- CONSTRUCTED AND DRIVEN. The editors are
// tested elsewhere; this suite tests the cards.
//
// Configs from a real Energy page: Today's Cost (value_mode: cost,
// reading a SECOND sensor), the thermostat metric (temperature from an
// attribute), a circuit rank tile (live watts + kWh-today from statistics)
// and a car battery tile (mode: pct, icon_color_steps, label_entity).
//
// Both cards read entities their `entity` does not name -- the cost tile's
// meter, the rank tile's label sensor -- which is exactly the case the
// default signature misses and each card overrides _sigOf for. The gate
// tests below are what hold those overrides to it.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-stat.js');

var PEERS = ['sensor.downstairs_ac_utility', 'sensor.downstairs_air_handler_utility',
             'sensor.upstairs_ac_utility', 'sensor.upstairs_air_handler_utility'];
function statHouse() {
  return H.house({
    'sensor.main_power_daily_cost': ['1.067', { unit_of_measurement: 'USD', friendly_name: 'Main Power Daily Cost' }],
    'sensor.main_power_daily': ['7.673', { unit_of_measurement: 'kWh' }],
    'climate.downstairs_ecobee_thermostat': ['heat_cool', { current_temperature: 71.4,
      target_temp_low: 68, target_temp_high: 74, friendly_name: 'Downstairs' }],
    'sensor.downstairs_ac_live': ['1.2', { unit_of_measurement: 'kW', friendly_name: 'Downstairs AC Live' }],
    'sensor.upstairs_ac_live': ['0.0', { unit_of_measurement: 'kW' }],
    'sensor.downstairs_ac_utility': ['4.2', { unit_of_measurement: 'kWh' }],
    'sensor.family_car_battery_level': ['80', { unit_of_measurement: '%', device_class: 'battery' }],
    'sensor.family_car_battery_range': ['256.1', { unit_of_measurement: 'mi' }],
    'light.kitchen_table_light': ['off', {}]
  });
}
function statsFor(msg) {
  var out = {}, t0 = Date.parse(msg.start_time);
  msg.statistic_ids.forEach(function (id) {
    // The tile's own statistic ends the fortnight on 4.3 kWh; its peers on 2.3.
    var base = id === 'sensor.downstairs_ac_utility' ? 3 : 1, rows = [];
    for (var i = 0; i < 14; i++) rows.push({ start: t0 + i * 864e5, change: base + i / 10 });
    out[id] = rows;
  });
  return out;
}

H.run('STAT CARDS', [

  // ------------------------------------------------------------- hk-stat-card
  function () {
    H.section('hk-stat-card: Today\'s Cost (value_mode: cost)');
    H.throws('no entity: the config is refused', function () {
      H.make('hk-stat-card').setConfig({ name: 'x' });
    });
    var house = statHouse(), card = H.make('hk-stat-card');
    H.noThrow('setConfig with the Energy page config', function () {
      card.setConfig({ type: 'custom:hk-stat-card', entity: 'sensor.main_power_daily_cost',
        name: "Today's Cost", icon: 'hk:home-lightning-bolt', icon_color: 'green',
        value_mode: 'cost', value_peer: 'sensor.main_power_daily' });
    });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root;
    H.eq('caption', H.part(R, '.name').textContent, "Today's Cost");
    H.eq('the cost, with the meter beside it', H.part(R, '.state').textContent, '$1.07 · 8 kWh');
    H.eq('the icon is set', H.part(R, '.icon').icon, 'hk:home-lightning-bolt');

    H.gate('stat (cost)', card, house,
      function () { return house.set('sensor.main_power_daily', '9.4'); },   // the PEER, not the entity
      function () { return house.set('light.kitchen_table_light', 'on'); });
    H.eq('the meter moving redraws the cost line', H.part(R, '.state').textContent, '$1.07 · 9 kWh');
    var r0 = card.__renders;
    card.hass = house.set('sensor.main_power_daily_cost', '1.31');
    H.ok('the entity itself is an input', card.__renders === r0 + 1 &&
         H.part(R, '.state').textContent === '$1.31 · 9 kWh');
    // THE HOUSE'S CURRENCY, not a "$" of the card's own (2026-10-07 audit)
    var eu = house.hass();
    hkGive(card, Object.assign({}, eu, { config: Object.assign({}, eu.config, { currency: 'EUR' }) }));
    card.redraw();
    var euro = H.part(R, '.state').textContent;
    H.ok('the cost is in the house\'s currency (EUR: no dollar sign)', euro.indexOf('$') < 0 && /€|EUR/.test(euro));
    card.hass = house.hass(); card.redraw();
    return H.lifecycle('stat', card, house, function (c) { c.hass = house.hass(); });
  },

  function () {
    H.section('hk-stat-card: a thermostat\'s temperature (value_mode: temperature)');
    var house = statHouse(), card = H.make('hk-stat-card');
    card.setConfig({ type: 'custom:hk-stat-card', entity: 'climate.downstairs_ecobee_thermostat',
      name: 'Downstairs', icon: 'hk:thermostat', icon_color: 'red', value_mode: 'temperature',
      value_attribute: 'current_temperature',
      tap_action: { action: 'navigate', navigation_path: './climate',
                    navigation_path_map: { 'energy-tablet': '/dashboard-home/climate' } } });
    card.hass = house.hass();
    H.eq('the attribute, rounded, in °F', H.part(card._root, '.state').textContent, '71°F');
    H.gate('stat (temperature)', card, house,
      function () { return house.set('climate.downstairs_ecobee_thermostat', 'heat_cool',
        { current_temperature: 72.6, target_temp_low: 68, target_temp_high: 74 }); },
      function () { return house.set('sensor.main_power_daily', '10'); });
    H.eq('the new reading', H.part(card._root, '.state').textContent, '73°F');
  },

  // ------------------------------------------------------------- hk-rank-card
  function () {
    H.section('hk-rank-card: a circuit (mode: rank, from `stat`)');
    H.throws('no entity: the config is refused', function () {
      H.make('hk-rank-card').setConfig({ mode: 'hero' });
    });
    var house = statHouse(), card = H.make('hk-rank-card');
    H.noThrow('setConfig with the Energy page config', function () {
      card.setConfig({ type: 'custom:hk-rank-card', entity: 'sensor.downstairs_ac_live',
        name: 'Downstairs AC', icon: 'hk:air-conditioner', icon_color: 'blue',
        stat: 'sensor.downstairs_ac_utility', peers: PEERS });
    });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root;
    H.eq('the live watts, as kW above 1000 W', H.morphed(H.part(R, '.hero')),
         '1.20<span class="unit">kW</span>');
    H.eq('drawing power: full contrast', H.part(R, '.hero').style.color, window.hkCards.v('ink'));
    H.eq('no label until today\'s kWh arrives', H.part(R, '.label').textContent, '');
    H.eq('a sensor is never "on": the plate is not lit', H.part(R, '.rank').getAttribute('data-on'), '0');

    H.gate('rank', card, house,
      function () { return house.set('sensor.downstairs_ac_live', '0.001'); },
      function () { return house.set('sensor.upstairs_ac_live', '0.8'); });  // a PEER's live sensor
    H.eq('an idle circuit reads whole watts', H.morphed(H.part(R, '.hero')), '1<span class="unit">W</span>');
    H.eq('...and recedes', H.part(R, '.hero').style.color, window.hkCards.v('ink-3'));
    var r0 = card.__renders;
    card.hass = house.set('sensor.downstairs_ac_utility', '4.9');
    H.eq('the statistic\'s own sensor is not an input (statistics wake it)', card.__renders - r0, 0);

    H.attach(card);
    H.runTimers();
    H.eq('one statistics request for all four peers', house.ws.map(function (w) {
      return w.msg.statistic_ids.slice().sort().join(); }), [PEERS.slice().sort().join()]);
    house.ws[0].resolve(statsFor(house.ws[0].msg));
    return H.tick().then(function () {
      H.eq('the answer wakes it with today\'s kWh', H.part(R, '.label').textContent, '4.3 kWh today');
      H.detach(card);
      return H.lifecycle('rank', card, house, function (c) { c.hass = house.hass(); });
    });
  },

  // a circuit with something to switch gets a power button; one without, none
  function () {
    H.section('hk-rank-card: the power button (`control`)');
    var house = statHouse();
    house.set('switch.office_circuit', 'on');
    var plain = H.make('hk-rank-card');
    plain.setConfig({ type: 'custom:hk-rank-card', entity: 'sensor.downstairs_ac_live', name: 'Downstairs AC' });
    plain.hass = house.hass();
    H.eq('no switch: no power button, nothing that looks like one', !!plain._e.pwr, false);
    var card = H.make('hk-rank-card');
    card.setConfig({ type: 'custom:hk-rank-card', entity: 'sensor.downstairs_ac_live', name: 'Office', control: 'switch.office_circuit' });
    card.hass = house.hass();
    var pb = card._e.pwr;
    H.eq('a switch: a power button', !!pb, true);
    H.eq('...green while on', pb.getAttribute('data-on'), '1');
    var asked = null, real = window.hkCards.confirmSheet;
    window.hkCards.confirmSheet = function (text, ok, opts) { asked = { text: text, ok: ok, opts: opts }; };
    pb._listeners.click.forEach(function (f) { f({ stopPropagation: function () {} }); });
    H.eq('off asks first, in red', asked && asked.text === 'Turn off Office?' && asked.opts.destructive === true, true);
    H.eq('...and nothing is switched until it is confirmed', house.calls.length, 0);
    asked.ok();
    H.eq('confirmed: turned off', house.calls.slice(-1)[0], { domain: 'homeassistant', service: 'turn_off', data: { entity_id: 'switch.office_circuit' } });
    card.hass = house.set('switch.office_circuit', 'off');
    H.eq('off: gray, the tile steps back', pb.getAttribute('data-on') === '0' && card._e.card.classList.contains('pwroff'), true);
    asked = null;
    pb._listeners.click.forEach(function (f) { f({ stopPropagation: function () {} }); });
    H.eq('on is one tap, no question', asked === null && house.calls.slice(-1)[0].service === 'turn_on', true);
    window.hkCards.confirmSheet = real;
  },

  function () {
    H.section('hk-rank-card: a car battery (mode: pct, icon_color_steps, label_entity)');
    var house = statHouse(), card = H.make('hk-rank-card');
    card.setConfig({ type: 'custom:hk-rank-card', entity: 'sensor.family_car_battery_level',
      name: 'Family Car', icon: 'hk:battery-high',
      icon_color_steps: [{ above: 60, color: 'green' }, { above: 25, color: 'yellow' }, { color: 'red' }],
      mode: 'pct', label_entity: 'sensor.family_car_battery_range', label_suffix: ' mi range' });
    card.hass = house.hass();
    var R = card._root;
    H.eq('the percentage', H.morphed(H.part(R, '.hero')), '80<span class="unit pct">%</span>');
    H.eq('the range label, rounded', H.part(R, '.label').textContent, '256 mi range');
    var green = H.part(R, '.icon').style.color;
    H.gate('rank (pct)', card, house,
      function () { return house.set('sensor.family_car_battery_range', '241.7'); },  // label_entity
      function () { return house.set('sensor.downstairs_ac_live', '2'); });
    H.eq('the label entity moving redraws the label', H.part(R, '.label').textContent, '242 mi range');
    card.hass = house.set('sensor.family_car_battery_level', '20');
    H.ok('below 25%: the last step (red) replaces green',
         H.part(R, '.icon').style.color !== green && H.part(R, '.icon').style.color !== '',
         H.part(R, '.icon').style.color);
    H.eq('...and the number follows', H.morphed(H.part(R, '.hero')), '20<span class="unit pct">%</span>');
    return H.lifecycle('rank (pct)', card, house, function (c) { c.hass = house.hass(); });
  }
]);
