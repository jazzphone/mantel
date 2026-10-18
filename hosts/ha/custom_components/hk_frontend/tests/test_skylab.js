// Sky Lab's lockdown (modules/hk-skylab.js): on a real dashboard (?skylab)
// only messages that READ may leave the page. It was a list of write verbs,
// and hk_frontend/talk/live -- the tablet's microphone to the doorbell
// speaker -- passed it (2026-10-07 audit).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var pass = 0, fail = 0;
function ok(n, c) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n); } }

// just enough page for the module to load and stop: no body, no connection
var started = 0;
globalThis.window = globalThis;
globalThis.document = { getElementById: function () { return null; }, body: null, documentElement: { appendChild: function () {} },
  createElement: function () { return { style: {}, remove: function () {} }; }, querySelector: function () { return null; } };
globalThis.sessionStorage = { getItem: function () { return null; }, setItem: function () {} };
globalThis.setInterval = function () { started++; return 1; };
globalThis.clearInterval = function () {};
globalThis.setTimeout = function () { return 1; };
load(HK_ROOT + '/frontend/modules/hk-skylab.js');
var R = window.hkSkyLab && window.hkSkyLab._ && window.hkSkyLab._.isRead;
ok('the lockdown\'s rule is exported', typeof R === 'function');

['subscribe_entities', 'subscribe_events', 'unsubscribe_events', 'get_states', 'ping', 'render_template',
 'lovelace/config', 'frontend/get_themes', 'frontend/subscribe_user_data', 'config/area_registry/list',
 'config/entity_registry/list_for_display', 'hk_frontend/settings/subscribe', 'hk_music/subscribe',
 'history/history_during_period', 'recorder/statistics_during_period', 'camera/webrtc/offer',
 'weather/subscribe_forecast', 'media_source/browse_media'].forEach(function (t) {
  ok('reads go out: ' + t, R(t));
});
['call_service', 'execute_script', 'fire_event', 'hk_frontend/talk/live', 'hk_frontend/board/set',
 'hk_frontend/screensaver/touch', 'hk_frontend/accessory/order', 'backup/generate', 'conversation/process',
 'supervisor/api', 'energy/save_prefs', 'lovelace/config/save', 'calendar/event/create',
 'config/entity_registry/update', 'frontend/set_user_data', 'something/new'].forEach(function (t) {
  ok('everything else is held: ' + t, !R(t));
});

print(fail ? 'FAIL ' + fail + ' SKY LAB TESTS' : 'ALL ' + pass + ' SKY LAB TESTS PASS');
