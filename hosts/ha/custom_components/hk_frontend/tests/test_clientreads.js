// Phase 1 slice 5: the read-only surface the detail sheets and the screensaver
// read through (registries, the service catalog, attribute formatting, REST
// reads), the host adapter's compatibility bridge for what still acts through
// the host input, and the screensaver modules taking a client. Fictional data;
// no service call reaches anything but a recorder.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run clientreads');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
El.prototype.getBoundingClientRect = function () { return { width: 0, height: 0, top: 0, left: 0 }; };
if (!Object.getOwnPropertyDescriptor(El.prototype, 'childNodes')) {
  Object.defineProperty(El.prototype, 'childNodes', { get: function () { return this.children; } });
}
load(HK_ROOT + '/frontend/modules/hk-saver-energy.js');
load(HK_ROOT + '/frontend/modules/hk-saver-weather.js');
load(HK_ROOT + '/frontend/modules/hk-saverclock.js');

H.run('CLIENT READS', [function () {
  H.section('the read-only surface');
  var calls = [];
  var raw = {
    states: { 'sensor.porch': { entity_id: 'sensor.porch', state: '4', attributes: { friendly_name: 'Porch' } } },
    entities: { 'sensor.porch': { device_id: 'd1' } }, devices: { d1: { area_id: 'porch' } },
    areas: { porch: { name: 'Porch' } }, floors: { ground: { name: 'Ground' } },
    services: { vacuum: { clean_area: {} } },
    connection: { subscribeMessage: function () { return Promise.resolve(function () {}); } },
    formatEntityAttributeValue: function (s, a) { H.ok('attribute value keeps its host receiver', this === raw); return s.attributes[a] + '!'; },
    formatEntityAttributeName: function (s, a) { H.ok('attribute name keeps its host receiver', this === raw); return a.toUpperCase(); },
    callApi: function (method, path) { H.ok('REST read keeps its host receiver', this === raw); calls.push(method + ' ' + path); return Promise.resolve([[{ state: '4' }]]); },
    callService: function () { calls.push('SERVICE'); return Promise.resolve(); }
  };
  var c = window.hkHAClient.from(raw);
  H.ok('registries are the host\'s current maps (by identity)', c.entities === raw.entities && c.devices === raw.devices &&
       c.areas === raw.areas && c.floors === raw.floors);
  H.ok('the service catalog is readable', c.services === raw.services);
  H.eq('attribute value formatting', c.formatEntityAttributeValue(raw.states['sensor.porch'], 'friendly_name'), 'Porch!');
  H.eq('attribute name formatting', c.formatEntityAttributeName(raw.states['sensor.porch'], 'friendly_name'), 'FRIENDLY_NAME');
  H.ok('the client still has no service call and no raw host', !('callService' in c) && !('hass' in c) && !('connection' in c));
  raw.entities = { replaced: true };
  H.ok('a registry replaced on the host is what the client reads next', c.entities === raw.entities);
  var surface = window.hkClient.DATA.concat(window.hkClient.METHODS);
  H.ok('the published surface lists the registries and formatters',
       ['entities', 'devices', 'areas', 'floors', 'services', 'formatEntityAttributeValue', 'formatEntityAttributeName']
         .every(function (k) { return surface.indexOf(k) >= 0; }), surface);
  var refused = null;
  return c.callApi('GET', 'history/period/x').then(function (r) {
    H.ok('a GET reaches the host unchanged', calls[0] === 'GET history/period/x' && Array.isArray(r));
    return c.callApi('POST', 'config/config_entries/flow');
  }).then(function () { refused = false; }, function (e) { refused = e; }).then(function () {
    H.ok('anything but GET is refused before the host', refused && /read-only/.test(refused.message) && calls.length === 1, calls);
    H.ok('a host without REST gives the client none', window.hkHAClient.from({ states: {} }).callApi === undefined);
  });
}, function () {
  H.section('the compatibility bridge (host adapter)');
  var raw = { states: {} }, c = window.hkHAClient.from(raw), el = {};
  window.hkHAClient.bridge(el, c);
  H.ok('an element shown an adapter client gets that client\'s host input', el.hass === raw && !('client' in el));
  var foreign = window.hkClient.create({ states: { 'light.x': { state: 'on' } } }), el2 = {};
  window.hkHAClient.bridge(el2, foreign);
  H.ok('a client the adapter did not make is handed over as itself, read-only', el2.client === foreign && !('hass' in el2));
  var el3 = {};
  window.hkHAClient.bridge(el3, null);
  H.ok('no client: the element is left alone', !('hass' in el3) && !('client' in el3));
  H.ok('the bridge is the current host adapter\'s', window.hkHostClient.bridge === window.hkHAClient.bridge);
}, function () {
  H.section('the screensaver clock takes a client');
  var layer = document.createElement('div');
  var client = window.hkClient.create({ states: { 'sun.sun': { state: 'above_horizon', attributes: {
    next_rising: '2026-10-18T07:10:00', next_setting: '2026-10-17T18:40:00' } } } });
  var ctl = window.hkSaverClock.mount(layer, { style: 'today', drift: false, client: client });
  H.ok('mounted with a client, it offers setClient (not a host setter)', typeof ctl.setClient === 'function' && !ctl.setHass);
  H.noThrow('a new client while it shows', function () { ctl.setClient(window.hkClient.create({ states: {} })); });
  ctl.destroy();
}, function () {
  H.section('Home Energy reads its summary through the client');
  var seen = [], E0 = window.hkEnergy;
  window.hkEnergy = { summary: function (client) { seen.push(client); return null; } };
  var ctl = window.hkSaverEnergy.create({}), client = window.hkClient.create({ states: {} });
  H.ok('no summary yet: not ready', ctl.ready(client) === false);
  H.ok('the summary was asked of the client itself', seen[0] === client);
  H.ok('fresh states arrive through setClient', typeof ctl.setClient === 'function' && !ctl.setHass);
  window.hkEnergy = E0;
  ctl.destroy();
}, function () {
  H.section('the Weather screen: client reads, its forecast on the client\'s subscription port (slice 7)');
  var subs = [], conn = {
    subscribeMessage: function (cb, msg, opts) { subs.push({ msg: msg, opts: opts }); return Promise.resolve(function () {}); },
    addEventListener: function () {}, removeEventListener: function () {}
  };
  var C0 = window.hkCards, HS0 = window.hkSettings;
  // the host object is no longer asked: a connection there must go unused
  var hostConn = { subscribeMessage: function () { throw new Error('the host connection was used'); } };
  window.hkCards = { hass: function () { return { connection: hostConn }; } };
  window.hkSettings = { weatherId: function (st) { return st['weather.home'] ? 'weather.home' : null; }, get: function () { return null; } };
  var ctl = window.hkSaverWeather.create({});
  var none = window.hkClient.create({ states: {}, subscriptions: window.hkClient.subscriptions(conn) });
  H.ok('no weather in the client: nothing to show', ctl.ready(none) === false && subs.length === 0);
  var client = window.hkClient.create({ states: { 'weather.home': { entity_id: 'weather.home', state: 'sunny',
    attributes: { temperature: 71 }, last_updated: new Date().toISOString() } }, subscriptions: window.hkClient.subscriptions(conn) });
  H.ok('a weather in the client: ready', ctl.ready(client) === true);
  H.ok('its forecasts are asked over the client\'s port (same messages and options as before)', subs.length === 2 &&
       subs[0].msg.type === 'weather/subscribe_forecast' && subs[0].msg.entity_id === 'weather.home' && subs[0].opts.resubscribe === false,
       subs.map(function (s) { return s.msg.forecast_type; }));
  H.ok('fresh states arrive through setClient', typeof ctl.setClient === 'function' && !ctl.setHass);
  ctl.destroy();
  window.hkCards = C0; window.hkSettings = HS0;
}]);
