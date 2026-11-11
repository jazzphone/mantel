// hk-settings-model-words.js - the words.
//
// PART OF THE SETTINGS MODEL (hk-settings-model.js). Not a card and not run on its own: it registers one
// function, which hk-settings-model.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSettingsModelParts = window.hkSettingsModelParts || {})['hk-settings-model-words'] = function (K) {
    var root = K.root;

    // the product's name, and Home Assistant's own things, as the host says
    // them (web/client/hk-host-shell.js): HK Frontend in HA, the host's own elsewhere
    function PN() { return root.hkShell.productName(); }
    function haName(name) { return root.hkShell.haName(name); }

    // ------------------------------------------------------------------ words
    var CHIP_LABELS = {
      weather_alert: 'Weather Alerts', security: 'Security', doors_windows: 'Doors & Windows', climate: 'Climate',
      lights: 'Lights', blinds: 'Blinds', timers: 'Timers', vacuums: 'Vacuums', laundry: 'Laundry', speakers: 'Speakers',
      water: 'Water', energy: 'Energy', intercom: 'Intercom'
    };
    // What each chip counts, and where that is set: Status & Chips kinds, or a
    // single setting (General, Weather).
    var CHIP_SOURCES = {
      weather_alert: { setting: ['page/weather/sensors', 'Weather Alerts Sensor'] },
      security: { kinds: ['locks', 'garage'], setting: ['page/security', 'Alarm Panel'] },
      doors_windows: { kinds: ['doors', 'windows'] },
      climate: { kinds: ['thermostats', 'fans'], setting: ['here', 'Indoor Temperature'] },
      lights: { kinds: ['lights'] }, blinds: { kinds: ['blinds'] }, timers: { kinds: ['timers'] },
      vacuums: { kinds: ['vacuums'] }, laundry: { setting: ['accessories/laundry', 'Laundry'] }, speakers: { kinds: ['speakers'] }, water: { kinds: ['leaks'] },
      energy: { setting: ['here', 'Power Use'] }
    };
    var PAGE_LABELS = {
      weather: 'Weather', calendar: 'Calendar', cameras: 'Cameras', live_tv: 'Live TV', security: 'Security',
      doors_windows: 'Doors & Windows', climate: 'Climate', lights: 'Lights', timers: 'Timers',
      vacuums: 'Vacuums', music: 'Music', browse: 'Browse Music', water: 'Water', energy: 'Energy', power: 'Power', timeline: 'Timeline', rooms: 'Room Pages', intercom: 'Intercom'
    };
    // Each kind: key, name, the detail page’s description, and the list page’s
    // sub-line -- what the kind feeds, in the chips’ and pages’ own words.
    var COUNT_KINDS = [
      ['smoke', 'Smoke & CO',
        'Smoke and carbon monoxide alarms. When one goes off, the Smoke & CO chip appears in red at the start of every screen’s chip row — whatever chips the screen shows. Anything else that ' +
        'should set it off — a gas detector, say — can be added explicitly.', 'The Smoke & CO chip appears first, in red, when one goes off.'],
      ['temperature', 'Temperature', 'Room-related temperature sensors, or a thermostat’s current reading where a room has no related sensor. Other sensors can be added explicitly.',
        'The Climate page’s temperature range.'],
      ['humidity', 'Humidity', 'Room-related humidity sensors, or a thermostat’s current humidity where a room has no related sensor. Other sensors can be added explicitly.',
        'The Climate page’s humidity range.'],
      ['lights', 'Lights', 'Every light. The Lights chip counts the ones that are on.', 'The Lights chip counts the ones that are on.'],
      ['fans', 'Fans', 'Every fan. The Climate chip counts the ones that are on.', 'The Climate chip counts the ones that are on.'],
      ['doors', 'Doors', 'Door contacts. The Doors & Windows chip counts the open ones.', 'The Doors & Windows chip counts the open ones.'],
      ['windows', 'Windows', 'Window contacts. The Doors & Windows chip counts the open ones.', 'The Doors & Windows chip counts the open ones.'],
      ['garage', 'Garage Doors', 'Garage doors and gates: the cover, or a garage-door contact. The Doors & Windows chip counts the open ones.', 'The Doors & Windows chip counts the open ones.'],
      ['locks', 'Locks', 'Every lock. The Security chip counts the unlocked ones.', 'The Security chip counts the unlocked ones.'],
      ['blinds', 'Blinds', 'Blinds, shades, curtains, shutters and awnings. The Blinds chip counts the open ones.', 'The Blinds chip counts the open ones.'],
      ['leaks', 'Leak Sensors', 'Moisture sensors. The Water chip appears when one is wet.', 'The Water chip appears when one is wet.'],
      ['thermostats', 'Thermostats', 'The house’s thermostats. The Climate chip’s glyph follows them.', 'The Climate chip’s glyph follows them.'],
      ['timers', 'Timers', 'Timer helpers. The Timers chip counts the running ones.', 'The Timers chip counts the running ones.'],
      ['vacuums', 'Vacuums', 'Robot vacuums. The Vacuums chip counts the ones cleaning.', 'The Vacuums chip counts the ones cleaning.'],
      ['speakers', 'Speakers', 'Media players that aren’t TVs or receivers (or Music’s rooms, when it’s added). The Speakers chip counts the ones playing.',
        'The Speakers chip counts the ones playing.'],
      ['motion', 'Motion', 'Motion sensors. The status rows of Doors & Windows and Security say which rooms have motion.', 'Doors & Windows’ and Security’s status rows.'],
      ['occupancy', 'Occupancy', 'Occupancy and presence sensors. The status rows say which rooms are occupied.', 'Doors & Windows’ and Security’s status rows.'],
      ['valves', 'Valves', 'Water valves: a sprinkler, the house’s main water. Not gas valves. The Water page lists them and its status row says which are running.',
        'The Water page and its status row.'],
        ['scenes', 'Scenes',
        'Every Home Assistant scene. Add a button or script that works as one — an input_button that runs a routine — and it joins the scene blocks, the rooms’ scene rows and Suggested Scene.',
        'Scene blocks, rooms’ scene rows and Suggested Scene.']
    ];
    // THE SCREENSAVER'S CLOCKS (2026-10-13; hk-saverclock.js STYLES / BGS,
    // settings.py SAVER_CLOCK_STYLES / SAVER_CLOCK_BGS): [id, name, what it is]
    var CLOCK_STYLES = [
      ['today', 'Today', 'The time, the date, the weather and what\u2019s playing, as one'],
      ['classic', 'Classic', 'Huge thin digits, like the lock screen'],
      ['serif', 'Big Serif', 'An editorial italic, like a magazine cover'],
      ['neon', 'Neon', 'Glowing tubes; the colon hums now and then'],
      ['lcd', 'Retro LCD', 'Seven segments on a backlit panel'],
      ['flip', 'Flip', 'Split-flap cards that flip as the minute turns'],
      ['analog', 'Analog', 'A watch face with a sweeping second hand'],
      ['numbers', 'Analog Numbers', 'Numerals round a quiet dial, a slim second hand'],
      ['words', 'Words', '“It is quarter past seven”, in a grid of letters'],
      ['arc', 'Minimal Arc', 'The hour, big; the minutes a ring filling round it'],
      ['nixie', 'Nixie Tubes', 'Orange glow in glass tubes'],
      ['poster', 'Poster', 'Swiss-poster bold, hours over minutes'],
      ['dots', 'Dot Matrix', 'An amber LED departure board'],
      ['ring', 'Day Ring', 'Today as a ring: daylight, night and the sun now'],
      ['glass', 'Glass', 'The time on a frosted pane'],
      ['type', 'Typewriter', 'A sentence, typed out, the cursor blinking']];
    // each face's colors, [id, name] (hk-saverclock.js COLORS: the first is the face's own)
    var CLOCK_COLORS = {
      today: [['auto', 'By Time of Day'], ['blue', 'Blue'], ['orange', 'Orange'], ['pink', 'Pink'], ['green', 'Green'], ['white', 'White']],
      classic: [['white', 'White'], ['warm', 'Warm'], ['ice', 'Ice Blue'], ['mint', 'Mint'], ['rose', 'Rose']],
      serif: [['cream', 'Cream'], ['white', 'White'], ['gold', 'Gold'], ['rose', 'Rose'], ['sky', 'Sky']],
      neon: [['pink', 'Pink'], ['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['purple', 'Purple']],
      lcd: [['green', 'Green'], ['amber', 'Amber'], ['blue', 'Blue'], ['white', 'White'], ['night', 'Night']],
      flip: [['dark', 'Dark'], ['white', 'White'], ['red', 'Red'], ['navy', 'Navy']],
      analog: [['orange', 'Orange'], ['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['gold', 'Gold']],
      numbers: [['white', 'White'], ['orange', 'Orange'], ['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['gold', 'Gold']],
      words: [['white', 'White'], ['warm', 'Warm'], ['blue', 'Blue'], ['green', 'Green'], ['pink', 'Pink']],
      arc: [['white', 'White'], ['orange', 'Orange'], ['blue', 'Blue'], ['green', 'Green'], ['pink', 'Pink']],
      nixie: [['orange', 'Orange'], ['ice', 'Ice Blue'], ['green', 'Green'], ['violet', 'Violet']],
      poster: [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['black', 'Black & Yellow'], ['orange', 'Orange & Navy']],
      dots: [['amber', 'Amber'], ['red', 'Red'], ['green', 'Green'], ['white', 'White'], ['blue', 'Blue']],
      ring: [['sunset', 'Sunset'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['mono', 'Mono']],
      glass: [['clear', 'Clear'], ['warm', 'Warm'], ['blue', 'Blue'], ['dark', 'Dark']],
      type: [['paper', 'Paper'], ['white', 'White'], ['green', 'Terminal Green'], ['amber', 'Terminal Amber']]
    };
    // A CLOCK FOR THE ROOM (2026-10-13): what a screen's clock could be,
    // judged from its room's (or its own) name -- the bedroom calm and red at
    // night, the kitchen the time with the weather and the music. Offered,
    // never applied by itself.
    var CLOCK_RECS = [
      // (bath before bed: a Master Bathroom is a bathroom)
      [/bath/, { clock_style: 'classic', clock_bg: 'black', clock_night: 'night' }, 'Plain and readable, a dim red at night'],
      [/bed|master|nursery|kid|guest|baby/, { clock_style: 'arc', clock_bg: 'black', clock_night: 'night' }, 'Calm, and a dim red at night'],
      [/kitchen|dining|breakfast/, { clock_style: 'today', clock_bg: 'skyonly', clock_night: 'off' }, 'The time with the weather and what\u2019s playing, over the sky'],
      [/living|family|den|great|lounge/, { clock_style: 'classic', clock_bg: 'skyonly', clock_night: 'off' }, 'A big quiet clock over the live sky'],
      [/office|study|work|desk/, { clock_style: 'flip', clock_bg: 'gradient', clock_night: 'off' }, 'A flip clock on a slow gradient'],
      [/garage|entry|hall|foyer|mud|door/, { clock_style: 'today', clock_bg: 'black', clock_night: 'off' }, 'The time and the weather on the way out']
    ];
    function clockRecommend(name) {
      var n = String(name || '').toLowerCase();
      for (var i = 0; i < CLOCK_RECS.length; i++) if (CLOCK_RECS[i][0].test(n)) return { set: CLOCK_RECS[i][1], says: CLOCK_RECS[i][2] };
      return { set: { clock_style: 'today', clock_bg: 'skyonly', clock_night: 'off' }, says: 'The time with the weather and what\u2019s playing, over the sky' };
    }
    // [id, name, moving, group]
    var CLOCK_BGS = [
      ['black', 'Black', false, 'Still'],
      ['grain', 'Grain Wash', true, 'Moving'], ['gradient', 'Drifting Gradient', true, 'Moving'], ['aurora', 'Aurora', true, 'Moving'],
      ['ink', 'Ink Swirl', true, 'Moving'], ['sky', 'Follow the Sky', true, 'Moving'],
      ['lowpoly', 'Low Poly', true, 'Patterns'], ['topo', 'Topography', true, 'Patterns'], ['constellation', 'Constellation', true, 'Patterns'],
      ['forecast', 'Forecast', false, 'From Your Screens'], ['skyonly', 'Sky Only', false, 'From Your Screens'], ['photos', 'Photos', false, 'From Your Screens'],
      ['landscapes', 'Landscapes', false, 'Photographs'],
      // (2026-10-31, the owner) the HomeView look's wallpapers and the motion themes
      ['wallpaper', 'Wallpaper', true, 'Wallpapers']];
    // THE BACKGROUND (Sky / Background's first choice, 2026-10-13; settings.py
    // SKY_BACKGROUNDS): what it is, in a line under the tabs
    var SKY_BACKGROUNDS = [['live', 'Live Sky'], ['color', 'Color'], ['photo', 'Photo'], ['landscapes', 'Landscapes'],
                           ['wallpaper', 'Wallpaper']];
    var BG_LABELS = { live: 'Live Sky', color: 'Color', photo: 'Photo', landscapes: 'Landscapes', wallpaper: 'Wallpaper' };
    var BG_SAYS = {
      live: 'The real sun, moon and weather behind the cards, dressed for the seasons. What it shows is below.',
      color: 'A still color, a little different by day and by night. No sun, moon, stars, weather or decorations.',
      photo: 'A photo of your own, still and sharp. No sun, moon, stars, weather or decorations. A bright photo is dimmed a little so the cards stay readable.',
      // (2026-10-14) HK Frontend's own photos, the screensaver clock's
      landscapes: 'Fifty landscape photos that come with ' + PN() +
        ' — mountains, lakes, coasts, forests, the northern lights — a new one each time the screen wakes, on a schedule, or the same one. No sun, moon, stars, weather or decorations.',
      // (2026-10-30) our own art, hk-wallpapers.js; (2026-10-31) its motion themes
      wallpaper:
        'Soft ribbons, petals, glass shards and pinwheels, and six moving themes, each in any color you choose and each with a darker version for the night. The cards take their color. Best with ' +
        'Bright Glass. No sun, moon, stars, weather or decorations.'
    };
    // A WALLPAPER'S NIGHT VERSION (settings.py WALLPAPER_NIGHT)
    var WALLPAPER_NIGHT = [['auto', 'After Sunset'], ['day', 'Never'], ['night', 'Always']];
    // ...AND ITS MOTION (settings.py WALLPAPER_MOTION): off, or a slow drift at a speed
    var WALLPAPER_MOTION = [['off', 'Off'], ['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']];
    // WHICH LANDSCAPE, AND WHEN IT CHANGES (settings.py sky_landscape):
    // 'wake', 'every:<minutes>' (LANDSCAPE_EVERY) or a file name -- Stay the Same
    var LANDSCAPE_EVERY = [['every:15', 'Every 15 Minutes'], ['every:30', 'Every 30 Minutes'], ['every:60', 'Every Hour'],
                           ['every:180', 'Every 3 Hours'], ['every:360', 'Every 6 Hours'], ['every:720', 'Every 12 Hours'],
                           ['every:1440', 'Every Day']];
    // which one shows now (hk-settings.js landscapeFile, the screens' own:
    // tests/test_settingsmodel.js keeps the two the same). Each wake: `wakes`
    // stands in for the screen's count of them.
    function landscapeFile(choice, list, now, wakes) {
      if (!list || !list.length) return null;
      var every = /^every:(\d+)$/.exec(choice || ''), n;
      if (choice === 'wake') n = wakes == null ? Math.floor(Date.now() / 60000) : wakes;
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
    // in words: Each Time the Screen Wakes, Every Day, or the picked one's title
    function landscapeLabel(v, list) {
      v = v || 'every:1440';
      if (v === 'wake') return 'Each Time the Screen Wakes';
      var t = LANDSCAPE_EVERY.filter(function (x) { return x[0] === v; })[0];
      if (t) return t[1];
      var p = (list || []).filter(function (x) { return x.file === v; })[0];
      return p && p.title ? p.title : 'One Landscape';
    }
    // ACCESSORY TYPES (HK Settings -> Accessories, 2026-10-13): the page is laid
    // out by type, then by room, as the owner asked ("What Counts" confused).
    // A type that is a kind (kinds.py, COUNT_KINDS: same id) lists what that
    // kind finds -- what its page and chip count -- and is where it is added
    // to, hidden from and ordered; the others list their domains. Cameras and
    // the Energy page's circuits are accessories too: their types point to
    // where they are set up.
    //   [id, title, glyph, color, { kind | domains (+ dc / notDc) | energy,
    //    order: page (accessories.pages), link: [label, route, footer] }, says, sensor]
    var ACC_TYPES = [
      ['lights', 'Lights', 'mdi:lightbulb', '#ffcc00', { kind: 'lights' }],
      ['switches', 'Switches & Outlets', 'mdi:power-socket-us', '#ff9500', { domains: ['switch'] },
       'Their tiles on Home and their rooms’ pages. One that powers a lamp can count as a light: open it and turn on Also Count As.'],
      ['fans', 'Fans', 'mdi:fan', '#32ade6', { kind: 'fans' }],
      ['thermostats', 'Thermostats', 'mdi:thermostat', '#ff9500', { kind: 'thermostats' }],
      ['humidifiers', 'Humidifiers', 'mdi:air-humidifier', '#30b0c7', { domains: ['humidifier'] }, 'Their tiles on Home, their rooms’ pages and the Climate page.'],
      ['water_heaters', 'Water Heaters', 'mdi:water-boiler', '#ff3b30', { domains: ['water_heater'] },
       'Their tiles on Home and their rooms’ pages. To put one on the Climate page, open it and turn on Also Count As → Thermostats.'],
      ['blinds', 'Blinds & Shades', 'mdi:blinds', '#5856d6', { kind: 'blinds' }],
      ['garage', 'Garage Doors', 'mdi:garage', '#34c759', { kind: 'garage', order: 'security' }],
      ['locks', 'Locks', 'mdi:lock', '#34c759', { kind: 'locks', order: 'security' }],
      ['alarm', 'Security Systems', 'mdi:shield-home', '#ff3b30', { domains: ['alarm_control_panel'],
        link: ['Alarm Panel', 'page/security', 'Which one the Security page and chip follow is chosen on the Security page, under Pages.'] },
       'The alarm keypad on its room’s page and the Security page.'],
      ['speakers', 'Speakers', 'mdi:speaker', '#af52de', { kind: 'speakers' }],
      ['tvs', 'TVs & Receivers', 'mdi:television', '#8e8e93', { domains: ['media_player'], dc: ['tv', 'receiver'] },
       'Their tiles on Home and their rooms’ pages. The Speakers chip leaves them out.'],
      ['vacuums', 'Vacuums', 'mdi:robot-vacuum', '#30b0c7', { kind: 'vacuums', order: 'vacuums' }],
      ['valves', 'Valves', 'mdi:valve', '#007aff', { kind: 'valves' }],
      ['timers', 'Timers', 'mdi:timer-outline', '#ff9500', { kind: 'timers' }], ['scenes', 'Scenes', 'mdi:palette', '#af52de', { kind: 'scenes' }],
      ['cameras', 'Cameras', 'mdi:cctv', '#ff2d55', { domains: ['camera'], link: ['Cameras Settings', 'page/cameras', 'Which cameras each screen shows, in what order, and which one plays live.'] },
       'Their tiles on Home and their rooms’ pages, the camera row and the Cameras page.'],
      ['energy', 'Circuits & Meters', 'mdi:lightning-bolt', '#34c759', { energy: true },
       'The Energy page’s live tiles: each circuit, plug and meter Home Assistant’s Energy settings list, or one added in Energy.'],
      ['doors', 'Doors', 'mdi:door', '#007aff', { kind: 'doors' }, null, true],
      ['windows', 'Windows', 'mdi:window-closed-variant', '#32ade6', { kind: 'windows' }, null, true],
      ['smoke', 'Smoke & CO', 'mdi:smoke-detector-variant', '#ff3b30', { kind: 'smoke' }, null, true],
      ['leaks', 'Leak Sensors', 'mdi:water-alert', '#007aff', { kind: 'leaks' }, null, true],
      ['motion', 'Motion', 'mdi:motion-sensor', '#8e8e93', { kind: 'motion' }, null, true],
      ['occupancy', 'Occupancy', 'mdi:account', '#8e8e93', { kind: 'occupancy' }, null, true],
      ['temperature', 'Temperature', 'mdi:thermometer', '#ff9500', { kind: 'temperature' }, null, true],
      ['humidity', 'Humidity', 'mdi:water-percent', '#32ade6', { kind: 'humidity' }, null, true]
    ];
    // the type a kind's links open (#/house/counts/<kind> was What Counts')
    function accType(id) { return ACC_TYPES.filter(function (t) { return t[0] === id; })[0] || null; }
    // A TABLET'S BUTTON STYLE (menu, a button). The tab bar is a Menu of its
    // own, never a button style (settings.py MENU_STYLES refuses it).
    var MENU_STYLES = [
      ['auto', 'Automatic', 'The chip when Home has a menu button; otherwise the edge tab.'],
      ['chip', 'Chip', 'A round button at the start of the chip row.'],
      ['chip_scroll', 'Chip, Then Tab', 'The chip; the edge tab slides in while the chip is scrolled out of sight.'],
      ['chip_home', 'Chip on Home, Tab Elsewhere', 'The chip on Home, and the edge tab on every other page.'],
      ['tab', 'Edge Tab', 'A slim tab on the left edge.'],
      ['none', 'No Button', 'Nothing on the page: swipe from the left edge to open the menu.']
    ];
    // PHONES' BUTTON STYLE (button_phone): on a phone, and on a tablet whose
    // own menu doesn't fit (hk-base.js phoneForm) -- the chip, the chip then
    // the tab, the tab, or no button (the swipe alone)
    var BUTTON_PHONE = [
      ['chip', 'Chip', 'A round button at the start of the chip row.'],
      ['chip_scroll', 'Chip, Then Tab', 'The chip; the edge tab slides in while the chip is scrolled out of sight.'],
      ['tab', 'Edge Tab', 'A slim tab on the left edge, over the first column of tiles.'],
      ['none', 'No Button', 'Nothing on the page: swipe from the left edge to open the menu.']
    ];
    // NO BUTTON needs the swipe (hk-base.js falls back without it): offered
    // only while Swipe from Left Edge is on, or while it is the choice already
    function stylesFor(list, swipe, cur) {
      return list.filter(function (s) { return s[0] !== 'none' || swipe || cur === 'none'; });
    }
    // Turning the swipe off: a No Button choice goes back to the default with
    // it, so the screen keeps a way in
    function swipeChanges(on, v) {
      var ch = { swipe: !!on };
      if (!on && v.menu === 'none') ch.menu = 'auto';
      if (!on && v.button_phone === 'none') ch.button_phone = 'chip';
      return ch;
    }
    function phoneStyleLabel(v) {
      for (var i = 0; i < BUTTON_PHONE.length; i++) if (BUTTON_PHONE[i][0] === (v || 'chip')) return BUTTON_PHONE[i][1];
      return 'Chip';
    }
    // the styles that can show the edge tab (Tab Position applies)
    var TAB_STYLES = { auto: 1, chip_scroll: 1, chip_home: 1, tab: 1 };
    // THE GLASS (2026-10-10): three styles, and Blur's three modes -- one
    // stored value each (look.glass / a screen's glass): clear, frosted, blur
    // (Shared Layer), blur_pre (Pre-rendered), blur_each (Each Card)
    var GLASS_STYLES = [
      ['flat', 'Flat', 'A clean, opaque look designed for smoother performance. Disables blur, animations and live sky effects. Especially useful on slower tablets.'],
      ['clear', 'Glass', 'The original see-through glass. The status chips blur what’s behind them.'],
      ['frosted', 'Frosted', 'A milky material with no blur. Costs nothing per frame on any device.'],
      ['tinted', 'Tinted', 'The Home app’s dark plate, with no blur anywhere on the page. The lightest on any device; sheets and pop-ups still blur while open.'],
      ['blur', 'Blur', 'What’s behind the glass, blurred. Choose how in Blur Mode.'],
      // BRIGHT GLASS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase D): the
      // sixth look, in Blur's three modes (BRIGHT_MODES)
      ['bright', 'Bright Glass', 'A light, clear glass that brings out the colors behind it. Best over a wallpaper.']
    ];
    var BLUR_MODES = [
      ['blur', 'Shared Layer', 'Live: the sky blurs as it moves, one blur for the whole page. Fine on wall tablets — but while the sky moves, the device blurs it again on every frame.'],
      ['blur_pre', 'Pre-rendered (Experimental)',
        'Experimental: it can still trail or miss a change now and then. A picture of the sky, blurred once and painted again as the sky changes. The lightest blur, and the smoothest scrolling on ' +
        'a wall tablet: the cards, the tab bar, a docked menu and the Side Pane all wear it. While clouds or a moving wallpaper drift, a new picture fades in every 2 seconds, never while you touch ' +
        'or scroll; the light catches up within a minute. Sheets and menus open over the page still blur live. Rain, snow, meteors and a passing flock don’t show through the glass.'],
      ['blur_each', 'Each Card',
        'Live: every card blurs what’s behind it, so a sheet or a scrolling row never leaves its frost behind. The heaviest — for phones, iPads and computers, not wall tablets.']
    ];
    // ...and Bright Glass's, the same three by their own stored values
    // (settings.py BRIGHT_GLASS)
    var BRIGHT_MODES = BLUR_MODES.map(function (m) { return [m[0].replace('blur', 'bright'), m[1], m[2]]; });
    // every stored value, its full name and its note (a list, a summary)
    // (every style but Blur and Bright Glass, then their modes -- a style
    // added later is in)
    var GLASS = GLASS_STYLES.filter(function (s) { return s[0] !== 'blur' && s[0] !== 'bright'; }).concat(BLUR_MODES.map(function (m) {
      return [m[0], 'Blur · ' + m[1], m[2]];
    })).concat(BRIGHT_MODES.map(function (m) {
      return [m[0], 'Bright Glass · ' + m[1], m[2]];
    }));
    function isBlur(v) { return v === 'blur' || v === 'blur_pre' || v === 'blur_each'; }
    function isBright(v) { return v === 'bright' || v === 'bright_pre' || v === 'bright_each'; }
    // the Blur Modes of a style (Blur's or Bright Glass's), else null
    function modesFor(style) { return style === 'blur' ? BLUR_MODES : style === 'bright' ? BRIGHT_MODES : null; }
    // the value a style is saved as when picked: Blur and Bright Glass keep
    // the mode already chosen (`cur`, either's), else start from `fallback`'s
    function styleValue(style, cur, fallback) {
      var modes = modesFor(style);
      if (!modes) return style;
      var mode = isBlur(cur) || isBright(cur) ? cur : (isBlur(fallback) || isBright(fallback) ? fallback : 'blur');
      var at = ['', '_pre', '_each'].filter(function (x) { return mode === 'blur' + x || mode === 'bright' + x; })[0] || '';
      return style + at;
    }
    // the style a stored value belongs to
    function glassStyle(v) {
      if (isBlur(v)) return 'blur';
      if (isBright(v)) return 'bright';
      for (var i = 0; i < GLASS_STYLES.length; i++) if (GLASS_STYLES[i][0] === v) return v;
      return 'clear';
    }
    // Tinted's icon circles (look.well, a screen's well)
    var TINT_WELLS = [['dark', 'Dark'], ['light', 'Light']];
    // TILE STYLE (look.tile_style, a screen's; 2026-10-30): the Home Grid's tiles (room pages keep Tall pills), Automatic Centred
    // on square cells; 2026-11-07, a Centered tile's icons off (look.tile_icons; Automatic: white on Bright Glass) and Climate's thermostats
    var TILE_STYLES = [['auto', 'Automatic'], ['home', 'Home'], ['centred', 'Centered']], TILE_ICONS = [['auto', 'Automatic'], ['color', 'Color'], ['white', 'White']],
        THERMOSTAT_STYLES = [['dial', 'Dial'], ['big', 'Big Number']];
    // BRIGHT GLASS ON (look.bright_pages, a screen's bright_pages; settings.py BRIGHT_PAGES)
    var BRIGHT_PAGES = [['home', 'Home Only'], ['all', 'Every Page']];
    var PRESETS = {
      wall_tablet: ['Wall Tablet', 'Menu always open with the time and weather, back to Home when idle, no Home Assistant header.'],
      personal: ['Phone or iPad', 'Menu behind a button, time and weather in the header.'],
      computer: ['Computer', 'Menu open beside the page.'],
      car: ['Car', 'No menu, sized for a car’s browser.'],
      energy: ['Energy Display', 'Only the Energy page, no menu, no Home Assistant header. Needs the Energy feature.'],
      custom: ['Something Else', 'Starts from the defaults.']
    };
    // A CAR'S BROWSER (settings.py CAR_LAYOUTS / CAR_WIDTHS): which Home the
    // screen generates there, and the layout width its window is zoomed to
    // hold -- a wider layout is smaller content. '' is the default width;
    // 'custom' a width of the person's own (600 to 2,400 px).
    var CAR_LAYOUTS = [['home', 'Full Home', 'The Home every screen has: the clock, cameras and every room.'],
                       ['car', 'Car Home',
                         'The weather and the house’s status along the top — the car shows the time — then the chips, Scenes, Security (the garage, alarm and locks as tall tiles) and Favorites — ' +
                         'and the camera strip, if it’s on. No rooms.']];
    var CAR_WIDTHS = [['1000', 'Larger'], ['', 'Standard'], ['1400', 'Smaller'], ['custom', 'Custom']];
    var CAR_WIDTH = 1200;
    function carWidthChoice(w, custom) {
      if (custom) return 'custom';
      if (!w) return '';
      var hit = CAR_WIDTHS.some(function (o) { return o[0] === String(w); });
      return hit ? String(w) : 'custom';
    }
    var STATUS_LABELS = {
      temperature: 'Temperature', humidity: 'Humidity', security: 'Security System', tvs: 'TVs', lights: 'Lights',
      outlets: 'Outlets', blinds: 'Blinds', fans: 'Fans', windows: 'Windows', doors: 'Doors', locks: 'Locks',
      garage: 'Garage Doors', valves: 'Valves', motion: 'Motion', occupancy: 'Occupancy', leaks: 'Leaks',
      speakers: 'Speakers', vacuums: 'Vacuums', vacuum_battery: 'Vacuum Batteries', timers: 'Timers'
    };
    // What an item says, under its name in Status Rows' lists
    var STATUS_SAYS = {
      temperature: 'The reading — a page’s from every room, a room’s from its own sensor', humidity: 'The reading, as temperature',
      security: 'Disarmed, Armed Home, Armed Away …', tvs: 'On or Off', lights: 'How many are on', outlets: 'How many are on',
      blinds: 'Open or Closed', fans: 'How many are on', windows: 'Open or Closed', doors: 'Open or Closed',
      locks: 'Locked or Unlocked', garage: 'Open or Closed', valves: 'Running or Off', motion: 'Where it’s detected',
      occupancy: 'Which rooms are occupied', leaks: 'Where a leak is detected', speakers: 'Playing or not',
      vacuums: 'Cleaning, docked or stuck', vacuum_battery: 'The lowest battery', timers: 'How many are running'
    };
    // THE STATUS ROWS (HK Settings -> Status Rows): a room page's, then each
    // category page's (settings.STATUS_ROWS). [key, title, icon, what it is]
    var STATUS_ROWS = [
      ['rooms', 'Room Pages', 'mdi:sofa', 'Under a room’s name, as the Home app shows it.'],
      ['climate', 'Climate', 'mdi:home-thermometer', 'The temperature and humidity across the rooms, blinds and fans.'],
      ['lights', 'Lights', 'mdi:lightbulb', 'The lights, and the outlets counted with them.'],
      ['doors_windows', 'Doors & Windows', 'mdi:window-closed-variant', 'What’s open, and where there’s motion or someone home.'],
      ['water', 'Water', 'mdi:water', 'The leak sensors and the water valves.'],
      ['security', 'Security', 'mdi:lock', 'The security system and everything that guards the house.'],
      ['vacuums', 'Vacuums', 'mdi:robot-vacuum', 'What the vacuums are doing, and their batteries.'],
      ['timers', 'Timers', 'mdi:timer-sand', 'The timers running.']
    ];
    // THE PAGE HEADERS (settings.HEADERS; hk-headers.js): the pages that have
    // one, what it shows, and its defaults (as settings.py's)
    var HEADER_PAGES = {
      climate: { what: 'Heating & cooling today, and the weather ahead', footer: 'The cards between the status row and the thermostats.',
                 defaults: { show: true, thermostats: null } },
      lights: { what: 'The rooms lit longest today, what’s left on and tonight’s lighting', footer: 'The cards between the status row and the rooms.',
                defaults: { show: true, rooms: 3, left_on: true, tonight: true, exclude_areas: null, after_min: 10, automations: null, sky_follow: true, sky_source: null } },
      security: { what: 'Your home’s ways in, today’s activity and Device Care', footer: 'Beside the keypad, at its height.',
                  defaults: { show: true, callouts: true, front_door: null, back_door: null, garage: null, low_battery: 20 } },
      water: { what: 'Today’s water use, and the main supply valve', footer: 'The cards between the status row and the valves. Off, the main valve is a tile with the others again.',
               defaults: { show: true, meter: null, supply: null } },
      timers: { what: 'What finishes when, and Quick Start', footer: 'The cards between the status row and the timers running.',
                defaults: { show: true, presets: [5, 10, 15, 20, 30, 60], names: ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break'] } },
      vacuums: { what: 'The days’ cleaning, and each vacuum’s last run', footer: 'The cards between the status row and the vacuums.',
                 defaults: { show: true, counters: null, water_tank: true, water_clear: 24 } }
    };
    // THE PAGES SECTION (2026-10-16, PLAN-2026-10-16-pages-settings.md): every
    // generated page the house has, in the menu's order, each its own
    // settings page (#/page/<key>) -- [key, title, icon, tile color].
    var PAGES = [
      ['climate', 'Climate', 'mdi:home-thermometer', '#30b0c7'], ['lights', 'Lights', 'mdi:lightbulb', '#ffcc00'],
      ['security', 'Security', 'mdi:lock', '#007aff'], ['doors_windows', 'Doors & Windows', 'mdi:window-closed-variant', '#a2845e'],
      ['water', 'Water', 'mdi:water', '#32ade6'], ['energy', 'Energy', 'mdi:lightning-bolt', '#34c759'],
      ['power', 'Power', 'mdi:home-lightning-bolt', '#ff9500'], ['timers', 'Timers', 'mdi:timer-sand', '#ff9500'],
      ['vacuums', 'Vacuums', 'mdi:robot-vacuum', '#af52de'], ['music', 'Music', 'mdi:music', '#ff2d55'],
      ['cameras', 'Cameras', 'mdi:cctv', '#ff2d55'], ['calendar', 'Calendar', 'mdi:calendar-month', '#ff3b30'],
      ['weather', 'Weather', 'mdi:weather-partly-cloudy', '#32ade6'], ['live_tv', 'Live TV', 'mdi:television-classic', '#007aff']
    ];
    // EACH PAGE'S HIGHLIGHT under Automatic, unless the page has its own
    // (look.page_accents): hk-base.js PAGE_ACCENTS, the same table
    var PAGE_ACCENTS = { climate: 'blue', lights: 'yellow', security: 'teal', doors_windows: 'teal',
                         calendar: 'purple', weather: 'cyan', energy: 'green', power: 'green', water: 'cyan',
                         music: 'pink', live_tv: 'indigo', cameras: 'red', vacuums: 'mint', timers: 'orange' };
    function pageAccentOf(key, own) {
      var dflt = PAGE_ACCENTS[key] || 'orange', mine = own && own[key];
      return { own: !!mine, value: mine || dflt, dflt: dflt, a: accentOf(mine || dflt), d: accentOf(dflt) };
    }
    function pageOf(key) { return PAGES.filter(function (p) { return p[0] === key; })[0] || null; }
    // WHAT'S ON IT: the accessory types (Accessories -> a type) each page shows
    var PAGE_TYPES = {
      climate: ['thermostats', 'fans', 'blinds', 'humidifiers', 'temperature', 'humidity'], lights: ['lights', 'switches'],
      security: ['alarm', 'locks', 'garage', 'doors', 'windows', 'leaks', 'motion'], doors_windows: ['doors', 'windows', 'motion', 'occupancy'],
      water: ['leaks', 'valves'], timers: ['timers'], vacuums: ['vacuums'], cameras: ['cameras'], energy: ['energy'], music: ['speakers'],
      live_tv: ['tvs']
    };
    // the feature a page comes from (hk-settings-features.js LIST's route):
    // its pages live under #/features/<route>/... and its page here opens them
    var PAGE_FEATURES = { energy: 'energy', power: 'energy', music: 'music', live_tv: 'tv', security: 'alarm', vacuums: 'clean' };
    // A PAGE THE HOUSE HAS: `has` -- {kinds: Status & Chips' counts (kind ->
    // found), alarm: the Alarm Panel, cameras/calendars/weather: how many}.
    // Energy, Power, Music and Live TV are always listed (a page whose feature
    // isn't added opens on setting it up); Doors & Windows only without an
    // alarm (with one it is the Security page's).
    function pagesListed(has) {
      var k = (has && has.kinds) || {}, n = function (x) { return (k[x] || 0) > 0; };
      var alarm = !!(has && has.alarm);
      var want = {
        climate: n('thermostats') || n('fans') || n('temperature'), lights: n('lights'),
        security: alarm || n('locks') || n('garage'), doors_windows: !alarm && (n('doors') || n('windows')),
        water: n('leaks') || n('valves'), energy: true, power: true, timers: n('timers'), vacuums: n('vacuums'), music: true,
        cameras: !!(has && has.cameras), calendar: !!(has && has.calendars), weather: !!(has && has.weather), live_tv: true
      };
      return PAGES.filter(function (p) { return want[p[0]]; });
    }
    // the sidebar route a settings address belongs to: a page's own, or the
    // feature pages it opens (#/features/energy/devices is Energy's)
    function pageOfRoute(here) {
      var m = /^page\/([a-z_]+)/.exec(here || '');
      if (m) return m[1];
      m = /^features\/([a-z]+)/.exec(here || '');
      if (!m) return null;
      if (m[1] === 'energy') return /^features\/energy\/power/.test(here) ? 'power' : 'energy';
      return { music: 'music', tv: 'live_tv', alarm: 'security', clean: 'vacuums' }[m[1]] || null;
    }
    // OLD ADDRESSES FORWARD (2026-10-16, Pages): a route that moved, to where
    // it is now ('house/weather/sensors' -> 'page/weather/sensors'); null when
    // it did not move. Never itself: a route never forwards to itself.
    var FEATURE_PAGES = { energy: 'energy', music: 'music', tv: 'live_tv', alarm: 'security', clean: 'vacuums' };
    function routeForward(path) {
      var p = String(path || '').split('/').filter(Boolean), out = null;
      if (p[0] === 'house') {
        if (p[1] === 'weather' || p[1] === 'calendar' || p[1] === 'cameras') out = ['page', p[1]].concat(p.slice(2)).join('/');
        else if (p[1] === 'general') out = p[2] === 'timers' ? 'page/timers/house' : 'page/security';
        else if (p[1] === 'climate') out = 'page/climate/status';
        else if (p[1] === 'status') {
          out = !p[2] ? 'page/climate' : p[2] === 'rooms' ? 'house/rooms/status' : pageOf(p[2]) ? 'page/' + p[2] + '/status' : 'page/climate';
        }
        else if (p[1] === 'menu' && p[2] === 'status') out = 'house/rooms/status';
        // APPEARANCE AND MENU, REORGANIZED (2026-10-29): Sky / Background
        // under Appearance; one Accent Color there; each kind of menu a page
        else if (p[1] === 'sky' && !(p[2] === 'page' && pageOf(p[3]))) out = ['house', 'appearance', 'sky'].concat(p.slice(2)).join('/');
        else if (p[1] === 'appearance' && p[2] === 'sky' && p[3] === 'page' && pageOf(p[4])) out = 'page/' + p[4] + '/background';
        else if (p[1] === 'menu' && p[2] === 'accent') out = 'house/appearance/accent';
        else if (p[1] === 'appearance' && p[2] === 'flat-colors' && p[3] === 'accent') out = 'house/appearance/accent';
        else if (p[1] === 'menu' && (p[2] === 'tablets' || p[2] === 'phones')) out = p[3] === 'style' ? 'house/menu/side/' + p[2] : 'house/menu';
        else if (p[1] === 'appearance' && p[2] === 'pill' && pageOf(p[3])) out = 'page/' + p[3] + '/pill';
        else if (p[1] === 'sky' && p[2] === 'page' && pageOf(p[3])) out = 'page/' + p[3] + '/background';
      } else if (p[0] === 'screens' && p[1] && (p[2] === 'menu' || p[2] === 'flat-colors') && p[3] === 'accent' && !p[4]) {
        out = 'screens/' + p[1] + '/accent';
      } else if (p[0] === 'screens' && p[1] && p[2] === 'menu' && (p[3] === 'tablets' || p[3] === 'phones')) {
        out = 'screens/' + p[1] + '/menu' + (p[4] === 'style' ? '/side/' + p[3] : '');
      } else if (p[0] === 'features' && p.length === 2 && FEATURE_PAGES[p[1]]) {
        out = 'page/' + FEATURE_PAGES[p[1]];
      } else if (p[0] === 'accessories' && p[1] === 'page' && (p[2] === 'vacuums' || p[2] === 'security')) {
        out = 'page/' + p[2] + '/order';
      } else if (p[0] === 'accessories' && p[1] === 'type' && p[3] === 'order' && (p[2] === 'vacuums' || p[2] === 'locks' || p[2] === 'garage')) {
        out = 'page/' + (p[2] === 'vacuums' ? 'vacuums' : 'security') + '/order';
      }
      return out && out !== p.join('/') ? out : null;
    }
    // A SCREEN SHOWS A PAGE: its Pages on This Screen ([] every page)
    function screenShows(b, key) {
      // a screen of only some pages (Home Page off) shows just those
      if (b && b.home_page === false && (b.only_pages || []).length) return b.only_pages.indexOf(key) >= 0;
      var p = (b && b.pages) || [];
      return !p.length || p.indexOf(key) >= 0;
    }
    // the screens that turn a page's header off (their `headers`)
    function headerOffOn(boards, key) {
      return Object.keys(boards || {}).filter(function (p) { return ((boards[p] || {}).headers || {})[key] === false; });
    }
    // the Status & Chips kind each item counts with (the security system is the
    // Alarm Panel, General's)
    var STATUS_SOURCE = { lights: 'lights', outlets: 'lights', blinds: 'blinds', fans: 'fans', windows: 'windows',
                          doors: 'doors', locks: 'locks', garage: 'garage', valves: 'valves', motion: 'motion',
                          occupancy: 'occupancy', leaks: 'leaks', temperature: 'temperature', humidity: 'humidity',
                          vacuums: 'vacuums', vacuum_battery: 'vacuums', timers: 'timers' };
    // New Decorations' seasons between occasions (sky.woodland), in order
    var WOODLAND = [['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Autumn'], ['winter', 'Winter']];
    // the clouds' looks (sky.cloud_style), as the Clouds menus offer them
    var CLOUD_STYLES = [['classic', 'Classic'], ['realistic', 'Realistic']];
    // Moving Things (sky.moving / a screen's sky_moving)
    var SKY_MOVING = [['behind', 'Behind the Cards'], ['front', 'In Front of the Cards']];
    var SWIPE_PAGES = [['auto', 'Automatic'], ['on', 'On'], ['off', 'Off']];    // Swipe Between Pages (hk-pageswipe.js)
    var SWIPE_PAGES_SAYS = { auto: 'Where a tab bar shows, a sideways swipe goes to the next or the previous page: the tabs’, then More’s. Not on a room’s page.',
                             on: 'A sideways swipe goes to the next or the previous page: the tab bar’s and More’s, or the side menu’s. Not on a room’s page.',
                             off: 'Pages change only from the menu or the tab bar.' };
    // the daytime sky's brightness (sky.daytime, settings.py DAYTIME_SKIES)
    var DAYTIME_SKIES = [['natural', 'Natural'], ['balanced', 'Balanced'], ['deep', 'Deep']];
    function woodlandSummary(list) {
      if (!Array.isArray(list)) return 'All Seasons';
      var on = WOODLAND.filter(function (w) { return list.indexOf(w[0]) >= 0; });
      return on.length === WOODLAND.length ? 'All Seasons' : on.length ? on.map(function (w) { return w[1]; }).join(', ') : 'None';
    }
    // "4 Shown", or Off for a row with nothing in it
    function statusSummary(list) {
      return list && list.length ? list.length + ' Shown' : 'Off';
    }
    var BROWSE_LABELS = {
      artists: 'Artists', albums: 'Albums', tracks: 'Songs', playlists: 'Playlists', radio: 'Radio',
      podcasts: 'Podcasts', audiobooks: 'Audiobooks'
    };
    var POPUP_KINDS = [
      ['camera', 'Camera or Doorbell', 'The picture to every edge, with talk-back when it has a speaker.'],
      ['alarm', 'Alarm Keypad', 'The alarm’s keypad.'],
      ['accessories', 'Accessories', 'Several accessories on one sheet.'],
      ['cards', 'Custom', 'Your own cards, in YAML.']
    ];
    var CLOSE_AFTER = [[30, '30 Seconds'], [60, '1 Minute'], [120, '2 Minutes'], [300, '5 Minutes'],
                       [600, '10 Minutes'], [1800, '30 Minutes'], [3600, '1 Hour']];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                  'October', 'November', 'December'];

    // THE SKY, by what it draws. dates: the key prefix of its _from/_to;
    // often: its how-often key; extra: another how-often key.
    var SKY_THEMES = [
      { id: 'halloween', label: 'Fall & Halloween', dates: 'halloween', often: 'halloween_often', extra: 'spooky_often',
        desc: 'An autumn canopy and falling leaves by day; on some nights a big moon, fog, bats and a witch.' },
      { id: 'thanksgiving', label: 'Thanksgiving', dates: 'thanksgiving', often: 'thanksgiving_often',
        desc: 'The autumn canopy with heavier falling leaves.' },
      { id: 'christmas', label: 'Christmas', dates: 'christmas', often: 'christmas_often',
        desc: 'Pine, ornaments and stockings, twinkling lights, snow and a rare sleigh.' },
      { id: 'fourth-of-july', label: 'Fourth of July', dates: 'july4', desc: 'Every day between its dates.' },
      { id: 'valentines-day', label: 'Valentine’s Day', dates: 'valentines', desc: 'Every day between its dates.' },
      { id: 'spring-garden', label: 'Spring Garden', dates: 'spring', often: 'spring_often',
        desc: 'Blossom, petals and a butterfly by day, on occasional days.' },
      { id: 'winter-wonderland', label: 'Winter Wonderland', dates: 'winter', often: 'winter_often',
        desc: 'Frost and ice crystals on occasional days. May run past New Year.' },
      { id: 'storybook-magic', label: 'Storybook Magic', often: 'storybook_per_month',
        desc: 'On its own fixed days every month.' },
      { id: 'space-night', label: 'Space Night', often: 'space_per_month', desc: 'On its own fixed days every month.' },
      { id: 'birthday', label: 'Birthdays', desc: 'Balloons and confetti on the day, even in place of a season’s decoration.' }
    ];
    // SKY LIVELINESS (hk-sky.js lvOf; settings.py LIVELY_*): the words for
    // it. The knobs each occasion has, and the style that draws each, come
    // from the integration (choices.sky_lively); their names are here.
    var LIVELY_STEPS = ['Off', 'Few', 'Normal', 'Lots', 'Max'];
    var LIVELY_OFTEN = ['Never', 'Rarely', 'Normal', 'Often', 'Very Often'];
    var LIVELY_PRESETS = [['subtle', 'Subtle', 'A few touches, now and then'],
                          ['classic', 'Classic', 'As it has always been'],
                          ['festive', 'Festive', 'Busier, and more often'],
                          ['party', 'Party', 'Everything, as often as it comes'],
                          ['custom', 'Custom', 'Each effect your own way']];
    // ONE CHOICE FOR EVERY OCCASION (2026-10-09), All Screens' and a screen's
    // alike: a preset, or Custom -- then each occasion its own
    var LIVELY_ALL = LIVELY_PRESETS.map(function (p) { return [p[0], p[1]]; });
    // an occasion's name in the Each Occasion list: a holiday's, a woodland
    // season's, the Night Sky
    function livelyOccLabel(id) {
      if (id === 'night') return 'Night Sky';
      var w = WOODLAND.filter(function (x) { return x[0] === id; })[0];
      if (w) return w[1] + ' Woodland';
      var t = SKY_THEMES.filter(function (x) { return x.id === id; })[0];
      return t ? t.label : id;
    }
    var LIVELY = {
      bats: 'Bat Flocks', bats_often: 'Bat Flocks', swarm: 'Spooky Night Swarm', witch: 'Witch Across the Moon',
      geese: 'Geese', sleigh: 'Santa’s Sleigh', flyby: 'Flyby', balloons: 'Balloons',
      leaves: 'Falling Leaves', swirl: 'Leaf Gusts', petals: 'Petals', snow: 'Snowfall', particles: 'Particles',
      mist: 'Mist', fireflies: 'Fireflies', glints: 'Snow Sparkles', lights: 'Lights Twinkle', owl: 'Owl',
      rainbow: 'Rainbow After Rain', stars: 'Twinkling Stars', meteors: 'Shooting Stars', fireworks: 'Fireworks',
      aurora: 'Northern Lights'
    };
    // ...a few say what they are on their own occasion
    var LIVELY_OWN = {
      'valentines-day': { particles: 'Hearts' }, 'winter-wonderland': { particles: 'Ice Crystals' },
      'storybook-magic': { particles: 'Sparkles', flyby: 'Fairy' }, 'space-night': { particles: 'Sparkles', flyby: 'Rocket' },
      birthday: { particles: 'Confetti' }, 'fourth-of-july': { particles: 'Sparkles' },
      'spring-garden': { flyby: 'Butterfly' }, spring: { flyby: 'Butterfly' }
    };
    var LIVELY_PRESET_STEP = { subtle: 1, classic: 2, festive: 3, party: 4 };
    // The knobs to show for an occasion: [knob, name, type] for those drawn by
    // a decoration style in use (`styles`: {old: true, new: true}).
    function livelyKnobs(table, occ, styles) {
      var t = table || {}, list = (t.occasions || {})[occ] || [], knobs = t.knobs || {};
      return list.filter(function (k) { return k[1] === 'both' || styles[k[1]]; }).map(function (k) {
        var own = LIVELY_OWN[occ] || {};
        return [k[0], own[k[0]] || LIVELY[k[0]] || k[0], (knobs[k[0]] || [])[1] || 'many'];
      });
    }
    function livelyPresetLabel(p) {
      var x = LIVELY_PRESETS.filter(function (e) { return e[0] === p; })[0];
      return x ? x[1] : 'Classic';
    }
    // A Custom occasion starts from the preset it was on: every knob at that step
    function livelyFrom(preset, knobs) {
      var step = LIVELY_PRESET_STEP[preset] || 2, out = {};
      knobs.forEach(function (k) { out[k[0]] = k[2] === 'show' ? (step ? 2 : 0) : step; });
      return out;
    }
    // The occupancy, motion and presence sensors in a room -- where Calm When
    // Nobody's Around can tell the room is empty (the same rule as hk-sky.js
    // roomSensorIds)
    function roomSensors(client, room) {
      if (!room || !client) return [];
      var ents = client.entities || {}, devs = client.devices || {}, out = [];
      Object.keys(client.states || {}).forEach(function (id) {
        if (id.indexOf('binary_sensor.') !== 0) return;
        var st = client.states[id], e = ents[id];
        var dc = st && st.attributes && st.attributes.device_class;
        if (!(dc === 'occupancy' || dc === 'motion' || dc === 'presence') || !e || e.hidden) return;
        var area = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
        if (area === room) out.push(id);
      });
      return out;
    }
    var OFTEN_LABELS = {
      halloween_often: { every_day: 'Every Day', sometimes: 'Sometimes', near_end: 'Only the Last Days' },
      thanksgiving_often: { every_day: 'Every Day', sometimes: 'Sometimes', near_end: 'Only the Last Days' },
      christmas_often: { every_day: 'Every Day', sometimes: 'Sometimes', near_end: 'Only the Last Days' },
      spring_often: { often: 'Often', sometimes: 'Sometimes', rarely: 'Rarely' },
      winter_often: { often: 'Often', sometimes: 'Sometimes', rarely: 'Rarely' },
      storybook_per_month: { 1: 'Once a Month', 2: 'Twice a Month', 4: 'Four Times a Month' },
      space_per_month: { 1: 'Once a Month', 2: 'Twice a Month', 4: 'Four Times a Month' },
      spooky_often: { every_night: 'Every Night', sometimes: 'Sometimes', never: 'Never' }
    };
    var OFTEN_DEFAULT = { storybook_per_month: '1', space_per_month: '1' };

    // Why a value was refused (settings_api.py codes, files.py codes).
    var ERRORS = {
      entity: 'That isn’t the right kind of entity.', list: 'That list couldn’t be read.',
      choice: 'That isn’t one of the choices.', text: 'That text is too long.', amount: 'Choose 0 to 100 %.',
      card_options: 'Options must be YAML keys and values (key: value), under 20,000 characters.',
      birthday: 'Each birthday needs a name and a date.', path: 'Use letters, digits and dashes only.',
      count: 'That list couldn’t be read.', date: 'That isn’t a date.', time: 'That isn’t a time of day.',
      stops: 'Choose four colors for Day and four for Night.',
      photo: 'That photo couldn’t be used. Choose it again.',
      tab_position: 'Enter a number: pixels from the top, or a percentage of the screen’s height.',
      accent: 'Choose a color, or a color of your own as #rrggbb.',
      dock_min: 'Enter 700 to 3,000 px.', car_width: 'Enter 600 to 2,400 px.', bad_room: 'Use lower-case letters, digits and underscores, like living_room.',
      user: 'That isn’t a user name.', unknown: 'That setting doesn’t exist.',
      range: 'That number is outside what this setting allows.',
      icon: 'Use an icon name such as mdi:music or hk:apple.',
      chip_card: 'The chip must be YAML with a type, such as type: custom:hk-status-chip-card.',
      chip_gone: 'That chip isn’t there any more.',
      folder_required: 'Enter a folder name.', folder_outside_config: 'The folder must be inside /config.',
      folder_is_config: 'Choose a folder inside /config, not /config itself.',
      folder_not_dedicated: 'That folder holds Home Assistant’s own files; choose a folder of its own.',
      name_needed: 'Give it a name.', bad_hash: 'Use lower-case letters, digits and dashes.',
      hash_taken: 'Another pop-up uses that address.', bad_page_path: 'Use lower-case letters, digits and dashes (not a page the screens use themselves).',
      page_path_taken: 'Another page uses that address.', page_not_found: 'That page couldn’t be read.',
      page_view: 'The page must be YAML keys and values, such as cards: […].',
      // Home Grid (hk_core/settings/home_grid.py)
      grid: 'That layout couldn’t be read.', grid_cols: 'A Home Grid is 6, 3 or 2 columns wide.',
      grid_rows: 'A Home Grid has 2 to 6 rows.', grid_frame: 'The frame must be a screen size, such as 1280 × 800.',
      grid_items: 'A Home Grid holds at most 24 blocks.', grid_item: 'A block in that layout couldn’t be read.',
      grid_card: 'That card can’t go on a Home Grid.', grid_size: 'That card doesn’t come in that size.',
      grid_fit: 'That size is bigger than the grid.', grid_place: 'A block is past the edge of the grid.',
      grid_overlap: 'Two blocks are in the same place.', grid_pages: 'A block’s pages couldn’t be read.', grid_sheet: 'A block’s detail sheet has a setting it can’t use.',
      grid_condition: 'Choose a condition and a fallback card.', grid_fallback: 'Choose a fallback card that supports this block’s size.',
        grid_sheet_full: 'A detail sheet holds at most 24 accessories.',
      grid_source: 'That card can’t swipe through those pages.', grid_option: 'A block’s option isn’t one it can use.',
      grid_sheet_empty: 'A block opens a detail sheet with nothing in it. Add an accessory, or set When Tapped back to the block’s own.' };
    // A PAGE PILL'S OWN LOOK (hk-chip.js PAGE_PILLS): name, icon, color
    var PAGE_PILL_DEFAULTS = {
      weather: ['Weather', 'hk:weather-partly-cloudy', 'white'], calendar: ['Calendar', 'mdi:calendar-month', 'white'], cameras: ['Cameras', 'hk:camera', 'white'],
      live_tv: ['Live TV', 'hk:television', 'white'], security: ['Security', 'hk:shield-lock', 'white'],
      doors_windows: ['Doors & Windows', 'hk:door-closed-lock', 'white'], climate: ['Climate', 'hk:thermostat', 'white'],
      lights: ['Lights', 'hk:lightbulb', 'white'], timers: ['Timers', 'hk:timer-sand', 'white'],
      vacuums: ['Vacuums', 'hk:robot-vacuum', 'white'], music: ['Music', 'hk:music', 'white'], water: ['Water', 'hk:water', 'white'],
      energy: ['Energy', 'mdi:lightning-bolt', 'white'], power: ['Power', 'mdi:home-lightning-bolt', 'white']
    };
    var PILL_COLORS = ['white', 'yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'mint', 'green'];
    // A CALENDAR'S AUTOMATIC COLOUR: the next of these by its place in the list
    // (the same list as hk-settings.js calendarColor)
    var CAL_COLORS = ['orange', 'green', 'purple', 'blue', 'pink', 'yellow', 'teal', 'red', 'mint', 'white'];
    function colorLabel(k) { return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Default'; }
    function errorText(code) { return ERRORS[code] || String(code || 'Couldn’t save.'); }
    // A refusal from the page's commands: the message is JSON (field -> code).
    function refusals(err) {
      var m = err && (err.message || (err.body && err.body.message));
      try { var o = JSON.parse(m); if (o && typeof o === 'object') return o; } catch (e) { /* not ours */ }
      return null;
    }
    // THE MENU'S HIGHLIGHT (settings.py ACCENTS; hk-base.js has the same
    // values): Apple's system colours, as in dark mode
    var ACCENTS = [['orange', 'Orange', '#ff9f0a'], ['yellow', 'Yellow', '#ffd60a'], ['green', 'Green', '#30d158'],
                   ['mint', 'Mint', '#63e6e2'], ['teal', 'Teal', '#40c8e0'], ['cyan', 'Cyan', '#64d2ff'],
                   ['blue', 'Blue', '#0a84ff'], ['indigo', 'Indigo', '#5e5ce6'], ['purple', 'Purple', '#bf5af2'],
                   ['pink', 'Pink', '#ff375f'], ['red', 'Red', '#ff453a']];
    function accentOf(v) {
      v = String(v || 'orange').toLowerCase();
      // Automatic: each page its own color (hk-base.js PAGE_ACCENTS)
      if (v === 'auto') return { name: 'Automatic', hex: '#ff9f0a', custom: false, auto: true };
      for (var i = 0; i < ACCENTS.length; i++) if (ACCENTS[i][0] === v) return { name: ACCENTS[i][1], hex: ACCENTS[i][2], custom: false };
      return /^#[0-9a-f]{6}$/.test(v) ? { name: 'Custom', hex: v, custom: true } : { name: 'Orange', hex: '#ff9f0a', custom: false };
    }

    // what the shell and the later parts use of this one
    K.ACC_TYPES = ACC_TYPES; K.accentOf = accentOf; K.ACCENTS = ACCENTS; K.accType = accType; K.BG_LABELS = BG_LABELS;
    K.BG_SAYS = BG_SAYS; K.BLUR_MODES = BLUR_MODES; K.BRIGHT_MODES = BRIGHT_MODES; K.BRIGHT_PAGES = BRIGHT_PAGES;
    K.BROWSE_LABELS = BROWSE_LABELS; K.BUTTON_PHONE = BUTTON_PHONE; K.CAL_COLORS = CAL_COLORS;
    K.CAR_LAYOUTS = CAR_LAYOUTS; K.CAR_WIDTH = CAR_WIDTH; K.CAR_WIDTHS = CAR_WIDTHS;
    K.carWidthChoice = carWidthChoice; K.CHIP_LABELS = CHIP_LABELS; K.CHIP_SOURCES = CHIP_SOURCES;
    K.CLOCK_BGS = CLOCK_BGS; K.CLOCK_COLORS = CLOCK_COLORS; K.CLOCK_STYLES = CLOCK_STYLES;
    K.clockRecommend = clockRecommend; K.CLOSE_AFTER = CLOSE_AFTER; K.CLOUD_STYLES = CLOUD_STYLES;
    K.colorLabel = colorLabel; K.COUNT_KINDS = COUNT_KINDS; K.DAYTIME_SKIES = DAYTIME_SKIES; K.errorText = errorText;
    K.GLASS = GLASS; K.GLASS_STYLES = GLASS_STYLES; K.glassStyle = glassStyle; K.haName = haName;
    K.HEADER_PAGES = HEADER_PAGES; K.headerOffOn = headerOffOn; K.isBlur = isBlur; K.isBright = isBright;
    K.LANDSCAPE_EVERY = LANDSCAPE_EVERY; K.landscapeFile = landscapeFile; K.landscapeLabel = landscapeLabel;
    K.LIVELY = LIVELY; K.LIVELY_ALL = LIVELY_ALL; K.LIVELY_OFTEN = LIVELY_OFTEN; K.LIVELY_PRESETS = LIVELY_PRESETS;
    K.LIVELY_STEPS = LIVELY_STEPS; K.livelyFrom = livelyFrom; K.livelyKnobs = livelyKnobs;
    K.livelyOccLabel = livelyOccLabel; K.livelyPresetLabel = livelyPresetLabel; K.MENU_STYLES = MENU_STYLES;
    K.modesFor = modesFor; K.MONTHS = MONTHS; K.OFTEN_DEFAULT = OFTEN_DEFAULT; K.OFTEN_LABELS = OFTEN_LABELS;
    K.PAGE_ACCENTS = PAGE_ACCENTS; K.PAGE_FEATURES = PAGE_FEATURES; K.PAGE_LABELS = PAGE_LABELS;
    K.PAGE_PILL_DEFAULTS = PAGE_PILL_DEFAULTS; K.PAGE_TYPES = PAGE_TYPES; K.pageAccentOf = pageAccentOf;
    K.pageOf = pageOf; K.pageOfRoute = pageOfRoute; K.PAGES = PAGES; K.pagesListed = pagesListed;
    K.phoneStyleLabel = phoneStyleLabel; K.PILL_COLORS = PILL_COLORS; K.PN = PN; K.POPUP_KINDS = POPUP_KINDS;
    K.PRESETS = PRESETS; K.refusals = refusals; K.roomSensors = roomSensors; K.routeForward = routeForward;
    K.screenShows = screenShows; K.SKY_BACKGROUNDS = SKY_BACKGROUNDS; K.SKY_MOVING = SKY_MOVING;
    K.SKY_THEMES = SKY_THEMES; K.STATUS_LABELS = STATUS_LABELS; K.STATUS_ROWS = STATUS_ROWS;
    K.STATUS_SAYS = STATUS_SAYS; K.STATUS_SOURCE = STATUS_SOURCE; K.statusSummary = statusSummary;
    K.stylesFor = stylesFor; K.styleValue = styleValue; K.SWIPE_PAGES = SWIPE_PAGES;
    K.SWIPE_PAGES_SAYS = SWIPE_PAGES_SAYS; K.swipeChanges = swipeChanges; K.TAB_STYLES = TAB_STYLES;
    K.THERMOSTAT_STYLES = THERMOSTAT_STYLES; K.TILE_ICONS = TILE_ICONS; K.TILE_STYLES = TILE_STYLES;
    K.TINT_WELLS = TINT_WELLS; K.WALLPAPER_MOTION = WALLPAPER_MOTION; K.WALLPAPER_NIGHT = WALLPAPER_NIGHT;
    K.WOODLAND = WOODLAND; K.woodlandSummary = woodlandSummary;
  };
})();
