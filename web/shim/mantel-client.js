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
                        'hk_frontend/chip/remove',
                        // accessories, favorites and Hidden Accessories: the store too (accessories.py, hidden.py)
                        'hk_frontend/accessory/into', 'hk_frontend/accessory/order', 'hk_frontend/accessory/page_order',
                        'hk_frontend/accessory/room_scenes', 'hk_frontend/accessory/set', 'hk_frontend/board/favorite',
                        'hk_frontend/hidden/also', 'hk_frontend/hidden/set',
                        // Wall Tablets: Add and Remove, and a screen title: the store too (a tablet is a document)
                        'hk_frontend/tablet/add', 'hk_frontend/tablet/remove', 'hk_frontend/dashboard/titled'];
  // HK SETTINGS -> FEATURES saves (docs/phase4/MANTEL-FEATURES.md "HK Settings -> Features"): the same
  // way, to Mantel's feature settings (settings_store.FEATURE_SAVES, a test pins the two lists together;
  // RBAC `configure` on the server). Music's settings (house/music) and the Alarm PIN's (Mantel's keypad table)
  // are Mantel's too, so HK Frontend can leave Home Assistant (docs/phase9/MANTEL-LINK.md "Parity").
  var FEATURE_SAVES = ['hk_notify/settings/set', 'hk_notify/item/save', 'hk_notify/item/remove', 'hk_notify/test',
                       'hk_clean_areas/settings/set', 'hk_energy/settings/set', 'hk_energy/device/set',
                       'hk_energy/device/section', 'hk_tv/settings/set',
                       'hk_music/settings/set', 'hk_music/item/remove', 'hk_music/playlist/save',
                       'hk_music/playlists/order', 'hk_music/preset/save',
                       'hk_alarm_pin/settings/set', 'hk_alarm_pin/add', 'hk_alarm_pin/remove',
                       'hk_notify/feature/set', 'hk_clean_areas/feature/set', 'hk_energy/feature/set',
                       'hk_tv/feature/set', 'hk_music/feature/set', 'hk_alarm_pin/feature/set',
                       'mantel/features/auto/set'];
  function isSave(msg) {
    return !!(msg && typeof msg.type === 'string' && (SETTINGS_SAVES.indexOf(msg.type) >= 0 || FEATURE_SAVES.indexOf(msg.type) >= 0));
  }
  // A save that needs a fresh sign-in (the Alarm PIN's, alarm_pin.py settings_save) asks Mantel Settings'
  // own Confirm It Is You (settingsHost().stepUp), then is sent once more.
  function confirmed(e) {
    var host = null;
    try { host = window.hkShell && window.hkShell.settingsHost ? window.hkShell.settingsHost() : null; } catch (x) { host = null; }
    if (!e || e.code !== 'step_up_required' || !host || typeof host.stepUp !== 'function') return Promise.resolve(false);
    return Promise.resolve(host.stepUp()).catch(function () { return false; });
  }
  function save(hub, msg) {
    return hub.write(msg).catch(function (e) {
      return confirmed(e).then(function (yes) {
        if (!yes) throw e;
        return hub.write(msg);
      });
    }).catch(function (e) {
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
  // NO STEP-UP (decision 25): the gateway asks for no PIN and no second factor, so no prompt is drawn
  // here. A `step_up_required` reply (only an older server sends one) is refused like any other.
  var KEYPAD_CODES = ['invalid_code', 'code_locked', 'code_required'];
  function actionsOn(port, hub) {
    function settle(body, what, reply) {
      if (reply && reply.type === 'step_up_required') {
        emit('hk-command-denied', { what: what.what, reason: reply.reason, code: 'step_up_required' });
        return Promise.reject(fail('step_up_required', reply.reason, { reason: reply.reason }));
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
      // (the iPhone app's haptics listen: shim/mantel-native.js; nothing else does)
      emit('mantel-command', { kind: what.kind, what: what.what });
      return hub.command(body).then(function (reply) { return settle(body, what, reply); });
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
            return Promise.resolve(settle(cmd, what, reply)).then(function (result) {
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
      // command (the same rules as the clip). Anything but a ticket -- refused, commands off, no
      // speaker -- is refused QUIETLY (`live_unavailable`, no toast): the card then sends its
      // recorded clip through `request`, which says any refusal itself.
      // ...and the card waits this long for the doorbell to listen before it sends the clip instead: a press
      // here passes the gateway and /ws/talk before Home Assistant (HK in Home Assistant waits 1.5 s)
      liveWaitMs: 4000,
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
      },
      // THE INTERCOM (docs/phase17/INTERCOM.md): intercom(mode, rate) is ONE gateway `intercom` command (decided and
      // audited on the server) and resolves {url, token} for hk-mic.js's Worker -- Mantel's /ws/intercom and the
      // one-time ticket. Refused, it rejects with the gateway's own code (commands_disabled, forbidden, unavailable,
      // intercom_off) for the sheet to say; nothing is opened.
      intercom: function (mode, rate) {
        if ((mode !== 'message' && mode !== 'live') || !(rate >= 8000 && rate <= 96000) || typeof hub.intercomUrl !== 'function') {
          return Promise.reject(fail('invalid', 'the Intercom needs a mode and a sample rate'));
        }
        return hub.command({ kind: 'intercom', mode: mode, rate: Math.round(rate) }).then(function (reply) {
          var r = reply && reply.result, ticket = r && typeof r.ticket === 'string' ? r.ticket : '';
          if (!ticket) {
            var e = reply && reply.error;
            throw fail((e && e.code) || 'unavailable', (e && e.message) || 'the Intercom is not available', { reason: e && e.reason });
          }
          return { url: hub.intercomUrl(), token: ticket };
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
  //   hk_music/used                                   -> music_used (music.py: Keep Playlists Ready waits)
  //   switch.turn_on|turn_off on a tablet's photo screensaver switch -> the page's own state only
  //     (Mantel's screens, mantel-host.js; the host has no such Home Assistant entity to write)
  // HK'S PER-PERSON USER DATA (user_data.py): the few keys HK keeps with frontend/set_user_data are Mantel's
  // own per person (or per tablet), not Home Assistant's: sent as `user_data_set`, on every server, commands on
  // or off, never a command and never forwarded. Exactly user_data.KEYS (a test pins the two lists together);
  // any other key goes the way it did (the gateway, or refused when commands are off).
  var USER_DATA_KEYS = ['hk_music_focus', 'favorites', 'intercom'];
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
  var CHANNEL_NO = /^\d{1,4}(\.\d{1,4})?$/;
  function tvWatching(hub, msg, acts, callWS) {
    var ch = msg.channel === undefined ? null : msg.channel;
    if (ch !== null && (typeof ch !== 'string' || !CHANNEL_NO.test(ch))) return Promise.reject(fail('invalid', 'a channel number or null'));
    if (typeof hub.tvWatching !== 'function') return Promise.resolve({ viewers: [] });
    // the wall tablet this page is: Mantel keeps that tablet's Sleep Screen awake while a channel plays
    // (live_tv.py Viewers.tablets; only where the page may speak for it)
    var HS = global.hkSettings, HC = global.hkHostClient, tb = null;
    try { tb = HS && HS.tablet ? HS.tablet(HC && HC.current ? HC.current() : null) : null; } catch (e) { tb = null; }
    var tid = tb && !tb.legacy && typeof tb.id === 'string' ? tb.id : null;
    return hub.tvWatching(ch, tid).then(function (res) {
      var commands = typeof hub.commandsEnabled === 'function' && hub.commandsEnabled();
      if (!(res && res.ha === true) || !commands || typeof callWS !== 'function') return { viewers: (res && res.viewers) || [] };
      return callWS.call(acts, { type: 'hk_tv/watching', channel: ch });
    });
  }
  // All Tablets' "Restart all now" (hk_frontend/tablet/act {tablet: '*', act: 'restart_all'}): Mantel's
  // tablets piece runs it as the person who asked, each press a gateway command (refused and audited
  // while house commands are off). Answered as HA answers: {restarted: [tablet ids]}.
  function tabletsRestart(hub) {
    if (typeof hub.ask !== 'function') return Promise.reject(fail('commands_disabled', 'commands disabled'));
    return hub.ask('tablets_restart', {}).then(function (r) { return { restarted: (r && r.restarted) || [] }; });
  }
  function tabletAct(hub, msg) {
    if (typeof hub.ask !== 'function') return Promise.reject(fail('commands_disabled', 'commands disabled'));
    return hub.ask('tablet_act', { tablet: String(msg.tablet), act: String(msg.act) });
  }
  var LIBRARY_KEYS = ['type', 'domain', 'service', 'service_data', 'return_response'];
  // Music Assistant's services that only answer: Browse's library, Up Next's queue (the Music page and the
  // screensaver), the screensaver's search for the next song's cover. Each is Mantel's read music_assistant/<service>.
  var MA_READ_SERVICES = ['get_library', 'get_queue', 'search'];
  function isLibraryRead(msg) {
    return !!msg && msg.type === 'call_service' && msg.domain === 'music_assistant' &&
      MA_READ_SERVICES.indexOf(msg.service) >= 0 && msg.return_response === true && Object.keys(msg).every(function (k) { return LIBRARY_KEYS.indexOf(k) >= 0; }) &&
      (msg.service_data === undefined || (msg.service_data !== null && typeof msg.service_data === 'object' && !Array.isArray(msg.service_data)));
  }
  // answered as Home Assistant's WebSocket does a service call with a response: {response: <HA's answer>}; a picture
  // on Mantel's /ma proxy gets the page's prefix in front (HA App mode serves Mantel under Ingress), wherever it sits
  function libraryRead(hub, msg) {
    var q = Object.assign({}, msg.service_data || {}, { type: 'music_assistant/' + msg.service });
    return hub.read(q).then(function (res) {
      var base = global.__mantelBase || '';
      var fix = function (v, depth) {
        if (Array.isArray(v)) return depth > 6 ? v : v.map(function (x) { return fix(x, depth + 1); });
        if (!v || typeof v !== 'object' || depth > 6) return v;
        var out = {};
        Object.keys(v).forEach(function (k) {
          var x = v[k];
          out[k] = k === 'image' && typeof x === 'string' && /^\/ma\/imageproxy[?/]/.test(x) ? base + x : fix(x, depth + 1);
        });
        return out;
      };
      if (msg.service === 'get_library') return { response: { items: fix((res && res.items) || [], 0) } };
      return { response: fix(res || {}, 0) };
    });
  }
  function withFeatures(port, hub) {
    var acts = port.actions;
    if (!acts || !hub || typeof hub.screenReport !== 'function') return;
    var callWS = acts.callWS, callService = acts.callService;
    acts.callWS = function (msg) {
      var t = msg && msg.type;
      if (t === 'hk_frontend/screensaver/touch' || t === 'hk_frontend/screensaver/black') return screenReport(hub, msg);
      if (t === 'hk_notify/mute') return notifyMute(hub, msg);
      if (t === 'frontend/set_user_data' && USER_DATA_KEYS.indexOf(msg.key) >= 0 && typeof hub.ask === 'function') {
        return hub.ask('user_data_set', { key: msg.key, value: msg.value === undefined ? null : msg.value }).then(function () { return null; });
      }
      if (t === 'hk_frontend/tablet/act' && msg.act === 'restart_all') return tabletsRestart(hub);
      // Wake Now, Sleep Now, the kiosk screensaver's Fix: Mantel's own (features.py tablet_act), never HA's
      if (t === 'hk_frontend/tablet/act') return tabletAct(hub, msg);
      // a page that looks like a wall tablet's: HK Frontend kept it as a suggestion; Mantel enrols tablets itself
      if (t === 'hk_frontend/tablet/seen') return Promise.resolve({});
      // LIVE TV'S VIEWER HEARTBEAT (hk-tv-guide-card, on opening a channel and every 60 s while it plays):
      // counted by Mantel (tv_watching; live_tv.py), never a command, on every server, commands on or off.
      // Where Mantel serves Live TV it publishes sensor.tv_viewers itself. Where Home Assistant's Live TV is
      // still the interim (the answer says `ha: true`), HA keeps sensor.tv_viewers: with commands on the
      // heartbeat ALSO goes to HA through the gateway, as before. docs/phase4/FEATURE-PARITY.md "Live TV".
      if (t === 'hk_tv/watching') return tvWatching(hub, msg, acts, callWS);
      // BROWSE'S LIBRARY (hk-library.js: Discover's shelves and every category list) asks
      // music_assistant.get_library over the socket; Up Next (the Music page, the screensaver) asks get_queue, and the
      // screensaver's next-song cover asks search. Reads of Music Assistant, never commands: each is sent as Mantel's
      // read `music_assistant/<service>` (music.py), on every server, commands on or off, nothing audited and nothing
      // reaching Home Assistant (2026-10-31). Only those services with return_response; anything else about
      // call_service is a command as before. Mantel without Music Assistant answers `ma_not_configured`: the call then
      // goes the old way (the gateway: Home Assistant's, or refused when commands are off).
      if (isLibraryRead(msg) && typeof hub.read === 'function') {
        return libraryRead(hub, msg).catch(function (e) {
          if (e && e.code === 'ma_not_configured') return callWS.call(acts, msg);
          throw e;
        });
      }
      // THE MUSIC PAGE IS IN USE (hk-library.js, on a browse, a search or a play): in HA it only tells Keep
      // Playlists Ready to wait. Not a command (nothing reaches Music Assistant or HA): Mantel's music host
      // answers `music_used` on every server, commands on or off (docs/phase4/MANTEL-FEATURES.md "Music").
      if (t === 'hk_music/used' && typeof hub.ask === 'function') return hub.ask('music_used', {}).then(function () { return null; });
      return callWS.apply(acts, arguments);
    };
    acts.callService = function (domain, service, data) {
      var id = data && data.entity_id;
      if (screens && domain === 'switch' && (service === 'turn_on' || service === 'turn_off') && typeof id === 'string' && screens.owns(id)) {
        var on = service === 'turn_on';
        screens.set(id, on);
        // HK's photo screensaver came up / went away: told to the server (screen_report {tablet, photos}),
        // so Mantel's Sleep Screen reads it; a refusal changes nothing here (the page's own state stays)
        var w = typeof screens.which === 'function' ? screens.which(id) : null;
        if (w && w.kind === 'photos' && TABLET_ID.test(w.tablet)) {
          hub.screenReport({ tablet: w.tablet, photos: on }).catch(function () { /* the page's own state stays */ });
        }
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
    // WHICH STREAM A CAMERA PLAYS (2026-11-02, the owner: low for tiles, high for pop-ups): Mantel's own cameras
    // play the stream the card asks for (connectors.split_quality, which also takes it off before Home Assistant)
    port.cameraOffer = function (msg, quality) {
      return Object.assign({}, msg, { mantel_quality: quality === 'low' || quality === 'medium' ? quality : 'high' });
    };
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
    // THE INTERCOM'S FEED is a read (the rooms this person may reach), offered on every server that has it, commands on or off:
    // the sheet draws either way, and only the press that opens the microphone is a command (actions.intercom)
    if (gateway && typeof gateway.intercomSubscribe === 'function') {
      // (a clip's address on this page's own prefix -- HA App mode serves Mantel under Ingress -- so the shared card needs none)
      port.intercom = { subscribe: function (cb) {
        return gateway.intercomSubscribe(function (ev, err) {
          var p = ev && ev.play;
          if (p && typeof p.url === 'string' && p.url.charAt(0) === '/') ev = Object.assign({}, ev, { play: Object.assign({}, p, { url: (global.__mantelBase || '') + p.url }) });
          cb(ev, err);
        });
      } };
    }
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
    // A CHILD WHOSE CODE HAS NOT ARRIVED (2026-10-29: Mantel loads some card files on first use,
    // hk-loader.js hkNeed): `hass` set on an element before it is upgraded stays the element's own
    // property and hides its class's setter for good -- the card never got a client, read nothing and
    // drew nothing (a Cameras page opened straight away). Handed over once it is defined, the last one.
    var name = element.localName || '', ce = global.customElements;
    if (name.indexOf('-') > 0 && ce && ce.get && !ce.get(name) && ce.whenDefined) {
      var first = !element.__hkLate;
      element.__hkLate = client;
      if (first) {
        ce.whenDefined(name).then(function () {
          var c = element.__hkLate;
          delete element.__hkLate;
          if (ce.upgrade) { try { ce.upgrade(element); } catch (e) { /* upgraded already */ } }
          bridge(element, c);
        });
      }
      return;
    }
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
        set: function (value) {
          this._hkEntryClient = from(value);
          if (typeof this._onClient === 'function') this._onClient(this._hkEntryClient);
        },
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
                            useCommands: useCommands, useScreens: useScreens, kind: 'mantel', SETTINGS_SAVES: SETTINGS_SAVES.slice(),
                            FEATURE_SAVES: FEATURE_SAVES.slice() };
  global.hkHostClient = global.hkMantelClient;
  try { global.dispatchEvent(new CustomEvent('hk-host-client-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
