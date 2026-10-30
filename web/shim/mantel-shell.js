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
  // KEEP IN VIEW: a photo's point set by hand ([x, y]) and its faces ([x, y, w, h] each, at most 12), passed on
  // only when every number is 0..1 (the saver checks again); nothing at all for a photo without them
  const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  function focusOf(p) {
    const out = {};
    if (Array.isArray(p.focus) && p.focus.length === 2 && p.focus.every(unit)) out.focus = [p.focus[0], p.focus[1]];
    if (Array.isArray(p.faces)) {
      const faces = p.faces.slice(0, 12).filter((f) => Array.isArray(f) && f.length === 4 && f.every(unit) && f[2] > 0 && f[3] > 0);
      if (faces.length) out.faces = faces.map((f) => f.slice());
    }
    return out;
  }
  // PHOTOS SIZED TO THE SCREEN (2026-10-29): a photo is kept at 2560 px (`/screen`) and, made the first time it is
  // asked for, at 1280 px (`/mid`): the saver loads the one closest to its screen. [long edge, address], any order.
  const SIZE_EDGES = [['mid', 1280], ['screen', 2560]];
  function sizesOf(url, base) {
    return { variants: SIZE_EDGES.map(([name, edge]) => [edge, base + url.replace(/\/screen$/, '/' + name)]) };
  }
  // ALBUM ART AT THE TILE'S SIZE (2026-10-29): a player's artwork is Mantel's own route, and takes a size bucket
  // (media_art.py; the same buckets as hk_core/art/resize.py SIZES) -- asked for the size the tile draws
  const ART_LOCAL = /^(?:[^?#]*)\/api\/media\/media_player\.[a-z0-9_]+\/art(?:\?[^#]*)?$/;
  const ART_BUCKETS = [150, 300, 600, 1000];
  function artSized(url, size) {
    if (typeof url !== 'string' || !ART_LOCAL.test(url) || /[?&]s=/.test(url)) return url;
    const n = Math.floor(Number(size));
    if (!Number.isFinite(n) || n <= 0) return url;
    const s = ART_BUCKETS.find((b) => b >= n) || ART_BUCKETS[ART_BUCKETS.length - 1];
    return url + (url.indexOf('?') < 0 ? '?' : '&') + 's=' + s;
  }
  // PHOTO TITLES AND TIME BEHIND (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): the album's name and the
  // year a photo was taken; and for a photo whose subject Mantel cut out, its mask (Mantel's own address, the
  // page's prefix in front) and where the time goes ([x, y, w, h], each 0..1) -- passed on only when sound
  const MASK_URL = /^\/api\/photos\/([0-9a-f]{32})\/mask(\?v=\d{1,12})?$/;
  function depthOf(p, base) {
    const d = p && p.depth, b = d && d.box, m = d && typeof d.mask === 'string' ? MASK_URL.exec(d.mask) : null;
    if (!m || m[1] !== String(p.id) || !Array.isArray(b) || b.length !== 4 || !b.every(unit) || !(b[2] > 0 && b[3] > 0)) return {};
    return { depth: { mask: base + d.mask, box: b.slice() } };
  }
  function titleOf(p, album) {
    const out = {};
    if (album && typeof album.name === 'string' && album.name) out.album = album.name;
    if (Number.isInteger(p.year) && p.year >= 1900 && p.year <= 2100) out.year = p.year;
    return out;
  }
  function listPhotos(source) {
    const m = ALBUM.exec(String(source || ''));
    if (!m || typeof global.fetch !== 'function') return null;
    const base = global.__mantelBase || '';
    return global.fetch(mantelUrl('/api/photos/albums/' + m[1] + '/show'), { credentials: 'same-origin', cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('album ' + r.status); return r.json(); })
      .then((j) => ((j && j.photos) || []).filter((p) => p && typeof p.url === 'string' && PHOTO_URL.test(p.url))
        .map((p) => Object.assign({ id: String(p.id), title: typeof p.title === 'string' ? p.title : '', url: base + p.url },
                                  sizesOf(p.url, base), focusOf(p), depthOf(p, base), titleOf(p, j.album))));
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
    // (Mantel Link takes it there: nothing in a Webpage dashboard's sandbox may move Home Assistant's window)
    const out = frame && frame.kind === 'dashboard'
      ? [{ title: 'Home Assistant', icon: 'mdi:home-assistant', run: () => frame.back(), section: 'Mantel' }] : [];
    // the iPhone and iPad app's own settings (favorites, Face ID, notifications, Clear Cache, Sign Out): a native
    // sheet, the app's only menu (shim/mantel-native.js)
    const N = global.mantelNative;
    if (N && N.platform === 'ios' && typeof N.menu === 'function') {
      out.push({ title: 'Mantel App', icon: 'mdi:cellphone', run: () => N.menu('app'), section: 'Mantel' });
    }
    if (PEOPLE.indexOf(role) < 0) return out;
    const base = global.__mantelBase || '';
    return out.concat([{ title: 'Mantel Settings', icon: 'mdi:cog-outline', href: base + '/settings', section: 'Mantel' }]);
  }
  // HOME ASSISTANT IN HK'S MENU AND TAB BAR (the screen's Menu -> Home Assistant Section), by where the page is.
  // Inside Home Assistant (a Webpage dashboard with Mantel Link, or the App's sidebar panel; ha-frame.js): this
  // person's Home Assistant sidebar, each row opening that page in Home Assistant's own window. Opened at Mantel's
  // own address: one row opening Home Assistant's address (GET /api/me `ha_address`: HA's external URL, else its
  // internal one; none for a wall tablet, which then has no Home Assistant row at all). This decides only which
  // rows are drawn: what a person may do stays the server's.
  let haAddress = '';
  function setHaAddress(u) {
    const next = typeof u === 'string' && /^https?:\/\/[^/?#\s]+\/?$/.test(u) ? u : '';
    if (next === haAddress) return;
    haAddress = next;
    try { global.dispatchEvent(new global.CustomEvent('hk-ha-nav-changed')); } catch (e) { /* no window */ }
  }
  const frameSide = () => { const f = global.__mantelHaFrame; return f && f.sidebar ? f.sidebar() : null; };
  function haNav() {
    const f = global.__mantelHaFrame;
    if (f) {
      if (frameSide()) return 'own';
      // a Webpage dashboard whose Mantel Link has not said the sidebar (or never will: 0.1.0): HA's sandbox forbids
      // this page to move HA's window, so no row (the Mantel -> Home Assistant row is the way back); the App's panel
      // whose HA page cannot be read: its start page (that frame has no sandbox)
      const home = f.homeUrl && f.homeUrl();
      return home ? { link: home, top: true } : null;
    }
    return haAddress ? { link: haAddress, top: false } : null;
  }

  // THE WALL TABLET'S ROOM (a Home Grid's `tablet_room`): the room this device was enrolled in (GET /api/me
  // `room`, a wall tablet's only), else the room of the HK tablet the page is (a tablet signed in as its own
  // person; hk-settings.js tablet()). null on a person's browser.
  let deviceRoom = null;
  const ROOM_ID = /^[a-z0-9_]{1,80}$/;
  function setRoom(r) { deviceRoom = typeof r === 'string' && ROOM_ID.test(r) ? r : null; }
  function tabletRoom(client) {
    if (deviceRoom) return deviceRoom;
    const HS = global.hkSettings;
    const t = HS && typeof HS.tablet === 'function' ? HS.tablet(client) : null;
    return t && typeof t.room === 'string' && ROOM_ID.test(t.room) ? t.room : null;
  }
  // AT A WALL TABLET (hkShell.atTablet): a device session, with or without a person signed in on top (GET /api/me
  // `at_tablet`, handed over by home.js and settings-page.js), else the HK tablet the page is (hk-settings.js
  // tablet(), as Home Assistant's shell asks)
  let deviceSession = false;
  function setAtTablet(v) { deviceSession = v === true; }
  function atTablet(client) {
    if (deviceSession) return true;
    const HS = global.hkSettings;
    return !!(HS && typeof HS.tablet === 'function' && HS.tablet(client));
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
    haNav,
    sidebarData: frameSide,
    haNavigate: (path) => { const f = global.__mantelHaFrame; return f && frameSide() ? f.navigate(path) : false; },
    openHaMenu: () => { const f = global.__mantelHaFrame; return !!(f && f.menu()); },
    showNotifications: () => { const f = global.__mantelHaFrame; if (f && frameSide()) f.notifications(); },
    // no detail dialog and no toasts of its own (Phase 2 P2.5): HK's generic sheet takes what HK has
    // no dedicated sheet for, HK's toast layer (web/hk/shell/hk-overlays.js) draws the toasts, and HK's
    // dialogs mount in the overlay root (the contract's dialogRoot)
    hostDetail: () => false,
    openHostDetail: () => false,
    hostToast: () => false,
    serviceUrl,
    photoSource,
    listPhotos,
    artSized,
    // HK's screens and settings say Mantel where they speak of themselves; HK Frontend stays the name of
    // the integration in Home Assistant, whose settings are Home Assistant's (haPlace)
    productName: () => 'Mantel',
    haPlace: (path) => 'Home Assistant → ' + path,
    haName: (name) => name + ' in Home Assistant',
    // Mantel Link's cameras are Live TV's channels (once the house's Live TV is Mantel's): not the house's
    notHouseCameraPlatforms: () => ['mantel'],
    tabletRoom,
    atTablet,
    // Mantel's own docs (/docs, docs_pages.py: HK's pages and Mantel's), under the page's prefix
    docsUrl: (page, anchor) => (global.__mantelBase || '') + '/docs/' + encodeURIComponent(page) + (anchor ? '#' + encodeURIComponent(anchor) : ''),
    tags: { viewContainer: 'hk-view-container' },
    // THE VIEW KINDS HK's view host puts in the container: the strategies' hk-grid-view, and its fallback
    // for a view of any other type. Read once as HK's modules load (hk-glass.js, hk-frosttint.js), so
    // declared here and not by the view host. Without them the shared blur's view layer went into the
    // container itself, before the sky (fixed, z-index -1, the same stacking context): the sky painted over
    // it, and only the sideways rows' pills were frosted -- Shared Layer and Pre-rendered left every pill
    // on the page clear (2026-10-20). In the view, the layer comes after the sky, as in Home Assistant's.
    // (and a Home Grid screen's Home, hk-home-grid-view)
    viewTags: ['hk-grid-view', 'hk-home-grid-view', 'hk-view-fallback'],
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

  global.hkMantelShell = { attach, install, setServices, setRole, setRoom, setAtTablet, setSettings, setHaAddress, hostMenu, haNav,
                           serviceUrl, tabletRoom, atTablet, kind: 'mantel' };
})(globalThis);
