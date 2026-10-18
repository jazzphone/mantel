// Artwork through Home Assistant (hk-base.js artSign + art.py): an image on
// another host is loaded from HA's signed /api/hk_frontend/art, because a
// wall tablet with no internet access cannot reach Apple's artwork CDN.
load(HK_ROOT + '/tests/dom.js');
// jsc has no URL; enough of one for artRemote's host test.
globalThis.URL = function (u) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(u); if (!m) throw new Error('bad url'); this.host = m[1]; };
location.host = 'ha.example.com';
load(HK_ROOT + '/frontend/cards/hk-base.js');
var C = window.hkCards;
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function flush() { return new Promise(function (r) { __runTimers(); __resetTimers(); r(); }).then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }); }

var MZ = 'https://is1-ssl.mzstatic.com/image/thumb/a/1000x1000bb.jpg';
print('=== which URLs go through HA ===');
ok('another host goes through HA', C._artRemote(MZ));
ok('Music Assistant\'s own http proxy too (mixed content on https)', C._artRemote('http://192.0.2.10:8095/imageproxy/ab'));
ok('a relative path does not', !C._artRemote('/api/media_player_proxy/x'));
ok('the page\'s own origin does not', !C._artRemote('https://ha.example.com/local/a.jpg'));

print('\n=== one websocket call per paint, and a fallback ===');
var calls = [];
var hass = { callWS: function (m) { calls.push(m); var s = {}; m.urls.forEach(function (u) { s[u] = '/api/hk_frontend/art?u=' + encodeURIComponent(u) + '&s=' + m.size + '&authSig=X'; }); return Promise.resolve({ signed: s }); } };
var got = {};
['a', 'b', 'c'].forEach(function (k) { C._artSign(hass, MZ + '?' + k, 300, function (p) { got[k] = p; }); });
C._artSign(hass, MZ + '?a', 300, function (p) { got.a2 = p; });
flush().then(function () {
  ok('three tiles (and a repeat) cost one call', calls.length === 1 && calls[0].urls.length === 3, calls.map(function (c) { return c.urls.length; }));
  ok('each tile gets its signed path', /^\/api\/hk_frontend\/art\?u=.*&authSig=X$/.test(got.a) && got.a === got.a2, got);
  ok('the size is asked for', calls[0].size === 300 && calls[0].type === 'hk_frontend/art/sign');
  var again = null;
  C._artSign(hass, MZ + '?b', 300, function (p) { again = p; });
  ok('a signed path is reused without another call', again === got.b && calls.length === 1);
  var old = { callWS: function () { return Promise.reject(new Error('unknown command')); } }, direct = null;
  C._artSign(old, MZ + '?z', 300, function (p) { direct = p; });
  return flush().then(function () {
    ok('an HA without the command: the tile loads the URL directly', direct === MZ + '?z', direct);
    var none = null;
    C._artSign(null, MZ, 300, function (p) { none = p; });
    ok('no hass yet: loads the URL directly', none === MZ);
  });
}).then(function () {
  var src = readFile(HK_ROOT + '/frontend/cards/hk-base.js');
  ok('_artImage sends outside URLs through artSign, and only while the tile is still waiting',
     /var put = function \(p\) \{ if \(!done\) \{ signed = p !== url; img\.src = p; \} \};/.test(src) &&
     /if \(artRemote\(url\)\) artSign\(this\._hass, url, sz, put\);/.test(src));

  // A SIGNATURE DIES WITH THE HA THAT MADE IT: HA's signing secret is drawn
  // at start-up and never saved, so every kept path is a 401 after a
  // restart. Driven: the socket's `ready` forgets them all,
  // and an <img> that errors on one gets ONE fresh signature, then gives up.
  print('\n=== signed paths are forgotten when HA restarts ===');
  var n = 0, conn = { l: {}, addEventListener: function (t, f) { (this.l[t] = this.l[t] || []).push(f); },
                      fire: function (t) { (this.l[t] || []).forEach(function (f) { f(); }); } };
  var h2 = { connection: conn, callWS: function (m) {
    n++; var s = {}; m.urls.forEach(function (u) { s[u] = '/api/hk_frontend/art?u=' + encodeURIComponent(u) + '&s=' + m.size + '&authSig=S' + n; });
    return Promise.resolve({ signed: s }); } };
  // Only the batching timer (0 ms): __runTimers would also fire _artImage's
  // 6 s placeholder timeout. Dropped once run, so it is not run twice.
  function sign() { return new Promise(function (r) { __runTimersUnder(1); __resetTimers(); r(); })
                            .then(function () { return Promise.resolve(); }); }
  var A = MZ + '?restart', p1 = null, p2 = null, p3 = null;
  C._artSign(h2, A, 300, function (p) { p1 = p; });
  return sign().then(function () {
    C._artSign(h2, A, 300, function (p) { p2 = p; });
    ok('(signed once, then kept)', /authSig=S1$/.test(p1) && p2 === p1 && n === 1, [p1, p2, n]);
    conn.fire('ready');                                  // the socket came back: HA restarted
    C._artSign(h2, A, 300, function (p) { p3 = p; });
    return sign();
  }).then(function () {
    ok('the socket\'s `ready` forgets every kept path: the next paint signs afresh', n === 2 && /authSig=S2$/.test(p3), [n, p3]);

    var box = document.createElement('div'), B = MZ + '?stale';
    var img = C.HkBase.prototype._artImage.call({ _hass: h2 }, B, box, '<ha-icon></ha-icon>', 300);
    var errs = function () { (img._listeners.error || []).forEach(function (f) { f(); }); };
    return sign().then(function () {
      var first = img.src;
      ok('(the tile loads its signed path)', /authSig=S3$/.test(first), first);
      errs();                                            // 401: a path from before the restart
      return sign().then(function () {
        ok('an <img> that errors on its signed path gets ONE fresh signature', n === 4 && /authSig=S4$/.test(img.src) && box.children.length === 1, [n, img.src]);
        errs();                                          // still failing: the image is really not there
        return sign();
      }).then(function () {
        ok('...and a second error is the placeholder, not another signature (no loop)',
           n === 4 && img.src === '' && box.children.length === 0, [n, img.src, box.children.length]);
      });
    });
  }).then(function () {
    print('\n' + (fail ? 'FAIL ' + fail + ' ART TESTS' : 'ALL ' + pass + ' ART TESTS PASS'));
    if (fail) throw new Error('art tests failed');
  });
});
drainMicrotasks && drainMicrotasks();
