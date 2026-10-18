// hk-battery-strip-card, hk-trace-card, hk-usage-card -- CONSTRUCTED AND
// DRIVEN. The picker entries and editor forms are tested elsewhere; this
// suite tests the cards themselves.
//
// The configs are the ones real dashboards use: the EcoFlow page (the
// battery strip) and the Energy page (the live trace and the Usages
// tiles). The REAL hk-stats.js and hk-charts.js are loaded, against a
// hass whose callWS / callApi answer only when the test says so -- so the
// asynchronous half is exercised too: a card that asked for history renders
// a placeholder, is woken when the answer lands, and a card that LEAVES the
// page while it waits is released (not woken, not held) and redraws when it
// comes back, which is the "stuck on Loading" failure hk-base.js's
// release()/_hkStatsLost pair exists for.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/modules/hk-charts.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');

// Entity ids with the units the real sensors report (the live power
// sensors are kW).
function energyHouse() {
  return H.house({
    'sensor.ecoflow_panel_smart_home_panel_battery_level': ['80', { unit_of_measurement: '%' }],
    'sensor.battery_output_power': ['0.0', { unit_of_measurement: 'kW' }],
    'sensor.ecoflow_stored_energy': ['21.7', { unit_of_measurement: 'kWh' }],
    'number.ecoflow_panel_backup_reserve_level': ['20', { min: 0, max: 100, unit_of_measurement: '%' }],
    'number.ecoflow_panel_charge_limit': ['90', { min: 50, max: 100, unit_of_measurement: '%' }],
    'sensor.main_power_live': ['1.160463', { unit_of_measurement: 'kW', friendly_name: 'Main Power Live' }],
    'sensor.main_power_utility': ['7.673', { unit_of_measurement: 'kWh' }],
    'sensor.upstairs_hvac_run_time': ['3.2', { unit_of_measurement: 'h' }],
    'light.kitchen_table_light': ['off', {}]
  });
}
// A statistics answer the way the recorder gives one: `change` per day.
function statsFor(msg, base) {
  var out = {}, t0 = Date.parse(msg.start_time);
  msg.statistic_ids.forEach(function (id) {
    var rows = [];
    for (var i = 0; i < 14; i++) rows.push({ start: t0 + i * 864e5, change: base + i });
    out[id] = rows;
  });
  return out;
}
function hist(values) {
  var t0 = Date.now() - 3 * 3600e3;
  return [values.map(function (v, i) {
    return { state: String(v), last_changed: new Date(t0 + i * 1800e3).toISOString() };
  })];
}

H.run('ENERGY CARDS', [

  // ---------------------------------------------------- hk-battery-strip-card
  function () {
    H.section('hk-battery-strip-card (the EcoFlow page)');
    H.throws('no entity: the config is refused', function () {
      H.make('hk-battery-strip-card').setConfig({ name: 'x' });
    });
    var house = energyHouse(), card = H.make('hk-battery-strip-card');
    H.noThrow('setConfig with the EcoFlow page config', function () {
      card.setConfig({ type: 'custom:hk-battery-strip-card',
        entity: 'sensor.ecoflow_panel_smart_home_panel_battery_level', name: 'House Battery',
        discharge: 'sensor.battery_output_power', stored: 'sensor.ecoflow_stored_energy',
        reserve: 'number.ecoflow_panel_backup_reserve_level', limit: 'number.ecoflow_panel_charge_limit',
        margin: '4px 3px 0px 3px', tap_action: { action: 'more-info' } });
    });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root, body = H.morphed(H.part(R, '.body'));
    H.eq('name', H.part(R, '.ttl').textContent, 'House Battery');
    H.eq('state of charge', H.part(R, '.soc').textContent, '80%');
    H.eq('stored energy', H.part(R, '.kwh').textContent, '21.7 kWh');
    H.eq('the margin reaches the plate', H.part(R, '.strip2').style.margin, '4px 3px 0px 3px');
    // the House Battery's battery, small (design consolidation 4.1)
    H.ok('the battery is filled to the charge', /class="bat"/.test(body) && /class="fill" style="width:80%"/.test(body), body.slice(0, 200));
    H.ok('...with the reserve and the limit ticked on it', /\* 0\.2\);border-color:#ff9f0a/.test(body) && /\* 0\.9\);border-color:/.test(body));
    H.ok('...still while the house is not drawing on it', body.indexOf('hshim') < 0);

    H.gate('battery strip', card, house,
      function () { return house.set('sensor.ecoflow_panel_smart_home_panel_battery_level', '79'); },
      function () { return house.set('sensor.main_power_live', '2.5'); });
    H.eq('the new charge is drawn', H.part(R, '.soc').textContent, '79%');
    var r0 = card.__renders;
    card.hass = house.set('sensor.battery_output_power', '0.5');
    H.eq('discharge is an input (light runs back through it)', card.__renders - r0, 1);
    H.ok('...at 500 W out', H.morphed(H.part(R, '.body')).indexOf('hshim') >= 0);
    card.hass = house.set('number.ecoflow_panel_charge_limit', '85');
    H.ok('the limit is an input', card.__renders - r0 === 2 && /\* 0\.85\);border-color:/.test(H.morphed(H.part(R, '.body'))));
    // Its signature is STATES, not stamps: an attribute moving on the charge
    // sensor draws nothing new, so it must not redraw.
    r0 = card.__renders;
    card.hass = house.touch('sensor.ecoflow_panel_smart_home_panel_battery_level');
    H.eq('a re-stamped, unchanged charge does not redraw', card.__renders - r0, 0);
    card.hass = house.set('sensor.ecoflow_panel_smart_home_panel_battery_level', 'unavailable');
    H.eq('an unavailable charge reads --%', H.part(R, '.soc').textContent, '--%');
    H.eq('...and draws no capsule', H.morphed(H.part(R, '.body')), '');
    return H.lifecycle('battery strip', card, house, function (c) { c.hass = house.hass(); });
  },

  // ------------------------------------------------------------ hk-trace-card
  function () {
    H.section('hk-trace-card (the Energy page)');
    H.throws('no entity: the config is refused', function () {
      H.make('hk-trace-card').setConfig({ trace: {} });
    });
    var house = energyHouse(), card = H.make('hk-trace-card');
    card.setConfig({ type: 'custom:hk-trace-card', entity: 'sensor.main_power_live',
      trace: { hours: 3, colour: 'orange', title: 'Whole Home Power' }, margin: '12px 3px 0px 3px' });
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root;
    H.eq('title from the config', H.part(R, '.ttl').textContent, 'Whole Home Power');
    H.eq('the window', H.part(R, '.sub').textContent, 'Last 3 hours');
    H.eq('the live value, kW read from the sensor\'s own unit', H.morphed(H.part(R, '.val')),
         '1.16<span class="u">kW</span>');
    H.eq('no line until history arrives', H.morphed(H.part(R, '.body')), '');
    H.eq('one history request, for three hours of this sensor', house.api.map(function (a) {
      return /filter_entity_id=sensor.main_power_live/.test(a.path); }), [true]);

    H.gate('trace', card, house,
      function () { return house.set('sensor.main_power_live', '0.482'); },
      function () { return house.set('light.kitchen_table_light', 'on'); });
    H.eq('the new value is drawn, in watts below 1 kW', H.morphed(H.part(R, '.val')),
         '482<span class="u">W</span>');
    H.eq('a redraw while the request is out does not ask again', house.api.length, 1);

    // History lands while the card is on the page: it is woken and draws.
    H.attach(card);
    var r0 = card.__renders;
    house.api[0].resolve(hist([1.1, 1.3, 0.9, 1.6, 1.2, 1.0, 0.5]));
    return H.tick().then(function () {
      H.eq('the answer wakes the card once', card.__renders - r0, 1);
      H.ok('...and the line is drawn', /<svg/.test(H.morphed(H.part(R, '.body'))),
           H.morphed(H.part(R, '.body')).slice(0, 80));
      H.detach(card);
      return H.lifecycle('trace', card, house, function (c) { c.hass = house.hass(); });
    });
  },

  // A trace that leaves the page with its request in flight.
  function () {
    H.section('hk-trace-card: detached while history is in flight');
    var house = energyHouse(), card = H.make('hk-trace-card');
    card.setConfig({ type: 'custom:hk-trace-card', entity: 'sensor.upstairs_hvac_run_time',
                     trace: { hours: 3 } });
    H.attach(card);
    card.hass = house.hass();
    H.eq('it asked', house.api.length, 1);
    H.detach(card);
    H.ok('detaching released it from hk-stats while it waited', card._hkStatsLost === true);
    var r0 = card.__renders;
    house.api[0].resolve(hist([3, 3.1, 3.2]));
    return H.tick().then(function () {
      H.eq('the answer does not wake a detached card', card.__renders - r0, 0);
      H.attach(card);
      H.eq('re-attaching redraws once, from the cache', card.__renders - r0, 1);
      H.ok('...with the line it missed', /<svg/.test(H.morphed(H.part(card._root, '.body'))));
      H.eq('...and without asking again', house.api.length, 1);
      H.detach(card);
    });
  },

  // ------------------------------------------------------------ hk-usage-card
  function () {
    H.section('hk-usage-card (the Energy page)');
    H.throws('no stat: the config is refused', function () {
      H.make('hk-usage-card').setConfig({ entity: 'sensor.main_power_live' });
    });
    var house = energyHouse(), card = H.make('hk-usage-card');
    card.setConfig({ type: 'custom:hk-usage-card', entity: 'sensor.main_power_live',
      name: 'Whole Home', stat: 'sensor.main_power_utility', opts: { colour: 'orange' },
      tap_action: { action: 'more-info' } });
    var t0 = H.timers();
    H.noThrow('first hass', function () { card.hass = house.hass(); });
    var R = card._root;
    H.ok('the plate is left-aligned (no align: center)', /class="usage"/.test(R.__html));
    H.eq('name', H.part(R, '.nm').textContent, 'Whole Home');
    H.eq('placeholder value while statistics load', H.part(R, '.val').textContent, '--');
    H.eq('...and says so', H.part(R, '.sub').textContent, 'Loading history…');
    H.eq('hk-stats batched the ask (its timer, not the card\'s)', H.timers() - t0, 1);

    H.gate('usage', card, house,
      function () { return house.set('sensor.main_power_live', '2.2'); },
      function () { return house.set('sensor.main_power_utility', '8.1'); });
    // ^ the STATISTIC's own sensor is not an input: the tile reads recorder
    // statistics, which arrive through hk-stats' wake, not through states.

    H.attach(card);
    H.runTimers();
    H.eq('the batch went out as one statistics request', house.ws.map(function (w) {
      return w.msg.type + ' ' + w.msg.statistic_ids.join(); }),
      ['recorder/statistics_during_period sensor.main_power_utility']);
    var r0 = card.__renders;
    house.ws[0].resolve(statsFor(house.ws[0].msg, 5));
    return H.tick().then(function () {
      H.eq('the answer wakes the card once', card.__renders - r0, 1);
      H.ok('...which draws a figure', /kWh/.test(H.part(R, '.val').textContent), H.part(R, '.val').textContent);
      H.ok('...a sentence', H.part(R, '.sub').textContent !== 'Loading history…', H.part(R, '.sub').textContent);
      H.ok('...and the bars', /<svg|<div/.test(H.morphed(H.part(R, '.chart'))));
      H.detach(card);

      var mid = H.make('hk-usage-card');
      mid.setConfig({ type: 'custom:hk-usage-card', entity: 'sensor.main_power_live',
        name: 'Whole Home', stat: 'sensor.main_power_utility', compare: false,
        align: 'center', height: '172px' });
      mid.hass = house.hass();
      H.ok('align: center is the .mid plate', /class="usage mid"/.test(mid._root.__html));
      H.eq('compare: false drops the sentence', H.part(mid._root, '.sub').textContent, '');
      H.eq('height pins the plate', H.part(mid._root, '.usage').style.height, '172px');
      H.eq('cached statistics draw at once, no second request', house.ws.length, 1);
      return H.lifecycle('usage', card, house, function (c) { c.hass = house.hass(); });
    });
  },

  // ------------------------------------------- the picker's starter configs
  // Each card's preview starts on a sensor of the RIGHT kind -- never the
  // first sensor of any kind (a media bitrate drawn as a battery).
  function () {
    H.section('starter configs pick a sensor by kind');
    var house = H.house({
      'sensor.media_bitrate': ['0.51', { unit_of_measurement: 'MB' }],
      'sensor.grid_power': ['1.2', { device_class: 'power', unit_of_measurement: 'kW' }],
      'sensor.dryer_energy_now': ['0.4', { device_class: 'energy', unit_of_measurement: 'kWh' }],
      'sensor.main_energy': ['812', { device_class: 'energy', state_class: 'total_increasing', unit_of_measurement: 'kWh' }],
      'sensor.humidity': ['44', { unit_of_measurement: '%' }],
      'sensor.pack_level': ['77', { device_class: 'battery', unit_of_measurement: '%' }]
    }).hass();
    function stub(tag, h) { return customElements.get(tag).getStubConfig(h); }
    H.eq('usage: an energy total', stub('hk-usage-card', house).stat, 'sensor.main_energy');
    H.eq('trace: a power sensor', stub('hk-trace-card', house).entity, 'sensor.grid_power');
    H.eq('battery strip: a battery sensor', stub('hk-battery-strip-card', house).entity, 'sensor.pack_level');
    var thin = H.house({
      'sensor.media_bitrate': ['0.51', { unit_of_measurement: 'MB' }],
      'sensor.dryer_energy_now': ['0.4', { device_class: 'energy', unit_of_measurement: 'kWh' }],
      'sensor.humidity': ['44', { unit_of_measurement: '%' }]
    }).hass();
    H.eq('usage: any energy sensor when there is no total', stub('hk-usage-card', thin).stat, 'sensor.dryer_energy_now');
    H.eq('battery strip: a % sensor when there is no battery', stub('hk-battery-strip-card', thin).entity, 'sensor.humidity');
    H.eq('trace: the first sensor when there is no power one', stub('hk-trace-card', thin).entity, 'sensor.media_bitrate');
    H.eq('no sensors at all: the placeholder', stub('hk-trace-card', H.house({}).hass()).entity, 'sensor.example');
  },

  // ------------------------------- hk-usage-card: More info without `entity`
  function () {
    H.section('hk-usage-card: More info opens the statistic when there is no entity');
    var house = energyHouse(), card = H.make('hk-usage-card'), opened = [];
    card.setConfig({ type: 'custom:hk-usage-card', stat: 'sensor.main_power_utility',
      tap_action: { action: 'more-info' } });
    card.hass = house.hass();
    card.dispatchEvent = function (ev) { opened.push(ev.detail.entityId); return true; };
    card._act({ action: 'more-info' }, true);
    H.eq('the statistic\'s sensor opens', opened, ['sensor.main_power_utility']);
    H.eq('...and the config is left as it was', card._config.entity, undefined);
    card.setConfig({ type: 'custom:hk-usage-card', stat: 'sensor.main_power_utility',
      entity: 'sensor.main_power_live', tap_action: { action: 'more-info' } });
    card._act({ action: 'more-info' }, true);
    H.eq('an entity, when set, wins', opened[1], 'sensor.main_power_live');
  },

  // ---------------------------------------------------------------- editors
  function () {
    H.section('editors');
    function fields(tag) {
      var C = customElements.get(tag), probe = C.getConfigElement();
      var EC = customElements.get(String(probe.tagName || '').toLowerCase());
      var ed = EC ? new EC() : probe;
      if (!ed.appendChild) ed.appendChild = function () {};
      ed.hass = { states: {} }; ed.setConfig({ type: 'custom:' + tag });
      var out = {};
      (function walk(l) { (l || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
      return out;
    }
    var u = fields('hk-usage-card'), b = fields('hk-battery-strip-card');
    H.eq('usage: Center, US spelling', u.align.selector.select.options.map(function (o) { return o.label; }), ['Left', 'Center']);
    H.eq('battery strip: reserve takes any entity the card can read', b.reserve.selector.entity.filter.domain,
         ['number', 'input_number', 'sensor']);
    H.eq('...and limit', b.limit.selector.entity.filter.domain, ['number', 'input_number', 'sensor']);
  }
]);
