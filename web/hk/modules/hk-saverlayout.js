// hk-saverlayout.js -- THE SCREENSAVER'S LAYOUT (2026-11-01, the owner: "Lets do the editor!";
// docs/phase12/SCREENSAVER-EDITOR.md): one background, one big element, and widgets in zones -- the model the
// Screensaver editor saves (the screensaver options' `layout`) and the plan both it and the screensaver draw by.
//
// The background is not here: it stays in the options it always was (show, clock_bg, the photo and forecast keys),
// and so do the time's face, colors and 24-hour time. A layout holds what had no option: what the big element is,
// its size, place and depth, and the widgets in each zone.
//
// v2 (2026-11-02, phase 13: docs/phase13/PIECES-SPEC.md): a widget is a PIECE in a SHAPE ({piece, shape, size, back,
// color, opts}); the row has one size (row_size), the screen one ink (ink) and its accents (accents); a v1 layout is read
// as v2. PIECES, ZONES and V1 are mirrored by hk_core/settings/saver_layout.py, kept equal by a test; clean() is its
// layout() (the read's: keeps what it can) and check() its check() (the write's: all or nothing).
//
// plan() places everything, as pure arithmetic on sizes it is given, so the screensaver and the editor's overlay
// can never disagree: the big element's column (a line above it, the big element, a row under it), the four corners
// stacked from the screen's edges, the band along the bottom. ZONES KNOW ABOUT EACH OTHER (the owner's wall tablet,
// 2026-11-01: Time Behind at its largest ran into Home Status and the weather): a corner the column reaches goes to
// the other end of its side, stacked after what is there, and is left out only if even that is in the way.
//
//   hkSaverLayout.clean(v) -> layout | null      hkSaverLayout.check(v) -> null | 'saver_layout'
//   hkSaverLayout.layoutFrom(options) -> layout   hkSaverLayout.oriented(layout, W, H) -> { big, zones }
//   hkSaverLayout.plan(room, oriented, measure, screen) -> boxes
(function () {
  'use strict';
  if (window.hkSaverLayout) return;

  var VERSION = 2;
  // THE PIECES (2026-11-02, phase 13: docs/phase13/PIECES-SPEC.md): one per fact, each in a few shapes, drawn by
  // hk-saverwidgets.js. [piece] -> [its shapes, its options {key: choices}, its name, the facts it shows]
  // (hk_core/settings/saver_layout.py PIECES: the shapes and options)
  // World Clock's cities (IANA)
  var CITIES = ['Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Reykjavik'];
  var PIECES = {
    weather: [['inline', 'circular', 'rectangular', 'card', 'band'], {}, 'Weather', ['weather']],
    readings: [['circular', 'rectangular', 'band'], { reading: ['humidity', 'aqi', 'inside', 'sunset', 'wind'] }, 'Readings', ['readings']],
    date: [['inline'], {}, 'Date', ['date']],
    time: [['inline', 'card'], {}, 'Time', ['time']],
    status: [['inline', 'circular', 'rectangular', 'card'], {}, 'House Status', ['status']],
    music: [['inline', 'card'], {}, 'Music', ['music']],
    timers: [['circular', 'card'], {}, 'Timers', ['timers']],
    events: [['inline', 'rectangular', 'card'], {}, 'Next Event', ['calendar'], 'time'],
    energy: [['circular', 'rectangular'], { reading: ['battery', 'solar'] }, 'Energy', ['energy']],
    title: [['inline'], {}, 'Photo Title', ['title']],
    // THE GLANCE CATALOG (phase 1b, docs/phase13/GLANCE-SPEC.md), wave A: data the screensaver already reads. The 5th field
    // is the file that draws it (hk-saverpieces-<group>.js), loaded only where a layout places one
    countdown: [['inline', 'circular'], { match: 'text' }, 'Countdown', ['countdown'], 'time'],
    world: [['inline', 'circular', 'rectangular'], { city: CITIES, city2: CITIES }, 'World Clock', ['world'], 'time'],
    rain: [['inline', 'circular', 'rectangular'], {}, 'Rain Soon', ['rain'], 'weather'],
    alert: [['inline', 'card'], {}, 'Weather Alert', ['alert'], 'weather'],
    uv: [['circular'], {}, 'UV', ['uv'], 'weather'],
    wind: [['circular'], {}, 'Wind and Gusts', ['wind'], 'weather'],
    pressure: [['circular'], {}, 'Pressure', ['pressure'], 'weather'],
    feels: [['circular'], {}, 'Feels Like', ['feels'], 'weather'],
    moon: [['inline', 'circular'], {}, 'Moon', ['moon'], 'weather'],
    sun: [['inline', 'circular', 'rectangular'], {}, 'Sun', ['sun'], 'weather'],
    // wave B: data HK reads on its other pages
    security: [['inline', 'circular'], {}, 'Security', ['security'], 'home'],
    doors: [['inline', 'circular', 'rectangular'], {when: ['always', 'open']}, 'Doors and Windows', ['doors'], 'home'],
    garage: [['inline', 'circular'], {when: ['always', 'open']}, 'Garage', ['garage'], 'home'],
    climate: [['inline', 'circular', 'rectangular'], {}, 'Climate', ['climate'], 'home'],
    lights: [['inline', 'circular'], {}, 'Lights On', ['lights'], 'home'],
    vacuum: [['inline', 'circular'], {}, 'Vacuum', ['vacuum'], 'home'],
    notify: [['inline', 'circular', 'rectangular'], {}, 'Notifications', ['notify'], 'home'],
    package: [['inline', 'circular'], {}, 'Package', ['package'], 'home'],
    who: [['inline', 'circular', 'rectangular'], {person: 'entity:person'}, 'Who\u2019s Home', ['people'], 'people'],
    grid: [['inline', 'circular'], {}, 'Grid', ['grid'], 'energy'],
    ev: [['inline', 'circular'], {}, 'EV', ['ev'], 'energy'],
    upnext: [['inline', 'rectangular'], {}, 'Up Next', ['upnext'], 'media'],
    playin: [['inline'], {}, 'Playing In', ['playin'], 'media'],
    thisday: [['inline'], {}, 'On This Day', ['thisday'], 'media'],
    camera: [['rectangular', 'card'], {camera: 'entity:camera'}, 'Camera', ['camera'], 'cameras'],
    ring: [['inline', 'card'], {}, 'Last Ring', ['ring'], 'cameras'],
    // wave C: one entity picked, with a suggested default
    alarm: [['inline', 'circular'], {entity: 'entity:sensor'}, 'Phone Alarm', ['alarm'], 'picked'],
    trash: [['inline', 'circular'], {entity: 'entity:calendar,sensor'}, 'Trash Day', ['trash'], 'picked'],
    pollen: [['inline', 'circular'], {entity: 'entity:sensor'}, 'Pollen', ['pollen'], 'picked'],
    appliance: [['inline', 'circular', 'rectangular'], {entity: 'entity:sensor,binary_sensor', entity2: 'entity:sensor,binary_sensor'}, 'Appliances', ['appliance'], 'picked'],
    leak: [['inline', 'card'], {}, 'Leak and Smoke', ['leak'], 'picked'],
    travel: [['inline', 'circular', 'rectangular'], {entity: 'entity:sensor', entity2: 'entity:sensor'}, 'Travel Time', ['travel'], 'picked'],
    price: [['inline'], {entity: 'entity:sensor,input_number,number'}, 'Price', ['price'], 'picked'],
    sensor: [['inline', 'circular', 'rectangular'], {entity: 'entity:sensor,binary_sensor,input_number,number,input_boolean,switch,climate,lock,cover,device_tracker', entity2: 'entity:sensor,binary_sensor,input_number,number,input_boolean,switch,climate,lock,cover,device_tracker', name: 'text', min: 'text', max: 'text'}, 'Any Sensor', ['sensor'], 'sensor']
  };
  var SHAPES = ['inline', 'circular', 'rectangular', 'card', 'band'];
  var SHAPE_NAMES = { inline: 'Inline', circular: 'Circular', rectangular: 'Rectangular', card: 'Card', band: 'Band' };
  // THE FIRST LAYOUTS' WIDGETS (v1, 2026-11-01), each a piece in a shape now: [piece, shape, opts]
  var V1 = {
    temp: ['weather', 'circular'], aqi: ['readings', 'circular', { reading: 'aqi' }], humidity: ['readings', 'circular', { reading: 'humidity' }],
    inside: ['readings', 'circular', { reading: 'inside' }], sunset: ['readings', 'circular', { reading: 'sunset' }],
    battery: ['energy', 'circular', { reading: 'battery' }], solar: ['energy', 'circular', { reading: 'solar' }], timer: ['timers', 'circular'],
    locks: ['status', 'circular'], next_event: ['events', 'rectangular'], next_hours: ['weather', 'rectangular'], home_status: ['status', 'rectangular'],
    energy_today: ['energy', 'rectangular'], date: ['date', 'inline'], weather_line: ['weather', 'inline'], status_line: ['status', 'inline'],
    event_line: ['events', 'inline'], photo_title: ['title', 'inline'], clock_card: ['time', 'card'], music_card: ['music', 'card'],
    timers_card: ['timers', 'card'], weather_card: ['weather', 'card'], status_card: ['status', 'card'], forecast_band: ['weather', 'band'],
    readings: ['readings', 'band']
  };
  // THE CATALOG the editor lists: one entry per piece in a shape, `piece.shape` -> [shape, name, what it shows]
  // (a piece's own words where it has them: the v1 widgets' names, which the owner knows)
  var WORDS = {
    'weather.inline': 'The condition and temperature', 'weather.circular': 'Now, with today’s range', 'weather.rectangular': 'Now and the next hours',
    'weather.card': 'Today, high and low', 'weather.band': 'Today, the hours and the days', 'readings.circular': 'One reading: humidity, AQI, inside, sunset or wind',
    'readings.rectangular': 'Two readings', 'readings.band': 'Sunset, wind, humidity and AQI', 'date.inline': 'The weekday and the date',
    'time.inline': 'A small time', 'time.card': 'A small time over the date', 'status.inline': 'In one line', 'status.circular': 'Locked or not',
    'status.rectangular': 'Security, doors and locks', 'status.card': 'The alarm and what’s open', 'music.inline': 'While something plays',
    'music.card': 'Now Playing, while something plays', 'timers.circular': 'The next to end', 'timers.card': 'While a timer runs',
    'events.inline': 'Your next event', 'events.rectangular': 'Your next two events', 'energy.circular': 'The home battery, or solar',
    'energy.rectangular': 'Used and made today', 'title.inline': 'The album and the year', 'events.card': 'The rest of today',
    'countdown.inline': 'Days to an event', 'countdown.circular': 'The days left', 'world.inline': 'Another city’s time',
    'world.circular': 'A small dial', 'world.rectangular': 'Two cities', 'rain.inline': 'When rain is coming', 'rain.circular': 'The chance of rain',
    'rain.rectangular': 'A bar per hour', 'alert.inline': 'While one is active', 'alert.card': 'The alert', 'uv.circular': 'The UV index',
    'wind.circular': 'Wind and gusts', 'pressure.circular': 'The pressure', 'feels.circular': 'What it feels like', 'moon.inline': 'The phase',
    'moon.circular': 'The moon drawn', 'sun.inline': 'The next sunrise or sunset', 'sun.circular': 'The day’s arc', 'sun.rectangular': 'The day’s length',
    'security.inline': 'The alarm’s state', 'security.circular': 'The alarm’s state', 'doors.inline': 'What’s open',
    'doors.circular': 'What’s open', 'doors.rectangular': 'What’s open', 'garage.inline': 'The garage door',
    'garage.circular': 'The garage door', 'climate.inline': 'Heating or cooling, inside', 'climate.circular': 'Heating or cooling, inside',
    'climate.rectangular': 'Heating or cooling, inside', 'lights.inline': 'How many lights are on', 'lights.circular': 'How many lights are on',
    'vacuum.inline': 'While it cleans', 'vacuum.circular': 'While it cleans', 'notify.inline': 'What’s arrived',
    'notify.circular': 'What’s arrived', 'notify.rectangular': 'What’s arrived', 'package.inline': 'After a package is seen',
    'package.circular': 'After a package is seen', 'who.inline': 'Who’s home', 'who.circular': 'Who’s home',
    'who.rectangular': 'Who’s home', 'grid.inline': 'Importing or exporting', 'grid.circular': 'Importing or exporting',
    'ev.inline': 'The car’s charge', 'ev.circular': 'The car’s charge', 'upnext.inline': 'The next song',
    'upnext.rectangular': 'The next song', 'playin.inline': 'Where the music plays', 'thisday.inline': 'Over a photo from this day',
    'camera.rectangular': 'A camera’s still', 'camera.card': 'A camera’s still', 'ring.inline': 'After the doorbell rings',
    'ring.card': 'After the doorbell rings'
  };
  // (wave C's words)
  Object.assign(WORDS, {
    'alarm.inline': 'While an alarm is set', 'alarm.circular': 'While an alarm is set', 'trash.inline': 'The day before and the day of',
    'trash.circular': 'The day before and the day of', 'pollen.inline': 'The pollen level', 'pollen.circular': 'The pollen level',
    'appliance.inline': 'While running, and an hour after', 'appliance.circular': 'While running, and an hour after', 'appliance.rectangular': 'While running, and an hour after',
    'leak.inline': 'While one is tripped', 'leak.card': 'While one is tripped', 'travel.inline': 'Minutes to a place',
    'travel.circular': 'Minutes to a place', 'travel.rectangular': 'Minutes to a place', 'price.inline': 'The energy price',
    'sensor.inline': 'Any entity you pick', 'sensor.circular': 'Any entity you pick', 'sensor.rectangular': 'Any entity you pick'
  });
  var CATALOG = {};
  function catalog() {
    CATALOG = {};
    Object.keys(PIECES).forEach(function (p) {
      PIECES[p][0].forEach(function (sh) { CATALOG[p + '.' + sh] = [sh, PIECES[p][2], WORDS[p + '.' + sh] || '']; });
    });
  }
  catalog();
  // [zone] -> [the shapes it takes, its room]; the row's room is in units (circular 1, rectangular 2, times the piece's
  // size). The pane down the side is the Side Pane's, with settings of its own: not a zone
  var ZONES = {
    line: [['inline'], 1],
    row: [['circular', 'rectangular'], 8],          // (two lines of four units)
    tl: [['card', 'inline'], 2], tr: [['card', 'inline'], 2],
    bl: [['card', 'inline'], 2], br: [['card', 'inline'], 2],
    bottom: [['band'], 1]
  };
  var ZONE_NAMES = { line: 'Above the Big Element', row: 'Under the Big Element', tl: 'Top Left', tr: 'Top Right',
                     bl: 'Bottom Left', br: 'Bottom Right', bottom: 'Along the Bottom' };
  var UNITS = { rectangular: 2 };
  var BIG = {
    kinds: ['time', 'temp', 'date', 'month', 'none'], size: [12, 44], pos: ['top', 'upper', 'center', 'lower', 'ground'],
    align: ['left', 'center', 'right'], depth: ['front', 'behind', 'planted']
  };
  var BIG_DEFAULT = { kind: 'time', size: 24, pos: 'top', align: 'center', depth: 'front' };
  var BACKS = ['none', 'glass', 'tint'], COLORS = ['auto', 'accent'];
  // a piece's words: left, center or right; none stored is Auto, by its side of the screen (settings saver_layout.py
  // ALIGNS); title: false, a card without its heading
  var ALIGNS = ['left', 'center', 'right'];
  // a piece's own size, % of its usual (60-200: 2026-11-02, the owner: "we probably should allow up to a 200% size
  // increase"); the row's one size (ROW_SIZE: "It would look weird if all them varied in sizes"); where the row goes
  var ITEM_SIZE = [60, 200], ROW_AT = ['under', 'bottom'], ROW_LINE = 4;
  // THE SCREEN'S INK: every piece white or black together, Auto from the background (the owner: "I don't want some
  // widgets being white and some being black on the screen at the same time")
  var INKS = ['auto', 'white', 'black'];
  // SHOWN ONLY WHEN... (2026-11-02, the owner: "Mail Box... it only shows when the Mail Has Arrived? Or if the House
  // Battery is charging?"): any piece can carry a condition on one entity, {entity, op, value}; while it isn't met the
  // piece is left out and the rest close up around it (met())
  var SHOW_OPS = ['is', 'not', 'above', 'below'], ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;
  function showOk(v) {
    return obj(v) && Object.keys(v).sort().join() === 'entity,op,value' && typeof v.entity === 'string' && ENTITY_RE.test(v.entity) &&
      SHOW_OPS.indexOf(v.op) >= 0 && ((typeof v.value === 'string' && v.value.length > 0 && v.value.length <= 64) || (typeof v.value === 'number' && isFinite(v.value)));
  }
  // whether a piece's condition is met by the house's states now (no condition: always). An entity the screen can't
  // read, or one unavailable, never shows it: absent is not the same as "not"
  function met(show, states) {
    if (!show) return true;
    var st = states && states[show.entity];
    if (!st || st.state === 'unavailable' || st.state === 'unknown') return false;
    var s = String(st.state), v = show.value;
    if (show.op === 'above' || show.op === 'below') {
      var a = parseFloat(s), b = typeof v === 'number' ? v : parseFloat(v);
      if (!isFinite(a) || !isFinite(b)) return false;
      return show.op === 'above' ? a > b : a < b;
    }
    var same = s.toLowerCase() === String(v).toLowerCase() || (isFinite(parseFloat(s)) && parseFloat(s) === (typeof v === 'number' ? v : parseFloat(v)));
    return show.op === 'is' ? same : !same;
  }

  // ------------------------------------------------------------ the checks (saver_layout.py's, mirrored)
  function Bad() {}
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function big(v, strict) {
    var out = Object.assign({}, BIG_DEFAULT);
    if (!obj(v)) { if (strict) throw new Bad(); return out; }
    Object.keys(v).forEach(function (k) {
      var val = v[k];
      var ok = (k === 'kind' && BIG.kinds.indexOf(val) >= 0) || (k === 'pos' && BIG.pos.indexOf(val) >= 0) ||
               (k === 'align' && BIG.align.indexOf(val) >= 0) || (k === 'depth' && BIG.depth.indexOf(val) >= 0) ||
               (k === 'size' && isInt(val) && val >= BIG.size[0] && val <= BIG.size[1]);
      if (ok) out[k] = val; else if (strict) throw new Bad();
    });
    return out;
  }
  // a piece's id in the catalog, and the piece for an id
  function idOf(w) { return w ? w.piece + '.' + w.shape : ''; }
  function item(id, extra) {
    var at = String(id).indexOf('.');
    var w = { piece: id.slice(0, at), shape: id.slice(at + 1), back: 'none', color: 'auto' };
    return Object.assign(w, extra || {});
  }
  // the room a piece takes in the row: its shape's units times its size (its own, else the row's)
  function unitsOf(w, rowSize) { return (UNITS[w.shape] || 1) * (w.size || rowSize || 100) / 100; }
  // a piece's option: one of its choices, words (1 to 40 characters), or an entity of the domains it names
  function optOk(spec, v) {
    if (Array.isArray(spec)) return spec.indexOf(v) >= 0;
    if (spec === 'text') return typeof v === 'string' && v.trim().length > 0 && v.length <= 40;
    if (typeof spec === 'string' && spec.indexOf('entity:') === 0) return typeof v === 'string' && ENTITY_RE.test(v) && spec.slice(7).split(',').indexOf(v.split('.')[0]) >= 0;
    return false;
  }
  // the files a layout's pieces are drawn by, beyond the renderer's own (hk-saverpieces-<group>.js)
  function filesOf(L) {
    var out = [];
    [L && L.zones, L && L.upright && L.upright.zones].forEach(function (zs) {
      Object.keys(zs || {}).forEach(function (z) { (zs[z] || []).forEach(function (w) { var f = PIECES[w.piece] && PIECES[w.piece][4]; if (f && out.indexOf(f) < 0) out.push(f); }); });
    });
    return out;
  }
  function widget(v, strict, zone) {
    if (!obj(v)) { if (strict) throw new Bad(); return null; }
    if ('id' in v && !('piece' in v)) {                  // a v1 widget: its piece and shape now
      var m = Object.prototype.hasOwnProperty.call(V1, v.id) ? V1[v.id] : null;
      if (!m) { if (strict) throw new Bad(); return null; }
      var nv = { piece: m[0], shape: m[1] };
      Object.keys(v).forEach(function (k) { if (k !== 'id') nv[k] = v[k]; });
      if (m[2]) nv.opts = Object.assign({}, m[2]);
      if (nv.color === 'white') nv.color = 'auto';
      if (nv.size === 100) delete nv.size;            // (v1's usual size: the row's one size now)
      v = nv;
    }
    var P = Object.prototype.hasOwnProperty.call(PIECES, v.piece) ? PIECES[v.piece] : null;
    if (!P || P[0].indexOf(v.shape) < 0) { if (strict) throw new Bad(); return null; }
    var out = { piece: v.piece, shape: v.shape, back: 'none', color: 'auto' };
    Object.keys(v).forEach(function (k) {
      if (k === 'piece' || k === 'shape') return;
      var val = v[k];
      if ((k === 'back' && BACKS.indexOf(val) >= 0) || (k === 'color' && COLORS.indexOf(val) >= 0) || (k === 'align' && ALIGNS.indexOf(val) >= 0)) out[k] = val;
      else if (k === 'title' && val === false) out.title = false;
      else if (k === 'size' && isInt(val) && val >= ITEM_SIZE[0] && val <= ITEM_SIZE[1]) { if (val !== 100 || zone === 'row') out.size = val; }
      else if (k === 'show' && showOk(val)) out.show = { entity: val.entity, op: val.op, value: val.value };
      else if (k === 'opts' && obj(val)) {
        var good = {}, n = 0;
        Object.keys(val).forEach(function (o) { if (P[1][o] && optOk(P[1][o], val[o])) { good[o] = val[o]; n++; } });
        if (strict && n !== Object.keys(val).length) throw new Bad();
        if (n) out.opts = good;
      }
      else if (strict) throw new Bad();
    });
    return out;
  }
  function zones(v, strict, rowSize) {
    var out = {};
    Object.keys(ZONES).forEach(function (z) { out[z] = []; });
    if (!obj(v)) { if (strict) throw new Bad(); return out; }
    Object.keys(v).forEach(function (z) {
      var items = v[z];
      if (!ZONES[z] || !Array.isArray(items)) { if (strict) throw new Bad(); return; }
      var used = 0;
      items.forEach(function (it) {
        var w = widget(it, strict, z);
        if (!w) return;
        var need = z === 'row' ? unitsOf(w, rowSize) : 1;
        if (ZONES[z][0].indexOf(w.shape) < 0 || used + need > ZONES[z][1] + 1e-9) { if (strict) throw new Bad(); return; }
        used += need;
        out[z].push(w);
      });
    });
    return out;
  }
  function upright(v, strict, rowSize) {
    if (v == null) return null;
    if (!obj(v) || Object.keys(v).some(function (k) { return k !== 'big' && k !== 'zones' && k !== 'row_at'; })) { if (strict) throw new Bad(); return null; }
    var out = {};
    if ('big' in v) out.big = big(v.big, strict);
    if ('zones' in v) out.zones = zones(v.zones, strict, rowSize);
    if ('row_at' in v) out.row_at = rowAt(v.row_at, strict);
    return out;
  }
  function rowAt(v, strict) {
    if (ROW_AT.indexOf(v) >= 0) return v;
    if (strict) throw new Bad();
    return ROW_AT[0];
  }
  function read(v, strict) {
    if (!obj(v) || (v.v !== 1 && v.v !== VERSION)) { if (strict) throw new Bad(); return null; }
    var keys = ['v', 'big', 'zones', 'row_at', 'upright'].concat(v.v === VERSION ? ['row_size', 'ink', 'accents'] : []);
    if (strict && Object.keys(v).some(function (k) { return keys.indexOf(k) < 0; })) throw new Bad();
    var two = v.v === VERSION;
    var rs = two && 'row_size' in v ? v.row_size : 100;
    if (!(isInt(rs) && rs >= ITEM_SIZE[0] && rs <= ITEM_SIZE[1])) { if (strict) throw new Bad(); rs = 100; }
    var ink = two && 'ink' in v ? v.ink : 'auto';
    if (INKS.indexOf(ink) < 0) { if (strict) throw new Bad(); ink = 'auto'; }
    var acc = two && 'accents' in v ? v.accents : true;
    if (typeof acc !== 'boolean') { if (strict) throw new Bad(); acc = true; }
    var out = { v: VERSION, big: big(v.big || {}, strict), zones: zones(v.zones || {}, strict, rs),
                row_at: rowAt('row_at' in v ? v.row_at : ROW_AT[0], strict), upright: upright(v.upright, strict, rs) };
    // (each stored only when it isn't the usual)
    if (rs !== 100) out.row_size = rs;
    if (ink !== 'auto') out.ink = ink;
    if (!acc) out.accents = false;
    return out;
  }
  // a stored layout as this build draws it (what it doesn't know is left out), or null
  function clean(v) { return read(v, false); }
  // null if `v` can be saved as it is, else the refusal's code
  function check(v) {
    if (v == null) return null;
    try { read(v, true); return null; } catch (e) { if (e instanceof Bad) return 'saver_layout'; throw e; }
  }
  // the room left in a zone, for one more of `id` (a catalog id, piece.shape) -- in the row, at the row's size
  function fits(zs, zone, id, rowSize) {
    var Z = ZONES[zone], c = CATALOG[id];
    if (!Z || !c || Z[0].indexOf(c[0]) < 0) return false;
    if (zone !== 'row') return (zs[zone] || []).length + 1 <= Z[1];
    var used = (zs.row || []).reduce(function (n, w) { return n + unitsOf(w, rowSize); }, 0);
    return used + unitsOf({ shape: c[0] }, rowSize) <= Z[1] + 1e-9;
  }

  // ------------------------------------------------------------ the slides (phase 2)
  // EACH SLIDE SAYS WHAT IT SHOWS (2026-11-02, the owner: "A slide needs only the Time, Date, Weather and House Status,
  // and only where they apply: the Weather slide needs no extra weather"); the slide corner adds the rest of the four
  var SLIDES = {
    music: { name: 'Music', shows: ['music'] },
    forecast: { name: 'Forecast, Classic', shows: ['weather'] },
    forecast_big: { name: 'Forecast, Big', shows: ['weather', 'time'] },
    weather: { name: 'Weather', shows: ['weather', 'readings'] },
    energy: { name: 'Home Energy', shows: ['energy'] }
  };
  var CORNER = ['time', 'date', 'weather', 'status'];
  function cornerFor(slide) { var s = SLIDES[slide]; return s ? CORNER.filter(function (f) { return s.shows.indexOf(f) < 0; }) : []; }

  // ------------------------------------------------------------ claiming (rule 5)
  // A FACT SHOWN ONCE (2026-11-02, the plan's rule 5): a face, the big element or a piece placed first that shows a
  // fact hides another piece showing it, and the editor says which shows it. -> { 'zone:i': 'the Today face' }
  // cfg: the screensaver's options (the face is clock_style)
  var FACE_FACTS = { today: ['weather', 'music'] };
  function claims(O, cfg) {
    var out = {}, seen = {}, zs = O.zones, b = O.big || {};
    var faceHas = b.kind === 'time' ? FACE_FACTS[(cfg || {}).clock_style] || [] : [];
    // (only what the face is set to show: Today's Weather and What's Playing can be turned off)
    if ((cfg || {}).clock_style === 'today') faceHas = faceHas.filter(function (f) { return !(f === 'weather' && cfg.clock_today_weather === false) && !(f === 'music' && cfg.clock_today_music === false); });
    var faceName = { today: 'the Today face' }[(cfg || {}).clock_style];
    // (Glance, Month and the Day face drawing their own words -- no big element of the layout's: what they show)
    var SHOW_FACTS = { glance: ['time', 'weather', 'music', 'date'], month: ['time', 'date'], day: ['date'] };
    if (b.kind === 'none' && SHOW_FACTS[(cfg || {}).show]) { faceHas = SHOW_FACTS[cfg.show]; faceName = 'the ' + { glance: 'Glance', month: 'Month', day: 'Day' }[cfg.show] + ' face'; }
    Object.keys(ZONES).forEach(function (z) {
      (zs[z] || []).forEach(function (w, i) {
        var facts = (PIECES[w.piece] || [])[3] || [];
        var by = null;
        if (facts.length && facts.every(function (f) { return faceHas.indexOf(f) >= 0; })) by = faceName;
        else if (b.kind === 'temp' && w.piece === 'weather' && (w.shape === 'inline' || w.shape === 'circular')) by = 'the big temperature';
        else if (b.kind === 'time' && w.piece === 'time') by = 'the big time';
        // (the same piece, shape and options twice: Battery and Solar are one piece with two readings, both shown)
        var same = idOf(w) + JSON.stringify(w.opts || {});
        if (!by && seen[same]) by = 'the ' + PIECES[w.piece][2] + ' already placed';
        if (by) out[z + ':' + i] = by;
        else seen[same] = true;
      });
    });
    return out;
  }

  // ------------------------------------------------------------ today's options as a layout
  // The editor's starting point for a screen with no layout yet: the big element and the corners each Show draws
  // today, and the corner cards it has switched on (clock, weather, music, timers, status)
  function layoutFrom(o) {
    o = o || {};
    var on = function (k) { return o[k] !== false; };
    var W = function (id) { return widget({ id: id }, false, null); };
    var L = { v: VERSION, big: Object.assign({}, BIG_DEFAULT), zones: {}, row_at: 'under', upright: null };
    Object.keys(ZONES).forEach(function (z) { L.zones[z] = []; });
    var z = L.zones, show = o.show || 'photos', b = L.big;
    var corners = function (tl) {
      if (tl) tl.forEach(function (id) { if (z.tl.length < 2) z.tl.push(W(id)); });
      if (on('status')) z.tr.push(W('status_card'));
      if (on('music')) z.bl.push(W('music_card'));
      if (on('timers')) z.br.push(W('timers_card'));
    };
    if (show === 'clock') {
      b.kind = 'time'; b.size = 36; b.pos = 'center';
      corners(on('weather') ? ['weather_card'] : []);
    } else if (show === 'glance') {
      b.kind = 'date'; b.size = 28; b.pos = 'top'; b.align = 'left';
      z.tr.push(W('clock_card'));
      if (on('music')) z.bl.push(W('music_card'));
      z.br.push(W('weather_card'));
    } else if (show === 'month') {
      b.kind = 'month'; b.size = 34; b.pos = 'center';
      z.tr.push(W('clock_card'));
    } else if (show === 'day') {
      b.kind = 'date'; b.size = 34; b.pos = 'center';
      z.tr.push(W('clock_card')); z.br.push(W('weather_card'));
    } else if (show === 'forecast' && o.forecast_layout === 'big') {
      b.kind = o.forecast_big === 'clock' ? 'time' : 'temp'; b.size = 40; b.pos = 'ground'; b.align = 'left';
      b.depth = b.kind === 'time' && o.forecast_planted !== false ? 'planted' : 'front';
      z.tl.push(W('weather_line'));
      corners(null);
      z.bottom.push(W('readings'));
    } else if (show === 'forecast') {
      if (o.clock !== false && o.clock_over === 'large') { b.kind = 'time'; b.size = 30; b.pos = 'upper'; }
      else b.kind = 'none';
      corners(b.kind === 'none' && on('clock') ? ['clock_card'] : []);
      if (o.band !== false) z.bottom.push(W('forecast_band'));
    } else {                                   // photos, and photos with the forecast between
      if (o.time_behind) {
        b.kind = 'time'; b.size = Math.max(12, Math.min(44, o.tb_size || 24)); b.depth = 'behind';
        b.pos = (o.tb_top || 0) <= 12 ? 'top' : (o.tb_top || 0) <= 30 ? 'upper' : 'center';
        corners(on('weather') ? ['weather_card'] : []);
      } else if (o.clock !== false && o.clock_over === 'large') {
        b.kind = 'time'; b.size = 30; b.pos = 'center';
        corners(on('weather') ? ['weather_card'] : []);
      } else {
        b.kind = 'none';
        corners([].concat(on('clock') ? ['clock_card'] : [], on('weather') ? ['weather_card'] : []));
      }
      if (o.photo_titles) z.line.push(W('photo_title'));
    }
    return L;
  }

  // the layout for a screen this shape: upright (taller than wide) takes `upright`'s parts where it has its own
  function oriented(L, W, H) {
    var up = H > W && L && L.upright;
    return { big: Object.assign({}, L.big, up && up.big), zones: (up && up.zones) || L.zones,
             row_at: (up && up.row_at) || L.row_at || 'under', row_size: L.row_size || 100 };
  }

  // ------------------------------------------------------------ the plan
  // A card's size when it isn't measured, in units (1 = 1 % of the room's shorter side): [w, h]
  var CARD = { 'time.card': [18, 8], 'music.card': [34, 10], 'timers.card': [28, 10], 'weather.card': [28, 10], 'status.card': [32, 10],
               'date.inline': [32, 3.6], 'weather.inline': [26, 3.6], 'status.inline': [32, 3.6], 'events.inline': [30, 3.6], 'title.inline': [28, 3.6] };
  var BAND = { 'weather.band': 15, 'readings.band': 10 };
  //   room     {x, y, w, h}: where the layout draws (the screen less the Side Pane)
  //   O        oriented(): { big, zones }
  //   measure  { big: {w, h, base, t, b} | null -- the big element as drawn (base: its baseline, from its top);
  //              widget(w, zone, i) -> {w, h, t, b} | null -- a piece as drawn } -- sizes this file can't know (faces, fonts).
  //              t and b: how far its ink is inside its box, at the top and the bottom (a line's room above and
  //              below its letters): THINGS LINE UP BY THEIR INK (2026-11-01, the owner: "alignment is key here...
  //              not a lot of things align correctly") -- the big element's top with the top corners' first, the
  //              bottom corners' last on one line
  //   screen   {w, h}: the whole screen (the land covers it, for On the Ground)
  // -> { u, m, col, big, line, row: {box, items}, corners: {tl: [...], ...}, bottom, moved: [{zone, i, to}] }
  //    every box {x, y, w, h}; ghosts (an empty zone the editor shows) are flagged; a hidden card is in `moved`
  //    with to: null and no box
  function plan(room, O, measure, screen) {
    measure = measure || {};
    screen = screen || { w: room.w, h: room.h };
    var u = Math.min(room.w, room.h) / 100, m = 6 * u, gap = 2.2 * u, zs = O.zones, b = O.big;
    var size = function (w, zone, i) {
      var got = measure.widget && measure.widget(w, zone, i);
      if (got && got.w && got.h) return got;
      var c = CARD[idOf(w)] || [26, 5], k = (w.size || 100) / 100;
      return { w: c[0] * u * k, h: c[1] * u * k };
    };
    var hasBig = b.kind !== 'none' && !!measure.big && measure.big.w > 0;
    var bigS = hasBig ? measure.big : { w: 0, h: 0, base: 0 };
    var lineS = zs.line.length ? size(zs.line[0], 'line', 0) : null, lineH = lineS ? lineS.h : 0, lineW = lineS ? lineS.w : 0;
    var unit = 13 * u, rgap = 3 * u;
    // THE ROW: each widget its units wide, times its own size, in lines of four units (a fifth starts a second line);
    // under the big element, or along the bottom of the screen (O.row_at)
    var rowLines = [], cur = null;
    zs.row.forEach(function (w, i) {
      var n = unitsOf(w, O.row_size), k = (w.size || O.row_size || 100) / 100;
      if (!cur || cur.units + n > ROW_LINE) { cur = { units: 0, items: [], w: 0, h: 0 }; rowLines.push(cur); }
      var it = { i: i, w: ((UNITS[w.shape] || 1) === 2 ? 2 * unit + rgap : unit) * k, h: unit * k };
      cur.units += n; cur.w += (cur.items.length ? rgap : 0) + it.w; cur.h = Math.max(cur.h, it.h);
      cur.items.push(it);
    });
    var rowH = rowLines.reduce(function (n, L, j) { return n + (j ? rgap : 0) + L.h; }, 0);
    var rowW = rowLines.reduce(function (n, L) { return Math.max(n, L.w); }, 0);
    var rowDown = O.row_at === 'bottom';
    var bandH = zs.bottom.length ? (BAND[idOf(zs.bottom[0])] || 10) * u * ((zs.bottom[0].size || 100) / 100) : 0;
    var colH = (lineH ? lineH + gap : 0) + bigS.h + (rowH && !rowDown ? 1.4 * gap + rowH : 0);
    var colW = Math.max(bigS.w, rowDown ? 0 : rowW, lineW);
    // (the column's first thing's ink on the top margin, as the top corners' are)
    var inkTop = lineH ? (lineS.t || 0) : (bigS.t || 0);
    var top;
    if (b.pos === 'top') top = room.y + m - inkTop;
    else if (b.pos === 'upper') top = room.y + room.h * 0.3 - colH / 2;
    else if (b.pos === 'lower') top = room.y + room.h * 0.64 - colH / 2;
    else if (b.pos === 'ground') {
      // the land covers the screen from its foot (hk-sky.js .land, 2560 x 1600): its ground line is 68 % down it
      var k = Math.max(screen.w / 2560, screen.h / 1600);
      var ground = screen.h - 1600 * k * 0.32;
      top = ground - (bigS.base || bigS.h * 0.8) - (lineH ? lineH + gap : 0);
    } else top = room.y + room.h * 0.48 - colH / 2;
    top = Math.max(room.y + m - inkTop, Math.min(room.y + room.h - m - colH - (bandH ? bandH + gap : 0), top));
    var cx = b.align === 'left' ? room.x + m + colW / 2 : b.align === 'right' ? room.x + room.w - m - colW / 2 : room.x + room.w / 2;
    var P = { u: u, m: m, gap: gap, moved: [], corners: {} };
    P.col = { x: cx - colW / 2, y: top, w: colW, h: colH };
    P.big = hasBig ? { x: cx - bigS.w / 2, y: top + (lineH ? lineH + gap : 0), w: bigS.w, h: bigS.h } : null;
    P.line = lineH ? { x: cx - lineW / 2, y: top, w: lineW, h: lineH }
                   : { x: cx - 20 * u, y: top - 3.6 * u - gap, w: 40 * u, h: 3.6 * u, ghost: true };
    var foot0 = room.y + room.h - m - (bandH ? bandH + gap : 0), mid = room.x + room.w / 2;
    var rowBox = rowDown ? (rowH ? { x: mid - rowW / 2, y: foot0 - rowH, w: rowW, h: rowH }
                                 : { x: mid - 27 * u, y: foot0 - unit, w: 54 * u, h: unit, ghost: true })
                         : (rowH ? { x: cx - rowW / 2, y: top + colH - rowH, w: rowW, h: rowH }
                                 : { x: cx - 27 * u, y: top + colH + 1.4 * gap, w: 54 * u, h: unit, ghost: true });
    var items = [], ry = rowBox.y;
    rowLines.forEach(function (L) {
      var x = rowBox.x + (rowBox.w - L.w) / 2;
      L.items.forEach(function (it) { items.push({ i: it.i, x: x, y: ry + (L.h - it.h) / 2, w: it.w, h: it.h }); x += it.w + rgap; });
      ry += L.h + rgap;
    });
    P.row = { box: rowBox, at: rowDown ? 'bottom' : 'under', items: items };
    P.bottom = bandH ? { x: room.x + m, y: room.y + room.h - m - bandH, w: room.w - 2 * m, h: bandH }
                     : { x: room.x + m, y: room.y + room.h - m - 10 * u, w: room.w - 2 * m, h: 10 * u, ghost: true };
    // the corners, stacked from the edges; one the column reaches goes to the other end of its side
    var pad = 1.5 * u, colBox = { x: P.col.x - pad, y: P.col.y - pad, w: P.col.w + 2 * pad, h: P.col.h + 2 * pad };
    var hit = function (a, c) { return !(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y); };
    var foot = foot0;
    // each corner's cards, as wide and tall as they are, at their side's edge (a card's own size is in what is
    // measured: the screensaver draws it that size)
    var stacks = { tl: [], tr: [], bl: [], br: [] }, movers = [];
    ['tl', 'tr', 'bl', 'br'].forEach(function (zone) {
      zs[zone].forEach(function (w, i) {
        var sz = size(w, zone, i);
        stacks[zone].push({ zone: zone, i: i, w: sz.w, h: sz.h, t: sz.t || 0, b: sz.b || 0, x: zone[1] === 'l' ? room.x + m : room.x + room.w - m - sz.w });
      });
    });
    // stacked from the edge at one end: the two sides apart -- or, where a card of one side would reach one of the
    // other's (a narrow screen, wide cards), as one stack, the left side's first
    var place = function (end) {
      var L = stacks[end + 'l'], R = stacks[end + 'r'];
      var down = end === 't', start = down ? room.y + m : foot;
      // (the first from the edge by its ink: its letters on the margin, not the room above them)
      var run = function (list, y) {
        list.forEach(function (c, j) {
          if (down) { c.y = y - (j ? 0 : c.t); y = c.y + c.h + gap; } else { c.y = y - c.h + (j ? 0 : c.b); y = c.y - gap; }
        });
        return y;
      };
      run(L, start); run(R, start);
      var clash = L.some(function (a) { return R.some(function (b) { return hit(a, b); }); });
      if (clash) run(R, run(L, start));
    };
    // (the row along the bottom: the bottom corners beside it, or over it where they would meet)
    var placeB = function () {
      foot = foot0;
      place('b');
      if (rowDown && rowH && ['bl', 'br'].some(function (z) { return stacks[z].some(function (c) { return hit(c, rowBox); }); })) {
        foot = rowBox.y - gap;
        place('b');
      }
    };
    place('t'); placeB();
    // a card the column reaches goes to the other end of its side, after what is there
    ['tl', 'tr', 'bl', 'br'].forEach(function (zone) {
      stacks[zone] = stacks[zone].filter(function (c) {
        if (hasBig && hit(c, colBox)) { movers.push(c); return false; }
        return true;
      });
    });
    movers.forEach(function (c) { var other = (c.zone[0] === 't' ? 'b' : 't') + c.zone[1]; c.to = other; stacks[other].push(c); });
    if (movers.length) { place('t'); placeB(); }
    ['tl', 'tr', 'bl', 'br'].forEach(function (end) {
      stacks[end].forEach(function (c) {
        if (c.to && hasBig && hit(c, colBox)) { P.moved.push({ zone: c.zone, i: c.i, to: null }); return; }
        if (c.to) P.moved.push({ zone: c.zone, i: c.i, to: c.to });
        (P.corners[c.zone] = P.corners[c.zone] || []).push({ i: c.i, x: c.x, y: c.y, w: c.w, h: c.h });
      });
    });
    // an empty corner's place, for the editor (where its first card would go, unless a moved one is there)
    P.ghosts = {};
    ['tl', 'tr', 'bl', 'br'].forEach(function (zone) {
      if (zs[zone].length) return;
      var taken = P.moved.some(function (mv) { return mv.to === zone; });
      if (taken) return;
      var w = 24 * u, h = 7 * u, left = zone[1] === 'l';
      P.ghosts[zone] = { x: left ? room.x + m : room.x + room.w - m - w, y: zone[0] === 't' ? room.y + m : foot0 - h, w: w, h: h, ghost: true };
    });
    return P;
  }

  window.hkSaverLayout = {
    VERSION: VERSION, PIECES: PIECES, SHAPES: SHAPES, SHAPE_NAMES: SHAPE_NAMES, V1: V1, CATALOG: CATALOG, ZONES: ZONES, ZONE_NAMES: ZONE_NAMES,
    UNITS: UNITS, BIG: BIG, BIG_DEFAULT: BIG_DEFAULT, BACKS: BACKS, COLORS: COLORS, ALIGNS: ALIGNS, ITEM_SIZE: ITEM_SIZE, ROW_AT: ROW_AT, ROW_LINE: ROW_LINE,
    INKS: INKS, clean: clean, check: check, fits: fits, layoutFrom: layoutFrom, oriented: oriented, plan: plan, claims: claims,
    SLIDES: SLIDES, cornerFor: cornerFor,
    idOf: idOf, item: item, unitsOf: unitsOf, SHOW_OPS: SHOW_OPS, met: met, filesOf: filesOf, CITIES: CITIES,
    // every group's file, for the editor's library
    FILES: Object.keys(PIECES).map(function (p) { return PIECES[p][4]; }).filter(function (f, i, a) { return f && a.indexOf(f) === i; })
  };
})();
