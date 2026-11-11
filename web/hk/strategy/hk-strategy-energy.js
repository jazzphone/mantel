// hk-strategy-energy.js - the custom, sky, Energy, Power and screensaver pages and the media bar.
//
// PART OF THE DASHBOARD STRATEGY (hk-strategy.js). Not a card and not run on its own: it registers one
// function, which hk-strategy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkStrategyParts = window.hkStrategyParts || {})['hk-strategy-energy'] = function (K) {
    var added = K.added, COL2 = K.COL2, column = K.column, guarded = K.guarded, kioskTheme = K.kioskTheme,
        listOf = K.listOf, setting = K.setting, titleBar = K.titleBar, TL = K.TL, VIEW_LAYOUT = K.VIEW_LAYOUT;

    // Pages follows Home and reads its icons, rooms and widgets live.
    // It wears Home's sky and uses /pages-screen when /pages is already taken.
    function pagesScreen(list, b) {
      var HS = window.hkSettings, home = list[0];
      if (!home || !HS || !HS.pagesScreen || HS.pagesScreen(b).show !== 'on') return;
      var path = list.some(function (v) { return v && v.path === 'pages'; }) ? 'pages-screen' : 'pages';
      var v = { type: 'custom:hk-grid-view', title: 'Pages', path: path, subview: true, icon: 'mdi:view-grid',
                pages_screen: true, background: home.background || '#05070e',
                layout: { 'grid-template-columns': 'minmax(0, 1fr)', margin: '0px', padding: '0px' },
                cards: [{ type: 'custom:hk-pages-screen-card', glass: false }] };
      // Pages is inserted after the ordinary views received their docked player.
      // Carry that same bar here too when On Every Page is enabled.
      if (b.bar_all_pages) {
        var bar = list.flatMap(function (page) { return page.cards || []; }).find(function (card) {
          return (card.cards || []).some(function (c) { return c.type === 'custom:hk-popup-card' && c.hash === '#media' && c.dock; });
        });
        if (bar) v.cards.push(bar);
      }
      if (home.theme) v.theme = home.theme;
      if (home.sky) v.sky = true;
      list.splice(1, 0, v);
    }

    // THE HOUSE'S CUSTOM PAGES this dashboard lists (its Pages page; Custom
    // pages on the HK Settings page): each page's own view --
    // its cards, as the house wrote them -- under its title, address and icon,
    // after the category pages and before the rooms. A chip whose page it is
    // (Energy) opens it. An address this dashboard already has is left out.
    // Nothing is fetched from another dashboard.
    // One custom page's view: its cards as the house wrote them, under its
    // title, address and icon; null when the house has no such page.
    function customView(k) {
      var all = setting('custom_pages') || [], p = null;
      (Array.isArray(all) ? all : []).forEach(function (x) { if (x && x.path === k) p = x; });
      if (!p) return null;
      var v = JSON.parse(JSON.stringify(p.view || {}));
      v.title = p.title || k;
      v.path = k;
      if (p.icon) v.icon = p.icon;
      if (!Array.isArray(v.cards) && !Array.isArray(v.sections)) v.cards = [];
      return v;
    }
    function customPages(list, keys) {
      if (!keys.length) return;
      var all = setting('custom_pages') || [], by = {};
      (Array.isArray(all) ? all : []).forEach(function (p) { if (p && p.path) by[p.path] = p; });
      var have = {};
      list.forEach(function (v) { if (v && v.path) have[v.path] = true; });
      var at = list.length;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && /^room-/.test(list[i].path || '')) { at = i; break; }
      }
      keys.forEach(function (k) {
        var p = by[k];
        if (!p || have[k]) return;
        var v = JSON.parse(JSON.stringify(p.view || {}));
        v.title = p.title || k;
        v.path = k;
        if (p.icon) v.icon = p.icon;
        if (!Array.isArray(v.cards) && !Array.isArray(v.sections)) v.cards = [];
        list.splice(at++, 0, v);
        have[k] = true;
      });
    }

    // WHICH PAGE EACH VIEW IS, for its background (Sky / Background -> Pages,
    // read by hk-sky.js on every tick): the page kind, `rooms` for a room's
    // page, a custom page's own address. Home has none -- it is the screen's
    // own sky.
    var SKY_PAGE = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', 'live-tv': 'live_tv',
                     security: 'security', 'doors-windows': 'doors_windows', climate: 'climate', lights: 'lights',
                     timers: 'timers', vacuums: 'vacuums', playmusic: 'music', 'music-browse': 'music', water: 'water',
                     energy: 'energy', power: 'power', timeline: 'timeline' };
    function skyPages(list) {
      var custom = {};
      (setting('custom_pages') || []).forEach(function (p) { if (p && p.path) custom[p.path] = true; });
      list.forEach(function (v) {
        if (!v || v.sky_page || !v.path) return;
        var p = String(v.path);
        var k = SKY_PAGE[p] || (/^room-/.test(p) ? 'rooms' : custom[p] ? p : null);
        if (k) v.sky_page = k;
        // a room's page can have a background of its own: its address
        if (k === 'rooms') v.sky_room = p;
      });
    }

    // THE FIRST PAGE OF A SCREEN WITH NO HOME: not a sub-page, and -- with no
    // menu -- no back button (there is nowhere to go back to)
    function standalone(v, b) {
      v.subview = false;
      if (b.menu !== 'off') return;
      var bar = v.cards && v.cards[0];
      var kids = bar && bar.type === 'custom:hk-grid-card' && Array.isArray(bar.cards) ? bar.cards : null;
      if (kids && kids[0] && kids[0].type === 'custom:hk-back-card') {
        v.cards[0] = Object.assign({}, bar, { cards: kids.slice(1),
          layout: Object.assign({}, bar.layout, { 'grid-template-columns': 'minmax(0, 1fr)' }) });
      }
    }

    // A SCREEN WITH NO HOME PAGE: its custom pages, in its order -- and
    // `energy` among them is the Energy feature's page while it is added (a
    // generated page wins its address, as on a whole screen). The first page
    // has no back button while the screen has no menu (nowhere to go back to).
    function onlyPages(client, opts, b) {
      var mine = listOf(b, 'custom_pages'), keys = mine;
      var themes = (client.themes && client.themes.themes) || {};
      var theme = opts.theme || kioskTheme(themes);
      var sky = opts.sky !== false;
      var mk = function (o) {
        var v = Object.assign({ type: 'custom:hk-grid-view', layout: VIEW_LAYOUT, background: '#05070e' }, o);
        if (theme) v.theme = theme;
        if (o.sky_variant) { delete v.sky; if (!sky) delete v.sky_variant; }
        return v;
      };
      var out = [];
      keys.forEach(function (k) {
        var v = null;
        if (k === 'energy') {
          v = guarded('the Energy page', function () { return energyView(client, mk, {}, !out.length && b.menu === 'off'); });
        }
        var pp = added('energy') && setting('energy') && setting('energy').power;
        if (!v && pp && (k === 'power' || k === pp.path)) v = guarded('the Power page', function () { return powerView(client, mk); });
        if (!v && mine.indexOf(k) >= 0) v = customView(k);
        if (v && !out.some(function (x) { return x.path === v.path; })) out.push(v);
      });
      return out;
    }

    // A LINK TO A PAGE THIS SCREEN DOES NOT HAVE (the Energy page's "Power ›"
    // on a screen that is only the Energy page, the Power page's "Every
    // device ›" on a screen that is only Power): the same page on a screen
    // that shows it -- a screen of only it first -- and no link when none does.
    // A screen shows a page by its Pages list (empty: every page), its Only
    // Pages when it has no Home, or its custom pages.
    function energyLinks(list, seg) {
      var have = {};
      list.forEach(function (v) { if (v && v.path) have[v.path] = true; });
      var pages = list.filter(function (v) { return v && (v.path === 'energy' || v.path === 'power'); });
      if (!pages.length) return;
      var boards = setting('boards') || {};
      var shows = function (b, p) {
        if (listOf(b, 'custom_pages').indexOf(p) >= 0) return true;
        if (b.home_page === false && listOf(b, 'only_pages').length) return listOf(b, 'only_pages').indexOf(p) >= 0;
        var ps = listOf(b, 'pages');
        return !ps.length || ps.indexOf(p) >= 0;
      };
      var elsewhere = function (p) {
        var keys = Object.keys(boards).filter(function (k) { return k !== seg && shows(boards[k] || {}, p); });
        keys.sort(function (x, y) { return (boards[y].home_page === false) - (boards[x].home_page === false); });
        return keys.length ? '/' + keys[0] + '/' + p : null;
      };
      var local = function (path) { return typeof path === 'string' && /^\.\/[a-z0-9-]+$/.test(path) ? path.slice(2) : null; };
      pages.forEach(function walk(n) {
        if (!n || typeof n !== 'object') return;
        var p;
        if (n.type === 'custom:hk-heading-card' && (p = local(n.navigation_path)) && !have[p]) {
          var to = elsewhere(p);
          if (to) n.navigation_path = to; else { delete n.navigation_path; delete n.chevron; }
        }
        if (n.type === 'custom:hk-power-load-card' && (p = local(n.link)) && !have[p]) {
          var to2 = elsewhere(p);
          if (to2) n.link = to2; else delete n.link;
        }
        Object.keys(n).forEach(function (k) { walk(n[k]); });
      });
    }

    // THE ENERGY PAGE (the Energy feature's), drawn from its plan -- the
    // settings feed's `energy` (features/energy/plan.py): the readings row
    // (today's cost, thermostats, outside), the whole home's live graph, a
    // fortnight of daily use for the devices that matter, a section of live
    // tiles for each group of devices, and Home Assistant's own energy charts.
    // null when the feature is not added. `has`: the pages this screen has
    // (a thermostat opens Climate when there is one, else its sheet);
    // `first`: the screen's first page, with no menu -- no back button.
    // the reading tiles' grid: a tall tile and the gap a row. The last row
    // keeps its gap, as a room's pills keep theirs (pillGrid's `space`): with
    // the heading's 21 px above its text, the next section's name sits 32 px
    // below these tiles and 11 px above its own, as on Lights, Climate and
    // every room-style page (it was paid back, and Energy's and Power's
    // sections sat 13 px closer -- 2026-10-18; client_smoke measures both)
    function trackGrid() {
      var T = TL();
      return { 'grid-auto-flow': 'dense', 'grid-auto-rows': (T.tall + T.gridGap) + 'px', 'grid-column-gap': T.gridGap + 'px',
               'grid-row-gap': '0px', 'grid-template-columns': 'repeat(auto-fill, var(--hk-track, ' + T.w + 'px))',
               margin: '0px', padding: '0px var(--hk-pill-end, 0px) 0px 0px' };
    }
    var BATTERY_STEPS = [{ at_least: 60, color: 'green' }, { at_least: 25, color: 'yellow' }, { color: 'red' }];
    function energyHeading(name, link) {
      // the 21px row with 21 above it and none below: the text at a room
      // heading's place in the section's rhythm (trackGrid)
      var hd = { type: 'custom:hk-heading-card', name: name, height: '42px', padding: '21px 0px 0px 3px' };
      if (link && link.path) {
        hd.navigation_path = link.path;
        hd.chevron = (link.text || 'More') + (/›$/.test(link.text || '') ? '' : '›');
      }
      return hd;
    }
    function energyView(client, view, has, first) {
      var P = added('energy') ? setting('energy') : null;
      if (!P || typeof P !== 'object') return null;
      has = has || {};
      var body = [];
      // ONE PAGE, FOUR TABS (hk-energy.js THE ENERGY PAGE): the tabs, then one
      // three-column grid -- the summary across two columns and the highlights
      // beside it, Where it went across all three, and the period's shape with
      // the battery and water (or gas) beside it. Every card keeps its size and
      // place on every tab; only what is in it changes. The readings and the
      // whole home's live line are the summary's Now. The cards read the plan
      // and HA's Energy settings themselves, so they carry no config here.
      var src = P.sources || {};
      var hasHouse = (P.sections || []).some(function (s) {
        return (s.items || []).some(function (i) { return i.kind === 'battery' && i.house; });
      });
      // WHAT SITS BESIDE YOUR DAY: the house battery (HA's battery, or the
      // plan's house battery before HA's settings reached the plan), then water,
      // then gas -- two at most. Your Day takes the columns they leave.
      var beside = [];
      if (src.battery || hasHouse) beside.push({ type: 'custom:hk-energy-battery-card' });
      if (src.water) beside.push({ type: 'custom:hk-energy-water-card', source: 'water' });
      if (src.gas && beside.length < 2) beside.push({ type: 'custom:hk-energy-water-card', source: 'gas' });
      beside = beside.slice(0, 2);
      var page = P.page || {};
      var showHl = page.highlights !== false;
      // THE COLUMNS AT EACH WIDTH: three on a wall tablet and a computer, two
      // in the iPad band, one on a phone (css/hk-responsive.css sets the
      // --hk-energy-* spans there; elsewhere each var() falls back to its own
      // value here). The pills' gap less 8 px between columns: every grid
      // child has 4 px side margins, so the gap you see is the tiles' own.
      var grid = { type: 'custom:hk-grid-card', layout: {
        'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))',
        'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' }, cards: [
          { type: 'custom:hk-energy-hero-card', view_layout: { 'grid-column': showHl ? 'var(--hk-energy-hero, span 2)' : '1 / -1' } }
        ] };
      // a thermostat in the readings opens this screen's Climate page, as the
      // readings row's tiles did (no Climate page: its sheet)
      if (has.climate) grid.cards[0].climate_path = './climate';
      if (showHl) grid.cards.push({ type: 'custom:hk-energy-highlights-card', view_layout: { 'grid-column': 'var(--hk-energy-hl, auto)' } });
      grid.cards.push({ type: 'custom:hk-energy-where-card', view_layout: { 'grid-column': '1 / -1' } });
      grid.cards.push({ type: 'custom:hk-energy-day-card', view_layout: {
        'grid-column': beside.length ? 'var(--hk-energy-day, span ' + (3 - beside.length) + ')' : '1 / -1' } });
      beside.forEach(function (c) {
        if (beside.length === 1) c.view_layout = { 'grid-column': 'var(--hk-energy-one, auto)' };
        grid.cards.push(c);
      });
      // NOTHING TO DRAW YET (no meter, no device): where to start, below
      var T = P.total || {};
      if (T.stat || T.power || (P.sections || []).length) {
        body.push({ type: 'custom:hk-energy-period-card' });
        body.push(grid);
      }
      // TRACKING: the meters and runtimes a house chose to follow (HK Settings
      // -> Energy -> Tracking; the plan's own daily bars), one card of rows that
      // follow the tabs. Automatic ones are each device's sheet.
      if (P.usages_auto === false && (P.usages || []).some(function (u) { return u && (u.stat || u.entity); })) {
        body.push(energyHeading('Tracking'));
        body.push({ type: 'custom:hk-energy-tracking-card' });
      }
      // THE SECTIONS: a tile per device that follows the tabs (watts and the
      // last three hours on Now, kWh against its usual on the others), and the
      // batteries (their level, and a car's range). The heading carries the
      // section's dot and total.
      var backedKeys = {}, PW = P.power;
      if (PW && PW.backs_up === 'some') (PW.sections || []).forEach(function (s) {
        (s.items || []).forEach(function (i) { if (i.backed) backedKeys[i.key] = true; });
      });
      (P.sections || []).forEach(function (s) {
        var peers = (s.items || []).filter(function (i) { return i.kind === 'device' && i.stat; })
          .map(function (i) { return i.stat; });
        var tiles = (s.items || []).map(function (i) {
          if (i.kind === 'battery') {
            var bt = { type: 'custom:hk-rank-card', entity: i.entity, name: i.name, icon: i.icon, mode: 'pct',
                       icon_color_steps: BATTERY_STEPS, energy: true, section: s.id };
            if (i.label) {
              bt.label_entity = i.label;
              bt.label_suffix = i.label_suffix || '';
              if (i.label_decimals) bt.label_decimals = i.label_decimals;
            }
            return bt;
          }
          var t = { type: 'custom:hk-rank-card', entity: i.power || i.stat, name: i.name, icon: i.icon,
                    icon_color: i.color, energy: true, section: s.id };
          if (i.stat) { t.stat = i.stat; t.peers = peers; }
          if (!i.power) t.mode = 'energy';
          if (i.control) t.control = i.control;
          // BACKED UP BY THE HOUSE BATTERY (the Power page's own finding): the
          // same small badge as there
          if (backedKeys[i.key]) t.backed = true;
          return t;
        }).filter(function (t) { return t.entity; });
        if (!tiles.length) return;
        var hd = energyHeading(s.name, s.link);
        hd.energy_section = s.id;
        // its height is a minimum (hk-stat.js): the same 42px, and room for
        // the total's own line on a phone
        body.push(hd);
        body.push({ type: 'custom:hk-grid-card', cards: tiles, layout: trackGrid() });
      });
      // HOME ASSISTANT'S OWN CHARTS, at the end (HK Settings -> Energy -> Home
      // Assistant's Charts)
      if (P.detail) {
        body.push(energyHeading('Home Assistant’s Charts'));
        body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-date-selection' }, margin: '0px 0px 12px 0px' });
        body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-sources-table' }, margin: '0px 0px 12px 0px',
                    phone: 'hide', vars: { 'card-background-color': 'transparent', 'divider-color': 'rgba(255,255,255,0.13)' } });
        body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-devices-detail-graph' }, margin: '0px 0px 12px 0px' });
        body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-devices-graph' } });
      }
      if (!body.length) {
        body.push({ type: 'markdown', content: 'Nothing to show yet: add devices in Home Assistant’s Energy settings, ' +
          'or on ' + window.hkShell.settingsPlace('Pages → Energy') + '.' });
      }
      var title = P.title || 'Energy';
      var bar = titleBar(title);
      if (first) bar.cards = bar.cards.slice(1);
      if (first) bar.layout = Object.assign({}, bar.layout, { 'grid-template-columns': 'minmax(0, 1fr)' });
      // THE COLUMN PAYS BACK ITS CHILDREN'S 4 px SIDE MARGINS, so the page's
      // headings, cards and reading tiles start where Home's do and its tile
      // grid is as wide as Home's -- one nesting level deeper it was 8 px
      // narrower, which at 1,280 is six 196 px pills or five
      var col = column(body);
      col.layout = Object.assign({}, col.layout, { margin: '0px -4px' });
      return view({ title: title, path: 'energy', subview: !first, icon: 'mdi:lightning-bolt', sky_variant: 'energy',
                    background: '#171d12', cards: [bar, col] });
    }

    // THE POWER PAGE (features/energy/power.py; PLAN-2026-10-12-home-power):
    // right now and the controls, beside the Energy page (over time). The house
    // full width; the status beside the house battery, then The House beside
    // Where the Sun Goes; the battery's own Mode and Levels; a tile per car;
    // every device, each marked when the house battery backs it up. Its
    // address is the plan's `path`, so the page can take over a custom page's
    // address on every screen that lists it.
    function powerView(client, view) {
      var P = added('energy') ? setting('energy') : null, W = P && P.power;
      if (!W || typeof W !== 'object') return null;
      var B = W.battery || {}, hasBat = !!B.level, hasSun = !!W.solar;
      var cars = Array.isArray(W.cars) ? W.cars : [];
      var span = function (v) { return { 'grid-column': v }; };
      var body = [];
      // THE HOUSE: the layered picture, or the flow chart
      var carsOf = cars.map(function (c) { return { name: c.name, level: c.level, power: c.power, home: c.home, plugged: c.plugged, charge: c.charge, charger: c.charger }; });
      // THE WALL CHARGERS (the plan's own, else the Energy plan's charging
      // devices that are chargers): their watts are live, a car's own lag
      var CHG = /wall.?connector|charger|evse|wallbox/i, chargers = Array.isArray(W.chargers) ? W.chargers.slice() : [];
      if (!chargers.length) (W.sections || []).forEach(function (s) {
        (s.items || []).forEach(function (i) {
          if (i.power && (CHG.test(i.power) || CHG.test(i.name || '')) && i.power !== B.charge && i.power !== B.discharge) chargers.push(i.power);
        });
      });
      if (W.picture !== false) {
        body.push({ type: 'custom:hk-power-house-card', art: W.art, home: W.home, grid: W.grid, grid_export: W.grid_export,
                    grid_status: W.grid_status, solar: W.solar, level: B.level, charge: B.charge, discharge: B.discharge,
                    reserve: B.reserve, cars: carsOf, chargers: chargers });
      } else {
        body.push({ type: 'custom:hk-power-flow-card', grid: W.grid, home: W.home, level: B.level, grid_status: W.grid_status,
                    charge: B.charge, discharge: B.discharge });
      }
      // THE CARDS UNDER IT, in pairs as tall as each other
      var devices = [];
      (W.sections || []).forEach(function (s) {
        (s.items || []).forEach(function (i) { if (i.power) devices.push({ name: i.name, power: i.power, backed: !!i.backed, parent: !!i.parent }); });
      });
      var status = { type: 'custom:hk-power-status-card', grid_status: W.grid_status, problem: B.problem, level: B.level,
                     backup: B.backup, home: W.home, charge: B.charge, discharge: B.discharge, eps: B.eps, storm: B.storm,
                     solar: W.solar, grid: W.grid, cars: carsOf, chargers: chargers };
      var load = { type: 'custom:hk-power-load-card', home: W.home, backed_power: W.backed_power, grid_status: W.grid_status,
                   devices: devices, cars: carsOf, chargers: chargers, link: './energy' };
      var sun = hasSun ? { type: 'custom:hk-power-sun-card', solar: W.solar, grid: W.grid, grid_export: W.grid_export,
                           home: W.home, charge: B.charge, discharge: B.discharge } : null;
      var cards = [];
      if (hasBat) {
        cards.push(Object.assign(status, { view_layout: span('var(--hk-energy-hl, auto)') }));
        cards.push({ type: 'custom:hk-house-battery-card', level: B.level, stored: B.stored, backup: B.backup, reserve: B.reserve,
                     limit: B.limit, speed: B.speed, charge: B.charge, discharge: B.discharge, eps: B.eps, packs: B.packs,
                     view_layout: span('var(--hk-energy-hero, span 2)') });
        cards.push(Object.assign(load, { view_layout: span(sun ? 'var(--hk-energy-hl, auto)' : '1 / -1') }));
        if (sun) cards.push(Object.assign(sun, { view_layout: span('var(--hk-energy-hero, span 2)') }));
      } else {
        cards.push(Object.assign(status, { view_layout: span('var(--hk-energy-hl, auto)') }));
        cards.push(Object.assign(load, { view_layout: span('var(--hk-energy-hero, span 2)') }));
        if (sun) cards.push(Object.assign(sun, { view_layout: span('1 / -1') }));
      }
      // each pair as tall as its taller card
      cards.forEach(function (c) { c.fill = true; });
      body.push({ type: 'custom:hk-grid-card', layout: {
        'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))',
        'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' }, cards: cards });
      var oneCol = { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' };
      // THE BATTERY'S OWN CONTROLS: its mode, its levels
      if (W.mode && W.mode.entity) {
        body.push(energyHeading('Mode'));
        var seg = { type: 'custom:hk-segment-card', entity: W.mode.entity };
        if (W.mode.options) seg.options = W.mode.options;
        body.push({ type: 'custom:hk-grid-card', layout: oneCol, cards: [seg] });
      }
      if ((W.levels || []).length) {
        body.push(energyHeading('Levels'));
        body.push({ type: 'custom:hk-grid-card', layout: Object.assign({}, oneCol, { 'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))' }),
          cards: W.levels.map(function (l, i) {
            var s = { type: 'custom:hk-slider-card', entity: l.entity, name: l.name, layout: 'tile' };
            if (l.icon) s.icon = l.icon;
            if (l.color) s.color = l.color;
            // the last of an odd number: alone in its row in two columns, the row's whole width
            if (W.levels.length % 2 === 1 && i === W.levels.length - 1) s.view_layout = { 'grid-column': 'var(--hk-energy-one, auto)' };
            return s;
          }) });
      }
      // THE CARS: each its level against its limit, its range, and a power
      // button for charging that asks before stopping
      // (in the Energy plan's own Charging section, before its chargers, when
      // the devices are by type; else a Charging heading of their own)
      var carTiles = cars.map(function (c) {
        var t = { type: 'custom:hk-rank-card', entity: c.level, name: c.name, icon: 'hk:car', mode: 'pct', icon_color_steps: BATTERY_STEPS };
        if (c.range) { t.label_entity = c.range; t.label_suffix = ' mi range'; }
        if (c.charge) { t.control = c.charge; t.control_yes = 'Stop Charging'; t.control_detail = 'The car stops charging until you start it again.'; }
        return t;
      });
      var byType = !(W.groups === 'backup' && W.backs_up === 'some');
      var chargingSec = byType && (W.sections || []).some(function (s) { return s.id === 'charging'; });
      if (carTiles.length && !chargingSec) {
        body.push(energyHeading('Charging'));
        body.push({ type: 'custom:hk-grid-card', layout: trackGrid(), cards: carTiles });
      }
      // EVERY DEVICE, by type (as on the Energy page) or backed up first
      var tile = function (i) {
        var t = { type: 'custom:hk-rank-card', entity: i.power || i.stat, name: i.name, icon: i.icon, icon_color: i.color, energy: 'now' };
        if (i.stat) t.stat = i.stat;
        if (!i.power) t.mode = 'energy';
        if (i.control) t.control = i.control;
        if (i.backed && W.backs_up === 'some') t.backed = true;
        return t;
      };
      var groups = (W.sections || []).map(function (s) { return { id: s.id, name: s.name, items: s.items || [] }; });
      if (!byType) {
        var all = [].concat.apply([], groups.map(function (g) { return g.items; }));
        groups = [{ name: 'Backed Up', items: all.filter(function (i) { return i.backed; }) },
                  { name: 'Not Backed Up', items: all.filter(function (i) { return !i.backed; }) }];
      }
      groups.forEach(function (g) {
        var tiles = g.items.map(tile).filter(function (t) { return t.entity; });
        if (g.id === 'charging' && chargingSec) tiles = carTiles.concat(tiles);
        if (!tiles.length) return;
        body.push(energyHeading(g.name));
        body.push({ type: 'custom:hk-grid-card', cards: tiles, layout: trackGrid() });
      });
      var title = W.title || 'Power';
      var col = column(body);
      col.layout = Object.assign({}, col.layout, { margin: '0px -4px' });
      return view({ title: title, path: W.path || 'power', subview: true, icon: 'mdi:home-lightning-bolt', sky_variant: 'power',
                    background: '#121634', cards: [titleBar(title), col] });
    }

    // THE PHOTO SCREENSAVER (a generated wall tablet's Screen page):
    // HK Frontend's own (hk-saver.js), or WallPanel (HACS) for a screen that
    // chooses it -- either way for the tablet's own user only (a desk opening
    // the same dashboard never gets it), with the house's photos, and the wall
    // tablet's screensaver content (the clock, the weather, what is playing,
    // the running timers). Its helper, the one a tablet's automations read, is
    // input_boolean.wallpanel_screensaver_<its room> -- the name predates
    // HK's own screensaver and is kept, so no automation has to change.
    function screensaverOf(client, b) {
      // 1.14: the screensaver is a WALL TABLET's -- this page's
      // (hkSettings.tablet(): its ?hk_tablet=, else its user), whatever screen
      // it shows; the block names it, and only that tablet runs it
      var HS = window.hkSettings;
      if (HS && HS.get && HS.get('tablet_items', null) !== null) {
        var t = typeof HS.tablet === 'function' ? HS.tablet(client) : null;
        if (!b || !b.screensaver) return null;
        // NOT A TABLET (a desk, HK Settings' preview): the block names the
        // screen's own tablet, or none -- the gate keeps it from running here,
        // and the preview (hkSaver.preview, forced) still has it to show
        if (!t) {
          var items = HS.get('tablet_items', {}) || {}, first = (b.tablets || []).filter(function (k) { return items[k]; })[0];
          t = first ? Object.assign({ id: first }, items[first]) : { id: '-', user: '', room: '', screensaver_switch: null };
        }
        if (b.screensaver_engine === 'wallpanel' && !t.room) return null;
        var old = t.room ? 'input_boolean.wallpanel_screensaver_' + t.room : null;
        if (old && !client.states[old]) old = null;
        var mineSw = t.screensaver_switch && client.states[t.screensaver_switch] ? t.screensaver_switch : null;
        var temp1 = String((client.config && client.config.unit_system && client.config.unit_system.temperature) || '');
        return { user: t.user, tablet: t.id, entity: b.screensaver_engine === 'wallpanel' ? old : (mineSw || old),
                 unit: /C/.test(temp1) ? 'C' : /F/.test(temp1) ? 'F' : '',
                 photos: setting('look.photos') || 'media-source://media_source/local/photos' };
      }
      if (!b || !b.screensaver || !b.tablet_user) return null;
      // HK Frontend's own switch for the screen (screensaver.py), else the old
      // input_boolean.wallpanel_screensaver_<Tablet Room> a house may still
      // have (and WallPanel can only use an input_boolean)
      var legacy = b.idle_room ? 'input_boolean.wallpanel_screensaver_' + b.idle_room : null;
      if (legacy && !client.states[legacy]) legacy = null;
      var own = b.screensaver_switch && client.states[b.screensaver_switch] ? b.screensaver_switch : null;
      var ent = b.screensaver_engine === 'wallpanel' ? legacy : (own || legacy);
      // the temperature's letter on the screensaver ("68°F"): Home
      // Assistant's unit system's
      var temp = String((client.config && client.config.unit_system && client.config.unit_system.temperature) || '');
      return { user: b.tablet_user, entity: ent, unit: /C/.test(temp) ? 'C' : /F/.test(temp) ? 'F' : '',
               photos: setting('look.photos') || 'media-source://media_source/local/photos' };
    }
    var SAVER_CARDS = [
      { type: 'custom:hk-clock-card', time_size: '150px', ampm_size: '40px', date_size: '40px',
        time_letter_spacing: '0px', ampm_letter_spacing: '0.37px', date_letter_spacing: '0.37px',
        time_line_height: '1', date_format: 'monthday', date_gap: '4px', gap: '8px',
        color: 'rgba(255,255,255,0.95)', ampm_color: 'rgba(255,255,255,0.70)', date_color: 'rgba(255,255,255,0.85)',
        margin: '0px 0px 0px 20px', clip: false, layer: true },
      { type: 'custom:hk-weather-strip-card', variant: 'inline', unit: 'F', main_size: '36px', main_letter_spacing: '0.37px',
        glyph_size: '60px', temp_gap: '36px', icon_gap: '12px', color: 'rgba(255,255,255,0.95)',
        margin: '-4px 0px 0px 20px', layer: true },
      { type: 'custom:hk-screensaver-now-card', music: true },
      { type: 'custom:hk-timer-strip-card', entity: 'sensor.running_quick_timers', scale: 1.6, fixed: true },
      // top-right: the house at a glance (HK's own screensaver only)
      { type: 'custom:hk-screensaver-status-card' }
    ];
    // HK FRONTEND'S OWN SCREENSAVER (hk-saver.js): the block it reads from the
    // dashboard's config. `cards` are the same four as WallPanel's, less the
    // ones the screen turned off (Over the Photos).
    // every Show hk-saver.js draws (model.py SAVER_SHOWS); anything else is photos
    var SAVER_SHOW_KEYS = ['photos', 'both', 'forecast', 'clock', 'glance', 'month', 'day'];
    function hkSaver(sv, o) {
      o = o || {};
      var cards = JSON.parse(JSON.stringify(SAVER_CARDS));
      if (sv.unit) cards[1].unit = sv.unit; else delete cards[1].unit;
      // the corner clock: not under a Large clock, nor on Show: Clock (the
      // clock is the screensaver there) -- except while the music slide
      // covers that clock (Music First), when it tells the time as it does
      // over the photos (music_only: hk-saver.js shows it only then)
      var big = o.clock_over === 'large' || o.show === 'clock';
      if (big) cards[0].music_only = true;
      var keep = [o.clock !== false, o.weather !== false, o.music !== false, o.timers !== false, o.status !== false];
      return {
        user: sv.user, entity: sv.entity || null, photos: sv.photos,
        // 1.14: the wall tablet it runs on (hk-saver.js gate)
        tablet: sv.tablet || '',
        starts_after: o.starts_after || 180, each_photo: o.each_photo || 30,
        order: o.order === 'sorted' ? 'sorted' : 'random',
        fill: o.fill !== false, zoom: o.zoom === true,
        show: SAVER_SHOW_KEYS.indexOf(o.show) >= 0 ? o.show : 'photos', fallback: o.fallback !== false,
        // the HomeView-style faces' options (hk-saver.js readCfg checks them)
        forecast_layout: o.forecast_layout, photo_titles: o.photo_titles === true, time_behind: o.time_behind === true,
        day_look: o.day_look, forecast_big: o.forecast_big, forecast_planted: o.forecast_planted !== false, layout: o.layout || null, tb_size: o.tb_size, tb_top: o.tb_top, tb_dim: o.tb_dim,
        // the clocks (hk-saverclock.js; hk-saver.js readCfg checks them)
        clock: o.clock !== false, clock_over: o.clock_over, clock_style: o.clock_style, clock_bg: o.clock_bg,
        clock_motion: o.clock_motion, clock_24: o.clock_24 === true, clock_today_music: o.clock_today_music !== false, clock_today_weather: o.clock_today_weather !== false,
          clock_colors: o.clock_colors, clock_options: o.clock_options, clock_speed: o.clock_speed, clock_depth: o.clock_depth,
        clock_night: o.clock_night, clock_night_from: o.clock_night_from, clock_night_to: o.clock_night_to,
        // a Wallpaper behind the clock (2026-10-31; hk-saverclock.js draws it, hkWallpapers checks both)
        clock_wallpaper: o.clock_wallpaper, clock_wallpaper_color: o.clock_wallpaper_color,
        // the mosaic (hk-saver.js readCfg checks them)
        photo_layout: o.photo_layout, mosaic_count: o.mosaic_count, mosaic_gap: o.mosaic_gap, mosaic_change: o.mosaic_change,
        mosaic_line: o.mosaic_line, mosaic_color: o.mosaic_color, mosaic_random: o.mosaic_random, mosaic_every: o.mosaic_every,
        clock_photo_soft: o.clock_photo_soft, clock_photo_dim: o.clock_photo_dim, clock_text_shadow: o.clock_text_shadow, clock_text_outline: o.clock_text_outline,
        // Home Energy and the additional screens (hk-saver.js readCfg checks them)
        energy_slide: o.energy_slide === true, extra_music: o.extra_music === true, extra_forecast: o.extra_forecast === true,
        extra_every: o.extra_every, extra_for: o.extra_for, energy_hide: Array.isArray(o.energy_hide) ? o.energy_hide.slice() : [],
        weather_slide: o.weather_slide === true, weather_hide: Array.isArray(o.weather_hide) ? o.weather_hide.slice() : [], timer_slide: o.timer_slide !== false, timer_often: o.timer_often,
          holiday_slide: o.holiday_slide === true, holiday_pick: o.holiday_pick, holiday_one: o.holiday_one, holiday_days: o.holiday_days, holiday_fx: o.holiday_fx,
        corner_time_size: o.corner_time_size || 100, corner_hide: Array.isArray(o.corner_hide) ? o.corner_hide.slice() : [],
        music_hide: Array.isArray(o.music_hide) ? o.music_hide.slice() : [], holiday_off: (o.holiday_off || []).slice(), holiday_own: JSON.parse(JSON.stringify(o.holiday_own || [])),
          holiday_outdoors: (o.holiday_outdoors || []).slice(), holiday_hide: (o.holiday_hide || []).slice(),
        forecast_every: o.forecast_every || 5,
        band: o.band !== false, band_photos: o.band_photos === true,
        calendar: o.calendar === true, calendar_days: o.calendar_days || 2,
        music_slide: o.music_slide === true, music_pane: o.music_pane === true, music_first: o.music_first === true,
        fade_back: typeof o.fade_back === 'number' ? o.fade_back : 500,
        // portrait and landscape photos, each their own (hk-saver.js shapeCfg
        // checks them): passed as they are
        portrait_fill: o.portrait_fill === true,
        portrait_blur: o.portrait_blur, portrait_dim: o.portrait_dim, portrait_zoom: o.portrait_zoom, portrait_x: o.portrait_x, portrait_y: o.portrait_y,
        landscape_blur: o.landscape_blur, landscape_dim: o.landscape_dim, landscape_zoom: o.landscape_zoom, landscape_x: o.landscape_x, landscape_y: o.landscape_y,
        cards: cards.filter(function (c, i) { return keep[i]; })
      };
    }
    // HIDE HOME ASSISTANT'S HEADER AND SIDEBAR (a screen's Hide Home Assistant
    // Header & Sidebar): null, 'kiosk_mode' (the plugin does it), or the block
    // hk-kiosk.js reads -- the same one a YAML dashboard can write as hk_kiosk.
    function kioskOf(b) {
      if (!b || !b.kiosk) return null;
      // (no kiosk_engine: an integration older than 1.3 -- its screens with
      // Kiosk Mode Options of their own were the plugin's, as settings.py says)
      var eng = b.kiosk_engine || (b.kiosk_options && Object.keys(b.kiosk_options).length ? 'kiosk_mode' : 'hk');
      if (eng === 'kiosk_mode') return 'kiosk_mode';
      return { header: b.kiosk_header !== false, sidebar: b.kiosk_sidebar !== false, admins: b.kiosk_admins !== false };
    }
    // A SCREEN'S hk_screensaver BLOCK FROM ITS SETTINGS ALONE, for a dashboard
    // HK Frontend does not draw (an existing dashboard given HK settings):
    // hk-saver.js asks for it when the dashboard's own config has no
    // hk_screensaver. HK Frontend's own screensaver only -- WallPanel reads its
    // block from the dashboard itself. null: no screensaver for this screen.
    function saverBlock(client, b) {
      if (!client || !b || b.screensaver_engine === 'wallpanel') return null;
      var sv = screensaverOf(client, b);
      return sv ? hkSaver(sv, b.screensaver_options) : null;
    }
    // A THIRD-PARTY CARD'S OWN OPTIONS over the tuned settings:
    // key by key, into nested mappings; a list or a value replaces; `key: null`
    // removes one. Never changes `base`.
    function overlay(base, over) {
      var out = JSON.parse(JSON.stringify(base || {}));
      if (!over || typeof over !== 'object' || Array.isArray(over)) return out;
      Object.keys(over).forEach(function (k) {
        var v = over[k];
        if (v === null) { delete out[k]; return; }
        var plain = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
        out[k] = plain(v) && plain(out[k]) ? overlay(out[k], v) : JSON.parse(JSON.stringify(v));
      });
      return out;
    }
    function wallpanel(sv) {
      var cards = JSON.parse(JSON.stringify(SAVER_CARDS)).slice(0, 4);
      if (sv.unit) cards[1].unit = sv.unit; else delete cards[1].unit;
      var profiles = {};
      profiles['user.' + sv.user] = { enabled: true };
      var wp = {
        enabled: false, profiles: profiles, idle_time: 180, display_time: 30, control_reactivation_time: 3,
        fade_out_time_motion_detected: 0.1, fade_out_time_screensaver_entity: 0.1,
        image_animation_ken_burns: true, image_animation_ken_burns_zoom: 1.1,
        image_url: sv.photos, image_fit_landscape: 'cover', image_background: 'image', media_order: 'random',
        cards: cards,
        style: {
          'wallpanel-screensaver-info-box-content': { '--ha-card-background': 'none', '--ha-card-box-shadow': 'none',
            '--ha-card-border-width': '0px', '--primary-text-color': '#ffffff', '--secondary-text-color': '#dddddd',
            'text-shadow': '0px 2px 8px rgba(0, 0, 0, 0.30), 0px 6px 28px rgba(0, 0, 0, 0.26), 0px 12px 68px rgba(0, 0, 0, 0.34)',
            '--font-weight': 'bold', 'font-size': '15px', 'letter-spacing': '-0.23px' },
          'wallpanel-screensaver-info-box': { '--wp-card-width': '600px', background: 'none', 'box-shadow': 'none' },
          'wallpanel-screensaver-image-background': { filter: 'blur(40px) brightness(80%)', 'will-change': 'transform' },
          'wallpanel-screensaver-image-one': { 'will-change': 'transform' },
          'wallpanel-screensaver-image-two': { 'will-change': 'transform' },
          'wallpanel-screensaver-image-one-container': { 'will-change': 'opacity' },
          'wallpanel-screensaver-image-two-container': { 'will-change': 'opacity' }
        }
      };
      // THE HELPER IS WRITTEN FROM THE TABLET'S OWN USER ONLY. WallPanel's element
      // connects in every browser that opens the dashboard, enabled or not, and
      // sets screensaver_entity to "is MY screensaver running" -- so a desk
      // opening /dashboard-kitchen turned the kitchen tablet's helper off (107
      // times from one desk user, 09-27..29) until the tablet's own idle timer
      // put it back 180 s later. WallPanel merges the user's profile before it
      // connects, so in the profile only the tablet has a helper to write.
      if (sv.entity) profiles['user.' + sv.user].screensaver_entity = sv.entity;
      return wp;
    }
    // THE DOCKED BAR along the bottom: the Now Playing Bar (the player, while
    // music plays) and the Timer Bar (the running quick timers, a slim row over
    // it) -- a screen's two switches, each its own part of the one bar.
    var MUSIC_PAGE = { playmusic: true, 'music-browse': true };
    function dockCard(bar) {
      return { type: 'custom:hk-grid-card', view_layout: COL2,
        layout: { 'grid-template-columns': '1fr', 'grid-column-gap': '0px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' },
        cards: [bar] };
    }
    function mediaBar(withMusic, withTimers) {
      var bar = { type: 'custom:hk-now-playing-card', bar: true, music: true, hide_idle: true,
        meta_card: { type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: ['volume'], entity_from: { music: true } },
        sub_card: { type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: ['progress'], phone_times: false, entity_from: { music: true } } };
      // DOCKED (2026-10-10): the screen's bottom edge, full width, square, a
      // hairline on top and a shadow up onto the page, which ends above it --
      // not a rounded bar floating over it. The very bottom of the screen (its
      // controls clear of a phone's home indicator); a tab bar rides above it.
      return { type: 'custom:hk-popup-card', hash: '#media', position: 'bottom', modal: false, dock: true,
        padding: '0', radius: '0',
        vars: { 'hk-np-height': 'calc(104px + env(safe-area-inset-bottom, 0px))',
                'hk-np-pad': '12px 24px calc(12px + env(safe-area-inset-bottom, 0px))',
                'hk-np-radius': '0', 'hk-np-plate': 'rgb(22,23,26)',
                // Speakers and Browse on either side of the transport, as on
                // the screensaver (2026-10-11); the volume gives up the room
                // (no close button: swiped down to put away, hk-media.js)
                'hk-np-areas': '"art title . spk prev play next stop brw . meta" "art artist . spk prev play next stop brw . meta" "art sub . spk prev play next stop brw . meta"',
                'hk-np-cols': '72px minmax(220px, max-content) 1fr 56px 64px 64px 64px 64px 56px 1fr minmax(0, 380px)',
                'hk-np-rows': 'auto auto auto', 'hk-np-gap': '14px' },
        width: '100%', max_width: '100%', background: 'transparent', dismissable: true,
        // swiped away, a speaker in the corner brings it back (hk-popup.js)
        stash: { icon: 'hk:homepod', label: 'Show Now Playing' },
        dismiss_scope: [].concat(withMusic ? [{ music: true }] : [], withTimers ? [{ entity: 'sensor.running_quick_timers', above: 0 }] : []),
        trigger: [{ condition: 'or', conditions: [].concat(
          withTimers ? [{ condition: 'numeric_state', entity: 'sensor.running_quick_timers', above: 0 }] : [],
          // (grace: the house's Hide After a Pause, read live -- hk-popup.js)
          // ...while the Side Pane doesn't show it (2026-10-30, hk-sidepane.js
          // says so with `hk-pane-music`)
          withMusic ? [{ condition: 'and', conditions: [
            { condition: 'state', entity_from: { music: true }, state: 'playing', grace: 'now_playing' },
            { condition: 'not', conditions: [{ condition: 'flag', flag: 'hk-pane-music' }] }] }] : []) }],
        trigger_close: true,
        // NOW PLAYING'S PLACE (2026-10-15, the screen's Now Playing; hk-popup.js
        // placeFor): this bar along the bottom or the top (top_vars: its inset
        // at the top of the screen, not the bottom). Its old side pane is the
        // Side Pane's (2026-10-30): `pane` now says the bar holds the music the
        // Side Pane may take over (hk-popup.js npin)
        pane: !!withMusic,
        top_vars: { 'hk-np-height': 'calc(104px + env(safe-area-inset-top, 0px))',
                    'hk-np-pad': 'calc(12px + env(safe-area-inset-top, 0px)) 24px 12px' },
        // the timers on the same plate, a slim row over the player (docked)
        cards: [].concat(withTimers ? [{ type: 'custom:hk-timer-strip-card', docked: true }] : [],
                         withMusic ? [bar] : []) };
    }

    // what the shell and the later parts use of this one
    K.customPages = customPages; K.customView = customView; K.dockCard = dockCard; K.energyLinks = energyLinks;
    K.energyView = energyView; K.hkSaver = hkSaver; K.kioskOf = kioskOf; K.mediaBar = mediaBar;
    K.MUSIC_PAGE = MUSIC_PAGE; K.onlyPages = onlyPages; K.overlay = overlay; K.pagesScreen = pagesScreen;
    K.powerView = powerView; K.saverBlock = saverBlock; K.screensaverOf = screensaverOf; K.skyPages = skyPages;
    K.standalone = standalone; K.wallpanel = wallpanel;
  };
})();
