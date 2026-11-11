// hk-settings-module-tablet.js - which wall tablet this page is: remembered in the browser, named by the client.
//
// PART OF THE HK SETTINGS MODULE (window.hkSettings) (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsModuleParts = window.hkSettingsModuleParts || {})['hk-settings-module-tablet'] = function (K) {
    // IS THIS PAGE A LOVELACE PANEL? Read off the host's panel list (the shell
    // answers) -- a property, not a walk of the document. null while the host
    // is not up yet (treat as "maybe"),
    // else true/false. The sky, the view fade, the icon repair and the camera
    // poster ask this rather than walk every shadow root on the page, which
    // would cost as much on Settings and Logs as on a dashboard.
    function lovelacePanel() { return window.hkShell.isDashboard(); }

    // WHICH WALL TABLET THIS IS (1.14, docs/Wall-Tablets.md). A tablet is
    // its own item, apart from the screen it runs, so the page needs to know
    // which one it is:
    //   1. ?hk_tablet=<id> in its address (the kiosk app's start URL),
    //      remembered here once seen -- Home Assistant's navigation drops the
    //      query, and a kiosk's reload may be of another page. ?hk_tablet=none
    //      forgets it: this browser is no tablet.
    //   2. Else the tablet signed in as this user (the one on this screen
    //      first).
    //   3. Else none: a desk, a phone -- no screensaver, no idle return.
    // A server from before 1.14 sends no tablets: the screen's Tablet User,
    // as it was. The answer: {id, name, screen, room, user, app, idle_return,
    // idle_time, black_screen, screensaver_switch, black_switch} or null.
    var TABLET_KEY = 'hk-tablet';
    function rememberTablet() {
      try {
        var m = /[?&]hk_tablet=([a-z0-9_]+)/.exec(String(location.search || ''));
        if (!m) return;
        if (m[1] === 'none') localStorage.removeItem(TABLET_KEY);
        else localStorage.setItem(TABLET_KEY, m[1]);
      } catch (e) { /* no storage (a private window, a test harness) */ }
    }
    function rememberedTablet() {
      try { return localStorage.getItem(TABLET_KEY) || ''; } catch (e) { return ''; }
    }
    function userName(client) {
      try {
        var HC = window.hkHostClient;
        var h = client || (HC && HC.current ? HC.current() : null);
        return (h && h.user && h.user.name) || '';
      } catch (e) { return ''; }
    }
    function tabletOf(id, t) {
      var out = { id: id };
      Object.keys(t).forEach(function (k) { out[k] = t[k]; });
      return out;
    }

    // what the shell and the later parts use of this one
    K.lovelacePanel = lovelacePanel; K.rememberedTablet = rememberedTablet; K.rememberTablet = rememberTablet;
    K.tabletOf = tabletOf; K.userName = userName;
  };
})();
