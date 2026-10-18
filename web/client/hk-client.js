// HKClient's first shared surface: state display, formatting and read requests, plus one
// action port for everything that changes the house.
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
  // WRITES AND READS ARE TOLD APART AT THE PORT. Every WebSocket message the shared frontend
  // sends that changes something (the house, HK's settings, a registry, a user's data) is one
  // of these, and goes through `client.actions.callWS`. `client.callWS` is the read path and
  // refuses them before the host. `call_service` (a service call over WebSocket, even one that
  // only answers) is a command, as `actions.callService` is.
  var WRITES = [
    'call_service',
    'calendar/event/create', 'calendar/event/update', 'calendar/event/delete',
    'config/entity_registry/update', 'config_entries/subentries/delete',
    'frontend/set_user_data',
    'hk_alarm_pin/add', 'hk_alarm_pin/remove', 'hk_alarm_pin/settings/set',
    'hk_energy/device/set', 'hk_energy/device/section',
    'hk_frontend/accessory/order', 'hk_frontend/accessory/set',
    'hk_frontend/board/favorite', 'hk_frontend/board/set',
    'hk_frontend/calendar/color',
    'hk_frontend/hidden/also', 'hk_frontend/hidden/set',
    'hk_frontend/screensaver/black', 'hk_frontend/screensaver/touch',
    'hk_frontend/tablet/act', 'hk_frontend/tablet/seen', 'hk_frontend/talk/live',
    'hk_music/item/remove', 'hk_music/playlist/save', 'hk_music/playlists/order',
    'hk_music/preset/save', 'hk_music/queue_play', 'hk_music/used',
    'hk_notify/item/remove', 'hk_notify/item/save', 'hk_notify/mute', 'hk_notify/test',
    'hk_tv/watching',
    'image/delete', 'input_select/create',
    'lovelace/config/save', 'lovelace/dashboards/create', 'lovelace/dashboards/delete',
    'lovelace/dashboards/update'
  ];
  var WRITE_SET = Object.create(null);
  WRITES.forEach(function (t) { WRITE_SET[t] = true; });
  function isWrite(msg) { return !!(msg && typeof msg.type === 'string' && WRITE_SET[msg.type]); }
  function disabled() {
    return Object.assign(new Error('commands disabled'), { code: 'commands_disabled' });
  }
  // THE ACTION PORT. A host that can act gives its port `actions` ({callService, callWS}) and
  // the call reaches it with exactly the arguments the caller passed (same service, data,
  // target, notifyOnError, returnResponse; same message). A host that cannot (Mantel, or a
  // client made from bare data) gets the refusal: nothing is sent, the promise rejects with
  // code `commands_disabled`, and the port's `refused(detail)` hook, if any, is told.
  function actionPort(port) {
    var act = port.actions && typeof port.actions === 'object' ? port.actions : null;
    function refuse(detail) {
      if (typeof port.refused === 'function') {
        try { port.refused(detail); } catch (e) { /* the refusal stands either way */ }
      }
      return Promise.reject(disabled());
    }
    return Object.freeze({
      callService: function (domain, service) {
        if (!act || typeof act.callService !== 'function') {
          return refuse({ kind: 'service', what: domain + '.' + service });
        }
        return act.callService.apply(act, arguments);
      },
      callWS: function (msg) {
        if (!act || typeof act.callWS !== 'function') {
          return refuse({ kind: 'ws', what: String(msg && msg.type) });
        }
        return act.callWS(msg);
      }
    });
  }
  function create(port) {
    if (!port || typeof port !== 'object') throw new Error('HKClient needs a host port');
    var client = {};
    DATA.forEach(function (key) {
      Object.defineProperty(client, key, { enumerable: true, get: function () { return port[key]; } });
    });
    METHODS.forEach(function (key) {
      if (key === 'callWS') return;
      Object.defineProperty(client, key, { enumerable: true, get: function () {
        return typeof port[key] === 'function' ? port[key].bind(port) : undefined;
      } });
    });
    // WebSocket READS. A write message is refused here, before the host: it belongs on
    // `client.actions.callWS`.
    Object.defineProperty(client, 'callWS', { enumerable: true, get: function () {
      if (typeof port.callWS !== 'function') return undefined;
      return function (msg) {
        if (isWrite(msg)) {
          return Promise.reject(Object.assign(new Error('HKClient.callWS is read-only: ' + msg.type + ' goes through client.actions'),
                                              { code: 'read_only' }));
        }
        return port.callWS(msg);
      };
    } });
    // REST reads only (the recorder's history/period, for instance). Same call shape as the
    // host's, so shared readers take either; any other method is refused here, before the host.
    Object.defineProperty(client, 'callApi', { enumerable: true, get: function () {
      if (typeof port.callApi !== 'function') return undefined;
      return function (method, path) {
        if (String(method || '').toUpperCase() !== 'GET') return Promise.reject(new Error('HKClient.callApi is read-only'));
        return port.callApi('GET', path);
      };
    } });
    Object.defineProperty(client, 'actions', { enumerable: true, value: actionPort(port) });
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
  global.hkClient = { create: create, subscriptions: subscriptions, is: is, isWrite: isWrite,
                      DATA: DATA.slice(), METHODS: METHODS.slice(), WRITES: WRITES.slice(),
                      ACTIONS: ['callService', 'callWS'] };
  try { global.dispatchEvent(new CustomEvent('hk-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
