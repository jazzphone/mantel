// hk-tabbar.js -- THE TAB BAR, after iOS 26's floating tab bar
// (docs/Tab-Bar.md): a pill of tabs floating above the bottom of the screen,
// with a round Rooms button beside it. A second way round a screen, beside
// the menu (hk-menu.js), not in place of it: a screen can have either, both
// or neither.
//
// NOTHING HERE NAMES A PAGE. The tabs are the menu's own list
// (hkMenu._.model): Home, then the menu's Categories in its order. What does
// not fit the width, and the pages at the top of the menu (Weather, Cameras,
// Live TV on a generated screen), are in a MORE sheet, and under them the
// rooms, in the menu's room order (or a Rooms button and sheet of their own:
// the menu's Rooms setting, roomsMode()). Per-user visibility, `menu: false`
// and a screen's Pages in Menu all apply, because it is the same list.
//
// WHERE IT SHOWS is the menu's to say (hk-base.js menu.tabBar): a screen's
// Menu "Tab Bar" -- the bar at every width, no side menu -- or its On Narrow
// Screens / When Folded "Tab Bar" -- the side menu where it fits and the bar
// where it would fold. The two never show together. Never in Home
// Assistant's edit mode, or off the dashboards.
//
// WHILE SCROLLING (`tab_bar_scroll`): shrink -- scrolling down folds the
// pill into one small round button holding the current page's icon, so it is
// never out of reach; hide -- it slides off the bottom; stay. Either way it
// comes back on any scroll up (UP px), at the top or the end of the page, on
// a page change, and (shrink) when the small button is tapped. A page too
// short to scroll never folds it.
//
// THE GLASS (`tab_bar_glass`): house -- the screen's own look (data-hk-glass,
// hk-settings.js): frosted stays frosted, every other look is one blur;
// blur -- ONE backdrop-filter for the bar (hk-glass.js measured that the bill
// is the number of blur surfaces, not their size); frosted -- a milky plate,
// no blur; clear -- a near-solid tint, no blur. Never see-through: a clear
// bar with no blur cannot be read over the tiles (mockups, 2026-10-05).
//
// THE PAGE MAKES ROOM: --hk-tabbar-h on <html> (the bar's top edge to the
// bottom of the window, while it shows) pads the view's bottom, so the last
// row scrolls clear of it, and puts the now-playing bar (hk-popup.js #media)
// above it, as iOS stacks its mini player over the tab bar.
//
// Mounted ONCE, in <home-assistant>'s shadow root beside the menu and the
// sheets, so it outlives every page change. Stacking: the bar at 6 (the
// menu's edge tab), under the pop-ups (7), the detail sheets (8) and the
// open menu (9); its own sheets open at 6 too, over the page.
(function () {
  'use strict';
  if (window.hkTabBar) return;
  // the host's page: where the bar mounts, its view, navigation
  var SH = window.hkShell;

  // ---------------------------------------------------------------- sizes
  // Measured against iOS 26's tab bar and fitted to a 402 px iPhone: a tab
  // is never narrower than TAB_MIN_W (a 10.5 px label like "Security" is
  // ~44 px of ink) nor wider than TAB_MAX_W; at most MAX_TABS, More
  // included, however wide the screen.
  var TAB_MIN_W = 54, TAB_MAX_W = 96, MAX_TABS = 10;
  // Tabs in Bar / in Rail count PAGES -- Home and More come on top (6 pages:
  // eight tabs in all)
  var PAGES_DEFAULT = 6;
  // A PHONE (under PHONE_W, hk-base.js MENU_NARROW) gets five unless its
  // Tabs in Bar on Phones says otherwise, More included, as Apple Music has:
  // Home and three more were the comfortable fit, four cramped (2026-10-05)
  // -- so three pages by default, four at most (PHONE_PAGES_MAX, 2026-10-27)
  var PHONE_W = 640, PHONE_PAGES = 3, PHONE_PAGES_MAX = 4;
  // ...and four, chosen, may be 2 px narrower each: six tabs then fit a
  // 390-393 px iPhone (53 px each) as well as a 402 px one
  var PHONE_SNUG = 2;
  // GUTTER: Apple Music's tab bar sits 21 pt in from each side of a 402 pt
  // iPhone (measured from a screenshot, 2026-10-05)
  // BAR_H and WIDEN after Apple Music on a 402 pt iPhone (screenshot,
  // 2026-10-05): a 60 pt bar, the selected tab's capsule ~76 x 53 pt -- ours
  // 77 x 54 (a 67 px tab plus 5 px each side)
  var GUTTER = 21, GAP = 10, ROUND = 62, PAD = 4, BAR_H = 60, LIFT = 14, TAB_GAP = 4, WIDEN = 5;
  // THE HIGHLIGHT'S GAPS GROW WITH THE BAR (2026-10-09): every gap inside
  // the bar -- the highlight from the bar's edge and ends, the space between
  // tabs, how far the highlight reaches into it, and a rail's the same -- is
  // the bar's thickness / GAP_RATIO. Apple Music's 4 px on a 60 px phone bar
  // is the ratio; PAD, TAB_GAP, WIDEN and RAIL_* above and below are those
  // gaps at that size, and gapsOf() scales them to any other.
  var GAP_RATIO = 15;
  function gapsOf(thick) {
    var g = thick / GAP_RATIO, k = g / 4;
    return { pad: PAD * k, tab: TAB_GAP * k, widen: WIDEN * k, railPad: RAIL_PAD * k, railGap: RAIL_GAP * k };
  }
  // THE BAR'S THICKNESS: a phone's 60 (Apple Music's), a tablet or wider 72
  // -- the rail's width too, so the bar and the rail are the same size
  // (2026-10-06). CSS reads it as --bh.
  var BAR_H_WIDE = 72;
  // TAB BAR SIZE (2026-10-06): Small, Medium (the sizes above) or Large --
  // 8 px thinner or thicker, on a phone and a tablet alike, the rail's width
  // and its tabs' height with it; the icons and names a step smaller or
  // larger (CSS: --ti, --ci, --tf). The highlight's gaps (4 px from the
  // bar's edge, the rail's ends) are padding, so they hold at every size.
  var SIZE_STEP = { small: -8, medium: 0, large: 8 };
  // ICONS ONLY (Labels, 2026-10-24): no names, so a bar 10 px thinner (a
  // rail 10 px narrower, its tabs 10 px shorter) at every size. Set from the
  // screen's settings as the bar is drawn (render()); the fit follows it.
  var ICONS_STEP = -10, iconsOnly = false;
  function step(size) { return (SIZE_STEP[size] || 0) + (iconsOnly ? ICONS_STEP : 0); }
  // `phone`: a phone's bar (hk-base.js menu.phone(): under 640 px, or a
  // phone held sideways); unset, by `width` (or the device, without one)
  function barH(width, size, phone) {
    var ph = phone !== undefined ? phone : width === undefined ? phoneAt() : width < PHONE_W;
    return (ph ? BAR_H : BAR_H_WIDE) + step(size);
  }
  // HOW HIGH IT FLOATS: 14 px, or on an iPhone down into the home indicator's
  // safe area as iOS's own tab bar sits (34 px of safe area: 22 px up) -- or,
  // while the now-playing bar is docked along the bottom (hk-popup.js
  // --hk-dock-h), riding 10 px above it. Everything placed by the lift (the
  // row, its sheets, the page's room) follows.
  var LIFT_CSS = 'max(' + LIFT + 'px, calc(env(safe-area-inset-bottom, 0px) - 12px), calc(var(--hk-dock-h, 0px) + 10px))';
  // AT THE TOP (Tab Bar Position): 12 px down, or just under an iPhone's
  // status bar and Dynamic Island
  var TOP_CSS = 'max(12px, calc(env(safe-area-inset-top, 0px) + 4px))';
  // THE RAIL (Left / Right, a tablet or wider): RAIL_W wide, the screen's
  // height less a gutter at each end; a tab RAIL_TAB tall, RAIL_GAP apart
  var RAIL_W = 72, RAIL_TAB = 66, RAIL_GAP = 6, RAIL_PAD = 10;
  // (at Medium: a rail is always a tablet's, as thick as its bar)
  function railW(size) { return RAIL_W + step(size); }
  // THE SHEETS: at least this share of the window (on a phone, up to about
  // the middle of the page), and never under SHEET_MIN px
  var SHEET_SHARE = 0.55, SHEET_MIN = 300;
  // a sheet never comes closer than this to the top of the window: the page
  // that shows there is where a tap closes it
  var TOP_GAP = 96;
  // A TAB NARROWER THAN THIS (six on a phone: ~55 px) has no room for the
  // highlight's capsule -- it would be a cramped circle -- so the page you
  // are on is its icon and name in the highlight colour, as iOS draws it
  var PLATE_MIN = 64;
  var DOWN = 28, UP = 12, EDGE = 4, SHORT = 48;

  // ------------------------------------------------------------ the fit
  // How many tabs show, and whether there is a More, for `n` tabs (Home and
  // the categories), `top` pages at the top of the menu, on a screen `width`
  // wide, with or without the Rooms button (`button`); `extra`: More has
  // something of its own to hold either way (the rooms, In More). Pure, for
  // the tests.
  // `most`: the screen's Tabs in Bar (Home and More included), 8 if unset;
  // `phoneMost`: a phone's (Phones' Tabs in Bar), PHONE_PAGES if unset
  // `size`: Tab Bar Size -- a tab's least and most width move with it
  // `phone`: a phone's fit (five at most, a phone's bar), even held
  // sideways; unset, a width under PHONE_W is one
  function fit(n, top, width, button, extra, most, size, phone, phoneMost) {
    var ph = phone !== undefined ? !!phone : width < PHONE_W;
    var gs = gapsOf(barH(width, size, ph)), pad = gs.pad, tg = gs.tab;
    var avail = Math.max(0, width - 2 * GUTTER - (button ? barH(width, size, ph) + GAP : 0) - 2 * pad);
    var snug = ph && phoneMost > PHONE_PAGES ? PHONE_SNUG : 0;
    var minW = TAB_MIN_W - snug + step(size) * 3 / 4, maxW = TAB_MAX_W + step(size);
    var cap = Math.min(MAX_TABS, (most || PAGES_DEFAULT) + 2);
    most = ph ? Math.min(Math.min(PHONE_PAGES_MAX, phoneMost || PHONE_PAGES) + 2, cap) : cap;
    var slots = Math.max(1, Math.min(most, Math.floor((avail + tg) / (minW + tg))));
    var more = top > 0 || n > slots || !!extra;
    var shown = more ? Math.max(0, Math.min(n, slots - 1)) : n;
    var cells = shown + (more ? 1 : 0);
    var inner = Math.min(avail, cells * maxW + Math.max(0, cells - 1) * tg);
    var tab = cells ? (inner - Math.max(0, cells - 1) * tg) / cells : 0;
    return { shown: shown, more: more, width: Math.round(inner + 2 * pad), plate: tab >= PLATE_MIN };
  }

  // THE RAIL'S FIT: as fit(), down a rail `height` tall
  // `most`: the screen's Tabs in Rail. `height`: the rail as tall as its
  // tabs (it hugs them, centred on its side; opening More stretches it)
  function railFit(n, top, height, extra, most, size) {
    var gs = gapsOf(railW(size)), rp = gs.railPad, rg = gs.railGap;
    var avail = Math.max(0, height - 2 * GUTTER - 2 * rp), tab = RAIL_TAB + step(size);
    var slots = Math.max(1, Math.min(Math.min(MAX_TABS, (most || PAGES_DEFAULT) + 2), Math.floor((avail + rg) / (tab + rg))));
    var more = top > 0 || n > slots || !!extra;
    var shown = more ? Math.max(0, Math.min(n, slots - 1)) : n, cells = shown + (more ? 1 : 0);
    return { shown: shown, more: more, width: railW(size), plate: true,
             height: 2 * rp + cells * tab + Math.max(0, cells - 1) * rg };
  }
  // WHERE THE BAR SITS: the screen's Tab Bar Position, a narrow window (a
  // phone held upright) keeping the bottom for a rail's -- too little width
  // beside it. A phone held sideways (2026-10-24, the nightstand) is wide
  // enough and short: there the rail the screen asks for is the better use,
  // so it is the width that decides, not the device (`phone` is no longer
  // read; its callers still pass it).
  function position(pos, width, phone) {    // eslint-disable-line no-unused-vars
    pos = pos === 'top' || pos === 'left' || pos === 'right' ? pos : 'bottom';
    return (pos === 'left' || pos === 'right') && width < PHONE_W ? 'bottom' : pos;
  }

  // A PHONE'S OWN SETTINGS (the screen's Phones section): at `width` (the
  // tests), else as hk-base.js decides it -- under 640 px, or a phone's
  // screen held sideways (hkCards.menu.phone)
  function phoneAt(width) {
    if (width !== undefined) return width < PHONE_W;
    var Mn = window.hkCards && window.hkCards.menu;
    return Mn && Mn.phone ? !!Mn.phone() : (window.innerWidth || 1280) < PHONE_W;
  }
  // PHONES' SETTINGS HERE (While Scrolling, More): a phone, and a tablet
  // showing Phones' menu where its own doesn't fit (hkCards.menu.phoneForm)
  function phoneSet(width) {
    if (width !== undefined) return width < PHONE_W;
    var Mn = window.hkCards && window.hkCards.menu;
    return Mn && Mn.phoneForm ? !!Mn.phoneForm() : phoneAt();
  }
  // WHILE SCROLLING HERE: Phones' own where Phones' menu shows, else the
  // tablets'
  function scrollOf(b, width) {
    b = b || {};
    return phoneSet(width) ? (b.tab_bar_scroll_phone || 'shrink') : (b.tab_bar_scroll || 'shrink');
  }
  // MORE'S ROOMS HERE: Phones' own (tab_bar_rooms_phone) where Phones' menu
  // shows, else the tablets' -- In More, Own Button or Off (roomsMode)
  function roomsOf(b, width) {
    b = b || {};
    return roomsMode(phoneSet(width) ? b.tab_bar_rooms_phone : b.tab_bar_rooms);
  }
  // MORE'S STYLE HERE: Phones' own (List unless chosen) where Phones' menu
  // shows, else the tablets'
  function moreOf(b, width) {
    b = b || {};
    return phoneSet(width) ? (b.tab_bar_more_phone || 'list') : (b.tab_bar_more || 'icons');
  }

  // HOW THE PAGE MAKES ROOM FOR THE BAR (Adjust Content):
  //   'pad'   a fixed strip on the bar's side -- Stay, and the bottom (room
  //           at the page's end only, so the last row scrolls clear)
  //   'scale' a rail that shrinks or hides: the dashboard eases aside while
  //           the rail is full
  //   'shift' the top, shrinking or hiding: the page slides down clear of the
  //           full bar at the top of the page, and back up as it folds
  //   'none'  Adjust Content off, a rail: the bar floats over the page
  // A BAR ALONG THE BOTTOM OR THE TOP ALWAYS LEAVES ROOM AT THE PAGE'S END
  // (2026-10-13): with Adjust Content off it still floats over the page as
  // it scrolls -- nothing moves -- but the last row (the first, at the top)
  // can always be scrolled clear of it, as on iOS. Off, it once had no room
  // at all, and the last tiles on Home stayed under the bar.
  // A HOME GRID BESIDE A RAIL (2026-10-24, a phone on its side as a
  // nightstand): the rail's strip comes out of the grid's width ('pad') --
  // the grid fits itself to the room it has. Scaled aside, the whole grid
  // shrank a second time and hung from the top, a gap under it.
  function room(pos, scroll, adjust, grid) {
    if (adjust === false) return pos === 'left' || pos === 'right' ? 'none' : 'pad';
    if (scroll !== 'shrink' && scroll !== 'hide') return 'pad';
    if (pos === 'left' || pos === 'right') return grid ? 'pad' : 'scale';
    return pos === 'top' ? 'shift' : 'pad';
  }

  // What the bar holds, from the menu's list (hkMenu._.model's answer).
  function parts(m, f) {
    var tabs = [m.home].concat(m.categories || []).filter(Boolean);
    var shown = tabs.slice(0, f.shown);
    var more = f.more ? (m.top || []).concat(tabs.slice(f.shown)) : [];
    return { tabs: shown, more: more, rooms: (m.rooms || []).slice() };
  }

  // ---------------------------------------------------------- scrolling
  // One step of the bar's state as the page scrolls: `st` { mode: 'full' |
  // 'small' | 'gone', down, up }, the scroll's change `dy`, where it is now
  // `y` and the most it can go `max`, and the setting. Pure, for the tests.
  // `rest` 'small' (Start Small, with Shrink): the bar rests small -- only a
  // tap opens it, and scrolling down folds it again; nothing else brings it
  // back.
  function scrollStep(st, dy, y, max, setting, rest) {
    var s = { mode: st.mode || 'full', down: st.down || 0, up: st.up || 0 };
    if (setting === 'shrink' && rest === 'small') {
      if (dy > 0) { s.down += dy; s.up = 0; if (s.mode === 'full' && s.down >= DOWN) s.mode = 'small'; }
      else if (dy < 0) { s.down = 0; }
      return s;
    }
    if (setting === 'stay' || max < SHORT) return { mode: 'full', down: 0, up: 0 };
    // the top (an iPhone's rubber band goes past it) and the end
    if (y <= EDGE || y >= max - EDGE) return { mode: 'full', down: 0, up: 0 };
    if (dy > 0) {
      s.down += dy; s.up = 0;
      if (s.mode === 'full' && s.down >= DOWN) s.mode = setting === 'hide' ? 'gone' : 'small';
    } else if (dy < 0) {
      s.up -= dy; s.down = 0;
      if (s.mode !== 'full' && s.up >= UP) { s.mode = 'full'; s.up = 0; }
    }
    return s;
  }

  // WHERE THE ROOMS ARE (the menu's Rooms setting): 'more' -- a section of
  // More, under its pages (the default); 'button' -- a round button of their
  // own beside the tabs, with a sheet of its own; 'off'. A boolean from
  // before 2026-10-05 evening: true is In More.
  function roomsMode(v) {
    if (v === false || v === 'off') return 'off';
    return v === 'button' ? 'button' : 'more';
  }

  // The bar's material for a setting and the screen's look. Tinted is stored
  // `tinted` since entry 1.12 (settings.py tab_bar_glass); `clear` is its
  // name from before, which a cached copy may still hold. Only `clear` was
  // known here, so a bar set to Tinted fell through to the screen's look.
  function material(setting, look) {
    if (look === 'flat') return 'flat';
    if (setting === 'tinted' || setting === 'clear') return 'tinted';
    if (setting === 'frosted' || setting === 'blur') return setting;
    // Same as Screen: the screen's Tinted is this bar's Tinted -- no blur on
    // a bar that is always up (and no picture to pin behind it)
    if (look === 'tinted') return 'tinted';
    return look === 'frosted' ? 'frosted' : 'blur';
  }

  window.hkTabBar = { version: '1.0.0', _: { fit: fit, parts: parts, scrollStep: scrollStep, material: material,
                                             roomsMode: roomsMode, roomsOf: roomsOf, moreOf: moreOf, phoneSet: phoneSet, railFit: railFit, position: position, room: room, scrollOf: scrollOf,
                                             SIZES: { TAB_MIN_W: TAB_MIN_W, TAB_MAX_W: TAB_MAX_W, MAX_TABS: MAX_TABS,
                                                      GUTTER: GUTTER, GAP: GAP, ROUND: ROUND, PAD: PAD, RAIL_PAD: RAIL_PAD,
                                                      RAIL_GAP: RAIL_GAP, SIZE_STEP: SIZE_STEP, GAP_RATIO: GAP_RATIO },
                                             gapsOf: gapsOf,
                                             barH: barH, railW: railW } };

  function whenReady(fn) {
    var done = false;
    function go() {
      if (done) return;
      var C = window.hkCards;
      if (!C || !C.menu || typeof C.menu.board !== 'function' || !window.hkMenu || !window.hkMenu._) return;
      done = true;
      fn(C);
    }
    go();
    if (!done) {
      window.addEventListener('hk-cards-ready', go);
      window.addEventListener('hk-module-ready', go);
    }
  }

  whenReady(function (C) {
    var M = C.menu, H = window.hkMenu._;
    var EASE = 'cubic-bezier(.32,.72,0,1)';
    // the highlight's slide: a touch past and back, as a UIKit spring
    var SPRING = 'cubic-bezier(.34,1.24,.42,1)';
    var CSS = [
      ':host{all:initial;--bh:' + BAR_H + 'px;--ti:24px;--ci:26px;--tf:10.5px}',
      // the gaps' unit (gapsOf): the thickness / GAP_RATIO -- 4 px on a 60 px bar
      ':host{--g:calc(var(--bh) / ' + GAP_RATIO + ')}',
      ':host([data-size="small"]){--ti:22px;--ci:24px;--tf:10px}',
      ':host([data-size="large"]){--ti:26px;--ci:28px;--tf:11.5px}',
      // ...but a phone's names stay Medium's: its bar is already the
      // screen's width, so larger names would only be cut shorter
      ':host([data-size="large"]:not([data-wide])){--tf:10.5px}',
      ':host([data-wide]){--bh:' + BAR_H_WIDE + 'px}',
      // ICONS ONLY: the icons a step larger in the slimmer bar (the names
      // go at the end of the sheet, after the rail's own rule for them)
      ':host([data-icons]){--ti:26px}',
      ':host([data-icons][data-size="small"]){--ti:24px}',
      ':host([data-icons][data-size="large"]){--ti:28px}',
      '.root{position:fixed;left:0;top:0;width:0;height:0;z-index:6;',
      // the dashboard's font (hk-base.js FONT_ROOT), as the menu's
      '  ' + window.hkCards.FONT_ROOT + ';',
      '  -webkit-font-smoothing:antialiased;color:' + window.hkCards.v('ink') + ';-webkit-tap-highlight-color:transparent}',
      // THE ROW: the pill and the Rooms button, over the dashboard (past Home
      // Assistant's sidebar), clear of an iPhone's home indicator
      '.row{position:fixed;left:calc(var(--hk-content-left,0px) + var(--hk-pane-l,0px) + ' + GUTTER + 'px);right:calc(' + GUTTER + 'px + var(--hk-pane-r,0px));',
      '  bottom:' + LIFT_CSS + ';display:none;justify-content:center;',
      '  align-items:center;gap:' + GAP + 'px;pointer-events:none;transition:transform .34s ' + EASE + ',bottom .3s ' + EASE + '}',
      '.root.on .row{display:flex}',
      '.root.gone .row{transform:translateY(calc(100% + 8px + ' + LIFT_CSS + '))}',
      '.root.small .row{justify-content:space-between}',
      // THE MATERIAL (material()): one blur, a milky plate, or a near-solid tint
      '.g{pointer-events:auto;box-sizing:border-box;border:1px solid rgba(255,255,255,0.14);',
      '  box-shadow:0 8px 28px rgba(0,0,0,0.30),inset 0 1px 0 rgba(255,255,255,0.10)}',
      '.blur .g{background:linear-gradient(145deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04)),rgba(28,28,32,0.52);',
      '  -webkit-backdrop-filter:blur(24px) saturate(1.6);backdrop-filter:blur(24px) saturate(1.6)}',
      '.frosted .g{background:rgba(62,64,74,0.95)}',
      '.tinted .g{background:rgba(24,24,28,0.93)}',
      // THE PILL
      // TAB_GAP between tabs: two highlights side by side (the page you are
      // on, the one under the pointer) never touch
      '.pill{position:relative;display:flex;align-items:stretch;gap:var(--g);height:var(--bh);padding:calc(var(--g) - 1px);',
      '  border-radius:calc(var(--bh) / 2);width:var(--pill-w,auto);max-width:100%;overflow:hidden;',
      '  transition:width .34s ' + EASE + '}',
      '.tab{position:relative;z-index:0;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;',
      // 10 px in from each side: the capsule's round ends curve ~9 px in at
      // the label's foot, so a long name's ellipsis stays inside it
      '  border:0;margin:0;padding:0 10px;border-radius:calc(var(--bh) / 2 - var(--g) + 1px);background:none;color:rgba(255,255,255,0.94);',
      '  font:inherit;font-size:var(--tf);font-weight:600;letter-spacing:0;cursor:pointer;transition:background-color .2s ease,opacity .2s ease}',
      '.tab hk-icon{--mdc-icon-size:var(--ti);width:var(--ti);height:var(--ti);display:flex}',
      '.tab span{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE PAGE YOU ARE ON: its capsule reaches WIDEN px past the tab on each
      // side, into the gaps, as Apple Music's does -- nothing else ever
      // lights up beside it (no hover), so it has the room. The end tabs
      // reach inward only, staying inside the bar.
      '.tab.here{color:' + window.hkCards.v('accent') + '}',
      '.tab.here::before{content:"";position:absolute;z-index:-1;top:0;bottom:0;left:calc(var(--g) * -1.25);right:calc(var(--g) * -1.25);',
      '  border-radius:inherit;background:rgba(255,255,255,0.16);',
      // IT SLIDES TO THE NEW PAGE (2026-10-09, as iOS's does): slide() starts
      // it where the last page's was (--hx/--hy, --sx/--sy), then lets go --
      // a short spring along the bar, or down the rail
      '  transform-origin:0 0;transform:translate(var(--hx,0px),var(--hy,0px)) scale(var(--sx,1),var(--sy,1));',
      '  transition:transform .46s ' + SPRING + '}',
      '.tab.here.slide-from::before{transition:none}',
      '.cur + .tab.here::before{left:0}',
      '.tab.here:last-child::before{right:0}',
      '.root.tight .tab.here::before{display:none}',
      '.tab:focus-visible,.roomsbtn:focus-visible,.cur:focus-visible,.it:focus-visible{outline:2px solid rgba(255,255,255,0.7);outline-offset:-2px}',
      // FOLDED (shrink): one round button with the current page's icon
      '.cur{display:none;flex:1;align-items:center;justify-content:center;border:0;padding:0;margin:0;background:none;',
      '  color:' + window.hkCards.v('accent') + ';cursor:pointer;border-radius:50%}',
      '.cur hk-icon{--mdc-icon-size:var(--ci);width:var(--ci);height:var(--ci);display:flex}',
      '.root.small .pill{width:calc(var(--bh) - 6px);height:calc(var(--bh) - 6px);border-radius:50%}',
      '.root.small .tab{display:none}',
      '.root.small .cur{display:flex}',
      // THE ROOMS BUTTON
      '.roomsbtn{flex:none;width:var(--bh);height:var(--bh);border-radius:50%;display:none;align-items:center;',
      '  justify-content:center;padding:0;margin:0;color:rgba(255,255,255,0.94);cursor:pointer;',
      '  transition:width .34s ' + EASE + ',height .34s ' + EASE + '}',
      '.root.hasrooms .roomsbtn{display:flex}',
      '.roomsbtn hk-icon{--mdc-icon-size:var(--ci);width:var(--ci);height:var(--ci);display:flex}',
      '.roomsbtn.here,.roomsbtn[aria-expanded="true"]{color:' + window.hkCards.v('accent') + '}',
      '.root.small .roomsbtn{width:calc(var(--bh) - 6px);height:calc(var(--bh) - 6px)}',
      '.tab:active,.roomsbtn:active,.cur:active{filter:brightness(1.25)}',
      // THE SHEETS (More, Rooms): above the bar, the page still showing
      '.scrim{position:fixed;inset:0;display:none;pointer-events:auto}',
      '.root.sheeted .scrim{display:block}',
      '.sheet{position:fixed;left:calc(var(--hk-content-left,0px) + var(--hk-pane-l,0px) + ' + GUTTER + 'px);right:calc(' + GUTTER + 'px + var(--hk-pane-r,0px));margin:0 auto;',
      '  bottom:calc(var(--bh) + 10px + ' + LIFT_CSS + ');max-width:var(--sheet-w,860px);box-sizing:border-box;',
      // ...as tall as it needs, but always leaving TOP_GAP of the page above
      // it to tap out on
      '  max-height:calc(var(--hk-vh,100dvh) - var(--bh) - ' + (10 + TOP_GAP) + 'px - ' + LIFT_CSS + ' - env(safe-area-inset-top,0px));',
      '  display:flex;flex-direction:column;overflow:hidden;',
      '  border-radius:28px;padding:16px 12px 0;opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;',
      '  transition:opacity .22s ease,transform .3s ' + EASE + ',visibility 0s linear .3s;visibility:hidden}',
      // ONLY THE LIST SCROLLS, in a frame with the sheet's shadows at both
      // ends (hk-base.js edgeCss); the title stays
      '.body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
      '  scrollbar-width:none;padding:2px 0 16px}',
      '.body::-webkit-scrollbar{display:none}',
      '.sheet.open{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .22s ease,transform .3s ' + EASE + '}',
      // THE BAR GROWS INTO MORE (2026-10-06): with no Rooms button the bar and
      // More are one piece -- the bar widens to More's width and squares its
      // top, More stands on it and is uncovered upward from it (a clip, so
      // nothing is laid out again per frame), its content fading in after
      '.root.joined .sheet{bottom:calc(var(--bh) - 1px + ' + LIFT_CSS + ');border-radius:28px 28px 0 0;border-bottom:0;',
      // THE CLIP CARRIES THE SHEET'S ROUND CORNERS: a plain inset() is a
      // square clip, and Chrome then draws the frosted backdrop to its square
      // corners, outside the border-radius (2026-10-06)
      '  opacity:1;transform:none;clip-path:inset(100% var(--bar-gap,0px) 0 var(--bar-gap,0px) round 28px 28px 0 0);',
      '  transition:clip-path .4s ' + EASE + ',visibility 0s linear .4s}',
      '.root.joined .sheet.open{clip-path:inset(0 0 0 0 round 28px 28px 0 0);transition:clip-path .42s ' + EASE + '}',
      // the content is there from the start, uncovered as the shape opens
      // (a fade after the clip read as an empty slab, then a pop-in)
      '.root.joined.sheeted .pill{border-radius:0 0 calc(var(--bh) / 2) calc(var(--bh) / 2);border-top-color:transparent;',
      '  box-shadow:0 12px 24px -8px rgba(0,0,0,0.30)}',
      '.root.joined .pill{transition:width .42s ' + EASE + ',border-radius .3s ' + EASE + '}',
      '.root.joined.sheeted .pill{width:var(--pill-open-w,var(--pill-w,auto))}',
      // the More sheet: the overlay surface (hkCards.OVER), under a heavier blur than the bar
      '.blur .sheet.g{background:linear-gradient(145deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03)),rgba(28,28,32,0.52);',
      '  -webkit-backdrop-filter:blur(34px) saturate(1.9);backdrop-filter:blur(34px) saturate(1.9)}',  // hkCards.BLUR.heavy
      '.sheet h2{flex:none;margin:0 6px 12px;font-size:17px;font-weight:700;letter-spacing:-0.41px;color:' + window.hkCards.v('ink') + '}',
      // THE BIG GRID (2026-10-06): cells at least 84 px -- three across on a
      // phone, six on a computer -- big icons, and names on up to two lines
      // instead of cut off
      '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;align-content:start}',
      // the Rooms section in More, headed as the menu heads its sections
      '.sheet h3{margin:22px 6px 12px;font-size:15px;font-weight:600;letter-spacing:-0.24px;color:' + window.hkCards.v('ink-2') + '}',
      '.sheet h3[hidden],.grid[hidden]{display:none}',
      // MORE: the icon and its name, no plate (the Home Screen's look)
      '.it{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;min-width:0;min-height:104px;',
      '  box-sizing:border-box;padding:12px 4px 10px;border:0;margin:0;border-radius:22px;background:none;',
      '  color:' + window.hkCards.v('ink') + ';font:inherit;font-size:12px;font-weight:600;letter-spacing:-0.08px;',
      '  text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease}',
      // (the icons in the menu's own color -- Automatic's orange; only the
      // page you're on takes its page's: the side menu's rule. The user,
      // 2026-10-17: Climate turned every room and page blue.)
      '.it hk-icon{--mdc-icon-size:40px;width:40px;height:40px;flex:none;display:flex;color:var(--hk-accent-base,' + window.hkCards.v('accent') + ')}',
      '.it.here hk-icon{color:' + window.hkCards.v('accent') + '}',
      '.it span{max-width:100%;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
      '  overflow-wrap:anywhere}',
      // THE PAGE YOU ARE ON keeps a plate round its icon and name, as the
      // tab bar's capsule does; nothing lights up under the pointer
      '.it.here{background:rgba(255,255,255,0.16)}',
      '.it.here span{color:' + window.hkCards.v('accent') + '}',
      // ROOMS ON THEIR OWN SHEET (the Rooms button): each icon in a soft round
      // plate (Control Center's look). In More they look like its pages.
      '[data-sheet="rooms"] .roomgrid .it hk-icon{--mdc-icon-size:28px;width:58px;height:58px;border-radius:50%;',
      '  align-items:center;justify-content:center;background:rgba(255,255,255,0.12);transition:background-color .15s ease}',
      '[data-sheet="rooms"] .roomgrid .it.here hk-icon{background:' + window.hkCards.v('accent') + ';color:var(--hk-on-accent,#fff)}',
      // THE LIST (More Style: List): rows like the side menu's -- the icon
      // beside the whole name, the page you are on in the highlight colour --
      // and about a phone's width on every screen
      '.sheet.list .grid{grid-template-columns:1fr;gap:2px}',
      '.sheet.list .it{flex-direction:row;justify-content:flex-start;gap:14px;min-height:44px;padding:0 14px;border-radius:12px;',
      '  font-size:17px;font-weight:400;letter-spacing:-0.41px;text-align:left}',
      '.sheet.list .it hk-icon{--mdc-icon-size:22px;width:22px;height:22px}',
      '.sheet.list .it span{display:block;flex:1;min-width:0;white-space:nowrap;text-overflow:ellipsis}',
      '.sheet.list .it.here{background:' + window.hkCards.v('accent') + ';color:var(--hk-on-accent,#fff)}',
      '.sheet.list .it.here span,.sheet.list .it.here hk-icon{color:var(--hk-on-accent,#fff)}',
      '.sheet.list .roomgrid .it hk-icon{width:22px;height:22px;background:none;--mdc-icon-size:22px}',
      '.it:active{filter:brightness(1.25)}',
      // ---- TAB BAR POSITION: TOP. The bottom's mirror: More hangs from the
      // bar, the bar hides upward
      ':host([data-pos="top"]) .row{top:' + TOP_CSS + ';bottom:auto}',
      ':host([data-pos="top"]) .root.gone .row{transform:translateY(calc(-100% - 8px - ' + TOP_CSS + '))}',
      ':host([data-pos="top"]) .sheet{top:calc(var(--bh) + 10px + ' + TOP_CSS + ');bottom:auto;transform:translateY(-16px) scale(.98);',
      '  max-height:calc(var(--hk-vh,100dvh) - var(--bh) - ' + (10 + TOP_GAP) + 'px - ' + TOP_CSS + ' - env(safe-area-inset-bottom,0px))}',
      ':host([data-pos="top"]) .sheet.open{transform:none}',
      ':host([data-pos="top"]) .root.joined .sheet{top:calc(var(--bh) - 1px + ' + TOP_CSS + ');border-radius:0 0 28px 28px;',
      '  border-bottom:1px solid rgba(255,255,255,0.14);border-top:0;transform:none;clip-path:inset(0 var(--bar-gap,0px) 100% var(--bar-gap,0px) round 0 0 28px 28px)}',
      ':host([data-pos="top"]) .root.joined .sheet.open{clip-path:inset(0 0 0 0 round 0 0 28px 28px)}',
      ':host([data-pos="top"]) .root.joined.sheeted .pill{border-radius:calc(var(--bh) / 2) calc(var(--bh) / 2) 0 0;',
      '  border-top-color:rgba(255,255,255,0.14);border-bottom-color:transparent;box-shadow:0 -6px 20px -8px rgba(0,0,0,0.25)}',
      // ---- LEFT / RIGHT: A RAIL the screen's height; the tabs stacked, icon
      // over name; More slides out sideways from it, as one piece
      // (its foot ends above the docked now-playing bar, which runs the
      // screen's whole width under it: hk-popup.js --hk-dock-h)
      ':host([data-pos="left"]) .row,:host([data-pos="right"]) .row{top:' + GUTTER + 'px;bottom:calc(' + GUTTER + 'px + var(--hk-dock-h, 0px));width:var(--bh);',
      '  flex-direction:column;justify-content:center;transform:none}',
      ':host([data-pos="left"]) .row{left:calc(var(--hk-content-left,0px) + var(--hk-pane-l,0px) + ' + GUTTER + 'px);right:auto}',
      ':host([data-pos="right"]) .row{right:calc(' + GUTTER + 'px + var(--hk-pane-r,0px));left:auto}',
      // the pill hugs its tabs by top/bottom insets in its full-height column
      // (--rail-gap), and opening More takes them to 0: More and the rail
      // share one box exactly (a percentage height left Safari 4 px short)
      ':host([data-pos="left"]) .pill,:host([data-pos="right"]) .pill{position:absolute;left:0;right:0;top:var(--rail-gap,0px);',
      '  bottom:var(--rail-gap,0px);width:auto;height:auto;max-width:none;flex-direction:column;',
      '  justify-content:center;gap:calc(var(--g) * 1.5);border-radius:calc(var(--bh) / 2);padding:calc(var(--g) * 2.5) calc(var(--g) + 1px)}',
      // the highlight follows the rail's round ends: a capsule, its radius the
      // rail's less its 5 px inset (a bar's was the bar's, not the rail's)
      ':host([data-pos="left"]) .tab,:host([data-pos="right"]) .tab{flex:0 0 calc(var(--bh) - ' + (RAIL_W - RAIL_TAB) + 'px);width:100%;padding:0 4px;',
      '  border-radius:calc(var(--bh) / 2 - var(--g) - 1px)}',
      // opening More stretches the rail to More's full height, as one piece
      ':host([data-pos="left"]) .root.joined.sheeted .pill,:host([data-pos="right"]) .root.joined.sheeted .pill{top:0;bottom:0}',
      ':host([data-pos="left"]) .tab span,:host([data-pos="right"]) .tab span{white-space:normal;text-align:center;line-height:1.15;',
      '  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      // ...and the page you are on: a VERTICAL pill, as the bar's is a
      // horizontal one -- taller than wide, its ends fully round
      // the bar's own rule, turned upright: the pill keeps the SAME gap from
      // the rail's edge all round -- 4 px, as the bar's capsule keeps from the
      // bar's (its border and 3 px) -- reaching into the gaps between tabs,
      // and at the ends only inward (measured: -6 leaves 4)
      ':host([data-pos="left"]) .tab.here::before,:host([data-pos="right"]) .tab.here::before{left:-2px;right:-2px;top:calc(var(--g) * -2);bottom:calc(var(--g) * -2);border-radius:38px}',
      ':host([data-pos="left"]) .cur + .tab.here::before,:host([data-pos="right"]) .cur + .tab.here::before{top:calc(var(--g) * -1.5)}',
      ':host([data-pos="left"]) .tab.here:last-child::before,:host([data-pos="right"]) .tab.here:last-child::before{bottom:calc(var(--g) * -1.5)}',
      ':host([data-pos="left"]) .roomsbtn,:host([data-pos="right"]) .roomsbtn{display:none}',
      // (More, beside the rail, ends where the rail does: above the docked bar)
      ':host([data-pos="left"]) .sheet,:host([data-pos="right"]) .sheet{top:' + GUTTER + 'px;bottom:calc(' + GUTTER + 'px + var(--hk-dock-h, 0px));max-height:none;',
      '  width:var(--sheet-w,640px);max-width:none;margin:0;border-bottom:1px solid rgba(255,255,255,0.14);transform:none}',
      ':host([data-pos="left"]) .root.joined .sheet{left:calc(var(--hk-content-left,0px) + var(--hk-pane-l,0px) + var(--bh) + ' + (GUTTER - 1) + 'px);right:auto;',
      '  border-radius:0 28px 28px 0;border-left:0;clip-path:inset(var(--rail-gap,0px) 100% var(--rail-gap,0px) 0 round 0 28px 28px 0)}',
      ':host([data-pos="right"]) .root.joined .sheet{right:calc(var(--bh) + var(--hk-pane-r,0px) + ' + (GUTTER - 1) + 'px);left:auto;',
      '  border-radius:28px 0 0 28px;border-right:0;clip-path:inset(var(--rail-gap,0px) 0 var(--rail-gap,0px) 100% round 28px 0 0 28px)}',
      ':host([data-pos="left"]) .root.joined .sheet.open{clip-path:inset(0 0 0 0 round 0 28px 28px 0)}',
      ':host([data-pos="right"]) .root.joined .sheet.open{clip-path:inset(0 0 0 0 round 28px 0 0 28px)}',
      ':host([data-pos="left"]) .root.joined.sheeted .pill{border-radius:calc(var(--bh) / 2) 0 0 calc(var(--bh) / 2);',
      '  border-top-color:rgba(255,255,255,0.14);border-right-color:transparent}',
      ':host([data-pos="right"]) .root.joined.sheeted .pill{border-radius:0 calc(var(--bh) / 2) calc(var(--bh) / 2) 0;',
      '  border-top-color:rgba(255,255,255,0.14);border-left-color:transparent}',
      // ---- SHRINKS TO (tab_bar_fold): the small button at the bar's end --
      // a bar's right (the Rooms button, if any, swaps to the left), a
      // rail's bottom; its start (left / top) otherwise
      '.root.small.fold-end .row{flex-direction:row-reverse}',
      // a RAIL folds too: the small button at its top or bottom, centred in
      // the rail's column; Hide slides it off its own side
      ':host([data-pos="left"]) .root.small .row,:host([data-pos="right"]) .root.small .row{justify-content:flex-start;align-items:center}',
      ':host([data-pos="left"]) .root.small.fold-end .row,:host([data-pos="right"]) .root.small.fold-end .row{flex-direction:column;justify-content:flex-end}',
      ':host([data-pos="left"]) .root.small .pill,:host([data-pos="right"]) .root.small .pill{left:3px;right:3px;top:0;',
      '  bottom:calc(100% - var(--bh) + 6px);width:auto;height:auto;',
      '  padding:calc(var(--g) - 1px);border-radius:50%}',
      ':host([data-pos="left"]) .root.small.fold-end .pill,:host([data-pos="right"]) .root.small.fold-end .pill{top:calc(100% - var(--bh) + 6px);bottom:0}',
      ':host([data-pos="left"]) .pill,:host([data-pos="right"]) .pill{transition:top .42s ' + EASE + ',bottom .42s ' + EASE + ',left .34s ' + EASE + ',right .34s ' + EASE + ',border-radius .3s ' + EASE + '}',
      ':host([data-pos="left"]) .root.gone .row{transform:translateX(calc(-100% - ' + (GUTTER + 8) + 'px - var(--hk-content-left,0px) - var(--hk-pane-l,0px)))}',
      ':host([data-pos="right"]) .root.gone .row{transform:translateX(calc(100% + ' + (GUTTER + 8) + 'px + var(--hk-pane-r,0px)))}',
      ':host([data-pos="left"]) .row,:host([data-pos="right"]) .row{transition:transform .34s ' + EASE + '}',
      '@media (prefers-reduced-motion:reduce){.row,.pill,.roomsbtn,.sheet,.tab.here::before{transition:none}}',
      // ICONS ONLY: no names, on the bar and the rail alike
      ':host([data-icons]) .tab span{display:none}'
    ].join('\n');
    window.hkTabBar._.CSS = CSS;             // tests (test_csssnapshot)
    // EDIT MODE (hk-edit-menu.js): a tab or a page in More carried, where it
    // would land, and the page's ghost
    var EDIT_CSS = [
      '.root.editing .tab[data-p]{touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}',
      '.root.editing .tab[data-p].lifted{z-index:3;filter:brightness(1.35);transition:none!important}',
      '.root.editing .it[data-p]{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}',
      '.root.editing .it.lifted{opacity:.35}',
      '.root.editing .it.hk-drop{box-shadow:inset 0 0 0 2px ' + window.hkCards.v('accent') + '}',
      '.root.editing .tab[data-t="more"].hk-drop{background:rgba(255,255,255,0.22)}',
      '.pill.hk-drop{box-shadow:0 0 0 2px ' + window.hkCards.v('accent') + '}',
      '.hk-ghost{position:fixed;z-index:20;display:flex;align-items:center;gap:8px;padding:9px 14px 9px 10px;border-radius:22px;',
      '  pointer-events:none;background:' + window.hkCards.OVER.solid + ';color:#fff;font:600 15px/20px -apple-system,BlinkMacSystemFont,sans-serif;',
      '  box-shadow:0 12px 32px rgba(0,0,0,0.45);white-space:nowrap}',
      '.hk-ghost hk-icon{--mdc-icon-size:22px;width:22px;height:22px;display:flex;color:' + window.hkCards.v('accent') + '}'
    ].join('\n');

    var MORE_ICON = 'mdi:dots-horizontal', ROOMS_ICON = 'mdi:view-grid';

    var S = { host: null, root: null, on: false, mode: 'full', down: 0, up: 0, sheet: null, built: '', ha: [], haPrefs: undefined,
              tabs: [], more: [], hostRows: [], rooms: [], last: new WeakMap(), view: null, viewPad: null };

    function haRoot() { return SH.overlayRoot(); }
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function icon(i) { return esc(H.glyph(i)); }

    function mount() {
      if (S.host && S.host.isConnected) return true;
      var r = haRoot();
      if (!r) return false;
      S.host = document.createElement('div');
      S.host.id = 'hk-tabbar';
      var sr = S.host.attachShadow({ mode: 'open' });
      C.flatSurface(S.host, 'navigation');
      sr.innerHTML = '<style>' + CSS + EDIT_CSS + C.flatCss() + (C.edgeCss ? C.edgeCss() : '') +
        ':host([hk-flat]) .g{background:var(--hk-flat-elevated)!important;box-shadow:var(--hk-flat-elevated-shadow);border-color:var(--hk-line)}' +
        ':host([hk-flat]) .tab,:host([hk-flat]) .roomsbtn,:host([hk-flat]) .it{color:var(--hk-ink-2)}' +
        ':host([hk-flat]) .tab.here,:host([hk-flat]) .roomsbtn.here{color:var(--hk-accent)}' +
        ':host([hk-flat]) .tab.here::before{background:color-mix(in srgb,var(--hk-accent) 12%,var(--hk-flat-elevated));transform:none}' +
        '</style>' +
        '<div class="root">' +
          '<div class="scrim"></div>' +
          '<section class="sheet g" data-sheet="more" aria-label="More"><h2>More</h2><div class="hk-edge"><div class="body">' +
            '<div class="grid pages"></div><h3 class="ch" hidden>Categories</h3><div class="grid pages2" hidden></div>' +
            '<h3 class="hh" hidden>Home Assistant</h3><div class="grid hagrid" hidden></div>' +
            '<h3 class="rh" hidden>Rooms</h3><div class="grid roomgrid" hidden></div>' +
            '<h3 class="mh" hidden></h3><div class="grid mgrid" hidden></div>' +
            '<h3 class="eh" hidden>This Page</h3><div class="grid egrid" hidden></div></div></div></section>' +
          '<section class="sheet g" data-sheet="rooms" aria-label="Rooms"><h2>Rooms</h2><div class="hk-edge"><div class="body">' +
            '<div class="grid roomgrid"></div></div></div></section>' +
          '<div class="row">' +
            '<nav class="pill g" aria-label="Tab Bar"><button class="cur" aria-label="Show the tab bar"><hk-icon></hk-icon></button></nav>' +
            '<button class="roomsbtn g" aria-label="Rooms" aria-expanded="false"><hk-icon icon="' + icon(ROOMS_ICON) + '"></hk-icon></button>' +
          '</div>' +
        '</div>';
      S.root = sr.querySelector('.root');
      if (C.edges) C.edges(sr);
      S.pill = sr.querySelector('.pill'); S.tabHtml = null;
      S.cur = sr.querySelector('.cur');
      S.roomsBtn = sr.querySelector('.roomsbtn');
      S.sheets = { more: sr.querySelector('[data-sheet="more"]'), rooms: sr.querySelector('[data-sheet="rooms"]') };
      // a sheet slid, the bar hid or the pill grew: pinned glass cut again
      S.root.addEventListener('transitionend', function () { if (window.hkGlass && window.hkGlass.repin) window.hkGlass.repin(); });
      sr.querySelector('.scrim').addEventListener('click', function () { closeSheet(); });
      S.cur.addEventListener('click', function (e) { e.stopPropagation(); setMode('full'); });
      S.roomsBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleSheet('rooms'); });
      S.pill.addEventListener('click', onTab);
      Object.keys(S.sheets).forEach(function (k) { S.sheets[k].addEventListener('click', onSheet); });
      r.appendChild(S.host);
      return true;
    }

    // WITH A PICTURE OF THE SKY (Blur Mode Pre-rendered, hk-glass.js
    // PINNED) a blurred bar, its rooms button and its sheets wear their slice
    // of it under their own tints instead of blurring the moving sky live
    var BAR_TINT = 'linear-gradient(145deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04)),linear-gradient(rgba(28,28,32,0.52),rgba(28,28,32,0.52))';
    var SHEET_TINT = 'linear-gradient(145deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03)),linear-gradient(rgba(28,28,32,0.52),rgba(28,28,32,0.52))';
    function pinGlass(on) {
      var G = window.hkGlass;
      if (!G || !G.pin) return;
      [[S.pill, BAR_TINT], [S.roomsBtn, BAR_TINT], [S.sheets && S.sheets.more, SHEET_TINT], [S.sheets && S.sheets.rooms, SHEET_TINT]].forEach(function (p) {
        if (p[0]) { if (on) G.pin(p[0], p[1]); else G.unpin(p[0]); }
      });
    }

    // ------------------------------------------------------- when it shows
    function editing() {
      var p = M.panel();
      return !!(p && p.lovelace && p.lovelace.editMode);
    }
    // hk-base.js decides (menu.tabBar): the screen's Menu is Tab Bar, or its
    // narrow choice is and the side menu would fold here
    function wanted() {
      if (typeof M.tabBar !== 'function' || !M.tabBar()) return false;
      return !!M.config() && !editing();
    }

    // ---------------------------------------------------------- the list
    function model() {
      var cfg = M.config(), h = C.client(), b = M.board();
      return H.model(cfg, h && h.areas, { dash: M.dash(), order: b.menu_rooms === 'order' ? 'order' : 'az',
                                          roomOrder: b.room_order, user: h && h.user && h.user.id,
                                          categories: b.categories, top: b.menu_top, chips: b.chips,
                                          chipsRow: b.chips_row, pageOrder: H.pagePaths(b.pages, b.custom_pages),
                                          ha: false });
    }
    var CFGS = new WeakMap(), CFGN = 0;
    function cfgId(cfg) {
      if (!cfg || typeof cfg !== 'object') return 0;
      if (!CFGS.has(cfg)) CFGS.set(cfg, ++CFGN);
      return CFGS.get(cfg);
    }
    // THE RAIL'S HEIGHT: the window's, less the docked now-playing bar it
    // ends above (hk-popup.js --hk-dock-h) -- what its tabs must fit in, or
    // its ends run past the rail as the bar comes up (2026-10-10)
    function railH() {
      var d = 0;
      try { d = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hk-dock-h')) || 0; } catch (e) { d = 0; }
      return Math.max(0, (window.innerHeight || 800) - d);
    }
    function listKey(width) {
      var h = C.client(), side = H.sidebarSource(), b = M.board();
      return [M.dash(), cfgId(M.config()), width, railH(), b.ha_place, b.tab_bar_pos, b.tab_bar_rooms, b.tab_bar_rooms_phone, phoneAt(), phoneSet(), b.tab_bar_more, b.tab_bar_more_phone, b.tab_bar_size, b.tab_bar_labels, b.tab_bar_tabs, b.tab_bar_tabs_rail, b.tab_bar_tabs_phone, b.ha_row, JSON.stringify(S.haPrefs || null),
              h && h.user && h.user.is_admin, H.hostItems().map(function (x) { return x.title + x.href; }).join(','),
              H.editKey ? H.editKey(h) : '', arranging() ? 'ed' : '', !!(window.hkEdit && window.hkEdit.editAny && window.hkEdit.editAny(h)), side && side.panels ? Object.keys(side.panels).join(',') : '', H.haKey ? H.haKey() : '', b.menu_rooms, JSON.stringify(b.room_order),
              JSON.stringify(b.categories), JSON.stringify(b.menu_top || []), JSON.stringify(b.pages || []),
              JSON.stringify(b.chips || []), b.chips_row, h && h.user && h.user.id,
              JSON.stringify(h && h.areas ? Object.keys(h.areas).map(function (k) {
                return k + ':' + h.areas[k].name + ':' + (h.areas[k].icon || '');
              }) : [])].join('|');
    }
    function build() {
      var b = M.board(), m = model();
      var width = (window.innerWidth || 0) - leftOf() - paneR();
      // a phone, by its screen as well as its width: a phone held
      // sideways keeps a phone's bar and fit -- and its rail, when the
      // screen puts the bar at a side (position: by the width)
      var ph = phoneAt();
      var pos = position(b.tab_bar_pos, window.innerWidth || 1280, ph), rail = pos === 'left' || pos === 'right';
      var rm = m.rooms.length ? roomsOf(b) : 'off';
      if (rail && rm === 'button') rm = 'more';      // a rail has no room for a second button
      var roomsOn = rm === 'button';
      // THE HOME ASSISTANT SECTION, between the pages and the rooms (the
      // screen's Menu -> Home Assistant
      // Section), the side menu's own list (hkMenu._.haItems) as it shows
      // folded: Integrations, Automations, Settings, Notifications, Show
      // Menu (Home Assistant's whole sidebar, for the rest) and Profile
      // the host's sidebar (hkShell.sidebarData(), through hkMenu._.sidebarSource)
      S.ha = b.ha_row ? (H.haList ? H.haList(S.haPrefs, { moreOpen: false, sidebarShown: false }) : [])
        .filter(function (it) { return it.kind !== 'more'; }) : [];
      if (b.ha_row && S.haPrefs === undefined) loadPrefs();
      // THE HOST'S OWN PAGES (a host's settings; none in Home Assistant): the side menu's host section
      // (hkMenu._.hostItems), at the end of More, under the host's own name for it
      S.hostRows = H.hostItems ? H.hostItems() : [];
      // EDIT PAGE (hk-edit.js): More's last row, on a page with something to
      // arrange. More itself is there for an editor on EVERY page
      // (hkEdit.editAny), so the bar's tabs do not change from page to page.
      S.edit = H.editItems ? H.editItems(C.client()) : [];
      var mayEdit = !!(window.hkEdit && window.hkEdit.editAny && window.hkEdit.editAny(C.client()));
      var tabs = [m.home].concat(m.categories).filter(Boolean);
      var sz = b.tab_bar_size;
      var more0 = rm === 'more' || S.ha.length > 0 || S.hostRows.length > 0 || mayEdit;
      var f = rail ? railFit(tabs.length, m.top.length, railH(), more0, b.tab_bar_tabs_rail, sz)
                   : fit(tabs.length, m.top.length, width, roomsOn, more0, b.tab_bar_tabs, sz, ph, b.tab_bar_tabs_phone);
      S.pos = pos;
      if (S.posWas !== pos && S.mode !== 'full') setMode('full');
      S.posWas = pos;
      // Start Small switched on or off (or first drawn): rest there
      var r = rest();
      if (S.restWas !== r) { S.restWas = r; setMode(r); }
      var p = parts(m, f);
      S.tabs = p.tabs; S.more = p.more; S.rooms = rm === 'off' ? [] : p.rooms; S.roomsMode = rm;
      var html = '', ed = arranging();
      S.editing = ed;
      p.tabs.forEach(function (it, i) {
        // (its name as its label too: Icons Only hides the name it shows;
        // in Edit mode a page's tab says which page it is, to be dragged)
        html += '<button class="tab" data-t="' + i + '"' + (ed && i > 0 ? ' data-p="' + esc(viewPath(it)) + '"' : '') +
          ' aria-label="' + esc(it.title) + '"><hk-icon icon="' + icon(it.icon) + '"></hk-icon><span>' +
          esc(it.title) + '</span></button>';
      });
      if (f.more) {
        html += '<button class="tab" data-t="more" aria-label="More" aria-expanded="false"><hk-icon icon="' + icon(MORE_ICON) +
          '"></hk-icon><span>More</span></button>';
      }
      // THE SAME TABS ARE KEPT, not drawn again: a module arriving on a new
      // page (hk-module-ready) asks for a rebuild, and new buttons would cut
      // the highlight's slide short and flash the icons (2026-10-09)
      if (html !== S.tabHtml) {
        S.pill.querySelectorAll('.tab').forEach(function (x) { x.remove(); });
        S.pill.insertAdjacentHTML('beforeend', html);
        S.tabHtml = html;
      }
      // ONE WIDTH FOR THE BAR AND MORE (joined, no Rooms button): the wider
      // of the two -- More's (860 px of icons, 420 of list) or what the tabs
      // need -- within the screen, so opening More never widens anything
      // More Style: a phone's own, else the tablet's (moreOf)
      var list = moreOf(b) === 'list', sheetW = list ? 420 : 860;
      var joinW = Math.min(Math.max(0, width - 2 * GUTTER), Math.max(f.width, sheetW));
      // a rail's More slides out beside it: 380 px as a list, 640 as icons
      if (rail) joinW = Math.min(Math.max(0, width - 2 * GUTTER - railW(sz) - 16), list ? 380 : 640);
      // HUG AND GROW (2026-10-06): at rest the bar is as wide as its tabs (a
      // rail as tall as them); opening More grows it to More's size in the
      // same motion, so they meet as one shape
      S.pill.style.setProperty('--pill-w', f.width + 'px');
      // (a rail grows in height only: it keeps its own width)
      S.pill.style.setProperty('--pill-open-w', (rail ? railW(sz) : roomsOn ? f.width : joinW) + 'px');
      // ONE SHAPE GROWING: More's clip starts exactly where the bar is --
      // a bar's width inside More's (--bar-gap each side), a rail's height
      // inside the screen's (--rail-gap above and below) -- and opens with it
      // (not rounded: the rail is exactly its tabs and gaps tall, so the
      // highlight's gap at its ends is the same as at its sides)
      var railGap = rail && f.height ? Math.max(0, (railH() - 2 * GUTTER - f.height) / 2) : 0;
      var barGap = !rail && !roomsOn ? Math.max(0, Math.round((joinW - f.width) / 2)) : 0;
      S.host.style.setProperty('--rail-gap', railGap + 'px');
      S.host.style.setProperty('--bar-gap', barGap + 'px');
      S.root.classList.toggle('hasrooms', roomsOn);
      S.tight = !f.plate;
      // the pages: one grid, or -- the Home Assistant section placed above
      // Categories -- the top pages, then the section, then the rest
      var place = b.ha_place || 'rooms', split = place === 'categories' && S.ha.length && f.more ? (m.top || []).length : -1;
      var pg = S.sheets.more.querySelector('.pages'), pg2 = S.sheets.more.querySelector('.pages2');
      fill(pg, split >= 0 ? S.more.slice(0, split) : S.more, 'p');
      fill(pg2, split >= 0 ? S.more.slice(split) : [], 'p', split >= 0 ? split : 0);
      pg2.hidden = split < 0 || !S.more.slice(split).length;
      var ch = S.sheets.more.querySelector('.ch');
      ch.hidden = pg2.hidden;          // after the section, the rest headed as the side menu heads them
      var mr = S.sheets.more.querySelector('.roomgrid');
      fill(mr, rm === 'more' ? S.rooms : [], 'r');
      mr.hidden = S.sheets.more.querySelector('.rh').hidden = rm !== 'more';
      // only rooms in More: no heading
      if (rm === 'more' && !S.more.length && !S.ha.length) S.sheets.more.querySelector('.rh').hidden = true;
      pg.hidden = split >= 0 ? !split : !S.more.length;
      fill(S.sheets.rooms.querySelector('.roomgrid'), rm === 'button' ? S.rooms : [], 'r');
      var hg = S.sheets.more.querySelector('.hagrid');
      fill(hg, S.ha, 'h');
      hg.hidden = S.sheets.more.querySelector('.hh').hidden = !S.ha.length;
      var mg = S.sheets.more.querySelector('.mgrid'), mh = S.sheets.more.querySelector('.mh');
      fill(mg, S.hostRows, 'm');
      mh.textContent = S.hostRows.length ? S.hostRows[0].section || 'More' : '';
      mg.hidden = mh.hidden = !S.hostRows.length;
      var eg = S.sheets.more.querySelector('.egrid'), eh = S.sheets.more.querySelector('.eh');
      fill(eg, S.edit, 'e');
      eg.hidden = eh.hidden = !S.edit.length;
      // ...and the section where the screen puts it
      var body = S.sheets.more.querySelector('.body'), hh = S.sheets.more.querySelector('.hh');
      var rh = S.sheets.more.querySelector('.rh'), rg = S.sheets.more.querySelector('.roomgrid');
      var order = place === 'top' ? [hh, hg, pg, ch, pg2, rh, rg] : place === 'categories' ? [pg, hh, hg, ch, pg2, rh, rg]
        : place === 'bottom' ? [pg, ch, pg2, rh, rg, hh, hg] : [pg, ch, pg2, hh, hg, rh, rg];
      order.concat([mh, mg, eh, eg]).forEach(function (el) { body.appendChild(el); });
      // More Style: the list, about a phone's width; the icons, wide -- and
      // joined, exactly the bar's width
      Object.keys(S.sheets).forEach(function (k) {
        S.sheets[k].classList.toggle('list', list);
        S.sheets[k].style.setProperty('--sheet-w', (roomsOn ? sheetW : joinW) + 'px');
      });
      S.built = listKey(width);
      // EDIT MODE: the tabs and More's pages and rooms drag (hk-edit-menu.js)
      if (ed) {
        window.hkEditMenu.wireBar({ pill: S.pill, sheet: S.sheets.more, roomsSheet: S.sheets.rooms, rail: rail,
                                    visible: Math.max(0, p.tabs.length - 1), root: S.root });
      }
    }
    // HK's Edit mode with the menu's lists (hk-edit-menu.js) -- not Home
    // Assistant's own edit mode (editing(), above)
    function arranging() { return !!(window.hkEditMenu && window.hkEditMenu.on()); }
    function viewPath(it) { var p = it.paths || []; return String(p[1] != null ? p[1] : p[0]); }
    function fill(grid, items, k, at) {
      var ed = arranging() && (k === 'p' || k === 'r');
      grid.innerHTML = items.map(function (it, i) {
        return '<button class="it" data-k="' + k + '" data-i="' + (i + (at || 0)) + '"' +
          (ed ? ' data-p="' + esc(k === 'r' ? it.path : viewPath(it)) + '"' : '') + '><hk-icon icon="' + icon(it.icon) + '"></hk-icon><span>' +
          esc(it.title) + '</span></button>';
      }).join('');
    }
    // the Now Playing pane's width on the right (hk-popup.js, on <html>'s
    // own style); on the left it is in leftOf
    function paneR() {
      var n = parseFloat(document.documentElement.style.getPropertyValue('--hk-pane-r'));
      return n > 0 ? n : 0;
    }
    function leftOf() {
      var pl = parseFloat(document.documentElement.style.getPropertyValue('--hk-pane-l'));
      return leftOf0() + (pl > 0 ? pl : 0);
    }
    function leftOf0() {
      var v = 0;
      try { v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hk-content-left')) || 0; }
      catch (e) { v = 0; }
      if (!v) {
        var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
        v = r ? Math.max(0, r.left) : 0;
      }
      return v;
    }

    // ------------------------------------------------- the current page
    // THE HIGHLIGHT GLIDES from the page you were on to the one you are on:
    // the new tab's capsule starts over the old one's box (relative to the
    // bar, so a re-drawn bar still knows where it was) and eases home. Not
    // while folded, nor where the tabs are too narrow for a capsule.
    function slide(el, from, to) {
      if (!from || !to || from.pos !== to.pos || S.mode !== 'full' || S.tight) return;
      if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1) return;
      el.classList.add('slide-from');
      el.style.setProperty('--hx', (from.x - to.x) + 'px');
      el.style.setProperty('--hy', (from.y - to.y) + 'px');
      el.style.setProperty('--sx', String(from.w / (to.w || 1)));
      el.style.setProperty('--sy', String(from.h / (to.h || 1)));
      void el.offsetWidth;                      // that start, drawn
      el.classList.remove('slide-from');
      ['--hx', '--hy', '--sx', '--sy'].forEach(function (v) { el.style.removeProperty(v); });
    }
    function boxOf(el) {
      var p = S.pill.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height, pos: S.pos };
    }
    function markHere() {
      var path = location.pathname, curIcon = null, hereEl = null;
      S.pill.querySelectorAll('.tab').forEach(function (el) {
        var k = el.getAttribute('data-t');
        var here = k === 'more' ? S.more.concat(S.roomsMode === 'more' ? S.rooms : [])
                                    .some(function (it) { return H.isHere(it, path); })
                                : !!S.tabs[+k] && H.isHere(S.tabs[+k], path);
        el.classList.toggle('here', here);
        if (here) { el.setAttribute('aria-current', 'page'); curIcon = k === 'more' ? MORE_ICON : S.tabs[+k].icon; hereEl = el; }
        else el.removeAttribute('aria-current');
      });
      var box = hereEl && S.on ? boxOf(hereEl) : null;
      if (box && S.hereBox) slide(hereEl, S.hereBox, box);
      S.hereBox = box;
      var inRoom = S.rooms.some(function (it) { return H.isHere(it, path); });
      S.roomsBtn.classList.toggle('here', inRoom && S.roomsMode === 'button');
      Object.keys(S.sheets).forEach(function (k) {
        S.sheets[k].querySelectorAll('.it').forEach(function (el) {
          var it = listOf(el.getAttribute('data-k'))[+el.getAttribute('data-i')];
          el.classList.toggle('here', !!it && H.isHere(it, path));
        });
      });
      // folded, the button shows where you are: the page's tab, More, a
      // room, else Home
      var ci = curIcon || (inRoom ? ROOMS_ICON : (S.tabs[0] && S.tabs[0].icon) || 'mdi:home');
      var ie = S.cur.querySelector('hk-icon'), want = H.glyph(ci);
      if (ie.getAttribute('icon') !== want) ie.setAttribute('icon', want);
    }

    // --------------------------------------------------------- choosing
    function go(it) {
      closeSheet();
      if (!it || H.isHere(it, location.pathname)) return;
      SH.navigate(it.path);
    }
    function onTab(e) {
      var el = e.target.closest && e.target.closest('.tab');
      if (!el) return;
      e.stopPropagation();
      var k = el.getAttribute('data-t');
      if (k === 'more') { toggleSheet('more'); return; }
      // Edit mode: a tab is arranged, never followed
      if (arranging()) return;
      go(S.tabs[+k]);
    }
    function onSheet(e) {
      var el = e.target.closest && e.target.closest('.it');
      if (!el) return;
      var k = el.getAttribute('data-k'), it = listOf(k)[+el.getAttribute('data-i')];
      // Edit mode: More's pages and rooms are arranged; nothing leaves the page
      if (arranging()) return;
      if (k === 'h') haGo(it);
      // (a host row opens a page, or asks the host to do something: hk-menu.js hostItems)
      // Edit Page: More goes, the page goes into Edit mode
      else if (k === 'e') { closeSheet(true); if (window.hkEdit && window.hkEdit.enter) window.hkEdit.enter(C.client()); }
      else if (k === 'm') {
        if (it && it.run) { closeSheet(true); try { it.run(); } catch (x) { /* the host's own */ } }
        else if (it && it.href) { closeSheet(true); location.assign(it.href); }
      }
      else go(it);
    }
    function listOf(k) { return k === 'r' ? S.rooms : k === 'h' ? S.ha : k === 'm' ? S.hostRows : k === 'e' ? (S.edit || []) : S.more; }
    // A HOME ASSISTANT ROW does what the side menu's does (hk-menu.js onList):
    // Show Menu opens Home Assistant's own sidebar over the page,
    // Notifications its drawer, the rest open Home Assistant's page
    function haGo(it) {
      if (!it) return;
      closeSheet(true);
      if (it.kind === 'ha') { if (!SH.openHaMenu() && window.hkMenu && window.hkMenu.openHaSidebar) window.hkMenu.openHaSidebar(); return; }
      if (it.kind === 'notif') { SH.showNotifications(); return; }
      if (it.kind === 'halink') { H.haOpen(it); return; }
      if (!it.path) return;
      try { sessionStorage.setItem('hk-ha-row-used', '1'); } catch (e) { /* private mode */ }
      SH.haNavigate(it.path);
    }
    // this user's Home Assistant sidebar order and hidden pages (More's Home
    // Assistant section follows them, as the side menu's does): read once
    function loadPrefs() {
      S.haPrefs = null;
      var c = C.client();                  // a read: the current client's read path
      if (!c || typeof c.callWS !== 'function') return;
      c.callWS({ type: 'frontend/get_user_data', key: 'sidebar' }).then(function (r) {
        S.haPrefs = (r && r.value) || null;
        S.built = ''; sync();
      }, function () { /* no prefs: Home Assistant's own order */ });
    }
    function toggleSheet(k) { if (S.sheet === k) closeSheet(); else openSheet(k); }
    function openSheet(k) {
      if (!S.sheets[k]) return;
      closeSheet(true);
      S.sheet = k;
      setMode('full');
      sizeSheets();
      S.sheets[k].classList.add('open');
      S.root.classList.add('sheeted');
      var btn = k === 'rooms' ? S.roomsBtn : S.pill.querySelector('[data-t="more"]');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      // the menu and the tab bar never both open
      if (window.hkMenu && typeof window.hkMenu.isOpen === 'function' && window.hkMenu.isOpen()) window.hkMenu.close(true);
    }
    // THE SHEETS' HEIGHT. Rooms in More: one sheet, as tall as it needs up
    // to the top gap, scrolling past that. A Rooms button: both sheets the
    // same height (More's, at least SHEET_SHARE of the window), so switching
    // between them nothing jumps. Measured at each opening -- the window, the
    // lists and the fonts can all have changed.
    function sizeSheets() {
      var more = S.sheets.more, rooms = S.sheets.rooms;
      [more, rooms].forEach(function (el) { el.style.height = ''; });
      if (S.roomsMode === 'button') {
        var room = parseFloat(getComputedStyle(more).maxHeight) || 0;
        var want = S.more.length ? more.scrollHeight : rooms.scrollHeight;
        var h = Math.round(Math.max(SHEET_MIN, want, (window.innerHeight || 0) * SHEET_SHARE));
        if (room) h = Math.min(h, room);
        [more, rooms].forEach(function (el) { el.style.height = h + 'px'; });
      }
      // (their edges, now the lists are in: hk-base.js edges)
      if (C.edges) [more, rooms].forEach(function (el) { C.edges(el); });
    }
    function closeSheet(quiet) {
      if (!S.root) return;
      Object.keys(S.sheets).forEach(function (k) { S.sheets[k].classList.remove('open'); });
      S.root.classList.remove('sheeted');
      [S.roomsBtn, S.pill.querySelector('[data-t="more"]')].forEach(function (b) {
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      S.sheet = null;
      void quiet;
    }

    // -------------------------------------------------------- scrolling
    function setMode(mode) {
      S.down = 0; S.up = 0;
      if (S.mode === mode) return;
      S.mode = mode;
      if (!S.root) return;
      S.root.classList.toggle('small', mode === 'small');
      S.root.classList.toggle('gone', mode === 'gone');
      aside();
      foldPub();
      // (a Home Grid's room beside a rail follows the rail: publish lays it again)
      if (S.on && (S.pos === 'left' || S.pos === 'right')) publish(true);
    }
    // WHAT IT IS DOING, along the bottom, for what floats beside it (the
    // now-playing bar's stash button, hk-popup.js): `hk-tabbar-fold` on
    // <html> -- start / end while folded to its small button at that end,
    // gone while hidden -- and its row (--hk-tabbar-row: the bar's bottom
    // edge from the window's; --hk-tabbar-bh: its height), so a button can
    // sit in that row on the other side
    function foldPub(on) {
      var de = document.documentElement;
      if (!de || !de.setAttribute) return;
      var bottom = (on === undefined ? S.on : on) && (S.pos || 'bottom') === 'bottom', b = M.board() || {};
      var v = !bottom ? '' : S.mode === 'small' ? (b.tab_bar_fold === 'end' ? 'end' : 'start') : S.mode === 'gone' ? 'gone' : '';
      if (de.getAttribute('hk-tabbar-fold') !== (v || null)) {
        if (v) de.setAttribute('hk-tabbar-fold', v); else de.removeAttribute('hk-tabbar-fold');
      }
      var row = bottom ? LIFT_CSS : '', bh = bottom ? barH(undefined, sizeNow()) + 'px' : '';
      if (de.style.getPropertyValue('--hk-tabbar-row') !== row) {
        if (row) de.style.setProperty('--hk-tabbar-row', row); else de.style.removeProperty('--hk-tabbar-row');
      }
      if (de.style.getPropertyValue('--hk-tabbar-bh') !== bh) {
        if (bh) de.style.setProperty('--hk-tabbar-bh', bh); else de.style.removeProperty('--hk-tabbar-bh');
      }
      roomSoon(bottom && !v);
    }
    // ROOM BESIDE THE FULL BAR (2026-10-15): a bar along the bottom that
    // doesn't run the whole width (centered on a tablet) leaves the corner
    // beside it free -- `hk-tabbar-room` says so, and the now-playing bar's
    // stash sits there, in the bar's row, as beside a folded bar
    // (hk-popup.js), not above it over the page. Measured in the next frame,
    // never in the middle of a change.
    var roomRaf = 0;
    function roomSoon(want) {
      if (roomRaf) cancelAnimationFrame(roomRaf);
      roomRaf = requestAnimationFrame(function () {
        roomRaf = 0;
        var de = document.documentElement, ok = false;
        if (want && S.on && S.mode === 'full' && S.root) {
          var r = 0;
          ['.pill', '.roomsbtn'].forEach(function (sel) {
            var e = S.root.querySelector(sel), b = e && e.getBoundingClientRect();
            if (b && b.width) r = Math.max(r, b.right);
          });
          // the stash (as tall as the bar) and a gutter either side of it
          var need = barH(undefined, sizeNow()) + 2 * GUTTER;
          ok = r > 0 && (window.innerWidth || 0) - paneR() - r >= need;
        }
        if (de.hasAttribute('hk-tabbar-room') !== ok) { if (ok) de.setAttribute('hk-tabbar-room', 'end'); else de.removeAttribute('hk-tabbar-room'); }
      });
    }
    function onScroll(e) {
      if (!S.on || S.sheet || arranging()) return;
      var t = e.target;
      var el = (t === document || t === document.documentElement) ? document.scrollingElement : t;
      if (!el || el.nodeType !== 1 || el === S.host) return;
      var y = el.scrollTop, max = el.scrollHeight - el.clientHeight;
      var band = S.shift ? (y < S.shift) !== ((S.scrollY || 0) < S.shift) : false;
      S.scrollY = y;
      if (band) aside();
      var prev = S.last.get(el);
      S.last.set(el, y);
      if (prev === undefined || prev === y) return;
      var b = M.board() || {};
      var st = scrollStep({ mode: S.mode, down: S.down, up: S.up }, y - prev, y, max, scrollOf(b), b.tab_bar_start);
      var was = S.mode;
      setMode(st.mode);
      if (st.mode === was) { S.down = st.down; S.up = st.up; }
    }

    // ------------------------------------------- the room it takes, below
    // the rule that takes the bar's room out of the view's minimum height,
    // once in the view's own shadow root, where the kiosk rule it answers is
    // (more particular than its `hui-view`, so its !important gives way)
    function barRoomCss(view) {
      var root = view.getRootNode && view.getRootNode();
      if (!root || !root.querySelector || root.querySelector('style#hk-bar-room')) return;
      var st = document.createElement('style');
      st.id = 'hk-bar-room';
      // 100dvh, the window as it shows now: on an iPad in Safari 100vh is the
      // window with its toolbars hidden, so a Home Grid that fits the window
      // (100dvh) still scrolled by the toolbars' height (2026-10-24)
      st.textContent = '#view[hk-bar-room]>' + SH.tags.view + '{min-height:calc(100vh - var(--hk-bar-room,0px))!important;' +
        'min-height:calc(100dvh - var(--hk-bar-room,0px))!important}' +
        // (and Home Assistant's own #view, min-height:100vh, the same way)
        '#view[hk-bar-room]{min-height:100vh;min-height:100dvh}';
      // (a view in the document itself -- a host with no shadow roots: the head)
      (root.appendChild && root !== document ? root : document.head).appendChild(st);
    }
    function viewEl() { return SH.viewSlot(M.panel()); }
    function isGrid(hv) { return !!(hv && hv.localName === 'hk-home-grid-view'); }
    // A FULL RAIL PUSHES THE PAGE ASIDE (Shrink or Hide; Stay keeps a strip
    // of room instead): while the rail is full the dashboard is scaled down
    // away from it, just enough to clear it, and eased back as it folds or
    // hides -- a transform, so the compositor animates it and nothing is
    // laid out again. On hui-view, not the view container: the sky (fixed)
    // lives in the container and must stay put.
    function sizeNow() { return (M.board() || {}).tab_bar_size; }
    function asideW() { return GUTTER + railW(sizeNow()) + 8; }
    // THE NOW-PLAYING BAR KEEPS CLEAR OF A RAIL (hk-popup.js reads these):
    // the rail's column, while the rail shows (full or folded), on its side
    function railRoom() {
      var de = document.documentElement;
      if (!de || !de.style) return;
      var pos = S.on ? S.pos : null, show = (pos === 'left' || pos === 'right') && S.mode !== 'gone';
      [['--hk-tabbar-l', 'left'], ['--hk-tabbar-r', 'right']].forEach(function (kv) {
        var v = show && pos === kv[1] ? (GUTTER + railW(sizeNow()) + 12) + 'px' : '';      // 12 px clear of the rail
        if (de.style.getPropertyValue(kv[0]) !== v) {
          if (v) de.style.setProperty(kv[0], v); else de.style.removeProperty(kv[0]);
        }
      });
    }
    function aside() {
      railRoom();
      var b = M.board() || {}, pos = S.pos;
      var v = viewEl(), hv = SH.view(v);
      var how = S.on && pos ? room(pos, scrollOf(b), b.tab_bar_adjust, isGrid(hv)) : 'none';
      var on = how === 'scale' || how === 'shift';
      if (S.asideEl && S.asideEl !== hv) { S.asideEl.style.transform = ''; S.asideEl.style.transformOrigin = ''; S.asideEl = null; }
      if (!hv || !on) {
        if (hv && S.asideEl === hv) { hv.style.transform = ''; S.asideEl = null; }
        S.asideScale = 1; S.shift = 0;
        return;
      }
      S.asideEl = hv;
      hv.style.transition = 'transform .34s cubic-bezier(.32,.72,0,1)';
      var full = S.mode === 'full';
      if (how === 'shift') {
        // the bar's foot, from its own resolved top (safe area included):
        // only while the page is at its top -- mid-page the bar is over the
        // content, as at the bottom
        var top = 12;
        try { top = parseFloat(getComputedStyle(S.root.querySelector('.row')).top) || 12; } catch (e) { /* default */ }
        var px = Math.round(top + barH(undefined, sizeNow()) + 8);
        S.shift = px;
        hv.style.transformOrigin = '';
        hv.style.transform = full && (S.scrollY || 0) < px ? 'translateY(' + px + 'px)' : '';
        S.asideScale = 1;
        return;
      }
      var w = hv.getBoundingClientRect().width / (S.asideScale || 1) || window.innerWidth || 1280;
      var k = Math.max(0.5, (w - asideW()) / w);
      hv.style.transformOrigin = (pos === 'left' ? 'right' : 'left') + ' top';
      hv.style.transform = full ? 'scale(' + k.toFixed(4) + ')' : '';
      S.asideScale = full ? k : 1;
    }

    // THE PAGE MAKES ROOM on the bar's side: --hk-tabbar-h at the bottom
    // (the now-playing bar stands on it too), the view's top at the top, its
    // side beside a rail
    var SIDES = { bottom: 'paddingBottom', top: 'paddingTop', left: 'paddingLeft', right: 'paddingRight' };
    function publish(on) {
      var de = document.documentElement;
      if (!de || !de.style) return;
      var pos = on ? (S.pos || 'bottom') : null;
      // A RAIL THAT SHRINKS OR HIDES keeps no strip of the page's width: the
      // page runs full width under it (2026-10-06). A bar along the bottom or
      // the top only pads the page's ends, so it is over the content as soon
      // as the page scrolls, whatever it does.
      // WHERE IT IS, padding or not (--hk-tabbar-top: its top edge, and a
      // 10 px gap, from the window's bottom) -- what floats in a corner above
      // it reads this: the now-playing bar's stash button (hk-popup.js)
      var top = pos === 'bottom' ? 'calc(' + (barH(undefined, sizeNow()) + 10) + 'px + ' + LIFT_CSS + ')' : '';
      if (de.style.getPropertyValue('--hk-tabbar-top') !== top) {
        if (top) de.style.setProperty('--hk-tabbar-top', top);
        else de.style.removeProperty('--hk-tabbar-top');
      }
      // A BAR AT THE TOP (--hk-tabbar-below: its bottom edge from the
      // window's top, while it shows): what is pinned along the top goes
      // under it -- Edit mode's bar (hk-edit.js), never over the tabs
      var below = pos === 'top' ? 'calc(' + barH(undefined, sizeNow()) + 'px + ' + TOP_CSS + ')' : '';
      if (de.style.getPropertyValue('--hk-tabbar-below') !== below) {
        if (below) de.style.setProperty('--hk-tabbar-below', below);
        else de.style.removeProperty('--hk-tabbar-below');
      }
      foldPub(on);
      var b = M.board() || {};
      if (pos && room(pos, scrollOf(b), b.tab_bar_adjust, isGrid(SH.view(viewEl()))) !== 'pad') pos = null;
      var v = pos === 'bottom' ? 'calc(' + (barH(undefined, sizeNow()) + 10) + 'px + ' + LIFT_CSS + ')' : '';
      if (de.style.getPropertyValue('--hk-tabbar-h') !== v) {
        if (v) de.style.setProperty('--hk-tabbar-h', v);
        else de.style.removeProperty('--hk-tabbar-h');
      }
      // the view's own padding on that side, plus the bar's
      var view = pos ? viewEl() : null;
      // what the bar adds -- a new size or a turn past 640 px changes it, and
      // the padding is laid again
      // (a Home Grid beside a rail at rest -- folded to its small button, or
      // hidden: the grid takes the whole width and centres on the screen, the
      // button floating in its corner clear of the blocks; the rail's strip
      // comes back as it opens)
      var gridRest = (pos === 'left' || pos === 'right') && S.mode !== 'full' && isGrid(SH.view(viewEl()));
      var add = pos === 'bottom' ? 'var(--hk-tabbar-h,0px)'
        : pos === 'top' ? 'calc(' + (barH(undefined, sizeNow()) + 8) + 'px + ' + TOP_CSS + ')'
        : gridRest ? '0px' : pos ? asideW() + 'px' : '';
      if (S.view && (S.view !== view || S.viewSide !== pos || S.viewAdd !== add)) {
        S.view.style.removeProperty(S.viewProp || 'padding-bottom');
        if (S.viewPad) S.view.style.setProperty(S.viewProp, S.viewPad);
        S.view.removeAttribute('hk-bar-room');
        S.view.style.removeProperty('--hk-bar-room');
        S.view = null;
      }
      if (view && S.view !== view) {
        var prop = { bottom: 'padding-bottom', top: 'padding-top', left: 'padding-left', right: 'padding-right' }[pos];
        S.viewProp = prop; S.viewSide = pos;
        S.viewPad = view.style.getPropertyValue(prop);
        var base = getComputedStyle(view)[SIDES[pos]] || '0px';
        S.viewAdd = add;
        // !important: a kiosk screen's own rule sets the view's top padding
        view.style.setProperty(prop, 'calc(' + base + ' + ' + add + ')', pos === 'top' ? 'important' : '');
        // ...AND THE VIEW IS THAT MUCH SHORTER (2026-10-17): a kiosk
        // stylesheet (Kiosk Mode's `hui-view{min-height:100vh !important}`,
        // on the wall tablets) holds the view at the whole window, so the
        // bar's room came on top of it and a page that fits the window
        // (Calendar, Live TV) scrolled by the bar's height. Above or below,
        // the room comes out of the view's own minimum.
        if (pos === 'bottom' || pos === 'top') {
          barRoomCss(view);
          view.style.setProperty('--hk-bar-room', add);
          view.setAttribute('hk-bar-room', '');
        }
        S.view = view;
      }
    }

    // ------------------------------------------------------------ sync
    // Everything that can change what shows: page changes, settings, resize,
    // state pushes. Cheap and idempotent.
    function sync() {
      var on = wanted();
      if (!on) {
        if (S.root) { closeSheet(true); S.root.className = 'root'; }
        S.on = false;
        publishHeader();
        publish(false);
        aside();
        return;
      }
      if (!mount()) return;
      var b = M.board() || {};
      var look = document.documentElement.getAttribute('data-hk-glass');
      var mat = material(b.tab_bar_glass, look);
      pinGlass(mat === 'blur' && look === 'blur_pre');
      var a = typeof M.accent === 'function' ? M.accent() : null;
      if (a) {
        S.host.style.setProperty('--hk-accent', a.color); S.host.style.setProperty('--hk-on-accent', a.on);
        S.host.style.setProperty('--hk-accent-base', a.base || a.color);
      }
      var width = (window.innerWidth || 0) - leftOf() - paneR();
      iconsOnly = b.tab_bar_labels === 'icons';
      S.host.toggleAttribute('data-icons', iconsOnly);
      if (listKey(width) !== S.built) build();
      if (S.host.getAttribute('data-pos') !== S.pos) S.host.setAttribute('data-pos', S.pos || 'bottom');
      // (a rail is always a tablet's -- railW, what its fit and its room are
      // worked out from -- a phone held sideways's too: drawn at a phone's
      // 60 its tabs came out smaller than the fit, the difference left as
      // gaps above the first and below More, 2026-10-25)
      var railed = S.pos === 'left' || S.pos === 'right';
      S.host.toggleAttribute('data-wide', railed || barH() !== BAR_H);
      // TAB BAR SIZE: the thickness itself, and the icons' and names' step
      var size = SIZE_STEP[b.tab_bar_size] !== undefined ? b.tab_bar_size : 'medium';
      S.host.style.setProperty('--bh', (railed ? railW(size) : barH(undefined, size)) + 'px');
      if (S.host.getAttribute('data-size') !== size) S.host.setAttribute('data-size', size);
      var cls = ['root', 'on', mat];
      if (S.roomsMode === 'button' && S.rooms.length) cls.push('hasrooms');
      if (S.tight) cls.push('tight');
      if (S.mode === 'small') cls.push('small');
      if (S.mode === 'gone') cls.push('gone');
      if (S.sheet) cls.push('sheeted');
      if (S.roomsMode !== 'button') cls.push('joined');
      if ((M.board() || {}).tab_bar_fold === 'end') cls.push('fold-end');
      // Edit mode: the whole bar, never folded, its tabs to drag
      if (arranging()) { cls.push('editing'); if (S.mode !== 'full') { setMode('full'); cls = cls.filter(function (c) { return c !== 'small' && c !== 'gone'; }); } }
      S.root.className = cls.join(' ');
      S.on = true;
      markHere();
      publishHeader();
      publish(true);
      aside();
    }
    // where the bar rests: small with Start Small (and Shrink), else full
    function rest() {
      var b = M.board() || {};
      return scrollOf(b) === 'shrink' && b.tab_bar_start === 'small' ? 'small' : 'full';
    }
    // THE REST AT THE START OF THE NEXT FRAME, as the menu does: the address
    // changes before Home Assistant builds the page, and sync measures
    // (computed style, the panel's box) -- read here, mid-change, it laid the
    // half-built page out once more than the frame does. The new view says
    // when it is in (hk-view-ready, hk-layout.js) -- not a timer.
    var navFrame = 0;
    function onNav() {
      closeSheet(true);
      S.scrollY = 0;
      setMode(rest());
      S.last = new WeakMap();
      if (navFrame) return;
      navFrame = requestAnimationFrame(function () { navFrame = 0; sync(); });
    }
    SH.onNavigate(onNav);
    window.addEventListener('popstate', onNav);
    window.addEventListener('hk-view-ready', function () { sync(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.sheet) { e.stopPropagation(); closeSheet(); }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) closeSheet(true); });
    window.addEventListener('resize', function () { sync(); });
    // the docked bar came, went or changed height: the rail's room did
    window.addEventListener('hk-dock', function () { sync(); });
    window.addEventListener('hk-pane', function () { sync(); });
    window.addEventListener('hk-module-ready', function () { S.built = ''; sync(); });
    // the host's Home Assistant rows changed (hkShell.haNav: it learned where the page is)
    window.addEventListener('hk-ha-nav-changed', function () { S.built = ''; sync(); });
    // Edit mode begun or ended (hk-edit.js): More's Edit Page row goes or comes back
    window.addEventListener('hk-edit', function () { S.built = ''; sync(); });
    // the window's scroll, and <body>'s on a phone (scroll events do not
    // bubble: captured at the document, as hk-menu.js does)
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // HA pushes ~33 state changes a second: only what the list is made of
    // is looked at here -- the dashboard, its config and the areas, each by
    // identity (a new object only when it changed)
    C.onClient(function () {
      var h = C.client(), cfg = M.config(), d = M.dash(), areas = h && h.areas;
      if (d === S.dash && cfg === S.cfg && areas === S.areas) return;
      S.dash = d; S.cfg = cfg; S.areas = areas;
      sync();
    });
    sync();
    setTimeout(sync, 1500);    // the panel and config can land after us on a cold load

    window.hkTabBar.headerContext = function () {
      var available = !!S.on && M.tabBar();
      // A bar starting small does not show the selected page's name.
      return { available: available, exact: available && rest() === 'full' && S.tabs.some(function (it) { return H.isHere(it, location.pathname); }) };
    };
    var headerKey = '';
    function publishHeader() {
      if (!window.hkTabBar.headerContext) return;
      var key = JSON.stringify(window.hkTabBar.headerContext()) + location.pathname;
      if (key === headerKey) return;
      headerKey = key;
      window.dispatchEvent(new CustomEvent('hk-page-navigation'));
    }
    window.hkTabBar.sync = sync;
    window.hkTabBar.open = openSheet;
    window.hkTabBar.close = closeSheet;
    window.hkTabBar.mode = function () { return S.mode; };
    window.hkTabBar._.state = function () { return S; };
    // NO hk-module-ready HERE: that event redraws every card on the page
    // (hk-base.js MODULE WAKE) and no card reads the bar -- the now-playing
    // bar follows it through --hk-tabbar-h / -l / -r alone. Announcing
    // ourselves cost every screen, tab bar or not, a whole-page redraw (and
    // this bar a second build) on every load.
  });
})();
