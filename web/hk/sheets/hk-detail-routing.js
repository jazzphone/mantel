// hk-detail-routing.js - whose taps and pop-ups these sheets answer: the dashboard test, sources and the route.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-detail-routing'] = function (K) {
    var C = K.C, dashNow = K.dashNow, openPopup = K.openPopup;

    // ------------------------------------------------------------ interception
    // HA's own surfaces, anywhere in the event's path. Checked over the WHOLE
    // path before anything is taken: an hk card inside HA's card-editor
    // preview (an HA dialog) is still an HK- element, and a first-match
    // walk would take it before it ever reached the dialog.
    var HA_OWN = { 'HA-PANEL-CONFIG': 1, 'HA-DIALOG': 1, 'HA-MD-DIALOG': 1, 'HA-WA-DIALOG': 1,
                   'HA-ADAPTIVE-DIALOG': 1, 'HA-MORE-INFO-DIALOG': 1 };
    function fromDashboard(e) {
      var path = e.composedPath ? e.composedPath() : [], mine = false;
      for (var i = 0; i < path.length; i++) {
        var t = path[i] && path[i].tagName;
        if (!t) continue;
        if (HA_OWN[t]) return false;
        if (window.hkShell.is(path[i], 'panel') || t.indexOf('HK-') === 0) mine = true;
      }
      return mine;
    }
    // THE CARD THAT ASKED, for its name, glyph, colour and any confirmation:
    // the sheet should look like the pill it came from. Only a card whose own
    // entity is the one asked about: the first hk card in the path can be a
    // container (a row, a grid) or a card showing something else, and its
    // name would then label the wrong sheet. None: {} -- the entity's own name.
    function sourceOf(e, id) {
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var el = path[i];
        if (!el || !el._config || !el.tagName || el.tagName.indexOf('HK-') !== 0) continue;
        var c = el._config;
        if (c.entity !== id) continue;
        var conf = (c.icon_tap_action && c.icon_tap_action.confirmation) ||
                   (c.tap_action && c.tap_action.confirmation) || null;
        var out = { name: c.name, icon: c.icon, icon_color: c.icon_color, confirmation: conf,
                    type: el.tagName.toLowerCase(), config: c };
        // the tile itself, for Arrange (accessoryPane): hidden from any copy
        Object.defineProperty(out, 'el', { value: el, enumerable: false });
        return out;
      }
      return {};
    }
    // OFF: the Configure menu's detail sheets switch (look.details),
    // a card's own `detail: false`, or localStorage hk-detail-off=1 on one screen.
    function disabled(src) {
      if (C.setting && C.setting('look.details', true) === false) return true;
      try { if (localStorage.getItem('hk-detail-off') === '1') return true; } catch (e) { /* none */ }
      return !!(src && src.config && src.config.detail === false);
    }

    // ================================================================ POP-UPS
    // THE HOME'S POP-UPS (Pop-ups in HK Settings): a hash
    // on any dashboard's address -- `#doorbell` -- opens its sheet, which is
    // how an automation that loads `<dashboard>/0#doorbell` on a tablet shows
    // it. A YAML hk-popup-card on the page that claims the same hash wins (it
    // is mounted by then: the look waits GRACE_MS for a page's cards). And
    // hk_frontend.show_popup (the settings module's events) sets the hash on
    // the screens it asks.
    var POPUP_GRACE_MS = 700;
    function popupsNow() {
      var HS = window.hkSettings;
      return (HS && HS.get('popups', null)) || [];
    }
    function popupFor(hash) {
      var dash = dashNow();
      var name = String(hash || '').replace(/^#/, '');
      // this dashboard's gear -> Screen -> Answer pop-ups
      var b = C.menu && typeof C.menu.board === 'function' ? C.menu.board() : null;
      if (b && b.popups === false) return null;
      return popupsNow().filter(function (p) {
        return p && p.hash === name && (!p.dashboards || !p.dashboards.length || p.dashboards.indexOf(dash) >= 0);
      })[0] || null;
    }
    // does a pop-up item answer this hash on this dashboard? (hk-popup.js asks,
    // so the now-playing bar never takes the hash from one)
    function answers(hash) { return !!popupFor(hash); }
    function yamlClaims(hash) {
      var P = window.hkPopup;
      return !!(P && typeof P.hashes === 'function' && P.hashes().indexOf(hash) >= 0);
    }
    // ONLY ON A DASHBOARD: a show_popup, or a #hash, on one of Home
    // Assistant's own pages (Settings, the map) must not open the sheet
    // over it. The host shell knows (in HA: the address's panel is a
    // lovelace one; not up yet is not a dashboard).
    function onDashboard() {
      return window.hkShell.isDashboard() === true;
    }
    var routeT = null;
    function route() {
      clearTimeout(routeT);
      var hash = location.hash;
      if (!hash || hash.length < 2 || !onDashboard() || !popupFor(hash)) return;
      routeT = setTimeout(function () { if (location.hash === hash) openPopup(hash); }, POPUP_GRACE_MS);
    }

    // what the shell and the later parts use of this one
    K.answers = answers; K.disabled = disabled; K.fromDashboard = fromDashboard; K.onDashboard = onDashboard;
    K.popupFor = popupFor; K.route = route; K.sourceOf = sourceOf; K.yamlClaims = yamlClaims;
  };
})();
