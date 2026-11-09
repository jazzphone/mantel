// hk-grid-catalog.js -- the Home Grid catalog (docs/phase11/HOME-GRID.md)
//
// A Home Grid block names a catalog KEY, not a Lovelace type: `room`, `camera`,
// `scenes`. This file turns a key, a size and the block's options into a real
// HK card config. hk_core/settings/home_grid.py CATALOG is its mirror -- the
// same keys, sizes and page sources, kept equal by a test
// (tests/test_hk_core_home_grid.py) -- so what the settings accept, a screen
// can draw.
//
// G1: each key is today's card, unsized. A card's own layout per size comes
// with G2 (the size attribute and --hk-cell-w/-h, read with container
// queries); the new cards (room, scene_suggested, action, everything) are
// G3's, in hk-grid-cards.js. A block with `pages` is an hk-pager-card
// (hk-layout.js, G4) holding one of its card per page: pages() below says which.
//
// Plain data and pure functions, loaded at parse time: no hk-base.js needed. (One exception, 2026-11-07: a
// block's custom sheet is read off a tap here, sheetSlot -- hk-layout.js's view calls it -- reaching hkCards and
// hkDetail only when a block is placed or tapped.)
// @ts-check
(function () {
  'use strict';
  if (window.hkGridCatalog) return;            // double-load guard

  // Size classes: [columns, rows] (hkCards.HOME_GRID is the same table).
  // F, Full (2026-10-30, the Cameras face): the view's whole grid -- 0 is
  // "the grid's own" (span()) -- at [0, 0] only, so the only block in its
  // view; offered for `cameras` alone
  // C, Compact (2026-11-07): three columns by one row, Security's HomeView presentation's alone (home_grid.py)
  var SIZES = { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2], XXL: [6, 2], F: [0, 0], C: [3, 1], XS: [1, 1] };   // (XS, Tiny: half a cell, at[2] 1 the bottom)
  function span(size, cols, rows) { var z = SIZES[size]; return z ? [z[0] || cols, z[1] || rows] : null; }
  // A CELL'S SHAPE (the grid's `cell`; 2026-10-30, docs/phase11/HOMEVIEW-LOOK.md):
  // a tile, 196 x 150 with a 10 px gap, or a square, 196 x 196 with HomeView's
  // 13; a Square screen's canvas edge 14 px (hkCards.HOME_GRID.square is the
  // same table, for the page; this one is the editor's)
  var CELLS = { tile: { w: 196, h: 150, gap: 10 }, square: { w: 196, h: 196, gap: 13, edge: 14 } };
  var TABLET_ROOM = 'tablet_room';

  // a block whose card isn't drawn yet (G3), or with nothing in the house to show
  // A BLOCK WITH NOTHING TO SHOW YET: its name and where to set it up, as the panels' empty states say it (2026-11-08: it was a header
  // key, a small pill at the top of the block on the owner's Tesla HomeView -- seen in the house's twin, tools/headless/house_twin.py)
  function stand(name, icon, text) { return { type: 'custom:hk-grid-panel-card', panel: 'note', name: name, text: text || 'Not set up yet.' }; }
  function own(v) { return v && v !== TABLET_ROOM ? v : null; }
  // THE CLOCK FACES a block offers (hk-saverclock.js ids; '' is HK's own):
  // the ones that read at a block's size (Poster fills its screen edge to
  // edge and Glass draws a pane of its own: neither sits in a block)
  var CLOCK_FACES = [['', 'Digital'], ['analog', 'Analog'], ['classic', 'Classic'], ['serif', 'Big Serif'], ['flip', 'Flip'],
    ['lcd', 'Retro LCD'], ['neon', 'Neon'], ['nixie', 'Nixie Tubes'], ['dots', 'Dot Matrix'], ['arc', 'Minimal Arc'],
    // (2026-10-30) numerals round a quiet dial, HomeView's kind of face
    ['numbers', 'Analog Numbers']];
  // A THERMOSTAT BLOCK'S STYLE (2026-10-30): the dial, or Big Number -- the
  // target large, the arrows at its foot (Tall and Large; Extra Large is the sheet)
  var THERMOSTAT_STYLES = [['dial', 'Dial'], ['big', 'Big Number']];
  // ...and the HomeView-style faces (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase I), each on its own colour
  // -- the block becomes that colour (home_grid.py CLOCK_FACES)
  CLOCK_FACES.push(['liquid', 'Liquid'], ['giant', 'Giant Numerals'], ['scattered', 'Scattered Numerals']);
  function panel(kind, more) { return Object.assign({ type: 'custom:hk-grid-panel-card', panel: kind }, more || {}); }

  // key -> its sizes, the page sources it has besides `list`, and
  // card(size, opts, ctx): its card config. ctx is the house as the screen
  // sees it -- { cameras, climate, rooms, weather, vacuum, battery } -- for a block
  // that names nothing of its own.
  var CARDS = {
    accessory: { sizes: ['XS', 'S', 'W', 'T'], sources: [], opts: { entity: 'entity', secondary: 'secondary', color: 'boolean' }, card: function (s, o) {
      return o.entity ? Object.assign({ type: 'custom:hk-grid-entity-card', entity: o.entity, secondary: o.secondary, kind: 'accessory', size: s }, o.color ? { color: true } : {}) : stand('Accessory', 'mdi:lightbulb', 'Choose an accessory in the editor.'); } },
    // (height, color 2026-10-31: Full, HomeView's square tile, or Half, the shorter button; each on its own
    // color's gradient or glass)
    accessories: { sizes: ['S', 'W', 'T', 'L', 'XL', 'XXL'], sources: ['accessories'], opts: { accessories: 'accessories', title: 'title', surface: 'surface', height: 'tile_height', color: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-grid-accessories-card', accessories: o.accessories || [], title: o.title || 'Accessories', surface: o.surface },
                           o.title ? { label: true } : {},
                           o.height ? { height: o.height } : {}, o.color ? { color: true } : {}); } },
    scene: { sizes: ['S', 'W'], sources: [], opts: { scene: 'scene', color: 'boolean' }, card: function (s, o) {
      return o.scene ? Object.assign({ type: 'custom:hk-grid-entity-card', entity: o.scene, kind: 'scene', size: s }, o.color ? { color: true } : {}) : stand('Scene', 'mdi:palette', 'Choose a scene in the editor.'); } },
    scenes: { sizes: ['W', 'T', 'L', 'XL', 'XXL'], sources: ['scenes'], opts: { scenes: 'scenes', surface: 'surface', height: 'tile_height', color: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-scenes-card', surface: o.surface }, o.scenes ? { scenes: o.scenes } : {},
                           o.height ? { height: o.height } : {}, o.color ? { color: true } : {}); } },
    now_playing: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: ['speakers'], opts: { speaker: 'speaker', background: 'np_background', tap: 'tap_target' }, card: function (s, o) {
      // T, L and XL: the progress above the transport (the Home app's and Apple
      // Music's order); L and XL the volume under it (Music's widgets,
      // 2026-10-31). Its speaker's own controls, or the screen's music.
      var sp = own(o.speaker), ctl = function (parts) {
        return Object.assign({ type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: parts },
                             sp ? { entity: sp } : { entity_from: { music: true } });
      };
      // (2026-11-08, the owner: what does not fit goes to the player's sheet) -- and back (2026-11-09, the owner: "Looks
      // like the tall and the wide cards lost their volume slider?" and "Volume is more important than the progress bar for
      // these cards"): W, T, L and XL carry the progress and the volume; where both do not fit as full targets the
      // progress is a thin read-only line (hk-media-now.js), the volume keeps its slider. S has play / pause alone.
      var extra = s === 'S' ? {} : { sub_card: ctl(['progress']), meta_card: ctl(['volume']) };
      // (background, 2026-11-05, the owner: the blurred album unless the block asks for the card every other block has)
      return Object.assign({ type: 'custom:hk-now-playing-card', music: true }, sp ? { entity: sp } : {}, o.background === 'card' ? { background: 'card' } : {}, extra); } },
    // Extra Large: the thermostat's full controls, its sheet (2026-10-24) -- in Big Number, its face with the modes
    // beside it (hk-control.js _big, 2026-10-31)
    thermostat: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: ['thermostats'], opts: { entity: 'climate', style: 'thermostat_style', tap: 'tap_target' }, card: function (s, o, ctx) {
      var id = own(o.entity) || (ctx.climate || [])[0];
      if (s === 'XL' && o.style !== 'big') return panel('climate', id ? { entity: id } : {});
      // the dial (hk-control.js), sized to the block (G2) -- or its Big Number
      // (Wide, 2026-11-07, the review: always Big Number, as Small is -- the ring has no room across a short cell)
      return id ? Object.assign({ type: 'custom:hk-control-card', entity: id }, o.style === 'big' || s === 'W' ? { style: 'big' } : {})
                : stand('Thermostat', 'hk:thermostat', 'No thermostat yet.'); } },
    // (S, 2026-10-31, the owner: "a small option to the camera": one still in a cell)
    camera: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: ['cameras'], opts: { entity: 'camera', follow: 'camera_follow', follow_select: 'select', name: 'name_tag' }, card: function (s, o, ctx) {
      var ids = o.entity ? [o.entity] : (ctx.cameras || []).slice(0, 1);
      // EXTRA LARGE (2026-11-09, mockup 13): the picture beside what that camera saw today -- where the host keeps a Timeline
      // (Mantel); elsewhere (Home Assistant's HK Frontend) it stays the full picture
      if (s === 'XL' && ids.length && hostHas('timeline')) return { type: 'custom:hk-camera-today-card', camera: ids[0] };
      return ids.length ? { type: 'custom:hk-camera-mosaic-card', own_cameras: true, height: 195, seam: 2, snapshot_cap: '480x270',
                            cameras: ids.map(function (id) { return { entity: id }; }), name_tag: o.name || 'auto' }
                        : stand('Cameras', 'hk:camera', 'No cameras yet.'); } },
    // THE CAMERAS FACE (2026-10-30; hk-grid-cards.js hk-grid-cameras-card):
    // up to nine stills at once, arranged to the block -- the ones named, else
    // every camera in Cameras' order (ctx.cameras)
    cameras: { sizes: ['XL', 'XXL', 'F'], sources: [], opts: { cameras: 'cameras', refresh: 'refresh' }, card: function (s, o, ctx) {
      var ids = o.cameras && o.cameras.length ? o.cameras : (ctx.cameras || []);
      return ids.length ? Object.assign({ type: 'custom:hk-grid-cameras-card', cameras: ids.slice() }, o.refresh ? { refresh: o.refresh } : {})
                        : stand('Cameras', 'hk:camera', 'No cameras yet.'); } },
    // Large and Extra Large: the alarm's keypad (2026-10-24). HomeView (2026-11-07, `presentation: homeview`): the five
    // HomeView compositions, Compact (3 x 1) among them -- hk-grid-security.js hk-grid-security-hv-card; absent, the
    // block as it always was. members: the locks and garage doors it shows, in order (none: the house's)
    security: { sizes: ['S', 'W', 'C', 'T', 'L', 'XL'], sources: [], opts: { entity: 'alarm', tap: 'tap_target', presentation: 'security_presentation', members: 'security_members', lit: 'security_lit', height: 'tile_height' }, card: function (s, o) {
      // (HomeView's Extra Large keeps the keypad -- 2026-11-08, the owner: "when you set it to HomeView mode, the Keypad goes away": the
      // keypad beside its entries as HomeView tiles or pills (Height), the entries its own when chosen)
      if (o.presentation === 'homeview' && s === 'XL') return Object.assign({ type: 'custom:hk-grid-keypad-card' }, o.entity ? { entity: o.entity } : {},
        o.height === 'half' || o.height === 'full' ? { height: o.height } : {}, o.members && o.members.length ? { members: o.members.slice() } : {},
        { hv: true }, o.lit === false ? { lit: false } : {});
      // (lit, 2026-11-09: Light Up When Armed, on unless false)
      if (o.presentation === 'homeview') return Object.assign({ type: s === 'S' ? 'custom:hk-grid-security-key-card' : 'custom:hk-grid-security-hv-card', size: s }, o.entity ? { entity: o.entity } : {},
                                                             o.members && o.members.length ? { members: o.members.slice() } : {}, o.lit === false ? { lit: false } : {});
      // (Height, 2026-11-08, the owner: "are you offering half height pills too?": Large and Extra Large's locks as HomeView tiles, or half-height pills)
      var hh = o.height === 'half' || o.height === 'full' ? { height: o.height } : {};
      if (s === 'L' || s === 'XL') return Object.assign({ type: 'custom:hk-grid-keypad-card' }, o.entity ? { entity: o.entity } : {}, hh);
      return Object.assign({ type: 'custom:hk-grid-security-card' }, o.entity ? { entity: o.entity } : {}, hh); } },
    timers: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target' }, card: function () {
      return { type: 'custom:hk-timer-strip-card', entity: 'sensor.running_quick_timers' }; } },
    // Tall, and Big Temperature at any size: the number large, as StandBy has it (2026-10-24)
    weather: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { entity: 'weather', sky: 'boolean', big: 'boolean', tap: 'tap_target' }, card: function (s, o, ctx) {
      var id = o.entity || ctx.weather;
      return id ? Object.assign({ type: 'custom:hk-weather-band-card', section: 'hero', entity: id, sky: o.sky === true }, o.big ? { big: true } : {})
                : stand('Weather', 'hk:weather-partly-cloudy', 'Choose a weather entity in Settings → Weather.'); } },
    calendar: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { calendars: 'calendars', days: 'days', month: 'boolean', tap: 'tap_target' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-calendar-pane-card' }, o.calendars ? { calendars: o.calendars } : {}, o.days ? { days: o.days } : {},
                           o.month ? { month: true } : {}); } },
    battery: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target' }, card: function (s, o, ctx) {
      // the house battery the Energy feature names (hk-energy.js), sized to the block (G2)
      var B = ctx.battery;
      return B && B.level ? { type: 'custom:hk-house-battery-card', level: B.level, stored: B.stored, backup: B.backup,
                              reserve: B.reserve, charge: B.charge, discharge: B.discharge }
                          : stand('Battery', 'mdi:home-battery', 'Add Energy with a house battery in Settings to show it here.'); } },
    people: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target', map: 'boolean' }, card: function (s, o) { return Object.assign({ type: 'custom:hk-people-card' }, o.map ? { map: true } : {}); } },
    // Large and Extra Large: its controls with Clean Areas (2026-10-24)
    vacuum: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { entity: 'vacuum', tap: 'tap_target' }, card: function (s, o, ctx) {
      var id = o.entity || ctx.vacuum;
      if (!id) return stand('Vacuum', 'hk:robot-vacuum', 'No vacuum yet.');
      return { type: s === 'L' || s === 'XL' ? 'custom:hk-grid-vacuum-card' : 'custom:hk-vacuum-card', entity: id }; } },
    // every size, HK's clock or a screensaver face, with or without its box (2026-10-24)
    clock: { sizes: ['S', 'W', 'T', 'L', 'XL', 'XXL'], sources: [], opts: { clock_style: 'clock_style', bare: 'boolean', tap: 'tap_target' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-grid-clock-card' }, o.clock_style ? { clock_style: o.clock_style } : {}, o.bare ? { bare: true } : {}); } },
    // THE PAGES' OWN PANELS (2026-10-24; hk-grid-cards.js hk-grid-panel-card),
    // each read live from the house's settings as its page reads them
    power: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target' }, card: function () { return panel('power'); } },
    // show (2026-10-31, the owner): Recently Played, the Music page's playlists (presets) or one playlist, named by `playlist`;
    // speaker: where a tap plays -- a speaker or a speaker group -- else this screen's music
    music: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { show: 'music_show', playlist: 'music_playlist', speaker: 'music_speaker', tap: 'music_tap' }, card: function (s, o) {
      return panel('music', Object.assign(o.show && o.show !== 'recent' ? { show: o.show } : {}, o.show === 'playlist' && o.playlist ? { playlist: o.playlist } : {},
                                          o.speaker ? { speaker: o.speaker } : {})); } },
    doors: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target' }, card: function () { return panel('doors'); } },
    // channel (2026-10-31, the owner): one channel of the guide, by its number, fills the block; none, as many as the size holds
    live_tv: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { channel: 'tv_channel', tap: 'tap_target' }, card: function (s, o) {
      return panel('tv', o.channel ? { channel: o.channel } : {}); } },
    water: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target' }, card: function () { return panel('water'); } },
    // THE NEW CARDS (G3, hk-grid-cards.js). `opts` names each option and its
    // kind, as home_grid.CATALOG does (a test holds them equal). A card handed
    // `tablet_room` resolves it itself, through the host (hkShell.tabletRoom):
    // the tablet showing the screen may be known only once the page is up.
    // `fallback` is the room it shows on a page that is no wall tablet.
    room: { sizes: ['S', 'W', 'T', 'L', 'XL', 'XXL'], sources: ['rooms'], opts: { area: 'area', surface: 'surface', accessory_display: 'room_display', tap: 'tap_target' }, card: function (s, o, ctx) {
      // no room of its own: the tablet's, else the screen's first
      return { type: 'custom:hk-grid-room-card', area: o.area || TABLET_ROOM, fallback: (ctx.rooms || [])[0] || null, size: s, surface: o.surface, accessory_display: o.accessory_display || 'summary' }; } },
    scene_suggested: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { windows: 'windows' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-suggested-scene-card', size: s }, o.windows ? { windows: o.windows } : {}); } },
    action: { sizes: ['S', 'W'], sources: [], opts: { action: 'action', area: 'area', color: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-action-card', action: o.action || 'lock_up' }, o.area ? { area: o.area } : {}, o.color ? { color: true } : {}); } },
    // more (2026-11-08, the owner: "if they want to scroll within the card or go to the page with the + button"): page
    // (the default, as before: the last place, "+N", opens the Pages screen or More) or scroll (every place, in the block)
    everything: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target', more: 'everything_more' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-everything-card' }, o.more === 'scroll' ? { more: 'scroll' } : {}); } },
    // THE WIDGET BLOCKS (2026-10-31, docs/phase11/HOMEVIEW-LOOK.md "Blocks as widgets"): what is on now, a to-do
    // list, and the Energy page's rings over a period of the block's own
    // open (2026-11-08, the owner: a category should "either show a pop up or go to those pages... users decisions"):
    // sheet (the default) or page
    on_now: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target', open: 'on_now_open' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-on-now-card' }, o.open === 'page' ? { open: 'page' } : {}); } },
    todo: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { entity: 'todo', tap: 'tap_target' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-todo-card' }, o.entity ? { entity: o.entity } : {}); } },
    energy_rings: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { period: 'period', tap: 'tap_target' }, card: function (s, o) {
      return { type: 'custom:hk-energy-rings-card', period: o.period || 'day' }; } },
    // THE INTERCOM (2026-11-03, docs/phase17/INTERCOM.md; hk-intercom.js): a button that opens its sheet -- speak a message
    // into the HomePods of the rooms you pick. Wide also shows the last rooms picked. Always the sheet: no When Tapped.
    // Without Mantel (HK Frontend in Home Assistant) the card says "Intercom needs Mantel".
    intercom: { sizes: ['S', 'W'], sources: [], opts: {}, card: function (s) {
      return { type: 'custom:hk-intercom-card', size: s }; } },
    // RECENT (2026-11-03, docs/phase19/HOUSE-TIMELINE.md "The views", hk-timeline-block.js): the House Timeline's last rows
    // -- or, in the morning, its summary of the night. Mantel's own record: a host that has no Timeline (Home
    // Assistant's HK Frontend, a person whose role has none) draws a stand-in, and the editors never offer it there
    // (hkShell.hostPage, asked here as the Timeline page's own entry is). show: auto (default), latest, digest
    timeline: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { show: 'timeline_show', tap: 'tap_target' }, card: function (s, o) {
      if (!hostHas('timeline')) return stand('Recent', 'mdi:history', 'Recent isn\'t available here.');
      return { type: 'custom:hk-timeline-block-card', size: s, show: o.show === 'latest' || o.show === 'digest' ? o.show : 'auto' }; } },
    // HOUSE STATUS (2026-11-07, docs/phase11/HOUSE-STATUS.md, hk-house-status.js): this screen's status chips as
    // sections, each a tap to its chip's page; the rest, and Small, open the House Status sheet. No options: it shows
    // what the screen's Status Chips say, whether or not the screen draws its chip row. No When Tapped: each section
    // opens its own place.
    house_status: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: {}, card: function (s) {
      return { type: 'custom:hk-house-status-card', size: s }; } }
  };
  // A BLOCK ONLY SOME HOSTS HAVE: asked of the host (hkShell.hostPage), never assumed -- no shell, no host page
  function hostHas(name) {
    var SH = window.hkShell;
    try { return !!(SH && typeof SH.hostPage === 'function' && SH.hostPage(name)); } catch (e) { return false; }
  }
  var SOURCES = ['list', 'rooms', 'cameras', 'thermostats', 'speakers', 'scenes', 'accessories'];

  // A BLOCK'S CARD: the item's card at its size, with its options -- or, for
  // a block with pages from a source its card has, an hk-pager-card, which
  // asks pages() for its pages (when it is drawn: a speakers block's
  // speakers come from the Music feature, after the strategy has run). A key
  // the catalog doesn't have (a layout saved by a newer HK) is a stand-in,
  // never an error card on a wall tablet.
  function config(item, ctx) {
    var it = item || {}, c = CARDS[it.card];
    if (!c) return stand('Unavailable', 'mdi:help-circle-outline', 'This block isn\'t available here.');
    if ((it.rules && it.rules.length) || (it.when && it.fallback)) return { type: 'custom:hk-grid-conditional-card', item: it, ctx: ctx || {}, force: it._conditionPreview };
    if (paged(it)) return { type: 'custom:hk-pager-card', item: it, ctx: ctx || {} };
    return tapped(c.card(it.size, it.opts || {}, ctx || {}), it.opts);
  }
  // WHEN TAPPED, the block's choice (Automatic is none): the card's `tap` -- 'page', 'sheet' or 'none' (hk-base.js openTarget)
  function tapped(cfg, o) {
    return o && o.tap && o.tap !== 'auto' && cfg && cfg.type !== 'custom:hk-key-card' ? Object.assign({}, cfg, { tap: o.tap }) : cfg;
  }
  var TAP_TARGETS = [['auto', 'Automatic'], ['page', 'Page'], ['sheet', 'Detail Sheet'], ['none', 'Nothing']];
  // ...a Music block's (2026-11-01, the owner): Choose a Playlist, the house's playlists in the Music page's sheet
  var MUSIC_TAPS = TAP_TARGETS.concat([['playlists', 'Choose a Playlist']]);
  function paged(it) {
    var p = it.pages, c = CARDS[it.card];
    return !!(c && p && (p.source === 'list' ? Array.isArray(p.list) && p.list.length
                                             : c.sources.indexOf(p.source) >= 0));
  }

  // PAGES THAT SWIPE (docs/phase11/HOME-GRID.md, "Blocks that swipe"): a
  // block's pages, each { card, area, entity } -- the page's card config, and
  // the room and the thing it shows, for the pager's start page and the
  // doorbell's jump. At most PAGES_MAX, as hk_core checks a `list`.
  //   list         the pages set up, each the block's card with its own options
  //   rooms        one per room, in the screen's order (ctx.rooms)
  //   cameras      one per camera, in Cameras' order (ctx.cameras)
  //   thermostats  one per climate entity, in room order (ctx.areas: entity -> room)
  //   speakers     one per speaker, then each group (ctx.speakers: [{entity, area}])
  //   scenes       the scenes (ctx.scenes), as many to a page as the size holds
  // The block's own options go to every page, under the page's. Nothing in
  // the house to show: one page, the block's card as it is without pages.
  var PAGES_MAX = 12;
  var PER_PAGE = { W: 2, T: 2, L: 4, XL: 6, XXL: 12 };      // a scenes page's scenes, by size
  // ...twice as many at Half height (2026-10-31: the shorter button, two rows in each of Full's)
  function perPage(it) { return (PER_PAGE[it.size] || 2) * (((it.opts || {}).height === 'half') ? 2 : 1); }
  function pages(item, ctx) {
    var it = item || {}, c = CARDS[it.card], x = ctx || {};
    if (!c) return [{ card: stand('Unavailable', 'mdi:help-circle-outline', 'This block isn\'t available here.') }];
    var p = it.pages || {}, base = it.opts || {}, areas = x.areas || {};
    function page(opts, extra) {
      var o = Object.assign({}, base, opts), cfg = tapped(c.card(it.size, o, x), o);
      // a scenes page shows just its scenes, never the screen's Scenes choice
      if (it.card === 'scenes' && o.scenes) cfg.room = true;
      return Object.assign({ card: cfg }, extra || {});
    }
    var out = [], rooms = x.rooms || [];
    if (!paged(it)) { /* no pages: the block's card, below */ }
    else if (p.source === 'list') {
      out = p.list.map(function (pg) { return page((pg && pg.opts) || {}); });
    } else if (p.source === 'accessories') {
      var entries = base.accessories || [], count = perPage(it);
      for (var ai = 0; ai < entries.length; ai += count) out.push(page({ accessories: entries.slice(ai, ai + count) }));
    } else if (p.source === 'rooms') {
      out = rooms.map(function (a) { return page({ area: a }, { area: a }); });
    } else if (p.source === 'cameras') {
      out = (x.cameras || []).map(function (id) { return page({ entity: id }, { entity: id, area: areas[id] || null }); });
    } else if (p.source === 'thermostats') {
      var rank = function (id) { var i = rooms.indexOf(areas[id]); return i < 0 ? rooms.length : i; };
      out = (x.climate || []).map(function (id, i) { return { id: id, i: i }; })
        .sort(function (a, b) { return (rank(a.id) - rank(b.id)) || (a.i - b.i); })
        .map(function (t) { return page({ entity: t.id }, { entity: t.id, area: areas[t.id] || null }); });
    } else if (p.source === 'speakers') {
      out = (x.speakers || []).filter(function (s) { return s && s.entity; })
        .map(function (s) { return page({ speaker: s.entity }, { entity: s.entity, area: s.area || null }); });
    } else if (p.source === 'scenes') {
      var per = perPage(it), all = (x.scenes || []).slice(0, per * PAGES_MAX);
      for (var i = 0; i < all.length; i += per) out.push(page({ scenes: all.slice(i, i + per) }));
    }
    out = out.slice(0, PAGES_MAX);
    return out.length ? out : [{ card: tapped(c.card(it.size, base, x), base) }];
  }

  // THE TABLET'S ROOM (`tablet_room` in a block's options and `pages.start`):
  // the room of the wall tablet showing this page -- an area id, or null on a
  // page that is no tablet's. The host answers (hkShell.tabletRoom: Home
  // Assistant's Wall Tablets entry, Mantel's tablet device); without that
  // call, hkSettings.tablet(), the settings' own answer to "which tablet is
  // this" (never the host's object).
  function tabletRoom(client) {
    var SH = window.hkShell, here = null;
    try { here = SH && typeof SH.tabletRoom === 'function' ? SH.tabletRoom(client) : null; } catch (e) { here = null; }
    if (here) return here;
    var HS = window.hkSettings, t = null;
    try { t = HS && typeof HS.tablet === 'function' ? HS.tablet(client) : null; } catch (e) { t = null; }
    return (t && t.room) || null;
  }

  var CONDITIONS = ['music_playing', 'timer_running', 'alarm_armed', 'alarm_disarmed', 'doorbell', 'after_sunset', 'entity_state', 'time'];
  function hhmm(t) { var m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  // the time of day in the house's zone, in minutes
  function houseNow(date) {
    var d = date || new Date();
    try {
      var L = window.hkLocale, z = L && L.zone ? L.zone() : null;
      var s = d.toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, z ? { timeZone: z } : {}));
      var m = hhmm(s.slice(0, 5));
      if (m !== null) return m;
    } catch (e) { /* no Intl */ }
    return d.getHours() * 60 + d.getMinutes();
  }
  // ONE CONDITION, or a rule's {all: [...]} (each must hold). `now`: minutes
  // into the house's day (a test's), else the clock's. `speakers`: the house's
  // music speakers (ctx.speakers' entities): Music Is Playing with no speaker
  // chosen is any of THEM playing (2026-11-01, the owner: "whenever any music is
  // playing from any HomePod") -- not a TV or a receiver, which play for hours
  function matches(when, states, ringing, alarm, now, speakers) {
    if (when && Array.isArray(when.all)) return when.all.length > 0 && when.all.every(function (c) { return matches(c, states, ringing, alarm, now, speakers); });
    var c = when || {}, st = states || {}, ids = c.entity ? [c.entity] : Object.keys(st);
    if (c.kind === 'time') {
      var a = hhmm(c.from), b = hhmm(c.to), t = now == null ? houseNow() : now;
      if (a === null || b === null || a === b) return false;
      return a < b ? t >= a && t < b : t >= a || t < b;
    }
    if (c.kind === 'alarm_disarmed') return (c.entity ? ids : alarm ? [alarm] : ids).some(function (id) { return id.split('.')[0] === 'alarm_control_panel' && st[id] && st[id].state === 'disarmed'; });
    var any = function (domain, test) { return ids.some(function (id) { return id.split('.')[0] === domain && st[id] && test(st[id].state); }); };
    if (c.kind === 'entity_state') return !!st[c.entity] && st[c.entity].state === c.state;
    if (c.kind === 'music_playing') {
      if (!c.entity && speakers && speakers.length) ids = speakers;
      return any('media_player', function (s) { return s === 'playing'; });
    }
    if (c.kind === 'timer_running') return any('timer', function (s) { return s === 'active' || s === 'paused'; }) ||
      !c.entity && !!st['sensor.running_quick_timers'] && Number(st['sensor.running_quick_timers'].state) > 0;
    if (c.kind === 'alarm_armed') return (c.entity ? ids : alarm ? [alarm] : ids).some(function (id) { return id.split('.')[0] === 'alarm_control_panel' && st[id] && /^(armed_|arming|pending|triggered)/.test(st[id].state); });
    if (c.kind === 'after_sunset') return any('sun', function (s) { return s === 'below_horizon'; });
    if (c.kind === 'doorbell') {
      // a ring (hk-house-event) counts when it was at this camera, or the condition names none
      var rang = ringing && (ringing === true || !c.entity || c.entity.indexOf('camera.') !== 0 || ringing === c.entity);
      return !!rang || !!c.entity && !!st[c.entity] && st[c.entity].state === 'on';
    }
    return false;
  }

  // A BLOCK'S DEFAULT AND ITS RULES, however it was saved: its own card and
  // `rules` (first match wins), or the older `when` + `fallback` read the same
  // way -- the fallback the default, the block's own card its one rule
  function rulesOf(item) {
    var it = item || {}, own = {};
    Object.keys(it).forEach(function (k) { if (['when', 'fallback', 'rules', '_conditionPreview'].indexOf(k) < 0) own[k] = it[k]; });
    if (it.rules && it.rules.length) return { base: own, rules: it.rules };
    if (it.when && it.fallback) return { base: Object.assign({ id: it.id, size: it.size, at: it.at }, it.fallback),
                                          rules: [{ when: it.when, card: it.card, opts: it.opts, pages: it.pages }] };
    return { base: own, rules: [] };
  }
  // which shows now: -1 the default, else the first rule that holds
  function choose(item, states, ringing, alarm, now, speakers) {
    var r = rulesOf(item).rules;
    for (var i = 0; i < r.length; i++) if (matches(r[i].when, states, ringing, alarm, now, speakers)) return i;
    return -1;
  }

  // ------------------------------------------------------------ a block's Custom Detail Sheet
  // CUSTOM DETAIL SHEET (2026-11-07, docs/phase11/HOME-GRID.md "Custom Detail Sheet"): any block may open a sheet of
  // accessories it names -- the block's `interaction` (home_grid.py interaction(): these are its numbers). `tap`:
  // 'default' (the card's own tap; a sheet kept as a draft) or 'custom_sheet'. The sheet is the block's, whatever card
  // its rules or pages show.
  var SHEET = { v: 1, max: 24, titleMax: 60, nameMax: 60, taps: ['default', 'custom_sheet'], styles: ['home', 'centred'],
                secondary: ['auto', 'state', 'room', 'brightness', 'attribute', 'none'],
                colors: ['orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'red', 'gray'],
                icon: /^[a-z0-9_-]{1,12}:[a-z0-9_-]{1,64}$/, entryId: /^[a-z0-9][a-z0-9_-]{0,31}$/, hex: /^#[0-9a-fA-F]{6}$/ };
  // the sheet a tap opens now: the block's, when it is on and has something in it; else null (the card's own tap)
  function sheetOf(item) {
    var act = item && item.interaction, sh = act && act.custom_sheet;
    return act && act.tap === 'custom_sheet' && sh && Array.isArray(sh.entries) ? sh : null;
  }
  // a fresh entry id, none of `taken`'s
  function entryId(taken) {
    var have = {}, n = (taken || []).length + 1;
    (taken || []).forEach(function (e) { if (e && e.id) have[e.id] = 1; });
    while (have['e' + n]) n++;
    return 'e' + n;
  }
  // AN INDEPENDENT COPY of a sheet (Copy from Another Block, Duplicate Block): every part copied, every entry a new id
  function copySheet(sheet) {
    var out = JSON.parse(JSON.stringify(sheet || { v: 1, entries: [] })), seen = [];
    out.entries = (out.entries || []).map(function (e) { var x = Object.assign({}, e, { id: entryId(seen) }); seen.push(x); return x; });
    return out;
  }
  // WHERE A TAP ON A BLOCK OPENS ITS SHEET (hk-layout.js hk-home-grid-view, the one place it is decided): a block that
  // IS one button (an accessory, a scene, an action, the intercom) opens it wherever it is tapped, never toggling under
  // it; a card that draws its own sheet entry (Security's HomeView) opens it from its own parts; every other card from
  // anywhere that is no control of its own -- and, as some are all controls, from a 44 px button in its corner.
  var SHEET_PRIMARY = { accessory: 1, scene: 1, action: 1, intercom: 1, everything: 1 };
  function sheetRoute(item) {
    var it = item || {};
    if (it.card === 'security' && (it.opts || {}).presentation === 'homeview') return 'own';
    return SHEET_PRIMARY[it.card] ? 'primary' : 'surface';
  }
  // A BLOCK'S CUSTOM DETAIL SHEET (2026-11-07, docs/phase11/HOME-GRID.md "Custom Detail Sheet"): the one place a tap on a
  // block is read for it, whatever the card -- its rules, pages and controls included. `info`: { sheet, route, title,
  // style } (placed(), below), null for a block without one. route (hk-grid-catalog.js sheetRoute):
  //   primary   the block is one button (an accessory, a scene, an action): a tap or Enter anywhere opens the sheet,
  //             and never also toggles, runs or opens what the card would
  //   surface   anywhere that is no control of the card's own (a slider, a transport key, a row with its own sheet
  //             keep theirs), or the card's whole plate when that is its one button; and the corner button
  //   own       the card opens it from its own parts (Security's HomeView)
  // Never from a swipe (a pager's page, the views), a long press, a drag, or in Edit mode. Taken in the capture phase,
  // so the card under it never sees a tap the sheet answered.
  var SHEET_SLOP = 10, SHEET_HOLD = 500;
  function sheetOpen(slot, info) {
    var D = window.hkDetail;
    if (!D || !D.openSheet || !info) return false;
    return D.openSheet(info.sheet, { title: info.title, style: info.style, opener: slot.querySelector('.sheet-go') || slot });
  }
  function sheetEditing(view) {
    var root = view && view._root;
    try { if (document.documentElement.hasAttribute('data-hk-editing')) return true; } catch (e) { /* no document */ }
    return !!(root && root.classList && root.classList.contains('hk-editing'));
  }
  // what a tap at the end of `path` landed on, from the slot down: 'control' (one of the card's own), 'plate' (the
  // card's whole plate as its one button: data-hk-role=card) or 'surface'
  function sheetHit(path, slot) {
    var C0 = window.hkCards, sel = C0 && C0.TAP_CONTROLS;
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (n === slot) break;
      if (!n || !n.matches) continue;
      if (n.classList && n.classList.contains('sheet-go')) return 'go';
      if (sel && n.matches(sel)) return n.getAttribute('data-hk-role') === 'card' ? 'plate' : 'control';
    }
    return 'surface';
  }
  function sheetSlot(slot, info, view) {
    slot._hkSheet = info;
    var go = null;
    for (var k = 0; k < slot.childNodes.length; k++) { var ch = slot.childNodes[k]; if (ch.classList && ch.classList.contains('sheet-go')) go = ch; }
    if (info && info.route === 'surface') {
      if (!go) {
        go = document.createElement('button');
        go.type = 'button';
        go.className = 'sheet-go';
        go.innerHTML = '<i><hk-icon icon="mdi:dots-horizontal"></hk-icon></i>';
        go.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); if (!sheetEditing(view)) sheetOpen(slot, slot._hkSheet); });
        slot.appendChild(go);
      }
      go.setAttribute('aria-label', (info.sheet.title || info.title) + ': open details');
    } else if (go) slot.removeChild(go);
    if (slot._hkSheetWired) return;
    slot._hkSheetWired = true;
    var down = null;
    slot.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: e.timeStamp || Date.now(), id: e.pointerId }; }, true);
    slot.addEventListener('pointermove', function (e) {
      if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > SHEET_SLOP) down.moved = true;
    }, true);
    slot.addEventListener('click', function (e) {
      var info2 = slot._hkSheet, d = down;
      down = null;
      if (!info2 || info2.route === 'own' || e.defaultPrevented || sheetEditing(view)) return;
      // (a swipe, a drag or a long press ends in a click too: never a sheet)
      if (d && (d.moved || (e.timeStamp || Date.now()) - d.t > SHEET_HOLD)) return;
      var hit = sheetHit(e.composedPath ? e.composedPath() : [e.target], slot);
      if (hit === 'go') return;
      if (info2.route === 'surface' && hit === 'control') return;
      e.stopPropagation(); e.preventDefault();
      sheetOpen(slot, info2);
    }, true);
    slot.addEventListener('keydown', function (e) {
      var info2 = slot._hkSheet;
      if (!info2 || info2.route !== 'primary' || (e.key !== 'Enter' && e.key !== ' ') || sheetEditing(view)) return;
      e.stopPropagation(); e.preventDefault();
      sheetOpen(slot, info2);
    }, true);
  }

  // ...its corner button's look: a sheet's close button's -- the key well, the ink (hk-layout.js adds it to the view's CSS);
  // its reach 54 px, so it is 44 on screen in a grid scaled to a 1180 x 820 tablet (about 0.83)
  function sheetCss(v) {
    return '.cell>.sheet-go{all:unset;position:absolute;z-index:3;top:calc(var(--hk-in-t,0px) + 4px);right:calc(var(--hk-in-r,0px) + 4px);width:54px;height:54px;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.cell>.sheet-go i{width:28px;height:28px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:' + v('key') + ';color:' + v('ink') + '}' +
      '.cell>.sheet-go hk-icon{width:18px;height:18px;--mdc-icon-size:100%;display:flex}' +
      '.cell>.sheet-go:focus-visible i{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}' +
      '#root.hk-editing .cell>.sheet-go{display:none}';
  }
  // A BLOCK AS THE HOME GRID'S VIEW TAKES IT (hk-strategy.js homeGridView): its card, with its cell -- and on the cell,
  // its custom sheet when it has one on, what it is called without a title of its own, and the screen's tile style
  // (its own, else All Screens'; Automatic by the cell's shape) for a sheet that says Same as Screen. Security's
  // HomeView draws its own way into its overview, so its card is handed the sheet and the style too.
  function placed(item, ctx, cell, gridCell, tiles) {
    var it = item || {}, sh = sheetOf(it), screen = tiles || 'auto';
    var style = screen === 'centred' || (screen === 'auto' && gridCell === 'square') ? 'centred' : 'home';
    if (sh) cell.sheet = { sheet: sh, route: sheetRoute(it), title: NAMES[it.card] || 'Accessories', style: style };
    var made = config(it, ctx);
    if (made && /^custom:hk-grid-security-(hv|key)-card$/.test(made.type)) made = Object.assign({}, made, { sheet_style: style }, sh ? { custom_sheet: sh } : {});
    return Object.assign(made, { hk_cell: cell });
  }
  // A CARD'S NAME, for a sheet's title when it has none of its own (and the editor's palette)
  var NAMES = { accessory: 'Accessory', accessories: 'Accessory Group', scene: 'Scene', scenes: 'Scenes', now_playing: 'Now Playing',
    thermostat: 'Thermostat', camera: 'Camera', security: 'Security', timers: 'Timers', weather: 'Weather',
    calendar: 'Calendar', battery: 'House Battery', people: 'People', vacuum: 'Vacuum', clock: 'Clock',
    room: 'Room', scene_suggested: 'Suggested Scene', action: 'Action', everything: 'Everything', cameras: 'Cameras',
    power: 'Power', music: 'Music', doors: 'Doors & Locks', live_tv: 'Live TV', water: 'Water',
    on_now: 'On Now', todo: 'To-do', energy_rings: 'Energy Rings', timeline: 'Recent', intercom: 'Intercom', house_status: 'House Status' };

  // the catalog as data, for the parity test and the editor (G5)
  function table() {
    var out = {};
    Object.keys(CARDS).forEach(function (k) {
      out[k] = { sizes: CARDS[k].sizes.slice(), sources: CARDS[k].sources.slice() };
      if (CARDS[k].opts) out[k].opts = Object.assign({}, CARDS[k].opts);
    });
    return out;
  }

  window.hkGridCatalog = { version: '1.0.0', SIZES: SIZES, span: span, CELLS: CELLS, SOURCES: SOURCES, TABLET_ROOM: TABLET_ROOM,
                           PAGES_MAX: PAGES_MAX, PER_PAGE: PER_PAGE, perPage: perPage, CLOCK_FACES: CLOCK_FACES, THERMOSTAT_STYLES: THERMOSTAT_STYLES, TAP_TARGETS: TAP_TARGETS, MUSIC_TAPS: MUSIC_TAPS,
                           SHEET: SHEET, sheetOf: sheetOf, entryId: entryId, copySheet: copySheet, sheetRoute: sheetRoute, NAMES: NAMES,
                           sheetSlot: sheetSlot, sheetCss: sheetCss, placed: placed,
                           CONDITIONS: CONDITIONS, hostHas: hostHas, matches: matches, rulesOf: rulesOf, choose: choose, houseNow: houseNow, config: config, pages: pages, tabletRoom: tabletRoom, table: table };
  try { window.dispatchEvent(new CustomEvent('hk-grid-catalog-ready')); } catch (e) { /* a test page without events */ }
})();
