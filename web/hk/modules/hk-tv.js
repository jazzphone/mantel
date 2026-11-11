// hk-tv.js -- A ROOM'S TV, READ (phase 23, 2026-11-10; docs/phase23/TV.md, hk_core/tv.py has the rules). The owner: "a user may want
// real tv controls (inputs..possible real volume if offered) and Apple TV controls maybe at the same time"; arrow keys, not a touchpad.
//
// A ROOM'S SET is its TV (a media_player with device_class tv) and the player beside it (an Apple TV: a media_player that reports
// app_id, or the apple_tv platform), found by their Home Assistant area. Accessories -> TVs (settings.features.tv_sets) says what
// Automatic can't. The block, the sheet and Show When read only what this file returns; each card runs the calls it hands back.
//
//   hkTv.sets(client)                  every room's set: {id, name, area, tv, player, remotes, input, volume, hidden}
//   hkTv.setFor(client, key)           one set by a TV, a player, an area or 'tablet_room' (the wall tablet's room), else null
//   hkTv.look(client, set)             what it is doing: {on, tvOn, playerOn, title, sub, app, art, playing, source, inputs, volume, arrows}
//   hkTv.press(client, set, to, key)   one remote key (up down left right select back home play_pause) for 'player' or 'tv': [call]
//   hkTv.apps(client, set, show, n)    the apps a block or the sheet offers: [{name, id, icon, glyph, now}]
//   hkTv.open(client, set, name)       [calls] that bring an app up from wherever the room is: on, the player's input, the app
//   hkTv.power(client, set) / volume(client, set, how, v)   [calls]
//   hkTv.isOn(client, key)             Show When's TV Is On: a set's TV or player is on
//
// A call is [domain, service, data]; data names its entity_id. Nothing here talks to Home Assistant.
// @ts-check
(function (global) {
  'use strict';
  if (global.hkTv) return;

  var SENSOR = 'sensor.hk_tv';
  var OFF = { off: 1, standby: 1, unavailable: 1, unknown: 1, '': 1 };
  var F = { VOLUME_SET: 4, VOLUME_MUTE: 8, TURN_ON: 128, TURN_OFF: 256, VOLUME_STEP: 1024, SELECT_SOURCE: 2048 };
  // A REMOTE KEY, BY BRAND (one table: a new brand is one line). [domain, service, the data's key, {key: its word}] -- 'remote'
  // sends remote.send_command to the device's remote entity; webOS has no remote entity, its buttons are a service on the TV.
  var KEYS = ['up', 'down', 'left', 'right', 'select', 'back', 'home', 'play_pause'];
  var REMOTES = {
    apple_tv: ['remote', { up: 'up', down: 'down', left: 'left', right: 'right', select: 'select', back: 'menu', home: 'home', play_pause: 'play_pause' }],
    roku: ['remote', { up: 'up', down: 'down', left: 'left', right: 'right', select: 'select', back: 'back', home: 'home', play_pause: 'play' }],
    webostv: ['webostv', { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', select: 'ENTER', back: 'BACK', home: 'HOME', play_pause: null }],
    samsungtv: ['remote', { up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', select: 'KEY_ENTER', back: 'KEY_RETURN', home: 'KEY_HOME', play_pause: 'KEY_PLAY' }],
    androidtv_remote: ['remote', { up: 'DPAD_UP', down: 'DPAD_DOWN', left: 'DPAD_LEFT', right: 'DPAD_RIGHT', select: 'DPAD_CENTER', back: 'BACK', home: 'HOME', play_pause: 'MEDIA_PLAY_PAUSE' }],
    vizio: ['remote', { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', select: 'OK', back: 'BACK', home: 'HOME', play_pause: 'PLAY' }],
    '': ['remote', { up: 'up', down: 'down', left: 'left', right: 'right', select: 'select', back: 'back', home: 'home', play_pause: 'play_pause' }]
  };
  var PLAYERS = ['apple_tv'];
  // A FRESH HOUSE (nothing opened yet, no favorites): the streaming apps people open most, first, where the player has them
  var POPULAR = ['YouTube TV', 'Netflix', 'Disney+', 'Max', 'HBO Max', 'Hulu', 'Prime Video', 'Peacock', 'Paramount+', 'YouTube', 'Apple TV',
                 'ESPN', 'Sling TV', 'Plex', 'Spotify', 'Pluto TV', 'Tubi', 'Fubo', 'Philo', 'Disney CR'];
  // Apple's own utility apps a fresh house's list leaves out (until someone opens one)
  var QUIET = /^(App\s?Store|Arcade|Computers|Settings|Search|Photos|Fitness|Podcasts|FaceTime|Music|TV)$/;

  /** @param {any} client @param {string} path @param {any} fb */
  function setting(client, path, fb) { var HS = global.hkSettings; try { return HS ? HS.get(path, fb) : fb; } catch (e) { return fb; } }
  /** @param {any} client @param {string|null|undefined} id */
  function st(client, id) { return (id && client && client.states && client.states[id]) || null; }
  /** @param {any} s */
  function on(s) { return !!s && !OFF[String(s.state)]; }
  /** @param {any} s */
  function feat(s) { return Number((s && s.attributes && s.attributes.supported_features) || 0); }
  /** @param {any} client @param {string} id */
  function ent(client, id) { return (client && client.entities && client.entities[id]) || {}; }
  /** @param {any} client @param {string} id */
  function areaOf(client, id) {
    var e = ent(client, id), devs = (client && client.devices) || {};
    return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
  }
  /** @param {any} client @param {string} id */
  function platformOf(client, id) { return ent(client, id).platform || ''; }
  /** @param {any} s @param {any} e */
  function isTv(s, e) {
    var a = (s && s.attributes) || {};
    return a.device_class === 'tv' && !isPlayer(s, e);
  }
  /** @param {any} s @param {any} e */
  function isPlayer(s, e) {
    // an Apple TV by its integration; another streamer by reporting the app it has open, if it isn't a speaker (Music Assistant's
    // HomePods report an app_id too)
    var a = (s && s.attributes) || {};
    // (a TV is never a player: an LG that's on reports the app it shows, `com.webos.app.hdmi2`, as an app_id of its own -- the house,
    // 2026-11-11, where the Master Bedroom's TV became a second player the moment it came on)
    if (a.device_class === 'tv') return false;
    if (e && PLAYERS.indexOf(e.platform) >= 0) return true;
    return 'app_id' in a && !a.mass_player_type && a.device_class !== 'speaker' && Array.isArray(a.source_list) && a.source_list.length > 0;
  }
  // the remote entity on the same device as a media player (an Apple TV's, a Roku's), or null
  /** @param {any} client @param {string|null} id */
  function remoteOf(client, id) {
    if (!id) return null;
    var dev = ent(client, id).device_id, ents = (client && client.entities) || {};
    var same = dev && Object.keys(ents).filter(function (k) { return k.indexOf('remote.') === 0 && ents[k].device_id === dev; }).sort()[0];
    // (else the remote named as the player is: remote.x beside media_player.x)
    var named = 'remote.' + id.split('.')[1];
    return same || (st(client, named) ? named : null);
  }

  // ------------------------------------------------------------ THE SETS
  var memo = { ents: null, n: -1, saved: '', list: /** @type {any[]} */ ([]) };
  /** @param {any} client */
  function sets(client) {
    var states = (client && client.states) || {}, ents = (client && client.entities) || {}, areas = (client && client.areas) || {};
    var savedList = setting(client, 'features.tv_sets', []) || [], savedKey = JSON.stringify(savedList), n = Object.keys(states).length;
    if (memo.ents === ents && memo.n === n && memo.saved === savedKey && ents) return memo.list;
    /** @type {Record<string, any>} */
    var saved = {};
    (Array.isArray(savedList) ? savedList : []).forEach(function (x) { if (x && x.tv) saved[x.tv] = x; });
    var tvs = [], players = [];
    Object.keys(states).forEach(function (id) {
      if (id.indexOf('media_player.') !== 0) return;
      var s = states[id], e = ents[id];
      if (e && e.hidden) return;
      if (isPlayer(s, e)) players.push(id); else if (isTv(s, e)) tvs.push(id);
    });
    tvs.sort(); players.sort();
    var used = /** @type {Record<string, number>} */ ({}), out = [];
    // a saved player first, then the one in the TV's room
    tvs.forEach(function (tv) {
      var w = saved[tv] || {}, area = areaOf(client, tv), player = null;
      if (w.player && w.player !== 'none') player = w.player;
      else if (w.player !== 'none') player = players.filter(function (p) { return !used[p] && area && areaOf(client, p) === area; })[0] || null;
      if (player) used[player] = 1;
      out.push(make(client, tv, player, area, w, areas));
    });
    // a player with no TV in its room (the Guest Bedroom's Apple TV): a set of its own
    players.forEach(function (p) { if (!used[p]) out.push(make(client, null, p, areaOf(client, p), {}, areas)); });
    memo = { ents: ents, n: n, saved: savedKey, list: out };
    return out;
  }
  /** @param {any} client @param {string|null} tv @param {string|null} player @param {string|null} area @param {any} w @param {any} areas */
  function make(client, tv, player, area, w, areas) {
    var room = area && areas[area] ? areas[area].name || area : '';
    var learned = ((st(client, SENSOR) || {}).attributes || {}).inputs || {};
    return {
      id: tv || player, tv: tv, player: player, area: area, name: friendly(client, tv || player),
      room: room, input: w.input || (tv && learned[tv]) || null, inputSaved: !!w.input, volume: w.volume || 'auto', hidden: w.hidden || [],
      remotes: { player: remoteOf(client, player), tv: remoteOf(client, tv), playerKind: player ? (platformOf(client, player) || 'apple_tv') : '', tvKind: tv ? platformOf(client, tv) : '' }
    };
  }
  /** @param {any} client @param {string|null} id */
  function friendly(client, id) { var s = st(client, id); return (s && s.attributes && s.attributes.friendly_name) || id || 'TV'; }

  /** @param {any} client @param {any} key */
  function setFor(client, key) {
    var all = sets(client);
    if (!key || key === 'tablet_room') {
      var G = global.hkGridCatalog, room = G && G.tabletRoom ? G.tabletRoom(client) : null;
      if (!room) return key ? null : all[0] || null;
      key = room;
    }
    return all.filter(function (x) { return x.tv === key || x.player === key || x.id === key; })[0] ||
      all.filter(function (x) { return x.area === key && x.tv; })[0] || all.filter(function (x) { return x.area === key; })[0] || null;
  }

  // ------------------------------------------------------------ WHAT IT IS DOING
  /** @param {any} client @param {any} set */
  function look(client, set) {
    var t = st(client, set && set.tv), p = st(client, set && set.player), ta = (t && t.attributes) || {}, pa = (p && p.attributes) || {};
    var tvOn = on(t), playerOn = on(p), source = tvOn ? ta.source || null : null;
    // the TV shows the player when it's on the player's input; with that input not yet known (learned as the player wakes the TV, or
    // set in Accessories -> TVs), whenever the player is awake. An input's label is no guide: the Master Bedroom's Apple TV shows
    // through its soundbar's input (LG S95TR), not the one named Apple TV (tested on the house, 2026-11-10).
    var onPlayer = !!set && !!set.player && (!set.tv || !tvOn || !set.input || source === set.input);
    var showing = onPlayer && playerOn;
    var title = showing ? (pa.media_title || pa.app_name || 'Apple TV') : tvOn ? (source || 'On') : 'Off';
    var sub = showing ? (pa.media_title && pa.app_name ? pa.app_name : (pa.media_artist || '')) : '';
    var hidden = set ? set.hidden : [];
    var list = (ta.source_list || []).filter(function (/** @type {string} */ x) { return hidden.indexOf(x) < 0; });
    var inputs = list.map(function (/** @type {string} */ x) { return { name: x, on: x === source, player: !!set && x === set.input }; });
    return {
      on: tvOn || playerOn, tvOn: tvOn, playerOn: playerOn, onPlayer: showing, title: title, sub: sub,
      app: showing ? pa.app_name || null : null, appId: showing ? pa.app_id || null : null,
      art: showing ? pa.entity_picture_local || pa.entity_picture || null : null,
      playing: showing && p && p.state === 'playing', paused: showing && p && p.state === 'paused',
      source: source, inputs: inputs, volume: volumeOf(client, set), arrows: arrowsFor(client, set, tvOn, showing),
      unavailable: (!t || t.state === 'unavailable') && (!p || p.state === 'unavailable')
    };
  }
  // WHERE THE ARROWS GO: whatever is on screen. The player's when the TV shows it (or there's no TV); the TV's own otherwise,
  // where it takes keys; null when neither can.
  /** @param {any} client @param {any} set @param {boolean} tvOn @param {boolean} showing */
  function arrowsFor(client, set, tvOn, showing) {
    if (!set) return null;
    var playerKeys = !!set.remotes.player, tvKeys = !!set.tv && (set.remotes.tvKind === 'webostv' || !!set.remotes.tv);
    if (showing && playerKeys) return 'player';
    if (tvOn && tvKeys) return 'tv';
    return playerKeys ? 'player' : tvKeys ? 'tv' : null;
  }
  /** @param {any} client @param {any} set */
  function canArrows(client, set) {
    return { player: !!(set && set.remotes.player), tv: !!(set && set.tv && (set.remotes.tvKind === 'webostv' || set.remotes.tv)) };
  }
  // VOLUME: where it goes (Accessories -> TVs, else the TV when it takes a level or steps, else the player), and how: a slider
  // ('set') where the device takes a level, - and + ('step') where it only steps, nothing where neither works
  /** @param {any} client @param {any} set */
  function volumeOf(client, set) {
    if (!set || set.volume === 'none') return { mode: null, entity: null, level: null, muted: false };
    var target = set.volume === 'tv' ? set.tv : set.volume === 'player' ? set.player : set.volume && set.volume !== 'auto' ? set.volume : null;
    if (!target) {
      var t = st(client, set.tv);
      target = set.tv && (feat(t) & (F.VOLUME_SET | F.VOLUME_STEP)) ? set.tv : set.player;
    }
    var s = st(client, target), f = feat(s), a = (s && s.attributes) || {};
    var mode = (f & F.VOLUME_SET) ? 'set' : (f & F.VOLUME_STEP) ? 'step' : null;
    return { mode: on(s) ? mode : null, entity: target, level: typeof a.volume_level === 'number' ? a.volume_level : null,
             muted: !!a.is_volume_muted, mute: !!(f & F.VOLUME_MUTE) };
  }

  // ------------------------------------------------------------ WHAT A TAP SENDS
  /** @param {any} client @param {any} set @param {string} to @param {string} key */
  function press(client, set, to, key) {
    if (!set || KEYS.indexOf(key) < 0) return [];
    var who = to === 'tv' ? set.tv : set.player, kind = to === 'tv' ? set.remotes.tvKind : set.remotes.playerKind;
    var map = REMOTES[kind] || REMOTES[''], word = map[1][key];
    if (key === 'play_pause' && !word) return who ? [['media_player', 'media_play_pause', { entity_id: who }]] : [];
    if (map[0] === 'webostv') return who && word ? [['webostv', 'button', { entity_id: who, button: word }]] : [];
    var remote = to === 'tv' ? set.remotes.tv : set.remotes.player;
    return remote && word ? [['remote', 'send_command', { entity_id: remote, command: word }]] : [];
  }
  /** @param {any} client @param {any} set */
  function power(client, set) {
    var lk = look(client, set), out = [];
    if (lk.on) {
      if (set.player && lk.playerOn) out.push(['media_player', 'turn_off', { entity_id: set.player }]);
      if (set.tv && lk.tvOn) out.push(['media_player', 'turn_off', { entity_id: set.tv }]);
    } else {
      if (set.player) out.push(['media_player', 'turn_on', { entity_id: set.player }]);
      if (set.tv && (feat(st(client, set.tv)) & F.TURN_ON)) out.push(['media_player', 'turn_on', { entity_id: set.tv }]);
    }
    return out;
  }
  // AN APP, FROM WHEREVER THE ROOM IS: the player on, the TV on and on the player's input, then the app
  /** @param {any} client @param {any} set @param {string} name */
  function open(client, set, name) {
    if (!set || !set.player || !name) return [];
    var lk = look(client, set), out = [];
    if (!lk.playerOn) out.push(['media_player', 'turn_on', { entity_id: set.player }]);
    if (set.tv && !lk.tvOn && (feat(st(client, set.tv)) & F.TURN_ON)) out.push(['media_player', 'turn_on', { entity_id: set.tv }]);
    if (set.tv && lk.tvOn && set.input && lk.source !== set.input) out.push(['media_player', 'select_source', { entity_id: set.tv, source: set.input }]);
    out.push(['media_player', 'select_source', { entity_id: set.player, source: name }]);
    return out;
  }
  /** @param {any} client @param {any} set @param {string} name */
  function input(client, set, name) {
    if (!set || !set.tv || !name) return [];
    return [['media_player', 'select_source', { entity_id: set.tv, source: name }]];
  }
  /** @param {any} client @param {any} set @param {string} how @param {number} [v] */
  function volume(client, set, how, v) {
    var vol = volumeOf(client, set);
    if (!vol.entity) return [];
    if (how === 'set' && typeof v === 'number') return [['media_player', 'volume_set', { entity_id: vol.entity, volume_level: Math.max(0, Math.min(1, v)) }]];
    if (how === 'up' || how === 'down') return [['media_player', 'volume_' + how, { entity_id: vol.entity }]];
    if (how === 'mute') return [['media_player', 'volume_mute', { entity_id: vol.entity, is_volume_muted: !vol.muted }]];
    return [];
  }
  /** @param {any} client @param {any} set */
  function playPause(client, set) {
    return set && set.player ? [['media_player', 'media_play_pause', { entity_id: set.player }]] : [];
  }

  // ------------------------------------------------------------ THE APPS
  // show: 'recent' (most opened here first), 'favorites' (Accessories -> TVs -> TV Apps), or an app's name. Recent and Favorites fill
  // up from the player's own list, so a new house still has apps to tap. An app nobody has opened takes the icon Mantel guessed by
  // its name (sensor.hk_tv's `guesses`, hk_core/tv.py best_match) until it opens and its own is looked up.
  /** @param {any} client */
  function iconsOf(client) {
    var sa = ((st(client, SENSOR) || {}).attributes || {}), known = sa.apps || [], guessed = sa.guesses || {};
    /** @type {Record<string, any>} */
    var byName = {};
    known.forEach(function (/** @type {any} */ a) { if (a && a.name && !byName[a.name]) byName[a.name] = a; });
    /** @param {string} name */
    function one(name) {
      var a = byName[name] || {}, g = guessed[name] || {}, src = a.src || g.src;
      return { id: a.id || null, icon: src ? (global.__hkBase || '') + src : null, glyph: a.glyph || g.glyph || null };
    }
    return { known: known, byName: byName, one: one };
  }
  /** @param {any} client @param {any} set @param {string} [show] @param {number} [n] */
  function apps(client, set, show, n) {
    var p = st(client, set && set.player), pa = (p && p.attributes) || {}, list = pa.source_list || [];
    var ic = iconsOf(client), known = ic.known, byName = ic.byName;
    var mode = show || setting(client, 'features.tv_show', 'recent') || 'recent', names = [];
    if (mode !== 'recent' && mode !== 'favorites') names = [mode];
    else {
      var favs = setting(client, 'features.tv_apps', []) || [];
      var first = mode === 'favorites' ? favs : known.map(function (/** @type {any} */ a) { return a.name; });
      names = first.concat(mode === 'favorites' ? [] : favs).concat(POPULAR, list.filter(function (/** @type {string} */ x) { return !QUIET.test(x); }));
    }
    var seen = /** @type {Record<string, number>} */ ({}), out = [];
    names.forEach(function (name) {
      if (!name || seen[name] || (list.length && list.indexOf(name) < 0 && !byName[name])) return;
      seen[name] = 1;
      var a = ic.one(name);
      out.push({ name: name, id: a.id, icon: a.icon, glyph: a.glyph, now: !!pa.app_name && pa.app_name === name && on(p) });
    });
    return typeof n === 'number' ? out.slice(0, n) : out;
  }
  // every app the player lists (All Apps…), A to Z
  /** @param {any} client @param {any} set */
  function allApps(client, set) {
    var p = st(client, set && set.player), list = ((p && p.attributes) || {}).source_list || [], ic = iconsOf(client);
    return apps(client, set, 'recent').concat(list.map(function (/** @type {string} */ x) { var a = ic.one(x); return { name: x, id: a.id, icon: a.icon, glyph: a.glyph, now: false }; }))
      .filter(function (a, i, all) { return all.findIndex(function (b) { return b.name === a.name; }) === i; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ------------------------------------------------------------ SHOW WHEN
  /** @param {any} client @param {any} key */
  function isOn(client, key) {
    var set = setFor(client, key);
    return !!set && (on(st(client, set.tv)) || on(st(client, set.player)));
  }
  // a media player that belongs to a set (its TV or its player): its sheet is the TV sheet
  /** @param {any} client @param {string} id */
  function isMine(client, id) { return sets(client).some(function (x) { return x.tv === id || x.player === id; }); }
  // the entities a set reads, for a card's redraw signature
  /** @param {any} set */
  function ids(set) { return set ? [set.tv, set.player, SENSOR].filter(Boolean) : [SENSOR]; }

  global.hkTv = { SENSOR: SENSOR, KEYS: KEYS, REMOTES: REMOTES, sets: sets, setFor: setFor, look: look, press: press, power: power,
                  open: open, input: input, volume: volume, playPause: playPause, apps: apps, allApps: allApps, isOn: isOn, ids: ids,
                  canArrows: canArrows, isMine: isMine, isTv: isTv, isPlayer: isPlayer, volumeOf: volumeOf };
})(typeof window !== 'undefined' ? window : globalThis);
