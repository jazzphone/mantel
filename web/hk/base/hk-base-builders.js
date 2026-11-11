// hk-base-builders.js - the builders: plates, tiles, title rows, heads, flat grounds and material.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-builders'] = function (K) {
    var ACCENTS = K.ACCENTS, BLUR = K.BLUR, CARD = K.CARD, FLAT = K.FLAT, FLAT_ROOTS = K.FLAT_ROOTS,
        flatTone = K.flatTone, legacyAccentHex = K.legacyAccentHex, M = K.M, markAsleep = K.markAsleep,
        ON_PAGE = K.ON_PAGE, PAGE_ACCENTS = K.PAGE_ACCENTS, ST = K.ST, TILE = K.TILE, tone = K.tone, TYPE = K.TYPE,
        v = K.v;

    // ----------------------------------------------------------- the builders
    // A PLATE as one declaration: corner, the material (M.glass: the look's
    // plate first, the shared-blur marker, the Blur-each backdrop), the edge,
    // and the shadow by size -- the look's (--hk-look-shadow, Tinted's contact
    // shadow) first, as every plate has read it. A tile casts the pill's
    // shadow; a page card and a panel the tall one. Clipping is the card's call.
    var PLATE_SHADOW = { tile: 'glass-shadow-pill', card: 'glass-shadow-tall', panel: 'glass-shadow-tall' };
    // A BLOCK'S OWN BOX (2026-10-24, Home Grid's Hide Box): a card's or a
    // panel's plate reads --hk-block-* first, which a boxless grid cell sets
    // (clear, no edge, no shadow, no frost: --hk-block-glass 0 takes it out of
    // the shared blur). A tile's plate never does, so the pills and controls
    // inside a boxless block keep theirs.
    function plate(kind) {
      var sh = PLATE_SHADOW[kind];
      if (!sh) throw new Error('hkCards.plate: no plate ' + kind);
      if (kind === 'tile') {
        return 'border-radius:' + M.radius + ';' + M.glass + ';border:' + M.border +
          ';box-shadow:var(--hk-look-shadow, ' + v(sh) + ')';
      }
      // (--hk-block-radius: a square cell's corners, hk-home-grid-view -- one
      // radius, or four where a Square screen's corner rounds one of them)
      return 'border-radius:var(--hk-block-radius, ' + M.radius + ');background:var(--hk-block-plate, ' + M.bg + ');--hk-glass-surface:var(--hk-block-glass, 1);' +
        'backdrop-filter:var(--hk-block-backdrop, var(--hk-glass-backdrop,none));-webkit-backdrop-filter:var(--hk-block-backdrop, var(--hk-glass-backdrop,none))' +
        ';border:var(--hk-block-edge, ' + M.border + ');box-shadow:var(--hk-block-shadow, var(--hk-look-shadow, ' + v(sh) + '))';
    }
    // A CENTRED TILE'S CSS (TILE.centred) over a tile's parts, named by `s`: { host (the variant's :host), plate, lit,
    // well, icon, name, sub (a list) }: the tall cell's numbers, then the square cell's where the cell (hk-cell) is
    // square. The tile's own layout rules are more specific than a variant can be, so the variant's say !important.
    function centredTile(s) {
      var C0 = TILE.centred, I = ' !important';
      var at = function (pre, parts) { return parts.map(function (p) { return s.host + ' ' + (pre ? pre + ' ' : '') + p; }).join(','); };
      var fit = function (px) { return 'min(max(' + px + 'px,' + (100 * px / 196).toFixed(2) + 'cqmin),45cqmin)'; };
      var one = function (g) {
        return at('', [s.well]) + '{width:' + g.box + 'px' + I + ';height:' + g.box + 'px' + I + ';top:' + g.at + '%' + I + '}' +
          at('', [s.icon]) + '{width:' + g.glyph + 'px' + I + ';height:' + g.glyph + 'px' + I + '}' +
          at('', [s.name]) + '{top:' + g.text + '%' + I + ';font-size:' + g.name + 'px' + I + ';line-height:' + g.line + 'px' + I + '}' +
          at('', s.sub) + '{top:calc(' + g.text + '% + ' + g.line + 'px)' + I + ';font-size:' + g.sub + 'px' + I + ';line-height:' + g.line + 'px' + I + '}';
      };
      var text = 'position:absolute' + I + ';left:' + C0.inset + 'px' + I + ';right:' + C0.inset + 'px' + I + ';margin:0' + I + ';width:auto' + I +
        ';display:block' + I + ';text-align:center' + I + ';white-space:nowrap' + I + ';overflow:hidden;text-overflow:ellipsis;letter-spacing:' + C0.track + 'px' + I;
      return at('', [s.plate]) + '{position:relative}' +
        // (translate: Flat takes a pressed box's transform -- 2026-11-10
        at('', [s.well]) + '{position:absolute' + I + ';left:50%' + I + ';margin:0' + I + ';translate:-50% -50%;border-radius:50%;' +
          'display:flex;align-items:center;justify-content:center}' +
        // the glyph bare, off and lit (lit in its own colour on the white plate: the card's)
        at('', [s.well]) + '{background:none' + I + '}' +
        at('', [s.name]) + '{' + text + ';font-weight:600' + I + '}' +
        at('', s.sub) + '{' + text + ';font-weight:400' + I + ';color:' + v('ink-2') + I + '}' +
        at(s.lit, s.sub) + '{color:' + v('ink-on-state') + I + '}' +
        // (square where 170 px tall or about square -- a Large Accessories block's ~179 px tiles, an XL group's 2 x 2 ~178, 2026-11-07; fit: grows past 196, <= 45cqmin)
        one(C0.tall) + '@container hk-cell (min-height:170px) or (max-aspect-ratio: 6 / 5) or style(--hk-cell-shape: square){' + one(C0.square) +
          at('', [s.well]) + '{width:' + fit(C0.square.box) + I + ';height:' + fit(C0.square.box) + I + '}' + at('', [s.icon]) + '{width:' + fit(C0.square.glyph) + I + ';height:' +
            fit(C0.square.glyph) + I + '}}' + '@container hk-cell (max-height:140px) and (min-aspect-ratio: 6 / 5){' + one(C0.short) + '}';
    }
    // ONE TITLE ROW (the Energy page's): the name left, the detail right, one baseline, 20 px tall. `sel` is the row (default .ttl); its <b> is the name, its <span> the detail.
    function titleRow(sel) {
      sel = sel || '.ttl';
      return sel + '{display:flex;justify-content:space-between;align-items:baseline;gap:10px;min-height:20px;line-height:20px;flex:none}' +
        sel + ' b{font-size:15px;font-weight:600;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        sel + ' span{font-size:13px;font-weight:500;color:' + v('ink-2') + ';white-space:nowrap}';
    }
    function typeOf(role, fallback) {
      var t = TYPE[role || fallback];
      if (!t) throw new Error('hkCards: no type role ' + role);
      return t;
    }
    // A LABEL (13 / 600 / 0.3 uppercase, secondary ink; `label-small` 11 / 0.4): declarations, no braces.
    function labelCss(role) {
      var t = typeOf(role, 'label');
      return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '') +
        (t.upper ? ';text-transform:uppercase' : '') + ';color:' + v('ink-2');
    }
    // A BLOCK'S HEADING (2026-11-08, the owner: titles "all need to match ... the same gray color, format/layout and spacing"; a block's own name printed on it goes; "The title of the music card, is
    // how
    // I would like the titles to look"; then "headings similar to the weather page, but without the glyph ... we aren't really using caps like this anywhere"): the Weather page's
    // section title (.wxp .tt: 13 / 600, the secondary gray, as written -- "Recently Played", not capitals) everywhere, a 16 px line on the block's text inset (18 square, 14 tile), on a 19 px row
    // (HEAD.row), the content HEAD.gap under it; a word at the row's right ("+3 more") the same style. headCss(sel): the heading's text; headRowCss(sel): its row.
    var HEAD = { row: 19, gap: 8 };
    function headCss(sel) { return sel + '{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:' + v('ink-2') +
      ';line-height:16px;margin:0;padding:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}'; }
    function headRowCss(sel) { return sel + '{display:flex;align-items:center;justify-content:space-between;gap:10px;height:' + HEAD.row + 'px;flex:none;min-width:0;margin:0 0 ' + HEAD.gap + 'px 0}';
      }
    // THE PAGE CARD (the Energy page's, and the page headers'): the plate and padding at a fixed height (--hk-ep-h), the one title row (.ttl), and the shared pieces -- .wait, .num,
    // the figure (.big, its unit in <u>), the caption (.cap) and the label (.k, its dot <i>). `cls` is the hk-plate's class. Defined below figureCss (it uses it), hoisted.
    function pageCardCss(cls) {
      return [
        'hk-plate.' + cls + '{box-sizing:border-box;display:flex;flex-direction:column;height:var(--hk-ep-h,320px);',
        '  padding:' + CARD.pad + ';margin:0;' + plate('card') + ';overflow:hidden;',
        '  color:' + v('ink') + ';container-type:inline-size;',
        '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
        // in a Sections view: the cell's own height
        ':host([data-hk-cell]) hk-plate.' + cls + '{height:100%}',
        // ONE TITLE ROW for every card: the name left, the detail right, one baseline
        titleRow('.ttl'),
        '.wait{margin:auto;font-size:14px;color:' + v('ink-3') + '}',
        '.num{font-variant-numeric:tabular-nums}',
        '.big{' + figureCss('figure') + ';white-space:nowrap}',
        '.big u{text-decoration:none;font-size:15px;font-weight:600;letter-spacing:0;margin-left:3px;color:' + v('ink-2') + '}',
        '.cap{font-size:14px;line-height:18px;color:' + v('ink-2') + '}',
        '.k{display:flex;align-items:center;gap:7px;' + labelCss('label') + ';white-space:nowrap}',
        '.k i{width:10px;height:10px;border-radius:50%;flex:none}'
      ].join('');
    }
    // A FIGURE (30 / 700 / -0.6, a tight line): declarations, no braces.
    function figureCss(role) {
      var t = typeOf(role, 'figure');
      return 'font-size:' + t.size + 'px;font-weight:' + t.weight + ';line-height:1.05' +
        (t.track ? ';letter-spacing:' + t.track : '');
    }

    // ANY TYPE ROLE, as declarations, no braces: its size, weight and
    // tracking (the Home Grid's cards set their text by role, docs/phase11/HOME-GRID.md)
    function typeCss(role) {
      var t = typeOf(role);
      return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '') +
        (t.upper ? ';text-transform:uppercase' : '');
    }

    // A group's outer plate only. These properties never tint or fade its pills.
    function groupSurface(el, surface) {
      if (!el || !el.style || !surface && !el._hkGroupBase) return;
      var key = JSON.stringify(surface || null);
      if (key !== el._hkGroupSurfaceKey) {
        el._hkGroupSurfaceKey = key;
        var root = el.getRootNode(), owner = root.host || el.parentElement;
        if (window.hkGlass && owner) window.hkGlass.changed(owner, true);
      }
      var keys = ['background', 'backdrop-filter', '-webkit-backdrop-filter', '--hk-glass-surface'];
      var base = el._hkGroupBase;
      if (!base) { base = el._hkGroupBase = {}; keys.forEach(function (k) { base[k] = [el.style.getPropertyValue(k), el.style.getPropertyPriority(k)]; }); }
      keys.forEach(function (k) { if (base[k][0]) el.style.setProperty(k, base[k][0], base[k][1]); else el.style.removeProperty(k); });
      el.removeAttribute('data-group-custom');
      if (!surface || !/^#[0-9a-f]{6}$/i.test(surface.color || '')) return;
      var hex = surface.color.slice(1), rgb = [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
      var opacity = Math.max(0, Math.min(100, Number(surface.opacity)));
      if (!Number.isFinite(opacity)) return;
      el.style.setProperty('background', 'rgba(' + rgb.join(',') + ',' + opacity / 100 + ')', 'important');
      el.setAttribute('data-group-custom', '');
      if (surface.blur && surface.blur !== 'screen') {
        var blur = surface.blur === 'none' ? 'none' : BLUR[surface.blur];
        if (!blur) return;
        el.style.setProperty('--hk-glass-surface', '0');
        el.style.setProperty('backdrop-filter', blur, 'important');
        el.style.setProperty('-webkit-backdrop-filter', blur, 'important');
      }
    }
    var FLAT_GROUNDS = {
      home: ['#EEECE6','#17181A'], climate: ['#EAF0ED','#151C1B'], lights: ['#F1ECE3','#1D1A16'],
      security: ['#E9EDF0','#171B20'], calendar: ['#EEEBF1','#1C1821'], weather: ['#E8EEF2','#151C23']
    };
    function flatGround(page, theme) { return (FLAT_GROUNDS[page] || FLAT_GROUNDS.home)[theme === 'light' ? 0 : 1]; }
    // FLAT'S COLORS (Sky / Background while Flat is on): settings.py
    // FLAT_COLORS, which tests/py/test_flat.py holds this to -- a Light and a
    // Dark tone each. 'auto' is the page's own ground (flatGround).
    var FLAT_COLORS = [
      { id: 'stone', label: 'Stone', light: '#EEECE6', dark: '#17181A' },
      { id: 'paper', label: 'Paper', light: '#F7F6F2', dark: '#232427' },
      { id: 'sand', label: 'Sand', light: '#F1ECE3', dark: '#1D1A16' },
      { id: 'sage', label: 'Sage', light: '#EAF0ED', dark: '#151C1B' },
      { id: 'mist', label: 'Mist', light: '#E9EDF0', dark: '#171B20' },
      { id: 'sky', label: 'Sky', light: '#E6EEF5', dark: '#141C26' },
      { id: 'lavender', label: 'Lavender', light: '#EEEBF1', dark: '#1C1821' },
      { id: 'blush', label: 'Blush', light: '#F4EAE7', dark: '#211718' },
      { id: 'black', label: 'Black', light_label: 'Pebble', light: '#E2E1DC', dark: '#000000' }
    ];
    // a Flat color as drawn: 'auto' the page's ground, an id its theme's tone,
    // '#rrggbb' itself
    function flatColorHex(id, theme, page) {
      if (/^#[0-9a-f]{6}$/i.test(id || '')) return id;
      for (var i = 0; i < FLAT_COLORS.length; i++) if (FLAT_COLORS[i].id === id) return FLAT_COLORS[i][theme === 'light' ? 'light' : 'dark'];
      return pageTone(page, theme) || flatGround(page, theme);
    }
    // A PAGE'S AUTOMATIC GROUND FROM ITS ACCENT (2026-10-17, the user): the
    // page's Accent Color (HK Settings -> the page -> Look) a tenth of the
    // way into Light's paper, an eighth into Dark's near-black -- a red page
    // blush or deep wine, a blue one pale sky or navy. Home and the rooms,
    // which have no accent, keep the theme's stone. null: no accent.
    function pageTone(page, theme) {
      var hex = pageAccentHex(page);
      if (!hex) return null;
      var c = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
      var light = theme === 'light', base = light ? [244, 242, 238] : [20, 21, 23], f = light ? 0.10 : 0.13;
      return '#' + c.map(function (v, i) { var x = Math.round(v * f + base[i] * (1 - f)); return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    }
    // a page kind's accent as a hex: its own (look.page_accents), else
    // PAGE_ACCENTS' default; null for a page that has none (home, rooms)
    function pageAccentHex(kind) {
      if (!kind || !PAGE_ACCENTS[kind]) return null;
      var S = window.hkSettings, own = S && S.get ? (S.get('look.page_accents', {}) || {})[kind] : null;
      var a = String(own || PAGE_ACCENTS[kind]).toLowerCase();
      return ACCENTS[a] || (/^#[0-9a-f]{6}$/.test(a) ? a : null);
    }
    // AN APP ICON (the Pages screen's; the tab bar's More and Rooms sheets,
    // 2026-10-31): a rounded square in a colour, a little lighter at the top,
    // a little deeper at the foot, as iPadOS's own. A page's colour is its
    // accent (pageAccentHex); rooms have none, so each takes one by its place
    // in the menu's rooms -- the same room the same colour in both places.
    var ROOM_TINTS = ['orange', 'yellow', 'indigo', 'teal', 'green', 'pink', 'blue', 'purple', 'mint', 'red', 'cyan'];
    function roomTint(i) { return ROOM_TINTS[(i || 0) % ROOM_TINTS.length]; }
    function iconMix(hex, to, f) {
      var c = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
      return '#' + c.map(function (x) {
        var y = Math.round(x + (to - x) * f);
        return (y < 16 ? '0' : '') + y.toString(16);
      }).join('');
    }
    function iconGradient(hex) {
      if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#8e8e93';
      return [iconMix(hex, 255, 0.18), iconMix(hex, 0, 0.08)];
    }
    // the photo's fade: the theme's own ground over it, `fade` 0..100
    function flatFade(fade, theme) {
      var f = Math.max(0, Math.min(100, fade == null ? 50 : +fade || 0)) / 100;
      return theme === 'light' ? 'rgba(238,236,230,' + (f * 0.92).toFixed(3) + ')' : 'rgba(10,11,12,' + (f * 0.9).toFixed(3) + ')';
    }
    // the accent a photo's Tint matches: Flat's chosen accent, else the
    // page's own highlight
    function flatAccentHex() { var p = flatPalette(); return (p && p.seed) || legacyAccentHex(); }
    // Contrast-adjust semantic colors, never infer roles from computed DOM.
    // A color is resolved once per role/theme and cached; no canvas sampling.
    var flatColors = {};
    // ON, BRIGHT (the user, 2026-10-17: muted while off, bright when on):
    // Apple's light-appearance system colors for the dark ones HK draws with
    // -- made for a pale ground, so a lit well or glyph keeps its color
    // instead of being darkened toward brown
    var APPLE_LIGHT = { '255,214,10': '#FFCC00', '255,204,0': '#FFCC00', '255,159,10': '#FF9500', '48,209,88': '#34C759',
      '100,210,255': '#32ADE6', '10,132,255': '#007AFF', '64,200,224': '#30B0C7', '99,230,226': '#00C7BE',
      '191,90,242': '#AF52DE', '255,69,58': '#FF3B30', '255,55,95': '#FF2D55', '94,92,230': '#5856D6' };
    function flatColor(color, role) {
      var S = window.hkSettings, a = S && S.rendering ? S.rendering() : {};
      // (Dark keeps every color as the other looks draw it -- a lit well was
      // darkened toward brown there too, 2026-10-17)
      if (!a.flat || a.theme !== 'light') return color;
      var key = color + '|' + role, hit = flatColors[key]; if (hit) return hit;
      var hex = /^#([0-9a-f]{6})$/i.exec(color), rgb = /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(color);
      var c = hex ? [0,2,4].map(function (i) { return parseInt(hex[1].slice(i,i+2),16); }) : rgb ? rgb.slice(1,4).map(Number) : null;
      if (!c) return color;
      // a lit well or a lit bare glyph on Light: the Apple color, else its own
      if ((role === 'well' || role === 'on') && a.theme === 'light') {
        var bright = APPLE_LIGHT[c.join(',')];
        if (bright || role === 'on') return flatColors[key] = bright || color;
      }
      function lum(v) { return v.map(function (x) { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055,2.4); }).reduce(function (n,x,i) { return n + x * [.2126,.7152,.0722][i]; },
        0); }
      var ground = FLAT.light['--hk-key'];
      var bg = role === 'well' ? 1 : lum([1,3,5].map(function (i) { return parseInt(ground.substr(i,2),16); })), target = role === 'text' ? 4.5 : 3;
      while ((Math.max(bg,lum(c))+.05)/(Math.min(bg,lum(c))+.05) < target && Math.max.apply(null,c) > 0) c = c.map(function (x) { return Math.floor(x*.96); });
      return flatColors[key] = 'rgb(' + c.join(',') + ')';
    }
    // FLAT COLORS' PALETTE (2026-10-17, PLAN-2026-10-17-flat-appearance-colors.md):
    // the page's resolved Accent Color and Off Pill Tint (hkSettings.flatColors)
    // turned into colors. Accent Color's presets, muted on purpose: a seed for a
    // pale or deep ground, the page's highlight and a matched tint.
    // hk-settings-model.js FLAT_ACCENTS is the same list (tests/test_flat.js).
    var FLAT_ACCENTS = [['amber', 'Amber', '#e09649'], ['sage', 'Sage', '#7e9b83'], ['harbor', 'Harbor', '#5c91bc'],
                        ['lavender', 'Lavender', '#9374bc'], ['rose', 'Rose', '#c17d91'], ['slate', 'Slate', '#64798e'],
                        ['teal', 'Teal', '#599b9c'], ['clay', 'Clay', '#ad8972']];
    // THE ROLES, each a blend of the source into the theme's own surface:
    //   ground  an Automatic background (as pageTone): 10 % into #F4F2EE / 13 % into #141517
    //   pill    an off pill or scene: 8 % into white / 20 % into graphite
    //   well    an off pill's circle: 22 % / 36 %
    // An off glyph is its source taken to 3:1 against what it sits on. A
    // white source (Apple TV, HomePod, a white light) is NEUTRAL first.
    var FLAT_MIX = { light: { ground: ['#F4F2EE', 0.10], pill: ['#FFFFFF', 0.08], well: ['#FFFFFF', 0.22] },
                     dark: { ground: ['#141517', 0.13], pill: ['#2B2C30', 0.20], well: ['#2B2C30', 0.36] } };
    var FLAT_NEUTRAL = '#8E8E93';
    function rgbOf(color) {
      var x = String(color || '').trim(), h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(x);
      if (h) {
        var d = h[1].length === 3 ? h[1].replace(/./g, '$&$&') : h[1];
        return [0, 2, 4].map(function (i) { return parseInt(d.slice(i, i + 2), 16); });
      }
      var m = /rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/i.exec(x);
      return m ? m.slice(1, 4).map(function (n) { return Math.max(0, Math.min(255, Math.round(+n))); }) : null;
    }
    function hexOfRgb(c) { return '#' + c.map(function (n) { n = Math.round(n); return (n < 16 ? '0' : '') + n.toString(16); }).join(''); }
    // `a` `t` of the way into `b`
    function blend(a, b, t) {
      var x = rgbOf(a), y = rgbOf(b);
      return hexOfRgb(x.map(function (n, i) { return n * t + y[i] * (1 - t); }));
    }
    function relLum(c) {
      return c.map(function (x) { x /= 255; return x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); })
              .reduce(function (n, x, i) { return n + x * [.2126, .7152, .0722][i]; }, 0);
    }
    function contrast(a, b) { var x = relLum(rgbOf(a)), y = relLum(rgbOf(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
    // `color` taken toward black (on a pale ground) or white (a dark one)
    // until it reads at `target` against `ground`
    function readable(color, ground, target) {
      var c = color, toward = relLum(rgbOf(ground)) > .4 ? '#000000' : '#FFFFFF';
      for (var n = 0; n < 40 && contrast(c, ground) < (target || 3); n++) c = blend(c, toward, .92);
      return c;
    }
    // an accent as stored -> a hex: an ACCENTS name, a FLAT_ACCENTS id, '#rrggbb'
    function seedHex(v) {
      var a = String(v || '').toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(a)) return a;
      if (ACCENTS[a]) return ACCENTS[a];
      for (var i = 0; i < FLAT_ACCENTS.length; i++) if (FLAT_ACCENTS[i][0] === a) return FLAT_ACCENTS[i][2];
      return null;
    }
    function flatRole(src, theme, role) {
      var m = FLAT_MIX[theme === 'light' ? 'light' : 'dark'][role];
      return blend(src, m[0], m[1]);
    }
    // THE PALETTE HERE: null outside Flat. seed -- the coordinated Accent
    // (null: Automatic); tint -- one hex every off pill takes (null: each
    // its own); tinted -- whether off pills are washed at all: always on
    // Light (the Flat White baseline), on Dark only for a tint chosen (Dark's
    // Automatic keeps its own surfaces, v1). `ctx`: hkSettings.flatColors'.
    var palMemo = { key: null, val: null };
    function flatPalette(ctx) {
      var S = window.hkSettings, a = S && S.rendering ? S.rendering() : {};
      if (!a.flat || !S.flatColors) return null;
      var r = S.flatColors(ctx), theme = a.theme === 'light' ? 'light' : 'dark';
      // a page keeping its own color (Flat Colors -> Pages): seeded by it,
      // whatever the Highlight Color says -- Climate blue on any screen
      var seed = r.accent.scope === 'own-page' ? pageAccentHex(r.accent.page)
               : r.accent.value === 'auto' ? null : seedHex(r.accent.value);
      var tv = r.off_tint.value, tint = null;
      // Match Accent with no accent of its own: the page's highlight as it is
      if (tv === 'accent') tint = seed || legacyAccentHex();
      else if (tv !== 'auto') tint = seedHex(tv);
      var key = theme + '|' + seed + '|' + tint;
      if (!ctx && palMemo.key === key) return palMemo.val;
      var pal = { theme: theme, seed: seed, tint: tint, tinted: theme === 'light' || !!tint, key: key, from: r,
                  ground: seed ? flatRole(seed, theme, 'ground') : null };
      if (!ctx) { palMemo.key = key; palMemo.val = pal; }
      return pal;
    }
    function flatIdle(own, bare, pal) {
      pal = pal || flatPalette();
      if (!pal) return null;
      var k = pal.key + '|' + own + '|' + (bare ? 1 : 0), hit = ST.idleMemo[k];
      if (hit) return hit;
      var src = pal.tint;
      if (!src) {
        // Light's own colors as lit Light draws them (flatColor's Apple
        // light colors), white made neutral: the same rule for every kind
        var c = rgbOf(own);
        src = !c || Math.min.apply(null, c) > 230 ? FLAT_NEUTRAL
            : hexOfRgb(pal.theme === 'light' ? rgbOf(flatColor(own, 'well')) || c : c);
      }
      var pill = flatRole(src, pal.theme, 'pill'), well = bare ? null : flatRole(src, pal.theme, 'well');
      var out = { pill: pill, well: well, glyph: readable(src, well || pill, 3) };
      if (Object.keys(ST.idleMemo).length > 400) ST.idleMemo = {};
      return ST.idleMemo[k] = out;
    }
    function flatSurface(el, kind) {
      if (!el || !el.style || !el.setAttribute || !el.removeAttribute) return;
      el._hkFlatKind = kind || el._hkFlatKind || '';
      FLAT_ROOTS.add(el);
      flatTone(el);
    }
    function syncFlat() {
      FLAT_ROOTS.forEach(function (el) { if (el.isConnected === false) FLAT_ROOTS.delete(el); else flatTone(el); });
      ON_PAGE.forEach(function (el) { tone(el, el.client); markAsleep(el); });
    }

    // A length option as CSS: numbers are px (`pad_left: 22`), strings pass
    // through (`pad_left: 22px`); null for nothing.
    function px(v) {
      if (v == null || v === '') return null;
      return typeof v === 'number' ? v + 'px' : String(v);
    }
    // The sideways BLEED of a `margin` shorthand: how far its left and right
    // sides pull the box out (positive numbers), or null when neither side is
    // negative or a side is not a plain px length. hk-row-card and
    // hk-grid-card publish this so the phone can clamp it to the gutter.
    function bleedSides(margin) {
      if (margin == null) return null;
      var t = String(margin).trim().split(/\s+/), l, r;
      if (t.length < 1 || t.length > 4) return null;
      r = t.length === 1 ? t[0] : t[1];
      l = t.length === 4 ? t[3] : r;
      var n = function (s) { var m = /^(-?[\d.]+)(px)?$/.exec(s); return m ? parseFloat(m[1]) : NaN; };
      var L = n(l), R = n(r);
      if (isNaN(L) || isNaN(R) || (L >= 0 && R >= 0)) return null;
      return { l: Math.max(0, -L), r: Math.max(0, -R) };
    }

    // TEXT GOING INTO MARKUP: & < > " ' as entities, null and undefined as
    // nothing. Safe in text and inside a quoted attribute.
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }

    // A <div> THAT IS A BUTTON: role, focusable, and a tap or Enter / Space
    // runs `fn`. A tap hands `fn` its click event; the keys call it with none.
    // Returns the element.
    // ------------------------------------------------- a picture's art.json
    // THE HOUSE PICTURE WITHOUT THE WAIT (2026-10-16, the user: the house
    // "takes a bit to load"): the Power and Security pictures need their
    // folder's art.json before they can name an image, which made two requests
    // in a row on every page load. The last copy is kept in this browser and
    // answered at once; the file is asked for again behind it and, when it
    // differs, answered a second time -- so the picture is in the card's first
    // paint. `fn(json)`; null on a failed first load (a later call asks again).
    var ARTJ = {};

    // what the shell and the later parts use of this one
    K.ARTJ = ARTJ; K.bleedSides = bleedSides; K.centredTile = centredTile; K.contrast = contrast; K.esc = esc;
    K.figureCss = figureCss; K.FLAT_ACCENTS = FLAT_ACCENTS; K.FLAT_COLORS = FLAT_COLORS;
    K.FLAT_GROUNDS = FLAT_GROUNDS; K.FLAT_MIX = FLAT_MIX; K.flatAccentHex = flatAccentHex; K.flatColor = flatColor;
    K.flatColorHex = flatColorHex; K.flatFade = flatFade; K.flatGround = flatGround; K.flatIdle = flatIdle;
    K.flatPalette = flatPalette; K.flatRole = flatRole; K.flatSurface = flatSurface; K.groupSurface = groupSurface;
    K.HEAD = HEAD; K.headCss = headCss; K.headRowCss = headRowCss; K.iconGradient = iconGradient;
    K.labelCss = labelCss; K.pageAccentHex = pageAccentHex; K.pageCardCss = pageCardCss; K.pageTone = pageTone;
    K.plate = plate; K.px = px; K.ROOM_TINTS = ROOM_TINTS; K.roomTint = roomTint; K.seedHex = seedHex;
    K.syncFlat = syncFlat; K.titleRow = titleRow; K.typeCss = typeCss;
  };
})();
