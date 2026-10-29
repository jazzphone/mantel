// hk-fps.js - THE FRAME RATE a screen draws, sampled now and then (2026-10-29).
//
// WHY THIS EXISTS
// HK Settings recommends a lighter look for a screen whose wall tablet draws
// under 45 frames a second, one step at a time: Blur, Frosted or Tinted first,
// then the sky's rain and snow, its moving things in front of the cards, its
// animations, a camera playing live (a screen's Appearance;
// M.slowRecommend). Mantel hears each tablet's number from its
// page (web/shim/page-health.js tells it this sampler's); HK Frontend in
// Home Assistant has nobody to tell, so the last sample is kept in this
// browser (localStorage `hk-fps`) and HK Settings, opened on the same device,
// shows it under This Device on that screen's page.
//
// THE RULES (Mantel's baseline, docs/development/Performance-baseline.md):
// 5 seconds of requestAnimationFrame, about 20 seconds after the page loads
// and then hourly, only while the page is visible, nobody has touched it for
// 5 seconds and it is lit -- never under the black screen or the screensaver
// (a dark page draws nothing worth measuring), and on a dashboard only. A
// page that is not calm is tried again half a minute later; after ten
// minutes of trying, at the next hour. One sampler: Mantel's settings page
// runs the same one (watch) with its own idea of dark.
//
// A dashboard's sample is {fps, at (ms), screen (the dashboard's path),
// style (hkSettings.glass(): flat, clear, frosted, tinted, blur, blur_pre,
// blur_each), sig (hkSettings.ladderSignature(): the style and the sky and
// camera settings it was drawn with, "blur:a1w1r1f0c1")}: kept, handed to
// every listen(fn), and announced as the `hk-fps` window event. A step of
// the ladder uses a number only while the screen's settings still read as
// its sig; the next sample, up to an hour later, says what the change did.
// Numbers and names only.
(function () {
  'use strict';
  if (window.hkFps) return;           // hk-loader may import this more than once

  var KEY = 'hk-fps', FIRST = 20000, SAMPLE = 5000, IDLE = 5000, RETRY = 30000, HOUR = 3600000, TRIES = 20;
  var listeners = [], latest = null, lastInput = clock(), heard = false;
  function clock() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  try { latest = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { latest = null; }

  // the dashboard this page shows: the address's first part, as hk-settings.js
  // reads it (a host that serves under a prefix answers without it)
  function screenNow() {
    try { return String(location.pathname).split('/')[1] || ''; } catch (e) { return ''; }
  }
  function styleNow() {
    try { return window.hkSettings && window.hkSettings.glass ? window.hkSettings.glass() : null; } catch (e) { return null; }
  }
  function sigNow() {
    try { return window.hkSettings && window.hkSettings.ladderSignature ? window.hkSettings.ladderSignature() : null; } catch (e) { return null; }
  }
  // a dashboard's dark: true / false, null when it cannot tell yet (the saver
  // loads a moment after the page)
  function dark() {
    if (window.__hkAsleep) return true;
    var s = window.hkSaver;
    if (!s || typeof s.black !== 'function') return null;
    return !!s.black() || !!(s.running && s.running());
  }
  function onDashboard() {
    var sh = window.hkShell;
    try {
      return !sh || ((!sh.isDashboard || sh.isDashboard() !== false) && (!sh.onDashboard || sh.onDashboard() !== false));
    } catch (e) { return false; }
  }
  function touched() { lastInput = clock(); }

  // ONE SAMPLER: o.dark() (true / false / null: not known yet, so not
  // sampled; a dashboard's when not given), o.ok() (anything else that must
  // hold), o.onSample(fps), o.first (ms to the first try). Returns {stop}.
  function watch(o) {
    var timer = null, stopped = false;
    if (!heard && typeof window.addEventListener === 'function') {
      heard = true;
      ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel'].forEach(function (t) {
        window.addEventListener(t, touched, { passive: true, capture: true });
      });
    }
    var calm = function () {
      return (typeof document === 'undefined' || document.visibilityState === 'visible') && clock() - lastInput >= IDLE &&
        (o.dark ? o.dark() : dark()) === false && (!o.ok || !!o.ok());
    };
    var later = function (ms, tries) {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(function () { attempt(tries); }, ms);
    };
    var attempt = function (tries) {
      if (!calm()) { later(tries < TRIES ? RETRY : HOUR, tries + 1); return; }
      var first = null, last = null, frames = 0;
      var frame = function (t) {
        if (stopped) return;
        // somebody came, it went dark, or the page was paused
        if (!calm() || (last !== null && t - last > 1500)) { later(RETRY, tries + 1); return; }
        if (first === null) first = t;
        last = t;
        if (frames++ && t - first >= SAMPLE) {
          o.onSample(Math.round((frames - 1) / ((t - first) / 1000) * 10) / 10);
          later(HOUR, 0);
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame === 'function') later(o.first != null ? o.first : FIRST, 0);
    return { stop: function () { stopped = true; clearTimeout(timer); } };
  }

  // THE DASHBOARD'S: kept, handed to each listener, announced
  function told(fps) {
    latest = { fps: fps, at: Date.now(), screen: screenNow(), style: styleNow(), sig: sigNow() };
    try { localStorage.setItem(KEY, JSON.stringify(latest)); } catch (e) { /* no storage */ }
    listeners.slice().forEach(function (fn) { try { fn(latest); } catch (e) { console.error('[hk-fps]', e); } });
    try { window.dispatchEvent(new CustomEvent('hk-fps', { detail: latest })); } catch (e) { /* no window events */ }
  }
  var dashboard = watch({ ok: function () { return onDashboard() && !!screenNow(); }, onSample: told });

  window.hkFps = {
    // the last sample on this device (kept across loads), or null
    latest: function () { return latest; },
    // fn(sample) for each one from now on; returns the way to stop
    listen: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    // another page's own sampler, by the same rules (Mantel's settings page)
    watch: watch,
    stop: function () { dashboard.stop(); },
    _: { screenNow: screenNow, dark: dark }     // tests
  };
})();
