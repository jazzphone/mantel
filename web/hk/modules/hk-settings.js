// hk-settings.js -- THE DASHBOARD SETTINGS, on every screen, before any card.
//
// Which entities the pages read -- the header's locks and contacts, the weather
// entity and its sensors, the sky's moon and holiday sources, the idle-return
// dashboards, the car browsers -- is chosen in HK Settings (the sidebar panel)
// and stored in the integration (settings.py). This module holds it for the
// page: window.hkSettings.
//
//   hkSettings.get('weather.entity')          one value (or a fallback)
//   hkSettings.weatherId(states)              the weather entity to read
//   hkSettings.clock(states)                  { time: 'HH:MM', date: 'YYYY-MM-DD' }
//   hkSettings.moon(states)                   0..1 phase fraction
//   hkSettings.seasonName(states)             'Halloween' | 'Thanksgiving' | 'Christmas' | ''
//   hkSettings.seasonalOn(states)             false only when the gate is explicitly off
//   hkSettings.themeOn('thanksgiving')        may this sky theme run at all
//   hkSettings.skyLook()                      this screen's Sky / Background: animations,
//                                             weather, precipitation, focusPause,
//                                             decorations, decorationStyle, backdrop
//   hkSettings.skyPalettes()                  the fixed backdrops, by id
//   hkSettings.onChange(fn)                   called after a change; returns unsubscribe
//
// WHERE THE VALUES COME FROM, in order:
//   1. `hk_frontend/settings/subscribe` over the page's own websocket -- now,
//      and again whenever anything is edited. A change also fires
//      `hk-module-ready`, which redraws every hk card (hk-base.js MODULE WAKE),
//      so an edit reaches an open screen with no reload.
//   2. Until the server answers: the copy the last answer left in
//      localStorage, so a reload paints with the real settings, not defaults.
//   3. With neither: DEFAULTS, which assume no particular house.
//
// A BOOTSTRAP MODULE (registered in __init__.py, first in the list), because
// the header builders and the sky are bootstrap modules too and read it at
// their first paint.
(function () {
  'use strict';
  if (window.hkSettings) return;

  // THE BLACK SCREEN THROUGH A RELOAD (Black Screen: HK Frontend, 2026-10-09).
  // A tablet whose page reloads while it is black (its nightly restart, a
  // cache clear) would light Home Assistant's own loading screen and the
  // dashboard until hk-saver.js loaded. This is the first of HK's modules to
  // run: a page that was black (hk-saver.js keeps 'hk-black') is covered at
  // once, and hk-saver.js takes the cover over -- or fades it, if the black
  // is no longer wanted. Never kept past BOOT_COVER_MAX on its own.
  try {
    var seg0 = String(location.pathname).split('/')[1] || '';
    if (seg0 && window.localStorage && localStorage.getItem('hk-black') === seg0 &&
        !document.getElementById('hk-black-boot')) {
      var cover = document.createElement('div');
      cover.id = 'hk-black-boot';
      cover.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;background:#000';
      (document.body || document.documentElement).appendChild(cover);
      setTimeout(function () { if (cover.parentNode) cover.remove(); }, 30000);   // BOOT_COVER_MAX
    }
  } catch (e) { /* no storage, no document (a test harness) */ }

  // Mirror of settings.py DEFAULTS. The server's answer always carries every
  // key, so this only matters before the first answer on a fresh browser.
  var DEFAULTS = {
    // the pages' status rows (settings.STATUS_ROWS): what each shows, in order
    status_rows: {
      climate: { status: ['temperature', 'humidity', 'blinds', 'fans'], exclude_areas: [] },
      lights: { status: ['lights', 'outlets'], exclude_areas: [] },
      doors_windows: { status: ['doors', 'windows', 'motion', 'occupancy'], exclude_areas: [] },
      water: { status: ['leaks', 'valves'], exclude_areas: [] },
      security: { status: ['security', 'locks', 'garage', 'doors', 'windows', 'leaks'], exclude_areas: [] },
      vacuums: { status: ['vacuums', 'vacuum_battery'], exclude_areas: [] },
      timers: { status: ['timers'], exclude_areas: [] }
    },
    // the page headers (settings.HEADERS; hk-headers.js): null is Automatic
    headers: {
      climate: { show: true, thermostats: null },
      lights: { show: true, rooms: 3, left_on: true, tonight: true, exclude_areas: null, after_min: 10, automations: null, sky_follow: true, sky_source: null },
      security: { show: true, callouts: true, front_door: null, back_door: null, garage: null, low_battery: 20 },
      water: { show: true, meter: null, supply: null },
      timers: { show: true, presets: [5, 10, 15, 20, 30, 60], names: ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break'] },
      vacuums: { show: true, counters: null }
    },
    security: { alarm: null, garage: [], locks: [], doors: [], windows: [] },
    clock: { time: 'sensor.time', date: 'sensor.date' },
    weather: { entity: null, feels_like: null, humidity: null, wind: null, gust: null, uv: null,
               forecast_daily: null, forecast_hourly: null, alerts: null, place: null, outside: null,
               // the Weather Radar Card's own options (YAML), kept as they
               // were; the Weather page draws HK's own radar (radar_native)
               radar: {},
               // the Weather page's composition and its radar (settings.py
               // WEATHER_PAGE_DEFAULTS / RADAR_DEFAULTS; weatherPage(), radarPlan())
               page: { show_current: true, show_hourly: true, show_daily: true, show_alerts: true,
                       hours: 12, days: 8, hourly_metric: 'temperature',
                       details: ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'], load_animation: true },
               radar_native: { version: 1, enabled: false, provider: 'auto', basemap: 'osm', center: 'home', zone: null,
                               zoom: 5, marker: true, history_minutes: 60, playback_speed: 'normal', autoplay: true,
                               interactive: true, playback_controls: true, opacity: 75 } },
    sky: { moon: null, holidays: null, seasonal: null, birthdays: [], decorations: true, decoration_style: 'old', moving: 'behind', cloud_style: 'classic',
           daytime: 'natural',
           woodland: ['spring', 'summer', 'fall', 'winter'],
           // The sky's own look (Sky / Background): the moving parts, the
           // weather (clouds, rain, snow, fog -- the sun, moon and stars
           // stay), and the backdrop ("live" or a SKY_BACKDROPS id below,
           // whose stops for "custom" are gradient_custom). Each screen may
           // set its own (the board's sky_* keys, null = follow these).
           // precipitation: the falling rain and snow alone; focus_pause:
           // Pause When Not in Focus (2026-10-10).
           animations: true, weather: true, precipitation: true, focus_pause: true,
           gradient: 'live', gradient_custom: null,
           // THE BACKGROUND (2026-10-13): 'live', 'color' (a still color:
           // color, a SKY_BACKDROPS id) or 'photo' (photo, its address) --
           // Color and Photo draw no sky at all (settings.py SKY_BACKGROUNDS)
           background: 'live', color: 'midnight', photo: null,
           // the photo's look (settings.py PHOTO_LOOK_DEFAULTS)
           photo_look: { blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 },
           // LANDSCAPES (2026-10-14): which one and when it changes --
           // 'wake', 'every:<minutes>' or a file name (Stay the Same) --
           // and its own look (settings.py sky.landscape)
           landscape: 'every:1440', landscape_look: { blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 },
           // each page's background: {page: 'own' | 'live' | backdrop id |
           // 'photo'} -- a page missing is Automatic (settings.py sky.pages);
           // a page's own photo, for 'photo': page_photos
           pages: {}, page_photos: {}, page_looks: {},
           // FLAT'S OWN (settings.py FLAT_BACKGROUNDS): its background, color,
           // how far a photo fades (0-100) and each page's
           flat_background: 'color', flat_color: 'auto', flat_fade: 50, flat_pages: {}, flat_tint: 'none', flat_tint_amount: 60, flat_tint_light: 50, flat_image_look: {}, flat_page_image_looks: {}, image_look: {},
           themes: ['halloween', 'thanksgiving', 'christmas', 'birthday', 'fourth-of-july',
                    'valentines-day', 'spring-garden', 'winter-wonderland', 'storybook-magic',
                    'space-night'],
           christmas_from: null, hemisphere: 'north',
           halloween_from: null, halloween_to: null, thanksgiving_from: null, thanksgiving_to: null,
           christmas_to: null, july4_from: null, july4_to: null,
           valentines_from: null, valentines_to: null, spring_from: null, spring_to: null,
           winter_from: null, winter_to: null,
           halloween_often: null, thanksgiving_often: null, christmas_often: null,
           spring_often: null, winter_often: null, storybook_per_month: null, space_per_month: null,
           spooky_often: null,
           // LIVELINESS (hk-sky.js lvOf): one preset for every occasion
           // (subtle | classic | festive | party), or custom -- then each
           // occasion's or woodland season's preset, {id: preset}, missing =
           // classic, and a Custom one's knobs, {id: {knob: 0-4}}. A screen's
           // own, the same: its board's sky_liveliness, sky_liveliness_occ,
           // sky_liveliness_custom (and sky_calm_empty).
           liveliness_all: 'classic', liveliness: {}, liveliness_custom: {} },
    idle: { dashboards: [], rooms: {}, 'default': null },
    tablets: { idle_return: true, idle_time: 50, alert_offline: true, alert_restart: true, alert_charging: true,
               restart: false, restart_times: ['00:02', '15:00'], dismissed: [] },
    car: { dashboards: [], widths: {} },
    generated: { exclude_areas: [], exclude_devices: [], exclude_entities: [], include_entities: [] },
    features: { vacuum_script: null, alarm_bad_code: null, thermostats: [], temperature: null, power: null,
                house_timers: [] },
    menu: { glyph: 'sidebar', clock: true,
            // All Screens' menu, for the screens that don't set their own
            // (settings.py MENU_KEYS); a screen reads it already filled in
            style: 'auto', tab_at: '', tab_size: 'large', tab_size_phone: 'standard',
            open_min: 1000, time_weather_at: 'page', ha_row: false, ha_at: 'rooms', accent: 'orange', swipe: false,
            // the tab bar's (a device's Menu "tabbar")
            bar_scroll: 'shrink', bar_rooms: 'more', bar_glass: 'house', bar_more: 'icons',
            bar_more_phone: 'list', bar_pos: 'bottom', bar_fold: 'start', bar_start: 'full',
            bar_adjust: true, page_header: 'current',
            bar_tabs: 6, bar_tabs_rail: 6, bar_tabs_phone: 3, bar_size: 'medium', bar_labels: 'show',
            // Phones' own (hk-base.js phoneForm: a phone, or a tablet whose
            // own menu doesn't fit)
            bar_scroll_phone: 'shrink', button_phone: 'chip', bar_rooms_phone: 'more' },
    rooms: { headings: true, status: ['temperature', 'humidity', 'security', 'tvs', 'lights', 'outlets', 'blinds',
                                 'fans', 'windows', 'doors', 'locks', 'garage', 'valves', 'motion', 'occupancy',
                                 'leaks', 'speakers'],
             // All Screens' rooms, for the screens that don't set their own
             order: [], home: 'as_is', menu: 'az', pages: 'floor' },
    // All Screens' cameras, for the screens that don't set their own (empty: Automatic)
    // live: the Home strip's first tile plays live video (a screen's
    // camera_live_video, when set, is its own); focus_pause: on a computer,
    // live cameras rest while another window has the focus (hk-cameras.js
    // CAM_FOCUS) -- behind the screensaver they always rest
    cameras: { order: [], live: true, focus_pause: true },
    look: { flat: false, flat_theme: 'dark', glass: 'clear', frost: 50, blur: 50, tint: 50, well: 'dark', frost_tint: false, details: true, browse_view: 'music-browse', sky_switch: null,
            photos: 'media-source://media_source/local/photos', page_pills: {}, page_accents: {},
            // FLAT COLORS (settings.py flat_colors; resolveFlatColors)
            flat_colors: { accent: 'auto', off_tint: 'auto', pages: 'accent' }, flat_page_colors: {},
            // All Screens' screensaver options (settings.py SAVER_DEFAULTS)
            saver: { starts_after: 180, each_photo: 30, order: 'random', fill: true, zoom: false, clock: true,
                     weather: true, music: true, timers: true, status: true, show: 'photos', fallback: true,
                     forecast_every: 5, band: true, band_photos: false, calendar: false, calendar_days: 2,
                     music_slide: false, music_pane: false, music_first: false, fade_back: 500,
                     portrait_fill: false, portrait_blur: 50, portrait_dim: 20, portrait_zoom: 100, portrait_x: 'center', portrait_y: 'center',
                     landscape_blur: 50, landscape_dim: 20, landscape_zoom: 100, landscape_x: 'center', landscape_y: 'center',
                     clock_over: 'corner', clock_style: 'classic', clock_bg: 'gradient', clock_motion: 'slow', clock_24: false, clock_colors: {}, clock_speed: 35, clock_depth: 50, clock_night: 'off', clock_night_from: '22:00', clock_night_to: '07:00',
                     photo_layout: 'single', mosaic_count: 3, mosaic_gap: 'thin', mosaic_change: 'one', mosaic_line: 0, mosaic_color: 'black', mosaic_random: false, mosaic_every: 10,
                     clock_photo_soft: false, clock_photo_dim: 35, clock_text_shadow: 40, clock_text_outline: 0,
                     energy_slide: false, extra_music: false, extra_forecast: false, extra_every: 5, extra_for: 30, energy_hide: [],
                     weather_slide: false, weather_hide: [] } },
    // The Calendar page and the screensaver's calendar pane (All Screens ->
    // Calendar): the calendars shown, in order (empty: every calendar), and
    // each one's colour (a page pill colour)
    calendar: { entities: [], colors: {}, keywords: [], event_colors: {} },
    // NOW PLAYING's place (All Screens -> Now Playing; a screen's np_* keys
    // over it): a side pane or the bar on tablets & computers, the bar's
    // place there and on phones (hk-base.js nowPlaying)
    now_playing: { style: 'bar', side: 'right', bar: 'bottom', bar_phone: 'bottom', grace: 30 },
    // Browse Music (HK Settings -> Features -> Music). The Discover rows arrive as
    // the queries themselves (settings.py discover_rows); these are its
    // default five.
    browse: { hide: [], discover: [
      { key: 'recently_played', title: 'Recently played', media_type: 'track', order_by: 'last_played_desc' },
      { key: 'favourite_playlists', title: 'Favorite playlists', media_type: 'playlist', favorite: true },
      { key: 'most_played', title: 'Most played', media_type: 'album', order_by: 'play_count_desc' },
      { key: 'recently_added', title: 'Recently added', media_type: 'album', order_by: 'timestamp_added_desc' },
      { key: 'favourite_radio', title: 'Favorite radio', media_type: 'radio', favorite: true }
    ] }
  };
  // The sky's backdrops (Sky / Background): a fixed all-day gradient
  // instead of the live sky. This is the pre-answer mirror of settings.py
  // SKY_BACKDROPS -- tests/py/test_settings.py compares the entire table.
  // Each palette is four stops, top of sky to horizon, in a day set and a
  // night set. Where they come from: dusk and midnight are the live sky's
  // own measured rows (hk-sky.js SKY, elevations 4/-4 and 60/-18); fjord,
  // dune, graphite, plum, ember and mist are its static palettes (hk-sky.js
  // STATIC: ecoflow, energy, cameras, playmusic, doors, climate) -- the
  // horizon stops pulled to the glass plates' ground, at or under the live
  // sky's own 146 -- and each night set keeps its day set's hue at night
  // depth. Checked the way hk-sky.js checks a palette (mean under CAP,
  // horizon at or under 146); the test holds it.
  var SKY_BACKDROPS = [
    { id: 'live', label: 'Live Sky' },
    { id: 'dusk', label: 'Dusk', day: ['#141f3d', '#26314f', '#5c4460', '#b06a4a'],
      night: ['#0c1428', '#161d35', '#33263f', '#5e3730'] },
    { id: 'midnight', label: 'Midnight', day: ['#0d2f57', '#154272', '#256192', '#5b93b8'],
      night: ['#04070f', '#060a16', '#0a0f1f', '#111726'] },
    { id: 'fjord', label: 'Fjord', day: ['#121634', '#183456', '#1e6e7c', '#579eaa'],
      night: ['#0a0d22', '#0f2136', '#133f47', '#336163'] },
    { id: 'dune', label: 'Dune', day: ['#171d12', '#3a4020', '#7a5a24', '#b07f38'],
      night: ['#0d100a', '#1e2112', '#3f2e14', '#5e4522'] },
    { id: 'graphite', label: 'Graphite', day: ['#080a0e', '#0f1219', '#171b23', '#222833'],
      night: ['#040507', '#080a0d', '#0d1015', '#11141a'] },
    { id: 'plum', label: 'Plum', day: ['#150e1f', '#2e1b42', '#5c2f76', '#9a6bb0'],
      night: ['#0b0713', '#170e24', '#2e1a3f', '#4c3659'] },
    { id: 'ember', label: 'Ember', day: ['#1c0e10', '#3c1a1e', '#7a2f34', '#b0605f'],
      night: ['#100708', '#1e0d10', '#3d191c', '#5d3231'] },
    { id: 'mist', label: 'Mist', day: ['#0d1a1c', '#173437', '#22646a', '#56a0a0'],
      night: ['#080f10', '#0d1e21', '#12373d', '#325556'] },
    { id: 'lagoon', label: 'Lagoon', day: ['#0c1d2b', '#14324a', '#1f5068', '#3f7f90'],
      night: ['#070f18', '#0c1d2b', '#123346', '#244e5c'] },
    { id: 'lavender', label: 'Lavender Dusk', day: ['#15142b', '#25244a', '#3b3a6a', '#68679a'],
      night: ['#0b0a18', '#15142b', '#232245', '#3a3962'] },
    { id: 'sage', label: 'Sage Mist', day: ['#0e1a18', '#18302b', '#284a42', '#4f7a6c'],
      night: ['#08100e', '#0f1d1a', '#1a302b', '#2f4a42'] },
    { id: 'harbor', label: 'Harbor Slate', day: ['#111a26', '#1c2b3e', '#2d4159', '#566e8a'],
      night: ['#090e16', '#111a26', '#1b2a3c', '#2f4359'] },
    { id: 'rosewater', label: 'Rosewater', day: ['#1c1418', '#33232b', '#523844', '#86626f'],
      night: ['#100b0e', '#1c1418', '#2e1f26', '#4a343e'] },
    { id: 'driftwood', label: 'Driftwood', day: ['#1a1712', '#2f2a21', '#4b4333', '#7c6f57'],
      night: ['#0e0c09', '#1a1712', '#2a251c', '#443c2e'] },
    { id: 'black', label: 'Black', day: ['#05070e', '#05070e', '#05070e', '#05070e'],
      night: ['#05070e', '#05070e', '#05070e', '#05070e'] },
    { id: 'custom', label: 'Custom' }
  ];
  function backdropStops(id, custom) {
    // "live" (or an unknown id): the live sky. "custom": the house's own
    // stops, when they carry four of each; else the live sky too.
    if (id === 'custom') {
      if (custom && custom.day && custom.night && custom.day.length === 4 && custom.night.length === 4)
        return { day: custom.day, night: custom.night };
      return null;
    }
    for (var i = 0; i < SKY_BACKDROPS.length; i++) {
      var p = SKY_BACKDROPS[i];
      if (p.id === id && p.day) return { day: p.day, night: p.night };
    }
    return null;
  }
  var KEY = 'hk_settings';

  function merge(over) {
    var out = JSON.parse(JSON.stringify(DEFAULTS));
    if (over && typeof over === 'object') {
      Object.keys(out).forEach(function (s) {
        var v = over[s];
        if (v && typeof v === 'object') {
          Object.keys(out[s]).forEach(function (k) { if (k in v) out[s][k] = v[k]; });
        }
      });
      // THE WEATHER PAGE'S TWO OBJECTS, each over its own defaults (a copy
      // stored by an older page may lack a key the defaults have)
      var wv = over.weather || {};
      ['page', 'radar_native'].forEach(function (k) {
        var d = DEFAULTS.weather[k], o = wv[k];
        out.weather[k] = Object.assign(JSON.parse(JSON.stringify(d)),
          (o && typeof o === 'object' && !Array.isArray(o)) ? JSON.parse(JSON.stringify(o)) : {});
      });
    }
    // THE DASHBOARD ITEMS, by url path (settings.py `boards`): a map
    // whose keys are the house's own dashboards, so it is taken whole rather
    // than key by key against a default -- the loop above would drop it.
    var b = over && over.boards;
    out.boards = (b && typeof b === 'object' && !Array.isArray(b)) ? JSON.parse(JSON.stringify(b)) : {};
    // STATUS & CHIPS, resolved by the integration (kinds.py): kind -> entity ids.
    // Taken whole too; empty until a server that sends it answers.
    var kd = over && over.kinds;
    out.kinds = (kd && typeof kd === 'object' && !Array.isArray(kd)) ? JSON.parse(JSON.stringify(kd)) : {};
    // ACCESSORY SETTINGS (accessories.py): each accessory's name, icon, show
    // as, status and home, and each room's tile order. Taken whole.
    var ac = over && over.accessories;
    out.accessories = {
      entities: (ac && ac.entities && typeof ac.entities === 'object') ? JSON.parse(JSON.stringify(ac.entities)) : {},
      rooms: (ac && ac.rooms && typeof ac.rooms === 'object') ? JSON.parse(JSON.stringify(ac.rooms)) : {},
      into: (ac && ac.into && typeof ac.into === 'object') ? JSON.parse(JSON.stringify(ac.into)) : {},
      // a category page's own order (the Vacuums page, say)
      pages: (ac && ac.pages && typeof ac.pages === 'object') ? JSON.parse(JSON.stringify(ac.pages)) : {},
      // a room's scenes row on its page ([]: none; a room missing: Automatic)
      scenes: (ac && ac.scenes && typeof ac.scenes === 'object') ? JSON.parse(JSON.stringify(ac.scenes)) : {}
    };
    // THE HOUSE'S CUSTOM PAGES (settings.custom_pages): a list,
    // taken whole -- each its address, title, icon and view
    var cp = over && over.custom_pages;
    out.custom_pages = Array.isArray(cp) ? JSON.parse(JSON.stringify(cp)) : [];
    // THE HOUSE'S CUSTOM CHIPS (settings.custom_chips): likewise
    // -- each its key, name, where it sits and its card
    var cc = over && over.custom_chips;
    out.custom_chips = Array.isArray(cc) ? JSON.parse(JSON.stringify(cc)) : [];
    // THE FEATURES ADDED and set up (features/): music, live_tv,
    // clean_areas, alarm_pin -- their actions exist either way
    var ad = over && over.added;
    out.added = Array.isArray(ad) ? ad.filter(function (k) { return typeof k === 'string'; }) : [];
    // THE ENERGY PAGE'S PLAN (features/energy/plan.py), while Energy is
    // added: taken whole; null without it
    var en = over && over.energy;
    out.energy = (en && typeof en === 'object' && !Array.isArray(en)) ? JSON.parse(JSON.stringify(en)) : null;
    // THE OPTIONAL HACS CARDS that are installed (settings.find_extras):
    // key -> the card's URL, or null. Taken whole.
    var ex = over && over.extras;
    out.extras = (ex && typeof ex === 'object' && !Array.isArray(ex)) ? JSON.parse(JSON.stringify(ex)) : {};
    // THE POP-UPS (settings.py `popups`): a list, taken whole.
    var pp = over && over.popups;
    out.popups = Array.isArray(pp) ? JSON.parse(JSON.stringify(pp)) : [];
    // WHERE HK'S TEXTS SEND SOMEONE (`places`: phrase -> the place, from a host whose settings are elsewhere while
    // another server runs the house; hk-host-shell.js haPlace)
    var pl = over && over.places;
    out.places = {};
    if (pl && typeof pl === 'object' && !Array.isArray(pl)) {
      Object.keys(pl).forEach(function (k) { if (typeof pl[k] === 'string') out.places[k] = pl[k]; });
    }
    // THE WALL TABLETS (1.14, settings.py `tablet_items`): by id, taken
    // whole. null from a server before 1.14 -- tablet() then reads the
    // screens' own Tablet User, as before.
    var ti = over && over.tablet_items;
    out.tablet_items = (ti && typeof ti === 'object' && !Array.isArray(ti)) ? JSON.parse(JSON.stringify(ti)) : null;
    return out;
  }
  function load() {
    try { return JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function store(v) {
    try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  var cur = merge(load());
  var listeners = [];

  // ------------------------------------------------------------ the glass look
  // look.glass (Screens page):
  //   clear    the original plate; the status chips blur themselves
  //   frosted  a frosted MATERIAL everywhere and no blur at all -- drawn once,
  //            costs nothing per frame
  //   blur     ONE shared blur layer behind every glass surface (hk-glass.js);
  //            nothing blurs itself
  //   blur_pre the same layers holding a picture of the sky blurred once and
  //            pinned to the screen (hk-glass.js PRE-RENDERED): no live blur;
  //            the sky's motion does not show through
  //   tinted   Apple's Home app plate (2026-10-12): flat, semi-opaque, dark,
  //            and NO blur anywhere on the page -- no layer, no picture, no
  //            plate blurring itself; a contact shadow in place of the soft
  //            drop and the lit rim, no edge, the icon circles Dark or Light
  //            (look.well). Sheets and pop-ups keep their own blur (they
  //            blur while open, as Apple's do)
  //   blur_each  every glass surface blurs what is behind it (hkCards.M.glass
  //            reads --hk-glass-backdrop) -- for phones, iPads and
  //            computers: nothing to measure or line up, so a sheet opening, a
  //            press or a row scrolling can never leave the frost behind. NOT
  //            for wall tablets:
  // per-card backdrop-filter was measured unaffordable on entry-level Samsung
  // tablets (the cost is the NUMBER of blur surfaces: 22 of them halved the
  // frame rate and blanked cards); one shared layer held 90 fps. See
  // docs/ (each on its topic's page).
  //
  // THE AMOUNTS (House -> Look; a dashboard's Screen page can set its own),
  // each 0-100 %, 50 -- the middle of the slider -- as designed:
  //   look.frost  how milky the Frosted material is: the white sheen and the
  //               gray tint scale together, the grain stays (0: grain only)
  //   look.blur   how strong both blur looks are: 50 is 20 px, 100 is 40, 0
  //   look.tint   how dark the Tinted plate is: 0 is 40 %, 50 is 75 %, 100
  //               is 90 % (the user's 75 % in the middle, 2026-10-12)
  //               leaves only the darkening (saturate and brightness)
  //
  // THE MATERIAL IS SET HERE, not in hk-glass.js: this module loads before any
  // card draws and paints from its cached copy, so a frosted page never
  // flashes clear first. Every glass surface reads these through
  // hkCards.M.glass / the status chip's rule.
  var GRAIN = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'>' +
    '<filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/>' +
    '<feColorMatrix values=\'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0\'/></filter>' +
    '<rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")';
  // key: 'frost' | 'blur' | 'tint' -- this dashboard's own (its Screen page), else
  // the house's (look.*).
  function amount(key) {
    var b = boardHere(), v = b && b[key];
    var n = (v === null || v === undefined || v === '') ? Number(get('look.' + key)) : Number(v);
    return isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
  }
  function boardHere() {
    var seg = '';
    try { seg = String(location.pathname).split('/')[1] || ''; } catch (e) { /* a test harness */ }
    return (cur.boards && cur.boards[seg]) || null;
  }
  // `wash`: [r, g, b] in place of the gray -- Tint from Background
  // (hk-frosttint.js), a little stronger so the color reads (0.42 to 0.34)
  function frost(n, wash) {
    var f = n / 50, a = function (v) { return +Math.min(0.92, v * f).toFixed(3); };
    var w = wash ? 'rgba(' + wash.join(',') + ',' + a(0.42) + ')' : 'rgba(58,60,68,' + a(0.34) + ')';
    return GRAIN + ', linear-gradient(145deg, rgba(255,255,255,' + a(0.18) + '), rgba(255,255,255,' + a(0.09) + ')), ' +
      'linear-gradient(' + w + ', ' + w + ')';
  }
  // TINT FROM BACKGROUND, for this screen: its own when it sets one (not
  // null), else All Screens'; only ever with the Frosted look
  function frostTint() {
    if (glass() !== 'frosted') return false;
    var b = boardHere();
    if (b && typeof b.frost_tint === 'boolean') return b.frost_tint;
    return get('look.frost_tint') === true;
  }
  // Over a blur: the plate the status chips always had over their own.
  var OVER_BLUR = 'linear-gradient(145deg, rgba(255,255,255,0.16), rgba(255,255,255,0.07))';
  // The chips' own blur (hk-chip.js), at the chosen strength: the shared
  // layer's (hk-glass.js reads --hk-blur-filter) and every plate's.
  function blurFilter(n) {
    return 'blur(' + +(20 * n / 50).toFixed(1) + 'px) saturate(1.4) brightness(0.82)';
  }
  // TINTED's plate: black with a touch of blue, as the Home app's off tile
  // measured (0.68-0.73 x the ground behind it, which it also blurs -- with
  // no blur the ground shows through sharply, hence darker). Two straight
  // pieces so the middle of the slider is the chosen 75 %.
  function tintAlpha(n) {
    var a = n <= 50 ? 0.40 + 0.35 * n / 50 : 0.75 + 0.15 * (n - 50) / 50;
    return +a.toFixed(3);
  }
  // the icon circle on an off plate: Apple's, darker than the plate, or a
  // light one that keeps its shape over dark ground -- this screen's own
  // (its Screen page), else the house's
  var TINT_WELLS = { dark: 'rgba(0, 0, 0, 0.24)', light: 'rgba(255, 255, 255, 0.10)' };
  function tintWell() {
    var b = boardHere(), v = b && b.well;
    if (!TINT_WELLS[v]) v = get('look.well');
    return TINT_WELLS[v] ? v : 'dark';
  }
  var LOOKS = {
    clear:     function () { return {}; },
    frosted:   function () { var m = frost(amount('frost')); return { '--hk-glass-plate': m, '--hk-chip-plate': m, '--hk-chip-backdrop': 'none' }; },
    blur:      function () {
      return { '--hk-glass-plate': OVER_BLUR, '--hk-chip-backdrop': 'none', '--hk-blur-filter': blurFilter(amount('blur')) };
    },
    // the shared layers wearing a still picture of the sky, blurred once
    // (hk-glass.js PRE-RENDERED): to every card the same as blur
    blur_pre:  function () { return LOOKS.blur(); },
    // no blur at all: a flat plate, Apple's contact shadow (one dark pixel
    // under the edge, nothing past it -- measured off the Home app), no lit
    // rim, no edge (the 1 px box stays, transparent: the info card lines up
    // on it). Cards on a dark sheet wear a light lift instead
    // (--hk-glass-plate-sheet, hkCards.M.bg); the speaker picker's
    // shortcuts keep a dashed edge of their own (--hk-look-dash)
    tinted:    function () {
      var p = 'rgba(28, 28, 30, ' + tintAlpha(amount('tint')) + ')';
      return { '--hk-glass-plate': p, '--hk-chip-plate': p, '--hk-chip-backdrop': 'none',
               '--hk-glass-plate-sheet': 'rgba(255, 255, 255, 0.08)',
               '--hk-look-edge': '1px solid transparent', '--hk-look-edge-color': 'transparent',
               '--hk-look-shadow': '0 1px 2px rgba(0, 0, 0, 0.28)',
               '--hk-look-well': TINT_WELLS[tintWell()],
               '--hk-look-dash': '1px dashed rgba(255, 255, 255, 0.32)',
               // a FLOATING strip over the page (the Energy tabs once they
               // float): no blur either, the menu's and tab bar's own plate
               '--hk-float-plate': 'rgba(24, 24, 28, 0.93)', '--hk-float-backdrop': 'none' };
    },
    // every plate blurs itself, the chips too
    blur_each: function () {
      var b = blurFilter(amount('blur'));
      return { '--hk-glass-plate': OVER_BLUR, '--hk-glass-backdrop': b, '--hk-chip-backdrop': b };
    }
  };
  // looks taken out, worn as the one that replaced them (settings.py
  // RETIRED_GLASS) -- a cached copy from before may still name one
  var RETIRED = { blur_baked: 'blur_pre' };
  LOOKS.flat = function () { return { '--hk-glass-backdrop': 'none', '--hk-chip-backdrop': 'none' }; };
  var flatKeys = [];
  var LOOK_VARS = ['--hk-glass-plate', '--hk-chip-plate', '--hk-chip-backdrop', '--hk-glass-backdrop',
                   '--hk-blur-filter', '--hk-glass-plate-sheet', '--hk-look-edge', '--hk-look-edge-color',
                   '--hk-look-shadow', '--hk-look-well', '--hk-look-dash', '--hk-float-plate', '--hk-float-backdrop'];
  // A PREVIEW ON ONE SCREEN: ?hkglass=clear|frosted|tinted|blur|blur_pre|blur_each on the URL
  // (or hkSettings.previewGlass(), which the test probe uses) wears that look
  // on this page only, without changing the house's setting or the cache.
  var glassPreview = null;
  try {
    var gm = /[?&]hkglass=(flat|clear|frosted|tinted|blur_each|blur_pre|blur)\b/.exec(location.search);
    if (gm) glassPreview = gm[1];
  } catch (e) { /* no location (a test harness) */ }
  // A DASHBOARD'S OWN LOOK: its item's Screen page, else the house's.
  // Re-applied as the page moves between dashboards (location-changed).
  // One policy for cards, overlays, sky, media and screensaver. Explicit
  // false is an opt-out, not an absent value. Keep the saved glass intact.
  function appearance(b, look) {
    b = b || {}; look = look || {};
    var ownGlass = b.glass && b.glass !== 'house';
    var enabled = typeof b.flat === 'boolean' ? b.flat : (!ownGlass && look.flat === true);
    var theme = b.flat_theme === 'light' || b.flat_theme === 'dark' ? b.flat_theme : look.flat_theme;
    return { flat: enabled, theme: theme === 'light' ? 'light' : 'dark' };
  }
  function rendering() {
    var a = appearance(boardHere(), get('look', {}));
    if (glassPreview) a.flat = glassPreview === 'flat';
    try {
      var t = /[?&]hkflat_theme=(light|dark)\b/.exec(location.search);
      if (t && glassPreview === 'flat') a.theme = t[1];
    } catch (e) { /* no location */ }
    a.motion = a.blur = a.liveSky = a.autoplay = !a.flat;
    return a;
  }
  function glass() {
    if (rendering().flat) return 'flat';
    if (glassPreview) return glassPreview;
    var b = boardHere(), bg = b && (RETIRED[b.glass] || b.glass);
    if (bg && LOOKS[bg]) return bg;
    var g = get('look.glass');
    g = RETIRED[g] || g;
    return LOOKS[g] ? g : 'clear';
  }
  // Sky / Background (HK Settings -> Sky / Background; a screen's own on
  // its Screen page): this page's sky look, resolved like glass() -- this
  // dashboard's own values when it sets them (not null), else All Screens'
  // (sky.*). backdrop: null is the live sky; {day: [4], night: [4]} a fixed
  // all-day gradient (the day set by day, the night set by night -- hk-sky.js
  // paint). The boards' keys are sky_animations / sky_weather /
  // sky_decorations / sky_decoration_style / sky_cloud_style / sky_daytime /
  // sky_gradient / sky_custom. brightness: the daytime sky (settings.py
  // DAYTIME_SKIES) as hk-sky.js paints it, 0 (deep) .. 1 (natural).
  var DAYTIME = { natural: 1, balanced: 0.5, deep: 0 };
  function skyLook() {
    var b = boardHere();
    var own = function (bk, hk, dflt) {
      var v = b ? b[bk] : undefined;
      return (v === null || v === undefined) ? get(hk, dflt) : v;
    };
    var flat = rendering().flat;
    return {
      animations: !flat && own('sky_animations', 'sky.animations', true) !== false,
      weather: !flat && own('sky_weather', 'sky.weather', true) !== false,
      // Rain & Snow: the falling weather alone (2026-10-10); and Pause When
      // Not in Focus -- on a computer, the sky and the cards hold while
      // another window has the focus (hk-sky.js FOCUS)
      precipitation: !flat && own('sky_precipitation', 'sky.precipitation', true) !== false,
      focusPause: own('sky_focus_pause', 'sky.focus_pause', true) !== false,
      decorations: !flat && own('sky_decorations', 'sky.decorations', true) !== false,
      decorationStyle: own('sky_decoration_style', 'sky.decoration_style', 'old'),
      // Moving Things: 'front' draws them over the cards (hk-sky.js FRONT)
      moving: own('sky_moving', 'sky.moving', 'behind'),
      cloudStyle: own('sky_cloud_style', 'sky.cloud_style', 'classic'),
      brightness: DAYTIME.hasOwnProperty(own('sky_daytime', 'sky.daytime', 'natural'))
        ? DAYTIME[own('sky_daytime', 'sky.daytime', 'natural')] : 1,
      backdrop: backdropStops(own('sky_gradient', 'sky.gradient', 'live'),
                              b && b.sky_gradient != null ? own('sky_custom', 'sky.gradient_custom', null) : get('sky.gradient_custom', null)),
      // THE BACKGROUND (2026-10-13): what Home, the room pages and every page
      // without a color of its own show -- the live sky, or a still color
      // ({day, night} stops) or photo, with no sky drawn at all
      background: background(b),
      // Liveliness: this screen's own when it has one (sky_liveliness),
      // else All Screens' -- the same shape (hk-sky.js lvOf). `room` is
      // where Calm When Nobody's Around looks for someone (the screen's idle
      // room).
      lively: (b && b.sky_liveliness) ? {
        all: b.sky_liveliness, occ: b.sky_liveliness_occ || {}, custom: b.sky_liveliness_custom || {},
        calmEmpty: !!b.sky_calm_empty, room: b.idle_room || ''
      } : {
        all: get('sky.liveliness_all', 'classic') || 'classic',
        occ: get('sky.liveliness', {}) || {},
        custom: get('sky.liveliness_custom', {}) || {},
        calmEmpty: !!(b && b.sky_calm_empty),
        room: (b && b.idle_room) || ''
      }
    };
  }
  // A PAGE'S BACKGROUND (Sky / Background -> Pages): this screen's choice
  // for the page, else All Screens', else null (Automatic: a page with a
  // color of its own keeps it, the rest show the live sky). `key`: a page
  // kind (energy, climate, rooms ...) or a custom page's address.
  //
  // `key` may be a list, the most particular first: a room's page is
  // ['room-kitchen', 'rooms'] (2026-10-13) -- the room's own choice (this
  // screen's, else All Screens'), else Room Pages'.
  function keysOf(key) { return (Array.isArray(key) ? key : [key]).filter(Boolean); }
  // the first of `keys` set in this screen's map, else All Screens'
  function pageFind(keys, bk, hk) {
    var b = boardHere(), all = get(hk, {}) || {};
    for (var i = 0; i < keys.length; i++) {
      var mine = b && b[bk] && b[bk][keys[i]];
      if (mine) return mine;
      if (all[keys[i]]) return all[keys[i]];
    }
    return null;
  }
  function pageSky(key) {
    return pageFind(keysOf(key), 'sky_pages', 'sky.pages');
  }
  // THE BACKGROUND as this screen has it: {mode: 'live' | 'color' | 'photo',
  // stops (a color's {day, night}), photo (its address)}. The screen's own
  // mode, color and photo, each else All Screens'. A color that can't be
  // drawn (Custom with no stops) is Black; a Photo with none chosen is
  // Black too -- never the live sky, which is what was turned away from.
  var BLACK = { day: ['#05070e', '#05070e', '#05070e', '#05070e'], night: ['#05070e', '#05070e', '#05070e', '#05070e'] };
  function background(b) {
    var mode = (b && b.sky_background) || get('sky.background', 'live') || 'live';
    // LANDSCAPES: a photo like any other, HK's own -- Black until the list
    // has come (landscapeList), never the live sky
    if (mode === 'landscapes') {
      var lf = landscapeFile(landscapeChoice(b), landscapeList());
      return { mode: 'photo', landscapes: true, stops: BLACK, photo: lf ? LANDSCAPES + lf : null, look: landscapeLook(b) };
    }
    if (mode !== 'color' && mode !== 'photo') return { mode: 'live', stops: null, photo: null };
    var color = (b && b.sky_color) || get('sky.color', 'midnight') || 'midnight';
    var custom = b && b.sky_custom ? b.sky_custom : get('sky.gradient_custom', null);
    var photo = (b && b.sky_photo) || get('sky.photo', null) || null;
    if (mode === 'photo') return { mode: 'photo', stops: BLACK, photo: photo, look: photoLook(b) };
    return { mode: 'color', stops: backdropStops(color, custom) || BLACK, photo: null };
  }
  // A PHOTO'S LOOK (2026-10-13): this screen's own, else All Screens' --
  // {blur px, dim 0..1 (brightness = 1 - dim), saturate 0..2, tint: {day,
  // night} stops washed over it at `amount` 0..1, or null}. A page's photo
  // has its screen's.
  function photoLook(b, own) {
    if (rendering().flat) return { blur: 0, dim: 0, saturate: 1, tint: null, amount: 0 };
    if (b === undefined) b = boardHere();
    var L = Object.assign({ blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 },
                          own || (b && b.sky_photo_look) || get('sky.photo_look', {}) || {});
    var custom = b && b.sky_custom ? b.sky_custom : get('sky.gradient_custom', null);
    var tint = L.tint ? backdropStops(L.tint, custom) : null;
    // THE IMAGE LOOK (2026-10-24): Flat's treatment, when one is chosen for
    // the Glass looks (hkFlatImage.resolveGlass) -- null when Off
    var H = window.hkFlatImage, im = H && H.resolveGlass ? H.resolveGlass(get('sky', {}), b).value : null;
    return { blur: Math.round(Math.max(0, Math.min(100, +L.blur || 0)) * 0.4), dim: Math.max(0, Math.min(0.8, (+L.dim || 0) / 100)),
             saturate: Math.max(0, Math.min(2, (L.saturation == null ? 100 : +L.saturation) / 100)),
             tint: tint, amount: tint ? Math.max(0, Math.min(0.8, (+L.tint_amount || 0) / 100)) : 0,
             image: im && im.mode !== 'legacy' ? im : null };
  }
  // LANDSCAPES AS A BACKGROUND (2026-10-14): HK Frontend's own photos
  // (frontend/landscapes, the screensaver clock's). The list is the folder's
  // index.json -- a home's own files folder can answer with its own --
  // fetched once, the first time a screen needs it; every listener hears
  // when it has come. Until then a Landscapes background is Black.
  var LANDSCAPES = '/hk/landscapes/', LAND_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$/i;
  var landList = null, landAsked = false;
  function landscapeList() {
    if (landList || landAsked || typeof fetch !== 'function') return landList;
    landAsked = true;
    fetch(LANDSCAPES + 'index.json').then(function (r) { return r.json(); }).then(function (j) {
      landList = ((j && j.photos) || []).filter(function (p) { return p && typeof p.file === 'string' && LAND_FILE.test(p.file); });
      listeners.slice().forEach(function (fn) {
        try { fn(cur); } catch (e) { console.error('[hk-settings] listener', e); }
      });
    }).catch(function () { setTimeout(function () { landAsked = false; }, 60000); });
    return landList;
  }
  // which one, and when it changes: this screen's choice, else All Screens'
  // -- 'wake', 'every:<minutes>' or a file name (Stay the Same)
  function landscapeChoice(b) {
    if (b === undefined) b = boardHere();
    return (b && b.sky_landscape) || get('sky.landscape', 'every:1440') || 'every:1440';
  }
  // EACH TIME THE SCREEN WAKES: counted as it goes to sleep -- the
  // screensaver or HK's black starting, or the page hidden (a tablet's
  // screen off) -- so the next one is drawn while nobody is looking and the
  // wake shows it, never a swap in front of someone. At most one a minute
  // (a screensaver straight into the black is one sleep). The count starts
  // from the minute the page loaded, so a reload is a new one too.
  var landWake = Math.floor(Date.now() / 60000), landSlept = 0;
  function landscapeSleep() {
    var now = Date.now();
    if (now - landSlept < 60000) return;
    landSlept = now;
    landWake++;
    if (landscapeChoice() !== 'wake') return;
    listeners.slice().forEach(function (fn) {
      try { fn(cur); } catch (e) { console.error('[hk-settings] listener', e); }
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('hk-saver', function (e) { if (e && e.detail && e.detail.on) landscapeSleep(); });
    window.addEventListener('hk-black', function (e) { if (e && e.detail && e.detail.on) landscapeSleep(); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () { if (document.hidden) landscapeSleep(); });
  }
  // WHICH ONE NOW: Stay the Same -- the file picked; on a schedule -- the
  // local time's number of intervals (every:1440 changes at midnight); each
  // wake -- the wakes counted. Stepped 17 along the list each time, so the
  // next one is never its neighbor (the list runs mountains, then lakes ...)
  // and every one comes round. A file no longer in the list: a new one each
  // day. (hk-settings-model.js has the same, for HK Settings' preview.)
  function landscapeFile(choice, list, now, wakes) {
    if (!list || !list.length) return null;
    var every = /^every:(\d+)$/.exec(choice || ''), n;
    if (choice === 'wake') n = wakes == null ? landWake : wakes;
    else {
      if (!every) {
        var hit = list.filter(function (p) { return p.file === choice; })[0];
        if (hit) return hit.file;
      }
      var mins = every ? Math.max(1, +every[1]) : 1440;
      var d = now || new Date(), local = d.getTime() - d.getTimezoneOffset() * 60000;
      n = Math.floor(local / (mins * 60000));
    }
    var step = list.length % 17 ? 17 : 1;
    return list[((n * step) % list.length + list.length) % list.length].file;
  }
  // a landscape's look: this screen's own, else All Screens' (photoLook's shape)
  function landscapeLook(b) {
    if (b === undefined) b = boardHere();
    return photoLook(b, (b && b.sky_landscape_look) || get('sky.landscape_look', null) || {});
  }
  // a page set to Landscapes: the screen's landscape, with the page's own
  // look (the room's, then Room Pages'), else the screen's landscape look
  function pageLandscape(key) {
    var b = boardHere(), lf = landscapeFile(landscapeChoice(b), landscapeList());
    var own = pageFind(keysOf(key), 'sky_page_looks', 'sky.page_looks');
    return { photo: lf ? LANDSCAPES + lf : null, look: own ? photoLook(b, own) : landscapeLook(b) };
  }
  // a page's own photo (for a page set to Photo): this screen's for it, else
  // All Screens', else the screen's Background photo
  function pagePhoto(key) {
    var b = boardHere();
    return pageFind(keysOf(key), 'sky_page_photos', 'sky.page_photos') || (b && b.sky_photo) || get('sky.photo', null) || null;
  }
  // a page's photo look: its own (the room's, then Room Pages'), else the
  // screen's (photoLook)
  function pageLook(key) {
    var own = pageFind(keysOf(key), 'sky_page_looks', 'sky.page_looks');
    return own ? photoLook(boardHere(), own) : photoLook();
  }
  // FLAT'S BACKGROUND FOR A PAGE (2026-10-16; settings.py FLAT_BACKGROUNDS):
  // {color: 'auto' | a FLAT_COLORS id | '#rrggbb'} or {photo: its address},
  // with the screen's fade (0-100). `key` as pageSky's; `own`: the page has
  // a ground of its own (Climate's sage ...), which Automatic keeps. A page
  // left alone is the screen's Background; a Photo or Landscape not there
  // yet is the theme's ground, never a blank.
  function flatBackground(key, own) {
    var b = boardHere(), keys = keysOf(key);
    var fade = b && b.sky_flat_fade != null ? b.sky_flat_fade : get('sky.flat_fade', 50);
    var mode = keys.length ? pageFind(keys, 'sky_flat_pages', 'sky.flat_pages') : null;
    if (!mode || mode === 'auto') {
      if (own) return { color: 'auto', fade: fade };
      var bg = (b && b.sky_flat_background) || get('sky.flat_background', 'color') || 'color';
      if (bg === 'photo') mode = 'screen-photo';
      else if (bg === 'landscapes') mode = 'landscapes';
      else return { color: (b && b.sky_flat_color) || get('sky.flat_color', 'auto') || 'auto', fade: fade };
    }
    var photo = null;
    if (mode === 'photo') photo = pagePhoto(keys);
    else if (mode === 'screen-photo') photo = (b && b.sky_photo) || get('sky.photo', null) || null;
    else if (mode === 'landscapes') {
      var lf = landscapeFile(landscapeChoice(b), landscapeList());
      photo = lf ? LANDSCAPES + lf : null;
    } else return { color: mode, fade: fade };
    // (the Fade's color, 2026-10-17: the screen's own, else All Screens')
    var tint = (b && b.sky_flat_tint) || get('sky.flat_tint', 'none') || 'none';
    // (a preview, never saved: ?hkflat_bgtint=accent | none | <hex>)
    try {
      var tp = /[?&]hkflat_bgtint=([#%23a-z0-9]+)/i.exec(location.search);
      if (tp) { tint = decodeURIComponent(tp[1]).toLowerCase(); if (/^[0-9a-f]{6}$/.test(tint)) tint = '#' + tint; }
    } catch (e) { /* no location */ }
    var tamt = b && b.sky_flat_tint_amount != null ? b.sky_flat_tint_amount : get('sky.flat_tint_amount', 60);
    var tl = b && b.sky_flat_tint_light != null ? b.sky_flat_tint_light : get('sky.flat_tint_light', 50);
    var imageLook = window.hkFlatImage ? window.hkFlatImage.resolve(get('sky', {}), b, keys).value : null;
    return photo ? { photo: photo, fade: fade, tint: tint, tintAmount: tamt, tintLight: tl, imageLook: imageLook } : { color: 'auto', fade: fade };
  }
  // FLAT COLORS (2026-10-17, hk_house/docs/PLAN-2026-10-17-flat-appearance-colors.md;
  // settings.py flat_colors): Flat's Accent Color and Off Pill Tint, each
  // field resolved ON ITS OWN, the first stored in --
  //   a page:   this screen's page, All Screens' page, this screen, All Screens
  //   a room:   this screen's room, All Screens' room, this screen's Room
  //             Pages, All Screens' Room Pages, this screen, All Screens
  // -- a page's own over a screen's general colors, as Flat's backgrounds
  // are (pageFind). Missing is inherited; 'auto' stops the search. Pure:
  // `look` is All Screens' look section, `b` a screen's item (raw, as fed),
  // `keys` the page's, most particular first. -> {accent, off_tint}, each
  // {value, scope: 'screen-page' | 'house-page' | 'screen' | 'house' |
  // 'default' | 'preview', page}.
  // `pages` (All Screens and a screen only, missing: 'accent'): 'own' keeps
  // a page that has its own color (OWN_COLOR_PAGES, hk-base.js
  // PAGE_ACCENTS) Automatic under an accent chosen for the whole screen --
  // Climate blue, Lights yellow; Home and the rooms take the accent.
  var FLAT_FIELDS = ['accent', 'off_tint'];
  var OWN_COLOR_PAGES = ['climate', 'lights', 'security', 'doors_windows', 'calendar', 'weather', 'energy', 'power',
                         'water', 'music', 'live_tv', 'cameras', 'vacuums', 'timers'];
  function resolveFlatColors(look, b, keys) {
    look = look || {}; keys = keysOf(keys || []);
    var hp = look.flat_page_colors || {}, hb = look.flat_colors || {};
    var bp = (b && b.flat_page_colors) || {}, bb = (b && b.flat_colors) || {};
    var c = [];
    keys.forEach(function (k) {
      if (b) c.push({ o: bp[k], scope: 'screen-page', page: k });
      c.push({ o: hp[k], scope: 'house-page', page: k });
    });
    if (b) c.push({ o: bb, scope: 'screen', page: null });
    c.push({ o: hb, scope: 'house', page: null });
    var out = {};
    FLAT_FIELDS.forEach(function (f) {
      for (var i = 0; i < c.length; i++) {
        var v = c[i].o && c[i].o[f];
        if (typeof v === 'string' && v) { out[f] = { value: v.toLowerCase(), scope: c[i].scope, page: c[i].page }; return; }
      }
      out[f] = { value: 'auto', scope: 'default', page: null };
    });
    var pm = b && typeof bb.pages === 'string' ? { value: bb.pages, scope: 'screen' }
           : typeof hb.pages === 'string' ? { value: hb.pages, scope: 'house' } : { value: 'accent', scope: 'default' };
    out.pages = { value: pm.value === 'own' ? 'own' : 'accent', scope: pm.scope, page: null };
    var own = keys.filter(function (k) { return OWN_COLOR_PAGES.indexOf(k) >= 0; })[0];
    if (out.pages.value === 'own' && own && (out.accent.scope === 'screen' || out.accent.scope === 'house')) {
      out.accent = { value: 'auto', scope: 'own-page', page: own };
    }
    return out;
  }
  // THE PAGE THIS IS, as its background knows it: the view's sky_page /
  // sky_room (hk-strategy.js skyPages), read off the panel's config the way
  // hk-sky.js reads it; before the config is there, the address as the
  // strategy names it. Home and a dashboard of your own: no page (the
  // screen's colors).
  var PAGE_OF_PATH = { 'doors-windows': 'doors_windows', playmusic: 'music', 'music-browse': 'music', 'live-tv': 'live_tv' };
  function viewKeys() {
    var cfg = null, seg = '';
    try {
      seg = decodeURIComponent((String(location.pathname).split('/')[2] || '').split('?')[0]);
      cfg = window.hkShell.dashboardConfig();
    } catch (e) { /* no document (a test harness) */ }
    var views = cfg && cfg.views, v = null;
    if (views && views.length) {
      if (seg === '') v = views[0];
      for (var i = 0; !v && i < views.length; i++) {
        if ((views[i].path != null && String(views[i].path) === seg) || String(i) === seg) v = views[i];
      }
      if (!v) v = views[0];
      return { keys: v.sky_room ? [v.sky_room, v.sky_page] : v.sky_page ? [v.sky_page] : [], sure: true };
    }
    if (/^room-/.test(seg)) return { keys: [seg, 'rooms'], sure: false };
    return { keys: seg && seg !== 'home' ? [PAGE_OF_PATH[seg] || seg] : [], sure: false };
  }
  // A PREVIEW ON ONE SCREEN, as ?hkglass is: ?hkflat_accent=<hex | name |
  // auto>&hkflat_tint=<auto | accent | hex | name> -- never saved
  function flatPreview() {
    var out = {};
    try {
      var a = /[?&]hkflat_accent=([#%23a-z0-9]+)/i.exec(location.search), t = /[?&]hkflat_tint=([#%23a-z0-9]+)/i.exec(location.search);
      var norm = function (x) { x = decodeURIComponent(x).toLowerCase(); return /^[0-9a-f]{6}$/.test(x) ? '#' + x : x; };
      if (a) out.accent = norm(a[1]);
      if (t) out.off_tint = norm(t[1]);
    } catch (e) { /* no location */ }
    return out;
  }
  // THIS PAGE'S FLAT COLORS (or `ctx`'s: {board: a screen's item | null for
  // All Screens alone, keys}) -- memoized per address and settings version
  var flatMemo = { key: null, val: null };
  function flatColors(ctx) {
    var vk = ctx && ctx.keys !== undefined ? { keys: keysOf(ctx.keys), sure: true } : viewKeys();
    var b = ctx && ctx.board !== undefined ? ctx.board : boardHere();
    var where = '';
    try { where = String(location.pathname) + String(location.search); } catch (e) { /* no location */ }
    var mkey = ctx ? null : where + '|' + (state ? state.version : 0) + '|' + vk.keys.join(',');
    if (mkey && flatMemo.key === mkey) return flatMemo.val;
    var r = resolveFlatColors(get('look', {}), b, vk.keys), pv = ctx ? {} : flatPreview();
    FLAT_FIELDS.forEach(function (f) { if (pv[f]) r[f] = { value: pv[f], scope: 'preview', page: null }; });
    r.keys = vk.keys;
    if (mkey && vk.sure) { flatMemo.key = mkey; flatMemo.val = r; }
    return r;
  }
  // a backdrop's stops by id, {day, night} -- "custom" this screen's own
  // colors (else All Screens'); null for the live sky or an unknown id
  function pageBackdrop(id) {
    var b = boardHere();
    var custom = b && b.sky_custom ? b.sky_custom : get('sky.gradient_custom', null);
    return backdropStops(id, custom);
  }
  function applyLook() {
    var root = document.documentElement;
    if (!root || !root.style) return;
    flatKeys.forEach(function (k) { root.style.removeProperty(k); });
    flatKeys = [];
    var look = LOOKS[glass()]();
    LOOK_VARS.forEach(function (k) {
      if (look[k]) root.style.setProperty(k, look[k]); else root.style.removeProperty(k);
    });
    var policy = rendering(), C = window.hkCards;
    if (policy.flat && C && C.FLAT) {
      var tokens = C.FLAT[policy.theme];
      flatKeys = Object.keys(tokens);
      flatKeys.forEach(function (k) { root.style.setProperty(k, tokens[k]); });
    }
    if (root.setAttribute) {
      root.setAttribute('data-hk-glass', glass());
      if (policy.flat) root.setAttribute('data-hk-flat', policy.theme);
      else if (root.removeAttribute) root.removeAttribute('data-hk-flat');
    }
    if (root.toggleAttribute) root.toggleAttribute('data-hk-frost-tint', frostTint());
  }
  // Marks a glass surface for the shared blur layer. NOT inherited, so only
  // the plate itself carries it, never the text and icons inside.
  try {
    if (window.CSS && CSS.registerProperty) {
      CSS.registerProperty({ name: '--hk-glass-surface', syntax: '<integer>',
                             inherits: false, initialValue: '0' });
    }
  } catch (e) { /* already registered by an earlier load */ }
  var waiting = [];              // whenLive() callers
  var state = { version: 0, live: false, configured: null };

  function get(path, fallback) {
    var v = cur;
    var parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) break;
      v = v[parts[i]];
    }
    return (v === null || v === undefined) ? fallback : v;
  }

  function apply(payload) {
    var next = merge(payload);
    var changed = JSON.stringify(next) !== JSON.stringify(cur);
    cur = next;
    state.live = true;
    state.configured = !!(payload && payload.configured);
    store(payload);
    waiting.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* caller's */ } });
    if (!changed) return;
    state.version++;
    applyLook();
    lookNow = lookKey();
    listeners.slice().forEach(function (fn) {
      try { fn(cur); } catch (e) { console.error('[hk-settings] listener', e); }
    });
    announce();
  }

  function announce() {
    try {
      window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: { module: 'hk-settings' } }));
    } catch (e) { /* no event bus (a test harness) */ }
  }

  // A SUBSCRIPTION THAT SURVIVES. home-assistant-js-websocket
  // re-subscribes by itself after a reconnect -- but a subscribe that FAILS is
  // dropped for good. And one fails after every Home Assistant restart on a
  // screen that reconnects early: the websocket is served from the moment the
  // frontend is up, before this integration has registered its commands, so
  // the answer is `unknown_command` and the page would never hear of another
  // edit until it was reloaded. So the resubscribe is ours: after every
  // reconnect ('ready'), and after a failure with a backoff (1 s .. 30 s).
  // Also used by hkMusic (hk-base.js). Returns a function that ends it.
  function subscribe(conn, msg, onEvent, label) {
    var gen = 0, timer = null, backoff = 1000, closed = false, unsub = null;
    function quiet(fn) {
      try { var r = fn(); if (r && typeof r.catch === 'function') r.catch(function () {}); }
      catch (e) { /* already gone */ }
    }
    function go() {
      if (closed) return;
      var my = ++gen;
      clearTimeout(timer);
      Promise.resolve().then(function () {
        return conn.subscribeMessage(function (ev) {
          if (my === gen && !closed) onEvent(ev);
        }, msg, { resubscribe: false });
      }).then(function (u) {
        if (my !== gen || closed) { quiet(u); return; }
        unsub = u;
        backoff = 1000;
      }, function (e) {
        if (my !== gen || closed) return;
        console.warn('[' + (label || msg.type) + '] not available, retrying in ' +
                     (backoff / 1000) + ' s (' + ((e && (e.message || e.code)) || e) + ')');
        timer = setTimeout(go, backoff);
        backoff = Math.min(backoff * 2, 30000);
      });
    }
    // A reconnect: the server has forgotten every subscription.
    function onReady() { unsub = null; backoff = 1000; go(); }
    if (typeof conn.addEventListener === 'function') conn.addEventListener('ready', onReady);
    go();
    return function close() {
      closed = true;
      clearTimeout(timer);
      if (typeof conn.removeEventListener === 'function') conn.removeEventListener('ready', onReady);
      if (unsub) quiet(unsub);
    };
  }

  // The host adapter owns connection discovery. State snapshots share one
  // subscription port; a replacement port ends the old subscriptions first.
  var attached = null, subscriptions = [];
  function currentClient() {
    var host = window.hkHostClient;
    return host && host.current ? host.current() : null;
  }
  function attach() {
    var client = currentClient(), conn = client && client.subscriptions;
    if (conn === attached) return !!conn;
    subscriptions.splice(0).forEach(function (close) { close(); });
    attached = conn || null;
    if (!conn) return false;
    subscriptions.push(subscribe(conn, { type: 'hk_frontend/settings/subscribe' }, function (payload) {
      if (attached !== conn) return;
      apply(payload);
      try { reportSeen(currentClient()); } catch (e) { /* optional screen report */ }
    }, 'hk-settings'));
    subscriptions.push(subscribe(conn, { type: 'hk_frontend/events/subscribe' }, function (ev) {
      if (attached !== conn) return;
      try { window.dispatchEvent(new CustomEvent('hk-house-event', { detail: ev })); } catch (e) { /* no bus */ }
    }, 'hk-events'));
    return true;
  }
  // Settings can bootstrap before either the adapter or any card. Events
  // catch late modules and host updates; a slow check also covers a shell
  // connection replacement on a page containing no HK cards.
  window.addEventListener('hk-host-client-ready', attach);
  window.addEventListener('hk-client-update', attach);
  var tries = 0, slow = null;
  function watchSlowly() {
    if (slow === null) slow = setInterval(attach, 2000);
  }
  if (attach()) watchSlowly();
  else {
    var fast = setInterval(function () {
      if (!attach() && ++tries < 600) return;
      clearInterval(fast);
      watchSlowly();
    }, 100);
  }

  // ------------------------------------------------------------ helpers
  function st(states, id) { return (id && states && states[id]) || null; }

  // THE WEATHER PAGE (settings weather.page): what it shows, each key
  // checked against its defaults (a bad one is the default, never a throw)
  var WX_DETAILS = ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'];
  function weatherPage() {
    var d = DEFAULTS.weather.page, o = get('weather.page', null) || {}, out = {};
    Object.keys(d).forEach(function (k) {
      var v = o[k], def = d[k];
      if (k === 'details') {
        out[k] = Array.isArray(v) ? v.filter(function (x, i) { return WX_DETAILS.indexOf(x) >= 0 && v.indexOf(x) === i; }) : def.slice();
      } else if (typeof def === 'boolean') out[k] = typeof v === 'boolean' ? v : def;
      else if (k === 'hours') out[k] = [6, 12, 24].indexOf(v) >= 0 ? v : def;
      else if (k === 'days') out[k] = [5, 8, 10].indexOf(v) >= 0 ? v : def;
      else if (k === 'hourly_metric') out[k] = ['temperature', 'rain', 'wind'].indexOf(v) >= 0 ? v : def;
      else out[k] = def;
    });
    return out;
  }
  // THE RADAR (settings weather.radar_native), each key checked likewise
  function radarNative() {
    var d = DEFAULTS.weather.radar_native, o = get('weather.radar_native', null) || {}, out = {};
    var whole = function (v, lo, hi, def) { return typeof v === 'number' && isFinite(v) && Math.round(v) === v && v >= lo && v <= hi ? v : def; };
    var one = function (v, list, def) { return list.indexOf(v) >= 0 ? v : def; };
    Object.keys(d).forEach(function (k) {
      var v = o[k], def = d[k];
      if (typeof def === 'boolean') out[k] = typeof v === 'boolean' ? v : def;
      else if (k === 'provider') out[k] = one(v, ['auto', 'noaa', 'rainviewer'], def);
      else if (k === 'basemap') out[k] = one(v, ['osm'], def);
      else if (k === 'center') out[k] = one(v, ['home', 'zone'], def);
      else if (k === 'zone') out[k] = typeof v === 'string' && /^zone\.[a-z0-9_]+$/.test(v) ? v : null;
      else if (k === 'zoom') out[k] = whole(v, 4, 10, def);
      else if (k === 'opacity') out[k] = whole(v, 20, 100, def);
      else if (k === 'history_minutes') out[k] = one(v, [30, 60, 120], def);
      else if (k === 'playback_speed') out[k] = one(v, ['slow', 'normal', 'fast'], def);
      else out[k] = def;
    });
    return out;
  }
  // WHERE AND FROM WHOM THE RADAR COMES (hk-radar.js, the settings' summary):
  //   { enabled, provider: 'noaa' | 'rainviewer' | null, chosen, lat, lon,
  //     place, country, reason }
  // Automatic is NOAA for a home Home Assistant places in the US, RainViewer
  // for one it places elsewhere. Another zone's country is not known (no
  // lookup is made), so Automatic there asks for a provider (reason
  // 'choose'); so does a home with no country set. A zone that is gone:
  // 'zone'. No location at all: 'location'.
  function radarPlan(client) {
    var r = radarNative(), cfg = (client && client.config) || {}, states = (client && client.states) || {};
    var out = { enabled: r.enabled, provider: null, chosen: r.provider, lat: null, lon: null,
                place: 'Home', country: null, reason: null, settings: r };
    if (r.center === 'zone') {
      var z = r.zone && states[r.zone], za = (z && z.attributes) || {};
      out.place = za.friendly_name || (r.zone ? r.zone.replace(/^zone\./, '').replace(/_/g, ' ') : 'Zone');
      if (!z || typeof za.latitude !== 'number' || typeof za.longitude !== 'number') { out.reason = 'zone'; }
      else { out.lat = za.latitude; out.lon = za.longitude; }
    } else {
      if (typeof cfg.latitude === 'number' && typeof cfg.longitude === 'number') { out.lat = cfg.latitude; out.lon = cfg.longitude; }
      else out.reason = 'location';
      out.country = cfg.country || null;
    }
    if (r.provider !== 'auto') out.provider = r.provider;
    else if (out.country) out.provider = out.country === 'US' ? 'noaa' : 'rainviewer';
    else if (!out.reason) out.reason = 'choose';
    return out;
  }

  // The weather entity: the chosen one -- even if it is missing, so a broken
  // choice shows as '--' rather than silently reading another -- or, when
  // nothing is chosen, the first weather entity in the house.
  function weatherId(states) {
    var id = get('weather.entity');
    if (id) return id;
    var ids = Object.keys(states || {}).filter(function (k) { return k.indexOf('weather.') === 0; });
    ids.sort();
    return ids[0] || null;
  }

  // THE CALENDARS: the chosen ones, in their order, that exist -- or, when
  // none is chosen, every calendar in the house, A to Z. And each one's
  // colour: its own, else the next of CAL_COLORS by its place in the list.
  var CAL_COLORS = ['orange', 'green', 'purple', 'blue', 'pink', 'yellow', 'teal', 'red', 'mint', 'white'];
  function calendarIds(states) {
    var mine = get('calendar.entities') || [];
    if (mine.length) return mine.filter(function (id) { return !!st(states, id); });
    return Object.keys(states || {}).filter(function (k) { return k.indexOf('calendar.') === 0; }).sort();
  }
  function calendarColor(id, states) {
    var own = (get('calendar.colors') || {})[id];
    if (own) return own;
    var i = calendarIds(states).indexOf(id);
    return CAL_COLORS[(i < 0 ? 0 : i) % CAL_COLORS.length];
  }

  // AN EVENT'S COLOR (2026-10-16): its own, picked on its sheet (by its
  // series' uid, else its title); else the first keyword in its title
  // (Configure -> Calendars -> Colors by Keyword); else its calendar's
  function eventKey(title, uid) {
    return uid ? 'uid:' + uid : 'title:' + String(title || '').trim().toLowerCase();
  }
  function keywordColor(title) {
    var t = String(title || '').toLowerCase();
    var hit = (get('calendar.keywords') || []).filter(function (k) {
      var w = String(k.word || '').trim().toLowerCase();
      if (!w) return false;
      // a whole word (Doctor, not "doctorate"), any case
      var re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
      return re.test(t);
    })[0];
    return hit ? hit.color : null;
  }
  function eventColor(cal, title, uid, states) {
    var own = (get('calendar.event_colors') || {})[eventKey(title, uid)];
    return own || keywordColor(title) || calendarColor(cal, states);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // { time: 'HH:MM', date: 'YYYY-MM-DD' } from the Time & Date sensors when
  // they exist, else from this screen's own clock.
  function clock(states) {
    var t = st(states, get('clock.time')), d = st(states, get('clock.date'));
    var now = new Date();
    return {
      time: t ? t.state : pad(now.getHours()) + ':' + pad(now.getMinutes()),
      date: d ? d.state : now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
    };
  }

  // 0 new, 0.5 full, back to 1. The chosen sensor, else the synodic month
  // counted from a known new moon (6 January 2000, 18:14 UTC) -- continuous, and
  // good to well under a percent.
  function moon(states, when) {
    var s = st(states, get('sky.moon'));
    if (s) {
      var v = Number(s.state);
      return isFinite(v) ? v : 0.5;
    }
    if (get('sky.moon')) return 0.5;       // chosen but missing: full
    var syn = 29.530588853 * 86400000;
    var ref = Date.UTC(2000, 0, 6, 18, 14);
    var f = (((when || new Date()).getTime() - ref) / syn) % 1;
    return f < 0 ? f + 1 : f;
  }

  // The holiday SEASON the sky dresses for: the chosen sensor's state, else
  // the same windows computed from the date -- Halloween Sep 22..Oct 31,
  // Thanksgiving Nov 1..Thanksgiving Day, Christmas the day after..Dec 25.
  function seasonName(states, when) {
    var id = get('sky.holidays');
    if (id) {
      var h = st(states, id);
      return ((h && h.state) || '').trim();
    }
    var d = when || new Date();
    // Christmas is tested before Thanksgiving, so a house that moves
    // Christmas into November wins it.
    var order = ['halloween', 'christmas', 'thanksgiving'];
    for (var i = 0; i < order.length; i++) {
      if (skyWindow(order[i], d).inside) {
        return order[i].charAt(0).toUpperCase() + order[i].slice(1);
      }
    }
    return '';
  }

  // ------------------------------------------------------ the sky calendar
  // WHEN each sky theme may run (Configure -> Seasonal sky -> Season dates /
  // Surprise dates). Every date is MM-DD and empty means built in:
  var BUILT_IN = {
    halloween: ['09-22', '10-31'], thanksgiving: ['11-01', 'thanksgiving'],
    // The garland stays out of early December: the decoration is eligible
    // for the last 18 days, which is what 12-07 is.
    christmas: ['12-07', '12-25'],
    july4: ['06-28', '07-04'], valentines: ['02-08', '02-14'],
    spring: ['03-20', '06-20'], winter: ['12-21', '03-19']
  };
  // The southern hemisphere's spring and winter are six months on.
  var SOUTH = { spring: ['09-22', '12-20'], winter: ['06-21', '09-21'] };

  function usThanksgiving(y) {
    var nov1 = new Date(y, 10, 1);
    return new Date(y, 10, 1 + (4 - nov1.getDay() + 7) % 7 + 21);   // 4th Thursday
  }
  function mmdd(v) {
    var m = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || '').trim());
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
  // The date `v` names, in year y ('thanksgiving' is US Thanksgiving).
  function onYear(v, y) {
    if (v === 'thanksgiving') return usThanksgiving(y);
    var p = mmdd(v);
    return p ? new Date(y, p[0] - 1, p[1]) : null;
  }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function between(a, b) { return Math.round((day0(b) - day0(a)) / 86400000); }

  // skyWindow('halloween', date) -> {inside, daysToEnd, length, from, to}
  //   inside     the date is within the window (a window may wrap the new
  //              year: 12-20 .. 01-05);
  //   daysToEnd  whole days to the window's last day (0 on it);
  //   length     whole days from its first day to its last.
  function skyWindow(theme, when) {
    var d = day0(when || new Date());
    var south = get('sky.hemisphere', 'north') === 'south';
    var dflt = (south && SOUTH[theme]) || BUILT_IN[theme];
    var from = get('sky.' + theme + '_from') || dflt[0];
    var to = get('sky.' + theme + '_to') || dflt[1];
    var y = d.getFullYear();
    // The window that contains d starts this year or last (a wrapping one);
    // its end is the first `to` on or after that start.
    var cands = [y, y - 1];
    for (var i = 0; i < cands.length; i++) {
      var start = onYear(from, cands[i]);
      if (!start) break;
      var end = onYear(to, cands[i]);
      if (!end) break;
      if (end < start) end = onYear(to, cands[i] + 1);
      if (d >= start && d <= end) {
        return { inside: true, daysToEnd: between(d, end), length: between(start, end),
                 from: start, to: end };
      }
    }
    return { inside: false, daysToEnd: -1, length: 0 };
  }

  // How often: a season 'every_day' | 'sometimes' | 'near_end'; spring and
  // winter 'often' | 'sometimes' | 'rarely'; storybook and space night, days
  // a month. Empty is the built-in 'sometimes' / once a month.
  function often(key, dflt) { return get('sky.' + key) || dflt; }

  // Is seasonal decoration allowed? The integration's own switch (Seasonal
  // decorations, stored as sky.decorations) must be on, and so must the
  // optional extra entity when one is chosen -- only an explicit 'off' of
  // that one says no.
  function seasonalOn(states) {
    if (!skyLook().decorations) return false;
    var g = st(states, get('sky.seasonal'));
    return !(g && g.state === 'off');
  }

  // THE UNIT A READING IS IN, for its label -- never assumed (never a fixed
  // "mph" or "°F" whatever the house measures in): a sensor's own
  // unit_of_measurement, else the weather entity's attribute for it
  // (wind_speed_unit, temperature_unit), else `fallback`.
  function unit(stateObj, attr, fallback) {
    var a = (stateObj && stateObj.attributes) || {};
    return a.unit_of_measurement || (attr && a[attr]) || fallback;
  }

  // May this sky theme run? Configure -> Seasonal sky -> Themes.
  function themeOn(id) {
    var t = get('sky.themes');
    return !Array.isArray(t) || t.indexOf(id) !== -1;
  }

  // The look from the cached copy, before any card draws.
  applyLook();
  // ...and again on moving to another dashboard, whose look may be its own.
  // The glass layer and the chips hear of it as they hear of any setting.
  // Compared as the look AND its amounts: two dashboards can share a look and
  // differ in how strong it is (each Screen's own Blur / Frost), and comparing
  // the name alone kept the first one's strength on the second.
  // ...and Flat's colors where they are: a page whose resolve differs
  // (or whose Match Accent tint follows the page's own highlight) repaints
  // on arriving, never one that stays the same
  function flatSig() {
    if (!rendering().flat) return '';
    var f = flatColors();
    return f.accent.value + '/' + f.off_tint.value + (f.accent.value === 'auto' && f.off_tint.value === 'accent' ? '/' + f.keys.join(',') : '');
  }
  function lookKey() { return glass() + '|' + rendering().theme + '|' + amount('blur') + '|' + amount('frost') + '|' + amount('tint') + '|' + tintWell() + '|' + frostTint() + '|' + flatSig(); }
  var lookNow = lookKey();
  function onNav() {
    var g = lookKey();
    if (g === lookNow) return;
    lookNow = g;
    applyLook();
    listeners.slice().forEach(function (fn) {
      try { fn(cur); } catch (e) { console.error('[hk-settings] listener', e); }
    });
    announce();
  }
  try {
    window.hkShell.onNavigate(onNav);
    window.addEventListener('popstate', onNav);
  } catch (e) { /* no window events (a test harness) */ }

  // IS THIS PAGE A LOVELACE PANEL? Read off the host's panel list (the shell
  // answers) -- a property, not a walk of the document. null while the host
  // is not up yet (treat as "maybe"),
  // else true/false. The sky, the view fade, the icon repair and the camera
  // poster ask this rather than walk every shadow root on the page, which
  // would cost as much on Settings and Logs as on a dashboard.
  function lovelacePanel() { return window.hkShell.isDashboard(); }

  // WHICH WALL TABLET THIS IS (1.14, docs/Wall-Tablets.md). A tablet is
  // its own item, apart from the screen it runs, so the page needs to know
  // which one it is:
  //   1. ?hk_tablet=<id> in its address (the kiosk app's start URL),
  //      remembered here once seen -- Home Assistant's navigation drops the
  //      query, and a kiosk's reload may be of another page. ?hk_tablet=none
  //      forgets it: this browser is no tablet.
  //   2. Else the tablet signed in as this user (the one on this screen
  //      first).
  //   3. Else none: a desk, a phone -- no screensaver, no idle return.
  // A server from before 1.14 sends no tablets: the screen's Tablet User,
  // as it was. The answer: {id, name, screen, room, user, app, idle_return,
  // idle_time, black_screen, screensaver_switch, black_switch} or null.
  var TABLET_KEY = 'hk-tablet';
  function rememberTablet() {
    try {
      var m = /[?&]hk_tablet=([a-z0-9_]+)/.exec(String(location.search || ''));
      if (!m) return;
      if (m[1] === 'none') localStorage.removeItem(TABLET_KEY);
      else localStorage.setItem(TABLET_KEY, m[1]);
    } catch (e) { /* no storage (a private window, a test harness) */ }
  }
  rememberTablet();
  function rememberedTablet() {
    try { return localStorage.getItem(TABLET_KEY) || ''; } catch (e) { return ''; }
  }
  function userName(client) {
    try {
      var HC = window.hkHostClient;
      var h = client || (HC && HC.current ? HC.current() : null);
      return (h && h.user && h.user.name) || '';
    } catch (e) { return ''; }
  }
  function tabletOf(id, t) {
    var out = { id: id };
    Object.keys(t).forEach(function (k) { out[k] = t[k]; });
    return out;
  }
  function tablet(client) {
    var items = cur.tablet_items, seg = '';
    try { seg = String(location.pathname).split('/')[1] || ''; } catch (e) { /* a test harness */ }
    var name = userName(client);
    if (!items) {
      // a server from before 1.14: this screen's own Tablet User
      var b = cur.boards && cur.boards[seg];
      if (!b || !b.tablet_user || b.tablet_user !== name) return null;
      return { id: seg, name: seg, screen: seg, room: b.idle_room || '', user: b.tablet_user, app: '',
               idle_return: !!b.idle_return, idle_time: null, black_screen: b.black_screen || 'kiosk',
               screensaver_switch: b.screensaver_switch || null, black_switch: b.black_switch || null, legacy: true };
    }
    var id = rememberedTablet();
    if (id && items[id]) return tabletOf(id, items[id]);
    if (!name) return null;
    var mine = Object.keys(items).filter(function (k) { return items[k] && items[k].user === name; });
    mine.sort(function (a, b2) { return (items[a].screen === seg ? 0 : 1) - (items[b2].screen === seg ? 0 : 1); });
    return mine.length ? tabletOf(mine[0], items[mine[0]]) : null;
  }
  // A PAGE THAT LOOKS LIKE A WALL TABLET'S and isn't one: told to the
  // integration once a load, so Wall Tablets can suggest it. Only Fully
  // Kiosk's browser says what it is (its JavaScript interface, `fully`).
  var seenSent = false;
  function reportSeen(client) {
    if (seenSent || !state.live || !cur.tablet_items) return;
    var app = '';
    try { app = (typeof window.fully === 'object' && window.fully) ? 'fully' : ''; } catch (e) { app = ''; }
    if (!app || tablet(client)) { seenSent = !!app; return; }
    seenSent = true;
    try {
      var seg = String(location.pathname).split('/')[1] || '';
      // a write: through the client's action port (refused in Mantel)
      var act = (window.hkClient && window.hkClient.is(client) ? client : window.hkHostClient.from(client)).actions;
      act.callWS({ type: 'hk_frontend/tablet/seen', screen: /^[a-z0-9_-]{0,80}$/.test(seg) ? seg : '', app: app })
        .catch(function () { /* an older server */ });
    } catch (e) { /* no connection yet */ }
  }

  window.hkSettings = {
    get: get,
    // which wall tablet this page is (null: none) -- see tablet() above
    tablet: tablet,
    reportSeen: reportSeen,
    lovelacePanel: lovelacePanel,
    get version() { return state.version; },
    get live() { return state.live; },
    // Whether the integration has a config entry (null until it answers).
    get configured() { return state.configured; },
    // Resolves once the integration's own answer is in -- or after `ms`, on
    // the cached copy or the defaults. For code that runs ONCE (the generated
    // dashboard) and so cannot simply redraw when the answer arrives.
    whenLive: function (ms) {
      if (state.live) return Promise.resolve(true);
      return new Promise(function (resolve) {
        var done = false;
        var finish = function (v) { if (!done) { done = true; resolve(v); } };
        waiting.push(function () { finish(true); });
        setTimeout(function () { finish(false); }, ms || 3000);
      });
    },
    subscribe: subscribe,
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    appearance: appearance, rendering: rendering, refreshLook: applyLook,
    glass: glass,
    frostTint: frostTint,
    // the Frosted plate with `wash` ([r, g, b]) in place of its gray, at this
    // screen's Frost amount (hk-frosttint.js)
    frostPlate: function (wash) { return frost(amount('frost'), wash); },
    skyLook: skyLook,
    pageSky: pageSky,
    flatBackground: flatBackground,
    flatColors: flatColors, resolveFlatColors: resolveFlatColors, viewKeys: function () { return viewKeys().keys; },
    pageBackdrop: pageBackdrop,
    pagePhoto: pagePhoto,
    photoLook: photoLook,
    pageLook: pageLook,
    pageLandscape: pageLandscape,
    landscapeList: landscapeList,
    landscapeFile: landscapeFile,
    BLACK: BLACK,
    skyPalettes: function () { return SKY_BACKDROPS; },
    previewGlass: function (mode) {
      glassPreview = LOOKS[mode] ? mode : null;
      applyLook();
      listeners.slice().forEach(function (fn) {
        try { fn(cur); } catch (e) { console.error('[hk-settings] listener', e); }
      });
    },
    weatherId: weatherId,
    weatherPage: weatherPage,
    radarNative: radarNative,
    radarPlan: radarPlan,
    calendarIds: calendarIds,
    calendarColor: calendarColor, eventColor: eventColor, eventKey: eventKey, keywordColor: keywordColor,
    clock: clock,
    moon: moon,
    seasonName: seasonName,
    skyWindow: skyWindow,
    often: often,
    seasonalOn: seasonalOn,
    themeOn: themeOn,
    unit: unit,
    DEFAULTS: DEFAULTS,
    _apply: apply            // tests
  };
  announce();
})();

// THE STRATEGY GUARD. Every generated screen is built by hk-strategy.js, and
// Home Assistant waits only 5 s for it: past that the whole screen is one
// "Error loading the dashboard strategy ... Timeout waiting for strategy
// element" card -- and on a wall tablet, with kiosk mode never applied,
// Home Assistant's own header and sidebar -- until somebody reloads it. The
// strategy mends a LATE arrival itself (recoverLate); this mends the file
// NOT arriving at all (2026-09-29 16:38, the Living Room tablet: a load that
// never ran the file, sitting behind the photo screensaver for an hour).
// This file is the first and smallest of the startup scripts, so it is
// here. Every 3 s it asks one cheap question -- is this page that error? --
// and if so:
//   * the strategy is defined: rebuild the page (it came late);
//   * it is not: load it again at a new address (a failed load is never
//     retried at the same one), then rebuild;
//   * still stuck 20 s later: reload the page, at most once in 2 minutes.
// Each step is written to Home Assistant's log (hk_frontend.screen) with
// what the browser knows about the file's download, so the next one leaves
// evidence.
(function () {
  'use strict';
  var EL = 'll-strategy-dashboard-hk-dashboard';
  var SRC = '/hk/cards/hk-strategy.js';
  var RELOAD_KEY = 'hk-strategy-reloaded';

  // Home Assistant's error page is one view of one markdown card naming
  // the element -- checked without serialising a whole generated dashboard
  function stuck(L) {
    var raw = L && L.rawConfig, s = raw && raw.strategy, c = L && L.config;
    if (!s || s.type !== 'custom:hk-dashboard' || !c || !c.views || c.views.length !== 1) return false;
    var cards = c.views[0] && c.views[0].cards;
    if (!cards || !cards.length) return false;
    try { return JSON.stringify(cards).indexOf(EL) !== -1; } catch (e) { return false; }
  }
  function panel() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
    return window.hkShell.panel();
  }
  function rebuild(p) {
    var root = p ? window.hkShell.dashboard(p) : null;
    (root || p).dispatchEvent(new CustomEvent('config-refresh', { bubbles: true, composed: true }));
    // kiosk mode reads the dashboard's kiosk_mode on a page change: once the
    // rebuilt dashboard is in place, tell it the page changed, or Home
    // Assistant's header stays up (see hk-strategy.js kioskAgain)
    var n = 0;
    var iv = setInterval(function () {
      var q = null;
      try { q = S.panel(); } catch (e) { /* gone */ }
      var built = q && q.lovelace && q.lovelace.config && !stuck(q.lovelace);
      if (built) window.hkShell.announce({ detail: { replace: true } });
      if (built || ++n >= 40) clearInterval(iv);
    }, 250);
  }
  function report(what) {
    var msg = 'HK Frontend: ' + what + ' (' + location.pathname + ')';
    try { console.warn(msg); } catch (e) { /* no console */ }
    try {
      // the host's current client (Home Assistant's root element, as before),
      // through its action port
      var act = currentClient().actions;
      Promise.resolve(act.callService('system_log', 'write', { message: msg, level: 'warning', logger: 'hk_frontend.screen' }))
        .catch(function () { /* not allowed for this user: the console has it */ });
    } catch (e) { /* not connected */ }
  }
  // what the browser recorded about the file (status, time, bytes)
  function download() {
    try {
      var es = performance.getEntriesByType('resource').filter(function (e) { return e.name.indexOf(SRC) !== -1; });
      if (!es.length) return 'never requested';
      var e = es[es.length - 1];
      return 'status ' + (e.responseStatus || '?') + ', ' + Math.round(e.duration) + ' ms, ' +
             (e.transferSize || 0) + ' bytes over the wire, ' + es.length + ' request(s)';
    } catch (x) { return 'no timing'; }
  }
  var S = { since: 0, tries: 0, rebuiltAt: 0,
            load: function (u) { return import(u); }, panel: panel, reload: function () { location.reload(); } };
  function check(now) {
    var p = S.panel();
    if (!stuck(p && p.lovelace)) { S.since = 0; S.tries = 0; return 'ok'; }
    now = now || Date.now();
    if (!S.since) S.since = now;
    if (customElements.get(EL)) {
      if (now - S.rebuiltAt < 10000) return 'rebuilding';      // one rebuild at a time
      S.rebuiltAt = now;
      report('the dashboard strategy arrived after Home Assistant stopped waiting; rebuilt');
      rebuild(p);
      return 'rebuilt';
    }
    if (!S.tries) {
      S.tries = 1;
      var dl = download();
      // the browser keeps a module's failure: asking for the SAME address
      // again hands back the original error -- the evidence -- before the
      // fresh copy is asked for
      S.load(SRC).then(function () { return 'it resolves now'; }, function (err) {
        return 'error: ' + (err && (err.name + ': ' + err.message) || err);
      }).then(function (why) {
        report('the dashboard strategy never loaded (' + dl + '; first load: ' + why + '); loading it again');
      });
      S.load(SRC + '?retry=' + now).then(function () {
        if (customElements.get(EL)) { S.rebuiltAt = Date.now(); rebuild(S.panel()); }
      }, function (err) {
        report('loading the dashboard strategy again failed too: ' + (err && err.message || err));
      });
      return 'retrying';
    }
    if (now - S.since < 20000) return 'waiting';
    // the last reload is remembered across it (this tab's session): with no
    // storage there is no way to bound it, so no reload at all -- a loop of
    // reloads would be worse than the error page
    var last = 0;
    try { last = +sessionStorage.getItem(RELOAD_KEY) || 0; } catch (e) { return 'no storage'; }
    if (last && now - last < 120000) return 'held';
    try { sessionStorage.setItem(RELOAD_KEY, String(now)); } catch (e) { return 'no storage'; }
    report('the dashboard strategy still did not load; reloading the page');
    S.reload();
    return 'reloaded';
  }
  // a guard must never be the thing that throws: any page, any moment
  setInterval(function () {
    try { if (!document.hidden) check(); } catch (e) { /* not a Home Assistant page */ }
  }, 3000);
  window.hkStrategyGuard = { stuck: stuck, check: check, _: S };
})();
