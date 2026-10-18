// hk-strategy.js reads a CLIENT (Phase 1 slice 10): Lovelace calls the
// strategy's static hooks (generate, shouldRegenerate) with its own frontend
// object, each hook converts it at the door, and everything inside reads only
// the client. These scenarios pin that:
//   * the frontend's object and the client made from it build the same
//     dashboard, room page and rebuild answers (the HA build is unchanged);
//   * a client made from bare data (no host adapter, no frontend object at
//     all) builds the same dashboard too -- the build reads nothing the client
//     does not offer, music's question included (client.subscriptions);
//   * an adapter's client is taken as it is, never wrapped again (a wrapped
//     client would have no subscription port, so no music pages);
//   * the frontend object's write paths are never touched by a build;
//   * the helpers on window.hkStrategy take either, with the same answers.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
function st(id, s, a) { return { entity_id: id, state: s, attributes: a || {} }; }

// A small fictional house: two floors, a few rooms, an alarm, weather,
// a camera, a thermostat and a speaker.
function house() {
  var S = {};
  [st('light.kitchen_table_light', 'on', { friendly_name: 'Kitchen Table Light' }),
   st('switch.kitchen_coffee', 'off', { friendly_name: 'Kitchen Coffee' }),
   st('lock.front', 'locked', { friendly_name: 'Front Door' }),
   st('cover.garage', 'closed', { friendly_name: 'Garage Door', device_class: 'garage' }),
   st('cover.den_blinds', 'open', { friendly_name: 'Den Blinds' }),
   st('media_player.den_speaker', 'idle', { friendly_name: 'Den Speaker' }),
   st('climate.den', 'heat', { friendly_name: 'Den Thermostat', current_temperature: 68 }),
   st('sensor.den_battery', '80', { friendly_name: 'Den Blinds Battery', device_class: 'battery' }),
   st('camera.porch', 'idle', { friendly_name: 'Porch' }),
   st('weather.home', 'sunny', {}), st('sun.sun', 'above_horizon', {}),
   st('alarm_control_panel.house', 'disarmed', { friendly_name: 'House Alarm' })
  ].forEach(function (s) { S[s.entity_id] = s; });
  return {
    states: S, themes: { themes: { 'HK Kiosk': {} } }, config: { unit_system: { temperature: '°F' } },
    user: { name: 'Fictional' }, language: 'en', locale: { language: 'en' },
    floors: { up: { floor_id: 'up', name: 'Upstairs', level: 2 }, main: { floor_id: 'main', name: 'Main', level: 1 } },
    areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen', floor_id: 'main' },
             den: { area_id: 'den', name: 'Den', floor_id: 'up' },
             garage: { area_id: 'garage', name: 'Garage', floor_id: 'main' } },
    devices: { d1: { area_id: 'den' } },
    entities: {
      'light.kitchen_table_light': { area_id: 'kitchen' }, 'switch.kitchen_coffee': { area_id: 'kitchen' },
      'lock.front': { area_id: 'garage' }, 'cover.garage': { area_id: 'garage' },
      'cover.den_blinds': { device_id: 'd1' }, 'sensor.den_battery': { device_id: 'd1' },
      'media_player.den_speaker': { area_id: 'den' }, 'climate.den': { area_id: 'den' },
      'camera.porch': { area_id: 'garage' }, 'alarm_control_panel.house': { area_id: 'garage' }
    }
  };
}
// Music is set up (one speaker): the strategy asks once, on the subscription
// port, and closes it.
function musicTransport(log) {
  return { subscribeMessage: function (cb, msg) {
    log.push(msg.type);
    cb({ configured: true, speakers: [{ entity: 'media_player.den_speaker' }] });
    return Promise.resolve(function () { log.push('closed'); });
  } };
}
// The frontend's object, its write paths trapped: a build must never reach them.
var writes = [];
function frontendObject(log) {
  var h = house();
  h.connection = musicTransport(log);
  ['callService', 'callWS', 'callApi', 'fetchWithAuth'].forEach(function (k) {
    h[k] = function () { writes.push(k); return Promise.reject(new Error('not in a build')); };
  });
  return h;
}
// A client from bare data, made by HKClient itself: no host adapter, no frontend object.
function bareClient(log) {
  var data = house(), transport = musicTransport(log), port = {};
  Object.keys(data).forEach(function (k) {
    Object.defineProperty(port, k, { get: function () { return data[k]; } });
  });
  Object.defineProperty(port, 'subscriptions', { get: function () { return window.hkClient.subscriptions(transport); } });
  return window.hkClient.create(port);
}
function paths(cfg) { return cfg.views.map(function (v) { return v.path; }); }

var S = window.hkStrategy, HC = window.hkHostClient;
var logRaw = [], logAd = [], logBare = [];
var raw = frontendObject(logRaw), viaAdapter = HC.from(frontendObject(logAd)), bare = bareClient(logBare);
var ref = null;

Promise.all([S.generate({}, raw), S.generate({}, viaAdapter), S.generate({}, bare)]).then(function (out) {
  ref = JSON.stringify(out[0]);
  ok('the dashboard has its music pages (the question went through the client\'s subscription port)',
     paths(out[0]).indexOf('playmusic') > 0 && paths(out[0]).indexOf('music-browse') > 0, paths(out[0]));
  ok('...asked once and closed', JSON.stringify(logRaw) === '["hk_music/subscribe","closed"]', logRaw);
  ok('the frontend\'s object and the adapter\'s client build the same dashboard', JSON.stringify(out[1]) === ref);
  ok('...the adapter\'s client taken as it is (its music question asked once, on its own port)',
     JSON.stringify(logAd) === '["hk_music/subscribe","closed"]', logAd);
  ok('a client from bare data (no frontend object at all) builds the same dashboard', JSON.stringify(out[2]) === ref);
  ok('...its music question on its own subscription port', JSON.stringify(logBare) === '["hk_music/subscribe","closed"]', logBare);
  ok('a build touches none of the frontend object\'s write paths', writes.length === 0, writes);
  // the same object again: the same client (one per object), the same dashboard
  return S.generate({}, raw);
}).then(function (again) {
  ok('the same frontend object again: the same dashboard', JSON.stringify(again) === ref);
  ok('...the adapter makes one client per object', HC.from(raw) === HC.from(raw));
  // with music off nothing is asked, whichever is handed in
  var before = logBare.length;
  return S.generate({ music: false }, bare).then(function (cfg) {
    ok('music: false -- no question asked, no music pages', logBare.length === before && paths(cfg).indexOf('playmusic') < 0);
  });
}).then(function () {
  // THE ROOM VIEW STRATEGY (hand-built dashboards): the same page from either
  return Promise.all([S.room({ area: 'den' }, raw), S.room({ area: 'den' }, viaAdapter), S.room({ area: 'den' }, bare)]);
}).then(function (rv) {
  ok('the room page: a page with its cards', rv[0].type === 'custom:hk-grid-view' && rv[0].cards.length > 0 && rv[0].theme === 'HK Kiosk', rv[0]);
  ok('...the same from the frontend\'s object, the adapter\'s client and a bare client',
     JSON.stringify(rv[1]) === JSON.stringify(rv[0]) && JSON.stringify(rv[2]) === JSON.stringify(rv[0]));
}).then(function () {
  // WHEN HOME ASSISTANT BUILDS AGAIN: the same answers from objects or clients
  var a = house(), b = house(), moved = house();
  moved.entities['lock.front'] = { area_id: 'kitchen' };
  var cases = [['the same registries', a, b, false], ['an entity moved', a, moved, true]];
  cases.forEach(function (c) {
    var objs = S.shouldRegenerate({}, c[1], c[2]);
    var clients = S.shouldRegenerate({}, HC.from(c[1]), HC.from(c[2]));
    var mixed = S.shouldRegenerate({}, c[1], HC.from(c[2]));
    ok('rebuild? ' + c[0] + ': ' + c[3] + ' from objects, clients, or one of each',
       objs === c[3] && clients === c[3] && mixed === c[3], [objs, clients, mixed]);
  });
  ok('rebuild? nothing to compare with: yes', S.shouldRegenerate({}, null, a) === true && S.shouldRegenerate({}, a, undefined) === true);
}).then(function () {
  // THE EXPORTED HELPERS (other cards and the console call them): either kind in, the same out
  var h = frontendObject([]), c = HC.from(h);
  var same = function (name, f) { ok('hkStrategy.' + name + ': the same from the object and its client',
                                     JSON.stringify(f(h)) === JSON.stringify(f(c)), [f(h), f(c)]); };
  same('rooms', function (x) { return S.rooms(x, {}); });
  same('roomCards', function (x) { return S.roomCards(x, ['den'], 'Den', {}); });
  same('tileFor', function (x) { return S.tileFor(x, 'lock.front', 'Front Door'); });
  same('pageMembers', function (x) { return S.pageMembers(x, 'security', {}); });
  same('climateMembers', function (x) { return S.climateMembers(x, {}); });
  same('groupOf', function (x) { return S.groupOf(x, 'cover.den_blinds'); });
  same('batteryOf', function (x) { return S.batteryOf(x, 'cover.den_blinds'); });
  ok('...batteryOf finds the device\'s battery', S.batteryOf(c, 'cover.den_blinds') === 'sensor.den_battery', S.batteryOf(c, 'cover.den_blinds'));
  ok('hkStrategy.saverBlock: nothing handed in, no block', S.saverBlock(null, { screensaver: true }) === null);
  ok('...and the helpers never touched a write path', writes.length === 0, writes);
}).then(function () {
  print(fail ? 'FAIL ' + fail + ' STRATEGY CLIENT TESTS' : 'ALL ' + pass + ' STRATEGY CLIENT TESTS PASS');
}).catch(function (e) { print('Exception: ' + e + ' ' + (e.stack || '')); });
