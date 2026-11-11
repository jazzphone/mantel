// hk-strategy-pages.js - what exists, the category pages and Favorites.
//
// PART OF THE DASHBOARD STRATEGY (hk-strategy.js). Not a card and not run on its own: it registers one
// function, which hk-strategy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkStrategyParts = window.hkStrategyParts || {})['hk-strategy-pages'] = function (K) {
    var accIcon = K.accIcon, accName = K.accName, accOf = K.accOf, added = K.added, areaName = K.areaName,
        areaOf = K.areaOf, COL2 = K.COL2, column = K.column, dashSeg = K.dashSeg, dc = K.dc, FAV_PX = K.FAV_PX,
        firstOf = K.firstOf, friendly = K.friendly, fullName = K.fullName, heading = K.heading, hidden = K.hidden,
        houseCameras = K.houseCameras, listOf = K.listOf, membersOf = K.membersOf, named = K.named, nameOf = K.nameOf,
        pillGrid = K.pillGrid, placed = K.placed, PR = K.PR, rooms = K.rooms, section = K.section,
        setting = K.setting, shortName = K.shortName, shown = K.shown, sibling = K.sibling,
        siblingLike = K.siblingLike, sized = K.sized, tileFor = K.tileFor, titleBar = K.titleBar, TL = K.TL;

    // --------------------------------------------------------- what exists
    // One pass over the house, shared by the chips, the pages and the header.
    //
    // STATUS & CHIPS FIRST (kinds.py): the integration resolves each
    // kind for the whole house -- the chips read the same lists -- and this
    // keeps the ones this dashboard shows (its own YAML may leave out more).
    // Before the integration has answered, the rules below.
    function inventory(client, opts) {
      var K = setting('kinds') || {};
      if (K && typeof K === 'object' && Object.keys(K).length) {
        var mine = function (kind) {
          return (Array.isArray(K[kind]) ? K[kind] : []).filter(function (id) {
            return client.states[id] && !hidden(client, opts, id) && !PR().folded(client, id, hidden.bind(null, client, opts));
          });
        };
        var gar = mine('garage');
        return { lights: mine('lights'), climates: mine('thermostats'), fans: mine('fans'),
                 blinds: mine('blinds'), locks: mine('locks'), doors: mine('doors'), windows: mine('windows'),
                 garage: gar, vacuums: mine('vacuums'), timers: mine('timers'), speakers: mine('speakers'),
                 leaks: mine('leaks'), motion: mine('motion'), occupancy: mine('occupancy'), valves: mine('valves') };
      }
      var sec = window.hkSettings ? window.hkSettings.get('security', {}) : {};
      var has = function (l) { return Array.isArray(l) && l.length; };
      var keep = function (l) { return l.filter(function (id) { return !hidden(client, opts, id); }); };
      var contact = function (kind) {
        return function (st) { return dc(st) === kind; };
      };
      var classes = function (list) {
        return function (st) { return list.indexOf(dc(st)) >= 0; };
      };
      return {
        leaks: shown(client, opts, 'binary_sensor', contact('moisture')),
        motion: shown(client, opts, 'binary_sensor', classes(['motion', 'moving'])),
        occupancy: shown(client, opts, 'binary_sensor', classes(['occupancy', 'presence'])),
        // a water valve (the Water page's), not a gas one
        valves: shown(client, opts, 'valve', function (st) { return dc(st) !== 'gas'; }),
        lights: shown(client, opts, 'light'),
        climates: (function () {
          var t = window.hkSettings ? window.hkSettings.get('features.thermostats', []) : [];
          return has(t) ? keep(t).filter(function (id) { return client.states[id]; }) : shown(client, opts, 'climate');
        })(),
        fans: shown(client, opts, 'fan'),
        blinds: shown(client, opts, 'cover', function (st) {
          var d = dc(st);
          return d !== 'garage' && d !== 'gate' && d !== 'door';
        }),
        locks: has(sec.locks) ? keep(sec.locks) : shown(client, opts, 'lock'),
        doors: has(sec.doors) ? keep(sec.doors) : shown(client, opts, 'binary_sensor', contact('door')),
        windows: has(sec.windows) ? keep(sec.windows) : shown(client, opts, 'binary_sensor', contact('window')),
        garage: has(sec.garage) ? keep(sec.garage) : shown(client, opts, 'cover', function (st) {
          return dc(st) === 'garage' || dc(st) === 'gate';
        }),
        vacuums: shown(client, opts, 'vacuum'),
        timers: shown(client, opts, 'timer'),
        speakers: shown(client, opts, 'media_player', function (st) { return dc(st) !== 'tv' && dc(st) !== 'receiver'; })
      };
    }

    // ------------------------------------------------------------- the views
    // Climate summaries and their open sheets share these exact lists. The
    // server resolves Status & Chips; before it answers, prefer related sensors
    // and then a room's thermostat, never every temperature sensor in a house.
    //
    // TWO QUESTIONS, kept apart: what the HOUSE has (climateFound -- the build
    // asks it whether there is a Climate page at all) and what the Climate
    // ROW counts (climateMembers -- that, less the rooms the row leaves out,
    // status_rows.climate, read live by the row). A row's exclusions are never
    // a reason for the page to exist or not, so the build reads no status_rows.
    function climateMembers(client, o) {
      var cl = (setting('status_rows') || {}).climate || {};
      return climateFound(client, o, cl.exclude_areas || []);
    }
    function climateFound(client, o, rowAreas) {
      o = o || {};
      var K = setting('kinds') || {}, A = client.areas || {}, st = client.states || {};
      var G = setting('generated') || {};
      var opts = {};
      ['exclude_entities', 'exclude_devices', 'exclude_areas'].forEach(function (k) {
        opts[k] = [].concat(G[k] || [], o[k] || [], k === 'exclude_areas' ? rowAreas || [] : []);
      });
      function visible(id) {
        var e = (client.entities || {})[id] || {}, own = accOf(id) || {};
        return st[id] && !e.hidden && !e.entity_category && !e.disabled_by && own.status !== false &&
          !membersOf(st[id]) && !hidden(client, opts, id);
      }
      function reading(k) {
        if (Array.isArray(K[k])) return K[k].filter(function (id) { return st[id] && !hidden(client, opts, id); });
        var ids = [];
        Object.keys(A).forEach(function (a) {
          if (opts.exclude_areas.indexOf(a) >= 0) return;
          var id = A[a][k + '_entity_id'];
          if (id) { if (visible(id)) ids.push(id); return; }
          // (an unavailable thermostat has lost its current_* attributes: every
          // thermostat reads a temperature, so it stays in that list)
          Object.keys(st).forEach(function (eid) {
            var s = st[eid], off = s.state === 'unavailable' || s.state === 'unknown';
            if (eid.indexOf('climate.') === 0 && areaOf(client, eid) === a && visible(eid) &&
                (('current_' + k) in s.attributes || (off && k === 'temperature'))) ids.push(eid);
          });
        });
        return ids.filter(function (id, i) { return ids.indexOf(id) === i; }).sort();
      }
      function accessories(k, d) {
        if (Array.isArray(K[k])) return K[k].filter(function (id) { return st[id] && !hidden(client, opts, id); });
        return Object.keys(st).filter(function (id) {
          return id.indexOf(d + '.') === 0 && visible(id) && (k !== 'blinds' ||
            ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window', undefined].indexOf(dc(st[id])) >= 0);
        }).sort();
      }
      return { temperature: reading('temperature'), humidity: reading('humidity'),
               blinds: accessories('blinds', 'cover'), fans: accessories('fans', 'fan') };
    }
    // A CATEGORY PAGE'S STATUS ROW (hk-room.js pageItems): each kind it may
    // show, from the same lists the page and the chips are built from
    // (inventory: Status & Chips', or found before the server answers), less
    // the screen's and the row's own rooms left out (status_rows.<page>).
    // Lights and outlets are the Lights page's two halves: what is a light
    // (or drawn as one), and the switches Status & Chips counts with them.
    function pageMembers(client, page, o) {
      o = o || {};
      if (page === 'climate') return climateMembers(client, o);
      var G = setting('generated') || {}, row = (setting('status_rows') || {})[page] || {};
      var opts = {};
      ['exclude_entities', 'exclude_devices', 'exclude_areas'].forEach(function (k) {
        opts[k] = [].concat(G[k] || [], o[k] || [], k === 'exclude_areas' ? row.exclude_areas || [] : []);
      });
      var inv = inventory(client, opts);
      var isLight = function (id) {
        var as = (accOf(id) || {}).show_as;
        return as ? as === 'light' : id.split('.')[0] === 'light';
      };
      var alarm = setting('security.alarm') || firstOf(client, 'alarm_control_panel');
      if (alarm && (!client.states[alarm] || hidden(client, opts, alarm))) alarm = null;
      return { lights: inv.lights.filter(isLight), outlets: inv.lights.filter(function (id) { return !isLight(id); }),
               doors: inv.doors, windows: inv.windows, garage: inv.garage, locks: inv.locks, leaks: inv.leaks,
               motion: inv.motion || [], occupancy: inv.occupancy || [], valves: inv.valves || [],
               vacuums: inv.vacuums || [], timers: inv.timers || [],
               security: alarm ? [alarm] : [] };
    }
    // THE PAGE HEADERS (hk-headers.js; hk_house/docs/PLAN-2026-10-15-page-headers.md):
    // the cards between a page's status row and its accessories, on the Energy
    // page's three columns (two in the iPad band, one on a phone -- the same
    // --hk-energy-* spans), so the pages' cards line up with Energy's. Each
    // card is 240 px tall. Shown unless HK Settings turns the page's off.
    var HEADER_H = '240px';
    // A SCREEN'S OWN SWITCH first (its item's `headers`, {page: false}:
    // HK Settings -> the screen -> Page Headers), then the house's.
    function headerOn(page) {
      if ((boardOf().headers || {})[page] === false) return false;
      var hd = (setting('headers') || {})[page];
      return !hd || hd.show !== false;
    }
    // a header's own settings (settings.HEADERS), null Automatic
    function headerOpts(page) {
      var hd = (setting('headers') || {})[page];
      return hd && typeof hd === 'object' ? hd : {};
    }
    function headerGrid(cards) {
      var grid = { type: 'custom:hk-grid-card', layout: {
        'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))',
        'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' }, cards: cards };
      // the column pays back its children's 4 px side margins, as Energy's
      var col = column([grid]);
      col.layout = Object.assign({}, col.layout, { margin: '0px -4px' });
      return col;
    }
    var SPAN2 = { 'grid-column': 'var(--hk-energy-hero, span 2)' }, SPAN1 = { 'grid-column': 'var(--hk-energy-hl, auto)' },
        SPAN_ALL = { 'grid-column': '1 / -1' };

    // the row under a category page's title (hk-room.js hk-page-status-card)
    function pageRow(page, opts) {
      return { type: 'custom:hk-page-status-card', page: page, view_layout: COL2,
               exclude_entities: opts.exclude_entities, exclude_devices: opts.exclude_devices,
               exclude_areas: opts.exclude_areas };
    }
    // A door, window or garage sensor: its open glyph, and its closed one
    // while shut. A glyph picked in its gear brings its own pair (a door into
    // the garage drawn as a garage); one with no pair is drawn in
    // both states.
    var CONTACT_PAIRS = {
      'door-closed': ['hk:door-open', 'hk:door-closed'], 'door-open': ['hk:door-open', 'hk:door-closed'],
      'window-closed-variant': ['hk:window-open-variant', 'hk:window-closed-variant'],
      'window-open-variant': ['hk:window-open-variant', 'hk:window-closed-variant'],
      garage: ['hk:garage-open', 'hk:garage'], 'garage-open': ['hk:garage-open', 'hk:garage'],
      'garage-variant': ['hk:garage-open-variant', 'hk:garage-variant'],
      'garage-open-variant': ['hk:garage-open-variant', 'hk:garage-variant'],
      'window-closed': ['hk:window-open', 'hk:window-closed'], 'window-open': ['hk:window-open', 'hk:window-closed'],
      'door-sliding': ['hk:door-sliding-open', 'hk:door-sliding'],
      'door-sliding-open': ['hk:door-sliding-open', 'hk:door-sliding'],
      gate: ['hk:gate-open', 'hk:gate'], 'gate-open': ['hk:gate-open', 'hk:gate']
    };
    function contactGlyphs(id, open, closed) {
      var own = accIcon(id);
      if (!own) return [open, closed];
      var p = CONTACT_PAIRS[own.replace(/^hk:/, '')];
      return p ? p.slice() : [own, own];
    }
    function contactTile(client, id, open, closed) {
      var g = contactGlyphs(id, open, closed), room = areaName(client, id);
      var t = { type: 'custom:hk-favorite-card', entity: id, name: named(client, id, room), room: room, icon: g[0],
                icon_color: 'red', label_mode: 'open_closed' };
      if (g[1] !== g[0]) t.icon_states = { off: g[1] };
      return sized(t);
    }
    // A CATEGORY PAGE'S OWN ORDER (the accessories' `pages`, set on the
    // HK Settings page -- the Vacuums, Security's locks): the ones it lists, in its order,
    // then the rest as they were.
    function ownOrder(page, ids) {
      var A = setting('accessories'), list = A && A.pages && A.pages[page];
      if (!Array.isArray(list) || !list.length) return ids;
      var rank = {};
      list.forEach(function (x, i) { rank[x] = i; });
      return ids.filter(function (x) { return x in rank; }).sort(function (x, y) { return rank[x] - rank[y]; })
        .concat(ids.filter(function (x) { return !(x in rank); }));
    }
    // Rooms, keeping only the entities `keep` accepts; empty rooms drop out.
    // THE PAGES' ROOMS IN THIS DASHBOARD'S ROOM ORDER when its item asks
    // (Home -> Rooms -> Rooms on pages: In room order); else floor by floor, A
    // to Z, as rooms() lists them. A room not in the order keeps its place
    // after those that are -- HkGridView.roomOrder's rule for Home.
    function pageOrder(list, opts) {
      var b = opts.board || {};
      var order = b.page_rooms === 'order' && Array.isArray(b.room_order) ? b.room_order : [];
      if (!order.length) return list;
      var rank = {};
      order.forEach(function (a, i) { if (!(a in rank)) rank[a] = i; });
      return list.map(function (r, i) { return { r: r, k: r.id in rank ? rank[r.id] : order.length, i: i }; })
        .sort(function (x, y) { return x.k - y.k || x.i - y.i; }).map(function (x) { return x.r; });
    }
    function roomsWith(client, opts, keep) {
      return pageOrder(rooms(client, opts).map(function (r) {
        return { id: r.id, name: r.name, entities: r.entities.filter(keep) };
      }).filter(function (r) { return r.entities.length; }), opts);
    }
    // A category page's room section; `group`/`page` say where its tiles
    // belong (catPlace)
    function roomTiles(client, r, group, page) {
      return r.entities.map(function (id) {
        return placed(tileFor(client, id, friendly(client, id, r.name)), catPlace(r, group, page));
      });
    }
    // WHERE A CATEGORY PAGE'S TILE BELONGS (Edit mode, 2026-10-26): a room
    // section on Lights, Climate or Water follows that room's Tile Order
    // ({area, group, page}: accessory/order); Security and Vacuums keep a page
    // order ({page}: accessory/page_order). The `page` keeps the sheet's
    // Arrange to the room pages and Home (hk-detail.js arrangeOf).
    function catPlace(r, group, page) {
      return r && r.id ? { area: r.id, group: group, page: page } : null;
    }

    // Group controls belong on category pages even though status inventories
    // count their members only. Respect registry and screen exclusions.
    function categoryGroups(client, opts, ids, domains, kind) {
      var out = ids.slice(), ents = client.entities || {};
      var excluded = (((setting('counts') || {})[kind] || {}).exclude) || [];
      Object.keys(client.states || {}).forEach(function (id) {
        var e = ents[id] || {};
        if (domains.indexOf(id.split('.')[0]) < 0 || !membersOf(client.states[id]) ||
            e.hidden || e.entity_category || e.disabled_by || excluded.indexOf(id) >= 0 || hidden(client, opts, id)) return;
        if (out.indexOf(id) < 0) out.push(id);
      });
      return out;
    }

    // withSecurity: this screen has a Security page (an alarm, the page wanted)
    function categoryPages(client, opts, inv, view, withSecurity) {
      var out = [];
      var dom = function (list) { return function (id) { return list.indexOf(id.split('.')[0]) !== -1; }; };
      var lightTiles = categoryGroups(client, opts, inv.lights, ['light'], 'lights');
      if (lightTiles.length) {
        // Status & Chips' lights -- which may be an outlet the house thinks of as
        // a light -- room by room, as the chip counts them.
        var lit = {};
        lightTiles.forEach(function (id) { lit[id] = true; });
        // LIGHTS & OUTLETS when Status & Chips has an outlet (a switch) among the
        // lights; "Lights" in the menu
        var outlets = inv.lights.some(function (id) { return id.split('.')[0] !== 'light'; });
        var ltitle = outlets ? 'Lights & Outlets' : 'Lights';
        var litRooms = roomsWith(client, opts, function (id) { return !!lit[id]; });
        var lcards = [titleBar(ltitle), pageRow('lights', opts)];
        // THE HEADER: the rooms lit longest today, and what is left on and
        // coming tonight -- of the page's lights (not its outlets: a light is
        // a light, or an accessory shown as one, as the status row counts)
        if (headerOn('lights')) {
          var isLit = function (id) { var as = (accOf(id) || {}).show_as; return as ? as === 'light' : id.split('.')[0] === 'light'; };
          var hdRooms = litRooms.map(function (r) {
            var icons = {}, ls = r.entities.filter(function (id) { return isLit(id) && inv.lights.indexOf(id) >= 0; });
            ls.forEach(function (id) { var t = tileFor(client, id, ''); if (t && t.icon) icons[id] = t.icon; });
            return { name: r.name, lights: ls, icons: icons };
          }).filter(function (r) { return r.lights.length; });
          if (hdRooms.length) {
            lcards.push(headerGrid([
              { type: 'custom:hk-lights-day-card', rooms: hdRooms, height: HEADER_H, view_layout: SPAN2 },
              { type: 'custom:hk-lights-tonight-card', rooms: hdRooms, height: HEADER_H, view_layout: SPAN1 }]));
          }
        }
        out.push(view({ title: ltitle, menu_title: outlets ? 'Lights' : undefined, icon: 'mdi:lightbulb', path: 'lights',
          subview: true, sky_variant: 'lights',
          background: '#1c1608', cards: lcards.concat(litRooms.map(function (r) {
              return section(r.name, roomTiles(client, r, 'Lights', 'lights')); })) }));
      }
      // the house's readings, not the row's (its rooms left out are the row's)
      var climateSources = climateFound(client, opts, []);
      var blindTiles = categoryGroups(client, opts, inv.blinds, ['cover'], 'blinds').filter(function (id) {
        return ['garage', 'gate', 'door'].indexOf(dc(client.states[id])) < 0;
      });
      if (inv.climates.length || inv.fans.length || blindTiles.length ||
          climateSources.temperature.length || climateSources.humidity.length) {
        var blinds = {};
        blindTiles.forEach(function (b) { blinds[b] = 1; });
        // THE CLIMATE PAGE (2026-10-15): the header -- the day's heating and
        // cooling beside the weather ahead -- then, under it, the rooms' fans,
        // humidifiers and blinds on the left and the thermostats right beside
        // them (2026-10-16, the user: as it was before the header), both
        // stacks top-aligned; --hk-page-split stacks them on a phone.
        var cards = [titleBar('Climate'), { type: 'custom:hk-climate-status-card', view_layout: COL2,
          exclude_entities: opts.exclude_entities, exclude_devices: opts.exclude_devices, exclude_areas: opts.exclude_areas }];
        var thermos = inv.climates.filter(function (id) { return id.indexOf('climate.') === 0; });
        var wx = (window.hkSettings && window.hkSettings.weatherId && window.hkSettings.weatherId(client.states)) || firstOf(client, 'weather');
        if (wx && hidden(client, opts, wx)) wx = null;
        if (headerOn('climate') && (thermos.length || wx)) {
          var hc = [];
          if (thermos.length) hc.push({ type: 'custom:hk-climate-runtime-card', thermostats: thermos, height: HEADER_H, view_layout: wx ? SPAN2 : SPAN_ALL });
          if (wx) hc.push({ type: 'custom:hk-climate-outside-card', weather: wx, height: HEADER_H, view_layout: thermos.length ? SPAN1 : SPAN_ALL });
          cards.push(headerGrid(hc));
        }
        // NO SIDE MARGINS OF THEIR OWN (2026-10-16, the user: Climate's pills
        // sat 12 px right of Lights'): layout-card's 4 px on each nested grid
        // -- the split, the stack, the room's grid -- added up. The stack keeps
        // the vertical 4 / 8 (a heading's room above its pills, as on Lights)
        // and drops the sides, so the room grids sit where Lights' do, the
        // tiles' own 4 px lining them up with the header cards (DESIGN.md,
        // Exact gaps)
        var stack = function (list) {
          return { type: 'custom:hk-grid-card', cards: list,
            layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': 'min-content',
                      'place-content': 'start stretch', 'grid-row-gap': '0px', 'card-margin': '4px 0px 8px', margin: '0px', padding: '0px' } };
        };
        var left = [], widest = 0;
        roomsWith(client, opts, function (id) {
          var d = id.split('.')[0];
          return d === 'fan' || d === 'humidifier' || (d === 'cover' && blinds[id]);
        }).forEach(function (r) {
          widest = Math.max(widest, r.entities.length);
          left.push(heading(r.name));
          left.push({ type: 'custom:hk-grid-card', cards: roomTiles(client, r, 'Climate', 'climate'), layout: pillGrid(27) });
        });
        var right = [];
        if (inv.climates.length) {
          right.push(heading('Thermostats'));
          right.push({ type: 'custom:hk-grid-card',
            // COUNTED BY THE NARROWEST DIAL (2026-10-16, the user: two nearly
            // fit at 1728): an `auto` track is counted by its minimum, 340, where
            // a 364 maximum counted one fewer; each dial asks for 364 and takes
            // its cell where that is less (dial_width), so the tracks grow to
            // 364 and no further, packed to the start the pills' gap apart
            layout: { 'grid-template-columns': 'repeat(auto-fill, minmax(min(100%, var(--hk-dial-min, 340px)), auto))',
                      'grid-auto-rows': 'min-content', 'place-content': 'start start',
                      // THE HOUSE GAP EXACTLY (DESIGN.md: 10 px both ways): no
                      // child margins, so the gaps are the grid's own; the
                      // padding puts the dials where the margins had them
                      'grid-column-gap': TL().gridGap + 'px', 'grid-row-gap': TL().gridGap + 'px', 'card-margin': '0px',
                      margin: '0px', padding: '4px 0px 15px 4px' },
            cards: inv.climates.map(function (id) {
              return { type: 'custom:hk-thermostat-card', entity: id, name: fullName(client, id), dial_width: 'var(--hk-dial, 364px)', big: setting('look.thermostat_style') === 'big' };
            }) });
        }
        // THE ROOMS AS WIDE AS THEIR WIDEST ROOM NEEDS: two to four pills and
        // the gaps between them (no nested margins now); more than four wrap. The thermostats take the rest, as many dials across
        // as fit. On a narrower page the rooms give way first and the rail
        // keeps one dial (--hk-climate-dials in the iPad band, hk-responsive.css).
        var roomsW = (TL().w + TL().gridGap) * Math.max(2, Math.min(4, widest)) - TL().gridGap;
        var body = left.length && right.length
          ? { type: 'custom:hk-grid-card', cards: [stack(left), stack(right)],
              layout: { 'grid-template-columns': 'var(--hk-page-split, minmax(0, ' + roomsW + 'px) minmax(min(var(--hk-climate-dials, 364px), 364px), 1fr))',
                        // (-4 px at the side: its own margin in the page's
                        // column, which Lights' room grids, a level up, never
                        // pay; -8 px on top: that, and the stack's first 4 px)
                        'grid-column-gap': '28px', 'grid-row-gap': '0px', 'card-margin': '0px', margin: '-8px 0px 0px -4px', padding: '0px' } }
          : stack(left.length ? left : right);
        if (left.length || right.length) cards.push(column([body]));
        out.push(view({ title: 'Climate', icon: 'mdi:home-thermometer', path: 'climate', subview: true, sky_variant: 'climate',
                        background: '#0d1a1c', cards: cards }));
      }
      // DOORS & WINDOWS: the doors and the windows -- not the locks and the
      // garage door, which are Security's. Each tile carries its room as a
      // line above its name,
      // as the favorites do, so a name stays the accessory's own ("Left
      // Window", "Entry") however many rooms the page mixes.
      // ONE PAGE WITH SECURITY (2026-10-16, the user: the two covered the same
      // thing): where the house has an alarm, Security is where the doors and
      // windows are -- its status row counts them, its house shows them, its
      // chips open them as a list -- and there is no page of their own. A
      // house without an alarm (or a screen without its Security page) keeps
      // this page.
      if ((inv.doors.length || inv.windows.length) && !withSecurity) {
        var dw = [titleBar('Doors & Windows'), pageRow('doors_windows', opts)];
        if (inv.doors.length) dw.push(section('Doors', inv.doors.map(function (id) { return contactTile(client, id, 'hk:door-open', 'hk:door-closed'); }), true));
        if (inv.windows.length) dw.push(section('Windows', inv.windows.map(function (id) { return contactTile(client, id, 'hk:window-open-variant', 'hk:window-closed-variant'); }), true));
        out.push(view({ title: 'Doors & Windows', icon: 'mdi:window-closed-variant', path: 'doors-windows', subview: true, sky_variant: 'doors',
                        background: '#1c0e10', cards: dw }));
      }
      if (inv.timers.length) {
        // THE TIMERS PAGE: with the quick timers (helpers/quick_timers.yaml)
        // the whole page -- presets, what is running, the New Timer keypad;
        // without them, what is running.
        var quick = !!client.states['script.quick_timer_start'];
        var slots = ['timer.quick_1', 'timer.quick_2', 'timer.quick_3', 'timer.quick_4'];
        var tlist = [];
        if (quick) slots.forEach(function (id, i) {
          if (!client.states[id]) return;
          var t = { entity: id, label: 'Quick Timer ' + (i + 1), glyph: 'mdi:timer-outline' };
          if (client.states['input_text.quick_timer_' + (i + 1) + '_name']) t.label_entity = 'input_text.quick_timer_' + (i + 1) + '_name';
          tlist.push(t);
        });
        // ONE NAME PER TIMER on this page, in the running list and the house
        // row alike: "Nap - Timer" is a Nap under a Timers heading, as a tile
        // drops its room's name (the accessory's own name wins).
        var timerName = function (id) {
          var at = client.states[id].attributes || {};
          return accName(id) || String(at.friendly_name || id).replace(/\s*[-\u2013]?\s*timer\s*$/i, '') ||
            fullName(client, id);
        };
        // THE HOUSE TIMERS (Configure -> Your home -> House timers): one tap
        // each, named and pictured as the timers themselves are -- and first in
        // the running list, in their own order, as the hand-written page had them.
        var houseIds = (setting('features.house_timers') || []).filter(function (id) { return client.states[id]; });
        var running = inv.timers.filter(function (id) { return !(quick && slots.indexOf(id) >= 0); });
        houseIds.filter(function (id) { return running.indexOf(id) >= 0; })
          .concat(running.filter(function (id) { return houseIds.indexOf(id) < 0; }))
          .forEach(function (id) {
            var ent = (client.entities || {})[id] || {};
            tlist.push({ entity: id, label: timerName(id),
                         glyph: ent.icon || (client.states[id].attributes || {}).icon || 'hk:timer-sand' });
          });
        var house = houseIds.map(function (id) {
          var ent = (client.entities || {})[id] || {}, at = client.states[id].attributes || {};
          return { entity: id, name: timerName(id), icon: accIcon(id) || ent.icon || at.icon || 'mdi:timer-outline' };
        });
        // THE TIMERS PAGE (2026-10-16, PLAN-2026-10-16-utility-pages.md): the
        // status row; the header -- what finishes when, beside the quick
        // durations and Create a Timer (with the quick-timer helpers); then
        // what is running, each card at its own 388 px, and the House
        // Timers ready to start. Without the helpers, Finishing Order across.
        var tcards = [titleBar('Timers'), pageRow('timers', opts)];
        var TINT = 'rgba(255, 159, 10, 0.95)';
        // Quick Start's durations and names (HK Settings -> Pages -> Timers)
        var ht = headerOpts('timers');
        var presets = Array.isArray(ht.presets) && ht.presets.length ? ht.presets.slice(0, 6) : [5, 10, 15, 20, 30, 60];
        var chips = Array.isArray(ht.names) ? ht.names.slice(0, 6) : ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break'];
        var theader = headerOn('timers');
        if (theader) {
          // the line's past: the quick timers and the House Timers -- the ones
          // people start -- not the automations' that cycle all day
          var mineT = (quick ? slots.filter(function (id) { return client.states[id]; }) : []).concat(houseIds);
          var th = [{ type: 'custom:hk-timers-order-card', timers: tlist, past: mineT, tint: TINT, height: HEADER_H, view_layout: quick ? SPAN2 : SPAN_ALL }];
          if (quick) th.push({ type: 'custom:hk-timers-start-card', tint: TINT, presets: presets,
            name_chips: chips, height: HEADER_H, view_layout: SPAN1 });
          tcards.push(headerGrid(th));
        }
        // A HIDDEN HEADER GIVES BACK WHAT IT HELD: Quick Start is the page's
        // own again -- the one-page Timers layout, presets beside what runs,
        // the House Timers under them
        if (!theader && quick) {
          tcards.push(column([{ type: 'custom:hk-timers-page-card', tint: TINT, empty_text: 'Nothing is running.',
            presets: presets, name_chips: chips, house: house, timers: tlist }]));
          out.push(view({ title: 'Timers', icon: 'mdi:timer-sand', path: 'timers', subview: true, sky_variant: 'timers',
            background: '#1e1408', cards: tcards }));
        } else {
          // (its own grid of 388 px cards, not the pills' 196 px tracks)
          tcards.push({ type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [heading('Running'),
            { type: 'custom:hk-grid-card', layout: { 'grid-template-columns': 'minmax(0, 1fr)', margin: '0px', padding: '0px' },
              cards: [{ type: 'custom:hk-timers-card', tint: TINT, timers: tlist,
                empty_text: quick ? 'Nothing is running. Start one above.' : 'Nothing is running.' }] }] });
          // the house timers that are idle; a running one is a card in Running
          if (house.length) {
            var hsec = section('House Timers', house.map(function (t) {
              return { type: 'conditional', conditions: [{ condition: 'state', entity: t.entity, state: 'idle' }],
                card: { type: 'custom:hk-tile-card', entity: t.entity, name: t.name, icon: t.icon, icon_color: 'orange', label_mode: 'duration',
                        tap_action: { action: 'perform-action', perform_action: 'timer.start', target: { entity_id: t.entity } } } };
            }));
            tcards.push({ type: 'conditional', view_layout: COL2,
              conditions: [{ condition: 'or', conditions: house.map(function (t) { return { condition: 'state', entity: t.entity, state: 'idle' }; }) }],
              card: hsec });
          }
          out.push(view({ title: 'Timers', icon: 'mdi:timer-sand', path: 'timers', subview: true, sky_variant: 'timers',
            background: '#1e1408', cards: tcards }));
        }
      }
      if (inv.vacuums.length) {
        // THE VACUUMS PAGE (2026-10-16, PLAN-2026-10-16-utility-pages.md): the
        // status row; the header -- the week's cleaning beside each vacuum's
        // last run; then the vacuums at their own 388 px, one under another,
        // with Clean Areas' rooms on a plate beside them (under them on a
        // phone). Each vacuum card carries the readings its own device has.
        // In the page's own order (the HK Settings page's drag list), the
        // rest after it.
        var vorder = ownOrder('vacuums', inv.vacuums);
        var vcards = vorder.map(function (id) {
          var v = { type: 'custom:hk-vacuum-card', entity: id, hk_place: { page: 'vacuums' } };
          var bat = sibling(client, id, 'battery');
          if (bat) v.battery = bat;
          var find = function (re, not) { return siblingLike(client, id, re, not); };
          var err = find(/operational_error|_error$/, /dock/);
          if (err) v.error = err;
          var dock = find(/dock.*error/);
          if (dock) v.dock_error = dock;
          var room = find(/current_room/);
          if (room) v.room = room;
          var prog = find(/cleaning_progress/);
          if (prog) v.progress = prog;
          return v;
        });
        // what the header reads for each: the vacuum, its error sensor, and
        // the mission counters a vacuum that keeps them has (a Roomba's), the
        // one sure word that a run finished
        // Counters chosen on HK Settings -> Pages -> Vacuums are read in place
        // of those found: each goes to the vacuum on its device (to the only
        // vacuum when there is one), and says by its name which it counts.
        var picked = (headerOpts('vacuums').counters || []).filter(function (id) { return client.states[id]; });
        var devOf = function (id) { return ((client.entities || {})[id] || {}).device_id || null; };
        var vruns = vorder.map(function (id, i) {
          var mine = picked.filter(function (c) { return vorder.length === 1 || (devOf(c) && devOf(c) === devOf(id)); });
          var find = picked.length
            ? function (re) { return mine.filter(function (c) { return re.test(c); })[0] || null; }
            : function (re) { return siblingLike(client, id, re); };
          var r = { entity: id };
          if (vcards[i].error) r.error = vcards[i].error;
          var ok = find(/successful_(missions|cleans?)$/), bad = find(/failed_(missions|cleans?)$/), cut = find(/cancel+ed_(missions|cleans?)$/);
          if (ok) r.success = ok;
          if (bad) r.failed = bad;
          if (cut) r.canceled = cut;
          return r;
        });
        var vpage = [titleBar('Vacuums'), pageRow('vacuums', opts)];
        if (headerOn('vacuums')) {
          vpage.push(headerGrid([
            { type: 'custom:hk-vacuum-week-card', vacuums: vruns, height: HEADER_H, view_layout: SPAN2 },
            { type: 'custom:hk-vacuum-last-card', vacuums: vruns, height: HEADER_H, view_layout: SPAN1 }]));
        }
        // the vacuums' column: 388 px cards, 10 px apart, never stretched to
        // fill a wide page -- 412 of track: the card sits three grids deep and
        // each gives a child 4 px a side (measured 2026-10-16)
        var VAC_W = 388 + 24;
        // 10 APART: each in a grid of its own, whose margins collapse against
        // its neighbors' (hk-layout.js) -- the card's own 4 px top and 8 px
        // bottom, less 1 px each way, are the 10
        var vstack = { type: 'custom:hk-grid-card', cards: vcards.map(function (v, i) {
            // (the first one's top level with the plate beside it)
            return { type: 'custom:hk-grid-card', cards: [v],
              layout: { 'grid-template-columns': 'minmax(0, 1fr)', margin: (i ? '-1px' : '-4px') + ' -4px -1px -4px', padding: '0px' } };
          }),
          layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': 'min-content',
                    'grid-row-gap': '0px', margin: '0px', padding: '0px' } };
        // CLEAN BY AREA: the picker's rooms are Clean Areas': the
        // ones a vacuum's room map reaches, or those chosen on HK Settings
        // -> Clean by Area -- asked live by the card, so a change there reaches
        // an open screen, and an area no vacuum reaches is not offered.
        var picker = added('clean_areas') || setting('features.vacuum_script');
        // each column its heading and its body, so a phone reads them in order
        // (the second loses the 4 px top margin a grid's first child keeps:
        // `top` puts it back, so the two headings share a line)
        var vst = function (list, top, left) {
          return { type: 'custom:hk-grid-card', cards: list,
            layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': 'min-content', 'place-content': 'start stretch',
                      'grid-row-gap': '0px', margin: left ? '0px 0px 0px var(--hk-split-pull, ' + left + 'px)' : '0px', padding: (top || 0) + 'px 0px 0px 0px' } };
        };
        var vbody = picker
          ? { type: 'custom:hk-grid-card',
              layout: { 'grid-template-columns': 'var(--hk-page-split, minmax(0, ' + VAC_W + 'px) minmax(var(--hk-rail, 0px), 1fr))',
                        'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' },
              cards: [vst([heading('Vacuums'), vstack]), vst([heading('Clean Areas'), { type: 'custom:hk-area-select-card', layout: 'panel' }], 4, -12)] }
          : { type: 'custom:hk-grid-card', cards: [vst([heading('Vacuums'), vstack])],
              layout: { 'grid-template-columns': 'minmax(0, ' + VAC_W + 'px)', 'grid-row-gap': '0px', margin: '0px', padding: '0px' } };
        // the column pays back the nesting so the cards' left edge is the
        // header's and the plate's right edge is too (the headings keep their
        // usual 4 px inset)
        var vcol = column([vbody]);
        vcol.layout = Object.assign({}, vcol.layout, { margin: '0px var(--hk-split-r, -8px) 0px -12px' });
        vpage.push(vcol);
        out.push(view({ title: 'Vacuums', icon: 'mdi:robot-vacuum', path: 'vacuums', subview: true, sky_variant: 'vacuums',
          background: '#170f14', cards: vpage }));
      }
      return out;
    }

    // IS MUSIC SET UP? Asked of the feature itself, once (its answer also has the house's stereo pairs, hk-pairs.js);
    // not installed, the subscribe is refused: no. The page's own hkMusic has not been handed its configuration yet
    // when a dashboard is generated (no card has attached it), so it cannot say.
    function musicConfigured(client) {
      return new Promise(function (resolve) {
        // the client's subscription port (its read allowlist offers hk_music/subscribe)
        var conn = client && client.subscriptions, done = false, unsub = null;
        // an unsubscribe the server refuses (the socket reconnected meanwhile)
        // is not an error: never an uncaught rejection
        var end = function (u) { var r = u(); if (r && r.catch) r.catch(function () {}); };
        function finish(v) {
          if (done) return;
          done = true;
          if (unsub) end(unsub);
          resolve(v);
        }
        if (!conn || typeof conn.subscribeMessage !== 'function') return finish(false);
        // THE BOUND STARTS NOW, not once the subscribe is accepted: on a
        // connection that is down, that acceptance waits for the reconnect.
        setTimeout(function () { finish(false); }, 4000);
        conn.subscribeMessage(function (ev) {
          PR().learn(client, ev ? (ev.configured && ev.speakers) || [] : null);
          finish(!!(ev && ev.configured && ev.speakers && ev.speakers.length));
        }, { type: 'hk_music/subscribe' }).then(function (u) {
          unsub = u;
          if (done) end(u);
        }, function () { finish(false); });
      });
    }
    function boardOf(seg) {
      var all = setting('boards') || {};
      var b = all[seg === undefined ? dashSeg() : seg];
      return (b && typeof b === 'object') ? b : {};
    }

    // A HOME GRID SCREEN'S HOME (docs/phase11/HOME-GRID.md): the screen's
    // home_grid (checked by hk_core) as an hk-home-grid-view -- the band's card
    // first when the band is on, a card per block from the catalog
    // (hk-grid-catalog.js) with its cell, then the cards that only listen.
    // `ctx`: the house as this screen sees it, for a block naming nothing.
    // `tiles`: the screen's Tile Style (its own, else All Screens'), which a
    // block's own `tile` overrides; only Centred goes on the cell.
    function homeGridView(grid, o, header, listeners, ctx, tiles) {
      var cards = [];
      if (grid.band !== false && header) {
        // A Home Grid has 60 px for its band, not the full page header's 150+.
        var parts = header.cards || [], chip = parts.find(function (c) { return c.type === 'custom:hk-chips-card'; });
        var band = { type: 'custom:hk-header-card', grid_band: true, show_clock: grid.header_clock !== false,
          show_weather: grid.header_weather !== false, chips: chip || null, hk_band: true };
        // (where each part sits, 2026-11-01: hk_core home_grid HEADER_PARTS)
        if (Array.isArray(grid.header)) band.parts = grid.header;
        cards.push(band);
      }
      (grid.items || []).forEach(function (it) {
        // (Hide Box: the block's own, or the screen's No Boxes -- the cell says so to every card inside it)
        var cell = { id: it.id, size: it.size, at: it.at, bare: !!it.bare || grid.boxes === false, view: it.view || 0 };
        // (Automatic, the screen's default: Centred on square cells, Home on
        // tiles. Never the screen's Centred on a Security block past Small: its
        // mode buttons piled over its name, 2026-10-30. A block's own Centred is
        // its own.)
        var ts = it.tile || tiles || 'auto', keeps = it.card === 'security' && it.size !== 'S' && it.tile !== 'centred' && (it.opts || {}).presentation !== 'homeview';
        if (!keeps && (ts === 'centred' || (ts === 'auto' && grid.cell === 'square'))) cell.tile = 'centred';
        cards.push(window.hkGridCatalog.placed(it, ctx, cell, grid.cell, tiles));   // (its card, and its custom sheet on its cell)
      });
      (listeners || []).forEach(function (c) { cards.push(c); });
      return Object.assign({}, o, { type: 'custom:hk-home-grid-view', layout: undefined, cards: cards, grid_ctx: ctx,
                                    grid: Object.assign({ cols: grid.cols, rows: grid.rows, band: grid.band !== false, scale: grid.scale },
                                                        grid.grow === true ? { grow: true } : {}, grid.night && grid.night.mode !== 'off' ? { night: grid.night } : {},
                                                        grid.views > 1 ? { views: grid.views } : {},
                                                        // square cells, and a Square screen (2026-10-30)
                                                        grid.cell === 'square' ? { cell: 'square' } : {}, grid.screen === 'square' ? { screen: 'square' } : {}) });
    }
    // the catalog, when a Home Grid screen needs it: a parallel-loaded
    // resource, waited for by its ready event, never polled (cardsReady)
    function gridReady() {
      if (window.hkGridCatalog) return Promise.resolve();
      return new Promise(function (res) {
        window.addEventListener('hk-grid-catalog-ready', function () { res(); }, { once: true });
      });
    }

    // THE CAMERA STRIP: its measured structure and numbers
    // (one live tile, the rest stills, in a mosaic that scrolls), inside the
    // per-dashboard wrapper that sets the nesting depth the rows align by.
    function cameraStrip(client, opts, b, page) {
      if (b.camera_strip === false) return null;
      var ids = listOf(b, 'cameras').length ? listOf(b, 'cameras').filter(function (id) { return client.states[id]; })
                                            : houseCameras(client, opts);
      ids = ids.filter(function (id) { return !hidden(client, opts, id); });
      if (!ids.length) return null;
      var head = heading('Cameras');
      if (page) head.navigation_path = './cameras';
      return { type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [
        { type: 'grid', columns: 1, square: false, cards: [head, {
          type: 'custom:hk-grid-card',
          layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-flow': 'row', 'grid-column-gap': '12px',
                    'grid-row-gap': '12px', margin: '-14px -22px -49px -22px', padding: '0px' },
          cards: [{ type: 'custom:hk-row-card', card_width: 'fit-content', pad_top: '14px', pad_bottom: '30px',
                    pad_left: '22px', pad_right: '22px', cards: [{
                      type: 'custom:hk-camera-mosaic-card', height: 195, seam: 2, snapshot_cap: '480x270',
                      max_upscale: 1.2, show_age: true,
                      cameras: ids.map(function (id) { return { entity: id, name: fullName(client, id) }; }) }] }] },
          // ...and the strip's closing 22 px: 30 px to the scenes with the gap.
          { type: 'custom:hk-spacer-card', height: '22px' }] }] };
    }
    // A FAVORITE is its room tile on the favorites row, with what the
    // accessory's gear gives it AS a favorite: its name and glyph
    // there ("Garage Door" where its room tile is "Door"), and the lights it
    // controls together with ("Main + Table Lights") -- and the state text a
    // favorite reads: a light its brightness, a switch On / Off.
    function favTile(client, id) {
      var fa = accOf(id) || {};
      // its room line: the accessory's own as a favorite (a helper with no
      // area), else its area's
      var d = id.split('.')[0], st = client.states[id], area = areaName(client, id), room = fa.fav_room || area;
      // shortened by its real room only: a room line of its own is just words
      // ("Office" over Office Lights, a group with no area)
      var name = fa.fav_name || accName(id) || shortName(nameOf(client, id, (client.entities || {})[id]), area);
      var dc = st && st.attributes && st.attributes.device_class;
      if (d === 'climate' || d === 'water_heater') {
        return { type: 'custom:hk-climate-card', entity: id, name: name, room: room, icon_color: 'blue',
                 label_mode: 'setpoint' };
      }
      var base = { type: 'custom:hk-favorite-card', entity: id, name: name, room: room };
      // the accessory's own glyph (its gear) over the favourite's usual one, at
      // that glyph's measured size (without it every picked glyph would draw 23 px)
      var mine = function (t) {
        var own = favIcon(fa) || accIcon(id);
        if (own && own !== t.icon) { t.icon = own; delete t.icon_states; delete t.icon_size; sized(t, FAV_PX); }
        return t;
      };
      if (d === 'lock') {
        return mine(Object.assign(base, { icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open-variant' },
                                          icon_size: '23px', icon_color: 'mint', label_mode: 'sentence' }));
      }
      if (d === 'cover' && (dc === 'garage' || dc === 'gate')) {
        return mine(Object.assign(base, { icon: 'hk:garage-variant', icon_size: '26px', icon_color: 'mint',
          icon_states: { open: 'hk:garage-open-variant', opening: 'hk:garage-open-variant' }, label_mode: 'open_closed' }));
      }
      var t = tileFor(client, id, name);
      if (!t) return base;
      t = Object.assign({}, t, { type: 'custom:hk-favorite-card', room: room });
      delete t.view_layout;                     // one height, like every favorite
      delete t.size;                            // ...whatever the accessory's own size
      delete t.hk_place;                        // its place here is the favorites'
      delete t.animation;                       // ...and its still glyph (a fan's Spin is its tile's)
      // A LIGHT GROUP (its members: membersOf) reads how many are on, "2 On",
      // as the hand-written favorites did; a blind its position.
      var members = d === 'light' && membersOf(st)
        ? membersOf(st).filter(function (x) { return x !== id && client.states[x]; }) : [];
      if (members.length) { t.label_mode = 'group_count'; t.group = members; }
      else if (d === 'light') t.label_mode = 'brightness';
      else if (d === 'switch' || d === 'input_boolean') t.label_mode = 'on_off';
      else if (d === 'cover') t.label_mode = 'position';
      mine(t);
      var together = (Array.isArray(fa.fav_with) ? fa.fav_with : []).filter(function (x) {
        return x !== id && client.states[x];
      });
      if (together.length && (d === 'light' || d === 'switch' || d === 'input_boolean')) {
        var all = [id].concat(together);
        var lights = all.every(function (x) { return x.split('.')[0] === 'light'; });
        t.group = all;
        t.group_lit = 'any';
        if (d === 'light') t.label_mode = 'group_brightness';
        t.tap_action = { action: 'perform-action', perform_action: lights ? 'light.toggle' : 'homeassistant.toggle',
                         target: { entity_id: all } };
      }
      return t;
    }
    function favIcon(fa) {
      var v = fa && fa.fav_icon ? String(fa.fav_icon) : '';
      return v ? (/^mdi:/.test(v) ? 'hk:' + v.slice(4) : v) : null;
    }
    function favorites(client, opts, b) {
      var tiles = listOf(b, 'favorites').filter(function (id) { return client.states[id]; }).map(function (id) {
        return placed(favTile(client, id), { fav: true });
      });
      if (!tiles.length) return null;
      // The favorites grid: 9 px below, where a room's is 11.
      return { type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [heading('Favorites'),
        { type: 'custom:hk-grid-card', layout: pillGrid(17, true), cards: tiles }] };
    }

    // ONE PAGE THAT CANNOT BE BUILT IS ONE PAGE, NOT THE DASHBOARD. Home
    // Assistant replaces EVERY view with one "Error loading the dashboard
    // strategy" card when generate() throws -- on a wall tablet, the whole
    // screen until it is reloaded. So the category pages and each room page are
    // built guarded: one that throws is logged and left out (a room page says
    // so in its place, as its heading on Home still links to it).
    function guarded(label, build, instead) {
      try { return build(); } catch (e) {
        try { console.error('[hk-strategy] could not build ' + label, e); } catch (x) { /* no console */ }
        return instead ? instead(e) : null;
      }
    }

    // what the shell and the later parts use of this one
    K.boardOf = boardOf; K.cameraStrip = cameraStrip; K.categoryPages = categoryPages; K.catPlace = catPlace;
    K.climateMembers = climateMembers; K.contactGlyphs = contactGlyphs; K.favorites = favorites;
    K.gridReady = gridReady; K.guarded = guarded; K.HEADER_H = HEADER_H; K.headerGrid = headerGrid;
    K.headerOn = headerOn; K.headerOpts = headerOpts; K.homeGridView = homeGridView; K.inventory = inventory;
    K.musicConfigured = musicConfigured; K.ownOrder = ownOrder; K.pageMembers = pageMembers; K.pageRow = pageRow;
    K.roomsWith = roomsWith; K.SPAN1 = SPAN1; K.SPAN2 = SPAN2; K.SPAN_ALL = SPAN_ALL;
  };
})();
