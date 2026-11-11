// hk-weather-header.js - the header card.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-header'] = function (K) {
    var Base = K.Base, C = K.C, fitCss = K.fitCss, fitOnResize = K.fitOnResize, GONE_H = K.GONE_H,
        HK_STACK_W = K.HK_STACK_W, menuHasTime = K.menuHasTime, SHADOW = K.SHADOW;

    class HkHeaderCard extends Base {
      static get CSS() {
        return [
          // OVERFLOW IS VISIBLE AT EVERY LEVEL, and that is load-bearing: the
          // whole header is drawn under one drop-shadow filter, and a filter's
          // output is clipped by any ancestor that clips.
          'hk-plate.hdr{box-sizing:border-box;display:block;min-height:118px;',
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
          'hk-plate.hdr.gone{min-height:0;height:' + GONE_H + 'px;padding:0;margin:0}',
          '.hdr.gone .grid{display:none}',
          // STACKED: on someone else's dashboard (data-hk-foreign) narrower
          // than HK_STACK_W -- a section, a Masonry column -- the security
          // line goes under the clock, and the weather under the time when
          // they don't fit side by side. Nothing is dropped (_fitWx). HK's own
          // screens never stack: a narrow one keeps dropping the clock.
          ':host([data-hk-stack]) hk-plate.hdr{padding:12px 0px 10px 0px;min-height:0}',
          ':host([data-hk-stack]) .hdr .grid{grid-template-areas:"left" "right";',
          '  grid-template-columns:minmax(0,1fr);row-gap:10px}',
          ':host([data-hk-stack]) .hdr .half{min-height:0}',
          ':host([data-hk-stack]) .hdr .right{text-align:left;min-width:0}',
          ':host([data-hk-stack]) .hdr .left > div{flex-wrap:wrap;row-gap:12px}',
          // Compact band only; page headers and screensaver clocks keep their layout.
          ':host([data-grid-band]){height:60px;container-type:inline-size;container-name:hk-band}',
          '.grid-band{height:60px;display:flex;align-items:center;gap:24px;min-width:0;color:' + C.v('ink') + '}',
          // THE THREE PLACES: the left and the right sharing the row (the right taking what is left, as the band
          // always did); with something in the center, two equal sides and the center between them, truly centered
          '.bz{display:flex;align-items:center;gap:24px;min-width:0;height:60px}',
          '.bl{flex:0 1 auto;min-width:auto}.br{flex:1 1 auto;justify-content:flex-end}',
          '.grid-band.has-center{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}',
          '.has-center .bc{justify-content:center}.has-center .bl{justify-content:flex-start}',
          '.bz:empty{min-width:0}',
          // (in the left or the center, the weather and the chips their own width, not the row's)
          '.bl .band-weather,.bc .band-weather{flex:0 1 auto}.bl .band-chips,.bc .band-chips{flex:0 1 auto}',
          '.band-clock{flex:none;min-width:0}',
          '.band-clock>[data-hk-clock=clock]{min-width:0!important}',
          '.band-weather{flex:1 1 240px;min-width:0;max-width:360px}',
          fitCss('.band-weather'),
          '.band-security{flex:1 1 280px;min-width:0;margin-left:auto}',
          // (the chips' shadows inside the clip: 14 px above and below, given back by the margin -- the owner,
          // 2026-10-31: a hard line round the Security chip)
          '.band-chips{display:none;min-width:0;flex:1 1 360px;height:60px;align-items:center;overflow:hidden;box-sizing:content-box;padding:14px 0;margin:-14px 0}',
          '.band-chips>*{width:100%;min-width:0}',
          '.grid-band.has-chips .band-security{display:none}',
          '.grid-band.has-chips .band-chips{display:flex}',
          '.band-clock,.band-weather,.band-security{cursor:pointer;min-height:44px;display:flex;flex-direction:column;justify-content:center;filter:var(--hk-glow,' + SHADOW + ')}',
          // Align the two caption baselines instead of centring unequal-height stacks.
          '.band-clock,.band-weather{align-self:stretch;justify-content:flex-end;padding-bottom:4px;box-sizing:border-box}',
          '@container hk-band (max-width:' + C.BP.cardSide + 'px){.band-weather{display:none}.grid-band{gap:10px}}'
        ].join('');
      }
      setConfig(config) {
        this.toggleAttribute('data-grid-band', !!(config && config.grid_band));
        super.setConfig(config || {});
      }
      _receiveClient() {
        super._receiveClient();
        if (this._bandChips) window.hkHostClient.bridge(this._bandChips, this.client);
      }
      _renderBand() {
        var H = window.hkHeader, st = this.client && this.client.states;
        if (!H || !st) return;
        // WHERE EACH PART SITS (2026-11-01, the owner): the layout's `parts` in order, each left, center or right
        // (the order is left to right within a place); none given, the clock and the weather on the left and the
        // chips (Security where the screen has none) on the right, as the band always was
        var cfg = this._config, parts = Array.isArray(cfg.parts) ? cfg.parts
          : [{ k: 'clock', at: 'left' }, { k: 'weather', at: 'left' }, { k: 'chips', at: 'right' }].filter(function (p) {
            return !(p.k === 'clock' && cfg.show_clock === false) && !(p.k === 'weather' && cfg.show_weather === false);
          });
        var partsKey = JSON.stringify(parts);
        if (this._built && this._partsKey !== partsKey) { this._built = false; this._bandChips = null; }
        if (!this._built) {
          this._partsKey = partsKey;
          var EL = { clock: '<div class="band-clock" role="button" tabindex="0" aria-label="Clock and date"></div>',
                     weather: '<div class="band-weather" role="button" tabindex="0" aria-label="Weather"></div>',
                     chips: '<div class="band-security" role="button" tabindex="0" aria-label="Security"></div><div class="band-chips"></div>' };
          var zone = function (at) { return parts.filter(function (p) { return p.at === at; }).map(function (p) { return EL[p.k]; }).join(''); };
          var center = zone('center');
          this._root.innerHTML = '<div class="grid-band' + (center ? ' has-center' : '') + '"><div class="bz bl">' + zone('left') + '</div>' +
            (center ? '<div class="bz bc">' + center + '</div>' : '') + '<div class="bz br">' + zone('right') + '</div>' +
            // (each part's element exists whether shown or not: the redraw below fills them all)
            '<div hidden>' + ['clock', 'weather', 'chips'].filter(function (k) { return !parts.some(function (p) { return p.k === k; }); })
              .map(function (k) { return EL[k]; }).join('') + '</div></div>';
          var chipsAt = (parts.filter(function (p) { return p.k === 'chips'; })[0] || {}).at || 'right';
          var self = this;
          this._bandClock = this._root.querySelector('.band-clock');
          this._bandWeather = this._root.querySelector('.band-weather');
          this._bandSecurity = this._root.querySelector('.band-security');
          var open = function (el, fn) {
            el.addEventListener('click', fn);
            el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
          };
          open(this._bandClock, function () { if (C.menu && C.menu.clock()) C.menu.toggle(); else self._go('./home'); });
          open(this._bandWeather, function () { self._go('./weather'); });
          open(this._bandSecurity, function () { self._go('./security'); });
          if (this._config.chips) {
            this._bandChips = C.createCard(Object.assign({}, this._config.chips, {
              lead: false, align: chipsAt === 'left' ? 'start' : chipsAt === 'center' ? 'center' : 'end', pad_top: 0, pad_bottom: 0, pad_left: 0, pad_right: 0, margin: '0'
            }), this.client);
            this._root.querySelector('.band-chips').appendChild(this._bandChips);
          }
          this._root.querySelector('.grid-band').classList.toggle('has-chips', !!this._bandChips);
          this._built = true;
        }
        C.morph(this._bandClock, H.clock(st, { timeSize: C.TYPE['figure-l'].size + 'px', ampmSize: C.TYPE.caption.size + 'px',
          dateSize: C.TYPE.caption.size + 'px', timeLh: '1', dateGap: '3px', gap: '6px', timeShift: this._shift || 0 }));
        C.morph(this._bandWeather, H.weather(st, { glyph: '32px', mainSize: C.TYPE.headline.size + 'px',
          detailSize: C.TYPE.caption.size + 'px', detailGap: '4px', gap: '10px' }));
        C.morph(this._bandSecurity, H.security(st, { line1Size: C.TYPE.headline.size + 'px', lineSize: C.TYPE.caption.size + 'px',
          minHeight: '0px', pad: '0px', shadow: 'none' }));
        if (H.fitWeather) H.fitWeather(this._bandWeather);
        this._bandClock.style.display = parts.some(function (p) { return p.k === 'clock'; }) ? '' : 'none';
        this._bandWeather.style.display = parts.some(function (p) { return p.k === 'weather'; }) ? '' : 'none';
      }
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
      // entity and read two computed styles on every state push, several a
      // second on every wall tablet. Its inputs are all
      // knowable: the clock sensors, the weather entity, sun.sun and the
      // Home-status lists (hkHeader.lists), plus the optical shift. Without a
      // Time & Date sensor the clock is this screen's own and moves once a
      // minute, which the last term covers.
      _sigOf() {
        var h = this.client, H = window.hkHeader, HS = window.hkSettings;
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
        // (a client can arrive before the config: the editor's previews hand one over first)
        if (!this._config) return;
        if (this._config.grid_band) { this._renderBand(); return; }
        var cfg = this._config;
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="hdr" data-hk-role="card"><div class="grid">' +
            '<div class="half left" role="button" data-hk-role="left"></div>' +
            '<div class="half right" role="button" data-hk-role="right"></div>' +
            '</div></hk-plate>';
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
        var card = this._root.querySelector('hk-plate.hdr');
        if (card && card.classList) card.classList.toggle('gone', gone);
        if (gone) { this._lastL = this._lastR = null; return; }
        var H = window.hkHeader, st = this.client && this.client.states;
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
        // every state update -- measured 98 DOM mutations in 10 s, and a
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

    // what the shell and the later parts use of this one
    K.HkHeaderCard = HkHeaderCard;
  };
})();
