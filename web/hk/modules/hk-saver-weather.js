// hk-saver-weather.js -- THE SCREENSAVER'S WEATHER (2026-10-14): today's
// weather at a glance, laid out as Home Energy is (hk-saver-energy.js), over
// HK's own Live Sky in its Sky Only form (hk-sky.js scene, skyOnly: the sky,
// its clouds, rain, snow, stars and moon -- no land, no decorations). The
// temperature in front of the condition's own symbol, huge (hk-header.js
// wxSvg), as a backdrop; a headline and a line in words; Temperature, Rain
// (or Snow) and Wind with leader lines; Next Hours and Coming Days along the
// bottom. A slide among the photos, or one of the Additional Screens over the
// clock (hk-saver.js; settings.py weather_slide, weather_hide). Designed in
// hk_house/docs/mockups/saver-weather-screen.html.
//
// Loaded by hk-saver.js only when a screen shows Weather -- never on its own.
//
// WHAT IT COSTS A WALL TABLET, by design:
//   - its sky is one more Live Sky scene, held still (paused) whenever it is
//     not on screen; the words and numbers sit still once drawn
//   - the forecast: a configured forecast sensor, else Home Assistant's
//     weather/subscribe_forecast (hourly and daily), as the forecast band does,
//     dropped with the screen
//   - laid out at a 1280 x 800 tablet's size and scaled whole to the room it
//     has (one transform), redrawn at most every REDRAW_MS while it shows
//
//   hkSaverWeather.create({ hide, h24 }) -> ctl
//     ctl.el                  the layer (hk-saver.js puts it in its root)
//     ctl.ready(hass)         a weather to show
//     ctl.draw(hass)          fill it in now, its sky running
//     ctl.arrived()           the fade is done: the lines and the bar draw
//     ctl.layout(W, H)        the room it has (beside any pane)
//     ctl.setHass(hass), setHide(list), leave(), destroy()
(function () {
  'use strict';
  if (window.hkSaverWeather) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var W0 = 1280, H0 = 800, REDRAW_MS = 10000;
  // the readings' and bars' colors (Home Energy's palette: hk-energy.js RING)
  var COL = { temp: '#ff9f0a', rain: '#0a84ff', wind: '#66d4cf' };
  // the parts Weather Options can leave out (settings.py SAVER_WEATHER_PARTS)
  var PARTS = ['rain', 'wind', 'hours', 'days'];

  var CSS = [
    '.wx{position:absolute;inset:0;z-index:3;opacity:0;visibility:hidden;pointer-events:none;overflow:hidden;background:#0b1830;',
    '  font-family:' + FONT + ';color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.28);',
    '  transition:opacity var(--hk-wx-fade,3000ms) ease,visibility 0s linear var(--hk-wx-fade,3000ms)}',
    '.wx.on{opacity:1;visibility:visible;transition:opacity var(--hk-wx-fade,3000ms) ease,visibility 0s}',
    '.wx .wxsky{position:absolute;inset:0}',
    // where the text is, the sky darkened a little -- never a box behind it
    '.wx .wxwash{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,10,24,.42),rgba(4,10,24,.18) 55%,rgba(4,10,24,.24)),',
    '  linear-gradient(180deg,rgba(4,10,24,0) 55%,rgba(4,10,24,.42))}',
    '.wx[night] .wxwash{background:linear-gradient(180deg,rgba(0,0,0,0) 60%,rgba(0,0,0,.3))}',
    // EVERYTHING ELSE at a 1280 x 800 tablet's size, scaled whole (--z)
    '.wx .wxin{position:absolute;left:0;top:0;width:calc(100% / var(--z,1));height:calc(100% / var(--z,1));transform:scale(var(--z,1));transform-origin:0 0}',
    '.wx .wxin .wxcorner{position:absolute;left:44px;top:34px}',
    '.wx .wxin .wxt{font-size:64px;font-weight:600;letter-spacing:-2px;line-height:1}',
    '.wx .wxin .wxt small{font-size:24px;font-weight:600;letter-spacing:0;margin-left:4px;opacity:.85}',
    '.wx .wxin .wxfresh{position:absolute;top:100%;left:0;margin-top:5px;font-size:12px;opacity:.62;white-space:nowrap}',
    '.wx .wxin .fg .pop{font-size:12px;font-weight:600;margin-top:5px;color:#91ceff}',
    '.wx .wxin .wxd{font-size:20px;font-weight:500;margin-top:6px;opacity:.85}',
    '.wx .wxin .wxbody{position:absolute;left:0;right:0;top:150px;bottom:150px;display:flex;align-items:center;justify-content:center;gap:64px}',
    // THE TEMPERATURE IN FRONT OF ITS WEATHER: the symbol huge, to the left and
    // low, mostly behind the digits; a sun or a moon glows into the sky
    '.wx .wxin .hero{position:relative;width:420px;height:400px;flex:none}',
    '.wx .wxin .hin{position:absolute;inset:0}',
    '.wx .wxin .bd{position:absolute;line-height:0;font-size:300px;left:-41px;top:-42px;filter:drop-shadow(0 10px 40px rgba(0,10,30,.25))}',
    '.wx .wxin .bd svg{display:block}',
    // (a white symbol -- a cloud, the moon, snow -- behind white digits: eased back)
    '.wx .wxin .hero.pale .bd{opacity:.7}',
    '.wx .wxin .glow{position:absolute;left:-151px;top:-146px;width:520px;height:520px;border-radius:50%;',
    '  background:radial-gradient(circle,rgba(255,214,10,.28),rgba(255,214,10,0) 62%)}',
    '.wx[night] .wxin .glow{background:radial-gradient(circle,rgba(220,230,255,.16),rgba(220,230,255,0) 62%)}',
    '.wx .wxin .tp{position:absolute;left:73px;bottom:96px;font-size:210px;font-weight:200;letter-spacing:-9px;line-height:.8;white-space:nowrap;',
    '  text-shadow:0 0 2px rgba(0,10,30,.35),0 6px 30px rgba(0,10,30,.55),0 2px 8px rgba(0,10,30,.3)}',
    '.wx .wxin .hl{position:absolute;left:79px;bottom:46px;font-size:24px;font-weight:600;opacity:.95;white-space:nowrap}',
    '.wx .wxin .bar{position:absolute;left:79px;bottom:16px;width:300px;height:8px;border-radius:4px;background:rgba(255,255,255,.22)}',
    '.wx .wxin .bar i{position:absolute;inset:0;border-radius:4px;background:linear-gradient(90deg,#64d2ff,#ffd60a,#ff9f0a)}',
    '.wx .wxin .bar b{position:absolute;top:-4px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(0,0,0,.25);margin-left:-8px}',
    // THE READINGS: one grid per row, right-aligned values and a leader
    // sized to the space between its own label and value.
    '.wx .wxin .read{width:560px;flex:none}',
    '.wx .wxin .eye{font-size:15px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.75}',
    '.wx .wxin .h2{font-size:52px;font-weight:700;letter-spacing:-1.2px;line-height:1.05;margin:6px 0 4px}',
    '.wx .wxin .lede{font-size:21px;font-weight:500;line-height:1.35;opacity:.92;margin-bottom:26px}',
    '.wx .wxin .lede em{font-style:normal;font-weight:600}',
    '.wx .wxin .stats{display:grid;grid-template-columns:1fr;row-gap:20px;column-gap:12px}',
    '.wx .wxin .st{display:grid;grid-column:1/-1;grid-template-columns:12px auto minmax(24px,1fr) auto;column-gap:12px;align-items:center}',
    '.wx .wxin .st i{width:12px;height:12px;border-radius:50%}',
    '.wx .wxin .st .k{font-size:15px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;opacity:.8}',
    '.wx .wxin .st .ln{grid-column:3;height:2px;border-radius:1px;margin:0 8px;min-width:24px;transform-origin:left center}',
    '.wx .wxin .st .v{grid-column:4;grid-row:1;font-size:40px;font-weight:700;letter-spacing:-1px;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.wx .wxin .st .v u{text-decoration:none;font-size:20px;font-weight:600;margin-left:6px;opacity:.8;letter-spacing:0}',
    '.wx .wxin .st .of{grid-column:1/-1;grid-row:2;text-align:right;font-size:15px;opacity:.72;margin-top:5px;white-space:nowrap}',
    '.wx .wxin .st i,.wx .wxin .st .k,.wx .wxin .st .ln{grid-row:1}',
    // ALONG THE BOTTOM: the next hours, the coming days
    '.wx .wxin .foot{position:absolute;left:44px;right:44px;bottom:26px;display:flex;justify-content:space-between;gap:40px;align-items:flex-start;',
    '  border-top:1px solid rgba(255,255,255,.2);padding-top:16px}',
    '.wx .wxin .foot:empty{display:none}',
    '.wx .wxin .fg .gh{font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.92;margin-bottom:10px}',
    '.wx .wxin .fg .its{display:flex;gap:30px;align-items:flex-start}',
    '.wx .wxin .fg.mo{margin-left:auto;padding-left:40px;border-left:1px solid rgba(255,255,255,.2)}',
    '.wx .wxin .fg.mo:first-child{margin-left:0;padding-left:0;border-left:0}',
    '.wx .wxin .fg .k{font-size:13px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.75;white-space:nowrap}',
    '.wx .wxin .fg .v{font-size:30px;font-weight:700;letter-spacing:-.6px;margin-top:4px;white-space:nowrap;display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}',
    '.wx .wxin .fg .v .gl{font-size:28px;line-height:0}',
    '.wx .wxin .fg .v small{font-size:20px;font-weight:600;opacity:.65;letter-spacing:0}',
    // NARROW LANDSCAPE: stack at a tablet's height instead of shrinking
    // the full landscape design to its remaining width.
    '.wx[narrow] .wxin .wxbody{flex-direction:column;gap:20px;top:122px;bottom:var(--bot,140px)}',
    '.wx[narrow] .wxin .hero{width:350px;height:250px}',
    '.wx[narrow] .wxin .bd{font-size:220px;left:-20px;top:-20px}',
    '.wx[narrow] .wxin .tp{font-size:160px;left:86px;bottom:65px;letter-spacing:-7px}',
    '.wx[narrow] .wxin .hl{font-size:17px;left:35px;right:0;bottom:27px;text-align:center}',
    '.wx[narrow] .wxin .bar{left:60px;bottom:6px;width:260px;height:5px}',
    '.wx[narrow] .wxin .bar b{width:12px;height:12px;top:-3px;margin-left:-6px}',
    '.wx[narrow] .wxin .read{width:624px}',
    '.wx[narrow] .wxin .eye,.wx[narrow] .wxin .h2,.wx[narrow] .wxin .lede{text-align:center}',
    '.wx[narrow] .wxin .eye{font-size:12px;letter-spacing:1px}',
    '.wx[narrow] .wxin .h2{font-size:32px;letter-spacing:-.8px}',
    '.wx[narrow] .wxin .lede{font-size:17px;margin-bottom:10px}',
    '.wx[narrow] .wxin .stats{row-gap:6px}',
    '.wx[narrow] .wxin .st .k{font-size:14px}',
    '.wx[narrow] .wxin .st .v{font-size:32px}',
    '.wx[narrow] .wxin .st .v u{font-size:18px}',
    '.wx[narrow] .wxin .st .of{font-size:12px;margin-top:3px;white-space:normal}',
    '.wx[narrow] .wxin .foot{gap:16px}',
    '.wx[narrow] .wxin .fg .its{gap:8px}',
    '.wx[narrow] .wxin .fg.mo .its{gap:12px}',
    '.wx[narrow] .wxin .fg.mo{padding-left:16px}',
    '.wx[narrow] .wxin .fg .v{font-size:25px}',
    '.wx[narrow] .wxin .fg .v small{font-size:17px}',
    '.wx[narrow] .wxin .fg .v .gl{font-size:24px}',
    '.wx[narrow] .wxin .fg.mo .its>div:nth-child(n+3){display:none}',
    // TALL (a portrait screen): the temperature above the readings
    '.wx[tall] .wxin .wxbody{flex-direction:column;gap:40px;top:170px}',
    '.wx[tall] .wxin .foot{flex-direction:column;gap:18px}',
    '.wx[tall] .wxin .fg.mo{margin-left:0;padding-left:0;border-left:0}',
    // An overlay in the clock's header band. Alert presence never changes
    // the weather layout, scale, or ink balancing. The tint stays visible
    // through the expiration time at the right edge.
    '.wx .wxalert{display:none;position:absolute;z-index:2;left:var(--alert-left,300px);right:var(--alert-right,240px);',
    '  top:var(--alert-y,34px);height:var(--alert-height,94px);box-sizing:border-box;padding:10px 14px;',
    '  border-left:3px solid var(--alert);background:linear-gradient(90deg,var(--alert-wash-start) 0%,var(--alert-wash-mid) 62%,var(--alert-wash-end) 100%);',
    '  grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:center}',
    '.wx[alert] .wxalert{display:grid}',
    '.wx .wxalert .ai{font-size:22px;color:var(--alert);line-height:1}',
    '.wx .wxalert .ab{min-width:0}',
    '.wx .wxalert .as{font-size:10px;line-height:1.2;letter-spacing:.7px;font-weight:600;color:var(--alert);margin-bottom:4px;',
    '  padding-right:var(--alert-meta-width,145px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wx .wxalert .at{font-size:21px;font-weight:700;letter-spacing:-.3px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wx .wxalert .ad{font-size:13px;line-height:1.3;opacity:.9;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.wx .wxalert .ar{position:absolute;top:10px;right:14px;display:flex;gap:9px;align-items:center}',
    '.wx .wxalert .au{font-size:11px;font-weight:600;white-space:nowrap}',
    '.wx .wxalert .am{font-size:10px;opacity:.75;white-space:nowrap}',
    // THE SYMBOL MOVES (2026-10-14, the owner's ask), each layer as its
    // weather does: the sun's rays turn and it breathes, clouds drift (the
    // whole symbol: a sun or moon is cut around its cloud, so the cloud can
    // never move alone), rain and snow fall, a bolt flickers, stars twinkle,
    // fog and wind slide. Only while it is on screen (paused otherwise), not
    // with Reduce Motion or with the sky's Animations off ([still]), and
    // never while balance() measures it (.calm).
    (window.hkHeader && window.hkHeader.wxMotionCss ? window.hkHeader.wxMotionCss('.wx .bd') : ''),
    '.wx:not(.on) .bd *,.wx:not(.on) .bd svg{animation-play-state:paused!important}',
    '.wx[still] .bd *,.wx[still] .bd svg,.wx .bd.calm *,.wx .bd.calm svg{animation:none!important}',
    '@media (prefers-reduced-motion: reduce){.wx .bd *,.wx .bd svg{animation:none!important}}'
  ].join('\n');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // (a missing value stays missing: Number(null) is 0, a bearing of north)
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function reduced() { return !!(((window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches))); }
  function tz() { return window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined; }
  function HD() { return window.hkHeader || null; }
  function glyph(cond, size, night, sym) { var H = HD(); return H && H.wxSvg ? H.wxSvg(cond, size, { night: !!night, sym: !!sym }) : ''; }
  function condName(c) {
    var H = HD();
    if (H && H.conditionName) return H.conditionName(c);
    return String(c || '').replace(/-/g, ' ').replace(/\b\w/g, function (x) { return x.toUpperCase(); });
  }
  // Keep the hour and AM/PM together with the same visible spacing.
  function hourOf(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: tz() }).replace(/\s+(?=[AP]M$)/, '\u00a0'); }
  function dayOf(t) { return new Date(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz() }); }
  function longDayOf(t) { return new Date(t).toLocaleDateString('en-US', { weekday: 'long', timeZone: tz() }); }
  var DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  function dirOf(b) { b = num(b); return b == null ? '' : DIRS[Math.round(((b % 360) + 360) % 360 / 45) % 8]; }
  var WET = /rain|pour|snow|hail|lightning/;

  // THE WEATHER'S WORDS AND NUMBERS, from the entity and its forecast:
  // pure, so tests drive it with any weather (window.hkSaverWeather._.view)
  function view(w, hourly, daily, now, hide, unitWind) {
    var off = {};
    (hide || []).forEach(function (k) { off[k] = true; });
    var a = w.attributes || {}, cond = w.state, t = num(a.temperature);
    var night = /night/.test(cond) || !!(HD() && HD().isNight && hd.states && HD().isNight(hd.states));
    var today = (daily || [])[0] || {}, hi = num(today.temperature), lo = num(today.templow);
    if (hi != null && t != null) hi = Math.max(hi, t);
    if (lo != null && t != null) lo = Math.min(lo, t);
    var snow = /snow/.test(cond);
    // The current condition is the fallback when no upcoming change is known.
    var head = cond === 'clear-night' ? 'Clear Tonight' : condName(cond);
    // THE LINE IN WORDS: wet now, until when it dries; wet coming, when;
    // else the day's high, and tonight's low
    var hrs = (hourly || []).filter(function (h) { return h && +new Date(h.datetime) >= now - 36e5; }).slice(0, 18);
    var dryHour = function (h) { return !!h.condition && !WET.test(h.condition) && (num(h.precipitation_probability) == null || num(h.precipitation_probability) < 30); };
    var prob = function (h) { var p = num(h.precipitation_probability); return p == null ? (WET.test(h.condition || '') ? 80 : 0) : Math.max(0, Math.min(100, p)); };
    var lede = '';
    // the first hour ahead that's wet (likely, or a wet condition)
    var wet = hrs.filter(function (h) { return +new Date(h.datetime) > now && (prob(h) >= 50 || WET.test(h.condition || '')); })[0];
    if (WET.test(cond)) {
      var dry = hrs.filter(function (h) { return +new Date(h.datetime) > now && dryHour(h); })[0];
      lede = (snow ? 'Snow' : 'Rain') + (dry ? ' until about <em>' + esc(hourOf(dry.datetime)) + '</em>, then drying out.' : ' through the day.');
    } else {
      if (wet) lede = (/snow/.test(wet.condition || '') ? 'Snow' : 'Rain') + ' likely around <em>' + esc(hourOf(wet.datetime)) + '</em>.';
      else if (hi != null && !night) {
        var peak = hrs.filter(function (h) { return +new Date(h.datetime) > now && num(h.temperature) != null; })
          .reduce(function (b, h) { return !b || num(h.temperature) > num(b.temperature) ? h : b; }, null);
        lede = 'A high of <em>' + Math.round(hi) + '°</em>' + (peak && num(peak.temperature) >= hi - 1 ? ' around ' + esc(hourOf(peak.datetime)) : '') + '.';
      }
    }
    if (lo != null) lede += (lede ? ' ' : '') + (night ? 'Down to ' : 'Tonight, ') + Math.round(lo) + '°' + (night ? ' by dawn.' : '.');
    // Put the next useful change in the headline. The condition already
    // lives under the temperature; retain it only when no change is known.
    var future = hrs.filter(function (h) { return +new Date(h.datetime) > now; });
    var wsNow = num(a.wind_speed), factor = /km|kph/.test(unitWind || a.wind_speed_unit || '') ? 1.609 : /m\/s/.test(unitWind || a.wind_speed_unit || '') ? 0.447 : /kn/.test(unitWind || a.wind_speed_unit || '') ? 0.869 : 1;
    var windy = wsNow == null ? null : future.filter(function (h) { return num(h.wind_speed) != null && num(h.wind_speed) >= Math.max(15 * factor, wsNow + 8 * factor); })[0];
    var support = [];
    if (WET.test(cond) && dry) {
      head = 'Drying out around ' + hourOf(dry.datetime);
      lede = lo != null ? (night ? 'Down to ' : 'Tonight, ') + Math.round(lo) + '°' + (night ? ' by dawn.' : '.') : '';
    } else if (!WET.test(cond) && wet) {
      head = (/snow/.test(wet.condition || '') ? 'Snow' : 'Rain') + ' around ' + hourOf(wet.datetime);
      var laterDry = future.filter(function (h) { return +new Date(h.datetime) > +new Date(wet.datetime) && dryHour(h); })[0];
      if (laterDry) support.push('Drier after ' + esc(hourOf(laterDry.datetime)) + '.');
      lede = lo != null ? 'Tonight, ' + Math.round(lo) + '°.' : '';
    } else if (windy) head = 'Wind picks up around ' + hourOf(windy.datetime);
    else if (!WET.test(cond) && t != null) {
      var cooler = future.filter(function (h) { return num(h.temperature) != null && num(h.temperature) <= t - (/C/.test(a.temperature_unit || '') ? 3 : 6); })[0];
      if (cooler) head = 'Cooling down around ' + hourOf(cooler.datetime);
    }
    if (windy && head.indexOf('Wind') !== 0) support.unshift('Wind picks up around ' + esc(hourOf(windy.datetime)) + '.');
    if (support.length) lede = support.join(' ') + (lede ? ' ' + lede : '');
    var stats = [];
    if (t != null) stats.push(['temp', 'Temperature', Math.round(t) + '°', hi != null && lo != null ? 'High ' + Math.round(hi) + '° · Low ' + Math.round(lo) + '°' : condName(cond)]);
    if (!off.rain) {
      var pToday = hrs.length ? Math.max.apply(null, hrs.slice(0, 12).map(prob)) : num(today.precipitation_probability);
      var nextWet = (daily || []).slice(1).filter(function (d) { return (num(d.precipitation_probability) || 0) >= 40 || WET.test(d.condition || ''); })[0];
      var of = WET.test(cond) ? (num(today.precipitation) ? today.precipitation + ' ' + esc(a.precipitation_unit || 'in') + ' today' : (dry ? 'Easing around ' + esc(hourOf(dry.datetime)) : 'Through the day'))
        : pToday >= 30 ? 'Most likely ' + (wet ? 'around ' + esc(hourOf(wet.datetime)) : 'later today')
        : nextWet ? 'Dry until ' + longDayOf(nextWet.datetime) : 'Dry for the days ahead';
      if (pToday != null) stats.push(['rain', snow ? 'Snow' : 'Rain', Math.round(pToday) + '<u>%</u>', of]);
    }
    if (!off.wind) {
      var ws = num(a.wind_speed), gust = num(a.wind_gust_speed), dir = dirOf(a.wind_bearing);
      if (ws != null) stats.push(['wind', 'Wind', Math.round(ws) + '<u>' + esc(unitWind || a.wind_speed_unit || 'mph') + '</u>',
        ws < 3 ? 'Calm' + (dir ? ', from the ' + dir : '') : (dir ? 'From the ' + dir : 'Steady') + (gust != null && gust > ws + 2 ? ', gusts ' + Math.round(gust) : '')]);
    }
    var hours = off.hours ? [] : hrs.filter(function (h) { return +new Date(h.datetime) > now; }).slice(0, 5);
    var days = off.days ? [] : (daily || []).slice(1, 4);
    var showPop = !off.rain && hours.some(function (h) { return num(h.precipitation_probability) >= 20 || WET.test(h.condition || ''); });
    return { showPop: showPop, cond: cond, night: night, t: t, hi: hi, lo: lo, head: head, lede: lede, stats: stats, hours: hours, days: days };
  }
  // Keep the source's wording, prioritize severity, and never retain an
  // expired/cancelled alert just because the sensor has not updated yet.
  function alertEnd(a) {
    var ends = Date.parse(a.Ends || ''), expires = Date.parse(a.Expires || '');
    var end = Math.min(isFinite(ends) ? ends : Infinity, isFinite(expires) ? expires : Infinity);
    return isFinite(end) ? end : null;
  }
  function alertsOf(st, now) {
    if (!st || /^(unknown|unavailable)$/i.test(st.state || '') || num(st.state) === 0) return [];
    var rows = st.attributes && st.attributes.Alerts;
    if (!Array.isArray(rows)) rows = [];
    var rank = { extreme: 0, severe: 1, moderate: 2, minor: 3, unknown: 4 };
    return rows.filter(function (a) {
      if (!a || typeof a !== 'object' || /cancel/i.test(a.MessageType || '') || /^(test|exercise|draft|system)$/i.test(a.Status || '')) return false;
      var end = alertEnd(a), effective = Date.parse(a.Effective || '');
      return (end == null || end > now) && (!isFinite(effective) || effective <= now);
    }).map(function (a) {
      var severity = String(a.Severity || 'Unknown'), title = String(a.Event || a.Headline || 'Weather Alert');
      var instruction = String(a.Instruction || '').trim(), headline = String(a.Headline || '').trim();
      var brief = (instruction || (headline !== title ? headline : '')).replace(/\s+/g, ' ').trim();
      var sentence = brief.match(/^.*?[.!?](?:\s|$)/);
      if (sentence) brief = sentence[0].trim();
      if (brief.length > 140) brief = brief.slice(0, 137).replace(/\s+\S*$/, '') + '…';
      return { title: title, severity: severity, rank: rank[severity.toLowerCase()] == null ? 4 : rank[severity.toLowerCase()],
        end: alertEnd(a),
        brief: brief || 'See the full NWS alert for details.', headline: headline,
        description: String(a.Description || ''), instruction: instruction, source: String(a.SenderName || 'National Weather Service') };
    }).sort(function (a, b) { return a.rank - b.rank || (a.end || Infinity) - (b.end || Infinity); });
  }
  function alertTime(end, now, h24) {
    if (end == null) return 'Active alert';
    var d = new Date(end), z = tz(), opts = { hour: 'numeric', minute: '2-digit', hour12: !h24, timeZone: z };
    if (d.toLocaleDateString('en-US', { timeZone: z }) !== new Date(now).toLocaleDateString('en-US', { timeZone: z })) opts.weekday = 'short';
    return 'Until ' + d.toLocaleTimeString('en-US', opts);
  }
  var hd = { states: null };

  function create(opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'wx';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<style>' + CSS + '</style><div class="wxsky"></div><div class="wxwash"></div><div class="wxin">' +
      '<div class="wxcorner"><div class="wxt"></div><div class="wxd"></div><div class="wxfresh"></div></div><div class="wxalert"></div><div class="wxbody"></div><div class="foot"></div></div>';
    var inn = el.querySelector('.wxin');
    var layoutW = 0, layoutH = 0, alerts = [], alertSig = '', dialog = null;
    var alive = true, showing = false, hass = null, sig = '', drawnAt = 0, redrawT = null, clockT = null, scene = null;
    var hide = Array.isArray(opts.hide) ? opts.hide.slice() : [], h24 = !!opts.h24;
    var fc = {}, fcAt = {}, subs = {}, refused = {}, conn = null, onReady = null;

    function wid() {
      var HS = window.hkSettings, st = hass && hass.states;
      return st && HS && HS.weatherId ? HS.weatherId(st) : null;
    }
    // THE FORECAST: Configure -> Weather's forecast sensor, else the
    // weather entity's own subscription (as the forecast band has it)
    function forecast(kind) {
      var HS = window.hkSettings, sensor = HS && HS.get ? HS.get('weather.forecast_' + kind, null) : null;
      if (sensor) return ((hass.states[sensor] || {}).attributes || {}).forecast || [];
      var id = wid(), key = kind + '|' + id, c = hass && hass.connection;
      if (id && c && alive && !subs[key] && !(refused[key] && Date.now() < refused[key])) {
        if (!onReady && typeof c.addEventListener === 'function') {
          conn = c;
          onReady = function () { subs = {}; soon(); };       // Home Assistant restarted: ask again
          c.addEventListener('ready', onReady);
        }
        subs[key] = c.subscribeMessage(function (ev) { fc[key] = (ev && ev.forecast) || []; fcAt[key] = Date.now(); soon(); },
          { type: 'weather/subscribe_forecast', forecast_type: kind, entity_id: id }, { resubscribe: false })
          .catch(function () { delete subs[key]; refused[key] = Date.now() + 5 * 60e3; return null; });
      }
      return fc[key] || [];
    }
    function weather() { var id = wid(); return id && hass.states[id] ? hass.states[id] : null; }
    function tick() {
      var now = new Date(), z = tz();
      var t = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !h24, timeZone: z }).split(' ');
      var th = esc(t[0]) + (t[1] ? '<small>' + esc(t[1]) + '</small>' : '');
      var tEl = inn.querySelector('.wxt'), dEl = inn.querySelector('.wxd');
      if (tEl.innerHTML !== th) tEl.innerHTML = th;
      var d = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: z });
      if (dEl.textContent !== d) dEl.textContent = d;
      freshness();
      updateAlerts();
      align();
      placeAlert();
    }
    function freshness() {
      var now = Date.now(), w = weather(), delayed = [];
      if (!w || /^(unavailable|unknown)$/.test(w.state) || num((w.attributes || {}).temperature) == null) {
        inn.querySelector('.wxfresh').textContent = 'Weather unavailable · showing last readings';
        return;
      }
      function consider(label, entity, threshold, receipt) {
        var at = receipt || Date.parse(entity && (entity.last_reported || entity.last_updated) || '');
        if (isFinite(at) && at > 0 && now - at > threshold) delayed.push({ label: label, at: at });
      }
      consider('Weather', w, 90 * 6e4);
      ['hourly', 'daily'].forEach(function (kind) {
        if (hide.indexOf(kind === 'hourly' ? 'hours' : 'days') >= 0) return;
        var HS = window.hkSettings, id = HS && HS.get && HS.get('weather.forecast_' + kind, null);
        consider(kind === 'hourly' ? 'Hourly forecast' : 'Daily forecast', id && hass && hass.states[id], (kind === 'hourly' ? 6 : 24) * 36e5, id ? null : fcAt[kind + '|' + wid()]);
      });
      delayed.sort(function (a,b) { return a.at - b.at; });
      var d = delayed[0];
      inn.querySelector('.wxfresh').textContent = d ? '◷ ' + d.label + ' · updated ' + Math.floor((now - d.at) / 6e4) + ' min ago' : '';
    }
    function readAlerts() {
      var HS = window.hkSettings, id = HS && HS.get && HS.get('weather.alerts', null);
      return alertsOf(id && hass && hass.states && hass.states[id], Date.now());
    }
    function updateAlerts() {
      alerts = readAlerts();
      var a = alerts[0], now = Date.now(), key = JSON.stringify([alerts, a && alertTime(a.end, now, h24)]);
      if (key === alertSig) return;
      alertSig = key;
      var banner = inn.querySelector('.wxalert');
      if (!a) { el.removeAttribute('alert'); banner.innerHTML = ''; }
      else {
        el.setAttribute('alert', '');
        el.style.setProperty('--alert', a.rank <= 1 ? '#ff786d' : a.rank === 2 ? '#ffbd66' : '#ffe082');
        var rgb = a.rank <= 1 ? '185,49,43' : a.rank === 2 ? '190,115,20' : '175,145,25';
        el.style.setProperty('--alert-wash-start', 'rgba(' + rgb + ',.24)');
        el.style.setProperty('--alert-wash-mid', 'rgba(' + rgb + ',.17)');
        el.style.setProperty('--alert-wash-end', 'rgba(' + rgb + ',.12)');
        banner.innerHTML = '<div class="ai" aria-hidden="true">⚠</div><div class="ab"><div class="as">NWS · ' + esc(a.severity.toUpperCase()) +
          '</div><div class="at">' + esc(a.title) + '</div><div class="ad">' + esc(a.brief) +
          '</div></div><div class="ar"><div class="au">' + esc(alertTime(a.end, now, h24)) +
          '</div><div class="am">' + (alerts.length > 1 ? '+' + (alerts.length - 1) + ' more · ' : '') + 'Details ›</div></div>';
      }
      if (layoutW && layoutH) layout(layoutW, layoutH);
    }
    function hitAlert(x, y) {
      if (!showing || !alerts.length || x == null || y == null) return false;
      var r = inn.querySelector('.wxalert').getBoundingClientRect();
      return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    function openAlerts() {
      var list = readAlerts();
      if (!list.length) return false;
      var existing = document.querySelector('dialog.hk-nws');
      if (existing) existing.close();
      var d = document.createElement('dialog'); dialog = d;
      d.setAttribute('aria-labelledby', 'hk-nws-title');
      d.innerHTML = '<style>.hk-nws{color:#f5f7fc;background:#142238;border:1px solid #ffffff30;border-radius:20px;padding:26px;width:min(760px,90vw);max-height:85vh;overflow:auto;font-family:' + FONT + ';box-sizing:border-box}' +
        '.hk-nws::backdrop{background:rgba(0,0,0,.65)}.hk-nws header{display:flex;align-items:center;gap:20px}.hk-nws h2{font-size:24px;margin:0;flex:1}' +
        '.hk-nws button{font:inherit;color:inherit;background:rgba(255,255,255,.1);border:1px solid #ffffff30;border-radius:20px;padding:9px 18px;cursor:pointer}' +
        '.hk-nws article{border-top:1px solid #ffffff30;margin-top:22px;padding-top:18px}.hk-nws h3{font-size:22px;margin:0 0 8px}.hk-nws h4{font-size:16px;margin-bottom:8px}' +
        '.hk-nws p{font-size:16px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.hk-nws .meta{font-size:14px;opacity:.75}</style>' +
        '<header><h2 id="hk-nws-title">Weather Alerts</h2><button type="button" autofocus>Close</button></header>' + list.map(function (a) {
          return '<article><h3>' + esc(a.title) + '</h3><p class="meta">' + esc(a.severity + ' · ' + alertTime(a.end, Date.now(), h24) + ' · ' + a.source) + '</p>' +
            (a.headline ? '<p>' + esc(a.headline) + '</p>' : '') + (a.description ? '<p>' + esc(a.description) + '</p>' : '') +
            (a.instruction ? '<h4>NWS Instructions</h4><p>' + esc(a.instruction) + '</p>' : '') + '</article>';
        }).join('');
      d.className = 'hk-nws';
      d.querySelector('button').addEventListener('click', function () { d.close(); });
      var holdKey = 'hk-weather-alert-' + Date.now();
      d.addEventListener('close', function () {
        d.remove(); if (dialog === d) dialog = null;
        if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold(holdKey, false);
      });
      document.body.appendChild(d); d.showModal();
      if (window.hkIdle && window.hkIdle.hold) window.hkIdle.hold(holdKey, true);
      return true;
    }
    function soon() {
      if (!alive || !showing || redrawT) return;
      redrawT = setTimeout(function () { redrawT = null; if (alive && showing) paint(false); }, Math.max(0, REDRAW_MS - (Date.now() - drawnAt)));
    }
    function paint(fresh) {
      updateAlerts();
      var w = weather();
      freshness();
      if (!w || /^(unavailable|unknown)$/.test(w.state)) return false;
      hd.states = hass.states;
      var v = view(w, forecast('hourly'), forecast('daily'), Date.now(), hide);
      freshness();
      if (v.t == null) return false;
      drawnAt = Date.now();
      var key = JSON.stringify(v);
      if (key === sig && !fresh) return true;
      sig = key;
      if (v.night) el.setAttribute('night', ''); else el.removeAttribute('night');
      // the symbol holds still with the sky's Animations off
      var HSk = window.hkSettings, moves = !(HSk && HSk.skyLook && HSk.skyLook().animations === false);
      if (moves) el.removeAttribute('still'); else el.setAttribute('still', '');
      var span = v.hi != null && v.lo != null ? Math.max(1, v.hi - v.lo) : 0;
      var glowy = /^(sunny|clear-night|partlycloudy)$/.test(v.cond);
      var hero = '<div class="hero' + (v.cond === 'sunny' ? '' : ' pale') + '"><div class="hin">' + (glowy ? '<div class="glow"></div>' : '') +
        '<div class="bd">' + glyph(v.cond, '1em', v.night, true) + '</div><div class="tp">' + Math.round(v.t) + '°</div>' +
        '<div class="hl">' + esc(condName(v.cond)) + (span ? ' · H ' + Math.round(v.hi) + '° L ' + Math.round(v.lo) + '°' : '') + '</div>' +
        (span ? '<div class="bar"><i></i><b style="left:' + (100 * (v.t - v.lo) / span).toFixed(2) + '%"></b></div>' : '') + '</div></div>';
      // (Configure -> Weather's place label, as the forecast band shows it)
      var place = window.hkSettings && window.hkSettings.get ? window.hkSettings.get('weather.place', null) : null;
      var stats = v.stats.map(function (s) {
        return '<div class="st"><i style="background:' + COL[s[0]] + '"></i><span class="k">' + esc(s[1]) + '</span>' +
          '<span class="ln" style="background:linear-gradient(90deg,' + COL[s[0]] + ',' + COL[s[0]] + '40)"></span>' +
          '<span class="v">' + s[2] + '</span><span class="of">' + s[3] + '</span></div>';
      }).join('');
      inn.querySelector('.wxbody').innerHTML = hero + '<div class="read"><div class="eye">' + (place ? esc(place) : 'Weather') + '</div>' +
        '<div class="h2">' + esc(v.head) + '</div><div class="lede">' + v.lede + '</div><div class="stats">' + stats + '</div></div>';
      var hours = v.hours.map(function (h) {
        var n = /night/.test(h.condition || '') || h.is_daytime === false;
        return '<div><div class="k">' + esc(hourOf(h.datetime)) + '</div><div class="v"><span class="gl">' + glyph(h.condition, '1em', n) + '</span>' +
          (num(h.temperature) != null ? Math.round(h.temperature) + '°' : '—') + '</div>' +
          (v.showPop ? '<div class="pop">' + (num(h.precipitation_probability) == null ? '—' : Math.round(Math.max(0, Math.min(100, num(h.precipitation_probability)))) + '%') + '</div>' : '') + '</div>';
      }).join('');
      var days = v.days.map(function (d) {
        return '<div><div class="k">' + esc(dayOf(d.datetime)) + '</div><div class="v"><span class="gl">' + glyph(d.condition === 'clear-night' ? 'sunny' : d.condition, '1em', false) + '</span>' +
          (num(d.temperature) != null ? Math.round(d.temperature) + '°' : '—') + (num(d.templow) != null ? '<small>' + Math.round(d.templow) + '°</small>' : '') + '</div></div>';
      }).join('');
      inn.querySelector('.foot').innerHTML = (hours ? '<div class="fg"><div class="gh">Next Hours</div><div class="its">' + hours + '</div></div>' : '') +
        (days ? '<div class="fg mo"><div class="gh">Coming Days</div><div class="its">' + days + '</div></div>' : '');
      if (layoutW && layoutH) layout(layoutW, layoutH); else balance();
      if (fresh) hold(true);
      return true;
    }
    // AS MUCH ROOM LEFT OF THE SYMBOL AS RIGHT OF THE NUMBER (before the
    // readings), measured on what is DRAWN -- the symbol's paths, the
    // number's ink: a 1 is narrow, a cloud with a sun wide -- the pair slides
    // to even them (the user, 2026-10-14)
    function balance() {
      var hin = inn.querySelector('.hin'), tp = inn.querySelector('.tp'), rd = inn.querySelector('.read');
      if (!hin || !tp || !rd || el.hasAttribute('tall')) { if (hin) hin.style.transform = ''; return; }
      hin.style.transform = '';
      var box = inn.getBoundingClientRect(), k = box.width / Math.max(1, inn.offsetWidth), L = 1e9;
      if (!k || !box.width) return;
      // (measured at rest: a turning ray or a drifting cloud would move the edge)
      var bd = inn.querySelector('.bd');
      if (bd) bd.classList.add('calm');
      inn.querySelectorAll('.bd svg path').forEach(function (p) { var b = p.getBoundingClientRect(); if (b.width) L = Math.min(L, b.left); });
      if (bd) bd.classList.remove('calm');
      if (L === 1e9) return;
      var cs = getComputedStyle(tp), cv = document.createElement('canvas').getContext('2d');
      cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      if ('letterSpacing' in cv) cv.letterSpacing = cs.letterSpacing;
      var m = cv.measureText(tp.textContent), R = tp.getBoundingClientRect().left + m.actualBoundingBoxRight * k;
      var narrow = el.hasAttribute('narrow'), hero = inn.querySelector('.hero').getBoundingClientRect();
      var left = (L - (narrow ? hero.left : box.left)) / k;
      var right = ((narrow ? hero.right : rd.getBoundingClientRect().left) - R) / k;
      hin.style.transform = 'translateX(' + ((right - left) / 2).toFixed(1) + 'px)';
    }
    // the time's and the date's first ink on one line (Home Energy's)
    var inkC = null;
    function align() {
      [inn.querySelector('.wxt'), inn.querySelector('.wxd')].forEach(function (n) {
        var txt = (n && n.textContent || '').trim();
        if (!txt) return;
        try {
          inkC = inkC || document.createElement('canvas');
          var ctx = inkC.getContext('2d'), cs = getComputedStyle(n);
          ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          var m = ctx.measureText(txt.charAt(0));
          if (typeof m.actualBoundingBoxLeft === 'number') n.style.marginLeft = (Math.round(m.actualBoundingBoxLeft * 10) / 10) + 'px';
        } catch (e) { /* as it is */ }
      });
    }
    // BEFORE IT HAS ARRIVED: the lines and the bar's dot at nothing (Reduce Motion: finished)
    function hold(on) {
      if (reduced()) return;
      inn.querySelectorAll('.st .ln').forEach(function (l) { if (on) l.style.transform = 'scaleX(0)'; else l.style.removeProperty('transform'); });
      inn.querySelectorAll('.bar b').forEach(function (b) { if (on) b.style.opacity = '0'; else b.style.removeProperty('opacity'); });
    }
    function arrived() {
      if (!alive || !showing) return;
      hold(false);
      if (reduced()) return;
      var D = window.hkCards && window.hkCards.DUR, Ez = window.hkCards && window.hkCards.EASE;
      var dur = (D && parseFloat(D.ring) * 1000) || 850, ease = (Ez && Ez.build) || 'cubic-bezier(.22,.8,.25,1)';
      inn.querySelectorAll('.st .ln').forEach(function (l) {
        if (l.animate) l.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: dur, easing: ease, fill: 'backwards' });
      });
      inn.querySelectorAll('.bar b').forEach(function (b) {
        if (b.animate) b.animate([{ left: '0px', opacity: 0 }, { left: b.style.left, opacity: 1 }], { duration: dur, easing: ease, fill: 'backwards' });
      });
    }
    function layout(w, h) {
      if (!w || !h) return;
      layoutW = w; layoutH = h;
      var tall = h > w * 1.05, narrow = !tall && w < 1000;
      if (tall) el.setAttribute('tall', ''); else el.removeAttribute('tall');
      if (narrow) el.setAttribute('narrow', ''); else el.removeAttribute('narrow');
      var z = narrow ? Math.min(w / 880, h / H0) : tall ? Math.min(w / 800, h / 1280) : Math.min(w / W0, h / H0);
      for (var i = 0; i < (narrow ? 4 : 1); i++) {
        z = Math.max(0.4, Math.min(z, 2.5));
        el.style.setProperty('--z', z.toFixed(3));
        if (!narrow) break;
        var hero = inn.querySelector('.hero'), read = inn.querySelector('.read'), foot = inn.querySelector('.foot');
        if (!hero || !read) break;
        var bot = foot.getBoundingClientRect().height / z + 50;
        inn.style.setProperty('--bot', bot.toFixed(1) + 'px');
        var a = hero.getBoundingClientRect(), b = read.getBoundingClientRect();
        var need = a.height + b.height + 20 * z;
        var needW = Math.max(a.width, b.width);
        var fit = Math.min((h - (122 + bot) * z) / Math.max(1, need), (w - 60 * z) / Math.max(1, needW));
        if (fit >= 0.995 || !needW) break;
        z *= fit * 0.98;
      }
      if (showing) { balance(); align(); }
      placeAlert();
    }
    function placeAlert() {
      if (!el.hasAttribute('alert')) return;
      var box = inn.getBoundingClientRect(), corner = inn.querySelector('.wxcorner').getBoundingClientRect();
      var z = box.width / Math.max(1, inn.offsetWidth);
      if (!z || !box.width) return;
      var left = Math.max(300, (corner.right - box.left) / z + 16), right = 44;
      var top = (corner.top - box.top) / z, height = corner.height / z;
      // Full-width Home Status can be longer than 'Disarmed'. Reserve the
      // visible text, rather than its deliberately wide alignment box.
      if (!el.hasAttribute('narrow') && !el.hasAttribute('tall') && el.getRootNode && document.createRange) {
        var root = el.getRootNode(), card = root.querySelector('hk-screensaver-status-card');
        var status = card && card.shadowRoot && card.shadowRoot.querySelector('.sscorner');
        if (status) status.querySelectorAll('div').forEach(function (n) {
          if (n.children.length || !n.textContent.trim()) return;
          var range = document.createRange(); range.selectNodeContents(n);
          var r = range.getBoundingClientRect(), parent = n.getBoundingClientRect();
          if (r.width && r.bottom > corner.top && r.top < corner.bottom) {
            var first = Math.max(r.left, parent.left);
            right = Math.max(right, (box.right - first) / z + 16);
          }
        });
      }
      // A phone preview has no spare header column. Overlay below the clock
      // there, still without moving or scaling the weather composition.
      if (el.hasAttribute('tall') || box.width / z - left - right < 320) {
        left = 44; right = 44; top = (corner.bottom - box.top) / z + 16;
      }
      var banner = inn.querySelector('.wxalert');
      banner.style.setProperty('--alert-left', left.toFixed(1) + 'px');
      banner.style.setProperty('--alert-right', right.toFixed(1) + 'px');
      banner.style.setProperty('--alert-y', top.toFixed(1) + 'px');
      banner.style.setProperty('--alert-height', height.toFixed(1) + 'px');
      var meta = banner.querySelector('.ar');
      if (meta) banner.style.setProperty('--alert-meta-width', (meta.getBoundingClientRect().width / z + 8).toFixed(1) + 'px');
    }
    function sky(run) {
      if (!scene && window.hkSky && window.hkSky.scene) {
        try { scene = window.hkSky.scene(el.querySelector('.wxsky'), { skyOnly: true }); } catch (e) { scene = null; }
      }
      if (!scene) return;
      if (run && hass) { try { scene.update(hass); } catch (e) { /* the next update */ } }
      try { scene.pause(!run); } catch (e) { /* gone */ }
    }
    return {
      el: el,
      // a weather to show (and its forecast asked for, and its sky readied)
      ready: function (h) {
        if (h) hass = h;
        var w = hass && weather();
        if (!w || num((w.attributes || {}).temperature) == null) return false;
        forecast('hourly'); forecast('daily');
        sky(false);
        return true;
      },
      draw: function (h) {
        if (h) hass = h;
        showing = true;
        sky(true);
        tick();
        if (!clockT) clockT = setInterval(function () { if (alive && showing) tick(); }, 10000);
        sig = '';
        return paint(true);
      },
      arrived: arrived,
      hitAlert: hitAlert,
      openAlerts: openAlerts,
      setHass: function (h) { hass = h; if (showing) { updateAlerts(); soon(); } },
      setHide: function (list) { hide = Array.isArray(list) ? list.slice() : []; sig = ''; },
      layout: layout,
      leave: function () {
        showing = false;
        if (redrawT) { clearTimeout(redrawT); redrawT = null; }
        if (clockT) { clearInterval(clockT); clockT = null; }
        sky(false);
      },
      showing: function () { return showing; },
      destroy: function () {
        alive = false; showing = false;
        // The details dialog owns its close/idle-hold lifecycle: waking
        // tears down this controller, while the reader keeps it open.
        if (redrawT) { clearTimeout(redrawT); redrawT = null; }
        if (clockT) { clearInterval(clockT); clockT = null; }
        Object.keys(subs).forEach(function (k) { Promise.resolve(subs[k]).then(function (u) { if (typeof u === 'function') u(); }); });
        subs = {};
        if (conn && onReady && typeof conn.removeEventListener === 'function') conn.removeEventListener('ready', onReady);
        if (scene) { try { scene.destroy(); } catch (e) { /* gone */ } scene = null; }
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  window.hkSaverWeather = { create: create, PARTS: PARTS.slice(), _: { view: view, dirOf: dirOf, alertsOf: alertsOf, alertTime: alertTime } };
})();
