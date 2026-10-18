// HKClient's first shared surface: state display, formatting and read requests.
// A host owns its transport. Shared cards never receive the host's raw object.
(function (global) {
  'use strict';
  if (global.hkClient) return;
  var made = new WeakSet();
  function create(port) {
    if (!port || typeof port !== 'object') throw new Error('HKClient needs a host port');
    var client = {};
    ['states', 'config', 'locale', 'language', 'user', 'themes', 'subscriptions'].forEach(function (key) {
      Object.defineProperty(client, key, { enumerable: true, get: function () { return port[key]; } });
    });
    ['formatEntityState', 'callWS', 'bindStateIcon'].forEach(function (key) {
      Object.defineProperty(client, key, { enumerable: true, get: function () {
        return typeof port[key] === 'function' ? port[key].bind(port) : undefined;
      } });
    });
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
  global.hkClient = { create: create, subscriptions: subscriptions, is: is };
  try { global.dispatchEvent(new CustomEvent('hk-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
