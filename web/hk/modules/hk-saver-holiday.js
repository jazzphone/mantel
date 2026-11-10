// @ts-check
// hk-saver-holiday.js -- THE SCREENSAVER'S HOLIDAY SLIDE (phase 20, docs/phase20/HOLIDAY-SLIDE.md): how many days
// until the next holiday, themed for it. Christmas, Halloween, Thanksgiving and New Year's wear a painted scene (a 90s
// living room, a haunted house, a 90s dining room, a rooftop party: hk-saver-holiday-scenes.js) with the count on its
// live part -- the TV's on-screen display, carved in the tombstone, chalk on the board, a split-flap board; every other
// holiday stands outdoors on the sky's landscapes over the Live Sky (Sky Only), a rounded number on the meadow. Along
// the bottom, as Home Energy's: the countdown in weeks and weekends, and the next three holidays. The effects are
// hk-saver-holiday-fx.js's; the dates hk-holidays.js's. The approved mock-up (docs/phase20/mockup/holiday-slide.html)
// is the reference: its layouts, words, shadows, effects and arrivals are what this draws.
//
// It draws NO time, date, weather or status of its own: the slide corner does (hkSaverLayout SLIDES.holiday), so Time
// Size and the corner's switches apply unchanged. Tapping it only wakes the screen, as any tap does.
//
// Loaded by hk-saver.js only when a screen shows the Holiday slide -- never on its own.
//
// WHAT IT COSTS A WALL TABLET, by design:
//   - ONE LAYER FOR GOOD, hidden by its opacity, as .en and .wx are: never rebuilt at a turn
//   - its background drawn once per layout (cached by scene, size, foot and scale); only the effects canvas redraws,
//     at 30 frames a second (20 at Gentle), and only while the slide is up; a still picture under Effects Off, Reduce
//     Motion, Flat or Sky Animations off
//   - the scene's pieces and its font asked for at the start (ready), so its first turn has them; until they have
//     all loaded, it shows its outdoor version
//
//   hkSaverHoliday.create({ cfg, h24 }) -> ctl
//     ctl.el                  the layer (hk-saver.js puts it in its root)
//     ctl.ready(client)       a holiday within the window (its art asked for)
//     ctl.draw(client)        fill it in now, its effects running
//     ctl.arrived()           the fade is done: the TV powers on, the chalk writes, the flaps settle, the number rolls
//     ctl.layout(W, H)        the room it has (beside any pane)
//     ctl.setClient(client), setCfg(cfg), leave(), destroy(), info()
(function () {
  'use strict';
  if (window.hkSaverHoliday) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var ROUNDED = 'ui-rounded,"SF Pro Rounded","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var SKY = '/hk/sky/', ART = '/hk/holiday/';
  function url(u) { return window.hkV ? window.hkV(u) : u; }
  // the parts its row can leave out (settings.py SAVER_HOLIDAY_PARTS)
  var PARTS = ['count', 'next'];
  // each scene's font (web/hk/holiday/fonts/, SIL Open Font License), loaded only when its scene shows
  var FONTS = {
    room: ['HK VT323', 'vt323.woff2', { weight: '400' }],
    haunt: ['HK Cinzel', 'cinzel.woff2', { weight: '600 800' }],
    thanks: ['HK Cabin Sketch', 'cabin-sketch-bold.woff2', { weight: '700' }],
    newyear: ['HK Oswald', 'oswald-500.woff2', { weight: '500' }]
  };
  // the outdoor sky under Flat (no Live Sky): its four stops by the light
  var SKYG = { night: ['#040916', '#0a1730', '#132a4c', '#1f3a60'], dusk: ['#191b4b', '#4e3172', '#b65a70', '#efa06c'], day: ['#2f6fb8', '#5a9ad6', '#a2cdee', '#dcecf6'] };
  // the landscapes with a lit overlay (the sky's -lights.webp and holiday.json's bulbs)
  var LIGHTS = { 'christmas-dusk': 1, 'christmas-night': 1, 'halloween-dusk': 1, 'halloween-night': 1, 'july4-night': 1 };

  var CSS = [
    // ONE LAYER FOR GOOD, hidden by its opacity alone, as Home Energy's and the weather's
    '.hkhol{position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;overflow:hidden;background:#050b18;will-change:opacity;',
    '  font-family:' + FONT + ';color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.28);--z:1;--m:48px;',
    '  transition:opacity var(--hk-hl-fade,3000ms) ease}',
    '.hkhol.on{opacity:1}',
    // (what moves in CSS -- the fog, the TV's roll bar, the VCR's 12:00 -- holds still while it is not up, and never
    // under a still picture)
    '.hkhol:not(.on) *,.hkhol:not(.on) *::before,.hkhol:not(.on) *::after{animation-play-state:paused!important}',
    '.hkhol[still] *,.hkhol[still] *::before,.hkhol[still] *::after{animation:none!important}',
    '.hkhol .hlsky,.hkhol .hlland,.hkhol .hllights,.hkhol .hlwash{position:absolute;inset:0}',
    '.hkhol .hlsky > #hk-sky{position:absolute;inset:0}',
    '.hkhol .hlland,.hkhol .hllights{background-size:cover;background-position:center bottom;background-repeat:no-repeat}',
    '.hkhol .hlov{position:absolute;background-position:center;background-size:contain;background-repeat:no-repeat}',
    '.hkhol .hlwash{background:linear-gradient(180deg,rgba(4,10,24,.2),rgba(4,10,24,0) 32%,rgba(4,10,24,.04) 50%,rgba(4,10,24,.62))}',
    '.hkhol[light=day] .hlwash{background:linear-gradient(180deg,rgba(6,24,56,.34),rgba(6,24,56,.08) 34%,rgba(6,24,56,.2) 52%,rgba(6,20,30,.72))}',
    '.hkhol[light=dusk] .hlwash{background:linear-gradient(180deg,rgba(10,10,40,.3),rgba(10,10,40,0) 36%,rgba(10,10,30,.14) 52%,rgba(8,6,24,.66))}',
    '.hkhol .hlfog{position:absolute;left:-30%;right:-30%;height:34%;bottom:12%;background-size:100% 100%;opacity:.3;display:none;animation:hlfog 46s ease-in-out infinite alternate}',
    '@keyframes hlfog{from{transform:translateX(-7%)}to{transform:translateX(7%)}}',
    '.hkhol .hlweb{position:absolute;display:none;opacity:.55;background-size:contain;background-repeat:no-repeat;transform:scaleX(-1)}',
    '.hkhol canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}',
    '.hkhol canvas.hlpaint{z-index:1;display:none}',
    '.hkhol canvas.hlpaint2{z-index:3;display:none}',
    '.hkhol canvas.hlfx{z-index:3}',
    '.hkhol:not([scene=land]) canvas.hlpaint,.hkhol[scene=haunt] canvas.hlpaint2{display:block}',
    // a scene's own picture: no sky, no land, no outdoor number
    '.hkhol:not([scene=land]) .hlsky,.hkhol:not([scene=land]) .hlland,.hkhol:not([scene=land]) .hllights,.hkhol:not([scene=land]) .hlovs,',
    '.hkhol:not([scene=land]) .hlhero,.hkhol:not([scene=land]) .hlweb{display:none!important}',
    '.hkhol:not([scene=land]):not([scene=haunt]) .hlfog{display:none!important}',
    '.hkhol[scene=room] .hlwash,.hkhol[scene=thanks] .hlwash{background:linear-gradient(180deg,rgba(6,10,8,.34),rgba(6,10,8,0) 30%,rgba(6,4,2,0) 70%,rgba(8,5,3,.82));z-index:2}',
    '.hkhol[scene=haunt] .hlwash,.hkhol[scene=newyear] .hlwash{background:linear-gradient(180deg,rgba(4,6,20,.1),rgba(4,6,20,0) 40%,rgba(2,3,8,.8));z-index:2}',
    '.hkhol[scene=haunt] .hlfog{display:block!important;z-index:2;bottom:16%;opacity:.26}',
    // THE HERO OUTDOORS: the number standing on the meadow, then what it counts down to
    '.hkhol .hlhero{position:absolute;left:var(--m);right:var(--m);bottom:var(--herob,120px);display:flex;align-items:flex-end;gap:calc(34px*var(--z))}',
    '.hkhol .num{position:relative;z-index:4;flex:none;font-family:' + ROUNDED + ';font-weight:700;line-height:.8;font-size:var(--nf,300px);',
    '  color:var(--numc,#fffaf0);text-shadow:0 calc(10px*var(--z)) calc(22px*var(--z)) rgba(0,8,24,.5),0 0 calc(50px*var(--z)) var(--numg,transparent);white-space:nowrap;padding-bottom:calc(6px*var(--z));font-variant-numeric:lining-nums}',
    '.hkhol .num.foil{background:linear-gradient(180deg,#fff7d8 8%,#f4cb68 52%,#b98a2f 96%);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 calc(4px*var(--z)) calc(14px*var(--z)) rgba(0,8,24,.65))}',
    '.hkhol .words{position:relative;z-index:6;min-width:0;padding-bottom:calc(14px*var(--z))}',
    '.hkhol .eye{font-size:calc(15px*var(--z));font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.82}',
    '.hkhol .hdl{font-size:var(--hf,74px);font-weight:700;letter-spacing:-.018em;line-height:1.02;margin:calc(4px*var(--z)) 0 calc(6px*var(--z));text-wrap:balance;text-shadow:0 2px 16px rgba(0,8,24,.5)}',
    '.hkhol .dt{font-size:calc(22px*var(--z));font-weight:500;opacity:.92}',
    // the day itself: the greeting takes the whole row
    '.hkhol .hlhero.day{flex-direction:column;align-items:center;gap:calc(8px*var(--z))}',
    '.hkhol .hello{position:relative;z-index:4;text-align:center;font-family:' + ROUNDED + ';font-weight:700;line-height:1.02;font-size:var(--gf,120px);color:var(--numc,#fff);text-shadow:0 4px 26px rgba(0,8,24,.6),0 0 50px var(--numg,transparent)}',
    '.hkhol .hello span{white-space:nowrap}',
    '.hkhol[tall] .hello span{display:block}',
    '.hkhol .hlhero.day .words{text-align:center;padding-bottom:calc(6px*var(--z))}',
    '.hkhol[tall] .hlhero{flex-direction:column;align-items:center;gap:calc(10px*var(--z))}',
    '.hkhol[tall] .words{text-align:center}',
    // ALONG THE BOTTOM, standing apart, as Home Energy's row
    '.hkhol .enfoot{position:absolute;z-index:6;left:var(--m);right:var(--m);bottom:calc(26px*var(--z));display:flex;justify-content:space-between;gap:calc(40px*var(--z));align-items:flex-start;border-top:1px solid rgba(255,255,255,.2);padding-top:calc(14px*var(--z))}',
    '.hkhol .enfoot:empty{display:none}',
    '.hkhol .fg .gh{font-size:calc(13px*var(--z));font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.92;margin-bottom:calc(8px*var(--z))}',
    '.hkhol .fg .its{display:flex;gap:calc(36px*var(--z));align-items:flex-start}',
    '.hkhol .fg.mo{margin-left:auto;padding-left:calc(36px*var(--z));border-left:1px solid rgba(255,255,255,.2)}',
    '.hkhol .fg.mo:first-child{margin-left:0;padding-left:0;border-left:0}',
    '.hkhol .enfoot .k{font-size:calc(13px*var(--z));font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.75;white-space:nowrap}',
    '.hkhol .enfoot .k b{display:inline-block;width:calc(8px*var(--z));height:calc(8px*var(--z));border-radius:50%;margin-right:calc(6px*var(--z));vertical-align:calc(1px*var(--z))}',
    '.hkhol .enfoot .v{font-size:calc(30px*var(--z));font-weight:700;letter-spacing:-.6px;margin-top:calc(3px*var(--z));font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.hkhol .enfoot .v u{text-decoration:none;font-weight:600;opacity:.75;letter-spacing:0;font-size:calc(17px*var(--z));margin-left:calc(4px*var(--z))}',
    '.hkhol .enfoot .pace{font-size:calc(15px*var(--z));font-weight:500;opacity:.75;margin-left:calc(8px*var(--z));letter-spacing:0}',
    '.hkhol[narrow] .enfoot{flex-direction:column;gap:calc(10px*var(--z));padding-top:calc(11px*var(--z))}',
    '.hkhol[narrow] .fg{display:grid;width:100%;grid-template-columns:calc(112px*var(--z)) minmax(0,1fr);gap:calc(14px*var(--z));align-items:center}',
    '.hkhol[narrow] .fg .gh{margin:0}',
    '.hkhol[narrow] .fg .its{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:calc(12px*var(--z))}',
    '.hkhol[narrow] .fg.mo{margin:0;padding:calc(10px*var(--z)) 0 0;border-left:0;border-top:1px solid rgba(255,255,255,.2)}',
    '.hkhol[narrow] .fg.mo:first-child{padding-top:0;border-top:0}',
    '.hkhol[tall] .enfoot{flex-direction:column;gap:calc(14px*var(--z))}',
    '.hkhol[tall] .fg.mo{margin-left:0;padding-left:0;border-left:0}',
    '.hkhol[tall] .fg .its{flex-wrap:wrap;row-gap:calc(10px*var(--z))}',
    // THE LIVE PARTS, sized from their painted piece (--t: the piece's width)
    '.hkhol .hlprop{position:absolute;z-index:4;left:0;top:0;width:0;height:0}',
    // CHRISTMAS: the TV picture in the entertainment center's screen opening, as a VCR's blue on-screen display
    '.hkhol .tv{position:absolute;text-shadow:none}',
    '.hkhol .scr{position:absolute;inset:0;overflow:hidden;border-radius:9% / 11%;background:radial-gradient(ellipse at 50% 45%,#1d3ff0 0,#1230d2 52%,#071a8a 100%)}',
    '.hkhol .osd{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:calc(var(--t)*.02) calc(var(--t)*.05);color:#fff;font-family:"HK VT323","Courier New",monospace;text-shadow:0 0 calc(var(--t)*.012) rgba(190,215,255,.75);text-transform:uppercase;text-align:center;transform-origin:50% 50%}',
    '.hkhol .osdt{position:absolute;left:calc(var(--t)*.05);right:calc(var(--t)*.05);top:calc(var(--t)*.032);display:flex;justify-content:space-between;font-size:calc(var(--t)*.05);line-height:1;letter-spacing:.04em}',
    '.hkhol .osd .big{font-size:calc(var(--t)*.47);line-height:.74;letter-spacing:-.01em;margin-top:calc(var(--t)*.052)}',
    '.hkhol .osd .gr{font-size:calc(var(--t)*.156);line-height:.86;margin-top:calc(var(--t)*.03)}',
    '.hkhol .osdl{font-size:calc(var(--t)*.083);line-height:1;margin-top:calc(var(--t)*.026);white-space:nowrap}',
    '.hkhol .osdd{font-size:calc(var(--t)*.054);line-height:1;margin-top:calc(var(--t)*.012);opacity:.92;white-space:nowrap}',
    '.hkhol .scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgba(0,0,20,.2) 0 1px,rgba(255,255,255,.015) 1px 3px)}',
    '.hkhol .scan::before{content:"";position:absolute;left:0;right:0;height:16%;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.06),rgba(255,255,255,0));animation:hlroll 9s linear infinite}',
    '.hkhol .scan::after{content:"";position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.12) 0,rgba(255,255,255,.02) 26%,rgba(255,255,255,0) 40%)}',
    '@keyframes hlroll{from{transform:translateY(-120%)}to{transform:translateY(720%)}}',
    '.hkhol .tv.power .osd{animation:hlcrt 1s cubic-bezier(.22,.8,.25,1) both}',
    '@keyframes hlcrt{0%{transform:scale(1,.006);filter:brightness(5);opacity:0}7%{opacity:1}36%{transform:scale(1,.006);filter:brightness(5)}72%{transform:scale(1,1.03);filter:brightness(1.6)}100%{transform:none;filter:none}}',
    // ...and 12:00 flashing in the VCR's clock window
    '.hkhol .vcr{position:absolute;display:flex;align-items:center;justify-content:center;text-shadow:none}',
    '.hkhol .vcr span{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#020a05;font:400 calc(var(--vh)*.62)/1 "HK VT323","Courier New",monospace;color:#66ffa0;text-shadow:0 0 6px #33ff88;animation:hlblink 1.1s steps(1) infinite}',
    '@keyframes hlblink{0%,54%{opacity:1}55%,100%{opacity:.08}}',
    // HALLOWEEN: carved into the stone
    '.hkhol .stn{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#17191d;font-family:"HK Cinzel","Times New Roman",serif;text-shadow:0 1px 0 rgba(255,255,255,.3),0 -1px 0 rgba(0,0,0,.45);padding:15% 14% 10%;box-sizing:border-box}',
    '.hkhol .stn .e1{font-size:calc(var(--t)*.052);font-weight:600;letter-spacing:.24em;text-transform:uppercase;opacity:.86}',
    '.hkhol .stn .big{font-size:calc(var(--t)*.47);font-weight:800;line-height:.88;font-variant-numeric:lining-nums;margin:calc(var(--t)*.006) 0}',
    '.hkhol .stn .gr{font-size:calc(var(--t)*.128);font-weight:800;line-height:1.02;text-transform:uppercase;margin-bottom:calc(var(--t)*.03)}',
    '.hkhol .stn .e3{font-size:calc(var(--t)*.112);font-weight:800;line-height:1;text-transform:uppercase;letter-spacing:.015em;white-space:nowrap}',
    '.hkhol .stn .e4{font-size:calc(var(--t)*.043);font-weight:600;line-height:1.2;margin-top:calc(var(--t)*.02);white-space:nowrap}',
    // THANKSGIVING: chalk on the board's face (x 6-94 %, y 8-92 %), written on line by line as it arrives
    '.hkhol .chalk{position:absolute;text-shadow:none}',
    '.hkhol .chalk .cw{position:absolute;left:7%;right:7%;top:9%;bottom:9%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;',
    '  font-family:"HK Cabin Sketch","Comic Sans MS",cursive;font-weight:700;color:rgba(246,243,232,.93);filter:drop-shadow(0 0 1px rgba(255,255,255,.35))}',
    '.hkhol .chalk .c1{font-size:calc(var(--t)*.06);transform:rotate(-3deg)}',
    '.hkhol .chalk .cbig{font-size:calc(var(--t)*.36);line-height:.9}',
    '.hkhol .chalk .cg{font-size:calc(var(--t)*.13);line-height:1}',
    '.hkhol .chalk .c2{font-size:calc(var(--t)*.074);line-height:1.05;margin-top:calc(var(--t)*.01)}',
    '.hkhol .chalk .c3{font-size:calc(var(--t)*.046);opacity:.82;margin-top:calc(var(--t)*.02)}',
    '.hkhol .chalk .c2 i{font-style:normal;color:#ffb36b}',
    '.hkhol .chalk.write .cw > *{animation:hlchalk .9s steps(16) both}',
    '.hkhol .chalk.write .cw > :nth-child(2){animation-delay:.6s;animation-duration:.7s}',
    '.hkhol .chalk.write .cw > :nth-child(3){animation-delay:1.25s;animation-duration:1.1s}',
    '.hkhol .chalk.write .cw > :nth-child(4){animation-delay:2.2s}',
    '@keyframes hlchalk{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}',
    // NEW YEAR'S: split flaps in the board's opening (x 5.5-94.5 %, y 9.9-88.8 %), the board's frame over them
    // (its letters .flc, never .fc: the screensaver's Forecast layer is .fc, hidden until it is up -- every letter of
    // the New Year board was hidden with it, 2026-11-09)
    '.hkhol .flap{position:absolute;text-shadow:none}',
    '.hkhol .flap .fbd{position:absolute;inset:0;background-position:center;background-size:100% 100%;background-repeat:no-repeat;pointer-events:none}',
    '.hkhol .flap .fin{position:absolute;left:5.5%;top:9.9%;width:89%;height:78.9%;background:#0b0b0d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--t)*.022)}',
    '.hkhol .flap .fr{display:flex;gap:calc(var(--t)*.007)}',
    '.hkhol .flap .flc{position:relative;display:block;width:calc(var(--t)*.067);height:calc(var(--t)*.092);line-height:calc(var(--t)*.092);text-align:center;font-family:"HK Oswald","Arial Narrow",sans-serif;font-weight:500;',
    '  font-size:calc(var(--t)*.07);color:#f2efe6;border-radius:calc(var(--t)*.005);background:linear-gradient(180deg,#232327 0,#1a1a1d 49.2%,#030303 49.2%,#030303 50.8%,#151518 50.8%,#0f0f11 100%);',
    '  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 2px rgba(0,0,0,.8)}',
    '.hkhol .flap .fr.big .flc{width:calc(var(--t)*.15);height:calc(var(--t)*.24);line-height:calc(var(--t)*.24);font-size:calc(var(--t)*.2)}',
    '.hkhol .flap .fr.big .flc.gold{color:#f4cb68}',
    '.hkhol .flap .flc.fl{animation:hlflip .09s linear}',
    '@keyframes hlflip{0%{transform:scaleY(1)}50%{transform:scaleY(.08)}100%{transform:scaleY(1)}}'
  ].join('\n');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function HH() { return window.hkHolidays; }
  function tz() { return window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined; }
  function tag() { return window.hkLocale && window.hkLocale.tag ? window.hkLocale.tag() : 'en-US'; }
  // a holiday's date parts as words (the parts are the house's calendar date: drawn in UTC, so no zone moves them)
  function fmt(p, o) { o = Object.assign({ timeZone: 'UTC' }, o); return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString(tag(), o); }
  function motion() {
    var HS = window.hkSettings;
    try {
      if (HS && HS.skyLook) return HS.skyLook().animations !== false;
      if (HS && HS.rendering && !HS.rendering().motion) return false;
      return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return true; }
  }
  function flat() { var HS = window.hkSettings; try { return !!(HS && HS.rendering && HS.rendering().flat); } catch (e) { return false; } }

  // THE LIVE PARTS' WORDS
  function tvHtml(h, n) {
    var d = esc(fmt(h.date, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ''));
    var body = n === 0 ? '<div class="big gr">' + h.hello.map(esc).join('<br>') + '</div><div class="osdd" style="margin-top:calc(var(--t)*.03)">' + d + '</div>'
      : '<div class="big hlnum">' + n + '</div><div class="osdl">' + (n === 1 ? 'Day' : 'Days') + ' Until ' + esc(h.name) + '</div><div class="osdd">' + d + '</div>';
    return '<div class="tv"><div class="scr"><div class="osd"><div class="osdt"><span>&#9654; Play</span><span>SP</span></div>' + body + '</div><div class="scan"></div></div></div>' +
      '<div class="vcr"><span>12:00</span></div>';
  }
  function chalkHtml(h, n) {
    var d = esc(fmt(h.date, { weekday: 'long', month: 'short', day: 'numeric' }).replace('Nov ', 'Nov. '));
    return '<div class="chalk"><div class="cw">' + (n === 0 ? '<div class="c1">Today is</div><div class="cg">Happy<br>' + esc(h.name) + '!</div><div class="c3">' + d + '</div>'
      : '<div class="c1">Only</div><div class="cbig hlnum">' + n + '</div><div class="c2">' + (n === 1 ? 'day' : 'days') + ' &rsquo;til <i>' + esc(h.name) + '!</i></div><div class="c3">' + d + '</div>') + '</div></div>';
  }
  // the board's rows: the number big, then two rows of words
  function flapRows(h, n) {
    if (n === 0) return [[String(h.date.y), 'big gold'], ['HAPPY NEW', ''], ['YEAR!', '']];
    return [[String(n), 'big'], [(n === 1 ? 'DAY' : 'DAYS') + ' UNTIL', ''], ['NEW YEAR’S', '']];
  }
  function flapHtml(h, n) {
    return '<div class="flap"><div class="fin">' + flapRows(h, n).map(function (r) {
      return '<div class="fr ' + r[1] + '">' + r[0].split('').map(function (ch) { return '<span class="flc' + (r[1].indexOf('gold') >= 0 ? ' gold' : '') + '" data-c="' + esc(ch) + '">' + (ch === ' ' ? '&nbsp;' : esc(ch)) + '</span>'; }).join('') + '</div>';
    }).join('') + '</div><div class="fbd"></div></div>';
  }
  function stoneHtml(h, n) {
    var d = esc(fmt(h.date, { weekday: 'long', month: 'long', day: 'numeric' }));
    return '<div class="stn">' + (n === 0 ? '<div class="gr">' + h.hello.map(esc).join('<br>') + '</div><div class="e4">' + d + '</div>'
      : '<div class="e1">Only</div><div class="big hlnum">' + n + '</div><div class="e1">' + (n === 1 ? 'Day' : 'Days') + ' Until</div><div class="e3">' + esc(h.name) + '</div><div class="e4">' + d + '</div>') + '</div>';
  }

  var posJson = null, posAsked = false;
  function skyLights(then) {
    if (posJson || posAsked) { if (posJson && then) then(); return; }
    posAsked = true;
    try { fetch(url(SKY + 'holiday.json')).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { posJson = j || {}; if (then) then(); }).catch(function () { posJson = {}; }); }
    catch (e) { posJson = {}; }
  }
  var fontState = {};
  function loadFont(sc, then) {
    var f = FONTS[sc];
    if (!f || fontState[sc] === 'ok' || fontState[sc] === 'fail') return;
    if (fontState[sc] === 'loading') return;
    fontState[sc] = 'loading';
    try {
      var face = new FontFace(f[0], 'url("' + url(ART + 'fonts/' + f[1]) + '") format("woff2")', Object.assign({ style: 'normal', display: 'block' }, f[2]));
      document.fonts.add(face);
      face.load().then(function () { fontState[sc] = 'ok'; if (then) then(); }, function () { fontState[sc] = 'fail'; });
    } catch (e) { fontState[sc] = 'fail'; }
  }

  function create(opts) {
    opts = opts || {};
    var el = document.createElement('div');
    // (hkhol, never 'hl': its <style> sits in the screensaver's shadow root and reaches every element there, and
    // Big Weather's and the Weather slide's high/low lines are .hl -- they took this layer's dark background and
    // will-change, a black box over the Forecast on the wall tablets while a Holiday slide was in the show, 2026-11-09)
    el.className = 'hkhol';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('scene', 'land');
    el.innerHTML = '<style>' + CSS + '</style><div class="hlsky"></div><canvas class="hlpaint"></canvas><canvas class="hlpaint2"></canvas>' +
      '<div class="hlland"></div><div class="hllights"></div><div class="hlovs"></div><div class="hlfog"></div><div class="hlwash"></div>' +
      '<div class="hlweb"></div><div class="hlhero"></div><canvas class="hlfx"></canvas><div class="hlprop"></div><div class="enfoot"></div>';
    var $ = function (s) { return el.querySelector(s); };
    var paintC = $('.hlpaint'), paint2 = $('.hlpaint2'), fxC = $('.hlfx'), heroEl = $('.hlhero'), footEl = $('.enfoot'), prop = $('.hlprop');
    var cfg = opts.cfg || {}, client = null, alive = true, showing = false, turn = 0;
    var cur = null, curKey = '', today = null, W = 0, H = 0, Z = 1, M = 48, sky = null, data = null, clockT = null, rollT = 0, flipT = null, again = null;
    var fx = window.hkHolidayFx.create(fxC, {
      sprite: function (n) { return url(SKY + n); },
      num: function () { var out = [], n = heroEl.querySelector('.num'), g = heroEl.querySelector('.hello'); if (n) out.push(n); if (g) g.querySelectorAll('span').forEach(function (s) { out.push(s); }); return out; }
    });

    function optsOf() {
      var HS = window.hkSettings, bd = HS && HS.get ? HS.get('sky.birthdays', []) : [];
      return { tz: tz(), off: cfg.holiday_off || [], own: cfg.holiday_own || [], birthdays: Array.isArray(bd) ? bd : [],
               pick: cfg.holiday_pick || 'next', one: cfg.holiday_one || 'christmas', days: cfg.holiday_days || 60 };
    }
    // the holiday this turn shows (Take Turns: the next of them each time the slide comes)
    function choose(advance) {
      var H0 = HH();
      if (!H0) return null;
      var o = optsOf();
      today = H0.today(Date.now(), o.tz);
      o.turn = turn;
      var h = H0.pick(today, o);
      if (h && advance && o.pick === 'turns') turn++;
      return h;
    }
    // the scene it wears: its painted one, unless Holiday Options sent it outdoors or its pieces aren't all here yet
    function sceneOf(h) {
      if (!h || !h.scene || (cfg.holiday_outdoors || []).indexOf(h.id) >= 0) return '';
      var S = window.hkHolidayScenes;
      return S && S.ready(h.scene) ? h.scene : '';
    }
    function wanted(h) { return !!(h && h.scene && (cfg.holiday_outdoors || []).indexOf(h.id) < 0); }
    // its art asked for now, so the first turn has it; once here, a slide on screen is drawn again with it
    function prep(h) {
      var S = window.hkHolidayScenes;
      if (wanted(h) && S) S.load(h.scene, function (ok) { if (ok && alive && showing && cur && cur.id === h.id) render(false); });
      if (wanted(h)) loadFont(h.scene, function () { if (alive && showing) render(false); });
      skyLights();
    }
    function light() {
      if (!cur) return 'night';
      var st = client && client.states && client.states['sun.sun'], el0 = st && st.attributes ? Number(st.attributes.elevation) : NaN;
      var L = window.hkSky && window.hkSky._land;
      if (isFinite(el0) && L && L.light) return L.light(el0);
      return cur.light || 'night';
    }

    // THE WORDS: the outdoor hero, or the scene's live part, and the row along the bottom
    function words() {
      var h = cur, n = h.days, sc = sceneOf(h), hide = cfg.holiday_hide || [];
      el.style.setProperty('--numc', h.c || '#fff'); el.style.setProperty('--numg', h.g || 'transparent');
      prop.innerHTML = sc === 'room' ? tvHtml(h, n) : sc === 'haunt' ? stoneHtml(h, n) : sc === 'thanks' ? chalkHtml(h, n) : sc === 'newyear' ? flapHtml(h, n) : '';
      var dateTxt = esc(fmt(h.date, { weekday: 'long', month: 'long', day: 'numeric', year: h.year ? 'numeric' : undefined }));
      if (sc) { heroEl.className = 'hlhero'; heroEl.innerHTML = ''; }
      else if (n === 0) {
        heroEl.className = 'hlhero day';
        heroEl.innerHTML = '<div class="hello">' + h.hello.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join(' ') + '</div>' +
          '<div class="words"><div class="dt">' + (h.own ? 'Here at last' : dateTxt) + '</div></div>';
      } else {
        heroEl.className = 'hlhero';
        heroEl.innerHTML = '<div class="num hlnum' + (h.foil ? ' foil' : '') + '">' + n + '</div><div class="words"><div class="eye">' + (n === 1 ? 'Day Until' : 'Days Until') + '</div><div class="hdl">' + esc(h.name) + '</div>' +
          '<div class="dt">' + (n === 1 ? 'Tomorrow, ' : '') + dateTxt + '</div></div>';
      }
      var foot = '';
      if (hide.indexOf('count') < 0 && n >= 7) {
        var wk = Math.floor(n / 7), rem = n % 7, sat = HH().weekends(today, h.date);
        foot += '<div class="fg"><div class="gh">The Countdown</div><div class="its"><div><div class="k">Weeks</div><div class="v">' + wk + (rem ? '<span class="pace">and ' + rem + (rem === 1 ? ' day' : ' days') + '</span>' : '') + '</div></div>' +
          '<div><div class="k">Weekends Left</div><div class="v">' + sat + '</div></div></div></div>';
      }
      if (hide.indexOf('next') < 0) {
        var up = HH().after(today, optsOf(), h, 3);
        if (up.length) foot += '<div class="fg mo"><div class="gh">Coming Up</div><div class="its">' + up.map(function (u) {
          return '<div><div class="k"><b style="background:' + esc(u.a || '#fff') + '"></b>' + esc(u.short || u.name) + '</div><div class="v">' + u.days + '<u>' + (u.days === 1 ? 'day' : 'days') + '</u></div></div>';
        }).join('') + '</div></div>';
      }
      footEl.innerHTML = foot;
      return sc;
    }
    // OUTDOORS: the season's landscape at the house's light, over the Live Sky (Sky Only); under Flat a gradient
    function outdoors(l) {
      var h = cur, lk = h.land + '-' + l, sk = SKYG[l] || SKYG.night, skyEl = $('.hlsky');
      el.setAttribute('light', l);
      skyEl.style.background = 'linear-gradient(180deg,' + sk[0] + ' 0%,' + sk[1] + ' 24%,' + sk[2] + ' 44%,' + sk[3] + ' 62%,' + sk[3] + ' 100%)';
      if (!flat() && !sky && window.hkSky && window.hkSky.scene) { try { sky = window.hkSky.scene(skyEl, { skyOnly: true }); } catch (e) { sky = null; } }
      if (sky) { try { if (client) sky.update(client); sky.pause(!showing); } catch (e) { /* the next update */ } }
      $('.hlland').style.backgroundImage = 'url("' + url(SKY + 'land-' + lk + '.webp') + '")';
      $('.hllights').style.backgroundImage = LIGHTS[lk] ? 'url("' + url(SKY + 'land-' + lk + '-lights.webp') + '")' : 'none';
      var fog = $('.hlfog');
      fog.style.display = h.id === 'halloween' ? 'block' : '';
      fog.style.backgroundImage = 'url("' + url(SKY + 'fog-wisp.webp') + '")';
      // a birthday's balloons and table stand on the land (the sky's own boxes)
      var ovs = $('.hlovs'); ovs.textContent = '';
      if (h.birthday) {
        var s = Math.max(W / 2560, H / 1600), put = function (file, b) {
          var e = document.createElement('div');
          e.className = 'hlov';
          e.style.cssText = 'left:' + ((W - 2560 * s) / 2 + b[0] * s) + 'px;top:' + (H - 1600 * s + b[1] * s) + 'px;width:' + b[2] * s + 'px;height:' + b[3] * s + 'px;background-image:url("' + url(SKY + file) + '")';
          ovs.appendChild(e);
        };
        put('birthday-left-' + l + '.webp', [1159, 704, 161, 294]); put('birthday-right-' + l + '.webp', [1459, 714, 176, 294]); put('birthday-props-' + l + '.webp', [1231, 796, 477, 246]);
      }
      return posJson && posJson.lights ? posJson.lights['land-' + lk + '-lights'] || null : null;
    }
    // the hero's sizes (the mock-up's layout): the number large, the words on one line while they fit beside it
    function sizeHero(tall, narrow) {
      var len = String(cur.days).length, base = (tall ? 340 : narrow ? 250 : 300) * (len >= 3 ? 0.82 : 1);
      el.style.setProperty('--nf', (base * Z) + 'px');
      el.style.setProperty('--hf', ((tall ? 76 : narrow ? 62 : 74) * Z) + 'px');
      var fh = footEl.childNodes.length ? footEl.offsetHeight : 0;
      el.style.setProperty('--herob', (fh + (26 + (tall ? 30 : 22)) * Z) + 'px');
      var num = heroEl.querySelector('.num'), hl = heroEl.querySelector('.hdl'), hello = heroEl.querySelector('.hello');
      if (num && hl && !tall) {
        var avail = W - 2 * M - num.offsetWidth - 34 * Z, cur0 = parseFloat(getComputedStyle(hl).fontSize);
        hl.style.whiteSpace = 'nowrap'; var nw = hl.scrollWidth; hl.style.whiteSpace = '';
        var k = Math.min(1, avail / Math.max(1, nw));
        if (k < 1) el.style.setProperty('--hf', Math.max(cur0 * k * 0.98, 40 * Z) + 'px');
      }
      if (hello) {
        var g = (tall ? 150 : 128) * Z; el.style.setProperty('--gf', g + 'px');
        var w0 = 1; hello.querySelectorAll('span').forEach(function (s) { w0 = Math.max(w0, s.offsetWidth); });
        if (!tall) w0 = hello.scrollWidth;
        var r = Math.min(1, (W - 2 * M) / w0 * 0.97);
        if (r < 1) el.style.setProperty('--gf', g * r + 'px');
      }
      // the number's first ink on the margin, as the corner's
      if (num && !tall) {
        num.style.marginLeft = '';
        try {
          var c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(num);
          c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          var m = c.measureText(num.textContent);
          if (typeof m.actualBoundingBoxLeft === 'number') num.style.marginLeft = m.actualBoundingBoxLeft + 'px';
        } catch (e) { /* as it is */ }
      }
      var web = $('.hlweb');
      web.style.display = 'none';
      if (cur.id === 'halloween' && num) {
        var lr = el.getBoundingClientRect(), k1 = lr.width / W || 1, r0 = num.getBoundingClientRect(), s = 170 * Z;
        web.style.cssText = 'display:block;width:' + s + 'px;height:' + s + 'px;left:' + ((r0.right - lr.left) / k1 - s * 0.62) + 'px;top:' + ((r0.top - lr.top) / k1 - s * 0.26) + 'px;background-image:url("' + url(SKY + 'web.webp') + '")';
      }
    }
    function place(e, x, y, w, h) { if (!e) return; e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.width = w + 'px'; e.style.height = h + 'px'; }
    // THE QUIET PLACES: the slide corner's two stacks (hk-saver.js puts them beside this layer) and the row
    function quiet() {
      var lr = el.getBoundingClientRect(), k = lr.width / W || 1, list = [], root = el.parentNode;
      if (root) [root.querySelector('.scn .scs.tl'), root.querySelector('.scn .scs.tr')].forEach(function (b) {
        if (!b || !b.children.length) return;
        var r = b.getBoundingClientRect();
        if (r.width && r.height) list.push({ x: (r.left - lr.left) / k, y: (r.top - lr.top) / k, w: r.width / k, h: r.height / k });
      });
      var f = footEl.childNodes.length ? footEl.getBoundingClientRect() : null;
      fx.quiet(list, f ? (f.top - lr.top) / k : null);
    }
    // THE LAYOUT for the room it has, and the picture painted for it (once per size: SCENES caches it)
    function render(fresh) {
      if (!cur || !W || !H) return;
      var tall = H > W * 1.05, narrow = !tall && W < 1000, short = H < 500;
      el.toggleAttribute('tall', tall); el.toggleAttribute('narrow', narrow); el.toggleAttribute('short', short);
      Z = narrow ? Math.min(W / 880, H / 800) : tall ? Math.min(W / 800, H / 1280) : Math.min(W / 1280, H / 800);
      Z = Math.max(0.42, Math.min(Z, 2.5));
      M = Math.min(W, H) / 100 * 6;
      el.style.setProperty('--z', Z.toFixed(3)); el.style.setProperty('--m', M + 'px');
      var lv = motion() ? (cfg.holiday_fx || 'full') : 'off';
      el.toggleAttribute('still', lv === 'off');
      var sc = words();
      el.setAttribute('scene', sc || 'land');
      el.setAttribute('fx', lv);
      var fh = footEl.childNodes.length ? footEl.offsetHeight : 0, foot = fh ? H - (26 * Z + fh) : H - 30 * Z;
      var q = Math.min(1.5, window.devicePixelRatio || 1);
      fx.size(W, H, q);
      var lights = null;
      data = null;
      if (sc) {
        data = window.hkHolidayScenes.paint(sc, paintC, paint2, W, H, foot, Z, M, q);
        if (!data) { el.setAttribute('scene', 'land'); sc = ''; words(); }
      }
      if (sc) {
        el.setAttribute('light', sc === 'thanks' ? 'dusk' : 'night');
        if (sc === 'room') {
          var tv = prop.querySelector('.tv'), vcr = prop.querySelector('.vcr');
          place(tv, data.tv.x, data.tv.y, data.tv.w, data.tv.h); if (tv) tv.style.setProperty('--t', (data.tv.w / 0.924) + 'px');
          place(vcr, data.vcr[0], data.vcr[1], data.vcr[2], data.vcr[3]); if (vcr) vcr.style.setProperty('--vh', (data.vcr[3] * 1.15) + 'px');
        } else if (sc === 'haunt') {
          var st = prop.querySelector('.stn'), b = data.place.stone;
          place(st, b[0], b[1], b[2], b[3]); if (st) st.style.setProperty('--t', b[2] + 'px');
        } else {
          var bd = prop.querySelector('.chalk') || prop.querySelector('.flap'), bb = data.board;
          place(bd, bb[0], bb[1], bb[2], bb[3]); if (bd) bd.style.setProperty('--t', bb[2] + 'px');
          var frame = bd && bd.querySelector('.fbd');
          if (frame) frame.style.backgroundImage = 'url("' + url(ART + 'ny-board.webp') + '")';
        }
      } else {
        lights = outdoors(light());
        sizeHero(tall, narrow);
      }
      fx.lights(sc ? null : lights);
      fx.reset(sc || cur.fx, lv, cur.days === 0, data, cur, Z);
      quiet();
      if (showing) fx.start();
      if (fresh && sky && !sc) { try { sky.pause(!showing); } catch (e) { /* gone */ } }
    }
    // ARRIVAL, once, as the slide lands: the TV powers on from a thin line and the number rolls to its count, the
    // chalk writes itself on, the flaps run through the alphabet and settle, the outdoor number rolls
    function arrived() {
      if (!alive || !showing || el.getAttribute('fx') === 'off') return;
      var ch = prop.querySelector('.chalk'), fl = prop.querySelector('.flap'), tv = prop.querySelector('.tv');
      if (ch) { ch.classList.remove('write'); void ch.offsetWidth; ch.classList.add('write'); return; }
      if (fl) { flipTo(fl); return; }
      if (tv) { tv.classList.remove('power'); void tv.offsetWidth; tv.classList.add('power'); }
      var num = (tv && tv.querySelector('.hlnum')) || heroEl.querySelector('.num') || prop.querySelector('.hlnum');
      if (!num) return;
      cancelAnimationFrame(rollT);
      var end = cur.days, t0 = performance.now() + (tv ? 1300 : 500), dur = 850, from = end + Math.max(6, Math.min(14, Math.round(end / 3)));
      if (num.offsetWidth) num.style.minWidth = num.offsetWidth + 'px';
      (function tick(t) {
        if (!showing) { num.textContent = end; num.style.minWidth = ''; return; }
        var f = Math.min(1, Math.max(0, (t - t0) / dur)), e = 1 - Math.pow(1 - f, 3);
        num.textContent = Math.round(from + (end - from) * e);
        if (f < 1) rollT = requestAnimationFrame(tick); else { num.style.minWidth = ''; rollT = 0; }
      })(performance.now());
    }
    // THE SPLIT FLAPS: each runs through the alphabet to its own letter, left to right, the way a station board settles
    function flipTo(board) {
      clearInterval(flipT);
      var cells = [].slice.call(board.querySelectorAll('.flc')), ABC = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', start = performance.now();
      cells.forEach(function (c, i) { c.__end = c.getAttribute('data-c'); c.__stop = 500 + i * 70 + Math.random() * 380; c.__done = false; c.textContent = ' '; });
      flipT = setInterval(function () {
        var now = performance.now() - start, busy = false;
        if (!showing) now = 1e9;
        cells.forEach(function (c) {
          if (c.__done) return;
          if (now >= c.__stop) { c.textContent = c.__end === ' ' ? ' ' : c.__end; c.__done = true; }
          else { busy = true; c.textContent = ABC[Math.floor(Math.random() * ABC.length)]; }
          c.classList.remove('fl'); void c.offsetWidth; c.classList.add('fl');
        });
        if (!busy) { clearInterval(flipT); flipT = null; cells.forEach(function (c) { c.classList.remove('fl'); }); }
      }, 70);
    }
    function settle() {
      if (rollT) { cancelAnimationFrame(rollT); rollT = 0; }
      if (flipT) { clearInterval(flipT); flipT = null; }
      prop.querySelectorAll('.flc').forEach(function (c) { var e = c.getAttribute('data-c'); c.textContent = e === ' ' ? ' ' : e; c.classList.remove('fl'); });
      var n = prop.querySelector('.hlnum') || heroEl.querySelector('.num');
      if (n && cur && cur.days) { n.textContent = cur.days; n.style.minWidth = ''; }
    }
    // A SLIDE SHOWING AT MIDNIGHT rolls over on its next tick: the count, or the next holiday
    function tick() {
      if (!alive || !showing || !cur || !HH()) return;
      var t = HH().today(Date.now(), tz());
      if (today && t.y === today.y && t.m === today.m && t.d === today.d) return;
      var h = choose(false);
      if (!h) return;
      cur = h; curKey = h.id + '|' + h.days;
      render(false);
    }
    return {
      el: el,
      // a holiday within the window (its art asked for now, so the first turn has it)
      ready: function (cl) {
        if (cl) client = cl;
        var h = choose(false);
        if (!h) return false;
        prep(h);
        if (cfg.holiday_pick === 'turns') { var o = optsOf(); HH().inRange(today, o).forEach(prep); }
        return true;
      },
      draw: function (cl) {
        if (cl) client = cl;
        var h = choose(true);
        if (!h) return false;
        cur = h; curKey = h.id + '|' + h.days;
        prep(h);
        showing = true;
        settle();
        render(true);
        if (sky) { try { if (client) sky.update(client); sky.pause(false); } catch (e) { /* gone */ } }
        if (!clockT) clockT = setInterval(tick, 30000);
        // (and again once the slide corner has drawn its words beside it: what falls fades out behind them)
        clearTimeout(again); again = setTimeout(function () { if (alive && showing) quiet(); }, 600);
        return true;
      },
      arrived: arrived,
      layout: function (w, h) {
        if (!w || !h) return;
        var changed = Math.round(w) !== W || Math.round(h) !== H;
        W = Math.round(w); H = Math.round(h);
        // (drawn again only for a new size: the screensaver asks every few seconds -- its forecast tick -- and each
        // drawing scattered the effects afresh, the snow jumping instead of falling, 2026-11-09, the owner)
        if (cur && changed) render(false);
        else if (cur && showing) quiet();
      },
      setClient: function (cl) {
        client = cl;
        if (showing && sky && el.getAttribute('scene') === 'land') { try { sky.update(cl); } catch (e) { /* the next */ } }
      },
      setCfg: function (c) { cfg = c || {}; },
      leave: function () {
        showing = false;
        fx.stop(); settle();
        if (clockT) { clearInterval(clockT); clockT = null; }
        clearTimeout(again);
        if (sky) { try { sky.pause(true); } catch (e) { /* gone */ } }
      },
      showing: function () { return showing; },
      // for the checks: what it shows and where its pieces stand
      info: function () {
        return { id: cur ? cur.id : null, days: cur ? cur.days : null, scene: el.getAttribute('scene'), fx: el.getAttribute('fx'), W: W, H: H, Z: Z,
                 running: fx.running(), counts: fx.counts(), foot: data ? data.foot : null, feet: data ? data.feet : null,
                 floorY: data && data.place ? data.place.floorY : null, win: data ? data.win : null, canvases: el.querySelectorAll('canvas').length };
      },
      destroy: function () {
        alive = false; showing = false;
        fx.stop(); settle();
        if (clockT) { clearInterval(clockT); clockT = null; }
        clearTimeout(again);
        if (sky) { try { sky.destroy(); } catch (e) { /* gone */ } sky = null; }
        [paintC, paint2, fxC].forEach(function (c) { c.width = c.height = 0; });
        if (window.hkHolidayScenes) window.hkHolidayScenes.forget();
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  // THE MODULES IT NEEDS, asked for together: the calendar, the scenes and the effects
  var deps = null;
  function load() {
    if (window.hkHolidays && window.hkHolidayScenes && window.hkHolidayFx) return Promise.resolve(true);
    if (!deps) {
      var get = function (g, f) { return window[g] ? Promise.resolve() : import(url('/hk/modules/' + f)); };
      deps = Promise.all([get('hkHolidays', 'hk-holidays.js'), get('hkHolidayScenes', 'hk-saver-holiday-scenes.js'), get('hkHolidayFx', 'hk-saver-holiday-fx.js')])
        .then(function () { return !!(window.hkHolidays && window.hkHolidayScenes && window.hkHolidayFx); })
        .catch(function (e) { deps = null; console.warn('[hk-saver-holiday]', e && e.message); return false; });
    }
    return deps;
  }

  window.hkSaverHoliday = { create: create, load: load, PARTS: PARTS.slice(), _: { tvHtml: tvHtml, chalkHtml: chalkHtml, flapHtml: flapHtml, stoneHtml: stoneHtml, fmt: fmt } };
})();
