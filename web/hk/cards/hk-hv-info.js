// @ts-check
// hk-hv-info.js -- AN APPLE HOMEVIEW'S INFORMATION PAGES (docs/phase36/PLAN.md, 2026-11-26): Weather, Calendar and Timeline, each
// drawn for the HomeView from the data the existing page reads (hk-hv.js: the kit, the frame).
//
//   hk-hv-weather-card    now (the glyph, the big temperature, the words, H / L / Feels) beside the next five hours and four
//                         readings; then Next 10 Days on one scale; then the radar (the house's own hk-radar-card, only when
//                         Settings has the radar on). An alert is the title row's line, in the warning color.
//   hk-hv-calendar-card   Today | Week. Today: the date as the hero, the day's events as tinted capsules in their calendar's
//                         color, then the next days. Week: seven day columns of chips; a tap on a day opens it as Today. A
//                         tap on an event opens the event sheet the Calendar page opens (hkCalendar.show).
//   hk-hv-timeline-card   All | Doors | People | Cameras. The house's day, newest first, under time-of-day headings; a
//                         camera's picture at the right of a row; more rows as the page scrolls (the Timeline page's own
//                         reads: hkTimeline.lib, `timeline?...`, the live feed). A tap opens the page's own sheet.
//
// WHERE THE DATA COMES FROM (nothing is read twice a way of its own):
//   weather   hkWxForecast (hk-weather.js: one shared subscription per entity and kind, let go when the page leaves),
//             hkWxReadings and hkSettings.nowRead / nowTemp (the one number on every screen), hkHeader.wxSvg (the house's
//             weather glyphs), the alerts sensor Settings -> Weather names
//   calendar  hkCalendar.load (hk-calendar.js: the shared one-minute store of GET /api/calendars/<entity>), the calendars and
//             colors All Screens -> Calendar chooses (hkSettings.calendarIds / eventColor)
//   timeline  client.callApi('GET', 'timeline?...') in pages of 50 and 'timeline/subscribe', through window.hkTimeline.lib
(function () {
  'use strict';
  if (window.hkHvInfo) return;                     // double-load guard
  window.hkHvInfo = { version: '1.0.0' };

  function whenKit(/** @type {(H: any) => void} */ fn) {
    if (window.hkHV && window.hkHV.ready) return fn(window.hkHV);
    window.addEventListener('hk-hv-ready', function () { fn(window.hkHV); }, { once: true });
    if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-hv.js');
  }

  whenKit(function (H) {
  if (window.hkHvInfo.ready) return;
  window.hkHvInfo.ready = true;
  var esc = H.esc, P = H.P, V = H.C.v;

  // ------------------------------------------------------------------ small helpers
  /** @param {any} v */
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  /** @param {any} n */
  function deg(n) { return n === null || n === undefined ? '--' : Math.round(n) + '°'; }
  // a time of day in the house's zone and clock (hkLocale), "3:15 PM"
  /** @param {any} t @param {any} [o] */
  function clockOf(t, o) {
    var L = window.hkLocale, opt = o || { hour: 'numeric', minute: '2-digit' };
    try { return L ? L.time(t, opt) : new Date(t).toLocaleTimeString([], opt); } catch (e) { return ''; }
  }
  // a date from a calendar day's own fields (a Date at local midnight): no zone shift, as the Calendar page does
  /** @param {Date} d @param {any} o */
  function dayText(d, o) {
    var L = window.hkLocale, tag = 'en-US';
    try { tag = L ? L.tag() : tag; return new Intl.DateTimeFormat(tag, o).format(d); } catch (e) { return ''; }
  }
  /** @param {Date} d */
  function d0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  /** @param {Date} d @param {number} n */
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
  /** @param {Date} a @param {Date} b */
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  /** @param {number} n */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** @param {Date} d */
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  /** @param {string} s */
  function fromYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  // a glyph's color at rest: the words' own when the screen's Icons are white (hk-hv.js whiteGlyphs); what needs you keeps its color
  /** @param {string} color @param {boolean} [needs] */
  function restColor(color, needs) { return !needs && H.whiteGlyphs && H.whiteGlyphs() ? V('ink') : color; }
  // the page's signature besides the states it read: what only the page knows (data that arrived, the hour or minute)
  /** @param {any} page @param {string} extra @param {number} per */
  function sigOf(page, extra, per) {
    var base = H.Page.prototype._sigOf.call(page);
    return (base || '') + '|' + extra + '|' + Math.floor(Date.now() / per);
  }
  // is this card on the screen now (a page built ahead sits beside the one shown)
  /** @param {any} el */
  function shown(el) {
    if (!el.isConnected) return false;
    try {
      if (document.hidden) return false;
      var r = el.getBoundingClientRect(), w = window.innerWidth || 0, h = window.innerHeight || 0;
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < w && r.top < h;
    } catch (e) { return true; }
  }

  // ================================================================== WEATHER
  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var MINUTE = 60000, HOUR = 3600000;
  // the house's weather glyph (hk-header.js's map, the same one hk-weather.js draws), `pt` points square
  /** @param {string} cond @param {number} pt @param {boolean} [night] */
  function wxg(cond, pt, night) {
    var HH = window.hkHeader;
    var svg = HH && HH.wxSvg ? HH.wxSvg(cond, P(pt), { night: !!night }) : '<span style="display:inline-block;width:' + P(pt) + ';height:' + P(pt) + '"></span>';
    return '<span class="wxg" style="width:' + P(pt) + ';height:' + P(pt) + '">' + svg + '</span>';
  }
  // the slot that has ended is not "Now" (a forecast sensor keeps what the provider last sent: hk-weather-page.js)
  /** @param {any[]} list */
  function upcomingHours(list) {
    var now = Date.now();
    return (list || []).filter(function (h) { return !(Date.parse(h.datetime) + HOUR <= now); });
  }
  /** @param {any[]} list */
  function upcomingDays(list) {
    var t0 = d0(new Date()).getTime();
    return (list || []).filter(function (d) {
      var t = Date.parse(d.datetime);
      return !isFinite(t) || d0(new Date(t)).getTime() >= t0;
    });
  }
  /** @param {number} n */
  function uvWord(n) { return n <= 2 ? 'Low' : n <= 5 ? 'Moderate' : n <= 7 ? 'High' : n <= 10 ? 'Very High' : 'Extreme'; }

  // THE WEATHER PAGE. Everything it shows it reads when it is told (rule 13): the weather entity, the sensors Settings names, the
  // sun, and the two forecasts through their shared subscriptions (a forecast arriving redraws it).
  class HvWeather extends H.Page {
    constructor() {
      super();
      this._fcN = 0;
      /** @type {any} */
      this._fc = {};
      this._radarEl = null;
      var self = this;
      this._mod = function () { self.redraw(); };
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      window.addEventListener('hk-module-ready', this._mod);
      if (!window.hkWxForecast && window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-weather.js').then(function () { self.redraw(); });
      this.redraw();                               // a forecast is watched once the page is on a screen
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      window.removeEventListener('hk-module-ready', this._mod);
      var ws = this._fc || {};
      Object.keys(ws).forEach(function (k) { if (ws[k]) ws[k].release(); });
      this._fc = {};
      this._dropRadar();
      this._hkSig = null;
    }
    _sigOf() {
      var HS = window.hkSettings, HH = window.hkHeader;
      var rad = HS && HS.radarNative ? (HS.radarNative().enabled ? 'r' : '-') : '-';
      return sigOf(this, 'fc' + this._fcN + (HH && HH.wxReady && HH.wxReady() ? 'g' : '') + rad, HOUR);
    }
    // a forecast: the sensor's, else the shared subscription (hkWxForecast), as the page's band reads it
    /** @param {string} kind @param {string|null} sensorId */
    _forecast(kind, sensorId) {
      if (sensorId) { var s = this.st(sensorId); return (s && s.attributes && s.attributes.forecast) || []; }
      var wid = this._wid, c = this.client, conn = c && c.subscriptions, F = window.hkWxForecast, key = kind + '|' + wid;
      var w = this._fc[key];
      if (w && w.conn !== conn) { w.release(); w = this._fc[key] = null; }          // a replaced socket is watched afresh
      if (!w && wid && conn && this.isConnected && F) {
        var self = this;
        w = this._fc[key] = F.watch(conn, kind, wid, function () { self._fcN++; self.redraw(); });
      } else if (w) w.ensure();
      return w ? w.data() : [];
    }
    // the alerts that have not ended, from the alerts sensor (hk-weather-status.js _first)
    /** @param {string|null} id */
    _alerts(id) {
      var s = id ? this.st(id) : null, list = (s && s.attributes && s.attributes.Alerts) || [], now = Date.now();
      return list.filter(function (/** @type {any} */ a) { var end = Date.parse((a && (a.Ends || a.Expires)) || ''); return !isFinite(end) || end > now; });
    }
    // the house's radar card, kept as this page's child and shown through a slot: a redraw of the page then never remakes it
    _ensureRadar() {
      var self = this;
      if (!this._radarEl) {
        if (!window.customElements.get('hk-radar-card')) {
          if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-weather.js');
          window.customElements.whenDefined('hk-radar-card').then(function () { self.redraw(); });
          return false;
        }
        var el = /** @type {any} */ (document.createElement('hk-radar-card'));
        el.setAttribute('slot', 'radar');
        // (nearly a screen tall: the map is the section; the owner, 2026-11-26: "the radar ... should be a lot taller". In pt of
        // the screen, written with vw: the card is slotted, outside the page's root, where --pt is not set)
        el.style.setProperty('--hk-wx-radar-h', 'calc(390 * 100vw / 544)');
        el.style.setProperty('--hk-wx-radar-h-phone', 'calc(390 * 100vw / 544)');
        el.setConfig({ type: 'custom:hk-radar-card' });
        this.appendChild(el);
        this._radarEl = el;
      }
      this._radarEl.client = this.client;
      return true;
    }
    _dropRadar() { if (this._radarEl) { this._radarEl.remove(); this._radarEl = null; } }
    draw() {
      var self = this, cfg = this._config || {}, extra = cfg.extra || {}, HS = window.hkSettings, HH = window.hkHeader || {}, L = window.hkLocale;
      var c = this.client, states = c.states, title = cfg.title || 'Weather';
      var wid = extra.weather || (HS && HS.weatherId ? HS.weatherId(states) : null);
      this._wid = wid;
      var w = wid ? this.st(wid) : null;
      if (!w) { this._dropRadar(); return H.head({ title: title }) + '<div class="pl quiet">No weather service. Choose one in ' + H.esc(H.where('Weather')) + '.</div>'; }
      /** @type {Record<string, string|null>} */
      var src = {};
      ['feels_like', 'humidity', 'wind', 'gust', 'uv', 'forecast_hourly', 'forecast_daily', 'alerts'].forEach(function (k) {
        var id = HS && HS.get ? HS.get('weather.' + k, null) : null;
        src[k] = id || null;
        if (id) self.st(id);
      });
      var sun = this.st('sun.sun');
      var a = w.attributes || {}, off = w.state === 'unavailable' || w.state === 'unknown';
      var hours = upcomingHours(this._forecast('hourly', src.forecast_hourly));
      var days = upcomingDays(this._forecast('daily', src.forecast_daily));
      var R = null;
      try { R = window.hkWxReadings && window.hkWxReadings.read ? window.hkWxReadings.read(c, { entity: wid, daily: days }) : null; } catch (e) { R = null; }
      var read = function (/** @type {string} */ k, /** @type {string} */ attr) {
        return HS && HS.nowRead ? HS.nowRead(states, k, wid) : num(a[attr]);
      };
      var temp = HS && HS.nowTemp ? HS.nowTemp(states, wid) : null;
      if (temp === null) temp = num(a.temperature);
      var feels = read('feels_like', 'apparent_temperature');
      var today = days[0] || {}, hi = num(today.temperature), lo = num(today.templow);
      if (R) { if (hi === null) hi = R.hi; if (lo === null) lo = R.lo; }
      var h0 = hours[0] || {};
      var night = HH.isNight ? HH.isNight(states) : false;

      // THE TITLE ROW: the alert in the warning color when there is one, else where the weather is for
      var alerts = this._alerts(src.alerts), sum = '';
      if (alerts.length) {
        var a0 = alerts[0], end = Date.parse(a0.Ends || a0.Expires || ''), until = '';
        if (isFinite(end)) {
          var endDay = sameDay(new Date(end), new Date()) ? '' : dayText(new Date(end), { weekday: 'short' }) + ' ';
          until = ' until ' + endDay + clockOf(end, { hour: 'numeric', minute: end % HOUR ? '2-digit' : undefined });
        }
        var sev = String(a0.Severity || '').toLowerCase();
        sum = '<button class="al" data-act="alert"><span class="' + (sev === 'extreme' || sev === 'severe' ? 'bad' : 'warn') + '">' + esc(a0.Event || a0.Headline || 'Weather Alert') + '</span>' +
          esc(until) + (alerts.length > 1 ? ' <span class="ink2">+' + (alerts.length - 1) + ' more</span>' : '') + '</button>';
      } else if (R && R.place) sum = esc(R.place);
      var out = H.head({ title: title, sum: sum });

      // THE FIRST SCREEN: now, beside the hours and the readings
      var cond = off ? 'Unavailable' : HH.conditionName ? HH.conditionName(w.state) : (R && R.says) || H.sentence(w.state);
      var hl = [];
      if (hi !== null) hl.push('H ' + deg(hi));
      if (lo !== null) hl.push('L ' + deg(lo));
      var line = hl.join('  ') + (feels !== null && !off ? (hl.length ? ' · ' : '') + 'Feels ' + deg(feels) : '');
      var tiles = this._tiles(w, a, hours, days, h0, src, sun, R, read);
      var tall = tiles.length >= 3 ? 'r3' : 'r2';
      var grid = '<div class="grid">' +
        '<button class="wxh c2 ' + tall + '" data-act="sheet" data-id="' + esc(wid) + '" aria-label="' + esc(cond + ', ' + deg(temp)) + '">' +
          wxg(w.state, 52, night) + '<div class="giant">' + (off ? '--' : deg(temp)) + '</div><div class="cond">' + esc(cond) + '</div>' +
          (line ? '<div class="sum">' + esc(line) + '</div>' : '') + '</button>';
      if (hours.length) {
        var cells = hours.slice(0, 5).map(function (/** @type {any} */ h, /** @type {number} */ i) {
          var t = i === 0 && temp !== null ? temp : num(h.temperature);
          var nt = h.is_daytime != null ? h.is_daytime === false : !!(HH.nightAt && HH.nightAt(states, h.datetime));
          var cnd = h.condition === 'clear-night' && !nt ? 'sunny' : h.condition;
          return '<div class="hr"><span' + (i ? ' class="ink2"' : '') + '>' + (i === 0 ? 'Now' : esc(clockOf(h.datetime, { hour: 'numeric' }))) + '</span>' +
            wxg(cnd, 22, nt) + '<span class="tp">' + deg(t) + '</span></div>';
        });
        grid += H.plate({ cls: 'c2 hrs', act: 'sheet', data: { id: wid }, label: 'The next hours' }, cells.join(''));
      } else {
        grid += '<div class="pl c2 quiet">The hourly forecast isn’t available.</div>';
      }
      tiles.forEach(function (/** @type {any} */ t, /** @type {number} */ i) {
        var wide = tiles.length === 3 && i === 2 || tiles.length === 1;
        grid += H.plate({ cls: 'ct' + (wide ? ' c2' : ''), act: 'sheet', data: { id: wid }, label: t.label + ', ' + t.plain },
          '<div class="top">' + H.glyph(t.icon, 15, restColor(t.color)) + '<span class="lb">' + esc(t.label) + '</span></div>' +
          '<div><div class="fig">' + t.val + '</div>' + (t.sub ? '<div class="st">' + esc(t.sub) + '</div>' : '') + '</div>');
      });
      out += grid + '</div>';

      // NEXT 10 DAYS: each day's low to high on one scale across the days
      var shownDays = days.slice(0, 10);
      if (shownDays.length) {
        var lows = shownDays.map(function (/** @type {any} */ d) { return num(d.templow); }), highs = shownDays.map(function (/** @type {any} */ d) { return num(d.temperature); });
        var all = lows.concat(highs).filter(function (x) { return x !== null; });
        var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all), span = Math.max(1, mx - mn);
        var rowsHtml = shownDays.map(function (/** @type {any} */ d, /** @type {number} */ i) {
          var dt = new Date(d.datetime), lowT = lows[i], highT = highs[i];
          var isToday = isFinite(dt.getTime()) && sameDay(dt, new Date());
          var label = isToday ? 'Today' : isFinite(dt.getTime()) ? (L ? L.date(dt, { weekday: 'short' }) : dayText(dt, { weekday: 'short' })) : '';
          var cnd = d.condition === 'clear-night' ? 'sunny' : d.condition;
          var bar = '';
          if (lowT !== null && highT !== null) {
            var l = (lowT - mn) / span, r = 1 - (highT - mn) / span, wd = Math.max(0.04, 1 - l - r);
            bar = '<i style="left:' + (l * 100).toFixed(1) + '%;width:' + (wd * 100).toFixed(1) + '%">' +
              '<b style="left:' + (-l / wd * 100).toFixed(1) + '%;width:' + (100 / wd).toFixed(1) + '%"></b></i>';
          }
          return '<div class="wday"><span class="dn">' + esc(label) + '</span>' + wxg(cnd, 24, false) + '<span class="lo">' + deg(lowT) + '</span><div class="rg">' + bar +
            '</div><span class="hi">' + deg(highT) + '</span></div>';
        }).join('');
        out += H.section(shownDays.length > 1 ? 'Next ' + shownDays.length + ' Days' : 'Today') + '<div class="pl dl">' + rowsHtml + '</div>';
      }

      // RADAR: the house's own card, when Settings has the radar on (off, there is no map to show: the section is left out)
      var radarOn = !!(HS && HS.radarNative && HS.radarNative().enabled);
      if (radarOn && this._ensureRadar()) out += H.section('Radar') + '<div class="rdr"><slot name="radar"></slot></div>';
      else if (!radarOn) this._dropRadar();
      return out;
    }
    // the readings beside the hours, in the order they matter; only what the house has, the first four
    /** @param {any} w @param {any} a @param {any[]} hours @param {any[]} days @param {any} h0 @param {any} src @param {any} sun @param {any} R @param {Function} read */
    _tiles(w, a, hours, days, h0, src, sun, R, read) {
      var HS = window.hkSettings, L = window.hkLocale, states = this.client.states, list = [];
      var spd = read('wind', 'wind_speed');
      if (spd !== null) {
        var unit = HS && HS.unit ? HS.unit(src.wind ? states[src.wind] : w, src.wind ? null : 'wind_speed_unit', L.units().speed) : L.units().speed;
        var gust = read('gust', 'wind_gust_speed');
        if (gust === null) gust = num(h0.wind_gust_speed);
        var brg = num(a.wind_bearing);
        list.push({ label: 'Wind', icon: 'mdi:weather-windy', color: V('ink'), val: Math.round(spd) + '<small>' + esc(unit) + '</small>', plain: Math.round(spd) + ' ' + unit,
                    sub: gust !== null && gust > spd + 1 ? 'Gusts ' + Math.round(gust) : brg !== null ? 'From the ' + DIRS[Math.round((brg % 360) / 45) % 8] : spd < 1 ? 'Calm' : '' });
      }
      var hum = read('humidity', 'humidity');
      if (hum !== null) {
        var dew = num(a.dew_point);
        list.push({ label: 'Humidity', icon: 'mdi:water-percent', color: H.hue('cyan'), val: Math.round(hum) + '%', plain: Math.round(hum) + '%', sub: dew !== null ? 'Dew ' + deg(dew) : '' });
      }
      var uv = read('uv', 'uv_index');
      if (uv === null) uv = num(h0.uv_index);
      if (uv !== null) {
        var n = Math.round(uv);
        list.push({ label: 'UV Index', icon: 'mdi:white-balance-sunny', color: H.hue('yellow'), val: String(n), plain: String(n), sub: uvWord(n) });
      }
      var pops = hours.slice(0, 12).filter(function (/** @type {any} */ h) { return num(h.precipitation_probability) !== null; });
      var chance = null, peak = null;
      if (pops.length) {
        peak = pops.reduce(function (/** @type {any} */ m, /** @type {any} */ h) { return num(h.precipitation_probability) > num(m.precipitation_probability) ? h : m; });
        chance = Math.round(num(peak.precipitation_probability) || 0);
      } else if (days[0] && num(days[0].precipitation_probability) !== null) chance = Math.round(num(days[0].precipitation_probability) || 0);
      if (chance !== null) {
        var around = '';
        if (chance > 0 && peak) around = peak === hours[0] ? 'Now' : 'Around ' + clockOf(peak.datetime, { hour: 'numeric' });
        list.push({ label: 'Rain', icon: 'mdi:weather-rainy', color: H.hue('cyan'), val: chance + '%', plain: chance + '%', sub: chance > 0 ? around : 'Dry ahead' });
      }
      var prs = num(a.pressure);
      if (prs !== null) {
        var pu = String(a.pressure_unit || '');
        var pv = pu === 'inHg' ? prs.toFixed(2) : String(Math.round(prs));
        list.push({ label: 'Pressure', icon: 'mdi:gauge', color: V('ink'), val: pv + '<small>' + esc(pu) + '</small>', plain: prs + ' ' + pu, sub: '' });
      }
      var sa = sun && sun.attributes, next = sa ? [['Sunrise', sa.next_rising], ['Sunset', sa.next_setting]].filter(function (x) { return isFinite(Date.parse(x[1])); })
        .sort(function (x, y) { return Date.parse(x[1]) - Date.parse(y[1]); })[0] : null;
      if (next) {
        var tt = clockOf(Date.parse(next[1]), { hour: 'numeric', minute: '2-digit' }), m = /^(.*?)\s?([AP]M)$/i.exec(tt);
        list.push({ label: next[0], icon: 'mdi:weather-sunset', color: H.hue('orange'), val: m ? esc(m[1]) + '<small>' + m[2] + '</small>' : esc(tt), plain: tt, sub: '' });
      }
      if (R && R.aqi !== null && R.aqi !== undefined) list.push({ label: 'AQI', icon: 'mdi:air-filter', color: H.hue('green'), val: String(R.aqi), plain: String(R.aqi), sub: '' });
      return list.slice(0, 4);
    }
    /** @param {string} act */
    act(act) {
      if (act !== 'alert') return false;
      var X = window.hkDetail, src = (window.hkSettings && window.hkSettings.get) ? window.hkSettings.get('weather.alerts', null) : null, list = this._alerts(src);
      if (!list.length || !X || !X.open) return true;
      var md = list.map(function (/** @type {any} */ a) {
        return ['## ' + (a.Event || 'Weather Alert'), a.Headline ? '**' + a.Headline + '**' : '', a.Severity ? 'Severity: ' + a.Severity + (a.Certainty ? ' · ' + a.Certainty : '') : '',
                a.Description ? String(a.Description) : '', a.Instruction ? '**What to do:** ' + a.Instruction : ''].filter(Boolean).join('\n\n');
      }).join('\n\n---\n\n');
      X.open(src, null, { cards: { cards: [{ type: 'markdown', content: md }] } });
      return true;
    }
    static get CSS() {
      return H.CSS + [
        '.al{font:inherit;color:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}',
        '.al:active{opacity:.7}',
        '.wxg{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0}',
        '.wxh{display:flex;flex-direction:column;align-items:flex-start;padding:' + P(4) + ' ' + P(8) + ' ' + P(10) + ';text-align:left;text-shadow:0 1px 3px rgba(0,0,0,.3);min-width:0}',
        '.wxh .giant{font-size:' + P(104) + ';letter-spacing:' + P(-5) + ';margin-top:' + P(8) + '}',
        '.wxh .cond{font-size:' + P(22) + ';font-weight:600;margin-top:' + P(6) + ';max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.wxh .sum{margin-top:' + P(4) + ';max-width:100%}',
        '.pl.hrs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));align-items:center;padding:0 ' + P(10) + '}',
        '.hr{display:flex;flex-direction:column;align-items:center;gap:' + P(6) + ';font-size:' + P(13) + ';font-weight:600}',
        '.hr .tp{font-size:' + P(16) + ';font-variant-numeric:tabular-nums}',
        '.pl.ct{display:flex;flex-direction:column;justify-content:space-between;padding:' + P(13) + ' ' + P(14) + ' ' + P(13) + ' ' + P(16) + ';text-align:left}',
        '.ct .top{display:flex;align-items:center;gap:' + P(6) + ';min-width:0}',
        '.ct .lb{font-size:' + P(13) + ';font-weight:600;color:' + V('ink-2') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ct .fig{font-size:' + P(24) + '}',
        '.pl.dl{padding:' + P(8) + ' ' + P(10) + '}',
        '.wday{display:grid;grid-template-columns:' + P(72) + ' ' + P(34) + ' ' + P(40) + ' minmax(0,1fr) ' + P(40) + ';align-items:center;column-gap:' + P(12) +
          ';height:' + P(44) + ';border-top:1px solid ' + V('line') + ';padding:0 ' + P(12) + ' 0 ' + P(10) + ';font-size:' + P(16) + '}',
        '.wday:first-child{border-top-color:transparent}',
        '.wday .dn,.wday .hi{font-weight:600}',
        '.wday .lo{text-align:right;color:' + V('ink-2') + ';font-weight:600;font-variant-numeric:tabular-nums}',
        '.wday .hi{font-variant-numeric:tabular-nums}',
        '.rg{height:' + P(5) + ';border-radius:' + P(3) + ';background:rgba(0,0,0,.2);position:relative}',
        '.rg i{position:absolute;top:0;bottom:0;border-radius:' + P(3) + ';overflow:hidden}',
        '.rg i b{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#8acbe4,#ffd75e,#ff9f0a)}',
        '.rdr{display:block}'
      ].join('');
    }
  }
  H.register('hk-hv-weather-card', HvWeather, 'HK HomeView Weather', 'The Weather page on an Apple HomeView: now, the next hours, the next ten days and the radar.');

  // ================================================================== CALENDAR
  // an event's color as r,g,b: its own, a keyword's, else its calendar's (hkSettings.eventColor, as the Calendar page picks it)
  /** @param {any} ev @param {any} client */
  function evRgb(ev, client) {
    var HS = window.hkSettings, states = (client && client.states) || {}, key = 'orange';
    try {
      if (HS && HS.eventColor) key = HS.eventColor(ev.cal, ev.title, ev.uid, states);
      else if (HS && HS.calendarColor) key = HS.calendarColor(ev.cal, states);
    } catch (e) { /* the default */ }
    var chart = (H.C.PALETTE && H.C.PALETTE.chart) || {};
    return key === 'white' ? [255, 255, 255] : chart[key] && chart[key].length === 3 ? chart[key] : [255, 159, 10];
  }
  /** @param {any} a @param {any} b */
  function byStart(a, b) {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.start - b.start) || (b.end - a.end) || (a.title < b.title ? -1 : 1);
  }
  // the events touching a day
  /** @param {any[]} evs @param {Date} d */
  function onDay(evs, d) {
    var a = d0(d), b = addDays(a, 1);
    return evs.filter(function (e) { return e.start < b && e.end > a; }).sort(byStart);
  }
  // "9 AM", "1:30 PM" short for a chip: "9a", "1:30p"
  /** @param {any} t */
  function chipTime(t) {
    return clockOf(t).replace(/:00(?=\s?[AP]M)/i, '').replace(/\s?AM$/i, 'a').replace(/\s?PM$/i, 'p');
  }
  /** @param {number} n */
  function eventsWord(n) { return n + (n === 1 ? ' event' : ' events'); }

  class HvCalendar extends H.Page {
    constructor() {
      super();
      /** @type {any[]} */
      this._evs = [];
      this._n = 0;
      this._have = '';
      this._loaded = false;
      /** @type {string[]} */
      this._failed = [];
      this._day = null;                            // a day picked from the week; null is today
      /** @type {Record<string, any>} */
      this._byKey = {};
      var self = this;
      this._onChanged = function () { self._have = ''; self.redraw(); };
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      window.addEventListener('hk-calendar-changed', this._onChanged);
      if (!window.hkCalendar && window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-calendar.js').then(function () { self.redraw(); });
      this.redraw();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      window.removeEventListener('hk-calendar-changed', this._onChanged);
      this._have = '';
      this._hkSig = null;
    }
    _sigOf() { return sigOf(this, 'ev' + this._n + (this._day ? ymd(this._day) : ''), MINUTE); }
    _wsDay() {
      var S = window.hkStats, ws = S && S.weekStart ? S.weekStart(this.client) : 0;
      return ws;
    }
    /** @param {Date} d */
    _weekStart(d) { var x = d0(d); return addDays(x, -((x.getDay() - this._wsDay() + 7) % 7)); }
    // the events this page shows: the day and the next days (Today), or the week (Week), asked for once for a few minutes
    /** @param {string[]} ids @param {Date} from @param {Date} to */
    _fetch(ids, from, to) {
      var K = window.hkCalendar, c = this.client;
      if (!K || !c) return;
      var want = ids.join(',') + '|' + (+from) + '|' + (+to) + '|' + Math.floor(Date.now() / (5 * MINUTE));
      if (want === this._have) return;
      this._have = want;
      var self = this;
      K.load(c, ids, from, to).then(function (/** @type {any} */ got) {
        if (self._have !== want) return;
        self._evs = got.evs; self._failed = got.failed || []; self._loaded = true; self._n++;
        self.redraw();
      });
    }
    draw() {
      var self = this, cfg = this._config || {}, K = window.hkCalendar, c = this.client, title = cfg.title || 'Calendar';
      var mode = this.mode() === 'week' ? 'week' : 'today';
      var seg = H.seg([{ k: 'today', t: 'Today' }, { k: 'week', t: 'Week' }], mode, 'mode');
      if (!K) return H.head({ title: title, right: seg }) + '<div class="pl quiet">Loading…</div>';
      var ids = K.ids(c);
      ids.forEach(function (/** @type {string} */ id) { self.st(id); });
      this.st('sun.sun');
      var now = new Date(), today = d0(now), day = this._day || today;
      var wk = this._weekStart(day);
      var from = mode === 'week' ? wk : day, to = addDays(from, 7);
      this._fetch(ids, from, to);
      /** @type {Record<string, any>} */
      this._byKey = {};
      if (!ids.length) {
        return H.head({ title: title, right: seg }) + '<div class="pl quiet">No calendars to show. Choose them in ' + H.esc(H.where('Calendar')) + '.</div>';
      }
      var out = mode === 'week' ? this._week(title, seg, wk, today) : this._today(title, seg, day, today, now);
      if (this._failed.length) {
        var line = K._ && K._.failedLine ? K._.failedLine(c, this._failed) : 'Some calendars couldn’t be read.';
        out += '<div class="sh"><span class="sum"><span class="warn">' + esc(line) + '</span></span></div>';
      }
      return out;
    }
    /** @param {any} ev @param {Date} day */
    _timeText(ev, day) {
      if (ev.allDay) return 'All day';
      if (ev.start < day) return 'Until ' + clockOf(ev.end);
      return clockOf(ev.start);
    }
    // the day's events as capsules: o { ev, past (an hour already over) }
    /** @param {any[]} evs @param {Date} day @param {Date} now */
    _capsules(evs, day, now) {
      var self = this, c = this.client;
      return evs.map(function (e) {
        var rgb = evRgb(e, c), st = self.st(e.cal), nm = (st && st.attributes && st.attributes.friendly_name) || '';
        self._byKey[e.key] = e;
        return '<button class="ev' + (!e.allDay && e.end <= now ? ' past' : '') + '" style="--c:' + rgb.join(',') + '" data-act="event" data-k="' + esc(e.key) + '">' +
          '<i class="evbar"></i><span class="tm">' + esc(self._timeText(e, day)) + '</span><span class="nm">' + esc(e.title) + '</span>' +
          (nm ? '<span class="where">' + esc(nm) + '</span>' : '') + '</button>';
      }).join('');
    }
    /** @param {string} title @param {string} seg @param {Date} day @param {Date} today @param {Date} now */
    _today(title, seg, day, today, now) {
      var self = this, isToday = sameDay(day, today), evs = onDay(this._evs, day);
      var word = isToday ? 'today' : dayText(day, { weekday: 'short' });
      var sum = !this._loaded ? '' : evs.length ? '<b>' + eventsWord(evs.length) + '</b> ' + esc(word) : (isToday ? 'Nothing today' : 'Nothing on ' + esc(word));
      var out = H.head({ title: title, sum: sum, right: seg });
      // THE DATE, the hero: the weekday in red, the day, the month; the sun's next two times at the right (today)
      var sunSt = this.st('sun.sun'), sa = sunSt && sunSt.attributes, sunHtml = '';
      if (isToday && sa) {
        var two = [['Sunrise', sa.next_rising], ['Sunset', sa.next_setting]].filter(function (x) { return isFinite(Date.parse(x[1])); })
          .sort(function (x, y) { return Date.parse(x[1]) - Date.parse(y[1]); });
        sunHtml = two.length ? '<div class="dsun">' + two.map(function (x) { return '<div class="st">' + x[0] + ' ' + esc(clockOf(Date.parse(x[1]))) + '</div>'; }).join('') + '</div>' : '';
      }
      out += '<div class="dhero"><div class="giant dnum">' + day.getDate() + '</div><div class="dcol"><div class="lbl">' + esc(dayText(day, { weekday: 'long' })) + '</div>' +
        '<div class="mon">' + esc(dayText(day, { month: 'long' })) + '</div></div>' + sunHtml + '</div>';
      if (!this._loaded) return out + '<div class="pl quiet">Loading…</div>';
      out += evs.length ? '<div class="pl agenda">' + this._capsules(evs, day, now) + '</div>' : '<div class="pl quiet">Nothing scheduled.</div>';
      // THE NEXT DAYS, about a week: Tomorrow always, the days after it when they have something
      for (var i = 1; i < 7; i++) {
        var d = addDays(day, i), list = onDay(self._evs, d);
        if (!list.length && i > 1) continue;
        var label = sameDay(d, addDays(today, 1)) ? 'Tomorrow' : dayText(d, { weekday: 'long' });
        var more = sameDay(d, addDays(today, 1)) ? dayText(d, { weekday: 'long', month: 'short', day: 'numeric' }) : dayText(d, { month: 'short', day: 'numeric' });
        out += H.section(label, esc(more));
        out += list.length ? '<div class="pl agenda">' + this._capsules(list, d, now) + '</div>' : '<div class="pl quiet">Nothing scheduled.</div>';
      }
      return out;
    }
    /** @param {string} title @param {string} seg @param {Date} wk @param {Date} today */
    _week(title, seg, wk, today) {
      var self = this, c = this.client, now = new Date(), all = 0, cols = '';
      for (var i = 0; i < 7; i++) {
        var d = addDays(wk, i), list = onDay(this._evs, d), isToday = sameDay(d, today);
        all += list.filter(function (e) { return sameDay(e.start, d) || d0(e.start) < d; }).length;
        cols += '<div class="wcol' + (isToday ? ' today' : '') + '" role="button" tabindex="0" data-act="day" data-d="' + ymd(d) + '" aria-label="' +
          esc(dayText(d, { weekday: 'long', month: 'long', day: 'numeric' }) + (list.length ? ', ' + eventsWord(list.length) : '')) + '">' +
          '<div class="dh"><div class="d">' + esc(dayText(d, { weekday: 'short' })) + '</div><div class="n">' + d.getDate() + '</div></div>' +
          list.map(function (e) {
            self._byKey[e.key] = e;
            return '<div class="chip" role="button" tabindex="0" style="--c:' + evRgb(e, c).join(',') + '" data-act="event" data-k="' + esc(e.key) + '"><div class="t1">' + esc(e.title) + '</div>' +
              '<span>' + esc(e.allDay ? 'All day' : chipTime(e.start)) + '</span></div>';
          }).join('') + '</div>';
      }
      var last = addDays(wk, 6), same = wk.getMonth() === last.getMonth();
      var range = dayText(wk, { month: 'short', day: 'numeric' }) + ' – ' + (same ? last.getDate() : dayText(last, { month: 'short', day: 'numeric' }));
      var sum = this._loaded ? '<b>' + eventsWord(this._evs.filter(function (e) { return e.start < addDays(wk, 7) && e.end > wk; }).length) + '</b> · ' + esc(range) : esc(range);
      void now; void all;
      return H.head({ title: title, sum: sum, right: seg }) + '<div class="pl wkp"><div class="wk">' + cols + '</div></div>';
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      var K = window.hkCalendar;
      if (act === 'event') {
        var ev = this._byKey[el.getAttribute('data-k')];
        if (ev && K && K.show) K.show(this.client, ev);
        return true;
      }
      if (act === 'day') {
        var d = fromYmd(el.getAttribute('data-d'));
        if (d) { this._day = sameDay(d, new Date()) ? null : d; this._have = ''; this.mode('today'); }
        return true;
      }
      if (act === 'mode' && el.getAttribute('data-k') === 'today' && this._day) {
        this._day = null; this._have = '';
        this.mode('today');
        return true;
      }
      return false;
    }
    static get CSS() {
      return H.CSS + [
        '.dhero{display:flex;align-items:center;gap:' + P(16) + ';height:' + P(96) + ';margin:0 ' + P(8) + ' ' + P(12) + ';text-shadow:0 1px 3px rgba(0,0,0,.3)}',
        '.dnum{font-size:' + P(92) + ';letter-spacing:' + P(-4) + ';flex:none}',
        '.dcol{display:flex;flex-direction:column;gap:' + P(2) + ';min-width:0}',
        '.dcol .lbl{color:#ff6961}',
        '.dcol .mon{font-size:' + P(22) + ';font-weight:700;letter-spacing:' + P(-0.35) + '}',
        '.dsun{margin-left:auto;text-align:right;flex:none}',
        '.dsun .st{font-size:' + P(15) + '}',
        '.pl.agenda{padding:' + P(12) + ' ' + P(12) + ' ' + P(4) + '}',
        '.ev{display:flex;align-items:center;gap:' + P(12) + ';width:100%;height:' + P(58) + ';padding:0 ' + P(14) + ';border-radius:' + P(16) + ';margin-bottom:' + P(8) +
          ';text-align:left;background:rgba(var(--c),.3)}',
        '.ev .evbar{width:' + P(4) + ';height:' + P(34) + ';border-radius:' + P(2) + ';flex:none;background:rgb(var(--c))}',
        '.ev .tm{width:' + P(74) + ';flex:none;white-space:nowrap;font-size:' + P(14) + ';font-weight:600;font-variant-numeric:tabular-nums;color:' + V('ink-2') + '}',
        '.ev .nm{flex:1;min-width:0;font-size:' + P(15) + ';font-weight:600}',
        '.ev .where{font-size:' + P(13) + ';font-weight:500;color:' + V('ink-2') + ';max-width:36%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ev.past{opacity:.6}',
        '.pl.wkp{min-height:' + P(336) + ';padding:' + P(8) + '}',
        '.wk{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:' + P(6) + ';min-height:' + P(320) + '}',
        '.wcol{display:flex;flex-direction:column;gap:' + P(5) + ';border-radius:' + P(16) + ';padding:' + P(8) + ' ' + P(3) + ';min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent}',
        '.wcol .dh{text-align:center;margin-bottom:' + P(4) + '}',
        '.wcol .d{font-size:' + P(13) + ';font-weight:600;letter-spacing:' + P(0.4) + ';text-transform:uppercase;color:' + V('ink-2') + '}',
        '.wcol .n{font-size:' + P(22) + ';font-weight:600;font-variant-numeric:tabular-nums;line-height:' + P(26) + '}',
        '.wcol.today{background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.28)}',
        '.wcol.today .n{color:#000;background:#fff;border-radius:' + P(13) + ';width:' + P(30) + ';margin:0 auto;text-shadow:none}',
        '.chip{border-radius:' + P(9) + ';padding:' + P(5) + ' ' + P(5) + ';font-size:' + P(13) + ';font-weight:600;line-height:' + P(16) +
          ';overflow:hidden;background:rgba(var(--c),.3);cursor:pointer}',
        // (two lines, broken between syllables where a word is longer than its day: seven days across leave a chip ~60 pt)
        '.chip .t1{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;-webkit-hyphens:auto;hyphens:auto;overflow-wrap:anywhere}',
        '.chip span{display:block;font-weight:500;color:' + V('ink-2') + ';white-space:nowrap}'
      ].join('');
    }
  }
  H.register('hk-hv-calendar-card', HvCalendar, 'HK HomeView Calendar', 'The Calendar page on an Apple HomeView: today’s date and events, the next days, the week.');

  // ================================================================== TIMELINE
  var FILTERS = [
    { k: 'all', t: 'All', groups: /** @type {string[]} */ ([]), need: /** @type {string[]} */ ([]) },
    { k: 'doors', t: 'Doors', groups: ['doors', 'locks', 'garage'], need: ['door', 'window', 'lock', 'garage'] },
    { k: 'people', t: 'People', groups: ['people'], need: ['arrival'] },
    { k: 'cameras', t: 'Cameras', groups: ['cameras', 'doorbell'], need: ['detection', 'motion', 'doorbell'] }
  ];
  var PAGE_SIZE = 50, KEEP = 600, FRESH_MS = 60000;
  function TL() { return (window.hkTimeline && window.hkTimeline.lib) || null; }
  function ctxNow() {
    var L = window.hkLocale;
    try { return { tag: L ? L.tag() : 'en-US', zone: L ? L.zone() : undefined, hour12: L ? L.hour12() : undefined }; } catch (e) { return { tag: 'en-US' }; }
  }

  class HvTimeline extends H.Page {
    constructor() {
      super();
      /** @type {any[]} */
      this._events = [];
      this._next = null;
      this._state = 'loading';                     // loading | ready | error
      this._err = null;
      this._more = false;
      this._moreErr = false;
      this._meta = { limited: false, families: /** @type {string[]|null} */ (null) };
      /** @type {any[]} */
      this._pending = [];
      this._seq = 0;
      this._ver = 0;
      this._started = false;
      this._loadedAt = 0;
      this._hv.mode = 'all';
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      if (!window.hkTimeline && window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-timeline.js').then(function () { self._maybeStart(); self.redraw(); });
      if (this._started) {
        if (Date.now() - this._loadedAt > FRESH_MS) this._reload(true);
        this._subscribe();
      } else this._maybeStart();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      this._unsubscribe();
      if (this._io) { this._io.disconnect(); this._io = null; }
      this._hkSig = null;
    }
    _receiveClient() { super._receiveClient(); this._maybeStart(); }
    _sigOf() { return sigOf(this, 'tl' + this._ver + this._state + (this._more ? 'm' : ''), MINUTE); }
    _filter() { return FILTERS.filter(function (f) { return f.k === this._hv.mode; }, this)[0] || FILTERS[0]; }
    _query() {
      var T = TL(), f = this._filter();
      return T.queryPath(Object.assign(T.emptyFilters(), { groups: f.groups.slice() }), { limit: PAGE_SIZE });
    }
    // a page built ahead is not a page shown: nothing is read until it is on the screen
    _maybeStart() {
      if (this._started || !this.client || !this._config || !TL()) return;
      if (shown(this)) {
        this._started = true;
        if (this._seen) { this._seen.disconnect(); this._seen = null; }
        this._reload(false); this._subscribe();
        return;
      }
      if (!this._seen && typeof IntersectionObserver === 'function') {
        var self = this;
        this._seen = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) self._maybeStart(); });
        this._seen.observe(/** @type {Element} */ (/** @type {unknown} */ (this)));
      }
    }
    // ------------------------------------------------------------ data
    /** @param {string} path */
    _read(path) {
      var c = this.client;
      if (!c || typeof c.callApi !== 'function') return Promise.reject(Object.assign(new Error('no client'), { code: 'unavailable' }));
      try { return Promise.resolve(c.callApi('GET', path)); } catch (e) { return Promise.reject(e); }
    }
    /** @param {boolean} quiet */
    _reload(quiet) {
      var T = TL(), seq = ++this._seq, self = this;
      if (!T) return;
      this._pending = [];
      if (!quiet) { this._state = 'loading'; this._err = null; this._ver++; this.redraw(); }
      this._read(this._query()).then(function (/** @type {any} */ res) {
        if (seq !== self._seq) return;
        self._take(res || {});
        self._events = ((res && res.events) || []).slice().sort(T.byTime);
        self._next = res && res.next_before ? res.next_before : null;
        self._state = 'ready'; self._err = null; self._loadedAt = Date.now(); self._ver++;
        self.redraw();
      }, function (/** @type {any} */ err) {
        if (seq !== self._seq) return;
        if (quiet && self._state === 'ready') return;                      // keep what is shown; the next try will do
        self._state = 'error'; self._err = err; self._ver++;
        self.redraw();
      });
    }
    /** @param {any} res */
    _take(res) { this._meta = { limited: !!res.limited, families: Array.isArray(res.families) ? res.families : this._meta.families }; }
    _loadMore() {
      var T = TL();
      if (!T || this._more || !this._next || this._state !== 'ready') return;
      var seq = this._seq, self = this, f = this._filter();
      this._more = true; this._ver++; this.redraw();
      this._read(T.queryPath(Object.assign(T.emptyFilters(), { groups: f.groups.slice() }), { before: this._next, limit: PAGE_SIZE })).then(function (/** @type {any} */ res) {
        if (seq !== self._seq) return;
        self._more = false; self._moreErr = false;
        self._events = T.mergeEvents(self._events, (res && res.events) || []);
        if (self._events.length > KEEP) self._events = self._events.slice(0, KEEP);
        self._next = res && res.next_before ? res.next_before : null;
        self._ver++; self.redraw();
      }, function () {
        if (seq !== self._seq) return;
        self._more = false; self._moreErr = true; self._ver++;
        self.redraw();
      });
    }
    // ------------------------------------------------------------ the live feed
    _subscribe() {
      var T = TL();
      this._unsubscribe();
      var c = this.client, conn = c && c.subscriptions, self = this, token = this._subToken = (this._subToken || 0) + 1;
      if (!T || !conn || typeof conn.subscribeMessage !== 'function') return;
      this._readyOnce = false;
      var f = this._filter();
      try {
        Promise.resolve(conn.subscribeMessage(function (/** @type {any} */ ev) { if (token === self._subToken) self._live(ev); },
          T.subscribeMessage(Object.assign(T.emptyFilters(), { groups: f.groups.slice() }))))
          .then(function (/** @type {any} */ u) { if (token !== self._subToken) { try { u(); } catch (e) { /* gone */ } return; } self._unsub = u; }, function () { /* no live feed here */ });
      } catch (e) { /* the same */ }
    }
    _unsubscribe() {
      this._subToken = (this._subToken || 0) + 1;
      var u = this._unsub;
      this._unsub = null;
      if (typeof u === 'function') { try { var r = u(); if (r && r.catch) r.catch(function () { /* gone */ }); } catch (e) { /* gone */ } }
    }
    /** @param {any} ev */
    _live(ev) {
      var T = TL();
      if (!ev || !T) return;
      if (ev.ready) {                              // a socket that came back: what happened meanwhile is read again
        if (this._readyOnce && this._state === 'ready') this._reload(true);
        this._readyOnce = true;
        return;
      }
      if (!Array.isArray(ev.events) || this._state !== 'ready') return;
      var f = Object.assign(T.emptyFilters(), { groups: this._filter().groups.slice() });
      var known = /** @type {Record<string, boolean>} */ ({}), fresh = /** @type {any[]} */ ([]), again = /** @type {any[]} */ ([]);
      this._events.forEach(function (/** @type {any} */ e) { known[e.id] = true; });
      ev.events.forEach(function (/** @type {any} */ e) {
        if (!e || e.id === undefined) return;
        if (known[e.id]) again.push(e);                                    // a later end, count or picture
        else if (T.matches(e, f)) fresh.push(e);
      });
      if (again.length) this._events = T.mergeEvents(this._events, again);
      this._pending = this._pending.concat(fresh);
      this._takePending();
      this._ver++;
      this.redraw();
    }
    // new rows go in at once at the top of the page; scrolled down, they wait (the list would jump under the finger)
    _takePending() {
      var T = TL(), s = document.scrollingElement;
      if (!T || !this._pending.length || (s && s.scrollTop > 140)) return;
      this._events = T.mergeEvents(this._events, this._pending);
      this._pending = [];
    }
    // more rows as the foot comes into view
    _arm() {
      var foot = this._root.querySelector('.more');
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (!foot || typeof IntersectionObserver === 'undefined') return;
      var self = this;
      this._io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; }) && !self._moreErr) self._loadMore(); }, { rootMargin: '600px 0px' });
      this._io.observe(foot);
    }
    _render() { super._render(); this._arm(); }
    // a filter: what is shown is read again for it
    /** @param {any} m */
    mode(m) {
      if (m === undefined || m === this._hv.mode || !TL()) return super.mode(m);
      this._hv.mode = m;
      this._events = []; this._next = null; this._pending = []; this._more = false; this._moreErr = false;
      this._reload(false);
      this._subscribe();
      return m;
    }
    // ------------------------------------------------------------ the page
    draw() {
      var T = TL(), cfg = this._config || {}, title = cfg.title || 'Timeline';
      if (!T) return H.head({ title: title }) + '<div class="pl quiet">Loading…</div>';
      this._takePending();
      var self = this, ctx = ctxNow(), now = Date.now(), vis = null;
      if (this._meta.families) vis = T.visibleGroups(this._meta.families, this._meta.limited).map(function (/** @type {any} */ g) { return g.id; });
      var filters = FILTERS.filter(function (f) {
        if (!f.groups.length || !vis) return true;
        return f.groups.some(function (g) { return vis.indexOf(g) >= 0; });
      });
      var seg = H.seg(filters.map(function (f) { return { k: f.k, t: f.t }; }), this._hv.mode, 'mode');
      var todayKey = T.dayKey(now, ctx), nToday = this._events.filter(function (/** @type {any} */ e) { return T.dayKey(e.at * 1000, ctx) === todayKey; }).length;
      var partial = this._next && this._events.length && T.dayKey(this._events[this._events.length - 1].at * 1000, ctx) === todayKey;
      var sum = this._state !== 'ready' ? '' : nToday ? '<b>' + nToday + (partial ? '+' : '') + '</b> today' : 'Quiet today';
      var out = H.head({ title: title, sum: sum, right: seg });
      if (this._state === 'loading') return out + '<div class="pl quiet">Loading…</div>';
      if (this._state === 'error') {
        var e = T.errorText(this._err);
        return out + '<div class="pl quiet" role="alert">' + esc(e.text) + (e.retry ? '<div style="margin-top:' + P(12) + '">' + H.cap({ t: 'Try Again', act: 'retry' }) + '</div>' : '') + '</div>';
      }
      if (!this._events.length) {
        return out + '<div class="pl quiet">' + (this._hv.mode === 'all' ? 'Nothing yet. The timeline starts recording today.' : 'Nothing here yet.') + '</div>';
      }
      // UNDER TIME-OF-DAY HEADINGS: this evening, this afternoon, this morning, then each day before
      /** @type {Array<{key: string, label: string, rows: any[]}>} */
      var groups = [];
      this._events.slice().sort(T.byTime).forEach(function (/** @type {any} */ ev) {
        var ms = ev.at * 1000, dk = T.dayKey(ms, ctx), key, label;
        if (dk === todayKey) {
          var h = T.parts(ms, ctx).h;
          label = h >= 17 ? 'This Evening' : h >= 12 ? 'This Afternoon' : h >= 5 ? 'This Morning' : 'Overnight';
          key = dk + label;
        } else { key = dk; label = T.dayLabel(ms, now, ctx); }
        var g = groups[groups.length - 1];
        if (!g || g.key !== key) { g = { key: key, label: label, rows: [] }; groups.push(g); }
        g.rows.push(ev);
      });
      groups.forEach(function (g) {
        out += H.section(g.label) + '<div class="pl tlp">' + g.rows.map(function (/** @type {any} */ ev) { return self._row(ev, ctx, now); }).join('') + '</div>';
      });
      if (this._more) out += '<div class="quiet">Loading…</div>';
      else if (this._next) out += '<div class="more">' + H.cap({ t: this._moreErr ? 'Try Again' : 'Show More', act: 'more' }) + '</div>';
      else out += '<div class="quiet">That’s all there is.</div>';
      return out;
    }
    // a row: when, a bare glyph in its kind's color, what happened and where, the picture at the right
    /** @param {any} ev @param {any} ctx @param {number} now */
    _row(ev, ctx, now) {
      var T = TL(), look = T.lookOf(ev), ms = ev.at * 1000, warn = ev.level === 'warning';
      var col = warn && look.color === 'gray' ? 'orange' : look.color, age = Math.floor((now - ms) / MINUTE);
      var when = age < 60 && age >= 0 ? (age < 1 ? 'Now' : age + ' min') : T.timeText(ms, ctx);
      var detail = [ev.area_name, T.countLine(ev, ctx), T.whoLine(ev.who)].filter(Boolean);
      if (ev.late) detail.push('While ' + ((window.hkShell && window.hkShell.productName && window.hkShell.productName()) || 'the server') + ' was off');
      var pics = ev.pics || [];
      return '<button class="tr" data-act="open" data-id="' + esc(ev.id) + '"><span class="when">' + esc(when) + '</span>' +
        H.glyph(look.icon, 24, col === 'gray' ? V('ink-2') : restColor(H.hue(col), warn || col === 'orange' || col === 'red')) +
        '<span class="what"><span class="nm">' + esc(ev.title) + '</span>' + (detail.length ? '<span class="st">' + esc(detail.join(' · ')) + '</span>' : '') + '</span>' +
        (pics.length ? '<span class="snap"><img src="' + esc(pics[0].url) + '" alt="" loading="lazy" decoding="async" draggable="false"></span>' : '') + '</button>';
    }
    /** @param {string} act @param {any} el */
    act(act, el) {
      if (act === 'open') {
        var id = el.getAttribute('data-id'), ev = this._events.filter(function (/** @type {any} */ e) { return String(e.id) === String(id); })[0];
        if (ev && window.hkTimeline && window.hkTimeline.openSheet) window.hkTimeline.openSheet(ev, this.client);
        return true;
      }
      if (act === 'more') { this._moreErr = false; this._loadMore(); return true; }
      if (act === 'retry') { this._reload(false); return true; }
      return false;
    }
    static get CSS() {
      return H.CSS + [
        '.hd + .sh{margin-top:' + P(4) + '}',
        '.pl.tlp{padding:' + P(6) + ' ' + P(12) + ' ' + P(6) + ' ' + P(8) + '}',
        '.tr{display:flex;align-items:center;gap:' + P(12) + ';width:100%;min-height:' + P(56) + ';padding:' + P(6) + ' 0 ' + P(6) + ' ' + P(4) +
          ';border-top:1px solid ' + V('line') + ';text-align:left}',
        '.tr:first-child{border-top-color:transparent}',
        '.tr .when{width:' + P(76) + ';flex:none;text-align:right;white-space:nowrap;font-size:' + P(14) + ';font-weight:600;color:' + V('ink-2') + ';font-variant-numeric:tabular-nums}',
        '.tr>.g{width:' + P(30) + '}',
        '.tr .what{flex:1;min-width:0;display:flex;flex-direction:column}',
        '.tr .snap{width:' + P(76) + ';height:' + P(44) + ';border-radius:' + P(10) + ';overflow:hidden;flex:none;background:rgba(255,255,255,.1)}',
        '.tr .snap img{display:block;width:100%;height:100%;object-fit:cover}',
        '.more{display:flex;justify-content:center;margin-top:' + P(18) + '}'
      ].join('');
    }
  }
  H.register('hk-hv-timeline-card', HvTimeline, 'HK HomeView Timeline', 'The Timeline page on an Apple HomeView: the house’s day, newest first, under time-of-day headings.');

  Object.assign(window.hkHvInfo, { Weather: HvWeather, Calendar: HvCalendar, Timeline: HvTimeline });
  });
})();
