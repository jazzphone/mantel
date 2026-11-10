// hk-settings-tables.js - the tables and small helpers the pages draw from: colors, the sidebar's lists, option pages, entity pools.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-tables'] = function (KIT) {
    var K;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      K = s.K;
    });

    var PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="2"/></svg>';
    var BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var TICK = '<svg viewBox="0 0 13 13" aria-hidden="true"><path d="M2 7l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    // Apple's system colors for the sidebar's tiles
    // the pages that keep a tone of their own in Flat: the Glass looks'
    // own-color pages, and Calendar and Weather (hk-base.js FLAT_OWN)
    // Highlight Color Automatic's swatch: a few of the pages' colors
    var AUTO_ACCENT_TILE = 'conic-gradient(#0a84ff, #ffd60a, #40c8e0, #bf5af2, #30d158, #ff375f, #0a84ff)';
    // a page key's address (hk-strategy.js SKY_PAGE, turned around)
    var FLAT_VIEW = { music: 'playmusic', live_tv: 'live-tv', doors_windows: 'doors-windows' };
    var FLAT_OWN = { cameras: 1, live_tv: 1, security: 1, doors_windows: 1, climate: 1, lights: 1, timers: 1,
                     vacuums: 1, music: 1, water: 1, energy: 1, calendar: 1, weather: 1, power: 1 };
    // a landscape's file name (settings.py SKY_LANDSCAPE_FILE): a name, never a path
    var LAND_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$/i;
    // TILE STYLE's few words, under the Style group it sits in (Appearance)
    var TILE_FOOT = 'Tile Style: Centered puts the icon above the name, as on HomeView; Automatic uses it on a Home Grid of square cells.';
    var C = { blue: '#007aff', green: '#34c759', indigo: '#5856d6', orange: '#ff9500', pink: '#ff2d55', purple: '#af52de',
              red: '#ff3b30', teal: '#30b0c7', yellow: '#ffcc00', gray: '#8e8e93', cyan: '#32ade6', brown: '#a2845e' };
    var HOUSE = [
      // (What Counts, Status & Chips before it, is each type's page under
      // Accessories since 2026-10-13. General, Weather, Calendar, Cameras and
      // Status Rows went to Pages on 2026-10-16: their addresses forward,
      // M.routeForward)
      // (Sky / Background is under Appearance since 2026-10-29: #/house/sky
      // forwards, M.routeForward)
      ['appearance', 'Appearance', 'mdi:palette', C.indigo],
      // THE ORDER (2026-10-30 tidy-up): how screens look, how you move around,
      // what sits beside the page, what happens when idle, then the lists and
      // the devices -- a screen's own page follows the same order
      ['menu', 'Menu', 'mdi:dock-left', C.orange],
      // THE PAGES SCREEN (Phase J, 2026-10-30): every screen's that doesn't
      // choose its own
      ['pagesscreen', 'Pages Screen', 'mdi:view-grid', C.purple],
      // THE SIDE PANE (2026-10-30): one pane per screen beside the page and in
      // the screensaver, of the sections each picks. Its own icon, not the
      // Menu's dock-left
      ['sidepane', 'Side Pane', 'mdi:format-list-bulleted-type', C.teal],
      // NOW PLAYING (2026-10-15): where the music playing shows -- a side pane
      // or the bar -- on every screen that doesn't choose its own
      ['nowplaying', 'Now Playing', 'mdi:music', C.pink],
      // SCREENSAVER (2026-10-13): its own entry -- what every screen's
      // screensaver shows; was Wall Tablets -> Screensaver (that address forwards)
      ['screensaver', 'Screensaver', 'mdi:image-multiple', C.cyan],
      // NOTIFICATIONS (the feature's, 2026-10-16): about every screen, so here
      // rather than under Pages -- its pages keep #/features/notify/...
      ['notify', 'Notifications', 'mdi:bell-badge', C.red, null, 'features/notify'],
      ['chips', 'Status Chips', 'mdi:label-multiple', C.green],
      ['rooms', 'Rooms', 'mdi:sofa', C.brown],
      ['tablets', 'Wall Tablets', 'mdi:tablet', C.blue]
    ];
    // Category pages with an order of their own (accessories.py PAGE_ORDERS):
    // [title, icon, what automatic is].
    var PAGE_ORDERS = { vacuums: ['Vacuums', 'mdi:robot-vacuum', 'A to Z'],
                        security: ['Security', 'mdi:lock', 'locks A to Z, then garage doors'] };
    // WHAT A PAGE'S SETTINGS PAGE SAYS UNDER ITS NAME: what else uses them,
    // where the page's settings reach beyond it (the plan's mitigation)
    var PAGE_SCOPE = {
      weather: 'The Weather page’s settings — also the header’s clock strip, the screensaver’s forecast and Climate’s Outside & Ahead.',
      calendar: 'The Calendar page’s settings — also the screensaver’s calendar pane.',
      cameras: 'The Cameras page’s settings — also every screen’s camera strip on Home that doesn’t choose its own.',
      energy: 'The Energy page, built from Home Assistant’s Energy settings: the feature, its devices and the page.',
      power: 'The Power page: the home’s battery, solar and circuits as one picture. Energy’s second page.',
      music: 'Whole-home music through Music Assistant, and the Music page’s Browse side.',
      live_tv: 'Needs an HDHomeRun tuner: its channels, live on every screen.',
      security: 'The Security page, the security system and its keypad.'
    };
    var LIBRARY = [['accessories', 'Accessories', 'mdi:lightbulb-group', C.yellow], ['popups', 'Pop-ups', 'mdi:bell-ring', C.red],
                   ['pages', 'Custom Pages', 'mdi:file-document-multiple', C.teal], ['chips', 'Custom Chips', 'mdi:label-variant', C.orange]];
    var SYSTEM = [['advanced', 'Advanced', 'mdi:cog', C.gray], ['check', 'Setup Check', 'mdi:clipboard-check', C.green]];
    // THE PRODUCT'S NAME, Home Assistant's own things and places, and the
    // documentation, as the host says them (web/client/hk-host-shell.js): HK
    // Frontend and its wiki in Home Assistant, the host's own elsewhere.
    // Labels only.
    function PN() { return window.hkShell.productName(); }
    function haName(name) { return window.hkShell.haName(name); }
    function haPlace(path) { return window.hkShell.haPlace(path); }
    // a link to a page of the documentation, opened beside these settings, or
    // null where the host has no such page
    function docsLink(page, anchor, o) {
      var url = window.hkShell.docsUrl(page, anchor);
      if (!url) return null;
      // HK Frontend's wiki on GitHub; a host's own docs (a path of its own) are its docs
      var row = K.nav(Object.assign({ label: /^https?:/.test(url) ? 'On the Wiki' : 'In the Docs', icon: 'mdi:open-in-new', href: url }, o));
      var a = row.tagName === 'A' ? row : row.querySelector && row.querySelector('a');
      if (a) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      return row;
    }
    // SLEEP SCREEN'S LISTS (sleep_rules.py): each a page of entities, as many
    // as the house has. `quiet`: its own may also work in quiet hours.
    var SLEEP_LISTS = {
      presence: { title: 'Presence', key: 'presence',
        help: 'Somebody is in the room while any of these is on — motion, occupancy, a radar, a watch’s room — and for the Linger time after the last one clears. With none, the room always counts as occupied.' },
      lit: { title: 'Only While Lit', key: 'lit', domains: ['light', 'switch'],
        help: 'Somebody walking in wakes the tablet only while one of these is on, so a dark room stays dark at night. A tap always works.' },
      quiet: { title: 'Quiet While', key: 'quiet_while',
        help: 'Quiet hours while any of these is on (a Good Night or nap timer), as well as by the schedule: the tablet stays dark, and only a tap, or what is allowed in quiet hours under Hold While and Wake For, changes that.' },
      reset: { title: 'Sleep Until Re-entered', key: 'reset',
        help: 'Turning one of these on darkens the tablet even with somebody still in the room; it wakes again when somebody comes back in. A tap still lights it. (Good Night.)' },
      dark: { title: 'Stay Dark While', key: 'dark_while',
        help: 'Dark while any of these is on (away mode). Wake For, Hold While and Keep Awake While still come first.' },
      awake: { title: 'Keep Awake While', key: 'awake_while',
        help: 'The dashboard stays up while any of these is on — watching TV on it, say, with no touch to keep it in use.' },
      hold: { title: 'Hold While', key: 'hold_while', quiet: true,
        help: 'Left exactly as it is while any of these is on: an automation of yours owns the tablet then (the doorbell’s pop-up, the alarm).' },
      wake: { title: 'Wake For', key: 'wake_for', quiet: true,
        help: 'Wakes to the dashboard, and stays up, while any of these is on (smoke, a leak).' },
      night: { title: 'Night While', key: 'night_while',
        help: 'The night brightness while any of these is on (a Good Night or nap timer) — whatever the clock says. Day While still wins.' },
      day: { title: 'Day While', key: 'day_while',
        help: 'The day brightness while any of these is on, even at night — the bathroom’s lights turned up bright, say.' },
      // MORE WHEN NEAR (2026-10-30, rule 9a): never the tablet's own camera
      near: { title: 'Near the Screen', key: 'near', domains: ['binary_sensor', 'sensor'],
        help: 'Somebody is near the screen while one of these sees them: an mmWave sensor’s zone in front of the tablet, or a distance sensor reading under Closer Than. Then the dashboard comes up before a touch; with nobody near and no touch for Back to the Screensaver, the photos return. The tablet’s own camera is never used.' }
    };
    // THE THIRD-PARTY CARDS' OPTIONS: the handful people change, as controls
    // (an empty YAML box does not say what it wants), each showing the tuned value until changed (hk-strategy.js
    // wallpanel(), kiosk_mode, the Weather page's radar card). A control writes
    // one key of the same options mapping the YAML page edits; set back to the
    // tuned value, the key goes. Everything else: Options in YAML.
    var MIN = function (n) { return n < 60 ? n + ' Seconds' : n === 60 ? '1 Minute' : n < 3600 ? (n / 60) + ' Minutes' : '1 Hour'; };
    var OPTION_PAGES = {
      wallpanel: {
        title: 'Screensaver Options', docs: 'https://github.com/j-a-n/lovelace-wallpanel',
        footer: 'The photos come from Screensaver Photos (All Screens → Screensaver). The clock, the weather, what’s playing and running timers show over them.',
        example: 'idle_time: 300\ndisplay_time: 20\nimage_animation_ken_burns_zoom: 1.2',
        yamlHelp: 'Everything set on the Screensaver Options page, and any other WallPanel option, as YAML. Empty is the tuned screensaver. Set a key to null to remove it from the tuned setup. Changing enabled, profiles or screensaver_entity unhooks it from the tablet’s user and the sky.',
        groups: [
          { header: 'Timing', rows: [
            { key: 'idle_time', label: 'Starts After', type: 'select', num: true, def: 180,
              options: [60, 120, 180, 300, 600, 900, 1800].map(function (n) { return [n, MIN(n)]; }) },
            { key: 'display_time', label: 'Each Photo For', type: 'select', num: true, def: 30,
              options: [10, 20, 30, 60, 120, 300].map(function (n) { return [n, MIN(n)]; }) }] },
          { header: 'Photos', rows: [
            { key: 'media_order', label: 'Order', type: 'seg', def: 'random', options: [['random', 'Random'], ['sorted', 'In Order']] },
            { key: 'image_animation_ken_burns', label: 'Slow Zoom', type: 'switch', def: true },
            { key: 'image_fit_landscape', label: 'Fill the Screen', sub: 'Off: the whole photo, with room around it.', type: 'switch',
              def: 'cover', on: 'cover', off: 'contain' }] }]
      },
      kiosk: {
        title: 'Kiosk Mode Options', docs: 'https://github.com/NemesisRE/kiosk-mode',
        footer: 'Whatever is hidden, the menu’s Home Assistant section still reaches Home Assistant (Show Menu opens its sidebar).',
        example: 'admin_settings:\n  hide_header: false',
        yamlHelp: 'Everything set on the Kiosk Mode Options page, and any other Kiosk Mode option, as YAML. Empty is the tuned setup: the header and the sidebar hidden. Set a key to null to remove it.',
        groups: [{ rows: [
          { key: 'hide_header', label: 'Hide Header', type: 'switch', def: true },
          { key: 'hide_sidebar', label: 'Hide Sidebar', type: 'switch', def: true },
          { label: 'Show Header for Admins', type: 'switch', fk: 'admin_header',
            get: function (cur) { return !!(cur.admin_settings && cur.admin_settings.hide_header === false); },
            set: function (cur, v) {
              var a = Object.assign({}, cur.admin_settings || {});
              if (v) a.hide_header = false; else delete a.hide_header;
              if (Object.keys(a).length) cur.admin_settings = a; else delete cur.admin_settings;
              return cur;
            } }] }]
      }
    };
    function optGet(r, cur) {
      if (r.get) return r.get(cur);
      var v = cur[r.key] === undefined ? r.def : cur[r.key];
      if (r.type === 'switch' && r.on !== undefined) return v === r.on;
      return v === undefined ? '' : v;
    }
    function optSet(r, cur, v) {
      var next = JSON.parse(JSON.stringify(cur || {}));
      if (r.set) return r.set(next, v);
      if (r.type === 'switch' && r.on !== undefined) v = v ? r.on : r.off;
      if (r.num && v !== '') v = Number(v);
      if (v === r.def || ((r.def === undefined) && (v === '' || v === null))) delete next[r.key];
      else next[r.key] = v;
      return next;
    }
    var TILE_DOMAINS = /^(light|switch|fan|cover|lock|media_player|climate|vacuum|valve|humidifier|water_heater|alarm_control_panel|input_boolean|timer|camera)\./;
    var CHIP_POOL = /^(sensor|binary_sensor|input_boolean|input_number|input_select|input_text|switch|light|fan|lock|cover|climate|media_player|timer|counter|person|device_tracker|weather|alarm_control_panel|vacuum|valve|water_heater|humidifier|select|number|update|event)\./;
    var FAV_POOL = /^(light|switch|fan|cover|lock|climate|media_player|alarm_control_panel|vacuum|valve|water_heater|humidifier|input_boolean|scene|script)\./;
    var SCENE_POOL = /^(scene|script|input_button|button)\./;

    // what the shell and the later parts use of this one
    KIT.AUTO_ACCENT_TILE = AUTO_ACCENT_TILE; KIT.BACK = BACK; KIT.C = C; KIT.CHIP_POOL = CHIP_POOL;
    KIT.docsLink = docsLink; KIT.FAV_POOL = FAV_POOL; KIT.FLAT_OWN = FLAT_OWN; KIT.FLAT_VIEW = FLAT_VIEW;
    KIT.haName = haName; KIT.haPlace = haPlace; KIT.HOUSE = HOUSE; KIT.LAND_FILE = LAND_FILE; KIT.LIBRARY = LIBRARY;
    KIT.MIN = MIN; KIT.optGet = optGet; KIT.OPTION_PAGES = OPTION_PAGES; KIT.optSet = optSet;
    KIT.PAGE_ORDERS = PAGE_ORDERS; KIT.PAGE_SCOPE = PAGE_SCOPE; KIT.PENCIL = PENCIL; KIT.PN = PN;
    KIT.SCENE_POOL = SCENE_POOL; KIT.SLEEP_LISTS = SLEEP_LISTS; KIT.SYSTEM = SYSTEM; KIT.TICK = TICK;
    KIT.TILE_DOMAINS = TILE_DOMAINS; KIT.TILE_FOOT = TILE_FOOT;
  };
})();
