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
  // ONE WAY TO PICK A SPEAKER (2026-11-10, the owner: Now Playing's speaker was any media player, and the Living Room's followed
  // an Apple TV -- its song from the room, its time and volume from the TV). Now Playing and Music Is Playing name one of the
  // house's music rooms or groups (hkMusic's speakers, Mantel Settings -> Music) or Tablet's Room: the room the tablet's
  // music calls home (hkMusic.home). A key that is none of them (an older layout's TV) reads as it always did.
  function musicSpeaker(key) {
    var M = window.hkMusic, k = M && key ? (key === TABLET_ROOM ? M.home() : M.fold([key])[0]) : null;
    return (k && M.speakers().filter(function (s) { return s.entity === k; })[0]) || null;
  }
  // the players a key plays on (a pair's both, a group's every room's), for Music Is Playing: [] for Tablet's Room on a
  // page that is no tablet's (it never holds there), null for a key that is no music speaker (the entity itself)
  function musicPlayers(key) {
    var M = window.hkMusic, s = musicSpeaker(key), by = {};
    if (!s) return key === TABLET_ROOM ? [] : null;
    M.speakers().forEach(function (x) { by[x.entity] = x; });
    return [].concat.apply([], (s.members || [s.entity]).map(function (r) { return (by[r] && by[r].parts) || [r]; }));
  }
  // the editor's list for both (hkMusic.speakers()): Tablet's Room, the groups, the rooms -- as the Music block's Plays On lists them
  function speakerChoices(ms) {
    return [[TABLET_ROOM, 'Tablet’s Room']].concat(ms.filter(function (s) { return !!s.members; }).map(function (g) { return [g.entity, g.name + ' (Group)']; }),
      ms.filter(function (s) { return !s.members; }).map(function (r) { return [r.entity, r.name]; }));
  }
  // what a card set to a key follows: the music playing in that room or group, else that room (a group's leader) ready to
  // play; with none chosen, or one that is no music speaker, the screen's own music (hkMusic.resolve) -- so the song, the
  // time, the volume and the buttons all come from the one player
  function musicAt(client, key) {
    var M = window.hkMusic, s = musicSpeaker(key), rooms = s ? s.members || [s.entity] : [];
    if (!M) return { player: null, context: null, reason: 'none', name: '' };
    if (!s) return M.resolve(client);
    var hit = M.contexts(client).filter(function (c) { return rooms.some(function (r) { return c.members.indexOf(r) >= 0; }); })
      .sort(function (a, b) { return (b.playing ? 1 : 0) - (a.playing ? 1 : 0); })[0];
    return hit ? { player: hit.key, context: hit, reason: 'chosen', name: M.label(hit) }
      : { player: s.members ? M.leader(rooms) : s.entity, context: null, reason: 'chosen', name: s.name };
  }
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
      return o.entity ? Object.assign({ type: 'custom:hk-grid-entity-card', entity: o.entity, secondary: o.secondary, kind: 'accessory', size: s }, o.color ? { color: true } : {}) :
        stand('Accessory', 'mdi:lightbulb', 'Choose an accessory in the editor.'); } },
    // (height, color 2026-10-31: Full, HomeView's square tile, or Half, the shorter button; each on its own
    // color's gradient or glass)
    accessories: { sizes: ['S', 'W', 'T', 'L', 'XL', 'XXL'], sources: ['accessories'],
      opts: { accessories: 'accessories', title: 'title', surface: 'surface', height: 'tile_height', color: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-grid-accessories-card', accessories: o.accessories || [], title: o.title || 'Accessories', surface: o.surface },
                           o.title ? { label: true } : {},
                           o.height ? { height: o.height } : {}, o.color ? { color: true } : {}); } },
    scene: { sizes: ['S', 'W'], sources: [], opts: { scene: 'scene', color: 'boolean' }, card: function (s, o) {
      return o.scene ? Object.assign({ type: 'custom:hk-grid-entity-card', entity: o.scene, kind: 'scene', size: s }, o.color ? { color: true } : {}) :
        stand('Scene', 'mdi:palette', 'Choose a scene in the editor.'); } },
    scenes: { sizes: ['W', 'T', 'L', 'XL', 'XXL'], sources: ['scenes'], opts: { scenes: 'scenes', surface: 'surface', height: 'tile_height', color: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-scenes-card', surface: o.surface }, o.scenes ? { scenes: o.scenes } : {},
                           o.height ? { height: o.height } : {}, o.color ? { color: true } : {}); } },
    now_playing: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: ['speakers'], opts: { speaker: 'speaker', background: 'np_background', tap: 'tap_target' }, card: function (s, o) {
      // T, L and XL: the progress above the transport (the Home app's and Apple
      // Music's order); L and XL the volume under it (Music's widgets,
      // 2026-10-31). Its speaker's own controls, or the screen's music.
      // (the speaker: the music in that room or group, every part of it -- hkGridCatalog.musicAt)
      var sp = own(o.speaker), ctl = function (parts) {
        return { type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: parts, entity_from: Object.assign({ music: true }, sp ? { music_at: sp } : {}) };
      };
      // (2026-11-08, the owner: what does not fit goes to the player's sheet) -- and back (2026-11-09, the owner: "Looks
      // like the tall and the wide cards lost their volume slider?" and "Volume is more important than the progress bar for
      // these cards"): W, T, L and XL carry the progress and the volume; where both do not fit as full targets the
      // progress is a thin read-only line (hk-media-now.js), the volume keeps its slider. S has play / pause alone.
      var extra = s === 'S' ? {} : { sub_card: ctl(['progress']), meta_card: ctl(['volume']) };
      // (background, 2026-11-05, the owner: the blurred album unless the block asks for the card every other block has)
      return Object.assign({ type: 'custom:hk-now-playing-card', music: true }, sp ? { music_at: sp } : {}, o.background === 'card' ? { background: 'card' } : {}, extra); } },
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
    security: { sizes: ['S', 'W', 'C', 'T', 'L', 'XL'], sources: [], opts: { entity: 'alarm', tap: 'tap_target', presentation: 'security_presentation', members: 'security_members',
      lit: 'security_lit', height: 'tile_height' }, card: function (s, o) {
      // (HomeView's Extra Large keeps the keypad -- 2026-11-08, the owner: "when you set it to HomeView mode, the Keypad goes away": the
      // keypad beside its entries as HomeView tiles or pills (Height), the entries its own when chosen)
      if (o.presentation === 'homeview' && s === 'XL') return Object.assign({ type: 'custom:hk-grid-keypad-card' }, o.entity ? { entity: o.entity } : {},
        o.height === 'half' || o.height === 'full' ? { height: o.height } : {}, o.members && o.members.length ? { members: o.members.slice() } : {},
        { hv: true }, o.lit === false ? { lit: false } : {});
      // (lit, 2026-11-09: Light Up When Armed, on unless false)
      if (o.presentation === 'homeview') return Object.assign({ type: s === 'S' ? 'custom:hk-grid-security-key-card' : 'custom:hk-grid-security-hv-card', size: s }, o.entity ? { entity: o.entity } :
        {},
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
    people: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target', map: 'boolean' },
      card: function (s, o) { return Object.assign({ type: 'custom:hk-people-card' }, o.map ? { map: true } : {}); } },
    // Large and Extra Large: its controls with Clean Areas (2026-10-24)
    vacuum: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { entity: 'vacuum', tap: 'tap_target' }, card: function (s, o, ctx) {
      var id = o.entity || ctx.vacuum;
      if (!id) return stand('Vacuum', 'hk:robot-vacuum', 'No vacuum yet.');
      return { type: s === 'L' || s === 'XL' ? 'custom:hk-grid-vacuum-card' : 'custom:hk-vacuum-card', entity: id }; } },
    // LAUNDRY (phase 22, docs/phase22/LAUNDRY.md): the house's washers and dryers (Accessories -> Laundry, else found by
    // themselves) -- one drawn large, two side by side; what it shows is the house's, so it has no options but When Tapped
    // TV (phase 23, docs/phase23/TV.md; hk-tv-card.js): a room's TV and its player -- Automatic is the tablet's room (else the first TV)
    tv: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tv: 'tv_target', show: 'tv_show', tap: 'tap_target' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-grid-tv-card', size: s, tv: o.tv || TABLET_ROOM }, o.show ? { show: o.show } : {}); } },
    // SWIPE (2026-11-11, the owner): pages to swipe between, each another card with its own options (opts.pages [{card, opts}]);
    // drawn by the pager every paged block uses (hk-layout.js hk-pager-card), pages() makes its pages. Never a Swipe inside a Swipe.
    swipe: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { pages: 'swipe_pages' }, card: function () {
      return stand('Swipe', 'mdi:gesture-swipe-horizontal', 'Add the cards to swipe between in the editor.'); } },
    laundry: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { tap: 'tap_target' }, card: function (s) {
      return { type: 'custom:hk-grid-laundry-card', size: s }; } },
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
      return { type: 'custom:hk-grid-room-card', area: o.area || TABLET_ROOM, fallback: (ctx.rooms || [])[0] || null, size: s, surface: o.surface, accessory_display: o.accessory_display ||
        'summary' }; } },
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
      return { type: 'custom:hk-house-status-card', size: s }; } },
    // ALERT (2026-11-10, docs/phase11/ALERT.md, hk-alert.js): one thing that needs a look -- a headline, a line of its own and how
    // long (`since`: the accessory whose state it counts from), a camera's still, and one action (`control`: that accessory's
    // own tile tap, so a door or a lock opens its controls and asks first). Made to be a Show When rule's card; no When Tapped
    alert: { sizes: ['S', 'W', 'T', 'L', 'XL'], sources: [], opts: { title: 'title', text: 'alert_text', since: 'entity', camera: 'camera', control: 'entity', icon: 'alert_icon',
      color: 'alert_color' }, card: function (s, o) {
      var out = { type: 'custom:hk-grid-alert-card', size: s };
      ALERT_KEYS.forEach(function (k) { if (o[k] != null && o[k] !== '') out[k] = o[k]; });
      return out; } }
  };
  var ALERT_KEYS = ['title', 'text', 'since', 'camera', 'control', 'icon', 'color'];
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
    if (it.card === 'swipe') return swipeList(it).length > 0;
    var p = it.pages, c = CARDS[it.card];
    return !!(c && p && (p.source === 'list' ? Array.isArray(p.list) && p.list.length
                                             : c.sources.indexOf(p.source) >= 0));
  }

  // a Swipe block's pages that can be drawn: a card this host has, in the block's size, never a Swipe
  function swipeList(it) {
    var list = (it.opts && it.opts.pages) || [];
    return Array.isArray(list) ? list.filter(function (pg) { return pg && pg.card !== 'swipe' && CARDS[pg.card] && CARDS[pg.card].sizes.indexOf(it.size) >= 0; }) : [];
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
    if (it.card === 'swipe') {
      // (each page its own card in the block's size, its options its own; one this host lacks or not in this size is left out)
      out = swipeList(it).map(function (pg) { var o = pg.opts || {}; return { card: tapped(CARDS[pg.card].card(it.size, o, x), o) }; });
    } else if (!paged(it)) { /* no pages: the block's card, below */ }
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

  // SHOW WHEN's numbers (hk_core home_grid.py RULES_MAX / ALL_MAX; a test holds them equal): a block's rules (ten since
  // 2026-11-10, four before), the first that holds winning, and each rule's conditions, all of which must hold
  var RULES_MAX = 10, CONDITIONS_MAX = 3;
  // a block's rules as hk_core rules() takes them (the editor's valid()): none (no key), or 1 to RULES_MAX, each of 1 to
  // CONDITIONS_MAX conditions and a card that comes in the block's size
  function rulesFit(it) {
    var rules = it && it.rules;
    if (rules == null) return true;
    return Array.isArray(rules) && rules.length > 0 && rules.length <= RULES_MAX && rules.every(function (r) {
      var all = r && r.when && (Array.isArray(r.when.all) ? r.when.all : [r.when]), cat = r && CARDS[r.card];
      return !!all && all.length > 0 && all.length <= CONDITIONS_MAX && !!cat && cat.sizes.indexOf(it.size) >= 0;
    });
  }
  var CONDITIONS = ['music_playing', 'timer_running', 'alarm_armed', 'alarm_disarmed', 'doorbell', 'after_sunset', 'entity_state', 'time', 'solar_window', 'tv_on'];
  function hhmm(t) { var m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function houseZone() {
    try { var L = window.hkLocale; return (L && L.zone ? L.zone() : undefined) || undefined; } catch (e) { return undefined; }
  }
  // the time of day in the house's zone, in minutes
  function houseNow(date) {
    var d = date || new Date();
    try {
      var z = houseZone();
      var s = d.toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, z ? { timeZone: z } : {}));
      var m = hhmm(s.slice(0, 5));
      if (m !== null) return m;
    } catch (e) { /* no Intl */ }
    return d.getHours() * 60 + d.getMinutes();
  }

  // ------------------------------------------------------------ SOLAR WINDOW
  // SOLAR WINDOW (2026-11-10, the owner: the outdoor lights' controls "from 15 minutes before sunset until 10 PM", and
  // "from 60 minutes before sunrise until 30 minutes after sunrise"): from one endpoint until the next time the other
  // comes round. An endpoint is a clock time in the house's zone ({at: 'HH:MM'}) or sunrise / sunset with a signed
  // offset in minutes ({sun: 'sunset', offset: -15}); home_grid.py solar_endpoint() is the saved shape. Worked in
  // instants, not minutes of the day, so a day of 23 or 25 hours and a window past midnight come out right.
  //   The sun: Home Assistant's own sun.sun -- next_rising and next_setting -- and nothing else. Each is the NEXT one,
  // so once today's sunset has passed, next_setting is tomorrow's. A day's event is the one the page saw for that day
  // (each value it has read is kept, SUN_SEEN), else the nearest it has read moved by whole days (a minute or two
  // off, as hk-saverpieces-weather.js sunDay reads today's sunrise). No sun.sun, an unreadable time, or one more than
  // two days away (a polar summer): the window cannot be judged and the condition does not hold, so the block falls
  // through to its next rule or its default.
  var DAY_MS = 86400000, SUN_ATTR = { sunrise: 'next_rising', sunset: 'next_setting' }, SUN_OFFSET_MAX = 360;
  var SUN_SEEN = { sunrise: [], sunset: [] };
  var zoneFmt = {}, wallMemo = new Map();
  // the wall clock in `zone` at instant `ms`: [year, month (1-12), day, hour, minute]. Kept by the minute: a block's
  // rules are judged on every push of the house, and the same few dozen minutes come up each time
  function wall(ms, zone) {
    var memo = (zone || '') + '|' + Math.floor(ms / 60000), got = wallMemo.get(memo);
    if (got) return got;
    if (wallMemo.size > 2000) wallMemo.clear();
    got = wallNow(ms, zone);
    wallMemo.set(memo, got);
    return got;
  }
  function wallNow(ms, zone) {
    var key = zone || '';
    try {
      /** @type {Intl.DateTimeFormatOptions} */
      var o = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: zone || undefined };
      var f = zoneFmt[key] || (zoneFmt[key] = new Intl.DateTimeFormat('en-US', o));
      var p = {};
      f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = +x.value; });
      if (isFinite(p.year) && isFinite(p.day)) return [p.year, p.month, p.day, p.hour % 24, p.minute];
    } catch (e) { /* no Intl: the browser's own zone */ }
    var d = new Date(ms);
    return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
  }
  // the zone's offset from UTC at `ms`, in ms (whole minutes)
  function zoneOffset(ms, zone) {
    var w = wall(ms, zone);
    return Date.UTC(w[0], w[1] - 1, w[2], w[3], w[4]) - Math.floor(ms / 60000) * 60000;
  }
  // a day number (days since 1970-01-01) for a calendar date, and back
  function dayNo(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); }
  function dayOf(ms, zone) { var w = wall(ms, zone); return dayNo(w[0], w[1], w[2]); }
  // THE INSTANT a wall-clock minute `min` of day `day` happens in `zone`. In a spring-forward gap (02:30 that never
  // comes) the minute as many minutes after the change; in a fall-back hour (01:30 twice) the first of the two.
  function atWall(day, min, zone) {
    var g = day * DAY_MS + min * 60000, before = zoneOffset(g - DAY_MS, zone), after = zoneOffset(g + DAY_MS, zone);
    var a = g - before, b = g - after;
    var aOk = zoneOffset(a, zone) === before, bOk = zoneOffset(b, zone) === after;
    if (aOk && bOk) return Math.min(a, b);
    if (aOk) return a;
    if (bOk) return b;
    return g - before;                                               // (in the gap)
  }
  // the sun entity: sun.sun, else any sun.*
  function sunState(states) {
    var st = states || {};
    if (st['sun.sun']) return st['sun.sun'];
    var k = Object.keys(st).filter(function (id) { return id.indexOf('sun.') === 0; })[0];
    return k ? st[k] : null;
  }
  // Home Assistant's next sunrise or sunset as an instant, kept in SUN_SEEN; null without one
  function sunNext(states, ev, now) {
    var s = sunState(states), a = s && s.attributes, t = a ? Date.parse(a[SUN_ATTR[ev]]) : NaN;
    if (!s || s.state === 'unavailable' || s.state === 'unknown' || !isFinite(t) || Math.abs(t - now) > 2 * DAY_MS) return null;
    var seen = SUN_SEEN[ev];
    if (seen.indexOf(t) < 0) {
      seen.push(t);
      // (only the last few days': a day's event is the latest value read for it)
      SUN_SEEN[ev] = seen.filter(function (x) { return Math.abs(x - now) <= 4 * DAY_MS; }).slice(-8);
    }
    return t;
  }
  // the sunrise or sunset of day `day`: the one read for that day, else the nearest read moved by whole days
  function sunOn(ev, day, next, zone) {
    var all = SUN_SEEN[ev].concat([next]), best = next, bestGap = Infinity;
    for (var i = 0; i < all.length; i++) {
      var gap = Math.abs(dayOf(all[i], zone) - day);
      if (gap <= bestGap) { best = all[i]; bestGap = gap; }          // (the later read, of two for one day)
    }
    return best + (day - dayOf(best, zone)) * DAY_MS;
  }
  // one endpoint on day `day`, as an instant; null when it needs the sun and there is none
  function endpointOn(p, day, sun, zone) {
    if (p && typeof p.at === 'string') { var m = hhmm(p.at); return m === null ? null : atWall(day, m, zone); }
    if (!p || !SUN_ATTR[p.sun] || sun[p.sun] == null) return null;
    var off = Number(p.offset || 0), base = sunOn(p.sun, day, sun[p.sun], zone);
    if (!isFinite(off) || Math.abs(off) > SUN_OFFSET_MAX || base === null) return null;
    return base + Math.round(off) * 60000;
  }
  function sameEnd(a, b) { return !!a && !!b && a.at === b.at && a.sun === b.sun && (a.offset || 0) === (b.offset || 0); }
  // THE WINDOWS around `now`: each opens at `from` on a day and closes at the first `to` after it. Answers { on, next,
  // spans } -- on: true / false, or null when it can't be judged; next: the soonest instant after now it opens or
  // closes (for the conditional block's timer); spans: [[open, close], ...] (the editor's "Today" line)
  function solarSpans(c, states, now) {
    var t = now == null ? Date.now() : +now, zone = houseZone(), sun = {};
    if (!c || !c.from || !c.to || sameEnd(c.from, c.to)) return { on: null, next: null, spans: [] };
    var needs = [c.from.sun, c.to.sun].filter(Boolean);
    for (var i = 0; i < needs.length; i++) {
      if (!SUN_ATTR[needs[i]]) return { on: null, next: null, spans: [] };
      sun[needs[i]] = sunNext(states, needs[i], t);
      if (sun[needs[i]] == null) return { on: null, next: null, spans: [] };
    }
    var today = dayOf(t, zone), spans = [], on = false, next = null;
    for (var d = today - 2; d <= today + 2; d++) {
      var open = endpointOn(c.from, d, sun, zone), close = null;
      if (open === null) return { on: null, next: null, spans: [] };
      for (var e = d - 1; e <= d + 2; e++) {
        var x = endpointOn(c.to, e, sun, zone);
        if (x !== null && x > open && (close === null || x < close)) close = x;
      }
      if (close === null) return { on: null, next: null, spans: [] };
      spans.push([open, close]);
      if (open <= t && t < close) on = true;
      [open, close].forEach(function (b) { if (b > t && (next === null || b < next)) next = b; });
    }
    return { on: on, next: next, spans: spans };
  }
  // A TIME OF DAY's next turn (the conditional block's timer): the next `from` or `to` after now
  function timeNext(c, now) {
    var a = hhmm(c.from), b = hhmm(c.to), zone = houseZone(), today = dayOf(now, zone), next = null;
    if (a === null || b === null) return null;
    for (var d = today; d <= today + 1; d++) [a, b].forEach(function (m) { var x = atWall(d, m, zone); if (x > now && (next === null || x < next)) next = x; });
    return next;
  }
  // WHEN A BLOCK'S RULES MAY NEXT CHANGE BY THE CLOCK ALONE: the soonest edge of any Time of Day or Solar Window in
  // them, after `now` (ms); null when none has one. (A push of the house redraws by itself: the sun, the alarm...)
  function nextChange(item, states, now) {
    var t = now == null ? Date.now() : +now, next = null;
    rulesOf(item).rules.forEach(function (r) {
      var w = r && r.when || {};
      (Array.isArray(w.all) ? w.all : [w]).forEach(function (c) {
        var x = c && c.kind === 'time' ? timeNext(c, t) : c && c.kind === 'solar_window' ? solarSpans(c, states, t).next : null;
        if (x !== null && x > t && (next === null || x < next)) next = x;
      });
    });
    return next;
  }

  // A NEW SOLAR WINDOW (the editor's): the evening's outdoor lights, from 15 minutes before sunset until 10 PM
  function solarFresh() { return { from: { sun: 'sunset', offset: -15 }, to: { at: '22:00' } }; }
  // A SOLAR WINDOW'S ROWS in Show When (hk-grid-editor.js conditionRows; here, beside what judges it): From and Until,
  // each A Time or Sunrise / Sunset and its Offset in minutes (minus is before), then when the screen would have it open
  // now or next -- or that it can't tell without sun.sun. `K` the settings kit; `put(condition)`; `refuse()` puts back a
  // field whose entry isn't taken.
  function solarRows(K, c, rows, put, states, refuse) {
    var setEnd = function (key, end) { var out = JSON.parse(JSON.stringify(c)); out[key] = end; put(out); };
    [['from', 'From', '18:00'], ['to', 'Until', '22:00']].forEach(function (e) {
      var key = e[0], p = c[key] || { at: e[2] }, kind = p.sun || 'at';
      rows.push(K.select({ label: e[1], value: kind, options: [['at', 'A Time'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset']],
        onChange: function (v) { setEnd(key, v === 'at' ? { at: p.at || e[2] } : { sun: v, offset: p.sun ? p.offset || 0 : 0 }); } }));
      if (kind === 'at') rows.push(K.text({ label: 'Time', type: 'time', value: p.at, onCommit: function (v) { if (hhmm(v) !== null) setEnd(key, { at: v }); else refuse(); } }));
      else rows.push(K.text({ label: 'Offset', type: 'number', inputmode: 'numeric', unit: 'min', value: p.offset || 0,
        sub: 'Minutes before (\u2212) or after ' + kind + ', up to ' + SUN_OFFSET_MAX / 60 + ' hours',
        onCommit: function (v) {
          var m = /^\s*([-+\u2212]?)\s*(\d{1,3})\s*$/.exec(String(v)), n = m ? (m[1] && m[1] !== '+' ? -1 : 1) * Number(m[2]) : NaN;
          if (isFinite(n) && Math.abs(n) <= SUN_OFFSET_MAX) setEnd(key, { sun: kind, offset: n }); else refuse();
        } }));
    });
    var now = Date.now(), got = solarSpans(c, states, now), zone = houseZone(), L = window.hkLocale;
    var hm = function (t) { try { return L.time(t, { hour: 'numeric', minute: '2-digit' }); } catch (e) { return new Date(t).toLocaleTimeString(); } };
    var tomorrow = function (t) { return dayOf(t, zone) > dayOf(now, zone) ? 'Tomorrow ' : ''; };
    var span = got.spans.filter(function (x) { return x[1] > now; }).sort(function (a, b) { return a[0] - b[0]; })[0];
    if (got.on === null || !span) rows.push(K.info({ label: 'Can\u2019t Tell Now', sub: 'Needs Home Assistant\u2019s sun (sun.sun). Until it reads, this rule doesn\u2019t hold.' }));
    else rows.push(got.on ? K.info({ label: 'Open Now', value: 'Until ' + tomorrow(span[1]) + hm(span[1]) })
      : K.info({ label: 'Opens Next', value: tomorrow(span[0]) + hm(span[0]) + ' \u2013 ' + hm(span[1]) }));
  }

  // THE CLOCK MOVES ON (2026-11-10; hk-layout.js hk-grid-conditional-card): a block with a Time of Day or a Solar
  // Window looks again at its next edge -- the moment one opens or closes (nextChange) -- not on a poll, and at least
  // every five minutes, so a tablet that slept, a clock set right or a sun.sun that moved catches up; it redraws only
  // when the rule shown changes. (A push of the house redraws by itself.) The card keeps its timer in `_tick`.
  var CLOCK_KINDS = { time: 1, solar_window: 1 }, CLOCK_MAX = 300000;
  function armClock(card) {
    clearTimeout(card._tick); card._tick = null;
    var cfg = card._config, item = cfg && cfg.item, timed = false;
    rulesOf(item).rules.forEach(function (r) { var w = r && r.when || {}; (Array.isArray(w.all) ? w.all : [w]).forEach(function (c) { if (c && CLOCK_KINDS[c.kind]) timed = true; }); });
    if (!card.isConnected || !timed) return;
    var now = Date.now(), next = null;
    try { next = nextChange(item, card.client && card.client.states, now); } catch (e) { next = null; }
    card._tick = setTimeout(function () {
      card._tick = null;
      var shown = card._shown();
      if (shown !== card._lastShown) { card._lastShown = shown; card.redraw(); }
      armClock(card);
    }, Math.max(1000, Math.min(next === null ? CLOCK_MAX : next - now + 250, CLOCK_MAX)));
  }

  // ONE CONDITION, or a rule's {all: [...]} (each must hold). `now`: minutes
  // into the house's day (a test's; a Time of Day's alone), a Date (every
  // condition's), else the clock's. `speakers`: the house's
  // music speakers (ctx.speakers' entities): Music Is Playing with no speaker
  // chosen is any of THEM playing (2026-11-01, the owner: "whenever any music is
  // playing from any HomePod") -- not a TV or a receiver, which play for hours
  function matches(when, states, ringing, alarm, now, speakers) {
    if (when && Array.isArray(when.all)) return when.all.length > 0 && when.all.every(function (c) { return matches(c, states, ringing, alarm, now, speakers); });
    var c = when || {}, st = states || {}, ids = c.entity ? [c.entity] : Object.keys(st);
    if (c.kind === 'time') {
      var a = hhmm(c.from), b = hhmm(c.to), t = now == null ? houseNow() : now instanceof Date ? houseNow(now) : now;
      if (a === null || b === null || a === b) return false;
      return a < b ? t >= a && t < b : t >= a || t < b;
    }
    // (can't be judged -- no sun -- is false: the next rule, or the default)
    if (c.kind === 'solar_window') return solarSpans(c, st, now instanceof Date ? now.getTime() : null).on === true;
    if (c.kind === 'alarm_disarmed') return (c.entity ? ids : alarm ? [alarm] : ids).some(
      function (id) { return id.split('.')[0] === 'alarm_control_panel' && st[id] && st[id].state === 'disarmed'; });
    var any = function (domain, test) { return ids.some(function (id) { return id.split('.')[0] === domain && st[id] && test(st[id].state); }); };
    if (c.kind === 'entity_state') return !!st[c.entity] && st[c.entity].state === c.state;
    if (c.kind === 'music_playing') {
      if (!c.entity && speakers && speakers.length) ids = speakers;
      else if (c.entity) ids = musicPlayers(c.entity) || ids;           // (a room's players, a group's, Tablet's Room's)
      return any('media_player', function (s) { return s === 'playing'; });
    }
    // A TV IS ON (phase 23): a set's TV or its player (hk-tv.js), by a TV, Tablet's Room or any; never on a page with no host client
    if (c.kind === 'tv_on') {
      var TV = window.hkTv, cl = window.hkHostClient && window.hkHostClient.current ? window.hkHostClient.current() : null;
      if (!TV || !cl) return false;
      return c.entity ? TV.isOn(cl, c.entity) : TV.sets(cl).some(function (x) { return TV.isOn(cl, x.id); });
    }
    if (c.kind === 'timer_running') return any('timer', function (s) { return s === 'active' || s === 'paused'; }) ||
      !c.entity && !!st['sensor.running_quick_timers'] && Number(st['sensor.running_quick_timers'].state) > 0;
    if (c.kind === 'alarm_armed') return (c.entity ? ids : alarm ? [alarm] : ids).some(
      function (id) { return id.split('.')[0] === 'alarm_control_panel' && st[id] && /^(armed_|arming|pending|triggered)/.test(st[id].state); });
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
    calendar: 'Calendar', battery: 'House Battery', people: 'People', vacuum: 'Vacuum', laundry: 'Laundry', tv: 'TV', swipe: 'Swipe', clock: 'Clock',
    room: 'Room', scene_suggested: 'Suggested Scene', action: 'Action', everything: 'Everything', cameras: 'Cameras',
    power: 'Power', music: 'Music', doors: 'Doors & Locks', live_tv: 'Live TV', water: 'Water',
    on_now: 'On Now', todo: 'To-do', energy_rings: 'Energy Rings', timeline: 'Recent', intercom: 'Intercom', house_status: 'House Status', alert: 'Alert' };

  // ------------------------------------------------------------ an Alert's settings
  // AN ALERT'S ROWS (hk-grid-editor.js fields, for card `alert`): the headline, its own line, the accessory it counts the time
  // from, the camera's still, the one action, and its glyph and color. `K` the settings kit; `set(key, value)` (null or '' takes
  // the option away); `choices(kind)` the editor's [[id, name]] (entity, camera).
  var ALERT = { titleMax: 60, textMax: 80, colors: ['orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'red', 'gray'] };
  function alertRows(K, o, set, choices) {
    var rows = [], none = [['', 'None']];
    var pick = function (key, label, list, sub) {
      var all = none.concat(list);
      if (o[key] && !all.some(function (op) { return op[0] === o[key]; })) all.push([o[key], o[key] + ' (Unavailable)']);
      rows.push(K.select({ label: label, sub: sub, value: o[key] || '', options: all, onChange: function (v) { set(key, v || null); } }));
    };
    rows.push(K.text({ label: 'Headline', value: o.title || '', maxlength: ALERT.titleMax, placeholder: 'Garage Still Open', onCommit: function (v) { set('title', v.trim() || null); } }));
    rows.push(K.text({ label: 'Supporting Text', value: o.text || '', maxlength: ALERT.textMax, placeholder: 'Optional', onCommit: function (v) { set('text', v.trim() || null); } }));
    pick('since', 'Time Since', choices('entity'), 'How long this accessory has been as it is: “Open for 23 min”');
    pick('camera', 'Camera Snapshot', choices('camera'), 'Tapping the picture opens the camera');
    pick('control', 'Action', choices('entity'), 'Does what the accessory’s tile does. A door or lock opens its controls, which ask first');
    rows.push(K.select({ label: 'Color', value: o.color || 'orange', options: ALERT.colors.map(function (c) { return [c, c.charAt(0).toUpperCase() + c.slice(1)]; }),
      onChange: function (v) { set('color', v === 'orange' ? null : v); } }));
    rows.push(K.text({ label: 'Glyph', value: o.icon || '', maxlength: 77, placeholder: 'The accessory’s own', onCommit: function (v) {
      var x = String(v || '').trim(); set('icon', SHEET.icon.test(x) ? x : null); } }));
    rows.push(K.info({ label: 'Made for Show When', sub: 'Add a rule to a block and choose Alert as its card: it shows in the block’s place while the rule holds.' }));
    return rows;
  }
  // AN ALERT IN THE CARD LIST'S PREVIEW: the house's first garage door (else any door or cover) open for a while, its camera
  function alertSample(choices, states) {
    var st = states || {}, covers = choices('entity').filter(function (op) { return op[0].indexOf('cover.') === 0; });
    var door = covers.filter(function (op) { var a = (st[op[0]] || {}).attributes || {}; return a.device_class === 'garage'; })[0] || covers[0];
    var cams = choices('camera'), cam = cams.filter(function (op) { return /garage/i.test(op[0] + op[1]); })[0] || cams[0];
    return Object.assign({ title: 'Garage Still Open' }, door ? { since: door[0], control: door[0] } : {}, cam ? { camera: cam[0] } : {});
  }

  // the catalog as data, for the parity test and the editor (G5)
  function table() {
    var out = {};
    Object.keys(CARDS).forEach(function (k) {
      out[k] = { sizes: CARDS[k].sizes.slice(), sources: CARDS[k].sources.slice() };
      if (CARDS[k].opts) out[k].opts = Object.assign({}, CARDS[k].opts);
    });
    return out;
  }

  // A TV BLOCK'S ROWS (the editor's fields() hands over): which TV and what it shows
  var tvBlock = {
    choices: function (client) {
      var T = window.hkTv, sets = T && client ? T.sets(client) : [];
      return [[TABLET_ROOM, 'Tablet’s Room']].concat(sets.map(function (x) { return [x.tv || x.player, x.name]; }));
    },
    rows: function (K, o, set, choices, client) {
      var T = window.hkTv, tv = o.tv || '', list = tvBlock.choices(client).filter(function (op) { return op[0] !== TABLET_ROOM; });
      var setNow = T && client ? (T.setFor(client, tv || TABLET_ROOM) || T.setFor(client, null)) : null;
      var apps = T && client && setNow ? T.allApps(client, setNow).map(function (a) { return [a.name, a.name]; }) : [];
      if (o.show && o.show !== 'recent' && o.show !== 'favorites' && !apps.some(function (a) { return a[0] === o.show; })) apps.push([o.show, o.show + ' (Unavailable)']);
      if (tv && tv !== TABLET_ROOM && !list.some(function (op) { return op[0] === tv; })) list.push([tv, tv + ' (Unavailable)']);
      return [
        K.select({ label: 'TV', value: tv && tv !== TABLET_ROOM ? tv : '', options: [['', 'Automatic (Tablet’s Room)']].concat(list), onChange: function (v) { set('tv', v || null); } }),
        K.select({ label: 'Shows', value: o.show || 'recent', options: [['recent', 'Recent Apps'], ['favorites', 'Favorite Apps']].concat(apps.length ? [['', '──────']] : [], apps),
          onChange: function (v) { if (v) set('show', v === 'recent' ? null : v); } }),
        K.info({ label: 'Favorite Apps are chosen in Accessories → TVs.', sub: 'Automatic is the TV in the wall tablet’s room; on a phone or a computer, the first TV.' })
      ];
    }
  };

  // A SWIPE BLOCK'S ROWS (the editor's fields() hands over its own fields() for a page's options): each page -- its card, that card's
  // own settings, Move Up, Remove -- then Add Page with the cards that come in this size
  var swipeBlock = {
    MAX: 6,
    cards: function (size) {
      return Object.keys(CARDS).filter(function (k) { return k !== 'swipe' && CARDS[k].sizes.indexOf(size) >= 0; })
        .sort(function (a, b) { return String(NAMES[a] || a).localeCompare(String(NAMES[b] || b)); }).map(function (k) { return [k, NAMES[k] || k]; });
    },
    sample: function () { return { pages: [{ card: 'clock' }, { card: 'weather' }] }; },
    rows: function (K, o, set, choices, client, ed) {
      var pages = (o.pages || []).slice(), n = pages.length, size = (ed && ed.size) || 'L', cards = swipeBlock.cards(size), rows = [];
      var put = function (next) { set('pages', next.length ? next : null); };
      if (!n) rows.push(K.info({ label: 'Add the cards to swipe between.', sub: 'Each page is a card with its own settings. Made for Show When too: the TV with Now Playing a swipe away.' }));
      pages.forEach(function (pg, i) {
        rows.push(K.select({ label: 'Page ' + (i + 1) + ' of ' + n, value: pg.card, options: cards.some(function (c) { return c[0] === pg.card; }) ? cards :
          cards.concat([[pg.card, (NAMES[pg.card] || pg.card) + ' (Not in This Size)']]),
          onChange: function (v) { var next = pages.slice(); next[i] = { card: v }; put(next); } }));
        if (ed && ed.fields && CARDS[pg.card]) rows = rows.concat(ed.fields(pg.card, pg.opts || {}, function (opts) {
          var next = pages.slice(); next[i] = Object.keys(opts).length ? { card: pg.card, opts: opts } : { card: pg.card }; put(next); }));
        rows.push(K.button({ label: 'Move Page ' + (i + 1) + ' Up', disabled: i === 0, onClick: function () { var next = pages.slice(); next.splice(i - 1, 0, next.splice(i, 1)[0]); put(next); } }));
        rows.push(K.button({ label: 'Remove Page ' + (i + 1), destructive: true, onClick: function () { put(pages.filter(function (x, j) { return j !== i; })); } }));
      });
      if (n < swipeBlock.MAX) rows.push(K.select({ label: 'Add Page', value: '', options: [['', 'Choose a Card…']].concat(cards),
        onChange: function (v) { if (v) put(pages.concat([{ card: v }])); } }));
      return rows;
    }
  };

  window.hkGridCatalog = { version: '1.0.0', SIZES: SIZES, span: span, CELLS: CELLS, SOURCES: SOURCES, TABLET_ROOM: TABLET_ROOM,
                           PAGES_MAX: PAGES_MAX, PER_PAGE: PER_PAGE, perPage: perPage, CLOCK_FACES: CLOCK_FACES, THERMOSTAT_STYLES: THERMOSTAT_STYLES, TAP_TARGETS: TAP_TARGETS, MUSIC_TAPS: MUSIC_TAPS,
                           SHEET: SHEET, sheetOf: sheetOf, entryId: entryId, copySheet: copySheet, sheetRoute: sheetRoute, NAMES: NAMES,
                           sheetSlot: sheetSlot, sheetCss: sheetCss, placed: placed,
                           CONDITIONS: CONDITIONS, RULES_MAX: RULES_MAX, CONDITIONS_MAX: CONDITIONS_MAX, rulesFit: rulesFit, hostHas: hostHas, matches: matches, musicAt: musicAt,
                             musicPlayers: musicPlayers, speakerChoices: speakerChoices, tv: tvBlock, swipe: swipeBlock, rulesOf: rulesOf, choose: choose, houseNow: houseNow,
                           nextChange: nextChange, armClock: armClock, alert: { rows: alertRows, sample: alertSample, KEYS: ALERT_KEYS, LIMITS: ALERT },
                             solar: { spans: solarSpans, rows: solarRows, fresh: solarFresh, atWall: atWall, dayOf: dayOf, OFFSET_MAX: SUN_OFFSET_MAX,
                             forget: function () { SUN_SEEN.sunrise = []; SUN_SEEN.sunset = []; } }, config: config, pages: pages, tabletRoom: tabletRoom, table: table };
  try { window.dispatchEvent(new CustomEvent('hk-grid-catalog-ready')); } catch (e) { /* a test page without events */ }
})();
