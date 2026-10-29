// hk-saverclock.js -- THE SCREENSAVER'S CLOCKS (2026-10-13): fourteen full-
// screen clock faces and the backgrounds generated behind them, for the photo
// screensaver's Show: Clock and its Large clock over the photos or the
// forecast (hk-saver.js mounts them; settings.py SAVER_DEFAULTS clock_*).
// Designed in hk_house/docs/mockups/saver-clocks.html, where every face runs.
//
// Loaded by hk-saver.js only when a screen shows a clock -- never on its own.
//
// WHAT IT COSTS A WALL TABLET, by design:
//   - a face is text and a few shapes, changed once a second (Flip only when
//     a digit turns); digits are tabular, so nothing shifts as they change
//   - a generated background is a 64 x 40 canvas the browser scales up -- the
//     softness IS the scaling, as the screensaver's blurred photo copy is --
//     redrawn 4 times a second (Motion: Slow) or once a minute (Still)
//   - Glass never uses backdrop-filter: its pane is the background drawn
//     again, smaller, into a canvas of its own (the Pre-rendered blur's idea)
//   - burn-in: the face drifts a few percent every five minutes
//
//   hkSaverClock.mount(el, { style, h24, bg, motion, client })
//     -> { setClient(c), destroy() }    el: the layer to draw into
(function () {
  'use strict';
  if (window.hkSaverClock) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var SERIF = '"New York","Iowan Old Style","Palatino","Georgia","Noto Serif",serif';
  var MONO = '"SF Mono",ui-monospace,"Roboto Mono","Droid Sans Mono",monospace';
  var TYPE = '"American Typewriter","Courier Prime","Courier New","Cutive Mono",monospace';

  // [id, name, what it is]
  var STYLES = [
    // THE FLAGSHIP (2026-10-13): designed with its weather and music in it,
    // not around it -- the corners' Weather and Now Playing step aside
    ['today', 'Today', 'The time, the date, the weather and what\u2019s playing, as one'],
    ['classic', 'Classic', 'Huge thin digits, like the lock screen'],
    ['serif', 'Big Serif', 'An editorial italic, like a magazine cover'],
    ['neon', 'Neon', 'Glowing tubes; the colon hums now and then'],
    ['lcd', 'Retro LCD', 'Seven segments on a backlit panel'],
    ['flip', 'Flip', 'Split-flap cards that flip as the minute turns'],
    ['analog', 'Analog', 'A watch face with a sweeping second hand'],
    ['words', 'Words', '\u201cIt is quarter past seven\u201d, in a grid of letters'],
    ['arc', 'Minimal Arc', 'The hour, big; the minutes a ring filling round it'],
    ['nixie', 'Nixie Tubes', 'Orange glow in glass tubes'],
    ['poster', 'Poster', 'Swiss-poster bold, hours over minutes'],
    ['dots', 'Dot Matrix', 'An amber LED departure board'],
    ['ring', 'Day Ring', 'Today as a ring: daylight, night and the sun now'],
    ['glass', 'Glass', 'The time on a frosted pane'],
    ['type', 'Typewriter', 'A sentence, typed out, the cursor blinking']
  ];
  // [id, name, moving] -- every one moves but Black (PAINTERS below)
  var BGS = [
    ['black', 'Black', false], ['grain', 'Grain Wash', true], ['gradient', 'Drifting Gradient', true],
    ['aurora', 'Aurora', true], ['ink', 'Ink Swirl', true], ['sky', 'Follow the Sky', true],
    // after coolbackgrounds.io (the owner's find, 2026-10-13)
    ['lowpoly', 'Low Poly', true], ['topo', 'Topography', true], ['constellation', 'Constellation', true]
  ];
  // EACH FACE'S COLORS (2026-10-13): [id, name, its CSS variables] -- the
  // first is the face as it always looked. A screen keeps one per face
  // (clock_colors), so trying another style keeps the colors chosen before.
  var COLORS = {
    // Today's accent: by the time of day (dawn orange, day blue, evening
    // pink, night indigo), or one of its own
    today: [['auto', 'By Time of Day', {}], ['blue', 'Blue', { '--cktoday': '#64d2ff' }], ['orange', 'Orange', { '--cktoday': '#ff9f0a' }],
            ['pink', 'Pink', { '--cktoday': '#ff6b9a' }], ['green', 'Green', { '--cktoday': '#30d158' }], ['white', 'White', { '--cktoday': '#ffffff' }]],
    classic: [['white', 'White', {}], ['warm', 'Warm', { '--ckfg': '#ffe3bd' }], ['ice', 'Ice Blue', { '--ckfg': '#cfe6ff' }],
              ['mint', 'Mint', { '--ckfg': '#c6f4da' }], ['rose', 'Rose', { '--ckfg': '#ffcfe2' }]],
    serif: [['cream', 'Cream', {}], ['white', 'White', { '--ckfg': '#ffffff', '--ckdt': '#e9e9ee' }], ['gold', 'Gold', { '--ckfg': '#f3c977', '--ckdt': '#e6c58a' }],
            ['rose', 'Rose', { '--ckfg': '#f6c0cb', '--ckdt': '#e8b4bf' }], ['sky', 'Sky', { '--ckfg': '#bfe0ff', '--ckdt': '#a9cdef' }]],
    neon: [['pink', 'Pink', {}],
           ['blue', 'Blue', { '--ckn': '#e3f6ff', '--ckn1': '#36c8ff', '--ckn2': '#0b8cff', '--ckn3': '#2a4bff', '--ckd': '#ffd2f5', '--ckd1': '#ff4fd8', '--ckd2': '#c21bff' }],
           ['green', 'Green', { '--ckn': '#eaffef', '--ckn1': '#3dff8a', '--ckn2': '#13d36a', '--ckn3': '#00a86b' }],
           ['orange', 'Orange', { '--ckn': '#fff1e0', '--ckn1': '#ffa43a', '--ckn2': '#ff7a00', '--ckn3': '#ff3d00' }],
           ['purple', 'Purple', { '--ckn': '#f3e8ff', '--ckn1': '#b56bff', '--ckn2': '#8a2bff', '--ckn3': '#5a00d6' }]],
    lcd: [['green', 'Green', {}], ['amber', 'Amber', { '--ckl1': '#e9b44c', '--ckl2': '#d99b2b', '--ckseg': '#2a1a05' }],
          ['blue', 'Blue', { '--ckl1': '#8fc3e8', '--ckl2': '#6aa8d8', '--ckseg': '#0b1d2e' }],
          ['white', 'White', { '--ckl1': '#e6e8e3', '--ckl2': '#cfd3cc', '--ckseg': '#1b1d1a' }],
          ['night', 'Night', { '--ckl1': '#10161a', '--ckl2': '#0a0f12', '--ckseg': '#5cf2ff' }]],
    flip: [['dark', 'Dark', {}], ['white', 'White', { '--ckc1': '#f4f4f2', '--ckc2': '#e9e9e6', '--ckc3': '#dededa', '--ckdg': '#1c1c1e', '--ckcol': '#f2f2f2' }],
           ['red', 'Red', { '--ckc1': '#d4202f', '--ckc2': '#c21b29', '--ckc3': '#b01624', '--ckdg': '#ffffff' }],
           ['navy', 'Navy', { '--ckc1': '#1d2b4f', '--ckc2': '#18244a', '--ckc3': '#141f40', '--ckdg': '#f4efe6' }]],
    analog: [['orange', 'Orange', {}], ['red', 'Red', { '--ckh': '#ff453a' }], ['blue', 'Blue', { '--ckh': '#0a84ff' }],
             ['green', 'Green', { '--ckh': '#30d158' }], ['gold', 'Gold', { '--ckh': '#ffd60a', '--ckm': '#f5e9cf' }]],
    words: [['white', 'White', {}], ['warm', 'Warm', { '--ckw': '#ffd59a' }], ['blue', 'Blue', { '--ckw': '#8fd0ff' }],
            ['green', 'Green', { '--ckw': '#8ff5b5' }], ['pink', 'Pink', { '--ckw': '#ff9fd2' }]],
    arc: [['white', 'White', {}], ['orange', 'Orange', { '--cka': '#ff9f0a' }], ['blue', 'Blue', { '--cka': '#64d2ff' }],
          ['green', 'Green', { '--cka': '#30d158' }], ['pink', 'Pink', { '--cka': '#ff6fb5' }]],
    nixie: [['orange', 'Orange', {}],
            ['ice', 'Ice Blue', { '--ckx': '#bfefff', '--ckx1': '#7fd8ff', '--ckx2': '#2fb6ff', '--ckx3': '#0080ff', '--ckxg': 'rgba(120,200,255,.07)' }],
            ['green', 'Green', { '--ckx': '#b9ffd0', '--ckx1': '#5cff95', '--ckx2': '#1fe06a', '--ckx3': '#00b050', '--ckxg': 'rgba(120,255,170,.07)' }],
            ['violet', 'Violet', { '--ckx': '#e6c9ff', '--ckx1': '#b780ff', '--ckx2': '#8a3dff', '--ckx3': '#6a00ff', '--ckxg': 'rgba(190,140,255,.07)' }]],
    poster: [['red', 'Red', {}], ['blue', 'Blue', { '--ckp1': '#0a5cff' }], ['green', 'Green', { '--ckp1': '#1f9d55' }],
             ['black', 'Black & Yellow', { '--ckp1': '#111111', '--ckp2': '#ffd60a', '--ckp2t': '#111111' }],
             ['orange', 'Orange & Navy', { '--ckp1': '#ff6a13', '--ckp2': '#14213d', '--ckp2t': '#f4efe6' }]],
    dots: [['amber', 'Amber', {}], ['red', 'Red', { '--ckled': '#ff3b30' }], ['green', 'Green', { '--ckled': '#30d158' }],
           ['white', 'White', { '--ckled': '#f2f2f7' }], ['blue', 'Blue', { '--ckled': '#4fb6ff' }]],
    ring: [['sunset', 'Sunset', {}], ['ocean', 'Ocean', { '--ckr1': '#64d2ff', '--ckr2': '#0a84ff', '--ckr3': '#5e5ce6', '--ckrn': '#1b2440' }],
           ['forest', 'Forest', { '--ckr1': '#a8e063', '--ckr2': '#30d158', '--ckr3': '#0f9d58', '--ckrn': '#1f2a24' }],
           ['mono', 'Mono', { '--ckr1': '#ffffff', '--ckr2': '#d1d1d6', '--ckr3': '#aeaeb2', '--ckrn': '#3a3a3c' }]],
    glass: [['clear', 'Clear', {}], ['warm', 'Warm', { '--ckpane': 'rgba(255,214,170,.22)' }], ['blue', 'Blue', { '--ckpane': 'rgba(150,200,255,.22)' }],
            ['dark', 'Dark', { '--ckpane': 'rgba(0,0,0,.3)' }]],
    type: [['paper', 'Paper', {}], ['white', 'White', { '--ckt': '#ffffff' }], ['green', 'Terminal Green', { '--ckt': '#7dff9e' }],
           ['amber', 'Terminal Amber', { '--ckt': '#ffb000' }]]
  };
  function colorOf(style, id) {
    var set = COLORS[style] || [];
    return set.filter(function (c) { return c[0] === id; })[0] || set[0] || ['', '', {}];
  }
  function rgba(hex, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(255,176,0,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  var CSS = [
    '.ckroot{position:absolute;inset:0;container-type:size;overflow:hidden;color:#fff;font-family:' + FONT + ';font-variant-numeric:tabular-nums}',
    '.ckroot canvas.ckbg{position:absolute;inset:0;width:100%;height:100%;display:block}',
    '.ckroot .ckscrim{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.16),rgba(0,0,0,.4))}',
    '.ckroot .face{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform 6s ease-in-out}',
    '.ckroot .dt{letter-spacing:.02em}',
    // THE TYPOGRAPHY PASS (2026-10-13): the big times in proportional digits
    // -- tabular ones left a gap around every "1" ("1 1:41") -- and SF Pro's
    // case forms, which lift the colon to the middle of the digits instead of
    // the baseline, as the lock screen has it. (The faces whose digits sit in
    // cells -- LCD, Flip, Nixie, Dot Matrix -- keep them tabular.)
    '.ckroot .tm,.ckroot .f-type .tx,.ckroot .f-ring text,.ckroot .f-arc text{font-variant-numeric:proportional-nums;font-feature-settings:"case" 1}',
    // TODAY: one centered column -- the date, the time, the weather, what's
    // playing -- in one accent that follows the day. (Centered, 2026-10-13:
    // flush left from a margin, the block sat right of the middle.) A
    // letter-spaced line carries its spacing after the last letter too: a
    // margin as wide the other way takes it back (tighter spacing, a margin
    // added), so its letters are what is centered -- measured, within 1px.
        '.f-today .col{display:flex;flex-direction:column;align-items:center;text-align:center}',
    '.f-today .dt{font-size:2.6cqw;font-weight:650;letter-spacing:.08em;text-transform:uppercase;margin-right:-.08em;color:var(--cktoday,#64d2ff)}',
    '.f-today .tm{font-size:24cqw;font-weight:var(--cktw,600);letter-spacing:-.045em;line-height:.92;margin:.6cqw .045em 1.2cqw 0;color:#fff}',
    '.f-today .wx{display:flex;align-items:center;gap:1.2cqw;font-size:3.2cqw;font-weight:600}',
    '.f-today .wx svg{width:4cqw;height:4cqw;flex:none}',
    '.f-today .wx .c{font-weight:500;opacity:.8}',
    '.f-today .np{display:flex;align-items:center;gap:1.2cqw;margin-top:2cqw;max-width:60cqw;font-size:2.1cqw;font-weight:600}',
    '.f-today .np img,.f-today .np .ph{width:4.6cqw;height:4.6cqw;border-radius:.8cqw;object-fit:cover;flex:none;box-shadow:0 .4cqw 1.2cqw rgba(0,0,0,.35);background:#333}',
    '.f-today .np .a{font-weight:500;opacity:.75}',
    '.f-today .np .bars{display:flex;gap:.25cqw;align-items:flex-end;height:1.6cqw}',
    '.f-today .np .bars i{width:.35cqw;background:var(--cktoday,#64d2ff);border-radius:.2cqw;animation:ckbar 1.1s ease-in-out infinite alternate}',
    '.f-today .np .bars i:nth-child(2){animation-delay:-.4s}.f-today .np .bars i:nth-child(3){animation-delay:-.8s}',
    '@keyframes ckbar{from{height:25%}to{height:100%}}',
    // classic
    '.f-classic{flex-direction:column}',
    '.f-classic .tm{font-size:27cqw;font-weight:200;letter-spacing:-.04em;line-height:.9;color:var(--ckfg,#fff)}',
    '.f-classic .dt{font-size:3.2cqw;font-weight:500;opacity:.88;margin-top:2cqw;color:var(--ckfg,#fff)}',
    // big serif: centered (2026-10-13; flush left it sat right of the
    // middle), the letter-spacing after the last letter taken back as Today's
    '.f-serif{flex-direction:column;font-family:' + SERIF + '}',
    '.f-serif .tm{font-size:30cqw;font-weight:400;font-style:italic;letter-spacing:-.03em;line-height:.85;margin-right:.03em;color:var(--ckfg,#f6eee2)}',
    '.f-serif .dt{font-size:3cqw;letter-spacing:.32em;text-transform:uppercase;margin-top:3cqw;margin-right:-.32em;color:var(--ckdt,#e8d9c2)}',
    // neon
    '.f-neon{flex-direction:column}',
    '.f-neon .tm{font-size:24cqw;font-weight:300;color:var(--ckn,#ffe9fb);letter-spacing:.02em;',
    '  text-shadow:0 0 .6cqw #fff,0 0 1.6cqw var(--ckn1,#ff4fd8),0 0 4cqw var(--ckn2,#ff2fc9),0 0 9cqw var(--ckn3,#c21bff)}',
    '.f-neon .tm b{font-weight:300;animation:ckhum 4s infinite steps(1)}',
    '.f-neon .dt{font-size:3.2cqw;margin-top:2cqw;color:var(--ckd,#bff3ff);text-shadow:0 0 1cqw var(--ckd1,#36d9ff),0 0 3cqw var(--ckd2,#0bb4ff);letter-spacing:.2em;text-transform:uppercase}',
    '@keyframes ckhum{0%,91%,95%,100%{opacity:1}93%{opacity:.35}}',
    // retro lcd
    '.f-lcd .panel{background:linear-gradient(var(--ckl1,#a9b38a),var(--ckl2,#97a275));border-radius:2.4cqw;padding:3.4cqw 5cqw 3cqw;',
    '  box-shadow:inset 0 .6cqw 1.6cqw rgba(0,0,0,.35),0 0 0 1.2cqw #2b2f2a,0 0 0 1.6cqw #4a4f47}',
    '.f-lcd svg{display:block;width:62cqw;height:auto}',
    '.f-lcd .seg{fill:var(--ckseg,#1f2617)}.f-lcd .ghost{fill:var(--ckseg,#1f2617);opacity:.08}',
    '.f-lcd .row2{display:flex;justify-content:space-between;font:700 2.4cqw ' + MONO + ';color:var(--ckseg,#1f2617);margin-top:1.4cqw;letter-spacing:.12em}',
    // flip
    '.f-flip{flex-direction:column}',
    '.f-flip .cards{display:flex;align-items:center;gap:1.4cqw}',
    '.f-flip .card{position:relative;width:19cqw;height:26cqw}',
    '.f-flip .half{position:absolute;left:0;right:0;height:50%;overflow:hidden;color:var(--ckdg,#f2f2f2);font-size:22cqw;font-weight:600;text-align:center;line-height:26cqw}',
    '.f-flip .half.up{top:0;border-radius:1.6cqw 1.6cqw 0 0;background:linear-gradient(var(--ckc1,#232326),var(--ckc2,#1c1c1e))}',
    '.f-flip .half.dn{bottom:0;border-radius:0 0 1.6cqw 1.6cqw;line-height:0;background:var(--ckc3,#18181a)}',
    '.f-flip .half.dn span{display:block;transform:translateY(-50%)}',
    '.f-flip .flap{position:absolute;left:0;right:0;top:0;height:50%;transform-origin:bottom;transition:transform .5s cubic-bezier(.5,0,.6,1);backface-visibility:hidden}',
    '.f-flip .card::after{content:"";position:absolute;left:0;right:0;top:50%;height:.35cqw;background:#000;transform:translateY(-50%)}',
    '.f-flip .colon{font-size:14cqw;color:var(--ckcol,#e5e5e5);opacity:.8}',
    '.f-flip .dt{font-size:3cqw;font-weight:500;opacity:.85;margin-top:3cqw}',
    // analog, arc, ring (svg)
    '.f-analog svg,.f-arc svg{width:72cqh;height:72cqh;overflow:visible}',
    '.f-ring svg{width:78cqh;height:78cqh;overflow:visible}',
    // words
    '.f-words{flex-direction:column}',
    '.f-words .g{display:grid;grid-template-columns:repeat(11,5.2cqh);gap:.4cqh 1cqh;font-weight:600;font-size:4.2cqh;text-align:center}',
    '.f-words .g i{font-style:normal;color:rgba(255,255,255,.13);transition:color 1.2s,text-shadow 1.2s}',
    '.f-words .g i.on{color:var(--ckw,#fff);text-shadow:0 0 1.4cqh currentColor}',
    '.f-words .dt{font-size:2.4cqw;font-weight:600;letter-spacing:.3em;text-transform:uppercase;opacity:.75;margin-top:2.6cqh}',
    // nixie
    '.f-nixie{flex-direction:column}',
    '.f-nixie .tubes{display:flex;align-items:center;gap:1.6cqw}',
    '.f-nixie .tube{position:relative;width:15cqw;height:30cqw;border-radius:7.5cqw 7.5cqw 1.6cqw 1.6cqw;',
    '  background:radial-gradient(ellipse at 50% 30%,rgba(255,140,60,.10),rgba(20,10,4,.6) 70%),linear-gradient(90deg,rgba(255,255,255,.07),rgba(255,255,255,0) 30%,rgba(255,255,255,0) 70%,rgba(255,255,255,.06));',
    '  box-shadow:inset 0 0 0 .3cqw rgba(255,255,255,.08),0 1.6cqw 3cqw rgba(0,0,0,.5);overflow:hidden}',
    '.f-nixie .tube::before{content:"";position:absolute;inset:4cqw 2cqw;background:repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 .25cqw,transparent .25cqw 1.1cqw),repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 .25cqw,transparent .25cqw 1.1cqw)}',
    '.f-nixie .dg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22cqw;font-weight:200}',
    '.f-nixie .dg.ghost{color:var(--ckxg,rgba(255,160,90,.07))}',
    '.f-nixie .dg.lit{color:var(--ckx,#ffb36b);text-shadow:0 0 .5cqw #fff1d6,0 0 1.6cqw var(--ckx1,#ff8a2b),0 0 4cqw var(--ckx2,#ff5a00),0 0 8cqw var(--ckx3,rgba(255,80,0,.6))}',
    '.f-nixie .dots{display:flex;flex-direction:column;gap:5cqw}',
    '.f-nixie .dot{width:1.6cqw;height:1.6cqw;border-radius:50%;background:var(--ckx1,#ff9a3e);box-shadow:0 0 1.5cqw var(--ckx2,#ff6a00);margin:0 .4cqw}',
    '.f-nixie .dt{font-size:2.8cqw;letter-spacing:.24em;text-transform:uppercase;color:var(--ckx,#ffb36b);text-shadow:0 0 1.2cqw var(--ckx2,#ff6a00);margin-top:3cqw}',
    // poster
    // (a band top and bottom left dark: the corners' weather, Home Status,
    // what's playing and the timers stay readable over it, white on black)
    '.f-poster .p{position:absolute;top:12cqh;bottom:17cqh;left:0;right:0;display:grid;grid-template-rows:1fr 1fr}',
    '.f-poster .h,.f-poster .m{display:flex;align-items:center;font-size:36cqh;font-weight:900;letter-spacing:-.06em;line-height:.8;padding-left:4cqw;overflow:hidden}',
    '.f-poster .h{background:var(--ckp1,#ff3b30);color:var(--ckp1t,#fff)}',
    '.f-poster .m{background:var(--ckp2,#f4efe6);color:var(--ckp2t,#111);justify-content:flex-end;padding:0 4cqw 0 0}',
    // (the date at the seam: the corners are the weather's, Home Status',
    // what's playing and the timers')
    '.f-poster .tag{position:absolute;right:4cqw;bottom:calc(50% + 2.2cqh);font-size:2.6cqw;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--ckp1t,#fff)}',
    '.f-poster .tag2{position:absolute;left:4cqw;top:calc(50% + 2.2cqh);font-size:2.6cqw;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--ckp2t,#111)}',
    // dot matrix
    '.f-dots{flex-direction:column}',
    '.f-dots canvas{width:84cqw;height:auto}',
    '.f-dots .dt{font:600 2.6cqw ' + MONO + ';color:var(--ckled,#ffb000);letter-spacing:.3em;text-shadow:0 0 1cqw var(--ckled,#ffb000);margin-top:1cqh}',
    // glass: its own pre-rendered blur (a canvas), never backdrop-filter
    '.f-glass .g{position:relative;padding:4cqw 7cqw;border-radius:5cqw;overflow:hidden;text-align:center;',
    '  box-shadow:inset 0 0 0 .25cqw rgba(255,255,255,.28),0 2cqw 6cqw rgba(0,0,0,.3);background:rgba(40,44,56,.42)}',
    '.f-glass .g canvas{position:absolute;inset:0;width:100%;height:100%;display:block;filter:saturate(1.5)}',
    '.f-glass .g .tint{position:absolute;inset:0;background:var(--ckpane,rgba(255,255,255,.14))}',
    '.f-glass .g .in{position:relative}',
    '.f-glass .tm{font-size:18cqw;font-weight:600;letter-spacing:-.03em;line-height:.95}',
    '.f-glass .dt{font-size:2.8cqw;font-weight:500;opacity:.9;margin-top:1cqw}',
    // typewriter
    // (centered top to bottom: the bottom-left corner is Now Playing's)
    '.f-type{justify-content:flex-start;align-items:center;padding:0 0 0 8cqw}',
    '.f-type .tx{font:400 6.4cqw/1.15 ' + TYPE + ';color:var(--ckt,#f5efe3);max-width:80cqw}',
    '.f-type .tx .cur{display:inline-block;width:.55em;height:1em;background:var(--ckt,#f5efe3);vertical-align:-.12em;margin-left:.1em;animation:ckblink 1.1s steps(1) infinite}',
    '@keyframes ckblink{50%{opacity:0}}',
    // the moving parts the browser animates itself (smooth at any frame rate)
    '.ckroot canvas.ckbg{transition-timing-function:linear}',
    // (the backgrounds' two canvases take turns on top, by z-index: what is
    // over them is above both)
    '.ckroot{isolation:isolate}.ckroot .ckscrim,.ckroot .ckgrain,.ckroot .cklight{z-index:2}.ckroot .face{z-index:3}',
    '.ckroot .cklight{position:absolute;inset:-35%;pointer-events:none;',
    '  background:radial-gradient(circle at 50% 50%,rgba(255,255,255,var(--ckla,.25)) 0,rgba(255,255,255,0) 32%),',
    '    radial-gradient(circle at 80% 85%,rgba(0,0,0,var(--ckla,.25)) 0,rgba(0,0,0,0) 30%);',
    '  animation:cklight var(--ckls,40s) ease-in-out infinite alternate;will-change:transform}',
    '@keyframes cklight{from{transform:translate(-24%,-14%)}to{transform:translate(24%,12%)}}',
    '@media (prefers-reduced-motion:reduce){.ckroot .cklight{animation:none}.ckroot .face{transition:none}.f-neon .tm b,.f-type .tx .cur{animation:none}}'
  ].join('\n');

  // ------------------------------------------------------------ words
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d, h24) {
    var h = d.getHours();
    if (!h24) { h = h % 12; if (h === 0) h = 12; }
    return { h: h24 ? pad(h) : String(h), m: pad(d.getMinutes()), ap: d.getHours() < 12 ? 'AM' : 'PM' };
  }
  function dateLine(d) { return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function shortDate(d) { return DAYS[d.getDay()].slice(0, 3) + ' \u00b7 ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------ the faces
  // each: build(face, ctx) -> tick(date); ctx = { h24, sun(), glass(canvas) }
  var FACES = {};

  // the weather's glyph: a few shapes of its own (no icon set needed)
  var WXI = {
    sun: '<circle cx="12" cy="12" r="4.4" fill="#ffd60a"/><g stroke="#ffd60a" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7"/></g>',
    moon: '<path d="M15.5 3.2a8.6 8.6 0 1 0 5.3 14.6A7 7 0 0 1 15.5 3.2z" fill="#e5e5ea"/>',
    cloud: '<path d="M7 18.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z" fill="#e5e5ea"/>',
    part: '<circle cx="8.6" cy="8.4" r="3.4" fill="#ffd60a"/><path d="M8 19h9.6a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1A3 3 0 0 0 8 19z" fill="#e5e5ea"/>',
    rain: '<path d="M7 14.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.4 5.4 0 0 0-10.4 1.1A3.2 3.2 0 0 0 7 14.5z" fill="#e5e5ea"/><g stroke="#64d2ff" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/></g>',
    snow: '<path d="M7 14.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.4 5.4 0 0 0-10.4 1.1A3.2 3.2 0 0 0 7 14.5z" fill="#e5e5ea"/><g fill="#fff"><circle cx="8.5" cy="18.5" r="1.1"/><circle cx="12.5" cy="20" r="1.1"/><circle cx="16.5" cy="18.5" r="1.1"/></g>',
    storm: '<path d="M7 14.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.4 5.4 0 0 0-10.4 1.1A3.2 3.2 0 0 0 7 14.5z" fill="#e5e5ea"/><path d="M12.6 14.5l-2.4 4h2.2l-1.4 3.6 4-5h-2.4l1.4-2.6z" fill="#ffd60a"/>',
    fog: '<g stroke="#e5e5ea" stroke-width="1.8" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></g>'
  };
  var WXOF = { sunny: 'sun', 'clear-night': 'moon', cloudy: 'cloud', partlycloudy: 'part', rainy: 'rain', pouring: 'rain', snowy: 'snow',
               'snowy-rainy': 'snow', hail: 'snow', lightning: 'storm', 'lightning-rainy': 'storm', fog: 'fog', windy: 'cloud', 'windy-variant': 'cloud', exceptional: 'cloud' };
  var WXSAYS = { sunny: 'Sunny', 'clear-night': 'Clear', cloudy: 'Cloudy', partlycloudy: 'Partly Cloudy', rainy: 'Rain', pouring: 'Heavy Rain', snowy: 'Snow',
                 'snowy-rainy': 'Sleet', hail: 'Hail', lightning: 'Thunder', 'lightning-rainy': 'Thunderstorms', fog: 'Fog', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Unusual' };
  // the part of the day's accent (Today, By Time of Day)
  function dayAccent(d) {
    var h = d.getHours();
    return h >= 5 && h < 9 ? '#ff9f0a' : h >= 9 && h < 17 ? '#64d2ff' : h >= 17 && h < 21 ? '#ff6b9a' : '#8e8cff';
  }
  // ONLY WHAT CHANGED IS WRITTEN: a face is called every second, and a
  // text node replaced costs a layout and a repaint -- under the Shadow /
  // Outline filter over the photos, the whole clock layer re-filtered -- for
  // a minute that has not changed
  function put(e, v) { v = String(v); if (e.textContent !== v) e.textContent = v; }
  FACES.today = function (f, x) {
    var col = el('div', 'col'), dt = el('div', 'dt'), tm = el('div', 'tm'), wx = el('div', 'wx'), np = el('div', 'np');
    col.append(dt, tm, wx, np); f.appendChild(col);
    var wxKey = '', npKey = '';
    return function (d) {
      var t = hm(d, x.h24), client = x.client();
      put(tm, t.h + ':' + t.m);
      put(dt, DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate());
      if (!x.vars['--cktoday']) f.style.setProperty('--cktoday', dayAccent(d));
      // brighter by day, lighter at night: the weight follows the light
      f.style.setProperty('--cktw', d.getHours() >= 7 && d.getHours() < 20 ? '600' : '400');
      // THE WEATHER: the screen's weather service (Weather), else the first
      var states = (client && client.states) || {}, wid = x.weather && states[x.weather] ? x.weather : Object.keys(states).filter(function (k) { return k.indexOf('weather.') === 0; })[0];
      var w = wid && states[wid], key = w ? w.state + '|' + (w.attributes || {}).temperature : '';
      if (key !== wxKey) {
        wxKey = key;
        if (!w) { wx.innerHTML = ''; }
        else {
          var a = w.attributes || {}, unit = String(a.temperature_unit || '').replace(/[^CF]/g, '');
          wx.innerHTML = '<svg viewBox="0 0 24 24">' + (WXI[WXOF[w.state] || 'cloud'] || '') + '</svg><span>' + (a.temperature != null ? Math.round(a.temperature) + '\u00b0' + unit : '') +
                         '</span><span class="c">' + (WXSAYS[w.state] || '') + '</span>';
        }
      }
      // WHAT'S PLAYING: the media player playing now, most recently started
      var playing = Object.keys(states).filter(function (k) { return k.indexOf('media_player.') === 0 && states[k].state === 'playing' && !(window.hkMusic && window.hkMusic.ignored(states[k])) && (states[k].attributes || {}).media_title; })
        .sort(function (p1, p2) { return String(states[p2].last_changed).localeCompare(String(states[p1].last_changed)); })[0];
      var m = playing && states[playing], mk = m ? m.attributes.media_title + '|' + (m.attributes.media_artist || '') + '|' + (m.attributes.entity_picture || '') : '';
      if (mk !== npKey) {
        npKey = mk;
        if (!m) { np.innerHTML = ''; np.style.display = 'none'; }
        else {
          var at = m.attributes, pic = at.entity_picture;
          np.style.display = '';
          np.innerHTML = (pic ? '<img alt="">' : '<div class="ph"></div>') + '<div><span class="t"></span> <span class="a"></span></div><div class="bars"><i></i><i></i><i></i></div>';
          if (pic) np.querySelector('img').src = pic;
          put(np.querySelector('.t'), at.media_title);
          put(np.querySelector('.a'), at.media_artist ? '\u00b7 ' + at.media_artist : '');
        }
      }
    };
  };

  FACES.classic = function (f, x) {
    var tm = el('div', 'tm'), dt = el('div', 'dt');
    f.append(tm, dt);
    return function (d) { var t = hm(d, x.h24); put(tm, t.h + ':' + t.m); put(dt, dateLine(d)); };
  };
  FACES.serif = function (f, x) {
    var tm = el('div', 'tm'), dt = el('div', 'dt');
    f.append(tm, dt);
    return function (d) { var t = hm(d, x.h24); put(tm, t.h + ':' + t.m); put(dt, DAYS[d.getDay()] + ' \u00b7 ' + MONTHS[d.getMonth()] + ' ' + d.getDate()); };
  };
  FACES.neon = function (f, x) {
    var tm = el('div', 'tm'), dt = el('div', 'dt');
    f.append(tm, dt);
    return function (d) { var t = hm(d, x.h24); var hv = t.h + '<b>:</b>' + t.m; if (tm._h !== hv) { tm._h = hv; tm.innerHTML = hv; } put(dt, shortDate(d)); };
  };

  // seven segments, a..g, in a 60 x 100 cell
  var SEGS = { a: '8,2 52,2 44,10 16,10', b: '54,4 54,46 46,40 46,12', c: '54,54 54,96 46,88 46,60', d: '8,98 52,98 44,90 16,90',
               e: '6,54 14,60 14,88 6,96', f: '6,4 14,12 14,40 6,46', g: '8,50 16,45 44,45 52,50 44,55 16,55' };
  var DIG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '' };
  FACES.lcd = function (f, x) {
    var panel = el('div', 'panel'), svg = document.createElementNS(SVGNS, 'svg'), cells = [];
    svg.setAttribute('viewBox', '0 0 290 104');
    [0, 64, -1, 160, 224].forEach(function (px) {
      if (px < 0) {
        var dots = [28, 66].map(function (y) {
          var r = document.createElementNS(SVGNS, 'rect');
          r.setAttribute('x', 140); r.setAttribute('y', y); r.setAttribute('width', 9); r.setAttribute('height', 9);
          svg.appendChild(r);
          return r;
        });
        cells.push({ colon: dots }); return;
      }
      var g = document.createElementNS(SVGNS, 'g'), segs = {};
      g.setAttribute('transform', 'translate(' + (px + 4) + ',2) skewX(-6)');
      Object.keys(SEGS).forEach(function (k) { var p = document.createElementNS(SVGNS, 'polygon'); p.setAttribute('points', SEGS[k]); g.appendChild(p); segs[k] = p; });
      svg.appendChild(g); cells.push({ segs: segs });
    });
    var row = el('div', 'row2'), ap = el('span'), dt = el('span');
    row.append(ap, dt); panel.append(svg, row); f.appendChild(panel);
    return function (d) {
      var t = hm(d, x.h24), s = (t.h.length < 2 ? ' ' + t.h : t.h) + t.m, i = 0;
      cells.forEach(function (c) {
        if (c.colon) { c.colon.forEach(function (r) { r.setAttribute('class', d.getSeconds() % 2 ? 'ghost' : 'seg'); }); return; }
        var on = DIG[s[i++]] || '';
        Object.keys(c.segs).forEach(function (k) { c.segs[k].setAttribute('class', on.indexOf(k) >= 0 ? 'seg' : 'ghost'); });
      });
      put(ap, x.h24 ? '24H' : t.ap);
      put(dt, DAYS[d.getDay()].slice(0, 3).toUpperCase() + ' ' + MONTHS[d.getMonth()].slice(0, 3).toUpperCase() + ' ' + d.getDate());
    };
  };

  FACES.flip = function (f, x) {
    function card() {
      var c = el('div', 'card'), up = el('div', 'half up'), dn = el('div', 'half dn'), sp = el('span'), cur = null;
      dn.appendChild(sp); c.append(up, dn);
      return { el: c, set: function (v) {
        if (v === cur) return;
        if (cur !== null) {
          var flap = el('div', 'half up flap'); put(flap, cur); c.appendChild(flap);
          requestAnimationFrame(function () { flap.style.transform = 'rotateX(-90deg)'; });
          setTimeout(function () { flap.remove(); }, 520);
        }
        cur = v; put(up, v); put(sp, v);
      } };
    }
    var cards = el('div', 'cards'), h1 = card(), h2 = card(), m1 = card(), m2 = card(), dt = el('div', 'dt');
    cards.append(h1.el, h2.el, el('div', 'colon', ':'), m1.el, m2.el);
    f.append(cards, dt);
    return function (d) {
      var t = hm(d, x.h24), h = t.h.length < 2 ? ' ' + t.h : t.h;
      h1.set(h[0] === ' ' ? '' : h[0]); h2.set(h[1]); m1.set(t.m[0]); m2.set(t.m[1]);
      put(dt, dateLine(d));
    };
  };

  FACES.analog = function (f) {
    var s = '<svg viewBox="-100 -100 200 200"><circle r="96" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.18)" stroke-width="1"/>';
    for (var i = 0; i < 60; i++) {
      var big = i % 5 === 0, a = i * 6 * Math.PI / 180, r1 = big ? 80 : 86, r2 = 92;
      s += '<line x1="' + (Math.sin(a) * r1).toFixed(2) + '" y1="' + (-Math.cos(a) * r1).toFixed(2) + '" x2="' + (Math.sin(a) * r2).toFixed(2) + '" y2="' + (-Math.cos(a) * r2).toFixed(2) +
           '" stroke="rgba(255,255,255,' + (big ? '.9' : '.35') + ')" stroke-width="' + (big ? 2.4 : 1) + '" stroke-linecap="round"/>';
    }
    s += '<text class="dl" y="34" text-anchor="middle" fill="rgba(255,255,255,.75)" font-size="7.5" font-weight="600" letter-spacing="1.4"></text>' +
         '<text class="dl2" y="44" text-anchor="middle" fill="rgba(255,255,255,.55)" font-size="6" font-weight="500" letter-spacing="1"></text>' +
         '<g class="hh"><line y1="8" y2="-48" style="stroke:var(--ckm,#fff)" stroke-width="5" stroke-linecap="round"/></g>' +
         '<g class="mh"><line y1="10" y2="-74" style="stroke:var(--ckm,#fff)" stroke-width="3.2" stroke-linecap="round"/></g>' +
         '<g class="sh" style="transition:transform .25s cubic-bezier(.4,2.2,.6,1)"><line y1="16" y2="-84" style="stroke:var(--ckh,#ff9f0a)" stroke-width="1.3" stroke-linecap="round"/><circle r="3.4" style="fill:var(--ckh,#ff9f0a)"/></g>' +
         '<circle r="1.4" fill="#000"/></svg>';
    f.innerHTML = s;
    var hh = f.querySelector('.hh'), mh = f.querySelector('.mh'), sh = f.querySelector('.sh'), dl = f.querySelector('.dl'), dl2 = f.querySelector('.dl2');
    var lastS = -1, turns = 0;
    return function (d) {
      var se = d.getSeconds(), mi = d.getMinutes() + se / 60, ho = (d.getHours() % 12) + mi / 60;
      if (se < lastS) turns++;
      lastS = se;
      hh.setAttribute('transform', 'rotate(' + (ho * 30).toFixed(2) + ')');
      mh.setAttribute('transform', 'rotate(' + (mi * 6).toFixed(2) + ')');
      sh.style.transform = 'rotate(' + (turns * 360 + se * 6) + 'deg)';
      put(dl, DAYS[d.getDay()].toUpperCase());
      put(dl2, MONTHS[d.getMonth()].toUpperCase() + ' ' + d.getDate());
    };
  };

  // the word clock's classic 11 x 10 grid
  var WG = ['ITLISASAMPM', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE', 'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK'];
  var WW = { IT: [0, 0, 2], IS: [0, 3, 2], A: [1, 0, 1], QUARTER: [1, 2, 7], TWENTY: [2, 0, 6], FIVE_M: [2, 6, 4], HALF: [3, 0, 4], TEN_M: [3, 5, 3], TO: [3, 9, 2], PAST: [4, 0, 4],
             NINE: [4, 7, 4], ONE: [5, 0, 3], SIX: [5, 3, 3], THREE: [5, 6, 5], FOUR: [6, 0, 4], FIVE: [6, 4, 4], TWO: [6, 8, 3], EIGHT: [7, 0, 5], ELEVEN: [7, 5, 6],
             SEVEN: [8, 0, 5], TWELVE: [8, 5, 6], TEN: [9, 0, 3], OCLOCK: [9, 5, 6] };
  var HOURW = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
  // the words lit at `d` (to the nearest five minutes), for the tests too
  function wordsAt(d) {
    var m = Math.round((d.getMinutes() + d.getSeconds() / 60) / 5) * 5, h = d.getHours();
    if (m === 60) { m = 0; h++; }
    var on = ['IT', 'IS'];
    if (m === 0) on.push('OCLOCK');
    else {
      var mm = m > 30 ? 60 - m : m;
      if (mm === 5) on.push('FIVE_M');
      if (mm === 10) on.push('TEN_M');
      if (mm === 15) on.push('A', 'QUARTER');
      if (mm === 20) on.push('TWENTY');
      if (mm === 25) on.push('TWENTY', 'FIVE_M');
      if (mm === 30) on.push('HALF');
      on.push(m > 30 ? 'TO' : 'PAST');
      if (m > 30) h++;
    }
    on.push(HOURW[h % 12]);
    return on;
  }
  FACES.words = function (f) {
    var g = el('div', 'g'), cells = [], dt = el('div', 'dt');
    WG.forEach(function (row, r) { cells[r] = []; row.split('').forEach(function (ch) { var i = el('i', null, ch); g.appendChild(i); cells[r].push(i); }); });
    f.append(g, dt);
    return function (d) {
      var lit = {};
      wordsAt(d).forEach(function (w) { var p = WW[w]; for (var k = 0; k < p[2]; k++) lit[p[0] + ',' + (p[1] + k)] = 1; });
      cells.forEach(function (row, r) { row.forEach(function (c, ci) { var on = !!lit[r + ',' + ci]; if (c.__on !== on) { c.__on = on; c.className = on ? 'on' : ''; } }); });
      put(dt, dateLine(d));
    };
  };

  FACES.arc = function (f, x) {
    var R = 88, C = 2 * Math.PI * R;
    f.innerHTML = '<svg viewBox="-100 -100 200 200"><circle r="' + R + '" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="5"/>' +
      '<circle class="ar" r="' + R + '" fill="none" style="stroke:var(--cka,#fff)" stroke-width="5" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="0 ' + C + '"/>' +
      '<text class="hr" y="16" text-anchor="middle" fill="#fff" font-size="70" font-weight="200" letter-spacing="-3"></text>' +
      '<text class="mn" y="38" text-anchor="middle" fill="rgba(255,255,255,.75)" font-size="11" font-weight="500" letter-spacing="2"></text>' +
      '<text class="dl" y="54" text-anchor="middle" fill="rgba(255,255,255,.55)" font-size="7" font-weight="600" letter-spacing="1.4"></text></svg>';
    var ar = f.querySelector('.ar'), hr = f.querySelector('.hr'), mn = f.querySelector('.mn'), dl = f.querySelector('.dl');
    return function (d) {
      var t = hm(d, x.h24), fr = (d.getMinutes() + d.getSeconds() / 60) / 60;
      ar.setAttribute('stroke-dasharray', (fr * C).toFixed(1) + ' ' + C);
      put(hr, t.h); put(mn, ':' + t.m + (x.h24 ? '' : ' ' + t.ap));
      put(dl, shortDate(d).toUpperCase());
    };
  };

  FACES.nixie = function (f, x) {
    function tube() {
      var t = el('div', 'tube'), ghost = el('div', 'dg ghost', '8'), lit = el('div', 'dg lit');
      t.append(ghost, lit);
      return { el: t, set: function (v) { if (lit.textContent !== v) put(lit, v); } };
    }
    var row = el('div', 'tubes'), a = tube(), b = tube(), c = tube(), e = tube(), dots = el('div', 'dots'), dt = el('div', 'dt');
    dots.append(el('div', 'dot'), el('div', 'dot'));
    row.append(a.el, b.el, dots, c.el, e.el);
    f.append(row, dt);
    return function (d) { var t = hm(d, x.h24), h = pad(+t.h); a.set(h[0]); b.set(h[1]); c.set(t.m[0]); e.set(t.m[1]); put(dt, shortDate(d)); };
  };

  FACES.poster = function (f, x) {
    var p = el('div', 'p'), hh = el('div', 'h'), mm = el('div', 'm'), tg = el('div', 'tag'), tg2 = el('div', 'tag2');
    p.append(hh, mm); f.append(p, tg, tg2);
    return function (d) { var t = hm(d, x.h24); put(hh, pad(+t.h)); put(mm, t.m); put(tg, DAYS[d.getDay()]); put(tg2, MONTHS[d.getMonth()] + ' ' + d.getDate()); };
  };

  // a 5 x 7 font for the dot matrix
  var DOTF = { 0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ':': ['0', '0', '1', '0', '1', '0', '0'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'] };
  // the board's columns: always the same count for the same digits -- the
  // colon keeps its column and only dims (swapping it for a space, five dots
  // wide, moved the whole time every second: the owner, 2026-10-13)
  function dotColumns(str, dim) {
    var cols = [];
    str.split('').forEach(function (ch) {
      var g = DOTF[ch] || DOTF[' '];
      for (var c = 0; c < g[0].length; c++) cols.push(g.map(function (r) { return r[c] === '1' && !(ch === ':' && dim) ? 1 : 0; }));
      cols.push([0, 0, 0, 0, 0, 0, 0]);
    });
    return cols;
  }
  FACES.dots = function (f, x) {
    var cv = el('canvas'), dt = el('div', 'dt'), g = cv.getContext('2d');
    cv.width = 960; cv.height = 300;
    f.append(cv, dt);
    return function (d) {
      var t = hm(d, x.h24), cols = dotColumns((t.h.length < 2 ? ' ' + t.h : t.h) + ':' + t.m, d.getSeconds() % 2 === 1);
      var led = (x.vars && x.vars['--ckled']) || '#ffb000', ledOff = rgba(led, 0.07);
      g.clearRect(0, 0, cv.width, cv.height);
      var n = cols.length, step = Math.min(cv.width / (n + 1), cv.height / 9), ox = (cv.width - n * step) / 2, oy = (cv.height - 7 * step) / 2, r = step * 0.36;
      for (var c = 0; c < n; c++) for (var rr = 0; rr < 7; rr++) {
        var on = cols[c][rr] === 1;
        g.beginPath(); g.arc(ox + c * step + step / 2, oy + rr * step + step / 2, r, 0, 7);
        g.fillStyle = on ? led : ledOff;
        g.shadowColor = on ? led : 'transparent'; g.shadowBlur = on ? step * 0.5 : 0;
        g.fill();
      }
      put(dt, (DAYS[d.getDay()] + '  \u00b7  ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate()).toUpperCase());
    };
  };

  FACES.ring = function (f, x) {
    var R = 86, built = '';
    f.innerHTML = '<svg viewBox="-100 -100 200 200"><defs><linearGradient id="ckdg" x1="0" x2="1"><stop offset="0" style="stop-color:var(--ckr1,#ff9f0a)"/><stop offset=".5" style="stop-color:var(--ckr2,#ffd60a)"/><stop offset="1" style="stop-color:var(--ckr3,#ff6b3d)"/></linearGradient></defs>' +
      '<path class="nt" fill="none" style="stroke:var(--ckrn,#2a3a6a)" stroke-width="9" stroke-linecap="round"/><path class="dy" fill="none" stroke="url(#ckdg)" stroke-width="9" stroke-linecap="round"/>' +
      '<circle class="sun" r="6.5" fill="#fff" stroke="#000" stroke-width="2"/>' +
      '<text class="tm" y="4" text-anchor="middle" fill="#fff" font-size="42" font-weight="300" letter-spacing="-1.5"></text>' +
      '<text class="dl" y="22" text-anchor="middle" fill="rgba(255,255,255,.8)" font-size="8" font-weight="600" letter-spacing="1.2"></text>' +
      '<text class="sb" y="36" text-anchor="middle" fill="rgba(255,255,255,.55)" font-size="7" font-weight="500" letter-spacing="1.2"></text></svg>';
    var nt = f.querySelector('.nt'), dy = f.querySelector('.dy'), sun = f.querySelector('.sun'), tm = f.querySelector('.tm'), dl = f.querySelector('.dl'), sb = f.querySelector('.sb');
    var arc = function (a0, a1) {
      var p = function (a) { var t = a / 24 * 2 * Math.PI - Math.PI / 2; return [Math.cos(t) * R, Math.sin(t) * R]; };
      var s = p(a0), e = p(a1), big = ((a1 - a0 + 24) % 24) > 12 ? 1 : 0;
      return 'M' + s[0].toFixed(2) + ' ' + s[1].toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + e[0].toFixed(2) + ' ' + e[1].toFixed(2);
    };
    var hhmm = function (v) { var h = Math.floor(v), m = Math.round((v - h) * 60); if (m === 60) { h++; m = 0; } return hm(new Date(2000, 0, 1, h % 24, m), x.h24); };
    return function (d) {
      var s = x.sun(), rise = s ? s.rise : 6.5, set = s ? s.set : 18.5, key = rise.toFixed(2) + '|' + set.toFixed(2);
      if (key !== built) { built = key; nt.setAttribute('d', arc(set, rise)); dy.setAttribute('d', arc(rise, set)); }
      var t = hm(d, x.h24), now = d.getHours() + d.getMinutes() / 60, a = now / 24 * 2 * Math.PI - Math.PI / 2;
      sun.setAttribute('cx', (Math.cos(a) * R).toFixed(2)); sun.setAttribute('cy', (Math.sin(a) * R).toFixed(2));
      put(tm, t.h + ':' + t.m);
      put(dl, shortDate(d).toUpperCase());
      var nx = now < rise ? ['SUNRISE', rise] : now < set ? ['SUNSET', set] : ['SUNRISE', rise], tt = hhmm(nx[1]);
      put(sb, nx[0] + ' ' + tt.h + ':' + tt.m + (x.h24 ? '' : ' ' + tt.ap));
    };
  };

  // GLASS: the pane is the background again, drawn small (its own blur) --
  // the Pre-rendered blur's way, never backdrop-filter, which a wall tablet
  // pays for on every frame (2026-10-13, the owner's choice)
  FACES.glass = function (f, x) {
    var g = el('div', 'g'), cv = el('canvas'), tint = el('div', 'tint'), inn = el('div', 'in'), tm = el('div', 'tm'), dt = el('div', 'dt');
    cv.width = 24; cv.height = 12;
    inn.append(tm, dt); g.append(cv, tint, inn); f.appendChild(g);
    x.glass = function (src) {
      if (!src || !src.width) { cv.style.display = 'none'; return; }
      var root = f.parentNode;
      if (!root || !root.getBoundingClientRect || !g.getBoundingClientRect) return;
      var rr = root.getBoundingClientRect(), pr = g.getBoundingClientRect();
      if (!rr || !rr.width || !pr.width) return;
      cv.style.display = '';
      var sx = (pr.left - rr.left) / rr.width * src.width, sy = (pr.top - rr.top) / rr.height * src.height;
      var sw = pr.width / rr.width * src.width, sh = pr.height / rr.height * src.height;
      var c = cv.getContext('2d');
      try { c.drawImage(src, Math.max(0, sx), Math.max(0, sy), Math.max(1, sw), Math.max(1, sh), 0, 0, cv.width, cv.height); } catch (e) { /* not ready */ }
    };
    return function (d) { var t = hm(d, x.h24); put(tm, t.h + ':' + t.m); put(dt, dateLine(d)); };
  };

  FACES.type = function (f, x) {
    var tx = el('div', 'tx'), last = '';
    f.appendChild(tx);
    return function (d) {
      var t = hm(d, x.h24), hr = d.getHours();
      var part = hr < 5 ? 'at night' : hr < 12 ? 'in the morning' : hr < 17 ? 'in the afternoon' : hr < 21 ? 'in the evening' : 'at night';
      var s = 'It\u2019s ' + t.h + ':' + t.m + ' ' + part + ',<br>' + DAYS[d.getDay()], s2 = ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + '.';
      if (s + s2 === last) return;
      last = s + s2;
      tx.innerHTML = s + s2 + '<span class="cur"></span>';
    };
  };

  // ------------------------------------------------------------ backgrounds
  // EVERY ONE MOVES BUT BLACK (2026-10-13, the owner: "they should all have
  // motion, with adjustable speed and maybe depth"). Speed 0-100 (0: still --
  // drawn again once a minute; 35: as designed), Depth 0-100: how strong
  // each one's effect is -- the drift's color, the ribbons' glow, the facets'
  // relief, the contours' count, the stars' web.
  //
  // A painter: size (the canvas: 'soft' 64 x 40 scaled up, or a share of the
  // screen), fps, init(w, h, o) (what doesn't change frame to frame), and
  // frame(x, w, h, t, o) -- t in seconds of the background's own time.
  var BW = 64, BH = 40;
  function hsl(h, s, l) { return 'hsl(' + h + ',' + s + '%,' + l + '%)'; }
  function skyStops() {
    // the live sky's own colors (hk-sky.js --sk0..3), when it is mounted
    try {
      var S = window.hkSky, e = S && S.element && S.element();
      if (e) {
        var cs = getComputedStyle(e), out = [0, 1, 2, 3].map(function (i) { return cs.getPropertyValue('--sk' + i).trim(); });
        if (out.every(Boolean)) return out;
      }
    } catch (err) { /* no sky */ }
    var hr = new Date().getHours();
    return hr < 6 || hr >= 21 ? ['#050a1c', '#0a1229', '#0f1a38', '#1a2245'] : hr < 8 ? ['#2a2f5e', '#6d4f7a', '#c4687a', '#f2a65a']
         : hr < 17 ? ['#1d5fa8', '#2f74ba', '#4f93cf', '#a7d2ef'] : ['#24305f', '#5d4673', '#a85a7a', '#f08c4a'];
  }
  // the hour's palette for the patterns: night blues, dawn rose, day teal,
  // dusk amber -- [deep, mid, light]
  function hourPalette() {
    var h = new Date().getHours();
    return h < 6 || h >= 21 ? ['#070b1d', '#1b2a5a', '#3a4d8f'] : h < 9 ? ['#2a1838', '#8a3f6b', '#f08a76']
         : h < 17 ? ['#06222e', '#0f5c6e', '#45b0b8'] : ['#1f1230', '#7a3552', '#f2a65a'];
  }
  function rgbOf(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mixRgb(a, b, f) { var A = rgbOf(a), B = rgbOf(b); return A.map(function (v, i) { return Math.round(v + (B[i] - v) * f); }); }
  function mix(a, b, f) { return 'rgb(' + mixRgb(a, b, f).join(',') + ')'; }
  function seeded(seed) { var s0 = seed >>> 0 || 1; return function () { s0 = (s0 * 1664525 + 1013904223) >>> 0; return s0 / 4294967296; }; }
  var D = function (o) { return (o.depth == null ? 50 : o.depth) / 100; };   // 0..1

  var PAINTERS = {
    black: { size: 'soft', still: true, frame: function (x, w, h) { x.fillStyle = '#05070e'; x.fillRect(0, 0, w, h); } },
    // GRAIN WASH: two colors drifting across each other, under fine grain
    // (a tile of noise over it, made once: the grain itself never redraws)
    grain: { size: 'soft', fps: 4, grain: true, frame: function (x, w, h, t, o) {
      var a = t * 0.05, g = x.createLinearGradient(w / 2 - Math.cos(a) * w, h / 2 - Math.sin(a) * h, w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * h);
      var d = D(o);
      g.addColorStop(0, mix('#2a2140', '#5a3f86', d)); g.addColorStop(0.5 + 0.3 * Math.sin(t * 0.07), mix('#1d2a3e', '#2f5577', d)); g.addColorStop(1, '#14182a');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    } },
    gradient: { size: 'soft', fps: 4, frame: function (x, w, h, t, o) {
      var d = D(o);
      x.fillStyle = '#0b1020'; x.fillRect(0, 0, w, h);
      [[200, 0.07, 0], [300, 0.05, 2], [20, 0.06, 4]].forEach(function (b) {
        var cx = w * (0.5 + 0.42 * Math.sin(t * b[1] + b[2])), cy = h * (0.5 + 0.42 * Math.cos(t * b[1] * 1.3 + b[2]));
        var r = x.createRadialGradient(cx, cy, 0, cx, cy, w * (0.4 + 0.4 * d));
        r.addColorStop(0, hsl((b[0] + t * 3) % 360, 45 + 40 * d, 26 + 26 * d)); r.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = r; x.fillRect(0, 0, w, h);
      });
    } },
    aurora: { size: 'soft', fps: 4, frame: function (x, w, h, t, o) {
      var d = D(o), gg = x.createLinearGradient(0, 0, 0, h); gg.addColorStop(0, '#020711'); gg.addColorStop(1, '#071a24');
      x.fillStyle = gg; x.fillRect(0, 0, w, h);
      for (var k = 0; k < 3; k++) {
        var col = k === 1 ? '140,90,255' : '40,255,170';
        for (var cx2 = 0; cx2 < w; cx2++) {
          var yy = h * (0.38 + 0.1 * k) + (Math.sin(cx2 * 0.12 + t * 0.5 + k * 2) * 4 + Math.sin(cx2 * 0.05 - t * 0.3 + k) * 5) * (0.5 + d);
          var al = (0.5 + 0.5 * Math.sin(cx2 * 0.09 + t * 0.7 + k * 1.7)) * (0.2 + 0.6 * d);
          var lg = x.createLinearGradient(0, yy - 14, 0, yy + 3);
          lg.addColorStop(0, 'rgba(' + col + ',0)'); lg.addColorStop(0.85, 'rgba(' + col + ',' + al.toFixed(3) + ')'); lg.addColorStop(1, 'rgba(' + col + ',0)');
          x.fillStyle = lg; x.fillRect(cx2, yy - 14, 1, 17);
        }
      }
    } },
    ink: { size: 'soft', fps: 4, frame: function (x, w, h, t, o) {
      var d = D(o), im = x.createImageData(w, h), E = im.data, sw = 0.8 + 1.2 * d;
      for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
        var u = xx / w * 3, v = y / h * 2;
        var q = Math.sin(u + Math.sin(v * 1.7 + t * 0.23) * 1.4 * sw + t * 0.11) + Math.sin(v * 2.1 + Math.sin(u * 1.3 - t * 0.17) * 1.6 * sw);
        var kk = (q + 2) / 4, c = 0.35 + 0.65 * d, oo = (y * w + xx) * 4;
        E[oo] = 18 + 70 * kk * kk * c; E[oo + 1] = 14 + 40 * kk * c; E[oo + 2] = 40 + 120 * kk * c; E[oo + 3] = 255;
      }
      x.putImageData(im, 0, 0);
    } },
    // FOLLOW THE SKY: the live sky's colors, a soft light drifting across
    sky: { size: 'soft', fps: 4, frame: function (x, w, h, t, o) {
      var st = skyStops(), sg = x.createLinearGradient(0, 0, 0, h);
      sg.addColorStop(0, st[0]); sg.addColorStop(0.42, st[1]); sg.addColorStop(0.72, st[2]); sg.addColorStop(1, st[3]);
      x.fillStyle = sg; x.fillRect(0, 0, w, h);
      var cx = w * (0.5 + 0.45 * Math.sin(t * 0.04)), cy = h * (0.3 + 0.15 * Math.cos(t * 0.03)), r = x.createRadialGradient(cx, cy, 0, cx, cy, w * 0.55);
      r.addColorStop(0, 'rgba(255,255,255,' + (0.05 + 0.2 * D(o)).toFixed(3) + ')'); r.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = r; x.fillRect(0, 0, w, h);
    } },
    // LOW POLY (Trianglify's look): the mesh made once; each frame a light
    // sweeps across it, every facet catching it in turn (Depth: the relief)
    lowpoly: { size: 0.5, light: true,
      init: function (w, h) {
        var pal = hourPalette(), rnd = seeded(20261013), cell = Math.max(40, w / 11), cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2, P = [], T = [];
        for (var r = 0; r < rows; r++) { P[r] = []; for (var c = 0; c < cols; c++) P[r][c] = [(c - 0.5 + (rnd() - 0.5) * 0.8) * cell, (r - 0.5 + (rnd() - 0.5) * 0.8) * cell]; }
        var tri = function (a, b, d) {
          var cx = (a[0] + b[0] + d[0]) / 3, cy = (a[1] + b[1] + d[1]) / 3, f = Math.max(0, Math.min(1, (cx / w) * 0.65 + (cy / h) * 0.35));
          T.push({ p: [a, b, d], cx: cx, cy: cy, col: f < 0.5 ? mix(pal[0], pal[1], f * 2) : mix(pal[1], pal[2], (f - 0.5) * 2), ph: rnd() * 6.28, tilt: rnd() - 0.5 });
        };
        for (var rr = 0; rr < rows - 1; rr++) for (var cc = 0; cc < cols - 1; cc++) {
          var a = P[rr][cc], b = P[rr][cc + 1], d = P[rr + 1][cc], e = P[rr + 1][cc + 1];
          if ((rr + cc) % 2) { tri(a, b, d); tri(b, e, d); } else { tri(a, b, e); tri(a, e, d); }
        }
        return { T: T, key: pal.join() };
      },
      // the facets, drawn once (their relief: Depth); the light that
      // sweeps across them is a layer of its own, moved by the browser
      frame: function (x, w, h, t, o, st) {
        var amp = 0.08 + 0.34 * D(o);
        st.T.forEach(function (q) {
          var sh = amp * q.tilt * 1.1;
          x.beginPath(); x.moveTo(q.p[0][0], q.p[0][1]); x.lineTo(q.p[1][0], q.p[1][1]); x.lineTo(q.p[2][0], q.p[2][1]); x.closePath();
          x.fillStyle = q.col; x.fill();
          x.fillStyle = sh > 0 ? 'rgba(255,255,255,' + sh.toFixed(3) + ')' : 'rgba(0,0,0,' + (-sh).toFixed(3) + ')'; x.fill();
          x.strokeStyle = x.fillStyle; x.lineWidth = 1; x.stroke();
        });
        var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,.1)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
      } },
    // TOPOGRAPHY (Gradient Topography's look): the contours flowing slowly
    // (Depth: more of them, and deeper); a quarter-size canvas -- scaled up,
    // the bands keep their smooth edges
    topo: { size: 0.25,
      init: function () { return { key: hourPalette().join() }; },
      frame: function (x, w, h, t, o) {
        var pal = hourPalette(), N = 6 + Math.round(D(o) * 6), im = x.createImageData(w, h), E = im.data, cols = [];
        for (var k = 0; k < N; k++) cols.push(mixRgb(pal[0], pal[2], k / (N - 1) * (0.6 + 0.3 * D(o))));
        var tu = t * 0.05, tv = -t * 0.035;
        for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
          var u = xx / w * 3 + tu, v = y / h * 2 + tv;
          var f = (Math.sin(u * 2.1 + Math.sin(v * 1.3) * 1.7) * 0.5 + Math.sin(v * 2.7 + Math.cos(u * 1.1) * 1.4) * 0.35 + Math.sin((u + v) * 1.4) * 0.25 + 1.1) / 2.2 * N;
          var band = Math.max(0, Math.min(N - 1, Math.floor(f))), edge = f - Math.floor(f), c = cols[band], line = 1 - 0.28 * Math.max(0, 1 - edge / 0.09), oo = (y * w + xx) * 4;
          E[oo] = c[0] * line; E[oo + 1] = c[1] * line; E[oo + 2] = c[2] * line; E[oo + 3] = 255;
        }
        x.putImageData(im, 0, 0);
      } },
    // CONSTELLATION (Particles' look): drifting points, joined while close
    // (Depth: more of them, and a wider web)
    constellation: { size: 0.5, live: true,
      init: function (w, h, o) {
        var rnd = Math.random, n = Math.round(Math.min(90, Math.max(20, w * h / 9000 * (0.5 + D(o))))), p = [];
        for (var i = 0; i < n; i++) p.push({ x: rnd() * w, y: rnd() * h, vx: (rnd() - 0.5) * 0.35, vy: (rnd() - 0.5) * 0.35 });
        return { p: p, last: 0, key: 'c' + Math.round(D(o) * 10) };
      },
      frame: function (x, w, h, t, o, st) {
        var p = st.p, dt = Math.min(4, Math.max(0, (t - st.last) * 30)), lim = Math.min(w, h) * (0.14 + 0.16 * D(o)), pal = hourPalette();
        st.last = t;
        var g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, pal[0]); g.addColorStop(1, mix(pal[0], pal[1], 0.5));
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        p.forEach(function (q) {
          q.x += q.vx * dt; q.y += q.vy * dt;
          if (q.x < 0 || q.x > w) q.vx = -q.vx;
          if (q.y < 0 || q.y > h) q.vy = -q.vy;
        });
        x.lineWidth = 1;
        for (var i = 0; i < p.length; i++) for (var j = i + 1; j < p.length; j++) {
          var dx = p[i].x - p[j].x, dy = p[i].y - p[j].y, dd = Math.sqrt(dx * dx + dy * dy);
          if (dd < lim) { x.strokeStyle = 'rgba(200,225,255,' + ((1 - dd / lim) * 0.45).toFixed(3) + ')'; x.beginPath(); x.moveTo(p[i].x, p[i].y); x.lineTo(p[j].x, p[j].y); x.stroke(); }
        }
        x.fillStyle = 'rgba(230,240,255,.85)';
        p.forEach(function (q) { x.beginPath(); x.arc(q.x, q.y, 1.6, 0, 7); x.fill(); });
      } }
  };
  function moving(kind) { return !!PAINTERS[kind] && !PAINTERS[kind].still; }
  // a tile of fine grain, made once (Grain Wash's texture)
  var grainUrl = null;
  function grainTile() {
    if (grainUrl) return grainUrl;
    try {
      var c = document.createElement('canvas'); c.width = 128; c.height = 128;
      var g = c.getContext('2d'), im = g.createImageData(128, 128), E = im.data;
      for (var i = 0; i < E.length; i += 4) { var n = Math.random() * 255; E[i] = n; E[i + 1] = n; E[i + 2] = n; E[i + 3] = 255; }
      g.putImageData(im, 0, 0);
      grainUrl = c.toDataURL('image/png');
    } catch (e) { grainUrl = ''; }
    return grainUrl;
  }

  // ------------------------------------------------------------ mount
  // opts: { style, h24, bg (a BGS id, or 'none': something else is behind),
  //         motion ('slow' | 'still'), client, scrim, drift }
  function mount(layer, opts) {
    opts = opts || {};
    var style = FACES[opts.style] ? opts.style : 'classic';
    var root = el('div', 'ckroot'), css = el('style'), cv = null, x = null;
    css.textContent = CSS;
    root.appendChild(css);
    var bg = opts.bg && opts.bg !== 'none' ? opts.bg : null;
    // THE BACKGROUND: its painter's canvas -- 'soft' 64 x 40, or a share of
    // the screen's size once it is laid out
    var flat = !!(window.hkSettings && window.hkSettings.rendering && window.hkSettings.rendering().flat);
    var P = !flat && bg ? PAINTERS[bg] || PAINTERS.gradient : null, pst = null;
    if (flat && bg && bg !== 'none') root.style.background = 'var(--hk-flat-ground,#17181A)';
    var speed = opts.speed != null ? Math.max(0, Math.min(100, +opts.speed || 0)) : (opts.motion === 'still' ? 0 : 35);
    // REDUCED MOTION: the background stands still (the CSS above stills only the light and the face; the
    // painters kept repainting and cross-fading every second)
    try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) speed = 0; } catch (e) { /* as set */ }
    var po = { depth: opts.depth != null ? Math.max(0, Math.min(100, +opts.depth || 0)) : 50 };
    // HOW IT MOVES SMOOTHLY (2026-10-13, the owner: "lots of these aren't
    // smooth"): drawn a few times a second, each frame jumped. Now the
    // browser's compositor carries the motion, at the screen's own rate:
    //   morph -- the soft fields: a frame drawn about once a second into a
    //            second canvas, cross-faded into continuously (a blurred
    //            field blended frame to frame reads as flowing -- and it is
    //            fewer frames drawn than before)
    //   light -- Low Poly: the facets drawn once; the light a layer that
    //            the browser slides across them
    //   live  -- Constellation: points that really move, drawn each frame
    //            the page shows (requestAnimationFrame, at most 30 a second)
    var how = !P ? null : P.still ? 'still' : P.live ? 'live' : P.light ? 'light' : 'morph';
    var cv2 = null, x2 = null;
    if (how === 'morph' && speed) {
      // two canvases: the front fades out over the back, which holds the next frame
      cv2 = el('canvas', 'ckbg'); cv2.width = BW; cv2.height = BH; x2 = cv2.getContext('2d');
      root.appendChild(cv2);
    }
    if (P) { cv = el('canvas', 'ckbg'); cv.width = BW; cv.height = BH; x = cv.getContext('2d'); root.appendChild(cv); }
    if (cv2) { cv.style.zIndex = '1'; cv2.style.zIndex = '0'; }
    if (how === 'light') {
      var lt = el('div', 'cklight');
      lt.style.setProperty('--ckla', (0.06 + 0.22 * po.depth / 100).toFixed(3));
      if (speed) lt.style.setProperty('--ckls', Math.round(40 * 35 / speed) + 's'); else lt.style.animation = 'none';
      root.appendChild(lt);
    }
    if (P && P.grain && grainTile()) {
      var gr = el('div', 'ckgrain');
      gr.style.cssText = 'position:absolute;inset:0;background-image:url(' + grainTile() + ');background-size:128px 128px;mix-blend-mode:overlay;opacity:' + (0.08 + 0.22 * po.depth / 100).toFixed(2);
      root.appendChild(gr);
    }
    var sizeCanvas = function () {
      if (!P || P.size === 'soft') return false;
      var lw = (layer.clientWidth || window.innerWidth || 1280), lh = (layer.clientHeight || window.innerHeight || 800);
      var k = Math.min(1.5, window.devicePixelRatio || 1) * P.size;
      var W = Math.max(64, Math.round(lw * k)), H = Math.max(40, Math.round(lh * k));
      if (cv.width === W && cv.height === H) return false;
      cv.width = W; cv.height = H;
      if (cv2) { cv2.width = W; cv2.height = H; }
      return true;
    };
    // a scrim keeps the face readable over what's behind (none over Black, or
    // a face with its own backdrop)
    if (opts.scrim !== false && bg !== 'black' && style !== 'poster' && style !== 'lcd') root.appendChild(el('div', 'ckscrim'));
    var face = el('div', 'face f-' + style);
    root.appendChild(face);
    // ITS COLOR: the chosen one's variables on the clock, over the face's own
    var color = colorOf(style, opts.color);
    Object.keys(color[2]).forEach(function (k) { root.style.setProperty(k, color[2][k]); });
    if (flat) {
      root.style.setProperty('--ckfg', 'var(--hk-ink,#F5F4F0)');
      root.style.color = 'var(--hk-ink,#F5F4F0)';
      var scrim = root.querySelector('.ckscrim');
      if (scrim) scrim.style.background = window.hkSettings.rendering().theme === 'light' ? 'rgba(238,236,230,.78)' : 'rgba(0,0,0,.65)';
    }
    layer.appendChild(root);
    var client = opts.client || null;
    var ctx = {
      h24: !!opts.h24, glass: null, vars: color[2], weather: opts.weather || null,
      client: function () { return client; },
      sun: function () {
        var s = client && client.states && client.states['sun.sun'], a = s && s.attributes;
        if (!a || !a.next_rising || !a.next_setting) return null;
        var hr = function (iso) { var d = new Date(iso); return isNaN(d) ? null : d.getHours() + d.getMinutes() / 60; };
        var r = hr(a.next_rising), st = hr(a.next_setting);
        return r === null || st === null ? null : { rise: r, set: st };
      }
    };
    var tick = FACES[style](face, ctx);
    // its own time: seconds times the Speed (35 is 1x); Speed 0 holds it
    var dead = false, tLast = Date.now(), tOwn = 0, rate = speed / 35, raf = 0, lastDraw = 0, nightOn = false;
    var MORPH = speed ? Math.max(400, Math.min(2500, Math.round(1000 * 35 / speed))) : 0;
    var draw = function (ctx2d, c, t) {
      var grew = sizeCanvas();
      // what doesn't change frame to frame: made again for a new size, or
      // the next part of the day
      if (P.init && (grew || !pst || (pst.key && pst.key.charAt(0) !== 'c' && pst.key !== hourPalette().join()))) pst = P.init(c.width, c.height, po) || {};
      P.frame(ctx2d, c.width, c.height, t, po, pst);
      if (ctx.glass) ctx.glass(c);
    };
    var paint = function () {
      if (dead || !x || nightOn) return;
      if (how !== 'morph' || !cv2) {
        var n2 = Date.now();
        tOwn += (n2 - tLast) / 1000 * rate;
        tLast = n2;
        draw(x, cv, tOwn);
        return;
      }
      // MORPH: the next frame into the back canvas, then the front fades out
      // over it for as long as a frame lasts; then they change places
      tOwn += MORPH / 1000 * rate;
      draw(x2, cv2, tOwn);
      cv.style.transition = 'opacity ' + MORPH + 'ms linear';
      cv.style.opacity = '0';
    };
    var swap = function () {
      if (!cv2) return;
      var f = cv, fx = x;
      cv = cv2; x = x2; cv2 = f; x2 = fx;
      cv.style.zIndex = '1';
      cv2.style.zIndex = '0';
      cv2.style.transition = 'none';
      cv2.style.opacity = '1';
    };
    var now = function () { if (!dead) tick(new Date()); };
    now();
    if (how === 'morph' && cv2) { draw(x, cv, 0); paint(); }
    else if (P) paint();
    // the glass needs the face laid out to know where it is
    requestAnimationFrame(function () { if (ctx.glass && cv) ctx.glass(cv); });
    // NOTHING DRAWS FOR A SCREEN NOBODY SEES (2026-10-29). The 30-a-second
    // loop, the face's second and the morph's frame all went on under the
    // kiosk's black and in a hidden page, drawing a canvas for no one: the
    // black is hk-saver.js's (hkSaver.black(), and 'hk-black' when it
    // changes), the hidden page the browser's. Held, nothing is scheduled at
    // all; the change that ends it starts them again (below).
    var tT = null, tStart = null, bT = null, rested = false;
    var held = function () {
      if (document.hidden) return true;
      var S = window.hkSaver;
      try { return !!(S && typeof S.black === 'function' && S.black()); } catch (e) { return false; }
    };
    var loop = function (ts) {
      if (dead) return;
      if (held()) { rest(); return; }            // resumes at wake()
      raf = requestAnimationFrame(loop);
      if (ts - lastDraw < 32) return;          // at most ~30 a second
      lastDraw = ts;
      paint();
    };
    var run = function () {
      if (flat && style === 'classic') tStart = setTimeout(function () { now(); tT = setInterval(now,60000); }, 60000 - Date.now() % 60000);
      else tT = setInterval(now,1000);
      if (!P) { /* nothing behind */ }
      else if (how === 'live' && speed) {
        raf = requestAnimationFrame(loop);
      } else if (how === 'morph' && cv2) {
        bT = setInterval(function () { if (dead) return; swap(); paint(); }, MORPH);
      } else {
        // still (Black, Speed 0) or Low Poly's facets: again once a minute --
        // the sky's colors, the part of the day
        bT = setInterval(paint, 60000);
      }
    };
    var rest = function () {
      if (rested) return;
      rested = true;
      clearInterval(tT); clearTimeout(tStart); if (bT) clearInterval(bT);
      tT = tStart = bT = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };
    var wake = function () {
      if (dead || !rested) return;
      rested = false;
      tLast = Date.now();                      // the time asleep is not motion
      now();
      run();
    };
    var recheck = function () { if (dead) return; if (held()) rest(); else wake(); };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('hk-black', recheck);
    if (held()) { rested = true; } else run();
    // BURN-IN: a few percent somewhere else every five minutes
    var dT = opts.drift === false ? null : setInterval(function () {
      face.style.transform = 'translate(' + ((Math.random() - 0.5) * 4).toFixed(2) + '%,' + ((Math.random() - 0.5) * 4).toFixed(2) + '%)';
    }, 300000);
    return {
      setClient: function (h) { client = h; },
      // NIGHT MODE (hk-saver.js): the background holds -- nothing behind the
      // clock is drawn while the screen is a dim red clock on black
      night: function (on) { nightOn = !!on; if (!nightOn) { tLast = Date.now(); } },
      destroy: function () {
        dead = true;
        clearInterval(tT); clearTimeout(tStart); if (bT) clearInterval(bT); if (dT) clearInterval(dT);
        if (raf) cancelAnimationFrame(raf);
        document.removeEventListener('visibilitychange', recheck);
        window.removeEventListener('hk-black', recheck);
        if (cv) { cv.width = 0; cv.height = 0; }
        if (cv2) { cv2.width = 0; cv2.height = 0; }
        if (root.parentNode) root.parentNode.removeChild(root);
      },
      style: style, color: color[0], speed: speed, depth: po.depth
    };
  }

  window.hkSaverClock = { STYLES: STYLES, BGS: BGS, COLORS: COLORS, mount: mount, _: { wordsAt: wordsAt, dotColumns: dotColumns, hm: hm, moving: moving, PAINTERS: PAINTERS } };
})();
