// hk-saverfaces.js -- THE SCREENSAVER'S HOMEVIEW-STYLE SHOWS (2026-10-30;
// docs/phase11/HOMEVIEW-LOOK.md, Phase I): our own versions of the kinds of
// screensaver HomeView offers, each a whole screen of its own --
//   GLANCE   the date large, a clock, what's playing and the weather, on a
//            calm colour (Show: Glance)
//   MONTH    this month with today circled, the date drawn very large in red
//            behind the grid, and the time (Show: Month; the calendar
//            block's Month View, full screen)
//   DAY      the weekday and a big date with HK's own occasion art -- the
//            sky's: Halloween's bats, moon and web (and a pumpkin of our
//            own), a birthday's balloons, the season's leaves, petals or
//            snow -- light or dark (Show: Day)
//   WEATHER  Big Weather: the temperature very large over the live sky, the
//            condition and high and low, the time, then sunset, wind,
//            humidity and air quality (the Forecast's Layout: Big; it sits in
//            the forecast's layer, over its sky)
// Looks from the mock-up's faceArt() (bright-glass-home-grid.html), drawn at
// a 1180 x 820 tablet and sized here in units of the face's own box
// (container units), so a face beside the screensaver's Side Pane, or on a
// phone, lays itself out in the room it has -- never the window's.
//
// Loaded by hk-saver.js only when a screen shows one -- never on its own.
//
// WHAT IT COSTS A WALL TABLET: words and a few shapes, written again once a
// minute (only what changed), and when the house's music or weather changes;
// nothing animates. Glance's clock is hk-saverclock.js's analog face, held to the
// minute (its second hand hidden).
//
//   hkSaverFaces.mount(layer, { kind, client, h24, weather, look, clocks })
//     -> { setClient(c), night(on), destroy(), kind }
//   kind: 'glance' | 'month' | 'day' | 'weather'; look (Day): 'auto' |
//   'light' | 'dark'; clocks: window.hkSaverClock (Glance's clock)
(function () {
  'use strict';
  if (window.hkSaverFaces) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  // the Day face's hand-lettered look: the home's own handwriting faces where it has one
  var HAND = '"Chalkboard SE","Marker Felt","Patrick Hand","Comic Neue","Segoe Print",' + FONT;
  var SKY = '/hk/sky/';
  var KINDS = ['glance', 'month', 'day', 'weather'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // 1cqmin of a 1180 x 820 tablet is 8.2 px: the mock-up's px over 8.2
  var CSS = [
    '.hkf{position:absolute;inset:0;container-type:size;overflow:hidden;font-family:' + FONT + ';color:#fff;',
    '  -webkit-font-smoothing:antialiased;font-variant-numeric:proportional-nums}',
    '.hkf .ckbg{position:absolute;inset:0}',
    '.hkf .in{position:absolute;inset:0}',
    // GLANCE: the date top left, the clock top right, what's playing bottom left, the weather bottom right
    '.hkf.glance .ckbg{background:linear-gradient(160deg,#a9bcc6,#8fa5b1)}',
    '.hkf.glance .in{display:grid;grid-template-columns:1fr auto;grid-template-rows:1fr auto;padding:7.3cqmin 8.5cqmin;box-sizing:border-box;gap:4cqmin}',
    '.hkf.glance .dt{align-self:start;line-height:1}',
    '.hkf.glance .dw{font-size:7.8cqmin;font-weight:600}',
    '.hkf.glance .dn{font-size:28cqmin;font-weight:600;letter-spacing:-.035em;margin-left:-.04em}',
    '.hkf.glance .clk{position:relative;width:48cqmin;height:48cqmin;align-self:start;justify-self:end;margin-top:-1.2cqmin}',
    '.hkf.glance .mu{align-self:end;display:grid;gap:1.2cqmin;min-width:0;max-width:45cqw}',
    '.hkf.glance .mu .art{width:18.3cqmin;height:18.3cqmin;border-radius:2cqmin;overflow:hidden;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center}',
    '.hkf.glance .mu .art img{width:100%;height:100%;object-fit:cover;display:block}',
    '.hkf.glance .mu .art svg{width:45%;height:45%;fill:rgba(255,255,255,.85)}',
    '.hkf.glance .mu .t{font-size:2.7cqmin;font-weight:700;text-transform:uppercase;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hkf.glance .mu .a{font-size:2.45cqmin;font-weight:500;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hkf.glance .mu .st{font-size:2.45cqmin;font-weight:600;background:rgba(255,255,255,.25);padding:1.2cqmin 2.2cqmin;border-radius:999px;width:max-content}',
    '.hkf.glance .wx{align-self:end;justify-self:end;text-align:left;margin-right:6cqmin;line-height:1}',
    '.hkf.glance .wx .p{font-size:2.9cqmin;font-weight:600}',
    '.hkf.glance .wx .v{font-size:20.7cqmin;font-weight:500;letter-spacing:-.035em}',
    '.hkf.glance .wx .c{font-size:2.9cqmin;font-weight:600;line-height:1.4}',
    // MONTH: the month and the time along the top, the grid under them, the date huge behind it
    '.hkf.month{color:#1c1c1e}',
    '.hkf.month .ckbg{background:#f7f5f2}',
    '.hkf.month .hd{position:absolute;left:9.8cqmin;right:9.8cqmin;top:5.6cqmin;display:flex;justify-content:space-between;font-size:5.4cqmin;font-weight:600;color:#e0302a;line-height:1}',
    '.hkf.month .big{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);font-size:75cqmin;font-weight:800;line-height:1;letter-spacing:-.05em;color:rgba(224,48,42,.85);white-space:nowrap}',
    '.hkf.month .g{position:absolute;left:9.8cqmin;right:9.8cqmin;top:15.8cqmin;bottom:5cqmin;display:grid;grid-template-columns:repeat(7,1fr);align-content:center;row-gap:1.2cqmin;text-align:center;font-size:4.9cqmin;font-weight:600;line-height:8.8cqmin;color:#1f4fd1}',
    '.hkf.month .g .wd{color:#1c1c1e}',
    '.hkf.month .g .o{opacity:.35}',
    '.hkf.month .g .td span{display:inline-block;width:8.3cqmin;height:8.3cqmin;line-height:8.3cqmin;border-radius:50%;background:#1c2b5a;color:#fff}',
    // DAY: the weekday, the date huge, the day's art
    '.hkf.day{color:#1c1c1e}',
    '.hkf.day .ckbg{background:radial-gradient(#d9d6cf 1.2px,transparent 1.3px) 0 0/14px 14px,#eceae5}',
    '.hkf.day.dark{color:#f2efe8}',
    '.hkf.day.dark .ckbg{background:radial-gradient(#2c2d33 1.2px,transparent 1.3px) 0 0/14px 14px,#16171b}',
    '.hkf.day .art{position:absolute;inset:0;pointer-events:none}',
    '.hkf.day .art img,.hkf.day .art svg{position:absolute;display:block}',
    '.hkf.day .art .frame{inset:0;width:100%;height:100%;object-fit:cover}',
    '.hkf.day .wd{position:absolute;left:0;right:0;top:7.3cqmin;text-align:center;font:400 10.2cqmin/1 ' + HAND + ';letter-spacing:.07em;margin-right:-.07em;text-transform:uppercase}',
    '.hkf.day .dn{position:absolute;left:0;right:0;top:18.3cqmin;text-align:center;font:400 68cqmin/1 ' + HAND + '}',
    '.hkf.day .art .pk{position:absolute;left:19.5%;top:68%;width:22cqmin;height:20cqmin;transform:translate(-50%,-50%)}',
    '@container (aspect-ratio < 0.8){.hkf.day .dn{top:30cqh}.hkf.day .art .pk{left:26%;top:84%}}',
    // BIG WEATHER: over the live sky (the forecast's own layer)
    '.hkf.weather{text-shadow:0 1px 12px rgba(0,20,50,.18)}',
    '.hkf.weather .wash{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,12,30,.18),rgba(4,12,30,0) 30%,rgba(4,12,30,0) 62%,rgba(4,12,30,.28))}',
    '.hkf.weather .cn{position:absolute;left:7.3cqmin;top:6.1cqmin;font-size:3.4cqmin;font-weight:600;line-height:1.3}',
    '.hkf.weather .cn svg{width:3.7cqmin;height:3.7cqmin;vertical-align:-.5cqmin;margin-right:.6cqmin}',
    '.hkf.weather .cn .hl{opacity:.85}',
    '.hkf.weather .tm{position:absolute;right:7.3cqmin;top:6.1cqmin;font-size:5.4cqmin;font-weight:600;line-height:1}',
    '.hkf.weather .tp{position:absolute;left:4.9cqmin;top:18.3cqmin;font-size:48.8cqmin;font-weight:600;line-height:1;letter-spacing:-.05em;',
    '  background:linear-gradient(#fff,rgba(255,255,255,.35));-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none}',
    '.hkf.weather .rd{position:absolute;left:7.3cqmin;right:7.3cqmin;bottom:6.1cqmin;display:grid;grid-template-columns:repeat(var(--n,4),1fr);text-align:center;font-size:3.7cqmin;font-weight:600;line-height:1.3}',
    '.hkf.weather .rd svg{width:4.4cqmin;height:4.4cqmin;fill:currentColor;opacity:.9}',
    '.hkf.weather .rd small{display:block;font-size:2.9cqmin;opacity:.85}',
    '@container (aspect-ratio < 1){.hkf.weather .tp{top:24cqh}.hkf.weather .rd{grid-template-columns:repeat(2,1fr);row-gap:4cqmin}}',
    // NIGHT MODE (hk-saver.js): the ground goes (it is a .ckbg), what is on it turns white for the red wash
    '.hkf.night{color:#fff}.hkf.night .hd,.hkf.night .g,.hkf.night .g .wd,.hkf.night .big{color:#fff}.hkf.night .art{display:none}'
  ].join('\n');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function put(e, v) { v = String(v); if (e.textContent !== v) e.textContent = v; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d, h24) {
    var h = d.getHours();
    if (!h24) { h = h % 12; if (h === 0) h = 12; }
    return (h24 ? pad(h) : String(h)) + ':' + pad(d.getMinutes());
  }
  function deg(v) { return v == null ? '—' : Math.round(v) + '°'; }

  // ------------------------------------------------------------ what it shows
  // WHAT'S PLAYING: the media player playing now (else paused), most recently changed
  function playing(states) {
    states = states || {};
    var ign = function (s) { return !!(window.hkMusic && window.hkMusic.ignored && window.hkMusic.ignored(s)); };
    var pick = function (state) {
      return Object.keys(states).filter(function (k) { var s = states[k]; return k.indexOf('media_player.') === 0 && s.state === state && !ign(s) && (s.attributes || {}).media_title; })
        .sort(function (p, q) { return String(states[q].last_changed).localeCompare(String(states[p].last_changed)); })[0];
    };
    var id = pick('playing') || pick('paused'), s = id && states[id];
    if (!s) return null;
    var a = s.attributes || {};
    return { id: id, title: a.media_title, artist: a.media_artist || a.media_album_name || '', pic: a.entity_picture || '', state: s.state };
  }
  // THE MONTH: its weeks from the house's first day of the week, with the
  // days of the months either side faded
  function weekStart(client) {
    var S = window.hkStats;
    if (S && typeof S.weekStart === 'function') { try { return S.weekStart(client); } catch (e) { /* below */ } }
    var w = String(((client && client.locale) || {}).first_weekday || '').toLowerCase(), i = DAYS.map(function (x) { return x.toLowerCase(); }).indexOf(w);
    return i >= 0 ? i : 0;
  }
  function monthGrid(d, first) {
    first = first || 0;
    var y = d.getFullYear(), m = d.getMonth(), start = new Date(y, m, 1), lead = (start.getDay() - first + 7) % 7;
    var dim = new Date(y, m + 1, 0).getDate(), prev = new Date(y, m, 0).getDate(), cells = [];
    for (var i = lead; i > 0; i--) cells.push({ d: prev - i + 1, other: true });
    for (var k = 1; k <= dim; k++) cells.push({ d: k, today: k === d.getDate() });
    var n = 1;
    while (cells.length % 7) cells.push({ d: n++, other: true });
    var heads = [];
    for (var h = 0; h < 7; h++) heads.push(DAYS[(first + h) % 7].charAt(0));
    return { title: MONTHS[m] + ' ' + y, heads: heads, cells: cells, weeks: cells.length / 7 };
  }
  // THE DAY'S ART: HK's own (the sky's occasions and seasons, web/hk/sky):
  // a birthday's balloons, Christmas's garland, Halloween's moon, bats and
  // web (and a pumpkin of our own), Valentine's hearts, the Fourth, then the
  // season's -- autumn leaves, winter's frost, spring blossom, summer's
  // butterflies. { id, frame (a picture over the whole face), sprites:
  // [[file, x %, y %, size (cqmin), turn deg, opacity]], pumpkin }
  function inWindow(name, d, fallback) {
    var HS = window.hkSettings;
    if (HS && HS.skyWindow) { try { return !!HS.skyWindow(name, d).inside; } catch (e) { /* the dates below */ } }
    var md = (d.getMonth() + 1) * 100 + d.getDate();
    return fallback[0] <= fallback[1] ? md >= fallback[0] && md <= fallback[1] : md >= fallback[0] || md <= fallback[1];
  }
  function occasionOf(d, o) {
    o = o || {};
    var HS = window.hkSettings, m = d.getMonth() + 1, day = d.getDate();
    var bdays = o.birthdays || (HS && HS.get ? HS.get('sky.birthdays', []) : []) || [];
    var south = (o.hemisphere || (HS && HS.get ? HS.get('sky.hemisphere', 'north') : 'north')) === 'south';
    var born = (Array.isArray(bdays) ? bdays : []).filter(function (b) { return b && b.month === m && b.day === day; })[0];
    if (born) return { id: 'birthday', person: born.name || '', frame: 'sp-birthday.webp', sprites: [] };
    if (inWindow('christmas', d, [1201, 1226])) return { id: 'christmas', frame: 'xdecor.webp', sprites: [['sp-crystal.webp', 14, 30, 7, 0, 0.7], ['sp-crystal.webp', 86, 62, 5, 20, 0.6]] };
    if (inWindow('halloween', d, [1018, 1031])) {
      return { id: 'halloween', frame: null, pumpkin: true, sprites: [
        ['moon-hallow.webp', 84, 22, 26, 0, 0.9], ['bat1.webp', 72, 15, 9, -10, 0.85], ['bat2.webp', 91, 39, 7, 12, 0.8],
        ['web.webp', 6, 9, 24, 0, 0.7], ['leaf-maple-f.webp', 80, 72, 11, 30, 1], ['leaf-oak-f.webp', 12, 36, 9, -35, 1]] };
    }
    if (inWindow('valentines', d, [208, 214])) return { id: 'valentines', frame: 'sp-valentines.webp', sprites: [['sp-heart.webp', 16, 70, 8, -15, 0.9], ['sp-heart.webp', 84, 30, 6, 12, 0.8]] };
    if (inWindow('july4', d, [628, 704])) return { id: 'july4', frame: 'sp-july4.webp', sprites: [] };
    var season = [12, 1, 2].indexOf(m) >= 0 ? 'winter' : [3, 4, 5].indexOf(m) >= 0 ? 'spring' : [6, 7, 8].indexOf(m) >= 0 ? 'summer' : 'autumn';
    if (south) season = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[season];
    if (season === 'winter') return { id: 'winter', frame: 'sp-winter.webp', sprites: [['sp-crystal.webp', 14, 64, 8, 10, 0.8], ['sp-crystal.webp', 88, 28, 6, -8, 0.7]] };
    if (season === 'spring') return { id: 'spring', frame: 'sp-spring.webp', sprites: [['sp-petal.webp', 16, 72, 6, 40, 0.9], ['sp-petal.webp', 84, 30, 5, -20, 0.8], ['sp-butterfly.webp', 80, 70, 10, 12, 1]] };
    if (season === 'summer') return { id: 'summer', frame: null, sprites: [['sp-butterfly.webp', 16, 30, 12, -14, 1], ['sp-butterfly.webp', 84, 66, 9, 18, 0.95]] };
    return { id: 'autumn', frame: null, sprites: [['leaf-maple-f.webp', 82, 20, 12, -20, 1], ['leaf-oak-f.webp', 88, 44, 10, 30, 1], ['leaf-birch-f.webp', 74, 58, 8, 10, 1],
      ['leaf-maple-f.webp', 13, 30, 10, -35, 1], ['leaf-oak-f.webp', 20, 72, 9, 22, 1]] };
  }
  // the Day face's look: Light, Dark, or by the time of day (dark from 7 in the evening to 7 in the morning)
  function dayDark(look, d) { return look === 'dark' || (look !== 'light' && (d.getHours() >= 19 || d.getHours() < 7)); }

  // ------------------------------------------------------------ glyphs (our own)
  var G = {
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6.2l10-2.2v11.3a2.7 2.7 0 1 1-1.6-2.5V7.6L10.6 9v8.6A2.7 2.7 0 1 1 9 15z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 18.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="12" r="4.4"/><path d="M11 2.6h2v2.6h-2zM11 18.8h2v2.6h-2zM2.6 11h2.6v2H2.6zM18.8 11h2.6v2h-2.6zM4.9 6.3l1.4-1.4 1.8 1.8-1.4 1.4zM15.9 17.3l1.4-1.4 1.8 1.8-1.4 1.4zM4.9 17.7l1.8-1.8 1.4 1.4-1.8 1.8zM15.9 6.7l1.8-1.8 1.4 1.4-1.8 1.8z"/></svg>',
    sunset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17a7 7 0 0 1 14 0zM2 18.5h20v1.8H2zM11 2.5h2v4h-2zM3.6 8.1l1.4-1.4 2.6 2.6-1.4 1.4zM16.4 9.3l2.6-2.6 1.4 1.4-2.6 2.6z"/></svg>',
    wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h15a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h7v2H3z"/></svg>',
    drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C8 8 5.5 11.4 5.5 15a6.5 6.5 0 0 0 13 0c0-3.6-2.5-7-6.5-12.5z"/></svg>',
    aqi: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg>'
  };
  function wxGlyph(cond) {
    return cond === 'sunny' || cond === 'clear-night' ? G.sun : G.cloud;
  }

  // ------------------------------------------------------------ the faces
  // each: build(root, inner, x) -> paint(date, dataChanged)
  var BUILD = {};

  BUILD.glance = function (r, inn, x) {
    var dt = el('div', 'dt'), dw = el('div', 'dw'), dn = el('div', 'dn');
    dt.append(dw, dn);
    var clk = el('div', 'clk'), mu = el('div', 'mu'), wx = el('div', 'wx');
    inn.append(dt, clk, mu, wx);
    // the clock: the screensaver's analog face (Analog Numbers once there is one), without a background
    var C = x.clocks, face = null;
    if (C && C.mount) {
      var has = (C.STYLES || []).some(function (s) { return s[0] === 'numbers'; });
      try { face = C.mount(clk, { style: has ? 'numbers' : 'analog', bg: 'none', scrim: false, drift: false, h24: x.h24, still: x.still, minutely: true, client: x.client() }); } catch (e) { face = null; }
    }
    x.parts.push(face);
    var muKey = null, wxKey = null;
    return function (d) {
      put(dw, DAYS[d.getDay()].slice(0, 3) + ' ' + MONTHS[d.getMonth()].slice(0, 3));
      put(dn, d.getDate());
      var c = x.client(), p = playing(c && c.states), k = p ? [p.title, p.artist, p.pic, p.state].join('|') : '';
      if (k !== muKey) {
        muKey = k;
        mu.textContent = '';
        mu.style.display = p ? '' : 'none';
        if (p) {
          var art = el('div', 'art');
          if (p.pic) { var im = el('img'); im.alt = ''; im.src = p.pic; art.appendChild(im); } else art.innerHTML = G.note;
          mu.append(art, el('div', 't', p.title), el('div', 'a', p.artist), el('div', 'st', p.state === 'playing' ? 'Playing' : 'Paused'));
        }
      }
      var w = x.weather();
      k = w ? [w.place, w.temp, w.says, w.hi, w.lo].join('|') : '';
      if (k !== wxKey) {
        wxKey = k;
        wx.textContent = '';
        wx.style.display = w ? '' : 'none';
        if (w) {
          var c2 = el('div', 'c');
          c2.appendChild(document.createTextNode ? document.createTextNode(w.says) : el('span', null, w.says));
          if (w.hi != null || w.lo != null) { c2.appendChild(el('br')); c2.appendChild(el('span', null, 'H:' + deg(w.hi) + ' L:' + deg(w.lo))); }
          wx.append(el('div', 'p', w.place), el('div', 'v', deg(w.temp)), c2);
        }
      }
    };
  };

  BUILD.month = function (r, inn, x) {
    var big = el('div', 'big'), hd = el('div', 'hd'), ttl = el('span'), tm = el('span'), g = el('div', 'g');
    hd.append(ttl, tm);
    inn.append(big, hd, g);
    var built = '';
    return function (d) {
      put(tm, hm(d, x.h24));
      var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + '|' + weekStart(x.client());
      if (key === built) return;
      built = key;
      var M = monthGrid(d, weekStart(x.client()));
      put(ttl, M.title);
      put(big, d.getDate());
      g.textContent = '';
      M.heads.forEach(function (h) { g.appendChild(el('div', 'wd', h)); });
      M.cells.forEach(function (c) {
        var cell = el('div', c.other ? 'o' : c.today ? 'td' : '');
        if (c.today) cell.appendChild(el('span', null, c.d)); else cell.textContent = String(c.d);
        g.appendChild(cell);
      });
    };
  };

  BUILD.day = function (r, inn, x) {
    var art = el('div', 'art'), wd = el('div', 'wd'), dn = el('div', 'dn');
    inn.append(art, wd, dn);
    var built = '';
    return function (d) {
      var dark = dayDark(x.look, d);
      if (/\bdark\b/.test(r.className) !== dark) r.className = r.className.replace(/ dark\b/g, '') + (dark ? ' dark' : '');
      put(wd, DAYS[d.getDay()]);
      put(dn, d.getDate());
      var O = occasionOf(d), key = d.toDateString() + '|' + O.id;
      if (key === built) return;
      built = key;
      art.textContent = '';
      if (O.frame) { var f = el('img', 'frame'); f.alt = ''; f.src = SKY + O.frame; art.appendChild(f); }
      O.sprites.forEach(function (s) {
        var im = el('img'); im.alt = ''; im.src = SKY + s[0];
        im.style.cssText = 'left:' + s[1] + '%;top:' + s[2] + '%;width:' + s[3] + 'cqmin;height:' + s[3] + 'cqmin;object-fit:contain;' +
                           'transform:translate(-50%,-50%) rotate(' + s[4] + 'deg);opacity:' + s[5];
        art.appendChild(im);
      });
      if (O.pumpkin) art.appendChild(pumpkin());
    };
  };
  // A PUMPKIN of our own (the mock-up's), bottom left
  function pumpkin() {
    var s = el('div');
    s.className = 'pk';
    s.innerHTML = '<svg viewBox="-100 -100 200 180" style="width:100%;height:100%" aria-hidden="true"><ellipse rx="92" ry="74" fill="#f08a24"/>' +
      '<ellipse cx="-38" cy="4" rx="40" ry="70" fill="#e07a16"/><ellipse cx="38" cy="4" rx="40" ry="70" fill="#e07a16"/>' +
      '<ellipse cy="4" rx="34" ry="72" fill="#f59a3a"/><rect x="-6" y="-92" width="14" height="30" rx="5" fill="#5c7a2e"/>' +
      '<path d="M-40 -10l14 -16 14 16z M12 -10l14 -16 14 16z M-44 26q44 30 88 0q-44 12 -88 0z" fill="#3a2410"/></svg>';
    return s;
  }

  BUILD.weather = function (r, inn, x) {
    inn.appendChild(el('div', 'wash'));
    var cn = el('div', 'cn'), tm = el('div', 'tm'), tp = el('div', 'tp'), rd = el('div', 'rd');
    inn.append(cn, tm, tp, rd);
    var key = null;
    return function (d) {
      put(tm, hm(d, x.h24));
      var w = x.weather(), k = w ? JSON.stringify([w.temp, w.cond, w.hi, w.lo, w.sunset && w.sunset.getTime(), w.wind, w.humidity, w.aqi, d.getHours() >= 12]) : '';
      if (k === key) return;
      key = k;
      cn.textContent = ''; rd.textContent = '';
      if (!w) { put(tp, ''); return; }
      cn.innerHTML = wxGlyph(w.cond);
      cn.appendChild(el('span', null, w.says));
      if (w.hi != null || w.lo != null) { cn.appendChild(el('br')); cn.appendChild(el('span', 'hl', 'H:' + deg(w.hi) + ' L:' + deg(w.lo))); }
      put(tp, deg(w.temp));
      var cols = [];
      if (w.sunset) cols.push([G.sunset, hm(w.sunset, x.h24) + (x.h24 ? '' : (w.sunset.getHours() < 12 ? ' AM' : ' PM')), 'Sunset']);
      if (w.wind != null) cols.push([G.wind, Math.round(w.wind) + ' ' + (w.windUnit || ''), 'Wind']);
      if (w.humidity != null) cols.push([G.drop, Math.round(w.humidity) + '%', 'Humidity']);
      if (w.aqi != null) cols.push([G.aqi, String(w.aqi), 'AQI']);
      rd.style.setProperty('--n', String(Math.max(1, cols.length)));
      cols.forEach(function (c) {
        var cell = el('div');
        cell.innerHTML = c[0];
        cell.appendChild(el('div', null, c[1].trim()));
        cell.appendChild(el('small', null, c[2]));
        rd.appendChild(cell);
      });
    };
  };

  // ------------------------------------------------------------ mount
  function mount(layer, opts) {
    opts = opts || {};
    var kind = KINDS.indexOf(opts.kind) >= 0 ? opts.kind : 'glance';
    var root = el('div', 'hkf ' + kind), css = el('style'), ground = el('div', 'ckbg'), inn = el('div', 'in');
    css.textContent = CSS;
    root.append(css);
    if (kind !== 'weather') root.appendChild(ground);       // (Big Weather: the forecast's sky is its ground)
    root.appendChild(inn);
    layer.appendChild(root);
    var client = opts.client || null, dead = false, fc = null, fcFor = '', daily = [];
    var x = {
      h24: !!opts.h24, look: opts.look || 'auto', clocks: opts.clocks || window.hkSaverClock || null, still: !!opts.still, parts: [],
      client: function () { return client; },
      // the weather now, today's high and low from the daily forecast (hkWxForecast, shared with the cards)
      weather: function () {
        var R = window.hkWxReadings;
        if (!R || !client) return null;
        var w = R.read(client, { entity: opts.weather || null, daily: daily });
        var F = window.hkWxForecast;
        if (w && F && client.subscriptions && fcFor !== w.entity && !opts.still) {
          if (fc) fc.release();
          fcFor = w.entity;
          fc = F.watch(client.subscriptions, 'daily', w.entity, function () { daily = fc ? fc.data() : []; paint(); });
        }
        if (fc) fc.ensure();
        return w;
      }
    };
    var tick = BUILD[kind](root, inn, x);
    var paint = function () { if (!dead) { try { tick(new Date()); } catch (e) { console.warn('[hk-saverfaces]', kind, e && e.message); } } };
    paint();
    // once a minute, on the minute (a preview: drawn once)
    var tS = null, tT = null;
    if (!opts.still) tS = setTimeout(function () { paint(); tT = setInterval(paint, 60000); }, 60000 - Date.now() % 60000);
    return {
      kind: kind,
      setClient: function (c) {
        client = c;
        x.parts.forEach(function (p) { if (p && p.setClient) p.setClient(c); });
        paint();
      },
      night: function (on) {
        root.className = root.className.replace(/ night\b/g, '') + (on ? ' night' : '');
        x.parts.forEach(function (p) { if (p && p.night) p.night(on); });
      },
      destroy: function () {
        dead = true;
        clearTimeout(tS); clearInterval(tT);
        if (fc) { fc.release(); fc = null; }
        x.parts.forEach(function (p) { if (p && p.destroy) { try { p.destroy(); } catch (e) { /* gone */ } } });
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  window.hkSaverFaces = { KINDS: KINDS.slice(), mount: mount, _: { monthGrid: monthGrid, occasionOf: occasionOf, playing: playing, dayDark: dayDark, hm: hm } };
})();
