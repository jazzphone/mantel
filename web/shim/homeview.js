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
//
// THE APP'S CAR SCREEN (mantel-ios CarScreen.swift, 2026-11-23): the iOS app may draw this page on a CarPlay window --
// a HomeView shows the paired iPhone's CarPlay apps -- and says the window's size first (window.mantelCarScreen; the
// web view's own screen is the phone's). A square one is a HomeView, laid out the same, with no Safari to keep clear of.
(function () {
  var LAYOUT = 720;   // the page's width in CSS px (544 px of screen: 0.76 of it, about the Square grid's own fit)
  var TOP = 24;       // clear of Safari's floating buttons, in the page's px (measured off the owner's photos: ~15 of 544)
  var CORNER = 70;    // the display's corner radius in pt of its 544 (measured off the owner's photo)
  var s = window.screen, ua = navigator.userAgent || '', car = window.mantelCarScreen;
  var width = car ? car.width : s && s.width, height = car ? car.height : s && s.height;
  if (car) {
    if (!(width > 0 && Math.abs(width - height) <= width * 0.02)) return;
    TOP = 0;
  } else if (!(s && /\biPhone\b/.test(ua) && width > 0 && width === height)) return;
  var root = document.documentElement;
  root.setAttribute('hk-homeview', '');
  window.hkHomeView = { layout: LAYOUT, top: TOP, corner: CORNER * LAYOUT / width };   // (the corner in the page's px)
  root.style.setProperty('--hk-safe-top', 'max(env(safe-area-inset-top, 0px), ' + TOP + 'px)');
  root.style.setProperty('--hk-view-top', 'var(--hk-safe-top)');
  var m = document.querySelector('meta[name="viewport"]');
  if (m) m.setAttribute('content', 'width=' + LAYOUT + ', user-scalable=no, viewport-fit=cover');
  if (car) return;

  // SAFARI'S BARS IN THE SKY'S COLOR (2026-11-24, the owner: "the address bar in safari isn't color matching"). Safari 26
  // no longer reads theme-color: it tints its bars from the page's background color, or from a fixed element along the
  // top edge -- here the sky (hk-sky.js #hk-sky), whose own color is its palette's middle and the page's a near black, so
  // the bar was a dark block over a light sky. On a HomeView all three are the sky's top stop (--sk0, a wallpaper's too),
  // set again only when it moves (hk-sky-paint: the sun's colors, a page's own sky).
  /** @type {HTMLElement | null} */
  var sky = null;
  var was = '';
  /** @param {Document | ShadowRoot} r @param {number} d */
  function find(r, d) {
    if (sky || d > 40) return;
    var all = r.querySelectorAll('*');
    for (var i = 0; i < all.length && !sky; i++) {
      var el = /** @type {HTMLElement} */ (all[i]);
      if (el.id === 'hk-sky') sky = el;
      else if (el.shadowRoot) find(el.shadowRoot, d + 1);
    }
  }
  /** @type {Record<string, number[] | null>} */
  var tops = {};
  /** The mean color of a photo's top edge as the sky shows it (background-size cover, centered, on this window), once
   *  per photo; null when it can't be read (another origin's picture taints the canvas).
   *  @param {string} url @param {(c: number[] | null) => void} done */
  function photoTop(url, done) {
    if (url in tops) { done(tops[url]); return; }
    var img = new Image();
    img.onload = function () {
      var c = null;
      try {
        var W = window.innerWidth, H = window.innerHeight, k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        var sh = H / k, sy = Math.max(0, (img.naturalHeight - sh) / 2), sw = W / k, sx = Math.max(0, (img.naturalWidth - sw) / 2);
        var cv = document.createElement('canvas');
        cv.width = 16; cv.height = 2;
        var g = cv.getContext('2d');
        if (g) {
          g.drawImage(img, sx, sy, sw, sh * 0.06, 0, 0, 16, 2);       // the top 6 % of what shows
          var px = g.getImageData(0, 0, 16, 2).data, sum = [0, 0, 0];
          for (var i = 0; i < px.length; i += 4) { sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2]; }
          c = sum.map(function (v) { return v / (px.length / 4); });
        }
      } catch (e) { c = null; }
      tops[url] = c;
      done(c);
    };
    img.onerror = function () { tops[url] = null; done(null); };
    img.src = url;
  }
  /** @param {string} s */
  function rgbOf(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s);
    return m ? m[1].split(',').slice(0, 3).map(function (v) { return parseFloat(v); }) : null;
  }
  function tint() {
    if (!sky || !sky.isConnected) { sky = null; find(document, 0); }
    if (!sky) return;
    var cs = getComputedStyle(sky), sk0 = cs.getPropertyValue('--sk0').trim(), o = parseFloat(cs.getPropertyValue('--artO')) || 0;
    // a photo or album art over the palette: its top edge, at its share over the palette's top stop
    var art = o > 0 ? sky.querySelector('.art') : null;
    var u = art ? /url\(["']?([^"')]+)/.exec(getComputedStyle(art).backgroundImage) : null;
    if (u && art) {
      // (a photo is drawn darker for the words over it: its filter's brightness, hk-sky.js --phF)
      var dim = /brightness\(([\d.]+)\)/.exec(getComputedStyle(art).filter), k = dim ? parseFloat(dim[1]) : 1;
      photoTop(u[1], function (top) {
        var base = rgbOf(sk0);
        if (!top || !base) { paint(sk0); return; }
        var t = /** @type {number[]} */ (top), b = /** @type {number[]} */ (base);
        paint('rgb(' + t.map(function (v, i) { return Math.round(Math.min(255, v * k) * o + b[i] * (1 - o)); }).join(', ') + ')');
      });
      return;
    }
    paint(sk0);
  }
  /** @param {string} c */
  function paint(c) {
    if (!sky || !c || c === was) return;
    was = c;
    sky.style.backgroundColor = c;
    root.style.backgroundColor = c;
    if (document.body) document.body.style.backgroundColor = c;
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', c);           // (an older Safari still reads it)
  }
  window.addEventListener('hk-sky-paint', tint);
  window.addEventListener('popstate', function () { setTimeout(tint, 300); });
  window.addEventListener('load', function () { setTimeout(tint, 500); });
})();
