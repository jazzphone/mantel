// @ts-check
// hk-home-block.js -- the Home block and its sheet (phase 27, docs/phase27/PLAN.md)
//
//   hk-home-block-card   `home` (S, W, T, L, XL; hk-grid-catalog.js): the house as a way in. Small is the house's glyph
//                        alone -- HomeView's own tile ("a glyph-only tile (the house)", DESIGN.md HomeView) -- Wide the
//                        glyph, the house's name and one line of what is going on. From Tall up it speaks House Status's
//                        language (hk-house-status.js: the same chip model, headline and sentence, so the two never say it
//                        differently) and adds what House Status has not, the rooms: Tall the categories as lines, Large
//                        the categories as standard pills over the rooms' lines, Extra Large a column for the categories
//                        beside the rooms. The plate opens the sheet, a room the sheet at that room, a category its own
//                        page as its chip does (House Status's way); nothing in the block turns anything on.
//                        ROUND 12 (2026-11-23): from Wide up the block is the kit's picture card instead -- the top of Apple's Home app: the house's
//                        picture (four looks by the sun, dimmed), "Home" with its chevron, the inside temperature, and Climate, Lights, Doors and
//                        Security as glass buttons; Extra Large adds the rooms down the right (_renderKit). Small is unchanged.
//   hk-detail-home       the sheet's body (hkDetail.open {panel}): the generated Home, as a generated screen draws it --
//                        the chips, the camera mosaic, Scenes, Favorites, every room (hkStrategy.homeSheet) -- at the Room
//                        sheet's size. A room's heading opens the room INSIDE the sheet, one level deep, with a "‹ Home"
//                        key where every sheet has its back key; a chip or Cameras goes to the screen's own page and the
//                        sheet goes with it (the owner, 2026-11-12: the chips' pages in the sheet were "not the best place").
//
// THE PURE PART is first and has no DOM (window.hkHomeBlock.lib): tests/test_home_block.py runs it in node.
(function () {
  'use strict';
  // HOW MANY STATES, once per set of them (2026-11-13, swipes on the Loft): asked by every card on every update, the
  // count walked the whole house each time; a host gives a new states object with every change, so it is counted once
  var NSTATES = typeof WeakMap === 'function' ? new WeakMap() : null;
  function nStates(st) {
    if (!st) return 0;
    var n = NSTATES ? NSTATES.get(st) : undefined;
    if (n === undefined) { n = Object.keys(st).length; if (NSTATES) NSTATES.set(st, n); }
    return n;
  }
  if (window.hkHomeBlock) return;                       // double-load guard

  // ======================================================================== pure
  // a page's address as the sheet knows it: the last part of a path ("/screen/security" -> "security")
  function segOf(path) {
    var p = String(path || '').split(/[?#]/)[0].replace(/\/+$/, '');
    return p.slice(p.lastIndexOf('/') + 1);
  }
  // WIDE'S LINE: what is going on, in the chip row's order -- the sections that are on or ask for a look, two at most, each
  // its name and its reading ("Security 1 Unlocked · Lights 3 On"); nothing on, "All quiet"
  function wideLine(sections, active, say) {
    var on = (sections || []).filter(active).slice(0, 2);
    return on.length ? on.map(function (s) { return s.name + ' ' + say(s.reading); }).join(' · ') : 'All quiet';
  }
  // A ROOM'S READING at the end of its line: the Room block's own short line ("68° · 1 on", "All off") and what is open
  // in it ("Unlocked", "Open"); nothing to say, ""
  function roomSay(line, unlocked, open) {
    var out = line ? [line] : [];
    if (unlocked) out.push('Unlocked');
    if (open) out.push('Open');
    return out.join(' · ');
  }
  // THE SHEET'S PLACE for a tap: a page it has, else Home
  function placeOf(at, pages) { return at && at !== 'home' && pages && pages[at] ? at : 'home'; }

  // ---- ROUND 12 (2026-11-23, the owner: "we probably need to make it somewhat dim, but I like the idea overall...not sure if it
  // changes throughout the day, but that would be fun"): from Wide up the block is the top of Apple's Home app -- the house's
  // picture fills it, drawn in four looks by the sun, dimmed so it sits back like a wallpaper, with the categories as glass
  // buttons over it. What decides each part is here, plain data in and out.
  // THE SKY'S LOOK from sun.sun (its state and attributes) and the hour: day over 10 degrees up, night under -6 (civil twilight's
  // end), between them dawn while the sun is rising and dusk while it is setting; with no elevation, above or below the horizon;
  // with no sun at all, the clock (5-8 dawn, 8-17 day, 17-20 dusk)
  function skyLook(sun, hour) {
    var a = (sun && sun.attributes) || {}, el = a.elevation == null || a.elevation === '' ? NaN : Number(a.elevation);
    var h = hour == null || !isFinite(hour) ? 12 : Number(hour);
    if (isFinite(el)) {
      if (el >= 10) return 'day';
      if (el < -6) return 'night';
      return (a.rising != null ? !!a.rising : h < 12) ? 'dawn' : 'dusk';
    }
    var state = sun && sun.state;
    if (state === 'above_horizon') return h < 9 ? 'dawn' : h >= 17 ? 'dusk' : 'day';
    if (state === 'below_horizon') return 'night';
    return h < 5 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night';
  }
  // WHICH OF THE HOUSE'S SEVEN WINDOWS ARE LIT (by their number in the picture): none by day; in the early and late hours as many as
  // lights are on, in the order a house lights up (the living space first, then up); the lights not known, four
  var WIN_ORDER = [0, 3, 4, 1, 5, 2, 6];
  function litWindows(look, lights) {
    if (look === 'day') return [];
    var n = lights == null || !isFinite(lights) ? 4 : Math.max(0, Math.min(7, Math.round(Number(lights))));
    return WIN_ORDER.slice(0, look === 'dawn' ? Math.min(n, 3) : n);
  }
  // HOW MANY LIGHTS ARE ON, from the Lights category's reading ("3 On"); null when it does not say
  function lightsOn(sec) {
    var r = sec && sec.reading;
    if (!r || r.none) return null;
    if (r.num != null && isFinite(Number(r.num))) return Number(r.num);
    return /off/i.test(String(r.text || '')) ? 0 : null;
  }
  // a category's reading as one string: "71°", "3 On", "Disarmed" (no space before a degree or a percent)
  function readText(r) {
    if (!r || r.none) return '';
    if (r.text) return String(r.text);
    var u = r.unit == null ? '' : String(r.unit);
    return String(r.num) + (u && !/^[°%]/.test(u) ? ' ' : '') + u;
  }
  // THE LINE UNDER "HOME": the inside temperature and what the climate is doing ("71° inside · Heating"; a narrow block "71° · Heating")
  function homeLine(sec, narrow) {
    if (!sec) return '';
    var temp = readText(sec.reading), m = /^(Heating|Cooling)/.exec(String(sec.detail || '')), doing = m ? m[1] : '';
    if (!temp) return doing;
    if (!doing) return temp + ' inside';
    return temp + (narrow ? '' : ' inside') + ' · ' + doing;
  }
  // THE CATEGORY BUTTONS: Climate, Lights, Doors, Security (Apple's Home app's own), the ones the screen's status model has, then others to
  // fill `n`; a quiet Doors (nothing open, so no section) is made up -- "All Closed" -- where the screen has its page (`doorsPage`)
  var CAT_KINDS = ['climate', 'lights', 'doors_windows', 'security'];
  function pickCats(sections, n, doorsPage) {
    var list = sections || [], by = {}, out = [];
    list.forEach(function (x) { if (!by[x.kind]) by[x.kind] = x; });
    CAT_KINDS.forEach(function (kd) {
      var x = by[kd];
      if (!x && kd === 'doors_windows' && doorsPage) {
        x = { kind: kd, name: 'Doors', reading: { text: 'All Closed' }, tap: { action: 'navigate', navigation_path: doorsPage }, made: true };
      }
      if (x) out.push(x);
    });
    list.forEach(function (x) { if (out.length < n && out.indexOf(x) < 0 && CAT_KINDS.indexOf(x.kind) < 0) out.push(x); });
    return out.slice(0, n);
  }

  // THE HOUSE'S PICTURE: an illustrated house -- the sky, far hills, a lawn, a house with a wing and a chimney, a pine and a round tree,
  // windows lit by the evening's lights -- in the four looks, drawn in the block's own px (nothing is scaled, cropped or animated). `dim` is
  // how much black goes over it, so it sits back like a wallpaper under the words and the buttons.
  var SKIES = {
    dawn: { sky: [[0, '#2a3066'], [0.5, '#7d5f96'], [0.78, '#e39b7e'], [1, '#f7d09c']], far: '#4b4262', lawn: '#26332a', wall: '#554c63', wing: '#5d546b',
            roof: '#2e2a3c', tree: '#1c2a24', off: '#3b3a50', dim: 0.26, stars: 0.35 },
    day: { sky: [[0, '#4a93dc'], [0.6, '#93c8ef'], [1, '#d6ecf8']], far: '#86ad7c', lawn: '#5c9a4a', wall: '#e8dfce', wing: '#dcd0bb',
           roof: '#6b5249', tree: '#2e6a3b', off: '#86adc9', dim: 0.42, stars: 0 },
    dusk: { sky: [[0, '#1b2647'], [0.45, '#4c4f7e'], [0.66, '#d98d68'], [0.74, '#f2c08a']], far: '#232c1d', lawn: '#1a2215', wall: '#171920', wing: '#1d1f28',
            roof: '#121318', tree: '#121810', off: '#2a2e3a', dim: 0.22, stars: 0.7 },
    night: { sky: [[0, '#050816'], [0.55, '#0e1735'], [1, '#1c2850']], far: '#0f1529', lawn: '#0b120d', wall: '#0e1017', wing: '#12141c',
             roof: '#090a10', tree: '#080e0a', off: '#1a1e2b', dim: 0.08, stars: 1 }
  };
  var STARS = [[0.08, 0.06, 1.4], [0.2, 0.14, 1], [0.33, 0.05, 1.2], [0.46, 0.12, 1], [0.58, 0.04, 1.3], [0.7, 0.1, 1], [0.82, 0.05, 1.4], [0.92, 0.15, 1],
               [0.15, 0.28, 1], [0.62, 0.24, 1], [0.88, 0.3, 1.2], [0.4, 0.3, 0.9]];
  // the seven windows, from the house's center and its ground line: x, y, width, height
  var WINDOWS = [[-54, -62, 18, 22], [-18, -62, 18, 22], [18, -62, 18, 22], [46, -62, 16, 22], [-54, -32, 18, 22], [30, -32, 18, 22], [-98, -38, 18, 20]];
  function dimOf(look) { return (SKIES[look] || SKIES.day).dim; }
  // o: { cx, base, s } the house's center, ground line and scale; lit: the windows' numbers (litWindows)
  function sceneSvg(w, h, look, o) {
    var P = SKIES[look] || SKIES.day;
    o = o || {};
    w = Math.round(w) || 196;
    h = Math.round(h) || 196;
    var sw = o.sw || w, cx = o.cx != null ? o.cx : w / 2, base = o.base != null ? o.base : h * 0.66, sc = o.s || 1, lit = o.lit || [], dark = look !== 'day';
    var f = function (n) { return Math.round(n * 10) / 10; };
    var stops = P.sky.map(function (q) { return '<stop offset="' + q[0] + '" stop-color="' + q[1] + '"/>'; }).join('');
    var d = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" style="display:block">' +
      '<defs><linearGradient id="hsk" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="' + f(base) + '">' + stops + '</linearGradient>' +
      '<radialGradient id="hgl"><stop offset="0" stop-color="#ffbe5a" stop-opacity=".55"/><stop offset="1" stop-color="#ffbe5a" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="hwn" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#fff2c8"/><stop offset="1" stop-color="#ffb84d"/></radialGradient>' +
      '<radialGradient id="hsn"><stop offset="0" stop-color="#fff4d2" stop-opacity=".9"/><stop offset="1" stop-color="#fff4d2" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="hho"><stop offset="0" stop-color="#ffb070" stop-opacity=".75"/><stop offset="1" stop-color="#ffb070" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#hsk)"/>';
    if (P.stars) {
      STARS.forEach(function (t) { d += '<circle cx="' + f(t[0] * w) + '" cy="' + f(t[1] * base) + '" r="' + t[2] + '" fill="#fff" opacity="' + f(P.stars * 0.75) + '"/>'; });
    }
    if (look === 'night') d += '<circle cx="' + f(sw * 0.8) + '" cy="' + f(base * 0.24) + '" r="46" fill="url(#hsn)" opacity=".55"/><circle cx="' + f(sw * 0.8) + '" cy="' + f(base * 0.24) +
      '" r="14" fill="#f4efe0"/><circle cx="' + f(sw * 0.8 + 4) + '" cy="' + f(base * 0.24 - 3) + '" r="3" fill="#d9d2c0"/>';
    if (look === 'day') {
      d += '<circle cx="' + f(sw * 0.82) + '" cy="' + f(base * 0.22) + '" r="70" fill="url(#hsn)" opacity=".8"/><circle cx="' + f(sw * 0.82) + '" cy="' + f(base * 0.22) + '" r="15" fill="#fff8dc"/>';
      [[0.16, 0.3, 1], [0.5, 0.16, 0.8], [0.62, 0.4, 1.1]].forEach(function (c) {
        var x = c[0] * sw, y = c[1] * base, z = c[2] * 26;
        d += '<g fill="#fff" opacity=".82"><ellipse cx="' + f(x) + '" cy="' + f(y) + '" rx="' + f(z * 1.6) + '" ry="' + f(z * 0.55) + '"/><ellipse cx="' + f(x - z * 0.7) + '" cy="' +
          f(y + z * 0.15) + '" rx="' + f(z) + '" ry="' + f(z * 0.5) + '"/><ellipse cx="' + f(x + z * 0.8) + '" cy="' + f(y + z * 0.12) + '" rx="' + f(z * 1.1) + '" ry="' + f(z * 0.48) + '"/></g>';
      });
    }
    // (the sun low behind the house at dawn, the last of it at dusk)
    if (look === 'dawn' || look === 'dusk') d += '<ellipse cx="' + f(cx + (look === 'dawn' ? 70 : -80) * sc) + '" cy="' + f(base - 14 * sc) + '" rx="' + f(190 * sc) + '" ry="' + f(120 * sc) +
      '" fill="url(#hho)" opacity="' + (look === 'dawn' ? 0.9 : 0.6) + '"/>';
    d += '<path d="M0 ' + f(base - 22 * sc) + ' Q ' + f(w * 0.25) + ' ' + f(base - 52 * sc) + ' ' + f(w * 0.5) + ' ' + f(base - 28 * sc) + ' T ' + w + ' ' + f(base - 38 * sc) + ' V ' + h +
      ' H0Z" fill="' + P.far + '"/>';
    d += '<path d="M0 ' + f(base - 6 * sc) + ' C ' + f(w * 0.3) + ' ' + f(base - 14 * sc) + ' ' + f(w * 0.7) + ' ' + f(base - 2 * sc) + ' ' + w + ' ' + f(base - 10 * sc) + ' V ' + h + ' H0Z" fill="' +
      P.lawn + '"/>';
    d += '<g transform="translate(' + f(cx) + ' ' + f(base) + ') scale(' + f(sc) + ')">';
    // (a pine at the left, a round tree at the right where there is room for it)
    d += '<g fill="' + P.tree + '"><path d="M-130 -96 L-152 -58 H-108Z"/><path d="M-130 -76 L-158 -32 H-102Z"/><path d="M-130 -54 L-164 -4 H-96Z"/><rect x="-133" y="-6" width="6" height="8"/></g>';
    if (w - cx > 150 * sc) d += '<g fill="' + P.tree + '"><rect x="108" y="-24" width="6" height="26"/><circle cx="111" cy="-44" r="25"/><circle cx="126" cy="-30" r="16"/></g>';
    d += '<rect x="-110" y="-50" width="78" height="50" fill="' + P.wing + '"/><polygon points="-120,-48 -72,-86 -24,-48" fill="' + P.roof + '"/>' +
      '<rect x="-72" y="-70" width="144" height="70" fill="' + P.wall + '"/><rect x="38" y="-116" width="16" height="34" fill="' + P.roof + '"/>' +
      '<polygon points="-84,-66 0,-128 84,-66" fill="' + P.roof + '"/>';
    d += '<rect x="-10" y="-30" width="16" height="30" rx="2" fill="' + (lit.length ? '#ffd27a" opacity=".85' : P.off) + '"/>';
    WINDOWS.forEach(function (q, i) {
      var on = lit.indexOf(i) >= 0;
      if (on) d += '<ellipse cx="' + (q[0] + q[2] / 2) + '" cy="' + (q[1] + q[3] / 2) + '" rx="' + (q[2] * 1.7) + '" ry="' + (q[3] * 1.5) + '" fill="url(#hgl)"/>';
      d += '<rect x="' + q[0] + '" y="' + q[1] + '" width="' + q[2] + '" height="' + q[3] + '" rx="2.5" fill="' + (on ? 'url(#hwn)' : P.off) + '"/>' +
        '<path d="M' + (q[0] + q[2] / 2) + ' ' + q[1] + 'v' + q[3] + 'M' + q[0] + ' ' + (q[1] + q[3] / 2) + 'h' + q[2] + '" stroke="' + (dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.55)') +
          '" stroke-width="1.3"/>';
    });
    return d + '</g></svg>';
  }

  var LIB = { segOf: segOf, wideLine: wideLine, roomSay: roomSay, placeOf: placeOf, skyLook: skyLook, litWindows: litWindows, lightsOn: lightsOn,
              readText: readText, homeLine: homeLine, pickCats: pickCats, CAT_KINDS: CAT_KINDS, sceneSvg: sceneSvg, dimOf: dimOf, LOOKS: ['dawn', 'day', 'dusk', 'night'] };
  window.hkHomeBlock = { version: '1.0.0', lib: LIB };

  // ======================================================================== the cards
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-home-block] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
    if (window.hkHomeBlock.Sheet) return;
    var HkBase = C.HkBase, esc = C.esc, v = C.v, T = C.TYPE;
    // THE GLYPH: Apple's Home symbol, the house with a smaller house inside it, as HomeView's own house tile has it (the owner,
    // 2026-11-12: "is there any way to match the one in the screenshot/video") -- the house's glyph file's `homekit` (SF Symbols'
    // apple.homekit); without one, Material's home-outline (hk-icons.js MDI_ALIAS)
    var HOUSE = 'hk:homekit';
    function type(role) {
      var t = T[role];
      return 'font-size:' + t.size + 'px;font-weight:' + t.weight + (t.track ? ';letter-spacing:' + t.track : '') +
        (t.upper ? ';text-transform:uppercase' : '');
    }
    function reduced() {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    }
    function dash() { return String(location.pathname).split('/')[1] || ''; }

    // ---- what the sheet draws: hkStrategy.homeSheet, built again only when what it is built from moves -- the screen, the
    // registries, the settings, the house's entities -- never on a state (a state goes to the cards in place)
    var BUILT = { key: null, regs: null, n: 0, out: null, count: 0, whole: null };
    // the sheet's cards made in the tap that opens it, and each time after (HkHomeSheet._render)
    var FIRST = 4, FILL = 5;
    // the sheet waits this long at most for the whole house before it draws from what is at hand (HkHomeSheet)
    var WHOLE_MS = 1500;
    // (what it is built from, but the states: the screen, the registries, the settings)
    function keyOf(client) {
      var HS = window.hkSettings, regs = [client.entities, client.devices, client.areas];
      if (!BUILT.regs || regs.some(function (r, i) { return r !== BUILT.regs[i]; })) { BUILT.regs = regs; BUILT.n++; }
      return dash() + '|' + BUILT.n + '|' + (HS ? HS.version : '');
    }
    // every state a build names (an entity id anywhere in it)
    function idsOf(out) {
      var seen = {}, ids = [];
      (function walk(v) {
        if (typeof v === 'string') { if (!seen[v] && /^[a-z_]+\.[a-z0-9_]+$/.test(v)) { seen[v] = 1; ids.push(v); } }
        else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k]); });
      })(out);
      return ids;
    }
    function built(client) {
      var S = window.hkStrategy, HS = window.hkSettings;
      if (!S || !S.homeSheet || !client || !client.states) return { home: [], pages: {} };
      // (...and never from fewer states than it was built from: a host that keeps only what a screen reads has the
      // whole house only while the sheet asks for it -- hkShell.wholeHouse, below -- and what it drew then stands when
      // the rest has gone again. Built from a narrowed screen's states it was 19 cards of the house's 28, 2026-11-14.)
      var key = keyOf(client), count = nStates(client.states);
      if (BUILT.out && BUILT.key === key && count <= BUILT.count) return BUILT.out;
      var out, SH = window.hkShell;
      // (a walk of every room's accessories: no screen's need -- hkShell.unrecorded; the cards it makes read their own)
      var walk = function () { return S.homeSheet(client) || { home: [], pages: {} }; };
      try { out = SH && typeof SH.unrecorded === 'function' ? SH.unrecorded(walk) : walk(); }
      catch (e) { console.error('[hk-home-block] the Home sheet:', e); out = null; }
      // (the shell answers nothing for a walk that threw)
      if (!out || !out.pages) out = { home: [], pages: {} };
      BUILT.key = key;
      BUILT.count = count;
      BUILT.out = out;
      return out;
    }
    function houseName(client) {
      var cfg = (client && client.config) || {};
      return cfg.location_name || 'Home';
    }
    // Open at Home or on one of the pages inside it.
    function openSheet(at, name, config) {
      var D = window.hkDetail;
      if (!D || typeof D.open !== 'function') return false;
      return !!D.open(null, { name: name || 'Home', icon: HOUSE },
        { panel: { tag: 'hk-detail-home', config: { at: at || 'home', name: name || '',
          look: config && config.look, flat_theme: config && config.flat_theme } } });
    }

    // ======================================================================== the sheet's body
    // ITS WIDTH: five of the page's pills and their gaps, the sheet's 24 px padding a side and its 1 px border -- 1070 px on the
    // wall tablet, one pill wider than the Room sheet (hk-room.js), at the one sheet height (the owner, 2026-11-12, asked about
    // filling the screen: five across keeps the grid at the edges and the header where every sheet has it). Never wider than the
    // window (hk-detail.js): an iPad upright holds three, a 1024 px window four; a phone has its own sheet, two across.
    var RS = { pill: C.TILE.w, gap: C.TILE.gridGap };
    var SHEET_CSS = [
      ':host{display:block;--hk-pill:' + RS.pill + 'px;--hk-track:' + RS.pill + 'px;--hk-cell-bleed:0px;--hk-pill-end:0px}',
      // (never sideways: the camera mosaic's row bleeds 22 px past the page's edge, as it does on the page, and the sheet's edge cuts it --
      // the body would otherwise scroll sideways under a finger; clip, where the engine has it, keeps the cards' own scrolling)
      ':host{overflow-x:hidden;overflow-x:clip}',
      '.col{display:flex;flex-direction:column;box-sizing:border-box;margin:0 auto;width:var(--hk-room-w,100%);max-width:100%;padding:2px 0 8px}',
      '.col > *{display:block;margin:0 -4px}',
      // (...but not the chip row: it has no grid child's 4 px of its own, so pulled out with the rest its first chip sat 4 px past
      // the column, cut by the sheet's sideways clip -- the owner's Kitchen, 2026-11-13. Its scroller still bleeds and pays it back)
      '.col > hk-chips-card{margin:0}',
      '.none{color:' + v('ink-2') + ';font-size:15px;text-align:center;padding:48px 16px}',
      '@media (max-width:' + C.BP.phone + 'px){:host{--hk-track:minmax(130px,1fr)}.col{width:100%}}'
    ].join('');
    // THE BACK KEY on an inner page: "‹ Home", where every sheet's back key is (hk-detail.js: at the start of the header,
    // before the glyph), a capsule of the header's own key height; the X stays where it is and closes the whole sheet
    var BACK_STYLE = 'width:auto;padding:0 16px 0 10px;gap:2px;display:inline-flex;align-items:center;' +
      'font-family:inherit;font-size:15px;font-weight:600;white-space:nowrap';

    class HkHomeSheet extends HkBase {
      static get CSS() { return SHEET_CSS; }
      hkWidthKind() { return 5 * RS.pill + 4 * RS.gap + 2 * 24 + 2; }
      hkFill() { return true; }
      hkNoGear() { return true; }
      // an accessory, a camera or a count's list opened from here comes back here, to the page it was opened on
      hkKeepBack() { return true; }
      setConfig(config) {
        super.setConfig(config || {});
        this._at = (config && config.at) || 'home';
        this._scroll = (config && config.scroll) || 0;
      }
      hkSheetAppearance() { return this._config; }
      // the header: the house's glyph and name at Home, the page's on an inner page, and the back key there
      hkHead(h, d) {
        this._d = d;
        this._paintHead(h);
        return true;
      }
      _place(h) { return placeOf(this._at, built(this.client || h).pages); }
      _paintHead(h) {
        var d = this._d;
        if (!d || !d.el) return;
        var at = this._place(h), pg = at === 'home' ? null : built(this.client || h).pages[at];
        d.well.style.background = '';
        d.icon.style.color = v('ink');
        d.icon.icon = pg ? (pg.icon || HOUSE) : HOUSE;
        d.tt.textContent = pg ? pg.title : (this._config.name || houseName(this.client || h));
        var hd = d.el.querySelector('.hd'), bk = hd && hd.querySelector('.hk-home-back'), self = this;
        if (pg && hd && !bk) {
          bk = document.createElement('button');
          bk.className = 'x hk-home-back';
          bk.setAttribute('aria-label', 'Back to Home');
          bk.setAttribute('style', BACK_STYLE);
          bk.innerHTML = '<hk-icon icon="mdi:chevron-left" aria-hidden="true"></hk-icon><span>Home</span>';
          bk.addEventListener('click', function (e) { e.stopPropagation(); self._go('home'); });
          hd.insertBefore(bk, hd.firstChild);
        } else if (!pg && bk) {
          var focused = bk === document.activeElement || (bk.contains && bk.contains(document.activeElement));
          bk.remove();
          if (focused) { var x0 = hd.querySelector('.x'); if (x0) /** @type {any} */ (x0).focus(); }
        }
      }
      // A CARD INSIDE THAT CHANGES PAGE (hkCards.navigate asks first): a room's page opens here -- from another room's too, in
      // its place, so it is never more than one level deep; any other (a chip's, Cameras) is the screen's, and the sheet goes
      // as the screen moves
      hkCatchNav(path) {
        var seg = segOf(path), pages = built(this.client).pages;
        if (!pages[seg]) return false;
        if (seg !== this._at) this._go(seg);
        return true;
      }
      _go(at) {
        var from = this._place(), body = /** @type {any} */ (this.parentNode);
        if (from === 'home' && body) this._homeScroll = body.scrollTop;
        this._at = at;
        this._anim = at === 'home' ? 'back' : 'in';
        this._scroll = at === 'home' ? (this._homeScroll || 0) : 0;
        // (Back from a sheet opened here reopens this one with what it was opened with: the place goes with it)
        var o = this._d && this._d.back0 && this._d.back0.opts, cfg = o && o.panel && o.panel.config;
        if (cfg) { cfg.at = at; cfg.scroll = this._scroll; }
        this._key = null;
        this._render();
        this._paintHead(this.client);
      }
      connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (!this._ro && typeof ResizeObserver !== 'undefined') {
          this._ro = new ResizeObserver(function () { self._fit(); });
          this._ro.observe(/** @type {Element} */ (/** @type {unknown} */ (this)));
        }
        // ESCAPE ON AN INNER PAGE GOES BACK (on the Home page it closes, hk-detail.js on window): on document, bubbling, so a
        // question asked over the sheet -- hk-base's confirm, at document capture -- still takes it first
        if (!this._esc) {
          this._esc = function (e) {
            if (e.key !== 'Escape' || !self.isConnected || self._place() === 'home') return;
            e.stopPropagation();
            self._go('home');
          };
          document.addEventListener('keydown', this._esc);
        }
        // where it is scrolled to, for Back from a sheet opened here
        var body = /** @type {any} */ (this.parentNode);
        if (body && !this._onScroll) {
          this._onScroll = function () {
            var o = self._d && self._d.back0 && self._d.back0.opts, cfg = o && o.panel && o.panel.config;
            if (cfg) cfg.scroll = body.scrollTop;
          };
          body.addEventListener('scroll', this._onScroll, { passive: true });
        }
      }
      disconnectedCallback() {
        super.disconnectedCallback();
        this._asked = false;              // (opened again: the whole house asked for again)
        this._wait = false;
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (this._esc) { document.removeEventListener('keydown', this._esc); this._esc = null; }
      }
      // AS MANY PILLS ACROSS AS THE SHEET HOLDS, the column exactly that wide (the Room sheet's way)
      _fit() {
        var w = /** @type {any} */ (this).offsetWidth || 0;
        if (!(w > 0) || w === this._w) return;
        this._w = w;
        var phone = false;
        try { phone = window.matchMedia('(max-width:' + C.BP.phone + 'px)').matches; } catch (e) { phone = false; }
        if (phone) { this.style.removeProperty('--hk-room-w'); return; }
        var n = Math.max(1, Math.floor((w + RS.gap) / (RS.pill + RS.gap)));
        this.style.setProperty('--hk-room-w', (n * RS.pill + (n - 1) * RS.gap) + 'px');
      }
      _sigOf() { return null; }
      // THE WHOLE HOUSE, for what the sheet draws (built, above): asked of the host before the sheet first draws, and the
      // sheet draws its cards once it is at hand -- a moment, on a host that keeps only what a screen reads (the
      // sheet's frame is up meanwhile; WHOLE_MS at most), and at once on one that has it all (it answers true, no
      // promise). Drawn from what a narrowed screen had, it was 19 cards of the house's 28.
      // ...ONCE: what it drew with the whole house at hand stands until the house's makeup moves (built's key), and at
      // every opening after that it asks only for the states of what it drew (idsOf) -- the whole house is
      // thousands of states read and every card looking again, over a second of the Kitchen's tablet.
      _askWhole() {
        var SH = window.hkShell, asked = null, self = this, c = this.client;
        var key = c ? keyOf(c) : null, had = !!key && BUILT.whole === key && BUILT.key === key && !!BUILT.out;
        // (the states of what it drew, read off what it drew as it stands now)
        if (SH && typeof SH.wholeHouse === 'function') { try { asked = had ? SH.wholeHouse(idsOf(BUILT.out)) : SH.wholeHouse(); } catch (e) { asked = null; } }
        var whole = function () { if (!had && self.client) { built(self.client); BUILT.whole = BUILT.key; } };
        if (!asked || typeof asked.then !== 'function') { if (asked === true) whole(); return; }
        var turn = this._whole = (this._whole || 0) + 1, go = function () {
          if (self._whole !== turn || !self._wait) return;
          self._wait = false;
          if (self.client) self.redraw();
        };
        this._wait = true;
        // (THE ANSWER COUNTS HOWEVER LATE: on the Kitchen's tablet the whole house can take longer than WHOLE_MS to
        // read, and an answer dropped for coming after it was the whole house asked for again at the next opening)
        asked.then(function (ok) {
          if (ok === true && self._whole === turn) {
            whole();
            if (!self._wait && self.client) self.redraw();
          }
          go();
        }, go);
        setTimeout(go, WHOLE_MS);
      }
      _render() {
        var c = this.client;
        if (!c) return;
        if (!this._asked) { this._asked = true; this._askWhole(); }
        if (this._wait) return;
        var b = built(c), at = this._place(), key = BUILT.key + '|' + BUILT.count + '|' + at;
        if (!this._built || key !== this._key) {
          var cards = at === 'home' ? b.home : b.pages[at].cards, sig = at + '|' + JSON.stringify(cards);
          this._key = key;
          if (!this._built || sig !== this._sig) {
            var first = !this._built, body = /** @type {any} */ (this.parentNode);
            var scroll = this._anim ? this._scroll : first ? this._scroll : body && body.scrollTop;
            this._built = true;
            this._sig = sig;
            this._root.innerHTML = '';
            this._kids = [];
            var col = document.createElement('div');
            col.className = 'col';
            var self = this;
            // THE FIRST OF IT AT ONCE, THE REST BEHIND IT (2026-11-14, the Kitchen's tablet: the tap that opens Home
            // drew nothing for a second and more -- sixty cards of the whole house made and put in, all in the tap).
            // The top of the sheet is made now -- what shows before anyone scrolls -- and the cards under it a few at a
            // time, a frame between: the sheet is up at once and fills downward. One made again meanwhile (another
            // page of it, a setting) drops what was still to come.
            var turn = this._turn = (this._turn || 0) + 1, at0 = 0;
            var add = function (n) {
              for (var end = Math.min(cards.length, at0 + n); at0 < end; at0++) {
                var el = C.createCard(window.hkDetail.sheetCardConfig(self, cards[at0]), self.client || c);
                if (el) { col.appendChild(el); self._kids.push(el); }
              }
            };
            var more = function () {
              if (self._turn !== turn || !self.isConnected) return;
              add(FILL);
              self._fit();
              if (at0 < cards.length) setTimeout(more, 0);
            };
            add(FIRST);
            if (at0 < cards.length) setTimeout(more, 0);
            if (!cards.length) {
              var none = document.createElement('div');
              none.className = 'none';
              none.textContent = 'Nothing here yet.';
              col.appendChild(none);
            }
            this._root.appendChild(col);
            if (body && scroll != null) body.scrollTop = scroll;
            this._fit();
            // THE PAGE MOVES IN from the right on the standard curve, and Home back from the left; Reduce Motion, a fade
            if (this._anim && col.animate) {
              var r = reduced(), dx = this._anim === 'in' ? 40 : -40;
              col.animate(r ? [{ opacity: 0 }, { opacity: 1 }]
                            : [{ opacity: 0, transform: 'translateX(' + dx + 'px)' }, { opacity: 1, transform: 'none' }],
                { duration: r ? 200 : 340, easing: r ? 'ease' : C.EASE.standard });
            }
            this._anim = null;
          }
        }
        (this._kids || []).forEach(function (el) {
          if (el.hkSetClient) el.hkSetClient(c); else window.hkHostClient.bridge(el, c);
        });
      }
    }
    if (!customElements.get('hk-detail-home')) customElements.define('hk-detail-home', /** @type {CustomElementConstructor} */ (/** @type {unknown} */ (HkHomeSheet)));
    window.hkHomeBlock.Sheet = HkHomeSheet;
    window.hkHomeBlock.openSheet = function (at) { var c = C.client ? C.client() : null; return openSheet(at, c ? houseName(c) : ''); };
    window.hkHomeBlock._ = { built: built, BUILT: BUILT };

    // ======================================================================== the block
    // drawn with House Status's parts (hk-house-status.js, loaded on first use here) -- the Room block's lines for the rooms
    // (hk-grid-cards.js, the same)
    function need(tag) {
      var N = window.hkNeed;
      if (N && N.has && N.has(tag)) return N(tag);
      return customElements.whenDefined(tag);
    }
    // (at once where House Status is already here -- HK Frontend loads every card file -- else once it has come)
    if (window.hkHouseStatus && window.hkHouseStatus.parts) defineBlock();
    else need('hk-house-status-card').then(defineBlock);
    function defineBlock() {
      if (window.hkHomeBlock.Card) return;
      var HS = window.hkHouseStatus, P = HS.parts, TL = HS.tiles;

      // the rooms, and what each is doing: hkStrategy.rooms (the screen's hidden accessories left out), each room's parts
      // kept as the Room block keeps them (hk-grid-math.js roomParts) -- built again when the house's makeup moves
      var ROOMS = { key: null, list: [] };
      function roomList(client) {
        var S = window.hkStrategy, G = window.hkGridCards, HSet = window.hkSettings;
        if (!S || !S.rooms || !client || !client.states) return [];
        var key = (HSet ? HSet.version : '') + '|' + nStates(client.states) + '|' + BUILT.n + '|' + (G ? 'g' : '-');
        var regs = [client.entities, client.devices, client.areas];
        if (ROOMS.key === key && ROOMS.regs && regs.every(function (r, i) { return r === ROOMS.regs[i]; })) return ROOMS.list;
        var gen = (HSet && HSet.get && HSet.get('generated', null)) || {}, hides = {};
        ['exclude_entities', 'exclude_devices', 'exclude_areas', 'include_entities'].forEach(function (k) { if (Array.isArray(gen[k])) hides[k] = gen[k]; });
        var list = [];
        try { list = S.rooms(client, Object.assign({ __build: {} }, hides)) || []; } catch (e) { list = []; }
        ROOMS = { key: key, regs: regs, list: list.filter(function (r) { return r && r.id; }).map(function (r) {
          var parts = G && G._ && G._.roomParts ? G._.roomParts(client, r.id) : null;
          var area = (client.areas || {})[r.id] || {};
          // (its glyph as the Room block's: the area's own icon in Home Assistant, else the sofa, through the menu's glyph map)
          var H = window.hkMenu && window.hkMenu._, icon = area.icon || 'mdi:sofa';
          return { id: r.id, name: r.name || area.name || r.id, icon: (H && H.glyph ? H.glyph(icon) : icon) || 'mdi:sofa', parts: parts };
        }) };
        return ROOMS.list;
      }
      function roomReading(client, r) {
        var G = window.hkGridCards, st = client.states || {};
        if (!r.parts || !G || !G._ || !G._.roomLine) return '';
        var all = r.parts.all || [], dom = function (id) { return String(id).split('.')[0]; };
        var unlocked = all.some(function (c) { return dom(c.entity) === 'lock' && st[c.entity] && st[c.entity].state === 'unlocked'; });
        var open = all.some(function (c) {
          var s = st[c.entity], dc = s && s.attributes && s.attributes.device_class;
          return dom(c.entity) === 'cover' && (dc === 'garage' || dc === 'door' || dc === 'gate') && s.state === 'open';
        });
        return roomSay(G._.roomLine(client, r.id, r.parts, 'W'), unlocked, open);
      }

      var BLOCK_CSS = [
        ':host{display:block;height:100%}',
        'hk-plate.hm{box-sizing:border-box;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;',
        '  padding:' + C.blockPad('14px') + ';' + C.plate('card') + ';color:' + v('ink') + ';-webkit-tap-highlight-color:transparent;cursor:pointer;',
        '  transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease}',
        // PRESSED, as every block that is a way in (the Suggested Scene's, the Intercom's): a touch smaller and darker under the finger
        // (the owner, 2026-11-12: "The home card doesn't light up or anything when you tap it") -- not while a line or a pill of its own
        // is the one pressed (they answer for themselves)
        'hk-plate.hm:active:not(:has(.ln:active,.sm-k:active)){transform:scale(0.98);filter:brightness(0.93)}',
        'hk-plate.hm:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
        '@media (prefers-reduced-motion:reduce){hk-plate.hm,hk-plate.hm:active{transition:none;transform:none}}',
        '.g{display:flex;color:' + v('ink') + '}',
        // SMALL, Centered (HomeView's own tile): the glyph alone and large, in the middle -- measured off the owner's recording of
        // HomeView, its house about 44 % of the tile across (2026-11-12, the owner: "could probably be a bit bigger"): half the
        // block's shorter side, the symbol's ink about nine tenths of its box
        '.hs{flex:1;display:grid;place-items:center}',
        '.hs .g{width:50cqmin;height:50cqmin;--mdc-icon-size:100%}',
        ':host(:not([tile=centred])) .hs{display:none}',
        // SMALL, Home: the glyph in its well at the top, the name and its line at the foot (a tile's way)
        '.hh{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0}',
        ':host([tile=centred]) .hh{display:none}',
        '.well{width:42px;height:42px;border-radius:50%;background:' + v('key') + ';display:grid;place-items:center}',
        '.well .g{width:24px;height:24px;--mdc-icon-size:24px}',
        '.nm{' + type('headline') + ';line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:' + v('glow') + '}',
        '.ln1{' + type('caption') + ';line-height:17px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // WIDE: the glyph in a quarter of it, the name over its line beside it
        '.hw{flex:1;display:grid;grid-template-columns:25% minmax(0,1fr);align-items:center;column-gap:14px;min-width:0}',
        '.hw .gc{display:grid;place-items:center}',
        '.hw .g{width:min(72px,100%);height:72px;--mdc-icon-size:100%}',
        ':host(:not([tile=centred])) .hw .g{width:36px;height:36px}',
        ':host(:not([tile=centred])) .hw .gc{width:56px;height:56px;border-radius:50%;background:' + v('key') + ';justify-self:center}',
        '.hw .nm{' + type('title') + ';line-height:28px}',
        '.hw .ln1{' + type('body') + ';line-height:20px;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
        // LARGE'S CATEGORIES: one row of standard pills (40 px, DESIGN.md), the glyph and the reading, 8 apart; a row that is
        // wider than the block scrolls sideways
        '.cp{display:flex;gap:8px;flex:none;margin-top:12px;padding:8px 0;margin-bottom:-8px;overflow-x:auto;scrollbar-width:none;touch-action:pan-x}',
        '.cp::-webkit-scrollbar{display:none}',
        '.cp .sm-k{gap:6px;padding:0 14px 0 10px}',
        '.cp .sm-k hk-icon,.cp .sm-k hk-state-icon{display:flex;width:20px;height:20px;--mdc-icon-size:20px}',
        // the rooms' heading over their lines, the block's label's look
        '.rh{' + type('caption') + ';font-weight:600;color:' + v('ink-2') + ';text-transform:uppercase;letter-spacing:.04em;margin:14px 0 2px;flex:none}',
        '.sx .rh{margin-top:0}'
      ].join('') + TL.CSS;

      class HkHomeBlockCard extends P.Mixin(HkBase) {
        static get CSS() { return BLOCK_CSS; }
        getCardSize() { return 2; }
        _size() { return P.sizeOf(this) || 'S'; }
        // (the plate's tap, hk-base.js openTarget): anywhere that is no part of its own opens the sheet at Home
        _tapTarget() { var self = this; return [{ run: function () { self._open('home'); } }]; }
        _name() { return (this._config || {}).title || houseName(this.client); }
        _open(at) { return openSheet(placeOf(at, built(this.client).pages), this._name(), this._config); }
        connectedCallback() {
          super.connectedCallback();
          // the rooms' readings come with hk-grid-cards.js: drawn again once it is here
          var self = this;
          if (!window.hkGridCards && !this._askedGrid) { this._askedGrid = true; need('hk-grid-room-card').then(function () { self.redraw(); }); }
          // (what the sheet draws worked out at a quiet moment, not in the tap that opens it: a quarter of a second of
          // the Kitchen's tablet. built() keeps it until the house's makeup moves.)
          clearTimeout(this._ahead);
          this._ahead = setTimeout(function () {
            var go = function () { if (self.isConnected && self.client) { try { built(self.client); } catch (e) { /* made at the tap */ } } };
            if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2000 }); else go();
          }, 4000);
        }
        disconnectedCallback() {
          if (super.disconnectedCallback) super.disconnectedCallback();
          clearTimeout(this._ahead);
        }
        _sigOf() {
          var size = this._size(), base = size === 'S' && this.getAttribute('tile') === 'centred' ? 'hb:S' : super._sigOf(), c = this.client;
          // (the picture's look: read when told, so a screen keeps sun.sun; the look moves a few times a day, not with its elevation)
          if (size !== 'S') base += '|' + this._sky();
          if (size === 'S' || size === 'W' || size === 'T' || !c) return base + '|' + this._name() + '|' + (this.getAttribute('tile') || '');
          var self = this;
          return base + '|' + this._name() + '|' + (this.getAttribute('tile') || '') + '|' +
            roomList(c).map(function (r) { return r.id + '=' + roomReading(self.client, r); }).join(';');
        }
        // THE PICTURE'S LOOK, by the sun now
        _sky() {
          var st = this.client && this.client.states, now = new Date();
          return skyLook(st ? st['sun.sun'] : null, now.getHours() + now.getMinutes() / 60);
        }
        // THE KIT'S CARD, Wide and up (round 12; hk-kit.js, docs/phase34/PLAN.md): the top of Apple's Home app -- the house's picture, dimmed,
        // "Home" with the chevron that says it opens, the inside temperature and what the climate is doing, and the categories as glass
        // buttons at the foot; Extra Large adds the rooms down the right. Small stays the glyph alone (false: the older drawing).
        _renderKit() {
          var K = window.hkKit, size = this._size(), c = this.client, self = this;
          if (!K || size === 'S' || !c) return false;
          if (this._watchBlock) this._watchBlock();
          var k = K.ctx(this), w = k.w, h = k.h, E = k.E, X = k.X, KH = K.KH, G = K.G, name = this._name();
          var m = this._sections(), sections = (m && m.sections) || [], look = this._sky(), narrow = w < 300, ink = '#fff';
          var M = C.menu, doors = M && M.pagePath ? (M.pagePath('doors-windows') || M.pagePath('doors') || M.pagePath('security')) : null;
          var cats = pickCats(sections, size === 'W' || size === 'T' ? 3 : 4, doors), climate = sections.filter(function (x) { return x.kind === 'climate'; })[0];
          var lw = size === 'XL' ? Math.min(w, 405) : w, o = '';
          // the picture, where the house stands in the free band between the words and the buttons
          var at = { W: { cx: w - 124, base: 130, s: 0.74 }, T: { cx: w / 2, base: 176, s: 0.72 }, L: { cx: lw / 2, base: h - 153, s: 1.2 }, XL: { cx: lw / 2, base: h - 153, s: 1.2 } }[size];
          var lit = litWindows(look, lightsOn(sections.filter(function (x) { return x.kind === 'lights'; })[0]));
          o += K.box(0, 0, w, h, '', 'overflow:hidden', sceneSvg(w, h, look, { cx: at.cx, base: at.base, s: at.s, lit: lit, sw: lw })) +
            K.box(0, 0, w, h, 'pho', 'background:linear-gradient(180deg,rgba(0,0,0,.3) 0,rgba(0,0,0,0) 36%,rgba(0,0,0,0) 56%,rgba(0,0,0,.34) 100%),rgba(0,0,0,' + dimOf(look) + ')');
          // the words: the house's name, large, with the chevron; under it the line
          o += K.box(X, 16, lw - 2 * X, 28, '', 'display:flex;align-items:center;gap:4px', '<span class="kd" style="flex:0 1 auto;min-width:0">' + esc(name) + '</span>' +
              K.svg('chev', 18, 'rgba(255,255,255,.85)')) + K.tx(X, 46, lw - 2 * X, 'kb', esc(homeLine(climate, narrow)));
          // the buttons
          this._shown = cats;
          var teal = '#5ce1e6', btn = cats.map(function (x, i) {
            var kd = x.kind, label = kd === 'doors_windows' ? 'Doors' : x.name, say = readText(x.reading), isOpen = kd === 'doors_windows' && !x.made && !!x.attention;
            if (kd === 'doors_windows') say = say.replace(/^(\d+) (?:Doors?|Windows?|Garages?)\b/, '$1');      // ("3 Doors Open" is "3 Open" on a button)
            if (isOpen && !/open/i.test(say)) say += ' Open';
            var tint = { climate: '#ff9f0a', lights: '#ffcc00', doors_windows: teal, security: ink }[kd] || ink, on = kd === 'lights' ? /^[1-9]/.test(say) : isOpen;
            var icon = { climate: 'hk:thermostat', lights: 'hk:lightbulb', doors_windows: 'hk:garage', security: 'hk:shield-home' }[kd] || x.icon || 'mdi:circle-outline';
            return { g: K.glyph(icon, 26, K.tone(k, tint, on || kd === 'climate'), true) + '<span class="hb"><b>' + esc(label) + '</b><i' + (isOpen ? ' style="color:#7fe9ee"' : '') + '>' +
              esc(say) + '</i></span>', label: label + (say ? ', ' + say : ''), data: { i: i } };
          });
          if (size === 'W') o += K.foot(k, btn);
          else if (size === 'T') o += K.stack(k, btn.map(function (b) { return [b]; }));
          else o += K.stack(Object.assign({}, k, { w: lw }), K.chunk(btn, 2));
          if (size === 'XL') {
            var rooms = roomList(c), rx = lw + 2, rw = w - E - rx, pk = Object.assign({}, k, { X: 16 }), RH = K.RH, list = '';
            rooms.forEach(function (r, i) {
              var say = roomReading(c, r), y = i * RH;
              list += K.row(pk, 0, y, rw, { t: r.name, b: say, trail: '\u00a0', label: r.name + (say ? ', ' + say : ''), data: { r: r.id } }, i === rooms.length - 1, RH) +
                K.box(rw - 30, y + (RH - 18) / 2, 14, 18, 'fc', 'pointer-events:none', K.svg('chev', 14, 'rgba(255,255,255,.6)'));
            });
            o += K.box(rx, E, rw, h - 2 * E, '', 'border-radius:' + k.r + 'px;background:rgba(0,0,0,.34)') + K.tx(rx + 16, E + 14, rw - 32, 'kl', 'Rooms') +
              '<div class="a sc" role="list" style="' + K.st(rx, E + 44, rw, h - 2 * E - 44) + '">' + list + '</div>';
          }
          var css = '<style>.kit.photo{color:#fff;--hk-ink:#fff;--hk-ink-2:rgba(255,255,255,.8);--hk-ink-3:rgba(255,255,255,.6);--hk-line:rgba(255,255,255,.16);--hk-glow:none;text-shadow:none}' +
            '.kit.photo .kd,.kit.photo .kb{text-shadow:0 1px 4px rgba(0,0,0,.45)}' +
            // (the buttons: a translucent dark and a hairline ring, never a blur of their own -- the picture is under them)
            '.kit.photo .key{background:rgba(28,30,40,.62);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),inset 0 1px 0 rgba(255,255,255,.2);justify-content:flex-start;gap:10px;' +
              'padding:0 12px 0 14px;' +
            'text-shadow:none}.kit.photo .key:active{background:rgba(28,30,40,.82)}' +
            '.kit.photo .hb{display:flex;flex-direction:column;min-width:0;text-align:left}' +
            '.kit.photo .hb b{font-weight:600;font-size:17px;letter-spacing:-.3px;line-height:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.kit.photo .hb i{font-style:normal;font-weight:400;font-size:15px;line-height:20px;color:rgba(255,255,255,.78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.kit.photo .sc{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;scrollbar-width:none}' +
            '.kit.photo .sc::-webkit-scrollbar{display:none}.kit.photo .row:active{background:rgba(255,255,255,.1)}</style>';
          return K.draw(this, K.plate(k, css + o, { label: name + '. Opens ' + name, cls: 'photo' }), function (/** @type {any} */ root) {
            root.querySelectorAll('[data-i]').forEach(function (/** @type {any} */ b) {
              b.addEventListener('click', function () {
                var sec = (self._shown || [])[Number(b.getAttribute('data-i'))];
                if (!sec || !P.go(self, sec, false)) self._open('home');
              });
            });
            root.querySelectorAll('[data-r]').forEach(function (/** @type {any} */ b) { b.addEventListener('click', function () { self._openRoom(b.getAttribute('data-r')); }); });
          });
        }
        _render() {
          // (the kit's card, hk-kit.js; the older drawing below only where the kit draws none: Small)
          if (window.hkKit && window.hkKit.on(this)) { if (this._renderKit()) { this._built = false; return; } } else if (this._kitHtml) { window.hkKit.forget(this); this._built = false; }
          var self = this;
          if (!this._built) {
            this._built = true;
            this._root.innerHTML = '<hk-plate class="hm" data-hk-role="card" role="group"></hk-plate>';
            this._plate = this._root.querySelector('hk-plate');
            this._plate.addEventListener('click', function (e) {
              var t = /** @type {any} */ (e.target), b = t && t.closest ? t.closest('[data-i],[data-r]') : null;
              // (Small and Wide are one button, so hk-base's block tap leaves them be -- it never takes a tap on a [role=button] --
              // and the plate opens the sheet itself)
              if (!b && self._one) { e.stopPropagation(); self._open('home'); return; }
              if (!b) return;
              e.stopPropagation();                         // one tap, one place: never the plate's too
              if (b.hasAttribute('data-r')) { self._openRoom(b.getAttribute('data-r')); return; }
              var sec = (self._shown || [])[Number(b.getAttribute('data-i'))];
              if (sec) self._openSection(sec);
            });
            // (Small and Wide are one button: the keyboard's Enter and Space open the sheet, as a tap does)
            this._plate.addEventListener('keydown', function (e) {
              if (e.target !== self._plate || (e.key !== 'Enter' && e.key !== ' ')) return;
              e.preventDefault();
              self._open('home');
            });
          }
          var size = this._size(), name = this._name(), c = this.client;
          this._plate.setAttribute('aria-label', name + '. Opens ' + name);
          // Small and Wide: the whole block is the button; from Tall up a group of its own buttons (the lines, the pills)
          var one = this._one = size === 'S' || size === 'W';
          this._plate.setAttribute('role', one ? 'button' : 'group');
          if (one) this._plate.setAttribute('tabindex', '0'); else this._plate.removeAttribute('tabindex');
          var bare = this.getAttribute('tile') === 'centred', glyph = '<hk-icon class="g" icon="' + HOUSE + '" aria-hidden="true"></hk-icon>';
          var m = size === 'S' && bare ? null : this._sections();
          var sections = (m && m.sections) || [];
          var active = function (x) { return !!(x.urgent || x.attention || P.litOf(x)); };
          if (size === 'S') {
            C.morph(this._plate, '<div class="hs">' + glyph + '</div>' +
              '<div class="hh"><div class="well">' + glyph + '</div><div><div class="nm">' + esc(name) + '</div>' +
              (bare ? '' : '<div class="ln1">' + esc(wideLine(sections, active, P.words)) + '</div>') + '</div></div>');
            return;
          }
          if (size === 'W') {
            C.morph(this._plate, '<div class="hw"><div class="gc">' + glyph + '</div><div style="min-width:0"><div class="nm">' + esc(name) + '</div>' +
              '<div class="ln1">' + esc(wideLine(sections, active, P.words)) + '</div></div></div>');
            return;
          }
          var box = P.inner(this, size), sum = P.summary(sections, size), white = (this._config || {}).glyphs === 'white';
          this._shown = sections;
          var catRows = sections.map(function (x, i) {
            var say = P.words(x.reading), dt = x.detail && x.detail.toLowerCase() !== say.toLowerCase() ? x.detail : null;
            return { live: P.goes(x), attrs: 'data-i="' + i + '"', aria: P.ariaOf(x), icon: function (px, col) { return P.glyph(x, px, col); },
                     lit: P.litOf(x), hue: P.hueOf(x), look: !!x.urgent, name: x.name, reading: P.reading(x.reading), say: say, detail: dt };
          });
          var rooms = c ? roomList(c) : [];
          var roomRows = rooms.map(function (r) {
            var say = roomReading(c, r);
            return { live: true, attrs: 'data-r="' + esc(r.id) + '"', aria: r.name + (say ? ', ' + say : '') + '. Opens ' + r.name,
                     icon: function (px, col) {
                       return '<hk-icon class="gl" icon="' + esc(r.icon) + '" style="width:' + px + 'px;height:' + px + 'px;--mdc-icon-size:' + px + 'px' +
                         (col ? ';color:' + col : '') + '" aria-hidden="true"></hk-icon>';
                     },
                     lit: null, hue: null, name: r.name, reading: '<span class="v tx">' + esc(say) + '</span>', say: say };
          });
          var lab = '<div class="sm-h"><div class="sm-l">' + esc(name) + '</div></div>';
          var head = TL.headline(sum.head, false), snt = '<div class="snt">' + sum.sentence + '</div>';
          var row = { rowH: 56, shown: 0 };
          var list = function (rows, width, under) {
            return TL.lines({ rows: rows, bare: bare, white: white, words: true, underAt: under ? 1e4 : 0 }, Object.assign({}, row, { shown: rows.length }), width);
          };
          var html;
          if (size === 'T') {
            html = '<div class="sm">' + lab + head + '<div class="bd">' + list(catRows, box.iw, true) + '</div></div>';
          } else if (size === 'L') {
            var pills = sections.filter(P.goes).map(function (x) {
              var i = sections.indexOf(x);
              return '<button type="button" class="sm-k" data-i="' + i + '" aria-label="' + esc(P.ariaOf(x)) + '">' +
                P.glyph(x, 20, P.hueOf(x)) + '<span>' + esc(P.words(x.reading)) + '</span></button>';
            }).join('');
            html = '<div class="sm">' + lab + head + snt + (pills ? '<div class="cp" role="list">' + pills + '</div>' : '') +
              '<div class="bd">' + list(roomRows, box.iw, false) + '</div></div>';
          } else {
            var side = 200;
            html = '<div class="sx" style="--sw:' + side + 'px;--sg:22px"><div class="sc">' + lab + head + snt +
              '<div class="bd">' + list(catRows, side, true) + '</div></div>' +
              '<div class="bd">' + list(roomRows, box.iw - side - 22, false) + '</div></div>';
          }
          C.morph(this._plate, html);
          TL.fade(this._plate);
          P.bindGlyphs(this._plate, c);
        }
        // a category: what its chip's tap does -- the screen's own page, an entity's sheet, a link -- as House Status's (the owner,
        // 2026-11-12: a category's page in the sheet was "not the best place for it")
        _openSection(sec) { return P.go(this, sec, false); }
        // a room: its page in the sheet, else the sheet at Home
        _openRoom(area) {
          var pages = built(this.client).pages, at = Object.keys(pages).filter(function (k) { return pages[k].area === area; })[0];
          return this._open(at || 'home');
        }
      }
      C.register('hk-home-block-card', HkHomeBlockCard, 'HK Home',
        'The house as a way in: its glyph, what is going on and its rooms -- each opens the Home page in a sheet. Made for a Home Grid.');
      if (C.unlisted) C.unlisted('hk-home-block-card');
      window.hkHomeBlock.Card = HkHomeBlockCard;
    }
  });
})();
