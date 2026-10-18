// Mantel's host shell (the contract is web/client/hk-host-shell.js). Mantel's dashboard page is its
// own shell: no HA elements, so HK's overlays (menu, tab bar, pop-ups) mount in #hk-shell-root, and
// the sky and the tab bar find the view in <hk-view-container id="view">, which HK's view host
// (web/hk/shell/hk-view-host.js) fills: attach(viewHost) merges the view host's answers (the
// container, the view shown, the dashboard config) over Mantel's own, again on every view change.
//
// Its events are HK's own (the contract's defaults: hk-navigate, hk-more-info, hk-toast): since slice
// 8b nothing in shared code fires or hears a host's raw event names, only hkShell does.
(function (global) {
  'use strict';
  const S = global.hkShell;
  if (!S) throw new Error('hk-host-shell.js has not loaded');
  const byId = (id) => (global.document ? global.document.getElementById(id) : null);
  const container = () => byId('view');

  const MANTEL = {
    kind: 'mantel',
    // Mantel sends no writes at all (commands_disabled): nothing to hold back
    holdWrites: function () { return true; },
    // Mantel's page has no sidebar of its own for a button to open
    menuButton: () => null,
    tags: { viewContainer: 'hk-view-container' },
    root: () => byId('hk-shell-root'),
    overlayRoot: () => byId('hk-shell-root'),
    // the page itself stands for the dashboard panel (its rect: where the page starts); before the
    // view host is attached there is no view and no config yet
    panel: () => container(),
    viewContainer: () => container(),
    viewSlot: () => container(),
    view: () => null,
    dashboardConfig: () => null,
    onDashboard: () => true,
    isDashboard: () => true,
  };

  // home.js, once HK's view host exists: its parts over Mantel's, now and after every view change
  // (the view host tells its listeners before the new view is attached)
  function attach(viewHost) {
    const use = () => {
      const parts = viewHost.shellParts();
      const tags = Object.assign({}, MANTEL.tags, parts.tags || {});
      S.use(Object.assign({}, MANTEL, parts, { tags }));
    };
    viewHost.onView(use);
    use();
  }

  // The shell's root answers HK's legacy `root.hass` reads with the shim's current snapshot,
  // as the stub for document.querySelector('home-assistant') does (mantel-host.js).
  function install(host) {
    const root = MANTEL.root();
    if (root && !Object.getOwnPropertyDescriptor(root, 'hass')) {
      Object.defineProperty(root, 'hass', { get: () => host.hass });
    }
  }

  S.use(MANTEL);
  global.hkMantelShell = { attach, install, kind: 'mantel' };
})(globalThis);
