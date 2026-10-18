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
// drops it. Per connection, so a page that reconnected starts afresh.
//
//   var w = hkWxForecast.watch(conn, 'hourly', 'weather.home', onNew);
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

(function () {
  'use strict';

  function boot() {
    var C = window.hkCards;
    if (!C || !C.HkBase) return false;
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
    // alerts sensors), re-read on every hass so an edit there follows at once.
    // So no card throws for want of an `entity:`, and a card added in the UI
    // need not repeat the house's own choice.
    function houseWeather(card, h, keys) {
      var HS = window.hkSettings, c = card._config;
      if (!HS || !c) return;
      var own = card._hkOwn || {};
      Object.keys(keys).forEach(function (k) {
        if (own[k]) return;
        var v = keys[k] === 'weather' ? (h ? HS.weatherId(h.states) : HS.get('weather.entity', null))
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

    // ------------------------------------------------- hk-weather-tile-card
    //
    // The four small tiles under the forecast band: WIND, SUNSET/SUNRISE, MOON
    // and UV INDEX. One plate, four drawings -- in a card, because a template
    // block in the view is the worst place for drawing code: no tests, no
    // syntax checking, and the whole page fails if one of them throws.
    //
    // `variant` picks the drawing; every entity it reads is named in the config.
    class HkWeatherTileCard extends Base {
      // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)
      static get FLAT_MOTION() { return true; }
      static get CSS() {
        return [
          // a page card's plate (hkCards.plate)
          'ha-card.wtile{box-sizing:border-box;display:block;height:172px;',
          '  padding:14px 16px;margin:0;' + window.hkCards.plate('card') + ';',
          '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
          // `start` on a tablet, where five tiles share a row at ~230px each and
          // the compass and moon disc read as a left-aligned column of graphics.
          // On a phone the page drops to ONE column, and a 378px tile with its
          // graphic hard left looks unbalanced.
          '.wtile .grid{display:grid;height:100%;grid-template-areas:"cap" "body";',
          '  grid-template-columns:minmax(0,1fr);',
          '  grid-template-rows:min-content minmax(0,1fr);',
          // --hk-wtile-justify is INERT and kept only so
          // hk-responsive.css's phone override is not a dangling reference:
          // the cap sets its own justify-self:start, and every variant's body
          // is width:100%, so there is nothing left for justify-items to move.
          // Centring happens inside the body instead (see `.body`).
          '  justify-items:var(--hk-wtile-justify,center);align-content:start}',
          // THE TILE CAPTION, and it is the REFERENCE for the row: the
          // hk-usage-card beside these tiles (Outside Temperature) adopts THIS
          // rather than its own larger sentence-case heading -- see
          // `.usage.mid .nm` in hk-energy.js. Change one, change both.
          //
          //     12px / 600 / +0.9px tracking / white 0.50 / UPPERCASE
          //
          // The uppercase is in the STRINGS (see _caption), not a
          // text-transform, because a `caption:` from YAML is passed through
          // untouched and should not be shouted at.
          //
          // justify-self:start pins it LEFT while the body stays centred --
          // the shape of the whole row: heading left, drawing centred.
          '.wtile .cap{grid-area:cap;justify-self:start;text-align:left;',
          '  font-size:13px;font-weight:600;letter-spacing:0.3px;',
          '  color:' + window.hkCards.v('ink-2') + ';width:100%;',
          '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          // NO align-self. The grid is `align-content: start`, so the rows pack to
    // the top and the body simply starts under the caption. `center` is wrong
    // and the SUNSET tile shows it: at a narrow column "7:40 PM" wraps
    // to two lines, the body grows past its 1fr row, and centring then pulls
    // it UP OVER the caption -- measured 24.2px of overlap.
    // CENTRED BOTH WAYS, which every tile needs. Packed to the start, the
    // slack around the INK inside each body measures:
    //
    //     wind   h off by 32px (all of it on the right)   v centred
    //     moon   h off by 69px                            v centred
    //     sun    h centred                                v 11px high
    //     uv     h off by 186px                           v 27px high
    //
    // `safe center` IS THE WHOLE TRICK, and the note above this rule is why:
    // plain centring pulls a grown body UP OVER the caption -- measured at
    // 24.2px of overlap on the SUNSET tile, where "7:40 PM" wraps to two lines
    // at a narrow column. `safe` falls back to start exactly when centring
    // would overflow, so the tile centres when it fits and packs to the top
    // when it does not. The grid keeps `align-content:start` for the same
    // reason; the centring happens INSIDE the body, which begins below the cap.
    //
    // align-items:center is safe because every variant's wrapper declares
    // width:100% (sun and uv inline, wind and moon via `.row`), so nothing
    // shrinks to its content -- the UV gradient track in particular has to
    // stay full width, since the dot's position along it IS the reading.
    '.wtile .body{grid-area:body;width:100%;min-width:0;display:flex;',
    '  flex-direction:column;justify-content:safe center;align-items:center;',
    '  text-align:center}',
          // ---- shared type inside the drawings
          '.wtile .big{font-size:30px;font-weight:700;letter-spacing:-0.6px;',
          '  color:' + window.hkCards.v('ink') + ';line-height:1}',
          '.wtile .uvbig{font-size:36px;font-weight:700;letter-spacing:-1px;',
          '  color:' + window.hkCards.v('ink') + ';line-height:1}',
          '.wtile .small{font-size:14px;font-weight:500;color:' + window.hkCards.v('ink-2') + '}',
          '.wtile .side{font-size:16px;font-weight:500;line-height:1.4;',
          '  color:' + window.hkCards.v('ink-2') + '}',
          // flex:0 1 auto, NOT 1 1 auto. Growing makes the text box eat
          // every pixel the disc does not, so the pair always spans the full
          // row and `justify-content:center` has nothing to centre -- the
          // disc sits hard against the left edge with 69px of slack on the
          // right. Shrink-to-content lets the disc + name centre as one unit.
          // `1 0 auto` would be the same bug; the shrink half (1) is what keeps
          // a long phase name wrapping instead of clipping.
          '.wtile .moonside{font-size:15px;font-weight:500;line-height:1.35;',
          '  flex:0 1 auto;min-width:0;color:' + window.hkCards.v('ink-2') + '}',
          '.wtile .band{font-size:18px;font-weight:500;margin-top:4px;',
          '  color:' + window.hkCards.v('ink-2') + '}',
          '.wtile .uvtrack{position:relative;height:8px;border-radius:4px;margin-top:16px;',
          '  background:linear-gradient(to right,#4cd964,#ffd60a,#ff9f0a,#ff453a,#bf5af2)}',
          '.wtile .uvdot{position:absolute;top:-3px;width:14px;height:14px;',
          '  border-radius:50%;background:#fff;border:2px solid rgba(0,0,0,0.35)}',
          '.wtile .row{display:flex;align-items:center;justify-content:center;width:100%}'
        ].join('') + TILE_PAGE_CSS;
      }

      setConfig(config) {
        var v = config && config.variant;
        if (['wind', 'sun', 'moon', 'uv', 'humidity', 'pressure'].indexOf(v) < 0) {
          throw new Error('hk-weather-tile: `variant` must be wind, sun, moon, uv, humidity or pressure');
        }
        // only what the drawing reads: the wind tile's weather and sensors,
        // the UV tile's sensor
        this._hkKeys = v === 'wind' ? { entity: TILE_KEYS.entity, speed: TILE_KEYS.speed, gust: TILE_KEYS.gust }
                     : v === 'uv' ? { uv: TILE_KEYS.uv } : {};
        this._hkOwn = ownKeys(config, this._hkKeys);
        super.setConfig(Object.assign({}, config));
        houseWeather(this, this._hass, this._hkKeys);
      }
      get hass() { return super.hass; }
      set hass(h) { houseWeather(this, h, this._hkKeys || {}); super.hass = h; }
      getCardSize() { return 2; }

      _sigOf() {
        var h = this._hass, c = this._config;
        if (!h || !c) return null;
        var ids = [c.entity, c.speed, c.gust, c.sun, c.phase, c.uv].filter(Boolean);
        var out = c.variant + '|';
        if (this._isPage()) {
          // the weather service it falls back to, the humidity sensor, the
          // hour (a moon, a sunrise arc and the lines ahead move with it)
          var HS = window.hkSettings;
          ids = ids.concat([HS && HS.weatherId ? HS.weatherId(h.states) : null, HS ? HS.get('weather.humidity', null) : null]).filter(Boolean);
          out += 'pg' + Math.floor(Date.now() / 600e3) + ';';
        }
        // A moon with no sensor follows the built-in phase, which moves with
        // the clock, not with any entity: it is part of the signature.
        if (c.variant === 'moon' && !c.phase) out += 'm=' + this._phase().toFixed(3) + ';';
        for (var i = 0; i < ids.length; i++) {
          var s = h.states[ids[i]];
          out += ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
        }
        return out;
      }
      _n(id, attr) {
        var s = id && this._st(id);
        if (!s) return null;
        var v = attr ? (s.attributes || {})[attr] : s.state;
        var n = Number(v);
        return isFinite(n) && v !== '' && v != null ? n : null;
      }

      // ---- WIND: a compass rose with the needle and the speed in the hub.
      _wind() {
        // No speed sensor configured: the weather entity's own wind_speed.
        var spd = this._config.speed ? this._n(this._config.speed)
                                     : this._n(this._config.entity, 'wind_speed');
        var gust = this._n(this._config.gust);
        var brg = this._n(this._config.entity, 'wind_bearing');
        // The speed's own unit: the sensor's, else the weather entity's.
        var HS = window.hkSettings;
        var spdSt = this._st(this._config.speed || this._config.entity);
        var unit = HS && HS.unit ? HS.unit(spdSt, this._config.speed ? null : 'wind_speed_unit', 'mph')
                                 : 'mph';
        var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        // Meteorological bearing is the direction the wind comes FROM, so the
        // needle points from that bearing toward the centre.
        var a = (brg === null ? 0 : brg) * Math.PI / 180;
        var R = 30, cx = 34, cy = 34;
        var x1 = cx + R * Math.sin(a), y1 = cy - R * Math.cos(a);
        var x2 = cx - R * Math.sin(a), y2 = cy + R * Math.cos(a);
        var ticks = '';
        for (var i = 0; i < 36; i++) {
          var t = i * 10 * Math.PI / 180;
          var inner = (i % 9 === 0) ? 26 : 29;
          ticks += '<line x1="' + (cx + inner * Math.sin(t)) + '" y1="' + (cy - inner * Math.cos(t)) +
                   '" x2="' + (cx + 32 * Math.sin(t)) + '" y2="' + (cy - 32 * Math.cos(t)) +
                   '" style="stroke:' + window.hkCards.v('mark') + '" stroke-width="1"/>';
        }
        var lab = function (x, y, s) {
          return '<text x="' + x + '" y="' + y + '" style="fill:' + window.hkCards.v('ink-2') + '"' +
                 ' font-size="8" text-anchor="middle">' + s + '</text>';
        };
        var dir = brg === null ? '' : DIRS[Math.round((brg % 360) / 45) % 8];
        // GUSTS ARE OFTEN GENUINELY ABSENT, and that is not an error to print.
        // OpenWeatherMap only sends `wind_gust` when the observation carries
        // one, so its gust sensor alternates between a number and `unknown`
        // all day. "Gusts / -- mph NE" looks like a broken card: "--" next to
        // a live compass reads as a failure, not as "calm". So when there is no gust the side
        // states the direction instead, and when there is no bearing either the
        // compass stands alone rather than captioned with nothing.
        var side = gust !== null
          ? '<div class="side">Gusts<br>' + Math.round(gust) + ' ' + unit + ' ' + dir + '</div>'
          : dir ? '<div class="side">From<br>' + dir + '</div>' : '';
        // min-height:100% for the same reason as the moon below: centred in
        // the body rather than packed under the caption.
        return '<div class="row" style="justify-content:center;gap:18px;min-height:100%">' +
          '<svg viewBox="0 0 68 68" style="width:108px;height:108px;flex:0 0 auto">' +
          ticks + lab(34, 9, 'N') + lab(34, 64, 'S') + lab(61, 37, 'E') + lab(7, 37, 'W') +
          '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
          '" style="stroke:' + window.hkCards.v('glyph') + '" stroke-width="2" stroke-linecap="round"/>' +
          '<circle cx="' + x2 + '" cy="' + y2 + '" r="3.2" style="fill:' + window.hkCards.v('glyph') + '"/>' +
          '<circle cx="34" cy="34" r="15" style="fill:var(--hk-key,rgba(0,0,0,0.28))"/>' +
          '<text x="34" y="33" style="fill:' + window.hkCards.v('ink') + '" font-size="15" font-weight="600"' +
          ' text-anchor="middle">' + (spd === null ? '--' : Math.round(spd)) + '</text>' +
          '<text x="34" y="43" style="fill:' + window.hkCards.v('ink-2') + '" font-size="8"' +
          ' text-anchor="middle">' + unit + '</text></svg>' +
          side + '</div>';
      }

      // ---- SUN: the next event, and an arc with the sun's live position.
      _sun() {
        var s = this._st(this._config.sun), a = (s && s.attributes) || {};
        var up = s && s.state === 'above_horizon';
        var fmt = function (iso) {
          if (!iso) return '--';
          var d = new Date(iso);
          return isNaN(d) ? '--' : d.toLocaleTimeString('en-US',
            { hour: 'numeric', minute: '2-digit' });
        };
        var main = fmt(up ? a.next_setting : a.next_rising);
        var other = up ? ('Sunrise: ' + fmt(a.next_rising))
                       : ('Sunset: ' + fmt(a.next_setting));
        // The dot is derived from live ELEVATION, not from clock time: sun.sun
        // exposes only the NEXT rise and set, so today's sunrise is unavailable
        // once the sun is already up. 70 degrees is a rough summer maximum for
        // mid-northern latitudes, so the position is indicative, not surveyed.
        var elev = Number(a.elevation) || 0;
        var f = Math.max(0, Math.min(1, elev / 70));
        var x = a.rising === true ? (8 + 60 * (f * 0.5)) : (8 + 60 * (1 - f * 0.5));
        var y = 34 - 24 * f;
        return '<div style="width:100%">' +
          '<div class="big">' + main + '</div>' +
          '<svg viewBox="0 0 136 44" style="width:100%;height:50px;margin-top:8px">' +
          '<path d="M8,36 Q68,-6 128,36" fill="none" style="stroke:' + window.hkCards.v('mark') + '" stroke-width="1.5"/>' +
          '<line x1="0" y1="38" x2="136" y2="38" style="stroke:' + window.hkCards.v('line-strong') + '" stroke-width="1"/>' +
          '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="rgba(255,214,10,0.98)"/></svg>' +
          '<div class="small">' + other + '</div></div>';
      }

      // ---- MOON: a two-arc terminator, and the phase name.
      // The phase: the card's own sensor, else the one chosen in Configure ->
      // Seasonal sky, else computed from the date -- the same answer the live
      // sky draws (hkSettings.moon), so the tile and the sky always agree.
      _phase() {
        if (this._config.phase) return this._n(this._config.phase);
        var HS = window.hkSettings;
        return HS && HS.moon ? HS.moon((this._hass && this._hass.states) || {}) : null;
      }
      _moon() {
        var p = this._phase();
        if (p === null) return '<div style="color:' + window.hkCards.v('ink-2') + '">--</div>';
        var illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
        var waxing = p < 0.5;
        var name = p < 0.03 ? 'New Moon'
                 : p < 0.22 ? 'Waxing Crescent'
                 : p < 0.28 ? 'First Quarter'
                 : p < 0.47 ? 'Waxing Gibbous'
                 : p < 0.53 ? 'Full Moon'
                 : p < 0.72 ? 'Waning Gibbous'
                 : p < 0.78 ? 'Last Quarter'
                 : p < 0.97 ? 'Waning Crescent' : 'New Moon';
        // THE SWEEP FLAGS. arc1 runs top -> bottom, so sweep 1 goes round the
        // RIGHT limb and sweep 0 round the LEFT: waxing is lit on the right,
        // waning on the left. arc2 runs bottom -> top, so the same flag means the
        // opposite side -- sweep 1 is now the LEFT.
        //
        // A CRESCENT therefore needs arc2 to come back on the SAME side as the
        // lit limb, carving the half-disc thin, which is the OPPOSITE flag from
        // arc1. A GIBBOUS needs it to bulge over the dark lobe, the SAME flag.
        // Inverted, every phase renders as its own complement: new moon draws
        // a full disc, full moon an empty one, both crescents draw as gibbous
        // -- while the "% lit" text stays right, which makes it look like a
        // drawing bug rather than a data one.
        //
        // hk-sky.js moonSvg() draws the sky's own moon
        // with `inner = c < 0 ? outer : 1 - outer`, which is this same test
        // written against cos directly (c < 0 is exactly illum > 0.5). If one is
        // ever changed, change both -- they draw the same moon on the same page.
        var r = 26, cx = 30, cy = 30;
        var rx = r * Math.abs(Math.cos(2 * Math.PI * p));
        var a1 = waxing ? 1 : 0;
        var a2 = (illum > 0.5) ? a1 : (1 - a1);
        var d = 'M ' + cx + ' ' + (cy - r) + ' A ' + r + ' ' + r + ' 0 0 ' + a1 +
                ' ' + cx + ' ' + (cy + r) + ' A ' + rx + ' ' + r + ' 0 0 ' + a2 +
                ' ' + cx + ' ' + (cy - r) + ' Z';
        // 72px, not 104: in a row of five tiles a bigger disc pushes "Waning
        // Crescent" out of the tile. The phase name is broken at its space
        // rather than left to the flex box, which clips it mid-word instead of
        // wrapping.
        // min-height:100% CENTRES IT in the body: the disc
        // is 72px in a 123px body, so packed to the top it sits 25px high while
        // the compass beside it fills its body and looks centred. min-height,
        // not height -- a phase name that wraps can still grow the row rather
        // than be clipped, which is the SUNSET overlap trap in reverse.
        return '<div class="row" style="gap:12px;min-height:100%">' +
          '<svg viewBox="0 0 60 60" style="width:72px;height:72px;flex:0 0 auto">' +
          '<circle cx="30" cy="30" r="26" style="fill:' + window.hkCards.v('key') + '"/>' +
          '<path d="' + d + '" style="fill:var(--hk-glyph,rgba(226,232,240,0.95))"/></svg>' +
          '<div class="moonside">' + String(name).replace(' ', '<br>') +
          '<br>' + Math.round(illum * 100) + '% lit</div></div>';
      }

      // ---- UV: the index, its band, and a dot on the risk gradient.
      _uv() {
        var v = this._n(this._config.uv);
        var n = v === null ? null : Math.round(v);
        var band = n === null ? '--'
                 : n <= 2 ? 'Low'
                 : n <= 5 ? 'Moderate'
                 : n <= 7 ? 'High'
                 : n <= 10 ? 'Very High' : 'Extreme';
        var pct = n === null ? 0 : Math.max(0, Math.min(1, n / 12));
        return '<div style="width:100%">' +
          '<div class="uvbig">' + (n === null ? '--' : n) + '</div>' +
          '<div class="band">' + band + '</div>' +
          '<div class="uvtrack"><div class="uvdot" style="left:calc(' +
          (pct * 100).toFixed(1) + '% - 7px)"></div></div></div>';
      }

      _caption() {
        var cfg = this._config;
        if (cfg.caption) return cfg.caption;
        // UPPERCASE HERE, not a text-transform: a `caption:` set in YAML is
        // passed through untouched and should not be shouted at.
        if (cfg.variant === 'sun') {
          var s = this._st(cfg.sun);
          return (s && s.state === 'above_horizon') ? 'SUNSET' : 'SUNRISE';
        }
        return { wind: 'WIND', moon: 'MOON', uv: 'UV INDEX' }[cfg.variant] || '';
      }

      // the Weather page's look (TILE_PAGE, below); Humidity and Pressure
      // come only in it
      _isPage() { var c = this._config || {}; return c.look === 'page' || c.variant === 'humidity' || c.variant === 'pressure'; }
      _render() {
        var cfg = this._config;
        if (this._isPage()) { if (this._hass) this._renderPage(); return; }
        if (!this._built) {
          this._root.innerHTML =
            '<ha-card class="wtile" data-hk-role="card"><div class="grid">' +
            '<div class="cap" data-hk-role="cap"></div>' +
            '<div class="body" data-hk-role="body"></div>' +
            '</div></ha-card>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('.wtile'), cap: q('.cap'), body: q('.body') };
          if (cfg.tap_action && cfg.tap_action.action !== 'none') {
            this._bind(this._e.card, 'tap_action', null);
          }
          this._built = true;
        }
        var e = this._e;
        var cap = this._caption();
        if (e.cap.textContent !== cap) e.cap.textContent = cap;
        var html = this['_' + cfg.variant]();
        window.hkCards.morph(e.body, html);
      }
    }


    // --------------------------------------------------------- hk-header
    //
    // THE WALL HEADER: the clock, the date and the weather on the left; the
    // security summary on the right. Both halves are already one function each
    // in modules/hk-header.js -- this card is the scaffolding around them.
    //
    // WHY THE LOGIC LIVES IN A MODULE. The clock and the weather appear in
    // several places -- this header, a car dashboard, the screensaver -- and
    // inline copies of them drift apart silently. One module means one clock
    // and one weather everywhere.
    //
    // hk-header.js is a bootstrap module (custom_components/hk_frontend/
    // __init__.py) rather than a hk-loader module because this is the first
    // thing painted. If it fails to load, this header says so rather than
    // rendering blank.
    // THE WEATHER, FITTED TO ITS WIDTH (hkHeader.fitWeather: glyph alone, or
    // the detail line cut to what fits -- never an ellipsis). The rules key on
    // an attribute of the element `holderOf(card)` returns; the fit runs now
    // and again whenever the card's WIDTH changes (a height change is the
    // fit's own doing).
    function fitCss(sel) {
      var H = window.hkHeader;
      return H && H.FIT_CSS ? H.FIT_CSS(sel) : '';
    }
    function fitOnResize(card, fit) {
      var H = window.hkHeader;
      if (!H || !H.fitWeather) return;
      fit(H);
      if (card._wxRO || !window.ResizeObserver) return;
      var w = -1;
      card._wxRO = new ResizeObserver(function (en) {
        var nw = en[0] && en[0].contentRect ? Math.round(en[0].contentRect.width) : -1;
        if (nw === w) return;
        w = nw;
        if (window.hkHeader) fit(window.hkHeader);
      });
      card._wxRO.observe(card);
    }

    // The page's top margin when the header has stepped aside for the menu's
    // clock: the chip row's top edge then sits level with the top of the
    // menu's time digits -- both at y = 32 (measured at 1280 x 800;
    // 16 more px of grid and chip margin sit under this).
    var GONE_H = 16;
    function menuHasTime() {
      var M = C.menu;
      return !!(M && typeof M.hasTime === 'function' && M.hasTime());
    }

    // Narrower than this on someone else's dashboard, the wall header stacks.
    // 760: the clock, the weather beside it and the 280 px security line
    // with the 34 px gaps between them.
    var HK_STACK_W = 760;
    class HkHeaderCard extends Base {
      static get CSS() {
        return [
          // OVERFLOW IS VISIBLE AT EVERY LEVEL, and that is load-bearing: the
          // whole header is drawn under one drop-shadow filter, and a filter's
          // output is clipped by any ancestor that clips.
          'ha-card.hdr{box-sizing:border-box;display:block;min-height:118px;',
          '  background:transparent;box-shadow:none;border:none;overflow:visible;',
          '  padding:28px 0px 14px 0px;',
          // 9px, not 14px: the status chip carries a 5px TOP margin so its
          // drop shadow clears the row above. 9 + 5 = the same 14px gap this
          // header has always had below it. Paired with that margin -- if the
          // chip shadow is retuned, retune this too.
          '  margin:0px 0px 9px 0px}',
          '.hdr .grid{display:grid;grid-template-areas:"left right";',
          '  grid-template-columns:minmax(0,1fr) fit-content(42%);',
          '  grid-template-rows:min-content;align-items:start;',
          '  column-gap:34px;overflow:visible}',
          '.hdr .half{min-height:96px;cursor:pointer;overflow:visible;',
          '  align-self:start;width:100%;min-width:0;',
          '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
          '.hdr .left{grid-area:left;text-align:left}',
          '.hdr .right{grid-area:right;text-align:right;min-width:280px}',
          // the weather fitted to what is left beside the clock (hkHeader.fitWeather),
          // and the clock itself dropped when even that is too little (_fitWx)
          fitCss('.hdr .left'),
          '.hdr .left[data-hdr-fit="noclock"] [data-hk-clock="clock"]{display:none}',
          // THE MENU HAS THE TIME (Configure: "Time and weather in the menu",
          // with the menu always shown): the header steps aside and leaves
          // only the page's top margin, so the chip row moves up level with
          // the menu's clock -- about 130 px back on a wall tablet.
          'ha-card.hdr.gone{min-height:0;height:' + GONE_H + 'px;padding:0;margin:0}',
          '.hdr.gone .grid{display:none}',
          // STACKED: on someone else's dashboard (data-hk-foreign) narrower
          // than HK_STACK_W -- a section, a Masonry column -- the security
          // line goes under the clock, and the weather under the time when
          // they don't fit side by side. Nothing is dropped (_fitWx). HK's own
          // screens never stack: a narrow one keeps dropping the clock.
          ':host([data-hk-stack]) ha-card.hdr{padding:12px 0px 10px 0px;min-height:0}',
          ':host([data-hk-stack]) .hdr .grid{grid-template-areas:"left" "right";',
          '  grid-template-columns:minmax(0,1fr);row-gap:10px}',
          ':host([data-hk-stack]) .hdr .half{min-height:0}',
          ':host([data-hk-stack]) .hdr .right{text-align:left;min-width:0}',
          ':host([data-hk-stack]) .hdr .left > div{flex-wrap:wrap;row-gap:12px}'
        ].join('');
      }
      setConfig(config) { super.setConfig(config || {}); }
      getCardSize() { return 2; }
      // THE WEATHER FITS WHAT IS LEFT BESIDE THE CLOCK: after each redraw and
      // whenever the header's width changes (a window resized, a phone turned,
      // a docked menu coming or going). Wind, then humidity, go first. When
      // even the first line ("73° • Sunny") will not fit beside the clock,
      // THE CLOCK GOES instead of the words: a screen that
      // narrow -- an iPad held upright, a phone -- shows the time and date in
      // its own status bar, so the clock is the redundant half. Then the
      // weather is fitted again on its own; the edge tab moves down level
      // with the chip row (see _publishDate).
      _fitWx() {
        var self = this;
        fitOnResize(this, function (H) {
          var left = self._e && self._e.left;
          if (!left) return;
          var was = left.getAttribute('data-hdr-fit');
          left.removeAttribute('data-hdr-fit');
          // `clock: false` (a car's Home: the car shows the time) -- the
          // weather has the whole left half from the start
          var noClock = !!(self._config && self._config.clock === false);
          if (noClock) left.setAttribute('data-hdr-fit', 'noclock');
          // stacked (see the CSS): set before fitting, which then has the
          // whole width for each line and never drops the clock
          var w = self.getBoundingClientRect ? self.getBoundingClientRect().width : 0;
          var stack = !!(self.hasAttribute && self.hasAttribute('data-hk-foreign')) && w > 0 && w < HK_STACK_W;
          if (self.hasAttribute && self.hasAttribute('data-hk-stack') !== stack) {
            self.toggleAttribute('data-hk-stack', stack);
            // the security line is drawn for the arrangement: redraw it
            self._lastR = null;
            if (self.requestUpdate) setTimeout(function () { if (self.isConnected) self.requestUpdate(); }, 0);
          }
          H.fitWeather(left);
          if (!noClock && !stack && left.getAttribute('data-wx-fit') === 'glyph') {
            left.setAttribute('data-hdr-fit', 'noclock');
            H.fitWeather(left);
          }
          if (was !== left.getAttribute('data-hdr-fit')) self._publishDate();
        });
      }
      // THE HEADER SIGNS ON EVERYTHING IT DRAWS. Returning null -- "always
      // render" -- would rebuild both HTML strings, scan every security
      // entity and read two computed styles on every hass push, several a
      // second on every wall tablet. Its inputs are all
      // knowable: the clock sensors, the weather entity, sun.sun and the
      // Home-status lists (hkHeader.lists), plus the optical shift. Without a
      // Time & Date sensor the clock is this screen's own and moves once a
      // minute, which the last term covers.
      _sigOf() {
        var h = this._hass, H = window.hkHeader, HS = window.hkSettings;
        if (!h || !H || !h.states) return null;
        var st = h.states;
        var get = function (k) { return (HS && HS.get) ? HS.get(k, null) : null; };
        var timeId = get('clock.time') || 'sensor.time';
        var ids = [timeId, get('clock.date') || 'sensor.date',
                   HS && HS.weatherId ? HS.weatherId(st) : null, 'sun.sun'];
        var L = H.lists ? H.lists() : {};
        ids = ids.concat(L.alarm || [], L.garage || [], L.locks || [], L.doors || [], L.windows || []);
        var out = 'shift=' + (this._shift || 0) + ';';
        for (var i = 0; i < ids.length; i++) {
          var s = ids[i] && st[ids[i]];
          out += (ids[i] || '-') + '=' + (s ? s.state + '@' + s.last_updated : 'x') + ';';
        }
        if (!st[timeId]) out += 'min=' + Math.floor(Date.now() / 60000) + ';';
        return out + 'gone=' + menuHasTime();
      }
      _go(path) {
        this._act({ action: 'navigate', navigation_path: path }, false);
      }
      _render() {
        var cfg = this._config;
        if (!this._built) {
          this._root.innerHTML =
            '<ha-card class="hdr" data-hk-role="card"><div class="grid">' +
            '<div class="half left" role="button" data-hk-role="left"></div>' +
            '<div class="half right" role="button" data-hk-role="right"></div>' +
            '</div></ha-card>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { left: q('.left'), right: q('.right') };
          // New, empty halves: forget what was written into the old ones, or
          // the compare below skips the write after a config edit.
          this._lastL = this._lastR = null;
          var self = this;
          // "./x" is relative to the CURRENT dashboard: dashboards with
          // their own url_paths share this one card.
          // THE CLOCK OPENS THE MENU, where this dashboard has
          // one and "Tapping the clock opens the menu" is on -- a big target
          // for it on the wall. The weather beside it still opens Weather.
          // The clock block is marked data-hk-clock="clock" by hk-header.js.
          this._e.left.addEventListener('click', function (e) {
            if (C.menu && C.menu.clock()) {
              var path = e.composedPath ? e.composedPath() : [];
              for (var i = 0; i < path.length && path[i] !== self._e.left; i++) {
                if (path[i].getAttribute && path[i].getAttribute('data-hk-clock') === 'clock') {
                  C.menu.toggle();
                  return;
                }
              }
            }
            self._go(cfg.weather_path || './weather');
          });
          this._e.right.addEventListener('click', function () {
            self._go(cfg.alarm_path || './alarm');
          });
          this._built = true;
        }
        var gone = menuHasTime();
        var card = this._root.querySelector('ha-card.hdr');
        if (card && card.classList) card.classList.toggle('gone', gone);
        if (gone) { this._lastL = this._lastR = null; return; }
        var H = window.hkHeader, st = this._hass && this._hass.states;
        var l = (H && st) ? H.row(st, { timeShift: this._shift || 0 }) : 'Header module unavailable';
        // stacked (_fitWx): under the clock, from the left, no corner padding
        var stacked = !!(this.hasAttribute && this.hasAttribute('data-hk-stack'));
        var r = (H && st) ? H.security(st, stacked ? { align: 'left', pad: '0px', minHeight: '0px' } : undefined)
                          : 'Header module unavailable';
        // Compare against the LAST STRING WRITTEN, never against innerHTML.
        // innerHTML is the browser's re-serialisation, which is not guaranteed
        // to round-trip (a self-closed SVG <path/> comes back as <path></path>,
        // attribute quoting and style text can be normalised). When it does
        // not, the comparison is always unequal and the header rebuilds on
        // every hass update -- measured 98 DOM mutations in 10 s, and a
        // visible flicker on a wall tablet with the inline weather glyphs.
        // morph(), not innerHTML: a minute tick changes one text node instead of
        // recreating the whole block -- see morph() in hk-base.js for the
        // tablet flicker that rebuilding it causes.
        var put = (window.hkCards && window.hkCards.morph) ||
                  function (el, html) { el.innerHTML = html; };
        if (this._lastL !== l) { this._lastL = l; put(this._e.left, l); this._fitWx(); }
        if (this._lastR !== r) { this._lastR = r; put(this._e.right, r); }
        // The same optical left edge as the screensaver clock -- measured
        // again as the header settles, as the clock card's is (_align)
        if (H && H.clockShift && !this._aligning) {
          var s = H.clockShift(this._e.left), self = this;
          if (!this._settle) {
            this._settle = true;
            [400, 1500, 4000].forEach(function (ms) {
              setTimeout(function () { if (self.isConnected) self.requestUpdate(); }, ms);
            });
          }
          if (s === null) {
            if (document.fonts && !this._fontWait) {
              this._fontWait = true;
              document.fonts.ready.then(function () { self._fontWait = false; self.requestUpdate(); });
            }
          } else if (Math.abs(s - (this._shift || 0)) >= 0.5) {
            this._shift = s;
            this._aligning = true;
            try { this._render(); } finally { this._aligning = false; }
          }
        }
        if (!this._aligning) this._publishDate();
      }

      // WHERE THE DATE LINE SITS, for the menu's edge tab (modules/hk-menu.js),
      // which centres itself on it: the tab's centre line and the date's
      // line up. The OPTICAL centre of the text -- halfway between its baseline
      // and its cap height, the line the eye reads as its middle -- not the middle of its line
      // box, which sits lower by half the descender. Measured once the fonts
      // are in, and handed over as a distance from the top of the PAGE -- under
      // any Home Assistant toolbar, with the document's scroll added back -- so
      // it is the same number however the page was sitting when it was taken.
      _publishDate() {
        var M = C.menu, self = this;
        if (!M || !M.on() || this._dateBusy) return;
        if (typeof M.tab === 'function' ? M.tab() === 'never' : M.style() !== 'tab') return;
        if (!this.isConnected) return;
        var left = this._e && this._e.left;
        var date = left && left.querySelector('[data-hk-clock="date"]');
        // NO CLOCK on a narrow screen (_fitWx): no date line to sit on. The tab
        // goes LOWER, level with the chip row under the header -- its centre
        // is the header's bottom + 21 px + half the chip (measured at 744 px
        // with the 44 px chip: header 142, chips 163-207) --
        // so it reads as that row's lead, 62 px clear of the weather and
        // 92 px clear of a sub-page's back button. Following the weather's
        // first line up instead would put it right beside both.
        if (date && !date.getClientRects().length) {
          var hb = this.getBoundingClientRect();
          var yc = hb.bottom + 21 + window.hkCards.CHIP.h / 2 - (M.viewTop() - (window.scrollY || 0));
          if (yc > 0 && yc < 600 && M.publishDate) M.publishDate(yc);
          return;
        }
        var panel = M.panel && M.panel();
        if (!date || !panel || !date.getBoundingClientRect) return;
        this._dateBusy = true;
        var run = function () {
          self._dateBusy = false;
          if (!self.isConnected || !date.isConnected) return;
          var top = M.viewTop() - (window.scrollY || 0);    // the page's top NOW
          var probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
          date.appendChild(probe);
          var baseline = probe.getBoundingClientRect().top;
          date.removeChild(probe);
          var cs = getComputedStyle(date), cap = 0;
          try {
            var ctx = document.createElement('canvas').getContext('2d');
            ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
            cap = ctx.measureText('H').actualBoundingBoxAscent || 0;
          } catch (e) { cap = 0; }
          if (!cap) cap = parseFloat(cs.fontSize) * 0.705;           // SF Pro's cap height
          var y = baseline - cap / 2 - top;
          if (y > 0 && y < 400 && M.publishDate) M.publishDate(y);
        };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestAnimationFrame(run); });
        else requestAnimationFrame(run);
      }
    }

    // ------------------------------------------------------- hk-alert-card
    //
    // The severe-weather band. It renders the event, the severity, the alert
    // count, the affected-area count and the full "expected to last until ..."
    // sentence -- which is why it is INERT: the more-info dialog behind it is
    // the raw sensor, a count for a state and an `Alerts` attribute holding a
    // ~600-character AreasAffected string. Tapping a severe-weather warning
    // and getting that would be the most confusing thing on the page.
    // ------------------------------------------ hk-screensaver-status-card
    // THE HOUSE AT A GLANCE, top-right of the photo screensaver: the tablet
    // header's own security block (hkHeader.security -- the one definition of
    // "secure" the header and the car share), sized for the photos. "Home
    // Secured" when armed and everything is shut, locked and reporting;
    // otherwise what isn't; NOTHING when there is nothing to say (disarmed,
    // all shut), so the photos stay the point.
    //
    // Occupies no space in the screensaver's info box: like the now-playing
    // card it pins itself to its corner (position:fixed), and like it, the
    // shadow is a filter on the text and the info box's text-shadow is off.
    class HkScreensaverStatusCard extends Base {
      static get CSS() {
        return [
          'ha-card.ssstat{background:none;box-shadow:none;border:none;padding:0;margin:0;height:0;',
          '  overflow:visible;display:block}',
          '.sscorner{position:fixed;top:var(--hk-ss-status-top,44px);right:var(--hk-ss-status-right,50px);',
          // (--hk-ss-status-width: the calendar pane's width, when it sits there)
          '  z-index:5;width:var(--hk-ss-status-width,46vw);pointer-events:none;text-shadow:none;will-change:transform}'
        ].join('');
      }
      setConfig(config) { super.setConfig(Object.assign({}, config || {})); }
      getCardSize() { return 1; }
      _html() {
        var H = window.hkHeader, st = this._hass && this._hass.states;
        if (!H || !H.security || !st) return '';
        var c = this._config || {};
        return H.security(st, { line1Size: c.line1_size || '36px', lineSize: c.line_size || '24px',
                                pad: '0px', minHeight: '0px', align: c.align });
      }
      _sigOf() { return this._hass ? this._html() : null; }
      _render() {
        if (!this._built) {
          this._root.innerHTML = '<ha-card class="ssstat" data-hk-role="card"><div class="sscorner"></div></ha-card>';
          this._e = this._root.querySelector('.sscorner');
          this._built = true;
          // a rebuild (a new config) starts empty: what it last drew is gone
          this._last = null;
        }
        var html = this._html();
        if (this._last === html) return;
        this._last = html;
        var put = (window.hkCards && window.hkCards.morph) || function (el, v) { el.innerHTML = v; };
        put(this._e, html);
      }
    }

    class HkAlertCard extends Base {
      static get CSS() {
        return [
          // The glass plate, same as every other card on the page, from the
          // shared tokens. This card ONLY RENDERS WHEN AN ALERT IS LIVE, so
          // drift here would be invisible until it matters, which is the
          // argument for it not being hand-rolled.
          'ha-card.alert{box-sizing:border-box;display:block;',
          '  padding:16px 20px 14px 20px;margin:0px 0px 12px 0px;' + window.hkCards.plate('card') + ';',
          '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
          '.alert .grid{display:grid;',
          '  grid-template-areas:"i title" "i src" "body body" "count count";',
          '  grid-template-columns:min-content minmax(0,1fr);',
          '  grid-template-rows:min-content min-content min-content min-content;',
          '  justify-items:start;align-content:start;column-gap:12px}',
          '.alert .icon{grid-area:i;width:26px;height:26px;--mdc-icon-size:26px;',
          '  align-self:center}',
          '.alert .title{grid-area:title;font-size:19px;font-weight:700;',
          '  letter-spacing:-0.45px;align-self:end;color:' + window.hkCards.v('ink') + '}',
          '.alert .src{grid-area:src;font-size:14px;font-weight:500;',
          '  letter-spacing:-0.2px;align-self:start;color:' + window.hkCards.v('ink-2') + '}',
          '.alert .body{grid-area:body;font-size:15px;font-weight:500;',
          '  letter-spacing:-0.2px;line-height:1.35;text-align:left;margin-top:12px;',
          '  color:' + window.hkCards.v('ink') + '}',
          '.alert .count{grid-area:count;font-size:13px;font-weight:500;',
          '  margin-top:10px;color:' + window.hkCards.v('ink-3') + '}'
        ].join('');
      }
      setConfig(config) {
        this._hkOwn = ownKeys(config, ALERT_KEYS);
        super.setConfig(Object.assign({}, config));
        houseWeather(this, this._hass, ALERT_KEYS);
      }
      get hass() { return super.hass; }
      set hass(h) { houseWeather(this, h, ALERT_KEYS); super.hass = h; }
      getCardSize() { return this._alertShown === false ? 0 : 2; }
      // Home Assistant sets `preview` on the card in its editor, after
      // setConfig: draw again, as the sample, when it arrives.
      get preview() { return !!this._hkPreview; }
      set preview(v) {
        if (this._hkPreview === !!v) return;
        this._hkPreview = !!v;
        if (this._config) this._render();
      }

      // Hidden like the chips (hk-chip.js _show): the host `hidden`, and
      // card-visibility-changed so the hui-card around it hides too -- but
      // only once it is on the page (hui-card reads `hidden` before that).
      _showAlert(on) {
        if (this._alertShown === on) return;
        this._alertShown = on;
        this.hidden = !on;
        if (this.style) this.style.display = on ? '' : 'none';
        if (this.isConnected) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed',
            { detail: { value: on }, bubbles: true, composed: true }));
        }
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._alertShown === false) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed',
            { detail: { value: false }, bubbles: true, composed: true }));
        }
      }

      // AN ALERT THAT HAS ENDED IS NOT SHOWN, though the sensor may keep it
      // until its next poll (Ends, else Expires, in the past): no stale
      // warning, and no all-clear of our own either -- the card just goes.
      _first() {
        var st = this._st(this._config.entity);
        var list = (st && st.attributes && st.attributes.Alerts) || [];
        var now = Date.now();
        var live = list.filter(function (a) {
          var end = Date.parse((a && (a.Ends || a.Expires)) || '');
          return !isFinite(end) || end > now;
        });
        var n = Number((st && st.state) || 0) || 0;
        if (list.length) n = live.length;
        return { st: st, a: live[0] || {}, n: n, all: live };
      }
      // THE DETAILS (the Weather page's, `details: true`): the alert's own
      // words -- headline, description and what to do -- in a sheet
      _details() {
        var f = this._first(), X = window.hkDetail;
        if (!f.n || !X || !X.open) return;
        var md = f.all.map(function (a) {
          return ['## ' + (a.Event || 'Weather Alert'), a.Headline ? '**' + a.Headline + '**' : '',
                  a.Severity ? 'Severity: ' + a.Severity + (a.Certainty ? ' · ' + a.Certainty : '') : '',
                  a.Description ? String(a.Description) : '', a.Instruction ? '**What to do:** ' + a.Instruction : '',
                  a.URL ? '[From the National Weather Service](' + a.URL + ')' : ''].filter(Boolean).join('\n\n');
        }).join('\n\n---\n\n');
        X.open(this._config.entity, null, { cards: { cards: [{ type: 'markdown', content: md }] } });
      }

      _render() {
        var cfg = this._config;
        if (!this._built) {
          this._root.innerHTML =
            '<ha-card class="alert" data-hk-role="card"><div class="grid">' +
            '<ha-icon class="icon" data-hk-role="icon" icon="' +
            (cfg.icon || 'mdi:alert') + '"></ha-icon>' +
            '<div class="title" data-hk-role="title"></div>' +
            '<div class="src" data-hk-role="src"></div>' +
            '<div class="body" data-hk-role="body"></div>' +
            '<div class="count" data-hk-role="count"></div>' +
            '</div></ha-card>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { icon: q('.icon'), title: q('.title'), src: q('.src'),
                      body: q('.body'), count: q('.count') };
          if (cfg.details) {
            var self = this, card = q('ha-card');
            card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
            card.style.cursor = 'pointer';
            card.addEventListener('click', function () { self._details(); });
            card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._details(); } });
          }
          this._built = true;
        }
        var e = this._e, f = this._first(), a = f.a;
        // ONLY WHILE AN ALERT IS LIVE. With none (or no sensor) the card hides
        // the way a conditional does, so a dashboard needs no wrapper around
        // it. The card editor's preview still draws it, saying when it shows.
        var sample = !f.n && !!this.preview;
        this._showAlert(f.n > 0 || sample);
        if (!f.n && !sample) return;

        // NWS severity vocabulary: Extreme / Severe / Moderate / Minor /
        // Unknown. One colour for all would make a tornado warning and a
        // frost advisory look identical.
        var sev = String(a.Severity || '').toLowerCase();
        e.icon.style.color = (sev === 'extreme' || sev === 'severe')
          ? 'rgba(255, 69, 58, 0.98)'
          : sev === 'moderate' ? 'rgba(255, 159, 10, 0.98)'
          : 'rgba(255, 214, 10, 0.98)';

        var title = cfg.title || 'Severe Weather';
        if (e.title.textContent !== title) e.title.textContent = title;
        var src = cfg.source || 'National Weather Service';
        if (e.src.textContent !== src) e.src.textContent = src;

        var ev = sample ? 'Shown here only while an alert is active'
               : (a.Event || a.Headline || 'Severe weather');
        var iso = a.Ends || a.Expires;
        var body = ev + '.';
        if (iso) {
          var d = new Date(iso);
          if (!isNaN(d)) {
            var t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            var day = d.toLocaleDateString('en-US',
              { weekday: 'long', month: 'long', day: 'numeric' });
            body = ev + '. These conditions are expected to last until ' +
                   t + ', ' + day + '.';
          }
        }
        if (e.body.textContent !== body) e.body.textContent = body;

        var parts = [];
        if (a.Severity) parts.push(a.Severity);
        parts.push(sample ? 'No alerts now' : f.n + ' ' + (f.n === 1 ? 'alert' : 'alerts'));
        // AreasAffected can be a ~600-character semicolon list -- unusable
        // raw on a tablet, and the integration only reports for the home's
        // location anyway, so it is reduced to a count.
        var areas = String(a.AreasAffected || '').split(';')
                      .filter(function (x) { return x.trim(); }).length;
        if (areas > 1) parts.push(areas + ' areas');
        if (cfg.details && !sample) parts.push('Details ›');
        var count = parts.join('  ·  ');
        if (e.count.textContent !== count) e.count.textContent = count;
      }
    }

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
    window.addEventListener('location-changed', markEntry);
    window.addEventListener('popstate', markEntry);
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

    var PAGE_CSS = [
      // ---- the hero: no plate, the page's own text over the sky
      '.hero{text-align:center;padding:28px 12px 27px;color:' + C.v('ink') + ';text-shadow:' + C.v('glow') + '}',
      '.hero .pl{font-size:20px;font-weight:500;letter-spacing:-0.3px;display:flex;align-items:center;justify-content:center;gap:8px}',
      // THE TEMPERATURE IN FRONT OF ITS WEATHER, as the screensaver's weather
      // screen draws it (hk-saver-weather.js, 210 px digits over a 300 px
      // symbol): the symbol 1.43 times the digits' size, up and to the left,
      // the digits over its lower right; a sun or a moon glowing into the sky
      // behind; a white symbol eased back to 70 %. In em of the digits, so the
      // phone's smaller number keeps the same pair. (The saver's offsets are
      // to a .8 line box; this one is 1.06, .13 em taller above.)
      '.hero .now{position:relative;display:table;margin:3px auto 0}',
      // room above the digits for the symbol that rises over them (the saver
      // has the sky there; the page has the place's name)
      '.hero .tp{position:relative;isolation:isolate;margin-top:.62em}',
      // (the symbol's own em is 1.4286 of the digits': .38 / .5023 of it
      // are the saver's .5429 / .7176 of theirs)
      '.hero .bd{position:absolute;z-index:-1;pointer-events:none;line-height:0;font-size:1.4286em;letter-spacing:0;',
      '  left:calc(18px - .38em);top:-.5023em;filter:drop-shadow(0 4px 16px rgba(0,10,30,.25))}',
      '.hero .bd svg{display:block}',
      '.hero .pale .bd{opacity:.7}',
      '.hero .glow{position:absolute;z-index:-2;pointer-events:none;width:2.476em;height:2.476em;border-radius:50%;',
      '  left:calc(18px - .5429em - .5236em);top:calc(-.7176em - .5236em);background:radial-gradient(circle,rgba(255,214,10,.28),rgba(255,214,10,0) 62%)}',
      '.hero .night .glow{background:radial-gradient(circle,rgba(220,230,255,.16),rgba(220,230,255,0) 62%)}',
      '.hero .bd.calm *,.hero .bd.calm svg{animation:none!important}',
      '.hero .n{display:inline-block}',
      '.hero.anim .bd{animation:wxPop .7s ' + BUILD + ' backwards;animation-delay:60ms}',
      '.hero.anim .n{animation:wxUp .6s ' + BUILD + ' backwards;animation-delay:160ms}',
      '.hero.anim .cd{animation:wxUp .5s ' + BUILD + ' backwards;animation-delay:260ms}',
      '.hero.anim .hl{animation:wxUp .5s ' + BUILD + ' backwards;animation-delay:330ms}',
      '.hero.anim .ol{animation:wxUp .5s ' + BUILD + ' backwards;animation-delay:400ms}',
      '.hero .pl,.hero .cd,.hero .hl,.hero .ol{position:relative;z-index:1}',
      '.hero .tp{font-size:84px;font-weight:200;letter-spacing:-5px;line-height:1.06;padding-left:18px;font-variant-numeric:tabular-nums}',
      (window.hkHeader && window.hkHeader.wxMotionCss ? window.hkHeader.wxMotionCss('.hero .bd') : ''),
      ':host([data-wx-paused]) .hero .bd *,:host([data-wx-paused]) .hero .bd svg{animation-play-state:paused!important}',
      ':host([hk-still]) .hero .bd *,:host([hk-still]) .hero .bd svg{animation:none!important}',
      '.hero .cd{font-size:18px;font-weight:500;margin-top:2px}',
      '.hero .hl{font-size:15px;font-weight:500;margin-top:5px}',
      '.hero .hl span{margin-left:8px;color:' + C.v('ink-2') + '}',
      '.hero .ol{font-size:13px;font-weight:500;line-height:1.5;margin:13px auto 0;max-width:520px;color:' + C.v('ink-2') + '}',
      '@media (max-width:' + C.BP.phone + 'px){.hero{padding:27px 12px 22px}.hero .tp{font-size:76px}.hero .ol{max-width:290px}}',
      // ---- the page's plates: hourly and daily (hkCards.plate, CARD's 20 / 22)
      'ha-card.wxp{box-sizing:border-box;display:flex;flex-direction:column;padding:' + C.CARD.pad + ';margin:0;' + C.plate('card') + ';overflow:hidden;',
      '  color:' + C.v('ink') + ';--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      '.wxp .hd{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:34px}',
      '.wxp .tt{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:' + C.v('ink-2') + ';white-space:nowrap}',
      '.wxp .tt ha-icon{--mdc-icon-size:17px;width:17px;height:17px;flex:none;display:flex;align-items:center;justify-content:center;line-height:0}',
      '.wxp .wait{margin:auto;padding:24px 0;font-size:14px;color:' + C.v('ink-3') + ';text-align:center}',
      C.segCss('.wxp .seg'),
      '.wxp .seg button:disabled{opacity:.4;cursor:default}',
      // the hours: a sideways scroller of their own (never the page's)
      '.wxp .hs{overflow-x:auto;overflow-y:hidden;margin:17px -6px 0;padding:0 6px;scrollbar-width:thin;',
      '  scrollbar-color:' + C.v('line-strong') + ' transparent;touch-action:pan-x pan-y;overscroll-behavior-x:contain}',
      '.wxp .hrs{display:grid;gap:5px}',
      '.wxp .hr{position:relative;display:flex;flex-direction:column;align-items:center;gap:9px;border:0;background:none;',
      '  font:inherit;color:inherit;padding:8px 4px 10px;min-height:103px;border-radius:12px;cursor:pointer;margin:0;-webkit-tap-highlight-color:transparent}',
      '.wxp .hr[aria-pressed="true"]{background:' + C.v('key') + '}',
      '.wxp .hr:focus-visible,.wxp .dy:focus-visible{outline:2px solid ' + C.v('ink-2') + ';outline-offset:-2px}',
      '.wxp .hr .t{font-size:12px;font-weight:600;color:' + C.v('ink-2') + ';white-space:nowrap}',
      '.wxp .hr .t.now{color:' + C.v('ink') + '}',
      '.wxp .hr b{font-size:18px;font-weight:600;letter-spacing:-0.3px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.wxp .hr b small{font-size:10px;font-weight:500;color:' + C.v('ink-2') + ';margin-left:2px}',
      // Reserve the full percentage line even when Rain/Wind leave it empty.
      '.wxp .hr .p{font-size:10px;font-weight:600;min-height:16px;line-height:16px;color:var(--hk-wx-c,#64D2FF)}',
      BUILD_CSS,
      '.anim .hr{animation:wxUp .55s ' + BUILD + ' backwards;animation-delay:calc(var(--i,0) * 40ms + 120ms)}',
      '.anim .hr svg{animation:wxPop .5s ' + BUILD + ' backwards;animation-delay:calc(var(--i,0) * 40ms + 220ms)}',
      '.anim .dy{animation:wxUp .5s ' + BUILD + ' backwards;animation-delay:calc(var(--i,0) * 50ms + 120ms)}',
      '.anim .rg i{animation:wxWipe .9s ' + BUILD + ' backwards;animation-delay:calc(var(--i,0) * 50ms + 260ms)}',
      '.anim .rg b{animation:wxPop .45s ' + BUILD + ' backwards;animation-delay:1s}',
      '.wxp .rd{display:flex;justify-content:space-between;gap:10px;border-top:1px solid ' + C.v('line') + ';padding-top:10px;margin-top:10px;',
      '  font-size:12px;font-weight:500;color:' + C.v('ink-2') + ';min-height:16px}',
      '.wxp .rd span{color:' + C.v('ink-3') + ';white-space:nowrap}',
      '@media (max-width:' + C.BP.phone + 'px){.wxp.hrly .hd{flex-direction:column;align-items:stretch;gap:12px}',
      '  .wxp.hrly .seg button{flex:1 1 0}.wxp .rd{flex-direction:column;gap:5px}.wxp .hs{margin-top:10px}}',
      // the days: on one shared scale, low to high
      'ha-card.wxp.dly{height:var(--hk-wx-pair-h,455px)}',
      ':host([data-hk-cell]) ha-card.wxp.dly{height:100%}',
      '.wxp.dly .hd{margin-bottom:6px}',
      '.wxp .dys{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}',
      '.wxp .dy{flex:1 1 0;display:grid;grid-template-columns:50px 35px 34px minmax(25px,1fr) 34px;align-items:center;gap:10px;',
      '  min-height:32px;padding:0;border:0;border-bottom:1px solid ' + C.v('line') + ';background:none;font:inherit;color:inherit;',
      '  text-align:left;width:100%;cursor:pointer;margin:0;-webkit-tap-highlight-color:transparent}',
      '.wxp .dy:last-child{border-bottom:0}',
      '.wxp .dy .dn{font-size:14px;font-weight:600}',
      '.wxp .dy .di{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}',
      '.wxp .dy .di small{font-size:9px;font-weight:600;color:var(--hk-wx-c,#64D2FF)}',
      '.wxp .dy .lo,.wxp .dy .hi{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.wxp .dy .lo{color:' + C.v('ink-2') + ';text-align:right}',
      '.wxp .dy .hi{text-align:right}',
      '.wxp .rg{position:relative;height:4px;border-radius:' + C.R.capsule('4px') + ';background:' + C.v('line-strong') + '}',
      '.wxp .rg i{position:absolute;top:0;bottom:0;border-radius:inherit;background:linear-gradient(90deg,#64d2ff,#ffd60a,#ff9f0a)}',
      '.wxp .rg b{position:absolute;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.35)}',
      '.wxp .ft{border-top:1px solid ' + C.v('line') + ';padding-top:10px;font-size:12px;font-weight:500;color:' + C.v('ink-2') + '}',
      '@media (max-width:' + C.BP.phone + 'px){.wxp .dy{grid-template-columns:52px 40px 32px minmax(25px,1fr) 32px;gap:8px}}'
    ].join('');

    var PAGE_METHODS = {
      _section() { var s = (this._config || {}).section; return SECTIONS.indexOf(s) >= 0 ? s : null; },
      // how the forecast stands: 'ok' (has entries), 'wait' (asked, not yet
      // answered), 'none' (the service gave none)
      _fcState(kind, list) {
        if (list.length) return 'ok';
        var src = this._sources()[kind];
        if (src) return 'none';
        var w = (this._fcW || {})[kind + '|' + this._config.entity];
        return w && !w.has() ? 'wait' : 'none';
      },
      _hours(n) {
        var now = Date.now();
        return this._forecast('hourly', this._sources().hourly).filter(function (h) {
          return !(Date.parse(h.datetime) + 3600e3 <= now);
        }).slice(0, n);
      },
      _days(n) { return upcomingDays(this._forecast('daily', this._sources().daily)).slice(0, n); },
      _service() {
        var st = this._st(this._config.entity), a = (st && st.attributes) || {};
        return a.friendly_name || '';
      },
      _units() {
        var st = this._st(this._config.entity), a = (st && st.attributes) || {};
        var HS = window.hkSettings;
        return { wind: HS && HS.unit ? HS.unit(st, 'wind_speed_unit', 'mph') : (a.wind_speed_unit || 'mph') };
      },
      _renderSection() {
        if (!this._config || !this._hass) return;
        var s = this._section();
        if (s === 'hero') this._renderHero();
        else if (s === 'hourly') this._renderHourly();
        else this._renderDaily();
      },

      // ---- THE HERO
      // THE TEMPERATURE NOW, as the weather sheet and Climate's Outside &
      // Ahead read it: the house's outside sensor when Settings names one,
      // else the weather service's -- one number for "now" on the page
      _nowTemp() {
        var src = this._sources(), st = this._st(this._config.entity), o = src.outside && this._st(src.outside);
        var v = o ? num(o.state) : null;
        return v !== null ? v : num(((st && st.attributes) || {}).temperature);
      },
      _renderHero() {
        var cfg = this._config, states = this._hass.states, st = states[cfg.entity] || {}, a = st.attributes || {};
        var src = this._sources();
        var t = this._nowTemp();
        var feels = src.feels ? num((states[src.feels] || {}).state) : num(a.apparent_temperature);
        var cond = window.hkHeader && window.hkHeader.conditionName ? window.hkHeader.conditionName(st.state) : String(st.state || '');
        var hrs = this._hours(12), days = this._days(1), today = days[0] || {};
        var hi = num(today.temperature), lo = num(today.templow);
        var place = titled(cfg.place || this._place());
        var night = !!(window.hkHeader && window.hkHeader.isNight && window.hkHeader.isNight(states));
        var hasSym = !!(window.hkHeader && window.hkHeader.wxSvg) && !/^(unknown|unavailable)$/.test(st.state || 'unknown');
        var html = '<div class="hero" role="group" aria-label="Current weather">' +
          '<div class="pl">' + esc(place) + '</div>' +
          '<div class="now' + (st.state === 'sunny' ? '' : ' pale') + (night ? ' night' : '') + '"><div class="tp">' +
          (/^(sunny|clear-night|partlycloudy)$/.test(st.state) ? '<div class="glow" aria-hidden="true"></div>' : '') +
          '<div class="bd" aria-hidden="true">' + (hasSym ? window.hkHeader.wxSvg(st.state, '1em', { night: night, sym: true }) : '') + '</div>' +
          '<span class="n">' + (t !== null ? Math.round(t) + '°' : '--') + '</span></div></div>' +
          '<div class="cd">' + esc(cond || '--') + '</div>' +
          (hi !== null || lo !== null ? '<div class="hl">' + (hi !== null ? 'H:' + Math.round(hi) + '°' : '') +
            (lo !== null ? '<span>L:' + Math.round(lo) + '°</span>' : '') + '</div>' : '') +
          '<p class="ol">' + esc(this._outlook(t, feels, hrs)) + '</p></div>';
        C.morph(this._root, html);
        this._balanceHero();
        if (buildDue(this)) build(this, this._root.querySelector('.hero'));
      },
      // THE PAIR CENTERED ON ITS INK, as the screensaver balances it: what is
      // drawn -- the symbol's paths (at rest: a turning ray or a drifting
      // cloud would move the edge) and the number's ink, a 1 narrow, a cloud
      // with a sun wide -- not the boxes. Only when what is drawn changed.
      _balanceHero() {
        var now = this._root.querySelector && this._root.querySelector('.hero .now');
        var tp = now && now.querySelector('.tp'), bd = now && now.querySelector('.bd');
        if (!tp || !bd || typeof tp.getBoundingClientRect !== 'function' || !this.isConnected) return;
        var nEl = tp.querySelector('.n'), text = String(nEl ? nEl.textContent : tp.textContent).trim();
        var key = text + '|' + bd.innerHTML.length;
        if (key === this._heroKey) return;
        now.style.transform = '';
        bd.classList.add('calm');
        var L = 1e9, R = -1e9;
        bd.querySelectorAll('svg path').forEach(function (p) {
          var b = p.getBoundingClientRect();
          if (b.width) { L = Math.min(L, b.left); R = Math.max(R, b.right); }
        });
        bd.classList.remove('calm');
        var tb = tp.getBoundingClientRect(), cs = getComputedStyle(tp);
        if (!tb.width) return;
        try {
          var cv = (PAGE_METHODS._cv = PAGE_METHODS._cv || document.createElement('canvas')).getContext('2d');
          cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          if ('letterSpacing' in cv) cv.letterSpacing = cs.letterSpacing;
          var m = cv.measureText(text), x0 = tb.left + (parseFloat(cs.paddingLeft) || 0);
          L = Math.min(L, x0 - (m.actualBoundingBoxLeft || 0));
          R = Math.max(R, x0 + m.actualBoundingBoxRight);
        } catch (e) { L = Math.min(L, tb.left); R = Math.max(R, tb.right); }
        var hero = this._root.querySelector('.hero').getBoundingClientRect();
        if (!hero.width || L > R) return;
        now.style.transform = 'translateX(' + ((hero.left + hero.width / 2) - (L + R) / 2).toFixed(1) + 'px)';
        this._heroKey = key;
      },
      // ONE LINE OF WHAT IS COMING, from the forecast alone: rain when it is
      // likely, else where the temperature goes, and how it feels when that
      // differs. Nothing it doesn't have -- no forecast, no line about it.
      _outlook(t, feels, hrs) {
        var out = [];
        var wet = null;
        for (var i = 0; i < hrs.length; i++) {
          var p = num(hrs[i].precipitation_probability);
          if (p !== null && p >= 40) { wet = { h: hrs[i], p: p }; break; }
        }
        if (wet) out.push((wet.p >= 60 ? 'Rain likely' : 'A chance of rain') + ' around ' + hourLabel(wet.h.datetime) + '.');
        else {
          var ts = hrs.map(function (h) { return { t: num(h.temperature), at: h.datetime }; }).filter(function (x) { return x.t !== null; });
          if (ts.length > 2 && t !== null) {
            var lo = ts.reduce(function (m, x) { return x.t < m.t ? x : m; }), hi = ts.reduce(function (m, x) { return x.t > m.t ? x : m; });
            if (lo.t <= t - 3) out.push('Cooling to ' + Math.round(lo.t) + '° by ' + hourLabel(lo.at) + '.');
            else if (hi.t >= t + 3) out.push('Warming to ' + Math.round(hi.t) + '° by ' + hourLabel(hi.at) + '.');
            else out.push('Steady near ' + Math.round(t) + '° for the next ' + ts.length + ' hours.');
          }
        }
        if (feels !== null && t !== null && Math.abs(feels - t) >= 3) out.push('Feels like ' + Math.round(feels) + '°.');
        return out.join(' ');
      },

      // ---- THE HOURS
      _renderHourly() {
        var self = this, cfg = this._config, states = this._hass.states;
        var pg = wxPage(), hrs = this._hours(pg.hours), state = this._fcState('hourly', hrs);
        var has = {
          temperature: hrs.some(function (h) { return num(h.temperature) !== null; }),
          rain: hrs.some(function (h) { return num(h.precipitation_probability) !== null; }),
          wind: hrs.some(function (h) { return num(h.wind_speed) !== null; })
        };
        // the saved view, else the first the forecast has (the saved one stays saved)
        var metric = this._metric || pg.hourly_metric;
        if (!has[metric]) metric = WX_METRIC_ORDER.filter(function (m) { return has[m]; })[0] || 'temperature';
        this._metricShown = metric;
        if (this._sel != null && this._sel >= hrs.length) this._sel = null;
        if (!this._built) {
          this._root.innerHTML = '<ha-card class="wxp hrly"><div class="hd">' +
            '<div class="tt"><ha-icon icon="hk:clock"></ha-icon>Hourly Forecast</div>' +
            '<div class="seg" role="radiogroup" aria-label="Hourly forecast shows"></div></div>' +
            '<div class="hs"><div class="hrs"></div></div><div class="rd" aria-live="polite"></div></ha-card>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { seg: q('.seg'), hs: q('.hs'), hrs: q('.hrs'), rd: q('.rd') };
          this._e.seg.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button[data-m]');
            if (!b || b.disabled) return;
            var from = C.segBox(self._e.seg.querySelector('[aria-selected="true"]'));
            self._metric = b.getAttribute('data-m');
            self.redraw();
            C.slideSeg(self._e.seg.querySelector('[aria-selected="true"]'), from);
          });
          this._e.hrs.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('button[data-i]');
            if (!b) return;
            var i = Number(b.getAttribute('data-i'));
            self._sel = self._sel === i ? null : i;
            self.redraw();
          });
          this._built = true;
        }
        var e = this._e;
        C.morph(e.seg, WX_METRIC_ORDER.map(function (m) {
          var on = m === metric;
          return '<button type="button" role="radio" data-m="' + m + '" aria-selected="' + on + '" aria-checked="' + on + '"' +
            (has[m] ? '' : ' disabled aria-disabled="true" title="Not in this forecast"') + '>' + { temperature: 'Temperature', rain: 'Rain', wind: 'Wind' }[m] + '</button>';
        }).join(''));
        var wu = this._units().wind;
        var now0 = this._nowTemp();
        var say = function (h, i) {
          var tt = i === 0 && now0 !== null ? now0 : num(h.temperature), p = num(h.precipitation_probability), w = num(h.wind_speed);
          var bits = [i === 0 ? 'Now' : hourLabel(h.datetime)];
          if (tt !== null) bits.push(Math.round(tt) + '°');
          if (h.condition && window.hkHeader && window.hkHeader.conditionName) bits.push(window.hkHeader.conditionName(h.condition));
          if (p !== null) bits.push(Math.round(p) + '% chance of rain');
          if (w !== null) bits.push(Math.round(w) + ' ' + wu + ' wind');
          var f = num(h.apparent_temperature);
          if (f !== null && tt !== null && Math.abs(f - tt) >= 2) bits.push('feels ' + Math.round(f) + '°');
          return bits.join(' · ');
        };
        var cells = hrs.map(function (h, i) {
          // Now is the reading now (the hero's), the rest the forecast
          var tt = i === 0 && now0 !== null ? now0 : num(h.temperature), p = num(h.precipitation_probability), w = num(h.wind_speed), nt = nightOf(states, h);
          var val = metric === 'rain' ? (p !== null ? Math.round(p) + '%' : '--')
            : metric === 'wind' ? (w !== null ? Math.round(w) + '<small>' + esc(wu) + '</small>' : '--')
            : (tt !== null ? Math.round(tt) + '°' : '--');
          return '<button type="button" class="hr" style="--i:' + i + '" data-i="' + i + '" aria-pressed="' + (self._sel === i) + '" aria-label="' + esc(say(h, i)) + '">' +
            '<span class="t' + (i === 0 ? ' now' : '') + '">' + (i === 0 ? 'Now' : hourLabel(h.datetime)) + '</span>' +
            glyph(h.condition === 'clear-night' && !nt ? 'sunny' : h.condition, 25, nt) +
            '<b>' + val + '</b><span class="p">' + (metric === 'temperature' && p !== null && p >= 20 ? Math.round(p) + '%' : '') + '</span></button>';
        }).join('');
        var was = e.hrs.getAttribute('data-state');
        e.hrs.style.gridTemplateColumns = hrs.length ? 'repeat(' + hrs.length + ',minmax(64px,1fr))' : '1fr';
        e.hrs.style.minWidth = hrs.length ? (hrs.length * 64 + (hrs.length - 1) * 5) + 'px' : '';
        C.morph(e.hrs, hrs.length ? cells : '<div class="wait">' + (state === 'wait' ? 'Loading the forecast…' : 'No hourly forecast from ' + esc(this._service() || 'the weather service') + '.') + '</div>');
        e.hrs.setAttribute('data-state', state);
        if (hrs.length && buildDue(this)) build(this, this._root.querySelector('ha-card.wxp'));
        else if (was === 'wait' && state === 'ok') arrive(e.hrs);
        var rd = this._sel != null && hrs[this._sel] ? esc(say(hrs[this._sel], this._sel)) : (hrs.length ? 'Tap an hour for its details' : '');
        C.morph(e.rd, rd + (this._service() ? '<span>' + esc(this._service()) + '</span>' : ''));
      },

      // ---- THE DAYS
      _renderDaily() {
        var self = this, cfg = this._config, st = this._st(cfg.entity) || {}, a = st.attributes || {};
        var pg = wxPage(), days = this._days(pg.days), state = this._fcState('daily', days);
        var t = num(a.temperature);
        if (!this._built) {
          this._root.innerHTML = '<ha-card class="wxp dly"><div class="hd"><div class="tt"><ha-icon icon="mdi:calendar-month"></ha-icon><span class="nm"></span></div></div>' +
            '<div class="dys" role="list"></div><div class="ft"></div></ha-card>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { nm: q('.nm'), dys: q('.dys'), ft: q('.ft') };
          this._e.dys.addEventListener('click', function (ev) {
            var b = ev.target.closest && ev.target.closest('button[data-d]');
            if (!b || !window.hkDetail || !window.hkDetail.open) return;
            window.hkDetail.open(self._config.entity, { focus: 'day', day: Number(b.getAttribute('data-d')) });
          });
          this._built = true;
        }
        var e = this._e;
        var name = days.length ? days.length + '-Day Forecast' : 'Daily Forecast';
        if (e.nm.textContent !== name) e.nm.textContent = name;
        var vals = [];
        days.forEach(function (d) { [num(d.templow), num(d.temperature)].forEach(function (x) { if (x !== null) vals.push(x); }); });
        var mn = vals.length ? Math.min.apply(null, vals) : 0, mx = vals.length ? Math.max.apply(null, vals) : 1, span = Math.max(1, mx - mn);
        var pct = function (x) { return ((x - mn) / span * 100).toFixed(1); };
        var rows = days.map(function (d, i) {
          var hi = num(d.temperature), lo = num(d.templow), p = num(d.precipitation_probability);
          var nm = i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString('en-US', { weekday: 'short' });
          var long = i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString('en-US', { weekday: 'long' });
          var cn = window.hkHeader && window.hkHeader.conditionName ? window.hkHeader.conditionName(d.condition === 'clear-night' ? 'sunny' : d.condition) : '';
          var dot = i === 0 && t !== null && lo !== null && hi !== null ? '<b style="left:' + pct(Math.max(mn, Math.min(mx, t))) + '%"></b>' : '';
          var label = long + ': ' + (cn ? cn + ', ' : '') + (lo !== null ? 'low ' + Math.round(lo) + '°, ' : '') + (hi !== null ? 'high ' + Math.round(hi) + '°' : '') +
            (p !== null ? ', ' + Math.round(p) + '% chance of rain' : '');
          return '<button type="button" class="dy" role="listitem" style="--i:' + i + '" data-d="' + i + '" aria-label="' + esc(label) + '">' +
            '<span class="dn">' + nm + '</span><span class="di">' + glyph(d.condition === 'clear-night' ? 'sunny' : d.condition, 22, false) +
            (p !== null && p >= 20 ? '<small>' + Math.round(p) + '%</small>' : '') + '</span>' +
            '<span class="lo">' + (lo !== null ? Math.round(lo) + '°' : '') + '</span>' +
            '<span class="rg">' + (lo !== null && hi !== null ? '<i style="left:' + pct(lo) + '%;right:' + (100 - pct(hi)) + '%"></i>' + dot : '') + '</span>' +
            '<span class="hi">' + (hi !== null ? Math.round(hi) + '°' : '') + '</span></button>';
        }).join('');
        var was = e.dys.getAttribute('data-state');
        C.morph(e.dys, days.length ? rows : '<div class="wait">' + (state === 'wait' ? 'Loading the forecast…' : 'No daily forecast from ' + esc(this._service() || 'the weather service') + '.') + '</div>');
        e.dys.setAttribute('data-state', state);
        if (days.length && buildDue(this)) build(this, this._root.querySelector('ha-card.wxp'));
        else if (was === 'wait' && state === 'ok') arrive(e.dys);
        // the week in a line: its warmest and coolest days
        var ft = '';
        if (days.length > 2) {
          var his = days.map(function (d, i) { return { v: num(d.temperature), i: i }; }).filter(function (x) { return x.v !== null; });
          if (his.length > 2) {
            var w = his.reduce(function (m, x) { return x.v > m.v ? x : m; }), c = his.reduce(function (m, x) { return x.v < m.v ? x : m; });
            var dn = function (i) { return i === 0 ? 'today' : new Date(days[i].datetime).toLocaleDateString('en-US', { weekday: 'long' }); };
            ft = 'Warmest ' + dn(w.i) + ' at ' + Math.round(w.v) + '°, coolest ' + dn(c.i) + ' at ' + Math.round(c.v) + '°.';
          }
        }
        e.ft.style.display = ft ? '' : 'none';
        if (e.ft.textContent !== ft) e.ft.textContent = ft;
      }
    };

    class HkWeatherBandCard extends Base {

      // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)

      static get FLAT_MOTION() { return true; }
      static get CSS() {
        return [
          // The plate: a page card's (hkCards.plate, CARD's 20 / 22 padding),
          // and the band's own 12px bottom margin.
          'ha-card.band{' + window.hkCards.plate('card') + ';',
          '  padding:' + window.hkCards.CARD.pad + ';margin:0 0 12px 0;',
          '  display:block;overflow:hidden}',
          // A GRID WITH A FIXED 300px LEFT TRACK AND A 24px COLUMN GAP. A
          // flex row with a content-sized left block and no gap looks fine,
          // but its hourly tracks come out 53.5px instead of 40px, because the
          // left column is ~48px narrower than it should be. Measure it; do
          // not judge it by looking.
          // the left track: 300px, or the card's `now_width` (the
          // screensaver's band beside its calendar pane: 200)
          '.wrap{display:grid;grid-template-columns:var(--hk-now-w,300px) 1px minmax(0,1fr);',
          '  column-gap:24px;align-items:stretch;width:100%;min-width:0}',
          // LEFT: the centred stack. The 76px numeral at weight 200 is the
          // signature of the whole page and is only possible because
          // fonts/sf-pro.css declares the variable font across `1 1000`.
          '.now{display:flex;flex-direction:column;justify-content:center;',
          '  align-items:center;text-align:center;padding:0 8px;height:100%}',
          '.place{font-size:13px;font-weight:600;letter-spacing:0.3px;',
          '  color:' + window.hkCards.v('ink-2') + '}',
          '.temp{font-size:76px;font-weight:200;letter-spacing:-2px;',
          '  line-height:1.04;margin-top:6px;color:' + window.hkCards.v('ink') + '}',
          '.cond{font-size:21px;font-weight:600;letter-spacing:-0.3px;',
          '  margin-top:2px;color:' + window.hkCards.v('ink') + '}',
          '.sub{font-size:14px;font-weight:500;margin-top:8px;',
          '  color:' + window.hkCards.v('ink-2') + '}',
          '.sub.wind{margin-top:2px}',
          '.rule{background:' + RULE + ';width:1px}',
          // NARROW (a phone): when no forecast column fits beside
          // the stack the band STACKS -- conditions on top, the strips below at
          // full width, the rule turned horizontal between them. Kept at three
          // columns, the third track would be ~21px, and the only thing
          // visible of the forecast its vertical rule.
          '.wrap.narrow{grid-template-columns:minmax(0,1fr);row-gap:16px}',
          '.wrap.narrow .now{padding:0;height:auto}',
          '.wrap.narrow .rule{width:100%;height:1px}',
          // RIGHT: hours over days, one divider between.
          '.cols{display:flex;flex-direction:column;justify-content:center;',
          '  gap:14px;min-width:0}',
          // THE TRACK COUNT FOLLOWS THE CELL COUNT and is set inline per
          // render. A hardcoded `repeat(12, ...)` packs six cells into the
          // first six of twelve tracks and leaves half the band empty.
          '.strip{display:grid;column-gap:4px}',
          '.hrule{height:0;border-top:1px solid ' + RULE + ';width:100%}',     // a border: snapped to device pixels
          '.cell{display:flex;flex-direction:column;align-items:center;',
          '  gap:5px;min-width:0}',
          '.lbl{font-size:13px;font-weight:600;color:' + window.hkCards.v('ink-2') + ';',
          '  white-space:nowrap}',
          '.lbl.now{font-weight:700;color:' + window.hkCards.v('ink') + ';padding:0;',
          '  display:block}',
          '.hi{font-size:17px;font-weight:700;letter-spacing:-0.3px;',
          '  color:' + window.hkCards.v('ink') + '}',
          '.lo{font-size:13px;font-weight:500;color:' + window.hkCards.v('ink-2') + '}',
          '.pop{font-size:12px;font-weight:500;color:' + window.hkCards.v('ink-3') + '}',
          '.pop.wet{color:' + window.hkCards.v('ink-2') + '}',
          // PLAIN (`plain: true`, the screensaver's): no plate -- the band
          // drawn straight on what is behind it, every line white, with a
          // soft shadow for the contrast the plate gave. The 24px sides stay,
          // so the columns sit where they do on the plate (and the 397 in
          // _fit stays true); top and bottom go, so the band's text is its
          // edge.
          'ha-card.band.plain{background:none;border:none;border-radius:0;box-shadow:none;',
          '  -webkit-backdrop-filter:none;backdrop-filter:none;padding:0 24px;margin:0}',
          '.plain .wrap{text-shadow:var(--hk-glow,0 1px 3px rgba(0,0,0,0.45),0 4px 18px rgba(0,0,0,0.35))}',
          '.plain .place,.plain .sub,.plain .lbl,.plain .lo,.plain .pop.wet{color:var(--hk-ink-2,#fff)}',
          '.plain .pop{color:var(--hk-ink-3,#fff)}',
          '.plain .temp,.plain .cond,.plain .lbl.now,.plain .hi{color:var(--hk-ink,#fff)}'
        ].join('') + PAGE_CSS;
      }

      get hass() { return super.hass; }
      set hass(h) { houseWeather(this, h, BAND_KEYS); super.hass = h; }
      setConfig(config) {
        if (config && config.section != null && SECTIONS.indexOf(config.section) < 0) {
          throw new Error('hk-weather-band: `section` must be hero, hourly or daily');
        }
        this._hkOwn = ownKeys(config, BAND_KEYS);
        // DEFAULTS TO NONE, and that is deliberate. HkBase._bind passes
        // `tapKey === 'tap_action'` as its defaultMoreInfo flag, so an unset
        // tap_action would open the weather entity's more-info dialog -- HA
        // chrome over a page that already says everything the dialog would.
        //
        // The Weather PAGE leaves it unset: tapping the band there would
        // navigate to the page you are already on. The Tesla sets it, because
        // there the band is a summary and the page is somewhere to go.
        super.setConfig(Object.assign({ tap_action: { action: 'none' } }, config));
        houseWeather(this, this._hass, BAND_KEYS);
      }

      // ---------------------------------------------------------------
      // HOW MANY COLUMNS FIT, MEASURED -- not stated, and not guessed from
      // window.innerWidth.
      //
      // `hours` and `days` are MAXIMA. The Weather page never wants more than
      // twelve hours even if a wider screen could hold twenty, so the cap
      // stays config. The COUNT is not: the Tesla's band sits in a ~700px
      // column and the page's in a ~920px one, so the same numbers cannot
      // serve both. Each call site states its cap and the card fills it.
      //
      // THE MEASUREMENT IS THE HOST, NOT THE STRIP. The host's width does not
      // depend on how many columns are drawn, so observing it cannot feed
      // back into itself; observing the strip would re-fire the observer on
      // every re-render. The 397 below is everything between the host edge
      // and the strips: 48 of card padding + the 300px left track + 24 gap +
      // the 1px rule + 24 gap. On a NARROW host (see .wrap.narrow) the strips
      // sit under the stack and get everything but the 48 of padding.
      _width() {
        // The width the ResizeObserver last reported; clientWidth only before
        // it has (a layout read, and _sigOf runs on every hass push).
        return this._w != null ? this._w : this.clientWidth;
      }
      // everything beside the strips when side by side: 48 of padding, the
      // left track, 24 + 1 + 24 of gap and rule (397 at the usual 300)
      _nowW() { var n = Number((this._config || {}).now_width); return n >= 120 && n <= 400 ? n : 300; }
      _side() { return 97 + this._nowW(); }
      _narrow() {
        var c = this._config || {};
        // `narrow: true`: stood up whatever the width (the screensaver's
        // band beside its calendar pane)
        if (c.narrow === true) { return true; }
        var w = this._width();
        if (!w) { return false; }
        return (w - this._side()) < (Number(c.min_hour_col) || 40);
      }
      _fit(max, minCol) {
        var w = this._width();
        if (!w) { return max; }                 // pre-layout: cap, then correct
        var avail = this._narrow() ? w - 48 : w - this._side();
        if (avail <= 0) { return 1; }
        // n columns take n*minCol + (n-1)*GAP, so n = (avail + GAP) / (minCol + GAP)
        var n = Math.floor((avail + 4) / (minCol + 4));
        return Math.max(1, Math.min(max, n));
      }

      _counts() {
        var c = this._config || {};
        return {
          // 40 and 55 are MEASURED FLOORS, not taste. The Weather page draws
          // its twelve hours at 40.0px and its eight days at 62.0px and reads
          // cleanly; twelve hours in ~380px -- 28px each -- run together as
          // `Now1 AM2 AM3 AM`.
          hours: this._fit(Number(c.hours) || 12, Number(c.min_hour_col) || 40),
          days: this._fit(Number(c.days) || 8, Number(c.min_day_col) || 55)
        };
      }

      connectedCallback() {
        if (super.connectedCallback) { super.connectedCallback(); }
        wxEnter(this);
        if (this._section() === 'hero') {
          // measured again once SF Pro is in (the first draw can be in a fallback face)
          var self0 = this;
          this._heroKey = null;
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self0._heroKey = null; self0._balanceHero(); });
          else this._balanceHero();
        }
        if (this._section() === 'hero' && !this._heroVisibility) {
          var hero = this;
          this._heroVisible = true;
          this._heroVisibility = function () {
            if (document.hidden || !hero._heroVisible) hero.setAttribute('data-wx-paused', '');
            else hero.removeAttribute('data-wx-paused');
          };
          document.addEventListener('visibilitychange', this._heroVisibility);
          if (typeof IntersectionObserver === 'function') {
            this._heroObserver = new IntersectionObserver(function (entries) {
              hero._heroVisible = entries.some(function (e) { return e.isIntersecting; });
              hero._heroVisibility();
            });
            this._heroObserver.observe(this);
          }
          this._heroVisibility();
        }
        if (this._section()) { return; }
        if (this._ro || typeof ResizeObserver !== 'function') { return; }
        var self = this;
        this._ro = new ResizeObserver(function (entries) {
          var e = entries && entries[0];
          self._w = (e && e.contentRect) ? e.contentRect.width : self.clientWidth;
          var n = self._counts();
          // ONLY when the count actually changes. A resize that does not cross
          // a column boundary must not re-render, or every drag of a window
          // rebuilds the card.
          if (n.hours === self._nH && n.days === self._nD &&
              self._narrow() === self._nN) { return; }
          self.redraw();
        });
        this._ro.observe(this);
      }

      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        wxLeave(this);
        if (this._heroObserver) { this._heroObserver.disconnect(); this._heroObserver = null; }
        if (this._heroVisibility) {
          document.removeEventListener('visibilitychange', this._heroVisibility);
          this._heroVisibility = null;
        }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._w = null;
        this._fcRelease();
        // A RE-ATTACHED BAND MUST ASK AGAIN. The subscriptions are gone, but
        // the render gate would still hold the old signature, so the next
        // hass push would find nothing to do and the cached forecast would
        // stay on screen until the weather entity itself changed. A fresh
        // ResizeObserver's first notification may happen to force a render;
        // the gate should not depend on that.
        this._hkSig = null;
      }

      // The label over the temperature: the card's own `place`, else the one
      // chosen in Configure, else the home's name.
      _place() {
        var HS = window.hkSettings;
        var p = HS ? HS.get('weather.place', null) : null;
        if (p) return p;
        var name = (this._hass && this._hass.config && this._hass.config.location_name) || 'Home';
        return String(name).toUpperCase();
      }

      // The band reads two FORECAST sensors the config does not name, so the
      // base class's default signature would gate on the weather entity alone
      // and never redraw when a forecast arrived.
      _sigOf() {
        var h = this._hass, c = this._config;
        if (!h || !c) return null;
        var src = this._sources();
        var ids = [c.entity, src.hourly, src.daily, src.feels, src.humidity, src.wind, src.outside];
        var out = 'fc=' + (this._fcN || 0) + ';';
        for (var i = 0; i < ids.length; i++) {
          var st = h.states[ids[i]];
          out += ids[i] + '=' + (st ? st.last_updated : 'x') + ';';
        }
        // The fitted counts are part of "has anything changed" -- without them
        // a card that resized across a column boundary between state updates
        // would be gated out and keep the old column count.
        var n = this._counts();
        // The hour is in it too: the first hourly slot leaves the band when
        // its hour ends, whether or not the sensor has been refreshed yet.
        if (this._section()) {
          // the page's: its settings (read live), the sun (night glyphs) and the hour
          var sun = h.states['sun.sun'];
          return out + 'p=' + JSON.stringify(wxPage()) + ';s=' + (sun ? sun.state : '') + ';h=' + Math.floor(Date.now() / 3600e3);
        }
        return out + 'n=' + n.hours + '/' + n.days + (this._narrow() ? 'N' : '') +
          ';h=' + Math.floor(Date.now() / 3600e3);
      }

      // WHERE EACH NUMBER COMES FROM: Configure -> Weather
      // (hk-settings.js). A sensor left unset is null, and the render then
      // reads the weather entity's own attribute (or, for a forecast, asks
      // the weather entity directly -- see _forecast).
      _sources() {
        var HS = window.hkSettings;
        var g = function (k) { return HS ? HS.get('weather.' + k, null) : null; };
        return { feels: g('feels_like'), humidity: g('humidity'), wind: g('wind'),
                 hourly: g('forecast_hourly'), daily: g('forecast_daily'), outside: g('outside') };
      }

      // A FORECAST SENSOR IS OPTIONAL. Since Home Assistant 2024.4 a weather
      // entity carries no forecast attribute, so the usual answer is a
      // trigger template sensor fed by weather.get_forecasts. A home without
      // one gets the forecast the way Home Assistant's own weather card does:
      // weather/subscribe_forecast, shared with every other card and sheet
      // that wants it (hkWxForecast, above), let go when the card leaves the
      // page. A refusal backs off there and the card draws no forecast.
      _forecast(kind, sensorId) {
        if (sensorId) {
          return ((this._hass.states[sensorId] || {}).attributes || {}).forecast || [];
        }
        var wid = this._config.entity, conn = this._hass && this._hass.connection;
        var key = kind + '|' + wid;
        this._fcW = this._fcW || {};
        var w = this._fcW[key];
        // a new connection object (a page that reconnected) is watched afresh
        if (w && w.conn !== conn) { w.release(); w = this._fcW[key] = null; }
        if (!w && wid && conn && this.isConnected && window.hkWxForecast) {
          var self = this;
          w = this._fcW[key] = window.hkWxForecast.watch(conn, kind, wid, function () {
            self._fcN = (self._fcN || 0) + 1;
            self.requestUpdate();
          });
        } else if (w) w.ensure();
        return w ? w.data() : [];
      }
      _fcRelease() {
        var ws = this._fcW || {};
        Object.keys(ws).forEach(function (k) { if (ws[k]) ws[k].release(); });
        this._fcW = {};
      }

      _render() {
        if (!this._config || !this._hass) { return; }
        if (this._section()) { this._renderSection(); return; }
        var cfg = this._config, states = this._hass.states;
        var st = states[cfg.entity] || {};
        var a = st.attributes || {};
        var src = this._sources();
        var fitted = this._counts();
        var nHours = fitted.hours, nDays = fitted.days;
        var narrow = this._narrow();
        this._nH = nHours; this._nD = nDays; this._nN = narrow;

        var t = num(a.temperature);
        // These three read the sensors chosen in Configure when there are
        // any, else the weather entity's own attributes. See the note in
        // hk-header.js about the two being the same provider at different
        // precision.
        var read = function (id, attr) {
          return id ? num((states[id] || {}).state) : num(a[attr]);
        };
        var feels = read(src.feels, 'apparent_temperature');
        var hum = read(src.humidity, 'humidity');
        var wind = read(src.wind, 'wind_speed');
        var windUnit = window.hkSettings && window.hkSettings.unit
          ? window.hkSettings.unit(src.wind ? states[src.wind] : st,
                                   src.wind ? null : 'wind_speed_unit', 'mph')
          : 'mph';
        // conditionName, not a title-case of the id: 'partlycloudy' has no
        // separator to split on and would print as "Partlycloudy".
        var cond = window.hkHeader && window.hkHeader.conditionName
          ? window.hkHeader.conditionName(st.state) : String(st.state || '');

        var line2 = [];
        if (feels !== null) line2.push('Feels ' + Math.round(feels) + '°');
        if (hum !== null) line2.push(Math.round(hum) + '% humidity');

        // AN HOURLY SLOT THAT HAS ENDED IS NOT "NOW". A forecast sensor keeps
        // what the provider last sent, and that list can start with the hour
        // that just finished: at 22:07 the house's began at 21:00, so the 9 PM
        // forecast was labelled Now and "10 PM" came second. A slot covers an
        // hour from its datetime; the first one still open is the one we are in.
        var now = Date.now();
        var hrs = this._forecast('hourly', src.hourly).filter(function (h) {
          return !(Date.parse(h.datetime) + 3600e3 <= now);
        }).slice(0, nHours);
        var days = this._forecast('daily', src.daily).slice(0, nDays);

        var hourCells = hrs.map(function (h, i) {
          var d = new Date(h.datetime), hh = d.getHours();
          var label = i === 0 ? 'Now'
            : (hh % 12 === 0 ? 12 : hh % 12) + ' ' + (hh < 12 ? 'AM' : 'PM');
          var tt = num(h.temperature), pop = num(h.precipitation_probability);
          return '<div class="cell">' +
            '<div class="lbl' + (i === 0 ? ' now' : '') + '">' + label + '</div>' +
            // Moon after dark. Providers that send is_daytime are believed;
            // OpenWeatherMap does not, so sun.sun's times decide (nightAt).
            (function () {
              var nt = h.is_daytime != null ? h.is_daytime === false
                : !!(window.hkHeader && window.hkHeader.nightAt && window.hkHeader.nightAt(states, h.datetime));
              // OpenWeatherMap calls every clear hour "clear-night" once it is
              // dark when it was asked: a clear hour in daylight is the sun
              return glyph(h.condition === 'clear-night' && !nt ? 'sunny' : h.condition, 26, nt);
            })() +
            '<div class="hi">' + (tt !== null ? Math.round(tt) : '--') + '°</div>' +
            '<div class="pop' + (pop >= 20 ? ' wet' : '') + '">' +
              (pop !== null ? Math.round(pop) : 0) + '%</div>' +
            '</div>';
        }).join('');

        var dayCells = days.map(function (d, i) {
          var dt = new Date(d.datetime);
          var label = i === 0 ? 'Today'
            : dt.toLocaleDateString('en-US', { weekday: 'short' });
          var hi = num(d.temperature), lo = num(d.templow);
          return '<div class="cell">' +
            '<div class="lbl' + (i === 0 ? ' now' : '') + '">' + label + '</div>' +
            // A DAY is never night: OpenWeatherMap's daily entries can carry
            // `clear-night` (it summarises from a night-time reading), which
            // would draw a moon under "Wed". Read it as the clear day it is.
            glyph(d.condition === 'clear-night' ? 'sunny' : d.condition, 26, false) +
            '<div class="hi">' + (hi !== null ? Math.round(hi) : '--') + '°</div>' +
            '<div class="lo">' + (lo !== null ? Math.round(lo) : '--') + '°</div>' +
            '</div>';
        }).join('');

        var tracks = function (n) {
          return 'grid-template-columns:repeat(' + n + ',minmax(0,1fr))';
        };

        this._root.innerHTML =
          '<ha-card class="band' + (cfg.plain ? ' plain' : '') + '"><div class="wrap' + (narrow ? ' narrow' : '') + '"' +
          (this._nowW() !== 300 ? ' style="--hk-now-w:' + this._nowW() + 'px"' : '') + '>' +
            '<div class="now">' +
              '<div class="place">' + esc(cfg.place || this._place()) + '</div>' +
              '<div class="temp">' + (t !== null ? Math.round(t) : '--') + '°</div>' +
              '<div class="cond">' + esc(cond || '--') + '</div>' +
              '<div class="sub">' + line2.join(' · ') + '</div>' +
              (wind !== null ? '<div class="sub wind">' + Math.round(wind) + ' ' + windUnit + ' wind</div>' : '') +
            '</div>' +
            '<div class="rule"></div>' +
            '<div class="cols">' +
              '<div class="strip" style="' + tracks(hrs.length || nHours) + '">' + hourCells + '</div>' +
              '<div class="hrule"></div>' +
              '<div class="strip" style="' + tracks(days.length || nDays) + '">' + dayCells + '</div>' +
            '</div>' +
          '</div></ha-card>';

        // Bound per render, not once: _render replaces innerHTML wholesale, so
        // the previous ha-card and its listener are discarded with it. There
        // is nothing to accumulate.
        var card = this._root.querySelector('ha-card');
        if (card) {
          this._bind(card, 'tap_action', null);
          // Only look tappable when it is. `pointer` on a card that does
          // nothing is a promise the card does not keep.
          var act = (this._config.tap_action || {}).action;
          card.style.cursor = (act && act !== 'none') ? 'pointer' : '';
        }
      }

      getCardSize() { return 4; }
    }
    Object.keys(PAGE_METHODS).forEach(function (k) { HkWeatherBandCard.prototype[k] = PAGE_METHODS[k]; });
    // ------------------------------------------- the Weather page's details
    // THE TILES IN THE PAGE'S LOOK (`look: 'page'`, 2026-10-16): a title
    // with its glyph, the reading, a small drawing and a line about it --
    // Wind, Sunrise & Sunset, UV Index, Humidity, Moon and Pressure. The
    // older look (no `look`) stays the tile it was on other dashboards.
    // Fed by hk-weather-details-card, which hands each the forecast it holds
    // (`_wx`: { hourly, daily }) for the lines that look ahead. A reading the
    // weather service does not give is said to be missing, never invented.
    var TILE_ICONS = { wind: 'mdi:weather-windy', sun: 'hk:weather-sunset-up', uv: 'hk:white-balance-sunny',
                       humidity: 'hk:water-percent', moon: 'mdi:moon-waning-crescent', pressure: 'mdi:gauge' };
    var TILE_NAMES = { wind: 'Wind', sun: 'Sunrise', uv: 'UV Index', humidity: 'Humidity', moon: 'Moon', pressure: 'Pressure' };
    var TILE_PAGE_CSS = [
      'ha-card.wtile.pg{display:flex;flex-direction:column;height:var(--hk-wx-tile-h,190px);padding:' + C.CARD.pad + ';cursor:pointer;color:' + C.v('ink') + '}',
      ':host([data-hk-cell]) ha-card.wtile.pg{height:100%}',
      '.pg .pt{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden}',
      '.pg .pt ha-icon{--mdc-icon-size:15px;width:15px;height:15px;flex:none;display:flex;align-items:center;justify-content:center;line-height:0}',
      '.pg .pb{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:center}',
      '.pg .nb{font-size:30px;font-weight:700;letter-spacing:-0.6px;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.pg .nb small{font-size:13px;font-weight:600;letter-spacing:0;color:' + C.v('ink-2') + ';margin-left:3px}',
      '.pg .sb{font-size:13px;font-weight:600;margin-top:3px;color:' + C.v('ink-2') + '}',
      '.pg .pn{margin:0;font-size:12px;font-weight:500;line-height:1.4;color:' + C.v('ink-2') + ';display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.pg .na{font-size:15px;font-weight:600;color:' + C.v('ink-3') + '}',
      '.pg .scale{position:relative;height:4px;border-radius:' + C.R.capsule('4px') + ';margin-top:12px}',
      '.pg .scale b{position:absolute;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.4)}',
      '.pg .uvs{background:linear-gradient(90deg,#4cd964,#ffd60a,#ff9f0a,#ff453a,#bf5af2)}',
      '.pg .hum{background:' + C.v('line-strong') + '}',
      '.pg .hum i{position:absolute;left:0;top:0;bottom:0;border-radius:inherit;background:var(--hk-wx-c,#64D2FF)}',
      '.pg .wb{display:flex;align-items:center;gap:12px}',
      '.pg .wb svg{flex:none;width:62px;height:62px}',
      '.pg .wb .nb{font-size:26px}',
      '.pg .md{display:flex;align-items:center;gap:12px}',
      '.pg .md svg{flex:none;width:52px;height:52px}',
      '.pg .md span{font-size:13px;font-weight:500;line-height:1.45;color:' + C.v('ink-2') + '}',
      '.pg .arc{width:100%;height:40px;display:block;margin-top:6px;overflow:visible}',
      '.pg .ticks{height:24px;margin-top:10px;position:relative;',
      '  background:repeating-linear-gradient(90deg,' + C.v('mark') + ' 0 1px,transparent 1px 9px)}',
      '.pg .ticks b{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:' + C.v('ink') + '}',
      BUILD_CSS,
      '.anim .nb{animation:wxUp .55s ' + BUILD + ' backwards;animation-delay:calc(var(--d,0ms) + 100ms)}',
      '.anim .sb,.anim .pn{animation:wxUp .5s ' + BUILD + ' backwards;animation-delay:calc(var(--d,0ms) + 260ms)}',
      '.anim .uvs,.anim .ticks{animation:wxWipe .8s ' + BUILD + ' backwards;animation-delay:calc(var(--d,0ms) + 180ms)}',
      '.anim .scale b,.anim .ticks b{animation:wxPop .45s ' + BUILD + ' backwards;animation-delay:calc(var(--d,0ms) + 950ms)}',
      '.anim .hum i{animation:wxGrowX .9s ' + BUILD + ' backwards;transform-origin:0 50%;animation-delay:calc(var(--d,0ms) + 180ms)}',
      '.anim .nd{animation:wxTurn 1.2s ' + BUILD + ' backwards;transform-box:view-box;transform-origin:31px 31px;animation-delay:calc(var(--d,0ms) + 150ms)}',
      '.anim .arc .a{animation:wxDraw 1s ' + BUILD + ' backwards;animation-delay:calc(var(--d,0ms) + 150ms)}',
      '.anim .arc circle{animation:wxPop .45s ' + BUILD + ' backwards;transform-box:fill-box;transform-origin:50% 50%;animation-delay:calc(var(--d,0ms) + 950ms)}',
      '.anim .md svg{animation:wxPop .6s ' + BUILD + ' backwards;animation-delay:calc(var(--d,0ms) + 150ms)}',
      '@media (max-width:' + C.BP.phone + 'px){.pg .nb{font-size:28px}.pg .wb .nb{font-size:24px}.pg .wb svg{width:52px;height:52px}}'
    ].join('');
    var DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    function dir16(b) { return b === null ? '' : DIRS16[Math.round(((b % 360) + 360) % 360 / 22.5) % 16]; }
    function fmtTime(iso) {
      var d = new Date(iso);
      return isNaN(d) ? null : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    function nextHours(list, n) {
      var now = Date.now();
      return (list || []).filter(function (h) { return !(Date.parse(h.datetime) + 3600e3 <= now); }).slice(0, n);
    }
    var TILE_PAGE = {
      _pgService() {
        var st = this._st(this._config.entity) || this._st(window.hkSettings && window.hkSettings.weatherId
          ? window.hkSettings.weatherId(this._hass.states) : '');
        return ((st && st.attributes) || {}).friendly_name || 'the weather service';
      },
      _pgWeather() {
        var HS = window.hkSettings, id = this._config.entity || (HS && HS.weatherId ? HS.weatherId(this._hass.states) : null);
        var st = id && this._st(id);
        return { st: st, a: (st && st.attributes) || {} };
      },
      _pgMissing(what) {
        return { body: '<div class="na">Not available</div>', note: esc(this._pgService()) + ' doesn’t give ' + what + '.' };
      },
      _pg_wind() {
        var w = this._pgWeather(), a = w.a;
        var spd = this._config.speed ? this._n(this._config.speed) : num(a.wind_speed);
        if (spd === null) return this._pgMissing('the wind');
        var brg = num(a.wind_bearing);
        var HS = window.hkSettings, unit = HS && HS.unit ? HS.unit(this._st(this._config.speed || this._config.entity) || w.st,
          this._config.speed ? null : 'wind_speed_unit', 'mph') : 'mph';
        var gust = this._config.gust ? this._n(this._config.gust) : null;
        if (gust === null) {
          var h0 = nextHours((this._wx || {}).hourly, 1)[0];
          gust = h0 ? num(h0.wind_gust_speed) : null;
        }
        var r = brg === null ? 0 : brg * Math.PI / 180;
        // the needle points the way the wind GOES (it comes FROM the bearing)
        var x1 = 31 + 22 * Math.sin(r), y1 = 31 - 22 * Math.cos(r), x2 = 31 - 22 * Math.sin(r), y2 = 31 + 22 * Math.cos(r);
        var svg = '<svg viewBox="0 0 62 62" aria-hidden="true"><circle cx="31" cy="31" r="29" fill="none" style="stroke:' + C.v('mark') + '" stroke-dasharray="2 3"/>' +
          '<text x="31" y="10" text-anchor="middle" font-size="7" style="fill:' + C.v('ink-3') + '">N</text>' +
          (brg === null ? '' : '<g class="nd" style="--from:' + (brg <= 180 ? -brg : 360 - brg).toFixed(0) + 'deg"><line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
            '" style="stroke:' + C.v('glyph') + '" stroke-width="2" stroke-linecap="round"/><circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) +
            '" r="3" style="fill:' + C.v('glyph') + '"/></g>') + '</svg>';
        return { body: '<div class="wb">' + svg + '<div><div class="nb">' + Math.round(spd) + '<small>' + esc(unit) + '</small></div>' +
                       (brg !== null ? '<div class="sb">From the ' + dir16(brg) + '</div>' : '') + '</div></div>',
                 note: gust !== null && gust > spd ? 'Gusts up to ' + Math.round(gust) + ' ' + esc(unit) + '.' : (spd < 1 ? 'Calm.' : '') };
      },
      _pg_sun() {
        var s = this._st(this._config.sun || 'sun.sun'), a = (s && s.attributes) || {};
        if (!s) return { body: '<div class="na">Not available</div>', note: 'Needs Home Assistant’s Sun.' };
        var up = s.state === 'above_horizon';
        var main = fmtTime(up ? a.next_setting : a.next_rising), other = fmtTime(up ? a.next_rising : a.next_setting);
        var parts = main ? /^(.*?)\s?(AM|PM)$/.exec(main) : null;
        var elev = Number(a.elevation) || 0, f = Math.max(0, Math.min(1, elev / 70));
        var x = up ? (a.rising === true ? 10 + 70 * f : 150 - 70 * f) : (a.rising === true ? 6 : 154);
        var y = up ? 36 - 30 * f : 37;
        return { body: '<div class="nb">' + (parts ? esc(parts[1]) + '<small>' + parts[2] + '</small>' : esc(main || '--')) + '</div>' +
                       '<svg class="arc" viewBox="0 0 160 42" preserveAspectRatio="none" aria-hidden="true"><path class="a" pathLength="1" stroke-dasharray="1" d="M2 39Q80-22 158 39" fill="none" style="stroke:' + C.v('mark') + '" stroke-width="1.5"/>' +
                       '<path d="M0 37H160" style="stroke:' + C.v('line-strong') + '"/><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.5" fill="#ffd60a"' + (up ? '' : ' opacity=".55"') + '/></svg>',
                 note: other ? (up ? 'Sunrise ' : 'Sunset ') + other + '.' : '' };
      },
      _pgUvNow() {
        if (this._config.uv) return this._n(this._config.uv);
        var a = this._pgWeather().a;
        if (num(a.uv_index) !== null) return num(a.uv_index);
        var h0 = nextHours((this._wx || {}).hourly, 1)[0];
        return h0 ? num(h0.uv_index) : null;
      },
      _pg_uv() {
        var v = this._pgUvNow();
        if (v === null) return this._pgMissing('a UV index');
        var n = Math.round(v), word = n <= 2 ? 'Low' : n <= 5 ? 'Moderate' : n <= 7 ? 'High' : n <= 10 ? 'Very High' : 'Extreme';
        var hrs = nextHours((this._wx || {}).hourly, 12).filter(function (h) { return num(h.uv_index) !== null; });
        var note = '';
        if (hrs.length) {
          var pk = hrs.reduce(function (m, h) { return num(h.uv_index) > num(m.uv_index) ? h : m; });
          var pv = Math.round(num(pk.uv_index));
          note = pv <= 2 && n <= 2 ? 'Low for the rest of the day.' : pv > n ? 'Peaks at ' + pv + ' around ' + hourLabel(pk.datetime) + '.' : 'Falling from here.';
        }
        return { body: '<div class="nb">' + n + '</div><div class="sb">' + word + '</div>' +
                       '<div class="scale uvs"><b style="left:' + (Math.max(0, Math.min(1, n / 11)) * 100).toFixed(1) + '%"></b></div>', note: note };
      },
      _pg_humidity() {
        var w = this._pgWeather(), a = w.a, HS = window.hkSettings;
        var hid = HS ? HS.get('weather.humidity', null) : null;
        var v = hid ? this._n(hid) : num(a.humidity);
        if (v === null) return this._pgMissing('the humidity');
        var dew = num(a.dew_point);
        return { body: '<div class="nb">' + Math.round(v) + '<small>%</small></div>' +
                       '<div class="scale hum"><i style="width:' + Math.max(0, Math.min(100, v)).toFixed(0) + '%"></i></div>',
                 note: dew !== null ? 'The dew point is ' + Math.round(dew) + '° right now.' : '' };
      },
      _pg_moon() {
        var p = this._phase();
        if (p === null) return { body: '<div class="na">Not available</div>', note: '' };
        var illum = (1 - Math.cos(2 * Math.PI * p)) / 2, waxing = p < 0.5;
        var name = p < 0.03 ? 'New Moon' : p < 0.22 ? 'Waxing Crescent' : p < 0.28 ? 'First Quarter' : p < 0.47 ? 'Waxing Gibbous'
          : p < 0.53 ? 'Full Moon' : p < 0.72 ? 'Waning Gibbous' : p < 0.78 ? 'Last Quarter' : p < 0.97 ? 'Waning Crescent' : 'New Moon';
        // the same two-arc terminator as the older tile (_moon) and the sky
        var r = 26, cx = 30, cy = 30, rx = r * Math.abs(Math.cos(2 * Math.PI * p));
        var a1 = waxing ? 1 : 0, a2 = illum > 0.5 ? a1 : 1 - a1;
        var d = 'M ' + cx + ' ' + (cy - r) + ' A ' + r + ' ' + r + ' 0 0 ' + a1 + ' ' + cx + ' ' + (cy + r) +
                ' A ' + rx + ' ' + r + ' 0 0 ' + a2 + ' ' + cx + ' ' + (cy - r) + ' Z';
        var toFull = ((0.5 - p) % 1 + 1) % 1 * 29.53, toNew = ((1 - p) % 1 + 1) % 1 * 29.53;
        var when = function (dd) { var n = Math.round(dd); return n <= 0 ? 'tonight' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'; };
        var note = toFull < toNew ? (toFull < 0.75 ? 'Full moon tonight.' : 'Full moon ' + when(toFull) + '.') : (toNew < 0.75 ? 'New moon tonight.' : 'New moon ' + when(toNew) + '.');
        return { body: '<div class="md"><svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="26" style="fill:' + C.v('key-strong') + '"/>' +
                       '<path d="' + d + '" style="fill:var(--hk-glyph,rgba(226,232,240,0.95))"/></svg><span>' + name + '<br>' + Math.round(illum * 100) + '% lit</span></div>',
                 note: note };
      },
      _pg_pressure() {
        var a = this._pgWeather().a, v = num(a.pressure);
        if (v === null) return this._pgMissing('the pressure');
        var unit = a.pressure_unit || '', inhg = /inhg/i.test(unit);
        // the gauge: 28.5-31 inHg (965-1050 hPa), where nearly every reading lands
        var lo = inhg ? 28.5 : 965, hi = inhg ? 31 : 1050, f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        var hrs = nextHours((this._wx || {}).hourly, 7).filter(function (h) { return num(h.pressure) !== null; });
        var note = '';
        if (hrs.length > 3) {
          var dv = num(hrs[hrs.length - 1].pressure) - num(hrs[0].pressure), step = inhg ? 0.03 : 1;
          note = dv >= step ? 'Forecast to rise over the next ' + (hrs.length - 1) + ' hours.'
            : dv <= -step ? 'Forecast to fall over the next ' + (hrs.length - 1) + ' hours.' : 'Forecast to hold steady.';
        }
        return { body: '<div class="nb">' + (inhg ? v.toFixed(2) : Math.round(v)) + '<small>' + esc(unit) + '</small></div>' +
                       '<div class="ticks"><b style="left:' + (f * 100).toFixed(1) + '%"></b></div>', note: note };
      },
      _pgTitle() {
        var v = this._config.variant;
        if (v === 'sun') { var s = this._st(this._config.sun || 'sun.sun'); return s && s.state === 'above_horizon' ? 'Sunset' : 'Sunrise'; }
        return TILE_NAMES[v];
      },
      _renderPage() {
        var self = this, v = this._config.variant;
        if (!this._built) {
          this._root.innerHTML = '<ha-card class="wtile pg" role="button" tabindex="0"><div class="pt"><ha-icon></ha-icon><span></span></div>' +
            '<div class="pb"></div><p class="pn"></p></ha-card>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('ha-card'), ic: q('.pt ha-icon'), tt: q('.pt span'), pb: q('.pb'), pn: q('.pn') };
          var open = function () {
            if (!window.hkDetail || !window.hkDetail.open) return;
            var HS = window.hkSettings, id = self._config.entity || (HS && HS.weatherId ? HS.weatherId(self._hass.states) : null);
            if (id) window.hkDetail.open(id, { focus: self._config.variant });
          };
          this._e.card.addEventListener('click', open);
          this._e.card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
          this._built = true;
        }
        var e = this._e, got = this['_pg_' + v](), tt = this._pgTitle();
        e.ic.setAttribute('icon', TILE_ICONS[v]);
        if (e.tt.textContent !== tt) e.tt.textContent = tt;
        e.card.setAttribute('aria-label', tt + ' details');
        C.morph(e.pb, got.body);
        C.morph(e.pn, got.note || '');
      }
    };

    // ------------------------------------------- hk-weather-details-card
    // THE PAGE'S DETAILS: the tiles weather.page.details names, in its order
    // (read live), six across on a wide screen, three on an upright tablet,
    // two on a phone -- by this card's own width. One forecast watch for all
    // of them (the band's _forecast, shared with the page's other cards).
    class HkWeatherDetailsCard extends Base {
      static get CSS() {
        return ':host{display:block}' +
          '.dg{display:grid;grid-template-columns:repeat(var(--n,6),minmax(0,1fr));gap:var(--hk-gap,10px)}';
      }
      setConfig(config) {
        this._hkOwn = ownKeys(config, BAND_KEYS);
        super.setConfig(Object.assign({}, config || {}));
        houseWeather(this, this._hass, BAND_KEYS);
      }
      get hass() { return super.hass; }
      set hass(h) { houseWeather(this, h, BAND_KEYS); super.hass = h; }
      _sigOf() {
        var h = this._hass;
        if (!h) return null;
        var src = this._sources(), HS = window.hkSettings, ids = [this._config.entity, src.hourly, src.daily, 'sun.sun',
          HS ? HS.get('weather.wind', null) : null, HS ? HS.get('weather.gust', null) : null, HS ? HS.get('weather.uv', null) : null,
          HS ? HS.get('weather.humidity', null) : null, HS ? HS.get('sky.moon', null) : null];
        return 'fc=' + (this._fcN || 0) + ';d=' + wxPage().details.join(',') + ';' + ids.map(function (id) {
          var st = id && h.states[id]; return (id || '') + '=' + (st ? st.last_updated : 'x');
        }).join(';') + ';h=' + Math.floor(Date.now() / 3600e3) + ';m=' + Math.floor(Date.now() / 600e3);
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        wxEnter(this);
        var self = this;
        if (!this._ro && typeof ResizeObserver === 'function') {
          this._ro = new ResizeObserver(function (en) {
            var w = en[0] && en[0].contentRect ? en[0].contentRect.width : 0;
            var n = w > 1000 ? 6 : w > 560 ? 3 : 2;
            if (n !== self._cols) { self._cols = n; if (self._grid) self._grid.style.setProperty('--n', n); }
          });
          this._ro.observe(this);
        }
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        wxLeave(this);
        var tiles = this._tiles || {};
        Object.keys(tiles).forEach(function (k) { wxLeave(tiles[k]); });
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        this._fcRelease();
        this._hkSig = null;
      }
      _render() {
        if (!this._config || !this._hass) return;
        if (!this._grid) {
          this._root.innerHTML = '<div class="dg" role="list" aria-label="Weather details"></div>';
          this._grid = this._root.querySelector('.dg');
          if (this._cols) this._grid.style.setProperty('--n', this._cols);
          this._tiles = {};
        }
        var self = this, HS = window.hkSettings, want = wxPage().details;
        var wx = { hourly: this._forecast('hourly', this._sources().hourly), daily: this._forecast('daily', this._sources().daily) };
        var order = want.join(',');
        if (order !== this._order) {
          this._order = order;
          Object.keys(this._tiles).forEach(function (k) { if (want.indexOf(k) < 0) { self._tiles[k].remove(); delete self._tiles[k]; } });
          want.forEach(function (k) {
            var t = self._tiles[k];
            if (!t) {
              t = self._tiles[k] = document.createElement('hk-weather-tile-card');
              t.setAttribute('role', 'listitem');
              var cfg = { type: 'custom:hk-weather-tile-card', variant: k, look: 'page', glass: self._config.glass };
              if (k === 'sun') cfg.sun = 'sun.sun';
              if (k === 'moon' && HS && HS.get('sky.moon', null)) cfg.phase = HS.get('sky.moon', null);
              t.setConfig(cfg);
            }
            self._grid.appendChild(t);      // in order (appending moves it)
          });
        }
        want.forEach(function (k) {
          var t = self._tiles[k];
          t._wx = wx;
          t._hkSig = null;
          t.hass = self._hass;
        });
        // the tiles build one after another, 70 ms apart
        if (want.length && buildDue(this)) {
          want.forEach(function (k, i) {
            var t = self._tiles[k];
            t.style.setProperty('--d', (i * 70) + 'ms');
            build(t, t._e && t._e.card);
          });
        }
      }
      getCardSize() { return 4; }
    }
    Object.keys(TILE_PAGE).forEach(function (k) { HkWeatherTileCard.prototype[k] = TILE_PAGE[k]; });
    // the band's forecast plumbing, shared (one watch per card, released on leaving)
    ['_forecast', '_fcRelease', '_sources'].forEach(function (k) { HkWeatherDetailsCard.prototype[k] = HkWeatherBandCard.prototype[k]; });

    // -------------------------------------------------- hk-radar-card
    // THE WEATHER PAGE'S RADAR (2026-10-16): a shell that holds the card's
    // place and imports modules/hk-radar.js -- the map, the providers and
    // the playback -- only when the radar is on (weather.radar_native) and
    // the card is on a page. Off, or never shown, nothing is loaded and
    // nothing is asked of any map or radar service.
    var RADAR_URL = '/hk/modules/hk-radar.js';
    var radarLoad = null;
    function radarModule() {
      if (window.hkRadar) return Promise.resolve(window.hkRadar);
      if (!radarLoad) {
        radarLoad = import(RADAR_URL).then(function () { return window.hkRadar; }, function (e) {
          radarLoad = null;
          throw e;
        });
      }
      return radarLoad;
    }
    class HkRadarCard extends Base {
      static get CSS() {
        return ':host{display:block}' +
          '.ph{box-sizing:border-box;height:var(--hk-wx-radar-h,455px);' + C.plate('card') + ';background:#1b2b33;' +
          'display:grid;place-content:center;font-size:14px;font-weight:500;color:rgba(255,255,255,.7)}' +
          '@media (max-width:' + C.BP.phone + 'px){.ph{height:var(--hk-wx-radar-h-phone,430px)}}' +
          ':host([data-hk-cell]) .ph{height:100%}';
      }
      _sigOf() {
        var h = this._hass, HS = window.hkSettings;
        if (!h || !HS || !HS.radarNative) return null;
        var r = HS.radarNative(), z = r.zone && h.states[r.zone], rd = HS.rendering ? HS.rendering() : {};
        return JSON.stringify([r, z ? z.last_updated : null, h.config && h.config.latitude, h.config && h.config.longitude,
                               h.config && h.config.country, rd.flat, rd.theme]);
      }
      _render() {
        var HS = window.hkSettings;
        if (!this._hass || !HS || !HS.radarNative) return;
        var on = HS.radarNative().enabled;
        this.style.display = on ? '' : 'none';
        if (!on) { this._detach(); this._root.innerHTML = ''; return; }
        if (this._ctl) { this._ctl.update(this._hass); return; }
        if (!this._root.firstChild) this._root.innerHTML = '<div class="ph" role="status">Loading the radar…</div>';
        if (!this.isConnected || this._loading) return;
        var self = this;
        this._loading = true;
        radarModule().then(function (M) {
          self._loading = false;
          if (!self.isConnected || self._ctl || !HS.radarNative().enabled) return;
          self._ctl = M.attach(self, self._root);
          self._ctl.update(self._hass);
        }, function (e) {
          self._loading = false;
          console.warn('[hk-weather] the radar could not load', e);
          self._root.innerHTML = '<div class="ph" role="status">The radar couldn’t load. Reload the page to try again.</div>';
        });
      }
      _detach() { if (this._ctl) { this._ctl.detach(); this._ctl = null; } }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        wxEnter(this);
        if (this._hass) this.redraw();
      }
      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        wxLeave(this);
        this._detach();
        this._root.innerHTML = '';
        this._hkSig = null;
      }
      getCardSize() { return 9; }
    }

    // ------------------------------------------------------------------
    // THE HEADER'S TWO HALVES AS CARDS.
    //
    // A CARD IS CONFIGURED AT ITS CALL SITE. A shared YAML snippet arrives by
    // `!include`, an include takes no keys, and custom:layout-card forwards
    // only grid*/place-* to children -- so the only way to size one
    // differently per dashboard would be CSS custom properties published by a
    // whole extra theme and read through `var()` in an inline style. As a
    // card, the Tesla writes `main_size: 26px` next to it and needs no theme.
    //
    // BOTH ARE THIN. The markup is hk-header.js's -- the same builders the wall
    // header itself calls -- so these cards are option mapping and a plate,
    // and cannot drift from the header.
    function opts(cfg, map) {
      var o = {};
      for (var k in map) { if (cfg[k] != null) o[map[k]] = cfg[k]; }
      return o;
    }

    var SHADOW = 'drop-shadow(0px 1px 3px rgba(0,0,0,0.30)) '

      + 'drop-shadow(0px 3px 12px rgba(0,0,0,0.28)) '

      + 'drop-shadow(0px 6px 26px rgba(0,0,0,0.30))';

    var MISSING = '<div style="padding:8px 0;opacity:.6">Header module unavailable</div>';

    class HkWeatherStripCard extends Base {

      // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)

      static get FLAT_MOTION() { return true; }
      static get CSS() {
        // Same reason as the clock: on the screensaver the shadow is a
        // text-shadow inherited from WallPanel's info box, and ha-card clips
        // by default -- which cuts the 68px blur into a hard grey band.
        return ':host{overflow:visible}' +
               'ha-card.strip{background:none;border:none;box-shadow:none;' +
               'padding:2px 3px 0 3px;display:block;overflow:visible}' +
               'ha-card.strip.tappable{cursor:pointer}' +
               '.strip div,.strip span{overflow:visible}' +
               // fitted to its width, as the header is (hkHeader.fitWeather)
               fitCss('ha-card.strip');
      }
      // No entity in the config: the one chosen in Configure -> Weather and
      // sky, else the house's first weather entity. Re-resolved on every
      // hass, so it follows an edit in Configure.
      setConfig(config) {
        this._hkExplicit = !!(config && config.entity);
        var c = Object.assign({}, config);
        if (!c.entity) c.entity = this._autoEntity(this._hass);
        super.setConfig(c);
      }
      _autoEntity(h) {
        var HS = window.hkSettings;
        if (!HS) return null;
        return h ? HS.weatherId(h.states) : HS.get('weather.entity', null);
      }
      get hass() { return super.hass; }
      set hass(h) {
        if (this._config && !this._hkExplicit) {
          var id = this._autoEntity(h);
          if (id && this._config.entity !== id) { this._config.entity = id; this._hkSig = null; }
        }
        super.hass = h;
      }

      // TAP.
      //
      // THE LISTENER GOES ON _root, NOT ON THE ha-card. _render() reassigns
      // this._root.innerHTML on every state change, so anything bound to the
      // card inside it is discarded a few seconds later -- the tap would work
      // once and then stop, which is worse than not working at all. _root is
      // the div HkBase creates and it is never replaced.
      //
      // NO DEFAULT ACTION. The screensaver uses this card too, where a tap
      // must do nothing at all (WallPanel dismisses on touch, and navigating
      // out from under the screensaver would be a surprise). So a dashboard
      // that wants a tap says so and the screensaver stays inert.
      _wireTap() {
        if (this._tapWired) return;
        var ta = this._config && this._config.tap_action;
        if (!ta || ta.action === 'none') return;
        this._tapWired = true;
        this._bind(this._root, 'tap_action', null);
      }
      _sigOf() {
        var h = this._hass, c = this._config;
        if (!h || !c) return null;
        var st = h.states[c.entity];
        // sun.sun too: the glyph turns to a moon at sunset, and the weather
        // entity may not update for another ten minutes after it.
        var sun = h.states['sun.sun'];
        return c.entity + '=' + (st ? st.last_updated : 'x') + ';sun=' + (sun ? sun.state : 'x');
      }
      _render() {
        if (!this._config || !this._hass) return;
        var c = this._config;
        var H = window.hkHeader;
        // its own `entity` when the config names one; else (entity: null)
        // HK Settings' weather, as before
        var body = H ? H.weather(this._hass.states, Object.assign({
          width: '100%', boxSizing: 'border-box',
          entity: this._hkExplicit ? c.entity : null
        }, opts(c, {
          glyph_size: 'glyph',
          main_size: 'mainSize', main_letter_spacing: 'mainLs',
          detail_size: 'detailSize', detail_letter_spacing: 'detailLs',
          detail_gap: 'detailGap', gap: 'gap',
          color: 'fg', dim_color: 'fgDim', shadow: 'selfShadow',
          variant: 'variant', unit: 'unit', temp_gap: 'tempGap',
          icon_gap: 'iconGap'
        }))) : MISSING;
        // The strip has no shadow of its own unless asked -- the wall sits on a
        // photo and needs one, the car sits on a flat background where the same
        // shadow reads as dirt, so `shadow` is stated per call site.
        var ta = c.tap_action;
        var tappable = (ta && ta.action !== 'none') ? ' tappable' : '';
        // `layer: true` (the screensaver sets it): see the clock card below.
        this._root.innerHTML = '<ha-card class="strip' + tappable + '" style="margin:' +
          (c.margin != null ? c.margin : '0 0 12px 0') +
          (c.layer ? ';will-change:transform' : '') + '">' + body + '</ha-card>';
        this._wireTap();
        var self = this;
        fitOnResize(this, function (H) { H.fitWeather(self._root.querySelector('ha-card.strip')); });
      }
      getCardSize() { return 1; }
    }

    class HkClockCard extends Base {
      static get CSS() {
        // OVERFLOW VISIBLE, and it is load-bearing on the screensaver: the
        // shadow there is a text-shadow inherited from WallPanel's info box,
        // and ha-card clips by default, so the 68px blur comes out as a hard
        // grey band round the clock. `:host` too -- a shadow that escapes the
        // card is still clipped by the host element.
        return ':host{overflow:visible}' +
               'ha-card.clock{background:none;border:none;box-shadow:none;' +
               'padding:0;display:block;overflow:visible}' +
               '.clock>div,.clock div{overflow:visible}';
      }
      // The clock's time ticks every minute and its date every day (the Time &
      // Date sensors chosen in Configure, or this screen's clock); neither is
      // named in the config, so the base signature would never redraw.
      _sigOf() {
        var h = this._hass;
        if (!h) return null;
        var HS = window.hkSettings;
        if (!HS) {
          return ((h.states['sensor.time'] || {}).state || '') + '|' +
                 ((h.states['sensor.date'] || {}).state || '');
        }
        var ck = HS.clock(h.states);
        return ck.time + '|' + ck.date;
      }
      _render() {
        if (!this._hass) return;
        var c = this._config || {};
        var H = window.hkHeader;
        var body = H ? H.clock(this._hass.states, Object.assign(opts(c, {
          time_size: 'timeSize', ampm_size: 'ampmSize', date_size: 'dateSize',
          time_letter_spacing: 'timeLs', ampm_letter_spacing: 'ampmLs',
          date_letter_spacing: 'dateLs', date_gap: 'dateGap',
          color: 'fg', ampm_color: 'fgDim', date_color: 'dateFg',
          date_format: 'dateFormat', time_line_height: 'timeLh', gap: 'gap',
          clip: 'clip'
        }), { timeShift: this._shift || 0 })) : MISSING;
        // `shadow: true` is the header's own three-stage drop-shadow, and it
        // is not decoration -- it is what makes white type legible on a BRIGHT
        // daytime sky. On a flat plate the clock needs nothing.
        //
        // `filter`, not `text-shadow`: text-shadow is painted per element and
        // clipped by that element's own overflow, and every line in the clock
        // is nowrap + overflow:hidden for the ellipsis. A filter applies after
        // the element and its descendants have rendered and clipped. The card
        // must have NO background for it (it has none), and nothing inside may
        // carry its own or it doubles.
        var st = 'margin:' + (c.margin != null ? c.margin : '0');
        if (c.height) st += ';height:' + c.height;
        if (c.padding) st += ';padding:' + c.padding;
        if (c.shadow) st += ';filter:var(--hk-glow, ' + SHADOW + ')';
        // `layer: true` GIVES THE CLOCK ITS OWN COMPOSITING LAYER, and only the
        // WallPanel screensaver asks for it. There the text sits
        // over photo layers that WallPanel creates and destroys at every photo
        // change; without a layer of its own, a tablet WebView regroups the
        // text with them and re-rasters 150px digits under a 68px-blur shadow
        // -- the time, date and weather flicker around each photo change.
        // A/B-tested on a wall tablet. Opt-in, because a layer costs
        // GPU memory and the wall header and the car have nothing moving
        // underneath. Not a filter/transform on WallPanel's info box: that
        // would become the containing block of the fixed now-playing and
        // timer rows and unpin them from their corners.
        if (c.layer) st += ';will-change:transform';
        // morph, not innerHTML: this runs every minute on the screensaver, and
        // rebuilding the 150px time recreates its layer (the header flicker).
        window.hkCards.morph(this._root,
          '<ha-card class="clock" style="' + st + '">' + body + '</ha-card>');
        this._align();
      }
      // Line the time's first stroke up with the date's (hkHeader.clockShift).
      // Redraws only when the correction CHANGES -- the hour gaining or losing
      // a digit -- so a normal minute tick is still one text change.
      _align() {
        var H = window.hkHeader, self = this;
        if (!H || !H.clockShift || this._aligning) return;
        // MEASURED AGAIN AS IT SETTLES: the first measure can come while the
        // clock is still being placed (the screensaver sizes it just after),
        // and the next chance was the next minute's redraw -- the time sat
        // 17 px off the date's edge until then (2026-10-01)
        if (!this._settle) {
          this._settle = true;
          [400, 1500, 4000].forEach(function (ms) {
            setTimeout(function () { if (self.isConnected) self._align(); }, ms);
          });
        }
        var s = H.clockShift(this._root);
        if (s === null) {                              // font still loading
          if (document.fonts && !this._fontWait) {
            this._fontWait = true;
            document.fonts.ready.then(function () { self._fontWait = false; self.requestUpdate(); });
          }
          return;
        }
        if (Math.abs(s - (this._shift || 0)) < 0.5) return;
        this._shift = s;
        this._aligning = true;
        try { this.redraw(); } finally { this._aligning = false; }
      }
      getCardSize() { return 1; }
    }

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
          helper: 'Default: the weather entity chosen in HK Frontend -> Configure -> Weather.' },
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
    HkWeatherBandCard.getStubConfig = function (hass) {
      return { entity: C.firstOf(hass, 'weather'), hours: 12, days: 8 };
    };
    // Without a stub the card picker previews the clock and weather strip
    // empty.
    if (!Object.prototype.hasOwnProperty.call(HkClockCard, 'getStubConfig')) {
      HkClockCard.getStubConfig = function () { return {}; };
    }
    if (!Object.prototype.hasOwnProperty.call(HkWeatherStripCard, 'getStubConfig')) {
      HkWeatherStripCard.getStubConfig = function (hass) { return { entity: C.firstOf(hass, 'weather') }; };
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
    HkWeatherDetailsCard.getStubConfig = function (hass) { return { entity: C.firstOf(hass, 'weather') }; };
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
      '.wp.one{grid-template-columns:minmax(0,1fr)}',
      '.wx-section{' + C.plate('card') + ';border-radius:' + SP.cardR + 'px;padding:' + SP.cardPad + ';background:' + v('key') + ';box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;min-width:0}',
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
      '  box-sizing:border-box;padding:8px ' + SP.block + 'px;border:0;border-top:1px solid ' + v('line') + ';background:transparent;color:' + v('ink') + ';font:inherit;cursor:pointer;text-align:left;border-radius:0}',
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
        var h = this._hass;
        if (!h) return null;
        return (this._fcN || 0) + '|' + Math.floor(Date.now() / 60e3) + '|' + this._ids().map(function (id) {
          var s = h.states[id]; return s ? s.last_updated : '-';
        }).join(',');
      }
      // the forecast: the house's sensor, else the shared subscription
      // (hkWxForecast) while open -- the Weather page's own, when the sheet
      // opens over it
      _fc(kind) {
        var sid = hs('forecast_' + kind), h = this._hass;
        if (sid && h.states[sid]) return (h.states[sid].attributes || {}).forecast || [];
        this._ws = this._ws || {};
        var w = this._ws[kind];
        if (w && w.conn !== h.connection) { w.release(); w = this._ws[kind] = null; }
        if (!w && h.connection && this.isConnected && window.hkWxForecast) {
          var self = this;
          w = this._ws[kind] = window.hkWxForecast.watch(h.connection, kind, this._id, function () {
            self._fcN = (self._fcN || 0) + 1;
            self._hkSig = null; if (self._hass) self.hass = self._hass;
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
        var h = this._hass, id = hs(sensorKey), s = this._stateObj, a = (s && s.attributes) || {};
        var x = id && h.states[id] ? num(h.states[id].state) : null;
        return x != null ? x : num(a[attr]);
      }
      _render() {
        var h = this._hass, s = this._stateObj;
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
        var dayName = current ? 'Today' : new Date(selected.datetime).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
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
        var ws = a.wind_speed_unit || 'mph', ps = a.pressure_unit || '', vs = a.visibility_unit || '';
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
            var name=key===todayKey ? 'Today' : new Date(d.datetime).toLocaleDateString('en-US',{weekday:'short'});
            var dot=key===todayKey&&t!=null&&dl!=null&&dh!=null ? '<b style="left:'+pct(Math.max(mn,Math.min(mx,t)))+'%"></b>' : '';
            return '<button class="dy" type="button" data-day="'+i+'" aria-pressed="'+(key===self._dayKey)+'" aria-label="'+esc(new Date(d.datetime).toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'}))+'">'+
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
          pts.map(function (p, i) { return '<line data-i="' + i + '" x1="' + X(i) + '" x2="' + X(i) + '" y1="0" y2="110" style="stroke:' + v('ink-2') + '" vector-effect="non-scaling-stroke"/>'; }).join('') +
          '</svg><div class="ax"><span>' + (pts[0] ? hr(Date.parse(pts[0].t)) : '') + '</span><span>' + hr(Date.parse(pts[Math.floor(pts.length / 2)].t)) +
          '</span><span>' + hr(Date.parse(pts[pts.length - 1].t)) + '</span></div><div class="rd"></div></div>';
      }

      // THE FOCUS: a metric tile (wind, sun, uv, humidity, moon or pressure) -- that
      // reading's figure, its next hours from the forecast as a line, and a
      // line about it. { html, series, say, rest } ('' when there is none).
      _focus(h, s, hrs, days) {
        var src = (this._config && this._config.src) || {}, f = this._metric != null ? this._metric : src.focus, a = s.attributes || {};
        if (!f) return { html: '' };
        var self = this, wsU = a.wind_speed_unit || 'mph', pU = a.pressure_unit || '';
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
          var dd = function (d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
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
