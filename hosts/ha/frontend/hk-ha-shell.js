// Home Assistant's host shell (see web/client/hk-host-shell.js): the only
// frontend file that knows HA's own element names, its shadow-root path to the
// dashboard and its frontend events. Every lookup is made on each call, by the
// same path the modules used to walk themselves:
//
//   <home-assistant> #shadow > <home-assistant-main> #shadow >
//     <ha-drawer>, <ha-sidebar>, <partial-panel-resolver> > <ha-panel-lovelace>
//       #shadow > <hui-root> #shadow > <hui-view-container id="view"> >
//         <hui-view-background>, <hui-view>
(function (global) {
  'use strict';
  if (!global.hkShell) throw new Error('hk-host-shell.js has not loaded');
  if (global.hkShell.kind === 'ha') return;

  function doc() { return global.document; }
  function sr(el) { return (el && el.shadowRoot) || null; }

  var HA = {
    kind: 'ha',
    events: { navigate: 'location-changed', moreInfo: 'hass-more-info', toast: 'hass-notification' },
    tags: {
      root: 'home-assistant', main: 'home-assistant-main', drawer: 'ha-drawer', sidebar: 'ha-sidebar',
      resolver: 'partial-panel-resolver', panel: 'ha-panel-lovelace', dashboard: 'hui-root',
      viewContainer: 'hui-view-container', view: 'hui-view', viewBackground: 'hui-view-background',
      // Lovelace's card wrapper: lazy loading, the error card, ll-rebuild
      card: 'hui-card'
    },
    viewTags: ['hui-view', 'hui-masonry-view', 'hui-sections-view', 'hui-panel-view'],
    foreignTags: ['hui-view', 'hui-sections-view', 'hui-masonry-view', 'hui-panel-view', 'hui-sidebar-view',
                  'hui-card-preview', 'hui-card-picker', 'hui-dialog-edit-card', 'ha-panel-lovelace'],
    root: function () {
      var d = doc();
      return (d && typeof d.querySelector === 'function' && d.querySelector('home-assistant')) || null;
    },
    overlayRoot: function () { return sr(HA.root()); },
    main: function () {
      var r = sr(HA.root());
      return (r && r.querySelector('home-assistant-main')) || null;
    },
    mainRoot: function () { return sr(HA.main()); },
    drawer: function () { var m = HA.mainRoot(); return (m && m.querySelector('ha-drawer')) || null; },
    sidebar: function () { var m = HA.mainRoot(); return (m && m.querySelector('ha-sidebar')) || null; },
    resolver: function () { var m = HA.mainRoot(); return (m && m.querySelector('partial-panel-resolver')) || null; },
    // The dashboard panel: in main's shadow root, or under the resolver
    panel: function () {
      var m = HA.mainRoot();
      if (!m) return null;
      var p = m.querySelector('ha-panel-lovelace');
      if (!p) { var r = m.querySelector('partial-panel-resolver'); p = r && r.querySelector('ha-panel-lovelace'); }
      return p || null;
    },
    dashboard: function (panel) {
      var p = panel === undefined ? HA.panel() : panel, r = sr(p);
      return (r && r.querySelector('hui-root')) || null;
    },
    dashboardRoot: function (panel) { return sr(HA.dashboard(panel)); },
    // <hui-view-container>, asked for by name or (viewSlot) by its id
    viewContainer: function (panel) {
      var r = HA.dashboardRoot(panel);
      return (r && r.querySelector('hui-view-container')) || null;
    },
    viewSlot: function (panel) {
      var r = HA.dashboardRoot(panel);
      return (r && r.querySelector('#view')) || null;
    },
    view: function (container) {
      var c = container === undefined ? HA.viewSlot() : container;
      return (c && c.querySelector('hui-view')) || null;
    },
    viewBackground: function (container) {
      var c = container === undefined ? HA.viewContainer() : container;
      return (c && c.querySelector('hui-view-background')) || null;
    },
    // the dashboard's toolbar (hidden by kiosk mode)
    toolbar: function (panel) {
      var r = HA.dashboardRoot(panel);
      return (r && r.querySelector('.header')) || null;
    },
    dashboardConfig: function (panel) {
      var p = panel === undefined ? HA.panel() : panel;
      return (p && p.lovelace && p.lovelace.config) || null;
    },
    onDashboard: function () {
      var el = HA.root(), h = el && el.hass;
      var p = h && h.panels && h.panelUrl ? h.panels[h.panelUrl] : null;
      return !p || p.component_name === 'lovelace';
    },
    // by the address's first segment, read off hass.panels (null: not up yet)
    isDashboard: function () {
      var ha = HA.root();
      var panels = ha && ha.hass && ha.hass.panels;
      if (!panels) return null;
      var seg = global.location.pathname.split('/')[1] || 'lovelace';
      var p = panels[seg];
      return !!(p && p.component_name === 'lovelace');
    },
    defined: function () {
      var ce = global.customElements;
      return !!(ce && ce.get('home-assistant'));
    },
    showNotifications: function () {
      var m = HA.main();
      if (m) m.dispatchEvent(new global.CustomEvent('hass-show-notifications', { bubbles: true, composed: true }));
    },
    // keep the websocket while the page is hidden (a wall tablet); nothing to
    // ask when the frontend already keeps it (its own suspendWhenHidden flag)
    keepAwake: function (root) {
      var r = root || HA.root();
      if (r && (r.hass || {}).suspendWhenHidden === false) return;
      if (r) r.dispatchEvent(new global.CustomEvent('hass-suspend-when-hidden', { detail: { suspend: false } }));
    }
  };

  // THE WALL TABLET'S ROOM (a Home Grid's `tablet_room`): the room of its
  // Wall Tablets entry -- which tablet this page is, hk-settings.js tablet()
  // decides (its ?hk_tablet= address, else the tablet signed in as this user)
  HA.tabletRoom = function (client) {
    var S = global.hkSettings, t = S && typeof S.tablet === 'function' ? S.tablet(client) : null;
    return (t && typeof t.room === 'string' && t.room) || null;
  };

  // the frontend's sidebar data: the user, the panels, and their titles
  HA.sidebarData = function () {
    var r = HA.root(), h = r && r.hass;
    if (!h) return null;
    return { user: h.user, panels: h.panels,
             localize: typeof h.localize === 'function' ? function (k) { return h.localize(k); } : null };
  };

  // the sky lab's preview: the frontend's own socket stops sending writes
  HA.holdWrites = function (isWrite, onHeld) {
    var r = HA.root(), conn = r && r.hass && r.hass.connection;
    if (!conn) return false;
    var send = conn.sendMessage.bind(conn), sendP = conn.sendMessagePromise.bind(conn);
    conn.sendMessage = function (msg, id) {
      if (msg && isWrite(msg)) { onHeld(msg); return; }
      return send(msg, id);
    };
    conn.sendMessagePromise = function (msg) {
      if (msg && isWrite(msg)) { onHeld(msg); return Promise.resolve(null); }
      return sendP(msg);
    };
    return true;
  };

  // the sidebar's own toggle on a narrow window: <ha-menu-button>, handed the
  // frontend's object for the client (the HA adapter's bridge) and `narrow`
  HA.menuButton = function (el, opts) {
    var o = opts || {}, ce = global.customElements;
    if (!el && !(ce && ce.get('ha-menu-button'))) return null;
    var b = el || doc().createElement('ha-menu-button');
    if (o.client && global.hkHAClient) global.hkHAClient.bridge(b, o.client);
    if (Object.prototype.hasOwnProperty.call(o, 'narrow')) b.narrow = o.narrow;
    return b;
  };

  // THE HOST'S OWN DETAIL AND TOASTS (Phase 2 P2.5, docs/phase2/SHEETS.md). HA has a detail
  // dialog for every entity (more-info), so what HK has no sheet of its own for keeps going
  // there, exactly as before: hk-detail.js lets the more-info event through untouched. Asked
  // for directly (the generic sheet's "Open in Home Assistant"), it is the same event from
  // <home-assistant>, which HK's own listener never takes (it is not from a dashboard).
  HA.hostDetail = function () { return true; };
  HA.openHostDetail = function (entityId) {
    var r = HA.root();
    if (!r || !entityId) return false;
    r.dispatchEvent(new global.CustomEvent('hass-more-info', { bubbles: true, composed: true, detail: { entityId: entityId } }));
    return true;
  };
  // HA draws hass-notification itself (its own snackbar): HK's toast layer stays out
  HA.hostToast = function () { return true; };
  // HK's confirm and choose sheets mount where they always have: the document's body, above
  // HA's page and outside its shadow root (not HA's overlay root, where HA's own dialogs are)
  HA.dialogRoot = function () { var d = doc(); return (d && d.body) || null; };

  // TWO MODES. "lovelace" (the default, and the only one unless HK's own panel is switched
  // on): every answer above, by Lovelace's path. "panel" (Phase 2 P2.6, hk_panel.py): HK's
  // own panel is on screen, drawn by HK's view host with no Lovelace. Then the dashboard's
  // parts are the panel's own -- the panel element HA made, the view container and the view
  // in it, the config the view host draws -- and there is no hui-root, no toolbar, no view
  // background and no card wrapper (tags.card null: hkCards.createCard makes children with
  // the view host's factory). The rest stays HA's: the root and the overlay root the menu,
  // tab bar and sheets mount in, the drawer and sidebar, the events.
  var own = null;

  function panelImpl() {
    var o = own, parts = o.host.shellParts(), ptags = parts.tags || {};
    var impl = Object.assign({}, HA, {
      tags: Object.assign({}, HA.tags, {
        panel: o.el.localName || null, dashboard: null, viewBackground: null, card: null,
        viewContainer: ptags.viewContainer || null, view: ptags.view || null
      }),
      panel: function () { return o.el; },
      dashboard: function () { return null; },
      dashboardRoot: function () { return null; },
      viewContainer: function () { return parts.viewContainer(); },
      viewSlot: function () { return parts.viewSlot(); },
      view: function (c) { return parts.view(c); },
      viewBackground: function () { return null; },
      toolbar: function () { return null; },
      dashboardConfig: function () { return parts.dashboardConfig(); },
      // HK's panel is a dashboard; anywhere else, as HA says
      onDashboard: function () {
        var r = HA.root(), h = r && r.hass;
        if (h && o.url && h.panelUrl === o.url) return true;
        return HA.onDashboard();
      },
      isDashboard: function () {
        var seg = global.location.pathname.split('/')[1] || '';
        if (o.url && seg === o.url) return true;
        return HA.isDashboard();
      }
    });
    return impl;
  }

  // The panel element (hk-ha-panel.js) on screen: `el` the panel, `viewHost` HK's view host
  // drawing in it, `url` the panel's address (its first segment). Answers again on every
  // view (the view's element name changes), as Mantel's shell does.
  HA.ownPanel = function (el, viewHost, url) {
    if (own && own.off) own.off();
    var o = own = { el: el, host: viewHost, url: url || null, off: null };
    var use = function () { if (own === o) global.hkShell.use(panelImpl()); };
    o.off = viewHost.onView(use);
    use();
    return global.hkShell;
  };
  // The panel left the page (or was never there): Lovelace's answers again. `el`: only if
  // that panel is the one in charge.
  HA.lovelace = function (el) {
    var was = own;
    if (!was || (el && was.el !== el)) return global.hkShell;
    if (was.off) was.off();
    own = null;
    global.hkShell.use(HA);
    return global.hkShell;
  };
  HA.currentMode = function () { return own ? 'panel' : 'lovelace'; };

  global.hkShell.use(HA);
  global.hkHAShell = HA;
})(globalThis);
