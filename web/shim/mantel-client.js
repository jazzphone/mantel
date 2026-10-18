// Mantel's client port for compatibility snapshots made by hass-shim.js.
// It never imports the HA adapter or gives a host object to a state icon.
(function (global) {
  'use strict';
  var clients = new WeakMap();
  function from(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (clients.has(snapshot)) return clients.get(snapshot);
    var port = {};
    ['states', 'config', 'locale', 'language', 'user', 'themes'].forEach(function (key) {
      Object.defineProperty(port, key, { get: function () { return snapshot[key]; } });
    });
    ['formatEntityState', 'callWS'].forEach(function (key) {
      if (typeof snapshot[key] === 'function') port[key] = function () { return snapshot[key].apply(snapshot, arguments); };
    });
    port.bindStateIcon = function (element, state) { element.stateObj = state; };
    var client = global.hkClient.create(port);
    clients.set(snapshot, client);
    return client;
  }
  global.hkMantelClient = { from: from, kind: 'mantel' };
  global.hkHostClient = global.hkMantelClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
