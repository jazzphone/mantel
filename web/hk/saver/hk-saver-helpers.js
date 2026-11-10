// hk-saver-helpers.js - the pure helpers: layout, mosaic and face windows, the page, the state's small tables.
//
// PART OF HK FRONTEND'S PHOTO SCREENSAVER (hk-saver.js). Not a card and not run on its own: it registers one
// function, which hk-saver.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSaverParts = window.hkSaverParts || {})['hk-saver-helpers'] = function (K) {
    var autoLayout = K.autoLayout, dashConf = K.dashConf, EDGE = K.EDGE, FADE_BACK_MS = K.FADE_BACK_MS;

    // ------------------------------------------------------------ pure helpers
    // (exported on hkSaver._ for tests/test_saver.js)
    // the mosaic's lines (settings.py MOSAIC_COLORS)
    var MOSAIC_COLORS = { black: '#000000', white: '#f5f5f2', gray: '#8e8e93', charcoal: '#2c2c2e', cream: '#efe6d2', navy: '#1c2a44' };
    var CLOCK_BGS = ['black', 'grain', 'gradient', 'aurora', 'ink', 'sky', 'lowpoly', 'topo', 'constellation', 'forecast', 'skyonly', 'photos', 'landscapes', 'wallpaper'];
    // THE HOMEVIEW-STYLE SHOWS (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): Glance, Month and Day, each a
    // whole screen of hk-saverfaces.js's, mounted as the clock is (Show: Clock's layer, a background of its own)
    var FACE_SHOWS = { glance: 1, month: 1, day: 1 };
    // LANDSCAPES (1.8.1): HK Frontend's own photos behind the clock, from
    // /hk/landscapes/ (index.json lists them; a home's own files folder can
    // answer with its own list), shown the way Photos shows yours
    var LANDSCAPES = '/hk/landscapes/';
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
      return layoutCfg(autoLayout(raw, {
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
        show: raw.show === 'forecast' || raw.show === 'both' || raw.show === 'clock' || FACE_SHOWS[raw.show] === 1 ? raw.show : 'photos',
        // THE CLOCKS (2026-10-13, hk-saverclock.js): Large over the photos or
        // the forecast (the corner one is a card), one style for both, and
        // what is behind Show: Clock
        clock_large: raw.clock !== false && raw.clock_over === 'large',
        // PLANTED IS A FACE (2026-11-02, phase 13, decision 1): the ivory numerals standing in the Landscape's meadow;
        // where there is no meadow -- a clock of its own, over photos -- it is Classic, whose figures they are
        clock_style: raw.clock_style === 'planted' ? 'classic' : typeof raw.clock_style === 'string' ? raw.clock_style : 'classic',
        clock_planted: raw.clock_style === 'planted',
        clock_options: raw.clock_options || {},
        clock_bg: CLOCK_BGS.indexOf(raw.clock_bg) >= 0 ? raw.clock_bg : 'gradient',
        clock_motion: raw.clock_motion === 'still' ? 'still' : 'slow',
        // a Wallpaper behind it (2026-10-31): which, and a motion theme's colour
        // (hkWallpapers checks both as it draws)
        clock_wallpaper: typeof raw.clock_wallpaper === 'string' ? raw.clock_wallpaper : 'aurora',
        clock_wallpaper_color: typeof raw.clock_wallpaper_color === 'string' ? raw.clock_wallpaper_color : 'blue',
        // the background's Speed (0 still) and Depth (2026-10-13); an older
        // Motion: Still is Speed 0
        clock_speed: n(raw.clock_speed, 0, 100, raw.clock_motion === 'still' ? 0 : 35),
        clock_depth: n(raw.clock_depth, 0, 100, 50),
        // Night Mode: off, at night (from .. to) or always
        clock_night: raw.clock_night === 'night' || raw.clock_night === 'always' ? raw.clock_night : 'off',
        clock_night_from: /^\d\d:\d\d$/.test(raw.clock_night_from || '') ? raw.clock_night_from : '22:00',
        clock_night_to: /^\d\d:\d\d$/.test(raw.clock_night_to || '') ? raw.clock_night_to : '07:00',
        clock_24: raw.clock_24 === true,
        clock_today_music: raw.clock_today_music !== false,
        clock_today_weather: raw.clock_today_weather !== false,
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
        // THE SIDE PANE (2026-10-30, withPane below): the pane's side, and the
        // sections the Side Pane draws in it where they are not the older
        // calendar-and-music shape
        pane_side: raw.pane_side === 'left' ? 'left' : 'right', pane_width: raw.pane_width || 'standard',
        pane_list: Array.isArray(raw.pane_list) && raw.pane_list.length ? raw.pane_list.slice(0, 8) : null,
        // WHAT PLAYS, BIG: a slide among the photos (with the forecast, they
        // take turns) or over the forecast while music plays; and the music
        // in the pane down the right (under the calendar when both are on)
        // (one key for Music Full Screen, phase 13: an older music_slide is music_first)
        music_slide: false,
        music_pane: raw.music_pane === true,
        // MUSIC FIRST: while music plays it fills the screen, over the photos
        // or the forecast, until MU_GRACE after it stops
        music_first: raw.music_first === true || raw.music_slide === true,
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
        // THE HOLIDAY SLIDE (phase 20, hk-saver-holiday.js): a slide among the photos, or an additional screen over a
        // clock; which holiday (Next Up, Take Turns, One Holiday), within how many days, those left out, your own dates,
        // the effects, the scenes sent outdoors, and what its row leaves out (hk-holidays.js reads the dates)
        // THE TIMER SLIDE (phase 21, hk-saver-timers.js): on unless turned off (it only comes while a timer runs); every
        // other turn (More Often) or a turn like the rest (As Often as the Others)
        timer_slide: raw.timer_slide !== false,
        timer_often: raw.timer_often === 'same' ? 'same' : 'more',
        holiday_slide: raw.holiday_slide === true,
        holiday_pick: raw.holiday_pick === 'turns' || raw.holiday_pick === 'one' ? raw.holiday_pick : 'next',
        holiday_one: typeof raw.holiday_one === 'string' && raw.holiday_one ? raw.holiday_one : 'christmas',
        holiday_days: raw.holiday_days === 30 || raw.holiday_days === 90 ? raw.holiday_days : 60,
        holiday_off: Array.isArray(raw.holiday_off) ? raw.holiday_off.filter(function (x) { return typeof x === 'string'; }) : [],
        holiday_own: Array.isArray(raw.holiday_own) ? raw.holiday_own.filter(function (x) { return x && typeof x === 'object' && typeof x.name === 'string'; }).slice(0, 12) : [],
        holiday_fx: raw.holiday_fx === 'gentle' || raw.holiday_fx === 'off' ? raw.holiday_fx : 'full',
        holiday_outdoors: Array.isArray(raw.holiday_outdoors) ? raw.holiday_outdoors.filter(function (x) { return typeof x === 'string'; }) : [],
        holiday_hide: Array.isArray(raw.holiday_hide) ? raw.holiday_hide.filter(function (x) { return typeof x === 'string'; }) : [],
        // THE SLIDES' OWN SETTINGS (2026-11-02, settings.py): the slide corner's time size and what it leaves out; what
        // Music Full Screen leaves out
        corner_time_size: n(raw.corner_time_size, 100, 250, 100),
        corner_hide: Array.isArray(raw.corner_hide) ? raw.corner_hide.filter(function (x) { return typeof x === 'string'; }) : [],
        music_hide: Array.isArray(raw.music_hide) ? raw.music_hide.filter(function (x) { return typeof x === 'string'; }) : [],
        // THE HOMEVIEW-STYLE FACES (2026-10-30, settings.py): the Forecast's Layout (Big: Big Weather), the photos'
        // Titles (the album's name and the year) and Time Behind (the time behind the photo's subject, where the
        // host cut it out: Mantel Photos), and the Day face's look
        forecast_layout: raw.forecast_layout === 'big' ? 'big' : 'classic',
        photo_titles: raw.photo_titles === true,
        time_behind: raw.time_behind === true,
        day_look: raw.day_look === 'light' || raw.day_look === 'dark' ? raw.day_look : 'auto',
        // Big Weather's number (2026-10-31): the temperature or the time; Time Behind's figures, their size and
        // height (% of the shorter side; % down) and the photo darkened under them (Photos and Both)
        forecast_big: raw.forecast_big === 'clock' ? 'clock' : 'temp',
        // ...the time planted in the meadow, lit by the scene's sun (2026-11-01, hk-saverfaces.js plant()): on unless off
        // (...and Big Weather's time stands in the meadow while the face is Planted: one home for the choice)
        forecast_planted: raw.clock_style === 'planted' || raw.forecast_planted !== false,
        // THE LAYOUT (2026-11-01, the Screensaver editor's; hk-saverlayout.js): none draws as each Show always has
        layout: raw.layout && typeof raw.layout === 'object' && (raw.layout.v === 1 || raw.layout.v === 2) ? raw.layout : null,
        tb_size: n(raw.tb_size, 12, 40, 24), tb_top: n(raw.tb_top, 0, 50, 6), tb_dim: n(raw.tb_dim, 0, 80, 0),
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
      }));
    }
    // THE LAYOUT'S OPTIONS (2026-11-01, the Screensaver editor; docs/phase12/SCREENSAVER-EDITOR.md): with a layout, the
    // options it takes the place of are read from it -- the corner cards are the ones it places, Time Behind is its big
    // element behind the photo's subject, there is no Large clock and no Big Weather face (the layout draws its own),
    // and the forecast's details show where it has them -- so all the rest (photos, the forecast, the slides, Night
    // Mode, the black screen) draws as it always has
    var LAYOUT_CARDS = {
      clock_card: 'custom:hk-clock-card', weather_card: 'custom:hk-weather-strip-card', music_card: 'custom:hk-screensaver-now-card',
      timers_card: 'custom:hk-timer-strip-card', status_card: 'custom:hk-screensaver-status-card'
    };
    // (a card the layout places that the screen's own list doesn't have: as the strategy would make it, hk-strategy.js SAVER_CARDS)
    var LAYOUT_CARD_CONF = {
      'custom:hk-timer-strip-card': { entity: 'sensor.running_quick_timers', scale: 1.6, fixed: true },
      'custom:hk-screensaver-now-card': { music: true },
      // (...and the corner clock and weather, which tell the time under a slide even where the layout has neither)
      'custom:hk-clock-card': { time_size: '150px', ampm_size: '40px', date_size: '40px', time_line_height: '1', date_format: 'monthday',
                                date_gap: '4px', gap: '8px', color: 'rgba(255,255,255,0.95)', ampm_color: 'rgba(255,255,255,0.70)',
                                date_color: 'rgba(255,255,255,0.85)', margin: '0px 0px 0px 20px', clip: false, layer: true },
      'custom:hk-weather-strip-card': { variant: 'inline', main_size: '36px', glyph_size: '60px', temp_gap: '36px', icon_gap: '12px',
                                        color: 'rgba(255,255,255,0.95)', margin: '-4px 0px 0px 20px', layer: true }
    };
    function layoutCfg(c) {
      var L = c.layout;
      if (!L) return c;
      var byType = {}, b = L.big || {};
      c.cards.forEach(function (x) { byType[x.type] = x; });
      // EVERY PLACED PIECE IS hkSaverWidgets' (2026-11-02, phase 13: Now Playing, Timers, the weather and Home Status
      // are the pieces' Card shape, drawn in the pieces' style; the owner: "Yes"), and under a slide the slide corner tells
      // what the slide lacks: none of the screensaver's own corner cards is drawn with a layout (the music's own extras
      // aside, which only its slide shows)
      c.cards = c.cards.filter(function (x) { return x && x.music_only; });
      c.clock_large = false;
      // BEHIND WITH ANY FACE (phase 13, phase 3): the layout's own face, the photo's subject cut out over it (layoutCut) --
      // never Time Behind's own figures, which knew one face. Its Darken is the photos' now (--ph-dim, layoutCut)
      c.time_behind = false;
      // THE FORECAST AS THE BACKGROUND is the layout's: classic, its details a piece (Weather, Band) where the layout has
      // them. AS A SLIDE -- between the photos, in their place, now and then over a clock -- its own Layout and Details
      // (2026-11-01, the owner: "there is no way of setting Big layout for forecast with Photos")
      var fcBack = c.show === 'forecast' || (c.show === 'clock' && (c.clock_bg === 'forecast' || c.clock_bg === 'skyonly'));
      if (fcBack) { c.forecast_layout = 'classic'; c.band = c.band_photos = false; }
      else c.band_photos = false;
      c.photo_titles = false;                  // (a piece of the layout's: Photo Title)
      return c;
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
    function paneOf(c) { return !!c && (c.calendar === true || c.music_pane === true || !!c.pane_list); }
    // THE SIDE PANE'S SCREENSAVER GROUP (2026-10-30, hk-sidepane.js; the
    // screen's side_pane_read, All Screens' for HK Settings' All Screens
    // preview): its sections in the screensaver's pane, on its Pane Side.
    // The pane it took over -- the calendar above, the music below while it
    // plays (side_pane_lifted moved look.saver's calendar / music_pane into
    // exactly that) -- is drawn as it always was; any other sections by the
    // Side Pane, in the same place. No Side Pane in the settings (an older
    // server): the screensaver's own calendar / music_pane, as before.
    function paneSecs(sp) {
      var g = (sp && sp.saver) || {};
      if (g.show === 'same') return ((sp.dashboard || {}).sections) || [];
      return g.show === 'own' && Array.isArray(g.sections) ? g.sections : [];
    }
    function olderPane(secs) {
      var cal = null, mu = false, i = 0;
      if (secs[i] && secs[i].kind === 'calendar' && !secs[i].size && !secs[i].when) cal = secs[i++];
      if (secs[i] && secs[i].kind === 'now_playing' && !secs[i].size && secs[i].when === 'active') { mu = true; i++; }
      return i === secs.length && (cal || mu) ? { calendar: !!cal, days: cal && cal.days, music: mu } : null;
    }
    function withPane(raw, sp) {
      if (!raw || !sp) return raw;
      var secs = paneSecs(sp), old = olderPane(secs);
      var out = Object.assign({}, raw, { calendar: false, music_pane: false, pane_list: null,
                                         pane_side: sp.side === 'left' ? 'left' : 'right', pane_width: sp.width || 'standard' });
      if (old) {
        out.calendar = old.calendar; out.music_pane = old.music;
        if (old.days) out.calendar_days = old.days;
      } else if (secs.length) out.pane_list = secs;
      return out;
    }
    // Preview visibility never edits the screen's saved Side Pane. Explicit Show
    // also displays inactive sections, so an empty/disabled pane can be designed.
    function previewPaneOf(sp, mode) {
      var out = { settings: sp, message: '' }, g = (sp && sp.saver) || {};
      if (mode === null) {
        if (g.show === 'off') out.message = 'The screensaver Side Pane is off in saved settings. Choose Show to preview it.';
        return out;
      }
      if (mode === false) { out.settings = Object.assign({}, sp, { saver: { show: 'off' } }); return out; }
      var secs = paneSecs(sp), fallback = !secs.length;
      if (fallback) secs = ((sp && sp.dashboard) || {}).sections || [];
      if (!secs.length) { secs = [{ kind: 'clock' }, { kind: 'weather' }, { kind: 'calendar', days: 7 }]; out.message = 'Sample Side Pane · preview only.'; }
      else if (fallback) out.message = 'Showing dashboard sections for this preview. The saved screensaver Side Pane stays off.';
      else if (secs.some(function (s) { return s.when === 'active'; })) out.message = 'Preview only: conditional sections are shown even when inactive.';
      out.settings = Object.assign({}, sp, { saver: { show: 'own', sections: secs.map(function (s) { return Object.assign({}, s, { when: 'always' }); }) } });
      return out;
    }
    // Which slide comes next among the photos: the music (only while it
    // plays), the forecast (Photos & Forecast), the weather, Home Energy and
    // the Holiday slide (each once it has something to show: a holiday near)
    // take turns, in that order.
    var SLIDE_ORDER = ['music', 'forecast', 'weather', 'energy', 'holiday', 'timer'];
    function slideOf(c, playing, last, energy, weather, holiday, timer, before) {
      var on = [];
      if (c && c.music_slide === true && playing) on.push('music');
      if (c && c.show === 'both') on.push('forecast');
      if (c && c.weather_slide === true && weather) on.push('weather');
      if (c && c.energy_slide === true && energy) on.push('energy');
      if (c && c.holiday_slide === true && holiday) on.push('holiday');
      if (c && c.timer_slide === true && timer) on.push('timer');
      return timedTurn(c, SLIDE_ORDER, on, last, before);
    }
    // THE TIMERS' TURN (phase 21): every other one while a timer runs, unless As Often as the Others. `before` is the
    // slide before the timers' last turn: the others carry on from it, or the first of them would come every time.
    function timedTurn(c, order, on, last, before) {
      if (on.indexOf('timer') < 0 || (c && c.timer_often === 'same')) return turnOf(order, on, last);
      if (last !== 'timer') return 'timer';
      var rest = on.filter(function (k) { return k !== 'timer'; });
      return rest.length ? turnOf(order, rest, before || '') : 'timer';
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
    // THE LAST MINUTE (phase 21, docs/phase21/TIMER-SLIDE.md): a timer within its last minute holds the Timer slide up,
    // on every screen, whatever else is there. Not over the black, a hidden page or the music's panel. The slide's module
    // loads only once a timer runs. No ticking until then: a state change, or one timeout for the minute's start. `d` is
    // what it does in the shell (hk-saver.js tmWatch), so all the deciding is here and testable.
    function timerHold(d) {
      var held = false, t = null, at = 0, later = null, asked = false;
      function rows() {
        var T = window.hkTimers, S = window.hkSettings, h = d.client();
        return T && T.userTimers && h ? T.userTimers(h.states, T.rulesOf(S), Date.now()).filter(function (r) { return !r.paused; }) : [];
      }
      function hold() {
        var S = d.slot;
        if (held && S.showing) { S.ctl.setNight(d.night()); return; }
        if (!S.ctl || d.blocked()) return;
        d.clear();
        if (!S.showing && !d.show()) { d.again(); return; }
        held = true;
        d.hold();
        S.ctl.setNight(d.night());
      }
      function watch() {
        if (!d.up()) return;
        // (the house's states change many times a second: at most once a second, and the last one always looked at)
        var now = d.now();
        if (now - at < 1000) { if (!later) later = setTimeout(function () { later = null; watch(); }, 1000 - (now - at)); return; }
        at = now;
        if (t) { clearTimeout(t); t = null; }
        var S = d.slot, list = d.wanted() ? rows() : [], soon = list.length ? list[0].left : null;
        var h = d.client(), T = window.hkTimers, ringing = !!(d.wanted() && T && T.rings && h && T.rings(h.states).length);     // (Time's Up holds it too)
        var close = ringing || (soon !== null && soon <= 60);
        if ((list.length || ringing) && !S.ctl && !asked) { asked = true; d.prep(); }     // (once: a second ask would drop the first)
        if (S.ctl) S.ctl.setClient(d.client());
        if (soon !== null || close) t = setTimeout(watch, close ? 1000 : (soon - 60) * 1000 + 50);
        if (close) hold();
        else if (held) { held = false; d.leave(!list.length); }
        else if (!list.length && S.showing) d.leave(true);     // nothing left to count, its ordinary turn still up
      }
      return { watch: watch, held: function () { return held; }, again: function () { at = 0; },
               leave: function () { held = false; asked = false; at = 0; if (t) { clearTimeout(t); t = null; } if (later) { clearTimeout(later); later = null; } } };
    }
    var EXTRA_ORDER = ['forecast', 'music', 'weather', 'energy', 'holiday', 'timer'];
    // SLIDES ARE OVERLAYS (2026-11-02, phase 13): every slide over every background but the photos (whose slides come
    // between them) -- the Weather slide over the Landscape, the Weather and Home Energy over Calm Color, Paper and the Day
    // face too (they were offered there and never came)
    function extrasOf(c) {
      if (!c || c.show === 'photos' || c.show === 'both') return [];
      var a = [];
      if (c.show !== 'forecast' && c.extra_forecast && c.clock_bg !== 'forecast' && c.clock_bg !== 'skyonly') a.push('forecast');
      if (c.extra_music && !c.music_first && !c.music_slide) a.push('music');
      if (c.weather_slide) a.push('weather');
      if (c.energy_slide) a.push('energy');
      if (c.holiday_slide) a.push('holiday');
      if (c.timer_slide) a.push('timer');
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
    // PHOTOS SIZED TO THE SCREEN (2026-10-29): a host may list a photo in more
    // than one size (`variants`: [[long edge in px, address], ...] -- Mantel
    // Photos has a 1280 and a 2560 px copy). cleanVariants: what of a list
    // item's variants is sound, smallest first. photoUrl: the address to load
    // -- the smallest copy that is about as big as the screen's long edge is in
    // device pixels (the pixel ratio capped at 2, as the mosaic's cells are), or
    // the largest there is -- else the item's own `url`. A wall tablet of
    // 1280 x 800 no longer decodes (and holds) a 2560 px photo it shows at half
    // that. Keep in View is not touched: faces and the focus are fractions of
    // the photo, and a smaller copy has the same shape.
    var VARIANTS_MAX = 4, VARIANT_SLACK = 0.9;
    function cleanVariants(p) {
      var out = [];
      if (p && Array.isArray(p.variants)) {
        p.variants.slice(0, VARIANTS_MAX).forEach(function (v) {
          if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && isFinite(v[0]) && v[0] > 0 && typeof v[1] === 'string' && v[1]) out.push([v[0], v[1]]);
        });
        out.sort(function (a, b) { return a[0] - b[0]; });
      }
      return out;
    }
    function photoUrl(item, edge, dpr) {
      var vs = item && item.variants;
      if (!vs || !vs.length) return item && item.url;
      var want = Math.max(1, edge || 0) * Math.max(1, Math.min(2, dpr || 1)) * VARIANT_SLACK;
      for (var i = 0; i < vs.length; i++) if (vs[i][0] >= want) return vs[i][1];
      return vs[vs.length - 1][1];
    }
    function screenEdge() { return Math.max(window.innerWidth || 0, window.innerHeight || 0) || 1280; }
    // PHOTO, TIME BEHIND (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I, decision 14): a host may hand a photo
    // with its subject cut out (`depth`: {mask: an address}) -- Mantel Photos does, for the photos with a clear
    // subject. cleanDepth: what of it is sound (a `box` from before 0.1.93 is ignored: the time no longer moves).
    function cleanDepth(p) {
      var d = p && p.depth;
      if (!d || typeof d.mask !== 'string' || !d.mask || /["\\()\s]/.test(d.mask)) return null;
      return { mask: d.mask };
    }
    // where an iw x ih photo is drawn in a W x H box, as its fit and focus (0..1) lay it out: [left, top, w, h]
    function drawnRect(iw, ih, W, H, fit, ax, ay) {
      var k = fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih), w = iw * k, h = ih * k;
      return [(W - w) * ax, (H - h) * ay, w, h];
    }
    // THE TIME'S ONE PLACE (2026-10-30, the owner: the same spot and size on every photo): upper centre, as the CSS
    // lays it out in the photo's box (W x H, beside any pane) -- a line 28 % of its shorter side tall, 6 % down, the
    // figures 24 % of it. glyphBox: the figures' own box in it, [left, top, w, h] (a figure 0.58 of the type wide, a
    // colon 0.3, the figures' height 0.72), what the subject is weighed against
    // ...the size and the height as the screen sets them (2026-10-31, the owner: tb_size, tb_top -- 24 and 6 the
    // defaults, the line always 7/6 of the figures), passed in `c` (else the defaults)
    var TB = { top: 0.06, line: 0.28, type: 0.24 }, TB_WAIT = 1500;
    function tbGeom(c) {
      var t = c && c.tb_size ? c.tb_size / 100 : TB.type;
      return { top: c && c.tb_top != null ? c.tb_top / 100 : TB.top, type: t, line: t * TB.line / TB.type };
    }
    function glyphBox(W, H, text, c) {
      var g = tbGeom(c), m = Math.min(W, H), f = m * g.type, s = String(text || '10:42');
      var w = f * (s.replace(/[^0-9]/g, '').length * 0.58 + s.replace(/[0-9]/g, '').length * 0.3), h = f * 0.72;
      return [(W - w) / 2, H * g.top + (m * g.line - h) / 2, w, h];
    }
    // HOW MUCH OF THE FIGURES THE SUBJECT COVERS: the share of a mask's alpha (RGBA bytes) at half or more. Behind,
    // the subject over the time, only where it covers some of it -- enough to read as in front, not so much the time
    // can't be read -- else the time in front with no cut-out
    var TB_COVER = [0.05, 0.35];
    function coverShare(px) {
      var n = 0, k = 0;
      for (var i = 3; i < px.length; i += 4) { n++; if (px[i] >= 128) k++; }
      return n ? k / n : 0;
    }
    function behindAt(share) { return typeof share === 'number' && share >= TB_COVER[0] && share <= TB_COVER[1]; }
    // ...weighed once per photo, screen and layout (the share, by key), from the stored mask drawn as the photo is:
    // the figures' box, 96 px wide, the mask laid over it where the photo is. A mask that can't be read (another
    // site's, no canvas): in front
    var tbShares = {};
    // (the time's size and height as well, where the screen changed them: tbGeom)
    function tbKey(mask, W, H, fit, pos, text, c) {
      var g = tbGeom(c), k = [mask, Math.round(W), Math.round(H), fit, pos.join(' '), String(text).length].join('|');
      return g.type === TB.type && g.top === TB.top ? k : k + '|' + g.type + '|' + g.top;
    }
    function tbShare(mask, rect, g, key, done) {
      if (key in tbShares) { done(tbShares[key]); return; }
      if (typeof Image === 'undefined') { done(null); return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var share = null;
        try {
          var cw = 96, ch = Math.max(8, Math.round(cw * g[3] / g[2])), k = cw / g[2];
          var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var x = cv.getContext('2d');
          x.drawImage(img, (rect[0] - g[0]) * k, (rect[1] - g[1]) * k, rect[2] * k, rect[3] * k);
          share = coverShare(x.getImageData(0, 0, cw, ch).data);
        } catch (e) { share = null; }
        tbShares[key] = share;
        done(share);
      };
      img.onerror = function () { tbShares[key] = null; done(null); };
      img.src = mask;
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
    // WITH ITS ZOOM `zm` (2026-11-03, the owner: "Sometimes, portraits photos aren't in the center of the screen"): along a
    // side where the zoomed photo still fits the frame -- a whole portrait, across -- it grows from its own middle and
    // stays centered; where it runs past the frame, toward the faces but never so far that its edge comes inside it
    function faceOrigin(cx, cy, iw, ih, cw, ch, fit, fx, fy, zm) {
      var s = (fit === 'contain' ? Math.min : Math.max)(cw / iw, ch / ih), dw = iw * s, dh = ih * s;
      var axis = function (c, a, d, frame) {
        var x0 = (frame - d) * a, o = x0 + c * d, z = zm || 1;
        if (z > 1) {
          if (d * z <= frame + 0.5) o = x0 + d / 2;
          else o = Math.max(x0 * z / (z - 1), Math.min((x0 + d) * z / (z - 1) - frame / (z - 1), o));
        }
        return Math.max(0, Math.min(1, o / frame));
      };
      return { ox: axis(cx, fx, dw, cw), oy: axis(cy, fy, dh, ch) };
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
    // the sun below the horizon (sun.sun), as the sky reads it; unknown: by day
    function sunDown() {
      var c = clientNow(), s = c && c.states && c.states['sun.sun'];
      return !!(s && s.attributes && Number(s.attributes.elevation) <= 0);
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
    // the font the dashboard's view draws in (its theme is on the view)
    function viewFont() {
      try {
        var v = window.hkShell.viewContainer(panel());
        return v ? getComputedStyle(v).fontFamily : '';
      } catch (e) { return ''; }
    }

    // ------------------------------------------------------------ state
    function isFlat() { var S = window.hkSettings; return !!(S && S.rendering && S.rendering().flat); }
    function houseBlock(over) {
      var HS = window.hkSettings, S = window.hkStrategy;
      var all = HS && HS.get ? HS.get('boards', null) : null;
      var b = all && all[String(location.pathname).split('/')[1] || ''];
      var o = over || (HS && HS.get ? HS.get('look.saver', null) : null);
      if (!b || !o || !S || !S.saverBlock) return null;
      return S.saverBlock(clientNow(), Object.assign({}, b, { screensaver: true, screensaver_options: o }));
    }
    var FC_TICK_MS = 5000;

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
    // IN A FRAME (HK Settings' preview) it never runs on its own -- no idle
    // start, no switch, no touches -- only as the preview: the frame's query
    // (?wp_enabled=false) does not survive the dashboard's own navigation, and
    // an admin can be a screen's Tablet User.
    var framed = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
    function held() {
      // hk-idle is held while a detail sheet is open or Live TV plays: the
      // screensaver never covers someone watching or using a sheet
      var I = window.hkIdle;
      return !!(I && typeof I.held === 'function' && I.held().length);
    }

    // THE FORECAST DETAILS (today, the hours, the days) where they show, a
    // finger's slop around them. Laid out with pointer-events off, so found
    // by place.
    var SLOP = 12;
    // this dashboard's Weather page, when it has one
    function weatherPage() {
      var conf = dashConf();
      var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === 'weather'; });
      return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/weather' : null;
    }
    // A PIECE'S PAGE (2026-11-10, the owner: "all the widgets for the screensavers, when tapped, took you to their page ... an option to
    // enable/disable per widget"): the screen's page for a view path, when it has one -- the Weather page's way for any page
    function pageFor(path) {
      var conf = dashConf();
      var has = conf && Array.isArray(conf.views) && conf.views.some(function (v) { return v && v.path === path; });
      return has ? '/' + (String(location.pathname).split('/')[1] || '') + '/' + path : null;
    }
    // ...and the page of the laid-out piece under a tap (a finger's slop round it): its kind's page (hkSaverLayout.TAP_PAGES), unless
    // its When Tapped says Nothing (data-tap, set as it is made); none, null -- the tap only wakes the screen
    function widgetPage(x, y, ly) {
      var LM = window.hkSaverLayout, T = (LM && LM.TAP_PAGES) || {}, TS = (LM && LM.TAP_SHEETS) || {}, hit = null;
      if (!ly || !ly.widgets || x == null || y == null) return null;
      Object.keys(ly.widgets).forEach(function (k) {
        var el = ly.widgets[k] && ly.widgets[k].el, p = el && (/(?:^|\s)p-([a-z0-9_]+)/.exec(el.className || '') || [])[1];
        if (hit || !p || !(T[p] || TS[p]) || el.isConnected === false || el.getAttribute('data-tap') === 'none') return;
        var r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0 && x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP)) return;
        // (its thing's sheet: "sheet:<entity>", go() opens it; with none named, its kind's page)
        var ent = TS[p] ? el.getAttribute('data-tap-entity') : '';
        hit = ent ? 'sheet:' + ent : T[p] ? pageFor(T[p]) : null;
      });
      return hit || null;
    }
    // as a navigate tap_action does (hk-base.js): HA follows location-changed;
    // the dashboard is still under the screensaver, drawing (stop's WAKE)
    function go(path) {
      // (a piece's thing, "sheet:<entity>" -- widgetPage: its detail sheet over the screen it wakes on)
      if (/^sheet:/.test(String(path))) { try { window.hkShell.moreInfo(String(path).slice(6)); } catch (e) { /* stay */ } return; }
      if (String(location.pathname) === path) return;
      try { window.hkShell.navigate(path); } catch (e) { /* stay */ }
    }

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

    K.inPane = function (e, pane, up) {
      if (!pane || !up) return false;
      if (e.composedPath && e.composedPath().indexOf(pane) >= 0) return true;
      var pt = e.touches && e.touches[0] || e, r = pane.getBoundingClientRect();
      return pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom;
    };
    K.Deck = Deck;
    // A device may choose locally. Editing stays on the host's settings page.
    function createDesignController(o) {
      var designPick = null, designSource = '', designRef = null, saverHold = null, saverChooser = null, generation = 0, preferenceKey = null;
      function designOptions() {
        var HS = window.hkSettings, path = String(location.pathname).split('/')[1] || '';
        var boards = HS && HS.get('boards', {}), b = boards && boards[path];
        return (b && b.screensaver_options) || (HS && HS.get('look.saver', {})) || {};
      }
      function revision(text) { var n = 2166136261; for (var i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619); return (n >>> 0).toString(36); }
      function key() {
        var c = o.client(), u = c && c.user, HS = window.hkSettings;
        return u && (u.id || u.name) && HS && HS.live !== false ? 'hk-saver-design:' + String(location.pathname).split('/')[1] + ':' + (u.id || u.name) : null;
      }
      function forget() { try { if (preferenceKey) localStorage.removeItem(preferenceKey); } catch (e) { /* private browser */ } }
      function designEditor() {
        var c = o.client(), S = window.hkShell;
        if (!c || !c.user || !c.user.is_admin || !S || S.atTablet(c) !== false) return null;
        return S.screensaverEditor ? S.screensaverEditor(String(location.pathname).split('/')[1] || '') : null;
      }
      function clearSaverHold() { if (saverHold) clearTimeout(saverHold.timer); saverHold = null; }
      function openDesigns() {
        if (!o.running() || o.preview() || saverChooser) return;
        var options = designOptions(), href = designEditor(), run = ++generation;
        import('/hk/modules/hk-saver-chooser.js').then(function () {
          if (!o.running() || saverChooser || run !== generation) return;
          saverChooser = window.hkSaverChooser.open({ designs: options.designs || [], active: designPick ? designPick.id : options.active_design,
            client: o.client(), parent: window.hkShell.overlayRoot() || document.body, local: !!designPick,
            reset: function () { designPick = null; forget(); o.refresh(); },
            select: function (d) { designPick = d; designRef = designOptions(); designSource = JSON.stringify(designRef); preferenceKey = key();
              try { if (preferenceKey) localStorage.setItem(preferenceKey, JSON.stringify({ id: d.id, revision: revision(designSource) })); } catch (e) { /* private browser */ }
              o.refresh(); },
            edit: href ? function () { var id = designPick ? designPick.id : options.active_design; o.stop('manual'); location.assign(href + (id ? '/' + encodeURIComponent(id) : '')); } : null,
            close: function () { saverChooser = null; o.touched(); } });
        }).catch(function () { if (window.hkShell) window.hkShell.toast({ message: 'The screensaver chooser couldn’t load. Please try again.' }); });
      }
      function holdDesigns(e) {
        if (o.preview() || (!designEditor() && !(designOptions().designs || []).length) || !e.pointerId) return false;
        clearSaverHold();
        var h = saverHold = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: null };
        h.timer = setTimeout(function () { if (saverHold !== h) return; clearSaverHold(); openDesigns(); }, 550);
        return true;
      }
      return {
        open: openDesigns, hold: holdDesigns,
        options: function () {
          var current = designOptions(), nowKey = key();
          if (nowKey && nowKey !== preferenceKey) {
            preferenceKey = nowKey; designPick = null;
            try {
              var saved = JSON.parse(localStorage.getItem(nowKey) || 'null');
              if (saved && saved.revision === revision(JSON.stringify(current))) designPick = (current.designs || []).find(function (d) { return d.id === saved.id; }) || null;
              if (saved && !designPick) forget();
            } catch (e) { /* private / damaged browser storage */ }
            designRef = current; designSource = JSON.stringify(current);
          }
          if (designPick && current !== designRef) {
            if (JSON.stringify(current) !== designSource) { designPick = null; forget(); }
            designRef = current;
          }
          return designPick && designPick.options;
        },
        clear: function () { generation++; clearSaverHold(); if (saverChooser) saverChooser.close(); },
        input: function (e) {
          var t = e.type;
          if (o.running() && !o.preview() && e.composedPath && e.composedPath().some(function (n) { return n && n.hasAttribute && n.hasAttribute('data-hk-saver-control'); })) { o.touched(); return true; }
          if (saverChooser) { o.touched(); return true; }
          if (!saverHold) return false;
          if (e.pointerId !== saverHold.id && t === 'pointerdown') { clearSaverHold(); return true; }
          if (t === 'pointermove' && Math.hypot(e.clientX - saverHold.x, e.clientY - saverHold.y) > 10) { clearSaverHold(); o.stop('touch'); return true; }
          if (t === 'pointerup') { clearSaverHold(); o.stop('touch'); return true; }
          if (t === 'pointercancel') { clearSaverHold(); return true; }
          if (t !== 'keydown') return true;
          clearSaverHold(); return false;
        }
      };
    }
    K.createDesignController = createDesignController;

    // what the shell and the later parts use of this one
    K.actionsNow = actionsNow; K.alignOf = alignOf; K.backdropSmall = backdropSmall; K.behindAt = behindAt;
    K.cleanDepth = cleanDepth; K.cleanFocus = cleanFocus; K.cleanVariants = cleanVariants; K.clientNow = clientNow;
    K.coverRect = coverRect; K.coverShare = coverShare; K.drawnRect = drawnRect; K.EXTRA_ORDER = EXTRA_ORDER;
    K.extrasOf = extrasOf; K.FACE_SHOWS = FACE_SHOWS; K.faceOrigin = faceOrigin; K.faceWindow = faceWindow;
    K.FC_TICK_MS = FC_TICK_MS; K.feedCard = feedCard; K.fitOf = fitOf; K.FOCUS_F = FOCUS_F; K.framed = framed;
    K.gate = gate; K.glyphBox = glyphBox; K.go = go; K.held = held; K.houseBlock = houseBlock; K.isFlat = isFlat;
    K.isImage = isImage; K.LANDSCAPES = LANDSCAPES; K.layoutOf = layoutOf; K.mmss = mmss;
    K.MOSAIC_COLORS = MOSAIC_COLORS; K.mosaicAssign = mosaicAssign; K.mosaicPlan = mosaicPlan; K.MOSAICS = MOSAICS;
    K.panel = panel; K.paneOf = paneOf; K.photoUrl = photoUrl; K.readCfg = readCfg; K.screenEdge = screenEdge;
    K.shuffle = shuffle; K.slideOf = slideOf; K.timedTurn = timedTurn; K.timerHold = timerHold; K.SLOP = SLOP; K.sunDown = sunDown; K.tabletId = tabletId;
    K.tabletNow = tabletNow; K.tagOf = tagOf; K.TB_COVER = TB_COVER; K.TB_WAIT = TB_WAIT; K.tbKey = tbKey;
    K.tbShare = tbShare; K.tbShares = tbShares; K.turnOf = turnOf; K.user = user; K.viewFont = viewFont;
    K.weatherPage = weatherPage; K.widgetPage = widgetPage; K.pageFor = pageFor; K.withPane = withPane; K.previewPaneOf = previewPaneOf; K.zoneOf = zoneOf;
  };
})();
