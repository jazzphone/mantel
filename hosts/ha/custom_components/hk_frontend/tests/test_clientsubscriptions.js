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
}]);
