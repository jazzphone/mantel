// The thermostat dial's mode buttons are the modes the THERMOSTAT has
// (hvac_modes), not a fixed four.
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond, got) {
  print((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '   got=' + JSON.stringify(got)));
  cond ? pass++ : fail++;
}
load(root + '/tests/dom.js');
['hk-base', 'hk-tile', 'hk-control'].forEach(function (n) {
  load(root + '/frontend/cards/' + n + '.js');
});

function modes(hvacModes) {
  var C = customElements.get('hk-control-card');
  var c = new C();
  c.setConfig({ type: 'custom:hk-control-card', entity: 'climate.x' });
  // The harness does not parse markup, so the markup is read as written.
  var html = '';
  Object.defineProperty(c.shadowRoot, 'innerHTML', { get: function () { return html; },
                                                     set: function (v) { html = String(v); } });
  var a = { current_temperature: 70, temperature: 68, hvac_action: 'idle', min_temp: 45, max_temp: 90 };
  if (hvacModes) a.hvac_modes = hvacModes;
  c.hass = { states: { 'climate.x': { state: 'heat', attributes: a } }, callService: function () {} };
  var out = [], re = /data-mode="([^"]+)"/g, m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

var ecobee = modes(['heat_cool', 'heat', 'cool', 'off']);
check('a full thermostat keeps the familiar order', ecobee.join() === 'off,heat,cool,heat_cool', ecobee);
var car = modes(['heat_cool', 'off']);
check('a thermostat without heat or cool shows only what it has', car.join() === 'off,heat_cool', car);
var extra = modes(['off', 'heat', 'cool', 'auto', 'dry']);
check('modes beyond the four follow them', extra.join() === 'off,heat,cool,auto,dry', extra);
var none = modes(null);
check('an entity that lists none gets the classic four', none.join() === 'off,heat,cool,heat_cool', none);

// A WATER HEATER ON THE CLIMATE PAGE (hk-thermostat-card, 2026-10-13): its own
// controls, as its sheet has them -- not a thermostat's Off/Heat/Cool/Auto.
(function () {
  var C = customElements.get('hk-thermostat-card'), c = new C(), calls = [];
  c.setConfig({ type: 'custom:hk-thermostat-card', entity: 'water_heater.tank' });
  var html = '';
  Object.defineProperty(c.shadowRoot, 'innerHTML', { get: function () { return html; }, set: function (v) { html = String(v); } });
  var a = { operation_list: ['off', 'eco', 'electric', 'high_demand', 'heat_pump'], operation_mode: 'eco', away_mode: 'off',
            current_temperature: 114.8, temperature: 120, min_temp: 110, max_temp: 140, supported_features: 15 };
  c.hass = { states: { 'water_heater.tank': { state: 'eco', attributes: a } }, callService: function (d, sv, data) { calls.push([d, sv, data]); return Promise.resolve(); } };
  var got = [], re = /data-wh="([^"]+)"/g, m;
  while ((m = re.exec(html))) got.push(m[1]);
  check('a water heater: its own modes, off first', got.join() === 'off,eco,electric,high_demand,heat_pump', got);
  check('...no thermostat modes', html.indexOf('data-mode=') === -1);
  check('...Heat to its setpoint, its mode under it', /Heat to/.test(html) && /120°/.test(html) && />Eco</.test(html), html.slice(0, 200));
  check('...the one it is in is on', /class="segment active" data-wh="eco"/.test(html));
  check('...Away (it has away mode), Home on', /data-wh-away="on"/.test(html) && /class="segment active" data-wh-away="off"/.test(html));
  check('...the high-demand mode in the sheet\'s word', />Demand</.test(html));
  a.supported_features = 3;
  c.hass = { states: { 'water_heater.tank': { state: 'eco', attributes: a } }, callService: function () { return Promise.resolve(); } };
  check('no away mode: no Home / Away', html.indexOf('data-wh-away') === -1);
})();

// hk-control.js is its own Lovelace resource and can run before hk-base.js,
// whose material, palette and escaper it draws with. It must not draw until
// that has run -- a frame from stand-ins would be held by the render gate --
// and must draw as soon as it has.
(function () {
  var saved = window.hkCards;
  var C = customElements.get('hk-control-card');
  var c = new C();
  c.setConfig({ type: 'custom:hk-control-card', entity: 'climate.x', color: 'teal' });
  var html = null;
  Object.defineProperty(c.shadowRoot, 'innerHTML', { get: function () { return html; },
                                                     set: function (v) { html = String(v); } });
  window.hkCards = undefined;
  try {
    c.hass = { states: { 'climate.x': { state: 'heat', attributes: { temperature: 68 } } },
               callService: function () {} };
  } finally { window.hkCards = saved; }
  check('before hk-base.js: nothing drawn', html === null, html);
  dispatchEvent(new Event('hk-cards-ready'));
  check('hk-cards-ready: drawn', html !== null && html.indexOf('tstat') !== -1);
  check('...in the palette\'s accent teal',
        c.style['--hk-accent'] === window.hkCards.PALETTE.accent.teal &&
        c.style['--hk-accent'] === 'rgba(64, 200, 224, 0.96)', c.style['--hk-accent']);
})();

// THE EDITORS offer what the card draws: every control branch, and `bare`
// (applied to every domain) on the thermostat and the slider too.
(function () {
  function fields(tag) {
    var C = customElements.get(tag), probe = C.getConfigElement();
    var EC = customElements.get(String(probe.tagName || '').toLowerCase());
    var ed = EC ? new EC() : probe;
    if (!ed.appendChild) ed.appendChild = function () {};
    ed.hass = { states: {} }; ed.setConfig({ type: 'custom:' + tag });
    var out = [];
    (function walk(list) { (list || []).forEach(function (f) { if (f.schema) walk(f.schema); else out.push(f); }); })(ed._form.schema);
    return out;
  }
  var control = fields('hk-control-card').filter(function (f) { return f.name === 'control'; })[0];
  var offered = control.selector.select.options.map(function (o) { return o.value; }).sort().join(',');
  check('control: every domain the card draws', offered ===
        'climate,media_player,number,select,switch,valve,water_heater', offered);
  ['hk-thermostat-card', 'hk-slider-card', 'hk-media-control-card'].forEach(function (tag) {
    check(tag + ' offers bare', fields(tag).some(function (f) { return f.name === 'bare'; }));
  });
})();

print(fail ? 'FAIL ' + fail + ' THERMOSTAT TESTS' : 'ALL ' + pass + ' THERMOSTAT TESTS PASS');
if (fail) throw new Error('thermostat tests failed');
