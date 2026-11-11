// hk-menu.js -- THE MENU OF PAGES AND ROOMS, modeled on the Home app's sidebar.
//
// A panel that slides in from the left over the page: Home, the dashboard's
// own pages, and every room. On a dashboard only when its own item under
// Dashboards on HK Frontend's page says so (settings `boards`), so a house
// that never adds one gets nothing from this file.
//
// NOTHING HERE NAMES A ROOM OR A PAGE. The list is read from the dashboard it
// is on (docs/Menu.md):
//   * the first view is Home;
//   * a view with `area:` (one area or a list) is a room -- named by its own
//     title (else its area's name) and pictured by its area's icon in
//     Settings -> Areas, unless the view says otherwise;
//   * Categories: the pages the Home view's chips open, in chip order (with
//     no chips, every other view with a title, in the dashboard's order) --
//     or, when its item's Categories in the menu names some, those pages;
//   * `menu: top` lists a view beside Home, `menu: false` leaves it out, and
//     `menu_title:` renames an entry without renaming the view.
//
// THE WAY IN (hk-base.js `hkCards.menu.style()`), one style per dashboard:
//   chip -- hk-menu-button-card (usually the chip row's pinned lead) and the
//           round button hk-back-card draws beside its chevron;
//   tab  -- the slim EDGE TAB below, drawn here, on every page, centered on
//           the date line under the header clock (hk-header-card measures it),
//           or where Configure -> Tab position puts it;
//   docked -- its item's Menu: "Always open beside the page", with room:
//           the menu stays beside the page, and there is no button at all.
//   chip_scroll / chip_home -- the chip, and the tab slides in while the
//           chip is scrolled out of sight (chip_home: the tab outright on
//           every page but Home). See "the scrolled tab" below.
//   none -- no button at all (only with the swipe on; hk-base.js falls back
//           to Automatic, or the chip on narrow screens, without it).
// And the clock itself opens the menu when "Tapping the clock opens the menu"
// is on (hk-header-card); and with Swipe from Left Edge on, a drag right from
// the dashboard's left edge pulls it out, at every width, alongside whatever
// button there is (see "the edge swipe" below). Under 1,024 px (TAB_MIN in hk-base.js), and while
// an always-open menu is folded, the screen's "On Narrow Screens" choice
// decides: the round button (the default -- a phone's margin has
// little room for a tab), the chip then the tab once scrolled past, or the
// tab.
//
// IT CLOSES ITSELF when a row is chosen, when the scrim is tapped, on Escape,
// on any navigation or pop-up (the idle return included), when the screen is
// hidden, and after a minute untouched.
//
// Mounted ONCE, in <home-assistant>'s shadow root beside the pop-ups and
// sheets (hk-popup.js, hk-detail.js), so it outlives every page change -- its
// scroll position and open sections with it -- the way the Home app's
// sidebar does. Stacking: the tab (6) sits under the pop-ups (7) and the
// detail sheets (8); the open panel (9) over them, the persistent #media bar
// included.
(function () {
  'use strict';
  if (window.hkMenu) return;
  // the host's page: where the menu mounts, navigation, HA's own sidebar
  var SH = window.hkShell;

  // THE FIRST LOAD AFTER AN UPDATE can pair this file with the previous
  // hk-base.js, still in the service worker's cache. The menu then stays out of the way for that one load rather
  // than throwing on a helper the old base does not have; the next load has
  // both.
  var NEEDS = ['on', 'style', 'docked', 'icon', 'clock', 'config', 'dash', 'dateY', 'homeButton', 'panel', 'viewTop',
               'board'];
  function fits(C) {
    var M = C && C.menu;
    return !!M && NEEDS.every(function (k) { return typeof M[k] === 'function'; });
  }
  function whenBase(fn) {
    function go() {
      if (fits(window.hkCards)) fn(window.hkCards);
      else if (window.console) console.info('hk-menu: hk-base.js is older than this menu; reload once more');
    }
    if (window.hkCards && window.hkCards.menu) return go();
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.menu) go();
    }, { once: true });
  }

  // ------------------------------------------------------------- the list
  // A PURE FUNCTION of the dashboard config, the areas and the settings, so
  // the tests can hold it to every rule above without a page.
  //   cfg    the dashboard's lovelace config ({ views: [...] })
  //   areas  client.areas (area_id -> { name, icon })
  //   o      { dash, order: 'az'|'dashboard', user: client.user.id,
  //            categories: [view paths] (empty: the chips' pages), ha: bool,
  //            chips: the screen's Chips (its chips card's kinds), chipsRow }
  function model(cfg, areas, o) {
    o = o || {};
    var views = (cfg && Array.isArray(cfg.views)) ? cfg.views : [];
    var out = { home: null, pages: null, top: [], categories: [], rooms: [] };
    if (!views.length) return out;
    var dash = o.dash || '';
    // HA's own visibility: `visible: false`, or per user ([{ user: id }, ...]).
    // Nothing overrides it.
    function userCan(v) {
      if (v.visible === false) return false;
      if (Array.isArray(v.visible) && o.user) {
        return v.visible.some(function (u) { return u && (u.user === o.user || u === o.user); });
      }
      return true;
    }
    function menuOff(v) { return v.menu === false || v.menu === 'hidden'; }
    function pathOf(v, i) { return '/' + dash + '/' + (v.path || i); }
    var v0 = views[0];
    // CATEGORIES. By default the pages the Home view's chips open, in chip
    // order -- the chip row already is the house's list of what matters.
    // With no chips, every titled page. Chosen in Configure, those pages
    // (still in chip order, then the dashboard's).
    var chips = chipPaths(v0, dash, { views: views, chips: o.chips, row: o.chipsRow });
    var chosen = Array.isArray(o.categories) && o.categories.length ? o.categories : null;
    // A DASHBOARD'S PAGE ORDER (the screen's page order), as view paths:
    // when it is set, it orders the pages here too -- not the chips.
    var po = Array.isArray(o.pageOrder) ? o.pageOrder : [];
    // TOP OF THE MENU (the screen's own choice): the view paths
    // listed right under Home, above Categories. None chosen: the views that
    // say `menu: top` themselves (a generated screen's Weather, Cameras and
    // Live TV). A page chosen here shows even with its view's `menu: false`.
    // ['-'] (the settings page's "nothing at the top") matches no view.
    var topSet = Array.isArray(o.top) && o.top.length ? o.top.map(String) : null;
    function isTop(v, i) { return topSet ? topSet.indexOf(String(v.path || i)) !== -1 : v.menu === 'top'; }
    function chipRank(v, i) {
      var c = chips.indexOf(String(v.path || i));
      return c === -1 ? chips.length + i : c;
    }
    function rank(v, i) {
      if (!po.length) return chipRank(v, i);
      var j = po.indexOf(String(v.path || i));
      return j >= 0 ? j : po.length + chipRank(v, i);
    }
    function listed(v, i) {
      var key = String(v.path || i);
      if (chosen) return chosen.indexOf(key) !== -1;
      return !chips.length || chips.indexOf(key) !== -1;
    }
    out.home = { title: (v0 && v0.menu_title) || 'Home', icon: (v0 && v0.menu_icon) || 'mdi:home',
                 path: pathOf(v0 || {}, 0), index: 0, kind: 'home', paths: ['0', v0 && v0.path] };
    // "Home Assistant" (a screen's Menu -> Home Assistant): its own section,
    // between the top pages and Categories (haItems, drawn by the page).
    out.ha = !!o.ha;
    // Is the page at `i` in the menu? (top, or a listed category)
    function shows(v, i) {
      if (!v || !userCan(v)) return false;
      if (isTop(v, i)) return true;
      if (menuOff(v) && !(chosen && listed(v, i))) return false;
      return listed(v, i);
    }
    for (var i = 1; i < views.length; i++) {
      var v = views[i];
      if (!v) continue;
      var list = [].concat(v.area || (v.strategy && v.strategy.area) || []).filter(Boolean);
      if (!userCan(v)) continue;
      // THE PAGES SCREEN (Phase J, hk-pages-screen.js; only while the
      // screen's Pages Screen is on, so only then a view): right after Home,
      // in the menu and as the bar's second tab -- whatever the Categories
      // and the page order say, as Home is
      if (v.pages_screen) {
        if (!out.pages) out.pages = { title: v.menu_title || v.title || 'Pages', icon: v.menu_icon || v.icon || PAGES_ICON,
                                      path: pathOf(v, i), index: i, kind: 'pages', paths: [String(i), v.path] };
        continue;
      }
      // A PAGE THAT FOLLOWS ANOTHER (Browse Music follows Play Music): in the
      // menu when its leader is, as its kind, right after it -- or where the
      // page order places it.
      if (v.menu_follows) {
        // ...unless it says it is not in the menu: then it is only another
        // address of its leader (Browse Music, since 2026-10-11 the Music
        // page opened in its search box), and never a row of its own -- not
        // even where a screen chose it back when it was its own page (four
        // screens' menus listed Music twice)
        if (menuOff(v)) continue;
        var li = -1;
        for (var k = 1; k < views.length; k++) if (views[k] && views[k].path === v.menu_follows) { li = k; break; }
        if (li < 0 || !shows(views[li], li) || !(v.menu_title || v.title)) continue;
        var lead = views[li], own = po.indexOf(String(v.path || i));
        var fit = { title: v.menu_title || v.title, icon: v.menu_icon || v.icon || PAGE_ICON, path: pathOf(v, i),
                    index: i, kind: isTop(lead, li) ? 'top' : 'category', paths: [String(i), v.path],
                    rank: own >= 0 ? own : rank(lead, li) + 0.5 };
        if (fit.kind === 'top') out.top.push(fit); else out.categories.push(fit);
        continue;
      }
      // an explicit choice outranks the view's own `menu: false`
      if (menuOff(v) && !(chosen && listed(v, i)) && !(topSet && isTop(v, i))) continue;
      if (list.length) {
        var a = (areas && areas[list[0]]) || {};
        // The page's own title first -- it is what the room's heading on Home
        // says, so the two can never spell it differently -- then the area's.
        out.rooms.push({ title: v.menu_title || v.title || a.name || list[0],
                         icon: v.menu_icon || v.icon || a.icon || ROOM_ICON,
                         path: pathOf(v, i), index: i, kind: 'room', areas: list, paths: [String(i), v.path] });
        continue;
      }
      var title = v.menu_title || v.title;
      if (!title) continue;
      var top = isTop(v, i);
      if (!top && !listed(v, i)) continue;
      var item = { title: title, icon: v.menu_icon || v.icon || PAGE_ICON, path: pathOf(v, i), index: i,
                   kind: top ? 'top' : 'category', paths: [String(i), v.path], rank: rank(v, i) };
      if (top) out.top.push(item);
      else out.categories.push(item);
    }
    out.categories.sort(function (x, y) { return x.rank - y.rank; });
    // ...and the top pages too, when a page order is set (a generated
    // screen's views already stand in it; Edit mode arranges the top by it).
    // None set: as the dashboard lists them, as before.
    if (po.length) out.top.sort(function (x, y) { return x.rank - y.rank; });
    // ROOM ORDER (the dashboard item's "Rooms in the menu"): A to Z, or
    // `order` -- the item's Room order, a list of AREAS (drag-ordered in the
    // form), a room placed by the first of its areas that is listed; rooms
    // not in it follow in the dashboard's order. An empty list is simply the
    // dashboard's order ('dashboard', the older name, means the same).
    if (o.order === 'order' || o.order === 'dashboard') {
      // its own names: `rank` and `list` above are this function's too
      var roomRank = {}, order = Array.isArray(o.roomOrder) ? o.roomOrder : [];
      order.forEach(function (a, i) { if (!(a in roomRank)) roomRank[a] = i; });
      out.rooms.forEach(function (r, i) {
        var best = order.length;
        (r.areas || []).forEach(function (a) { if (a in roomRank && roomRank[a] < best) best = roomRank[a]; });
        r._rank = best; r._i = i;
      });
      out.rooms.sort(function (x, y) { return x._rank - y._rank || x._i - y._i; });
      out.rooms.forEach(function (r) { delete r._rank; delete r._i; });
    } else {
      out.rooms.sort(function (x, y) {
        return String(x.title).localeCompare(String(y.title), undefined, { sensitivity: 'base' });
      });
    }
    return out;
  }
  // WHERE THE EDGE TAB'S CENTER GOES, in px below the top of the page:
  //   pos    Configure -> Tab position: '' (level with the date line), '140px'
  //          (from the top of the page) or '20%' (of the page's visible height)
  //   dateY  the header's date line, when it has been measured (else 118, where
  //          it sits on a wall tablet)
  //   height the page's visible height
  // Always kept on screen: the tab's own half-height clear of either edge.
  function tabCentre(pos, dateY, height, tabH) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$/.exec(String(pos || ''));
    var y = m ? (m[2] === '%' ? height * parseFloat(m[1]) / 100 : parseFloat(m[1]))
              : (dateY === null || dateY === undefined ? 118 : dateY);
    var half = (tabH || 62) / 2 + 8;
    return Math.max(half, Math.min(Math.max(half, height - half), y));
  }

  // The pages the Home view's chips open, in the order the chips sit: every
  // hk-status-chip-card's navigate target, as a view path on this dashboard
  // (./lights, lights and /<dash>/lights all mean `lights`). A pop-up hash is
  // not a page.
  // A dashboard item's page order (settings `pages`: kinds, `browse`, custom
  // page addresses) as view paths. Empty: none set, the chips rule.
  var PAGE_PATHS = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', live_tv: 'live-tv', security: 'security',
                     doors_windows: 'doors-windows', climate: 'climate', lights: 'lights', timers: 'timers',
                     vacuums: 'vacuums', music: 'playmusic', browse: 'music-browse', water: 'water', energy: 'energy', power: 'power',
                     timeline: 'timeline' };
  function pagePaths(pages, custom) {
    if (!Array.isArray(pages) || !pages.length) return [];
    var out = [];
    pages.forEach(function (k) {
      var p = PAGE_PATHS[k] || (k !== 'rooms' && Array.isArray(custom) && custom.indexOf(k) >= 0 ? k : null);
      if (p && out.indexOf(p) < 0) out.push(p);
    });
    return out;
  }
  // THE CHIPS CARD (hk-chips-card): one card that draws a chip
  // per kind -- the screen's own Chips (`o.chips`), else the card's `chips:`,
  // else every kind -- each opening the first of its pages (KIND_PAGES, as
  // hk-chip.js) the dashboard has. Its `extra:` chips are walked as written.
  // `o.row === false`: the screen shows no chip row. A chips card with
  // `in_menu: false` (a generated screen's) picks no Categories.
  // A COPY of hk-chip.js's tables (hkChip.kinds): this module loads at
  // bootstrap, before the card files, so it cannot wait for them. The chip
  // kind suite (test_chipkinds) holds the two copies equal.
  var KIND_ORDER = ['weather_alert', 'security', 'doors_windows', 'climate', 'lights', 'blinds',
                    'timers', 'vacuums', 'laundry', 'speakers', 'water', 'energy'];
  var KIND_PAGES = { weather_alert: ['weather'], security: ['security', 'alarm'],
                     doors_windows: ['doors-windows', 'doors', 'security'], climate: ['climate'], lights: ['lights'],
                     blinds: ['blinds', 'shades', 'climate'], timers: ['timers'], vacuums: ['vacuums'], laundry: [],
                     speakers: ['playmusic', 'speakers'], water: ['water', 'leaks'], energy: ['energy'] };
  function chipPaths(v0, dash, o) {
    o = o || {};
    var out = [], have = {};
    (o.views || []).forEach(function (v, i) { if (v) have[String(v.path || i)] = true; });
    (function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
      if (node.type === 'custom:hk-chips-card' && node.in_menu === false) return;
      if (node.type === 'custom:hk-chips-card' && o.row !== false) {
        var kinds = Array.isArray(o.chips) && o.chips.length ? o.chips
                  : Array.isArray(node.chips) && node.chips.length ? node.chips : KIND_ORDER;
        kinds.forEach(function (k) {
          var want = KIND_PAGES[k] || [];
          for (var i = 0; i < want.length; i++) {
            if (have[want[i]]) { if (out.indexOf(want[i]) === -1) out.push(want[i]); break; }
          }
        });
      }
      if (node.type === 'custom:hk-status-chip-card') {
        var t = node.tap_action || {};
        var p = String(t.navigation_path || '').split('#')[0].split('?')[0];
        if (t.action === 'navigate' && p) {
          var seg = p.replace(/^\.\//, '').split('/').filter(Boolean);
          var key = seg.length > 1 && seg[0] === dash ? seg[1] : seg[seg.length - 1];
          if (key && out.indexOf(key) === -1) out.push(key);
        }
      }
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k) && typeof node[k] === 'object') walk(node[k], depth + 1);
      }
    })(v0 && v0.cards || v0 && v0.sections || [], 0);
    return out;
  }

  // The Home app's own room glyph (a square with its corner partitioned) is not in
  // SF Symbols' public set; a floor plan says the same thing.
  var ROOM_ICON = 'mdi:floor-plan';
  var PAGE_ICON = 'mdi:view-dashboard-outline';
  // the Pages screen's: a grid (Material's; the hk: set has none)
  var PAGES_ICON = 'mdi:view-grid';

  // Which row is the page on screen: its path or its index, on this dashboard.
  function isHere(item, pathname) {
    if (item.kind === 'ha') return false;
    var seg = String(pathname || '').split('/');
    var here = seg[2] || '';
    if (item.kind === 'home') return !here || item.paths.indexOf(here) !== -1;
    return !!here && item.paths.indexOf(here) !== -1;
  }

  // THE HOME ASSISTANT SECTION (a screen's Menu -> Home Assistant): Home
  // Assistant's own pages, above Categories. Pinned: Integrations,
  // Automations and Settings -- admins only, as Home Assistant has them --
  // then Notifications. "More" folds out the rest of this user's own Home
  // Assistant sidebar, in its order and titles, without what they hid (or
  // what they may not open). Then Show Menu (Home Assistant's own sidebar,
  // unless it is on screen already) and Profile. All of it is read live:
  // nothing here is stored in the dashboard.
  var HA_PINNED = [
    { title: 'Integrations', icon: 'mdi:devices', path: '/config/integrations/dashboard', panel: 'config/integrations' },
    { title: 'Automations', icon: 'mdi:robot', path: '/config/automation/dashboard', panel: 'config/automation' },
    { title: 'Settings', icon: 'mdi:cog', path: '/config/dashboard', panel: 'config', badge: 'settings' }
  ];
  // `sidebar` is the host's sidebar data: { user, panels, localize }
  // (hkShell.sidebarData(): the panels and their titles are the host's own pages,
  // not house data, so they come from the shell, not the client).
  function haItems(sidebar, prefs, o) {
    o = o || {};
    prefs = prefs || {};
    var admin = !!(sidebar && sidebar.user && sidebar.user.is_admin);
    var panels = (sidebar && sidebar.panels) || {};
    var name = function (t) {
      var s = '';
      try { s = sidebar.localize('panel.' + t); } catch (e) { /* no localize */ }
      return s || t;
    };
    var out = [], pinned = { config: 1 };
    HA_PINNED.forEach(function (p) {
      pinned[p.panel] = 1;
      if (admin) out.push({ title: p.title, icon: p.icon, kind: 'hapage', path: p.path, badge: p.badge || '', paths: [] });
    });
    out.push({ title: 'Notifications', icon: 'mdi:bell', kind: 'notif', badge: 'notif', paths: [] });
    var hidden = Array.isArray(prefs.hiddenPanels) ? prefs.hiddenPanels : [];
    var order = Array.isArray(prefs.panelOrder) ? prefs.panelOrder : [];
    var more = Object.keys(panels).filter(function (k) {
      var p = panels[k];
      return !!p && !!p.title && p.show_in_sidebar !== false && !pinned[k] &&
             hidden.indexOf(k) === -1 && (admin || !p.require_admin);
    }).map(function (k) {
      return { key: k, title: name(panels[k].title), icon: panels[k].icon || 'mdi:application-outline' };
    });
    // this user's order first, then the rest A to Z -- as Home Assistant does
    more.sort(function (a, b) {
      var ia = order.indexOf(a.key), ib = order.indexOf(b.key);
      if (ia === -1 && ib === -1) return a.title.localeCompare(b.title);
      return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
    });
    if (more.length) {
      out.push({ title: 'More', icon: 'mdi:dots-horizontal-circle-outline', kind: 'more', open: !!o.moreOpen, paths: [] });
      if (o.moreOpen) {
        more.forEach(function (m) { out.push({ title: m.title, icon: m.icon, kind: 'sub', path: '/' + m.key, paths: [] }); });
      }
    }
    if (!o.sidebarShown) out.push({ title: 'Show Menu', icon: 'mdi:menu', kind: 'ha', path: null, paths: [] });
    out.push({ title: 'Profile', icon: 'mdi:account-circle', kind: 'hapage', path: '/profile/general', paths: [] });
    return out;
  }

  // An mdi: icon with an SF Symbol of the same name in the hk: glyph set
  // is drawn as that symbol (hk:), so the menu wears Apple's artwork where it
  // exists and Material's everywhere else.
  function glyph(icon) {
    var m = /^mdi:(.+)$/.exec(String(icon || ''));
    var g = window.hkGlyphs && window.hkGlyphs.icons;
    return (m && g && g[m[1]]) ? 'hk:' + m[1] : icon;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // THE HOST'S OWN PAGES (hkShell.hostMenu): a host's settings page, opened by a full page load (inside
  // the same frame when the host runs in Home Assistant's sidebar). `section` names the host's section
  // (the host's own word; Home Assistant has no such pages, so no section and no word).
  function hostItems() {
    var SH = window.hkShell, list = null;
    try { list = SH && SH.hostMenu ? SH.hostMenu() : null; } catch (e) { list = null; }
    // a row either opens a page (href) or asks the host to do something (run: a function)
    return (Array.isArray(list) ? list : []).filter(function (x) { return x && x.title && (x.href || typeof x.run === 'function'); })
      .map(function (x) { return { title: String(x.title), icon: x.icon || 'mdi:cog', kind: 'hostlink', href: x.href ? String(x.href) : '',
                                   run: typeof x.run === 'function' ? x.run : null, section: String(x.section || ''), paths: [] }; });
  }

  // EDIT PAGE (hk-edit.js, Edit mode): one row, on a page that has something
  // to arrange, for an Owner or Admin not at a wall tablet. The tab bar's
  // More sheet shows the same row. `kind: 'edit'` runs hkEdit.enter.
  function editItems(client) {
    var E = window.hkEdit;
    var on = false;
    try { on = !!(E && E.offer && E.offer(client)); } catch (e) { on = false; }
    return on ? [{ title: 'Edit Page', icon: 'mdi:pencil', kind: 'edit', paths: [] }] : [];
  }
  function editKey(client) {
    var E = window.hkEdit;
    try { return E && E.offerKey ? E.offerKey(client) : ''; } catch (e) { return ''; }
  }

  function sidebarSource() {
    var SH = window.hkShell;
    return SH && SH.sidebarData ? SH.sidebarData() : null;
  }

  // WHAT THE HOME ASSISTANT SECTION IS HERE (hkShell.haNav): Home Assistant's
  // sidebar where the host is Home Assistant or shows the page inside it
  // ('own'); one row opening Home Assistant where it is elsewhere ({ link });
  // nothing where there is no Home Assistant to open (null). A row that
  // could do nothing is never listed.
  function haNav() {
    var SH = window.hkShell;
    if (!SH || !SH.haNav) return 'own';
    var n = SH.haNav();
    if (n === 'own') return n;
    return n && typeof n.link === 'string' && /^https?:\/\//.test(n.link) ? { link: n.link, top: !!n.top } : null;
  }
  // The section's rows, by haNav: `prefs` is this user's sidebar order and
  // hidden pages (the host's own when its sidebar data carries them)
  function haList(prefs, o) {
    var nav = haNav();
    if (!nav) return [];
    if (nav !== 'own') return [{ title: 'Open Home Assistant', icon: 'mdi:open-in-new', kind: 'halink', href: nav.link, top: nav.top, paths: [] }];
    var side = sidebarSource();
    return haItems(side, (side && side.prefs) || prefs, o);
  }
  // the one row's way out: this window, or the top one (a page framed by someone else)
  function haOpen(it) {
    if (!it || !it.href) return;
    if (it.top) { try { window.open(it.href, '_top'); } catch (e) { /* refused */ } return; }
    location.assign(it.href);
  }
  // what the section looks like, for the lists' keys: a change redraws them
  function haKey() {
    var nav = haNav(), side = nav === 'own' ? sidebarSource() : null;
    return nav === 'own' ? 'own:' + (side && side.panels ? Object.keys(side.panels).join(',') : '') +
                           ':' + JSON.stringify((side && side.prefs) || null) + ':' + !!(side && side.shown)
                         : nav ? 'link:' + nav.link + ':' + nav.top : 'none';
  }

  // THE SWIPE ORDER WITH THE PAGES SCREEN (Phase 0's Swipe Between Pages,
  // Phase J): Home, then the Pages screen, then the rest -- the bar's tabs
  // and the menu's list already have it there (model above). `list`: pages
  // in an order (the menu's items, or view paths); the Pages screen's item
  // (kind 'pages', or the path `pagesPath`) is moved to right after the
  // first. Phase 0's order function, where it takes an extension, is handed
  // this below.
  function pagesAfterHome(list, pagesPath) {
    if (!Array.isArray(list) || list.length < 2) return list;
    var at = -1;
    list.forEach(function (x, i) {
      if (at < 0 && i > 0 && x && (x.kind === 'pages' || (pagesPath && (x === pagesPath || x.path === pagesPath)))) at = i;
    });
    if (at <= 1) return list;
    var out = list.slice(), it = out.splice(at, 1)[0];
    out.splice(1, 0, it);
    return out;
  }
  window.hkMenu = { version: '1.1.0', _: { model: model, isHere: isHere, glyph: glyph, chipPaths: chipPaths, pagePaths: pagePaths, pagesAfterHome: pagesAfterHome,
                                           haItems: haItems, hostItems: hostItems, editItems: editItems, editKey: editKey,
                                           sidebarSource: sidebarSource,
                                           haNav: haNav, haList: haList, haOpen: haOpen, haKey: haKey,
                                           tabCentre: tabCentre, kinds: { ORDER: KIND_ORDER, PAGES: KIND_PAGES } } };
  // SWIPE BETWEEN PAGES (hk-pageswipe.js): the Pages screen goes right after
  // Home in its order too -- offered once, when that module is there, and
  // never throwing into the menu
  (function offer() {
    var P = window.hkPageSwipe, fn = P && P.extend;
    if (typeof fn !== 'function') {
      if (!offer.waiting) {
        offer.waiting = true;
        window.addEventListener('hk-module-ready', function again() {
          var Q = window.hkPageSwipe;
          if (Q && typeof Q.extend === 'function') { window.removeEventListener('hk-module-ready', again); offer(); }
        });
      }
      return;
    }
    try { fn.call(P, function (list) { return pagesAfterHome(list, null); }); } catch (e) { /* its order stays its own */ }
  })();

  // ------------------------------------------------------------ the parts (generated by tools/split_js.py)
  // THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/menu/ (the PARTS below, in the order they
  // run) by tools/split_js.py from tools/split_manifests/menu.json; `split_js.py --find <name>` says which file holds
  // one. Each file registers one function in window.hkMenuParts; they run here, in this order (a later one may use
  // an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
  // they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
  // them (the suites) starts at once, in the same turn.
  // READY: window.__hkSplitReady['hk-menu'] is a promise that resolves once the parts have run (and rejects if they
  // never come), so a page that imports this file and uses it at once awaits it first (web/home.js imp, hk-loader).
  var PARTS = ['hk-menu-css.js', 'hk-menu-drawer.js'];
  var PARTS_TRIES = 6;
  function partKey(file) { return file.replace(/\.js$/, ''); }
  function partsSettle(err) {
    var settle = (window.__hkSplitSettle || {})['hk-menu'];
    if (settle) settle(err);
  }
  // ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
  // (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
  // of their own -- a browser keeps a failed module's answer for its address
  function loadParts(then, n) {
    // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
    // must not run them twice: the flag is set at once, not when the parts have run
    var started = window.__hkSplitStarted = window.__hkSplitStarted || {};
    if (n === undefined) {
      if (started['hk-menu']) return;
      started['hk-menu'] = true;
      var ready = new Promise(function (resolve, reject) {
        (window.__hkSplitSettle = window.__hkSplitSettle || {})['hk-menu'] = function (err) { if (err) reject(err); else resolve(); };
      });
      ready.catch(function () { /* the console says so; an importer that awaits it reports it */ });
      (window.__hkSplitReady = window.__hkSplitReady || {})['hk-menu'] = ready;
    }
    n = n || 0;
    var have = window.hkMenuParts || {};
    var missing = PARTS.filter(function (file) { return !have[partKey(file)]; });
    if (!missing.length) {
      var failed = null;
      try { then(); } catch (err) { failed = err; console.error('[hk-menu] the parts did not start', err); }
      // (the checks that drive a page wait for every shell that started to say it is done)
      (window.__hkSplitDone = window.__hkSplitDone || {})['hk-menu'] = true;
      partsSettle(failed);
      return;
    }
    // (window.hkV: the build's ?v= on an address put together here, web/shim/base.js)
    Promise.all(missing.map(function (file) {
      var u = '/hk/menu/' + file, href = window.hkV ? window.hkV(u) : u;
      var got = n ? import(href + (href.indexOf('?') < 0 ? '?' : '&') + 'retry=' + n) : import(href);
      return got.catch(function (err) { return err; });
    })).then(function (got) {
      var err = got.filter(function (r) { return r instanceof Error; })[0];
      var left = PARTS.filter(function (file) { return !(window.hkMenuParts || {})[partKey(file)]; });
      if (!left.length) { loadParts(then, n); return; }
      err = err || new Error(left[0] + ' ran without registering');
      if (n + 1 >= PARTS_TRIES) {
        console.error('[hk-menu] the parts did not start', err);
        partsSettle(err);
        // (given up: a later import of this file -- a page asking again at an address of its own -- starts over)
        delete started['hk-menu'];
        return;
      }
      console.warn('[hk-menu] a part did not load (' + err.message + '); again shortly');
      setTimeout(function () { loadParts(then, n + 1); }, Math.min(1000 * Math.pow(2, n), 15000));
    });
  }
  // ------------------------------------------------------------ end of the parts loader

  whenBase(function (C) {
    var M = C.menu;

    // --------------------------------------------------------------- look
    // Numbers are the design, so they are named. Measured against the Home
    // app's iPad sidebar and fitted to a wall tablet's 1280 x 800 CSS px.
    var W = 300;              // panel width (a phone: 82vw at most)
    var TAB_W = 26, TAB_H = 62; // the edge tab, in the 34 px left margin
    // THE TAB'S SIZE, a screen's own (board tab_size, 2026-09-30): Standard is
    // the tab that fits the margin; a finger on a wall tablet wants more, so
    // Large is the default and it may lie over the page's edge -- it is drawn
    // on top. Where Phones' menu shows (M.phoneForm(): a phone, either way
    // up, or a tablet whose own menu doesn't fit) it is Phones' size (tab_size_phone,
    // 2026-10-01), Standard unless chosen: there even the slim tab already
    // lies over the first column of tiles. [width, height, glyph].
    var TAB_SIZES = { standard: [TAB_W, TAB_H, 16], large: [36, 86, 20], xl: [46, 110, 24] };
    function tabSize() {
      var b = M.board() || {};
      if (M.phoneForm ? M.phoneForm() : (window.innerWidth || 1280) < M.NARROW) return TAB_SIZES[b.tab_size_phone] || TAB_SIZES.standard;
      return TAB_SIZES[b.tab_size] || TAB_SIZES.large;
    }
    var IDLE_MS = 60000;      // an open menu nobody touches closes itself
    // The time and weather's box inset: the list's 14 px plus a row's 14 px,
    // where the rows' glyphs and the section headings start. Their INK goes
    // 1 px further in (INK), which is where a glyph's ink actually begins.
    var NOW_PAD = 28, INK = 1;
    // The iPad band's roomier half (see publishLeft): 860 px of page and up.
    var BAND_WIDE = 860;
    var EASE = 'cubic-bezier(.32,.72,0,1)';   // UIKit's sheet curve
    // the highlight's slide: a touch past and back, as a UIKit spring (the tab bar's)
    var SPRING = 'cubic-bezier(.34,1.24,.42,1)';
    var build, close, CSS, docked, haUpdates, listKey, markHere, onPageChange, open, openHaSidebar, paintNow, place,
        room, S, scrolled, sync, toggle;
    function kit() {
      return {
        BAND_WIDE: BAND_WIDE, C: C, EASE: EASE, editItems: editItems, editKey: editKey, esc: esc, glyph: glyph,
        haKey: haKey, haList: haList, haOpen: haOpen, hostItems: hostItems, IDLE_MS: IDLE_MS, INK: INK,
        isHere: isHere, M: M, model: model, NOW_PAD: NOW_PAD, pagePaths: pagePaths, publishHeader: publishHeader,
        SH: SH, sidebarSource: sidebarSource, SPRING: SPRING, TAB_H: TAB_H, TAB_W: TAB_W, tabCentre: tabCentre,
        tabSize: tabSize, W: W
      };
    }
    function runParts() {
      var K = kit();
      PARTS.forEach(function (file) { window.hkMenuParts[partKey(file)](K); });
      build = K.build; close = K.close; CSS = K.CSS; docked = K.docked; haUpdates = K.haUpdates; listKey = K.listKey;
      markHere = K.markHere; onPageChange = K.onPageChange; open = K.open; openHaSidebar = K.openHaSidebar;
      paintNow = K.paintNow; place = K.place; room = K.room; S = K.S; scrolled = K.scrolled; sync = K.sync;
      toggle = K.toggle;
    }

    // ------------------------------------------------------------ wiring
    // The rest at the start of the next frame: the address changes before
    // Home Assistant builds the page, and sync measures (the round buttons'
    // rects for the scrolled tab, the panel) -- read here, mid-change, it
    // laid the page out once more than the frame does (measured headless, 6x
    // slower: ~40 ms of each page change on a chip-row board).
    var navFrame = 0;
    function onNav() {
      if (S.open) close(true);
      if (navFrame) return;
      navFrame = requestAnimationFrame(function () {
        navFrame = 0;
        sync();
        if (S.root && docked()) markHere();
      });
    }
    // the Now Playing pane coming, going or changing sides (hk-popup.js), the Side Pane's room (hk-sidepane.js): once,
    // in the frame it happens in (the view's margins are laid out with that frame). Each said it as a page swipe landed
    // between Home and the Pages screen, and each sync read the panel's box after the other had moved the page: three
    // layouts of the whole document in that one moment (2026-11-07, 15-22 ms each at 4x CPU)
    // THE VIEW'S MARGINS AT ONCE, though (written, nothing read): left for the frame, a page measuring itself before
    // it -- a push drawing the Pages screen as a swipe landed on it from Home -- drew in the Side Pane's old room, and
    // no resize ever told it otherwise: its icons small and to the left for a second (2026-11-08, the owner's video)
    var paneFrame = 0;

    var headerKey = '';
    function publishHeader() {
      if (!window.hkMenu.headerContext) return;
      var key = JSON.stringify(window.hkMenu.headerContext()) + location.pathname;
      if (key === headerKey) return;
      headerKey = key;
      window.dispatchEvent(new CustomEvent('hk-page-navigation'));
    }

    loadParts(function () {
      runParts();

      window.hkMenu._.CSS = CSS;               // tests (test_csssnapshot)
      try { S.shut = JSON.parse(localStorage.getItem('hk-menu-shut') || '{}') || {}; } catch (e) { S.shut = {}; }
      [SH.navEvent, 'popstate'].forEach(function (ev) { window.addEventListener(ev, onPageChange); });
      SH.onNavigate(onNav);
      window.addEventListener('popstate', onNav);
      window.addEventListener('hashchange', function () { if (S.open) close(true); });
      window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && S.open) { e.stopPropagation(); close(false, true); }
      });
      document.addEventListener('visibilitychange', function () { if (document.hidden && S.open) close(true); });
      // (and again once a rotation's safe areas have come: WebKit says resize first, and an iPhone turned upright kept the
      // Side Strip of its sideways inset until the next resize -- hkCards.safeArea measures afresh at 250 and 800 ms, 2026-11-10)
      window.addEventListener('resize', function () { sync(); setTimeout(sync, 300); setTimeout(sync, 900); });
      window.addEventListener('hk-module-ready', function () { S.built = ''; sync(); });
      // the host's Home Assistant rows changed (hkShell.haNav: it learned where the page is)
      window.addEventListener('hk-ha-nav-changed', function () { S.built = ''; sync(); });
      // Edit mode begun or ended (hk-edit.js): the Edit Page row goes or comes back
      // (an open menu draws again too: its rows are Edit mode's or not)
      window.addEventListener('hk-edit', function () { S.built = ''; sync(); if (S.open && S.list && listKey() !== S.built) { build(); markHere(); } });
      window.addEventListener('hk-pane', function () {
        try { room(!!S.wasDock && M.on()); } catch (e) { /* the frame's sync puts it right */ }
        if (paneFrame || navFrame) return;
        paneFrame = requestAnimationFrame(function () { paneFrame = 0; sync(); });
      });
      window.addEventListener('hk-menu-date', function () { place(); });
      // Captured at the document: the window's scroll, and any other scroller's
      // (a phone's <body> scrolls where overflow-x is `hidden`; scroll events
      // do not bubble, so a window listener never hears it).
      document.addEventListener('scroll', scrolled, { capture: true, passive: true });
      window.addEventListener('hk-menu-chip', scrolled);
      // The dashboard's config arrives (and changes) with the frontend's state
      // pushes; a list built before it is rebuilt at the next open.
      C.onClient(function () {
        if (!S.root && M.on()) sync();
        else if (S.root && (M.dash() !== S.dash)) { S.dash = M.dash(); S.built = ''; sync(); }
        else if (S.root && S.nowKey) paintNow();      // the weather, a Time & Date sensor
        if (S.haOn) haUpdates(C.client());
      });
      // THIS SCREEN'S OWN CLOCK moves without a push: looked at every 15 s,
      // written only when the minute has changed (paintNow compares).
      setInterval(function () { if (S.nowKey && !document.hidden) paintNow(); }, 15000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden && S.root) paintNow(); });
      sync();
      setTimeout(sync, 1500);    // the panel element and config can land after us on a cold load

      window.hkMenu.headerContext = function () {
        var available = !!S.root && M.on() && docked();
        return { available: available, exact: available && (S.items || []).some(function (it) { return isHere(it, location.pathname); }) };
      };
      window.hkMenu.open = open;
      window.hkMenu.close = close;
      window.hkMenu.toggle = toggle;
      window.hkMenu.isOpen = function () { return S.open; };
      // draw the list again now (Edit mode's preview, hk-edit-menu.js)
      window.hkMenu.rebuild = function () { if (S.list) { build(); markHere(); } };
      window.hkMenu.sync = sync;
      window.hkMenu.openHaSidebar = openHaSidebar;
      window.hkMenu._.state = function () { return S; };
      window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: { module: 'hk-menu' } }));
    });
  });
})();
