// First HKClient slice: data, formatting and icon binding without a host object.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run hkclient');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-stat.js');

H.run('HKCLIENT', [function () {
  var raw = {
    states: { 'sensor.demo': { entity_id: 'sensor.demo', state: '21.4', last_updated: '1',
      attributes: { friendly_name: 'Demo', unit_of_measurement: '°C' } } },
    config: { unit_system: { temperature: '°C' } },
    locale: { language: 'en' },
    formatEntityState: function (st) { H.ok('formatter keeps its host receiver', this === raw); return st.state + ' °C'; },
    callWS: function (msg) { H.ok('read keeps its host receiver', this === raw); return Promise.resolve(msg.type); }
  };
  var first = window.hkHAClient.from(raw);
  H.ok('same host snapshot reuses one facade', first === window.hkHAClient.from(raw));
  H.ok('facade does not expose the raw host object', !('hass' in first) && !('_hass' in first));
  H.eq('HA formatter', first.formatEntityState(raw.states['sensor.demo']), '21.4 °C');
  var icon = {};
  first.bindStateIcon(icon, raw.states['sensor.demo']);
  H.ok('only the HA adapter binds the HA icon', icon.hass === raw && icon.stateObj === raw.states['sensor.demo']);

  var card = H.make('hk-stat-card');
  card.setConfig({ entity: 'sensor.demo', icon: 'mdi:thermometer' });
  var icons = 0;
  var port = {
    states: raw.states,
    config: raw.config,
    bindStateIcon: function (el, state) { icons++; el.stateObj = state; },
    formatEntityState: function (state) { return 'Reading: ' + state.state; }
  };
  card.client = window.hkClient.create(port);
  H.eq('hostless card uses the client formatter', H.part(card._root, '.state').textContent, 'Reading: 21.4');
  H.eq('hostless card preserves caption', H.part(card._root, '.name').textContent, 'Demo');
  H.ok('hostless card never received a raw host object', card.hass == null);
  H.ok('hostless icon delegated to the port', icons > 0);
  H.ok('shared card receives no raw host through the port', !H.part(card._root, '.icon').hass);
  var oldSig = card._sigOf();
  port.states = { 'sensor.demo': { entity_id: 'sensor.demo', state: '22.8', last_updated: '2', attributes: {} } };
  card.client = window.hkClient.create(port);
  H.eq('fresh client state redraws', H.part(card._root, '.state').textContent, 'Reading: 22.8');
  H.ok('metric signature follows the client', card._sigOf() !== oldSig);
  card.setConfig({ entity: 'sensor.demo', value_mode: 'temperature' });
  H.eq('temperature uses the client unit system', H.part(card._root, '.state').textContent, '23°C');
  card.setConfig({ entity: 'sensor.demo' });
  card.client = window.hkClient.create({ states: port.states });
  H.eq('formatter absent keeps existing fallback', H.part(card._root, '.state').textContent, '22.8');
  card.client = window.hkClient.create({ states: {} });
  H.eq('missing state keeps existing empty readout', H.part(card._root, '.state').textContent, '');
  return first.callWS({ type: 'read_demo' }).then(function (result) { H.eq('read result is forwarded', result, 'read_demo'); });
}, function () {
  // Re-load the family with prerequisites absent, then deliver them in a different order.
  var factory = window.hkCreateMetricCard, adapter = window.hkHostClient;
  delete window.hkStat;
  delete window.hkCreateMetricCard;
  delete window.hkHostClient;
  load(HK_ROOT + '/frontend/cards/hk-stat.js');
  H.ok('family waits for definitions', !window.hkStat.HkMetricCard);
  window.hkCreateMetricCard = factory;
  window.dispatchEvent(new CustomEvent('hk-metric-ready'));
  H.ok('one dependency is not enough', !window.hkStat.HkMetricCard);
  window.hkHostClient = adapter;
  window.dispatchEvent(new CustomEvent('hk-host-client-ready'));
  H.ok('ready events complete registration', !!window.hkStat.HkMetricCard);
}]);
