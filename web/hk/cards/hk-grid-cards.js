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
//   hk-everything-card       `everything` (S): the screen's pages and rooms, as
//                            its own navigation opens them (the tab bar's More
//                            sheet, else the side menu) -- for a screen without
//                            its tab bar.
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
  var PILL_H = 70, GAP = 10;
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
      '.room{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:' + C.blockPad('14px') + ';gap:10px;' + C.plate('card') + ';',
      '  --hk-pill:100%}',
      // THE NAME: a room heading's (19.7 / 700, measured off the Home app),
      // with the way into its page when it has one
      '.hd{display:flex;align-items:center;gap:6px;min-width:0;height:28px;flex:none;padding:0 8px}',
      '.nm{all:unset;position:relative;cursor:pointer;min-width:0;min-height:28px;max-width:100%;display:flex;align-items:center;gap:6px;',
      '  font-size:19.7px;font-weight:700;line-height:1;letter-spacing:-0.45px;color:' + v('ink') + ';',
      '  text-shadow:' + v('glow') + ';-webkit-tap-highlight-color:transparent}',
      // a 44 px target round the 28 px line (DESIGN.md: touch targets)
      '.nm::after{content:"";position:absolute;left:-6px;right:-6px;top:-8px;bottom:-8px}',
      '.nm span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0 2px 1px}',
      '.nm i{font-style:normal;opacity:0.62;flex:none}',
      '.nm:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
      // THE PILLS: HK's own, a cell wide, in whole rows
      // (W: its heading on the block's inset like every block's words -- at 8 px it sat 6 px from the plate's top)
      '.room[size=W]{gap:6px}.room[size=W] .hd{height:22px}.room[size=W] .tiles{padding-bottom:0}',
      ':host([data-grid-pager]) .room[size=W]{padding-bottom:28px}',
      '.tiles{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));',
      '  grid-template-rows:repeat(var(--rows,2),minmax(0,1fr));gap:' + GAP + 'px;flex:1;min-height:0;padding-bottom:var(--hk-pager-safe,0px)}',
      '.tiles.scrolling{grid-template-rows:none;grid-auto-rows:calc((100% - var(--scroll-gaps,10px))/var(--rows,2));align-content:start;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scrollbar-width:thin;padding-bottom:0;margin-bottom:var(--hk-pager-safe,0px)}',
      '.tiles.scrolling .slot{touch-action:pan-x pan-y}',
      '.slot{container-type:size;container-name:hk-cell;min-width:0;min-height:0}.slot > *{display:block;width:100%;height:100%}',
      '.more{border:0;border-radius:' + v('glass-radius') + ';' + C.plate('tile') + ';color:' + v('ink') + ';' + type('body') + ';min-height:44px;cursor:pointer}',
      '.slot{position:relative;touch-action:pan-x;-webkit-user-select:none;user-select:none;',
      '  -webkit-touch-callout:none}',
      '.none{' + type('body') + ';color:' + v('ink-3') + ';text-shadow:' + v('glow') + '}',
      // THE DIMMER, while a light is held: the readout over its pill -- a
      // fill from the bottom and the percent -- on the near-solid overlay
      '.dim{position:absolute;inset:0;border-radius:' + v('glass-radius') + ';overflow:hidden;',
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
      // what it draws, in one go: the room, its pills, its line
      _plan() {
        var h = this.client, size = this._size(), area = this._area();
        if (!h || !h.states || !area) return { area: area, size: size, tiles: [], status: null, line: '', name: '' };
        var parts = roomParts(h, area);
        if (this._config.accessory_display === 'scroll') {
          return { area: area, size: size, scroll: true, more: 0, name: (h.areas[area] || {}).name || area,
                   tiles: parts.all.map(function (c) { return pill(c, ['light', 'switch', 'input_boolean', 'fan'].indexOf(dom(c.entity)) >= 0); }) };
        }
        // A paged group leaves the same clear foot as other interactive cards.
        var places = fit(size, this._height() - (this.hasAttribute('data-grid-pager') ? 24 : 0));
        var room = (h.areas || {})[area] || {};
        var total = parts.lights.length + (speakerOf(h, parts.speakers) ? 1 : 0), more = total > places;
        return { area: area, size: size, parts: parts, tiles: layout(parts, size, Math.max(0, places - (more ? 1 : 0)), h),
                 more: more ? total - Math.max(0, places - 1) : 0, line: '', name: room.name || area };
      }
      _sigOf() {
        var p = this._plan();
        this._p = p;
        return JSON.stringify([p.area, p.size, p.name, p.more, !!p.scroll, this._config.surface, p.tiles.map(function (t) { return t.entity; }),
                               this._height(), !!window.hkStrategy, !!window.hkRoom]);
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
            '<i aria-hidden="true">›</i></button></div>' +
            '<div class="tiles" role="list"></div></div>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { box: q('.room'), nm: q('.nm'), name: q('.nm span'), chev: q('.nm i'), tiles: q('.tiles') };
          this._e.nm.addEventListener('click', function (e) { e.stopPropagation(); self._openRoom(); });
          this._kids = []; this._key = null;
          this._built = true;
        }
        var e = this._e;
        e.box.setAttribute('size', p.size);
        C.groupSurface(e.box, this._config.surface);
        // (as many pills as it has fill the block: fewer than a row's worth, one row of taller ones -- not a second
        // row of nothing, 2026-10-30)
        var nPills = (p.tiles || []).length + (p.more ? 1 : 0), oneRow = p.size !== 'W' && !p.scroll && nPills > 0 && nPills <= COLS[p.size];
        e.tiles.style.setProperty('--cols', String(COLS[p.size]));
        e.tiles.style.setProperty('--rows', p.size === 'W' || oneRow ? '1' : '2');
        e.tiles.style.setProperty('--scroll-gaps', p.size === 'W' ? '0px' : GAP + 'px');
        e.tiles.classList.toggle('scrolling', !!p.scroll);
        if (e.name.textContent !== (p.name || 'Room')) e.name.textContent = p.name || 'Room';
        var path = this._roomPath(p.area);
        e.chev.style.display = path ? '' : 'none';
        e.nm.setAttribute('aria-label', (p.name || 'Room') + (path ? ', open the room' : ''));
        // the pills: made again only when what they are changes
        // CENTRED (2026-10-31, the owner: the Accessories block's tiles "don't
        // follow the sizing for HomeView styling", with no second line): the
        // block's Tile Style on each tile -- the glyph bare and large over the
        // name and its state, the cell's own sizes (hk-base.js TILE.centred)
        var centred = this.getAttribute('tile') === 'centred';
        var key = JSON.stringify([p.tiles, p.more, p.size, !!p.scroll, centred]);
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
            if (p.size !== 'W') slot.setAttribute('size', 'S');
            slot.setAttribute('role', 'listitem');
            var el = C.createCard(p.size === 'W' ? t : Object.assign({}, t, { size: 'tall' }), h);
            if (p.size !== 'W') el.setAttribute('size', 'S');
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
      }
      _roomPath(area) {
        var M = C.menu;
        try { return M && M.roomPath ? M.roomPath(area) : null; } catch (e) { return null; }
      }
      _openRoom() {
        var path = this._roomPath(this._area());
        if (path) C.navigate(path, this);
      }

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
        if (name === 'tile' && was !== now && this._config && this.client) this.redraw();
      }
      _tile() {
        var cfg = this._config || {}, h = this.client, t;
        if (!cfg.entity) return null;
        if (cfg.kind === 'scene') {
          var scenes = window.hkChip && window.hkChip.scenes;
          t = scenes && scenes.pill ? scenes.pill(h, cfg.entity) : { type: 'custom:hk-scene-card', entity: cfg.entity };
          t = Object.assign({}, t, { elevated: false });
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
        if (this.getAttribute('tile') === 'centred') { delete t.icon_size; delete t.bare_icon; delete t.well_background; }
        if (this.getAttribute('tile') === 'centred' && !chosen) {
          var area = cfg.kind === 'scene' ? null : areaOf(h, cfg.entity), areas = (h && h.areas) || {};
          var room = cfg.kind === 'scene' ? 'Scene' : area && areas[area] && areas[area].name;
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
        if (this.getAttribute('tile') === 'centred') this._child.setAttribute('tile', 'centred');
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
      _plan() {
        var client = this.client, size = this._size(), cfg = this._config;
        var entries = cfg.accessories || [], limit = (COLS[size] || 2) * (size === 'W' ? 1 : 2);
        var tiles = entries.slice(0, limit).map(function (entry) {
          var S = window.hkStrategy, id = entry.entity;
          var t = S && S.tileFor && client ? S.tileFor(client, id, friendly(client, id)) : { type: 'custom:hk-tile-card', entity: id };
          t = Object.assign({}, t, { secondary: entry.secondary });
          if (dom(id) === 'light') t.tap_action = { action: 'toggle' };
          return t;
        });
        return { area: null, size: size, tiles: tiles, more: 0, name: cfg.title || 'Accessories', empty: 'Choose accessories in the editor' };
      }
      _render() {
        super._render();
        this._e.nm.disabled = true;
        this._e.nm.style.cursor = 'default';
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
                      name: '.tx .name', sub: ['.tx .state'] })
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
        // (Centred: the glyph by what is drawn, as the tiles' -- TILE.centred.ink)
        if (this.getAttribute('tile') === 'centred') e.icon.setAttribute('ink', String(C.TILE.centred.ink)); else e.icon.removeAttribute('ink');
        e.icon.style.color = k.color || '';
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

    // Security uses the shared alarm sheet: no arm/disarm command can bypass its PIN.
    class HkGridSecurityCard extends HkGridKey {
      static get CSS() { return KEY_CSS + ':host([size=W]) .k{position:relative;padding-right:236px}' +
        '.security-extra{position:absolute;right:calc(12.8px + var(--hk-in-r,0px));top:calc(12.8px + var(--hk-in-t,0px));bottom:calc(12.8px + var(--hk-in-b,0px));width:210px;display:flex;flex-direction:column;justify-content:space-between;gap:6px}' +
        '.security-extra p{margin:0;' + type('caption') + ';color:' + v('ink-2') + ';line-height:18px}' +
        '.security-extra button{border:0;min-height:44px;min-width:44px;border-radius:22px;background:' + v('key') + ';color:' + v('ink') + ';' + type('caption') + ';cursor:pointer}' +
        '.security-actions{display:flex;gap:6px}.security-actions button{flex:1}'; }
      _alarm() { return this._config.entity || setting('security.alarm', null) || Object.keys(this.client && this.client.states || {}).find((id) => dom(id) === 'alarm_control_panel'); }
      _look() {
        var st = this.client && this.client.states && this.client.states[this._alarm()], state = st && st.state || 'unavailable';
        var words = { disarmed: 'Disarmed', armed_home: 'Armed Home', armed_away: 'Armed Away', armed_night: 'Armed Night',
          armed_vacation: 'Armed Vacation', triggered: 'Triggered', pending: 'Pending', arming: 'Arming', disarming: 'Disarming', unavailable: 'Unavailable', unknown: 'Unknown' };
        return { name: 'Security', icon: state === 'disarmed' ? 'hk:shield-off' : 'hk:shield-lock',
          state: words[state] || 'Armed', color: /^armed|triggered|pending/.test(state) ? (state === 'triggered' ? v('fail') : C.PALETTE.icon.green) : null };
      }
      _tap() { var id = this._alarm(); if (id) window.hkShell.moreInfo(id, this); }
      _sigOf() { return JSON.stringify([this._look(), this._summary(), sizeOf(this)]); }
      _summary() {
        var states = this.client && this.client.states || {}, locks = kind('locks') || own(this.client, 'lock');
        var n = locks.filter((id) => states[id] && states[id].state === 'locked').length;
        var entries = ['doors', 'windows'].flatMap((k) => kind(k) || Object.keys(states).filter((id) => dom(id) === 'binary_sensor' && attr(states[id], 'device_class') === (k === 'doors' ? 'door' : 'window')))
          .filter((id) => states[id]);
        var opened = entries.filter((id) => states[id].state === 'on');
        // (a house without door or window sensors says nothing about them)
        return [locks.length ? plural(n, 'Lock Locked', 'Locks Locked') : '',
                opened.length ? plural(opened.length, 'Entry Open', 'Entries Open') : entries.length ? 'Entries Closed' : ''].filter(Boolean).join(' · ');
      }
      _render() {
        super._render();
        var old = this._e.card.querySelector('.security-extra'); if (old) old.remove();
        this._e.card.setAttribute('role', sizeOf(this) === 'W' ? 'group' : 'button');
        if (sizeOf(this) === 'W') this._e.card.removeAttribute('tabindex'); else this._e.card.setAttribute('tabindex', '0');
        if (sizeOf(this) !== 'W') return;
        var extra = document.createElement('div'); extra.className = 'security-extra';
        var text = document.createElement('p'); text.textContent = this._summary(); extra.appendChild(text);
        var actions = document.createElement('div'); actions.className = 'security-actions';
        ['Home', 'Away', 'Disarm'].forEach((name) => {
          var button = document.createElement('button'); button.textContent = name; button.setAttribute('aria-label', name + ' — open alarm controls');
          button.addEventListener('click', (e) => { e.stopPropagation(); this._tap(); }); actions.appendChild(button);
        });
        extra.appendChild(actions); this._e.card.appendChild(extra);
        // The plate's keyboard action remains on the tile, not its nested controls.
        if (!this._securityKeys) { this._securityKeys = true; this._e.card.addEventListener('keydown', (e) => { if (e.target !== this._e.card) e.stopPropagation(); }, { capture: true }); }
      }
    }
    watchSize(HkGridSecurityCard);
    C.register('hk-grid-security-card', HkGridSecurityCard, 'HK Grid Security', 'Alarm status and shared PIN controls.', [{ name: 'entity', label: 'Alarm', selector: { entity: { filter: { domain: 'alarm_control_panel' } } } }], function () { return {}; });

    // ===================================================== the full-control blocks
    // (2026-10-24, the owner: "the detail sheets that are useful as blocks"):
    // a Large or Extra Large Security block is the alarm's keypad, a Large or
    // Extra Large Vacuum block its controls with Clean Areas -- the Security
    // and Vacuum pages' own cards, each in a block-sized plate.
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
        var el = C.createCard(cfg, this.client);
        if (size) el.setAttribute('size', size);
        parent.appendChild(el);
        (this._kids = this._kids || []).push(el);
        return el;
      }
    }
    // THE KEYPAD: the alarm's own keys, side by side (hk-security.js
    // layout: 'side'), the keys sized to the block; the PIN is checked as it
    // always is, by the alarm, never here
    class HkGridKeypadCard extends HkGridFull {
      // the alarm: the block's, else the home's, else the first (as the small Security block finds it)
      _alarm() {
        return this._config.entity || setting('security.alarm', null) ||
          Object.keys((this.client && this.client.states) || {}).filter(function (id) { return dom(id) === 'alarm_control_panel'; })[0] || null;
      }
      _sigOf() { return JSON.stringify([this._alarm(), sizeOf(this), this._blockKey || '']); }
      _render() {
        this._watchBlock();
        var alarm = this._alarm();
        if (!this._built || this._for !== alarm) {
          this._root.innerHTML = '<hk-plate class="full" data-hk-role="card"><div class="body"></div></hk-plate>';
          this._kids = []; this._for = alarm;
          this._pad = this._mount(this._root.querySelector('.body'),
            Object.assign({ type: 'custom:hk-alarm-keypad-card', layout: 'side', glass: false }, alarm ? { entity: alarm } : {}));
          this._built = true;
        }
        // four rows of keys and their three gaps fill the block's height (to
        // 88 px a key: square cells are taller than tiles, and at 64 the
        // Extra Large block left a band of nothing under its keys, 2026-10-30)
        var b = this._block(), h = b ? b.h - 28 : 282;
        this._pad.style.setProperty('--hk-kp-key', Math.max(36, Math.min(88, Math.floor((h - 30) / 4))) + 'px');
      }
    }
    watchSize(HkGridKeypadCard);
    C.register('hk-grid-keypad-card', HkGridKeypadCard, 'HK Grid Keypad', 'The alarm keypad, sized to a Home Grid block.',
      [{ name: 'entity', label: 'Alarm', selector: { entity: { filter: { domain: 'alarm_control_panel' } } } }], function () { return {}; });
    // THE VACUUM: its card (status, Start, Pause, Locate, Dock) over Clean
    // Areas when the home has them (as the Vacuums page does: hk-strategy.js),
    // else its card fills the block
    class HkGridVacuumFull extends HkGridFull {
      _picker() {
        var HS = window.hkSettings, added = (HS && HS.get && HS.get('added', [])) || [];
        return added.indexOf('clean_areas') >= 0 || !!(HS && HS.get && HS.get('features.vacuum_script', null));
      }
      _sigOf() { return JSON.stringify([this._config.entity || null, sizeOf(this), this._picker()]); }
      _render() {
        var picker = this._picker(), key = JSON.stringify([this._config.entity, picker]);
        if (this._built && this._key === key) return;
        this._key = key; this._kids = [];
        if (!picker) {
          // (the whole block's height: .body's flex:1 needs a flex parent, and here it has none -- the card sat at
          // its own 150 px at the top of an empty block, 2026-10-30)
          this._root.innerHTML = '<div class="body" style="height:100%"></div>';
          this._mount(this._root.querySelector('.body'), { type: 'custom:hk-vacuum-card', entity: this._config.entity }, 'L');
        } else {
          // the vacuum's own plate, then Clean Areas in a plate of its own
          // (Clean Areas is a panel of its own, its plate and its words)
          this._root.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;height:100%">' +
            '<div class="top" style="flex:0 0 150px"></div><div class="areas"></div></div>';
          this._mount(this._root.querySelector('.top'), { type: 'custom:hk-vacuum-card', entity: this._config.entity }, 'W');
          this._mount(this._root.querySelector('.areas'), { type: 'custom:hk-area-select-card', layout: 'panel' }).setAttribute('data-fill', '');
        }
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
        var M = window.hkMusic, sp = M && M.speakers ? M.speakers() : [];
        return sp && sp.length ? [{ cfg: { type: 'custom:hk-speaker-picker-card' }, cls: 'plated' }] : null;
      }
      if (kind === 'doors') {
        var S = window.hkStrategy, inv = null;
        try { inv = S && S.inventory ? S.inventory(client, hidesOf()) : null; } catch (e) { inv = null; }
        if (!inv || !(inv.locks.length + inv.doors.length + inv.windows.length + inv.garage.length)) return null;
        // S, W and T (2026-10-31, the widget mock-up): how many are open, large;
        // Wide the count beside the list, Tall the list -- the doors, the
        // garage and the windows, the open ones first (the locks are Security's)
        if (size === 'S' || size === 'W' || size === 'T') {
          return inv.doors.length + inv.windows.length + inv.garage.length
            ? [{ own: 'doors', doors: inv.doors, windows: inv.windows, garage: inv.garage }] : null;
        }
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
        return (setting('added', []) || []).indexOf('live_tv') >= 0 ? [{ cfg: { type: 'custom:hk-tv-guide-card' }, cls: 'plated' }] : null;
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
      '.rd .seg button{flex:1 1 0}' +
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
    function fitRows(items, room, row) {
      var n = Math.max(1, Math.floor(room / 36));
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
        var open = list.filter(function (x) { return x.open; }), name = function (x) { return attr(x.st, 'friendly_name') || x.id; };
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
        return lab + big + '<div class="wr" style="margin-top:6px">' + fitRows(list, box.ih - 19 - 33 - 6, row) + '</div>';
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
          var leak = wet.length ? '<span style="color:' + ACC.red + '">Leak: ' + esc(attr(h.states[wet[0]], 'friendly_name') || wet[0]) + '</span>'
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
    var YELLOW = (C.PALETTE.icon && C.PALETTE.icon.yellow) || null;
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
        return JSON.stringify([p.name, p.icon, p.state, p.hot, this._said || null]);
      }
      _look() {
        var p = this._plan(), a = this._config.action;
        var color = !p.hot ? null : a === 'lights_off' ? YELLOW : a === 'lock_up' || a === 'garage' ? v('warn') : null;
        return { name: p.name, icon: p.icon, state: p.state, color: color };
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
         helper: 'All Lights Off in this room only. Leave empty for the whole home.' }],
      function () { return { action: 'lock_up' }; });

    // ===================================================== hk-everything-card
    class HkEverythingCard extends HkGridKey {
      _sigOf() { return JSON.stringify([menuCounts(), C.menu && C.menu.sig ? C.menu.sig() : '']); }
      _look() {
        var n = menuCounts();
        var state = !n ? 'Pages and Rooms'
          : [n.pages ? plural(n.pages, 'Page', 'Pages') : '', n.rooms ? plural(n.rooms, 'Room', 'Rooms') : '']
              .filter(Boolean).join(' · ') || 'Pages and Rooms';
        // the menu button's own glyph (the screen's: lines or the sidebar)
        var icon = 'hk:menu';
        try { if (C.menu && C.menu.icon) icon = C.menu.icon() || icon; } catch (e) { /* hk:menu */ }
        return { name: 'Everything', icon: icon, state: state, color: null };
      }
      // THE SCREEN'S OWN NAVIGATION, never a second menu: with the tab bar
      // showing, its More sheet (what the bar's menu opens); else the side
      // menu, as the menu button opens it
      _tap() {
        var M = C.menu, B = window.hkTabBar;
        if (M && M.tabBar && M.tabBar() && B && typeof B.open === 'function') { B.open('more'); return; }
        if (M && M.open) M.open();
      }
    }
    C.register('hk-everything-card', HkEverythingCard, 'HK Everything',
      'Opens the menu: every page and room of the screen. For a Home Grid screen without its tab bar.',
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
    function onNow(client) {
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
          var a = areaOf(client, id), room = a && areas[a] ? areas[a].name : '', full = attr(st[id], 'friendly_name') || id;
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
      _sigOf() {
        var o = onNow(this.client), st = (this.client && this.client.states) || {};
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
        var size = sizeOf(this) || 'L', box = inner(this, size), o = onNow(this.client);
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
        var o = onNow(this.client), self = this;
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
    window.hkGridCards._.onNow = onNow;
  });
})();
