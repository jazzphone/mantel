// HKClient's first shared surface: state display, formatting and read requests.
// A host owns its transport. Shared cards never receive the host's raw object.
(function (global) {
  'use strict';
  if (global.hkClient) return;
  var made = new WeakSet();
  // Read-only surface. Registries (entities/devices/areas/floors) and the service catalog are
  // the host's current maps; nothing here changes the house.
  var DATA = ['states', 'entities', 'devices', 'areas', 'floors', 'services',
              'config', 'locale', 'language', 'user', 'themes', 'subscriptions'];
  var METHODS = ['formatEntityState', 'formatEntityAttributeValue', 'formatEntityAttributeName',
                 'callWS', 'bindStateIcon'];
  function create(port) {
    if (!port || typeof port !== 'object') throw new Error('HKClient needs a host port');
    var client = {};
    DATA.forEach(function (key) {
      Object.defineProperty(client, key, { enumerable: true, get: function () { return port[key]; } });
    });
    METHODS.forEach(function (key) {
      Object.defineProperty(client, key, { enumerable: true, get: function () {
        return typeof port[key] === 'function' ? port[key].bind(port) : undefined;
      } });
    });
    // REST reads only (the recorder's history/period, for instance). Same call shape as the
    // host's, so shared readers take either; any other method is refused here, before the host.
    Object.defineProperty(client, 'callApi', { enumerable: true, get: function () {
      if (typeof port.callApi !== 'function') return undefined;
      return function (method, path) {
        if (String(method || '').toUpperCase() !== 'GET') return Promise.reject(new Error('HKClient.callApi is read-only'));
        return port.callApi('GET', path);
      };
    } });
    Object.freeze(client);
    made.add(client);
    return client;
  }
  // Shared code that still accepts a legacy host input asks this before adapting it.
  function is(value) { return !!value && typeof value === 'object' && made.has(value); }
  // Stable identity across state snapshots; the host's transport stays private.
  var transports = new WeakMap();
  function subscriptions(transport) {
    if (!transport || typeof transport.subscribeMessage !== 'function') return null;
    if (transports.has(transport)) return transports.get(transport);
    var port = Object.freeze({
      subscribeMessage: function (callback, message, options) {
        return transport.subscribeMessage(callback, message, options);
      },
      addEventListener: function (name, callback) {
        if (typeof transport.addEventListener === 'function') transport.addEventListener(name, callback);
      },
      removeEventListener: function (name, callback) {
        if (typeof transport.removeEventListener === 'function') transport.removeEventListener(name, callback);
      }
    });
    transports.set(transport, port);
    return port;
  }
  global.hkClient = { create: create, subscriptions: subscriptions, is: is, DATA: DATA.slice(), METHODS: METHODS.slice() };
  try { global.dispatchEvent(new CustomEvent('hk-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
