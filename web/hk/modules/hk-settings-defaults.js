// hk-settings-defaults.js - the first-paint copy of the settings' DEFAULTS, for hk-settings.js.
//
// The mirror of settings.py DEFAULTS that hk-settings.js merges the server's answer (or the copy the last answer left
// in localStorage) over: pure data, moved out of hk-settings.js in phase 24 so that file is under
// its size limit. tests/py/test_settings.py holds it to settings.py, key for key.
//
// A PLAIN SCRIPT THAT RUNS BEFORE hk-settings.js, SYNCHRONOUSLY, in every host (a split part would arrive a round trip
// late, and 83 files read window.hkSettings the moment they load): web/home.js and web/shim/settings-page.js import
// it first; HK Frontend's boot.py lists it in CORE, which the boot file runs in order before it imports hk-settings.js;
// the jsc suites' tests/run loads it in their prelude. It only assigns window.hkSettingsDefaults (globalThis), which hk-settings.js
// reads as `DEFAULTS` (and hands out as hkSettings.DEFAULTS).
// @ts-check
(function () {
  'use strict';
  // (globalThis, not window: the jsc suites load this before tests/dom.js makes a window of their global; in a page
  // they are the same object)
  var G = /** @type {any} */ (globalThis);
  if (G.hkSettingsDefaults) return;

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
      vacuums: { show: true, counters: null, water_tank: true, water_clear: 24 }
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
           // WALLPAPER (2026-10-30): which one (hk-wallpapers.js) and when its
           // night version shows -- 'auto' after sunset, 'day', 'night'
           // (settings.py sky.wallpaper)
           wallpaper: 'ribbons', wallpaper_night: 'auto', wallpaper_motion: 'off',
           // ...and a motion theme's colour (2026-10-31; settings.py
           // WALLPAPER_COLORS, or '#rrggbb')
           wallpaper_color: 'rose',
           // each page's background: {page: 'own' | 'live' | backdrop id |
           // 'photo'} -- a page missing is Automatic (settings.py sky.pages);
           // a page's own photo, for 'photo': page_photos
           pages: {}, page_photos: {}, page_looks: {},
           // FLAT'S OWN (settings.py FLAT_BACKGROUNDS): its background, color,
           // how far a photo fades (0-100) and each page's
           flat_background: 'color', flat_color: 'auto', flat_fade: 50, flat_pages: {}, flat_tint: 'none', flat_tint_amount: 60, flat_tint_light: 50, flat_image_look: {}, flat_page_image_looks: {},
             image_look: {},
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
    features: { vacuum_script: null, alarm_bad_code: null, laundry: [], laundry_clear: 4, tv_sets: [], tv_apps: [], tv_show: 'recent', tv_icons: true, thermostats: [], temperature: null, power: null,
                house_timers: [], timer_sound: 'bell', timer_ring_for: 60, timer_tablet: true, timer_speaker: true, timer_also: [], timer_phone: '', timer_volume: 40, timer_wake: true,
                  timer_include: [], timer_ignore: [] },
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
            // the rail in a phone's side strip (hk-tabbar.js, 2026-10-30)
            bar_strip: true,
            // Swipe Between Pages (hk-pageswipe.js, 2026-10-30): auto -- where
            // a tab bar shows; a screen's swipe_pages, when set, is its own
            swipe_pages: 'auto',
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
    look: { flat: false, flat_theme: 'dark', glass: 'clear', frost: 50, blur: 50, tint: 50, bright: 50, bright_dim: 0, well: 'dark', frost_tint: false, tile_style: 'auto', tile_icons: 'auto',
      thermostat_style: 'dial', bright_pages: 'home', details: true, browse_view: 'music-browse', sky_switch: null,
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
                     clock_over: 'corner', clock_style: 'classic', clock_bg: 'gradient', clock_motion: 'slow', clock_wallpaper: 'aurora', clock_wallpaper_color: 'blue', clock_24: false,
                       clock_today_music: true, clock_today_weather: true, clock_colors: {}, clock_speed: 35, clock_depth: 50, clock_night: 'off', clock_night_from: '22:00', clock_night_to: '07:00',
                     photo_layout: 'single', mosaic_count: 3, mosaic_gap: 'thin', mosaic_change: 'one', mosaic_line: 0, mosaic_color: 'black', mosaic_random: false, mosaic_every: 10,
                     clock_photo_soft: false, clock_photo_dim: 35, clock_text_shadow: 40, clock_text_outline: 0,
                     energy_slide: false, extra_music: false, extra_forecast: false, extra_every: 5, extra_for: 30, energy_hide: [],
                     weather_slide: false, weather_hide: [], corner_time_size: 100, corner_hide: [], music_hide: [],
                     // the HomeView-style faces (settings.py, 2026-10-30)
                     forecast_layout: 'classic', photo_titles: false, time_behind: false, day_look: 'auto',
                     // Big Weather's number, Time Behind's size, place and darkening (settings.py, 2026-10-31)
                     forecast_big: 'temp', tb_size: 24, tb_top: 6, tb_dim: 0,
                     // Big Weather's time planted in the meadow (settings.py, 2026-11-01)
                     forecast_planted: true,
                     // the Screensaver editor's layout (settings.py, 2026-11-01)
                     layout: null, designs: [], active_design: '', clock_options: {},
                     // the Holiday slide (settings.py, phase 20)
                     timer_slide: true, timer_often: 'more', holiday_slide: false, holiday_pick: 'next', holiday_one: 'christmas', holiday_days: 60, holiday_off: [], holiday_own: [],
                       holiday_fx: 'full', holiday_outdoors: [], holiday_hide: [] } },
    // The Calendar page and the screensaver's calendar pane (All Screens ->
    // Calendar): the calendars shown, in order (empty: every calendar), and
    // each one's colour (a page pill colour)
    calendar: { entities: [], colors: {}, keywords: [], event_colors: {} },
    // NOW PLAYING's place (All Screens -> Now Playing; a screen's np_* keys
    // over it): a side pane or the bar on tablets & computers, the bar's
    // place there and on phones (hk-base.js nowPlaying)
    now_playing: { style: 'bar', side: 'right', bar: 'bottom', bar_phone: 'bottom', grace: 30 },
    // THE SIDE PANE (2026-10-30; settings.py side_pane, hk-sidepane.js):
    // where it goes, the Dashboard's and the screensaver's sections, the doorbell
    side_pane: { side: 'right', width: 'standard',
                 dashboard: { show: 'off', sections: [{ kind: 'weather' }, { kind: 'calendar' }, { kind: 'now_playing', when: 'active' }] },
                 saver: { show: 'off', sections: [{ kind: 'clock', size: 'tiny' }, { kind: 'calendar' }, { kind: 'now_playing', size: 'less', when: 'active' }] },
                 doorbell: true, headings: true, dim: 'glass' },
    // Browse Music (HK Settings -> Features -> Music). The Discover rows arrive as
    // the queries themselves (settings.py discover_rows); these are its
    // default five.
    browse: { hide: [], discover: [
      { key: 'recently_played', title: 'Recently played', media_type: 'track', order_by: 'last_played_desc' },
      { key: 'favourite_playlists', title: 'Favorite playlists', media_type: 'playlist', favorite: true },
      { key: 'most_played', title: 'Most played', media_type: 'album', order_by: 'play_count_desc' },
      { key: 'recently_added', title: 'Recently added', media_type: 'album', order_by: 'timestamp_added_desc' },
      { key: 'favourite_radio', title: 'Favorite radio', media_type: 'radio', favorite: true }
    ] },
    // THE PAGES SCREEN (settings.py PAGES_SCREEN_DEFAULTS, Phase J): All
    // Screens'; a screen's own fields over it (pagesScreen())
    pages_screen: { show: 'off', icons: 'menu', rooms: 'folder', widgets: [], pill: 'auto', clock: 'off' }
  };

  G.hkSettingsDefaults = DEFAULTS;
})();
