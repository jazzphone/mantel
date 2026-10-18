// hk-campost.js in SAFARI (2026-10-09): Home Assistant's players left as they are.
// WebKit will not start a muted video that is hidden, so hiding it until it
// had a picture left the Cameras page on its posters, no camera live, in
// Safari on a Mac and on an iPhone. Only Android's WebView (test_campost.js)
// draws video outside the page and needs the rule.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
globalThis.navigator = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15' };
globalThis.getComputedStyle = function (e) { return { position: (e.style && e.style.position) || 'static' }; };
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var CFG = { views: [{ path: 'cameras', cards: [{ type: 'picture-entity', entity: 'camera.a', camera_view: 'live' }] },
                    { path: 'lights', cards: [] }] };
window.hkCards = { menu: { config: function () { return CFG; } } };
location.pathname = '/dashboard-home/cameras';
load(HK_ROOT + '/frontend/modules/hk-campost.js');
var P = window.hkCamPost;
function el(tag) {
  return { tagName: tag.toUpperCase(), children: [], style: {}, _l: {}, parentNode: null,
           addEventListener: function (t, f) { (this._l[t] = this._l[t] || []).push(f); } };
}
var video = el('video'); video.readyState = 0; video.videoWidth = 0;
var player = el('ha-web-rtc-player');
player.shadowRoot = { children: [video], querySelector: function (q) { return q === 'video' ? video : null; } };
player.getRootNode = function () { return { host: { stateObj: { entity_id: 'camera.a' } } }; };
player.posterUrl = '/api/camera_proxy/camera.a?token=T';
if (!document.body) document.body = { children: [] };
document.body.children = [player];
window.hkCards.snapCache = { FRESH: 120000, get: function () { return null; },
                             put: function () { return 'data:image/jpeg;base64,LEFT'; } };
P.sweep();
ok('a player whose video has no picture yet: left visible, so Safari will start it', video.style.visibility !== 'hidden', video.style.visibility);
ok('...the video not restyled at all (its WebRTC never delivered a frame with this module on)', !video.style.zIndex && !video.style.position && !video.__hkQuiet, [video.style.zIndex, video.style.position]);
ok('...and nothing painted on the player (HA\'s own poster only)', !player.style.background && !player.__hkCv, player.style.background);
// a fresh cached frame is still HA's poster, as before 2026-10-09
var video2 = el('video'), player2 = el('ha-web-rtc-player');
player2.shadowRoot = { children: [video2], querySelector: function (q) { return q === 'video' ? video2 : null; } };
player2.getRootNode = function () { return { host: { stateObj: { entity_id: 'camera.b' } } }; };
window.hkCards.snapCache.get = function (id) { return id === 'camera.b' ? { d: 'data:image/jpeg;base64,FRESH', t: Date.now() } : null; };
document.body.children = [player2];
P.sweep();
ok('a fresh cached frame: HA\'s poster, and no canvas or background of ours', player2.posterUrl === 'data:image/jpeg;base64,FRESH' && !player2.style.background && !player2.__hkCv);
document.body.children = [player];
video.readyState = 4; video.videoWidth = 1280;
location.pathname = '/dashboard-home/lights';
dispatchEvent({ type: 'location-changed' });
ok('leaving the page: the video not hidden, nothing painted', video.style.visibility !== 'hidden' && !video.__hkLeft && !player.style.background, video.style.visibility);
document.body.children = [];
print(fail ? 'FAIL ' + fail + ' CAMPOST SAFARI TESTS' : 'ALL ' + pass + ' CAMPOST SAFARI TESTS PASS');
