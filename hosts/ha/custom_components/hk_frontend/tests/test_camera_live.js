// hk-camera-live-card: the Cameras page's tiles TAKE TURNS going live
// (2026-10-09). Nine WebRTC connections opened at once never connected in
// desktop Safari (ICE stuck "checking"); three at a time connected every
// time. Each tile shows its still until its turn, the next turn starts as
// soon as a video plays (or LIVE_TURN_MS on), a camera with no picture by
// LIVE_STUCK_MS is opened again, and a page that is left goes back to stills.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
(function () {
  var orig = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = orig(tag);
    if (String(tag).toLowerCase() === 'hui-card' && !el.load) el.load = function () {};
    return el;
  };
  var rm = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  if (!HTMLElement.prototype.remove) HTMLElement.prototype.remove = rm;
  var probe = document.createElement('div');
  if (!probe.remove) Object.getPrototypeOf(probe).remove = rm;
})();
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

var NOW = 1000000; Date.now = function () { return NOW; };
var L = window.hkCameras._live, Card = customElements.get('hk-camera-live-card');
var hass = { states: {} };
function tile(i) {
  var c = new Card();
  c.setConfig({ entity: 'camera.c' + i, aspect_ratio: '16x9', fit_mode: 'cover' });
  c.isConnected = true;
  c.hass = hass;
  c.connectedCallback();
  return c;
}
function liveCfg(c) { return c._liveEl && c._liveEl.config && c._liveEl.config.camera_view; }
function play(c) { c._liveEl.children.push({ tagName: 'VIDEO', readyState: 4, videoWidth: 640, paused: false, children: [] }); }
function tick(ms) { NOW += ms; __runTimers(); }

__resetTimers();
var T = [];
for (var i = 0; i < 5; i++) T.push(tile(i));
ok('every tile starts on its still (camera_view auto)', T.every(function (c) { return c._still && c._still.config.camera_view === 'auto'; }));
ok('...and none is live before the page has queued them all', T.every(function (c) { return !c._liveEl; }));
__runTimers();
var live = T.filter(function (c) { return !!c._liveEl; });
ok('three connect at once, not five', live.length === 3 && live.every(function (c) { return liveCfg(c) === 'live'; }), live.length);
ok('...in page order', T[0]._liveEl && T[1]._liveEl && T[2]._liveEl && !T[3]._liveEl);
ok('...the live card connecting UNDER the still, which stays until it plays', T[0]._still.style.visibility !== 'hidden' &&
   T[0]._liveEl.style.cssText.indexOf('absolute') >= 0 && T[0]._liveEl.style.cssText.indexOf('z-index:0') >= 0 && T[0]._still.style.zIndex === '1');
var vfc = [];
T[0]._liveEl.children.push({ tagName: 'VIDEO', readyState: 4, videoWidth: 640, paused: false, children: [],
                              requestVideoFrameCallback: function (f) { vfc.push(f); } });
tick(250);
ok('a video says it plays: the still stays until a frame is ON SCREEN (Safari went gray in between)',
   T[0]._still.style.visibility !== 'hidden' && vfc.length === 1, vfc.length);
vfc[0](); tick(16); tick(16);
ok('...a frame presented, two drawn: the still goes', T[0]._still.style.visibility === 'hidden');
ok('...and the next tile takes its turn', !!T[3]._liveEl && !T[4]._liveEl);
tick(2600);
ok('no picture after LIVE_TURN_MS: the turn ends anyway, the last tile goes', !!T[4]._liveEl);
var first = T[1]._liveEl;
tick(5600);
ok('no picture by LIVE_STUCK_MS: that camera is opened again', T[1]._liveEl !== first, !!T[1]._liveEl);
ok('...and the playing one is left alone', T[0]._liveEl && T[0]._still.style.visibility === 'hidden');
T[0].isConnected = false; T[0].disconnectedCallback();
ok('the page left: back to its still, out of the queue', !T[0]._liveEl && T[0]._still.style.visibility === '' && L.queue().indexOf(T[0]) < 0 && L.turns().indexOf(T[0]) < 0);
T[0].isConnected = true; T[0].connectedCallback(); __runTimers();
ok('...and on the way back it waits its turn again', L.queue().indexOf(T[0]) >= 0 || L.turns().indexOf(T[0]) >= 0);
T.forEach(function (c) { c.isConnected = false; c.disconnectedCallback(); });
ok('everything gone: no turns left over', L.turns().length === 0, L.turns().length);

print('\n=== a waiting tile shows the last frame kept for its camera ===');
var kept = { 'camera.k0': { d: 'data:image/jpeg;base64,KEPT', t: NOW } }, puts = [];
window.hkCards.snapCache = {
  get: function (id, maxAge) { var h = kept[id]; return h && (!maxAge || NOW - h.t <= maxAge) ? h : null; },
  put: function (id, src, force) { puts.push([id, force]); return 'data:x'; }
};
__resetTimers();
var K0 = new Card(); K0.setConfig({ entity: 'camera.k0' }); K0.isConnected = true; K0.hass = hass; K0.connectedCallback();
var K1 = new Card(); K1.setConfig({ entity: 'camera.k1' }); K1.isConnected = true; K1.hass = hass; K1.connectedCallback();
ok('a kept frame: shown at once over the still', !!K0._frame && K0._frame.src === 'data:image/jpeg;base64,KEPT' &&
   K0._frame.style.cssText.indexOf('absolute') >= 0);
ok('...none kept: none shown (the still as before)', !K1._frame);
K0._still.children.push({ tagName: 'IMG', complete: true, naturalWidth: 640, children: [] });
tick(300);
ok('the still has its picture: the kept frame goes (the still is newer)', !K0._frame);
kept['camera.k2'] = { d: 'data:image/jpeg;base64,OLD', t: NOW - 16 * 60 * 1000 };
var K2 = new Card(); K2.setConfig({ entity: 'camera.k2' }); K2.isConnected = true; K2.hass = hass; K2.connectedCallback();
ok('a frame older than SAVED_MAX_MS is not shown', !K2._frame);
__runTimers();
var playingOne = [K0, K1, K2].filter(function (c) { return !!c._liveEl; })[0];
play(playingOne); tick(250);
var vid = playingOne._liveEl.children[playingOne._liveEl.children.length - 1];
vid.srcObject = { stream: 1 }; vid.pause = function () { this.paused = true; };
playingOne.isConnected = false; playingOne.disconnectedCallback();
// A video taken off the page with its stream still on is kept alive by the
// browser, and its whole card with it: every visit left nine behind.
ok('leaving: the live tile\'s video is let go (paused, its stream dropped)', vid.paused === true && vid.srcObject === null, vid);
ok('a still that loads is kept for next time (not forced: the cache keeps its gap)', puts.some(function (x) { return x[0] === 'camera.k0' && x[1] === false; }), puts);
ok('leaving with the video playing: its frame is kept (forced)', puts.some(function (x) { return x[0] === playingOne._config.entity && x[1] === true; }), puts);
ok('the layers: live card underneath, the still above it, the kept frame on top',
   playingOne._liveEl === null && K1._still.style.zIndex === '1');
[K0, K1, K2].forEach(function (c) { c.isConnected = false; c.disconnectedCallback(); });

// NOBODY CAN SEE THE PAGE: a tablet put to sleep on the Cameras page let go
// of nothing -- every tile kept decoding under the photos or the black.
__resetTimers();
var R = [tile(10), tile(11)];
__runTimers();
ok('rest: both tiles live to start with', R.every(function (c) { return !!c._liveEl; }));
var rv = R.map(function (c) { play(c); var v = c._liveEl.children[c._liveEl.children.length - 1]; v.srcObject = { s: 1 }; v.pause = function () { this.paused = true; }; return v; });
window.dispatchEvent(new CustomEvent('hk-saver-covered'));
ok('rest: the photos cover the page -- every live tile lets go of its stream, back on its still',
   R.every(function (c) { return !c._liveEl && c._still.style.visibility !== 'hidden'; }) && rv.every(function (v) { return v.paused && v.srcObject === null; }));
window.dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
__runTimers();
ok('rest: the photos gone -- they take turns going live again', R.every(function (c) { return !!c._liveEl; }));
window.dispatchEvent(new CustomEvent('hk-black', { detail: { on: true } }));
ok('rest: under a black screen too', R.every(function (c) { return !c._liveEl; }));
window.dispatchEvent(new CustomEvent('hk-black', { detail: { on: false } }));
__runTimersUnder(1000);
ok('rest: ...and not straight back as the black lifts (the wake draws the page first)', R.every(function (c) { return !c._liveEl; }));
__runTimers(); __runTimers();
ok('rest: ...but a moment after', R.every(function (c) { return !!c._liveEl; }));
R.forEach(function (c) { c.isConnected = false; c.disconnectedCallback(); });
window.dispatchEvent(new CustomEvent('hk-saver-covered'));
ok('rest: a tile taken off the page no longer listens', R.every(function (c) { return !c._liveEl && !c._restOff; }));
print(fail ? 'FAIL ' + fail + ' CAMERA LIVE TESTS' : 'ALL ' + pass + ' CAMERA LIVE TESTS PASS');
