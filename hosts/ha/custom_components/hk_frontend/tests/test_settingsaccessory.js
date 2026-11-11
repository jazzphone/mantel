// AN ACCESSORY'S OWN PAGE (panels/hk-settings.js a_one), opened first thing (2026-10-31, the owner: "Entry Door",
// found by search, said "The accessory settings couldn't load."). hk-detail.js sets window.hkDetail only once it has
// fetched its panels (web/hk/sheets/), a moment after its own import returns; the page must wait for it to say it is
// up (hk-detail-ready) -- not decide on the spot that it failed -- and say so only when it never comes.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
load(HK_ROOT + '/frontend/panels/hk-settings-kit.js');
load(HK_ROOT + '/frontend/panels/hk-settings-features.js');
(0, eval)(readRunnable(HK_ROOT + '/frontend/panels/hk-settings.js').replace('  var M = null, K = null, h = null, F = null;',
  '  var M = window.hkSettingsModel, K = window.hkSettingsKit, h = K.h, F = window.hkSettingsFeatures; F.use(K);'));
var pass = 0, fail = 0;
function ok(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + '   got ' + g + ', want ' + w); }
}
function drain() { for (var i = 0; i < 40; i++) drainMicrotasks(); }
var P = customElements.get('hk-settings-panel').prototype;
var words = function (n) { var out = []; (function w(e) { if (e._text) out.push(e._text); if (e.textContent && !e.children.length) out.push(e.textContent); (e.children || []).forEach(w); })(n);
  return out.join(' '); };

// what the page has loaded by now -- the settings module, the glyphs, the cards -- but not the sheets (hkDetail)
window.hkSettings = window.hkSettings || { get: function (k, d) { return d; }, onChange: function () {} };
window.customIconsets = { hk: function () {} };
window.hkCards = window.hkCards || {};
delete window.hkDetail;
// a fictional house's garage door sensor, renamed in Settings
var page = Object.create(P);
Object.defineProperty(page, 'client', { value: { states: { 'binary_sensor.garage_door': { entity_id: 'binary_sensor.garage_door', state: 'off', attributes: { friendly_name: 'Entry Door' } } } } });
page.status = function () {}; page.soon = function () {};
var c = document.createElement('div');
P.a_one.call(page, c, 'binary_sensor.garage_door');
drain();
var box = c.children[0];
ok('opened before the sheets are up: it waits, saying nothing yet', [box && box.className, (box && box.children.length) || 0, /couldn.t load/.test(words(c))], ['accwrap', 0, false]);
// ...the sheets come up (hk-detail.js wire())
var drawn = [];
window.hkDetail = { _: { ACC_CSS: '.acc{}', accessoryPane: function (client, id) { drawn.push(id); var e = document.createElement('div'); e.className = 'accpane'; return e; } } };
dispatchEvent(new Event('hk-detail-ready'));
drain();
ok('...and draws the accessory the moment they are', [drawn, box.children.map(function (e) { return e.tagName.toLowerCase() === 'style' ? 'style' : e.className; })],
  [['binary_sensor.garage_door'], ['style', 'accpane']]);
ok('...never the failure', /couldn.t load/.test(words(c)), false);
// another accessory once they are up: at once
var c2 = document.createElement('div');
P.a_one.call(page, c2, 'binary_sensor.garage_door');
drain();
ok('the next page: drawn at once', c2.children[0].children.length, 2);

print(fail ? 'FAIL ' + fail + ' SETTINGS ACCESSORY TESTS' : 'ALL ' + pass + ' SETTINGS ACCESSORY TESTS PASS');
if (fail) throw new Error(fail + ' failed');
