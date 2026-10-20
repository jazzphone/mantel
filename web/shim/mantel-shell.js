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

  // MANTEL PHOTOS (photos.py) for HK's screensaver (hk-saver.js, the contract's photoSource/listPhotos): a
  // screen may show one of Mantel's albums instead of the house's Screensaver Photos (GET /api/photos/screens,
  // read once and again every few minutes, or at once when Mantel Settings says it changed), and an album
  // (mantel-photos://<id>, the house's photos or a screen's) is listed by Mantel with its screen-sized photos.
  const ALBUM = /^mantel-photos:\/\/([0-9a-f]{16})$/;
  const PHOTO_URL = /^\/api\/photos\/[0-9a-f]{32}\/screen$/;
  const SCREENS_TTL = 5 * 60 * 1000;
  const CHANGED_KEY = 'mantel-photos-changed';       // mantel-photos.js sets it after a change (the storage event)
  let photoScreens = null, screensAt = 0, screensReading = null;
  const mantelUrl = (path) => (global.__mantelBase || '') + path;      // base.js's, for this classic script
  function screenNow() {
    const base = global.__mantelBase || '';
    const path = String((global.location && global.location.pathname) || '');
    return (path.startsWith(base) ? path.slice(base.length) : path).split('/')[1] || '';
  }
  function photosChanged() {
    try { if (global.hkSaver && global.hkSaver.photosChanged) global.hkSaver.photosChanged(); } catch (e) { /* no saver here */ }
  }
  function readScreens(always) {
    if (screensReading || typeof global.fetch !== 'function') return;
    screensAt = Date.now();
    screensReading = global.fetch(mantelUrl('/api/photos/screens'), { credentials: 'same-origin', cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { screens: {} }))
      .then((j) => {
        const next = j && j.screens && typeof j.screens === 'object' ? j.screens : {};
        const changed = JSON.stringify(next) !== JSON.stringify(photoScreens || {});
        photoScreens = next;
        if (changed || always) photosChanged();
      }, () => { photoScreens = photoScreens || {}; })
      .then(() => { screensReading = null; });
  }
  function photoSource() {
    if (photoScreens === null || Date.now() - screensAt > SCREENS_TTL) readScreens();
    const album = photoScreens && photoScreens[screenNow()];
    return typeof album === 'string' && /^[0-9a-f]{16}$/.test(album) ? 'mantel-photos://' + album : null;
  }
  function listPhotos(source) {
    const m = ALBUM.exec(String(source || ''));
    if (!m || typeof global.fetch !== 'function') return null;
    const base = global.__mantelBase || '';
    return global.fetch(mantelUrl('/api/photos/albums/' + m[1] + '/show'), { credentials: 'same-origin', cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('album ' + r.status); return r.json(); })
      .then((j) => ((j && j.photos) || []).filter((p) => p && typeof p.url === 'string' && PHOTO_URL.test(p.url))
        .map((p) => ({ id: String(p.id), title: typeof p.title === 'string' ? p.title : '', url: base + p.url })));
  }
  if (global.addEventListener) {
    global.addEventListener('storage', (e) => {
      if (e && e.key === CHANGED_KEY) readScreens(true);
    });
  }

  // Mantel Settings (/settings: HK's settings and Mantel's own, one page) in HK's menu, for every person
  // signed in (Me is everyone's; the house's pages are an Owner's or Admin's, and the page and its APIs
  // decide that); a wall tablet has none. Under the HA App the address is under the Ingress prefix, so the
  // page opens inside the same frame.
  let role = '';
  const PEOPLE = ['owner', 'admin', 'adult', 'child', 'guest'];
  // Shown inside Home Assistant (a Webpage dashboard; ha-frame.js): a row back to Home Assistant, the way out
  // when HA's own sidebar is hidden around the screen (Mantel Link, docs/phase9/MANTEL-LINK.md 9.6).
  function hostMenu() {
    const frame = global.__mantelHaFrame;
    const out = frame ? [{ title: 'Home Assistant', icon: 'mdi:home-assistant', run: () => frame.back(), section: 'Mantel' }] : [];
    if (PEOPLE.indexOf(role) < 0) return out;
    const base = global.__mantelBase || '';
    return out.concat([{ title: 'Mantel Settings', icon: 'mdi:cog-outline', href: base + '/settings', section: 'Mantel' }]);
  }
  // Mantel's pages in the settings panel (web/shim/mantel-settings.js), once settings-page.js has them
  let settings = null;
  function setSettings(host) { settings = host || null; }

  const MANTEL = {
    kind: 'mantel',
    hostMenu,
    settingsHost: () => settings,
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
    photoSource,
    listPhotos,
    // HK's screens and settings say Mantel where they speak of themselves; HK Frontend stays the name of
    // the integration in Home Assistant, whose settings are Home Assistant's (haPlace)
    productName: () => 'Mantel',
    haPlace: (path) => 'Home Assistant → ' + path,
    haName: (name) => name + ' in Home Assistant',
    // Mantel's own docs (/docs, docs_pages.py: HK's pages and Mantel's), under the page's prefix
    docsUrl: (page, anchor) => (global.__mantelBase || '') + '/docs/' + encodeURIComponent(page) + (anchor ? '#' + encodeURIComponent(anchor) : ''),
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

  global.hkMantelShell = { attach, install, setServices, setRole, setSettings, hostMenu, serviceUrl, kind: 'mantel' };
})(globalThis);
