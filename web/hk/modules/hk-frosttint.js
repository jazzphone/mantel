// hk-frosttint.js -- TINT FROM BACKGROUND, for the Frosted look (2026-10-09).
//
// Frosted is one recipe on every page: grain, a white sheen and a wash of one
// gray. Real frosted glass takes the color of what is behind it; one gray
// pulled every page toward the same gray -- over the Lights page's gold it
// read as flat gray. With Tint from Background on (HK Settings -> Appearance,
// All Screens or a screen's own), each dashboard card's wash is the color
// behind it instead: the page's sky at the card's height, or the scenery's
// ground where the woodland covers the lower screen. Its hue and some of its
// saturation, at ONE lightness, so white text reads the same on every page.
//
// NO BLUR AND NOTHING PER FRAME: a per-card backdrop blur halved a wall
// tablet's frame rate (hk-settings.js). This sets one CSS variable per card
// (--hk-glass-plate / --hk-chip-plate, which every glass surface reads)
// when the page, the sky or the cards change: a card that joins is tinted in
// the animation frame before it is first drawn, and the sky says when its
// colors move (hk-sky-paint).
//
// BY PLACE ON THE PAGE, NOT ON THE SCREEN: the sky is fixed and the cards
// scroll, so a card is tinted for where it sits with the page at its top --
// below the first screen, the bottom of the sky. Nothing changes as the page
// scrolls.
//
// LEFT GRAY: cards outside a dashboard view (pop-up sheets, the screensaver),
// a page whose background is album art (Play Music), a page with no sky.
(function () {
  'use strict';
  if (window.hkFrostTint) return;

  var VIEWS = ['HUI-VIEW', 'HUI-MASONRY-VIEW', 'HUI-SECTIONS-VIEW', 'HUI-PANEL-VIEW'];
  var STOPS_AT = [0, 0.42, 0.72, 1];          // the sky gradient's stops (hk-sky .grad)
  var SAT_MAX = 0.55, LIGHT = 0.27;           // the wash: its hue, this much color, this light
  var GROUND_FROM = 0.45, GROUND_OVER = 0.2;  // the scenery's ground: from here down, blended in over this

  var tinted = new Set(), pending = new Set(), queued = false, skyEl = null;

  function settings() { return window.hkSettings; }
  function on() { var HS = settings(); return !!(HS && HS.frostTint && HS.frostTint() && HS.frostPlate); }

  function rgb(s) {
    s = String(s || '').trim();
    var m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) return m[1].split(',').slice(0, 3).map(function (v) { return parseFloat(v); });
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
    return null;
  }
  function hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    if (!s) { var v = Math.round(l * 255); return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var f = function (t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(function (x) { return Math.round(x * 255); });
  }
  // the wash for a background color: its hue, its saturation up to SAT_MAX,
  // at LIGHT
  function wash(c) { var x = hsl(c); return fromHsl(x[0], Math.min(x[1], SAT_MAX), LIGHT); }
  function mix(a, b, t) { return a.map(function (v, k) { return v + (b[k] - v) * t; }); }

  // THE SKY ELEMENT (hk-sky.js), found once and kept while it is on the page
  function sky() {
    if (skyEl && skyEl.isConnected) return skyEl;
    skyEl = null;
    (function walk(r, d) {
      if (!r || d > 40 || skyEl) return;
      var k = r.querySelectorAll ? r.querySelectorAll('*') : [];
      for (var i = 0; i < k.length; i++) {
        if (k[i].id === 'hk-sky') { skyEl = k[i]; return; }
        if (k[i].shadowRoot) walk(k[i].shadowRoot, d + 1);
      }
    })(document, 0);
    return skyEl;
  }
  // what is behind the cards: the gradient's four stops, the scenery's ground
  // when the woodland shows, or null (no sky, or album art: leave the gray)
  function backdrop() {
    var el = sky();
    if (!el || typeof getComputedStyle !== 'function') return null;
    var cs = getComputedStyle(el);
    if (parseFloat(cs.getPropertyValue('--artO')) > 0) return null;
    var stops = [0, 1, 2, 3].map(function (i) { return rgb(cs.getPropertyValue('--sk' + i)); });
    if (stops.some(function (s) { return !s; })) return null;
    var ns = el.querySelector && el.querySelector('.near-scenery'), ground = null;
    if (ns && !(el.classList && el.classList.contains('static'))) {
      var shown = true;
      for (var n = ns; shown && n && n !== el; n = n.parentElement) {
        var c = getComputedStyle(n);
        if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) shown = false;
      }
      if (shown) ground = rgb(getComputedStyle(ns).getPropertyValue('--ground-color'));
    }
    return { stops: stops, ground: ground };
  }
  // the color behind a point `f` of the way down the screen
  function behind(bd, f) {
    f = Math.max(0, Math.min(1, f));
    var c = bd.stops[3];
    for (var i = 0; i < 3; i++) {
      if (f <= STOPS_AT[i + 1]) {
        c = mix(bd.stops[i], bd.stops[i + 1], (f - STOPS_AT[i]) / (STOPS_AT[i + 1] - STOPS_AT[i]));
        break;
      }
    }
    if (bd.ground && f > GROUND_FROM) c = mix(c, bd.ground, Math.min(1, (f - GROUND_FROM) / GROUND_OVER));
    return c;
  }
  // a card on a dashboard view (not a pop-up sheet, not the screensaver)
  function inView(card) {
    for (var n = card, d = 0; n && d < 80; d++) {
      if (VIEWS.indexOf(n.tagName) >= 0) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  }
  function untint(card) {
    if (!card.style) return;
    card.style.removeProperty('--hk-glass-plate');
    card.style.removeProperty('--hk-chip-plate');
    card.__hkTint = null;
  }
  function clear() { tinted.forEach(untint); tinted.clear(); }

  // TINT `cards` (all on the page when none are given)
  function tint(cards) {
    if (!on()) { clear(); return; }
    var bd = backdrop();
    if (!bd) { clear(); return; }
    var HS = settings(), H = window.innerHeight || 1, sy = window.scrollY || 0;
    var list = cards || Array.from(window.__hkCardsOnPage || []);
    list.forEach(function (card) {
      if (!card || !card.style || card.isConnected === false) return;
      if (!inView(card)) { if (tinted.has(card)) { untint(card); tinted.delete(card); } return; }
      var r = card.getBoundingClientRect();
      if (!r || !r.height) return;
      var w = wash(behind(bd, (r.top + sy + r.height / 2) / H));
      var plate = HS.frostPlate(w);
      if (card.__hkTint !== plate) {
        card.style.setProperty('--hk-glass-plate', plate);
        card.style.setProperty('--hk-chip-plate', plate);
        card.__hkTint = plate;
      }
      tinted.add(card);
    });
    tinted.forEach(function (c) { if (c.isConnected === false) tinted.delete(c); });
  }
  // in the animation frame before the next draw
  function soon(card) {
    if (card) pending.add(card); else pending.add(null);
    if (queued) return;
    queued = true;
    var run = function () {
      queued = false;
      var all = pending.has(null), list = all ? null : Array.from(pending);
      pending.clear();
      try { tint(list); } catch (e) { console.warn('[hk-frosttint]', e); }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
  }

  window.hkFrostTint = {
    // hk-base: a card joined the page (connectedCallback)
    joined: function (card) { if (on()) soon(card); },
    refresh: function () { soon(null); },
    _wash: wash, _behind: behind, _tint: tint, _tinted: function () { return tinted; }
  };
  // the page, the sky's colors, the settings, the window
  try {
    window.addEventListener('location-changed', function () { skyEl = null; soon(null); });
    window.addEventListener('popstate', function () { skyEl = null; soon(null); });
    window.addEventListener('hk-sky-paint', function () { soon(null); });
    window.addEventListener('resize', function () { soon(null); });
  } catch (e) { /* no window events (a test harness) */ }
  var HS0 = settings();
  if (HS0 && HS0.onChange) HS0.onChange(function () { soon(null); });
  soon(null);
})();
