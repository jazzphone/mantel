// Notifications on a screen (modules/hk-notify.js): whether this screen
// shows one -- Allow Notifications, Do Not Disturb (hours and While), the
// screensaver's choice, asleep, the doorbell's pop-up -- and the HK Settings
// page's words for them (panels/hk-settings-features.js). Nothing here names
// a real house.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
var root = HK_ROOT;
load(root + '/tests/dom.js');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
}

location.pathname = '/dashboard-hall/0';
var threw = null;
try { load(root + '/frontend/modules/hk-notify.js'); } catch (e) { threw = e; }
ok('loads with no page to draw on', !threw && !!window.hkNotify, String(threw));
var N = window.hkNotify._;

// ---- the hours
function at(h, m) { var d = new Date(2026, 9, 11, h, m || 0); return d; }
ok('inside evening hours', N.inWindow(at(23), '22:00', '07:00'));
ok('inside past midnight', N.inWindow(at(6, 59), '22:00', '07:00'));
ok('not at seven', !N.inWindow(at(7), '22:00', '07:00'));
ok('a daytime window', N.inWindow(at(13), '12:00', '14:30') && !N.inWindow(at(14, 30), '12:00', '14:30'));
ok('from == to is all day', N.inWindow(at(3), '09:00', '09:00'));
ok('a bad time is never', !N.inWindow(at(3), '9pm', '07:00'));

// ---- Do Not Disturb
var DND = { schedule: true, from: '22:00', to: '07:00', 'while': ['input_boolean.movie', 'timer.nap'] };
ok('on in its hours', N.dndOn(DND, at(23), {}));
ok('off outside them, nothing on', !N.dndOn(DND, at(12), { 'input_boolean.movie': { state: 'off' } }));
ok('on while an input_boolean is on', N.dndOn(DND, at(12), { 'input_boolean.movie': { state: 'on' } }));
ok('on while a timer runs', N.dndOn(DND, at(12), { 'timer.nap': { state: 'active' } }));
ok('not while it is paused', !N.dndOn(DND, at(12), { 'timer.nap': { state: 'paused' } }));
ok('hours off: only While', !N.dndOn({ schedule: false, from: '00:00', to: '00:00', 'while': [] }, at(3), {}));
ok('none: off', !N.dndOn(null, at(23), {}));

// ---- decide
function ctx(o) {
  return Object.assign({ board: { notify: true }, editing: false, asleep: false, saver: false, now: at(12), states: {},
                         popOpen: function () { return false; }, popWould: function () { return false; } }, o || {});
}
var n = { title: 'Front Door', important: false, saver: 'important', dnd: null };
ok('a screen that allows them shows it', N.decide(n, ctx()) === 'show');
ok('not a screen of HK Frontend', N.decide(n, ctx({ board: null })) === 'drop:not-a-screen');
ok('Allow Notifications off', N.decide(n, ctx({ board: { notify: false } })) === 'drop:off');
ok('editing the dashboard', N.decide(n, ctx({ editing: true })) === 'drop:editing');
ok('All Screens’ Do Not Disturb', N.decide(Object.assign({}, n, { dnd: DND }), ctx({ now: at(23) })) === 'drop:dnd');
ok('...an Important one gets through', N.decide(Object.assign({}, n, { dnd: DND, important: true }), ctx({ now: at(23) })) === 'show');
ok('the screen’s own DND over All Screens’',
   N.decide(Object.assign({}, n, { dnd: DND }), ctx({ now: at(23), board: { notify_dnd: { schedule: false, 'while': [] } } })) === 'show');
ok('the screen’s own hours', N.decide(n, ctx({ now: at(13), board: { notify_dnd: { schedule: true, from: '12:00', to: '14:00', 'while': [] } } })) === 'drop:dnd');
ok('over the screensaver: All Screens says Important', N.decide(n, ctx({ saver: true })) === 'drop:saver');
ok('...an Important one shows', N.decide(Object.assign({}, n, { important: true }), ctx({ saver: true })) === 'show');
ok('...the screen says All', N.decide(n, ctx({ saver: true, board: { notify_saver: 'all' } })) === 'show');
ok('...the screen says Off', N.decide(Object.assign({}, n, { important: true }), ctx({ saver: true, board: { notify_saver: 'off' } })) === 'drop:saver');
ok('...one that wakes the screen shows over the photos (it stays on the screensaver)', N.decide(Object.assign({}, n, { wake: true }), ctx({ saver: true, board: { notify_saver: 'off' } })) === 'show');
ok('one that wakes, asleep, not Important: wakes it', N.decide(Object.assign({}, n, { wake: true }), ctx({ asleep: true })) === 'wake');
ok('...but Do Not Disturb wins', N.decide(Object.assign({}, n, { wake: true, dnd: DND }), ctx({ asleep: true, now: at(23) })) === 'drop:dnd');
ok('...unless it is Important', N.decide(Object.assign({}, n, { wake: true, important: true, dnd: DND }), ctx({ asleep: true, now: at(23) })) === 'wake');
ok('asleep: nothing', N.decide(Object.assign({}, n, { important: true }), ctx({ asleep: true })) === 'drop:asleep');
ok('asleep: one that wakes', N.decide(Object.assign({}, n, { important: true, wake: true }), ctx({ asleep: true })) === 'wake');
var bell = Object.assign({}, n, { pop: 'doorbell' });
ok('the doorbell over its pop-up: the pop-up alone', N.decide(bell, ctx({ popOpen: function (h) { return h === 'doorbell'; } })) === 'drop:popup');
ok('a screen that answers the pop-up waits for it', N.decide(bell, ctx({ popWould: function (h) { return h === 'doorbell'; } })) === 'wait-pop');
ok('a screen that does not shows it', N.decide(bell, ctx()) === 'show');
ok('sent to another screen', N.decide(Object.assign({}, n, { dashboards: ['dashboard-car'] }), ctx({ dash: 'dashboard-hall' })) === 'drop:elsewhere');
ok('...to this one', N.decide(Object.assign({}, n, { dashboards: ['dashboard-hall'] }), ctx({ dash: 'dashboard-hall' })) === 'show');
ok('sent to another person', N.decide(Object.assign({}, n, { users: ['u2'] }), ctx({ user: 'u1' })) === 'drop:elsewhere');
ok('a test shows past DND and the saver', N.decide(Object.assign({}, n, { test: true, dnd: DND }), ctx({ now: at(23), saver: true })) === 'show');
ok('a test that wakes the screen, asleep: wakes it', N.decide(Object.assign({}, n, { test: true, wake: true, important: true }), ctx({ asleep: true })) === 'wake');
ok('...over the screensaver: shown there', N.decide(Object.assign({}, n, { test: true, wake: true, important: true }), ctx({ saver: true })) === 'show');
ok('the chime: on for all', N.chimes({ chime: true }, false) && !N.chimes({ chime: true }, true));
ok('...off: only an Important one', !N.chimes({ chime: false }, false) && N.chimes({ chime: false, important: true }, false));
ok('a test that does not, asleep: nothing', N.decide(Object.assign({}, n, { test: true }), ctx({ asleep: true })) === 'drop:asleep');
ok('...but never where notifications are off', N.decide(Object.assign({}, n, { test: true }), ctx({ board: { notify: false } })) === 'drop:off');

// ---- words
ok('now, then minutes', N.ago(1000, 1000) === 'now' && N.ago(0, 120000) === '2m ago' && N.ago(0, 7200000) === '2h ago');
// ---- a tap: its sheet (the camera's for what a camera sees), a page, the camera, nothing
ok('a tap opens its sheet', JSON.stringify(N.target({ tap: 'sheet', entity: 'binary_sensor.door', sheet: 'binary_sensor.door' })) === '{"sheet":"binary_sensor.door"}');
ok('...the sheet the house names (the camera, for a person at the door)',
   N.target({ tap: 'sheet', entity: 'binary_sensor.front_person', sheet: 'camera.front' }).sheet === 'camera.front');
ok('...no sheet named: its accessory', N.target({ entity: 'lock.front' }).sheet === 'lock.front');
ok('a page', N.target({ tap: 'page', page: 'kitchen', entity: 'lock.front' }).page === 'kitchen');
ok('...a page not named: its sheet', N.target({ tap: 'page', entity: 'lock.front' }).sheet === 'lock.front');
ok('the live camera', N.target({ tap: 'camera', camera: 'camera.garage', entity: 'cover.garage' }).sheet === 'camera.garage');
ok('nothing', N.target({ tap: 'none', entity: 'lock.front' }) === null && N.target({ tap: 'sheet' }) === null);
ok('owns nothing before a banner', window.hkNotify.owns({ composedPath: function () { return []; } }) === false);

// ---- the settings page's words
load(root + '/frontend/panels/hk-settings-features.js');
var F = window.hkSettingsFeatures;
ok('listed once installed', F.listed({ hk_notify: { installed: true } }).some(function (x) { return x[1] === 'hk_notify'; }));
ok('stays', F._.stayLabel(0) === 'Until Dismissed' && F._.stayLabel(30) === '30 s' && F._.stayLabel(120) === '2 Minutes');
ok('Not Again For', F._.cooldownLabel(0) === 'Every Time' && F._.cooldownLabel(3600) === '1 Hour');
ok('a summary', F._.notifySummary({ when: 'on', choices: [['on', 'Detects a Person']], snap: true, camera: 'camera.x', important: true, wake: true })
   === 'Detects a Person · with a snapshot · Important · wakes the screen');
ok('Wakes the Screen: its own, else All Notifications\'', F._.wakesOf({ wake: null }, { wake: true }) && !F._.wakesOf({ wake: false }, { wake: true })
   && F._.wakesOf({ wake: true }, { wake: false }) && !F._.wakesOf({}, {}));
ok('Goes Off When: tabs for a few short ones', F._.whenControl([['on', 'Opens'], ['off', 'Closes'], ['any', 'Either']]) === 'seg');
ok('...a drop-down for more', F._.whenControl([['unlocked', 'Unlocks'], ['locked', 'Locks'], ['jammed', 'Jams'], ['any', 'Any Change']]) === 'select');
ok('DND summary', F.dndSummary({ schedule: true, from: '22:00', to: '07:00', 'while': ['input_boolean.x'] }) === '10:00 PM–7:00 AM, while 1 is on'
   && F.dndSummary(null) === 'Off' && F.dndSummary({ schedule: false, 'while': [] }) === 'Off');
ok('a trigger in its own words', F._.trigWord({ name: function () { return 'Front Door Camera Person detected'; } }, 'binary_sensor.x', 'Front Door Camera') === 'Person detected'
   && F._.trigWord({ name: function () { return 'Porch Motion'; } }, 'binary_sensor.y', 'Front Door Camera') === 'Porch Motion');
ok('a search for quiet hours finds it', F.search({ hk_notify: { installed: true } }).some(function (e) { return e.label === 'Do Not Disturb'; }));

// NO BLUE BOX UNDER A FINGER (2026-10-13): the layer's `all:initial` drops
// the transparent tap highlight every HK surface sets, so it sets its own
(function () {
  var src = readFile(HK_ROOT + '/frontend/modules/hk-notify.js');
  ok('a banner swiped away draws no tap highlight', /':host\{all:initial;[^']*-webkit-tap-highlight-color:transparent\}'/.test(src) &&
     /'\.layer,\.layer \*\{[^']*-webkit-tap-highlight-color:transparent\}'/.test(src));
})();

// TAKEN DOWN ELSEWHERE: a `notification_dismiss` house event ({id}) takes that banner down on this screen
// (the house heard a Dismiss somewhere else, e.g. a phone); nothing to take down is no error
(function () {
  var threw = null;
  try { window.hkNotify.dismissId('n1'); } catch (e) { threw = e; }
  ok('dismissId: there, and harmless with nothing shown', typeof window.hkNotify.dismissId === 'function' && !threw, String(threw));
  var src = readFile(HK_ROOT + '/frontend/modules/hk-notify.js');
  ok('...the house event takes the banner with that id down', /n\.type === 'notification_dismiss' && n\.id != null\) dismissId\(n\.id\)/.test(src) &&
     /String\(it\.n\.id\) === String\(id\)\) dismiss\(it\)/.test(src));
})();

// OVER THE SCREENSAVER THE WHOLE SCREEN, whenever it came (2026-10-20): the
// layer spans the screen (`.sv`) while the screensaver runs. It was set only
// as a banner showed, so one shown the moment the black ended (one that wakes
// the screen; the screensaver is back ~2.5 s later) or any still up as the
// screensaver started kept short of the dashboard's Now Playing pane:
// centered over the photo, not the screen (a vacuum's, on a wall tablet)
(function () {
  var saverUp = false, threw = null, before = null, after = null, gone = null;
  // (the shim's <div> has no shadow root: the layer's host is given one)
  var noShadow = !El.prototype.attachShadow;
  if (noShadow) El.prototype.attachShadow = HTMLElement.prototype.attachShadow;
  // (...nor a page: a <body> for the layer, an <html> for the look)
  var noBody = !document.body, noRoot = !document.documentElement;
  if (noBody) document.body = new El('body');
  if (noRoot) document.documentElement = new El('html');
  window.hkSaver = { running: function () { return saverUp; }, black: function () { return false; } };
  try {
    window.hkNotify.show({ id: 'vac', title: 'Offline Robot', message: 'Finished cleaning', entity: 'vacuum.proof_robot', stay: 0, wake: true });
    var L = window.hkNotify._.state().layer;
    before = L && L.className;
    saverUp = true;
    window.dispatchEvent(new CustomEvent('hk-saver', { detail: { on: true } }));
    after = L && L.className;
    saverUp = false;
    window.dispatchEvent(new CustomEvent('hk-saver', { detail: { on: false } }));
    gone = L && L.className;
  } catch (e) { threw = e; }
  var sv = function (c) { return / sv(\s|$)/.test(String(c)); };
  ok('a banner shown before the screensaver: the page\'s width', !threw && before != null && !sv(before), String(threw) + ' ' + before);
  ok('...the screensaver comes up under it: the whole screen', sv(after), after);
  ok('...and goes: the page\'s again', gone != null && !sv(gone), gone);
  try { window.hkNotify.clear(); } catch (e) { /* none */ }
  if (noShadow) delete El.prototype.attachShadow;
  if (noBody) delete document.body;
  if (noRoot) delete document.documentElement;
  delete window.hkSaver;
})();

print('\n' + (fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL ' + pass + ' NOTIFICATION TESTS PASS'));
if (fail) throw new Error(fail + ' failed');
