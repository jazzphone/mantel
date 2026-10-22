// hk-saver.js -- HK Frontend's photo screensaver, for a wall tablet's own user.
//
// WHAT IT IS
// A generated wall tablet's screen (Screens -> the screen -> Behavior ->
// Photo Screensaver, with a Tablet User) gets `hk_screensaver:` in its
// dashboard config (hk-strategy.js hkSaver()); a YAML dashboard can write the
// same block, or get it from its screen's HK settings (fromSettings below).
// After the screen has been left alone for `starts_after` seconds -- or the
// moment its switch turns on -- the house's photos cross-fade
// full screen, with the clock, the weather, what is playing and the running
// timers over them (the same HK cards the header and the pages use). A touch
// takes it away again, and does not press whatever was under the finger.
//
// Written for HK Frontend from its own plan (hk_house/docs/PLAN-HK-SCREENSAVER.md)
// and from how the tablets behave; it replaces WallPanel (HACS), which a
// screen can still choose instead (screensaver_engine).
//
// THE SWITCH (input_boolean.wallpanel_screensaver_<room>, the name kept from
// the WallPanel days so no automation changes) is two-way, exactly as the
// house's tablet scripts and want sensor expect:
//   * the screensaver starting by itself turns it ON; a touch turns it OFF --
//     the only way a tablet gets back to photos while it is awake;
//   * the house turning it on (the sleep script, under Fully's dark) starts
//     the screensaver; turning it off (wake, the doorbell) stops it.
// Only the tablet's own user ever runs this, so only the tablet writes it: a
// desk opening the same dashboard never gets a screensaver and never touches
// the switch.
//
// WHAT IT COSTS. Nothing while the dashboard is in use: no element, no timer
// but one idle timeout, no listener work beyond noting the time. While the
// photos show, only the 3 s cross-fade animates, once per photo; the sky and
// every card behind the photos hold still (hk-sky `hidden`, hk-base
// `hk-asleep`), which on a wall tablet's WebView is what lets the page stop
// drawing frames between photos.
(function () {
  'use strict';
  if (window.hkSaver) return;              // hk-loader may import this twice

  // ------------------------------------------------------------ constants
  var FADE_IN_MS = 3000;                   // the screensaver appears
  // BACK TO THE DASHBOARD (option fade_back, ms; 0: no fade). A touch, the
  // switch turned off by the house, or the console -- all the same fade.
  var FADE_BACK_MS = 500;
  // ...and first, the dashboard drawn UNDER the screensaver. It was hidden
  // (coverDashboard) and its graphics let go; shown again in the same frame
  // the fade starts, it painted in pieces under the fading photo -- the sky,
  // then the scenes, the cameras last (headless frames, 2026-10-04). An
  // opaque layer over it would keep the browser from drawing it at all
  // (it is occluded), so for this hold the screensaver is 99 % opaque.
  // (an object, so the tests and a probe can change them)
  var WAKE = { hold: 150,                  // after two frames, this much more
               max: 600,                   // no frame by then: not being drawn
               lit: 400 };                 // ...and the hold once it is again
  var CROSSFADE_MS = 3000;                 // photo to photo
  var MU_ART_MS = 900;                     // the music: one song's art to the next
  // AFTER A TOUCH STOPS IT, ONLY THAT TOUCH IS SWALLOWED: it stops on the
  // finger landing, so the screensaver stays (invisible, catching taps)
  // until the dashboard has faded back AND that finger has lifted, then
  // GHOST_MS more for the click a browser makes of a touch after it. It
  // was WallPanel's 3 s of every tap ignored (control_reactivation_time),
  // and the dashboard seemed slow to answer after a wake (2026-10-10).
  // A finger held down is waited for, at most PRESS_MAX.
  var GHOST_MS = 400, PRESS_MAX = 5000;
  var EDGE = 0.15;                         // left/right 15 %: previous/next photo
  var LIST_TTL_MS = 30 * 60 * 1000;        // re-list the folder
  var LIST_MAX = 5000, LIST_DEPTH = 3;
  var ECHO_MS = 6000;                      // our own switch write coming back
  var MOVE_PX = 12;                        // a mouse has to MOVE, not jitter
  var ZOOM = 1.1;                          // Slow Zoom's end scale
  var DEFAULT_CARD_WIDTH = 600;
  // THE FORECAST DETAILS' ZONE: the meadow, below the land's tree line --
  // 35.6 % of the art from its bottom (the 2560x1600 landscapes). The art
  // covers the screen from the bottom, so that is 35.6 % of the height on a
  // screen no wider than 16:10, and of the width / 1.6 on a wider one. The
  // details are centred in it, up and down and side to side.
  var BAND_ZONE = 'max(35.6vh,22.25vw)';
  var BAND_PAD = 16;                       // ...never nearer the bottom than this
  // THE SAME BAND ON EVERY SCREEN: laid out as on a 1280x800 tablet (1280
  // less the 30 px sides) and, on a bigger screen, scaled up to it whole --
  // never its hours and days stretched apart, never left small
  var BAND_MAX = 1220, BAND_W = 1280, BAND_H = 800;
  // THE CALENDAR PANE (1.4, option `calendar`): 400 px down the right of a
  // 1280 x 800 tablet, scaled with the band on a bigger screen. The photos
  // (or the forecast) take the rest; beside the pane the forecast details
  // stand up, as on a phone, no wider than BAND_STACKED.
  var PANE_W = 400, BAND_STACKED = 680, BAND_PAD_STACKED = 30;
  // ...since 1.4.3 side by side there too, as on every other screen: today's column this wide (the
  // tablet's band has 300), the band as wide as the photos' room allows
  var BAND_NOW_BESIDE = 200, BAND_BESIDE_GUTTER = 30;
  // the forecast details fade in once in place (addBand)
  var BAND_REVEAL_MS = 260;
  var PANE_TOP = 74;                       // Home Status sits above the list (at least)
  var PANE_RESET_MS = 45000;               // untouched this long: back to today

  // ------------------------------------------------------------ pure helpers
  // (exported on hkSaver._ for tests/test_saver.js)
  // the mosaic's lines (settings.py MOSAIC_COLORS)
  var MOSAIC_COLORS = { black: '#000000', white: '#f5f5f2', gray: '#8e8e93', charcoal: '#2c2c2e', cream: '#efe6d2', navy: '#1c2a44' };
  var CLOCK_BGS = ['black', 'grain', 'gradient', 'aurora', 'ink', 'sky', 'lowpoly', 'topo', 'constellation', 'forecast', 'skyonly', 'photos', 'landscapes'];
  // LANDSCAPES (1.8.1): HK Frontend's own photos behind the clock, from
  // /hk/landscapes/ (index.json lists them; a home's own files folder can
  // answer with its own list), shown the way Photos shows yours
  var LANDSCAPES = '/hk/landscapes/';
  function landscapes() { return !!(cfg && cfg.show === 'clock' && cfg.clock_bg === 'landscapes'); }
  var FOCUS_X = { left: '0%', center: '50%', right: '100%' }, FOCUS_Y = { top: '0%', center: '50%', bottom: '100%' };
  function shapeCfg(raw, side, fill) {
    var n = function (v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? v : d; };
    return { fill: fill, blur: n(raw[side + '_blur'], 0, 100, 50), dim: n(raw[side + '_dim'], 0, 80, 20),
             zoom: n(raw[side + '_zoom'], 100, 200, 100),
             x: FOCUS_X[raw[side + '_x']] ? raw[side + '_x'] : 'center', y: FOCUS_Y[raw[side + '_y']] ? raw[side + '_y'] : 'center' };
  }
  function readCfg(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var n = function (v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? v : d; };
    return {
      user: typeof raw.user === 'string' ? raw.user : '',
      // 1.14: the wall tablet it runs on (hkSettings.tablet()); '' -- by user
      tablet: typeof raw.tablet === 'string' && /^[a-z0-9_]{0,40}$/.test(raw.tablet) ? raw.tablet : '',
      entity: typeof raw.entity === 'string' && /^(input_boolean|switch)\.[a-z0-9_]+$/.test(raw.entity) ? raw.entity : null,
      photos: typeof raw.photos === 'string' && raw.photos ? raw.photos : 'media-source://media_source/local/photos',
      // 0: only the switch starts it
      starts_after: raw.starts_after === 0 ? 0 : n(raw.starts_after, 5, 86400, 180),
      each_photo: n(raw.each_photo, 3, 3600, 30),
      order: raw.order === 'sorted' ? 'sorted' : 'random',
      fill: raw.fill !== false,
      zoom: raw.zoom === true,
      // PORTRAIT AND LANDSCAPE PHOTOS, each their own (2026-10-13; settings.py
      // SAVER_DEFAULTS): whole or filling the screen, the blurred copy's blur
      // and dim, a zoom and the focus (shapeOf)
      portrait: shapeCfg(raw, 'portrait', raw.portrait_fill === true),
      landscape: shapeCfg(raw, 'landscape', raw.fill !== false),
      // photos (the forecast when there are none), forecast, or clock
      show: raw.show === 'forecast' || raw.show === 'both' || raw.show === 'clock' ? raw.show : 'photos',
      // THE CLOCKS (2026-10-13, hk-saverclock.js): Large over the photos or
      // the forecast (the corner one is a card), one style for both, and
      // what is behind Show: Clock
      clock_large: raw.clock !== false && raw.clock_over === 'large',
      clock_style: typeof raw.clock_style === 'string' ? raw.clock_style : 'classic',
      clock_bg: CLOCK_BGS.indexOf(raw.clock_bg) >= 0 ? raw.clock_bg : 'gradient',
      clock_motion: raw.clock_motion === 'still' ? 'still' : 'slow',
      // the background's Speed (0 still) and Depth (2026-10-13); an older
      // Motion: Still is Speed 0
      clock_speed: n(raw.clock_speed, 0, 100, raw.clock_motion === 'still' ? 0 : 35),
      clock_depth: n(raw.clock_depth, 0, 100, 50),
      // Night Mode: off, at night (from .. to) or always
      clock_night: raw.clock_night === 'night' || raw.clock_night === 'always' ? raw.clock_night : 'off',
      clock_night_from: /^\d\d:\d\d$/.test(raw.clock_night_from || '') ? raw.clock_night_from : '22:00',
      clock_night_to: /^\d\d:\d\d$/.test(raw.clock_night_to || '') ? raw.clock_night_to : '07:00',
      clock_24: raw.clock_24 === true,
      // each face's color: the style's own (hk-saverclock.js checks the id)
      clock_color: raw.clock_colors && typeof raw.clock_colors === 'object' && typeof raw.clock_colors[raw.clock_style] === 'string'
        ? raw.clock_colors[raw.clock_style] : '',
      // THE MOSAIC (2026-10-13): photos in a layout of 2-5 cells (mosaicPlan)
      mosaic: raw.photo_layout === 'mosaic',
      mosaic_count: n(raw.mosaic_count, 2, 5, 3),
      mosaic_gap: raw.mosaic_gap === 'none' || raw.mosaic_gap === 'rounded' ? raw.mosaic_gap : 'thin',
      mosaic_change: raw.mosaic_change === 'all' ? 'all' : 'one',
      // its lines: px (0: Spacing's own) and color; Up To: a new number of
      // photos, 1 to mosaic_count, every mosaic_every minutes
      mosaic_line: n(raw.mosaic_line, 0, 24, 0),
      mosaic_color: MOSAIC_COLORS[raw.mosaic_color] ? raw.mosaic_color : 'black',
      mosaic_random: raw.mosaic_random === true,
      mosaic_every: n(raw.mosaic_every, 1, 120, 10),
      // PHOTOS BEHIND THE CLOCK (2026-10-13): the photos as the Photos
      // settings lay them out, darkened (0-80 %); soft: the blurred copies,
      // as before. The clock's text over photos: its shadow and outline
      clock_photo_soft: raw.clock_photo_soft === true,
      clock_photo_dim: n(raw.clock_photo_dim, 0, 80, 35),
      clock_text_shadow: n(raw.clock_text_shadow, 0, 100, 40),
      clock_text_outline: n(raw.clock_text_outline, 0, 100, 0),
      // Photos & Forecast: the forecast after this many photos
      forecast_every: n(raw.forecast_every, 2, 100, 5),
      // the forecast details (the band): on the forecast, and over the photos
      band: raw.band !== false,
      band_photos: raw.band_photos === true,
      // the calendar pane down the right (1.4), and the days it lists
      calendar: raw.calendar === true,
      calendar_days: n(raw.calendar_days, 1, 7, 2),
      // WHAT PLAYS, BIG: a slide among the photos (with the forecast, they
      // take turns) or over the forecast while music plays; and the music
      // in the pane down the right (under the calendar when both are on)
      music_slide: raw.music_slide === true,
      music_pane: raw.music_pane === true,
      // MUSIC FIRST: while music plays it fills the screen, over the photos
      // or the forecast, until MU_GRACE after it stops
      music_first: raw.music_first === true,
      // HOME ENERGY (2026-10-14, hk-saver-energy.js): a slide among the
      // photos, or one of the additional screens; and what it leaves out
      energy_slide: raw.energy_slide === true,
      energy_hide: Array.isArray(raw.energy_hide) ? raw.energy_hide.filter(function (x) { return typeof x === 'string'; }) : [],
      // ADDITIONAL SCREENS over the forecast or the clock: the music, the
      // forecast (Show: Clock) and Home Energy, one every extra_every
      // minutes for extra_for seconds
      // WEATHER (2026-10-14, hk-saver-weather.js): a slide among the photos,
      // or an additional screen over the clock; and what it leaves out
      weather_slide: raw.weather_slide === true,
      weather_hide: Array.isArray(raw.weather_hide) ? raw.weather_hide.filter(function (x) { return typeof x === 'string'; }) : [],
      extra_music: raw.extra_music === true,
      extra_forecast: raw.extra_forecast === true,
      extra_every: n(raw.extra_every, 1, 60, 5),
      extra_for: n(raw.extra_for, 10, 300, 30),
      fade_back: n(raw.fade_back, 0, 5000, FADE_BACK_MS),
      // no photos: the forecast (default), or a dark screen
      fallback: raw.fallback !== false,
      cards: Array.isArray(raw.cards) ? raw.cards.filter(function (c) {
        return c && typeof c.type === 'string' && /^custom:hk-[a-z0-9-]+$/.test(c.type);
      }) : []
    };
  }
  // Whether THIS browser gets the screensaver: the dashboard asks for one,
  // and it is signed in as the tablet's user. ?hk_saver=off (and WallPanel's
  // old ?wp_enabled=false, which the house's tools use) turns it off for one
  // page; ?hk_saver=force ignores the user (testing).
  function gate(cfg, user, search, tablet) {
    if (!cfg) return false;
    var q = String(search || '');
    if (/[?&]hk_saver=off\b/.test(q) || /[?&]wp_enabled=false\b/.test(q)) return false;
    if (/[?&]hk_saver=force\b/.test(q)) return true;
    // 1.14: the block names its tablet; this page must be that tablet
    // (hkSettings.tablet(): its ?hk_tablet=, else its user)
    if (cfg.tablet) return !!(tablet && tablet === cfg.tablet);
    return !!(cfg.user && user && user === cfg.user);
  }
  // THE PANE down the right: the calendar, the music, or both
  function paneOf(c) { return !!c && (c.calendar === true || c.music_pane === true); }
  // Which slide comes next among the photos: the music (only while it
  // plays), the forecast (Photos & Forecast), the weather and Home Energy
  // (each once it has something to show) take turns, in that order.
  var SLIDE_ORDER = ['music', 'forecast', 'weather', 'energy'];
  function slideOf(c, playing, last, energy, weather) {
    var on = [];
    if (c && c.music_slide === true && playing) on.push('music');
    if (c && c.show === 'both') on.push('forecast');
    if (c && c.weather_slide === true && weather) on.push('weather');
    if (c && c.energy_slide === true && energy) on.push('energy');
    return turnOf(SLIDE_ORDER, on, last);
  }
  // the next of `on` after `last`, round `order`
  function turnOf(order, on, last) {
    var i = order.indexOf(last), n = order.length;
    for (var k = 1; k <= n; k++) { var x = order[(i + k + n) % n]; if (on.indexOf(x) >= 0) return x; }
    return null;
  }
  // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, which
  // are on -- the forecast (Show: Clock, over a background that isn't the
  // forecast's own), the music (not when it takes the screen anyway: Music
  // First, or the older music_slide over the forecast) and Home Energy
  var EXTRA_ORDER = ['forecast', 'music', 'weather', 'energy'];
  function extrasOf(c) {
    if (!c || (c.show !== 'forecast' && c.show !== 'clock')) return [];
    var a = [];
    if (c.show === 'clock' && c.extra_forecast && c.clock_bg !== 'forecast' && c.clock_bg !== 'skyonly') a.push('forecast');
    if (c.extra_music && !c.music_first && !c.music_slide) a.push('music');
    // (the weather over the clock; over the forecast it is the weather already)
    if (c.show === 'clock' && c.weather_slide) a.push('weather');
    if (c.energy_slide) a.push('energy');
    return a;
  }
  // m:ss (h:mm:ss past an hour)
  function mmss(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function zoneOf(x, width) {
    if (!(width > 0)) return null;
    if (x < width * EDGE) return 'previous';
    if (x > width * (1 - EDGE)) return 'next';
    return null;
  }
  // How one photo sits on a screen: a portrait photo whole, over a blurred
  // copy of itself; a landscape one filling the screen, or whole (over the
  // copy) when Fill the Screen is off.
  // (`fill`: the landscape choice, as before; `pfill`: the portrait one --
  // whole unless it is asked for)
  function fitOf(w, h, fill, pfill) {
    var portrait = h > w;
    var fit = (portrait ? pfill : fill) ? 'cover' : 'contain';
    return { portrait: portrait, fit: fit, backdrop: fit === 'contain' };
  }
  // HOW ONE SHAPE IS LAID OUT (its settings, cfg.portrait / cfg.landscape):
  // the photo's object-position -- what stays when it is cropped, where it
  // sits when whole -- doubles as the zoom's origin, so a zoom closes in on
  // the focus; the zoom is the `scale` property, which composes with Slow
  // Zoom's transform. All the browser's, once per photo.
  function layoutOf(sc) {
    sc = sc || {};
    var pos = (FOCUS_X[sc.x] || '50%') + ' ' + (FOCUS_Y[sc.y] || '50%');
    return { pos: pos, zoom: String((sc.zoom || 100) / 100), dim: String(1 - (sc.dim == null ? 20 : sc.dim) / 100),
             small: backdropSmall(sc.blur == null ? 50 : sc.blur) };
  }
  // THE MOSAIC'S LAYOUTS (2026-10-13): for each count, a few tidy ones --
  // cells as [x, y, w, h] fractions of the screen -- one picked at random
  // each time (never the same twice running). No cell is very wide or very
  // tall on a 16:10 tablet: a photo crops sensibly into every one.
  var MOSAICS = {
    2: [[[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]], [[0, 0, 0.62, 1], [0.62, 0, 0.38, 1]], [[0, 0, 0.38, 1], [0.38, 0, 0.62, 1]]],
    3: [[[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]], [[0, 0, 0.4, 0.5], [0, 0.5, 0.4, 0.5], [0.4, 0, 0.6, 1]],
        [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]], [[0, 0, 1, 0.56], [0, 0.56, 0.5, 0.44], [0.5, 0.56, 0.5, 0.44]]],
    4: [[[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
        [[0, 0, 0.58, 1], [0.58, 0, 0.42, 1 / 3], [0.58, 1 / 3, 0.42, 1 / 3], [0.58, 2 / 3, 0.42, 1 / 3]],
        [[0, 0, 0.32, 0.5], [0, 0.5, 0.32, 0.5], [0.32, 0, 0.68, 0.6], [0.32, 0.6, 0.68, 0.4]],
        [[0, 0, 0.3, 1], [0.3, 0, 0.45, 1], [0.75, 0, 0.25, 0.5], [0.75, 0.5, 0.25, 0.5]]],
    5: [[[0, 0, 0.3, 0.5], [0, 0.5, 0.3, 0.5], [0.3, 0, 0.4, 1], [0.7, 0, 0.3, 0.5], [0.7, 0.5, 0.3, 0.5]],
        [[0, 0, 0.5, 1], [0.5, 0, 0.25, 0.5], [0.75, 0, 0.25, 0.5], [0.5, 0.5, 0.25, 0.5], [0.75, 0.5, 0.25, 0.5]],
        [[0, 0, 1 / 3, 0.55], [1 / 3, 0, 1 / 3, 0.55], [2 / 3, 0, 1 / 3, 0.55], [0, 0.55, 0.5, 0.45], [0.5, 0.55, 0.5, 0.45]]]
  };
  // a layout for `n` photos on a W x H screen: its cells, each tall or not.
  // LAYOUTS THAT FIT THE PHOTOS (2026-10-22): given how many of the photos
  // are portraits, one of the layouts whose tall cells come closest to that
  // number, at random among those (never the one shown last); without the
  // count, any layout, as before
  function mosaicPlan(n, W, H, rnd, last, portraits) {
    var set = MOSAICS[Math.max(2, Math.min(5, n))], i;
    var cellsOf = function (k) { return set[k].map(function (c) { return { x: c[0], y: c[1], w: c[2], h: c[3], tall: c[3] * H > c[2] * W }; }); };
    if (typeof portraits === 'number' && isFinite(portraits)) {
      var best = Infinity, pick = [];
      for (var k = 0; k < set.length; k++) {
        if (set.length > 1 && k === last) continue;
        var miss = Math.abs(cellsOf(k).filter(function (c) { return c.tall; }).length - portraits);
        if (miss < best) { best = miss; pick = [k]; } else if (miss === best) pick.push(k);
      }
      i = pick[Math.min(pick.length - 1, Math.floor((rnd || Math.random)() * pick.length))];
    } else {
      i = Math.floor((rnd || Math.random)() * set.length);
      if (set.length > 1 && i === last) i = (i + 1) % set.length;
    }
    return { idx: i, cells: cellsOf(i) };
  }
  // which photo goes in which cell: the portraits in the tall cells first
  // (the tallest first), the landscapes in the wide ones -> photo index per cell
  function mosaicAssign(cells, portrait, W, H) {
    var cellOrder = cells.map(function (c, i) { return i; })
      .sort(function (a, b) { return (cells[b].h * H) / (cells[b].w * W) - (cells[a].h * H) / (cells[a].w * W); });
    var ports = [], lands = [];
    portrait.forEach(function (p, i) { (p ? ports : lands).push(i); });
    var out = [];
    cellOrder.forEach(function (ci) { out[ci] = cells[ci].tall ? (ports.length ? ports.shift() : lands.shift()) : (lands.length ? lands.shift() : ports.shift()); });
    // (the cells sorted tallest first: what is left over takes what is left)
    return out;
  }
  // the part of an iw x ih photo that covers a cw x ch cell: its focus (fx,
  // fy 0..1) kept, `zoom` closer in -> the source rectangle
  function coverRect(iw, ih, cw, ch, fx, fy, zoom) {
    var k = Math.max(cw / iw, ch / ih) * (zoom || 1), sw = cw / k, sh = ch / k;
    return { sx: Math.max(0, Math.min(iw - sw, (iw - sw) * fx)), sy: Math.max(0, Math.min(ih - sh, (ih - sh) * fy)), sw: Math.min(iw, sw), sh: Math.min(ih, sh) };
  }
  var FOCUS_F = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  // KEEP IN VIEW (2026-10-22): a host's photo may come with where its faces
  // are (`faces`: [x, y, w, h] fractions of the photo) and a point set by
  // hand (`focus`: [x, y]) -- Mantel Photos does. Without either, nothing
  // here changes anything. cleanFocus: what of a list item's focus is sound
  var FACES_MAX = 12;
  function cleanFocus(p) {
    var out = {}, f01 = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1; };
    if (!p || typeof p !== 'object') return out;
    if (Array.isArray(p.focus) && p.focus.length === 2 && f01(p.focus[0]) && f01(p.focus[1])) out.focus = [p.focus[0], p.focus[1]];
    if (Array.isArray(p.faces)) {
      var fs = p.faces.slice(0, FACES_MAX).filter(function (f) {
        return Array.isArray(f) && f.length >= 4 && f01(f[0]) && f01(f[1]) && f01(f[2]) && f01(f[3]) && f[2] > 0 && f[3] > 0 &&
          f[0] + f[2] <= 1.001 && f[1] + f[3] <= 1.001;
      }).map(function (f) { return [f[0], f[1], f[2], f[3]]; });
      if (fs.length) out.faces = fs;
    }
    return out;
  }
  // a face's box with room for the head around it: hair above, chin below
  function headOf(f) {
    return { x1: f[0] - f[2] * 0.2, y1: f[1] - f[3] * 0.35, x2: f[0] + f[2] * 1.2, y2: f[1] + f[3] * 1.15 };
  }
  function unionOf(boxes) {
    return boxes.reduce(function (u, b) {
      return { x1: Math.min(u.x1, b.x1), y1: Math.min(u.y1, b.y1), x2: Math.max(u.x2, b.x2), y2: Math.max(u.y2, b.y2) };
    });
  }
  // the alignment (as coverRect's fx and object-position's percentage) that
  // puts the point c in the middle of a window f wide (fractions)
  function alignOf(c, f) { return f >= 1 ? 0.5 : Math.max(0, Math.min(1, (c - f / 2) / (1 - f))); }
  // WHAT TO KEEP IN VIEW of an iw x ih photo filling a cw x ch frame, `zoom`
  // closer in: {fx, fy} (the crop's alignment), {cx, cy} (the point kept in
  // the middle), or null for a photo with no focus. A point set by hand is
  // kept in the middle; else all the faces when they fit the visible part,
  // else the largest face and as many more, largest first, as still fit --
  // whole heads rather than a cut across a group
  function faceWindow(item, iw, ih, cw, ch, zoom) {
    var F = item ? cleanFocus(item) : {};
    if (!F.focus && !F.faces || !(iw > 0 && ih > 0 && cw > 0 && ch > 0)) return null;
    var k = Math.max(cw / iw, ch / ih) * Math.max(1, zoom || 1);
    var fw = Math.min(1, cw / k / iw), fh = Math.min(1, ch / k / ih), cx, cy;
    if (F.focus) { cx = F.focus[0]; cy = F.focus[1]; } else {
      var heads = F.faces.map(headOf).sort(function (a, b) { return (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1); });
      var fits = function (u) { return u.x2 - u.x1 <= fw && u.y2 - u.y1 <= fh; };
      var u = unionOf(heads);
      if (!fits(u)) {
        u = heads[0];
        for (var i = 1; i < heads.length; i++) { var t = unionOf([u, heads[i]]); if (fits(t)) u = t; }
      }
      cx = (u.x1 + u.x2) / 2; cy = (u.y1 + u.y2) / 2;
    }
    cx = Math.max(0, Math.min(1, cx)); cy = Math.max(0, Math.min(1, cy));
    return { fx: alignOf(cx, fw), fy: alignOf(cy, fh), cx: cx, cy: cy };
  }
  // where the photo's point (cx, cy) lands in a cw x ch frame, the photo
  // drawn at `fit` (cover or contain) with alignment fx, fy: the zoom's
  // origin, so a zoom closes in on the faces -> {ox, oy}, fractions
  function faceOrigin(cx, cy, iw, ih, cw, ch, fit, fx, fy) {
    var s = (fit === 'contain' ? Math.min : Math.max)(cw / iw, ch / ih), dw = iw * s, dh = ih * s;
    return { ox: Math.max(0, Math.min(1, ((cw - dw) * fx + cx * dw) / cw)), oy: Math.max(0, Math.min(1, ((ch - dh) * fy + cy * dh) / ch)) };
  }
  // the blurred copy's blur is its size: drawn this many pixels wide and
  // scaled up -- 50 % is the 24 px it always was; 0 % the 96 px copy itself
  function backdropSmall(blur) {
    return Math.max(4, Math.round(96 * Math.pow(2, -Math.max(0, Math.min(100, blur)) / 25)));
  }
  function shuffle(list, rnd) {
    var a = list.slice();
    rnd = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // THE DECK: random is every photo once, in a shuffled order, before any
  // repeats (and the new round never opens on the photo the last one ended
  // with); sorted is the folder in order, round and round. previous() walks
  // back through what was shown.
  function Deck(order, rnd) {
    this.order = order; this.rnd = rnd || Math.random;
    this.items = []; this.round = []; this.pos = 0; this.history = []; this.back = 0;
  }
  Deck.prototype.set = function (items) {
    var had = this.items.map(function (x) { return x.id; }).join('\n');
    this.items = items.slice();
    if (this.items.map(function (x) { return x.id; }).join('\n') !== had) { this.round = []; this.pos = 0; }
  };
  Deck.prototype.next = function () {
    if (this.back > 0) {                  // stepping forward again after previous()
      this.back--;
      return this.history[this.history.length - 1 - this.back] || null;
    }
    if (!this.items.length) return null;
    if (this.pos >= this.round.length) {
      var last = this.history[this.history.length - 1];
      this.round = this.order === 'sorted'
        ? this.items.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })
        : shuffle(this.items, this.rnd);
      if (this.order !== 'sorted' && last && this.round.length > 1 && this.round[0].id === last.id) {
        this.round.push(this.round.shift());
      }
      this.pos = 0;
    }
    var it = this.round[this.pos++];
    this.history.push(it);
    if (this.history.length > 50) this.history.shift();
    return it;
  };
  Deck.prototype.previous = function () {
    if (this.history.length - 1 - this.back <= 0) return null;
    this.back++;
    return this.history[this.history.length - 1 - this.back] || null;
  };
  function tagOf(type) { return String(type || '').replace(/^custom:/, ''); }
  function isImage(item) {
    if (!item) return false;
    if (item.media_class === 'image') return true;
    return /^image\//.test(String(item.media_content_type || ''));
  }

  // ------------------------------------------------------------ the page
  // THE HOUSE, AS THE CLIENT: everything this module reads. The host adapter
  // knows the current one even on a page with no hk cards (in Home Assistant it
  // reads the frontend's root element), and before hk-base has loaded.
  function clientNow() {
    var C = window.hkCards, HC = window.hkHostClient;
    return (C && C.client && C.client()) || (HC && HC.current && HC.current()) || null;
  }
  // ...and its action port, for everything the screensaver changes (the switch,
  // the music's buttons and volume, its touch and black acknowledgements): the
  // real call in Home Assistant, refused (`commands_disabled`) in Mantel.
  function actionsNow() { var c = clientNow(); return (c && c.actions) || null; }
  // A CARD ON THE SCREENSAVER gets the host input that goes with the client
  // (the host adapter's bridge): card families still act through it
  function feedCard(el, c) { var HC = window.hkHostClient; if (el && c && HC && HC.bridge) HC.bridge(el, c); }
  // THE DASHBOARD'S CONFIG, read where the strategy guard reads it -- the
  // panel's own lovelace object is the authority, never a DOM marker.
  function panel() {
    return window.hkShell.panel();
  }
  // ...and where a host draws the dashboard with HK's own view host, no
  // Lovelace (Mantel: the panel is the page, with no lovelace object), the
  // shell hands the config over instead. Read as the panel's alone, the
  // saver had no config at all there: no touches told, no black drawn or
  // confirmed, no backlight lowered (every wall tablet on Mantel,
  // 2026-10-19). shellConf: the config came from the shell, not a panel.
  var shellConf = false;
  function dashConf() {
    var p = panel(), conf = p && p.lovelace && p.lovelace.config;
    shellConf = false;
    if (conf) return conf;
    var SH = window.hkShell;
    try { conf = SH && typeof SH.dashboardConfig === 'function' ? SH.dashboardConfig() : null; } catch (e) { conf = null; }
    shellConf = !!conf && !(p && p.lovelace);
    return conf || null;
  }
  // the font the dashboard's view draws in (its theme is on the view)
  function viewFont() {
    try {
      var v = window.hkShell.viewContainer(panel());
      return v ? getComputedStyle(v).fontFamily : '';
    } catch (e) { return ''; }
  }

  // ------------------------------------------------------------ state
  function isFlat() { var S = window.hkSettings; return !!(S && S.rendering && S.rendering().flat); }
  var cfg = null;              // the config in force (null: none here)
  var on = false;              // showing (or fading in)
  var startedBy = '';
  var host = null, root = null;
  var lastInput = Date.now();
  var idleT = null, slideT = null, pendingSwitch = null;
  // the touch that stopped it: still down (up: null), or when it lifted
  var press = null, pressStop = false;
  var deck = null, listAt = 0, listing = null, listKey = '';
  var layer = 0;               // which of the two photo layers is on top
  var displayLayer = null, fadeDone = null, photoRun = 0;
  // the screensaver's fade in, waiting for its first photo (start)
  var entrance = null, ENTRANCE_MAX = 1500;
  var coverT = null, coveredPage = null, pageVisibility = null, coveredView = [];
  // THE FORECAST (1.3): the live sky over the season's land (hkSky.scene),
  // with the forecast band -- when a screen asks for it, or has no photos
  var mode = 'photos', fscene = null, fband = null, fTick = null, fSig = '';
  // THE CALENDAR PANE (option `calendar`): its element, its scroller, the
  // card in it, its width now, and the timer that scrolls it back to today
  var paneEl = null, paneSc = null, paneCard = null, paneW = 0, paneResetT = null;
  // Photos & Forecast: the forecast as one slide every `forecast_every`
  // photos, over the photos, its sky still whenever it is not on screen
  var fcShowing = false, sinceFc = 0;
  // HK Settings' preview (hkSaver.preview): shown in the settings page's frame
  // whoever is signed in, deaf to the real tablet's switch, never writing it,
  // and rebuilt whenever the options change
  var previewOn = false;
  // ALL SCREENS' PREVIEW (1.8.1): HK Settings' All Screens -> Screensaver
  // shows its own settings on a screen of the house, whether or not that
  // screen follows them (before, the page had no preview once every screen
  // had settings of its own)
  var previewHouse = false;
  // ...and Home Energy's Options: the energy screen, held (2026-10-14)
  var previewEnergy = false, previewWeather = false;
  function houseBlock() {
    var HS = window.hkSettings, S = window.hkStrategy;
    var all = HS && HS.get ? HS.get('boards', null) : null;
    var b = all && all[String(location.pathname).split('/')[1] || ''];
    var o = HS && HS.get ? HS.get('look.saver', null) : null;
    if (!b || !o || !S || !S.saverBlock) return null;
    return S.saverBlock(clientNow(), Object.assign({}, b, { screensaver: true, screensaver_options: o }));
  }
  var FC_TICK_MS = 5000;
  var unsubCards = null, cards = [];
  var shown = 0, failed = 0, lastPhoto = null;
  var force = false;           // hkSaver.force(true): ignore the user (tests)

  function user() { var h = clientNow(); return h && h.user && h.user.name; }
  // this page's wall tablet (1.14, hkSettings.tablet()), its id or ''
  function tabletNow() {
    var HS = window.hkSettings;
    if (HS && typeof HS.tablet === 'function') return HS.tablet(clientNow()) || null;
    // a settings module from before 1.14: the screen's own, as it was
    var all = HS && HS.get ? HS.get('boards', null) : null;
    var b = all && all[String(location.pathname).split('/')[1] || ''];
    if (!b) return null;
    var out = { legacy: true };
    Object.keys(b).forEach(function (k) { out[k] = b[k]; });
    return out;
  }
  function tabletId() { var t = tabletNow(); return t && !t.legacy ? t.id : ''; }
  // THIS PAGE IS THE BLOCK'S OWN TABLET: the one it names (1.14), else
  // signed in as its user -- the rule for every write and report
  function mine() {
    if (!cfg) return false;
    if (cfg.tablet) return tabletId() === cfg.tablet;
    return !!cfg.user && user() === cfg.user;
  }
  // which tablet a report is about: its id, else (before 1.14) the screen
  function whoMsg(msg) {
    var id = (cfg && cfg.tablet) || '';
    if (id) msg.tablet = id; else msg.dashboard = String(location.pathname).split('/')[1] || '';
    return msg;
  }
  // IN A FRAME (HK Settings' preview) it never runs on its own -- no idle
  // start, no switch, no touches -- only as the preview: the frame's query
  // (?wp_enabled=false) does not survive the dashboard's own navigation, and
  // an admin can be a screen's Tablet User.
  var framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
  function allowed() {
    if (framed && !previewOn) return false;
    return !!cfg && (force || gate(cfg, user(), location.search, tabletId()));
  }
  function held() {
    // hk-idle is held while a detail sheet is open or Live TV plays: the
    // screensaver never covers someone watching or using a sheet
    var I = window.hkIdle;
    return !!(I && typeof I.held === 'function' && I.held().length);
  }

  // ------------------------------------------------------------ the switch
  function switchState(c) {
    c = c || cfg;
    var h = clientNow();
    var s = c && c.entity && h && h.states[c.entity];
    return s ? s.state : null;
  }
  function writeSwitch(want, c) {
    c = c || cfg;                  // (the options the screensaver showed with, when they just went: refresh)
    if (!c || !c.entity) return;
    // ONLY THE TABLET'S OWN USER WRITES IT -- never a forced test page
    // (?hk_saver=force, hkSaver.force()), whatever the gate lets it show
    if (!mine() || /[?&]hk_saver=force\b/.test(location.search) || force) return;
    var act = actionsNow();
    if (!act || switchState(c) === want) return;
    pendingSwitch = { want: want, until: Date.now() + ECHO_MS };
    try {
      act.callService(c.entity.split('.')[0], want === 'on' ? 'turn_on' : 'turn_off', { entity_id: c.entity });
    } catch (e) { /* offline: the next state change sorts it out */ }
  }
  // A TOUCH ON THE SCREEN, told to the integration (screensaver.py): its
  // "Screen In Use" sensor and the switch's last_touch. At most every 10 s,
  // and only from the tablet's own user -- the same rule as the switch.
  var touchSent = 0;
  function reportTouch() {
    if (!cfg || !cfg.entity || !/^switch\./.test(cfg.entity)) return;
    if (!mine() || force || /[?&]hk_saver=force\b/.test(location.search)) return;
    var now = Date.now();
    if (now - touchSent < 10000) return;
    touchSent = now;
    sendWS(whoMsg({ type: 'hk_frontend/screensaver/touch' })).catch(function () { /* older integration */ });
  }

  // Every new client: the switch decides, unless it is still echoing our own
  // write the other way.
  function onUpdate(h) {
    hkSync(h);
    if (previewOn || !cfg || !cfg.entity || !allowed()) return;
    var st = switchState();
    if (pendingSwitch) {
      if (st === pendingSwitch.want || Date.now() > pendingSwitch.until) pendingSwitch = null;
      else return;
    }
    // ...but not over somebody watching Live TV or using a sheet (hk-idle's
    // hold, as the idle timer already honours): the switch turned on by an
    // automation or the Sleep Screen waits for the hold to end (2026-10-21)
    if (st === 'on' && !on) { if (!held()) start('switch'); }
    else if (st === 'off' && on) stop('switch');
  }

  // ------------------------------------------------------------ idle
  function armIdle() {
    if (idleT) { clearTimeout(idleT); idleT = null; }
    if (on || !cfg || !allowed() || !(cfg.starts_after > 0)) return;
    var wait = Math.max(250, lastInput + cfg.starts_after * 1000 - Date.now());
    idleT = setTimeout(function () {
      idleT = null;
      if (on || !cfg || !allowed()) return;
      if (Date.now() - lastInput < cfg.starts_after * 1000) { armIdle(); return; }
      // not while hidden (the tab is not on screen), nor held: ask again
      // shortly rather than start behind somebody's back
      if (document.hidden || held()) { lastInput = Date.now() - cfg.starts_after * 1000 + 15000; armIdle(); return; }
      start('idle');
    }, wait);
  }

  // ------------------------------------------------------------ input
  var mx = null, my = null;
  // A TOUCH ON THE CALENDAR PANE scrolls it: the one place on the
  // screensaver a finger does not take it away
  function inPane(e) {
    if (!paneEl || !paneUp) return false;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(paneEl) >= 0) return true;
    var x = e.clientX != null ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX);
    return x != null && x >= (window.innerWidth || 0) - paneW;
  }
  function paneTouched() {
    if (paneResetT) clearTimeout(paneResetT);
    paneResetT = setTimeout(function () {
      paneResetT = null;
      if (paneSc) { try { paneSc.scrollTo({ top: 0, behavior: isFlat() ? 'instant' : 'smooth' }); } catch (e) { paneSc.scrollTop = 0; } }
    }, PANE_RESET_MS);
  }
  function onInput(e) {
    var t = e.type;
    // A NOTIFICATION'S BANNER over the photos (hk-notify.js): a finger on it
    // is the banner's -- swiped away, opened -- never a wake; the screensaver
    // is in use while it does
    if (on && window.hkNotify && window.hkNotify.owns(e)) {
      if (t !== 'pointermove' && t !== 'mousemove') saverTouched();
      return;
    }
    // A FINGER ON THE MUSIC'S VOLUME: everything it does is the drag
    if (on && mus.drag) {
      if (t === 'pointermove' || t === 'mousemove' || t === 'touchmove') {
        var mp = t === 'touchmove' ? e.touches && e.touches[0] : e;
        if (mp) volFrom(mp.clientX);
      }
      return;
    }
    // THE MUSIC'S PANEL OPEN: what is in it is its own (taps, scrolling, the
    // search box's typing); anything else closes it -- never a wake -- but
    // the music's buttons beside it still act
    if (on && pnl) {
      // (a mouse moving about it is followed, not counted: once it closes,
      // a move from here wakes, as before)
      if ((t === 'pointermove' || t === 'mousemove') && (!e.pointerType || e.pointerType === 'mouse')) { mx = e.clientX; my = e.clientY; }
      if (inPanel(e)) { if (t !== 'pointermove' && t !== 'mousemove') panelTouched(); return; }
      if (t === 'pointermove' || t === 'mousemove' || t === 'wheel' || t === 'touchmove' || t === 'click') return;
      if ((t === 'touchstart' || t === 'mousedown') && window.PointerEvent) return;
      if (t === 'keydown') { if (!pnl.p.typing()) closePanel(true); return; }
      var px = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientX) : e.clientX;
      var py = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientY) : e.clientY;
      var ph2 = musicHit(px, py);
      if (ph2 && !ph2.art) { musicAct(ph2, px); if (pnl) panelTouched(); return; }
      saverTouched();
      closePanel(true);
      return;
    }
    if (on && t !== 'keydown' && inPane(e)) {
      if (t !== 'pointermove' && t !== 'mousemove') { paneTouched(); saverTouched(); }
      // the music's buttons in the pane
      if (t === 'pointerdown' || (t === 'touchstart' && !window.PointerEvent)) {
        var pt = t === 'touchstart' ? e.touches && e.touches[0] : e, ph = pt && musicHit(pt.clientX, pt.clientY);
        if (ph) musicAct(ph, pt.clientX);
      }
      return;
    }
    if (on) {
      // A MOUSE has to move, a finger just has to land.
      if (t === 'pointermove' || t === 'mousemove') {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (mx === null) { mx = e.clientX; my = e.clientY; return; }
        if (Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) < MOVE_PX) return;
        stop('touch'); return;
      }
      // ONE TAP, ONE STEP: a finger fires pointerdown, then touchstart, then
      // mousedown; where pointer events exist they alone count, or a tap on
      // an edge would skip two photos
      if ((t === 'touchstart' || t === 'mousedown') && window.PointerEvent) return;
      if (t === 'pointerdown' || t === 'touchstart' || t === 'mousedown') {
        var x = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientX) : e.clientX;
        var y = t === 'touchstart' ? (e.touches && e.touches[0] && e.touches[0].clientY) : e.clientY;
        // A TAP ON THE FORECAST DETAILS opens the Weather page (ahead of
        // the edges: the details run under both)
        // THE MUSIC'S BUTTONS act and leave it up
        var mh = musicHit(x, y);
        if (mh) { pressStop = !!mh.art; musicAct(mh, x); return; }
        // The alert banner opens the NWS wording, rather than the raw
        // count sensor or an unrelated Weather-page navigation.
        if (wxShowing && wxCtl && wxCtl.hitAlert && wxCtl.hitAlert(x, y)) {
          pressStop = true;
          var alertCtl = wxCtl;
          stop('touch');
          alertCtl.openAlerts();
          return;
        }
        var wpage = weatherAt(x, y) && weatherPage();
        pressStop = true;
        if (wpage) { stop('touch'); go(wpage); return; }
        // A TAP ON HOME ENERGY opens the Energy page (anywhere on it)
        if (enShowing) { var epage = energyPage(); stop('touch'); if (epage) go(epage); return; }
        // ...and on the weather, the Weather page
        if (wxShowing) { var xpage = weatherPage(); stop('touch'); if (xpage) go(xpage); return; }
        // the edges of the PHOTOS: beside the calendar pane, its left edge
        var z = zoneOf(x, (window.innerWidth || 0) - (paneUp ? paneW : 0));
        // (on the forecast or the music a tap anywhere else wakes: there is no photo to step;
        // nor on Show: Clock, photos or Landscapes behind it included -- the
        // clock is what it shows, and an edge tap that only changed the
        // photo read as a tap that did not wake it, 1.8.1)
        if (z && mode === 'photos' && !muShowing && !ckPhotos()) { pressStop = false; saverTouched(); if (z === 'next') nextPhoto(); else previousPhoto(); }
        else stop('touch');
        return;
      }
      if (t === 'keydown' || t === 'wheel') stop('touch');
      return;
    }
    if (t === 'pointermove' || t === 'mousemove') {
      if (e.pointerType && e.pointerType !== 'mouse') return;
    }
    lastInput = Date.now();
    armIdle();
    if (t !== 'pointermove' && t !== 'mousemove') reportTouch();
  }
  ['pointerdown', 'touchstart', 'touchmove', 'wheel', 'keydown', 'click', 'mousedown', 'pointermove']
    .forEach(function (t) { window.addEventListener(t, onInput, { passive: true, capture: true }); });
  // the touch that stopped it, lifting
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach(function (t) {
    window.addEventListener(t, function () { if (press && press.up === null) press.up = clock.now(); if (mus.drag) volEnd(); }, { passive: true, capture: true });
  });

  // THE FORECAST DETAILS (today, the hours, the days) where they show, a
  // finger's slop around them. Laid out with pointer-events off, so found
  // by place.
  var SLOP = 12;
  function weatherAt(x, y) {
    if (!root || !host || !host.hasAttribute('band') || x == null || y == null) return false;
    var box = root.querySelector('.fcband');
    return Array.prototype.slice.call((box && box.children) || []).some(function (el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;
    });
  }
  // this dashboard's Weather page, when it has one
  function weatherPage() {
    var conf = dashConf();
    var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'weather'; });
    return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/weather' : null;
  }
  // as a navigate tap_action does (hk-base.js): HA follows location-changed;
  // the dashboard is still under the screensaver, drawing (stop's WAKE)
  function go(path) {
    if (String(location.pathname) === path) return;
    try { window.hkShell.navigate(path); } catch (e) { /* stay */ }
  }

  // ------------------------------------------------------------ the element
  var CSS = [
    ':host{position:fixed;inset:0;z-index:2147483000;display:block;background:#000;opacity:0;',
    '  transition:opacity var(--fade,3000ms) ease;touch-action:none;user-select:none;-webkit-user-select:none;',
    '  -webkit-tap-highlight-color:transparent;cursor:none;contain:strict;',
    // THE DASHBOARD'S FONT (SF Pro under HK Kiosk). This element hangs off
    // <body>, outside the view its theme is put on, so it does not inherit
    // it: it fell back to Roboto, whose weight-200 forecast numeral looks
    // squeezed beside the Weather page's. build() copies the view's font
    // onto --hk-saver-font; the house's (hk-base.js --hk-font-body) is the
    // fallback -- and the cards in it read it too.
    '  --ha-font-family-body:var(--hk-saver-font,var(--hk-font-body));',
    '  font-family:var(--hk-saver-font,var(--hk-font-body))}',
    ':host([on]){opacity:1}',
    // GETTING READY (2026-10-09): barely there -- too faint to see, but drawn,
    // so the first photo's layer is rastered before the fade shows it. From
    // opacity 0 the tablets' WebView rastered it during the fade, and the
    // host's black showed through the tiles not yet drawn: a black block over
    // the incoming photo (screen-recorded on the Living Room tablet).
    ':host([prep]){opacity:.004}',
    // PLAIN BLACK ([dark]): under the kiosk's Black screensaver (goDark), or
    // woken from a frozen page (stop) -- the photos, the forecast and the
    // clock out of sight, so the frame the tablet keeps is black and the
    // dashboard draws underneath before the fade away to it. [undark]: drawn
    // again under .blk's black, which then fades off them (lightSoon)
    ':host([dark]:not([undark])) .ph,:host([dark]:not([undark])) .fc,:host([dark]:not([undark])) .fcb,',
    ':host([dark]:not([undark])) .info,:host([dark]:not([undark])) .pane,:host([dark]:not([undark])) .mpanel{visibility:hidden}',
    // THE PANE TURNED OVER (the music's panel on its back): Home Status and
    // the timers in it are its front's
    '.info > hk-screensaver-status-card,.info > hk-timer-strip-card{transition:opacity .15s ease}',
    ':host([mpp]) .info > hk-screensaver-status-card,:host([mpp]) .info > hk-timer-strip-card{opacity:0}',
    ':host([mpkb]) .info,:host([mpkb]) .mu .mcol{visibility:hidden}',
    '.blk{position:absolute;inset:0;z-index:9;background:#000;opacity:0;pointer-events:none;transition:opacity var(--blk,0ms) ease}',
    ':host([dark]) .blk{opacity:1}',
    // waking: the dashboard drawing underneath (WAKE)
    ':host([on][waking]){opacity:.99}',
    // after a touch stop the element stays, invisible, to swallow taps (its
    // black kept: it is set as the fade back starts, over a dark screen)
    ':host([blocking]){cursor:default}',
    // EVERY PHOTO LAYER IS ITS OWN COMPOSITING LAYER, ALL THE TIME. Without
    // will-change a layer exists only while its opacity is animating: the
    // cross-fade created two and dropped them 3 s later (headless: 214 -> 216
    // -> 214 layers at every photo), and each of those made the tablets'
    // WebView re-raster what sits over the photos -- the flicker around each
    // change that WallPanel had too (fixed there 2026-09-15 the same way).
    '.ph{position:absolute;inset:0;z-index:0;opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
    '.ph.top{opacity:1}',
    // the images paint INTO their layer: an <img> with a layer of its own
    // loses it whenever its src is let go after a fade, which is the same
    // churn one level down (headless, 2026-09-30). Only Slow Zoom, which
    // animates the image, gives it one.
    '.ph img{position:absolute;inset:0;width:100%;height:100%;display:block}',
    ':host([zoom]) .ph img.fg{will-change:transform}',
    // THE BLURRED COPY BEHIND A PORTRAIT PHOTO: drawn once into a small canvas
    // (drawBackdrop) and scaled up -- the look of the old 40 px blur of the
    // whole photo, at a sliver of the cost to raster (2026-10-09)
    '.ph canvas.bg{position:absolute;left:-7.5%;top:-7.5%;width:115%;height:115%;display:block;filter:brightness(var(--bgdim,.8))}',
    '.ph canvas.bg[hidden]{display:none}',
    // the mosaic's cells (paintMosaic): canvases at the cells' own size
    '.ph.mo img.fg,.ph.mo canvas.bg{display:none}',
    '.ph .mowrap{position:absolute;inset:0;box-sizing:border-box}',
    '.ph[pw] .mowrap{right:var(--hk-pane-w,0px)}',
    '.ph .mocell{position:absolute;overflow:hidden;background:#0b0b0d}',
    '.ph .mowrap.round .mocell{border-radius:16px}',
    '.ph .mocell canvas{position:absolute;inset:0;width:100%;height:100%;display:block;transition:opacity ' + CROSSFADE_MS + 'ms ease}',
    '.ph.mo.zoom .mocell canvas{animation:hk-saver-zoom var(--zd,33s) linear forwards}',
    '.ph img.fg{object-fit:var(--fit,cover);object-position:var(--pos,50% 50%);transform-origin:var(--org,var(--pos,50% 50%));scale:var(--zm,1)}',
    '.ph.zoom img.fg{animation:hk-saver-zoom var(--zd,33s) linear forwards}',
    // THE PHOTOS' SCRIM, under the forecast details over them (band_photos):
    // black, toward the bottom, chosen on the tablet 2026-10-04. Painted into
    // each photo's own layer, so it fades with its photo and is covered by
    // the forecast slide like the photo is -- never a gradient that jumps.
    '.phscrim{position:absolute;left:0;right:0;bottom:0;height:58%;pointer-events:none;opacity:0;',
    '  transition:opacity ' + CROSSFADE_MS + 'ms ease;',
    '  background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,.28) 35%,rgba(0,0,0,.55) 75%,rgba(0,0,0,.62) 100%)}',
    // ...ONLY FOR THE DETAILS OVER THE PHOTOS ([bandph]: band_photos), not
    // whenever they show: it went dark and light again under every forecast
    // slide, a layer made for the fade and dropped as the slide finished,
    // and the tablet drew what was round it again -- the days flickered just
    // after the forecast came in (2026-10-10). Over the forecast the details
    // have their own scrim (.fcscrim).
    ':host([bandph]) .phscrim{opacity:1}',
    '.ph[pw] .phscrim{right:var(--hk-pane-w,0px)}',
    '@keyframes hk-saver-zoom{from{transform:scale(1)}to{transform:scale(' + ZOOM + ')}}',
    // THE INFO BOX: where WallPanel put the cards, and how it dressed them,
    // measured on the tablets -- top-left, 600 px, bold white on the photo
    // with a deep shadow, everything aligned to the left edge. The now-playing
    // and timer cards pin themselves to their corners (position:fixed);
    // nothing here may transform or filter, or "fixed" would mean "in here".
    // THE CLOCK (Show: Clock, or Large): under the corner cards; clear of
    // the forecast's details and the side pane; gone under the music
    '.ck{position:absolute;inset:0;z-index:3;pointer-events:none;transition:opacity ' + CROSSFADE_MS + 'ms ease}',
    ':host([band]) .ck{bottom:var(--hk-ss-corner-bottom,0px)}',
    ':host([pane]) .ck{right:var(--hk-pane-w,' + PANE_W + 'px)}',
    ':host([muslide]) .ck{opacity:0}',
    // HOME ENERGY over a clock (the energy layer is opaque over a clock's own
    // background, so that clock stays), and the forecast as an additional
    // screen: the clock fades off it
    ':host([enslide]:not([ckgen])) .ck,:host([wxslide]:not([ckgen])) .ck,:host([ckmode][fcslide]) .ck{opacity:0}',
    // ...the forecast under a clock's own background, while it shows and
    // until the clock is back over it
    ':host([ckgen][fcslide]) .fc,:host([ckgen][fcout]) .fc{display:block}',
    // ...beside the pane; and what sits along the bottom steps aside for it
    ':host([pane]) .en,:host([pane]) .wx{right:var(--hk-pane-w,' + PANE_W + 'px)}',
    ':host([enslide]) .info > hk-screensaver-now-card,:host([enslide]) .info > hk-timer-strip-card,',
    ':host([wxslide]) .info > hk-screensaver-now-card,:host([wxslide]) .info > hk-timer-strip-card{opacity:0}',
    // ...and the corner clock and weather: Home Energy tells the time itself,
    // smaller, so its rings keep their size (the user, 2026-10-14)
    // ...on a layer of its own for good, as the weather line's and what
    // plays: the fade alone made it one only while fading (2026-10-19)
    '.info > hk-clock-card{transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
    ':host([enslide]) .info > hk-clock-card,:host([enslide]) .info > hk-weather-strip-card,',
    ':host([wxslide]) .info > hk-clock-card,:host([wxslide]) .info > hk-weather-strip-card{opacity:0}',
    // ...and the corner clock tells the time in its place (Show: Clock or a
    // Large clock with Music First: the slide covered every clock there)
    '.info > [muonly]{display:none}',
    ':host([muslide]) .info > [muonly],:host([ckmode][fcslide]) .info > [muonly]{display:block;animation:hk-saver-muonly ' + CROSSFADE_MS + 'ms ease both}',
    '@keyframes hk-saver-muonly{from{opacity:0}to{opacity:1}}',
    ':host([ckgen]) .ph,:host([ckgen]) .fc{display:none}',
    // PHOTOS BEHIND THE CLOCK: the photos themselves (or, Soft, their
    // blurred copies), under a dark wash of their own Darken amount
    ':host([ckphotos][cksoft]) .ph img.fg{opacity:0}',
    ':host([ckphotos]) .ph::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:rgba(0,0,0,var(--hk-ckdim,.35))}',
    // Today's own weather and music: the corners' step aside
    ':host([ckown]) .info hk-weather-strip-card,:host([ckown]) .info hk-screensaver-now-card{display:none}',
    // NIGHT MODE: nothing behind the clock; everything one dim red -- a
    // multiply wash over all of it (white becomes the red, black stays)
    ':host([cknight]) .ph,:host([cknight]) .fc,:host([cknight]) .fcb,:host([cknight]) .ck .ckbg,:host([cknight]) .ck .ckscrim,',
    ':host([cknight]) .ck .ckgrain,:host([cknight]) .ck .cklight{visibility:hidden}',
    '.nightwash{position:absolute;inset:0;z-index:8;pointer-events:none;background:#b3261e;mix-blend-mode:multiply;display:none}',
    ':host([cknight]) .nightwash{display:block}',
    '.info{position:absolute;z-index:4;left:0;top:0;width:var(--hk-saver-card-width,' + DEFAULT_CARD_WIDTH + 'px);',
    '  padding:31px 0 0 30px;box-sizing:content-box;text-align:left;display:flex;flex-direction:column;gap:9px;',
    '  --ha-card-background:none;--ha-card-box-shadow:none;--ha-card-border-width:0px;',
    '  --primary-text-color:#ffffff;--secondary-text-color:#dddddd;color:var(--hk-ink,rgba(255,255,255,0.94));',
    '  text-shadow:0px 2px 8px rgba(0,0,0,0.30),0px 6px 28px rgba(0,0,0,0.26),0px 12px 68px rgba(0,0,0,0.34);',
    '  --font-weight:bold;font-weight:bold;font-size:15px;letter-spacing:-0.23px;pointer-events:none}',
    '.info > *{display:block;flex:none}',
    // the forecast: no photo layers; the sky under everything; the band along
    // the bottom (the corner rows rise above it: --hk-ss-corner-bottom); the
    // band carries today's conditions, so the weather line leaves the clock
    ':host([forecast]) .ph{display:none}',
    // the forecast's own layer, over the photos: shown outright ([forecast]),
    // or faded in as one slide among the photos ([fcslide])
    // (opaque: the sky is drawn a moment after the layer is built, and no
    // photo may show through it meanwhile)
    '.fc{position:absolute;inset:0;z-index:0;opacity:0;visibility:hidden;pointer-events:none;will-change:opacity;background:#000;',
    '  transition:opacity ' + CROSSFADE_MS + 'ms ease}',
    '.fc.top{opacity:1;visibility:visible}',
    '.fsky{position:absolute;inset:0}',
    // the land under the band darkened toward the bottom: a sunlit meadow is
    // as bright as the band's text. Static (no blur), so it costs no frames.
    // (on the forecast only: the photos have their own, .phscrim; it comes
    // and goes with the forecast slide)
    // ...on a layer of its own for good (will-change), like every fading
    // layer here: only while fading, its layer was dropped as the slide
    // finished, and the band's layer it sits in was drawn again -- the days
    // flickered on a tablet just after the forecast came in (2026-10-10)
    '.fcscrim{position:absolute;left:0;right:0;bottom:0;height:48%;pointer-events:none;opacity:0;will-change:opacity;',
    '  transition:opacity ' + CROSSFADE_MS + 'ms ease;',
    '  background:linear-gradient(to bottom,rgba(6,10,18,0) 0%,rgba(6,10,18,.5) 30%,rgba(6,10,18,.66) 100%)}',
    ':host([forecast]) .fcscrim,:host([fcslide]) .fcscrim{opacity:1}',
    // column-reverse with auto margins: centred while it fits; a band
    // taller than the zone (a small screen) keeps to the bottom and grows up
    '.fcband{position:absolute;left:30px;right:30px;bottom:0;height:' + BAND_ZONE + ';box-sizing:border-box;',
    '  padding:' + BAND_PAD + 'px 0;display:flex;flex-direction:column-reverse;pointer-events:none}',
    '.fcband > *{margin:auto 0;flex:none;width:100%;max-width:' + BAND_MAX + 'px;align-self:center;',
    '  transform:translateX(var(--hk-band-shift,0px))}',
    // THE FORECAST DETAILS (the band: today, the hours, the days) on a layer
    // of their own, so they can show over the forecast OR the photos
    // (options band / band_photos); the weather line steps aside for them
    '.fcb{position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;will-change:opacity;',
    '  transition:opacity ' + CROSSFADE_MS + 'ms ease}',
    ':host([band]) .fcb{opacity:1}',
    // the band's glass never blurs what is behind it here: behind it the
    // photos and the forecast cross-fade, and a backdrop blur is redone on
    // every frame of that (the scrim gives the band its contrast instead)
    '.fcb{--hk-glass-backdrop:none}',
    // faded, not removed: with the band fading in and out over the same
    // time, removing it at once showed both (or neither) for 3 s
    // ...on a layer of its own for good: the fade alone made it one only
    // while fading (a layer made and dropped at every forecast slide)
    '.info > hk-weather-strip-card{transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
    ':host([band]) .info > hk-weather-strip-card{opacity:0}',
    // THE PANE ([pane]: the calendar, the music or both): the photo beside it, its own blurred copy
    // under the pane (the backdrop img, always shown), the forecast and its
    // details beside it too -- the sky held to its box, not the screen
    '.ph[pw] img.fg{width:calc(100% - var(--hk-pane-w,0px))}',
    '.ph[pw] canvas.bg[hidden]{display:block}',
    ':host([pane]) .fc,:host([pane]) .fcb{right:var(--hk-pane-w,0px)}',
    ':host([pane]) #hk-sky.own{position:absolute}',
    '.pane{position:absolute;z-index:4;top:0;right:0;bottom:0;width:var(--hk-pane-w,' + PANE_W + 'px);display:none;',
    // (a soft shadow off its left edge onto the photo: the pane sits a
    // little above it; drawn with the pane, it fades with it)
    '  border-left:1px solid rgba(255,255,255,0.10);background:linear-gradient(to bottom,rgba(8,12,22,0.30),rgba(8,12,22,0.60));',
    '  box-shadow:-18px 0 44px rgba(0,0,0,.42),-3px 0 12px rgba(0,0,0,.26);',
    '  color:var(--hk-ink,rgba(255,255,255,0.94));cursor:default}',
    // (there whenever a pane is asked for [panecfg]; up [pane] or not --
    // the music alone comes and goes with the music -- faded with a photo)
    ':host([panecfg]) .pane{display:block}',
    '.pane{opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
    ':host([pane]) .pane{opacity:1}',
    // the pane's music fades in and out with the music (its blurred art is
    // the whole pane's background beside the calendar too)
    ':host(:not([pm])) .pm{opacity:0;visibility:hidden}',
    // on the forecast it is the night sky's navy, faded in and out with it
    // (a layer of its own for good, like every fading layer here)
    '.pane::before{content:"";position:absolute;inset:0;background:linear-gradient(to bottom,rgba(14,22,40,0.97),rgba(8,12,22,0.99));',
    '  opacity:0;transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
    ':host([forecast]) .pane::before,:host([fcslide]) .pane::before{opacity:1}',
    // the list between Home Status (above) and what plays and the timers
    // (its foot, below), each as tall as it is now (paneStack)
    '.pane .sc{position:absolute;z-index:1;left:0;right:0;top:var(--hk-pane-top,' + PANE_TOP + 'px);bottom:var(--hk-pane-bottom,0px);overflow-y:auto;overflow-x:hidden;',
    '  padding:0 var(--hk-pane-pad,28px);box-sizing:border-box;border-top:1px solid rgba(255,255,255,0.10);touch-action:pan-y;',
    '  overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;',
    '  -webkit-mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 90px),transparent 100%);',
    '  mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 90px),transparent 100%)}',
    '.pane .sc::-webkit-scrollbar{display:none}',
    // THE MUSIC (music_slide: .mu, a slide like the forecast's layer;
    // music_pane: .pm, in the pane). Sizes are a 1280 x 800 tablet's,
    // scaled with the screen (--z). Nothing here takes pointer events: the
    // buttons are found by place (musicHit), as the forecast details are.
    '.mu{position:absolute;inset:0;z-index:0;opacity:0;visibility:hidden;pointer-events:none;will-change:opacity;background:#000;',
    '  overflow:hidden;transition:opacity ' + CROSSFADE_MS + 'ms ease;--z:var(--hk-mu-z,1)}',
    '.mu.top{opacity:1;visibility:visible}',
    // (its blurred art under the pane too, seen through it; the song beside it)
    '.mu .mbody{container-type:size;--a:min(62cqh,42cqw)}',
    ':host([pane]) .mu .mbody{right:var(--hk-pane-w,0px)}',
    '.pm{position:absolute;left:0;right:0;top:0;bottom:0;overflow:hidden;pointer-events:none;--z:var(--hk-mu-z,1);',
    '  transition:opacity ' + MU_ART_MS + 'ms ease,visibility 0s linear ' + MU_ART_MS + 'ms;will-change:opacity}',
    ':host([pm]) .pm{transition:opacity ' + MU_ART_MS + 'ms ease,visibility 0s}',
    // the blurred art, two of them for the fade from one song to the next
    '.mbgf{position:absolute;inset:0;opacity:0;will-change:opacity;transition:opacity ' + MU_ART_MS + 'ms ease}',
    '.mbgf.on{opacity:1}',
    '.mbg{position:absolute;left:-8%;top:-8%;width:116%;height:116%;object-fit:cover;display:block}',
    '.mshade{position:absolute;inset:0;background:linear-gradient(to right,rgba(0,0,0,.36),rgba(0,0,0,.06) 62%,rgba(0,0,0,.10))}',
    '.pm .mshade{background:rgba(0,0,0,.28)}',
    '.mbody{position:absolute;inset:0;color:var(--hk-ink,rgba(255,255,255,0.94));text-align:left;text-shadow:0 1px 14px rgba(0,0,0,.22)}',
    '.msq{position:relative;width:100%;height:100%;border-radius:calc(14px * var(--z));background:rgba(255,255,255,.10);',
    '  box-shadow:0 calc(22px * var(--z)) calc(60px * var(--z)) rgba(0,0,0,.42)}',
    '.mph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
    '.mph svg{width:38%;height:38%;fill:rgba(255,255,255,.42)}',
    '.mfr{position:absolute;inset:0;opacity:0;will-change:opacity;transition:opacity ' + MU_ART_MS + 'ms ease}',
    '.mfr.on{opacity:1}',
    '.mfr img{display:block;width:100%;height:100%;object-fit:cover;border-radius:calc(14px * var(--z))}',
    // AN IMAGE WITH NO PICTURE IS NOT DRAWN: the browser outlines an empty
    // <img>, a faint light border round the no-artwork placeholder (seen on
    // the tablets, 2026-10-11) -- the big art's and Up Next's alike
    '.mu img:not([src]),.pm img:not([src]){visibility:hidden}',
    '.mroom,.martist,.malbum,.mnt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mroom{font-size:calc(19px * var(--z));font-weight:600;opacity:.74;letter-spacing:.1px}',
    '.mtitle{font-size:calc(44px * var(--z));font-weight:700;letter-spacing:-.6px;line-height:1.1;margin-top:calc(10px * var(--z));',
    '  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}',
    '.martist{font-size:calc(28px * var(--z));font-weight:600;opacity:.92;margin-top:calc(6px * var(--z))}',
    '.malbum{font-size:calc(21px * var(--z));font-weight:500;opacity:.62;margin-top:calc(4px * var(--z))}',
    '.mprog{position:relative;margin-top:calc(22px * var(--z))}',
    '.mbar{height:calc(5px * var(--z));border-radius:99px;background:rgba(255,255,255,.22);overflow:hidden}',
    '.mbar i{display:block;height:100%;background:rgba(255,255,255,.92);transform-origin:0 50%;transform:scaleX(0)}',
    '.mtimes{position:absolute;left:0;right:0;top:100%;display:flex;justify-content:space-between;font-size:calc(15px * var(--z));opacity:.66;margin-top:calc(7px * var(--z));',
    '  font-variant-numeric:tabular-nums}',
    // as much room above the buttons as below them
    // (the volume beside them, or on a row of its own where there is no room)
    // EVEN ROOM ABOUT THE BUTTONS: the progress bar --g above them, the
    // volume's bar --g below them. Both rows are as tall as their bar alone:
    // the times hang under the progress bar in that room, the volume's
    // icons and knob overflow its row evenly.
    '.mctl{display:flex;flex-wrap:wrap;align-items:center;--g:calc(46px * var(--z));gap:var(--g) calc(22px * var(--z));margin-top:var(--g)}',
    '.mbtn{flex:none;width:calc(60px * var(--z));height:calc(60px * var(--z));border-radius:50%;display:flex;align-items:center;',
    '  justify-content:center;background:rgba(255,255,255,.14);transition:transform .15s ease,background-color .15s ease}',
    '.mbtn svg{width:46%;height:46%;fill:#fff}',
    '.mbtn.mpp{width:calc(76px * var(--z));height:calc(76px * var(--z));background:rgba(255,255,255,.92)}',
    '.mbtn.mpp svg{fill:#111;width:42%;height:42%}',
    '.mbtn.hit{transform:scale(.88);background:rgba(255,255,255,.32)}',
    // SPEAKERS AND BROWSE either side of the transport (hk-saver-panel.js):
    // outlined, lighter than it, so play / pause stays the main thing; lit
    // while their panel is open
    '.mbtn.mx{width:calc(48px * var(--z));height:calc(48px * var(--z));background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 calc(1.5px * var(--z)) rgba(255,255,255,.30)}',
    '.mbtn.mx svg{width:52%;height:52%}',
    '.mbtn.mx hk-icon{--mdc-icon-size:calc(25px * var(--z));width:calc(25px * var(--z));height:calc(25px * var(--z));color:#fff;display:flex}',
    '.mbtn.mx.on{background:#fff;box-shadow:none}',
    '.mbtn.mx.on svg{fill:#111}',
    '.mbtn.mx.on hk-icon{color:#111}',
    '[nomx] .mbtn.mx{display:none}',
    '.mbtn.mpp.hit{background:#fff}',
    '.mnext{display:flex;align-items:center;gap:calc(14px * var(--z));margin-top:calc(30px * var(--z));min-width:0}',
    // THE VOLUME beside the buttons (its own row in the pane)
    '.mvol{flex:1 1 calc(170px * var(--z));height:calc(6px * var(--z));display:flex;align-items:center;gap:calc(12px * var(--z))}',
    '.mvol svg{flex:none;width:calc(22px * var(--z));height:calc(22px * var(--z));fill:rgba(255,255,255,.72)}',
    '.mvt{position:relative;flex:1 1 auto;height:100%;border-radius:99px;background:rgba(255,255,255,.22)}',
    '.mvt i{position:absolute;left:0;top:0;bottom:0;width:calc(var(--v,0) * 100%);border-radius:99px;background:rgba(255,255,255,.92)}',
    '.mvt b{position:absolute;top:50%;left:calc(var(--v,0) * 100%);width:calc(20px * var(--z));height:calc(20px * var(--z));',
    '  margin:calc(-10px * var(--z)) 0 0 calc(-10px * var(--z));border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.3);',
    '  transition:transform .12s ease}',
    '[dragging] .mvt b{transform:scale(1.25)}',
    '[novol] .mvol{visibility:hidden}',
    '.pm[novol] .mvol{display:none}',
    // (the next song's cover when Music Assistant has it -- often not until it
    // plays -- over a note, as the big art's placeholder)
    '.mnth{position:relative;flex:none;width:calc(50px * var(--z));height:calc(50px * var(--z));border-radius:calc(8px * var(--z));',
    '  overflow:hidden;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center}',
    '.mnth svg{width:50%;height:50%;fill:rgba(255,255,255,.45)}',
    '.mnth img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
    '.mnx{min-width:0}',
    '.mnl{font-size:calc(13px * var(--z));font-weight:700;letter-spacing:.8px;text-transform:uppercase;opacity:.55}',
    '.mnt{font-size:calc(18px * var(--z));font-weight:500;opacity:.86;margin-top:calc(2px * var(--z))}',
    '[nodur] .mprog,[nonext] .mnext{display:none}',
    // A NEW SONG KEEPS THE ROWS' PLACES while Music Assistant is asked what
    // comes next (and while its duration catches up): the column is held at
    // its foot, so a row gone for that moment dropped the song and the
    // buttons by its height and back -- a jump at every song change
    '.mnext{transition:opacity .3s ease}',
    '[nextwait] .mnext{opacity:0}',
    // (Speakers and Browse stay: with nothing playing they are the way to
    // start something -- where it plays, and what)
    '[idle] .martist,[idle] .malbum,[idle] .mprog,[idle] .mnext,[idle] .mbtn:not(.mpp):not(.mx){display:none}',
    '.pm[none]{display:none}',
    // THE SLIDE: the art on the right, the song below the clock, the date
    // and the weather on the left (what does not fit there goes: layoutMusic)
    '.mu .mart{position:absolute;width:var(--a);height:var(--a);right:6cqw;top:calc(50cqh - var(--a) / 2)}',
    '.mu .mcol{position:absolute;left:calc(50px * var(--z));bottom:max(7cqh,calc(40px * var(--z)));',
    '  width:calc(100cqw - var(--a) - 6cqw - 114px * var(--z))}',
    '.mu[tight="1"] .mnext,.mu[tight="2"] .mnext,.mu[tight="2"] .malbum{display:none}',
    // A NARROW COLUMN (beside the pane): the volume on a row of its own, the
    // buttons centred between it and the progress bar above them
    '.mu .mcol{container-type:inline-size}',
    '@container (max-width:470px){.mu .mctl{justify-content:center;--g:calc(34px * var(--z));column-gap:calc(12px * var(--z))}.mu .mvol{flex-basis:100%}',
    '  .mu .mbtn.mx{width:calc(44px * var(--z));height:calc(44px * var(--z))}}',
    '.mu[tight="2"] .mtitle{-webkit-line-clamp:1}',
    // what plays steps aside: the slide shows it big, the pane has it
    '.info > hk-screensaver-now-card{transition:opacity ' + CROSSFADE_MS + 'ms ease;will-change:opacity}',
    ':host([muslide]) .info > hk-screensaver-now-card{opacity:0}',
    ':host([pm]) .info > hk-screensaver-now-card{display:none}',
    // THE PANE'S MUSIC alone: all of the pane, the art as big as fits
    ':host(:not([pcal])) .pane .sc{display:none}',
    ':host(:not([pcal])) .pm .mbody{display:flex;flex-direction:column;text-align:center;',
    '  padding:var(--hk-pane-top,74px) var(--hk-pane-pad,28px) var(--hk-pm-foot,22px)}',
    ':host(:not([pcal])) .pm .mart{flex:1 1 auto;min-height:0;container-type:size;display:flex;align-items:center;justify-content:center;',
    '  margin:calc(10px * var(--z)) 0 calc(22px * var(--z))}',
    ':host(:not([pcal])) .pm .msq{width:min(100cqw,100cqh);height:min(100cqw,100cqh)}',
    ':host(:not([pcal])) .pm .mcol{flex:none}',
    ':host(:not([pcal])) .pm .mroom{font-size:calc(14px * var(--z))}',
    ':host(:not([pcal])) .pm .mtitle{font-size:calc(25px * var(--z));letter-spacing:-.3px;margin-top:calc(6px * var(--z))}',
    ':host(:not([pcal])) .pm .martist{font-size:calc(18px * var(--z))}',
    ':host(:not([pcal])) .pm .malbum{font-size:calc(15px * var(--z))}',
    ':host(:not([pcal])) .pm .mprog{margin-top:calc(16px * var(--z))}',
    ':host(:not([pcal])) .pm .mtimes{font-size:calc(12px * var(--z))}',
    '.pm .mvol{flex:1 0 100%;order:9}',
    ':host(:not([pcal])) .pm .mctl{justify-content:center;--g:calc(36px * var(--z));column-gap:calc(22px * var(--z))}',
    ':host(:not([pcal])) .pm .mbtn{width:calc(50px * var(--z));height:calc(50px * var(--z))}',
    ':host(:not([pcal])) .pm .mbtn.mpp{width:calc(62px * var(--z));height:calc(62px * var(--z))}',
    ':host(:not([pcal])) .pm .mbtn.mx,:host([pcal]) .pm .mbtn.mx{width:calc(42px * var(--z));height:calc(42px * var(--z))}',
    '.pm .mbtn.mx hk-icon{--mdc-icon-size:calc(22px * var(--z));width:calc(22px * var(--z));height:calc(22px * var(--z))}',
    ':host(:not([pcal])) .pm .mnext{justify-content:center;margin-top:calc(28px * var(--z));text-align:left}',
    ':host(:not([pcal])) .pm .mnth{width:calc(38px * var(--z));height:calc(38px * var(--z))}',
    ':host(:not([pcal])) .pm .mnl{font-size:calc(10px * var(--z))}',
    ':host(:not([pcal])) .pm .mnt{font-size:calc(14px * var(--z))}',
    // ...UNDER THE CALENDAR: a row (the art beside the song), as tall as it
    // is, the list above it (paneStack)
    // (the art's blur behind the events too, a little darker there for
    // them; the music set off by a hairline, not an edge)
    ':host([pcal]) .pm .mshade{background:linear-gradient(to bottom,rgba(0,0,0,.42),rgba(0,0,0,.34) 45%,rgba(0,0,0,.24))}',
    ':host([pcal]) .pm .mbody::before{content:"";position:absolute;top:0;left:var(--hk-pane-pad,28px);right:var(--hk-pane-pad,28px);',
    '  border-top:1px solid rgba(255,255,255,0.14)}',
    ':host([pcal]) .pm .mbody{position:absolute;top:auto;left:0;right:0;bottom:0;display:grid;grid-template-columns:calc(120px * var(--z)) minmax(0,1fr);',
    '  column-gap:calc(18px * var(--z));align-items:center;padding:calc(22px * var(--z)) var(--hk-pane-pad,28px) var(--hk-pm-foot,22px)}',
    ':host([pcal]) .pm .mart{grid-row:1 / span 4;width:calc(120px * var(--z));height:calc(120px * var(--z))}',
    ':host([pcal]) .pm .msq{border-radius:calc(12px * var(--z))}',
    ':host([pcal]) .pm .mfr img{border-radius:calc(12px * var(--z))}',
    ':host([pcal]) .pm .mcol{display:contents}',
    ':host([pcal]) .pm .mroom,:host([pcal]) .pm .mtitle,:host([pcal]) .pm .martist,:host([pcal]) .pm .malbum{grid-column:2}',
    ':host([pcal]) .pm .mprog,:host([pcal]) .pm .mctl,:host([pcal]) .pm .mnext{grid-column:1 / -1}',
    ':host([pcal]) .pm .mroom{font-size:calc(13px * var(--z))}',
    ':host([pcal]) .pm .mtitle{font-size:calc(22px * var(--z));letter-spacing:-.3px;margin-top:calc(4px * var(--z))}',
    ':host([pcal]) .pm .martist{font-size:calc(17px * var(--z));margin-top:calc(3px * var(--z))}',
    ':host([pcal]) .pm .malbum{font-size:calc(14px * var(--z));margin-top:calc(2px * var(--z))}',
    ':host([pcal]) .pm .mprog{margin-top:calc(18px * var(--z))}',
    ':host([pcal]) .pm .mtimes{font-size:calc(12px * var(--z))}',
    ':host([pcal]) .pm .mctl{justify-content:center;--g:calc(34px * var(--z));column-gap:calc(20px * var(--z))}',
    ':host([pcal]) .pm .mvol{height:calc(5px * var(--z))}',
    ':host([pcal]) .pm .mvol svg{width:calc(18px * var(--z));height:calc(18px * var(--z))}',
    ':host([pcal]) .pm .mvt b{width:calc(16px * var(--z));height:calc(16px * var(--z));margin:calc(-8px * var(--z)) 0 0 calc(-8px * var(--z))}',
    ':host([pcal]) .pm .mbtn{width:calc(50px * var(--z));height:calc(50px * var(--z))}',
    ':host([pcal]) .pm .mbtn.mpp{width:calc(62px * var(--z));height:calc(62px * var(--z))}',
    ':host([pcal]) .pm .mnext{margin-top:calc(24px * var(--z));gap:calc(12px * var(--z))}',
    ':host([pcal]) .pm .mnth{width:calc(38px * var(--z));height:calc(38px * var(--z));border-radius:calc(7px * var(--z))}',
    ':host([pcal]) .pm .mnl{font-size:calc(10px * var(--z))}',
    ':host([pcal]) .pm .mnt{font-size:calc(14px * var(--z))}',
    ':host([pcal]) .pm[idle] .mctl{grid-column:1 / -1}',
    '@media (prefers-reduced-motion:reduce){.ph,.phscrim,.fcscrim,.mu,.mfr,.mbgf{transition:none}.ph.zoom img.fg{animation:none}}'
  ].join('\n');

  function build() {
    host = document.createElement('hk-screensaver');
    root = host.attachShadow({ mode: 'open' });
    var font = viewFont();
    if (font) host.style.setProperty('--hk-saver-font', font);
    // (the calendar pane's list rides under Home Status: hk-base.js shade --
    // the cards are loaded by the time a screensaver starts)
    var HC = window.hkCards;
    if (HC && HC.flatSurface) HC.flatSurface(host, 'screensaver');
    var st = document.createElement('style'); st.textContent = CSS + (HC && HC.flatCss ? HC.flatCss() : '') +
      ':host([hk-flat]){background:var(--hk-flat-ground)}' +
      ':host([hk-flat]) .pane,:host([hk-flat]) .mu,:host([hk-flat]) .pm{' + (HC && HC.flatVars ? HC.flatVars('dark') : '') + ';background:#24252A}' +
      ':host([hk-flat]) .mbgf,:host([hk-flat]) .mshade{display:none}' +
      ':host([hk-flat]) .sc,:host([hk-flat]) .pane{color:var(--hk-ink)}'  + (HC && HC.edgeCss ? '\n' + HC.edgeCss() : ''); root.appendChild(st);
    for (var i = 0; i < 2; i++) {
      var ph = document.createElement('div'); ph.className = 'ph';
      var bg = document.createElement(isFlat() ? 'div' : 'canvas'); bg.className = 'bg'; bg.hidden = true;
      var fg = document.createElement('img'); fg.className = 'fg'; fg.alt = '';
      var scrim = document.createElement('div'); scrim.className = 'phscrim';
      ph.appendChild(bg); ph.appendChild(fg); ph.appendChild(scrim); root.appendChild(ph);
    }
    var pane = document.createElement('div'); pane.className = 'pane';
    var sc = document.createElement('div'); sc.className = 'sc'; pane.appendChild(sc); root.appendChild(pane);
    // (its ends fade as it scrolls, as every list's do: hk-base.js SCROLL EDGES)
    sc.classList.add('hk-fades');
    if (HC && HC.edges) HC.edges(sc);
    paneEl = pane; paneSc = sc; paneCard = null;
    var info = document.createElement('div'); info.className = 'info'; root.appendChild(info);
    var nw = document.createElement('div'); nw.className = 'nightwash'; root.appendChild(nw);
    var blk = document.createElement('div'); blk.className = 'blk'; root.appendChild(blk);
    // taps on the screensaver itself: the window listener above has already
    // decided (edge zone or stop); here they are only kept from reaching
    // anything else
    ['click', 'pointerup', 'mouseup', 'touchend', 'contextmenu'].forEach(function (t) {
      host.addEventListener(t, function (e) {
        e.stopPropagation();
        // (the music's panel: its taps are its own -- a click, a field focused)
        if (t !== 'contextmenu' && inPanel(e)) return;
        if (e.cancelable) e.preventDefault();
      });
    });
    document.body.appendChild(host);
    buildCards(info);
  }
  function teardown() {
    if (host) { host.removeAttribute('dark'); host.removeAttribute('undark'); }
    coverDashboard(false);
    blackPage(false);
    releaseVisuals();
    if (host) host.remove();
    host = null; root = null; press = null;
    noteDrawn();
    // gone for good: the camera strip starts its live stream after this
    try { window.dispatchEvent(new Event('hk-saver-done')); } catch (e) { /* ignore */ }
  }
  // The transparent host may still be catching wake-up taps. Its graphics
  // and card subscriptions need not survive that interaction-only period.
  function releaseVisuals() {
    if (fadeDone) fadeDone();
    displayLayer = null;
    leaveExtras();
    leaveEnergy();
    leaveWeather();
    leaveForecast();
    leaveMusic();
    leaveClock();
    if (unsubCards) { unsubCards(); unsubCards = null; }
    cards = [];
    if (host) {
      // let the browser drop the decoded photos now, not at the next GC
      root.querySelectorAll('img').forEach(function (im) { im.removeAttribute('src'); });
      root.querySelectorAll('canvas').forEach(clearCanvas);
      Array.from(root.children).forEach(function (el) { if (el.tagName !== 'STYLE') el.remove(); });
      host.setAttribute('released', '');
    }
    paneEl = null; paneSc = null; paneCard = null; paneUp = false;
    if (paneT) { clearInterval(paneT); paneT = null; }
    if (paneResetT) { clearTimeout(paneResetT); paneResetT = null; }
  }
  var builtFor = null;
  function cfgKey() { try { return JSON.stringify(cfg); } catch (e) { return String(Math.random()); } }
  function buildCards(info) {
    var h = clientNow();
    cards = [];
    (cfg.cards || []).forEach(function (c, i) {
      var tag = tagOf(c.type);
      var make = function () {
        if (!host || !on || info.parentNode !== root) return;
        try {
          var el = document.createElement(tag);
          el.__hkSaverConf = c;
          // (the corner clock under a big one: there only under the music)
          if (c.music_only) el.setAttribute('muonly', '');
          el.setConfig(cardConf(c, tag));
          feedCard(el, h);
          // IN THE ORDER WRITTEN, whenever each one is defined: a page
          // reloaded under the switch started this before hk-weather.js had
          // loaded, and the weather (defined first there) came in above the
          // clock (2026-10-04)
          el.__hkSaverIdx = i;
          var after = Array.prototype.filter.call(info.children, function (x) { return x.__hkSaverIdx > i; })[0];
          if (after) info.insertBefore(el, after); else info.appendChild(el);
          cards.push(el);
        } catch (e) { console.warn('[hk-saver] card', tag, e); }
      };
      // the card files load after this module; by the time a screensaver
      // starts they are normally defined, but a page reloaded straight into
      // the sleep script may still be loading them
      if (customElements.get(tag)) make();
      else if (customElements.whenDefined) customElements.whenDefined(tag).then(make);
    });
    if (window.hkCards && window.hkCards.onClient) unsubCards = window.hkCards.onClient(onClientCards);
  }
  // A CARD'S CONFIG for where it is now: Home Status at the top of the
  // pane sized for it, and the timers in its foot -- set again whenever the
  // pane comes or goes (setPane)
  function cardConf(c, tag) {
    var conf = Object.assign({}, c, { type: c.type });
    if (paneUp && tag === 'hk-screensaver-status-card') { conf.line1_size = '22px'; conf.line_size = '16px'; conf.align = 'left'; }
    if (paneUp && tag === 'hk-timer-strip-card') conf.scale = Math.round(1.15 * scaleOf() * 100) / 100;
    return conf;
  }
  function onClientCards(h) {
    cards.forEach(function (c) { try { feedCard(c, h); } catch (e) { /* ignore */ } });
    if (ckCtl) ckCtl.setClient(h);
    if (enCtl && enShowing) enCtl.setClient(h);
    if (wxCtl && wxShowing) wxCtl.setClient(h);
  }

  // ------------------------------------------------------------ start / stop
  function start(reason) {
    if (on || !cfg || !allowed()) return false;
    // NOTHING STARTS UNDER THE KIOSK'S BLACK (2026-10-09). The house's sleep
    // turns the photos on and puts the black up in the same moment; started
    // under it and turned black at once, the screensaver was never shown --
    // the tablet's last frame was the dashboard -- yet the wake went through
    // black: dashboard, black, dashboard (screen-recorded on the Loft). Under
    // the black nobody sees photos anyway. The switch asks again on every
    // update, so they start when the black has ended -- after LIT_GRACE, the
    // house's answer to a tap (photos off within 2 s, TABLET-INVARIANTS 16c).
    if (black()) return false;
    if (reason === 'switch' && clock.now() - litAt < LIT_GRACE) return false;
    if (idleT) { clearTimeout(idleT); idleT = null; }
    on = true; startedBy = reason || 'idle'; mx = null; my = null; press = null; shownAt = 0;
    photoRun++; busy = false; queued = null; litWait = null;
    // BUILT FOR OTHER SETTINGS: its cards were set up for them (Home Status
    // sized for the calendar pane, or for the corner), and a host kept from
    // an earlier start kept them -- the pane turned off on HK Settings left
    // Home Status small, halfway along the top (2026-10-01). Built again.
    if (host && (host.hasAttribute('blocking') || host.hasAttribute('released') || builtFor !== cfgKey())) teardown();
    if (!host) { build(); builtFor = cfgKey(); }
    host.style.setProperty('--fade', FADE_IN_MS + 'ms');
    if (cfg.zoom) host.setAttribute('zoom', ''); else host.removeAttribute('zoom');
    host.removeAttribute('blocking');
    host.removeAttribute('waking');       // started again while waking
    host.removeAttribute('dark');
    // Once fully covered, release the dashboard's paint layers. Pausing its
    // animations alone still retains clouds, glass and offscreen cards. On
    // Android those plus the forecast exceeded the tile memory budget and
    // the WebView dropped photos, the clock and forecast days from the screen.
    // Counted from the frame the fade starts, not from here: a hidden page
    // runs timeouts but no frames, and would hide the dashboard under a saver
    // still at opacity 0.
    if (coverT) clearTimeout(coverT);
    coverT = null;
    // THE FADE STARTS ONCE THERE IS SOMETHING TO SHOW (2026-10-09): the first
    // photo decoded and painted -- or the forecast built -- and two frames
    // drawn at [prep]'s barely-there opacity, so the tablet has rastered it;
    // never later than ENTRANCE_MAX
    host.setAttribute('prep', '');
    var run = photoRun, entered = false;
    entrance = function (force) {
      if (entered) return;
      // ...AND THE FORECAST BAND IN ITS PLACE (2026-10-09): it is built
      // hidden, centred, drawn again for its width beside the calendar pane
      // and only then shown (addBand, ~0.65 s). Started before that, the fade
      // ran over its redraw, and a tablet shows frames during a fade before
      // what changed is drawn: the band vanished for two frames halfway
      // through (screen-recorded on the Kitchen). Its `placed` calls this
      // again; ENTRANCE_MAX forces it.
      if (!force && fband && !fband.__hkPlaced && host && host.hasAttribute('band')) return;
      entered = true; entrance = null;
      var f1 = false, f2 = false;           // each frame's step once
      requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
        if (f2) return; f2 = true;
        if (!on || !host || photoRun !== run) return;
        host.removeAttribute('prep');
        host.setAttribute('on', '');
        shownAt = clock.now();
        noteDrawn();
        if (coverT) clearTimeout(coverT);
        coverT = setTimeout(function () { coverT = null; if (on) coverDashboard(true); }, FADE_IN_MS + 100);
      }); });
    };
    setTimeout(function () { if (photoRun === run && entrance) entrance(true); }, ENTRANCE_MAX);
    tellOthers();
    if (reason !== 'switch') writeSwitch('on');
    resetForecast();            // an element still fading out is reused
    setupPane();
    leaveClock();
    if (cfg.show === 'clock') enterClock();
    else if (cfg.show === 'forecast') enterForecast();
    // MUSIC FIRST, music playing: straight into it
    else if (cfg.music_first && musicPlaying()) { updateBand(); if (!showMusicSlide(true)) showNext(true); }
    else { updateBand(); showNext(true); }
    // A LARGE CLOCK over the photos or the forecast (the corner one is a card)
    if (cfg.show !== 'clock' && cfg.clock_large) mountClock('none');
    // HOME ENERGY: its numbers asked for now, so its first turn has them;
    // the additional screens' timer
    energyPrep();
    weatherPrep();
    exArm();
    return true;
  }
  function stop(reason) {
    if (!on) return false;
    closePanel(false);
    on = false;
    entrance = null;
    if (host) host.removeAttribute('prep');
    // JUST WOKEN FROM A FROZEN PAGE (justResumed): what the screensaver shows
    // is stale and half drawn, so it wakes from black -- plain black at once,
    // the dashboard drawn under it, then the usual fade back to it
    if (host && justResumed()) { host.setAttribute('dark', ''); host.setAttribute('on', ''); }
    noteDrawn();
    photoRun++; busy = false; queued = null;
    // UNDER THE KIOSK'S BLACK, A DASHBOARD HIDDEN UNDER THE PHOTOS STAYS
    // HIDDEN until the tablet draws again (afterDraw's `drawing`): shown
    // where nothing is drawn, the tablet's first frame back had to draw all
    // of it at once, and showed it half drawn over everything for a frame
    // (screen-recorded)
    var keep = !!(host && host.hasAttribute('dark') && black());
    if (!keep) coverDashboard(false);
    if (slideT) { clearTimeout(slideT); slideT = null; }
    if (exT) { clearTimeout(exT); exT = null; }
    var ms = isFlat() ? 0 : cfg ? cfg.fade_back : FADE_BACK_MS;
    if (reason === 'touch') { writeSwitch('off'); press = { up: pressStop ? null : clock.now(), at: clock.now() }; }
    pressStop = false;
    // the dashboard, its sky and its cameras wake now, under the screensaver
    tellOthers();
    var h = host, stoppedRun = photoRun;
    if (h) {
      var still = function () { return !on && host === h && photoRun === stoppedRun; };
      h.style.setProperty('--fade', '0ms');
      h.setAttribute('waking', '');
      var fade = function () {
        if (!still()) return;
        h.style.setProperty('--fade', ms + 'ms');
        h.removeAttribute('on');
        h.removeAttribute('waking');
        noteDrawn();
        if (reason === 'touch') h.setAttribute('blocking', '');
        if (reason === 'touch') setTimeout(function () { if (still()) releaseVisuals(); }, ms + 50);
        // a touch's host stays until the taps are no longer swallowed;
        // otherwise it goes when its fade has ENDED, not when a timer of the
        // fade's length says so: just woken, the page is busy, the fade's
        // frames start late, and the timer cut its last fifth off -- the
        // dashboard stepped up at the end (screen-recorded)
        if (reason === 'touch') {
          var faded = false, p = press;
          var release = function () {
            if (!still() || !faded) return;
            var now = clock.now(), up = p && p.up !== null ? p.up : (p && now - p.at >= PRESS_MAX ? now - GHOST_MS : null);
            if (up === null) { setTimeout(release, 100); return; }          // the finger is still down
            if (now < up + GHOST_MS) { setTimeout(release, up + GHOST_MS - now + 5); return; }
            teardown();
          };
          afterFade(h, ms, function () { faded = true; release(); });
        } else afterFade(h, ms, function () { if (still()) teardown(); });
      };
      var shown = function () { if (still()) { coverDashboard(false); blackPage(false); } };
      // AS IT COMES BACK the tablet first shows the frame it last drew
      // (through the kiosk's own fade off its black), so the wake goes on
      // from that frame -- never a cut to something else
      var fromLast = function () {
        if (!still()) return;
        if (drawnAs === 'dark') h.setAttribute('dark', '');      // black, then the fade
        else if (drawnAs === 'dashboard') {                       // the dashboard, at once
          shown();
          h.removeAttribute('on'); h.removeAttribute('waking'); h.removeAttribute('dark');
        }
        else { shown(); h.removeAttribute('dark'); }             // the photos, then the fade
      };
      if (keep) {
        // STOPPED UNDER THE KIOSK'S BLACK (the house's wake turns the photos
        // off just before it takes the black down): nothing until the black
        // has ended. The tablet draws the page again a moment BEFORE it ends,
        // and its first frames after the black left out the screensaver's
        // own black -- the dashboard showed through, half drawn, for a frame
        // (screen-recorded). So the dashboard stays hidden over the page's
        // black background until frames have been drawn after it.
        blackPage(true);
        litWait = function () { fromLast(); afterDraw(fade, shown, null, drawnAs === 'dark'); };
      } else afterDraw(fade, shown, fromLast);
    }
    lastInput = Date.now();
    armIdle();
    return true;
  }
  // A wake held until the kiosk's black (or its panel off) has ended.
  var litWait = null;
  function lit() {
    if (black() || !litWait) return;
    var fn = litWait; litWait = null; fn();
  }
  // THE PAGE'S OWN BACKGROUND BLACK while the dashboard is held hidden under
  // the kiosk's black: whatever the tablet has not drawn again yet shows it.
  var pageBg = null;
  function blackPage(black) {
    var st = document.documentElement && document.documentElement.style;
    if (!st || !st.setProperty) return;
    if (black && pageBg === null) {
      pageBg = { value: st.getPropertyValue('background-color'), priority: st.getPropertyPriority ? st.getPropertyPriority('background-color') : '' };
      st.setProperty('background-color', '#000', 'important');
    } else if (!black && pageBg !== null) {
      if (pageBg.value) st.setProperty('background-color', pageBg.value, pageBg.priority);
      else st.removeProperty('background-color');
      pageBg = null;
    }
  }
  // Once the host's opacity transition has ended -- or FADE_LATE after its
  // length, should it never (no transition at 0 ms, or none drawn).
  var FADE_LATE = 1500;
  function afterFade(h, ms, fn) {
    if (isFlat()) { fn(); return; }
    var done = false;
    var end = function (e) { if (!e || (e.target === h && e.propertyName === 'opacity')) go(); };
    var go = function () {
      if (done) return;
      done = true;
      if (h.removeEventListener) h.removeEventListener('transitionend', end);
      fn();
    };
    if (h.addEventListener) h.addEventListener('transitionend', end);
    setTimeout(go, ms ? ms + FADE_LATE : 50);
  }
  // WHAT THE TABLET LAST SHOWED: after each change, seen in a frame's
  // callback -- one runs only when a frame is drawn, so never under the
  // kiosk's black -- and counted once two more frames have begun. One is not
  // enough: the frame the black went up on was begun and never shown (the
  // wake blinked from the old dashboard to black, screen-recorded).
  var drawnAs = 'dashboard', noteRun = 0;
  function noteDrawn() {
    if (typeof requestAnimationFrame !== 'function') return;
    var run = ++noteRun, seen = null;
    requestAnimationFrame(function () {
      if (seen) return;                    // each step once
      seen = !host || !host.hasAttribute('on') ? 'dashboard' : host.hasAttribute('dark') ? 'dark' : 'photos';
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (run === noteRun) drawnAs = seen; }); });
    });
  }
  // Two frames drawn (the dashboard under the 99 % screensaver), then
  // WAKE.hold for its pictures to come in.
  // NO FRAME BY WAKE.max: the page is not being drawn -- under the kiosk's
  // Black screensaver (it runs the page but draws none of it: the house's
  // wake turns the photos off before it takes the black down, and a night's
  // power-off selects the dashboard under it), or hidden. A fade run then
  // went unseen, and the black came down on a dashboard not yet drawn, half
  // its tiles missing for a frame (screen-recorded, 2026-10-09). So
  // `paused` (plain black), and the wait goes on for the frames however
  // long, then WAKE.lit -- the whole dashboard is drawn again.
  // `slow`: as after a wait from the start.
  // `drawing`: at the first frame -- or after a wait, the third: a tablet
  // that has not drawn the page meanwhile has let go of what it had drawn,
  // the screensaver's black too, and its first frame back showed the
  // dashboard through the black not yet drawn again (screen-recorded).
  function afterDraw(fn, drawing, paused, slow) {
    var done = false, drawn = false, waited = !!slow;
    var go = function () { if (!done) { done = true; if (drawing) drawing(); fn(); } };
    var frames = function (n, then) { requestAnimationFrame(n > 1 ? function () { frames(n - 1, then); } : then); };
    if (typeof requestAnimationFrame !== 'function') { setTimeout(go, WAKE.max); return; }
    requestAnimationFrame(function () {
      if (drawn) return;                   // each step once
      drawn = true;
      if (!waited) {
        if (drawing) drawing();
        frames(1, function () { setTimeout(go, WAKE.hold); });
        return;
      }
      frames(2, function () {
        if (drawing) drawing();
        frames(2, function () { setTimeout(go, WAKE.lit); });
      });
    });
    setTimeout(function () {
      if (drawn || done) return;
      if (!paused) { if (!slow) go(); return; }
      waited = true; paused();
    }, WAKE.max);
  }
  // The sky, the cards and a dismissed pop-up's record all follow this.
  function tellOthers() {
    try { if (window.hkSky && window.hkSky.saverChanged) window.hkSky.saverChanged(); } catch (e) { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent('hk-saver', { detail: { on: on } })); } catch (e) { /* ignore */ }
  }

  // `el` inside `root`, across shadow roots
  function within(root, el) {
    for (var n = el; n; n = n.parentNode || n.host) if (n === root) return true;
    return false;
  }
  // visibility preserves layout, scroll position and the connected HA data
  // subscription. Restore it before the screensaver fades out, and preserve
  // any visibility style that was already set by the page.
  function coverDashboard(covered) {
    if (!covered) {
      if (coverT) { clearTimeout(coverT); coverT = null; }
      if (coveredPage) {
        var st = coveredPage.style;
        if (pageVisibility.value) st.setProperty('visibility', pageVisibility.value, pageVisibility.priority);
        else st.removeProperty('visibility');
      }
      coveredView.forEach(function (c) {
        if (c.value) c.el.style.setProperty('visibility', c.value, c.priority); else c.el.style.removeProperty('visibility');
      });
      coveredPage = null; pageVisibility = null; coveredView = [];
      return;
    }
    if (coveredPage) return;
    var page = window.hkShell.root();
    if (!page || !page.style) return;
    coveredPage = page;
    pageVisibility = { value: page.style.getPropertyValue('visibility'), priority: page.style.getPropertyPriority('visibility') };
    page.style.setProperty('visibility', 'hidden', 'important');
    // THE VIEW, WHERE THE HOST KEEPS IT OUTSIDE ITS ROOT (Mantel: #view
    // beside #hk-shell-root, 2026-10-21). Left showing under the photos, the
    // whole dashboard -- its sky, its cards, the shared blur's layers -- kept
    // its compositing layers through the screensaver (~7 screens of them at
    // 1920 x 1200, headless), and Return to Home made a new page's ~120 under
    // it mid-turn. Hidden with the root, as Home Assistant's whole page is.
    var view = window.hkShell.viewContainer ? window.hkShell.viewContainer() : null;
    if (view && view.style && !within(page, view)) {
      coveredView.push({ el: view, value: view.style.getPropertyValue('visibility'), priority: view.style.getPropertyPriority('visibility') });
      view.style.setProperty('visibility', 'hidden', 'important');
    }
    // BACK TO THE TOP, UNSEEN (2026-10-04). The house's sleep script used to
    // do this with a Fully `javascript:` load_url -- which stole the
    // foreground from a running app (TABLET-INVARIANTS section 2) and which
    // Kiosk Satellite cannot run at all. The page is covered and hidden now,
    // so the jump is never seen, and the next wake lands on the top of the
    // dashboard whichever kiosk app is showing it.
    if (typeof window.scrollTo === 'function') {
      try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
    }
    // Camera teardown can visibly replace live video with its poster. Only
    // allow that once the entrance fade has covered and hidden the dashboard.
    try { window.dispatchEvent(new Event('hk-saver-covered')); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ photos
  function callWS(msg) {
    var h = clientNow();
    if (!h || !h.callWS) return Promise.reject(new Error('no connection'));
    return h.callWS(msg);
  }
  // A WRITE (or a service call over the WebSocket): the client's action port.
  function sendWS(msg) {
    var act = actionsNow();
    if (!act) return Promise.reject(new Error('no connection'));
    return act.callWS(msg);
  }
  // THE HOST'S OWN PHOTOS (hkShell.photoSource / listPhotos): a host with a
  // photo library of its own may give this screen one of its albums, and
  // lists the photos of a source it serves itself (each with its address).
  // Home Assistant has neither: the folder below, as always.
  function hostPhotoSource(src) {
    var SH = window.hkShell;
    var own = SH && typeof SH.photoSource === 'function' ? SH.photoSource(src) : null;
    return typeof own === 'string' && own ? own : null;
  }
  function hostPhotoList(src) {
    var SH = window.hkShell;
    var got = SH && typeof SH.listPhotos === 'function' ? SH.listPhotos(src) : null;
    return got && typeof got.then === 'function' ? got : null;
  }
  // Every image under the folder (sub-folders to LIST_DEPTH), at most LIST_MAX.
  function listPhotos() {
    var land = landscapes();
    var key = (land ? LANDSCAPES : cfg.photos) + '|' + cfg.order;
    if (deck && listKey === key && Date.now() - listAt < LIST_TTL_MS && deck.items.length) return Promise.resolve(deck);
    if (listing && listing.key === key) return listing;
    var out = [];
    function walk(id, depth) {
      if (out.length >= LIST_MAX) return Promise.resolve();
      return callWS({ type: 'media_source/browse_media', media_content_id: id }).then(function (r) {
        var kids = (r && r.children) || [];
        var sub = [];
        kids.forEach(function (k) {
          if (out.length >= LIST_MAX) return;
          if (k.can_expand && depth < LIST_DEPTH) sub.push(k.media_content_id);
          else if (!k.can_expand && isImage(k)) out.push({ id: k.media_content_id, title: k.title || '' });
        });
        return sub.reduce(function (p, s) { return p.then(function () { return walk(s, depth + 1); }); }, Promise.resolve());
      });
    }
    var hostList = land ? null : hostPhotoList(cfg.photos);
    var source = land
      ? fetch(LANDSCAPES + 'index.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
          ((j && j.photos) || []).forEach(function (p) {
            if (p && typeof p.file === 'string' && /^[\w.-]+\.(webp|jpe?g|png)$/i.test(p.file)) out.push({ id: 'hk-landscape/' + p.file, title: p.title || '', url: LANDSCAPES + p.file });
          });
        })
      // the host's own: a plain address each, as a landscape's (load)
      : hostList ? hostList.then(function (items) {
          (Array.isArray(items) ? items : []).forEach(function (p) {
            if (out.length < LIST_MAX && p && typeof p.id === 'string' && typeof p.url === 'string' && p.url) {
              var it = { id: 'host/' + p.id, title: typeof p.title === 'string' ? p.title : '', url: p.url }, fc = cleanFocus(p);
              if (fc.focus) it.focus = fc.focus;
              if (fc.faces) it.faces = fc.faces;
              out.push(it);
            }
          });
        })
      : walk(cfg.photos, 0);
    listing = source.then(function () {
      if (!deck || deck.order !== cfg.order) deck = new Deck(cfg.order);
      deck.set(out);
      listAt = Date.now(); listKey = key;
      return deck;
    }).catch(function (e) {
      console.warn('[hk-saver] photos', land ? LANDSCAPES : cfg.photos, e && e.message);
      if (!deck) deck = new Deck(cfg.order);
      listAt = Date.now() - LIST_TTL_MS + 60000;   // try again in a minute
      return deck;
    }).then(function (d) { listing = null; return d; });
    listing.key = key;
    return listing;
  }
  function load(item) {
    // (a landscape is a plain address; a photo of yours is resolved first)
    return (item.url ? Promise.resolve({ url: item.url }) : callWS({ type: 'media_source/resolve_media', media_content_id: item.id })).then(function (r) {
      var url = r && r.url;
      if (!url) throw new Error('no url');
      return new Promise(function (ok, fail) {
        var im = new Image();
        im.decoding = 'async';
        im.onload = function () {
          (im.decode ? im.decode().catch(function () { /* drawn anyway */ }) : Promise.resolve())
            .then(function () { ok({ url: url, w: im.naturalWidth, h: im.naturalHeight, item: item, img: im }); });
        };
        im.onerror = function () { fail(new Error('load')); };
        im.src = url;
      });
    });
  }
  var busy = false, queued = null;
  // HK SETTINGS' PREVIEW of Portrait or Landscape Photos (2026-10-13): a
  // photo of that shape (previewShape), and the same one again while the
  // settings change -- each change restarts the preview (restartPreview),
  // and a new photo every time would make a crop impossible to judge. Each
  // photo's shape is remembered once loaded, so the next pick skips the
  // others without loading them. Only the preview: a tablet keeps no photo.
  var lastPh = null, previewShape = null, shapes = {};
  function shapeOfPh(ph) { return ph.h > ph.w ? 'portrait' : 'landscape'; }
  function showNext(first) { advance(function () { return deck && deck.next(); }, first); }
  function nextPhoto() { moTap = true; advance(function () { return deck && deck.next(); }); }
  function previousPhoto() { moTap = true; advance(function () { return deck && deck.previous(); }); }
  function advance(pick, first) {
    if (!on || mode !== 'photos') return;
    if (busy) { queued = pick; return; }
    busy = true;
    var run = photoRun, saverRoot = root;
    function active() { return on && run === photoRun && root === saverRoot; }
    if (slideT) { clearTimeout(slideT); slideT = null; }
    var tries = 0, looks = 0;
    var want = previewOn && previewShape ? previewShape : null;
    function attempt() {
      return listPhotos().then(function (d) {
        if (!active()) return null;
        // NO PHOTOS (an empty folder, one that can't be read): the forecast
        if (!d || !d.items || !d.items.length) {
          if (on && (cfg.fallback || cfg.show === 'both')) enterForecast();
          return null;
        }
        // the preview, restarted by a change: the same photo again
        if (first && previewOn && lastPh && (!want || shapeOfPh(lastPh) === want)) return lastPh;
        var item = pick();
        // the preview's shape: skip the photos known to be the other one
        for (var k = 0; want && item && shapes[item.id] && shapes[item.id] !== want && k < d.items.length; k++) item = d.next();
        if (!item) return null;
        return load(item).then(function (ph) {
          shapes[item.id] = shapeOfPh(ph);
          if (want && shapes[item.id] !== want && ++looks < 12 && active()) { pick = function () { return d.next(); }; return attempt(); }
          return ph;
        }, function (e) {
          if (!active()) return null;
          failed++;
          if (++tries < 3) { pick = function () { return d.next(); }; return attempt(); }
          throw e;
        });
      });
    }
    // THE MOSAIC: its photos, all of them for a new layout -- or one, for a
    // cell of the one on screen (Changes: One at a Time; a tap on an edge
    // always brings a whole new mosaic)
    function attemptMosaic() {
      return listPhotos().then(function (d) {
        if (!active()) return null;
        if (!d || !d.items || !d.items.length) {
          if (on && (cfg.fallback || cfg.show === 'both')) enterForecast();
          return null;
        }
        var n = Math.min(moCount(), d.items.length);
        if (n < 2) return attempt();
        var one = !first && !moTap && cfg.mosaic_change === 'one' && moState && moState.n === n && moState.left > 0 && moState.layer === displayLayer;
        moTap = false;
        var want = one ? 1 : n, got = [], misses = 0;
        var step = function () {
          if (got.length >= want || !active()) return got;
          var item = got.length ? d.next() : pick();
          if (!item) return got;
          return load(item).then(function (ph) { shapes[item.id] = shapeOfPh(ph); got.push(ph); return step(); },
                                 function () { failed++; return ++misses < 4 ? step() : got; });
        };
        return Promise.resolve(step()).then(function (phs) {
          if (!active() || !phs.length) return null;
          if (one) return { mosaicOne: phs[0] };
          return phs.length >= 2 ? { mosaic: phs } : phs[0];
        });
      });
    }
    (mosaicOn() ? attemptMosaic() : attempt()).then(function (ph) {
      if (ph && active()) { if (ph.mosaic || ph.mosaicOne) paintMosaic(ph, first); else paint(ph, first); return true; }
      return false;
    }).catch(function () { return false; }).then(function (painted) {
      if (!active()) return;
      if (painted && mode === 'photos' && !exKind) { hideForecastSlide(); hideMusicSlide(); hideEnergySlide(); hideWeatherSlide(); }
      busy = false;
      if (!on) return;
      if (mode !== 'photos') { queued = null; return; }
      if (queued) { var q = queued; queued = null; advance(q); return; }
      schedule();
    });
  }
  function schedule() {
    if (slideT) clearTimeout(slideT);
    slideT = setTimeout(function () {
      slideT = null;
      if (!on || !cfg) return;             // stopped (its config gone) meanwhile
      // a hidden page (a backgrounded tab) does not turn photos, nor one
      // with the music's panel open
      if (document.hidden || pnl) { schedule(); return; }
      // the music holding the screen stays (musicWatch lets it go); an
      // additional screen over the photos behind the clock holds them
      if ((muShowing && takeover()) || exKind) { schedule(); return; }
      if (fcShowing || muShowing || enShowing || wxShowing) { showNext(false); return; }    // advance() takes the slide away
      // A SLIDE every few photos: the music, the forecast and Home Energy
      // take turns (the music only while it plays)
      if (sinceFc >= cfg.forecast_every) {
        var s = slideOf(cfg, musicPlaying(), lastSlide, energyReady(), weatherReady());
        if (s === 'music' && showMusicSlide()) { schedule(); return; }
        if (s === 'weather' && showWeatherSlide()) { schedule(); return; }
        if (s === 'energy' && showEnergySlide()) { schedule(); return; }
        if (s && cfg.show === 'both') { showForecastSlide(); schedule(); return; }
      }
      showNext(false);
    }, cfg.each_photo * 1000);
  }
  // Fade the incoming view ABOVE an opaque outgoing view. Swapping a photo
  // underneath an opaque forecast leaves it occluded: Android WebView can
  // defer rasterizing it until after the forecast has already faded to black.
  // The clock/pane and forecast details have fixed stacking levels above both.
  function reveal(next, first) {
    if (fadeDone) fadeDone();
    if (next === displayLayer) return;
    var old = displayLayer;
    next.style.transition = 'none';
    next.classList.remove('top');
    next.style.zIndex = '2';
    if (old) old.style.zIndex = '1';
    void next.offsetWidth;
    next.style.transition = first || !old ? 'none' : '';
    next.classList.add('top');
    displayLayer = next;
    var timer;
    var done = fadeDone = function () {
      if (fadeDone !== done) return;
      clearTimeout(timer);
      // An edge tap can interrupt a fade. Finish its incoming view before
      // removing the opaque backing, so the next handoff never starts dim.
      next.style.transition = 'none';
      void next.offsetWidth;
      if (old) {
        old.style.transition = 'none';
        old.classList.remove('top');
        old.style.zIndex = '0';
        if (old.classList.contains('ph')) {
          old.classList.remove('zoom');
          old.querySelectorAll('img').forEach(function (im) { im.removeAttribute('src'); });
          old.querySelectorAll('canvas').forEach(clearCanvas);
        }
      }
      next.style.zIndex = '1';
      fadeDone = null;
    };
    if (isFlat()) done(); else timer = setTimeout(done, first || !old ? 0 : CROSSFADE_MS + 100);
  }
  // THE BACKDROP: the photo drawn small and blurred (a 96 px wide copy at the
  // screen's shape, cover-cropped), which the canvas's CSS scales to the
  // screen -- the upscale itself is the softness. THE BLUR IS THE SCALING:
  // the photo goes into a copy a quarter that size first and comes back up
  // smoothly. A canvas filter (blur(2px)) did it before, and WebKit ignores
  // one: on a Mac or an iPad the copy was the photo at 96 px, enlarged --
  // pixelated behind the pane (HK Settings' preview, 2026-10-10).
  var BACKDROP_W = 96, BACKDROP_SMALL = 24;
  function drawBackdrop(c, img, small) {
    if (isFlat()) { clearCanvas(c); return; }
    if (!c || !img) return;
    var W = Math.max(1, window.innerWidth || 1280), H = Math.max(1, window.innerHeight || 800);
    c.width = BACKDROP_W; c.height = Math.max(1, Math.round(BACKDROP_W * H / W));
    var ctx = c.getContext && c.getContext('2d');
    if (!ctx) return;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var t = document.createElement('canvas'), sw = small || BACKDROP_SMALL;
    t.width = sw; t.height = Math.max(1, Math.round(sw * H / W));
    var tc = t.getContext && t.getContext('2d');
    if (!tc) return;
    var k = Math.max(t.width / iw, t.height / ih), dw = iw * k, dh = ih * k;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(img, (t.width - dw) / 2, (t.height - dh) / 2, dw, dh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t, 0, 0, c.width, c.height);
  }
  function clearCanvas(c) { if (c && c.width) { c.width = 0; c.height = 0; } }
  function paint(ph, first) {
    if (!root) return;
    if (fadeDone) fadeDone();
    var layers = root.querySelectorAll('.ph');
    var next = layers[1 - layer];
    var bg = next.querySelector('canvas.bg'), fg = next.querySelector('img.fg');
    next.classList.remove('zoom');
    // (a mosaic's cells, from before: gone)
    next.classList.remove('mo');
    next.querySelectorAll('.mowrap').forEach(function (w) { w.querySelectorAll('canvas').forEach(clearCanvas); w.remove(); });
    moState = null;
    var L = layOut(next, ph), fit = L.fit, lay = L.lay;
    // (the preview keeps it, to show again as its settings change)
    lastPh = previewOn ? ph : null;
    fg.src = ph.url;
    // (with the calendar pane the blurred copy is always there: it is the
    // pane's background)
    // THE PANE comes or goes with a new photo (music_pane alone, as music
    // starts or stops): each photo is laid out for the pane as it came in
    // ([pw]), so the one fading out never moves
    if (mus.paneNext !== null) { var pn = mus.paneNext; mus.paneNext = null; setPane(pn); }
    setAttr(next, 'pw', paneUp);
    if (fit.backdrop || paneUp || ckPhotos()) { drawBackdrop(bg, ph.img, lay.small); bg.hidden = false; } else { bg.hidden = true; clearCanvas(bg); }
    if (cfg.zoom) {
      next.style.setProperty('--zd', (cfg.each_photo * 1000 + CROSSFADE_MS) + 'ms');
      void next.offsetWidth;               // restart the zoom from 1
      next.classList.add('zoom');
    }
    reveal(next, first);
    layer = 1 - layer;
    // the first photo is in: the screensaver may fade in now (start)
    if (first && entrance) entrance();
    shown++; sinceFc++; lastPhoto = ph.item.title || ph.item.id;
  }

  // ------------------------------------------------------------ the mosaic
  // A MOSAIC ON A LAYER (2026-10-13): each photo drawn into its own cell's
  // canvas, at the cell's size -- the full photo is dropped once it is drawn,
  // so five photos cost about what one full-screen photo does -- cropped by
  // its shape's Focus and Zoom. The two layers cross-fade as photos do.
  // Changes: One at a Time swaps one cell at a time in place (moState).
  var moState = null, moTap = false;
  function mosaicOn() { return !!(cfg && cfg.mosaic && mode === 'photos' && !(ckPhotos() && cfg.clock_photo_soft)); }
  function moGap() {
    if (cfg.mosaic_gap === 'none') return 0;
    return cfg.mosaic_line > 0 ? cfg.mosaic_line : cfg.mosaic_gap === 'rounded' ? 12 : 3;
  }
  // UP TO (2026-10-13): how many photos the mosaic shows now -- its own
  // number, or with Up To one picked from 1 to it, kept for mosaic_every
  // minutes (another each time); 1 is one photo, full screen
  var moRand = null;
  function moCount() {
    if (!cfg.mosaic_random) { moRand = null; return cfg.mosaic_count; }
    var now = clock.now();
    if (!moRand || now >= moRand.until || moRand.max !== cfg.mosaic_count) {
      var max = cfg.mosaic_count, prev = moRand ? moRand.n : 0, k = prev, tries = 0;
      while (k === prev && tries++ < 8) k = 1 + Math.floor(Math.random() * max);
      moRand = { n: k, max: max, until: now + cfg.mosaic_every * 60000 };
    }
    return moRand.n;
  }
  function moDraw(cell, ph) {
    var r = cell.getBoundingClientRect ? cell.getBoundingClientRect() : { width: 0, height: 0 };
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = Math.max(1, Math.round((r.width || 200) * dpr)), ch = Math.max(1, Math.round((r.height || 200) * dpr));
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var sc = shapeOfPh(ph) === 'portrait' ? cfg.portrait : cfg.landscape, x = cv.getContext && cv.getContext('2d');
    if (x) {
      var zm = ((sc || {}).zoom || 100) / 100, kv = faceWindow(ph.item, ph.w, ph.h, cw, ch, zm);
      var R = kv ? coverRect(ph.w, ph.h, cw, ch, kv.fx, kv.fy, zm)
        : coverRect(ph.w, ph.h, cw, ch, FOCUS_F[(sc || {}).x] != null ? FOCUS_F[sc.x] : 0.5, FOCUS_F[(sc || {}).y] != null ? FOCUS_F[sc.y] : 0.5, zm);
      x.imageSmoothingQuality = 'high';
      try { x.drawImage(ph.img, R.sx, R.sy, R.sw, R.sh, 0, 0, cw, ch); } catch (e) { /* not drawable */ }
    }
    return cv;
  }
  function paintMosaic(m, first) {
    if (!root) return;
    if (fadeDone) fadeDone();
    // ONE CELL, in place: the new photo fades in over the old one
    if (m.mosaicOne && moState && moState.layer === displayLayer) {
      var cells = moState.layer.querySelectorAll('.mocell');
      var choices = [];
      for (var i = 0; i < cells.length; i++) if (i !== moState.lastCell) choices.push(i);
      var ci = choices[Math.floor(Math.random() * choices.length)], cell = cells[ci];
      var old = cell.querySelector('canvas'), cv = moDraw(cell, m.mosaicOne);
      cv.style.opacity = '0';
      cell.appendChild(cv);
      void cv.offsetWidth;
      cv.style.opacity = '1';
      setTimeout(function () { if (old && old.parentNode) { clearCanvas(old); old.parentNode.removeChild(old); } }, CROSSFADE_MS + 100);
      moState.lastCell = ci; moState.left--;
      shown++; sinceFc++;
      return;
    }
    // a one-cell change whose mosaic is no longer on screen (the music slide
    // took the screen while its photo loaded): that photo on its own
    if (m.mosaicOne) { paint(m.mosaicOne, first); return; }
    var layers = root.querySelectorAll('.ph'), next = layers[1 - layer];
    next.querySelectorAll('.mowrap').forEach(function (w) { w.querySelectorAll('canvas').forEach(clearCanvas); w.remove(); });
    next.classList.remove('zoom');
    next.classList.add('mo');
    var fg = next.querySelector('img.fg'), bgc = next.querySelector('canvas.bg');
    if (fg) fg.removeAttribute('src');
    if (bgc) { bgc.hidden = true; clearCanvas(bgc); }
    if (mus.paneNext !== null) { var pn = mus.paneNext; mus.paneNext = null; setPane(pn); }
    setAttr(next, 'pw', paneUp);
    var W = Math.max(1, (window.innerWidth || 1280) - (paneUp ? paneW || 0 : 0)), H = Math.max(1, window.innerHeight || 800);
    var ports = m.mosaic.filter(function (ph) { return shapeOfPh(ph) === 'portrait'; }).length;
    var plan = mosaicPlan(m.mosaic.length, W, H, Math.random, moState ? moState.idx : -1, ports);
    var pick = mosaicAssign(plan.cells, m.mosaic.map(function (ph) { return shapeOfPh(ph) === 'portrait'; }), W, H);
    var g = moGap(), wrap = document.createElement('div');
    wrap.className = 'mowrap' + (cfg.mosaic_gap === 'rounded' ? ' round' : '');
    wrap.style.padding = (g / 2) + 'px';
    wrap.style.background = MOSAIC_COLORS[cfg.mosaic_color] || '#000';
    next.insertBefore(wrap, next.querySelector('.phscrim'));
    plan.cells.forEach(function (c, i) {
      var cell = document.createElement('div');
      cell.className = 'mocell';
      cell.style.left = 'calc(' + (c.x * 100) + '% + ' + (g / 2) + 'px)';
      cell.style.top = 'calc(' + (c.y * 100) + '% + ' + (g / 2) + 'px)';
      cell.style.width = 'calc(' + (c.w * 100) + '% - ' + g + 'px)';
      cell.style.height = 'calc(' + (c.h * 100) + '% - ' + g + 'px)';
      wrap.appendChild(cell);
      var ph = m.mosaic[pick[i]];
      if (ph) cell.appendChild(moDraw(cell, ph));
    });
    if (cfg.zoom) {
      next.style.setProperty('--zd', (cfg.each_photo * 1000 + CROSSFADE_MS) + 'ms');
      void next.offsetWidth;
      next.classList.add('zoom');
    }
    lastPh = null;
    reveal(next, first);
    layer = 1 - layer;
    // a whole new mosaic now and then: after each cell has changed about twice
    moState = { n: m.mosaic.length, idx: plan.idx, layer: next, left: m.mosaic.length * 2, lastCell: -1 };
    if (first && entrance) entrance();
    shown++; sinceFc++; lastPhoto = (m.mosaic[0].item && (m.mosaic[0].item.title || m.mosaic[0].item.id)) || lastPhoto;
  }
  // ONE PHOTO'S LAYOUT on its layer: whole or filled, the focus, the zoom,
  // the copy's dim (paint; and relayout, the preview's in-place change)
  function layOut(el, ph) {
    var fit = fitOf(ph.w, ph.h, cfg.fill, cfg.portrait && cfg.portrait.fill);
    var sc = fit.portrait ? cfg.portrait : cfg.landscape, lay = layoutOf(sc);
    // KEEP IN VIEW: a photo with a focus is cropped around it (filled), and
    // the zoom closes in on it (filled or whole); without one, as before
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var W = (r && r.width) || window.innerWidth || 1280, H = (r && r.height) || window.innerHeight || 800;
    var zm = ((sc || {}).zoom || 100) / 100, kv = faceWindow(ph.item, ph.w, ph.h, W, H, zm), org = '';
    if (kv) {
      var ax = FOCUS_F[(sc || {}).x] != null ? FOCUS_F[sc.x] : 0.5, ay = FOCUS_F[(sc || {}).y] != null ? FOCUS_F[sc.y] : 0.5;
      if (fit.fit === 'cover') {
        var k1 = Math.max(W / ph.w, H / ph.h);
        ax = alignOf(kv.cx, Math.min(1, W / k1 / ph.w)); ay = alignOf(kv.cy, Math.min(1, H / k1 / ph.h));
        lay.pos = (ax * 100).toFixed(2) + '% ' + (ay * 100).toFixed(2) + '%';
      }
      var o = faceOrigin(kv.cx, kv.cy, ph.w, ph.h, W, H, fit.fit, ax, ay);
      org = (o.ox * 100).toFixed(2) + '% ' + (o.oy * 100).toFixed(2) + '%';
    }
    el.style.setProperty('--fit', fit.fit);
    el.style.setProperty('--pos', lay.pos);
    el.style.setProperty('--org', org);
    el.style.setProperty('--zm', lay.zoom);
    el.style.setProperty('--bgdim', lay.dim);
    return { fit: fit, lay: lay };
  }
  // THE PREVIEW, ONLY ITS PHOTO'S SETTINGS CHANGED (Portrait or Landscape
  // Photos): the photo on screen laid out again where it is -- no fade out
  // and in, so a crop or a blur can be judged as it changes
  function relayout() {
    var top = root && root.querySelectorAll('.ph')[layer];
    if (!top || !lastPh || mode !== 'photos') return false;
    var L = layOut(top, lastPh), bg = top.querySelector('canvas.bg');
    if (L.fit.backdrop || paneUp || ckPhotos()) { drawBackdrop(bg, lastPh.img, L.lay.small); bg.hidden = false; } else { bg.hidden = true; clearCanvas(bg); }
    return true;
  }
  // the options but the photos' own layout (shapeCfg's, and `fill`)
  function sansShapes(c) {
    var o = {};
    Object.keys(c || {}).forEach(function (k) { if (k !== 'portrait' && k !== 'landscape' && k !== 'fill') o[k] = c[k]; });
    return JSON.stringify(o);
  }
  function restartPreview() {
    if (!previewOn || !on) return;
    on = false;
    if (slideT) { clearTimeout(slideT); slideT = null; }
    teardown();
    start('preview');
  }

  // ------------------------------------------------------------ the forecast
  // The forecast's layer: built the first time it is needed, then kept for
  // as long as the screensaver shows (Photos & Forecast brings it back every
  // few photos); its sky holds still whenever it is not on screen.
  function buildForecast() {
    if (!root) return;
    // (Behind the Clock: Sky Only -- the forecast's sky without its land and
    // decorations; a kept layer drawn the other way is drawn again)
    var skyOnly = !!(cfg && cfg.show === 'clock' && cfg.clock_bg === 'skyonly');
    var had = root.querySelector('.fc');
    if (had) {
      var k = had.querySelector('#hk-sky');
      if (!k || k.classList.contains('skyonly') === skyOnly) return;
      if (fscene) { try { fscene.destroy(); } catch (e) { /* gone with the element */ } fscene = null; }
      had.remove();
    }
    var fc = document.createElement('div');
    fc.className = 'fc';
    root.insertBefore(fc, root.querySelector('.info'));
    var sky = document.createElement('div');
    sky.className = 'fsky';
    fc.appendChild(sky);
    try { fscene = !isFlat() && window.hkSky && window.hkSky.scene ? window.hkSky.scene(sky, { skyOnly: skyOnly }) : null; } catch (e) { fscene = null; }
    startTick();
  }
  // the details' layer, built the first time they are wanted
  function buildBand() {
    if (!root || root.querySelector('.fcb')) return;
    var fcb = document.createElement('div');
    fcb.className = 'fcb';
    root.insertBefore(fcb, root.querySelector('.info'));
    var scrim = document.createElement('div');
    scrim.className = 'fcscrim';
    fcb.appendChild(scrim);
    var band = document.createElement('div');
    band.className = 'fcband';
    fcb.appendChild(band);
    addBand(band);
    startTick();
  }
  function startTick() {
    if (!fTick) fTick = setInterval(function () { forecastTick(false); }, FC_TICK_MS);
  }
  // Whether the details show now: on the forecast (Forecast, the slide, the
  // no-photos fallback) by `band`; over the photos by `band_photos`.
  function bandWanted() {
    if (!on || !cfg || muShowing || enShowing || wxShowing) return false;
    return fcVisible() ? cfg.band !== false : cfg.band_photos === true;
  }
  function updateBand() {
    if (!host) return;
    var want = bandWanted();
    if (want) buildBand();
    if (want) host.setAttribute('band', ''); else host.removeAttribute('band');
    if (on && cfg && cfg.band_photos === true) host.setAttribute('bandph', ''); else host.removeAttribute('bandph');
  }
  // (the music slide over it hides it)
  function fcVisible() { return (mode === 'forecast' || fcShowing) && !muShowing && !enShowing && !wxShowing; }
  // ------------------------------------------------------------ the clocks
  // SHOW: CLOCK (2026-10-13): a full-screen clock (hk-saverclock.js, loaded
  // only now) over a background of its own -- or over the forecast (its sky
  // and land, the details along the bottom as set), or over the photos
  // turned into their blurred, dimmed copies ([ckphotos]: the cheap copy,
  // never a blur on the full photo). The corner cards stay: weather, what's
  // playing, the timers and Home Status, each as Over the Clock says.
  var ckCtl = null, ckLoad = null, ckRun = 0, ckArgs = null;
  function ckPhotos() { return !!(host && host.hasAttribute('ckphotos')); }
  function clockModule() {
    if (window.hkSaverClock) return Promise.resolve(window.hkSaverClock);
    if (!ckLoad) {
      // (/hk/ revalidates: a changed file is fetched afresh, as the
      // loader's modules are)
      ckLoad = import('/hk/modules/hk-saverclock.js').then(function () { return window.hkSaverClock; })
        .catch(function (e) { ckLoad = null; console.warn('[hk-saver] clock', e && e.message); return null; });
    }
    return ckLoad;
  }
  function enterClock() {
    var bgk = cfg.clock_bg;
    host.setAttribute('ckmode', '');
    if (bgk === 'forecast' || bgk === 'skyonly') { enterForecast(); mountClock('none'); return; }
    if (bgk === 'photos' || bgk === 'landscapes') {
      host.setAttribute('ckphotos', '');
      setAttr(host, 'cksoft', !!cfg.clock_photo_soft);
      host.style.setProperty('--hk-ckdim', String((cfg.clock_photo_dim || 0) / 100));
      updateBand(); showNext(true); mountClock('none', true); return;
    }
    mode = 'clock';
    host.setAttribute('ckgen', '');
    updateBand();
    mountClock(bgk);
  }
  // the clock's layer, under the corner cards; `dimmed`: over the photos'
  // blurred copies, which need no scrim of their own
  function mountClock(bg, dimmed) {
    if (!root) return;
    ckArgs = [bg, dimmed];
    var run = ++ckRun, layer = document.createElement('div');
    layer.className = 'ck';
    // OVER PHOTOS, the clock's text stands out by its own Shadow and Outline
    if (ckPhotos() || cfg.show === 'photos' || cfg.show === 'both') {
      var fx = ckFx(cfg);
      if (fx !== 'none') layer.style.filter = fx;
    }
    root.insertBefore(layer, root.querySelector('.info'));
    clockModule().then(function (C) {
      if (run !== ckRun || !on || !layer.isConnected) return;
      if (!C) { layer.remove(); if (mode === 'clock') { mode = 'photos'; host.removeAttribute('ckgen'); enterForecast(); } return; }
      ckCtl = C.mount(layer, { style: cfg.clock_style, h24: cfg.clock_24, color: cfg.clock_color, bg: bg, motion: cfg.clock_motion,
                               speed: cfg.clock_speed, depth: cfg.clock_depth, weather: weatherEntity(),
                               client: clientNow(), scrim: !dimmed });
      // TODAY carries its own weather and music: the corners' step aside
      if (host) setAttr(host, 'ckown', cfg.clock_style === 'today');
      nightCheck();
      if (!nightT) nightT = setInterval(nightCheck, 30000);
      // Show: Clock on a background of its own: there is something to show
      if (mode === 'clock' && entrance) entrance();
    });
  }
  // THE CLOCK'S TEXT OVER PHOTOS (2026-10-13): Outline, four hard shadows a
  // stroke's width out (any face: text, canvas or SVG), then Shadow, one soft
  // one below -- as a filter on the clock's layer, drawn once per change
  function ckFx(c) {
    var o = (c.clock_text_outline || 0) / 100, s = (c.clock_text_shadow || 0) / 100, out = [];
    if (o > 0) {
      var w = +(0.5 + o * 2.5).toFixed(2), a = (0.55 + o * 0.4).toFixed(2);
      [[w, 0], [-w, 0], [0, w], [0, -w]].forEach(function (d) { out.push('drop-shadow(' + d[0] + 'px ' + d[1] + 'px 0 rgba(0,0,0,' + a + '))'); });
    }
    if (s > 0) out.push('drop-shadow(0 ' + (1 + s * 3).toFixed(1) + 'px ' + (2 + s * 22).toFixed(1) + 'px rgba(0,0,0,' + (0.25 + s * 0.6).toFixed(2) + '))');
    return out.join(' ') || 'none';
  }
  // the options but the clock's face (its style, 24-hour)
  function sansClock(c) {
    var o = {};
    Object.keys(c || {}).forEach(function (k) { if (['clock_style', 'clock_24', 'clock_color', 'clock_speed', 'clock_depth', 'clock_night', 'clock_night_from', 'clock_night_to', 'clock_text_shadow', 'clock_text_outline'].indexOf(k) < 0) o[k] = c[k]; });
    return JSON.stringify(o);
  }
  function remountClock() {
    if (!ckArgs || !root || !root.querySelector('.ck')) return false;
    var a = ckArgs;
    ckRun++;
    if (ckCtl) { try { ckCtl.destroy(); } catch (e) { /* gone */ } ckCtl = null; }
    root.querySelectorAll('.ck').forEach(function (n) { n.remove(); });
    mountClock(a[0], a[1]);
    return true;
  }
  // NIGHT MODE (2026-10-13): StandBy's -- in the dark, the clock and its
  // corners a dim red on black. Always, or At Night (from .. to, across
  // midnight). Nothing behind the clock is drawn meanwhile (the photos, the
  // forecast and its background hidden; ckCtl.night holds the painter).
  var nightT = null;
  function minsOf(hhmm) { var p = String(hhmm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function nightNow(d, c) {
    c = c || cfg;
    if (!c || c.clock_night === 'off') return false;
    if (c.clock_night === 'always') return true;
    d = d || new Date();
    var m = d.getHours() * 60 + d.getMinutes(), a = minsOf(c.clock_night_from), b = minsOf(c.clock_night_to);
    return a <= b ? m >= a && m < b : m >= a || m < b;
  }
  function nightCheck() {
    if (!host) return;
    var dark = !!(ckCtl && on) && nightNow();
    setAttr(host, 'cknight', dark);
    if (dark && exKind) exHide();
    if (ckCtl && ckCtl.night) ckCtl.night(dark);
  }
  // the screen's weather service (Weather), for Today
  function weatherEntity() {
    var HS = window.hkSettings;
    return (HS && HS.get && HS.get('weather.entity', null)) || null;
  }
  function leaveClock() {
    ckArgs = null;
    if (nightT) { clearInterval(nightT); nightT = null; }
    if (host) { host.removeAttribute('cknight'); host.removeAttribute('ckown'); }
    ckRun++;
    if (ckCtl) { try { ckCtl.destroy(); } catch (e) { /* gone */ } ckCtl = null; }
    if (root) root.querySelectorAll('.ck').forEach(function (n) { n.remove(); });
    if (host) { host.removeAttribute('ckmode'); host.removeAttribute('ckgen'); host.removeAttribute('ckphotos'); host.removeAttribute('cksoft'); }
    if (mode === 'clock') mode = 'photos';
  }
  // the whole screensaver: no photos, or Show: Forecast
  function enterForecast() {
    if (mode === 'forecast' || !root) return;
    mode = 'forecast';
    fcShowing = false;
    if (slideT) { clearTimeout(slideT); slideT = null; }
    host.removeAttribute('fcslide');
    host.setAttribute('forecast', '');
    buildForecast();
    updateBand();
    forecastTick(true);
    reveal(root.querySelector('.fc'), true);
    if (entrance) entrance();
    // music already playing: its slide, over the forecast
    if (takeover()) setTimeout(function () { mus.watchAt = 0; musicWatch(); }, 0);
  }
  // one slide among the photos (Photos & Forecast)
  function showForecastSlide() {
    if (!on || !root || mode === 'forecast') return;
    buildForecast();
    fcShowing = true; sinceFc = 0; lastSlide = 'forecast';
    host.setAttribute('fcslide', '');
    updateBand();
    forecastTick(true);
    reveal(root.querySelector('.fc'), false);
  }
  function hideForecastSlide() {
    if (!fcShowing) return;
    fcShowing = false;
    if (host) host.removeAttribute('fcslide');
    updateBand();
    forecastTick(false);
  }
  function leaveForecast() {
    if (fTick) { clearInterval(fTick); fTick = null; }
    if (fscene) { try { fscene.destroy(); } catch (e) { /* gone with the element */ } fscene = null; }
    if (fband) cards = cards.filter(function (c) { return c !== fband; });
    fband = null; fSig = ''; mode = 'photos'; fcShowing = false; sinceFc = 0;
  }
  function resetForecast() {
    if (fadeDone) fadeDone();
    // A host reused from a stop that had not yet torn it down still has its
    // last photo on top: hand it to the first reveal as the outgoing view, so
    // that reveal un-tops and empties it rather than leaving it opaque over
    // the new photo (or under the forecast, decoded, for the whole session).
    var last = root && root.querySelectorAll('.ph')[layer];
    displayLayer = last && last.classList.contains('top') ? last : null;
    leaveForecast();
    if (root) root.querySelectorAll('.fc,.fcb').forEach(function (n) { n.remove(); });
    // the slide goes with the forecast's layers; the pane's music stays with the pane
    dropView(slideView());
    muShowing = false; lastSlide = '';
    if (host) host.removeAttribute('muslide');
    if (host) {
      host.removeAttribute('forecast'); host.removeAttribute('fcslide'); host.removeAttribute('band'); host.removeAttribute('bandph');
      if (host.style.removeProperty) host.style.removeProperty('--hk-ss-corner-bottom');
    }
  }
  // ------------------------------------------------------------ home energy
  // HOME ENERGY (2026-10-14, hk-saver-energy.js, loaded only now): today so
  // far against a usual day, the Energy page's own numbers. ONE LAYER OVER
  // WHAT IS THERE (.en, above the clock, under the corner cards), faded in
  // over it -- the photo, the forecast, the clock all stay opaque beneath,
  // so no hand-off ever passes through black. Behind its text: the photo's
  // blurred copy, the sky held still and darkened, or (over a clock's own
  // background) a gradient of its own. The rings draw once it has arrived.
  var enCtl = null, enLoad = null, enShowing = false, enT = null, enRun = 0;
  function energyModule() {
    if (window.hkSaverEnergy) return Promise.resolve(window.hkSaverEnergy);
    if (!enLoad) {
      enLoad = import('/hk/modules/hk-saver-energy.js').then(function () { return window.hkSaverEnergy; })
        .catch(function (e) { enLoad = null; console.warn('[hk-saver] energy', e && e.message); return null; });
    }
    return enLoad;
  }
  // at the start: the module, the Energy page's code, and the numbers asked
  // for -- so its first turn has them. `hold` (HK Settings' preview of Home
  // Energy): shown as soon as they are here, and kept up
  function energyPrep() {
    var run = ++enRun, hold = previewOn && previewEnergy;
    if (!cfg || !cfg.energy_slide) return;
    energyModule().then(function (X) { return X ? X.ready().then(function () { return X; }) : null; }).then(function (X) {
      if (!X || run !== enRun || !on || !root || !cfg || !cfg.energy_slide) return;
      // in its place at the start, as the weather's: put in at its first
      // turn, its layer was made as it came in (2026-10-19)
      if (!enCtl) {
        enCtl = X.create({ hide: cfg.energy_hide, h24: cfg.clock_24 });
        root.insertBefore(enCtl.el, root.querySelector('.info'));
      } else enCtl.setHide(cfg.energy_hide);
      enCtl.ready(clientNow());
      if (!hold) return;
      var tries = 0, show = function () {
        if (run !== enRun || !on || enShowing) return;
        // (at once: the preview is shown again after every change)
        if (showEnergySlide(true)) { exKind = 'energy'; return; }
        if (++tries < 60) setTimeout(show, 500);
      };
      show();
    });
  }
  function energyReady() { return !!(enCtl && enCtl.ready(clientNow())); }
  // the photo on screen, for its blurred copy (a mosaic: its first cell)
  function curImg() {
    var L = displayLayer;
    if (!L || !L.classList.contains('ph')) return null;
    var im = L.querySelector('img.fg');
    if (!L.classList.contains('mo') && im && im.getAttribute('src') && im.naturalWidth) return im;
    var c = L.querySelector('.mocell canvas');
    return c && c.width ? c : null;
  }
  function energyLook() {
    if (mode === 'photos' && curImg()) return 'photo';
    if (mode === 'forecast' || fcShowing) return 'sky';
    return 'plain';
  }
  // ITS ROOM: beside the pane (it tells the time itself, top left)
  function energyLayout() {
    if (!enCtl || !root || !host) return;
    enCtl.layout((window.innerWidth || 0) - (paneUp ? paneW : 0), window.innerHeight || 0);
  }
  // HOME ENERGY'S OR THE WEATHER'S LAYER, just under the corner cards: only
  // the other of the two between them (they never show at once). Moved only
  // when something else is -- a node moved is drawn again, its layers and
  // the whole sky in it made again (2026-10-19: the weather's moved under
  // Home Energy's at every other turn, and Home Energy's under the weather's)
  function underCards(el, info) {
    if (!info || el.parentNode !== root) return false;
    for (var n = el.nextSibling; n; n = n.nextSibling) {
      if (n === info) return true;
      if (!n.classList || !(n.classList.contains('en') || n.classList.contains('wx'))) return false;
    }
    return false;
  }
  function showEnergySlide(first) {
    if (!on || !root || !host || enShowing || !enCtl) return false;
    var h = clientNow(), info = root.querySelector('.info');
    if (!enCtl.ready(h)) return false;
    // above whatever came after it (a clock mounted again), under the corner cards
    if (!underCards(enCtl.el, info)) root.insertBefore(enCtl.el, info);
    var look = energyLook(), img = look === 'photo' ? curImg() : null;
    if (!enCtl.draw(h, look, img ? function (c) { drawBackdrop(c, img, BACKDROP_SMALL); } : null)) return false;
    enShowing = true; sinceFc = 0; lastSlide = 'energy';
    host.setAttribute('enslide', '');
    updateBand();
    forecastTick(false);                 // the forecast's sky holds still under it
    energyLayout();
    var el = enCtl.el, run = photoRun;
    el.style.setProperty('--hk-en-fade', (first ? 0 : CROSSFADE_MS) + 'ms');
    void el.offsetWidth;
    el.classList.add('on');
    if (enT) clearTimeout(enT);
    enT = setTimeout(function () { enT = null; if (on && run === photoRun && enShowing && enCtl) enCtl.arrived(); }, first ? 50 : CROSSFADE_MS);
    if (first && entrance) entrance();
    return true;
  }
  function hideEnergySlide() {
    if (!enShowing) return;
    enShowing = false;
    if (enT) { clearTimeout(enT); enT = null; }
    if (host) host.removeAttribute('enslide');
    if (enCtl) {
      enCtl.leave();
      enCtl.el.style.setProperty('--hk-en-fade', CROSSFADE_MS + 'ms');
      enCtl.el.classList.remove('on');
    }
    updateBand();
    if (fcVisible()) forecastTick(true);
  }
  function leaveEnergy() {
    enRun++;
    if (enT) { clearTimeout(enT); enT = null; }
    enShowing = false;
    if (enCtl) { try { enCtl.destroy(); } catch (e) { /* gone */ } enCtl = null; }
    if (host) host.removeAttribute('enslide');
  }
  // this dashboard's Energy page, when it has one: a tap on Home Energy opens it
  function energyPage() {
    var conf = dashConf();
    var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'energy'; });
    return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/energy' : null;
  }

  // ------------------------------------------------------------ the weather
  // WEATHER (2026-10-14, hk-saver-weather.js, loaded only now): today's
  // weather at a glance over the Live Sky (Sky Only), laid out as Home
  // Energy is. The same kind of layer (.wx, above the clock, under the
  // corner cards), opaque -- its own sky -- faded in over what is there.
  var wxCtl = null, wxLoad = null, wxShowing = false, wxT = null, wxRun = 0;
  function weatherModule() {
    if (window.hkSaverWeather) return Promise.resolve(window.hkSaverWeather);
    if (!wxLoad) {
      wxLoad = import('/hk/modules/hk-saver-weather.js').then(function () { return window.hkSaverWeather; })
        .catch(function (e) { wxLoad = null; console.warn('[hk-saver] weather', e && e.message); return null; });
    }
    return wxLoad;
  }
  // at the start: the module, its forecast asked for and its sky readied;
  // HK Settings' preview of Weather holds it up
  function weatherPrep() {
    var run = ++wxRun, hold = previewOn && previewWeather;
    if (!cfg || !cfg.weather_slide) return;
    weatherModule().then(function (X) {
      if (!X || run !== wxRun || !on || !root || !cfg || !cfg.weather_slide) return;
      if (!wxCtl) {
        wxCtl = X.create({ hide: cfg.weather_hide, h24: cfg.clock_24 });
        root.insertBefore(wxCtl.el, root.querySelector('.info'));
      } else wxCtl.setHide(cfg.weather_hide);
      // (its room known before it is first drawn, unseen: ready)
      weatherLayout();
      wxCtl.ready(clientNow());
      if (!hold) return;
      var tries = 0, show = function () {
        if (run !== wxRun || !on || wxShowing) return;
        if (showWeatherSlide(true)) { exKind = 'weather'; return; }
        if (++tries < 60) setTimeout(show, 500);
      };
      show();
    });
  }
  function weatherReady() { return !!(wxCtl && wxCtl.ready(clientNow())); }
  function weatherLayout() {
    if (!wxCtl || !root || !host) return;
    wxCtl.layout((window.innerWidth || 0) - (paneUp ? paneW : 0), window.innerHeight || 0);
  }
  function showWeatherSlide(first) {
    if (!on || !root || !host || wxShowing || !wxCtl) return false;
    var h = clientNow(), info = root.querySelector('.info');
    if (!wxCtl.ready(h)) return false;
    if (!underCards(wxCtl.el, info)) root.insertBefore(wxCtl.el, info);
    weatherLayout();
    if (!wxCtl.draw(h)) { wxCtl.leave(); return false; }
    wxShowing = true; sinceFc = 0; lastSlide = 'weather';
    host.setAttribute('wxslide', '');
    updateBand();
    forecastTick(false);                 // the forecast's own sky holds still under it
    weatherLayout();
    var el = wxCtl.el, run = photoRun;
    el.style.setProperty('--hk-wx-fade', (first ? 0 : CROSSFADE_MS) + 'ms');
    void el.offsetWidth;
    el.classList.add('on');
    if (wxT) clearTimeout(wxT);
    wxT = setTimeout(function () { wxT = null; if (on && run === photoRun && wxShowing && wxCtl) wxCtl.arrived(); }, first ? 50 : CROSSFADE_MS);
    if (first && entrance) entrance();
    return true;
  }
  function hideWeatherSlide() {
    if (!wxShowing) return;
    wxShowing = false;
    if (wxT) { clearTimeout(wxT); wxT = null; }
    if (host) host.removeAttribute('wxslide');
    if (wxCtl) {
      wxCtl.el.style.setProperty('--hk-wx-fade', CROSSFADE_MS + 'ms');
      wxCtl.el.classList.remove('on');
      // its sky held still once it has faded
      var c = wxCtl;
      setTimeout(function () { if (c === wxCtl && !wxShowing) c.leave(); }, CROSSFADE_MS + 100);
    }
    updateBand();
    if (fcVisible()) forecastTick(true);
  }
  function leaveWeather() {
    wxRun++;
    if (wxT) { clearTimeout(wxT); wxT = null; }
    wxShowing = false;
    if (wxCtl) { try { wxCtl.destroy(); } catch (e) { /* gone */ } wxCtl = null; }
    if (host) host.removeAttribute('wxslide');
  }

  // ------------------------------------------------------------ additional screens
  // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, one
  // every extra_every minutes for extra_for seconds -- the forecast (Show:
  // Clock), the music (only while it plays) and Home Energy, taking turns.
  // None while the music holds the screen, in the clock's Night Mode, under
  // the black, or on a hidden page; the timer just goes round again.
  var exT = null, exKind = '', exLast = '', exOutT = null;
  var EX_PREVIEW_MS = 8000;              // HK Settings' preview: the first one soon
  function exArm() {
    if (exT) { clearTimeout(exT); exT = null; }
    if (!on || !cfg || !extrasOf(cfg).length || (previewOn && (previewEnergy || previewWeather))) return;
    var run = photoRun, wait = cfg.extra_every * 60000;
    if (previewOn) wait = Math.min(wait, EX_PREVIEW_MS);
    exT = setTimeout(function () { exT = null; if (on && run === photoRun) exNext(); }, wait);
  }
  function exNext() {
    var run = photoRun;
    var held = document.hidden || pnl || black() || exKind || (host && host.hasAttribute('cknight')) || (muShowing && takeover());
    var kind = held ? null : turnOf(EXTRA_ORDER, extrasOf(cfg).filter(function (k) {
      return k === 'music' ? musicPlaying() : k === 'energy' ? energyReady() : k === 'weather' ? weatherReady() : true;
    }), exLast);
    if (kind && exShow(kind)) {
      exT = setTimeout(function () { exT = null; if (on && run === photoRun) { exHide(); exArm(); } }, cfg.extra_for * 1000);
      return;
    }
    exArm();
  }
  function exShow(kind) {
    var ok = kind === 'energy' ? showEnergySlide() : kind === 'weather' ? showWeatherSlide() : kind === 'music' ? showMusicSlide() : kind === 'forecast' ? showForecastExtra() : false;
    if (ok) { exKind = kind; exLast = kind; }
    return ok;
  }
  function exHide() {
    var kind = exKind;
    exKind = '';
    if (kind === 'energy') hideEnergySlide();
    else if (kind === 'weather') hideWeatherSlide();
    else if (kind === 'music') { if (muShowing && !takeover()) hideMusicSlide(); else return; }
    else if (kind === 'forecast') hideForecastExtra();
    else return;
    // the photos behind the clock: their layer was emptied as the screen
    // came over it, so the next photo comes in
    if (kind !== 'energy' && kind !== 'weather' && mode === 'photos') showNext(false);
  }
  // THE FORECAST AS AN ADDITIONAL SCREEN (Show: Clock): under a clock's own
  // background it is put there at once and the clock fades off it; over
  // the photos it fades in as the forecast slide does
  function showForecastExtra() {
    if (!on || !root || !host || mode === 'forecast') return false;
    var gen = mode === 'clock';
    buildForecast();
    if (exOutT) { clearTimeout(exOutT); exOutT = null; }
    host.removeAttribute('fcout');
    fcShowing = true;
    host.setAttribute('fcslide', '');
    updateBand();
    forecastTick(true);
    reveal(root.querySelector('.fc'), gen);
    return true;
  }
  function hideForecastExtra() {
    if (!fcShowing) return;
    var gen = mode === 'clock';
    // (under a clock's own background the forecast stays drawn until the
    // clock has faded back over it)
    if (gen && host) {
      host.setAttribute('fcout', '');
      if (exOutT) clearTimeout(exOutT);
      exOutT = setTimeout(function () { exOutT = null; if (host && !fcShowing) host.removeAttribute('fcout'); }, CROSSFADE_MS + 100);
    }
    hideForecastSlide();
  }
  function leaveExtras() {
    if (exT) { clearTimeout(exT); exT = null; }
    if (exOutT) { clearTimeout(exOutT); exOutT = null; }
    exKind = ''; exLast = '';
    if (host) host.removeAttribute('fcout');
  }

  // ------------------------------------------------------------ the music
  // WHAT PLAYS, BIG (options music_slide, music_pane): the album art over a
  // blurred copy of itself, the song, the room and its volume, how far in,
  // what comes next, and previous / play-pause / next that act WITHOUT
  // closing the screensaver. A slide among the photos, taking turns with the
  // forecast; over the forecast while music plays; and in the pane down the
  // right, under the calendar when both are on. One state, drawn into each
  // view that is up: what this screen follows (hkMusic -- its focus, else
  // what started playing, its own room first), held while it is on screen.
  var MU_GRACE = 30000;        // (the default of) how long the music stays once paused or stopped
  // HIDE AFTER A PAUSE (All Screens -> Now Playing, 2026-10-15): the music
  // paused or stopped stays this long -- the pane's and the slide's alike,
  // as the dashboard's bar and pane -- and a whole one again after its
  // last use (a touch on it, its panel open: somebody picking a song)
  function muGrace() {
    var Mn = window.hkCards && window.hkCards.menu;
    return (Mn && Mn.npGrace ? Mn.npGrace() : MU_GRACE / 1000) * 1000;
  }
  // somebody using the screensaver's music (a touch on it, its panel open)
  function musicUsed() { mus.lastActive = clock.now(); mus.lostAt = 0; }
  var MU_BG = 32;              // the blurred copy, drawn this small (the CSS scales it up)
  var MU_SLOP = 14;            // a finger's slop around a button
  var mus = { key: null, views: [], tick: null, next: null, nextFor: '', year: '', lostAt: 0, watchAt: 0, watchT: null, drag: null, vol: null,
              paneIn: false, paneNext: null, lastActive: 0 };
  var muShowing = false, lastSlide = '';
  var ICON = { prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z', next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6z',
               play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
               pause: 'M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
               note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
               lib: 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-2 5h-3v5.5a2.5 2.5 0 1 1-1-2V5h4v2z',
               vlo: 'M7 9v6h4l5 5V4l-5 5H7z',
               vhi: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z' };
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

  // the music this screen follows: the one on screen while it is still
  // playing or paused, else hkMusic's answer while it plays, else the first
  // thing playing anywhere
  function musicNow(h) {
    var M = window.hkMusic;
    if (!M || !M.contexts || !h || !h.states) return null;
    var cs = M.contexts(h), i;
    if (mus.key) for (i = 0; i < cs.length; i++) if (cs[i].key === mus.key || cs[i].members.indexOf(mus.key) >= 0) return cs[i];
    var r = M.resolve ? M.resolve(h) : null;
    if (r && r.context && r.context.playing) return r.context;
    for (i = 0; i < cs.length; i++) if (cs[i].playing) return cs[i];
    // ...else this screen's own music, PAUSED (its focus): a page loaded
    // while it is paused shows it, as it was shown before the reload -- the
    // dashboard's pane drew "Not Playing" and gave way to the bar (2026-10-15)
    if (r && r.context && r.reason === 'focus') return r.context;
    return null;
  }
  function musicPlaying() { var c = musicNow(clientNow()); return !!(c && c.playing); }
  // what a view draws: the song, or (nothing playing) the room a play would start
  function musicOf(ctx, h) {
    var M = window.hkMusic;
    if (!ctx) {
      var r = M && M.resolve && h ? M.resolve(h) : null;
      return r && r.player ? { idle: true, key: r.player, room: r.name || '' } : null;
    }
    var st = h.states[ctx.key] || {}, a = st.attributes || {};
    // entity_picture_local first: Music Assistant's entity_picture is an
    // absolute address on its own port (hk-media.js, the now-playing card)
    var pic = a.entity_picture_local || a.entity_picture || '';
    if (pic && pic.charAt(0) === '/') pic = location.origin + pic;
    return { idle: false, key: ctx.key, room: M.label ? M.label(ctx) : ctx.key, playing: st.state === 'playing',
             title: ctx.title || a.media_title || '', artist: ctx.artist || a.media_artist || '', album: a.media_album_name || '',
             pic: pic, dur: Number(a.media_duration) || 0, pos: Number(a.media_position) || 0,
             posAt: Date.parse(a.media_position_updated_at) || 0,
             vol: typeof a.volume_level === 'number' ? a.volume_level : null };
  }
  function elapsed(d) {
    var t = d.pos + (d.playing && d.posAt ? (Date.now() - d.posAt) / 1000 : 0);
    return d.dur ? Math.min(d.dur, Math.max(0, t)) : Math.max(0, t);
  }

  // ONE VIEW: the slide (.mu) or the pane's (.pm). Two of each picture,
  // the song's and the one before, faded between -- each on a layer of its
  // own for good (will-change on the frame, not the picture: a picture let
  // go took its layer with it, and what was round it was drawn again)
  function musicView(kind) {
    var el = document.createElement('div');
    el.className = kind === 'slide' ? 'mu' : 'pm';
    el.setAttribute('idle', '');
    el.innerHTML =
      (isFlat() ? '<div class="mbgf"></div><div class="mbgf"></div>' : '<div class="mbgf"><canvas class="mbg"></canvas></div><div class="mbgf"><canvas class="mbg"></canvas></div>') + '<div class="mshade"></div>' +
      '<div class="mbody"><div class="mart"><div class="msq"><div class="mph">' + svg(ICON.note) + '</div>' +
      '<div class="mfr"><img alt=""></div><div class="mfr"><img alt=""></div></div></div>' +
      '<div class="mcol"><div class="mroom"></div><div class="mtitle"></div><div class="martist"></div><div class="malbum"></div>' +
      '<div class="mprog"><div class="mbar"><i></i></div><div class="mtimes"><span></span><span></span></div></div>' +
      '<div class="mctl"><div class="mbtn mx" data-act="spk" aria-label="Speakers"><hk-icon icon="hk:homepod"></hk-icon></div>' +
      '<div class="mbtn" data-act="prev">' + svg(ICON.prev) + '</div><div class="mbtn mpp" data-act="pp">' +
      svg(ICON.play) + '</div><div class="mbtn" data-act="next">' + svg(ICON.next) + '</div>' +
      '<div class="mbtn mx" data-act="brw" aria-label="Browse Music">' + svg(ICON.lib) + '</div>' +
      '<div class="mvol">' + svg(ICON.vlo) + '<div class="mvt"><i></i><b></b></div>' + svg(ICON.vhi) + '</div></div>' +
      '<div class="mnext"><div class="mnth">' + svg(ICON.note) + '<img alt=""></div><div class="mnx"><div class="mnl">Up Next</div><div class="mnt"></div></div></div></div></div>';
    if (!window.hkSaverPanel) el.setAttribute('nomx', '');
    var q = function (s) { return el.querySelector(s); };
    var v = { kind: kind, el: el, flat: isFlat(), flip: 0, pic: null, d: null, ready: Promise.resolve(),
              bgf: el.querySelectorAll('.mbgf'), bg: el.querySelectorAll('canvas.mbg'), fr: el.querySelectorAll('.mfr'),
              room: q('.mroom'), title: q('.mtitle'), artist: q('.martist'), album: q('.malbum'),
              bar: q('.mbar i'), t0: q('.mtimes span:first-child'), t1: q('.mtimes span:last-child'),
              pp: q('.mpp path'), nextImg: q('.mnext img'), nextT: q('.mnt'), vt: q('.mvt') };
    v.bg.forEach(function (c) { c.width = MU_BG; c.height = MU_BG; });
    v.nextImg.onerror = function () {
      v.nextImg.style.visibility = 'hidden';
      // a signed path that errors gets one fresh signature (an HA restart
      // kills them all), as hkCards' own artwork does
      var want = v.nextWant, C = window.hkCards;
      if (want && !v.nextRetried && C && C.artUrl && v.nextImg.getAttribute('src') !== want) {
        v.nextRetried = true;
        C.artUrl(want, NEXT_ART, function (p) { if (v.nextWant === want) v.nextImg.src = p; }, true);
      }
    };
    v.nextImg.onload = function () { v.nextImg.style.visibility = ''; };
    mus.views.push(v);
    return v;
  }
  function dropView(v) {
    if (!v) return;
    if (pnl && pnl.view === v) closePanel(false);
    mus.views = mus.views.filter(function (x) { return x !== v; });
    if (v.el.parentNode) v.el.remove();
    musicTick();
  }
  function slideView() { return mus.views.filter(function (v) { return v.kind === 'slide'; })[0] || null; }
  function musicPaneView() { return mus.views.filter(function (v) { return v.kind === 'pane'; })[0] || null; }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setAttr(el, k, on) { if (on) { if (!el.hasAttribute(k)) el.setAttribute(k, ''); } else if (el.hasAttribute(k)) el.removeAttribute(k); }

  // album art, loaded and decoded once for every view (the last few kept)
  var artCache = {}, artOrder = [];
  function loadArt(url) {
    if (!url) return Promise.resolve(null);
    if (artCache[url]) return artCache[url];
    artOrder.push(url);
    if (artOrder.length > 4) delete artCache[artOrder.shift()];
    artCache[url] = new Promise(function (ok) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { (im.decode ? im.decode().catch(function () { /* drawn anyway */ }) : Promise.resolve()).then(function () { ok(im); }); };
      im.onerror = function () { ok(null); };
      im.src = url;
    });
    return artCache[url];
  }
  // THE BLURRED COPY: the art drawn tiny, then into MU_BG square (a soft
  // blur where the canvas has a filter; the two steps soften it where it
  // has none, as WebKit), darkened for the text; CSS covers the view with it.
  // THE SLIDE'S IS BRIGHTER AND RICHER (2026-10-11, the user: "let more
  // color show"): its colors pushed apart from their gray (on the pixels --
  // 1024 of them -- as WebKit's canvas has no filter) and darkened less. The
  // pane's stays as it was: its list needs the darker ground.
  var BLUR_LOOK = { slide: { sat: 1.35, dark: 0.24 }, pane: { sat: 1, dark: 0.38 } };
  function drawBlur(c, img, kind) {
    if (isFlat()) { clearCanvas(c); return; }
    var look = BLUR_LOOK[kind] || BLUR_LOOK.pane;
    var ctx = c && c.getContext && c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    // no artwork: no picture (an old song's blur left here showed through)
    if (!img) { ctx.clearRect(0, 0, MU_BG, MU_BG); return; }
    var t = document.createElement('canvas'); t.width = 10; t.height = 10;
    var tc = t.getContext('2d');
    if (!tc) return;
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(img, 0, 0, 10, 10);
    ctx.clearRect(0, 0, MU_BG, MU_BG);
    ctx.imageSmoothingQuality = 'high';
    try { ctx.filter = 'blur(2px)'; } catch (e) { /* the upscale alone */ }
    ctx.drawImage(t, -3, -3, MU_BG + 6, MU_BG + 6);
    try { ctx.filter = 'none'; } catch (e) { /* ignore */ }
    if (look.sat !== 1 && ctx.getImageData) {
      try {
        var px = ctx.getImageData(0, 0, MU_BG, MU_BG), d = px.data, s = look.sat;
        for (var i = 0; i < d.length; i += 4) {
          var l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = l + (d[i] - l) * s; d[i + 1] = l + (d[i + 1] - l) * s; d[i + 2] = l + (d[i + 2] - l) * s;
        }
        ctx.putImageData(px, 0, 0);
      } catch (e) { /* a picture from elsewhere: as it is */ }
    }
    ctx.fillStyle = 'rgba(0,0,0,' + look.dark + ')';
    ctx.fillRect(0, 0, MU_BG, MU_BG);
  }
  // a new song's art faded in over the last one's, once decoded
  function showArt(v, url) {
    v.ready = loadArt(url).then(function (im) {
      if (v.pic !== url) return;
      var n = 1 - v.flip, fr = v.fr[n], img = fr.querySelector('img');
      var done = function () {
        if (v.pic !== url) return;
        if (!isFlat()) drawBlur(v.bg[n], im, v.kind);
        setAttr(v.el, 'noart', !im);
        // THE DASHBOARD PANE'S FIRST ART is there as it comes in, not faded
        // in over the placeholder: the pane slides in once it is ready
        // (hk-popup.js), and a fade on top of the slide read as a fade-in
        var first = v.kind === 'dash' && !v.fr[v.flip].classList.contains('on');
        if (first) { fr.style.transition = 'none'; v.bgf[n].style.transition = 'none'; }
        fr.classList.add('on'); v.bgf[n].classList.add('on');
        if (first) { void fr.offsetWidth; setTimeout(function () { fr.style.transition = ''; v.bgf[n].style.transition = ''; }, 60); }
        v.fr[v.flip].classList.remove('on'); v.bgf[v.flip].classList.remove('on');
        v.flip = n;
      };
      // no artwork: this frame's picture let go (it still held one from a
      // song before, and showed it over the placeholder)
      if (!im) { img.removeAttribute('src'); done(); return; }
      img.src = url;
      return (img.decode ? img.decode().catch(function () { /* drawn anyway */ }) : Promise.resolve()).then(done);
    });
  }
  function drawMusic(v, d) {
    var idle = !d || d.idle;
    v.d = d;
    setAttr(v.el, 'idle', idle);
    setAttr(v.el, 'none', !d);
    setText(v.room, !d ? '' : d.room);
    setAttr(v.el, 'novol', idle || d.vol === null);
    if (!idle && d.vol !== null) {
      var vv = Math.max(0, Math.min(1, d.vol)).toFixed(3);
      if (v.vt.style.getPropertyValue('--v') !== vv) v.vt.style.setProperty('--v', vv);
    }
    setText(v.title, idle ? 'Not Playing' : d.title);
    setText(v.artist, idle ? '' : d.artist);
    setText(v.album, idle ? '' : [d.album, mus.year].filter(Boolean).join(' · '));
    var want = idle ? ICON.play : d.playing ? ICON.pause : ICON.play;
    if (v.pp.getAttribute('d') !== want) v.pp.setAttribute('d', want);
    var pic = idle ? '' : d.pic;
    if (pic !== v.pic) { v.pic = pic; showArt(v, pic); }
    var nx = !idle && mus.next && mus.nextFor === sigOf(d) ? mus.next : null;
    // (asking: the last song's row keeps its place, unseen, until the answer)
    var wait = !nx && !idle && !!mus.nextBusy && !!v.hadNext;
    if (nx) v.hadNext = true; else if (!wait) v.hadNext = false;
    setAttr(v.el, 'nextwait', wait);
    setAttr(v.el, 'nonext', !nx && !wait);
    if (nx) {
      setText(v.nextT, nx.title + (nx.artist ? ' — ' + nx.artist : ''));
      // THROUGH THE ART PROXY (hkCards.artUrl): Music Assistant names a CDN
      // the wall tablets cannot reach -- loaded directly, the cover never
      // came and the request held a socket till the WebView gave up
      if (v.nextWant !== (nx.image || '')) {
        var want = v.nextWant = nx.image || '', C = window.hkCards;
        v.nextRetried = false;
        v.nextImg.style.visibility = 'hidden';
        if (!want) v.nextImg.removeAttribute('src');
        else if (C && C.artUrl) C.artUrl(want, NEXT_ART, function (p) { if (v.nextWant === want) v.nextImg.src = p; });
        else v.nextImg.src = want;
      }
    }
    progress(v);
  }
  var DUR_GRACE = 4000;
  var NEXT_ART = 160;          // Up Next's cover, the pixels HA scales it to (art.py)
  function progress(v) {
    var d = v.d, has = !!(d && !d.idle && d.dur);
    // A SONG'S DURATION CAN BE A MOMENT BEHIND IT: the bar keeps its place,
    // empty, for DUR_GRACE (a stream with none lets it go after that)
    if (!has && v.hadDur && d && !d.idle) {
      if (!v.durLost) v.durLost = clock.now();
      if (clock.now() - v.durLost < DUR_GRACE) {
        if (v.bar.style.transform !== 'scaleX(0)') v.bar.style.transform = 'scaleX(0)';
        setText(v.t0, ''); setText(v.t1, '');
        if (!v.durT) v.durT = setTimeout(function () { v.durT = null; progress(v); }, DUR_GRACE + 50);
        return;
      }
    }
    v.durLost = 0; v.hadDur = has;
    setAttr(v.el, 'nodur', !has);
    if (!has) return;
    var t = elapsed(d);
    var tf = 'scaleX(' + (t / d.dur).toFixed(4) + ')';
    if (v.bar.style.transform !== tf) v.bar.style.transform = tf;
    setText(v.t0, mmss(t));
    setText(v.t1, mmss(d.dur));
  }
  function sigOf(d) { return d && !d.idle ? d.key + '|' + d.title + '|' + d.artist : ''; }
  // ONCE A SECOND, only while a view on screen shows music playing
  function musicTick() {
    var any = !document.hidden && mus.views.some(function (v) {
      if (v.kind === 'dash') return v.live && v.el.isConnected && v.d && !v.d.idle && v.d.playing;
      return on && v.el.isConnected && (v.kind === 'pane' ? mus.paneIn : muShowing) && v.d && !v.d.idle && v.d.playing;
    });
    if (any && !mus.tick) mus.tick = setInterval(function () { mus.views.forEach(progress); musicTick(); }, 1000);
    else if (!any && mus.tick) { clearInterval(mus.tick); mus.tick = null; }
  }
  // Everything again from the house: what plays, into each view
  function renderMusic() {
    var h = clientNow();
    if ((!on && !dashLive()) || !h) return null;
    var ctx = musicNow(h), now = clock.now();
    var d = musicOf(ctx, h);
    // A PAUSE THAT READS AS "IDLE" (2026-10-15): Music Assistant's AirPlay
    // speakers -- the house's HomePods -- report a pause as idle, so the
    // music on screen seemed to end on a pause, and the player went to
    // "Not Playing" with a lone play button. The song shown is kept, paused,
    // for Hide After a Pause from when it was last there (its play button
    // resumes it); after that it goes, as stopped music does.
    if (d && !d.idle) mus.held = { d: d, at: now, frozen: null };
    else if (mus.held && now - mus.held.at < muGrace()) {
      var hd = mus.held;
      if (!hd.frozen) hd.frozen = Object.assign({}, hd.d, { playing: false, pos: elapsed(hd.d), posAt: 0 });
      d = hd.frozen;
    } else mus.held = null;
    mus.key = ctx ? ctx.key : (d && !d.idle ? d.key : null);
    var sig = sigOf(d);
    // the volume a finger is setting, not the house's last word on it
    if (d && !d.idle && mus.vol && mus.vol.key === d.key && (mus.drag || clock.now() < mus.vol.until)) d.vol = mus.vol.val;
    if (sig && sig !== mus.nextFor && mus.views.length) upNext(d, sig);
    mus.views.forEach(function (v) { drawMusic(v, d); });
    musicTick();
    // (its panel stays while the paused song is held: somebody picking music)
    if (pnl) { if (!ctx && !(d && !d.idle)) closePanel(true); else pnl.p.update(); }
    return ctx;
  }
  // UP NEXT (and the album's year): Music Assistant's queue, asked once a
  // song. Not Music Assistant: neither.
  function upNext(d, sig) {
    mus.nextFor = sig; mus.next = null; mus.year = ''; mus.nextBusy = true;
    var str = function (x) { return typeof x === 'string' ? x : ''; };
    sendWS({ type: 'call_service', domain: 'music_assistant', service: 'get_queue',
             service_data: { entity_id: d.key }, return_response: true }).then(function (r) {
      if (mus.nextFor !== sig) return;
      mus.nextBusy = false;
      var q = r && r.response && r.response[d.key];
      var n = q && q.next_item, mi = n && n.media_item, cm = q && q.current_item && q.current_item.media_item;
      mus.next = n ? { title: str(mi && mi.name) || str(n.name),
                       artist: mi && mi.artists && mi.artists[0] ? str(mi.artists[0].name) : '',
                       image: str(mi && mi.image) || str(mi && mi.album && mi.album.image) } : null;
      var y = cm && (cm.year || (cm.album && cm.album.year));
      mus.year = y ? String(y) : '';
      mus.views.forEach(function (v) { drawMusic(v, v.d); });
      if (muShowing) layoutMusic();
      paneStack();
      if (mus.next && !mus.next.image && mi) nextArt(d, sig, mi);
    }).catch(function () {
      // not Music Assistant: no Up Next (its place let go)
      if (mus.nextFor !== sig) return;
      mus.nextBusy = false;
      mus.views.forEach(function (v) { drawMusic(v, v.d); });
    });
  }
  // THE NEXT SONG'S COVER: Music Assistant looks a song up only as it starts,
  // so the queue's next song has none (seen on every queue). Its search
  // finds it: the same track (its id), else the same album, else the first.
  // Once a song, and remembered.
  var nextArtSeen = {};
  function nextArt(d, sig, mi) {
    var h = clientNow(), str = function (x) { return typeof x === 'string' ? x : ''; };
    var tail = function (u) { u = str(u); var i = u.indexOf('://'); return i >= 0 ? u.slice(i + 3) : u; };
    var id = tail(mi.uri) || (str(mi.name) + '|' + str(mi.artists && mi.artists[0] && mi.artists[0].name));
    var put = function (url) {
      if (!url || mus.nextFor !== sig || !mus.next) return;
      // Apple's covers come 1000 px square for a 50 px thumbnail (4 MB
      // decoded on a tablet): its image server makes any size asked for
      url = url.replace(/\/(\d+)x(\d+)(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/, '/160x160$3.$4');
      mus.next.image = url;
      mus.views.forEach(function (v) { drawMusic(v, v.d); });
    };
    if (nextArtSeen[id] !== undefined) { put(nextArtSeen[id]); return; }
    // the Music Assistant this player is part of (its device's entry)
    var ent = h && h.entities && h.entities[d.key], dev = ent && h.devices && h.devices[ent.device_id];
    var entry = dev && (dev.primary_config_entry || (dev.config_entries || [])[0]);
    var artist = str(mi.artists && mi.artists[0] && mi.artists[0].name);
    if (!entry || !str(mi.name)) return;
    nextArtSeen[id] = '';
    sendWS({ type: 'call_service', domain: 'music_assistant', service: 'search', return_response: true,
             service_data: { config_entry_id: entry, name: str(mi.name), artist: artist || undefined, media_type: ['track'], limit: 5 } })
      .then(function (r) {
        var ts = (r && r.response && r.response.tracks) || [];
        var album = str(mi.album && mi.album.name).toLowerCase();
        var pick = ts.filter(function (t) { return tail(t.uri) === tail(mi.uri); })[0] ||
                   ts.filter(function (t) { return album && str(t.album && t.album.name).toLowerCase() === album; })[0] || ts[0];
        var url = pick ? (str(pick.image) || str(pick.album && pick.album.image)) : '';
        nextArtSeen[id] = url;
        var keys = Object.keys(nextArtSeen);
        if (keys.length > 50) delete nextArtSeen[keys[0]];
        put(url);
      }).catch(function () { /* no search: the note stays */ });
  }
  // A BUTTON, where it is drawn (the views take no pointer events)
  // ON SCREEN: not hidden, and not faded out with anything it sits in. The
  // pane stays laid out at opacity 0 when it is down (.pane, :host([pane])),
  // its music with it: its art kept its box over the clock's right side, and
  // a tap on the clock opened Play Music instead of waking to the dashboard
  // (2026-10-21).
  function seen(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      if (n === host) break;
    }
    return true;
  }
  function musicHit(x, y) {
    if (x == null || y == null) return null;
    for (var i = 0; i < mus.views.length; i++) {
      var v = mus.views[i];
      // (the dashboard's pane takes its own taps -- and lies under this)
      if (v.kind === 'dash' || !v.el.isConnected || (v.kind === 'slide' && !muShowing) || !seen(v.el)) continue;
      if (!v.el.hasAttribute('novol')) {
        var tr = v.vt.getBoundingClientRect();
        if (tr.width && x >= tr.left - MU_SLOP && x <= tr.right + MU_SLOP && y >= tr.top - 2 * MU_SLOP && y <= tr.bottom + 2 * MU_SLOP) return { vol: true, view: v };
      }
      var bs = v.el.querySelectorAll('.mbtn');
      for (var j = 0; j < bs.length; j++) {
        var r = bs[j].getBoundingClientRect();
        if (r.width && x >= r.left - MU_SLOP && x <= r.right + MU_SLOP && y >= r.top - MU_SLOP && y <= r.bottom + MU_SLOP &&
            getComputedStyle(bs[j]).visibility !== 'hidden') return { btn: bs[j], view: v };
      }
      // THE ALBUM ART opens Play Music
      var ar = v.el.querySelector('.msq').getBoundingClientRect();
      if (ar.width && x >= ar.left && x <= ar.right && y >= ar.top && y <= ar.bottom) return { art: true, view: v };
    }
    return null;
  }
  // this dashboard's Play Music page, when it has one (as weatherPage)
  function musicPage() {
    var conf = dashConf();
    var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'playmusic'; });
    return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/playmusic' : null;
  }
  // A TAP ON THE ART: the screensaver closes onto Play Music, showing that
  // music (this screen's focus, as a tap on it there would make it)
  function openMusic(hit) {
    var d = hit.view.d, M = window.hkMusic, page = musicPage();
    if (d && d.key && M && M.setFocus) { try { M.setFocus(d.key); } catch (e) { /* the page follows what plays */ } }
    // (the dashboard's pane: there is no screensaver to close)
    if (hit.view.kind === 'dash') { if (page) go(page); return; }
    pressStop = true;
    stop('touch');
    if (page) go(page);
  }
  // THE VOLUME: a finger down on its track sets it there and drags it
  // (sent at most every VOL_EVERY, and once more as the finger lifts)
  var VOL_EVERY = 200;
  function volFrom(x) {
    var dr = mus.drag, r = dr && dr.view.vt.getBoundingClientRect();
    if (!r || !r.width || x == null) return;
    var val = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100;
    var d = dr.view.d;
    if (!d || d.idle) return;
    mus.vol = { key: d.key, val: val, until: clock.now() + 4000, sent: mus.vol && mus.vol.key === d.key ? mus.vol.sent : null };
    mus.views.forEach(function (v) { if (v.d && v.d.key === d.key) { v.d.vol = val; drawMusic(v, v.d); } });
    var now = clock.now();
    if (now - dr.sent >= VOL_EVERY) volSend(); else if (!dr.t) dr.t = setTimeout(volSend, VOL_EVERY - (now - dr.sent));
  }
  function volSend() {
    var dr = mus.drag, act = actionsNow();
    if (dr && dr.t) { clearTimeout(dr.t); dr.t = null; }
    if (!mus.vol || !act) return;
    if (dr) dr.sent = clock.now();
    if (mus.vol.sent === mus.vol.val) return;
    mus.vol.sent = mus.vol.val;
    try { act.callService('media_player', 'volume_set', { entity_id: mus.vol.key, volume_level: mus.vol.val }); } catch (e) { /* offline */ }
  }
  function volStart(hit, x) {
    mus.drag = { view: hit.view, sent: 0, t: null };
    mus.key = hit.view.d && hit.view.d.key; mus.lostAt = 0;
    setAttr(hit.view.el, 'dragging', true);
    volFrom(x);
    if (muShowing && mode === 'photos') schedule();
  }
  function volEnd() {
    var dr = mus.drag;
    if (!dr) return;
    volSend();
    if (dr.t) clearTimeout(dr.t);
    setAttr(dr.view.el, 'dragging', false);
    mus.drag = null;
    if (mus.vol) mus.vol.until = clock.now() + 4000;   // the house catching up
  }
  function musicAct(hit, x) {
    if (!hit || hit.view.kind !== 'dash') { saverTouched(); musicUsed(); }
    if (hit && hit.art) { openMusic(hit); return; }
    if (hit && hit.vol) { volStart(hit, x); return; }
    var port = actionsNow(), d = hit && hit.view.d, act = hit && hit.btn.getAttribute('data-act');
    if (!port || !d || !d.key || !act) return;
    if (act === 'spk' || act === 'brw') { panelFor(hit.view, act === 'spk' ? 'speakers' : 'browse'); return; }
    var svc = act === 'prev' ? 'media_previous_track' : act === 'next' ? 'media_next_track'
            : !d.idle && d.playing ? 'media_pause' : 'media_play';
    try { port.callService('media_player', svc, { entity_id: d.key }); } catch (e) { /* offline */ }
    var b = hit.btn;
    b.classList.add('hit');
    setTimeout(function () { b.classList.remove('hit'); }, 180);
    // the music touched stays the music on screen, paused or not
    mus.key = d.key; mus.lostAt = 0;
    if (act === 'pp' && !d.idle) {
      d.playing = !d.playing; d.pos = elapsed(Object.assign({}, d, { playing: !d.playing })); d.posAt = Date.now();
      mus.views.forEach(function (v) { if (v.d === d) drawMusic(v, d); });
      musicTick();
    }
    // a slide among the photos stays its full turn after a touch
    if (muShowing && mode === 'photos') schedule();
  }

  // ------------------------------------------------------------ the music's panel
  // SPEAKERS AND BROWSE (hk-saver-panel.js draws them; 2026-10-11). The
  // slide's art, or the whole pane, turns over and the panel is on its back:
  // Speakers (ticks and Update), Volume (each room), Browse (the house's
  // playlists and the Browse Music page, on this music's speakers). While it
  // is open the screensaver holds its slide, taps on it reach it (every other
  // tap is swallowed here), a tap anywhere else closes it -- never a wake --
  // and it closes itself PANEL_IDLE untouched, when its music goes, and a
  // moment after a request has landed.
  var PANEL_IDLE = 30000, PANEL_TURN = [300, 420];
  var pnl = null;               // { p: the panel, view, idleT, doneT, src, anim }
  function panelFor(v, tab) {
    var P = window.hkSaverPanel, proot = rootOf(v);
    if (!P || !proot || !v || !v.el.isConnected) return;
    if (pnl && pnl.view === v) {
      if (pnl.p.tab() === tab) closePanel(true); else { pnl.p.show(tab); panelButtons(); panelTouched(); }
      return;
    }
    if (pnl) closePanel(false);
    if (!proot.querySelector('style.mpcss')) {
      var HC = window.hkCards;
      var st = document.createElement('style'); st.className = 'mpcss';
      st.textContent = P.CSS + (HC && HC.shadeCss ? '\n' + HC.shadeCss('.mpanel') : ''); proot.appendChild(st);
    }
    var me = { view: v, idleT: null, doneT: null, anim: null,
               src: v.kind === 'pane' ? paneEl : v.kind === 'dash' ? v.box : v.el.querySelector('.msq') };
    me.p = P.create({
      client: clientNow,             // its reads, and its buttons through client.actions
      ctx: function () { return musicNow(clientNow()); },
      art: function () { return v.bg[v.flip] || null; },
      // the music moved (Update, a new leader): the screensaver follows it
      follow: function (key) { if (key) { mus.key = key; mus.lostAt = 0; renderMusic(); } },
      done: function (ms) {
        if (pnl !== me) return;
        if (me.doneT) clearTimeout(me.doneT);
        me.doneT = setTimeout(function () { me.doneT = null; if (pnl === me) closePanel(true); }, ms || 0);
      },
      wide: function () { return !!me.wide; },
      // the pane's back: what plays, and play / pause and next, at its foot
      mini: function () { return v.kind === 'pane' || v.kind === 'dash'; },
      now: function () { return v.d; },
      transport: function (k) {
        var b = v.el.querySelector('.mbtn[data-act="' + (k === 'pp' ? 'pp' : 'next') + '"]');
        if (b) musicAct({ btn: b, view: v });
      }
    });
    pnl = me;
    if (v.kind !== 'slide') me.p.el.classList.remove('card'); else me.p.el.classList.add('card');
    proot.appendChild(me.p.el);
    if (v.kind === 'dash') dashOutside(true);
    placePanel();
    me.p.show(tab);
    panelButtons();
    panelTouched();
    turnPanel(true);
  }
  // WHERE IT SITS: the pane's own box; or, on the slide, a card over the art
  // (a little bigger than it) between the song's column and the screen's
  // edge -- again whenever the screen changes size (a tablet's keyboard)
  function placePanel() {
    if (!pnl || !hostOf(pnl.view)) return;
    var v = pnl.view, el = pnl.p.el, z = v.kind === 'dash' ? v.z || 1 : scaleOf(), b, off = { x: 0, y: 0 };
    if (v.kind === 'pane' || v.kind === 'dash') {
      var r = (v.kind === 'dash' ? v.box : paneEl).getBoundingClientRect();
      b = { x: r.left, y: r.top, w: r.width, h: r.height };
      // (the dashboard's card is the panel's box: placed in it, not the screen)
      if (v.kind === 'dash') { var hr = v.host.getBoundingClientRect(); off = { x: hr.left, y: hr.top }; }
    } else {
      var area = v.el.querySelector('.mbody').getBoundingClientRect(), col = v.el.querySelector('.mcol').getBoundingClientRect();
      var art = v.el.querySelector('.mart').getBoundingClientRect(), H0 = window.innerHeight || area.height;
      var lo = col.right + 24 * z, hi = area.right - 24 * z;
      var w = Math.max(280 * z, Math.min(566 * z, hi - lo));
      var cx = Math.max(lo + w / 2, Math.min(hi - w / 2, art.left + art.width / 2));
      var top = (paneUp ? 40 : 100) * z, bot = H0 - 36 * z;
      if (bot - top < 300 * z) top = Math.max(12 * z, bot - 300 * z);     // the keyboard up: as tall as there is
      var h = Math.min(660 * z, bot - top);
      var cy = Math.max(top + h / 2, Math.min(bot - h / 2, art.top + art.height / 2));
      b = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
    }
    pnl.box = b;
    pnl.wide = b.w >= 500 * z;
    // A SHORT SCREEN (a tablet's keyboard up for the search): the panel
    // alone over the art -- the song's column and the clock would only be
    // squeezed under it -- and the field kept in sight
    var kb = (window.innerHeight || 800) < 560 * z;
    setAttr(hostOf(v), 'mpkb', kb);
    if (kb || pnl.kb) pnl.p.reveal();
    pnl.kb = kb;
    el.style.left = Math.round(b.x - off.x) + 'px'; el.style.top = Math.round(b.y - off.y) + 'px';
    el.style.width = Math.round(b.w) + 'px'; el.style.height = Math.round(b.h) + 'px';
    pnl.p.size(b.w, b.h, z);
  }
  // THE TURN: the art (or the pane) to edge-on as it grows toward the
  // panel's box, then the panel from edge-on to flat. Transforms only.
  function turnPanel(opening, done, rec) {
    var me = rec || pnl, el = me.p.el, src = me.src, B = me.box;
    if (!src || !B) { if (done) done(); return; }
    var reduce = ((window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    var r = src.getBoundingClientRect(), R = { x: r.left, y: r.top, w: r.width, h: r.height };
    if (!opening && me.hidRect) R = me.hidRect;
    var Mid = { x: (R.x + B.x) / 2, y: (R.y + B.y) / 2, w: (R.w + B.w) / 2, h: (R.h + B.h) / 2 };
    var per = Math.round(1500 * (me.view.kind === 'dash' ? me.view.z || 1 : scaleOf()));
    var xf = function (from, to, deg) {
      return 'perspective(' + per + 'px) translate(' + ((from.x + from.w / 2) - (to.x + to.w / 2)) + 'px,' +
             ((from.y + from.h / 2) - (to.y + to.h / 2)) + 'px) rotateY(' + deg + 'deg) scale(' + (from.w / to.w) + ',' + (from.h / to.h) + ')';
    };
    var hide = function (on) {
      src.style.visibility = on ? 'hidden' : '';
      if (me.view.kind !== 'slide') setAttr(hostOf(me.view), 'mpp', on);
    };
    var can = !reduce && typeof el.animate === 'function' && typeof src.animate === 'function';
    if (me.anim) { try { me.anim.cancel(); } catch (e) { /* done */ } me.anim = null; }
    if (opening) {
      me.hidRect = R;
      el.classList.add('up');
      if (me.view.kind !== 'slide') setAttr(hostOf(me.view), 'mpp', true);
      if (!can) { hide(true); if (done) done(); return; }
      el.style.visibility = 'hidden';
      var a = me.anim = src.animate([{ transform: 'none' }, { transform: xf(Mid, R, 90) }], { duration: PANEL_TURN[0], easing: 'cubic-bezier(.45,0,.9,.5)', fill: 'forwards' });
      a.onfinish = function () {
        hide(true); a.cancel();
        if (pnl !== me) { hide(false); el.classList.remove('up'); return; }
        el.style.visibility = '';
        var b2 = me.anim = el.animate([{ transform: xf(Mid, B, -90) }, { transform: 'none' }], { duration: PANEL_TURN[1], easing: 'cubic-bezier(.1,.5,.25,1)' });
        b2.onfinish = function () { if (me.anim === b2) me.anim = null; if (done) done(); };
      };
    } else {
      if (!can) { el.classList.remove('up'); hide(false); if (done) done(); return; }
      var c1 = me.anim = el.animate([{ transform: 'none' }, { transform: xf(Mid, B, -90) }], { duration: PANEL_TURN[0], easing: 'cubic-bezier(.45,0,.9,.5)', fill: 'forwards' });
      c1.onfinish = function () {
        el.classList.remove('up'); c1.cancel();
        hide(false);
        var c2 = me.anim = src.animate([{ transform: xf(Mid, R, 90) }, { transform: 'none' }], { duration: PANEL_TURN[1], easing: 'cubic-bezier(.1,.5,.25,1)' });
        c2.onfinish = function () { me.anim = null; if (done) done(); };
      };
    }
  }
  // closed: turned back (animated), or at once (its view gone, the
  // screensaver stopping)
  function closePanel(animated) {
    var me = pnl;
    if (!me) return;
    pnl = null;
    // (its closing is its last use: the music stays a whole grace after it,
    // however it closed -- a tap, a request landed, idle)
    if (me.view.kind === 'dash') { if (me.view.host) me.view.host._usedAt = Date.now(); } else musicUsed();
    if (hostOf(me.view)) setAttr(hostOf(me.view), 'mpkb', false);
    if (me.view.kind === 'dash') dashOutside(false);
    if (me.idleT) clearTimeout(me.idleT);
    if (me.doneT) clearTimeout(me.doneT);
    // (a field focused on a tablet: its keyboard goes with it)
    try { var a = me.p.el.getRootNode && me.p.el.getRootNode().activeElement; if (a && a.blur) a.blur(); } catch (e) { /* ignore */ }
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (e) { /* ignore */ }
    panelButtons();
    var finish = function () {
      me.p.destroy();
      if (me.src) { me.src.style.visibility = ''; }
      if (me.view.kind !== 'slide' && hostOf(me.view)) setAttr(hostOf(me.view), 'mpp', false);
    };
    if (animated && (on || me.view.kind === 'dash') && me.src && me.src.isConnected && me.view.el.isConnected) turnPanel(false, finish, me);
    else { if (me.anim) { try { me.anim.cancel(); } catch (e) { /* done */ } } finish(); }
    // the slide's turn among the photos starts again now
    if (on && muShowing && mode === 'photos') schedule();
  }
  // a touch on it: not closed for PANEL_IDLE more, and the house told
  function panelTouched() {
    var me = pnl;
    if (!me) return;
    if (me.view.kind !== 'dash') { saverTouched(); musicUsed(); }
    if (me.idleT) clearTimeout(me.idleT);
    var check = function () {
      me.idleT = null;
      if (pnl !== me) return;
      if (me.p.busy()) { me.idleT = setTimeout(check, 5000); return; }
      closePanel(true);
    };
    me.idleT = setTimeout(check, PANEL_IDLE);
  }
  function panelButtons() {
    mus.views.forEach(function (v) {
      Array.prototype.forEach.call(v.el.querySelectorAll('.mbtn.mx'), function (b) {
        var tab = b.getAttribute('data-act') === 'spk' ? 'speakers' : 'browse';
        b.classList.toggle('on', !!pnl && pnl.view === v && pnl.p.tab() === tab);
      });
    });
  }
  function inPanel(e) {
    if (!pnl) return false;
    var path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(pnl.p.el) >= 0;
  }
  // A TOUCH ON THE SCREENSAVER'S OWN CONTROLS (the music, its panel, a photo
  // stepped), told to the integration as such: Sleep Screen reads it as the
  // photos in use, not somebody at the dashboard (sleep_engine.py
  // saver_use) -- the kiosk's own report of the same tap would otherwise
  // wake the dashboard out from under the finger. At most every 3 s, only
  // from the tablet's own user (as reportTouch).
  var saverSent = 0;
  function saverTouched() {
    if (!cfg || !cfg.entity || !/^switch\./.test(cfg.entity)) return;
    if (!mine() || force || /[?&]hk_saver=force\b/.test(location.search)) return;
    var now = Date.now();
    if (now - saverSent < 3000) return;
    saverSent = now;
    sendWS(whoMsg({ type: 'hk_frontend/screensaver/touch', saver: true })).catch(function () { /* older integration */ });
  }

  // THE SLIDE: built the first time, then kept like the forecast's layer
  function buildMusicSlide() {
    var v = slideView();
    if (v && v.el.isConnected) return v;
    if (v) dropView(v);
    if (!root) return null;
    v = musicView('slide');
    root.insertBefore(v.el, root.querySelector('.info'));
    return v;
  }
  // false: nothing plays (nothing shown). first: the screensaver's first view
  function showMusicSlide(first) {
    if (!on || !root || !host || muShowing) return muShowing;
    var ctx = musicNow(clientNow());
    if (!ctx || !ctx.playing) return false;
    var v = buildMusicSlide(), run = photoRun;
    // (Home Energy over everything: the music in its place)
    if (enShowing) { hideEnergySlide(); if (exKind === 'energy') exKind = ''; }
    if (wxShowing) { hideWeatherSlide(); if (exKind === 'weather') exKind = ''; }
    muShowing = true; sinceFc = 0; lastSlide = 'music'; mus.lostAt = 0;
    renderMusic();
    host.setAttribute('muslide', '');
    updateBand();
    forecastTick(false);                 // the forecast's sky holds still under it
    layoutMusic();
    // IN ONCE ITS ART IS DECODED (never more than a moment): faded in on
    // the placeholder, the cover popped in halfway through
    var go = false, reveal1 = function () {
      if (go) return; go = true;
      if (!(on && muShowing && run === photoRun && v.el.isConnected)) return;
      reveal(v.el, !!first);
      if (first && entrance) entrance();
    };
    v.ready.then(function () { requestAnimationFrame(reveal1); });
    setTimeout(reveal1, 1500);
    return true;
  }
  function hideMusicSlide() {
    if (!muShowing) return;
    if (pnl && pnl.view.kind === 'slide') closePanel(false);
    muShowing = false;
    mus.lostAt = 0;
    if (host) host.removeAttribute('muslide');
    if (!musicPaneView()) mus.key = null;
    updateBand();
    musicTick();
    // over the forecast: back to it
    if (mode === 'forecast' && root && root.querySelector('.fc')) { reveal(root.querySelector('.fc'), false); forecastTick(true); }
  }
  // The text column below the clock, the weather and the date: what does
  // not fit goes, Up Next first, then the album
  function layoutMusic() {
    var v = slideView();
    if (!v || !host || !root) return;
    host.style.setProperty('--hk-mu-z', String(scaleOf()));
    var col = v.el.querySelector('.mcol'), info = root.querySelector('.info');
    if (!col || !info || !v.el.getBoundingClientRect().width) return;
    var H = window.innerHeight || 0, top = 0;
    Array.prototype.forEach.call(info.children, function (c) {
      var r = c.getBoundingClientRect();
      if (r.height > 0 && r.top < H / 2) top = Math.max(top, r.bottom);
    });
    var room = top + Math.round(24 * scaleOf());
    for (var t = 0; t <= 2; t++) {
      v.el.setAttribute('tight', String(t));
      if (col.getBoundingClientRect().top >= room) break;
    }
  }
  // OVER THE FORECAST, the house decides: the slide while music plays, the
  // forecast again MU_GRACE after it stops. Every view follows the house.
  // At most once a second (a new client comes many times a second).
  // THE MUSIC TAKES THE SCREEN while it plays: Music First, or (as before
  // Music First) the music over the forecast
  function takeover() { return !!cfg && (cfg.music_first || (cfg.music_slide && mode !== 'photos')); }
  function musicWatch() {
    if (!on || !cfg || !root || !(cfg.music_slide || cfg.music_pane || cfg.music_first || (cfg.extra_music && muShowing))) return;
    var now = clock.now();
    if (now - mus.watchAt < 1000) {
      if (!mus.watchT) mus.watchT = setTimeout(function () { mus.watchT = null; musicWatch(); }, 1000 - (now - mus.watchAt));
      return;
    }
    mus.watchAt = now;
    var ctx = mus.views.length ? renderMusic() : musicNow(clientNow());
    // the pane's music: while something plays, or its panel is open, and the
    // grace after (paused music goes too, once the grace is up)
    var g = muGrace(), inUse = !!pnl && pnl.view.kind !== 'dash';
    if ((ctx && ctx.playing) || inUse) mus.lastActive = now;
    if (cfg.music_pane) musicIn(now - mus.lastActive < g);
    // (looked at again as the grace runs out: a paused house sends nothing)
    if (mus.lastActive && now - mus.lastActive < g) {
      clearTimeout(mus.graceT);
      mus.graceT = setTimeout(function () { mus.watchAt = 0; musicWatch(); }, g - (now - mus.lastActive) + 100);
    }
    if (!takeover()) return;
    if (!muShowing) { if (ctx && ctx.playing) showMusicSlide(); return; }
    if ((ctx && ctx.playing) || inUse) mus.lostAt = 0;
    else if (!mus.lostAt) mus.lostAt = Math.max(now, mus.lastActive);
    else if (now - Math.max(mus.lostAt, mus.lastActive) > g) {
      // back to the forecast, or to the photos (the next one takes the music away)
      mus.lostAt = 0;
      if (mode !== 'photos') hideMusicSlide(); else showNext(false);
    }
  }
  // the pane's music, there or not
  function musicPane(want) {
    var v = musicPaneView();
    if (!want) { if (v) dropView(v); return; }
    if (v && v.el.parentNode === paneEl) return;
    if (v) dropView(v);
    if (!paneEl || !host) return;
    host.style.setProperty('--hk-mu-z', String(scaleOf()));
    v = musicView('pane');
    paneEl.appendChild(v.el);
    renderMusic();
  }
  function leaveMusic() {
    closePanel(false);
    if (mus.tick) { clearInterval(mus.tick); mus.tick = null; }
    if (mus.watchT) { clearTimeout(mus.watchT); mus.watchT = null; }
    mus.views.filter(function (v) { return v.kind !== 'dash'; }).forEach(dropView);
    if (mus.drag && mus.drag.t) clearTimeout(mus.drag.t);
    mus.key = null; mus.next = null; mus.nextFor = ''; mus.year = ''; mus.lostAt = 0; mus.drag = null; mus.vol = null;
    mus.paneIn = false; mus.paneNext = null;
    muShowing = false; lastSlide = '';
    if (host) host.removeAttribute('muslide');
  }

  // ------------------------------------------------------- THE DASHBOARD'S PANE
  // NOW PLAYING AS A PANE ON THE DASHBOARD (2026-10-15; the screen's Now
  // Playing -> Side Pane, hk-popup.js placeFor). The screensaver's own music
  // pane, the same view (kind 'dash') in a card of its own
  // (hk-music-pane-card) that the docked #media pop-up stands up down one
  // side of the screen: the same art, song, buttons, volume, Up Next and
  // Speakers / Browse panel, drawn from the same state -- so it is the music
  // the screensaver shows, and the screensaver coming up over it shows the
  // same. Unlike the screensaver's it takes taps the ordinary way (the page
  // is not covered), and touching it is somebody at the dashboard, not at
  // the screensaver (no saverTouched).
  function hostOf(v) { return v && v.kind === 'dash' ? v.host : host; }
  function rootOf(v) { return v && v.kind === 'dash' ? v.root : root; }
  function dashViews() { return mus.views.filter(function (v) { return v.kind === 'dash'; }); }
  function dashLive() { return mus.views.some(function (v) { return v.kind === 'dash' && v.live && v.el.isConnected; }); }
  // what plays for a pane: hkMusic's answer for this screen (hk-popup.js asks)
  function musicHas(h) { return !!musicNow(h || clientNow()); }
  // the dashboard's pane drawn again from the house, at most once a second
  // (the screensaver's own watch draws every view while it is up)
  var dashAt = 0, dashT = null;
  function dashWatch() {
    if (on || !dashLive()) return;
    var now = Date.now();
    if (now - dashAt < 1000) {
      if (!dashT) dashT = setTimeout(function () { dashT = null; dashWatch(); }, 1000 - (now - dashAt));
      return;
    }
    dashAt = now;
    renderMusic();
  }
  // ITS PANEL closes with a tap anywhere else on the dashboard, and a touch
  // on it keeps it open (the screensaver routes both itself)
  var dashOut = null;
  function dashOutside(want) {
    if (!want) {
      if (dashOut) { document.removeEventListener('pointerdown', dashOut, true); dashOut = null; }
      return;
    }
    if (dashOut) return;
    dashOut = function (e) {
      if (!pnl || pnl.view.kind !== 'dash') return;
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(pnl.p.el) >= 0) { panelTouched(); return; }
      // (its own buttons: Speakers / Browse switch or close it themselves)
      var mx = pnl.view.el.querySelectorAll('.mbtn.mx');
      for (var i = 0; i < mx.length; i++) if (path.indexOf(mx[i]) >= 0) return;
      closePanel(true);
    };
    document.addEventListener('pointerdown', dashOut, true);
  }
  var DASH_CSS = [
    // the card fills what the pop-up gives it: the pane, the card's whole box
    // (not clipped: the pane's shadow falls off its edge onto the page, as
    // onto the photos -- the pane itself clips its art)
    ':host{display:block;position:relative;height:100%;min-height:0;overflow:visible;color:var(--hk-ink,rgba(255,255,255,0.94));',
    // (a finger across it is its swipe away, never the page's pan: without
    // this a touch drag sideways was the browser's, and cancelled)
    '  -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;--hk-ink:rgba(255,255,255,0.94);touch-action:pan-y}',
    '.pane{left:0;width:auto}',
    // (a left pane's edge and shadow on its right, toward the page)
    ':host([side="left"]) .pane{border-left:0;border-right:1px solid rgba(255,255,255,0.10);',
    '  box-shadow:18px 0 44px rgba(0,0,0,.42),3px 0 12px rgba(0,0,0,.26)}',
    // ITS PANEL (Speakers / Volume / Browse) stands where the pane was, so
    // it wears the pane's edge: the hairline and the shadow onto the page
    // (the pane itself is hidden under it)
    ':host .mpanel:not(.card){box-shadow:inset 1px 0 0 rgba(255,255,255,0.10),-18px 0 44px rgba(0,0,0,.42),-3px 0 12px rgba(0,0,0,.26)}',
    ':host([side="left"]) .mpanel:not(.card){box-shadow:inset -1px 0 0 rgba(255,255,255,0.10),18px 0 44px rgba(0,0,0,.42),3px 0 12px rgba(0,0,0,.26)}',
    // its controls take taps (the screensaver's find them by place)
    '.pm .mbtn,.pm .mvt,.pm .msq{pointer-events:auto;cursor:pointer}',
    '.pm .mvt{touch-action:none}',
    '.pm .mvt::before{content:"";position:absolute;left:-14px;right:-14px;top:-18px;bottom:-18px}',
    '@media (hover:hover){.pm .mbtn:hover{background:rgba(255,255,255,.22)}.pm .mbtn.mpp:hover{background:#fff}}'
  ].join('\n');
  var DASH_SWIPE = 10;
  // ONE VIEW FOR EVERY PAGE'S PANE (2026-10-15): each page of a dashboard
  // holds its own #media pop-up, so a page change builds a new card -- and a
  // new view started with no art, the placeholder showing until the cover had
  // loaded and faded in again (seen in Safari, every page change). The view
  // is made once and handed to whichever card is showing: its art, blur and
  // song move with it, drawn already.
  var dashV = null;
  if (!customElements.get('hk-music-pane-card')) {
    var MusicPane = class extends HTMLElement {
      constructor() {
        super();
        this._root = this.attachShadow({ mode: 'open' });
      }
      setConfig(c) { this._config = c || {}; }
      getCardSize() { return 0; }
      // Lovelace's entry (hkHostClient.entry below) hands each new client here
      _onClient() { if (this._v && this._v.live) dashWatch(); }
      connectedCallback() {
        if (!this._root.querySelector('.pane')) this._make();
        this._adopt();
        this._size();
        if (this._want) this.active(true);
      }
      disconnectedCallback() {
        var v = this._v;
        // (only the card holding the view lets it rest: one a new page's
        // card has taken it from keeps drawing there)
        if (!v || v.host !== this) return;
        if (pnl && pnl.view === v) closePanel(false);
        v.live = false;
        musicTick();
      }
      // the shared view, into this card's pane
      _adopt() {
        var v = this._v = dashV, box = this._root.querySelector('.pane');
        if (v.host === this && v.el.parentNode === box) return;
        if (pnl && pnl.view === v && v.host !== this) closePanel(false);
        v.host = this; v.root = this._root; v.box = box; v.z = null;
        box.appendChild(v.el);
      }
      // shown (the pop-up a pane) or not (the bar): drawn and ticking only shown
      active(want) {
        this._want = !!want;
        var v = this._v;
        if (!v) return;
        if (want && this.isConnected) this._adopt();
        else if (v.host !== this) return;
        var was = v.live;
        v.live = this._want && this.isConnected;
        if (v.live) { this._size(); if (!was) { dashAt = 0; renderMusic(); } }
        else if (pnl && pnl.view === v) closePanel(false);
        musicTick();
      }
      // WHEN IT WAS LAST IN USE (hk-popup.js holds the sheet a grace after):
      // its panel open is now; else the last touch on it
      hkLastUse() {
        var v = this._v;
        if (v && v.host === this && pnl && pnl.view === v) return Date.now();
        return this._usedAt || 0;
      }
      // ready to be seen: its music drawn and its art in (or none to wait for)
      whenReady() {
        var v = this._v;
        if (!v) return Promise.resolve();
        if (!v.live) this.active(true);
        return Promise.resolve(v.ready).then(function () { return v.ready; });
      }
      // its scale: the screensaver's pane is 400 px at z 1
      _size() {
        var v = this._v, w = this.getBoundingClientRect().width || parseFloat(getComputedStyle(this).getPropertyValue('--hk-pane-w')) || 400;
        var z = Math.max(0.85, Math.min(1.3, w / PANE_W));
        if (v.z === z) return;
        v.z = z;
        var px = function (n) { return Math.round(n * z) + 'px'; };
        this.style.setProperty('--hk-mu-z', String(z));
        this.style.setProperty('--hk-pane-pad', px(28));
        this.style.setProperty('--hk-pane-top', px(30));
        this.style.setProperty('--hk-pm-foot', px(26));
      }
      _make() {
        var r = this._root, self = this;
        var css = CSS.slice(CSS.indexOf('.pane{position:absolute'));
        window.hkCards.flatSurface(this, 'music');
        r.innerHTML = '<style>' + css + '\n' + DASH_CSS + window.hkCards.flatCss() +
          ':host([hk-flat]) .pm{background:#24252A!important;color:#F5F4F0;--hk-ink:#F5F4F0;--hk-ink-2:#C3C3C6;--hk-ink-3:#A3A4A9;--hk-glyph:#F5F4F0;--hk-key:#3A3B40;--hk-line:#48494F;--hk-line-strong:#62636A}' +
          ':host([hk-flat]) .mbgf,:host([hk-flat]) .mshade{display:none}' +
          ':host([hk-flat]) .pane,:host([hk-flat]) .mpanel{box-shadow:var(--hk-flat-elevated-shadow)!important;background:#24252A}' + '</style><div class="pane"></div>';
        this.addEventListener('pointerdown', function () { self._usedAt = Date.now(); }, true);
        // the screensaver's pane, as its host's attributes draw it
        ['panecfg', 'pane', 'pm'].forEach(function (a) { self.setAttribute(a, ''); });
        this._swipe();
        if (dashV) return;
        // THE VIEW, made once (dashV): its taps are wired on it, so they
        // work in whichever card holds it
        var v = dashV = musicView('dash');
        v.live = false;
        if (!window.hkSaverPanel) v.el.setAttribute('nomx', '');
        // ITS BUTTONS, the art (Play Music) and the volume (dragged), as a
        // tap on the screensaver's does -- by the element, not the place
        v.el.addEventListener('click', function (e) {
          var sw = v.host && v.host._swallow;
          if (sw && Date.now() - sw < 400) return;
          var b = e.target.closest ? e.target.closest('.mbtn') : null;
          if (b) { musicAct({ btn: b, view: v }); return; }
          if (e.target.closest && e.target.closest('.msq')) musicAct({ art: true, view: v });
        });
        var vt = v.vt;
        vt.addEventListener('pointerdown', function (e) {
          if (v.el.hasAttribute('novol')) return;
          e.preventDefault(); e.stopPropagation();
          try { vt.setPointerCapture(e.pointerId); } catch (x) { /* gone */ }
          musicAct({ vol: true, view: v }, e.clientX);
        });
        vt.addEventListener('pointermove', function (e) { if (mus.drag && mus.drag.view === v) volFrom(e.clientX); });
        var up = function () { if (mus.drag && mus.drag.view === v) volEnd(); };
        vt.addEventListener('pointerup', up);
        vt.addEventListener('pointercancel', up);
      }
      // SWIPED TOWARD ITS EDGE, PUT AWAY: the bar's swipe down, sideways --
      // the docked sheet follows the finger and goes past 35% of its width or
      // on a flick, else springs back; then hk-popup's own close (the hash
      // cleared), which with `dismissable` leaves the stash button
      _swipe() {
        var self = this, d = null;
        var sheetOf = function () {
          var n = self.parentNode;
          while (n && !(n.classList && n.classList.contains('sheet'))) n = n.parentNode;
          return n;
        };
        this.addEventListener('pointerdown', function (ev) {
          if (d || !self._v || (pnl && pnl.view === self._v) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
          var path = ev.composedPath ? ev.composedPath() : [];
          if (path.indexOf(self._v.vt) >= 0) return;
          var sh = sheetOf();
          if (!sh) return;
          d = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sh: sh, w: sh.offsetWidth || 400, on: false,
                dir: self.getAttribute('side') === 'left' ? -1 : 1, last: [ev.timeStamp, ev.clientX], prev: null };
        });
        this.addEventListener('pointermove', function (ev) {
          if (!d || ev.pointerId !== d.id) return;
          var dx = (ev.clientX - d.x) * d.dir, dy = ev.clientY - d.y;
          if (!d.on) {
            if (Math.abs(dy) > DASH_SWIPE && Math.abs(dy) > Math.abs(dx)) { d = null; return; }
            if (dx < -DASH_SWIPE) { d = null; return; }
            if (!(dx > DASH_SWIPE && dx > Math.abs(dy) * 1.4)) return;
            d.on = true;
            try { self.setPointerCapture(d.id); } catch (x) { /* gone */ }
            d.sh.style.transition = 'none';
          }
          d.sh.style.transform = 'translateX(' + (d.dir * Math.max(0, dx - DASH_SWIPE)) + 'px)';
          d.prev = d.last; d.last = [ev.timeStamp, ev.clientX];
        });
        var end = function (ev) {
          if (!d || ev.pointerId !== d.id) return;
          var g = d, sh = g.sh;
          d = null;
          if (!g.on) return;
          self._swallow = Date.now();
          var x = (ev.clientX - g.x) * g.dir - DASH_SWIPE;
          var vel = g.prev ? (g.last[1] - g.prev[1]) * g.dir / Math.max(1, g.last[0] - g.prev[0]) : 0;
          if (ev.type === 'pointerup' && (x > g.w * 0.35 || (vel > 0.5 && x > 20))) {
            sh.style.transition = 'transform .2s cubic-bezier(.4,0,1,1)';
            sh.style.transform = 'translateX(' + (g.dir * 104) + '%)';
            setTimeout(function () {
              if (location.hash) {
                history.replaceState(null, '', location.pathname + location.search);
                window.dispatchEvent(new HashChangeEvent('hashchange'));
              }
              sh.style.transition = ''; sh.style.transform = '';
            }, 200);
          } else {
            sh.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
            sh.style.transform = '';
            setTimeout(function () { if (!sh.style.transform) sh.style.transition = ''; }, 300);
          }
        };
        this.addEventListener('pointerup', end);
        this.addEventListener('pointercancel', end);
      }
    };
    window.hkHostClient.entry(MusicPane);
    customElements.define('hk-music-pane-card', MusicPane);
  }

  // ------------------------------------------------------------ the pane
  // the band's and the pane's scale: a 1280 x 800 tablet's layout, scaled up
  // whole on a bigger screen
  function scaleOf() {
    var W = window.innerWidth || 0, H = window.innerHeight || 0;
    if (!W) return 1;
    return Math.max(1, Math.floor(Math.min(W / BAND_W, (H || BAND_H) / BAND_H) * 100) / 100);
  }
  var PANE_VARS = ['--hk-pane-w', '--hk-ss-status-right', '--hk-ss-status-top', '--hk-ss-status-width', '--hk-pane-top',
                   '--hk-pane-bottom', '--hk-ss-now-left', '--hk-ss-now-max', '--hk-ss-now-bottom', '--hk-ss-np-art',
                   '--hk-ss-np-title', '--hk-ss-np-artist', '--hk-ss-np-gap', '--hk-ss-timers-left', '--hk-ss-timers-right',
                   '--hk-ss-timers-max', '--hk-ss-timers-bottom', '--hk-pane-pad', '--hk-pm-foot'];
  var paneT = null;
  // the pane is up now: the calendar's, or the music's while it plays
  var paneUp = false;
  // what the photos and the cards beside the pane take from it, let go as it
  // goes (the pane's own look stays while it fades)
  var PANE_OWN = ['--hk-pane-w', '--hk-pane-pad', '--hk-pane-top', '--hk-pane-bottom', '--hk-pm-foot'];
  function setPane(up) {
    if (!host) return;
    paneUp = !!up;
    setAttr(host, 'pane', paneUp);
    if (paneUp) {
      layoutPane();
      // what Home Status, the music and the timers take comes and goes with
      // the house: measured again every moment (a few rect reads)
      if (!paneT) paneT = setInterval(function () { if (on) paneStack(); }, 1500);
    } else {
      if (host.style.removeProperty) PANE_VARS.forEach(function (v) { if (PANE_OWN.indexOf(v) < 0) host.style.removeProperty(v); });
      paneW = 0;
      if (paneT) { clearInterval(paneT); paneT = null; }
    }
    // Home Status and the timers: into the pane or back to their corners;
    // the forecast details beside it or across
    cards.forEach(function (el) {
      if (el.__hkSaverConf) { try { el.setConfig(cardConf(el.__hkSaverConf, el.localName)); } catch (e) { /* as it was */ } }
    });
    if (fband && fband.isConnected && fband._config) {
      try { fband.setConfig(Object.assign({}, fband._config, { hours: paneUp ? 8 : 12, now_width: paneUp ? BAND_NOW_BESIDE : undefined })); } catch (e) { /* as it was */ }
      setTimeout(function () { if (fband && fband.isConnected) centerBand(fband); }, 350);
    }
  }
  // THE MUSIC IN THE PANE, there while music plays (or is paused), and
  // MU_GRACE after: under the calendar at once; alone, the pane comes and
  // goes with the next photo (over the forecast, at once)
  function musicIn(want) {
    if (!host || !cfg || !cfg.music_pane || want === mus.paneIn) return;
    mus.paneIn = want;
    setAttr(host, 'pm', want);
    musicTick();
    if (cfg.calendar) { paneStack(); return; }
    var photo = displayLayer && displayLayer.classList.contains('ph') && mode === 'photos' && !muShowing && !fcShowing;
    if (photo) mus.paneNext = want;
    else { mus.paneNext = null; setPane(want); }
  }
  function setupPane() {
    if (!host) return;
    var dropCal = function () {
      if (paneCard) { cards = cards.filter(function (c) { return c !== paneCard; }); paneCard.remove(); paneCard = null; }
    };
    mus.paneNext = null;
    if (!paneOf(cfg)) {
      host.removeAttribute('panecfg'); host.removeAttribute('pcal'); host.removeAttribute('pm');
      mus.paneIn = false;
      setPane(false);
      if (host.style.removeProperty) PANE_VARS.forEach(function (v) { host.style.removeProperty(v); });
      dropCal();
      musicPane(false);
      return;
    }
    host.setAttribute('panecfg', '');
    // THE CALENDAR ([pcal]) and THE MUSIC ([pm], while it plays) share it:
    // either fills it, both put the calendar above the music
    setAttr(host, 'pcal', cfg.calendar);
    // (playing, not paused: a song left paused does not bring the pane back
    // each time the screensaver starts)
    var c0 = cfg.music_pane ? musicNow(clientNow()) : null, playing = !!(c0 && c0.playing);
    mus.paneIn = playing; mus.lastActive = playing ? clock.now() : 0;
    setAttr(host, 'pm', playing);
    musicPane(cfg.music_pane);
    setPane(cfg.calendar || playing);
    if (!cfg.calendar) { dropCal(); return; }
    var tag = 'hk-calendar-pane-card', days = cfg.calendar_days;
    if (paneCard) {
      if ((paneCard._config || {}).days !== days) paneCard.setConfig({ type: 'custom:' + tag, days: days });
      return;
    }
    var make = function () {
      if (!host || !paneSc || paneCard || !cfg || !cfg.calendar) return;
      try {
        var el = document.createElement(tag);
        el.setConfig({ type: 'custom:' + tag, days: cfg.calendar_days });
        feedCard(el, clientNow());
        paneSc.appendChild(el);
        cards.push(el);
        paneCard = el;
        layoutPane();
      } catch (e) { console.warn('[hk-saver] calendar pane', e); }
    };
    if (customElements.get(tag)) make();
    else if (customElements.whenDefined) customElements.whenDefined(tag).then(make);
  }
  // its width and Home Status's place in it, for this screen (and again
  // every few seconds: a tablet turned, a window resized)
  function layoutPane() {
    if (!host || !paneUp) return;
    var z = scaleOf(), w = Math.round(PANE_W * z);
    // the list scaled with the screen (its card may arrive after the width)
    if (paneCard && (paneCard.style.zoom || '1') !== String(z)) paneCard.style.zoom = z === 1 ? '' : String(z);
    if (w === paneW && host.style.getPropertyValue && host.style.getPropertyValue('--hk-pane-w')) return;
    paneW = w;
    // a new width for the pane is a new room for the band beside it
    if (fband && fband.isConnected) setTimeout(function () { if (fband && fband.isConnected) centerBand(fband); }, 0);
    var px = function (n) { return Math.round(n * z) + 'px'; };
    host.style.setProperty('--hk-pane-w', w + 'px');
    // one margin for everything in the pane: the list, Home Status, its foot
    host.style.setProperty('--hk-pane-pad', px(28));
    // WHAT PLAYS AND THE TIMERS, in the pane's foot (hk-media.js,
    // hk-timers.js): on its 28 px margins, left-aligned with the list,
    // smaller than in a corner of the photos. Their left edge is measured
    // from the screen's RIGHT (100% of the screen-sized host, the box their
    // position:fixed resolves against), so a window resized or a screen
    // turned at the same scale -- the pane's width unchanged, this skipped --
    // leaves them in the pane, never where the old width put them.
    var footLeft = 'calc(100% - ' + (w - Math.round(28 * z)) + 'px)';
    host.style.setProperty('--hk-ss-now-left', footLeft);
    host.style.setProperty('--hk-ss-now-max', (w - Math.round(56 * z)) + 'px');
    host.style.setProperty('--hk-ss-np-art', px(64));
    host.style.setProperty('--hk-ss-np-title', px(20));
    host.style.setProperty('--hk-ss-np-artist', px(16));
    host.style.setProperty('--hk-ss-np-gap', px(14));
    host.style.setProperty('--hk-ss-timers-left', footLeft);
    host.style.setProperty('--hk-ss-timers-right', px(28));
    host.style.setProperty('--hk-ss-timers-max', (w - Math.round(56 * z)) + 'px');
    host.style.setProperty('--hk-ss-status-right', Math.round(28 * z) + 'px');
    host.style.setProperty('--hk-ss-status-top', Math.round(26 * z) + 'px');
    host.style.setProperty('--hk-ss-status-width', (w - Math.round(56 * z)) + 'px');
    paneStack();
  }
  // THE PANE'S LIST between Home Status (one line, or two or three when
  // much is open) and its foot (what plays above the running timers, each
  // only while there is one): measured, so nothing overlaps whatever shows
  function paneStack() {
    if (!host || !root || !paneUp) return;
    var z = scaleOf(), pad = Math.round(22 * z), gap = Math.round(14 * z);
    var hOf = function (tag, sel) {
      var el = null;
      for (var i = 0; i < cards.length; i++) if (cards[i].localName === tag) { el = cards[i]; break; }
      var n = el && el.shadowRoot && el.shadowRoot.querySelector(sel);
      if (!n || !n.getBoundingClientRect) return null;
      var r = n.getBoundingClientRect();
      return r.height > 1 ? r : null;
    };
    var st = hOf('hk-screensaver-status-card', '.sscorner');
    var np = hOf('hk-screensaver-now-card', '.sscorner');
    var tm = hOf('hk-timer-strip-card', 'div[style*="position:fixed"]');
    var tH = tm ? Math.round(tm.height) : 0, nH = np ? Math.round(np.height) : 0;
    var set = function (k, v) { if (host.style.getPropertyValue(k) !== v) host.style.setProperty(k, v); };
    set('--hk-pane-top', Math.max(Math.round(PANE_TOP * z), st ? Math.round(st.bottom + 16 * z) : 0) + 'px');
    set('--hk-ss-timers-bottom', pad + 'px');
    set('--hk-ss-now-bottom', (pad + (tH ? tH + gap : 0)) + 'px');
    var stack = nH + tH + (nH && tH ? gap : 0);
    set('--hk-pane-bottom', (stack ? stack + pad + Math.round(18 * z) : 0) + 'px');
    // THE MUSIC IN THE PANE: over the timers (the now-playing row steps
    // aside for it); under the calendar, as tall as it is, the list above it
    var pm = musicPaneView();
    if (pm) {
      set('--hk-pm-foot', (pad + (tH ? tH + gap : 0)) + 'px');
      // (the music's own part: its background is the whole pane)
      var body = pm.el.querySelector('.mbody');
      if (cfg.calendar && host.hasAttribute('pm')) set('--hk-pane-bottom', ((body && body.offsetHeight) || 0) + 'px');
    }
  }

  // the weather band: today's conditions, the next hours and the coming days
  function addBand(box) {
    var tag = 'hk-weather-band-card';
    var make = function () {
      if (!host || !box.isConnected) return;
      var h = clientNow(), HS = window.hkSettings;
      var wid = h && HS && HS.weatherId ? HS.weatherId(h.states) : null;
      if (!wid) return;
      try {
        var el = document.createElement(tag);
        // beside the calendar pane: today beside the hours and days, as on
        // the other screens, its column slimmer and fewer hours
        el.setConfig({ type: 'custom:' + tag, entity: wid, hours: paneUp ? 8 : 12, days: 6, plain: true,
                       now_width: paneUp ? BAND_NOW_BESIDE : undefined });
        feedCard(el, h);
        // NOT SEEN UNTIL IT IS IN PLACE: it can only be centred once it has
        // drawn (centerBand measures it), so it drew ~25 px off and jumped
        // a quarter second into the slide -- and beside the calendar pane
        // again when it redrew for its width (2026-10-01). Hidden until it is
        // where it stays, then faded in.
        el.style.opacity = '0';
        box.appendChild(el);
        cards.push(el);
        fband = el;
        var placed = function () {
          if (fband !== el || !el.isConnected) return;
          centerBand(el);
          el.style.transition = 'opacity ' + BAND_REVEAL_MS + 'ms ease';
          el.style.opacity = '';
          el.__hkPlaced = true;
          if (entrance) entrance();               // the fade may begin now
        };
        // centred as soon as it has drawn, not at the next tick -- beside the
        // pane once more after it has redrawn for its width
        setTimeout(function () {
          if (fband !== el || !el.isConnected) return;
          centerBand(el);
          setTimeout(placed, paneUp ? 400 : 0);
        }, 250);
      } catch (e) { console.warn('[hk-saver] forecast band', e); }
    };
    if (customElements.get(tag)) make();
    else if (customElements.whenDefined) customElements.whenDefined(tag).then(make);
  }
  // SIDE TO SIDE BY WHAT IS DRAWN, not by the card's box: its left column
  // is a fixed 300 px with today's stack centred in it, and its hours and
  // days are centred in their cells, so the box centred leaves more empty
  // screen on the left than on the right. The text's own left and right
  // edges are measured and the band shifted until the two margins match.
  function centerBand(card) {
    var sr = card.shadowRoot, W = window.innerWidth || 0, H = window.innerHeight || 0;
    if (!sr || !W) return;
    // THE PANE'S WIDTH FIRST: centred before the pane had measured itself,
    // the band was centred on the whole screen and ran under the pane
    if (paneUp && !paneW) layoutPane();
    // the scale first (a bigger screen: the tablet's band, bigger) -- CSS
    // zoom, so it lays out as on the tablet and takes its scaled room
    var z = scaleOf();
    if (String(z) !== (card.style.zoom || '1')) card.style.zoom = z === 1 ? '' : String(z);
    // BESIDE THE CALENDAR PANE: the photos' (the land's) width is the room,
    // the band stands up no wider than BAND_STACKED, and its zone is the
    // meadow of the land as it covers that narrower box
    var RW = W - (paneUp ? paneW : 0), box = card.parentNode;
    if (box && box.style) {
      if (paneUp) {
        box.style.height = Math.round(Math.max(0.356 * H, 0.2225 * RW)) + 'px';
        box.style.padding = '';
        var mw = Math.max(BAND_STACKED, Math.round(RW / z) - 2 * BAND_BESIDE_GUTTER) + 'px';
        if (card.style.maxWidth !== mw) {
          card.style.maxWidth = mw;
          // the band redraws its columns for the new width a moment later
          // (its own ResizeObserver): centre it again once it has
          setTimeout(function () { if (fband === card && card.isConnected) centerBand(card); }, 350);
        }
      } else {
        box.style.height = ''; box.style.padding = ''; card.style.maxWidth = '';
      }
    }
    var lo = Infinity, hi = -Infinity;
    sr.querySelectorAll('.now > *, .cell > *').forEach(function (e) {
      var q = e.getBoundingClientRect();
      if (q.width) { lo = Math.min(lo, q.left); hi = Math.max(hi, q.right); }
    });
    if (!(hi > lo)) return;
    var cur = parseFloat(card.style.getPropertyValue('--hk-band-shift')) || 0;
    // (the shift is in the band's own pixels, which the zoom scales)
    var want = Math.round(cur + ((RW - hi) - lo) / 2 / z);
    if (Math.abs(want - cur) >= 1) card.style.setProperty('--hk-band-shift', want + 'px');
  }
  // KIOSK SATELLITE'S DARK. Its API is promise-based, so it cannot be asked
  // inline the way Fully is below; it announces its screensaver and the panel
  // power as window events instead, and these follow them. Its screensaver
  // usually also hides the page (Pause dashboard during screensaver), but
  // that is a setting, so the events are the fact.
  // (Listened for on any page: nothing else fires them.)
  var ksSaver = false, ksOff = false, hkOn = false;
  // UNDER A BLACK: the kiosk's Black screensaver, its panel off, or HK's own
  // (Black Screen: HK Frontend, below)
  function black() { return ksSaver || ksOff || hkOn; }
  var wasBlack = false, downOpts = null;
  function blackChanged() {
    var now = black();
    if (now === wasBlack) return;
    wasBlack = now;
    if (now) { downOpts = null; curtainUp(); goDark(); }
    else { var d = downOpts; downOpts = null; lit(); lightSoon(); litNow(); curtainDown(d); }
    tellBlack(now);
  }
  // THE SKY AND THE CAMERA STRIP REST UNDER ANY BLACK (hk-sky.js,
  // hk-cameras.js) -- ONCE THE CURTAIN IS ON THE SCREEN (2026-10-09). Told at
  // once, the strip let go of its live video in the same moment: the video's
  // own layer went at once, and the tile showed white for five frames before
  // the frame with the curtain came (screen-recorded on the Loft, HK's black).
  // So "on" waits two frames and a little (BLACK_TELL_MS; a page not drawing
  // -- hidden -- by BLACK_TELL_MAX); "off" is told at once.
  var blackTold = false, blackTellRun = 0, BLACK_TELL_MS = 50, BLACK_TELL_MAX = 300;
  function tellBlack(on) {
    var run = ++blackTellRun, sent = false;
    var send = function () {
      if (sent || run !== blackTellRun) return;
      sent = true;
      if (blackTold === on) return;
      blackTold = on;
      try { window.dispatchEvent(new CustomEvent('hk-black', { detail: { on: on } })); } catch (e) { /* no window events */ }
    };
    if (!on || typeof requestAnimationFrame !== 'function') { send(); return; }
    requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(send, BLACK_TELL_MS); }); });
    setTimeout(send, BLACK_TELL_MAX);
  }
  window.addEventListener('kiosksatellite:screensaverstart', function () { ksSaver = true; blackChanged(); });
  window.addEventListener('kiosksatellite:screensaverstop', function () { ksSaver = false; blackChanged(); });
  window.addEventListener('kiosksatellite:screenoff', function () { ksOff = true; blackChanged(); });
  window.addEventListener('kiosksatellite:screenon', function () { ksOff = false; blackChanged(); });
  // OUR OWN CURTAIN UNDER THE KIOSK'S BLACK (2026-10-09). As the black
  // comes down the tablet draws the whole page again, and its largest layers
  // -- the sky's scenery -- arrive two or three frames after the rest: the
  // bottom of the screen showed bare sky for a moment (screen-recorded on the
  // Loft, at a fixed 60 Hz, two wakes in five). So a plain black layer goes
  // up over everything as the kiosk's black does -- one solid color, nothing
  // to draw late -- and comes away only once the page has drawn: two frames,
  // CURTAIN_HOLD, then a CURTAIN_FADE fade. Never held longer than
  // CURTAIN_MAX after the black ends, frames or none.
  //
  // IT IS ALSO HK'S OWN BLACK SCREEN (Black Screen: HK Frontend, below): it
  // then catches taps (a tap wakes the screen, and is swallowed -- the card
  // under it is not pressed), and as it fades the backlight comes up with it
  // (onFade). Out of HK's own black it comes down sooner, CURTAIN_HOLD_HK: the
  // page was drawn under it all along.
  var curtain = null, curtainRun = 0, CURTAIN_HOLD = 300, CURTAIN_HOLD_HK = 60, CURTAIN_FADE = 450, CURTAIN_MAX = 2000;
  function curtainUp() {
    curtainRun++;
    if (drawCurtain()) bootCover(false);
  }
  // the curtain on the page, opaque, now
  function drawCurtain() {
    if (!document.body || typeof document.createElement !== 'function') return false;
    if (!curtain) {
      curtain = document.createElement('div');
      curtain.setAttribute('data-hk-curtain', '');
      if (curtain.addEventListener) curtain.addEventListener('pointerdown', curtainTapped, true);
    }
    var cs = curtain.style;
    cs.position = 'fixed'; cs.inset = '0'; cs.top = cs.left = '0'; cs.width = '100vw'; cs.height = '100vh';
    cs.zIndex = '2147483647'; cs.background = '#000'; cs.pointerEvents = hkOn ? 'auto' : 'none';
    cs.transition = 'none'; cs.opacity = '1';
    if (curtain.parentNode !== document.body) document.body.appendChild(curtain);
    return true;
  }
  // `opts`: { hold: ms after two frames, onFade: called as the fade starts }
  function curtainDown(opts) {
    opts = opts || {};
    if (black()) return;
    // no curtain to fade (a page that never drew one): the backlight all the same
    if (!curtain || !curtain.parentNode) { if (opts.onFade) { try { opts.onFade(); } catch (e) { /* none */ } } return; }
    var run = ++curtainRun, c = curtain, going = false;
    var go = function () {
      if (going || run !== curtainRun) return;
      going = true;
      c.style.transition = 'opacity ' + CURTAIN_FADE + 'ms ease';
      c.style.opacity = '0';
      if (opts.onFade) { try { opts.onFade(); } catch (e) { /* the curtain goes all the same */ } }
      // a tap still catching it is swallowed until it is gone
      setTimeout(function () { if (run === curtainRun && c.parentNode) c.remove(); }, CURTAIN_FADE + 80);
    };
    setTimeout(go, CURTAIN_MAX);
    if (typeof requestAnimationFrame !== 'function') return;
    var f1 = false, f2 = false;                // each frame's step once
    requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
      if (f2) return; f2 = true;
      setTimeout(go, opts.hold != null ? opts.hold : CURTAIN_HOLD);
    }); });
  }
  function curtainTapped(e) {
    if (!hkOn) return;
    if (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
    hkTapWake();
  }

  // ------------------------------------------------------------ HK's own black
  // BLACK SCREEN: HK FRONTEND (2026-10-09; a screen's When Idle -> Black
  // Screen). In place of Kiosk Satellite's Black screensaver, the screen's
  // black is this page's: the curtain over everything, the sky and the cards
  // held, and the backlight at its lowest (Kiosk Satellite's page API --
  // setBrightness(0) is the same minimum its own black uses, measured). The
  // house turns switch.<screen>_black_screen on and off
  // (hk_frontend.set_black_screen, which also carries the brightness to come
  // back to); the page says when it is black (the sleep waits for that, and
  // falls back to Kiosk's black without it), and a tap on the curtain wakes
  // it at once, here, and turns the switch off. Only on the screen's own
  // tablet, as for the photos: a desk showing the same screen never goes
  // black. docs/TABLET-INVARIANTS.md 16p.
  var hkRun = 0, hkAcked = false, hkDown = false, hkAckTry = 0, hkWokeAt = 0, HK_WOKE_HOLD = 6000, hkFirst = true;
  var BLACK_KEY = 'hk-black', BRIGHT_KEY = 'hk-black-bright';
  function dashSeg() { return String(location.pathname).split('/')[1] || ''; }
  function rememberedTabletId() { try { return localStorage.getItem('hk-tablet') || ''; } catch (e) { return ''; } }
  // WHAT THE BLACK READS: this page's tablet's Black Screen and switch
  // (1.14; before, the screen's -- hkSettings.tablet() reads those then)
  function hkBoard() { return tabletNow(); }
  // BLACK OR NOT -- OR NOT KNOWN YET (null): a page loading has its settings,
  // its screensaver's config, its user and the switch arrive one by one, and
  // "not known" is not "not black". Read as no, a page reloaded under its
  // black (the 00:02 app restart, a cache clear) faded its cover, showed
  // the dashboard, then went black again a moment later (the Loft,
  // 2026-10-09). Until it can tell, nothing changes: the cover stays.
  function hkWanted(h) {
    var HS = window.hkSettings, live = !!(HS && HS.live);
    // the tablet is known by its user (or its address): until the user is
    // there, not known -- a cover over a reload stays
    if (!user() && !(HS && HS.tablet && rememberedTabletId())) return null;
    var b = hkBoard();
    if (!b) return live ? false : null;
    if (b.black_screen !== 'hk') return false;
    // only on the screen's own tablet, as for the photos
    if (framed || previewOn || force) return false;
    if (/[?&](hk_saver|wp_enabled)=(force|off|false)\b/.test(location.search)) return false;
    if (!b.black_switch) return live ? false : null;
    if (!cfg) return null;
    if (!mine()) return false;
    // woken by a tap a moment ago: the switch is on its way off
    if (clock.now() - hkWokeAt < HK_WOKE_HOLD) return false;
    var st = h && h.states && h.states[b.black_switch];
    return st ? st.state === 'on' : null;
  }
  function kiosk() { return window.kioskSatellite || null; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) { /* no storage */ } }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setBacklight(v) {
    var k = kiosk();
    if (!k || typeof k.setBrightness !== 'function') return;
    try { Promise.resolve(k.setBrightness(v)).catch(function () { /* the kiosk said no */ }); } catch (e) { /* the kiosk said no */ }
  }
  // the backlight up to `v` (0-1) over `ms`, with the curtain's fade
  var rampRun = 0, rampAt = 0;
  function rampBacklight(v, ms) {
    var run = ++rampRun, steps = 6;
    rampAt = 0;
    for (var i = 1; i <= steps; i++) {
      (function (i) {
        setTimeout(function () {
          // each step once, and only ever up
          if (run !== rampRun || i <= rampAt) return;
          rampAt = i;
          setBacklight(+(v * i / steps).toFixed(3));
        }, Math.round(ms * (i - 1) / steps));
      })(i);
    }
  }
  // what to come back to: the house's (the switch's brightness, 0-255),
  // else what it was before this black
  function wakeBrightness(h) {
    var b = hkBoard(), st = b && h && h.states && h.states[b.black_switch];
    var a = st && st.attributes && st.attributes.brightness;
    if (typeof a === 'number' && a >= 0) return Math.max(0.004, Math.min(1, a / 255));
    var saved = parseFloat(stored(BRIGHT_KEY));
    return isFinite(saved) && saved > 0 ? saved : null;
  }
  function hkUnheard(h) {
    var b = hkBoard(), st = b && b.black_switch && h && h.states && h.states[b.black_switch];
    return !!(st && st.state === 'on' && st.attributes && st.attributes.confirmed === false);
  }
  function hkAck(on) {
    var t = hkBoard();
    sendWS(t && !t.legacy ? { type: 'hk_frontend/screensaver/black', tablet: t.id, black: on }
                          : { type: 'hk_frontend/screensaver/black', dashboard: dashSeg(), black: on })
      .then(function () { if (on) hkAcked = true; }, function () { /* older integration: the sleep falls back */ });
  }
  // black: once the curtain is drawn, the backlight down, then say so
  function hkDarken() {
    var run = ++hkRun, done = false;
    var go = function () {
      if (done || run !== hkRun || !hkOn) return;
      done = true;
      var k = kiosk(), down = function () { if (run === hkRun && hkOn) { setBacklight(0); hkDown = true; hkAckTry = clock.now(); hkAck(true); } };
      if (k && typeof k.getBrightness === 'function') {
        try {
          Promise.resolve(k.getBrightness()).then(function (b) {
            // (a page reloaded while black reads its own minimum: keep the one before)
            if (typeof b === 'number' && b > 0.02) store(BRIGHT_KEY, b);
          }, function () {}).then(down);
        } catch (e) { down(); }
      } else down();
    };
    setTimeout(go, 600);
    if (typeof requestAnimationFrame !== 'function') { go(); return; }
    var f1 = false;
    requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(go); });
  }
  function hkLeave(h) {
    hkRun++; hkAcked = false; hkDown = false;
    store(BLACK_KEY, null);
    var v = wakeBrightness(h);
    // kept until the black really ends: under the kiosk's black as well (the
    // house's fallback), the backlight comes up as THAT one comes down
    downOpts = { hold: CURTAIN_HOLD_HK, onFade: function () { if (v != null) rampBacklight(v, CURTAIN_FADE); } };
    blackChanged();
  }
  // every new client and every settings change
  function hkSync(h) {
    h = h || clientNow();
    var want = hkWanted(h);
    if (want === null) return;                 // not known yet: as it is
    var first = hkFirst;
    hkFirst = false;
    if (want === hkOn) {
      // black, but not yet heard by the house (the connection was not up):
      // say so again, every few seconds
      if (want && hkDown && !hkAcked && clock.now() - hkAckTry > 3000) { hkAckTry = clock.now(); hkAck(true); }
      // ...or the house no longer has it (its server restarted, and the black came again while this page
      // was already black, 2026-10-21): the switch says unconfirmed, so say it again, every few seconds
      else if (want && hkDown && hkUnheard(h) && clock.now() - hkAckTry > 3000) { hkAckTry = clock.now(); hkAck(true); }
      // a page loaded under a black that is no longer wanted: the cover
      // fades, and the backlight the last page lowered comes back with it
      if (first && !want) bootCover(true, h);
      return;
    }
    hkOn = want;
    if (want) { store(BLACK_KEY, dashSeg()); blackChanged(); if (curtain) curtain.style.pointerEvents = 'auto'; hkDarken(); }
    else hkLeave(h);
  }
  // a tap on the curtain: awake now, here -- the house hears it from the
  // switch going off and from the touch
  function hkTapWake() {
    if (!hkOn) return;
    hkWokeAt = clock.now();
    hkOn = false;
    hkAck(false);
    touchSent = 0; reportTouch();
    lastInput = Date.now();
    hkLeave(clientNow());
  }
  // THE BLACK THROUGH A RELOAD: hk-settings.js puts a cover up at once on a
  // page that was black (BLACK_KEY); here it gives way to the curtain --
  // removed under it, or, when the black is no longer wanted, swapped for it
  // and faded out. Never kept AS the curtain: it keeps its id (the next
  // black's bootCover(false) would remove it) and its 30 s backstop.
  function bootCover(fade, h) {
    var el = document.getElementById && document.getElementById('hk-black-boot');
    if (!el) return;
    if (!fade || (curtain && curtain.parentNode)) { el.remove(); return; }
    curtainRun++;
    var drawn = drawCurtain(), v = wakeBrightness(h);
    el.remove();
    if (drawn) curtainDown({ hold: 0, onFade: function () { if (v != null) rampBacklight(v, CURTAIN_FADE); } });
  }
  try {
    var HS0 = window.hkSettings;
    if (HS0 && HS0.onChange) HS0.onChange(function () { hkSync(); });
  } catch (e) { /* no settings module (a test harness) */ }
  // UNDER THE KIOSK'S BLACK, BLACK (2026-10-09). The tablet stops drawing
  // the page under it and, as it comes down, shows the last frame the page
  // drew until the page draws again: the photos as they were when the
  // tablet slept -- a stale photo flashed before the fade to the dashboard
  // (screen-recorded on the Living Room tablet, 0.9 s of it). So the
  // screensaver goes plain black at once, its photos out of sight. The
  // dashboard is NOT let go under it (and a pending cover is dropped): one
  // hidden there is drawn again from nothing as the black comes down.
  // BLACK WHILE IT WAS STILL STARTING: never really shown -- still getting
  // ready, or fading in for under SHOWN_MIN. The house's sleep turns the
  // photos on 0.1-0.2 s before the black goes up; turned black, a start
  // like that left the tablet showing the dashboard it had drawn, yet the
  // wake went through black: dashboard, black, dashboard (screen-recorded on
  // the Loft, a real sleep). Such a start is taken back instead, as if it
  // had never begun, and asks again once the black has ended (start()).
  var shownAt = 0, SHOWN_MIN = 500;
  function unstart() {
    on = false; entrance = null; photoRun++; busy = false; queued = null; lightRun++;
    if (coverT) { clearTimeout(coverT); coverT = null; }
    if (slideT) { clearTimeout(slideT); slideT = null; }
    teardown();
    tellOthers();
  }
  // UNDER THE KIOSK'S BLACK, THE DASHBOARD COMES BACK -- whatever had been
  // shown (2026-10-09, with Kiosk Satellite's "Pause dashboard during
  // screensaver" OFF on every tablet). Off, the tablet keeps the page it
  // drew and still draws for ~2 s after the black goes up, so the
  // screensaver taken down there leaves a whole, drawn dashboard to wake
  // onto. Kept up (dark) instead, it was put away at the wake itself, the
  // one moment a tablet cannot draw in time: a half-drawn dashboard, then
  // black, then the fade (screen-recorded on the Loft). The photos come back
  // after the black ends if they are still wanted (start(): LIT_GRACE).
  var DARK_UNDER_BLACK = false;
  function goDark() {
    if (!on || !host) return;
    if (!DARK_UNDER_BLACK || host.hasAttribute('prep') || !shownAt || clock.now() - shownAt < SHOWN_MIN) { unstart(); return; }
    entrance = null; lightRun++;
    host.style.setProperty('--fade', '0ms');
    host.style.setProperty('--blk', '0ms');
    host.removeAttribute('prep');
    host.removeAttribute('undark');
    host.setAttribute('dark', '');
    host.setAttribute('on', '');
    if (coverT) { clearTimeout(coverT); coverT = null; }
    noteDrawn();
  }
  // ...and as it ends. The house's wake turns the photos off under the
  // black, and stop() fades from black to the dashboard. Still on after
  // LIGHT_WAIT (a tap ended the black, and the house -- which turns the
  // photos off within 2 s of a tap -- still wants them): the photos come
  // back out of the black, drawn under .blk for two frames, then its fade
  // off them. Not sooner: the photos for a moment, then the dashboard, was
  // a flash of the wrong thing.
  var LIGHT_WAIT = 2500, LIGHT_FADE = 600, lightRun = 0;
  // THE BLACK HAS ENDED: as good as a touch (no screensaver straight back by
  // idle), and the switch is heard again after LIT_GRACE (start())
  var LIT_GRACE = 2500, litAt = 0;
  function litNow() {
    if (black()) return;
    litAt = clock.now();
    lastInput = Date.now();
    armIdle();
    setTimeout(function () { var h = clientNow(); if (h && !on) onUpdate(h); }, LIT_GRACE + 50);
  }
  function lightSoon() {
    if (black() || !on || !host || !host.hasAttribute('dark')) return;
    var h = host, run = ++lightRun;
    var still = function () { return !black() && on && host === h && lightRun === run && h.hasAttribute('dark'); };
    setTimeout(function () {
      if (!still()) return;
      h.setAttribute('undark', '');
      var f1 = false, f2 = false;           // each frame's step once
      requestAnimationFrame(function () { if (f1) return; f1 = true; requestAnimationFrame(function () {
        if (f2) return; f2 = true;
        if (!still()) return;
        h.style.setProperty('--blk', LIGHT_FADE + 'ms');
        h.removeAttribute('dark');
        h.removeAttribute('undark');
        noteDrawn();
      }); });
    }, LIGHT_WAIT);
  }
  // Every few seconds: the sky follows the sun and the weather; it holds still
  // while the screen is dark (the kiosk's own screensaver or screen off --
  // the page cannot tell, so Fully is asked and Kiosk Satellite is listened
  // to -- or a hidden page); and the corner rows stay above the band.
  function forecastTick(force) {
    var h = clientNow();
    if (fscene && h && h.states) {
      var HS = window.hkSettings, sun = h.states['sun.sun'];
      var wid = HS && HS.weatherId ? HS.weatherId(h.states) : null, w = wid && h.states[wid];
      var sig = (sun ? sun.last_updated : '') + '|' + (w ? w.last_updated : '') + '|' + Math.floor(Date.now() / 600000);
      if (force || sig !== fSig) {
        fSig = sig;
        try { fscene.update(h); } catch (e) { console.warn('[hk-saver] forecast sky', e); }
      }
    }
    var F = window.fully, dark = !!document.hidden || black();
    try {
      if (F && ((typeof F.isInScreensaver === 'function' && F.isInScreensaver()) ||
                (typeof F.getScreenOn === 'function' && F.getScreenOn() === false))) dark = true;
    } catch (e) { /* no Fully interface */ }
    // not on screen (between forecast slides) holds still too
    if (fscene) fscene.pause(dark || !fcVisible());
    layoutPane();
    if (enShowing) energyLayout();
    if (wxShowing) weatherLayout();
    // The band is measured and centred only while it shows: it was every
    // tick (~20 rects each) for the whole of a Photos & Forecast session,
    // between forecast slides and under the black as well. Shown again, it
    // is centred at once (showForecastSlide / enterForecast force a tick).
    if (host && root) {
      var b = !dark && host.hasAttribute('band') && fband && fband.isConnected ? fband : null;
      var r = b && b.getBoundingClientRect();
      if (b) centerBand(b);
      if (b && r && r.height) host.style.setProperty('--hk-ss-corner-bottom', Math.round((window.innerHeight || 0) - r.top + 18) + 'px');
      else if (!dark && host.style.removeProperty) host.style.removeProperty('--hk-ss-corner-bottom');
    }
  }

  // ------------------------------------------------------------ the loop
  // The config follows the page: on each view change, and on each new client
  // (cheap -- a property read, and the dashboard config object is the same
  // object until the dashboard changes).
  // A DASHBOARD HK FRONTEND DOES NOT DRAW (an existing dashboard given HK
  // settings) has no hk_screensaver in its config: its screen's settings
  // make the same block (hk-strategy.js saverBlock). Its own YAML's
  // hk_screensaver -- or a WallPanel block -- always wins.
  function fromSettings(conf) {
    if (!conf || conf.wallpanel) return null;
    var HS = window.hkSettings, S = window.hkStrategy;
    var all = HS && HS.get ? HS.get('boards', null) : null;
    var b = all && all[String(location.pathname).split('/')[1] || ''];
    return b && b.screensaver && S && S.saverBlock ? S.saverBlock(clientNow(), b) : null;
  }
  // compared as written: a block made from the settings is a new object
  // every time
  var lastRaw = '';
  function refresh() {
    var conf = dashConf();
    var raw = conf && conf.hk_screensaver;
    if (conf && raw === undefined) raw = fromSettings(conf);
    // A HOST WITH NO LOVELACE drew the screen from the strategy once, at its
    // load: the block it made then names the tablet's switch only if that
    // switch's state was already there (hk-strategy.js screensaverOf), and
    // Mantel's own arrive a moment after its settings. The settings make the
    // same block again, now -- else the one the strategy made.
    else if (shellConf && raw && !raw.entity) raw = fromSettings(conf) || raw;
    if (previewOn && previewHouse) raw = houseBlock() || raw;
    var HS = window.hkSettings;
    if (HS && HS.lovelacePanel && HS.lovelacePanel() === false) raw = null;
    // the host's own album for this screen, in place of the house's photos
    // (hostPhotoSource; none in Home Assistant)
    var ownPhotos = raw ? hostPhotoSource(raw.photos) : null;
    if (ownPhotos && ownPhotos !== raw.photos) raw = Object.assign({}, raw, { photos: ownPhotos });
    // Derive effective options without changing any saved screensaver choice.
    if (raw && isFlat()) raw = Object.assign({}, raw, {
      zoom: false, photo_layout: 'single', portrait_blur: 0, landscape_blur: 0,
      portrait_dim: 0, landscape_dim: 0, portrait_zoom: 100, landscape_zoom: 100,
      clock_style: 'classic', clock_bg: ['photos','landscapes','black'].indexOf(raw.clock_bg) >= 0 ? raw.clock_bg : 'black',
      clock_motion: 'still', clock_speed: 0, clock_depth: 0, clock_photo_soft: false,
      clock_text_shadow: 0, clock_text_outline: 0
    });
    var key = raw ? JSON.stringify(raw) + '|' + isFlat() : '';
    if (key !== lastRaw) {
      lastRaw = key;
      var was = cfg;
      cfg = readCfg(raw);
      if (was && on && !previewOn && cfg) { var reason = startedBy; stop('appearance'); teardown(); start(reason); }
      // the preview follows the settings page: rebuilt with the new options
      // -- or, when only the photos' layout changed, laid out again in place
      if (previewOn && on && cfg) {
        // ...or only the clock's face changed (its style, 24-hour): drawn again
        // where it is, no fade out and in -- a style can be judged as chosen
        if (was && sansShapes(was) === sansShapes(cfg) && relayout()) { /* laid out again */ }
        else if (was && sansClock(was) === sansClock(cfg) && remountClock()) { /* the clock again */ }
        else setTimeout(restartPreview, 0);
      }
      // ...and a preview asked for before there was a config (the frame's
      // dashboard, or its settings, still arriving) starts once there is one
      if (previewOn && !on && cfg) setTimeout(function () { if (previewOn && !on && cfg) start('preview'); }, 0);
      // turned off while it shows: its switch goes off too (stop('config') alone left it on, and turning the
      // screensaver back on started it at once, "by the switch", instead of after Starts After)
      if (!cfg && on) { writeSwitch('off', was); stop('config'); }
      if (deck && cfg && deck.order !== cfg.order) deck = null;
      // a new Starts After counts from the last touch now, not when the old (longer) timer runs out
      if (was && cfg && !on && idleT) armIdle();
    }
    if (!cfg) { if (idleT) { clearTimeout(idleT); idleT = null; } return; }
    if (!allowed()) { if (on) { writeSwitch('off'); stop('config'); } if (idleT) { clearTimeout(idleT); idleT = null; } return; }
    if (!idleT && !on) armIdle();
  }
  var refreshedAt = 0;
  function refreshSoon() {
    // on every update (~40 a second in a busy house) the switch is checked, but
    // the config only every 2 s: it changes when the dashboard does
    var now = Date.now();
    if (now - refreshedAt < 2000) return;
    refreshedAt = now;
    refresh();
  }
  window.addEventListener('hk-module-ready', function (e) {
    if (e.detail && e.detail.module === 'hk-settings') { refresh(); mus.views.forEach(function (v) {
      var flat = isFlat();
      if (v.flat === flat) return;
      v.flat = flat;
      if (flat) v.bg.forEach(function (c) { clearCanvas(c); c.remove(); });
      else v.bgf.forEach(function (f) { var c = document.createElement('canvas'); c.className = 'mbg'; c.width = MU_BG; c.height = MU_BG; f.appendChild(c); });
      v.bg = v.el.querySelectorAll('canvas.mbg'); v.pic = null;
    }); renderMusic(); }
  });
  window.hkShell.onNavigate(function () { setTimeout(refresh, 0); });
  window.addEventListener('popstate', function () { setTimeout(refresh, 0); });
  window.addEventListener('resize', function () { if (on) { layoutPane(); layoutMusic(); placePanel(); } });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { lastInput = Date.now(); armIdle(); resumedAt = clock.now(); }
    musicTick();
  });
  // A FROZEN PAGE. Kiosk Satellite's Black screensaver stops the tablet
  // DRAWING the page but not running it (traced 2026-10-09: its events, the
  // house's messages and the timers all arrive under it; goDark and
  // afterDraw handle that). A page the system has frozen outright -- an app
  // sent to the background, a device asleep -- gets everything the house
  // did meanwhile in one burst as it comes back. Whether the page is just
  // back: a heartbeat that went quiet, or a visibility change, in the last
  // RESUME_MS. (The heartbeat gap catches a message handled before the
  // timer that would have noticed.)
  // (`clock`: the tests drive it; the page reads the wall clock)
  var RESUME_MS = 2500, clock = { now: function () { return Date.now(); } };
  var resumedAt = 0, lastBeat = clock.now();
  function beat() {
    var n = clock.now();
    if (n - lastBeat > RESUME_MS) resumedAt = n;
    lastBeat = n;
  }
  setInterval(beat, 1000);
  function justResumed() {
    var n = clock.now();
    return n - resumedAt < RESUME_MS || n - lastBeat > RESUME_MS;
  }
  var hubOff = null;
  function hookClient() {
    if (hubOff || !(window.hkCards && window.hkCards.onClient)) return false;
    hubOff = window.hkCards.onClient(function (h) { refreshSoon(); onUpdate(h); if (on) musicWatch(); });
    if (window.hkMusic && window.hkMusic.onChange) window.hkMusic.onChange(function () {
      if (on) { mus.watchAt = 0; musicWatch(); }
    });
    return true;
  }
  // hk-base (the cards) loads after this module; until it does, poll lightly
  (function wait(n) {
    refresh();
    var h = clientNow();
    if (h) onUpdate(h);
    if (hookClient()) return;
    setTimeout(function () { wait(n + 1); }, n < 60 ? 1000 : 5000);
  })(0);

  window.hkSaver = {
    running: function () { return on; },
    covered: function () { return on && !!coveredPage; },
    // the forecast is what is showing (not photos)
    forecast: function () { return on && mode === 'forecast'; },
    // HK Settings' preview frame: show it now and keep it up; false takes it away
    // `shape`: 'portrait' or 'landscape' -- a photo of that shape (the
    // Portrait / Landscape Photos settings), held while they change
    // `house`: with All Screens' settings, not this screen's own
    // 'energy': Home Energy, held while its options change; 'weather': the weather
    preview: function (v, shape, house) {
      var sh = shape === 'portrait' || shape === 'landscape' ? shape : null, en = shape === 'energy', wx = shape === 'weather';
      previewHouse = !!(v && house);
      if (sh !== previewShape || en !== previewEnergy || wx !== previewWeather) {
        previewShape = sh; previewEnergy = en; previewWeather = wx;
        if (lastPh && sh && shapeOfPh(lastPh) !== sh) lastPh = null;
        if (previewOn && on && v) setTimeout(restartPreview, 0);
      }
      previewOn = !!v;
      if (!previewOn) lastPh = null;
      force = previewOn;
      refresh();
      if (previewOn && !on) start('preview');
      else if (!previewOn && on && startedBy === 'preview') stop('manual');
      return previewOn;
    },
    // Console / probe helpers. hkSaver.start() shows it now; stop() takes it
    // away (as a touch would, but without writing the switch).
    start: function () { refresh(); return start('manual'); },
    stop: function () { return stop('manual'); },
    // as a tap that wakes it would (the switch written): a notification that
    // wakes the screen, one that opens a camera (hk-notify.js)
    wake: function () { return stop('touch'); },
    // somebody is using it (a notification's banner over it)
    touched: function () { saverTouched(); },
    // the screen is dark (Kiosk's screensaver or display off, HK's black)
    black: function () { return black(); },
    next: nextPhoto,
    previous: previousPhoto,
    force: function (v) { force = !!v; refresh(); return force; },
    // THE HOST'S PHOTOS CHANGED (a screen's album, an album's photos): listed
    // again at the next photo, and the source asked again now
    photosChanged: function () { listKey = ''; refresh(); },
    config: function () { return cfg; },
    // what plays for the dashboard's Now Playing pane (hk-popup.js): there
    // (playing or paused), and playing
    music: { has: musicHas, playing: function (h) { var c = musicNow(h || clientNow()); return !!(c && c.playing); } },
    stats: function () {
      return { on: on, startedBy: startedBy, allowed: allowed(), photos: deck ? deck.items.length : null,
               shown: shown, failed: failed, last: lastPhoto, cards: cards.length,
               idleIn: cfg && !on && cfg.starts_after ? Math.max(0, Math.round((lastInput + cfg.starts_after * 1000 - Date.now()) / 1000)) : null,
               blocking: !!(press && host), switch: switchState(),
               waking: !!(host && host.hasAttribute('waking')), fadeBack: cfg ? cfg.fade_back : null,
               mode: on ? mode : null, clock: ckCtl ? ckCtl.style : null, clockColor: ckCtl ? ckCtl.color : null, night: !!(host && host.hasAttribute('cknight')), mosaic: moState && displayLayer === moState.layer ? { n: moState.n, idx: moState.idx, left: moState.left } : null, clockOver: !!(host && host.hasAttribute('ckphotos')) ? 'photos' : null, land: fscene && fscene.landShown ? fscene.landShown() || null : null,
               forecastSlide: on && fcShowing, sinceForecast: sinceFc, preview: previewOn, previewShape: previewShape,
               shown_shape: lastPh ? shapeOfPh(lastPh) : null, shown_url: lastPh ? lastPh.url : null,
               band: !!(host && host.hasAttribute('band')),
               calendar: !!(host && host.hasAttribute('pcal')), pane: !!(host && host.hasAttribute('pane')), paneW: paneW, musicIn: mus.paneIn, paneNext: mus.paneNext, musicFirst: takeover(), paneCard: !!paneCard,
               energySlide: on && enShowing, weatherSlide: on && wxShowing, previewWeather: previewWeather, extra: exKind || null, extras: cfg ? extrasOf(cfg) : [], previewEnergy: previewEnergy,
               musicSlide: on && muShowing, musicPane: !!musicPaneView(), music: mus.key, upNext: mus.next ? mus.next.title : null,
               panel: pnl ? pnl.p.tab() : null };
    },
    _: { darkUnderBlack: function (v) { DARK_UNDER_BLACK = !!v; }, clock: clock, beat: beat, justResumed: function () { return justResumed(); },
         // tests: as a page just loaded, for HK's black (its first decision)
         hkFresh: function () { hkFirst = true; },
         // tests: the next touch is told at once (not held by the 10 s between reports)
         touchFresh: function () { touchSent = 0; },
         readCfg: readCfg, gate: gate, wake: WAKE, zoneOf: zoneOf, fitOf: fitOf, layoutOf: layoutOf, backdropSmall: backdropSmall, nightNow: nightNow,
         ckFx: ckFx, MOSAIC_COLORS: MOSAIC_COLORS,
         mosaicPlan: mosaicPlan, mosaicAssign: mosaicAssign, coverRect: coverRect, MOSAICS: MOSAICS,
         cleanFocus: cleanFocus, faceWindow: faceWindow, faceOrigin: faceOrigin, alignOf: alignOf, shuffle: shuffle, Deck: Deck, isImage: isImage,
         // tests: the slide without real photos to count
         slide: { show: showForecastSlide, hide: hideForecastSlide, since: function (n) { sinceFc = n; }, schedule: function () { schedule(); } },
         paneOf: paneOf, slideOf: slideOf, turnOf: turnOf, extrasOf: extrasOf, mmss: mmss,
         // tests: Home Energy and the additional screens without waiting minutes
         energy: { show: showEnergySlide, hide: hideEnergySlide, ready: energyReady, prep: energyPrep, layout: energyLayout,
                   ctl: function () { return enCtl; } },
         weather: { show: showWeatherSlide, hide: hideWeatherSlide, ready: weatherReady, prep: weatherPrep, layout: weatherLayout,
                    ctl: function () { return wxCtl; } },
         extras: { next: exNext, hide: exHide, arm: exArm, kind: function () { return exKind; }, last: function () { return exLast; } },
         // tests: the music without real speakers
         music: { show: showMusicSlide, hide: hideMusicSlide, render: renderMusic, watch: function () { mus.watchAt = 0; musicWatch(); },
                  dash: dashViews,
                  hit: musicHit, act: musicAct, now: musicNow, layout: layoutMusic, grace: MU_GRACE,
                  // the panel: open on the slide or the pane, close
                  panel: function (kind, tab) {
                    if (!kind) { closePanel(true); return null; }
                    var v = kind === 'pane' ? musicPaneView() : slideView();
                    panelFor(v, tab || 'speakers');
                    return pnl ? pnl.p.tab() : null;
                  } } }
  };
})();
