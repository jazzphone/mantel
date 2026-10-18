// Exercise the real layout entry points; rendered geometry lives in
// tools/headless/saver_layout_e2e.py because the DOM shim has no CSS engine.
if (typeof HK_ROOT === 'undefined') throw new Error('Run through tests/run');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-saver-energy.js');
load(HK_ROOT + '/frontend/modules/hk-saver-weather.js');
El.prototype.getBoundingClientRect = function () { return { width: 0, height: 0 }; };
Object.defineProperty(El.prototype, 'childNodes', { get: function () { return this.children; } });
var pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; print('PASS ' + n); } else { fail++; print('FAIL ' + n); } }
[window.hkSaverEnergy, window.hkSaverWeather].forEach(function (mod, i) {
  var ctl = mod.create(), e = ctl.el, name = i ? 'Weather' : 'Energy';
  ctl.layout(860, 800);
  ok(name + ': calendar width stacks without portrait', e.hasAttribute('narrow') && !e.hasAttribute('tall'));
  ok(name + ': tablet height keeps a larger scale', Number(e.style.getPropertyValue('--z')) > .95);
  ctl.layout(1280, 800);
  ok(name + ': full width restores landscape', !e.hasAttribute('narrow') && !e.hasAttribute('tall'));
  ok(name + ': full width keeps design scale', Number(e.style.getPropertyValue('--z')) === 1);
  ctl.layout(402, 874);
  ok(name + ': portrait remains portrait', e.hasAttribute('tall') && !e.hasAttribute('narrow'));
  ctl.layout(880, 800);
  ok(name + ': rotating back restores narrow', e.hasAttribute('narrow') && !e.hasAttribute('tall'));
  ctl.layout(0, 0);
  ok(name + ': unavailable size keeps layout', e.hasAttribute('narrow'));
  ctl.destroy();
});
print(fail ? 'FAIL ' + fail + ' SAVER LAYOUT TESTS' : 'ALL ' + pass + ' SAVER LAYOUT TESTS PASS');
if (fail) throw new Error(fail + ' failed');
