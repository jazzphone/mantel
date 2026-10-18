// Only this host adapter passes Home Assistant's raw object to its icon element.
(function (global) {
  'use strict';
  if (global.hkHAClient) return;
  var clients = new WeakMap();
  function from(hass) {
    if (!hass || typeof hass !== 'object') return null;
    if (clients.has(hass)) return clients.get(hass);
    if (!global.hkClient) throw new Error('HKClient has not loaded');
    var port = {};
    ['states', 'config', 'locale', 'language', 'user', 'themes'].forEach(function (key) {
      Object.defineProperty(port, key, { get: function () { return hass[key]; } });
    });
    ['formatEntityState', 'callWS'].forEach(function (key) {
      if (typeof hass[key] === 'function') port[key] = function () { return hass[key].apply(hass, arguments); };
    });
    port.bindStateIcon = function (element, state) { element.hass = hass; element.stateObj = state; };
    var client = global.hkClient.create(port);
    clients.set(hass, client);
    return client;
  }
  global.hkHAClient = { from: from };
  global.hkHostClient = global.hkHAClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
  try { global.dispatchEvent(new CustomEvent('hk-ha-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
