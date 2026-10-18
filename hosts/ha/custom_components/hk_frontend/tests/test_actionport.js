// Phase 1 slice 6: ONE ACTION PORT for every service call and write.
//
// In the Home Assistant host the port performs the real call: the frontend's
// own callService/callWS, with exactly the arguments the old code passed (the
// same service, data, target, notifyOnError, returnResponse; the same
// message). In the Mantel host it refuses with `commands_disabled` and sends
// nothing. Reads stay on the read-only client, which refuses a write message.
//
// Every "host" here is a recorder over fictional entities. No service call
// reaches anything else.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run actionport');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = window.customCards || [];
load(HK_ROOT + '/tests/sample_settings.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-security.js');
load(HK_ROOT + '/frontend/cards/hk-control.js');
load(HK_ROOT + '/frontend/cards/hk-library.js');
load(HK_ROOT + '/frontend/modules/hk-timers.js');

function drain() { for (var i = 0; i < 8; i++) drainMicrotasks(); }
var STATES = {
  'light.porch': { entity_id: 'light.porch', state: 'off', attributes: {} },
  'cover.blind': { entity_id: 'cover.blind', state: 'closed', attributes: { device_class: 'blind' } },
  'cover.garage': { entity_id: 'cover.garage', state: 'closed', attributes: { device_class: 'garage' } },
  'timer.tea': { entity_id: 'timer.tea', state: 'active',
                 attributes: { duration: '0:05:00', remaining: '0:05:00', finishes_at: new Date(Date.now() + 120000).toISOString() } },
  'alarm_control_panel.house': { entity_id: 'alarm_control_panel.house', state: 'armed_away', attributes: { code_format: 'number' } }
};
// A frontend object that records EVERYTHING sent: each call's full argument
// list (so the arity is pinned too) and its receiver.
function recorder() {
  var rec = { sent: [], receivers: [] };
  rec.hass = {
    states: STATES, user: { name: 'Kitchen Tablet', is_admin: false },
    callService: function () {
      rec.receivers.push(this);
      rec.sent.push(['callService'].concat(Array.prototype.slice.call(arguments)));
      return Promise.resolve({ context: {}, response: { ok: true, leader: 'media_player.den' } });
    },
    callWS: function (msg) { rec.receivers.push(this); rec.sent.push(['callWS', msg]); return Promise.resolve({ ok: true }); }
  };
  return rec;
}
// THE MANTEL HOST'S CONTRACT (web/shim/mantel-client.js): a port with no
// action transport and a `refused` hook. Its snapshot has a callService that
// must never be reached.
function mantelHost() {
  var m = { refused: [], reached: [] };
  m.snapshot = { states: STATES, user: { name: 'Mantel viewer' },
                 callService: function () { m.reached.push(Array.prototype.slice.call(arguments)); return Promise.resolve(); },
                 callWS: function (msg) { m.reached.push(msg); return Promise.resolve(); } };
  m.client = window.hkClient.create({
    get states() { return m.snapshot.states; }, get user() { return m.snapshot.user; },
    callWS: function (msg) { return m.snapshot.callWS(msg); },
    refused: function (detail) { m.refused.push(detail); }
  });
  m.adapter = { from: function () { return m.client; }, current: function () { return m.client; },
                bridge: function (el) { el.client = m.client; }, kind: 'mantel' };
  return m;
}
var HkBase = window.hkCards.HkBase;
// A card as Lovelace shows it: handed the host input (HA) or a client (Mantel).
function card(Proto, config, rec, m) {
  var c = Object.create(Proto);
  c._config = config;
  c.events = [];
  c.dispatchEvent = function (e) { c.events.push(e.type); };
  if (m) { c._clientExplicit = true; c._hkClient = m.client; } else hkGive(c, rec.hass);
  return c;
}
function same(name, got, want) { return H.eq(name, got, want); }

// The scenarios. Each acts as the frontend does and says what the old code
// sent for it (read off the code this slice replaced: HkBase._call passed
// three arguments, _callErr five, _callResp six; the timer strip, the
// thermostat/media control and the library wrote straight to the host).
function scenarios() {
  return [
    { name: 'light toggle (a tile tap)', run: function (rec, m) {
        var c = card(HkBase.prototype, { entity: 'light.porch' }, rec, m);
        c._act({ action: 'toggle' }, true);
      }, want: [['callService', 'homeassistant', 'toggle', { entity_id: 'light.porch' }]] },
    { name: 'cover open (perform-action with a target)', run: function (rec, m) {
        var c = card(HkBase.prototype, { entity: 'cover.blind' }, rec, m);
        c._act({ action: 'perform-action', perform_action: 'cover.open_cover', target: { entity_id: 'cover.blind' } }, true);
      }, want: [['callService', 'cover', 'open_cover', { entity_id: 'cover.blind' }]] },
    { name: 'a door cover is never one tap (toggle opens its sheet)', run: function (rec, m) {
        var c = card(HkBase.prototype, { entity: 'cover.garage' }, rec, m);
        c._act({ action: 'toggle' }, true);
        return c;
      }, want: [], after: function (c) { return c.events.join() === 'hass-more-info'; } },
    { name: 'alarm code (the PIN path: notifyOnError false)', run: function (rec, m) {
        var K = customElements.get('hk-alarm-keypad-card');
        var c = card(K.prototype, { entity: 'alarm_control_panel.house' }, rec, m);
        c._code = '1234'; c._msg = ''; c._paint = function () {};
        if (m) hkGive(c, m.snapshot);              // the keypad still reads its host input (slice 9)
        c._alarm('alarm_disarm');
      }, want: [['callService', 'alarm_control_panel', 'alarm_disarm',
                 { entity_id: 'alarm_control_panel.house', code: '1234' }, undefined, false]] },
    { name: 'lock (a sheet control)', run: function (rec, m) {
        card(HkBase.prototype, { entity: 'lock.front' }, rec, m)._call('lock', 'unlock', { entity_id: 'lock.front' });
      }, want: [['callService', 'lock', 'unlock', { entity_id: 'lock.front' }]] },
    { name: 'climate setpoint (the thermostat card)', run: function (rec, m) {
        var c = Object.create(customElements.get('hk-control-card').prototype);
        Object.defineProperty(c, 'client', { value: window.hkHostClient.from(m ? m.snapshot : rec.hass) });
        c._svc('climate', 'set_temperature', { entity_id: 'climate.hall', temperature: 70 });
      }, want: [['callService', 'climate', 'set_temperature', { entity_id: 'climate.hall', temperature: 70 }]] },
    { name: 'media volume (the media control card)', run: function (rec, m) {
        var c = Object.create(customElements.get('hk-control-card').prototype);
        Object.defineProperty(c, 'client', { value: window.hkHostClient.from(m ? m.snapshot : rec.hass) });
        c._svc('media_player', 'volume_set', { entity_id: 'media_player.den', volume_level: 0.4 });
      }, want: [['callService', 'media_player', 'volume_set', { entity_id: 'media_player.den', volume_level: 0.4 }]] },
    { name: 'timer finish (the strip\'s pill)', run: function () { window.hkTimers.act('timer.tea', 'finish'); },
      want: [['callService', 'timer', 'finish', { entity_id: 'timer.tea' }]] },
    { name: 'timer start (restart at its length)', run: function () { window.hkTimers.act('timer.tea', 'restart'); },
      want: [['callService', 'timer', 'start', { entity_id: 'timer.tea', duration: '0:05:00' }]] },
    { name: 'button press (a scene pill)', run: function (rec, m) {
        card(HkBase.prototype, { entity: 'button.doorbell_chime' }, rec, m)._act(window.hkCards.sceneTap('button.doorbell_chime'), true);
      }, want: [['callService', 'button', 'press', { entity_id: 'button.doorbell_chime' }]] },
    { name: 'scene', run: function (rec, m) {
        card(HkBase.prototype, { entity: 'scene.movie' }, rec, m)._act(window.hkCards.sceneTap('scene.movie'), true);
      }, want: [['callService', 'scene', 'turn_on', { entity_id: 'scene.movie' }]] },
    { name: 'music play (a blocking call with its response)', run: function (rec, m, out) {
        var c = card(HkBase.prototype, {}, rec, m);
        c._callResp('hk_frontend', 'music_play', { rooms: ['media_player.den'], playlist: 'evening' }).then(function (r) { out.r = r; });
      }, want: [['callService', 'hk_frontend', 'music_play', { rooms: ['media_player.den'], playlist: 'evening' }, undefined, false, true]],
      result: function (out, m) {
        return m ? (out.r && out.r.ok === false && /commands disabled/.test(out.r.error))
                 : (out.r && out.r.ok === true && out.r.response.leader === 'media_player.den');
      } },
    { name: 'a WebSocket write (the Music page in use)', run: function (rec, m) {
        var c = card(customElements.get('hk-library-card').prototype, {}, rec, m);
        c._inUse();
      }, want: [['callWS', { type: 'hk_music/used' }]] }
  ];
}

H.run('ACTION PORT', [function () {
  H.section('the port');
  var rec = recorder(), c = window.hkHAClient.from(rec.hass);
  H.ok('every client has one frozen action port: callService, callWS, request and liveSocket',
       Object.isFrozen(c.actions) && typeof c.actions.callService === 'function' && typeof c.actions.callWS === 'function' &&
       window.hkClient.ACTIONS.join() === 'callService,callWS,request,liveSocket');
  H.ok('the read surface still has no service call', !('callService' in c));
  c.actions.callService('light', 'turn_on', { entity_id: 'light.porch' });
  c.actions.callService('hk_frontend', 'music_play', { rooms: [] }, undefined, false, true);
  var msg = { type: 'hk_notify/mute', key: 'door', minutes: 60 };
  c.actions.callWS(msg);
  H.eq('HA: the caller\'s own arguments reach callService (arity kept)', rec.sent[0].length, 4);
  H.eq('...six when the caller passed six', rec.sent[1].length, 7);
  H.ok('...the same message object reaches callWS', rec.sent[2][1] === msg);
  H.ok('...on the frontend\'s own object', rec.receivers.every(function (r) { return r === rec.hass; }));
}, function () {
  H.section('reads and writes are told apart');
  var rec = recorder(), c = window.hkHAClient.from(rec.hass), codes = [];
  var writes = window.hkClient.WRITES;
  H.ok('the write list names the slice\'s known writes', ['hk_notify/mute', 'config/entity_registry/update', 'hk_frontend/hidden/set',
       'hk_energy/device/set', 'hk_frontend/board/favorite', 'hk_music/queue_play', 'frontend/set_user_data',
       'hk_frontend/screensaver/touch', 'hk_frontend/screensaver/black', 'call_service']
       .every(function (t) { return writes.indexOf(t) >= 0; }));
  return Promise.all(writes.map(function (t) {
    return c.callWS({ type: t }).then(function () { codes.push('sent'); }, function (e) { codes.push(e.code); });
  })).then(function () {
    H.ok('the read path refuses every write before the host', rec.sent.length === 0 &&
         codes.every(function (x) { return x === 'read_only'; }), codes);
    H.ok('hkClient.isWrite agrees', writes.every(function (t) { return window.hkClient.isWrite({ type: t }); }) &&
         !window.hkClient.isWrite({ type: 'history/history_during_period' }));
    return c.callWS({ type: 'history/history_during_period', entity_ids: ['light.porch'] });
  }).then(function () {
    H.ok('a read reaches the host unchanged', rec.sent.length === 1 && rec.sent[0][1].type === 'history/history_during_period');
  });
}, function () {
  H.section('a client with no action transport refuses');
  var refused = [], c = window.hkClient.create({ states: {}, refused: function (d) { refused.push(d); } });
  var errs = [];
  return Promise.all([
    c.actions.callService('lock', 'unlock', { entity_id: 'lock.front' }).catch(function (e) { errs.push(e.code); }),
    c.actions.callWS({ type: 'hk_notify/mute' }).catch(function (e) { errs.push(e.code); })
  ]).then(function () {
    H.ok('both reject with commands_disabled', errs.join() === 'commands_disabled,commands_disabled', errs);
    H.eq('...and the host is told what was refused', refused, [{ kind: 'service', what: 'lock.unlock' }, { kind: 'ws', what: 'hk_notify/mute' }]);
  });
}, function () {
  H.section('Home Assistant: the same messages as before');
  var root = { hass: null };
  var qs0 = document.querySelector;
  document.querySelector = function (s) { return s === 'home-assistant' ? root : qs0.call(document, s); };
  scenarios().forEach(function (sc) {
    var rec = recorder(), out = {};
    root.hass = rec.hass;
    var ret = sc.run(rec, null, out);
    drain();
    same('HA ' + sc.name, rec.sent, sc.want);
    if (sc.after) H.ok('...' + sc.name + ': as before', sc.after(ret));
    if (sc.result) H.ok('...' + sc.name + ': its answer comes back', sc.result(out, null), out.r);
    H.ok('...on the frontend\'s own object', rec.receivers.every(function (r) { return r === rec.hass; }));
  });
  document.querySelector = qs0;
}, function () {
  H.section('Mantel: nothing is sent, commands_disabled is surfaced');
  var HC0 = window.hkHostClient, err0 = console.error, logged = [];
  console.error = function () { logged.push(Array.prototype.slice.call(arguments)); };
  var total = 0;
  scenarios().forEach(function (sc) {
    var rec = recorder(), m = mantelHost(), out = {};
    window.hkHostClient = m.adapter;
    var ret = sc.run(rec, m, out);
    drain();
    total += sc.want.length;
    H.ok('Mantel ' + sc.name + ': nothing sent', rec.sent.length === 0 && m.reached.length === 0, { sent: rec.sent, reached: m.reached });
    H.eq('...refused, once per action', m.refused.length, sc.want.length);
    if (sc.after) H.ok('...' + sc.name + ': still opens its sheet', sc.after(ret));
    if (sc.result) H.ok('...' + sc.name + ': the refusal comes back as the answer', sc.result(out, m), out.r);
  });
  window.hkHostClient = HC0;
  console.error = err0;
  var disabled = logged.filter(function (l) { return l.some(function (x) { return x && x.code === 'commands_disabled'; }); });
  H.ok('HkBase logs each refused card action with code commands_disabled', disabled.length >= 6, disabled.length);
  H.ok('every scenario was refused (' + total + ' actions)', total === 12);
}, function () {
  H.section('a read-only card cannot slip a toggle past the door guard');
  var refusedAny = 0, c = Object.create(HkBase.prototype);
  c._config = { entity: 'cover.garage' }; c.events = []; c.dispatchEvent = function (e) { c.events.push(e.type); };
  c._clientExplicit = true;
  c._hkClient = window.hkClient.create({ states: STATES, refused: function () { refusedAny++; } });
  c._act({ action: 'toggle' }, true);
  drain();
  H.ok('the guard reads the client: a garage toggle opens its sheet, no command at all', c.events.join() === 'hass-more-info' && refusedAny === 0);
}]);
