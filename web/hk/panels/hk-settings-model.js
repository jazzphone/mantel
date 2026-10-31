// hk-settings-model.js -- WHAT THE HK SETTINGS PAGE SAYS AND DECIDES, with
// no page in it. The words every row uses, the choices,
// and the small pure functions that turn a stored value into what a row
// shows and a row's change back into what is saved. The page
// (hk-settings.js) draws; this decides -- and tests/test_settingsmodel.js
// holds it to every rule without a browser.
//
// THE RULES THE PAGE KEEPS (docs/HK-Settings.md, "How the controls behave"):
//   * One place for each setting. A screen's list is ONE list: which, and in
//     what order (never split across two tabs).
//   * A screen value that can follow All Screens says so ("Same as All
//     Screens (Blur)") and can go back to it.
//   * Automatic is a switch, not a state you fall out of by touching a row.
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  if (root.hkSettingsModel) return;

  // the product's name, and Home Assistant's own things, as the host says
  // them (web/client/hk-host-shell.js): HK Frontend in HA, the host's own elsewhere
  function PN() { return root.hkShell.productName(); }
  function haName(name) { return root.hkShell.haName(name); }

  // ------------------------------------------------------------------ words
  var CHIP_LABELS = {
    weather_alert: 'Weather Alerts', security: 'Security', doors_windows: 'Doors & Windows', climate: 'Climate',
    lights: 'Lights', blinds: 'Blinds', timers: 'Timers', vacuums: 'Vacuums', speakers: 'Speakers',
    water: 'Water', energy: 'Energy'
  };
  // What each chip counts, and where that is set: Status & Chips kinds, or a
  // single setting (General, Weather).
  var CHIP_SOURCES = {
    weather_alert: { setting: ['page/weather/sensors', 'Weather Alerts Sensor'] },
    security: { kinds: ['locks', 'garage'], setting: ['page/security', 'Alarm Panel'] },
    doors_windows: { kinds: ['doors', 'windows'] },
    climate: { kinds: ['thermostats', 'fans'], setting: ['here', 'Indoor Temperature'] },
    lights: { kinds: ['lights'] }, blinds: { kinds: ['blinds'] }, timers: { kinds: ['timers'] },
    vacuums: { kinds: ['vacuums'] }, speakers: { kinds: ['speakers'] }, water: { kinds: ['leaks'] },
    energy: { setting: ['here', 'Power Use'] }
  };
  var PAGE_LABELS = {
    weather: 'Weather', calendar: 'Calendar', cameras: 'Cameras', live_tv: 'Live TV', security: 'Security',
    doors_windows: 'Doors & Windows', climate: 'Climate', lights: 'Lights', timers: 'Timers',
    vacuums: 'Vacuums', music: 'Music', browse: 'Browse Music', water: 'Water', energy: 'Energy', power: 'Power', rooms: 'Room Pages'
  };
  // Each kind: key, name, the detail page’s description, and the list page’s
  // sub-line -- what the kind feeds, in the chips’ and pages’ own words.
  var COUNT_KINDS = [
    ['smoke', 'Smoke & CO', 'Smoke and carbon monoxide alarms. When one goes off, the Smoke & CO chip appears in red at the start of every screen’s chip row — whatever chips the screen shows. Anything else that should set it off — a gas detector, say — can be added explicitly.', 'The Smoke & CO chip appears first, in red, when one goes off.'],
    ['temperature', 'Temperature', 'Room-related temperature sensors, or a thermostat’s current reading where a room has no related sensor. Other sensors can be added explicitly.', 'The Climate page’s temperature range.'],
    ['humidity', 'Humidity', 'Room-related humidity sensors, or a thermostat’s current humidity where a room has no related sensor. Other sensors can be added explicitly.', 'The Climate page’s humidity range.'],
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
    ['speakers', 'Speakers', 'Media players that aren’t TVs or receivers (or Music’s rooms, when it’s added). The Speakers chip counts the ones playing.', 'The Speakers chip counts the ones playing.'],
    ['motion', 'Motion', 'Motion sensors. The status rows of Doors & Windows and Security say which rooms have motion.', 'Doors & Windows’ and Security’s status rows.'],
    ['occupancy', 'Occupancy', 'Occupancy and presence sensors. The status rows say which rooms are occupied.', 'Doors & Windows’ and Security’s status rows.'],
    ['valves', 'Valves', 'Water valves: a sprinkler, the house’s main water. Not gas valves. The Water page lists them and its status row says which are running.', 'The Water page and its status row.']
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
    ['landscapes', 'Landscapes', false, 'Photographs']];
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
    landscapes: 'Fifty landscape photos that come with ' + PN() + ' — mountains, lakes, coasts, forests, the northern lights — a new one each time the screen wakes, on a schedule, or the same one. No sun, moon, stars, weather or decorations.',
    // (2026-10-30) our own art, hk-wallpapers.js
    wallpaper: 'Twelve wallpapers of soft ribbons, petals, glass shards and pinwheels, in six colors, each with a darker version for the night. The cards take their color. Best with Bright Glass. No sun, moon, stars, weather or decorations.'
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
    ['switches', 'Switches & Outlets', 'mdi:power-socket-us', '#ff9500', { domains: ['switch', 'input_boolean'] },
     'Their tiles on Home and their rooms’ pages. One that powers a lamp can count as a light: open it and turn on Also Count As.'],
    ['fans', 'Fans', 'mdi:fan', '#32ade6', { kind: 'fans' }],
    ['thermostats', 'Thermostats', 'mdi:thermostat', '#ff9500', { kind: 'thermostats' }],
    ['humidifiers', 'Humidifiers', 'mdi:air-humidifier', '#30b0c7', { domains: ['humidifier'] }, 'Their tiles on Home, their rooms’ pages and the Climate page.'],
    ['water_heaters', 'Water Heaters', 'mdi:water-boiler', '#ff3b30', { domains: ['water_heater'] },
     'Their tiles on Home and their rooms’ pages. To put one on the Climate page, open it and turn on Also Count As → Thermostats.'],
    ['blinds', 'Blinds & Shades', 'mdi:blinds', '#5856d6', { kind: 'blinds' }],
    ['garage', 'Garage Doors', 'mdi:garage', '#34c759', { kind: 'garage', order: 'security' }],
    ['locks', 'Locks', 'mdi:lock', '#34c759', { kind: 'locks', order: 'security' }],
    ['alarm', 'Security Systems', 'mdi:shield-home', '#ff3b30', { domains: ['alarm_control_panel'], link: ['Alarm Panel', 'page/security', 'Which one the Security page and chip follow is chosen on the Security page, under Pages.'] },
     'The alarm keypad on its room’s page and the Security page.'],
    ['speakers', 'Speakers', 'mdi:speaker', '#af52de', { kind: 'speakers' }],
    ['tvs', 'TVs & Receivers', 'mdi:television', '#8e8e93', { domains: ['media_player'], dc: ['tv', 'receiver'] },
     'Their tiles on Home and their rooms’ pages. The Speakers chip leaves them out.'],
    ['vacuums', 'Vacuums', 'mdi:robot-vacuum', '#30b0c7', { kind: 'vacuums', order: 'vacuums' }],
    ['valves', 'Valves', 'mdi:valve', '#007aff', { kind: 'valves' }],
    ['timers', 'Timers', 'mdi:timer-outline', '#ff9500', { kind: 'timers' }],
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
    ['blur_pre', 'Pre-rendered (Experimental)', 'Experimental: it can still trail or miss a change now and then. A picture of the sky, blurred once and painted again as the sky changes. The lightest blur, and the smoothest scrolling on a wall tablet. Drifting clouds catch up every 2 seconds and the light within a minute; rain, snow and a passing flock don’t show through the glass.'],
    ['blur_each', 'Each Card', 'Live: every card blurs what’s behind it, so a sheet or a scrolling row never leaves its frost behind. The heaviest — for phones, iPads and computers, not wall tablets.']
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
  // TILE STYLE (look.tile_style, a screen's tile_style; 2026-10-30): the Home
  // Grid's tiles and the room pages' Tall pills (settings.py TILE_STYLES)
  // Automatic (the default): Centred on square cells, Home on tiles and the room pages
  var TILE_STYLES = [['auto', 'Automatic'], ['home', 'Home'], ['centred', 'Centered']];
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
                     ['car', 'Car Home', 'The weather and the house’s status along the top — the car shows the time — then the chips, Scenes, Security (the garage, alarm and locks as tall tiles) and Favorites — and the camera strip, if it’s on. No rooms.']];
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
               defaults: { show: true, counters: null } }
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
  // SWIPE BETWEEN PAGES (menu.swipe_pages / a screen's swipe_pages; hk-pageswipe.js)
  var SWIPE_PAGES = [['auto', 'Automatic'], ['on', 'On'], ['off', 'Off']];
  var SWIPE_PAGES_SAYS = { auto: 'Where a tab bar shows, a sideways swipe goes to the next or the previous tab’s page.',
                           on: 'A sideways swipe goes to the next or the previous page: the tab bar’s, or the side menu’s Home and Categories.',
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
    grid_overlap: 'Two blocks are in the same place.', grid_pages: 'A block’s pages couldn’t be read.',
    grid_condition: 'Choose a condition and a fallback card.', grid_fallback: 'Choose a fallback card that supports this block’s size.',
    grid_source: 'That card can’t swipe through those pages.', grid_option: 'A block’s option isn’t one it can use.'
  };
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

  // ------------------------------------------------------------- the menu
  function menuMode(b) {
    return b.menu === 'off' || b.menu === 'open' || b.menu === 'tabbar' ? b.menu : 'button';
  }
  // Switching the segmented control: a button keeps the style it had.
  function menuFor(mode, b, last) {
    if (mode === 'off' || mode === 'open' || mode === 'tabbar') return mode;
    return menuMode(b) === 'button' ? b.menu : (last || 'auto');
  }
  // THE TAB BAR (hk-tabbar.js): the screen's Menu "Tab Bar", or the side
  // menu with "Tab Bar" where it folds -- does this screen ever show it?
  function hasTabBar(b) { return !!b && (tabletTabBar(b) || phoneMenu(b) === 'tabbar'); }
  function tabletTabBar(b) { return !!b && b.menu === 'tabbar'; }
  // PHONES' OWN MENU (2026-10-08; hk-base.js phoneMenu, settings.py
  // BOARD_PHONE_MENUS): a phone -- an iPhone or an Android phone either way
  // up, or a window under 640 px -- and a tablet whose own menu doesn't fit
  // (2026-10-09, hk-base.js phoneForm) show the screen's Phones menu: off, a
  // button, or the tab bar. Unset: the tablets' when that is off or the tab
  // bar, else a button.
  var PHONE_MENUS = [['off', 'Off'], ['button', 'Button'], ['tabbar', 'Tab Bar']];
  // THE DEVICES, said the same way on every page
  var DEVICES = {
    phones: 'An iPhone or an Android phone, either way up, or a window narrower than 640 px.',
    tablets: 'An iPad, a wall tablet or a computer.',
    // the one sentence for where a tablet's menu doesn't fit
    fold: 'Where its menu doesn’t fit — an iPad held upright, Split View — a tablet shows the Phones menu.'
  };
  // the edge tab's sizes, a tablet's and a phone's (settings.py BOARD_TAB_SIZES)
  var TAB_SIZES = [['standard', 'Standard'], ['large', 'Large'], ['xl', 'Extra Large']];
  function phoneMenu(b) {
    var m = b && b.menu_phone;
    if (m === 'off' || m === 'button' || m === 'tabbar') return m;
    if (!b) return 'off';
    return b.menu === 'off' || b.menu === 'tabbar' ? b.menu : 'button';
  }
  // ...its button's style
  function phoneButton(b) {
    var v = (b && b.button_phone) || 'chip';
    return v === 'chip_scroll' || v === 'tab' || v === 'none' ? v : 'chip';
  }
  // one line for each device's row: a screen's (its menu, then the style)
  // or All Screens' (`house`: the style alone -- whether a screen has a menu
  // is its own)
  function tabletSummary(b, house) {
    if (house) return menuStyleLabel(b.menu);
    var m = menuMode(b);
    // a button's style names a button already: "Chip, Then Tab"
    return m === 'off' ? 'Off' : m === 'open' ? 'Always Open' : m === 'tabbar' ? 'Tab Bar' : menuStyleLabel(b.menu);
  }
  function phoneSummary(b, house) {
    if (house) return phoneStyleLabel(phoneButton(b));
    var m = phoneMenu(b);
    return m === 'off' ? 'Off' : m === 'tabbar' ? 'Tab Bar' : phoneStyleLabel(phoneButton(b));
  }
  var TAB_BAR_SCROLLS = [['shrink', 'Shrink'], ['hide', 'Hide'], ['stay', 'Stay']];
  var TAB_BAR_MORE = [['icons', 'Icons'], ['list', 'List']];
  var TAB_BAR_SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']];
  var TAB_BAR_LABELS = [['show', 'Icons and Names'], ['icons', 'Icons Only']];
  // where the Home Assistant section sits, in the side menu and More alike
  var HA_PLACES = [['top', 'Top'], ['categories', 'Above Categories'], ['rooms', 'Above Rooms'], ['bottom', 'Bottom']];
  // Tabs in Bar / in Rail: pages, Home and More not counted
  var TAB_BAR_TABS = [[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8']];
  // a phone's (settings.py TAB_BAR_TABS_PHONE): six tabs at most on a 402 px iPhone, Home and More among them
  var TAB_BAR_TABS_PHONE = [[2, '2'], [3, '3'], [4, '4']];
  var TAB_BAR_POS = [['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']];
  // SHRINKS TO, named by the bar's direction: a bar's left or right, a
  // rail's top or bottom (stored as its start or end)
  function foldOptions(pos) {
    return pos === 'left' || pos === 'right' ? [['start', 'Top'], ['end', 'Bottom']] : [['start', 'Left'], ['end', 'Right']];
  }
  var TAB_BAR_ROOMS = [['more', 'In More'], ['button', 'Own Button'], ['off', 'Off']];
  // a boolean from the first form: true is In More
  function roomsPlace(v) { return v === false || v === 'off' ? 'off' : v === 'button' ? 'button' : 'more'; }
  // ('tinted' was stored as 'clear' before entry 1.12: Appearance's
  // see-through glass is 'clear')
  var TAB_BAR_GLASS = [['house', 'Same as Screen'], ['blur', 'Blur'], ['frosted', 'Frosted'], ['tinted', 'Tinted'],
                       ['bright', 'Bright Glass']];
  function choiceLabel(list, v) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1];
    return v;
  }
  function menuStyleLabel(v) {
    for (var i = 0; i < MENU_STYLES.length; i++) if (MENU_STYLES[i][0] === v) return MENU_STYLES[i][1];
    return v;
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
  // ACCENT COLOR (2026-10-29, Phase 3): one choice for the menu's highlight
  // and Flat's accent -- Automatic (in Flat, Flat's own; elsewhere each
  // page's color), the eleven colors, or your own. Saved as the menu's
  // accent (menu.accent, a screen's `accent`) and the same value as Flat's
  // (flat_colors.accent), so the two never part again. An accent Flat kept
  // apart before stays as it was saved: shown here while Flat is in use, and
  // a Flat screen's own as Just This Screen.
  // -> {value, name, hex (null: Automatic), own, house: the same for All
  // Screens}. `look`: settings.look; `menu`: settings.menu; `b`: a screen
  // (as read) or null for All Screens; `flat`: Flat in use there.
  function accentColorOf(look, menu, b, flat, houseFlat) {
    look = look || {};
    var said = function (v) { return { value: v, name: v === 'auto' ? 'Automatic' : flatColorName(v), hex: flatColorHex(v) }; };
    var hfa = ((look.flat_colors || {}).accent) || 'auto';
    var hv = houseFlat && hfa !== 'auto' ? hfa : String((menu || {}).accent || 'orange').toLowerCase();
    var house = said(hv);
    if (!b) return Object.assign(house, { own: false, house: house });
    var fown = (b.flat_colors || {}).accent;
    var own = ownsMenu(b, 'accent') || fown != null;
    var fa = fown != null ? fown : hfa;
    var v = flat && fa !== 'auto' ? fa : String(b.accent || 'orange').toLowerCase();
    return Object.assign(said(v), { own: own, house: house });
  }
  // CHOOSING IT: both, in one write -- {house: setH's changes} or {screen:
  // setB's}; in Flat, Off Pill Tint left Automatic follows a chosen color
  // (flatAccentChange). `v` null: back to All Screens' (a screen).
  function accentChanges(v, b, tintAuto) {
    if (!b) {
      var h = { 'menu.accent': v, 'look.flat_colors.accent': v };
      if (v !== 'auto' && tintAuto) h['look.flat_colors.off_tint'] = 'accent';
      return h;
    }
    if (v == null) return Object.assign(menuOwnReset(b, 'accent'), { 'flat_colors.accent': null });
    var s = Object.assign(menuOwnSet(b, { accent: v }), { 'flat_colors.accent': v });
    if (v !== 'auto' && tintAuto) s['flat_colors.off_tint'] = 'accent';
    return s;
  }
  // FLAT COLORS (2026-10-17; settings.py flat_colors, hk-settings.js
  // resolveFlatColors): Accent Color's presets -- hk-base.js FLAT_ACCENTS,
  // the same list (tests/test_flatcolors.js)
  var FLAT_ACCENTS = [['amber', 'Amber', '#e09649'], ['sage', 'Sage', '#7e9b83'], ['harbor', 'Harbor', '#5c91bc'],
                      ['lavender', 'Lavender', '#9374bc'], ['rose', 'Rose', '#c17d91'], ['slate', 'Slate', '#64798e'],
                      ['teal', 'Teal', '#599b9c'], ['clay', 'Clay', '#ad8972']];
  // a screen's (or All Screens') Flat Colors at `keys`, as the dashboard
  // resolves them -- the same function, so the two can't disagree
  function flatColorsOf(look, b, keys) {
    var S = window.hkSettings;
    return S && S.resolveFlatColors ? S.resolveFlatColors(look, b, keys)
         : { accent: { value: 'auto', scope: 'default', page: null }, off_tint: { value: 'auto', scope: 'default', page: null },
             pages: { value: 'accent', scope: 'default', page: null } };
  }
  // a resolved accent in a word: a page keeping its own color says so
  function flatAccentSays(f) { return f && f.scope === 'own-page' ? 'Its Own Color' : flatColorName(f && f.value); }
  // Flat Colors' `pages` in a word
  function flatPagesName(v) { return v === 'own' ? 'Own Colors' : 'Follow Accent'; }
  // a Flat Colors value in a word: a preset by its name, Apple's by theirs
  function flatColorName(v) {
    v = String(v || 'auto').toLowerCase();
    if (v === 'auto') return 'Automatic';
    if (v === 'accent') return 'Match Accent';
    for (var i = 0; i < FLAT_ACCENTS.length; i++) if (FLAT_ACCENTS[i][2] === v) return FLAT_ACCENTS[i][1];
    for (var j = 0; j < ACCENTS.length; j++) if (ACCENTS[j][0] === v || ACCENTS[j][2] === v) return ACCENTS[j][1];
    return /^#[0-9a-f]{6}$/.test(v) ? 'Custom' : 'Automatic';
  }
  // ...and as a swatch (null: none -- Automatic, Match Accent)
  function flatColorHex(v) {
    v = String(v || '').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    for (var j = 0; j < ACCENTS.length; j++) if (ACCENTS[j][0] === v) return ACCENTS[j][2];
    for (var i = 0; i < FLAT_ACCENTS.length; i++) if (FLAT_ACCENTS[i][0] === v) return FLAT_ACCENTS[i][2];
    return null;
  }
  // WHERE A RESOLVED FIELD COMES FROM, in words: "All Screens", "This
  // Screen", "Calendar on All Screens", "Kitchen on This Screen" ('' for the
  // built-in Automatic). o.label(key): a page's or room's name.
  function flatSourceLabel(f, o) {
    o = o || {};
    var name = function (k) {
      var l = o.label && o.label(k);
      if (l) return l;
      if (k === 'rooms') return 'Room Pages';
      if (/^room-/.test(k)) return k.slice(5).replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      return SKY_PAGE_LABELS[k] || PAGE_LABELS[k] || k;
    };
    if (!f || f.scope === 'default') return '';
    if (f.scope === 'house') return 'All Screens';
    if (f.scope === 'screen') return 'This Screen';
    if (f.scope === 'house-page') return name(f.page) + ' on All Screens';
    if (f.scope === 'screen-page') return name(f.page) + ' on This Screen';
    if (f.scope === 'own-page') return 'Pages Keep Their Own Colors';
    return 'Preview';
  }
  // a photo's Tint in a word (Sky / Background -> Tint)
  function flatTintLabel(v) { return v === 'accent' ? 'Match Accent' : /^#/.test(v || '') ? 'Your Own' : 'None'; }
  // "Sage · All Screens"
  function flatFieldSays(f, o) {
    var src = flatSourceLabel(f, o);
    return flatColorName(f.value) + (src ? ' · ' + src : '');
  }
  // CHOOSING AN ACCENT is one coordinated change: where the tint in effect
  // is Automatic, it links to the accent in the same write; a tint already
  // matched, or a color of its own (here or inherited), is left as it is.
  // `r`: the scope's resolved colors before the change.
  function flatAccentChange(value, r) {
    var out = { accent: value };
    if (value !== 'auto' && r && r.off_tint && r.off_tint.value === 'auto') out.off_tint = 'accent';
    return out;
  }
  // TAB POSITION as two choices: level with the date ('') or a distance from
  // the top in px or % (settings.py tab_position) -- [mode, number, unit]
  function tabPosParts(v) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$/.exec(String(v || ''));
    return m ? { mode: 'custom', n: m[1], unit: m[2] || 'px' } : { mode: 'date', n: '', unit: 'px' };
  }
  function tabPosJoin(n, unit) {
    var t = String(n == null ? '' : n).replace(/[^\d.]/g, '');
    return t ? t + (unit === '%' ? '%' : 'px') : '';
  }
  function tabPosLabel(v) {
    var p = tabPosParts(v);
    return p.mode === 'date' ? 'Level with Date' : p.n + (p.unit === '%' ? ' % from Top' : ' px from Top');
  }
  // ALL SCREENS' MENU (settings `menu`) as a screen's keys, and back
  // (settings.py MENU_KEYS): the same rows serve both
  // BACK BUTTON & TITLE (Page Header before 2026-10-29): beside a screen's
  // other header settings
  var PAGE_HEADERS = [['current', 'Back & Title'], ['smart', 'Context When Needed'], ['none', 'No Header']];
  var PAGE_HEADER_SAYS = 'With the side menu open or a tab bar, Context When Needed drops a repeated title and keeps a short label; No Header removes both. The full header returns when the menu folds into a button.';
  var MENU_KEYS = { page_header: 'page_header', menu: 'style', tab_position: 'tab_at', tab_size: 'tab_size',
                    tab_size_phone: 'tab_size_phone', dock_min: 'open_min', time_weather: 'time_weather_at',
                    ha_row: 'ha_row', ha_place: 'ha_at', accent: 'accent', glyph: 'glyph', clock: 'clock', swipe: 'swipe',
                    tab_bar_scroll: 'bar_scroll', tab_bar_rooms: 'bar_rooms', tab_bar_glass: 'bar_glass',
                    tab_bar_more: 'bar_more', tab_bar_more_phone: 'bar_more_phone',
                    tab_bar_pos: 'bar_pos', tab_bar_fold: 'bar_fold', tab_bar_start: 'bar_start',
                    tab_bar_adjust: 'bar_adjust', tab_bar_scroll_phone: 'bar_scroll_phone',
                    tab_bar_tabs: 'bar_tabs', tab_bar_tabs_rail: 'bar_tabs_rail', tab_bar_size: 'bar_size', tab_bar_labels: 'bar_labels',
                    tab_bar_tabs_phone: 'bar_tabs_phone', tab_bar_strip: 'bar_strip',
                    button_phone: 'button_phone', tab_bar_rooms_phone: 'bar_rooms_phone' };
  var MENU_DEFAULTS = { page_header: 'current', menu: 'auto', tab_position: '', tab_size: 'large', tab_size_phone: 'standard',
                        dock_min: 1000, time_weather: 'page', ha_row: false, ha_place: 'rooms', accent: 'orange', glyph: 'sidebar', clock: true,
                        swipe: false, tab_bar_scroll: 'shrink', tab_bar_rooms: 'more', tab_bar_glass: 'house',
                        tab_bar_more: 'icons', tab_bar_more_phone: 'list', tab_bar_pos: 'bottom',
                        tab_bar_fold: 'start', tab_bar_start: 'full', tab_bar_adjust: true,
                        tab_bar_scroll_phone: 'shrink', tab_bar_tabs: 6, tab_bar_tabs_rail: 6, tab_bar_tabs_phone: 3,
                        tab_bar_size: 'medium', tab_bar_labels: 'show', tab_bar_strip: true, button_phone: 'chip', tab_bar_rooms_phone: 'more' };
  function houseMenuAsBoard(m) {
    m = m || {};
    var out = {};
    Object.keys(MENU_KEYS).forEach(function (k) {
      var v = m[MENU_KEYS[k]];
      out[k] = v === undefined || v === null ? MENU_DEFAULTS[k] : v;
    });
    out.clock = out.clock !== false;
    out.swipe = out.swipe === true;
    out.tab_bar_rooms = roomsPlace(out.tab_bar_rooms);
    out.tab_bar_adjust = out.tab_bar_adjust !== false;
    out.tab_bar_strip = out.tab_bar_strip !== false;
    out.tab_bar_rooms_phone = roomsPlace(out.tab_bar_rooms_phone);
    if (out.tab_bar_glass === 'clear') out.tab_bar_glass = 'tinted';
    return out;
  }
  function houseMenuSave(ch) {
    var out = {};
    Object.keys(ch).forEach(function (k) { if (MENU_KEYS[k]) out['menu.' + MENU_KEYS[k]] = ch[k]; });
    return out;
  }
  // A SCREEN'S MENU, ONE SETTING AT A TIME (2026-10-29, settings.py
  // menu_own), as Appearance follows All Screens: which of its menu
  // settings are its own -- the rest are All Screens'. A screen still read
  // with menu_custom (not moved yet) owns them all, as it did.
  function menuOwn(b) {
    if (!b) return [];
    var keys = Object.keys(MENU_KEYS);
    if (Array.isArray(b.menu_own)) return keys.filter(function (k) { return b.menu_own.indexOf(k) >= 0; });
    return b.menu_custom === true ? keys : [];
  }
  function ownsMenu(b, k) { return menuOwn(b).indexOf(k) >= 0; }
  // a change to a screen's menu settings: each becomes its own (Just This
  // Screen); `menu` itself only as a button's style
  function menuOwnSet(b, ch) {
    var own = menuOwn(b), out = Object.assign({}, ch);
    Object.keys(ch).forEach(function (k) { if (MENU_KEYS[k] && own.indexOf(k) < 0) own.push(k); });
    out.menu_own = Object.keys(MENU_KEYS).filter(function (k) { return own.indexOf(k) >= 0; });
    return out;
  }
  // ...and back to All Screens' (Reset to All Screens)
  function menuOwnReset(b, keys) {
    keys = [].concat(keys);
    return { menu_own: menuOwn(b).filter(function (k) { return keys.indexOf(k) < 0; }) };
  }
  // one line for a row that opens some of a screen's menu settings (`keys`:
  // those; all of them when left out)
  function menuSummary(b, keys) {
    var own = menuOwn(b).filter(function (k) { return !keys || keys.indexOf(k) >= 0; });
    return !own.length ? 'Same as All Screens' : own.length === 1 ? '1 Own Setting' : own.length + ' Own Settings';
  }
  // THE KINDS OF MENU (All Screens -> Menu, 2026-10-29): the side menu (a
  // button or always open, on either device), the edge tab, the tab bar --
  // each a page of everything about it. A screen (as read) uses a kind on
  // either device.
  function usesSide(b) { var m = menuMode(b); return m === 'button' || m === 'open' || phoneMenu(b) === 'button'; }
  var MENU_KINDS = [['side', 'Side Menu', usesSide], ['edge-tab', 'Edge Tab', function (b) { return showsTab(b); }],
                    ['tab-bar', 'Tab Bar', function (b) { return hasTabBar(b); }]];
  function menuKind(id) { return MENU_KINDS.filter(function (k) { return k[0] === id; })[0] || null; }
  // the screens that use a kind ([{path, title}] -> their titles)
  function kindUsers(id, boards, titleOf) {
    var k = menuKind(id);
    return !k ? [] : Object.keys(boards || {}).filter(function (p) { return boards[p] && k[2](boards[p]); })
      .map(function (p) { return titleOf ? titleOf(p) : p; });
  }
  // ...as a row's value: who uses it
  function usedBy(names) {
    if (!names.length) return 'Not used on any screen';
    return names.length <= 2 ? names.join(', ') : names.length + ' Screens';
  }
  // A SCREEN'S MENU ON EACH DEVICE in words: "Tab Bar on Both" when they
  // are the same, else "Button, Tab Bar on Phones" (2026-10-30: never
  // "Button · Button")
  function menuWord(b) {
    var m = menuMode(b), p = phoneMenu(b);
    var t = m === 'off' ? 'Off' : m === 'open' ? 'Always Open' : m === 'tabbar' ? 'Tab Bar' : 'Button';
    var ph = p === 'off' ? 'Off' : p === 'tabbar' ? 'Tab Bar' : 'Button';
    return t === ph ? (t === 'Off' ? 'Off' : t + ' on Both') : t + ', ' + ph + ' on Phones';
  }
  // which menu settings each kind's page holds (a screen's Reset there)
  var KIND_KEYS = {
    side: ['menu', 'button_phone', 'glyph', 'dock_min', 'time_weather', 'swipe', 'clock', 'ha_row', 'ha_place'],
    'edge-tab': ['tab_position', 'tab_size', 'tab_size_phone'],
    'tab-bar': ['tab_bar_pos', 'tab_bar_size', 'tab_bar_labels', 'tab_bar_strip', 'tab_bar_scroll', 'tab_bar_scroll_phone', 'tab_bar_fold',
                'tab_bar_start', 'tab_bar_adjust', 'tab_bar_tabs', 'tab_bar_tabs_phone', 'tab_bar_tabs_rail', 'tab_bar_more',
                'tab_bar_more_phone', 'tab_bar_rooms', 'tab_bar_rooms_phone', 'ha_row', 'ha_place']
  };
  // THE EDGE TAB, on each device: a tablet's button or folded menu, a
  // phone's button
  function tabletTab(b) {
    var m = menuMode(b);
    if (m === 'off' || m === 'tabbar') return false;
    return m === 'button' && !!TAB_STYLES[b.menu];
  }
  function phoneTab(b) {
    var s = phoneButton(b);
    return phoneMenu(b) === 'button' && (s === 'tab' || s === 'chip_scroll');
  }
  function showsTab(b) { return tabletTab(b) || phoneTab(b); }

  // ------------------------------------------------------------ the glass
  function glassLabel(v) {
    for (var i = 0; i < GLASS.length; i++) if (GLASS[i][0] === v) return GLASS[i][1];
    return v;
  }
  // ...as a row's value, the style alone ("Bright Glass", not "Bright Glass
  // · Shared Layer": its mode is on the Style page)
  function glassShort(v) {
    return isBlur(v) ? 'Blur' : isBright(v) ? 'Bright Glass' : glassLabel(v);
  }
  // this screen's glass: its own, or All Screens'
  function glassOf(b, look) {
    var own = !!b.glass && b.glass !== 'house';
    look = look || {};
    var house = look.flat === true ? 'flat' : (look.glass || 'clear');
    var flat = typeof b.flat === 'boolean' ? b.flat : (!own && look.flat === true);
    own = typeof b.flat === 'boolean' || own;
    var value = flat ? 'flat' : (b.glass && b.glass !== 'house' ? b.glass : look.glass || 'clear');
    return { own: own, value: own ? value : 'house', effective: value, house: house };
  }
  // an amount: this screen's own (a number), else All Screens'
  function amountOf(b, look, key) {
    var own = b[key] !== null && b[key] !== undefined && b[key] !== '';
    var house = look && typeof look[key] === 'number' ? look[key] : 50;
    return { own: own, value: own ? Number(b[key]) : house, house: house };
  }
  // which amount the glass uses (the others are kept but not shown)
  function amountsFor(effective) {
    return { frost: effective === 'frosted', blur: isBlur(effective), tint: effective === 'tinted', bright: isBright(effective) };
  }
  // the Glass group's footer, for the style shown (All Screens' Appearance
  // and a screen's page say the same)
  function glassFooter(style) {
    var t = 'How the pills, tiles and chips look.';
    if (style === 'flat') return 'Opaque surfaces with no blur, animations or live sky effects. Color, landscape and photo backgrounds remain available in Background. Your other appearance preferences are kept.';
    if (style === 'frosted') t += ' Frost: how milky, 50% is the middle. Tint from Background: each card takes the color of the page behind it instead of one gray.';
    if (isBlur(style)) t += ' Blur: how strong, 50% is 20 px.';
    if (isBright(style)) t += ' Strength: how bright the glass is, 50% as designed. It holds back by itself where white text would get hard to read.';
    if (style === 'tinted') t += ' Darkness: how much of the background shows through, 50% is 75% dark. Icon Circles: Dark as the Home app’s, or Light to keep their shape over dark scenery.';
    return t;
  }
  // A LIGHTER SCREEN FOR A SLOW TABLET (2026-10-29): offered on a screen's
  // Appearance, never applied by itself, ONE suggestion at a time -- a ladder
  // of the settings that cost a weak tablet the most frames, the dearest
  // first (Flat turns off the same things: blur, motion, the live sky and
  // autoplay). The screen's first step that still applies is the one offered:
  //   glass   Blur, Frosted or Tinted -> Glass (hk-glass.js measured 22 blur
  //           surfaces halving the frame rate of a Samsung SM-X230)
  //   rain    the sky's falling Rain & Snow off (the clouds and fog stay)
  //   front   Moving Things in front of the cards -> behind them
  //   anim    Animations off: the sky holds still
  //   camera  Live First Camera off: the first tile is a snapshot
  // Use Flat is the second button on every step but Moving Things.
  //
  // WHAT A NUMBER MEANS. A sample says what was on the screen when it was
  // drawn (its `fps_sig`, hkSettings.ladderSignature(): ladderSignature
  // below); it counts only while the screen's settings still read the same.
  // So after a step is taken nothing more is offered until the tablet has
  // drawn again (hourly) and is still under SLOW_FPS -- then the next step
  // is. A sample from before the ladder has no signature: it speaks for the
  // first step alone, by its style, as it did.
  //
  // `facts`: ladderFacts(); `tablets`: [{name, screens, fps, fps_screen,
  // fps_style, fps_sig, fps_at}] -- each tablet's latest frame rate (5 idle
  // seconds, page-health.js / hk-fps.js), where it was measured when it says,
  // else the screens it shows. A tablet counts for this screen when it
  // measured it (or, saying nothing of where, shows it), with these
  // settings, under SLOW_FPS, in the last FPS_FRESH. The slowest one speaks.
  // null: nothing to recommend (a light screen already, no numbers that
  // match, or all fast enough).
  var SLOW_FPS = 45, FPS_FRESH = 14 * 86400;
  var HEAVY_LOOKS = { blur: 1, frosted: 1, tinted: 1, bright: 1 };
  // the settings the ladder reads, as a screen has them: {style, anim
  // (the sky animates), weather, rain, front (moving things over the cards),
  // camera (the first tile plays live), cams (the screen has a camera strip
  // at all)}. `sky`: All Screens' sky.*; `cams`: {strip, live} -- whether the
  // screen shows a camera strip, and All Screens' Live First Camera. A flag
  // is on only while it costs: nothing under Flat, no sky motion over a still
  // background (hk-settings.js ladderSignature works the same out)
  function ladderFacts(b, look, sky, cams) {
    b = b || {}; sky = sky || {}; cams = cams || {};
    var style = glassOf(b, look).effective, flat = style === 'flat';
    var own = function (bk, hk, dflt) { return b[bk] != null ? b[bk] : (sky[hk] == null ? dflt : sky[hk]); };
    var live = !flat && b.sky !== false && (b.sky_background || sky.background || 'live') === 'live';
    // (a Wallpaper with Motion on moves too, while Animations are on: 2026-10-30)
    var moving = !flat && b.sky !== false && (b.sky_background || sky.background) === 'wallpaper' &&
      (own('sky_wallpaper_motion', 'wallpaper_motion', 'off') || 'off') !== 'off';
    var anim = (live || moving) && own('sky_animations', 'animations', true) !== false;
    var weather = live && own('sky_weather', 'weather', true) !== false;
    return { style: style, anim: anim, weather: weather,
             rain: anim && weather && own('sky_precipitation', 'precipitation', true) !== false,
             front: live && anim && own('sky_moving', 'moving', 'behind') === 'front',
             camera: !flat && (typeof b.camera_live_video === 'boolean' ? b.camera_live_video : cams.live !== false),
             cams: !!cams.strip };
  }
  // the word the sampler sends (hkSettings.ladderSignature): "blur:a1w1r1f0c1"
  function ladderSignature(f) {
    var n = function (v) { return v ? '1' : '0'; };
    return f.style + ':a' + n(f.anim) + 'w' + n(f.weather) + 'r' + n(f.rain) + 'f' + n(f.front) + 'c' + n(f.camera);
  }
  // each step: when it applies, its short name (the row on All Screens'
  // Appearance), the button and the change it makes (this screen's own, never
  // All Screens'), what the facts are after it, whether Use Flat goes with it,
  // what the tablet drew with (`drew`) and what the change gives (`why`)
  var LADDER = [
    { id: 'glass', applies: function (f) { return !!HEAVY_LOOKS[glassStyle(f.style)]; },
      button: 'Use Glass on This Screen', change: { flat: false, glass: 'clear' }, flat: true,
      after: function (f) { return Object.assign({}, f, { style: 'clear' }); } },
    { id: 'rain', applies: function (f) { return f.rain; }, label: 'Rain & Snow',
      drew: 'Rain & Snow on', why: 'Without them the clouds and fog still drift, and it is lighter.',
      button: 'Turn Off Rain & Snow on This Screen', change: { sky_precipitation: false }, flat: true,
      after: function (f) { return Object.assign({}, f, { rain: false }); } },
    { id: 'front', applies: function (f) { return f.front; }, label: 'Moving Things',
      drew: 'Moving Things in front of the cards', why: 'Behind them, they cost less.',
      button: 'Put Moving Things Behind on This Screen', change: { sky_moving: 'behind' }, flat: false,
      after: function (f) { return Object.assign({}, f, { front: false }); } },
    { id: 'anim', applies: function (f) { return f.anim; }, label: 'Animations',
      drew: 'Animations on', why: 'Off, the sky holds still: no drifting clouds, rain or snow, little moving things, or moving wallpaper.',
      button: 'Turn Off Animations on This Screen', change: { sky_animations: false }, flat: true,
      after: function (f) { return Object.assign({}, f, { anim: false, rain: false, front: false }); } },
    { id: 'camera', applies: function (f) { return f.camera && f.cams; }, label: 'Live Camera',
      drew: 'a camera playing live', why: 'Off, its first tile is a snapshot: no video to decode.',
      button: 'Turn Off Live First Camera on This Screen', change: { camera_live_video: false }, flat: true,
      after: function (f) { return Object.assign({}, f, { camera: false }); } }
  ];
  var LADDER_THEN = 'If it’s still slow an hour from now, the next suggestion appears here.';
  function slowRecommend(path, facts, tablets, now) {
    if (!facts || facts.style === 'flat') return null;
    var step = LADDER.filter(function (st) { return st.applies(facts); })[0];
    if (!step) return null;
    var sig = ladderSignature(facts), kind = glassStyle(facts.style), slow = null;
    (tablets || []).forEach(function (t) {
      if (!t || typeof t.fps !== 'number' || !(t.fps < SLOW_FPS)) return;
      var where = t.fps_screen ? t.fps_screen === path : (t.screens || []).indexOf(path) >= 0;
      if (!where) return;
      if (t.fps_sig) { if (t.fps_sig !== sig) return; }
      else if (step.id !== 'glass' || (t.fps_style && (t.fps_style === 'flat' || glassStyle(t.fps_style) !== kind))) return;
      if (now && typeof t.fps_at === 'number' && now - t.fps_at > FPS_FRESH) return;
      if (!slow || t.fps < slow.fps) slow = t;
    });
    if (!slow) return null;
    var fps = Math.round(slow.fps), who = (slow.name || 'A tablet') + ' draws ' + fps + ' frames a second with ';
    var label = step.label, says, then = null;
    if (step.id === 'glass') {
      label = (GLASS_STYLES.filter(function (g) { return g[0] === kind; })[0] || [0, kind])[1];
      says = who + label + '. ' + (kind === 'blur' || kind === 'bright' ? 'Glass looks almost the same and is lighter.'
        : 'Flat is the lightest look: no blur, animations or moving sky.');
    } else says = who + step.drew + '. ' + step.why;
    // the next step, if one would still apply once this one is taken
    var next = step.after(facts);
    if (LADDER.some(function (st) { return st.applies(next); })) then = LADDER_THEN;
    return { name: slow.name, fps: fps, step: step.id, style: kind, label: label, says: says, then: then,
             button: step.button, change: step.change, flat: step.flat };
  }

  // ------------------------------------------------------------ the lists
  // Each list model: { auto, rows: [{value, label?, kind, ...}], more: [...] }
  // `rows` are what shows, in order; `more` what can be added.

  // CHIPS: `chips` orders kinds and own chips (entities); `chips_extra` says
  // which own chips exist; `chips_quiet` which kinds wait for news.
  // CUSTOM CHIPS: the house's own chips in YAML ({key, name,
  // after}); a screen's chips_custom says which it shows, and its chip order
  // may place one as "chip:<key>" -- unplaced, one sits where it says (after a
  // kind, at the start or the end), as the chip row puts it (hk-chip.js).
  var CHIP_TOKEN = 'chip:';
  function isCustomTok(k) { return String(k).indexOf(CHIP_TOKEN) === 0; }
  function libOf(custom) { var o = {}; (custom || []).forEach(function (c) { if (c && c.key) o[c.key] = c; }); return o; }
  // the order the chip row draws: kinds (or the screen's order), own chips
  // after them, then each unplaced custom chip where it says
  function chipOrder(base, extra, mineC, lib) {
    var order = base.slice();
    extra.forEach(function (e) { if (order.indexOf(e) < 0) order.push(e); });
    mineC.forEach(function (k) {
      var t = CHIP_TOKEN + k;
      if (order.indexOf(t) >= 0) return;
      var a = (lib[k] || {}).after, at = a === 'start' ? 0 : order.indexOf(a) + 1;
      if (at <= 0 && a !== 'start') at = order.length;
      order.splice(at, 0, t);
    });
    return order;
  }
  function chipsModel(b, kinds, custom) {
    var lib = libOf(custom);
    var extra = (b.chips_extra || []).slice();
    var mineC = (b.chips_custom || []).filter(function (k) { return lib[k]; });
    var chips = (b.chips || []).filter(function (k) {
      if (isCustomTok(k)) return mineC.indexOf(k.slice(CHIP_TOKEN.length)) >= 0;
      return k.indexOf('.') < 0 || extra.indexOf(k) >= 0;
    });
    var auto = !chips.length;
    var order = chipOrder(auto ? kinds : chips, extra, mineC, lib);
    var quiet = b.chips_quiet || [];
    var rows = order.map(function (k) {
      if (isCustomTok(k)) { var key = k.slice(CHIP_TOKEN.length); return { value: k, custom: true, key: key, name: lib[key].name }; }
      var own = k.indexOf('.') >= 0;
      return { value: k, own: own, quiet: !own && quiet.indexOf(k) >= 0 };
    });
    var more = (auto ? [] : kinds.filter(function (k) { return order.indexOf(k) < 0; })
      .map(function (k) { return { value: k, own: false }; }))
      .concat((custom || []).filter(function (c) { return mineC.indexOf(c.key) < 0; })
        .map(function (c) { return { value: CHIP_TOKEN + c.key, custom: true, key: c.key, name: c.name }; }));
    return { auto: auto, rows: rows, more: more };
  }
  // the Shown list, in order -> what is saved. A list that is the automatic
  // order (the kinds, own chips after them, custom chips where they say)
  // stays automatic, so a kind the house gains later still shows.
  function chipsSave(values, kinds, custom) {
    var lib = libOf(custom);
    var mine = values.filter(function (k) { return !isCustomTok(k) && k.indexOf('.') > 0; });
    var mineC = values.filter(isCustomTok).map(function (k) { return k.slice(CHIP_TOKEN.length); });
    var asAuto = chipOrder(kinds, mine, mineC, lib).join() === values.join();
    return { chips_extra: mine, chips_custom: mineC, chips: asAuto ? [] : values };
  }
  function chipsAddCustom(b, key) {
    return { chips_custom: (b.chips_custom || []).filter(function (k) { return k !== key; }).concat(key) };
  }
  function chipsRemoveCustom(b, key) {
    return { chips_custom: (b.chips_custom || []).filter(function (k) { return k !== key; }),
             chips: (b.chips || []).filter(function (k) { return k !== CHIP_TOKEN + key; }) };
  }
  // own chips come and go without leaving automatic
  // one accessory chip, or several (a picker's Select)
  function chipsAddOwn(b, ids) {
    ids = [].concat(ids);
    var extra = (b.chips_extra || []).concat(ids).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var chips = (b.chips || []).length ? b.chips.concat(ids.filter(function (id, i) {
      return b.chips.indexOf(id) < 0 && ids.indexOf(id) === i; })) : [];
    return { chips_extra: extra, chips: chips };
  }
  function chipsRemoveOwn(b, id) {
    return { chips_extra: (b.chips_extra || []).filter(function (x) { return x !== id; }),
             chips: (b.chips || []).filter(function (x) { return x !== id; }) };
  }
  function chipQuiet(b, kind, quiet) {
    var q = (b.chips_quiet || []).filter(function (k) { return k !== kind; });
    if (quiet) q.push(kind);
    return { chips_quiet: q };
  }

  // SCENES: `scenes` orders scene entities and "page:<kind>" pills;
  // `scenes_pages` says which page pills exist. Automatic (no scenes): every
  // scene A to Z on a generated screen, the YAML's list on a hand-written
  // one -- with the page pills after them.
  var PAGE_TOKEN = 'page:';
  function scenesModel(b, autoScenes, scenePages) {
    var sp = b.scenes_pages || [];
    var scenes = (b.scenes || []).filter(function (id) {
      return id.indexOf(PAGE_TOKEN) !== 0 || sp.indexOf(id.slice(PAGE_TOKEN.length)) >= 0;
    });
    var auto = !scenes.length;
    var order = (auto ? autoScenes.slice() : scenes.slice());
    sp.forEach(function (k) { if (order.indexOf(PAGE_TOKEN + k) < 0) order.push(PAGE_TOKEN + k); });
    var more = scenePages.filter(function (k) { return sp.indexOf(k) < 0; })
      .map(function (k) { return { value: PAGE_TOKEN + k, page: k }; });
    return {
      auto: auto,
      rows: order.map(function (v) { return v.indexOf(PAGE_TOKEN) === 0 ? { value: v, page: v.slice(PAGE_TOKEN.length) } : { value: v }; }),
      more: more
    };
  }
  function scenesSave(values) {
    return { scenes: values,
             scenes_pages: values.filter(function (v) { return v.indexOf(PAGE_TOKEN) === 0; })
               .map(function (v) { return v.slice(PAGE_TOKEN.length); }) };
  }
  // a page pill added or removed while automatic: only scenes_pages changes
  function scenesPagePill(b, page, on) {
    var sp = (b.scenes_pages || []).filter(function (k) { return k !== page; });
    if (on) sp.push(page);
    var out = { scenes_pages: sp };
    if ((b.scenes || []).length && !on) out.scenes = b.scenes.filter(function (v) { return v !== PAGE_TOKEN + page; });
    if ((b.scenes || []).length && on && b.scenes.indexOf(PAGE_TOKEN + page) < 0) out.scenes = b.scenes.concat(PAGE_TOKEN + page);
    return out;
  }

  // PAGES (a generated screen): the kinds and the house's custom pages, in
  // one order; `custom_pages` says which custom pages this screen shows.
  // BROWSE MUSIC IS NOT A PAGE OF ITS OWN since 2026-10-11 (it is part of the
  // Music page): never a row, never saved -- an older saved order's `browse`
  // is dropped as it is read.
  function noBrowse(list) { return list.filter(function (k) { return k !== 'browse'; }); }
  function pagesModel(b, pageOrder, custom) {
    pageOrder = noBrowse(pageOrder);
    var pages = noBrowse(b.pages || []), cp = (b.custom_pages || []).filter(function (k) { return custom[k] !== undefined; });
    var auto = !pages.length;
    var order;
    if (auto) {
      order = pageOrder.slice();
      var ri = order.indexOf('rooms');
      cp.forEach(function (k) { order.splice(ri < 0 ? order.length : ri++, 0, k); });
    } else {
      order = pages.filter(function (k) { return pageOrder.indexOf(k) >= 0 || custom[k] !== undefined; })
        .filter(function (k) { return custom[k] === undefined || cp.indexOf(k) >= 0; });
      cp.forEach(function (k) {
        if (order.indexOf(k) >= 0) return;
        var r = order.indexOf('rooms');
        order.splice(r >= 0 ? r : order.length, 0, k);
      });
    }
    var more = pageOrder.filter(function (k) { return k !== 'browse' && order.indexOf(k) < 0; })
      .map(function (k) { return { value: k }; })
      .concat(Object.keys(custom).filter(function (k) { return order.indexOf(k) < 0; })
        .map(function (k) { return { value: k, custom: true }; }));
    return { auto: auto,
             rows: order.map(function (k) { return { value: k, custom: custom[k] !== undefined }; }),
             more: more };
  }
  // A SCREEN WITH NO HOME PAGE: the pages it is only, in order -- any page
  // kind and any custom page. Its `only_pages`; a screen set up before
  // 2026-10-04 has only `custom_pages`, where `energy` is the Energy
  // feature's page (energyOn). `pageOrder` is the kinds the house can have.
  function onlyModel(b, pageOrder, custom, energyOn) {
    pageOrder = noBrowse(pageOrder);
    var kind = function (k) { return pageOrder.indexOf(k) >= 0; };
    var cur = (b.only_pages || []).length
      ? b.only_pages.filter(function (k) { return kind(k) || custom[k] !== undefined; })
      : (b.custom_pages || []).filter(function (k) { return custom[k] !== undefined || (k === 'energy' && energyOn && kind(k)); });
    cur = noBrowse(cur);
    var more = pageOrder.filter(function (k) { return k !== 'browse' && cur.indexOf(k) < 0; })
      .map(function (k) { return { value: k }; })
      .concat(Object.keys(custom).filter(function (k) { return cur.indexOf(k) < 0; })
        .map(function (k) { return { value: k, custom: true }; }));
    return { rows: cur.map(function (k) { return { value: k, custom: custom[k] !== undefined }; }),
             more: more };
  }
  // EACH PAGE'S BACKGROUND (Sky / Background -> Page Backgrounds): the pages
  // there are, each with whether it has a color of its own (hk-sky.js
  // STATIC -- Automatic keeps it) or shows the live sky by default. `keys`:
  // the pages to list (page kinds, `rooms`, custom page addresses);
  // `custom`: address -> title.
  var SKY_OWN = { cameras: 1, live_tv: 1, security: 1, doors_windows: 1, climate: 1, lights: 1, timers: 1, calendar: 1,
                  vacuums: 1, music: 1, water: 1, energy: 1 };
  var SKY_PAGE_LABELS = { music: 'Music', rooms: 'Room Pages', live_tv: 'Live TV' };
  function skyPageRows(keys, custom) {
    return keys.filter(function (k) { return k !== 'browse'; }).map(function (k) {
      var isCustom = custom && custom[k] !== undefined;
      return { key: k, label: isCustom ? custom[k] : (SKY_PAGE_LABELS[k] || PAGE_LABELS[k] || k), custom: isCustom,
               own: !isCustom && !!SKY_OWN[k] };
    });
  }
  // what Automatic means for a page, in words
  // (a page left alone says Automatic: the user, 2026-10-17 -- "Page
  // Color" there read as if Page Color had been picked)
  function skyAutoLabel(row) {
    return 'Automatic';
  }
  // a mode in words: 'own', 'live', 'photo' or a backdrop id (backdrops: [{id, label}])
  function skyModeLabel(mode, backdrops) {
    if (mode === 'own') return 'Page Color';
    if (mode === 'photo') return 'Photo';
    if (mode === 'landscapes') return 'Landscapes';
    if (mode === 'wallpaper') return 'Wallpaper';
    var b = (backdrops || []).filter(function (x) { return x.id === mode; })[0];
    return b ? b.label : mode === 'live' ? 'Live Sky' : mode;
  }
  // the choices for one page: Automatic (or Same as All Screens), Page Color
  // where it has one, the live sky, then every fixed backdrop
  function skyModeOptions(row, backdrops, first) {
    var out = [['', first]];
    if (row.own) out.push(['own', 'Page Color']);
    (backdrops || []).forEach(function (b) { out.push([b.id, b.label]); });
    return out;
  }
  // WHAT A SCREEN SHOWS, in a few words: null for a whole screen (Home,
  // rooms, every page); for one with no Home page, "Only Energy", "Only
  // Security & Cameras", "Only 4 Pages" -- or "No Pages Picked Yet" (it
  // shows everything until one is). `label(k)`: a page's name.
  function onlySummary(b, pageOrder, custom, energyOn, label) {
    if (!b || b.home_page !== false) return null;
    var keys = onlyModel(b, pageOrder, custom, energyOn).rows.map(function (r) { return r.value; })
      .filter(function (k) { return k !== 'browse'; });
    if (!keys.length) return { keys: [], text: 'No Pages Picked Yet' };
    var names = keys.map(label);
    return { keys: keys, text: keys.length === 1 ? 'Only ' + names[0] : keys.length === 2 ? 'Only ' + names[0] + ' & ' + names[1]
                                                  : 'Only ' + keys.length + ' Pages', names: names };
  }
  function pagesSave(values, custom) {
    var keep = noBrowse(values);
    return { pages: keep, custom_pages: keep.filter(function (k) { return custom[k] !== undefined; }) };
  }
  // a custom page shown or not while automatic: only custom_pages changes
  function pagesCustom(b, path, on) {
    var cp = (b.custom_pages || []).filter(function (k) { return k !== path; });
    if (on) cp.push(path);
    var out = { custom_pages: cp };
    if ((b.pages || []).length) {
      var p = b.pages.filter(function (k) { return k !== path; });
      if (on) { var r = p.indexOf('rooms'); p.splice(r >= 0 ? r : p.length, 0, path); }
      out.pages = p;
    }
    return out;
  }

  // WHERE A PAGE SITS IN THE MENU: at the TOP (right under
  // Home, above Categories), under CATEGORIES, or NOT in the menu (still one
  // tap away on its chip). Two settings say it: `menu_top` -- the view paths
  // at the top (empty: the views' own `menu: top`, a generated screen's
  // Weather, Cameras and Live TV) -- and `categories` -- the view paths listed
  // under Categories (empty: automatic: the pages Home's chips open, or on a
  // generated screen, whose chip row names none, every page).
  // `items`: the pages that can be placed, in menu order:
  //   [{path, top: its own default, auto: listed when automatic}]
  var MENU_PATHS = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', live_tv: 'live-tv', security: 'security',
                     doors_windows: 'doors-windows', climate: 'climate', lights: 'lights', timers: 'timers',
                     vacuums: 'vacuums', music: 'playmusic', water: 'water', energy: 'energy',
                     // (the Power page, 2026-10-14: missing here, its row had no
                     // place in the menu to pick -- hk-menu.js PAGE_PATHS has it)
                     power: 'power' };
  var MENU_TOPS = { weather: 1, cameras: 1, live_tv: 1 };
  var MENU_FIXED = { rooms: 'Under Rooms' };
  var MENU_PLACES = [['top', 'Top of Menu'], ['list', 'Categories'], ['off', 'Not in Menu']];
  var NO_TOP = '-';
  function menuPathOf(k, custom) { return MENU_PATHS[k] || (custom && custom[k] !== undefined ? k : null); }
  // a generated screen's pages (kinds and custom pages, in its order) as items
  function menuItems(keys, custom) {
    var out = [];
    keys.forEach(function (k) {
      var p = menuPathOf(k, custom);
      if (p) out.push({ path: p, key: k, top: !!MENU_TOPS[k], auto: true });
    });
    return out;
  }
  function topsOf(b, items) {
    return (b.menu_top || []).length ? b.menu_top.slice()
      : items.filter(function (it) { return it.top; }).map(function (it) { return it.path; });
  }
  function placeOf(b, it, items) {
    if (topsOf(b, items).indexOf(it.path) >= 0) return 'top';
    var c = b.categories || [];
    if (c.length) return c.indexOf(it.path) >= 0 ? 'list' : 'off';
    return it.auto ? 'list' : 'off';
  }
  // one page to a place -> {menu_top, categories}; null when that cannot be
  // said (no page left under Categories, where empty means automatic)
  function placeSet(b, items, path, place) {
    var order = items.map(function (it) { return it.path; });
    var tops = topsOf(b, items).filter(function (p) { return p !== path && order.indexOf(p) >= 0; });
    var listed = items.filter(function (it) {
      return it.path !== path && tops.indexOf(it.path) < 0 && placeOf(b, it, items) === 'list';
    }).map(function (it) { return it.path; });
    if (place === 'top') tops.push(path);
    if (place === 'list') listed.push(path);
    tops = order.filter(function (p) { return tops.indexOf(p) >= 0; });
    listed = order.filter(function (p) { return listed.indexOf(p) >= 0; });
    var same = function (x, y) { return x.length === y.length && x.every(function (p) { return y.indexOf(p) >= 0; }); };
    var defTops = items.filter(function (it) { return it.top; }).map(function (it) { return it.path; });
    var auto = items.filter(function (it) { return it.auto && tops.indexOf(it.path) < 0; }).map(function (it) { return it.path; });
    // nothing at the top at all is NO_TOP: an empty list means "the views' own"
    var out = { menu_top: same(tops, defTops) ? [] : tops.length ? tops : [NO_TOP] };
    if (same(listed, auto)) out.categories = [];
    else if (!listed.length) return null;
    else out.categories = listed;
    return out;
  }

  // ROOMS: `room_order` (areas, in order) and `home_rooms`: Shown = the
  // rooms on Home. All shown in order = "order"; some = "only".
  function roomsModel(b, areasAZ) {
    var ro = (b.room_order || []).filter(function (a) { return areasAZ.indexOf(a) >= 0; });
    var auto = !ro.length;
    var only = b.home_rooms === 'only' && !auto;
    var rows = auto ? areasAZ.slice() : only ? ro : ro.concat(areasAZ.filter(function (a) { return ro.indexOf(a) < 0; }));
    var more = auto || !only ? [] : areasAZ.filter(function (a) { return ro.indexOf(a) < 0; });
    return { auto: auto, rows: rows.map(function (a) { return { value: a }; }),
             more: more.map(function (a) { return { value: a }; }) };
  }
  function roomsSave(values, areasAZ) {
    return { room_order: values, home_rooms: values.length < areasAZ.length ? 'only' : 'order' };
  }
  // back to automatic: no order, Home as the screen lists its rooms
  function roomsAuto() { return { room_order: [], home_rooms: 'as_is' }; }
  // ALL SCREENS' ROOMS (settings `rooms`) as a screen's keys, and back: the
  // same list editor and model serve both
  function houseRoomsAsBoard(r) {
    r = r || {};
    return { room_order: r.order || [], home_rooms: r.home || 'as_is', menu_rooms: r.menu || 'az', page_rooms: r.pages || 'floor' };
  }
  function houseRoomsSave(ch) {
    var out = {};
    if ('room_order' in ch) out['rooms.order'] = ch.room_order;
    if ('home_rooms' in ch) out['rooms.home'] = ch.home_rooms;
    if ('menu_rooms' in ch) out['rooms.menu'] = ch.menu_rooms;
    if ('page_rooms' in ch) out['rooms.pages'] = ch.page_rooms;
    return out;
  }
  // ONE ROOM ON HOME, or not (a room's own Show on Home): the order as it
  // stands, with the room taken out or added at its end
  function roomOnHome(b, areasAZ, area, on) {
    var rows = roomsModel(b, areasAZ).rows.map(function (r) { return r.value; });
    var has = rows.indexOf(area) >= 0;
    if (on === has) return null;
    return roomsSave(on ? rows.concat(area) : rows.filter(function (a) { return a !== area; }), areasAZ);
  }
  function roomsSummary(b) {
    return !(b.room_order || []).length ? 'Automatic' : b.home_rooms === 'only' ? b.room_order.length + ' on Home' : 'Custom Order';
  }

  // CAMERAS: automatic = one of every camera (its low channel)
  function camerasModel(b, ok, autoCams) {
    var cams = (b.cameras || []).filter(function (id) { return ok.indexOf(id) >= 0; });
    var auto = !cams.length;
    var rows = auto ? autoCams.slice() : cams;
    return { auto: auto, rows: rows.map(function (id) { return { value: id }; }),
             more: auto ? [] : ok.filter(function (id) { return rows.indexOf(id) < 0; }).map(function (id) { return { value: id }; }) };
  }
  // one camera per device, its low-resolution channel when it has several
  function autoCameras(ids, deviceOf) {
    var byDev = {}, out = [];
    ids.slice().sort().forEach(function (id) {
      var d = deviceOf(id) || id;
      if (!(d in byDev)) { byDev[d] = id; out.push(id); }
      else if (/low/.test(id) && !/low/.test(byDev[d])) { out[out.indexOf(byDev[d])] = id; byDev[d] = id; }
    });
    return out;
  }

  // LIVE CAMERA FOLLOWS (a screen's Cameras): a dropdown helper whose option
  // names the camera the strip plays live. An option names a camera when it
  // is the camera's name or the start of it (hk-cameras.js _optionOf: "Deck"
  // is "Deck Low resolution channel"). For each camera: the option to give
  // it -- its device's name, which its entities' names start with, else its
  // own name -- and the sensor on the same device to follow, a person sensor
  // before a motion one. With a dropdown already chosen (`have`: its
  // options), a camera keeps the option the dropdown has for it (the longest
  // that names it, as the strip picks); one it has none for is `missing`.
  //   cams     [{entity, name, device, deviceName}]
  //   sensors  [{entity, device, kind: 'person' | 'motion'}]
  function liveNames(option, names) {
    var t = String(option || '').toLowerCase();
    return !!t && names.some(function (n) {
      n = String(n || '').toLowerCase();
      return n === t || n.indexOf(t + ' ') === 0;
    });
  }
  function livePlan(cams, sensors, have) {
    var taken = {};
    return (cams || []).map(function (c) {
      var name = String(c.name || c.entity);
      var option = String(c.deviceName || '').trim();
      if (!option || !liveNames(option, [name]) || taken[option.toLowerCase()]) option = name;
      var missing = false;
      if (have) {
        var best = null;
        have.forEach(function (o) {
          if (liveNames(o, [name]) && (!best || String(o).length > best.length)) best = String(o);
        });
        if (best) option = best; else missing = true;
      }
      taken[option.toLowerCase()] = true;
      var mine = (sensors || []).filter(function (s) { return c.device && s.device === c.device; });
      var pick = mine.filter(function (s) { return s.kind === 'person'; })[0] ||
                 mine.filter(function (s) { return s.kind === 'motion'; })[0] || null;
      return { entity: c.entity, name: name, option: option, sensor: pick ? pick.entity : null, missing: missing };
    });
  }
  // The automation, as YAML to paste into the automation editor: each
  // camera's sensor turning on picks that camera; five quiet minutes on all
  // of them go back to the first camera. Only cameras the dropdown has an
  // option for (a missing one would fail). Null when no camera has a sensor.
  // Every string is written as JSON, which YAML reads as a quoted string.
  function liveYaml(plan, selector) {
    var q = JSON.stringify;
    var usable = (plan || []).filter(function (p) { return !p.missing; });
    var withSensor = usable.filter(function (p) { return p.sensor; });
    if (!withSensor.length) return null;
    var domain = String(selector || '').split('.')[0] === 'select' ? 'select' : 'input_select';
    var all = withSensor.map(function (p) { return p.sensor; });
    var list = function (pad) { return all.map(function (s) { return pad + '- ' + s; }).join('\n'); };
    var pickLines = function (pad, option) {
      return [pad + '- action: ' + domain + '.select_option', pad + '  target:', pad + '    entity_id: ' + selector,
              pad + '  data:', pad + '    option: ' + option].join('\n');
    };
    var out = ['alias: Live camera follows motion',
      'description: ' + q('Plays the camera where a person or motion was just seen live on the camera strip, ' +
                          'and the first camera again after five quiet minutes.'),
      'mode: queued', 'triggers:'];
    withSensor.forEach(function (p) {
      out.push('  - trigger: state', '    entity_id: ' + p.sensor, '    to: "on"', '    id: ' + q(p.option));
    });
    out.push('  - trigger: state', '    entity_id:', list('      '), '    to: "off"', '    for:', '      minutes: 5',
             '    id: all quiet', 'actions:', '  - if:', '      - condition: trigger', '        id: all quiet', '    then:',
             '      - condition: state', '        entity_id:', list('          '), '        state: "off"',
             pickLines('      ', q(usable[0].option)), '    else:', pickLines('      ', q('{{ trigger.id }}')));
    return out.join('\n') + '\n';
  }

  // A LIST'S REORDER: the Shown values after moving `from` to `to`
  function move(values, from, to) {
    var v = values.slice();
    if (from < 0 || from >= v.length) return v;
    to = Math.max(0, Math.min(v.length - 1, to));
    var m = v.splice(from, 1)[0];
    v.splice(to, 0, m);
    return v;
  }

  // ------------------------------------------------------------ the sky
  function mmdd(v) {
    var m = /^(\d{2})-(\d{2})$/.exec(String(v || ''));
    return m ? { month: Number(m[1]), day: Number(m[2]) } : null;
  }
  function dateLabel(v) {
    if (v === 'thanksgiving') return 'Thanksgiving Day';
    var d = mmdd(v);
    return d ? MONTHS[d.month - 1].slice(0, 3) + ' ' + d.day : String(v || '');
  }
  // a theme's date: what is saved, else built in (for the hemisphere)
  function skyDate(sky, builtIn, prefix, end) {
    var own = sky[prefix + '_' + end];
    var hemi = sky.hemisphere === 'south' ? 'south' : 'north';
    var b = builtIn[prefix] ? builtIn[prefix][hemi][end === 'from' ? 0 : 1] : null;
    return { own: !!own, value: own || b, builtIn: b };
  }

  // ------------------------------------------------------------ your own dashboards
  // WHAT A DASHBOARD YOU WRITE YOURSELF CAN USE (Advanced -> Your Own
  // Dashboards, and the wiki's Your-Own-Dashboard page, which a test holds to
  // exactly these snippets). {weather}, {user}, {photos}: filled in from the
  // house on the settings page, the defaults below in the wiki.
  var YAML_DEFAULTS = { weather: 'weather.home', user: 'Kitchen Tablet', photos: 'media-source://media_source/local/photos' };
  var YAML_REF = [
    { header: 'The Dashboard', footer: 'At the top of the dashboard’s raw configuration (Edit Dashboard → ⋮ → Raw Configuration Editor), beside views:.',
      items: [
        { id: 'kiosk', title: 'Hide Header & Sidebar', key: 'hk_kiosk', anchor: 'hide-home-assistants-header-and-sidebar',
          sub: 'Or turn on Hide Home Assistant Header & Sidebar in the screen’s HK settings, with nothing written. A kiosk_mode block (the Kiosk Mode plugin’s) wins over both.',
          yaml: 'hk_kiosk:\n  header: true        # Home Assistant’s header\n  sidebar: true       # ...and its sidebar\n  admins: true        # false: an admin still sees them' },
        { id: 'screensaver', title: 'Photo Screensaver', key: 'hk_screensaver', anchor: 'photo-screensaver',
          sub: 'Or turn on Screensaver in the screen’s HK settings, with nothing written, and get its switch and In Use sensor too.',
          yaml: 'hk_screensaver:\n  user: {user}   # the tablet’s Home Assistant user\n' +
                '  tablet: kitchen        # optional, instead of user: the wall tablet’s id\n' +
                '  entity: input_boolean.kitchen_photos   # optional: yours, kept in step\n' +
                '  photos: {photos}\n  starts_after: 180\n  each_photo: 30\n  order: random        # or sorted\n' +
                '  zoom: false          # Slow Zoom\n' +
                '  photo_layout: single # or mosaic (mosaic_count: 2 to 5)\n' +
                '  fill: true           # landscape photos fill the screen\n' +
                '  portrait_fill: false # portrait photos whole, over a blurred copy\n' +
                '  portrait_y: top      # the part kept when cropped: top, center, bottom (and portrait_x)\n' +
                '  show: photos         # photos, both (the forecast slide on), forecast or clock\n' +
                '  clock_over: corner   # over the photos: corner or large (clock: false for none)\n' +
                '  clock_style: classic # for show: clock and a large clock\n' +
                '  clock_bg: gradient   # behind show: clock\n' +
                '  clock_night: "off"   # "night" (clock_night_from to clock_night_to) or "always"\n' +
                '  forecast_every: 5    # a slide (the forecast, the music) after this many photos\n' +
                '  music_slide: false   # what plays, full screen: a slide among the photos\n' +
                '  music_first: false   # ...or the music fills the screen while it plays\n' +
                '  fallback: true       # no photos: the forecast (false: a dark screen)\n' +
                '  band: true           # the forecast’s details on the forecast\n' +
                '  band_photos: false   # ...and over the photos\n' +
                '  calendar: false      # the calendar pane, down the right\n' +
                '  calendar_days: 2     # ...today and tomorrow (1 to 7 days)\n' +
                '  music_pane: false    # what plays, in the pane (under the calendar)\n' +
                '  fade_back: 500       # ms back to the dashboard (0: at once)\n' +
                '  cards:\n    - type: custom:hk-clock-card\n    - type: custom:hk-weather-strip-card\n      variant: inline\n' +
                '    - type: custom:hk-screensaver-now-card\n      music: true\n    - type: custom:hk-timer-strip-card\n' +
                '      entity: sensor.running_quick_timers\n      fixed: true\n    - type: custom:hk-screensaver-status-card' },
        { id: 'sky', title: 'Live Sky', key: 'sky', anchor: 'live-sky',
          sub: 'The dashboard opts in with sky:, and each view that wants it says sky: true.',
          yaml: 'sky:\n  enable: input_boolean.live_sky   # optional: off hides the sky\nviews:\n  - title: Home\n    path: home\n' +
                '    type: custom:hk-grid-view\n    sky: true\n    cards: []' }] },
    { header: 'Views', footer: 'Each view in views:. The menu lists them: the first view is Home.',
      items: [
        { id: 'view', title: 'A Page in the Menu', key: 'hk-grid-view', anchor: 'a-page-in-the-menu',
          sub: haName('HK Frontend’s grid view') + ', placed in the menu. A view with area: is a room.',
          yaml: '- title: Kitchen\n  path: kitchen\n  type: custom:hk-grid-view\n  area: kitchen       # a room, in the menu’s Rooms\n' +
                '  menu: top           # right under Home (false: not listed)\n  cards: []' },
        { id: 'room', title: 'A Room Page, Built for You', key: 'hk-room', anchor: 'a-room-page-built-for-you',
          sub: 'Built from the area every time it opens.',
          yaml: '- title: Kitchen\n  path: room-kitchen\n  subview: true\n  strategy:\n    type: custom:hk-room\n    area: kitchen' }] },
    { header: 'Cards', footer: 'Anywhere in a view’s cards:. Every HK card is in the card picker too, with a visual editor.',
      items: [
        { id: 'header', title: 'Clock, Weather & Chips', key: 'hk-header-card', anchor: 'clock-weather-and-chips',
          sub: 'The header, and the status chips under it. The chips and scenes follow the screen’s HK settings.',
          yaml: '- type: custom:hk-header-card\n- type: custom:hk-chips-card\n- type: custom:hk-scenes-card' },
        { id: 'cameras', title: 'Cameras', key: 'hk-camera-mosaic-card', anchor: 'cameras',
          sub: 'The camera strip: one camera live, the others as stills. Its cameras follow the screen’s HK settings.',
          yaml: '- type: custom:hk-camera-mosaic-card' },
        { id: 'weather', title: 'Forecast', key: 'hk-weather-band-card', anchor: 'forecast',
          sub: 'Now, the next hours and the coming days.',
          yaml: '- type: custom:hk-weather-band-card\n  entity: {weather}' },
        { id: 'live_tv', title: 'Live TV', key: 'hk-tv-guide-card', anchor: 'live-tv',
          sub: 'Every channel with what is on; a tap plays one full screen. Needs the Live TV feature.',
          yaml: '- type: custom:hk-tv-guide-card\n  title: Live TV' },
        { id: 'clean_areas', title: 'Clean Areas', key: 'hk-area-select-card', anchor: 'clean-areas',
          sub: 'Pick rooms floor by floor, then clean just those. Needs the Clean Areas feature.',
          yaml: '- type: custom:hk-area-select-card' },
        { id: 'music', title: 'Music', key: 'hk-music-card', anchor: 'music',
          sub: 'The whole Music page as one card: what plays and where, with Browse Music beside it. Or just what is playing. Needs the Music feature.',
          yaml: '- type: custom:hk-music-card   # the whole Music page\n# ...or just what is playing:\n' +
                '# - type: custom:hk-now-playing-card\n#   music: true' },
        { id: 'media_bar', title: 'The Now Playing Bar', key: 'hk-popup-card', anchor: 'the-now-playing-bar',
          sub: 'The player docked along the bottom while music plays, as on the screens ' + PN() + ' builds. It shows on the views it is placed in: put it in each one. Needs the Music feature.',
          yaml: '- type: custom:hk-popup-card\n  hash: \'#media\'\n  position: bottom\n  modal: false\n  dock: true\n' +
                '  padding: \'0\'\n  radius: \'0\'\n  width: 100%\n  max_width: 100%\n  background: transparent\n' +
                '  vars:\n    hk-np-height: calc(104px + env(safe-area-inset-bottom, 0px))\n' +
                '    hk-np-pad: 12px 24px calc(12px + env(safe-area-inset-bottom, 0px))\n' +
                '    hk-np-radius: \'0\'\n    hk-np-plate: rgb(22,23,26)\n' +
                '    hk-np-areas: \'"art title . spk prev play next stop brw . meta" "art artist . spk prev play next stop brw . meta" "art sub . spk prev play next stop brw . meta"\'\n' +
                '    hk-np-cols: 72px minmax(220px, max-content) 1fr 56px 64px 64px 64px 64px 56px 1fr minmax(0, 380px)\n' +
                '    hk-np-rows: auto auto auto\n    hk-np-gap: 14px\n' +
                '  trigger:             # open while the music plays...\n    - condition: state\n      entity_from:\n        music: true\n' +
                '      state: playing\n      grace: 20\n  trigger_close: true # ...and close when it stops\n' +
                '  dismissable: true   # swiped down, it stays away until the music stops\n' +
                '  dismiss_scope:\n    - music: true\n  stash:              # ...with a button in the corner to bring it back\n' +
                '    icon: hk:homepod\n    label: Show Now Playing\n' +
                '  cards:\n    - type: custom:hk-now-playing-card\n      bar: true\n      music: true\n      hide_idle: true\n' +
                '      meta_card:\n        type: custom:hk-media-control-card\n        color: purple\n        bare: true\n        parts: [volume]\n' +
                '        entity_from:\n          music: true\n' +
                '      sub_card:\n        type: custom:hk-media-control-card\n        color: purple\n        bare: true\n        parts: [progress]\n' +
                '        phone_times: false\n        entity_from:\n          music: true' },
        { id: 'timers', title: 'Timers', key: 'hk-timers-page-card', anchor: 'timers',
          sub: 'Quick start, the running timers and the New Timer keypad, as one card.',
          yaml: '- type: custom:hk-timers-page-card' }] },
    { header: 'Automations', footer: 'Actions of ' + haName('HK Frontend’s') + ', for your automations and scripts.',
      items: [
        { id: 'clean_action', title: 'Clean Some Rooms', key: 'hk_frontend.clean_areas', anchor: 'clean-some-rooms',
          sub: 'Each vacuum cleans the rooms on its own map.',
          yaml: 'action: hk_frontend.clean_areas\ndata:\n  areas:\n    - kitchen\n    - dining_room' },
        { id: 'saver_action', title: 'Start or Stop the Photos', key: 'switch.turn_on', anchor: 'start-or-stop-the-photos',
          sub: 'A screen’s Photo Screensaver switch (HK settings’ screensaver only): on starts the photos, off closes them.',
          yaml: 'action: switch.turn_on\ntarget:\n  entity_id: switch.kitchen_photo_screensaver' }] },
    { header: 'The Address', footer: 'After a screen’s address, for one visit.',
      items: [
        { id: 'address', title: 'For One Visit', key: '?hk_kiosk=off', anchor: 'for-one-visit',
          sub: 'Home Assistant’s header and sidebar back, or no screensaver, while you work on a tablet. A reload is the screen as set again.',
          yaml: '/dashboard-kitchen/0?hk_kiosk=off   # the header and sidebar, until a reload\n' +
                '/dashboard-kitchen/0?hk_saver=off   # no screensaver on this page' }] }
  ];
  // one snippet, filled in (`ctx` over YAML_DEFAULTS)
  function yamlRefText(item, ctx) {
    var c = Object.assign({}, YAML_DEFAULTS, ctx || {});
    return String(item.yaml).replace(/\{(weather|user|photos)\}/g, function (m, k) { return c[k] || YAML_DEFAULTS[k]; });
  }
  function yamlRefItem(id) {
    var out = null;
    YAML_REF.forEach(function (g) { g.items.forEach(function (it) { if (it.id === id) out = it; }); });
    return out;
  }

  // ------------------------------------------------------------ the Pages screen
  // THE PAGES SCREEN (docs/phase11/HOMEVIEW-LOOK.md, Phase J; settings.py
  // PAGES_SCREEN_*): All Screens' every field; a screen's only the fields it
  // sets (b.pages_screen, null: Same as All Screens), each resolved on its own
  var PAGES_SCREEN_DEFAULTS = { show: 'off', icons: 'menu', rooms: 'folder', widgets: [], pill: 'auto', clock: 'off' };
  var PAGES_SCREEN_SHOW = [['off', 'Off'], ['on', 'On']];
  var PAGES_SCREEN_ROOMS = [['folder', 'A Rooms Folder'], ['each', 'Each Room Its Own Icon'], ['none', 'None']];
  var PAGES_SCREEN_PILL = [['auto', 'When There\u2019s No Tab Bar'], ['on', 'Always'], ['off', 'Never']];
  // the time, large and faint, behind the icons (settings.py PAGES_SCREEN_CLOCK; Off unless chosen)
  var PAGES_SCREEN_CLOCK = [['off', 'Off'], ['on', 'On']];
  // the Side Pane's sections (Phase A2's PANE_SECTIONS, its order), as widgets
  var PAGES_SCREEN_WIDGETS = [['clock', 'Clock'], ['weather', 'Weather'], ['calendar', 'Calendar'], ['now_playing', 'Now Playing'],
    ['security', 'Security'], ['camera', 'Camera'], ['timers', 'Timers'], ['energy', 'Energy'], ['climate', 'Climate'],
    ['people', 'Who\u2019s Home'], ['todo', 'To-do'], ['notifications', 'Notifications']];
  // a widget's size and side, as one choice: More is 2 x 2, Less 2 x 1
  var PAGES_SCREEN_SPOTS = [['more:right', 'Large, Right'], ['more:left', 'Large, Left'], ['less:right', 'Small, Right'], ['less:left', 'Small, Left']];
  var PAGES_SCREEN_WIDGETS_MAX = 4;
  // the house's (`house`, the settings' pages_screen) and a screen's own
  // (`own`, its b.pages_screen) as it shows: { value, own: {field: true} }
  function pagesScreenOf(house, own) {
    var h = house || {}, o = own || {}, value = {}, mine = {};
    Object.keys(PAGES_SCREEN_DEFAULTS).forEach(function (k) {
      var d = PAGES_SCREEN_DEFAULTS[k];
      if (o[k] !== undefined && o[k] !== null) { value[k] = o[k]; mine[k] = true; }
      else value[k] = h[k] !== undefined && h[k] !== null ? h[k] : (Array.isArray(d) ? d.slice() : d);
    });
    return { value: value, own: mine };
  }
  // a screen's own after one field changed: `v` undefined drops the field
  // (Same as All Screens); none left is null
  function pagesScreenSet(own, field, v) {
    var out = Object.assign({}, own || {});
    if (v === undefined) delete out[field]; else out[field] = v;
    return Object.keys(out).length ? out : null;
  }
  // the row's value on a screen's page and All Screens'
  function pagesScreenSummary(value) {
    if (!value || value.show !== 'on') return 'Off';
    var w = (value.widgets || []).length;
    return 'On' + (Array.isArray(value.icons) ? ' \u00b7 ' + value.icons.length + ' Pages' : '') + (w ? ' \u00b7 ' + w + (w === 1 ? ' Widget' : ' Widgets') : '');
  }
  // the widgets with one changed: `spot` 'more:right'..., or 'remove'
  function pagesWidgetSet(list, kind, spot) {
    var out = (list || []).map(function (w) { return Object.assign({}, w); });
    var i = -1;
    out.forEach(function (w, j) { if (w.kind === kind) i = j; });
    if (spot === 'remove') { if (i >= 0) out.splice(i, 1); return out; }
    var p = String(spot || 'more:right').split(':'), w = { kind: kind, size: p[0] === 'less' ? 'less' : 'more', place: p[1] === 'left' ? 'left' : 'right' };
    if (i >= 0) out[i] = w; else if (out.length < PAGES_SCREEN_WIDGETS_MAX) out.push(w);
    return out;
  }

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
    ['Menu on Each Screen', 'house/menu', 'menu:screens', 'menu each screen tablets phones which kind button tab bar always open'],
    ['Side Menu', 'house/menu/side', 'menu:side', 'side menu drawer button always open docked used by'],
    ['Edge Tab', 'house/menu/edge-tab', 'menu:edge-tab', 'edge tab position size used by'],
    ['Pages in Menu', 'screen/menu-pages', 'categories', 'categories menu list', true],
    ['Page Headers', 'screen/page-headers', 'headers', 'page header off this screen hide header water valve timers quick start', true],
    ['Tab Bar', 'house/menu/tab-bar', 'menu:tab-bar', 'tab bar bottom bar floating ios navigation dock tabs more rooms position size used by'],
    ['Home Page', 'screen/pages', 'home_page', 'only these pages standalone energy panel security cameras climate no home', true],
    ['Home', 'screen/pages', 'home_view', 'home page custom first page car generated', true],
    ['Rooms in Menu', 'screen/rooms', 'menu_rooms', 'a to z order', true],
    ['Status Chips', 'screen/chips', 'chips', 'chip row only when active quiet', true],
    ['Status Chips (All Screens)', 'house/chips', 'chips:all', 'chips chip row every screen always when active quiet conditional'],
    ['Cameras', 'screen/cameras', 'cameras', 'camera strip live camera same as all screens order', true],
    ['Live Camera Follows', 'screen/cameras/live', 'camera_live', 'live camera follows motion person detection dropdown input select automation', true],
    ['Live First Camera', 'screen/cameras', 'camera_live_video', 'camera strip live video snapshot first tile performance', true],
    ['Scenes', 'screen/scenes', 'scenes', 'scene pills row', true],
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
    ['Accessory Types', 'accessories', 'counts', 'what counts status & chips status and chips types kinds smoke carbon monoxide co alarm lights fans doors windows locks blinds leaks thermostats timers vacuums speakers count chips'],
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
    ['Background', 'house/appearance/sky', 'sky.background', 'background live sky color solid gradient photo picture wallpaper image upload still no stars plain black'],
    ['Landscapes', 'house/appearance/sky', 'sky.background', 'landscapes landscape photos mountains lakes coasts forests nature scenery background scenic wake interval change'],
    ['Background Photo', 'house/appearance/sky', 'sky.photo', 'photo picture wallpaper image upload background blur dim darken saturation tint color cast'],
    ['Sky Colors', 'house/appearance/sky/backdrop', 'sky.gradient', 'backdrop palette gradient live sky colors tint dusk midnight fjord dune graphite plum ember mist black custom'],
    ['Seasonal Decorations', 'house/appearance/sky', 'sky.decorations', 'holiday halloween christmas old new woodland style'],
    ['Decoration Style', 'house/appearance/sky', 'sky.decoration_style', 'old new seasons holidays birthdays woodland'],
    ['Moving Things', 'house/appearance/sky', 'sky.moving', 'front behind over cards rain snow leaves bats birds flyby confetti sky layer'],
    ['Clouds', 'house/appearance/sky', 'sky.cloud_style', 'clouds classic realistic photographic weather sky'],
    ['Daytime Sky', 'house/appearance/sky', 'sky.daytime', 'brightness bright dark deep natural balanced blue midday day sky'],
    ['Night Sky', 'house/appearance/sky', 'sky.liveliness:night', 'stars shooting stars meteors twinkling screensaver night liveliness'],
    ['Liveliness', 'house/appearance/sky', 'sky.liveliness_all', 'liveliness lively busy calm bats geese leaves petals fireflies snow sleigh witch owl how many how often subtle classic festive party custom each occasion'],
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
  // ...and the rows search could not find by name (2026-10-09 audit): each
  // occasion and woodland season by its name, the screen's device rows
  SKY_THEMES.forEach(function (t) {
    SEARCH.push([t.label, 'house/appearance/sky/' + t.id, 'sky.themes:' + t.id,
                 'seasonal decorations occasion holiday show dates starts ends days liveliness ' + t.label.toLowerCase()]);
  });
  WOODLAND.forEach(function (w) {
    SEARCH.push([w[1] + ' Woodland', 'house/appearance/sky/woodland/' + w[0], 'lively:' + w[0],
                 'woodland season new decorations liveliness ' + w[1].toLowerCase() + (w[0] === 'fall' ? ' fall' : '')]);
  });
  SEARCH.push(
    ['Wall Tablets on This Screen', 'screen', 'b:tablets', 'wall tablet user room this device kiosk which tablets', true],
    ['Car Browser', 'screen', 'car', 'car tesla browser this device', true],
    ['Car Layout', 'screen', 'car_layout', 'car tesla home layout full compact rooms', true],
    ['Car Scale', 'screen', 'car_width', 'car tesla scale zoom size width bigger smaller custom', true],
    ['Header on Phones', 'screen', 'phone_header', 'phone weather strip clock header', true],
    ['Decorations Also Need', 'house/appearance/sky/advanced', 'sky.seasonal', 'decorations need season sensor holidays also needs'],
    ['Fade Back (Screensaver)', 'screen/screensaver', 'saver:fade_back', 'screensaver fade back dashboard touch switch', true],
    ['Fill the Screen (Screensaver)', 'screen/screensaver', 'saver:fill', 'screensaver photos crop fill whole photo landscape', true],
    ['Portrait Photos (Screensaver)', 'screen/screensaver', 'saver:portrait_fill', 'screensaver portrait landscape photos zoom focus crop top center bottom blur dim whole fill', true],
    ['Clock & Date (Screensaver)', 'screen/screensaver', 'saver:clock', 'screensaver clock date time', true],
    ['UV Index Sensor', 'house/weather/sensors', 'weather.uv', 'weather uv index sensor'],
    ['Wind Sensor', 'house/weather/sensors', 'weather.wind', 'weather wind speed sensor'],
    ['Daily Forecast', 'house/weather/sensors', 'weather.forecast_daily', 'weather forecast daily days'],
    ['Hourly Forecast', 'house/weather/sensors', 'weather.forecast_hourly', 'weather forecast hourly hours'],
    ['Menu on Tablets & Computers', 'screen', 'menu', 'menu tablet ipad computer off button always open tab bar', true],
    ['Menu on Phones', 'screen', 'menu_phone', 'menu phone iphone android off button tab bar folded upright ipad', true],
    ['Accent Color', 'screen/accent', 'accent', 'menu color colour accent highlight flat', true],
    ['Highlight Color', 'screen/accent', 'accent', 'menu color colour accent highlight', true],
    ['Appearance', 'screen', 'appearance', 'appearance style glass flat look sky background accent', true],
    ['Keep Open Down To', 'screen/menu/side', 'dock_min', 'menu fold width docked always open', true],
    ['Mosaic Lines (Screensaver)', 'house/screensaver', 'saver:mosaic_line', 'screensaver mosaic line thickness color spacing divider border'],
    ['Up To (Mosaic)', 'house/screensaver', 'saver:mosaic_random', 'screensaver mosaic random number photos up to change'],
    ['Clock Text Shadow and Outline', 'house/screensaver', 'saver:clock_text_shadow', 'screensaver clock photos shadow outline stand out text readable'],
    ['Photos Behind the Clock', 'house/screensaver', 'saver:clock_photo_dim', 'screensaver clock photos background sharp soft blur darken dim']
  );
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
                         clock_over: 'corner', clock_style: 'classic', clock_bg: 'gradient', clock_motion: 'slow', clock_24: false, clock_colors: {}, clock_speed: 35, clock_depth: 50, clock_night: 'off', clock_night_from: '22:00', clock_night_to: '07:00',
                     photo_layout: 'single', mosaic_count: 3, mosaic_gap: 'thin', mosaic_change: 'one', mosaic_line: 0, mosaic_color: 'black', mosaic_random: false, mosaic_every: 10,
                     clock_photo_soft: false, clock_photo_dim: 35, clock_text_shadow: 40, clock_text_outline: 0,
                     // Home Energy and the additional screens (settings.py, 2026-10-14)
                     energy_slide: false, extra_music: false, extra_forecast: false, extra_every: 5, extra_for: 30, energy_hide: [],
                     weather_slide: false, weather_hide: [] };
  function saverOptions(o) {
    var out = {};
    Object.keys(SAVER_DEFAULTS).forEach(function (k) {
      out[k] = o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : SAVER_DEFAULTS[k];
    });
    return out;
  }
  // THE HOMEVIEW-STYLE FACES (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I; settings.py's block of the same
  // name): three more Shows (hk-saverfaces.js), three more clock faces (hk-saverclock.js), the Forecast's Layout,
  // the photos' Titles and Time Behind, and the Day face's look. Each default is how the screensaver drew before.
  // [id, name, what it is] -- the Show control's choices, Photos & Forecast ('both') being Photos with a slide
  var SAVER_SHOWS = [
    ['photos', 'Photos', 'Your photos, one after another.'],
    ['forecast', 'Forecast', 'The forecast over the live sky and the season’s landscape.'],
    ['clock', 'Clock', 'A clock, full screen, over the background you choose.'],
    ['glance', 'Glance', 'The date, a clock, what’s playing and the weather, on a calm color.'],
    ['month', 'Month', 'This month with today circled, and the date drawn large behind it.'],
    ['day', 'Day', 'The weekday and a big date, with HK’s own art for the day: pumpkins at Halloween, a cake on a birthday, the season’s leaves.']];
  var FORECAST_LAYOUTS = [['classic', 'Classic'], ['big', 'Big']];
  var DAY_LOOKS = [['auto', 'By Time of Day'], ['light', 'Light'], ['dark', 'Dark']];
  Object.assign(SAVER_DEFAULTS, { forecast_layout: 'classic', photo_titles: false, time_behind: false, day_look: 'auto' });
  CLOCK_STYLES.push(['liquid', 'Liquid', 'Soft, glossy numerals that drift slowly over a pastel gradient'],
                    ['giant', 'Giant Numerals', 'An analog clock with 12, 3, 6 and 9 drawn huge on a strong color'],
                    ['scattered', 'Scattered Numerals', 'A quiet analog face whose numerals lean and fade, on a soft color']);
  CLOCK_COLORS.liquid = [['pastel', 'Pastel'], ['sunset', 'Sunset'], ['ocean', 'Ocean'], ['mint', 'Mint']];
  CLOCK_COLORS.giant = [['green', 'Green'], ['blue', 'Blue'], ['orange', 'Orange'], ['pink', 'Pink'], ['black', 'Black']];
  CLOCK_COLORS.scattered = [['rose', 'Rose'], ['sage', 'Sage'], ['sky', 'Sky'], ['sand', 'Sand'], ['night', 'Night']];
  // the faces that bring their own ground: the Background behind the clock isn't drawn under them
  var CLOCK_OWN_GROUND = ['liquid', 'giant', 'scattered'];
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
    // the groups as the screen's page has them (2026-10-09; named as its
    // groups are since 2026-10-30): Menu, Home Page, Header, Pages,
    // Appearance, Now Playing & Pop-ups, Screensaver, This Device
    // a screen's menu: All Screens', or its own one setting at a time (menu_own)
    ['menu', 'Menu', ['menu', 'menu_own', 'page_header', 'dock_min', 'time_weather', 'ha_row', 'ha_place', 'tab_position', 'tab_size',
                      'tab_size_phone', 'accent', 'glyph', 'clock', 'swipe',
                      'tab_bar_scroll', 'tab_bar_rooms', 'tab_bar_glass', 'tab_bar_more', 'tab_bar_more_phone', 'tab_bar_pos', 'tab_bar_fold', 'tab_bar_start', 'tab_bar_adjust', 'tab_bar_scroll_phone', 'tab_bar_tabs',
                      'tab_bar_tabs_rail', 'tab_bar_tabs_phone', 'tab_bar_size', 'tab_bar_labels', 'tab_bar_strip', 'menu_phone', 'button_phone', 'tab_bar_rooms_phone',
                      'swipe_pages'], true],
    ['home', 'Home Page', ['chips_row', 'chips', 'chips_quiet', 'chips_extra', 'chips_custom', 'chips_custom_show'], true],
    // a screen's rooms: All Screens' or its own (rooms_custom)
    ['rooms', 'Rooms', ['rooms_custom', 'room_order', 'home_rooms', 'menu_rooms', 'page_rooms'], true],
    // a screen's cameras: All Screens' or its own (cameras_custom)
    ['cameras', 'Cameras', ['camera_strip', 'cameras_custom', 'cameras', 'camera_live', 'camera_live_video'], true],
    ['scenes', 'Scenes', ['scenes_row', 'scenes', 'scenes_pages'], false],
    ['favorites', 'Favorites', ['favorites'], false],
    ['header', 'Header', ['phone_header', 'kiosk', 'kiosk_header', 'kiosk_sidebar', 'kiosk_admins', 'kiosk_engine', 'kiosk_options'], true],
    // the pages, Home among them, and where each sits in the menu (set on Pages)
    ['pages', 'Pages', ['pages', 'custom_pages', 'only_pages', 'home_page', 'home_view', 'menu_top', 'categories', 'headers', 'pages_screen'], true],
    ['look', 'Appearance', ['flat', 'flat_theme', 'glass', 'frost', 'frost_tint', 'blur', 'tint', 'well', 'tile_style', 'bright_pages', 'sky', 'sky_animations', 'sky_weather', 'sky_precipitation', 'sky_focus_pause',
                            'sky_decorations', 'sky_decoration_style', 'sky_moving', 'sky_cloud_style', 'sky_daytime', 'sky_gradient', 'sky_custom', 'sky_pages',
                            'sky_liveliness', 'sky_liveliness_occ', 'sky_liveliness_custom', 'sky_calm_empty',
                            'sky_background', 'sky_color', 'sky_photo', 'sky_page_photos', 'sky_photo_look', 'sky_page_looks',
                            'sky_landscape', 'sky_landscape_look', 'sky_flat_background', 'sky_flat_color', 'sky_flat_fade', 'sky_flat_tint', 'sky_flat_tint_amount', 'sky_flat_tint_light', 'sky_flat_pages', 'sky_flat_image_look', 'sky_flat_page_image_looks', 'sky_image_look',
                            'flat_colors', 'flat_page_colors',
                            // Bright Glass's Strength and the Wallpaper (2026-10-30)
                            'bright', 'sky_wallpaper', 'sky_wallpaper_night', 'sky_wallpaper_motion'], true],
    ['behavior', 'Now Playing, Side Pane, Pop-ups & Notifications', ['popups', 'notify', 'notify_saver', 'notify_dnd', 'now_playing', 'timer_bar', 'bar_all_pages',
                              'np_style', 'np_side', 'np_bar', 'np_bar_phone', 'side_pane'], true],
    ['idle', 'Screensaver', ['screensaver', 'screensaver_options', 'screensaver_engine', 'wallpanel_options'], true],
    ['device', 'This Device', ['car', 'car_layout', 'car_width'], false]
  ];
  // never copied (1.14: a tablet's own -- its user, room, idle, Sleep Screen
  // and Black Screen -- are the tablet's, not the screen's)
  // a screen's own where and title (settings.py BOARD_OWN) are never copied onto another
  // ...nor its Home Grid (its Home Style and layout): Copy Layout To… copies
  // a layout, keeping each block's tablet_room as it is (docs/phase11/HOME-GRID.md, G6)
  // (a Look's Undo is its own screen's: 2026-10-30)
  var COPY_NEVER = ['where', 'title', 'home_style', 'home_grid', 'look_undo'];
  function copyDefaults() { return COPY_GROUPS.filter(function (g) { return g[3]; }).map(function (g) { return g[0]; }); }
  // the changes that copy `groups` of the screen `src` (its settings as read)
  function copyChanges(src, groups) {
    var out = {};
    COPY_GROUPS.forEach(function (g) {
      if (!src || (groups || []).indexOf(g[0]) < 0) return;
      g[2].forEach(function (k) {
        // a screen following All Screens' screensaver: the copy follows too
        if (k === 'screensaver_options') { out[k] = saverFollows(src) ? null : JSON.parse(JSON.stringify(src[k])); return; }
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
    if (o.energy_slide) extra.push('Home Energy');
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
    var keys = ['sky_animations', 'sky_weather', 'sky_precipitation', 'sky_focus_pause', 'sky_decorations', 'sky_decoration_style', 'sky_moving', 'sky_cloud_style', 'sky_daytime', 'sky_gradient', 'sky_custom',
                'sky_background', 'sky_color', 'sky_photo', 'sky_photo_look', 'sky_landscape', 'sky_landscape_look',
                'sky_wallpaper', 'sky_wallpaper_night', 'sky_wallpaper_motion'];
    var pages = Object.keys(b.sky_pages || {}).length;
    if (keys.every(function (k) { return b[k] == null; }) && !pages) return 'Same as All Screens';
    var parts = [];
    // the Background first: a still Color or Photo is the whole look
    if (b.sky_background) parts.push(BG_LABELS[b.sky_background] || b.sky_background);
    if (b.sky_background === 'color' || b.sky_background === 'photo' || b.sky_background === 'landscapes' || b.sky_background === 'wallpaper') return parts.concat(pages ? [pages === 1 ? '1 Page Background' : pages + ' Page Backgrounds'] : []).join(', ');
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

  // ------------------------------------------------------------ wall tablets (1.14)
  // A TABLET'S KIOSK APP: [id, name, what HK can do with it]
  var TABLET_APPS = [
    ['kiosk_satellite', 'Kiosk Satellite', 'Status, brightness, wake, sleep, restart.'],
    ['fully', 'Fully Kiosk', 'Status, brightness, reload, restart.'],
    ['wallpanel', 'WallPanel', 'HK’s idle and screensaver in the browser; no status.'],
    ['browser', 'Just a Browser', 'Any browser you say is a tablet: HK’s idle and screensaver.']
  ];
  function tabletApp(id) { return TABLET_APPS.filter(function (a) { return a[0] === id; })[0] || TABLET_APPS[3]; }
  // Idle Time (settings.IDLE_TIMES), seconds; 0 never
  var IDLE_TIMES = [[30, '30 Seconds'], [50, '50 Seconds'], [60, '1 Minute'], [120, '2 Minutes'], [300, '5 Minutes'], [0, 'Never']];
  function idleLabel(sec) {
    var hit = IDLE_TIMES.filter(function (o) { return o[0] === sec; })[0];
    return hit ? hit[1] : sec + ' s';
  }
  function secsLabel(sec) { return sec < 60 ? sec + ' s' : (sec % 60 ? Math.round(sec / 6) / 10 : sec / 60) + ' min'; }
  // WHAT A TABLET IS DOING NOW, from its kiosk app (t.parts, tablets.py) and
  // its own entities (`ids`: the panel's screensavers[tid]): Offline, Dark,
  // Screensaver or Awake, why (Sleep Screen's reason), since when, and its
  // battery
  var TABLET_WORDS = { off: 'Offline', dark: 'Dark', photos: 'Screensaver', awake: 'Awake' };
  function tabletStatus(t, states, ids) {
    var p = (t && t.parts) || {}, s = function (id) { return (id && states && states[id]) || null; };
    ids = ids || {};
    var on = s(p.online), bat = s(p.battery), chg = s(p.charging), scr = s(p.screen);
    var black = s(ids.black), photos = s(ids['switch']), sleep = s(ids.sleep);
    var st = 'awake', since = null;
    if ((on && on.state === 'off') || (p.battery && (!bat || bat.state === 'unavailable'))) {
      st = 'off'; since = (on && on.state === 'off' ? on : bat || {}).last_changed || null;
    } else if (black && black.state === 'on') { st = 'dark'; since = black.last_changed; }
    else if (photos && photos.state === 'on') { st = 'photos'; since = photos.last_changed; }
    else if (scr && scr.state === 'off') { st = 'dark'; since = scr.last_changed; }
    var b = bat ? Number(bat.state) : NaN;
    return { st: st, word: TABLET_WORDS[st], since: since || null,
             why: (st !== 'off' && sleep && sleep.attributes && sleep.attributes.reason) || '',
             batt: isFinite(b) ? Math.round(b) : null, charging: chg ? chg.state === 'on' : null,
             known: !!(p.battery || ids.black || ids['switch']) };
  }
  // THE TABLET'S KIOSK APP AGAINST WHAT HK NEEDS -- the same rules as
  // tablets.py checks() (Setup Check): [{key, ok, title, detail, fix}];
  // fix: [domain, service, data] (or ['hk', 'kiosk_saver'])
  var SAVER_TIMEOUT = 86400, BATTERY_CARE = 85;
  function tabletChecks(t, states) {
    var p = (t && t.parts) || {}, out = [];
    var val = function (id) { var x = id && states && states[id]; return x ? x.state : null; };
    if (!Object.keys(p).length) return out;
    if (val(p.online) === 'off' || (p.battery && (val(p.battery) === null || val(p.battery) === 'unavailable'))) {
      out.push({ key: 'online', ok: false, title: 'Kiosk App Not Heard From',
                 detail: 'It may be off the Wi-Fi, or behind the lock screen after a restart.' });
    }
    if (p.adaptive) {
      var on = val(p.adaptive) === 'on';
      out.push({ key: 'adaptive', ok: !on, title: 'Adaptive Brightness Off',
                 detail: on ? 'On: Android changes the brightness, and fights Sleep Screen’s.' : 'Sleep Screen sets the brightness.',
                 fix: ['switch', 'turn_off', { entity_id: p.adaptive }] });
    }
    if (t.app === 'kiosk_satellite' && p.saver_mode) {
      var mode = val(p.saver_mode), tmo = Number(val(p.saver_timeout));
      var good = mode === 'Black' && (!p.saver_timeout || !isFinite(tmo) || tmo >= SAVER_TIMEOUT);
      out.push({ key: 'saver', ok: good, title: 'Kiosk Screensaver: Black, after 1 day',
                 detail: good ? 'HK’s screensaver and black do the work.'
                   : 'It is ' + (mode || 'unknown') + ', after ' + (isFinite(tmo) ? tmo : 0) + ' s: it can come up over HK’s.',
                 fix: ['hk', 'kiosk_saver'] });
    }
    if (p.kiosk_mode) {
      var km = val(p.kiosk_mode) === 'on';
      out.push({ key: 'kiosk_mode', ok: km, title: 'Kiosk Mode On',
                 detail: km ? 'Nobody can leave the dashboard by accident.' : 'Off: anybody can leave the dashboard.',
                 fix: p.kiosk_mode.indexOf('switch.') === 0 ? ['switch', 'turn_on', { entity_id: p.kiosk_mode }] : null });
    }
    if (p.update) {
      var up = val(p.update) === 'on';
      out.push({ key: 'update', ok: !up, title: 'App Up to Date', detail: up ? 'An update is waiting.' : '', fix: null });
    }
    var bat = Number(val(p.battery)), chg = val(p.charging);
    if (p.battery && p.charging && isFinite(bat) && chg !== null) {
      var hot = chg === 'on' && bat > BATTERY_CARE;
      out.push({ key: 'battery', ok: !hot, title: 'Battery Care', fix: null,
                 detail: hot ? Math.round(bat) + '% and charging all day. Turn on Protect Battery on the tablet.'
                   : Math.round(bat) + '% ' + (chg === 'on' ? 'while plugged in.' : 'and not charging.') });
    }
    return out;
  }
  // WHEN IT'S LEFT ALONE, in order: Home after Idle Time (null: Return to
  // Home is off), the screensaver at its Starts After (null: no
  // screensaver), dark by Sleep Screen. {segs: [{cls, label, flex, at, says}],
  // warn: Home comes only after the screensaver is up}
  function idleTimeline(o) {
    var idle = o.idle, saver = o.saver, segs = [{ cls: 'use', label: 'Touched', flex: 2 }];
    var dark = o.hk ? (o.after ? 'after ' + o.after + ' min of photos' : (o.quiet ? 'nobody here, or quiet hours' : 'once nobody’s here'))
                    : 'an automation decides';
    if (idle && saver && idle > saver) {
      segs.push({ cls: 'saver', label: 'Screensaver', flex: 1.6, at: secsLabel(saver), says: 'screensaver' });
      segs.push({ cls: 'home', label: 'Home, behind it', flex: 1.4, at: secsLabel(idle), says: 'Home' });
    } else {
      if (idle) segs.push({ cls: 'home', label: 'Home', flex: 1.4, at: secsLabel(idle), says: saver === idle ? 'Home + screensaver' : 'Home' });
      if (saver && saver !== idle) segs.push({ cls: 'saver', label: 'Screensaver', flex: 3, at: secsLabel(saver), says: 'screensaver' });
    }
    segs.push({ cls: 'dark', label: 'Dark', flex: 3, at: 'Sleep Screen', says: dark });
    return { segs: segs, warn: !!(idle && saver && idle > saver) };
  }
  // THE TABLET'S START URL: its screen with ?hk_tablet=<id>
  function tabletUrl(origin, screen, id) {
    return String(origin || '').replace(/\/+$/, '') + '/' + (screen || 'lovelace') + '?hk_tablet=' + id;
  }

  // ------------------------------------------------------ the Weather page
  // (2026-10-16, hk_house/docs/PLAN-2026-10-16-weather-page.md): what the
  // page shows (weather.page) and its own radar (weather.radar_native). The
  // defaults are settings.py's WEATHER_PAGE_DEFAULTS / RADAR_DEFAULTS (and
  // hk-settings.js DEFAULTS.weather -- test_settingsmodel holds them equal).
  var WX_DETAILS = [['wind', 'Wind', 'hk:weather-windy'], ['sun', 'Sunrise & Sunset', 'hk:weather-sunset'],
                    ['uv', 'UV Index', 'hk:white-balance-sunny'], ['humidity', 'Humidity', 'hk:water-percent'],
                    ['moon', 'Moon', 'hk:weather-night'], ['pressure', 'Pressure', 'mdi:gauge']];
  var WX_PAGE_DEFAULTS = { show_current: true, show_hourly: true, show_daily: true, show_alerts: true,
                           hours: 12, days: 8, hourly_metric: 'temperature',
                           details: ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'], load_animation: true };
  var WX_HOURS = [[6, '6'], [12, '12'], [24, '24']];
  var WX_DAYS = [[5, '5'], [8, '8'], [10, '10']];
  var WX_METRICS = [['temperature', 'Temperature'], ['rain', 'Rain'], ['wind', 'Wind']];
  var RADAR_DEFAULTS = { version: 1, enabled: false, provider: 'auto', basemap: 'osm', center: 'home', zone: null,
                         zoom: 5, marker: true, history_minutes: 60, playback_speed: 'normal', autoplay: true,
                         interactive: true, playback_controls: true, opacity: 75 };
  var RADAR_PROVIDERS = [['auto', 'Automatic'], ['noaa', 'NOAA (US)'], ['rainviewer', 'RainViewer']];
  var RADAR_NAMES = { noaa: 'NOAA', rainviewer: 'RainViewer' };
  var RADAR_BASEMAPS = [['osm', 'OpenStreetMap']];
  var RADAR_CENTERS = [['home', 'Home'], ['zone', 'A Zone']];
  var RADAR_HISTORY = [[30, '30 Minutes'], [60, '1 Hour'], [120, '2 Hours']];
  var RADAR_SPEEDS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
  // the Weather Radar Card's options the native radar took over (settings.py
  // RADAR_LEGACY_MAPPED); the rest are kept, unused
  var RADAR_LEGACY_MAPPED = ['data_source', 'zoom_level', 'static_map', 'show_playback', 'markers'];
  function wxPage(st) {
    var o = ((st || {}).weather || {}).page;
    var out = JSON.parse(JSON.stringify(WX_PAGE_DEFAULTS));
    if (o && typeof o === 'object') Object.keys(out).forEach(function (k) { if (k in o) out[k] = o[k]; });
    return out;
  }
  function radarOf(st) {
    var o = ((st || {}).weather || {}).radar_native;
    var out = Object.assign({}, RADAR_DEFAULTS);
    if (o && typeof o === 'object') Object.keys(out).forEach(function (k) { if (k in o) out[k] = o[k]; });
    return out;
  }
  // "12 Hours · 8 Days · 6 Details": what is configured, not what the
  // service happens to give
  function forecastSummary(p) {
    var bits = [];
    if (p.show_hourly) bits.push(p.hours + ' Hours');
    if (p.show_daily) bits.push(p.days + ' Days');
    bits.push(p.details.length ? p.details.length + (p.details.length === 1 ? ' Detail' : ' Details') : 'No Details');
    return bits.join(' · ');
  }
  // WHERE AND FROM WHOM (hk-settings.js radarPlan, the same rules): the
  // radar's settings `r` and the house -> { provider, place, lat, lon,
  // country, reason }. Automatic: NOAA for a home Home Assistant places in
  // the US, RainViewer elsewhere; a zone's country is not known (nothing is
  // looked up), so there Automatic asks (reason 'choose').
  function radarPlanOf(r, client) {
    var cfg = (client && client.config) || {}, states = (client && client.states) || {};
    var out = { enabled: !!r.enabled, provider: null, chosen: r.provider, lat: null, lon: null, place: 'Home', country: null, reason: null };
    if (r.center === 'zone') {
      var z = r.zone && states[r.zone], za = (z && z.attributes) || {};
      out.place = za.friendly_name || (r.zone ? r.zone.replace(/^zone\./, '').replace(/_/g, ' ') : 'Zone');
      if (!z || typeof za.latitude !== 'number' || typeof za.longitude !== 'number') out.reason = 'zone';
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
  var RADAR_REASONS = {
    choose: 'Choose a radar provider: Automatic can’t tell which country this place is in.',
    zone: 'The zone chosen for the map isn’t in Home Assistant, or has no location.',
    location: 'Home Assistant has no location for this home (Settings → System → General).'
  };
  // the Radar Map row's value: "Off", "NOAA · Home", or what it needs
  function radarSummary(r, plan) {
    if (!r.enabled) return 'Off';
    if (plan.reason === 'choose') return 'Choose a Provider';
    if (plan.reason === 'zone') return 'Choose a Zone';
    if (plan.reason) return 'Needs a Location';
    return RADAR_NAMES[plan.provider] + ' · ' + plan.place;
  }
  function radarAdvancedSummary(r) {
    return 'Zoom ' + r.zoom + ' · ' + choiceLabel(RADAR_HISTORY, r.history_minutes);
  }

  // ------------------------------------------------------------ the side pane
  // THE SIDE PANE (2026-10-30, settings.py side_pane; hk-sidepane.js draws
  // it): one pane per screen, its groups -- Where (Pane Side, Width), On the
  // Dashboard, In the Screensaver, Doorbell -- All Screens' or a screen's
  // own, each on its own. A screen is handed it as read (side_pane_read,
  // its `own` the groups that are the screen's); All Screens' is the house
  // section side_pane. Sections: {kind, size (absent: More), when (absent:
  // Always), and a kind's own options}, eight at most, one Full.
  var PANE_KINDS = [['clock', 'Clock', 'mdi:clock', '#8e8e93'], ['weather', 'Weather', 'mdi:weather-partly-cloudy', '#32ade6'],
    ['calendar', 'Calendar', 'mdi:calendar', '#ff3b30'], ['now_playing', 'Now Playing', 'mdi:music', '#ff2d55'],
    ['security', 'Security', 'mdi:shield-home', '#30b0c7'], ['camera', 'Camera', 'mdi:cctv', '#636366'],
    ['timers', 'Timers', 'mdi:timer-outline', '#ff9500'], ['energy', 'Energy', 'mdi:lightning-bolt', '#34c759'],
    ['climate', 'Climate', 'mdi:thermostat', '#007aff'], ['people', 'Who’s Home', 'mdi:account', '#5856d6'],
    ['todo', 'To-do', 'mdi:clipboard-check', '#ff9500'], ['notifications', 'Notifications', 'mdi:bell', '#ff3b30']];
  var PANE_SIZES = [['tiny', 'Tiny'], ['less', 'Less'], ['more', 'More'], ['full', 'Full']];
  var PANE_WHEN = [['always', 'Always'], ['active', 'When There’s Something']];
  var PANE_SIDES = [['left', 'Left'], ['right', 'Right']];
  var PANE_WIDTHS = [['narrow', 'Narrow'], ['standard', 'Standard'], ['wide', 'Wide']];
  var PANE_SHOWS = [['off', 'Off'], ['home', 'Home Only'], ['all', 'Every Page']];
  var PANE_SAVER_SHOWS = [['off', 'Off'], ['same', 'Same as the Dashboard'], ['own', 'Its Own Sections']];
  var PANE_GROUPS = ['side', 'width', 'dashboard', 'saver', 'doorbell', 'headings'];
  var PANE_MAX = 8;
  var PANE_DEFAULTS = { side: 'right', width: 'standard',
    dashboard: { show: 'off', sections: [{ kind: 'weather' }, { kind: 'calendar' }, { kind: 'now_playing', when: 'active' }] },
    saver: { show: 'off', sections: [{ kind: 'clock', size: 'tiny' }, { kind: 'calendar' }, { kind: 'now_playing', size: 'less', when: 'active' }] },
    doorbell: true, headings: true };
  function paneCopy(v) { return JSON.parse(JSON.stringify(v)); }
  function paneKind(k) { return PANE_KINDS.filter(function (x) { return x[0] === k; })[0] || null; }
  // a section as stored: More and Always are what absent means
  function paneSection(s) {
    var out = {};
    Object.keys(s || {}).forEach(function (k) {
      if ((k === 'size' && s[k] === 'more') || (k === 'when' && s[k] === 'always') || (k === 'completed' && !s[k]) ||
          (k === 'place' && s[k] === 'top') || (k === 'tap' && s[k] === 'auto')) return;
      out[k] = s[k];
    });
    return out;
  }
  // THE PANE AS THIS PAGE EDITS IT: a screen's as read, else All Screens'
  // (over the defaults); `own` the screen's own groups (none for All Screens)
  function paneOf(house, b) {
    var r = b && b.side_pane_read;
    if (r) return Object.assign(paneCopy(r), { own: (r.own || []).slice() });
    var h = paneCopy(PANE_DEFAULTS);
    PANE_GROUPS.forEach(function (g) { if (house && house[g] !== undefined && house[g] !== null) h[g] = paneCopy(house[g]); });
    h.own = [];
    return h;
  }
  // whose a group is, on a screen ('' for All Screens)
  function paneGroupSays(p, g, screen) { return !screen ? '' : p.own.indexOf(g) >= 0 ? 'Just This Screen' : 'Same as All Screens'; }
  // WHAT A CHANGE SAVES: All Screens' one group (side_pane.<group>), or the
  // screen's own object -- the groups it had, and this one now its own too
  function paneSet(p, g, value, screen) {
    var out = {};
    if (!screen) { out['side_pane.' + g] = value; return out; }
    var own = {};
    p.own.forEach(function (x) { own[x] = paneCopy(p[x]); });
    own[g] = value;
    out.side_pane = own;
    return out;
  }
  // ...and Reset to All Screens: the group no longer the screen's (none
  // left: null, Same as All Screens in everything)
  function paneReset(p, g) {
    var own = {};
    p.own.forEach(function (x) { if (x !== g) own[x] = paneCopy(p[x]); });
    return { side_pane: Object.keys(own).length ? own : null };
  }
  // A GROUP'S SECTIONS, changed: each returns the whole new group
  function secKey(s) { return s.kind + ':' + (s.entity || ''); }
  function paneGroup(grp, sections) { return { show: grp.show, sections: sections.map(paneSection) }; }
  function secsAdd(grp, kind) {
    if (!paneKind(kind) || grp.sections.length >= PANE_MAX) return paneGroup(grp, grp.sections);
    return paneGroup(grp, grp.sections.concat([{ kind: kind, size: 'less' }]));
  }
  function secsOrder(grp, keys) {
    var by = {};
    grp.sections.forEach(function (s) { by[secKey(s)] = s; });
    return paneGroup(grp, keys.map(function (k) { return by[k]; }).filter(Boolean));
  }
  function secSet(grp, i, k, v) {
    var list = paneCopy(grp.sections);
    if (!list[i]) return paneGroup(grp, list);
    // ONE FULL AT A TIME: another made Full is More again
    if (k === 'size' && v === 'full') list.forEach(function (s, j) { if (j !== i && s.size === 'full') delete s.size; });
    if (v === null || v === undefined || v === '') delete list[i][k]; else list[i][k] = v;
    return paneGroup(grp, list);
  }
  // the kinds not yet in a group (a camera or a list may come twice, by its entity)
  function secsMore(grp) {
    var have = grp.sections.map(function (s) { return s.kind; });
    return grp.sections.length >= PANE_MAX ? [] : PANE_KINDS.filter(function (k) { return have.indexOf(k[0]) < 0 || k[0] === 'camera' || k[0] === 'todo'; });
  }
  // A SECTION'S ROW SAYS its size and when: "More", "Tiny · When There's Something"
  function secSays(s) {
    var size = choiceLabel(PANE_SIZES, s.size || 'more');
    return [size, s.when === 'active' ? 'When There’s Something' : '', s.place === 'bottom' ? 'At the Bottom' : ''].filter(Boolean).join(' · ');
  }
  // WHERE A SECTION SITS and WHAT A TAP DOES (settings.py PANE_PLACES, PANE_TAPS; 2026-10-30)
  var PANE_PLACES = [['top', 'Top'], ['bottom', 'Bottom']];
  var PANE_TAPS = [['auto', 'Automatic'], ['page', 'Its Page'], ['sheet', 'Its Sheet'], ['none', 'Nothing']];
  // THE LINKS that were each pane's own settings: the Dashboard's ("Home
  // Only, Right"), the screensaver's ("Calendar, Now Playing"), and Now
  // Playing's Show As (the bar, or the Side Pane)
  function paneSummary(p) {
    var d = p.dashboard || {};
    return d.show === 'off' || !d.show ? 'Off' : choiceLabel(PANE_SHOWS, d.show) + ', ' + choiceLabel(PANE_SIDES, p.side);
  }
  function paneSaverSummary(p) {
    var g = p.saver || {};
    if (g.show === 'same') return 'Same as the Dashboard';
    if (g.show !== 'own' || !(g.sections || []).length) return 'Off';
    return listText(g.sections.map(function (s) { return (paneKind(s.kind) || [0, s.kind])[1]; }));
  }
  function paneHasMusic(p) {
    var d = p.dashboard || {};
    return d.show !== 'off' && (d.sections || []).some(function (s) { return s.kind === 'now_playing'; });
  }
  function npShowAs(p) { return paneHasMusic(p) ? 'In the Side Pane' : 'Bar'; }


  // ------------------------------------------------------------ LOOKS
  // LOOKS (2026-10-30, hk_core/settings/looks.py -- the one list; this is its
  // copy, compared by tests/test_hk_core_looks.py): whole themed setups a
  // screen takes in one step -- its settings, its screensaver's options (a
  // patch over the screen's) and the layout it starts from.
  var LOOK_KEYS = ["flat", "flat_theme", "glass", "accent", "tab_bar_glass", "tile_style", "sky", "sky_background", "sky_color", "sky_wallpaper", "sky_wallpaper_night", "sky_wallpaper_motion", "sky_animations", "sky_weather", "sky_precipitation", "sky_moving", "sky_decorations", "sky_liveliness", "swipe_pages", "side_pane", "screensaver", "screensaver_options", "camera_live_video"];
  var LOOK_UNDO_KEYS = ["flat", "flat_theme", "glass", "accent", "tab_bar_glass", "tile_style", "sky", "sky_background", "sky_color", "sky_wallpaper", "sky_wallpaper_night", "sky_wallpaper_motion", "sky_animations", "sky_weather", "sky_precipitation", "sky_moving", "sky_decorations", "sky_liveliness", "swipe_pages", "side_pane", "screensaver", "screensaver_options", "camera_live_video", "home_style", "home_grid"];
  var LOOKS = [
    {"id": "homeview", "name": "HomeView", "about": "Square tiles, centred, over a slow-moving wallpaper in Bright Glass, with the Side Pane and the Analog Numbers clock.", "art": ["#1f4b8d", "#375b91", "#0b285d", "#ff9500"], "layout": {"cell": "square", "starters": ["sq_pane", "sq_6x4", "sq_3x5", "sq_2x4", "sq_homeview"]}, "settings": {"flat": false, "glass": "bright", "accent": "orange", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "wallpaper", "sky_wallpaper": "ribbons_blue", "sky_wallpaper_night": "auto", "sky_wallpaper_motion": "slow", "swipe_pages": "on", "side_pane": {"side": "right", "headings": true, "dashboard": {"show": "home", "sections": [{"kind": "weather", "size": "more"}, {"kind": "calendar", "size": "more"}, {"kind": "now_playing", "size": "more", "when": "active"}]}}, "screensaver": true}, "saver": {"show": "clock", "clock_style": "numbers", "clock_bg": "gradient", "clock_motion": "slow"}},
    {"id": "flat", "name": "Flat", "about": "Clean and solid: no blur, high contrast, the cards on one dark colour.", "art": ["#1c1c1e", "#1c1c1e", "#1c1c1e", "#0a84ff"], "layout": {"cell": "tile", "starters": ["A"]}, "settings": {"flat": true, "flat_theme": "dark", "accent": "blue", "tab_bar_glass": "tinted", "tile_style": "home", "swipe_pages": "auto", "screensaver": true}, "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still"}},
    {"id": "performance", "name": "Performance", "about": "The lightest setup for a slow wall tablet: Glass, no rain or snow, nothing moving in front of the cards, no live camera, and a still screensaver.", "art": ["#2b3140", "#3a4152", "#202531", "#ff9500"], "layout": {"cell": "tile", "starters": ["Q"]}, "settings": {"flat": false, "glass": "clear", "accent": "orange", "tab_bar_glass": "tinted", "tile_style": "home", "sky_animations": false, "sky_precipitation": false, "sky_moving": "behind", "sky_decorations": false, "sky_wallpaper_motion": "off", "camera_live_video": false, "screensaver": true}, "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still", "zoom": false}},
    {"id": "holiday", "name": "Holiday Whimsy", "about": "The live sky with the season's scenery and decorations, a festive bustle, the Day face with its occasion art, and Scattered Numerals.", "art": ["#2a1450", "#7a3b1c", "#1b0f24", "#ff9f0a"], "layout": {"cell": "tile", "starters": ["F", "A"]}, "settings": {"flat": false, "glass": "blur", "accent": "orange", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "live", "sky_animations": true, "sky_decorations": true, "sky_liveliness": "festive", "sky_moving": "front", "swipe_pages": "auto", "screensaver": true}, "saver": {"show": "day", "clock_style": "scattered", "day_look": "auto"}},
    {"id": "weather", "name": "Active Weather", "about": "The live sky with its weather moving -- clouds, rain and snow -- the weather large in the Side Pane and Big Weather in the screensaver.", "art": ["#3a6ea8", "#7fa6c9", "#2c4a6b", "#32ade6"], "layout": {"cell": "tile", "starters": ["C", "A"]}, "settings": {"flat": false, "glass": "blur", "accent": "cyan", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "live", "sky_animations": true, "sky_weather": true, "sky_precipitation": true, "sky_moving": "behind", "swipe_pages": "auto", "side_pane": {"side": "right", "headings": false, "dashboard": {"show": "home", "sections": [{"kind": "weather", "size": "full"}, {"kind": "calendar", "size": "less"}]}}, "screensaver": true}, "saver": {"show": "forecast", "forecast_layout": "big"}},
    {"id": "calm", "name": "Calming Backgrounds", "about": "Soft violet petals drifting slowly in Bright Glass, muted colours, and the Liquid clock.", "art": ["#3c3283", "#524999", "#211a5e", "#5e5ce6"], "layout": {"cell": "square", "starters": ["sq_pane", "sq_6x4", "sq_3x5", "sq_2x4", "sq_homeview"]}, "settings": {"flat": false, "glass": "bright", "accent": "indigo", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "wallpaper", "sky_wallpaper": "petals_violet", "sky_wallpaper_night": "auto", "sky_wallpaper_motion": "slow", "swipe_pages": "on", "screensaver": true}, "saver": {"show": "clock", "clock_style": "liquid", "clock_bg": "gradient", "clock_motion": "slow"}},
    {"id": "night", "name": "Night & Bedside", "about": "Dark and quiet for a bedroom: a deep colour, the big clock a swipe from the weather, and a dim red clock at night.", "art": ["#0b1026", "#121a3a", "#05070f", "#ff453a"], "layout": {"cell": "tile", "starters": ["n_standby", "n_clock"]}, "settings": {"flat": false, "glass": "tinted", "accent": "red", "tab_bar_glass": "tinted", "tile_style": "home", "sky": true, "sky_background": "color", "sky_color": "midnight", "sky_animations": false, "swipe_pages": "on", "side_pane": {"dashboard": {"show": "off", "sections": []}}, "screensaver": true}, "saver": {"show": "clock", "clock_style": "classic", "clock_bg": "black", "clock_motion": "still", "clock_night": "night"}},
    {"id": "photos", "name": "Photo Frame", "about": "The landscapes behind the cards, and your photos soon after you stop -- their titles, the time behind their subject where it can be.", "art": ["#4a6a3a", "#8aa070", "#2a3a22", "#ff375f"], "layout": {"cell": "tile", "starters": ["Q", "A"]}, "settings": {"flat": false, "glass": "blur", "accent": "pink", "tab_bar_glass": "house", "tile_style": "auto", "sky": true, "sky_background": "landscapes", "swipe_pages": "auto", "screensaver": true}, "saver": {"show": "photos", "starts_after": 60, "photo_titles": true, "time_behind": true}}
  ];
  function lookOf(id) { return LOOKS.filter(function (l) { return l.id === id; })[0] || null; }
  // WHAT A LOOK CHANGES on a screen (`b`: its settings as read; `saver`: its
  // screensaver's options now): the changes to send, its Undo (the screen's
  // own values before), and the rows the sheet shows ([label, was, becomes])
  // -- only what differs. `layout`: the Layout + Look's grid, if any.
  var LOOK_LABELS = { flat: 'Flat Colors', flat_theme: 'Flat Theme', glass: 'Style', accent: 'Accent Color', tab_bar_glass: 'Tab Bar Glass',
    tile_style: 'Tile Style', sky: 'Sky', sky_background: 'Background', sky_color: 'Color', sky_wallpaper: 'Wallpaper',
    sky_wallpaper_night: 'Night Version', sky_wallpaper_motion: 'Wallpaper Motion', sky_animations: 'Animations', sky_weather: 'Weather',
    sky_precipitation: 'Rain & Snow', sky_moving: 'Moving Things', sky_decorations: 'Decorations', sky_liveliness: 'Liveliness',
    swipe_pages: 'Swipe Between Pages', side_pane: 'Side Pane', screensaver: 'Screensaver', screensaver_options: 'Screensaver Options',
    camera_live_video: 'Live Camera', home_style: 'Home', home_grid: 'Layout' };
  function lookSays(k, v) {
    if (v === null || v === undefined) return 'Same as All Screens';
    // a screen's glass 'house' is All Screens' (never "House")
    if (k === 'glass' && v === 'house') return 'Same as All Screens';
    if (v === true) return 'On';
    if (v === false) return 'Off';
    var lists = { glass: GLASS_STYLES, tile_style: TILE_STYLES, sky_wallpaper_night: WALLPAPER_NIGHT, sky_wallpaper_motion: WALLPAPER_MOTION };
    var o = lists[k] && lists[k].filter(function (x) { return x[0] === v; })[0];
    if (o) return o[1];
    if (k === 'side_pane') return v.dashboard && v.dashboard.show === 'off' ? 'Off' : 'On, beside Home';
    if (k === 'screensaver_options') return 'The Look’s Options';
    if (k === 'home_grid') return 'The Look’s starter';
    if (typeof v === 'string') return v.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return 'Set';
  }
  function lookChanges(look, b, saver, layout) {
    b = b || {};
    var ch = JSON.parse(JSON.stringify(look.settings)), was = {}, rows = [];
    ch.screensaver_options = Object.assign({}, saver || {}, look.saver);
    if (layout) { ch.home_style = 'grid'; ch.home_grid = layout; }
    var same = function (a, c) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(c === undefined ? null : c); };
    Object.keys(ch).forEach(function (k) {
      var before = b[k] === undefined ? null : b[k];
      was[k] = before;
      if (k === 'screensaver_options') {
        var now = Object.assign({}, saver || {});
        if (Object.keys(look.saver).some(function (o) { return !same(now[o], look.saver[o]); })) rows.push([LOOK_LABELS[k], 'Your Options', lookSays(k, ch[k])]);
        return;
      }
      if (!same(before, ch[k])) rows.push([LOOK_LABELS[k] || k, k === 'home_grid' && before ? 'Your layout' : lookSays(k, before), lookSays(k, ch[k])]);
    });
    ch.look_undo = { look: look.id, was: was };
    return { changes: ch, rows: rows };
  }
  // ...and its UNDO: the screen's own values back, the Undo spent
  function lookUndo(b) {
    var u = b && b.look_undo;
    if (!u || !u.was) return null;
    var ch = JSON.parse(JSON.stringify(u.was));
    ch.look_undo = null;
    return ch;
  }

  root.hkSettingsModel = {
    PANE_KINDS: PANE_KINDS, PANE_SIZES: PANE_SIZES, PANE_WHEN: PANE_WHEN, PANE_SIDES: PANE_SIDES, PANE_WIDTHS: PANE_WIDTHS,
    PANE_SHOWS: PANE_SHOWS, PANE_SAVER_SHOWS: PANE_SAVER_SHOWS, PANE_GROUPS: PANE_GROUPS, PANE_PLACES: PANE_PLACES, PANE_TAPS: PANE_TAPS, PANE_MAX: PANE_MAX, PANE_DEFAULTS: PANE_DEFAULTS,
    paneKind: paneKind, paneSection: paneSection, paneOf: paneOf, paneGroupSays: paneGroupSays, paneSet: paneSet, paneReset: paneReset,
    secKey: secKey, secsAdd: secsAdd, secsOrder: secsOrder, secSet: secSet, secsMore: secsMore, secSays: secSays,
    paneSummary: paneSummary, paneSaverSummary: paneSaverSummary, paneHasMusic: paneHasMusic, npShowAs: npShowAs,
    skySummary: skySummary, backdropFollow: backdropFollow,
    YAML_REF: YAML_REF, YAML_DEFAULTS: YAML_DEFAULTS, yamlRefText: yamlRefText, yamlRefItem: yamlRefItem,
    previewSizes: previewSizes, previewDefault: previewDefault, previewFit: previewFit,
    SAVER_SHOWS: SAVER_SHOWS, FORECAST_LAYOUTS: FORECAST_LAYOUTS, DAY_LOOKS: DAY_LOOKS, CLOCK_OWN_GROUND: CLOCK_OWN_GROUND, showName: showName,
    SAVER_DEFAULTS: SAVER_DEFAULTS, saverOptions: saverOptions, saverCustom: saverCustom, ENERGY_PARTS: ENERGY_PARTS, energyShown: energyShown, WEATHER_PARTS: WEATHER_PARTS, weatherShown: weatherShown, listText: listText, saverSummary: saverSummary, saverFollows: saverFollows, kioskSummary: kioskSummary,
    NP_STYLES: NP_STYLES, NP_SIDES: NP_SIDES, NP_BARS: NP_BARS, NP_GRACES: NP_GRACES, npSummary: npSummary, npOwn: npOwn, NP_OWN_KEYS: NP_OWN_KEYS,
    COPY_GROUPS: COPY_GROUPS, COPY_NEVER: COPY_NEVER, copyDefaults: copyDefaults, copyChanges: copyChanges,
    skyPreviewScreen: skyPreviewScreen, skyMoments: skyMoments,
    version: '2.0.0',
    CHIP_LABELS: CHIP_LABELS, CHIP_SOURCES: CHIP_SOURCES, PAGE_LABELS: PAGE_LABELS, COUNT_KINDS: COUNT_KINDS, ACC_TYPES: ACC_TYPES, accType: accType, SKY_BACKGROUNDS: SKY_BACKGROUNDS, BG_LABELS: BG_LABELS, BG_SAYS: BG_SAYS, LANDSCAPE_EVERY: LANDSCAPE_EVERY, landscapeLabel: landscapeLabel, landscapeFile: landscapeFile, CLOCK_STYLES: CLOCK_STYLES, CLOCK_BGS: CLOCK_BGS, CLOCK_COLORS: CLOCK_COLORS, clockRecommend: clockRecommend,
    MENU_STYLES: MENU_STYLES, phoneStyleLabel: phoneStyleLabel,
    PHONE_MENUS: PHONE_MENUS, DEVICES: DEVICES, TAB_SIZES: TAB_SIZES, BUTTON_PHONE: BUTTON_PHONE, phoneMenu: phoneMenu, phoneButton: phoneButton,
    tabletSummary: tabletSummary, phoneSummary: phoneSummary, tabletTab: tabletTab, phoneTab: phoneTab, tabletTabBar: tabletTabBar,
    ACCENTS: ACCENTS, accentOf: accentOf,
    FLAT_ACCENTS: FLAT_ACCENTS, flatColorsOf: flatColorsOf, flatPagesName: flatPagesName, flatAccentSays: flatAccentSays, flatColorName: flatColorName, flatColorHex: flatColorHex,
    flatSourceLabel: flatSourceLabel, flatTintLabel: flatTintLabel, flatFieldSays: flatFieldSays, flatAccentChange: flatAccentChange, PAGE_ACCENTS: PAGE_ACCENTS, pageAccentOf: pageAccentOf, tabPosParts: tabPosParts, tabPosJoin: tabPosJoin, tabPosLabel: tabPosLabel,
    PAGE_HEADERS: PAGE_HEADERS, MENU_KEYS: MENU_KEYS, houseMenuAsBoard: houseMenuAsBoard, houseMenuSave: houseMenuSave,
    TAB_BAR_SCROLLS: TAB_BAR_SCROLLS, TAB_BAR_GLASS: TAB_BAR_GLASS, TAB_BAR_ROOMS: TAB_BAR_ROOMS, roomsPlace: roomsPlace, TAB_BAR_MORE: TAB_BAR_MORE, TAB_BAR_POS: TAB_BAR_POS, TAB_BAR_SIZES: TAB_BAR_SIZES, TAB_BAR_LABELS: TAB_BAR_LABELS, HA_PLACES: HA_PLACES, TAB_BAR_TABS: TAB_BAR_TABS, TAB_BAR_TABS_PHONE: TAB_BAR_TABS_PHONE, foldOptions: foldOptions, hasTabBar: hasTabBar, choiceLabel: choiceLabel,
    menuOwn: menuOwn, ownsMenu: ownsMenu, menuOwnSet: menuOwnSet, menuOwnReset: menuOwnReset, menuSummary: menuSummary,
    MENU_KINDS: MENU_KINDS, menuKind: menuKind, kindUsers: kindUsers, usedBy: usedBy, menuWord: menuWord, KIND_KEYS: KIND_KEYS, usesSide: usesSide, PAGE_HEADER_SAYS: PAGE_HEADER_SAYS,
    accentColorOf: accentColorOf, accentChanges: accentChanges, GLASS: GLASS,
    GLASS_STYLES: GLASS_STYLES, BLUR_MODES: BLUR_MODES, BRIGHT_MODES: BRIGHT_MODES, TINT_WELLS: TINT_WELLS, TILE_STYLES: TILE_STYLES, BRIGHT_PAGES: BRIGHT_PAGES, isBlur: isBlur, isBright: isBright, modesFor: modesFor, styleValue: styleValue, glassStyle: glassStyle, WALLPAPER_NIGHT: WALLPAPER_NIGHT, WALLPAPER_MOTION: WALLPAPER_MOTION, SLOW_FPS: SLOW_FPS, LADDER: LADDER, ladderFacts: ladderFacts, ladderSignature: ladderSignature, slowRecommend: slowRecommend, PRESETS: PRESETS, STATUS_LABELS: STATUS_LABELS,
    STATUS_SAYS: STATUS_SAYS, STATUS_ROWS: STATUS_ROWS, STATUS_SOURCE: STATUS_SOURCE, PAGES: PAGES, pageOf: pageOf, PAGE_TYPES: PAGE_TYPES,
    PAGE_FEATURES: PAGE_FEATURES, pagesListed: pagesListed, pageOfRoute: pageOfRoute, routeForward: routeForward, screenShows: screenShows, headerOffOn: headerOffOn, statusSummary: statusSummary, HEADER_PAGES: HEADER_PAGES,
    WOODLAND: WOODLAND, woodlandSummary: woodlandSummary, CLOUD_STYLES: CLOUD_STYLES, SKY_MOVING: SKY_MOVING,
    SWIPE_PAGES: SWIPE_PAGES, SWIPE_PAGES_SAYS: SWIPE_PAGES_SAYS, DAYTIME_SKIES: DAYTIME_SKIES,
    BROWSE_LABELS: BROWSE_LABELS, POPUP_KINDS: POPUP_KINDS, CLOSE_AFTER: CLOSE_AFTER, MONTHS: MONTHS,
    CAR_LAYOUTS: CAR_LAYOUTS, CAR_WIDTHS: CAR_WIDTHS, CAR_WIDTH: CAR_WIDTH, carWidthChoice: carWidthChoice,
    PAGE_PILL_DEFAULTS: PAGE_PILL_DEFAULTS, PILL_COLORS: PILL_COLORS, CAL_COLORS: CAL_COLORS, colorLabel: colorLabel,
    CHIP_TOKEN: CHIP_TOKEN, chipsAddCustom: chipsAddCustom, chipsRemoveCustom: chipsRemoveCustom,
    LIVELY: LIVELY, LIVELY_STEPS: LIVELY_STEPS, LIVELY_OFTEN: LIVELY_OFTEN, LIVELY_PRESETS: LIVELY_PRESETS,
    LIVELY_ALL: LIVELY_ALL, livelyOccLabel: livelyOccLabel, livelyKnobs: livelyKnobs,
    livelyPresetLabel: livelyPresetLabel, livelyFrom: livelyFrom, roomSensors: roomSensors,
    SKY_THEMES: SKY_THEMES, OFTEN_LABELS: OFTEN_LABELS, OFTEN_DEFAULT: OFTEN_DEFAULT, PAGE_TOKEN: PAGE_TOKEN,
    SEARCH: SEARCH,
    WX_DETAILS: WX_DETAILS, WX_PAGE_DEFAULTS: WX_PAGE_DEFAULTS, WX_HOURS: WX_HOURS, WX_DAYS: WX_DAYS, WX_METRICS: WX_METRICS,
    RADAR_DEFAULTS: RADAR_DEFAULTS, RADAR_PROVIDERS: RADAR_PROVIDERS, RADAR_NAMES: RADAR_NAMES, RADAR_BASEMAPS: RADAR_BASEMAPS,
    RADAR_CENTERS: RADAR_CENTERS, RADAR_HISTORY: RADAR_HISTORY, RADAR_SPEEDS: RADAR_SPEEDS, RADAR_LEGACY_MAPPED: RADAR_LEGACY_MAPPED,
    RADAR_REASONS: RADAR_REASONS, wxPage: wxPage, radarOf: radarOf, forecastSummary: forecastSummary, radarPlanOf: radarPlanOf,
    radarSummary: radarSummary, radarAdvancedSummary: radarAdvancedSummary,
    TABLET_APPS: TABLET_APPS, tabletApp: tabletApp, IDLE_TIMES: IDLE_TIMES, idleLabel: idleLabel, tabletStatus: tabletStatus,
    tabletChecks: tabletChecks, idleTimeline: idleTimeline, tabletUrl: tabletUrl,
    errorText: errorText, refusals: refusals,
    menuMode: menuMode, menuFor: menuFor, menuStyleLabel: menuStyleLabel, showsTab: showsTab,
    stylesFor: stylesFor, swipeChanges: swipeChanges,
    glassLabel: glassLabel, glassShort: glassShort, glassOf: glassOf, amountOf: amountOf, amountsFor: amountsFor, glassFooter: glassFooter,
    chipsModel: chipsModel, chipsSave: chipsSave, chipsAddOwn: chipsAddOwn, chipsRemoveOwn: chipsRemoveOwn,
    chipQuiet: chipQuiet,
    scenesModel: scenesModel, scenesSave: scenesSave, scenesPagePill: scenesPagePill,
    PAGES_SCREEN_DEFAULTS: PAGES_SCREEN_DEFAULTS, PAGES_SCREEN_SHOW: PAGES_SCREEN_SHOW, PAGES_SCREEN_ROOMS: PAGES_SCREEN_ROOMS,
    PAGES_SCREEN_PILL: PAGES_SCREEN_PILL, PAGES_SCREEN_CLOCK: PAGES_SCREEN_CLOCK, PAGES_SCREEN_WIDGETS: PAGES_SCREEN_WIDGETS, PAGES_SCREEN_SPOTS: PAGES_SCREEN_SPOTS,
    PAGES_SCREEN_WIDGETS_MAX: PAGES_SCREEN_WIDGETS_MAX, pagesScreenOf: pagesScreenOf, pagesScreenSet: pagesScreenSet,
    pagesScreenSummary: pagesScreenSummary, pagesWidgetSet: pagesWidgetSet,
    pagesModel: pagesModel, pagesSave: pagesSave, pagesCustom: pagesCustom, onlyModel: onlyModel, onlySummary: onlySummary,
    skyPageRows: skyPageRows, skyAutoLabel: skyAutoLabel, skyModeLabel: skyModeLabel, skyModeOptions: skyModeOptions,
    roomsModel: roomsModel, roomsSave: roomsSave, roomsAuto: roomsAuto, houseRoomsAsBoard: houseRoomsAsBoard,
    houseRoomsSave: houseRoomsSave, roomOnHome: roomOnHome, roomsSummary: roomsSummary,
    MENU_FIXED: MENU_FIXED, MENU_PLACES: MENU_PLACES, menuPathOf: menuPathOf, menuItems: menuItems,
    topsOf: topsOf, placeOf: placeOf, placeSet: placeSet,
    camerasModel: camerasModel, autoCameras: autoCameras, livePlan: livePlan, liveYaml: liveYaml, liveNames: liveNames,
    move: move,
    LOOKS: LOOKS, LOOK_KEYS: LOOK_KEYS, LOOK_UNDO_KEYS: LOOK_UNDO_KEYS, LOOK_LABELS: LOOK_LABELS, lookOf: lookOf, lookSays: lookSays, lookChanges: lookChanges, lookUndo: lookUndo,
    mmdd: mmdd, dateLabel: dateLabel, skyDate: skyDate, search: search
  };
})();
