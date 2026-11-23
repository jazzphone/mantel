// THE LAUNDRY BLOCK IN THE KIT (round 12, the owner: "I'd like to use the animations we have created ... but wanted to just make it more in
// line with the new style", "I don't want separate little tiles", "we have one machine that does both Washing and Drying. Is the card setup
// to support that?"): which machines a block draws (hkLaundry.shown), the keys a machine offers (keys), the readings under its steps (facts),
// and the plate the kit draws -- ONE plate with a hairline between two machines, the plate itself for one (a washer-dryer, or a house with
// one), the drawing animated by what it does, the steps as bars, the keys as kit keys. A fictional house: nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run laundry_kit');
load(HK_ROOT + '/tests/fixed_clock.js');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/tests/give.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

var MACHINES = [];
window.hkSettings = {
  version: 1,
  get: function (path, fb) { return path === 'features.laundry' ? MACHINES : fb; },
  tablet: function () { return null; },
  subscribe: function () { return function () {}; }
};
load(HK_ROOT + '/frontend/modules/hk-stats.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/modules/hk-kit.js');
load(HK_ROOT + '/frontend/cards/hk-laundry-card.js');
var ok = H.ok, eq = H.eq, L = window.hkLaundry;

// the cell a block sits in: a square (196 x 196, a 13 px gap), through getComputedStyle as the Home Grid's view measures it
var VARS = { '--hk-cell-w': 196, '--hk-cell-h': 196, '--g-gap': 13 };
globalThis.getComputedStyle = function () {
  return { getPropertyValue: function (k) { return VARS[k] === undefined ? '' : String(VARS[k]); }, getPropertyPriority: function () { return ''; } };
};

var NOW = Date.now(), iso = function (min) { return new Date(NOW + min * 60000).toISOString(); };
function machine(id, name, kind) {
  return { id: id, name: name, kind: kind, watts: 10, status: 'sensor.' + id + '_state', phase: 'sensor.' + id + '_job', time: 'sensor.' + id + '_end',
           progress: null, door: null, remote: 'binary_sensor.' + id + '_remote', leak: null, power: 'sensor.' + id + '_power', running: null };
}
// a machine's states and its device's pause and stop (the registry says they are one device's)
function rows(id, state, step, min, extra) {
  var r = {};
  r['sensor.' + id + '_state'] = [state, { options: ['pause', 'run', 'stop'], device_class: 'enum' }];
  r['sensor.' + id + '_job'] = [step, { options: ['wash', 'rinse', 'spin', 'drying', 'cooling', 'finish', 'none'], device_class: 'enum' }];
  r['sensor.' + id + '_end'] = [min ? iso(min) : 'unknown', { device_class: 'timestamp' }];
  r['binary_sensor.' + id + '_remote'] = ['on', {}];
  r['button.' + id + '_pause'] = ['unknown', {}];
  r['button.' + id + '_stop'] = ['unknown', {}];
  r['sensor.' + id + '_power'] = [state === 'run' ? '412' : '0', { unit_of_measurement: 'W', device_class: 'power' }];
  r['select.' + id + '_water_temperature'] = ['warm', { options: ['cold', 'warm', 'hot'] }];
  return Object.assign(r, extra || {});
}
function drawn(size, hassObj) {
  var c = H.make('hk-grid-laundry-card');
  c.setAttribute('size', size);
  c.setConfig({ type: 'custom:hk-grid-laundry-card' });
  hkGive(c, hassObj);
  c._render();
  return c;
}
function hassOf(rowsList, held) {
  var all = {};
  rowsList.forEach(function (r) { Object.assign(all, r); });
  if (held) all['sensor.laundry_done'] = ['on', { machines: held }];
  var h = H.house(all).hass();
  h.areas = {}; h.floors = {}; h.devices = {};
  h.entities = {};
  Object.keys(all).forEach(function (id) { var m = /^[a-z_]+\.([a-z]+)_/.exec(id); h.entities[id] = { device_id: 'dev_' + (m ? m[1] : 'x') }; });
  return h;
}
function count(s, re) { return (s.match(re) || []).length; }

var WASHER = machine('washer', 'Washer', 'washer'), DRYER = machine('dryer', 'Dryer', 'dryer'), COMBO = machine('combo', 'Washer & Dryer', 'combo');

H.run('LAUNDRY IN THE KIT', [
function () {
  H.section('what a block draws of the machines: Small the one that needs you; one machine is one, more than two are two');
  MACHINES = [WASHER, DRYER];
  var cl = window.hkHostClient.from(hassOf([rows('washer', 'run', 'rinse', 24), rows('dryer', 'stop', 'finish', 0)], { dryer: { since: Math.floor(NOW / 1000) - 600, words: 'Done' } }));
  var all = L.lookAll(cl);
  eq('both machines looked at', all.map(function (o) { return o.id + ':' + o.state; }), ['washer:rinsing', 'dryer:done']);
  eq('Small: the Done one, though the washer is first', L.shown(all, 'S').map(function (o) { return o.id; }), ['dryer']);
  eq('Wide: both, in the house\'s order', L.shown(all, 'W').map(function (o) { return o.id; }), ['washer', 'dryer']);
  var run = window.hkHostClient.from(hassOf([rows('washer', 'run', 'rinse', 24), rows('dryer', 'run', 'drying', 50)]));
  eq('Small with both running: the one done soonest', L.shown(L.lookAll(run), 'S').map(function (o) { return o.id; }), ['washer']);
  var three = all.concat([Object.assign({}, all[0], { id: 'extra', state: 'off', runs: false })]);
  eq('three machines: the one most worth a look, then the next most', L.shown(three, 'L').map(function (o) { return o.id; }), ['dryer', 'washer']);
  MACHINES = [COMBO];
  var one = window.hkHostClient.from(hassOf([rows('combo', 'run', 'drying', 38)]));
  eq('one machine: one, whatever the size', ['S', 'W', 'T', 'L', 'XL'].map(function (z) { return L.shown(L.lookAll(one), z).length; }), [1, 1, 1, 1, 1]);
  eq('...a washer-dryer has Wash, Rinse, Spin and Dry (hk_core\'s table: its cooling is Dry), Dry the one it is in',
     L.lookAll(one)[0].steps.map(function (s) { return s.key + (s.now ? '*' : s.done ? '+' : ''); }), ['wash+', 'rinse+', 'spin+', 'dry*']);
  eq('...none at all: nothing', L.shown([], 'W'), []);
},
function () {
  H.section('the keys a machine offers: Clear on a held Done; Pause and Stop while it runs; Resume while paused; none while it waits to start');
  MACHINES = [WASHER, DRYER];
  var held = { dryer: { since: Math.floor(NOW / 1000) - 600, words: 'Done' } };
  var cl = window.hkHostClient.from(hassOf([rows('washer', 'run', 'rinse', 24), rows('dryer', 'stop', 'finish', 0)], held));
  var all = L.lookAll(cl);
  eq('running: Pause, Stop', L.keys(cl, all[0]), [{ k: 'pause', name: 'Pause' }, { k: 'stop', name: 'Stop' }]);
  eq('a Done the server holds: Clear, nothing else', L.keys(cl, all[1]), [{ k: 'clear', name: 'Clear' }]);
  var paused = window.hkHostClient.from(hassOf([rows('washer', 'pause', 'wash', 31), rows('dryer', 'stop', 'none', 0)]));
  var pk = L.keys(paused, L.lookAll(paused)[0]);
  ok('paused: Stop, and Resume where the machine has it (a pause button alone has no Resume)', pk.every(function (x) { return x.k !== 'pause'; }) && pk.some(function (x) { return x.k === 'stop'; }),
    pk);
  var off = window.hkHostClient.from(hassOf([rows('washer', 'stop', 'none', 0), rows('dryer', 'stop', 'none', 0)]));
  eq('idle: no key', L.keys(off, L.lookAll(off)[0]), []);
  var norem = hassOf([rows('washer', 'run', 'rinse', 24), rows('dryer', 'stop', 'none', 0)]);
  norem.states['binary_sensor.washer_remote'] = Object.assign({}, norem.states['binary_sensor.washer_remote'], { state: 'off' });
  var nr = window.hkHostClient.from(norem);
  eq('Remote Control off: no Pause or Stop (the sheet says why)', L.keys(nr, L.lookAll(nr)[0]), []);
},
function () {
  H.section('the readings under the steps (Extra Large): the cycle\'s settings, the power, a leak first');
  MACHINES = [WASHER];
  var cl = window.hkHostClient.from(hassOf([rows('washer', 'run', 'rinse', 24)]));
  var o = L.lookAll(cl)[0], f = L.facts(cl, o);
  eq('the cycle, then the power in watts', f.map(function (r) { return r.b; }), ['Cycle', 'Power']);
  eq('...as the machine says them', f.map(function (r) { return r.t; }), ['Warm', '412 W']);
  var kw = hassOf([rows('washer', 'run', 'rinse', 24)]);
  kw.states['sensor.washer_power'] = Object.assign({}, kw.states['sensor.washer_power'], { state: '1.84', attributes: { unit_of_measurement: 'kW', device_class: 'power' } });
  var kc = window.hkHostClient.from(kw);
  eq('a circuit that reports kW: turned into watts', L.facts(kc, L.lookAll(kc)[0])[1].t, '1,840 W');
  var idle = window.hkHostClient.from(hassOf([rows('washer', 'stop', 'none', 0)]));
  eq('idle: no power row (its 0 W says nothing)', L.facts(idle, L.lookAll(idle)[0]).map(function (r) { return r.b; }), ['Cycle']);
},
function () {
  H.section('the plate: one for two machines, a hairline between, a half a touch each');
  MACHINES = [WASHER, DRYER];
  var held = { dryer: { since: Math.floor(NOW / 1000) - 600, words: 'Done' } };
  var h = hassOf([rows('washer', 'run', 'rinse', 24), rows('dryer', 'stop', 'finish', 0)], held);
  var w = drawn('W', h)._kitHtml;
  ok('Wide: ONE kit plate, two machines drawn in it', count(w, /<hk-plate /g) === 1 && /class="kit /.test(w) && count(w, /<svg class="hkla /g) === 2, count(w, /<hk-plate /g));
  eq('...a half each opens its machine\'s sheet', (w.match(/data-open data-m="[a-z]+"/g) || []), ['data-open data-m="washer"', 'data-open data-m="dryer"']);
  ok('...a hairline between them', /class="a sep"/.test(w));
  ok('...the words in the kit\'s type: the name a title, what it is doing a body, Done in mint', /class="a kt"[^>]*>Washer</.test(w) && /Rinsing/.test(w) && /color:#63e6e2/i.test(w), w.slice(0, 600));
  var s = drawn('S', h)._kitHtml;
  ok('Small: the dryer (the Done one), one drawing, its words centered', count(s, /<svg class="hkla /g) === 1 && /Dryer/.test(s) && !/Washer/.test(s) && /text-align:center/.test(s));
  var t = drawn('T', h)._kitHtml;
  ok('Tall: two machines, one above the other, a hairline between', count(t, /<svg class="hkla /g) === 2 && /class="a sep"/.test(t));
  var l = drawn('L', h)._kitHtml;
  ok('Large: each its steps with their names under (the washer\'s three; the dryer\'s two, both done)', /Wash</.test(l) && /Rinse</.test(l) && /Spin</.test(l) && /Dry</.test(l) && /Cool</.test(l),
    l.length);
  ok('...a key per machine at the foot: Pause and a glyph Stop for the washer, Clear for the dryer',
     /data-k="pause" data-m="washer"/.test(l) && /data-k="stop" data-m="washer"/.test(l) && /data-k="clear" data-m="dryer"/.test(l));
  VARS['--hk-cell-w'] = 196; VARS['--hk-cell-h'] = 196;
  var xl = drawn('XL', h)._kitHtml;
  ok('Extra Large: each column\'s name over what it is doing in display type, the drawing cropped', /class="a kd"[^>]*>Rinsing</.test(xl) && count(xl, /viewBox="23 9 94 132"/g) === 2, xl.length);
  ok('...the cycle row under the steps (readings)', /Warm/.test(xl) && /Cycle/.test(xl));
},
function () {
  H.section('ONE machine (a washer-dryer): the plate is the machine, drawn large, every step named on Large');
  MACHINES = [COMBO];
  var h = hassOf([rows('combo', 'run', 'drying', 38)]);
  ['W', 'T', 'L', 'XL'].forEach(function (z) {
    var html = drawn(z, h)._kitHtml;
    ok(z + ': one plate, one drawing, no halves, a Pause and a Stop', count(html, /<svg class="hkla /g) === 1 && !/data-open/.test(html) &&
       /data-k="pause" data-m="combo"/.test(html) && /data-k="stop" data-m="combo"/.test(html), html.length);
  });
  var l = drawn('L', h)._kitHtml;
  ok('Large: Wash, Rinse, Spin and Dry named (a combo\'s Cool is its Dry)', ['Wash', 'Rinse', 'Spin', 'Dry'].every(function (n) { return l.indexOf('>' + n + '<') >= 0; }), l.length);
  var w = drawn('W', h)._kitHtml;
  ok('Wide: the steps without names', count(w, /border-radius:3px;overflow:hidden/g) === 4 && !/>Rinse</.test(w));
  var xl = drawn('XL', h)._kitHtml;
  ok('Extra Large: the name above the state, the finish under the time left, the readings', />Washer &amp; Dryer</.test(xl) && />Drying</.test(xl) && /Done at /.test(xl) && /412 W/.test(xl),
    xl.length);
  var done = hassOf([rows('combo', 'stop', 'finish', 0)], { combo: { since: Math.floor(NOW / 1000) - 600, words: 'Done' } });
  var d = drawn('L', done)._kitHtml;
  ok('a Done it holds: mint, a Clear key (not Pause or Stop)', /color:#63e6e2/i.test(d) && /data-k="clear" data-m="combo"/.test(d) && !/data-k="pause"/.test(d));
},
function () {
  H.section('keys do what the machine takes (as the older card did), and a half opens its sheet');
  MACHINES = [WASHER, DRYER];
  var held = { dryer: { since: Math.floor(NOW / 1000) - 600, words: 'Done' } };
  var house1 = H.house(Object.assign({}, rows('washer', 'run', 'rinse', 24), rows('dryer', 'stop', 'finish', 0), { 'sensor.laundry_done': ['on', { machines: held }] }));
  var h = house1.hass();
  h.areas = {}; h.floors = {}; h.devices = {}; h.entities = {};
  Object.keys(h.states).forEach(function (id) { var m = /^[a-z_]+\.([a-z]+)_/.exec(id); h.entities[id] = { device_id: 'dev_' + (m ? m[1] : 'x') }; });
  var c = drawn('L', h), calls = [], html = c._kitHtml;
  c._call = function (d, s, data) { calls.push([d, s, data]); };
  // (the jsc DOM does not parse markup: a root made of the html's own keys and halves, bound as the kit's draw binds a card)
  var fake = function (re, attrs) {
    return (html.match(re) || []).map(function (m) {
      var el = { _listeners: { click: [] }, getAttribute: function (n) { return attrs(m)[n]; }, addEventListener: function (t2, f) { this._listeners[t2].push(f); } };
      return el;
    });
  };
  var keys = fake(/<button[^>]*data-k="[a-z]+"[^>]*>/g, function (m) { return { 'data-k': /data-k="([a-z]+)"/.exec(m)[1], 'data-m': /data-m="([a-z]+)"/.exec(m)[1] }; });
  var halves = fake(/<button[^>]*data-open[^>]*>/g, function (m) { return { 'data-m': /data-m="([a-z]+)"/.exec(m)[1] }; });
  c._bindKit({ querySelectorAll: function (sel) { return /data-open/.test(sel) ? halves : keys; } });
  var by = {};
  keys.forEach(function (b) { by[b.getAttribute('data-k') + ':' + b.getAttribute('data-m')] = b; });
  var fire = function (b) { b._listeners.click.forEach(function (f) { f({ stopPropagation: function () {} }); }); };
  ok('the keys are there to press', by['pause:washer'] && by['stop:washer'] && by['clear:dryer'], Object.keys(by));
  fire(by['pause:washer']);
  eq('Pause presses the machine\'s own pause', calls[0], ['button', 'press', { entity_id: 'button.washer_pause' }]);
  fire(by['stop:washer']);
  eq('Stop presses its stop', calls[1], ['button', 'press', { entity_id: 'button.washer_stop' }]);
  fire(by['clear:dryer']);
  eq('Clear runs the house\'s Clear script for that machine', calls[2], ['script', L.CLEAR, { machine: 'dryer' }]);
  var opened = [];
  window.hkDetail = { open: function (id, info, o) { opened.push(o.panel.config.machine); return true; } };
  eq('a half per machine', halves.length, 2);
  fire(halves[1]);
  eq('a touch on the dryer\'s half opens the dryer\'s sheet', opened, ['dryer']);
  eq('the plate\'s own tap opens the one drawn (Small: the one that needs you)', (function () {
    var s = drawn('S', h); return s._tapTarget().length === 1;
  })(), true);
},
function () {
  H.section('no machines: the plate says where to add one; the older drawing answers only where the kit is not loaded');
  MACHINES = [];
  var h = hassOf([{ 'light.x': ['off', {}] }]);
  var w = drawn('W', h)._kitHtml;
  ok('a kit plate with "No washer or dryer yet"', /class="kit/.test(w) && /No washer or dryer yet/.test(w), w);
  var K = window.hkKit; window.hkKit = null;
  var c = drawn('W', h);
  ok('without the kit the older drawing', /class="la W/.test(c._html || '') || /No washer or dryer yet/.test(c._root.innerHTML || ''), c._html);
  window.hkKit = K;
}
]);
