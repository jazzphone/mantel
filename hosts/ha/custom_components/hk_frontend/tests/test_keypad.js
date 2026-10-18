// hk-alarm-keypad-card: "Wrong code" is BUILT IN -- read from the alarm's own
// refusal -- and the optional indicator still works for silent panels.
load(HK_ROOT + '/tests/dom.js');
window.customCards = window.customCards || [];
load(HK_ROOT + '/tests/sample_settings.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function drain() { for (var i = 0; i < 6; i++) drainMicrotasks(); }
var K = customElements.get('hk-alarm-keypad-card');

function keypad(reply) {
  var k = Object.create(K.prototype);
  k._config = { entity: 'alarm_control_panel.p' };
  k._code = '1234'; k._msg = '';
  k.calls = [];
  k._hass = { states: { 'alarm_control_panel.p': { state: 'armed_away', attributes: {} } },
              callService: function (d, s, data) { k.calls.push([d, s, data]); return reply(); } };
  k._paint = function () {};
  return k;
}
var k1 = keypad(function () { return Promise.reject({ code: 'home_assistant_error', message: 'Invalid alarm code provided' }); });
k1._alarm('alarm_disarm'); drain();
ok('the code is sent to the panel', k1.calls[0][1] === 'alarm_disarm' && k1.calls[0][2].code === '1234');
ok('a refused code shows "Wrong code"', k1._msg === 'Wrong code', k1._msg);
ok('...and the entry is cleared either way', k1._code === '');
clearTimeout(k1._msgT);

var k2 = keypad(function () { return Promise.reject({ message: 'Timeout while contacting the panel' }); });
k2._alarm('alarm_arm_home'); drain();
ok('any other failure says the alarm did not answer', k2._msg === 'Alarm not responding', k2._msg);
clearTimeout(k2._msgT);

var k3 = keypad(function () { return Promise.resolve(); });
k3._alarm('alarm_arm_away'); drain();
ok('an accepted code shows nothing', k3._msg === '');

// A SILENT panel (template panel checking the code itself): the optional
// indicator, turned on by the house's own automation, still reads as wrong.
var k4 = keypad(function () { return Promise.resolve(); });
k4._hass.states['input_boolean.alarm_keypad_bad_code'] = { state: 'on', attributes: {} };
var read = { attrs: {}, setAttribute: function (a, v) { this.attrs[a] = v; }, querySelector: function () { return span; } };
var span = { textContent: '' };
k4._root = { querySelector: function () { return read; } };
delete k4._paint;
K.prototype._paint.call(k4);
ok('the optional indicator still shows "Wrong code"', span.textContent === 'Wrong code' && read.attrs['data-bad'] === '1');

// THE STATUS IN THE READOUT: at rest the readout says what the
// alarm is doing -- the shield and colour of the button that sets it.
var P = window.hkCards.PALETTE.icon;
var st = function (x) { return K.status(x === undefined ? undefined : { state: x, attributes: {} }); };
ok('disarmed: the Disarm button\'s red shield', st('disarmed').icon === 'hk:shield-off' && st('disarmed').color === P.red && st('disarmed').word === 'Disarmed');
ok('armed home: Home\'s blue; away: Away\'s green', st('armed_home').color === P.blue && st('armed_home').icon === 'hk:shield-home' &&
   st('armed_away').color === P.green && st('armed_away').icon === 'hk:shield-lock');
ok('on its way: amber, with an ellipsis', st('arming').color === P.orange && /\u2026$/.test(st('arming').word));
ok('no panel: Unavailable, never a throw', st(undefined).word === 'Unavailable' && st('unavailable').word === 'Unavailable');
function stubRoot() {
  var el = function () { return { attrs: {}, style: {}, textContent: '',
    setAttribute: function (a, v) { this.attrs[a] = String(v); }, getAttribute: function (a) { return this.attrs[a]; } }; };
  var parts = { '.code': el(), '.st ha-icon': el(), '.st span': el() };
  var read = el(); read.querySelector = function (q) { return parts[q]; };
  return { read: read, parts: parts, root: { querySelector: function () { return read; } } };
}
var k5 = keypad(function () { return Promise.resolve(); });
k5._hass.states['alarm_control_panel.p'] = { state: 'armed_away', attributes: {}, last_updated: 't' };
k5._config.entity = 'alarm_control_panel.p'; k5._code = '';
var r5 = stubRoot(); k5._root = r5.root; delete k5._paint;
K.prototype._paint.call(k5);
ok('at rest the readout is the status', r5.read.attrs['data-mode'] === 'status' &&
   r5.parts['.st span'].textContent === 'Armed Away' && r5.parts['.st ha-icon'].attrs.icon === 'hk:shield-lock');
k5._code = '12'; K.prototype._paint.call(k5);
ok('typing puts the code line back', r5.read.attrs['data-mode'] === 'code' && r5.parts['.code'].textContent === '\u2022\u2022');
k5._code = ''; k5._config.status = false; K.prototype._paint.call(k5);
ok('status: false (the alarm sheet) asks for the code', r5.read.attrs['data-mode'] === 'code' && r5.parts['.code'].textContent === 'Enter code');
k5._config.status = undefined; k5._config.boxed = true; K.prototype._paint.call(k5);
ok('boxed (the Security page): the badge says the state, the field asks for the code',
   r5.read.attrs['data-mode'] === 'code' && r5.parts['.code'].textContent === 'Enter code');
k5._config.boxed = false;

// AN ALARM WITH NO CODE: no digits, its own modes, nothing sent as a code
var noCode = function (f) { return { state: 'disarmed', attributes: { code_format: null, supported_features: f } }; };
ok('a panel with no code is codeless', K.codeless(noCode(3)) && !K.codeless({ state: 'disarmed', attributes: { code_format: 'number' } }));
ok('...not while it is unavailable', !K.codeless({ state: 'unavailable', attributes: {} }));
ok('its modes from supported_features, in button order', JSON.stringify(K.modes(noCode(1 | 2 | 4 | 32))) === '["home","away","night","vacation"]');
ok('away only', JSON.stringify(K.modes(noCode(2))) === '["away"]');
ok('not reported: Home and Away', JSON.stringify(K.modes({ state: 'disarmed', attributes: {} })) === '["home","away"]');
var k5 = keypad(function () { return Promise.resolve(); });
k5._codeless = true; k5._code = '';
k5._alarm('alarm_arm_night'); drain();
ok('a codeless arm sends no code at all', k5.calls[0][1] === 'alarm_arm_night' && !('code' in k5.calls[0][2]), k5.calls[0]);

print(fail ? 'FAIL ' + fail + ' KEYPAD TESTS' : 'ALL ' + pass + ' KEYPAD TESTS PASS');
