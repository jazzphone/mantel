// Only this host adapter passes Home Assistant's raw object to its icon element.
(function (global) {
  'use strict';
  if (global.hkHAClient) return;
  var clients = new WeakMap();
  var hosts = new WeakMap();      // client -> the host object it was made from
  function from(hass) {
    if (!hass || typeof hass !== 'object') return null;
    if (clients.has(hass)) return clients.get(hass);
    if (!global.hkClient) throw new Error('HKClient has not loaded');
    var port = {};
    ['states', 'entities', 'devices', 'areas', 'floors', 'services', 'config', 'locale', 'language', 'user', 'themes'].forEach(function (key) {
      Object.defineProperty(port, key, { get: function () { return hass[key]; } });
    });
    ['formatEntityState', 'formatEntityAttributeValue', 'formatEntityAttributeName', 'callWS', 'callApi'].forEach(function (key) {
      if (typeof hass[key] === 'function') port[key] = function () { return hass[key].apply(hass, arguments); };
    });
    Object.defineProperty(port, 'subscriptions', { get: function () { return global.hkClient.subscriptions(hass.connection); } });
    port.bindStateIcon = function (element, state) { element.hass = hass; element.stateObj = state; };
    var client = global.hkClient.create(port);
    clients.set(hass, client);
    hosts.set(client, hass);
    return client;
  }
  // THE COMPATIBILITY BRIDGE (until Phase 1 slices 6 and 9): an element whose own actions
  // still need the host input (a sheet's controls, a card family) gets the host object that
  // goes with the client it is shown, and nothing else does. A client this adapter did not
  // make is handed over as itself, read-only.
  function bridge(element, client) {
    if (!element || !client) return;
    var host = hosts.get(client);
    if (host) element.hass = host; else element.client = client;
  }
  function current() {
    var root = global.document && typeof document.querySelector === 'function' && document.querySelector('home-assistant');
    return from(root && root.hass);
  }
  global.hkHAClient = { from: from, current: current, bridge: bridge };
  global.hkHostClient = global.hkHAClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
  try { global.dispatchEvent(new CustomEvent('hk-ha-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
