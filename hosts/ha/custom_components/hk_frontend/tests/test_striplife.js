// The camera strip's lifecycle across a detach in the same frame (HA tearing a
// view down or re-laying it out): its first-frame tick must not run on a
// strip that is gone -- it registered the pop-up listener again and fetched
// stills for nobody, holding the card and its decoded snapshots for the life
// of the page (20 strips, 20 listeners, before 2026-09-28).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
(function () { var orig = document.createElement; document.createElement = function (tag) { var el = orig.call(document, tag);
  if (String(tag).toLowerCase() === 'hui-card' && !el.load) el.load = function () {}; return el; }; })();
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
['hk-base', 'hk-tile', 'hk-media', 'hk-cameras'].forEach(function (f) { load(HK_ROOT + '/frontend/cards/' + f + '.js'); });
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var house = H.house({
  'camera.j': ['idle', { friendly_name: 'J', entity_picture: '/api/camera_proxy/camera.j?token=x' }],
  'camera.j2': ['idle', { friendly_name: 'J2', entity_picture: '/api/camera_proxy/camera.j2?token=x' }],
  'input_select.m': ['J', { options: ['J', 'J2'] }]
});
function listeners() { return (__winL['hk-popup-change'] || []).length; }
var C = customElements.get('hk-camera-mosaic-card');
var CFG = { cameras: [{ name: 'J', option: 'J', entity: 'camera.j' }, { name: 'J2', option: 'J2', entity: 'camera.j2' }],
            selector: 'input_select.m' };
var w0 = listeners();
for (var i = 0; i < 20; i++) {
  var c = new C(); c.setConfig(CFG); c.hass = house.hass();
  H.attach(c); H.detach(c);        // gone in the same frame
  H.runTimers(1);                  // ...and the next frame fires
}
ok('20 strips detached in the frame they were attached leave no listener behind', listeners() === w0, listeners() - w0);
var c2 = new C(); c2.setConfig(CFG); c2.hass = house.hass();
H.attach(c2); H.detach(c2); H.runTimers(1); H.attach(c2); H.runTimers(1);
ok('detached, a frame, attached again: one listener, its own', listeners() - w0 === 1, listeners() - w0);
H.detach(c2);
ok('...and none once it leaves for good', listeners() === w0, listeners() - w0);
print(fail ? 'FAIL ' + fail + ' STRIP LIFECYCLE TESTS' : 'ALL ' + pass + ' STRIP LIFECYCLE TESTS PASS');
