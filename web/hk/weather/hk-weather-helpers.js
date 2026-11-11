// hk-weather-helpers.js - the cards' helpers and the sky behind a grid.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-helpers'] = function (K) {
    var C = K.C;

    var M = C.M;
    var Base = C.HkBase;

    // 0.12, NOT 0.10 -- measured, not eyeballed.
    var RULE = '' + window.hkCards.v('line') + '';

    function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
    // Text going into markup: the place label is typed by a person, the
    // condition comes from the weather provider.
    var esc = C.esc;

    // hk-header.js owns the glyphs (the home's multicolor SF Symbols as inline
    // SVG, or Material stand-ins) and the condition names. If it has not loaded, draw an empty box of the
    // right size rather than a broken icon, so the forecast grid keeps its rows.
    function glyph(cond, px, night) {
      var H = window.hkHeader;
      return H && H.wxSvg ? H.wxSvg(cond, px, { night: night })
        : '<span style="display:inline-block;width:' + px + 'px;height:' + px + 'px"></span>';
    }

    // THE HOUSE'S WEATHER WHEN A CARD NAMES NONE. A key the
    // card's YAML gives wins; one it leaves out is Configure -> Weather's
    // (the weather entity, else the house's first; the wind, gust, UV and
    // alerts sensors), re-read with every new client so an edit there follows at once.
    // So no card throws for want of an `entity:`, and a card added in the UI
    // need not repeat the house's own choice.
    function houseWeather(card, client, keys) {
      var HS = window.hkSettings, c = card._config;
      if (!HS || !c) return;
      var own = card._hkOwn || {};
      Object.keys(keys).forEach(function (k) {
        if (own[k]) return;
        var v = keys[k] === 'weather' ? (client ? HS.weatherId(client.states) : HS.get('weather.entity', null))
                                      : HS.get(keys[k], null);
        if (v && c[k] !== v) { c[k] = v; card._hkSig = null; }
      });
    }
    function ownKeys(config, keys) {
      var out = {};
      Object.keys(keys).forEach(function (k) { if (config && config[k]) out[k] = true; });
      return out;
    }
    var TILE_KEYS = { entity: 'weather', speed: 'weather.wind', gust: 'weather.gust', uv: 'weather.uv' };
    var BAND_KEYS = { entity: 'weather' };
    var ALERT_KEYS = { entity: 'weather.alerts' };

    // ================================================== THE WEATHER PAGE
    // (2026-10-16, hk_house/docs/PLAN-2026-10-16-weather-page.md): the band
    // in separable parts, each its own card on the page --
    //   section: 'hero'     the place, the temperature, the condition, today's
    //                       high and low and a line of what is coming, over
    //                       the sky with no plate
    //   section: 'hourly'   the hours, Temperature / Rain / Wind, a tap on an
    //                       hour reading it out
    //   section: 'daily'    the days, each low-to-high on one shared scale
    // -- and the band itself unchanged with no `section` (the Tesla, the
    // screensaver, a dashboard of the house's own). What each shows, how many
    // hours and days, the hourly view it opens on: weather.page
    // (hkSettings.weatherPage), read live. The forecast is the band's
    // (_forecast: the sensor, else the shared subscription).
    var SECTIONS = ['hero', 'hourly', 'daily'];
    var WX_METRIC_ORDER = ['temperature', 'rain', 'wind'];
    function wxPage() {
      var HS = window.hkSettings;
      return HS && HS.weatherPage ? HS.weatherPage()
        : { show_current: true, show_hourly: true, show_daily: true, show_alerts: true, hours: 12, days: 8,
            hourly_metric: 'temperature', details: ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'], load_animation: true };
    }
    function hourLabel(t) { var d = new Date(t), hh = d.getHours(); return (hh % 12 === 0 ? 12 : hh % 12) + ' ' + (hh < 12 ? 'AM' : 'PM'); }
    function titled(s) { return String(s || '').replace(/\b(\w)(\w*)/g, function (m, a, b) { return a + b.toLowerCase(); }); }
    function nightOf(states, f) {
      return f.is_daytime != null ? f.is_daytime === false
        : !!(window.hkHeader && window.hkHeader.nightAt && window.hkHeader.nightAt(states, f.datetime));
    }
    // a daily entry that is already over (a sensor kept yesterday's first)
    function upcomingDays(list) {
      var d0 = new Date(Date.now()); d0.setHours(0, 0, 0, 0);
      return (list || []).filter(function (d) {
        var t = Date.parse(d.datetime);
        if (!isFinite(t)) return true;
        var dd = new Date(t); dd.setHours(0, 0, 0, 0);
        return dd.getTime() >= d0.getTime();
      });
    }
    // THE PAGE'S ENTRANCE (plan §8): once per arrival on the page -- not on
    // a forecast, a settings save, a sheet or a rebuild -- the hero fading in
    // over 200 ms, then each card rising 6 px into place on the standard
    // curve, 35 ms apart, the whole at most ~550 ms. Opacity and transform
    // only, on the card's own host; nothing waits for it, and content is
    // there whether or not it runs. Page entry is allowed in Flat too;
    // Reduce Motion, Animate Page Loading off, hidden and asleep still win.
    var ENTRY = { path: null, at: 0 };
    function markEntry() {
      var p = location.pathname;
      if (p !== ENTRY.path) { ENTRY.path = p; ENTRY.at = (window.performance && performance.now()) || Date.now(); ENTRY.first = null; }
    }
    function motionOk() {
      if (!wxPage().load_animation) return false;
      if (window.__hkAsleep) return false;
      if (typeof document !== 'undefined' && document.hidden) return false;
      try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* old */ }
      return true;
    }
    function wxEnter(card) {
      var c = card._config || {};
      if (c.enter == null || typeof card.animate !== 'function') return;
      markEntry();
      if (card._enterAt === ENTRY.at) return;
      card._enterAt = ENTRY.at;
      // AN ARRIVAL is the page's cards appearing together, however long the
      // dashboard took to build (a cold start is several seconds): timed from
      // the first card of this entry, not from the address changing. A card
      // that appears later on the same entry -- a rebuild after a settings
      // save -- is not one.
      var now = (window.performance && performance.now()) || Date.now();
      if (ENTRY.first == null) ENTRY.first = now;
      if (now - ENTRY.first > 1500 || !motionOk()) return;
      card._buildDue = Date.now();
      // (the cards themselves stay where they are -- the user, 2026-10-17:
      // the page rising from the bottom read as a scroll; their insides build)
    }
    function wxLeave(card) {
      if (card._buildIO) { card._buildIO.disconnect(); card._buildIO = null; }
      if (card._enterAnim) { try { card._enterAnim.cancel(); } catch (e) { /* gone */ } card._enterAnim = null; }
    }
    // NEW CONTENT AFTER A WAIT fades in over 180 ms (never a shimmer)
    function arrive(el) {
      if (!el || !motionOk() || typeof el.animate !== 'function') return;
      try { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }); } catch (e) { /* ok */ }
    }

    // THE BUILD (2026-10-17, the user: "like the Energy page"): on arriving
    // at the page each card's pieces draw themselves in -- the hours rise
    // one after another, each day's range wipes out from its low, the tiles'
    // needle turns, arc draws, bars fill and marks pop -- under a class held
    // for the length of it (`anim`, hk-energy.js's pattern). Transform,
    // opacity and clip only; never on a live update, a settings save or a
    // forecast push; not with Reduce Motion or Animate Page Loading off.
    var BUILD = C.EASE.build;
    var BUILD_CSS = [
      '@keyframes wxUp{from{opacity:0;transform:translateY(10px)}}',
      '@keyframes wxPop{from{opacity:0;transform:scale(.55)}}',
      '@keyframes wxWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}',
      '@keyframes wxGrowX{from{transform:scaleX(0)}}',
      '@keyframes wxTurn{from{transform:rotate(var(--from,0deg))}}',
      '@keyframes wxDraw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}',
      '@media (prefers-reduced-motion: reduce){.anim *{animation:none!important}}'
    ].join('');
    // ...when the card is first on screen: a card below the fold builds as
    // it is scrolled to, not unseen (at most a minute after arriving)
    function build(card, el, wait) {
      if (!el || !motionOk()) return;
      if (typeof IntersectionObserver === 'function' && !card._buildSeen) {
        if (card._buildIO) card._buildIO.disconnect();
        var t0 = Date.now();
        card._buildIO = new IntersectionObserver(function (en) {
          if (!en.some(function (x) { return x.isIntersecting; })) return;
          card._buildIO.disconnect(); card._buildIO = null;
          if (Date.now() - t0 > 60000 || !card.isConnected) return;
          card._buildSeen = true;
          build(card, el, wait);
          card._buildSeen = false;
        });
        card._buildIO.observe(card);
        return;
      }
      el.classList.remove('anim');
      void el.offsetWidth;                       // a class put back restarts its animations
      el.classList.add('anim');
      clearTimeout(card._buildT);
      card._buildT = setTimeout(function () { el.classList.remove('anim'); }, wait || 1800);
    }
    // an arrival marks the card; the build runs at its first draw with data
    function buildDue(card) {
      if (!card._buildDue) return false;
      if (Date.now() - card._buildDue > 4000) { card._buildDue = 0; return false; }
      card._buildDue = 0;
      return true;
    }

    var SHADOW = 'drop-shadow(0px 1px 3px rgba(0,0,0,0.30)) '

      + 'drop-shadow(0px 3px 12px rgba(0,0,0,0.28)) '

      + 'drop-shadow(0px 6px 26px rgba(0,0,0,0.30))';

    // what the shell and the later parts use of this one
    K.ALERT_KEYS = ALERT_KEYS; K.arrive = arrive; K.BAND_KEYS = BAND_KEYS; K.Base = Base; K.BUILD = BUILD;
    K.build = build; K.BUILD_CSS = BUILD_CSS; K.buildDue = buildDue; K.esc = esc; K.glyph = glyph;
    K.hourLabel = hourLabel; K.houseWeather = houseWeather; K.markEntry = markEntry; K.nightOf = nightOf; K.num = num;
    K.ownKeys = ownKeys; K.RULE = RULE; K.SECTIONS = SECTIONS; K.SHADOW = SHADOW; K.TILE_KEYS = TILE_KEYS;
    K.titled = titled; K.upcomingDays = upcomingDays; K.WX_METRIC_ORDER = WX_METRIC_ORDER; K.wxEnter = wxEnter;
    K.wxLeave = wxLeave; K.wxPage = wxPage;
  };
})();
