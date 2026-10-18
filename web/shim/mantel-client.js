// Mantel's client port for compatibility snapshots made by hass-shim.js.
// It never imports the HA adapter or gives a host object to a state icon.
(function (global) {
  'use strict';
  var clients = new WeakMap();
  var hosts = new WeakMap();      // client -> the host object it was made from
  function from(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (clients.has(snapshot)) return clients.get(snapshot);
    var port = {};
    ['states', 'entities', 'devices', 'areas', 'floors', 'services', 'config', 'locale', 'language', 'user', 'themes'].forEach(function (key) {
      Object.defineProperty(port, key, { get: function () { return snapshot[key]; } });
    });
    ['formatEntityState', 'formatEntityAttributeValue', 'formatEntityAttributeName', 'callWS', 'callApi'].forEach(function (key) {
      if (typeof snapshot[key] === 'function') port[key] = function () { return snapshot[key].apply(snapshot, arguments); };
    });
    Object.defineProperty(port, 'subscriptions', { get: function () { return global.hkClient.subscriptions(snapshot.connection); } });
    port.bindStateIcon = function (element, state) { element.stateObj = state; };
    // NO ACTIONS. Mantel's commands are disabled: the client's action port refuses every
    // service call and write before anything is sent (the snapshot's own service method is never
    // reached), and says so here so the page can show it.
    port.refused = function (detail) {
      try { global.dispatchEvent(new CustomEvent('hk-command-refused', { detail: detail })); } catch (e) { /* shell tests */ }
    };
    var client = global.hkClient.create(port);
    clients.set(snapshot, client);
    hosts.set(client, snapshot);
    return client;
  }
  // THE COMPATIBILITY BRIDGE (until Phase 1 slices 7 and 9): a card family that still READS
  // the host input (the thermostat and alarm keypad inside sheets, the camera stream, the
  // screensaver's cards, the library card) gets the host object that goes with the client it
  // is shown, and nothing else does. Actions no longer need it: they go through
  // client.actions. A client this adapter did not make is handed over as itself, read-only.
  function bridge(element, client) {
    if (!element || !client) return;
    var host = hosts.get(client);
    if (host) element.hass = host; else element.client = client;
  }
  var latest = null;
  function setCurrent(snapshot) {
    var next = from(snapshot);
    if (next === latest) return;
    latest = next;
    try { global.dispatchEvent(new CustomEvent('hk-client-update')); } catch (e) { /* shell tests */ }
  }
  global.hkMantelClient = { from: from, current: function () { return latest; }, setCurrent: setCurrent, bridge: bridge, kind: 'mantel' };
  global.hkHostClient = global.hkMantelClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
