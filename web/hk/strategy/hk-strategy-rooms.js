// hk-strategy-rooms.js - the room pages.
//
// PART OF THE DASHBOARD STRATEGY (hk-strategy.js). Not a card and not run on its own: it registers one
// function, which hk-strategy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkStrategyParts = window.hkStrategyParts || {})['hk-strategy-rooms'] = function (K) {
    var accName = K.accName, accOf = K.accOf, areaOf = K.areaOf, byArea = K.byArea, COL2 = K.COL2, fold = K.fold,
        heading = K.heading, hidden = K.hidden, hideOf = K.hideOf, INTO = K.INTO, nameOf = K.nameOf, ORDER = K.ORDER,
        pillGrid = K.pillGrid, PR = K.PR, roomOrder = K.roomOrder, setting = K.setting, shortName = K.shortName,
        tileFor = K.tileFor, titleBar = K.titleBar;

    function rooms(client, opts) {
      var areas = client.areas || {}, floors = client.floors || {};
      var hide = hideOf(opts), sorted = byArea(client, opts);
      var by = sorted.by, more = sorted.more;
      var list = Object.keys(by);
      if (Array.isArray(opts.areas) && opts.areas.length) {
        list = opts.areas.filter(function (a) { return by[a]; });
      } else {
        var level = function (a) {
          var f = areas[a].floor_id && floors[areas[a].floor_id];
          return (f && typeof f.level === 'number') ? f.level : 1e6;
        };
        list.sort(function (x, y) {
          return (level(x) - level(y)) || String(areas[x].name).localeCompare(String(areas[y].name));
        });
      }
      var rank = function (id) {
        var i = ORDER.indexOf(id.split('.')[0]);
        return i < 0 ? ORDER.length : i;              // added kinds after the built-in ones
      };
      // BY THE NAME THE TILE SHOWS (named: the accessory's own, else the room
      // dropped), so a renamed accessory takes its new place, as on its page
      var sortIds = function (ids, area) {
        var key = {};
        ids.forEach(function (x) { key[x] = named(client, x, area || ''); });
        return ids.slice().sort(function (x, y) {
          return (rank(x) - rank(y)) || key[x].localeCompare(key[y]);
        });
      };
      // A ROOM'S OWN ORDER (the accessories' room order): the ones it lists,
      // in its order, then the rest as usual.
      // A room shown inside it (the accessories' `into`) brings its own order
      // along, after the room's -- or the Deck's lights would stay in the
      // Backyard's automatic order.
      var inOrder = function (a, ids, inside) {
        var own = null;
        [a].concat(inside || []).forEach(function (r) {
          var o = roomOrder(r);
          if (o) own = (own || []).concat(o.filter(function (x) { return !own || own.indexOf(x) < 0; }));
        });
        if (!own) return sortIds(ids, areas[a].name);
        var rankOf = {};
        own.forEach(function (x, i) { rankOf[x] = i; });
        var listed = ids.filter(function (x) { return x in rankOf; })
                        .sort(function (x, y) { return rankOf[x] - rankOf[y]; });
        return listed.concat(sortIds(ids.filter(function (x) { return !(x in rankOf); }), areas[a].name));
      };
      var out = list.filter(function (a) { return !hide.areas[a]; }).map(function (a) {
        var inside = Object.keys(INTO()).filter(function (x) { return INTO()[x] === a; });
        return { id: a, name: areas[a].name, entities: inOrder(a, by[a], inside), areas: [a].concat(inside) };
      });
      if (more.length) out.push({ id: '', name: 'More', entities: sortIds(more) });
      return out;
    }

    // THE NAME A TILE SHOWS: the accessory's own (its gear), else the entity's
    // with the room's name dropped ("Kitchen Table Light" -> "Table Light").
    function named(client, id, area) {
      return accName(id) || shortName(nameOf(client, id, (client.entities || {})[id]), area);
    }
    function roomSection(client, room) {
      // "Show in Home" off (the accessory's gear): not on Home -- its room's
      // page and the category pages still list it, as the Home app does.
      var tiles = room.entities.filter(function (id) {
        var a = accOf(id);
        return !(a && a.home === false);
      }).map(function (id) {
        return placed(tileFor(client, id, named(client, id, room.name)), room.id ? { area: room.id } : null);
      }).filter(Boolean);
      var head = heading(room.name);
      if (room.id) head.area = room.id;         // "Living Room ›" when it has a page
      return { type: 'grid', columns: 1, square: false, view_layout: COL2,
               cards: [head, { type: 'custom:hk-grid-card', layout: pillGrid(19), cards: tiles }] };
    }

    // WHERE A TILE LIVES, for Arrange in its sheet's settings (hk-detail.js,
    // 2026-10-01): a room section on Home ({area}), a group on a room page
    // ({area, group}) or the Favorites ({fav: true}). The order it moves in
    // is the room's Tile Order (accessories `rooms`) or the screen's
    // favorites. A category page's tile says its place too, with its `page`
    // (catPlace, for Edit mode), and has no Arrange in its sheet.
    function placed(t, place) {
      if (t && place) t.hk_place = place;
      return t;
    }

    // ------------------------------------------------------------ room pages
    // A ROOM PAGE, the Home app's: the room's name under a back button, its
    // status row, its cameras, then its devices grouped as the Home app groups
    // them -- Climate, Lights, Speakers & TVs, Security, Water, Other. Lights
    // run A to Z (as the Home app lists them); every other group keeps the
    // room's own order. `areas` may be several (a backyard and its deck).
    var GROUPS = ['Climate', 'Lights', 'Speakers & TVs', 'Security', 'Water', 'Other'];
    var DOORS = { garage: 1, gate: 1, door: 1 };
    function groupOf(client, id) {
      var d = id.split('.')[0], st = client.states[id];
      var dc = st && st.attributes && st.attributes.device_class;
      if (d === 'valve' || d === 'water_heater') return 'Water';
      if (d === 'fan' || d === 'climate' || d === 'humidifier' || (d === 'cover' && !DOORS[dc])) return 'Climate';
      if (d === 'light') return 'Lights';
      if (d === 'media_player') return 'Speakers & TVs';
      if (d === 'lock' || d === 'alarm_control_panel' || d === 'cover') return 'Security';
      return 'Other';
    }
    function roomCameras(client, areas, opts) {
      var want = {};
      areas.forEach(function (a) { want[a] = true; });
      return houseCameras(client, opts, function (id) { return want[areaOf(client, id)]; });
    }

    // THE HOUSE'S CAMERAS, ONE TILE PER CAMERA. A UniFi Protect
    // camera offers the same picture as three camera entities -- its high,
    // medium and low resolution channels -- so a room page listing every
    // camera entity in the area would give a front yard 14 tiles for 5
    // cameras. And two kinds of "camera" are not the house's at all: a wall
    // tablet's own (Fully Kiosk's front camera; Kiosk Satellite's Camera and
    // Screenshot) and Live TV's channels (the Live TV page).
    //
    // One per DEVICE, picked in this order: the one this screen lists for its
    // strip, one any screen lists, a low-resolution channel (a still refreshes
    // faster from it), then A to Z. The
    // screen's own list also sets the order; the rest follow A to Z.
    // not the house's cameras: a wall tablet's own, and Live TV's channels
    // (HK Frontend's only cameras; hk_tv before 1.0), and those the host names
    // (hkShell.notHouseCameraPlatforms: its own integration's Live TV channels)
    var NOT_HOUSE_CAMERAS = { fully_kiosk: 1, hk_frontend: 1, hk_tv: 1 };
    // A KIOSK SATELLITE TABLET'S CAMERAS come through ESPHome, the platform an
    // ESP32 camera on the porch uses too -- so it is the DEVICE that tells them
    // apart: Kiosk Satellite registers itself with manufacturer
    // `kiosk_satellite`. Never the platform alone.
    function notHouseCamera(client, e) {
      if (NOT_HOUSE_CAMERAS[e.platform]) return true;
      var sh = window.hkShell, more = sh && typeof sh.notHouseCameraPlatforms === 'function' && sh.notHouseCameraPlatforms();
      if (e.platform && Array.isArray(more) && more.indexOf(e.platform) >= 0) return true;
      var d = e.device_id && (client.devices || {})[e.device_id];
      return !!d && d.manufacturer === 'kiosk_satellite';
    }
    function houseCameras(client, opts, pred) {
      var ents = client.entities || {};
      var mine = listOf((opts && opts.board) || {}, 'cameras');
      var anyList = {}, boards = setting('boards') || {};
      Object.keys(boards).forEach(function (k) {
        listOf(boards[k] || {}, 'cameras').forEach(function (id) { anyList[id] = true; });
      });
      var byDev = {}, devs = [];
      shown(client, opts, 'camera').forEach(function (id) {
        var e = ents[id] || {};
        if (notHouseCamera(client, e) || (pred && !pred(id))) return;
        var d = e.device_id || id;
        if (!byDev[d]) { byDev[d] = []; devs.push(d); }
        byDev[d].push(id);
      });
      function score(id) {
        var i = mine.indexOf(id);
        if (i >= 0) return i;
        if (anyList[id]) return 1000;
        return /low/.test(id) ? 2000 : 3000;
      }
      var picked = devs.map(function (d) {
        return byDev[d].slice().sort(function (a, b) { return score(a) - score(b) || (a < b ? -1 : 1); })[0];
      });
      return picked.sort(function (a, b) {
        var x = mine.indexOf(a), y = mine.indexOf(b);
        if (x < 0) x = Infinity;
        if (y < 0) y = Infinity;
        return x - y || (a < b ? -1 : a > b ? 1 : 0);
      });
    }
    function roomCards(client, areas, name, opts) {
      areas = [].concat(areas || []).filter(Boolean);
      var ents = client.entities || {}, seen = {}, groups = {};
      rooms(client, Object.assign({}, opts, { areas: areas })).forEach(function (r) {
        if (!r.id) return;                        // "More" is not a room
        r.entities.forEach(function (id) {
          if (seen[id]) return;
          // HIDDEN FROM ITS ROOM PAGE only (Hidden Accessories, `room: false`):
          // still on Home and the category pages
          var acc = accOf(id);
          if (acc && acc.room === false) return;
          seen[id] = true;
          var g = groupOf(client, id);
          (groups[g] = groups[g] || []).push(placed(tileFor(client, id, named(client, id, name)), { area: areas[0], group: g }));
        });
      });
      // Lights A to Z -- unless the room has an order of its own (the gear)
      var ordered = areas.some(function (a) { return roomOrder(a); });
      if (groups.Lights && !ordered) {
        groups.Lights.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      }
      // the status row counts the accessories ON THIS PAGE (hk-room.js
      // `entities`), and its sensors less what this dashboard leaves out --
      // its own YAML's exclusions (the house's Hidden from Screens the card
      // reads live as well)
      var status = { type: 'custom:hk-room-status-card', area: areas.length === 1 ? areas[0] : areas,
                     entities: Object.keys(seen), view_layout: COL2 };
      ['exclude_entities', 'exclude_devices', 'exclude_areas'].forEach(function (k) {
        var l = ((opts || {})[k] || []);
        if (l.length) status[k] = l.slice();
      });
      var cards = [titleBar(name), status];
      // THE CAMERAS AS SNAPSHOTS: stills that refresh, never a live stream --
      // in the camera strip's pattern (below), in a row that scrolls sideways
      // when it is wider than the page. A tap opens the camera, live.
      var cams = roomCameras(client, areas, opts);
      if (cams.length) {
        cards.push({ type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [heading('Cameras'),
          // the row reaches out by the tiles' shadow and pads it back inside,
          // as the scenes row does (a scroller clips at its own edge); 26 at the
          // sides lines the first camera up with the tiles, which sit 4 px in
          // THE ROOM'S CAMERAS AS A STRIP (2026-10-09), Home's camera strip
          // with no live tile: one tall, then two stacked, and so on, as the Home
          // app draws a room. Stills only -- a tap opens the camera, live --
          // and the room's own cameras, not the screen's Home strip list.
          // The row pads 14/30 for the strip's shadow; the margins give back
          // all but 6 above and 20 below, so the strip sits from its heading
          // and from the next one as a row of tiles does.
          { type: 'custom:hk-row-card', card_width: 'fit-content', pad_top: 14, pad_bottom: 30,
            pad_left: 26, pad_right: 26, margin: '-8px -22px -10px -22px',
            cards: [{ type: 'custom:hk-camera-mosaic-card', height: 195, seam: 2, snapshot_cap: '480x270',
                      max_upscale: 1.2, show_age: true, stills_only: true, own_cameras: true,
                      cameras: cams.map(function (id) { return { entity: id, name: fullName(client, id) }; }) }] }] });
      }
      // THE ROOM'S SCENES (2026-10-01): a row of scene pills under the status
      // row -- under the cameras when it has some -- that scrolls sideways, as
      // Home's does (hk-scenes-card in room mode). Each room's own (HK Settings
      // -> Accessories -> the room -> Scenes): its own list, none, or
      // Automatic -- the Home Assistant scenes in the room.
      var scenes = roomScenes(client, areas, opts);
      if (scenes.length) cards.push({ type: 'custom:hk-scenes-card', room: true, scenes: scenes, view_layout: COL2 });
      GROUPS.forEach(function (g) { if (groups[g]) cards.push(section(g, groups[g])); });
      return cards;
    }
    // A ROOM'S SCENES: the lists its areas have of their own (the Deck's after
    // the Backyard's), else every shown scene in them, A to Z -- HA's and what
    // Accessories -> Scenes counts as one. An empty list is a room with no row.
    function roomScenes(client, areas, opts) {
      var A = setting('accessories'), own = (A && A.scenes && typeof A.scenes === 'object') ? A.scenes : {};
      var mine = areas.filter(function (a) { return Array.isArray(own[a]); });
      if (mine.length) {
        var out = [];
        mine.forEach(function (a) {
          own[a].forEach(function (id) { if (out.indexOf(id) < 0 && client.states[id] && !hidden(client, opts, id)) out.push(id); });
        });
        return out;
      }
      var want = {}, st = client.states, ents = client.entities || {}, HC = window.hkCards;
      areas.forEach(function (a) { want[a] = true; });
      return (HC && HC.sceneIds ? HC.sceneIds(client) : shown(client, opts, 'scene', null)).filter(function (id) {
        var e = ents[id] || {}; return want[areaOf(client, id)] && !e.hidden && !e.entity_category && !hidden(client, opts, id); })
        .sort(function (x, y) {
          return String(st[x].attributes.friendly_name || x).localeCompare(String(st[y].attributes.friendly_name || y));
        });
    }
    function slug(v) {
      return String(v || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function firstOf(client, domain) {
      return Object.keys(client.states).filter(function (k) { return k.indexOf(domain + '.') === 0; }).sort()[0] || null;
    }
    // THE THEME a generated view wears: HK Kiosk when it is loaded, else the
    // house's default
    function kioskTheme(themes) {
      return themes && themes['HK Kiosk'] ? 'HK Kiosk' : undefined;
    }
    // a feature of HK Frontend added and set up (the settings feed's `added`)
    function added(kind) {
      var a = setting('added');
      return Array.isArray(a) && a.indexOf(kind) >= 0;
    }
    // THE HOUSE BATTERY the Energy feature names (its plan's power.battery),
    // for a Home Grid's `battery` block; null without one
    function houseBattery() {
      var P = added('energy') ? setting('energy') : null, B = P && P.power && P.power.battery;
      return B && typeof B === 'object' && B.level ? B : null;
    }

    // Every shown entity of a domain (same rules as the rooms: not hidden, not a
    // config/diagnostic entity, has a state), optionally filtered, sorted by id.
    // The house's entity ids by domain, once per build (as byArea): shown() is
    // asked for a dozen domains and each call walked every state.
    function idsOf(client, opts, domain) {
      var build = opts && opts.__build, idx = build && build.client === client ? build.domains : null;
      if (!idx) {
        idx = {};
        Object.keys(client.states).forEach(function (id) {
          var d = id.split('.')[0];
          (idx[d] = idx[d] || []).push(id);
        });
        if (build) { build.domains = idx; build.client = client; }
      }
      return idx[domain] || [];
    }
    function shown(client, opts, domain, pred) {
      var ents = client.entities || {};
      return idsOf(client, opts, domain).filter(function (id) {
        var e = ents[id] || {};
        if (e.hidden || e.entity_category || hidden(client, opts, id) || PR().folded(client, id, hidden.bind(null, client, opts))) return false;
        return !pred || pred(client.states[id]);
      }).sort();
    }
    function dc(st) { return st && st.attributes && st.attributes.device_class; }

    // A sensor on the same DEVICE with this device_class -- a vacuum's battery.
    function sibling(client, id, deviceClass) {
      var ents = client.entities || {}, dev = ents[id] && ents[id].device_id;
      if (!dev) return null;
      var hit = Object.keys(ents).filter(function (k) {
        return k !== id && ents[k].device_id === dev && k.indexOf('sensor.') === 0 &&
               dc(client.states[k]) === deviceClass;
      }).sort();
      return hit[0] || null;
    }

    // A sensor on the same device whose entity id matches -- a vacuum's
    // current room, its cleaning progress, its dock error.
    function siblingLike(client, id, re, not) {
      var ents = client.entities || {}, dev = ents[id] && ents[id].device_id;
      if (!dev) return null;
      return Object.keys(ents).filter(function (k) {
        return k !== id && ents[k].device_id === dev && k.indexOf('sensor.') === 0 && client.states[k] &&
               re.test(k) && !(not && not.test(k));
      }).sort()[0] || null;
    }
    function friendly(client, id, area) {
      var ents = client.entities || {}, areas = client.areas || {}, devs = client.devices || {};
      var e = ents[id] || {};
      var a = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
      return accName(id) || shortName(nameOf(client, id, e), area || (a && areas[a] && areas[a].name));
    }

    // ------------------------------------------------------------ the chips
    // hk-chips-card (hk-chip.js): the kinds from Status & Chips, in this
    // dashboard's order.

    // ------------------------------------------------------- category pages
    function section(name, tiles, three) {
      return { type: 'grid', columns: 1, square: false, view_layout: COL2,
               cards: [heading(name), { type: 'custom:hk-grid-card', layout: pillGrid(19, three), cards: tiles }] };
    }
    // Pages that MIX rooms (doors, locks, thermostats, timers) keep the full
    // name: under no room heading, "Door" twice says nothing.
    // THE NAME ON A PAGE THAT MIXES ROOMS (Security, Doors & Windows, Climate):
    // the entity's full name -- or the accessory's, which is room-relative the
    // way a room's tiles are ("Lock"), so the room goes in front unless it is
    // already there ("Crawl Space Lock", "Front Door Lock").
    function fullName(client, id) {
      var own = accName(id);
      if (!own) return nameOf(client, id, (client.entities || {})[id]);
      var room = areaName(client, id);
      return room && fold(own).indexOf(fold(room)) < 0 ? room + ' ' + own : own;
    }
    function listOf(b, k) { return Array.isArray(b[k]) ? b[k] : []; }
    // FAVORITES: the tiles the item picked, as the Home app's Favorites draws
    // them -- one height, the ROOM above the name (hk-favorite-card) -- in the
    // favorite shapes: a lock says
    // "Locked", a garage door "Closed", a thermostat its reading and setpoint.
    function areaName(client, id) {
      var ents = client.entities || {}, devs = client.devices || {}, areas = client.areas || {};
      var e = ents[id] || {};
      var a = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
      return (a && areas[a] && areas[a].name) || '';
    }

    // what the shell and the later parts use of this one
    K.added = added; K.areaName = areaName; K.dc = dc; K.firstOf = firstOf; K.friendly = friendly;
    K.fullName = fullName; K.groupOf = groupOf; K.houseBattery = houseBattery; K.houseCameras = houseCameras;
    K.kioskTheme = kioskTheme; K.listOf = listOf; K.named = named; K.notHouseCamera = notHouseCamera;
    K.placed = placed; K.roomCards = roomCards; K.rooms = rooms; K.roomSection = roomSection; K.section = section;
    K.shown = shown; K.sibling = sibling; K.siblingLike = siblingLike; K.slug = slug;
  };
})();
