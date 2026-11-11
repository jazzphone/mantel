// hk-weather-strip.js - the strip and clock cards.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-strip'] = function (K) {
    var Base = K.Base, fitCss = K.fitCss, fitOnResize = K.fitOnResize, opts = K.opts, SHADOW = K.SHADOW;

    var MISSING = '<div style="padding:8px 0;opacity:.6">Header module unavailable</div>';

    class HkWeatherStripCard extends Base {

      // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)

      static get FLAT_MOTION() { return true; }
      static get CSS() {
        // Same reason as the clock: on the screensaver the shadow is a
        // text-shadow inherited from WallPanel's info box, and hk-plate clips
        // by default -- which cuts the 68px blur into a hard grey band.
        return ':host{overflow:visible}' +
               'hk-plate.strip{background:none;border:none;box-shadow:none;' +
               'padding:2px 3px 0 3px;display:block;overflow:visible}' +
               'hk-plate.strip.tappable{cursor:pointer}' +
               '.strip div,.strip span{overflow:visible}' +
               // fitted to its width, as the header is (hkHeader.fitWeather)
               fitCss('hk-plate.strip');
      }
      // No entity in the config: the one chosen in Configure -> Weather and
      // sky, else the house's first weather entity. Re-resolved with every
      // new client, so it follows an edit in Configure.
      setConfig(config) {
        this._hkExplicit = !!(config && config.entity);
        var c = Object.assign({}, config);
        if (!c.entity) c.entity = this._autoEntity(this.client);
        super.setConfig(c);
      }
      _autoEntity(h) {
        var HS = window.hkSettings;
        if (!HS) return null;
        return h ? HS.weatherId(h.states) : HS.get('weather.entity', null);
      }
      // each new client: the entity re-resolved first, then HkBase's step
      _receiveClient() {
        if (this._config && !this._hkExplicit) {
          var id = this._autoEntity(this.client);
          if (id && this._config.entity !== id) { this._config.entity = id; this._hkSig = null; }
        }
        super._receiveClient();
      }

      // TAP.
      //
      // THE LISTENER GOES ON _root, NOT ON THE hk-plate. _render() reassigns
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
        var h = this.client, c = this._config;
        if (!h || !c) return null;
        var st = h.states[c.entity];
        // sun.sun too: the glyph turns to a moon at sunset, and the weather
        // entity may not update for another ten minutes after it.
        var sun = h.states['sun.sun'];
        return c.entity + '=' + (st ? st.last_updated : 'x') + ';sun=' + (sun ? sun.state : 'x');
      }
      _render() {
        if (!this._config || !this.client) return;
        var c = this._config;
        var H = window.hkHeader;
        // its own `entity` when the config names one; else (entity: null)
        // HK Settings' weather, as before
        var body = H ? H.weather(this.client.states, Object.assign({
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
        this._root.innerHTML = '<hk-plate class="strip' + tappable + '" style="margin:' +
          (c.margin != null ? c.margin : '0 0 12px 0') +
          (c.layer ? ';will-change:transform' : '') + '">' + body + '</hk-plate>';
        this._wireTap();
        var self = this;
        fitOnResize(this, function (H) { H.fitWeather(self._root.querySelector('hk-plate.strip')); });
      }
      getCardSize() { return 1; }
    }

    class HkClockCard extends Base {
      static get CSS() {
        // OVERFLOW VISIBLE, and it is load-bearing on the screensaver: the
        // shadow there is a text-shadow inherited from WallPanel's info box,
        // and hk-plate clips by default, so the 68px blur comes out as a hard
        // grey band round the clock. `:host` too -- a shadow that escapes the
        // card is still clipped by the host element.
        return ':host{overflow:visible}' +
               'hk-plate.clock{background:none;border:none;box-shadow:none;' +
               'padding:0;display:block;overflow:visible}' +
               '.clock>div,.clock div{overflow:visible}' +
               // ON A HOME GRID (G2, the `clock` block, concept C's glance): a
               // plate, the time and date centred down its left. The time at
               // clock's established sizes, fitted to its actual block rather
               // than a screensaver's fixed 150px; the date uses a type role.
               ':host([size]){overflow:hidden}' +
               ':host([size]) hk-plate.clock{' + window.hkCards.plate('card') + ';box-sizing:border-box;height:100%;' +
               'padding:' + window.hkCards.blockPad(window.hkCards.CARD.pad) + ';display:flex;flex-direction:column;justify-content:center;overflow:hidden}' +
               ':host([size]) [data-hk-clock=clock]{min-width:0!important;width:100%}:host([size]) [data-hk-clock=clock],:host([size]) [data-hk-clock=clock] *{justify-content:center!important;' +
                 'align-items:center!important;text-align:center!important}' + /* centered on its block, StandBy's clock: equal margins all round (2026-11-07, the review) */
               ':host([size]) [data-hk-clock=date]{font-weight:500!important;letter-spacing:0!important}' +
               // BARE (the Clock block's Hide Box): the time on the wallpaper,
               // with the header's glow (`shadow`) to read on it
               ':host([size][bare]) hk-plate.clock{background:none;border:0;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}';
      }
      // the clock's sizes by block: time, AM / PM, date (px)
      _gridSizes(sz) {
        // (L and the Full Width block, 2026-10-24: the Clock block comes in every size)
        if (sz === 'XL' || sz === 'XXL') return ['clamp(72px, min(24cqw, 50cqh), 200px)', '30px', window.hkCards.TYPE.headline.size + 'px'];
        if (sz === 'L') return ['clamp(56px, min(25cqw, 42cqh), 150px)', '26px', window.hkCards.TYPE.headline.size + 'px'];
        if (sz === 'S') return ['min(40px, 20cqw)', '14px', window.hkCards.TYPE.caption.size + 'px'];
        // (Tall: one column wide -- its time and AM / PM ran past the plate's edge, 2026-10-30)
        if (sz === 'T') return ['min(56px, 22cqw)', '14px', window.hkCards.TYPE.caption.size + 'px'];
        return ['min(72px, 48cqh, 26cqw)', '22px', window.hkCards.TYPE.caption.size + 'px'];
      }
      // ITS OWN MINUTE (2026-10-31, the owner: the screensaver preview's clock stood still): it redraws when the house
      // pushes a change and its time has moved -- a quiet house (a fictional one, a real one at night, a page that
      // hears only a few of its states) pushes nothing for minutes, and the time stayed where it was. Now it asks
      // again on each minute itself, while it is on the page.
      connectedCallback() { super.connectedCallback(); this._armMinute(); }
      disconnectedCallback() { clearTimeout(this._minT); this._minT = null; super.disconnectedCallback(); }
      _armMinute() {
        var self = this;
        clearTimeout(this._minT);
        this._minT = setTimeout(function () { self._minT = null; if (self.isConnected === false) return; if (self.client) self.requestUpdate(); self._armMinute(); },
                                60000 - Date.now() % 60000 + 250);
      }
      // The clock's time ticks every minute and its date every day (the Time &
      // Date sensors chosen in Configure, or this screen's clock); neither is
      // named in the config, so the base signature would never redraw.
      _sigOf() {
        var h = this.client;
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
        if (!this.client) return;
        var c = this._config || {}, sz = this._cellSize();
        if (sz) {
          var g = this._gridSizes(sz);
          c = Object.assign({}, c, { time_size: g[0], ampm_size: g[1], date_size: g[2], date_gap: '10px', time_line_height: '1', margin: '0' });
        }
        var H = window.hkHeader;
        var body = H ? H.clock(this.client.states, Object.assign(opts(c, {
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
          '<hk-plate class="clock" style="' + st + '">' + body + '</hk-plate>');
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

    // what the shell and the later parts use of this one
    K.HkClockCard = HkClockCard; K.HkWeatherStripCard = HkWeatherStripCard;
  };
})();
