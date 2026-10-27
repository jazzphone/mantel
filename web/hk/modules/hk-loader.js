// hk-loader.js - imports the order-independent dashboard modules (MODULES
// below: kiosk, stats, charts, sky, idle, glass, skyshot, timers, saver,
// saver-panel, campost, menu, tabbar, notify, edit, edit-pages, drag).
//
// WHY THIS EXISTS
// The bootstrap list -- the files every page loads before any card renders --
// is registered by custom_components/hk_frontend/__init__.py
// (add_extra_js_url), and changing THAT LIST needs a Home Assistant restart.
// This file is one entry in it, and adding a module HERE is live on the next
// page load: /hk/ is served with Cache-Control: no-cache, so every file
// revalidates (ETag -> 304) and an edit to any of them is live on a refresh.
//
// WHAT BELONGS IN HERE: modules that do nothing at load time except assign a
// window global (window.hkSky, window.hkStats, ...), which cards read lazily
// while rendering -- so the imports can run in parallel, in any order.
//
// WHAT DOES NOT: the other bootstrap entries in __init__.py, which must run
// BEFORE the first card renders --
//   hk-settings.js    the dashboard settings every page reads at first paint;
//   hk-icons.js       registers the hk: iconset (ha-icon caches a miss for the
//                     life of the page, so it cannot be late);
//   tesla-viewport.js pins the layout width in a car browser (late = a reflow);
//   hk-tap.js         registers --hk-ring as an <angle> before the first tap;
//   hk-header.js      the header builders, painted first.
//
// Before adding a module here, check it has nothing to do before first render.
(function () {
  'use strict';

  var MODULES = [// Hides Home Assistant's header and sidebar on a screen that
                 // asks (hk-kiosk.js): first, so a kiosk screen shows them
                 // for as short a time as possible.
                 'hk-kiosk.js',
                 'hk-stats.js', 'hk-charts.js', 'hk-flat-image.js', 'hk-sky.js', 'hk-idle.js',
                 // The sky as a picture, for the Pre-rendered blur (it only
                 // assigns window.hkSkyShot; hk-glass.js asks it when it paints)
                 'hk-skyshot.js',
                 // The shared blur layer (look.glass = blur). Cards join it
                 // from HkBase whichever of the two loads first.
                 'hk-glass.js',
                 // Frosted's Tint from Background: after hk-sky, whose
                 // colors it reads (it finds the sky element itself)
                 'hk-frosttint.js',
                 // The timer countdowns. They appear inside both
                 // hk-timer-strip-card and hk-timers-card, so the module
                 // belongs here rather than being loaded by one card.
                 'hk-timers.js',
                 // The photo screensaver for a wall tablet's own user
                 // (hk-saver.js). Nothing at all on a screen without one.
                 'hk-saver.js',
                 // ...its music's Speakers / Volume / Browse panel
                 // (hk-saver-panel.js), drawn only when one is opened.
                 'hk-saver-panel.js',
                 // Hands the cameras page the strip's cached thumbnail as its
                 // video poster. Measured: HA's own poster loses the race to
                 // the live stream on most cameras, so the page is dark from
                 // 425ms until the stream starts.
                 'hk-campost.js',
                 // The menu of pages and rooms (Configure -> Menu and room
                 // pages). Draws nothing on a dashboard without it; nothing to
                 // do before first paint, so it waits for the cards.
                 'hk-menu.js',
                 // The tab bar (a screen's Tab Bar, docs/Tab-Bar.md): reads
                 // the menu's list, so it waits for hk-menu.js itself.
                 // Nothing on a screen without it.
                 'hk-tabbar.js',
                 // Notifications' banners (Features -> Notifications): a
                 // listener until the first one comes.
                 'hk-notify.js',
                 // Edit mode (arranging a page in place) and the press
                 // classifier its drags share with Home Grid's editor: each
                 // only assigns its global (hkEdit, hkDrag) until asked.
                 // hk-edit-pages.js: its category pages, Favorites and
                 // scenes rows (it registers them once hkEdit is there).
                 'hk-edit.js', 'hk-edit-pages.js',
                 // ...Edit mode's menu, tab bar and Room Order (phase G):
                 // registers with hkEdit once both are in
                 'hk-edit-menu.js',
                 'hk-drag.js'];

  // NO GRID-LAYOUT PATCH MODULE. An inline box containing block content makes
  // every section creep 6px per tap in Safari; hk-grid-card and hk-grid-view
  // declare `display: block` themselves, so that shape cannot occur and there
  // is nothing for a module to adopt into layout-card's shadow root. A patch
  // module whose ramp only settles once it has patched something would also
  // spin through every tick on every navigation, finding nothing.

  function load(stamp) {
    return Promise.all(MODULES.map(function (m) {
      // Import order is not significant: hk-charts.js reaches for
      // window.hkStats only when a card calls it, never at load time. So these
      // go in parallel.
      //
      // `stamp` is only used by hkReload() below. A normal page load passes
      // nothing, so the URL is stable and the browser can serve the module
      // from cache after a 304 -- which is the whole point of /hk/.
      var url = '/hk/modules/' + m + (stamp ? '?t=' + stamp : '');
      // A FAILED IMPORT IS SAID, AND NEVER BLOCKS THE OTHERS. There is no
      // <script> retry any more (2026-09-28): every browser these screens run
      // (Android WebView, iOS Safari, the car's Chromium) has import(), so a
      // failure is either the network -- a script tag fails the same way -- or
      // a module that THREW while running, which a second run would repeat
      // with whatever it had already registered (hk-sky adds a listener before
      // it sets window.hkSky) registered twice.
      return import(url).catch(function (err) {
        console.error('[hk-loader] could not load ' + url, err);
      });
    }));
  }

  // Exposed for the browser console during development: hkReload() re-imports
  // every module with a fresh stamp, so an edit can be picked up without even
  // a page refresh. The stamp is needed HERE and only here -- a module already
  // evaluated in this document is not re-executed for the same URL, 304 or
  // not. Only hk-stats and hk-charts replace their globals; the others guard
  // on `if (window.hkX) return` and need a page reload.
  window.hkReload = function () { return load(Date.now()); };

  load(null);

  // -------------------------------------------------------------- ?skylab
  // SKY LAB on a real dashboard: /<dashboard>?skylab. Only the flag's
  // presence is read, never a value. The module covers the page and locks its
  // connection down before it shows anything (hk-skylab.js).
  if (/[?&]skylab(=|&|$)/.test(location.search)) {
    import('/hk/modules/hk-skylab.js?t=' + Date.now()).catch(function (err) {
      console.error('[hk-loader] could not load Sky Lab', err);
    });
  }

  // ------------------------------------------------------------ ?hkprobe=1
  // The layout probe, loaded ONLY when the URL asks for it, so it costs a
  // normal page load nothing -- not a request, not a byte.
  //
  // WHY IT IS HERE AND NOT PASTED INTO A CONSOLE. Some layout bugs reproduce
  // only in one browser on one machine (Safari on a Mac, say). Driving that
  // browser's inspector remotely is rarely possible, and pasting a script by
  // hand is its own failure mode. A URL is the one instruction that survives
  // being handed over: open the page with ?hkprobe=1, touch the thing, read
  // the panel, press the button.
  try {
    // ?hkprobe=1 is the layout probe; ?hkprobe=<name> loads
    // /hk/pages/dev/<name>.js instead (letters, digits and dashes only), so a
    // new probe needs a file, not another branch here.
    var pm = /[?&]hkprobe=([^&#]*)/.exec(location.search);
    if (pm) {
      var pn = /^[a-z0-9-]+$/i.test(pm[1]) && pm[1] !== '1' ? pm[1] : 'hk-probe';
      var pu = '/hk/pages/dev/' + pn + '.js?t=' + Date.now();
      import(pu)
        .catch(function () {
          var sc = document.createElement('script');
          sc.src = pu;
          document.head.appendChild(sc);
        });
    }
  } catch (e) { /* a probe must never break a page load */ }
})();
