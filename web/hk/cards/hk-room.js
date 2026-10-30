// hk-room.js -- a room page's STATUS ROW (hk-room-status-card), and a
// category page's (hk-page-status-card: Climate, Lights, Doors & Windows,
// Water, Security).
//
// The line under a room's name in the Home app: "Temperature 71° · Humidity
// 46% · Security System Disarmed · TV On · 4 Lights On · Outlet On · Blinds
// Open · Fan On · 3 Windows Closed · Motion Not Detected · Occupancy Detected
// · Speaker Playing". NOT the home page's chip row -- the Home app
// draws a room's status differently: no plate, no
// border, no well: a bare white glyph and two lines of text straight on the
// sky. Temperature and humidity draw a ring open at the bottom with a dot at
// the reading; counts go in the title ("2 Fans"); an idle sensor is dimmed.
//
// EVERYTHING COMES FROM THE AREA (config `area:`, one or a list), so it names
// no house:
//   temperature, humidity  the AREA's own sensors -- Settings -> Areas -> the
//                          area -> Related sensors (area temperature_entity_id,
//                          humidity_entity_id); a card may name its own.
//   everything else        counted from the area's entities (their own area,
//                          else their device's), leaving out hidden, disabled
//                          and diagnostic/config entities -- a tablet's battery
//                          temperature is not the room's.
// Which kinds show, and in what order, is HK Settings -> Status Rows (settings
// rooms.status, status_rows.<page>); a card's `items:` wins.
//
// A CATEGORY PAGE'S ROW counts what the page shows -- Status & Chips' lists
// (hkStrategy.pageMembers) -- less the rooms it leaves out, and its sensors
// name the room: "Motion: Emma's Room", "3 Rooms: Occupied".
//
// TAP: one sensor opens its sheet (hk-detail.js, or HA's dialog); a count of
// several opens a sheet of those devices (hkDetail.openGroup).
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
    }, { once: true });
  }

  // The kinds, in the Home app's order (a room there, 2026-10-04): the
  // readings, the security system, the accessories, the sensors, and what is
  // playing. The house may order them its own way (settings rooms.status).
  var KINDS = ['temperature', 'humidity', 'security', 'tvs', 'lights', 'outlets', 'blinds', 'fans',
               'windows', 'doors', 'locks', 'garage', 'valves', 'motion', 'occupancy', 'leaks', 'speakers'];
  // The kinds that are accessories -- tiles on the page -- rather than sensors.
  var ACCESSORY = { security: 1, tvs: 1, lights: 1, outlets: 1, blinds: 1, fans: 1, locks: 1, garage: 1,
                    valves: 1, speakers: 1 };
  var OFF = { unavailable: 1, unknown: 1 };

  function dom(id) { return String(id).split('.')[0]; }
  function attr(st, k) { return st && st.attributes ? st.attributes[k] : undefined; }
  function setting(path, fallback) {
    var HS = window.hkSettings;
    return HS && HS.get ? HS.get(path, fallback) : fallback;
  }
  // What the accessory is drawn as (its gear's Show As): a switch shown as a
  // light is counted with the lights, as its tile is drawn with them.
  function shownAs(id) {
    return (((setting('accessories', {}) || {}).entities || {})[id] || {}).show_as;
  }

  // Which kind an entity counts toward, or null. A group of other entities
  // never: its members count themselves -- a helper's (attributes.entity_id)
  // or any integration's, a Hue room, a Zigbee group (group_entities).
  function kindOf(id, st, client) {
    var d = dom(id), dc = attr(st, 'device_class');
    if (Array.isArray(attr(st, 'entity_id')) || Array.isArray(attr(st, 'group_entities'))) return null;
    if (d === 'light' || d === 'switch' || d === 'input_boolean') {
      var as = shownAs(id);
      if (as === 'light' || as === 'outlet' || as === 'fan') return as === 'light' ? 'lights' : as + 's';
      if (as === 'switch') return null;
      if (d === 'light') return 'lights';
      return d === 'switch' && dc === 'outlet' ? 'outlets' : null;
    }
    if (d === 'fan') return 'fans';
    if (d === 'lock') return 'locks';
    // the one list of door covers (hk-base), read when asked: this file may load first
    if (d === 'cover') return window.hkCards && window.hkCards.DOOR_COVERS && window.hkCards.DOOR_COVERS[dc] ? 'garage' : 'blinds';
    if (d === 'valve') return 'valves';
    // THE security system: a house's alarm is often two panels -- its own
    // integration's and a keypad's -- and the Home app has one. With
    // General's Alarm Panel chosen, that one is it.
    if (d === 'alarm_control_panel') {
      var main = setting('security.alarm', null);
      return !main || main === id ? 'security' : null;
    }
    // a receiver is the TV's sound, not a thing of its own; an Apple TV says
    // no device class, but its device's model says what it is (as its tile)
    if (d === 'media_player') {
      if (dc === 'tv') return 'tvs';
      if (dc === 'receiver') return null;
      var e = client && (client.entities || {})[id], dev = e && (client.devices || {})[e.device_id];
      return dev && /apple tv/i.test(dev.model || '') ? 'tvs' : 'speakers';
    }
    if (d === 'binary_sensor') {
      if (dc === 'window') return 'windows';
      if (dc === 'door') return 'doors';
      if (dc === 'garage_door') return 'garage';
      if (dc === 'motion' || dc === 'moving') return 'motion';
      if (dc === 'occupancy' || dc === 'presence') return 'occupancy';
      if (dc === 'moisture') return 'leaks';
    }
    return null;
  }

  // An area's entities, as the generated dashboard counts them.
  // MEMOISED ON THE REGISTRIES: the status row asks on every state push
  // (several a second) to see whether anything changed, and this walks
  // every registry entry -- thousands in a large home. HA replaces
  // the client's entities / devices when a registry changes, so their identity
  // (and the areas asked for) is the whole key.
  var memo = { ents: null, devs: null, key: '', out: null };
  function members(client, areas) {
    var key = areas.join('|');
    if (memo.ents === client.entities && memo.devs === client.devices && memo.key === key && memo.out) return memo.out;
    var out = walk(client, areas);
    memo = { ents: client.entities, devs: client.devices, key: key, out: out };
    return out;
  }
  function walk(client, areas) {
    var ents = client.entities || {}, devs = client.devices || {}, want = {}, out = [];
    areas.forEach(function (a) { want[a] = true; });
    Object.keys(ents).forEach(function (id) {
      var e = ents[id] || {};
      if (e.hidden || e.entity_category) return;
      var a = areaOf(client, id);
      if (a && want[a]) out.push(id);
    });
    return out.sort();
  }
  // its own area, else its device's
  function areaOf(client, id) {
    var e = (client.entities || {})[id] || {}, devs = client.devices || {};
    return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
  }

  function isOn(kind, st) {
    var s = st && st.state;
    if (kind === 'blinds' || kind === 'garage') {
      return dom(st.entity_id) === 'cover' ? (s === 'open' || s === 'opening' || s === 'closing') : s === 'on';
    }
    if (kind === 'locks') return s !== 'locked';
    if (kind === 'valves') return dom(st.entity_id) === 'valve' ? (s === 'open' || s === 'opening') : s === 'on';
    if (kind === 'tvs') return s !== 'off' && s !== 'standby';
    if (kind === 'speakers') return s === 'playing';
    if (kind === 'security') return s !== 'disarmed';
    return s === 'on';
  }

  // Words, as the Home app says them.
  var NOUN = { outlets: ['Outlet', 'Outlets'], blinds: ['Blinds', 'Blinds'], fans: ['Fan', 'Fans'],
               windows: ['Window', 'Windows'], doors: ['Door', 'Doors'], locks: ['Lock', 'Locks'],
               garage: ['Garage Door', 'Garage Doors'], lights: ['Light', 'Lights'], tvs: ['TV', 'TVs'],
               valves: ['Valve', 'Valves'], speakers: ['Speaker', 'Speakers'],
               security: ['Security System', 'Security Systems'] };
  var WORDS = { outlets: ['Off', 'On'], blinds: ['Closed', 'Open'], fans: ['Off', 'On'],
                windows: ['Closed', 'Open'], doors: ['Closed', 'Open'], locks: ['Locked', 'Unlocked'],
                garage: ['Closed', 'Open'], lights: ['Off', 'On'], tvs: ['Off', 'On'],
                // a water valve runs (the Home app's faucet); a gas one opens
                valves: ['Off', 'Running'], speakers: ['Not Playing', 'Playing'] };
  // Each kind's name, for a card editor
  var LABEL = { temperature: 'Temperature', humidity: 'Humidity', security: 'Security System', tvs: 'TVs',
                lights: 'Lights', outlets: 'Outlets', blinds: 'Blinds', fans: 'Fans', windows: 'Windows',
                doors: 'Doors', locks: 'Locks', garage: 'Garage Doors', valves: 'Valves', motion: 'Motion',
                occupancy: 'Occupancy', leaks: 'Leak Sensors', speakers: 'Speakers' };
  // An alarm panel's state, in its own words; anything else is "Armed".
  var ALARM = { disarmed: 'Disarmed', armed_home: 'Armed Home', armed_away: 'Armed Away',
                armed_night: 'Armed Night', armed_vacation: 'Armed Vacation', arming: 'Arming',
                pending: 'Pending', disarming: 'Disarming', triggered: 'Triggered' };
  // A sensor kind's words: [title, nothing detected, detected]
  var SENSE = { motion: ['Motion', 'Not Detected', 'Detected'], occupancy: ['Occupancy', 'None', 'Detected'],
                leaks: ['Leak', 'None', 'Detected'] };

  // ONE ITEM: a kind and its entities (those with nothing to say -- unknown,
  // unavailable -- in the count but not the words). `where`: a sensor says
  // the ROOM it is detected in ("Motion -- Emma's Room", "3 Rooms --
  // Occupied"), as a category page's row does; a room's own row has no
  // need. null: nothing to show.
  function describe(client, k, ids, where) {
    var st = client.states || {}, n = ids.length;
    if (!n) return null;
    var live = ids.filter(function (id) { var s = st[id]; return s && !OFF[s.state]; });
    var hot = live.filter(function (id) { return isOn(k, st[id]); });
    var on = hot.length;
    if (!live.length) {
      // a sleepy sensor that has said nothing since Home Assistant started
      // is "unknown", not gone: No Report, as its tile says (the Water page)
      var silent = SENSE[k] && ids.every(function (id) { return st[id] && st[id].state === 'unknown'; });
      return { kind: k, title: (SENSE[k] || [])[0] || (n === 1 ? '' : n + ' ') + NOUN[k][n === 1 ? 0 : 1],
               value: silent ? 'No Report' : 'Unavailable', ids: ids, dim: true, on: 0 };
    }
    if (SENSE[k]) {
      var w = SENSE[k], title = w[0], value = w[on ? 2 : 1];
      if (where && on) {
        var rooms = [];
        hot.forEach(function (id) {
          var a = (client.areas || {})[areaOf(client, id)];
          if (a && a.name && rooms.indexOf(a.name) < 0) rooms.push(a.name);
        });
        if (rooms.length === 1) value = rooms[0];
        else if (rooms.length > 1 && k === 'occupancy') { title = rooms.length + ' Rooms'; value = 'Occupied'; }
        else if (rooms.length > 1) value = rooms.length + ' Rooms';
      }
      return { kind: k, title: title, value: value, ids: ids, dim: !on, alert: k === 'leaks' && !!on, on: on };
    }
    var noun = (n === 1 ? '' : n + ' ') + NOUN[k][n === 1 ? 0 : 1];
    if (k === 'security') {
      var said = live.map(function (id) { var s = st[id].state; return ALARM[s] || 'Armed'; });
      var same = said.every(function (x) { return x === said[0]; });
      return { kind: k, title: noun, value: same ? said[0] : on + ' Armed', ids: ids, dim: false, on: on,
               alert: live.some(function (id) { return st[id].state === 'triggered'; }) };
    }
    var words = WORDS[k];
    if (k === 'valves' && live.every(function (id) { return attr(st[id], 'device_class') === 'gas'; })) {
      words = ['Closed', 'Open'];
    }
    // THE ONE RULE for an accessory kind, every row's (a room's, a category
    // page's, Climate's blinds and fans): one state when all that answer
    // agree, else how many are in the other -- and any that cannot answer
    // said, never folded in: "2 On · 1 Unavailable", not "3 Lights On".
    var m = live.length, gone = n - m;
    var value = gone ? on + ' ' + words[1] + ' · ' + gone + ' Unavailable'
              : on === 0 || on === m ? words[on ? 1 : 0] : on + ' ' + words[1];
    return { kind: k, title: noun, value: value, ids: ids, dim: false, on: on, alert: k === 'locks' && !!on };
  }

  // THE ROW'S ITEMS -- a pure function of the client, the areas and the kinds, so
  // the tests hold it to every rule without a page.
  //   o: { items: [kinds], temperature, humidity, include: [ids], exclude: [ids],
  //        entities: [ids], exclude_entities, exclude_devices, exclude_areas }
  //
  // `entities:` -- THE ACCESSORIES ON THE PAGE. Given, the accessory kinds
  // (lights, outlets, blinds, fans, locks, ...) count only these, so "2 Fans"
  // is always the two fan tiles below it -- the Home app's own rule. An area
  // can hold more than the page shows: a second integration's copy of the
  // same shades (a Matter bridge), a relay that is not a room's device. The
  // sensor kinds still come from the whole area.
  function items(client, areas, o) {
    o = o || {};
    var st = client.states || {}, A = client.areas || {}, out = [];
    // in the order the card or the house lists them (each once, known ones)
    var kinds = (o.items && o.items.length ? o.items : KINDS).filter(function (k, i, arr) {
      return KINDS.indexOf(k) !== -1 && arr.indexOf(k) === i;
    });
    // LEFT OUT: the card's own `exclude`, and Hidden from Screens -- the
    // house's (generated) and the dashboard's own exclude_entities /
    // _devices / _areas -- by the generated dashboard's rule (hidden()): an
    // entity, its device, or its area. A hidden motion sensor is no more the
    // room's than it is a page's or a chip's.
    var skip = {}, offDev = {}, offArea = {};
    (o.exclude || []).concat(o.exclude_entities || []).forEach(function (id) { skip[id] = true; });
    (o.exclude_devices || []).forEach(function (d) { offDev[d] = true; });
    (o.exclude_areas || []).forEach(function (a) { offArea[a] = true; });
    var ents = client.entities || {};
    var left = function (id) {
      if (skip[id]) return true;
      var e = ents[id] || {};
      if (e.device_id && offDev[e.device_id]) return true;
      var a = areaOf(client, id);
      return !!(a && offArea[a]);
    };
    var ids = members(client, areas).concat(o.include || []).filter(function (id, i, arr) {
      return !left(id) && arr.indexOf(id) === i;
    });
    var own = Array.isArray(o.entities) ? o.entities.filter(function (id) { return !left(id); }) : null;
    var by = {};
    function count(list, accessories) {
      list.forEach(function (id) {
        var s = st[id];
        if (!s || OFF[s.state]) return;
        var k = kindOf(id, s, client);
        if (!k || !!ACCESSORY[k] !== accessories) return;
        if (by[k] && by[k].indexOf(id) !== -1) return;
        (by[k] = by[k] || []).push(id);
      });
    }
    count(own || ids, true);
    count(ids, false);
    function areaSensor(key) {
      if (o[key]) return o[key];
      for (var i = 0; i < areas.length; i++) {
        var a = A[areas[i]];
        if (a && a[key + '_entity_id']) return a[key + '_entity_id'];
      }
      return null;
    }
    kinds.forEach(function (k) {
      if (k === 'temperature' || k === 'humidity') {
        var id = areaSensor(k), s = id && st[id];
        var v = s ? parseFloat(s.state) : NaN;
        if (!isFinite(v)) return;
        var unit = attr(s, 'unit_of_measurement') || '';
        var c = /C$/.test(unit);
        out.push({ kind: k, title: k === 'temperature' ? 'Temperature' : 'Humidity',
                   value: k === 'temperature' ? Math.round(v) + '°' : Math.round(v) + '%',
                   ids: [id], dim: false,
                   // THE DOT'S PLACE on the 270° ring: temperature over a
                   // room's range, centred on 71 °F / 21.5 °C (the Home app draws
                   // 71° at the top), humidity over 0-100 %.
                   gauge: k === 'humidity' ? v / 100 : (c ? (v - 7) / 29 : (v - 45) / 52) });
        return;
      }
      var it = describe(client, k, by[k] || [], false);
      if (it) out.push(it);
    });
    return out;
  }

  // THE CATEGORY PAGES' ROWS (settings.STATUS_ROWS): what each may show.
  // What it does show, and in what order, is the house's (status_rows.<page>).
  var PAGE_ROWS = { climate: ['temperature', 'humidity', 'blinds', 'fans'], lights: ['lights', 'outlets'],
                    doors_windows: ['doors', 'windows', 'garage', 'motion', 'occupancy'], water: ['leaks', 'valves'],
                    security: ['security', 'locks', 'garage', 'doors', 'windows', 'leaks', 'motion', 'occupancy'],
                    // the Vacuums and Timers pages (2026-10-16, the utility pages' plan): what
                    // is working, and how the batteries are (HK Settings -> Pages)
                    vacuums: ['vacuums', 'vacuum_battery'], timers: ['timers'] };
  var CLIMATE_KINDS = PAGE_ROWS.climate;
  function rowSetting(page) {
    var HS = window.hkSettings;
    return (HS && HS.get ? (HS.get('status_rows', {}) || {})[page] : null) || {};
  }
  // What a page's row shows, in its order: the card's own `items`, else the
  // house's, each once and only what the page may show.
  function picked(page, o) {
    var row = rowSetting(page), may = PAGE_ROWS[page] || [];
    var pick = Array.isArray(o.items) ? o.items : Array.isArray(row.status) ? row.status : may;
    return pick.filter(function (k, i) { return may.indexOf(k) >= 0 && pick.indexOf(k) === i; });
  }
  // A CATEGORY PAGE'S ROW (Lights, Doors & Windows, Water, Security): the
  // same lists the page and the chips count (hkStrategy.pageMembers), and its
  // sensors say which rooms -- "Motion: Emma's Room".
  function pageItems(client, page, o) {
    o = o || {};
    if (page === 'climate') return climateItems(client, o);
    var S = window.hkStrategy;
    var by = S && S.pageMembers ? S.pageMembers(client, page, o) : {};
    return picked(page, o).map(function (k) {
      // (the batteries are the vacuums')
      return UTILITY[k] ? UTILITY[k](client, by[k] || (k === 'vacuum_battery' ? by.vacuums : null) || [])
                        : describe(client, k, by[k] || [], true);
    }).filter(Boolean);
  }
  // THE VACUUMS' AND TIMERS' ROWS: what is working now -- never a count of
  // what is merely there. An error, or a battery at 20 % or under, is the
  // row's alert, said in words as well as color.
  var BAT = { ents: null, by: {} };
  var VAC_BUSY = { cleaning: 'Cleaning', returning: 'Returning', paused: 'Paused' };
  var UTILITY = {
    vacuums: function (client, ids) {
      var st = client.states || {}, n = ids.length;
      if (!n) return null;
      var live = ids.filter(function (id) { return st[id] && !OFF[st[id].state]; });
      var noun = n === 1 ? 'Vacuum' : n + ' Vacuums';
      if (!live.length) return { kind: 'vacuums', title: noun, value: 'Unavailable', ids: ids, dim: true, on: 0 };
      var err = live.filter(function (id) { return st[id].state === 'error'; }).length;
      var busy = {};
      live.forEach(function (id) { var w = VAC_BUSY[st[id].state]; if (w) busy[w] = (busy[w] || 0) + 1; });
      var parts = [];
      if (err) parts.push(err === 1 ? 'Error' : err + ' Errors');
      ['Cleaning', 'Returning', 'Paused'].forEach(function (w) { if (busy[w]) parts.push((n > 1 ? busy[w] + ' ' : '') + w); });
      var gone = n - live.length;
      if (gone) parts.push(gone + ' Unavailable');
      var docked = live.every(function (id) { return st[id].state === 'docked'; });
      var on = live.length - live.filter(function (id) { return st[id].state === 'docked' || st[id].state === 'idle'; }).length;
      return { kind: 'vacuums', title: noun, value: parts.join(' \u00b7 ') || (docked ? (n > 1 ? 'All Docked' : 'Docked') : 'Idle'),
               ids: ids, dim: !on && !err, on: on, alert: !!err };
    },
    // the lowest battery: the vacuum's own, else its device's battery sensor
    vacuum_battery: function (client, ids) {
      var S = window.hkStrategy, lows = [];
      // the device's battery sensor, looked up once per registry (the row
      // asks on every push)
      if (BAT.ents !== client.entities) { BAT.ents = client.entities; BAT.by = {}; }
      ids.forEach(function (id) {
        var s = client.states[id], b = s && s.attributes && s.attributes.battery_level;
        if (b == null && S && S.batteryOf) {
          if (!(id in BAT.by)) BAT.by[id] = S.batteryOf(client, id);
          var bid = BAT.by[id];
          b = bid && client.states[bid] ? client.states[bid].state : null;
        }
        var v = Number(b);
        if (b != null && b !== '' && isFinite(v)) lows.push({ id: id, v: v });
      });
      if (!lows.length) return null;
      lows.sort(function (a, b) { return a.v - b.v; });
      var lo = Math.round(lows[0].v), hi = Math.round(lows[lows.length - 1].v);
      return { kind: 'vacuum_battery', title: lows.length === 1 ? 'Battery' : 'Batteries',
               value: (lo === hi ? lo + '%' : lo + '\u2013' + hi + '%') + (lo <= 20 ? ' \u00b7 Low' : ''),
               ids: lows.map(function (x) { return x.id; }), dim: false, on: 1, alert: lo <= 20, battery: lo };
    },
    timers: function (client, ids) {
      var st = client.states || {};
      if (!ids.length) return null;
      var run = ids.filter(function (id) { return st[id] && st[id].state === 'active'; }).length;
      var pause = ids.filter(function (id) { return st[id] && st[id].state === 'paused'; }).length;
      var parts = [];
      if (run) parts.push(run + ' Running');
      if (pause) parts.push(pause + ' Paused');
      return { kind: 'timers', title: 'Timers', value: parts.join(' \u00b7 ') || 'None Running',
               ids: ids, dim: !run && !pause, on: run + pause };
    }
  };
  // Current ambient readings, shared by the summary and the popup pills.
  // A thermostat's setpoint is deliberately never a reading source.
  function climateReading(client, id, kind) {
    var s = (client.states || {})[id];
    if (!s || OFF[s.state]) return null;
    var a = s.attributes || {}, d = dom(id);
    var raw = d === 'climate' ? a['current_' + kind] : (d === 'sensor' ? s.state : null);
    if (raw == null || String(raw).trim() === '') return null;
    var v = Number(raw);
    if (!isFinite(v)) return null;
    if (kind === 'humidity') return v >= 0 && v <= 100 ? v : null;
    var target = window.hkLocale.units().temp;
    var unit = a.unit_of_measurement || (d === 'climate' ? target : null);
    var from = String(unit || '').replace('°', '').toUpperCase();
    var to = String(target).replace('°', '').toUpperCase();
    if (['C', 'F', 'K'].indexOf(from) < 0 || ['C', 'F', 'K'].indexOf(to) < 0) return null;
    var c = from === 'F' ? (v - 32) * 5 / 9 : from === 'K' ? v - 273.15 : v;
    return to === 'F' ? c * 9 / 5 + 32 : to === 'K' ? c + 273.15 : c;
  }
  function climateItems(client, o) {
    o = o || {};
    var S = window.hkStrategy;
    var by = S && S.climateMembers ? S.climateMembers(client, o) : {};
    var out = [];
    picked('climate', o).forEach(function (k) {
      var ids = by[k] || [];
      if (!ids.length) return;
      if (k === 'temperature' || k === 'humidity') {
        var values = ids.map(function (id) { return climateReading(client, id, k); }).filter(function (v) { return v != null; });
        var lo = values.length ? Math.round(Math.min.apply(null, values)) : null;
        var hi = values.length ? Math.round(Math.max.apply(null, values)) : null;
        var avg = values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : 0;
        var unit = window.hkLocale.units().temp;
        out.push({ kind: k, title: k === 'temperature' ? 'Temperature' : 'Humidity', ids: ids,
          value: values.length ? (lo === hi ? String(lo) : lo + '–' + hi) + (k === 'temperature' ? '°' : '%') : 'Unavailable',
          dim: !values.length, gauge: !values.length ? 0.5 : k === 'humidity' ? avg / 100 :
            /C$/.test(unit) ? (avg - 7) / 29 : /K$/.test(unit) ? (avg - 280.15) / 29 : (avg - 45) / 52 });
        return;
      }
      // blinds and fans: the one accessory rule every row uses
      var it = describe(client, k, ids, false);
      if (it) out.push(it);
    });
    return out;
  }

  // The glyph for each kind -- SF Symbols where the hk: set has them,
  // the same-named Material icon where it does not.
  var ICON = { temperature: 'home-thermometer', humidity: 'water-percent', outlets: 'power-socket-us',
               security: 'alarm-light', tvs: 'television', lights: 'lightbulb', valves: 'spigot', speakers: 'speaker',
               blinds: 'blinds-horizontal', fans: 'fan', windows: 'window-closed-variant',
               // `motion`: the Home app's diamond with trails, drawn for this set
               // (not a public SF Symbol); a tile's motion sensor is `motion-sensor`
               doors: 'door-closed', locks: 'lock', garage: 'garage', motion: 'motion',
               occupancy: 'walk', leaks: 'water', vacuums: 'robot-vacuum', vacuum_battery: 'battery', timers: 'timer-sand' };
  var ICON_ON = { lights: 'lightbulb-on', blinds: 'blinds-horizontal', windows: 'window-open-variant', doors: 'door-open',
                  locks: 'lock-open-variant', garage: 'garage-open', leaks: 'water-alert' };
  function icon(it) {
    var n = (it.on && ICON_ON[it.kind]) || ICON[it.kind];
    // a battery as full as the emptiest one
    if (it.kind === 'vacuum_battery' && isFinite(it.battery)) {
      var b = Math.round(it.battery / 10) * 10;
      return b >= 100 ? 'mdi:battery' : b <= 0 ? 'mdi:battery-outline' : 'mdi:battery-' + b;
    }
    var g = window.hkGlyphs && window.hkGlyphs.icons;
    return (g && !g[n] && !(n === 'door-closed' && g['door-closed-lock'])) ? 'mdi:' + n : 'hk:' + n;
  }

  // The ring: 270°, open at the bottom, a dot at the reading with a gap cut
  // round it -- the Home app's temperature and humidity glyph.
  var GID = 0;
  function gauge(frac) {
    var r = 12.6, c = 16, f = Math.max(0, Math.min(1, isFinite(frac) ? frac : 0.5));
    function p(a) { return [(c + r * Math.cos(a * Math.PI / 180)).toFixed(2), (c + r * Math.sin(a * Math.PI / 180)).toFixed(2)]; }
    var s = p(135), e = p(405), d = p(135 + 270 * f), id = 'hkrg' + (++GID);
    return '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><defs><mask id="' + id + '">' +
      '<rect width="32" height="32" fill="#fff"/><circle cx="' + d[0] + '" cy="' + d[1] + '" r="4.7" fill="#000"/></mask></defs>' +
      '<path d="M' + s[0] + ' ' + s[1] + 'A' + r + ' ' + r + ' 0 1 1 ' + e[0] + ' ' + e[1] + '" fill="none" stroke="currentColor"' +
      ' stroke-width="2.6" stroke-linecap="round" mask="url(#' + id + ')"/>' +
      '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="2.7" fill="currentColor"/></svg>';
  }

  window.hkRoom = { version: '1.1.0', climateItems: climateItems, climateReading: climateReading,
    pageItems: pageItems, PAGE_ROWS: PAGE_ROWS,
    _: { items: items, kindOf: kindOf, members: members, gauge: gauge, describe: describe, KINDS: KINDS } };
  // a room's items as its status row shows them (a Home Grid's room card says them as one line)
  window.hkRoom.roomItems = items;

  whenBase(function (C) {
    if (window.hkRoom.Card) return;
    var HkBase = C.HkBase, esc = C.esc;

    // a Home Grid block's plate: its padding (a page card's, CARD), an
    // item's height (a 44 px touch target holding two 19 px lines) and the
    // gap between items
    var GRID_PAD = 20, GRID_ROW = 44, GRID_GAP = 4;
    var CSS = [
      // THE PAGE'S RHYTHM, measured on a 1280 tablet: 24 px from
      // the back button to this row -- close enough to read as the title's --
      // and 32 px from it to the first section heading, the same as between
      // sections. !important because the view sets every card's margin.
      // POSITIONED, as hk-row-card's host is. The row below is a sideways
      // scroller, which Android composites as a layer of its own; with this
      // host left in flow, an Android tablet draws every card ABOVE the
      // row -- the back button's plate, the room's name -- under the live
      // sky's layers, so the title vanishes (desktop Chrome does not).
      // Taken one change at a time: the row not scrolling avoids it,
      // dropping the glyphs' shadows does not, and position:relative here
      // fixes it with the scroller intact. Keep both.
      ':host{display:block;position:relative;margin-top:-8px !important;margin-bottom:12px !important}',
      // ...but in a Home Grid's cell (the view gives it `size`): the cell is its place, no pull-up
      ':host([size]){margin:0 !important}',
      // an empty row hides (_render sets `hidden`): the display above would win over it
      ':host([hidden]){display:none}',
      // ONE LINE, left aligned with the tiles below (a view card sits 4 px left
      // of the tiles, which are a grid's children), scrolling sideways only
      // when a room has more than fits (a phone). The padding holds the
      // glyphs' drop shadow; the negative margin hands it back.
      '.row{display:flex;align-items:center;gap:34px;overflow-x:auto;overflow-y:hidden;',
      '  overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;',
      '  padding:6px 12px 8px 16px;margin:0 -12px}',
      '.row::-webkit-scrollbar{display:none}',
      '.it{display:flex;align-items:center;gap:10px;flex:none;margin:0;padding:0;border:0;',
      '  background:none;color:' + window.hkCards.v('ink') + ';font:inherit;text-align:left;cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent;transition:opacity .15s ease}',
      '.it.pressed{opacity:0.55}',
      ':host([data-grid-room-status]) .it{min-height:44px}',
      '.g{width:32px;height:32px;flex:none;position:relative;display:flex;align-items:center;',
      '  justify-content:center;color:' + window.hkCards.v('glyph') + ';',
      '  filter:var(--hk-glow,drop-shadow(0 1px 2px rgba(0,0,0,0.28)) drop-shadow(0 2px 6px rgba(0,0,0,0.16)))}',
      '.g hk-icon{--mdc-icon-size:27px;width:27px;height:27px;display:flex}',
      '.g svg{position:absolute;inset:0}',
      '.g.ring hk-icon{--mdc-icon-size:14px;width:14px;height:14px}',
      '.it.dim .g{opacity:0.5}',
      '.tx{display:flex;flex-direction:column;min-width:0}',
      '.t,.v{font-size:15px;line-height:19px;letter-spacing:-0.24px;white-space:nowrap;',
      '  text-shadow:' + window.hkCards.v('glow') + '}',
      '.t{font-weight:600;color:' + window.hkCards.v('ink') + '}',
      '.v{font-weight:400;color:' + window.hkCards.v('ink-2') + '}',
      '.it.alert .v{color:#ff9f0a}',
      '.it:focus-visible{outline:2px solid ' + window.hkCards.v('ink-2') + ';outline-offset:4px;border-radius:6px}',
      // ON A HOME GRID (G2; the `security` block, docs/phase11/HOME-GRID.md):
      // a plate holding the row's items one per line -- two columns from W
      // up -- as many as the block's height takes, alerts first (_render).
      // Nothing scrolls; a name too long ends with an ellipsis.
      ':host([size]) hk-plate.blk{display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;height:100%;',
      '  padding:' + GRID_PAD + 'px 22px;margin:0;' + window.hkCards.plate('card') + ';overflow:hidden}',
      ':host([size]) .row{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));grid-auto-rows:' + GRID_ROW + 'px;',
      '  gap:' + GRID_GAP + 'px 16px;overflow:hidden;padding:0;margin:0;align-content:center}',
      ':host([size]) .it{min-width:0;min-height:' + GRID_ROW + 'px}',
      ':host([size]) .t,:host([size]) .v{overflow:hidden;text-overflow:ellipsis;text-shadow:none}',
      ':host([size]) .none{' + window.hkCards.typeCss('body') + ';color:' + window.hkCards.v('ink-2') + '}'
    ].join('');

    class HkRoomStatusCard extends HkBase {
      static get CSS() { return CSS; }
      setConfig(config) {
        if (!config || !config.area) throw new Error('hk-room-status: `area` is required (one area, or a list)');
        super.setConfig(config);
      }
      getCardSize() { return 1; }
      _areas() { return [].concat(this._config.area || []).filter(Boolean); }
      _opts() {
        var c = this._config, G = C.setting('generated', null) || {};
        // Hidden from Screens: the house's (live), and what the generated
        // dashboard handed it (its own YAML's too)
        var both = function (k) { return [].concat(G[k] || [], c[k] || []); };
        return { items: c.items || C.setting('rooms.status', null), temperature: c.temperature,
                 humidity: c.humidity, include: c.include, exclude: c.exclude, entities: c.entities,
                 exclude_entities: both('exclude_entities'), exclude_devices: both('exclude_devices'),
                 exclude_areas: both('exclude_areas') };
      }
      _itemsFor(h) { return items(h, this._areas(), this._opts()); }
      // The entities it reads, and the settings that shape it.
      _sigOf() {
        var h = this.client;
        if (!h || !h.states) return null;
        var list = this._itemsFor(h);
        this._items = list;
        var sig = JSON.stringify(list) + ';';
        list.forEach(function (it) {
          sig += it.kind + ':' + it.ids.map(function (id) {
            var s = h.states[id];
            return id + ':' + (s ? s.state : 'x');
          }).join(',') + ';';
        });
        return sig + (window.hkGlyphs ? 'g' : '');
      }
      _render() {
        var h = this.client;
        if (!h) return;
        var list = this._items || this._itemsFor(h);
        var sized = this._cellSize();
        // (a Home Grid block never hides: its plate says there is nothing)
        this.toggleAttribute('hidden', !list.length && !sized);
        if (sized) list = this._fit(list, sized);
        // THE ROW STAYS, its buttons change: replacing the scroller would put
        // a phone's sideways-scrolled row back at the start under the reader's
        // finger whenever anything in the room changed
        var row = this._root.querySelector('.row');
        if (!row || this._shape !== (sized ? 'blk' : 'row')) {
          this._shape = sized ? 'blk' : 'row';
          this._root.innerHTML = sized ? '<hk-plate class="blk"><div class="row" role="list"></div></hk-plate>'
                                       : '<div class="row" role="list"></div>';
          row = this._root.querySelector('.row');
          // A ROW THAT FITS takes no sideways pan: a swipe on it is the
          // page's (hkCards.fitPan, Swipe Between Pages); one that scrolls
          // (a phone) keeps its own -- measured again as it changes size
          if (!sized && typeof ResizeObserver === 'function') {
            if (this._fitRo) this._fitRo.disconnect();
            var fitRow = row;
            this._fitRo = new ResizeObserver(function () { window.hkCards.fitPan(fitRow); });
            this._fitRo.observe(row);
          }
        }
        if (sized) row.style.setProperty('--cols', String(this._cols));
        if (sized && !list.length) {
          row.innerHTML = '<span class="none">No accessories</span>';
          this._list = list;
          if (!this._wired) this._wire();
          return;
        }
        row.innerHTML = list.map(function (it, i) {
          var ring = it.kind === 'temperature' || it.kind === 'humidity';
          return '<button class="it' + (it.dim ? ' dim' : '') + (it.alert ? ' alert' : '') + '" data-i="' + i +
            '" role="listitem" aria-label="' + esc(it.title + ', ' + it.value) + '">' +
            '<span class="g' + (ring ? ' ring' : '') + '">' + (ring ? gauge(it.gauge) : '') +
            '<hk-icon icon="' + esc(icon(it)) + '"></hk-icon></span>' +
            '<span class="tx"><span class="t">' + esc(it.title) + '</span><span class="v">' + esc(it.value) +
            '</span></span></button>';
        }).join('');
        if (!sized && window.hkCards.fitPan) window.hkCards.fitPan(row);
        this._list = list;
        if (!this._wired) this._wire();
      }
      // A HOME GRID BLOCK'S ITEMS: as many lines as its height holds (two
      // columns from W up), what needs attention first
      _fit(list, sized) {
        this._watchBlock();
        var b = this._block(), cols = (sized === 'S' || sized === 'T') ? 1 : 2;
        var rows = b ? Math.max(1, Math.floor((b.h - 2 * GRID_PAD + GRID_GAP) / (GRID_ROW + GRID_GAP))) : 2;
        this._cols = cols;
        var alerts = list.filter(function (it) { return it.alert; });
        return alerts.concat(list.filter(function (it) { return !it.alert; })).slice(0, rows * cols);
      }
      // A tap is a lift that did not travel (hk-tap.js's rule): the row
      // scrolls on a phone, and a scroll must not open a sheet.
      _wire() {
        this._wired = true;
        var self = this, down = null, dragged = false;
        this._root.addEventListener('pointerdown', function (e) {
          var b = e.target.closest && e.target.closest('.it');
          down = b ? { b: b, x: e.clientX, y: e.clientY } : null;
          dragged = false;
          if (b) b.classList.add('pressed');
        });
        var clear = function () {
          self._root.querySelectorAll('.it.pressed').forEach(function (b) { b.classList.remove('pressed'); });
        };
        this._root.addEventListener('pointermove', function (e) {
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { dragged = true; down = null; clear(); }
        });
        this._root.addEventListener('pointercancel', function () { dragged = true; down = null; clear(); });
        this._root.addEventListener('click', function (e) {
          clear();
          if (dragged && e.detail !== 0) { dragged = false; return; }
          var b = e.target.closest && e.target.closest('.it');
          if (!b) return;
          var it = self._list && self._list[+b.getAttribute('data-i')];
          if (it) self._open(it);
        });
      }
      _open(it) {
        if (it.ids.length === 1) {
          window.hkShell.moreInfo(it.ids[0], this);
          return;
        }
        var D = window.hkDetail;
        var room = (this.client.areas && this.client.areas[this._areas()[0]]) || {};
        if (D && D.openGroup && C.setting('look.details', true) !== false) {
          D.openGroup(it.title, it.ids, { icon: icon(it), room: room.name || '', kind: it.kind });
          return;
        }
        window.hkShell.moreInfo(it.ids[0], this);
      }
    }

    // A CATEGORY PAGE'S ROW (`page:` climate, lights, doors_windows, water,
    // security). A tap opens the item's accessories as a list -- even one --
    // each pill with its room, kept live, and closing an accessory opened
    // from it comes back to the list. One security system opens its own
    // sheet: the page already has its keypad.
    class HkPageStatusCard extends HkRoomStatusCard {
      setConfig(config) { HkBase.prototype.setConfig.call(this, config || {}); }
      _page() { return (this._config || {}).page || 'climate'; }
      _opts() { return this._config || {}; }
      _itemsFor(h) { return pageItems(h, this._page(), this._opts()); }
      _open(it) {
        var D = window.hkDetail, self = this;
        if (D && D.openGroup && !(it.kind === 'security' && it.ids.length === 1)) {
          D.openGroup(it.title, it.ids, { icon: icon(it), kind: it.kind,
            row: this._opts(), resolve: function (h) {
              return self._itemsFor(h).filter(function (x) { return x.kind === it.kind; })[0] ||
                { title: NOUN[it.kind] ? NOUN[it.kind][1] : it.title, ids: [], value: 'No accessories' };
            } });
          return;
        }
        // One security system, or detail.js still loading: HA's own sheet.
        window.hkShell.moreInfo(it.ids[0], this);
      }
    }
    // The Climate page's, as it was first (1.4.6): a page row for `climate`.
    class HkClimateStatusCard extends HkPageStatusCard {
      _page() { return 'climate'; }
    }
    var EXCLUDES = [{ name: 'exclude_areas', selector: { area: { multiple: true } } },
                    { name: 'exclude_entities', selector: { entity: { multiple: true } } }];
    C.register('hk-climate-status-card', HkClimateStatusCard, 'HK Climate Status',
      'Whole-home temperature and humidity ranges, blinds and fans. Tap to see the included accessories.',
      [{ name: 'items', selector: { select: { multiple: true, mode: 'list', options: CLIMATE_KINDS } } }].concat(EXCLUDES),
      function () { return {}; });
    C.register('hk-page-status-card', HkPageStatusCard, 'HK Page Status',
      'A category page\'s status row -- the lights, the doors and windows, the water, the security -- as the Climate page has. Tap to see the accessories.',
      [{ name: 'page', required: true, selector: { select: { mode: 'dropdown', options: [
          { value: 'lights', label: 'Lights' }, { value: 'doors_windows', label: 'Doors & Windows' },
          { value: 'water', label: 'Water' }, { value: 'security', label: 'Security' }, { value: 'climate', label: 'Climate' }] } } },
       { name: 'items', selector: { select: { multiple: true, mode: 'list', options: KINDS.map(function (k) {
          return { value: k, label: LABEL[k] };
        }) } }, helper: 'Leave empty to follow HK Settings → Status Rows.' }].concat(EXCLUDES),
      function () { return { page: 'lights' }; });

    C.register('hk-room-status-card', HkRoomStatusCard, 'HK Room Status',
      "A room's status line -- temperature, humidity, and what is on, open or detected -- read from its area.",
      [
        { name: 'area', required: true, selector: { area: { multiple: true } },
          helper: 'The room: one area, or several for a room that spans them.' },
        { name: 'items', selector: { select: { multiple: true, mode: 'list', options: KINDS.map(function (k) {
          return { value: k, label: LABEL[k] };
        }) } }, helper: 'Leave empty to follow HK Settings → Status Rows → Room Pages.' },
        C.section('Sensors', [
          { name: 'temperature', selector: { entity: { domain: 'sensor', device_class: 'temperature' } },
            helper: "Else the area's own temperature sensor (Settings → Areas)." },
          { name: 'humidity', selector: { entity: { domain: 'sensor', device_class: 'humidity' } } },
          { name: 'entities', selector: { entity: { multiple: true } },
            helper: "The page's own devices: the accessories (lights, outlets, blinds, fans, locks, TVs, ...) are counted from these (else the whole area)." },
          { name: 'exclude', selector: { entity: { multiple: true } }, helper: 'Leave these out of the counts.' },
          { name: 'include', selector: { entity: { multiple: true } }, helper: 'Count these too, from outside the area.' }
        ], 'mdi:tune')
      ],
      function (client) {
        var a = client && client.areas ? Object.keys(client.areas)[0] : null;
        return { area: a || 'living_room' };
      });
    window.hkRoom.Card = HkRoomStatusCard;
  });
})();
