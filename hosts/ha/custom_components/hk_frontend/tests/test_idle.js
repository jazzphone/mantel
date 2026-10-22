// Per-tablet return-to-home preferences in hk-idle.js.
var DIR = HK_ROOT + '/';
load(DIR + 'tests/dom.js');

var pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}

location.pathname = '/dashboard-kitchen/lights';
history = {
  pushState: function (_state, _title, path) { location.pathname = path; }
};
var haRoot = null;
document.querySelector = function (selector) {
  return selector === 'home-assistant' ? haRoot : null;
};

load(DIR + 'tests/sample_settings.js');
load(DIR + 'frontend/modules/hk-idle.js');

function state(value) { return { state: String(value), attributes: {} }; }
function setStates(states) {
  haRoot = { hass: { states: states || {} } };
  window.hkIdle.set(null);
  return window.hkIdle.status();
}

print('=== fallback ===');
ok('no hass keeps the original 50 seconds', window.hkIdle.status().idleMs === 50000);
var status = setStates({});
ok('missing helper keeps the original 50 seconds', status.idleMs === 50000);

print('\n=== fixed options ===');
var choices = {
  'Quick 30s': 30000,
  'Normal 50s': 50000,
  'Relaxed 2 min (may return behind screensaver)': 120000,
  'Never': 0
};
Object.keys(choices).forEach(function (choice) {
  var states = {};
  states['input_select.kitchen_tablet_idle_return'] = state(choice);
  var got = setStates(states);
  ok(choice + ' maps to ' + choices[choice] + 'ms', got.idleMs === choices[choice],
    'got ' + got.idleMs);
  if (choice === 'Never') ok('Never leaves no timer armed', !got.armed);
});

print('\n=== Auto ===');
var auto = {
  'input_select.kitchen_tablet_idle_return': state('Auto (10s before Room Idle)'),
  'input_number.kitchen_tablet_room_idle': state('45'),
  'input_number.tablet_room_idle_default': state('90')
};
status = setStates(auto);
ok('Auto follows the room value minus 10 seconds', status.idleMs === 35000,
  'got ' + status.idleMs);
auto['input_number.kitchen_tablet_room_idle'] = state('0');
status = setStates(auto);
ok('Auto follows the house default when room is 0', status.idleMs === 80000,
  'got ' + status.idleMs);
auto['input_number.tablet_room_idle_default'] = state('15');
status = setStates(auto);
ok('Auto has a 10-second floor', status.idleMs === 10000, 'got ' + status.idleMs);

print('\n=== exclusions and console override ===');
location.pathname = '/dashboard-tesla/lights';
status = setStates(auto);
ok('the Tesla dashboard is excluded', !status.onSubview && !status.armed);
location.pathname = '/dashboard-kitchen/lights';
window.hkIdle.set(0);
ok('hkIdle.set(0) still disables the timer', window.hkIdle.status().idleMs === 0 &&
  !window.hkIdle.status().armed);
window.hkIdle.set(null);
ok('hkIdle.set(null) returns to the helper', window.hkIdle.status().idleMs === 10000);


// ---------------------------------------------------------------------------
// STILL BEING USED -> DO NOT YANK THE PAGE
//
// The listeners reset on pointerdown/touchmove/wheel/keydown/click, which is
// every way of TOUCHING a page and no way of READING one: without the in-use
// sensor, someone reading a page is sent back to the main dashboard.
// hkIdle.now() is goHome, so these drive the real decision.
print('\n=== defers while the tablet is in use ===');

function atLights() { location.pathname = '/dashboard-kitchen/lights'; }
function withUse(v) {
  var s = {};
  if (v !== null) s['binary_sensor.kitchen_tablet_in_use'] = state(v);
  haRoot = { hass: { states: s } };
}

atLights(); withUse('off');
window.hkIdle.now();
ok('not in use: still returns home', location.pathname === '/dashboard-kitchen/0',
   'got ' + location.pathname);

atLights(); withUse('on');
window.hkIdle.now();
ok('IN USE: stays on the page', location.pathname === '/dashboard-kitchen/lights',
   'got ' + location.pathname);
ok('  and re-arms rather than giving up', window.hkIdle.status().armed === true);

// Unknowable behaves exactly as if there were no in-use sensor at all -- a
// tablet we cannot ask about is not one to second-guess the timer on.
atLights(); withUse('unavailable');
window.hkIdle.now();
ok('sensor unavailable: unchanged, returns home',
   location.pathname === '/dashboard-kitchen/0', 'got ' + location.pathname);

atLights(); withUse(null);
window.hkIdle.now();
ok('no such sensor: unchanged, returns home',
   location.pathname === '/dashboard-kitchen/0', 'got ' + location.pathname);

atLights(); haRoot = null;
window.hkIdle.now();
ok('no hass at all: unchanged, returns home',
   location.pathname === '/dashboard-kitchen/0', 'got ' + location.pathname);

// The main dashboard is not a subview, so nothing should fire there whatever
// the sensor says -- the in-use check must not accidentally arm a timer.
location.pathname = '/dashboard-kitchen/0'; withUse('on');
window.hkIdle.now();
ok('on the dashboard itself: no navigation, in use or not',
   location.pathname === '/dashboard-kitchen/0');

// The first view by its own PATH is home too -- read from the dashboard's
// config, not from a naming convention.
var panel = { tagName: 'HA-PANEL-LOVELACE', lovelace: { config: { views: [{ path: 'home' }, { path: 'lights' }] } } };
var savedQSA = document.querySelectorAll;
document.querySelectorAll = function (sel) { return sel === '*' ? [panel] : []; };
location.pathname = '/dashboard-kitchen/home'; withUse('off');
window.hkIdle.now();
ok('the first view by its path is already home', location.pathname === '/dashboard-kitchen/home',
   'got ' + location.pathname);
location.pathname = '/dashboard-kitchen/lights'; location.search = '?kiosk';
window.hkIdle.now();
ok('another view returns home, keeping the query string',
   location.pathname === '/dashboard-kitchen/0?kiosk', 'got ' + location.pathname);
location.search = '';
document.querySelectorAll = savedQSA;

print('\n=== 1.14: the tablet\'s own Idle (its item, not the screen\'s helpers) ===');
var HS = window.hkSettings;
var feed = JSON.parse(JSON.stringify(HK_SAMPLE_SETTINGS));
feed.tablet_items = {
  kitchen: { name: 'Kitchen', screen: 'dashboard-kitchen', room: 'kitchen', user: 'kitchen', app: 'kiosk_satellite',
             idle_return: true, idle_time: 30, black_screen: 'hk', screensaver_switch: null, black_switch: null },
  hall: { name: 'Hall', screen: 'dashboard-home', room: 'hall', user: '', app: 'browser',
          idle_return: false, idle_time: 50, black_screen: 'kiosk', screensaver_switch: null, black_switch: null }
};
HS._apply(feed);
function asUser(name, states) {
  haRoot = { hass: { states: states || {}, user: { name: name } } };
  window.hkIdle.set(null);
  return window.hkIdle.status();
}
location.pathname = '/dashboard-kitchen/lights';
var st14 = asUser('kitchen', { 'input_select.kitchen_tablet_idle_return': state('Never') });
ok('signed in as the kitchen tablet: its own 30 s, the old helper ignored', st14.idleMs === 30000 && st14.armed,
   JSON.stringify(st14));
st14 = asUser('Mark');
ok('a desk on the same screen: no tablet, nothing armed', !st14.armed && !st14.onSubview, JSON.stringify(st14));
feed.tablet_items.kitchen.idle_time = 0; HS._apply(feed);
st14 = asUser('kitchen');
ok('Idle Time Never: nothing armed', st14.idleMs === 0 && !st14.armed, JSON.stringify(st14));
feed.tablet_items.kitchen.idle_time = 120; feed.tablet_items.kitchen.idle_return = false; HS._apply(feed);
st14 = asUser('kitchen');
ok('Return to Home off: not armed', !st14.armed && !st14.onSubview, JSON.stringify(st14));
localStorage.setItem('hk-tablet', 'hall');
feed.tablet_items.hall.idle_return = true; HS._apply(feed);
st14 = asUser('Mark');
ok('known by its address (hk-tablet remembered): the hall tablet, whoever is signed in', st14.armed && st14.idleMs === 50000,
   JSON.stringify(st14));
localStorage.removeItem('hk-tablet');

// A HOME GRID BLOCK OFF ITS START PAGE (docs/phase11/HOME-GRID.md, G4): the
// pager says away(); the timer then arms on Home too, and its firing sends
// hk-idle-return -- and navigates nowhere, Home is where it is.
print('\n=== a block away from its start page, on Home ===');
feed.tablet_items.kitchen.idle_time = 30; feed.tablet_items.kitchen.idle_return = true; HS._apply(feed);
var returned = 0;
window.addEventListener('hk-idle-return', function () { returned++; });
location.pathname = '/dashboard-kitchen/0';
var stH = asUser('kitchen');
ok('on Home with every block on its start page: nothing armed', !stH.armed, JSON.stringify(stH));
window.hkIdle.away('pager-1', true);
stH = window.hkIdle.status();
ok('a pager away: the timer arms on Home', stH.armed && stH.aways.join() === 'pager-1', JSON.stringify(stH));
window.hkIdle.now();
ok('its firing sends the return, and stays on Home', returned === 1 && location.pathname === '/dashboard-kitchen/0',
   returned + ' ' + location.pathname);
window.hkIdle.away('pager-1', false);
ok('back on its start page: nothing armed', !window.hkIdle.status().armed && !window.hkIdle.status().aways.length);
window.hkIdle.away('pager-1', true);
st14 = asUser('Mark');
ok('a desk on the same screen: no return for its blocks either', !st14.armed, JSON.stringify(st14));
window.hkIdle.away('pager-1', false);
location.pathname = '/dashboard-kitchen/lights';
asUser('kitchen');
window.hkIdle.now();
ok('the return from a page goes Home and says so too', location.pathname === '/dashboard-kitchen/0' && returned === 2,
   returned + ' ' + location.pathname);

print('\n' + (fail ? 'FAILURES: ' + fail : 'ALL ' + pass + ' IDLE TESTS PASS'));