// hk-settings-module-glass.js - the glass, the frost, the tint and Bright Glass: the look's numbers.
//
// PART OF THE HK SETTINGS MODULE (window.hkSettings) (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsModuleParts = window.hkSettingsModuleParts || {})['hk-settings-module-glass'] = function (K) {
    var boardHere = K.boardHere, get = K.get, glass = K.glass;

    // ------------------------------------------------------------ the glass look
    // look.glass (Screens page):
    //   clear    the original plate; the status chips blur themselves
    //   frosted  a frosted MATERIAL everywhere and no blur at all -- drawn once,
    //            costs nothing per frame
    //   blur     ONE shared blur layer behind every glass surface (hk-glass.js);
    //            nothing blurs itself
    //   blur_pre the same layers holding a picture of the sky blurred once and
    //            pinned to the screen (hk-glass.js PRE-RENDERED): no live blur;
    //            the sky's motion does not show through
    //   tinted   Apple's Home app plate (2026-10-12): flat, semi-opaque, dark,
    //            and NO blur anywhere on the page -- no layer, no picture, no
    //            plate blurring itself; a contact shadow in place of the soft
    //            drop and the lit rim, no edge, the icon circles Dark or Light
    //            (look.well). Sheets and pop-ups keep their own blur (they
    //            blur while open, as Apple's do)
    //   blur_each  every glass surface blurs what is behind it (hkCards.M.glass
    //            reads --hk-glass-backdrop) -- for phones, iPads and
    //            computers: nothing to measure or line up, so a sheet opening, a
    //            press or a row scrolling can never leave the frost behind. NOT
    //            for wall tablets:
    // per-card backdrop-filter was measured unaffordable on entry-level Samsung
    // tablets (the cost is the NUMBER of blur surfaces: 22 of them halved the
    // frame rate and blanked cards); one shared layer held 90 fps. See
    // docs/ (each on its topic's page).
    //
    // THE AMOUNTS (House -> Look; a dashboard's Screen page can set its own),
    // each 0-100 %, 50 -- the middle of the slider -- as designed:
    //   look.frost  how milky the Frosted material is: the white sheen and the
    //               gray tint scale together, the grain stays (0: grain only)
    //   look.blur   how strong both blur looks are: 50 is 20 px, 100 is 40, 0
    //   look.tint   how dark the Tinted plate is: 0 is 40 %, 50 is 75 %, 100
    //               is 90 % (the user's 75 % in the middle, 2026-10-12)
    //               leaves only the darkening (saturate and brightness)
    //
    // THE MATERIAL IS SET HERE, not in hk-glass.js: this module loads before any
    // card draws and paints from its cached copy, so a frosted page never
    // flashes clear first. Every glass surface reads these through
    // hkCards.M.glass / the status chip's rule.
    var GRAIN = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'>' +
      '<filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/>' +
      '<feColorMatrix values=\'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.06 0\'/></filter>' +
      '<rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")';
    // key: 'frost' | 'blur' | 'tint' | 'bright' -- this dashboard's own (its Screen page), else
    // the house's (look.*).
    // THE SETTINGS SLIDER'S AMOUNT while it moves (hkSettings.previewAmount,
    // as the Side Pane's Dim): worn a few seconds past the last move, long
    // enough for the saved setting to come back
    var HELD = {}, HELD_T = {};
    function amount(key) {
      if (HELD.hasOwnProperty(key)) return HELD[key];
      var b = boardHere(), v = b && b[key];
      var n = (v === null || v === undefined || v === '') ? Number(get('look.' + key)) : Number(v);
      return isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
    }
    // `wash`: [r, g, b] in place of the gray -- Tint from Background
    // (hk-frosttint.js), a little stronger so the color reads (0.42 to 0.34)
    function frost(n, wash) {
      var f = n / 50, a = function (v) { return +Math.min(0.92, v * f).toFixed(3); };
      var w = wash ? 'rgba(' + wash.join(',') + ',' + a(0.42) + ')' : 'rgba(58,60,68,' + a(0.34) + ')';
      return GRAIN + ', linear-gradient(145deg, rgba(255,255,255,' + a(0.18) + '), rgba(255,255,255,' + a(0.09) + ')), ' +
        'linear-gradient(' + w + ', ' + w + ')';
    }
    // TINT FROM BACKGROUND, for this screen: its own when it sets one (not
    // null), else All Screens'; only ever with the Frosted look
    function frostTint() {
      if (glass() !== 'frosted') return false;
      var b = boardHere();
      if (b && typeof b.frost_tint === 'boolean') return b.frost_tint;
      return get('look.frost_tint') === true;
    }
    // TILE STYLE, for this screen (2026-10-30): its own when it sets one (not
    // null), else All Screens' -- 'home' (the Home app's layout) or 'centred'
    // (HomeView's): the Home Grid's tiles (the room pages keep the Home app's Tall pills, 2026-10-31)
    // ...or 'auto' (Automatic, the default: Centred on square cells -- the Home
    // Grid's own to say -- and Home elsewhere)
    function tileStyle() {
      var b = boardHere(), ok = function (v) { return v === 'auto' || v === 'home' || v === 'centred'; };
      if (b && ok(b.tile_style)) return b.tile_style;
      return ok(get('look.tile_style')) ? get('look.tile_style') : 'auto';
    }
    // A CENTRED TILE'S GLYPH WHILE OFF, for this screen (2026-11-07, settings model.py TILE_ICONS): its own, else All
    // Screens' -- 'auto' (the look's: white on Bright Glass, else the glyph's color), 'color' or 'white'
    function tileIcons() {
      var b = boardHere(), ok = function (v) { return v === 'auto' || v === 'color' || v === 'white'; };
      if (b && ok(b.tile_icons)) return b.tile_icons;
      return ok(get('look.tile_icons')) ? get('look.tile_icons') : 'auto';
    }
    // Over a blur: the plate the status chips always had over their own.
    var OVER_BLUR = 'linear-gradient(145deg, rgba(255,255,255,0.16), rgba(255,255,255,0.07))';
    // The chips' own blur (hk-chip.js), at the chosen strength: the shared
    // layer's (hk-glass.js reads --hk-blur-filter) and every plate's.
    function blurFilter(n) {
      return 'blur(' + +(20 * n / 50).toFixed(1) + 'px) saturate(1.4) brightness(0.82)';
    }
    // TINTED's plate: black with a touch of blue, as the Home app's off tile
    // measured (0.68-0.73 x the ground behind it, which it also blurs -- with
    // no blur the ground shows through sharply, hence darker). Two straight
    // pieces so the middle of the slider is the chosen 75 %.
    function tintAlpha(n) {
      var a = n <= 50 ? 0.40 + 0.35 * n / 50 : 0.75 + 0.15 * (n - 50) / 50;
      return +a.toFixed(3);
    }
    // the icon circle on an off plate: Apple's, darker than the plate, or a
    // light one that keeps its shape over dark ground -- this screen's own
    // (its Screen page), else the house's
    var TINT_WELLS = { dark: 'rgba(0, 0, 0, 0.24)', light: 'rgba(255, 255, 255, 0.10)' };
    function tintWell() {
      var b = boardHere(), v = b && b.well;
      if (!TINT_WELLS[v]) v = get('look.well');
      return TINT_WELLS[v] ? v : 'dark';
    }
    var LOOKS = {
      clear:     function () { return {}; },
      frosted:   function () { var m = frost(amount('frost')); return { '--hk-glass-plate': m, '--hk-chip-plate': m, '--hk-chip-backdrop': 'none' }; },
      blur:      function () {
        return { '--hk-glass-plate': OVER_BLUR, '--hk-chip-backdrop': 'none', '--hk-blur-filter': blurFilter(amount('blur')) };
      },
      // the shared layers wearing a still picture of the sky, blurred once
      // (hk-glass.js PRE-RENDERED): to every card the same as blur
      blur_pre:  function () { return LOOKS.blur(); },
      // no blur at all: a flat plate, Apple's contact shadow (one dark pixel
      // under the edge, nothing past it -- measured off the Home app), no lit
      // rim, no edge (the 1 px box stays, transparent: the info card lines up
      // on it). Cards on a dark sheet wear a light lift instead
      // (--hk-glass-plate-sheet, hkCards.M.bg); the speaker picker's
      // shortcuts keep a dashed edge of their own (--hk-look-dash)
      tinted:    function () {
        var p = 'rgba(28, 28, 30, ' + tintAlpha(amount('tint')) + ')';
        return { '--hk-glass-plate': p, '--hk-chip-plate': p, '--hk-chip-backdrop': 'none',
                 '--hk-glass-plate-sheet': 'rgba(255, 255, 255, 0.08)',
                 '--hk-look-edge': '1px solid transparent', '--hk-look-edge-color': 'transparent',
                 '--hk-look-shadow': '0 1px 2px rgba(0, 0, 0, 0.28)',
                 '--hk-look-well': TINT_WELLS[tintWell()],
                 '--hk-look-dash': '1px dashed rgba(255, 255, 255, 0.32)',
                 // a FLOATING strip over the page (the Energy tabs once they
                 // float): no blur either, the menu's and tab bar's own plate
                 '--hk-float-plate': 'rgba(24, 24, 28, 0.93)', '--hk-float-backdrop': 'none' };
      },
      // every plate blurs itself, the chips too
      blur_each: function () {
        var b = blurFilter(amount('blur'));
        return { '--hk-glass-plate': OVER_BLUR, '--hk-glass-backdrop': b, '--hk-chip-backdrop': b };
      }
    };
    // ------------------------------------------------------------ Bright Glass
    // BRIGHT GLASS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase D; the house
    // DESIGN.md "Bright Glass"): the sixth look -- clear glass, a light blur and
    // a bright rim, for vivid backgrounds (the Wallpapers). In the Blur look's
    // three modes: bright (Shared Layer: hk-glass.js's layers, the filter
    // below), bright_pre (Pre-rendered) and bright_each (every plate its own).
    //   plate   a white wash, brighter at the top left (BRIGHT.wash, at its
    //           0 %, 45 % and 100 %), with the background's light stop mixed in
    //           at 7 % -- the lightest of the sky's four stops (--sk0..3 on
    //           #hk-sky: a wallpaper's, a color's, the live sky's)
    //   blur    BLUR.bright: 4 px, so the wallpaper's edges show through
    //   rim     inset shadows (no mask, no extra layer), a glow, a soft shadow
    //   text    ink; the second line (--hk-look-sub) the light stop 30 % into
    //           white .78; a light text shadow; off glyphs white .94
    // STRENGTH (look.bright / a screen's bright, 0-100, 50 as designed) scales
    // the wash and the lift together. CAPPED: never past where white text on
    // the plate falls under 4.5:1 over the light stop (brightCap) -- so on a
    // light background the glass holds back by itself.
    // DIM (look.bright_dim / a screen's bright_dim, 0-BRIGHT_DIM_MAX %, 0 as
    // designed; 2026-11-01, the owner: like the Side Pane's Dim): a shade over
    // the glass, under the words -- the cards, the chips, the floating plates,
    // the bars (--hk-bright-shade: the tab bar's and the side menu's own
    // plates), and the Side Pane's when its Dim is Same as the Glass
    // (--hk-bright-dim). Only darker, so the cap's 4.5:1 only grows.
    var BRIGHT = {
      wash: [0.24, 0.09, 0.05], chip: [0.30, 0.12, 0.07], lift: 0.08, mix: 0.07,
      rim: 'inset 0 0 0 1.5px rgba(255,255,255,0.22), inset 0 1.5px 0 rgba(255,255,255,0.30)',
      glow: 'inset 0 0 24px rgba(255,255,255,0.06)', shadow: '0 6px 20px rgba(40,0,60,0.10)',
      well: 'rgba(255,255,255,0.16)', glyph: 'rgba(255,255,255,0.94)', textShadow: '0 1px 2px rgba(0,0,0,0.18)',
      // a sheet or a pop-up: a deep tint under a white sheen, over its heavier
      // blur held down a little, the rim; a control set into it .14. It was
      // white .22 over blur(34px) saturate(2): over the blue wallpaper the
      // Rooms sheet came out a bright, clear blue that white names and pale
      // icon circles were hard to read on (the owner, 2026-10-30). The tint
      // keeps white text over 4.5:1 above the lightest wallpaper stop.
      sheet: 'linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04) 55%), rgba(14,20,38,0.55)',
      sheetBlur: 'blur(34px) saturate(1.5) brightness(0.86)', setIn: 'rgba(255,255,255,0.14)',
      sheetShadow: '0 26px 64px rgba(0,0,0,0.30)',
      // a bar (the tab bar's, the Edit mode bar)
      bar: 'linear-gradient(150deg, rgba(255,255,255,0.30), rgba(255,255,255,0.14))', barShadow: '0 10px 30px rgba(0,0,0,0.18)'
    };
    var BRIGHT_DIM_MAX = 60;
    function isBright(g) { return g === 'bright' || g === 'bright_pre' || g === 'bright_each'; }
    function rgbOf(s) {
      s = String(s || '').trim();
      var m = /^#([0-9a-f]{6})$/i.exec(s);
      if (m) { var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
      m = /rgba?\(([^)]+)\)/.exec(s);
      return m ? m[1].split(',').slice(0, 3).map(function (x) { return parseFloat(x); }) : null;
    }
    // WCAG's relative luminance and contrast
    function relLum(c) {
      var f = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    }
    function overRgb(top, a, under) { return under.map(function (v, i) { return top[i] * a + v * (1 - a); }); }
    // white text (ink, .94) on the plate where text sits -- its 45 % stop, the
    // light mix -- over `stop` lifted by the filter, at Strength `n`
    function brightContrast(stop, light, n) {
      var k = n / 50, under = stop.map(function (v) { return Math.min(255, v * (1 + BRIGHT.lift * k)); });
      var plate = overRgb(light, BRIGHT.mix, overRgb([255, 255, 255], BRIGHT.wash[1] * k, under));
      var text = overRgb([255, 255, 255], 0.94, plate), a = relLum(text), b = relLum(plate);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    // the lightest of the four stops (relative luminance), or null
    function lightStop(stops) {
      var best = null;
      (stops || []).forEach(function (s) { var c = rgbOf(s); if (c && (!best || relLum(c) > relLum(best))) best = c; });
      return best;
    }
    // THE CAP: the highest Strength (0-100) at which white text keeps 4.5:1 over
    // the lightest stop; 0 when even the bare glass can't (a very light sky)
    function brightCap(stops) {
      var light = lightStop(stops);
      if (!light) return 100;
      for (var n = 100; n > 0; n--) if (brightContrast(light, light, n) >= 4.5) return n;
      return 0;
    }
    // the four stops the sky paints now (their targets, not a cross-fade's
    // middle), or null with no sky
    function skyStops() {
      var S = window.hkSky, el = S && S.element ? S.element() : null;
      if (!el || !el.style) return null;
      var st = [0, 1, 2, 3].map(function (i) { return el.style.getPropertyValue('--sk' + i); });
      return st.every(function (x) { return rgbOf(x); }) ? st : null;
    }
    function rgba(c, a) { return 'rgba(' + c.map(function (v) { return Math.round(v); }).join(', ') + ', ' + a + ')'; }
    function brightWash(alphas, k, light) {
      var w = function (i) { return 'rgba(255, 255, 255, ' + +(alphas[i] * k).toFixed(3) + ')'; };
      var mix = light ? rgba(light, BRIGHT.mix) : 'rgba(255, 255, 255, 0)';
      return 'linear-gradient(' + mix + ', ' + mix + '), linear-gradient(160deg, ' + w(0) + ' 0%, ' + w(1) + ' 45%, ' + w(2) + ')';
    }
    // the look's variables at Strength `n` (capped by `stops`, the sky's), in
    // a mode ('each': every plate blurs itself), at Dim `dim` (%)
    function brightLook(n, stops, each, dim) {
      var light = lightStop(stops), k = Math.min(n, brightCap(stops)) / 50;
      var filter = 'blur(4px) saturate(1.3) brightness(' + +(1 + BRIGHT.lift * k).toFixed(3) + ')';
      // --sub: the light stop 30 % into white .78 (color-mix's arithmetic,
      // worked out here: a wall tablet's WebView may not have color-mix)
      var l = light || [255, 255, 255], sa = 0.3 + 0.7 * 0.78;
      var sub = rgba(l.map(function (v) { return (0.3 * v + 0.7 * 0.78 * 255) / sa; }), +sa.toFixed(3));
      var out = { '--hk-glass-plate': brightWash(BRIGHT.wash, k, light), '--hk-chip-plate': brightWash(BRIGHT.chip, k, light),
                  '--hk-chip-backdrop': 'none', '--hk-blur-filter': filter,
                  '--hk-look-edge': '1px solid transparent', '--hk-look-edge-color': 'transparent',
                  '--hk-look-shadow': BRIGHT.rim + ', ' + BRIGHT.glow + ', ' + BRIGHT.shadow,
                  '--hk-look-well': BRIGHT.well, '--hk-look-glyph-off': BRIGHT.glyph, '--hk-look-sub': sub,
                  '--hk-look-text-shadow': BRIGHT.textShadow,
                  '--hk-glass-plate-sheet': BRIGHT.setIn,
                  '--hk-sheet-plate': BRIGHT.sheet, '--hk-sheet-backdrop': BRIGHT.sheetBlur,
                  '--hk-sheet-edge': '1px solid transparent', '--hk-sheet-shadow': BRIGHT.rim + ', ' + BRIGHT.sheetShadow,
                  '--hk-float-plate': brightWash(BRIGHT.chip, k, light), '--hk-float-backdrop': filter,
                  // the tab bar's plate, worn by the bars that aren't the tab
                  // bar's own (the Edit mode bar)
                  '--hk-bar-plate': BRIGHT.bar, '--hk-bar-backdrop': filter, '--hk-bar-edge': '1px solid transparent',
                  '--hk-bar-shadow': BRIGHT.rim + ', ' + BRIGHT.barShadow };
      if (each) { out['--hk-glass-backdrop'] = filter; out['--hk-chip-backdrop'] = filter; }
      var d = Math.max(0, Math.min(BRIGHT_DIM_MAX, Number(dim) || 0)) / 100;
      if (d > 0) {
        var shade = 'linear-gradient(rgba(0, 0, 0, ' + d + '), rgba(0, 0, 0, ' + d + '))';
        ['--hk-glass-plate', '--hk-chip-plate', '--hk-float-plate', '--hk-bar-plate'].forEach(function (k) { out[k] = shade + ', ' + out[k]; });
        out['--hk-bright-shade'] = shade;
        out['--hk-bright-dim'] = String(d);
      }
      return out;
    }
    // this page's Dim: the slider's while it moves, this screen's own, else
    // All Screens'
    function brightDim() {
      var v = HELD.hasOwnProperty('bright_dim') ? HELD.bright_dim : null, b = boardHere();
      if (v === null) v = b && b.bright_dim != null && b.bright_dim !== '' ? b.bright_dim : get('look.bright_dim', 0);
      var n = Number(v);
      return isFinite(n) ? Math.max(0, Math.min(BRIGHT_DIM_MAX, Math.round(n))) : 0;
    }
    // looks taken out, worn as the one that replaced them (settings.py
    // RETIRED_GLASS) -- a cached copy from before may still name one
    var RETIRED = { blur_baked: 'blur_pre' };
    var LOOK_VARS = ['--hk-glass-plate', '--hk-chip-plate', '--hk-chip-backdrop', '--hk-glass-backdrop',
                     '--hk-blur-filter', '--hk-glass-plate-sheet', '--hk-look-edge', '--hk-look-edge-color',
                     '--hk-look-shadow', '--hk-look-well', '--hk-look-dash', '--hk-float-plate', '--hk-float-backdrop',
                     // Bright Glass's own (2026-10-30)
                     '--hk-look-glyph-off', '--hk-look-sub', '--hk-look-text-shadow',
                     '--hk-sheet-plate', '--hk-sheet-backdrop', '--hk-sheet-edge', '--hk-sheet-shadow',
                     '--hk-bar-plate', '--hk-bar-backdrop', '--hk-bar-edge', '--hk-bar-shadow',
                     // ...and its Dim (2026-11-01)
                     '--hk-bright-shade', '--hk-bright-dim'];
    // A DASHBOARD'S OWN LOOK: its item's Screen page, else the house's.
    // Re-applied as the page moves between dashboards (location-changed).
    // One policy for cards, overlays, sky, media and screensaver. Explicit
    // false is an opt-out, not an absent value. Keep the saved glass intact.
    function appearance(b, look) {
      b = b || {}; look = look || {};
      var ownGlass = b.glass && b.glass !== 'house';
      var enabled = typeof b.flat === 'boolean' ? b.flat : (!ownGlass && look.flat === true);
      var theme = b.flat_theme === 'light' || b.flat_theme === 'dark' ? b.flat_theme : look.flat_theme;
      return { flat: enabled, theme: theme === 'light' ? 'light' : 'dark' };
    }
    function isBrightLook(g) { return g === 'bright' || g === 'bright_pre' || g === 'bright_each'; }
    function brightPages(b) {
      var own = b && b.bright_pages;
      if (own === 'home' || own === 'all') return own;
      return get('look.bright_pages', 'home') === 'all' ? 'all' : 'home';
    }
    // this screen's Home: its first page (the address's page segment empty, '0'
    // or the first view's path)
    function onHome(path) {
      var here = '';
      try { here = decodeURIComponent((String(path || location.pathname).split('/')[2] || '').split('?')[0]); } catch (e) { return true; }
      if (!here || here === '0' || here === 'home') return true;
      var M = window.hkCards && window.hkCards.menu, cfg = M && M.config ? M.config() : null, vs = (cfg && cfg.views) || [];
      if (vs[0] && vs[0].path === here) return true;
      // ...and the Pages screen, Home's other half: it wears Home's background
      // (the owner, 2026-10-31: Bright Glass's Home Only "should apply to the
      // Pages Screen, right? Since they are essentially shared")
      return vs.some(function (v) { return v && v.pages_screen && String(v.path) === here; });
    }

    // what the shell and the later parts use of this one
    K.amount = amount; K.appearance = appearance; K.BRIGHT_DIM_MAX = BRIGHT_DIM_MAX; K.brightCap = brightCap;
    K.brightContrast = brightContrast; K.brightDim = brightDim; K.brightLook = brightLook;
    K.brightPages = brightPages; K.frost = frost; K.frostTint = frostTint; K.HELD = HELD; K.HELD_T = HELD_T;
    K.isBright = isBright; K.isBrightLook = isBrightLook; K.LOOK_VARS = LOOK_VARS; K.LOOKS = LOOKS; K.onHome = onHome;
    K.RETIRED = RETIRED; K.rgbOf = rgbOf; K.skyStops = skyStops; K.tileIcons = tileIcons; K.tileStyle = tileStyle;
    K.tintWell = tintWell;
  };
})();
