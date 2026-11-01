// hk-saverlayout.js -- THE SCREENSAVER'S LAYOUT (2026-11-01, the owner: "Lets do the editor!";
// docs/phase12/SCREENSAVER-EDITOR.md): one background, one big element, and widgets in zones -- the model the
// Screensaver editor saves (the screensaver options' `layout`) and the plan both it and the screensaver draw by.
//
// The background is not here: it stays in the options it always was (show, clock_bg, the photo and forecast keys),
// and so do the time's face, colors and 24-hour time. A layout holds what had no option: what the big element is,
// its size, place and depth, and the widgets in each zone.
//
// CATALOG and ZONES are mirrored by hk_core/settings/saver_layout.py, kept equal by a test; clean() is its
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

  var VERSION = 1;
  // [id] -> [kind, name, what it shows] (the kinds: hk_core/settings/saver_layout.py CATALOG)
  var CATALOG = {
    temp: ['circular', 'Temperature', 'Now, with today’s range'],
    aqi: ['circular', 'Air Quality', 'AQI on its scale'],
    humidity: ['circular', 'Humidity', 'Outside'],
    inside: ['circular', 'Inside', 'The house’s temperature'],
    battery: ['circular', 'Home Battery', 'Its charge'],
    solar: ['circular', 'Solar', 'Producing now'],
    timer: ['circular', 'Timer', 'Time left'],
    locks: ['circular', 'Locks', 'Locked or not'],
    sunset: ['circular', 'Sunset', 'The next sunrise or sunset'],
    next_event: ['rectangular', 'Up Next', 'Your next event'],
    next_hours: ['rectangular', 'Next Hours', 'The forecast'],
    home_status: ['rectangular', 'Home Status', 'Security, doors and locks'],
    energy_today: ['rectangular', 'Energy Today', 'Used and made'],
    date: ['inline', 'Date', 'The weekday and the date'],
    weather_line: ['inline', 'Weather', 'The condition and temperature'],
    status_line: ['inline', 'Home Status', 'In one line'],
    event_line: ['inline', 'Up Next', 'Your next event'],
    photo_title: ['inline', 'Photo Title', 'The album and the year'],
    clock_card: ['card', 'Clock', 'A small time'],
    music_card: ['card', 'Now Playing', 'While something plays'],
    timers_card: ['card', 'Timers', 'While a timer runs'],
    weather_card: ['card', 'Weather', 'The temperature and condition'],
    status_card: ['card', 'Home Status', 'As a card'],
    forecast_band: ['band', 'Forecast Details', 'Today, the hours and the days'],
    readings: ['band', 'Readings', 'Sunset, wind, humidity and AQI']
  };
  // [zone] -> [the kinds it takes, its room]; the row's room is in units (circular 1, rectangular 2). The pane down
  // the side is the Side Pane's, with settings of its own: not a zone
  var ZONES = {
    line: [['inline'], 1],
    row: [['circular', 'rectangular'], 4],
    tl: [['card', 'inline'], 2], tr: [['card', 'inline'], 2],
    bl: [['card'], 2], br: [['card'], 2],
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
  var BACKS = ['none', 'glass', 'tint'], COLORS = ['auto', 'white', 'accent'];

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
  function widget(v, strict) {
    if (!obj(v) || !Object.prototype.hasOwnProperty.call(CATALOG, v.id)) { if (strict) throw new Bad(); return null; }
    var out = { id: v.id, back: 'none', color: 'auto' };
    Object.keys(v).forEach(function (k) {
      if (k === 'id') return;
      if ((k === 'back' && BACKS.indexOf(v[k]) >= 0) || (k === 'color' && COLORS.indexOf(v[k]) >= 0)) out[k] = v[k];
      else if (strict) throw new Bad();
    });
    return out;
  }
  function zones(v, strict) {
    var out = {};
    Object.keys(ZONES).forEach(function (z) { out[z] = []; });
    if (!obj(v)) { if (strict) throw new Bad(); return out; }
    Object.keys(v).forEach(function (z) {
      var items = v[z];
      if (!ZONES[z] || !Array.isArray(items)) { if (strict) throw new Bad(); return; }
      var used = 0;
      items.forEach(function (it) {
        var w = widget(it, strict);
        if (!w) return;
        var kind = CATALOG[w.id][0], need = UNITS[kind] || 1;
        if (ZONES[z][0].indexOf(kind) < 0 || used + need > ZONES[z][1]) { if (strict) throw new Bad(); return; }
        used += need;
        out[z].push(w);
      });
    });
    return out;
  }
  function upright(v, strict) {
    if (v == null) return null;
    if (!obj(v) || Object.keys(v).some(function (k) { return k !== 'big' && k !== 'zones'; })) { if (strict) throw new Bad(); return null; }
    var out = {};
    if ('big' in v) out.big = big(v.big, strict);
    if ('zones' in v) out.zones = zones(v.zones, strict);
    return out;
  }
  function read(v, strict) {
    if (!obj(v) || v.v !== VERSION) { if (strict) throw new Bad(); return null; }
    if (strict && Object.keys(v).some(function (k) { return ['v', 'big', 'zones', 'upright'].indexOf(k) < 0; })) throw new Bad();
    return { v: VERSION, big: big(v.big || {}, strict), zones: zones(v.zones || {}, strict), upright: upright(v.upright, strict) };
  }
  // a stored layout as this build draws it (what it doesn't know is left out), or null
  function clean(v) { return read(v, false); }
  // null if `v` can be saved as it is, else the refusal's code
  function check(v) {
    if (v == null) return null;
    try { read(v, true); return null; } catch (e) { if (e instanceof Bad) return 'saver_layout'; throw e; }
  }
  // the room left in a zone, for one more of `id`
  function fits(zs, zone, id) {
    var Z = ZONES[zone], c = CATALOG[id];
    if (!Z || !c || Z[0].indexOf(c[0]) < 0) return false;
    var used = (zs[zone] || []).reduce(function (n, w) { return n + (UNITS[(CATALOG[w.id] || [''])[0]] || 1); }, 0);
    return used + (UNITS[c[0]] || 1) <= Z[1];
  }

  // ------------------------------------------------------------ today's options as a layout
  // The editor's starting point for a screen with no layout yet: the big element and the corners each Show draws
  // today, and the corner cards it has switched on (clock, weather, music, timers, status)
  function layoutFrom(o) {
    o = o || {};
    var on = function (k) { return o[k] !== false; };
    var W = function (id) { return { id: id, back: 'none', color: 'auto' }; };
    var L = { v: VERSION, big: Object.assign({}, BIG_DEFAULT), zones: {}, upright: null };
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
    return { big: Object.assign({}, L.big, up && up.big), zones: (up && up.zones) || L.zones };
  }

  // ------------------------------------------------------------ the plan
  // A card's size when it isn't measured, in units (1 = 1 % of the room's shorter side): [w, h]
  var CARD = { clock_card: [18, 6], music_card: [34, 8], timers_card: [24, 8], weather_card: [26, 5], status_card: [32, 5],
               date: [32, 3.6], weather_line: [26, 3.6], status_line: [32, 3.6], event_line: [30, 3.6], photo_title: [28, 3.6] };
  var BAND = { forecast_band: 15, readings: 10 };
  //   room     {x, y, w, h}: where the layout draws (the screen less the Side Pane)
  //   O        oriented(): { big, zones }
  //   measure  { big: {w, h, base} | null -- the big element as drawn (base: its baseline, from its top);
  //              widget(id) -> {w, h} | null -- a widget as drawn } -- sizes this file can't know (faces, fonts)
  //   screen   {w, h}: the whole screen (the land covers it, for On the Ground)
  // -> { u, m, col, big, line, row: {box, items}, corners: {tl: [...], ...}, bottom, moved: [{zone, i, to}] }
  //    every box {x, y, w, h}; ghosts (an empty zone the editor shows) are flagged; a hidden card is in `moved`
  //    with to: null and no box
  function plan(room, O, measure, screen) {
    measure = measure || {};
    screen = screen || { w: room.w, h: room.h };
    var u = Math.min(room.w, room.h) / 100, m = 6 * u, gap = 2.2 * u, zs = O.zones, b = O.big;
    var size = function (id) {
      var got = measure.widget && measure.widget(id);
      if (got && got.w && got.h) return got;
      var c = CARD[id] || [26, 5];
      return { w: c[0] * u, h: c[1] * u };
    };
    var hasBig = b.kind !== 'none' && !!measure.big && measure.big.w > 0;
    var bigS = hasBig ? measure.big : { w: 0, h: 0, base: 0 };
    var lineH = zs.line.length ? size(zs.line[0].id).h : 0, lineW = zs.line.length ? size(zs.line[0].id).w : 0;
    var unit = 13 * u, rgap = 3 * u;
    var units = zs.row.reduce(function (n, w) { return n + (UNITS[CATALOG[w.id][0]] || 1); }, 0);
    var rowH = zs.row.length ? unit : 0, rowW = zs.row.length ? units * unit + (zs.row.length - 1) * rgap : 0;
    var bandH = zs.bottom.length ? (BAND[zs.bottom[0].id] || 10) * u : 0;
    var colH = (lineH ? lineH + gap : 0) + bigS.h + (rowH ? 1.4 * gap + rowH : 0);
    var colW = Math.max(bigS.w, rowW, lineW);
    var top;
    if (b.pos === 'top') top = room.y + m;
    else if (b.pos === 'upper') top = room.y + room.h * 0.3 - colH / 2;
    else if (b.pos === 'lower') top = room.y + room.h * 0.64 - colH / 2;
    else if (b.pos === 'ground') {
      // the land covers the screen from its foot (hk-sky.js .land, 2560 x 1600): its ground line is 68 % down it
      var k = Math.max(screen.w / 2560, screen.h / 1600);
      var ground = screen.h - 1600 * k * 0.32;
      top = ground - (bigS.base || bigS.h * 0.8) - (lineH ? lineH + gap : 0);
    } else top = room.y + room.h * 0.48 - colH / 2;
    top = Math.max(room.y + m, Math.min(room.y + room.h - m - colH - (bandH ? bandH + gap : 0), top));
    var cx = b.align === 'left' ? room.x + m + colW / 2 : b.align === 'right' ? room.x + room.w - m - colW / 2 : room.x + room.w / 2;
    var P = { u: u, m: m, gap: gap, moved: [], corners: {} };
    P.col = { x: cx - colW / 2, y: top, w: colW, h: colH };
    P.big = hasBig ? { x: cx - bigS.w / 2, y: top + (lineH ? lineH + gap : 0), w: bigS.w, h: bigS.h } : null;
    P.line = lineH ? { x: cx - lineW / 2, y: top, w: lineW, h: lineH }
                   : { x: cx - 20 * u, y: top - 3.6 * u - gap, w: 40 * u, h: 3.6 * u, ghost: true };
    var rowBox = rowH ? { x: cx - rowW / 2, y: top + colH - rowH, w: rowW, h: rowH }
                      : { x: cx - 27 * u, y: top + colH + 1.4 * gap, w: 54 * u, h: unit, ghost: true };
    var x = rowBox.x;
    P.row = { box: rowBox, items: zs.row.map(function (w, i) {
      var wd = (UNITS[CATALOG[w.id][0]] || 1) === 2 ? 2 * unit + rgap : unit, it = { i: i, x: x, y: rowBox.y, w: wd, h: unit };
      x += wd + rgap;
      return it;
    }) };
    P.bottom = bandH ? { x: room.x + m, y: room.y + room.h - m - bandH, w: room.w - 2 * m, h: bandH }
                     : { x: room.x + m, y: room.y + room.h - m - 10 * u, w: room.w - 2 * m, h: 10 * u, ghost: true };
    // the corners, stacked from the edges; one the column reaches goes to the other end of its side
    var pad = 1.5 * u, colBox = { x: P.col.x - pad, y: P.col.y - pad, w: P.col.w + 2 * pad, h: P.col.h + 2 * pad };
    var hit = function (a, c) { return !(a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y); };
    var foot = room.y + room.h - m - (bandH ? bandH + gap : 0);
    // each corner's cards, as wide and tall as they are, at their side's edge
    var stacks = { tl: [], tr: [], bl: [], br: [] }, movers = [];
    ['tl', 'tr', 'bl', 'br'].forEach(function (zone) {
      zs[zone].forEach(function (w, i) {
        var sz = size(w.id);
        stacks[zone].push({ zone: zone, i: i, w: sz.w, h: sz.h, x: zone[1] === 'l' ? room.x + m : room.x + room.w - m - sz.w });
      });
    });
    // stacked from the edge at one end: the two sides apart -- or, where a card of one side would reach one of the
    // other's (a narrow screen, wide cards), as one stack, the left side's first
    var place = function (end) {
      var L = stacks[end + 'l'], R = stacks[end + 'r'];
      var down = end === 't', start = down ? room.y + m : foot;
      var run = function (list, y) {
        list.forEach(function (c) { if (down) { c.y = y; y += c.h + gap; } else { c.y = y - c.h; y = c.y - gap; } });
        return y;
      };
      run(L, start); run(R, start);
      var clash = L.some(function (a) { return R.some(function (b) { return hit(a, b); }); });
      if (clash) run(R, run(L, start));
    };
    place('t'); place('b');
    // a card the column reaches goes to the other end of its side, after what is there
    ['tl', 'tr', 'bl', 'br'].forEach(function (zone) {
      stacks[zone] = stacks[zone].filter(function (c) {
        if (hasBig && hit(c, colBox)) { movers.push(c); return false; }
        return true;
      });
    });
    movers.forEach(function (c) { var other = (c.zone[0] === 't' ? 'b' : 't') + c.zone[1]; c.to = other; stacks[other].push(c); });
    if (movers.length) { place('t'); place('b'); }
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
      P.ghosts[zone] = { x: left ? room.x + m : room.x + room.w - m - w, y: zone[0] === 't' ? room.y + m : foot - h, w: w, h: h, ghost: true };
    });
    return P;
  }

  window.hkSaverLayout = {
    VERSION: VERSION, CATALOG: CATALOG, ZONES: ZONES, ZONE_NAMES: ZONE_NAMES, UNITS: UNITS, BIG: BIG, BIG_DEFAULT: BIG_DEFAULT,
    BACKS: BACKS, COLORS: COLORS, clean: clean, check: check, fits: fits, layoutFrom: layoutFrom, oriented: oriented, plan: plan
  };
})();
