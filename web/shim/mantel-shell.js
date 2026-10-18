// Mantel's host shell (the contract is web/client/hk-host-shell.js). Mantel's Home page is its own
// shell: no HA elements, so HK's overlays (menu, tab bar, pop-ups) mount in #hk-shell-root, and the
// sky and the tab bar find the view in <hk-view-container id="view">, which home.js fills.
//
// The event names stay HA's for now: hk-detail.js and hk-saver*.js (Phase 1 slice 5's files) still
// fire and hear them directly, so in Mantel both sides must agree until those files use hkShell too.
(function (global) {
  'use strict';
  const S = global.hkShell;
  if (!S) throw new Error('hk-host-shell.js has not loaded');
  const page = { view: null, config: null };
  const byId = (id) => (global.document ? global.document.getElementById(id) : null);
  const container = () => byId('view');

  const MANTEL = {
    kind: 'mantel',
    events: { navigate: 'location-changed', moreInfo: 'hass-more-info', toast: 'hass-notification' },
    tags: { viewContainer: 'hk-view-container' },
    root: () => byId('hk-shell-root'),
    overlayRoot: () => byId('hk-shell-root'),
    // the page itself stands for the dashboard panel (its rect: where the page starts)
    panel: () => container(),
    viewContainer: () => container(),
    viewSlot: () => container(),
    view: (c) => (c === undefined || c === container() ? page.view : null),
    dashboardConfig: () => page.config,
    onDashboard: () => true,
    isDashboard: () => true,
  };

  // home.js, once the view is built: the view element and the dashboard config it came from
  function setPage(view, config) {
    page.view = view || null;
    page.config = config || null;
    const tags = Object.assign({}, MANTEL.tags, view ? { view: view.localName } : {});
    S.use(Object.assign({}, MANTEL, { tags }));
  }

  // The shell's root answers HK's legacy `root.hass` reads with the shim's current snapshot,
  // as the stub for document.querySelector('home-assistant') does (hass-shim.js).
  function install(host) {
    const root = MANTEL.root();
    if (root && !Object.getOwnPropertyDescriptor(root, 'hass')) {
      Object.defineProperty(root, 'hass', { get: () => host.hass });
    }
  }

  S.use(MANTEL);
  global.hkMantelShell = { setPage, install, kind: 'mantel' };
})(globalThis);
