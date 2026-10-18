// The tile cards' LABEL and ON-STATE logic: named label modes, so a config
// says `label_mode: vacuum` instead of carrying its own JavaScript.
//
// _label() and _isOn() are called directly: the shim's innerHTML does not
// parse, so a full _render() proves nothing here, and these two methods ARE
// the logic. Each mode is pinned to exactly what it must print.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');
// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');

var Tile = customElements.get('hk-tile-card');
var Fav  = customElements.get('hk-favorite-card');

var pass = 0, fail = 0;
function ok(n, got, want) {
  if (got === want) { pass++; print('  PASS  ' + n + '   ' + JSON.stringify(got)); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + JSON.stringify(got) +
                       '\n          want ' + JSON.stringify(want)); }
}
function st(id, state, attrs) {
  return { entity_id: id, state: state, attributes: attrs || {}, last_updated: 't' };
}
// Object.create, not `new`: the constructor attaches a shadow root and
// setConfig calls _render(), which needs a querySelector the shim's
// non-parsing innerHTML cannot provide. _label() and _isOn() read _config and
// _st() and nothing else, so this exercises the real prototype methods with
// none of the rendering they do not depend on.
function card(Ctor, cfg, states) {
  var c = Object.create(Ctor.prototype);
  c._config = cfg;
  c._hass = { states: states || {} };
  return c;
}
function label(cfg, stateObj, states) {
  var c = card(Tile, cfg, states);
  return c._label(stateObj);
}

// ---------------------------------------------------------------- vacuum
// The mode: cleaning/returning/paused verbatim, docked AND idle -> "Ready",
// error -> "Error", anything else title-cased.
print('=== label_mode: vacuum ===');
var V = { entity: 'vacuum.downstairs_vacuum', label_mode: 'vacuum' };
ok('cleaning',  label(V, st('vacuum.x', 'cleaning')),  'Cleaning');
ok('returning', label(V, st('vacuum.x', 'returning')), 'Returning');
ok('paused',    label(V, st('vacuum.x', 'paused')),    'Paused');
ok('docked -> Ready', label(V, st('vacuum.x', 'docked')), 'Ready');
ok('idle   -> Ready', label(V, st('vacuum.x', 'idle')),   'Ready');
ok('error',     label(V, st('vacuum.x', 'error')),     'Error');
// The fallback is what keeps a firmware state legible instead of raw.
ok('unknown state title-cases', label(V, st('vacuum.x', 'unavailable')), 'Unavailable');
ok('underscores become spaces', label(V, st('vacuum.x', 'returning_to_dock')),
   'Returning To Dock');

// -------------------------------------------------------------- position
// A blind reads its position, with BOTH endpoints named so a shut blind never
// says "0%".
print('\n=== label_mode: position ===');
var P = { entity: 'cover.master_bathroom_window_simple', label_mode: 'position' };
ok('45 -> 45%', label(P, st('cover.x', 'open', { current_position: 45 })), '45%');
ok('0 is Closed, not 0%', label(P, st('cover.x', 'closed', { current_position: 0 })), 'Closed');
ok('100 is Open',  label(P, st('cover.x', 'open', { current_position: 100 })), 'Open');
ok('rounds',       label(P, st('cover.x', 'open', { current_position: 44.6 })), '45%');
// A cover that reports no position falls back to its state.
ok('no position -> Open',    label(P, st('cover.x', 'open')),    'Open');
ok('no position -> opening', label(P, st('cover.x', 'opening')), 'Open');
ok('no position -> closing', label(P, st('cover.x', 'closing')), 'Closed');
ok('no position -> other',   label(P, st('cover.x', 'unavailable')), 'Unavailable');

// -------------------------------------------------------------- duration
print('\n=== label_mode: duration ===');
var D = { entity: 'timer.nap_timer', label_mode: 'duration' };
ok('0:45:00', label(D, st('timer.x', 'idle', { duration: '0:45:00' })), '45 min');
ok('2:00:00', label(D, st('timer.x', 'idle', { duration: '2:00:00' })), '2 hr');
ok('2:30:00', label(D, st('timer.x', 'idle', { duration: '2:30:00' })), '2 hr 30 min');
ok('no duration -> Start',  label(D, st('timer.x', 'idle')), 'Start');
ok('0:00:00 -> Start',      label(D, st('timer.x', 'idle', { duration: '0:00:00' })), 'Start');
ok('0:00:30 -> Start',      label(D, st('timer.x', 'idle', { duration: '0:00:30' })), 'Start');
ok('garbage -> Start',      label(D, st('timer.x', 'idle', { duration: 'soon' })), 'Start');
// A bare "45:00" is M:SS in some configs; the mode pads to three parts first.
ok('45:00 pads to 0:45:00', label(D, st('timer.x', 'idle', { duration: '45:00' })), '45 min');

// ------------------------------------------------- group_brightness / _count
print('\n=== group labels ===');
var A = 'light.main_kitchen_lights', B = 'light.kitchen_table_light';
var GB = { entity: A, label_mode: 'group_brightness', group: [A, B], group_lit: 'any' };
function gb(states) { return label(GB, states[A], states); }
ok('both off -> Off', gb({ }), 'Off');
ok('both off (present) -> Off',
   gb(mk([[A, 'off'], [B, 'off']])), 'Off');
ok('one on, no brightness -> On', gb(mk([[A, 'on'], [B, 'off']])), 'On');
ok('one on at 255 -> 100%', gb(mk([[A, 'on', 255], [B, 'off']])), '100%');
// The MEAN of the lights that are ON -- an off light does not drag it to 50%.
ok('50% + off = 50%, not 25%', gb(mk([[A, 'on', 128], [B, 'off', 255]])), '50%');
ok('mean of two on', gb(mk([[A, 'on', 255], [B, 'on', 128]])), '75%');
function mk(rows) {
  var s = {};
  rows.forEach(function (r) {
    s[r[0]] = st(r[0], r[1], r[2] === undefined ? {} : { brightness: r[2] });
  });
  return s;
}

var G = 'light.bathroom_lights';
var M1 = 'light.kids_bathroom_vanity_lights';
var M2 = 'light.upstairs_bathroom_vanity_lights';
var M3 = 'light.upstairs_bathroom_shower_light';
var GC = { entity: G, label_mode: 'group_count', group: [M1, M2, M3] };
function gc(gstate, on) {
  var s = mk([[M1, on.indexOf(M1) >= 0 ? 'on' : 'off'],
              [M2, on.indexOf(M2) >= 0 ? 'on' : 'off'],
              [M3, on.indexOf(M3) >= 0 ? 'on' : 'off']]);
  s[G] = st(G, gstate);
  return label(GC, s[G], s);
}
// GATED ON THE GROUP ENTITY, not on the members: the tile's entity IS the
// group light, so "Off" means that group is off. Counting members instead
// would print "1 On" for a group reporting off.
ok('group off -> Off',   gc('off', [M1, M2]), 'Off');
ok('group on, 1 member', gc('on', [M1]), 'On');
ok('group on, 2 members', gc('on', [M1, M2]), '2 On');
ok('group on, 3 members', gc('on', [M1, M2, M3]), '3 On');
// "1 On" would be noise -- one light on is just "On".
ok('never says "1 On"', gc('on', [M2]), 'On');

// ------------------------------------------------------------ group_lit
print('\n=== group_lit: any ===');
function isOn(cfg, states) {
  var c = card(Tile, cfg, states);
  return !!c._isOn(states[cfg.entity]);
}
ok('any: lit when the OTHER light is on',
   isOn(GB, mk([[A, 'off'], [B, 'on']])), true);
ok('any: dark when both are off',
   isOn(GB, mk([[A, 'off'], [B, 'off']])), false);
ok('any: lit when its own is on',
   isOn(GB, mk([[A, 'on'], [B, 'off']])), true);
// The DEFAULT still follows the card's own entity -- a tile with a real
// group entity must not light because one member is on.
ok('default follows the card entity, not the members',
   isOn(GC, (function () {
     var s = mk([[M1, 'on'], [M2, 'off'], [M3, 'off']]);
     s[G] = st(G, 'off'); return s;
   })()), false);

// ------------------------------------------------------------ plain modes
print('\n=== the plain modes ===');
ok('on_off on',  label({ entity: 'x.y', label_mode: 'on_off' }, st('x.y', 'on')),  'On');
ok('on_off off', label({ entity: 'x.y', label_mode: 'on_off' }, st('x.y', 'off')), 'Off');
ok('state: unlocked', label({ entity: 'x.y', label_mode: 'state' }, st('x.y', 'unlocked')), 'Unlocked');
ok('title: opening',  label({ entity: 'x.y', label_mode: 'title' }, st('x.y', 'opening')), 'Opening');
// A garage door uses `title`; these four are why that is exact.
ok('title: open',   label({ entity: 'x.y', label_mode: 'title' }, st('x.y', 'open')),   'Open');
ok('title: closed', label({ entity: 'x.y', label_mode: 'title' }, st('x.y', 'closed')), 'Closed');
ok('title: closing',label({ entity: 'x.y', label_mode: 'title' }, st('x.y', 'closing')),'Closing');
ok('brightness',    label({ entity: 'x.y', label_mode: 'brightness' },
                          st('x.y', 'on', { brightness: 128 })), '50%');
ok('a static label still wins', label({ entity: 'x.y', label: 'Hi', label_mode: 'vacuum' },
                                      st('x.y', 'cleaning')), 'Hi');
// The favourite tile is the same label code with a room line.
ok('favourite tile uses the same modes', (function () {
  var c = card(Fav, { entity: 'x.y', room: 'Loft', label_mode: 'vacuum' }, {});
  return c._label(st('x.y', 'docked'));
})(), 'Ready');

// ------------------------------------------------------------ climate
// The thermostats. Two label modes because the two tiles say it differently:
// the favourite row has no width for a verb, the tall tile does.
print('\n=== label_mode: setpoint / setpoint_verb ===');
function clim(mode, state, attrs) {
  return label({ entity: 'climate.x', label_mode: mode }, st('climate.x', state, attrs));
}
ok('range',        clim('setpoint', 'heat_cool', { target_temp_low: 68, target_temp_high: 72 }), '68\u00b0\u201372\u00b0');
ok('single point', clim('setpoint', 'cool', { temperature: 72 }), '72\u00b0');
ok('rounds',       clim('setpoint', 'cool', { temperature: 71.6 }), '72\u00b0');
// The plain mode does NOT title-case -- underscores to spaces and no more.
ok('fallback is spaces, not Title', clim('setpoint', 'heat_cool', {}), 'heat cool');
ok('verb: off wins over everything', clim('setpoint_verb', 'off', { temperature: 72 }), 'Off');
ok('verb: heat',   clim('setpoint_verb', 'heat', { temperature: 72 }), 'Heat to 72\u00b0');
ok('verb: cool',   clim('setpoint_verb', 'cool', { temperature: 72 }), 'Cool to 72\u00b0');
ok('verb: auto',   clim('setpoint_verb', 'auto', { temperature: 72 }), 'Set to 72\u00b0');
// The water-heater modes are heat modes too -- the same card draws those.
ok('verb: heat_pump',   clim('setpoint_verb', 'heat_pump', { temperature: 120 }), 'Heat to 120\u00b0');
ok('verb: eco',         clim('setpoint_verb', 'eco', { temperature: 120 }), 'Heat to 120\u00b0');
ok('verb: performance', clim('setpoint_verb', 'performance', { temperature: 120 }), 'Heat to 120\u00b0');
ok('verb: gas',         clim('setpoint_verb', 'gas', { temperature: 120 }), 'Heat to 120\u00b0');
ok('verb: electric',    clim('setpoint_verb', 'electric', { temperature: 120 }), 'Heat to 120\u00b0');
// A range beats a verb: two setpoints have no single thing to head toward.
ok('verb: range still reads as a range',
   clim('setpoint_verb', 'heat_cool', { target_temp_low: 68, target_temp_high: 72 }),
   '68\u00b0\u201372\u00b0');
ok('verb: fallback title-cases', clim('setpoint_verb', 'fan_only', {}), 'Fan Only');
// `off` is only special in the verb mode.
ok('plain mode has no Off special case', clim('setpoint', 'off', { temperature: 72 }), '72\u00b0');

print('\n=== the climate tiles ===');
var Clim = customElements.get('hk-climate-card');
var ClimTall = customElements.get('hk-climate-tall-card');
function lit(Ctor, state) {
  var c = card(Ctor, { entity: 'climate.x' }, {});
  return !!c._isOn(st('climate.x', state));
}
// The favorite climate tile's plate is ALWAYS lit. A thermostat on the
// favorites row is a reading, not a switch.
ok('favourite is lit even when off', lit(Clim, 'off'), true);
ok('favourite is lit when heating', lit(Clim, 'heat'), true);
// The tall tile follows the system, like every other tall tile in the grid.
ok('tall is dark when off',        lit(ClimTall, 'off'), false);
ok('tall is dark when unavailable',lit(ClimTall, 'unavailable'), false);
ok('tall is lit when heating',     lit(ClimTall, 'heat'), true);
ok('tall is lit in heat_cool',     lit(ClimTall, 'heat_cool'), true);
// A missing reading: the favourite holds its column open, the tall shows none.
ok('favourite placeholder', Object.create(Clim.prototype)._noTemp(), '--\u00b0');
ok('tall placeholder',      Object.create(ClimTall.prototype)._noTemp(), '');
ok('climate tiles use the setpoint modes', (function () {
  var c = card(Clim, { entity: 'climate.x', label_mode: 'setpoint' }, {});
  return c._label(st('climate.x', 'cool', { temperature: 70 }));
})(), '70\u00b0');

// A scene pill lights on 'on' only -- unless a parent card decides for it
// (_hkLit: the speaker picker's playlist pills, which have no entity at all).
var Scene = customElements.get('hk-scene-card');
ok('scene lights on on', !!card(Scene, { entity: 'script.x' }, {})._isOn(st('script.x', 'on')), true);
ok('scene not on paused', !!card(Scene, { entity: 'script.x' }, {})._isOn(st('script.x', 'paused')), false);
ok('parent says dark -> dark even when on', (function () {
  var c = card(Scene, { entity: 'script.x' }, {}); c._hkLit = function () { return false; };
  return !!c._isOn(st('script.x', 'on'));
})(), false);
ok('parent says lit -> lit even when off', (function () {
  var c = card(Scene, { entity: 'script.x' }, {}); c._hkLit = function () { return true; };
  return !!c._isOn(st('script.x', 'off'));
})(), true);

// A TAP RUNS IT. A scene pill placed by hand (the card picker's, no
// tap_action) runs its scene, script or automation, as the generated rows'
// pills do; a tap_action of its own wins; no entity, nothing is invented.
function sceneTapOf(cfg) {
  var c = Object.create(Scene.prototype), got = null;
  var parent = Object.getPrototypeOf(Scene.prototype);
  var realSet = parent.setConfig;
  parent.setConfig = function (x) { got = x; };
  try { Scene.prototype.setConfig.call(c, cfg); } finally { parent.setConfig = realSet; }
  return got && got.tap_action;
}
ok('a hand-placed scene runs the scene', JSON.stringify(sceneTapOf({ entity: 'scene.movie' })),
   JSON.stringify({ action: 'perform-action', perform_action: 'scene.turn_on', target: { entity_id: 'scene.movie' } }));
ok('...a script runs the script', sceneTapOf({ entity: 'script.x' }).perform_action, 'script.turn_on');
ok('...an automation triggers', sceneTapOf({ entity: 'automation.y' }).perform_action, 'automation.trigger');
ok('...its own tap_action wins', sceneTapOf({ entity: 'scene.movie', tap_action: { action: 'none' } }).action, 'none');
ok('...no entity, no tap invented', sceneTapOf({ tap_action: undefined }), undefined);

// A SCENE PILL IN ITS CHOSEN COLOUR (an accessory's Color, a page pill's):
// off, the glyph wears it; lit, it fills the circle behind a white glyph.
// White, or none, is the Home app's own white glyph and near-black when lit.
var YEL = window.hkCards.PALETTE.icon.yellow;
ok('a yellow scene: its glyph yellow while off', card(Scene, { entity: 'script.x', icon_color: 'yellow' }, {})._iconColour({ icon_color: 'yellow' }, st('script.x', 'off'), false), YEL);
ok('...lit: a yellow circle behind a white glyph', (function () {
  var c = card(Scene, { entity: 'script.x', icon_color: 'yellow' }, {}), cfg = { icon_color: 'yellow' }, s = st('script.x', 'on');
  return c._wellBackground(cfg, s, true) === YEL && c._iconColour(cfg, s, true) === 'white' && c._wellBackground(cfg, s, false) === 'none';
})(), true);
ok('a white scene stays the Home app\'s: white glyph, near-black lit, no well', (function () {
  var c = card(Scene, { entity: 'script.x', icon_color: 'white' }, {}), cfg = { icon_color: 'white' }, s = st('script.x', 'on');
  return c._iconColour(cfg, s, false) === window.hkCards.v('ink') && c._iconColour(cfg, s, true) === 'rgba(0, 0, 0, 0.95)' &&
    c._wellBackground(cfg, s, true) === null && c._wellBackground({}, s, true) === null;
})(), true);

// THE SIGNATURE GATE ON A PILL WITH NO ENTITY. The Live TV pill only
// navigates; with no entity, a null default signature would re-render it on
// EVERY hass push. Driven through the real `set hass` gate: ten pushes that
// change nothing it shows must draw it once.
print('\n=== an entity-less scene pill is signature-gated ===');
function gated(cfg) {
  var c = Object.create(Scene.prototype), n = 0;
  c._config = cfg;
  c._render = function () { n++; };
  c.renders = function () { return n; };
  return c;
}
function pushes(cards, k) {
  for (var i = 0; i < k; i++) {
    var h = { states: { 'input_button.nap': st('input_button.nap', 'x'),
                        'light.unrelated': { state: 'on', attributes: {}, last_updated: 't' + i } } };
    cards.forEach(function (c) { c.hass = h; });
  }
}
var live = gated({ name: 'Live TV', icon: 'hk:television',
                   tap_action: { action: 'navigate', navigation_path: './live-tv' } });
var nap = gated({ entity: 'input_button.nap', name: 'Nap' });
pushes([live, nap], 10);
ok('Live TV pill: 10 unrelated pushes, 1 render', live.renders(), 1);
ok('an entity pill still gates (1 render)', nap.renders(), 1);
ok('its signature is static', live._sigOf(), 'static');
ok('an entity pill keeps the entity signature', /^input_button\.nap=/.test(nap._sigOf() || ''), true);
live._hkSig = null; pushes([live], 1);
ok('a parent clearing _hkSig still redraws it (hk-media _paintBusy)', live.renders(), 2);
// A REDRAW FROM THE CARD ITSELF (data that arrived, a choice on the card):
// drawn once, and the next push that changes nothing is NOT drawn again --
// clearing the signature instead made every such redraw cost two.
var own = gated({ entity: 'input_button.nap', name: 'Nap' });
pushes([own], 1);
own.redraw();
ok('redraw() draws now', own.renders(), 2);
pushes([own], 3);
ok('...and the pushes after it that change nothing do not draw again', own.renders(), 2);
own.requestUpdate();
pushes([own], 3);
ok('requestUpdate() (the hk-stats bridge) is the same: one draw, not two', own.renders(), 3);
var grp = gated({ name: 'Bath', group: ['light.a'] });
grp.hass = { states: { 'light.a': st('light.a', 'on') } };
grp.hass = { states: { 'light.a': { entity_id: 'light.a', state: 'off', attributes: {}, last_updated: 't2' } } };
ok('a pill with a group (no entity) still wakes on its members', grp.renders(), 2);

// NOT REPORTING (the generated Water page's Sensor Coverage): a tile that
// stands for its group needs no entity -- requiring one throws, and the page
// draws an error card where the count should be.
var probe = function (cfg) {
  var c = Object.create(Tile.prototype);
  c._render = function () {};
  try { c.setConfig(cfg); return null; } catch (e) { return e.message; }
};
ok('an unreported-count tile takes a group and no entity',
   probe({ type: 'custom:hk-tile-card', name: 'Not Reporting', label_mode: 'unreported', group: ['binary_sensor.a', 'binary_sensor.b'] }), null);
var unrep = card(Tile, { name: 'Not Reporting', label_mode: 'unreported', group: ['binary_sensor.a', 'binary_sensor.b'] },
                 { 'binary_sensor.a': st('binary_sensor.a', 'unknown'), 'binary_sensor.b': st('binary_sensor.b', 'off') });
ok('...its label is how many say nothing', unrep._label(null), '1');
ok('...and it is lit while any do', unrep._isOn(null), true);
ok('a plain tile still needs its entity', probe({ type: 'custom:hk-tile-card', name: 'No entity' }), 'hk-tile: `entity` is required');

// A MOMENTARY TILE LIGHTS WHEN TAPPED: a Wake on LAN button's state is the
// time it was last pressed, so without this the tile never lit and a tap
// looked like nothing happened.
print('\n=== a button tile lights for a moment when tapped ===');
function pressable(entity, accept) {
  var c = Object.create(Tile.prototype), calls = [];
  c._config = { entity: entity, tap_action: { action: 'perform-action', perform_action: 'button.press', target: { entity_id: entity } } };
  c._hass = { states: {}, callService: function (d, s, data) { calls.push(d + '.' + s); return accept ? Promise.resolve() : Promise.reject(new Error('no')); } };
  c._render = function () {};
  c.calls = calls;
  return c;
}
var wol = pressable('button.steam_machine_wake_on_lan', true);
ok('a button tile is momentary', wol._momentary(), true);
ok('...dark before the tap', wol._pressed(), false);
wol._act(wol._config.tap_action, true);
ok('...the tap presses the button', wol.calls.join(), 'button.press');
ok('...and lights the tile', wol._pressed(), true);
drainMicrotasks();
ok('...still lit once Home Assistant accepted it', wol._pressed(), true);
wol._unpress();
ok('...and dark again after its moment', wol._pressed(), false);
var refused = pressable('button.x', false);
refused._act(refused._config.tap_action, true);
drainMicrotasks();
ok('a refused press goes dark at once', refused._pressed(), false);
var lamp = pressable('light.lamp', true);
lamp._config.tap_action = { action: 'perform-action', perform_action: 'light.toggle', target: { entity_id: 'light.lamp' } };
lamp._act(lamp._config.tap_action, true);
ok('a light is not momentary: its own state lights it', lamp._pressed(), false);
var scn = Object.create(Scene.prototype);
scn._config = { entity: 'input_button.nap' };
ok('an input_button scene pill is momentary too', scn._momentary(), true);

// ------------------------------------------------------------- size
// THE TILE'S HEIGHT (`size`): any tile tall or regular, whatever its card
// draws by default -- the layout swaps for its twin, and the card says how
// many rows it wants.
print('=== size ===');
var Tall = customElements.get('hk-tall-card'), Light = customElements.get('hk-light-card');
var CT = customElements.get('hk-climate-tall-card');
function lay(Ctor, cfg) { var c = card(Ctor, cfg); return c._layout() + ' ' + c.getCardSize(); }
ok('a light is a pill by default', lay(Light, { entity: 'light.a' }), 'standard 1');
ok('...tall when asked', lay(Light, { entity: 'light.a', size: 'tall' }), 'tall 2');
ok('a lock\'s tall tile', lay(Tall, { entity: 'lock.a', layout: 'tall' }), 'tall 2');
ok('...a pill when asked', lay(Tall, { entity: 'lock.a', layout: 'tall', size: 'regular' }), 'standard 1');
ok('a thermostat\'s tall tile, regular: the temperature pill', lay(CT, { entity: 'climate.a', layout: 'climate_tall', size: 'regular' }), 'climate_pill 1');
ok('an unknown size changes nothing', lay(Tall, { entity: 'lock.a', layout: 'tall', size: 'huge' }), 'tall 2');

// ------------------------------------------------------------------- spin
// The fan's glyph turns while it is on; animation is the card option the
// accessory's spin setting (the gear, 2026-10-03) is written as, so a config
// of none keeps a chosen icon from reading as a fan.
print('=== spin ===');
var Fan = customElements.get('hk-fan-card');
function anim(Ctor, cfg) { return card(Ctor, cfg)._animation(); }
ok('a fan spins by default', anim(Fan, { entity: 'fan.a' }), 'spin');
ok('...and a config of none is still (a non-spinning icon)', anim(Fan, { entity: 'fan.a', animation: 'none' }), 'none');
ok('...and an explicit spin is the same as its kind', anim(Fan, { entity: 'fan.a', animation: 'spin' }), 'spin');
ok('a switch does not spin by its kind', anim(Tile, { entity: 'switch.a' }), 'none');
ok('...but a switch can be told to, as a fan', anim(Tile, { entity: 'switch.a', animation: 'spin' }), 'spin');

// ---------------------------------------------------------------- the vacuum card's wake
// Its battery is an ATTRIBUTE of the vacuum: a battery that charges while the
// vacuum stays `docked` must change the signature (it read `state` alone, and
// the percentage froze until the vacuum next moved).
print('=== hk-vacuum-card signature ===');
var Vac = customElements.get('hk-vacuum-card');
function vsig(vs) {
  var c = Object.create(Vac.prototype);
  c._config = { entity: 'vacuum.v' };
  c._hass = { states: { 'vacuum.v': vs } };
  return c._sigOf();
}
var v1 = { entity_id: 'vacuum.v', state: 'docked', attributes: { battery_level: 40 }, last_updated: 't1' };
var v2 = { entity_id: 'vacuum.v', state: 'docked', attributes: { battery_level: 55 }, last_updated: 't2' };
ok('a battery change while docked moves the signature', vsig(v1) !== vsig(v2), true);
ok('...and nothing new keeps it still', vsig(v1) === vsig(Object.assign({}, v1)), true);

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed'
                   : 'ALL ' + pass + ' TILE TESTS PASS'));
