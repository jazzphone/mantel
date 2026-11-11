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
// minute (only what changed), and when the house's music or weather changes.
// Glance's clock is hk-saverclock.js's analog face, held to the minute (its
// second hand hidden). The one motion: the Day face's art -- leaves falling,
// bats flying across -- CSS animations of a handful of small pictures'
// translate, rotate and scale, which the compositor runs without the page;
// none under Flat, Reduce Motion or a still preview.
//
//   hkSaverFaces.mount(layer, { kind, client, h24, weather, look, clocks, onReadings, big, planted, sky })
//     -> { setClient(c), night(on), light(s), destroy(), kind }
//   kind: 'glance' | 'month' | 'day' | 'weather'; look (Day): 'auto' |
//   'light' | 'dark'; clocks: window.hkSaverClock (Glance's clock); onReadings(n) (Big Weather): how many
//   readings its bottom row has, whenever that changes
// @ts-check
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
    // (the screen's one margin, 6 % of its shorter side, as the pieces around it have it: the date's left edge on the
    // corners' left edge, the clock's right edge on Home Status's -- 2026-11-02)
    '.hkf.glance .in{display:grid;grid-template-columns:1fr auto;grid-template-rows:1fr auto;padding:6cqmin;box-sizing:border-box;gap:4cqmin}',
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
    // (each in its own cell, whatever plays: the music under the date, the weather under the clock, its left edge on the
    // clock's -- 2026-11-02, the owner: "what is it doing? Why is it right there?" With nothing playing the music's cell
    // was given to the weather, which then stood at that column's right end, a third of the way across, aligned to nothing)
    '.hkf.glance .mu{grid-column:1;grid-row:2}',
    '.hkf.glance .wx{align-self:end;justify-self:start;text-align:left;line-height:1;grid-column:2;grid-row:2}',
    '.hkf.glance .wx .p{font-size:2.9cqmin;font-weight:600}',
    '.hkf.glance .wx .v{font-size:20.7cqmin;font-weight:500;letter-spacing:-.035em}',
    '.hkf.glance .wx .c{font-size:2.9cqmin;font-weight:600;line-height:1.4}',
    // MONTH: the month and the time along the top, the grid under them, the date huge behind it
    '.hkf.month{color:#1c1c1e}',
    '.hkf.month .ckbg{background:#f7f5f2}',
    '.hkf.month .hd{position:absolute;left:9.8cqmin;right:9.8cqmin;top:5.6cqmin;display:flex;justify-content:space-between;font-size:5.4cqmin;font-weight:600;color:#e0302a;line-height:1}',
    '.hkf.month .big{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);font-size:75cqmin;font-weight:800;line-height:1;letter-spacing:-.05em;color:rgba(224,48,42,.85);' +
      'white-space:nowrap}',
    '.hkf.month .g{position:absolute;left:9.8cqmin;right:9.8cqmin;top:15.8cqmin;bottom:5cqmin;display:grid;grid-template-columns:repeat(7,1fr);align-content:center;row-gap:1.2cqmin;' +
      'text-align:center;font-size:4.9cqmin;font-weight:600;line-height:8.8cqmin;color:#1f4fd1}',
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
    // (the day's name sits on its numeral, one group -- 2026-11-02, the owner: "should we lower Monday closer to the
    // number?" -- 4.8 cqmin over the numeral's figure; the top band is the corners')
    '.hkf.day .wd{position:absolute;left:0;right:0;top:17.4cqmin;text-align:center;font:400 10.2cqmin/1 ' + HAND + ';letter-spacing:.07em;margin-right:-.07em;text-transform:uppercase}',
    '.hkf.day .dn{position:absolute;left:0;right:0;top:18.3cqmin;text-align:center;font:400 68cqmin/1 ' + HAND + '}',
    '.hkf.day .art .pk{position:absolute;left:19.5%;top:68%;width:22cqmin;height:20cqmin;transform:translate(-50%,-50%)}',
    // (clear of the screensaver's corner where its words would meet them: hk-saver.js dayFit)
    '.hkf.day .wd{translate:0 var(--hk-day-push,0px)}',
    '.hkf.day.artonly .wd,.hkf.day.artonly .dn{display:none}',
    '.hkf.day .dn{translate:0 var(--hk-day-push-dn,0px);scale:var(--hk-day-scale,1);transform-origin:50% 0}',
    // (a face nearly square -- beside the Side Pane -- has its date wider than the pumpkin's room at its left: the
    // pumpkin in the corner under it, right)
    '@container (0.8 <= aspect-ratio < 1.25){.hkf.day .art .pk{left:86%;top:89%;width:17cqmin;height:15cqmin}}',
    '@container (aspect-ratio < 0.8){.hkf.day .dn{top:30cqh}.hkf.day .wd{top:calc(30cqh - 0.9cqmin)}.hkf.day .art .pk{left:26%;top:84%}}',
    // THE DAY'S ART, MOVING (2026-10-31, the owner: "bats flying, leaves falling"): each picture's own translate,
    // rotate and scale (they add to its placing transform), so the compositor runs them -- leaves, petals and snow
    // fall from above the face to below it through their places, swaying and turning; bats fly across it with their
    // wings beating, butterflies more slowly; the moon rises a little, the pumpkin rocks; the web holds still. --x
    // and --y: a picture's place (the face's units), --k its own start in the loop. None under Flat or a still
    // preview (no .live) or Reduce Motion.
    '.hkf.day.live .art .fall{animation:hkf-fall 21s linear infinite}',
    '.hkf.day.live .art .fly{animation:hkf-fly 19s linear infinite,hkf-flap .34s ease-in-out infinite alternate}',
    '.hkf.day.live .art .flutter{animation:hkf-fly 31s linear infinite,hkf-flap .55s ease-in-out infinite alternate}',
    '.hkf.day.live .art .moon{animation:hkf-moon 24s ease-in-out infinite}',
    '.hkf.day.live .art .drift{animation:hkf-drift 11s ease-in-out infinite}',
    '.hkf.day.live .art .pk{transform-origin:50% 90%;animation:hkf-pk 9s ease-in-out infinite}',
    '.hkf.day.live .art > *{animation-delay:var(--k,0s)}',
    '@keyframes hkf-fall{0%{translate:0 calc(-1 * var(--y,50cqh) - 14cqh);rotate:-20deg}25%{translate:4cqmin calc(-.5 * var(--y,50cqh) + 13cqh);rotate:40deg}',
    '  50%{translate:-3cqmin calc(50cqh - var(--y,50cqh));rotate:110deg}75%{translate:3cqmin calc(87cqh - var(--y,50cqh));rotate:170deg}',
    '  100%{translate:-1cqmin calc(114cqh - var(--y,50cqh));rotate:240deg}}',
    '@keyframes hkf-fly{0%{translate:calc(-1 * var(--x,50cqw) - 12cqw) 0}20%{translate:calc(20cqw - var(--x,50cqw)) -4cqh}',
    '  45%{translate:calc(48cqw - var(--x,50cqw)) 2cqh}70%{translate:calc(76cqw - var(--x,50cqw)) -5cqh}100%{translate:calc(112cqw - var(--x,50cqw)) -1cqh}}',
    '@keyframes hkf-flap{from{scale:1 1}to{scale:1 .55}}',
    '@keyframes hkf-drift{0%,100%{translate:0 0;rotate:0deg}30%{translate:.8cqmin 1.2cqmin;rotate:9deg}65%{translate:-.6cqmin .4cqmin;rotate:-7deg}}',
    '@keyframes hkf-moon{0%,100%{translate:0 0}50%{translate:0 -1.4cqmin}}',
    '@keyframes hkf-pk{0%,100%{rotate:0deg}30%{rotate:-2.5deg}70%{rotate:2.5deg}}',
    '@media (prefers-reduced-motion:reduce){.hkf.day.live .art > *{animation:none}}',
    // BIG WEATHER: over the live sky (the forecast's own layer)
    '.hkf.weather{text-shadow:0 1px 12px rgba(0,20,50,.18)}',
    '.hkf.weather .wash{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,12,30,.18),rgba(4,12,30,0) 30%,rgba(4,12,30,0) 62%,rgba(4,12,30,.28))}',
    '.hkf.weather .cn{position:absolute;left:7.3cqmin;top:6.1cqmin;font-size:3.4cqmin;font-weight:600;line-height:1.3}',
    '.hkf.weather .cn svg{width:3.7cqmin;height:3.7cqmin;vertical-align:-.5cqmin;margin-right:.6cqmin}',
    // (dimmed by its color, never opacity: an inline span with opacity over the planted numerals' 3D layers was made a
    // layer of its own, and the tablets' WebView drew it a line too high and opaque -- a black box over "Sunny" for
    // the whole Forecast slide, screen-recorded on the Loft, 2026-11-09)
    '.hkf.weather .cn .hl{color:color-mix(in srgb,currentColor 85%,transparent)}',
    '.hkf.weather .tm{position:absolute;right:7.3cqmin;top:6.1cqmin;font-size:5.4cqmin;font-weight:600;line-height:1}',
    // THE BIG NUMBER STANDS ON THE GROUND (2026-10-31, the owner: it "sits a little above"): its foot on the
    // landscape's meadow, not a fixed distance from the top. The art covers the screen from its foot (hk-sky.js
    // .land: cover, center bottom; ~3:2), so the meadow in front of the tree line is 32 % of the art's drawn height up
    // from the bottom, however wide the screen -- that height the screen's own, or its width at 3:2 when wider. The
    // line box's foot is 0.145 of the type below the figures' baseline (line-height 1). Under the figures (.tpn, the
    // gradient clipped to them) a soft contact shadow on the land (::before, painted first; no filter: a gradient)
    '.hkf.weather .tp{position:absolute;left:4.9cqmin;bottom:calc(.32 * max(100cqh, 66.7cqw) - .145em);font-size:48.8cqmin;font-weight:600;line-height:1;letter-spacing:-.05em}',
    '.hkf.weather .tpn{position:relative;display:inline-block;background:linear-gradient(#fff,rgba(255,255,255,.35));-webkit-background-clip:text;background-clip:text;color:transparent;' +
      'text-shadow:none}',
    '.hkf.weather .tp::before{content:"";position:absolute;left:0;right:3%;bottom:.06em;height:.17em;pointer-events:none;',
    '  background:radial-gradient(closest-side,rgba(20,14,4,.42),rgba(20,14,4,.18) 55%,rgba(20,14,4,0));transform:skewX(-24deg)}',
    '.hkf.weather .tp:has(.tpn:empty)::before{display:none}',
    // ...the time, when it is the big number (forecast_big: clock): a little smaller, the figures being wider
    '.hkf.weather.bigclock .tp{font-size:40cqmin;letter-spacing:-.04em}',
    // THE BOTTOM ROW (2026-10-31, the owner: the music and the readings "randomly picked alignment and gaps"): on the
    // face's own margins -- 7.3 units each side, as the condition and the time above, 6.1 up from the foot, as they
    // are down from the top -- each reading a box 14 units tall, centred in it. What the screensaver plays beside it
    // is laid out to the same numbers (hk-saver.js, Big Weather's corners): its picture 14 units, its title and
    // artist the readings' two sizes
    '.hkf.weather .rd{position:absolute;left:7.3cqmin;right:7.3cqmin;bottom:6.1cqmin;display:grid;grid-template-columns:repeat(var(--n,4),1fr);text-align:center;font-size:3.7cqmin;font-weight:600;' +
      'line-height:1.3}',
    '.hkf.weather .rd > div{height:14cqmin;display:flex;flex-direction:column;align-items:center;justify-content:center}',
    '.hkf.weather .rd svg{display:block;width:4.4cqmin;height:4.4cqmin;fill:currentColor;opacity:.9}',
    '.hkf.weather .rd small{display:block;font-size:2.9cqmin;opacity:.85}',
    // (upright: on the ground too, but never lower than the row above the readings -- what plays sits there)
    '@container (aspect-ratio < 1){.hkf.weather .tp{bottom:calc(max(.32 * max(100cqh, 66.7cqw), 58cqmin) - .145em)}.hkf.weather.bigclock .tp{font-size:30cqmin}',
    '  .hkf.weather .rd{grid-template-columns:repeat(2,1fr);row-gap:4cqmin}}',
    // ...while music plays (.np), held sideways, the row is split: what plays on the left margin (no wider than 40 %),
    // the readings packed against the right one, 9.8 units apart -- the last one's edge as far in from the right as
    // the music's picture is from the left (2026-10-31, the owner); upright, there is no room beside it, and it sits
    // one row above them on the same margin, 4 units clear
    '@container (aspect-ratio >= 1){.hkf.weather.np .rd{left:calc(40cqw + 2.4cqmin);display:flex;justify-content:flex-end;gap:9.8cqmin}}',
    // THE PLANTED NUMERALS (plant() below): the time as ivory figures standing in the meadow, their shadows on it.
    // Every box is placed in px by plant(); only what is the same on every screen is here
    '.hkf.weather .pl{position:absolute;inset:0;pointer-events:none;text-shadow:none}',
    '.hkf.weather .pl > .ps,.hkf.weather .pl > .pc,.hkf.weather .pl > .pd{position:absolute;inset:0}',
    '.hkf.weather .pl .b{position:absolute;left:0;top:0;transform-origin:0 0}',
    '.hkf.weather .pl .fx{position:absolute;inset:0}',
    '.hkf.weather .pl .t{position:absolute;left:0;top:0;font-weight:600;line-height:1;white-space:nowrap;text-shadow:none}',
    '.hkf.weather .pl .pf .t{color:transparent;-webkit-background-clip:text;background-clip:text}',
    '.hkf.weather .pl .probe{visibility:hidden}',
    '.hkf.weather.planted .tp{display:none}',
    // (Night Mode's red wash: no sun to cast a shadow)
    '.hkf.night .pl .ps{display:none}',
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
    if (season === 'spring') return { id: 'spring', frame: 'sp-spring.webp', sprites: [['sp-petal.webp', 16, 72, 6, 40, 0.9], ['sp-petal.webp', 84, 30, 5, -20, 0.8],
      ['sp-butterfly.webp', 80, 70, 10, 12, 1]] };
    if (season === 'summer') return { id: 'summer', frame: null, sprites: [['sp-butterfly.webp', 16, 30, 12, -14, 1], ['sp-butterfly.webp', 84, 66, 9, 18, 0.95]] };
    return { id: 'autumn', frame: null, sprites: [['leaf-maple-f.webp', 82, 20, 12, -20, 1], ['leaf-oak-f.webp', 88, 44, 10, 30, 1], ['leaf-birch-f.webp', 74, 58, 8, 10, 1],
      ['leaf-maple-f.webp', 13, 30, 10, -35, 1], ['leaf-oak-f.webp', 20, 72, 9, 22, 1]] };
  }
  // the Day face's look: Light, Dark, or by the time of day (dark from 7 in the evening to 7 in the morning)
  function dayDark(look, d) { return look === 'dark' || (look !== 'light' && (d.getHours() >= 19 || d.getHours() < 7)); }
  // how a picture of the art moves (.live): a bat flies across, a butterfly flutters across, a leaf, a petal and snow
  // fall, the moon rises and falls a little, a heart rocks; the web holds still
  function motionOf(file) {
    return /^bat/.test(file) ? 'fly' : /butterfly/.test(file) ? 'flutter' : /^moon/.test(file) ? 'moon' :
      /^leaf|petal|crystal/.test(file) ? 'fall' : /^web\./.test(file) ? '' : 'drift';
  }
  // EACH FACE'S GROUND, AND THE INK THAT READS ON IT (2026-10-31, the owner: on the light Day face the time, the
  // date and the weather were white on a page nearly white): the colour behind the screensaver's corners, and its
  // relative luminance (WCAG's). A ground at 0.6 or more is light -- where the faces' own words are dark (Day's
  // light look and Month, at 0.8 and more); Glance's blue-grey (under 0.5) and the dark look keep white, as the
  // face's own words do. Big Weather: the forecast's sky, never light.
  var GROUNDS = { glance: '#a9bcc6', month: '#f7f5f2', day: '#eceae5', dayDark: '#16171b' };
  function groundOf(kind, look, d) {
    if (kind === 'day') return dayDark(look, d || new Date()) ? GROUNDS.dayDark : GROUNDS.day;
    return GROUNDS[kind] || null;
  }
  function luminance(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 0;
    var c = [0, 2, 4].map(function (i) { var v = parseInt(m[1].substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function inkOn(hex) { return hex && luminance(hex) >= 0.6 ? 'dark' : 'light'; }
  function inkFor(kind, look, d) { return inkOn(groundOf(kind, look, d)); }

  // ------------------------------------------------------------ glyphs (our own)
  var G = {
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6.2l10-2.2v11.3a2.7 2.7 0 1 1-1.6-2.5V7.6L10.6 9v8.6A2.7 2.7 0 1 1 9 15z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7 18.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="12" r="4.4"/><path d="M11 2.6h2v2.6h-2zM11 18.8h2v2.6h-2zM2.6 11h2.6v2H2.6zM18.8 11h2.6v2h-2.6zM4.9 ' +
      '6.3l1.4-1.4 1.8 1.8-1.4 1.4zM15.9 17.3l1.4-1.4 1.8 1.8-1.4 1.4zM4.9 17.7l1.8-1.8 1.4 1.4-1.8 1.8zM15.9 6.7l1.8-1.8 1.4 1.4-1.8 1.8z"/></svg>',
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
  // ------------------------------------------------------------ the planted numerals
  // THE PLANTED NUMERALS (2026-11-01, the owner: "physical numerals standing in the landscape"; the plan and the
  // mock-up: docs/artwork-handoff/grounded-clock/): Big Weather's time as solid ivory figures on the meadow, lit by
  // the scene's own sun. Over a landscape only (hk-saver.js hands the sky's reading in: light()); without one, and
  // with Planted Numerals off, the time is drawn as before.
  //   - THE GROUND: one camera fitted to the land (hk-sky.js .land: 2560 x 1600, cover, center bottom). The feet
  //     on the art's ground line (68 % down), the eye level at 57.5 % (above the meadow's far edge, at the hills'
  //     feet), the focal length the art's drawn width, the vanishing point the middle of the face. Fractions of
  //     the art, so it holds on every screen and crop -- upright too (the old 58cqmin floor stood them in the trees)
  //   - THE SUN'S SHADOW: a copy of the figures laid on that ground. hk-sky places the sun by azimuth (90 at the
  //     left edge, 180 ahead, 270 at the right), so its direction is phi = azimuth - 180 round the viewer, at its
  //     real elevation; on the ground and through the camera that is one homography (castH), a matrix3d. Longer as
  //     the sun sinks (castLength), crisp at the feet and softer away from them, clipped to the meadow; faded by
  //     cloud, gone with the sun. A second, faint one from high overhead is the sky's (the only one at night)
  //   - CONTACT: each figure's own foot mirrored flat onto the grass, three layers tightening to the stroke
  //   - THE FIGURES: ivory with a thin side toward the vanishing point, lit when the sun is on that side; their
  //     color the light's -- the land's own dusk transform at dusk, moonlit at night, flatter under cloud
  // WHAT IT COSTS: nothing moves. Drawn again when the minute, the sky's reading or the face's size changes; the
  // projected copies are composited layers the size of the time (about 2 MB each on a 1.5x tablet).
  var ART_W = 2560, ART_H = 1600;
  var PL_GROUND = 0.68, PL_HORIZON = 0.575, PL_TREES = 0.6325, PL_FOCAL = 1.0;
  var PL_IVORY = [239, 231, 214];
  // each season's meadow (land-<season>-<light>.webp, its mean by the figures' feet), and the land's dusk: a color
  // matrix of its day, fitted from the art (rows r, g, b: [r, g, b, offset])
  var PL_MEADOW = {
    fall: { day: [188, 123, 56], dusk: [104, 65, 51], night: [20, 23, 25],
            m: [[0.469, 0.178, 0.057, -9.236], [0.127, 0.347, 0.059, -5.134], [0.142, 0.135, 0.315, -9.587]],
            n: [[0.056, 0.046, 0.022, 2.806], [0.026, 0.074, 0.035, 6.576], [0.039, 0.073, 0.131, 1.388]] },
    summer: { day: [119, 131, 56], dusk: [73, 59, 42], night: [15, 21, 23],
              m: [[0.472, 0.174, 0.059, -9.105], [0.128, 0.344, 0.058, -4.942], [0.159, 0.114, 0.317, -9.029]],
              n: [[0.074, 0.018, 0.025, 2.868], [0.03, 0.073, 0.035, 6.226], [0.033, 0.078, 0.131, 1.59]] },
    spring: { day: [147, 152, 71], dusk: [91, 71, 54], night: [18, 24, 27],
              m: [[0.468, 0.176, 0.06, -9.046], [0.126, 0.348, 0.058, -5.137], [0.144, 0.131, 0.317, -9.559]],
              n: [[0.073, 0.02, 0.026, 2.705], [0.032, 0.072, 0.036, 6.056], [0.038, 0.074, 0.128, 1.603]] },
    winter: { day: [213, 216, 226], dusk: [142, 110, 120], night: [29, 36, 54],
              m: [[0.452, 0.205, 0.045, -8.651], [0.126, 0.358, 0.051, -5.299], [0.132, 0.147, 0.306, -8.666]],
              n: [[0.078, 0.02, 0.039, -0.363], [0.046, 0.066, 0.031, 5.106], [0.044, 0.068, 0.128, 1.473]] }
  };
  // THE GRASS IN FRONT (Codex's art, 2026-11-01: docs/artwork-handoff/grounded-clock/): a 3600 x 200 strip per
  // season, day-lit, at twice the land's density -- its row 140 the ground line, its left edge 60 art px before the
  // time, shown to 60 art px past it and faded out there. Drawn into a canvas the time's width (never the whole
  // strip), through the land's own dusk or night matrix (m, n) and its cloud dimming, as the land showing is lit
  var PL_STRIP = { w: 3600, h: 200, ground: 140, lead: 60 };
  var plStrips = {};
  function plStrip(season, then) {
    var e = plStrips[season];
    if (!e) {
      e = plStrips[season] = { img: new Image(), ok: false, wait: [] };
      e.img.onload = function () { e.ok = true; e.wait.splice(0).forEach(function (f) { try { f(); } catch (x) { /* gone */ } }); };
      e.img.onerror = function () { e.wait = []; };                      // no art: no grass, the rest as it is
      e.img.src = SKY + 'fg-meadow-' + season + '.webp';
    }
    if (!e.ok && then && e.wait.indexOf(then) < 0) e.wait.push(then);
    return e.ok ? e.img : null;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(a, b, v) { v = clamp((v - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); }
  function mixc(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }
  function mulc(a, k) { return a.map(function (v, i) { return v * (Array.isArray(k) ? k[i] : k); }); }
  function rgb(c, a) {
    c = c.map(function (v) { return Math.round(clamp(v, 0, 255)); });
    return a == null ? 'rgb(' + c + ')' : 'rgba(' + c + ',' + (+a).toFixed(3) + ')';
  }
  // the land's frame on a face W x H, and the camera on it
  function plGeometry(W, H) {
    var k = Math.max(W / ART_W, H / ART_H), Aw = ART_W * k, Ah = ART_H * k, top = H - Ah, cqmin = Math.min(W, H) / 100;
    var fs = (W >= H ? 40 : 30) * cqmin;
    return { W: W, H: H, k: k, fs: fs, left: 4.9 * cqmin, ls: -0.04 * fs, cx: W / 2, f: PL_FOCAL * Aw,
             yG: top + PL_GROUND * Ah, yH: top + PL_HORIZON * Ah, yT: top + PL_TREES * Ah };
  }
  // the light on the figures, from the sky's reading (hk-sky.js read(): elev, azim, cover)
  function plLight(s, season) {
    var M = PL_MEADOW[season] || PL_MEADOW.fall;
    var e = Number(s.elev) || 0, phi = ((Number(s.azim) || 180) - 180) * Math.PI / 180, cover = clamp(Number(s.cover) || 0, 0, 1);
    var sunUp = smooth(-1, 6, e), clouds = smooth(0.3, 0.95, cover), direct = sunUp * (1 - 0.9 * clouds);
    var tDay = smooth(0, 10, e), tDusk = smooth(-10, -2, e);
    var day = mixc(PL_IVORY, mulc(PL_IVORY, [1, 0.93, 0.82]), smooth(22, 3, e) * (1 - clouds) * 0.55);
    var dusk = mixc(M.m.map(function (r) { return r[0] * PL_IVORY[0] + r[1] * PL_IVORY[1] + r[2] * PL_IVORY[2] + r[3]; }), mulc(PL_IVORY, 0.64), 0.5);
    var face = mixc(mulc(PL_IVORY, [0.4, 0.43, 0.5]), mixc(dusk, day, tDay), tDusk);
    face = mixc(face, mulc(face, [0.9, 0.91, 0.93]), clouds);                      // a gray day: flatter, cooler
    face = mulc(face, 1 - 0.1 * direct * Math.max(0, Math.cos(phi)));            // the sun ahead: the fronts in shade
    var meadow = mixc(M.night, mixc(M.dusk, M.day, tDay), tDusk);
    var sideLit = Math.max(0, Math.sin(phi)) * Math.cos(e * Math.PI / 180) * direct;
    var side = mixc(mulc(face, 0.74 + 0.36 * sideLit - (Math.sin(phi) < 0 ? 0.07 * direct : 0)), meadow, 0.12);
    return { e: e, phi: phi, direct: direct, clouds: clouds, face: face, meadow: meadow, side: side,
             shade: mixc([34, 24, 10], [26, 18, 26], 1 - tDay),
             cast: 0.72 * direct, sky: 0.12 + 0.22 * clouds * sunUp, contact: 0.62 + 0.18 * clouds - 0.14 * (1 - tDusk) };
  }
  // where a point t px up the figures' plane lands on the ground: x' = cx + ((x - cx) - t*a) / k,
  // y' = yH + D / k, k = 1 - t*b -- a homography of the plane (a 3 x 3 on screen px)
  function castH(g, cot, phi) {
    var a = cot * Math.sin(phi), b = cot * Math.cos(phi) / g.f, D = g.yG - g.yH, c = g.cx * b + a;
    return [[1, c, -g.yG * c], [0, g.yH * b, g.yH * (1 - b * g.yG) + D], [0, b, 1 - b * g.yG]];
  }
  // the shadow's length on the ground, in heights: cot(elevation), eased to 2.6 near the horizon, never reaching
  // the camera (its far end at least 42 % of the way there), never running much past half the face sideways
  function castLength(g, e, phi, tTop) {
    var cot = 2.6 * Math.tanh((1 / Math.tan(Math.max(e, 0.5) * Math.PI / 180)) / 2.6);
    var cp = Math.cos(phi), sp = Math.sin(phi);
    if (cp > 0) cot = Math.min(cot, 0.58 * g.f / (tTop * cp));
    for (var i = 0; i < 6 && Math.abs(tTop * cot * sp / (1 - tTop * cot * cp / g.f)) > 0.55 * g.W; i++) cot *= 0.85;
    return cot;
  }
  function mul3(A, B) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) for (var k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j];
    return C;
  }
  // a 3 x 3 homography as CSS (matrix3d is column-major)
  function m3d(M) {
    return 'matrix3d(' + [M[0][0], M[1][0], 0, M[2][0], M[0][1], M[1][1], 0, M[2][1], 0, 0, 1, 0, M[0][2], M[1][2], 0, M[2][2]]
      .map(function (v) { return +v.toFixed(7); }).join(',') + ')';
  }
  // the figures drawn, their shadows and their ground, into .pl, for the time `text` on a face W x H
  // (align: where across the face the figures stand -- left, as Big Weather draws them, center or right; size: % of
  // the shorter side, Big Weather's own when none -- the Screensaver editor's layout, 2026-11-01)
  function plant(pl, text, W, H, s, season, again, align, size) {
    var g = plGeometry(W, H), L = plLight(s, season);
    if (size) { g.fs = size * Math.min(W, H) / 100; g.ls = -0.04 * g.fs; }      // (the layout's size: % of the shorter side)
    pl.textContent = '';
    var t = function (parent, cls) {
      var e = el('div', 't' + (cls ? ' ' + cls : ''), text);
      e.style.fontSize = g.fs.toFixed(2) + 'px';
      e.style.letterSpacing = g.ls.toFixed(2) + 'px';
      parent.appendChild(e);
      return e;
    };
    // the type's own numbers: its line box, its baseline in it, its cap height
    var probe = t(pl, 'probe'), base0 = el('i');
    base0.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    probe.appendChild(base0);
    var box = probe.getBoundingClientRect(), base = base0.getBoundingClientRect().top - box.top;
    var bw = Math.ceil(box.width) + 2, bh = Math.ceil(box.height);
    pl.removeChild(probe);
    if (!bw || !bh || !(base > 0)) return false;              // not laid out (hidden): drawn when it is
    var cap = base * 0.72;
    try {
      var cv = document.createElement('canvas').getContext('2d');
      cv.font = '600 ' + g.fs.toFixed(2) + 'px ' + FONT;
      var m = cv.measureText('8');
      if (m && m.actualBoundingBoxAscent > 0) cap = m.actualBoundingBoxAscent;
    } catch (e) { /* the estimate */ }
    var X = align === 'center' ? (W - bw) / 2 : align === 'right' ? W - g.left - bw : g.left, Y = g.yG - base;   // its baseline on the ground line
    var boxed = function (parent) {
      var b = el('div', 'b');
      b.style.left = X.toFixed(2) + 'px'; b.style.top = Y.toFixed(2) + 'px';
      b.style.width = bw + 'px'; b.style.height = bh + 'px';
      parent.appendChild(b);
      return b;
    };
    var foot = (bh - base) / bh * 100;                        // the baseline, % up from the box's foot
    // the shadows, clipped to the meadow
    var ps = el('div', 'ps');
    ps.style.clipPath = 'inset(' + g.yT.toFixed(1) + 'px 0 0 0)';
    pl.appendChild(ps);
    var project = function (H3, alpha, blurNear, blurFar, reach) {
      var M = mul3(mul3([[1, 0, -X], [0, 1, -Y], [0, 0, 1]], H3), [[1, 0, X], [0, 1, Y], [0, 0, 1]]);
      [[blurNear, 1, 0.08, reach * 0.5], [blurFar, 0.75, 0, reach]].forEach(function (p) {
        var b = boxed(ps), fx = el('div', 'fx');
        b.style.transform = m3d(M);
        fx.style.filter = 'blur(' + p[0].toFixed(2) + 'px)';
        var a1 = foot + p[2] * cap / bh * 100, a2 = Math.min(100, foot + p[3] * cap / bh * 100);
        var mask = 'linear-gradient(to top,#000 ' + foot.toFixed(2) + '%,' + (p[2] ? '#000 ' + a1.toFixed(2) + '%,' : '') + 'transparent ' + a2.toFixed(2) + '%)';
        fx.style.webkitMaskImage = mask; fx.style.maskImage = mask;
        b.appendChild(fx);
        t(fx).style.color = rgb(L.shade, alpha * p[1]);
      });
    };
    project(castH(g, 0.55, 0), L.sky, 1.5 + 6 * L.clouds, g.fs * (0.05 + 0.05 * L.clouds), 0.9);
    if (L.cast > 0.02) project(castH(g, castLength(g, L.e, L.phi, base), L.phi), L.cast, 0.6 + 4 * L.clouds, g.fs * (0.016 + 0.05 * L.clouds), 1.15);
    // the feet on the grass
    var pc = el('div', 'pc');
    pl.appendChild(pc);
    [[0.06, -0.55, 1, 1], [0.12, -0.35, Math.max(2, g.fs * 0.008), 0.7], [0.3, -0.14, Math.max(4, g.fs * 0.018), 0.45]].forEach(function (p) {
      var b = boxed(pc), fx = el('div', 'fx');
      b.style.transformOrigin = '0 ' + base.toFixed(2) + 'px';
      b.style.transform = 'scaleY(' + p[1] + ')';
      b.style.filter = 'blur(' + p[2].toFixed(1) + 'px)';
      fx.style.clipPath = 'inset(' + (base - p[0] * cap).toFixed(1) + 'px 0 0 0)';
      b.appendChild(fx);
      t(fx).style.color = rgb(L.shade, L.contact * p[3]);
    });
    // the figures: a thin side toward the vanishing point, then the face
    var pd = el('div', 'pd');
    pl.appendChild(pd);
    var vx = g.cx - (X + bw / 2), vy = g.yH - (g.yG - cap / 2), vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var depth = Math.max(2, Math.round(g.fs * 0.022)), stack = [];
    for (var i = 1; i <= depth; i++) stack.push((vx / vl * i).toFixed(2) + 'px ' + (vy / vl * i).toFixed(2) + 'px 0 ' + rgb(mixc(L.side, mulc(L.side, 0.78), i / depth)));
    var side = t(boxed(pd));
    side.style.color = rgb(L.side);
    side.style.textShadow = stack.join(',');
    var fb = boxed(pd);
    fb.className += ' pf';
    var face = t(fb), top = (base - cap) / bh * 100, b0 = (base - 0.16 * cap) / bh * 100, b1 = base / bh * 100;
    face.style.backgroundImage =
      'linear-gradient(' + (Math.sin(L.phi) < 0 ? 'to right' : 'to left') + ',' + rgb([255, 248, 232], 0.1 * L.direct) + ',rgba(255,248,232,0) 55%,' + rgb([0, 0, 0], 0.06 * L.direct) + '),' +
      'linear-gradient(to bottom,' + rgb(mulc(L.face, 1.04)) + ' ' + top.toFixed(1) + '%,' + rgb(L.face) + ' ' + b0.toFixed(1) + '%,' +
      rgb(mixc(mulc(L.face, 0.82), L.meadow, 0.14)) + ' ' + b1.toFixed(1) + '%)';
    face.style.opacity = '0.97';
    // the grass in front of the feet, lit as the land showing is
    var img = plStrip(season, again);
    if (img) {
      var r = clamp(g.fs / g.k / 640, 0.55, 1), sc = g.k * r / 2;          // strip px to face px (640: the reference figures)
      var lead = PL_STRIP.lead * 2 * sc, x0 = X - lead, cw = Math.min(bw + 2 * lead, PL_STRIP.w * sc), ch = PL_STRIP.h * sc;
      var dpr = Math.min(2, window.devicePixelRatio || 1), cvs = el('canvas', 'pg');
      cvs.width = Math.max(1, Math.round(cw * dpr)); cvs.height = Math.max(1, Math.round(ch * dpr));
      cvs.style.cssText = 'position:absolute;left:' + x0.toFixed(2) + 'px;top:' + (g.yG - PL_STRIP.ground * sc).toFixed(2) + 'px;width:' + cw.toFixed(2) + 'px;height:' + ch.toFixed(2) + 'px';
      try {
        var c2 = cvs.getContext('2d');
        c2.drawImage(img, 0, 0, cw / sc, PL_STRIP.h, 0, 0, cvs.width, cvs.height);
        var light = window.hkSky && window.hkSky._land ? window.hkSky._land.light(L.e) : (L.e > 6 ? 'day' : L.e > -7 ? 'dusk' : 'night');
        var Mx = light === 'night' ? (PL_MEADOW[season] || PL_MEADOW.fall).n : light === 'dusk' ? (PL_MEADOW[season] || PL_MEADOW.fall).m : null;
        // the land's cloud dimming (hk-sky.js scene().update: --landB), and the sun's shadow falling toward us
        var dim = (1 - 0.3 * clamp(((Number(s.cover) || 0) - 0.4) / 0.6, 0, 1) - (s.wet && s.wet.rate > 0 ? 0.08 : 0)) *
                  (1 - 0.35 * L.cast * Math.max(0, Math.cos(L.phi)));
        if (Mx || dim < 0.995) {
          var id = c2.getImageData(0, 0, cvs.width, cvs.height), px = id.data;
          for (var q = 0; q < px.length; q += 4) {
            if (!px[q + 3]) continue;
            var R0 = px[q], G0 = px[q + 1], B0 = px[q + 2];
            if (Mx) {
              px[q] = Mx[0][0] * R0 + Mx[0][1] * G0 + Mx[0][2] * B0 + Mx[0][3];
              px[q + 1] = Mx[1][0] * R0 + Mx[1][1] * G0 + Mx[1][2] * B0 + Mx[1][3];
              px[q + 2] = Mx[2][0] * R0 + Mx[2][1] * G0 + Mx[2][2] * B0 + Mx[2][3];
            }
            px[q] *= dim; px[q + 1] *= dim; px[q + 2] *= dim;
          }
          c2.putImageData(id, 0, 0);
        }
        // faded out over its last 60 art px
        var fade = c2.createLinearGradient(cvs.width - lead * dpr, 0, cvs.width, 0);
        fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
        c2.globalCompositeOperation = 'destination-out';
        c2.fillStyle = fade;
        c2.fillRect(cvs.width - lead * dpr, 0, lead * dpr, cvs.height);
        pl.appendChild(cvs);
      } catch (e) { /* no canvas: no grass */ }
    }
    return true;
  }

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
      try { face = C.mount(clk, { style: has ? 'numbers' : 'analog', bg: 'none', scrim: false, drift: false, h24: x.h24, still: x.still, minutely: true, client: x.client() }); } catch (e) {
        face = null; }
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
      O.sprites.forEach(function (s, i) {
        var im = el('img', motionOf(s[0]) || null); im.alt = ''; im.src = SKY + s[0];
        im.style.cssText = 'left:' + s[1] + '%;top:' + s[2] + '%;width:' + s[3] + 'cqmin;height:' + s[3] + 'cqmin;object-fit:contain;' +
                           'transform:translate(-50%,-50%) rotate(' + s[4] + 'deg);opacity:' + s[5] + ';--x:' + s[1] + 'cqw;--y:' + s[2] + 'cqh;--k:' + (-i * 5.3).toFixed(1) + 's';
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
    var cn = el('div', 'cn'), tm = el('div', 'tm'), tpb = el('div', 'tp'), tp = el('span', 'tpn'), rd = el('div', 'rd'), pl = el('div', 'pl');
    tpb.appendChild(tp);
    inn.append(pl, cn, tm, tpb, rd);
    var key = null, plKey = null;
    // (the grass's art arrived after the figures were drawn: drawn again with it)
    x.replant = function () { plKey = null; x.paint(); };
    var bigClock = x.big === 'clock';
    if (bigClock) r.className += ' bigclock';
    return function (d) {
      // (the big number the time: the temperature takes the time's place, top right)
      if (bigClock) put(tp, hm(d, x.h24)); else put(tm, hm(d, x.h24));
      // THE PLANTED NUMERALS: the time standing in the meadow, while the sky's reading says there is one
      var s = bigClock && x.planted ? x.sky : null;
      if (s) {
        var W = r.clientWidth, H = r.clientHeight, txt = hm(d, x.h24), season = x.season(s);
        var pk = [txt, W, H, Math.round(s.elev * 2), Math.round(s.azim), Math.round((s.cover || 0) * 50), season].join('|');
        if (pk !== plKey) plKey = W && H && plant(pl, txt, W, H, s, season, x.replant) ? pk : null;
      } else if (plKey !== null || pl.firstChild) { pl.textContent = ''; plKey = null; }
      r.classList.toggle('planted', plKey !== null);
      var c = x.client(), np = !!playing(c && c.states);
      if (/\bnp\b/.test(r.className) !== np) r.className = r.className.replace(/ np\b/g, '') + (np ? ' np' : '');
      var w = x.weather(), k = w ? JSON.stringify([w.temp, w.cond, w.hi, w.lo, w.sunset && w.sunset.getTime(), w.wind, w.humidity, w.aqi, d.getHours() >= 12]) : '';
      if (k === key) return;
      key = k;
      cn.textContent = ''; rd.textContent = '';
      if (!w) { put(bigClock ? tm : tp, ''); if (x.onReadings) x.onReadings(0); return; }
      cn.innerHTML = wxGlyph(w.cond);
      cn.appendChild(el('span', null, w.says));
      if (w.hi != null || w.lo != null) { cn.appendChild(el('br')); cn.appendChild(el('span', 'hl', 'H:' + deg(w.hi) + ' L:' + deg(w.lo))); }
      put(bigClock ? tm : tp, deg(w.temp));
      var cols = [];
      if (w.sunset) cols.push([G.sunset, hm(w.sunset, x.h24) + (x.h24 ? '' : (w.sunset.getHours() < 12 ? ' AM' : ' PM')), 'Sunset']);
      if (w.wind != null) cols.push([G.wind, Math.round(w.wind) + ' ' + (w.windUnit || ''), 'Wind']);
      if (w.humidity != null) cols.push([G.drop, Math.round(w.humidity) + '%', 'Humidity']);
      if (w.aqi != null) cols.push([G.aqi, String(w.aqi), 'AQI']);
      rd.style.setProperty('--n', String(Math.max(1, cols.length)));
      // (how many: upright they take one row or two, and what the screensaver plays sits above them)
      if (x.onReadings) x.onReadings(cols.length);
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
    var HS = window.hkSettings, flat = !!(HS && HS.rendering && HS.rendering().flat);
    // (the Day face's art moves, but under Flat -- the look that spares a tablet -- or in a still preview)
    var root = el('div', 'hkf ' + kind + (kind === 'day' && !flat && !opts.still ? ' live' : '')), css = el('style'), ground = el('div', 'ckbg'), inn = el('div', 'in');
    css.textContent = CSS;
    root.append(css);
    if (kind !== 'weather') root.appendChild(ground);       // (Big Weather: the forecast's sky is its ground)
    root.appendChild(inn);
    layer.appendChild(root);
    var client = opts.client || null, dead = false, fc = null, fcFor = '', daily = [];
    var x = {
      h24: !!opts.h24, look: opts.look || 'auto', big: opts.big === 'clock' ? 'clock' : 'temp', clocks: opts.clocks || window.hkSaverClock || null, still: !!opts.still, parts: [],
      onReadings: typeof opts.onReadings === 'function' ? opts.onReadings : null,
      // Big Weather's time planted in the meadow (opts.planted, on unless false) and the sky's reading it is lit by
      planted: opts.planted !== false, sky: opts.sky || null,
      season: function (s) {
        var K = window.hkSky && window.hkSky._land;
        try { return (K && K.season(client, s)) || 'fall'; } catch (e) { return 'fall'; }
      },
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
    // (groundOnly: the face's ground and nothing on it -- the Screensaver editor's layout puts its own things there)
    // (...the Day face's art is its ground too: drawn under a layout, its words left out -- phase 13, the Day's Art was
    // blank under a layout)
    var tick = opts.groundOnly && kind !== 'day' ? function () {} : BUILD[kind](root, inn, x);
    if (opts.groundOnly && kind === 'day') root.classList.add('artonly');
    var paint = function () { if (!dead) { try { tick(new Date()); } catch (e) { console.warn('[hk-saverfaces]', kind, e && e.message); } } };
    x.paint = paint;
    paint();
    // once a minute, on the minute (a preview: drawn once)
    var tS = null, tT = null;
    if (!opts.still) tS = setTimeout(function () { paint(); tT = setInterval(paint, 60000); }, 60000 - Date.now() % 60000);
    // (the planted numerals are placed in px: drawn again when the face's size changes)
    var ro = kind === 'weather' && typeof ResizeObserver === 'function' ? new ResizeObserver(function () { paint(); }) : null;
    if (ro) ro.observe(root);
    return {
      kind: kind,
      // Big Weather: the sky's reading (hk-sky.js read(): elev, azim, cover), or null where there is no landscape
      light: function (s) { x.sky = s || null; paint(); },
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
        if (ro) ro.disconnect();
        if (fc) { fc.release(); fc = null; }
        x.parts.forEach(function (p) { if (p && p.destroy) { try { p.destroy(); } catch (e) { /* gone */ } } });
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  window.hkSaverFaces = { KINDS: KINDS.slice(), mount: mount, plant: plant, _: { monthGrid: monthGrid, occasionOf: occasionOf, playing: playing, dayDark: dayDark, hm: hm,
    plGeometry: plGeometry, plLight: plLight, castH: castH, castLength: castLength,
    motionOf: motionOf, groundOf: groundOf, luminance: luminance, inkOn: inkOn, inkFor: inkFor, CSS: CSS } };
})();
