// Artwork reconnect handling (artWatch) and hkMusic's feeds through the host's
// subscription port (HKClient.subscriptions), never a raw connection. Pins the
// behavior they kept: one listener/subscription per transport, retry with
// backoff, cleanup on replacement, reconnect resubscribe, artwork signature
// invalidation and stale-state marking.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
if (typeof URL !== 'function') {
  globalThis.URL = function (u) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(u); if (!m) throw new Error('bad url'); this.host = m[1]; };
}
location.host = 'ha.example.com';
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-settings.js');
var C = window.hkCards, M = window.hkMusic;
var MZ = 'https://is1-ssl.mzstatic.com/image/thumb/a/1000x1000bb.jpg';
var OFFICE = 'media_player.office_proof';

function transport() {
  var t = { subs: [], ready: [], closed: [], fail: 0 };
  t.subscribeMessage = function (cb, msg, opts) {
    var e = { cb: cb, msg: msg, opts: opts || {} };
    t.subs.push(e);
    if (t.fail > 0) { t.fail--; return Promise.reject({ code: 'unknown_command' }); }
    return Promise.resolve(function () { t.closed.push(msg.type); });
  };
  t.addEventListener = function (name, cb) { if (name === 'ready') t.ready.push(cb); };
  t.removeEventListener = function (name, cb) { t.ready = t.ready.filter(function (f) { return f !== cb; }); };
  t.fire = function () { t.ready.slice().forEach(function (f) { f(); }); };
  t.of = function (type) { return t.subs.filter(function (s) { return s.msg.type === type; }); };
  return t;
}
// A fictional HA-shaped input: callWS records, signs every URL with `tag`.
function hassOn(t, states, ws, tag) {
  return { states: states || {}, connection: t, callWS: function (m) {
    if (ws) ws.push(m);
    if (m.type === 'frontend/set_user_data' && tag === 'refuse') return Promise.reject({ code: 'commands_disabled' });
    var s = {};
    (m.urls || []).forEach(function (u) { s[u] = '/api/hk_frontend/art?u=' + encodeURIComponent(u) + '&authSig=' + (tag || 'X') + ws.length; });
    return Promise.resolve({ signed: s });
  } };
}
// Retry timers (>= 1 s) are held here, so backoff delays can be read and run.
var retries = [], realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms) {
  if (ms >= 1000) { retries.push({ fn: fn, ms: ms }); return 1e6 + retries.length; }
  return realSetTimeout(fn, ms);
};
function runRetries() { var due = retries.splice(0); due.forEach(function (r) { r.fn(); }); return due.map(function (r) { return r.ms; }); }
function art(source, url) { var got = null; C._artSign(source, url, 300, function (p) { got = p; }); return function () { return got; }; }
function signNow() { H.runTimers(1); return H.tick(8); }
var origWarn = console.warn, origError = console.error;
console.warn = function () {};

H.run('MUSIC + ART PORTS', [function () {
  H.section('artwork reconnect handling through the subscription port');
  H.eq('no reconnect yet: stale epoch is 0', C.staleEpoch(), 0);
  var t = transport(), old = { state: 'on' }, ws = [];
  C.seen(hassOn(t, { 'camera.a': old }, ws));
  C.seen(hassOn(t, { 'camera.a': old }, ws));
  H.eq('new snapshots on one transport add one ready listener', t.ready.length, 1);
  var first = art(C.client(), MZ + '?a');
  return signNow().then(function () {
    H.ok('a client signs through its own callWS', ws.length === 1 && ws[0].type === 'hk_frontend/art/sign' && /authSig=X1$/.test(first()), [ws.length, first()]);
    var again = art(C.client(), MZ + '?a');
    H.ok('a kept signature is reused', again() === first() && ws.length === 1);
    t.fire();
    H.eq('ready bumps the stale epoch', C.staleEpoch(), 1);
    H.ok('states held at ready are stale', C.stale(old) === true);
    H.ok('a state the new server sends is not', C.stale({ state: 'on' }) === false);
    C.seen(hassOn(t, { 'camera.a': { state: 'on' } }, ws));
    var after = art(C.client(), MZ + '?a');
    return signNow().then(function () {
      H.ok('ready forgets every kept signature', ws.length === 2 && /authSig=X2$/.test(after()), [ws.length, after()]);
      var t2 = transport();
      C.seen(hassOn(t2, {}, ws));
      H.ok('a replacement transport moves the listener', t.ready.length === 0 && t2.ready.length === 1, [t.ready.length, t2.ready.length]);
      t.fire();
      H.eq('the replaced socket\'s late ready marks nothing', C.staleEpoch(), 1);
      var viaUrl = null;
      C.artUrl(MZ + '?u', 300, function (p) { viaUrl = p; });
      return signNow().then(function () {
        H.ok('artUrl signs through the current client', ws.length === 3 && /authSig=X3$/.test(viaUrl), [ws.length, viaUrl]);
        var direct = null;
        C.artUrl('/local/a.jpg', 300, function (p) { direct = p; });
        H.eq('a same-origin URL is not signed', direct, '/local/a.jpg');
      });
    });
  });
}, function () {
  H.section('music feeds: one pair per transport, writes through the client');
  M._reset();
  var t = transport(), wsA = [], wsB = [];
  M.attach(hassOn(t, {}, wsA));
  M.attach(window.hkHAClient.from(hassOn(t, {}, wsB)));
  return H.tick(12).then(function () {
    H.eq('configuration subscribed once', t.of('hk_music/subscribe').length, 1);
    H.eq('saved focus subscribed once', t.of('frontend/subscribe_user_data').length, 1);
    H.ok('transport auto-resubscribe stays off (ours is the retry)', t.subs.every(function (s) { return s.opts.resubscribe === false; }));
    t.of('hk_music/subscribe')[0].cb({ configured: true, speakers: [{ name: 'Office', entity: OFFICE }] });
    H.ok('configuration arrives through the port', M.configured() && M.speakers().length === 1);
    M.setFocus(OFFICE);
    H.ok('a choice is saved through the newest client on the port', wsB.length === 1 && wsA.length === 0 &&
         wsB[0].type === 'frontend/set_user_data' && wsB[0].value.key === OFFICE, [wsA.length, wsB.length]);
    return H.tick(6);
  }).then(function () {
    t.fire();
    return H.tick(12);
  }).then(function () {
    H.ok('ready resubscribes both feeds once', t.of('hk_music/subscribe').length === 2 && t.of('frontend/subscribe_user_data').length === 2);
    var t2 = transport(), cfgOld = t.of('hk_music/subscribe')[1], focusOld = t.of('frontend/subscribe_user_data')[1];
    M.attach(hassOn(t2, {}, []));
    return H.tick(12).then(function () {
      H.eq('a replacement port closes the old pair', t.closed.slice().sort(), ['frontend/subscribe_user_data', 'hk_music/subscribe']);
      H.eq('...and removes its reconnect listeners', t.ready.length, 0);
      H.ok('the replacement subscribes both feeds', t2.of('hk_music/subscribe').length === 1 && t2.of('frontend/subscribe_user_data').length === 1);
      cfgOld.cb({ configured: true, speakers: [] });
      focusOld.cb({ value: { key: 'media_player.stale', at: 1 } });
      H.ok('old callbacks cannot overwrite current state', M.speakers().length === 1 && M.focus() === OFFICE, [M.speakers().length, M.focus()]);
    });
  });
}, function () {
  H.section('a write refused (Mantel commands disabled) does not jam the screen');
  M._reset();
  var t = transport(), errs = 0;
  console.error = function () { errs++; };
  M.attach(hassOn(t, {}, [], 'refuse'));
  return H.tick(12).then(function () {
    H.ok('setFocus still takes the choice', M.setFocus(OFFICE) === true && M.focus() === OFFICE);
    return H.tick(6);
  }).then(function () {
    console.error = origError;
    H.eq('the refusal is logged once', errs, 1);
    t.of('frontend/subscribe_user_data')[0].cb({ value: { key: 'media_player.other', at: 9 } });
    H.eq('the server copy is followed again after the refusal', M.focus(), 'media_player.other');
  });
}, function () {
  H.section('retry with backoff, through the port');
  M._reset();
  var t = transport();
  t.fail = 14;                                         // both feeds fail 7 times
  M.attach(hassOn(t, {}, []));
  var seen = [];
  function round() { return H.tick(12).then(function () { var d = runRetries(); seen.push(d[0] === d[1] ? d[0] : d); }); }
  var p = Promise.resolve();
  for (var i = 0; i < 7; i++) p = p.then(round);
  return p.then(function () {
    H.eq('failed subscribes back off 1 s doubling to a 30 s cap', seen, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    return H.tick(12);
  }).then(function () {
    H.eq('the eighth try lands for both feeds', t.subs.length, 16);
    H.eq('no retry pending once subscribed', retries.length, 0);
    t.fail = 2;
    t.fire();
    return H.tick(12);
  }).then(function () {
    H.eq('a success resets the backoff: the next failure retries in 1 s', runRetries(), [1000, 1000]);
    t.fail = 2;
    t.fire();
    return H.tick(12);
  }).then(function () {
    var pending = retries.slice(), t2 = transport();
    M.attach(hassOn(t2, {}, []));
    var before = t.subs.length;
    pending.forEach(function (r) { r.fn(); });
    retries.length = 0;
    return H.tick(12).then(function () {
      H.eq('a retry due after replacement does not touch the old transport', t.subs.length, before);
    });
  });
}, function () {
  H.section('fallback without hkSettings: stale feeds are still ignored');
  M._reset();
  var hs = window.hkSettings, a = transport(), b = transport();
  window.hkSettings = undefined;
  M.attach(hassOn(a, {}, []));
  M.attach(hassOn(b, {}, []));
  window.hkSettings = hs;
  return H.tick(6).then(function () {
    b.of('hk_music/subscribe')[0].cb({ configured: true, speakers: [{ name: 'Office', entity: OFFICE }] });
    a.of('hk_music/subscribe')[0].cb({ configured: true, speakers: [] });
    H.eq('the replaced connection\'s late configuration is ignored', M.speakers().length, 1);
  });
}, function () {
  H.section('discovery belongs to the host adapter');
  M._reset();
  var t = transport(), host = window.hkHostClient, qs = document.querySelector;
  var client = window.hkClient.create({ states: {}, subscriptions: window.hkClient.subscriptions(t) });
  window.hkHostClient = { current: function () { return client; }, from: host.from };
  document.querySelector = function () { throw new Error('shared music must not search a host DOM'); };
  window.dispatchEvent(new CustomEvent('hk-host-client-ready'));
  window.dispatchEvent(new CustomEvent('hk-client-update'));
  return H.tick(12).then(function () {
    H.ok('a late host adapter attaches music on a page with no music card',
         t.of('hk_music/subscribe').length === 1 && t.of('frontend/subscribe_user_data').length === 1);
    H.ok('...and artwork reconnect handling', C.client() === client && t.ready.length >= 3);
    window.dispatchEvent(new CustomEvent('hk-client-update'));
    return H.tick(12);
  }).then(function () {
    H.eq('repeated host updates add nothing', t.of('hk_music/subscribe').length, 1);
    window.hkHostClient = host;
    document.querySelector = qs;
    console.warn = origWarn;
    globalThis.setTimeout = realSetTimeout;
  });
}]);
