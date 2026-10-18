// Give a CAR dashboard a usable layout width in the car's browser.
//
// WHICH DASHBOARDS: each dashboard item's gear -> Screen -> "In a car's
// browser" (sent as settings.py `car.dashboards`, url paths such as
// dashboard-tesla -- legacy_screens builds it from the items). Nothing else is
// touched. Written for, and measured in, a Tesla -- hence the file name,
// kept because it is a bootstrap URL.
//
// MEASURED IN A TESLA (the ?vw=test badge):
//   innerWidth 804  innerHeight 638  devicePixelRatio 1.96
//   screen 1306x816  visualViewport.scale 1
//   UA Mozilla/5.0 (X11; Linux x86_64) ... Chrome/148.0.0.0 Safari/537.36
//
// That is DESKTOP Chromium, not a mobile browser, and the window is ~804px
// because the car runs the browser in split screen next to the car card.
//
// Two things were verified empirically in Chromium rather than assumed:
//   1. Rewriting <meta name="viewport"> does NOTHING. Desktop browsers ignore
//      it - it is a mobile feature, so this file cannot rely on it.
//   2. `zoom` DOES buy layout room: at zoom 0.67 a 100%-width child went from
//      756px to 1152px. But innerWidth and CSS media queries still report the
//      real 804px.
//
// So the fix is two halves, and neither works alone:
//   - here: zoom the document so 804px of window holds ~1200px of layout;
//   - the dashboard: its own layout breakpoint must sit below the window
//     (600px rather than 900px, for example), or it fires at 804 before the
//     zoom can help. `data-hk-zoomed` on <html> carries the
//     layout width bought, for any responsive rule that wants it.
//
// 1200 is chosen so the security column lands at ~408px, i.e. two pill-wide
// tiles - the width the whole tile system was calibrated around. (The Tesla
// Home custom page gives it 34.5% since the pill went to 196, 2026-10-13:
// 406 px of grid for 2 x 196 + 10.)
//
// NO CONSOLE IN THE CAR, so everything is driven from the URL:
//   ?vw=1000   set the target layout width (bigger number = smaller content);
//              HK Settings -> the screen -> Car Browser -> Scale is the usual way
//   ?vw=off    disable and forget
//   ?vw=test   change nothing, just show the measurement badge
(function () {
  if (window.teslaViewport) return;          // loaded twice: the first one runs
  // The car dashboard this page is on (its url path), or null.
  function carDashboard() {
    var HS = window.hkSettings;
    var paths = (HS && HS.get("car.dashboards", [])) || [];
    for (var i = 0; i < paths.length; i++) {
      // The dashboard's own path SEGMENT: /dashboard-tesla and
      // /dashboard-tesla/0, never /dashboard-tesla2.
      var p = "/" + String(paths[i]).replace(/^\/+|\/+$/g, "");
      if (location.pathname === p || location.pathname.indexOf(p + "/") === 0) return paths[i];
    }
    return null;
  }
  function onCarDashboard() { return carDashboard() !== null; }
  // ITS SCALE (the screen's gear -> Car Browser -> Scale, settings.py
  // car_width): the layout width chosen in HK Settings, or none.
  function chosen() {
    var HS = window.hkSettings, d = carDashboard();
    var all = (HS && HS.get("car.widths", {})) || {};
    var n = d === null ? 0 : Number(all[d]);
    return n > 0 ? n : 0;
  }
  var DEFAULT_WIDTH = 1200;
  var KEY = "teslaViewportWidth";
  var applied = null;

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { v === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch (e) {} }
  function param() { try { return new URLSearchParams(location.search).get("vw"); } catch (e) { return null; } }

  function badge(lines) {
    var id = "tesla-vw-badge", el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      el.setAttribute("style",
        "position:fixed;z-index:2147483647;top:8px;left:8px;background:#111;color:#fff;"
        + "font:600 15px/1.45 -apple-system,system-ui,sans-serif;padding:12px 16px;"
        + "border-radius:12px;border:2px solid #E82127;max-width:90vw;white-space:pre-wrap;"
        + "word-break:break-all;pointer-events:none");
      document.body.appendChild(el);
    }
    el.textContent = lines.join("\n");
  }

  function measurements(extra) {
    var vv = window.visualViewport || {};
    return [
      "TESLA-VIEWPORT " + (extra || ""),
      "innerWidth        " + window.innerWidth,
      "innerHeight       " + window.innerHeight,
      "devicePixelRatio  " + window.devicePixelRatio,
      "visualViewport.w  " + (vv.width || "-"),
      "screen            " + screen.width + " x " + screen.height,
      "documentZoom      " + (document.documentElement.style.zoom || "none"),
      "layout room       " + document.body.clientWidth,   // documentElement stays at the real width under zoom
      "stored vw         " + (stored() || "(none)"),
      "UA " + navigator.userAgent
    ];
  }

  // THE WIDTH: the URL's, then the Scale picked in HK Settings, then one a
  // URL left in this browser before there was a setting, then 1200. A
  // setting wins over a stored ?vw= -- or a car that was once tested with
  // one would never follow HK Settings.
  function target() {
    var q = param();
    if (q === "off") { store(null); return 0; }
    if (q && Number(q) > 0) { store(q); return Number(q); }
    var c = chosen();
    if (c) return c;
    var s = stored();
    return s && Number(s) > 0 ? Number(s) : DEFAULT_WIDTH;
  }

  // WHEN A ZOOM IS APPLIED, MEDIA QUERIES LIE -- and this attribute is how the
  // rest of the config finds out. `zoom` scales the whole document so it has
  // DEFAULT_WIDTH (1200px) of layout room whatever the physical width, but CSS
  // media queries still evaluate against the real viewport. So at innerWidth
  // 620 the 640px phone block in /hk/css/hk-responsive.css fires on a document
  // that genuinely has 1200px to work with.
  //
  // A Tesla reports 804, so that block does not fire and the layout is the
  // intended two-column one -- but only by 164px of margin. This attribute
  // removes the need for that margin: hk-responsive.css gates its phone block
  // with `:root:not([data-hk-zoomed])`, so a zoomed document can never take
  // the phone path no matter how narrow the window gets.
  //
  // It is set ONLY here, and this module only acts on the car dashboards, so
  // no other dashboard can ever carry it.
  var MARK = "data-hk-zoomed";

  // AND VIEWPORT UNITS LIE THE OTHER WAY. Under the zoom, 100vh is the real
  // 638px window in CSS px -- zoomed again to 0.67 of it, so a sheet capped at
  // calc(100dvh - 32px) would use 406 of the car's 638 px and scroll a
  // thermostat that fits. The real window in LAYOUT px is
  // published as --hk-vw / --hk-vh, and the caps read
  // `var(--hk-vh, 100dvh)`: set only here, so every unzoomed screen falls
  // back to the plain unit.
  function publish(z) {
    var s = document.documentElement.style;
    if (!z) { s.removeProperty("--hk-vw"); s.removeProperty("--hk-vh"); return; }
    s.setProperty("--hk-vw", (window.innerWidth / z).toFixed(2) + "px");
    s.setProperty("--hk-vh", (window.innerHeight / z).toFixed(2) + "px");
  }

  function clear() {
    document.documentElement.removeAttribute(MARK);
    publish(0);
    if (!applied) return;
    document.documentElement.style.zoom = "";
    applied = null;
  }

  function apply() {
    if (!onCarDashboard()) { clear(); return; }
    if (param() === "test") { badge(measurements("(test mode - nothing changed)")); return; }

    var want = target();
    if (!want) { clear(); return; }
    // window.innerWidth is unaffected by our own zoom, so it stays a stable
    // reading of the real window across re-runs.
    var w = window.innerWidth;
    // Never shrink a window that already has room for the desktop layout.
    if (w >= want) { clear(); return; }
    // The height can change on its own (the car's bars), so it is published
    // on every run, before the same-zoom early return.
    publish(w / want);
    if (applied && applied.want === want && applied.w === w) return;

    applied = { want: want, w: w };
    document.documentElement.style.zoom = String(w / want);
    // Stamped with the LAYOUT width the zoom bought, not the physical one --
    // it is the number any responsive decision should be made against.
    document.documentElement.setAttribute(MARK, String(want));
    if (param()) setTimeout(function () { badge(measurements("target " + want + "px, applied")); }, 120);
    try {
      console.info("TESLA-VIEWPORT window=" + w + " target=" + want + " zoom=" + (w / want).toFixed(3));
    } catch (e) {}
  }

  function run() { setTimeout(apply, 80); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  // HA is a single-page app: navigating between dashboards never reloads.
  window.addEventListener("location-changed", run);
  window.addEventListener("popstate", run);
  // Split screen <-> full screen changes the window without a reload.
  window.addEventListener("resize", run);
  // The car dashboards are a setting, so the answer can arrive (or change)
  // after the first run. hk-settings.js announces every change, whichever of
  // the two files happened to load first.
  window.addEventListener("hk-module-ready", function (e) {
    if (e && e.detail && e.detail.module === "hk-settings") run();
  });
  window.teslaViewport = function (px) { store(px ? String(px) : null); clear(); apply(); };
})();
