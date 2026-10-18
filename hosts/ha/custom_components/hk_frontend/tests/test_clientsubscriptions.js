// Host discovery, stable subscription ports and settings reconnection without HA DOM access.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
function settle() { var p = Promise.resolve(); for (var i = 0; i < 12; i++) p = p.then(function () {}); return p; }
// calls/closed count the settings feeds; hkMusic's own feeds (hk-base.js,
// pinned in test_musicart.js) attach through the same port and go to `other`.
function transport() {
  var t = { calls: [], ready: [], closed: 0, other: [] };
  t.subscribeMessage = function (cb, msg, opts) {
    H.ok('subscription keeps transport receiver', this === t);
    var settings = /^hk_frontend\//.test(msg.type);
    (settings ? t.calls : t.other).push({ cb: cb, msg: msg, opts: opts });
    return Promise.resolve(function () { if (settings) t.closed++; });
  };
  t.addEventListener = function (name, cb) { if (name === 'ready') t.ready.push(cb); };
  t.removeEventListener = function (name, cb) { t.ready = t.ready.filter(function (fn) { return fn !== cb; }); };
  return t;
}
H.run('CLIENT SUBSCRIPTIONS', [function () {
  var t = transport(), raw = { states: {}, connection: t };
  var a = window.hkHAClient.from(raw), b = window.hkHAClient.from({ states: {}, connection: t });
  H.ok('new snapshots share one subscription identity', a !== b && a.subscriptions === b.subscriptions);
  H.ok('subscription port is frozen and hides transport internals', Object.isFrozen(a.subscriptions) && !a.subscriptions.socket && !a.subscriptions.calls);
  var qs = document.querySelector;
  document.querySelector = function () { return { hass: raw }; };
  H.ok('HA host owns current-client discovery', window.hkHAClient.current() === a);
  document.querySelector = qs;
  raw.connection = transport();
  H.ok('connection replacement changes only the subscription port', a.subscriptions !== b.subscriptions);
  H.eq('missing transport has no subscription port', window.hkClient.subscriptions(null), null);
}, function () {
  var latest = null, t = transport(), next = transport();
  var oldHost = window.hkHostClient, qs = document.querySelector;
  window.hkHostClient = { current: function () { return latest; }, from: oldHost.from };
  document.querySelector = function () { throw new Error('shared settings must not discover a host DOM'); };
  load(HK_ROOT + '/frontend/modules/hk-settings.js');
  var hs = window.hkSettings, events = [], updates = [];
  window.addEventListener('hk-house-event', function (e) { events.push(e.detail); });
  var end = window.hkCards.onClient(function (c) { updates.push(c); });
  latest = window.hkClient.create({ states: {}, subscriptions: window.hkClient.subscriptions(t) });
  window.dispatchEvent(new CustomEvent('hk-host-client-ready'));
  window.dispatchEvent(new CustomEvent('hk-client-update'));
  return settle().then(function () {
    H.eq('late adapter attaches settings and house events once', t.calls.length, 2);
    H.ok('settings uses the host-neutral client hub', window.hkCards.client() === latest && updates.length === 1);
    window.dispatchEvent(new CustomEvent('hk-client-update'));
    H.eq('same snapshot does not repeat client notifications', updates.length, 1);
    t.calls[0].cb({ configured: true, weather: { place: 'First' } });
    H.eq('subscription settings reach the shared module', hs.get('weather.place'), 'First');
    t.calls[1].cb({ type: 'proof' });
    H.eq('house event is relayed', events.length, 1);
    latest = window.hkClient.create({ states: {}, subscriptions: window.hkClient.subscriptions(t) });
    window.dispatchEvent(new CustomEvent('hk-client-update'));
    return settle();
  }).then(function () {
    H.eq('state snapshots do not create extra subscriptions', t.calls.length, 2);
    H.eq('new client snapshot notifies once', updates.length, 2);
    latest = window.hkClient.create({ states: {}, subscriptions: window.hkClient.subscriptions(next) });
    window.dispatchEvent(new CustomEvent('hk-client-update'));
    return settle();
  }).then(function () {
    H.eq('replaced connection closes both old subscriptions', t.closed, 2);
    H.eq('replaced connection removes ready listeners', t.ready.length, 0);
    H.eq('replacement attaches both feeds', next.calls.length, 2);
    t.calls[0].cb({ configured: true, weather: { place: 'Stale' } });
    t.calls[1].cb({ type: 'stale' });
    H.eq('old settings callback cannot overwrite current settings', hs.get('weather.place'), 'First');
    H.eq('old house event is ignored', events.length, 1);
    next.calls[0].cb({ configured: true, weather: { place: 'Second' } });
    H.eq('replacement delivers settings', hs.get('weather.place'), 'Second');
    next.ready.slice().forEach(function (fn) { fn(); });
    return settle();
  }).then(function () {
    H.eq('ready reconnects both subscriptions', next.calls.length, 4);
    H.ok('automatic transport resubscription remains disabled', next.calls[2].opts.resubscribe === false);
    end();
    latest = null;
    window.dispatchEvent(new CustomEvent('hk-client-update'));
    H.eq('lost host closes active subscriptions', next.closed, 2);
    H.eq('unsubscribed client listener stays quiet', updates.length, 3);
    document.querySelector = qs;
    window.hkHostClient = oldHost;
  });
}, function () {
  var resolve, callback, closes = 0, events = 0, ready = [];
  var pending = window.hkClient.subscriptions({
    subscribeMessage: function (cb) {
      callback = cb;
      return new Promise(function (done) { resolve = done; });
    },
    addEventListener: function (name, fn) { ready.push(fn); },
    removeEventListener: function (name, fn) { ready = ready.filter(function (x) { return x !== fn; }); }
  });
  var close = window.hkSettings.subscribe(pending, { type: 'hk_frontend/settings/subscribe' }, function () { events++; });
  return settle().then(function () {
    H.ok('subscription may still be pending at teardown', !!resolve);
    close();
    callback({ stale: true });
    resolve(function () { closes++; });
    return settle();
  }).then(function () {
    H.eq('late subscription resolution is closed', closes, 1);
    H.eq('pending callback after teardown is ignored', events, 0);
    H.eq('pending subscription removes reconnect listener', ready.length, 0);
  });
}, function () {
  H.section('the subscription port offers only its read allowlist (slice 7)');
  var t = transport(), port = window.hkClient.subscriptions(t), codes = [];
  var listed = window.hkClient.SUBSCRIPTIONS.map(function (type) {
    return type === 'subscribe_events' ? { type: type, event_type: 'repairs_issue_registry_updated' } : { type: type };
  });
  listed.forEach(function (m) { port.subscribeMessage(function () {}, m); });
  H.eq('every listed read reaches the transport, unchanged', t.calls.length + t.other.length, listed.length);
  H.ok('no listed subscription is a write', window.hkClient.SUBSCRIPTIONS.every(function (type) { return !window.hkClient.isWrite({ type: type }); }));
  var before = t.calls.length + t.other.length;
  var refused = [{ type: 'call_service', domain: 'light', service: 'turn_on' }, { type: 'hk_notify/mute' },
                 { type: 'proof/subscribe' }, { type: 'subscribe_events' },
                 { type: 'subscribe_events', event_type: 'state_changed' }, null];
  var all = refused.map(function (m) {
    return port.subscribeMessage(function () {}, m).then(function () { codes.push('sent'); }, function (e) { codes.push(e.code); });
  });
  return Promise.all(all).then(function () {
    H.eq('writes, unlisted reads and other event types are refused (not_allowed)', codes.join(), refused.map(function () { return 'not_allowed'; }).join());
    H.eq('and none reached the transport', t.calls.length + t.other.length, before);
  });
}, function () {
  H.section('HA adapter: the talk-back writes reach the frontend (slice 7)');
  var got = [], auth = { data: { hassUrl: 'https://ha.invalid:8123/' }, accessToken: 'old', expired: true,
    refreshAccessToken: function () { auth.accessToken = 'new'; auth.expired = false; return Promise.resolve(); } };
  var raw = { states: {}, auth: auth, callService: function () {}, callWS: function () {},
              fetchWithAuth: function () { got.push([this === raw].concat([].slice.call(arguments))); return Promise.resolve({ ok: true }); } };
  var c = window.hkHAClient.from(raw), init = { method: 'POST', body: 'x' };
  return c.actions.request('/api/hk_frontend/talk?entity_id=media_player.x', init).then(function () {
    H.ok('request: the frontend\'s fetchWithAuth, same receiver, path and init', got.length === 1 && got[0][0] === true &&
         got[0][1] === '/api/hk_frontend/talk?entity_id=media_player.x' && got[0][2] === init);
    return c.actions.liveSocket();
  }).then(function (live) {
    H.eq('liveSocket: HA\'s websocket address from its auth', live.url, 'wss://ha.invalid:8123/api/websocket');
    H.eq('the token read after an expired one is refreshed', live.token(), 'new');
    return window.hkHAClient.from({ states: {}, callService: function () {} }).actions.liveSocket()
      .then(function () { return 'opened'; }, function (e) { return e.message; });
  }).then(function (r) {
    H.eq('no auth: not available here, as before', r, 'not available here');
  });
}, function () {
  H.section('letting go after a restart: the server\'s not_found is no error (slice 7 port)');
  var answers = { old: Promise.reject({ code: 'not_found', message: 'Subscription not found.' }),
                  other: Promise.reject({ code: 'unknown_error' }) };
  answers.old.catch(function () {}); answers.other.catch(function () {});
  var which = 'old';
  var t = { subscribeMessage: function () { return Promise.resolve(function () { return answers[which]; }); },
            addEventListener: function () {}, removeEventListener: function () {} };
  var port = window.hkClient.subscriptions(t), got = [];
  return port.subscribeMessage(function () {}, { type: 'hk_frontend/settings/subscribe' }).then(function (unsub) {
    return unsub().then(function (v) { got.push('resolved:' + v); }, function (e) { got.push('rejected:' + e.code); });
  }).then(function () {
    which = 'other';
    return port.subscribeMessage(function () {}, { type: 'hk_frontend/settings/subscribe' });
  }).then(function (unsub) {
    return unsub().then(function () { got.push('resolved'); }, function (e) { got.push('rejected:' + e.code); });
  }).then(function () {
    H.eq('an unsubscribe the restarted server never knew resolves; any other refusal still rejects',
         got.join(), 'resolved:undefined,rejected:unknown_error');
  });
}, function () {
  H.section('a reconnect\'s stale unsubscribe ends no new subscription (2026-10-18)');
  // home-assistant-js-websocket's Connection, the parts this race runs through, as HA 2026.9
  // ships it (_handleClose, _setSocket, subscribeMessage): ids start again on every socket, an
  // old subscription is sent again on the new one, and until that is answered its unsubscribe
  // keeps the OLD id -- sent on the new socket, then deleted from the new table.
  function Conn() { this.commandId = 1; this.commands = new Map(); this.wire = []; this.socket = { n: 1 }; }
  Conn.prototype._genCmdId = function () { return ++this.commandId; };
  Conn.prototype.sendMessage = function (msg, id) {
    if (!id) id = this._genCmdId();
    msg.id = id;
    this.wire.push({ socket: this.socket.n, type: msg.type, id: id, subscription: msg.subscription });
  };
  Conn.prototype.sendMessagePromise = function (msg) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var id = self._genCmdId();
      self.commands.set(id, { resolve: resolve, reject: reject });
      self.sendMessage(msg, id);
    });
  };
  Conn.prototype.subscribeMessage = function (cb, msg, opts) {
    var self = this, info;
    return new Promise(function (resolve, reject) {
      var id = self._genCmdId();
      info = { resolve: resolve, reject: reject, callback: cb,
               subscribe: !(opts && opts.resubscribe === false) ? function () { return self.subscribeMessage(cb, msg, opts); } : undefined,
               unsubscribe: function () {
                 return self.sendMessagePromise({ type: 'unsubscribe_events', subscription: id })
                   .then(function () { self.commands.delete(id); });
               } };
      self.commands.set(id, info);
      self.sendMessage(msg, id);
    }).then(function () { return function () { return info.unsubscribe(); }; });
  };
  // the server: answers what it was sent on this socket, and drops an unsubscribed id
  Conn.prototype.serve = function () {
    var self = this, live = this.live || (this.live = {});
    this.wire.forEach(function (w) {
      if (w.done || w.socket !== self.socket.n) return;
      w.done = true;
      if (w.type === 'unsubscribe_events') delete live[w.subscription]; else live[w.id] = true;
      var c = self.commands.get(w.id);
      if (c) c.resolve(null);
    });
  };
  Conn.prototype.event = function (id, ev) {           // the server's event, if it still has the id
    var c = this.commands.get(id);
    if (this.live[id] && c && c.callback) c.callback(ev);
  };
  Conn.prototype.reconnect = function () {
    var old = this.commands;
    this.commandId = 1; this.commands = new Map(); this.socket = { n: this.socket.n + 1 }; this.live = {};
    old.forEach(function (info) {
      if (info.subscribe) info.subscribe().then(function (u) { info.unsubscribe = u; info.resolve(); });
    });
  };
  function settle() { var p = Promise.resolve(); for (var i = 0; i < 12; i++) p = p.then(function () {}); return p; }
  // A screen's feeds before the restart: one HK lets go of itself on a reconnect (2), the
  // menu button's notifications (3). After it: the notifications sent again, HK's settings
  // anew -- and the menu button removed before its resubscribe is answered.
  function upgrade(guarded) {
    var conn = new Conn(), got = [], bell, settingsId;
    if (guarded) window.hkHAClient.from({ states: {}, connection: conn });
    var a = conn.subscribeMessage(function () {}, { type: 'hk_frontend/events/subscribe' }, { resubscribe: false });
    var b = conn.subscribeMessage(function () {}, { type: 'persistent_notification/subscribe' });
    conn.serve();
    return Promise.all([a, b]).then(function (u) {
      bell = u[1];
      conn.reconnect();
      var s = conn.subscribeMessage(function (ev) { got.push(ev); }, { type: 'hk_frontend/settings/subscribe' });
      settingsId = conn.commandId;
      bell();                                           // its resubscribe not answered yet
      return settle().then(function () { conn.serve(); return s; });
    }).then(function () {
      return settle();
    }).then(function () {
      conn.event(settingsId, { kinds: { lights: ['light.a'] } });
      return { conn: conn, got: got, settingsId: settingsId };
    });
  }
  return upgrade(false).then(function (r) {
    H.eq('the library alone: the stale unsubscribe names the new settings feed', r.conn.wire.filter(function (w) {
      return w.type === 'unsubscribe_events'; }).map(function (w) { return w.socket + ':' + w.subscription; }).join(), '2:' + r.settingsId);
    H.eq('the library alone: the settings feed hears nothing more', r.got.length, 0);
    return upgrade(true);
  }).then(function (r) {
    H.eq('guarded: no unsubscribe for an old socket\'s id goes out', r.conn.wire.filter(function (w) {
      return w.type === 'unsubscribe_events'; }).length, 0);
    H.ok('guarded: ids go on from the last one given, on the new socket too', r.settingsId > 3);
    H.eq('guarded: the settings feed still hears the server', r.got.length, 1);
    // a subscription of the new socket still lets go for real
    var c = r.conn, p = c.subscribeMessage(function () {}, { type: 'subscribe_events' }), id = c.commandId;
    c.serve();
    return p.then(function (u) {
      u();
      H.ok('guarded: an unsubscribe of this socket goes out', c.wire.some(function (w) {
        return w.type === 'unsubscribe_events' && w.subscription === id; }));
    });
  });
}]);
