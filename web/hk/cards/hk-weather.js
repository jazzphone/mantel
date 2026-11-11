// hk-weather.js -- the Weather page's summary band, as a native Lovelace card.
//
// The drawing is code, so it lives in a card rather than in a template
// string. The YAML at each call site is `type`, `entity` and two counts.
//
// WHAT A CARD BUYS OVER A TEMPLATE, because the point is authoring cost and
// not speed:
//
//   * a syntax error here is a syntax error in a .js file, with a line number.
//     Inside a button-card `[[[ ]]]` string it blanks the whole card to a
//     MESSAGE-LESS RED with nothing to bisect.
//   * `hours` / `days` are CONFIG. A template would have to sniff
//     window.innerWidth to decide 12/8 versus 6/5, because an `!include` takes
//     no keys and a merge key does not survive HA's loader. A card is
//     configured at its call site, so there is no guess.
//   * one copy, however many dashboards call it (the weather page, a car's).
//
// THE MATERIAL IS NOT REDEFINED HERE. window.hkCards.M carries the glass plate
// as `var(--hk-glass-*, <literal>)`, published by the HK Kiosk theme, so
// this card cannot drift from the glass tiles the way a hardcoded copy would.
//
// The ICON MAP is deliberately hk-header.js's -- one weather glyph map for the
// whole frontend. A `weather` entity has NO `attributes.icon` (reading one
// draws the fallback forever), and the map is the correct pattern.

// ============================================================ THE FORECAST
// ONE SUBSCRIPTION PER WEATHER ENTITY AND KIND, for every card and sheet
// that wants it (2026-10-16, the Weather page): the band, the page's hourly
// and daily cards and the weather sheet each WATCH it, and the first to watch
// asks Home Assistant (weather/subscribe_forecast) while the last to let go
// drops it. Per subscription port (the client's: one per socket, the same
// across state snapshots), so a page whose socket was replaced starts afresh.
//
//   var w = hkWxForecast.watch(client.subscriptions, 'hourly', 'weather.home', onNew);
//   w.data()      the forecast so far ([] until it arrives)
//   w.ensure()    ask again if a refusal's wait is over (each render)
//   w.release()   this watcher is done; the last one unsubscribes
//
// A REFUSED SUBSCRIPTION BACKS OFF. Home Assistant refuses
// weather/subscribe_forecast for an entity that does not offer that kind of
// forecast, or does not exist yet. Forgetting the refusal would ask again on
// the very next render -- every weather update, every module arriving -- with
// nothing logged. So: one console warning per entity and kind per page, and
// the next attempt waits RETRY, doubling to RETRY_MAX. Any forecast arriving
// clears the back-off. Keyed 'kind|entity', shared by every watcher.
//
// A RECONNECT (Home Assistant restarted) is ours to follow: the library's own
// resubscribe, refused because the weather entity is not back yet, is dropped
// for good and the cards kept yesterday's forecast. So `resubscribe: false`,
// and on 'ready' -- the server has forgotten every subscription -- each
// watcher is told, and its next render asks again (ensure), through the
// same back-off.
(function () {
  'use strict';
  if (window.hkWxForecast) return;
  var RETRY = 60 * 1000, RETRY_MAX = 60 * 60 * 1000;
  var refused = {}, warned = {};
  var conns = [];                  // [{ conn, entries: { key: entry }, ready }]
  function slot(conn) {
    for (var i = 0; i < conns.length; i++) if (conns[i].conn === conn) return conns[i];
    var s = { conn: conn, entries: {}, ready: null };
    conns.push(s);
    if (typeof conn.addEventListener === 'function') {
      s.ready = function () {
        Object.keys(s.entries).forEach(function (k) {
          var e = s.entries[k];
          e.sub = null;
          e.cbs.slice().forEach(function (cb) { try { cb(); } catch (x) { /* the card's */ } });
        });
      };
      conn.addEventListener('ready', s.ready);
    }
    return s;
  }
  function drop(s) {
    if (Object.keys(s.entries).length) return;
    if (s.ready && typeof s.conn.removeEventListener === 'function') s.conn.removeEventListener('ready', s.ready);
    conns.splice(conns.indexOf(s), 1);
  }
  function ensure(s, e) {
    if (e.sub || !e.cbs.length) return;
    var r = refused[e.key];
    if (r && Date.now() < r.until) return;
    var sub = null;
    var p = s.conn.subscribeMessage(function (ev) {
      delete refused[e.key];
      e.fc = (ev && ev.forecast) || [];
      e.n++;
      e.cbs.slice().forEach(function (cb) { try { cb(); } catch (x) { /* the card's */ } });
    }, { type: 'weather/subscribe_forecast', forecast_type: e.kind, entity_id: e.wid }, { resubscribe: false });
    sub = e.sub = Promise.resolve(p).catch(function (err) {
      if (e.sub === sub) e.sub = null;
      var rf = refused[e.key] = refused[e.key] || { n: 0 };
      rf.until = Date.now() + Math.min(RETRY_MAX, RETRY * Math.pow(2, rf.n));
      rf.n++;
      if (!warned[e.key]) {
        warned[e.key] = true;
        console.warn('[hk-weather] Home Assistant refused the ' + e.kind + ' forecast for ' + e.wid + ' (' +
                     ((err && (err.message || err.code)) || String(err)) + '); retrying with back-off. ' +
                     'A forecast sensor in Configure -> Weather avoids the subscription.');
      }
      return null;
    });
  }
  function watch(conn, kind, wid, cb) {
    var s = slot(conn), key = kind + '|' + wid;
    var e = s.entries[key] || (s.entries[key] = { kind: kind, wid: wid, key: key, fc: null, sub: null, cbs: [], n: 0 });
    e.cbs.push(cb);
    ensure(s, e);
    var gone = false;
    return {
      conn: conn,
      data: function () { return e.fc || []; },
      has: function () { return e.fc !== null; },
      ensure: function () { if (!gone) ensure(s, e); },
      release: function () {
        if (gone) return;
        gone = true;
        var i = e.cbs.indexOf(cb);
        if (i >= 0) e.cbs.splice(i, 1);
        if (e.cbs.length) return;
        var sub = e.sub;
        e.sub = null;
        delete s.entries[key];
        drop(s);
        if (sub) {
          sub.then(function (unsub) {
            if (typeof unsub !== 'function') return;
            var r = unsub();
            if (r && typeof r.catch === 'function') r.catch(function () { /* connection gone */ });
          });
        }
      }
    };
  }
  // how many are asked for right now (tests, the render audit)
  function active() {
    var n = 0;
    conns.forEach(function (s) { Object.keys(s.entries).forEach(function (k) { if (s.entries[k].sub) n++; }); });
    return n;
  }
  window.hkWxForecast = { watch: watch, active: active };
})();

// ============================================================ THE READINGS
// THE WEATHER NOW, IN NUMBERS (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md,
// Phase I): what the screensaver's Glance and Big Weather show -- read the
// way the page reads them: Configure -> Weather's sensors where it names
// them, else the weather entity's own attributes; today's high and low from
// the daily forecast it is handed (hkWxForecast, or a forecast sensor); the
// sunset from the sun; the air quality from a sensor that says it is one.
//
//   hkWxReadings.read(client, { entity, daily }) -> { entity, temp, unit,
//     cond, says, hi, lo, sunset (a Date), wind, windUnit, humidity, aqi,
//     place } or null (no weather)
(function () {
  'use strict';
  if (window.hkWxReadings) return;
  var SAYS = { sunny: 'Sunny', 'clear-night': 'Clear', cloudy: 'Cloudy', partlycloudy: 'Partly Cloudy', rainy: 'Rain',
               pouring: 'Heavy Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', hail: 'Hail', lightning: 'Thunder',
               'lightning-rainy': 'Thunderstorms', fog: 'Fog', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Unusual' };
  function num(v) { var n = Number(v); return v !== null && v !== '' && isFinite(n) ? n : null; }
  function read(client, o) {
    o = o || {};
    var st = (client && client.states) || {}, HS = window.hkSettings;
    var g = function (k) { return HS && HS.get ? HS.get('weather.' + k, null) : null; };
    var wid = o.entity && st[o.entity] ? o.entity : (HS && HS.weatherId ? HS.weatherId(st) : null);
    if (!wid || !st[wid]) wid = Object.keys(st).filter(function (k) { return k.indexOf('weather.') === 0; })[0];
    var w = wid && st[wid];
    if (!w) return null;
    var a = w.attributes || {}, sensor = function (k) { var id = g(k); return id && st[id] ? num(st[id].state) : null; };
    var daily = Array.isArray(o.daily) ? o.daily : [];
    if (!daily.length && g('forecast_daily') && st[g('forecast_daily')]) daily = (st[g('forecast_daily')].attributes || {}).forecast || [];
    var today = daily[0] || {}, sun = st['sun.sun'], set = sun && sun.attributes && sun.attributes.next_setting;
    var aqi = Object.keys(st).filter(function (k) { return k.indexOf('sensor.') === 0 && (st[k].attributes || {}).device_class === 'aqi' && num(st[k].state) !== null; })[0];
    var place = g('place') || (client && client.config && client.config.location_name) || 'Home';
    var wind = sensor('wind');
    return {
      entity: wid, temp: num(a.temperature), unit: String(a.temperature_unit || '').replace(/[^CF]/g, ''),
      cond: w.state, says: SAYS[w.state] || '', hi: num(today.temperature), lo: num(today.templow),
      sunset: set && !isNaN(new Date(set)) ? new Date(set) : null,
      wind: wind !== null ? wind : num(a.wind_speed), windUnit: (wind !== null && st[g('wind')].attributes.unit_of_measurement) || a.wind_speed_unit || '',
      humidity: sensor('humidity') !== null ? sensor('humidity') : num(a.humidity), aqi: aqi ? Math.round(num(st[aqi].state)) : null,
      place: String(place)
    };
  }
  window.hkWxReadings = { read: read, SAYS: SAYS };
})();

(function () {
  'use strict';

  // ------------------------------------------------------------ the parts (generated by tools/split_js.py)
  // THIS FILE IS THE SHELL. Its members are cut into the files of web/hk/weather/ (the PARTS below, in the order they
  // run) by tools/split_js.py from tools/split_manifests/weather.json; `split_js.py --find <name>` says which file holds
  // one. Each file registers one function in window.hkWeatherParts; they run here, in this order (a later one may use
  // an earlier one), each given the kit K: what the parts use of the shell, in one object. What the shell uses of them,
  // they hand back on K, and it is taken from there. The files are fetched in parallel; a host that has already loaded
  // them (the suites) starts at once, in the same turn.
  // READY: window.__hkSplitReady['hk-weather'] is a promise that resolves once the parts have run (and rejects if they
  // never come), so a page that imports this file and uses it at once awaits it first (web/home.js imp, hk-loader).
  var PARTS = ['hk-weather-helpers.js', 'hk-weather-tile.js', 'hk-weather-header.js', 'hk-weather-status.js',
               'hk-weather-page.js', 'hk-weather-details.js', 'hk-weather-strip.js'];
  var PARTS_TRIES = 6;
  function partKey(file) { return file.replace(/\.js$/, ''); }
  function partsSettle(err) {
    var settle = (window.__hkSplitSettle || {})['hk-weather'];
    if (settle) settle(err);
  }
  // ONE FILE THAT DIDN'T COME (a tablet's Wi-Fi waking, the server restarting) used to leave the cards dead until a reload
  // (the third audit pass, WEB-11): the ones still missing are asked for again, a little later each time, at an address
  // of their own -- a browser keeps a failed module's answer for its address
  function loadParts(then, n) {
    // (the first call has no n; the retries and the finish pass it) a shell evaluated twice before its parts arrive
    // must not run them twice: the flag is set at once, not when the parts have run
    var started = window.__hkSplitStarted = window.__hkSplitStarted || {};
    if (n === undefined) {
      if (started['hk-weather']) return;
      started['hk-weather'] = true;
      var ready = new Promise(function (resolve, reject) {
        (window.__hkSplitSettle = window.__hkSplitSettle || {})['hk-weather'] = function (err) { if (err) reject(err); else resolve(); };
      });
      ready.catch(function () { /* the console says so; an importer that awaits it reports it */ });
      (window.__hkSplitReady = window.__hkSplitReady || {})['hk-weather'] = ready;
    }
    n = n || 0;
    var have = window.hkWeatherParts || {};
    var missing = PARTS.filter(function (file) { return !have[partKey(file)]; });
    if (!missing.length) {
      var failed = null;
      try { then(); } catch (err) { failed = err; console.error('[hk-weather] the parts did not start', err); }
      // (the checks that drive a page wait for every shell that started to say it is done)
      (window.__hkSplitDone = window.__hkSplitDone || {})['hk-weather'] = true;
      partsSettle(failed);
      return;
    }
    // (window.hkV: the build's ?v= on an address put together here, web/shim/base.js)
    Promise.all(missing.map(function (file) {
      var u = '/hk/weather/' + file, href = window.hkV ? window.hkV(u) : u;
      var got = n ? import(href + (href.indexOf('?') < 0 ? '?' : '&') + 'retry=' + n) : import(href);
      return got.catch(function (err) { return err; });
    })).then(function (got) {
      var err = got.filter(function (r) { return r instanceof Error; })[0];
      var left = PARTS.filter(function (file) { return !(window.hkWeatherParts || {})[partKey(file)]; });
      if (!left.length) { loadParts(then, n); return; }
      err = err || new Error(left[0] + ' ran without registering');
      if (n + 1 >= PARTS_TRIES) {
        console.error('[hk-weather] the parts did not start', err);
        partsSettle(err);
        // (given up: a later import of this file -- a page asking again at an address of its own -- starts over)
        delete started['hk-weather'];
        return;
      }
      console.warn('[hk-weather] a part did not load (' + err.message + '); again shortly');
      setTimeout(function () { loadParts(then, n + 1); }, Math.min(1000 * Math.pow(2, n), 15000));
    });
  }
  // ------------------------------------------------------------ end of the parts loader

  function boot() {
    var C = window.hkCards;
    if (!C || !C.HkBase) return false;
    var HkAlertCard, HkClockCard, HkHeaderCard, HkRadarCard, HkScreensaverStatusCard, HkWeatherBandCard,
        HkWeatherDetailsCard, HkWeatherStripCard, HkWeatherTileCard, markEntry, PAGE_METHODS, TILE_PAGE, wxEnter,
        wxLeave;
    function kit() {
      return {
        C: C
      };
    }
    function runParts() {
      var K = kit();
      PARTS.forEach(function (file) { window.hkWeatherParts[partKey(file)](K); });
      HkAlertCard = K.HkAlertCard; HkClockCard = K.HkClockCard; HkHeaderCard = K.HkHeaderCard;
      HkRadarCard = K.HkRadarCard; HkScreensaverStatusCard = K.HkScreensaverStatusCard;
      HkWeatherBandCard = K.HkWeatherBandCard; HkWeatherDetailsCard = K.HkWeatherDetailsCard;
      HkWeatherStripCard = K.HkWeatherStripCard; HkWeatherTileCard = K.HkWeatherTileCard; markEntry = K.markEntry;
      PAGE_METHODS = K.PAGE_METHODS; TILE_PAGE = K.TILE_PAGE; wxEnter = K.wxEnter; wxLeave = K.wxLeave;
    }

    loadParts(function () {
      runParts();

      // A card owns its sky; it never takes over the page's singleton sky.
      if (!customElements.get('hk-grid-weather-sky')) {
        customElements.define('hk-grid-weather-sky', class extends HTMLElement {
          constructor() {
            super(); this.attachShadow({ mode: 'open' });
            // Template nodes can receive their client before the browser
            // upgrades them when their parent card reaches the document.
            if (Object.prototype.hasOwnProperty.call(this, 'client')) {
              var pending = this.client; delete this.client; this._client = pending;
            }
          }
          set client(value) { this._client = value; this._update(); }
          connectedCallback() {
            if (super.connectedCallback) super.connectedCallback();
            this._visible = true;
            this._motion = matchMedia('(prefers-reduced-motion: reduce)');
            // (`still`: one frame of the sky, never running -- the Pages screen's
            // Weather icon, 2026-10-30: its conditions and time of day, drawn
            // again only as the weather changes)
            this._pause = () => {
              var S = window.hkSettings, moving = !S || !S.skyLook || S.skyLook().animations !== false;
              if (this._scene) this._scene.pause(this.hasAttribute('still') || document.hidden || !this._visible || this._motion.matches || !moving || !!window.hkSky.asleep());
            };
            document.addEventListener('visibilitychange', this._pause);
            window.addEventListener('hk-asleep', this._pause);
            this._refresh = () => this._update();
            window.addEventListener('hk-module-ready', this._refresh);
            this._motion.addEventListener('change', this._pause);
            if (typeof IntersectionObserver === 'function') {
              this._observer = new IntersectionObserver((entries) => { this._visible = entries[0].isIntersecting; this._pause(); });
              this._observer.observe(this);
            }
            this._update();
          }
          _update() {
            if (!this.isConnected || !this._client || !window.hkSky || !window.hkSky.scene) return;
            var entity = this.getAttribute('entity');
            if (this._scene && this._entity !== entity) { this._scene.destroy(); this._scene = null; }
            this._entity = entity;
            if (!this._scene) this._scene = window.hkSky.scene(this.shadowRoot, { skyOnly: true, entity: entity });
            this._scene.el.style.position = 'absolute';
            this._scene.update(this._client);
            if (this._pause) this._pause();
          }
          disconnectedCallback() {
            if (super.disconnectedCallback) super.disconnectedCallback();
            if (this._scene) this._scene.destroy(); this._scene = null;
            if (this._observer) this._observer.disconnect();
            document.removeEventListener('visibilitychange', this._pause);
            window.removeEventListener('hk-asleep', this._pause);
            window.removeEventListener('hk-module-ready', this._refresh);
            if (this._motion) this._motion.removeEventListener('change', this._pause);
          }
        });
      }
      window.hkShell.onNavigate(markEntry);
      window.addEventListener('popstate', markEntry);
      Object.keys(PAGE_METHODS).forEach(function (k) { HkWeatherBandCard.prototype[k] = PAGE_METHODS[k]; });
      Object.keys(TILE_PAGE).forEach(function (k) { HkWeatherTileCard.prototype[k] = TILE_PAGE[k]; });
      // the band's forecast plumbing, shared (one watch per card, released on leaving)
      ['_forecast', '_fcRelease', '_sources'].forEach(function (k) { HkWeatherDetailsCard.prototype[k] = HkWeatherBandCard.prototype[k]; });

      if (!customElements.get('hk-weather-strip-card')) {
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-weather-strip-card', HkWeatherStripCard);
        customElements.define('hk-weather-strip-card', HkWeatherStripCard);
      }
      if (!customElements.get('hk-clock-card')) {
        // its size in HA's Sections view (hk-base.js GRID)
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-clock-card', HkClockCard);
        customElements.define('hk-clock-card', HkClockCard);
      }
      if (C.editor) {
        var stag = C.editor('hk-weather-strip-card', [
          { name: 'entity', selector: { entity: { filter: { domain: 'weather' } } },
            helper: 'Default: the weather entity chosen in ' + window.hkShell.haPlace('HK Frontend -> Configure -> Weather') + '.' },
          C.section('Appearance', [
            { type: 'grid', name: '', schema: [
              { name: 'main_size', selector: { text: {} } },
              { name: 'detail_size', selector: { text: {} } },
              { name: 'glyph_size', selector: { text: {} } },
              { name: 'gap', selector: { text: {} } },
              { name: 'color', selector: { text: {} } },
              { name: 'dim_color', selector: { text: {} } },
              { name: 'shadow', selector: { text: {} }, helper: 'A CSS filter, e.g. drop-shadow(0 1px 6px rgba(0,0,0,.4)), or none.' },
              { name: 'margin', selector: { text: {} } }
            ] }
          ], 'mdi:palette'),
          C.section('Interactions', [
            { name: 'tap_action', selector: { ui_action: {} } }
          ], 'mdi:gesture-tap')
        ]);
        HkWeatherStripCard.getConfigElement = function () { return document.createElement(stag); };
        var ctag = C.editor('hk-clock-card', [
          { name: 'date_format', selector: window.hkCards.selOptions(['weekday', 'monthday']) },
          C.section('Appearance', [
            { type: 'grid', name: '', schema: [
              { name: 'time_size', selector: { text: {} } },
              { name: 'ampm_size', selector: { text: {} } },
              { name: 'date_size', selector: { text: {} } },
              { name: 'color', selector: { text: {} } },
              { name: 'date_color', selector: { text: {} } },
              { name: 'shadow', selector: { boolean: {} } },
              { name: 'time_line_height', selector: { text: {} } }
            ] }
          ], 'mdi:palette'),
          C.section('Layout', [
            { type: 'grid', name: '', schema: [
              { name: 'height', selector: { text: {} } },
              { name: 'padding', selector: { text: {} } },
              { name: 'margin', selector: { text: {} } },
              { name: 'gap', selector: { text: {} } }
            ] }
          ], 'mdi:ruler')
        ]);
        HkClockCard.getConfigElement = function () { return document.createElement(ctag); };
      }
      window.customCards = window.customCards || [];
      window.customCards.push({
        type: 'hk-weather-strip-card', name: 'HK Weather Strip',
        description: 'The current temperature and conditions, as on the wall header.', preview: true
      });
      window.customCards.push({
        type: 'hk-clock-card', name: 'HK Clock',
        description: 'The time and date, as on the wall header.', preview: true
      });

      if (!customElements.get('hk-weather-band-card')) {
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-weather-band-card', HkWeatherBandCard);
        customElements.define('hk-weather-band-card', HkWeatherBandCard);
      }
      if (C.editor) {
        var etag = C.editor('hk-weather-band-card', [
          { name: 'entity', required: true, label: 'Weather entity', selector: { entity: { filter: { domain: 'weather' } } } },
          { type: 'grid', name: '', schema: [
            { name: 'hours', selector: { number: { min: 1, max: 24, mode: 'box' } } },
            { name: 'days', selector: { number: { min: 1, max: 10, mode: 'box' } } },
            { name: 'place', selector: { text: {} } }
          ] },
          C.section('Layout', [
            { type: 'grid', name: '', schema: [
              { name: 'min_hour_col', selector: { number: { min: 20, max: 120, mode: 'box' } } },
              { name: 'min_day_col', selector: { number: { min: 20, max: 160, mode: 'box' } } },
              { name: 'now_width', selector: { number: { min: 120, max: 400, mode: 'box' } } }
            ] },
            { name: 'plain', selector: { boolean: {} } },
            { name: 'narrow', selector: { boolean: {} } }
          ], 'mdi:ruler'),
          C.section('Interactions', [
            { name: 'tap_action', selector: { ui_action: {} } }
          ], 'mdi:gesture-tap')
        ]);
        HkWeatherBandCard.getConfigElement = function () {
          return document.createElement(etag);
        };
      }
      HkWeatherBandCard.getStubConfig = function (input) {
        return { entity: C.firstOf(C.asClient(input), 'weather'), hours: 12, days: 8 };
      };
      // Without a stub the card picker previews the clock and weather strip
      // empty.
      if (!Object.prototype.hasOwnProperty.call(HkClockCard, 'getStubConfig')) {
        HkClockCard.getStubConfig = function () { return {}; };
      }
      if (!Object.prototype.hasOwnProperty.call(HkWeatherStripCard, 'getStubConfig')) {
        HkWeatherStripCard.getStubConfig = function (input) { return { entity: C.firstOf(C.asClient(input), 'weather') }; };
      }
      window.customCards = window.customCards || [];
      window.customCards.push({
        type: 'hk-weather-band-card', name: 'HK Weather Band',
        description: 'Current conditions with an hourly and a daily forecast.',
        preview: true
      });
      if (!customElements.get('hk-alert-card')) {
        // its size in HA's Sections view (hk-base.js GRID)
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-alert-card', HkAlertCard);
        customElements.define('hk-alert-card', HkAlertCard);
      }
      if (!customElements.get('hk-screensaver-status-card')) {
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-screensaver-status-card', HkScreensaverStatusCard);
        customElements.define('hk-screensaver-status-card', HkScreensaverStatusCard);
        // NOT IN THE CARD PICKER: the screensaver's own (pinned top-right at
        // no height; on a dashboard's page it floats over Home Assistant).
        // Defined, so the screensaver and YAML that names it keep working.
      }
      if (C.editor) {
        var sstag = C.editor('hk-screensaver-status-card', [
          { type: 'grid', name: '', schema: [
            { name: 'line1_size', label: 'First line size', helper: 'Default 36px.', selector: { text: {} } },
            { name: 'line_size', label: 'Other lines size', helper: 'Default 24px.', selector: { text: {} } }
          ] }
        ]);
        HkScreensaverStatusCard.getConfigElement = function () { return document.createElement(sstag); };
      }
      HkScreensaverStatusCard.getStubConfig = function () { return {}; };
      if (C.editor) {
        var atag = C.editor('hk-alert-card', [
          { name: 'entity', required: true, label: 'Alerts sensor',
            helper: 'The NWS Alerts sensor. The card shows only while an alert is active.',
            selector: { entity: { filter: { integration: 'nws_alerts', domain: 'sensor' } } } },
          { type: 'grid', name: '', schema: [
            { name: 'title', selector: { text: {} } },
            { name: 'source', selector: { text: {} } },
            { name: 'icon', selector: { icon: {} } }
          ] }
        ]);
        HkAlertCard.getConfigElement = function () { return document.createElement(atag); };
      }
      HkAlertCard.getStubConfig = function () {
        var HS = window.hkSettings;
        return { entity: (HS && HS.get('weather.alerts', null)) || '' };
      };
      window.customCards.push({
        type: 'hk-alert-card', name: 'HK Weather Alert',
        description: 'Shows active severe-weather alerts from the NWS Alerts integration.',
        preview: true
      });

      if (!customElements.get('hk-header-card')) {
        // its size in HA's Sections view (hk-base.js GRID)
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-header-card', HkHeaderCard);
        customElements.define('hk-header-card', HkHeaderCard);
      }
      if (C.editor) {
        var htag = C.editor('hk-header-card', [
          { type: 'grid', name: '', schema: [ // tapping each half opens a page
            { name: 'weather_path', selector: { text: {} } },
            { name: 'alarm_path', selector: { text: {} } }
          ] }
        ]);
        HkHeaderCard.getConfigElement = function () { return document.createElement(htag); };
      }
      HkHeaderCard.getStubConfig = function () { return {}; };
      window.customCards.push({
        type: 'hk-header-card', name: 'HK Wall Header',
        description: 'The wall tablet header: clock, date and weather, with the security summary.',
        preview: true
      });

      if (!customElements.get('hk-radar-card')) {
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-radar-card', HkRadarCard);
        customElements.define('hk-radar-card', HkRadarCard);
      }
      HkRadarCard.getStubConfig = function () { return {}; };
      if (C.editor) {
        var rtag = C.editor('hk-radar-card', [
          { name: 'note', selector: { constant: { label: 'Set up under HK Settings → Weather → Radar Map', value: '' } } }
        ]);
        HkRadarCard.getConfigElement = function () { return document.createElement(rtag); };
      }
      window.customCards.push({
        type: 'hk-radar-card', name: 'HK Radar',
        description: 'The precipitation radar map, as on the Weather page (HK Settings → Weather → Radar Map).', preview: false
      });
      if (!customElements.get('hk-weather-details-card')) {
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-weather-details-card', HkWeatherDetailsCard);
        customElements.define('hk-weather-details-card', HkWeatherDetailsCard);
      }
      HkWeatherDetailsCard.getStubConfig = function (input) { return { entity: C.firstOf(C.asClient(input), 'weather') }; };
      if (C.editor) {
        var dtag = C.editor('hk-weather-details-card', [
          { name: 'entity', label: 'Weather entity', selector: { entity: { filter: { domain: 'weather' } } },
            helper: 'Default: the weather service chosen in HK Settings → Weather. Which tiles, and their order: Forecast & Details there.' }
        ]);
        HkWeatherDetailsCard.getConfigElement = function () { return document.createElement(dtag); };
      }
      window.customCards.push({
        type: 'hk-weather-details-card', name: 'HK Weather Details',
        description: 'The Weather page’s detail tiles: wind, sunrise, UV, humidity, moon and pressure.', preview: true
      });
      if (!customElements.get('hk-weather-tile-card')) {
        if (window.hkCards && window.hkCards.sized) window.hkCards.sized('hk-weather-tile-card', HkWeatherTileCard);
        customElements.define('hk-weather-tile-card', HkWeatherTileCard);
      }
      if (C.editor) {
        var wtag = C.editor('hk-weather-tile-card', [
          { name: 'variant', required: true, label: 'Shows',
            selector: C.selOptions(['wind', 'sun', 'moon', 'uv', 'humidity', 'pressure']) },
          { name: 'look', selector: C.selOptions(['tile', 'page']), helper: 'page: the Weather page’s detail tile.' },
          { name: 'caption', selector: { text: {} }, helper: 'Replaces the heading, e.g. WIND.' },
          C.section('Sensors', [
            { type: 'grid', name: '', schema: [
              { name: 'entity', label: 'Weather entity', selector: { entity: { filter: { domain: 'weather' } } } },
              { name: 'speed', selector: { entity: { filter: { domain: 'sensor' } } } },
              { name: 'gust', selector: { entity: { filter: { domain: 'sensor' } } } },
              { name: 'sun', selector: { entity: { filter: { domain: 'sun' } } } },
              { name: 'phase', selector: { entity: { filter: { domain: 'sensor' } } } },
              { name: 'uv', selector: { entity: { filter: { domain: 'sensor' } } } }
            ] }
          ], 'mdi:weather-partly-cloudy', true),
          C.section('Interactions', [
            { name: 'tap_action', selector: { ui_action: {} } }
          ], 'mdi:gesture-tap')
        ]);
        HkWeatherTileCard.getConfigElement = function () {
          return document.createElement(wtag);
        };
      }
      HkWeatherTileCard.getStubConfig = function () {
        var HS = window.hkSettings;
        return { variant: 'uv', uv: (HS && HS.get('weather.uv', null)) || '' };
      };
      window.customCards.push({
        type: 'hk-weather-tile-card', name: 'HK Weather Tile',
        description: 'A small tile for wind, sunrise and sunset, the moon, or the UV index.',
        preview: true
      });

      window.hkWeather = { version: '1.4.0', HkWeatherBandCard: HkWeatherBandCard,
        HkWeatherStripCard: HkWeatherStripCard, HkClockCard: HkClockCard,
        HkWeatherTileCard: HkWeatherTileCard, HkHeaderCard: HkHeaderCard, HkAlertCard: HkAlertCard,
        HkWeatherDetailsCard: HkWeatherDetailsCard, HkRadarCard: HkRadarCard, wxEnter: wxEnter, wxLeave: wxLeave,
        HkScreensaverStatusCard: HkScreensaverStatusCard };
    });

    return true;
  }

  // Same rule as every other card file here: hk-base.js is a parallel-loaded
  // resource, so wait for its READY EVENT rather than polling. rAF never fires
  // in a hidden tab, which is where a wall tablet spends most of its life.
  if (!boot()) window.addEventListener('hk-cards-ready', boot, { once: true });
})();

// =============================================================== THE SHEET
// THE WEATHER SHEET (hk-detail.js kind `weather`, 2026-10-16): what a tap on
// the weather opens -- the Climate page's Outside & Ahead, a chip, a tile --
// in place of Home Assistant's dialog. HK's sizes and spacing (hk-detail.js
// SP, DESIGN.md), the Weather page's glyphs and numbers.
//
// Two columns on a tablet (the WIDE sheet), one on a phone:
//   now      the selected day's summary (Today uses the house's outside
//            sensor when Configure -> Weather names one, as the band reads
//            it), the condition, feels-like and today's high and low; then
//            the conditions: humidity, wind and its direction, UV, pressure,
//            visibility, dew point, sunrise and sunset
//   ahead    the coming days, each a selectable row on one temperature scale.
// The hourly chart and conditions follow the selected day; neither entry
// point prepends a second overview. Metric tiles replace the hourly section.
// The forecast is the house's forecast sensors when Configure -> Weather has
// them, else weather/subscribe_forecast, dropped when the sheet closes.
(function () {
  'use strict';
  function whenDetail(fn) {
    if (window.hkDetail && window.hkDetail._) return fn(window.hkDetail);
    window.addEventListener('hk-detail-ready', function () { if (window.hkDetail) fn(window.hkDetail); }, { once: true });
  }
  whenDetail(function (X) {
    if (customElements.get('hk-detail-weather')) return;
    var U = X._, C = window.hkCards, esc = C.esc, SP = U.SP, v = C.v, P = C.PALETTE.icon;
    function num(x) { if (x === null || x === undefined || x === '') return null; var n = Number(x); return isFinite(n) ? n : null; }
    function H() { return window.hkHeader || {}; }
    function glyph(cond, px, night) {
      var h = H();
      return h.wxSvg ? h.wxSvg(cond, px, { night: night }) : '<span style="display:inline-block;width:' + px + 'px;height:' + px + 'px"></span>';
    }
    function hs(k) { var S = window.hkSettings; return S ? S.get('weather.' + k, null) : null; }
    function hr(t) { var d = new Date(t), h = d.getHours(); return (h % 12 || 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }
    function hm(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
    var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    function compass(deg) { return deg == null ? '' : COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }
    function uvWord(u) { return u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very High' : 'Extreme'; }
    var SHEET_PLOT_H = 80;
    // the days from today on (a sensor can still lead with yesterday)
    function upcoming(list) {
      var d0 = new Date(Date.now()); d0.setHours(0, 0, 0, 0);
      return (list || []).filter(function (d) { var t = Date.parse(d.datetime); if (!isFinite(t)) return true; var x = new Date(t); x.setHours(0, 0, 0, 0); return x >= d0; });
    }

    var CSS = [
      ':host{display:block;color:' + v('ink') + '}',
      '.wp{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:' + SP.region + 'px;align-items:start}',
      '.col{display:flex;flex-direction:column;gap:' + SP.block + 'px;min-width:0}',
      // TWO COLUMNS FILL THE SHEET (2026-11-07, the review; HomeView's Weather: the place's temperature centered, large, the condition and the day's range under it): the summary takes what
      // the hours and conditions leave, its reading centered in it; the days share the right column's height
      '.wp.one{grid-template-columns:minmax(0,1fr)}' +
        '.wp:not(.one){flex:1;min-height:0;align-items:stretch}.wp:not(.one) .wx-summary,.wp:not(.one) .wx-days,.wp:not(.one) .dys{flex:1;display:flex;flex-direction:column;min-height:0}' +
          '.wp:not(.one) .reading{flex:1;flex-direction:column;justify-content:center;text-align:center;gap:2px;margin-top:0}.wp:not(.one) .reading .t{font-size:56px;line-height:60px}' +
          '.wp:not(.one) .dy{flex:1 1 0;min-height:44px}',
      '.wx-section{' + C.plate('card') + ';border-radius:' + SP.cardR + 'px;padding:' + SP.cardPad + ';background:' + v('key') +
        ';box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;min-width:0}',
      '.lab{display:flex;justify-content:space-between;align-items:baseline;gap:' + SP.block + 'px;' + C.labelCss('label') + ';line-height:16px;margin:0}',
      '.lab .n{text-transform:none;letter-spacing:0;font-size:13px;font-weight:500;text-align:right}',
      '.reading{display:flex;align-items:center;gap:' + SP.block + 'px;margin-top:' + SP.block + 'px}',
      '.reading>svg{flex:none}.reading .t{' + C.figureCss('hero') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.reading .w{min-width:0}.reading .w b{display:block;font-size:17px;font-weight:600;line-height:22px}',
      '.reading .w span{display:block;font-size:13px;line-height:20px;color:' + v('ink-2') + '}',
      '.gr,.kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + SP.block + 'px 16px;margin-top:' + SP.block + 'px}',
      '.gr{row-gap:' + SP.line + 'px}',
      '.gr .k,.kv .k{' + C.labelCss('label-small') + '}',
      '.gr .x,.kv .x{font-size:17px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
      '.gr .x small{font-size:13px;font-weight:500;color:' + v('ink-2') + ';margin-left:4px}',
      '.dys{margin-top:' + SP.block + 'px}',
      '.dy{display:grid;grid-template-columns:48px 26px 30px 30px minmax(0,1fr) 30px;align-items:center;gap:8px;width:100%;min-height:48px;',
      '  box-sizing:border-box;padding:8px ' + SP.block + 'px;border:0;border-top:1px solid ' + v('line') + ';background:transparent;color:' + v('ink') +
        ';font:inherit;cursor:pointer;text-align:left;border-radius:0}',
      '.dy:first-child{border-top-color:transparent}.dy>svg{display:block}',
      '.dy[aria-pressed="true"]{background:' + v('key-strong') + ';border-radius:' + C.R.inner + 'px;border-top-color:transparent}',
      '.dy[aria-pressed="true"]+ .dy{border-top-color:transparent}',
      '.dy .d,.dy .lo,.dy .hi{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.dy .lo,.dy .hi{text-align:right}.dy .lo{color:' + v('ink-2') + '}',
      '.dy .p{font-size:11px;font-weight:600;color:var(--hk-wx-c,#64D2FF);font-variant-numeric:tabular-nums}',
      '.rg{position:relative;height:6px;border-radius:3px;background:' + v('line-strong') + '}',
      '.rg i{position:absolute;top:0;bottom:0;border-radius:inherit;background:linear-gradient(90deg,#64d2ff,#ffd60a,#ff9f0a)}',
      '.rg b{position:absolute;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:' + v('ink') + ';box-shadow:0 0 0 2px ' + v('key') + '}',
      '.none{font-size:13px;line-height:20px;color:' + v('ink-2') + ';padding:' + SP.block + 'px 0}',
      '.fc .fx{display:flex;align-items:baseline;gap:8px;margin-top:' + SP.block + 'px}',
      '.fc .fx b{' + C.figureCss('figure-l') + ';font-variant-numeric:tabular-nums}',
      '.fc .fx span{font-size:15px;font-weight:600;color:' + v('ink-2') + '}',
      '.fc .ch{position:relative;margin-top:' + SP.block + 'px;outline:none;touch-action:pan-y}',
      '.fc .ch svg{display:block;width:100%;height:' + SHEET_PLOT_H + 'px}',
      '.fc .ch line[data-i]{opacity:0}.fc .ch line[data-i].hit{opacity:1}',
      '.fc .ch:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:4px;border-radius:' + C.R.small + 'px}',
      '.fc .ax{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:' + v('ink-3') + ';margin-top:4px}',
      '.fc .rd{font-size:13px;font-weight:500;color:' + v('ink-2') + ';margin-top:8px;min-height:18px}',
      '.fc .tx{font-size:14px;line-height:1.45;color:' + v('ink-2') + ';margin:' + SP.block + 'px 0 0}',
      '@media(max-width:' + C.BP.phone + 'px){.wp{gap:' + SP.block + 'px}.reading .t{font-size:36px}.dy{grid-template-columns:44px 24px 28px 28px minmax(0,1fr) 28px;gap:6px}}'
    ].join('');

    class WeatherPanel extends U.Panel {
      static get CSS() { return U.PANEL_CSS + CSS; }
      hkWidthKind() { return 'weather'; }
      hkNoGear() { return true; }
      hkFill() { return true; }
      // the header: the condition's own glyph on a plain well, "Weather" and the place
      hkHead(h, d) {
        var s = h.states[d.id];
        if (!s) return false;
        d.well.style.background = 'rgba(255,255,255,0.12)';
        var night = !!(H().isNight && H().isNight(h.states));
        var sig = s.state + '|' + night;
        if (d.wellSig !== sig) { d.wellSig = sig; d.well.innerHTML = glyph(s.state, 28, night); }
        // the place's last part ("HOME · SPRINGFIELD" -> "Springfield"), else Weather
        var place = String(hs('place') || '').split('·').pop().trim();
        d.tt.textContent = place ? place.replace(/\b(\w)(\w*)/g, function (m, a, b) { return a + b.toLowerCase(); }) + ' Weather' : 'Weather';
        return true;
      }
      _ids() {
        return [this._id, 'sun.sun', hs('outside'), hs('feels_like'), hs('humidity'), hs('wind'), hs('uv'), hs('forecast_hourly'), hs('forecast_daily')]
          .filter(Boolean);
      }
      _sigOf() {
        var h = this.client;
        if (!h) return null;
        return (this._fcN || 0) + '|' + Math.floor(Date.now() / 60e3) + '|' + this._ids().map(function (id) {
          var s = h.states[id]; return s ? s.last_updated : '-';
        }).join(',');
      }
      // the forecast: the house's sensor, else the shared subscription
      // (hkWxForecast) while open -- the Weather page's own, when the sheet
      // opens over it
      _fc(kind) {
        var sid = hs('forecast_' + kind), h = this.client, port = this.client && this.client.subscriptions;
        if (sid && h.states[sid]) return (h.states[sid].attributes || {}).forecast || [];
        this._ws = this._ws || {};
        var w = this._ws[kind];
        if (w && w.conn !== port) { w.release(); w = this._ws[kind] = null; }
        if (!w && port && this.isConnected && window.hkWxForecast) {
          var self = this;
          w = this._ws[kind] = window.hkWxForecast.watch(port, kind, this._id, function () {
            self._fcN = (self._fcN || 0) + 1;
            if (self.client) self.redraw();
          });
        } else if (w) w.ensure();
        return w ? w.data() : [];
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        var ws = this._ws || {};
        Object.keys(ws).forEach(function (k) { if (ws[k]) ws[k].release(); });
        this._ws = {};
      }
      _read(sensorKey, attr) {
        var h = this.client, id = hs(sensorKey), s = this._stateObj, a = (s && s.attributes) || {};
        var x = id && h.states[id] ? num(h.states[id].state) : null;
        return x != null ? x : num(a[attr]);
      }
      _render() {
        var h = this.client, s = this._stateObj;
        if (!h || !s) return;
        var self = this, a = s.attributes || {}, now = Date.now(), states = h.states;
        var one = matchMedia('(max-width:' + C.BP.phone + 'px)').matches;
        var src = this._src, days = upcoming(this._fc('daily')).slice(0, 10);
        var todayKey = new Date(now).toDateString();
        if (this._dayKey == null) {
          var initial = src.focus === 'day' && days[Number(src.day) || 0];
          this._dayKey = initial ? new Date(initial.datetime).toDateString() : todayKey;
          this._metric = src.focus && src.focus !== 'day' ? src.focus : '';
        }
        var selected = days.filter(function (d) { return new Date(d.datetime).toDateString() === self._dayKey; })[0];
        if (!selected && this._dayKey !== todayKey) this._dayKey = todayKey;
        var current = this._dayKey === todayKey;
        var dayName = current ? 'Today' : new Date(selected.datetime).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long', month: 'short', day: 'numeric' }));
        var allHours = this._fc('hourly').filter(function (f) { return Date.parse(f.datetime) + 3600e3 > now; });
        var hrs = current ? allHours.slice(0,24) : allHours.filter(function (f) { return new Date(f.datetime).toDateString() === self._dayKey; });
        var t = this._read('outside', 'temperature'), feels = this._read('feels_like', 'apparent_temperature');
        var hi = selected && num(selected.temperature), lo = selected && num(selected.templow);
        var condition = current ? s.state : selected.condition;
        if (!current && condition === 'clear-night') condition = 'sunny';
        var cond = H().conditionName ? H().conditionName(condition) : condition;
        var night = current && !!(H().isNight && H().isNight(states));
        var range = (hi != null ? 'High ' + Math.round(hi) + '°' : '') + (hi != null && lo != null ? ' · ' : '') + (lo != null ? 'Low ' + Math.round(lo) + '°' : '');
        var summary = '<section class="wx-section wx-summary"><div class="lab">' + esc(dayName) + '</div><div class="reading">' + glyph(condition,48,night) +
          '<div class="t">' + (num(current ? t : hi) != null ? Math.round(current ? t : hi) + '°' : '—') + '</div><div class="w"><b>' + esc(cond || 'Forecast') + '</b>' +
          (current && feels != null ? '<span>Feels like ' + Math.round(feels) + '°</span>' : '') + (range ? '<span>' + esc(range) + '</span>' : '') + '</div></div></section>';
        var ws = a.wind_speed_unit || window.hkLocale.units().speed, ps = a.pressure_unit || '', vs = a.visibility_unit || '';
        var hum = current ? this._read('humidity','humidity') : num(selected.humidity);
        var wind = current ? this._read('wind','wind_speed') : num(selected.wind_speed);
        var bearing = current ? num(a.wind_bearing) : num(selected.wind_bearing);
        var uv = current ? this._read('uv','uv_index') : num(selected.uv_index);
        var cells = [
          ['Humidity', hum != null ? Math.round(hum) + '%' : null],
          ['Wind', wind != null ? Math.round(wind) + '<small>' + esc(ws) + (bearing != null ? ' ' + compass(bearing) : '') + '</small>' : null],
          ['UV Index', uv != null ? Math.round(uv) + '<small>' + uvWord(uv) + '</small>' : null],
          ['Chance of Rain', !current && num(selected.precipitation_probability) != null ? Math.round(num(selected.precipitation_probability)) + '%' : null]
        ];
        if (current) {
          var sun = states['sun.sun'], sa = sun && sun.attributes || {}, set = Date.parse(sa.next_setting), rise = Date.parse(sa.next_rising);
          cells = cells.concat([
            ['Dew Point', num(a.dew_point) != null ? Math.round(num(a.dew_point)) + '°' : null],
            ['Pressure', num(a.pressure) != null ? num(a.pressure) + '<small>' + esc(ps) + '</small>' : null],
            ['Visibility', num(a.visibility) != null ? num(a.visibility) + '<small>' + esc(vs) + '</small>' : null],
            ['Sunset', isFinite(set) ? hm(set) : null], ['Sunrise', isFinite(rise) ? hm(rise) : null]
          ]);
        }
        cells = cells.filter(function (c) { return c[1] != null; });
        var conditions = cells.length ? '<section class="wx-section"><div class="lab">' + (current ? 'Current Conditions' : 'Daytime Conditions') + '</div><div class="gr">' + cells.map(function(c) {
          return '<div><div class="k">' + c[0] + '</div><div class="x">' + c[1] + '</div></div>';
        }).join('') + '</div></section>' : '';
        var pts = hrs.map(function (f) { return {t:f.datetime,v:num(f.temperature)}; }).filter(function(p) {return p.v != null;});
        var focus = this._metric ? this._focus(h,s,allHours,days) : {
          series: pts.length>1 ? pts : null, say: function(i) {return hr(Date.parse(pts[i].t)) + ' · ' + Math.round(pts[i].v) + '°';},
          rest: 'Touch or hover to read an hour'
        };
        var hours = this._metric ? focus.html : '<section class="wx-section fc"><div class="lab"><span>' + (current ? 'Next 24 Hours' : 'Hourly Forecast') + '</span><span class="n">' +
          (hrs.length ? esc(this._hoursWords(hrs)) : '') + '</span></div>' + (pts.length>1 ? this._chart(pts) : '<div class="none">' +
          (current ? 'Hourly forecast is not available yet.' : 'Hourly forecast is not available for this day.') + '</div>') + '</section>';
        var lows = days.map(function(d) {return num(d.templow);}), highs = days.map(function(d) {return num(d.temperature);});
        var values = lows.concat(highs).filter(function(x) {return x != null;});
        var mn = Math.min.apply(null,values), mx = Math.max.apply(null,values), span = Math.max(1,mx-mn);
        var pct = function(x) {return ((x-mn)/span*100).toFixed(1);};
        var forecast = '<section class="wx-section wx-days"><div class="lab">' + (days.length ? days.length + '-Day Forecast' : 'Forecast') + '</div><div class="dys">' +
          (days.length ? days.map(function(d,i) {
            var dh=num(d.temperature),dl=num(d.templow),pop=num(d.precipitation_probability),key=new Date(d.datetime).toDateString();
            var name=key===todayKey ? 'Today' : new Date(d.datetime).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({weekday:'short'}));
            var dot=key===todayKey&&t!=null&&dl!=null&&dh!=null ? '<b style="left:'+pct(Math.max(mn,Math.min(mx,t)))+'%"></b>' : '';
            return '<button class="dy" type="button" data-day="'+i+'" aria-pressed="'+(key===self._dayKey)+'" aria-label="'+
              esc(new Date(d.datetime).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({weekday:'long',month:'short',day:'numeric'})))+'">'+
              '<span class="d">'+name+'</span>'+glyph(d.condition==='clear-night'?'sunny':d.condition,24,false)+'<span class="p">'+(pop>=20?Math.round(pop)+'%':'')+'</span>'+
              '<span class="lo">'+(dl!=null?Math.round(dl)+'°':'—')+'</span><span class="rg">'+(dl!=null&&dh!=null?'<i style="left:'+pct(dl)+'%;right:'+(100-pct(dh))+'%"></i>'+dot:'')+'</span>'+
              '<span class="hi">'+(dh!=null?Math.round(dh)+'°':'—')+'</span></button>';
          }).join('') : '<div class="none">Daily forecast is not available yet.</div>') + '</div></section>';
        this._root.innerHTML = '<div class="wp' + (one?' one':'') + '"><div class="col c1">'+summary+hours+conditions+'</div><div class="col c2">'+forecast+'</div></div>';
        this._daysShown = days;
        if (!this._dayBound) {
          this._dayBound = true;
          this._root.addEventListener('click',function(e) {
            var row=e.target.closest && e.target.closest('[data-day]');
            if (!row) return;
            var day=self._daysShown[Number(row.getAttribute('data-day'))];
            if (!day) return;
            var focused=self.shadowRoot && self.shadowRoot.activeElement===row;
            self._dayKey=new Date(day.datetime).toDateString();self._metric='';self._render();
            var next=self._root.querySelector('[data-day="'+row.getAttribute('data-day')+'"]');
            if (focused && next) next.focus({preventScroll:true});
          });
        }
        if (focus.series) this._scrubFocus(focus);
      }
      _chart(pts) {
        if (pts.length < 2) return '';
        var vs = pts.map(function (p) { return p.v; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), sp = (hi - lo) || 1;
        var X = function (i) { return (i / (pts.length - 1) * 600).toFixed(1); }, Y = function (val) { return (100 - (val - lo) / sp * 86).toFixed(1); };
        var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Y(p.v); }).join(' ');
        return '<div class="ch"><svg viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">' +
          '<path d="M0 14H600M0 57H600M0 100H600" style="stroke:' + v('line') + '" fill="none" vector-effect="non-scaling-stroke"/>' +
          '<path d="' + path + '" fill="none" style="stroke:var(--hk-wx-c,#64D2FF)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
          pts.map(function (p, i) { return '<line data-i="' + i + '" x1="' + X(i) + '" x2="' + X(i) + '" y1="0" y2="110" style="stroke:' + v('ink-2') + '" vector-effect="non-scaling-stroke"/>';
            }).join('') +
          '</svg><div class="ax"><span>' + (pts[0] ? hr(Date.parse(pts[0].t)) : '') + '</span><span>' + hr(Date.parse(pts[Math.floor(pts.length / 2)].t)) +
          '</span><span>' + hr(Date.parse(pts[pts.length - 1].t)) + '</span></div><div class="rd"></div></div>';
      }

      // THE FOCUS: a metric tile (wind, sun, uv, humidity, moon or pressure) -- that
      // reading's figure, its next hours from the forecast as a line, and a
      // line about it. { html, series, say, rest } ('' when there is none).
      _focus(h, s, hrs, days) {
        var src = (this._config && this._config.src) || {}, f = this._metric != null ? this._metric : src.focus, a = s.attributes || {};
        if (!f) return { html: '' };
        var self = this, wsU = a.wind_speed_unit || window.hkLocale.units().speed, pU = a.pressure_unit || '';
        var card = function (title, sub, fig, unit, chart, text, extra) {
          return '<section class="wx-section fc"><div class="lab"><span>' + esc(title) + '</span>' + (sub ? '<span class="n">' + esc(sub) + '</span>' : '') + '</div>' +
            '<div class="fx"><b>' + fig + '</b>' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</div>' + (chart || '') + (extra || '') +
            (text ? '<p class="tx">' + esc(text) + '</p>' : '') + '</section>';
        };
        var series = function (key, list) {
          return (list || hrs.slice(0, 24)).map(function (x) { return { t: x.datetime, v: num(x[key]) }; }).filter(function (p) { return p.v != null; });
        };
        var chart = function (pts) { return self._chart(pts); };
        var out = { html: '' };
        var make = function (title, fig, unit, key, fmt, text, sub) {
          var pts = series(key);
          out.html = card(title, sub || (pts.length > 1 ? 'Next ' + pts.length + ' Hours' : ''), fig, unit, chart(pts), text);
          if (pts.length > 1) {
            out.series = pts;
            out.say = function (i) { return hr(Date.parse(pts[i].t)) + ' · ' + fmt(pts[i].v); };
            out.rest = 'Touch or hover the line to read an hour';
          }
          return out;
        };
        if (f === 'wind') {
          var w = this._read('wind', 'wind_speed'), gusts = series('wind_gust_speed'), gx = gusts.length ? gusts.reduce(function (m, p) { return p.v > m.v ? p : m; }) : null;
          return make('Wind', w != null ? String(Math.round(w)) : '—', wsU + (a.wind_bearing != null ? ' · from the ' + compass(num(a.wind_bearing)) : ''), 'wind_speed',
            function (x) { return Math.round(x) + ' ' + wsU; }, gx ? 'Gusts up to ' + Math.round(gx.v) + ' ' + wsU + ' around ' + hr(Date.parse(gx.t)) + '.' : '');
        }
        if (f === 'uv') {
          var u = this._read('uv', 'uv_index');
          if (u == null) { var u0 = series('uv_index')[0]; u = u0 ? u0.v : null; }
          var pk = series('uv_index').slice(0, 14);
          var top = pk.length ? pk.reduce(function (m, p) { return p.v > m.v ? p : m; }) : null;
          return make('UV Index', u != null ? String(Math.round(u)) : '—', u != null ? uvWord(u) : '', 'uv_index', function (x) { return Math.round(x) + ' ' + uvWord(x); },
            top && top.v >= 3 ? 'Highest around ' + hr(Date.parse(top.t)) + ' at ' + Math.round(top.v) + '. Shade and sunscreen from 3.' : 'Low for the hours ahead.');
        }
        if (f === 'humidity') {
          var hu = this._read('humidity', 'humidity');
          return make('Humidity', hu != null ? Math.round(hu) + '%' : '—', '', 'humidity', function (x) { return Math.round(x) + '%'; },
            num(a.dew_point) != null ? 'The dew point is ' + Math.round(num(a.dew_point)) + '° right now: the higher it is, the muggier it feels.' : '');
        }
        if (f === 'pressure') {
          var pr = num(a.pressure), inhg = /inhg/i.test(pU);
          return make('Pressure', pr != null ? (inhg ? pr.toFixed(2) : String(Math.round(pr))) : '—', pU, 'pressure',
            function (x) { return (inhg ? x.toFixed(2) : Math.round(x)) + ' ' + pU; },
            'Falling pressure often brings clouds and rain; rising pressure, clearer skies. The line is the forecast.');
        }
        if (f === 'sun') {
          var sun = h.states['sun.sun'], sa = (sun && sun.attributes) || {};
          var rise = Date.parse(sa.next_rising), set = Date.parse(sa.next_setting), up = sun && sun.state === 'above_horizon';
          out.html = card(up ? 'Sunset' : 'Sunrise', '', isFinite(up ? set : rise) ? hm(up ? set : rise) : '—', '', '',
            sun ? 'The sun is ' + Math.abs(Math.round(num(sa.elevation) || 0)) + '° ' + (num(sa.elevation) >= 0 ? 'above' : 'below') + ' the horizon.' : 'Needs Home Assistant’s Sun.',
            '<div class="kv"><div><div class="k">Next Sunrise</div><div class="x">' + (isFinite(rise) ? hm(rise) : '—') + '</div></div>' +
            '<div><div class="k">Next Sunset</div><div class="x">' + (isFinite(set) ? hm(set) : '—') + '</div></div>' +
            (sa.next_dawn ? '<div><div class="k">Dawn</div><div class="x">' + hm(sa.next_dawn) + '</div></div>' : '') +
            (sa.next_dusk ? '<div><div class="k">Dusk</div><div class="x">' + hm(sa.next_dusk) + '</div></div>' : '') + '</div>');
          return out;
        }
        if (f === 'moon') {
          var HS = window.hkSettings, ph = HS && HS.moon ? HS.moon(h.states) : null;
          if (ph == null) return out;
          var il = Math.round((1 - Math.cos(2 * Math.PI * ph)) / 2 * 100);
          var full = new Date(Date.now() + ((0.5 - ph) % 1 + 1) % 1 * 29.53 * 864e5), nw = new Date(Date.now() + ((1 - ph) % 1 + 1) % 1 * 29.53 * 864e5);
          var dd = function (d) { return d.toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short', month: 'short', day: 'numeric' })); };
          out.html = card('Moon', '', il + '%', 'lit', '', 'The same moon the sky draws.',
            '<div class="kv"><div><div class="k">Next Full Moon</div><div class="x">' + dd(full) + '</div></div>' +
            '<div><div class="k">Next New Moon</div><div class="x">' + dd(nw) + '</div></div></div>');
          return out;
        }
        void self;
        return out;
      }
      _scrubFocus(foc) {
        var box = this._root.querySelector('.fc .ch');
        if (!box || !C.scrub) return;
        var rd = box.querySelector('.rd'), n = foc.series.length;
        C.scrub(this, box, {
          name: 'Forecast', count: n, say: foc.say, rest: foc.rest || '',
          readout: function () { return rd; },
          index: function (x) {
            var r = box.querySelector('svg').getBoundingClientRect();
            return r.width ? Math.max(0, Math.min(n - 1, Math.round((x - r.left) / r.width * (n - 1)))) : -1;
          }
        });
        if (rd && !rd.textContent) rd.textContent = foc.rest || '';
      }
      // the hours in words: rain coming, or the warmest and coolest ahead
      _hoursWords(hrs) {
        var wet = hrs.filter(function (f) { return num(f.precipitation_probability) >= 40; })[0];
        if (wet) return 'Rain likely around ' + hr(Date.parse(wet.datetime));
        var ts = hrs.map(function (f) { return num(f.temperature); }).filter(function (x) { return x != null; });
        if (!ts.length) return '';
        return 'Low ' + Math.round(Math.min.apply(null, ts)) + '° · High ' + Math.round(Math.max.apply(null, ts)) + '°';
      }
    }
    customElements.define('hk-detail-weather', WeatherPanel);
  });
})();
