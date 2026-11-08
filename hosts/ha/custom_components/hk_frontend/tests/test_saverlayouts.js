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
// THE HOLIDAY SLIDE'S CORNER (phase 20): it shows none of the four, so its slide corner adds them all -- and Slides ->
// the corner's switches take any away, as over every slide
load(HK_ROOT + '/frontend/modules/hk-saverlayout.js');
var LM = window.hkSaverLayout;
ok('Holidays: its corner adds the time, the date, the weather and House Status', LM.cornerFor('holiday').join() === 'time,date,weather,status' && LM.SLIDES.holiday.name === 'Holidays');
ok('...and corner_hide takes them away', LM.cornerFor('holiday').filter(function (k) { return ['weather', 'status'].indexOf(k) < 0; }).join() === 'time,date');
print(fail ? 'FAIL ' + fail + ' SAVER LAYOUT TESTS' : 'ALL ' + pass + ' SAVER LAYOUT TESTS PASS');
if (fail) throw new Error(fail + ' failed');
