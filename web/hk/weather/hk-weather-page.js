// hk-weather-page.js - the weather page's band: its CSS, its methods and the band card.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-page'] = function (K) {
    var arrive = K.arrive, BAND_KEYS = K.BAND_KEYS, Base = K.Base, BUILD = K.BUILD, build = K.build,
        BUILD_CSS = K.BUILD_CSS, buildDue = K.buildDue, C = K.C, dir16 = K.dir16, esc = K.esc, fmtTime = K.fmtTime,
        glyph = K.glyph, hourLabel = K.hourLabel, houseWeather = K.houseWeather, nightOf = K.nightOf, num = K.num,
        ownKeys = K.ownKeys, RULE = K.RULE, SECTIONS = K.SECTIONS, titled = K.titled, upcomingDays = K.upcomingDays,
        WX_METRIC_ORDER = K.WX_METRIC_ORDER, wxEnter = K.wxEnter, wxLeave = K.wxLeave, wxPage = K.wxPage;

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
      '.hero .bd{position:absolute;z-index:-1;pointer-events:none;line-height:0;font-size:1.4286em;letter-spacing:0;left:calc(18px - .38em);top:-.5023em;clip-path:inset(-60px)}',
      '.hero .bd::before{content:"";position:absolute;z-index:-1;left:6%;top:14%;width:88%;height:88%;border-radius:50%;' +
        'background:radial-gradient(closest-side,rgba(0,10,30,.2),rgba(0,10,30,.12) 55%,rgba(0,10,30,0))}',
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
      'hk-plate.wxp{box-sizing:border-box;display:flex;flex-direction:column;padding:' + C.CARD.pad + ';margin:0;' + C.plate('card') + ';overflow:hidden;',
      '  color:' + C.v('ink') + ';--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
      '.wxp .hd{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:34px}',
      '.wxp .tt{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:' + C.v('ink-2') + ';white-space:nowrap}',
      '.wxp .tt hk-icon{--mdc-icon-size:17px;width:17px;height:17px;flex:none;display:flex;align-items:center;justify-content:center;line-height:0}',
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
      'hk-plate.wxp.dly{height:var(--hk-wx-pair-h,455px)}',
      ':host([data-hk-cell]) hk-plate.wxp.dly{height:100%}',
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
      // A HOME GRID BLOCK'S TAP (hk-base.js openTarget; 2026-10-31, the owner on 0.1.94: the Weather block opened
      // nothing): the Weather page, else the weather's own sheet
      _tapTarget() { var id = (this._config || {}).entity; return [{ page: 'weather' }, id && { sheet: id }]; },
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
        return { wind: HS && HS.unit ? HS.unit(st, 'wind_speed_unit', window.hkLocale.units().speed) : (a.wind_speed_unit || window.hkLocale.units().speed) };
      },
      _renderSection() {
        if (!this._config || !this.client) return;
        var s = this._section();
        if (this._cellSize()) this._renderBlock();
        else if (s === 'hero') this._renderHero();
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
        var cfg = this._config, states = this.client.states, st = states[cfg.entity] || {}, a = st.attributes || {};
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
      // ---- A HOME GRID BLOCK (G2), Weather's own widgets at each size (2026-10-31, the owner's notes on the
      // widget mock-up): Small the place, the temperature, the symbol, the condition and today's high and low;
      // Wide those and the next six hours; Tall the hours down its length (as many as it holds, up to eight);
      // Large the hours and five days; Extra Large the Weather page in small -- the hours, then feels like,
      // humidity, wind, the chance of rain, sunset and UV in the left column, seven days on the right.
      _renderBlock() {
        var cfg = this._config, states = this.client.states, st = states[cfg.entity] || {}, sz = this._cellSize();
        var a = st.attributes || {}, src = this._sources(), t = this._nowTemp();
        var cond = window.hkHeader && window.hkHeader.conditionName ? window.hkHeader.conditionName(st.state) : String(st.state || '');
        var nDays = sz === 'XL' ? 7 : sz === 'L' ? 5 : 1;
        var allDays = this._days(nDays), today = allDays[0] || {}, hi = num(today.temperature), lo = num(today.templow);
        var night = !!(window.hkHeader && window.hkHeader.isNight && window.hkHeader.isNight(states));
        var sym = function (state, px) {
          return window.hkHeader && window.hkHeader.wxSvg && !/^(unknown|unavailable)$/.test(state || 'unknown')
            ? window.hkHeader.wxSvg(state, px, { night: night, sym: true }) : '';
        };
        this._watchBlock();
        var hl = [hi !== null ? 'H:' + Math.round(hi) + '°' : '', lo !== null ? 'L:' + Math.round(lo) + '°' : ''].filter(Boolean).join('  ');
        var place = esc(titled(cfg.place || this._place())), now = t !== null ? Math.round(t) + '°' : '--';
        var skyEl = cfg.sky ? '<hk-grid-weather-sky entity="' + esc(cfg.entity) + '" aria-hidden="true"></hk-grid-weather-sky>' : '';
        var done = function (self, html) {
          C.morph(self._root, html);
          var sky = self._root.querySelector('hk-grid-weather-sky');
          if (sky) sky.client = self.client;
        };
        // BIG TEMPERATURE (2026-10-24, StandBy's weather): the place, the
        // temperature as large as the block holds, then the condition and
        // today's high and low -- nothing else, at any size it is chosen for.
        if (cfg.big) {
          return done(this, '<hk-plate class="wb big ' + sz + (cfg.sky ? ' sky' : '') + '" role="group" aria-label="Weather">' + skyEl +
            '<b class="place-name">' + place + '</b>' +
            '<div class="bn">' + now + '</div>' +
            '<div class="bc"><span class="sym" aria-hidden="true">' + sym(st.state, '26px') + '</span><b>' + esc(cond || '--') + '</b></div>' +
            (hl ? '<span class="bh">' + esc(hl) + '</span>' : '') + '</hk-plate>');
        }
        var plate = function (label, inner) {
          return '<hk-plate class="wb ' + sz + (sz === 'W' && hrs.length ? ' hh' : '') + (cfg.sky ? ' sky' : '') + '" role="group" aria-label="' + label + '">' + skyEl + inner + '</hk-plate>';
        };
        // SMALL: the place and the temperature at the top, the symbol, the
        // condition and the high and low at the foot (on a tile, the symbol
        // beside the condition: 150 tall holds no line of its own for it)
        if (sz === 'S') {
          return done(this, plate('Weather', '<b class="place-name">' + place + '</b><div class="tpn">' + now + '</div>' +
            '<div class="sc"><span class="sym" aria-hidden="true">' + sym(st.state, '26px') + '</span><span class="sct"><b>' + esc(cond || '--') + '</b>' +
            (hl ? '<span>' + esc(hl) + '</span>' : '') + '</span></div>'));
        }
        var top = '<div class="top"><div class="place-now"><b class="place-name">' + place + '</b>' +
          '<div class="tpn">' + now + '</div></div>' +
          '<div class="tx"><div class="sym" aria-hidden="true">' + sym(st.state, '32px') + '</div><b>' + esc(cond || '--') + '</b>' +
          (hl ? '<span>' + esc(hl) + '</span>' : '') + '</div></div>';
        var hourCells = function (list) {
          return '<div class="hrs" style="grid-template-columns:repeat(' + list.length + ',minmax(0,1fr))">' + list.map(function (h) {
            var value = num(h.temperature);
            return '<div class="hr"><small>' + esc(hourLabel(h.datetime)) + '</small>' + sym(h.condition, '24px') +
              '<b>' + (value !== null ? Math.round(value) + '°' : '--') + '</b></div>';
          }).join('') + '</div>';
        };
        // TALL: the hours down its length, one a line, as many as it holds
        // (eight on square cells, six on tiles), spread to its foot
        if (sz === 'T') {
          // (the hours' room: the block less its inset and the five lines above them, 24 px an hour at the least)
          var blk = this._block(), fit = blk ? Math.floor((blk.h - 158) / 24) : 8;
          var vh = this._hours(Math.max(3, Math.min(8, fit)));
          return done(this, plate('Weather forecast', '<b class="place-name">' + place + '</b><div class="tpn">' + now + '</div>' +
            '<div class="tl"><span class="sym" aria-hidden="true">' + sym(st.state, '22px') + '</span><b>' + esc(cond || '--') + '</b></div>' +
            (hl ? '<span class="th">' + esc(hl) + '</span>' : '') +
            (vh.length ? '<div class="vh">' + vh.map(function (h) {
              var value = num(h.temperature);
              return '<div class="vr"><small>' + esc(hourLabel(h.datetime)) + '</small>' + sym(h.condition, '20px') +
                '<b>' + (value !== null ? Math.round(value) + '°' : '--') + '</b></div>';
            }).join('') + '</div>' : '')));
        }
        var dayRows = function (days) {
          var span = days.flatMap(function (d) { return [num(d.templow), num(d.temperature)]; }).filter(function (v) { return v !== null; });
          var min = span.length ? Math.min.apply(null, span) : 0, max = span.length ? Math.max.apply(null, span) : 1, range = Math.max(1, max - min);
          return '<div class="days">' + days.map(function (d, i) {
            var low = num(d.templow), high = num(d.temperature);
            var left = low === null ? 0 : (low - min) / range * 100, width = low === null || high === null ? 0 : (high - low) / range * 100;
            var day = i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString(undefined, { weekday: 'short' });
            return '<div class="day"><b>' + esc(day) + '</b>' + sym(d.condition, '20px') +
              '<span class="low">' + (low === null ? '--' : Math.round(low) + '°') + '</span><i class="range">' +
              '<i style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></i></i><span>' + (high === null ? '--' : Math.round(high) + '°') + '</span></div>';
          }).join('') + '</div>';
        };
        var hrs = this._hours(sz === 'XL' ? 5 : 6);
        // EXTRA LARGE: the page in small. Each reading only when the house has it: feels like, humidity, wind, the chance
        // of rain (today's, else this hour's), the sun's next setting (its rising, after dark), UV, pressure, visibility and
        // dew point. (2026-11-08, the owner: the readings were bunched at the foot with glass above them: they fill the
        // column as rows of one designed height (46 px on a square cell, 40 on a tile), up to six, centered, a short last row too.)
        if (sz === 'XL') {
          var rd = function (id, attr) { return id ? num((states[id] || {}).state) : num(a[attr]); };
          var feels = rd(src.feels, 'apparent_temperature'), hum = rd(src.humidity, 'humidity'), wind = rd(src.wind, 'wind_speed');
          var h0 = hrs[0] || {}, rain = num(today.precipitation_probability), uv = num(a.uv_index), prs = num(a.pressure), vis = num(a.visibility), dew = num(a.dew_point);
          if (rain === null) rain = num(h0.precipitation_probability); if (uv === null) uv = num(h0.uv_index);
          var sun = states['sun.sun'], sa = (sun && sun.attributes) || {}, up = !sun || sun.state !== 'below_horizon';
          var at = fmtTime(up ? sa.next_setting : sa.next_rising), brg = num(a.wind_bearing), blk = this._block(), tile = !!blk && blk.h < 380;
          var reads = [
            ['mdi:thermometer', 'Feels like', feels !== null ? Math.round(feels) + '°' : null], ['mdi:water-percent', 'Humidity', hum !== null ? Math.round(hum) + '%' : null],
            ['mdi:weather-windy', 'Wind' + (brg !== null ? ' ' + dir16(brg) : ''), wind !== null ? Math.round(wind) + ' ' + this._units().wind : null],
            ['mdi:weather-rainy', 'Rain', rain !== null ? Math.round(rain) + '%' : null], ['mdi:weather-sunset', up ? 'Sunset' : 'Sunrise', at],
            ['mdi:white-balance-sunny', 'UV', uv !== null ? Math.round(uv) + ' ' + (uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very High' : 'Extreme') : null],
            ['mdi:gauge', 'Pressure', prs !== null ? (a.pressure_unit === 'inHg' ? prs.toFixed(2) : Math.round(prs)) + ' ' + (a.pressure_unit || '') : null],
            ['mdi:eye', 'Visibility', vis !== null ? Math.round(vis) + ' ' + (a.visibility_unit || '') : null], ['mdi:thermometer-water', 'Dew point', dew !== null ? Math.round(dew) + '°' : null]
          ].filter(function (r) { return r[2]; }).slice(0, 6);
          var per = tile ? 3 : 2, odd = reads.length % per;    // (12 grid columns: 2 readings across a square cell, 3 across a tile; a short last row shares them)
          return done(this, plate('Weather forecast', '<div class="lc">' + top + (hrs.length ? hourCells(hrs) : '') +
            (reads.length ? '<div class="rds"' + (reads.length <= per ? ' style="flex:none"' : '') + '>' + reads.map(function (r, i) {
              var first = odd && i === reads.length - odd, st = first ? 'grid-column:' + (1 + (12 - odd * 12 / per) / 2) + ' / span ' + 12 / per : 'grid-column:span ' + 12 / per;
              return '<span style="' + st + '"><hk-icon icon="' + r[0] + '" aria-hidden="true"></hk-icon><small>' + esc(r[1]) + '</small><b>' + esc(r[2]) + '</b></span>';
            }).join('') + '</div>' : '') + '</div>' +
            (allDays.length ? '<div class="rc"><b class="lab">' + allDays.length + '-Day Forecast</b>' + dayRows(allDays) + '</div>' : '')));
        }
        // WIDE AND LARGE: the top, the next six hours; Large five days under them
        return done(this, plate('Weather forecast', top + (hrs.length ? hourCells(hrs) : '') + (sz === 'L' && allDays.length ? dayRows(allDays) : '')));
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
        var self = this, cfg = this._config, states = this.client.states;
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
          this._root.innerHTML = '<hk-plate class="wxp hrly"><div class="hd">' +
            '<div class="tt"><hk-icon icon="hk:clock"></hk-icon>Hourly Forecast</div>' +
            '<div class="seg" role="radiogroup" aria-label="Hourly forecast shows"></div></div>' +
            '<div class="hs"><div class="hrs"></div></div><div class="rd" aria-live="polite"></div></hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { seg: q('.seg'), hs: q('.hs'), hrs: q('.hrs'), rd: q('.rd') };
          if (window.hkCards.fitPanWatch) window.hkCards.fitPanWatch(this._e.hs);
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
        C.morph(e.hrs, hrs.length ? cells : '<div class="wait">' + (state === 'wait' ? 'Loading the forecast…' : 'No hourly forecast from ' + esc(this._service() || 'the weather service') + '.') +
          '</div>');
        e.hrs.setAttribute('data-state', state);
        if (hrs.length && buildDue(this)) build(this, this._root.querySelector('hk-plate.wxp'));
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
          this._root.innerHTML = '<hk-plate class="wxp dly"><div class="hd"><div class="tt"><hk-icon icon="mdi:calendar-month"></hk-icon><span class="nm"></span></div></div>' +
            '<div class="dys" role="list"></div><div class="ft"></div></hk-plate>';
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
          var nm = i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short' }));
          var long = i === 0 ? 'Today' : new Date(d.datetime).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long' }));
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
        C.morph(e.dys, days.length ? rows : '<div class="wait">' + (state === 'wait' ? 'Loading the forecast…' : 'No daily forecast from ' + esc(this._service() || 'the weather service') + '.') +
          '</div>');
        e.dys.setAttribute('data-state', state);
        if (days.length && buildDue(this)) build(this, this._root.querySelector('hk-plate.wxp'));
        else if (was === 'wait' && state === 'ok') arrive(e.dys);
        // the week in a line: its warmest and coolest days
        var ft = '';
        if (days.length > 2) {
          var his = days.map(function (d, i) { return { v: num(d.temperature), i: i }; }).filter(function (x) { return x.v !== null; });
          if (his.length > 2) {
            var w = his.reduce(function (m, x) { return x.v > m.v ? x : m; }), c = his.reduce(function (m, x) { return x.v < m.v ? x : m; });
            var dn = function (i) { return i === 0 ? 'today' : new Date(days[i].datetime).toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long' })); };
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
          'hk-plate.band{' + window.hkCards.plate('card') + ';',
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
          'hk-plate.band.plain{background:none;border:none;border-radius:0;box-shadow:none;',
          '  -webkit-backdrop-filter:none;backdrop-filter:none;padding:0 24px;margin:0}',
          '.plain .wrap{text-shadow:var(--hk-glow,0 1px 3px rgba(0,0,0,0.45),0 4px 18px rgba(0,0,0,0.35))}',
          '.plain .place,.plain .sub,.plain .lbl,.plain .lo,.plain .pop.wet{color:var(--hk-ink-2,#fff)}',
          '.plain .pop{color:var(--hk-ink-3,#fff)}',
          '.plain .temp,.plain .cond,.plain .lbl.now,.plain .hi{color:var(--hk-ink,#fff)}',
          // ON A HOME GRID (G2, the `weather` block): a plate -- the place
          // and the temperature, the symbol, the condition and today's high
          // and low; the hours and the days as each size has them
          // (_renderBlock). Square cells (196 tall, two rows 405) and tile
          // cells (150, two rows 310) each get their spacing by hk-cell query.
          'hk-plate.wb{' + window.hkCards.plate('card') + ';box-sizing:border-box;height:100%;margin:0;padding:' + window.hkCards.blockPad(window.hkCards.CARD.pad) + ';',
          '  display:flex;flex-direction:column;justify-content:flex-start;gap:12px;overflow:hidden;color:' + C.v('ink') + '}',
          '.wb .top{display:flex;justify-content:space-between;align-items:center;gap:12px;min-width:0;flex:none}',
          // THE HEADING (2026-11-08, the owner: titles "all need to match"): the place and the 7-day label are the one gray heading, on the text inset, content 8 px under
          '.wb .place-now{min-width:0}' + C.headCss('.wb .place-name,.wb .rc .lab') +
            '.wb .place-name,.wb .rc .lab{display:block;flex:none;height:16px;padding:1.5px 0;margin:0 0 -4px}.wb .place-now .place-name{margin-bottom:8px}',
          '.wb .sym{line-height:0}.wb svg{display:block;flex:none}',
          '.wb .tpn{' + C.typeCss('hero') + ';line-height:1.08;font-weight:400;font-variant-numeric:tabular-nums}',
          '.wb .tx{display:flex;flex-direction:column;align-items:flex-end;min-width:0;gap:2px;text-align:right}',
          '.wb .tx b{' + C.typeCss('body') + ';line-height:18px}.wb .tx span{' + C.typeCss('caption') + ';line-height:17px;color:' + C.v('ink-2') + '}',
          '.wb .tx b,.wb .tx span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
          '.wb .hrs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;border-top:1px solid ' + RULE + ';padding-top:10px;flex:none}',
          '.wb .hr{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}',
          '.wb .hr small{' + C.typeCss('caption') + ';line-height:16px;color:' + C.v('ink-2') + ';white-space:nowrap}',
          '.wb .hr b{' + C.typeCss('body') + ';line-height:18px;font-variant-numeric:tabular-nums}',
          '.wb .days{display:grid;gap:2px;border-top:1px solid ' + RULE + ';padding-top:6px;flex:none}',
          '.wb .day{display:grid;grid-template-columns:52px 20px 32px minmax(0,1fr) 32px;align-items:center;gap:10px;height:20px;' + C.typeCss('caption') + ';font-variant-numeric:tabular-nums}',
          '.wb .day b{font-weight:600}.wb .low{color:' + C.v('ink-2') + ';text-align:right}.wb .day>span:last-child{text-align:right}',
          '.wb .range{display:block;height:5px;border-radius:' + C.R.capsule('5px') + ';background:' + C.v('key') + ';position:relative;overflow:hidden}',
          '.wb .range i{position:absolute;height:100%;border-radius:' + C.R.capsule('5px') + ';background:linear-gradient(90deg,#64d2ff,#ffd60a,#ff9f0a)}'
          ,
          // WIDE ON A SQUARE CELL (2026-10-31, the owner's widget references:
          // Weather's medium widget, the same 2 : 1): 196 tall, not 150 --
          // the place and temperature, the condition and high and low at the
          // top, the next six hours along the foot, where a tile's row left
          // the lower half bare. On a tile (150 tall holds no row under the
          // top) the hours go beside it: the place, the temperature and the
          // condition on the left, five hours on the right (2026-10-31: the
          // tile's Wide had left half of itself bare).
          '.wb.W .hrs{display:none}',
          '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){hk-plate.wb.W.hh{justify-content:space-between}.wb.W .hrs{display:grid;border-top:0;padding-top:0}' +
            '.wb.W .hr{gap:2px}}',
          // (a square cell never: its Wide is the widget's, whatever height it measures -- 2026-11-01, the owner: the grid's
          // Wide showed less than the picker's. And today's high and low kept: 150 tall has room for them.)
          '@container hk-cell (max-height:179px) and (not style(--hk-cell-shape: square)){hk-plate.wb.W.hh{flex-direction:row;align-items:center;gap:14px}' +
            '.wb.W.hh .top{flex-direction:column;align-items:flex-start;gap:2px;max-width:40%}' +
            '.wb.W.hh .tx{align-items:flex-start;text-align:left}.wb.W.hh .tx .sym{display:none}' +
            '.wb.W.hh .hrs{display:grid;flex:1;min-width:0;grid-template-columns:repeat(5,minmax(0,1fr));border-top:0;padding:0 0 0 12px;border-left:1px solid ' + RULE + '}' +
            '.wb.W.hh .hr:nth-child(n+6){display:none}.wb.W.hh .hr{gap:2px}}',
          // SMALL (2026-10-31): the place and the temperature, the symbol over
          // the condition and the high and low at the foot -- on a tile the
          // symbol beside them
          '.wb.S{justify-content:flex-start;gap:0}',
          '.wb.S .sc{margin-top:auto;display:flex;align-items:center;gap:8px;min-width:0}',
          '.wb.S .sct{display:flex;flex-direction:column;min-width:0}',
          '.wb.S .sct b{' + C.typeCss('body') + ';font-weight:600;line-height:18px}.wb.S .sct span{' + C.typeCss('caption') + ';line-height:17px;color:' + C.v('ink-2') +
            ';font-variant-numeric:tabular-nums}',
          '.wb.S .sct b,.wb.S .sct span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){.wb.S .sc{flex-direction:column;align-items:flex-start;gap:4px}}',
          // TALL: the symbol and the condition under the temperature, the
          // high and low under them, then the hours down the rest, spread to
          // the foot
          '.wb.T{justify-content:flex-start;gap:0}',
          '.wb.T .tl{display:flex;align-items:center;gap:6px;min-width:0;margin-top:2px}',
          '.wb.T .tl b{' + C.typeCss('body') + ';font-weight:600;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.wb.T .th{' + C.typeCss('caption') + ';line-height:17px;color:' + C.v('ink-2') + ';font-variant-numeric:tabular-nums;white-space:nowrap}',
          '.wb.T .vh{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;justify-content:space-between;border-top:1px solid ' + RULE + ';margin-top:12px;padding-top:8px}',
          '.wb.T .vr{display:grid;grid-template-columns:minmax(0,1fr) 20px 40px;align-items:center;gap:8px;height:22px}',
          '.wb.T .vr small{' + C.typeCss('caption') + ';color:' + C.v('ink-2') + ';white-space:nowrap}',
          '.wb.T .vr b{' + C.typeCss('body') + ';font-weight:600;text-align:right;font-variant-numeric:tabular-nums}',
          // LARGE: the top with room round it, the hours, five days
          '.wb.L{gap:14px}.wb.L .hrs{padding-top:12px}.wb.L .hr{gap:2px}.wb.L .days{padding-top:10px;gap:4px}',
          '.wb.L .day,.wb.XL .day{height:24px;font-size:15px}',
          '@container hk-cell (max-height:380px){.wb.L{gap:8px}.wb.L .hrs{padding-top:6px}.wb.L .days{padding-top:6px;gap:2px}.wb.L .day,.wb.XL .day{height:20px;font-size:13px}}',
          // EXTRA LARGE, a small Weather page: the top, the hours and the
          // readings (two across, with room between) on the left; seven days
          // on the right, one under the other, not spread to its foot
          '.wb.XL{display:grid;grid-template-columns:276px minmax(0,1fr);column-gap:24px;align-items:stretch}.wb.XL .lc:only-child{grid-column:1/-1}',
          '.wb.XL .lc{display:flex;flex-direction:column;justify-content:space-between;gap:12px;min-width:0;min-height:0}',
          '.wb.XL .hrs{padding-top:10px}.wb.XL .hr{gap:2px}',
          '.wb.XL .rds{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:0 14px;border-top:1px solid ' + RULE +
            ';flex:1 1 auto;min-height:0;grid-auto-rows:46px;align-content:center;align-items:center}',
          '.wb.XL .rds span{display:grid;grid-template-columns:18px minmax(0,1fr);column-gap:6px;align-items:center;min-width:0}',
          '.wb.XL .rds hk-icon{width:16px;height:16px;--mdc-icon-size:16px;color:' + C.v('ink-2') + ';display:block;line-height:0}',
          '.wb.XL .rds small{' + C.typeCss('caption') + ';line-height:16px;color:' + C.v('ink-2') + '}',
          '.wb.XL .rds b{grid-column:2;' + C.typeCss('body') + ';font-weight:600;line-height:19px;font-variant-numeric:tabular-nums}',
          '.wb.XL .rds small,.wb.XL .rds b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
          '.wb.XL .rc{display:flex;flex-direction:column;justify-content:center;gap:10px;min-width:0}',
          '.wb.XL .days{border-top:0;padding-top:0;gap:8px}',
          // (on a tile: the readings three across, each its value under it)
          '@container hk-cell (max-height:380px){.wb.XL{grid-template-columns:288px minmax(0,1fr)}.wb.XL .lc{gap:8px}.wb.XL .hrs{padding-top:6px}' +
            '.wb.XL .rds{column-gap:8px;grid-auto-rows:40px}.wb.XL .rds span{grid-template-columns:16px minmax(0,1fr);column-gap:4px}' +
            '.wb.XL .rds b{grid-column:1/-1}}',
          // LARGE AND EXTRA LARGE FILL THEIR BLOCK (2026-11-01, the owner: "lots of space above and below"): the
          // temperature as large as the block's height allows, the hours' figures a step up, and the days sharing
          // the room left under them (Large) or down the right column from its label (Extra Large), each a row
          // as tall as that room gives it -- the same things, spread, not more of them
          '.wb.L .tpn,.wb.XL .tpn{font-size:clamp(44px,16cqh,84px);line-height:1}',
          '.wb.L .hr b,.wb.XL .hr b{font-size:clamp(15px,4.4cqh,21px);line-height:1.2}',
          '.wb.L .hr svg,.wb.XL .hr svg{width:clamp(24px,6.5cqh,32px);height:auto}',
          '.wb.XL .rds b{font-size:clamp(15px,4.4cqh,21px);line-height:1.25}',
          '.wb.L{justify-content:flex-start}',
          '.wb.L .days,.wb.XL .days{flex:1 1 auto;min-height:0;grid-auto-rows:minmax(20px,1fr);align-content:stretch}',
          '.wb.L .day,.wb.XL .day{height:auto;min-height:20px;font-size:clamp(13px,3.8cqh,18px)}',
          '.wb.L .day svg,.wb.XL .day svg{width:clamp(18px,5cqh,26px);height:auto}',
          '.wb.L .day,.wb.XL .day{grid-template-columns:minmax(52px,auto) clamp(20px,5cqh,26px) 36px minmax(0,1fr) 36px}',
          '.wb.XL .rc{justify-content:center;gap:8px}.wb.XL .rc .lab{margin-bottom:0}.wb.XL .days{grid-auto-rows:32px;gap:4px;align-content:start}' +
            '@container hk-cell (max-height:380px){.wb.XL .days{grid-auto-rows:26px}}',
          // BIG TEMPERATURE: the number sized to the block (its height first, its width for a wide one)
          '.wb.big{gap:2px;justify-content:center;align-items:flex-start}',
          '.wb.big .place-name{max-width:100%;margin-bottom:6px}',
          '.wb.big .bn{font-size:clamp(44px,min(44cqh,30cqw),200px);line-height:1;font-weight:500;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:2px 0 6px -.04em}',
          '.wb.big .bc{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%}.wb.big .bc b{' + C.typeCss('headline') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.wb.big .bh{' + C.typeCss('body') + ';color:' + C.v('ink-2') + ';font-variant-numeric:tabular-nums}',
          '.wb.sky{position:relative;isolation:isolate;background:rgba(0,0,0,.22);--hk-glass-surface:0;backdrop-filter:none;-webkit-backdrop-filter:none;--hk-ink:#fff;' +
            '--hk-ink-2:rgba(255,255,255,.85);color:white;text-shadow:0 1px 4px rgba(0,0,0,.6)}',
          '.wb.sky>hk-grid-weather-sky{position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;overflow:hidden}.wb.sky>hk-grid-weather-sky::after{content:"";' +
            'position:absolute;inset:0;background:rgba(0,0,0,.24)}'

        ].join('') + PAGE_CSS;
      }

      // each new client: the house's weather resolved first, then HkBase's step
      _receiveClient() { houseWeather(this, this.client, BAND_KEYS); super._receiveClient(); }
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
        houseWeather(this, this.client, BAND_KEYS);
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
        // it has (a layout read, and _sigOf runs on every state push).
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
        // state push would find nothing to do and the cached forecast would
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
        var name = (this.client && this.client.config && this.client.config.location_name) || 'Home';
        return String(name).toUpperCase();
      }

      // The band reads two FORECAST sensors the config does not name, so the
      // base class's default signature would gate on the weather entity alone
      // and never redraw when a forecast arrived.
      _sigOf() {
        var h = this.client, c = this._config;
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
          return ((this.client.states[sensorId] || {}).attributes || {}).forecast || [];
        }
        var wid = this._config.entity, conn = this.client && this.client.subscriptions;
        var key = kind + '|' + wid;
        this._fcW = this._fcW || {};
        var w = this._fcW[key];
        // a new subscription port (a replaced socket) is watched afresh
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
        if (!this._config || !this.client) { return; }
        if (this._section()) { this._renderSection(); return; }
        var cfg = this._config, states = this.client.states;
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
                                   src.wind ? null : 'wind_speed_unit', window.hkLocale.units().speed)
          : window.hkLocale.units().speed;
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
            : dt.toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'short' }));
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
          '<hk-plate class="band' + (cfg.plain ? ' plain' : '') + '"><div class="wrap' + (narrow ? ' narrow' : '') + '"' +
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
          '</div></hk-plate>';

        // Bound per render, not once: _render replaces innerHTML wholesale, so
        // the previous hk-plate and its listener are discarded with it. There
        // is nothing to accumulate.
        var card = this._root.querySelector('hk-plate');
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

    // what the shell and the later parts use of this one
    K.HkWeatherBandCard = HkWeatherBandCard; K.PAGE_METHODS = PAGE_METHODS;
  };
})();
