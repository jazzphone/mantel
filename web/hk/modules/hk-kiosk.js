// hk-kiosk.js -- HIDE HOME ASSISTANT'S HEADER AND SIDEBAR on a screen that
// asks (HK Frontend 1.3). Written for HK Frontend from Home Assistant's own
// layout; it replaces the Kiosk Mode plugin (HACS), which a generated screen
// can still choose instead (kiosk_engine).
//
// WHO ASKS, in order:
//   * ?hk_kiosk=on on the address hides both, whatever the screen says
//     (HK Settings' preview); ?hk_kiosk=off hides nothing (a tablet being
//     worked on). Either lasts until the page is reloaded: nothing is
//     stored, so a reload is always the screen as set.
//   * not a dashboard (Settings, Logs, the Map): nothing hidden, ever --
//     Home Assistant's own sidebar is the way back from there.
//   * the dashboard's config has `kiosk_mode:` -- the Kiosk Mode plugin's
//     block: that plugin does it, and this stays out of the way.
//   * the dashboard's config has `hk_kiosk:` -- a generated screen's
//     (hk-strategy.js kioskOf) or one written in YAML:
//         hk_kiosk: true
//         hk_kiosk: { header: true, sidebar: true, admins: true }
//   * else the screen's HK settings (HK Settings -> the screen -> Hide Home
//     Assistant Header & Sidebar): how an existing dashboard gets it with
//     nothing written in its YAML.
// `admins: false` leaves an admin's header and sidebar alone.
//
// HOW. Home Assistant draws its sidebar's width from one variable on
// home-assistant-main (--ha-sidebar-width: the drawer's sidebar shell and the
// page's left padding both read it) and the dashboard's header as `.header`
// in hui-root, whose views sit below it by `hui-view-container`'s top
// padding. One small stylesheet goes into each of those shadow roots -- only
// on a screen that hides something -- and it applies only while an
// attribute of ours is on the element (hk-kiosk-sidebar / hk-kiosk-header).
// Turning it off is taking the attribute away: nothing of Home Assistant's
// is changed or removed, so leaving a screen puts everything back at once
// (the Kiosk Mode plugin's rules outlived the dashboard that set them: see
// hk-menu.js syncOutside, which still handles a screen using the plugin).
//
// A WALL TABLET KEEPS ITS CONNECTION. Signed in as any screen's Tablet User,
// this browser's "Automatically close connection" (Home Assistant's profile
// setting, kept in the browser) is turned off, once, the way the profile's
// own switch does it. Home Assistant closes the connection of a page hidden
// for five minutes; a kiosk app restarted while its screen is dark loads the
// page hidden, and when the screen woke the page never heard it -- the clock
// stood at the restart and nothing else updated (Master Bathroom, 2026-10-05).
//
// hkKiosk.hold(true) shows the sidebar while the menu's Show Menu has Home
// Assistant's sidebar open over the page (hk-menu.js), hold(false) hides it
// again.
(function () {
  'use strict';
  if (window.hkKiosk) return;              // hk-loader may import this twice

  var SIDEBAR = 'hk-kiosk-sidebar', HEADER = 'hk-kiosk-header';
  var CSS = {
    // the sidebar: no width (so no page padding for it and a full-width
    // header), and not drawn
    main: ':host([' + SIDEBAR + ']){--ha-sidebar-width:0px !important}' +
          ':host([' + SIDEBAR + ']) ha-drawer > ha-sidebar{display:none !important}',
    // ...its shell (which keeps a 1 px border at no width) and the phone's
    // pull-out drawer, which would open empty. AT ONCE: Home Assistant
    // animates the page's padding (0.25 s), so hiding the sidebar on load slid
    // the whole dashboard 256 px left as it appeared, the menu with it
    // (2026-10-09). Showing it again (hold, Show Menu) still animates.
    drawer: ':host([' + SIDEBAR + ']) .sidebar-shell{display:none !important}' +
            ':host([' + SIDEBAR + ']) .app-content{padding-inline-start:0 !important;transition:none !important}' +
            ':host([' + SIDEBAR + ']) wa-drawer{display:none !important}',
    // the header, and the room the views keep for it
    root: ':host([' + HEADER + ']) .header{display:none !important}' +
          ':host([' + HEADER + ']) hui-view-container{padding-top:calc(var(--safe-area-inset-top, 0px) + ' +
          'var(--view-container-padding-top, 0px)) !important}'
  };

  // ------------------------------------------------------------ pure helpers
  // (exported on hkKiosk._ for tests/test_kiosk.js)
  // A block as written (true, false, or a mapping) -> what to hide, or null.
  function norm(v) {
    if (v === true) return { header: true, sidebar: true, admins: true };
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var out = { header: v.header !== false, sidebar: v.sidebar !== false, admins: v.admins !== false };
    return out.header || out.sidebar ? out : null;
  }
  // A screen's HK settings -> the same, or null. Only HK Frontend's own:
  // a screen that chose the plugin has its kiosk_mode block instead.
  function fromBoard(b) {
    if (!b || !b.kiosk) return null;
    var eng = b.kiosk_engine || (b.kiosk_options && Object.keys(b.kiosk_options).length ? 'kiosk_mode' : 'hk');
    if (eng === 'kiosk_mode') return null;
    return norm({ header: b.kiosk_header, sidebar: b.kiosk_sidebar, admins: b.kiosk_admins });
  }
  // THE DECISION. `q`: { dashboard (a Lovelace panel: true/false/null while
  // unknown), cfg (this dashboard's config, or null while it loads), board
  // (its HK settings, or null), admin, off (?hk_kiosk=off), forced
  // (?hk_kiosk=on) }. -> { header, sidebar, source } or null.
  function decide(q) {
    if (q.dashboard === false) return null;
    var w = null, source = null;
    if (q.forced) { w = norm(true); source = 'url'; }
    else if (q.off) return null;
    else if (q.cfg && q.cfg.kiosk_mode) return null;
    else if (q.cfg && q.cfg.hk_kiosk !== undefined) { w = norm(q.cfg.hk_kiosk); source = 'config'; }
    else { w = fromBoard(q.board); source = 'settings'; }
    if (!w || (q.admin && !w.admins)) return null;
    return { header: w.header, sidebar: w.sidebar, source: source };
  }

  // ------------------------------------------------------------ the page
  function seg() {
    try { return decodeURIComponent(String(location.pathname).split('/')[1] || ''); } catch (e) { return ''; }
  }
  function parts() {
    var ha = document.querySelector('home-assistant');
    var main = ha && ha.shadowRoot && ha.shadowRoot.querySelector('home-assistant-main');
    var sr = main && main.shadowRoot;
    return { ha: ha, main: main, drawer: sr && sr.querySelector('ha-drawer'),
             resolver: sr && sr.querySelector('partial-panel-resolver'),
             panel: sr && sr.querySelector('ha-panel-lovelace') };
  }
  // this dashboard's config -- only once the panel on the page IS this
  // dashboard's (on the way from one to another the old one is still there)
  function configOf(p) {
    var el = p.panel;
    if (!el || !el.lovelace || !el.lovelace.config) return null;
    var url = el.panel && el.panel.url_path;
    return url && url !== seg() ? null : el.lovelace.config;
  }
  function boardOf() {
    var HS = window.hkSettings, all = HS && HS.get ? HS.get('boards', null) : null;
    return (all && all[seg()]) || null;
  }

  // ?hk_kiosk=on / off, as last seen on the address: kept while the page
  // lives (Home Assistant drops the query as you move around it)
  var forced = false, off = false, held = false, now = null;
  function readUrl() {
    var q = '';
    try { q = String(location.search || ''); } catch (e) { /* a test harness */ }
    if (/[?&]hk_kiosk=on\b/.test(q)) { forced = true; off = false; }
    if (/[?&]hk_kiosk=off\b/.test(q)) { off = true; forced = false; }
  }

  function style(root, css) {
    if (!root || root.querySelector('style#hk-kiosk')) return;
    var el = document.createElement('style');
    el.id = 'hk-kiosk';
    el.textContent = css;
    root.appendChild(el);
  }
  function mark(el, attr, on, css) {
    if (!el) return;
    if (on) { style(el.shadowRoot, css); if (!el.hasAttribute(attr)) el.setAttribute(attr, ''); }
    else if (el.hasAttribute(attr)) el.removeAttribute(attr);
  }

  // Is `name` some screen's Tablet User? (settings.py board tablet_user)
  function tabletUser(boards, name) {
    if (!boards || !name) return false;
    return Object.keys(boards).some(function (k) { return !!boards[k] && boards[k].tablet_user === name; });
  }
  var keptOn = false;
  function keepConnected(ha, h) {
    if (keptOn || !ha || !h || !h.user) return;
    var HS = window.hkSettings;
    // a wall tablet (1.14: hkSettings.tablet() -- its address or its user;
    // before, some screen's Tablet User)
    var isTablet = HS && typeof HS.tablet === 'function' && HS.get('tablet_items', null) !== null
      ? !!HS.tablet(h) : tabletUser(HS && HS.get ? HS.get('boards', null) : null, h.user.name);
    if (!isTablet) return;
    keptOn = true;
    if (h.suspendWhenHidden === false) return;
    try { ha.dispatchEvent(new CustomEvent('hass-suspend-when-hidden', { detail: { suspend: false } })); }
    catch (e) { /* an older Home Assistant */ }
  }

  function apply() {
    var p = parts();
    if (!p.main) return;
    var HS = window.hkSettings, h = p.ha && p.ha.hass;
    keepConnected(p.ha, h);
    var w = decide({ dashboard: HS && HS.lovelacePanel ? HS.lovelacePanel() : null, cfg: configOf(p), board: boardOf(),
                     admin: !!(h && h.user && h.user.is_admin), off: off, forced: forced });
    now = w;
    var side = !!(w && w.sidebar && !held);
    mark(p.main, SIDEBAR, side, CSS.main);
    mark(p.drawer, SIDEBAR, side, CSS.drawer);
    var root = p.panel && p.panel.shadowRoot && p.panel.shadowRoot.querySelector('hui-root');
    mark(root, HEADER, !!(w && w.header), CSS.root);
    watch(p);
  }

  // WHEN TO LOOK AGAIN: a page change (and a few times after, while the new
  // dashboard arrives), a settings change, and the dashboard redrawing its
  // root -- watched on the two elements that change, never the whole page.
  var timers = [];
  function soon(delays) {
    timers.forEach(clearTimeout);
    timers = (delays || [0, 60, 200, 500, 1200, 3000]).map(function (d) { return setTimeout(apply, d); });
  }
  var seen = { resolver: null, panel: null }, mo = null;
  function watch(p) {
    if (typeof MutationObserver === 'undefined') return;
    var r = p.resolver, pn = p.panel && p.panel.shadowRoot;
    if (r === seen.resolver && pn === seen.panel) return;
    if (mo) mo.disconnect();
    mo = new MutationObserver(function () { apply(); });
    if (r) mo.observe(r, { childList: true });
    if (pn) mo.observe(pn, { childList: true });
    seen = { resolver: r, panel: pn };
  }

  try {
    readUrl();
    window.addEventListener('location-changed', function () { readUrl(); soon(); });
    window.addEventListener('popstate', function () { readUrl(); soon(); });
  } catch (e) { /* no window events (a test harness) */ }
  // until Home Assistant's page is there, and the settings
  (function wait(n) {
    apply();
    var HS = window.hkSettings;
    if (HS && HS.onChange && !wait.hooked) {
      wait.hooked = true;
      HS.onChange(function () { soon([0, 300, 1200, 3000]); });
    }
    if (n < 100 && !(parts().main && wait.hooked)) setTimeout(function () { wait(n + 1); }, 100);
    else soon();
  })(0);

  window.hkKiosk = {
    // what this page hides now: { header, sidebar, source } or null
    state: function () { return now ? { header: now.header, sidebar: now.sidebar && !held, source: now.source } : null; },
    hold: function (on) { held = !!on; apply(); },
    refresh: apply,
    _: { norm: norm, fromBoard: fromBoard, decide: decide, CSS: CSS, tabletUser: tabletUser }
  };
})();
