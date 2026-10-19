// mantel-link.js -- Mantel Link on Home Assistant's own pages (docs/phase9/MANTEL-LINK.md 9.6).
//
// A Mantel screen shown in HA is a Webpage dashboard framing Mantel's address. The screen (Mantel's
// web/shim/ha-frame.js) tells the page around it:
//   {source: 'mantel', type: 'mantel/kiosk', header, sidebar, admins}   its "Home Assistant Header & Sidebar"
//   {source: 'mantel', type: 'mantel/back'}                             its menu's Home Assistant row
// and this script answers by hiding HA's header and sidebar around that frame (as HK Frontend's hk-kiosk.js did:
// one stylesheet in each of three shadow roots, applied only while an attribute of ours is on the element, so
// leaving the screen puts everything back at once), or by going to HA's own start page.
//
// WHO IS BELIEVED: a message from one of Mantel's own addresses (Mantel Link's `mantel/frontend/config`, from
// the link's hello) AND from an iframe on the dashboard shown right now. Nothing else; and a message can only
// hide the chrome around its own frame or go to "/". `admins: false` leaves an admin's header and sidebar.
(function () {
  'use strict';
  if (window.__mantelLink) return;
  window.__mantelLink = { version: '1' };

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
    mark(main(), SIDEBAR, !!(w && w.sidebar), CSS.main);
    mark(drawer(), SIDEBAR, !!(w && w.sidebar), CSS.drawer);
    mark(root(), HEADER, !!(w && w.header), CSS.root);
    return w;
  }
  function back() {
    said = null;
    apply();
    history.pushState(null, '', '/');
    window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
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
    } else if (d.type === 'mantel/back') {
      back();
    }
  });

  var timers = [];
  function soon() {
    timers.forEach(clearTimeout);
    timers = [0, 150, 500, 1200, 3000].map(function (t) { return setTimeout(function () { apply(); hello(); }, t); });
  }
  window.addEventListener('location-changed', soon);
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
  window.__mantelLink._ = { apply: apply, back: back, frames: frames, frameOf: frameOf,
                            setOrigins: function (o) { origins = o.slice(); }, said: function () { return said; } };
})();
