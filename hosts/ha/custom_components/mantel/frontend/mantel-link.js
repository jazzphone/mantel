// mantel-link.js -- Mantel Link on Home Assistant's own pages (docs/phase9/MANTEL-LINK.md 9.6).
//
// A Mantel screen shown in HA is a Webpage dashboard framing Mantel's address. The screen (Mantel's
// web/shim/ha-frame.js) tells the page around it:
//   {source: 'mantel', type: 'mantel/kiosk', header, sidebar, admins}   its "Home Assistant Header & Sidebar"
//   {source: 'mantel', type: 'mantel/back'}                             its menu's Home Assistant row
//   {source: 'mantel', type: 'mantel/navigate', path}                   a row of its Home Assistant section
//   {source: 'mantel', type: 'mantel/notifications'}                    ... Notifications
//   {source: 'mantel', type: 'mantel/menu'}                             ... Show Menu
// and this script answers by hiding HA's header and sidebar around that frame (as HK Frontend's hk-kiosk.js did:
// one stylesheet in each of three shadow roots, applied only while an attribute of ours is on the element, so
// leaving the screen puts everything back at once), by going to HA's own start page or to one of HA's own pages
// (a panel this person has), by opening HA's notification drawer, or HA's sidebar over the page (HK's Show Menu).
// To the frame that spoke it says, at its own address only, this person's HA sidebar -- the panels' keys, titles
// and icons, their sidebar order and hidden ones, whether HA's sidebar is beside the frame -- so the screen's menu
// offers HA's pages as HK in HA did:
//   {type: 'mantel-link/sidebar', panels: {key: {title, icon, require_admin}}, admin, prefs, shown}
//
// WHO IS BELIEVED: a message from one of Mantel's own addresses (Mantel Link's `mantel/frontend/config`, from
// the link's hello) AND from an iframe on the dashboard shown right now. Nothing else; and a message can only
// hide the chrome around its own frame, open HA's own pages, drawer or sidebar. Never a command.
// `admins: false` leaves an admin's header and sidebar.
(function () {
  'use strict';
  if (window.__mantelLink) return;
  window.__mantelLink = { version: '3' };

  var SIDEBAR = 'mantel-kiosk-sidebar', HEADER = 'mantel-kiosk-header';
  var CSS = {
    main: ':host([' + SIDEBAR + ']){--ha-sidebar-width:0px !important}' +
          ':host([' + SIDEBAR + ']) ha-drawer > ha-sidebar{display:none !important}',
    drawer: ':host([' + SIDEBAR + ']) .sidebar-shell{display:none !important}' +
            ':host([' + SIDEBAR + ']) .app-content{padding-inline-start:0 !important;transition:none !important}' +
            ':host([' + SIDEBAR + ']) wa-drawer{display:none !important}',
    root: ':host([' + HEADER + ']) .header{display:none !important}' +
          ':host([' + HEADER + ']) hui-view-container{padding-top:calc(var(--safe-area-inset-top, 0px) + ' +
          'var(--view-container-padding-top, 0px)) !important}'
  };

  // ---- Home Assistant's page (the same elements HK Frontend's shell names)
  function sr(el) { return (el && el.shadowRoot) || null; }
  function ha() { return document.querySelector('home-assistant'); }
  function main() { var r = sr(ha()); return (r && r.querySelector('home-assistant-main')) || null; }
  function drawer() { var m = sr(main()); return (m && m.querySelector('ha-drawer')) || null; }
  function panel() {
    var m = sr(main());
    if (!m) return null;
    var p = m.querySelector('ha-panel-lovelace');
    if (!p) { var r = m.querySelector('partial-panel-resolver'); p = r && r.querySelector('ha-panel-lovelace'); }
    return p || null;
  }
  function root() { var p = sr(panel()); return (p && p.querySelector('hui-root')) || null; }
  function sidebarEl() { var m = sr(main()); return (m && m.querySelector('ha-sidebar')) || null; }
  // every iframe under an element, through shadow roots (a dashboard is a few levels deep)
  function frames(node, out, depth) {
    if (!node || depth > 14) return out;
    var kids = [];
    if (node.shadowRoot) kids.push(node.shadowRoot);
    var list = node.children || [];
    for (var i = 0; i < list.length; i++) kids.push(list[i]);
    kids.forEach(function (k) {
      if (k.localName === 'iframe') out.push(k);
      frames(k, out, depth + 1);
    });
    return out;
  }
  function frameOf(source) {
    if (!source) return null;
    var list = frames(panel(), [], 0);
    for (var i = 0; i < list.length; i++) if (list[i].contentWindow === source) return list[i];
    return null;
  }

  // ---- the stylesheets
  function style(r, css) {
    if (!r || r.querySelector('style#mantel-kiosk')) return;
    var el = document.createElement('style');
    el.id = 'mantel-kiosk';
    el.textContent = css;
    r.appendChild(el);
  }
  function mark(el, attr, on, css) {
    if (!el) return;
    if (on) { style(el.shadowRoot, css); if (!el.hasAttribute(attr)) el.setAttribute(attr, ''); }
    else if (el.hasAttribute(attr)) el.removeAttribute(attr);
  }

  // ---- what the screen on this page said
  var origins = [], said = null;          // said: {frame, path, header, sidebar, admins}
  function isAdmin() { var h = ha() && ha().hass; return !!(h && h.user && h.user.is_admin); }
  function apply() {
    var w = said && said.path === location.pathname && frameOf(said.frame && said.frame.contentWindow) ? said : null;
    if (w && isAdmin() && !w.admins) w = null;
    mark(main(), SIDEBAR, !!(w && w.sidebar && !lift), CSS.main);
    mark(drawer(), SIDEBAR, !!(w && w.sidebar && !lift), CSS.drawer);
    mark(root(), HEADER, !!(w && w.header), CSS.root);
    return w;
  }
  function go(path) {
    said = null;
    apply();
    history.pushState(null, '', path);
    window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
  }
  function back() { go('/'); }
  // one of HA's own pages: a plain path whose first part is a panel this person has ('/config/dashboard',
  // '/profile/general', '/map'), nothing else
  var PATH = /^\/[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_.-]{1,64}){0,4}$/;
  function mayGo(path) {
    var h = ha() && ha().hass;
    if (typeof path !== 'string' || !PATH.test(path) || !h || !h.panels) return false;
    return Object.prototype.hasOwnProperty.call(h.panels, path.split('/')[1]);
  }
  function notifications() {
    var m = main();
    if (m) m.dispatchEvent(new CustomEvent('hass-show-notifications', { bubbles: true, composed: true }));
  }

  // ---- HA's sidebar for the screen's Show Menu, HA's own way. Where HA draws its sidebar as a drawer over the page
  // (a narrow window, a sidebar set to "always hidden", HA's kiosk mode) HA is asked to open it (`hass-toggle-menu`,
  // what HA's own menu button sends), so HA keeps it open, closes it when a page is chosen, and says when it has closed;
  // our hiding is lifted while it is up. Beside the page (a wide window) the docked sidebar simply comes back, as this
  // person has it, until a page is chosen or Show Menu is used again. (First built as HK Frontend's hk-menu.js did it,
  // HA's drawer forced into its pop-over mode behind HA's back: in HA 2026.9 that pop-over is a light-dismiss dialog HA
  // knows nothing of, and it often closed again at once.)
  var lift = null;
  function shown() {
    var d = drawer(), s = sidebarEl();
    var m = main();
    if (lift || !d || !s || d.type === 'modal' || (m && m.hasAttribute(SIDEBAR))) return false;
    try { return getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().width > 0; } catch (e) { return false; }
  }
  function menu() {
    var m = main(), d = drawer();
    if (!m || !d) return;
    if (lift) { unlift(); return; }
    lift = { d: d, drawer: d.type === 'modal' };
    apply();
    if (!lift.drawer) return;
    lift.closed = function () { unlift(); };
    d.addEventListener('hass-drawer-closed', lift.closed);
    m.dispatchEvent(new CustomEvent('hass-toggle-menu', { detail: { open: true }, bubbles: true, composed: true }));
  }
  function unlift() {
    if (!lift) return;
    var l = lift;
    lift = null;
    if (l.closed) l.d.removeEventListener('hass-drawer-closed', l.closed);
    apply();
  }

  // ---- this person's HA sidebar, for the frame that spoke (its rows in the screen's menu)
  function originOf(f) {
    try { return new URL(f.getAttribute('src') || '', location.href).origin; } catch (e) { return ''; }
  }
  function tellSidebar(f) {
    var h = ha() && ha().hass, o = f && originOf(f);
    if (!h || !h.panels || !o || origins.indexOf(o) < 0 || !f.contentWindow) return;
    var panels = {};
    Object.keys(h.panels).forEach(function (k) {
      var p = h.panels[k];
      if (!p || !p.title) return;
      var t = '';
      try { t = typeof h.localize === 'function' ? h.localize('panel.' + p.title) : ''; } catch (e) { t = ''; }
      panels[k] = { title: t || p.title, icon: p.icon || null, require_admin: !!p.require_admin };
    });
    var send = function (prefs) {
      try {
        f.contentWindow.postMessage({ type: 'mantel-link/sidebar', panels: panels, admin: isAdmin(), shown: shown(),
                                      prefs: prefs ? { panelOrder: prefs.panelOrder || [], hiddenPanels: prefs.hiddenPanels || [] } : null }, o);
      } catch (e) { /* gone */ }
    };
    var c = h.connection;
    if (!c || typeof c.sendMessagePromise !== 'function') { send(null); return; }
    c.sendMessagePromise({ type: 'frontend/get_user_data', key: 'sidebar' })
      .then(function (r) { send(r && r.value); }, function () { send(null); });
  }
  // ask the frames from Mantel's addresses to say it again (they may have spoken before this listened)
  function hello() {
    frames(panel(), [], 0).forEach(function (f) {
      try {
        var o = new URL(f.getAttribute('src') || '', location.href).origin;
        if (origins.indexOf(o) >= 0 && f.contentWindow) f.contentWindow.postMessage({ type: 'mantel-link/hello' }, o);
      } catch (e) { /* not a frame of ours */ }
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'mantel' || origins.indexOf(e.origin) < 0) return;
    var f = frameOf(e.source);
    if (!f) return;
    if (d.type === 'mantel/kiosk') {
      said = { frame: f, path: location.pathname, header: !!d.header, sidebar: !!d.sidebar, admins: d.admins !== false };
      apply();
      // after HA has laid the page out without (or with) its sidebar
      setTimeout(function () { tellSidebar(f); }, 50);
    } else if (d.type === 'mantel/back') {
      back();
    } else if (d.type === 'mantel/navigate') {
      if (mayGo(d.path)) go(d.path);
    } else if (d.type === 'mantel/notifications') {
      notifications();
    } else if (d.type === 'mantel/menu') {
      menu();
    }
  });
  // a narrower or wider window: HA's sidebar beside the frame or not (the screen's Show Menu row)
  var resized = null;
  window.addEventListener('resize', function () {
    clearTimeout(resized);
    resized = setTimeout(function () { if (said && said.frame) tellSidebar(said.frame); }, 400);
  });

  var timers = [];
  function soon() {
    timers.forEach(clearTimeout);
    timers = [0, 150, 500, 1200, 3000].map(function (t) { return setTimeout(function () { apply(); hello(); }, t); });
  }
  window.addEventListener('location-changed', function () { unlift(); soon(); });
  window.addEventListener('popstate', soon);
  // HA redraws its header when the dashboard changes: keep the marks on while a screen asks
  setInterval(function () { if (said) apply(); }, 2000);

  // the addresses Mantel's screens come from (once HA's connection is up)
  var tries = 0;
  function load() {
    var h = ha() && ha().hass;
    if (!h || !h.connection) { if (tries++ < 120) setTimeout(load, 500); return; }
    h.connection.sendMessagePromise({ type: 'mantel/frontend/config' }).then(function (c) {
      origins = (c && Array.isArray(c.origins)) ? c.origins.filter(function (o) { return typeof o === 'string'; }) : [];
      soon();
    }, function () { /* Mantel Link not set up: nothing to believe */ });
  }
  load();

  // for tests
  window.__mantelLink._ = { apply: apply, back: back, frames: frames, frameOf: frameOf, mayGo: mayGo, menu: menu, lift: function () { return lift; },
                            setOrigins: function (o) { origins = o.slice(); }, said: function () { return said; } };
})();
