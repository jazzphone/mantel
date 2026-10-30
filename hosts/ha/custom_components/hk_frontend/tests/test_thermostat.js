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

(function () {
  var Ctor = customElements.get('hk-control-card'), c = new Ctor();
  c.setConfig({ entity: 'climate.grid' });
  c.setAttribute('size', 'T');
  var html = c._climate({ state: 'heat_cool', attributes: { friendly_name: 'Grid', current_temperature: 71,
    current_humidity: 44, target_temp_low: 68, target_temp_high: 74, hvac_modes: ['off', 'heat', 'cool', 'heat_cool'] } });
  check('tall grid: one reading under the name, the name the way to the sheet, the mode on the face',
        /Currently 71°/.test(html) && !/Humidity/.test(html) && /class="tstat-name"[^>]*data-tstat-details/.test(html) &&
        /class="tstat-act"[^>]*>Auto</.test(html));
  check('tall grid: the name opens the sheet; no undersized mode segments', /data-tstat-details/.test(html) && !/data-mode=/.test(html));
  var renders = 0; c._render = function () { renders++; };
  Object.defineProperty(c, 'client', { configurable: true, value: {} });
  c.attributeChangedCallback('size', 'T', 'L');
  check('a new grid class rebuilds the markup', renders === 1);
  c._dragging = true; c.attributeChangedCallback('size', 'L', 'T');
  check('a class change under a finger waits for pointer release', renders === 1 && c._deferred);
})();

// BIG NUMBER (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase C): a Home Grid
// thermostat block's Style -- the target large, the arrows at its foot, the
// name and room between them; steps by the entity's own, sent 600 ms after
// the last tap through the card's action port.
(function () {
  var C = customElements.get('hk-control-card');
  function big(state, attrs, size, extra) {
    var c = new C(), calls = [], html = '';
    c.setConfig(Object.assign({ type: 'custom:hk-control-card', entity: 'climate.den', style: 'big' }, extra || {}));
    c.setAttribute('size', size || 'L');
    Object.defineProperty(c.shadowRoot, 'innerHTML', { get: function () { return html; }, set: function (v) { html = String(v); } });
    c.hass = { states: { 'climate.den': { state: state, attributes: Object.assign({ friendly_name: 'Thermostat', min_temp: 50, max_temp: 90 }, attrs) } },
               entities: { 'climate.den': { area_id: 'den' } }, areas: { den: { area_id: 'den', name: 'Living Room' } }, devices: {},
               callService: function (d, sv, data) { calls.push([d, sv, data]); return Promise.resolve(); } };
    c.calls = calls; c.html = function () { return html; };
    return c;
  }
  var c = big('heat', { temperature: 68, current_temperature: 66, hvac_modes: ['off', 'heat', 'cool', 'heat_cool'] });
  var html = c.html().split('</style>')[1];
  check('Big Number: the target alone, large, no degree sign, no status line', /<div class="bn" data-big-num[^>]*>68<\/div>/.test(html) && !/tstat-act|tstat-sub|Currently|ring/.test(html), html.slice(0, 300));
  check('...on the panel plate (the dial\'s), not the dial', /<hk-plate class="surface big"/.test(html) && !/data-ring/.test(html));
  check('...the arrows either side of the name and the room', /data-big-step="-1"[\s\S]*<b>Thermostat<\/b><i>Living Room<\/i>[\s\S]*data-big-step="1"/.test(html));
  check('...the name opens the sheet', /class="nm" type="button" data-tstat-details/.test(html));
  check('...the modes are there for a press and hold, the one it is in on', /class="modes"/.test(html) && /class="segment active" type="button" data-mode="heat"/.test(html));
  check('...the dial unless chosen', !/surface big/.test(big('heat', { temperature: 68 }, 'L', { style: undefined }).html()));
  check('...and only on a grid block', !/surface big/.test((function () { var x = big('heat', { temperature: 68 }); x.removeAttribute('size'); x._render(); return x.html(); })()));

  __resetTimers();
  c._bigNudge(1, function (d, sv, data) { c.calls.push([d, sv, data]); });
  check('a step up: by 1 (degrees F, no step of its own), on the face at once', c._hold.single === 69 && /data-big-num[^>]*>69</.test(c.html()), c._hold);
  c._bigNudge(1, function (d, sv, data) { c.calls.push([d, sv, data]); });
  check('...nothing sent while taps keep coming', c.calls.length === 0 && c._hold.single === 70);
  __timers.filter(Boolean).filter(function (t) { return t.ms === 600; }).forEach(function (t) { t.fn(); });
  check('...600 ms after the last: one set_temperature, through the action port', JSON.stringify(c.calls) === JSON.stringify([['climate', 'set_temperature', { temperature: 70 }]]), c.calls);

  var m = big('heat', { temperature: 21.5, target_temp_step: 0.5, min_temp: 7, max_temp: 22 });
  m._bigNudge(1, function () {}); m._bigNudge(1, function () {}); m._bigNudge(1, function () {});
  check('its own step (0.5), held to its range', m._hold.single === 22 && /data-big-num[^>]*>22</.test(m.html()), m._hold);
  m._bigNudge(-1, function () {});
  check('...a half shows its half', /data-big-num[^>]*>21\.5</.test(m.html()), m.html().slice(0, 200));

  var r = big('heat_cool', { target_temp_low: 67, target_temp_high: 73, hvac_modes: ['heat_cool', 'off'] });
  check('heat and cool: both targets, the low one picked (its dot), a drawn dash between', /class="pk sel"[^>]*data-big-pick="low"[^>]*>67<\/button><span class="ds" aria-hidden="true"><\/span><button class="pk"[^>]*data-big-pick="high"[^>]*>73</.test(r.html()) &&
        /surface big range/.test(r.html()), r.html().slice(0, 400));
  r._bigNudge(1, function () {});
  check('...the arrows step the picked one', r._hold.lo === 68 && r._hold.hi === 73, r._hold);
  r._bigPick = 'high'; r._hold = null;
  for (var i = 0; i < 10; i++) r._bigNudge(-1, function () {});
  check('...the high one, never crossing the low', r._hold.hi === 68 && r._hold.lo === 67, r._hold);
  check('...and what goes is both', (function () { var sent = null; r._bigNudge(1, function (d, sv, data) { sent = data; }); __timers.filter(Boolean).filter(function (t) { return t.ms === 600; }).forEach(function (t) { t.fn(); }); return JSON.stringify(sent); })(),
        JSON.stringify({ target_temp_low: 67, target_temp_high: 69 }));

  var o = big('off', { temperature: 68 });
  check('off: Off, and the arrows can\'t be used', /data-big-num[^>]*>Off</.test(o.html()) && (o.html().match(/data-big-step="[^"]+" aria-label="[^"]+" disabled/g) || []).length === 2);
  o._bigNudge(1, function () { throw new Error('sent'); });
  check('...a step sends nothing', !o._hold);
  var t = big('heat', { temperature: 68 }, 'T');
  check('Tall: the same parts (its sizes are the stylesheet\'s)', /surface big/.test(t.html()) && /data-big-step/.test(t.html()));
  var css = c._extraCss();
  check('the measured numbers: the number min(44cqh,44cqw) at 42.7 %, the foot at 86 % 4 % in with 12 px gaps (room for the name), 58 px arrows',
        /\.big \.bn\{[^}]*top:42\.7%[^}]*font-size:min\(44cqh,44cqw\)/.test(css) && /\.big \.ft\{[^}]*left:4%;right:4%;top:86%[^}]*column-gap:12px/.test(css) &&
        /\.big \.ar\{[^}]*width:58px;height:58px/.test(css));
  check('...Tall: min(25cqh,50cqw) at 40 %, 38 px arrows, 17 / 16 text, the foot at 88 %',
        /:host\(\[size=T\]\) \.big \.bn\{font-size:min\(25cqh,50cqw\);top:40%\}/.test(css) && /:host\(\[size=T\]\) \.big \.ft\{[^}]*top:88%/.test(css) &&
        /:host\(\[size=T\]\) \.big \.nm b\{font-size:17px/.test(css) && /:host\(\[size=T\]\) \.big \.nm i\{font-size:16px/.test(css) &&
        /\.big \.nm b\{font-size:21px;font-weight:600;line-height:27px/.test(css) && /\.big \.nm i\{font-style:normal;font-size:20px;font-weight:400/.test(css));
})();

print(fail ? 'FAIL ' + fail + ' THERMOSTAT TESTS' : 'ALL ' + pass + ' THERMOSTAT TESTS PASS');
if (fail) throw new Error('thermostat tests failed');
