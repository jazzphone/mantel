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
  // Music Assistant's web app and go2rtc, served by Mantel under its own address when configured
  // (media_proxy.py; GET /api/services says which this identity may use): same-origin paths under
  // the page's prefix, so HK's MA frame and go2rtc sockets are https on an https page.
  // (/ma/hassio_ingress/mantel/: the same app, signed in by Mantel with the page token; ma_page.py)
  const SERVICE_PATH = /^\/(?:ma(?:\/hassio_ingress\/mantel)?|go2rtc)\/$/;
  let services = {};
  function serviceUrl(name) {
    const path = services && typeof services[name] === 'string' ? services[name] : null;
    return path && SERVICE_PATH.test(path) ? (global.__mantelBase || '') + path : null;
  }

  // Mantel's own settings page (/admin) in HK's menu, for an Owner or Admin only (the page and its APIs
  // refuse everyone else anyway). Under the HA App the address is under the Ingress prefix, so the page
  // opens inside the same frame.
  let role = '';
  function hostMenu() {
    if (role !== 'owner' && role !== 'admin') return [];
    const base = global.__mantelBase || '';
    return [{ title: 'HK Settings', icon: 'mdi:tune-variant', href: base + '/hk-settings' },
            { title: 'Mantel settings', icon: 'mdi:cog-outline', href: base + '/admin' }];
  }

  const MANTEL = {
    kind: 'mantel',
    hostMenu,
    // Mantel sends no writes at all (commands_disabled): nothing to hold back
    holdWrites: function () { return true; },
    // Mantel's page has no sidebar of its own for a button to open
    menuButton: () => null,
    // no detail dialog and no toasts of its own (Phase 2 P2.5): HK's generic sheet takes what HK has
    // no dedicated sheet for, HK's toast layer (web/hk/shell/hk-overlays.js) draws the toasts, and HK's
    // dialogs mount in the overlay root (the contract's dialogRoot)
    hostDetail: () => false,
    openHostDetail: () => false,
    hostToast: () => false,
    serviceUrl,
    tags: { viewContainer: 'hk-view-container' },
    root: () => byId('hk-shell-root'),
    overlayRoot: () => byId('hk-shell-root'),
    // the page itself stands for the dashboard panel (its rect: where the page starts); before the
    // view host is attached there is no view and no config yet. The BODY, not the view container: a
    // docked menu pushes the view slot right by its width (hk-menu.js room) and draws itself at the
    // panel's left, so a panel that is the slot moved the menu along with the page: menu at 300 px,
    // the page under it from 600 (2026-10-19, the direct address at a desktop width)
    panel: () => (global.document ? global.document.body : null),
    viewContainer: () => container(),
    viewSlot: () => container(),
    view: () => null,
    dashboardConfig: () => null,
    onDashboard: () => true,
    isDashboard: () => true,
  };

  // home.js, once HK's view host exists: its parts over Mantel's, now and after every view change
  // (the view host tells its listeners before the new view is attached). The panel stays Mantel's
  // own: the view host offers its container, which is also the view slot (see MANTEL.panel).
  function attach(viewHost) {
    const use = () => {
      const parts = viewHost.shellParts();
      const tags = Object.assign({}, MANTEL.tags, parts.tags || {});
      S.use(Object.assign({}, MANTEL, parts, { tags, panel: MANTEL.panel }));
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
  // home.js hands over GET /api/services ({music_assistant: '/ma/' | null, go2rtc: '/go2rtc/' | null})
  function setServices(got) { services = got && typeof got === 'object' ? got : {}; }

  // home.js hands over the signed-in person's Mantel role (GET /api/me)
  function setRole(r) { role = typeof r === 'string' ? r : ''; }

  global.hkMantelShell = { attach, install, setServices, setRole, hostMenu, serviceUrl, kind: 'mantel' };
})(globalThis);
