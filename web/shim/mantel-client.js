// Mantel's client port for compatibility snapshots made by mantel-host.js.
// It never imports the HA adapter or gives a host object to a state icon.
(function (global) {
  'use strict';
  var clients = new WeakMap();
  var hosts = new WeakMap();      // client -> the host object it was made from
  var gateway = null;             // the hub (web/shim/hub.js): {commandsEnabled(), command(body)}

  function fail(code, message, extra) {
    return Object.assign(new Error(message || code), { code: code }, extra || {});
  }
  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* shell tests */ }
  }
  // HK'S OWN SETTINGS SAVES (P3.5) are not house commands: Mantel's settings store answers them
  // (hub.write -> settings_write, RBAC `configure` on the server), on every server, commands on or off,
  // and nothing reaches Home Assistant. Exactly settings_store.SETTINGS_SAVES (a test pins the two
  // lists together); every other write still goes to the gateway, or is refused when commands are off.
  var SETTINGS_SAVES = ['hk_frontend/settings/set', 'hk_frontend/board/set', 'hk_frontend/tablet/set',
                        'hk_frontend/setup/done', 'hk_frontend/calendar/color', 'hk_frontend/chip/save',
                        'hk_frontend/chip/remove'];
  function isSave(msg) { return !!(msg && typeof msg.type === 'string' && SETTINGS_SAVES.indexOf(msg.type) >= 0); }
  function save(hub, msg) {
    return hub.write(msg).catch(function (e) {
      if (e && e.code === 'forbidden') emit('hk-command-denied', { what: String(msg.type), reason: 'forbidden', code: 'forbidden' });
      throw fail((e && e.code) || 'failed', (e && e.message) || 'the save failed');
    });
  }
  // Commands off (the default): the port's only action is a settings save; every other write and
  // every service call is refused here, before anything is sent, exactly as with no actions at all.
  function savesOn(port, hub) {
    port.actions = {
      callWS: function (msg) {
        if (isSave(msg)) return save(hub, msg);
        port.refused({ kind: 'ws', what: String(msg && msg.type) });
        return Promise.reject(fail('commands_disabled', 'commands disabled'));
      }
      // no callService / request / liveSocket: hkClient refuses them (commands_disabled), sending nothing
    };
  }
  // STEP-UP. The gateway answers a sensitive action without a fresh factor with step_up_required;
  // the page proves one (HK's prompt, web/shim/mantel-stepup.js, hears `hk-step-up-required` and
  // calls detail.done() once the server accepted an authenticator code or a passkey, or
  // detail.cancel()), and the same command is sent once more. A PIN (method `pin`: a person's PIN at
  // a wall tablet, or their own) goes back inside the command: detail.submit({method:'pin', pin})
  // sends it again with the PIN; a refused PIN answers {error, retry_after} and the prompt stays,
  // anything else ends it. With nobody to answer, it is refused (step_up_required).
  function stepUp(reply, what, resend) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var detail = {
        reason: reply.reason, methods: reply.methods || [], window: reply.window, action: reply.action,
        targets: reply.targets || [], what: what,
        done: function () { if (!settled) { settled = true; resolve(null); } },
        cancel: function () { if (!settled) { settled = true; reject(fail('step_up_cancelled', 'step-up cancelled')); } },
        submit: function (step) {
          if (settled) return Promise.resolve({ ok: true });
          return resend(step).then(function (r) {
            if (r && r.type === 'step_up_required' && r.pin_error) return { error: r.pin_error, retry_after: r.retry_after || 0 };
            if (!settled) { settled = true; resolve(r); }
            return { ok: true };
          });
        }
      };
      var heard = false;
      try { heard = !global.dispatchEvent(new CustomEvent('hk-step-up-required', { detail: detail, cancelable: true })); } catch (e) { /* shell tests */ }
      if (!heard) detail.cancel();
    });
  }
  var KEYPAD_CODES = ['invalid_code', 'code_locked', 'code_required'];
  function actionsOn(port, hub) {
    function settle(body, what, reply, tries) {
      if (reply && reply.type === 'step_up_required') {
        if (tries >= 2 || !(reply.methods || []).length) {
          emit('hk-command-denied', { what: what.what, reason: reply.reason });
          return Promise.reject(fail('step_up_required', reply.reason, { reason: reply.reason }));
        }
        var resend = function (step) { return hub.command(Object.assign({}, body, { step_up: step })); };
        return stepUp(reply, what, resend).then(function (answered) {
          if (answered) return settle(body, what, answered, tries + 1);     // the PIN went with it
          return hub.command(body).then(function (r) { return settle(body, what, r, tries + 1); });
        });
      }
      if (reply && reply.error) {
        var e = reply.error;
        if (e.code === 'commands_disabled') { port.refused(what); return Promise.reject(fail('commands_disabled', 'commands disabled')); }
        // THE ALARM KEYPAD (GATEWAY.md "The alarm"): a wrong, missing or locked-out code is the keypad
        // card's to say ("Wrong code", from the message); no "Not allowed" toast on top of it.
        if (KEYPAD_CODES.indexOf(e.code) >= 0) return Promise.reject(fail(e.code, e.message, { audit_id: reply.audit_id }));
        emit('hk-command-denied', { what: what.what, reason: e.reason || e.code, code: e.code });
        return Promise.reject(fail(e.code, e.message, { reason: e.reason, audit_id: reply.audit_id }));
      }
      return reply ? reply.result : undefined;
    }
    function run(body, what) {
      return hub.command(body).then(function (reply) { return settle(body, what, reply, 0); });
    }
    port.actions = {
      // HA's signature: (domain, service, serviceData, target, notifyOnError, returnResponse)
      callService: function (domain, service, data, target, notifyOnError, returnResponse) {
        var body = { kind: 'service', domain: domain, service: service };
        if (data) body.data = data;
        if (target) body.target = target;
        if (returnResponse) body.return_response = true;
        return run(body, { kind: 'service', what: domain + '.' + service });
      },
      callWS: function (msg) {
        if (isSave(msg)) return save(hub, msg);                  // HK's settings: the store, not HA
        return run({ kind: 'ws', msg: msg }, { kind: 'ws', what: String(msg && msg.type) });
      },
      // An authenticated write to the host's HTTP API, answered as fetch() would (a Response), so
      // readers written for HA's fetchWithAuth take it as is. JSON bodies, and ONE binary upload: the
      // doorbell's recorded talk-back clip (a Blob to TALK_PATH), sent as base64 in the same gateway
      // command (talkBody). Any other binary body is refused here, sending nothing.
      request: function (path, init) {
        init = init || {};
        var method = String(init.method || 'GET').toUpperCase();
        var p = String(path).indexOf('/api/') === 0 ? String(path) : '/api/' + String(path).replace(/^\/+/, '');
        var what = { kind: 'http', what: method + ' ' + p.split('?')[0] };
        var made;
        if (init.body != null && typeof init.body !== 'string') {
          made = talkBody(method, p, init);
          if (!made) return Promise.reject(fail('unsupported_body', 'Mantel forwards JSON bodies only'));
        } else {
          var body;
          if (init.body != null) {
            try { body = JSON.parse(init.body); } catch (e) { return Promise.reject(fail('unsupported_body', 'Mantel forwards JSON bodies only')); }
          }
          made = Promise.resolve({ kind: 'http', method: method, path: p, body: body });
        }
        return made.then(function (cmd) {
          return hub.command(cmd).then(function (reply) {
            var m = reply && reply.error && /^http_(\d{3})$/.exec(reply.error.code || '');
            if (m) return new Response(reply.error.message || '', { status: Number(m[1]) });
            return Promise.resolve(settle(cmd, what, reply, 0)).then(function (result) {
              return new Response(JSON.stringify(result === undefined ? null : result),
                                  { status: 200, headers: { 'content-type': 'application/json' } });
            });
          });
        });
      },
      // LIVE TALK (GATEWAY.md "Doorbell talk-back"): the card's Worker opens its own socket with
      // what this resolves ({url, token()}) and speaks HA's protocol on it. Here that socket is
      // Mantel's /ws/talk (hub.talkUrl(): under HA's Ingress prefix too), and the token a ONE-TIME
      // ticket the gateway issues for this speaker after deciding and auditing a `talk_live`
      // command (the same rules as the clip). Anything but a ticket -- refused, a step-up wanted,
      // commands off, no speaker -- is refused QUIETLY (`live_unavailable`, no toast, no prompt):
      // the card then sends its recorded clip through `request`, which asks for any step-up itself.
      liveSocket: function (speaker) {
        if (typeof speaker !== 'string' || !SPEAKER.test(speaker) || typeof hub.talkUrl !== 'function') {
          return Promise.reject(fail('live_unavailable', 'live talk needs the doorbell speaker; the clip is sent instead'));
        }
        return hub.command({ kind: 'talk_live', speaker: speaker }).then(function (reply) {
          var r = reply && reply.result, ticket = r && typeof r.ticket === 'string' ? r.ticket : '';
          if (!ticket) {
            var e = reply && reply.error;
            throw fail('live_unavailable', 'live talk is not available; the clip is sent instead',
                       { reason: (reply && reply.reason) || (e && (e.reason || e.code)) || 'refused' });
          }
          return { url: hub.talkUrl(), token: function () { return ticket; } };
        });
      }
    };
  }
  // THE ONE BINARY UPLOAD: HK's doorbell sheet POSTs its recorded clip (a Blob, audio/*) to
  // hk_frontend's talk view. The server holds the real allowlist (ha_client.TALK_PATH, UPLOAD_TYPES,
  // UPLOAD_MAX_BYTES); this mirrors it so nothing else is ever read or sent. Resolves the gateway
  // command, or null (refused, nothing read) for anything else.
  var TALK_PATH = /^\/api\/hk_frontend\/talk\?entity_id=media_player\.[a-z0-9_]+$/;
  var SPEAKER = /^media_player\.[a-z0-9_]+$/;          // live talk's one entity (ha_client.TALK_ENTITY)
  var TALK_TYPE = /^audio\/(webm|ogg|mp4|mpeg|aac|wav|x-wav)(\s*;.*)?$/i;
  var TALK_MAX = 512000;
  function header(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    for (var k in headers) if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === name) return headers[k];
    return null;
  }
  function talkBody(method, path, init) {
    var blob = init.body;
    if (method !== 'POST' || !TALK_PATH.test(path) || typeof Blob === 'undefined' || !(blob instanceof Blob)) return null;
    var type = String(header(init.headers, 'content-type') || blob.type || '');
    if (!TALK_TYPE.test(type)) return null;
    if (blob.size > TALK_MAX) return Promise.reject(fail('body_too_large', 'the clip is too long'));
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), bin = '';
      for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { kind: 'http', method: 'POST', path: path, content_type: type.split(';')[0].trim().toLowerCase(), body_b64: btoa(bin) };
    });
  }
  // home.js hands the hub over once it is connected; a port made after the server's capabilities
  // frame said `commands: true` carries actions, any other none.
  function useCommands(hub) { gateway = hub || null; }

  // MANTEL'S OWN FEATURES (docs/phase4/MANTEL-FEATURES.md). Four messages HK's shared code sends to
  // Home Assistant through the action port are, on Mantel, answers for Mantel's feature host and
  // never house commands (they leave through hub.screenReport / hub.notifyMute, on every server,
  // commands on or off; a service call or any other write still goes the way it did):
  //   hk_frontend/screensaver/touch {tablet, saver?}  -> screen_report {tablet, touch: true, saver?}
  //   hk_frontend/screensaver/black {tablet, black}   -> screen_report {tablet, black}
  //   hk_notify/mute {key, minutes}                   -> notify_mute {key, seconds}
  //   switch.turn_on|turn_off on a tablet's photo screensaver switch -> the page's own state only
  //     (Mantel's screens, mantel-host.js; the host has no such Home Assistant entity to write)
  var screens = null;             // the host adapter's {owns(entityId), set(entityId, on), reported(tablet, black)}
  function useScreens(host) { screens = host || null; }
  var TABLET_ID = /^[a-z0-9_]{1,40}$/;
  function screenReport(hub, msg) {
    var tid = msg.tablet;
    if (typeof tid !== 'string' || !TABLET_ID.test(tid)) return Promise.reject(fail('not_found', 'No such wall tablet'));
    var frame = { tablet: tid };
    if (msg.type === 'hk_frontend/screensaver/touch') {
      frame.touch = true;
      if (msg.saver === true) frame.saver = true;
    } else {
      if (typeof msg.black !== 'boolean') return Promise.reject(fail('invalid', 'black is true or false'));
      frame.black = msg.black;
      if (screens) screens.reported(tid, msg.black);          // the page is the truth about itself
    }
    return hub.screenReport(frame);
  }
  function notifyMute(hub, msg) {
    var minutes = msg.minutes === undefined ? 60 : msg.minutes;
    if (typeof msg.key !== 'string' || typeof minutes !== 'number' || Math.round(minutes) !== minutes || minutes < 0 || minutes > 1440) {
      return Promise.reject(fail('invalid', 'a notification key and 0 to 1440 minutes'));
    }
    return hub.notifyMute(msg.key, minutes * 60);
  }
  function withFeatures(port, hub) {
    var acts = port.actions;
    if (!acts || !hub || typeof hub.screenReport !== 'function') return;
    var callWS = acts.callWS, callService = acts.callService;
    acts.callWS = function (msg) {
      var t = msg && msg.type;
      if (t === 'hk_frontend/screensaver/touch' || t === 'hk_frontend/screensaver/black') return screenReport(hub, msg);
      if (t === 'hk_notify/mute') return notifyMute(hub, msg);
      // LIVE TV'S VIEWER HEARTBEAT (hk-tv-guide-card, on opening a channel and every 60 s while it plays):
      // in HA it names this screen in sensor.tv_viewers. A write, so the gateway's when commands are on;
      // with them off it is answered here, quietly and sending nothing (no "commands disabled" toast
      // a minute into a programme). docs/phase4/FEATURE-PARITY.md "Live TV".
      if (t === 'hk_tv/watching' && !(typeof hub.commandsEnabled === 'function' && hub.commandsEnabled())) {
        return Promise.resolve({ viewers: [] });
      }
      return callWS.apply(acts, arguments);
    };
    acts.callService = function (domain, service, data) {
      var id = data && data.entity_id;
      if (screens && domain === 'switch' && (service === 'turn_on' || service === 'turn_off') && typeof id === 'string' && screens.owns(id)) {
        screens.set(id, service === 'turn_on');
        return Promise.resolve([]);
      }
      if (typeof callService === 'function') return callService.apply(acts, arguments);
      // commands off: refused here exactly as the client's action port refuses a host without one
      port.refused({ kind: 'service', what: domain + '.' + service });
      return Promise.reject(fail('commands_disabled', 'commands disabled'));
    };
  }
  function from(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    // a client already (a shared caller passing on what it was given): as is
    if (global.hkClient && global.hkClient.is(snapshot)) return snapshot;
    if (clients.has(snapshot)) return clients.get(snapshot);
    var port = {};
    ['states', 'entities', 'devices', 'areas', 'floors', 'services', 'config', 'locale', 'language', 'user', 'themes', 'connected'].forEach(function (key) {
      Object.defineProperty(port, key, { get: function () { return snapshot[key]; } });
    });
    ['formatEntityState', 'formatEntityAttributeValue', 'formatEntityAttributeName', 'callWS', 'callApi'].forEach(function (key) {
      if (typeof snapshot[key] === 'function') port[key] = function () { return snapshot[key].apply(snapshot, arguments); };
    });
    Object.defineProperty(port, 'subscriptions', { get: function () { return global.hkClient.subscriptions(snapshot.connection); } });
    port.bindStateIcon = function (element, state) { element.stateObj = state; };
    // ACTIONS ONLY WHEN THE SERVER SAYS SO. On a server whose operator turned the command gateway on,
    // the socket's `capabilities` frame says `commands: true`, and this port then gets `actions`
    // that send gateway `command` messages over the hub socket (nothing else: the snapshot's own
    // service method is never reached). Otherwise (the default) the port's only action is HK's own
    // settings save (to Mantel's settings store): the client's action port refuses every service call
    // and every other write before anything is sent, and says so here (`refused`) so the page can show it.
    if (gateway && gateway.commandsEnabled()) actionsOn(port, gateway);
    else if (gateway && typeof gateway.write === 'function') savesOn(port, gateway);
    port.refused = function (detail) {
      try { global.dispatchEvent(new CustomEvent('hk-command-refused', { detail: detail })); } catch (e) { /* shell tests */ }
    };
    withFeatures(port, gateway);
    var client = global.hkClient.create(port);
    clients.set(snapshot, client);
    hosts.set(client, snapshot);
    return client;
  }
  // THE BRIDGE: how a parent hands a child element what goes with a client. The child takes
  // the host's object at its entry -- an element the host draws itself (a hui-card, ha-form, a
  // third-party card) needs exactly that, and an HK card turns it back into this client
  // (entry, below). Shared code passes clients only; the host's object is named only here.
  // A client this adapter did not make is handed over as itself, read-only.
  function bridge(element, client) {
    if (!element || !client) return;
    var host = hosts.get(client);
    if (host) element.hass = host; else element.client = client;
  }
  // THE LOVELACE ENTRY for a shared card that is not an HkBase (hk-row, hk-control, …).
  // The host sets `hass` on a card; the card never sees that object: it gets
  // `_onClient(client)` with this adapter's client for each new one, and reads
  // `this.client`. The getter gives the host (and a parent card) the object back.
  function entry(Ctor) {
    Object.defineProperty(Ctor.prototype, 'hass', {
      configurable: true,
      set: function (input) {
        this._hkInput = input;
        var c = from(input);
        this._hkEntryClient = c;
        var C = global.hkCards;
        if (C && typeof C.seen === 'function') C.seen(input);
        if (typeof this._onClient === 'function') this._onClient(c);
      },
      get: function () { return this._hkInput; }
    });
    if (!Object.prototype.hasOwnProperty.call(Ctor.prototype, 'client')) {
      Object.defineProperty(Ctor.prototype, 'client', {
        configurable: true,
        get: function () { return this._hkEntryClient || null; }
      });
    }
  }
  var latest = null;
  function setCurrent(snapshot) {
    var next = from(snapshot);
    if (next === latest) return;
    latest = next;
    try { global.dispatchEvent(new CustomEvent('hk-client-update')); } catch (e) { /* shell tests */ }
  }
  global.hkMantelClient = { from: from, current: function () { return latest; }, setCurrent: setCurrent, bridge: bridge, entry: entry,
                            useCommands: useCommands, useScreens: useScreens, kind: 'mantel', SETTINGS_SAVES: SETTINGS_SAVES.slice() };
  global.hkHostClient = global.hkMantelClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
