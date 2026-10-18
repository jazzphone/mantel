// HkBase._act -- the tap contract's runtime half.
//
// Two things here are the kind that fail SILENTLY on a wall tablet:
//
//   confirmation        circuit switches (an EcoFlow panel's) ask before they
//                       fire. A card that dropped the prompt would flip a
//                       breaker on a mistap and nothing on screen would say so.
//   navigation_path_map a dashboard with no EcoFlow view of its own (here
//                       energy-tablet) must not follow "./ecoflow" -- it
//                       navigates to a page that does not exist.
var DIR = HK_ROOT + '/tests/';
load(DIR + 'dom.js');

// --- the few globals _act touches that the shim does not carry -------------
globalThis.history = { _pushed: [], pushState: function (a, b, p) { this._pushed.push(p); } };
globalThis.location.pathname = '/lovelace-kitchen/energy';
document.body = document.createElement('body');
globalThis.__opened = [];
globalThis.open = function (u, t) { __opened.push([u, t]); };
var __winEvents = [];
globalThis.dispatchEvent = function (e) { __winEvents.push(e.type); };

// Load the base and every card family.
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-media.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-home.js');
load(HK_ROOT + '/frontend/cards/hk-energy.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
var HkBase = window.hkCards.HkBase;

var pass = 0, fail = 0;
function ok(n, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; print('  PASS  ' + n + '   ' + g); }
  else { fail++; print('  FAIL  ' + n + '\n          got  ' + g + '\n          want ' + w); }
}

var calls, fired;
function actor(cfg) {
  calls = []; fired = [];
  var c = Object.create(HkBase.prototype);
  c._config = cfg;
  hkGive(c, { states: {}, callService: function (d, s, data) { calls.push(d + '.' + s); calls.push(data); } });
  c.dispatchEvent = function (e) { fired.push(e.type); };
  return c;
}
function sheet() { return document.body.children[document.body.children.length - 1]; }
function sheetOpen() { var s = sheet(); return !!(s && s.attrs['data-open']); }
// The shim does not parse innerHTML; querySelector hands back one stable stub
// per selector, which is the contract confirmSheet actually relies on.
function tap(which) { sheet().querySelector('[data-' + which + ']').onclick(); }

print('=== never a one-tap toggle: doors, the alarm, the water, the heat ===');
[['lock.front_door_lock', {}], ['alarm_control_panel.alarm_panel_keypad', {}], ['valve.main_water_supply_valve', {}],
 ['climate.downstairs_ecobee_thermostat', {}], ['water_heater.wh', {}], ['cover.garage_door', { device_class: 'garage' }]
].forEach(function (x) {
  var t = actor({ entity: x[0] });
  t.hass.states[x[0]] = { entity_id: x[0], state: 'closed', attributes: x[1] };
  t._act({ action: 'toggle' }, false);
  ok(x[0] + ': toggle opens detail, calls nothing', [calls.length, fired[0]], [0, 'hass-more-info']);
});
var sh = actor({ entity: 'cover.living_room_shades' });
sh.hass.states['cover.living_room_shades'] = { entity_id: 'cover.living_room_shades', state: 'open', attributes: { device_class: 'shade' } };
sh._act({ action: 'toggle' }, false);
ok('a shade still toggles', calls[0], 'homeassistant.toggle');
var cf = actor({ entity: 'lock.front_door_lock' });
cf._act({ action: 'toggle', confirmation: { text: 'Unlock?' } }, false);
ok('a confirmed toggle on a lock opens detail without asking', [calls.length, fired[0]], [0, 'hass-more-info']);

print('=== without a confirmation, nothing changes ===');
var a = actor({ entity: 'switch.ecoflow_panel_c01' });
a._act({ action: 'toggle' }, false);
ok('toggle fires immediately', calls[0], 'homeassistant.toggle');
ok('and targets the entity', calls[1], { entity_id: 'switch.ecoflow_panel_c01' });

print('\n=== more-info, navigate, url, call-service still work ===');
a = actor({ entity: 'light.x' });
a._act(null, true);
ok('an absent action on the CARD opens detail', fired[0], 'hass-more-info');
a = actor({ entity: 'light.x' });
a._act(null, false);
ok('an absent action on an INNER element does nothing', fired.length, 0);
a = actor({ entity: 'light.x' });
a._act({ action: 'none' }, true);
ok('action: none does nothing', fired.length, 0);

history._pushed = [];
a = actor({ entity: 'x.y' });
a.style = { filter: '' };
__resetTimers();
a._act({ action: 'navigate', navigation_path: './ecoflow' }, false);
// THE PAGE CHANGES AT ONCE: no frame waited for, nothing dimmed
ok('navigate: at once, "./x" resolved against the current dashboard', history._pushed[0], '/lovelace-kitchen/ecoflow');
ok('...once', (__runTimers(), history._pushed.length), 1);
ok('...and the card is not dimmed', a.style.filter, '');
history._pushed = [];
a._act({ action: 'navigate', navigation_path: '/absolute/page' }, false);
__runTimers();
ok('an absolute path is untouched', history._pushed[0], '/absolute/page');

a = actor({ entity: 'x.y' });
a._act({ action: 'call-service', service: 'light.toggle',
         target: { entity_id: ['light.a', 'light.b'] } }, false);
ok('call-service splits the service', calls[0], 'light.toggle');
ok('and merges target into data', calls[1], { entity_id: ['light.a', 'light.b'] });

// A `[[[ ]]]` service is a button-card template these cards cannot evaluate.
// Falling through split() it would do NOTHING -- a dead tile, and no error.
a = actor({ entity: 'lock.x' });
var errs = 0, realErr = console.error;
console.error = function () { errs++; };
a._act({ action: 'call-service', service: "[[[ return 'lock.unlock'; ]]]" }, false);
console.error = realErr;
ok('a JS service calls nothing', calls.length, 0);
ok('and says so loudly', errs, 1);

print('\n=== navigation_path_map: the one carved-out dashboard ===');
var NAV = { action: 'navigate', navigation_path: './ecoflow',
            navigation_path_map: { 'energy-tablet': '/dashboard-home/power' } };
location.pathname = '/lovelace-kitchen/energy';
history._pushed = [];
actor({})._act(NAV, false);
__runTimers();
ok('an unlisted dashboard takes the default', history._pushed[0], '/lovelace-kitchen/ecoflow');
location.pathname = '/energy-tablet/energy';
history._pushed = [];
actor({})._act(NAV, false);
__runTimers();
ok('energy-tablet takes the override', history._pushed[0], '/dashboard-home/power');
location.pathname = '/lovelace-kitchen/energy';

print('\n=== confirmation ===');
var CONFIRM = { action: 'toggle', confirmation: { text: 'Change this circuit?' } };
a = actor({ entity: 'switch.ecoflow_panel_c01' });
a._act(CONFIRM, false);
ok('the service does NOT fire on the first tap', calls.length, 0);
ok('the sheet is open', sheetOpen(), true);

// Cancel.
tap('no');
ok('cancel closes it', sheetOpen(), false);
ok('cancel fires nothing', calls.length, 0);

// Confirm.
a = actor({ entity: 'switch.ecoflow_panel_c01' });
a._act(CONFIRM, false);
tap('yes');
ok('confirm fires the service', calls[0], 'homeassistant.toggle');
ok('on the right entity', calls[1], { entity_id: 'switch.ecoflow_panel_c01' });
ok('and closes the sheet', sheetOpen(), false);

// The guard must not be consumable: a second tap asks again.
a = actor({ entity: 'switch.ecoflow_panel_c01' });
a._act(CONFIRM, false);
ok('a second tap asks again', calls.length, 0);
tap('yes');
ok('and fires on confirm', calls[0], 'homeassistant.toggle');
// The spec object must not have been mutated -- it is the card's own config,
// so a mutated copy would permanently disarm the guard.
ok('the config is not mutated', CONFIRM._hkConfirmed, undefined);

// Confirmation guards EVERY action, not just toggle.
a = actor({ entity: 'x.y' });
history._pushed = [];
a._act({ action: 'navigate', navigation_path: '/p', confirmation: { text: 'Go?' } }, false);
ok('navigate is guarded too', history._pushed.length, 0);
tap('yes');
__runTimers();
ok('and navigates on confirm', history._pushed[0], '/p');

a = actor({ entity: 'x.y' });
a._act({ action: 'more-info', confirmation: { text: 'Open?' } }, false);
ok('more-info is guarded too', fired.length, 0);
tap('yes');
ok('and opens on confirm', fired[0], 'hass-more-info');

print('\n=== a right-click opens detail: a mouse\'s, never a finger\'s ===');
// what a tile does with its card: _bindDetail on the card element
function rightClick(cfg, ev, press) {
  var t = actor(cfg), el = document.createElement('div');
  t._bindDetail(el);
  if (press !== undefined) document.dispatchEvent({ type: 'pointerdown', pointerType: press });
  var stopped = { prevented: false };
  ev.preventDefault = function () { stopped.prevented = true; };
  ev.stopPropagation = function () {};
  (el._listeners.contextmenu || []).forEach(function (f) { f(ev); });
  return [fired[0] || null, stopped.prevented, calls.length];
}
ok('a mouse right-click on a light opens its detail, toggles nothing, hides the browser menu',
   rightClick({ entity: 'light.lamp', tap_action: { action: 'toggle' } }, { pointerType: 'mouse' }),
   ['hass-more-info', true, 0]);
ok('a long press on Android (a touch contextmenu) does nothing: no card has a hold',
   rightClick({ entity: 'light.lamp' }, { pointerType: 'touch' }), [null, false, 0]);
ok('a pen too', rightClick({ entity: 'light.lamp' }, { pointerType: 'pen' }), [null, false, 0]);
ok('Safari (no pointerType) after a mouse press: opens',
   rightClick({ entity: 'light.lamp' }, {}, 'mouse'), ['hass-more-info', true, 0]);
ok('Safari after a finger press: nothing',
   rightClick({ entity: 'light.lamp' }, {}, 'touch'), [null, false, 0]);
ok('an event that says it fires touch events: nothing',
   rightClick({ entity: 'light.lamp' }, { sourceCapabilities: { firesTouchEvents: true } }, 'mouse'), [null, false, 0]);
ok('a tile with no entity keeps the browser\'s menu',
   rightClick({ tap_action: { action: 'navigate', navigation_path: './x' } }, { pointerType: 'mouse' }), [null, false, 0]);
ok('a lock opens its detail (never toggles)',
   rightClick({ entity: 'lock.front_door_lock' }, { pointerType: 'mouse' }), ['hass-more-info', true, 0]);

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed'
                   : 'ALL ' + pass + ' ACTION TESTS PASS'));
