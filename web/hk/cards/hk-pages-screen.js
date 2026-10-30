// hk-pages-screen.js -- THE PAGES SCREEN: hk-pages-screen-card
// (docs/phase11/HOMEVIEW-LOOK.md, Phase J; decision 15, 2026-10-30).
//
// The owner, from photos of HomeView's app screen: "a swipe right page that
// looks like the App Screen ... the other pages we have like Music, Lights,
// Rooms, etc. in a full screen page/menu format ... a way to navigate through
// Mantel's pages without a Nav bar." An iPad-style home screen of the
// screen's own pages, right after Home (hk-strategy.js pagesScreen() adds the
// view while the screen's Pages Screen is on; the menu and the tab bar list it
// second, hk-menu.js model):
//
//   * an icon per page in the screen's menu (or the screen's own list): a
//     rounded square (22.4 % corner, as iPadOS) in the page's Accent Color
//     (hkCards.pageAccentHex: its own, else PAGE_ACCENTS'), top to bottom,
//     the page's glyph in white (hk-menu.js glyph: the hk: set where it has
//     the symbol, Material's otherwise -- never new art), the name under it;
//   * live icons: Calendar today's weekday and date, Weather today's
//     temperature; a red badge where something waits (timers running, a
//     notification for the page, Security's alarm armed or a door open);
//   * the rooms in a Rooms folder (four in miniature; a tap opens them as
//     their own icons), or an icon each, or none;
//   * widgets (optional): the Side Pane's sections (Phase A2,
//     hk-sidepane.js) at Less (2 x 1) or More (2 x 2) among the icons --
//     drawn by the pane's own renderer when it is there, nothing when not;
//   * over the screen's own background, blurred, with the time drawn faintly
//     behind; the date and time top left, who is using the screen top right;
//   * more pages than fit: a second Pages screen, dots at the foot;
//   * the Home pill at the foot where the screen shows no tab bar (Home Pill:
//     Automatic), or always, or never: a tap or a swipe up goes Home.
//
// The settings (HK Settings -> Pages Screen, All Screens and each screen) are
// read live (hkSettings.pagesScreen()); only Show builds anything.
//
// THE GEOMETRY is the mock-up's, measured at a 1180 x 820 tablet: 120 px
// icons in 176 x 200 slots, six across and three down, 62 px in from each
// side and 130 px down. Upright it is four by five, on a phone four by six;
// everything scales as one (`s`) to the room the screen has.
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-pages-screen] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  // ---------------------------------------------------------------- sizes
  // the mock-up's, at s = 1 (a 1180 x 820 tablet)
  var SLOT_W = 176, SLOT_H = 200, ICON = 120, GLYPH = 64, LABEL = 17, LABEL_GAP = 10;
  // iPadOS's corner: 22.4 % of the icon
  var CORNER = 0.224;
  // the badge: 34 tall, 8 out past the icon's corner
  var BADGE = 34, BADGE_OUT = 8, BADGE_FONT = 20;
  // a widget sits in its slots 12 in from each side, 4 down, and stops 36
  // above where a label would be; its corner
  var WIDGET_IN = 12, WIDGET_TOP = 4, WIDGET_FOOT = 36, WIDGET_R = 30;
  // the side gutter (62 of a 1180 px screen), never under 16
  var GUTTER = 0.0525, GUTTER_MIN = 16;
  // the header's room: 16 % of the height, 100..150
  var TOP_SHARE = 0.16, TOP_MIN = 100, TOP_MAX = 150;
  // the foot: the dots alone, or the dots over the Home pill
  var FOOT = 44, FOOT_PILL = 90;
  // the time behind: 470 px of an 820 tall screen, 16 % white
  var TIME_H = 0.573, TIME_W = 0.398, TIME_ALPHA = 0.16;
  // the background's blur (the mock-up's)
  var BG_BLUR = 'blur(26px) saturate(1.3)';
  // the Home pill: 200 x 8 (a phone's 134 x 5, as an iPhone's), 22 up
  var PILL_W = 200, PILL_H = 8, PILL_W_PHONE = 134, PILL_H_PHONE = 5, PILL_UP = 22;
  // a swipe up the pill this far goes Home
  var PILL_SWIPE = 24;
  // the rooms' own colors, by their place in the list (rooms have no Accent
  // Color): accent names, drawn as hkCards.ACCENTS has them
  var ROOM_TINTS = ['orange', 'yellow', 'indigo', 'teal', 'green', 'pink', 'blue', 'purple', 'mint', 'red', 'cyan'];
  var PHONE_W = 640;

  // ---------------------------------------------------------------- pure
  // THE GRID for a card W x H: how many icons across and down, the slots,
  // the scale. `o.pill`: the Home pill shows (the foot is taller).
  //   landscape tablet 6 x 3, upright 4 x 5, phone 4 x 6; a short landscape
  //   (a phone held sideways) 6 x 2
  function grid(W, H, o) {
    o = o || {};
    var phone = W < PHONE_W, cols, rows;
    if (phone) { cols = 4; rows = 6; }
    else if (H > W) { cols = 4; rows = 5; }
    else if (H < 560) { cols = 6; rows = 2; }
    else { cols = 6; rows = 3; }
    var gut = Math.max(GUTTER_MIN, W * GUTTER);
    var top = Math.round(Math.min(TOP_MAX, Math.max(TOP_MIN, H * TOP_SHARE)));
    var foot = o.pill ? FOOT_PILL : FOOT;
    var slotW = Math.max(1, (W - 2 * gut) / cols), slotH = Math.max(1, (H - top - foot) / rows);
    var s = Math.max(0.3, Math.min(1, slotW / SLOT_W, slotH / SLOT_H));
    return { cols: cols, rows: rows, phone: phone, gutter: gut, top: top, foot: foot,
             slotW: slotW, slotH: slotH, s: s, icon: ICON * s,
             // a label never under 12 px (an iPhone's), never over 17
             label: Math.max(12, Math.min(LABEL, LABEL * s * 1.2)) };
  }

  // THE ICONS, in order, from the menu's list (hkMenu._.model's answer) and
  // the dashboard's views:
  //   ps.icons 'menu': the menu's top pages and Categories, as it lists them;
  //   a list: those views, in its order (one that is gone is skipped)
  //   ps.rooms: 'folder' one Rooms icon (none without rooms), 'each' an icon
  //   per room, 'none'
  // Each: { key, title, icon, path, kind: 'page' | 'room' | 'folder', page
  // (its page kind, for the accent and the live icons), rooms (a folder's) }
  function icons(m, views, ps, pageOf) {
    m = m || {}; ps = ps || {};
    pageOf = pageOf || function (p) { return p; };
    var out = [];
    function viewKey(it) { var p = it.paths || []; return String(p[1] != null ? p[1] : p[0]); }
    function page(it) {
      var k = viewKey(it);
      return { key: k, title: it.title, icon: it.icon, path: it.path, kind: 'page', page: pageOf(k) };
    }
    if (Array.isArray(ps.icons)) {
      var vs = Array.isArray(views) ? views : [];
      ps.icons.forEach(function (k) {
        for (var i = 1; i < vs.length; i++) {
          var v = vs[i];
          if (!v || v.pages_screen || v.area || String(v.path != null ? v.path : i) !== k) continue;
          if (!(v.menu_title || v.title)) continue;
          var p = m.home && m.home.path ? m.home.path.replace(/\/[^/]*$/, '') : '';
          out.push({ key: k, title: v.menu_title || v.title, icon: v.menu_icon || v.icon || 'mdi:view-dashboard-outline',
                     path: p + '/' + k, kind: 'page', page: pageOf(k) });
          return;
        }
      });
    } else {
      (m.top || []).concat(m.categories || []).forEach(function (it) { if (it && it.kind !== 'pages') out.push(page(it)); });
    }
    var rooms = (m.rooms || []).map(function (r, i) {
      return { key: 'room:' + viewKey(r), title: r.title, icon: r.icon, path: r.path, kind: 'room', tint: ROOM_TINTS[i % ROOM_TINTS.length] };
    });
    if (ps.rooms === 'each') out = out.concat(rooms);
    else if (ps.rooms !== 'none' && rooms.length) out.push({ key: 'rooms', title: 'Rooms', kind: 'folder', rooms: rooms });
    return out;
  }

  // WHERE EVERYTHING GOES: `n` icons and the widgets ([{kind, size, place}])
  // on screens of cols x rows. The widgets first, on the first screen that
  // has room: each on its side (place), from the top, More 2 x 2 and Less
  // 2 x 1 (on a screen narrower than two, none). Then the icons, in order, in
  // the cells left, row by row; a screen full, the next.
  //   -> [{ icons: [{ i, col, row }], widgets: [{ w (index), col, row, cw, ch }] }]
  function place(n, widgets, cols, rows) {
    var screens = [];
    function screen(k) {
      while (screens.length <= k) {
        var used = [];
        for (var r = 0; r < rows; r++) used.push(new Array(cols).fill(false));
        screens.push({ icons: [], widgets: [], used: used });
      }
      return screens[k];
    }
    function free(sc, col, row, cw, ch) {
      if (col < 0 || row < 0 || col + cw > cols || row + ch > rows) return false;
      for (var r = row; r < row + ch; r++) for (var c = col; c < col + cw; c++) if (sc.used[r][c]) return false;
      return true;
    }
    function take(sc, col, row, cw, ch) {
      for (var r = row; r < row + ch; r++) for (var c = col; c < col + cw; c++) sc.used[r][c] = true;
    }
    (widgets || []).forEach(function (w, wi) {
      var cw = 2, ch = w.size === 'less' ? 1 : 2;
      if (cw > cols || ch > rows) return;
      var col = w.place === 'left' ? 0 : cols - cw;
      for (var k = 0; k < 8; k++) {
        var sc = screen(k);
        for (var row = 0; row + ch <= rows; row++) {
          if (free(sc, col, row, cw, ch)) {
            take(sc, col, row, cw, ch);
            sc.widgets.push({ w: wi, col: col, row: row, cw: cw, ch: ch });
            return;
          }
        }
      }
    });
    var k = 0, at = 0;
    for (var i = 0; i < n; i++) {
      for (;;) {
        var sc = screen(k);
        if (at >= cols * rows) { k++; at = 0; continue; }
        var row = Math.floor(at / cols), col = at % cols;
        at++;
        if (sc.used[row][col]) continue;
        sc.used[row][col] = true;
        sc.icons.push({ i: i, col: col, row: row });
        break;
      }
    }
    if (!screens.length) screen(0);
    return screens.map(function (sc) { return { icons: sc.icons, widgets: sc.widgets }; });
  }

  // THE HOME PILL: Automatic shows it where the screen has no tab bar
  function pillOn(pill, tabBar) {
    return pill === 'on' || (pill !== 'off' && !tabBar);
  }

  // AN ICON'S TWO COLORS, top and foot, from its accent (#rrggbb): a little
  // lighter at the top, a little deeper at the foot, as iPadOS's own
  function mix(hex, to, f) {
    var c = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
    return '#' + c.map(function (x) {
      var y = Math.round(x + (to - x) * f);
      return (y < 16 ? '0' : '') + y.toString(16);
    }).join('');
  }
  function gradient(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#8e8e93';
    return [mix(hex, 255, 0.18), mix(hex, 0, 0.08)];
  }

  // THE BADGES, by page kind: what waits there.
  //   timers   the quick timers running (sensor.running_quick_timers), else
  //            the timers active
  //   security each door open and garage door up, and one for the alarm armed
  //   any page a notification showing now that opens it (hkNotify)
  // `sec`: the Security settings ({alarm, doors, garage}); `notes`: the
  // notifications showing
  function badges(states, sec, notes) {
    states = states || {}; sec = sec || {};
    var out = {};
    var q = states['sensor.running_quick_timers'], n = q ? parseInt(q.state, 10) : NaN;
    if (!(n >= 0)) n = Object.keys(states).filter(function (id) { return id.indexOf('timer.') === 0 && states[id].state === 'active'; }).length;
    if (n > 0) out.timers = n;
    var open = 0;
    (sec.doors || []).forEach(function (id) { if (states[id] && states[id].state === 'on') open++; });
    (sec.garage || []).forEach(function (id) { if (states[id] && (states[id].state === 'open' || states[id].state === 'opening')) open++; });
    var alarm = sec.alarm && states[sec.alarm];
    if (alarm && /^armed/.test(alarm.state)) open++;
    if (open) out.security = open;
    (notes || []).forEach(function (x) {
      var p = x && (x.page || x.go);
      if (!p) return;
      var k = String(p).replace(/^\.?\/+/, '').split(/[/?#]/)[0];
      if (k) out['path:' + k] = (out['path:' + k] || 0) + 1;
    });
    return out;
  }

  whenBase(function (C) {
    if (window.hkPagesScreen && window.hkPagesScreen.card) return;     // double-load guard
    var HkBase = C.HkBase, esc = C.esc, v = C.v;

    function H() { return window.hkMenu && window.hkMenu._; }
    function glyph(icon) { var h = H(); return h && h.glyph ? h.glyph(icon) : icon; }
    function accentHex(kind) {
      return (C.pageAccentHex && C.pageAccentHex(kind)) || (C.ACCENTS && C.ACCENTS.orange) || '#ff9f0a';
    }
    function tintHex(name) { return (C.ACCENTS && C.ACCENTS[name]) || '#8e8e93'; }
    function red() { return (C.ACCENTS && C.ACCENTS.red) || '#ff453a'; }
    function loc() { return window.hkLocale; }
    function fmt(d, o, time) {
      var L = loc();
      try {
        if (time) return d.toLocaleTimeString(L ? L.tag() : undefined, L ? L.clock(o) : o);
        return d.toLocaleDateString(L ? L.tag() : undefined, L ? L.zoned(o) : o);
      } catch (e) { return ''; }
    }

    // THE PAGE AS A SIDE PANE SECTION DRAWS IT (Phase A2): the pane's own
    // renderer, when hk-sidepane.js is there and has one -- an element, or
    // its markup. Read defensively: nothing at all without it.
    function sectionRenderer() {
      var P = window.hkSidePane;
      var fn = P && (typeof P.section === 'function' ? P.section : typeof P.renderSection === 'function' ? P.renderSection : null);
      return fn ? function (kind, size, ctx) { return fn.call(P, kind, size, ctx); } : null;
    }

    var CSS = [
      ':host{display:block;position:relative;z-index:0;box-sizing:border-box;overflow:hidden;',
      '  height:calc(100dvh - var(--hk-bar-room, var(--hk-tabbar-h, 0px)));',
      '  color:' + v('ink') + ';-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}',
      // the screen's background, blurred (fixed: the whole window, under the
      // bar too); not in Flat, where there is nothing to blur
      '.bg{position:fixed;inset:0;z-index:-1;pointer-events:none;',
      '  -webkit-backdrop-filter:' + BG_BLUR + ';backdrop-filter:' + BG_BLUR + '}',
      ':host([data-flat]) .bg{display:none}',
      '.time{position:absolute;left:0;right:0;text-align:center;font-weight:500;line-height:1;letter-spacing:-0.0425em;',
      '  font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;color:currentColor;opacity:' + TIME_ALPHA + '}',
      '.when{position:absolute;font-weight:600;line-height:1.3;text-shadow:0 1px 6px rgba(0,0,0,.3)}',
      '.when b{display:block;font-weight:600;letter-spacing:.5px;text-transform:uppercase}',
      '.who{position:absolute;border-radius:50%;display:grid;place-items:center;overflow:hidden;font-weight:600;',
      '  color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.7)}',
      '.who img{width:100%;height:100%;object-fit:cover}',
      // the screens, side by side; one at a time, snapped
      '.screens{position:absolute;inset:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;',
      '  scrollbar-width:none;overscroll-behavior-x:contain}',
      '.screens::-webkit-scrollbar{display:none}',
      '.screen{position:relative;flex:none;width:100%;height:100%;scroll-snap-align:start}',
      '.app{all:unset;box-sizing:border-box;position:absolute;display:grid;justify-items:center;align-content:start;cursor:pointer}',
      '.app:focus-visible .ic{outline:3px solid rgba(255,255,255,.85);outline-offset:3px}',
      '.ic{position:relative;display:grid;place-items:center;box-shadow:0 6px 18px rgba(0,0,0,.22);color:#fff;',
      '  transition:transform ' + C.DUR.press + ' ease}',
      '.app:active .ic{transform:scale(.94)}',
      '.ic hk-icon{display:flex}',
      '.nm{font-weight:500;line-height:1.15;color:' + v('ink') + ';text-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap;',
      '  overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center}',
      ':host([data-flat]) .nm,:host([data-flat]) .when{text-shadow:none}',
      // live icons
      '.cal{background:#fff;color:#1c1c1e;align-content:center;gap:0}',
      '.cal i{font-style:normal;font-weight:600;line-height:1;text-align:center}',
      '.cal span{font-weight:400;line-height:1;text-align:center}',
      '.wx{align-content:center;gap:0}',
      '.wx span{font-weight:500;line-height:1;letter-spacing:-0.02em}',
      // the folder: rooms in miniature on frosted glass
      '.fold{background:rgba(255,255,255,.28);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);',
      '  grid-template-columns:repeat(2,auto);align-content:center;justify-content:center}',
      '.fold u{display:grid;place-items:center;color:#fff;text-decoration:none}',
      '.bdg{position:absolute;color:#fff;font-weight:600;text-align:center;box-sizing:border-box;',
      '  box-shadow:0 2px 6px rgba(0,0,0,.25)}',
      // a widget's place
      '.wd{position:absolute;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.22)}',
      '.wd>*{width:100%;height:100%;box-sizing:border-box}',
      // the dots, and the Home pill
      '.dots{position:absolute;left:0;right:0;display:flex;justify-content:center;gap:2px}',
      '.dots button{all:unset;width:18px;height:18px;display:grid;place-items:center;cursor:pointer}',
      '.dots button::after{content:"";width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.45)}',
      '.dots button[aria-current="true"]::after{background:#fff}',
      // (the button is the pill's reach: 44 tall over the pill, the pill at its foot)
      '.pill{all:unset;box-sizing:border-box;position:absolute;left:50%;bottom:0;transform:translateX(-50%);display:grid;',
      '  place-items:end center;width:calc(var(--pw) + 40px);cursor:pointer;touch-action:none}',
      '.pill::after{content:"";width:var(--pw);height:var(--ph);border-radius:999px;background:rgba(255,255,255,.85);',
      '  box-shadow:0 1px 4px rgba(0,0,0,.2)}',
      ':host([data-flat]) .pill::after{background:' + v('ink-2') + '}',
      // the open folder: the rooms as their own icons, over the screen
      '.open{position:absolute;inset:0;z-index:2;display:grid;place-items:center;',
      '  background:rgba(0,0,0,.18);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}',
      // (the screen under it fades back, as iPadOS's: a slow tablet or a browser without the blur shows no icons through)
      ':host([data-open]) .screens,:host([data-open]) .dots{opacity:.12;transition:opacity ' + C.DUR.fade + ' ease}',
      '.open h2{margin:0 0 18px;font-size:30px;font-weight:600;text-align:center;text-shadow:0 1px 6px rgba(0,0,0,.3)}',
      '.open .box{position:relative;background:rgba(255,255,255,.22);border-radius:' + C.R.sheet + 'px;overflow:auto;',
      '  box-shadow:0 10px 30px rgba(0,0,0,.2)}',
      '.open .app{position:relative}',
      '.open .grid{display:grid;justify-content:center}',
      '@keyframes hkPsOpen{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}',
      '.open .wrap{animation:hkPsOpen ' + C.DUR.standard + ' ' + C.EASE.standard + '}',
      '@media (prefers-reduced-motion:reduce){.open .wrap{animation:none}.ic{transition:none}}'
    ].join('');

    class HkPagesScreenCard extends HkBase {
      static get CSS() { return CSS; }
      getCardSize() { return 12; }

      connectedCallback() {
        super.connectedCallback();
        // on the page's own edges: no margin of the grid's (hk-grid-view's
        // #root>* gives every card one; a card's inline style wins)
        this.style.margin = '0';
        var self = this;
        if (!this._ro && typeof ResizeObserver !== 'undefined') {
          // (a new size draws on the next frame, never inside the observer's
          // own delivery: the draw lays the page out again)
          this._ro = new ResizeObserver(function () {
            if (self._roRaf) return;
            self._roRaf = requestAnimationFrame(function () {
              self._roRaf = 0;
              var z = self._size();
              if (self._built && self._sizeWas && z.W === self._sizeWas.W && z.H === self._sizeWas.H) return;
              self.redraw();
            });
          });
        }
        if (this._ro) this._ro.observe(this);
        this._tick();
      }
      disconnectedCallback() {
        super.disconnectedCallback();
        if (this._ro) this._ro.disconnect();
        if (this._clockT) { clearTimeout(this._clockT); this._clockT = null; }
        this._folder = false;
      }
      // THE CLOCK: drawn again on the minute (a push may not come)
      _tick() {
        var self = this;
        if (this._clockT) clearTimeout(this._clockT);
        var now = new Date();
        this._clockT = setTimeout(function () { self._clockT = null; if (self.isConnected) { self.redraw(); self._tick(); } },
                                  (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
      }

      // what the screen shows, read once per draw
      _read() {
        var client = this.client || {}, states = client.states || {}, HS = window.hkSettings, M = C.menu;
        var b = M && M.board ? M.board() : {};
        // (this screen's own as stored -- hkSettings reads it: menu.board() keeps only the menu's keys)
        var ps = HS && HS.pagesScreen ? HS.pagesScreen() : { icons: 'menu', rooms: 'folder', widgets: [], pill: 'auto' };
        var cfg = M && M.config ? M.config() : null, h = H();
        var m = h && h.model && cfg ? h.model(cfg, client.areas, {
          dash: M.dash ? M.dash() : '', order: b.menu_rooms === 'order' ? 'order' : 'az', roomOrder: b.room_order,
          user: client.user && client.user.id, categories: b.categories, top: b.menu_top, chips: b.chips,
          chipsRow: b.chips_row, pageOrder: h.pagePaths ? h.pagePaths(b.pages, b.custom_pages) : [], ha: false }) : {};
        var PO = C.PAGE_OF_PATH || {};
        var list = icons(m, cfg && cfg.views, ps, function (k) { return PO[k] || k; });
        var sec = { alarm: (HS && HS.get('security.alarm')) || Object.keys(states).filter(function (id) { return id.indexOf('alarm_control_panel.') === 0; })[0],
                    doors: HS ? HS.get('security.doors', []) : [], garage: HS ? HS.get('security.garage', []) : [] };
        var notes = [];
        try { notes = window.hkNotify && window.hkNotify.shown ? window.hkNotify.shown() : []; } catch (e) { notes = []; }
        var wx = HS && HS.weatherId ? HS.weatherId(states) : null, ws = wx && states[wx];
        var t = ws && ws.attributes ? Number(ws.attributes.temperature) : NaN;
        var person = null, uid = client.user && client.user.id;
        if (uid) {
          Object.keys(states).forEach(function (id) {
            if (!person && id.indexOf('person.') === 0 && states[id].attributes && states[id].attributes.user_id === uid) person = states[id];
          });
        }
        var flat = !!(HS && HS.rendering && HS.rendering().flat);
        var render = sectionRenderer();
        return { ps: ps, m: m, list: list, badges: badges(states, sec, notes), temp: isFinite(t) ? Math.round(t) + '°' : '',
                 who: { name: (client.user && client.user.name) || (person && person.attributes.friendly_name) || '',
                        pic: person && person.attributes.entity_picture || '' },
                 tabBar: !!(M && M.tabBar && M.tabBar()), flat: flat,
                 widgets: render ? (ps.widgets || []) : [], render: render };
      }
      _size() {
        var r = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
        var W = r && r.width > 0 ? r.width : (window.innerWidth || 1180);
        var Hh = r && r.height > 0 ? r.height : (window.innerHeight || 820);
        return { W: Math.round(W), H: Math.round(Hh) };
      }
      // NOT ON EVERY PUSH: a draw when what shows changes (the minute, the
      // size, the settings, the icons, a badge, the temperature). Widgets
      // follow the house themselves, so a push only hands them the client.
      _sigOf() { return null; }
      _render() {
        var d = this._read(), sz = this._size(), now = new Date();
        this._sizeWas = sz;
        var key = JSON.stringify([sz, now.getHours(), now.getMinutes(), now.getDate(), d.ps, d.list, d.badges, d.temp, d.who,
                                  d.tabBar, d.flat, !!d.render, this._folder, window.hkSettings && window.hkSettings.version,
                                  !!(window.hkGlyphs && window.hkGlyphs.icons)]);
        if (key === this._key && this._built) { this._feed(); return; }
        this._key = key;
        this.toggleAttribute('data-flat', d.flat);
        this.toggleAttribute('data-open', !!this._folder);
        var keep = this._root.querySelector('.screens'), at = keep ? keep.scrollLeft : 0;
        this._root.innerHTML = this._html(d, sz, now);
        this._built = true;
        this._d = d;
        var sc = this._root.querySelector('.screens');
        if (sc && at) sc.scrollLeft = at;
        this._mountWidgets(d);
        this._wire(d);
      }
      _feed() {
        var c = this.client, A = window.hkHostClient;
        (this._widgetEls || []).forEach(function (el) {
          if (el && typeof el.setConfig === 'function' && A && A.bridge && c) A.bridge(el, c);
        });
      }

      _html(d, sz, now) {
        var W = sz.W, Ht = sz.H, pill = pillOn(d.ps.pill, d.tabBar);
        var g = grid(W, Ht, { pill: pill }), s = g.s;
        var screens = place(d.list.length, d.widgets, g.cols, g.rows);
        this._screens = screens.length;
        var out = '<div class="bg"></div>';
        // the time, faint, behind it all
        var hm = fmt(now, { hour: 'numeric', minute: '2-digit' }, true).replace(/\s?[AP]\.?M\.?$/i, '');
        // (a phone's under its date line, which takes the top there)
        out += '<div class="time" aria-hidden="true" style="top:' + (g.phone ? 64 : Math.round(40 * s)) + 'px;font-size:' +
               Math.round(Math.min(Ht * TIME_H, W * TIME_W)) + 'px">' + esc(hm) + '</div>';
        // the date and time, top left; who's here, top right
        var fs = g.phone ? 15 : 20, top = g.phone ? 18 : 40;
        out += '<div class="when" style="left:' + Math.round(g.gutter) + 'px;top:calc(env(safe-area-inset-top, 0px) + ' + top +
               'px);font-size:' + fs + 'px"><b>' + esc(fmt(now, { weekday: 'long', month: 'short', day: 'numeric' })) + '</b>' +
               esc(fmt(now, { hour: 'numeric', minute: '2-digit' }, true)) + '</div>';
        if (d.who.name || d.who.pic) {
          var av = g.phone ? 40 : 56;
          out += '<div class="who" title="' + esc(d.who.name) + '" style="right:' + Math.round(g.gutter) + 'px;top:calc(env(safe-area-inset-top, 0px) + ' +
                 (top - 6) + 'px);width:' + av + 'px;height:' + av + 'px;font-size:' + Math.round(av * 0.43) + 'px;background:' +
                 tintHex('orange') + '">' + (d.who.pic ? '<img alt="" src="' + esc(d.who.pic) + '">' : esc(d.who.name.trim().charAt(0).toUpperCase())) + '</div>';
        }
        // the screens of icons
        var self = this;
        out += '<div class="screens"' + (screens.length > 1 ? ' data-hk-control' : '') + '>';
        screens.forEach(function (sc, k) {
          out += '<div class="screen" data-s="' + k + '">';
          sc.widgets.forEach(function (w) {
            var x = g.gutter + w.col * g.slotW + WIDGET_IN * s, y = g.top + w.row * g.slotH + WIDGET_TOP * s;
            out += '<div class="wd" data-w="' + w.w + '" data-kind="' + esc(d.widgets[w.w].kind) + '" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) +
                   'px;width:' + (w.cw * g.slotW - 2 * WIDGET_IN * s).toFixed(1) + 'px;height:' + (w.ch * g.slotH - (WIDGET_TOP + WIDGET_FOOT) * s).toFixed(1) +
                   'px;border-radius:' + (WIDGET_R * s).toFixed(1) + 'px"></div>';
          });
          sc.icons.forEach(function (c) {
            var it = d.list[c.i];
            var x = g.gutter + c.col * g.slotW, y = g.top + c.row * g.slotH + Math.max(0, (g.slotH - SLOT_H * s) / 2);
            out += self._app(it, d, g, 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;width:' + g.slotW.toFixed(1) + 'px');
          });
          out += '</div>';
        });
        out += '</div>';
        // the dots: one per screen, with two or more
        var dotsAt = pill ? 60 : 16;
        if (screens.length > 1) {
          out += '<div class="dots" role="tablist" style="bottom:' + dotsAt + 'px">' + screens.map(function (x, k) {
            return '<button type="button" data-dot="' + k + '" aria-label="Pages ' + (k + 1) + ' of ' + screens.length + '"' +
                   (k === 0 ? ' aria-current="true"' : '') + '></button>';
          }).join('') + '</div>';
        }
        if (pill) {
          var pw = g.phone ? PILL_W_PHONE : PILL_W, ph = g.phone ? PILL_H_PHONE : PILL_H;
          out += '<button class="pill" type="button" aria-label="Home" style="--pw:' + pw + 'px;--ph:' + ph + 'px;height:calc(env(safe-area-inset-bottom, 0px) + ' +
                 (PILL_UP + ph + 36) + 'px);padding-bottom:calc(env(safe-area-inset-bottom, 0px) + ' + PILL_UP + 'px)"></button>';
        }
        if (this._folder) out += this._openHtml(d, g);
        return out;
      }

      // ONE ICON: its plate, its glyph or live face, its badge, its name
      _app(it, d, g, style) {
        var s = g.s, sz = g.icon, r = (sz * CORNER).toFixed(1), plate, inner = '';
        var box = 'width:' + sz.toFixed(1) + 'px;height:' + sz.toFixed(1) + 'px;border-radius:' + r + 'px;';
        var gl = function (icon, px) {
          return '<hk-icon icon="' + esc(glyph(icon)) + '" style="--mdc-icon-size:' + px.toFixed(1) + 'px;width:' + px.toFixed(1) +
                 'px;height:' + px.toFixed(1) + 'px"></hk-icon>';
        };
        var cls = 'ic';
        if (it.kind === 'folder') {
          var mini = 34 * s, gap = 10 * s;
          cls += ' fold';
          plate = box + 'gap:' + gap.toFixed(1) + 'px';
          inner = it.rooms.slice(0, 4).map(function (rm) {
            return '<u style="width:' + mini.toFixed(1) + 'px;height:' + mini.toFixed(1) + 'px;border-radius:' + (8 * s).toFixed(1) +
                   'px;background:' + tintHex(rm.tint) + '">' + gl(rm.icon, 20 * s) + '</u>';
          }).join('');
        } else if (it.page === 'calendar') {
          cls += ' cal';
          var now = new Date();
          plate = box;
          inner = '<i style="font-size:' + (22 * s).toFixed(1) + 'px;color:' + red() + '">' + esc(fmt(now, { weekday: 'short' })) + '</i>' +
                  '<span style="font-size:' + (66 * s).toFixed(1) + 'px;letter-spacing:' + (-2 * s).toFixed(1) + 'px">' + esc(fmt(now, { day: 'numeric' })) + '</span>';
        } else {
          var hex = it.kind === 'room' ? tintHex(it.tint) : accentHex(it.page), gr = gradient(hex);
          plate = box + 'background:linear-gradient(180deg,' + gr[0] + ',' + gr[1] + ')';
          if (it.page === 'weather' && d.temp) {
            cls += ' wx';
            inner = gl(it.icon, 34 * s) + '<span style="font-size:' + (44 * s).toFixed(1) + 'px">' + esc(d.temp) + '</span>';
          } else inner = gl(it.icon, GLYPH * s);
        }
        var n = d.badges[it.page] || d.badges['path:' + it.key] || 0;
        if (it.page && it.page !== it.key && d.badges['path:' + it.key]) n = (d.badges[it.page] || 0) + d.badges['path:' + it.key];
        var bh = BADGE * s, badge = n ? '<b class="bdg" style="right:' + (-BADGE_OUT * s).toFixed(1) + 'px;top:' + (-BADGE_OUT * s).toFixed(1) +
          'px;min-width:' + bh.toFixed(1) + 'px;height:' + bh.toFixed(1) + 'px;border-radius:' + (bh / 2).toFixed(1) + 'px;padding:0 ' + (8 * s).toFixed(1) +
          'px;font-size:' + (BADGE_FONT * s).toFixed(1) + 'px;line-height:' + bh.toFixed(1) + 'px;background:' + red() + '">' + (n > 99 ? '99+' : n) + '</b>' : '';
        var label = it.title + (n ? ', ' + n + ' waiting' : '') + (it.kind === 'folder' ? ', folder' : '');
        return '<button class="app" type="button" ' + (it.kind === 'folder' ? 'data-folder' : 'data-go="' + esc(it.path) + '"') +
               ' aria-label="' + esc(label) + '" style="' + style + ';row-gap:' + (LABEL_GAP * s).toFixed(1) + 'px">' +
               '<div class="' + cls + '" style="' + plate + '">' + inner + badge + '</div>' +
               '<div class="nm" style="font-size:' + g.label.toFixed(1) + 'px">' + esc(it.title) + '</div></button>';
      }

      // THE OPEN FOLDER: the rooms as their own icons, four across (a
      // phone's three), the folder's name over them; a tap outside closes it
      _openHtml(d, g) {
        var f = d.list.filter(function (x) { return x.kind === 'folder'; })[0];
        if (!f) return '';
        var cols = g.phone ? 3 : 4, self = this;
        var apps = f.rooms.map(function (rm) {
          return self._app(rm, d, g, 'width:' + g.slotW.toFixed(1) + 'px;height:' + (SLOT_H * g.s).toFixed(1) + 'px');
        }).join('');
        return '<div class="open" data-close><div class="wrap"><h2>' + esc(f.title) + '</h2><div class="box" role="dialog" aria-label="' +
               esc(f.title) + '" style="padding:' + (28 * g.s).toFixed(1) + 'px ' + (12 * g.s).toFixed(1) + 'px ' + (4 * g.s).toFixed(1) +
               'px;max-height:' + Math.round(this._size().H * 0.7) + 'px"><div class="grid" style="grid-template-columns:repeat(' + Math.min(cols, f.rooms.length) + ',' + g.slotW.toFixed(1) + 'px)">' +
               apps + '</div></div></div></div>';
      }

      _mountWidgets(d) {
        var self = this, els = [];
        this._root.querySelectorAll('.wd[data-w]').forEach(function (slot) {
          var w = d.widgets[+slot.getAttribute('data-w')];
          var got = null;
          try { got = d.render(w.kind, w.size, { client: self.client, place: 'pages', side: w.place }); } catch (e) { got = null; }
          if (got && got.nodeType) slot.appendChild(got);
          else if (typeof got === 'string' && got) slot.innerHTML = got;
          else slot.remove();
          if (got && got.nodeType) els.push(got);
        });
        this._widgetEls = els;
        this._feed();
      }

      _home() {
        var m = this._d && this._d.m, p = m && m.home && m.home.path;
        if (p && window.hkShell && window.hkShell.navigate) window.hkShell.navigate(p);
      }
      _wire(d) {
        var self = this, root = this._root;
        if (!this._wired) {
          this._wired = true;
          root.addEventListener('click', function (e) {
            var t = e.target && e.target.closest ? e.target : null;
            if (!t) return;
            var go = t.closest('[data-go]');
            if (go) { e.stopPropagation(); self._folder = false; window.hkShell.navigate(go.getAttribute('data-go')); return; }
            if (t.closest('[data-folder]')) { self._folder = true; self.redraw(); return; }
            var dot = t.closest('[data-dot]');
            if (dot) {
              var sc = root.querySelector('.screens');
              if (sc) sc.scrollTo({ left: +dot.getAttribute('data-dot') * sc.clientWidth, behavior: 'smooth' });
              return;
            }
            if (t.closest('.pill')) { if (!self._pillSwiped) self._home(); self._pillSwiped = false; return; }
            if (t.closest('[data-close]') && !t.closest('.box')) { self._folder = false; self.redraw(); }
          });
          root.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && self._folder) { self._folder = false; self.redraw(); }
          });
          // a swipe up the Home pill goes Home, as the iPad's home indicator
          var y0 = null;
          root.addEventListener('pointerdown', function (e) { y0 = e.target && e.target.closest && e.target.closest('.pill') ? e.clientY : null; });
          root.addEventListener('pointerup', function (e) {
            if (y0 !== null && y0 - e.clientY > PILL_SWIPE) { self._pillSwiped = true; self._home(); }
            y0 = null;
          });
        }
        // which screen is showing: its dot
        var sc = root.querySelector('.screens');
        if (sc && this._screens > 1) {
          sc.addEventListener('scroll', function () {
            var k = Math.round(sc.scrollLeft / Math.max(1, sc.clientWidth));
            root.querySelectorAll('[data-dot]').forEach(function (b) { b.setAttribute('aria-current', String(+b.getAttribute('data-dot') === k)); });
          }, { passive: true });
        }
      }
    }

    C.register('hk-pages-screen-card', HkPagesScreenCard, 'HK Pages Screen',
               'An iPad-style home screen of the screen’s pages (a generated screen’s Pages Screen).');
    // its own page's, never a card to add by hand
    if (C.unlisted) C.unlisted('hk-pages-screen-card');
    window.hkPagesScreen = { card: HkPagesScreenCard, _: { grid: grid, icons: icons, place: place, pillOn: pillOn,
                                                         gradient: gradient, badges: badges, ROOM_TINTS: ROOM_TINTS } };
  });
})();
