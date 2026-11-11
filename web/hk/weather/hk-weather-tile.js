// hk-weather-tile.js - the weather tile and its page.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-tile'] = function (K) {
    var Base = K.Base, BUILD = K.BUILD, BUILD_CSS = K.BUILD_CSS, C = K.C, esc = K.esc, hourLabel = K.hourLabel,
        houseWeather = K.houseWeather, num = K.num, ownKeys = K.ownKeys, TILE_KEYS = K.TILE_KEYS;

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
          'hk-plate.wtile{box-sizing:border-box;display:block;height:172px;',
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
        houseWeather(this, this.client, this._hkKeys);
      }
      // each new client: the house's weather resolved first, then HkBase's step
      _receiveClient() { houseWeather(this, this.client, this._hkKeys || {}); super._receiveClient(); }
      getCardSize() { return 2; }

      _sigOf() {
        var h = this.client, c = this._config;
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
        var unit = HS && HS.unit ? HS.unit(spdSt, this._config.speed ? null : 'wind_speed_unit', window.hkLocale.units().speed)
                                 : window.hkLocale.units().speed;
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
          return isNaN(d) ? '--' : d.toLocaleTimeString(window.hkLocale.tag(),
            window.hkLocale.clock({ hour: 'numeric', minute: '2-digit' }));
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
        return HS && HS.moon ? HS.moon((this.client && this.client.states) || {}) : null;
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
        if (this._isPage()) { if (this.client) this._renderPage(); return; }
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="wtile" data-hk-role="card"><div class="grid">' +
            '<div class="cap" data-hk-role="cap"></div>' +
            '<div class="body" data-hk-role="body"></div>' +
            '</div></hk-plate>';
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
      'hk-plate.wtile.pg{display:flex;flex-direction:column;height:var(--hk-wx-tile-h,190px);padding:' + C.CARD.pad + ';cursor:pointer;color:' + C.v('ink') + '}',
      ':host([data-hk-cell]) hk-plate.wtile.pg{height:100%}',
      '.pg .pt{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:' + C.v('ink-2') + ';white-space:nowrap;overflow:hidden}',
      '.pg .pt hk-icon{--mdc-icon-size:15px;width:15px;height:15px;flex:none;display:flex;align-items:center;justify-content:center;line-height:0}',
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
      return isNaN(d) ? null : d.toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit' }));
    }
    function nextHours(list, n) {
      var now = Date.now();
      return (list || []).filter(function (h) { return !(Date.parse(h.datetime) + 3600e3 <= now); }).slice(0, n);
    }
    var TILE_PAGE = {
      _pgService() {
        var st = this._st(this._config.entity) || this._st(window.hkSettings && window.hkSettings.weatherId
          ? window.hkSettings.weatherId(this.client.states) : '');
        return ((st && st.attributes) || {}).friendly_name || 'the weather service';
      },
      _pgWeather() {
        var HS = window.hkSettings, id = this._config.entity || (HS && HS.weatherId ? HS.weatherId(this.client.states) : null);
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
          this._config.speed ? null : 'wind_speed_unit', window.hkLocale.units().speed) : window.hkLocale.units().speed;
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
          (brg === null ? '' : '<g class="nd" style="--from:' + (brg <= 180 ? -brg : 360 - brg).toFixed(0) + 'deg"><line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) +
            '" y2="' + y2.toFixed(1) +
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
                       '<svg class="arc" viewBox="0 0 160 42" preserveAspectRatio="none" aria-hidden="true"><path class="a" pathLength="1" stroke-dasharray="1" d="M2 39Q80-22 158 39" fill="none" ' +
                         'style="stroke:' + C.v('mark') + '" stroke-width="1.5"/>' +
                       '<path d="M0 37H160" style="stroke:' + C.v('line-strong') + '"/><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4.5" fill="#ffd60a"' +
                         (up ? '' : ' opacity=".55"') + '/></svg>',
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
          this._root.innerHTML = '<hk-plate class="wtile pg" role="button" tabindex="0"><div class="pt"><hk-icon></hk-icon><span></span></div>' +
            '<div class="pb"></div><p class="pn"></p></hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { card: q('hk-plate'), ic: q('.pt hk-icon'), tt: q('.pt span'), pb: q('.pb'), pn: q('.pn') };
          var open = function () {
            if (!window.hkDetail || !window.hkDetail.open) return;
            var HS = window.hkSettings, id = self._config.entity || (HS && HS.weatherId ? HS.weatherId(self.client.states) : null);
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

    // what the shell and the later parts use of this one
    K.dir16 = dir16; K.fitCss = fitCss; K.fitOnResize = fitOnResize; K.fmtTime = fmtTime; K.GONE_H = GONE_H;
    K.HK_STACK_W = HK_STACK_W; K.HkWeatherTileCard = HkWeatherTileCard; K.menuHasTime = menuHasTime;
    K.TILE_PAGE = TILE_PAGE;
  };
})();
