// Home Grid's desktop editor (docs/phase11/HOME-GRID.md, G5; rebuilt 2026-10-23
// around a palette): the cards on the left -- drag one onto the grid, or
// click it for its live preview and Add --, the screen in the middle, and on
// the right the selected block's settings (nothing selected: the screen's).
// The draft belongs to this element; only Save writes.
// Placement functions are pure so mouse, keyboard and the palette share refusals.
(function () {
  'use strict';
  // THE SHARED STATE (tools/split_js.py state): the variables these functions set again and again, as properties of one
  // object, so the code that sets one can live in another file. ST.x is what was the variable x.
  var ST = /** @type {Record<string, any>} */ ({});
  if (window.hkGridEditor) return;
  var G = window.hkGridCatalog, SIZES = Object.assign({}, G.SIZES);
  // FULL (F, 2026-10-30, the Cameras face): the view's whole grid. Its
  // columns and rows are the grid's, so SIZES.F is the grid last taken in
  // (sized(): the draft's, or the one a pure function is handed) and every
  // placement rule reads it as any size: at [0, 0] only, alone in its view.
  function sized(grid) {
    if (grid && grid.cols > 0 && grid.rows > 0) SIZES.F = [grid.cols, grid.rows];
    return grid;
  }
  var NAMES = { accessory: 'Accessory', accessories: 'Accessory Group', scene: 'Scene', scenes: 'Scenes', now_playing: 'Now Playing',
    thermostat: 'Thermostat', camera: 'Camera', security: 'Security', timers: 'Timers', weather: 'Weather',
    calendar: 'Calendar', battery: 'House Battery', people: 'People', vacuum: 'Vacuum', laundry: 'Laundry', tv: 'TV', swipe: 'Swipe', clock: 'Clock',
    room: 'Room', scene_suggested: 'Suggested Scene', action: 'Action', everything: 'Everything', cameras: 'Cameras',
    power: 'Power', music: 'Music', doors: 'Doors & Locks', live_tv: 'Live TV', water: 'Water',
    on_now: 'On Now', todo: 'To-do', energy_rings: 'Energy Rings', timeline: 'Recent', intercom: 'Intercom', house_status: 'House Status', alert: 'Alert' };
  var MAP_SUB = 'Extra Large: where everyone is, on a map, for anyone who can see this screen.';   // (Who's Home's Show Map says so: mockup 13b)
  var SIZE_NAMES = { XS: 'Tiny', S: 'Small', W: 'Wide', C: 'Compact', T: 'Tall', L: 'Large', XL: 'Extra Large', XXL: 'Full Width', F: 'Full View' };
  // a size on a chip or a segment, short enough for four in a row
  var SIZE_SHORT = { XS: 'Tiny', S: 'Small', W: 'Wide', C: 'Compact', T: 'Tall', L: 'Large', XL: 'X\u2011Large', XXL: 'Full', F: 'Full View' };
  // TINY (XS, 2026-11-08): half a cell, at[2] 1 its bottom half -- the places here count in half rows: a Tiny block one, the rest two
  function y2(it) { return it.at[1] * 2 + (it.size === 'XS' && it.at[2] ? 1 : 0); }
  function h2(size) { return size === 'XS' ? 1 : SIZES[size][1] * 2; }
  function atY2(size, col, y) { return size === 'XS' && y % 2 ? [col, (y - 1) / 2, 1] : [col, y >> 1]; }
  // C, Compact (2026-11-07): 3 x 1, Security's HomeView presentation's alone (home_grid.py _security_size); a new one carries that presentation from the start, which valid() asks for (2026-11-09, the
  // owner: Add did nothing for a free 3 x 1)
  function born(item) { if (item.card === 'security' && item.size === 'C') item.opts = { presentation: 'homeview' }; return item; }
  function offersSize(card, size, opts) { return size !== 'C' || (card === 'security' && (opts || {}).presentation === 'homeview'); }
  // EVERY CATALOG KEY IS IN ONE OF THESE (2026-10-31, the owner: On Now, To-do and Energy Rings were missing from the
  // card list -- the list is drawn from GROUPS, so a block added to the catalog and not here was never offered, in
  // this editor or in Edit mode's Add). tests/test_grideditor.js holds the two equal, name, description and glyph
  // included. On Now sits with the lights it turns off; Energy Rings beside Power and Water.
  var GROUPS = [
    ['Rooms & Lights', ['room', 'accessory', 'accessories', 'action', 'on_now']], ['Scenes', ['scene', 'scenes', 'scene_suggested']],
    ['Climate', ['thermostat', 'weather']], ['Music', ['now_playing', 'music', 'tv', 'live_tv', 'intercom']],
    ['Security & Cameras', ['security', 'doors', 'camera', 'cameras']],
    ['Info', ['house_status', 'alert', 'swipe', 'clock', 'timers', 'calendar', 'todo', 'battery', 'power', 'energy_rings', 'water', 'people', 'vacuum', 'laundry', 'timeline', 'everything']]
  ];
  var DESCRIPTIONS = { room: 'Your room’s lights, fans and speaker', accessory: 'One light, switch or other accessory', accessories: 'Accessories you choose, in swipe pages',
    action: 'One tap for a household job', scene: 'Set a favorite scene', scenes: 'Your scenes together',
    scene_suggested: 'The right scene for the time of day', thermostat: 'Temperature and climate; Extra Large has every control',
    weather: 'Current conditions and the forecast', now_playing: 'Music and playback controls', security: 'The alarm, locks and doors; Large is the keypad',
    camera: 'One camera, or swipe between cameras', cameras: 'Up to nine cameras at once; Full View fills the page', clock: 'Digital or analog, with or without its box',
      timers: 'Timers and quick starts',
    calendar: 'Your upcoming events', battery: 'Your home’s stored energy', people: 'Who is home', vacuum: 'Cleaning status; Large adds controls and Clean Areas',
      laundry: 'Your washer and dryer: what each is doing and when it’s done', tv: 'A room’s TV and Apple TV: what’s on, your apps, the volume and a remote',
      swipe: 'Cards to swipe between, each with its own settings',
    everything: 'Open the screen’s full menu', power: 'Solar, the house, the battery and the grid right now',
    music: 'Choose speakers, then a playlist', doors: 'Locks, doors, windows and the garage', live_tv: 'Your channels; tap one to watch',
    water: 'Today’s water; Extra Large adds the main supply',
    on_now: 'What’s on in the house, and a way to turn it off', todo: 'A to-do list; tick items off', energy_rings: 'The Energy page’s rings: today, this week or this month',
    intercom: 'Speak a message into the rooms you pick',
    timeline: 'What just happened at the house; in the morning, how the night went',
    house_status: 'Your status chips at a glance; each opens its page', alert: 'Something that needs a look, its camera and one action: for Show When' };
  var GLYPHS = { room: 'mdi:sofa', accessory: 'mdi:lightbulb', accessories: 'mdi:view-grid', action: 'mdi:gesture-tap', scene: 'mdi:palette',
    scenes: 'mdi:palette', scene_suggested: 'mdi:weather-sunset', thermostat: 'mdi:thermostat', weather: 'mdi:weather-partly-cloudy',
    now_playing: 'mdi:music', security: 'mdi:shield-home', camera: 'mdi:camera', cameras: 'mdi:cctv', clock: 'mdi:clock', timers: 'mdi:timer-outline',
    calendar: 'mdi:calendar', battery: 'mdi:home-battery', people: 'mdi:account', vacuum: 'mdi:robot-vacuum', laundry: 'mdi:washing-machine', tv: 'mdi:television',
      swipe: 'mdi:gesture-swipe-horizontal', everything: 'mdi:dots-horizontal',
    power: 'mdi:lightning-bolt', music: 'mdi:speaker-multiple', doors: 'mdi:door-closed-lock', live_tv: 'mdi:television-classic', water: 'mdi:water',
    on_now: 'mdi:lightbulb-on', todo: 'mdi:clipboard-check', energy_rings: 'mdi:lightning-bolt', timeline: 'mdi:history', intercom: 'mdi:microphone', house_status: 'mdi:home',
      alert: 'mdi:alert-circle' };
  // AN OPTION'S NAME in the panel: by its kind (hk-grid-catalog.js opts), else by its own name
  var KIND_LABELS = { entity: 'Accessory', climate: 'Thermostat', camera: 'Camera', weather: 'Weather', vacuum: 'Vacuum',
    speaker: 'Speaker', scene: 'Scene', scenes: 'Scenes', calendars: 'Calendars', area: 'Room', action: 'Does', windows: 'Time Windows', alarm: 'Alarm',
    cameras: 'Cameras', refresh: 'Refresh', todo: 'List' };
  var RULE_MARK = '#rule:';                 // (a block's id has no # in it: hk_core ITEM_ID)
  var NAME_LABELS = { sky: 'Sky Background', title: 'Group Name', clock_style: 'Style', bare: 'Hide Box', big: 'Big Temperature', month: 'Month View', color: 'Color', map: 'Show Map' };
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
    entity_state: 'An Accessory’s State', time: 'A Time of Day', solar_window: 'A Solar Window', tv_on: 'A TV Is On' };
  // THE STARTER LAYOUTS (hk_core home_grid.STARTERS: the same keys), each
  // shown as a small map of the blocks it would put on this screen
  var STARTERS = [['A', 'Tap Weight', 'What you touch most is biggest'], ['C', 'Glance Up, Touch Down', 'Readings above, controls below'],
    ['R', 'Room Focus', 'This room up front, with its climate and music'], ['M', 'Music & Scenes', 'Music, scenes and the scene for now'],
    ['S', 'Security & Cameras', 'Cameras large, with locks and the alarm'], ['F', 'Family Hub', 'The calendar, who’s home and timers'],
    ['Q', 'Essentials', 'A calm few: the room, scenes and weather'], ['empty', 'Start Empty', 'A blank grid to fill yourself']];
  // a block's color on the map: its palette group's
  var GROUP_TINT = { 'Rooms & Lights': 'var(--hk-orange)', Scenes: 'var(--hk-tint)', Climate: 'var(--hk-green)', Music: 'var(--hk-red)',
    'Security & Cameras': 'var(--hk-gray)', Info: 'var(--hk-label3)' };
  // A BLOCK ONLY SOME HOSTS HAVE: Recent is the House Timeline's, a record only some hosts keep (hkShell.hostPage). It is in the
  // catalog and in GROUPS, as every block is, and offered only where the host has the page: never in Home Assistant's
  // HK Frontend, and not to a person whose role has no Timeline.
  var HOST_ONLY = { timeline: 'timeline' };
  function offered(card) { return !HOST_ONLY[card] || G.hostHas(HOST_ONLY[card]); }
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
  ST.VIEW = 0;
  function overlap(a, b) {
    if ((a.view || 0) !== (b.view || 0)) return false;
    var x = SIZES[a.size], y = SIZES[b.size];
    return a.at[0] < b.at[0] + y[0] && b.at[0] < a.at[0] + x[0] &&
      y2(a) < y2(b) + h2(b.size) && y2(b) < y2(a) + h2(a.size);
  }
  function fits(grid, item) {
    sized(grid);
    var z = SIZES[item.size];
    return !!z && item.at.every(Number.isInteger) && item.at[0] >= 0 && item.at[1] >= 0 && (item.at.length === 2 || (item.size === 'XS' && item.at.length === 3 && item.at[2] === 1)) &&
      item.at[0] + z[0] <= grid.cols && item.at[1] + z[1] <= grid.rows;
  }
  function valid(grid) {
    return COLS.indexOf(grid.cols) >= 0 && Number.isInteger(grid.rows) && grid.rows >= 2 && grid.rows <= 6 &&
      grid.frame.length === 2 && Number.isInteger(grid.frame[0]) && Number.isInteger(grid.frame[1]) &&
      grid.frame[0] >= 320 && grid.frame[0] <= 3840 && grid.frame[1] >= 320 && grid.frame[1] <= 2160 &&
      grid.items.length <= 24 && grid.items.every(function (it, i) {
        var cat = G.table()[it.card];
        if ((it.view || 0) >= (grid.views || 1)) return false;
        return cat && cat.sizes.indexOf(it.size) >= 0 && offersSize(it.card, it.size, it.opts) &&
          (!it.when || it.fallback && G.table()[it.fallback.card] && G.table()[it.fallback.card].sizes.includes(it.size)) &&
          G.rulesFit(it) && fits(grid, it) &&
          !grid.items.slice(i + 1).some(function (other) { return it.id === other.id || overlap(it, other); });
      });
  }
  // A move may swap exactly one block of the same class. A resize never swaps.
  // (A drag or an arrow key makes room instead, makeRoom(); 2026-10-30.)
  function place(grid, id, at, size) {
    var out = copy(grid), item = out.items.find(function (it) { return it.id === id; });
    if (!item || !SIZES[size || item.size]) return null;
    var old = copy(item), resizing = size && size !== item.size;
    item.size = size || item.size; item.at = at.slice(0, item.size === 'XS' ? 3 : 2);
    if (!fits(out, item)) return null;
    var hit = out.items.filter(function (it) { return it.id !== id && overlap(item, it); });
    if (hit.length) {
      if (resizing || hit.length !== 1 || hit[0].size !== item.size) return null;
      hit[0].at = old.at;
    }
    return valid(out) ? out : null;
  }
  // MAKING ROOM (2026-10-30, the owner: "As I move the block, the tiles that
  // become free, the tiles that get overlapped, move to those free spots", as
  // an iPad's Home Screen does): the block goes to `at`, and every block it
  // lands on moves out of its way, within its own view and never resized.
  // Where they go, the first of these that works:
  //   1. the space the block left, all of them together as they were (one
  //      block of the same size: the swap there always was);
  //   2. each on its own: into that space where it fits, else the free place
  //      nearest its old one in reading order;
  //   3. the fewest other blocks moved aside to make the room (one, then two),
  //      the least far; and last the view's other blocks laid out again in
  //      reading order round the block where it was put.
  // -> the new layout, or null: there is no way, and the block stays.
  // A resize never makes room (place()).
  function makeRoom(grid, id, at) {
    var out = copy(grid), me = out.items.find(function (it) { return it.id === id; });
    if (!me || !at || !SIZES[me.size] || !fits(out, { size: me.size, at: at })) return null;
    var from = me.at.slice(), view = me.view || 0;
    me.at = at.slice();
    if (from[0] === at[0] && from[1] === at[1] && (from[2] | 0) === (at[2] | 0)) return out;
    var mine = out.items.filter(function (it) { return it !== me && (it.view || 0) === view; });
    var hit = mine.filter(function (it) { return overlap(me, it); });
    var stay = mine.filter(function (it) { return hit.indexOf(it) < 0; });
    var plan = !hit.length ? [] : together(me, from, hit) || settle(out, me, from, hit, [], stay) ||
      aside(out, me, from, hit, stay) || inOrder(out, me, mine);
    if (!plan) return null;
    plan.forEach(function (p) { p[0].at = p[1]; });
    return valid(out) ? out : null;
  }
  function cssId(id) { return window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'); }
  function readAt(grid, at) { return (at[1] * 2 + (at[2] ? 1 : 0)) * grid.cols + at[0]; }
  // the cells a view's blocks take, as a list a cell each (row by row)
  function taken(grid, items) {
    var t = [];
    sized(grid);
    for (var i = 0; i < grid.cols * grid.rows * 2; i++) t.push(false);
    items.forEach(function (it) { mark(grid, t, it.size, it.at, true); });
    return t;
  }
  function mark(grid, t, size, at, on) {
    var z = SIZES[size], y0 = y2({ size: size, at: at });
    for (var y = y0; y < y0 + h2(size); y++) for (var x = at[0]; x < at[0] + z[0]; x++) t[y * grid.cols + x] = on;
  }
  // every place a block of `size` fits among the cells not taken, in reading order
  function spots(grid, t, size) {
    var z = SIZES[size], hh = h2(size), out = [];
    for (var row = 0; row + hh <= grid.rows * 2; row += size === 'XS' ? 1 : 2) for (var col = 0; col + z[0] <= grid.cols; col++) {
      var clear = true;
      for (var y = row; clear && y < row + hh; y++) for (var x = col; x < col + z[0]; x++) if (t[y * grid.cols + x]) { clear = false; break; }
      if (clear) out.push(atY2(size, col, row));
    }
    return out;
  }
  // 1. the blocks landed on, as they were, into the space the block left (the nearest way there)
  function together(me, from, hit) {
    var z = SIZES[me.size], x0 = Infinity, y0 = Infinity, x1 = 0, y1 = 0, best = null, f2 = y2({ size: me.size, at: from });
    hit.forEach(function (it) {
      var s = SIZES[it.size];
      x0 = Math.min(x0, it.at[0]); y0 = Math.min(y0, y2(it)); x1 = Math.max(x1, it.at[0] + s[0]); y1 = Math.max(y1, y2(it) + h2(it.size));
    });
    for (var y = f2; y + y1 - y0 <= f2 + h2(me.size); y++) for (var x = from[0]; x + x1 - x0 <= from[0] + z[0]; x++) {
      var dx = x - x0, dy = y - y0, d = Math.abs(dx) + Math.abs(dy) / 2;
      if (hit.some(function (it) { return it.size !== 'XS' && dy % 2; })) continue;          // (only a Tiny block moves by half a row)
      var moved = hit.map(function (it) { return [it, atY2(it.size, it.at[0] + dx, y2(it) + dy)]; });
      if (moved.some(function (m) { return overlap(me, { size: m[0].size, at: m[1], view: me.view }); })) continue;
      if (!best || d < best.d) best = { d: d, plan: moved };
    }
    return best && best.plan;
  }
  // 2. each block that has to go, the largest first, at the first place that
  // works in its order of preference: the space the block left (the blocks
  // landed on), then the nearest in reading order to where it was; trying the
  // next place for an earlier block when a later one has nowhere (a bounded
  // search). `extra` are blocks moved aside (3): only the nearest for them.
  function settle(grid, me, from, hit, extra, fixed, budget) {
    var z = SIZES[me.size], t = taken(grid, [me].concat(fixed)), left = budget || 4000, plan = [];
    var area = function (it) { var s = SIZES[it.size]; return s[0] * s[1]; };
    var order = hit.slice().sort(function (a, b) { return area(b) - area(a) || readAt(grid, a.at) - readAt(grid, b.at); }).concat(extra);
    var inGone = function (at, size) {
      var s = SIZES[size], a2 = y2({ size: size, at: at }), f2 = y2({ size: me.size, at: from });
      return at[0] >= from[0] && a2 >= f2 && at[0] + s[0] <= from[0] + z[0] && a2 + h2(size) <= f2 + h2(me.size);
    };
    var go = function (i) {
      if (i === order.length) return true;
      if (--left < 0) return false;
      var it = order[i], own = readAt(grid, it.at), back = hit.indexOf(it) >= 0;
      var places = spots(grid, t, it.size).map(function (p) {
        return [p, back && inGone(p, it.size) ? 0 : 1, Math.abs(readAt(grid, p) - own), Math.hypot(p[0] - it.at[0], p[1] - it.at[1])];
      }).sort(function (a, b) { return a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || readAt(grid, a[0]) - readAt(grid, b[0]); });
      for (var k = 0; k < places.length; k++) {
        var p = places[k][0];
        mark(grid, t, it.size, p, true); plan.push([it, p]);
        if (go(i + 1)) return true;
        plan.pop(); mark(grid, t, it.size, p, false);
      }
      return false;
    };
    if (!go(0)) return null;
    // (blocks of one size that had to go keep their reading order among the places they got: two small
    // tiles side by side stay that way round)
    var sized = {};
    plan.forEach(function (p) { if (hit.indexOf(p[0]) >= 0) (sized[p[0].size] = sized[p[0].size] || []).push(p); });
    Object.keys(sized).forEach(function (k) {
      var ps = sized[k], places = ps.map(function (p) { return p[1]; }).sort(function (a, b) { return readAt(grid, a) - readAt(grid, b); });
      ps.sort(function (a, b) { return readAt(grid, a[0].at) - readAt(grid, b[0].at); }).forEach(function (p, i) { p[1] = places[i]; });
    });
    return plan;
  }
  // 3. the room made by moving one other block aside, else two: those
  // nearest where the block went are tried, and of the ways that work the
  // one that moves blocks least far wins
  function aside(grid, me, from, hit, stay) {
    var z = SIZES[me.size], cx = me.at[0] + z[0] / 2, cy = me.at[1] + z[1] / 2;
    var near = stay.slice().sort(function (a, b) {
      var s = SIZES[a.size], u = SIZES[b.size];
      return Math.hypot(a.at[0] + s[0] / 2 - cx, a.at[1] + s[1] / 2 - cy) - Math.hypot(b.at[0] + u[0] / 2 - cx, b.at[1] + u[1] / 2 - cy);
    });
    var cost = function (plan) { return plan.reduce(function (n, p) { return n + Math.abs(p[1][0] - p[0].at[0]) + Math.abs(p[1][1] - p[0].at[1]); }, 0); };
    var sets = [near.slice(0, 10).map(function (b) { return [b]; }), []];
    near.slice(0, 8).forEach(function (a, i) { near.slice(i + 1, 8).forEach(function (b) { sets[1].push([a, b]); }); });
    for (var n = 0; n < sets.length; n++) {
      var best = null;
      sets[n].forEach(function (extra) {
        var plan = settle(grid, me, from, hit, extra, stay.filter(function (it) { return extra.indexOf(it) < 0; }), 1500);
        if (plan && (!best || cost(plan) < cost(best))) best = plan;
      });
      if (best) return best;
    }
    return null;
  }
  // ...and last: every other block of the view in reading order, each where
  // it is while that's free, else at the free place nearest it in reading
  // order (so one pushes the next along); failing that, each at the first
  // place left (the view laid out again in reading order)
  function inOrder(grid, me, mine) {
    var order = mine.slice().sort(function (a, b) { return readAt(grid, a.at) - readAt(grid, b.at); });
    var lay = function (keep) {
      var t = taken(grid, [me]), plan = [];
      for (var i = 0; i < order.length; i++) {
        var it = order[i], own = readAt(grid, it.at), places = spots(grid, t, it.size);
        if (keep) places.sort(function (a, b) {
          return Math.abs(readAt(grid, a) - own) - Math.abs(readAt(grid, b) - own) ||
            Math.hypot(a[0] - it.at[0], a[1] - it.at[1]) - Math.hypot(b[0] - it.at[0], b[1] - it.at[1]) || readAt(grid, a) - readAt(grid, b);
        });
        if (!places.length) return null;
        mark(grid, t, it.size, places[0], true); plan.push([it, places[0]]);
      }
      return plan;
    };
    return lay(true) || lay(false);
  }
  function firstSpace(grid, size, view) {
    sized(grid);
    for (var row = 0; row < grid.rows; row++) for (var col = 0; col < grid.cols; col++) for (var hf = 0; hf < (size === 'XS' ? 2 : 1); hf++) {
      var it = { size: size, at: hf ? [col, row, 1] : [col, row], view: view === undefined ? ST.VIEW : view };   // (a Tiny: a cell's free half, top first)
      if (fits(grid, it) && !grid.items.some(function (x) { return overlap(it, x); })) return it.at;
    }
    return null;
  }
  // SCREEN TYPES (2026-10-24, the owner): the grid that suits a kind of
  // screen, from the grid's own fit (196 x 150 px tiles, the whole grid
  // scaled to the screen, never enlarged; docs/phase11/HOME-GRID.md, "Screen
  // types"). [key, name, columns, rows, top band, preview size, cell shape]
  // SQUARE (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase A): a screen that
  // really is square -- 3 x 3 square cells, no band, filling the screen, its
  // canvas 14 px from the glass and its corner blocks rounded with it
  // (`screen: square` on the grid).
  var SCREEN_TYPES = [
    ['phone_portrait', 'Phone, Portrait', 2, 5, false, [390, 844], 'tile'],
    ['phone_landscape', 'Phone, Landscape', 3, 2, false, [844, 390], 'tile'],
    ['tablet_portrait', 'Tablet, Portrait', 3, 6, true, [820, 1180], 'tile'],
    ['tablet_landscape', 'Tablet, Landscape', 6, 4, true, [1180, 820], 'tile'],
    ['large_tablet', 'Large Tablet', 6, 5, true, [1376, 1032], 'tile'],
    ['car', 'Car', 6, 3, true, [1280, 720], 'tile'],
    ['square', 'Square', 3, 3, false, [800, 800], 'square']
  ];
  // a grid's cells: their size, gap and (a Square screen's) edge -- hk-grid-catalog.js CELLS
  // A SAMPLE'S ENTITIES: of these domains in this order, each with a name a person gave (no radio address "0x00158d008...", 2026-11-09)
  var rawName = function (op) { var t = String(op[1] || op[0]).replace(/^[a-z_]+\./, ''); return /^0x[0-9a-f]/i.test(t) || (/^[0-9a-f]{8,}\b/i.test(t) && /\d/.test(t.split(/\s/)[0])) ||
    !/[a-z]{3}/i.test(t); };
  function sampleEntities(choices, domains) { return domains.reduce(function (out, d) { return out.concat(choices.filter(function (op) { return op[0].indexOf(d + '.') === 0 && !rawName(op); })); },
    []); }
  function cellOf(grid) { return G.CELLS[grid && grid.cell === 'square' ? 'square' : 'tile']; }
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
  // (any cell shape on a type's grid is that type -- square cells on a wide
  // tablet are still a wide tablet's -- but Square is a square screen's own)
  // HOMEVIEW-STYLE STARTERS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md
  // Phase A): square cells and Centred tiles, hand-written as the
  // nightstand's are and filled from the house (squareHouse below) -- its
  // room's thermostat in Big Number, the Analog Numbers clock on the
  // wallpaper, then its scenes, the front door's lock and the room's lights.
  // A block the house has nothing for is left out. By screen type: [key,
  // name, what it is, the grid's shape, its blocks as [what, size, at]].
  // HOME WITH PANE, the recommended landscape starter, goes first: a 3 x 3 of
  // square tiles filling the height, beside the screen's Side Pane (Phase A2)
  // -- its sixth field asks for the pane (paneForStarter below)
  var SQUARE_STARTERS = {
    tablet_landscape: [
      ['sq_pane', 'Home with Pane', 'The recommended landscape layout: a 3 × 3 of square tiles beside the Side Pane, with the weather, the calendar and what’s playing.',
        { cols: 3, rows: 3, band: false, grow: true },
        [['thermostat', 'L', [0, 0]], ['clock', 'S', [2, 0]], ['scene', 'S', [2, 1]], ['scene', 'S', [0, 2]], ['lock', 'S', [1, 2]], ['light', 'S', [2, 2]]],
        { pane: true }],
      ['sq_6x4', 'Square, 6 × 4', 'Square cells with centered tiles, as on a HomeView. The text is smaller than today’s.',
        { cols: 6, rows: 4, band: false },
        [['thermostat', 'L', [0, 0]], ['clock', 'S', [2, 0]], ['weather', 'W', [3, 0]], ['lock', 'S', [5, 0]],
         ['scene', 'S', [2, 1]], ['camera', 'L', [3, 1]], ['light', 'S', [5, 1]],
         ['scene', 'S', [0, 2]], ['fan', 'S', [1, 2]], ['more', 'S', [2, 2]], ['more', 'S', [5, 2]],
         ['more', 'S', [0, 3]], ['more', 'S', [1, 3]], ['more', 'S', [2, 3]], ['more', 'S', [3, 3]], ['more', 'S', [4, 3]], ['more', 'S', [5, 3]]]]],
    tablet_portrait: [
      ['sq_3x5', 'Square, 3 × 5', 'Square cells with centered tiles, as on a HomeView',
        { cols: 3, rows: 5, band: false },
        [['thermostat', 'L', [0, 0]], ['clock', 'S', [2, 0]], ['scene', 'S', [2, 1]], ['weather', 'W', [0, 2]], ['lock', 'S', [2, 2]],
         ['camera', 'L', [0, 3]], ['light', 'S', [2, 3]], ['fan', 'S', [2, 4]]]]],
    phone_portrait: [
      ['sq_2x4', 'Square, 2 × 4', 'Square cells with centered tiles, as on a HomeView',
        { cols: 2, rows: 4, band: false, grow: true },
        [['thermostat', 'T', [0, 0]], ['clock', 'S', [1, 0]], ['lock', 'S', [1, 1]], ['light', 'S', [0, 2]], ['scene', 'S', [1, 2]],
         ['scene', 'S', [0, 3]], ['fan', 'S', [1, 3]]]]],
    square: [
      ['sq_homeview', 'HomeView-style', 'The thermostat large, the clock, then scenes, the lock and the lights',
        { cols: 3, rows: 3, band: false, screen: 'square', grow: true, frame: [800, 800] },
        [['thermostat', 'L', [0, 0]], ['clock', 'S', [2, 0]], ['scene', 'S', [2, 1]], ['scene', 'S', [0, 2]], ['lock', 'S', [1, 2]], ['light', 'S', [2, 2]]]]]
  };
  // the blocks drawn as tiles, which take a Tile Style of their own
  var TILE_CARDS = ['accessory', 'scene', 'action'];
  // ONE SQUARE STARTER on `grid` (the screen's: its frame), from `house`
  // ({ climate, scenes, lock, light, fan, more, weather, camera }: what is
  // left to place, each taken once)
  function squareStarter(c, grid, house) {
    var h = copy(house), items = [];
    var take = function (k) { return (h[k] || []).shift() || null; };
    c[4].forEach(function (b) {
      var what = b[0], size = b[1], at = b[2].slice(), it = null, id;
      if (what === 'thermostat' && h.climate) it = { card: 'thermostat', opts: { entity: h.climate, style: 'big' } };
      else if (what === 'clock') it = { card: 'clock', opts: { clock_style: 'numbers' }, bare: true };
      else if (what === 'weather' && h.weather) it = { card: 'weather' };
      else if (what === 'camera' && h.camera) it = { card: 'camera', pages: { source: 'cameras' } };
      else if (what === 'scene' && (id = take('scenes'))) it = { card: 'scene', opts: { scene: id }, tile: 'centred' };
      else if (what === 'lock' && h.lock) it = { card: 'accessory', opts: { entity: h.lock }, tile: 'centred' };
      else if ((what === 'light' || what === 'fan' || what === 'more') && (id = take(what) || (what !== 'more' ? null : take('light')))) {
        it = { card: 'accessory', opts: { entity: id }, tile: 'centred' };
      }
      if (it) items.push(Object.assign({ id: 'h' + (items.length + 1), size: size, at: at }, it));
    });
    // (the screen's grid otherwise as it is: its header, its night, its scale)
    var out = Object.assign(copy(grid || EMPTY), copy(c[3]), { cell: 'square', items: items });
    delete out.views;
    if (!c[3].screen) delete out.screen;
    return out;
  }
  // THE SIDE PANE A STARTER ASKS FOR (Home with Pane): the screen's change, or
  // null when it already shows a pane on Home -- its own groups kept, the
  // Dashboard's group the plan's default (Weather, Calendar, Now Playing while
  // it plays) on Home
  var PANE_FOR_HOME = { show: 'home', sections: [{ kind: 'weather', size: 'more' }, { kind: 'calendar', size: 'more' },
                                                  { kind: 'now_playing', size: 'more', when: 'active' }] };
  function paneForStarter(c, board) {
    if (!c || !c[5] || !c[5].pane) return null;
    var read = board && board.side_pane_read, dash = read && read.dashboard;
    if (dash && dash.show && dash.show !== 'off') return null;
    return Object.assign(copy((board && board.side_pane) || {}), { dashboard: copy(PANE_FOR_HOME) });
  }
  // COLUMNS (hk_core home_grid.COLS; 4 and 5 since 2026-10-30)
  var COLS = [6, 5, 4, 3, 2];
  // ...and on square cells HOW MANY COLUMNS FIT AT FULL SIZE: the rows come
  // from the height (the cells as big as the rows let them be), and each
  // column more extends the grid sideways at that size while the width --
  // the frame, less the Side Pane beside it where the screen shows one
  // (about 400 px) -- holds it; past that the whole grid gets smaller (the
  // owner, 2026-10-30: 5 columns once made the rows 5 too, squeezed into
  // the 4 x 4's square). hk-layout.js _measure scales by whichever runs out.
  function fullColumns(grid, board) {
    var f = (grid && grid.frame) || [1280, 800], w = f[0], hgt = f[1], c = cellOf(grid);
    var read = board && board.side_pane_read, dash = read && read.dashboard;
    if (dash && dash.show && dash.show !== 'off' && w > hgt) w -= 400;
    var pad = grid.screen === 'square' && c.edge ? c.edge : 1280 * 0.015 + 8;
    var gh = grid.rows * c.h + (grid.rows - 1) * c.gap + 2 * pad + (grid.band ? 60 + c.gap : 0);
    var s = Math.min(grid.grow ? Infinity : 1, hgt / gh);
    return Math.max(1, Math.floor((w / s - 2 * pad + c.gap) / (c.w + c.gap)));
  }
  function screenTypeOf(grid) {
    var t = grid && SCREEN_TYPES.find(function (x) {
      return x[2] === grid.cols && x[3] === grid.rows && x[4] === !!grid.band && (x[0] === 'square') === (grid.screen === 'square');
    });
    return t ? t[0] : 'custom';
  }
  // A LAYOUT ON ANOTHER GRID: its blocks in reading order, each at the first
  // place it fits, so they keep their order; a block wider than the grid, or
  // with no room left, is left out. -> { grid, left: [items] }
  function reflow(grid, cols, rows) {
    var out = copy(grid), left = [];
    out.cols = cols; out.rows = rows; out.items = [];
    sized(out);
    copy(grid.items).sort(function (a, b) { return (a.at[1] - b.at[1]) || (a.at[0] - b.at[0]); }).forEach(function (it) {
      var at = SIZES[it.size] && SIZES[it.size][0] <= cols ? firstSpace(out, it.size, it.view || 0) : null;
      if (!at) { left.push(it); return; }
      it.at = at; out.items.push(it);
    });
    return { grid: out, left: left };
  }
  // how large a block shows on a screen of `frame` (its share of full size)
  // (the grid's own cells: hk-grid-catalog.js CELLS, as hk-home-grid-view measures them)
  function scaleAt(grid, frame) {
    var c = cellOf(grid), pad = grid.screen === 'square' && c.edge ? c.edge : 1280 * 0.015 + 8;
    var w = grid.cols * c.w + (grid.cols - 1) * c.gap + 2 * pad;
    var h = grid.rows * c.h + (grid.rows - 1) * c.gap + 2 * pad + (grid.band ? 60 + c.gap : 0);
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
    var r2 = Math.max(0, Math.min(rows * 2 - 1, Math.floor((y - rect.top) / (ch + gap) * 2)));          // (a Tiny one: the half under the pointer)
    return size === 'XS' ? atY2('XS', Math.max(0, Math.min(cols - 1, Math.floor((x - rect.left) / (cw + gap)))), r2) : [Math.max(0, Math.min(cols - z[0], c)), Math.max(0, Math.min(rows - z[1], r))];
  }
  // WHY A BLOCK CAN'T TAKE A SIZE whatever room there is round it (its
  // pages, its rules' cards), in words; null: it can (the dashboard's Edit
  // mode asks too, hk-edit-grid.js)
  function cannotResize(item, sz) {
    var holds = G.perPage(Object.assign({}, item, { size: sz }));
    if (item.card === 'accessories' && item.pages && item.pages.source === 'list' && item.pages.list.some(function (pg) { return ((pg.opts || {}).accessories || []).length > holds; })) {
      return 'A ' + SIZE_NAMES[sz] + ' page holds ' + holds + ' accessories. Move some to another page, or choose Automatic Pages, first.';
    }
    var misfit = (item.rules || []).find(function (r) { return !G.table()[r.card].sizes.includes(sz); });
    if (misfit) return 'A rule’s card, ' + NAMES[misfit.card] + ', doesn’t come in ' + SIZE_NAMES[sz] + '. Change or remove that rule first.';
    return null;
  }
  function add(grid, card, size, at) {
    if (grid.items.length >= 24) return null;
    var out = copy(grid), n = 1;
    while (out.items.some(function (it) { return it.id === 'b' + n; })) n++;
    var item = born({ id: 'b' + n, card: card, size: size, at: at || firstSpace(grid, size) });
    if (ST.VIEW) item.view = ST.VIEW;
    if (!item.at) return null;
    out.items.push(item);
    return valid(out) ? out : null;
  }
  // A CARD DROPPED WHERE THERE IS NO ROOM (2026-10-31, the owner: "if there's no room for the card, let me drag it
  // onto the grid anyway ... it replaces the blocks it covers"): a new block of `card` at `size` goes to `at`, in
  // `view` (the editor's own when none is given), by the first of
  //   1. nothing in the way: it goes there;
  //   2. the blocks in the way moved to free places, as a dragged block makes room (makeRoom's steps 2 and 3 --
  //      there is no space it left, as a block being moved leaves one): nothing is lost while there is room;
  //   3. the blocks it covers removed, and it takes their cells -- only the ones it covers.
  // -> { grid, moved: [ids moved aside], removed: [the blocks that went] }, or null: it doesn't fit the grid at all
  // (or the layout is full and nothing is covered).
  function addOver(grid, card, size, at, view) {
    var z = SIZES[size], v = view === undefined ? ST.VIEW : view || 0;
    if (!z || !at || !fits(grid, { size: size, at: at })) return null;
    var fresh = function () {
      var out = copy(grid), n = 1;
      while (out.items.some(function (it) { return it.id === 'b' + n; })) n++;
      var item = born({ id: 'b' + n, card: card, size: size, at: at.slice() });
      if (v) item.view = v;
      return { out: out, item: item };
    };
    var a = fresh(), hit = a.out.items.filter(function (it) { return (it.view || 0) === v && overlap(a.item, it); });
    if (!hit.length) {
      if (grid.items.length >= 24) return null;
      a.out.items.push(a.item);
      return valid(a.out) ? { grid: a.out, moved: [], removed: [] } : null;
    }
    if (grid.items.length < 24) {
      var mine = a.out.items.filter(function (it) { return (it.view || 0) === v; }), stay = mine.filter(function (it) { return hit.indexOf(it) < 0; });
      var was = {};
      mine.forEach(function (it) { was[it.id] = it.at.slice(); });
      a.out.items.push(a.item);
      // (`from` is off the grid: no space was left, so none of the blocks goes "back" into it)
      var gone = [-9, -9];
      var plan = settle(a.out, a.item, gone, hit, [], stay) || aside(a.out, a.item, gone, hit, stay) || inOrder(a.out, a.item, mine);
      if (plan) {
        plan.forEach(function (p) { p[0].at = p[1]; });
        if (valid(a.out)) {
          return { grid: a.out, removed: [], moved: mine.filter(function (it) { return it.at[0] !== was[it.id][0] || it.at[1] !== was[it.id][1]; }).map(function (it) { return it.id; }) };
        }
      }
    }
    var b = fresh(), covered = b.out.items.filter(function (it) { return (it.view || 0) === v && overlap(b.item, it); });
    b.out.items = b.out.items.filter(function (it) { return covered.indexOf(it) < 0; });
    b.out.items.push(b.item);
    return valid(b.out) ? { grid: b.out, moved: [], removed: covered.map(function (it) { return grid.items.find(function (x) { return x.id === it.id; }); }) } : null;
  }
  // "Camera", "Camera and Lights", "Camera, Lights and Clock", "4 blocks": what a drop would take away, in words
  function listOf(items) {
    var names = items.map(function (it) { return NAMES[it.card] || it.card; });
    if (names.length > 3) return names.length + ' blocks';
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
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
    '.framebox[data-loading]::after{content:"Loading the preview…";position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--hk-label2);' +
      'background:var(--hk-cell)}',
    '.framebox[data-loading=slow]::after{content:"The live preview isn’t ready. " attr(data-why) ". You can still arrange blocks.";inset:auto 0 0 0;padding:10px 14px;font-size:13px;' +
      'justify-content:flex-start;background:color-mix(in srgb,var(--hk-cell) 92%,transparent)}',
    '.catalog-preview:empty::before,.catalog-preview[data-loading]::before{content:"Loading preview…";position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;' +
      'font-size:13px;color:var(--hk-label2);background:var(--hk-fill)}',
    'iframe{position:absolute;inset:0;border:0;width:100%;height:100%;pointer-events:none}',
    '.grid{position:absolute;display:grid;gap:10px;z-index:2}',
    '.slot{border:1px dashed var(--hk-label3);border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));pointer-events:none}',
    '.block{position:absolute;z-index:3;cursor:grab;border:2px solid transparent;background:transparent;border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));color:var(--hk-label);' +
      'touch-action:none}',
    '.block:hover{border-color:color-mix(in srgb,var(--hk-tint) 45%,transparent)}',
    '.block.carried{z-index:5;cursor:grabbing}',
    '.block[aria-pressed=true]{border-color:var(--hk-tint)}.block:focus-visible{outline:3px solid var(--hk-tint)}',
    // the block's name: just above the one pointed at or chosen, never over a card's own title
    '.block .tag{position:absolute;bottom:calc(100% + 4px);left:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border-radius:7px;' +
      'background:var(--hk-cell);font-size:13px;opacity:0;transition:opacity .12s}',
    '.block:hover .tag,.block[aria-pressed=true] .tag,.block:focus-visible .tag{opacity:1}',
    '.ghost{position:absolute;pointer-events:none;border:3px solid var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 18%,transparent);' +
      'border-radius:var(--grid-radius,var(--hk-glass-radius,23.5px));z-index:4}.ghost.bad{border-color:var(--hk-red);background:color-mix(in srgb,var(--hk-red) 14%,transparent)}',
    // A CARD HELD OVER BLOCKS IT WOULD REPLACE (paletteDrag): its outline dashed red, the blocks that go washed red
    '.ghost.replace{border-style:dashed;border-color:var(--hk-red);background:transparent}',
    '.block.going{border-color:var(--hk-red);background:color-mix(in srgb,var(--hk-red) 42%,transparent)}',
    '.note.warn{color:var(--hk-red)}',
    '.float{position:fixed;left:0;top:0;z-index:20;pointer-events:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:var(--hk-cell);color:var(--hk-label);' +
      'box-shadow:var(--hk-shadow);font-size:13px;font-weight:600;white-space:nowrap}',
    '.float hk-icon{width:20px;height:20px;color:var(--hk-tint)}',
    '.note{font-size:13px;color:var(--hk-label2);line-height:1.5;margin:0 0 10px}.message{flex:none;color:var(--hk-red);min-height:24px;padding:6px 20px 0}',
    // THE PALETTE
    '.pal-head{position:sticky;top:0;z-index:2;background:var(--hk-bg);padding:0 0 12px}',
    '.pal-head p{font-size:13px;color:var(--hk-label2);margin:8px 4px 0;line-height:1.4}',
    '.catalog-search{box-sizing:border-box;width:100%;min-height:40px;border:1px solid var(--hk-sep);border-radius:10px;padding:8px 12px;background:var(--hk-cell);color:var(--hk-label);' +
      'font:inherit;font-size:15px}',
    '.pick-banner{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--hk-tint) 16%,var(--hk-cell));font-size:14px}',
    '.pick-banner span{flex:1}.pick-banner button{border:0;background:none;color:var(--hk-tint);font:inherit;cursor:pointer;min-height:32px}',
    // (pan-y: a finger moving up or down scrolls the list; paletteRow picks a card up on a sideways drag or a hold)
    '.pal-row{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 12px;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y;' +
      'transition:transform .15s ease,box-shadow .15s ease}',
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
    '.insp-head hk-icon{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:48px;height:48px;flex:none;border-radius:12px;background:var(--hk-cell);' +
      'color:var(--hk-tint);--mdc-icon-size:26px}',
    '.insp-head h2{margin:0;font-size:20px;font-weight:700}.insp-head p{margin:2px 0 0;font-size:13px;color:var(--hk-label2)}',
    '.insp-head .done{margin-left:auto;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;cursor:pointer;min-height:44px}',
    '.screen-settings{margin:4px 0 16px}.screen-settings summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;font-weight:600;padding:0 4px}' +
      '.screen-settings summary::before{content:"›";display:inline-block;transition:transform .15s}.screen-settings[open] summary::before{transform:rotate(90deg)}',
    // THE STARTERS: a map of each layout's blocks beside its name
    '.starter{display:flex;align-items:center;gap:12px;padding:10px 12px;text-align:left;cursor:pointer}',
    // a Look's picture: its colours (or its wallpaper), its accent a dot
    '.lookart{flex:none;width:64px;height:44px;border-radius:9px;position:relative;background-size:cover;background-position:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}',
    '.lookart i{position:absolute;right:6px;bottom:6px;width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 1.5px rgba(255,255,255,.8)}',
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
    '@media(max-width:899px){:host(:not([wide-anyway])) .work,:host(:not([wide-anyway])) .tools .save,:host(:not([wide-anyway])) .tools .undo{display:none}' +
      ':host(:not([wide-anyway])) .desktop-note{display:block}}',
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
      this.grid = sized(board.home_grid ? copy(board.home_grid) : null);
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
        h('p',
          {
          text:
          'This window is narrow for the editor: it shows the cards, the screen and the settings side by side. Turn the device sideways or widen the window, or open it anyway and scroll sideways.' }),
        h('button', { type: 'button', text: 'Open Anyway', onclick: () => { this.setAttribute('wide-anyway', ''); this.fit(); } })]));
      this.palette = h('aside', { class: 'palette', 'aria-label': 'Cards' });
      this.stage = h('section', { class: 'stage', 'aria-label': 'Screen layout' });
      this.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Block and screen settings', tabindex: '0' });
      this.ui.appendChild(h('div', { class: 'work' }, [this.palette, this.stage, this.sidebar]));
      this.stage.appendChild(
        h('p', { class: 'note', text: 'Drag a card from the left onto the grid. Drag blocks to move them; others make room. Cards are a preview: their controls don’t act on the house.' }));
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
      this.grid = sized(grid); this.saveButton.disabled = false; this.undoButton.disabled = !this.undoStack.length;
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
      if (ST.VIEW >= (this.grid.views || 1)) ST.VIEW = 0;               // (an undo can take the view away)
      this.overlay.style.gridTemplateColumns = 'repeat(' + this.grid.cols + ',1fr)';
      this.overlay.style.gridTemplateRows = 'repeat(' + this.grid.rows + ',1fr)';
      for (var i = 0; i < this.grid.cols * this.grid.rows; i++) this.overlay.appendChild(h('div', { class: 'slot' }));
      this.grid.items.forEach(function (it) {
        if ((it.view || 0) !== ST.VIEW) return;                // another view's
        var b = h('button', { class: 'block', type: 'button', 'data-id': it.id, 'aria-label': NAMES[it.card] + ', ' + SIZE_NAMES[it.size] + ', column ' + (it.at[0] + 1) + ', row ' + (it.at[1] + 1),
          'aria-pressed': self.selected === it.id ? 'true' : 'false' }, h('span', { class: 'tag', text: NAMES[it.card] + ' · ' + SIZE_NAMES[it.size] }));
        self.position(b, it);
        b.addEventListener('click', () => { self.select(it.id); });
        b.addEventListener('pointerdown', (e) => self.drag(e, it, b));
        b.addEventListener('keydown', function (e) {
          var delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
          if (!delta) return;
          e.preventDefault(); self.selected = it.id;
          var next = makeRoom(self.grid, it.id, it.size === 'XS' ? atY2('XS', it.at[0] + delta[0], y2(it) + delta[1]) : [it.at[0] + delta[0], it.at[1] + delta[1]]);
          if (next) { self.change(next); self.overlay.querySelector('[data-id="' + it.id + '"]').focus(); }
          else self.say('That move does not fit.');
        });
        self.overlay.appendChild(b);
      });
    }
    select(id) {
      this.selected = id; this.conditionPreview = null; this.editing = null; this.pickerTarget = null;
      this.overlay.querySelectorAll('.block').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false'));
      this.side();
      if (id === null) this.preview();
    }
    position(el, it) {
      var gap = this.cellGap || 10, z = SIZES[it.size], w = (this.overlay.clientWidth - (this.grid.cols - 1) * gap) / this.grid.cols;
      var h = (this.overlay.clientHeight - (this.grid.rows - 1) * gap) / this.grid.rows;
      Object.assign(el.style, { left: it.at[0] * (w + gap) + 'px', top: it.at[1] * (h + gap) + (it.size === 'XS' && it.at[2] ? (h + gap) / 2 : 0) + 'px', width: (w + gap) * z[0] - gap + 'px',
        height: (it.size === 'XS' ? (h - gap) / 2 : (h + gap) * z[1] - gap) + 'px' });
    }
    // MOVING A BLOCK (2026-10-30, the owner: "It would be cool if the tiles
    // could adapt while you move/relocate existing tiles"): the block follows
    // the pointer (a mouse or a finger), its outline shows the cells it would
    // take, and each time that changes the others slide to where makeRoom()
    // puts them -- back where they were, and the outline red, where it can't
    // go. Dropped, that layout is the draft (one Undo takes it all back).
    // Escape, the pointer back on its own cells or off the grid, or the
    // browser taking the touch, and everything goes back.
    drag(e, it, button) {
      if (e.button !== 0 || this.busy) return;
      this.select(it.id);
      var self = this, start = [e.clientX, e.clientY], moved = false, key = null, at = null, next = null, z = SIZES[it.size];
      var ghost = this.h('div', { class: 'ghost' });
      var tiny = it.size === 'XS', rows = this.grid.rows * (tiny ? 2 : 1), origin = snap(e.clientX, e.clientY, this.overlay.getBoundingClientRect(), this.grid.cols, rows);
      var home = function (a) { return a[0] === it.at[0] && a[1] === it.at[1] && (a[2] | 0) === (it.at[2] | 0); };
      button.setPointerCapture(e.pointerId);
      var follow = function (ev) {
        if (!moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 4) return;
        var r = self.overlay.getBoundingClientRect();
        self.carry(it.id, ev.clientX - start[0], ev.clientY - start[1], r);
        if (!moved) { moved = true; self.lift(it.id, true); window.addEventListener('keydown', escape, true); }
        var inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        var pos = snap(ev.clientX, ev.clientY, r, self.grid.cols, rows);
        // (a block held by its edge still lands inside the grid; a Tiny one in half rows)
        at = inside ? [Math.max(0, Math.min(self.grid.cols - z[0], it.at[0] + pos[0] - origin[0])),
          Math.max(0, Math.min(rows - (tiny ? 1 : z[1]), (tiny ? y2(it) : it.at[1]) + pos[1] - origin[1]))] : null;
        if (at && tiny) at = atY2('XS', at[0], at[1]);
        // the layout is worked out again only when the cells change
        if ((at ? at.join() : 'off') === key) return;
        key = at ? at.join() : 'off';
        next = at && !home(at) ? makeRoom(self.grid, it.id, at) : null;
        if (!at) ghost.remove();
        else { if (!ghost.parentNode) self.overlay.appendChild(ghost); self.position(ghost, Object.assign({}, it, { at: at })); }
        ghost.classList.toggle('bad', !!at && !home(at) && !next);
        self.slide(next, it.id);
      };
      var stop = function () {
        button.removeEventListener('pointermove', follow); button.removeEventListener('pointerup', finish); button.removeEventListener('pointercancel', finish);
        window.removeEventListener('keydown', escape, true);
        ghost.remove();
      };
      var finish = function (ev) {
        stop();
        if (!moved) return;
        if (ev && ev.type === 'pointerup' && next) { self.drop(next, it.id); return; }
        self.slide(null, it.id); self.lift(it.id, false);
        if (ev && ev.type === 'pointerup' && at && !home(at)) self.say('That move does not fit. The block stays where it was.');
      };
      var escape = function (ev) {
        if (ev.key !== 'Escape') return;
        ev.preventDefault(); ev.stopPropagation();
        try { button.releasePointerCapture(e.pointerId); } catch (x) { /* already let go */ }
        finish(null);
      };
      button.addEventListener('pointermove', follow); button.addEventListener('pointerup', finish); button.addEventListener('pointercancel', finish);
    }
    // THE PREVIEW'S OWN DRAWING OF A BLOCK (its .cell in the screen's grid),
    // null while the preview loads; and the scale that grid is drawn at
    previewGrid() {
      var v = this.previewView && this.previewView.isConnected ? this.previewView : null;
      try { v = v || this.iframe.contentWindow.hkShell.view(); } catch (x) { v = null; }
      return v && v.shadowRoot && v._gridScale ? v : null;
    }
    cellOf(id) {
      var v = this.previewGrid();
      return v ? v.shadowRoot.querySelector('.cell[data-id="' + cssId(id) + '"]') : null;
    }
    blockOf(id) { return this.overlay.querySelector('.block[data-id="' + cssId(id) + '"]'); }
    // a block shown [dx, dy] overlay px from where it is drawn: its outline and
    // its card in the preview together (`translate`, so the views' own
    // transform on a cell is kept), gliding there unless it follows the pointer
    nudge(id, dx, dy, glide) {
      var b = this.blockOf(id), c = this.cellOf(id);
      var k = c ? this.previewGrid()._gridScale : 1, still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      var ease = glide && !still ? 'translate .2s ease, scale .2s ease' : 'scale .2s ease';
      [[b, 1], [c, k]].forEach(function (x) {
        if (!x[0]) return;
        x[0].style.transition = ease;
        x[0].style.translate = dx || dy ? dx / x[1] + 'px ' + dy / x[1] + 'px' : '';
      });
    }
    // one grid step in overlay px: [across, down]
    step() {
      var gap = this.cellGap || 10;
      return [(this.overlay.clientWidth - (this.grid.cols - 1) * gap) / this.grid.cols + gap, (this.overlay.clientHeight - (this.grid.rows - 1) * gap) / this.grid.rows + gap];
    }
    // every other block of the view to its place in `layout` (null: its own)
    slide(layout, id) {
      var s = this.step();
      this.grid.items.forEach((it) => {
        if (it.id === id || (it.view || 0) !== ST.VIEW) return;
        var to = layout && layout.items.find((x) => x.id === it.id), at = to ? to.at : it.at;
        this.nudge(it.id, (at[0] - it.at[0]) * s[0], (at[1] - it.at[1]) * s[1], true);
      });
    }
    // the carried block, `dx`, `dy` screen px from where it was picked up
    // (the editor's frame is scaled: rect is the overlay's on screen)
    carry(id, dx, dy, rect) {
      var f = rect.width / (this.overlay.clientWidth || rect.width || 1);
      this.nudge(id, dx / f, dy / f, false);
    }
    // the carried block a little larger and over the rest, as on a Home Screen; let go, as it was
    lift(id, on) {
      var b = this.blockOf(id), c = this.cellOf(id);
      if (b) b.classList.toggle('carried', on);
      if (c) { c.style.zIndex = on ? '3' : ''; c.style.scale = on ? '1.04' : ''; }
      if (!on) this.nudge(id, 0, 0, true);
      // (and the transitions taken off again once the blocks are home, the views' slide with them)
      clearTimeout(this.liftTimer);
      if (!on) this.liftTimer = setTimeout(() => {
        this.grid.items.forEach((it) => {
          [this.blockOf(it.id), this.cellOf(it.id)]
            .forEach((el) => { if (el && !el.style.translate) el.style.transition = ''; });
        });
      }, 260);
    }
    // DROPPED: the carried block settles on its cells, and the layout the
    // others slid to is the draft. The preview's cells keep where they slid
    // until the preview is drawn again from the draft (no flash of the old one)
    drop(next, id) {
      var s = this.step(), it = this.grid.items.find((x) => x.id === id), to = next.items.find((x) => x.id === id);
      var c = this.cellOf(id);
      if (c) c.style.scale = '';
      this.nudge(id, (to.at[0] - it.at[0]) * s[0], (to.at[1] - it.at[1]) * s[1], true);
      this.change(next);
    }
    // A CARD DRAGGED OUT OF THE PALETTE: a label follows the pointer, and over
    // the grid the block's real footprint shows where it lands. Where something
    // is in the way the others make room if they can; where they can't (the
    // grid is full) the card takes the cells it covers and the blocks it
    // covers go (2026-10-31, the owner: "let me drag it onto the grid
    // anyway"): they are washed red while it is held over them, the hint line
    // says which will go, and the drop is one step for Undo. addOver() decides.
    paletteDrag(e, card, row) {
      if (!this.grid || this.busy || this.pickerTarget) return false;
      var self = this, size = this.sizeFor(card), ghost = this.h('div', { class: 'ghost' }), at = null, key = null, plan = null;
      var label = window.hkDrag.ghost(this.shadowRoot, this.h('div', { class: 'float' },
        [this.h('hk-icon', { icon: GLYPHS[card] }), this.h('span', { text: NAMES[card] + ' · ' + SIZE_NAMES[size] })]));
      // the hint line says what the drop would do; its height is kept so the screen doesn't rescale under the hand
      var note = this.stage.querySelector('.note'), said = note ? note.textContent : '';
      if (note) Object.assign(note.style, { height: note.getBoundingClientRect().height + 'px', overflow: 'hidden' });
      var over = function (ev) {
        var r = self.overlay.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom ? r : null;
      };
      // (a mouse dragging across the editor doesn't select its text)
      this.ui.style.userSelect = this.ui.style.webkitUserSelect = 'none';
      try { window.getSelection().removeAllRanges(); } catch (x) { /* no selection */ }
      // what is held over: the blocks that go, red; the ones that make room, slid aside in the preview
      var show = function () {
        var gone = plan ? plan.removed.map(function (it) { return it.id; }) : [];
        self.overlay.querySelectorAll('.block').forEach(function (b) {
          var out = gone.indexOf(b.dataset.id) >= 0, c = self.cellOf(b.dataset.id);
          b.classList.toggle('going', out);
          if (c) { c.style.transition = 'opacity .15s'; c.style.opacity = out ? '.3' : ''; }
        });
        self.slide(plan && plan.moved.length ? plan.grid : null, '');
        ghost.classList.toggle('bad', !!at && !plan);
        ghost.classList.toggle('replace', gone.length > 0);
        if (note) {
          note.textContent = !at ? said : !plan ? 'That doesn’t fit the grid.' : gone.length
            ? 'Dropping here replaces ' + listOf(plan.removed) + '. Undo puts ' + (gone.length > 1 ? 'them' : 'it') + ' back.' : said;
          note.classList.toggle('warn', !!plan && gone.length > 0);
        }
      };
      var move = function (ev) {
        label.move(ev);
        var r = over(ev), was = key;
        at = r ? landing(ev.clientX, ev.clientY, r, self.grid.cols, self.grid.rows, self.cellGap || 10, size) : null;
        key = at ? at.join() : 'off';
        if (!at) ghost.remove();
        else { if (!ghost.parentNode) self.overlay.appendChild(ghost); self.position(ghost, { size: size, at: at }); }
        if (key === was) return;
        plan = at ? addOver(self.grid, card, size, at) : null;
        show();
      };
      var finish = function (ev) {
        row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', finish); row.removeEventListener('pointercancel', finish);
        ghost.remove(); label.remove();
        self.ui.style.userSelect = self.ui.style.webkitUserSelect = '';
        var drop = ev.type === 'pointerup' && at ? plan : null, there = at;
        // (dropped: the blocks that go and the ones aside stay as they are shown until the preview is drawn again from
        // the draft; else every block back where it is. The hint as it was either way)
        if (!drop) { at = null; plan = null; show(); }
        self.lift('', false);
        if (note) { note.textContent = said; note.classList.remove('warn'); note.style.height = ''; note.style.overflow = ''; }
        if (ev.type === 'pointercancel' || !there) return;
        if (drop) self.addCard(card, size, there);
        else self.say(self.grid.items.length >= 24 ? 'A screen holds 24 blocks at most. Drop the card onto a block to replace it, or remove one first.'
          : 'A ' + SIZE_NAMES[size] + ' ' + NAMES[card] + ' doesn’t fit there. Drop it nearer the middle, or pick a smaller size.');
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
      if (view && view._showView && (this.grid.views || 1) > 1) view._showView(ST.VIEW);
      var cell = view && view._config && view._config.grid && view.shadowRoot &&
        // (one that isn't sliding out of a moved block's way: makeRoom's, drag())
        [].find.call(view.shadowRoot.querySelectorAll((this.grid.views || 1) > 1 ? '.cell[data-view="' + ST.VIEW + '"]' : '.cell'), (c) => !c.style.translate && c.getAttribute('size') !== 'XS');
      if (cell) {
        var r = cell.getBoundingClientRect(), it = view._config.cards.find((x) => x.hk_cell && x.hk_cell.id === cell.dataset.id).hk_cell;
        var gap = cellOf(this.grid).gap * (view._gridScale || 1); this.cellGap = gap; this.overlay.style.gap = gap + 'px';
        var z = SIZES[it.size], cw = (r.width - (z[0] - 1) * gap) / z[0], ch = (r.height - (z[1] - 1) * gap) / z[1];
        Object.assign(this.overlay.style, { left: r.left - it.at[0] * (cw + gap) + 'px', top: r.top - it.at[1] * (ch + gap) + 'px',
          width: (cw + gap) * this.grid.cols - gap + 'px', height: (ch + gap) * this.grid.rows - gap + 'px' });
      } else if (view && view._root && view._gridScale) {
        var bounds = view._root.getBoundingClientRect(), factor = view._gridScale;
        var pad = parseFloat(w.getComputedStyle(view._root).paddingTop) * factor, band = this.grid.band ? (60 + cellOf(this.grid).gap) * factor : 0;
        this.cellGap = cellOf(this.grid).gap * factor; this.overlay.style.gap = this.cellGap + 'px';
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
      // (dropped at `at`: the others make room, or the blocks it covers go -- addOver(); the Add button's own place is the first free one)
      var free = at ? null : add(this.grid, card, size), r = at ? addOver(this.grid, card, size, at) : free && { grid: free, moved: [], removed: [] };
      if (!r) { this.say(at ? 'No room there for a ' + SIZE_NAMES[size] + ' ' + NAMES[card] + '.' :
        'No space for that size. Remove or move a block first, or drag the card onto the blocks it should replace.'); return; }
      var added = r.grid.items[r.grid.items.length - 1];
      Object.assign(added, this.variantFor(card));
      // (Security at Compact is its HomeView presentation: choosing the size chooses it)
      if (card === 'security' && size === 'C') added.opts = Object.assign({}, added.opts, { presentation: 'homeview' });
      this.selected = added.id; this.pickerCard = null; this.change(r.grid);
      if (r.removed.length) this.say(listOf(r.removed) + (r.removed.length > 1 ? ' were' : ' was') + ' replaced by ' + NAMES[card] + '. Undo (⌘Z) puts ' + (r.removed.length > 1 ? 'them' : 'it') +
        ' back.');
    }

  }
  window.hkGridEditor = { paneForStarter: paneForStarter, fullColumns: fullColumns, COLS: COLS, place: place, makeRoom: makeRoom, valid: valid, firstSpace: firstSpace, add: add, addOver: addOver,
    listOf: listOf, snap: snap, landing: landing,
                          SCREEN_TYPES: SCREEN_TYPES, SQUARE_STARTERS: SQUARE_STARTERS, screenTypeOf: screenTypeOf, scaleAt: scaleAt, squareStarter: squareStarter,
                          // (the dashboard's Edit mode names and sizes blocks as this editor does: hk-edit-grid.js)
                          cannotResize: cannotResize, NAMES: NAMES, SIZE_NAMES: SIZE_NAMES, SIZE_SHORT: SIZE_SHORT, GLYPHS: GLYPHS,
                          GROUPS: GROUPS, DESCRIPTIONS: DESCRIPTIONS, offered: offered };
  customElements.define('hk-grid-editor', GridEditor);

  // ------------------------------------------------------------ the parts (generated by tools/split_js.py)
  // THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/grid-editor/ (the PARTS below, in the order they
  // run) by tools/split_js.py from tools/split_manifests/grid-editor.json; `split_js.py --find <name>` says which file holds
  // one. Each file registers one function in window.hkGridEditorParts; they run here, in this order (a later one may use
  // an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
  // they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
  // them (the suites) starts at once, in the same turn.
  // READY: window.__hkSplitReady['hk-grid-editor'] is a promise that resolves once the parts have run (and rejects if they
  // never come), so a page that imports this file and uses it at once awaits it first (web/home.js imp, hk-loader).
  var PARTS = ['hk-grid-editor-screen.js', 'hk-grid-editor-palette.js', 'hk-grid-editor-settings.js',
               'hk-grid-editor-show-when.js', 'hk-grid-editor-sheet.js', 'hk-grid-editor-options.js'];
  var PARTS_TRIES = 6;
  function partKey(file) { return file.replace(/\.js$/, ''); }
  function partsSettle(err) {
    var settle = (window.__hkSplitSettle || {})['hk-grid-editor'];
    if (settle) settle(err);
  }
  // ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
  // (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
  // of their own -- a browser keeps a failed module's answer for its address
  function loadParts(then, n) {
    // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
    // must not run them twice: the flag is set at once, not when the parts have run
    var started = window.__hkSplitStarted = window.__hkSplitStarted || {};
    if (n === undefined) {
      if (started['hk-grid-editor']) return;
      started['hk-grid-editor'] = true;
      var ready = new Promise(function (resolve, reject) {
        (window.__hkSplitSettle = window.__hkSplitSettle || {})['hk-grid-editor'] = function (err) { if (err) reject(err); else resolve(); };
      });
      ready.catch(function () { /* the console says so; an importer that awaits it reports it */ });
      (window.__hkSplitReady = window.__hkSplitReady || {})['hk-grid-editor'] = ready;
    }
    n = n || 0;
    var have = window.hkGridEditorParts || {};
    var missing = PARTS.filter(function (file) { return !have[partKey(file)]; });
    if (!missing.length) {
      var failed = null;
      try { then(); } catch (err) { failed = err; console.error('[hk-grid-editor] the parts did not start', err); }
      // (the checks that drive a page wait for every shell that started to say it is done)
      (window.__hkSplitDone = window.__hkSplitDone || {})['hk-grid-editor'] = true;
      partsSettle(failed);
      return;
    }
    // (window.hkV: the build's ?v= on an address put together here, web/shim/base.js)
    Promise.all(missing.map(function (file) {
      var u = '/hk/grid-editor/' + file, href = window.hkV ? window.hkV(u) : u;
      var got = n ? import(href + (href.indexOf('?') < 0 ? '?' : '&') + 'retry=' + n) : import(href);
      return got.catch(function (err) { return err; });
    })).then(function (got) {
      var err = got.filter(function (r) { return r instanceof Error; })[0];
      var left = PARTS.filter(function (file) { return !(window.hkGridEditorParts || {})[partKey(file)]; });
      if (!left.length) { loadParts(then, n); return; }
      err = err || new Error(left[0] + ' ran without registering');
      if (n + 1 >= PARTS_TRIES) {
        console.error('[hk-grid-editor] the parts did not start', err);
        partsSettle(err);
        // (given up: a later import of this file -- a page asking again at an address of its own -- starts over)
        delete started['hk-grid-editor'];
        return;
      }
      console.warn('[hk-grid-editor] a part did not load (' + err.message + '); again shortly');
      setTimeout(function () { loadParts(then, n + 1); }, Math.min(1000 * Math.pow(2, n), 15000));
    });
  }
  // ------------------------------------------------------------ end of the parts loader

  // THE CLASS'S METHODS that parts add: as a class body defines them (writable, configurable, NOT enumerable; a
  // getter or setter stays an accessor), so for-in and Object.getOwnPropertyNames over the prototype see the same names
  function install(from) {
    Object.getOwnPropertyNames(from.prototype).forEach(function (name) {
      if (name === 'constructor') return;
      if (Object.prototype.hasOwnProperty.call(GridEditor.prototype, name)) throw new Error('[hk-grid-editor] ' + name + ' is defined twice');
      var d = Object.getOwnPropertyDescriptor(from.prototype, name);
      Object.defineProperty(GridEditor.prototype, name, d.get || d.set
        ? { get: d.get, set: d.set, enumerable: false, configurable: true }
        : { value: d.value, writable: true, enumerable: false, configurable: true });
    });
  }
  function kit() {
    return {
      cannotResize: cannotResize, cellOf: cellOf, COLS: COLS, CONDITION_NAMES: CONDITION_NAMES, copy: copy,
      DESCRIPTIONS: DESCRIPTIONS, EMPTY: EMPTY, firstSpace: firstSpace, fullColumns: fullColumns, G: G,
      GLYPHS: GLYPHS, GROUP_TINT: GROUP_TINT, groupOf: groupOf, GROUPS: GROUPS, keepVersion: keepVersion,
      KIND_LABELS: KIND_LABELS, listOf: listOf, MAP_SUB: MAP_SUB, NAME_LABELS: NAME_LABELS, NAMES: NAMES,
      NIGHTSTAND: NIGHTSTAND, offered: offered, offersSize: offersSize, paneForStarter: paneForStarter, place: place,
      reflow: reflow, RULE_MARK: RULE_MARK, sampleEntities: sampleEntities, scaleAt: scaleAt,
      SCREEN_TYPES: SCREEN_TYPES, screenTypeOf: screenTypeOf, SHOW: SHOW, SIZE_NAMES: SIZE_NAMES,
      SIZE_SHORT: SIZE_SHORT, SIZES: SIZES, SOURCE_HIDES: SOURCE_HIDES, SQUARE_STARTERS: SQUARE_STARTERS,
      squareStarter: squareStarter, ST: ST, STARTERS: STARTERS, TILE_CARDS: TILE_CARDS, valid: valid,
      versionOf: versionOf, install: install
    };
  }
  function runParts() {
    var KIT = kit();
    PARTS.forEach(function (file) { window.hkGridEditorParts[partKey(file)](KIT); });
  }

  var partsReady = new Promise(function (resolve, reject) {
    var ran = false;
    loadParts(function () {
      runParts();
      ran = true;
      resolve();
    });
    // (the loader gives up after its last try with a note in the console; the page says so too)
    if (!ran) setTimeout(function () { reject(new Error('its files did not load')); }, 75000);
  });
  partsReady.catch(function () { /* boot() reports it */ });
})();
