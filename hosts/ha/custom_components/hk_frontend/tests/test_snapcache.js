// THE SNAPSHOT CACHE -- paint the last frame we saw while the fresh one loads.
//
// It exists because of a measurement, not a hunch: a strip of tiles fills in
// over about half a second to two and a half from a cold load, and a single
// /api/camera_proxy still can take 1.6-3.1s straight from UniFi Protect.
// Nothing on the frontend's side makes the camera answer faster, so the only
// way to have a picture at 0ms is to already have one.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');

var C = customElements.get('hk-camera-mosaic-card');
var pass = 0, fail = 0;
function ok(n, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + n + '   ' + g); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + g + '\n          want ' + w); }
}
// (the cache reads storage once and saves when idle: these read it again
// after seeding storage, and save before reading storage back)
var SC = function () { return window.hkCards.snapCache; };
var realSet = localStorage.setItem.bind(localStorage);
localStorage.setItem = function (k, v) { var r = realSet(k, v); if (k === 'hk-snap-v1' && !globalThis.__saving) SC()._reset(); return r; };
function reset() {
  localStorage.clear();
  SC()._reset();
  globalThis.__lsThrows = false;
  globalThis.__canvasTaints = false;
  globalThis.__canvasCalls = [];
  // THE TIMER QUEUE IS PART OF THE SLATE. __runTimers() re-runs EVERY timer
  // ever queued, and the swap waits on an animation frame, so without this
  // each flush would re-fire stale callbacks from earlier cases and push their
  // canvas calls ahead of this one's.
  __resetTimers();
}
// A card stub: _snap and _ageText are prototype methods and read only _config
// and _hass, so they run without the element being constructed.
function card(cfg) {
  var c = Object.create(C.prototype);
  c._config = cfg || {};
  c._hass = { states: {} };
  return c;
}
function fakeImg(w, h) {
  var i = document.createElement('img');
  i.naturalWidth = w; i.naturalHeight = h;
  return i;
}
var KEY = 'hk-snap-v1';
function stored() { globalThis.__saving = true; try { SC()._flush(); } finally { globalThis.__saving = false; } try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }

// The cache functions are not exported -- they are reached through the card,
// which is the only thing that uses them. _snap() reads on build and the load
// callback writes.
print('=== a cold cache paints nothing ===');
reset();
var c1 = card({});
var box1 = c1._snap({ entity: 'camera.front_door' }, 270, 100);
var slot1 = c1._snaps[0];
ok('front is -1 with no cache', slot1.front, -1);
ok('neither image is on', [slot1.imgs[0].className, slot1.imgs[1].className], ['', '']);
ok('no age text', slot1.age ? slot1.age.textContent : '(no age el)', '');

print('\n=== a warm cache paints immediately ===');
reset();
var TEN_MIN = 10 * 60 * 1000;
var when = Date.now() - TEN_MIN;
localStorage.setItem(KEY, JSON.stringify({
  'camera.front_door': { d: 'data:image/jpeg;base64,CACHED', t: when }
}));
var c2 = card({});
c2._snap({ entity: 'camera.front_door' }, 270, 100);
var s2 = c2._snaps[0];
ok('the cached frame is in imgs[1]', s2.imgs[1].src, 'data:image/jpeg;base64,CACHED');
ok('and it is shown', s2.imgs[1].className, 'on');
ok('imgs[0] is left free for the first real load', s2.imgs[0].src, undefined);
// front = 1 matters: _loadSlot targets (front + 1) % 2, so the first real
// load lands on imgs[0] and hard-swaps over the placeholder -- the same path
// a refresh takes, with no second mechanism.
ok('front is 1, so the next load targets imgs[0]', s2.front, 1);
ok('slot.at is the CACHE time, not now', s2.at, when);
// THE AGE LABEL IS WHAT KEEPS THIS HONEST. An old picture with no label is
// worse than a black tile.
ok('the age label says how old it is', s2.age.textContent, '10m');
// The cached frame reaches the screen through the canvas, once it decodes.
globalThis.__blitCalls = [];
s2.imgs[1].naturalWidth = 160; s2.imgs[1].naturalHeight = 90;
s2.imgs[1].onload();
ok('the decoded cached frame is drawn onto the canvas',
   [globalThis.__blitCalls.length, s2.cv.className], [1, 'on']);

print('\n=== a different camera does not get the wrong picture ===');
var c3 = card({});
c3._snap({ entity: 'camera.driveway' }, 270, 100);
ok('uncached camera stays blank', c3._snaps[0].front, -1);

print('\n=== writing: a thumbnail, not the frame ===');
reset();
var c4 = card({});
c4._snap({ entity: 'camera.deck' }, 270, 100);
var s4 = c4._snaps[0];
// Drive the success path the way _loadSlot does.
function succeed(cardObj, slot, img) {
  img.onload = null;
  cardObj._load(img, 'http://x/y.jpg', 10, 0,
    function () { slot.loading[0] = false; },
    function () { slot.front = 0; slot.at = Date.now();
                  if (slot.age) slot.age.textContent = 'now';
                  // this is the line under test, copied from _loadSlot
                  return null; });
}
// Call the writer through a real load instead: build a slot and fire onload.
var im = s4.imgs[0];
im.naturalWidth = 1920; im.naturalHeight = 1080;
c4._loadSlot(s4, 10, 0);
ok('nothing written before the image loads', Object.keys(stored()).length, 0);
// _srcFor needs an entity_picture; without one _loadSlot returns false, so
// drive the callback directly the way the browser would.
reset();
var c5 = card({});
c5._hass = { states: { 'camera.deck': { attributes: { entity_picture: '/api/camera_proxy/camera.deck' } } } };
c5._snap({ entity: 'camera.deck' }, 270, 100);
var s5 = c5._snaps[0];
s5.imgs[0].naturalWidth = 1920; s5.imgs[0].naturalHeight = 1080;
s5.imgs[1].naturalWidth = 1920; s5.imgs[1].naturalHeight = 1080;
ok('_loadSlot fires with an entity_picture', c5._loadSlot(s5, 10, 0), true);
s5.imgs[0].onload();                       // the browser reporting success
__runTimers();                             // the swap waits one frame past decode
ok('one camera stored', Object.keys(stored()), ['camera.deck']);
ok('stored as a data URL', String(stored()['camera.deck'].d).slice(0, 11), 'data:image/');
// 160 wide, height following the source aspect: 1080/1920 * 160 = 90.
// 1080/1920 * 160 = 90.
ok('downscaled to 160px wide', globalThis.__canvasCalls[0], { w: 160, h: 90 });
ok('a portrait source keeps ITS aspect too', (function () {
  reset();
  var c = card({});
  c._hass = { states: { 'camera.p': { attributes: { entity_picture: '/api/camera_proxy/camera.p' } } } };
  c._snap({ entity: 'camera.p' }, 270, 100);
  var s = c._snaps[0];
  s.imgs[0].naturalWidth = 600; s.imgs[0].naturalHeight = 800;
  c._loadSlot(s, 10, 0); s.imgs[0].onload();
  __runTimers();   // the swap waits one frame past decode
  return globalThis.__canvasCalls[0];
})(), { w: 160, h: 213 });

print('\n=== the write is throttled ===');
// A tile refreshes every ~10s. Re-encoding and re-serialising nine cameras
// that often would be ~40KB of synchronous localStorage writes per tick on a
// 4GB tablet, for a placeholder nobody is looking at.
reset();
var c6 = card({});
c6._hass = { states: { 'camera.x': { attributes: { entity_picture: '/api/camera_proxy/camera.x' } } } };
c6._snap({ entity: 'camera.x' }, 270, 100);
var s6 = c6._snaps[0];
[0, 1].forEach(function (i) { s6.imgs[i].naturalWidth = 1920; s6.imgs[i].naturalHeight = 1080; });
c6._loadSlot(s6, 10, 0); s6.imgs[0].onload();
__runTimers();   // the swap waits one frame past decode
var firstT = stored()['camera.x'].t;
globalThis.__canvasCalls = [];
c6._loadSlot(s6, 10, 0); s6.imgs[1].onload();       // a second refresh, moments later
__runTimers();   // the swap waits one frame past decode
ok('the second load does not re-encode', globalThis.__canvasCalls.length, 0);
ok('and the timestamp is unchanged', stored()['camera.x'].t, firstT);
// Past the gap it writes again.
var all = stored(); all['camera.x'].t = Date.now() - 6 * 60 * 1000;
localStorage.setItem(KEY, JSON.stringify(all));
globalThis.__canvasCalls = [];
c6._loadSlot(s6, 10, 0); s6.imgs[0].onload();
__runTimers();   // the swap waits one frame past decode
ok('past the 5 minute gap it writes again', globalThis.__canvasCalls.length, 1);

print('\n=== it never takes the page down ===');
// localStorage THROWS outright in a private window, in a browser set to block
// site data, and during thumbnail capture. A camera strip must survive that.
reset();
globalThis.__lsThrows = true;
ok('a build with storage throwing still returns a box', (function () {
  var c = card({});
  var b = c._snap({ entity: 'camera.q' }, 270, 100);
  return !!b && c._snaps[0].front === -1;
})(), true);
ok('a successful load with storage throwing does not throw', (function () {
  var c = card({});
  c._hass = { states: { 'camera.q': { attributes: { entity_picture: '/api/camera_proxy/camera.q' } } } };
  c._snap({ entity: 'camera.q' }, 270, 100);
  var s = c._snaps[0];
  s.imgs[0].naturalWidth = 1920; s.imgs[0].naturalHeight = 1080;
  c._loadSlot(s, 10, 0);
  try { s.imgs[0].onload(); return true; } catch (e) { return String(e); }
  __runTimers();   // the swap waits one frame past decode
})(), true);
globalThis.__lsThrows = false;

// A cross-origin still would taint the canvas and toDataURL would throw.
// camera_proxy is same-origin so it cannot happen today, but the guard is the
// difference between "no cache" and "no camera strip".
reset();
globalThis.__canvasTaints = true;
ok('a tainted canvas is swallowed', (function () {
  var c = card({});
  c._hass = { states: { 'camera.t': { attributes: { entity_picture: '/api/camera_proxy/camera.t' } } } };
  c._snap({ entity: 'camera.t' }, 270, 100);
  var s = c._snaps[0];
  s.imgs[0].naturalWidth = 1920; s.imgs[0].naturalHeight = 1080;
  c._loadSlot(s, 10, 0);
  try { s.imgs[0].onload(); return Object.keys(stored()).length; } catch (e) { return String(e); }
  __runTimers();   // the swap waits one frame past decode
})(), 0);
globalThis.__canvasTaints = false;

reset();
ok('corrupt stored JSON is ignored, not fatal', (function () {
  localStorage.setItem(KEY, '{not json');
  var c = card({});
  c._snap({ entity: 'camera.z' }, 270, 100);
  return c._snaps[0].front;
})(), -1);
ok('an entry with no data is ignored', (function () {
  reset();
  localStorage.setItem(KEY, JSON.stringify({ 'camera.z': { t: Date.now() } }));
  var c = card({});
  c._snap({ entity: 'camera.z' }, 270, 100);
  return c._snaps[0].front;
})(), -1);
ok('an image with no dimensions is not encoded', (function () {
  reset();
  var c = card({});
  c._hass = { states: { 'camera.n': { attributes: { entity_picture: '/api/camera_proxy/camera.n' } } } };
  c._snap({ entity: 'camera.n' }, 270, 100);
  var s = c._snaps[0];
  s.imgs[0].naturalWidth = 0;                 // a broken image reporting success
  c._loadSlot(s, 10, 0); s.imgs[0].onload();
  __runTimers();   // the swap waits one frame past decode
  return Object.keys(stored()).length;
})(), 0);

print('\n=== the freshness guard (the cameras page) ===');
// The strip shows any age because it draws a LABEL over every tile. The
// cameras page has no label, and a picture of the front door from three hours
// ago presented as live is worse than a black tile. So the page passes a
// maxAge and the strip passes nothing.
reset();
var FRESH = window.hkCards.snapCache.FRESH;
ok('the window is two minutes', FRESH, 2 * 60 * 1000);
function seed(ageMs) {
  localStorage.setItem(KEY, JSON.stringify({
    'camera.door': { d: 'data:image/jpeg;base64,X', t: Date.now() - ageMs } }));
}
seed(30 * 1000);
ok('30s old is fresh enough for the page',
   !!window.hkCards.snapCache.get('camera.door', FRESH), true);
seed(5 * 60 * 1000);
ok('5m old is NOT',
   window.hkCards.snapCache.get('camera.door', FRESH), null);
ok('...but the strip still takes it (no maxAge)',
   !!window.hkCards.snapCache.get('camera.door'), true);
seed(3 * 60 * 60 * 1000);
ok('3h old is refused by the page',
   window.hkCards.snapCache.get('camera.door', FRESH), null);
ok('and the strip still shows it, because its label says 3h',
   !!window.hkCards.snapCache.get('camera.door'), true);
ok('an unknown camera is null either way',
   [window.hkCards.snapCache.get('camera.nope'),
    window.hkCards.snapCache.get('camera.nope', FRESH)], [null, null]);

print('\n=== the thumbnail width ===');
// 160, and the softness is wanted: it reads as a visual identifier of which
// camera is which while the real one loads, and cannot be mistaken for live.
reset();
var c7 = card({});
c7._hass = { states: { 'camera.w': { attributes: { entity_picture: '/api/camera_proxy/camera.w' } } } };
c7._snap({ entity: 'camera.w' }, 270, 100);
var s7 = c7._snaps[0];
s7.imgs[0].naturalWidth = 480; s7.imgs[0].naturalHeight = 270;
c7._loadSlot(s7, 10, 0); s7.imgs[0].onload();
__runTimers();   // the swap waits one frame past decode
ok('encoded at 160 wide', globalThis.__canvasCalls[0], { w: 160, h: 90 });

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed'
                   : 'ALL ' + pass + ' SNAPSHOT CACHE TESTS PASS'));
