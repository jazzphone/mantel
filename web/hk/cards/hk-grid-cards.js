// hk-grid-cards.js -- the Home Grid's own cards (docs/phase11/HOME-GRID.md,
// slice G3). Each is a catalog key's card (hk-grid-catalog.js) and is drawn
// for the sizes the catalog gives it, reading its cell from the `size`
// attribute the view sets and from --hk-cell-w / --hk-cell-h:
//
//   hk-grid-room-card        `room` (W, L, XL): a room in one card -- its name,
//                            its lights as HK's own light pills
//                            and its speaker's pill. A tap on a light toggles
//                            it; press and hold dims it (a drag up or down,
//                            then let go), or opens its sheet when held still.
//                            No sideways slider: a pager (G4) owns sideways
//                            drags.
//   hk-suggested-scene-card  `scene_suggested` (W, L): the scene for this time
//                            of day, from the block's windows (Morning 05:00-
//                            10:00 -> Good Morning...); the art follows it.
//   hk-action-card           `action` (S): one tap for one job -- Lock Up, All
//                            Lights Off, Garage, or a scene or script -- with
//                            the state it changes under its name.
//   hk-everything-card       `everything` (S, W, L, XL): the screen's pages and
//                            rooms as app icons, a tap going there (Small a
//                            folder of four; the last place opens the rest, as
//                            the tab bar's More sheet or the side menu does).
//   hk-grid-cameras-card     `cameras` (XL, XXL, F): the Cameras face -- up to
//                            nine stills at once, arranged to the block; a tap
//                            opens one live, a doorbell ring makes its tile
//                            live in place (2026-10-30).
//
// THE TABLET'S ROOM. A block may name `tablet_room` for its room: the wall
// tablet showing the screen, asked of the host (hkShell.tabletRoom -- Home
// Assistant's Wall Tablets entry, Mantel's tablet device), never read here.
//
// EVERY COMMAND GOES THROUGH THE CARD'S ACTION PORT (HkBase._call / _act): in
// Home Assistant the frontend's own call, in Mantel the command gateway, which
// classifies, checks and audits it before anything is sent.
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
    }, { once: true });
  }

  var TABLET_ROOM = 'tablet_room';
  var OFF = { unavailable: 1, unknown: 1 };
  function dom(id) { return String(id).split('.')[0]; }
  function attr(st, k) { return st && st.attributes ? st.attributes[k] : undefined; }
  function setting(path, fallback) {
    var HS = window.hkSettings;
    return HS && HS.get ? HS.get(path, fallback) : fallback;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ------------------------------------------------------------ the room
  // A block's room: its own, or the tablet's (through the host), else the
  // screen's first room (a desk's browser is no wall tablet).
  function roomOf(area, fallback, client) {
    if (area && area !== TABLET_ROOM) return area;
    var SH = window.hkShell, here = null;
    try { here = SH && SH.tabletRoom ? SH.tabletRoom(client) : null; } catch (e) { here = null; }
    return here || fallback || null;
  }
  function areaOf(client, id) {
    var e = ((client && client.entities) || {})[id] || {}, devs = (client && client.devices) || {};
    return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
  }
  // its own area's, else its device's
  function isGroup(st) { return Array.isArray(attr(st, 'entity_id')) || Array.isArray(attr(st, 'group_entities')); }

  // WHAT A ROOM CARD SHOWS, as the room's page has it (hkStrategy.roomCards:
  // its hidden accessories left out, its own order, its tiles' looks): the
  // light pills and the speakers' (a TV is not the room's speaker).
  // KEPT while the registries, the settings and the house's entities are the
  // same: the room card asks on every new client (several a second), and the
  // room page's build walks every entity.
  var partsMemo = { key: null, ents: null, devs: null, areas: null, out: null };
  function roomParts(client, area) {
    var S = window.hkStrategy, out = { lights: [], speakers: [], all: [] };
    if (!S || !S.roomCards || !client || !client.states) return out;
    var HS = window.hkSettings;
    var key = area + '|' + (HS ? HS.version : '') + '|' + Object.keys(client.states).length;
    var m = partsMemo;
    if (m.out && m.key === key && m.ents === client.entities && m.devs === client.devices && m.areas === client.areas) return m.out;
    partsMemo = { key: key, ents: client.entities, devs: client.devices, areas: client.areas, out: out };
    var room = (client.areas || {})[area] || {};
    var cards = [];
    // HIDDEN ACCESSORIES (HK Settings; `generated`): what the room's page leaves out, the block does too
    // (2026-10-24: without them the block showed accessories hidden from every screen)
    var G = (HS && HS.get && HS.get('generated', null)) || {}, hides = {};
    ['exclude_entities', 'exclude_devices', 'exclude_areas', 'include_entities'].forEach(function (k) { if (Array.isArray(G[k])) hides[k] = G[k]; });
    try { cards = S.roomCards(client, [area], room.name || area, hides) || []; } catch (e) { cards = []; }
    (function walk(list) {
      (list || []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        var g = c.hk_place && c.hk_place.group;
        if (c.entity && g) out.all.push(c);
        if (c.entity && (g === 'Lights' || (g === 'Climate' && dom(c.entity) === 'fan'))) out.lights.push(c);
        else if (g === 'Speakers & TVs' && c.entity) {
          var dc = attr(client.states[c.entity], 'device_class');
          if (dc !== 'tv' && dc !== 'receiver') out.speakers.push(c);
        }
        if (Array.isArray(c.cards)) walk(c.cards);
      });
    })(cards);
    return out;
  }
  // WHAT THE ROOM IS DOING, in a line under its name (the widget mock-up,
  // 2026-10-31): its temperature (a sensor's, else its thermostat's reading,
  // never a setpoint: hkRoom.climateReading), the lights on, and at Extra
  // Large a speaker playing -- "71° · 2 lights on"; Wide, beside the name,
  // the short form "71° · 2 on"
  function roomLine(client, area, parts, size) {
    var st = client.states || {}, temp = null;
    // (as the house reports it, the way the thermostat's tile says it -- no conversion)
    var ids = Object.keys(st).filter(function (id) {
      return areaOf(client, id) === area && ((dom(id) === 'sensor' && attr(st[id], 'device_class') === 'temperature') || dom(id) === 'climate');
    }).sort(function (a, b) { return (dom(a) === 'sensor' ? 0 : 1) - (dom(b) === 'sensor' ? 0 : 1); });
    for (var i = 0; i < ids.length && temp === null; i++) {
      var raw = dom(ids[i]) === 'climate' ? attr(st[ids[i]], 'current_temperature') : st[ids[i]].state;
      if (raw != null && raw !== '' && isFinite(Number(raw)) && !OFF[st[ids[i]].state]) temp = Number(raw);
    }
    var lit = parts.all.filter(function (c) { return dom(c.entity) === 'light' && st[c.entity] && st[c.entity].state === 'on'; }).length;
    var playing = parts.speakers.some(function (c) { return st[c.entity] && st[c.entity].state === 'playing'; });
    var out = [];
    if (temp !== null) out.push(Math.round(temp) + '°');
    if (parts.all.some(function (c) { return dom(c.entity) === 'light'; })) {
      out.push(size === 'W' ? (lit ? lit + ' on' : 'All off') : lit ? plural(lit, 'light on', 'lights on') : 'Lights off');
    }
    if (playing && (size === 'XL' || size === 'XXL')) out.push('Speaker playing');
    return out.join(' · ');
  }
  // A PILL AS THE ROOM CARD DRAWS IT: the page's own, regular size, and a tap
  // anywhere on it toggles (the hold is the room card's, below)
  function pill(c, light) {
    var t = Object.assign({}, c);
    delete t.hk_place; delete t.view_layout;
    if (t.size === 'tall') t.size = 'regular';
    if (light) t.tap_action = { action: 'toggle' };
    return t;
  }
  // its speaker: the one playing, else the first
  function speakerOf(client, list) {
    var st = (client && client.states) || {};
    var playing = list.filter(function (c) { var s = st[c.entity]; return s && s.state === 'playing'; })[0];
    return playing || list[0] || null;
  }
  // How many pills fit: whole rows of them under the header, the room's
  // columns across. The last place is the speaker's when there is one; lights
  // that don't fit are left out (the room's page has them all).
  // (8 px between them: the widget mock-up's tight grid, 2026-10-31)
  var PILL_H = 70, GAP = 8;
  var COLS = { W: 2, L: 2, XL: 3, XXL: 6 };
  var HEAD = { W: 42, L: 66, XL: 66, XXL: 66 };
  function fit(size, height) {
    var rows = Math.max(0, Math.floor((height - (HEAD[size] || HEAD.W) + GAP) / (PILL_H + GAP)));
    rows = Math.min(rows, size === 'W' ? 1 : 2);
    return rows * (COLS[size] || 2);
  }
  function layout(parts, size, places, client) {
    var sp = speakerOf(client, parts.speakers);
    var room = Math.max(0, places - (sp ? 1 : 0));
    var lights = parts.lights.slice(0, room).map(function (c) { return pill(c, true); });
    var out = lights.slice();
    if (sp && places > 0) out.push(pill(sp, false));
    return out;
  }

  // A LIGHT'S BRIGHTNESS, in percent (0 when off), and whether it dims at all
  function percent(st) {
    if (!st || st.state !== 'on') return 0;
    var b = attr(st, 'brightness');
    return typeof b === 'number' ? Math.max(1, Math.round(b / 2.55)) : 100;
  }
  function dims(id, st) {
    if (dom(id) !== 'light' || !st) return false;
    var modes = attr(st, 'supported_color_modes');
    if (Array.isArray(modes)) return modes.some(function (m) { return m !== 'onoff'; });
    return typeof attr(st, 'brightness') === 'number';
  }
  // the hold's drag: DIM_PX of travel is the whole range, up brighter
  var HOLD_MS = 450, SLOP = 10, DIM_PX = 160;
  function dragged(start, dy) { return Math.max(0, Math.min(100, Math.round(start - dy / DIM_PX * 100))); }
  // what letting go sends: off at 0, else that brightness
  function dimCall(id, pct) {
    return pct <= 0 ? ['light', 'turn_off', { entity_id: id }]
                    : ['light', 'turn_on', { entity_id: id, brightness_pct: pct }];
  }

  // ---------------------------------------------------- the suggested scene
  // THE CARD'S OWN WINDOWS, for a block that sets none: each finds its scene
  // by name among the house's (Good Morning, Bright Day, Dinner, Good Night).
  var DEFAULT_WINDOWS = [
    { label: 'Morning', start: '05:00', end: '10:00', art: 'morning', words: ['morning', 'wake', 'sunrise'] },
    { label: 'Day', start: '10:00', end: '17:00', art: 'day', words: ['day', 'bright', 'focus', 'work', 'concentrate'] },
    { label: 'Evening', start: '17:00', end: '22:00', art: 'evening', words: ['evening', 'dinner', 'relax', 'sunset'] },
    { label: 'Night', start: '22:00', end: '05:00', art: 'night', words: ['night', 'bed', 'sleep'] }
  ];
  function minutes(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }
  // a window holds `now` (minutes into the day): [start, end), past midnight too
  function holds(w, now) {
    var a = minutes(w.start), b = minutes(w.end);
    if (a === null || b === null || a === b) return false;
    return a < b ? (now >= a && now < b) : (now >= a || now < b);
  }
  // the time of day in the house's zone, in minutes
  function houseMinutes(date) {
    var d = date || new Date();
    try {
      var L = window.hkLocale, z = L && L.zone ? L.zone() : null;
      var s = d.toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
                                                          z ? { timeZone: z } : {}));
      var m = minutes(s.slice(0, 5));
      if (m !== null) return m;
    } catch (e) { /* no Intl here */ }
    return d.getHours() * 60 + d.getMinutes();
  }
  function friendly(client, id) {
    var st = client && client.states && client.states[id];
    var acc = ((setting('accessories', {}) || {}).entities || {})[id] || {};
    return acc.name || attr(st, 'friendly_name') || id;
  }
  // a default window's scene: the first shown scene whose name has its words
  function sceneFor(client, words) {
    var st = (client && client.states) || {}, ents = (client && client.entities) || {};
    var ids = Object.keys(st).filter(function (id) {
      return dom(id) === 'scene' && !(ents[id] && (ents[id].hidden || ents[id].entity_category));
    }).sort();
    for (var i = 0; i < words.length; i++) {
      var w = new RegExp('\\b' + words[i], 'i');
      for (var j = 0; j < ids.length; j++) if (w.test(friendly(client, ids[j]))) return ids[j];
    }
    return null;
  }
  function artOf(w, name) {
    var n = String(name || '') + ' ' + String(w.label || '');
    if (/morning|wake|sunrise/i.test(n)) return 'morning';
    if (/night|bed|sleep/i.test(n)) return 'night';
    if (/evening|dinner|sunset|relax/i.test(n)) return 'evening';
    var a = minutes(w.start);
    return a === null ? 'day' : a >= 300 && a < 600 ? 'morning' : a >= 600 && a < 1020 ? 'day' : a >= 1020 && a < 1320 ? 'evening' : 'night';
  }
  // THE SUGGESTION: the window that holds now, with its scene; else the next
  // one to come (`next`). null when no window has a scene the house has.
  function suggestion(client, windows, now) {
    var list = (Array.isArray(windows) && windows.length ? windows : DEFAULT_WINDOWS).map(function (w) {
      var id = w.scene || (w.words ? sceneFor(client, w.words) : null);
      var ok = id && client && client.states && client.states[id];
      return ok ? { start: w.start, end: w.end, scene: id, label: w.label || '', art: w.art || null } : null;
    }).filter(Boolean);
    if (!list.length) return null;
    var cur = list.filter(function (w) { return holds(w, now); })[0];
    var next = false;
    if (!cur) {
      next = true;
      cur = list.slice().sort(function (x, y) {
        return ((minutes(x.start) - now + 1440) % 1440) - ((minutes(y.start) - now + 1440) % 1440);
      })[0];
    }
    var name = friendly(client, cur.scene);
    return { scene: cur.scene, name: name, label: cur.label || null, start: cur.start, end: cur.end, next: next,
             art: cur.art || artOf(cur, name) };
  }
  // "10:00" said the house's way (10:00 AM, 10:00)
  function clockText(hhmm) {
    var m = minutes(hhmm);
    if (m === null) return String(hhmm || '');
    var d = new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
    try {
      var L = window.hkLocale;
      if (L && L.time) return L.time(d, { hour: 'numeric', minute: '2-digit', timeZone: 'local' });
    } catch (e) { /* the plain form */ }
    return hhmm;
  }

  // WHAT A SCENE DOES, in a line (a Scene block at Wide, 2026-10-31: "its
  // name and what it does"): what it sets, counted by kind, from the
  // entities Home Assistant says it holds -- "Sets 2 lights, 1 shade and 1
  // speaker"; a scene that says nothing is a Scene
  var SAYS = [['light', 'light', 'lights'], ['cover', 'shade', 'shades'], ['media_player', 'speaker', 'speakers'],
              ['climate', 'thermostat', 'thermostats'], ['fan', 'fan', 'fans'], ['switch', 'switch', 'switches'],
              ['lock', 'lock', 'locks']];
  function sceneSays(client, id) {
    var ids = attr(client && client.states && client.states[id], 'entity_id'), by = {};
    if (!Array.isArray(ids) || !ids.length) return 'Scene';
    ids.forEach(function (e) { by[dom(e)] = (by[dom(e)] || 0) + 1; });
    var parts = SAYS.filter(function (k) { return by[k[0]]; }).map(function (k) { return plural(by[k[0]], k[1], k[2]); });
    var rest = ids.length - SAYS.reduce(function (n, k) { return n + (by[k[0]] || 0); }, 0);
    if (rest) parts.push(plural(rest, 'other', 'others'));
    return 'Sets ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]);
  }

  // ------------------------------------------------------------ the actions
  // The house's lists (HK Settings -> Status & Chips, kinds.py), as the
  // header's security line reads them (hk-header.js lists). An empty list is
  // none chosen: the action then takes every one the house has.
  function kind(name) {
    var k = setting('kinds.' + name, null);
    if (Array.isArray(k) && k.length) return k;
    var H = window.hkHeader;
    var l = H && H.lists ? H.lists() : null;
    return (l && Array.isArray(l[name]) && l[name].length && l[name]) || null;
  }
  function own(client, prefix) {
    var st = (client && client.states) || {}, ents = (client && client.entities) || {};
    return Object.keys(st).filter(function (id) {
      return dom(id) === prefix && !isGroup(st[id]) && !(ents[id] && (ents[id].hidden || ents[id].entity_category));
    }).sort();
  }
  var DOORS = { garage: 1, gate: 1 };
  // WHAT AN ACTION DOES AND SAYS: {name, icon, state, hot, calls, sheet}.
  // `hot`: there is something for it to do (its glyph in color). `calls`:
  // [domain, service, data] each, sent on a tap; `sheet`: an entity whose
  // sheet a tap opens instead (a garage door is never one tap).
  var NAMES = { lock_up: ['Lock Up', 'hk:lock'], lights_off: ['All Lights Off', 'hk:lightbulb'], garage: ['Garage', 'hk:garage'] };
  function plan(client, action, area) {
    var st = (client && client.states) || {};
    if (!client || !client.states) {
      var n = NAMES[action] || [action, 'mdi:gesture-tap'];
      return { name: n[0], icon: n[1], hot: false, state: '', calls: [], sheet: null };
    }
    if (action === 'lock_up') {
      var locks = (kind('locks') || own(client, 'lock')).filter(function (id) { return dom(id) === 'lock' && st[id]; });
      var open = locks.filter(function (id) { return st[id].state === 'unlocked' || st[id].state === 'open'; });
      var unsure = locks.filter(function (id) { return OFF[st[id].state]; }).length;
      return { name: 'Lock Up', icon: open.length ? 'hk:lock-open-variant' : 'hk:lock', hot: open.length > 0,
               state: !locks.length ? 'No Locks' : open.length ? plural(open.length, 'Unlocked', 'Unlocked')
                    : unsure ? plural(unsure, 'Lock Unknown', 'Locks Unknown') : 'All Locked',
               calls: open.length ? [['lock', 'lock', { entity_id: open }]] : [], sheet: null };
    }
    if (action === 'lights_off') {
      var room = area || null;
      var lights = (kind('lights') || own(client, 'light')).filter(function (id) {
        return st[id] && !isGroup(st[id]) && (!room || areaOf(client, id) === room);
      });
      var on = lights.filter(function (id) { return st[id].state === 'on'; });
      var by = {};
      on.forEach(function (id) { (by[dom(id)] = by[dom(id)] || []).push(id); });
      var rname = room && ((client.areas || {})[room] || {}).name;
      return { name: room ? 'Lights Off' : 'All Lights Off', icon: 'hk:lightbulb', hot: on.length > 0,
               state: on.length ? plural(on.length, 'Light On', 'Lights On') : (rname ? rname + ' Off' : 'All Off'),
               calls: Object.keys(by).sort().map(function (d) { return [d, 'turn_off', { entity_id: by[d] }]; }),
               sheet: null };
    }
    if (action === 'garage') {
      var doors = (kind('garage') || []).filter(function (id) { return st[id]; });
      if (!doors.length) {
        doors = own(client, 'cover').filter(function (id) { return DOORS[attr(st[id], 'device_class')]; });
      }
      var g = doors.filter(function (id) { return dom(id) === 'cover'; })[0] || doors[0] || null;
      var s = g ? st[g].state : null;
      var shut = s === 'closed' || s === 'off';
      var words = { open: 'Open', on: 'Open', closed: 'Closed', off: 'Closed', opening: 'Opening…', closing: 'Closing…' };
      return { name: g ? friendly(client, g) : 'Garage', icon: shut || !g ? 'hk:garage' : 'hk:garage-open',
               hot: !!g && !shut && !OFF[s], state: !g ? 'No Garage' : (words[s] || 'Unknown'), calls: [], sheet: g };
    }
    var d = dom(action);
    if ((d === 'scene' || d === 'script') && st[action]) {
      var run = d === 'script' && st[action].state === 'on';
      var ent = ((client.entities || {})[action]) || {};
      var acc = ((setting('accessories', {}) || {}).entities || {})[action] || {};
      return { name: friendly(client, action), icon: acc.icon || ent.icon || attr(st[action], 'icon') ||
                 (d === 'scene' ? 'mdi:palette' : 'mdi:script-text-play'),
               hot: run, state: run ? 'Running' : d === 'scene' ? 'Scene' : 'Script',
               calls: [[d, 'turn_on', { entity_id: action }]], sheet: null };
    }
    return { name: 'Action', icon: 'mdi:gesture-tap', hot: false, state: 'Not Found', calls: [], sheet: null };
  }

  // THE MENU'S PAGES AND ROOMS, counted for the Everything card's line
  function menuCounts() {
    var M = window.hkCards && window.hkCards.menu, cfg = null;
    try { cfg = M && M.config ? M.config() : null; } catch (e) { cfg = null; }
    var views = (cfg && Array.isArray(cfg.views)) ? cfg.views : null;
    if (!views) return null;
    var rooms = 0, pages = 0;
    views.forEach(function (v, i) {
      if (!v || v.subview || i === 0) return;
      if (v.area || (v.strategy && v.strategy.area)) rooms++; else pages++;
    });
    return { pages: pages, rooms: rooms };
  }

  // ------------------------------------------------------------ the cameras face
  // ITS ARRANGEMENT: [columns, rows] for `n` cameras in a block of `size`, at
  // most Extra Large's 3 x 2, Full Width's 4 x 2, Full's 3 x 3 -- 2 x 4 in a
  // view two columns wide (`cols`: a phone's). Fewer cameras take fewer
  // places: the fewest empty, then the tiles nearest 16:9 in the block's
  // w x h px (unmeasured: as the most it holds would draw them).
  var CAM_MAX = { XL: [3, 2], XXL: [4, 2] }, WIDE = 16 / 9;
  function camGrid(size, n, w, h, cols) {
    var max = CAM_MAX[size] || (cols > 0 && cols <= 2 ? [2, 4] : [3, 3]), best = null;
    n = Math.max(1, Math.min(n | 0, max[0] * max[1]));
    for (var c = 1; c <= max[0]; c++) {
      for (var r = 1; r <= max[1]; r++) {
        if (c * r < n) continue;
        var ar = w > 0 && h > 0 ? (w / c) / (h / r) : (max[0] / c) / (max[1] / r) * WIDE;
        var t = { at: [c, r], empty: c * r - n, off: Math.abs(Math.log(ar / WIDE)) };
        if (!best || t.empty < best.empty || (t.empty === best.empty && t.off < best.off - 1e-9)) best = t;
      }
    }
    return best.at;
  }
  // THE DOORBELL A RING NAMES (the house's notification, kind doorbell): its
  // camera when the face shows it, else a camera called doorbell (as a
  // cameras block's pager turns to it: hk-layout.js pagerDoorbell)
  function camRing(ids, camera) {
    if (camera && ids.indexOf(camera) >= 0) return camera;
    return ids.filter(function (id) { return /doorbell/.test(id); })[0] || null;
  }

  window.hkGridCards = { version: '1.0.0',
    _: { roomOf: roomOf, roomParts: roomParts, fit: fit, layout: layout, percent: percent,
         dims: dims, dragged: dragged, dimCall: dimCall, suggestion: suggestion, holds: holds, minutes: minutes,
         houseMinutes: houseMinutes, plan: plan, menuCounts: menuCounts, DEFAULT_WINDOWS: DEFAULT_WINDOWS,
         HOLD_MS: HOLD_MS, camGrid: camGrid, camRing: camRing } };

  whenBase(function (C) {
    if (window.hkGridCards.Room) return;
    var HkBase = C.HkBase, esc = C.esc, v = C.v, T = C.TYPE, TILE = C.TILE;
    function type(role) {
      var t = T[role];
      return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '');
    }
    function sizeOf(el) {
      var s = (el.getAttribute && el.getAttribute('size')) || (el._config || {}).size;
      return /^(S|W|T|L|XL|XXL)$/.test(s || '') ? s : null;
    }
    // a size attribute set after the card is drawn (the view sets it on
    // placing the card) draws it again
    // (and its Tile Style: the Room and Accessories blocks hand it to their tiles)
    function watchSize(Ctor) {
      Object.defineProperty(Ctor, 'observedAttributes', { get: function () { return ['size', 'tile']; } });
      Ctor.prototype.attributeChangedCallback = function () { if (this._config) { this._built = false; this.redraw(); } };
    }

    // ===================================================== hk-grid-room-card
    var ROOM_CSS = [
      ':host{display:block;height:100%;position:relative}',
      '.room{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('14px') + ';gap:8px;' + C.plate('card') + ';',
      '  --hk-pill:100%}',
      // THE NAME (the widget mock-up, 2026-10-31): Wide, a headline with what
      // the room is doing at its right on the same line; Large and up, a
      // title with that line under it -- and the way into its page, when it has one
      '.hd{display:flex;align-items:baseline;gap:10px;min-width:0;flex:none;padding:0 2px}',
      '.room:not([size=W]) .hd{flex-direction:column;align-items:flex-start;gap:1px}',
      '.nm{all:unset;position:relative;cursor:pointer;min-width:0;max-width:100%;display:flex;align-items:center;gap:5px;',
      '  ' + type('headline') + ';line-height:22px;color:' + v('ink') + ';text-shadow:' + v('glow') + ';-webkit-tap-highlight-color:transparent}',
      '.room:not([size=W]) .nm{' + type('title') + ';line-height:27px}',
      // a 44 px target round the line (DESIGN.md: touch targets)
      '.nm::after{content:"";position:absolute;left:-8px;right:-8px;top:-12px;bottom:-12px}',
      '.nm:disabled{cursor:default}',
      '.nm span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0 2px 1px}',
      '.nm i{font-style:normal;opacity:0.62;flex:none}',
      '.nm:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
      '.st{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';text-shadow:' + v('glow') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.room[size=W] .st{margin-left:auto}',
      '.st:empty{display:none}',
      // THE TILES, in whole rows, 8 px apart (the mock-up's tight grid)
      '.tiles{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));',
      '  grid-template-rows:repeat(var(--rows,2),minmax(0,1fr));gap:' + GAP + 'px;flex:1;min-height:0}',
      // ...or scrolling: as many rows showing as the block has, the rest
      // under them -- up and down is the room's, sideways the pager's
      '.tiles.scrolling{grid-template-rows:none;grid-auto-rows:calc((100% - var(--scroll-gaps,' + GAP + 'px))/var(--rows,2));align-content:start;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scrollbar-width:none}',
      '.tiles.scrolling::-webkit-scrollbar{display:none}',
      '.tiles.scrolling .slot{touch-action:pan-x pan-y}',
      // (a slot is a cell of its own, not the grid's: it is no square because the grid's cells are -- hk-layout.js)
      '.slot{container-type:size;container-name:hk-cell;--hk-cell-shape:none;min-width:0;min-height:0}.slot > *{display:block;width:100%;height:100%}',
      '.more{border:0;border-radius:var(--hk-inner-radius,' + v('glass-radius') + ');' + C.plate('tile') + ';color:' + v('ink') + ';' + type('body') + ';min-height:44px;cursor:pointer}',
      '.slot{position:relative;touch-action:pan-x;-webkit-user-select:none;user-select:none;',
      '  -webkit-touch-callout:none}',
      '.none{' + type('body') + ';color:' + v('ink-3') + ';text-shadow:' + v('glow') + '}',
      // THE FOOT LINE (the owner, 2026-10-31: "dots for the rooms, then 'N
      // more below' (dots, not '1 of 4 rooms')"): one short line, centred --
      // the rooms' dots when the block pages through them, a tap beside the
      // current one a room back or on, and what is scrolled out of sight
      '.ft{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;height:16px;min-width:0;' + type('micro') + ';line-height:16px;color:' + v('ink-2') + ';text-shadow:' + v('glow') + '}',
      '.ft[hidden],.ft [hidden]{display:none}',
      '.fd{all:unset;position:relative;display:flex;gap:6px;align-items:center;height:16px;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      // (the dots' 44 px target, reaching up over the tiles' gap and down into the inset)
      '.fd::after{content:"";position:absolute;left:-10px;right:-10px;top:-12px;bottom:-16px}',
      '.fd:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:8px}',
      '.fd i{width:7px;height:7px;border-radius:50%;background:' + v('mark') + ';flex:none}',
      '.fd i[aria-current=true]{background:' + v('ink') + '}',
      '.ft b{width:3px;height:3px;border-radius:50%;background:' + v('ink-3') + ';flex:none}',
      '.ft span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE DIMMER, while a light is held: the readout over its pill -- a
      // fill from the bottom and the percent -- on the near-solid overlay
      '.dim{position:absolute;inset:0;border-radius:var(--hk-inner-radius,' + v('glass-radius') + ');overflow:hidden;',
      '  background:' + v('overlay-solid') + ';display:flex;align-items:center;justify-content:center;',
      '  pointer-events:none;z-index:1}',
      '.dim i{position:absolute;left:0;right:0;bottom:0;background:' + v('track-fill') + ';opacity:0.32}',
      '.dim b{position:relative;' + type('title') + ';color:' + v('ink') + ';font-variant-numeric:tabular-nums}'
    ].join('');

    class HkGridRoomCard extends HkBase {
      static get CSS() { return ROOM_CSS; }
      setConfig(config) { super.setConfig(Object.assign({ area: TABLET_ROOM }, config || {})); }
      getCardSize() { return 4; }
      _size() { var s = sizeOf(this); return COLS[s] ? s : 'L'; }
      _area() { return roomOf(this._config.area, this._config.fallback, this.client); }
      _height() {
        var h = this._h;
        if (!h) {
          var r = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
          h = r && r.height ? r.height : 0;
        }
        if (!h) {
          // not laid out yet: the size class's rows of HK's own grid
          var rows = (C.HOME_GRID.sizes[this._size()] || [2, 2])[1];
          h = rows * C.TILE.tall + (rows - 1) * C.HOME_GRID.gap;
        }
        return h;
      }
      // THE PAGER IT IS A PAGE OF (hk-layout.js hk-pager-card, a block whose
      // pages are the rooms): its page, "2 of 5" (the page's own label), and
      // the pager, to turn -- null when it pages nothing
      _paging() {
        if (!this.hasAttribute('data-grid-pager')) return null;
        var page = this.parentNode, root = this.getRootNode ? this.getRootNode() : null, pager = root && root.host;
        var m = page && page.getAttribute && /^(\d+) of (\d+)$/.exec(page.getAttribute('aria-label') || '');
        if (!m || !pager || typeof pager.goTo !== 'function') return null;
        return { at: +m[1] - 1, of: +m[2], pager: pager };
      }
      // what it draws, in one go: the room, its pills, its line
      _plan() {
        var h = this.client, size = this._size(), area = this._area();
        if (!h || !h.states || !area) return { area: area, size: size, tiles: [], status: '', name: '' };
        var parts = roomParts(h, area), name = (h.areas[area] || {}).name || area, status = roomLine(h, area, parts, size);
        if (this._config.accessory_display === 'scroll') {
          return { area: area, size: size, scroll: true, more: 0, name: name, status: status,
                   tiles: parts.all.map(function (c) { return pill(c, ['light', 'switch', 'input_boolean', 'fan'].indexOf(dom(c.entity)) >= 0); }) };
        }
        // (the foot line's room, when it pages: hk-layout.js leaves a paged room its own dots)
        var places = fit(size, this._height() - (this.hasAttribute('data-grid-pager') ? 24 : 0));
        var total = parts.lights.length + (speakerOf(h, parts.speakers) ? 1 : 0), more = total > places;
        return { area: area, size: size, parts: parts, tiles: layout(parts, size, Math.max(0, places - (more ? 1 : 0)), h),
                 more: more ? total - Math.max(0, places - 1) : 0, name: name, status: status };
      }
      _sigOf() {
        var p = this._plan();
        this._p = p;
        return JSON.stringify([p.area, p.size, p.name, p.status, p.more, !!p.scroll, this._config.surface, p.tiles.map(function (t) { return t.entity; }),
                               this._height(), !!window.hkStrategy, !!window.hkRoom, this.getAttribute('tile')]);
      }
      // EACH NEW CLIENT: every pill gets it (they gate their own draws)
      _receiveClient() {
        super._receiveClient();
        var c = this.client;
        (this._kids || []).forEach(function (k) {
          window.hkHostClient.bridge(k, c);
        });
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._ro && typeof ResizeObserver === 'function') {
          this._ro = new ResizeObserver(function (en) {
            var r = en && en[0] && en[0].contentRect, hh = r ? Math.round(r.height) : 0;
            if (hh && hh !== self._h) { self._h = hh; self.redraw(); }
            self._below();
          });
          this._ro.observe(this);
        }
      }
      disconnectedCallback() {
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._holdT) { clearTimeout(this._holdT); this._holdT = null; }
        super.disconnectedCallback();
      }
      _render() {
        var p = this._p || this._plan(), h = this.client, self = this;
        this._p = null;
        if (!this._built) {
          this._root.innerHTML = '<div class="room"><div class="hd"><button class="nm" type="button"><span></span>' +
            '<i aria-hidden="true">›</i></button><span class="st"></span></div>' +
            '<div class="tiles" role="list"></div>' +
            '<div class="ft" hidden><button class="fd" type="button"></button><b></b><span></span></div></div>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { box: q('.room'), hd: q('.hd'), nm: q('.nm'), name: q('.nm span'), chev: q('.nm i'), st: q('.st'), tiles: q('.tiles'),
                      ft: q('.ft'), fd: q('.fd'), sep: q('.ft b'), below: q('.ft span') };
          this._e.nm.addEventListener('click', function (e) { e.stopPropagation(); self._openRoom(); });
          // a tap on the dots: a room back or on, by the side of the current dot it lands
          this._e.fd.addEventListener('click', function (e) {
            e.stopPropagation();
            var pg = self._paging(), cur = pg && self._e.fd.children[pg.at];
            if (!cur) return;
            var r = cur.getBoundingClientRect(), to = pg.at + (e.clientX < r.left + r.width / 2 ? -1 : 1);
            if (to >= 0 && to < pg.of) pg.pager.goTo(to, true);
          });
          this._e.tiles.addEventListener('scroll', function () { self._below(); }, { passive: true });
          this._kids = []; this._key = null;
          this._built = true;
        }
        var e = this._e;
        e.box.setAttribute('size', p.size);
        C.groupSurface(e.box, this._config.surface);
        e.hd.style.display = p.head === false ? 'none' : '';
        // HOW MANY ACROSS AND DOWN: the block's own (Accessories: by its
        // Height), else the room's columns and its rows -- as many pills as
        // it has fill the block: fewer than a row's worth, one row of taller
        // ones, not a second row of nothing (2026-10-30)
        var nPills = (p.tiles || []).length + (p.more ? 1 : 0), cols = p.cols || COLS[p.size];
        var oneRow = p.size !== 'W' && !p.scroll && nPills > 0 && nPills <= cols;
        var rows = p.rows || (p.size === 'W' || oneRow ? 1 : 2);
        e.tiles.style.setProperty('--cols', String(cols));
        e.tiles.style.setProperty('--rows', String(rows));
        e.tiles.style.setProperty('--scroll-gaps', ((rows - 1) * GAP) + 'px');
        e.tiles.classList.toggle('scrolling', !!p.scroll);
        if (e.name.textContent !== (p.name || 'Room')) e.name.textContent = p.name || 'Room';
        if (e.st.textContent !== (p.status || '')) e.st.textContent = p.status || '';
        var path = this._roomPath(p.area);
        e.chev.style.display = path ? '' : 'none';
        e.nm.setAttribute('aria-label', (p.name || 'Room') + (path ? ', open the room' : ''));
        // the pills: made again only when what they are changes
        // CENTRED (2026-10-31, the owner: the Accessories block's tiles "don't
        // follow the sizing for HomeView styling", with no second line): the
        // block's Tile Style on each tile -- the glyph bare and large over the
        // name and its state, the cell's own sizes (hk-base.js TILE.centred).
        // An Accessories block's Full is Centred on every dashboard, its Half
        // the Home app's pill (p.centred, p.half); Color each lit one on its
        // own color's gradient (hk-tile.js block_color).
        var centred = !p.half && (p.centred || this.getAttribute('tile') === 'centred');
        var key = JSON.stringify([p.tiles, p.more, p.size, !!p.scroll, centred, !!p.half, !!p.color]);
        if (key !== this._key) {
          this._key = key;
          e.tiles.innerHTML = '';
          this._kids = [];
          if (!p.tiles.length) {
            var none = document.createElement('div');
            none.className = 'none';
            none.textContent = p.empty || (p.area ? (p.size === 'W' ? '' : (p.scroll ? 'No accessories in this room' : 'No lights in this room')) : 'No room');
            e.tiles.appendChild(none);
          }
          p.tiles.forEach(function (t) {
            var slot = document.createElement('div');
            slot.className = 'slot';
            var tall = p.size !== 'W' && !p.half;
            if (tall) slot.setAttribute('size', 'S');
            slot.setAttribute('role', 'listitem');
            // (Wide: a row of the room's regular pills -- a thermostat's too, whose tall tile was cut above the foot line)
            var cfg = Object.assign({}, t, p.half ? { size: 'regular', tile: 'home' } : tall ? { size: 'tall' } : { size: 'regular' }, p.color ? { block_color: true } : {});
            var el = C.createCard(cfg, h);
            if (tall) el.setAttribute('size', 'S');
            el.setAttribute('data-group-fill', '');
            if (centred) el.setAttribute('tile', 'centred');
            slot.appendChild(el);
            e.tiles.appendChild(slot);
            self._kids.push(el);
            if (t.tap_action && dom(t.entity) === 'light') self._wireHold(slot, t.entity);
          });
          if (p.more) {
            var more = document.createElement('button'); more.className = 'more';
            more.textContent = '+' + p.more + ' more';
            more.addEventListener('click', () => self._openRoom()); e.tiles.appendChild(more);
          }
        }
        // THE FOOT LINE: the rooms' dots while it pages, and -- scrolling --
        // a place for what is out of sight whenever there is more than shows
        var pg = this._paging();
        var fdKey = pg ? pg.at + '/' + pg.of : '';
        if (e.fd.getAttribute('data-k') !== fdKey) {
          e.fd.setAttribute('data-k', fdKey);
          e.fd.innerHTML = '';
          for (var i = 0; pg && i < pg.of; i++) {
            var d = document.createElement('i');
            if (i === pg.at) d.setAttribute('aria-current', 'true');
            e.fd.appendChild(d);
          }
          if (pg) e.fd.setAttribute('aria-label', (p.name || 'Room') + ', room ' + (pg.at + 1) + ' of ' + pg.of + '. Tap beside the dot for the room before or after.');
        }
        e.fd.hidden = !pg;
        this._scrolls = !!p.scroll && p.tiles.length > cols * rows;
        e.ft.hidden = !pg && !this._scrolls;
        this._below();
      }
      // "N MORE BELOW": the tiles not wholly in sight under the scroll's foot
      // (none once it is scrolled to the end)
      _below() {
        var e = this._e;
        if (!e) return;
        var n = 0;
        if (this._scrolls) {
          var t = e.tiles, bottom = t.scrollTop + t.clientHeight + 1;
          Array.prototype.forEach.call(t.children, function (c) { if (c.offsetTop + c.offsetHeight > bottom) n++; });
        }
        var text = n ? n + ' more below' : '';
        if (e.below.textContent !== text) e.below.textContent = text;
        e.below.hidden = !n;
        e.sep.hidden = !n || e.fd.hidden;
      }
      _roomPath(area) {
        var M = C.menu;
        try { return M && M.roomPath ? M.roomPath(area) : null; } catch (e) { return null; }
      }
      _openRoom() {
        var path = this._roomPath(this._area());
        if (path) C.navigate(path, this);
      }
      // (the plate's tap, hk-base.js openTarget: the heading's, anywhere the block has no accessory)
      _tapTarget() { var a = this._area(); return a ? [{ room: a }] : []; }

      // PRESS AND HOLD: the pill's own tap toggles; held still for HOLD_MS it
      // is the dimmer -- a drag up or down sets the brightness, sent once on
      // letting go -- or, held without moving, the light's sheet (its full
      // dimmer and colors). A light that doesn't dim opens its sheet at once.
      // The click that follows a hold is the hold's, not a toggle.
      _wireHold(slot, id) {
        var self = this, start = null, held = false, eat = false;
        var cancel = function () {
          if (self._holdT) { clearTimeout(self._holdT); self._holdT = null; }
        };
        slot.addEventListener('pointerdown', function (ev) {
          if (ev.button > 0) return;
          cancel();
          start = { x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
          held = false;
          self._holdT = setTimeout(function () {
            self._holdT = null;
            if (!start) return;
            held = true; eat = true;
            // the drag is the dimmer's now, not a swipe of the block's pages
            slot.setAttribute('data-hk-control', '');
            var st = self.client && self.client.states[id];
            if (!dims(id, st)) { start = null; window.hkShell.moreInfo(id, self); return; }
            start.pct = percent(st); start.now = start.pct; start.moved = false;
            try { slot.setPointerCapture(start.pid); } catch (e) { /* a test page */ }
            self._dimShow(slot, start.pct);
          }, HOLD_MS);
        });
        // Keep the initial move cancelable even over the child card's shadow
        // tree: a held light owns the gesture, a quick pan scrolls normally.
        slot.addEventListener('touchstart', function () {}, { passive: false });
        slot.addEventListener('touchmove', function (ev) { if (held && ev.cancelable) ev.preventDefault(); }, { passive: false });
        slot.addEventListener('pointermove', function (ev) {
          if (!start) return;
          var dy = ev.clientY - start.y, dx = ev.clientX - start.x;
          if (!held) {
            if (Math.hypot(dx, dy) > SLOP) { cancel(); start = null; }
            return;
          }
          if (Math.abs(dy) > SLOP) start.moved = true;
          if (!start.moved) return;
          ev.preventDefault();
          start.now = dragged(start.pct, dy);
          self._dimShow(slot, start.now);
        });
        var finish = function (send) {
          cancel();
          var s = start;
          start = null;
          slot.removeAttribute('data-hk-control');
          if (!held || !s) return;
          held = false;
          self._dimHide(slot);
          if (s.pct === undefined || !send) return;
          if (!s.moved) { window.hkShell.moreInfo(id, self); return; }
          var c = dimCall(id, s.now);
          self._call(c[0], c[1], c[2]);
        };
        slot.addEventListener('pointerup', function () { finish(true); });
        slot.addEventListener('pointercancel', function () { finish(false); });
        // the click after a hold: eaten before the pill sees it
        slot.addEventListener('click', function (ev) {
          if (!eat) return;
          eat = false;
          ev.stopPropagation();
          if (ev.preventDefault) ev.preventDefault();
        }, true);
        // a long press's own menu (Android, iOS) never shows over the dimmer
        slot.addEventListener('contextmenu', function (ev) { if (held || eat) ev.preventDefault(); });
      }
      _dimShow(slot, pct) {
        var d = slot.querySelector('.dim');
        if (!d) {
          d = document.createElement('div');
          d.className = 'dim';
          d.setAttribute('role', 'status');
          d.innerHTML = '<i></i><b></b>';
          slot.appendChild(d);
        }
        d.querySelector('i').style.height = pct + '%';
        d.querySelector('b').textContent = pct + '%';
      }
      _dimHide(slot) {
        var d = slot.querySelector('.dim');
        if (d && d.parentNode) d.parentNode.removeChild(d);
      }
    }
    watchSize(HkGridRoomCard);

    C.register('hk-grid-room-card', HkGridRoomCard, 'HK Room',
      'A room in one card: its name, its lights and fans (tap to turn on or off, press and hold to dim) and its speaker. Made for a Home Grid.',
      [{ name: 'area', selector: { area: {} },
         helper: 'Leave empty for the room of the wall tablet showing it.' }],
      function (client) {
        var a = client && client.areas ? Object.keys(client.areas)[0] : null;
        return { area: a || 'living_room' };
      });

    // Resolve the actual room-page tile at runtime, with the card's own
    // client (including editor previews). Never store a client in grid config.
    // Settings changes and late registries/providers can then update the same
    // mounted card, including pages and conditional fallbacks.
    class HkGridEntityCard extends HkBase {
      static get CSS() { return ':host{display:block;height:100%}:host>div,:host>div>*{display:block;width:100%;height:100%}'; }
      static get observedAttributes() { return ['size', 'data-grid-pager', 'tile']; }
      attributeChangedCallback(name, was, now) {
        this._sizeChild();
        // (Centred names the room under the accessory: the tile is made again)
        // (...and a scene's line is what it does at Wide: made again for a new size)
        if ((name === 'tile' || name === 'size') && was !== now && this._config && this.client) this.redraw();
      }
      _tile() {
        var cfg = this._config || {}, h = this.client, t;
        if (!cfg.entity) return null;
        if (cfg.kind === 'scene') {
          var scenes = window.hkChip && window.hkChip.scenes;
          t = scenes && scenes.pill ? scenes.pill(h, cfg.entity) : { type: 'custom:hk-scene-card', entity: cfg.entity };
          // A SCENE BLOCK (2026-10-31, the owner's notes on the widget
          // mock-up): HomeView's tile on every dashboard, glass or on its own
          // color's gradient (`color`); at Wide its glyph beside its name and
          // what it does (hk-tile.js, :host([tile=centred][size=W]))
          var wide = (this.getAttribute('size') || cfg.size) === 'W';
          t = Object.assign({}, t, { elevated: false, room: wide ? sceneSays(h, cfg.entity) : 'Scene' }, cfg.color ? { block_color: true } : {});
        } else {
          var S = window.hkStrategy;
          t = S && S.tileFor && h ? S.tileFor(h, cfg.entity, friendly(h, cfg.entity)) : { type: 'custom:hk-tile-card', entity: cfg.entity };
          t = Object.assign({}, t, { secondary: cfg.secondary });
        }
        // The block owns geometry; the shared builder owns the accessory.
        t.size = (this.getAttribute('size') || cfg.size) === 'W' ? 'regular' : 'tall';
        delete t.view_layout; delete t.hk_place;
        // CENTRED (2026-10-30): the name over its room, as HomeView has it (a
        // scene's line says it is one); an accessory in no room keeps its state
        // -- and one whose Line Under Name is chosen shows that, not the room
        // (the owner, 2026-10-31: set to State, "it's still just showing Master Bedroom")
        var chosen = cfg.secondary && cfg.secondary.mode && cfg.secondary.mode !== 'auto';
        // ...and every glyph the block's own size, bare (the tile's Centred
        // rule): an accessory drawn at a room page's size (the alarm's 27 px)
        // was a speck beside the others (the owner, 2026-10-31)
        if (this.getAttribute('tile') === 'centred' || cfg.kind === 'scene') { delete t.icon_size; delete t.bare_icon; delete t.well_background; }
        if (this.getAttribute('tile') === 'centred' && !chosen && cfg.kind !== 'scene') {
          var area = areaOf(h, cfg.entity), areas = (h && h.areas) || {};
          var room = area && areas[area] && areas[area].name;
          if (room) t.room = room;
        }
        return t;
      }
      _sigOf() { return JSON.stringify(this._tile()); }
      _receiveClient() {
        super._receiveClient();
        if (this._child) window.hkHostClient.bridge(this._child, this.client);
      }
      _sizeChild() {
        if (!this._child) return;
        this._child.setAttribute('size', this.getAttribute('size') || (this._config || {}).size || 'S');
        if (this.hasAttribute('data-grid-pager')) this._child.setAttribute('data-grid-pager', '');
        else this._child.removeAttribute('data-grid-pager');
        if (this.getAttribute('tile') === 'centred' || (this._config || {}).kind === 'scene') this._child.setAttribute('tile', 'centred');
        else this._child.removeAttribute('tile');
      }
      _render() {
        var t = this._tile();
        if (!t) return;
        var key = JSON.stringify(t);
        if (key !== this._tileKey) {
          if (this._child && this._childType === t.type) this._child.setConfig(t);
          else {
            this._child = C.createCard(t, this.client);
            this._root.replaceChildren(this._child);
          }
          this._childType = t.type; this._tileKey = key;
        }
        this._sizeChild();
      }
    }
    window.hkHostClient.entry(HkGridEntityCard);
    if (!customElements.get('hk-grid-entity-card')) customElements.define('hk-grid-entity-card', HkGridEntityCard);

    // Custom collections share the room's plate, fixed rows and accessory
    // controls; their ordered contents and captions belong to this block.
    class HkGridAccessoriesCard extends HkGridRoomCard {
      _area() { return null; }
      _roomPath() { return null; }
      _openRoom() {}
      _sigOf() { return super._sigOf() + JSON.stringify(this._config.accessories || []); }
      // HEIGHT AND COLOR (2026-10-31, the owner's notes on the widget
      // mock-up): the block is its tiles, no heading. Full, HomeView's tile
      // (Centred, the state under the name) on any dashboard -- W two, L
      // four, XL six; Half, the Home app's pill, twice as many rows. The grid
      // takes as many as are chosen, never an empty row (as Scenes does:
      // hk-chip.js scenesPlan). Color: each one lit on its own color.
      _plan() {
        var client = this.client, size = this._size(), cfg = this._config, half = cfg.height === 'half';
        var cell = C.HOME_GRID.sizes[size] || [2, 2], cols = cell[0], rows = cell[1] * (half ? 2 : 1);
        var entries = (cfg.accessories || []).slice(0, cols * rows), n = entries.length;
        if (n <= cols) { cols = Math.max(1, n); rows = 1; } else rows = Math.ceil(n / cols);
        var tiles = entries.map(function (entry) {
          var S = window.hkStrategy, id = entry.entity;
          var t = S && S.tileFor && client ? S.tileFor(client, id, friendly(client, id)) : { type: 'custom:hk-tile-card', entity: id };
          t = Object.assign({}, t, { secondary: entry.secondary });
          if (dom(id) === 'light') t.tap_action = { action: 'toggle' };
          // (Full: every glyph the tile's own size, bare -- as a Centred block's: hk-grid-entity-card)
          if (!half) { delete t.icon_size; delete t.bare_icon; delete t.well_background; }
          return t;
        });
        return { area: null, size: size, tiles: tiles, more: 0, name: cfg.title || 'Accessories', empty: 'Choose accessories in the editor',
                 head: false, cols: cols, rows: rows, half: half, centred: !half, color: !!cfg.color };
      }
      _render() {
        super._render();
        this._e.nm.disabled = true;
      }
    }
    watchSize(HkGridAccessoriesCard);
    C.register('hk-grid-accessories-card', HkGridAccessoriesCard, 'HK Accessory Group',
      'Your chosen accessories together in fixed rows.', [{ name: 'title', selector: { text: {} } },
      { name: 'accessories', selector: { object: {} } }], function () { return {}; });

    // ===================================================== the small tiles
    // THE S TILE: Lock Up, All Lights Off, Garage, a scene or script, and
    // Everything. A key with a state: the glyph in its well at the top, the
    // name and the state it changes at the bottom -- the tall tile's measured
    // pieces (42 px well, 15 / 600 on 16.5 px lines, the pill's padding).
    // AN APP ICON'S CORNER: iPadOS's 22.4 % of its side (hk-tabbar.js ICON_CORNER, the Pages screen's)
    var APP_CORNER = '22.4%';
    var KEY_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.k{box-sizing:border-box;height:100%;display:flex;flex-direction:column;justify-content:space-between;',
      // (a tile's padding -- and a Square screen's corner inset, as hk-tile.js has it: the shield's well was cut by
      // the 72 px corner, 2026-10-30)
      '  padding:calc(12.8px + var(--hk-in-t,0px)) calc(12.8px + var(--hk-in-r,0px)) calc(12.8px + var(--hk-in-b,0px)) calc(' + TILE.padL + 'px + var(--hk-in-l,0px));cursor:pointer;overflow:hidden;' + C.plate('tile') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
      '  transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease}',
      'hk-plate.k:active{transform:scale(0.97);filter:brightness(0.93)}',
      'hk-plate.k:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.well{width:42px;height:42px;border-radius:50%;background:' + v('key') + ';display:flex;',
      '  align-items:center;justify-content:center;flex:none}',
      '.icon{width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px;--mdc-icon-size:100%;display:flex;',
      '  color:' + v('glyph') + ';transition:color ' + C.DUR.fade + ' ease}',
      '.tx{display:flex;flex-direction:column;gap:' + TILE.rowGap + 'px;min-width:0}',
      '.name,.state{font-size:15px;line-height:' + TILE.lineH + 'px;letter-spacing:-0.23px;white-space:nowrap;',
      '  overflow:hidden;text-overflow:ellipsis}',
      '.name{font-weight:600;color:' + v('ink') + '}',
      '.state{font-weight:500;color:' + v('ink-2') + '}',
      '.state[data-kind="failed"]{color:' + v('fail') + '}',
      '@media (prefers-reduced-motion:reduce){hk-plate.k,hk-plate.k:active{transition:none;transform:none}}',
      // a block's corners on square cells (hk-home-grid-view's --hk-block-radius)
      'hk-plate.k{border-radius:var(--hk-block-radius, ' + C.M.radius + ')}',
      // CENTRED (2026-10-30, the Tile Style; hk-base.js TILE.centred): the
      // glyph over the name and what it changes, all centred, as HomeView has it
      ':host([tile=centred]) hk-plate.k{display:block}',
      C.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.k', lit: 'hk-plate.k.lit', well: '.well', icon: '.icon',
                      name: '.tx .name', sub: ['.tx .state'] }),
      // IN ITS OWN COLOR (2026-10-31, the widget mock-up; _look's `paint`): the
      // plate a gradient of the key's color -- the app icons' (hkCards.
      // iconGradient) -- its glyph and words white. Off a HomeView dashboard it
      // is Shortcuts' button: the glyph bare at the top, the name and its state
      // larger at the foot, on the block's inset
      'hk-plate.k[data-paint]{background:linear-gradient(180deg,var(--k-a),var(--k-b)) !important;--hk-glass-backdrop:none;-webkit-backdrop-filter:none;backdrop-filter:none}',
      'hk-plate.k[data-paint] .name{color:#fff !important}hk-plate.k[data-paint] .state{color:rgba(255,255,255,0.85) !important}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint]{padding:' + C.blockPad('14px') + '}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .well{width:34px;height:34px;background:none;border-radius:0}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .icon{width:34px;height:34px}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .name{' + type('headline') + ';line-height:21px}',
      ':host(:not([tile=centred])) hk-plate.k[data-paint] .state{' + type('caption') + ';line-height:17px}',
      // A FOLDER OF APP ICONS in the glyph's place (Everything, Small): four
      // of the screen's pages and rooms in their colors, on a frosted square
      '.well.folder{background:none !important;border-radius:0}',
      '.fold{box-sizing:border-box;width:100%;height:100%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:8%;padding:11%;',
      '  border-radius:' + APP_CORNER + ';background:rgba(255,255,255,0.22);box-shadow:0 4px 10px rgba(0,0,0,0.18)}',
      '.fold i{display:flex;align-items:center;justify-content:center;border-radius:' + APP_CORNER + ';min-width:0;min-height:0}',
      '.fold hk-icon{width:58%;height:58%;--mdc-icon-size:100%;display:flex;color:#fff}',
      ':host(:not([tile=centred])) .well.folder{width:46px;height:46px}'
    ].join('');

    class HkGridKey extends HkBase {
      static get CSS() { return KEY_CSS; }
      getCardSize() { return 2; }
      // {name, icon, state, color}
      _look() { return { name: '', icon: 'mdi:circle-outline', state: '', color: null }; }
      _tap() {}
      _render() {
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="k" data-hk-role="card" role="button" tabindex="0">' +
            '<div class="well"><hk-icon class="icon"></hk-icon></div>' +
            '<div class="tx"><div class="name"></div><div class="state"></div></div></hk-plate>';
          var q = this._root.querySelector.bind(this._root), self = this;
          this._e = { card: q('.k'), icon: q('.icon'), name: q('.name'), state: q('.state') };
          this._e.card.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
          this._e.card.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); self._tap(); }
          });
          this._built = true;
        }
        var e = this._e, k = this._look();
        if (e.icon.icon !== k.icon) e.icon.icon = k.icon;
        // its own color's gradient, or the glass
        var g = k.paint ? C.iconGradient(k.paint) : null;
        if (g) { e.card.setAttribute('data-paint', ''); e.card.style.setProperty('--k-a', g[0]); e.card.style.setProperty('--k-b', g[1]); }
        else if (e.card.hasAttribute('data-paint')) { e.card.removeAttribute('data-paint'); e.card.style.removeProperty('--k-a'); e.card.style.removeProperty('--k-b'); }
        // a folder of app icons in the glyph's place: [[color, glyph], ...]
        var fk = k.folder ? JSON.stringify(k.folder) : '';
        if (fk !== (this._foldKey || '')) {
          this._foldKey = fk;
          var well = e.icon.parentNode, old = well.querySelector('.fold');
          if (old) old.remove();
          well.classList.toggle('folder', !!k.folder);
          e.icon.style.display = k.folder ? 'none' : '';
          if (k.folder) {
            var f = document.createElement('span');
            f.className = 'fold';
            f.setAttribute('aria-hidden', 'true');
            k.folder.forEach(function (x) {
              var gi = C.iconGradient(x[0]), i = document.createElement('i'), ic = document.createElement('hk-icon');
              i.style.background = 'linear-gradient(180deg,' + gi[0] + ',' + gi[1] + ')';
              ic.icon = x[1];
              i.appendChild(ic); f.appendChild(i);
            });
            well.appendChild(f);
          }
        }
        // (Centred: the glyph by what is drawn, as the tiles' -- TILE.centred.ink)
        if (this.getAttribute('tile') === 'centred') e.icon.setAttribute('ink', String(C.TILE.centred.ink)); else e.icon.removeAttribute('ink');
        e.icon.style.color = g ? '#fff' : k.color || '';
        if (e.name.textContent !== k.name) e.name.textContent = k.name;
        var said = this._said || null;
        var text = said ? said.text : k.state;
        if (e.state.textContent !== text) e.state.textContent = text;
        if (said) e.state.setAttribute('data-kind', said.kind); else e.state.removeAttribute('data-kind');
        e.card.setAttribute('aria-label', k.name + (text ? ', ' + text : ''));
      }
      // a word in the state's place for a moment (a command that didn't go)
      _say(kind, text, ms) {
        var self = this;
        this._said = { kind: kind, text: text };
        if (this._sayT) clearTimeout(this._sayT);
        this._sayT = setTimeout(function () { self._sayT = null; self._said = null; self.redraw(); }, ms || 3000);
        this.redraw();
      }
      disconnectedCallback() {
        if (this._sayT) { clearTimeout(this._sayT); this._sayT = null; this._said = null; }
        super.disconnectedCallback();
      }
    }

    // ===================================================== hk-grid-security-card
    // SECURITY AS A WIDGET (2026-10-31, the widget mock-up): the one fact, big
    // -- the alarm's state in its color. Small: its shield, the state large
    // and the mode and the locks under it. Wide: that beside the locks, the
    // garage and the doors and windows, the open ones first and in orange.
    // Large: the shield and "Armed · Home" over that list, Home, Away and
    // Disarm at the foot. Extra Large (hk-grid-keypad-card): the alarm's
    // keypad beside the list. Every arming goes through the alarm's own sheet
    // or keypad: no command here can bypass its PIN. The list takes the room
    // it has, a row of 44 px each, and says "N more" for what does not fit.
    var SEC_ROW = 44;
    var SEC_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.sec{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + ';color:' + v('ink') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      'hk-plate.sec[size=W],hk-plate.sec.kp{flex-direction:row;gap:18px}',
      '[role=button]{cursor:pointer}',
      '[role=button]:focus-visible,button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      // the shield bare, in the state's color (gray disarmed), as the Small blocks beside it draw their glyphs
      // (the owner, 2026-10-31: "Yes, bare glyph" -- no circle, as HomeView's tiles): 34 px, the heading's 30
      '.wl{width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.wl hk-icon{width:100%;height:100%;--mdc-icon-size:100%;display:flex;color:var(--c,' + v('ink-2') + ')}',
      '.hd .wl{width:30px;height:30px}',
      '.one{display:flex;flex-direction:column;min-width:0;margin-top:auto}',
      // (the state a title's size, 22: at a figure's 30 "Disarmed" filled a Small block -- the owner, 2026-10-31: "really large")
      '.big{' + type('title') + ';font-weight:600;line-height:1.1;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t,' + v('ink') + ')}',
      '.sub{' + type('body') + ';font-weight:400;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // SMALL: the name and its line as the Small blocks beside it have them (the Action's: a headline over a
      // caption, on the block's inset) -- the owner, 2026-10-31: "different than All Lights Off and Lock Up"
      'hk-plate.sec[size=S] .big{' + type('headline') + ';line-height:21px;margin-top:0}',
      'hk-plate.sec[size=S] .sub{' + type('caption') + ';line-height:17px}',
      '.side{display:flex;flex-direction:column;flex:0 0 150px;min-width:0}',
      '.hd{display:flex;align-items:center;gap:12px;min-width:0;flex:none;min-height:44px}',
      '.hd .tx{display:flex;flex-direction:column;min-width:0}',
      '.hd b{' + type('title') + ';font-weight:600;line-height:27px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hd small{' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.col{display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;min-height:0}',
      '.rows{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden}',
      '.row{display:flex;align-items:center;gap:10px;height:' + SEC_ROW + 'px;flex:none;box-sizing:border-box;border-bottom:1px solid ' + v('line') + ';min-width:0}',
      '.row:last-child,.row.end{border-bottom:0}',
      '.row hk-icon{width:20px;height:20px;--mdc-icon-size:100%;display:flex;flex:none;color:' + v('ink-2') + '}',
      '.row span{' + type('body') + ';flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.row em{font-style:normal;' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;flex:none}',
      '.row.open hk-icon,.row.open em{color:' + v('warn') + '}',
      '.row.lk hk-icon{color:var(--lk)}',
      '.row.mo span{color:' + v('ink-2') + '}',
      // Home, Away and Disarm along the foot, where a thumb is: the mode it is in lit
      '.arm{display:flex;gap:8px;flex:none}',
      '.arm button{all:unset;box-sizing:border-box;flex:1;height:44px;border-radius:22px;text-align:center;background:' + v('key') + ';' + type('body') + ';font-weight:600;color:' + v('ink') + ';cursor:pointer}',
      '.arm button.on{background:#fff;color:#1c1c1e}',
      '.arm button:active{background:' + v('key-strong') + '}',
      // (Extra Large: the alarm's keypad, its keys sized to the block)
      '.kpad{flex:0 0 264px;min-width:0;min-height:0}.kpad.side{flex-basis:330px}.kpad > *{display:block;height:100%}'
    ].join('');
    var SEC_WORDS = { disarmed: ['Disarmed', ''], armed_home: ['Armed', 'Home'], armed_away: ['Armed', 'Away'], armed_night: ['Armed', 'Night'],
                      armed_vacation: ['Armed', 'Vacation'], armed_custom_bypass: ['Armed', 'Custom'], arming: ['Arming…', ''], pending: ['Pending…', ''],
                      disarming: ['Disarming…', ''], triggered: ['Triggered', ''] };
    // the alarm's state as the block says it: the word, its mode, the shield and its color
    function alarmLook(st) {
      var s = st && st.state, w = SEC_WORDS[s], A = C.ACCENTS;
      if (!w) return { word: s === 'unavailable' || s === 'unknown' || !st ? 'Unavailable' : String(s), mode: '', icon: 'mdi:shield-off', color: null };
      var armed = /^armed_/.test(s);
      return { word: w[0], mode: w[1], icon: s === 'disarmed' ? 'mdi:shield-off' : s === 'triggered' ? 'mdi:shield-alert' : s === 'armed_home' ? 'mdi:shield-home' : 'mdi:shield-lock',
               color: s === 'triggered' ? A.red : armed ? A.teal : /ing$|pending/.test(s) ? A.orange : null, text: s === 'triggered' ? A.red : null };
    }
    // ITS LIST: the locks, the garage, the doors and windows (the house's
    // lists, else what it has), each {id, name, icon, value, open, lock}; the
    // open ones first
    function secRows(client) {
      var st = (client && client.states) || {}, out = [];
      var locks = (kind('locks') || own(client, 'lock')).filter(function (id) { return dom(id) === 'lock' && st[id]; });
      locks.forEach(function (id) {
        var s = st[id].state, open = s === 'unlocked' || s === 'open';
        out.push({ id: id, name: friendly(client, id), icon: open ? 'mdi:lock-open-variant' : 'mdi:lock', value: open ? 'Unlocked' : OFF[s] ? 'Unknown' : 'Locked', open: open, lock: !open });
      });
      var garage = (kind('garage') || own(client, 'cover').filter(function (id) { return DOORS[attr(st[id], 'device_class')]; })).filter(function (id) { return st[id]; });
      garage.forEach(function (id) {
        var s = st[id].state, shut = s === 'closed' || s === 'off';
        out.push({ id: id, name: friendly(client, id), icon: shut ? 'mdi:garage' : 'mdi:garage-open', value: shut ? 'Closed' : OFF[s] ? 'Unknown' : 'Open', open: !shut && !OFF[s] });
      });
      ['doors', 'windows'].forEach(function (k) {
        var dc = k === 'doors' ? 'door' : 'window';
        (kind(k) || Object.keys(st).filter(function (id) { return dom(id) === 'binary_sensor' && attr(st[id], 'device_class') === dc; }).sort())
          .filter(function (id) { return st[id]; }).forEach(function (id) {
            var open = st[id].state === 'on';
            out.push({ id: id, name: friendly(client, id), icon: 'mdi:' + dc + (open ? (dc === 'door' ? '-open' : '-open-variant') : (dc === 'door' ? '-closed' : '-closed-variant')),
                       value: open ? 'Open' : 'Closed', open: open });
          });
      });
      return out.filter(function (r) { return r.open; }).concat(out.filter(function (r) { return !r.open; }));
    }
    // ...and what it says in a few words: "1 window open", else the locks
    function secSays(rows) {
      var open = rows.filter(function (r) { return r.open; });
      if (open.length) return open.length === 1 ? open[0].name + ' ' + open[0].value.toLowerCase() : open.length + ' open';
      return rows.some(function (r) { return r.lock; }) ? 'All locked' : rows.length ? 'All closed' : '';
    }

    class HkGridSecurityCard extends HkBase {
      static get CSS() { return SEC_CSS; }
      getCardSize() { return 2; }
      _alarm() {
        return this._config.entity || setting('security.alarm', null) ||
          Object.keys((this.client && this.client.states) || {}).filter(function (id) { return dom(id) === 'alarm_control_panel'; })[0] || null;
      }
      _size() { return sizeOf(this) || 'S'; }
      _keys() { return false; }
      _sigOf() {
        var id = this._alarm(), st = id && this.client && this.client.states[id];
        return JSON.stringify([id, st && st.state, secRows(this.client), this._size(), this._blockKey || '']);
      }
      _tap() { var id = this._alarm(); if (id) window.hkShell.moreInfo(id, this); }
      // (the plate's tap, hk-base.js openTarget: Small the whole block, Wide its state and Large its heading already
      // were the alarm's sheet; now anywhere between its rows, too -- not the keypad's keys and gaps, a PIN's)
      _tapTarget() { var id = this._alarm(); return id ? [{ sheet: id }] : []; }
      // (the keypad, Extra Large: each new client)
      _receiveClient() {
        super._receiveClient();
        var c = this.client;
        (this._kids || []).forEach(function (k) { window.hkHostClient.bridge(k, c); });
      }
      _button(el, fn) {
        el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
        el.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
        el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } });
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._fitRO && typeof ResizeObserver === 'function') {
          this._fitRO = new ResizeObserver(function () { self._fit(); });
          this._fitRO.observe(this);
        }
      }
      disconnectedCallback() {
        if (this._fitRO) { this._fitRO.disconnect(); this._fitRO = null; }
        super.disconnectedCallback();
      }
      _render() {
        this._watchBlock();
        var self = this, size = this._size(), keys = this._keys() && size === 'XL', alarm = this._alarm();
        // (a tile cell's shorter Extra Large: the keys side by side with the readout and the ways to arm, so
        // each key keeps 44 px -- stacked under the readout they came to 36)
        var bk = this._block(), side = keys && !!bk && bk.h < 340;
        var shape = size + (keys ? 'k' : '') + (side ? 's' : '') + '|' + alarm;
        if (!this._built || this._shape !== shape) {
          this._shape = shape;
          var head = '<div class="hd"><div class="wl"><hk-icon></hk-icon></div><div class="tx"><b></b><small></small></div></div>';
          var html = size === 'S' ? '<div class="wl"><hk-icon></hk-icon></div><div class="one"><div class="big"></div><div class="sub"></div></div>'
            : size === 'W' ? '<div class="side"><div class="wl"><hk-icon></hk-icon></div><div class="one"><div class="big"></div><div class="sub"></div></div></div><div class="rows"></div>'
            : keys ? '<div class="kpad" data-notap></div><div class="col">' + head + '<div class="rows"></div></div>'
            : head + '<div class="rows"></div><div class="arm"><button type="button" data-m="home">Home</button><button type="button" data-m="away">Away</button><button type="button" data-m="off">Disarm</button></div>';
          this._root.innerHTML = '<hk-plate class="sec' + (keys ? ' kp' : '') + '" data-hk-role="card" size="' + size + '">' + html + '</hk-plate>';
          var q = this._root.querySelector.bind(this._root), all = this._root.querySelectorAll.bind(this._root);
          this._e = { card: q('.sec'), wl: q('.wl'), icon: q('.wl hk-icon'), big: q('.big') || q('.hd b'), sub: q('.sub') || q('.hd small'), rows: q('.rows') };
          // the tap: Small the whole block, Wide its state, Large its heading -- the alarm's sheet, with its PIN
          var hit = size === 'S' ? this._e.card : size === 'W' ? q('.side') : q('.hd');
          this._button(hit, function () { if (self._config.tap !== 'none') self._tap(); });
          Array.prototype.forEach.call(all('.arm button'), function (b) {
            b.setAttribute('aria-label', b.textContent + ': the alarm’s controls');
            b.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
          });
          this._kids = [];
          if (keys) {
            this._pad = C.createCard(Object.assign({ type: 'custom:hk-alarm-keypad-card', glass: false }, side ? { layout: 'side' } : {}, alarm ? { entity: alarm } : {}), this.client);
            q('.kpad').classList.toggle('side', side);
            q('.kpad').appendChild(this._pad);
            this._kids.push(this._pad);
          } else this._pad = null;
          this._rowKey = null;
          this._built = true;
        }
        var e = this._e, st = alarm && this.client && this.client.states[alarm], look = alarmLook(st), rows = secRows(this.client), says = secSays(rows);
        if (e.icon.icon !== look.icon) e.icon.icon = look.icon;
        if (look.color) e.card.style.setProperty('--c', look.color); else e.card.style.removeProperty('--c');
        if (look.text) e.card.style.setProperty('--t', look.text); else e.card.style.removeProperty('--t');
        var big = size === 'S' || size === 'W' ? look.word : look.word + (look.mode ? ' · ' + look.mode : '');
        var sub = size === 'S' ? [look.mode, says && (/^All /.test(says) ? 'all ' + says.slice(4) : says)].filter(Boolean).join(' · ') : size === 'W' ? (look.mode || says) : says;
        if (size === 'S' && !look.mode) sub = says;
        e.big.textContent = big;
        e.sub.textContent = sub;
        var label = 'Security, ' + big + (sub ? ', ' + sub : '');
        (size === 'S' ? e.card : (e.card.querySelector('.side') || e.card.querySelector('.hd'))).setAttribute('aria-label', label);
        Array.prototype.forEach.call(this._root.querySelectorAll('.arm button'), function (b) {
          var m = b.getAttribute('data-m');
          b.classList.toggle('on', m === 'off' ? !!st && st.state === 'disarmed' : !!st && st.state === 'armed_' + m);
        });
        if (e.rows) {
          var key = JSON.stringify(rows);
          if (key !== this._rowKey) {
            this._rowKey = key;
            e.rows.innerHTML = '';
            rows.forEach(function (r) {
              var d = document.createElement('div');
              d.className = 'row' + (r.open ? ' open' : '') + (r.lock ? ' lk' : '');
              d.innerHTML = '<hk-icon></hk-icon><span></span><em></em>';
              d.querySelector('hk-icon').icon = r.icon;
              d.querySelector('span').textContent = r.name;
              d.querySelector('em').textContent = r.value;
              self._button(d, function () { window.hkShell.moreInfo(r.id, self); });
              d.setAttribute('aria-label', r.name + ', ' + r.value);
              e.rows.appendChild(d);
            });
            var more = document.createElement('div');
            more.className = 'row mo';
            more.innerHTML = '<hk-icon></hk-icon><span></span>';
            more.querySelector('hk-icon').icon = 'mdi:dots-horizontal';
            this._button(more, function () { self._tap(); });
            e.rows.appendChild(more);
            this._more = more;
          }
          e.card.style.setProperty('--lk', C.ACCENTS.teal);
        }
        if (this._pad) {
          // the keys and their gaps fill the block's height: the readout, four rows of keys, the ways to arm
          var h = bk ? bk.h - 36 : 369;
          this._pad.style.setProperty('--hk-kp-key', Math.max(36, Math.min(64, side ? Math.floor((h - 30) / 4) : Math.floor((h - 44 - 50) / 5))) + 'px');
        }
        this._fit();
      }
      // THE LIST IN THE ROOM IT HAS: whole rows; what does not fit, "N more"
      _fit() {
        var e = this._e;
        if (!e || !e.rows || !this._more) return;
        var list = Array.prototype.filter.call(e.rows.children, function (c) { return c !== this._more; }, this);
        var h = e.rows.clientHeight;
        if (!h) return;
        var fits = Math.max(0, Math.floor((h + 1) / SEC_ROW)), cut = list.length > fits, show = cut ? Math.max(0, fits - 1) : list.length;
        list.forEach(function (r, i) { r.style.display = i >= show ? 'none' : ''; r.classList.toggle('end', !cut && i === show - 1); });
        this._more.style.display = cut && fits > 0 ? '' : 'none';
        if (cut) {
          var t = (list.length - show) + ' more';
          this._more.querySelector('span').textContent = t;
          this._more.setAttribute('aria-label', t + ': the alarm’s sheet');
        }
      }
    }
    watchSize(HkGridSecurityCard);
    C.register('hk-grid-security-card', HkGridSecurityCard, 'HK Grid Security', 'The alarm’s state, its locks, doors and windows, and the alarm’s own controls with its PIN.', [{ name: 'entity', label: 'Alarm', selector: { entity: { filter: { domain: 'alarm_control_panel' } } } }], function () { return {}; });

    // ===================================================== the full-control blocks
    // (2026-10-24, the owner: "the detail sheets that are useful as blocks"):
    // a Large or Extra Large Vacuum block is its controls with Clean Areas --
    // the Vacuum page's own card in a block-sized plate. (Security's keypad,
    // Extra Large since 2026-10-31, is the Security block's: above.)
    var FULL_CSS = ':host{display:block;height:100%}' +
      'hk-plate.full{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + '}' +
      '.ttl{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:24px;flex:none;padding:0 4px}' +
      '.ttl b{' + type('headline') + ';color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.body{flex:1;min-height:0;position:relative}.body > *{display:block;height:100%}' +
      '.areas{flex:1;min-height:0}';                // (Clean Areas scrolls its rooms in its own plate)
    class HkGridFull extends HkBase {
      static get CSS() { return FULL_CSS; }
      getCardSize() { return 4; }
      _receiveClient() {
        super._receiveClient();
        var c = this.client;
        (this._kids || []).forEach(function (k) { window.hkHostClient.bridge(k, c); });
      }
      _mount(parent, cfg, size) {
        // (the block's When Tapped goes with it: a dial inside the climate panel answers the same)
        if (this._config && this._config.tap) cfg = Object.assign({}, cfg, { tap: this._config.tap });
        var el = C.createCard(cfg, this.client);
        if (size) el.setAttribute('size', size);
        parent.appendChild(el);
        (this._kids = this._kids || []).push(el);
        return el;
      }
    }
    // THE KEYPAD (the catalog's Large and Extra Large Security): Large is the
    // Security block's own (the list, Home, Away and Disarm); Extra Large
    // keeps the alarm's keypad beside the list (the owner, 2026-10-31) -- its
    // own keys, readout and ways to arm (hk-security.js); the PIN is checked
    // as it always is, by the alarm, never here
    class HkGridKeypadCard extends HkGridSecurityCard {
      _keys() { return true; }
    }
    watchSize(HkGridKeypadCard);
    C.register('hk-grid-keypad-card', HkGridKeypadCard, 'HK Grid Keypad', 'The alarm keypad beside its locks, doors and windows, sized to a Home Grid block.',
      [{ name: 'entity', label: 'Alarm', selector: { entity: { filter: { domain: 'alarm_control_panel' } } } }], function () { return {}; });
    // THE VACUUM: the vacuum card's own block at Large and Extra Large (2026-10-31,
    // the owner: "rooms as tiles to tick, 'Clean 2 rooms'"): its state, the
    // rooms Clean Areas offers when the home has them (as the Vacuums page
    // does: hk-strategy.js), and big Clean and Dock keys -- hk-vacuum-card
    // draws it, by the size it is given (hk-home.js _renderBlock)
    class HkGridVacuumFull extends HkGridFull {
      _sigOf() { return JSON.stringify([this._config.entity || null, sizeOf(this)]); }
      _render() {
        var key = JSON.stringify([this._config.entity, sizeOf(this)]);
        if (this._built && this._key === key) return;
        this._key = key; this._kids = [];
        // (the whole block's height: the card fills it)
        this._root.innerHTML = '<div class="body" style="height:100%"></div>';
        this._mount(this._root.querySelector('.body'), { type: 'custom:hk-vacuum-card', entity: this._config.entity }, sizeOf(this) || 'L');
        this._built = true;
      }
    }
    watchSize(HkGridVacuumFull);
    C.register('hk-grid-vacuum-card', HkGridVacuumFull, 'HK Grid Vacuum', 'A vacuum\u2019s controls with Clean Areas, sized to a Home Grid block.',
      [{ name: 'entity', label: 'Vacuum', selector: { entity: { filter: { domain: 'vacuum' } } } }], function () { return {}; });

    // THE PAGES' OWN PANELS AS BLOCKS (2026-10-24, the owner: "let's do them
    // all"): what the Power, Music, Security, Climate, Live TV and Water pages
    // show at their top, read live from the house's settings as those pages
    // read them, so a block follows a change without the screen being built
    // again. `panel`:
    //   power     (2026-10-31) the power now and the day's chart, Activity's
    //             numbers on the block's own plate (_ownPower)
    //   music     the speaker picker: speakers, presets and playlists
    //   doors     the house with its ways in: locks, doors, windows, garage
    //             (S, W, T: how many are open and the list, _ownDoors)
    //   climate   a thermostat's full controls (its sheet)
    //   tv        Live TV's channels; a tap plays one full screen
    //   water     (2026-10-31) today's water and the day's bars, the days
    //             before beside them (_ownWater)
    // Nothing set up for it: the block says where to set it up.
    var PANEL_EMPTY = {
      power: ['Power', 'Add Energy with a power plan in Settings to show power here.'],
      music: ['Music', 'Set up Music in Settings to choose speakers and playlists here.'],
      doors: ['Doors & Locks', 'No locks, doors or windows yet.'],
      climate: ['Thermostat', 'No thermostat yet.'],
      tv: ['Live TV', 'Add channels in Settings → Live TV to show them here.'],
      water: ['Water', 'Name a water meter in Settings → Pages → Water to show it here.']
    };
    function hidesOf() {
      var G = setting('generated', null) || {}, out = {};
      ['exclude_entities', 'exclude_devices', 'exclude_areas', 'include_entities'].forEach(function (k) { if (Array.isArray(G[k])) out[k] = G[k]; });
      return out;
    }
    function firstOfDomain(client, d) {
      return Object.keys((client && client.states) || {}).filter(function (id) { return dom(id) === d; }).sort()[0] || null;
    }
    // what a panel block mounts: [{cfg, cls}] (each in a part of its own), or null
    function panelParts(kind, size, cfg, client) {
      if (kind === 'power') {
        var added = setting('added', []) || [], E = added.indexOf('energy') >= 0 ? setting('energy', null) : null, W = E && E.power;
        if (!W || typeof W !== 'object') return null;
        var B = W.battery || {};
        // EVERY SIZE AS ACTIVITY'S NUMBERS (2026-10-31, the owner's widget
        // mock-up; the status in sentences at Wide and the house picture at
        // Large were the Power page's own, and drew no plate of their own on
        // a block): a green Using Now, the power now large, and a chart along
        // the foot -- Small the last three hours, the rest the day; Large
        // the sun and the battery under the figure; Extra Large today's top
        // users beside it. Drawn here (`own`); the Power page keeps its cards.
        return [{ own: 'power', home: W.home || null, solar: W.solar || null, level: B.level || null }];
      }
      if (kind === 'music') {
        // (2026-10-31, Music's widget: what played last and covers to play
        // again, at the block's size -- hk-media.js hk-recent-music-card)
        var M = window.hkMusic, sp = M && M.speakers ? M.speakers() : [];
        return sp && sp.length ? [{ cfg: Object.assign({ type: 'custom:hk-recent-music-card' }, cfg.show ? { show: cfg.show } : {}, cfg.playlist ? { playlist: cfg.playlist } : {}, cfg.speaker ? { speaker: cfg.speaker } : {}), size: size }] : null;
      }
      if (kind === 'doors') {
        var S = window.hkStrategy, inv = null;
        try { inv = S && S.inventory ? S.inventory(client, hidesOf()) : null; } catch (e) { inv = null; }
        if (!inv || !(inv.locks.length + inv.doors.length + inv.windows.length + inv.garage.length)) return null;
        // EVERY SIZE (2026-10-31, the widget mock-up): how many are open, large;
        // Wide the count beside the list, Tall and Large the list under it,
        // Extra Large beside it -- the doors, the garage and the windows, the
        // open ones first (the locks are Security's). The house picture with
        // Recent Activity stays the Doors & Locks page's.
        if (inv.doors.length + inv.windows.length + inv.garage.length) {
          return [{ own: 'doors', doors: inv.doors, windows: inv.windows, garage: inv.garage }];
        }
        // (a house of locks alone: their overview, as before)
        var alarm = setting('security.alarm', null) || firstOfDomain(client, 'alarm_control_panel');
        return [{ cfg: { type: 'custom:hk-security-overview-card', alarm: alarm, locks: inv.locks, doors: inv.doors, windows: inv.windows,
          garage: inv.garage, leaks: inv.leaks || [], height: '100%' } }];
      }
      if (kind === 'climate') {
        var id = cfg.entity || firstOfDomain(client, 'climate');
        // the dial alone (its Tall layout: the ring as large as the column),
        // then its readings, modes and fan in the two columns beside it
        return id ? [{ cfg: { type: 'custom:hk-control-card', entity: id }, size: 'T' }, { readings: id, cls: 'wide' }] : null;
      }
      if (kind === 'tv') {
        // (2026-10-31: its first channels, a tile each in its color with what
        // is on; a tap plays one full screen -- hk-media.js hk-tv-channels-card)
        return (setting('added', []) || []).indexOf('live_tv') >= 0 ? [{ cfg: Object.assign({ type: 'custom:hk-tv-channels-card' }, cfg.channel ? { channel: cfg.channel } : {}), size: size }] : null;
      }
      if (kind === 'water') {
        var hw = (setting('headers', null) || {}).water || {};
        // EVERY SIZE AS THE WIDGET MOCK-UP (2026-10-31): today large and the
        // day's bars, drawn here -- Tall with the days before under them,
        // Large and Extra Large with what the leak sensors say, Extra Large
        // with the days before beside it. (The Water page keeps its day and
        // its main supply; the block was the page's small chart in a big
        // empty plate.)
        var lk = null;
        try { lk = window.hkStrategy && window.hkStrategy.inventory ? window.hkStrategy.inventory(client, hidesOf()).leaks : null; } catch (e) { lk = null; }
        return [{ own: 'water', meter: hw.meter || null, leaks: lk || [] }];
      }
      return null;
    }
    // (side by side: a thermostat's dial and its controls, two columns'
    // worth; an XL water block's day and supply, half each)
    var PANEL_CSS = '.parts{display:flex;flex-direction:column;gap:10px;height:100%}' +
      '.parts.row{flex-direction:row}.parts.row .part{flex:1 1 0;min-width:0}.parts.row .part.wide{flex:2 1 0}' +
      // (each part a size container of its own: a card inside sizes itself to its part, not the whole block -- the
      // Thermostat XL's dial was sized to the block and ran out of its column, 2026-10-30)
      '.part{flex:1;min-height:0;position:relative;container-type:size}.part > *{display:block;height:100%;--hk-sec-min:0px}' +
      // FIT: the card at its own height, scaled down to the part (_fit)
      '.part.fit{overflow:hidden}.part.fit > *{height:auto;transform-origin:50% 0}' +
      '.rd{' + C.plate('card') + ';box-sizing:border-box;height:100%;padding:' + C.blockPad(C.CARD.pad) + ';display:flex;flex-direction:column;gap:12px;justify-content:space-between}' +
      '.rd .now{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}' +
      '.rd .now div{display:flex;flex-direction:column;gap:2px;min-width:0}' +
      '.rd .k{' + type('caption') + ';color:' + v('ink-2') + '}' +
      '.rd .v{' + type('title') + ';font-variant-numeric:tabular-nums}' +
      // (the readings grow with their plate -- the Thermostat XL's left a band of nothing under them, 2026-10-30)
      '.rd .v{font-size:clamp(22px, 12cqh, 40px);line-height:1.1}' +
      '.rd .row{display:flex;flex-direction:column;gap:6px}' +
      C.segCss('.rd .seg', { on: '[aria-pressed="true"]', fill: true }) +
      // (each mode a finger's 44 px tall: the segments' own 36 were under it, 2026-10-31)
      '.rd .seg button{flex:1 1 0;min-height:44px}' +
      '.part.plated{' + C.plate('card') + ';box-sizing:border-box;padding:' + C.blockPad('14px') + ';overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}' +
      '.part.plated::-webkit-scrollbar{display:none}.part.plated > *{height:auto;min-height:100%}' +
      '.empty{' + type('body') + ';color:' + v('ink-2') + ';padding:0 4px}';
    // THE BLOCKS AS WIDGETS (2026-10-31, the owner's mock-up, "Home Grid
    // blocks, widget style"): what a block is in its color, the one figure
    // large and light, a line under it, then a short chart or a list along
    // the foot. A panel's own part (`own`: Power S, Water and Doors S to T)
    // and On Now draw with these.
    var ACC = C.ACCENTS;
    var WG_CSS = 'hk-plate.wg{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;' +
        'padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';color:' + v('ink') + '}' +
      '.wl{font-size:15px;font-weight:600;line-height:19px;letter-spacing:0.2px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}' +
      '.wb{font-size:44px;font-weight:300;letter-spacing:-0.9px;line-height:1.04;font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:2px;flex:none}' +
      '.wb.m{font-size:30px;font-weight:500;letter-spacing:-0.5px}' +
      '.ws{' + type('body') + ';line-height:19px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}' +
      '.wf{margin-top:auto}.wcol{display:flex;flex-direction:column;min-width:0}' +
      '.wc{display:block;flex:none}' +
      // THE COUNT, as large as a block's figure gets (the clock's 72); a
      // tile cell (150 tall) the hero's 44, so the words under it keep their room
      '.wb.xl{font-size:72px;letter-spacing:-1.5px}' +
      '@container hk-cell (max-height:179px){.wb.xl{font-size:44px;letter-spacing:-0.9px}}' +
      // A LIST: rows of 36, the open (or the on) ones in their color; what
      // does not fit is "N more" in the last row's place
      '.wr{display:flex;flex-direction:column;min-width:0;min-height:0}' +
      '.wr>div{display:flex;align-items:center;gap:10px;height:36px;flex:none;border-bottom:1px solid ' + v('line') + ';cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.wr>div:last-child{border-bottom:0}' +
      // (Large and up: 44 px rows, a tap target each, the name over since when)
      '.wr.tall>div{height:44px}.wr .wt{display:flex;flex-direction:column;flex:1;min-width:0}.wr .wt b{flex:none}' +
      '.wr .wt small{' + type('caption') + ';line-height:15px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.wr b{' + type('body') + ';font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.wr em{font-style:normal;' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap}' +
      '.wr>div.more{cursor:default}.wr>div.more b{font-weight:500;color:' + v('ink-2') + '}' +
      '.wg hk-icon{display:block;flex:none;--mdc-icon-size:100%}' +
      '.wsplit{display:flex;gap:18px;flex:1;min-height:0}.wsplit>:last-child{flex:1}' +
      '.waxis{display:flex;justify-content:space-between;margin-top:6px;flex:none;' + type('micro') + ';color:' + v('ink-3') + '}';
    // a glyph from the MDI subset (web/mdi), in a color
    function gly(icon, px, col) {
      return '<hk-icon icon="' + icon + '" style="width:' + px + 'px;height:' + px + 'px' + (col ? ';color:' + col : '') + '"></hk-icon>';
    }
    // the block in px inside its inset: the view's measure, else a square cell's
    var SQ_BLOCK = { S: [196, 196], W: [405, 196], T: [196, 405], L: [405, 405], XL: [614, 405] };
    function inner(card, size) {
      if (card._watchBlock) card._watchBlock();
      var b = card._block ? card._block() : null, d = SQ_BLOCK[size] || SQ_BLOCK.S, pad = 18;
      try { pad = parseFloat(getComputedStyle(card).getPropertyValue('--hk-block-pad')) || 18; } catch (e) { pad = 18; }
      return { iw: (b ? b.w : d[0]) - 2 * pad, ih: (b ? b.h : d[1]) - 2 * pad };
    }
    // HOW MANY ROWS OF 36 FIT in `room` px -- and when not all do, the last
    // of them says how many more
    function fitRows(items, room, row, each) {
      var n = Math.max(1, Math.floor(room / (each || 36)));
      if (items.length <= n) return items.map(row).join('');
      return items.slice(0, n - 1).map(row).join('') + '<div class="more"><b>' + (items.length - n + 1) + ' more</b></div>';
    }
    // SHORT BARS, each in its color: [{v, c}] scaled to the largest, `w` x
    // `h` px -- an SVG, as HK's bars are drawn (hk-energy.js barChart), 3 px
    // apart with their tops rounded
    function wbars(list, w, h) {
      var mx = 0, n = list.length, gap = 3, bw = Math.max(1, (w - (n - 1) * gap) / n), rx = Math.min(3, bw / 2);
      list.forEach(function (x) { if (typeof x.v === 'number' && x.v > mx) mx = x.v; });
      return '<svg class="wc" width="' + Math.round(w) + '" height="' + Math.round(h) + '" viewBox="0 0 ' + w.toFixed(1) + ' ' + h + '" aria-hidden="true">' + list.map(function (x, i) {
        var bh = Math.max(3, (mx > 0 && typeof x.v === 'number' ? Math.max(0.06, x.v / mx) : 0.06) * h);
        return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="' + rx.toFixed(1) + '" fill="' + x.c + '"' +
          // (`ghost`: a slot still to come, drawn from the day before -- half the ink)
          (x.ghost ? ' fill-opacity=".5"' : '') + '/>';
      }).join('') + '</svg>';
    }
    // a short chart's height: 40, or 28 on a tile cell (its figure keeps its room)
    function shortH(box) { return box.ih < 140 ? 28 : 40; }
    // a power sensor's watts, read with its unit (hkChart.power; a W or kW sensor)
    function wattsOf(client, id) {
      var s = id && client && client.states[id];
      if (!s) return null;
      if (window.hkChart && window.hkChart.power) return window.hkChart.power(client.states, id, { watts: true, fallback: null });
      var n = Number(s.state);
      return isFinite(n) ? (/^kW$/i.test(attr(s, 'unit_of_measurement') || '') ? n * 1000 : n) : null;
    }
    function numTag() { return window.hkLocale && window.hkLocale.numTag ? window.hkLocale.numTag() : undefined; }
    function amount(x) { return x < 10 ? (Math.round(x * 10) / 10).toLocaleString(numTag()) : Math.round(x).toLocaleString(numTag()); }
    // THE WATER METER: Settings -> Pages -> Water's, else the Energy
    // settings' water sources (energy/get_prefs, asked once for the page)
    var WATER_SRC = { ids: null, wait: null };
    function waterIds(card, client, meter) {
      if (meter) return [meter];
      if (WATER_SRC.ids) return WATER_SRC.ids;
      if (!WATER_SRC.wait && client && client.callWS) {
        WATER_SRC.wait = client.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
          WATER_SRC.ids = ((pr && pr.energy_sources) || []).filter(function (s) { return s.type === 'water' && s.stat_energy_from; })
            .map(function (s) { return s.stat_energy_from; });
        }, function () { WATER_SRC.ids = []; }).then(function () { WATER_SRC.wait = null; card.redraw(); });
      }
      return null;
    }
    // TODAY'S WATER, as the Water page sums it (hk-headers.js water day):
    // each hour since midnight from the recorder's statistics, this hour
    // from its five-minute ones; the hours still to come yesterday's, in
    // gray; the days before, newest first; and today against a usual day by
    // now (the week before's mean, on yesterday's own shape)
    function waterDay(card, client, ids) {
      var S = window.hkStats;
      if (!S || !ids.length) return null;
      var hr = S.hourly(client, ids, 48, card), fm = S.fiveMinute(client, ids, 13, card, { type: 'change' }), dd = S.daily(client, ids, 8, card);
      if (!hr || !dd) return null;
      var sumAt = function (ser, i) {
        var got = false, t = 0;
        ids.forEach(function (id) { var r = ser[id] && ser[id][i]; if (r && r.v != null) { got = true; t += r.v; } });
        return got ? t : null;
      };
      var first = hr[ids[0]] || [], n = first.length, start = -1;
      for (var i = n - 1; i >= 0; i--) if (S.fields(first[i].t).hour === 0) { start = i; break; }
      if (start < 0) start = Math.max(0, n - 24);
      var seq = first.map(function (r, k) { return sumAt(hr, k); });
      var hourStart = n ? +first[n - 1].t : Date.now(), part = null;
      if (fm) (fm[ids[0]] || []).forEach(function (r, k) { if (+r.t >= hourStart) { var x = sumAt(fm, k); if (x != null) part = (part || 0) + x; } });
      seq[n - 1] = part;
      var today = seq.slice(start), yday = seq.slice(Math.max(0, start - 24), start), nowK = today.length - 1;
      var tot = today.reduce(function (a, x) { return a + (x || 0); }, 0);
      var day24 = [];
      for (var k = 0; k < 24; k++) day24.push(k <= nowK ? { v: today[k], fut: false } : { v: yday[k], fut: true });
      // a usual day by now: the seven days before today, on yesterday's shape
      var days = (dd[ids[0]] || []).map(function (r, k) { return { t: r.t, v: sumAt(dd, k) }; });
      var before = days.slice(0, -1).filter(function (x) { return x.v != null; });
      var usual = before.length ? before.reduce(function (a, x) { return a + x.v; }, 0) / before.length : 0;
      var yAll = yday.reduce(function (a, x) { return a + (x || 0); }, 0), frac = Math.min(1, (Date.now() - hourStart) / 36e5);
      var share = Math.min(1, Math.max(0, (Date.now() - (n ? +first[start].t : Date.now())) / 864e5));
      if (yAll > 0.5 && yday.length === 24) {
        share = (yday.slice(0, nowK).reduce(function (a, x) { return a + (x || 0); }, 0) + (yday[nowK] || 0) * frac) / yAll;
      }
      var byNow = usual * share, pct = byNow > 0.5 ? Math.round(100 * (tot - byNow) / byNow) : null;
      var st0 = client.states[ids[0]];
      return { tot: tot, unit: attr(st0, 'unit_of_measurement') || '', seq: seq, day24: day24,
               week: days.slice(0, -1).reverse(), day0: days.length ? days[days.length - 1].t : new Date(), more: /:/.test(ids[0]) ? null : ids[0],
               cmp: pct == null ? '' : Math.abs(pct) < 15 ? 'About usual' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below') + ' usual' };
    }
    // a door, a window or the garage: open, and its glyph
    function opened(st) { return !!st && (st.state === 'on' || st.state === 'open' || st.state === 'opening' || st.state === 'closing'); }
    var WAY_GLYPH = { door: ['mdi:door-open', 'mdi:door-closed'], window: ['mdi:window-open', 'mdi:window-closed'], garage: ['mdi:garage-open', 'mdi:garage'] };
    class HkGridPanelCard extends HkGridFull {
      static get CSS() { return FULL_CSS + PANEL_CSS + WG_CSS; }
      // THE PLATE'S TAP (hk-base.js openTarget; 2026-10-31, the owner on 0.1.94): the page the panel is a part of --
      // the figure and the rows in it keep their own sheets (data-more) -- or, on a screen without that page, the
      // reading's own sheet
      _tapTarget() {
        var c = this._config || {}, kind = c.panel, parts = this._parts(), p0 = (parts && parts[0]) || {};
        if (kind === 'power') return [{ page: 'power' }, { page: 'energy' }, p0.home && { sheet: p0.home }];
        if (kind === 'water') return [{ page: 'water' }, p0.meter && { sheet: p0.meter }];
        if (kind === 'doors') return [{ page: 'doors-windows' }];
        if (kind === 'music') return [{ page: 'music-browse' }, { page: 'playmusic' }];
        if (kind === 'tv') return [{ page: 'live-tv' }];
        if (kind === 'climate') { var id = c.entity || firstOfDomain(this.client || { states: {} }, 'climate'); return [id && { sheet: id }, { page: 'climate' }]; }
        return [];
      }
      _parts() {
        var c = this._config || {};
        try { return panelParts(c.panel, sizeOf(this), c, this.client || { states: {} }); } catch (e) { return null; }
      }
      _sigOf() {
        var parts = this._parts(), h = this.client, rd = parts && parts[1] && parts[1].readings, st = rd && h ? h.states[rd] : null;
        // (a part of its own: the states it reads, and the block's size)
        var own = parts && parts[0] && parts[0].own ? this._ownIds(parts[0]).map(function (id) { var s = h && h.states[id]; return s ? s.last_updated : null; }) : null;
        return JSON.stringify([parts, sizeOf(this), st ? st.last_updated : null, own, own ? this._blockKey || '' : null]);
      }
      _render() {
        var parts = this._parts(), key = JSON.stringify(parts);
        if (this._built && this._key === key) { this._readings(); this._drawOwn(); return; }
        this._key = key; this._kids = []; this._built = true; this._own = null;
        if (!parts) {
          var e = PANEL_EMPTY[this._config.panel] || ['', ''];
          this._root.innerHTML = '<hk-plate class="full" data-hk-role="card"><div class="ttl"><b></b></div><div class="empty"></div></hk-plate>';
          this._root.querySelector('b').textContent = e[0];
          this._root.querySelector('.empty').textContent = e[1];
          return;
        }
        this._root.innerHTML = '<div class="parts' + (parts.length > 1 ? ' row' : '') + '"></div>';
        var box = this._root.querySelector('.parts'), self = this;
        this._rd = null; this._rdHtml = null;
        parts.forEach(function (p) {
          var part = document.createElement('div');
          part.className = 'part' + (p.cls ? ' ' + p.cls : '');
          box.appendChild(part);
          if (p.readings) { self._rd = part; return; }
          if (p.own) {
            part.innerHTML = '<hk-plate class="wg" data-hk-role="card"></hk-plate>';
            self._own = { spec: p, plate: part.querySelector('hk-plate'), html: null };
            self._own.plate.addEventListener('click', function (e) {
              var row = e.target.closest && e.target.closest('[data-more]');
              if (row) { e.stopPropagation(); window.hkShell.moreInfo(row.getAttribute('data-more'), self); }
            });
            return;
          }
          var kid = self._mount(part, p.cfg, p.size);
          if (/\bfit\b/.test(p.cls || '')) self._fitWatch(part, kid, /\bfitw\b/.test(p.cls));
        });
        this._readings();
        this._drawOwn();
      }
      // A PART OF ITS OWN (the widget sizes): the entities it reads
      _ownIds(p) {
        if (p.own === 'power') return [p.home, p.solar, p.level].filter(Boolean);
        if (p.own === 'doors') return [].concat(p.doors, p.garage, p.windows);
        if (p.own === 'water') return (p.meter ? [p.meter] : WATER_SRC.ids || []).slice(0, 1).concat(p.leaks || []);
        return [];
      }
      _drawOwn() {
        var o = this._own;
        if (!o) return;
        var p = o.spec, size = sizeOf(this) || 'S', box = inner(this, size), h = this.client || { states: {} };
        var html = p.own === 'power' ? this._ownPower(p, size, box, h) : p.own === 'doors' ? this._ownDoors(p, size, box, h) : this._ownWater(p, size, box, h);
        if (html === o.html) return;
        o.html = html;
        C.morph(o.plate, html);
      }
      // POWER: what the house uses now, large. Small the last three hours in
      // fifteen-minute bars (the recorder's five-minute means, three to a
      // bar); Wide, Large and Extra Large the day by the hour (each hour's
      // mean since midnight, the hour we are in the reading now, the hours
      // still to come yesterday's in gray). Large adds the sun and the
      // battery under the figure, and the hours under the chart; Extra Large
      // today's top users beside it.
      _ownPower(p, size, box, h) {
        var w = wattsOf(h, p.home), S = window.hkStats;
        var kw = function (x) { return x == null ? ['—', ''] : Math.abs(x) >= 1000 ? [(x / 1000).toLocaleString(numTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }), 'kW'] : [Math.round(x).toLocaleString(numTag()), 'W']; };
        var fig = kw(w), more = p.home ? ' data-more="' + esc(p.home) + '"' : '';
        var lab = '<div class="wl" style="color:' + ACC.green + '">Using Now</div>';
        if (size === 'S') {
          var five = S && p.home ? S.fiveMinute(h, [p.home], 37, this) : null;
          var rows = (five && five[p.home]) || [], closed = rows.slice(-37, -1), bars = [];
          for (var k = 0; k < 12; k++) {
            var g = closed.slice(k * 3, k * 3 + 3).map(function (r) { return r.v; }).filter(function (x) { return typeof x === 'number'; });
            bars.push({ v: g.length ? g.reduce(function (a, x) { return a + x; }, 0) / g.length : null, c: ACC.green });
          }
          return lab + '<div class="wb"' + more + '>' + fig[0] + '</div>' +
            '<div class="ws">' + fig[1] + '</div><div class="wf" role="img" aria-label="The last three hours">' + wbars(bars, box.iw, shortH(box)) + '</div>';
        }
        var hr = S && p.home ? S.hourly(h, [p.home], 48, this, { type: 'mean' }) : null, ser = (hr && hr[p.home]) || [], day = [];
        if (ser.length) {
          var start = -1;
          for (var i = ser.length - 1; i >= 0; i--) if (S.fields(ser[i].t).hour === 0) { start = i; break; }
          if (start < 0) start = Math.max(0, ser.length - 24);
          for (var j = 0; j < 24; j++) {
            var at = start + j, y = start - 24 + j;
            if (at < ser.length) day.push({ v: at === ser.length - 1 && w != null ? w : ser[at].v, c: ACC.green });
            else day.push({ v: y >= 0 && ser[y] ? ser[y].v : null, c: v('ink-3'), ghost: true });
          }
        }
        while (day.length < 24) day.push({ v: null, c: v('ink-3'), ghost: true });
        var big = '<div class="wb"' + more + '>' + esc(fig.join(' ').trim()) + '</div>';
        var chart = function (cw, ch) { return '<div class="wf" role="img" aria-label="Today, hour by hour">' + wbars(day, cw, ch) + '</div>'; };
        var axis = '<div class="waxis"><span>12 AM</span><span>6</span><span>12 PM</span><span>6</span></div>';
        if (size === 'W') return lab + big + chart(box.iw, Math.max(30, box.ih - 19 - 46 - 10));
        // the sun now and the battery's level, where the house has them
        var sun = p.solar ? wattsOf(h, p.solar) : null, lv = p.level && h.states[p.level] ? Number(h.states[p.level].state) : NaN;
        var line = [sun != null ? 'Solar ' + kw(sun).join(' ') : '', isFinite(lv) ? 'Battery ' + Math.round(lv) + '%' : ''].filter(Boolean).join(' · ');
        var sub = line ? '<div class="ws">' + esc(line) + '</div>' : '';
        var chH = Math.max(40, box.ih - 19 - 46 - (line ? 19 : 0) - 12 - 19);
        if (size === 'L') return lab + big + sub + chart(box.iw, chH) + axis;
        // XL: the chart on the left; today's top users on the right -- the
        // whole house, then the Energy page's devices by what they used today
        var lw = Math.round((box.iw - 22) * 0.58), users = this._topUsers(h);
        var room = Math.max(1, Math.floor((box.ih - 19 - 6) / 36));
        return '<div class="wsplit" style="gap:22px"><div class="wcol" style="flex:0 0 ' + lw + 'px">' + lab + big + sub + chart(lw, chH) + axis + '</div>' +
          '<div class="wcol"><div class="wl" style="color:' + v('ink-2') + '">Today</div><div class="wr" style="margin-top:6px">' +
          users.slice(0, room).map(function (u) {
            return '<div' + (u.more ? ' data-more="' + esc(u.more) + '"' : ' style="cursor:default"') + '>' + gly(u.icon, 20, null) + '<b>' + esc(u.name) + '</b><em>' + u.v + '</em></div>';
          }).join('') + '</div></div></div>';
      }
      // TODAY'S TOP USERS (Extra Large): the house so far today (the Energy
      // page's own sum, hkEnergy.summary), then each device the Energy page
      // counts, by its kWh today -- both null until their statistics land
      _topUsers(h) {
        var E = window.hkEnergy, EP = window.hkEnergyPage, out = [], self = this;
        // (the Energy page's file, asked for by name where no card of it is on the screen, as the
        // screensaver's energy asks: hk-loader.js hkNeed.file)
        if (!E && window.hkNeed && window.hkNeed.file && !this._askedEnergy) {
          this._askedEnergy = true;
          window.hkNeed.file('hk-energy.js').then(function () { self.redraw(); });
        }
        var kwh = function (x) { return x == null ? '—' : (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toLocaleString(numTag(), { minimumFractionDigits: x >= 100 ? 0 : 1 }) + ' kWh'; };
        var s = null;
        try { s = E && E.summary ? E.summary(h, this) : null; } catch (e) { s = null; }
        out.push({ name: 'House', icon: 'mdi:home', v: kwh(s ? s.today.energy : null), more: null });
        var M = EP && EP.getModel ? EP.getModel(h, this) : null;
        (M ? M.devs : []).filter(function (d) { return d.counted && d.stat; }).map(function (d) {
          return { d: d, v: EP.todayOf ? EP.todayOf(h, self, d.stat) : null };
        }).filter(function (r) { return r.v != null && r.v > 0.05; }).sort(function (a, b) { return b.v - a.v; }).forEach(function (r) {
          out.push({ name: r.d.name, icon: r.d.icon || 'mdi:power-plug', v: kwh(r.v), more: r.d.power || r.d.stat });
        });
        return out;
      }
      // DOORS AND WINDOWS: how many are open, large; Wide the count beside
      // the list, Tall over it -- the open ones first, in orange
      _ownDoors(p, size, box, h) {
        var list = [];
        [['door', p.doors], ['garage', p.garage], ['window', p.windows]].forEach(function (x) {
          (x[1] || []).forEach(function (id) { var st = h.states[id]; if (st) list.push({ id: id, kind: x[0], st: st, open: opened(st) }); });
        });
        list.sort(function (a, b) { return (b.open ? 1 : 0) - (a.open ? 1 : 0); });
        var open = list.filter(function (x) { return x.open; }), name = function (x) { return (C.accName && C.accName(x.id)) || attr(x.st, 'friendly_name') || x.id; };
        var row = function (x) {
          var g = WAY_GLYPH[x.kind][x.open ? 0 : 1];
          return '<div data-more="' + esc(x.id) + '">' + gly(g, 20, x.open ? ACC.orange : null) + '<b>' + esc(name(x)) + '</b><em' +
            (x.open ? ' style="color:' + ACC.orange + '"' : '') + '>' + (x.open ? 'Open' : 'Closed') + '</em></div>';
        };
        var lab = '<div class="wl" style="color:' + ACC.teal + '">Doors &amp; Windows</div>';
        var ways = open.filter(function (x) { return x.kind !== 'window'; }).length, wins = open.length - ways;
        var line = !open.length ? 'All closed' : !ways ? 'All doors closed' : !wins ? 'All windows closed'
          : plural(ways, 'door', 'doors') + ' · ' + plural(wins, 'window', 'windows');
        if (size === 'S') {
          var first = open[0];
          return gly(first ? WAY_GLYPH[first.kind][0] : 'mdi:door-closed', 34, first ? ACC.orange : ACC.teal) +
            '<div class="wb xl">' + open.length + '</div>' +
            '<div class="ws">' + esc(open.length === 1 ? 'open · ' + name(first) : open.length ? 'open' : 'All closed') + '</div>';
        }
        var big = '<div class="wb m">' + (open.length ? open.length + ' open' : 'All closed') + '</div>';
        if (size === 'W') {
          return '<div class="wsplit"><div class="wcol" style="flex:0 0 170px">' + lab + big + '<div class="ws">' + esc(line) + '</div></div>' +
            '<div class="wcol wr">' + fitRows(list, box.ih, row) + '</div></div>';
        }
        if (size === 'T') return lab + big + '<div class="wr" style="margin-top:6px">' + fitRows(list, box.ih - 19 - 33 - 6, row) + '</div>';
        // LARGE AND EXTRA LARGE (2026-10-31, the owner: not the house picture
        // with Recent Activity): Reminders' list -- the count, then each door
        // and window a 44 px row, an open one saying since when (a time, so
        // it never goes stale between redraws). Extra Large the count in a
        // column of its own beside the list.
        var since = function (st) {
          var t = Date.parse(st.last_changed || ''), L = window.hkLocale;
          if (!t) return '';
          var d = new Date(t), today = new Date().toDateString() === d.toDateString(), tag = L ? L.tag() : undefined;
          return 'Open since ' + (today ? d.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(tag, { weekday: 'short' }));
        };
        var tall = function (x) {
          var g = WAY_GLYPH[x.kind][x.open ? 0 : 1], s = x.open ? since(x.st) : '';
          return '<div data-more="' + esc(x.id) + '">' + gly(g, 20, x.open ? ACC.orange : null) + '<span class="wt"><b>' + esc(name(x)) + '</b>' +
            (s ? '<small>' + esc(s) + '</small>' : '') + '</span><em' + (x.open ? ' style="color:' + ACC.orange + '"' : '') + '>' + (x.open ? 'Open' : 'Closed') + '</em></div>';
        };
        if (size === 'L') return lab + big + '<div class="wr tall" style="margin-top:6px">' + fitRows(list, box.ih - 19 - 33 - 6, tall, 44) + '</div>';
        return '<div class="wsplit" style="gap:22px"><div class="wcol" style="flex:0 0 200px">' + lab + '<div class="wb">' + (open.length ? open.length + ' open' : 'All closed') + '</div>' +
          '<div class="ws">' + esc(line) + '</div></div><div class="wcol wr tall">' + fitRows(list, box.ih, tall, 44) + '</div></div>';
      }
      // WATER: today's large; Small and Tall the last twelve hours as a
      // short chart (Tall the days before under it); Wide the day's hours
      // beside the number, the chart on the block's foot
      _ownWater(p, size, box, h) {
        var lab = '<div class="wl" style="color:' + ACC.cyan + '">Water</div>';
        var ids = waterIds(this, h, p.meter);
        if (ids && !ids.length) return lab + '<div class="ws wf" style="white-space:normal">' + esc(PANEL_EMPTY.water[1]) + '</div>';
        var d = ids ? waterDay(this, h, ids) : null;
        if (!d) return lab + '<div class="ws wf">Loading today…</div>';
        var more = d.more ? ' data-more="' + esc(d.more) + '"' : '', unit = esc(d.unit), big = '<div class="wb"' + more + '>' + amount(d.tot) + '</div>';
        var last12 = d.seq.slice(-12).map(function (x) { return { v: x, c: ACC.cyan }; });
        if (size === 'S') return lab + big + '<div class="ws">' + unit + ' today</div><div class="wf">' + wbars(last12, box.iw, shortH(box)) + '</div>';
        if (size === 'W') {
          var day = d.day24.map(function (x) { return { v: x.v, c: x.fut ? v('ink-3') : ACC.cyan, ghost: x.fut }; });
          return '<div class="wsplit"><div class="wcol" style="flex:0 0 130px">' + lab + big + '<div class="ws">' + unit + ' today</div>' +
            (d.cmp ? '<div class="ws">' + esc(d.cmp) + '</div>' : '') + '</div>' +
            '<div class="wcol" style="justify-content:flex-end">' + wbars(day, box.iw - 130 - 18, Math.max(40, box.ih - 30)) + '</div></div>';
        }
        var tz = window.hkStats && window.hkStats.tz();
        var row = function (x) {
          return '<div style="cursor:default"><b>' + esc(new Date(x.t).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', timeZone: tz }))) + '</b><em>' +
            (x.v == null ? '—' : amount(x.v) + ' ' + unit) + '</em></div>';
        };
        if (size === 'L' || size === 'XL') {
          // what the leak sensors say: one wet, by name and in red; else "no leaks", where the house has them
          var wet = (p.leaks || []).filter(function (id) { return h.states[id] && h.states[id].state === 'on'; });
          var leak = wet.length ? '<span style="color:' + ACC.red + '">Leak: ' + esc((C.accName && C.accName(wet[0])) || attr(h.states[wet[0]], 'friendly_name') || wet[0]) + '</span>'
            : (p.leaks || []).length ? 'no leaks' : '';
          var line = [d.cmp ? esc(d.cmp) : '', leak].filter(Boolean).join(' · ');
          var today = '<div class="wl" style="color:' + ACC.cyan + '">Today</div><div class="wb"' + more + '>' + amount(d.tot) + ' ' + unit + '</div>' +
            (line ? '<div class="ws">' + line + '</div>' : '');
          var hours = d.day24.map(function (x) { return { v: x.v, c: x.fut ? v('ink-3') : ACC.cyan, ghost: x.fut }; });
          var chH = Math.max(40, box.ih - 19 - 46 - (line ? 19 : 0) - 14);
          if (size === 'L') return today + '<div class="wf">' + wbars(hours, box.iw, chH) + '</div>';
          var lw = Math.round((box.iw - 22) * 0.58);
          return '<div class="wsplit" style="gap:22px"><div class="wcol" style="flex:0 0 ' + lw + 'px">' + today + '<div class="wf">' + wbars(hours, lw, chH) + '</div></div>' +
            '<div class="wcol"><div class="wl" style="color:' + v('ink-2') + '">This Week</div>' +
            // (today first, as the mock-up's Sat over Fri, Thu, Wed)
            '<div class="wr" style="margin-top:6px">' + fitRows([{ t: d.day0, v: d.tot }].concat(d.week), box.ih - 19 - 6, row) + '</div></div></div>';
        }
        var room = box.ih - 19 - 46 - 19 - (d.cmp ? 19 : 0) - 12 - 44 - 14 - 19 - 4;
        return lab + big + '<div class="ws">' + unit + ' today</div>' + (d.cmp ? '<div class="ws">' + esc(d.cmp) + '</div>' : '') +
          '<div style="margin-top:12px">' + wbars(last12, box.iw, 44) + '</div>' +
          '<div class="wl" style="margin-top:14px;color:' + v('ink-2') + '">This Week</div>' +
          '<div class="wr" style="margin-top:2px">' + fitRows(d.week, room, row) + '</div>';
      }
      // A THERMOSTAT'S READINGS AND CONTROLS beside its dial: inside,
      // humidity and outside (the sheet's three), then its modes and its fan
      _readings() {
        if (!this._rd) return;
        var h = this.client || { states: {} }, id = this._parts()[1].readings, s = h.states[id] || {}, a = s.attributes || {};
        var wx = h.states[setting('weather.entity', null) || firstOfDomain(h, 'weather')];
        var out = wx && wx.attributes && wx.attributes.temperature != null ? Math.round(wx.attributes.temperature) + '°' : '—';
        var NAME = { heat_cool: 'Auto', auto: 'Auto', heat: 'Heat', cool: 'Cool', off: 'Off', dry: 'Dry', fan_only: 'Fan', on: 'On', low: 'Low', medium: 'Medium', high: 'High' };
        var word = function (m) { return NAME[m] || String(m).replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); };
        var seg = function (label, list, cur, kind) {
          if (!list || list.length < 2) return '';
          return '<div class="row"><span class="k">' + label + '</span><div class="seg" role="group" aria-label="' + label + '">' + list.slice(0, 5).map(function (m) {
            return '<button type="button" data-' + kind + '="' + esc(m) + '" aria-pressed="' + (m === cur) + '">' + esc(word(m)) + '</button>';
          }).join('') + '</div></div>';
        };
        var html = '<div class="rd"><div class="now">' + [['Inside', a.current_temperature != null ? Math.round(a.current_temperature) + '°' : '—'],
          ['Humidity', a.current_humidity != null ? Math.round(a.current_humidity) + '%' : '—'], ['Outside', out]].map(function (r) {
          return '<div><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span></div>';
        }).join('') + '</div>' + seg('Mode', a.hvac_modes, s.state, 'mode') + seg('Fan', a.fan_modes, a.fan_mode, 'fan') + '</div>';
        if (this._rdHtml === html) return;
        this._rdHtml = html; this._rd.innerHTML = html;
        var self = this;
        this._rd.querySelectorAll('button').forEach(function (b) {
          b.addEventListener('click', function () {
            var m = b.getAttribute('data-mode'), f = b.getAttribute('data-fan');
            if (m) self._call('climate', 'set_hvac_mode', { entity_id: id, hvac_mode: m });
            else if (f) self._call('climate', 'set_fan_mode', { entity_id: id, fan_mode: f });
          });
        });
      }
      // a card as tall as its width makes it, shrunk (never grown) to its
      // part: a picture centred; words (wide) laid out that much wider first,
      // so the shrunk card still spans the part (and, wider, is no taller)
      _fitWatch(part, kid, wide) {
        if (this._fitRO) this._fitRO.disconnect();
        if (typeof ResizeObserver === 'undefined') return;
        var fit = function () {
          kid.style.transform = ''; kid.style.width = '';
          var h = kid.offsetHeight, room = part.clientHeight;
          if (!h || !room || h <= room) return;
          var k = room / h;
          if (wide) { kid.style.width = (100 / k).toFixed(3) + '%'; kid.style.transformOrigin = '0 0'; }
          kid.style.transform = 'scale(' + k.toFixed(4) + ')';
        };
        this._fitRO = new ResizeObserver(fit);
        this._fitRO.observe(part); this._fitRO.observe(kid);
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._fitRO) { this._fitRO.disconnect(); this._fitRO = null; }
      }
    }
    watchSize(HkGridPanelCard);
    C.register('hk-grid-panel-card', HkGridPanelCard, 'HK Grid Panel', 'A page\u2019s own panel (Power, Music, Doors & Locks, a thermostat, Live TV, Water), sized to a Home Grid block.',
      [{ name: 'panel', label: 'Panel', selector: { select: { options: [{ value: 'power', label: 'Power' }, { value: 'music', label: 'Music' },
        { value: 'doors', label: 'Doors & Locks' }, { value: 'climate', label: 'Thermostat' }, { value: 'tv', label: 'Live TV' }, { value: 'water', label: 'Water' }] } } }],
      function () { return { panel: 'doors' }; });

    // THE CLOCK BLOCK (2026-10-24, the owner: "many clocks", for a phone on
    // a nightstand): HK's own clock (hk-clock-card, the header's type), or
    // one of the screensaver's faces (hk-saverclock.js, sized by container
    // units, so they fit a block as they fit a screen) -- with its plate,
    // or `bare` on the wallpaper. CLOCK_FACES (hk-grid-catalog.js) are the
    // faces that read at a block's size; the rest need a screen of their own.
    function clockModule() {
      if (window.hkSaverClock) return Promise.resolve(window.hkSaverClock);
      if (!clockModule.p) {
        clockModule.p = import('/hk/modules/hk-saverclock.js').then(function () { return window.hkSaverClock; })
          .catch(function (e) { clockModule.p = null; console.warn('[hk-grid] clock', e && e.message); return null; });
      }
      return clockModule.p;
    }
    // (the block clips the face, not the face itself: scaled down, its own box is smaller than its drawing)
    var CLOCK_CSS = '.body{height:100%}.ck .ckroot{overflow:visible}.ck{position:relative;height:100%;box-sizing:border-box;overflow:hidden;border-radius:var(--hk-block-radius, ' + C.R.plate + 'px)}' +
      '.ck.plate{' + C.plate('card') + '}';
    class HkGridClockCard extends HkGridFull {
      static get CSS() { return FULL_CSS + CLOCK_CSS; }
      getCardSize() { return 2; }
      // (the plate's tap, hk-base.js openTarget) a clock leads to the Timers page, as iOS's clock widget opens Clock
      _tapTarget() { return [{ page: 'timers' }]; }
      // 24-hour as the screen's screensaver clock is (its 24-Hour Clock; off, as HK's own clock reads)
      _h24() {
        var M = window.hkCards.menu, b = M && M.board ? M.board() || {} : {}, so = b.screensaver_options || {};
        return so.clock_24 === true || (so.clock_24 == null && setting('look.saver.clock_24', false) === true);
      }
      // its box hidden: its own option (0.1.72), or its block's Hide Box (the cell's --hk-bare)
      _bare() {
        if ((this._config || {}).bare) return true;
        try { return getComputedStyle(this).getPropertyValue('--hk-bare').trim() === '1'; } catch (e) { return false; }
      }
      _sigOf() { var c = this._config || {}; return JSON.stringify([c.clock_style || '', this._bare(), sizeOf(this), this._h24()]); }
      _render() {
        var c = Object.assign({}, this._config || {}, { bare: this._bare() }), style = c.clock_style || '', key = this._sigOf(), self = this;
        if (this._built && this._key === key) { if (this._face && this._face.setClient) this._face.setClient(this.client); return; }
        this._key = key; this._built = true; this._kids = [];
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        if (!style) {
          // HK's clock: its own plate, or none and the header's glow to read on the wallpaper
          this._root.innerHTML = '<div class="body"></div>';
          var k = this._mount(this._root.querySelector('.body'), Object.assign({ type: 'custom:hk-clock-card' }, c.bare ? { shadow: true } : {}), sizeOf(this) || 'W');
          if (c.bare) k.setAttribute('bare', '');
          return;
        }
        this._root.innerHTML = '<div class="ck' + (c.bare ? '' : ' plate') + '"></div>';
        var box = this._root.querySelector('.ck'), run = this._run = (this._run || 0) + 1;
        clockModule().then(function (M) {
          if (!M || run !== self._run || !box.isConnected) return;
          self._face = M.mount(box, { style: style, h24: self._h24(), bg: 'none', scrim: false, client: self.client });
          self._fillWatch(box, !!c.bare, style);
        });
      }
      // THE FACE FILLS ITS BLOCK (2026-10-24, the owner on the nightstand
      // layouts: StandBy's digits fill the screen). A face is sized for a
      // whole screen -- its time a third of the height -- so in a block it
      // is scaled until its drawing reaches the block's edges, less a margin
      // (more inside the box) -- up, or down when a face sized by the block's
      // height is wider than a Tall block. Measured again as the block
      // resizes and once the face's fonts are in.
      // (Analog Numbers bare fills its block to the edge of its disc, as HomeView's does)
      _fillWatch(box, bare, style) {
        var root = box.querySelector('.ckroot'), self = this;
        if (!root) return;
        var fill = function () {
          root.style.transform = '';
          var b = box.getBoundingClientRect(), face = root.querySelector('.face'), l = Infinity, t = Infinity, r = -Infinity, btm = -Infinity;
          if (!face || !b.width || !b.height) return;
          face.querySelectorAll('*').forEach(function (e) {
            var q = e.getBoundingClientRect();
            if (!q.width || !q.height || q.width >= b.width * 0.999 && q.height >= b.height * 0.999) return;
            l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); btm = Math.max(btm, q.bottom);
          });
          if (!(r > l && btm > t)) return;
          var m = bare ? (style === 'numbers' ? 1 : 0.92) : 0.8, k = Math.min(b.width * m / (r - l), b.height * m / (btm - t), 3);
          // centred on the drawing's own middle, not the block's
          var dx = (b.left + b.width / 2) - (l + r) / 2, dy = (b.top + b.height / 2) - (t + btm) / 2;
          if (Math.abs(k - 1) > 0.02) root.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + k.toFixed(3) + ')';
        };
        root.style.transformOrigin = '50% 50%';
        if (this._fillRO) this._fillRO.disconnect();
        if (typeof ResizeObserver !== 'undefined') { this._fillRO = new ResizeObserver(function () { fill(); }); this._fillRO.observe(box); }
        [60, 700, 2500].forEach(function (ms) { setTimeout(function () { if (self._face) fill(); }, ms); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fill);
      }
      // back on the page (the view host takes a view out and puts it back): the face it let go of is drawn again;
      // nothing else redraws a card whose state did not change, so the block stayed empty
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._config && !this._built) this.redraw();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        if (this._face) { try { this._face.destroy(); } catch (e) { /* gone */ } this._face = null; }
        if (this._fillRO) { this._fillRO.disconnect(); this._fillRO = null; }
        this._built = false; this._run = (this._run || 0) + 1;
      }
    }
    watchSize(HkGridClockCard);
    C.register('hk-grid-clock-card', HkGridClockCard, 'HK Grid Clock', 'A clock sized to a Home Grid block: HK’s own, or a screensaver face, with or without its box.',
      [{ name: 'clock_style', label: 'Style', selector: { select: { options: [{ value: '', label: 'Digital' }, { value: 'analog', label: 'Analog' }] } } },
       { name: 'bare', label: 'Hide Box', selector: { boolean: {} } }], function () { return {}; });

    // ===================================================== hk-grid-cameras-card
    // THE CAMERAS FACE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase G):
    // the cameras named, else every camera in Cameras' order, up to nine at
    // once in the block's arrangement (camGrid). The stills are the camera
    // strip's own (hk-cameras.js, its `grid` layout): double-buffered, each
    // at its tile's size every `refresh` s and only while on screen, never
    // under the screensaver. A tap opens that camera live (its camera sheet).
    // ONE LIVE FEED AT A TIME (a tablet decodes one well; nine never connect:
    // hk-cameras.js): the face opens none of its own but the doorbell's tile
    // while it rings -- for RING_MS, and never under a sheet, the camera
    // sheet's being the one then.
    var RING_MS = 60000;
    // ...and of two faces on one screen, the first to hear the ring has it
    var camLive = null;
    var CAMS_CSS = ':host{display:block;height:100%}.cams{height:100%}.cams > *{display:block;height:100%}';
    class HkGridCamerasCard extends HkGridFull {
      static get CSS() { return CAMS_CSS; }
      getCardSize() { return 6; }
      _size() { var s = this.getAttribute && this.getAttribute('size'); return CAM_MAX[s] || s === 'F' ? s : 'XL'; }
      // its cameras: those the house has (a removed one leaves no hole)
      _ids() {
        var st = (this.client && this.client.states) || {};
        return (this._config.cameras || []).filter(function (id) { return !!st[id]; });
      }
      // (Full: the view's columns, from its cell -- 2 on a phone)
      _cols() {
        try { return parseFloat(getComputedStyle(this).getPropertyValue('--hk-span-c')) || 0; } catch (e) { return 0; }
      }
      _arrange(n) { var b = this._block(); return camGrid(this._size(), n, b && b.w, b && b.h, this._cols()); }
      _live(ids) {
        var P = window.hkSettings, id;
        if (!this._ringing || (window.hkPopupCover || 0) > 0) return null;
        if (P && P.rendering && !P.rendering().autoplay) return null;     // (a tablet that plays no video)
        if (camLive && camLive !== this && camLive.isConnected !== false && camLive._ringing) return null;
        id = camRing(ids, this._ringing === true ? null : this._ringing);
        if (id) camLive = this;
        return id;
      }
      _cfg() {
        var ids = this._ids(), g = this._arrange(ids.length), shown = ids.slice(0, g[0] * g[1]), live = this._live(shown);
        return Object.assign({ type: 'custom:hk-camera-mosaic-card', own_cameras: true, grid: g, seam: C.HOME_GRID.gap,
                               refresh: this._config.refresh || 10, cameras: shown.map(function (id) { return { entity: id }; }) },
                             live ? { live: live } : {});
      }
      _sigOf() { return JSON.stringify([this._ids(), this._size(), this._blockKey || '', this._ringing || '', (window.hkPopupCover || 0) > 0]); }
      // a new box for what it shows (the mosaic, or the stand-in)
      _box() {
        var box = document.createElement('div');
        box.className = 'cams';
        this._root.textContent = '';
        this._root.appendChild(box);
        this._kids = [];
        return box;
      }
      _render() {
        if (!this.client) return;                      // (which cameras the house has: not known yet)
        this._watchBlock();
        var cfg = this._cfg(), key = JSON.stringify(cfg);
        if (!cfg.cameras.length) {
          // (none of its cameras in the house: the catalog's stand-in, as a block with nothing to show)
          if (this._key === '') return;
          this._key = ''; this._mosaic = null;
          this._mount(this._box(), { type: 'custom:hk-key-card', name: 'Cameras', icon: 'hk:camera' });
          return;
        }
        if (this._mosaic && this._key === key) return;
        this._key = key;
        if (this._mosaic) {
          if (this._mosaic.getAttribute('size') !== this._size()) this._mosaic.setAttribute('size', this._size());
          this._mosaic.setConfig(cfg);
          return;
        }
        this._mosaic = this._mount(this._box(), cfg, this._size());
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        if (!this._onRing) {
          // A RING: the doorbell's tile live for a minute (a later ring, a minute from then)
          this._onRing = function (e) {
            var n = e && e.detail;
            if (!n || n.type !== 'notification' || n.kind !== 'doorbell') return;
            self._ringing = n.camera || true;
            clearTimeout(self._ringT);
            self._ringT = setTimeout(function () { self._ringing = null; if (camLive === self) camLive = null; self.redraw(); }, RING_MS);
            self.redraw();
          };
          // a sheet opening takes the live tile back to its still; closing gives it back
          this._onCover = function () { if (self._ringing) self.redraw(); };
        }
        window.addEventListener('hk-house-event', this._onRing);
        window.addEventListener('hk-popup-change', this._onCover);
      }
      disconnectedCallback() {
        window.removeEventListener('hk-house-event', this._onRing);
        window.removeEventListener('hk-popup-change', this._onCover);
        clearTimeout(this._ringT);
        this._ringing = null;
        if (camLive === this) camLive = null;
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
    }
    watchSize(HkGridCamerasCard);
    C.register('hk-grid-cameras-card', HkGridCamerasCard, 'HK Grid Cameras', 'Up to nine cameras at once, sized to a Home Grid block: a tap opens one live, and the doorbell goes live in its place when it rings.',
      [{ name: 'cameras', label: 'Cameras', selector: { entity: { multiple: true, filter: { domain: 'camera' } } } },
       { name: 'refresh', label: 'Refresh (seconds)', selector: { number: { min: 5, max: 60, step: 1 } } }], function () { return {}; });

    // ===================================================== hk-action-card
    // ONE ACTION, THE WHOLE BLOCK ITS BUTTON (2026-10-31, the owner's notes on
    // the widget mock-up): on a HomeView dashboard HomeView's tile (Centred:
    // the glyph large over its name, what it will do under it), on the glass
    // or -- `color` -- a gradient of its own color; on a standard one
    // Shortcuts' button, always in its color. Its color: All Lights Off the
    // Lights page's yellow, Lock Up and Garage Security's teal, a scene or
    // script its accessory's Color, else a tint of its own (hk-tile.js ownTint).
    var YELLOW = (C.PALETTE.icon && C.PALETTE.icon.yellow) || null;
    function actionHex(client, action) {
      var A = C.ACCENTS, T = window.hkTile || {};
      if (action === 'lights_off') return A.yellow;
      if (action === 'lock_up' || action === 'garage') return A.teal;
      var acc = ((setting('accessories', {}) || {}).entities || {})[action] || {};
      return (acc.color && T.hexOf && T.hexOf(acc.color)) || (T.ownTint ? T.ownTint(action) : A.purple);
    }
    class HkActionCard extends HkGridKey {
      setConfig(config) {
        if (!config || !config.action) throw new Error('hk-action: `action` is required');
        super.setConfig(config);
      }
      _plan() {
        var c = this._config;
        return plan(this.client, c.action, c.action === 'lights_off' ? roomOf(c.area, null, this.client) : null);
      }
      _sigOf() {
        var p = this._plan();
        return JSON.stringify([p.name, p.icon, p.state, p.hot, this._said || null, this.getAttribute('tile'), !!this._config.color]);
      }
      _look() {
        var p = this._plan(), a = this._config.action;
        var color = !p.hot ? null : a === 'lights_off' ? YELLOW : a === 'lock_up' || a === 'garage' ? v('warn') : null;
        var paint = this.getAttribute('tile') !== 'centred' || this._config.color ? actionHex(this.client, a) : null;
        return { name: p.name, icon: p.icon, state: p.state, color: color, paint: paint };
      }
      _tap() {
        var p = this._plan(), self = this;
        if (p.sheet) { window.hkShell.moreInfo(p.sheet, this); return; }
        if (!p.calls.length) return;
        Promise.all(p.calls.map(function (c) { return self._call(c[0], c[1], c[2]); })).then(function (done) {
          if (done.some(function (x) { return !x; })) self._say('failed', 'Couldn’t Send');
        });
      }
    }
    var ACTION_OPTIONS = [{ value: 'lock_up', label: 'Lock Up' }, { value: 'lights_off', label: 'All Lights Off' },
                          { value: 'garage', label: 'Garage' }];
    C.register('hk-action-card', HkActionCard, 'HK Action',
      'One tap for one job -- Lock Up, All Lights Off, Garage, or a scene or script -- showing the state it changes. Made for a Home Grid.',
      [{ name: 'action', required: true, selector: { select: { mode: 'dropdown', custom_value: true, options: ACTION_OPTIONS } },
         helper: 'Or a scene or script, by its entity ID (scene.movie_night).' },
       { name: 'area', selector: { area: {} },
         helper: 'All Lights Off in this room only. Leave empty for the whole home.' },
       { name: 'color', selector: { boolean: {} },
         helper: 'On a HomeView dashboard: on a gradient of its color, not the glass.' }],
      function () { return { action: 'lock_up' }; });

    // ===================================================== hk-everything-card
    // THE WAY TO EVERY PAGE AND ROOM (what More opens), as app icons
    // (2026-10-31, the owner's notes on the widget mock-up): Small, four of
    // them as a folder over the name and what is on now; Wide, Large and Extra
    // Large the icons themselves -- the tab bar's and the Pages screen's look,
    // a page in its accent, a room in its tint by its place among the menu's
    // rooms (hkCards.iconGradient / roomTint) -- a tap goes straight there, the
    // last place opens the rest; a heading says what is on.
    function menuItems(client) {
      var M = C.menu, H = window.hkMenu && window.hkMenu._, cfg = null;
      try { cfg = M && M.config ? M.config() : null; } catch (e) { cfg = null; }
      if (!H || !H.model || !cfg || !Array.isArray(cfg.views)) return null;
      var b = (M.board ? M.board() : null) || {};
      var m = H.model(cfg, client && client.areas, { dash: M.dash ? M.dash() : '', order: b.menu_rooms === 'order' ? 'order' : 'az',
        roomOrder: b.room_order, user: client && client.user && client.user.id, categories: b.categories, top: b.menu_top, chips: b.chips,
        chipsRow: b.chips_row, pageOrder: H.pagePaths ? H.pagePaths(b.pages, b.custom_pages) : [], ha: false }) || {};
      var A = C.ACCENTS, PO = C.PAGE_OF_PATH || {}, glyph = H.glyph || function (i) { return i; };
      var pages = (m.top || []).concat(m.categories || []).map(function (it) {
        var p = String((it.paths || [])[1] != null ? it.paths[1] : (it.paths || [])[0]);
        return { title: it.title, icon: glyph(it.icon), path: it.path, hex: (C.pageAccentHex && C.pageAccentHex(PO[p] || p)) || A.orange };
      });
      var rooms = (m.rooms || []).map(function (it, i) {
        return { title: it.title, icon: glyph(it.icon), path: it.path, hex: A[C.roomTint ? C.roomTint(i) : 'orange'] || A.orange };
      });
      return pages.concat(rooms);
    }
    // WHAT IS ON NOW: the lights, switches and fans on, the speakers playing
    // (none hidden, none a group)
    function onNow(client) {
      var st = (client && client.states) || {}, n = 0;
      ['light', 'switch', 'fan'].forEach(function (d) { own(client, d).forEach(function (id) { if (st[id].state === 'on') n++; }); });
      own(client, 'media_player').forEach(function (id) { if (st[id].state === 'playing') n++; });
      return n;
    }
    function onNowText(n) { return n ? n + ' on now' : 'All off'; }
    // [columns, rows, labels] at each size (the mock-up's: Wide a row of
    // five, Large four by three, Extra Large six by three)
    var EV_GRID = { W: [5, 1, false], L: [4, 3, true], XL: [6, 3, true], XXL: [10, 3, true] };
    var EV_CSS = [
      'hk-plate.ev{box-sizing:border-box;height:100%;display:flex;flex-direction:column;padding:' + C.blockPad('14px') + ';overflow:hidden;' + C.plate('card') + ';color:' + v('ink') + '}',
      '.evh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;min-width:0}',
      '.evh b{' + type('headline') + ';white-space:nowrap}',
      '.evh span{' + type('caption') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.apps{flex:1;min-height:0;display:grid;grid-template-columns:repeat(var(--c),minmax(0,1fr));column-gap:8px;row-gap:var(--rg);',
      '  justify-items:center;align-content:var(--ac,center);padding-top:10px}',
      '.app{all:unset;box-sizing:border-box;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;max-width:100%;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.app i{display:flex;align-items:center;justify-content:center;flex:none;width:var(--px);height:var(--px);border-radius:' + APP_CORNER + ';color:#fff;font-style:normal;',
      '  box-shadow:0 4px 10px rgba(0,0,0,0.22);transition:transform ' + C.DUR.press + ' ease}',
      '.app i hk-icon{width:calc(var(--px) * 0.53);height:calc(var(--px) * 0.53);--mdc-icon-size:100%;display:flex;color:#fff}',
      '.app:active i{transform:scale(0.94)}',
      '.app:focus-visible i{outline:2px solid ' + v('ink-2') + ';outline-offset:3px}',
      '.app small{' + type('micro') + ';line-height:14px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:' + v('glow') + '}',
      '.app.mo i{background:rgba(255,255,255,0.2);' + type('headline') + '}',
      '@media (prefers-reduced-motion:reduce){.app i{transition:none}.app:active i{transform:none}}'
    ].join('');
    class HkEverythingCard extends HkGridKey {
      static get CSS() { return KEY_CSS + EV_CSS; }
      _size() { return sizeOf(this) || 'S'; }
      _items() { return menuItems(this.client) || []; }
      _sigOf() {
        return JSON.stringify([this._items().map(function (x) { return x.path; }), onNow(this.client), this._size(), this._blockKey || '',
                               C.menu && C.menu.sig ? C.menu.sig() : '']);
      }
      _look() {
        var items = this._items(), n = onNow(this.client);
        // four of its places, as a folder (none yet: the menu button's own glyph)
        var icon = 'hk:menu';
        try { if (C.menu && C.menu.icon) icon = C.menu.icon() || icon; } catch (e) { /* hk:menu */ }
        return { name: 'Everything', icon: icon, state: onNowText(n), color: null,
                 folder: items.length >= 4 ? items.slice(0, 4).map(function (x) { return [x.hex, x.icon]; }) : null };
      }
      // THE SCREEN'S OWN NAVIGATION, never a second menu: with the tab bar
      // showing, its More sheet (what the bar's menu opens); else the side
      // menu, as the menu button opens it
      _tap() {
        var M = C.menu, B = window.hkTabBar;
        if (M && M.tabBar && M.tabBar() && B && typeof B.open === 'function') { B.open('more'); return; }
        if (M && M.open) M.open();
      }
      // (the plate's tap, hk-base.js openTarget) the same, from anywhere on a larger block than the key
      _tapTarget() { var self = this; return [{ run: function () { self._tap(); } }]; }
      _render() {
        var size = this._size();
        if (size === 'S' || !EV_GRID[size]) {
          if (this._mode !== 'S') { this._mode = 'S'; this._built = false; this._foldKey = null; }
          return super._render();
        }
        this._watchBlock();
        var self = this, items = this._items(), g = EV_GRID[size], cols = g[0], rows = g[1], labels = g[2];
        if (this._mode !== size || !this._built) {
          this._mode = size;
          this._root.innerHTML = '<hk-plate class="ev" data-hk-role="card"><div class="evh"><b>Everything</b><span></span></div><div class="apps" role="list"></div></hk-plate>';
          this._ev = { card: this._root.querySelector('.ev'), say: this._root.querySelector('.evh span'), apps: this._root.querySelector('.apps') };
          this._appKey = null;
          this._built = true;
        }
        var e = this._ev, said = onNowText(onNow(this.client));
        if (e.say.textContent !== said) e.say.textContent = said;
        // THE ICONS' SIZE, by the room the block has: as large as the mock-up's
        // (52 at Wide, 62 above) where they fit, smaller on a tile's shorter cell
        var b = this._block(), h = b ? b.h - 36 - 22 - 10 : (rows === 1 ? 110 : 330), rg = rows > 1 ? 12 : 0;
        var px = Math.max(36, Math.min(labels ? 62 : 52, Math.floor((h - (rows - 1) * rg) / rows) - (labels ? 20 : 0)));
        e.apps.style.setProperty('--c', String(cols));
        e.apps.style.setProperty('--px', px + 'px');
        e.apps.style.setProperty('--rg', rg + 'px');
        e.apps.style.setProperty('--ac', rows === 1 ? 'end' : 'center');
        var places = cols * rows, cut = items.length > places, shown = cut ? items.slice(0, places - 1) : items;
        var key = JSON.stringify([shown, cut ? items.length - shown.length : 0, labels]);
        if (key === this._appKey) return;
        this._appKey = key;
        e.apps.innerHTML = '';
        shown.forEach(function (x) {
          var gr = C.iconGradient(x.hex), a = document.createElement('button');
          a.type = 'button'; a.className = 'app'; a.setAttribute('role', 'listitem'); a.setAttribute('aria-label', x.title);
          a.innerHTML = '<i><hk-icon></hk-icon></i>' + (labels ? '<small></small>' : '');
          a.querySelector('i').style.background = 'linear-gradient(180deg,' + gr[0] + ',' + gr[1] + ')';
          a.querySelector('hk-icon').icon = x.icon;
          if (labels) a.querySelector('small').textContent = x.title;
          a.addEventListener('click', function (ev) { ev.stopPropagation(); C.navigate(x.path, self); });
          e.apps.appendChild(a);
        });
        if (cut) {
          var m = document.createElement('button'), rest = items.length - shown.length;
          m.type = 'button'; m.className = 'app mo'; m.setAttribute('role', 'listitem'); m.setAttribute('aria-label', rest + ' more: every page and room');
          m.innerHTML = '<i></i>' + (labels ? '<small>All</small>' : '');
          m.querySelector('i').textContent = '+' + rest;
          m.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
          e.apps.appendChild(m);
        }
      }
    }
    watchSize(HkEverythingCard);
    C.register('hk-everything-card', HkEverythingCard, 'HK Everything',
      'Every page and room of the screen, as app icons: a tap goes there. For a Home Grid screen.',
      [{ name: 'glass', selector: { boolean: {} },
         helper: 'Off: leave this card out of the shared blur (Glass look: Blur).' }],
      function () { return {}; });

    // ===================================================== hk-suggested-scene-card
    // THE ART follows the scene: a sky for its time of day (content, not
    // design values: DESIGN.md "Content is not design"), its own color in
    // its well.
    var ART = {
      morning: 'linear-gradient(160deg, #f5a463, #e9707f)',
      day: 'linear-gradient(160deg, #4fb4e2, #3570c4)',
      evening: 'linear-gradient(160deg, #e8900c, #81409c)',
      night: 'linear-gradient(160deg, #2a3a88, #0b1033)'
    };
    var SCENE_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.sg{box-sizing:border-box;height:100%;position:relative;display:flex;align-items:center;gap:16px;',
      '  padding:' + C.blockPad(C.CARD.pad) + ';cursor:pointer;overflow:hidden;' + C.plate('card') + ';',
      '  -webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
      '  transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease}',
      'hk-plate.sg:active{transform:scale(0.98);filter:brightness(0.93)}',
      'hk-plate.sg:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.art{position:absolute;inset:0;pointer-events:none;transition:background ' + C.DUR.build + ' ease}',
      '.well{position:relative;width:56px;height:56px;border-radius:50%;flex:none;display:flex;align-items:center;',
      '  justify-content:center;background:' + v('well-bg') + ';transition:background-color ' + C.DUR.fade + ' ease}',
      '.icon{width:' + TILE.sceneGlyph + 'px;height:' + TILE.sceneGlyph + 'px;--mdc-icon-size:100%;display:flex;color:#fff}',
      '.tx{position:relative;display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.lb{' + C.labelCss('label') + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.nm{' + type('title') + ';line-height:26px;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cap{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // the art is lit: its words keep the dark plate's white on a light page
      'hk-plate.sg.lit{' + C.LIGHT_OFF + '}',
      'hk-plate.sg.lit .tx{text-shadow:' + v('glow') + '}',
      // L: the glyph at the top, the words at the bottom
      ':host([size="L"]) hk-plate.sg{flex-direction:column;align-items:flex-start;justify-content:space-between}',
      ':host([size="L"]) .well{width:64px;height:64px}',
      'hk-plate.sg.hk-tapped .well{background:rgba(255, 255, 255, 0.92)}',
      'hk-plate.sg.hk-tapped .icon{color:#000}',
      '@media (prefers-reduced-motion:reduce){hk-plate.sg,hk-plate.sg:active,.art,.well{transition:none;transform:none}}'
    ].join('');

    class HkSuggestedSceneCard extends HkBase {
      static get CSS() { return SCENE_CSS; }
      getCardSize() { return 2; }
      _now() { return houseMinutes(this._clock ? this._clock() : new Date()); }
      _pick() { return suggestion(this.client, this._config.windows, this._now()); }
      _sigOf() {
        var s = this._pick();
        return JSON.stringify([s, sizeOf(this)]);
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        // the time of day moves on: look again every minute
        if (!this._tick) this._tick = setInterval(function () { self._sigCheck(); }, 60000);
      }
      _sigCheck() {
        var sig = this._sigOf();
        if (sig !== this._lastSig) this.redraw();
      }
      disconnectedCallback() {
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        if (this._tapT) { clearTimeout(this._tapT); this._tapT = null; }
        super.disconnectedCallback();
      }
      _render() {
        var self = this;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="sg" data-hk-role="card" role="button" tabindex="0">' +
            '<div class="art"></div><div class="well"><hk-icon class="icon"></hk-icon></div>' +
            '<div class="tx"><div class="lb"></div><div class="nm"></div><div class="cap"></div></div></hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('.sg'), art: q('.art'), well: q('.well'), icon: q('.icon'), lb: q('.lb'), nm: q('.nm'), cap: q('.cap') };
          this._e.card.addEventListener('click', function (ev) { ev.stopPropagation(); self._run(); });
          this._e.card.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); self._run(); }
          });
          this._built = true;
        }
        var e = this._e, s = this._pick();
        this._lastSig = JSON.stringify([s, sizeOf(this)]);
        this._s = s;
        if (!s) {
          e.art.style.background = '';
          e.card.classList.remove('lit');
          e.icon.icon = 'mdi:palette';
          e.lb.textContent = 'Scenes';
          e.nm.textContent = 'No Scene for Now';
          e.cap.textContent = 'Set its times in the block’s options';
          e.card.setAttribute('aria-label', 'No scene for now');
          return;
        }
        var acc = ((setting('accessories', {}) || {}).entities || {})[s.scene] || {};
        var ent = ((this.client && this.client.entities) || {})[s.scene] || {};
        var st = this.client && this.client.states[s.scene];
        e.art.style.background = ART[s.art] || ART.day;
        e.card.classList.add('lit');
        var icon = acc.icon || ent.icon || attr(st, 'icon') || 'mdi:palette';
        if (e.icon.icon !== icon) e.icon.icon = icon;
        var tint = acc.color && C.PALETTE.icon[acc.color];
        e.well.style.background = tint || '';
        var label = s.next ? 'Next' + (s.label ? ' · ' + s.label : '') : (s.label || ({ morning: 'Morning', day: 'Day', evening: 'Evening', night: 'Night' })[s.art]);
        var cap = s.next ? 'From ' + clockText(s.start) : 'Until ' + clockText(s.end);
        if (e.lb.textContent !== label) e.lb.textContent = label;
        if (e.nm.textContent !== s.name) e.nm.textContent = s.name;
        if (e.cap.textContent !== cap) e.cap.textContent = cap;
        e.card.setAttribute('aria-label', s.name + ', ' + label + ', ' + cap);
      }
      // the scene, run as a scene pill runs it (hkCards.sceneTap), and the
      // pill's tapped look for a moment
      _run() {
        var s = this._s, self = this;
        if (!s) return;
        this._act(C.sceneTap(s.scene), false);
        this._e.card.classList.add('hk-tapped');
        if (this._tapT) clearTimeout(this._tapT);
        this._tapT = setTimeout(function () { self._tapT = null; if (self._e) self._e.card.classList.remove('hk-tapped'); }, 1100);
      }
    }
    watchSize(HkSuggestedSceneCard);

    C.register('hk-suggested-scene-card', HkSuggestedSceneCard, 'HK Suggested Scene',
      'The scene for this time of day: Good Morning in the morning, Good Night at night. Tap to set it. Made for a Home Grid.',
      [{ name: 'windows', selector: { object: {} },
         helper: 'A list of times and scenes, each with a start, an end (24-hour, 05:00), a scene and a label. Leave empty for Morning, Day, Evening and Night, each finding its scene by name.' }],
      function () { return {}; });

    window.hkGridCards.Room = HkGridRoomCard;
    window.hkGridCards.Action = HkActionCard;
    window.hkGridCards.Everything = HkEverythingCard;
    // (tests/test_blocks_tiles.js: the widget blocks' own sums)
    Object.assign(window.hkGridCards._, { roomLine: roomLine, sceneSays: sceneSays, secRows: secRows, secSays: secSays,
                                          alarmLook: alarmLook, menuItems: menuItems, onNow: onNow, actionHex: actionHex });
    window.hkGridCards.Scene = HkSuggestedSceneCard;
    window.hkGridCards.Cameras = HkGridCamerasCard;

    // ===================================================== hk-on-now-card
    // ON NOW (2026-10-31, the owner's widget mock-up, "On Now (new)"): what
    // is on in the house right now -- the lights, the speakers playing, the
    // fans and the room's switches -- counted as the Reminders widget counts,
    // each kind in its color. Off and All Off are house commands through the
    // card's action port, as the room pages' toggles are (a speaker pauses).
    //   S       the count large, and what it is
    //   W       each kind a chip; a tap turns that kind off
    //   T       each kind with its count, and All Off
    //   L, XL   each thing that is on with its own Off, "+N more", All Off
    //           (XL the count in a column of its own beside them)
    // The house's own lists (Status & Chips, hkStrategy.inventory) less what
    // it hides; a group light is its lights, never counted twice.
    var ON_KINDS = [
      { key: 'lights', one: 'light', many: 'lights', icon: 'mdi:lightbulb', color: ACC.yellow, call: ['light', 'turn_off'], off: 'Off' },
      { key: 'speakers', one: 'speaker', many: 'speakers', icon: 'mdi:speaker', color: ACC.pink, call: ['media_player', 'media_pause'], off: 'Pause' },
      { key: 'fans', one: 'fan', many: 'fans', icon: 'mdi:fan', color: ACC.cyan, call: ['fan', 'turn_off'], off: 'Off' },
      { key: 'switches', one: 'switch', many: 'switches', icon: 'mdi:power-plug', color: ACC.green, call: ['switch', 'turn_off'], off: 'Off' }
    ];
    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
    // -> [{kind, ids}] of the kinds with something on, and [{id, kind, name, room}] each thing
    function whatsOn(client) {
      var st = (client && client.states) || {}, ents = (client && client.entities) || {}, areas = (client && client.areas) || {};
      var inv = null, G = hidesOf();
      try { inv = window.hkStrategy && window.hkStrategy.inventory ? window.hkStrategy.inventory(client, G) : null; } catch (e) { inv = null; }
      inv = inv || {};
      var has = function (list, id) { return Array.isArray(list) && list.indexOf(id) >= 0; };
      var hid = function (id) {
        var e = ents[id] || {}, a = areaOf(client, id);
        return !!(e.hidden || e.entity_category || has(G.exclude_entities, id) || (a && has(G.exclude_areas, a)) || (e.device_id && has(G.exclude_devices, e.device_id)));
      };
      var is = function (state) { return function (id) { return st[id] && st[id].state === state && !isGroup(st[id]); }; };
      var lists = {
        lights: (inv.lights || []).filter(is('on')),
        speakers: (inv.speakers || []).filter(is('playing')),
        fans: (inv.fans || []).filter(is('on')),
        // a switch in a room (a car's charging or an integration's own setting is not "on" in the house)
        switches: Object.keys(st).filter(function (id) { return dom(id) === 'switch' && st[id].state === 'on' && areaOf(client, id) && !hid(id); }).sort()
      };
      var short = window.hkStrategy && window.hkStrategy.shortName;
      var kinds = [], things = [];
      ON_KINDS.forEach(function (k) {
        var ids = lists[k.key];
        if (!ids.length) return;
        kinds.push({ kind: k, ids: ids });
        ids.map(function (id) {
          var a = areaOf(client, id), room = a && areas[a] ? areas[a].name : '', full = (C.accName && C.accName(id)) || attr(st[id], 'friendly_name') || id;
          // the room's name off the front ("Kitchen Pendants" in the Kitchen), unless
          // all that is left is what it is ("Porch Light" stays itself)
          var name = short ? short(full, room) : full;
          if (/^(light|lights|lamp|fan|speaker|switch|plug)$/i.test(name)) name = full;
          var under = name === room ? '' : room;
          return { id: id, kind: k, name: name, room: k.key === 'speakers' ? (under ? under + ' · Playing' : 'Playing') : under };
        }).sort(function (x, y) { return (x.room + x.name).localeCompare(y.room + y.name); }).forEach(function (t) { things.push(t); });
      });
      return { kinds: kinds, things: things, n: things.length };
    }
    var ON_CSS = [
      ':host{display:block;height:100%}',
      '.ws.wrap{white-space:normal}',
      // the controls: a chip per kind, Off per thing, All Off -- 44 px each
      '.on-b{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:44px;cursor:pointer;',
      '  border-radius:22px;background:' + v('key') + ';color:' + v('ink') + ';' + type('caption') + ';font-weight:600;-webkit-tap-highlight-color:transparent}',
      '.on-b:active{filter:brightness(0.9)}.on-b:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.on-b.all{' + type('body') + ';font-weight:600;padding:0 22px}',
      '.chips{display:grid;gap:4px;align-content:center;min-width:0}',
      '.chips .on-b{justify-content:flex-start;padding:0 12px;min-width:0}',
      '.chips .on-b span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.chips .on-b em{font-style:normal;opacity:.7;flex:none}',
      '.on-l{display:flex;flex-direction:column;min-height:0}',
      '.on-l>div{display:flex;align-items:center;gap:10px;box-sizing:border-box;height:48px;flex:none;border-bottom:1px solid ' + v('line') + '}',
      '.on-l>div:last-child{border-bottom:0}',
      '.on-l .tx{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.on-l .tx b{' + type('body') + ';font-weight:600;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.on-l .tx small{' + type('caption') + ';line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.on-l .on-b{padding:0 12px;flex:none}',
      '.on-hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none}',
      '.on-ft{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:8px;flex:none}',
      '.on-x{display:flex;gap:22px;flex:1;min-height:0}.on-x>.wcol:last-child{flex:1}',
      '.none{' + type('body') + ';color:' + v('ink-2') + '}'
    ].join('');
    class HkOnNowCard extends HkBase {
      static get CSS() { return WG_CSS + ON_CSS; }
      getCardSize() { return 4; }
      // (the plate's tap, hk-base.js openTarget) what is on, as a sheet of those things; one thing, its own sheet
      _tapTarget() {
        var ids = whatsOn(this.client).things.map(function (t) { return t.id; });
        return ids.length > 1 ? [{ group: ['On Now', ids, { icon: 'mdi:power' }] }] : ids.length ? [{ sheet: ids[0] }] : [];
      }
      _sigOf() {
        var o = whatsOn(this.client), st = (this.client && this.client.states) || {};
        return JSON.stringify([o.things.map(function (t) { return t.id + (st[t.id] ? st[t.id].last_updated : ''); }), sizeOf(this), this._blockKey || '']);
      }
      _render() {
        var self = this;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="wg" data-hk-role="card" role="group" aria-label="On now"></hk-plate>';
          this._plate = this._root.querySelector('hk-plate');
          this._plate.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button');
            if (!b) return;
            e.stopPropagation();
            self._off(b.getAttribute('data-off'), b.getAttribute('data-kind'), b.hasAttribute('data-all'));
          });
          this._built = true;
        }
        var size = sizeOf(this) || 'L', box = inner(this, size), o = whatsOn(this.client);
        var lab = '<div class="wl" style="color:' + ACC.orange + '">On Now</div>';
        var all = o.n ? '<button type="button" class="on-b all" data-all>All Off</button>' : '';
        var thing = function (t) {
          return '<div>' + gly(t.kind.icon, 20, t.kind.color) + '<span class="tx"><b>' + esc(t.name) + '</b>' + (t.room ? '<small>' + esc(t.room) + '</small>' : '') + '</span>' +
            '<button type="button" class="on-b" data-off="' + esc(t.id) + '" aria-label="' + esc(t.kind.off + ' ' + t.name) + '">' + t.kind.off + '</button></div>';
        };
        // as many things as fit in `room` px (rows of 48): the rest are "+N more"
        var list = function (room) {
          var fit = Math.max(1, Math.floor(room / 48)), shown = o.things.slice(0, fit);
          return { html: '<div class="on-l">' + shown.map(thing).join('') + '</div>', more: o.n - shown.length };
        };
        var html;
        if (size === 'S') {
          var first = o.kinds[0], rest = o.kinds.slice(1);
          html = lab + '<div class="wb xl">' + o.n + '</div><div class="ws wf wrap">' + (o.n ? esc(plural(first.ids.length, first.kind.one, first.kind.many)) +
            (rest.length ? '<br>' + esc(rest.map(function (x) { return plural(x.ids.length, x.kind.one, x.kind.many); }).join(' · ')) : '') : 'Nothing on') + '</div>';
        } else if (size === 'W') {
          var rows = Math.max(1, Math.floor((box.ih + 4) / 48)), two = o.kinds.length > rows;
          html = '<div class="wsplit"><div class="wcol" style="flex:0 0 ' + (two ? 90 : 120) + 'px">' + lab + '<div class="wb xl">' + o.n + '</div></div>' +
            (o.n ? '<div class="chips" style="grid-template-columns:repeat(' + (two ? 2 : 1) + ',minmax(0,1fr))">' + o.kinds.map(function (x) {
              return '<button type="button" class="on-b" data-kind="' + x.kind.key + '" aria-label="' + esc(x.kind.off + ' ' + plural(x.ids.length, x.kind.one, x.kind.many)) + '">' +
                // (two across, on a tile cell: the glyph says what, the number how many)
                gly(x.kind.icon, 18, x.kind.color) + '<span>' + esc(two ? String(x.ids.length) : plural(x.ids.length, cap(x.kind.one), cap(x.kind.many))) + '</span><em>' + x.kind.off + '</em></button>';
            }).join('') + '</div>' : '<div class="wcol" style="justify-content:center"><div class="none">Nothing is on</div></div>') + '</div>';
        } else if (size === 'T') {
          html = lab + '<div class="wb xl">' + o.n + '</div>' +
            (o.n ? '<div class="wr" style="margin-top:6px">' + o.kinds.map(function (x) {
              return '<div style="cursor:default">' + gly(x.kind.icon, 20, x.kind.color) + '<b>' + esc(cap(x.kind.many)) + '</b><em>' + x.ids.length + '</em></div>';
            }).join('') + '</div>' : '<div class="none">Nothing is on</div>') +
            '<div class="on-ft">' + all.replace('class="on-b all"', 'class="on-b all" style="flex:1"') + '</div>';
        } else if (size === 'L') {
          var l = list(box.ih - 19 - 6 - 52);
          html = '<div class="on-hd">' + lab + '<span class="ws">' + o.n + ' on</span></div>' +
            (o.n ? l.html : '<div class="none" style="margin:auto">Nothing is on</div>') +
            '<div class="on-ft"><span class="ws">' + (l.more ? '+' + l.more + ' more' : '') + '</span>' + all + '</div>';
        } else {
          var x2 = list(box.ih - (o.n > Math.floor(box.ih / 48) ? 24 : 0));
          html = '<div class="on-x"><div class="wcol" style="flex:0 0 150px">' + lab + '<div class="wb xl">' + o.n + '</div>' +
            '<div class="ws wrap">' + (o.n ? o.kinds.map(function (x) { return esc(plural(x.ids.length, x.kind.one, x.kind.many)); }).join('<br>') : 'Nothing on') + '</div><div class="wf">' + all.replace('class="on-b all"', 'class="on-b all" style="width:100%"') + '</div></div>' +
            '<div class="wcol">' + (o.n ? x2.html + (x2.more ? '<div class="ws" style="margin-top:4px">+' + x2.more + ' more</div>' : '') : '<div class="none" style="margin:auto">Nothing is on</div>') + '</div></div>';
        }
        C.morph(this._plate, html);
      }
      // OFF: one thing, a kind, or everything on -- one call per kind, the
      // room pages' own commands (HkBase._call: the host's action port)
      _off(id, kindKey, everything) {
        var o = whatsOn(this.client), self = this;
        var groups = everything ? o.kinds : o.kinds.filter(function (x) { return x.kind.key === kindKey; });
        if (id) {
          var t = o.things.filter(function (x) { return x.id === id; })[0];
          groups = t ? [{ kind: t.kind, ids: [id] }] : [];
        }
        groups.forEach(function (x) { self._call(x.kind.call[0], x.kind.call[1], { entity_id: x.ids.length === 1 ? x.ids[0] : x.ids.slice() }); });
      }
    }
    watchSize(HkOnNowCard);
    C.register('hk-on-now-card', HkOnNowCard, 'HK On Now',
      'What is on in the house now -- lights, speakers, fans and switches -- with Off for each and All Off. Made for a Home Grid.',
      [{ name: 'glass', selector: { boolean: {} },
         helper: 'Off: leave this card out of the shared blur (Glass look: Blur).' }],
      function () { return {}; });
    window.hkGridCards.OnNow = HkOnNowCard;
    window.hkGridCards._.whatsOn = whatsOn;
  });
})();
