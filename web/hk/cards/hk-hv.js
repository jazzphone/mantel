// @ts-check
// hk-hv.js -- THE HOMEVIEW APPS' KIT (docs/phase36/PLAN.md, 2026-11-26).
//
// An Apple HomeView (web/shim/homeview.js) opens a screen's pages from its Apps screen, and each was a page made for a wall
// tablet squeezed onto a 544 x 440 pt window. The owner: "instead of forcing our existing pages to fit ... It needs to look
// and function like it belongs on the homeview". So on a HomeView each of those pages is drawn by a page card of its own
// (hk-hv-home.js, hk-hv-care.js, hk-hv-media.js, hk-hv-info.js), from the mockups he picked
// (https://claude.ai/artifact/Ngp59QvBqHSoG9krKsJWZR, "Scrolling pages"). This file is what they share:
//
//   THE FRAME   the page's name and one line upper left (the line leads with a number), one control at the right (the
//               page's one action, or a switch between real modes); then sections under plain headings, as many rows as
//               they need -- the page scrolls; a switch never hides more of the same. A page gone deeper (a room, a
//               camera, a channel) puts a back key before its title, on the same frame. The Home Pill (hk-pages-screen)
//               floats over it and goes back to Apps.
//   THE GRID    four across, 120 x 104 pt, 12 apart, 14 from the screen's sides: Small 1 x 1 (a centered tile), Wide 2 x 1
//               (a level you drag across), Tall 1 x 2, and half and full-width plates for lists, players and charts.
//               Nothing stretches.
//   POINTS      every size is the HomeView's own pt (its 544 across: the mockups' numbers), written P(n), so the page is
//               the same whatever width homeview.js lays it out at (440 today: a pt is 0.81 px).
//   THE PIECES  P, glyph, frame, section, tile, level, row(s), key, cap, seg, plate -- strings of HTML, in this card's
//               shadow root, with one stylesheet (CSS) and one click handler (the page card's act()).
//
// WHERE A PAGE'S ACCESSORIES COME FROM: the strategy (hk-strategy-views.js) builds every page as it always has, then on a
// HomeView hands that page's cards to its HomeView card as `src`. harvest(src) reads them -- the tiles under each room
// heading, the cards' own entity lists -- so which accessories a page shows, their order, rooms, names, glyphs and colors
// stay the build's decision. A page reads its states when it is told (rule 13), and only the ones it shows (sig()).
//
// TAPS (as every Mantel tile: the Home app splits the target): a tile's or a level's glyph toggles it, the rest opens its
// sheet; a level is dragged across (sent once, on letting go, and held 2.5 s for the device to answer, as the Wide block's).
// A door, a lock, the alarm or the heat is never one tap (hkCards' neverToggles): its glyph opens the sheet too.
(function () {
  'use strict';
  if (window.hkHV) return;                         // double-load guard
  /** @type {any} */
  var HV = window.hkHV = { version: '1.0.0', ready: false };

  function whenBase(/** @type {(C: any) => void} */ fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-hv] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  // ------------------------------------------------------------------ points
  /** @param {number} n */
  function P(n) { return 'calc(' + n + ' * var(--pt))'; }
  /** @param {any} s */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return /** @type {any} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ------------------------------------------------------------------ colors
  // a palette name or a color, as css (hkTile.colourFor's names: the accessory's Color)
  var HUES = { yellow: '#ffcc00', orange: '#ff9f0a', blue: '#56bde4', green: '#30d158', red: '#ff453a', purple: '#bf5af2', pink: '#ff375f',
               teal: '#40c8e0', cyan: '#32ade6', mint: '#63e6e2', brown: '#ac8e68', indigo: '#5e5ce6', gray: 'rgba(200,200,200,.8)', grey: 'rgba(200,200,200,.8)' };
  // ON A WHITE PLATE a glyph takes its color a shade deeper, so a yellow bulb still reads (the mockups' lit tiles)
  var DEEP = { yellow: '#e8a200', orange: '#e58600', blue: '#1f9cc9', green: '#1fa846', red: '#e0352b', purple: '#9d4ddb', pink: '#e0244e',
               teal: '#1aa6bf', cyan: '#1691cc', mint: '#25b8b3', indigo: '#4b49d6' };
  /** @param {any} c */
  function hue(c) { var s = String(c || '').toLowerCase().trim(); return HUES[s] || (s ? String(c) : HUES.gray); }
  // a tile config's color name for an entity (its own, else its kind's), as hkTile decides it
  /** @param {any} cfg @param {any} st */
  function colorName(cfg, st) {
    var own = cfg && cfg.icon_color ? String(cfg.icon_color).toLowerCase() : '';
    if (own && HUES[own]) return own;
    var d = String((st && st.entity_id) || (cfg && cfg.entity) || '').split('.')[0];
    return ({ light: 'yellow', switch: 'orange', fan: 'blue', cover: 'blue', lock: 'teal', climate: 'orange', input_button: 'purple',
              script: 'purple', scene: 'purple', media_player: 'pink', vacuum: 'mint', valve: 'cyan', binary_sensor: 'teal', timer: 'orange' })[d] || 'gray';
  }
  // WHITE GLYPHS (the screen's Icons, hkSettings.tileIcons; Automatic is white on Bright Glass, as hkKit.ctx decides): a glyph
  // at rest is the words' own color; one that is on, or needs you, keeps its color
  function whiteGlyphs() {
    var S = window.hkSettings, icons = 'auto';
    try { icons = S && S.tileIcons ? S.tileIcons() : 'auto'; } catch (e) { icons = 'auto'; }
    var root = typeof document !== 'undefined' ? document.documentElement : null;
    return icons === 'white' || (icons === 'auto' && /^bright/.test(String((root && root.getAttribute('data-hk-glass')) || '')));
  }
  /** @param {any} cfg @param {any} st @param {boolean} lit @param {boolean} [needs] it needs you (open, unlocked, a leak): its color even at rest */
  function glyphColor(cfg, st, lit, needs) {
    if (!lit && !needs && whiteGlyphs()) return 'var(--hk-ink, rgba(255,255,255,0.94))';
    var own = cfg && cfg.icon_color && !HUES[String(cfg.icon_color).toLowerCase()] ? String(cfg.icon_color) : null;
    if (own) return own;
    var n = colorName(cfg, st);
    return lit ? DEEP[n] || hue(n) : hue(n);
  }

  // ------------------------------------------------------------------ the glyph
  // an icon name (hk:..., mdi:...) as the house's own glyph, `pt` points square
  /** @param {string} icon @param {number} pt @param {string} [color] @param {string} [cls] */
  function glyph(icon, pt, color, cls) {
    return '<span class="g' + (cls ? ' ' + cls : '') + '" style="--gs:' + P(pt) + (color ? ';color:' + color : '') + '"><hk-icon icon="' + esc(icon || 'mdi:help-circle-outline') +
      '"></hk-icon></span>';
  }
  // the icon a tile config draws in a state (its own for this state, else its icon, else the kind's)
  var KIND_ICON = { light: 'hk:lightbulb', switch: 'hk:power-plug', fan: 'hk:fan', cover: 'hk:blinds', lock: 'hk:lock', climate: 'hk:thermostat',
                    scene: 'hk:palette', script: 'hk:palette', input_button: 'hk:palette', vacuum: 'hk:robot-vacuum', valve: 'hk:valve',
                    binary_sensor: 'hk:door-closed', media_player: 'hk:speaker', timer: 'hk:timer-outline', camera: 'hk:cctv' };
  /** @param {any} cfg @param {any} st */
  function iconOf(cfg, st) {
    cfg = cfg || {};
    var s = st && st.state, own = cfg.icon_states && s && cfg.icon_states[s];
    if (own) return own;
    if (cfg.icon) return cfg.icon;
    var a = (st && st.attributes) || {};
    if (a.icon) return a.icon;
    return KIND_ICON[String(cfg.entity || (st && st.entity_id) || '').split('.')[0]] || 'mdi:help-circle-outline';
  }

  // ------------------------------------------------------------------ words
  var ON_STATES = ['on', 'open', 'opening', 'closing', 'unlocked', 'unlocking', 'playing', 'cleaning', 'heat', 'cool', 'heat_cool', 'auto', 'active'];
  /** @param {any} st */
  function isOn(st) { return !!st && ON_STATES.indexOf(st.state) >= 0; }
  /** @param {string} s */
  function sentence(s) { s = String(s || '').replace(/_/g, ' '); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  // THE STATE IN THE HOME APP'S WORDS: one or two, Title Case (DESIGN.md "Content fundamentals")
  /** @param {any} st */
  function word(st) {
    if (!st) return 'Not Found';
    var s = st.state, d = String(st.entity_id || '').split('.')[0], a = st.attributes || {};
    if (s === 'unavailable' || s === 'unknown') return 'No Response';
    if (d === 'light' && s === 'on') return typeof a.brightness === 'number' ? Math.max(1, Math.round(a.brightness / 2.55)) + '%' : 'On';
    if (d === 'fan' && s === 'on') return typeof a.percentage === 'number' && a.percentage > 0 ? a.percentage + '%' : 'On';
    if (d === 'cover') {
      if (s === 'open' && typeof a.current_position === 'number' && a.current_position > 0 && a.current_position < 100) return a.current_position + '% Open';
      return ({ open: 'Open', closed: 'Closed', opening: 'Opening', closing: 'Closing' })[s] || sentence(s);
    }
    if (d === 'lock') return ({ locked: 'Locked', unlocked: 'Unlocked', locking: 'Locking', unlocking: 'Unlocking', jammed: 'Jammed', open: 'Open' })[s] || sentence(s);
    if (d === 'binary_sensor') {
      var dc = a.device_class;
      if (dc === 'moisture') return s === 'on' ? 'Leak' : 'Dry';
      if (dc === 'door' || dc === 'window' || dc === 'garage_door' || dc === 'opening') return s === 'on' ? 'Open' : 'Closed';
      if (dc === 'motion' || dc === 'occupancy') return s === 'on' ? 'Detected' : 'Clear';
      return s === 'on' ? 'On' : 'Off';
    }
    if (s === 'on') return 'On';
    if (s === 'off') return 'Off';
    return sentence(s);
  }
  // "since" words: now, 4m, 2h, Yesterday (iOS's, DESIGN.md)
  /** @param {any} when @param {number} [now] */
  function ago(when, now) {
    var t = new Date(when).getTime(), n = now || Date.now();
    if (!isFinite(t)) return '';
    var s = Math.max(0, Math.round((n - t) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }
  /** @param {any} when */
  function clock(when) {
    var d = new Date(when);
    if (!isFinite(d.getTime())) return '';
    try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  }

  // ------------------------------------------------------------------ the page's accessories, from the build
  // HARVEST: every card config in `src` (the page the strategy built), depth first, with the room heading it sits under.
  //   { cards: [{ cfg, group }], tiles: [{ id, cfg, group, area }], groups: [{ name, ids }], byId: { id: tile } }
  /** @param {any} src */
  function harvest(src) {
    /** @type {any} */
    var out = { cards: [], tiles: [], groups: [], byId: {} };
    /** @param {any} c @param {string|null} group @param {number} depth */
    function walk(c, group, depth) {
      if (!c || typeof c !== 'object' || depth > 30) return;
      if (Array.isArray(c)) { var g = group; c.forEach(function (x) { if (x && x.type === 'custom:hk-heading-card' && x.name && !x.height) g = String(x.name); walk(x, g, depth + 1); }); return; }
      out.cards.push({ cfg: c, group: group });
      if (c.entity && typeof c.entity === 'string' && /^custom:hk-(tile|scene|light|fan|cover|climate|tall|favorite|media)/.test(String(c.type || '')) && !out.byId[c.entity]) {
        var t = { id: c.entity, cfg: c, group: group, area: c.hk_place && c.hk_place.area || null };
        out.byId[c.entity] = t;
        out.tiles.push(t);
        var gr = out.groups.filter(function (x) { return x.name === group; })[0];
        if (!gr) out.groups.push(gr = { name: group, ids: [] });
        gr.ids.push(c.entity);
      }
      if (Array.isArray(c.cards)) walk(c.cards, group, depth + 1);
      if (c.card) walk(c.card, group, depth + 1);
    }
    walk(Array.isArray(src) ? src : [], null, 0);
    return out;
  }
  // the first card of a type in a harvest (its config), or null
  /** @param {any} h @param {string} type */
  function cardOf(h, type) {
    var hit = (h.cards || []).filter(function (c) { return c.cfg.type === 'custom:' + type; })[0];
    return hit ? hit.cfg : null;
  }
  /** @param {any} h @param {string} type */
  function cardsOf(h, type) { return (h.cards || []).filter(function (c) { return c.cfg.type === 'custom:' + type; }).map(function (c) { return c.cfg; }); }

  // A PLACE IN THE SETTINGS, in the host's own words (hkShell.settingsPlace: "Mantel Settings → Accessories" in Mantel, HK
  // Settings' in Home Assistant), for a page with nothing to show that says where to set it up
  /** @param {string} path */
  function where(path) { var S = window.hkShell; return S && S.settingsPlace ? S.settingsPlace(path) : path; }

  // THE PURE PART, with no card base (tests/test_hv_kit.py runs it in node)
  HV.lib = { P: P, esc: esc, hue: hue, colorName: colorName, glyphColor: glyphColor, whiteGlyphs: whiteGlyphs, iconOf: iconOf, isOn: isOn, word: word, sentence: sentence,
             ago: ago, clock: clock, harvest: harvest, cardOf: cardOf, cardsOf: cardsOf };

  whenBase(function (C) {
  if (HV.ready) return;
  var HkBase = C.HkBase, register = C.register, v = C.v;

  // ------------------------------------------------------------------ the styles
  var CSS = [
    ':host{display:block}',
    // THE FRAME: on a HomeView (hvdev) the screen's width, whatever the view's column; on any other device (a screen with
    // HomeView Pages on, 2026-11-26: a computer, for a look and a screenshot) the HomeView's own 544, centered. A pt is the
    // frame's 544th. The top: 8 under the view's own room for Safari's buttons and the column's 4 px, so the title row sits
    // where the mockups put it.
    '.hv{container-type:inline-size}',
    // (on the host, in the frame's own terms: --pt is the page root's, below it)
    ':host{--hvw:min(100vw, 544px);--hv-float:calc(12 * var(--hvw) / 544)}',
    // (Safari's bar on a HomeView: scrolled, it is a pill over the page's top; a tab switch floats clear below it)
    ':host([hvdev]){--hvw:100vw;--hv-float:calc(var(--hk-safe-top, 0px) + 34 * var(--hvw) / 544)}',
    '.hvi{--pt:calc(var(--hvw) / 544);box-sizing:border-box;width:var(--hvw);margin-left:calc(50% - var(--hvw) / 2);padding:' + P(8) + ' ' + P(14) + ' ' + P(64) + ';color:' + v('ink') +
      ';font-family:' + v('font-body') + ';-webkit-font-smoothing:antialiased;text-shadow:' + v('glow') + ';-webkit-tap-highlight-color:transparent}',
    '.hvi *{box-sizing:border-box}',
    'button{all:unset;box-sizing:border-box;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
    'button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
    // THE TITLE ROW
    // (the words on the plates' text inset, 8 in from their edge; a control at the right ends on the plates' own edge)
    '.hd{display:flex;align-items:center;gap:' + P(10) + ';min-height:' + P(44) + ';margin:0 0 ' + P(8) + ' ' + P(8) + '}',
    '.ttl{font-size:' + P(26) + ';font-weight:700;letter-spacing:' + P(-0.5) + ';white-space:nowrap;line-height:1.15}',
    '.sum{font-size:' + P(16) + ';font-weight:500;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '.sum b{font-weight:600;color:' + v('ink') + '}',
    '.warn{color:' + v('warn', '#ffb340') + ';font-weight:600}',
    '.bad{color:' + v('fail', '#ff6961') + ';font-weight:600}',
    '.hdr{margin-left:auto;display:flex;gap:' + P(8) + ';align-items:center;flex:none}',
    // A SWITCH THAT FLOATS (the owner, 2026-11-26: "they should probably float above the content as your scroll down ... Be
    // careful on pages that have barely enough content to scroll"): a copy of the title row's switch in a sticky layer of no
    // height, so the page is exactly as tall with it as without (no bounce on a page that barely scrolls); it shows once the
    // title row has gone under the top (an IntersectionObserver, HvPage._float), on the near-solid overlay so it reads over
    // whatever scrolls beneath it
    '.flt{position:sticky;top:var(--hv-float);height:0;z-index:6;pointer-events:none}',
    '.flt .fin{position:absolute;right:0;top:0;opacity:0;transform:translateY(' + P(-6) + ');transition:opacity .2s ease,transform .34s cubic-bezier(.32,.72,0,1)}',
    '.flt.show .fin{opacity:1;transform:none;pointer-events:auto}',
    '.flt .seg{background:' + v('overlay-solid', 'rgba(24,24,28,0.93)') + ';box-shadow:0 ' + P(6) + ' ' + P(20) + ' rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.16)}',
    // A SECTION'S HEADING
    '.sh{display:flex;align-items:baseline;gap:' + P(8) + ';margin:' + P(24) + ' ' + P(8) + ' ' + P(10) + ';font-size:' + P(20) + ';font-weight:700;letter-spacing:' + P(-0.35) + '}',
    '.sh .sum{font-size:' + P(15) + '}',
    '.sh .more{margin-left:auto;font-size:' + P(15) + ';font-weight:600;color:' + v('ink-2') + '}',
    // THE GRID: four across, rows of 104
    '.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:' + P(104) + ';gap:' + P(12) + '}',
    '.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.dense{grid-auto-flow:row dense}',
    '.c2{grid-column:span 2}.c3{grid-column:span 3}.c4{grid-column:1 / -1}.r2{grid-row:span 2}.r3{grid-row:span 3}.r4{grid-row:span 4}',
    // THE PLATE (the screen's glass: hkCards.plate), and lit
    '.pl{' + C.plate('tile') + ';position:relative;display:block;overflow:hidden;border-radius:' + P(24) + ';color:' + v('ink') + '}',
    '.pl.pad{padding:' + P(16) + ' ' + P(18) + '}',
    '.pl.lit{background:#fff;color:#1c1c1e;text-shadow:none;--hk-glow:none;--hk-ink:#1c1c1e;--hk-ink-2:#767678;--hk-ink-3:rgba(60,60,67,.42);' +
      '--hk-key:rgba(0,0,0,.065);--hk-key-strong:rgba(0,0,0,.12);--hk-line:rgba(0,0,0,.1);border-color:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}',
    '.pl:active{filter:brightness(.93)}',
    // A CENTERED TILE (HomeView's): the glyph bare, the name, the state
    // (12 a side: a long name's ellipsis keeps clear of the plate's edge, as the Centered tile's words do)
    '.tl{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ' + P(12) + '}',
    '.tl>.g{margin-bottom:' + P(9) + '}',
    // WORDS
    '.nm{font-size:' + P(15) + ';font-weight:600;letter-spacing:' + P(-0.23) + ';line-height:' + P(19) + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.st{font-size:' + P(13) + ';font-weight:500;line-height:' + P(17) + ';color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.hl{font-size:' + P(17) + ';font-weight:600;letter-spacing:' + P(-0.3) + '}',
    '.lbl{font-size:' + P(13) + ';font-weight:600;letter-spacing:' + P(0.3) + ';text-transform:uppercase;color:' + v('ink-2') + '}',
    '.fig{font-size:' + P(30) + ';font-weight:700;letter-spacing:' + P(-0.6) + ';font-variant-numeric:tabular-nums}',
    '.fig small{font-size:' + P(16) + ';font-weight:600;letter-spacing:0;margin-left:' + P(2) + ';color:' + v('ink-2') + '}',
    '.giant{font-weight:500;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1}',
    '.num{font-variant-numeric:tabular-nums}',
    '.ink2{color:' + v('ink-2') + '}.ink3{color:' + v('ink-3') + '}',
    // A GLYPH
    '.g{display:inline-flex;align-items:center;justify-content:center;flex:none;width:var(--gs);height:var(--gs);line-height:0}',
    '.g hk-icon{--mdc-icon-size:var(--gs);width:var(--gs);height:var(--gs);display:inline-block}',
    '.g svg{width:var(--gs);height:var(--gs)}',
    // A LEVEL (Control Center's): the whole tile is the slider, the fill the thing's own color, the level at the right
    '.lv{touch-action:pan-y}',
    '.lv .fill{position:absolute;left:0;top:0;bottom:0;width:var(--v,0%);background:var(--f,#ffe6b0);pointer-events:none}',
    '.lv .row{position:absolute;inset:0;display:flex;align-items:center;gap:' + P(13) + ';padding:0 ' + P(18) + '}',
    '.lv .words{display:flex;flex-direction:column;min-width:0;flex:1}',
    '.lv .pct{margin-left:auto;font-size:' + P(17) + ';font-weight:600;font-variant-numeric:tabular-nums;flex:none}',
    '.lv .tg{display:flex;align-items:center;justify-content:center;width:' + P(36) + ';height:' + P(44) + ';margin-left:' + P(-4) + '}',
    '.lv.drag .fill{transition:none}',
    '.lv .fill{transition:width .2s cubic-bezier(.32,.72,0,1)}',
    // A LIST: rows with a bare glyph, the name, the state at the right, hairlines between
    '.rows{display:flex;flex-direction:column}',
    '.rw{position:relative;display:flex;align-items:center;gap:' + P(12) + ';min-height:' + P(52) + ';padding:0 ' + P(14) + ' 0 ' + P(6) + ';border-top:1px solid ' + v('line') +
      ';text-align:left;width:100%}',
    '.rw:first-child{border-top-color:transparent}',
    '.rw>.g{width:' + P(36) + '}',
    '.rw .mid{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.rw .val{font-size:' + P(15) + ';font-weight:500;color:' + v('ink-2') + ';white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.rw.lit{border-radius:' + P(16) + ';background:#fff;color:#1c1c1e;text-shadow:none;margin:' + P(2) + ' 0;border-top-color:transparent;--hk-ink-2:#767678}',
    '.rw.lit+.rw{border-top-color:transparent}',
    '.rw.lit .val{color:#767678}',
    // (the same inset both sides, so a lit row's white tile is as far from the plate's left edge as from its right)
    '.list{padding:' + P(6) + ' ' + P(8) + '}',
    // KEYS AND CAPSULES
    '.key{width:' + P(44) + ';height:' + P(44) + ';border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none;background:' + v('key') +
      ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);color:' + v('ink') + '}',
    '.key.lg{width:' + P(60) + ';height:' + P(60) + '}.key.xl{width:' + P(72) + ';height:' + P(72) + '}.key.sm{width:' + P(36) + ';height:' + P(36) + '}',
    '.key.w,.cap.w{background:#fff;color:#1c1c1e;box-shadow:none;text-shadow:none}',
    '.key.bare{background:none;box-shadow:none}',
    '.key:active,.cap:active{filter:brightness(.88)}',
    '.cap{height:' + P(40) + ';padding:0 ' + P(16) + ';border-radius:' + P(20) + ';display:inline-flex;align-items:center;justify-content:center;gap:' + P(7) + ';background:' + v('key') +
      ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);font-size:' + P(15) + ';font-weight:600;white-space:nowrap;color:' + v('ink') + '}',
    '.cap.lg{height:' + P(52) + ';border-radius:' + P(26) + ';padding:0 ' + P(22) + ';font-size:' + P(17) + '}',
    '.cap[disabled]{opacity:.4;pointer-events:none}',
    '.seg{display:inline-flex;height:' + P(36) + ';padding:' + P(3) + ';border-radius:' + P(18) + ';background:' + v('key') + ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);text-shadow:none}',
    '.seg button{display:inline-flex;align-items:center;padding:0 ' + P(13) + ';border-radius:' + P(15) + ';font-size:' + P(14) + ';font-weight:600;color:' + v('ink') + ';white-space:nowrap}',
    '.seg button.on{background:#fff;color:#1c1c1e}',
    // A TRACK
    '.trk{height:' + P(6) + ';border-radius:' + P(3) + ';background:' + v('line-strong') + ';position:relative;overflow:hidden}',
    '.trk>i{position:absolute;left:0;top:0;bottom:0;border-radius:' + P(3) + ';background:currentColor}',
    // A QUIET LINE where a section has nothing
    '.quiet{padding:' + P(18) + ';font-size:' + P(15) + ';color:' + v('ink-2') + ';text-align:center}',
    // MOTION OFF (Appearance -> Motion): nothing eases
    ':host([hk-still]) *{transition:none !important;animation:none !important}'
  ].join('\n');

  // ------------------------------------------------------------------ the pieces (HTML)
  /** @param {Record<string, any>} [d] */
  function data(d) {
    return Object.keys(d || {}).filter(function (k) { return d && d[k] != null; }).map(function (k) { return ' data-' + k + '="' + esc(/** @type {any} */ (d)[k]) + '"'; }).join('');
  }
  // the title row: o { title, sum (html), right (html), back (bool) }. A switch at its right (H.seg) also floats (.flt).
  /** @param {any} o */
  function head(o) {
    var float = o.right && /class="seg"/.test(o.right) ? '<div class="flt" aria-hidden="true" inert><div class="fin">' + o.right + '</div></div>' : '';
    return float + '<div class="hd">' + (o.back ? '<button class="key sm" data-act="back" aria-label="Back">' + chev('left', 16) + '</button>' : '') +
      '<div class="ttl">' + esc(o.title) + '</div>' + (o.sum ? '<div class="sum">' + o.sum + '</div>' : '') +
      (o.right ? '<div class="hdr">' + o.right + '</div>' : '') + '</div>';
  }
  // a section's heading: title, sum (html), more (html, at the right)
  /** @param {string} title @param {string} [sum] @param {string} [more] */
  function section(title, sum, more) {
    return '<div class="sh" role="heading" aria-level="2">' + esc(title) + (sum ? '<span class="sum">' + sum + '</span>' : '') + (more ? '<span class="more">' + more + '</span>' : '') + '</div>';
  }
  /** @param {string} dir @param {number} pt */
  function chev(dir, pt) {
    var d = { left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', up: 'M5 15.5l7-7 7 7', down: 'M5 8.5l7 7 7-7' }[dir] || '';
    return '<span class="g" style="--gs:' + P(pt) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d +
      '" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }
  // inline glyphs the house's set has no name for
  var SVG = {
    power: '<path d="M12 2.5v9M6.6 5.8a8 8 0 1 0 10.8 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    plus: '<path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    minus: '<path d="M4 12h16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    check: '<path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
    play: '<path d="M6.5 3.8v16.4a1 1 0 0 0 1.5.9l13-8.2a1 1 0 0 0 0-1.8l-13-8.2a1 1 0 0 0-1.5.9z" fill="currentColor"/>',
    pause: '<rect x="5" y="3.5" width="4.6" height="17" rx="1.2" fill="currentColor"/><rect x="14.4" y="3.5" width="4.6" height="17" rx="1.2" fill="currentColor"/>',
    next: '<path d="M1.5 5.2v13.6a.8.8 0 0 0 1.2.7L12 13v5.8a.8.8 0 0 0 1.2.7l9.4-6.8a.8.8 0 0 0 0-1.4l-9.4-6.8a.8.8 0 0 0-1.2.7V11L2.7 4.5a.8.8 0 0 0-1.2.7z" fill="currentColor"/>',
    prev: '<path d="M22.5 5.2v13.6a.8.8 0 0 1-1.2.7L12 13v5.8a.8.8 0 0 1-1.2.7l-9.4-6.8a.8.8 0 0 1 0-1.4l9.4-6.8a.8.8 0 0 1 1.2.7V11l9.3-6.5a.8.8 0 0 1 1.2.7z" fill="currentColor"/>',
    shuffle:
      '<path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.8 0 3-1.5 4-3.5M13.5 10.5c1-2 2.2-3.5 4-3.5H21M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5l5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="4" cy="6" r="1.6" fill="currentColor"/>' +
      '<circle cx="4" cy="12" r="1.6" fill="currentColor"/><circle cx="4" cy="18" r="1.6" fill="currentColor"/>',
    volume:
      '<path d="M2.5 8.5h4l5.5-4.5v16l-5.5-4.5h-4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"/>',
    airplay: '<path d="M2.5 3.5h19v13h-4.2l-1.6-2.1h3.6V5.6H4.7v8.8h3.6l-1.6 2.1H2.5z" fill="currentColor"/><path d="M12 12.5l6.2 8.5H5.8z" fill="currentColor"/>'
  };
  /** @param {string} name @param {number} pt @param {string} [color] */
  function svg(name, pt, color) {
    return '<span class="g" style="--gs:' + P(pt) + (color ? ';color:' + color : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + (/** @type {any} */ (SVG)[name] || '') + '</svg></span>';
  }
  // a key: o { g (html), label, cls ('lg', 'w', ...), act, data }
  /** @param {any} o */
  function key(o) {
    return '<button class="key ' + (o.cls || '') + '" aria-label="' + esc(o.label || '') + '"' + data(Object.assign({ act: o.act }, o.data || {})) + (o.off ? ' disabled' : '') + '>' + (o.g || '') +
      '</button>';
  }
  // a capsule: o { g (html), t, cls, act, data, off }
  /** @param {any} o */
  function cap(o) {
    return '<button class="cap ' + (o.cls || '') + '"' + data(Object.assign({ act: o.act }, o.data || {})) + (o.off ? ' disabled' : '') + (o.style ? ' style="' + o.style + '"' : '') + '>' +
      (o.g || '') + esc(o.t || '') + '</button>';
  }
  // a switch between modes: list [{ k, t }], the one on, the act its buttons send (data-k)
  /** @param {Array<{k: string, t: string}>} list @param {string} on @param {string} act */
  function seg(list, on, act) {
    return '<div class="seg" role="tablist">' + list.map(function (x) {
      return '<button role="tab" aria-selected="' + (x.k === on) + '" class="' + (x.k === on ? 'on' : '') + '" data-act="' + act + '" data-k="' + esc(x.k) + '">' + esc(x.t) + '</button>';
    }).join('') + '</div>';
  }
  // a plate: o { cls ('c2 r2 pad lit ...'), act, data, label, style }, its inside
  /** @param {any} o @param {string} inner */
  function plate(o, inner) {
    var tag = o.act ? 'button' : 'div';
    return '<' + tag + ' class="pl ' + (o.cls || '') + '"' + data(Object.assign({ act: o.act }, o.data || {})) + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') +
      (o.style ? ' style="' + o.style + '"' : '') + '>' + inner + '</' + tag + '>';
  }
  // A CENTERED TILE: o { id, name, sub, icon, color, lit, cls, act (the plate's: 'sheet' by default), gact (the glyph's) }
  /** @param {any} o */
  function tile(o) {
    var g = glyph(o.icon, o.gpt || 30, o.color);
    var gl = o.gact ? '<span data-act="' + esc(o.gact) + '" data-id="' + esc(o.id || '') + '" style="display:inline-flex;margin-bottom:' + P(9) + '">' + g + '</span>' : g;
    return plate({ cls: 'tl ' + (o.lit ? 'lit ' : '') + (o.cls || ''), act: o.act || 'sheet', data: Object.assign({ id: o.id }, o.data || {}), label: (o.name || '') + ', ' + (o.sub || '') },
      gl + '<div class="nm">' + esc(o.name) + '</div>' + (o.sub != null ? '<div class="st">' + esc(o.sub) + '</div>' : ''));
  }
  // A LEVEL (Wide): o { id, name, sub, icon, color, fill, pct, lit, word, cls }; the whole tile is the slider
  /** @param {any} o */
  function level(o) {
    var pct = Math.max(0, Math.min(100, Math.round(o.pct || 0)));
    return '<div class="pl lv ' + (o.lit ? 'lit ' : '') + (o.cls || 'c2') + '" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
      '" aria-label="' + esc(o.name) + '" data-lv="' + esc(o.id) + '" style="--v:' + (o.lit ? pct : 0) + '%;--f:' + (o.fill || '#ffe6b0') + '">' +
      '<i class="fill"></i><div class="row"><span class="tg" data-act="' + (o.gact || 'toggle') + '" data-id="' + esc(o.id) + '">' + glyph(o.icon, 30, o.color) + '</span>' +
      '<div class="words" data-act="sheet" data-id="' + esc(o.id) + '"><div class="nm">' + esc(o.name) + '</div><div class="st">' + esc(o.sub || '') + '</div></div>' +
      '<div class="pct" data-act="sheet" data-id="' + esc(o.id) + '">' + esc(o.word != null ? o.word : o.lit ? pct + '%' : 'Off') + '</div></div></div>';
  }
  // A ROW: o { icon, color, name, sub, val (html), lit, act, data, g (html in place of the glyph) }
  /** @param {any} o */
  function row(o) {
    var tag = o.act ? 'button' : 'div';
    return '<' + tag + ' class="rw' + (o.lit ? ' lit' : '') + (o.cls ? ' ' + o.cls : '') + '"' + data(Object.assign({ act: o.act }, o.data || {})) + '>' +
      (o.g != null ? o.g : glyph(o.icon, o.gpt || 24, o.color)) + '<div class="mid"><div class="nm">' + esc(o.name) + '</div>' + (o.sub ? '<div class="st">' + esc(o.sub) + '</div>' : '') + '</div>' +
      (o.val != null ? '<div class="val">' + o.val + '</div>' : '') + '</' + tag + '>';
  }
  /** @param {string[]} rowsHtml @param {string} [cls] */
  function list(rowsHtml, cls) { return '<div class="pl list ' + (cls || 'c4') + '"><div class="rows">' + rowsHtml.join('') + '</div></div>'; }

  // ------------------------------------------------------------------ THE PAGE CARD (each page's base)
  // A page subclasses it and answers draw() (the page's HTML) and, where it has its own, act(name, el, ev). It reads its
  // states through st(id) while drawing, so the ids it reads are its signature (rule 13: told when one changes).
  class HvPage extends HkBase {
    constructor() {
      super();
      this._hv = { mode: null, deep: null };       // the page's mode (a switch's) and where it has gone deeper
      this._reads = [];
      this._html = '';
      var self = this;
      this._root.className = 'hv';
      this._root.addEventListener('click', function (ev) { self._click(ev); });
      wireLevels(this);
    }
    setConfig(config) {
      this._h = harvest((config || {}).src);
      // THE PAGE ENDS AT THIS CARD'S OWN FOOT (hk-layout-grid.js footOf, data-hk-foot): its bottom room (the Home Pill's) is
      // its own padding. Read as plates, a page that grew after it was measured -- a step deeper, channels arriving -- was
      // clipped at its first height.
      this.setAttribute('data-hk-foot', '0');
      if (window.hkHomeView && !window.hkHomeView.car) this.setAttribute('hvdev', ''); else this.removeAttribute('hvdev');
      super.setConfig(config);
    }
    // the states this page read when it last drew, and the clock's minute for the pages that say "4m ago"
    _sigOf() {
      var c = this.client, ids = this._reads, s = '';
      if (!c || !ids.length) return null;
      for (var i = 0; i < ids.length; i++) { var x = c.states[ids[i]]; s += ids[i] + '=' + (x ? x.last_updated : 'x') + ';'; }
      return s + (this.minutely ? Math.floor(Date.now() / 60000) : '');
    }
    /** @param {string} id */
    st(id) {
      if (!id) return null;
      if (this._reading && this._reading.indexOf(id) < 0) this._reading.push(id);
      var c = this.client;
      return (c && c.states && c.states[id]) || null;
    }
    // the harvest of the page the build made
    get h() { return this._h || (this._h = harvest((this._config || {}).src)); }
    _render() {
      if (!this.client || !this._config) return;
      if (this._dragging) { this._pending = true; return; }
      this._reading = [];
      var html = '';
      try { html = this.draw(); } catch (e) { console.error('[hk-hv] ' + this.localName + ' draw', e); html = head({ title: (this._config || {}).title || '' }) +
        '<div class="quiet">This page could not be drawn.</div>'; }
      this._reads = this._reading;
      this._reading = null;
      if (html !== this._html) {
        this._html = html;
        this._root.innerHTML = '<div class="hvi">' + html + '</div>';
        this._float();
      }
      this._hkSig = this._sigOf();
    }
    draw() { return ''; }
    // THE FLOATING SWITCH shows while the title row is under the top (the float's own line): one observer, made again for each
    // new drawing of the page, and gone with the card
    _float() {
      if (this._io) { this._io.disconnect(); this._io = null; }
      var flt = this._root.querySelector('.flt'), hd = this._root.querySelector('.hd');
      if (!flt || !hd || typeof IntersectionObserver === 'undefined') return;
      var top = parseFloat(getComputedStyle(flt).top) || 0, shown = false;
      this._io = new IntersectionObserver(function (es) {
        var e = es[es.length - 1], show = !e.isIntersecting && e.boundingClientRect.top < top;
        if (show !== shown) { shown = show; flt.classList.toggle('show', show); flt.setAttribute('aria-hidden', show ? 'false' : 'true'); flt.inert = !show; }
      }, { rootMargin: '-' + Math.round(top) + 'px 0px 0px 0px', threshold: 0 });
      this._io.observe(hd);
    }
    disconnectedCallback() {
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (super.disconnectedCallback) super.disconnectedCallback();
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (this._html && !this._io) this._float();
    }
    // a mode switch, a step deeper and back: drawn again at once
    /** @param {any} m */
    mode(m) { if (m !== undefined) { this._hv.mode = m; this.redraw(); } return this._hv.mode; }
    /** @param {any} d */
    deep(d) { if (d !== undefined) { this._hv.deep = d; this.redraw(); try { window.scrollTo({ top: 0 }); } catch (e) { /* tests */ } } return this._hv.deep; }
    /** @param {Event} ev */
    _click(ev) {
      var path = /** @type {any} */ (ev).composedPath ? /** @type {any} */ (ev).composedPath() : [];
      var el = null;
      for (var i = 0; i < path.length && path[i] !== this._root; i++) {
        if (path[i] && path[i].getAttribute && path[i].hasAttribute('data-act')) { el = path[i]; break; }
      }
      if (!el || el.hasAttribute('disabled')) return;
      if (this._eat) { this._eat = false; return; }
      ev.stopPropagation();
      var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
      if (this.act && this.act(act, el, ev) === true) return;
      if (act === 'back') { this.deep(null); return; }
      if (act === 'sheet' && id) { window.hkShell.moreInfo(id, this); return; }
      if (act === 'toggle' && id) { this.toggle(id); return; }
      if (act === 'mode') { this.mode(el.getAttribute('data-k')); return; }
      if (act === 'nav') { this._act({ action: 'navigate', navigation_path: el.getAttribute('data-to') }, false); return; }
      if (act === 'run' && id) { this.run(id); return; }
    }
    // a glyph's tap: toggles, unless it is never one tap (a lock, a door, the alarm, the heat: hkCards.neverToggles), which
    // opens its sheet; a scene, a script or a button runs
    /** @param {string} id */
    toggle(id) {
      var d = id.split('.')[0];
      if (d === 'scene' || d === 'script' || d === 'input_button' || d === 'button') { this.run(id); return; }
      if (C.neverToggles && C.neverToggles(this.client, id)) { window.hkShell.moreInfo(id, this); return; }
      this._call('homeassistant', 'toggle', { entity_id: id });
    }
    // a scene, a script or a button: run it
    /** @param {string} id */
    run(id) {
      var d = id.split('.')[0];
      if (d === 'scene') this._call('scene', 'turn_on', { entity_id: id });
      else if (d === 'script') this._call('script', 'turn_on', { entity_id: id });
      else if (d === 'input_button' || d === 'button') this._call(d, 'press', { entity_id: id });
    }
    getCardSize() { return 12; }
  }
  HvPage.CSS = CSS;

  // ------------------------------------------------------------------ A LEVEL'S DRAG (the Wide block's: hk-tile-base.js _levelWire)
  // Across sets it, relative to where the finger lands (the whole tile is 100 %); a drag that starts up or down is the page's
  // scroll. Sent once on letting go and held 2.5 s for the device to answer. While a finger is on it the page draws nothing
  // (a state arriving then waits for the lift), so the slider is never rebuilt under the finger.
  /** @param {any} card */
  function wireLevels(card) {
    var root = card._root, s = /** @type {any} */ (null);
    var T = function () { return window.hkTile || {}; };
    /** @param {string} id */
    var lvOf = function (id) { var st = card.client && card.client.states[id]; return T().levelOf ? T().levelOf(id, st) : null; };
    /** @param {any} el @param {number} p */
    var paint = function (el, p) {
      el.style.setProperty('--v', p + '%');
      var pc = el.querySelector('.pct'); if (pc) pc.textContent = p <= 0 ? 'Off' : p + '%';
      el.classList.toggle('lit', p > 0);
      el.setAttribute('aria-valuenow', String(p));
    };
    root.addEventListener('pointerdown', function (/** @type {PointerEvent} */ ev) {
      if (ev.button > 0) return;
      var el = /** @type {any} */ (ev.target) && /** @type {any} */ (ev.target).closest ? /** @type {any} */ (ev.target).closest('.lv') : null;
      if (!el) return;
      var id = el.getAttribute('data-lv'), lv = lvOf(id);
      if (!lv) return;
      var r = el.getBoundingClientRect();
      s = { el: el, id: id, lv: lv, x: ev.clientX, y: ev.clientY, w: Math.max(1, r.width), pct: lv.off ? 0 : lv.pct, p: null, moved: false, side: false, pid: ev.pointerId };
    });
    root.addEventListener('pointermove', function (/** @type {PointerEvent} */ ev) {
      if (!s || ev.pointerId !== s.pid || s.side) return;
      var dx = ev.clientX - s.x, dy = ev.clientY - s.y;
      if (!s.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) { s.side = true; return; }
        s.moved = true;
        card._dragging = true;
        s.el.classList.add('drag');
        try { s.el.setPointerCapture(ev.pointerId); } catch (x) { /* a test page */ }
      }
      ev.preventDefault();
      s.p = Math.max(0, Math.min(100, Math.round(s.pct + dx / s.w * 100)));
      paint(s.el, s.p);
    });
    /** @param {PointerEvent} ev @param {boolean} ok */
    var end = function (ev, ok) {
      if (!s || ev.pointerId !== s.pid) return;
      var d = s; s = null;
      if (!d.moved) return;
      card._eat = ok; setTimeout(function () { card._eat = false; }, 0);
      d.el.classList.remove('drag');
      card._dragging = false;
      if (ok && d.p != null && d.p !== d.pct) {
        var c = d.lv.set(d.p);
        card._held = card._held || {};
        card._held[d.id] = { pct: d.p, until: Date.now() + 2500 };
        setTimeout(function () { if (card._held) delete card._held[d.id]; card.redraw(); }, 2600);
        card._call(c[0], c[1], c[2]).then(function (/** @type {boolean} */ good) { if (!good && card._held) { delete card._held[d.id]; card.redraw(); } });
      }
      if (card._pending) { card._pending = false; card.redraw(); }
    };
    root.addEventListener('pointerup', function (/** @type {PointerEvent} */ ev) { end(ev, true); });
    root.addEventListener('pointercancel', function (/** @type {PointerEvent} */ ev) { end(ev, false); });
    root.addEventListener('keydown', function (/** @type {KeyboardEvent} */ ev) {
      var el = /** @type {any} */ (ev.target);
      if (!el || !el.classList || !el.classList.contains('lv')) return;
      var id = el.getAttribute('data-lv'), lv = lvOf(id), k = ev.key;
      if (!lv) return;
      if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft') {
        ev.preventDefault();
        var p = Math.max(0, Math.min(100, (lv.off ? 0 : lv.pct) + (k === 'ArrowUp' || k === 'ArrowRight' ? 10 : -10))), c = lv.set(p);
        card._call(c[0], c[1], c[2]);
      } else if (k === 'Enter' || k === ' ') { ev.preventDefault(); card._call(lv.toggle[0], lv.toggle[1], lv.toggle[2]); }
    });
  }
  // the level a page draws for an entity: what the device says, or what a drag just set (held until it answers)
  /** @param {any} card @param {string} id @param {any} st */
  function levelNow(card, id, st) {
    var T = window.hkTile || {}, lv = T.levelOf ? T.levelOf(id, st) : null, held = card._held && card._held[id];
    if (!lv) return null;
    var pct = held && Date.now() < held.until ? held.pct : lv.off ? 0 : lv.pct;
    return { lv: lv, pct: pct };
  }
  // a light's fill: its own color, washed toward white, or the warm white of a bulb (the mockups' Pendants)
  /** @param {any} st @param {string} [fallback] */
  function fillOf(st, fallback) {
    var c = st && st.state === 'on' && st.attributes && st.attributes.rgb_color, T = window.hkTile || {};
    // (near white, it is the warm white of a bulb: on the white plate a white fill would not show -- hkTile.lightRgb)
    if (Array.isArray(c) && c.length >= 3 && (!T.lightRgb || T.lightRgb(st))) {
      var mix = function (/** @type {number} */ x) { return Math.round(x * 0.42 + 255 * 0.58); };
      return 'rgb(' + mix(c[0]) + ',' + mix(c[1]) + ',' + mix(c[2]) + ')';
    }
    return fallback || '#ffe6b0';
  }

  // the kit's own element, so its file is one a page asks for (mantel_server/hk_cards.py: a lazy file names its elements)
  class HvKit extends HkBase { _render() { /* nothing: the pages are the kit's cards */ } }
  register('hk-hv-kit-card', HvKit, 'HK HomeView Kit', 'The parts every HomeView page is drawn from. Not a card to place.');
  if (C.unlisted) C.unlisted('hk-hv-kit-card');

  Object.assign(HV, {
    P: P, esc: esc, hue: hue, HUES: HUES, DEEP: DEEP, colorName: colorName, glyphColor: glyphColor, whiteGlyphs: whiteGlyphs, glyph: glyph, iconOf: iconOf, isOn: isOn,
    word: word, sentence: sentence, ago: ago, clock: clock, harvest: harvest, cardOf: cardOf, cardsOf: cardsOf, CSS: CSS, data: data,
    head: head, section: section, chev: chev, svg: svg, SVG: SVG, key: key, cap: cap, seg: seg, plate: plate, tile: tile, level: level,
    row: row, list: list, where: where, levelNow: levelNow, fillOf: fillOf, Page: HvPage, register: register, C: C, ready: true
  });
  try { window.dispatchEvent(new CustomEvent('hk-hv-ready')); } catch (e) { /* tests */ }
  });
})();
