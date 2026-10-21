// hk-header.js -- the wall header's CLOCK and WEATHER blocks, as one source.
//
// WHY THIS EXISTS
// The clock and the weather appear on several surfaces -- the wall header, the
// phone's weather strip, a car dashboard's top bar, the screensaver -- and
// separate copies drift: matching their TYPE fixes appearance, not drift. So
// the string BUILDERS live here, once, and the hk-weather.js cards call them.
//
// THE WALL HEADER MUST NOT CHANGE BY ACCIDENT. `row()` is its markup and is
// kept byte-stable; a change to it is checked as an innerHTML diff against a
// capture taken before the change, not by eye.
//
// LOAD ORDER IS LOAD-BEARING. This is a bootstrap module (registered in
// custom_components/hk_frontend/__init__.py), NOT a
// hk-loader.js MODULES entry, for the same reason hk-icons.js is: the header is
// the first thing painted, and a module that arrives after first render would
// give every tablet a blank header for a beat on every page load. Changing the
// bootstrap list in __init__.py needs a Home Assistant restart.
//
// IF THIS FILE FAILS TO LOAD the header, the phone's weather strip and the
// car top bar all render empty. That is a real dependency and it is the price
// of one copy instead of several. Every caller checks and falls back to a plain
// text line rather than throwing, so a failure is legible rather than a red
// card with no message.
(function () {
  'use strict';

  if (window.hkHeader) return;

  // THE ENTITIES COME FROM THE INTEGRATION (hk-settings.js), not from here.
  // Read at call time, so an edit in Configure reaches the next render. A page
  // without hk-settings (a test harness) gets the same empty defaults.
  function S() { return window.hkSettings; }
  function setting(path, fallback) {
    var s = S();
    return s ? s.get(path, fallback) : fallback;
  }

  // ------------------------------------------------------ WEATHER GLYPHS
  // The condition glyphs are drawn in Apple's MULTICOLOR style -- a yellow
  // sun, white cloud, cyan rain -- from the SF Symbols the Weather app draws.
  // mdi's are single-color outlines in a different drawing style from every
  // hk: glyph.
  //
  // THEY ARE NOT IN THIS FILE. SF Symbols cannot ship with the integration, so
  // the drawings come from the home's own glyph file: the `weather` section of
  // iconset/hk-glyphs.js in its files folder, built on a Mac by
  // tools/sf_symbols/build_glyphs.py and loaded by hk-icons.js. Each is
  // [viewBox, [[role, d], ...]] -- the export's own layers, and a 120-unit
  // viewBox centered on the drawing, so a sun and a cloud keep the sizes SF
  // Symbols gives them relative to each other, as in the Weather app, rather
  // than each stretched to fill its box.
  //
  // WITHOUT THAT FILE, Material Design's weather icons stand in (WX_MDI below),
  // drawn by <hk-icon> from the host's Material icon set, so nothing ships
  // here either. When the file arrives after a card has drawn, hk-icons.js
  // announces it (hk-module-ready) and every card redraws with the real glyph.
  //
  // COLORS are Apple's DARK-appearance system colors, because every surface
  // these draw on is dark glass: systemYellow #FFD60A, systemCyan #64D2FF.
  // (Flat's Light theme, 2026-10-16, is the one pale surface: there the white
  // layers -- clouds, the moon -- and the cyan read too faint, so they are
  // CSS variables its palette sets, white and cyan everywhere else.)
  var WX_COLOUR = { w: 'var(--hk-wx-w,#FFFFFF)', y: '#FFD60A', c: 'var(--hk-wx-c,#64D2FF)' };
  function wxData(name) {
    var g = window.hkGlyphs, w = g && g.weather;
    return (w && w[name]) || null;
  }
  // True once the home's weather glyphs are here: part of the "has anything
  // changed" key of a caller that keeps its own (hk-menu's clock block).
  function wxReady() { return !!(window.hkGlyphs && window.hkGlyphs.weather); }

  // The stand-ins, keyed by the SF symbol each replaces: [mdi name, color].
  var WX_MDI = {
    'sun.max.fill':                  ['weather-sunny', 'y'],
    'moon.stars.fill':               ['weather-night', 'w'],
    'cloud.sun.fill':                ['weather-partly-cloudy', 'w'],
    'cloud.moon.fill':               ['weather-night-partly-cloudy', 'w'],
    'cloud.fill':                    ['weather-cloudy', 'w'],
    'cloud.fog.fill':                ['weather-fog', 'w'],
    'cloud.hail.fill':               ['weather-hail', 'w'],
    'cloud.bolt.fill':               ['weather-lightning', 'w'],
    'cloud.bolt.rain.fill':          ['weather-lightning-rainy', 'w'],
    'cloud.heavyrain.fill':          ['weather-pouring', 'w'],
    'cloud.rain.fill':               ['weather-rainy', 'w'],
    'cloud.moon.rain.fill':          ['weather-rainy', 'w'],
    'cloud.snow.fill':               ['weather-snowy', 'w'],
    'cloud.sleet.fill':              ['weather-snowy-rainy', 'w'],
    'wind':                          ['weather-windy', 'w'],
    'exclamationmark.triangle.fill': ['alert', 'y']
  };

  // HA condition -> [day, night] symbol. Apple draws a moon for a clear or
  // partly cloudy night; HA only says so itself for `clear-night`, so a caller
  // that knows it is night (sun.sun below the horizon, or an hourly entry with
  // is_daytime false) passes { night: true }.
  var WX_MAP = {
    'sunny':           ['sun.max.fill', 'moon.stars.fill'],
    'clear-night':     ['moon.stars.fill', 'moon.stars.fill'],
    'partlycloudy':    ['cloud.sun.fill', 'cloud.moon.fill'],
    'cloudy':          ['cloud.fill', 'cloud.fill'],
    'fog':             ['cloud.fog.fill', 'cloud.fog.fill'],
    'hail':            ['cloud.hail.fill', 'cloud.hail.fill'],
    'lightning':       ['cloud.bolt.fill', 'cloud.bolt.fill'],
    'lightning-rainy': ['cloud.bolt.rain.fill', 'cloud.bolt.rain.fill'],
    'pouring':         ['cloud.heavyrain.fill', 'cloud.heavyrain.fill'],
    'rainy':           ['cloud.rain.fill', 'cloud.moon.rain.fill'],
    'snowy':           ['cloud.snow.fill', 'cloud.snow.fill'],
    'snowy-rainy':     ['cloud.sleet.fill', 'cloud.sleet.fill'],
    'windy':           ['wind', 'wind'],
    'windy-variant':   ['wind', 'wind'],
    'exceptional':     ['exclamationmark.triangle.fill', 'exclamationmark.triangle.fill']
  };

  function wxSymbol(state, night) {
    var row = WX_MAP[String(state || '').toLowerCase()] || WX_MAP.partlycloudy;
    return row[night ? 1 : 0];
  }

  // How the condition READS. titleCase('partlycloudy') is "Partlycloudy" --
  // HA's condition ids are not words, and printed as-is they look broken.
  // Apple's wording where it has one.
  var WX_NAME = {
    'sunny': 'Sunny', 'clear-night': 'Clear', 'partlycloudy': 'Partly Cloudy',
    'cloudy': 'Cloudy', 'fog': 'Foggy', 'hail': 'Hail', 'lightning': 'Thunderstorms',
    'lightning-rainy': 'Thunderstorms', 'pouring': 'Heavy Rain', 'rainy': 'Rain',
    'snowy': 'Snow', 'snowy-rainy': 'Sleet', 'windy': 'Windy',
    'windy-variant': 'Windy', 'exceptional': 'Severe Weather'
  };
  // Text going INTO HTML (these builders return markup). A weather state is
  // normally one of a fixed set, but an unknown one is title-cased through
  // as-is, and a provider's string is not ours to trust.
  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function conditionName(state) {
    var k = String(state || '').toLowerCase();
    return WX_NAME[k] || titleCase(k.replace(/-/g, ' '));
  }

  // Inline SVG, not <hk-icon>: an iconset path is ONE color (two at most, via
  // secondaryPath), and the point of these is the multicolor. Inline also means
  // nothing to resolve -- no custom-iconset lookup, so none of the icon element's
  // sticky-blank first render (a miss at first render is cached for good).
  // The Material stand-in IS an <hk-icon>, but of a built-in mdi: name, which
  // has no such race.
  //   o.night   the night glyph where Apple has one
  //   o.style   extra inline CSS on the <svg> (margins, filter)
  //   o.sym     name the symbol on it (data-sym), so a caller's CSS can move
  //             its layers (the screensaver's Weather, 2026-10-14)
  function wxSvg(state, px, o) {
    o = o || {};
    var name = wxSymbol(state, o.night);
    var sym = wxData(name);
    var size = typeof px === 'number' ? px + 'px' : String(px);
    if (!sym) {
      var m = WX_MDI[name] || WX_MDI['cloud.sun.fill'];
      return '<hk-icon class="hk-wx"' + (o.sym ? ' data-sym="mdi"' : '') + ' icon="mdi:' + m[0] + '" role="img" aria-label="' +
        esc(conditionName(state)) + '" style="display:inline-flex; flex:0 0 auto;' +
        ' align-items:center; justify-content:center; vertical-align:middle; width:' + size +
        '; height:' + size + '; --mdc-icon-size:' + size + '; color:' + WX_COLOUR[m[1]] + ';' +
        (o.style || '') + '"></hk-icon>';
    }
    var paths = sym[1].map(function (l) {
      // `></path>`, NOT `/>`. In HTML the parser keeps a self-closed <path/>
      // but innerHTML SERIALIZES it back as <path ...></path>, so a card that
      // skips a redraw only when its new markup equals innerHTML would, with
      // `/>`, never match -- and rebuild itself on every state update, ~10
      // times a second, flickering. The header card does not compare against
      // innerHTML; this keeps any caller that does honest.
      // (a style, not the fill attribute: an attribute can't hold var())
      return '<path style="fill:' + (WX_COLOUR[l[0]] || WX_COLOUR.w) + '" d="' + l[1] + '"></path>';
    }).join('');
    return '<svg class="hk-wx"' + (o.sym ? ' data-sym="' + esc(name) + '"' : '') + ' viewBox="' + sym[0] + '" role="img" aria-label="' +
      esc(conditionName(state)) + '" style="display:inline-block; flex:0 0 auto;' +
      ' vertical-align:middle; overflow:visible; width:' + size + '; height:' + size + ';' +
      (o.style || '') + '">' + paths + '</svg>';
  }

  // Shared layer motion for the screensaver and dashboard's large backdrop.
  // Callers own placement and pause/still state; the condition paths move alike.
  function wxMotionCss(selector) {
    return [
    '.wx .bd svg path{transform-box:fill-box;transform-origin:50% 50%}',
    '.wx .bd svg[data-sym="sun.max.fill"] path:first-child{animation:wxspin 70s linear infinite}',
    // (the moon behind a cloud breathes as the sun does: before 2026-10-17 a
    // partly cloudy night only drifted, a few pixels on the Weather page)
    '.wx .bd svg[data-sym="sun.max.fill"] path:last-child,.wx .bd svg[data-sym="cloud.sun.fill"] path:first-child,' +
    '.wx .bd svg[data-sym="cloud.moon.fill"] path:first-child{animation:wxbreathe 5s ease-in-out infinite alternate}',
    '.wx .bd svg[data-sym^="cloud."]{animation:wxdrift 11s ease-in-out infinite alternate}',
    '.wx .bd svg[data-sym="cloud.rain.fill"] path:not(:last-child),.wx .bd svg[data-sym="cloud.heavyrain.fill"] path:not(:last-child),' +
    '.wx .bd svg[data-sym="cloud.moon.rain.fill"] path:nth-child(-n+4),.wx .bd svg[data-sym="cloud.hail.fill"] path:not(:last-child),' +
    '.wx .bd svg[data-sym="cloud.sleet.fill"] path:not(:last-child),.wx .bd svg[data-sym="cloud.bolt.rain.fill"] path:not(:last-child):not(:nth-child(3))' +
    '{animation:wxfall 1.5s linear infinite}',
    '.wx .bd svg[data-sym="cloud.snow.fill"] path:not(:last-child){animation:wxsnow 3.6s linear infinite}',
    '.wx .bd svg path:nth-child(2){animation-delay:-.45s}.wx .bd svg path:nth-child(3){animation-delay:-.9s}',
    '.wx .bd svg path:nth-child(4){animation-delay:-.2s}.wx .bd svg path:nth-child(5){animation-delay:-1.1s}.wx .bd svg path:nth-child(6){animation-delay:-.65s}',
    '.wx .bd svg[data-sym="cloud.snow.fill"] path:nth-child(2){animation-delay:-1.4s}.wx .bd svg[data-sym="cloud.snow.fill"] path:nth-child(3){animation-delay:-2.7s}',
    '.wx .bd svg[data-sym="cloud.snow.fill"] path:nth-child(4){animation-delay:-.7s}.wx .bd svg[data-sym="cloud.snow.fill"] path:nth-child(5){animation-delay:-3.1s}',
    '.wx .bd svg[data-sym="cloud.snow.fill"] path:nth-child(6){animation-delay:-2s}',
    '.wx .bd svg[data-sym="cloud.bolt.fill"] path:first-child,.wx .bd svg[data-sym="cloud.bolt.rain.fill"] path:nth-child(3){animation:wxflash 5s linear infinite}',
    // (moon.stars.fill draws its stars first, the moon last)
    '.wx .bd svg[data-sym="moon.stars.fill"] path:first-child{animation:wxtwinkle 3.2s ease-in-out infinite alternate}',
    '.wx .bd svg[data-sym="moon.stars.fill"] path:last-child{animation:wxbreathe 6s ease-in-out infinite alternate}',
    '.wx .bd svg[data-sym="cloud.fog.fill"] path:not(:last-child),.wx .bd svg[data-sym="wind"] path{animation:wxslide 4s ease-in-out infinite alternate}',
    '.wx .bd svg[data-sym="cloud.fog.fill"] path:nth-child(2),.wx .bd svg[data-sym="wind"] path:nth-child(2){animation-delay:-2s}',
    '.wx .bd svg[data-sym="wind"] path:nth-child(3){animation-delay:-1s}',
    '.wx .bd [data-sym="mdi"]{animation:wxfloat 6s ease-in-out infinite alternate}',
    '@keyframes wxspin{to{transform:rotate(360deg)}}',
    '@keyframes wxbreathe{from{transform:scale(1)}to{transform:scale(1.045)}}',
    '@keyframes wxdrift{from{transform:translateX(-2.2%)}to{transform:translateX(2.2%)}}',
    '@keyframes wxfall{0%{transform:translateY(-7px);opacity:0}20%{opacity:1}75%{opacity:1}100%{transform:translateY(9px);opacity:0}}',
    '@keyframes wxsnow{0%{transform:translate(0,-6px);opacity:0}20%{opacity:1}50%{transform:translate(2px,1px)}80%{opacity:1}100%{transform:translate(-1px,8px);opacity:0}}',
    '@keyframes wxflash{0%,84%,89%,93%,100%{opacity:1}86%{opacity:.2}91%{opacity:.4}}',
    '@keyframes wxtwinkle{from{opacity:.35}to{opacity:1}}',
    '@keyframes wxslide{from{transform:translateX(-5px)}to{transform:translateX(5px)}}',
    '@keyframes wxfloat{from{transform:translateY(-1.5%)}to{transform:translateY(1.5%)}}'
    ].join('\n').split('.wx .bd').join(selector) +
      '@media (prefers-reduced-motion: reduce){' + selector + ' *,' + selector + ' svg{animation:none!important}}';
  }

  // Night for the CURRENT condition. sun.sun is the only honest source; a
  // clock-hour guess draws a sun at 8 PM in June.
  function isNight(states) {
    var sun = states && states['sun.sun'];
    return !!sun && sun.state === 'below_horizon';
  }

  // Night for a FORECAST time. OpenWeatherMap's hourly entries carry no
  // is_daytime and call 3 AM "sunny", so the hour is placed against sun.sun's
  // next setting and rising instead. Both repeat daily to within a couple of
  // minutes across a 24-hour forecast, so: an instant is night when it falls
  // in the window that starts at a sunset and ends at the following sunrise,
  // measured modulo a day. That one test works whether it is day or night now.
  // `t` is the hour's START; the half-hour is added so an hour that is mostly
  // dark draws the moon.
  var DAY = 86400000;
  function nightAt(states, t) {
    var a = ((states && states['sun.sun']) || {}).attributes || {};
    var set = Date.parse(a.next_setting), rise = Date.parse(a.next_rising);
    if (!isFinite(set) || !isFinite(rise)) return false;
    var mid = (t instanceof Date ? t.getTime() : Date.parse(t)) + 1800000;
    if (!isFinite(mid)) return false;
    var mod = function (x) { return ((x % DAY) + DAY) % DAY; };
    return mod(mid - set) < mod(rise - set);
  }

  function titleCase(value) {
    if (!value) return '';
    return String(value).replace(/_/g, ' ').split(' ')
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
      .join(' ');
  }

  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
  // the house's locale (hk-client.js); an en-US house is the screens' original wording
  function LC() { return window.hkLocale || null; }
  function usEnglish() { return !LC() || LC().tag() === 'en-US'; }

  // The Time & Date sensors when chosen and present, else this screen's
  // own clock -- same 'HH:MM' / 'YYYY-MM-DD' strings either way -- as the
  // 12-hour time, AM/PM and the day. clock() and now() both read it.
  function clockParts(states) {
    var ck = S() ? S().clock(states)
      : { time: (states['sensor.time'] || {}).state, date: (states['sensor.date'] || {}).state };
    var t = ck.time, time = '--:--', ampm = '', day = null;
    if (t && t.indexOf(':') !== -1) {
      var parts = t.split(':');
      var hh = parseInt(parts[0], 10);
      ampm = hh >= 12 ? 'PM' : 'AM';
      if (LC() && LC().is24()) {       // a 24-hour locale (or the person's choice): 13:05, no AM / PM
        ampm = '';
        time = (hh < 10 ? '0' : '') + hh + ':' + parts[1];
      } else {
        var h = hh % 12; h = h ? h : 12;
        time = h + ':' + parts[1];
      }
    }
    var ds = ck.date;
    if (ds && ds.indexOf('-') !== -1) {
      var p = ds.split('-').map(function (n) { return parseInt(n, 10); });
      day = new Date(p[0], p[1] - 1, p[2]);
    }
    return { time: time, ampm: ampm, day: day };
  }

  // ------------------------------------------------------------- CLOCK
  // `12:34` + `AM`, then the long date. The sizes default to the wall
  // header's; a car dashboard passes its own because its top bar fits four
  // blocks into ~1200px where the wall fits three into 1280.
  function clock(states, o) {
    o = o || {};
    var timeSize = o.timeSize || '72px';
    var ampmSize = o.ampmSize || '26px';
    var dateSize = o.dateSize || '21px';
    var fg = o.fg || 'var(--hk-ink, rgba(255,255,255,0.94))';
    var fgDim = o.fgDim || 'var(--hk-ink-2, rgba(255,255,255,0.68))';
    var dateFg = o.dateFg || 'var(--hk-ink-2, rgba(255,255,255,0.68))';
    var dateGap = o.dateGap || '8px';
    // Defaults are the wall header's. A car dashboard scales the sizes and nudges
    // the tracking with them; anything not passed stays the wall's value, so
    // `row()` below is unaffected by their existence.
    var timeLs = o.timeLs || '0.12px';
    // timeShift: how far the time's first STROKE sits right of the date's, in
    // px, measured by clockShift() below on the rendered card. Pulled back with
    // a negative margin so the three lines share one left edge.
    var shift = Number(o.timeShift) || 0;
    var shiftCss = shift ? ' margin-left:' + (-shift).toFixed(1) + 'px;' : '';
    // The screensaver is read from across a room and needs a heavier stack;
    // `lineHeight` and `gap` come with the size rather than being derived,
    // because at 150px the header's 0.92/10px are visibly wrong.
    var timeLh = o.timeLh || '0.92';
    var gap = o.gap || '10px';
    // THE ELLIPSIS CLIP IS THE HEADER'S, NOT THE SCREENSAVER'S.
    //
    // In the header this line is nowrap + overflow:hidden so a long date
    // truncates, and its shadow is a `filter` on an ancestor -- a filter
    // applies AFTER the children clip, so the shadow escapes.
    //
    // On the screensaver the shadow is a TEXT-SHADOW inherited from
    // WallPanel's info box, painted per element and clipped by that element's
    // own overflow. With the clip on, the info box's 68px blur comes out as a
    // hard gray band round the line. The screensaver has 600px of width and
    // nothing to truncate, so it passes `clip: false`.
    //
    // The trap: an ellipsis needs overflow:hidden, and overflow:hidden clips
    // the element's own text-shadow.
    var clipCss = (o.clip === false) ? ''
      : ' white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;';
    var ampmLs = o.ampmLs || '0.22px';
    var dateLs = o.dateLs || '-0.36px';

    var ck = clockParts(states);
    var timeText = ck.time, ampm = ck.ampm;

    var dateText = '';
    if (ck.day) {
      var dt = ck.day;
      var local = { timeZone: 'local' };      // dt is a calendar day made from its own fields
      var weekday = usEnglish() ? dt.toLocaleString('en-US', { weekday: 'long' }) : LC().dateTime(dt, Object.assign({ weekday: 'long' }, local));
      var month = usEnglish() ? dt.toLocaleString('en-US', { month: 'long' }) : LC().dateTime(dt, Object.assign({ month: 'long' }, local));
      var day = dt.getDate();
      var suffix = function (n) {
        if (n >= 11 && n <= 13) return 'th';
        switch (n % 10) {
          case 1: return 'st';
          case 2: return 'nd';
          case 3: return 'rd';
          default: return 'th';
        }
      };
      // `date_format` -- the screensaver says "September, 13th" and the
      // header says "Sunday, September 13th". Two formats, one function, so
      // the suffix logic exists once.
      if (!usEnglish()) {
        // the locale's own order and words (the English "13th" is only the US wording)
        dateText = LC().date(dt, o.dateFormat === 'monthday' ? { month: 'long', day: 'numeric', timeZone: 'local' }
                                                              : { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'local' });
      } else dateText = o.dateFormat === 'monthday'
        ? (month + ', ' + day + suffix(day))
        : (weekday + ', ' + month + ' ' + day + suffix(day));
    }

    // THE 3px PADDINGS ARE NOT SPACING. Every line here is
    // `white-space:nowrap; overflow:hidden; text-overflow:ellipsis` -- the
    // ellipsis needs the overflow:hidden -- and with no padding the ink begins
    // at EXACTLY the clipping box edge, which lands on a fractional device
    // pixel and shaves the first antialiased column off the S of "Sunday".
    // Do not tidy them away.
    return '' +
      '<div data-hk-clock="clock" style="min-width:max-content; text-align:left;">\n' +
      '        <div style="display:flex; align-items:baseline; gap:' + gap + '; min-width:0; padding-left:3px;">\n' +
      '          <span data-hk-clock="time" style="font-size:' + timeSize + '; font-weight:600; line-height:' + timeLh + '; color:' + fg + '; letter-spacing:' + timeLs + '; font-variant-numeric:tabular-nums;' + shiftCss + '">' + timeText + '</span>\n' +
      '          <span style="font-size:' + ampmSize + '; letter-spacing:' + ampmLs + '; font-weight:500; line-height:1; color:' + fgDim + ';">' + ampm + '</span>\n' +
      '        </div>\n' +
      '        <div data-hk-clock="date" style="font-size:' + dateSize + '; letter-spacing:' + dateLs + '; font-weight:600; line-height:1.1; margin-top:' + dateGap + '; color:' + dateFg + ';' + clipCss + ' padding-left:3px;">\n' +
      '          ' + dateText + '\n' +
      '        </div>\n' +
      '      </div>';
  }

  // ----------------------------------------------------------- WEATHER
  // Glyph + `78° • Partly Cloudy` + `Feels 79° • 75% Humidity • 5 mph Wind`.
  //
  // ONE DATA SOURCE: the weather ENTITY's attributes, not a provider's own
  // sensors (`sensor.openweathermap_apparent_temperature` / `_humidity` /
  // `_wind_speed`). They are not two sources: MEASURED with OpenWeatherMap,
  // both come from the same config entry in the same update tick, the sensors
  // are the raw values and the attributes are the same values pre-rounded by
  // the integration, and after Math.round() the two produce the IDENTICAL
  // string --
  //
  //     entity  feels 79.0    hum 74  wind 4.61
  //     sensors feels 78.584  hum 74  wind 4.6080887
  //     both -> "Feels 79° • 74% Humidity • 5 mph Wind"
  //
  // Attributes, not the sensors, for two reasons that outlast any one
  // provider's values:
  //
  //   * `temperature` / `apparent_temperature` / `humidity` / `wind_speed` are
  //     the WEATHER PLATFORM's contract, not OpenWeatherMap's names. They are
  //     provider-neutral; hardcoding `sensor.openweathermap_*` into a shared
  //     module would tie every screen to one provider, and houses do change
  //     provider.
  //   * it drops three entity-id dependencies to none. An entity rename is a
  //     silent-breakage trap.
  //
  // COST, stated: `apparent_temperature` is an optional attribute of the
  // weather platform. If a future provider omits it the Feels line drops out
  // -- the `!== null` guard below already handles that without breaking the
  // rest. If gusts, dew point or UV are ever wanted on this strip they exist
  // ONLY as sensors, and that is the case for revisiting this.
  function weather(states, o) {
    o = o || {};
    var glyph = o.glyph || '50px';
    var mainSize = o.mainSize || '34px';
    var mainLs = o.mainLs || '0.39px';
    var detailSize = o.detailSize || '18px';
    var detailLs = o.detailLs || '-0.44px';
    var detailGap = o.detailGap || '6px';
    var gap = o.gap || '14px';
    var fg = o.fg || 'var(--hk-ink, rgba(255,255,255,0.94))';
    var fgDim = o.fgDim || 'var(--hk-ink-2, rgba(255,255,255,0.68))';
    // THESE THREE MUST EMIT NOTHING WHEN UNSET, and that is the whole contract
    // that keeps the wall header byte-identical: `row()` passes its own `o`
    // straight through to this function, so any key it sets would leak in here
    // and change the header's markup. They are named so `row`'s `shadow` and
    // `gap` cannot collide with them -- `selfShadow`, not `shadow`. The phone's
    // strip is a standalone card and needs its own width, box and shadow;
    // inside the header the wrapper already provides all three.
    var width = o.width ? ' width:' + o.width + ';' : '';
    var boxSizing = o.boxSizing ? ' box-sizing:' + o.boxSizing + ';' : '';
    var selfShadow = o.selfShadow ? ' filter:' + o.selfShadow + ';' : '';

    // o.entity: a weather entity of the caller's own (the strip card's
    // `entity`), else the one HK Settings chose
    var wid = (o.entity && states[o.entity]) ? o.entity : (S() ? S().weatherId(states) : null);
    var w = (wid && states[wid]) || {};
    var a = w.attributes || {};
    var temp = num(a.temperature);
    var outsideTemp = temp !== null ? Math.round(temp) + '\u00b0' : '--\u00b0';
    var condition = esc(w.state ? conditionName(w.state) : 'Weather');
    var night = isNight(states);

    var feels = num(a.apparent_temperature);
    var humidity = a.humidity;
    var wind = num(a.wind_speed);

    var bits = [];
    if (feels !== null) bits.push('Feels ' + Math.round(feels) + '°');
    if (humidity !== undefined && humidity !== null) bits.push(humidity + '% Humidity');
    if (wind !== null) {
      var wu = a.wind_speed_unit || window.hkLocale.units().speed;      // the weather entity's own unit
      bits.push(Math.round(wind) + ' ' + wu + ' Wind');
    }

    // INLINE is the SCREENSAVER's arrangement: temperature, glyph, condition,
    // all on one line at a size meant to be read across a room, with no detail
    // line under it. Built here so the fifteen-entry condition -> glyph map
    // exists once: with two maps, adding a condition means editing both and
    // nothing says so.
    if (o.variant === 'inline') {
      // font-size ON THE WRAPPER. Without it the temperature inherits the
      // screensaver info box's 15px while the condition beside it, which sets
      // its own size, stays at 36. Rendering the screensaver cards on a
      // standalone page is the only way to see that layout.
      return '' +
        '<span style="display:inline-flex; align-items:center; white-space:nowrap;' +
        ' font-size:' + mainSize + '; letter-spacing:' + mainLs + ';">\n' +
        '  <span style="font-weight:600; margin-right:' + (o.tempGap || '36px') +
        '; color:' + fg + ';">' + outsideTemp + (o.unit || '') + '</span>\n' +
        '  ' + wxSvg(w.state, glyph, { night: night, style:
        ' margin-right:' + (o.iconGap || '12px') +
        '; filter:drop-shadow(0px 0px 10px rgba(0,0,0,0.3));' }) + '\n' +
        '  <span style="font-weight:600; opacity:0.85; text-transform:capitalize;">' +
        condition + '</span>\n' +
        '</span>';
    }

    // THE HOOKS (data-hk-wx) are how a card fits this to its width without an
    // ellipsis -- see fitWeather() below. Each detail bit is its own span, its
    // separator inside it, so the last ones can go whole.
    var detail = bits.length ? bits.map(function (b, i) {
      return '<span data-hk-wx-bit>' + (i ? ' • ' : '') + b + '</span>';
    }).join('') : 'Current weather';
    return '' +
      '<div style="display:flex; align-items:center; justify-content:flex-start; gap:' + gap + '; min-width:0; text-align:left;' + width + boxSizing + selfShadow + '">\n' +
      '        ' + wxSvg(w.state, glyph, { night: night }) + '\n' +
      '        <div data-hk-wx="text" style="min-width:0; text-align:left;">\n' +
      '          <div data-hk-wx="main" style="font-size:' + mainSize + '; letter-spacing:' + mainLs + '; font-weight:600; line-height:1.02; color:' + fg + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\n' +
      '            ' + outsideTemp + ' • ' + condition + '\n' +
      '          </div>\n' +
      '          <div data-hk-wx="detail" style="font-size:' + detailSize + '; letter-spacing:' + detailLs + '; font-weight:600; line-height:1.1; margin-top:' + detailGap + '; color:' + fgDim + '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\n' +
      '            ' + detail + '\n' +
      '          </div>\n' +
      '        </div>\n' +
      '      </div>';
  }

  // ---------------------------------------------------------- SECURITY
  // The header's RIGHT block: up to three right-aligned lines summarizing the
  // house. In a module rather than as inline JS in a YAML string, where a
  // syntax error blanks the card to a message-less red with nothing to
  // bisect.
  //
  // RETURNS '' WHEN THERE IS NOTHING TO SAY. Not "Home Secured" -- that is the
  // ARMED-and-all-clear case. Empty means the alarm is not armed and nothing
  // is open, which is the ordinary daytime state, and the header shows no
  // right-hand block at all rather than a reassuring lie.
  // THE ENTITY LISTS, ONCE. `status()` is the whole security calculation and
  // the ONLY place these ids are read; `security()` below renders it, and a
  // car dashboard's top bar calls it through window.hkHeader so the two
  // surfaces cannot disagree about what "secure" means (separate copies
  // drift: one skips the window checks, another reads a different alarm
  // panel).
  // THE ENTITY LISTS are HK Settings -> Status & Chips (kinds.py, sent as `kinds`):
  // an alarm panel, and the locks, door and window contacts and garage doors
  // that "Home Secured" is made of. Read per call, so an edit applies at once.
  // `kinds` is the answer; security.* is the same answer from a server that
  // predates it (settings.py fills both).
  function kind(name, legacy) {
    var k = setting('kinds.' + name, null);
    return Array.isArray(k) ? k : setting('security.' + legacy, []);
  }
  function lists() {
    return {
      alarm: setting('security.alarm', null),
      garage: kind('garage', 'garage'),
      locks: kind('locks', 'locks'),
      doors: kind('doors', 'doors'),
      windows: kind('windows', 'windows')
    };
  }

  // MISSING IS NOT SAFE. Counting only the ALERT value -- 'unlocked', 'on' --
  // would count an entity that is absent, unknown or unavailable as zero, i.e.
  // as closed and locked, and an armed alarm with every contact sensor dead
  // would render the most reassuring string the header has: "Home Secured".
  //
  // So `unknown` is counted separately and blocks the secured headline. It is
  // safe to surface here precisely BECAUSE locks and door and window contacts
  // restore a real state across a restart (verified: every one held 'off' /
  // 'locked' through one). Do NOT copy this pattern onto leak sensors: those
  // are often sleepy battery Zigbee devices that legitimately sit at
  // `unknown` for days, and the same check there would cry wolf permanently.
  function status(states) {
    var st = function (id) { return (states[id] || {}).state; };
    var usable = function (v) {
      return v !== undefined && v !== null && v !== 'unknown' && v !== 'unavailable';
    };
    var unusable = 0;
    var countState = function (ids, want) {
      var n = 0;
      for (var i = 0; i < ids.length; i++) {
        var v = st(ids[i]);
        if (!usable(v)) { unusable++; continue; }
        if (v === want) n++;
      }
      return n;
    };

    var L = lists();
    var unlocked = countState(L.locks, 'unlocked');
    var openDoors = countState(L.doors, 'on');
    var openWindows = countState(L.windows, 'on');
    // A garage door is a binary_sensor ('on' = open) or a cover. A cover that
    // is moving is not shut, so 'opening' and 'closing' count as open: a door
    // halfway up must never let the line say "Home Secured".
    var garagesOpen = 0;
    for (var g = 0; g < L.garage.length; g++) {
      var gv = st(L.garage[g]);
      if (!usable(gv)) { unusable++; continue; }
      if (gv === 'on' || gv === 'open' || gv === 'opening' || gv === 'closing') garagesOpen++;
    }
    var garageOpen = garagesOpen > 0;

    // No alarm chosen is not an unknown sensor: it simply never arms, so the
    // line never says "Home Secured" and never counts a missing panel.
    var alarmRaw = L.alarm ? st(L.alarm) : undefined;
    if (L.alarm && !usable(alarmRaw)) unusable++;
    alarmRaw = alarmRaw || 'unknown';
    var alarmArmed = ['armed_home', 'armed_away', 'armed_night', 'armed_vacation']
      .indexOf(alarmRaw) !== -1;

    var items = [];
    if (alarmRaw === 'disarmed') items.push('Disarmed');
    if (unlocked > 0) items.push(unlocked + ' ' + (unlocked === 1 ? 'Lock' : 'Locks') + ' Unlocked');
    if (garagesOpen === 1) items.push('Garage Open');
    else if (garagesOpen > 1) items.push(garagesOpen + ' Garage Doors Open');
    if (openDoors > 0) items.push(openDoors + ' ' + (openDoors === 1 ? 'Door' : 'Doors') + ' Open');
    if (openWindows > 0) items.push(openWindows + ' ' + (openWindows === 1 ? 'Window' : 'Windows') + ' Open');
    // Listed LAST so a real open door still leads. It is a caveat on the rest
    // of the line, not the headline event.
    if (unusable > 0) {
      items.push(unusable + ' ' + (unusable === 1 ? 'Sensor' : 'Sensors') + ' Unknown');
    }

    return {
      alarmRaw: alarmRaw,
      alarmArmed: alarmArmed,
      unlocked: unlocked,
      garageOpen: garageOpen,
      openDoors: openDoors,
      openWindows: openWindows,
      unusable: unusable,
      items: items,
      // `!unusable` is what keeps a dead sensor from reading as secured.
      secured: alarmArmed && unusable === 0 && unlocked === 0 && !garageOpen &&
               openDoors === 0 && openWindows === 0,
      // True when something is wrong or unverifiable -- a car dashboard's icon tint
      // and "Check Home" headline both key off this.
      alert: unlocked > 0 || garageOpen || openDoors > 0 || openWindows > 0
    };
  }

  function security(states, o) {
    o = o || {};
    var line1Size = o.line1Size || '30px';
    var lineSize = o.lineSize || '21px';
    var fg = o.fg || 'var(--hk-ink, rgba(255,255,255,0.94))';
    var fgDim = o.fgDim || 'var(--hk-ink-2, rgba(255,255,255,0.68))';
    var pad = o.pad || '0px 0px 18px 24px';
    var minHeight = o.minHeight || '96px';
    // right (a corner) or left (the screensaver's calendar pane, with the
    // list under it)
    var align = o.align === 'left' ? 'left' : 'right';
    var shadow = o.shadow ||
      'var(--hk-glow, drop-shadow(0px 1px 3px rgba(0,0,0,0.30)) drop-shadow(0px 3px 12px rgba(0,0,0,0.28)) drop-shadow(0px 6px 26px rgba(0,0,0,0.30)))';

    var s = status(states);
    var items = s.items;
    var secured = s.secured;
    var l1 = secured ? 'Home Secured' : items.slice(0, 2).join(' • ');
    var l2 = items.slice(2, 4).join(' • ');
    var l3 = items.slice(4).join(' • ');
    if (!secured && !items.length) { return ''; }

    // THE 3px RIGHT PADDING IS NOT SPACING -- same story as the clock's left
    // padding. Every line is nowrap + overflow:hidden for the ellipsis, so
    // without it the ink sits flush against a clipping edge that lands on a
    // fractional device pixel and shaves the last antialiased column off the d
    // of "Disarmed".
    var line = function (text, size, colour, top) {
      return '<div style="font-size:' + size + '; letter-spacing:' +
        (size === line1Size ? '0.4px' : '-0.36px') + '; font-weight:600; line-height:' +
        (size === line1Size ? '1.08' : '1.16') + ';' +
        (top ? ' margin-top:' + top + ';' : '') + ' color:' + colour +
        '; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:3px;">' +
        text + '</div>';
    };

    return '\n' +
      '    <div style="width:100%; min-height:' + minHeight + '; box-sizing:border-box; padding:' +
      pad + '; text-align:' + align + '; overflow:hidden; filter:' + shadow + ';">\n' +
      '      ' + line(l1, line1Size, fg, null) + '\n' +
      '      ' + (l2 ? line(l2, lineSize, fgDim, '6px') : '') + '\n' +
      '      ' + (l3 ? line(l3, lineSize, fgDim, '4px') : '') + '\n' +
      '    </div>\n' +
      '  ';
  }

  // --------------------------------------------------------------- ROW
  // THE WALL HEADER'S LEFT BLOCK, EXACTLY. Clock and weather side by side
  // under ONE drop-shadow.
  //
  // `filter: drop-shadow()` and NOT `text-shadow`, and the filter is on THIS
  // wrapper and nowhere inside it. text-shadow is painted per element and
  // clipped by that element's own overflow, so a 34px blur on a 23px line box
  // comes out as a hard-edged band. A filter applies after the element and its
  // descendants have rendered and clipped. Nothing inside may carry its own or
  // it doubles -- the weather glyph included. The wrapper
  // must also have NO background, or you get a shadow of the BOX.
  function row(states, o) {
    o = o || {};
    var gap = o.gap || '34px';
    var shadow = o.shadow ||
      'var(--hk-glow, drop-shadow(0px 1px 3px rgba(0,0,0,0.30)) drop-shadow(0px 3px 12px rgba(0,0,0,0.28)) drop-shadow(0px 6px 26px rgba(0,0,0,0.30)))';
    return '\n' +
      '    <div style="\n' +
      '      display:flex;\n' +
      '      align-items:flex-end;\n' +
      '      justify-content:flex-start;\n' +
      '      gap:' + gap + ';\n' +
      '      width:100%;\n' +
      '      min-width:0;\n' +
      '      text-align:left;\n' +
      '      box-sizing:border-box;\n' +
      '      filter:' + shadow + ';\n' +
      '    ">\n' +
      '      ' + clock(states, o) + '\n' +
      '      ' + weather(states, o) + '\n' +
      '    </div>\n' +
      '  ';
  }

  // ------------------------------------------------------- OPTICAL LEFT EDGE
  // The time, the date and the weather all START at the same x, but their INK
  // does not. At 150px a digit carries several px of side bearing, and the
  // time is tabular-nums (so AM/PM does not jump as digits change width), which
  // centers a narrow digit in a wide cell. Measured in SF Pro 600 on the
  // screensaver, where the time visibly sits right of the date:
  //
  //     first stroke from the left edge   date/weather 1px
  //     time "7:16"  9.2px   "1x:xx" 18.4px   "4:xx" 5.0px
  //
  // So it depends on the hour, and a fixed nudge would be wrong for most of
  // them. clockShift() measures the first glyph of each line with its real
  // computed font: canvas for the ink, two DOM spans for the tabular centering
  // (canvas has no font-variant-numeric). Returns null while the font is still
  // loading, so the caller can try again rather than bake in a fallback face.
  var inkCache = {};
  // IS THE FACE THE TEXT ASKS FOR IN? A measurement taken with the fallback
  // face is right for the fallback and ~17 px wrong for SF Pro -- and it was
  // kept: the clock sat off the date's edge until its next redraw, up to a
  // minute (2026-10-01). Such a measurement is used but not kept, and when a
  // font finishes loading (below) everything is measured again.
  function faceIn(family) {
    var F = document.fonts;
    if (!F || typeof F.forEach !== 'function') return true;
    var name = bareFamily(String(family || '').split(',')[0]), any = false, ok = false;
    try {
      F.forEach(function (f) { if (bareFamily(f.family) === name) { any = true; if (f.status === 'loaded') ok = true; } });
    } catch (e) { return true; }
    return !any || ok;              // no face of that name: a system font, nothing to wait for
  }
  // A FONT FINISHED LOADING (SF Pro, after the first paint): measured again,
  // so each clock lines up with its date as soon as the face it is drawn in
  // is here. ONLY WHAT WAS MEASURED: a load counts when one of its faces is
  // a family some measured text names (its whole font-family list -- the
  // fallback draws it until the first face is in), and only the cards that
  // measured (clockShift's callers: the header and the clock) are redrawn,
  // once a frame however many loads land together. It was hk-module-ready,
  // which redrew every card, grid, chip and the menu at every font load.
  var inkFamilies = {};             // bare family name -> true, from firstInk
  var inkCards = [];                // the cards that called clockShift
  var fontWake = 0;
  function bareFamily(s) { return String(s || '').trim().replace(/^["']|["']$/g, '').toLowerCase(); }
  function measuredBy(root) {
    var host = root && (root.host || (root.getRootNode && root.getRootNode().host));
    if (!host || typeof host.requestUpdate !== 'function') return;
    inkCards = inkCards.filter(function (c) { return c.isConnected; });
    if (inkCards.indexOf(host) < 0) inkCards.push(host);
  }
  function fontsLoaded(e) {
    var faces = e && e.fontfaces;
    if (faces && faces.length && !Array.prototype.some.call(faces, function (f) {
      return inkFamilies[bareFamily(f && f.family)];
    })) return;                     // none of them is drawn in anything measured
    inkCache = {};
    if (fontWake || !inkCards.length) return;
    var go = function () {
      fontWake = 0;
      inkCards = inkCards.filter(function (c) { return c.isConnected; });
      inkCards.forEach(function (c) {
        try { c.requestUpdate(); } catch (x) { console.error('[hk-header] font wake', x); }
      });
    };
    fontWake = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(go) : setTimeout(go, 16);
  }
  try {
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fontsLoaded);
  } catch (e) { /* no font loading API */ }
  function firstInk(el) {
    var text = (el && el.textContent || '').replace(/^\s+/, '');
    if (!text) return 0;
    var ch = text.charAt(0), cs = getComputedStyle(el);
    var px = parseFloat(cs.fontSize) || 16;
    var font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + px + 'px ' + cs.fontFamily;
    var tab = /tabular-nums/.test(cs.fontVariantNumeric || '');
    var key = ch + '|' + font + '|' + tab;
    if (Object.prototype.hasOwnProperty.call(inkCache, key)) return inkCache[key];
    String(cs.fontFamily || '').split(',').forEach(function (f) { var b = bareFamily(f); if (b) inkFamilies[b] = true; });
    // Wait ONLY while fonts are actually still loading. check() is not a
    // reliable "is this face ready" on every engine -- Safari can return
    // false for a loaded face -- and a caller that retries on null after
    // fonts.ready would then redraw forever. Once the font set has settled,
    // whatever face is in use is the one the text is drawn in: measure that.
    var loaded = true;
    try { loaded = !document.fonts || !document.fonts.check || document.fonts.check(font, ch); }
    catch (e) { loaded = true; }              // a browser that cannot parse it: measure anyway
    if (!loaded && document.fonts && document.fonts.status === 'loading') return null;
    var size = Math.ceil(px * 2), c = document.createElement('canvas');
    c.width = size; c.height = size;
    var x = c.getContext && c.getContext('2d');
    if (!x) return 0;
    x.font = font; x.fillStyle = '#000'; x.textBaseline = 'alphabetic';
    var ox = Math.round(px * 0.5);
    x.fillText(ch, ox, Math.round(px * 1.5));
    var d = x.getImageData(0, 0, size, size).data, min = size;
    for (var yy = 0; yy < size; yy++) {
      for (var xx = 0; xx < min; xx++) {
        if (d[(yy * size + xx) * 4 + 3] > 40) { min = xx; break; }
      }
    }
    var ink = min === size ? 0 : (min - ox);
    if (tab) {
      var host = el.parentNode || el;
      var a = document.createElement('span'), b = document.createElement('span');
      var base = 'position:absolute;visibility:hidden;white-space:pre;font:' + font + ';';
      a.style.cssText = base + 'font-variant-numeric:tabular-nums;';
      b.style.cssText = base + 'font-variant-numeric:normal;';
      a.textContent = b.textContent = ch;
      host.appendChild(a); host.appendChild(b);
      ink += (a.getBoundingClientRect().width - b.getBoundingClientRect().width) / 2;
      host.removeChild(a); host.removeChild(b);
    }
    if (faceIn(cs.fontFamily)) inkCache[key] = ink;
    return ink;
  }
  // NEVER THROWS. Safari 27 can raise "SyntaxError: The string did not match
  // the expected pattern" from document.fonts.check() on a page's font
  // shorthand -- inside the header card's state-update entry, that turns the whole
  // header into an error card. Alignment is a nicety: on any failure the time
  // simply is not nudged.
  function clockShift(root) {
    try {
      measuredBy(root);
      var t = root && root.querySelector('[data-hk-clock="time"]');
      var d = root && root.querySelector('[data-hk-clock="date"]');
      if (!t || !d) return 0;
      var a = firstInk(t), b = firstInk(d);
      if (a === null || b === null) return null;
      return Math.round((a - b) * 2) / 2;     // half-px steps: no jitter from subpixel noise
    } catch (e) {
      return 0;
    }
  }

  // FIT THE WEATHER TO ITS WIDTH, NEVER AN ELLIPSIS. Between a phone and a
  // wall tablet -- an iPad mini held upright -- an ellipsis would squeeze the
  // header's weather to "7..." / "Fee...". What goes instead, in order:
  // the last detail bit (wind), the next (humidity), the detail line, and
  // last the whole text, leaving the glyph -- which is what the header has
  // always shown on a phone. `holder` is the element a card's CSS keys on:
  //   [data-wx-fit="glyph"]  text hidden
  //   [data-wx-fit="N"]      the detail line keeps its first N bits (0: none)
  // Measured, not guessed: each step is kept only if the line then fits.
  // Synchronous, so the steps never paint.
  var FIT_CSS = function (sel) {
    return sel + '[data-wx-fit="glyph"] [data-hk-wx="text"]{display:none}' +
           sel + '[data-wx-fit="0"] [data-hk-wx="detail"]{display:none}' +
           sel + '[data-wx-fit="1"] [data-hk-wx-bit]:nth-child(n+2){display:none}' +
           sel + '[data-wx-fit="2"] [data-hk-wx-bit]:nth-child(n+3){display:none}';
  };
  function fitWeather(holder) {
    if (!holder || !holder.querySelector) return;
    var text = holder.querySelector('[data-hk-wx="text"]');
    holder.removeAttribute('data-wx-fit');
    if (!text) return;
    var main = text.querySelector('[data-hk-wx="main"]');
    var detail = text.querySelector('[data-hk-wx="detail"]');
    var over = function (el) { return !!el && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1; };
    if (over(main) || (main && main.clientWidth === 0 && main.scrollWidth > 0)) {
      holder.setAttribute('data-wx-fit', 'glyph');
      return;
    }
    if (!over(detail)) return;
    var n = detail.querySelectorAll('[data-hk-wx-bit]').length;
    for (var k = Math.min(n - 1, 2); k >= 0; k--) {
      holder.setAttribute('data-wx-fit', String(k));
      if (k === 0 || !over(detail)) return;
    }
  }

  // THE MENU'S TIME AND WEATHER: when the menu is always shown
  // and "Time and weather in the menu" is on, the header's clock and weather
  // move to the top of it (modules/hk-menu.js). Its 300 px take them in two
  // short lines, not the header's arrangement -- "1:12 PM" beside "76°", then
  // "Sunday, Sep 27" beside "Sunny · Feels 75°" -- so this hands over VALUES
  // from the same sources as clock() and weather(), and the menu lays them
  // out. Everything is plain text; the caller escapes it.
  // TODAY'S HIGH AND LOW (the menu, 2026-10-17): the daily forecast's entry
  // for today -- Configure -> Weather's forecast sensor, else the weather
  // entity's own daily forecast through the one shared subscription
  // (hk-weather.js hkWxForecast, held while the menu shows the weather).
  // {high, low} rounded, either null when there is none.
  var dayW = null;
  function today(states, port, wid, day) {
    var sid = S() ? S().get('weather.forecast_daily', null) : null, fc = null;
    if (sid) {
      fc = ((states[sid] || {}).attributes || {}).forecast;
    } else if (wid && port && window.hkWxForecast) {
      if (dayW && (dayW.conn !== port || dayW.wid !== wid)) { dayW.release(); dayW = null; }
      if (!dayW) { dayW = window.hkWxForecast.watch(port, 'daily', wid, function () {}); dayW.wid = wid; }
      else dayW.ensure();
      fc = dayW.data();
    }
    if (!Array.isArray(fc) || !fc.length) return { high: null, low: null };
    var t = day || new Date(), key = t.getFullYear() + '-' + t.getMonth() + '-' + t.getDate();
    var e = fc.filter(function (x) {
      var d = x && x.datetime ? new Date(x.datetime) : null;
      return d && !isNaN(d) && d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() === key;
    })[0] || fc[0] || {};
    var hi = num(e.temperature), lo = num(e.templow);
    return { high: hi !== null ? Math.round(hi) : null, low: lo !== null ? Math.round(lo) : null };
  }
  // the menu stopped showing the weather: the subscription goes
  function nowDone() { if (dayW) { dayW.release(); dayW = null; } }
  // `port`: the client's subscription port (hkCards.subscriptions())
  function now(states, port) {
    states = states || {};
    var ck = clockParts(states), d = ck.day;
    var wid = S() ? S().weatherId(states) : null;
    var w = (wid && states[wid]) || {}, a = w.attributes || {};
    var temp = num(a.temperature), feels = num(a.apparent_temperature);
    var hl = today(states, port, wid, d);
    return {
      high: hl.high, low: hl.low,
      tempN: temp !== null ? Math.round(temp) : null, feelsN: feels !== null ? Math.round(feels) : null,
      time: ck.time, ampm: ck.ampm,
      date: !d ? '' : usEnglish()
        ? d.toLocaleString('en-US', { weekday: 'long' }) + ', ' + d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getDate()
        : LC().date(d, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'local' }),
      state: w.state || '', night: isNight(states),
      temp: temp !== null ? Math.round(temp) + '\u00b0' : '--\u00b0',
      condition: w.state ? conditionName(w.state) : '',
      feels: feels !== null ? 'Feels ' + Math.round(feels) + '\u00b0' : ''
    };
  }

  window.hkHeader = {
    fitWeather: fitWeather, FIT_CSS: FIT_CSS,
    clockShift: clockShift,
    titleCase: titleCase,
    wxSvg: wxSvg, wxMotionCss: wxMotionCss, wxSymbol: wxSymbol, wxReady: wxReady, conditionName: conditionName, isNight: isNight,
    nightAt: nightAt,
    clock: clock, weather: weather, security: security, status: status, row: row, now: now, nowDone: nowDone,
    lists: lists           // the entity lists `status` reads, for a card's signature
  };
  // Tell already-drawn cards this module exists -- see MODULE WAKE in hk-base.js.
  try { window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkHeader' })); } catch (e) {}
})();
