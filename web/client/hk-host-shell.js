// HK's host shell: the one place the shared frontend asks about the page it is
// drawn in -- where to mount its overlays, where the dashboard view and its
// container are, how a navigation is made and heard, how a detail sheet or a
// toast is asked for. The shared code under web/hk never names the host's own
// elements or events; it asks this.
//
// A host installs its implementation with hkShell.use(impl). Without one
// (a bare page, a test without a host) every element is null and the events
// carry HK's own neutral names, so nothing reaches into a page that is not
// there. The Home Assistant implementation is hosts/ha/frontend/hk-ha-shell.js;
// Mantel's is web/shim/mantel-shell.js.
//
// Every lookup is made fresh on each call (the host's page changes under it),
// and every global (window, document, history, CustomEvent) is read at call
// time, never captured.
(function (global) {
  'use strict';
  if (global.hkShell) return;

  function win() { return global.window || global; }
  // HK Frontend's documentation (Home Assistant's): its GitHub wiki
  var WIKI = 'https://github.com/jazzphone/hk-frontend/wiki/';
  function nil() { return null; }

  // Elements the shell can name. `tags` are the element names, for the few
  // places that must write a selector into a stylesheet or test an element
  // they walked to; a host without that element leaves it null. `card` is
  // the host's own wrapper around a dashboard card (it loads the card's code
  // lazily and draws an error card for an unknown type): a container card
  // makes its children in one (hkCards.createCard), and a host without one
  // (no Lovelace) gets the child made directly by HK's view host.
  var KINDS = ['root', 'main', 'drawer', 'sidebar', 'resolver', 'panel', 'dashboard',
               'viewContainer', 'view', 'viewBackground', 'card'];

  var NONE = {
    kind: 'none',
    events: { navigate: 'hk-navigate', moreInfo: 'hk-more-info', toast: 'hk-toast' },
    tags: {},
    // every element name a dashboard view can have (the view kinds)
    viewTags: [],
    // the host's own pages a card can be placed on (its views, its card
    // editor): a card inside one is on someone else's dashboard, not HK's
    foreignTags: [],
    // <the host's root element>, and the shadow root HK's overlays (menu,
    // tab bar, pop-ups, players) mount in
    root: nil, overlayRoot: nil,
    // the host's main layout, its drawer and sidebar, its panel resolver
    main: nil, mainRoot: nil, drawer: nil, sidebar: nil, resolver: nil,
    // the dashboard panel, its root, the view container and the view in it
    panel: nil, dashboard: nil, dashboardRoot: nil, viewContainer: nil, viewSlot: nil, view: nil,
    // the host's own view background inside a view container, and the toolbar
    viewBackground: nil, toolbar: nil,
    // the dashboard config the panel holds (views, …), or null
    dashboardConfig: nil,
    // true when the host's current page is a dashboard (not a host page
    // such as Settings); a host with only dashboards says true
    onDashboard: function () { return true; },
    // is the address a dashboard? true/false, or null while the host cannot
    // say yet (its page not up)
    isDashboard: function () { return null; },
    // the host's shell element has been defined (its page has started)
    defined: function () { return false; },
    // the host's notification drawer, and its "stay connected while hidden"
    // (the host skips it when the page is already kept connected)
    showNotifications: function () {},
    keepAwake: function () {},
    // the host's own sidebar for HK's menu and tab bar: { user, panels,
    // localize(key) } (its pages, their titles and icons), or null for a host
    // with no sidebar of its own
    sidebarData: nil,
    // HOME ASSISTANT IN HK'S MENU AND TAB BAR (a screen's Home Assistant
    // Section), by where the page is: 'own' -- the host IS Home Assistant, and
    // the section is its sidebar (sidebarData) as always; { link, top } -- Home
    // Assistant is elsewhere, and the section is one row opening `link` (in the
    // top window when `top`); null -- nothing of Home Assistant's to offer here.
    haNav: function () { return 'own'; },
    // open one of Home Assistant's own pages ('/config/dashboard'): in Home
    // Assistant, a navigation of its own; a host that shows its page inside
    // Home Assistant asks Home Assistant's window to go there
    haNavigate: function (path) { return this.navigate(path); },
    // Home Assistant's own sidebar over the page, when the host opens it
    // itself (true); false: HK opens it in the page (hk-menu.js openHaSidebar)
    openHaMenu: function () { return false; },
    // the host's own pages to list in HK's menu, as [{ title, icon, href }] (a full page load to `href`):
    // the host's settings page for those who may use it. Empty for a host with none (Home Assistant has its own).
    hostMenu: function () { return []; },
    // THE HOST'S OWN SETTINGS beside HK's in the settings panel, or null for a
    // host with none (Home Assistant: HK Settings shows HK's own only). See
    // web/hk/panels/hk-settings.js "THE HOST'S SETTINGS" for its shape.
    settingsHost: nil,
    // HOLD BACK WRITES on the host's own connection (the sky lab's preview):
    // every message `isWrite(msg)` says changes something is not sent, and
    // `onHeld(msg)` is told. true once in place (or when the host sends no
    // writes at all), false while it cannot be yet.
    holdWrites: function () { return false; },
    // THE HOST'S OWN SIDEBAR BUTTON, for a page of HK's own drawn as one of
    // the host's pages (the settings panel) on a narrow window: `el` the
    // button this page has already (null the first time), opts { narrow,
    // client } -- each one given is handed to it. Returns the button to place
    // (`el` again once it has one), or null for a host with no sidebar of its
    // own to open.
    menuButton: nil,
    // THE HOST'S OWN DETAIL AND TOASTS (Phase 2 P2.5). HK draws a sheet for
    // every kind of entity it knows (hk-detail.js) and its generic sheet for
    // the rest; a host that has its own detail dialog for any entity (Home
    // Assistant's more-info) keeps getting what HK has no dedicated sheet
    // for, as before. hostDetail(entityId): true when the host has its own
    // detail for it; openHostDetail(entityId, from?): show it (true when
    // shown). A host without one: false, and HK's generic sheet is used.
    hostDetail: function () { return false; },
    openHostDetail: function () { return false; },
    // true when the host draws the toast event (events.toast) itself; false:
    // HK's own toast layer (web/hk/shell/hk-overlays.js) draws it
    hostToast: function () { return false; },
    // A SERVICE THE HOST SERVES ON THE PAGE'S OWN ORIGIN: serviceUrl(name)
    // is a same-origin path ('/ma/', under the page's prefix) for
    // 'music_assistant' (its web app) or 'go2rtc' (its viewing API), or
    // null when the host does not (HK then uses the service's own address,
    // as in Home Assistant, where Music Assistant keeps its own port).
    serviceUrl: nil,
    // THE HOST'S OWN PHOTOS for the screensaver (hk-saver.js). photoSource(
    // source): the source this page's screensaver shows instead of the
    // house's `source` (a host may give a screen a photo album of its own),
    // or null to keep it. listPhotos(source): a promise of [{ id, title,
    // url }] for a source the host serves itself, or null for one it does
    // not (HK then walks it as a media folder). Home Assistant: null, both.
    photoSource: nil,
    listPhotos: nil,
    // THE HOST'S OWN CAMERAS THAT ARE NOT THE HOUSE'S: the integration
    // platforms whose cameras HK's Cameras page and settings leave out, as
    // they do a wall tablet's and Live TV's channels (hk-strategy.js
    // notHouseCamera). The host's own Live TV channels, once its integration
    // holds them. Home Assistant: none beyond HK's own.
    notHouseCameraPlatforms: function () { return []; },
    // THE ROOM OF THE WALL TABLET SHOWING THIS PAGE (an area id), for a Home
    // Grid block whose option is `tablet_room` (docs/phase11/HOME-GRID.md):
    // tabletRoom(client). Home Assistant: its Wall Tablets entry's room;
    // Mantel: the tablet device's own room. null on a page that is no wall
    // tablet, or one with no room.
    tabletRoom: nil,
    // IS THIS PAGE AT A WALL TABLET: atTablet(client), true or false -- the
    // one place shared code asks (hk-edit.js canEditPage: no Edit mode at a
    // wall tablet, whoever is signed in there). Home Assistant: a Wall
    // Tablets entry is this page (hk-settings.js tablet()); Mantel: a device
    // session, with or without a person on top (GET /api/me `at_tablet`), or
    // that same HK tablet. A bare page: false.
    atTablet: function () { return false; },
    // THE PRODUCT'S NAME where HK's screens and settings speak of themselves
    // ("Drawn By: … | HK Frontend", "the photos that come with HK Frontend"):
    // HK Frontend in Home Assistant, the host's own name elsewhere (Mantel).
    // Labels only: no saved value or key ever carries it.
    productName: function () { return 'HK Frontend'; },
    // A PLACE IN HOME ASSISTANT'S OWN SETTINGS, as HK's texts give it (HK
    // Frontend's integration: 'Devices & Services → HK Frontend → Add
    // feature'): Home Assistant says it as it is; a host outside it says the
    // place is Home Assistant's ('Home Assistant → Devices & Services → …').
    // The settings feed may name the place itself (`places`: the integration's settings are elsewhere while
    // another server runs the house); a host's own haPlace says it its way.
    haPlace: function (path) {
      var S = window.hkSettings, p = S && typeof S.get === 'function' ? S.get('places', null) : null;
      return p && typeof p[path] === 'string' ? p[path] : path;
    },
    // A THING OF HOME ASSISTANT'S OWN (HK Frontend's integration, its device,
    // its actions), named as this host's text names it: as it is in Home
    // Assistant, 'HK Frontend in Home Assistant' elsewhere.
    haName: function (name) { return name; },
    // HK'S DOCUMENTATION: the address of one of its pages (`page` a wiki page
    // such as 'Sleep-Screen', `anchor` a heading on it), or null for a host
    // with no such page (HK then leaves the link out).
    docsUrl: function (page, anchor) { return WIKI + page + (anchor ? '#' + anchor : ''); },
    // where HK's own dialogs (the confirm and choose sheets) and its toast
    // layer mount: the overlay root, else the document's body
    dialogRoot: function () {
      var d = global.document;
      return this.overlayRoot() || (d && d.body) || null;
    }
  };
  KINDS.forEach(function (k) { NONE.tags[k] = null; });

  // the capabilities a throwing host answers no to (not null)
  var FALSE = { hostDetail: 1, openHostDetail: 1, hostToast: 1, openHaMenu: 1 };
  // and the words a throwing host leaves as HK's own (the defaults')
  var WORDS = { productName: 1, haPlace: 1, haName: 1 };
  var impl = NONE, tags = Object.assign({}, NONE.tags), events = Object.assign({}, NONE.events);
  function get(name) { return impl[name] !== undefined ? impl[name] : NONE[name]; }

  function makeEvent(name, init) {
    var C = global.CustomEvent;
    return init === undefined ? new C(name) : new C(name, init);
  }

  var shell = {
    // A host installs its implementation; its omissions keep the defaults.
    use: function (next) {
      impl = next || NONE;
      // merged once here: the sky asks for a name on every hop up the tree
      tags = Object.freeze(Object.assign({}, NONE.tags, impl.tags || {}));
      events = Object.freeze(Object.assign({}, NONE.events, impl.events || {}));
      try { win().dispatchEvent(makeEvent('hk-host-shell-ready')); } catch (e) { /* shell tests */ }
      return shell;
    },
    _none: NONE
  };
  Object.defineProperty(shell, 'kind', { enumerable: true, get: function () { return get('kind'); } });
  Object.defineProperty(shell, 'events', { enumerable: true, get: function () { return events; } });
  Object.defineProperty(shell, 'tags', { enumerable: true, get: function () { return tags; } });
  Object.defineProperty(shell, 'viewTags', { enumerable: true, get: function () { return (get('viewTags') || []).slice(); } });
  Object.defineProperty(shell, 'foreignTags', { enumerable: true, get: function () { return (get('foreignTags') || []).slice(); } });
  // The navigation event's name, for the listeners that sit in a list with
  // popstate/hashchange.
  Object.defineProperty(shell, 'navEvent', { enumerable: true, get: function () { return events.navigate; } });

  ['root', 'overlayRoot', 'main', 'mainRoot', 'drawer', 'sidebar', 'resolver', 'panel', 'dashboard',
   'dashboardRoot', 'viewContainer', 'viewSlot', 'view', 'viewBackground', 'toolbar', 'dashboardConfig', 'onDashboard', 'isDashboard',
   'defined', 'showNotifications', 'keepAwake', 'sidebarData', 'haNav', 'haNavigate', 'openHaMenu', 'hostMenu', 'settingsHost', 'holdWrites', 'menuButton',
   'hostDetail', 'openHostDetail', 'hostToast', 'dialogRoot', 'serviceUrl', 'photoSource', 'listPhotos', 'productName', 'haPlace',
   'haName', 'docsUrl', 'notHouseCameraPlatforms', 'tabletRoom', 'atTablet'].forEach(function (name) {
    shell[name] = function () {
      try { return get(name).apply(shell, arguments); } catch (e) {
        return name === 'onDashboard' ? true : FALSE[name] ? false : WORDS[name] ? NONE[name].apply(shell, arguments) : null;
      }
    };
  });

  // Is `el` the host's element of this kind? (by name, either case)
  shell.is = function (el, kind) {
    var t = tags[kind];
    if (!t || !el) return false;
    var n = el.localName || el.tagName;
    return !!n && String(n).toLowerCase() === t;
  };

  // ---------------------------------------------------------- navigation
  // Tell the host the address changed (after a pushState of the caller's
  // own). `init` is the event's init as the caller wrote it; `from` an
  // element to fire it from (it bubbles, composed, to the window) instead of
  // the window itself.
  shell.announce = function (init, from) {
    var ev = makeEvent(shell.navEvent, init);
    (from || win()).dispatchEvent(ev);
    return ev;
  };
  // Move to `path`: a history entry, then the announcement -- exactly what
  // the host's own navigate does. `init` as for announce; init.replace
  // (outside detail) replaces the entry instead.
  shell.navigate = function (path, init, opts) {
    var h = global.history;
    if (opts && opts.replace) h.replaceState(null, '', path); else h.pushState(null, '', path);
    return shell.announce(init);
  };
  shell.onNavigate = function (fn) {
    var name = shell.navEvent;
    win().addEventListener(name, fn);
    return function () { win().removeEventListener(name, fn); };
  };
  shell.offNavigate = function (fn) { win().removeEventListener(shell.navEvent, fn); };

  // ------------------------------------------------------- sheets, toasts
  // Ask for an entity's detail sheet: fired from `from` (a card) or the
  // host's root, bubbling and composed, as a tap on a card does.
  shell.moreInfo = function (entityId, from, extra) {
    var target = from || shell.root();
    if (!target) return null;
    var detail = Object.assign({ entityId: entityId }, extra || {});
    var ev = makeEvent(shell.events.moreInfo, { bubbles: true, composed: true, detail: detail });
    target.dispatchEvent(ev);
    return ev;
  };
  // A toast: `detail` is { message, duration, action? }. Fired as the host's
  // toast event, bubbling and composed (a page of HK's that shows its
  // library's messages itself hears it on the way up and stops it); the host
  // draws it (hostToast()), or HK's own toast layer does once it reaches the
  // window (web/hk/shell/hk-overlays.js).
  shell.toast = function (detail, from) {
    var target = from || shell.root();
    if (!target) return null;
    var ev = makeEvent(shell.events.toast, { bubbles: true, composed: true, detail: detail });
    target.dispatchEvent(ev);
    return ev;
  };

  global.hkShell = shell;
  try { win().dispatchEvent(makeEvent('hk-host-shell-ready')); } catch (e) { /* shell tests */ }
})(globalThis);
