// THE TILE, CHIP AND STAT EDITORS, field by field (2026-10-12): what each
// card's editor offers on a dashboard of your own, and the few behaviors
// those fields lean on -- a picker filtered to the card's own kind, no
// fields a card never reads, a starter config that works as picked.
//
// test_editors.js walks every editor for readable labels; this pins the
// per-card choices.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
window.customCards = [];
['hk-base', 'hk-tile', 'hk-chip', 'hk-stat', 'hk-row'].forEach(function (f) {
  load(HK_ROOT + '/frontend/cards/' + f + '.js');
});

var pass = 0, fail = 0;
function ok(n, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + n + '   ' + g); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + g + '\n          want ' + w); }
}

function flatten(schema, out) {
  (schema || []).forEach(function (s) { if (s.schema) flatten(s.schema, out); else out.push(s); });
  return out;
}
function editor(tag) {
  var C = customElements.get(tag), p = C.getConfigElement();
  var EC = customElements.get(String(p.tagName || '').toLowerCase());
  var e = EC ? new EC() : p;
  if (!e.appendChild) e.appendChild = function () {};
  e.hass = { states: {} }; e.setConfig({});
  return e._form;
}
function fields(tag) { return flatten(editor(tag).schema, []); }
function names(tag) { return fields(tag).map(function (f) { return f.name; }); }
function field(tag, name) { return fields(tag).filter(function (f) { return f.name === name; })[0]; }
function has(tag, name) { return names(tag).indexOf(name) >= 0; }
function domains(tag) {
  var f = field(tag, 'entity'), flt = f && f.selector.entity.filter;
  return flt ? flt.map(function (x) { return x.domain; }) : null;
}
function sections(tag) {
  return editor(tag).schema.filter(function (s) { return s.type === 'expandable'; })
    .map(function (s) { return s.title + (s.expanded ? ' (open)' : ''); });
}

// ------------------------------------------------------------ 1. pickers
print('=== the entity picker offers the card\'s own kind ===');
ok('light tile: lights', domains('hk-light-card'), ['light']);
ok('fan tile: fans', domains('hk-fan-card'), ['fan']);
ok('cover tile: covers', domains('hk-cover-card'), ['cover']);
ok('climate tile: thermostats and water heaters', domains('hk-climate-card'), ['climate', 'water_heater']);
ok('tall climate tile: the same', domains('hk-climate-tall-card'), ['climate', 'water_heater']);
ok('plain tile: anything', domains('hk-tile-card'), null);
ok('tall tile: anything', domains('hk-tall-card'), null);
ok('favorite tile: anything', domains('hk-favorite-card'), null);
ok('the filter is per card, not shared (light did not leak into the plain tile)',
   field('hk-tile-card', 'entity').selector.entity, {});

// ------------------------------------------------------- 2. climate fields
print('=== a thermostat tile offers nothing it never reads ===');
['hk-climate-card', 'hk-climate-tall-card'].forEach(function (t) {
  ['icon', 'icon_color', 'icon_size', 'bare_icon', 'icon_states', 'icon_tap_action', 'group_lit', 'group']
    .forEach(function (n) { ok(t + ' has no ' + n, has(t, n), false); });
  ['entity', 'name', 'label_mode', 'label', 'size', 'tap_action', 'detail']
    .forEach(function (n) { ok(t + ' keeps ' + n, has(t, n), true); });
});
ok('the favorite climate tile keeps its room line', has('hk-climate-card', 'room'), true);
ok('a light tile still has its icon fields', ['icon', 'icon_tap_action', 'group_lit'].every(function (n) {
  return has('hk-light-card', n); }), true);
// the code still reads them (a hand-written YAML keeps working)
var CT = customElements.get('hk-climate-card');
ok('a climate tile is still lit by its own rule', CT.prototype._isOn.call({}), true);

// ---------------------------------------------------------- 3. scene tile
print('=== a scene pill may be only an action ===');
ok('entity is not required', !!field('hk-scene-card', 'entity').required, false);
// (setConfig's guard: an entity unless _entityOptional; a full render
// needs more DOM than the shim has)
var Scene = customElements.get('hk-scene-card');
ok('...and the card takes one with none', Scene.prototype._entityOptional.call({}, {}), true);

// ------------------------------------------------------------- 4. advanced
print('=== the tiles\' Advanced section ===');
ok('plain tile sections', sections('hk-tile-card'), ['Appearance', 'Group', 'Interactions', 'Advanced']);
ok('climate tile sections', sections('hk-climate-card'), ['Appearance', 'Interactions', 'Advanced']);
['hk-tile-card', 'hk-tall-card', 'hk-favorite-card'].forEach(function (t) {
  ok(t + ' offers label_map, label_default, animation, detail',
     ['label_map', 'label_default', 'animation', 'detail'].map(function (n) { return has(t, n); }),
     [true, true, true, true]);
});
// a light, fan or cover tile computes its own status text: no map to offer
['hk-light-card', 'hk-fan-card', 'hk-cover-card', 'hk-climate-card'].forEach(function (t) {
  ok(t + ' offers no label_map', has(t, 'label_map'), false);
  ok(t + ' offers detail', has(t, 'detail'), true);
});
ok('light and cover: no animation', [has('hk-light-card', 'animation'), has('hk-cover-card', 'animation')], [false, false]);
ok('the fan keeps its own animation, once', names('hk-fan-card').filter(function (n) { return n === 'animation'; }).length, 1);
var det = field('hk-tile-card', 'detail');
ok('Detail Sheet is labeled', [det.label, det.helper],
   ['Detail Sheet', 'Off: a tap does what Tap Action says, never the HK sheet.']);
ok('...a switch, on by default', [det.selector, det.default], [{ boolean: {} }, true]);
ok('label_map is an object', field('hk-tile-card', 'label_map').selector, { object: {} });
// label_map / label_default do what the field says
var Tile = customElements.get('hk-tile-card');
function lbl(cfg, s) {
  var c = Object.create(Tile.prototype); c._config = cfg;
  return c._label({ entity_id: cfg.entity, state: s, attributes: {} });
}
ok('label_map maps a state', lbl({ entity: 'switch.a', label_map: { on: 'Running' } }, 'on'), 'Running');
ok('label_default covers the rest', lbl({ entity: 'switch.a', label_map: { on: 'Running' }, label_default: 'Idle' }, 'off'), 'Idle');
ok('...and can reword the state', lbl({ entity: 'switch.a', label_default: 'title' }, 'heat_cool'), 'Heat Cool');

// --------------------------------------------------------- 5. status chip
print('=== the status chip ===');
var kinds = field('hk-status-chip-card', 'kind').selector.select.options.map(function (o) { return o.value; });
ok('Smoke & CO is a kind', kinds.indexOf('smoke') >= 0, true);
ok('the row\'s lists still leave it out (it leads every row on its own)',
   field('hk-chips-card', 'chips').selector.select.options.some(function (o) { return o.value === 'smoke'; }), false);
ok('no bare_icon (never read)', has('hk-status-chip-card', 'bare_icon'), false);
ok('Your Own Chip section', sections('hk-status-chip-card').indexOf('Your Own Chip') >= 0, true);
ok('...with source, attribute, format, zero, one',
   ['source', 'attribute', 'format', 'zero', 'one'].map(function (n) { return has('hk-status-chip-card', n); }),
   [true, true, true, true, true]);
ok('...and says the rest is YAML', /More in YAML: count, parts, label_rules/.test(field('hk-status-chip-card', 'source').helper), true);
var CF = window.hkCards;
var house = { 'sensor.mail': { entity_id: 'sensor.mail', state: '0', attributes: { count: 1 } } };
var fake = { _st: function (id) { return house[id]; } };
ok('source + attribute read another entity', CF.chipValue(fake, { source: 'sensor.mail', attribute: 'count' }, null), 1);
ok('zero / one / format', [CF.labelFor(fake, { source: 'sensor.mail', zero: 'None', format: '{v} Letters' }, null),
                           CF.labelFor(fake, { source: 'sensor.mail', attribute: 'count', one: '1 Letter', format: '{v} Letters' }, null)],
   ['None', '1 Letter']);

// ------------------------------------------------------------- 6. toggle stub
print('=== the toggle chip\'s starter config works as picked ===');
var Tog = customElements.get('hk-toggle-card');
function stub(ids) {
  var h = { states: {} };
  ids.forEach(function (x) { h.states[x[0]] = { entity_id: x[0], state: x[1], attributes: {} }; });
  return Tog.getStubConfig(h);
}
ok('an input_boolean first, toggled on a tap',
   stub([['input_select.mode', 'Home'], ['switch.fan', 'off'], ['input_boolean.guest', 'off']]),
   { entity: 'input_boolean.guest', tap_action: { action: 'toggle' } });
ok('else a switch', stub([['input_select.mode', 'Home'], ['switch.fan', 'off']]),
   { entity: 'switch.fan', tap_action: { action: 'toggle' } });
var seg = stub([['input_select.mode', 'Home']]);
ok('else an input_select, lit on its current option and choosing it on a tap', seg,
   { entity: 'input_select.mode', name: 'Home', option: 'Home',
     tap_action: { action: 'perform-action', perform_action: 'input_select.select_option',
                   target: { entity_id: 'input_select.mode' }, data: { option: 'Home' } } });
function lit(cfg, s) {
  var c = Object.create(Tog.prototype); c._config = cfg;
  return c._isOn({ entity_id: cfg.entity, state: s, attributes: {} });
}
ok('...which is lit as placed', lit(seg, 'Home'), true);
ok('the switch stub lights while on', lit({ entity: 'switch.fan' }, 'on'), true);
ok('an empty house still builds one', typeof stub([]).entity, 'string');

// ------------------------------------------------------------- 7. the rows
print('=== the chips row and the scenes row ===');
var plan = window.hkChip.kinds.rowPlan;
function lead(cfg) { var r = plan(Object.assign({ chips: ['lights'] }, cfg), {}, { states: {} }, false); return r.lead; }
var MENU = { type: 'custom:hk-menu-button-card' };
ok('unset: the menu button', lead({}), MENU);
ok('lead: true (the switch on) is the same', lead({ lead: true }), MENU);
ok('lead: false: none', lead({ lead: false }), undefined);
ok('a card of your own still leads', lead({ lead: { type: 'custom:x' } }), { type: 'custom:x' });
var mb = field('hk-chips-card', 'lead');
ok('Menu Button switch', [mb.label, mb.selector, mb.default], ['Menu Button', { boolean: {} }, true]);
ok('Row Layout: margin, gap, card_width', ['margin', 'gap', 'card_width'].map(function (n) { return has('hk-chips-card', n); }),
   [true, true, true]);
ok('...folded away', sections('hk-chips-card'), ['Row Layout']);
var r2 = plan({ chips: ['lights'], gap: 4, margin: '0px', card_width: '120px' }, {}, { states: {} }, false);
ok('...and they reach the row', [r2.gap, r2.margin, r2.card_width], [4, '0px', '120px']);
ok('scenes row offers room', field('hk-scenes-card', 'room').selector, { boolean: {} });
ok('...labeled for what it does', field('hk-scenes-card', 'room').label, 'Just These Scenes');

// ---------------------------------------------------------------- 8. metric
print('=== the metric\'s temperature unit ===');
var Metric = customElements.get('hk-stat-card');
function temp(cfg, attrs, unit) {
  var c = Object.create(Metric.prototype);
  c._config = Object.assign({ entity: 'sensor.t', value_mode: 'temperature' }, cfg);
  c._hass = unit ? { states: {}, config: { unit_system: { temperature: unit } } } : { states: {} };
  return c._modeValue({ entity_id: 'sensor.t', state: '21.4', attributes: attrs || {} });
}
ok('the sensor\'s own unit', temp({}, { unit_of_measurement: '°C' }, '°F'), '21°C');
ok('no unit on the sensor: the home\'s', temp({}, {}, '°C'), '21°C');
ok('an attribute reading: the home\'s (the sensor\'s unit is the state\'s)',
   temp({ value_attribute: 'x' }, { unit_of_measurement: '%', x: 70.2 }, '°F'), '70°F');
ok('a non-degree unit is not a temperature unit', temp({}, { unit_of_measurement: '%' }, '°C'), '21°C');
ok('nothing known: °F as before', temp({}, {}, null), '21°F');
ok('value_suffix still wins', temp({ value_suffix: '°' }, { unit_of_measurement: '°C' }, '°C'), '21°');
var vm = field('hk-stat-card', 'value_mode').selector.select.options.map(function (o) { return o.value; });
ok('cost_today is offered', vm.indexOf('cost_today') >= 0, true);
ok('value_suffix, power and price are offered',
   ['value_suffix', 'power', 'price'].map(function (n) { return has('hk-stat-card', n); }), [true, true, true]);
ok('price picks an entity (a fixed number stays YAML)', !!field('hk-stat-card', 'price').selector.entity, true);

// ------------------------------------------------------------------ 9. rank
print('=== the reading tile ===');
var Rank = customElements.get('hk-rank-card');
ok('a 152 px tile asks for three rows', Rank.prototype.getCardSize.call({}), 3);
ok('energy is a mode', field('hk-rank-card', 'mode').selector.select.options.some(function (o) {
  return o.value === 'energy'; }), true);

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed'
                   : 'ALL ' + pass + ' CARD FIELD TESTS PASS'));
