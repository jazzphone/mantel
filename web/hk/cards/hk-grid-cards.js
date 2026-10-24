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
    try { cards = S.roomCards(client, [area], room.name || area) || []; } catch (e) { cards = []; }
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

  window.hkGridCards = { version: '1.0.0',
    _: { roomOf: roomOf, roomParts: roomParts, fit: fit, layout: layout, percent: percent,
         dims: dims, dragged: dragged, dimCall: dimCall, suggestion: suggestion, holds: holds, minutes: minutes,
         houseMinutes: houseMinutes, plan: plan, menuCounts: menuCounts, DEFAULT_WINDOWS: DEFAULT_WINDOWS,
         HOLD_MS: HOLD_MS } };

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
    function watchSize(Ctor) {
      Object.defineProperty(Ctor, 'observedAttributes', { get: function () { return ['size']; } });
      Ctor.prototype.attributeChangedCallback = function () { if (this._config) { this._built = false; this.redraw(); } };
    }

    // ===================================================== hk-grid-room-card
    var ROOM_CSS = [
      ':host{display:block;height:100%;position:relative}',
      '.room{box-sizing:border-box;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:14px;gap:10px;' + C.plate('card') + ';',
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
      '.room[size=W]{padding:8px 12px;gap:6px}.room[size=W] .hd{height:22px}.room[size=W] .tiles{padding-bottom:0}',
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
        e.tiles.style.setProperty('--cols', String(COLS[p.size]));
        e.tiles.style.setProperty('--rows', p.size === 'W' ? '1' : '2');
        e.tiles.style.setProperty('--scroll-gaps', p.size === 'W' ? '0px' : GAP + 'px');
        e.tiles.classList.toggle('scrolling', !!p.scroll);
        if (e.name.textContent !== (p.name || 'Room')) e.name.textContent = p.name || 'Room';
        var path = this._roomPath(p.area);
        e.chev.style.display = path ? '' : 'none';
        e.nm.setAttribute('aria-label', (p.name || 'Room') + (path ? ', open the room' : ''));
        // the pills: made again only when what they are changes
        var key = JSON.stringify([p.tiles, p.more, p.size, !!p.scroll]);
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
      static get observedAttributes() { return ['size', 'data-grid-pager']; }
      attributeChangedCallback() { this._sizeChild(); }
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
      '  padding:12.8px 12.8px 12.8px ' + TILE.padL + 'px;cursor:pointer;overflow:hidden;' + C.plate('tile') + ';',
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
      '@media (prefers-reduced-motion:reduce){hk-plate.k,hk-plate.k:active{transition:none;transform:none}}'
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
        '.security-extra{position:absolute;right:14px;top:14px;bottom:14px;width:210px;display:flex;flex-direction:column;justify-content:space-between;gap:6px}' +
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
      'hk-plate.full{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:14px;overflow:hidden;' + C.plate('card') + '}' +
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
        // four rows of keys and their three gaps fill the block's height
        var b = this._block(), h = b ? b.h - 28 : 282;
        this._pad.style.setProperty('--hk-kp-key', Math.max(36, Math.min(64, Math.floor((h - 30) / 4))) + 'px');
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
          this._root.innerHTML = '<div class="body"></div>';
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
      '  padding:' + C.CARD.pad + ';cursor:pointer;overflow:hidden;' + C.plate('card') + ';',
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
  });
})();
