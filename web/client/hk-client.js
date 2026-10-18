// HKClient's first shared surface: state display, formatting and read requests, plus one
// action port for everything that changes the house.
// A host owns its transport. Shared cards never receive the host's raw object.
(function (global) {
  'use strict';
  if (global.hkClient) return;
  var made = new WeakSet();
  // Read-only surface. Registries (entities/devices/areas/floors) and the service catalog are
  // the host's current maps; nothing here changes the house. `connected`: false while the
  // host's socket is down (undefined when the host cannot say).
  var DATA = ['states', 'entities', 'devices', 'areas', 'floors', 'services',
              'config', 'locale', 'language', 'user', 'themes', 'connected', 'subscriptions'];
  var METHODS = ['formatEntityState', 'formatEntityAttributeValue', 'formatEntityAttributeName',
                 'callWS', 'bindStateIcon'];
  // WRITES AND READS ARE TOLD APART AT THE PORT. Every WebSocket message the shared frontend
  // sends that changes something (the house, HK's settings, a registry, a user's data) is one
  // of these, and goes through `client.actions.callWS`. `client.callWS` is the read path and
  // refuses them before the host. `call_service` (a service call over WebSocket, even one that
  // only answers) is a command, as `actions.callService` is.
  var WRITES = [
    'calendar/event/create', 'calendar/event/delete', 'calendar/event/update',
    'call_service',
    'config/entity_registry/update',
    'config_entries/subentries/delete',
    'frontend/set_user_data',
    'hk_alarm_pin/add', 'hk_alarm_pin/remove', 'hk_alarm_pin/settings/set',
    'hk_clean_areas/settings/set',
    'hk_energy/device/section', 'hk_energy/device/set', 'hk_energy/settings/set',
    'hk_frontend/accessory/into', 'hk_frontend/accessory/order',
    'hk_frontend/accessory/page_order', 'hk_frontend/accessory/room_scenes',
    'hk_frontend/accessory/set', 'hk_frontend/board/favorite', 'hk_frontend/board/set',
    'hk_frontend/calendar/color', 'hk_frontend/chip/remove', 'hk_frontend/chip/save',
    'hk_frontend/dashboard/titled', 'hk_frontend/hidden/also', 'hk_frontend/hidden/set',
    'hk_frontend/screensaver/black', 'hk_frontend/screensaver/touch', 'hk_frontend/settings/set',
    'hk_frontend/setup/done', 'hk_frontend/tablet/act', 'hk_frontend/tablet/add',
    'hk_frontend/tablet/remove', 'hk_frontend/tablet/seen', 'hk_frontend/tablet/set',
    'hk_frontend/talk/live',
    'hk_music/item/remove', 'hk_music/playlist/save', 'hk_music/playlists/order',
    'hk_music/preset/save', 'hk_music/queue_play', 'hk_music/settings/set', 'hk_music/used',
    'hk_notify/item/remove', 'hk_notify/item/save', 'hk_notify/mute', 'hk_notify/settings/set',
    'hk_notify/test',
    'hk_tv/settings/set', 'hk_tv/watching',
    'image/delete',
    'input_select/create',
    'lovelace/config/save', 'lovelace/dashboards/create', 'lovelace/dashboards/delete',
    'lovelace/dashboards/update'
  ];
  var WRITE_SET = Object.create(null);
  WRITES.forEach(function (t) { WRITE_SET[t] = true; });
  // THE SUBSCRIPTION PORT'S ALLOWLIST (Phase 1 slice 7). Every subscription the shared frontend
  // opens is one of these, and each one only reads: a feed of HK's settings, music, schedule and
  // snoozes, the house's events for pop-ups, a weather forecast, the notification list, the user's
  // sidebar data, the cleaning rooms on offer, and a camera's WebRTC offer (viewing signaling:
  // it starts a picture for this page and changes nothing in the house). Anything else, a write
  // above all, is refused before the host with code `not_allowed`. `subscribe_events` is allowed
  // only for the event types in SUBSCRIBE_EVENTS (the whole event bus is not a read we offer).
  var SUBSCRIPTIONS = [
    'camera/webrtc/offer',
    'frontend/subscribe_user_data',
    'hk_clean_areas/subscribe',
    'hk_frontend/events/subscribe', 'hk_frontend/page_headers/subscribe',
    'hk_frontend/settings/subscribe', 'hk_frontend/snooze/subscribe',
    'hk_music/subscribe',
    'persistent_notification/subscribe',
    'subscribe_events',
    'weather/subscribe_forecast'
  ];
  var SUBSCRIBE_EVENTS = ['repairs_issue_registry_updated'];
  var SUB_SET = Object.create(null), EVENT_SET = Object.create(null);
  SUBSCRIPTIONS.forEach(function (t) { SUB_SET[t] = true; });
  SUBSCRIBE_EVENTS.forEach(function (t) { EVENT_SET[t] = true; });
  function subscribable(msg) {
    if (!msg || typeof msg.type !== 'string' || !SUB_SET[msg.type] || WRITE_SET[msg.type]) return false;
    return msg.type !== 'subscribe_events' || (typeof msg.event_type === 'string' && !!EVENT_SET[msg.event_type]);
  }
  function isWrite(msg) { return !!(msg && typeof msg.type === 'string' && WRITE_SET[msg.type]); }
  function disabled() {
    return Object.assign(new Error('commands disabled'), { code: 'commands_disabled' });
  }
  // THE ACTION PORT. A host that can act gives its port `actions` ({callService, callWS,
  // request, liveSocket}) and the call reaches it with exactly the arguments the caller passed
  // (same service, data, target, notifyOnError, returnResponse; same message; same path and
  // init). A host that cannot (Mantel, or a client made from bare data) gets the refusal: nothing
  // is sent, the promise rejects with code `commands_disabled`, and the port's `refused(detail)`
  // hook, if any, is told.
  //  * request(path, init): an authenticated write to the host's HTTP API (the doorbell's
  //    recorded talk-back POST).
  //  * liveSocket(): what a dedicated write socket needs (the doorbell's live talk-back, which
  //    streams `hk_frontend/talk/live` from a worker): resolves {url, token()} once any expired
  //    credentials are refreshed. Refused, nothing is opened.
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
      },
      request: function (path, init) {
        if (!act || typeof act.request !== 'function') {
          return refuse({ kind: 'http', what: String((init && init.method) || 'GET') + ' ' + String(path).split('?')[0] });
        }
        return act.request.apply(act, arguments);
      },
      liveSocket: function () {
        if (!act || typeof act.liveSocket !== 'function') {
          return refuse({ kind: 'socket', what: 'live socket' });
        }
        return act.liveSocket();
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
      // Reads only, and only those on the allowlist above: anything else is refused here and
      // never reaches the transport.
      subscribeMessage: function (callback, message, options) {
        if (!subscribable(message)) {
          return Promise.reject(Object.assign(new Error('HKClient.subscriptions does not offer ' +
            String(message && message.type) + (message && message.type === 'subscribe_events' ? ' ' + String(message.event_type) : '')),
            { code: 'not_allowed' }));
        }
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
                      subscribable: subscribable,
                      DATA: DATA.slice(), METHODS: METHODS.slice(), WRITES: WRITES.slice(),
                      SUBSCRIPTIONS: SUBSCRIPTIONS.slice(), SUBSCRIBE_EVENTS: SUBSCRIBE_EVENTS.slice(),
                      ACTIONS: ['callService', 'callWS', 'request', 'liveSocket'] };
  try { global.dispatchEvent(new CustomEvent('hk-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
