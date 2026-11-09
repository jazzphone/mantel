// hk-grid-math.js - the helpers and the room math.
//
// PART OF THE HOME GRID'S CARDS (hk-grid-cards.js). Not a card and not run on its own: it registers one
// function, which hk-grid-cards.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkGridCardsParts = window.hkGridCardsParts || {})['hk-grid-math'] = function (K) {
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
    var COLS = { S: 1, W: 2, T: 1, L: 2, XL: 3, XXL: 6 };
    var HEAD = { W: 42, T: 66, L: 66, XL: 66, XXL: 66 };
    function fit(size, height) {
      var rows = Math.max(0, Math.floor((height - (HEAD[size] || HEAD.W) + GAP) / (PILL_H + GAP)));
      rows = Math.min(rows, size === 'W' ? 1 : 2);
      return rows * (COLS[size] || 2);
    }
    // NO HOLES (2026-11-07, the review; as hk-chip.js gridShape): `n` things in at most `cols` x `rows` places -- the
    // rows they need, then the columns those rows need, so a short last row leaves no gap: the last thing is wider.
    // 3 in 2 x 2 -> the last spans both; 4 in 3 x 2 -> 2 x 2; 5 in 3 x 2 -> the last spans two. { cols, rows, last }
    function shape(n, cols, rows) {
      n = Math.max(1, Math.min(n | 0, cols * rows));
      var r = Math.ceil(n / cols), c = Math.ceil(n / r);
      return { cols: c, rows: r, last: 1 + (c - (n % c || c)) };
    }
    // TWO THINGS, ALWAYS (a Wide or Tall room, 2026-11-07): the lights first, the room's speaker only when there is room
    // for it (fewer than two lights); the rest is counted, "+N more", in the heading's line. { tiles, more }
    function twoOf(parts, client) {
      var sp = speakerOf(client, parts.speakers), total = parts.lights.length + (sp ? 1 : 0);
      var tiles = parts.lights.slice(0, 2).map(function (c) { return pill(c, true); });
      if (tiles.length < 2 && sp) tiles.push(pill(sp, false));
      return { tiles: tiles, more: total - tiles.length };
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
      var C = window.hkCards, ids = (C && C.sceneIds ? C.sceneIds(client) : []).slice().sort();
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
    function windowList(client, windows) {
      return (Array.isArray(windows) && windows.length ? windows : DEFAULT_WINDOWS).map(function (w) {
        var id = w.scene || (w.words ? sceneFor(client, w.words) : null);
        var ok = id && client && client.states && client.states[id];
        return ok ? { start: w.start, end: w.end, scene: id, label: w.label || '', art: w.art || null } : null;
      }).filter(Boolean);
    }
    // THE SUGGESTION: the window that holds now, with its scene; else the next
    // one to come (`next`). null when no window has a scene the house has.
    function suggestion(client, windows, now) {
      var list = windowList(client, windows);
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
    // WHAT COMES AFTER IT (2026-11-09, mockup 6, the owner: "what comes later today"): the same windows, in the order they
    // begin after the suggestion's (or after now, when it is `next`), each scene once, the suggestion's own left out. At most n.
    function laterScenes(client, windows, now, n) {
      var list = windowList(client, windows), s = suggestion(client, windows, now);
      if (!s) return [];
      var from = minutes(s.start), seen = {};
      seen[s.scene] = true;
      return list.map(function (w) { return { w: w, d: (minutes(w.start) - from + 1440) % 1440 }; })
        .filter(function (x) { return x.d > 0 || x.w.scene !== s.scene; })
        .sort(function (x, y) { return x.d - y.d; })
        .filter(function (x) { if (seen[x.w.scene]) return false; seen[x.w.scene] = true; return true; })
        .slice(0, n || 3).map(function (x) {
          var name = friendly(client, x.w.scene);
          return { scene: x.w.scene, name: name, label: x.w.label || null, start: x.w.start, art: x.w.art || artOf(x.w, name) };
        });
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
      // a button counted as a scene (Settings -> Accessories -> Scenes): pressed
      if ((d === 'input_button' || d === 'button') && st[action]) {
        var bent = ((client.entities || {})[action]) || {};
        var bacc = ((setting('accessories', {}) || {}).entities || {})[action] || {};
        return { name: friendly(client, action), icon: bacc.icon || bent.icon || attr(st[action], 'icon') || 'mdi:palette',
                 hot: false, state: 'Scene', calls: [[d, 'press', { entity_id: action }]], sheet: null };
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

    // what the shell and the later parts use of this one
    K.areaOf = areaOf; K.attr = attr; K.CAM_MAX = CAM_MAX; K.camGrid = camGrid; K.camRing = camRing;
    K.clockText = clockText; K.COLS = COLS; K.DEFAULT_WINDOWS = DEFAULT_WINDOWS; K.dimCall = dimCall; K.dims = dims;
    K.dom = dom; K.DOORS = DOORS; K.dragged = dragged; K.fit = fit; K.friendly = friendly; K.GAP = GAP;
    K.HOLD_MS = HOLD_MS; K.holds = holds; K.houseMinutes = houseMinutes; K.isGroup = isGroup; K.kind = kind;
    K.layout = layout; K.menuCounts = menuCounts; K.minutes = minutes; K.OFF = OFF; K.own = own; K.percent = percent;
    K.pill = pill; K.PILL_H = PILL_H; K.plan = plan; K.plural = plural; K.roomLine = roomLine; K.roomOf = roomOf;
    K.roomParts = roomParts; K.sceneSays = sceneSays; K.setting = setting; K.shape = shape; K.SLOP = SLOP; K.speakerOf = speakerOf;
    K.twoOf = twoOf;
    K.suggestion = suggestion; K.laterScenes = laterScenes; K.TABLET_ROOM = TABLET_ROOM;
  };
})();
