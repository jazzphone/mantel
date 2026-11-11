// hk-base-card-core.js - the page's accents and glass, HkBase itself, the snapshot cache, the broken-image guard and module wake.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-card-core'] = function (K) {
    var BP = K.BP, FONT_ROOT = K.FONT_ROOT, HOME_GRID = K.HOME_GRID, M = K.M, PILL_W = K.PILL_W, ST = K.ST,
        TILE = K.TILE, v = K.v;

    // ------------------------------------------------------ ON A LIGHT PAGE
    // Someone else's dashboard (place() below), Home Assistant in light mode,
    // and no HK sky behind the cards: the Home app's light look -- gray glass,
    // the theme's own text colors, white when on. Set as custom properties ON
    // THE CARD, so they reach every shadow root under it (an HK card nested in
    // another gets them too) and every literal they replace stays the fallback:
    //   var(--hk-ink, rgba(255,255,255,0.94))
    // is today's white wherever the tone is not set -- HK's own screens, a dark
    // theme, the sky, an overlay. Checked on every new client by tone() (a theme
    // switched to dark arrives as one): a property read, and nothing written
    // unless it changed. T above is the dark side of the same names.
    var LIGHT = {
      '--hk-glass-plate': 'rgba(118, 118, 128, 0.12)',
      '--hk-glass-bg': 'rgba(118, 118, 128, 0.12)',
      '--hk-glass-border': '1px solid rgba(0, 0, 0, 0.04)',
      '--hk-glass-shadow-sm': '0 1px 1px rgba(0, 0, 0, 0.03)',
      '--hk-glass-shadow-lg': '0 1px 2px rgba(0, 0, 0, 0.04)',
      '--hk-glass-shadow-pill': '0 1px 1px rgba(0, 0, 0, 0.03)',
      '--hk-glass-shadow-tall': '0 1px 1px rgba(0, 0, 0, 0.03)',
      '--hk-glass-shadow-scene': '0 1px 1px rgba(0, 0, 0, 0.03)',
      '--hk-glass-shadow-chip': '0 1px 1px rgba(0, 0, 0, 0.03)',
      '--hk-glass-backdrop': 'none',
      '--hk-well-bg': 'rgba(118, 118, 128, 0.16)',
      // text: the theme's own, so a custom light theme is followed too
      '--hk-ink': 'var(--primary-text-color, #1c1c1e)',
      '--hk-ink-2': 'var(--secondary-text-color, rgba(60, 60, 67, 0.62))',
      '--hk-ink-3': 'rgba(60, 60, 67, 0.42)',
      // a glyph with no color of its own, off
      '--hk-glyph': 'rgba(60, 60, 67, 0.78)',
      // a key or chip ON a plate (a tint, not a plate of its own), and selected
      '--hk-key': 'rgba(118, 118, 128, 0.14)',
      '--hk-key-strong': 'rgba(118, 118, 128, 0.24)',
      // a hairline, and a track
      '--hk-line': 'rgba(60, 60, 67, 0.16)',
      '--hk-line-strong': 'rgba(60, 60, 67, 0.24)',
      // NOT TEXT, so not on the text scale: a mark (a dial's off band, a chart
      // notch, a selection ring, a chevron) and a progress fill with no accent.
      // Each keeps its own dark value; on a light page, these.
      '--hk-mark': 'rgba(60, 60, 67, 0.5)',
      '--hk-track-fill': 'var(--secondary-text-color, rgba(60, 60, 67, 0.62))',
      // the drop shadows text carries over a photo or the sky
      '--hk-glow': 'none',
      // a warning and a failure, as text: the light-mode system orange and red
      // (the dark ones are too pale on a light page)
      '--hk-warn': '#c93400',
      '--hk-fail': '#d70015',
      // what is on: the white plate lifts off the page
      '--hk-on-shadow': '0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 18px rgba(0, 0, 0, 0.09)',
      // the look's own (Tinted, hk-settings.js), set on <html>: not here --
      // the light page's border, shadows and well above stand instead
      '--hk-look-edge': 'initial',
      '--hk-look-edge-color': 'initial',
      '--hk-look-shadow': 'initial',
      '--hk-look-well': 'initial',
      '--hk-look-dash': 'initial'
    };
    var LIGHT_KEYS = Object.keys(LIGHT);

    // Flat is the same material system, opaque and with a small contact shadow.
    // Applied to owned roots so HA view themes cannot replace its chosen tone.
    function flatTokens(light) {
      var plate = light ? '#FAF9F6' : '#2B2C30', key = light ? '#ECEAE5' : '#3A3B40';
      var elevated = light ? '#FFFFFF' : '#35363C';
      var shadow = light ? '0 2px 3px rgba(28,26,22,.12)' : '0 1px 2px rgba(0,0,0,.24)';
      var t = {
        '--hk-glass-plate': plate, '--hk-glass-bg': plate, '--hk-chip-plate': plate,
        '--hk-glass-plate-sheet': key, '--hk-plate-here': plate,
        '--hk-glass-backdrop': 'none', '--hk-chip-backdrop': 'none', '--hk-float-backdrop': 'none',
        '--hk-look-edge': '1px solid transparent', '--hk-look-edge-color': 'transparent',
        // a well a shade deeper than an off tile's stone on Light (it
        // vanished into --hk-tile-off), Dark's slate as the keys
        '--hk-look-shadow': shadow, '--hk-on-shadow': shadow, '--hk-look-well': key, '--hk-well-bg': key,
        '--hk-overlay': elevated, '--hk-overlay-solid': elevated, '--hk-float-plate': elevated,
        '--hk-flat-elevated': elevated, '--hk-flat-menu': light ? '#FAF9F6' : elevated,   // Light: the cards' ivory (the user's pick, 2026-10-16)
        // scenes wear the off tiles' tone (the user, 2026-10-17)
        '--hk-flat-scene': light ? '#F3F1EC' : '#323338',
        '--hk-flat-ground': light ? '#EEECE6' : '#17181A',
        '--hk-flat-elevated-shadow': light ? '0 5px 12px -3px rgba(28,26,22,.22)' : shadow,
        '--hk-ink': light ? '#252528' : '#F5F4F0',
        '--hk-ink-2': light ? '#626267' : '#C3C3C6',
        '--hk-ink-3': light ? '#626267' : '#A3A4A9',
        '--hk-glyph': light ? '#626267' : '#F5F4F0', '--hk-glow': 'none',
        '--hk-key': key, '--hk-key-strong': light ? '#D8D5CD' : '#48494F',
        '--hk-line': light ? '#D8D5CD' : '#48494F', '--hk-line-strong': light ? '#B9B6B0' : '#62636A',
        '--hk-mark': light ? '#77777C' : '#A3A4A9', '--hk-track-fill': light ? '#626267' : '#C3C3C6', '--hk-flat-chart-line': light ? '#626267' : '#C3C3C6',
        '--hk-battery-fill': '#30d158', '--hk-battery-fill-low': '#ff453a',
        '--hk-warn': light ? '#A25D00' : '#FFB340', '--hk-fail': light ? '#C42323' : '#FF6961',
        // the weather glyphs' white and cyan layers (hk-header.js WX_COLOUR)
        '--hk-wx-w': light ? '#A6A6AB' : '#FFFFFF', '--hk-wx-c': light ? '#1C9BD6' : '#64D2FF',
        // the segmented control (segCss): a track darker than the plate, the
        // choice white over it; the battery's shell and Limit mark, the house
        // bar's not-backed-up share (hk-energy.js) -- white on Light vanished
        '--hk-seg-track': key, '--hk-seg-on': '#FFFFFF', '--hk-seg-bw': '0px',
        '--hk-pill-bg': key,
        // a field or a control on the page itself (Music's search and Plays
        // on): the cards' surface and contact shadow, not a key's gray
        '--hk-field-bg': plate, '--hk-field-shadow': shadow,
        // the shadow under a sheet's header over what scrolls (hk-detail):
        // softer on Light's white sheet, where 30 % black read as a smudge
        '--hk-shade-a': light ? 'rgba(28,26,22,.12)' : 'rgba(0,0,0,.30)', '--hk-shade-b': light ? 'rgba(28,26,22,.04)' : 'rgba(0,0,0,.10)',
        // an off tile: stone a shade under the page on Light, so a lit (white)
        // one stands out as in the Home app; Dark's graphite does already
        '--hk-tile-off': light ? '#F3F1EC' : plate,
        // A SHEET'S SETTINGS PANE (hk-detail.js .acc; HK Settings sets the
        // same --acc-* set for its own): white at 8 % on Light's white sheet
        // was nothing at all -- groups, switches, the size choice, the icon
        // search (2026-10-17). Dark keeps the pane's own values.
        '--acc-cell': light ? key : 'rgba(255,255,255,0.08)', '--acc-sep': light ? '#D8D5CD' : 'rgba(255,255,255,0.09)',
        '--acc-seg': light ? key : 'rgba(255,255,255,0.08)', '--acc-seg-on': light ? '#FFFFFF' : 'rgba(255,255,255,0.24)',
        '--acc-glyph': light ? key : 'rgba(255,255,255,0.12)', '--acc-fill': light ? '#D8D5CD' : 'rgba(255,255,255,0.18)',
        '--acc-glyph-on-bg': light ? '#252528' : 'rgba(255,255,255,0.92)', '--acc-glyph-on-fg': light ? '#FFFFFF' : '#000',
        '--acc-text': light ? '#252528' : '#fff', '--acc-label2': light ? '#626267' : '#C3C3C6',
        '--acc-red': light ? '#C42323' : '#ff453a', '--acc-orange': light ? '#A25D00' : '#ff9f0a', '--acc-green': light ? '#248A3D' : '#34c759',
        '--hk-seg-on-shadow': light ? '0 1px 3px rgba(28,26,22,.18)' : 'none',
        // ...and one on the page itself (segCss raised): the cards' surface,
        // its choice a stone well on Light (white on Dark, where it reads)
        '--hk-seg-raised-track': plate, '--hk-seg-raised-on': light ? key : '#FFFFFF', '--hk-seg-raised-on-shadow': 'none',
        '--hk-battery-shell': light ? '#B9B6B0' : 'rgba(255,255,255,.42)', '--hk-battery-mark': light ? '#77777C' : 'rgba(255,255,255,.85)',
        '--hk-not-backed': light ? '#C9C6BF' : 'rgba(255,255,255,0.55)'
      };
      ['sm','lg','pill','tall','scene','chip'].forEach(function (k) { t['--hk-glass-shadow-' + k] = shadow; });
      return t;
    }
    var FLAT = { light: flatTokens(true), dark: flatTokens(false) };

    // Shared by owned shadow roots and light-DOM overlays. No DOM traversal.
    // `keepMotion`: a card whose motion is its content -- the charts drawing
    // in, the water supply's waves, the power flows (a class's FLAT_MOTION).
    // They cost little and the user wants them (2026-10-16); Flat still takes
    // their blur and filters.
    function flatCss(prefix, keepMotion) {
      var p = prefix || ':host([hk-flat])';
      return p + ',' + p + ' *,' + p + ' *::before,' + p + ' *::after{' +
        (keepMotion ? '' : 'animation:none!important;transition:none!important;') + 'backdrop-filter:none!important;' +
        '-webkit-backdrop-filter:none!important;' + (keepMotion ? '' : 'filter:none!important;') + 'text-shadow:none!important;' +
        'scroll-behavior:auto!important;' + (keepMotion ? '' : 'will-change:auto!important') + '}' +
        (keepMotion ? '' : p + ' :active{transform:none!important}') +
        // (a scene lit -- running, or its request in flight -- is white, as a
        // tapped one is: feedback, never a state it keeps)
        p + ' .scene:not(.hk-tapped):not([data-on="1"]){background:var(--hk-flat-scene)!important}' +
        p + ' .scene:not(.tinted) .icon{color:var(--hk-ink)!important;fill:var(--hk-ink)!important}' +
        // white on a COLORED well only: a well left clear (the alarm's, its
        // glyph in its own color on the white tile) keeps its glyph's color
        // (Safari writes a clear well as `background: none`, Chrome as
        // `transparent`: both, or Safari painted the playing HomePod white)
        p + ' .card[data-on="1"] .well:not([style*="transparent"]):not([style*="background: none"]) .icon{color:white!important;fill:white!important}' +
        // FLAT COLORS (2026-10-17): a lit pill is pure white; an OFF one wears
        // its source's wash (hk-tile.js, flatIdle: --hk-idle-pill, its glyph
        // --hk-idle-glyph), so on and off read apart by color, not shade
        p + ' hk-plate.card[data-hk-idle]:not([data-on="1"]):not(.hk-tapped){background:var(--hk-idle-pill)!important}' +
        p + ' hk-plate.card.scene[data-hk-idle]:not([data-on="1"]):not(.hk-tapped) .icon{color:var(--hk-idle-glyph)!important;fill:var(--hk-idle-glyph)!important}' +
        p + ' .scene .well::after{display:none!important}' +
        (keepMotion ? '' : p + ' .anim,' + p + ' .anim>*{opacity:1;clip-path:none;transform:none}') +
        p + ' .vs{background:var(--hk-key)!important}' +
        p + ' .btn:not(.sel),'+p+' .bk button{background:var(--hk-key);color:var(--hk-ink)}' +
        p + ' .btn.menu .cur{color:var(--hk-ink-2)}' +
        p + ' .vs .gl:not(.dark){color:var(--hk-ink-2)}' +
        p + ' .prog-fill{animation:none!important}' +
        // (not an element focused by script -- a sheet takes focus as it
        // opens, tabindex -1, and Safari ringed the whole sheet in blue)
        p + ' :focus-visible:not([tabindex="-1"]){outline:2px solid var(--hk-accent,#0a84ff);outline-offset:3px}' +
        p + ' [tabindex="-1"]:focus{outline:none}';
    }
    var FLAT_ROOTS = new Set();
    function flatTone(el) {
      var S = window.hkSettings, a = S && S.rendering ? S.rendering() : { flat: false };
      var key = a.flat ? (el._hkFlatKind === 'music' ? 'dark' : a.theme) : '';
      var own = !!key && (!el._hkNested || !!el._hkFlatKind);
      if (el._hkFlatTone === key && el._hkFlatOwn === own) return;
      var wasFlat = !!el._hkFlatTone && el._hkFlatOwn;
      el._hkFlatOwn = own;
      if (key && el.getAnimations && !(el.constructor && el.constructor.FLAT_MOTION)) {
        el.getAnimations({ subtree: true }).forEach(function (a) { try { a.cancel(); } catch (e) { /* already ended */ } });
      }
      if (key && el._progAnim) { try { el._progAnim.cancel(); } catch (e) {} el._progAnim = null; }
      el._hkFlatTone = key;
      if (key) el.setAttribute('hk-flat', key); else if (el.removeAttribute) el.removeAttribute('hk-flat');
      Object.keys(FLAT.light).forEach(function (k) {
        if (own) el.style.setProperty(k, FLAT[key][k]); else if (wasFlat) el.style.removeProperty(k);
      });
    }

    // ARTWORK THROUGH HOME ASSISTANT. Almost every album cover
    // Music Assistant names is on Apple's CDN (is1-ssl.mzstatic.com), which a
    // wall tablet without internet cannot reach even with the hosts allowed by name -- the CDN
    // answers each lookup with different addresses. So an image on ANOTHER
    // host is not loaded from there: HK Frontend signs a path to its own
    // /api/hk_frontend/art (art.py), where HA fetches it, scales it to `size`
    // and serves it from the page's own origin -- no internet on the tablet, no
    // mixed content over https. Signing is batched: every tile painted in one
    // task goes in one websocket call. A server without the command (an older
    // HK Frontend) answers with an error, and the tile loads the URL directly.
    var ART_RESIGN_MS = 20 * 3600 * 1000;       // the server signs for 24 h
    var artSigned = new Map();                  // size + ' ' + url -> {path, at}
    var artQueues = {};                         // size -> {waiters: Map, timer}
    function artRemote(url) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
      try { return new URL(url).host !== location.host; } catch (e) { return false; }
    }
    // A client as is; a legacy host input through the host adapter.
    function asClient(source) {
      if (!source) return null;
      if (window.hkClient && window.hkClient.is(source)) return source;
      var host = window.hkHostClient;
      return host && host.from ? host.from(source) : null;
    }
    // A replaced port's listener goes with it: its late `ready` must not mark
    // the new server's states.
    function artReady() {
      artSigned.clear();
      var c = window.hkCards.client(), s = c && c.states, set = new WeakSet();
      if (s) for (var k in s) if (s[k] && typeof s[k] === 'object') set.add(s[k]);
      ST.STALE = set;
      ST.staleEpoch++;
    }
    function artWatch(client) {
      var conn = client && client.subscriptions;
      if (!conn || conn === ST.artConn) return;
      if (ST.artConn) ST.artConn.removeEventListener('ready', artReady);
      ST.artConn = conn;
      conn.addEventListener('ready', artReady);
    }
    function artForget(url, size) { artSigned.delete(size + ' ' + url); }
    // A PICTURE ON THIS PAGE'S OWN ORIGIN (a player's artwork, which Mantel serves itself): the host may ask for it at
    // the tile's size (hkShell.artSized, 2026-10-29), so a cover of several megabytes is not downloaded to draw 150
    // px. A host with nothing to say (or one that throws) leaves the address as it is.
    function artLocal(url, size) {
      var S = window.hkShell, got = null;
      try { got = S && typeof S.artSized === 'function' ? S.artSized(url, size) : null; } catch (e) { got = null; }
      return typeof got === 'string' && got ? got : url;
    }
    function artSign(source, url, size, cb) {
      var client = asClient(source);
      artWatch(client);
      var key = size + ' ' + url, hit = artSigned.get(key);
      if (hit && Date.now() - hit.at < ART_RESIGN_MS) { cb(hit.path); return; }
      if (!client || !client.callWS) { cb(url); return; }
      var q = artQueues[size] || (artQueues[size] = { waiters: new Map(), timer: null });
      if (!q.waiters.has(url)) q.waiters.set(url, []);
      q.waiters.get(url).push(cb);
      if (q.timer) return;
      q.timer = setTimeout(function () {
        delete artQueues[size];
        var urls = Array.from(q.waiters.keys());
        if (artSigned.size > 3000) artSigned.clear();
        for (var i = 0; i < urls.length; i += 200) (function (batch) {
          Promise.resolve(client.callWS({ type: 'hk_frontend/art/sign', urls: batch, size: size }))
            .then(function (res) {
              var got = (res && res.signed) || {};
              batch.forEach(function (u) {
                if (got[u]) artSigned.set(size + ' ' + u, { path: got[u], at: Date.now() });
                q.waiters.get(u).forEach(function (f) { f(got[u] || u); });
              });
            }, function () {
              batch.forEach(function (u) { q.waiters.get(u).forEach(function (f) { f(u); }); });
            });
        })(urls.slice(i, i + 200));
      }, 0);
    }

    // HOW LONG AN ARTWORK URL GETS BEFORE THE PLACEHOLDER WINS. See _artImage.
    //
    // 6 seconds, and the number is bounded on both sides by measurement rather
    // than taste. Below it: the slowest artwork that does load on a home
    // network (measured across a whole library) answers in well under a
    // second. Above it: a wall dashboard that shows a
    // row of empty squares for longer than this reads as broken, and a
    // tablet without internet answers a public CDN with "never" -- the request
    // hangs rather than being refused -- so every millisecond past the point of
    // doubt is a millisecond of looking wrong.
    var ART_TIMEOUT = 6000;

    // The SELECTED plate is a solid white, not glass. That contrast is the whole
    // signal and it is what the Home app does -- glass-on-glass is unreadable at
    // arm's length on a wall.
    // THE SELECTABLE PILL'S LABEL (13.5 / 600, the Music speakers' and Clean
    // Areas' rooms): declarations, no braces. The utility pages' capsules --
    // quick timers, the valve's On / Off, the timer sheet's quick names --
    // read it too, so the 40 px capsules all say the same size.
    var PILL_LABEL = 'font-size:13.5px;font-weight:600;letter-spacing:-0.1px';
    var SELECTED_BG   = 'rgba(255, 255, 255, 0.96)';
    var SELECTED_TEXT = 'rgba(0, 0, 0, 0.88)';
    // WHERE HK'S OWN DIALOGS MOUNT (Phase 2 P2.5): the host shell's dialog root,
    // and there again when a sheet made earlier is opened after the host's root
    // changed. Nothing to mount in: left where it is.
    function dialogMount(el) {
      var sh = window.hkShell, r = (sh && sh.dialogRoot ? sh.dialogRoot() : null) || document.body;
      if (r && el.parentNode !== r) r.appendChild(el);
    }
    // SCROLL EDGES (2026-10-17, the user: every list that scrolls, one way). NONE: a list is cut clean at its frame's
    // edge, as iOS cuts one under a fixed header. Tried and dropped the same day -- shadows at both ends (read as a
    // rounded tube), then soft fades (the header's and footer's own edge still showed through, so the effect was lost;
    // strong enough to hide it, rows vanished). The user: "no shadow, the simplest" -- and a shadow is foreign to Flat
    // anyway. The frame, `.hk-edge`, still holds the scroller (its one child) so it can shrink to fit, and still carries
    // hk-scrolled / hk-scroll-more for anything that wants to know.
    //   markup  <div class="hk-edge"><div class="lst">...</div></div>, or the
    //           scroller alone marked `hk-fades` (it carries the marks itself)
    //   then    hkCards.edges(root) once it is in
    function edgeCss(scope) {
      var p = scope || '';
      return p + '.hk-edge{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}' +
        p + '.hk-edge>:first-child{flex:1 1 auto;min-height:0}';
    }

    // NEVER A ONE-TAP TOGGLE: what opens the house, arms or disarms it, or runs
    // the water and the heat. A garage (or gate, or door) cover is a door; a
    // shade is not.
    var NEVER_TOGGLE = { lock: 1, alarm_control_panel: 1, valve: 1, climate: 1, water_heater: 1,
                         siren: 1, vacuum: 1, camera: 1 };
    var DOOR_COVERS = { garage: 1, gate: 1, door: 1 };
    function neverToggles(client, id) {
      if (!id || typeof id !== 'string') return false;
      var d = id.split('.')[0];
      if (NEVER_TOGGLE[d]) return true;
      if (d !== 'cover') return false;
      var st = client && client.states && client.states[id];
      return !!(st && st.attributes && DOOR_COVERS[st.attributes.device_class]);
    }
    function fromMouse(e) {
      if (e.pointerType) return e.pointerType === 'mouse';
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return false;
      return ST.lastPress === 'mouse';
    }

    // A TAP THAT CHANGES PAGE CHANGES IT AT ONCE (2026-10-11). It once dimmed
    // the control for one drawn frame first, so the tap was answered before
    // the page was -- a frame or two later on every page change, which cost
    // more than it gave (the whole page change measured on the tablets: twice
    // as fast with this and the other page-change holds gone). `el` is kept
    // for the callers.
    function navigate(path, el) {  // eslint-disable-line no-unused-vars
      window.hkShell.navigate(path);
    }
    // WHERE A `navigate` ACTION GOES (a card's _act, and House Status, hk-house-status.js, which opens what a chip opens)
    function navPath(spec) {
      var p = String(spec.navigation_path), seg = String(location.pathname).split('/')[1], map = spec.navigation_path_map;
      // navigation_path_map: a dashboard where "./x" is the wrong answer -- say, an energy dashboard whose battery
      // page is a separate dashboard of its own. Keyed on the url_path segment: data, not a branch in every call site.
      if (map && Object.prototype.hasOwnProperty.call(map, seg)) p = map[seg];
      // "./x" is relative to the CURRENT dashboard, which is how one shared config navigates correctly on every dashboard.
      return p.slice(0, 2) === './' ? '/' + seg + '/' + p.slice(2) : p;
    }

    // A HOME GRID BLOCK OPENS SOMETHING WHEN TAPPED (2026-10-31, the owner on 0.1.94: "ALL the blocks should do
    // something if you tap on them" -- the Weather block did not open Weather). A card that is a block (it carries a
    // size in the grid's table) and says where it leads, `_tapTarget()`, opens that when it is tapped anywhere that is
    // no control; the controls inside it (a light's toggle, a timer's ring, a thermostat's arrows, a row with its own
    // sheet) keep their own taps. `_tapTarget()` answers a list of places in order and the first this screen has wins:
    //   { page: 'weather' }   this screen's page of that kind (menu.pagePath); none on a screen without it
    //   { room: area }        this screen's page for the room
    //   { sheet: id }         the entity's sheet (hkShell.moreInfo)
    //   { group: [title, ids, opts] }  a sheet of several things (hkDetail.openGroup)
    //   { run: fn }           the card's own: a list over the page, the tab bar's More
    // (and the block's When Tapped, `tap`, chooses between a page and a sheet: the editor's Automatic is neither)
    // None of them to open, and the tap does nothing, silently.
    var TAP_CONTROLS = 'button,a,input,select,textarea,summary,[role=button],[role=slider],[role=switch],[role=checkbox],[role=link],[role=menuitem],' +
      // (what drags itself, and ends in a click: a slider, the thermostat's ring)
      '[data-more],[data-hk-control],[data-notap],.ring,.vs,' +
      // (the parts of a block that act on a tap and leave it to bubble: an event, a day, a to-do item, a timer's key...)
      '[data-ev],[data-day],[data-mon],[data-go],[data-uid],[data-open],[data-add],[data-id],[data-off],[data-kind],[data-p],[data-preset],[data-new],[data-timer]';
    // WHEN TAPPED (the block's `tap`, as the Side Pane's): 'page' or 'sheet' puts that kind first -- the other still
    // follows when there is none of it -- and 'none' opens nothing
    var TAP_KIND = { page: 'page', room: 'page', sheet: 'sheet', group: 'sheet', run: 'sheet' };
    function openTarget(el, list) {
      var M = window.hkCards.menu, D = window.hkDetail, SH = window.hkShell, mode = (el._config || {}).tap;
      var all = (Array.isArray(list) ? list : [list]).filter(Boolean);
      if (mode === 'none') return false;
      if (mode === 'page' || mode === 'sheet') {
        all = all.filter(function (t) { return TAP_KIND[Object.keys(t)[0]] === mode; })
          .concat(all.filter(function (t) { return TAP_KIND[Object.keys(t)[0]] !== mode; }));
      }
      for (var i = 0; i < all.length; i++) {
        var t = all[i], path = null;
        try {
          if (t.page) path = M && M.pagePath ? M.pagePath(t.page) : null;
          else if (t.room) path = M && M.roomPath ? M.roomPath(t.room) : null;
          if (path) { navigate(path, el); return true; }
          if (t.sheet && SH && SH.moreInfo) { SH.moreInfo(t.sheet, el); return true; }
          if (t.group && D && D.openGroup) { D.openGroup.apply(D, t.group); return true; }
          if (t.run) { t.run(); return true; }
        } catch (e) { /* a place that will not open: the next */ }
      }
      return false;
    }

    // (also for the cards that are no HkBase -- hk-control-card -- which call it from a listener of their own)
    function blockClick(el, e, root) {
      if (e.defaultPrevented || e._hkBlockTap || typeof el._tapTarget !== 'function') return;
      var size = el.getAttribute && el.getAttribute('size');
      if (!size || !HOME_GRID.sizes[size]) return;
      var target = el._tapTarget();
      if (!target || (Array.isArray(target) && !target.length) || (el._config && el._config.tap === 'none')) return;
      var path = e.composedPath ? e.composedPath() : [e.target];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (n === root || n === el) break;
        if (n && n.matches && n.matches(TAP_CONTROLS)) return;
      }
      // (a block inside a block, the climate panel's dial: the inner one answers, the outer one leaves it be)
      if (openTarget(el, target)) e._hkBlockTap = true;
    }

    function confirmSheet(text, onOk, opts) {
      opts = opts || {};
      if (!ST._sheet) {
        ST._sheet = document.createElement('div');
        ST._sheet.id = 'hk-confirm';
        ST._sheet.innerHTML =
          '<style>' +
          '#hk-confirm{position:fixed;inset:0;z-index:9999;display:none;' +
          '  align-items:center;justify-content:center;' +
          '  background:rgba(0,0,0,0.45);' + FONT_ROOT + '}' +
          '#hk-confirm[data-open]{display:flex}' +
          // A LIFT, like everything else on these pages: every card, pill and
          // tile carries a shadow, so without one this sheet would read as
          // painted on rather than above. Deeper than a card's
          // `0 6px 18px` because it floats much further off the page.
          // 340px, and the padding below is generous with it: at 270 with 16px
          // sides, "Leave Playing" leaves about 14px each side of its half --
          // which on a wall reads as text that only just fits rather than a
          // deliberate button.
          '#hk-confirm .box{width:340px;border-radius:16px;overflow:hidden;' +
          '  background:rgba(42,42,44,0.94);color:' + v('ink') + ';text-align:center;' +
          '  box-shadow:0 24px 64px rgba(0,0,0,0.55),' +
          '             0 2px 10px rgba(0,0,0,0.35)}' +
          '#hk-confirm .txt{padding:22px 24px 18px;font-size:15px;font-weight:600;' +
          '  line-height:1.35;color:' + v('ink') + '}' +
          // A second line for WHAT the question is about -- the rooms and what
          // they are playing. Collapsed to nothing when unused, so a sheet
          // without one is unchanged to the pixel.
          '#hk-confirm .det{display:none;padding:0 24px 20px;font-size:13px;' +
          '  font-weight:500;line-height:1.4;color:' + v('ink-2') + '}' +
          '#hk-confirm .det[data-on]{display:block}' +
          // The title owns the gap when it is alone; when a detail line follows
          // it, the detail owns the bottom and the title gives some back, or
          // the two lines drift apart into separate paragraphs.
          '#hk-confirm .txt + .det[data-on]{margin-top:-8px}' +
          // THE ROW STAYS FULL-BLEED, with the hairline divider. Inset button
          // plates stop the sheet reading as the system alert it is copied
          // from. The margin is bought with the box WIDTH instead: the labels are
          // centred in their halves, so a wider sheet gives them more air
          // without changing what the sheet is.
          '#hk-confirm .row{display:grid;grid-template-columns:1fr 1fr;' +
          '  border-top:0.5px solid rgba(255,255,255,0.18)}' +
          '#hk-confirm button{appearance:none;border:0;background:none;color:#0a84ff;' +
          '  font-family:inherit;font-size:17px;padding:14px 12px;cursor:pointer;' +
          '  white-space:nowrap}' +
          // NO BOLD ON EITHER BUTTON. The iOS convention emboldens the
          // default, and on a two-action pair that quietly recommends one half
          // -- often the destructive one. The divider separates them and the
          // words say what they do, so both buttons are one weight everywhere
          // and nothing is being recommended by typography.
          '#hk-confirm button + button{border-left:0.5px solid rgba(255,255,255,0.18)}' +
          // `destructive: true`: the action that takes something away is red
          // (Apple's destructive style), never bold
          '#hk-confirm[data-red] [data-yes]{color:#ff453a}' +
          '</style>' +
          '<div class="box" role="alertdialog" aria-modal="true">' +
          '<div class="txt"></div><div class="det"></div>' +
          '<div class="row"><button data-no>Cancel</button>' +
          '<button data-yes>Confirm</button></div></div>';
        dialogMount(ST._sheet);
      } else dialogMount(ST._sheet);
      // (a second confirm over an open one: the first's Escape listener is taken off first -- it was left behind and
      // swallowed every Escape on the page from then on; the third audit pass, 2026-11-01)
      if (ST._sheet._esc) document.removeEventListener('keydown', ST._sheet._esc, true);
      var close = function () {
        ST._sheet.removeAttribute('data-open');
        document.removeEventListener('keydown', esc, true);
        if (ST._sheet._esc === esc) ST._sheet._esc = null;
      };
      var esc = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      ST._sheet._esc = esc;
      // Rebound every time: the handler closes over THIS call's onOk.
      ST._sheet.querySelector('[data-no]').onclick = function () {
        close();
        if (opts.onNo) opts.onNo();
      };
      ST._sheet.querySelector('[data-yes]').onclick = function () { close(); onOk(); };
      // Only the backdrop itself, never a click that bubbled out of the box.
      ST._sheet.onclick = function (e) { if (e.target === ST._sheet) close(); };
      ST._sheet.querySelector('.txt').textContent = text || 'Are you sure?';
      ST._sheet.querySelector('[data-no]').textContent = opts.no || 'Cancel';
      ST._sheet.querySelector('[data-yes]').textContent = opts.yes || 'Confirm';
      if (opts.destructive) ST._sheet.setAttribute('data-red', ''); else ST._sheet.removeAttribute('data-red');
      var det = ST._sheet.querySelector('.det');
      det.textContent = opts.detail || '';
      if (opts.detail) det.setAttribute('data-on', '1');
      else det.removeAttribute('data-on');
      ST._sheet.setAttribute('data-open', '1');
      document.addEventListener('keydown', esc, true);
      return ST._sheet;
    }

    // ------------------------------------------------ the snapshot cache
    //
    // PAINT THE LAST FRAME WE SAW, INSTANTLY, while the fresh one is fetched.
    //
    // MEASURED: a strip's nine tiles fill in
    // between 463ms and 2427ms from a cold load, and the cameras page's stills
    // take 1.6-3.1s EACH. That is not this code -- it is how long UniFi Protect
    // takes to produce a snapshot, measured straight off /api/camera_proxy. No
    // amount of loading earlier makes Protect answer faster, so the only way to
    // have something on screen at 0ms is to already have it.
    //
    // A THUMBNAIL, NOT THE FRAME. 160px wide at JPEG q0.5 is ~4KB against the
    // real still's ~34KB, so all nine fit in ~40KB of localStorage instead of
    // ~400. It is soft, and it should be: it is a placeholder that gets replaced
    // within a couple of seconds, and it must not be mistakable for live.
    //
    // THE AGE LABEL IS WHAT KEEPS IT HONEST. A cached frame restores the slot's
    // `at` timestamp too, so a tile painted from cache reads "4m" or "2h" until
    // the fresh one lands and resets it to "now". Showing an old picture with no
    // label would be worse than showing black.
    //
    // Every access is wrapped: localStorage throws outright in some contexts
    // (private windows, a browser set to block site data, thumbnail capture),
    // and a camera strip must not take the page down with it.
    var SNAP_KEY = 'hk-snap-v1';
    // 160, and the softness is WANTED. 320 would spare the cameras page's
    // 399x224 tiles a 2.5x upscale, but the soft frame is better: it reads as
    // a visual identifier of which
    // camera is which while the real one loads, and cannot be mistaken for live.
    // Nine cameras measure 37,643 bytes at 160 against 115,067 at 320.
    var SNAP_W = 160;              // thumbnail width; height follows the aspect
    var SNAP_MIN_GAP = 5 * 60 * 1000;   // write at most this often per camera
    function snapMem() {
      if (ST.SNAP_MEM) return ST.SNAP_MEM;
      ST.SNAP_MEM = {};
      try {
        var all = JSON.parse(localStorage.getItem(SNAP_KEY) || '{}') || {};
        Object.keys(all).forEach(function (k) { if (all[k] && all[k].d) ST.SNAP_MEM[k] = snapEntry(null, all[k].t, all[k].d); });
      } catch (e) { /* no storage: memory alone */ }
      return ST.SNAP_MEM;
    }
    // { t, d } -- `d`, the data URL, encoded from the thumbnail on first use
    function snapEntry(cv, t, d) {
      var e = { t: t, _cv: cv, _d: d || null };
      Object.defineProperty(e, 'd', { enumerable: true, get: function () {
        if (!e._d && e._cv) {
          try { e._d = e._cv.toDataURL('image/jpeg', 0.5); } catch (x) { e._d = null; }
          e._cv = null;
        }
        return e._d;
      } });
      return e;
    }
    function snapFlush() {
      if (!ST.snapDirty) return;
      ST.snapDirty = false;
      try {
        var out = {}, mem = snapMem();
        Object.keys(mem).forEach(function (k) { var d = mem[k].d; if (d) out[k] = { d: d, t: mem[k].t }; });
        localStorage.setItem(SNAP_KEY, JSON.stringify(out));
      } catch (e) { /* quota or no storage: the memory copy still serves this page */ }
    }
    function snapSaveLater() {
      ST.snapDirty = true;
      if (ST.snapSaveT) return;
      var go = function () { ST.snapSaveT = null; snapFlush(); };
      // when the tablet has a moment -- after the page change, never during
      if (typeof requestIdleCallback === 'function') ST.snapSaveT = requestIdleCallback(go, { timeout: 8000 });
      else ST.snapSaveT = setTimeout(go, 3000);
    }

    // `maxAge` is opt-in: the strip passes nothing (any age will do, the label
    // tells the truth) and the cameras page passes SNAP_FRESH.
    function snapCacheGet(entity, maxAge) {
      var hit = snapMem()[entity];
      if (!hit) return null;
      if (maxAge && (Date.now() - hit.t) > maxAge) return null;
      return hit.d ? hit : null;
    }

    // Called from a successful load. Cheap on the common path: it sees a
    // recent entry and returns before touching a canvas.
    // `img` may also be a playing <video> (its current frame), and `force`
    // writes whatever the age of the last entry: the cameras page keeps the
    // frames it is leaving (hk-campost.js), the strip its stills. `at`: when
    // the frame was TAKEN (a still can be older than now), so FRESH stays
    // honest. Returns the entry ({t, d}: d encoded only when read).
    function snapCachePut(entity, img, force, at) {
      try {
        var mem = snapMem(), prev = mem[entity];
        if (!force && prev && (Date.now() - prev.t) < SNAP_MIN_GAP) return null;
        var iw = img.naturalWidth || img.videoWidth, ih = img.naturalHeight || img.videoHeight;
        if (!iw || !ih) return null;
        var h = Math.max(1, Math.round(SNAP_W * ih / iw));
        var cv = document.createElement('canvas');
        cv.width = SNAP_W; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, SNAP_W, h);
        var e = mem[entity] = snapEntry(cv, at || Date.now(), null);
        snapSaveLater();
        return e;
      } catch (e) {
        // A tainted canvas, or no canvas at all. The strip works without the
        // cache; it just starts black again.
        return null;
      }
    }

    // (the art guard below keeps its copies here too, and trims them)
    function snapCacheKeys(prefix) { return Object.keys(snapMem()).filter(function (k) { return k.indexOf(prefix) === 0; }); }
    function snapCacheDrop(entity) { delete snapMem()[entity]; snapSaveLater(); }

    // ------------------------------------------- NEVER THE BROKEN-IMAGE "?"
    //
    // (2026-10-31, the owner's item 46, from a screenshot: the Now Playing
    // block's cover and every face under Who's Home drew the browser's
    // broken-image icon.) A picture that cannot load -- Music Assistant away,
    // an artwork host that refuses, a signed path gone stale -- must show what
    // the block shows with no picture at all: the music note for art, the
    // person's initial on their color for a face. Never the "?".
    //
    // THREE PARTS, ONE HELPER:
    //   artImg(url, opts)    the <img> markup. Its src goes through artSrc, so
    //                        a URL that failed a moment ago is NOT fetched again
    //                        on the next render (a morph() or an innerHTML
    //                        would otherwise ask, fail and flash on every
    //                        state change in the house).
    //   artGuard(root)       capture-phase `error` and `load` listeners on a
    //                        card's or a module's root (capture, because
    //                        neither event bubbles; on the ROOT, because a
    //                        render replaces the <img> itself). On error the
    //                        <img>'s src becomes the fallback: an SVG data URL,
    //                        so the node is still an image (naturalWidth > 0)
    //                        and still the right size. On load it keeps a small
    //                        copy.
    //   the kept copy        the LAST GOOD picture, a 160 px thumbnail in the
    //                        snapshot cache above ("art:" keys, at most
    //                        ART_KEEP of them, the least recently used going
    //                        first), so it survives a reload too. While a fetch
    //                        fails the last good copy of THE SAME picture is
    //                        shown; with none kept, the placeholder. A cover's
    //                        key includes its query (version, token), so the
    //                        next track's failing cover is the note, never the
    //                        last track's art; a face's key is its path.
    //
    // An element opts in with data-ph="note" (art), "av" (a face; data-initials
    // and data-color say what to draw) or "bg" (a blurred backdrop: a flat dark).
    var ART_KEEP = 24;
    var artBad = {};                   // url -> when it failed
    var artUse = {};
    var artLast = {};                  // key -> the url last kept
    var ART_NOTE =
      'M21,3V15.5A3.5,3.5 0 0,1 17.5,19A3.5,3.5 0 0,1 14,15.5A3.5,3.5 0 0,1 17.5,12C18.04,12 18.55,12.12 19,12.34V6.47L9,8.6V17.5A3.5,3.5 0 0,1 5.5,21A3.5,3.5 0 0,1 2,17.5A3.5,3.5 0 0,1 ' +
      '5.5,14C6.04,14 6.55,14.12 7,14.34V6L21,3Z';
    var ART_COLORS = ['#ff9500', '#5856d6', '#34c759', '#ff2d55', '#32ade6'];

    // THE KEY SAYS WHICH PICTURE IT IS (the lead, 2026-10-31: a failed cover must never be the PREVIOUS TRACK's). A cover's
    // key keeps its query -- the version or token (?v=, ?token=) is what tells one album's art from the next's -- so a
    // kept copy stands in only for the very same picture. A face (kind "av") is the same face whatever the query says:
    // its key is the path alone.
    function artKey(url, kind) { return 'art:' + String(url || '').replace(kind === 'av' ? /[?#].*$/ : /#.*$/, ''); }
    function artKept(url, kind) {
      var k = artKey(url, kind), hit = snapCacheGet(k);
      if (!hit || !hit.d) return '';
      artUse[k] = ++ST.artTick;
      return hit.d;
    }
    // Keep the picture that just loaded, and drop the least recently used past the cap.
    function artKeep(img, url, kind) {
      var k = artKey(url, kind);
      if (!url || /^(data|blob):/.test(url)) return;
      var put = snapCachePut(k, img, artLast[k] !== url);
      if (!put) return;
      artLast[k] = url;
      artUse[k] = ++ST.artTick;
      var keys = snapCacheKeys('art:');
      if (keys.length <= ART_KEEP) return;
      keys.sort(function (a, b) { return (artUse[a] || 0) - (artUse[b] || 0); });
      for (var i = 0; i < keys.length - ART_KEEP; i++) { snapCacheDrop(keys[i]); delete artUse[keys[i]]; delete artLast[keys[i]]; }
    }
    function artSvg(kind, ini, color) {
      var body;
      if (kind === 'av') {
        var c = color || ART_COLORS[(String(ini || '?').charCodeAt(0) || 0) % ART_COLORS.length];
        body = '<rect width="64" height="64" fill="' + String(c).replace(/[^#\w(),.% -]/g, '') + '"/><text x="32" y="33" text-anchor="middle" dominant-baseline="central" ' +
          'fill="#fff" font-family="system-ui,sans-serif" font-size="28" font-weight="600">' +
          String(ini || '').replace(/[<>&"]/g, '') + '</text>';
      } else if (kind === 'bg') {
        body = '<rect width="64" height="64" fill="#14161c"/>';
      } else {
        body = '<rect width="64" height="64" fill="#2a2d36"/><path transform="translate(16 16) scale(1.33)" fill="#fff" fill-opacity=".5" d="' + ART_NOTE + '"/>';
      }
      return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' + body + '</svg>');
    }
    // What an <img> that cannot load shows: the last good picture, else the placeholder
    function artFallback(url, kind, ini, color) { return artKept(url, kind) || artSvg(kind, ini, color); }
    function artGuard(root) {
      if (!root || root._hkArtGuard || !root.addEventListener) return;
      root._hkArtGuard = true;
      var mine = function (e) {
        var im = e.target;
        return im && String(im.tagName).toUpperCase() === 'IMG' && im.getAttribute && im.getAttribute('data-ph') ? im : null;
      };
      root.addEventListener('error', function (e) {
        var im = mine(e);
        if (!im) return;
        var cur = im.getAttribute('src') || '';
        if (/^data:/.test(cur)) return;      // the fallback itself: never a loop
        if (cur) artBad[cur] = Date.now();
        im.setAttribute('src', artFallback(cur, im.getAttribute('data-ph'), im.getAttribute('data-initials'), im.getAttribute('data-color')));
      }, true);
      root.addEventListener('load', function (e) {
        var im = mine(e);
        if (im && im.naturalWidth > 0) artKeep(im, im.getAttribute('src') || '', im.getAttribute('data-ph'));
      }, true);
    }

    var BASE_CSS = [
      // Every hk card clears the WebView tap highlight itself too, rather than
      // relying on an ancestor HA happens to style (see hk-popup.js).
      ':host{display:block;-webkit-tap-highlight-color:transparent}',
      // THE FONT IS THE THEME'S: --ha-font-family-body, read here, at the card.
      // Inherited it was not: the theme is put on the VIEW, but Home Assistant
      // resolves font-family at <body> from its own default (Roboto) and every
      // element below inherits that resolved value -- so a card showed SF Pro
      // only when the user's own profile theme was HK Kiosk (measured
      // 2026-10-13). A card in a sheet or a pop-up (mounted outside the view)
      // reads the variable that surface sets on its root (FONT_ROOT, below).
      ':host{font-family:var(--ha-font-family-body,' + v('font-body') + ')}',
      '*{box-sizing:border-box;font-family:inherit}',
      // ON A HOME GRID (a block's card has `size`, hk-home-grid-view): the card
      // and its own root are the block's height, so a plate can fill it
      ':host([size]){height:100%}:host([size])>div{height:100%}',
      // every list that scrolls: a light fade at its ends (SCROLL EDGES)
      edgeCss(),
      // BEHIND THE PHOTO SCREENSAVER every animation in a card holds still: a
      // fan's spinning glyph, a pulse, a scrolling label. Nothing can be seen or
      // touched behind WallPanel, and on a wall tablet's Android WebView ANY
      // running animation keeps the page drawing a frame per screen refresh --
      // the fan glyphs alone were 30-50% of a core on an otherwise idle tablet
      // (measured 2026-09-29). hk-sky marks the cards (hk-asleep, below); they
      // resume where they were the moment the photos go. NOT the music progress
      // bar: it is a CSS animation started at the song's position, so pausing it
      // would leave it behind the song after the wake.
      ':host([hk-asleep]) *:not(.prog-fill){animation-play-state:paused!important}',

      // ---- the 40px selectable pill ----------------------------------------
      '.pill{height:40px;border-radius:20px;padding:0 14px;margin:0;',
      '  display:grid;grid-template-columns:minmax(0,1fr);align-content:center;',
      // (Flat's --hk-pill-bg: on its ivory cards a plate-colored pill
      // vanished -- the Clean Areas rooms; the look's plate elsewhere)
      '  ' + M.glass + ';background:var(--hk-pill-bg,' + M.bg + ');border:' + M.border + ';',
      '  box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10));',
      '  cursor:pointer;user-select:none;',
      '  transition:background-color .22s ease, transform .12s ease}',
      '.pill:active{transform:scale(0.96)}',
      '.pill > span{justify-self:center;max-width:100%;box-sizing:border-box;' + PILL_LABEL + ';', // (max-width: a long name ran out of both ends of its pill, no "…", 2026-11-10)
      '  white-space:nowrap;overflow:hidden;',
      '  text-overflow:ellipsis;color:' + v('ink') + ';transition:color .22s ease}',
      '.pill[aria-pressed="true"]{background:var(--hk-seg-on,' + SELECTED_BG + ');box-shadow:var(--hk-seg-on-shadow,var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10)))}',
      '.pill[aria-pressed="true"] > span{color:' + SELECTED_TEXT + '}',

      // ---- the 70px action tile --------------------------------------------
      // --hk-pill: the pill everywhere but an iPad held upright (css/hk-responsive.css).
      '.tile{height:' + TILE.h + 'px;width:' + PILL_W + ';min-width:' + PILL_W + ';max-width:' + PILL_W + ';',
      '  border-radius:' + M.radius + ';padding:' + TILE.pad + ';margin:0;',
      '  ' + M.glass + ';border:' + M.border + ';box-shadow:' + M.shSm + ';',
      '  display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:' + TILE.wellGap + 'px;',
      '  align-items:center;align-content:center;cursor:pointer;user-select:none;',
      '  transition:transform .12s ease}',
      '.tile:active{transform:scale(0.97)}',
      // Matches .start on the timer keypad. Set while a submission is in flight
      // so the tile reads as inert rather than as tappable-and-ignored.
      '.tile[aria-disabled="true"]{opacity:0.45;pointer-events:none}',
      '.tile .well{width:42px;height:42px;border-radius:50%;background:' + M.well + ';',
      '  display:flex;align-items:center;justify-content:center;align-self:center;justify-self:center}',
      // display:flex, so the glyph sits in the middle of its circle, on
      // EVERY tile.
      //
      // hk-icon (like HA's ha-icon) renders its glyph as an INLINE-level child, so it is placed on
      // a baseline inside a line box built from the inherited line-height
      // (22.4px) against a 23px icon -- and the half-leading pushes it down.
      // The well is already a flex box and centres the hk-icon perfectly; it
      // is the next level down that drifts.
      //
      // Without it, measured on six category pills, the glyph sits
      // consistently 0.81px BELOW the circle's centre. Small, and on a wall tablet at
      // dPR 1.5-2.0 that is 1.2-1.6 device pixels of a 42px circle -- which
      // is exactly the kind of thing that reads as "slightly wrong" without
      // being nameable.
      //
      // Same family as the 5px offset that made the speaker pills' play glyph
      // sit low (see hk-media.js _pill, which solved it by dropping the icon element
      // for an inline <svg>). Making the hk-icon a flex container removes
      // baseline alignment entirely, which is the cause rather than the
      // symptom -- a -0.81px nudge would be a number nobody could justify
      // later.
      // WHITE, as the label is, unless a tile colors its own glyph (a scene's,
      // inline). Inherited, it took the page's text color -- black under a
      // light Home Assistant theme: the Browse Music categories (2026-10-10).
      '.tile .well hk-icon{--mdc-icon-size:' + TILE.glyph + 'px;width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px;color:' + v('glyph') + ';',
      '  display:flex;align-items:center;justify-content:center}',
      '.tile .txt{justify-self:stretch;text-align:left;align-self:center;',
      '  font-weight:600;font-size:15px;line-height:1.1;letter-spacing:-0.23px;',
      '  color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

      // ---- action status line (see _setStatus, below) ----------------------
      //
      // ONE ROW, IN THE FLOW, RESERVED WHETHER OR NOT IT SAYS ANYTHING. It is
      // not a toast and not an overlay: a toast on a wall tablet is read by
      // nobody, because the person who pressed the key has already looked up at
      // the room. Holding the row means the card does not resize when a message
      // arrives, which is what would actually pull the eye back to it.
      //
      // The four kinds are deliberately not four colours of "error". `sent` and
      // `warn` are the pair that matters: see the comment on _setStatus.
      '.hk-status{min-height:20px;margin:0 4px 10px 4px;font-size:13.5px;',
      '  font-weight:600;letter-spacing:-0.1px;line-height:20px;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      '  color:transparent;transition:color .18s ease}',
      '.hk-status[data-kind="pending"]{color:' + v('ink-3') + '}',
      '.hk-status[data-kind="sent"]{color:' + v('ink-2') + '}',
      '.hk-status[data-kind="warn"]{color:' + v('warn') + '}',
      '.hk-status[data-kind="failed"]{color:' + v('fail') + '}',
      '@media (prefers-reduced-motion: reduce){.hk-status{transition:none}}',

      // ---- section heading (transcribed from hk_section_heading) -----------
      '.head{font-size:22px;font-weight:700;letter-spacing:-0.4px;',
      '  color:' + v('ink') + ';padding:0 4px 10px 4px}',

      '@media (prefers-reduced-motion: reduce){',
      '  .pill,.pill:active,.pill > span,.tile,.tile:active{transition:none;transform:none}}',
      // ================================================ PHONE: FILL THE TRACK
      // Below 640px the room grids switch to `repeat(auto-fill, minmax(168px,
      // 1fr))` (see frontend/css/hk-responsive.css), so the track is no longer
      // the pill's width (196, the table's) and a pill pinned to it would overflow.
      // Here the pill fills whatever track it is given instead.
      //
      // WHY `calc(100% + 8px)` AND NOT `100%`: layout-card gives every grid child
      // 4px side margins, so the cell is always 8px narrower than the track
      // (layout-card's card_margin cannot change it). At 1280 the pill is 196px in a 188px
      // cell -- it already overflows by exactly 8px, and that is what makes the
      // visible gap come out at the grid's own (TILE.gridGap, 10). Plain `100%`
      // would shrink every pill to the cell and change the gap.
      //
      // `--hk-cell-bleed` exists because that 8px is NOT universal: inside
      // hk-row-card the child is sized directly with no layout-card margin, so
      // that card sets the bleed to 0 for its own children. Default 8px = the
      // grid case.
      //
      // No max-width: capping at the pill's width makes the track wider than the
      // pill on a large phone and the gap jumps (12px -> 25px, measured at 192).
      // Verified 375/402/440/1280.
      '@media (max-width:' + BP.phone + 'px){',
      // NO `:host{width:100%}` HERE. These hosts are already `display:block`, so
      // an auto width fills the grid area MINUS the 4px side margins layout-card
      // gives every child -- which is exactly the cell (8 px under the track)
      // the pill is built to overflow by 8. Forcing width:100% resolves against
      // the full grid AREA instead and every tile comes out 8px too wide (190.95
      // measured against a 182.95 track), eating the gap (then 12px) to 4px.
      '  :host{max-width:none !important}',
      '  .tile{width:calc(100% + var(--hk-cell-bleed, 8px));min-width:0;max-width:none}',
      '}',
    ].join('');

    // ------------------------------------------------------------------ base
    // The three methods Lovelace actually requires. Nothing here reaches into
    // HA internals -- that is the whole reason a card like this ages well while
    // hk-icons.js (which pokes ha-icon._legacy) needs watching.
    // ONE STYLESHEET PER CLASS, NOT PER INSTANCE.
    //
    // A <style> element per card is fine for a handful of cards and wrong at
    // the scale the card library reaches: one home view can hold 300 cards,
    // and that is 300 copies of the same CSS to parse and hold.
    //
    // hasOwnProperty, not a plain lookup: static properties are INHERITED, so a
    // subclass would otherwise find HkBase's sheet and every card in the file
    // would share the base's CSS with none of its own.
    function sheetFor(ctor) {
      if (!Object.prototype.hasOwnProperty.call(ctor, '_hkSheet')) {
        var sheet = null;
        try {
          sheet = new CSSStyleSheet();
          sheet.replaceSync(BASE_CSS + (ctor.CSS || '') + flatCss(null, !!ctor.FLAT_MOTION));
        } catch (e) {
          sheet = null;              // older engine -> <style> fallback below
        }
        ctor._hkSheet = sheet;
      }
      return ctor._hkSheet;
    }

    // ------------------------------------------------------------ MODULE WAKE
    // The card files and the modules they call (hk-tile's palette, hkChart,
    // hkStats, hkTimers, hkHeader) load in parallel, in no fixed order. A card
    // that draws before a module has run draws a fallback -- raw CSS colours, an
    // empty chart, no countdowns -- and the re-render gate then keeps that frame,
    // because no ENTITY changed -- a chip that stays wrong until a reload.
    //
    // Each module announces itself with `hk-module-ready` once its global is set.
    // That bumps GEN, which every card's gate compares, and redraws every live
    // card now. So "which modules are loaded" is an input to every card like any
    // entity, and a card is redrawn when that input changes -- not on a timer and
    // not on the hope that some unrelated state changes soon. A card on a cached,
    // detached view catches up on its next state push, because its _hkGen is behind.
    var GEN = { n: 0 };
    function track(el) {
      if (el._hkTracked || typeof WeakRef !== 'function') return;
      el._hkTracked = true;
      ST.LIVE.push(new WeakRef(el));
    }

    // THE SHARED BLUR'S MEMBERS (look.glass = blur; modules/hk-glass.js). A card
    // joins while it is on the page, unless its config says `glass: false`.
    // The set is global because hk-glass.js may load before or after this file.
    var GLASS = window.__hkGlassCards = window.__hkGlassCards || new Set();

    // THE CARDS ON THE PAGE, for the screensaver pause (BASE_CSS, hk-asleep).
    // hk-sky knows when the tablet's screensaver is up; it sets
    // window.__hkAsleep and fires `hk-asleep` on window whenever that changes,
    // whichever of the two files loaded first. A card joining while asleep is
    // marked at once.
    var ON_PAGE = window.__hkCardsOnPage = window.__hkCardsOnPage || new Set();
    function markAsleep(card) {
      // Touch the attribute only when it changes: nearly every card joins awake.
      var on = !!window.__hkAsleep;
      if (on !== !!card._hkAsleep) {
        card._hkAsleep = on;
        if (on) card.setAttribute('hk-asleep', ''); else card.removeAttribute('hk-asleep');
      }
      if (ST.still !== !!card._hkStill) {
        card._hkStill = ST.still;
        if (ST.still) card.setAttribute('hk-still', ''); else card.removeAttribute('hk-still');
      }
    }
    function glassJoin(card, on) {
      // ON A LIGHT PAGE (tone() below) the shared blur has no sky to frost: it
      // laid its tinted layer behind each plate and turned the light glass a
      // muddy gray. Out of it, as a card that says `glass: false` is.
      var off = !!(window.hkSettings && window.hkSettings.rendering && window.hkSettings.rendering().flat) || !!(card._config && card._config.glass === false) || !!card._hkLight;
      // Out of "Blur each card" too, and everything inside it (the variable
      // inherits into child cards' shadow roots).
      if (card.style) {
        if (off) card.style.setProperty('--hk-glass-backdrop', 'none');
        // (not a pill Edit mode is carrying: that blur is its own while it is
        // held, and moving it among its group re-joins it -- hkGlass.carry)
        else if (card.style.getPropertyValue('--hk-glass-backdrop') && !(window.hkGlass && window.hkGlass.carrying && window.hkGlass.carrying(card))) {
          card.style.removeProperty('--hk-glass-backdrop');
        }
      }
      var join = on && !off;
      if (join === GLASS.has(card)) return;
      if (join) GLASS.add(card); else GLASS.delete(card);
      // The card goes along: on a fresh page load hk-glass holds the first view
      // unpainted until its frost is placed, and this join is how it learns of
      // the view before the view's first paint.
      if (window.hkGlass) window.hkGlass.changed(card, join);
    }

    // ...and when one has drawn again: the shared blur looks again at a card
    // whose plates were replaced or added (hk-glass decides, cheaply). Without
    // this only its 2 s backstop found them.
    function glassRendered(card) {
      if (GLASS.has(card) && window.hkGlass && window.hkGlass.rendered) window.hkGlass.rendered(card);
    }

    // THE CLIENT HUB: the newest client any card was handed,
    // for things that are not cards and so are never handed one -- the detail
    // sheets (hk-detail.js) live outside the dashboard and still need every
    // state change. The frontend passes every card the SAME object per update,
    // so this is one identity compare per card per update, and the listeners
    // run once per new object, not once per card.
    var CLIENT_HUB = { last: null, fns: new Set() };
    var PREVIEW_CLIENTS = new WeakSet();
    function clientSeen(client) {
      if (!client || PREVIEW_CLIENTS.has(client) || client === CLIENT_HUB.last) return;
      CLIENT_HUB.last = client;
      artWatch(client);              // the reconnect hook (above), from the first client
      CLIENT_HUB.fns.forEach(function (fn) {
        try { fn(client); } catch (e) { console.error('[hk-cards] client listener', e); }
      });
      try { window.dispatchEvent(new CustomEvent('hk-client-update')); } catch (e) { /* shell tests */ }
    }

    class HkBase extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        var sheet = sheetFor(this.constructor);
        if (sheet && this.shadowRoot.adoptedStyleSheets) {
          this.shadowRoot.adoptedStyleSheets = [sheet];
        } else {
          // Kept so a browser without constructable stylesheets still renders.
          this._style = document.createElement('style');
          this._style.textContent = BASE_CSS + (this.constructor.CSS || '') + flatCss(null, !!this.constructor.FLAT_MOTION);
          this.shadowRoot.append(this._style);
        }
        this._root = document.createElement('div');
        this.shadowRoot.append(this._root);
        artGuard(this._root);           // never the broken-image "?" (see NEVER THE BROKEN-IMAGE)
        var self = this;
        // (only a card that says where it leads listens)
        if (this._tapTarget !== HkBase.prototype._tapTarget) this._root.addEventListener('click', function (e) { self._blockClick(e); });
        this._clientExplicit = false;
        this._hkClient = null;
        this._hkSig = null;
      }

      setConfig(config) {
        this._config = Object.assign({}, config);
        this._hkSig = null;                        // config change always redraws
        // ...and REBUILDS. Most cards build their DOM once, behind `_built`, from
        // the config they had then (a heading's link, a key's style, an info
        // block's type). The card editor's preview calls setConfig on the SAME
        // element for every edit, so without this the preview would keep the
        // first config's structure and the editor would look broken until a reload.
        // tests/render-audit's reconfig check holds every card to it.
        this._built = false;
        this._onConfig && this._onConfig();
        this._render();
        if (this.isConnected) glassJoin(this, true);   // `glass: false` may have changed
      }

      // RE-RENDER GATING, IN THE BASE CLASS, BY DEFAULT.
      //
      // Rendering on every new object the host hands a card would render on
      // EVERY state change in the house. MEASURED on a wall tablet: the
      // frontend hands a card a new object ~12x a second, and about 1% of
      // those change what a given card shows. Rendering on all of them is ~90x
      // the work, so a card without gating makes the tablets
      // SLOWER. That is why this lives here and not in each card: it has to be
      // the default, not something every new card remembers.
      //
      // _hkSig, not _sig: HkTimersCard already keeps its own _sig inside
      // _render(), and the two must not collide.
      //
      // LOVELACE'S ENTRY is the host adapter's (hkHostClient.entry(HkBase),
      // below the class): it keeps the object, reports it to the hub, and calls
      // _onClient with its client. A card is otherwise handed a client directly.
      _onClient() {
        this._clientExplicit = false;
        this._receiveClient();
      }

      get client() {
        return this._clientExplicit ? this._hkClient : (this._hkEntryClient || null);
      }
      set client(value) {
        this._clientExplicit = true;
        this._hkClient = value;
        clientSeen(value);
        this._receiveClient();
      }
      // A TAP ON A BLOCK'S PLATE (see openTarget): a click that reaches the card's root from no control. A card says
      // where it leads in _tapTarget(); one that does not, or one that is no block, is left alone.
      _tapTarget() { return null; }
      _blockClick(e) { blockClick(this, e, this._root); }
      // A CLIENT BEFORE A CONFIG, without drawing: for a parent that must hand a
      // card its client before setConfig (setConfig draws at once). The next
      // client, or the host's object at the entry, replaces it as usual.
      adopt(client) {
        this._clientExplicit = true;
        this._hkClient = client;
      }
      _receiveClient() {
        tone(this, this.client);
        track(this);
        window.hkCardState.receive(this, GEN.n, glassRendered);
      }

      // Default signature: the last_updated of every entity the config names.
      // last_updated moves when the state OR any attribute changes, which is
      // exactly "this entity's data is different", and nothing else.
      //
      // Returning NULL means "always render" and is the safe answer when the
      // dependencies cannot be inferred -- the correct behaviour for
      // any card that does not declare its entities. Override in a card that
      // reads entities the config does not list.
      _sigOf() { return window.hkCardState.signature(this.client, this._config); }

      // THE hk-stats.js / hk-charts.js WAKE BRIDGE.
      //
      // Those modules resolve their history fetches asynchronously and then call
      // `card.requestUpdate()` to redraw whatever was waiting on the data. That
      // is a LitElement API; these cards are not Lit, so without this a card
      // that asks for statistics renders once with no data and NEVER updates --
      // the data arrives in ~100ms and then sits in the cache unread.
      //
      // It draws NOW rather than waiting for the gate, which would decide
      // nothing had changed (the ENTITY did not change -- the fetch completed)
      // and drop the render. Arguments are ignored; the bridge passes a property
      // name only because a Lit card's requestUpdate takes one.
      requestUpdate() { this.redraw(); }

      // REDRAW NOW, for a change the states do not show: data that arrived (a
      // channel list, artwork, a module), a choice made on the card. It draws,
      // and remembers the signature it drew at. Clearing _hkSig and calling
      // _render() instead drew the card AGAIN on the next push that changed
      // nothing -- a whole second build of the Live TV guide after every
      // channel fetch (the render audit's churn check, 2026-09-29).
      redraw() { window.hkCardState.redraw(this, GEN.n, glassRendered); }

      // ---------------------------------------------------------- actions
      //
      // THE CARD'S TAP AND THE ICON'S TAP ARE DIFFERENT ACTIONS, and they live
      // in the base class so no card loses the distinction: on the wall the
      // glyph toggles and the name opens detail. Collapsing that into one makes
      // every light more-info only -- no style changes, and the lights stop
      // turning on when tapped. A computed-style check cannot see behaviour; it
      // has to be carried on purpose.
      //
      // NO CARD HAS A HOLD: a long press falls through to the click and does
      // what a tap does.
      //
      // `defaultMoreInfo` is what an ABSENT action means: a card's own tap
      // opens detail, an inner element's tap does nothing unless configured.
      _bind(el, tapKey) {
        var self = this;
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          self._act((self._config || {})[tapKey], tapKey === 'tap_action');
        });
      }

      // A RIGHT-CLICK OPENS DETAIL (tiles only, on a computer). On a light the
      // glyph's click toggles, so this is the mouse's way to the sheet without
      // aiming at the name. MOUSE ONLY: Android fires contextmenu on a long
      // press too, and a finger resting on a tile must still do what a tap does
      // (no card has a hold). A tile with no entity behind it keeps the
      // browser's own menu.
      _bindDetail(el) {
        var self = this;
        el.addEventListener('contextmenu', function (e) {
          var cfg = self._config || {};
          if (!cfg.entity || !fromMouse(e)) return;
          e.preventDefault();
          e.stopPropagation();
          self._act({ action: 'more-info' }, true);
        });
      }

      _act(spec, defaultMoreInfo) {
        var cfg = this._config || {};
        if (!spec && !defaultMoreInfo) return;
        spec = spec || { action: 'more-info' };
        var action = spec.action;
        if (action === 'none') return;
        // A door, the alarm, the water or the heat is NEVER one tap: whatever a
        // card's config says, `toggle` on one of these opens its detail instead
        // (homeassistant.toggle on a lock UNLOCKS it).
        if (action === 'toggle' && neverToggles(this.client, cfg.entity)) {
          spec = { action: 'more-info' };
          action = 'more-info';
        }
        // Ask first, then run the SAME path -- `_confirmed` is the only thing
        // that differs on the second pass, so there is no duplicate action code
        // to drift out of step with the guarded one.
        if (spec.confirmation && !spec._hkConfirmed) {
          var self = this;
          var again = Object.assign({}, spec, { _hkConfirmed: true });
          confirmSheet(spec.confirmation.text, function () {
            self._act(again, defaultMoreInfo);
          });
          return;
        }
        if (action === 'toggle') {
          this._call('homeassistant', 'toggle', { entity_id: cfg.entity });
          return;
        }
        // a washer's or dryer's sheet (hk-laundry.js); the Intercom Button: `#intercom` loads the sheet's code and opens it (hk-loader.js), or again
        if (action === 'laundry' && window.hkLaundry && window.hkLaundry.open(spec.machine, this.client)) return;
          if (action === 'intercom') { var I = window.hkIntercom; if (location.hash === '#intercom' && I && I.open) I.open({ hashed: true }); else location.hash = '#intercom'; return; }
        if (action === 'navigate' && spec.navigation_path) {
          navigate(navPath(spec), this);
          return;
        }
        // `url` is rare, and falling through to more-info would be the wrong
        // page rather than a visible error.
        // A NEW TAB, not this one. An Apple Music tile opens a player
        // page and the dashboard has to still be there behind it -- navigating
        // in place strands a wall tablet on a page with no way back.
        if (action === 'url' && spec.url_path) {
          window.open(spec.url_path, spec.target || '_blank');
          return;
        }
        if (action === 'call-service' || action === 'perform-action') {
          var svc = spec.service || spec.perform_action || '';
          // A `[[[ ]]]` service name is a button-card template these cards do not
          // evaluate. Falling through the split() below would do NOTHING at
          // all -- a tile dead on tap. Fail loudly instead.
          if (svc.indexOf('[[[') !== -1) {
            console.error('hk-card: service is a button-card JS template, which ' +
                          'this card cannot evaluate:', svc, this._config);
            return;
          }
          var parts = svc.split('.');
          if (parts.length === 2) {
            var data = Object.assign({}, spec.data || {}, spec.target || {});
            this._call(parts[0], parts[1], data);
          }
          return;
        }
        window.hkShell.moreInfo(cfg.entity, this);
      }

      getCardSize() { return 3; }

      // EVERY SERVICE CALL GOES THROUGH HERE. A bare `callService(...)`
      // written as a statement drops the promise it returns on the floor: a
      // call that REJECTS -- a dropped socket on a tablet's wifi, a script
      // renamed out from under a tile, bad variables, an exception inside the
      // script -- does nothing at all. No log, no UI change. The tap looks like
      // it worked and did not.
      //
      // Silent failure is the pattern worth killing, not any one instance of it.
      //
      // Returns the promise, so a caller that needs to know -- the timer keypad
      // and the area picker both do, so as not to throw away the user's
      // input before finding out -- can attach to it. A caller that does not
      // need to know can ignore it and still gets the logging.
      //
      // NOTE WHAT THIS DOES NOT PROMISE. Resolving means Home Assistant ACCEPTED
      // the call, not that the device did anything. For `script.turn_on` it does
      // not even mean the script finished -- that returns as soon as the script
      // starts. Proving a device acted needs the entity state afterwards and is
      // deliberately not attempted here.
      //
      // THROUGH THE CLIENT'S ACTION PORT. In Home Assistant that is the frontend's
      // own callService with exactly these arguments; in Mantel the port refuses
      // (`commands_disabled`) and sends nothing, which lands in the `false` below.
      _call(domain, service, data) {
        var act = this._actions();
        if (!act) return Promise.resolve();
        var p;
        try {
          p = act.callService(domain, service, data);
        } catch (e) {
          p = Promise.reject(e);
        }
        // RESOLVES WITH A BOOLEAN AND NEVER REJECTS. Rethrowing is the natural
        // shape -- and it would make every fire-and-forget call site a
        // potential unhandled rejection that each has to remember to .catch().
        // Getting that wrong would swap one silent failure for a noisier one.
        // `true` means accepted, `false` means
        // it did not go; a caller that ignores the result still gets the log.
        return Promise.resolve(p).then(function () { return true; }, function (err) {
          console.error('hk-card: ' + domain + '.' + service + ' failed', data, err);
          return false;
        });
      }

      // The action port of the client this card is shown, or null with none.
      _actions() {
        var c = this.client;
        return (c && c.actions) || null;
      }

      // _call, BUT KEEPING THE ERROR: {ok, error}. For a service that returns no
      // response yet can refuse -- an alarm panel rejecting a code -- where the
      // caller needs to know WHY it did not go.
      _callErr(domain, service, data) {
        var act = this._actions();
        if (!act) {
          return Promise.resolve({ ok: false, error: 'not connected' });
        }
        var p;
        try {
          // notifyOnError false: the caller shows the refusal itself (the
          // keypad's "Wrong code"); HA's toast on top of it would say it twice.
          p = act.callService(domain, service, data, undefined, false);
        } catch (e) {
          p = Promise.reject(e);
        }
        return Promise.resolve(p).then(function () { return { ok: true }; }, function (err) {
          console.error('hk-card: ' + domain + '.' + service + ' failed', data, err);
          return { ok: false, error: (err && (err.message || err.code)) || String(err) };
        });
      }

      // _call, BUT WAITING FOR THE ANSWER. A script called directly
      // -- `script.x`, not `script.turn_on` -- runs to the end before the call
      // returns, and one that ends in `stop: ... response_variable:` hands that
      // variable back. That is how a music request reports its outcome to the
      // screen that made it: non-admin users (every wall tablet) may not
      // subscribe to custom events, but they may read a service response.
      //
      // THIS ONLY WORKS ON A BLOCKING CALL. `script.turn_on` returns the moment
      // the script starts and can carry no response; the script must be called
      // as its own action (script.quick_timer_create, not script.turn_on with an
      // entity_id) so HA waits for it and collects what it returned.
      //
      // Same contract as _call: never rejects. {ok, response, error}, where
      // `response` is {} when the call went but answered nothing (an older HA,
      // or a script with no response) -- "accepted, outcome unknown".
      _callResp(domain, service, data) {
        var act = this._actions();
        if (!act) {
          return Promise.resolve({ ok: false, error: 'not connected' });
        }
        var p;
        try {
          // The 6th argument is returnResponse. The 4th (target) is undefined:
          // `data` already carries it. The 5th (notifyOnError) is FALSE -- HA's
          // own error toast is the wrong surface here, the card shows the
          // failure itself.
          p = act.callService(domain, service, data, undefined, false, true);
        } catch (e) {
          p = Promise.reject(e);
        }
        return Promise.resolve(p).then(function (res) {
          return { ok: true, response: (res && res.response) || {} };
        }, function (err) {
          console.error('hk-card: ' + domain + '.' + service + ' failed', data, err);
          return { ok: false, error: (err && (err.message || err.code)) || String(err) };
        });
      }

      // ------------------------------------------------- ARTWORK THAT MAY NEVER ANSWER
      //
      // `img.onerror` DOES NOT FIRE WHEN A HOST SIMPLY DOES NOT REPLY, and a
      // wall tablet with no internet meets exactly that on album art.
      //
      // Music Assistant hands out artwork as the PROVIDER's own url -- measured
      // across one large library, over 90% of them are
      // is1-ssl.mzstatic.com (Apple's CDN), a few r2.theaudiodb.com, and the
      // rest Music Assistant's own :8095 proxy. From a tablet with no route
      // to the public internet, Apple and
      // TheAudioDB both HANG -- no response, no refusal, no error event -- while
      // Home Assistant and MA's own :8095 answer fine.
      //
      // A dropped packet is not a failed load. The <img> sits there pending
      // forever, `error` never fires, and the placeholder the card carefully
      // installed in its error handler is never reached. Every tile stays an
      // empty grey square, permanently, with nothing anywhere saying why -- and
      // it looks perfect in Chrome on a machine that HAS internet.
      //
      // So a timeout, which is the only thing that can tell those two apart from
      // in here. The rule: no transient state may last
      // forever. This one resolves within ART_TIMEOUT either way.
      //
      // CANCELLED BY CLEARING src. Without that the request stays outstanding on
      // a page that may draw two hundred of these, and a scroll through the
      // library would leave the connection pool full of sockets waiting on a
      // host that is never going to speak.
      // `size` is the pixels the tile draws at; HA scales to it (art.py).
      _artImage(url, box, iconHtml, size) {
        var img = document.createElement('img');
        var done = false;
        var fail = function () {
          if (done) return;
          done = true;
          clearTimeout(t);
          // Stop the pending request before replacing the node it belongs to.
          try { img.src = ''; } catch (e) { /* not worth failing a paint over */ }
          box.innerHTML = iconHtml;
          // THE LAST GOOD PICTURE beats the placeholder (item 46: kept for the
          // big covers only -- 200 library tiles would fill the cache)
          var kept = sz >= 500 ? artKept(url) : '';
          if (kept) { var k = document.createElement('img'); k.alt = ''; k.src = kept; box.appendChild(k); }
        };
        var t = setTimeout(function () {
          // `complete && naturalWidth` is the one honest test for "it arrived":
          // `complete` alone is also true for an image that failed.
          if (img.complete && img.naturalWidth > 0) { done = true; return; }
          fail();
        }, ART_TIMEOUT);
        img.addEventListener('load', function () { done = true; clearTimeout(t); if (sz >= 500) artKeep(img, url); });
        // A SIGNED PATH THAT ERRORS GETS ONE FRESH SIGNATURE (see artWatch):
        // after a restart the kept path is a 401, and a new one is the cure.
        // Once only -- `resigned` -- so an image that is simply missing costs
        // one extra request, never a loop; the second error is the placeholder.
        var self = this, sz = size || 300, signed = false, resigned = false;
        var put = function (p) { if (!done) { signed = p !== url; img.src = p; } };
        img.addEventListener('error', function () {
          if (signed && !resigned && !done) {
            resigned = true;
            artForget(url, sz);
            artSign(self.client, url, sz, put);
            return;
          }
          fail();
        });
        img.alt = '';
        if (artRemote(url)) artSign(this.client, url, sz, put);
        else img.src = artLocal(url, sz);
        box.appendChild(img);
        return img;
      }

      // ------------------------------------------------- ACTION FEEDBACK
      //
      // For the FORM-STYLE cards only -- the ones where you enter something and
      // then press a button: the timer keypad, the vacuum area picker. A tile
      // that toggles a lamp needs none of this; the lamp is the feedback, and
      // adding a status line to 300 tiles would be noise, not information.
      //
      // FOUR STATES, AND THE MIDDLE PAIR IS THE WHOLE POINT:
      //
      //   pending   the call is out, the button is inert
      //   sent      Home Assistant ACCEPTED it
      //   warn      accepted, and then the OUTCOME came back negative
      //   failed    dispatch rejected; the input is untouched, press again
      //
      // `sent` is not `done`. _call resolves `true` when HA took the call, and
      // for `script.turn_on` that means the script STARTED -- see the note on
      // _call. A quick timer fired into a full rack of slots returns `true` and
      // starts nothing. That gap is exactly what `warn` is for, and a card that
      // can observe its own outcome should report it rather than leaving `sent`
      // on screen as if it had worked.
      //
      // A card opts in by rendering _statusNode() somewhere in its tree. Cards
      // that never call _setStatus are completely unaffected.

      // The row itself. Build it once during _render and leave it in place --
      // it holds its height empty, so nothing moves when a message lands.
      _statusNode() {
        var d = document.createElement('div');
        d.className = 'hk-status';
        // A screen reader should ANNOUNCE this without the focus moving: the
        // keypad keeps focus on the button that was just pressed.
        d.setAttribute('role', 'status');
        d.setAttribute('aria-live', 'polite');
        this._paintStatus(d);
        return d;
      }

      // `ttl` clears the message after a while. Pass it for the states that are
      // merely informative (`sent`); do NOT pass one for `failed` or `warn`,
      // which describe something the person still has to act on and must not
      // disappear while they are reading it.
      _setStatus(kind, text, ttl) {
        if (this._hkStatusT) { clearTimeout(this._hkStatusT); this._hkStatusT = null; }
        this._hkStatus = kind ? { kind: kind, text: text || '' } : null;
        this._paintStatus();
        if (kind && ttl) {
          var self = this;
          this._hkStatusT = setTimeout(function () {
            self._hkStatusT = null;
            self._hkStatus = null;
            self._paintStatus();
          }, ttl);
        }
      }

      // Writes the row WITHOUT re-rendering the card. The timer keypad's <input>
      // and its caret do not survive a rebuild, and a status message must never
      // be the thing that eats what somebody is typing.
      _paintStatus(node) {
        var el = node || (this._root && this._root.querySelector('.hk-status'));
        if (!el) return;
        var s = this._hkStatus;
        el.textContent = s ? s.text : '';
        if (s) el.setAttribute('data-kind', s.kind);
        else el.removeAttribute('data-kind');
      }

      // THE DUPLICATE-SUBMISSION GUARD, in one place rather than re-typed per
      // card. Returns false when a submission is already in flight, so the
      // caller can simply `if (!this._begin()) return;`.
      _begin(text) {
        if (this._busy) return false;
        this._busy = true;
        this._setStatus('pending', text || 'Sending…');
        // REPAINT, so the button can show it is inert. _setStatus alone only
        // writes the status row, and a Start button that still says "Start" is
        // the thing that gets pressed twice. _render is the right call for both
        // shapes of card: one that builds once repaints through it, one that
        // rebuilds does so.
        this._render();
        return true;
      }

      // Always pair with _begin. Clears the guard BEFORE the caller repaints, so
      // a card that renders from inside the callback draws an idle button.
      _end() { this._busy = false; }

      // ------------------------------------------------------- TEARDOWN
      //
      // A CARD SAYS WHEN IT IS DONE. hk-stats holds subscriber sets so it can
      // wake whoever asked for a fetch, and without this it learns about a
      // dead card only reactively: notify() prunes what it happens to walk, and a
      // high-water sweep bounds a set when it gets implausibly large. Both are
      // bounded and neither is wrong, but nothing happens until the NEXT
      // response -- up to fifteen minutes for a daily chart, or never, for a
      // card nobody asks about again.
      //
      // release() is O(the sets this card joined), not a scan of anything. It is
      // safe on a card that never subscribed, and a card that is re-attached
      // subscribes again on its next render.
      //
      // A CARD THAT OVERRIDES THIS MUST CHAIN. Several do, for their own timers and
      // observers; tests/test_dispatch.js asserts every one of them calls
      // super.disconnectedCallback(). The hk-stats backstop still catches a card
      // that is replaced wholesale without ever disconnecting.
      disconnectedCallback() {
        glassJoin(this, false);
        if (this._blockRO) { this._blockRO.disconnect(); this._blockRO = null; }
        ON_PAGE.delete(this);
        if (this._hkStatusT) { clearTimeout(this._hkStatusT); this._hkStatusT = null; }
        if (window.hkStats && window.hkStats.release && window.hkStats.release(this)) {
          this._hkStatsLost = true;
        }
      }

      // THE OTHER HALF OF RELEASE. A card released while still waiting on a
      // fetch has lost its only wake-up, and re-attaching changes nothing the
      // render gate can see -- same entity, same signature -- so it would sit on
      // "Loading" until its sensor moved. Redraw once on the way back in: the
      // render asks hk-stats again, which either draws from the cache or
      // subscribes afresh. Only cards that were actually waiting pay for this.
      //
      // A CARD THAT OVERRIDES THIS MUST CHAIN, like disconnectedCallback.
      // IN A SECTION. Home Assistant's Sections view sets `layout = "grid"` on
      // every card it holds (Masonry and HK's own grid view set nothing), so a
      // tile can fill its cell there and keep its measured width everywhere
      // else (hk-tile.js, hk-stat.js: :host([data-hk-cell])).
      get layout() { return this._hkLayout; }
      set layout(v) {
        this._hkLayout = v;
        flag(this, 'data-hk-cell', v === 'grid');
      }

      connectedCallback() {
        place(this);
        tone(this, this.client);
        glassJoin(this, true);
        ON_PAGE.add(this);
        markAsleep(this);
        // Tint from Background (Frosted): tinted before it is first drawn
        if (window.hkFrostTint) window.hkFrostTint.joined(this);
        if (!this._hkStatsLost) return;
        this._hkStatsLost = false;
        if (this.client && this._config) this.requestUpdate();
      }

      // A HOME GRID BLOCK'S SIZE (docs/phase11/HOME-GRID.md): hk-home-grid-view
      // sets `size` (S, W, T, L, XL) on a block's card. A card laid out per
      // size reads it with _cellSize() or :host([size=..]); one that builds its
      // DOM once is rebuilt when it changes. Anywhere else it is null. So is its
      // Tile Style (`tile`, 2026-10-31): a Centred glyph is sized by what it draws.
      static get observedAttributes() { return ['size', 'tile']; }
      attributeChangedCallback(name, was, now) {
        if ((name !== 'size' && name !== 'tile') || was === now || !this._config) return;
        this._built = false;
        this._hkSig = null;
        this._render();
      }
      _cellSize() {
        var s = null;
        try { s = this.getAttribute('size'); } catch (e) { s = null; }    // (a test's bare element)
        return s && HOME_GRID.sizes[s] ? s : null;
      }
      // ...and the block in px: its cells (--hk-cell-w / -h, measured by the
      // view) and the gaps between them; null before the view has measured
      _block() {
        var sz = this._cellSize(), n = sz && HOME_GRID.sizes[sz];
        if (!n || typeof getComputedStyle !== 'function') return null;
        // (the grid's gap, --g-gap: square cells' is HomeView's 13)
        var cs = getComputedStyle(this), g = parseFloat(cs.getPropertyValue('--g-gap')) || HOME_GRID.gap;
        var cw = parseFloat(cs.getPropertyValue('--hk-cell-w')), ch = parseFloat(cs.getPropertyValue('--hk-cell-h'));
        if (!(cw > 0 && ch > 0)) return null;
        // (Full: the grid's own columns and rows, from its cell)
        if (!n[0] || !n[1]) n = [parseFloat(cs.getPropertyValue('--hk-span-c')) || 0, parseFloat(cs.getPropertyValue('--hk-span-r')) || 0];
        if (!(n[0] > 0 && n[1] > 0)) return null;
        return { w: Math.floor(n[0] * cw + (n[0] - 1) * g), h: Math.floor(n[1] * ch + (n[1] - 1) * g) };
      }
      // A CARD THAT LAYS OUT BY THE BLOCK'S PX (a camera's picture, how many
      // rows fit) calls this from _render: it is drawn again whenever the
      // block's size changes -- the view measures after the cards are in, and
      // again for a new window or the tab bar
      _watchBlock() {
        var b = this._block();
        this._blockKey = b ? b.w + 'x' + b.h : '';
        if (this._blockRO || typeof ResizeObserver === 'undefined' || !this._cellSize()) return;
        var self = this;
        this._blockRO = new ResizeObserver(function () {
          var n = self._block();
          if ((n ? n.w + 'x' + n.h : '') !== self._blockKey) self.redraw();
        });
        this._blockRO.observe(this);
      }

      _st(id) { return window.hkCardState.state(this.client, id); }
      _render() { /* subclasses */ }
    }

    // ------------------------------------------- ON SOMEONE ELSE'S DASHBOARD
    // A card on a dashboard of the user's own (HA's Sections, Masonry or Panel
    // view, or the card editor's preview) and not on an HK screen: nothing of
    // HK's own -- no grid view, no sky -- is around it. The cards that lay out
    // differently there read the host's `data-hk-foreign` (the header stacks
    // when narrow, the chip and scene rows drop the bleed made for HK's page
    // padding). Walked up from the card through every shadow root once per
    // connect:
    //   hk-grid-view first          -> an HK screen (or a YAML dashboard of HK's view);
    //   or hk-home-grid-view           a Home Grid screen's Home
    //   HA's view or card editor    -> someone else's dashboard
    //   neither (the page body)     -> an HK overlay: the screensaver, a sheet,
    //                                  a pop-up, a banner -- HK's own surface
    var HK_PAGE = { 'hk-grid-view': 1, 'hk-home-grid-view': 1 };
    var HA_PAGE = {};                     // the host's own views and card editor (hk-host-shell.js)
    // (Also notes on the card whether it sits INSIDE another HK card --
    // `_hkNested` -- which tone() reads: only the outermost sets the light look.)
    function foreign(el) {
      var n = el, nested = false;
      for (var i = 0; i < 80 && n; i++) {
        n = n.parentNode || null;
        if (n && n.host && !n.localName) n = n.host;         // out of a shadow root
        var t = n && n.localName;
        if (!t) continue;
        if (HK_PAGE[t]) { el._hkNested = nested; return false; }
        if (HA_PAGE[t]) { el._hkNested = nested; return true; }
        if (t.indexOf('hk-') === 0) nested = true;
      }
      el._hkNested = nested;
      return false;
    }
    // A hint for the layout: it never stops a card from drawing.
    function flag(el, name, on) {
      try { if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on); } catch (e) { /* not an element yet */ }
    }
    function place(el) {
      if (!el || !el.toggleAttribute) return false;
      var f = foreign(el);
      flag(el, 'data-hk-foreign', f);
      // NO BLEED. On a phone a tile or key is 8 px wider than its cell
      // (calc(100% + var(--hk-cell-bleed, 8px))) to cover the 4 px side
      // margins HK's own grid gives every card. A card placed straight in HA's
      // view has no such margins, so it overhung its column by 8 px.
      try {
        var top = f && el.parentNode && window.hkShell.is(el.parentNode, 'card');
        if (top) el.style.setProperty('--hk-cell-bleed', '0px');
        else if (el.style.getPropertyValue && el.style.getPropertyValue('--hk-cell-bleed')) el.style.removeProperty('--hk-cell-bleed');
      } catch (e) { /* a hint, never a failure */ }
      return f;
    }

    // ON A LIGHT PAGE: LIGHT and LIGHT_KEYS live beside the design table (T,
    // top of this file); tone() puts them on the outermost foreign card.
    function skyShown() {
      var S = window.hkSky, m = S && S.element ? S.element() : null;
      return !!(m && m.isConnected);
    }
    function tone(el, client) {
      if (!el || !el.style || !el.hasAttribute) return;
      var light = false;
      try {
        light = el.hasAttribute('data-hk-foreign') && !!client && !!client.themes &&
                client.themes.darkMode === false && !skyShown();
      } catch (e) { light = false; }
      // ONLY THE OUTERMOST HK CARD carries the tokens; a card inside it
      // inherits them -- so a dark plate inside a card (Now Playing's artwork,
      // the Music page's phone sheet) can set them back to `initial` for all it
      // holds. A nested card still gets `data-hk-light` for its own rules.
      var S = window.hkSettings, flat = !!(S && S.rendering && S.rendering().flat);
      if (flat) light = S.rendering().theme === 'light';
      flatTone(el);
      // a card that is not an HkBase (the scenes row, hk-chip.js) is toned by
      // its client alone: re-toned with the flat roots when the look changes
      // (syncFlat), or a quiet page kept Flat's plates after Flat was left
      if (!(el instanceof HkBase)) FLAT_ROOTS.add(el);
      var own = light && !el._hkNested && !flat;
      if (el._hkLight === light && el._hkOwnTone === own) return;
      el._hkLight = light;
      el._hkOwnTone = own;
      flag(el, 'data-hk-light', light);
      try {
        LIGHT_KEYS.forEach(function (k) {
          if (own) el.style.setProperty(k, LIGHT[k]); else if (!flat) el.style.removeProperty(k);
        });
      } catch (e) { /* a look, never a failure */ }
      // out of the shared blur while light, back in when not (glassJoin)
      if (el instanceof HkBase && el.isConnected) glassJoin(el, true);
    }
    function dashSeg() { return String(location.pathname).split('/')[1] || ''; }
    // HIGHLIGHT COLOR AUTOMATIC (2026-10-16): each page in its own color --
    // the view's address, its kind's color; Home, the rooms and the rest
    // HK's orange
    // by page kind, each page's own (HK Settings -> the page -> Look ->
    // Highlight Color, look.page_accents, 2026-10-17) else these; a view's
    // address names its kind (PAGE_OF_PATH where the two differ).
    // hk-settings-model.js PAGE_ACCENTS is the same table (tests/test_flat.js).
    var PAGE_ACCENTS = { climate: 'blue', lights: 'yellow', security: 'teal', doors_windows: 'teal',
                         calendar: 'purple', weather: 'cyan', energy: 'green', power: 'green', water: 'cyan',
                         music: 'pink', live_tv: 'indigo', cameras: 'red', vacuums: 'mint', timers: 'orange' };
    var PAGE_OF_PATH = { 'doors-windows': 'doors_windows', playmusic: 'music', 'music-browse': 'music', 'live-tv': 'live_tv' };
    // THE HIGHLIGHT COLOR AS SAVED, here: the screen's (else All Screens',
    // resolved into the board), Automatic the page's own -- a hex
    function legacyAccentHex() {
      var a = String(boardOf(dashSeg()).accent || 'orange').toLowerCase();
      if (a === 'auto') a = pageAccent();
      return ACCENTS[a] || (/^#[0-9a-f]{6}$/.test(a) ? a : ACCENTS.orange);
    }
    function pageAccent() {
      var seg = String(location.pathname).split('/')[2] || '', kind = PAGE_OF_PATH[seg] || seg;
      var S = window.hkSettings, own = S && S.get ? (S.get('look.page_accents', {}) || {})[kind] : null;
      return own || PAGE_ACCENTS[kind] || 'orange';
    }
    // An always-open menu needs room for it: its item's "Always open when the
    // dashboard is at least" (dock_min, 1,000 px -- the menu's
    // 300 beside three tile columns: open on an iPad held sideways, folded on an
    // iPad mini held upright). Narrower, the menu folds into the dashboard's
    // button and comes back when there is room.
    var MENU_DOCK = 1000;
    // EACH DASHBOARD'S OWN MENU SETTINGS: the dashboard items
    // under Dashboards on the integration's page, handed over as `boards`, by
    // url path (settings.py board()). A dashboard with no item has no menu.
    var BOARD = { menu: 'auto', dock_min: MENU_DOCK, time_weather: 'page', ha_row: false,
                  categories: [], tab_position: '', tab_size: 'large', tab_size_phone: 'standard', room_order: [], menu_rooms: 'az', home_rooms: 'as_is',
                  page_rooms: 'floor', rooms_custom: false,
                  // the cameras: All Screens' unless cameras_custom (settings.py resolved())
                  cameras_custom: false,
                  // the menu: All Screens' but for the settings in menu_own (settings.py resolved())
                  menu_own: [], page_header: 'current', accent: 'orange', glyph: 'sidebar', clock: true,
                  // 1.7: Home, Pages, Screen (settings.py BOARD_DEFAULTS). chips_quiet
                  // null = the chip row's own default (hk-chip.js QUIET_DEFAULT).
                  chips_row: true, chips: [], chips_quiet: null, chips_extra: [], camera_strip: true, cameras: [],
                  camera_live: '', camera_live_video: null,
                  scenes_row: true, scenes: [], scenes_pages: [], favorites: [], pages: [],
                  glass: 'house', frost: null, blur: null, sky: true, idle_return: false, idle_room: '', car: false, kiosk: false,
                  popups: true, notify: true, notify_saver: null, notify_dnd: null, now_playing: false,
                  np_style: null, np_side: null, np_bar: null, np_bar_phone: null, screensaver: false, tablet_user: '', custom_pages: [],
                  // the pages at the top of the menu (empty: the views' own)
                  menu_top: [], phone_header: 'header', chips_custom: [], home_page: true, only_pages: [], home_view: '',
                  // swipe right from the left edge opens the menu, at every width
                  swipe: false, ha_place: 'rooms',
                  // the tab bar (a device's Menu 'tabbar', hk-tabbar.js): menu settings
                  tab_bar_scroll: 'shrink', tab_bar_rooms: 'more', tab_bar_glass: 'house', tab_bar_more: 'icons',
                  tab_bar_more_phone: 'list', tab_bar_pos: 'bottom', tab_bar_fold: 'start',
                  tab_bar_start: 'full', tab_bar_adjust: true, tab_bar_scroll_phone: 'shrink',
                  tab_bar_tabs: 6, tab_bar_tabs_rail: 6, tab_bar_size: 'medium', tab_bar_labels: 'show',
                  tab_bar_tabs_phone: 3,
                  // the rail in a phone's side strip (hk-tabbar.js stripSide, 2026-10-30)
                  tab_bar_strip: true,
                  // Swipe Between Pages (hk-pageswipe.js, 2026-10-30): null, Same as All Screens (hkSettings.swipePages);
                  // swipe_left, the page a swipe right on Home goes to (2026-11-06): null, none
                  swipe_pages: null, swipe_left: null,
                  // PHONES' OWN (phoneForm): the menu (null: as before there
                  // was one -- phoneMenu), the button's style, More's rooms
                  menu_phone: null, button_phone: 'chip', tab_bar_rooms_phone: 'more' };
    var ACCENTS = { orange: '#ff9f0a', yellow: '#ffd60a', green: '#30d158', mint: '#63e6e2', teal: '#40c8e0',
                    cyan: '#64d2ff', blue: '#0a84ff', indigo: '#5e5ce6', purple: '#bf5af2', pink: '#ff375f',
                    red: '#ff453a' };
    function boardOf(dash) {
      var HS = window.hkSettings, ver = HS && HS.version, all = msetting('boards', null);
      if (typeof ver !== 'number') return boardBuild(all, dash);
      var m = ST.boardMemo;
      if (m.out && m.ver === ver && m.all === all && m.dash === dash) return m.out;
      var out = boardBuild(all, dash);
      ST.boardMemo = { ver: ver, all: all, dash: dash, out: out };
      return out;
    }
    function boardBuild(all, dash) {
      var out = {}, k;
      for (k in BOARD) out[k] = BOARD[k];
      if (all && typeof all === 'object' && Object.keys(all).length) {
        var b = all[dash];
        if (!b || typeof b !== 'object') { out.menu = 'off'; return out; }
        for (k in BOARD) if (b[k] !== undefined && b[k] !== null) out[k] = b[k];
        return out;
      }
      // no item for any dashboard (a house not set up yet, a test): no menu
      out.menu = 'off';
      return out;
    }
    function msetting(path, fallback) {
      var HS = window.hkSettings;
      return HS ? HS.get(path, fallback) : fallback;
    }

    // what the shell and the later parts use of this one
    K.ACCENTS = ACCENTS; K.ART_KEEP = ART_KEEP; K.artBad = artBad; K.artFallback = artFallback;
    K.artForget = artForget; K.artGuard = artGuard; K.artKept = artKept; K.artLocal = artLocal;
    K.artRemote = artRemote; K.artSign = artSign; K.artSvg = artSvg; K.asClient = asClient; K.BASE_CSS = BASE_CSS;
    K.blockClick = blockClick; K.boardOf = boardOf; K.CLIENT_HUB = CLIENT_HUB; K.clientSeen = clientSeen;
    K.confirmSheet = confirmSheet; K.dashSeg = dashSeg; K.dialogMount = dialogMount; K.DOOR_COVERS = DOOR_COVERS;
    K.edgeCss = edgeCss; K.FLAT = FLAT; K.FLAT_ROOTS = FLAT_ROOTS; K.flatCss = flatCss; K.flatTone = flatTone;
    K.GEN = GEN; K.HA_PAGE = HA_PAGE; K.HkBase = HkBase; K.legacyAccentHex = legacyAccentHex; K.LIGHT = LIGHT;
    K.LIGHT_KEYS = LIGHT_KEYS; K.markAsleep = markAsleep; K.MENU_DOCK = MENU_DOCK; K.msetting = msetting;
    K.navigate = navigate; K.navPath = navPath; K.neverToggles = neverToggles; K.ON_PAGE = ON_PAGE;
    K.openTarget = openTarget; K.PAGE_ACCENTS = PAGE_ACCENTS; K.PAGE_OF_PATH = PAGE_OF_PATH;
    K.pageAccent = pageAccent; K.PILL_LABEL = PILL_LABEL; K.place = place; K.PREVIEW_CLIENTS = PREVIEW_CLIENTS;
    K.SELECTED_BG = SELECTED_BG; K.SELECTED_TEXT = SELECTED_TEXT; K.snapCacheDrop = snapCacheDrop;
    K.snapCacheGet = snapCacheGet; K.snapCacheKeys = snapCacheKeys; K.snapCachePut = snapCachePut;
    K.snapFlush = snapFlush; K.TAP_CONTROLS = TAP_CONTROLS; K.tone = tone;
  };
})();
