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
      viewContainer: 'hui-view-container', view: 'hui-view', viewBackground: 'hui-view-background'
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
    // keep the websocket while the page is hidden (a wall tablet)
    keepAwake: function (root) {
      var r = root || HA.root();
      if (r) r.dispatchEvent(new global.CustomEvent('hass-suspend-when-hidden', { detail: { suspend: false } }));
    }
  };

  global.hkShell.use(HA);
  global.hkHAShell = HA;
})(globalThis);
