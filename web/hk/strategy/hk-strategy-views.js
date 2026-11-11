// hk-strategy-views.js - the views and the dashboard strategy.
//
// PART OF THE DASHBOARD STRATEGY (hk-strategy.js). Not a card and not run on its own: it registers one
// function, which hk-strategy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkStrategyParts = window.hkStrategyParts || {})['hk-strategy-views'] = function (K) {
    var accName = K.accName, added = K.added, areaOf = K.areaOf, boardOf = K.boardOf, cameraStrip = K.cameraStrip,
        cardsReady = K.cardsReady, categoryPages = K.categoryPages, catPlace = K.catPlace, clientOf = K.clientOf,
        COL2 = K.COL2, column = K.column, customPages = K.customPages, customView = K.customView, dashSeg = K.dashSeg,
        dockCard = K.dockCard, energyLinks = K.energyLinks, energyView = K.energyView, favorites = K.favorites,
        firstOf = K.firstOf, fold = K.fold, friendly = K.friendly, fullName = K.fullName, gridReady = K.gridReady,
        guarded = K.guarded, HEADER_H = K.HEADER_H, headerGrid = K.headerGrid, headerOn = K.headerOn,
        headerOpts = K.headerOpts, hidden = K.hidden, hkSaver = K.hkSaver, homeGridView = K.homeGridView,
        houseBattery = K.houseBattery, houseCameras = K.houseCameras, inputs = K.inputs, inventory = K.inventory,
        kioskOf = K.kioskOf, kioskTheme = K.kioskTheme, listOf = K.listOf, mediaBar = K.mediaBar,
        MUSIC_PAGE = K.MUSIC_PAGE, musicConfigured = K.musicConfigured, named = K.named, nameOf = K.nameOf,
        onlyPages = K.onlyPages, overlay = K.overlay, ownOrder = K.ownOrder, pageRow = K.pageRow,
        pagesScreen = K.pagesScreen, placed = K.placed, powerView = K.powerView, roomCards = K.roomCards,
        rooms = K.rooms, roomSection = K.roomSection, roomsWith = K.roomsWith, screensaverOf = K.screensaverOf,
        section = K.section, setting = K.setting, skyPages = K.skyPages, slug = K.slug, SPAN1 = K.SPAN1,
        SPAN2 = K.SPAN2, SPAN_ALL = K.SPAN_ALL, standalone = K.standalone, tileFor = K.tileFor, titleBar = K.titleBar,
        TL = K.TL, VIEW_LAYOUT = K.VIEW_LAYOUT, wallpanel = K.wallpanel, watch = K.watch;

    function views(client, opts, music) {
      var themes = (client.themes && client.themes.themes) || {};
      var theme = opts.theme || kioskTheme(themes);
      var sky = opts.sky !== false;
      var weather = (window.hkSettings && window.hkSettings.weatherId(client.states)) || firstOf(client, 'weather');
      var alarm = setting('security.alarm') || firstOf(client, 'alarm_control_panel');
      // Left out means left out everywhere -- its page and its header link too.
      if (weather && hidden(client, opts, weather)) weather = null;
      if (alarm && hidden(client, opts, alarm)) alarm = null;

      function view(o) {
        var v = Object.assign({ type: 'custom:hk-grid-view', layout: VIEW_LAYOUT, background: '#05070e' }, o);
        if (theme) v.theme = theme;
        if (o.sky_variant) { delete v.sky; if (!sky) delete v.sky_variant; }
        else if (sky && o.sky !== false) v.sky = true; else delete v.sky;
        return v;
      }

      var inv = inventory(client, opts);
      // THE CHIP ROW is the dashboard's own (hk-chips-card): which chips, their
      // order and which are quiet come from its item, live -- no rebuild.
      // `in_menu: false`: a generated screen's menu lists every page under
      // Categories, not only the chips' pages (hk-menu.js chipPaths).
      var row = opts.chips === false || (opts.board || {}).chips_row === false ? null
              : { type: 'custom:hk-chips-card', in_menu: false };
      // THIS DASHBOARD'S PAGES (its item's Pages; empty: every page the house
      // has something for), in its order. A page left out is left out of the
      // menu and of every link to it.
      var b = opts.board || {};
      var picked = listOf(b, 'pages');
      var want = function (k) { return picked.length ? picked.indexOf(k) >= 0 : true; };
      // The cameras the item picked for its strip are the Cameras page's too
      // (a house's high-resolution channels and tablet cameras stay off both).
      var cams = listOf(b, 'cameras').length
        ? listOf(b, 'cameras').filter(function (id) { return client.states[id] && !hidden(client, opts, id); })
        : houseCameras(client, opts);
      var hasCams = cams.length > 0 && want('cameras');
      if (!want('weather')) weather = null;
      var alarmId = alarm;                // the #alarm pop-up needs no Security page
      if (!want('security')) alarm = null;
      if (!want('music')) music = false;
      var hdr = { type: 'custom:hk-header-card', weather_path: weather ? './weather' : undefined,
                  alarm_path: alarm ? './security' : undefined };
      // ON PHONES (its Home Page's setting): the clock and weather
      // header, or under 640 px the one-line weather strip in its place
      // IN A CAR'S BROWSER, ITS OWN HOME (the screen's Car Layout: Car Home):
      // the weather and the house's status in one line -- no clock, the car
      // shows the time -- then the chips, the camera strip where it is on,
      // Scenes, Security and Favorites, and no rooms: what the car needs in
      // one screen.
      var carHome = !!(b.car && b.car_layout === 'car');
      if (carHome) hdr.clock = false;
      var tops = b.phone_header === 'strip' && !carHome
        ? [{ type: 'conditional', conditions: [{ condition: 'screen', media_query: '(min-width: 640px)' }], card: hdr },
           { type: 'conditional', conditions: [{ condition: 'screen', media_query: '(max-width: 639.98px)' }],
             card: Object.assign({ type: 'custom:hk-weather-strip-card', margin: '30px 0px 23px 0px' },
                                 weather ? { tap_action: { action: 'navigate', navigation_path: './weather' } } : {}) }]
        : [hdr];
      var header = { type: 'grid', columns: 1, square: false, view_layout: COL2, cards: tops.concat(row ? [row] : [], [
        { type: 'custom:hk-spacer-card', height: '2px' }]) };
      // HOME, in this order: the header and
      // chips, the camera strip, the scenes, the favorites, then the rooms.
      var home = [header];
      var strip = cameraStrip(client, opts, b, hasCams);
      if (strip) home.push(strip);
      home.push({ type: 'custom:hk-scenes-card', view_layout: COL2 });
      // CAR HOME'S SECURITY: the house's garage doors, its alarm and its locks
      // (Status & Chips' lists, the Security page's own order), as a room draws
      // them -- tall tiles -- so arriving and leaving are one look and a tap
      if (carHome) {
        var gates = inv.garage.filter(function (id) { return id.indexOf('cover.') === 0; });
        var guardIds = ownOrder('security', gates).concat(alarmId ? [alarmId] : [], ownOrder('security', inv.locks));
        guardIds = guardIds.filter(function (id) { return client.states[id]; });
        // the names the Security page gives them ("Front Door", not "Front Door
        // Lock"), but the house's alarm without a room in front of it, and a
        // lock that would read like another tile keeping its "Lock" (Garage
        // Door Lock beside the Garage Door)
        var full = guardIds.map(function (id) {
          return id.indexOf('alarm_control_panel.') === 0 ? (accName(id) || nameOf(client, id, (client.entities || {})[id])) : fullName(client, id);
        });
        var short = full.map(function (n, i) { return guardIds[i].indexOf('lock.') === 0 ? n.replace(/ Lock$/, '') : n; });
        var guardTiles = guardIds.map(function (id, i) {
          var clash = short.some(function (n, j) { return j !== i && fold(n) === fold(short[i]); });
          return tileFor(client, id, clash ? full[i] : short[i]);
        }).filter(Boolean);
        if (guardTiles.length) home.push(section('Security', guardTiles));
      }
      var fav = favorites(client, opts, b);
      if (fav) home.push(fav);
      // Play Music is reached from the Speakers chip, the menu and a scene pill
      // (Home -> Scenes -> Pills that open a page) -- not a heading of its own
      // between Favorites and the rooms.
      if (!carHome) rooms(client, opts).forEach(function (r) {
        var sec = guarded('the ' + r.name + ' section of Home', function () { return roomSection(client, r); });
        if (sec) home.push(sec);
      });
      // THE #alarm POP-UP. An alarm automation may open
      // `<dashboard>/0#alarm` on the tablets, and a Home with nothing
      // listening would just show Home. An Alarm pop-up ITEM (HK Settings
      // -> Pop-ups) answers #alarm on every dashboard with its own Close
      // after -- and a card here would claim the hash first, so the item's
      // settings would never apply on a generated dashboard (the keypad would
      // close after the default minute, not the item's). So this card is only
      // for a house with no Alarm item for this dashboard, and not where the
      // dashboard refuses pop-ups.
      var popups = [];
      var seg = dashSeg();
      var alarmItem = (setting('popups') || []).some(function (p) {
        return p && p.hash === 'alarm' && (!p.dashboards || !p.dashboards.length || p.dashboards.indexOf(seg) >= 0);
      });
      if (alarmId && !alarmItem && b.popups !== false) {
        popups.push({ type: 'custom:hk-popup-card', hash: '#alarm', detail: alarmId, name: 'Alarm' });
      }
      // its Screen page's Now Playing Bar (with music set up) and Timer Bar (with
      // the quick timers) -- one docked bar, either part or both. (A screen
      // saved before the Timer Bar had it with its Now Playing Bar.)
      var npOn = !!(b.now_playing && music);
      var tbOn = (b.timer_bar === undefined ? !!b.now_playing : !!b.timer_bar) && !!client.states['sensor.running_quick_timers'];
      var dockBar = npOn || tbOn ? mediaBar(npOn, tbOn) : null;
      if (dockBar) popups.push(dockBar);
      if (popups.length) {
        home.push({ type: 'custom:hk-grid-card', view_layout: COL2,
          layout: { 'grid-template-columns': '1fr', 'grid-column-gap': '0px', 'grid-row-gap': '0px',
                    margin: '0px', padding: '0px' },
          cards: popups });
      }

      var out = [view({ title: 'Home', path: 'home', cards: home })];
      // A HOME OF ITS OWN (its Pages page -> Home): one of the house's custom
      // pages in place of the generated Home, and the rest of the screen
      // generated as usual -- a car's own first page, say, over the house's
      // Lights, Climate and Cameras. The page keeps its address and is called
      // Home, as the generated one is (the menu, HA's header, the tab). A page
      // that is gone leaves the generated Home.
      var own = (opts.board || {}).home_view ? customView(opts.board.home_view) : null;
      if (own) {
        own.title = own.menu_title = 'Home';
        if (!own.icon) own.icon = 'mdi:home';
        out[0] = own;
      }
      // HOME GRID (its Home Style: Home Grid, with a layout): Home is the
      // screen's own grid (hk-home-grid-view) -- its band the header above, its
      // blocks from the catalog, and the pop-ups Home listens for -- and the
      // rest of the screen as usual
      else if (b.home_style === 'grid' && b.home_grid && window.hkGridCatalog) {
        var gridClimate = Object.keys(client.states).filter(function (id) {
          return id.indexOf('climate.') === 0 && !hidden(client, opts, id);
        }).sort();
        // for pages that swipe (G4): the room of each camera and thermostat,
        // and the scenes -- the screen's Scenes choice, else every scene A to Z
        var gridAreas = {};
        (cams || []).concat(gridClimate).forEach(function (id) { gridAreas[id] = areaOf(client, id); });
        var gridScenes = listOf(b, 'scenes').filter(function (id) {
          return typeof id === 'string' && id.indexOf('scene.') === 0 && client.states[id];
        });
        if (!gridScenes.length) {
          gridScenes = Object.keys(client.states).filter(function (id) {
            var e = (client.entities || {})[id];
            return id.indexOf('scene.') === 0 && !hidden(client, opts, id) && !(e && (e.hidden || e.entity_category));
          }).sort(function (x, y) { return named(client, x, '').localeCompare(named(client, y, '')); });
        }
        out[0] = view(homeGridView(b.home_grid, { title: 'Home', path: 'home' }, header, popups, {
          cameras: cams, weather: weather || firstOf(client, 'weather'), vacuum: firstOf(client, 'vacuum'),
          battery: houseBattery(),
          climate: gridClimate, areas: gridAreas, scenes: gridScenes,
          rooms: rooms(client, opts).map(function (r) { return r.id; }).filter(Boolean)
        }, ['auto', 'home', 'centred'].indexOf(b.tile_style) >= 0 ? b.tile_style : setting('look.tile_style')));
      }
      var pages = {};
      if (opts.pages !== false) {
        guarded('the category pages', function () {
          categoryPages(client, opts, inv, view, !!alarm).forEach(function (v) { pages[v.path] = v; });
        });
      }

      if (weather) {
        // THE WEATHER PAGE (2026-10-16, hk_house/docs/PLAN-2026-10-16-weather-page.md):
        // the conditions over the sky, any alert in effect, the hours, the
        // radar beside the days, then the details -- each part as
        // weather.page says (hkSettings.weatherPage), the radar as
        // weather.radar_native says (HK's own, hk-radar.js; the Weather Radar
        // Card from HACS is no longer drawn here). 10 px between the cards
        // both ways (card-margin 0: DESIGN.md, Exact gaps). `enter`: each
        // card's place in the page's entrance (hk-weather.js wxEnter).
        var HSW = window.hkSettings;
        var wpg = HSW && HSW.weatherPage ? HSW.weatherPage()
          : { show_current: true, show_hourly: true, show_daily: true, show_alerts: true, details: ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'] };
        var radarOn = !!(HSW && HSW.radarNative && HSW.radarNative().enabled);
        var gap = { 'grid-row-gap': '10px', 'grid-column-gap': '10px', 'card-margin': '0px', margin: '0px', padding: '0px' };
        var body = [], enter = 0;
        if (wpg.show_current) body.push({ type: 'custom:hk-weather-band-card', section: 'hero', entity: weather, enter: enter++ });
        var alerts = setting('weather.alerts');
        if (alerts && wpg.show_alerts) {
          body.push({ type: 'conditional',
            conditions: [{ condition: 'numeric_state', entity: alerts, above: 0 }],
            card: { type: 'custom:hk-alert-card', entity: alerts, title: 'Severe Weather', icon: 'mdi:alert', details: true } });
        }
        if (wpg.show_hourly) body.push({ type: 'custom:hk-weather-band-card', section: 'hourly', entity: weather, enter: enter++ });
        var pair = [];
        if (radarOn) pair.push({ type: 'custom:hk-radar-card' });
        if (wpg.show_daily) pair.push({ type: 'custom:hk-weather-band-card', section: 'daily', entity: weather });
        if (pair.length) {
          pair.forEach(function (c) { c.enter = enter; });
          enter++;
          body.push({ type: 'custom:hk-grid-card', cards: pair, layout: Object.assign({
            'grid-template-columns': pair.length > 1 ? 'var(--hk-wx-pair, minmax(0, 2fr) minmax(310px, 1fr))' : 'minmax(0, 1fr)' }, gap) });
        }
        if (wpg.details && wpg.details.length) body.push({ type: 'custom:hk-weather-details-card', entity: weather, enter: enter++ });
        pages.weather = view({ title: 'Weather', path: 'weather', subview: true, icon: 'mdi:weather-partly-cloudy',
                        menu: 'top', cards: [titleBar('Weather'), column([{ type: 'custom:hk-grid-card', cards: body,
                          layout: Object.assign({ 'grid-template-columns': 'minmax(0, 1fr)' }, gap) }])] });
      }

      // CAMERAS: every camera live, three across -- opened one after another
      // (hk-camera-live-card, hk-cameras.js: nine at once never connected in
      // desktop Safari).
      if (hasCams) {
        pages.cameras = view({ title: 'Cameras', path: 'cameras', subview: true, icon: 'mdi:camera', menu: 'top',
          sky_variant: 'cameras', background: '#080a0e', cards: [titleBar('Cameras'), column([{
            type: 'custom:hk-grid-card',
            // the house's gap both ways and no margins of their own, so the
            // tiles sit on the page's edges as every plate does (DESIGN.md
            // "Page edges"; their default 4 px put them 4 px in)
            layout: { 'grid-template-columns': 'var(--hk-cameras, repeat(3, minmax(0, 1fr)))', 'grid-column-gap': TL().gridGap + 'px',
                      'grid-row-gap': TL().gridGap + 'px', 'card-margin': '0px', margin: '0px', padding: '0px' },
            cards: cams.map(function (id) {
              return { type: 'custom:hk-camera-live-card', entity: id, aspect_ratio: '16x9', fit_mode: 'cover' };
            }) }])] });
      }

      // THE CALENDAR, when the house has a calendar (All Screens -> Calendar
      // chooses which, and their colours -- read live by the card, so neither
      // rebuilds anything): the month, week or day, and its events to add,
      // change and delete.
      var HS0 = window.hkSettings;
      var cals = (HS0 && HS0.calendarIds ? HS0.calendarIds(client.states)
                  : Object.keys(client.states).filter(function (k) { return k.indexOf('calendar.') === 0; }))
        .filter(function (id) { return !hidden(client, opts, id); });
      if (want('calendar') && cals.length) {
        pages.calendar = view({ title: 'Calendar', path: 'calendar', subview: true, icon: 'mdi:calendar-month', sky_variant: 'calendar', background: '#0e1a18',
          cards: [titleBar('Calendar'), column([{ type: 'custom:hk-calendar-card' }])] });
      }

      // LIVE TV, when the Live TV feature is added (its guide knows the channels).
      if (want('live_tv') && added('live_tv')) {
        pages.live_tv = view({ title: 'Live TV', path: 'live-tv', subview: true, icon: 'mdi:television', menu: 'top',
          sky_variant: 'cameras', background: '#080a0e', cards: [titleBar('Live TV'), column([
            // (on the page's own edges, as every page: DESIGN.md "Page edges")
            { type: 'custom:hk-tv-guide-card' }], { layout: { 'grid-template-columns': 'minmax(0, 1fr)',
              margin: '0px', padding: '0px' } })] });
      }

      // SECURITY: the keypad and the page's header, then the locks and garage
      // doors -- from the page's left edge, under its title and status row, as
      // every other page's content starts.
      if (alarm) {
        // the locks, then the garage doors -- or the page's own order
        // (Accessories -> Locks -> Tile Order)
        var guards = ownOrder('security', inv.locks.concat(inv.garage.filter(function (id) { return id.indexOf('cover.') === 0; })))
          .map(function (id) {
            // (its place: Security's own page order, accessory/page_order)
            if (id.indexOf('lock.') === 0) {
              return { type: 'custom:hk-tile-card', entity: id, name: fullName(client, id).replace(/ Lock$/, ''),
                       icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open-variant' }, icon_color: 'mint',
                       label_mode: 'title', hk_place: { page: 'security' } };
            }
            return { type: 'custom:hk-tile-card', entity: id, name: fullName(client, id), icon: 'hk:garage-variant',
                     icon_states: { open: 'hk:garage-open-variant', opening: 'hk:garage-open-variant' },
                     icon_color: 'mint', label_mode: 'title', hk_place: { page: 'security' } };
          });
        // THE SECURITY PAGE (2026-10-15): the keypad in its own box (the
        // state as its badge, whether the entry points are closed under it),
        // beside it the header -- the house with its ways in and today's
        // activity, and Device Care while something needs it -- at the
        // keypad's height; then the locks and garage doors, full width. The
        // keypad's column is 360 (the iPad band and a phone: --hk-sec-cols).
        var entries = inv.doors.concat(inv.windows, inv.garage);
        var keypad = { type: 'custom:hk-alarm-keypad-card', entity: alarm, boxed: true, entries: entries };
        var top = headerOn('security')
          ? { type: 'custom:hk-grid-card', cards: [keypad, { type: 'custom:hk-security-overview-card', alarm: alarm,
                locks: inv.locks, doors: inv.doors, windows: inv.windows, garage: inv.garage, leaks: inv.leaks || [] }],
              // (368: the keypad's 360 box and its 4 px side margins)
              layout: { 'grid-template-columns': 'var(--hk-sec-cols, 368px minmax(0, 1fr))', 'grid-column-gap': (TL().gridGap - 8) + 'px',
                        'grid-row-gap': '0px', 'place-items': 'stretch', margin: '0px', padding: '0px' } }
          : { type: 'custom:hk-grid-card', cards: [keypad],
              layout: { 'grid-template-columns': 'minmax(0, 368px)', 'grid-column-gap': '0px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' } };
        var topCol = column([top]);
        topCol.layout = Object.assign({}, topCol.layout, { margin: '0px -4px' });
        var scards = [titleBar('Security'), pageRow('security', opts), topCol];
        if (guards.length) scards.push(section('Locks', guards));
        pages.security = view({ title: 'Security', path: 'security', subview: true, icon: 'mdi:lock',
          sky_variant: 'security', background: '#161823', cards: scards });
      }

      // WATER (2026-10-16, PLAN-2026-10-16-utility-pages.md): the status row;
      // the header -- the day's water from the Energy settings' meter beside
      // the main supply valve -- then any other valves, then the leak sensors
      // room by room. A quiet sensor's "No Report" is how these sensors are
      // between events (the user, 2026-10-16), so it is said plainly in its
      // tile and never raised as a warning; a leak is the tile's red.
      var valves = inv.valves || [];
      if (opts.pages !== false && ((inv.leaks && inv.leaks.length) || valves.length)) {
        var wet = {};
        inv.leaks.forEach(function (id) { wet[id] = true; });
        var byRoom = roomsWith(client, Object.assign({}, opts, { include_entities: [].concat(opts.include_entities || [], inv.leaks) }),
                               function (id) { return !!wet[id]; });
        // THE MAIN SUPPLY: the water valve named for it (main, supply,
        // shut-off), else the only one -- unless that one waters a garden
        // (a sprinkler is never the house's supply)
        var vname = function (id) { return fullName(client, id) + ' ' + id; };
        // (or the one chosen on HK Settings -> Pages -> Water)
        var hw = headerOpts('water');
        var supply = (hw.supply && client.states[hw.supply] ? hw.supply : null) ||
                     valves.filter(function (id) { return /main|supply|shut.?off/i.test(vname(id)); })[0] ||
                     (valves.length === 1 && !/sprinkl|irrigat|garden|drip|hose|lawn|zone|pool/i.test(vname(valves[0])) ? valves[0] : null);
        var wcards = [titleBar('Water'), pageRow('water', opts)];
        if (headerOn('water')) {
          // the usage card leaves itself out when no water meter is set up
          var wday = { type: 'custom:hk-water-day-card', height: HEADER_H, view_layout: supply ? SPAN2 : SPAN_ALL };
          if (hw.meter) wday.meter = hw.meter;
          wcards.push(headerGrid([wday]
            .concat(supply ? [{ type: 'custom:hk-water-supply-card', entity: supply, height: HEADER_H, view_layout: SPAN1 }] : [])));
        }
        var others = valves.filter(function (id) { return !headerOn('water') || id !== supply; });
        // (a chosen supply that is a switch, not one of the valves, too)
        if (!headerOn('water') && supply && valves.indexOf(supply) < 0) others.unshift(supply);
        if (others.length) wcards.push(section('Valves', others.map(function (id) { return tileFor(client, id, fullName(client, id)); })));
        byRoom.forEach(function (r) {
          wcards.push(section(r.name, r.entities.map(function (id) {
            return placed({ type: 'custom:hk-tile-card', entity: id, name: friendly(client, id, r.name), icon: 'hk:water',
                            icon_states: { on: 'hk:water-alert' }, icon_color: 'red', off_icon_color: 'blue', label_mode: 'leak' },
                          catPlace(r, 'Water', 'water'));
          })));
        });
        pages.water = view({ title: 'Water', path: 'water', subview: true, icon: 'mdi:water', sky_variant: 'water',
          background: '#0c1526', cards: wcards });
      }

      // ENERGY: the Energy feature's page, from its plan (the settings feed's
      // `energy`, features/energy/plan.py) -- while the feature is added
      var ev = opts.pages !== false && want('energy') && guarded('the Energy page', function () { return energyView(client, view, { climate: !!pages.climate }); });
      if (ev) pages.energy = ev;
      // POWER: the Energy feature's second page, while its plan has one -- as a kind (`power`), and in place of a custom page at its address
      var pw0 = added('energy') && setting('energy') && setting('energy').power;
      if (opts.pages !== false && pw0 && (want('power') || listOf(b, 'custom_pages').indexOf(pw0.path) >= 0)) {
        var pwv = guarded('the Power page', function () { return powerView(client, view); });
        if (pwv) pages.power = pwv;
      }
      // TIMELINE (phase 19): a page only a host with its own record has (hkShell.hostPage; Home Assistant: false)
      if (opts.pages !== false && want('timeline') && window.hkShell && window.hkShell.hostPage('timeline')) pages.timeline = view({ title: 'Timeline',
        path: 'timeline', subview: true, icon: 'mdi:history', sky_variant: 'timeline', background: '#1a120c',
        cards: [titleBar('Timeline'), column([{ type: 'custom:hk-timeline-card' }])] });

      if (music) {
        // MUSIC (2026-10-11): Play Music and Browse Music on one page (hk-music.js) -- what plays and where on the left,
        // Browse beside it. The cover is still the page's background (the playmusic sky).
        out.push(view({ title: 'Music', path: 'playmusic', subview: true, sky_variant: 'playmusic',
          icon: 'mdi:speaker', menu_title: 'Music',
          // (in the page's column, as every page's content: on its edges --
          // DESIGN.md "Page edges")
          background: '#150e1f', cards: [titleBar('Music'),
            column([{ type: 'custom:hk-music-card' }])] }));
        // BROWSE MUSIC'S ADDRESS STAYS (links, chips and tap actions that open it): the same page, starting in the search
        // box -- out of the menu, where Music is the page
        out.push(view({ title: 'Music', path: 'music-browse', subview: true, sky_variant: 'playmusic',
          menu_follows: 'playmusic', icon: 'mdi:music-box-multiple', menu: false,
          background: '#150e1f', cards: [titleBar('Music'), column([{ type: 'custom:hk-music-card', focus_search: true }])] }));
        // NOW PLAYING (2026-11-07): the screensaver's music slide as a page, its corner its title (hk-saver-pane.js); out of
        // the menu, a screen's Swipe Right on Home goes there. The cover is its sky, as Music's.
        out.push(view({ title: 'Now Playing', path: 'now-playing', subview: true, sky_variant: 'playmusic', menu_follows: 'playmusic', icon: 'mdi:play-circle', menu: false, background: '#150e1f',
          cards: [column([{ type: 'custom:hk-now-playing-page-card' }])] }));
      }
      // THE PAGES IN THIS DASHBOARD'S ORDER (Order -> Pages): the
      // kinds, Browse Music where it is placed (else right after Play Music --
      // it comes with it, never on its own), and a custom page where it is
      // placed; custom pages not placed come before the rooms (customPages).
      var play = out.filter(function (v) { return v.path === 'playmusic'; });
      var browse = out.filter(function (v) { return v.path === 'music-browse'; });
      out = out.filter(function (v) { return play.indexOf(v) < 0 && browse.indexOf(v) < 0; });
      var KEY = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', live_tv: 'live_tv', security: 'security',
                  doors_windows: 'doors-windows', climate: 'climate', lights: 'lights', timers: 'timers',
                  vacuums: 'vacuums', water: 'water', energy: 'energy', power: 'power', timeline: 'timeline' };
      var order = picked.length ? picked : ['weather', 'calendar', 'cameras', 'live_tv', 'security', 'doors_windows', 'climate',
                                            'lights', 'timers', 'vacuums', 'music', 'water', 'energy', 'power', 'timeline', 'rooms'];
      var browsePlaced = order.indexOf('browse') >= 0;
      var mine = listOf(b, 'custom_pages');
      order.forEach(function (k) {
        if (k === 'music') { out = out.concat(play, browsePlaced ? [] : browse); play = []; if (!browsePlaced) browse = []; return; }
        if (k === 'browse') { out = out.concat(browse); browse = []; return; }
        if (KEY[k]) {
          var v = pages[KEY[k]];
          if (v) { out.push(v); delete pages[KEY[k]]; return; }
          // no Energy feature: a custom page of the same address, as before it
          if (k !== 'energy') return;
        }
        // the Power page in place of a custom page at its address
        if (pages.power && pages.power.path === k) { out.push(pages.power); delete pages.power; return; }
        // a custom page, when this dashboard shows it -- never a second page
        // at an address a generated one has
        if (mine.indexOf(k) >= 0 && !out.some(function (x) { return x && x.path === k; })) {
          var cv = customView(k); if (cv) out.push(cv);
        }
      });
      // THE POWER PAGE NOT PLACED (a screen that lists the custom page at its
      // address but not where): where that custom page would have gone, before
      // the rooms -- never the custom page itself
      if (pages.power) { out.push(pages.power); delete pages.power; }
      // A PAGE PER ROOM (Parts -> Room pages): each room heading on Home opens it.
      if (opts.rooms !== false && want('rooms')) {
        rooms(client, opts).forEach(function (r) {
          if (!r.id) return;
          var head = { title: r.name, path: 'room-' + slug(r.id), subview: true,
                       area: r.areas && r.areas.length > 1 ? r.areas : r.id };
          out.push(guarded('the ' + r.name + ' page', function () {
            return view(Object.assign({}, head, { cards: roomCards(client, r.areas || [r.id], r.name, opts) }));
          }, function (e) {
            return view(Object.assign({}, head, { cards: [{ type: 'markdown',
              content: 'This room page could not be built (' + String((e && e.message) || e).replace(/[<>&]/g, '') + ').' }] }));
          }));
        });
      }
      // On Every Page carries the same docked player through ordinary views.
      if (dockBar && b.bar_all_pages) {
        dockBar.carry = true;
        out.forEach(function (v) {
          // (not the Music page: below)
          if (!v || v.path === 'home' || MUSIC_PAGE[v.path] || v.type !== 'custom:hk-grid-view' || !Array.isArray(v.cards)) return;
          v.cards = v.cards.concat([dockCard(dockBar)]);
        });
      }
      // THE MUSIC PAGE gets the bar on a phone only, on or off On Every Page:
      // one column, the bar is its mini player (hk-music.js says so with the
      // `hk-music-mini` flag on <html>); at two or three its own player is the
      // page and the bar would only repeat it. No Now Playing Bar on this
      // screen: the page's own Now Playing row stands in.
      // CARRIED to it and from it (a phone's: Home's bar becomes the page's
      // in place -- it waits there for the page's say, hk-popup.js)
      if (dockBar && npOn) {
        dockBar.carry = true;
        // (no stash there: the page's own Now Playing row stands in)
        var musicBar = Object.assign({}, dockBar, { carry: true, stash: null,
          trigger: [{ condition: 'flag', flag: 'hk-music-mini' }].concat(dockBar.trigger) });
        out.forEach(function (v) {
          if (v && MUSIC_PAGE[v.path] && Array.isArray(v.cards)) v.cards = v.cards.concat([dockCard(musicBar)]);
        });
      }
      return out;
    }

    // THE ROOM PAGE AS A VIEW STRATEGY, for a hand-built dashboard:
    //
    //     - title: Kitchen
    //       path: room-kitchen
    //       subview: true
    //       sky: true                  # the live sky, as on any HK view
    //       strategy:
    //         type: custom:hk-room
    //         area: kitchen            # or a list: [backyard, deck]
    //
    // Built from the area every time the page opens. The menu lists it as a
    // room (it reads the strategy's `area`).
    // WHEN HOME ASSISTANT SHOULD BUILD THE DASHBOARD AGAIN.
    // A strategy that says nothing is rebuilt whenever the entity, device, area
    // or floor registry changes at all -- anywhere in the house, for any field
    // (a firmware version, an integration's own bookkeeping) -- and HA hands
    // the view a new config without comparing it, so every card on an open
    // screen is made again: the camera strip's live tile reconnects, the sky
    // and glass rebuild. What the build reads of the registries is small, so
    // it is compared instead: an entity's area, device, platform, name, icon,
    // hidden and category; a device's area; an area's name and floor; a
    // floor's name and level. Worked out once per registry object (HA
    // replaces the object when it changes), so an unchanged registry costs a
    // lookup per push of the frontend's object.
    var REG_FIELDS = {
      entities: ['area_id', 'device_id', 'platform', 'name', 'icon', 'hidden', 'entity_category'],
      // a device's names are its tiles' names (friendly_name), its model picks
      // the Apple TV / HomePod glyph
      devices: ['area_id', 'name', 'name_by_user', 'model'], areas: ['name', 'floor_id'], floors: ['name', 'level']
    };
    var regSeen = new WeakMap();
    function regView(reg, fields) {
      if (!reg || typeof reg !== 'object') return '';
      var hit = regSeen.get(reg);
      if (hit !== undefined) return hit;
      var out = Object.keys(reg).sort().map(function (k) {
        var r = reg[k] || {};
        return k + '=' + fields.map(function (f) { return r[f] == null ? '' : String(r[f]); }).join('|');
      }).join(';');
      regSeen.set(reg, out);
      return out;
    }
    function regChanged(config, oldClient, newClient) {
      if (!oldClient || !newClient) return true;
      return Object.keys(REG_FIELDS).some(function (k) {
        var was = oldClient[k], now = newClient[k];
        return was !== now && regView(was, REG_FIELDS[k]) !== regView(now, REG_FIELDS[k]);
      });
    }

    class HkRoomViewStrategy extends HTMLElement {
      static shouldRegenerate(config, oldInput, newInput) { return regChanged(config, clientOf(oldInput), clientOf(newInput)); }
      static async generate(config, input) {
        var client = clientOf(input);   // Lovelace's entry: from here on, the client only
        if (window.hkSettings && window.hkSettings.whenLive) await window.hkSettings.whenLive(3000);
        await cardsReady();
        var c = config || {};
        var areas = [].concat(c.area || []).filter(Boolean);
        var A = client.areas || {};
        var name = c.name || (A[areas[0]] && A[areas[0]].name) || 'Room';
        var themes = (client.themes && client.themes.themes) || {};
        var v = { type: 'custom:hk-grid-view', layout: VIEW_LAYOUT, background: '#05070e',
                  cards: roomCards(client, areas, name, Object.assign({}, c, { __build: {} })) };
        var theme = c.theme || kioskTheme(themes);
        if (theme) v.theme = theme;
        return v;
      }
    }

    // THE LOOK ALONE (?hk_preview=look, Settings' preview on the Appearance pages, 2026-10-31, the owner: "just what
    // they're changing"): the screen as it is -- its background, its glass, its accent, its menu and tab bar -- with
    // only a few cards on its Home: the header and its chips, the scenes, and the room with the most tiles. A Home Grid
    // (or any other kind of page) is left as it is.
    function lookPreview() { try { return /[?&]hk_preview=look(?:&|$)/.test(String(location.search)); } catch (e) { return false; } }
    function lookSample(vs) {
      var v = vs && vs[0];
      if (!v || v.type !== 'custom:hk-grid-view' || !Array.isArray(v.cards)) return;
      var types = function (c) { return [c.type].concat((c.cards || []).reduce(function (a, k) { return a.concat(types(k)); }, []), c.card ? types(c.card) : []); };
      var has = function (c, t) { return types(c).indexOf(t) >= 0; };
      var tiles = function (c) { return types(c).length; };
      var head = v.cards.filter(function (c) { return has(c, 'custom:hk-header-card') || has(c, 'custom:hk-chips-card'); })[0];
      var scenes = v.cards.filter(function (c) { return has(c, 'custom:hk-scenes-card'); })[0];
      var room = v.cards.filter(function (c) { return c !== head && c !== scenes && has(c, 'custom:hk-heading-card') && has(c, 'custom:hk-grid-card') &&
                                                     !has(c, 'custom:hk-camera-mosaic-card'); })
        .reduce(function (best, c) { return !best || tiles(c) > tiles(best) ? c : best; }, null);
      v.cards = [head, scenes, room].filter(Boolean);
    }

    class HkDashboardStrategy extends HTMLElement {
      static shouldRegenerate(config, oldInput, newInput) { return regChanged(config, clientOf(oldInput), clientOf(newInput)); }
      static async generate(config, input) {
        var client = clientOf(input);   // Lovelace's entry: from here on, the client only
        // THE SETTINGS FIRST. This runs once per load, so it cannot redraw when
        // they arrive: on a browser with no cached copy it waits (up to 3 s)
        // for the integration's answer instead of building from the defaults.
        if (window.hkSettings && window.hkSettings.whenLive) await window.hkSettings.whenLive(3000);
        await cardsReady();
        // WHAT THIS BUILD READS, fingerprinted BEFORE it reads it, and the
        // listener hooked before the first await below: a settings push that
        // lands while the build waits (on music, up to 4 s) is then seen as a
        // change and rebuilds. Fingerprinted at the end, as it was, the push
        // was in the fingerprint but not in the build, and nothing followed.
        var seg = dashSeg();
        watch(seg, inputs(seg));
        // Accessories -> Hidden from Screens / Also Shown (the house's), then
        // the dashboard's own YAML: the lists ADD together. The parts (chips,
        // pages, sky, music, rooms) are the YAML's and the screen's own --
        // there are no house-wide switches for them.
        var G = (window.hkSettings && window.hkSettings.get('generated', null)) || {};
        var y = config || {};
        var both = function (k) { return [].concat(G[k] || [], y[k] || []); };
        var opts = Object.assign({}, y, {
          exclude_areas: both('exclude_areas'), exclude_entities: both('exclude_entities'),
          exclude_devices: both('exclude_devices'), include_entities: both('include_entities'),
          __build: {}                     // this build's one pass over the house (byArea)
        });
        opts.board = boardOf(seg);
        // The desktop editor's frame only: a draft is never put in the settings feed.
        if (y.home_grid_preview) opts.board = Object.assign({}, opts.board, {
          home_style: 'grid', home_grid: y.home_grid_preview, home_page: true, home_view: null, only_pages: []
        });
        if (opts.board.sky === false) opts.sky = false;
        var b = opts.board;
        // HOME PAGE OFF (its Pages page): the screen is only the pages it
        // lists, in its order, and opens on the first -- any of them: the
        // Energy page, Climate, Cameras, a custom page. With none listed it is
        // a whole screen as usual.
        //   only_pages listed (Pages): the screen built as usual from that list
        //     -- views() keeps only the listed pages, in their order -- less
        //     its Home
        //   none (a screen set up before 2026-10-04): its custom pages, where
        //     `energy` is the Energy feature's page (onlyPages)
        var only = [];
        if (b.home_page === false && listOf(b, 'only_pages').length) {
          var mus = opts.music === false ? false : await musicConfigured(client);
          var keep = listOf(b, 'only_pages');
          // its own list as the page list; a key that is no kind is a custom page
          var ob = Object.assign({}, b, { pages: keep, custom_pages: keep });
          only = views(client, Object.assign({}, opts, { board: ob }), mus).slice(1);
          if (only.length) standalone(only[0], b);
        } else if (b.home_page === false) {
          only = onlyPages(client, opts, b);
        }
        // (a Home Grid screen waits for its catalog -- a few seconds at most:
        // without it, Home is the generated one)
        if (b.home_style === 'grid' && b.home_grid && !window.hkGridCatalog) {
          await Promise.race([gridReady(), new Promise(function (res) { setTimeout(res, 3000); })]);
        }
        var cfg;
        if (only.length) {
          // the menu's first item is this page, under its own name -- not "Home"
          only[0].menu_title = only[0].title;
          if (only[0].icon) only[0].menu_icon = only[0].icon;
          cfg = { views: only };
        } else {
          var music = opts.music === false ? false : await musicConfigured(client);
          cfg = { views: views(client, opts, music) };
          customPages(cfg.views, listOf(b, 'custom_pages'));
          pagesScreen(cfg.views, b);
        }
        energyLinks(cfg.views, seg);
        skyPages(cfg.views);
        if (lookPreview()) lookSample(cfg.views);
        var saver = screensaverOf(client, b);
        if (opts.sky !== false) {
          // THE SKY (hk-sky.js): off everywhere with the house's switch (Look ->
          // Live sky switch), and paused behind this tablet's screensaver
          cfg.sky = {};
          if (setting('look.sky_switch')) cfg.sky.enable = setting('look.sky_switch');
          if (saver && saver.entity) cfg.sky.sleep = saver.entity;
        }
        // Its Screen page's "Hide Home Assistant Header & Sidebar": HK
        // Frontend's own (hk-kiosk.js reads cfg.hk_kiosk), or the Kiosk Mode
        // plugin for a screen that chooses it -- the tuned settings, then the
        // screen's own options for it (Kiosk Mode Options, YAML).
        var kiosk = kioskOf(b);
        if (kiosk === 'kiosk_mode') cfg.kiosk_mode = overlay({ hide_header: true, hide_sidebar: true }, b.kiosk_options);
        else if (kiosk) cfg.hk_kiosk = kiosk;
        // THE PHOTO SCREENSAVER: HK Frontend's own (hk-saver.js reads
        // cfg.hk_screensaver), or WallPanel for a screen that chooses it.
        if (saver && b.screensaver_engine === 'wallpanel') cfg.wallpanel = overlay(wallpanel(saver), b.wallpanel_options);
        else if (saver) cfg.hk_screensaver = hkSaver(saver, b.screensaver_options);
        return cfg;
      }
    }

    // what the shell and the later parts use of this one
    K.HkDashboardStrategy = HkDashboardStrategy; K.HkRoomViewStrategy = HkRoomViewStrategy; K.lookSample = lookSample;
  };
})();
