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
    var out = { home: null, top: [], categories: [], rooms: [] };
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
                     vacuums: 'vacuums', music: 'playmusic', browse: 'music-browse', water: 'water', energy: 'energy', power: 'power' };
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
                    'timers', 'vacuums', 'speakers', 'water', 'energy'];
  var KIND_PAGES = { weather_alert: ['weather'], security: ['security', 'alarm'],
                     doors_windows: ['doors-windows', 'doors', 'security'], climate: ['climate'], lights: ['lights'],
                     blinds: ['blinds', 'shades', 'climate'], timers: ['timers'], vacuums: ['vacuums'],
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

  window.hkMenu = { version: '1.1.0', _: { model: model, isHere: isHere, glyph: glyph, chipPaths: chipPaths, pagePaths: pagePaths,
                                           haItems: haItems, hostItems: hostItems, sidebarSource: sidebarSource,
                                           haNav: haNav, haList: haList, haOpen: haOpen, haKey: haKey,
                                           tabCentre: tabCentre, kinds: { ORDER: KIND_ORDER, PAGES: KIND_PAGES } } };

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
    var CSS = [
      ':host{all:initial}',
      '.root{position:fixed;left:0;top:0;width:0;height:0;z-index:6;',
      // the dashboard's font (hk-base.js FONT_ROOT): the menu hangs under
      // <body>, outside the view its theme is on
      '  ' + window.hkCards.FONT_ROOT + ';',
      '  -webkit-font-smoothing:antialiased;color:' + window.hkCards.v('ink') + '}',
      '.root.open{z-index:9}',
      '.scrim{position:fixed;inset:0;background:rgba(0,0,0,0.26);opacity:0;pointer-events:none;',
      '  transition:opacity .32s ease;-webkit-tap-highlight-color:transparent}',
      '.root.open .scrim{opacity:1;pointer-events:auto}',
      '.root.docked .scrim{display:none}',
      // THE PANEL. Its material is a layer of its own (.mat), so the panel is
      // not a backdrop root and the tab riding on its edge can still blur the
      // sky behind itself.
      // THE CLIP: the dashboard's own area. The panel slides out from ITS left
      // edge, so where Home Assistant's sidebar shows (no kiosk mode) a closed
      // panel is not left lying over it on a desktop.
      '.clip{position:fixed;left:var(--l,0px);top:var(--t,0px);right:0;height:var(--h,100vh);',
      '  overflow:hidden;pointer-events:none}',
      '.panel{position:absolute;left:0;top:0;height:100%;width:' + W + 'px;pointer-events:auto;',
      '  max-width:82vw;transform:translateX(-100%);transition:transform .38s ' + EASE + ';',
      '  display:flex;flex-direction:column;box-sizing:border-box;will-change:transform;',
      // the swipe that closes it (wireSwipe) is the page's to read: without
      // this a touch browser takes the sideways drag as its own after a few
      // pixels and sends pointercancel (down, move, move, cancel -- and the
      // menu stays open). Up and down still scroll.
      '  touch-action:pan-y}',
      '.root.open .panel,.root.docked .panel{transform:none}',
      // DOCKED BY ITSELF (a load, a window grown wide): in place, not slid in
      // -- and not drawn until the dashboard's left edge holds still (settle)
      '.root.still .panel{transition:none}',
      '.root.settling .panel{visibility:hidden}',
      '.mat{position:absolute;inset:0;background:rgba(28,28,32,0.52);',
      '  -webkit-backdrop-filter:blur(34px) saturate(1.9);backdrop-filter:blur(34px) saturate(1.9);',  // hkCards.BLUR.heavy
      '  border-right:1px solid rgba(255,255,255,0.10);pointer-events:none}',
      '.root.frosted .mat{background:rgba(34,38,56,0.95);-webkit-backdrop-filter:none;backdrop-filter:none}',
      // TINTED (no blur anywhere): the tab bar's Tinted -- the panel is
      // always up on a wall tablet, so a blur here would run every frame the
      // sky moves; near-solid, as a see-through panel over the land is not
      // read (the tab bar measured the same, 2026-10-05)
      '.root.tinted .mat{background:rgba(24,24,28,0.93);-webkit-backdrop-filter:none;backdrop-filter:none}',
      // The open panel's shadow, under the tab (z -2): on .mat it would fall
      // over the tab, which sits BEHIND the material (below).
      '.panel::before{content:"";position:absolute;inset:0;z-index:-2;pointer-events:none;',
      '  transition:box-shadow .38s ' + EASE + '}',
      '.root.open .panel::before{box-shadow:14px 0 44px rgba(0,0,0,0.26)}',
      // THE LIST. 14 px in from both panel edges, so a selected row's pill has
      // the same margin all round; 44 px rows (Apple's touch minimum) with 2 px
      // between them, so two selections never touch.
      // CLEAR OF THE STATUS BAR (on an iPhone, "Home" would sit under the
      // time and the Dynamic Island). The Home Assistant app draws
      // the page edge to edge, so the list starts below the device's safe
      // area -- env(), zero where there is none -- and scrolls away under a
      // fade that ends there too (the list's own fades, in the menu's <style>).
      // --hk-safe-top overrides it, for testing.
      '.list{position:relative;flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;',
      '  -webkit-overflow-scrolling:touch;scrollbar-width:none;box-sizing:border-box;',
      '  --safe:var(--hk-safe-top,env(safe-area-inset-top,0px));',
      '  padding:calc(22px + var(--safe)) 14px calc(28px + env(safe-area-inset-bottom,0px))',
      '    calc(14px + env(safe-area-inset-left,0px))}',
      '.list::-webkit-scrollbar{display:none}',
      // THE NOW-PLAYING BAR LIES OVER A DOCKED MENU'S FOOT (it runs the
      // dashboard's full width, hk-popup.js), and says how much of the
      // screen's bottom it covers (--hk-bar-h): the list gets that much more
      // room at its end, so its last rows still scroll up clear of the bar.
      '.root.docked .list{padding-bottom:calc(28px + env(safe-area-inset-bottom,0px) + var(--hk-bar-h,0px) - var(--hk-dock-h,0px))}',
      // DOCKED, the panel ends above the docked now-playing bar, which runs
      // the screen's whole width under it (hk-popup.js --hk-dock-h); a bar
      // that floats over the page still lies over its foot (--hk-bar-h above)
      '.root.docked .panel{height:calc(100% - var(--hk-dock-h,0px))}',
      // THE TIME AND WEATHER (Configure: "Time and weather in the menu on
      // these dashboards"), only while the menu is docked. Fixed above the
      // list -- only the rows scroll, under the hairline -- and no plate of
      // its own (a box round it looks out of place). Two
      // short lines for 300 px: "1:12 PM" beside "76°", then "Sunday, Sep 27"
      // beside "Sunny · Feels 75°". Its ink starts on the column the rows'
      // glyphs and the section headings start on (x = 29) and ends where it
      // starts from the other edge (x = 271): paintNow() measures each line's
      // side bearing, since a "1" starts well inside its own box.
      '.now{position:relative;flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto;',
      '  column-gap:12px;row-gap:5px;align-items:end;box-sizing:border-box;color:' + window.hkCards.v('ink') + ';',
      // Match the page inset, then lift the block 6px for the 44px clock's
      // extra space above its visible digits compared with the status labels.
      '  padding:calc((100vw - var(--hk-page-left,0px) - var(--hk-page-right,0px)) * var(--hk-side,0.02) - 2px + var(--hk-safe-top,env(safe-area-inset-top,0px))) ' + NOW_PAD + 'px 20px ' + NOW_PAD + 'px}',
      '.now[hidden],.rule[hidden]{display:none}',
      '.now .tm{display:flex;align-items:baseline;gap:4px;min-width:0;white-space:nowrap}',
      '.now .t{font-size:44px;font-weight:600;line-height:1;letter-spacing:0}',
      '.now .ap{font-size:16px;font-weight:500;line-height:1;color:' + window.hkCards.v('ink-2') + '}',
      '.now .wx{justify-self:end;display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent}',
      '.now .g{display:flex;width:28px;height:28px}',
      '.now .tp{font-size:32px;font-weight:500;line-height:1;letter-spacing:0}',
      '.now .d,.now .c{font-size:14px;font-weight:600;line-height:1.2;letter-spacing:0;color:' + window.hkCards.v('ink-2') + ';',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.now .c{justify-self:end;text-align:right;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      // a border, snapped to device pixels (a filled 1 px box fell between them
      // on a Mac at 1.5x-1.7x and drew at half strength: hk-settings-kit.js)
      '.rule{position:relative;flex:none;height:0;margin:0 14px;border-top:1px solid rgba(255,255,255,0.14)}',
      // the safe area is the time's to clear, not the list's
      '.panel.has-now .list{--safe:0px}',
      '.row{display:flex;align-items:center;gap:14px;width:100%;height:44px;box-sizing:border-box;',
      '  padding:0 14px;border:0;border-radius:12px;background:none;color:' + window.hkCards.v('ink') + ';',
      '  font:inherit;font-size:17px;font-weight:400;letter-spacing:-0.41px;text-align:left;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease}',
      '.row + .row{margin-top:2px}',
      // the highlight: the screen's Highlight Colour (paintIcons), Apple's orange by default
      '.row hk-icon{--mdc-icon-size:22px;width:22px;height:22px;flex:none;display:flex;color:' + window.hkCards.v('accent') + '}',
      '.row span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE HIGHLIGHT SLIDES TO THE NEW ROW (2026-10-10), as the tab bar's
      // does: it is a layer behind the row (::before), started over the row
      // you were on (--hx/--hy, --sx/--sy, slideHere) and let go -- a short
      // spring down or up the list. A transform: the compositor's, no layout.
      '.row{position:relative;isolation:isolate}',
      '.row.here{color:var(--hk-on-accent,#fff)}',
      '.row.here::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;',
      '  background:var(--hk-here,' + window.hkCards.v('accent') + ');transform-origin:0 0;',
      '  transform:translate(var(--hx,0px),var(--hy,0px)) scale(var(--sx,1),var(--sy,1));',
      '  transition:transform .42s ' + SPRING + '}',
      '.row.here.slide-from::before{transition:none}',
      '.row.here hk-icon{color:var(--hk-on-accent,#fff)}',
      // the Home Assistant section: iOS count bubbles, "More" and its rows
      '.row .bdg{flex:none;min-width:22px;height:22px;padding:0 7px;box-sizing:border-box;border-radius:11px;',
      '  background:#ff3b30;color:#fff;font-size:13px;font-weight:600;line-height:22px;text-align:center;letter-spacing:0}',
      '.row .bdg[hidden]{display:none}',
      '.row.more svg{flex:none;opacity:.45;transform:rotate(-90deg);transition:transform .2s ease}',
      '.row.more[aria-expanded="true"] svg{transform:none}',
      '.row.sub{height:40px;padding-left:50px;font-size:15px;color:' + window.hkCards.v('ink') + '}',
      '.row.sub hk-icon{--mdc-icon-size:20px;width:20px;height:20px;color:rgba(235,235,245,0.6)}',
      '@media (hover:hover){.row:not(.here):hover{background:rgba(255,255,255,0.07)}}',
      '.row:focus-visible,.sh:focus-visible,.tab:focus-visible{outline:2px solid rgba(255,255,255,0.7);outline-offset:-2px}',
      // SECTION HEADINGS: the Home app's "Categories" / "Rooms", which fold.
      '.sh{display:flex;align-items:center;justify-content:space-between;width:100%;height:36px;',
      '  box-sizing:border-box;margin:16px 0 2px;padding:0 14px;border:0;background:none;',
      '  color:' + window.hkCards.v('ink-2') + ';font:inherit;font-size:15px;font-weight:600;letter-spacing:-0.24px;',
      '  cursor:pointer;-webkit-tap-highlight-color:transparent}',
      // the fold chevron keeps its own color (an icon, not on the text scale)
      '.sh svg{transition:transform .2s ease;color:rgba(235,235,245,0.60)}',
      '.sh.shut svg{transform:rotate(-90deg)}',
      // THE EDGE TAB rides on the panel's right edge: closed, it is all that
      // shows, in the page's left margin; open, it becomes the close handle.
      // Its touch area grows up, down and off the screen -- never right, where
      // the first column of tiles is 8 px away.
      // 26 px at EVERY width, a wall tablet's size: a 14 px tab on a phone is
      // hard to hit with a thumb. Narrower than a wall tablet's 29.6 px
      // margin -- an iPad held upright (18.9), a phone (16) -- it lies over
      // the first column's edge; it only shows there when the screen asks for
      // it (On Narrow Screens).
      // BEHIND THE MENU (z -1 in the panel): sliding in or out it passes
      // under the material's edge, never across it.
      '.tab{position:absolute;z-index:-1;left:100%;top:var(--tab-y,84px);width:var(--tab-w,' + TAB_W + 'px);height:var(--tab-h,' + TAB_H + 'px);',
      '  box-sizing:border-box;padding:0;margin:0;border:1px solid rgba(255,255,255,0.14);border-left:0;',
      '  border-radius:0 var(--tab-r,15px) var(--tab-r,15px) 0;display:none;align-items:center;justify-content:center;',
      '  color:rgba(255,255,255,0.92);cursor:pointer;-webkit-tap-highlight-color:transparent;',
      // The chips' glass, with a thin neutral tint under it: 26 px of glass
      // over a seasonal leaf would take the leaf's color outright.
      '  background:linear-gradient(145deg,rgba(255,255,255,0.17),rgba(255,255,255,0.07)),rgba(26,30,46,0.24);',
      '  -webkit-backdrop-filter:blur(20px) saturate(1.15) brightness(0.86);',
      '  backdrop-filter:blur(20px) saturate(1.15) brightness(0.86);',
      '  box-shadow:inset 0 1px 0 rgba(255,255,255,0.20),0 6px 18px rgba(0,0,0,0.12);',
      '  transition:transform .12s ease,filter .12s ease}',
      '.root.frosted .tab{-webkit-backdrop-filter:none;backdrop-filter:none;',
      '  background:linear-gradient(145deg,rgba(255,255,255,0.18),rgba(255,255,255,0.09)),rgba(58,60,68,0.55)}',
      // the tab and the button are plates on the page: the cards' Tinted plate
      '.root.tinted .tab,.root.tinted .fab{-webkit-backdrop-filter:none;backdrop-filter:none;',
      '  background:var(--hk-glass-plate);border-color:transparent;box-shadow:var(--hk-look-shadow)}',
      '.root.tabbed .tab{display:flex}',
      // the scrolled tab: always there, out past the edge until the chip is
      // scrolled away (sync / scrolled below)
      '.root.tabscroll .tab{display:flex;transform:translateX(-100%);visibility:hidden;',
      '  transition:transform .22s ease,visibility 0s linear .22s,filter .12s ease}',
      '.root.tabscroll.tabbed .tab{transform:none;visibility:visible;',
      '  transition:transform .22s ease,visibility 0s,filter .12s ease}',
      '.root.docked .tab{display:none}',
      // the finger's target is bigger than the glass: above, below and out
      // over the page (the tab is on top of the page, so it may)
      '.tab::before{content:"";position:absolute;top:-16px;bottom:-16px;left:-4px;right:-14px}',
      '.tab:active{filter:brightness(1.25)}',
      '.tab hk-icon{--mdc-icon-size:var(--tab-ic,16px);width:var(--tab-ic,16px);height:var(--tab-ic,16px);display:flex;margin-left:-1px}',
      '.tab svg{display:none;margin-left:-1px;width:calc(var(--tab-ic,16px) - 2px);height:calc(var(--tab-ic,16px) - 2px)}',
      '.root.open .tab hk-icon{display:none}',
      '.root.open .tab svg{display:block}',
      // A PHONE'S HOME WITH NO CHIP to hold the menu button: a round one of
      // its own, top left. The last resort; every other page has its back
      // button, which carries the menu button on a phone.
      '.fab{position:fixed;left:calc(var(--l,0px) + 12px);',
      '  top:calc(var(--t,0px) + 12px + var(--hk-safe-top,env(safe-area-inset-top,0px)));width:40px;height:40px;',
      '  border-radius:50%;border:1px solid rgba(255,255,255,0.14);display:none;align-items:center;',
      '  justify-content:center;padding:0;color:rgba(255,255,255,0.92);cursor:pointer;',
      '  background:linear-gradient(145deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07));',
      '  -webkit-backdrop-filter:blur(20px) saturate(1.4) brightness(0.82);backdrop-filter:blur(20px) saturate(1.4) brightness(0.82)}',
      '.root.fabbed .fab{display:flex}',
      '.root.open .fab{display:none}',
      '.fab hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:flex}',
      // THE EDGE SWIPE'S STRIP (wireEdge): the page's left margin, invisible,
      // under the tab (the clip paints after it). touch-action pan-y: a drag
      // up or down still scrolls the page, but a sideways one is ours -- no
      // browser takes it for a back swipe or a scroll, and no tile under it
      // takes the touch.
      // Below Home Assistant's toolbar while it shows: its menu button is there.
      '.edge{position:fixed;left:var(--l,0px);top:var(--edge-t,0px);bottom:0;width:var(--edge-w,20px);',
      '  display:none;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}',
      '.root.swipe .edge{display:block}',
      '.root.open .edge,.root.docked .edge{display:none}',
      // following the finger: no easing while it drags
      '.root.dragging .panel,.root.dragging .scrim{transition:none}',
      '@media (prefers-reduced-motion:reduce){.panel,.scrim,.sh svg,.row.more svg,.root.tabscroll .tab,.row.here::before{transition:none}}'
    ].join('\n');
    window.hkMenu._.CSS = CSS;               // tests (test_csssnapshot)

    var CHEV_L = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"' +
      ' stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M15 4.5 L7.5 12 L15 19.5"/></svg>';
    var CHEV_D = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"' +
      ' stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5 9 L12 16 L19 9"/></svg>';

    // ------------------------------------------------------------- state
    var S = { host: null, root: null, open: false, dash: null, idle: null, shut: {}, built: '' };
    try { S.shut = JSON.parse(localStorage.getItem('hk-menu-shut') || '{}') || {}; } catch (e) { S.shut = {}; }

    function haRoot() { return SH.overlayRoot(); }
    function narrow() { return (window.innerWidth || 1280) < M.NARROW; }
    // Its item's Menu: "Always open beside the page", when there is room.
    function docked() { return M.docked(); }

    function mount() {
      if (S.host && S.host.isConnected) return true;
      var r = haRoot();
      if (!r) return false;
      S.host = document.createElement('div');
      S.host.id = 'hk-menu';
      var sr = S.host.attachShadow({ mode: 'open' });
      window.hkCards.flatSurface(S.host, 'menu');
      // (and the list's edges, the sheet's shadows: hk-base.js edgeCss)
      sr.innerHTML = '<style>' + CSS + window.hkCards.flatCss() + (window.hkCards.edgeCss ? window.hkCards.edgeCss() : '') +
        ':host([hk-flat]) .mat{background:var(--hk-flat-menu)!important;border-color:var(--hk-line)}' +
        ':host([hk-flat]) .panel::before{box-shadow:var(--hk-flat-elevated-shadow)!important}' +
        ':host([hk-flat]) .tab,:host([hk-flat]) .fab{background:var(--hk-flat-elevated)!important;color:var(--hk-ink)}' +
        // the page you're on: the highlight's solid fill, its text and icon
        // white -- as the other looks (the user, 2026-10-17: the tint with an
        // accent name and a white icon read as two tones)
        ':host([hk-flat]) .row.here::before{transform:none}' +
        // the list clipped under the device's safe area, in every look
        '.hk-edge>.list{-webkit-mask-image:linear-gradient(transparent 0,transparent var(--safe),#000 var(--safe));' +
        'mask-image:linear-gradient(transparent 0,transparent var(--safe),#000 var(--safe))}' +
        '</style>' +
        '<div class="root" part="root">' +
          '<div class="scrim"></div><div class="edge" aria-hidden="true"></div>' +
          '<div class="clip"><nav class="panel" aria-label="Menu" aria-hidden="true">' +
            '<div class="mat"></div>' +
            '<div class="now" hidden><div class="tm"><span class="t"></span><span class="ap"></span></div>' +
              '<div class="wx" role="link" aria-label="Weather"><span class="g"></span><span class="tp"></span></div>' +
              '<div class="d"></div><div class="c" role="link" aria-label="Weather"></div></div>' +
            '<div class="rule" hidden></div><div class="hk-edge"><div class="list"></div></div>' +
            '<button class="tab" aria-label="Menu" aria-expanded="false"><hk-icon></hk-icon>' + CHEV_L + '</button>' +
          '</nav></div>' +
          '<button class="fab" aria-label="Menu"><hk-icon></hk-icon></button>' +
        '</div>';
      S.root = sr.querySelector('.root');
      S.panel = sr.querySelector('.panel');
      S.list = sr.querySelector('.list');
      if (window.hkCards.edges) window.hkCards.edges(sr.querySelector('.hk-edge'));
      S.scrim = sr.querySelector('.scrim');
      S.now = sr.querySelector('.now');
      // fitted again whenever its width changes: a fit made while the menu
      // was hidden or still docking left "Feels" in and cut the date off
      // (the user, 2026-10-17)
      if (typeof ResizeObserver !== 'undefined') {
        var nowW = 0;
        new ResizeObserver(function (es) {
          var w = Math.round(es[0].contentRect.width);
          if (w && w !== nowW) { nowW = w; if (S.nowLines && nowOn()) fitNow(); }
        }).observe(S.now);
      }
      S.rule = sr.querySelector('.rule');
      [sr.querySelector('.now .wx'), sr.querySelector('.now .c')].forEach(function (el) {
        el.addEventListener('click', function () { goWeather(); });
      });
      S.tab = sr.querySelector('.tab');
      S.fab = sr.querySelector('.fab');
      S.mat = sr.querySelector('.mat');
      // the panel slid in or out: its pinned glass is cut again where it is
      S.panel.addEventListener('transitionend', function () { if (window.hkGlass && window.hkGlass.repin) window.hkGlass.repin(); });
      sr.querySelector('.scrim').addEventListener('click', function () { close(); });
      S.tab.addEventListener('click', function (e) {
        e.stopPropagation();
        // a swipe that started on the tab and opened the menu is not a tap
        if (Date.now() - (S.pulled || 0) < 500) return;
        toggle(!e.detail);                 // detail 0: pressed with a key, not tapped
      });
      S.fab.addEventListener('click', function (e) { e.stopPropagation(); open(); });
      S.list.addEventListener('click', onList);
      // Anything done INSIDE the menu is activity: it keeps it open.
      ['pointerdown', 'wheel', 'keydown'].forEach(function (t) {
        S.panel.addEventListener(t, armIdle, { passive: true });
      });
      wireSwipe();
      S.edge = sr.querySelector('.edge');
      // TOUCH ADJUSTMENT: Chrome moves a finger's touch onto the nearest
      // element that answers a tap, and pointer listeners alone do not make
      // one -- measured, a touch 3 px from the edge went to the tile 13 px
      // away, or to <html>, about half the time. A click listener does (and
      // does nothing: a tap that lands here passes on as it would).
      S.edge.addEventListener('click', function () {});
      wireEdge(S.edge);
      wireEdge(S.tab);
      r.appendChild(S.host);
      return true;
    }

    // THE PANEL COVERS THE DASHBOARD, not the whole window: on a desktop
    // Home Assistant's own sidebar stays visible to its left, and on a phone
    // the menu runs from the top of the screen like the Home app's.
    function place() {
      if (!S.root) return;
      // The SCREEN's height, not the panel's: the document is what scrolls,
      // so on a long page the panel is as tall as the page (thousands of px
      // on a phone) while the menu must fill only what is visible.
      var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      var l = r ? r.left : 0, t = r ? Math.max(0, r.top) : 0;
      var h = Math.max(0, (window.innerHeight || 800) - t);
      S.root.style.setProperty('--l', l + 'px');
      S.root.style.setProperty('--t', t + 'px');
      S.root.style.setProperty('--h', h + 'px');
      S.root.style.setProperty('--edge-w', edgeWidth(r ? r.width : (window.innerWidth || 0)) + 'px');
      // THE TAB, centered on the date line (hk-header-card publishes it per
      // dashboard, from the top of the page); without one yet, where the Home
      // header's date sits on a wall tablet. The tab lives in the panel, whose
      // top is the dashboard's -- the page starts lower when HA's toolbar shows.
      var top = M.viewTop();
      // the toolbar's height: the page's top at rest, less the panel's
      var bar = r ? Math.max(0, top - (r.top + (window.scrollY || 0))) : 0;
      S.root.style.setProperty('--edge-t', (t + bar) + 'px');
      var ts = tabSize();
      S.root.style.setProperty('--tab-w', ts[0] + 'px');
      S.root.style.setProperty('--tab-h', ts[1] + 'px');
      S.root.style.setProperty('--tab-ic', ts[2] + 'px');
      S.root.style.setProperty('--tab-r', Math.round(ts[0] * 15 / TAB_W) + 'px');
      var y = tabCentre(M.board().tab_position || '', M.dateY(),
                        Math.max(0, (window.innerHeight || 800) - Math.max(0, top)), ts[1]);
      S.root.style.setProperty('--tab-y', ((top - t) + y - ts[1] / 2) + 'px');
    }

    // WHERE THE DASHBOARD STARTS, for the sheets (hk-popup.js, hk-detail.js):
    //   --hk-content-left  past Home Assistant's own sidebar, when it shows.
    //                      A modal sheet centers in the rest -- the WHOLE
    //                      dashboard, this menu included, docked or not: the
    //                      menu is the dashboard's own, Home Assistant's
    //                      sidebar is not.
    //   --hk-page-left     ...and past this menu when it is docked: where a
    //                      sheet that is not modal (the now-playing bar) starts,
    //                      so it never lies over the menu's last rows.
    // Backdrops still cover everything; only the sheet moves.
    function publishLeft() {
      var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      var left = Math.max(0, r ? r.left : 0);
      var de = document.documentElement;
      if (!de || !de.style) return;
      // (--hk-menu-right: where the page would start with no pane -- the
      // pop-up asks it whether a pane fits; --hk-page-right: the pane's
      // width on the right, where the page ends)
      var menuRight = left + (S.root && M.on() && docked() ? W : 0), ps = paneSides();
      var pageLeft = menuRight + ps.l;
      [['--hk-content-left', left], ['--hk-page-left', pageLeft], ['--hk-menu-right', menuRight], ['--hk-page-right', ps.r]].forEach(function (kv) {
        var v = Math.round(kv[1] * 10) / 10 + 'px';
        if (de.style.getPropertyValue(kv[0]) !== v) de.style.setProperty(kv[0], v);
      });
      // THE iPAD BAND IS THE PAGE'S WIDTH, NOT THE WINDOW'S. A
      // 1,280 px tablet with the menu docked has a 980 px page -- an iPad's
      // -- and takes the iPad pill (five across) and page layouts, which
      // css/hk-responsive.css applies under [data-hk-band] as well as under
      // its media query (which only knows the window).
      // "wide" from 860 px of page: a tablet with the menu open (980), an
      // iPad held sideways -- room for the tablet's own arrangement where the
      // iPad's was a squeeze (hk-responsive.css, [data-hk-band="wide"]).
      var pw = (window.innerWidth || 0) - pageLeft - ps.r;
      var band = pw > M.NARROW && pw < M.TAB_MIN ? (pw >= BAND_WIDE ? 'wide' : 'narrow') : null;
      if (band !== de.getAttribute('data-hk-band')) {
        if (band) de.setAttribute('data-hk-band', band); else de.removeAttribute('data-hk-band');
      }
    }
    // The panel's size and place change without a window resize when Home
    // Assistant's sidebar expands or collapses; watched while the menu is on.
    function watchPanel() {
      var p = M.panel();
      if (!window.ResizeObserver || !p || S.watched === p) return;
      if (S.ro) S.ro.disconnect();
      S.ro = new ResizeObserver(function () { sync(); });
      S.ro.observe(p);
      S.watched = p;
    }

    function paintIcons() {
      var icon = M.icon();
      // (an hk-base.js from before 1.5 has no accent: the orange stays)
      var a = typeof M.accent === 'function' ? M.accent() : null;
      if (a && S.host) {
        // the icons the highlight (base); the page you're on its own color
        // (Highlight Color Automatic: only that row changes)
        S.host.style.setProperty('--hk-accent', a.base || a.color);
        S.host.style.setProperty('--hk-here', a.color);
        S.host.style.setProperty('--hk-on-accent', a.on);
      }
      [S.tab, S.fab].forEach(function (b) {
        var i = b && b.querySelector('hk-icon');
        if (i && i.getAttribute('icon') !== icon) i.setAttribute('icon', icon);
      });
    }

    // A MENU DOCKING BY ITSELF (2026-10-09). On a load the dashboard's left
    // edge is still moving -- Home Assistant's sidebar going (hk-kiosk.js)
    // -- and the menu slid in from where the sidebar had been, then settled
    // a little further left: a bounce on every load (screen-recorded). So it
    // waits, unseen, until that edge holds still for SETTLE_FRAMES frames
    // (at most SETTLE_MAX), then is drawn in place with no slide; the slide
    // stays for opening it by hand.
    var SETTLE_FRAMES = 2, SETTLE_MAX = 30;
    function settle() {
      var run = S.settleRun = (S.settleRun || 0) + 1, last = null, same = 0, n = 0;
      S.still = true; S.settling = true;
      var cls = function (c, on) { if (S.root) S.root.classList.toggle(c, on); };
      cls('still', true); cls('settling', true);
      var frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (f) { return setTimeout(f, 16); };
      (function look() {
        if (run !== S.settleRun) return;
        var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
        var l = r ? Math.round(r.left) : 0;
        same = l === last ? same + 1 : 0; last = l; n++;
        if (same < SETTLE_FRAMES && n < SETTLE_MAX) { frame(look); return; }
        place();
        S.settling = false; cls('settling', false);
        // the slide back on after the frame it was drawn in
        frame(function () { frame(function () { if (run === S.settleRun) { S.still = false; cls('still', false); } }); });
      })();
    }

    // Everything that can change which pieces show: called on every page
    // change, settings change, resize and state push -- all cheap, all
    // idempotent.
    function sync() {
      var on = M.on();
      watchPanel();
      guardDrawer();
      if (!on) {
        if (S.open) close(true);
        undock();
        if (S.root) S.root.className = 'root';
        publishHeader();
        paintNow();
        publishLeft();
        return;
      }
      if (!mount()) { undock(); publishLeft(); return; }
      var style = M.style(), dock = docked();
      var glass = document.documentElement.getAttribute('data-hk-glass');
      var home = isHome();
      var cls = ['root'];
      if (glass === 'frosted' || glass === 'tinted') cls.push(glass);
      pinGlass(glass === 'blur_pre');
      var tabAt = typeof M.tab === 'function' ? M.tab() : (style === 'tab' ? 'always' : 'never');
      // a menu docking by itself appears where it belongs (settle)
      if (dock && !S.wasDock) settle();
      S.wasDock = dock;
      if (S.still) cls.push('still');
      if (S.settling) cls.push('settling');
      if (dock) cls.push('docked');
      else if (tabAt === 'always') cls.push('tabbed');
      // While the menu is open the tab stays as it was when it opened:
      // otherwise the page scrolling behind an open menu moves the chip in
      // and out of sight, and the tab (its close handle) slides back and
      // forth over the menu. Closing looks again.
      else if (tabAt === 'scrolled') {
        cls.push('tabscroll');
        if (S.open ? S.root.classList.contains('tabbed') : chipGone()) cls.push('tabbed');
      }
      // a phone's Home with no chip to hold the button
      else if (style === 'chip' && narrow() && home && !homeHasChip()) cls.push('fabbed');
      if (S.open && !dock) cls.push('open');
      if (swipeOn()) cls.push('swipe');
      if (S.drag && S.drag.live) cls.push('dragging');
      S.root.className = cls.join(' ');
      S.panel.setAttribute('aria-hidden', (S.open || dock) ? 'false' : 'true');
      S.tab.setAttribute('aria-expanded', S.open ? 'true' : 'false');
      paintIcons();
      place();
      if (dock) { dockTo(); if (listKey() !== S.built) build(); markHere(); }
      else undock();
      paintNow();
      publishLeft();
      publishHeader();
    }

    // ------------------------------------------------ the scrolled tab
    // Its item's Menu: "Chip, the tab once scrolled past" / "Chip on Home, tab
    // on the other pages" (hk-base.js menu.tab() says 'scrolled'): the tab
    // slides in while every round button on the page is out of sight, and
    // back out when one returns. The buttons are the cards' own <hk-plate>s
    // (menu.chips()), looked at on scroll -- one or two rects a frame, and
    // only on such a dashboard.
    //
    // A page whose button has not drawn yet (just navigated) is given a
    // moment before the tab counts it as missing, so it does not flash in and
    // straight back out.
    var CHIP_WAIT = 600;
    function chipGone() {
      var els = typeof M.chips === 'function' ? M.chips() : [];
      if (!els.length) {
        if (!S.noChip) {
          S.noChip = Date.now();
          setTimeout(function () { if (S.noChip) sync(); }, CHIP_WAIT + 20);
        }
        return Date.now() - S.noChip >= CHIP_WAIT;
      }
      S.noChip = 0;
      // the top of what shows: under Home Assistant's toolbar, which stays
      // put while the page scrolls (viewTop is the page's top at rest)
      var p = M.panel(), r = p && p.getBoundingClientRect ? p.getBoundingClientRect() : null;
      var rest = r ? r.top + (window.scrollY || 0) : 0;
      var edge = Math.max(0, r ? r.top : 0) + Math.max(0, M.viewTop() - rest), vh = window.innerHeight || 800;
      return !els.some(function (el) {
        var r = el.getBoundingClientRect();
        var mid = (r.top + r.bottom) / 2;         // half of it gone counts as gone
        return r.width > 0 && mid > edge && mid < vh;
      });
    }
    function scrolled() {
      if (S.scrollRaf || !S.root || S.open || !S.root.classList.contains('tabscroll')) return;
      S.scrollRaf = requestAnimationFrame(function () {
        S.scrollRaf = 0;
        if (S.open || !S.root.classList.contains('tabscroll')) return;
        var gone = chipGone();
        if (gone !== S.root.classList.contains('tabbed')) S.root.classList.toggle('tabbed', gone);
      });
    }

    // ------------------------------------------------ the time and weather
    function nowOn() {
      return !!S.root && docked() && typeof M.hasTime === 'function' && M.hasTime();
    }
    // WITH A PICTURE OF THE SKY (Blur Mode Pre-rendered, hk-glass.js
    // PINNED): the panel, the edge tab and the button wear their slice of it
    // under their own tints instead of blurring the moving sky live -- the
    // panel is a full-height blur of it on every page
    var PIN_TINTS = [['mat', 'linear-gradient(rgba(28,28,32,0.52),rgba(28,28,32,0.52))'],
                     ['tab', 'linear-gradient(145deg,rgba(255,255,255,0.17),rgba(255,255,255,0.07)),linear-gradient(rgba(26,30,46,0.24),rgba(26,30,46,0.24))'],
                     ['fab', 'linear-gradient(145deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07))']];
    function pinGlass(on) {
      var G = window.hkGlass;
      if (!G || !G.pin) return;
      PIN_TINTS.forEach(function (p) { if (S[p[0]]) { if (on) G.pin(S[p[0]], p[1]); else G.unpin(S[p[0]]); } });
    }
    function paintNow() {
      if (!S.root) return;
      var on = nowOn();
      S.panel.classList.toggle('has-now', on);
      S.now.hidden = !on;
      S.rule.hidden = !on;
      var H = window.hkHeader, h = C.client();
      if (!on) { S.nowKey = ''; if (H && H.nowDone) H.nowDone(); return; }
      if (!H || typeof H.now !== 'function' || !h || !h.states) return;
      var v = H.now(h.states, C.subscriptions(h));
      // wxReady: the home's weather glyphs arriving swaps the Material stand-in
      // for the real one, with no weather change to say so.
      var ready = H.wxReady ? H.wxReady() : '';
      var key = [v.time, v.ampm, v.date, v.state, v.night, v.temp, v.condition, v.feels, v.high, v.low, ready].join('|');
      if (key === S.nowKey) return;
      var glyph = v.state + '|' + v.night + '|' + ready;
      S.nowKey = key;
      var q = function (sel) { return S.now.querySelector(sel); };
      q('.t').textContent = v.time;
      q('.ap').textContent = v.ampm;
      q('.tp').textContent = v.temp;
      q('.d').textContent = v.date;
      if (S.nowGlyph !== glyph) { S.nowGlyph = glyph; q('.g').innerHTML = H.wxSvg(v.state, 28, { night: v.night }); }
      S.nowCond = v.condition;
      S.nowLines = nowLines(v);
      fitNow();
    }
    // WHAT GOES BESIDE THE DATE, fullest first; fitNow takes the first that
    // leaves the date whole (the user, 2026-10-17): today's high and low, as
    // iOS's Weather widget has them -- "Sunny · H:71° L:52°", then the high
    // alone, then the condition alone. "Feels" only when it says something
    // the big temperature doesn't (3° or more off it), in the high's place.
    // No forecast: "Sunny · Feels 60°", then "Sunny", as before.
    var FEELS_APART = 3;
    function nowLines(v) {
      var c = v.condition || '', dot = function (x) { return c ? c + ' \u00b7 ' + x : x; };
      var hi = v.high != null ? 'H:' + v.high + '\u00b0' : '', lo = v.low != null ? 'L:' + v.low + '\u00b0' : '';
      var odd = v.feels && v.feelsN != null && v.tempN != null && Math.abs(v.feelsN - v.tempN) >= FEELS_APART;
      var out = [];
      if (hi) {
        if (lo) out.push(dot(hi + ' ' + lo));
        out.push(dot(odd ? v.feels : hi));
      } else if (v.feels) out.push(dot(v.feels));
      out.push(c || (out.length ? out[out.length - 1] : ''));
      return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    }
    // The fullest of nowLines() that fits beside the date -- the date is
    // never the one squeezed. Then each
    // line's ink is put on the column (see the CSS note).
    //
    // SF PRO'S SIDE BEARINGS, MEASURED, in em, off a 4x render of the font
    // every screen loads from /hk/ at the optical size the page draws it --
    // not canvas measureText, which is not the same everywhere: Chrome's
    // canvas skips SF Pro's display optical size, so "79°" lands 0.5 px past
    // "Feels 79°" there and about 1 px short of it elsewhere. The font file
    // is the same on every screen; its bearings are too. Only the glyphs that
    // can start or end a line:
    var LB_TIME = { 1: .0398, 2: .0398, 3: .0398, 4: .0341, 5: .0511, 6: .0398, 7: .0284, 8: .0398, 9: .0455 }; // 600 44px
    var LB_DATE = { S: .0536, M: .0893, T: .0357, W: .0357, F: .0893 };                                    // 600 14px
    var RB_TEMP = .0496;                                                                                   // "°" 500 32px
    var RB_LINE = { '\u00b0': .0519, a: .0592, d: .0681, e: .0379, g: .0619, h: .0642, k: .0285, l: .0670,
                    n: .0592, r: .0246, s: .0525, t: .0391, w: .0374, y: .0257 };                           // 600 14px
    // whether `el`'s one line of text is wider than its box: the text's own
    // width (a Range), not scrollWidth -- Safari reports an ellipsized
    // line's scrollWidth as its box's, so the date was cut with "Feels"
    // still beside it (the user, 2026-10-17)
    function clipped(el) {
      var box = el.getBoundingClientRect().width;
      if (!box || !document.createRange) return false;
      var r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().width > box + 0.5;
    }
    function fitNow() {
      var q = function (sel) { return S.now.querySelector(sel); };
      var c = q('.c'), d = q('.d');
      var lines = S.nowLines && S.nowLines.length ? S.nowLines : [S.nowCond || ''];
      c.textContent = lines[0];
      var first = function (t) { return String(t || '').charAt(0); };
      var last = function (t) { t = String(t || ''); return t.charAt(t.length - 1); };
      var em = function (table, ch, px, dflt) { return (table[ch] !== undefined ? table[ch] : dflt) * px; };
      q('.tm').style.marginLeft = (INK - em(LB_TIME, first(q('.t').textContent), 44, .04)).toFixed(2) + 'px';
      d.style.marginLeft = (INK - em(LB_DATE, first(d.textContent), 14, .05)).toFixed(2) + 'px';
      q('.wx').style.marginRight = (INK - RB_TEMP * 32).toFixed(2) + 'px';
      c.style.marginRight = (INK - em(RB_LINE, last(c.textContent).toLowerCase(), 14, .05)).toFixed(2) + 'px';
      // (asked with the margins in place: they move the line's ends)
      for (var i = 1; i < lines.length && clipped(d); i++) {
        c.textContent = lines[i];
        c.style.marginRight = (INK - em(RB_LINE, last(c.textContent).toLowerCase(), 14, .05)).toFixed(2) + 'px';
      }
      if (!S.nowFonts && document.fonts && document.fonts.ready) {
        S.nowFonts = true;
        document.fonts.ready.then(function () { if (nowOn()) fitNow(); });
        // (and each font that arrives later: SF Pro landing after the fit
        // widened the date past its room)
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { if (nowOn()) fitNow(); });
      }
    }
    // The weather opens the Weather page, as it does in the header -- the
    // dashboard's own `weather` view, when it has one.
    function goWeather() {
      var cfg = M.config(), dash = M.dash();
      var has = cfg && (cfg.views || []).some(function (v) { return v && v.path === 'weather'; });
      if (!has || !dash) return;
      var path = '/' + dash + '/weather';
      if (location.pathname === path) return;
      SH.navigate(path);
    }

    function isHome() {
      var here = String(location.pathname).split('/')[2] || '';
      var cfg = M.config(), v0 = cfg && cfg.views && cfg.views[0];
      return !here || here === '0' || (v0 && v0.path === here);
    }
    // hk-base's answer: a written-out button or the chips card's lead.
    function homeHasChip() { return M.homeButton(); }

    // ---------------------------------------------------------- the list
    function listKey() {
      var cfg = M.config(), h = C.client(), side = sidebarSource();
      var b = M.board();
      return [M.dash(), b.ha_place, b.menu_rooms, JSON.stringify(b.room_order), b.ha_row,
              JSON.stringify(b.categories), JSON.stringify(b.menu_top || []), JSON.stringify(b.pages || []),
              JSON.stringify(b.chips || []), b.chips_row,
              haSidebarShown(),
              // the Home Assistant section: More folded or not, this user's
              // sidebar order, and the panels there are
              !!S.shut.ha_more, JSON.stringify(S.haPrefs || null), !!(h && h.user && h.user.is_admin),
              side && side.panels ? Object.keys(side.panels).join(',') : '', haKey(),
              hostItems().map(function (x) { return x.title + x.href; }).join(','),
              cfg ? (cfg.views || []).length : 0,
              JSON.stringify(h && h.areas ? Object.keys(h.areas).map(function (k) {
                return k + ':' + h.areas[k].name + ':' + (h.areas[k].icon || '');
              }) : [])].join('|') + '|' + (cfgId(cfg));
    }
    var CFGS = new WeakMap(), CFGN = 0;
    function cfgId(cfg) {
      if (!cfg || typeof cfg !== 'object') return 0;
      if (!CFGS.has(cfg)) CFGS.set(cfg, ++CFGN);
      return CFGS.get(cfg);
    }
    function build() {
      var cfg = M.config(), h = C.client();
      var b = M.board();
      var m = model(cfg, h && h.areas, { dash: M.dash(), order: b.menu_rooms === 'order' ? 'order' : 'az',
                                          roomOrder: b.room_order,
                                          user: h && h.user && h.user.id,
                                          categories: b.categories,
                                          top: b.menu_top,
                                          chips: b.chips, chipsRow: b.chips_row,
                                          pageOrder: pagePaths(b.pages, b.custom_pages),
                                          ha: !!b.ha_row });
      S.items = [];
      var html = '';
      function row(it) {
        S.items.push(it);
        var cls = it.kind === 'sub' ? ' sub' : it.kind === 'more' ? ' more' : '';
        var tail = it.badge ? '<b class="bdg" data-badge="' + it.badge + '" hidden></b>' : it.kind === 'more' ? CHEV_D : '';
        return '<button class="row' + cls + '" data-i="' + (S.items.length - 1) + '"' +
          (it.kind === 'more' ? ' aria-expanded="' + !!it.open + '"' : '') + '><hk-icon icon="' +
          esc(glyph(it.icon)) + '"></hk-icon><span>' + esc(it.title) + '</span>' + tail + '</button>';
      }
      function section(key, title, items) {
        if (!items.length) return '';
        var shut = !!S.shut[key];
        return '<button class="sh' + (shut ? ' shut' : '') + '" data-sec="' + key + '" aria-expanded="' +
          (!shut) + '">' + esc(title) + CHEV_D + '</button>' + (shut ? '' : items.map(row).join(''));
      }
      if (m.home) html += row(m.home);
      S.haOn = m.ha;
      haCounts(m.ha);
      // THE HOME ASSISTANT SECTION where the screen puts it (ha_place): right
      // under Home, above Categories, above Rooms (the default) or last
      var ha = '';
      if (m.ha) {
        haUpdates(h, true);
        ha = section('ha', 'Home Assistant', haList(S.haPrefs, { moreOpen: !!S.shut.ha_more, sidebarShown: haSidebarShown() }));
      }
      var place = b.ha_place || 'rooms';
      if (place === 'top') html += ha;
      html += m.top.map(row).join('');
      if (place === 'categories') html += ha;
      html += section('categories', 'Categories', m.categories);
      if (place === 'rooms') html += ha;
      html += section('rooms', 'Rooms', m.rooms);
      if (place === 'bottom') html += ha;
      var hostRows = hostItems();
      html += section('host', hostRows.length ? hostRows[0].section || 'More' : '', hostRows);
      var keep = S.list.scrollTop;
      S.list.innerHTML = html;
      S.list.scrollTop = keep;
      if (window.hkCards.edges) window.hkCards.edges(S.list.parentNode);
      S.built = listKey();
      paintBadges();
    }

    // THE COUNTS, as Home Assistant's own sidebar keeps them: waiting
    // notifications (every user), and on Settings the updates ready to
    // install plus the repairs not ignored (admins). Subscribed only while a
    // screen shows the section, and painted in place -- a count never
    // rebuilds the list.
    // Through the current client: its subscription port (one per socket, so
    // the same identity across snapshots) and its read path for the repairs.
    var HC = { notif: 0, updates: 0, issues: 0, conn: null, un: [], at: 0 };
    function haCounts(on) {
      var h = C.client(), conn = h && h.subscriptions;
      if (!on || !conn) {
        HC.un.forEach(function (f) { try { f(); } catch (e) { /* gone */ } });
        HC.un = [];
        HC.conn = null;
        return;
      }
      if (HC.conn === conn) return;
      haCounts(false);
      HC.conn = conn;
      var keep = function (p) {
        Promise.resolve(p).then(function (un) {
          if (HC.conn === conn) HC.un.push(un); else { try { un(); } catch (e) { /* gone */ } }
        }, function () { /* refused: no count */ });
      };
      var seen = {};
      keep(conn.subscribeMessage(function (m) {
        if (m.type === 'current') seen = {};
        Object.keys(m.notifications || {}).forEach(function (id) {
          if (m.type === 'removed') delete seen[id]; else seen[id] = 1;
        });
        HC.notif = Object.keys(seen).length;
        paintBadges();
      }, { type: 'persistent_notification/subscribe' }));
      // this user's sidebar order and hidden items (More follows them)
      keep(conn.subscribeMessage(function (m) {
        S.haPrefs = (m && m.value) || null;
        if (docked() && listKey() !== S.built) { build(); markHere(); }
      }, { type: 'frontend/subscribe_user_data', key: 'sidebar' }));
      if (h.user && h.user.is_admin) {
        var issues = function () {
          h.callWS({ type: 'repairs/list_issues' }).then(function (r) {
            HC.issues = ((r && r.issues) || []).filter(function (x) { return !x.ignored; }).length;
            paintBadges();
          }, function () { /* no repairs */ });
        };
        issues();
        // home-assistant-js-websocket's subscribeEvents(cb, type) is exactly this message
        keep(conn.subscribeMessage(function () { clearTimeout(HC.it); HC.it = setTimeout(issues, 500); },
                                   { type: 'subscribe_events', event_type: 'repairs_issue_registry_updated' }));
      }
    }
    // updates: at most every 5 s, as Home Assistant's own sidebar counts them
    function haUpdates(h, now) {
      if (!(h && h.user && h.user.is_admin && h.states)) { HC.updates = 0; return; }
      var t = Date.now();
      if (!now && t - HC.at < 5000) return;
      HC.at = t;
      var n = 0, en = h.entities || {};
      for (var id in h.states) {
        if (id.lastIndexOf('update.', 0) !== 0) continue;
        var st = h.states[id];
        if (st.state === 'on' && ((st.attributes.supported_features || 0) & 1) && !(en[id] && en[id].hidden)) n++;
      }
      if (n !== HC.updates) { HC.updates = n; paintBadges(); }
    }
    function paintBadges() {
      if (!S.list) return;
      var n = { settings: HC.updates + HC.issues, notif: HC.notif };
      S.list.querySelectorAll('.bdg').forEach(function (b) {
        var v = n[b.getAttribute('data-badge')] || 0;
        var txt = v > 99 ? '99+' : String(v);
        if (b.textContent !== txt) b.textContent = txt;
        if (b.hidden !== !v) b.hidden = !v;
      });
    }
    function markHere() {
      if (!S.items) return;
      var rows = S.list.querySelectorAll('.row'), hereRow = null;
      for (var i = 0; i < rows.length; i++) {
        var it = S.items[+rows[i].getAttribute('data-i')];
        var here = !!it && isHere(it, location.pathname);
        rows[i].classList.toggle('here', here);
        if (here) { rows[i].setAttribute('aria-current', 'page'); hereRow = rows[i]; } else rows[i].removeAttribute('aria-current');
      }
      slideHere(hereRow);
      publishHeader();
    }
    // THE HIGHLIGHT GLIDES from the row you were on to the one you are on:
    // the new row's highlight starts over the old row's box (in the list's
    // own coordinates, scroll included, so a rebuilt list still knows where it
    // was) and springs home. Nothing while the menu is out of sight (no box),
    // or when the row has not moved.
    function boxOf(el) {
      var l = S.list.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left - l.left, y: r.top - l.top + S.list.scrollTop, w: r.width, h: r.height };
    }
    function slideHere(el) {
      if (window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) { S.hereBox = null; return; }
      var to = el ? boxOf(el) : null, from = S.hereBox;
      S.hereBox = to;
      if (!from || !to || (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1)) return;
      el.classList.add('slide-from');
      el.style.setProperty('--hx', (from.x - to.x) + 'px');
      el.style.setProperty('--hy', (from.y - to.y) + 'px');
      el.style.setProperty('--sx', String(from.w / to.w));
      el.style.setProperty('--sy', String(from.h / to.h));
      void el.offsetWidth;                      // that start, drawn
      el.classList.remove('slide-from');
      ['--hx', '--hy', '--sx', '--sy'].forEach(function (v) { el.style.removeProperty(v); });
    }

    function onList(e) {
      var sh = e.target.closest && e.target.closest('.sh');
      if (sh) {
        var k = sh.getAttribute('data-sec');
        S.shut[k] = !S.shut[k];
        try { localStorage.setItem('hk-menu-shut', JSON.stringify(S.shut)); } catch (x) { /* private */ }
        build();
        markHere();
        return;
      }
      var r = e.target.closest && e.target.closest('.row');
      if (!r || !S.items) return;
      var it = S.items[+r.getAttribute('data-i')];
      if (!it) return;
      if (it.kind === 'ha') { close(true); if (!SH.openHaMenu()) openHaSidebar(); return; }
      // Home Assistant elsewhere: its address
      if (it.kind === 'halink') { close(true); haOpen(it); return; }
      if (it.kind === 'more') {
        S.shut.ha_more = !S.shut.ha_more;
        try { localStorage.setItem('hk-menu-shut', JSON.stringify(S.shut)); } catch (x) { /* private */ }
        build();
        markHere();
        return;
      }
      // the host's own page (its settings): a full page load
      if (it.kind === 'hostlink') {
        close(true);
        if (it.run) { try { it.run(); } catch (x) { /* the host's own */ } } else location.assign(it.href);
        return;
      }
      // Notifications: Home Assistant's own drawer, over the page
      if (it.kind === 'notif') {
        close(true);
        SH.showNotifications();
        return;
      }
      // A Home Assistant page: kiosk mode is lifted outside the dashboards
      // (syncOutside), so its own sidebar or header is the way back.
      if (it.kind === 'hapage' || it.kind === 'sub') {
        try { sessionStorage.setItem(ESCAPE_KEY, '1'); } catch (x) { /* private mode */ }
        HA.used = true;
        close(true);
        SH.haNavigate(it.path);
        return;
      }
      // The selection moves at once, so the tap is answered before the page is.
      S.list.querySelectorAll('.row.here').forEach(function (x) { x.classList.remove('here'); });
      r.classList.add('here');
      slideHere(r);
      if (!docked()) close(true);
      if (isHere(it, location.pathname)) return;
      // after a frame drawn (hk-base's navigate, no dim): the highlight's
      // slide starts before the new page's work, which holds a wall tablet's
      // main thread for half a second -- or the slide would begin after it
      var N = window.hkCards && window.hkCards.navigate;
      if (N) { N(it.path, null); return; }
      SH.navigate(it.path);
    }

    // ------------------------------------------ Home Assistant's own sidebar
    // THE "HOME ASSISTANT" ROW opens HA's sidebar -- Settings, the other
    // dashboards -- sliding over the page the way HA does it on a phone, even
    // on a wall tablet where kiosk mode hides it. Kiosk mode hides it with one
    // rule in home-assistant-main (the sidebar at 0 width, display none); for
    // as long as the drawer is open a rule of ours lifts that, the drawer is
    // HA's own modal one (its own dimmed backdrop, tap outside or Escape to
    // close) and the sidebar is expanded, labels and all. The moment it
    // closes -- or the page changes -- all three are put back, so kiosk mode
    // is exactly as it was. A phone is no different: kiosk mode hides the
    // sidebar there too.
    var HA = { active: false };
    function haParts() {
      return { main: SH.main(), sr: SH.mainRoot(), drawer: SH.drawer(), sidebar: SH.sidebar() };
    }
    // Home Assistant's sidebar already on screen beside the page (no kiosk
    // mode, a wide window): Show Menu would open what is there.
    function haSidebarShown() {
      if (HA.active) return false;
      // a host that shows the page inside Home Assistant says (its sidebar data)
      var side = sidebarSource();
      if (side && typeof side.shown === 'boolean') return side.shown;
      var p = haParts();
      if (!p.sidebar || !p.drawer || p.drawer.type === 'modal') return false;
      try {
        return getComputedStyle(p.sidebar).display !== 'none' && p.sidebar.getBoundingClientRect().width > 0;
      } catch (e) { return false; }
    }
    function openHaSidebar() {
      var p = haParts();
      if (!p.drawer || !p.sidebar || HA.active) return;
      try { sessionStorage.setItem(ESCAPE_KEY, '1'); } catch (e) { /* private mode */ }
      // Two rules to lift: kiosk mode hides the sidebar in home-assistant-main
      // and, on a phone, HA's drawer as well, inside ha-drawer.
      var T = SH.tags;
      var lift = liftRule(p.sr, ':host{--ha-sidebar-width:256px !important;--mdc-drawer-width:256px !important}' +
                             T.drawer + ' > ' + T.sidebar + '{display:flex !important}');
      var lift2 = p.drawer.shadowRoot ? liftRule(p.drawer.shadowRoot, 'wa-drawer[open]{display:block !important}') : null;
      // HK Frontend's own hiding (hk-kiosk.js) steps aside the same way
      if (window.hkKiosk) window.hkKiosk.hold(true);
      HA = { active: true, used: true, type: p.drawer.type, expand: p.sidebar.alwaysExpand, p: p, lift: [lift, lift2] };
      p.drawer.type = 'modal';
      p.sidebar.alwaysExpand = true;
      requestAnimationFrame(function () { requestAnimationFrame(function () { p.drawer.open = true; }); });
      // HA's drawer says it has closed by clearing `open`: watched, cheaply,
      // only while it is up.
      var seen = false;
      HA.poll = setInterval(function () {
        if (p.drawer.open) { seen = true; return; }
        if (seen) restoreHaSidebar();
      }, 250);
      HA.nav = function () { if (p.drawer.open) p.drawer.open = false; setTimeout(restoreHaSidebar, 350); };
      SH.onNavigate(HA.nav);
    }
    // OUTSIDE THE DASHBOARDS, HOME ASSISTANT IS HOME ASSISTANT.
    // kiosk-mode's rules outlive the dashboard that set them: open Settings
    // from the Home Assistant section and its sidebar stays hidden there, with no
    // way back but a reload -- and on a phone its ☰ opens a drawer kiosk mode
    // also hides. So once this browser has used the row (this session), every
    // page that is NOT a dashboard gets kiosk mode's rules switched off --
    // HA's own sidebar, or its ☰, is the way back -- and they are switched on
    // again the moment a dashboard is back. The rules are disabled in place
    // (media="not all"), never removed, so kiosk-mode's own bookkeeping is
    // untouched. A screen that never had the row -- a wall tablet -- never
    // gets here.
    var ESCAPE_KEY = 'hk-ha-row-used';
    function rowUsed() {
      try { return sessionStorage.getItem(ESCAPE_KEY) === '1'; } catch (e) { return !!HA.used; }
    }
    function onDashboard() { return SH.onDashboard(); }
    function kioskRules() {
      var p = haParts(), out = [];
      [p.sr, p.drawer && p.drawer.shadowRoot].forEach(function (root) {
        if (root) out = out.concat([].slice.call(root.querySelectorAll('style[id^="kiosk_mode"]')));
      });
      return out;
    }
    function syncOutside() {
      var free = rowUsed() && !onDashboard();
      kioskRules().forEach(function (st) {
        if (free && st.getAttribute('data-hk-media') === null) {
          st.setAttribute('data-hk-media', st.getAttribute('media') || '');
          st.setAttribute('media', 'not all');
        } else if (!free && st.getAttribute('data-hk-media') !== null) {
          var m = st.getAttribute('data-hk-media');
          if (m) st.setAttribute('media', m); else st.removeAttribute('media');
          st.removeAttribute('data-hk-media');
        }
      });
    }
    function onPageChange() { syncOutside(); setTimeout(syncOutside, 150); setTimeout(syncOutside, 800); }
    [SH.navEvent, 'popstate'].forEach(function (ev) { window.addEventListener(ev, onPageChange); });

    function restoreHaSidebar() {
      if (!HA.active) return;
      var h = HA;
      HA = { active: false, used: true };
      clearInterval(h.poll);
      SH.offNavigate(h.nav);
      // after the drawer's own close animation, so it does not snap shut
      setTimeout(function () {
        try { h.p.drawer.type = h.type || ''; h.p.sidebar.alwaysExpand = !!h.expand; } catch (e) { /* gone */ }
        h.lift.forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
        if (window.hkKiosk) window.hkKiosk.hold(false);
      }, 300);
    }
    function liftRule(root, css) {
      var el = root.querySelector('style#hk-ha-sidebar') || document.createElement('style');
      el.id = 'hk-ha-sidebar';
      el.textContent = css;
      if (!el.parentNode) root.appendChild(el);
      return el;
    }

    // ----------------------------------------------------- open and close
    function open() {
      if (!M.on() || docked()) return;
      if (!mount()) return;
      if (listKey() !== S.built) build();
      markHere();
      S.open = true;
      sync();
      armIdle();
      var here = S.list.querySelector('.row.here');
      // A room far down the list is brought into view, not left off-screen.
      if (here && here.offsetTop > S.list.clientHeight - 60) {
        S.list.scrollTop = here.offsetTop - S.list.clientHeight / 2 + 22;
      }
    }
    // byKey: closed from the keyboard (Escape, or the tab pressed with a key),
    // which alone takes the focus back to the tab -- where a keyboard user
    // was. A tap never does: the tab would hold the focus with no one
    // looking, and the Home Assistant app's web view draws the focus ring
    // round it now and then (a white stroke, 2026-10-04). Focus a tap left
    // on the tab is let go of too.
    function close(quiet, byKey) {
      if (!S.open) return;
      S.open = false;
      clearTimeout(S.idle);
      sync();
      if (!S.tab) return;
      if (byKey && !quiet && S.root.classList.contains('tabbed')) S.tab.focus({ preventScroll: true });
      else if (S.host && S.host.shadowRoot && S.host.shadowRoot.activeElement === S.tab) S.tab.blur();
    }
    function toggle(byKey) { if (S.open) close(false, byKey); else open(); }
    function armIdle() {
      clearTimeout(S.idle);
      if (S.open) S.idle = setTimeout(function () { close(true); }, IDLE_MS);
    }

    // SWIPE IT AWAY, the iPad gesture: a drag that starts on the panel and
    // travels left more than it travels down closes it. Vertical drags are
    // the list's to scroll.
    function wireSwipe() {
      var g = null;
      S.panel.addEventListener('pointerdown', function (e) {
        if (!S.open || e.pointerType === 'mouse') return;
        g = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }, { passive: true });
      S.panel.addEventListener('pointermove', function (e) {
        if (!g || e.pointerId !== g.id) return;
        var dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
        if (dx < -48 && Math.abs(dx) > 1.5 * Math.abs(dy)) { g = null; close(true); }
      }, { passive: true });
      ['pointerup', 'pointercancel'].forEach(function (t) {
        S.panel.addEventListener(t, function () { g = null; }, { passive: true });
      });
    }

    // ------------------------------------------------ the edge swipe
    // SWIPE FROM THE LEFT EDGE (the screen's Swipe from Left Edge, hk-base.js
    // menu.swipe()), the iPad gesture the other way: a drag that starts in
    // the page's left margin -- the strip (.edge) -- or on the edge tab, and
    // travels right more than it travels down, pulls the menu out under the
    // finger, as the Home app's sidebar and Android's drawer do; let go past
    // a third of it, or flicked, and it opens, otherwise it slides back. Any
    // width, any button style (No Button relies on it).
    //
    // A strip of its own, not a listener on the page: its touch-action keeps
    // the sideways drag from the browser (no back swipe, no scroll, the
    // events keep coming), and the tiles never see a touch that was a swipe.
    // As wide as the page's margin -- 2% + 4 px, 16 px on a phone -- so it
    // covers nothing that can be tapped; it sits under the pop-ups and
    // sheets (the root's z-index), which cover it while they are up.
    var EDGE_MIN = 14, EDGE_MAX = 24;
    function edgeWidth(pw) {
      if ((window.innerWidth || 1280) < M.NARROW) return 16;
      return Math.round(Math.max(EDGE_MIN, Math.min(EDGE_MAX, 0.02 * pw + 4)));
    }
    function swipeOn() { return typeof M.swipe === 'function' && !!M.swipe(); }
    // A FINGER IS FOLLOWED BY ITS TOUCH EVENTS, never by pointer capture.
    // On an iPhone (the Home Assistant app, 2026-10-04) a captured touch was
    // never let go: the lift did not reach the strip, WebKit kept every later
    // touch on it -- hidden or not -- and nothing on the page could be tapped
    // again (the menu's rows, the scrim, then the whole dashboard) until a
    // reload, while scrolling, which is the browser's own, still went to the
    // page. A touch's events go to where it started without any capture, and
    // always end in touchend or touchcancel. A mouse (or pen) uses pointer
    // events and the capture, which ends with its button.
    function wireEdge(el) {
      el.addEventListener('touchstart', function (e) {
        if (S.drag) finishDrag();          // one that never heard its end: settle it first
        if (e.touches.length !== 1) return;
        var t = e.changedTouches[0];
        startDrag(el, t.clientX, t.clientY, 't' + t.identifier);
      }, { passive: true });
      // THE PAGE HOLDS STILL UNDER A SWIPE: touch-action pan-y lets the
      // browser scroll the up-and-down part of any drag, and a thumb's arc
      // (about 40 degrees) scrolled the page some hundreds of px behind the
      // opening menu. A finger the menu follows -- one that has made a swipe
      // (swipeStarts, the same test that pulls the menu out) -- keeps the
      // page still; anything short of that is left to the browser, so a
      // scroll that starts here with a wobble to the right still scrolls
      // (WebKit lets a touch scroll no more once one of its moves is
      // cancelled). Only touches that start here (16-24 px of margin) are
      // held -- this listener is the strip's own.
      el.addEventListener('touchmove', function (e) {
        var g = S.drag, t = g && ours(e.changedTouches);
        if (!t) return;
        if (g.live || swipeStarts(t.clientX - g.x, t.clientY - g.y)) e.preventDefault();
      }, { passive: false });
      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'touch') return;     // the touch events above have it
        if (S.drag) finishDrag();
        if (e.button !== 0) return;
        if (startDrag(el, e.clientX, e.clientY, e.pointerId)) {
          try { el.setPointerCapture(e.pointerId); } catch (x) { /* already gone */ }
          S.drag.captured = true;
        }
      });
    }
    function startDrag(el, x, y, id) {
      if (S.open || docked() || !swipeOn()) return false;
      // the tab answers a tap on its own (and the panel's swipe closes it)
      S.drag = { x: x, y: y, id: id, el: el, live: false, w: W, dx: 0, trail: [] };
      S.edgeAt = Date.now();
      follow(true);
      return true;
    }
    // The rest of the gesture, heard at the document, and ended by any of
    // its ends: the finger lifted or cancelled, the mouse button up, a new
    // touch or press anywhere, or a drag gone quiet (DRAG_IDLE).
    var DRAG_IDLE = 4000;
    var DRAG_EVENTS = { touchstart: onTouchOther, touchmove: onTouchMove, touchend: onTouchEnd, touchcancel: onTouchEnd,
                        pointermove: onPointerMove, pointerup: onPointerEnd, pointercancel: onPointerEnd,
                        pointerdown: onPointerOther };
    function follow(on) {
      Object.keys(DRAG_EVENTS).forEach(function (t) {
        if (on) document.addEventListener(t, DRAG_EVENTS[t], { capture: true, passive: true });
        else document.removeEventListener(t, DRAG_EVENTS[t], { capture: true, passive: true });
      });
      quiet(on);
    }
    function quiet(on) {
      clearTimeout(S.dragIdle);
      if (on) S.dragIdle = setTimeout(function () { finishDrag(); }, DRAG_IDLE);
    }
    function ours(list) {
      for (var i = 0; list && i < list.length; i++) if ('t' + list[i].identifier === S.drag.id) return list[i];
      return null;
    }
    function onTouchMove(e) {
      var t = S.drag && ours(e.changedTouches);
      if (t) dragTo(t.clientX, t.clientY);
    }
    function onTouchOther(e) { if (S.drag && !ours(e.changedTouches)) finishDrag(); }
    function onTouchEnd(e) {
      if (!S.drag) return;
      if (ours(e.changedTouches) || !(e.touches && e.touches.length)) finishDrag();
    }
    function onPointerMove(e) { if (S.drag && e.pointerId === S.drag.id) dragTo(e.clientX, e.clientY); }
    function onPointerEnd(e) { if (S.drag && e.pointerId === S.drag.id) finishDrag(); }
    // a press elsewhere (a mouse's, or a touch the drag is not following)
    function onPointerOther(e) {
      if (S.drag && e.pointerId !== S.drag.id && !(e.pointerType === 'touch' && String(S.drag.id).charAt(0) === 't')) finishDrag();
    }
    // WHAT COUNTS AS A SWIPE, AND AS A FLICK (2026-10-04, "it doesn't always
    // trigger"):
    //   the start -- right at least SWIPE_SLOPE times as far as up or down
    //     (about 40 degrees: a thumb swings in an arc; it was 1.5, 34
    //     degrees). One that goes more up or down than across, past 12 px,
    //     is the page's scroll.
    //   the flick -- its speed over the last FLICK_MS of the finger, as the
    //     Home app's and Android's drawers measure it: a finger slows just
    //     before it lifts, and the last move alone made a quick swipe read as
    //     a slow one, so the panel slid back. A finger that stopped before
    //     lifting has no speed. FLICK_V and at least FLICK_MIN px open it.
    var SWIPE_SLOPE = 1.2, SWIPE_MIN = 10, FLICK_MS = 100, FLICK_V = 0.3, FLICK_MIN = 24;
    // the one test for "this is a swipe": the menu comes out, and the page
    // is held still, from the same move (dx right, dy down, from the start)
    function swipeStarts(dx, dy) { return dx >= SWIPE_MIN && dx >= SWIPE_SLOPE * Math.abs(dy); }
    function dragTo(cx, cy) {
      var g = S.drag;
      quiet(true);
      var dx = cx - g.x, dy = cy - g.y;
      if (!g.live) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { endDrag(false); return; }
        if (!swipeStarts(dx, dy)) return;
        // it is a swipe: the list is made ready as the panel comes out
        if (listKey() !== S.built) build();
        markHere();
        g.live = true;
        g.w = (S.panel.getBoundingClientRect().width) || W;
        S.root.classList.add('dragging');
        S.panel.setAttribute('aria-hidden', 'false');
      }
      var d = Math.max(0, Math.min(g.w, dx - SWIPE_MIN));
      g.dx = d;
      g.trail.push({ t: Date.now(), d: d });
      if (g.trail.length > 8) g.trail.shift();
      S.panel.style.transform = 'translateX(' + (d - g.w) + 'px)';
      S.scrim.style.opacity = String(d / g.w);
    }
    // px/ms rightward over the finger's last FLICK_MS (and the move before,
    // where moves come further apart); 0 once it has stood still that long
    function flickSpeed(g) {
      var tr = g.trail, n = tr.length, last = tr[n - 1];
      if (n < 2 || Date.now() - last.t > FLICK_MS) return 0;
      var i = n - 1;
      while (i > 0 && last.t - tr[i - 1].t <= FLICK_MS) i--;
      if (i === n - 1) i = n - 2;
      return (last.d - tr[i].d) / Math.max(16, last.t - tr[i].t);
    }
    // where it was left decides: past a third, or flicked, it opens
    function finishDrag() {
      var g = S.drag;
      endDrag(!!g && g.live && (g.dx > g.w / 3 || (g.dx >= FLICK_MIN && flickSpeed(g) > FLICK_V)));
    }
    // Let go: open from where the finger left it, or slide back. The classes
    // change first (sync drops `dragging`, open adds `open`), then the inline
    // drag styles go, so the panel's own transition carries it the rest of
    // the way either way.
    function endDrag(opens) {
      var g = S.drag;
      S.drag = null;
      follow(false);
      if (!g) return;
      S.edgeAt = Date.now();
      if (g.captured) { try { g.el.releasePointerCapture(g.id); } catch (x) { /* already released */ } }
      if (!g.live) return;
      S.pulled = Date.now();
      if (opens) open(); else sync();
      S.panel.style.transform = '';
      S.scrim.style.opacity = '';
    }

    // ------------------------------------- Home Assistant's hidden drawer
    // THE HOME ASSISTANT APP HAS A LEFT-EDGE SWIPE OF ITS OWN (its Gestures:
    // Swipe Right, "Show Sidebar" by default), and it sends the page
    // `sidebar/show`. Where Home Assistant's sidebar is hidden (kiosk mode,
    // HK's or the plugin's) that opens its drawer all the same: a modal no
    // one can see, and the whole page goes inert under it -- measured, a tap
    // mid-screen lands on <html class="wa-scroll-lock"> -- until a reload.
    // On an iPhone it came with every Swipe from Left Edge (2026-10-04).
    //
    // So a drawer that opens while the sidebar is hidden, and not for the
    // menu's own Show Menu (HA.active), is closed again at once: the screen
    // keeps its sidebar hidden, as it chose. If it came with the edge swipe,
    // the screen says once (per session) what to change in the app; the app
    // tells the page nothing of its gestures, so this is when it can know.
    var GUARD = { drawer: null, mo: null };
    var TOLD_KEY = 'hk-app-swipe-told';
    function guardDrawer() {
      if (!window.MutationObserver) return;
      var p = haParts();
      if (!p.drawer || GUARD.drawer === p.drawer) return;
      if (GUARD.mo) GUARD.mo.disconnect();
      GUARD.drawer = p.drawer;
      GUARD.mo = new MutationObserver(function () { if (p.drawer.open) unseenDrawer(); });
      GUARD.mo.observe(p.drawer, { attributes: true, attributeFilter: ['open'] });
    }
    // ONLY WHERE THIS PAGE HIDES THE SIDEBAR: a dashboard whose screen hides
    // it (hk-kiosk.js says so; the Kiosk Mode plugin's, by the sidebar's own
    // look). Never on Home Assistant's own pages -- there its sidebar is the
    // way round, and on a phone, where it is a drawer, the sidebar is still 0 px
    // wide at the moment the drawer starts opening, which read as hidden and
    // shut it again at once (2026-10-05).
    function unseenDrawer() {
      if (HA.active || !onDashboard()) return;
      var K = window.hkKiosk, ks = K && typeof K.state === 'function' ? K.state() : null;
      if (ks && !ks.sidebar) return;
      var p = haParts();
      if (!p.drawer || !p.sidebar) return;
      if (ks && ks.sidebar) { p.drawer.open = false; if (S.drag || Date.now() - (S.edgeAt || 0) < 2500) tellAppSwipe(); return; }
      var hidden;
      try { hidden = getComputedStyle(p.sidebar).display === 'none' || p.sidebar.getBoundingClientRect().width === 0; }
      catch (e) { return; }
      if (!hidden) return;
      p.drawer.open = false;
      if (S.drag || Date.now() - (S.edgeAt || 0) < 2500) tellAppSwipe();
    }
    function tellAppSwipe() {
      try { if (sessionStorage.getItem(TOLD_KEY)) return; sessionStorage.setItem(TOLD_KEY, '1'); } catch (e) { /* private */ }
      SH.toast({
        message: 'The Home Assistant app’s own swipe opens its sidebar too. In the app, set Settings → ' +
                 'Companion App → Gestures → Swipe Right to None.', duration: 12000 });
    }

    // the Now Playing pane's widths, as hk-popup.js wrote them on <html>
    // (its own style: read there, never through getComputedStyle)
    function paneSides() {
      var st = document.documentElement && document.documentElement.style;
      var g = function (k) { var n = st ? parseFloat(st.getPropertyValue(k)) : 0; return n > 0 ? n : 0; };
      return { l: g('--hk-pane-l'), r: g('--hk-pane-r') };
    }
    // DOCKED (Menu: "Always open beside the page"): the panel stays beside
    // the page and the view is pushed right by its width.
    function viewEl() { return SH.viewSlot(M.panel()); }
    // ...AND BESIDE THE NOW PLAYING PANE (hk-popup.js publishes its width
    // on <html> as --hk-pane-l / --hk-pane-r while it is up): the view is
    // narrowed by it on its side, so the page lays itself out in what is
    // left -- the iPad band and all (publishLeft). A left pane sits right of
    // a docked menu. The one writer of the view's side margins.
    function dockTo() { room(true); }
    function undock() { room(false); }
    function room(dock) {
      var v = viewEl(), p = paneSides();
      var ml = (dock ? W : 0) + p.l, mr = p.r;
      if (S.docked && S.docked !== v) { S.docked.style.marginLeft = ''; S.docked.style.marginRight = ''; S.docked = null; }
      if (!v) return;
      var l = ml ? ml + 'px' : '', r = mr ? mr + 'px' : '';
      if (v.style.marginLeft !== l) v.style.marginLeft = l;
      if (v.style.marginRight !== r) v.style.marginRight = r;
      S.docked = (l || r) ? v : null;
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
    SH.onNavigate(onNav);
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', function () { if (S.open) close(true); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.open) { e.stopPropagation(); close(false, true); }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden && S.open) close(true); });
    window.addEventListener('resize', function () { sync(); });
    window.addEventListener('hk-module-ready', function () { S.built = ''; sync(); });
    // the host's Home Assistant rows changed (hkShell.haNav: it learned where the page is)
    window.addEventListener('hk-ha-nav-changed', function () { S.built = ''; sync(); });
    // the Now Playing pane coming, going or changing sides (hk-popup.js)
    window.addEventListener('hk-pane', function () { sync(); });
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
    var headerKey = '';
    function publishHeader() {
      if (!window.hkMenu.headerContext) return;
      var key = JSON.stringify(window.hkMenu.headerContext()) + location.pathname;
      if (key === headerKey) return;
      headerKey = key;
      window.dispatchEvent(new CustomEvent('hk-page-navigation'));
    }
    window.hkMenu.open = open;
    window.hkMenu.close = close;
    window.hkMenu.toggle = toggle;
    window.hkMenu.isOpen = function () { return S.open; };
    window.hkMenu.sync = sync;
    window.hkMenu.openHaSidebar = openHaSidebar;
    window.hkMenu._.state = function () { return S; };
    window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: { module: 'hk-menu' } }));
  });
})();
