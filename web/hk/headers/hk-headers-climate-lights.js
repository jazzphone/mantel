// hk-headers-climate-lights.js - the climate and lighting headers.
//
// PART OF THE PAGE HEADERS (hk-headers.js). Not a card and not run on its own: it registers one
// function, which hk-headers.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkHeadersParts = window.hkHeadersParts || {})['hk-headers-climate-lights'] = function (K) {
    var areaName = K.areaName, areaOf = K.areaOf, bars = K.bars, BARS_CSS = K.BARS_CSS, C = K.C, COOL = K.COOL,
        DAY = K.DAY, durHtml = K.durHtml, esc = K.esc, header = K.header, HeaderCard = K.HeaderCard, HEAT = K.HEAT,
        hm = K.hm, HOUR = K.HOUR, HOUR_LABELS = K.HOUR_LABELS, hourScrub = K.hourScrub, hr = K.hr, hs = K.hs,
        INSIDE = K.INSIDE, merge = K.merge, midnight = K.midnight, MIN = K.MIN, nameOf = K.nameOf, num = K.num,
        P = K.P, R = K.R, shortDur = K.shortDur, spans = K.spans, steps = K.steps, total = K.total, v = K.v;

    class HkClimateRuntimeCard extends HeaderCard {
      disconnectedCallback() {
        super.disconnectedCallback();
        if (this._fcSub) { this._fcSub.then(function (u) { if (u) u(); }); this._fcSub = null; this._fcFor = null; }
      }
      connectedCallback() { if (super.connectedCallback) super.connectedCallback(); if (this._built) this.redraw(); }
      static get PART_CSS() {
        return BARS_CSS + [
          '.tot{display:flex;gap:40px;margin-top:10px;flex:none;min-width:0}',
          '.lg{margin-left:auto;align-self:flex-start;display:flex;flex-direction:column;align-items:flex-end;gap:5px;font-size:11px;font-weight:600;color:' + v('ink-2') + ';white-space:nowrap}',
          '.lg span{display:flex;align-items:center;gap:6px}',
          '.lg i{display:inline-block;width:8px;height:8px;border-radius:50%}',
          '.lg i.ln{width:12px;height:0;border-top:2px solid var(--hk-flat-chart-line,rgba(255,255,255,0.85));border-radius:0}',
          // the indoor lines, each in its thermostat's colour, and its reading now
          // beside the thermostat's name -- the header is the quick look
          '.il{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}',
          '.tot .cap i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}',
          '.tot .cap b{font-weight:700;color:' + v('ink') + ';font-variant-numeric:tabular-nums}',
          '.tot>div{min-width:0}',
          '.tot .cap{margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.grow{flex:1;min-height:6px}',
          '@media (max-width:' + C.BP.phone + 'px){.tot{gap:24px}}'
        ].join('');
      }
      // the thermostats counted: Settings' pick, else the page's (the strategy
      // hands them over) that report heating and cooling
      _list() {
        var h = this.client, c = this._config || {}, pick = header('climate').thermostats;
        var all = (Array.isArray(pick) && pick.length ? pick : c.thermostats || []).filter(function (id) { return h.states[id] && /^climate\./.test(id); });
        return all.slice(0, 3);
      }
      _ids() { return this._list(); }
      _render() {
        this._shell('crun');
        var h = this.client, self = this;
        if (!h) return;
        var ths = this._list(), from = midnight(), now = Date.now();
        var acting = ths.filter(function (id) { return 'hvac_action' in (h.states[id].attributes || {}); });
        var list = acting.length ? acting : ths;
        if (!list.length) return this._paint('<div class="ttl"><b>Heating &amp; Cooling</b></div><div class="wait">No thermostats</div>');
        // the outside temperature: Configure -> Weather's outside sensor, else
        // the weather entity's own reading; the hours to come from its forecast
        var wid = (window.hkSettings && window.hkSettings.weatherId && window.hkSettings.weatherId(h.states)) || null;
        var outId = hs('weather.outside', null);
        if (outId && !h.states[outId]) outId = null;
        var outSrc = outId || wid;
        this._load('hist', 5 * MIN, function () {
          return h.callWS({ type: 'history/history_during_period', start_time: new Date(from).toISOString(),
            end_time: new Date().toISOString(), entity_ids: list.concat(outSrc ? [outSrc] : []), minimal_response: false, no_attributes: false,
            significant_changes_only: false });
        });
        var fcPort = window.hkCards.subscriptions(h);    // the client's subscription port
        if (wid && this._fcFor !== wid && fcPort) {
          if (this._fcSub) this._fcSub.then(function (u) { if (u) u(); });
          this._fcFor = wid;
          this._fcSub = fcPort.subscribeMessage(function (m) { self._fcH = (m && m.forecast) || []; self.redraw(); },
            { type: 'weather/subscribe_forecast', forecast_type: 'hourly', entity_id: wid }).catch(function () { return null; });
        }
        // the card's content width (contentRect: its padding already out)
        var H = this._hist, avail = Math.max(120, this._width());
        if (!H) return this._paint('<div class="ttl"><b>Heating &amp; Cooling</b></div><div class="wait">Loading today…</div>');
        var trim = function (id) { return nameOf(h, id).replace(/\s*(Ecobee\s*)?(Thermostat|Climate)$/i, '') || nameOf(h, id); };
        var nowK = Math.floor((now - from) / HOUR);
        var K = []; for (var k = 0; k < 24; k++) K.push(k);
        var inHour = function (sp, k) {
          var a = from + k * HOUR, b = a + HOUR;
          return sp.reduce(function (m, s) { return m + Math.max(0, Math.min(b, s[1]) - Math.max(a, s[0])); }, 0) / MIN;
        };
        if (!acting.length) {
          // NO HEATING OR COOLING REPORTED: the first thermostat's temperature,
          // each hour's mean, the bars from just under the day's lowest
          var s0 = steps(H[list[0]]).map(function (p) { return [p[0], num(p[2].current_temperature)]; }).filter(function (p) { return p[1] != null; });
          var mean = K.map(function (k) {
            var a = from + k * HOUR, xs = s0.filter(function (p) { return p[0] >= a && p[0] < a + HOUR; }).map(function (p) { return p[1]; });
            return xs.length ? xs.reduce(function (x, y) { return x + y; }, 0) / xs.length : null;
          });
          var got = mean.filter(function (x) { return x != null; }), floor = got.length ? Math.floor(Math.min.apply(null, got)) - 2 : 0;
          var B = bars(K.map(function (k) {
            return { segs: [{ v: mean[k] == null ? 0 : mean[k] - floor, c: COOL }], fut: k > nowK, label: HOUR_LABELS[k], now: k === nowK };
          }), avail, 56, true);
          this._nBars = 24;
          this._nowI = nowK;
          this._rdRest = 'Hover or touch an hour for its temperature';
          var cur = num(h.states[list[0]].attributes.current_temperature);
          this._paint('<div class="ttl"><b>Temperature Today</b><span>' + esc(trim(list[0])) + '</span></div>' +
            '<div class="tot"><div><div class="big num">' + (cur != null ? Math.round(cur) + '°' : '—') + '</div><div class="cap">now</div></div></div><div class="grow"></div>' +
            '<div class="bc">' + B.html + '</div><div class="rd">' + this._rdRest + '</div>');
          hourScrub(this, this._card.querySelector('.bc'), function (i) {
            var lab = (i % 12 || 12) + ' ' + (i < 12 ? 'AM' : 'PM');
            return lab + ' · ' + (i > nowK ? 'No data yet' : mean[i] == null ? 'No reading' : Math.round(mean[i]) + '° on average');
          });
          return;
        }
        var sys = list.map(function (id) {
          var s = steps(H[id]);
          return { id: id, name: trim(id),
                   cool: spans(s, from, now, function (p) { return p[2].hvac_action === 'cooling'; }),
                   heat: spans(s, from, now, function (p) { return p[2].hvac_action === 'heating'; }) };
        });
        var hours = K.map(function (k) {
          return { k: k, fut: k > nowK, sys: sys.map(function (s) { return { c: inHour(s.cool, k), h: inHour(s.heat, k) }; }) };
        });
        // ---- each thermostat's indoor temperature an hour, read as the outside
        // one is (the hour's middle; now, for this hour), and now
        sys.forEach(function (s, j) {
          var at = steps(H[s.id]).map(function (p) { return [p[0], num(p[2].current_temperature)]; })
            .filter(function (p) { return p[1] != null; });
          s.color = INSIDE[j % INSIDE.length];
          s.now = num(((h.states[s.id] || {}).attributes || {}).current_temperature);
          s.temp = K.map(function (k) {
            if (k > nowK) return null;
            if (k === nowK && s.now != null) return s.now;
            var tm = from + k * HOUR + HOUR / 2, last = null;
            for (var q = 0; q < at.length && at[q][0] <= tm; q++) last = at[q][1];
            return last;
          });
        });
        var hasIn = sys.some(function (s) { return s.temp.some(function (x) { return x != null; }); });
        // ---- the outside temperature an hour: the reading at the hour's
        // middle (now, for this hour); the forecast for the hours to come
        var outT = K.map(function () { return null; });
        if (outSrc && H[outSrc]) {
          var os = steps(H[outSrc]).map(function (p) {
            return [p[0], num(outId ? p[1] : p[2].temperature)];
          }).filter(function (p) { return p[1] != null; });
          var curOut = num(outId ? (h.states[outId] || {}).state : ((h.states[outSrc] || {}).attributes || {}).temperature);
          K.forEach(function (k) {
            if (k > nowK) return;
            var tm = k === nowK ? now : from + k * HOUR + HOUR / 2, last = null;
            for (var q = 0; q < os.length && os[q][0] <= tm; q++) last = os[q][1];
            outT[k] = k === nowK && curOut != null ? curOut : last;
          });
        }
        var fcT = K.map(function () { return null; });
        (this._fcH || []).forEach(function (f) {
          var k = Math.floor((Date.parse(f.datetime) - from) / HOUR);
          if (k > nowK && k < 24 && num(f.temperature) != null) fcT[k] = num(f.temperature);
        });
        var hasOut = outT.some(function (x) { return x != null; }) || fcT.some(function (x) { return x != null; });
        var anyHeat = sys.some(function (s) { return s.heat.length; }), anyCool = sys.some(function (s) { return s.cool.length; });
        var title = anyHeat && anyCool ? 'Heating &amp; Cooling Today' : anyHeat ? 'Heating Through the Day' : 'Cooling Through the Day';
        var B2 = bars(hours.map(function (x) {
          var c0 = x.sys.reduce(function (a, s) { return a + s.c; }, 0), h0 = x.sys.reduce(function (a, s) { return a + s.h; }, 0);
          return { segs: [{ v: h0, c: HEAT }, { v: c0, c: COOL }], fut: x.fut, label: HOUR_LABELS[x.k], now: x.k === nowK };
        }), avail, 56, true);
        this._nBars = 24;
        this._nowI = nowK;
        this._rdRest = hasOut || hasIn ? 'Hover or touch an hour for its runtime and temperatures' : 'Hover or touch an hour for runtime';
        // the lines over the bars, on their own scale (the day's coolest to
        // warmest): outside, and inside each thermostat -- one scale, so the
        // house reads against the weather
        if (hasOut || hasIn) {
          var all = outT.concat(fcT);
          sys.forEach(function (s) { all = all.concat(s.temp); });
          all = all.filter(function (x) { return x != null; });
          var tlo = Math.min.apply(null, all), thi = Math.max.apply(null, all), tsp = Math.max(4, thi - tlo);
          var BH = 56, ty = function (x) { return (BH - 6 - (x - tlo) / tsp * (BH - 16)).toFixed(1); };
          var bx = function (k) { return (k * (B2.bw + B2.gap) + B2.bw / 2).toFixed(1); };
          var seg = function (arr, cls) {
            var d = '', open = false;
            arr.forEach(function (x, k) { if (x == null) { open = false; return; } d += (open ? 'L' : 'M') + bx(k) + ' ' + ty(x); open = true; });
            return d ? '<path class="ol' + cls + '" d="' + d + '"/>' : '';
          };
          // the forecast joins the last reading, so the line has no gap at now
          var fcJoin = fcT.slice();
          if (outT[nowK] != null) fcJoin[nowK] = outT[nowK];
          var dots = K.map(function (k) {
            var x = outT[k] != null ? outT[k] : fcT[k];
            return x == null ? '' : '<circle class="od" data-i="' + k + '" cx="' + bx(k) + '" cy="' + ty(x) + '" r="3.5"/>';
          }).join('');
          var cur = outT[nowK];
          var tag = cur != null ? '<text class="ot" x="' + bx(nowK) + '" y="' + (Number(ty(cur)) - 7).toFixed(1) + '" text-anchor="middle">' + Math.round(cur) + '°</text>' : '';
          var inside = sys.map(function (s) {
            var d = '', open = false;
            s.temp.forEach(function (x, k) { if (x == null) { open = false; return; } d += (open ? 'L' : 'M') + bx(k) + ' ' + ty(x); open = true; });
            return d ? '<path class="il" stroke="' + s.color + '" d="' + d + '"/>' : '';
          }).join('');
          var inDots = sys.map(function (s) {
            return s.temp.map(function (x, k) {
              return x == null ? '' : '<circle class="od" data-i="' + k + '" cx="' + bx(k) + '" cy="' + ty(x) + '" r="3.5" style="fill:' + s.color + '"/>';
            }).join('');
          }).join('');
          B2.html = B2.html.replace('</svg>', inside + seg(fcJoin, ' fc') + seg(outT, '') + inDots + dots + tag + '</svg>');
        }
        var tot = sys.map(function (s) {
          var t = total(s.cool) + total(s.heat);
          return '<div data-more="' + esc(s.id) + '"><div class="big num">' + (t < MIN ? 'Idle' : durHtml(t)) + '</div><div class="cap">' +
            (hasIn ? '<i style="background:' + s.color + '"></i>' : '') + esc(s.name) + (s.now != null ? ' · <b>' + Math.round(s.now) + '°</b>' : '') + '</div></div>';
        }).join('');
        var lg = '<div class="lg"><span><i style="background:' + (anyHeat && !anyCool ? HEAT : COOL) + '"></i>' + (anyHeat && anyCool ? 'Heating · Cooling' : anyHeat ? 'Heating' : 'Cooling') +
          '</span>' +
          (hasOut ? '<span><i class="ln"></i>Outside</span>' : '') + '</div>';
        this._paint('<div class="ttl"><b>' + title + '</b></div><div class="tot">' + tot + lg + '</div><div class="grow"></div>' +
          '<div class="bc">' + B2.html + '</div><div class="rd">' + this._rdRest + '</div>');
        hourScrub(this, this._card.querySelector('.bc'), function (i) {
          var x = hours[i], lab = (i % 12 || 12) + ' ' + (i < 12 ? 'AM' : 'PM');
          var o = outT[i] != null ? 'Outside ' + Math.round(outT[i]) + '°' : fcT[i] != null ? 'Outside ' + Math.round(fcT[i]) + '° forecast' : '';
          if (x.fut) return lab + ' · ' + (o || 'No data yet');
          return lab + ' · ' + (o ? o + ' · ' : '') + sys.map(function (s, j) {
            var p = [], m = x.sys[j], t = s.temp[i];
            if (m.c >= 0.5) p.push(Math.round(m.c) + ' min cooling');
            if (m.h >= 0.5) p.push(Math.round(m.h) + ' min heating');
            return s.name + (t != null ? ' ' + Math.round(t) + '°' : '') + ' ' + (p.join(', ') || 'idle');
          }).join(' · ');
        });
      }
    }

    // ============================================= CLIMATE: OUTSIDE & AHEAD
    // The weather now (Settings' outside sensor first, as the Weather page),
    // today's high and low, the next three forecast hours two apart, and what
    // the evening does -- with sunset or sunrise.
    var WWORD = { 'clear-night': 'Clear', cloudy: 'Cloudy', exceptional: 'Unusual weather', fog: 'Foggy', hail: 'Hail', lightning: 'Thunderstorms',
      'lightning-rainy': 'Thunderstorms', partlycloudy: 'Partly cloudy', pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow',
      'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy' };
    class HkClimateOutsideCard extends HeaderCard {
      static get PART_CSS() {
        return [
          // the whole card opens the weather's sheet (hk-weather.js)
          '.all{flex:1;display:flex;flex-direction:column;min-height:0}',
          '.now{display:flex;align-items:center;gap:14px;margin:12px 0 10px}',
          '.now svg{flex:none}',
          '.now .t{' + C.figureCss('figure-l') + ';font-variant-numeric:tabular-nums}',
          '.now .w{font-size:13px;line-height:18px;min-width:0}',
          '.now .w span{display:block;color:' + v('ink-2') + '}',
          // THE HOURS AHEAD: as many as the card's width holds (six at a wall
          // tablet's third, twelve across an iPad's row), two hours apart where
          // the forecast reaches that far
          '.hrs{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);padding:10px 0 0;border-top:1px solid ' + v('line') + '}',
          '.hrs>div{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0}',
          '.hrs b{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}',
          '.note{margin-top:auto;font-size:13px;line-height:16px;color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '@media (max-width:' + C.BP.phone + 'px){.now{margin:10px 0}.note{margin-top:8px}}'
        ].join('');
      }
      _wx() {
        var h = this.client, c = this._config || {};
        return c.weather || (window.hkSettings && window.hkSettings.weatherId && window.hkSettings.weatherId(h.states)) ||
          Object.keys(h.states).filter(function (id) { return id.indexOf('weather.') === 0; })[0];
      }
      _ids() { return [this._wx(), hs('weather.outside', null), 'sun.sun']; }
      _render() {
        this._shell('cout');
        var h = this.client, self = this;
        if (!h) return;
        var wid = this._wx(), w = wid && h.states[wid];
        if (!w) return this._paint('<div class="ttl"><b>Outside &amp; Ahead</b></div><div class="wait">No weather</div>');
        var port = window.hkCards.subscriptions(h);      // the client's subscription port
        if (this._subWx !== wid && port) {
          this._unsub();
          this._subWx = wid;
          this._subs = ['hourly', 'daily'].map(function (t) {
            return port.subscribeMessage(function (m) { self['_' + t] = m.forecast || []; self.redraw(); },
              { type: 'weather/subscribe_forecast', forecast_type: t, entity_id: wid }).catch(function () { return null; });
          });
        }
        var now = Date.now(), out = hs('weather.outside', null), os = out && h.states[out];
        var t0 = os && num(os.state) != null ? num(os.state) : num(w.attributes.temperature);
        var day = (this._daily || [])[0], hi = day && num(day.temperature), lo = day && num(day.templow);
        var hrs = (this._hourly || []).filter(function (f) { return Date.parse(f.datetime) > now; });
        var slots = Math.max(3, Math.min(12, Math.floor(Math.max(0, this._width() - 44) / 54)));
        // two hours apart where the forecast reaches far enough, else every hour
        var step = Math.max(1, Math.min(2, Math.floor((hrs.length - 1) / Math.max(1, slots - 1)))), pick = [];
        for (var k = 0; pick.length < slots && k * step < hrs.length; k++) pick.push(hrs[k * step]);
        var HH = window.hkHeader || {}, wx = function (cond, px, night) {
          return HH.wxSvg ? HH.wxSvg(cond, px, { night: night }) : '<span style="display:inline-block;width:' + px + 'px;height:' + px + 'px"></span>';
        };
        var sun = h.states['sun.sun'], set = sun && Date.parse(sun.attributes.next_setting), rise = sun && Date.parse(sun.attributes.next_rising);
        var later = hrs[5] && num(hrs[5].temperature), h0 = new Date().getHours();
        var when = h0 >= 20 || h0 < 5 ? 'overnight' : h0 < 12 ? 'later today' : 'this evening';
        var trend = t0 == null || later == null ? '' : later <= t0 - 4 ? 'Cooling off ' + when : later >= t0 + 4 ? 'Warming up ' + when : 'Steady for the next few hours';
        var sunTxt = set && rise ? (set < rise ? 'sunset ' + hm(set) : 'sunrise ' + hm(rise)) : '';
        var unit = '°';
        var nightNow = !!(HH.isNight && HH.isNight(h.states));
        this._paint('<div class="all" data-more="' + esc(wid) + '"><div class="ttl"><b>Outside &amp; Ahead</b></div>' +
          '<div class="now">' + wx(w.state, 34, nightNow) +
          '<div class="t">' + (t0 != null ? Math.round(t0) + unit : '—') + '</div><div class="w">' + esc(WWORD[w.state] || w.state) +
          (hi != null ? '<span>High ' + Math.round(hi) + '° · Low ' + (lo != null ? Math.round(lo) + '°' : '—') + '</span>' : '') + '</div></div>' +
          '<div class="hrs">' + (pick.length ? pick.map(function (f) {
            var at = Date.parse(f.datetime), nt = f.is_daytime != null ? f.is_daytime === false : !!(HH.nightAt && HH.nightAt(h.states, f.datetime));
            return '<div><span class="mi">' + hr(at).replace(' ', '') + '</span>' + wx(f.condition === 'clear-night' && !nt ? 'sunny' : f.condition, 20, nt) +
              '<b>' + Math.round(num(f.temperature)) + '°</b></div>';
          }).join('') : '<div><span class="mi">Loading the forecast…</span></div>') + '</div>' +
          '<div class="note">' + esc([trend, sunTxt].filter(Boolean).join(' · ')) + '</div></div>');
      }
      _unsub() {
        (this._subs || []).forEach(function (p) { p.then(function (u) { if (u) u(); }); });
        this._subs = null;
        this._subWx = null;
      }
      disconnectedCallback() { super.disconnectedCallback(); this._unsub(); }
      connectedCallback() { if (super.connectedCallback) super.connectedCallback(); if (this._built) this.redraw(); }
    }

    // ===================================== LIGHTS: LIGHTING THROUGH THE DAY
    // The rooms lit longest today (a room is lit while any of its lights is),
    // as bars against the longest -- Settings' Rooms Shown, three by default.
    class HkLightsDayCard extends HeaderCard {
      static get PART_CSS() {
        return [
          '.sub{font-size:13px;color:' + v('ink-2') + ';margin-top:6px}',
          // the rows from the top, evenly apart (three fill the card, as the
          // concept's; one or two keep the same spacing rather than float)
          '.rows{flex:1;display:flex;flex-direction:column;gap:22px;padding-top:22px;min-height:0}',
          '.dr{display:grid;grid-template-columns:minmax(0,120px) minmax(0,1fr) 64px;gap:14px;align-items:center}',
          '.dr b{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.dr .tr{height:10px;background:' + v('key') + ';border-radius:' + R.capsule('10px') + ';overflow:hidden}',
          '.dr .tr i{display:block;height:100%;background:' + P.yellow + ';border-radius:' + R.capsule('10px') + '}',
          '.dr span{font-size:13px;color:' + v('ink-2') + ';text-align:right;font-variant-numeric:tabular-nums}',
          '.none{margin:auto 0;font-size:13px;color:' + v('ink-2') + '}',
          '@media (max-width:' + C.BP.phone + 'px){.dr{grid-template-columns:minmax(0,96px) minmax(0,1fr) 58px;gap:10px}.rows{gap:16px;padding-top:16px}}'
        ].join('');
      }
      _ents() {
        var out = [];
        ((this._config || {}).rooms || []).forEach(function (r) { (r.lights || []).forEach(function (id) { out.push([id, r.name]); }); });
        return out;
      }
      _render() {
        this._shell('lday');
        var h = this.client, self = this;
        if (!h) return;
        var ents = this._ents().filter(function (e) { return h.states[e[0]]; }), from = midnight(), now = Date.now();
        var head = '<div class="ttl"><b>Lighting Through the Day</b></div><div class="sub">Time with at least one light on, by room</div>';
        if (!ents.length) return this._paint(head + '<div class="none">No lights on this page</div>');
        this._load('hist', 3 * MIN, function () {
          return h.callWS({ type: 'history/history_during_period', start_time: new Date(from).toISOString(),
            end_time: new Date().toISOString(), entity_ids: ents.map(function (e) { return e[0]; }),
            minimal_response: true, no_attributes: true, significant_changes_only: false });
        });
        var Hs = this._hist;
        if (!Hs) return this._paint(head + '<div class="wait">Loading today…</div>');
        var rooms = {};
        ents.forEach(function (e) {
          var s = (Hs[e[0]] || []).map(function (x) { return [(x.lu || x.lc) * 1000, x.s]; });
          // a light on all along: the history starts with its state at midnight
          var sp = spans(s, from, now, function (p) { return p[1] === 'on'; });
          if (!sp.length) return;
          (rooms[e[1]] = rooms[e[1]] || []).push.apply(rooms[e[1]], sp);
        });
        var n = Math.max(2, Math.min(5, header('lights').rooms || 3));
        var list = Object.keys(rooms).map(function (k) { return { name: k, t: total(merge(rooms[k])) }; })
          .sort(function (a, b) { return b.t - a.t; }).slice(0, n);
        var top = list.length ? list[0].t : 1;
        this._paint(head + (list.length ? '<div class="rows">' + list.map(function (r) {
          return '<div class="dr"><b>' + esc(r.name) + '</b><div class="tr"><i style="width:' + Math.max(2, r.t / top * 100).toFixed(1) + '%"></i></div><span>' + shortDur(r.t) + '</span></div>';
        }).join('') + '</div>' : '<div class="none">No lights have been on yet today.</div>'));
      }
    }

    // ====================================== LIGHTS: LEFT ON, THEN TONIGHT
    // LEFT ON: a light on in a room whose presence sensors (occupancy,
    // presence, motion -- the area's own) have all said nobody for a while
    // (Settings' Empty For, 10 min) -- each with Turn Off. A room with no such
    // sensor is never named: there is nothing to judge it by. TONIGHT: what
    // the lighting automations do in the next 16 hours, from the server's
    // schedule (page_headers.py); a row whose conditions fail now is dimmed.
    // Neither to show: what the lights that are on are set to (Light Levels).
    var SCHED = { data: null, sub: null, cards: new Set() };
    function schedule(card, h) {
      SCHED.cards.add(card);
      var port = !SCHED.sub && h ? window.hkCards.subscriptions(h) : null;
      if (port) {
        SCHED.sub = port.subscribeMessage(function (m) {
          SCHED.data = m || {};
          SCHED.cards.forEach(function (c) { c.redraw(); });
        }, { type: 'hk_frontend/page_headers/subscribe' }).catch(function (e) {
          console.warn('[hk-headers] the schedule', e);
          SCHED.data = SCHED.data || { lights: { schedule: [] } };
          SCHED.sub = null;
        });
      }
      return SCHED.data;
    }
    // an entry's next time: a sun event from sun.sun, a time of day, or an
    // input_datetime's time -- within the next 16 hours, else null
    function nextTime(h, e, now) {
      var t = null;
      if (e.kind === 'sun') {
        var sun = h.states['sun.sun'];
        if (!sun) return null;
        var base = Date.parse(e.event === 'sunrise' ? sun.attributes.next_rising : sun.attributes.next_setting);
        if (!isFinite(base)) return null;
        t = base + (e.offset_s || 0) * 1000;
        // the offset can put today's event already past, or tomorrow's within
        if (t < now) t += DAY;
        if (t - DAY > now) t -= DAY;
      } else if (e.kind === 'time') {
        var hhmm = e.at;
        if (!hhmm && e.entity) {
          var s = h.states[e.entity], a = s && s.attributes;
          if (a && a.has_time) hhmm = (a.hour != null ? a.hour : 0) + ':' + (a.minute != null ? a.minute : 0);
        }
        var m = /^(\d+):(\d+)/.exec(hhmm || '');
        if (!m) return null;
        var d = new Date(now); d.setHours(+m[1], +m[2], 0, 0);
        t = d.getTime();
        if (t <= now) t += DAY;
      }
      return t !== null && t - now <= 16 * HOUR ? t : null;
    }
    function kelvinWord(k) {
      return k < 3000 ? 'Warm white' : k < 3600 ? 'Soft white' : k < 4600 ? 'Neutral white' : k < 5600 ? 'Cool white' : 'Daylight';
    }
    var OUTDOOR = /yard|outdoor|outside|exterior|deck|patio|porch|driveway|garden|lawn|pool|attic|garage|shed|crawl/i;
    class HkLightsTonightCard extends HeaderCard {
      static get PART_CSS() {
        return [
          '.ttl span.warn{color:' + v('warn') + '}',
          '.lo{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:12px;padding:7px 0}',
          '.lo+.lo{border-top:1px solid ' + v('line') + '}',
          '.lo b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.lo .s{display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.lo .s em{font-style:normal;color:' + v('warn') + '}',
          '.ok{display:flex;align-items:center;gap:8px;font-size:13px;color:' + v('ink-2') + ';margin:12px 0 4px}',
          '.ok hk-icon{--mdc-icon-size:15px;width:15px;height:15px;display:flex;color:' + P.green + '}',
          '.tn{margin-top:auto;border-top:1px solid ' + v('line') + ';padding:10px 0 2px}',
          '.tn .h{display:flex;justify-content:space-between;align-items:baseline;' + C.labelCss('label-small') + '}',
          '.tn .h span{text-transform:none;letter-spacing:0}',
          '.ev{display:grid;grid-template-columns:66px minmax(0,1fr);gap:10px;align-items:baseline;margin-top:7px;font-size:13px}',
          '.ev time{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}',
          '.ev span{color:' + v('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.ev i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}',
          // a condition fails now ("only when someone's home"): the row quieter
          '.ev.wait time,.ev.wait span{color:' + v('ink-3') + '}',
          '.none{font-size:13px;color:' + v('ink-3') + ';margin-top:7px}',
          // LIGHT LEVELS (the fallback)
          '.lr{display:flex;align-items:center;gap:12px;margin:16px 0 10px}',
          '.lr b{display:block;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}',
          '.lr .s{display:block;margin-top:4px}',
          '.sc{position:relative;height:6px;background:' + v('key') + ';border-radius:' + R.capsule('6px') + ';margin:0 0 6px 46px}',
          '.sc i{position:absolute;top:0;bottom:0;border-radius:' + R.capsule('6px') + ';background:' + P.yellow + '}',
          '.ll{margin-top:auto;font-size:11px;color:' + v('ink-3') + '}'
        ].join('');
      }
      _lights() {
        var out = [];
        ((this._config || {}).rooms || []).forEach(function (r) {
          (r.lights || []).forEach(function (id) { out.push({ id: id, room: r.name, icon: (r.icons || {})[id] }); });
        });
        return out;
      }
      _ids() { return this._lights().map(function (x) { return x.id; }).concat(this._occ || [], ['sun.sun']); }
      _render() {
        var self = this;
        if (!this._built) {
          this._shell('lnight');
          this._card.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('.pill[data-off]') : null;
            if (!b) return;
            e.stopPropagation();
            var id = b.getAttribute('data-off');
            self._actions().callService(id.split('.')[0], 'turn_off', { entity_id: id });
            b.textContent = '…';
          }, true);
        }
        var h = this.client;
        if (!h) return;
        var cfg = header('lights'), now = Date.now();
        var lights = this._lights().filter(function (x) { return h.states[x.id]; });
        var ids = {};
        lights.forEach(function (x) { ids[x.id] = 1; });
        // ---- left on
        var occ = {}, occIds = [];
        Object.keys(h.states).forEach(function (id) {
          if (id.indexOf('binary_sensor.') !== 0) return;
          var s = h.states[id];
          if (!/^(occupancy|presence|motion)$/.test(s.attributes.device_class || '')) return;
          var a = areaOf(h, id);
          if (!a) return;
          occIds.push(id);
          var o = occ[a] = occ[a] || { on: false, since: 0 };
          if (s.state === 'on') o.on = true;
          o.since = Math.max(o.since, Date.parse(s.last_changed));
        });
        this._occ = occIds;
        var skip = Array.isArray(cfg.exclude_areas) ? cfg.exclude_areas : ((hs('status_rows', {}) || {}).lights || {}).exclude_areas || [];
        var after = (cfg.after_min || 10) * MIN;
        var sensed = false;
        var left = cfg.left_on === false ? [] : lights.map(function (x) {
          var s = h.states[x.id], a = areaOf(h, x.id), o = a && occ[a];
          if (!o || skip.indexOf(a) >= 0 || (!Array.isArray(cfg.exclude_areas) && OUTDOOR.test(areaName(h, a) || ''))) return null;
          sensed = true;
          if (s.state !== 'on' || o.on) return null;
          var em = now - Math.max(o.since, Date.parse(s.last_changed));
          return em >= after ? { x: x, empty: em, bri: num(s.attributes.brightness) } : null;
        }).filter(Boolean).sort(function (a, b) { return b.empty - a.empty; });
        // ---- tonight
        var S = cfg.tonight === false ? null : schedule(this, h);
        var pickAuto = Array.isArray(cfg.automations) ? cfg.automations : null;
        var evs = [];
        ((S && S.lights && S.lights.schedule) || []).forEach(function (e) {
          if (pickAuto && pickAuto.indexOf(e.automation) < 0) return;
          var n = (e.entities || []).filter(function (id) { return ids[id]; }).length;
          if (!n) return;
          var t = nextTime(h, e, now);
          if (t === null) return;
          var who = e.area && !/^(home|house)$/i.test(e.area) ? e.area : /interior|inside|indoor/i.test(e.name || '') ? 'Inside' : 'House';
          evs.push({ t: t, e: e, n: n, text: who + ' lights ' + e.effect + (e.kind === 'sun' ? ' · ' + e.event : '') });
        });
        evs.sort(function (a, b) { return a.t - b.t; });
        // the same automation's same moment once (a trigger listed twice)
        evs = evs.filter(function (x, i) { return !evs.slice(0, i).some(function (y) { return y.t === x.t && y.e.automation === x.e.automation; }); });
        // ---- nothing to judge and nothing scheduled: Light Levels
        if (!sensed && !evs.length && (S || cfg.tonight === false)) return this._levels(lights);
        var shown = left.slice(0, evs.length ? 2 : 3);
        var nEv = shown.length >= 2 ? 1 : shown.length === 1 ? 2 : 3;
        var head = '<div class="ttl"><b>' + (sensed || left.length ? 'Left On' : 'Tonight') + '</b>' +
          (sensed ? '<span' + (left.length ? ' class="warn">' + left.length + (left.length === 1 ? ' light' : ' lights') + ' in empty rooms' : '>by room presence') + '</span>' :
            '<span>lighting</span>') + '</div>';
        var lo = !sensed ? '' : left.length ? shown.map(function (z) {
          var nm = nameOf(h, z.x.id);
          var icon = z.x.icon || 'hk:lightbulb';
          return '<div class="lo" data-more="' + esc(z.x.id) + '"><div class="well" style="--a:' + P.yellow + '"><hk-icon icon="' + esc(icon) + '"></hk-icon></div>' +
            '<div><b>' + esc(nm) + '</b><span class="s mi">' + esc(z.x.room || '') + ' · <em>empty ' + shortDur(z.empty) + '</em>' +
            (z.bri != null ? ' · ' + Math.round(z.bri / 2.55) + '%' : '') + '</span></div><button class="pill" data-off="' + esc(z.x.id) + '">Turn Off</button></div>';
        }).join('') : '<div class="ok"><hk-icon icon="hk:check-bold"></hk-icon>Nothing left on in an empty room</div>';
        var tn = '';
        if (cfg.tonight !== false) {
          var first = evs[0];
          var tag = sensed ? '<div class="h">Tonight<span>' : '<div class="h"><span></span><span>';
          tn = '<div class="tn"' + (sensed ? '' : ' style="border-top:0;margin-top:6px"') + '>' + tag + (first ? 'next in ' + shortDur(first.t - now) : S ? 'nothing scheduled' : '') +
            '</span></div>' +
            (evs.length ? evs.slice(0, sensed ? nEv : 4).map(function (x) {
              return '<div class="ev' + (x.e.ready === false ? ' wait' : '') + '" data-more="' + esc(x.e.automation) + '"><time>' + hm(x.t) + '</time><span><i style="background:' +
                (x.e.effect === 'on' ? P.yellow : v('mark')) + '"></i>' + esc(x.text) + (x.e.ready === false ? ' · not now' : '') + '</span></div>';
            }).join('') : '<div class="none">' + (S ? 'No lighting automations run in the next few hours.' : 'Reading the schedule…') + '</div>') + '</div>';
        }
        this._paint(head + lo + tn);
      }
      _levels(lights) {
        var h = this.client;
        var on = lights.map(function (x) { return h.states[x.id]; }).filter(function (s) { return s && s.entity_id.indexOf('light.') === 0 && s.state === 'on'; });
        var head = '<div class="ttl"><b>Light Levels</b><span>' + (on.length ? 'lights on now' : 'now') + '</span></div>';
        if (!on.length) {
          return this._paint(head + '<div class="lr"><div class="well" style="--a:' + P.yellow + '"><hk-icon icon="hk:lightbulb-outline"></hk-icon></div><div><b>All lights off</b>' +
            '<span class="s mi">Brightness and color show here when lights are on</span></div></div>');
        }
        var bri = on.map(function (s) { return num(s.attributes.brightness); }).filter(function (x) { return x != null; }).map(function (x) { return Math.round(x / 2.55); });
        var ks = on.map(function (s) {
          var k = num(s.attributes.color_temp_kelvin);
          return s.attributes.color_mode === 'color_temp' ? k : null;
        }).filter(function (x) { return x != null; });
        var colored = on.filter(function (s) { return /hs|rgb|xy/.test(s.attributes.color_mode || ''); }).length;
        var lo = bri.length ? Math.min.apply(null, bri) : null, hi = bri.length ? Math.max.apply(null, bri) : null;
        var avg = ks.length ? Math.round(ks.reduce(function (a, b) { return a + b; }, 0) / ks.length / 100) * 100 : null;
        this._paint(head +
          '<div class="lr"><div class="well" style="--a:' + P.yellow + '"><hk-icon icon="hk:white-balance-sunny"></hk-icon></div><div><b>' +
          (lo == null ? '—' : lo === hi ? lo + '%' : lo + '–' + hi + '%') + '</b><span class="s mi">Brightness · ' + bri.length + ' dimmable</span></div></div>' +
          (lo != null ? '<div class="sc"><i style="left:' + lo + '%;width:' + Math.max(2, hi - lo) + '%"></i></div>' : '') +
          '<div class="lr"><div class="well" style="--a:' + P.orange + '"><hk-icon icon="hk:lightbulb-outline"></hk-icon></div><div><b>' +
          (avg ? avg + ' K · ' + kelvinWord(avg) : colored ? colored + ' in color' : 'Not reported') + '</b><span class="s mi">Color · ' + ks.length + ' reporting' +
          (colored && avg ? ' · ' + colored + ' in color' : '') + '</span></div></div>' +
          '<div class="ll">From the lights that are on and report it.</div>');
      }
      disconnectedCallback() { super.disconnectedCallback(); SCHED.cards.delete(this); }
    }

    // ========================================= SECURITY: YOUR HOME + CARE
    // The house (the Power page's picture, or a Picture Folder of your own)
    // with a label for each way in that its art.json places (`doors`: the
    // spot on the picture, and where its label sits clear of the house) and
    // the house has: the lock and the contact read together -- or Settings'
    // pick. Beside it today's activity from the logbook, scrolling. Under it,
    // only while there is something to look after, Device Care: an entry
    // point gone quiet, or a low battery on a lock's or sensor's own device.
    // The card fills its row (the keypad's height, hk-strategy.js); on a phone,
    // where the two stack, it takes its own height.
    var ARTS = {};
    // the picture's art.json, kept in the browser between loads (hkCards.artJson)
    function artOf(base, fn) {
      if (ARTS[base] && ARTS[base].data) return fn(ARTS[base].data);
      C.artJson(base, function (j) { fn(j || {}); });
    }
    // THE WAYS IN, found by name when Settings does not say: a lock and a door
    // contact whose names say front / back / garage
    var WAYS = {
      front_door: { name: 'Front Door', re: /front/i },
      back_door: { name: 'Back Door', re: /(^|[^a-z])(back|rear|patio|deck)([^a-z]|$)/i },
      garage: { name: 'Garage', re: /garage/i }
    };
    function waysIn(h, c, pick) {
      var out = {};
      Object.keys(WAYS).forEach(function (k) {
        var W = WAYS[k], ids = Array.isArray(pick[k]) && pick[k].length ? pick[k] : null;
        if (!ids) {
          var named = function (list) { return (list || []).filter(function (id) { return h.states[id] && W.re.test(id + ' ' + nameOf(h, id)); }); };
          var lock = named(c.locks)[0];
          var door = k === 'garage' ? ((c.garage || []).filter(function (id) { return id.indexOf('cover.') === 0 && h.states[id]; })[0] || named(c.doors)[0])
                                    : named(c.doors).filter(function (id) { return !/garage/i.test(id + nameOf(h, id)) || k === 'garage'; })[0];
          if (k === 'back_door' && lock && /garage/i.test(lock)) lock = null;
          if (k === 'front_door' && lock && /garage|back/i.test(lock)) lock = null;
          ids = [lock, door].filter(Boolean);
        }
        if (ids.length) out[k] = ids.filter(function (id) { return h.states[id]; });
      });
      return out;
    }
    function wayState(h, ids) {
      var lock = ids.filter(function (id) { return id.indexOf('lock.') === 0; }).map(function (id) { return h.states[id]; })[0];
      var door = ids.filter(function (id) { return /^(binary_sensor|cover)\./.test(id); }).map(function (id) { return h.states[id]; });
      var cover = door.filter(function (s) { return s.entity_id.indexOf('cover.') === 0; })[0], contact = door.filter(function (s) { return s.entity_id.indexOf('cover.') !== 0; })[0];
      var openS = (cover && /^(open|opening|closing)$/.test(cover.state)) || (contact && contact.state === 'on');
      var unl = lock && lock.state !== 'locked';
      var main = cover || lock || contact;
      var word = openS ? 'Open' : cover ? 'Closed' : lock ? (lock.state === 'locked' ? 'Locked' : lock.state.charAt(0).toUpperCase() + lock.state.slice(1)) : contact ? 'Closed' : '—';
      var t = [lock, cover, contact].filter(Boolean).map(function (s) { return Date.parse(s.last_changed); }).sort().pop();
      return { main: main, word: word, warn: !!(openS || unl), t: t };
    }
    // GONE QUIET: Home Assistant says it is unavailable, or it has said nothing
    // since Home Assistant started (unknown) AND nothing else on its device has
    // reported in a day. A leak sensor only reports a leak changing, so after a
    // restart it is "unknown" for days while its battery, voltage and
    // temperature report every few hours -- it is working, and not named
    // (2026-10-16). Unknown with no device to judge by: not named either.
    var HEARD = 26 * HOUR;
    function siblings(h) {
      var n = Object.keys(h.entities || {}).length;
      if (siblings._n === n && siblings._h) return siblings._h;
      var out = {};
      Object.keys(h.entities || {}).forEach(function (id) {
        var e = h.entities[id];
        if (e && e.device_id) (out[e.device_id] = out[e.device_id] || []).push(id);
      });
      siblings._n = n; siblings._h = out;
      return out;
    }
    function goneQuiet(h, id, now) {
      var s = h.states[id];
      if (!s) return false;
      if (s.state === 'unavailable') return true;
      if (s.state !== 'unknown') return false;
      var e = h.entities && h.entities[id], sib = e && e.device_id ? siblings(h)[e.device_id] || [] : [];
      var others = sib.filter(function (x) { return x !== id && h.states[x]; });
      if (!others.length) return false;
      return !others.some(function (x) {
        var o = h.states[x];
        if (!o || o.state === 'unknown' || o.state === 'unavailable') return false;
        var t = Date.parse(o.last_reported || o.last_updated);
        return isFinite(t) && now - t < HEARD;
      });
    }
    // WHAT A ROW IS ABOUT, for its glyph and its words: a lock, a garage door,
    // a door, a window, a leak sensor, the alarm
    function kindOf(h, id, alarm) {
      if (id === alarm) return 'alarm';
      var d = id.split('.')[0], dc = ((h.states[id] || {}).attributes || {}).device_class;
      if (d === 'lock') return 'lock';
      if (d === 'cover' || dc === 'garage_door') return 'garage';
      if (dc === 'moisture') return 'leak';
      if (dc === 'window') return 'window';
      return 'door';
    }
    // the glyph for that kind in that state, and whether it is a warning
    function rowGlyph(kind, state) {
      var warn = /^(unlocked|jammed|open|opening|on|triggered)$/.test(state);
      var G = { lock: warn ? 'hk:lock-open-variant' : 'hk:lock', garage: warn ? 'hk:garage-open-variant' : 'hk:garage-variant',
                door: warn ? 'hk:door-open' : 'hk:door-closed', window: warn ? 'hk:window-open-variant' : 'hk:window-closed-variant',
                leak: warn ? 'hk:water-alert' : 'hk:water',
                alarm: state === 'disarmed' ? 'hk:shield-off' : state === 'triggered' ? 'hk:shield-alert' : /home|night/.test(state) ? 'hk:shield-home' : 'hk:shield-lock' };
      // THE COLOR ITS OWN TILE SHOWS in that state: a door, window or leak
      // sensor red while open or wet and a plain glyph when shut or dry (the
      // Doors & Windows and Water pages' tiles); a lock or garage door mint when
      // secure (the Locks pills), orange while it isn't; the alarm the keypad's
      // own (Disarm red, Home blue, Away green)
      var col = kind === 'alarm' ? (state === 'disarmed' || state === 'triggered' ? P.red : /home|night/.test(state) ? P.blue : P.green)
              : kind === 'door' || kind === 'window' || kind === 'leak' ? (warn ? P.red : v('ink-2'))
              : warn ? P.orange : P.mint;
      return { icon: G[kind] || 'hk:door-open', color: col };
    }
    var LOG_WORD = { locked: 'locked', unlocked: 'unlocked', jammed: 'jammed', open: 'opened', closed: 'closed', on: 'opened', off: 'closed',
                     disarmed: 'disarmed', armed_away: 'armed Away', armed_home: 'armed Home', armed_night: 'armed Night',
                     armed_vacation: 'armed Vacation', triggered: 'triggered' };
    var XP_KEY = 'hk-security-activity-expanded';

    // what the shell and the later parts use of this one
    K.artOf = artOf; K.ARTS = ARTS; K.goneQuiet = goneQuiet; K.HkClimateOutsideCard = HkClimateOutsideCard;
    K.HkClimateRuntimeCard = HkClimateRuntimeCard; K.HkLightsDayCard = HkLightsDayCard;
    K.HkLightsTonightCard = HkLightsTonightCard; K.kindOf = kindOf; K.LOG_WORD = LOG_WORD; K.nextTime = nextTime;
    K.rowGlyph = rowGlyph; K.SCHED = SCHED; K.schedule = schedule; K.WAYS = WAYS; K.waysIn = waysIn;
    K.wayState = wayState; K.XP_KEY = XP_KEY;
  };
})();
