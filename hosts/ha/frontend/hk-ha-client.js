// Only this host adapter passes Home Assistant's raw object to its icon element.
(function (global) {
  'use strict';
  if (global.hkHAClient) return;
  var clients = new WeakMap();
  var hosts = new WeakMap();      // client -> the host object it was made from
  // A RECONNECT'S STALE UNSUBSCRIBE (home-assistant-js-websocket). After a reconnect the library
  // sends each old subscription again under a new id (ids start again on every socket); until
  // that answer arrives, the subscription's unsubscribe still carries its OLD id. An element
  // removed in that window (the view is rebuilt on a reconnect: <ha-menu-button>'s notifications
  // feed) sends unsubscribe_events for the old id on the NEW socket, then deletes that id from the
  // library's table: whichever new subscription now has that number is ended on both sides. In
  // about 2 of 5 upgrades under an open page it was HK's settings feed, left on the restarted
  // server's first, still-empty Status & Chips lists: no chips row until a reload (2026-10-18).
  // So ids never start again: a new socket's first id follows the last one ever given, and a
  // stale id names nothing live. An unsubscribe for an id given before the current socket is
  // held -- not sent (the server never had it), and never settled, so the library's delete after
  // it never runs either.
  var guarded = new WeakSet();
  function guard(conn) {
    if (!conn || typeof conn !== 'object' || guarded.has(conn) || typeof conn._genCmdId !== 'function' ||
        typeof conn.commandId !== 'number' || typeof conn.sendMessagePromise !== 'function') return;
    guarded.add(conn);
    var gen = conn._genCmdId, sendP = conn.sendMessagePromise;
    var last = conn.commandId, socket = conn.socket, floor = 0;   // floor: the last id before this socket
    conn._genCmdId = function () {
      if (this.socket !== socket) { socket = this.socket; floor = last; }
      if (this.commandId < last) this.commandId = last;
      last = gen.call(this);
      return last;
    };
    conn.sendMessagePromise = function (msg) {
      // (a socket no id was given on yet: every id so far is from before it)
      if (msg && msg.type === 'unsubscribe_events' && typeof msg.subscription === 'number' &&
          (this.socket !== socket || msg.subscription <= floor)) return new Promise(function () {});
      return sendP.apply(this, arguments);
    };
  }
  function from(hass) {
    if (!hass || typeof hass !== 'object') return null;
    guard(hass.connection);
    // a client already (a shared caller passing on what it was given): as is
    if (global.hkClient && global.hkClient.is(hass)) return hass;
    if (clients.has(hass)) return clients.get(hass);
    if (!global.hkClient) throw new Error('HKClient has not loaded');
    var port = {};
    ['states', 'entities', 'devices', 'areas', 'floors', 'services', 'config', 'locale', 'language', 'user', 'themes', 'connected'].forEach(function (key) {
      Object.defineProperty(port, key, { get: function () { return hass[key]; } });
    });
    ['formatEntityState', 'formatEntityAttributeValue', 'formatEntityAttributeName', 'callWS', 'callApi'].forEach(function (key) {
      if (typeof hass[key] === 'function') port[key] = function () { return hass[key].apply(hass, arguments); };
    });
    Object.defineProperty(port, 'subscriptions', { get: function () { return global.hkClient.subscriptions(hass.connection); } });
    port.bindStateIcon = function (element, state) { element.hass = hass; element.stateObj = state; };
    // THE ACTION PORT'S HA SIDE: the real call, with the caller's own arguments, on the
    // frontend's object (same service, data, target, notifyOnError, returnResponse; the same
    // WebSocket message). A host input without the method refuses (hkClient), sending nothing.
    port.actions = {};
    if (typeof hass.callService === 'function') {
      port.actions.callService = function () { return hass.callService.apply(hass, arguments); };
    }
    if (typeof hass.callWS === 'function') {
      port.actions.callWS = function (msg) { return hass.callWS(msg); };
    }
    // An authenticated write to HA's HTTP API: the frontend's own fetchWithAuth, same path and init.
    if (typeof hass.fetchWithAuth === 'function') {
      port.actions.request = function () { return hass.fetchWithAuth.apply(hass, arguments); };
    }
    // A dedicated write socket (the doorbell's live talk-back worker): HA's websocket address
    // from the frontend's auth, and its access token read after any refresh of an expired one.
    // Without auth it is "not available here", as before.
    port.actions.liveSocket = function () {
      var auth = hass.auth;
      if (!auth) return Promise.reject(new Error('not available here'));
      var base = (auth.data && auth.data.hassUrl) || global.location.origin;
      var url = base.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/websocket';
      return Promise.resolve(auth.expired && auth.refreshAccessToken ? auth.refreshAccessToken() : null)
        .then(function () { return { url: url, token: function () { return auth.accessToken; } }; });
    };
    var client = global.hkClient.create(port);
    clients.set(hass, client);
    hosts.set(client, hass);
    return client;
  }
  // THE BRIDGE: how a parent hands a child element what goes with a client. The child takes
  // the host's object at its entry -- an element the host draws itself (a hui-card, ha-form, a
  // third-party card) needs exactly that, and an HK card turns it back into this client
  // (entry, below). Shared code passes clients only; the host's object is named only here.
  // A client this adapter did not make is handed over as itself, read-only.
  function bridge(element, client) {
    if (!element || !client) return;
    var host = hosts.get(client);
    if (host) element.hass = host; else element.client = client;
  }
  // THE LOVELACE ENTRY for a shared card that is not an HkBase (hk-row, hk-control, …).
  // The host sets `hass` on a card; the card never sees that object: it gets
  // `_onClient(client)` with this adapter's client for each new one, and reads
  // `this.client`. The getter gives the host (and a parent card) the object back.
  function entry(Ctor) {
    Object.defineProperty(Ctor.prototype, 'hass', {
      configurable: true,
      set: function (input) {
        this._hkInput = input;
        var c = from(input);
        this._hkEntryClient = c;
        var C = global.hkCards;
        if (C && typeof C.seen === 'function') C.seen(input);
        if (typeof this._onClient === 'function') this._onClient(c);
      },
      get: function () { return this._hkInput; }
    });
    if (!Object.prototype.hasOwnProperty.call(Ctor.prototype, 'client')) {
      Object.defineProperty(Ctor.prototype, 'client', {
        configurable: true,
        get: function () { return this._hkEntryClient || null; }
      });
    }
  }
  function current() {
    var root = global.document && typeof document.querySelector === 'function' && document.querySelector('home-assistant');
    return from(root && root.hass);
  }
  global.hkHAClient = { from: from, current: current, bridge: bridge, entry: entry };
  global.hkHostClient = global.hkHAClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
  try { global.dispatchEvent(new CustomEvent('hk-ha-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
