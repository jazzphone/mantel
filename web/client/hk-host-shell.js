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
  function nil() { return null; }

  // Elements the shell can name. `tags` are the element names, for the few
  // places that must write a selector into a stylesheet or test an element
  // they walked to; a host without that element leaves it null.
  var KINDS = ['root', 'main', 'drawer', 'sidebar', 'resolver', 'panel', 'dashboard',
               'viewContainer', 'view', 'viewBackground'];

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
    menuButton: nil
  };
  KINDS.forEach(function (k) { NONE.tags[k] = null; });

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
   'defined', 'showNotifications', 'keepAwake', 'sidebarData', 'holdWrites', 'menuButton'].forEach(function (name) {
    shell[name] = function () {
      try { return get(name).apply(shell, arguments); } catch (e) { return name === 'onDashboard' ? true : null; }
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
  // A toast: `detail` is { message, duration, action? }.
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
