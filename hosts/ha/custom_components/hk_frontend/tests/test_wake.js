// The re-render gate and the MODULE WAKE in hk-base.js.
//
// A gated card must redraw when (a) any entity it reads changes, and (b) a
// module it calls finishes loading -- even though no entity changed. (b) is the
// chips' "wrong colour until reload": drawn before hk-tile.js ran, then frozen.
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');
window.customCards = window.customCards || [];
load(DIR + 'frontend/cards/hk-base.js');
load(DIR + 'tests/sample_settings.js');
load(DIR + 'frontend/cards/hk-security.js');
load(DIR + 'frontend/cards/hk-home.js');
var pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (x ? '   ' + x : '')); } }
function S(state, u) { return { state: state, last_updated: u, attributes: {} }; }

// A minimal gated card that counts renders.
var HkBase = window.hkCards.HkBase;
class Probe extends HkBase { _render() { this.renders = (this.renders || 0) + 1; } }
customElements.define('hk-probe-card', Probe);
function probe() {
  var p = Object.create(Probe.prototype);          // skip the shadow-root constructor
  p._config = { entity: 'sensor.a' }; p._root = {}; p.renders = 0;
  p.isConnected = true;
  return p;
}

print('=== the gate ===');
var p = probe();
p.hass = { states: { 'sensor.a': S('1', 't1') } };
ok('first hass renders', p.renders === 1);
p.hass = { states: { 'sensor.a': S('1', 't1') } };
ok('identical hass does not', p.renders === 1);
p.hass = { states: { 'sensor.a': S('2', 't2') } };
ok('a changed entity does', p.renders === 2);

print('\n=== module wake ===');
var q = probe();
q.hass = { states: { 'sensor.a': S('1', 't1') } };
var before = q.renders;
// WeakRef tracking only exists in engines that have it; the GEN half must
// work regardless, so test it directly: a module loads, nothing else changes.
window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkChart' }));
var woke = q.renders > before;
q.hass = { states: { 'sensor.a': S('1', 't1') } };
ok('after hk-module-ready the card redraws (now, or on its next hass)', woke || q.renders === before + 1,
   'renders ' + before + ' -> ' + q.renders);
var after = q.renders;
q.hass = { states: { 'sensor.a': S('1', 't1') } };
ok('...exactly once: the next identical hass is gated again', q.renders === after);

print('\n=== cards that read no entity never redraw on hass ===');
['hk-area-select-card', 'hk-timer-new-card'].forEach(function (tag) {
  var C = customElements.get(tag);
  ok(tag + ' signature is static', C.prototype._sigOf.call({ _hass: { states: {} }, _config: {} }) === 'static');
});

print('\n=== the keypad watches its wrong-code flag ===');
var K = customElements.get('hk-alarm-keypad-card');
function ksig(u) {
  return K.prototype._sigOf.call({ _config: { entity: 'alarm_control_panel.p' },
    _hass: { states: { 'alarm_control_panel.p': S('disarmed', 't1'), 'input_boolean.alarm_keypad_bad_code': S('on', u) } } });
}
ok('bad-code flag flipping changes the signature', ksig('t1') !== ksig('t2'));

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' WAKE TESTS PASS'));
