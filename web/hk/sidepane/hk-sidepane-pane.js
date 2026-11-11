// hk-sidepane-pane.js - the pane: its sections, drawing and the element.
//
// PART OF THE SIDE PANE (hk-sidepane.js). Not a card and not run on its own: it registers one
// function, which hk-sidepane.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSidePaneParts = window.hkSidePaneParts || {})['hk-sidepane-pane'] = function (K) {
    var ago = K.ago, ALARM = K.ALARM, alarmOf = K.alarmOf, allDay = K.allDay, ART = K.ART, ART_MAX = K.ART_MAX,
        ART_MEAN = K.ART_MEAN, attr = K.attr, BAND_H = K.BAND_H, C = K.C, CAL = K.CAL, calComing = K.calComing,
        calLoad = K.calLoad, clientNow = K.clientNow, condName = K.condName, css = K.css, cssReady = K.cssReady,
        dateLong = K.dateLong, dateShort = K.dateShort, deg = K.deg, domainIds = K.domainIds, DRAWN_W = K.DRAWN_W,
        energyToday = K.energyToday, esc = K.esc, evStart = K.evStart, FACE_COLORS = K.FACE_COLORS, fit = K.fit,
        hm = K.hm, houseNow = K.houseNow, HS = K.HS, icon = K.icon, inkGlyph = K.inkGlyph, KINDS = K.KINDS,
        kinds = K.kinds, L = K.L, LOST = K.LOST, musicOf = K.musicOf, musicPanel = K.musicPanel, nameOf = K.nameOf,
        notesOf = K.notesOf, nowTemp = K.nowTemp, num = K.num, openOf = K.openOf, paneOf = K.paneOf, pic = K.pic,
        setting = K.setting, shieldOf = K.shieldOf, states = K.states, statusOf = K.statusOf, timersOf = K.timersOf,
        TODO = K.TODO, todoAdd = K.todoAdd, todoCheck = K.todoCheck, todoOf = K.todoOf, WX_LAST = K.WX_LAST,
        wxGlyph = K.wxGlyph, wxIcon = K.wxIcon;

    // A SECTION'S HEADING (2026-10-30): the small uppercase title -- text alone
    // since 2026-10-31 (the owner: "remove the glyph/icon... rather it just be
    // text"), as the pane's Section Headings say (the screen's Side Pane `headings`, on
    // by default) -- never over the Clock or the Weather, which say what they
    // are, nor on a Pages-screen widget. A to-do list keeps its own name either
    // way (which list is content). HEAD_ON is the drawing pane's, set as it draws.
    var HEAD_ON = true;
    function head(k) {
      if (!HEAD_ON || k === 'clock' || k === 'weather') return '';
      return '<div class="h2"><span>' + esc(KINDS[k][0]) + '</span></div>';
    }
    function tiny(k, txt, val) {
      return '<div class="sec cmp" data-k="' + k + '" data-size="tiny"><div class="r2">' + icon(KINDS[k][1]) +
        '<span class="tx">' + txt + '</span>' + (val ? '<span class="v2">' + val + '</span>' : '') + '</div></div>';
    }
    function box(k, size, inner, cls) {
      return '<div class="sec' + (cls ? ' ' + cls : '') + '" data-k="' + k + '" data-size="' + size + '">' + inner + '</div>';
    }
    // A LIST THAT GIVES WAY (2026-10-30, the owner: the calendar, the to-do list
    // and the like "should contract vertically when there isn't enough room"):
    // its rows in a .lst, the section a .shrink -- shorter where the pane is
    // short, the rows scrolling inside it, down to its heading and one row
    // (_floors); only past that does a size step down (fit)
    function lst(inner) { return '<div class="lst">' + inner + '</div>'; }
    // (r[4]: the entity a tap on the row opens, its own sheet)
    function rows(list) {
      return list.map(function (r) {
        return '<div class="r2' + (r[3] ? ' ' + r[3] : '') + '"' + (r[4] ? ' data-ent="' + esc(r[4]) + '"' : '') + '>' + (r[2] ? icon(r[2]) : '') + '<span class="tx">' + esc(r[0]) +
          '</span><span class="v2">' + esc(r[1]) + '</span></div>';
      }).join('');
    }
    function none(k, size, text) { return size === 'tiny' ? tiny(k, esc(text), '') : box(k, size, head(k) + '<div class="sub2">' + esc(text) + '</div>'); }

    // OUR OWN ANALOG FACE, numbered (the Clock at Full)
    function faceSvg(now) {
      var h = now.h % 12, m = now.m, s = '';
      for (var i = 1; i <= 12; i++) {
        var a = i * Math.PI / 6;
        s += '<text x="' + (78 * Math.sin(a)).toFixed(1) + '" y="' + (-78 * Math.cos(a) + 8).toFixed(1) + '">' + i + '</text>';
      }
      var ha = (h + m / 60) * 30, ma = m * 6;
      return '<svg class="face" viewBox="-100 -100 200 200" aria-hidden="true"><circle r="98" class="dial"/>' +
        '<g class="nums">' + s + '</g>' +
        '<line y2="-46" class="hh" transform="rotate(' + ha + ')"/><line y2="-70" class="mh" transform="rotate(' + ma + ')"/>' +
        '<circle r="4" class="pin"/></svg>';
    }

    // THE CLOCK SECTION'S LOOK (hk_core PANE_CHOICES; the "Side Pane clock styles" board, item 43): Face (Digital,
    // Stacked -- StandBy's hours over minutes -- or Analog, the Analog Numbers face small with the time and date
    // beside it), Alignment, Size (`scale`), Weight, AM/PM, Flashing Colon, Date, Second Line. What a section
    // leaves out is today's clock.
    var CLOCK_DEFAULTS = { face: 'digital', align: 'left', scale: 'medium', weight: 'semibold', date: 'full', line: 'auto', beside: 'none', below: 'auto' };
    function clockLook(sec) {
      var o = {};
      Object.keys(CLOCK_DEFAULTS).forEach(function (k) { o[k] = sec && sec[k] ? sec[k] : CLOCK_DEFAULTS[k]; });
      o.ampm = !(sec && sec.ampm === false);
      o.colon = !!(sec && sec.colon === true);
      return o;
    }
    // the classes a choice adds to the section (its type's size and weight, its alignment): none for today's
    function clockClasses(o) {
      var cls = '';
      if (o.align !== 'left') cls += ' cka-' + o.align;
      if (o.scale !== 'medium') cls += ' cks-' + o.scale;
      if (o.weight !== 'semibold') cls += ' ckw-' + o.weight;
      return cls;
    }
    // The colon flashes only where motion is allowed: not under Reduce Motion (the device's), Animations Off, or Flat
    // (hkSettings.skyLook().animations says all three)
    function motionOk() {
      try { var S = HS(); return !(S && S.skyLook && S.skyLook().animations === false); } catch (e) { return true; }
    }
    // the time: AM/PM only when the clock is a 12-hour one and the section shows it; the colon its own span when it flashes
    function timeHtml(now, o, flash) {
      var p = now.time.split(':');
      return '<span class="tm">' + esc(p[0]) + (flash ? '<span class="ckc">:</span>' : ':') + esc(p[1]) + (now.ampm && o.ampm ? '<small>' + now.ampm + '</small>' : '') + '</span>';
    }
    // STACKED: the hours over the minutes (StandBy's); no colon to flash and no AM/PM beside them
    function stackHtml(now) {
      var p = now.time.split(':');
      return '<span class="tm"><span>' + esc(p[0]) + '</span><span>' + esc(p[1]) + '</span></span>';
    }
    // the weather line: "64° Partly Cloudy" (the weather section's own reading); nothing while it has none
    function clockWeather(c) {
      var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && (states(c)[id] || WX_LAST[id]);
      return st ? esc(deg(nowTemp(c, st)) + ' ' + condName(st.state)) : '';
    }
    // THE WEATHER BESIDE THE TIME (2026-10-31, the owner: "like we do for the left side bar menu"): the condition's glyph
    // and the temperature at the right of the time, the condition and today's high under them, as the menu's header
    // draws them (hk-menu.js); nothing until the weather is here
    // ...IN THE LOOK CHOSEN (2026-11-01, the owner: "give the user the choice"): `weather` Large, two thirds of the time
    // in its weight; `quiet` half the time, regular, the glyph in the date's gray; `chip` a small pill level with the
    // time; `date` on the date's line at the date's size, the time's row its own. Left puts it at the right, Right
    // mirrors it, Center stacks it under the time.
    function besideWeather(c, ctx, look) {
      var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && (states(c)[id] || WX_LAST[id]);
      if (!st) return '';
      var daily = ctx && ctx.forecast ? ctx.forecast(id, 'daily') : [], d0 = daily[0] || {};
      var cond = condName(st.state), hi = d0.temperature != null ? 'H:' + deg(d0.temperature) : '', t = esc(deg(nowTemp(c, st)));
      var hl = hi ? '<span class="hl"> \u00b7 ' + esc(hi) + '</span>' : '';
      if (look === 'date') return { look: look, wt: '', sky: '<div class="sub2 ckxs dl2">' + inkGlyph(st.state, 18) + '<b>' + t + '</b><span class="cn"> ' + esc(cond) + '</span>' + hl + '</div>' };
      if (look === 'chip') return { look: look, wt: '<div class="ckx chip"><span class="pill">' + inkGlyph(st.state, 20) + '<b>' + t + '</b></span></div>',
                                    sky: '<div class="sub2 ckxs">' + esc(cond) + hl + '</div>' };
      // (two parts, each in its own place in the clock's grid: the temperature beside the time, the sky beside the date)
      return { look: look, wt: '<div class="ckx' + (look === 'quiet' ? ' q' : '') + '">' + inkGlyph(st.state, 34) + '<b>' + t + '</b></div>',
               sky: '<div class="sub2 ckxs">' + esc(cond) + hl + '</div>' };
    }

    // UNDER THE TIME (2026-10-31, the owner: at More the sunset "just kind of blends in ... something that spans the whole
    // way"): a strip the clock's width under the time and date, of the clock's own choosing -- the next hours, the
    // sun's day, the moon, or the conditions (wind, humidity, UV, sunset). '' when what it needs isn't here.
    var SYNODIC = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
    function moonAge(t) { var a = ((t - NEW_MOON) / 86400000) % SYNODIC; return a < 0 ? a + SYNODIC : a; }
    // its name: New, First Quarter, Full and Last Quarter only within a day of them (eight equal bins called 67 %
    // "Last Quarter"), the crescents and gibbous between
    function moonName(age) {
      var f = age / SYNODIC, near = 1 / SYNODIC;
      if (f < near || f > 1 - near) return 'New Moon';
      if (Math.abs(f - 0.25) < near) return 'First Quarter';
      if (Math.abs(f - 0.5) < near) return 'Full Moon';
      if (Math.abs(f - 0.75) < near) return 'Last Quarter';
      return (f < 0.5 ? 'Waxing ' : 'Waning ') + (f < 0.25 || f > 0.75 ? 'Crescent' : 'Gibbous');
    }
    // the moon drawn as it is tonight: its dark disc, the lit part bounded by the limb and the terminator (an ellipse)
    function moonSvg(age, px) {
      var r = 20, cx = 22, cy = 22, f = age / SYNODIC, k = Math.cos(2 * Math.PI * f), rx = Math.abs(k) * r, wax = f < 0.5;
      var lit = 'M' + cx + ' ' + (cy - r) + ' A' + r + ' ' + r + ' 0 0 ' + (wax ? 1 : 0) + ' ' + cx + ' ' + (cy + r) +
                ' A' + rx.toFixed(2) + ' ' + r + ' 0 0 ' + ((k > 0) === wax ? 0 : 1) + ' ' + cx + ' ' + (cy - r) + 'Z';
      return '<svg class="moon" viewBox="0 0 44 44" width="' + px + '" height="' + px + '" aria-hidden="true">' +
        '<circle cx="22" cy="22" r="20" fill="rgba(255,255,255,.14)"/><path d="' + lit + '" fill="#f2f0e6"/></svg>';
    }
    function underTime(kind, c, ctx) {
      var st = states(c), sun = st['sun.sun'], now = Date.now();
      var wid = setting('weather.entity', null) || domainIds(c, 'weather')[0], w = wid && (st[wid] || WX_LAST[wid]);
      if (kind === 'hours') {
        var hourly = w && ctx && ctx.forecast ? ctx.forecast(wid, 'hourly') : [];
        if (!hourly.length) return '';
        return '<div class="ckb hrs">' + hourly.slice(0, 5).map(function (h, i) {
          // (Now is the temperature now, as beside the time: nowTemp; the later hours the forecast's)
          return '<div>' + esc(i ? hm(new Date(h.datetime)).replace(':00', '') : 'Now') + wxGlyph(h.condition, 18) + '<b>' + esc(deg(i ? h.temperature : nowTemp(c, w))) + '</b></div>';
        }).join('') + '</div>';
      }
      if (kind === 'sun') {
        var rise = Date.parse(attr(sun, 'next_rising')), set = Date.parse(attr(sun, 'next_setting'));
        if (!isFinite(rise) || !isFinite(set)) return '';
        // the day it is in: by day the sunrise was today (the next one is tomorrow's); by night, the day to come
        var day = set < rise;
        if (day) rise -= 86400000;
        var p = day ? Math.max(0, Math.min(1, (now - rise) / (set - rise))) : 0, pt = function (t) { return [10 + t * 280, 52 - 42 * Math.sin(Math.PI * t)]; };
        var path = function (a, b) { var o = []; for (var i = 0; i <= 40; i++) { var q = pt(a + (b - a) * i / 40); o.push(q[0].toFixed(1) + ',' + q[1].toFixed(1)); } return o.join(' '); };
        var at = pt(p), len = Math.round((set - rise) / 60000);
        return '<div class="ckb cksun"><svg viewBox="0 0 300 60" aria-hidden="true">' +
          '<defs><linearGradient id="ckSunG" x1="0" x2="1"><stop offset="0" stop-color="#ff9f0a"/><stop offset="1" stop-color="#ffd60a"/></linearGradient></defs>' +
          '<line x1="0" y1="52" x2="300" y2="52" stroke="rgba(255,255,255,.22)" stroke-width="1"/>' +
          '<polyline points="' + path(0, 1) + '" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>' +
          (day && p > 0 ? '<polyline points="' + path(0, p) + '" fill="none" stroke="url(#ckSunG)" stroke-width="3" stroke-linecap="round"/>' : '') +
          (day ? '<circle cx="' + at[0].toFixed(1) + '" cy="' + at[1].toFixed(1) + '" r="9" fill="rgba(255,214,10,.25)"/><circle cx="' + at[0].toFixed(1) + '" cy="' + at[1].toFixed(1) +
            '" r="5.5" fill="#ffd60a"/>' : '') +
          '</svg><div class="sub2 cksl"><span>' + icon('mdi:weather-sunset-up') + esc(hm(new Date(rise))) + '</span><span class="ckdl">' +
          esc(Math.floor(len / 60) + 'h ' + (len % 60) + 'm of daylight') + '</span><span>' + icon('mdi:weather-sunset') + esc(hm(new Date(set))) + '</span></div></div>';
      }
      if (kind === 'moon') {
        var age = moonAge(now), f = age / SYNODIC, lit = Math.round((1 - Math.cos(2 * Math.PI * f)) / 2 * 100);
        var name = moonName(age), toFull = (SYNODIC / 2 - age + SYNODIC) % SYNODIC, toNew = SYNODIC - age;
        var next = toFull < toNew ? ['Full', toFull] : ['New', toNew], dn = Math.round(next[1]);
        var when = dn <= 0 ? 'tonight' : dn === 1 ? 'tomorrow' : 'in ' + dn + ' days';
        return '<div class="ckb ckmoon">' + moonSvg(age, 44) + '<div><b>' + esc(name) + '</b><div class="sub2">' + esc(lit + '% lit · ' + next[0] + ' Moon ' + when) + '</div></div></div>';
      }
      if (kind === 'conditions') {
        var a = (w && w.attributes) || {}, cols = [];
        var setT = Date.parse(attr(sun, 'next_setting')), riseT = Date.parse(attr(sun, 'next_rising'));
        if (isFinite(setT) && isFinite(riseT)) cols.push(setT < riseT ? ['mdi:weather-sunset', hm(new Date(setT)), 'Sunset'] : ['mdi:weather-sunset-up', hm(new Date(riseT)), 'Sunrise']);
        // (wind, humidity and UV from Settings -> Weather's sensors when it names them, as the Weather page: hkSettings.nowRead)
        var HS = window.hkSettings, rd = function (k, at) { return HS && HS.nowRead ? HS.nowRead(st, k, wid) : num(a[at]); };
        var windId = setting('weather.wind', null), windU = windId && st[windId] && num(st[windId].state) !== null
          ? attr(st[windId], 'unit_of_measurement') : a.wind_speed_unit, wind = rd('wind', 'wind_speed'), hum = rd('humidity', 'humidity');
        if (wind != null) cols.push(['mdi:weather-windy', Math.round(wind) + (windU ? ' ' + windU : ''), 'Wind']);
        if (hum != null) cols.push(['mdi:water-percent', Math.round(hum) + '%', 'Humidity']);
        var uv = rd('uv', 'uv_index');
        if (uv != null) cols.push(['mdi:white-balance-sunny', String(Math.round(uv)), 'UV']);
        if (!cols.length) return '';
        return '<div class="ckb ckrd" style="--n:' + cols.length + '">' + cols.map(function (x) {
          return '<div>' + icon(x[0]) + '<b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></div>'; }).join('') + '</div>';
      }
      return '';
    }

    // EACH SECTION AT EACH SIZE: (size, sec, c, ctx) -> HTML. ctx.slot(key,
    // make) leaves a place for an element kept between draws (the music pane,
    // a doorbell's live camera); ctx.redraw() draws the pane again.
    var SEC = {
      clock: function (s, sec, c, ctx) {
        // THE CLOCK'S LOOK (2026-10-31, the owner's item 43): every choice's first value is today's clock, so a
        // section that sets none draws exactly what it did (the classes and the spans below are added only for
        // a choice made)
        var o = clockLook(sec), now = houseNow(c), d = now.day, flash = o.colon && motionOk();
        var t = timeHtml(now, o, flash);
        var cls = clockClasses(o);
        var dateText = o.date === 'off' ? '' : esc(o.date === 'short' ? dateShort(d) : dateLong(d));
        if (s === 'tiny') return tiny('clock', t, o.date === 'off' ? '' : esc(dateShort(d)));
        // THE SECOND LINE: Sunset or Weather, under the date (Automatic is today's: the sunset beside the date at
        // More; None is no second line at all)
        var set = attr(states(c)['sun.sun'], 'next_setting'), sunText = set ? 'Sunset ' + esc(hm(new Date(set))) : '';
        // (the weather beside the time: at Less and More, a digital or stacked face -- and then not its second line too)
        var wxBy = o.beside !== 'none' && (s === 'less' || s === 'more') && o.face !== 'analog' ? besideWeather(c, ctx, o.beside) : '';
        var extra = o.line === 'sunset' ? sunText : o.line === 'weather' && !wxBy ? clockWeather(c) : '';
        var second = extra ? '<div class="sub2 ck2">' + extra + '</div>' : '';
        if (s === 'full') {
          var big = o.face === 'stacked' ? '<div class="big2 ck stk">' + stackHtml(now) + '</div>' : faceSvg(now);
          return box('clock', s, '<div class="facebox">' + big + '</div>' + (dateText ? '<div class="sub2 ctr">' + dateText + '</div>' : '') + second, 'grow' + cls);
        }
        // LINED UP (2026-10-31, the owner: "the time's left edge with the
        // date's, AM on the baseline, date left / sunset right"): the digits
        // pulled back by their own side bearing, AM on their baseline, and
        // under them the date at the left and the sunset at the right
        // (UNDER THE TIME, at More: a strip of its own in the sunset's place -- underTime)
        var under = s === 'more' && o.below !== 'auto' && o.face !== 'analog' ? underTime(o.below, c, ctx) : '';
        var sun = o.line === 'auto' && s === 'more' && set && !under ? '<span class="sun">' + sunText + '</span>' : '';
        var dl = dateText ? '<span class="dl">' + dateText + '</span>' : '';
        var line = (dl || sun ? '<div class="sub2 ckd">' + dl + (sun && o.date === 'full' ? '<span class="ds">' + esc(dateShort(d)) + '</span>' : '') + sun + '</div>' : '') + second;
        if (o.face === 'analog') {
          // THE ANALOG NUMBERS FACE, small, with the time and the date beside it
          return box('clock', s, '<div class="ckan">' + faceSvg(now) + '<div class="ckt"><b>' + t + '</b>' + (dateText ? '<span class="sub2">' + dateText + '</span>' : '') +
            '</div></div>' + second, cls.trim());
        }
        var main = o.face === 'stacked' ? '<div class="big2 ck stk' + (s === 'less' ? ' less' : '') + '">' + stackHtml(now) + '</div>'
                                        : '<div class="big2 ck' + (s === 'less' ? ' less' : '') + '">' + t + '</div>';
        if (wxBy) {
          // (the date's line without the second line, which runs the whole width under both)
          var dateLine = dl || sun ? '<div class="sub2 ckd">' + dl + (sun && o.date === 'full' ? '<span class="ds">' + esc(dateShort(d)) + '</span>' : '') + sun + '</div>' : '<div class="ckd"></div>';
          return box('clock', s, '<div class="ckrow ckw-' + wxBy.look + '">' + main + wxBy.wt + dateLine + wxBy.sky + second + under + '</div>', (cls + ' ckby').trim());
        }
        return box('clock', s, main + line + under, cls.trim());
      },
      weather: function (s, sec, c, ctx) {
        var id = setting('weather.entity', null) || domainIds(c, 'weather')[0], st = id && states(c)[id];
        // (its state not here yet -- loading, a reconnect, a narrowed page asking
        // for it: the last one seen, never "No weather" while it comes)
        if (st) WX_LAST[id] = st; else if (id && WX_LAST[id]) st = WX_LAST[id];
        if (!st) return none('weather', s, id ? 'Getting the weather…' : 'No weather');
        var cond = condName(st.state);
        var daily = ctx.forecast(id, 'daily'), hourly = s === 'more' || s === 'full' ? ctx.forecast(id, 'hourly') : [];
        var d0 = daily[0] || {}, hl = d0.temperature != null ? 'H:' + deg(d0.temperature) + ' L:' + deg(d0.templow) : '';
        var now = deg(nowTemp(c, st));
        if (s === 'tiny') return tiny('weather', esc(now + ' ' + cond), esc(hl));
        var top = '<div class="wnow">' + wxGlyph(st.state, 44) + '<b>' + esc(now) + '</b><div class="sub2">' + esc(cond) + (hl ? '<br>' + esc(hl) : '') + '</div></div>';
        var hrs = hourly.slice(0, 5).map(function (h, i) {
          // (Now is the temperature now, as beside the time: nowTemp; the later hours the forecast's)
          return '<div>' + esc(i ? hm(new Date(h.datetime)).replace(':00', '') : 'Now') + wxGlyph(h.condition, 18) + '<b>' + esc(deg(i ? h.temperature : nowTemp(c, st))) + '</b></div>';
        }).join('');
        var days = s === 'full' ? rows(daily.slice(1, 4).map(function (x) {
          return [L() ? L().date(new Date(x.datetime), { weekday: 'long' }) : '', deg(x.temperature) + ' / ' + deg(x.templow), 'mdi:weather-' + wxIcon(x.condition)];
        })) : '';
        return box('weather', s, head('weather') + top + (s === 'less' || !hrs ? '' : '<div class="hrs">' + hrs + '</div>') + days);
      },
      calendar: function (s, sec, c, ctx) {
        ctx.calendar(sec.days || (s === 'full' ? 7 : s === 'more' ? 3 : 2));
        if (!CAL.evs) return none('calendar', s, window.hkCalendar && !window.hkCalendar.ids(c).length ? 'No calendars' : 'Reading the calendars\u2026');
        var evs = calComing();
        if (!evs.length) return none('calendar', s, 'Nothing coming up');
        var when = function (e) {
          var a = evStart(e), today = new Date(); today.setHours(0, 0, 0, 0);
          var dayN = Math.floor((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - today) / 86400000);
          var day = dayN <= 0 ? '' : dayN === 1 ? 'Tomorrow ' : (L() ? L().date(a, { weekday: 'short' }) : '') + ' ';
          return allDay(e) ? (day || 'All day').trim() : day + hm(a);
        };
        if (s === 'tiny') return tiny('calendar', esc(evs[0].title || 'Event'), esc(when(evs[0])));
        // LESS: the next two. MORE and FULL: every event in its Days (3 and 7
        // unless it says), scrolling inside the section where they don't all
        // fit -- the pane itself never scrolls (2026-10-30). A tap on one opens
        // its sheet (data-ev).
        var days = sec.days || (s === 'full' ? 7 : s === 'more' ? 3 : 2), end = new Date(); end.setHours(0, 0, 0, 0);
        end = end.getTime() + days * 86400000;
        var mine = s === 'less' ? evs.slice(0, 2) : evs.filter(function (e) { return evStart(e).getTime() < end; });
        if (!mine.length) mine = evs.slice(0, 1);
        CAL.shown = mine;
        // UNDER THEIR DAY (2026-10-31, the owner: "the date or day of the week before the events as a header, instead of
        // ... a second line"): Today, Tomorrow, then the weekday, once each; under each event only its time, or All day
        var dayOf = function (e) {
          var a = evStart(e), today = new Date(); today.setHours(0, 0, 0, 0);
          var n = Math.floor((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - today) / 86400000);
          if (n <= 0) return 'Today';
          if (n === 1) return 'Tomorrow';
          if (n < 7) { try { return L().date(a, { weekday: 'long' }); } catch (x) { /* below */ } }
          return dateShort(a);
        };
        var last = null;
        return box('calendar', s, head('calendar') + '<div class="evs' + (s === 'less' ? '' : ' scroll') + ' lst">' + mine.map(function (e, i) {
          var d = dayOf(e), hd = d !== last ? '<div class="evd">' + esc(d) + '</div>' : '';
          last = d;
          return hd + '<div class="ev" data-ev="' + i + '"><span class="cb" style="background:' + esc(ctx.evColor(e)) + '"></span><span class="et"><b>' +
            esc(e.title || 'Event') + '</b><i>' + esc(allDay(e) ? 'All day' : hm(evStart(e))) + '</i></span></div>';
        }).join('') + '</div>', 'shrink');
      },
      now_playing: function (s, sec, c, ctx) {
        var m = musicOf(c);
        if (!m) return none('now_playing', s, 'Not Playing');
        var pp = '<button type="button" class="pp" data-act="pp" aria-label="' + (m.playing ? 'Pause' : 'Play') + '">' +
                 icon(m.playing ? 'mdi:pause' : 'mdi:play') + '</button>';
        if (s === 'tiny') return tiny('now_playing', esc(m.title || 'Playing'), pp);
        // LESS AND MORE, A MINI PLAYER (2026-10-31, the owner's pick of three):
        // the cover and the song on their own line; under it one row --
        // Speakers, back, play / pause (white, the largest), next, Browse -- the
        // screensaver's two at its ends, opening its panel over the pane
        // (musicPanel); then the volume, its speakers either side, a quiet 6 px
        // track in a 44 px place for a finger ("make sure the thin line for
        // volume is ok for a finger to use"). MORE is the same player a size up
        // ("one family"): a bigger cover and the song's progress over the row,
        // drawn by the compositor to the song's end (no redraw a second). FULL
        // stays the screensaver's own pane, below.
        // THE CONTROLS STRIP (2026-11-09, the owner: "more space in general above and below the play button"; hk-np-strip.js):
        // the progress, the keys and the volume are the one strip every player draws with -- its own progress line (the
        // compositor's, to the song's end) and its own slider in the strip's slots, the strip's keys
        if (s === 'less' || s === 'more') {
          var prog = s === 'more' ? '<div class="npp" role="progressbar" aria-label="Song" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(m.at * 100) +
            '"><i style="transform:scaleX(' + m.at.toFixed(4) + ')' +
            (m.playing && m.left > 0 ? ';animation:npp ' + Math.round(m.left) + 's linear forwards' : '') + '"></i></div>' : '';
          var vol = m.vol === null ? '' : '<input type="range" min="0" max="100" step="1" data-act="vol" aria-label="Volume" value="' +
              Math.round(m.vol * 100) + '" style="--f:' + Math.round(m.vol * 100) + '%">';
          return box('now_playing', s, (s === 'more' ? head('now_playing') : '') + '<div class="r2 np' + (s === 'more' ? ' np2' : '') + '">' +
            (m.pic ? pic(m.pic, { cls: 'art', ph: 'note' }) : '<span class="art">' + icon('mdi:music') + '</span>') +
            // (THE SPEAKER LINE over the song, its first room -- the owner's mockup 12h, 2026-11-09: a tap the Speakers
            // key's, which it replaced; Browse and Up Next at the keys' ends)
            '<span class="tx">' + window.hkNpStrip.lineHtml({ tag: 'button' }).replace('<b></b>', '<b>' + esc((m.rooms || [])[0] || '') + '</b>') +
            '<b>' + esc(m.title) + '</b><i>' + esc(m.artist) + '</i></span></div>' +
            window.hkNpStrip.html({ tag: 'button', playing: m.playing, prog: prog ? 'slot' : null, progHtml: prog, vol: vol ? 'slot' : null, volHtml: vol }));
        }
        // FULL: the screensaver's music pane itself (hk-music-pane-card,
        // hk-saver.js): the art, the song, its buttons and volume, Up Next and
        // the Speakers / Browse panel -- the one view the dashboard shares --
        // taking the room left
        return '<div class="sec mp' + (s === 'full' ? ' grow' : ' compact') + '" data-k="now_playing" data-size="' + s + '">' + head('now_playing') +
          ctx.slot('np', 'hk-music-pane-card', function (el) {
          if (el.active) el.active(true);
        }) + '</div>';
      },
      security: function (s, sec, c) {
        var al = alarmOf(c), a = al && al.st ? al.st.state : null;
        var locks = kinds('locks'), un = locks.filter(function (id) { return (states(c)[id] || {}).state === 'unlocked'; });
        var wins = kinds('windows'), open = openOf(c, wins), doors = openOf(c, kinds('doors'));
        var lockLine = !locks.length ? '' : un.length ? un.length + ' unlocked' : 'All locked';
        var state = a ? ALARM[a] || a : locks.length ? (un.length ? 'Unlocked' : 'Locked') : 'No alarm';
        if (s === 'tiny') return tiny('security', esc(state), esc(lockLine));
        var top = '<div class="r2 big">' + icon(shieldOf(a), ' class="shield"') + '<span class="tx">' + esc(state) + '</span></div>';
        // ONLY WHAT IS OPEN (the owner, 2026-10-31: "if all windows, doors, and locks are closed and locked, I don't
        // really need to know that... I just need to know when something opens"): All Locked the all-clear, then
        // the windows and doors open, if any -- never "all windows closed"
        var n = function (k, one, many) { return k + ' ' + (k === 1 ? one : many) + ' open'; };
        if (s === 'less') {
          var gist = [lockLine, open.length ? n(open.length, 'window', 'windows') : '', doors.length ? n(doors.length, 'door', 'doors') : '']
            .filter(Boolean).join(' · ');
          // ONE LINE (2026-10-31, the owner: two lines "doesn't look great"): the state, and what is open at its right
          return box('security', s, head('security') + '<div class="r2 big">' + icon(shieldOf(a), ' class="shield"') + '<span class="tx">' + esc(state) + '</span>' +
            (gist ? '<span class="v2 sub2">' + esc(gist) + '</span>' : '') + '</div>');
        }
        var list = locks.slice(0, s === 'full' ? 8 : 4).map(function (id) { var x = states(c)[id] || {};
          return [nameOf(x, id), x.state === 'unlocked' ? 'Unlocked' : x.state === 'locked' ? 'Locked' : String(x.state || ''), x.state === 'unlocked' ? 'mdi:lock-open-variant' : 'mdi:lock',
          x.state === 'unlocked' ? 'warn' : '', id]; });
        // (More: the windows only when one is open; Full, the whole picture, says so either way)
        if (wins.length && (open.length || s === 'full')) list.push(['Windows', open.length ? open.length + ' open' : 'All closed', open.length ? 'mdi:window-open-variant' :
          'mdi:window-closed-variant', open.length ? 'warn' : '']);
        if (s === 'full') {
          kinds('garage').slice(0, 2).forEach(function (id) { var x = states(c)[id] || {}; list.push([nameOf(x, id), x.state === 'open' || x.state === 'on' ? 'Open' : 'Closed', 'mdi:garage', '', id]);
            });
          if (al && al.st) {
            var who = attr(al.st, 'changed_by'), at = al.st.last_changed ? hm(new Date(al.st.last_changed)) : '';
            list.push([ALARM[a] ? ALARM[a].split(' · ')[0] : 'Changed', [at, who].filter(Boolean).join(', '), 'mdi:history']);
          }
        }
        return box('security', s, head('security') + top + rows(list));
      },
      camera: function (s, sec, c, ctx) {
        var id = sec.entity || (setting('cameras.order', []) || [])[0] || domainIds(c, 'camera')[0], st = id && states(c)[id];
        if (!st) return none('camera', s, 'No camera');
        var age = st.last_updated ? ago(Date.parse(st.last_updated)) + ' ago' : '';
        if (s === 'tiny') return tiny('camera', esc(nameOf(st, id)), esc(age));
        // THE STILL, WHEN IT HAS LOADED (2026-10-31, the owner: "never the ?"): the camera's glyph on the dark plate
        // always, and the picture over it only once one has come (ctx.still: the last good address, else ''; _cams
        // fetches and refreshes it in place). THE NAME (the owner's item 33 for the blocks, 42 here): Hide unless
        // the section's Name says Show, or Automatic, which shows it on a short still only, as the blocks' cells do
        var url = ctx.still(id);
        return '<div class="sec cam2 ' + s + '" data-k="camera" data-size="' + s + '" data-cam="' + esc(id) + '" data-name="' + (sec.name || 'hide') + '">' +
          '<span class="cg" aria-hidden="true">' + icon(KINDS.camera[1]) + '</span>' +
          (url ? '<img alt="" src="' + esc(url) + '">' : '') + '<span class="cn">' + esc(nameOf(st, id)) + '</span></div>';
      },
      timers: function (s, sec, c) {
        var t = timersOf(c);
        var keys = '<div class="keys">' + [1, 5, 10, 30].map(function (n) {
          return '<button type="button" data-act="timer" data-min="' + n + '">' + n + ' min</button>';
        }).join('') + '</div>';
        // (none running: More and Full offer the quick ones, so a tap starts one)
        if (!t.length) return s === 'more' || s === 'full' ? box('timers', s, head('timers') + '<div class="sub2">No timers running</div>' + keys) : none('timers', s, 'No timers running');
        var left = function (r) {
          var ms = r.finishes_at ? Date.parse(r.finishes_at) - Date.now() : 0;
          if (!r.finishes_at && r.remaining) return String(r.remaining).replace(/^0:/, '');
          var x = Math.max(0, Math.round(ms / 1000)), h = Math.floor(x / 3600), m = Math.floor(x / 60) % 60, sx = x % 60;
          return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sx < 10 ? '0' : '') + sx;
        };
        if (s === 'tiny') return tiny('timers', esc(t[0].name || 'Timer'), '<span class="cd">' + esc(left(t[0])) + '</span>');
        // EACH TIMER (2026-10-31, the owner: "the ring is the pause (its centre
        // shows pause/play), a big red stop key", as the Timers block has them):
        // its ring of time left -- a tap pauses or resumes it -- its time and
        // its name, and the red Stop. The time is an <hk-countdown> (hk-timers.js),
        // which ticks on its own and hands the ring the fraction left
        // (--hk-left, on the row): the pane draws again only as its data changes.
        var T = window.hkTimers, all = states(c);
        return box('timers', s, head('timers') + lst(t.slice(0, s === 'full' ? 4 : 3).map(function (r) {
          var id = r.entity_id, x = id && all[id], a = (x && x.attributes) || {}, nm = esc(r.name || 'Timer');
          var paused = x ? x.state === 'paused' : !r.finishes_at;
          var total = num(r.duration_s || r.total) || (T && T.secs ? T.secs(a.duration) : 0) || 0;
          var rest = paused ? (T && T.secs ? T.secs(a.remaining || r.remaining) : 0) : Math.max(0, Math.round((Date.parse(r.finishes_at) - Date.now()) / 1000));
          var clock = paused ? 'hold="' + rest + '"' : 'deadline="' + Date.parse(r.finishes_at) + '"';
          var frac = total ? Math.max(0, Math.min(1, rest / total)) : 1;
          return '<div class="tmr" style="--hk-left:' + frac.toFixed(2) + '">' +
            (id ? '<button type="button" class="tpr" data-act="tp" data-timer="' + esc(id) + '" data-paused="' + (paused ? 1 : 0) + '" aria-label="' + (paused ? 'Resume ' : 'Pause ') + nm + '">' +
              '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"></circle><circle class="l" cx="50" cy="50" r="45" pathLength="100"></circle></svg>' +
              icon(paused ? 'mdi:play' : 'mdi:pause') + '</button>' : '') +
            '<hk-countdown ' + clock + ' total="' + total + '">' + esc(left(paused ? { remaining: a.remaining || r.remaining } : r)) + '</hk-countdown>' +
            '<span class="tn">' + nm + '</span>' +
            (id ? '<button type="button" class="tst" data-act="tx" data-timer="' + esc(id) + '" aria-label="Stop ' + nm + '">' + icon('mdi:stop') + '</button>' : '') + '</div>';
        }).join('')) + (s === 'full' ? keys : ''), 'shrink');
      },
      energy: function (s, sec, c) {
        var pid = setting('features.power', null), p = pid && states(c)[pid];
        var watts = function (st) { var n = num(st && st.state), u = attr(st, 'unit_of_measurement'); if (n == null) return null; return u === 'kW' ? n * 1000 : n; };
        var kw = function (w) { return w == null ? '–' : (Math.abs(w) >= 1000 ? (w / 1000).toFixed(1) + ' kW' : Math.round(w) + ' W'); };
        var use = watts(p), solarId = Object.keys(states(c)).filter(function (k) { return /^sensor\..*solar.*power/.test(k); })[0];
        var bat = Object.keys(states(c)).filter(function (k) { return /^sensor\..*(house|home|powerwall).*battery/.test(k) && attr(states(c)[k], 'device_class') === 'battery'; })[0];
        if (use == null && !solarId) return none('energy', s, 'No power reading');
        var sol = solarId ? kw(watts(states(c)[solarId])) : '';
        if (s === 'tiny') return tiny('energy', 'Using ' + esc(kw(use)), sol ? 'Solar ' + esc(sol) : '');
        var stats = '<div class="stats"><div><b>' + esc(kw(use)) + '</b>Using</div>' + (sol ? '<div><b>' + esc(sol) + '</b>Solar</div>' : '') +
          (bat ? '<div><b>' + esc(Math.round(num(states(c)[bat].state) || 0) + ' %') + '</b>Battery</div>' : '') + '</div>';
        var today = s === 'less' ? '' : energyToday(c);
        // LESS: what the house uses; MORE: with the panels and the battery, and
        // today's; FULL: the same, then each as a row with its sheet
        if (s === 'less') stats = '<div class="stats"><div><b>' + esc(kw(use)) + '</b>Using</div></div>';
        var more = s !== 'full' ? '' : rows([pid ? ['House', kw(use), 'mdi:home-lightning-bolt', '', pid] : null,
                                            solarId ? ['Solar', sol, 'mdi:weather-sunny', '', solarId] : null,
                                            bat ? ['Battery', Math.round(num(states(c)[bat].state) || 0) + ' %', 'mdi:home-battery', '', bat] : null].filter(Boolean));
        return box('energy', s, head('energy') + stats + (today ? '<div class="sub2">' + esc(today) + '</div>' : '') + more);
      },
      climate: function (s, sec, c) {
        var st = states(c), ids = domainIds(c, 'climate');
        var row = function (id) {
          var x = st[id] || {}, cur = attr(x, 'current_temperature'), set = attr(x, 'temperature'), act = attr(x, 'hvac_action');
          // (Less: its temperature; More and Full: where it is set to as well)
          return [nameOf(x, id), deg(cur) + (set != null && s !== 'less' ? ' → ' + deg(set) : ''), act === 'heating' ? 'mdi:fire' : act === 'cooling' ? 'mdi:snowflake' : 'mdi:thermostat', act ===
            'heating' ? 'heat' : act === 'cooling' ? 'cool' : '', id];
        };
        if (!ids.length) return none('climate', s, 'No thermostats');
        if (s === 'tiny') { var r0 = row(ids[0]), a0 = attr(st[ids[0]], 'hvac_action');
          return tiny('climate', esc(r0[0] + ' ' + deg(attr(st[ids[0]], 'current_temperature'))), esc(a0 ? String(a0).replace(/^\w/, function (x) { return x.toUpperCase(); }) : '')); }
        var list = ids.slice(0, { less: 2, more: 4, full: 8 }[s]).map(row);
        if (s === 'full') {
          var w = setting('weather.entity', null) || domainIds(c, 'weather')[0], t = nowTemp(c, st[w]);
          if (t != null) list.push(['Outside', deg(t), 'mdi:home-thermometer']);
        }
        return box('climate', s, head('climate') + lst(rows(list)), 'shrink');
      },
      people: function (s, sec, c) {
        var st = states(c), ids = domainIds(c, 'person');
        if (!ids.length) return none('people', s, 'Nobody added');
        var home = ids.filter(function (id) { return (st[id] || {}).state === 'home'; }), away = ids.filter(function (id) { return home.indexOf(id) < 0; });
        if (s === 'tiny') return tiny('people', esc(home.length + ' home'), away.length ? esc(away.length + ' away') : '');
        var where = function (id) { var x = st[id] || {}; return x.state === 'home' ? 'Home' : x.state === 'not_home' ? 'Away' : String(x.state || '').replace(/_/g, ' '); };
        // FULL: each one, where and since when
        var since = function (id) { var t = Date.parse((st[id] || {}).last_changed); return t ? ' · ' + ago(t) : ''; };
        if (s === 'full') return box('people', s, head('people') + lst(rows(ids.slice(0, 8).map(function (id) { return [nameOf(st[id], id), where(id) + since(id), 'mdi:account', '', id]; }))),
          'shrink');
        var av = '<div class="ppl" style="--n:' + Math.min(5, ids.length) + '">' + ids.slice(0, 5).map(function (id, i) {
          var x = st[id] || {}, pic_ = attr(x, 'entity_picture'), nm = nameOf(x, id);
          var face = pic_ ? pic(pic_, { ph: 'av', ini: nm.charAt(0).toUpperCase(), color: FACE_COLORS[i % 5] }) : esc(nm.charAt(0).toUpperCase());
          return '<div data-ent="' + esc(id) + '" class="' + (x.state === 'home' ? '' : 'away') + '"><i style="background:' + FACE_COLORS[i % 5] + '">' + face + '</i>' + esc(nm.split(' ')[0]) +
            '</div>';
        }).join('') + '</div>';
        var line = s === 'more' && away.length ? away.slice(0, 2).map(function (id) { return nameOf(st[id], id).split(' ')[0] + ' is ' + (where(id) === 'Away' ? 'away' : 'at ' + where(id)); }).join(
          ' · ') : '';
        return box('people', s, head('people') + av + (line ? '<div class="sub2">' + esc(line) + '</div>' : ''));
      },
      todo: function (s, sec, c, ctx) {
        var eid = sec.entity || domainIds(c, 'todo')[0], st = eid && states(c)[eid];
        if (!st) return none('todo', s, 'No to-do list');
        var name = nameOf(st, eid), left = num(st.state);
        if (s === 'tiny') return tiny('todo', esc(name), left == null ? '' : esc(left + (left === 1 ? ' item' : ' items')));
        var t = todoOf(c, eid, sec.completed, ctx.redraw), got = t.got;
        var h = '<div class="h2"><span>' + esc(name) + '</span></div>';
        if (!got) return box('todo', s, h + '<div class="sub2">Reading the list…</div>');
        if (got.refused) return box('todo', s, h + '<div class="sub2">' + esc(got.refused === 'commands_disabled' ? 'Can’t read the list while control of the house is off.' : 'Can’t read the list.') +
          '</div>');
        var items = (got.items || []).slice(0, { less: 2, more: 4, full: 6 }[s]);
        var list = items.map(function (it) {
          var done = it.done || t.off[it.uid];
          return '<button type="button" class="it' + (done ? ' done' : '') + '" data-act="todo" data-list="' + esc(eid) + '" data-uid="' + esc(it.uid) + '"' +
            (it.done ? ' disabled' : '') + ' aria-label="Check off ' + esc(it.summary) + '"><i></i><span>' + esc(it.summary) + '</span></button>';
        }).join('');
        var add = s === 'full' ? '<form class="add" data-list="' + esc(eid) + '"><input name="item" placeholder="Add an item" aria-label="Add an item to ' + esc(name) +
          '" autocomplete="off"><button type="submit" aria-label="Add">' + icon('mdi:plus') + '</button></form>' : '';
        return box('todo', s, h + '<div class="todo lst">' + (list || '<div class="sub2">Nothing left</div>') + '</div>' + add, 'shrink');
      },
      notifications: function (s) {
        var n = notesOf();
        if (!n.length) return none('notifications', s, 'No notifications');
        if (s === 'tiny') return tiny('notifications', esc(n[0].text), esc(ago(n[0].at)));
        return box('notifications', s, head('notifications') + lst(rows(n.slice(0, { less: 1, more: 3, full: 5 }[s]).map(function (x) { return [x.text, ago(x.at)]; }))), 'shrink');
      },
      // A STATUS (2026-11-06), as the owner's status chip says it: Tiny, its glyph, name and label on one line; Less, the
      // glyph large beside the name over the label (the chip's two lines); More (and Full: there is no more to it), the
      // name as the heading over the glyph and the label large -- as Security says its state. Shown only while its
      // rule holds (shown, has); the entity's own sheet on a tap
      status: function (s, sec, c) {
        var o = statusOf(sec, c);
        if (!o) return none('status', s, sec.entity ? 'Can’t read ' + sec.entity : 'Choose an entity');
        var g = icon(esc(o.icon), o.color ? ' style="color:' + esc(o.color) + '"' : ''), ent = ' data-ent="' + esc(sec.entity) + '"';
        if (s === 'tiny') return '<div class="sec cmp stt" data-k="status" data-size="tiny"><div class="r2"' + ent + '>' + g +
          '<span class="tx">' + esc(o.name) + '</span><span class="v2">' + esc(o.label) + '</span></div></div>';
        if (s === 'less' || !HEAD_ON) return box('status', s, '<div class="r2 big st2"' + ent + '>' + g + '<span class="tx"><b>' + esc(o.name) +
          '</b><i>' + esc(o.label) + '</i></span></div>', 'stt');
        return box('status', s, '<div class="h2"><span>' + esc(o.name) + '</span></div><div class="r2 big"' + ent + '>' + g +
          '<span class="tx">' + esc(o.label) + '</span></div>', 'stt');
      }
    };
    function artDraw(img) {
      var c = document.createElement('canvas'); c.width = ART; c.height = ART;
      var ctx = c.getContext && c.getContext('2d'), out = { url: null, rgb: null };
      var t = document.createElement('canvas'); t.width = 10; t.height = 10;
      var tc = t.getContext && t.getContext('2d');
      if (!ctx || !tc) return out;
      var side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
      tc.drawImage(img, ((img.naturalWidth || img.width) - side) / 2, ((img.naturalHeight || img.height) - side) / 2, side, side, 0, 0, 10, 10);
      try {
        var d = tc.getImageData(0, 0, 10, 10).data, sum = [0, 0, 0];
        for (var i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
        out.rgb = sum.map(function (v) { return v / 100; });
      } catch (e) { return out; }
      // (through a middle step: a tall pane magnifies it far more than the
      // music pane's square, and one jump from 10 px streaks where the canvas
      // has no filter, as WebKit's)
      var m = document.createElement('canvas'); m.width = 20; m.height = 20;
      var mc = m.getContext('2d');
      if (mc) { mc.imageSmoothingQuality = 'high'; mc.drawImage(t, -2, -2, 24, 24); }
      // (opaque underneath: a blur's edge would let the page show through)
      ctx.fillStyle = 'rgb(' + out.rgb.map(Math.round).join(',') + ')';
      ctx.fillRect(0, 0, ART, ART);
      ctx.imageSmoothingQuality = 'high';
      try { ctx.filter = 'blur(3px)'; } catch (e) { /* the upscale alone */ }
      ctx.drawImage(mc ? m : t, -6, -6, ART + 12, ART + 12);
      try { ctx.filter = 'none'; } catch (e) { /* ignore */ }
      // ITS BRIGHTNESS, EVENED OUT (2026-10-30): a fixed darkening made a dark
      // cover all but black ("the Side Pane is solid black"). Each pixel scaled
      // so the art's mean sits at ART_MEAN -- a dark cover lifted, a light one
      // held down -- and none past ART_MAX, so white words over it (under the
      // shade) keep 4.5:1 however light the cover
      try {
        var px = ctx.getImageData(0, 0, ART, ART), dd = px.data, lum = function (i) { return 0.2126 * dd[i] + 0.7152 * dd[i + 1] + 0.0722 * dd[i + 2]; }, sum2 = 0;
        for (var p = 0; p < dd.length; p += 4) sum2 += lum(p);
        var k = Math.max(0.3, Math.min(2.6, ART_MEAN / Math.max(1, sum2 / (dd.length / 4))));
        for (var q = 0; q < dd.length; q += 4) {
          dd[q] *= k; dd[q + 1] *= k; dd[q + 2] *= k;
          var l = lum(q);
          if (l > ART_MAX) { var f = ART_MAX / l; dd[q] *= f; dd[q + 1] *= f; dd[q + 2] *= f; }
        }
        ctx.putImageData(px, 0, 0);
      } catch (e) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(0, 0, ART, ART); }
      try { out.url = c.toDataURL('image/png'); } catch (e) { out.url = null; }
      return out;
    }

    // ------------------------------------------------------------ taps
    // a section's page (the screen's view of that path) and its sheet's entity
    var TAP_PAGE = { weather: 'weather', calendar: 'calendar', now_playing: 'music', security: 'security', camera: 'cameras',
                     timers: 'timers', energy: 'energy', climate: 'climate' };
    function pagePath(p) {
      var M = C() && C().menu, cfg = M && M.config ? M.config() : null;
      var v = cfg && (cfg.views || []).filter(function (x) { return x && x.path === p; })[0];
      if (!v) return null;
      var seg = String(location.pathname).split('/')[1] || '';
      return '/' + seg + '/' + p;
    }
    function go(path) {
      var SH = window.hkShell;
      if (SH && SH.navigate) SH.navigate(path); else location.assign(path);
    }
    function tapEntity(s, c) {
      switch (s.kind) {
        case 'weather': return setting('weather.entity', null) || domainIds(c, 'weather')[0] || null;
        case 'calendar': return (window.hkCalendar && window.hkCalendar.ids ? window.hkCalendar.ids(c) : [])[0] || null;
        case 'now_playing': { var m = musicOf(c); return m ? m.key : null; }
        case 'security': { var al = alarmOf(c); return (al && al.id) || kinds('locks')[0] || null; }
        case 'camera': return s.entity || (setting('cameras.order', []) || [])[0] || domainIds(c, 'camera')[0] || null;
        case 'energy': return setting('features.power', null);
        case 'climate': return domainIds(c, 'climate')[0] || null;
        case 'people': return domainIds(c, 'person')[0] || null;
        case 'todo': return s.entity || domainIds(c, 'todo')[0] || null;
        case 'status': return s.entity || null;
        default: return null;
      }
    }

    // ------------------------------------------------------------ one pane
    // A PANE: the Dashboard's (mode 'dash', fixed to the window's edge) or the
    // screensaver's (mode 'saver', inside its own shadow root). Given its
    // sections and its place, it draws, fits and publishes nothing itself.
    class HkSidePane extends HTMLElement {
      constructor() {
        super();
        this._root = this.attachShadow({ mode: 'open' });
        if (C() && C().artGuard) C().artGuard(this._root);
        this._slots = {};
        this._stills = {};
        this._wx = {};
        var self = this;
        this._root.addEventListener('click', function (e) { self._click(e); });
        // THE VOLUME: set where it is let go (the music's own player)
        this._root.addEventListener('change', function (e) {
          var t = e.target, c = clientNow(), m = c && musicOf(c);
          if (!t || t.getAttribute('data-act') !== 'vol' || !m || !c.actions) return;
          var level = Math.max(0, Math.min(1, Number(t.value) / 100));
          c.actions.callService('media_player', 'volume_set', { volume_level: level }, { entity_id: m.members.length > 1 ? m.members : m.key })
            .catch(function () { /* refused: said by the host */ });
        });
        // (its fill follows the finger: the track's --f)
        this._root.addEventListener('input', function (e) { var t = e.target; if (t && t.getAttribute('data-act') === 'vol') t.style.setProperty('--f', t.value + '%'); });
        // A FINGER MOVES IT ONLY ONCE IT GOES SIDEWAYS, as every speaker volume (hkDrag.slider, 2026-11-10, the owner: "it's
        // real easy to catch a volume slider" scrolling): the input itself takes no pointer (a touch on its track jumped it
        // there), the keys still work; the thumb's center runs the track less half a thumb at each end, as the browser's
        // (the slider the pane has now: a push of the music redraws the pane under a finger, and the one pressed is gone)
        var root = this._root, live = function (t) { return t && t.isConnected ? t : root.querySelector('input[data-act="vol"]'); }, level = null;
        var volAt = function (t, x) {
          t = live(t);
          if (!t) return;
          var r = t.getBoundingClientRect(), v = Math.round(Math.max(0, Math.min(1, (x - r.left - 11) / Math.max(1, r.width - 22))) * 100);
          level = String(v);
          if (level !== t.value) { t.value = level; t.dispatchEvent(new Event('input', { bubbles: true })); }
        };
        var wire = function (D) {
          D.slider(root, {
            target: function (e) { var m = e.target.closest && e.target.closest('.mvs'); return m && m.querySelector('input[data-act="vol"]'); },
            start: function (t, x) { level = null; volAt(t, x); }, move: volAt,
            end: function (t) {
              t = live(t);
              if (!t || level === null) return;
              t.value = level;
              t.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        };
        if (window.hkDrag && window.hkDrag.slider) wire(window.hkDrag); else window.addEventListener('hk-drag', function () { wire(window.hkDrag); }, { once: true });
        this._root.addEventListener('submit', function (e) { self._submit(e); });
      }
      // what it shows now: { list (sections), place, doorbell (a camera) }
      show(o) {
        this._o = o || null;
        var on = !!(o && o.place && o.place.kind !== 'none' && ((o.list && o.list.length) || o.doorbell));
        var was = this.hasAttribute('on');
        this.toggleAttribute('on', on);
        if (!on) { this._sig = null; if (was) this._slide(false); else this._park(); return false; }
        this.setAttribute('side', o.place.kind === 'band' ? 'band' : o.side === 'left' ? 'left' : 'right');
        this._draw();
        if (!was) this._slide(true);
        this._shown = true;
        return true;
      }
      // SLIDING IN AND OUT (2026-11-01, the owner: "I'd love the Side Pane and tab bar to animate/slide out of the way when
      // I swipe between pages, instead of just popping into place"): on the Dashboard, a pane that goes slides off past its
      // own edge -- the page already in its new width under it -- and one that comes slides in from there. A transform
      // alone (no layout while it moves); the first time it shows, under Reduce Motion, and anywhere but the Dashboard,
      // as before: at once.
      _slide(coming) {
        var self = this, side = this.getAttribute('side');
        if (this._slideAnim) { try { this._slideAnim.cancel(); } catch (e) { /* done */ } this._slideAnim = null; }
        this.removeAttribute('leaving');
        // (the finger already took it there -- a swipe between pages, FOLLOW: nothing more to slide)
        if (this._followed) { this._followed = false; if (!coming) this._park(); return; }
        var still = this.getAttribute('mode') !== 'dash' || typeof this.animate !== 'function' || (coming && !this._shown) ||
          (window.hkSettings && window.hkSettings.skyLook && window.hkSettings.skyLook().animations === false) ||
          (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        if (still) { if (!coming) this._park(); return; }
        var away = side === 'band' ? 'translateY(100%)' : side === 'left' ? 'translateX(-100%)' : 'translateX(100%)';
        var EASE = (C() && C().EASE) || { standard: 'ease-out', exit: 'ease-in' };
        if (coming) {
          this._slideAnim = this.animate([{ transform: away }, { transform: 'none' }], { duration: 360, easing: EASE.standard });
          this._slideAnim.onfinish = function () { self._slideAnim = null; };
          return;
        }
        // (still drawn while it goes: `leaving` keeps it shown, the off pane's taps off)
        this.setAttribute('leaving', '');
        var a = this._slideAnim = this.animate([{ transform: 'none' }, { transform: away }], { duration: 300, easing: EASE.exit, fill: 'forwards' });
        a.onfinish = function () {
          if (self._slideAnim !== a) return;
          self._slideAnim = null; self.removeAttribute('leaving'); a.cancel();
          if (!self.hasAttribute('on')) self._park();
        };
      }
      redraw() { if (this._o && this.hasAttribute('on')) this._draw(true); }
      // ------------------------------------------------ drawing and the fit
      _draw(again) {
        var o = this._o, c = clientNow();
        if (!this._built) {
          this._cssFull = cssReady();
          this._root.innerHTML = '<style>' + css() + '</style><div class="pane"><div class="artbg" aria-hidden="true"><i></i></div><div class="pin"><div class="secs"></div></div></div>';
          this._pin = this._root.querySelector('.pin');
          this._secs = this._root.querySelector('.secs');
          this._built = true;
        }
        // (its sheet drawn again with the design values, once hkCards has come)
        if (!this._cssFull && cssReady()) { this._cssFull = true; this._root.querySelector('style').textContent = css(); }
        var band = o.place.kind === 'band', W = this.clientWidth || (band ? window.innerWidth : o.place.w) || DRAWN_W;
        var H = this.clientHeight || (band ? o.place.h : window.innerHeight) || 800;
        // drawn at 400 wide and scaled whole (a band at its own height, scaled the same)
        var z = band ? Math.max(0.85, Math.min(1.1, H / BAND_H)) : Math.max(0.85, Math.min(1.3, W / DRAWN_W));
        this._pin.style.width = (W / z).toFixed(1) + 'px';
        this._pin.style.height = (H / z).toFixed(1) + 'px';
        this._pin.style.transform = 'scale(' + z.toFixed(4) + ')';
        this._pin.style.setProperty('--hk-pin-z', z.toFixed(4));   // (the music's targets 44 px on the screen: hk-np-strip.js)
        // AT THE TOP, AND AT THE FOOT (a section's Place, 2026-10-30): the top
        // ones in order, a space, then the bottom ones -- each drawn with its
        // index in the pane's list (data-i), what a tap on it reads
        var all = o.list || [], self = this;
        var list = all.filter(function (x) { return x.place !== 'bottom'; }), foot = list.length;
        list = list.concat(all.filter(function (x) { return x.place === 'bottom'; }));
        this._list = list;
        var sp = paneOf();
        HEAD_ON = this.getAttribute('mode') !== 'widget' && !(sp && sp.headings === false);
        var ctx = this._ctx(c);
        var door = o.doorbell ? this._door(o.doorbell, c) : '';
        var render = function (sizes, n) {
          var html = door;
          for (var i = 0; i < n; i++) {
            var s = list[i], fn = SEC[s.kind];
            if (i === foot && foot > 0) html += '<div class="gap" aria-hidden="true"></div>';
            try { html += fn ? String(fn(sizes[i], s, c, ctx)).replace(/^<div /, '<div data-i="' + i + '" ') : ''; } catch (e) { console.warn('[hk-sidepane] ' + s.kind, e); }
          }
          if (n < list.length) html += '<div class="more2">+' + (list.length - n) + ' more</div>';
          return html;
        };
        this._artBg(list, c);
        var sig = JSON.stringify([list, W, H, o.side, band, o.doorbell, HEAD_ON]) + '|' + this._dataSig(c);
        if (!again && sig === this._sig) return;
        this._sig = sig;
        var over = function (sizes, n) {
          self._secs.innerHTML = render(sizes, n);
          self._fill();
          self._floors();
          return band ? self._secs.scrollWidth > self._secs.clientWidth + 1 || self._tallest() > self._secs.clientHeight + 1
                      : self._secs.scrollHeight > self._secs.clientHeight + 1;
        };
        var got = fit(list, over);
        // (the last measured draw may be a step past the answer: draw the answer)
        this._secs.innerHTML = render(got.sizes, got.n);
        this._fill();
        this._floors();
        this._cuts();
        this._cams();
        this._fit = got;
        this._queue(c);
      }
      // More uses only the space left after every section has fitted. The preview
      // never makes another section shrink or disappear; its rows open the full queue.
      _queue(c) {
        var old = this._secs.querySelector('.npqueue');
        // (drawn again with the pane: where the list was scrolled to stays, for the same song)
        var oldQs = old && old.querySelector('.qs'), kept = oldQs && this._npQueue && this._npQueue.sig === this._npQueue.drawn ? oldQs.scrollTop : 0;
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var sec = this._secs.querySelector('[data-k="now_playing"][data-size="more"]');
        var m = musicOf(c), self = this;
        if (!sec || !m || this.getAttribute('side') === 'band' || !c || !c.callWS) return;
        var sig = JSON.stringify([m.key, m.title, m.artist, attr(states(c)[m.key], 'media_content_id')]);
        var q = this._npQueue;
        if (!q || q.sig !== sig || (!q.busy && Date.now() - q.at > 30000)) {
          q = this._npQueue = { sig: sig, at: Date.now(), busy: true, items: q && q.sig === sig ? q.items : [] };
          c.callWS({ type: 'hk_music/queue', entity_id: m.key, limit: 40 }).then(function (r) {
            if (self._npQueue !== q) return;
            q.busy = false; q.items = r && r.ok && Array.isArray(r.items) ? r.items.slice(1) : [];
            if (self.isConnected && self.hasAttribute('on')) self._queue(clientNow());
          }, function () { if (self._npQueue === q) { q.busy = false; q.items = []; } });
        }
        if (!q.items.length) return;
        var used = 0, secs = this._secs;
        Array.prototype.forEach.call(secs.children, function (n) { if (!n.classList.contains('gap')) used += n.offsetHeight; });
        used += Math.max(0, secs.children.length - 1) * (parseFloat(getComputedStyle(secs).rowGap) || 0);
        // The room the sections leave, less the section's own grid gap: the box is that tall and its rows scroll;
        // where the heading and one row do not fit, none.
        var room = secs.clientHeight - used - (parseFloat(getComputedStyle(sec).rowGap) || 0) - 12 - 2;
        if (room < 16 + 28 + 6 + 56) return;
        var el = document.createElement('div'); el.className = 'npqueue';
        el.style.height = Math.min(room, 16 + 28 + 6 + 62 * q.items.length) + 'px';
        el.innerHTML = '<button class="qh" type="button" data-act="queue">Up Next<span>View Queue</span></button><div class="qs">' +
          q.items.map(function (it, i) {
            // (the song's cover at its left, a note where Music Assistant has none yet -- 2026-11-07, the owner;
            // Apple's 1000 px covers asked for at a thumbnail's size)
            var img = it.image ? String(it.image).replace(/\/(\d+)x(\d+)(bb|cc|sr)?\.(jpg|jpeg|png|webp)$/, '/160x160$3.$4') : '';
            return '<button class="qr" type="button" data-act="queue" aria-label="View queue: ' + esc(it.title) + '"><span class="qa"' +
              (img ? ' style="background-image:url(&quot;' + esc(img) + '&quot;)">' : '>' + icon('mdi:music-note')) +
              '</span><span class="qt"><b>' + esc(it.title) + '</b><small>' + esc(it.artist || '') + '</small></span></button>';
          }).join('') + '</div>';
        sec.appendChild(el);
        var qs = el.querySelector('.qs'), fade = function () { qs.toggleAttribute('more', qs.scrollHeight - qs.scrollTop - qs.clientHeight > 2); };
        qs.addEventListener('scroll', fade, { passive: true });
        q.drawn = sig;
        if (kept) qs.scrollTop = kept;
        fade();
      }
      // THE ALBUM ART BEHIND THE WHOLE PANE (2026-10-30, the owner: "if something
      // is playing, the whole pane should have the album art blur"): while Now
      // Playing is one of its sections and has a song, the pane's ground is the
      // song's art blurred -- the music pane's own way (hk-saver.js drawBlur):
      // drawn 10 px, then 32 px with a 2 px blur and darkened, and the CSS
      // scales it up; no live filter -- under a shade for its words, edge to
      // edge. The next song's fades in over the last; stopped, it fades back to
      // the screen's glass. Where the look has no blur (Flat, Tinted, Frosted,
      // Glass -- Performance's), a flat tint from the art instead.
      _artBg(list, c) {
        // (the Now Playing section's Album Art Background, on unless set off -- item 41: off, the pane keeps its ordinary
        // ground, and the music pane at Full its own backdrop)
        this._artOn = list.some(function (s) { return s.kind === 'now_playing' && s.art !== false; });
        var want = this._artOn ? musicOf(c) : null;
        var pic = want && want.pic ? want.pic : null, self = this;
        var g = document.documentElement.getAttribute('data-hk-glass') || 'blur';
        // (Flat: the cover itself, sharp and very dim -- no blur there, and a flat color hid the song; 2026-11-10, the owner)
        var dim = document.documentElement.hasAttribute('data-hk-flat') || g === 'flat';
        var tint = !dim && ['tinted', 'frosted', 'clear'].indexOf(g) >= 0;
        this.toggleAttribute('arttint', tint);
        this.toggleAttribute('artdim', dim);
        if (pic === this._artPic && dim === this._artDim) return;
        this._artDim = dim;
        this._artPic = pic;
        if (!pic) { this.removeAttribute('arted'); return; }
        var img = new Image();
        img.onload = function () {
          if (self._artPic !== pic) return;
          var got = artDraw(img), bg = self._root.querySelector('.artbg');
          if (got.rgb) self.style.setProperty('--art-tint', 'rgb(' + got.rgb.map(function (v) { return Math.round(v * 0.42); }).join(',') + ')');
          // A NEW LAYER FOR EACH SONG, its picture set before it is in the page,
          // faded in over the last, which then goes: WebKit left a layer whose
          // picture changed during its fade unpainted -- the pane's ground alone,
          // near black (2026-10-30). (A picture that can't be read here: itself,
          // under a blur drawn once.)
          var b = document.createElement('b');
          if (dim) b.className = 'dim'; else if (!got.url) b.className = 'raw';
          b.style.backgroundImage = 'url("' + ((dim ? null : got.url) || pic).replace(/"/g, '%22') + '")';
          bg.insertBefore(b, bg.querySelector('i'));
          var olds = Array.prototype.filter.call(bg.querySelectorAll('b'), function (x) { return x !== b; });
          requestAnimationFrame(function () { requestAnimationFrame(function () {
            b.classList.add('on');
            olds.forEach(function (o) { o.classList.remove('on'); setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 1300); });
          }); });
          self.setAttribute('arted', '');
        };
        img.onerror = function () { if (self._artPic === pic) self.removeAttribute('arted'); };
        img.src = pic;
      }
      // A TAP ON A SECTION (2026-10-30, the owner: "ALL the Widgets should do
      // something if you tap on them"): on one thing in it -- an event, a
      // person, a lock, a thermostat -- that thing's sheet; else the section's
      // When Tapped: Automatic (its page where this screen has one, else its
      // sheet), Its Page, Its Sheet or Nothing. Its buttons, the to-do list's
      // circles and the music pane keep their own.
      _tap(e, c) {
        var t = e.target;
        if (!t.closest || t.closest('button,input,form,a,.slot,hk-music-pane-card')) return;
        var sec = t.closest('[data-i]'), s = sec && this._list ? this._list[+sec.getAttribute('data-i')] : null;
        if (!s || s.tap === 'none') return;
        // NOW PLAYING'S OWN TWO (2026-10-31, item 44): the Speakers / Volume / Queue / Browse panel opens in place over
        // the pane, or the section flips over to it, as the screensaver's player turns (musicPanel) -- and Automatic is
        // the panel (2026-11-01, the owner: a tap on the cover or the song opened the detail sheet; the panel keeps
        // them on the page). THE COVER at Automatic or Open the Panel is the screensaver's music, full screen (the
        // owner, the same day: "that would be neat!"); where this screen has none, the panel.
        if (s.kind === 'now_playing' && (!s.tap || s.tap === 'auto' || s.tap === 'panel' || s.tap === 'flip')) {
          var Sv = window.hkSaver;
          if (s.tap !== 'flip' && t.closest('.art') && Sv && Sv.showMusic && Sv.showMusic()) return;
          musicPanel(this, 'speakers', sec, s.tap === 'flip' ? 'flip' : 'drawer');
          return;
        }
        var D = window.hkDetail, ev = t.closest('[data-ev]'), one = t.closest('[data-ent]');
        if (ev && CAL.shown && CAL.shown[+ev.getAttribute('data-ev')]) {
          var K = window.hkCalendar, x = CAL.shown[+ev.getAttribute('data-ev')];
          if (K && K.show) { try { K.show(c, x); return; } catch (err) { /* below */ } }
        }
        if (one && D && D.open && s.tap !== 'page') { D.open(one.getAttribute('data-ent')); return; }
        // (the Clock has no page of its own; showing the weather -- beside the time or under it -- its page is Weather:
        // 2026-10-31, the owner set When Tapped to its page and nothing happened)
        var page = s.kind === 'clock' ? (s.beside === 'weather' || s.line === 'weather' ? 'weather' : null) : TAP_PAGE[s.kind];
        var ent = tapEntity(s, c), path = page && pagePath(page);
        if ((s.tap === 'page' || !s.tap || s.tap === 'auto') && path) { go(path); return; }
        if (ent && D && D.open && s.tap !== 'page') { D.open(ent); return; }
        if (path) go(path);
      }
      // HOW SHORT A .shrink MAY GO: its heading, what is under its rows (the
      // timers' keys, the to-do list's Add) and its first row, as laid out
      // before it gives way (the pane is scaled whole: CSS pixels, offsetHeight)
      _floors() {
        Array.prototype.forEach.call(this._secs.querySelectorAll('.secs>.shrink'), function (sec) {
          var cs = getComputedStyle(sec), gap = parseFloat(cs.rowGap) || 0, h = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
          var kids = Array.prototype.filter.call(sec.children, function (k) { return k.offsetHeight > 0 || k.classList.contains('lst'); });
          kids.forEach(function (k, i) {
            if (i) h += gap;
            if (!k.classList.contains('lst')) { h += k.offsetHeight; return; }
            var one = k.firstElementChild;
            h += one ? Math.min(k.scrollHeight, one.offsetHeight + (one.nextElementSibling && one.nextElementSibling.classList.contains('bar2') ? one.nextElementSibling.offsetHeight + 8 : 0)) : 0;
          });
          sec.style.minHeight = Math.ceil(h) + 2 + 'px';
        });
      }
      // ...and a list cut short fades out at its foot, so it reads as more below
      _cuts() {
        Array.prototype.forEach.call(this._secs.querySelectorAll('.shrink>.lst'), function (l) {
          l.classList.toggle('cut', l.scrollHeight > l.clientHeight + 2);
        });
      }
      _tallest() {
        var t = 0;
        Array.prototype.forEach.call(this._secs.children, function (k) { t = Math.max(t, k.scrollHeight || 0); });
        return t;
      }
      // what the data said last time, so a push that changes nothing here draws nothing
      _dataSig(c) {
        var st = states(c), o = this._o, ids = [];
        (o.list || []).forEach(function (s) { ids.push(s.entity || ''); if (s.show && s.show.entity) ids.push(s.show.entity); });
        var m = musicOf(c);
        return JSON.stringify([Math.floor(Date.now() / 30000), m && [m.key, m.playing, m.title, m.artist, m.pic, attr(st[m.key], 'media_content_id')],
          timersOf(c).map(function (r) { var x = st[r.entity_id]; return [r.entity_id, x && x.state, r.finishes_at || r.remaining]; }),
          ids.map(function (id) { return id && st[id] ? st[id].last_updated : ''; }), CAL.at, notesOf().length,
          Object.keys(TODO).map(function (k) { return TODO[k].sig + (TODO[k].got ? 1 : 0); })]);
      }
      _ctx(c) {
        var self = this;
        return {
          redraw: function () { self.redraw(); },
          calendar: function (days) { calLoad(c, days, function () { self.redraw(); }); },
          // an event's color: its own, a keyword's, else its calendar's
          // (hkSettings.eventColor, the Calendar page's), as the chart palette has it
          evColor: function (e) {
            var HSet = window.hkSettings, hue = (C() && C().PALETTE && C().PALETTE.chart) || {}, key = null;
            try { key = HSet && HSet.eventColor ? HSet.eventColor(e.cal, e.title, e.uid, states(c)) : null; } catch (er) { key = null; }
            var rgb = key === 'white' ? [255, 255, 255] : hue[key];
            return rgb && rgb.length === 3 ? 'rgb(' + rgb.join(',') + ')' : '#ff9f0a';
          },
          forecast: function (wid, kind) { return self._forecast(c, wid, kind); },
          // a camera's last still that loaded, or '' (see _cams)
          still: function (id) { var s = self._stills[id]; return s && s.url || ''; },
          slot: function (key, tag) { self._want = self._want || {}; self._want[key] = tag; return '<div class="slot" data-slot="' + key + '"></div>'; }
        };
      }
      // THE CAMERA'S STILL, LOADED AND REFRESHED IN PLACE (2026-10-31, the owner's item 42: "Driveway Camera ...
      // never loads", a "?" forever). WHY: the address asked for carried `hk_n=`, and Mantel's still route answers
      // only width, height, v and _hk (camera_still.py: anything else is a 400), so every request failed; and it
      // asked for no size, which is the camera's whole 4K frame (1.8 MB) where the blocks ask 480 x 270. Now, as
      // the blocks' strip does (hk-cameras.js _srcFor): the entity's own entity_picture, read fresh each time (HA
      // rotates its token), `_hk` a counter, and the tier's size. A new one is loaded off screen and put in only once
      // it has a picture (naturalWidth), at most every ten seconds; one that failed is not asked for again with the
      // same address for a minute. A draw shows the last good one at once.
      _cams() {
        var self = this, c = clientNow(), nodes = this._secs ? this._secs.querySelectorAll('.cam2[data-k="camera"]') : [];
        var ids = {};
        Array.prototype.forEach.call(nodes, function (n) { var id = n.getAttribute('data-cam'); if (id) ids[id] = 1; });
        var any = Object.keys(ids);
        if (!any.length) { if (this._camT) { clearInterval(this._camT); this._camT = null; } return; }
        if (!this._camT) this._camT = setInterval(function () { self._cams(); }, 10000);
        if (!c) return;
        any.forEach(function (id) {
          var st = states(c)[id], HC = C(), a = st && st.attributes;
          var pic = a && !a.restored && !(HC && HC.stale && HC.stale(st)) ? a.entity_picture : null;
          var s = self._stills[id] || (self._stills[id] = { at: 0, n: 0, url: '', busy: false, bad: '', badAt: 0 });
          // (a picture that neither loads nor fails in LOST is given up, as the calendar's read)
          if (s.busy && Date.now() - s.at > LOST) s.busy = false;
          if (!pic || s.busy || Date.now() - s.at < 9000) return;
          if (s.bad === pic && Date.now() - s.badAt < 60000) return;
          s.busy = true; s.at = Date.now(); s.n++;
          var url = pic + (pic.indexOf('?') < 0 ? '?' : '&') + '_hk=' + s.n + '&width=480&height=270', im = new Image();
          im.onload = function () {
            s.busy = false;
            if (!im.naturalWidth) { s.bad = pic; s.badAt = Date.now(); return; }
            s.url = url; s.bad = '';
            Array.prototype.forEach.call(self._secs.querySelectorAll('.cam2[data-k="camera"]'), function (n) {
              if (n.getAttribute('data-cam') !== id) return;
              var el = n.querySelector('img');
              if (!el) { el = document.createElement('img'); el.alt = ''; n.insertBefore(el, n.querySelector('.cn')); }
              if (el.getAttribute('src') !== url) el.setAttribute('src', url);
            });
          };
          im.onerror = function () { s.busy = false; s.bad = pic; s.badAt = Date.now(); };
          im.src = url;
        });
      }
      // ELEMENTS KEPT BETWEEN DRAWS (the music pane, the doorbell's live
      // camera): made once, moved into each draw's place for them
      _fill() {
        var self = this, want = this._want || {}, c = clientNow();
        Array.prototype.forEach.call(this._secs.querySelectorAll('.slot'), function (slot) {
          var key = slot.getAttribute('data-slot'), tag = want[key], el = self._slots[key];
          if (!el && tag && customElements.get(tag)) {
            el = self._slots[key] = document.createElement(tag);
            if (el.setConfig) el.setConfig(self._slotCfg(key, tag));
            var HC = window.hkHostClient;
            if (HC && HC.bridge && c) HC.bridge(el, c);
          }
          if (!el) {
            if (tag && customElements.whenDefined) customElements.whenDefined(tag).then(function () { self.redraw(); });
            return;
          }
          slot.parentNode.replaceChild(el, slot);
          // (the music pane on the pane's own album-art backdrop: none of its
          // own and no box -- the owner, 2026-10-30)
          if (key === 'np') el.toggleAttribute('nobg', self._artOn !== false);
          if (key === 'np') el.setAttribute('inpane', '');
          if (key === 'np') el.toggleAttribute('compact', !!(el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('compact')));
          if (key === 'np' && el.active) el.active(true);
        });
      }
      _slotCfg(key, tag) {
        if (key.indexOf('door:') === 0) return { type: 'custom:' + tag, entity: key.slice(5), aspect_ratio: '16x9', fit_mode: 'cover' };
        return { type: 'custom:' + tag };
      }
      // ...and taken out when the pane steps aside (the music pane stops drawing)
      _park() {
        this._npQueue = null;
        var np = this._slots.np;
        if (this._camT) { clearInterval(this._camT); this._camT = null; }
        if (np && np.active) np.active(false);
        Object.keys(this._slots).forEach(function (k) { var el = this._slots[k]; if (el.parentNode) el.parentNode.removeChild(el); }, this);
      }
      // THE DOORBELL at the top, live, while its pop-up shows
      _door(cam, c) {
        var st = states(c)[cam], key = 'door:' + cam;
        this._want = this._want || {};
        this._want[key] = 'hk-camera-live-card';
        return '<div class="sec cam2 ring" data-k="door"><div class="live"><div class="slot" data-slot="' + key + '"></div></div>' +
          '<span class="lv">DOORBELL</span><span class="cn">' + esc(nameOf(st, cam)) + ' · Live</span></div>';
      }
      // THE FORECAST: the house's forecast sensor where Configure -> Weather names one (as the weather blocks
      // read it), else hkWxForecast, the Weather page's own subscription, one per kind, kept while the pane shows
      // weather -- and asked again at each draw (ensure): after a refusal's wait, or a reconnect that forgot it.
      // (2026-11-01, the owner: the forecast under the time came only once the Weather page had been opened --
      // the page's own ask, which the pane then shared; the pane's first had gone unanswered and it never asked again)
      _forecast(c, wid, kind) {
        var HS = window.hkSettings, sid = HS && HS.get ? HS.get('weather.forecast_' + kind, null) : null;
        if (sid) return (((states(c)[sid] || {}).attributes || {}).forecast) || [];
        var W = window.hkWxForecast, key = kind + '|' + wid, self = this, port = c && c.subscriptions;
        if (!W || !port) return [];
        var w = this._wx[key];
        if (!w || w.conn !== port) {
          if (w) w.release();
          w = this._wx[key] = W.watch(port, kind, wid, function () { self.redraw(); });
        } else {
          w.ensure();
        }
        return w.data() || [];
      }
      // ------------------------------------------------ taps
      _click(e) {
        var b = e.target.closest ? e.target.closest('[data-act]') : null, c = clientNow();
        if (!b) { this._tap(e, c); return; }
        if (!c || !c.actions) return;
        var act = b.getAttribute('data-act');
        if (act === 'pp') {
          var m = musicOf(c);
          if (m) c.actions.callService('media_player', 'media_play_pause', {}, { entity_id: m.key }).catch(function () { /* refused: said by the host */ });
        } else if (act === 'prev' || act === 'next') {
          var mn = musicOf(c);
          if (mn) c.actions.callService('media_player', act === 'prev' ? 'media_previous_track' : 'media_next_track', {}, { entity_id: mn.key }).catch(function () { /* refused: said by the host */ });
        } else if (act === 'spk' || act === 'brw' || act === 'queue') {
          musicPanel(this, act === 'spk' ? 'speakers' : act === 'queue' ? 'queue' : 'browse', b.closest('[data-k="now_playing"]'), 'drawer');
        } else if (act === 'todo') {
          // CHECKED OFF: a house command (todo.update_item), struck through
          // until the list says so
          var sent = todoCheck(c, b.getAttribute('data-list'), b.getAttribute('data-uid'));
          if (!sent) return;
          b.classList.add('done');
          sent.catch(function () { b.classList.remove('done'); });
        } else if (act === 'tp' || act === 'tx') {
          // A RUNNING TIMER'S RING (pause / resume) AND STOP: the Timers block's
          // services (timer.pause, timer.start, timer.cancel)
          var tid = b.getAttribute('data-timer');
          if (tid) c.actions.callService('timer', act === 'tx' ? 'cancel' : b.getAttribute('data-paused') === '1' ? 'start' : 'pause', {}, { entity_id: tid })
            .catch(function () { /* refused: said by the host */ });
        } else if (act === 'timer') {
          // A QUICK TIMER, as the Timers page starts one (the quick_timers package's script)
          var mins = Number(b.getAttribute('data-min')), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
          c.actions.callService('script', 'quick_timer_start', { duration: p2(Math.floor(mins / 60)) + ':' + p2(mins % 60) + ':00' })
            .catch(function () { /* refused: said by the host */ });
        }
        e.stopPropagation();
      }
      _submit(e) {
        var f = e.target, c = clientNow();
        e.preventDefault();
        if (!f || !f.matches || !f.matches('form.add') || !c || !c.actions) return;
        var inp = f.querySelector('input'), txt = inp && String(inp.value || '').trim(), eid = f.getAttribute('data-list');
        if (!txt || !eid) return;
        inp.value = '';
        todoAdd(c, eid, txt).catch(function () { inp.value = txt; });
      }
      // (a widget is shown before it is placed: drawn again at its slot's size)
      connectedCallback() { if (this.getAttribute('mode') === 'widget' && this._o) this._draw(true); }
      disconnectedCallback() {
        var wx = this._wx;
        Object.keys(wx).forEach(function (k) { wx[k].release(); });
        this._wx = {};
        this._park();
      }
    }

    // what the shell and the later parts use of this one
    K.HkSidePane = HkSidePane; K.SEC = SEC;
  };
})();
