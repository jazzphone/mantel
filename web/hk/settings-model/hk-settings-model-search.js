// hk-settings-model-search.js - search.
//
// PART OF THE SETTINGS MODEL (hk-settings-model.js). Not a card and not run on its own: it registers one
// function, which hk-settings-model.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSettingsModelParts = window.hkSettingsModelParts || {})['hk-settings-model-search'] = function (K) {
    var BG_LABELS = K.BG_LABELS, choiceLabel = K.choiceLabel;

    // ------------------------------------------------------------ search
    // Every setting the page has, where it is, and words people might use.
    // `screen: true` rows are on every screen's page.
    var SEARCH = [
      // (a screen's menu on each device is at the top of its Menu since 2026-10-30)
      ['Menu', 'screen/menu', 'menu', 'menu settings tablets computers sidebar drawer navigation off button always open docked tab bar', true],
      ['Menu on Phones', 'screen/menu', 'menu_phone', 'phone phones menu chip button tab bar off', true],
      ['Back Button & Title', 'house/menu/header', 'menu.page_header', 'page header back title context navigation compact hide'],
      ['Back Button & Title', 'screen', 'page_header', 'page header back title context navigation compact hide', true],
      ['Menu Options', 'screen', 'menu_own', 'menu settings same as all screens own menu this screen side menu edge tab tab bar', true],
      ['Swipe Between Pages', 'screen/menu', 'swipe_pages', 'swipe gesture next previous page sideways tab bar homeview same as all screens', true],
      ['Swipe Right on Home', 'screen/menu', 'swipe_left', 'swipe right home left page before home favorite music now playing gesture', true],
      ['Menu on Each Screen', 'house/menu', 'menu:screens', 'menu each screen tablets phones which kind button tab bar always open'],
      ['Side Menu', 'house/menu/side', 'menu:side', 'side menu drawer button always open docked used by'],
      ['Edge Tab', 'house/menu/edge-tab', 'menu:edge-tab', 'edge tab position size used by'],
      ['Pages in Menu', 'screen/menu-pages', 'categories', 'categories menu list', true],
      ['Page Headers', 'screen/page-headers', 'headers', 'page header off this screen hide header water valve timers quick start', true],
      ['Tab Bar', 'house/menu/tab-bar', 'menu:tab-bar', 'tab bar bottom bar floating ios navigation dock tabs more rooms position size used by'],
      ['Home Page', 'screen/pages', 'home_page', 'only these pages standalone energy panel security cameras climate no home', true],
      ['Home', 'screen/pages', 'home_view', 'home page custom first page car generated', true],
      ['Rooms in Menu', 'screen/rooms', 'menu_rooms', 'a to z order', true],
      ['Status Chips', 'screen/chips', 'chips', 'chip row only when active quiet intercom talk microphone', true],
      ['Status Chips (All Screens)', 'house/chips', 'chips:all', 'chips chip row every screen always when active quiet conditional'],
      ['Cameras', 'screen/cameras', 'cameras', 'camera strip live camera same as all screens order', true],
      ['Live Camera Follows', 'screen/cameras/live', 'camera_live', 'live camera follows motion person detection dropdown input select automation', true],
      ['Live First Camera', 'screen/cameras', 'camera_live_video', 'camera strip live video snapshot first tile performance', true],
      ['Scenes', 'screen/scenes', 'scenes', 'scene pills row intercom talk microphone', true],
      ['Favorites', 'screen/favorites', 'favorites', 'favourites', true],
      ['Rooms', 'screen/rooms', 'rooms_custom', 'room order home rooms on pages same as all screens', true],
      ['Pages on This Screen', 'screen/pages', 'pages', 'category pages custom pages which pages', true],
      ['Pages Screen', 'screen/pages-screen', 'pages_screen', 'pages screen home screen app icons grid launcher homeview ipad widgets folder pill no tab bar swipe', true],
      ['Pages Screen (All Screens)', 'house/pagesscreen', 'pages_screen.show', 'pages screen home screen app icons grid launcher homeview ipad widgets folder pill'],
      ['Glass', 'screen/glass', 'glass', 'look blur frosted clear', true],
      ['Live Sky', 'screen/sky', 'sky', 'background animated on off', true],
      ['Background', 'screen/sky', 'sky_look', 'backdrop animations weather decorations palette own look', true],
      ['Liveliness', 'screen/sky', 'sky_liveliness', 'liveliness subtle classic festive party custom busy calm moving bats leaves each occasion', true],
      ['Calm When Nobody\u2019s Around', 'screen/sky', 'sky_calm_empty', 'empty room nobody occupancy motion presence calm quiet', true],
      ['Home Assistant Header & Sidebar', 'screen', 'kiosk', 'kiosk mode hide', true],
      ['Allow Pop-ups', 'screen', 'popups', 'answer doorbell alarm popup', true],
      ['Allow Notifications', 'screen', 'notify', 'notifications banner alerts', true],
      ['Notifications on the Screensaver', 'screen', 'notify_saver', 'notifications screensaver photos important', true],
      ['Do Not Disturb', 'screen', 'notify_dnd', 'notifications quiet hours dnd silence schedule input boolean timer', true],
      ['Car Browser', 'screen', 'car', 'tesla viewport', true],
      ['Rename Screen', 'screen', 'rename', 'rename name title dashboard sidebar pencil', true],
      ['Now Playing', 'screen', 'now_playing', 'music media bar pane player', true],
      ['Now Playing Options', 'screen', 'np_options', 'music media bar pane same as all screens own player', true],
      ['Now Playing Placement', 'screen/nowplaying', 'np_style', 'music media bar pane side left right top bottom phones player show as', true],
      ['Now Playing Bar Position', 'screen/nowplaying', 'np_bar', 'music media bar top bottom position player tablets computers', true],
      ['Now Playing Bar on Phones', 'screen/nowplaying', 'np_bar_phone', 'music media bar top bottom position player phones', true],
      ['Timer Bar', 'screen', 'timer_bar', 'timers quick timer bar countdown docked bottom', true],
      ['On Every Page', 'screen', 'bar_all_pages', 'now playing timer bar every page all pages everywhere', true],
      ['Screensaver', 'screen', 'screensaver', 'photo screensaver photos wall tablet slideshow clock glance idle', true],
      ['Screensaver Options', 'screen/screensaver', 'screensaver_options', 'photo timing starts after each photo order random slideshow', true],
      ['Screensaver for All Screens', 'house/screensaver', 'look.saver', 'screensaver all screens global default every tablet'],
      ['Same as All Screens (Screensaver)', 'screen/screensaver', 'saver:house', 'screensaver all screens own global', true],
      ['Screensaver Shows', 'screen/screensaver', 'saver:show', 'screensaver forecast weather photos no photos landscape', true],
      ['Forecast When There Are No Photos', 'screen/screensaver', 'saver:fallback', 'screensaver forecast fallback empty folder dark', true],
      ['Forecast Details (Screensaver)', 'screen/screensaver', 'saver:band', 'screensaver forecast band days hours multi-day details bottom', true],
      ['Forecast Slide', 'screen/screensaver', 'saver:slide_forecast', 'screensaver forecast slide between photos mix both', true],
      ['Music Slide', 'screen/screensaver', 'saver:music_slide', 'screensaver music now playing album art full screen slide song next previous', true],
      ['Music First', 'screen/screensaver', 'saver:music_first', 'screensaver music first priority playing full screen instead of photos forecast', true],
      ['Slide Every', 'screen/screensaver', 'saver:forecast_every', 'screensaver slide every photos how often forecast music', true],
      ['Slow Zoom', 'screen/screensaver', 'saver:zoom', 'screensaver photo zoom ken burns', true],
      ['Over the Photos', 'screen/screensaver', 'saver:clock', 'screensaver clock weather now playing music timers', true],
      ['Calendar Pane', 'screen/sidepane', 'pane:saver:show', 'screensaver calendar events agenda pane right side upcoming today tomorrow days', true],
      ['Music Pane', 'screen/sidepane', 'pane:saver:show', 'screensaver music pane right side now playing album art song next previous', true],
      ['Home Status', 'screen/screensaver', 'saver:status', 'screensaver security secured locks doors alarm top right', true],
      ['Screensaver Switch', 'screen/screensaver', 'saver:ent:switch', 'screensaver photo switch automation entity turn on off bedtime doorbell', true],
      ['Screen In Use', 'screen/screensaver', 'saver:ent:binary_sensor', 'in use touched tablet binary sensor automation window starts after timer', true],
      ['Use WallPanel Instead', 'screen/screensaver', 'b:screensaver_engine', 'wallpanel hacs screensaver', true],
      ['Your Own Dashboards', 'advanced', 'yaml-ref', 'yaml reference own dashboard hand written raw configuration snippets examples copy'],
      ['Hide Header & Sidebar', 'screen/kiosk', 'kiosk', 'kiosk hide header sidebar what is hidden admins', true],
      ['Hide Header', 'screen/kiosk', 'kiosk_header', 'kiosk header toolbar top bar title views', true],
      ['Hide Sidebar', 'screen/kiosk', 'kiosk_sidebar', 'kiosk sidebar drawer', true],
      ['For Admins Too', 'screen/kiosk', 'kiosk_admins', 'kiosk header sidebar admin administrators', true],
      ['Use the Kiosk Mode Plugin Instead', 'screen/kiosk', 'kiosk_engine', 'kiosk mode plugin hacs', true],
      ['Kiosk Mode Options', 'screen/kiosk-mode', 'kiosk_options', 'kiosk mode plugin yaml header sidebar admins', true],
      ['Alarm Panel', 'page/security', 'security.alarm', 'security keypad'],
      ['Indoor Temperature', 'screen/chips/climate', 'features.temperature', 'climate chip reading', true],
      ['Power Use', 'screen/chips/energy', 'features.power', 'energy chip watts reading', true],
      ['House Timers', 'page/timers/house', 'features.house_timers', 'nap bedtime timers page'],
        ['Which Timers', 'page/timers/which', 'features.timer_include', 'ignored ignore timers screensaver slide ring show automation'],
      ['Accessory Types', 'accessories', 'counts',
        'what counts status & chips status and chips types kinds smoke carbon monoxide co alarm lights fans doors windows locks blinds leaks thermostats timers vacuums speakers scenes routines ' +
        'input buttons count chips'],
      ['Weather Service', 'page/weather', 'weather.entity', 'forecast'],
      ['Place', 'page/weather', 'weather.place', 'location label'],
      ['Weather Sensors', 'page/weather/sensors', 'weather.sensors', 'feels like humidity wind gust uv forecast alerts outside temperature'],
      ['Forecast & Details', 'page/weather/forecast', 'weather.page', 'weather page hourly daily days hours wind sunrise uv humidity moon pressure details tiles current conditions alerts order'],
      ['Default Hourly View', 'page/weather/forecast', 'weather.page.hourly_metric', 'weather hourly temperature rain wind chart'],
      ['Animate Page Loading', 'page/weather', 'weather.page.load_animation', 'weather page entrance animation fade motion'],
      ['Radar Map', 'page/weather/radar', 'weather.radar_native', 'weather radar map precipitation noaa rainviewer openstreetmap zone location provider'],
      ['Show Radar', 'page/weather/radar', 'weather.radar_native.enabled', 'weather radar on off map'],
      ['Check Radar Connection', 'page/weather/radar', 'weather.radar_native.check', 'weather radar test connection provider latest'],
      ['Radar Advanced', 'page/weather/radar/advanced', 'weather.radar_native.advanced', 'weather radar zoom marker history playback speed play on open autoplay interaction opacity controls'],
      ['Weather Radar Card Options', 'page/weather/radar/yaml', 'weather.radar', 'weather radar card hacs legacy yaml old options'],
      ['Hide Now Playing After a Pause', 'house/nowplaying', 'now_playing.grace', 'music paused stopped stays seconds minute hide bar pane screensaver timeout'],
      ['Now Playing for All Screens', 'house/nowplaying', 'now_playing.style', 'music media bar pane side left right top bottom phones player all screens'],
      ['Calendars', 'page/calendar', 'calendar.entities', 'calendar page events agenda month week day which calendars order'],
      ['Calendar Colors', 'page/calendar', 'calendar.colors', 'calendar colour color events dot'],
      ['Colors by Keyword', 'page/calendar', 'calendar.keywords', 'calendar event color colour keyword word name auto'],
      ['Appearance Style', 'house/appearance/glass', 'look.glass', 'flat light dark theme performance blur frosted tinted clear glass look apple home app solid opaque'],
      ['Blur Mode', 'house/appearance/glass', 'look.glass', 'blur shared layer pre-rendered prerendered each card performance cpu gpu'],
      ['Frost Amount', 'house/appearance', 'look.frost', 'frosted'],
      ['Blur Amount', 'house/appearance', 'look.blur', 'blur strength'],
      ['Darkness', 'house/appearance', 'look.tint', 'tinted dark darkness opacity see through'],
      ['Icon Circles', 'house/appearance', 'look.well', 'tinted icon circle well dark light'],
      ['HK Detail Sheets', 'accessories', 'look.details', 'more info dialog sheet tap accessory'],
      ['Page Pills', 'house/appearance/pills', 'look.page_pills', 'page pill scenes row name icon color colour play music cameras calendar live tv'],
      ['Sky Switch', 'house/appearance/sky', 'look.sky_switch', 'live sky helper'],
      ['Animations', 'house/appearance/sky', 'sky.animations', 'sky moving clouds seasons'],
      ['Weather', 'house/appearance/sky', 'sky.weather', 'sky clouds rain snow fog'],
      ['Rain & Snow', 'house/appearance/sky', 'sky.precipitation', 'sky rain snow falling precipitation weather performance'],
      ['Pause When Not in Focus', 'house/appearance/sky', 'sky.focus_pause', 'pause idle focus background window computer animations performance cpu'],
      ['Live First Camera', 'page/cameras', 'cameras.live', 'camera strip live video snapshot first tile performance'],
      ['Page Backgrounds', 'house/appearance/sky', 'sky.pages', 'page color background backdrop energy climate lights still live sky'],
      ['Background', 'house/appearance/sky', 'sky.background',
        'background live sky color solid gradient photo picture wallpaper image upload still no stars plain black motion moving animated theme aurora blobs waves dots beams meteors'],
      ['Landscapes', 'house/appearance/sky', 'sky.background', 'landscapes landscape photos mountains lakes coasts forests nature scenery background scenic wake interval change'],
      ['Background Photo', 'house/appearance/sky', 'sky.photo', 'photo picture wallpaper image upload background blur dim darken saturation tint color cast'],
      ['Sky Colors', 'house/appearance/sky/backdrop', 'sky.gradient', 'backdrop palette gradient live sky colors tint dusk midnight fjord dune graphite plum ember mist black custom'],
      ['Seasonal Decorations', 'house/appearance/sky', 'sky.decorations', 'holiday halloween christmas old new woodland style'],
      ['Decoration Style', 'house/appearance/sky', 'sky.decoration_style', 'old new seasons holidays birthdays woodland'],
      ['Moving Things', 'house/appearance/sky', 'sky.moving', 'front behind over cards rain snow leaves bats birds flyby confetti sky layer'],
      ['Clouds', 'house/appearance/sky', 'sky.cloud_style', 'clouds classic realistic photographic weather sky'],
      ['Daytime Sky', 'house/appearance/sky', 'sky.daytime', 'brightness bright dark deep natural balanced blue midday day sky'],
      ['Night Sky', 'house/appearance/sky', 'sky.liveliness:night', 'stars shooting stars meteors twinkling screensaver night liveliness'],
      ['Liveliness', 'house/appearance/sky', 'sky.liveliness_all',
        'liveliness lively busy calm bats geese leaves petals fireflies snow sleigh witch owl how many how often subtle classic festive party custom each occasion'],
      ['Woodland Between Occasions', 'house/appearance/sky/woodland', 'sky.woodland', 'spring summer autumn fall winter woodland seasons scenery new decorations'],
      ['Birthdays', 'house/appearance/sky/birthday', 'sky.birthdays', 'balloons'],
      ['Hemisphere', 'house/appearance/sky/advanced', 'sky.hemisphere', 'southern northern'],
      ['Moon Phase Sensor', 'house/appearance/sky/advanced', 'sky.moon', ''],
      ['Holiday Season Sensor', 'house/appearance/sky/advanced', 'sky.holidays', 'calendar'],
      ['Menu Button Icon', 'house/menu/side', 'menu.glyph', 'glyph sidebar lines hamburger side menu'],
      ['Tap Clock to Open Menu', 'house/menu/side', 'menu.clock', 'side menu'],
      ['Swipe from Left Edge', 'house/menu/side', 'menu.swipe', 'menu gesture swipe drag edge open no button side menu'],
      ['Swipe Between Pages', 'house/menu', 'menu.swipe_pages', 'swipe gesture next previous page sideways tab bar homeview'],
      ['Accent Color', 'house/appearance/accent', 'menu.accent', 'highlight color colour accent tint orange icons selected page menu flat'],
      ['Highlight Color', 'house/appearance/accent', 'menu.accent', 'menu color colour accent tint orange icons selected page highlight'],
      ['Button Style', 'house/menu/side/tablets', 'menu.style', 'menu chip tab edge pinned tablet side menu'],
      ['Button Style on Phones', 'house/menu/side/phones', 'menu.button_phone', 'menu chip tab edge phone iphone android side menu'],
      ['Tab Position', 'house/menu/edge-tab', 'menu.tab_at', 'edge tab height level with date from top'],
      ['Tab Size', 'house/menu/edge-tab', 'menu.tab_size', 'edge tab menu bigger larger touch target tablet'],
      ['Tab Size on Phones', 'house/menu/edge-tab', 'menu.tab_size_phone', 'edge tab menu bigger larger touch target phone iphone'],
      ['Keep Open Down To', 'house/menu/side', 'menu.open_min', 'menu fold width docked always open side menu'],
      ['Time & Weather in Menu', 'house/menu/side', 'menu.time_weather_at', 'clock header always open side menu'],
      ['While Scrolling', 'house/menu/tab-bar', 'menu.bar_scroll', 'tab bar shrink hide stay scroll auto hide tablet'],
      ['Rooms in Tab Bar', 'house/menu/tab-bar', 'menu.bar_rooms', 'tab bar rooms more button sheet round tablet'],
      ['Rooms in Tab Bar on Phones', 'house/menu/tab-bar', 'menu.bar_rooms_phone', 'tab bar rooms more button sheet round phone iphone'],
      ['More Style', 'house/menu/tab-bar', 'menu.bar_more', 'tab bar more icons list grid sheet tablet'],
      ['While Scrolling on Phones', 'house/menu/tab-bar', 'menu.bar_scroll_phone', 'tab bar phone shrink hide stay always shown scroll'],
      ['Adjust Content', 'house/menu/tab-bar', 'menu.bar_adjust', 'tab bar adjust content make room move page float over overlap padding'],
      ['Start Small', 'house/menu/tab-bar', 'menu.bar_start', 'tab bar start small shrunk folded rest collapsed button'],
      ['Shrinks To', 'house/menu/tab-bar', 'menu.bar_fold', 'tab bar shrink fold small button corner left right top bottom side'],
      ['Tab Bar Size', 'house/menu/tab-bar', 'menu.bar_size', 'tab bar size small medium large bigger thicker icons text'],
      ['Tab Bar Labels', 'house/menu/tab-bar', 'menu.bar_labels', 'tab bar labels names icons only text slim'],
      ['Use the Side Strip', 'house/menu/tab-bar', 'menu.bar_strip', 'tab bar side strip iphone duo camera status bar rail edge safe area'],
      ['Tabs in Bar', 'house/menu/tab-bar', 'menu.bar_tabs', 'tab bar how many tabs number count favorites bottom top'],
      ['Tabs in Rail', 'house/menu/tab-bar', 'menu.bar_tabs_rail', 'tab bar rail how many tabs number count favorites left right side'],
      ['Tabs in Bar on Phones', 'house/menu/tab-bar', 'menu.bar_tabs_phone', 'tab bar phone iphone how many tabs number count favorites bottom'],
      ['Tab Bar Position', 'house/menu/tab-bar', 'menu.bar_pos', 'tab bar position top bottom left right rail side placement'],
      ['More Style on Phones', 'house/menu/tab-bar', 'menu.bar_more_phone', 'tab bar more icons list grid sheet phone iphone'],
      ['Tab Bar Glass', 'house/appearance', 'menu.bar_glass', 'tab bar blur frosted tinted clear transparency look appearance'],
      ['Home Assistant Section Placement', 'house/menu/side', 'menu.ha_at', 'home assistant section where top categories rooms bottom order position place'],
      ['Home Assistant Section', 'house/menu/side', 'menu.ha_row', 'sidebar settings access integrations automations notifications profile show menu'],
      ['Rooms in the Menu', 'house/rooms', 'rooms.menu', 'rooms in the menu order which rooms a to z side menu tab bar more'],
      ['Rooms', 'house/rooms', 'rooms.order', 'rooms all screens settings scenes'],
      ['Cameras', 'page/cameras', 'cameras.order', 'camera order which cameras strip cameras page room pages all screens'],
      ['Pause Cameras When Not in Focus', 'page/cameras', 'cameras.focus_pause', 'pause cameras focus background window computer live video performance cpu'],
      ['Room Order', 'house/rooms/order', 'rooms.order', 'rooms on home order which rooms'],
      ['Rooms in Menu', 'house/rooms', 'rooms.menu', 'a to z order menu rooms'],
      ['Rooms on Pages', 'house/rooms', 'rooms.pages', 'by floor room order lights climate'],
      ['Room Headings Open Room Pages', 'house/rooms', 'rooms.headings', 'room page link'],
          ['Room Status Row', 'house/rooms/status', 'rooms.status', 'room page temperature humidity security tv lights speaker order'],
      ['Climate Status Row', 'page/climate/status', 'status_rows.climate', 'temperature humidity ranges blinds fans room exclusions'],
      ['Lights Status Row', 'page/lights/status', 'status_rows.lights', 'lights outlets on'],
      ['Doors & Windows Status Row', 'page/doors_windows/status', 'status_rows.doors_windows', 'doors windows motion occupancy occupied'],
      ['Water Status Row', 'page/water/status', 'status_rows.water', 'leak valve sprinkler running'],
      ['Security Status Row', 'page/security/status', 'status_rows.security', 'alarm security system locks garage doors windows leak'],
      ['Climate Header', 'page/climate', 'headers.climate', 'header heating cooling runtime weather outside forecast thermostats counted'],
      ['Lights Header', 'page/lights', 'headers.lights', 'header lighting through the day left on empty rooms tonight automations schedule'],
      ['Water Header', 'page/water', 'headers.water', 'header water through the day usage meter main supply valve shut off'],
      ['Timers Header', 'page/timers', 'headers.timers', 'header finishing order quick start durations presets names create a timer'],
      ['Vacuums Header', 'page/vacuums', 'headers.vacuums', 'header cleaning by day last runs mission counters successful failed canceled'],
      ['Vacuums Status Row', 'page/vacuums/status', 'status_rows.vacuums', 'vacuums cleaning docked battery'],
      ['Timers Status Row', 'page/timers/status', 'status_rows.timers', 'timers running'],
      ['Security Header', 'page/security', 'headers.security', 'header your home house labels front door back door garage activity device care battery'],
      ['Music Browse Categories', 'features/music/categories', 'browse.hide', 'artists albums songs playlists radio podcasts audiobooks'],
      ['Discover Rows', 'features/music/discover', 'browse.discover', 'recently played favorites most played'],
      ['Browse Page', 'page/music', 'look.browse_view', 'music browse view'],
      ['Idle Time (All Tablets)', 'house/tablets', 'tablets.idle_time', 'wall tablet idle seconds return to home when idle timeout'],
      ['Return to Home When Idle', 'house/tablets', 'tablets.idle_return', 'wall tablet idle return home timeout'],
      ['Add Tablet', 'house/tablets/add', 'tablet:add', 'wall tablet add new kiosk satellite fully kiosk wallpanel browser'],
      ['Tablet Alerts', 'house/tablets', 'tablets.alert_offline', 'wall tablet offline alert notification charging restart came back'],
      ['Scheduled Restart', 'house/tablets', 'tablets.restart', 'wall tablet restart reboot nightly clear cache maintenance'],
      ['Reload All Tablets', 'house/tablets', 'tablets:reload', 'wall tablet reload clear cache all at once update'],
      ['Screensaver Photos', 'house/screensaver', 'look.photos', 'media folder wallpanel photos'],
      ['Hidden Accessories', 'accessories/hidden', 'generated.exclude', 'hidden from screens leave out left out hide rooms devices remove show on home include in status'],
      ['Added Accessories', 'accessories/added', 'generated.include_entities', 'also shown add entities more extra tiles script scene sensor'],
        ['Helpers', 'accessories/helpers', 'acc:helpers', 'helpers input_boolean toggle input_number number input_select list dropdown counter input_datetime input_text input_button guest mode'],
      ['Also Count As', 'accessories', 'counts', 'what counts chips status rows count include sensor smoke temperature accessory'],
      ['Existing Dashboards', 'add-screen', 'add-screen', 'overview dashboard you already have own hk settings add screen use lovelace default'],
      ['Vacuums Tile Order', 'accessories/type/vacuums/order', 'accessories.pages.vacuums', 'vacuum page order'],
      ['Security Tile Order', 'accessories/type/locks/order', 'accessories.pages.security', 'locks garage door page order'],
      ['Circuits & Meters', 'accessories/type/energy', 'acctype:energy', 'energy circuits meters plugs power devices'],
      ['Camera Accessories', 'accessories/type/cameras', 'acctype:cameras', 'cameras accessories'],
      ['Pop-ups', 'popups', 'popups', 'doorbell alarm hash'],
      ['Custom Pages', 'pages', 'custom_pages', 'yaml page custom'],
      ['Clock Sensors', 'advanced', 'clock.time', 'time date'],
      ['Clean-Areas Script', 'page/vacuums', 'features.vacuum_script', 'vacuum'],
      ['Wrong-Code Indicator', 'page/security', 'features.alarm_bad_code', 'alarm keypad'],
      ['Show in Sidebar', 'advanced', 'sidebar', 'hk settings panel sidebar'],
      ['Files Folder', 'advanced', 'files_folder', 'font sf pro glyphs icons'],
      ['Setup Check', 'check', 'check', 'problems diagnostics'],
      ['Setup Assistant', 'setup', 'setup', 'wizard']
    ];
    // matches for `q`: [{label, route, key, where}] -- a screen setting once
    // per screen (`screens`: [{path, title}])
    function search(q, screens, extra) {
      q = String(q || '').trim().toLowerCase();
      if (!q) return [];
      var words = q.split(/\s+/);
      var hit = function (text) { text = text.toLowerCase(); return words.every(function (w) { return text.indexOf(w) >= 0; }); };
      var out = [];
      SEARCH.forEach(function (s) {
        if (!hit(s[0] + ' ' + s[3])) return;
        if (s[4]) {
          // A SCREEN'S ROWS ARE LABELLED b:<key> on its page AND on every page
          // under it (Menu Settings, Pages, Header & Sidebar...); a key with a
          // prefix of its own (saver:, chips:) is already the row's label. The
          // panel decided this from the route and missed the pages under a
          // screen (nine results opened their page and lit nothing).
          var key = s[2].indexOf(':') < 0 ? 'b:' + s[2] : s[2];
          (screens || []).forEach(function (x) {
            out.push({ label: s[0], route: s[1].replace(/^screen/, 'screens/' + x.path), key: key, where: x.title });
          });
        } else {
          out.push({ label: s[0], route: s[1], key: s[2], where: null });
        }
      });
      (extra || []).forEach(function (e) { if (hit(e.label + ' ' + (e.words || ''))) out.push(e); });
      return out;
    }

    // THE PREVIEW'S SIZE (a screen's page, under its preview). The frame IS
    // that device's size -- the dashboard lays itself out by its own window,
    // so a phone gets the phone layout -- drawn scaled down to the column.
    // Car only where Car Browser is on (tesla-viewport.js zooms that frame
    // as it does the car). hk: glyphs fall back to Material's of the same name.
    // THE SCREENSAVER'S OPTIONS (settings.py SAVER_DEFAULTS): what a screen
    // starts from, and whether it has changed any
    var SAVER_DEFAULTS = { starts_after: 180, each_photo: 30, order: 'random', fill: true, zoom: false,
                           clock: true, weather: true, music: true, timers: true, status: true, show: 'photos', fallback: true, forecast_every: 5,
                           band: true, band_photos: false, calendar: false, calendar_days: 2, music_slide: false, music_pane: false, music_first: false,
                           fade_back: 500,
                           // portrait and landscape photos, each their own (settings.py)
                           portrait_fill: false, portrait_blur: 50, portrait_dim: 20, portrait_zoom: 100, portrait_x: 'center', portrait_y: 'center',
                           landscape_blur: 50, landscape_dim: 20, landscape_zoom: 100, landscape_x: 'center', landscape_y: 'center',
                           // the clocks (settings.py)
                           clock_over: 'corner', clock_style: 'classic', clock_bg: 'gradient', clock_motion: 'slow', clock_wallpaper: 'aurora', clock_wallpaper_color: 'blue', clock_24: false,
                             clock_today_music: true, clock_today_weather: true, clock_colors: {}, clock_speed: 35, clock_depth: 50, clock_night: 'off', clock_night_from: '22:00',
                             clock_night_to: '07:00',
                       photo_layout: 'single', mosaic_count: 3, mosaic_gap: 'thin', mosaic_change: 'one', mosaic_line: 0, mosaic_color: 'black', mosaic_random: false, mosaic_every: 10,
                       clock_photo_soft: false, clock_photo_dim: 35, clock_text_shadow: 40, clock_text_outline: 0,
                       // Home Energy and the additional screens (settings.py, 2026-10-14)
                       energy_slide: false, extra_music: false, extra_forecast: false, extra_every: 5, extra_for: 30, energy_hide: [],
                       weather_slide: false, weather_hide: [], corner_time_size: 100, corner_hide: [], music_hide: [] };
    function saverOptions(o) {
      var out = {};
      Object.keys(SAVER_DEFAULTS).forEach(function (k) {
        out[k] = o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : SAVER_DEFAULTS[k];
      });
      // (one key for Music Full Screen, settings.py's: music_slide is music_first now -- phase 13)
      if (out.music_slide === true) { out.music_first = true; out.music_slide = false; }
      return out;
    }
    // Screensaver catalog; mirrored by hk_core.settings.model.
    var SAVER_SHOWS = [
      ['photos', 'Photos', 'Your photos, one after another.'],
      ['forecast', 'Forecast', 'The forecast over the live sky and the season’s landscape.'],
      ['clock', 'Clock', 'A clock, full screen, over the background you choose.'],
      ['glance', 'Glance', 'The date, a clock, what’s playing and the weather, on a calm color.'],
      ['month', 'Month', 'This month with today circled, and the date drawn large behind it.'],
      ['day', 'Day', 'The weekday and a big date, with HK’s own art for the day: pumpkins at Halloween, a cake on a birthday, the season’s leaves.']];
    var FORECAST_LAYOUTS = [['classic', 'Classic'], ['big', 'Big']];
    var DAY_LOOKS = [['auto', 'By Time of Day'], ['light', 'Light'], ['dark', 'Dark']];
    var FORECAST_BIG = [['temp', 'Temperature'], ['clock', 'Clock']];
    var DESIGN_FACES = [['solar', 'Solar Dial', 'Daylight around an orbital dial'], ['prism', 'Prism', 'Geometric color and sculptural time'],
      ['world', 'World', 'A globe and the time in your chosen cities'], ['hotel', 'Hotel', 'A wall of city clocks'],
      ['terminal', 'Terminal', 'A departure board of city times'], ['atelier', 'Atelier', 'A Roman numeral watch face'],
      ['meridian', 'Meridian', 'A sunburst watch face'], ['markets', 'Markets', 'Your market sensors beside the time'],
      ['brief', 'Daily Brief', 'Headlines from your chosen news sensor'], ['modular', 'Modular', 'Time, weather and a dial in a modular face']];
    // the faces that bring their own ground: the Background behind the clock isn't drawn under them
    var CLOCK_OWN_GROUND = ['liquid', 'giant', 'scattered'].concat(DESIGN_FACES.map(function (x) { return x[0]; }));
    function showName(show) {
      var s = SAVER_SHOWS.filter(function (x) { return x[0] === show; })[0];
      return s ? s[1] : 'Photos';
    }
    // COPY SETTINGS FROM ANOTHER SCREEN: every screen setting is in exactly
    // one group here or in COPY_NEVER (settings.py BOARD_DEFAULTS -- a Python
    // test holds the two together). [key, label, board keys, copied by default]
    // NOW PLAYING'S PLACE (settings.py NP_STYLES, NP_SIDES, NP_BARS)
    var NP_STYLES = [['pane', 'Side Pane'], ['bar', 'Bar']];
    var NP_SIDES = [['right', 'Right'], ['left', 'Left']];
    var NP_BARS = [['bottom', 'Bottom'], ['top', 'Top']];
    var NP_GRACES = [[10, '10 Seconds'], [20, '20 Seconds'], [30, '30 Seconds'], [60, '1 Minute'], [120, '2 Minutes']];
    // a screen's own Now Playing, in a few words (All Screens -> Now Playing)
    function npSummary(b, house) {
      var st = b.np_style || house.style;
      var where = st === 'pane' ? 'Side Pane, ' + choiceLabel(NP_SIDES, b.np_side || house.side)
                                : 'Bar, ' + choiceLabel(NP_BARS, b.np_bar || house.bar);
      return where + (b.np_bar_phone ? ' · Phones ' + choiceLabel(NP_BARS, b.np_bar_phone) : '');
    }
    // ...whether a screen has any of its own (its Now Playing Options row, and
    // its Reset to All Screens there)
    var NP_OWN_KEYS = ['np_style', 'np_side', 'np_bar', 'np_bar_phone'];
    function npOwn(b) { return NP_OWN_KEYS.some(function (k) { return !!(b || {})[k]; }); }
    var COPY_GROUPS = [
      // in the screen page's order (2026-10-09), named as its groups are (2026-10-30)
      // a screen's menu: All Screens', or its own one setting at a time (menu_own)
      ['menu', 'Menu', ['menu', 'menu_own', 'page_header', 'dock_min', 'time_weather', 'ha_row', 'ha_place', 'tab_position', 'tab_size',
                        'tab_size_phone', 'accent', 'glyph', 'clock', 'swipe',
                        'tab_bar_scroll', 'tab_bar_rooms', 'tab_bar_glass', 'tab_bar_more', 'tab_bar_more_phone', 'tab_bar_pos', 'tab_bar_fold', 'tab_bar_start', 'tab_bar_adjust',
                          'tab_bar_scroll_phone', 'tab_bar_tabs',
                        'tab_bar_tabs_rail', 'tab_bar_tabs_phone', 'tab_bar_size', 'tab_bar_labels', 'tab_bar_strip', 'menu_phone', 'button_phone', 'tab_bar_rooms_phone',
                        'swipe_pages', 'swipe_left'], true],
      ['home', 'Home Page', ['chips_row', 'chips', 'chips_quiet', 'chips_extra', 'chips_custom', 'chips_custom_show'], true],
      ['grid', 'Home Grid Layout', ['home_style', 'home_grid'], false],   // as Copy Layout To… copies it (2026-11-10, the owner)
      // a screen's rooms: All Screens' or its own (rooms_custom)
      ['rooms', 'Rooms', ['rooms_custom', 'room_order', 'home_rooms', 'menu_rooms', 'page_rooms'], true],
      // a screen's cameras: All Screens' or its own (cameras_custom)
      ['cameras', 'Cameras', ['camera_strip', 'cameras_custom', 'cameras', 'camera_live', 'camera_live_video'], true],
      ['scenes', 'Scenes', ['scenes_row', 'scenes', 'scenes_pages'], false],
      ['favorites', 'Favorites', ['favorites'], false],
      ['header', 'Header', ['phone_header', 'kiosk', 'kiosk_header', 'kiosk_sidebar', 'kiosk_admins', 'kiosk_engine', 'kiosk_options'], true],
      // the pages, Home among them, and where each sits in the menu (set on Pages)
      ['pages', 'Pages', ['pages', 'custom_pages', 'only_pages', 'home_page', 'home_view', 'menu_top', 'categories', 'headers', 'pages_screen'], true],
      ['look', 'Appearance', ['flat', 'flat_theme', 'glass', 'frost', 'frost_tint', 'blur', 'tint', 'well', 'tile_style', 'tile_icons', 'bright_pages', 'sky', 'sky_animations', 'sky_weather',
        'sky_precipitation', 'sky_focus_pause',
                              'sky_decorations', 'sky_decoration_style', 'sky_moving', 'sky_cloud_style', 'sky_daytime', 'sky_gradient', 'sky_custom', 'sky_pages',
                              'sky_liveliness', 'sky_liveliness_occ', 'sky_liveliness_custom', 'sky_calm_empty',
                              'sky_background', 'sky_color', 'sky_photo', 'sky_page_photos', 'sky_photo_look', 'sky_page_looks',
                              'sky_landscape', 'sky_landscape_look', 'sky_flat_background', 'sky_flat_color', 'sky_flat_fade', 'sky_flat_tint', 'sky_flat_tint_amount', 'sky_flat_tint_light',
                                'sky_flat_pages', 'sky_flat_image_look', 'sky_flat_page_image_looks', 'sky_image_look',
                              'flat_colors', 'flat_page_colors',
                              // Bright Glass's Strength and the Wallpaper (2026-10-30)
                              'bright', 'bright_dim', 'sky_wallpaper', 'sky_wallpaper_night', 'sky_wallpaper_motion', 'sky_wallpaper_color'], true],
      ['behavior', 'Now Playing, Side Pane, Pop-ups & Notifications', ['popups', 'notify', 'notify_saver', 'notify_dnd', 'now_playing', 'timer_bar', 'bar_all_pages',
                                'np_style', 'np_side', 'np_bar', 'np_bar_phone', 'side_pane'], true],
      ['idle', 'Screensaver', ['screensaver', 'screensaver_options', 'screensaver_engine', 'wallpanel_options'], true],
      ['device', 'This Device', ['car', 'car_layout', 'car_width'], false],
      ['names', 'Accessory Names on This Screen', [], false]   // kept with each accessory: hk-settings-screen.js copyNames()
    ];
    // never copied (1.14: a tablet's own -- its user, room, idle, Sleep Screen
    // and Black Screen -- are the tablet's, not the screen's)
    // a screen's own where and title (settings.py BOARD_OWN) are never copied onto another (a Look's Undo is its own: 2026-10-30)
    var COPY_NEVER = ['where', 'title', 'look_undo'];
    function copyDefaults() { return COPY_GROUPS.filter(function (g) { return g[3]; }).map(function (g) { return g[0]; }); }
    // the changes that copy `groups` of the screen `src` (its settings as read)
    function copyChanges(src, groups) {
      var out = {};
      COPY_GROUPS.forEach(function (g) {
        if (!src || (groups || []).indexOf(g[0]) < 0) return;
        g[2].forEach(function (k) {
          // a screen following All Screens' screensaver: the copy follows too
          if (k === 'screensaver_options') { out[k] = saverFollows(src) ? null : JSON.parse(JSON.stringify(src[k])); return; }
          if (k === 'home_grid' && src[k] == null) return;   // no layout: the Home Style alone, never the other's deleted
          if (src[k] !== undefined) out[k] = src[k] === null ? null : JSON.parse(JSON.stringify(src[k]));
        });
      });
      return out;
    }
    // A SCREEN FOLLOWS ALL SCREENS' SCREENSAVER when its own options are null
    // (a save hands back the stored form) or the feed says so (resolved)
    function saverFollows(b) { return !!b && (b.screensaver_house === true || b.screensaver_options == null); }
    // one line for a nav row: what shows, and when
    // A SCREEN'S Header & Sidebar row: what is hidden, and by whom
    function kioskSummary(b, generated) {
      if (!b || !b.kiosk) return 'Off';
      if (generated && b.kiosk_engine === 'kiosk_mode') return 'Kiosk Mode Plugin';
      var h = b.kiosk_header !== false, sd = b.kiosk_sidebar !== false;
      return h && sd ? 'Both Hidden' : h ? 'Header Hidden' : sd ? 'Sidebar Hidden' : 'Nothing Hidden';
    }
    function saverSummary(o) {
      o = saverOptions(o);
      // what shows, and the slides among it: Photos + Forecast & Music
      // (Music First: the music before them, while it plays)
      var first = o.music_first || (o.show === 'forecast' && o.music_slide);
      // (over the forecast or the clock: its Additional Screens, 2026-10-14)
      var over = o.show === 'forecast' || o.show === 'clock';
      var extra = over
        ? (o.show === 'clock' && o.extra_forecast && o.clock_bg !== 'forecast' && o.clock_bg !== 'skyonly' ? ['Forecast'] : [])
            .concat(o.extra_music && !first && !o.music_slide ? ['Music'] : [], o.show === 'clock' && o.weather_slide ? ['Weather'] : [])
        : (o.show === 'both' ? ['Forecast'] : []).concat(o.music_slide && !first ? ['Music'] : [], o.weather_slide ? ['Weather'] : []);
      if (o.energy_slide) extra.push('Home Energy'); if (o.holiday_slide) extra.push('Holidays');
      var show = (first ? 'Music, Then ' : '') + showName(o.show) + (extra.length ? ' + ' + extra.join(' & ') : '');
      var n = o.starts_after, m = n % 60 ? Math.round(n / 6) / 10 : n / 60;
      var t = n < 60 ? n + ' Seconds' : m + (m === 1 ? ' Minute' : ' Minutes');
      return show + ' · ' + t;
    }
    // HOME ENERGY'S PARTS (settings.py SAVER_ENERGY_PARTS), in their order,
    // and its rings as Home Energy Options' row says them: "Energy, Cost, Water"
    var ENERGY_PARTS = ['cost', 'water', 'solar', 'gas', 'power', 'battery', 'yday', 'month', 'pace'];
    function energyShown(o) {
      var hide = (o && Array.isArray(o.energy_hide)) ? o.energy_hide : [];
      return ['Energy'].concat([['cost', 'Cost'], ['water', 'Water']].filter(function (r) { return hide.indexOf(r[0]) < 0; })
        .map(function (r) { return r[1]; })).join(', ');
    }
    // WEATHER'S PARTS (settings.py SAVER_WEATHER_PARTS), and its readings as
    // Weather Options' row says them: "Temperature, Rain, Wind"
    var WEATHER_PARTS = ['rain', 'wind', 'hours', 'days'];
    function weatherShown(o) {
      var hide = (o && Array.isArray(o.weather_hide)) ? o.weather_hide : [];
      return ['Temperature'].concat([['rain', 'Rain'], ['wind', 'Wind']].filter(function (r) { return hide.indexOf(r[0]) < 0; })
        .map(function (r) { return r[1]; })).join(', ');
    }
    // "a", "a and b", "a, b and c"
    function listText(a) { return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
    function saverCustom(o) {
      var cur = saverOptions(o);
      // (by value: clock_colors and energy_hide are a mapping and a list)
      return Object.keys(SAVER_DEFAULTS).some(function (k) { return JSON.stringify(cur[k]) !== JSON.stringify(SAVER_DEFAULTS[k]); });
    }
    var PREVIEW_SIZES = [
      { key: 'phone', label: 'Phone', w: 390, h: 844, icon: 'hk:cellphone' },
      // rotate: for the tablet glyph as MDI draws it (landscape); hk-settings.js turns the other one when the home's
      // own symbols draw it upright
      { key: 'portrait', label: 'Tablet Portrait', short: 'Portrait', w: 820, h: 1180, icon: 'hk:tablet', rotate: true },
      { key: 'landscape', label: 'Tablet Landscape', short: 'Landscape', w: 1280, h: 800, icon: 'hk:tablet' },
      { key: 'desktop', label: 'Desktop', w: 1440, h: 900, icon: 'hk:monitor' },
      { key: 'car', label: 'Car', w: 804, h: 638, icon: 'hk:car' }
    ];
    function previewSizes(b) {
      return PREVIEW_SIZES.filter(function (z) { return z.key !== 'car' || !!(b && b.car); });
    }
    // the size the screen is used at: a car's browser, a wall tablet (its own
    // user, WallPanel, back to Home when idle), else a desk
    function previewDefault(b) {
      if (!b) return 'desktop';
      if (b.car) return 'car';
      if (b.tablet_user || b.screensaver || b.idle_return) return 'landscape';
      return 'desktop';
    }
    // as wide as the column, no taller than maxH: the scale and the box
    function previewFit(width, maxH, z) {
      var s = Math.min((width || 400) / z.w, (maxH || 560) / z.h);
      return { scale: s, width: z.w * s, height: z.h * s };
    }

    // THE SKY'S PREVIEW (HK Settings -> Sky and each theme's page): which
    // screen shows it -- the house's Home if there is one, else a wall
    // tablet's, else the first screen -- always a generated one with its
    // sky on and a Home page to show it on.
    function skyPreviewScreen(dashboards, boards) {
      boards = boards || {};
      var ok = (dashboards || []).filter(function (d) {
        var b = boards[d.path] || {};
        return d && d.item && d.generated && b.sky !== false && b.home_page !== false;
      });
      var home = ok.filter(function (d) { return /^home$/i.test(String(d.title || '').trim()) || d.path === 'dashboard-home'; })[0];
      var wall = ok.filter(function (d) { var b = boards[d.path] || {}; return b.tablet_user || b.screensaver; })[0];
      return (home || wall || ok[0] || {}).path || null;
    }
    // the moments a theme can be looked at in, and the one it opens on: its
    // most characteristic (Halloween's spooky night, Christmas lights after
    // dark); one moment only -- Space Night, Spring Garden -- needs no row
    var SKY_MOMENTS = {
      halloween: [['day', 'spooky'], 'spooky'], christmas: [['day', 'night'], 'night'],
      'fourth-of-july': [['day', 'night'], 'night'], 'space-night': [['night'], 'night'],
      'spring-garden': [['day'], 'day'], 'storybook-magic': [['day', 'night'], 'night']
    };
    var MOMENT_LABELS = { day: 'Day', night: 'Night', spooky: 'Spooky Night' };
    function skyMoments(id) {
      var m = SKY_MOMENTS[id] || [['day', 'night'], 'day'];
      var keys = id === 'halloween' ? ['day', 'night', 'spooky'] : m[0];
      return { options: keys.map(function (k) { return [k, MOMENT_LABELS[k]]; }), value: m[1] };
    }

    // A SCREEN'S BACKDROP BACK TO ALL SCREENS: its own custom stops go too --
    // unless one of its pages' backgrounds is Custom, whose colors they are
    // (hk-settings.js pageBackdrop): clearing them would turn that page into
    // All Screens' custom colors, or the live sky
    function backdropFollow(b) {
      var pages = (b && b.sky_pages) || {};
      var used = Object.keys(pages).some(function (k) { return pages[k] === 'custom'; });
      return used ? { sky_gradient: null } : { sky_gradient: null, sky_custom: null };
    }
    // Null is a continuing relationship to All Screens, including custom
    // stops. A true flag is still an override, even when it matches the house.
    function skySummary(b) {
      var keys = ['sky_animations', 'sky_weather', 'sky_precipitation', 'sky_focus_pause', 'sky_decorations', 'sky_decoration_style', 'sky_moving', 'sky_cloud_style', 'sky_daytime', 'sky_gradient',
        'sky_custom',
                  'sky_background', 'sky_color', 'sky_photo', 'sky_photo_look', 'sky_landscape', 'sky_landscape_look',
                  'sky_wallpaper', 'sky_wallpaper_night', 'sky_wallpaper_motion', 'sky_wallpaper_color'];
      var pages = Object.keys(b.sky_pages || {}).length;
      if (keys.every(function (k) { return b[k] == null; }) && !pages) return 'Same as All Screens';
      var parts = [];
      // the Background first: a still Color or Photo is the whole look
      if (b.sky_background) parts.push(BG_LABELS[b.sky_background] || b.sky_background);
      if (b.sky_background === 'color' || b.sky_background === 'photo' || b.sky_background === 'landscapes' || b.sky_background === 'wallpaper') return parts.concat(pages ?
        [pages === 1 ? '1 Page Background' : pages + ' Page Backgrounds'] : []).join(', ');
      if (b.sky_animations === false) parts.push('No Animation');
      if (b.sky_weather === false) parts.push('No Weather');
      if (b.sky_precipitation === false) parts.push('No Rain & Snow');
      if (b.sky_focus_pause != null) parts.push(b.sky_focus_pause ? 'Pauses When Not in Focus' : 'Never Pauses');
      if (b.sky_decorations === false) parts.push('No Decorations');
      if (b.sky_decoration_style != null) parts.push(b.sky_decoration_style === 'new' ? 'New Decorations' : 'Old Decorations');
      if (b.sky_moving != null) parts.push(b.sky_moving === 'front' ? 'Moving Things in Front' : 'Moving Things Behind');
      if (b.sky_cloud_style != null) parts.push(b.sky_cloud_style === 'realistic' ? 'Realistic Clouds' : 'Classic Clouds');
      if (b.sky_daytime != null) parts.push({ natural: 'Natural', balanced: 'Balanced', deep: 'Deep' }[b.sky_daytime] + ' Daytime Sky');
      if (b.sky_gradient != null) parts.push('Own Backdrop');
      if (pages) parts.push(pages === 1 ? '1 Page Background' : pages + ' Page Backgrounds');
      return parts.join(', ') || 'Own Settings';
    }

    // what the shell and the later parts use of this one
    K.backdropFollow = backdropFollow; K.CLOCK_OWN_GROUND = CLOCK_OWN_GROUND; K.COPY_GROUPS = COPY_GROUPS;
    K.COPY_NEVER = COPY_NEVER; K.copyChanges = copyChanges; K.copyDefaults = copyDefaults; K.DAY_LOOKS = DAY_LOOKS;
    K.DESIGN_FACES = DESIGN_FACES; K.ENERGY_PARTS = ENERGY_PARTS; K.energyShown = energyShown;
    K.FORECAST_BIG = FORECAST_BIG; K.FORECAST_LAYOUTS = FORECAST_LAYOUTS; K.kioskSummary = kioskSummary;
    K.listText = listText; K.NP_BARS = NP_BARS; K.NP_GRACES = NP_GRACES; K.NP_OWN_KEYS = NP_OWN_KEYS;
    K.NP_SIDES = NP_SIDES; K.NP_STYLES = NP_STYLES; K.npOwn = npOwn; K.npSummary = npSummary;
    K.previewDefault = previewDefault; K.previewFit = previewFit; K.previewSizes = previewSizes;
    K.SAVER_DEFAULTS = SAVER_DEFAULTS; K.SAVER_SHOWS = SAVER_SHOWS; K.saverCustom = saverCustom;
    K.saverFollows = saverFollows; K.saverOptions = saverOptions; K.saverSummary = saverSummary; K.SEARCH = SEARCH;
    K.search = search; K.showName = showName; K.skyMoments = skyMoments; K.skyPreviewScreen = skyPreviewScreen;
    K.skySummary = skySummary; K.WEATHER_PARTS = WEATHER_PARTS; K.weatherShown = weatherShown;
  };
})();
