// Home Grid's desktop editor (docs/phase11/HOME-GRID.md, G5; rebuilt 2026-10-23
// around a palette): the cards on the left -- drag one onto the grid, or
// click it for its live preview and Add --, the screen in the middle, and on
// the right the selected block's settings (nothing selected: the screen's).
// The draft belongs to this element; only Save writes.
// Placement functions are pure so mouse, keyboard and the palette share refusals.
(function () {
  'use strict';
  if (window.hkGridEditor) return;
  var G = window.hkGridCatalog, SIZES = G.SIZES;
  var NAMES = { accessory: 'Accessory', accessories: 'Accessory Group', scene: 'Scene', scenes: 'Scenes', now_playing: 'Now Playing',
    thermostat: 'Thermostat', camera: 'Camera', security: 'Security', timers: 'Timers', weather: 'Weather',
    calendar: 'Calendar', battery: 'House Battery', people: 'People', vacuum: 'Vacuum', clock: 'Clock',
    room: 'Room', scene_suggested: 'Suggested Scene', action: 'Action', everything: 'Everything',
    power: 'Power', music: 'Music', doors: 'Doors & Locks', live_tv: 'Live TV', water: 'Water' };
  var SIZE_NAMES = { S: 'Small', W: 'Wide', T: 'Tall', L: 'Large', XL: 'Extra Large', XXL: 'Full Width' };
  // a size on a chip or a segment, short enough for four in a row
  var SIZE_SHORT = { S: 'Small', W: 'Wide', T: 'Tall', L: 'Large', XL: 'X-Large', XXL: 'Full' };
  var GROUPS = [
    ['Rooms & Lights', ['room', 'accessory', 'accessories', 'action']], ['Scenes', ['scene', 'scenes', 'scene_suggested']],
    ['Climate', ['thermostat', 'weather']], ['Music', ['now_playing', 'music', 'live_tv']],
    ['Security & Cameras', ['security', 'doors', 'camera']], ['Info', ['clock', 'timers', 'calendar', 'battery', 'power', 'water', 'people', 'vacuum', 'everything']]
  ];
  var DESCRIPTIONS = { room: 'Your room’s lights, fans and speaker', accessory: 'One light, switch or other accessory', accessories: 'Accessories you choose, in swipe pages',
    action: 'One tap for a household job', scene: 'Set a favourite scene', scenes: 'Your scenes together',
    scene_suggested: 'The right scene for the time of day', thermostat: 'Temperature and climate; Extra Large has every control',
    weather: 'Current conditions and the forecast', now_playing: 'Music and playback controls', security: 'The alarm, locks and doors; Large is the keypad',
    camera: 'One camera, or swipe between cameras', clock: 'Digital or analog, with or without its box', timers: 'Timers and quick starts',
    calendar: 'Your upcoming events', battery: 'Your home’s stored energy', people: 'Who is home', vacuum: 'Cleaning status; Large adds controls and Clean Areas',
    everything: 'Open the screen’s full menu', power: 'Solar, the house, the battery and the grid right now',
    music: 'Choose speakers, then a playlist', doors: 'Locks, doors, windows and the garage', live_tv: 'Your channels; tap one to watch',
    water: 'Today’s water; Extra Large adds the main supply' };
  var GLYPHS = { room: 'mdi:sofa', accessory: 'mdi:lightbulb', accessories: 'mdi:view-grid', action: 'mdi:gesture-tap', scene: 'mdi:palette',
    scenes: 'mdi:palette', scene_suggested: 'mdi:weather-sunset', thermostat: 'mdi:thermostat', weather: 'mdi:weather-partly-cloudy',
    now_playing: 'mdi:music', security: 'mdi:shield-home', camera: 'mdi:camera', clock: 'mdi:clock', timers: 'mdi:timer-outline',
    calendar: 'mdi:calendar', battery: 'mdi:home-battery', people: 'mdi:account', vacuum: 'mdi:robot-vacuum', everything: 'mdi:dots-horizontal',
    power: 'mdi:lightning-bolt', music: 'mdi:speaker-multiple', doors: 'mdi:door-closed-lock', live_tv: 'mdi:television-classic', water: 'mdi:water' };
  // AN OPTION'S NAME in the panel: by its kind (hk-grid-catalog.js opts), else by its own name
  var KIND_LABELS = { entity: 'Accessory', climate: 'Thermostat', camera: 'Camera', weather: 'Weather', vacuum: 'Vacuum',
    speaker: 'Speaker', scene: 'Scene', scenes: 'Scenes', calendars: 'Calendars', area: 'Room', action: 'Does', windows: 'Time Windows', alarm: 'Alarm' };
  var NAME_LABELS = { sky: 'Sky Background', title: 'Group Name', clock_style: 'Style', bare: 'Hide Box', big: 'Big Temperature', month: 'Month View' };
  // ONE THING OR PAGES THAT SWIPE, in each card's words: [one, its automatic source]
  var SHOW = { room: ['One Room', 'Swipe Between Rooms'], camera: ['One Camera', 'Swipe All Cameras'],
    thermostat: ['One Thermostat', 'Swipe All Thermostats'], now_playing: ['One Speaker', 'Swipe All Speakers'],
    scenes: ['Chosen Scenes', 'Swipe All Scenes'], accessories: [null, 'Automatic Pages'] };
  // what an automatic source shows in place of the block's own choice of one
  var SOURCE_HIDES = { rooms: 'area', cameras: 'entity', thermostats: 'entity', speakers: 'speaker', scenes: 'scenes' };
  var EMPTY = { v: 1, cols: 6, rows: 4, frame: [1280, 800], band: true, items: [] };
  // a rule's conditions in words (hk-grid-catalog.js CONDITIONS)
  var CONDITION_NAMES = { music_playing: 'Music Is Playing', timer_running: 'A Timer Is Running', alarm_armed: 'The Alarm Is Armed',
    alarm_disarmed: 'The Alarm Is Disarmed', doorbell: 'Someone Is at the Door', after_sunset: 'After Sunset',
    entity_state: 'An Accessory’s State', time: 'A Time of Day' };
  // THE STARTER LAYOUTS (hk_core home_grid.STARTERS: the same keys), each
  // shown as a small map of the blocks it would put on this screen
  var STARTERS = [['A', 'Tap Weight', 'What you touch most is biggest'], ['C', 'Glance Up, Touch Down', 'Readings above, controls below'],
    ['R', 'Room Focus', 'This room up front, with its climate and music'], ['M', 'Music & Scenes', 'Music, scenes and the scene for now'],
    ['S', 'Security & Cameras', 'Cameras large, with locks and the alarm'], ['F', 'Family Hub', 'The calendar, who’s home and timers'],
    ['Q', 'Essentials', 'A calm few: the room, scenes and weather'], ['empty', 'Start Empty', 'A blank grid to fill yourself']];
  // a block's color on the map: its palette group's
  var GROUP_TINT = { 'Rooms & Lights': 'var(--hk-orange)', Scenes: 'var(--hk-tint)', Climate: 'var(--hk-green)', Music: 'var(--hk-red)',
    'Security & Cameras': 'var(--hk-gray)', Info: 'var(--hk-label3)' };
  function groupOf(card) { var g = GROUPS.find(function (x) { return x[1].indexOf(card) >= 0; }); return g ? g[0] : 'Info'; }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  // a screen's version as the page last read it (panel/get's versions["board/<path>"]); undefined from a host
  // that sends none, and then saves go without one, as before
  function versionOf(panel, path) { var v = panel.data && panel.data.versions; return v ? v['board/' + path] : undefined; }
  function keepVersion(panel, path, result) {
    if (result && result.version != null && panel.data) (panel.data.versions = panel.data.versions || {})['board/' + path] = result.version;
  }
  // THE VIEW BEING EDITED (VIEWS, 2026-10-24): what is added, placed and
  // drawn is in it; blocks in different views never overlap
  var VIEW = 0;
  function overlap(a, b) {
    if ((a.view || 0) !== (b.view || 0)) return false;
    var x = SIZES[a.size], y = SIZES[b.size];
    return a.at[0] < b.at[0] + y[0] && b.at[0] < a.at[0] + x[0] &&
      a.at[1] < b.at[1] + y[1] && b.at[1] < a.at[1] + x[1];
  }
  function fits(grid, item) {
    var z = SIZES[item.size];
    return !!z && item.at.every(Number.isInteger) && item.at[0] >= 0 && item.at[1] >= 0 &&
      item.at[0] + z[0] <= grid.cols && item.at[1] + z[1] <= grid.rows;
  }
  function valid(grid) {
    return [6, 3, 2].indexOf(grid.cols) >= 0 && Number.isInteger(grid.rows) && grid.rows >= 2 && grid.rows <= 6 &&
      grid.frame.length === 2 && Number.isInteger(grid.frame[0]) && Number.isInteger(grid.frame[1]) &&
      grid.frame[0] >= 320 && grid.frame[0] <= 3840 && grid.frame[1] >= 320 && grid.frame[1] <= 2160 &&
      grid.items.length <= 24 && grid.items.every(function (it, i) {
        var cat = G.table()[it.card];
        if ((it.view || 0) >= (grid.views || 1)) return false;
        return cat && cat.sizes.indexOf(it.size) >= 0 && (!it.when || it.fallback && G.table()[it.fallback.card] && G.table()[it.fallback.card].sizes.includes(it.size)) &&
          (it.rules || []).every(function (r) { return G.table()[r.card] && G.table()[r.card].sizes.includes(it.size); }) && fits(grid, it) &&
          !grid.items.slice(i + 1).some(function (other) { return it.id === other.id || overlap(it, other); });
      });
  }
  // A move may swap exactly one block of the same class. A resize never swaps.
  function place(grid, id, at, size) {
    var out = copy(grid), item = out.items.find(function (it) { return it.id === id; });
    if (!item || !SIZES[size || item.size]) return null;
    var old = copy(item), resizing = size && size !== item.size;
    item.at = at.slice(); item.size = size || item.size;
    if (!fits(out, item)) return null;
    var hit = out.items.filter(function (it) { return it.id !== id && overlap(item, it); });
    if (hit.length) {
      if (resizing || hit.length !== 1 || hit[0].size !== item.size) return null;
      hit[0].at = old.at;
    }
    return valid(out) ? out : null;
  }
  function firstSpace(grid, size, view) {
    for (var row = 0; row < grid.rows; row++) for (var col = 0; col < grid.cols; col++) {
      var it = { size: size, at: [col, row], view: view === undefined ? VIEW : view };
      if (fits(grid, it) && !grid.items.some(function (x) { return overlap(it, x); })) return it.at;
    }
    return null;
  }
  // SCREEN TYPES (2026-10-24, the owner): the grid that suits a kind of
  // screen, from the grid's own fit (196 x 150 px tiles, the whole grid
  // scaled to the screen, never enlarged; docs/phase11/HOME-GRID.md, "Screen
  // types"). [key, name, columns, rows, top band, preview size]
  var SCREEN_TYPES = [
    ['phone_portrait', 'Phone, Portrait', 2, 5, false, [390, 844]],
    ['phone_landscape', 'Phone, Landscape', 3, 2, false, [844, 390]],
    ['tablet_portrait', 'Tablet, Portrait', 3, 6, true, [820, 1180]],
    ['tablet_landscape', 'Tablet, Landscape', 6, 4, true, [1180, 820]],
    ['large_tablet', 'Large Tablet', 6, 5, true, [1376, 1032]],
    ['car', 'Car', 6, 3, true, [1280, 720]]
  ];
  // A NIGHTSTAND (Phone, Landscape: a phone on its side by the bed, as
  // StandBy has it): starters of its own, a big clock on the wallpaper first
  var NIGHTSTAND = [
    ['n_clock', 'Big Clock', 'The time, large, with nothing round it',
      [{ id: 'n1', card: 'clock', size: 'XL', at: [0, 0], opts: { clock_style: 'classic' }, bare: true }]],
    ['n_calendar', 'Clock and Calendar', 'The time beside what’s next',
      [{ id: 'n1', card: 'clock', size: 'L', at: [0, 0], opts: { clock_style: 'classic' }, bare: true }, { id: 'n2', card: 'calendar', size: 'T', at: [2, 0], opts: { month: true }, bare: true }]],
    ['n_standby', 'StandBy', 'The time, then a swipe to the weather and the month',
      [{ id: 'n1', card: 'clock', size: 'XL', at: [0, 0], opts: { clock_style: 'classic' }, bare: true },
       { id: 'n2', card: 'weather', size: 'T', at: [0, 0], opts: { big: true }, bare: true, view: 1 },
       { id: 'n3', card: 'calendar', size: 'L', at: [1, 0], opts: { month: true }, bare: true, view: 1 }], 2],
    ['n_analog', 'Analog and Weather', 'A watch face beside the forecast',
      [{ id: 'n1', card: 'clock', size: 'T', at: [0, 0], opts: { clock_style: 'analog' }, bare: true }, { id: 'n2', card: 'weather', size: 'L', at: [1, 0], opts: { big: true }, bare: true }]]
  ];
  function screenTypeOf(grid) {
    var t = grid && SCREEN_TYPES.find(function (x) { return x[2] === grid.cols && x[3] === grid.rows && x[4] === !!grid.band; });
    return t ? t[0] : 'custom';
  }
  // A LAYOUT ON ANOTHER GRID: its blocks in reading order, each at the first
  // place it fits, so they keep their order; a block wider than the grid, or
  // with no room left, is left out. -> { grid, left: [items] }
  function reflow(grid, cols, rows) {
    var out = copy(grid), left = [];
    out.cols = cols; out.rows = rows; out.items = [];
    copy(grid.items).sort(function (a, b) { return (a.at[1] - b.at[1]) || (a.at[0] - b.at[0]); }).forEach(function (it) {
      var at = SIZES[it.size] && SIZES[it.size][0] <= cols ? firstSpace(out, it.size, it.view || 0) : null;
      if (!at) { left.push(it); return; }
      it.at = at; out.items.push(it);
    });
    return { grid: out, left: left };
  }
  // how large a block shows on a screen of `frame` (its share of full size)
  function scaleAt(grid, frame) {
    var pad = 1280 * 0.015 + 8, w = grid.cols * 196 + (grid.cols - 1) * 10 + 2 * pad;
    var h = grid.rows * 150 + (grid.rows - 1) * 10 + 2 * pad + (grid.band ? 70 : 0);
    return Math.min(1, frame[0] / w, frame[1] / h);
  }
  function snap(x, y, rect, cols, rows) {
    return [Math.floor((x - rect.left) / (rect.width / cols)), Math.floor((y - rect.top) / (rect.height / rows))];
  }
  // where a block of `size` dragged by its middle lands: the pointer in its
  // centre cell, kept inside the grid
  function landing(x, y, rect, cols, rows, gap, size) {
    var z = SIZES[size], cw = (rect.width - (cols - 1) * gap) / cols, ch = (rect.height - (rows - 1) * gap) / rows;
    var c = Math.round((x - rect.left) / (cw + gap) - z[0] / 2), r = Math.round((y - rect.top) / (ch + gap) - z[1] / 2);
    return [Math.max(0, Math.min(cols - z[0], c)), Math.max(0, Math.min(rows - z[1], r))];
  }
  function add(grid, card, size, at) {
    if (grid.items.length >= 24) return null;
    var out = copy(grid), n = 1;
    while (out.items.some(function (it) { return it.id === 'b' + n; })) n++;
    var item = { id: 'b' + n, card: card, size: size, at: at || firstSpace(grid, size) };
    if (VIEW) item.view = VIEW;
    if (!item.at) return null;
    out.items.push(item);
    return valid(out) ? out : null;
  }
  var CSS = [
    ':host{position:fixed;inset:0;z-index:1000;overflow:hidden}',
    '.editor{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--hk-bg)}',
    '.tools{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--hk-sep);background:var(--hk-cell);flex:none;z-index:4}',
    '.tools h1{font-size:20px;margin:0;flex:1}.tools button{border:0;border-radius:8px;min-height:44px;padding:0 16px;background:var(--hk-fill);color:var(--hk-label);font:inherit;cursor:pointer}',
    '.tools .save{background:var(--hk-tint);color:white}.tools button:disabled{opacity:.4;cursor:default}',
    '.work{flex:1;min-height:0;overflow:hidden;box-sizing:border-box;display:grid;grid-template-columns:280px minmax(0,1fr) 340px;gap:16px;padding:16px 16px 0}',
    '@media(max-width:1380px){.work{grid-template-columns:240px minmax(0,1fr) 300px}}',
    '.stage{min-width:0;min-height:0;overflow:hidden}',
    '.palette,aside.sidebar{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-bottom:24px}',
    '.framebox{position:relative;overflow:hidden;margin:auto;border-radius:10px;background:var(--hk-cell);outline:1px solid var(--hk-sep)}',
    '.frame{position:absolute;left:0;top:0;transform-origin:top left;background:var(--hk-cell);overflow:hidden}',
    // while the screen loads in its frame (a slow connection: a minute or more)
    '.framebox[data-loading]::after{content:"Loading the preview…";position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--hk-label2);background:var(--hk-cell)}',
    '.framebox[data-loading=slow]::after{content:"The live preview isn’t ready. " attr(data-why) ". You can still arrange blocks.";inset:auto 0 0 0;padding:10px 14px;font-size:13px;justify-content:flex-start;background:color-mix(in srgb,var(--hk-cell) 92%,transparent)}',
    '.catalog-preview:empty::before,.catalog-preview[data-loading]::before{content:"Loading preview…";position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--hk-label2);background:var(--hk-fill)}',
    'iframe{position:absolute;inset:0;border:0;width:100%;height:100%;pointer-events:none}',
    '.grid{position:absolute;display:grid;gap:10px;z-index:2}',
    '.slot{border:1px dashed var(--hk-label3);border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));pointer-events:none}',
    '.block{position:absolute;z-index:3;cursor:grab;border:2px solid transparent;background:transparent;border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));color:var(--hk-label);touch-action:none}',
    '.block:hover{border-color:color-mix(in srgb,var(--hk-tint) 45%,transparent)}',
    '.block[aria-pressed=true]{border-color:var(--hk-tint)}.block:focus-visible{outline:3px solid var(--hk-tint)}',
    // the block's name: just above the one pointed at or chosen, never over a card's own title
    '.block .tag{position:absolute;bottom:calc(100% + 4px);left:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border-radius:7px;background:var(--hk-cell);font-size:13px;opacity:0;transition:opacity .12s}',
    '.block:hover .tag,.block[aria-pressed=true] .tag,.block:focus-visible .tag{opacity:1}',
    '.ghost{position:absolute;pointer-events:none;border:3px solid var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 18%,transparent);border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));z-index:4}.ghost.bad{border-color:var(--hk-red);background:color-mix(in srgb,var(--hk-red) 14%,transparent)}',
    '.float{position:fixed;left:0;top:0;z-index:20;pointer-events:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--hk-cell);color:var(--hk-label);box-shadow:var(--hk-shadow);font-size:13px;font-weight:600;white-space:nowrap}',
    '.float hk-icon{width:20px;height:20px;color:var(--hk-tint)}',
    '.note{font-size:13px;color:var(--hk-label2);line-height:1.5;margin:0 0 10px}.message{flex:none;color:var(--hk-red);min-height:24px;padding:6px 20px 0}',
    // THE PALETTE
    '.pal-head{position:sticky;top:0;z-index:2;background:var(--hk-bg);padding:0 0 12px}',
    '.pal-head p{font-size:13px;color:var(--hk-label2);margin:8px 4px 0;line-height:1.4}',
    '.catalog-search{box-sizing:border-box;width:100%;min-height:40px;border:1px solid var(--hk-sep);border-radius:10px;padding:8px 12px;background:var(--hk-cell);color:var(--hk-label);font:inherit;font-size:15px}',
    '.pick-banner{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--hk-tint) 16%,var(--hk-cell));font-size:14px}',
    '.pick-banner span{flex:1}.pick-banner button{border:0;background:none;color:var(--hk-tint);font:inherit;cursor:pointer;min-height:32px}',
    // (pan-y: a finger moving up or down scrolls the list; paletteRow picks a card up on a sideways drag or a hold)
    '.pal-row{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y;transition:transform .15s ease,box-shadow .15s ease}',
    '.pal-row.lifted{transform:scale(1.02);box-shadow:0 8px 24px rgba(0,0,0,.28);position:relative;z-index:2}',
    '.pal-row:active{cursor:grabbing}.pal-row[aria-expanded=true]{background:var(--hk-hover)}',
    '.pal-row > hk-icon{width:24px;height:24px;flex:none;color:var(--hk-tint)}',
    '.pal-row .pt{display:grid;gap:2px;flex:1;min-width:0}.pal-row .pt b{font-weight:600;font-size:15px}',
    '.pal-row .pt small{font-size:12px;color:var(--hk-label2);line-height:1.3}',
    '.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}',
    '.chip{min-width:0;height:24px;padding:0 7px;border-radius:6px;border:0;background:var(--hk-fill);color:var(--hk-label2);font:inherit;font-size:11px;font-weight:600;cursor:pointer}',
    '.chip[aria-pressed=true]{background:var(--hk-tint);color:#fff}.chip[data-full=true]{opacity:.45}',
    '.pal-detail{display:block;padding:4px 12px 12px}',
    '.catalog-preview{position:relative;width:100%;overflow:hidden;border-radius:10px;background:var(--hk-fill);margin:4px 0 8px;cursor:grab}.catalog-preview > *{pointer-events:none}',
    '.catalog-add{width:100%;min-height:40px;border:0;border-radius:10px;background:var(--hk-tint);color:white;font:inherit;cursor:pointer}.catalog-add:disabled{opacity:.4;cursor:default}',
    // THE INSPECTOR
    '.insp-head{display:flex;align-items:center;gap:12px;padding:4px 4px 16px}',
    '.insp-head hk-icon{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:48px;height:48px;flex:none;border-radius:12px;background:var(--hk-cell);color:var(--hk-tint);--mdc-icon-size:26px}',
    '.insp-head h2{margin:0;font-size:20px;font-weight:700}.insp-head p{margin:2px 0 0;font-size:13px;color:var(--hk-label2)}',
    '.insp-head .done{margin-left:auto;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;cursor:pointer;min-height:44px}',
    '.screen-settings{margin:4px 0 16px}.screen-settings summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;font-weight:600;padding:0 4px}.screen-settings summary::before{content:"›";display:inline-block;transition:transform .15s}.screen-settings[open] summary::before{transform:rotate(90deg)}',
    // THE STARTERS: a map of each layout's blocks beside its name
    '.starter{display:flex;align-items:center;gap:12px;padding:10px 12px;text-align:left;cursor:pointer}',
    '.starter .st{display:grid;gap:2px;min-width:0}.starter .st b{font-weight:600;font-size:15px}.starter .st small{font-size:12px;color:var(--hk-label2);line-height:1.3}',
    '.mini{flex:none;width:136px;aspect-ratio:16/10;box-sizing:border-box;padding:5px;border-radius:8px;background:var(--hk-fill);display:grid;gap:3px}',
    '.mini i{border-radius:4px;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;overflow:hidden}',
    '.mini i hk-icon{width:12px;height:12px;--mdc-icon-size:12px;color:var(--hk-label)}',
    '.mini .band{grid-column:1/-1;border-radius:3px;background:var(--hk-label3);opacity:.5}',
    '.mini .wait{background:var(--hk-label3);opacity:.25}',
    // A WINDOW TOO NARROW for the three panes (a phone; an iPad's narrow
    // split) says so, with Open Anyway. Touch is welcome: the drags are
    // pointer events (2026-10-24, the owner arranging from an iPad, which
    // the old touch rule hid the editor from without a word of why).
    '.desktop-note{display:none;padding:32px;max-width:520px}.desktop-note p{margin:0 0 16px;line-height:1.5}',
    '.desktop-note button{border:0;border-radius:10px;min-height:44px;padding:0 18px;background:var(--hk-tint);color:white;font:inherit;cursor:pointer}',
    '@media(max-width:899px){:host(:not([wide-anyway])) .work,:host(:not([wide-anyway])) .tools .save,:host(:not([wide-anyway])) .tools .undo{display:none}:host(:not([wide-anyway])) .desktop-note{display:block}}',
    ':host([wide-anyway]) .work{overflow-x:auto;grid-template-columns:240px minmax(560px,1fr) 300px}'
  ].join('\n');

  class GridEditor extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.selected = null; this.busy = false; this.undoStack = []; this.paletteSizes = {}; }
    configure(options) {
      this.o = options; this.panel = options.panel; this.K = window.hkSettingsKit; this.h = this.K.h;
      this.load(options.board);
    }
    // THE SCREEN AS IT IS: its layout the draft, and the version it was read
    // at (panel/get's versions; a number or a digest, whichever the host
    // sends, kept as it came), which Save sends so a save made meanwhile elsewhere isn't
    // silently replaced (SET-7)
    load(board) {
      this.o.board = board;
      this.version = versionOf(this.panel, this.o.path);
      this.grid = board.home_grid ? copy(board.home_grid) : null;
      // a block saved with the older Show When (when + fallback) opens as rules: the fallback its
      // default, its own card its one rule (hk-grid-catalog.js rulesOf); Save writes it that way
      if (this.grid) this.grid.items = this.grid.items.map(function (it) {
        if (!(it.when && it.fallback)) return it;
        var r = G.rulesOf(it), out = Object.assign({}, r.base, { rules: r.rules.map(function (x) { return Object.assign({}, x, { when: { all: [x.when] } }); }) });
        Object.keys(out).forEach(function (k) { if (out[k] == null) delete out[k]; });
        out.rules.forEach(function (x) { Object.keys(x).forEach(function (k) { if (x[k] == null) delete x[k]; }); });
        return out;
      });
      this.initial = JSON.stringify(this.grid);
    }
    connectedCallback() {
      this.toggleAttribute('dark', this.panel.hasAttribute('dark'));
      if (this.ui) { this.fit(); return; }
      this.draw();
      this.ro = new ResizeObserver(this.fit.bind(this)); this.ro.observe(this.stage); this.ro.observe(this.stage.querySelector('.note'));
      this.unload = (e) => { if (this.dirty()) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', this.unload);
    }
    disconnectedCallback() {
      if (this.ro) this.ro.disconnect();
      if (this.previewRO) this.previewRO.disconnect();
      if (this.previewOff) this.previewOff();
      this.previewView = null;
      if (this.catalogOff) this.catalogOff();
      clearTimeout(this.previewTimer);
      window.removeEventListener('beforeunload', this.unload);
      this.ui = null;
    }
    dirty() { return JSON.stringify(this.grid) !== this.initial; }
    say(message) { this.message.textContent = message || ''; }
    async cancel() {
      if (this.busy) return;
      if (this.dirty() && !await this.K.confirm(this.shadowRoot, { title: 'Discard Changes?', message: 'Your saved layout stays as it was.', ok: 'Discard', destructive: true })) return;
      this.o.onCancel();
    }
    draw() {
      var h = this.h, K = this.K;
      this.shadowRoot.replaceChildren(h('style', { text: K.CSS + '\n' + CSS }));
      this.ui = h('div', { class: 'editor' }); this.shadowRoot.appendChild(this.ui);
      this.saveButton = h('button', { class: 'save', text: 'Save', onclick: () => this.save(), disabled: !this.grid });
      this.undoButton = h('button', { class: 'undo', text: 'Undo', title: 'Undo (⌘Z)', onclick: () => this.undo(), disabled: true });
      this.ui.appendChild(h('header', { class: 'tools' }, [h('button', { text: 'Cancel', onclick: () => this.cancel() }),
        h('h1', { text: this.o.title + ' · Home Grid' }), this.undoButton, this.saveButton]));
      this.message = h('div', { class: 'message', role: 'status', 'aria-live': 'polite' }); this.ui.appendChild(this.message);
      this.ui.appendChild(h('div', { class: 'desktop-note' }, [
        h('p', { text: 'This window is narrow for the editor: it shows the cards, the screen and the settings side by side. Turn the device sideways or widen the window, or open it anyway and scroll sideways.' }),
        h('button', { type: 'button', text: 'Open Anyway', onclick: () => { this.setAttribute('wide-anyway', ''); this.fit(); } })]));
      this.palette = h('aside', { class: 'palette', 'aria-label': 'Cards' });
      this.stage = h('section', { class: 'stage', 'aria-label': 'Screen layout' });
      this.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Block and screen settings', tabindex: '0' });
      this.ui.appendChild(h('div', { class: 'work' }, [this.palette, this.stage, this.sidebar]));
      this.stage.appendChild(h('p', { class: 'note', text: 'Drag a card from the left onto the grid. Drag blocks to move them; equal sizes swap. Cards are a preview: their controls don’t act on the house.' }));
      this.box = h('div', { class: 'framebox', 'data-loading': this.grid ? 'yes' : null }); this.stage.appendChild(this.box);
      this.frame = h('div', { class: 'frame' }); this.box.appendChild(this.frame);
      this.iframe = h('iframe', { title: 'Home Grid preview', tabindex: '-1', 'aria-hidden': 'true' });
      this.iframe.inert = true;
      this.iframe.src = this.panel.hostScreenBase() + '/' + this.o.path + '/home?hk_kiosk=on&kiosk&wp_enabled=false';
      this.iframe.addEventListener('load', () => this.preview());
      this.frame.appendChild(this.iframe);
      this.overlay = h('div', { class: 'grid', 'aria-label': 'Grid blocks' }); this.frame.appendChild(this.overlay);
      // a click on the grid's empty space lets the block go: the screen's settings again
      this.stage.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.block')) { if (this.selected) this.select(null); } });
      this.shadowRoot.addEventListener('keydown', (e) => this.keys(e));
      this.blocks(); this.side(); this.fit();
    }
    // ⌘Z / Ctrl+Z undoes; Escape lets a block (or a card choice) go; Delete removes the chosen block
    keys(e) {
      var path = e.composedPath ? e.composedPath() : [e.target], field = path.find((el) => el.matches && el.matches('input,select,textarea'));
      if (field) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (e.key === 'Escape' && (this.pickerTarget || this.selected)) { e.preventDefault(); if (this.pickerTarget) this.pickFor(null); else this.select(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && path.some((el) => el.classList && el.classList.contains('block'))) {
        e.preventDefault(); this.remove(this.selected);
      }
    }
    change(grid, fromUndo) {
      if (!fromUndo && this.grid && JSON.stringify(grid) !== JSON.stringify(this.grid)) {
        this.undoStack.push({ grid: copy(this.grid), selected: this.selected });
        if (this.undoStack.length > 50) this.undoStack.shift();
      }
      this.grid = grid; this.saveButton.disabled = false; this.undoButton.disabled = !this.undoStack.length;
      if (this.selected && !grid.items.some((it) => it.id === this.selected)) this.selected = null;
      this.say(''); this.blocks(); this.side(); this.fit(); this.preview();
    }
    undo() {
      var last = this.undoStack.pop();
      if (!last || this.busy) return;
      this.selected = last.selected; this.change(last.grid, true);
      this.say('Undone.');
    }
    remove(id) {
      var next = copy(this.grid), it = next.items.find((x) => x.id === id);
      next.items = next.items.filter((x) => x.id !== id); this.selected = null; this.change(next);
      if (it) this.say(NAMES[it.card] + ' removed. Undo (⌘Z) puts it back.');
    }
    blocks() {
      this.overlay.replaceChildren();
      if (!this.grid) return;
      var h = this.h, self = this;
      if (VIEW >= (this.grid.views || 1)) VIEW = 0;               // (an undo can take the view away)
      this.overlay.style.gridTemplateColumns = 'repeat(' + this.grid.cols + ',1fr)';
      this.overlay.style.gridTemplateRows = 'repeat(' + this.grid.rows + ',1fr)';
      for (var i = 0; i < this.grid.cols * this.grid.rows; i++) this.overlay.appendChild(h('div', { class: 'slot' }));
      this.grid.items.forEach(function (it) {
        if ((it.view || 0) !== VIEW) return;                // another view's
        var b = h('button', { class: 'block', type: 'button', 'data-id': it.id, 'aria-label': NAMES[it.card] + ', ' + SIZE_NAMES[it.size] + ', column ' + (it.at[0] + 1) + ', row ' + (it.at[1] + 1),
          'aria-pressed': self.selected === it.id ? 'true' : 'false' }, h('span', { class: 'tag', text: NAMES[it.card] + ' · ' + SIZE_NAMES[it.size] }));
        self.position(b, it);
        b.addEventListener('click', () => { self.select(it.id); });
        b.addEventListener('pointerdown', (e) => self.drag(e, it, b));
        b.addEventListener('keydown', function (e) {
          var delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (!delta) return;
          e.preventDefault(); self.selected = it.id;
          var next = place(self.grid, it.id, [it.at[0] + delta[0], it.at[1] + delta[1]]);
          if (next) { self.change(next); self.overlay.querySelector('[data-id="' + it.id + '"]').focus(); }
          else self.say('That move does not fit.');
        });
        self.overlay.appendChild(b);
      });
    }
    select(id) {
      this.selected = id; this.conditionPreview = null; this.pickerTarget = null;
      this.overlay.querySelectorAll('.block').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'));
      this.side();
      if (id === null) this.preview();
    }
    position(el, it) {
      var gap = this.cellGap || 10, z = SIZES[it.size], w = (this.overlay.clientWidth - (this.grid.cols - 1) * gap) / this.grid.cols;
      var h = (this.overlay.clientHeight - (this.grid.rows - 1) * gap) / this.grid.rows;
      Object.assign(el.style, { left: it.at[0] * (w + gap) + 'px', top: it.at[1] * (h + gap) + 'px', width: (w + gap) * z[0] - gap + 'px', height: (h + gap) * z[1] - gap + 'px' });
    }
    drag(e, it, button) {
      if (e.button !== 0 || this.busy) return;
      this.select(it.id);
      var start = [e.clientX, e.clientY], at = it.at.slice(), moved = false, self = this;
      var ghost = this.h('div', { class: 'ghost' }); this.position(ghost, it);
      var origin = snap(e.clientX, e.clientY, this.overlay.getBoundingClientRect(), this.grid.cols, this.grid.rows);
      button.setPointerCapture(e.pointerId);
      var move = function (ev) {
        if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 4 && !moved) return;
        moved = true; if (!ghost.parentNode) self.overlay.appendChild(ghost);
        var pos = snap(ev.clientX, ev.clientY, self.overlay.getBoundingClientRect(), self.grid.cols, self.grid.rows);
        at = [it.at[0] + pos[0] - origin[0], it.at[1] + pos[1] - origin[1]];
        self.position(ghost, Object.assign({}, it, { at: at }));
        ghost.classList.toggle('bad', !place(self.grid, it.id, at));
      };
      var finish = function (ev) {
        button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', finish); button.removeEventListener('pointercancel', finish);
        ghost.remove();
        if (moved && ev.type !== 'pointercancel') {
          var next = place(self.grid, it.id, at);
          if (next) self.change(next); else self.say('That move does not fit. The block stays where it was.');
        }
      };
      button.addEventListener('pointermove', move); button.addEventListener('pointerup', finish); button.addEventListener('pointercancel', finish);
    }
    // A CARD DRAGGED OUT OF THE PALETTE: a label follows the pointer, and over
    // the grid the block's real footprint shows where it lands (red: no room)
    paletteDrag(e, card, row) {
      if (!this.grid || this.busy || this.pickerTarget) return false;
      var self = this, size = this.sizeFor(card), ghost = this.h('div', { class: 'ghost' }), at = null;
      var label = window.hkDrag.ghost(this.shadowRoot, this.h('div', { class: 'float' },
        [this.h('hk-icon', { icon: GLYPHS[card] }), this.h('span', { text: NAMES[card] + ' · ' + SIZE_NAMES[size] })]));
      var over = function (ev) {
        var r = self.overlay.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom ? r : null;
      };
      var move = function (ev) {
        label.move(ev);
        var r = over(ev);
        if (!r) { at = null; ghost.remove(); return; }
        at = landing(ev.clientX, ev.clientY, r, self.grid.cols, self.grid.rows, self.cellGap || 10, size);
        if (!ghost.parentNode) self.overlay.appendChild(ghost);
        self.position(ghost, { size: size, at: at });
        ghost.classList.toggle('bad', !add(self.grid, card, size, at));
      };
      var finish = function (ev) {
        row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', finish); row.removeEventListener('pointercancel', finish);
        ghost.remove(); label.remove();
        if (ev.type === 'pointercancel' || !at) return;
        if (add(self.grid, card, size, at)) self.addCard(card, size, at);
        else self.say('No room there for a ' + SIZE_NAMES[size] + ' ' + NAMES[card] + '. Move or remove a block, or pick a smaller size.');
      };
      move(e);
      row.addEventListener('pointermove', move); row.addEventListener('pointerup', finish); row.addEventListener('pointercancel', finish);
      return true;
    }
    fit() {
      if (!this.grid || !this.box) return;
      var note = this.stage.querySelector('.note'), noteStyle = note && getComputedStyle(note);
      var noteHeight = note ? note.getBoundingClientRect().height + (parseFloat(noteStyle.marginTop) || 0) + (parseFloat(noteStyle.marginBottom) || 0) : 0;
      var frame = this.grid.frame, availableHeight = Math.max(1, this.stage.clientHeight - noteHeight - 8);
      var scale = Math.min(1, (this.stage.clientWidth || 800) / frame[0], availableHeight / frame[1]);
      this.frame.style.width = frame[0] + 'px'; this.frame.style.height = frame[1] + 'px'; this.frame.style.transform = 'scale(' + scale + ')';
      this.box.style.width = frame[0] * scale + 'px'; this.box.style.height = frame[1] * scale + 'px';
      // Follow the real frame's layout (including top/bottom tab bar or side rail).
      var w = this.iframe.contentWindow, view;
      try { view = w && w.hkShell && w.hkShell.view(); } catch (e) { /* loading */ }
      view = this.previewView && this.previewView.isConnected ? this.previewView : view;
      if (view && view._gridScale && w.hkCards) {
        var radius = parseFloat(w.getComputedStyle(view).getPropertyValue('--hk-glass-radius')) || parseFloat(w.hkCards.T['glass-radius']);
        this.overlay.style.setProperty('--grid-radius', radius * view._gridScale + 'px');
      }
      // (the view being edited, in the preview too; its own cells place the overlay)
      if (view && view._showView && (this.grid.views || 1) > 1) view._showView(VIEW);
      var cell = view && view._config && view._config.grid && view.shadowRoot &&
        view.shadowRoot.querySelector((this.grid.views || 1) > 1 ? '.cell[data-view="' + VIEW + '"]' : '.cell');
      if (cell) {
        var r = cell.getBoundingClientRect(), it = view._config.cards.find((x) => x.hk_cell && x.hk_cell.id === cell.dataset.id).hk_cell;
        var gap = 10 * (view._gridScale || 1); this.cellGap = gap; this.overlay.style.gap = gap + 'px';
        var z = SIZES[it.size], cw = (r.width - (z[0] - 1) * gap) / z[0], ch = (r.height - (z[1] - 1) * gap) / z[1];
        Object.assign(this.overlay.style, { left: r.left - it.at[0] * (cw + gap) + 'px', top: r.top - it.at[1] * (ch + gap) + 'px',
          width: (cw + gap) * this.grid.cols - gap + 'px', height: (ch + gap) * this.grid.rows - gap + 'px' });
      } else if (view && view._root && view._gridScale) {
        var bounds = view._root.getBoundingClientRect(), factor = view._gridScale;
        var pad = parseFloat(w.getComputedStyle(view._root).paddingTop) * factor, band = this.grid.band ? 70 * factor : 0;
        this.cellGap = 10 * factor; this.overlay.style.gap = this.cellGap + 'px';
        Object.assign(this.overlay.style, { left: bounds.left + pad + 'px', top: bounds.top + pad + band + 'px',
          width: bounds.width - 2 * pad + 'px', height: bounds.height - 2 * pad - band + 'px' });
      } else {
        var pad0 = frame[0] * 0.015 + 8, top = pad0 + (this.grid.band ? 70 : 0);
        Object.assign(this.overlay.style, { left: pad0 + 'px', top: top + 'px', width: frame[0] - 2 * pad0 + 'px', height: frame[1] - top - pad0 + 'px' });
      }
      this.overlay.querySelectorAll('.block').forEach((b) => { var it = this.grid.items.find((i) => i.id === b.dataset.id); if (it) this.position(b, it); });
    }
    addCard(card, size, at) {
      if (!this.grid) { this.say('Choose a starter layout, or Start Empty, first.'); return; }
      var next = add(this.grid, card, size, at);
      if (!next) { this.say('No space for that size. Remove or move a block first.'); return; }
      var added = next.items[next.items.length - 1];
      Object.assign(added, this.variantFor(card));
      this.selected = added.id; this.pickerCard = null; this.change(next);
    }
    // A SCREEN TYPE: its columns, rows, band and preview size together, the
    // blocks re-packed in reading order; any that can't fit are named first
    // A VIEW GOES, its blocks with it (asked first when it has any); the views after it close up
    async removeView(v) {
      var n = this.grid.items.filter((it) => (it.view || 0) === v).length;
      if (n && !await this.K.confirm(this.shadowRoot, { title: 'Remove View ' + (v + 1) + '?', message: (n === 1 ? 'Its block goes' : 'Its ' + n + ' blocks go') + ' with it. Nothing is saved yet.', ok: 'Remove View', destructive: true })) return;
      var next = copy(this.grid);
      next.items = next.items.filter((it) => (it.view || 0) !== v).map((it) => {
        if ((it.view || 0) > v) { it.view -= 1; if (!it.view) delete it.view; }
        return it;
      });
      next.views = (next.views || 1) - 1;
      if (next.views <= 1) delete next.views;
      VIEW = Math.max(0, v - 1); this.selected = null;
      this.change(next);
    }
    async screenType(key) {
      var t = SCREEN_TYPES.find((x) => x[0] === key);
      if (!t || !this.grid) return;
      var r = reflow(this.grid, t[2], t[3]);
      if (r.left.length) {
        var names = r.left.map((it) => (NAMES[it.card] || it.card) + ' (' + SIZE_NAMES[it.size] + ')');
        var ok = await this.K.confirm(this.shadowRoot, { title: 'Use ' + t[1] + '?',
          message: (names.length === 1 ? 'This block doesn’t fit and leaves the draft: ' : 'These blocks don’t fit and leave the draft: ') + names.join(', ') + '. Nothing is saved yet.',
          ok: 'Use ' + t[1] });
        if (!ok) { this.side(); return; }
      }
      r.grid.band = t[4]; r.grid.frame = t[5].slice();
      // (a phone fills itself: its grid is smaller than its screen on its side)
      if (/^phone/.test(t[0])) r.grid.grow = true;
      if (r.grid.items.every((it) => it.id !== this.selected)) this.selected = null;
      this.change(r.grid);
    }
    // a starter (or Start Empty) on this screen's grid, when the screen has
    // one other than the starters' own 6 x 4
    asScreen(grid) {
      var g = this.grid;
      if (!g || !grid || (g.cols === grid.cols && g.rows === grid.rows)) return grid;
      var out = reflow(grid, g.cols, g.rows).grid;
      out.band = g.band; out.frame = g.frame.slice();
      return out;
    }
    async starter(concept) {
      if (this.busy) return;
      if (this.grid && !await this.K.confirm(this.shadowRoot, { title: 'Use a Starter Layout?', message: 'This replaces your draft. Nothing is saved yet.', ok: 'Use Starter' })) return;
      if (concept === 'empty') { this.selected = null; this.change(this.asScreen(copy(EMPTY))); return; }
      var own = NIGHTSTAND.find((c) => c[0] === concept);
      if (own && this.grid) {
        var g2 = Object.assign(copy(this.grid), { items: copy(own[3]) });
        if (own[4]) g2.views = own[4]; else delete g2.views;
        VIEW = 0; this.selected = null; this.change(g2); return;
      }
      var result;
      try {
        this.busy = true;
        result = this.starterGrids && this.starterGrids[concept] ? { grid: this.starterGrids[concept] }
          : await this.panel.client.callWS({ type: 'hk_frontend/grid/starter', options: this.starterOptions(concept) });
      } catch (e) { this.say('Couldn’t load the starter. ' + (e.message || e)); return; }
      finally { this.busy = false; }
      this.selected = null; this.change(this.asScreen(copy(result.grid)));
    }
    // what a starter is filled from: this screen's scenes, rooms, cameras,
    // thermostats, its tablet's room and whether it shows the tab bar
    starterOptions(concept) {
      var client = this.panel.client, states = client.states || {}, board = this.o.board;
      var ids = (domain) => Object.keys(states).filter((id) => id.indexOf(domain + '.') === 0).slice(0, 512);
      var rooms = (board.room_order || []).filter((id) => (client.areas || {})[id]);
      if (!rooms.length) rooms = Object.keys(client.areas || {});
      rooms = rooms.slice(0, 512);
      var tablet = Object.values(this.panel.data.tablets || {}).find((t) => t.screen === this.o.path && t.room);
      var menu = board.menu_custom ? board.menu : (this.panel.data.settings.menu || {}).menu;
      return { concept: concept, scenes: board.scenes && board.scenes.length ? board.scenes.filter((id) => id.indexOf('scene.') === 0) : ids('scene'), rooms: rooms,
        cameras: board.cameras && board.cameras.length ? board.cameras : ids('camera'), climate: ids('climate'),
        tablet_room: tablet ? tablet.room : null, tab_bar: menu === 'tabbar' || menu === 'auto' || !menu };
    }
    // EVERY STARTER, as it would be for this screen (read-only requests, once):
    // the maps beside their names
    loadStarters() {
      if (this.starterGrids || this._startersLoading) return;
      this._startersLoading = true;
      var client = this.panel.client, got = {};
      Promise.all(STARTERS.filter((c) => c[0] !== 'empty').map((c) => client.callWS({ type: 'hk_frontend/grid/starter', options: this.starterOptions(c[0]) })
        .then((r) => { got[c[0]] = r.grid; }, () => {}))).then(() => {
        this._startersLoading = false; this.starterGrids = got;
        if (this.ui && !this.selected) this.side();
      });
    }
    // A LAYOUT'S MAP: its band and its blocks, each in its palette group's color with its glyph
    miniMap(grid, waiting) {
      var h = this.h, g = grid || EMPTY, kids = [];
      var box = h('div', { class: 'mini', 'aria-hidden': 'true' });
      box.style.gridTemplateColumns = 'repeat(' + g.cols + ',minmax(0,1fr))';
      box.style.gridTemplateRows = (g.band ? 'minmax(0,.35fr) ' : '') + 'repeat(' + g.rows + ',minmax(0,1fr))';
      if (g.band) kids.push(h('span', { class: 'band' }));
      if (waiting) {
        for (var k = 0; k < g.cols * g.rows; k++) kids.push(h('i', { class: 'wait' }));
      }
      (waiting ? [] : g.items.filter((it) => !it.view)).forEach((it) => {
        var z = SIZES[it.size], tile = h('i', {}, h('hk-icon', { icon: GLYPHS[it.card] }));
        tile.style.gridColumn = (it.at[0] + 1) + ' / span ' + z[0];
        tile.style.gridRow = (it.at[1] + 1 + (g.band ? 1 : 0)) + ' / span ' + z[1];
        tile.style.background = 'color-mix(in srgb,' + GROUP_TINT[groupOf(it.card)] + ' 38%,transparent)';
        kids.push(tile);
      });
      kids.forEach((n) => box.appendChild(n));
      return box;
    }
    starterGallery() {
      var h = this.h, K = this.K, waiting = !this.starterGrids;
      this.loadStarters();
      var night = screenTypeOf(this.grid) === 'phone_landscape';
      var rows = (night ? NIGHTSTAND.concat([STARTERS[STARTERS.length - 1]]) : STARTERS).map((c) => {
        var grid = this.asScreen(c[0] === 'empty' ? EMPTY : c[3] ? Object.assign(copy(this.grid), { items: copy(c[3]) }) : this.starterGrids && this.starterGrids[c[0]]);
        if (!waiting && !grid) return null;               // a starter that couldn't be read
        return h('button', { class: 'cell starter', type: 'button', 'data-starter': c[0], 'aria-label': c[1] + ', ' + c[2],
          onclick: () => this.starter(c[0]) }, [this.miniMap(grid, waiting && c[0] !== 'empty'), h('span', { class: 'st' }, [h('b', { text: c[1] }), h('small', { text: c[2] })])]);
      });
      return K.group({ header: this.grid ? 'Start Over With' : 'Start With',
        footer: this.grid ? 'Replaces this draft. Nothing is saved until you Save.' : 'Each fills the grid from your home’s scenes, rooms, cameras and thermostats. Nothing is saved until you Save.' }, rows);
    }
    // BOTH SIDES, drawn again: the palette and the settings (each keeps its scroll)
    side() {
      this.drawPalette();
      var key = this.selected + '|' + !!this.pickerTarget, keep = this._inspFor === key ? this.sidebar.scrollTop : 0;
      this._inspFor = key;
      this.sidebar.replaceChildren();
      var item = this.grid && this.grid.items.find((it) => it.id === this.selected);
      if (item) this.inspect(item); else this.screen();
      this.sidebar.scrollTop = keep;
    }

    // ------------------------------------------------------------ the palette
    sizeFor(card) {
      var sizes = this.sizesOf(card), want = this.paletteSizes[card];
      if (sizes.includes(want)) return want;
      return (this.grid && sizes.find((s) => firstSpace(this.grid, s))) || sizes[0];
    }
    // a card's sizes this grid can hold (choosing a card for a block: that block's size only)
    sizesOf(card) {
      var target = this.pickerTarget && this.grid && this.grid.items.find((it) => it.id === this.selected);
      if (target) return G.table()[card].sizes.filter((s) => s === target.size);
      return G.table()[card].sizes.filter((s) => !this.grid || (SIZES[s][0] <= this.grid.cols && SIZES[s][1] <= this.grid.rows));
    }
    drawPalette() {
      var h = this.h, K = this.K, self = this, P = this.palette, keep = P.scrollTop;
      if (this.catalogOff) { this.catalogOff(); this.catalogOff = null; }
      P.replaceChildren();
      var target = this.pickerTarget && this.grid && this.grid.items.find((it) => it.id === this.selected);
      var head = h('div', { class: 'pal-head' });
      if (target) head.appendChild(h('div', { class: 'pick-banner' }, [h('span', { text: /^rule:/.test(this.pickerTarget) ? 'Choose the card rule ' + (+this.pickerTarget.slice(5) + 1) + ' shows in this ' + SIZE_NAMES[target.size] + ' block.' : 'Choose a new card for this ' + SIZE_NAMES[target.size] + ' block.' }),
        h('button', { type: 'button', text: 'Cancel', onclick: () => this.pickFor(null) })]));
      var search = h('input', { class: 'catalog-search', type: 'search', placeholder: 'Search cards', 'aria-label': 'Search cards', value: this.pickerSearch || '' });
      head.appendChild(search);
      if (!target) head.appendChild(h('p', { text: this.grid ? 'Drag a card onto the grid, or click it to preview and add.' : 'Choose a starter layout or Start Empty on the right, then drag cards onto the grid.' }));
      P.appendChild(head);
      var list = h('div', { class: 'catalog-list' }); P.appendChild(list);
      var rows = function () {
        list.replaceChildren();
        var query = (search.value || '').trim().toLowerCase(), count = 0;
        GROUPS.forEach(function (g) {
          var keys = g[1].filter((k) => self.sizesOf(k).length && (NAMES[k] + ' ' + DESCRIPTIONS[k] + ' ' + g[0]).toLowerCase().includes(query));
          if (!keys.length) return;
          count += keys.length;
          var cells = [];
          keys.forEach((k) => { cells.push(self.paletteRow(k)); if (self.pickerCard === k) cells.push(self.paletteDetail(k)); });
          list.appendChild(K.group({ header: g[0] }, cells));
        });
        if (!count) list.appendChild(h('p', { class: 'note', text: 'No cards match your search.' }));
      };
      search.addEventListener('input', () => { self.pickerSearch = search.value; rows(); if (self.pickerCard) self.catalogPreviews(); });
      rows();
      P.scrollTop = keep;
      if (this.pickerCard) this.catalogPreviews();
    }
    paletteRow(k) {
      var h = this.h, self = this, size = this.sizeFor(k), open = this.pickerCard === k;
      var chips = h('div', { class: 'chips', role: 'group', 'aria-label': NAMES[k] + ' size' }, this.sizesOf(k).map((s) => {
        var full = !this.pickerTarget && this.grid && !firstSpace(this.grid, s);
        return h('button', { class: 'chip', type: 'button', 'data-size': s, 'data-full': String(!!full), 'aria-pressed': String(s === size),
          title: SIZE_NAMES[s] + ' · ' + SIZES[s][0] + ' × ' + SIZES[s][1] + (full ? ' · no free space' : ''), text: SIZE_SHORT[s] });
      }));
      var row = h('div', { class: 'cell pal-row', role: 'button', tabindex: '0', 'data-card': k, 'aria-expanded': String(open),
        'aria-label': NAMES[k] + ', ' + DESCRIPTIONS[k] + (this.pickerTarget ? '' : '. Drag onto the grid, or press Enter to preview.') },
        [h('hk-icon', { icon: GLYPHS[k] }), h('span', { class: 'pt' }, [h('b', { text: NAMES[k] }), h('small', { text: DESCRIPTIONS[k] }), chips])]);
      // A FINGER SCROLLS THE LIST (2026-10-24, the owner on an iPad: "it keeps
      // thinking I want to move a card"): up or down is the list's to scroll
      // (touch-action pan-y); a card is picked up by a drag sideways, towards
      // the grid, or by a hold (hkDrag.HOLD_MS, iOS's home screen) and then any way.
      // A mouse picks it up on any 5 px drag, as before. While a card is
      // carried the list doesn't scroll under it (touchmove, not passive).
      // The press is told apart by modules/hk-drag.js, Edit mode's too.
      var D = window.hkDrag;
      D.holdStill(row, 'lifted');
      row.addEventListener('pointerdown', function (e) {
        D.press(row, e, {
          axis: 'x',
          lift: function (ev) { return self.paletteDrag(ev, k, row); },
          tap: function (ev) {
            var chip = ev.target.closest && ev.target.closest('.chip');
            if (chip) { self.paletteSizes[k] = chip.dataset.size; self.pickerCard = k; }
            else self.pickerCard = self.pickerCard === k ? null : k;
            self.drawPalette();
          }
        });
      });
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); this.pickerCard = this.pickerCard === k ? null : k; this.drawPalette();
        var again = this.palette.querySelector('[data-card="' + k + '"]'); if (again) again.focus();
      });
      return row;
    }
    // THE CHOSEN CARD: its live preview at its size, and Add (or Use, for a block's card)
    paletteDetail(k) {
      var h = this.h, sz = this.sizeFor(k), space = this.pickerTarget || (this.grid && firstSpace(this.grid, sz));
      this.pickerSize = sz;
      var preview = h('div', { class: 'catalog-preview', 'data-preview-card': k, 'data-preview-size': sz, role: 'img',
        'aria-label': NAMES[k] + ' preview, ' + SIZE_NAMES[sz] });
      return h('div', { class: 'cell pal-detail' }, [preview,
        h('p', { class: 'note', text: 'Sample readings. On your screen it shows your home.' }),
        h('button', { class: 'catalog-add', type: 'button', disabled: !space,
          text: this.pickerTarget ? 'Use ' + NAMES[k] : space ? 'Add ' + SIZE_NAMES[sz] + ' ' + NAMES[k] : 'No room for this size',
          onclick: () => this.usePicked(k, sz) })]);
    }
    pickFor(target) {
      this.pickerTarget = target; this.pickerCard = null; this.pickerSearch = '';
      this.side();
      if (target) { var s = this.palette.querySelector('.catalog-search'); if (s) s.focus(); }
    }
    usePicked(key, size) {
      if (!this.pickerTarget) { this.addCard(key, size); return; }
      var item = this.grid.items.find((it) => it.id === this.selected), target = this.pickerTarget;
      this.pickerTarget = null; this.pickerCard = null;
      var variant = this.variantFor(key);
      if (/^rule:/.test(target)) {
        var rules = copy(item.rules || []), at = +target.slice(5);
        if (rules[at]) { rules[at] = Object.assign({ when: rules[at].when }, variant); this.update(item.id, { rules: rules }); }
        return;
      }
      this.update(item.id, { card: key, opts: variant.opts, pages: variant.pages || null });
    }
    // A card as a block or a fallback starts with: sample options, an
    // Accessory Group's automatic pages (its samples may not fit one page),
    // and a room that scrolls through all its accessories (the owner's
    // choice, 2026-10-24; a saved room without the option stays Summary)
    variantFor(key) {
      var out = { card: key, opts: this.previewOptions(key) };
      if (key === 'accessories') out.pages = { source: 'accessories' };
      if (key === 'room') out.opts.accessory_display = 'scroll';
      return out;
    }

    // ------------------------------------------------------------ the screen's settings
    screen() {
      var h = this.h, K = this.K, add = (n) => this.sidebar.appendChild(n);
      var starters = () => this.starterGallery();
      add(h('div', { class: 'insp-head' }, [h('hk-icon', { icon: 'mdi:tablet' }), h('div', {}, [h('h2', { text: 'Screen' }),
        h('p', { text: this.grid ? this.grid.items.length + (this.grid.items.length === 1 ? ' block' : ' blocks') + ' · select one to change it' : 'No layout yet' })])]));
      if (!this.grid) { add(starters()); return; }
      var config = (key, value) => { var next = copy(this.grid); next[key] = value; if (valid(next)) this.change(next); else { this.say('Move or remove the blocks that would be outside the new grid first.'); this.side(); } };
      var kind = screenTypeOf(this.grid), live = this.previewView && this.previewView.isConnected && this.previewView._gridScale;
      var pct = Math.round(100 * (live || scaleAt(this.grid, this.grid.frame)));
      var tip = kind === 'phone_landscape' ? ' On a phone on its side, set the screen’s Tab Bar Position to Left or Right, so the clock gets the height.'
        : kind === 'phone_portrait' ? ' Phones start without the top band: turn it on under Header if you want it.' : '';
      // VIEWS: whole layouts a swipe apart on this screen (StandBy's); the
      // grid and the preview show the one chosen here
      var views = this.grid.views || 1;
      if (VIEW >= views) VIEW = 0;
      var viewOpts = [];
      for (var vi = 0; vi < views; vi++) viewOpts.push([String(vi), String(vi + 1)]);
      if (views < 4) viewOpts.push(['add', '+']);
      var viewRows = [K.seg({ label: 'View', value: String(VIEW), options: viewOpts, onChange: (v) => {
        if (v === 'add') { VIEW = views; config('views', views + 1); return; }
        // (the outlines and the preview turn to the view; the frame itself is not reloaded)
        VIEW = +v; this.selected = null; this.blocks(); this.side(); this.fit();
        // (and again once the preview's view has slid in: its cells place the outlines)
        setTimeout(() => this.fit(), 520);
      } })];
      if (views > 1) viewRows.push(K.button({ label: 'Remove View ' + (VIEW + 1), destructive: true, onClick: () => this.removeView(VIEW) }));
      add(K.group({ header: 'Views', footer: views > 1 ? 'Swipe sideways on the screen between its views. Each is a whole layout of its own on this grid.'
        : 'Add a view for a second layout a swipe away, as StandBy has.' }, viewRows));
      add(K.group({ header: 'Grid', footer: 'The grid scales to fit each screen; its blocks keep their shape. In this preview they show at ' + pct + '% of full size.' + tip }, [
        K.select({ label: 'Screen Type', value: kind, options: [['custom', 'Custom']].concat(SCREEN_TYPES.map((t) => [t[0], t[1] + ' · ' + t[2] + ' × ' + t[3]])),
          onChange: (k) => this.screenType(k) }),
        K.seg({ label: 'Columns', value: this.grid.cols, options: [6, 3, 2].map((n) => [n, String(n)]), onChange: (n) => config('cols', Number(n)) }),
        K.select({ label: 'Rows', value: this.grid.rows, options: [2, 3, 4, 5, 6].map((n) => [n, String(n)]), onChange: (n) => config('rows', Number(n)) }),
        K.toggle({ label: 'Show Boxes', sub: 'Off: every block straight on the background, as on a nightstand.', on: this.grid.boxes !== false, onChange: (on) => config('boxes', on) }),
        K.toggle({ label: 'Fill the Screen', sub: 'Lets the grid grow past its own size on a screen bigger than it.', on: this.grid.grow === true, onChange: (on) => config('grow', on) }),
        K.select({ label: 'Grid Scale', value: this.grid.scale || 100, options: [100, 90, 80, 70, 60, 50].map((n) => [n, n === 100 ? 'Automatic Fit' : n + '% of Fit']), onChange: (n) => config('scale', Number(n)) })]));
      // NIGHT MODE (2026-10-24): the screen one dim red at night, as StandBy and the screensaver's clock have it
      var night = this.grid.night || { mode: 'off', from: '22:00', to: '07:00' }, putNight = (patch) => config('night', Object.assign({ from: '22:00', to: '07:00' }, night, patch));
      var nightRows = [K.seg({ label: 'Night Mode', value: night.mode, options: [['off', 'Off'], ['night', 'At Night'], ['always', 'Always']], onChange: (m) => putNight({ mode: m }) })];
      if (night.mode === 'night') {
        nightRows.push(K.text({ label: 'From', type: 'time', value: night.from, onCommit: (v) => { if (/^\d\d:\d\d$/.test(v) && v !== night.to) putNight({ from: v }); else this.side(); } }));
        nightRows.push(K.text({ label: 'Until', type: 'time', value: night.to, onCommit: (v) => { if (/^\d\d:\d\d$/.test(v) && v !== night.from) putNight({ to: v }); else this.side(); } }));
      }
      add(K.group({ header: 'Night', footer: 'Everything on the screen one dim red, on black, while Home shows: for a bedroom or a nightstand.' }, nightRows));
      add(K.group({ header: 'Header' }, [
        K.toggle({ label: 'Top Band', sub: 'The clock, weather and status chips', on: this.grid.band, onChange: (v) => config('band', v) }),
        K.toggle({ label: 'Clock', on: this.grid.header_clock !== false, disabled: !this.grid.band, onChange: (v) => config('header_clock', v) }),
        K.toggle({ label: 'Weather', on: this.grid.header_weather !== false, disabled: !this.grid.band, onChange: (v) => config('header_weather', v) })]));
      var more = h('details', { class: 'screen-settings' }, [h('summary', { text: 'Preview Size and Starters' })]);
      more.open = !!this.screenSettingsOpen;
      more.addEventListener('toggle', () => { this.screenSettingsOpen = more.open; });
      more.appendChild(K.group({ header: 'Preview Size', footer: 'The size this editor previews the screen at. The tablet itself always fits the grid to its own screen.' }, [
        K.text({ label: 'Width', value: this.grid.frame[0], type: 'number', unit: 'px', onCommit: (v) => config('frame', [Number(v), this.grid.frame[1]]) }),
        K.text({ label: 'Height', value: this.grid.frame[1], type: 'number', unit: 'px', onCommit: (v) => config('frame', [this.grid.frame[0], Number(v)]) })]));
      more.appendChild(starters());
      add(more);
      if (this.panel.host() && this.panel.host().gridHistory) {
        add(K.group({ header: 'Layout History' }, [K.button({ label: this.histories ? 'Refresh History' : 'Show Earlier Layouts', onClick: () => this.history() })]));
        if (this.histories) {
          var historyRows = this.histories.map((row) => K.button({ label: 'Version ' + row.version + ' · ' + new Date(row.created * 1000).toLocaleString() + ' · ' + (row.actor_name || row.actor || row.source || 'Unknown'), onClick: () => this.restore(row) }));
          add(K.group({ header: 'Earlier Layouts', footer: historyRows.length ? 'A version becomes your draft. Save to restore its layout only.' : 'No earlier layouts.' }, historyRows));
        }
        var targets = this.panel.data.dashboards.filter((d) => d.item && d.generated && d.path !== this.o.path && this.panel.data.boards[d.path]);
        if (targets.length) add(K.group({ header: 'Copy Layout To…' }, [K.select({ label: 'Screen', value: '', options: [['', 'Choose Screen']].concat(targets.map((d) => [d.path, d.title])), onChange: (path) => this.copyTo(path) })]));
      }
    }

    // ------------------------------------------------------------ a block's settings
    inspect(item) {
      var h = this.h, K = this.K, add = (n) => this.sidebar.appendChild(n);
      add(h('div', { class: 'insp-head' }, [h('hk-icon', { icon: GLYPHS[item.card] }), h('div', {}, [h('h2', { text: NAMES[item.card] }),
        h('p', { text: SIZE_NAMES[item.size] + ' · column ' + (item.at[0] + 1) + ', row ' + (item.at[1] + 1) })]),
        h('button', { class: 'done', type: 'button', text: 'Done', onclick: () => this.select(null) })]));
      var sizes = G.table()[item.card].sizes.filter((sz) => SIZES[sz][0] <= this.grid.cols && SIZES[sz][1] <= this.grid.rows);
      var rows = [];
      if (sizes.length > 1) rows.push(K.seg({ label: 'Size', value: item.size, options: sizes.map((sz) => [sz, SIZE_SHORT[sz]]), onChange: (sz) => this.resize(item, sz) }));
      rows.push(K.button({ label: 'Change Card…', onClick: () => this.pickFor('primary') }));
      add(K.group({}, rows));
      this.content(item);
      this.conditions(item);
      add(K.group({}, [K.button({ label: 'Remove Block', destructive: true, onClick: () => this.remove(item.id) })]));
    }
    resize(item, sz) {
      if (item.card === 'accessories' && item.pages && item.pages.source === 'list' && item.pages.list.some((pg) => ((pg.opts || {}).accessories || []).length > G.PER_PAGE[sz])) {
        this.say('A ' + SIZE_NAMES[sz] + ' page holds ' + G.PER_PAGE[sz] + ' accessories. Move some to another page, or choose Automatic Pages, first.'); this.side(); return;
      }
      var misfit = (item.rules || []).find((r) => !G.table()[r.card].sizes.includes(sz));
      if (misfit) {
        this.say('A rule’s card, ' + NAMES[misfit.card] + ', doesn’t come in ' + SIZE_NAMES[sz] + '. Change or remove that rule first.'); this.side(); return;
      }
      var next = place(this.grid, item.id, item.at, sz);
      if (next) this.change(next); else { this.say('A ' + SIZE_NAMES[sz] + ' block doesn’t fit here. Make room around it first.'); this.side(); }
    }
    // WHAT THE BLOCK SHOWS: one thing or pages that swipe, then the options that apply
    content(item) {
      var K = this.K, cat = G.table()[item.card], add = (n) => this.sidebar.appendChild(n);
      var src = item.pages && item.pages.source || '', words = SHOW[item.card] || [], rows = [], footer = null;
      var show = item.card === 'accessories' ? [['accessories', words[1]], ['list', 'Choose Each Page']]
        : [['', words[0] || 'One Page']].concat(cat.sources.map((s) => [s, words[1] || 'Swipe All']), [['list', 'Choose Each Page']]);
      // a camera block may follow: swipe all cameras, turning to the one motion or a selector picks
      var follows = item.card === 'camera' && src === 'cameras' && !!(item.opts || {}).follow;
      if (item.card === 'camera') show.splice(2, 0, ['follow', 'Follow Motion or a Selector']);
      rows.push(K.select({ label: 'Show', value: follows ? 'follow' : src, options: show, onChange: (s) => this.setShow(item, s) }));
      var hide = { follow: 1, follow_select: 1 };
      if (follows) this.followRows(item, rows);
      if (SOURCE_HIDES[src]) hide[SOURCE_HIDES[src]] = 1;
      if (item.card === 'room' && src === 'rooms') rows.push(this.startingRoom(item));
      if (src === 'thermostats') rows.push(K.toggle({ label: 'Start on Tablet’s Room', on: item.pages.start === 'tablet_room', onChange: (on) => {
        var p = copy(item.pages); if (on) p.start = 'tablet_room'; else delete p.start; this.update(item.id, { pages: p });
      } }));
      rows = rows.concat(this.fields(item.card, item.opts || {}, (opts) => this.update(item.id, { opts: opts }), { hide: hide, size: item.size, list: src === 'list' }));
      if (item.card === 'room') footer = this.roomNote(item, src);
      else if (src === 'list') footer = 'Each page repeats this card with its own choices. A choice left on Same as the Block uses the block’s.';
      else if (item.card === 'accessories') footer = 'Each page holds ' + G.PER_PAGE[item.size] + ' at this size; more make more pages.';
      else if (item.card === 'camera' && src === 'cameras' && (item.opts || {}).follow) footer = (item.opts.follow === 'motion'
        ? 'Shows the camera in the room where motion was seen last (each camera with the motion sensors in its own room).'
        : 'Shows the camera the selector picks: an option names a camera by its name.') + ' Swipe for the others; it follows again a minute after you stop.';
      else if (src) footer = 'Swipe sideways on the block to change pages. It goes back to its first page when the screen goes idle.';
      add(K.group({ header: 'Content', footer: footer }, rows));
      if (src === 'list') this.pages(item);
      // HIDE BOX (2026-10-24): any block's card without its box; the screen's Show Boxes off hides every one
      // (a clock saved with its own Hide Box option moves to the block's)
      var noBoxes = this.grid.boxes === false, ownBare = item.card === 'clock' && (item.opts || {}).bare;
      var look = [K.toggle({ label: 'Hide Box', on: noBoxes || !!item.bare || !!ownBare, disabled: noBoxes,
        sub: noBoxes ? 'The screen hides every block’s box (Screen → Show Boxes).' : 'The card straight on the background, without its box.',
        onChange: (on) => { var patch = { bare: on || null }; if (ownBare) { var o = copy(item.opts); delete o.bare; patch.opts = o; } this.update(item.id, patch); } })];
      if (cat.opts && cat.opts.surface) this.surfaceFields((item.opts || {}).surface, (value) => { var o = copy(item.opts || {}); if (value) o.surface = value; else delete o.surface; this.update(item.id, { opts: o }); }, look);
      add(K.group({ header: 'Appearance', footer: cat.opts && cat.opts.surface ? 'A custom background changes only the group’s own; its tiles keep the screen’s look.' : '' }, look));
    }
    setShow(item, s) {
      if (item.card === 'accessories') {
        var opts = copy(item.opts || {}), per = G.PER_PAGE[item.size], entries = opts.accessories || [];
        if (s === 'list') {
          var list = [];
          for (var i = 0; i < entries.length; i += per) list.push({ opts: { accessories: entries.slice(i, i + per) } });
          delete opts.accessories;
          this.update(item.id, { opts: opts, pages: { source: 'list', list: list.length ? list : [{ opts: {} }] } });
        } else {
          if (item.pages && item.pages.source === 'list') entries = item.pages.list.flatMap((pg) => (pg.opts || {}).accessories || []);
          var seen = new Set(); entries = entries.filter((e) => !seen.has(e.entity) && seen.add(e.entity));
          if (entries.length > 24) { this.say('Automatic pages hold up to 24 accessories. Remove some first.'); this.side(); return; }
          if (entries.length) opts.accessories = entries;
          this.update(item.id, { opts: opts, pages: { source: 'accessories' } });
        }
        return;
      }
      var o = copy(item.opts || {});
      if (s === 'follow') { o.follow = o.follow || 'motion'; this.update(item.id, { opts: o, pages: { source: 'cameras' } }); return; }
      delete o.follow; delete o.follow_select;
      this.update(item.id, { opts: o, pages: s ? s === 'list' ? { source: 'list', list: [{ opts: {} }, { opts: {} }] } : { source: s } : null });
    }
    // WHAT A FOLLOWING CAMERA BLOCK FOLLOWS: motion in each camera's room, or a
    // selector (its own, else the screen's Live Camera Follows)
    followRows(item, rows) {
      var K = this.K, o = item.opts || {}, put = (patch) => { var n = Object.assign(copy(o), patch); Object.keys(patch).forEach((k) => { if (patch[k] == null) delete n[k]; }); this.update(item.id, { opts: n }); };
      rows.push(K.seg({ label: 'Follow', value: o.follow, options: [['motion', 'Motion'], ['selector', 'A Selector']], onChange: (v) => put({ follow: v, follow_select: v === 'motion' ? null : o.follow_select }) }));
      if (o.follow === 'selector') {
        var board = this.o.board || {}, here = board.camera_live;
        rows.push(K.select({ label: 'Selector', value: o.follow_select || '', onChange: (v) => put({ follow_select: v || null }),
          options: [['', here ? 'The Screen’s Live Camera Follows' : 'The Screen’s (None Set)']].concat(this.choices('select')) }));
      }
    }
    startingRoom(item) {
      var area = (item.opts || {}).area || (item.pages.start === 'tablet_room' ? 'tablet_room' : '');
      var roomIds = this.previewView && this.previewView._config.grid_ctx && this.previewView._config.grid_ctx.rooms;
      var choices = [['', 'First Room']].concat(this.choices('area').filter((op) => op[0] === 'tablet_room' || !roomIds || roomIds.includes(op[0])));
      if (area && !choices.some((op) => op[0] === area)) choices.push([area, area + ' (Not on this screen)']);
      return this.K.select({ label: 'Starting Room', value: area, options: choices, onChange: (value) => {
        var opts = copy(item.opts || {}), pages = copy(item.pages);
        if (value) opts.area = value; else delete opts.area;
        if (value === 'tablet_room') pages.start = 'tablet_room'; else delete pages.start;
        this.update(item.id, { opts: opts, pages: pages });
      } });
    }
    roomNote(item, src) {
      var area = (item.opts || {}).area || (item.pages && item.pages.start === 'tablet_room' ? 'tablet_room' : '');
      var roomIds = this.previewView && this.previewView._config.grid_ctx && this.previewView._config.grid_ctx.rooms;
      var name = area && area !== 'tablet_room' ? ((this.panel.client.areas || {})[area] || {}).name || area : '';
      if (src === 'rooms') {
        if (area && area !== 'tablet_room' && roomIds && !roomIds.includes(area)) return 'That room isn’t on this screen, so it opens on the first room.';
        return (area === 'tablet_room' ? 'Opens on the wall tablet’s room (a desktop shows the first).' : name ? 'Opens on ' + name + '.' : 'Opens on the screen’s first room.') +
          ' Swipe for the others; it comes back when the screen goes idle.';
      }
      if (src !== 'list' && (area === 'tablet_room' || !area)) return 'The wall tablet’s own room. A desktop shows the first room.';
      return null;
    }
    // CHOOSE EACH PAGE: each page's own choices, then move or remove it, and Add Page
    pages(item) {
      var K = this.K, add = (n) => this.sidebar.appendChild(n), n = item.pages.list.length;
      item.pages.list.forEach((pg, i) => {
        var rows = this.fields(item.card, pg.opts || {}, (opts) => { var p = copy(item.pages); p.list[i].opts = opts; this.update(item.id, { pages: p }); },
          { page: true, size: item.size, base: item.opts || {}, hide: { surface: 1 } });
        rows.push(K.button({ label: 'Move Up', disabled: i === 0, onClick: () => { var p = copy(item.pages); p.list.splice(i - 1, 0, p.list.splice(i, 1)[0]); this.update(item.id, { pages: p }); } }));
        rows.push(K.button({ label: 'Remove Page', destructive: true, disabled: n === 1, onClick: () => { var p = copy(item.pages); p.list.splice(i, 1); this.update(item.id, { pages: p }); } }));
        add(K.group({ header: 'Page ' + (i + 1) + ' of ' + n }, rows));
      });
      add(K.group({}, [K.button({ label: 'Add Page', disabled: n >= G.PAGES_MAX, onClick: () => { var p = copy(item.pages); p.list.push({ opts: {} }); this.update(item.id, { pages: p }); } })]));
    }
    // SHOW WHEN (2026-10-24, the owner): the block's own card by default, and
    // up to four rules -- each its card while all of its conditions (up to
    // three) hold, the first that holds winning. Every card fills this space.
    conditions(item) {
      var K = this.K, add = (n) => this.sidebar.appendChild(n), rules = item.rules || [];
      var put = (next) => { this.conditionPreview = null; this.update(item.id, { rules: next.length ? next : null }); };
      var head = [];
      if (rules.length) head.push(K.seg({ label: 'Preview', value: this.conditionPreview == null ? 'live' : String(this.conditionPreview),
        options: [['live', 'Live'], ['-1', 'Default']].concat(rules.map((r, i) => [String(i), 'Rule ' + (i + 1)])),
        onChange: (v) => { this.conditionPreview = v === 'live' ? null : Number(v); this.preview(); this.side(); } }));
      add(K.group({ header: 'Show When', footer: rules.length
        ? 'Shows ' + NAMES[item.card] + ' unless a rule holds; the first rule that holds wins. Each card fills exactly this space, so nothing moves.'
        : 'Add a rule to show another card here while something is true: music playing, a time of day, the alarm still armed.' }, head));
      rules.forEach((r, i) => {
        var conds = (r.when && r.when.all) || [], rows = [];
        var putRule = (fn) => { var next = copy(rules); fn(next[i]); put(next); };
        conds.forEach((c, j) => this.conditionRows(c, j, rows, (nc) => {
          var next = copy(rules);
          if (nc) next[i].when.all[j] = nc; else next[i].when.all.splice(j, 1);
          if (!next[i].when.all.length) next.splice(i, 1);
          put(next);
        }));
        if (conds.length < 3) rows.push(K.select({ label: conds.length ? 'And Also' : 'When', value: '',
          options: [['', 'Add a Condition…']].concat(G.CONDITIONS.map((k) => [k, CONDITION_NAMES[k]])),
          onChange: (k) => { if (k) putRule((x) => x.when.all.push(this.newCondition(k))); } }));
        rows.push(K.button({ label: 'Then Show: ' + NAMES[r.card] + '…', onClick: () => this.pickFor('rule:' + i) }));
        var rcat = G.table()[r.card];
        if (rcat.sources.length) rows.push(K.select({ label: 'Show', value: r.pages && r.pages.source || '',
          options: [['', (SHOW[r.card] || [])[0] || 'One Page']].concat(rcat.sources.map((src) => [src, (SHOW[r.card] || [])[1] || 'Swipe All'])),
          onChange: (src) => putRule((x) => { if (src) x.pages = { source: src }; else delete x.pages; }) }));
        rows = rows.concat(this.fields(r.card, r.opts || {}, (opts) => putRule((x) => { if (Object.keys(opts).length) x.opts = opts; else delete x.opts; }),
          { size: item.size, hide: { surface: 1, follow: 1, follow_select: 1 } }));
        rows.push(K.button({ label: 'Move Rule Up', disabled: i === 0, onClick: () => { var next = copy(rules); next.splice(i - 1, 0, next.splice(i, 1)[0]); put(next); } }));
        rows.push(K.button({ label: 'Remove Rule', destructive: true, onClick: () => { var next = copy(rules); next.splice(i, 1); put(next); } }));
        add(K.group({ header: 'Rule ' + (i + 1) + ' · ' + NAMES[r.card] }, rows));
      });
      if (rules.length < 4) add(K.group({}, [K.button({ label: 'Add Rule', onClick: () => {
        var other = Object.keys(G.table()).find((k) => k !== item.card && G.table()[k].sizes.includes(item.size)) || item.card;
        put(rules.concat([Object.assign({ when: { all: [this.newCondition('music_playing')] } }, this.variantFor(other))]));
      } })]));
    }
    newCondition(kind) {
      var c = { kind: kind };
      if (kind === 'time') { c.from = '06:00'; c.to = '09:00'; }
      if (kind === 'entity_state') { var ch = this.choices('entity')[0]; if (ch) { c.entity = ch[0]; c.state = 'on'; } }
      return c;
    }
    // ONE CONDITION'S ROWS: what it is (or Remove), and what it watches
    conditionRows(c, j, rows, put) {
      var K = this.K, set = (key, value) => { var out = copy(c); if (value) out[key] = value; else delete out[key]; put(out); };
      rows.push(K.select({ label: j ? 'And' : 'When', value: c.kind,
        options: G.CONDITIONS.map((k) => [k, CONDITION_NAMES[k]]).concat([['', 'Remove This Condition']]),
        onChange: (k) => put(k ? this.newCondition(k) : null) }));
      if (c.kind === 'time') {
        rows.push(K.text({ label: 'From', type: 'time', value: c.from, onCommit: (v) => { if (/^\d{2}:\d{2}$/.test(v)) set('from', v); } }));
        rows.push(K.text({ label: 'Until', type: 'time', value: c.to, onCommit: (v) => { if (/^\d{2}:\d{2}$/.test(v)) set('to', v); } }));
        return;
      }
      if (c.kind !== 'after_sunset') rows.push(K.select({ label: 'Watch', value: c.entity || '',
        options: (c.kind === 'entity_state' ? [] : [['', 'Automatic']]).concat(this.choices({ music_playing: 'speaker', timer_running: 'timer', alarm_armed: 'alarm',
          alarm_disarmed: 'alarm', doorbell: 'doorbell' }[c.kind] || 'entity').filter((op) => op[0] !== 'tablet_room')),
        onChange: (v) => set('entity', v) }));
      if (c.kind === 'entity_state') rows.push(K.text({ label: 'Is', value: c.state, maxlength: 80, onCommit: (v) => set('state', v) }));
    }
    previewOptions(key) {
      var fields = G.table()[key].opts || {}, opts = {}, self = this;
      Object.keys(fields).forEach(function (name) {
        var kind = fields[name];
        if (['secondary', 'title', 'room_display'].includes(kind)) return;
        if (kind === 'accessories') { opts[name] = self.choices('entity').filter((op) => /^(light|switch|fan|sensor)\./.test(op[0])).slice(0, 4).map((op) => ({ entity: op[0] })); if (!opts[name].length) delete opts[name]; return; }
        var choices = self.choices(kind).filter((op) => op[0] !== 'tablet_room');
        if (kind === 'scene' && key === 'scene') choices = choices.filter((op) => op[0].indexOf('scene.') === 0);
        if (kind === 'entity') choices = choices.filter((op) => /^(light|switch|fan)\./.test(op[0]));
        if (kind === 'speaker') choices.sort((a, b) => (self.panel.client.states[b[0]]?.state === 'playing') - (self.panel.client.states[a[0]]?.state === 'playing'));
        if (kind === 'scenes' || kind === 'calendars') { if (choices.length) opts[name] = choices.slice(0, kind === 'scenes' ? 6 : 2).map((op) => op[0]); return; }
        if (choices.length && !['windows', 'surface', 'boolean'].includes(kind)) opts[name] = choices[0][0];
      });
      return opts;
    }
    catalogClient(client) {
      // This copy belongs only to the inert gallery iframe. It is never saved
      // or published through the host, and it has no command action port.
      var states = {}, now = Date.now(), stamp = new Date(now).toISOString();
      Object.keys(client.states).forEach(function (id) {
        var st = client.states[id], a = Object.assign({}, st.attributes), state = st.state;
        if (id.startsWith('climate.')) { state = 'heat_cool'; Object.assign(a, { current_temperature: 71, target_temp_low: 68, target_temp_high: 74, hvac_action: 'idle' }); }
        if (id.startsWith('media_player.')) { state = 'playing'; Object.assign(a, { media_title: 'A Favourite Song', media_artist: 'Sample Artist', media_album_name: 'Sample Album', media_duration: 240, media_position: 82, media_position_updated_at: stamp, volume_level: .4 }); }
        if (id.startsWith('weather.')) { state = 'partlycloudy'; Object.assign(a, { temperature: 72, apparent_temperature: 74, humidity: 52, wind_speed: 8, wind_speed_unit: 'mph' }); }
        if (id.startsWith('light.')) { state = 'on'; a.brightness = 180; }
        if (id.startsWith('person.')) state = 'home';
        if (id.startsWith('vacuum.')) { state = 'cleaning'; a.battery_level = 78; }
        if (id.startsWith('alarm_control_panel.')) state = 'armed_home';
        states[id] = Object.assign({}, st, { state: state, attributes: a, last_updated: stamp });
      });
      var forecast = (kind) => Array.from({ length: kind === 'daily' ? 5 : 12 }, (_, i) => ({
        datetime: new Date(now + i * (kind === 'daily' ? 86400e3 : 3600e3)).toISOString(),
        temperature: 72 + i % 4, templow: 55 + i, condition: i % 3 === 2 ? 'rainy' : 'partlycloudy', precipitation_probability: i % 3 === 2 ? 60 : 10
      }));
      Object.keys(states).forEach((id) => { if (states[id].attributes.forecast) states[id].attributes.forecast = forecast(/daily/.test(id) ? 'daily' : 'hourly'); });
      var finish = new Date(now + 240e3).toISOString();
      states['timer.grid_preview'] = { state: 'active', last_updated: stamp, attributes: { friendly_name: 'Tea', duration: '00:05:00', finishes_at: finish } };
      states['sensor.running_quick_timers'] = { state: '1', last_updated: stamp, attributes: { running: [{ entity_id: 'timer.grid_preview', name: 'Tea', finishes_at: finish }] } };
      var subs = Object.assign({}, client.subscriptions, { subscribeMessage: (callback, msg) => {
        if (msg.type === 'weather/subscribe_forecast') { var timer = setTimeout(() => callback({ forecast: forecast(msg.forecast_type) }), 0); return Promise.resolve(() => clearTimeout(timer)); }
        return client.subscriptions.subscribeMessage(callback, msg);
      } });
      var read = (method, path) => method.toUpperCase() === 'GET' && path.startsWith('calendars/')
        ? Promise.resolve([{ summary: 'Family Dinner', start: { dateTime: new Date(now + 3600e3).toISOString() }, end: { dateTime: new Date(now + 7200e3).toISOString() } },
          { summary: 'Weekend Plans', start: { dateTime: new Date(now + 86400e3).toISOString() }, end: { dateTime: new Date(now + 90000e3).toISOString() } }])
        : client.callApi(method, path);
      return Object.assign({}, client, { states: states, subscriptions: subs, callApi: read });
    }
    catalogPreviews() {
      var w = this.iframe.contentWindow;
      if (!w || !w.hkCards || !this.previewView) return;
      var box = this.palette.querySelector('[data-preview-card]'); if (!box) return;
      // (its frame is the whole screen again: made once for this card, never
      // again for a change elsewhere in the draft)
      if (box.querySelector('iframe')) return;
      if (this.catalogOff) this.catalogOff();
      var sz = box.dataset.previewSize, z = SIZES[sz], ctx = this.previewView._config.grid_ctx || {};
      var unit = w.hkCards.TILE, gap = w.hkCards.HOME_GRID.gap;
      var width = unit.w * z[0] + gap * (z[0] - 1), height = unit.tall * z[1] + gap * (z[1] - 1);
      var scale = Math.min(1, (box.clientWidth || 220) / width);
      box.style.height = height * scale + 'px';
      // Keep every descendant in the screen's custom-element registry. Adopting
      // a card into Settings leaves its hk-plate and glyph elements undefined.
      var frame = this.h('iframe', { title: NAMES[box.dataset.previewCard] + ' preview', tabindex: '-1', 'aria-hidden': 'true' });
      Object.assign(frame.style, { width: width + 'px', height: height + 'px', left: '50%', marginLeft: -(width * scale / 2) + 'px', transformOrigin: 'top left', transform: 'scale(' + scale + ')' });
      frame.inert = true; frame.src = this.iframe.src; box.replaceChildren(frame); box.setAttribute('data-loading', '');
      var active = true, timer, retries = 0;
      this.catalogOff = () => { active = false; clearTimeout(timer); };
      var load = () => {
        if (!active) return;
        var fw = frame.contentWindow;
        if (!fw || !fw.hkShell || !fw.hkShell.view() || !fw.hkCards || !fw.hkCards.client()) {
          if (retries++ < 600) timer = setTimeout(load, 300);            // up to 3 minutes
          return;
        }
        var doc = fw.document, cell = doc.createElement('div'); cell.className = 'cell'; cell.setAttribute('size', sz);
        Object.assign(cell.style, { width: width + 'px', height: height + 'px', position: 'fixed', inset: '0', containerType: 'size', containerName: 'hk-cell' });
        cell.style.setProperty('--hk-cell-w', (width + 10) / z[0] - 10 + 'px'); cell.style.setProperty('--hk-cell-h', (height + 10) / z[1] - 10 + 'px');
        var view = doc.createElement('hk-home-grid-view');
        Object.assign(view.style, { display: 'block', width: width + 'px', height: height + 'px', position: 'fixed', inset: '0' });
        var it = { id: 'preview', card: box.dataset.previewCard, size: sz, at: [0, 0], opts: this.previewOptions(box.dataset.previewCard) };
        var sample = fw.hkCards.previewClient(this.catalogClient(fw.hkCards.client()));
        var card = fw.hkCards.createCard(fw.hkGridCatalog.config(it, ctx), sample);
        card.setAttribute('size', sz); card.inert = true;
        Object.assign(card.style, { display: 'block', width: '100%', height: '100%' });
        cell.appendChild(card); view.appendChild(cell); doc.body.replaceChildren(view);
        fw.galleryCard = card; box.removeAttribute('data-loading');
        // Sample readings are fixed for this illustration. Subscribing the
        // sample back to the frame's live client hub would feed it into itself.
      };
      frame.addEventListener('load', load, { once: true });
    }
    async history() {
      if (this.busy) return;
      try {
        var data = await this.panel.host().gridHistory(this.o.path, this.panel);
        this.histories = data.history.filter((row) => row.body && row.body.home_grid);
        this.side();
      } catch (e) { this.say('Couldn’t read history. ' + (e.message || e)); }
    }
    async restore(row) {
      if (this.busy) return;
      if (!await this.K.confirm(this.shadowRoot, { title: 'Restore This Layout?', message: 'Version ' + row.version + ' becomes your draft. Review it, then Save to apply it. Other screen settings stay as they are.', ok: 'Restore Draft' })) return;
      this.selected = null; this.change(copy(row.body.home_grid));
      this.say('Version ' + row.version + ' restored to the draft. Save to apply it.');
    }
    async copyTo(path, anyway) {
      if (this.busy || !path || !valid(this.grid)) return;
      if (!anyway && !await this.K.confirm(this.shadowRoot, { title: 'Copy Layout To This Screen?', message: 'This saves your draft layout to ' + path + '. Its other settings stay as they are. Tablet’s Room still means the tablet showing that screen.', ok: 'Copy Layout' })) return;
      this.busy = true;
      var changed = null;
      try {
        var grid = copy(this.grid), version = versionOf(this.panel, path);
        var msg = { type: 'hk_frontend/board/set', dashboard: path, changes: { home_style: 'grid', home_grid: grid } };
        if (!anyway && version != null) msg.expect_version = version;    // the target screen's, as last read
        var result = await this.panel.actions().callWS(msg);
        this.panel.data.boards[path] = result && result.board || Object.assign({}, this.panel.data.boards[path], { home_style: 'grid', home_grid: grid });
        keepVersion(this.panel, path, result);
        this.say('Layout copied.');
      } catch (e) {
        if (e && e.code === 'conflict') changed = true;
        else this.say('Couldn’t copy the layout. ' + (e.message || e));
      } finally { this.busy = false; }
      if (!changed) return;
      // THAT SCREEN CHANGED since this page read it: Reload reads the
      // settings again (this screen's draft stays) to copy onto what it is
      // now; Save Anyway replaces its layout with this one
      var choice = await this.changed('That screen changed since you opened it, in another window or on another device. Reload to read it again (your draft here stays), or Save Anyway to replace its layout with this one.');
      if (choice === 'anyway') return this.copyTo(path, true);
      if (choice === 'reload') {
        try { await this.panel.reload(); this.say('Reloaded. Copy the layout again to replace that screen’s.'); }
        catch (e) { this.say('Couldn’t reload. ' + (e.message || e)); }
      } else this.say('Not copied: that screen changed since you opened it.');
    }
    // "This screen changed": Reload (Cancel's place, where focus starts) or
    // Save Anyway; Escape or a tap outside is neither ('reload' | 'anyway' | null)
    async changed(message) {
      var got = await this.K.confirm(this.shadowRoot, { title: 'This Screen Changed', message: message,
        cancel: 'Reload', ok: 'Save Anyway', dismiss: null });
      return got === true ? 'anyway' : got === false ? 'reload' : null;
    }
    // Reload: the screen as it is now (read again), the draft and its undo
    // discarded
    async reloadBoard() {
      try {
        await this.panel.reload();
        this.selected = null; this.undoStack = [];
        this.load(this.panel.data.boards[this.o.path] || {});
        this.saveButton.disabled = !this.grid; this.undoButton.disabled = true;
        this.blocks(); this.side(); this.fit(); this.preview();
        this.say('Reloaded. This is the screen’s layout as it is now.');
      } catch (e) { this.say('Couldn’t reload. ' + (e.message || e)); }
    }
    update(id, patch) {
      var next = copy(this.grid), it = next.items.find((x) => x.id === id);
      Object.keys(patch).forEach((key) => { if (patch[key] === null) delete it[key]; else it[key] = patch[key]; }); this.change(next);
    }
    // A CARD'S OPTIONS AS ROWS. o: { page (a Choose Each Page page: an
    // option left empty uses the block's), base (the block's own options,
    // for a page), hide {name: 1}, size, list (the block has custom pages) }
    fields(card, opts, save, o) {
      var K = this.K, self = this, kinds = G.table()[card].opts || {}, rows = [], hide = o.hide || {};
      var set = (key, value) => { var out = copy(opts); if (value === '' || value == null) delete out[key]; else out[key] = value; save(out); };
      Object.keys(kinds).forEach(function (key) {
        if (hide[key]) return;
        var kind = kinds[key], label = KIND_LABELS[kind] || NAME_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
        if (kind === 'surface') return;                                         // Appearance, its own group
        if (card === 'clock' && key === 'bare') return;                         // Appearance's Hide Box
        if (card === 'room' && key === 'area' && o.list && !o.page) label = 'Default Room';
        if (kind === 'room_display') {
          if (o.page) return;
          rows.push(K.seg({ label: 'Accessories', value: opts[key] || 'summary', options: [['summary', 'Summary'], ['scroll', 'Scroll All']], onChange: (v) => set(key, v === 'summary' ? null : v) }));
          return;
        }
        if (kind === 'title') { rows.push(K.text({ label: o.page ? 'Page Name' : 'Group Name', value: opts[key] || '', maxlength: 60, placeholder: o.page ? '' : 'Accessories', onCommit: (v) => set(key, v.trim() || null) })); return; }
        if (kind === 'secondary') { self.secondaryFields(opts[key], opts.entity || (o.base || {}).entity, (v) => set(key, v), rows); return; }
        if (kind === 'accessories') {
          if (o.list && !o.page) return;
          self.accessoryFields(opts[key] || [], (v) => set(key, v), rows, o.page ? G.PER_PAGE[o.size] : 24); return;
        }
        if (kind === 'boolean') { rows.push(K.toggle({ label: label, on: opts[key] === true, onChange: (on) => set(key, on || null) })); return; }
        if (kind === 'windows') { self.windows(opts, set, rows); return; }
        if (kind === 'clock_style') {
          rows.push(K.select({ label: 'Style', value: opts[key] || '', options: G.CLOCK_FACES, onChange: (v) => set(key, v || null) }));
          return;
        }
        if (kind === 'days') {
          rows.push(K.select({ label: 'Days', value: String(opts[key] || 2), options: [1, 2, 3, 4, 5, 6, 7].map((n) => [String(n), n === 1 ? 'Today Only' : n === 2 ? 'Today and Tomorrow' : n + ' Days']),
            onChange: (v) => set(key, +v === 2 ? null : +v) }));
          return;
        }
        var choices = self.choices(kind);
        if (card === 'scene' && kind === 'scene') choices = choices.filter((op) => op[0].indexOf('scene.') === 0);
        if (kind === 'scenes' || kind === 'calendars') {
          choices.forEach((op) => rows.push(K.check({ label: op[1], multi: true, on: (opts[key] || []).indexOf(op[0]) >= 0, onClick: (on) => {
            var list = (opts[key] || []).filter((v) => v !== op[0]); if (on) list.push(op[0]);
            if (list.length > 24) { self.say('At most 24 in a list.'); return; } set(key, list.length ? list : null);
          } })));
          return;
        }
        var auto = o.page ? 'Same as the Block' : card === 'camera' ? 'First Camera' : card === 'room' ? 'Tablet’s Room' : 'Automatic';
        var all = card === 'room' && key === 'area' && !o.page ? choices : [['', auto]].concat(choices);
        if (opts[key] && !all.some((op) => op[0] === opts[key])) all.push([opts[key], opts[key] + ' (Unavailable)']);
        rows.push(K.select({ label: label, value: opts[key] || (card === 'room' && key === 'area' && !o.page ? 'tablet_room' : ''), options: all, onChange: (v) => set(key, v) }));
      });
      return rows;
    }
    secondaryFields(value, entity, save, rows) {
      var K = this.K, mode = value && value.mode || 'auto';
      var a = (this.panel.client.states[entity] || {}).attributes || {};
      var keys = Object.keys(a).filter((k) => a[k] == null || ['string', 'number', 'boolean'].includes(typeof a[k])).sort();
      var options = keys.map((k) => [k, k.replace(/_/g, ' ')]);
      rows.push(K.select({ label: 'Line Under Name', value: mode, options: [['auto', 'Automatic'], ['state', 'State'], ['brightness', 'Brightness'], ['attribute', 'An Attribute'], ['none', 'Hidden']],
        onChange: (m) => save(m === 'auto' ? null : m === 'attribute' ? { mode: m, attribute: keys.includes('battery_level') ? 'battery_level' : keys[0] || 'friendly_name' } : { mode: m }) }));
      if (mode !== 'attribute') return;
      var key = value.attribute;
      if (!keys.includes(key)) options.push([key, key + ' (Not Reported)']);
      rows.push(K.select({ label: 'Attribute', value: key, options: options, onChange: (v) => save(Object.assign({}, value, { attribute: v })) }));
      rows.push(K.text({ label: 'Unit', value: value.unit || '', placeholder: 'Optional', maxlength: 20, onCommit: (v) => save(Object.assign({}, value, { unit: v })) }));
    }
    accessoryFields(entries, save, rows, max) {
      var K = this.K, self = this, choices = this.choices('entity');
      var put = (i, patch) => { var next = copy(entries); next[i] = Object.assign({}, next[i], patch); if (patch.secondary === null) delete next[i].secondary; save(next); };
      entries.forEach(function (entry, i) {
        var options = choices.filter((op) => op[0] === entry.entity || !entries.some((e) => e.entity === op[0]));
        if (!options.some((op) => op[0] === entry.entity)) options.push([entry.entity, entry.entity + ' (Unavailable)']);
        rows.push(K.select({ label: 'Accessory ' + (i + 1), value: entry.entity, options: options, onChange: (id) => put(i, { entity: id, secondary: null }) }));
        self.secondaryFields(entry.secondary, entry.entity, (v) => put(i, { secondary: v }), rows);
        rows.push(K.button({ label: 'Move Accessory ' + (i + 1) + ' Up', disabled: i === 0, onClick: () => { var next = copy(entries); next.splice(i - 1, 0, next.splice(i, 1)[0]); save(next); } }));
        rows.push(K.button({ label: 'Remove Accessory ' + (i + 1), destructive: true, onClick: () => { var next = copy(entries); next.splice(i, 1); save(next.length ? next : null); } }));
      });
      if (entries.length >= max) { rows.push(K.info({ label: max + ' accessories: this page is full. Add another page for more.' })); return; }
      rows.push(K.select({ label: 'Add Accessory', value: '', options: [['', 'Choose…']].concat(choices.filter((op) => !entries.some((e) => e.entity === op[0]))),
        onChange: (id) => { if (id) save(entries.concat([{ entity: id }])); } }));
    }
    surfaceFields(surface, save, rows) {
      var K = this.K;
      rows.push(K.toggle({ label: 'Custom Group Background', on: !!surface, onChange: (on) => save(on ? { color: '#808080', opacity: 30, blur: 'screen' } : null) }));
      if (!surface) return;
      var put = (key, value) => save(Object.assign({}, surface, { [key]: value }));
      rows.push(K.text({ label: 'Background Color', type: 'color', value: surface.color, onCommit: (v) => put('color', v) }));
      rows.push(K.slider({ label: 'Background Opacity', value: surface.opacity, min: 0, max: 100, unit: '%', onChange: (v) => put('opacity', Number(v)) }));
      rows.push(K.select({ label: 'Background Blur', value: surface.blur, options: [['screen', 'Follow Screen'], ['none', 'None'], ['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']], onChange: (v) => put('blur', v) }));
    }
    choices(kind) {
      var client = this.panel.client, states = client.states || {};
      if (kind === 'area') return [['tablet_room', 'Tablet’s Room']].concat(Object.keys(client.areas || {}).map((id) => [id, client.areas[id].name || id]));
      var domains = { scene: ['scene', 'script'], scenes: ['scene'], speaker: ['media_player'], climate: ['climate'], camera: ['camera'],
        timer: ['timer'], alarm: ['alarm_control_panel'], select: ['input_select', 'select'], doorbell: ['binary_sensor', 'camera'], weather: ['weather'], vacuum: ['vacuum'], calendars: ['calendar'], action: ['scene', 'script'] }[kind];
      var list = Object.keys(states).filter((id) => !domains || domains.indexOf(id.split('.')[0]) >= 0).map((id) => [id, (states[id].attributes || {}).friendly_name || id]);
      list.sort((a, b) => a[1].localeCompare(b[1]));
      if (kind === 'speaker' || kind === 'climate') list.unshift(['tablet_room', 'Tablet’s Room']);
      if (kind === 'action') list = [['lock_up', 'Lock Up'], ['lights_off', 'All Lights Off'], ['garage', 'Garage']].concat(list);
      return list;
    }
    windows(opts, set, rows) {
      var K = this.K, windows = opts.windows || [], self = this;
      windows.forEach(function (w, i) {
        var put = (key, value) => { var next = copy(windows); if (value) next[i][key] = value; else delete next[i][key]; set('windows', next); };
        rows.push(K.text({ label: 'Window ' + (i + 1), value: w.label || '', placeholder: 'Name', maxlength: 24, onCommit: (v) => put('label', v) }));
        ['start', 'end'].forEach((key) => rows.push(K.text({ label: key === 'start' ? 'From' : 'Until', type: 'time', value: w[key], onCommit: (v) => put(key, v) })));
        rows.push(K.select({ label: 'Scene or Script', value: w.scene, options: self.choices('scene'), onChange: (v) => put('scene', v) }));
        rows.push(K.button({ label: 'Remove Window ' + (i + 1), destructive: true, onClick: () => { var next = copy(windows); next.splice(i, 1); set('windows', next.length ? next : null); } }));
      });
      if (!windows.length) rows.push(K.info({ label: 'Morning, Day, Evening and Night', sub: 'Each finds its scene by name. Add a window to choose your own.' }));
      rows.push(K.button({ label: 'Add Time Window', disabled: windows.length >= 8 || !this.choices('scene').length, onClick: () => {
        set('windows', windows.concat([{ start: '05:00', end: '10:00', scene: this.choices('scene')[0][0] }]));
      } }));
    }
    async preview() {
      clearTimeout(this.previewTimer);
      if (!this.grid || !this.isConnected) return;
      var w = this.iframe.contentWindow;
      try {
        // WHAT IT IS WAITING FOR, said once it is slow (data-why), so a screen
        // that never gets there says where it stopped
        var wait = function (why) { var err = new Error('loading'); err.why = why; throw err; };
        if (!w || !w.document || w.document.readyState === 'loading') wait('the screen to load');
        if (!w.hkStrategy || !w.hkCards) wait('the screen’s code');
        if (!w.hkShell || !w.hkShell.view()) wait('the screen’s page');
        var serial = this.previewSerial = (this.previewSerial || 0) + 1;
        var client = w.hkCards.client(), draft = copy(this.grid);
        var selected = draft.items.find((it) => it.id === this.selected);
        if (selected && (selected.rules || selected.when) && typeof this.conditionPreview === 'number') selected._conditionPreview = this.conditionPreview;
        if (!client || !client.states) wait('the home’s accessories');
        var config = await w.hkStrategy.generate({ home_grid_preview: draft }, client);
        if (serial !== this.previewSerial || !this.isConnected) return;
        var old = this.previewView && this.previewView.isConnected ? this.previewView : w.hkShell.view(), cfg = config.views.find((v) => v.path === 'home');
        if (!cfg) wait('a Home page (this screen has ' + config.views.map((v) => v.path).join(', ') + ')');
        if (cfg.type !== 'custom:hk-home-grid-view') wait('Home Grid (Home was drawn as ' + cfg.type + ')');
        var el = w.document.createElement('hk-home-grid-view'); el.setConfig(cfg);
        el.cards = cfg.cards.map((c) => w.hkCards.createCard(c, client));
        // The overlay blocks pointer events; inert also blocks keyboard access to card actions.
        el.inert = true;
        if (old === this.previewView) old.replaceWith(el);
        else {
          // Keep the host's outer view: it owns tab-bar room and navigation.
          (old.shadowRoot || old).replaceChildren(el);
        }
        // The host's view lookup may still point at its cached view. Keep the preview local.
        this.previewView = el; this.previewRetries = 0; this.previewError = null;
        this.box.removeAttribute('data-loading'); this.box.removeAttribute('data-why');
        w.hkShell.announce({ detail: { replace: true } });
        if (this.previewOff) this.previewOff();
        this.previewOff = w.hkCards.onClient((next) => { el.cards.forEach((card) => w.hkHostClient.bridge(card, next)); });
        if (this.previewRO) this.previewRO.disconnect();
        this.previewRO = new w.ResizeObserver(() => this.fit()); this.previewRO.observe(el);
        this.fit();
        if (this.pickerCard) this.catalogPreviews();
      } catch (e) {
        // STILL LOADING: the preview is the whole screen in a frame, and on a
        // slow connection that takes a while (2026-10-24, the owner: it gave
        // up after 20 s and stayed blank). Keep asking, less often as it
        // goes -- its frame's load asks at once too -- and only say so.
        // A real error, or still waiting long after the frame came: say which
        // (data-why), and after ~30 s step aside to a strip at the foot, so the
        // blocks can be arranged without the live picture (fit() places them
        // on the frame's own grid then)
        var failed = !(e && e.message === 'loading');
        if (failed) console.error('[hk-grid-editor] the preview failed', e);
        this.previewError = String(e && e.message || e);
        this.previewRetries = (this.previewRetries || 0) + 1;
        this.box.setAttribute('data-why', failed ? 'It hit a problem: ' + this.previewError : 'Waiting for ' + (e.why || 'the screen'));
        this.box.setAttribute('data-loading', failed || this.previewRetries > 25 ? 'slow' : 'yes');
        this.fit();
        if (this.previewRetries < 400) this.previewTimer = setTimeout(() => this.preview(), Math.min(2000, 300 + this.previewRetries * 50));
        else this.say('The live preview couldn’t load. Reload this page to try again.');
      }
    }
    // anyway: Save Anyway, sent without the version (replaces what was saved meanwhile)
    async save(anyway) {
      if (this.busy || !this.grid || !valid(this.grid)) return;
      this.busy = true; this.saveButton.disabled = true; this.say('Saving…');
      var changed = false;
      try {
        var grid = copy(this.grid);
        var msg = { type: 'hk_frontend/board/set', dashboard: this.o.path, changes: { home_style: 'grid', home_grid: grid } };
        if (!anyway && this.version != null) msg.expect_version = this.version;
        var result = await this.panel.actions().callWS(msg);
        this.panel.data.boards[this.o.path] = result && result.board || Object.assign({}, this.o.board, { home_style: 'grid', home_grid: grid });
        keepVersion(this.panel, this.o.path, result);
        if (result && result.version != null) this.version = result.version;
        this.initial = JSON.stringify(grid); this.o.onSaved();
      } catch (e) {
        if (e && e.code === 'conflict') { changed = true; this.say(''); }
        else {
          var fields = window.hkSettingsModel.refusals(e);
          this.say('Couldn’t save. ' + (fields && fields.home_grid ? window.hkSettingsModel.errorText(fields.home_grid) : e.message || e));
        }
      } finally { this.busy = false; this.saveButton.disabled = false; }
      if (!changed) return;
      // THIS SCREEN CHANGED since the editor opened it (another window,
      // another device): nothing was saved. Reload shows it as it is now;
      // Save Anyway replaces it with this draft
      var choice = await this.changed('This screen changed since you opened it, in another window or on another device. Reload to see it as it is now (your changes here are discarded), or Save Anyway to replace it with your layout.');
      if (choice === 'anyway') return this.save(true);
      if (choice === 'reload') return this.reloadBoard();
      this.say('Not saved: this screen changed since you opened it.');
    }
  }
  window.hkGridEditor = { place: place, valid: valid, firstSpace: firstSpace, add: add, snap: snap, landing: landing };
  customElements.define('hk-grid-editor', GridEditor);
})();
