// @ts-check
// An Apple HomeView's page, laid out wider and kept clear of Safari's buttons (2026-11-23).
//
// THE APPLE HOMEVIEW: Apple's 7-inch square home display, whose Safari is the only way a web page gets on it.
// Its Safari says it is an iPhone ("iPhone; CPU iPhone OS 18_6 ... Version/27.2 Mobile") on a 544 x 544 screen. No
// iPhone is square, so a square screen with an iPhone's user agent is a HomeView. Left alone, Mantel lays it out as a
// phone at a phone's size (under 640 px: hk-base-menu.js menuNarrow): a Square Home Grid fits itself to the window and
// comes out about three quarters of that size, so every sheet it opens, drawn at full size, looked half again too big
// beside it (the owner, the Kitchen's HomeView: "the pop up for the Home is really large ... hard to look at").
//
// So the page is laid out WIDER and Safari scales it down to the screen, as it does any page that asks (the meta
// viewport, which a phone's Safari honors -- not a computer's: tesla-viewport.js zooms instead): LAYOUT px across, so
// the grid, its sheets and their text all come out at one scale, and the page is an upright iPad's width, not a
// phone's. And Safari's buttons float over the page's top edge (back, the address, the time), so the page keeps
// TOP px clear there, through --hk-safe-top (hk-base.js SAFE: the sheets, the tab bar, the menu) and --hk-view-top
// (home.html's view container, and the Home Grid's height: hk-layout-home-grid.js). Nothing changes anywhere else:
// both are unset off a HomeView.
//
// A classic script in <head> (no inline script: the page's CSP is script-src 'self'), run before anything is laid out,
// so the first layout is already the wide one. html[hk-homeview] marks the page for anything else that needs to know.
//
// THE DISPLAY'S CORNERS (the owner's photo, 2026-11-23: "the bottom corner radius isn't right"): the screen's bottom
// corners are rounded CORNER pt, the page's own bottom corners. A Square Home Grid on it sits on the bottom edge and
// rounds its bottom corner blocks to follow them (hk-layout-grid.js cellRadius, hk-layout-home-grid.js _measure); its
// top corners are under Safari's bar, not the display's, so they keep a block's own radius. window.hkHomeView says so.
(function () {
  var LAYOUT = 720;   // the page's width in CSS px (544 px of screen: 0.76 of it, about the Square grid's own fit)
  var TOP = 24;       // clear of Safari's floating buttons, in the page's px (measured off the owner's photos: ~15 of 544)
  var CORNER = 70;    // the display's corner radius in pt of its 544 (measured off the owner's photo)
  var s = window.screen, ua = navigator.userAgent || '';
  if (!(s && /\biPhone\b/.test(ua) && s.width > 0 && s.width === s.height)) return;
  var root = document.documentElement;
  root.setAttribute('hk-homeview', '');
  window.hkHomeView = { layout: LAYOUT, top: TOP, corner: CORNER * LAYOUT / s.width };   // (the corner in the page's px)
  root.style.setProperty('--hk-safe-top', 'max(env(safe-area-inset-top, 0px), ' + TOP + 'px)');
  root.style.setProperty('--hk-view-top', 'var(--hk-safe-top)');
  var m = document.querySelector('meta[name="viewport"]');
  if (m) m.setAttribute('content', 'width=' + LAYOUT + ', user-scalable=no, viewport-fit=cover');
})();
