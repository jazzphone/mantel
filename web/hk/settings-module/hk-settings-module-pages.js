// hk-settings-module-pages.js - what a page shows: the sky ladder, swipe pages, backdrops, wallpaper, photos and landscapes.
//
// PART OF THE HK SETTINGS MODULE (window.hkSettings) (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsModuleParts = window.hkSettingsModuleParts || {})['hk-settings-module-pages'] = function (K) {
    var boardHere = K.boardHere, get = K.get, glass = K.glass, keysOf = K.keysOf, landscapeFile = K.landscapeFile,
        landscapeList = K.landscapeList, LOOK_VARS = K.LOOK_VARS, LOOKS = K.LOOKS, rendering = K.rendering;

    // The sky's backdrops (Sky / Background): a fixed all-day gradient
    // instead of the live sky. This is the pre-answer mirror of settings.py
    // SKY_BACKDROPS -- tests/py/test_settings.py compares the entire table.
    // Each palette is four stops, top of sky to horizon, in a day set and a
    // night set. Where they come from: dusk and midnight are the live sky's
    // own measured rows (hk-sky.js SKY, elevations 4/-4 and 60/-18); fjord,
    // dune, graphite, plum, ember and mist are its static palettes (hk-sky.js
    // STATIC: ecoflow, energy, cameras, playmusic, doors, climate) -- the
    // horizon stops pulled to the glass plates' ground, at or under the live
    // sky's own 146 -- and each night set keeps its day set's hue at night
    // depth. Checked the way hk-sky.js checks a palette (mean under CAP,
    // horizon at or under 146); the test holds it.
    var SKY_BACKDROPS = [
      { id: 'live', label: 'Live Sky' },
      { id: 'dusk', label: 'Dusk', day: ['#141f3d', '#26314f', '#5c4460', '#b06a4a'],
        night: ['#0c1428', '#161d35', '#33263f', '#5e3730'] },
      { id: 'midnight', label: 'Midnight', day: ['#0d2f57', '#154272', '#256192', '#5b93b8'],
        night: ['#04070f', '#060a16', '#0a0f1f', '#111726'] },
      { id: 'fjord', label: 'Fjord', day: ['#121634', '#183456', '#1e6e7c', '#579eaa'],
        night: ['#0a0d22', '#0f2136', '#133f47', '#336163'] },
      { id: 'dune', label: 'Dune', day: ['#171d12', '#3a4020', '#7a5a24', '#b07f38'],
        night: ['#0d100a', '#1e2112', '#3f2e14', '#5e4522'] },
      { id: 'graphite', label: 'Graphite', day: ['#080a0e', '#0f1219', '#171b23', '#222833'],
        night: ['#040507', '#080a0d', '#0d1015', '#11141a'] },
      { id: 'plum', label: 'Plum', day: ['#150e1f', '#2e1b42', '#5c2f76', '#9a6bb0'],
        night: ['#0b0713', '#170e24', '#2e1a3f', '#4c3659'] },
      { id: 'ember', label: 'Ember', day: ['#1c0e10', '#3c1a1e', '#7a2f34', '#b0605f'],
        night: ['#100708', '#1e0d10', '#3d191c', '#5d3231'] },
      { id: 'mist', label: 'Mist', day: ['#0d1a1c', '#173437', '#22646a', '#56a0a0'],
        night: ['#080f10', '#0d1e21', '#12373d', '#325556'] },
      { id: 'lagoon', label: 'Lagoon', day: ['#0c1d2b', '#14324a', '#1f5068', '#3f7f90'],
        night: ['#070f18', '#0c1d2b', '#123346', '#244e5c'] },
      { id: 'lavender', label: 'Lavender Dusk', day: ['#15142b', '#25244a', '#3b3a6a', '#68679a'],
        night: ['#0b0a18', '#15142b', '#232245', '#3a3962'] },
      { id: 'sage', label: 'Sage Mist', day: ['#0e1a18', '#18302b', '#284a42', '#4f7a6c'],
        night: ['#08100e', '#0f1d1a', '#1a302b', '#2f4a42'] },
      { id: 'harbor', label: 'Harbor Slate', day: ['#111a26', '#1c2b3e', '#2d4159', '#566e8a'],
        night: ['#090e16', '#111a26', '#1b2a3c', '#2f4359'] },
      { id: 'rosewater', label: 'Rosewater', day: ['#1c1418', '#33232b', '#523844', '#86626f'],
        night: ['#100b0e', '#1c1418', '#2e1f26', '#4a343e'] },
      { id: 'driftwood', label: 'Driftwood', day: ['#1a1712', '#2f2a21', '#4b4333', '#7c6f57'],
        night: ['#0e0c09', '#1a1712', '#2a251c', '#443c2e'] },
      { id: 'black', label: 'Black', day: ['#05070e', '#05070e', '#05070e', '#05070e'],
        night: ['#05070e', '#05070e', '#05070e', '#05070e'] },
      { id: 'custom', label: 'Custom' }
    ];
    function backdropStops(id, custom) {
      // "live" (or an unknown id): the live sky. "custom": the house's own
      // stops, when they carry four of each; else the live sky too.
      if (id === 'custom') {
        if (custom && custom.day && custom.night && custom.day.length === 4 && custom.night.length === 4)
          return { day: custom.day, night: custom.night };
        return null;
      }
      for (var i = 0; i < SKY_BACKDROPS.length; i++) {
        var p = SKY_BACKDROPS[i];
        if (p.id === id && p.day) return { day: p.day, night: p.night };
      }
      return null;
    }
    // Sky / Background (HK Settings -> Sky / Background; a screen's own on
    // its Screen page): this page's sky look, resolved like glass() -- this
    // dashboard's own values when it sets them (not null), else All Screens'
    // (sky.*). backdrop: null is the live sky; {day: [4], night: [4]} a fixed
    // all-day gradient (the day set by day, the night set by night -- hk-sky.js
    // paint). The boards' keys are sky_animations / sky_weather /
    // sky_decorations / sky_decoration_style / sky_cloud_style / sky_daytime /
    // sky_gradient / sky_custom. brightness: the daytime sky (settings.py
    // DAYTIME_SKIES) as hk-sky.js paints it, 0 (deep) .. 1 (natural).
    var DAYTIME = { natural: 1, balanced: 0.5, deep: 0 };
    // REDUCE MOTION (2026-10-29). A device that asks for it (prefers-reduced-motion: Samsung's Remove animations, an
    // iPad's Reduce Motion) gets the sky and everything that keys on skyLook().animations at rest -- the same as a
    // screen whose Animations are off: no falling rain or snow, no drifting decks, the cards' own animations held
    // (the sky's CSS already stopped the keyframes; the fall was left hanging as a still texture, and the JS and the
    // cards went on as if motion were allowed). It is the device's word, so it is not a saved setting: the screen's
    // Animations switch is unchanged underneath and applies again when the device stops asking.
    function reducedMotion() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }
    function skyLook() {
      var b = boardHere();
      var own = function (bk, hk, dflt) {
        var v = b ? b[bk] : undefined;
        return (v === null || v === undefined) ? get(hk, dflt) : v;
      };
      var flat = rendering().flat;
      return {
        animations: !flat && !reducedMotion() && own('sky_animations', 'sky.animations', true) !== false,
        weather: !flat && own('sky_weather', 'sky.weather', true) !== false,
        // Rain & Snow: the falling weather alone (2026-10-10); and Pause When
        // Not in Focus -- on a computer, the sky and the cards hold while
        // another window has the focus (hk-sky.js FOCUS)
        precipitation: !flat && own('sky_precipitation', 'sky.precipitation', true) !== false,
        focusPause: own('sky_focus_pause', 'sky.focus_pause', true) !== false,
        decorations: !flat && own('sky_decorations', 'sky.decorations', true) !== false,
        decorationStyle: own('sky_decoration_style', 'sky.decoration_style', 'old'),
        // Moving Things: 'front' draws them over the cards (hk-sky.js FRONT)
        moving: own('sky_moving', 'sky.moving', 'behind'),
        cloudStyle: own('sky_cloud_style', 'sky.cloud_style', 'classic'),
        brightness: DAYTIME.hasOwnProperty(own('sky_daytime', 'sky.daytime', 'natural'))
          ? DAYTIME[own('sky_daytime', 'sky.daytime', 'natural')] : 1,
        backdrop: backdropStops(own('sky_gradient', 'sky.gradient', 'live'),
                                b && b.sky_gradient != null ? own('sky_custom', 'sky.gradient_custom', null) : get('sky.gradient_custom', null)),
        // THE BACKGROUND (2026-10-13): what Home, the room pages and every page
        // without a color of its own show -- the live sky, or a still color
        // ({day, night} stops) or photo, with no sky drawn at all
        background: background(b),
        // Liveliness: this screen's own when it has one (sky_liveliness),
        // else All Screens' -- the same shape (hk-sky.js lvOf). `room` is
        // where Calm When Nobody's Around looks for someone (the screen's idle
        // room).
        lively: (b && b.sky_liveliness) ? {
          all: b.sky_liveliness, occ: b.sky_liveliness_occ || {}, custom: b.sky_liveliness_custom || {},
          calmEmpty: !!b.sky_calm_empty, room: b.idle_room || ''
        } : {
          all: get('sky.liveliness_all', 'classic') || 'classic',
          occ: get('sky.liveliness', {}) || {},
          custom: get('sky.liveliness_custom', {}) || {},
          calmEmpty: !!(b && b.sky_calm_empty),
          room: (b && b.idle_room) || ''
        }
      };
    }
    // WHAT WAS ON SCREEN when the frame rate was sampled (hk-fps.js; 2026-10-29):
    // the settings HK Settings' slow-tablet ladder (hk-settings-model.js LADDER)
    // changes, as THIS screen has them, in a short word -- "blur:a1w1r1f0c1" is
    // the style, then 1 or 0 for a live sky that animates (a), has weather (w),
    // drops rain and snow (r), draws its moving things in front of the cards
    // (f) and a camera that plays live (c). A flag is 1 only while it costs
    // something: nothing under Flat, no sky motion with a still background.
    // The settings panel works the same word out for the screen it shows
    // (M.ladderSignature), so a number is only ever used for the settings it
    // was drawn with.
    function ladderSignature() {
      var style = glass(), flat = style === 'flat', b = boardHere(), sk = skyLook();
      var live = !flat && !(b && b.sky === false) && !!sk.background && sk.background.mode === 'live';
      // (a Wallpaper with Motion on moves too, while Animations are on)
      var moving = !flat && !(b && b.sky === false) && !!sk.background && sk.background.mode === 'wallpaper' &&
        !!sk.background.wallpaper && sk.background.wallpaper.motion !== 'off';
      var a = (live || moving) && sk.animations, w = live && sk.weather, r = live && a && w && sk.precipitation, f = live && a && sk.moving === 'front';
      var cam = b && typeof b.camera_live_video === 'boolean' ? b.camera_live_video : get('cameras.live', true) !== false;
      var n = function (v) { return v ? '1' : '0'; };
      return style + ':a' + n(a) + 'w' + n(w) + 'r' + n(r) + 'f' + n(f) + 'c' + n(!flat && cam);
    }
    // SWIPE BETWEEN PAGES (2026-10-30): this screen's own (swipe_pages), else
    // All Screens' (menu.swipe_pages) -- 'auto' (where a tab bar shows), 'on'
    // or 'off'. hk-pageswipe.js decides the rest.
    var SWIPE_PAGES = ['auto', 'on', 'off'];
    function swipePages() {
      var b = boardHere(), own = b ? b.swipe_pages : null;
      if (SWIPE_PAGES.indexOf(own) >= 0) return own;
      var h = get('menu.swipe_pages', 'auto');
      return SWIPE_PAGES.indexOf(h) >= 0 ? h : 'auto';
    }
    // SWIPE RIGHT ON HOME (2026-11-06): the view path of the page this screen puts before Home in the swipe's order, or
    // null (hk-pageswipe.js)
    function swipeLeft() {
      var b = boardHere(), v = b ? b.swipe_left : null;
      return typeof v === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(v) ? v : null;
    }
    // the first of `keys` set in this screen's map, else All Screens'
    function pageFind(keys, bk, hk) {
      var b = boardHere(), all = get(hk, {}) || {};
      for (var i = 0; i < keys.length; i++) {
        var mine = b && b[bk] && b[bk][keys[i]];
        if (mine) return mine;
        if (all[keys[i]]) return all[keys[i]];
      }
      return null;
    }
    function pageSky(key) {
      return pageFind(keysOf(key), 'sky_pages', 'sky.pages');
    }
    // THE BACKGROUND as this screen has it: {mode: 'live' | 'color' | 'photo',
    // stops (a color's {day, night}), photo (its address)}. The screen's own
    // mode, color and photo, each else All Screens'. A color that can't be
    // drawn (Custom with no stops) is Black; a Photo with none chosen is
    // Black too -- never the live sky, which is what was turned away from.
    var BLACK = { day: ['#05070e', '#05070e', '#05070e', '#05070e'], night: ['#05070e', '#05070e', '#05070e', '#05070e'] };
    function background(b) {
      var mode = (b && b.sky_background) || get('sky.background', 'live') || 'live';
      // A WALLPAPER (2026-10-30): our own art, a still as a Color is; its
      // stops are its own (wallpaper())
      if (mode === 'wallpaper') { var wp = wallpaper(b); return { mode: 'wallpaper', wallpaper: wp, stops: wp.stops, photo: null }; }
      // LANDSCAPES: a photo like any other, HK's own -- Black until the list
      // has come (landscapeList), never the live sky
      if (mode === 'landscapes') {
        var lf = landscapeFile(landscapeChoice(b), landscapeList());
        return { mode: 'photo', landscapes: true, stops: BLACK, photo: lf ? LANDSCAPES + lf : null, look: landscapeLook(b) };
      }
      if (mode !== 'color' && mode !== 'photo') return { mode: 'live', stops: null, photo: null };
      var color = (b && b.sky_color) || get('sky.color', 'midnight') || 'midnight';
      var custom = b && b.sky_custom ? b.sky_custom : get('sky.gradient_custom', null);
      var photo = (b && b.sky_photo) || get('sky.photo', null) || null;
      if (mode === 'photo') return { mode: 'photo', stops: BLACK, photo: photo, look: photoLook(b) };
      return { mode: 'color', stops: backdropStops(color, custom) || BLACK, photo: null };
    }
    // THE WALLPAPER as this screen has it (its own, else All Screens'): {id,
    // night: 'auto' | 'day' | 'night', stops: {day, night}, motion, color} --
    // Black's stops until hk-wallpapers.js has come (the sky draws it on its
    // next tick). `color`: "#rrggbb" -- a motion theme's (2026-10-31), and an
    // art's too since 2026-11-01 (item 45). An old id ("ribbons_rose", which
    // settings.py reads as its art in its preset already) is that here too
    function wallpaper(b) {
      if (b === undefined) b = boardHere();
      var W = window.hkWallpapers;
      var id = (b && b.sky_wallpaper) || get('sky.wallpaper', 'ribbons') || 'ribbons';
      var night = (b && b.sky_wallpaper_night) || get('sky.wallpaper_night', 'auto') || 'auto';
      var motion = (b && b.sky_wallpaper_motion) || get('sky.wallpaper_motion', 'off') || 'off';
      var col = (b && b.sky_wallpaper_color) || get('sky.wallpaper_color', 'rose') || 'rose';
      if (W) { var r = W.resolve(id, col); id = r.id; col = r.hex; } else col = null;
      return { id: id, night: night === 'day' || night === 'night' ? night : 'auto', stops: W ? W.stops(id, col) : BLACK,
               motion: ['slow', 'medium', 'fast'].indexOf(motion) >= 0 ? motion : 'off', color: col };
    }
    // A PHOTO'S LOOK (2026-10-13): this screen's own, else All Screens' --
    // {blur px, dim 0..1 (brightness = 1 - dim), saturate 0..2, tint: {day,
    // night} stops washed over it at `amount` 0..1, or null}. A page's photo
    // has its screen's.
    function photoLook(b, own) {
      if (rendering().flat) return { blur: 0, dim: 0, saturate: 1, tint: null, amount: 0 };
      if (b === undefined) b = boardHere();
      var L = Object.assign({ blur: 0, dim: 0, saturation: 100, tint: '', tint_amount: 35 },
                            own || (b && b.sky_photo_look) || get('sky.photo_look', {}) || {});
      var custom = b && b.sky_custom ? b.sky_custom : get('sky.gradient_custom', null);
      var tint = L.tint ? backdropStops(L.tint, custom) : null;
      // THE IMAGE LOOK (2026-10-24): Flat's treatment, when one is chosen for
      // the Glass looks (hkFlatImage.resolveGlass) -- null when Off
      var H = window.hkFlatImage, im = H && H.resolveGlass ? H.resolveGlass(get('sky', {}), b).value : null;
      return { blur: Math.round(Math.max(0, Math.min(100, +L.blur || 0)) * 0.4), dim: Math.max(0, Math.min(0.8, (+L.dim || 0) / 100)),
               saturate: Math.max(0, Math.min(2, (L.saturation == null ? 100 : +L.saturation) / 100)),
               tint: tint, amount: tint ? Math.max(0, Math.min(0.8, (+L.tint_amount || 0) / 100)) : 0,
               image: im && im.mode !== 'legacy' ? im : null };
    }
    // LANDSCAPES AS A BACKGROUND (2026-10-14): HK Frontend's own photos
    // (frontend/landscapes, the screensaver clock's). The list is the folder's
    // index.json -- a home's own files folder can answer with its own --
    // fetched once, the first time a screen needs it; every listener hears
    // when it has come. Until then a Landscapes background is Black.
    var LANDSCAPES = '/hk/landscapes/', LAND_FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(webp|jpe?g|png)$/i;
    // which one, and when it changes: this screen's choice, else All Screens'
    // -- 'wake', 'every:<minutes>' or a file name (Stay the Same)
    function landscapeChoice(b) {
      if (b === undefined) b = boardHere();
      return (b && b.sky_landscape) || get('sky.landscape', 'every:1440') || 'every:1440';
    }
    // a landscape's look: this screen's own, else All Screens' (photoLook's shape)
    function landscapeLook(b) {
      if (b === undefined) b = boardHere();
      return photoLook(b, (b && b.sky_landscape_look) || get('sky.landscape_look', null) || {});
    }
    // a page set to Landscapes: the screen's landscape, with the page's own
    // look (the room's, then Room Pages'), else the screen's landscape look
    function pageLandscape(key) {
      var b = boardHere(), lf = landscapeFile(landscapeChoice(b), landscapeList());
      var own = pageFind(keysOf(key), 'sky_page_looks', 'sky.page_looks');
      return { photo: lf ? LANDSCAPES + lf : null, look: own ? photoLook(b, own) : landscapeLook(b) };
    }
    // a page's own photo (for a page set to Photo): this screen's for it, else
    // All Screens', else the screen's Background photo
    function pagePhoto(key) {
      var b = boardHere();
      return pageFind(keysOf(key), 'sky_page_photos', 'sky.page_photos') || (b && b.sky_photo) || get('sky.photo', null) || null;
    }
    // a page's photo look: its own (the room's, then Room Pages'), else the
    // screen's (photoLook)
    function pageLook(key) {
      var own = pageFind(keysOf(key), 'sky_page_looks', 'sky.page_looks');
      return own ? photoLook(boardHere(), own) : photoLook();
    }
    // FLAT'S BACKGROUND FOR A PAGE (2026-10-16; settings.py FLAT_BACKGROUNDS):
    // {color: 'auto' | a FLAT_COLORS id | '#rrggbb'} or {photo: its address},
    // with the screen's fade (0-100). `key` as pageSky's; `own`: the page has
    // a ground of its own (Climate's sage ...), which Automatic keeps. A page
    // left alone is the screen's Background; a Photo or Landscape not there
    // yet is the theme's ground, never a blank.
    function flatBackground(key, own) {
      var b = boardHere(), keys = keysOf(key);
      var fade = b && b.sky_flat_fade != null ? b.sky_flat_fade : get('sky.flat_fade', 50);
      var mode = keys.length ? pageFind(keys, 'sky_flat_pages', 'sky.flat_pages') : null;
      if (!mode || mode === 'auto') {
        if (own) return { color: 'auto', fade: fade };
        var bg = (b && b.sky_flat_background) || get('sky.flat_background', 'color') || 'color';
        if (bg === 'photo') mode = 'screen-photo';
        else if (bg === 'landscapes') mode = 'landscapes';
        else return { color: (b && b.sky_flat_color) || get('sky.flat_color', 'auto') || 'auto', fade: fade };
      }
      var photo = null;
      if (mode === 'photo') photo = pagePhoto(keys);
      else if (mode === 'screen-photo') photo = (b && b.sky_photo) || get('sky.photo', null) || null;
      else if (mode === 'landscapes') {
        var lf = landscapeFile(landscapeChoice(b), landscapeList());
        photo = lf ? LANDSCAPES + lf : null;
      } else return { color: mode, fade: fade };
      // (the Fade's color, 2026-10-17: the screen's own, else All Screens')
      var tint = (b && b.sky_flat_tint) || get('sky.flat_tint', 'none') || 'none';
      // (a preview, never saved: ?hkflat_bgtint=accent | none | <hex>)
      try {
        var tp = /[?&]hkflat_bgtint=([#%23a-z0-9]+)/i.exec(location.search);
        if (tp) { tint = decodeURIComponent(tp[1]).toLowerCase(); if (/^[0-9a-f]{6}$/.test(tint)) tint = '#' + tint; }
      } catch (e) { /* no location */ }
      var tamt = b && b.sky_flat_tint_amount != null ? b.sky_flat_tint_amount : get('sky.flat_tint_amount', 60);
      var tl = b && b.sky_flat_tint_light != null ? b.sky_flat_tint_light : get('sky.flat_tint_light', 50);
      var imageLook = window.hkFlatImage ? window.hkFlatImage.resolve(get('sky', {}), b, keys).value : null;
      return photo ? { photo: photo, fade: fade, tint: tint, tintAmount: tamt, tintLight: tl, imageLook: imageLook } : { color: 'auto', fade: fade };
    }
    // a backdrop's stops by id, {day, night} -- "custom" this screen's own
    // colors (else All Screens'); null for the live sky or an unknown id
    function pageBackdrop(id) {
      var b = boardHere();
      var custom = b && b.sky_custom ? b.sky_custom : get('sky.gradient_custom', null);
      return backdropStops(id, custom);
    }
    // ANOTHER PAGE'S OWN LOOK, worn by that page while it waits beside this one (hk-pageswipe.js): the Calendar coming in
    // from the Pages screen is Blur where the Pages screen is Bright Glass (Home Only), and it wore the page's look until it
    // landed, then changed (2026-11-05, the owner: it "pops/switches appearance themes when it lands"). Null when it wears
    // the same as the page shown; else every look variable, `initial` where its look has none (none has a default in a
    // stylesheet: the root's own, taken off, is the same as unset)
    function lookAt(path) {
      var g = glass(path);
      if (!path || g === glass()) return null;
      var look = LOOKS[g](), vars = {};
      LOOK_VARS.forEach(function (k) { vars[k] = look[k] || 'initial'; });
      return { glass: g, vars: vars };
    }

    // what the shell and the later parts use of this one
    K.BLACK = BLACK; K.flatBackground = flatBackground; K.ladderSignature = ladderSignature; K.LAND_FILE = LAND_FILE;
    K.landscapeChoice = landscapeChoice; K.LANDSCAPES = LANDSCAPES; K.lookAt = lookAt; K.pageBackdrop = pageBackdrop;
    K.pageLandscape = pageLandscape; K.pageLook = pageLook; K.pagePhoto = pagePhoto; K.pageSky = pageSky;
    K.photoLook = photoLook; K.reducedMotion = reducedMotion; K.SKY_BACKDROPS = SKY_BACKDROPS; K.skyLook = skyLook;
    K.swipeLeft = swipeLeft; K.swipePages = swipePages; K.wallpaper = wallpaper;
  };
})();
