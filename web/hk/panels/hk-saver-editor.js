// @ts-check
// hk-saver-editor.js -- THE SCREENSAVER EDITOR (2026-11-01, the owner: "Lets do the editor!";
// docs/phase12/SCREENSAVER-EDITOR.md; rebuilt 2026-11-02 for phase 13, docs/phase13/EDITOR-SPEC.md and the approved
// mock-up, docs/phase13/mockup/screensaver-unified.html): the Home Grid editor's frame for the screensaver -- the Looks and
// the pieces on the left, the screen itself in the middle, what is chosen on the right.
//
// A screensaver is a BACKGROUND, a BIG ELEMENT (the time, the temperature, the date, the month) and PIECES in places
// (hk-saverlayout.js, v2: a piece in a shape). The background stays in the options it always was (show, clock_bg and
// the rest); the big element and the places are the options' `layout`.
//
// A LOOK is the background and the time: the background's keys, the face (clock_style; Planted is the Landscape's), and
// the big element's kind, size, place, align and depth. TAPPING A LOOK CHANGES THE LOOK ONLY: the Info -- the pieces
// in their places, the row's place and size, the ink and the accents, the upright screens -- stays. A piece the new
// Look has no place for waits in Info (Month has no row and no line). "Start Over from This Look" puts back the Look's
// own pieces (LOOKS below -- v2 pieces, never legacy flags).
//
// THE SCREEN IS THE SCREENSAVER ITSELF: the screen's page in a frame, the screensaver shown with the draft
// (hkSaver.preview's `over`), and the places drawn over it from the plan the screensaver drew by (hkSaver.layoutInfo) --
// what the editor shows is what the tablet draws, never a second guess at it. See a Slide and Day / Night above the
// screen are the preview's alone (hkSaver.previewSlide, hkSaver.previewNight): never saved.
//
// THE INSPECTOR, with nothing tapped, is four sections in this order -- Look, Info, Slides, Timing -- and a Reset row.
// EVERY ROW DECLARES applies(state) and is left out where it does nothing (rowsOf). A piece has a page of its own: its
// shapes drawn, its Size, Backdrop and Color, its options, when it shows, and where it is.
//
// TOUCH FIRST (the owner's iPad): tap a piece, then tap a green place on the screen (or tap a place first, and pick from
// what fits there). With a mouse a piece can also be dragged.
//
//   <hk-saver-editor>.configure({ panel, path, house, previewPath, title, onCancel, onSaved })
//     path: the screen whose screensaver this is (house: true -- All Screens'); previewPath: a screen to show it on
(function () {
  'use strict';
  if (window.customElements && customElements.get('hk-saver-editor')) return;
  var LM = null, WG = null;

  var DEVICES = [['tablet', 'Wall Tablet', 1280, 800], ['ipad', 'iPad Upright', 820, 1180], ['phone', 'Phone', 390, 844], ['side', 'Phone Sideways', 844, 390]];
  // WHAT IS BEHIND: [id, name, what it is, the options that make it]
  var BGS = [
    ['photos', 'Photos', 'Your albums, one after another', { show: 'photos' }],
    ['landscape', 'Landscape', 'The live sky over the season’s land', { show: 'forecast' }],
    ['sky', 'Sky Only', 'The live sky, no land', { show: 'clock', clock_bg: 'skyonly' }],
    ['color', 'Moving Color', 'Aurora, gradients, ink and patterns', { show: 'clock', clock_bg: 'aurora' }],
    ['wallpaper', 'Wallpaper', 'HK’s wallpapers', { show: 'clock', clock_bg: 'wallpaper' }],
    ['landscapes', 'HK Landscapes', 'Photographs of mountains and lakes', { show: 'clock', clock_bg: 'landscapes' }],
    // (blurred: the key it always meant to write -- phase 13, Soft Photos never blurred)
    ['soft', 'Soft Photos', 'Your photos, blurred and dimmed', { show: 'clock', clock_bg: 'photos', clock_photo_soft: true }],
    ['dayart', 'The Day’s Art', 'Occasions and the seasons', { show: 'day' }],
    ['calm', 'Calm Color', 'Glance’s quiet ground', { show: 'glance' }],
    ['paper', 'Paper', 'Month’s page', { show: 'month' }],
    ['black', 'Black', 'Nothing behind, for a bedroom', { show: 'clock', clock_bg: 'black' }]
  ];
  var COLOR_BGS = [['aurora', 'Aurora'], ['gradient', 'Drifting Gradient'], ['grain', 'Grain Wash'], ['ink', 'Ink Swirl'],
                   ['sky', 'Follow the Sky'], ['lowpoly', 'Low Poly'], ['topo', 'Topography'], ['constellation', 'Constellation']];
  // where something can stand in front of the time (Depth: Behind), and the backgrounds busy enough to need Legibility
  var BEHIND_BGS = ['photos', 'landscape'], BUSY_BGS = ['photos', 'soft', 'landscape', 'landscapes'];
  function bgOf(o) {
    if (o.show === 'photos' || o.show === 'both') return 'photos';
    if (o.show === 'forecast') return 'landscape';
    if (o.show === 'day') return 'dayart';
    if (o.show === 'glance') return 'calm';
    if (o.show === 'month') return 'paper';
    var b = o.clock_bg;
    return b === 'skyonly' ? 'sky' : b === 'forecast' ? 'landscape' : b === 'wallpaper' ? 'wallpaper' : b === 'photos' ? 'soft'
      : b === 'landscapes' ? 'landscapes' : b === 'black' ? 'black' : 'color';
  }
  // saverThumb's names for a background's small picture
  // (a clock background's own picture -- bg:<clock_bg> -- so Sky Only, Moving Color, Wallpaper and Black look like themselves)
  function thumbOf(id, o) { return { photos: 'photos', landscape: 'forecast', dayart: 'day', calm: 'glance', paper: 'month' }[id] || (o && o.clock_bg ? 'bg:' + o.clock_bg : 'clock'); }

  // ------------------------------------------------------------ the Looks
  // A Look: its background (BGS), its face (clock_style; none: the screen's own stays), the big element, and -- for Start Over
  // from This Look -- its pieces, as `piece.shape` per place. Pieces are the pieces' (hkSaverLayout PIECES), never the
  // first layouts' legacy ids.
  var LOOKS = [
    { id: 'photo', n: 'Photo Frame', about: 'Your photos, the time behind them', bg: 'photos', face: 'classic',
      big: { kind: 'time', size: 28, pos: 'top', align: 'center', depth: 'behind' },
      info: { line: ['date.inline'], row: ['weather.circular', 'sun.circular', 'events.rectangular'], tr: ['status.inline'], bl: ['music.card'] } },
    { id: 'lock', n: 'Lock Screen', about: 'Pieces under the time, as on iPhone', bg: 'landscape', face: 'classic',
      big: { kind: 'time', size: 26, pos: 'upper', align: 'center', depth: 'behind' },
      info: { line: ['date.inline'], row: ['weather.circular', 'readings.circular', 'timers.circular', 'status.circular'], bl: ['music.card'] } },
    { id: 'forecast', n: 'Forecast', about: 'The sky, the land and the forecast', bg: 'landscape', face: 'classic',
      big: { kind: 'time', size: 17, pos: 'top', align: 'left', depth: 'front' },
      info: { line: ['date.inline'], tr: ['status.inline'], br: ['music.card'], bottom: ['weather.band'] } },
    { id: 'bigweather', n: 'Big Weather', about: 'The temperature, very large, on the ground', bg: 'landscape', face: 'classic',
      big: { kind: 'temp', size: 40, pos: 'ground', align: 'left', depth: 'front' },
      info: { tl: ['time.inline', 'date.inline'], tr: ['status.inline'], bottom: ['readings.band'] } },
    { id: 'planted', n: 'Planted', about: 'The time standing in the meadow', bg: 'landscape', face: 'planted',
      big: { kind: 'time', size: 38, pos: 'ground', align: 'center', depth: 'front' },
      info: { tl: ['date.inline', 'weather.inline'], tr: ['status.inline'] } },
    { id: 'clock', n: 'Clock', about: 'A big clock on moving color', bg: 'color', face: 'classic',
      big: { kind: 'time', size: 30, pos: 'center', align: 'center', depth: 'front' },
      info: { line: ['date.inline'], tl: ['weather.card'], tr: ['status.card'], bl: ['music.card'] } },
    // (Glance, Month and the Day face draw their own words -- their hand-made date and month -- so their Looks leave the big
    // element to the face, and place only what the face doesn't show; as a screen with no saved layout draws them)
    { id: 'glance', n: 'Glance', about: 'The date, a clock, music and the weather', bg: 'calm', no: ['line', 'row'],
      big: { kind: 'none', size: 30, pos: 'top', align: 'left', depth: 'front' },
      info: { tr: ['status.inline'] } },
    { id: 'month', n: 'Month', about: 'This month, today circled', bg: 'paper', no: ['line', 'row'],
      big: { kind: 'none', size: 32, pos: 'center', align: 'center', depth: 'front' },
      info: { bl: ['music.card'], br: ['status.inline'] } },
    { id: 'day', n: 'Day', about: 'The day, with HK’s art for it', bg: 'dayart', no: ['line', 'row'],
      big: { kind: 'none', size: 34, pos: 'center', align: 'center', depth: 'front' },
      info: { tl: ['time.card', 'weather.inline'], tr: ['status.inline'], bl: ['music.card'] } },
    { id: 'night', n: 'Nightstand', about: 'Quiet, on black', bg: 'black', face: 'classic',
      big: { kind: 'time', size: 30, pos: 'center', align: 'center', depth: 'front' },
      info: { line: ['weather.inline'], br: ['timers.card'] } }
  ];
  var BIG_KINDS = [['time', 'Time'], ['temp', 'Temperature'], ['date', 'Date'], ['month', 'Month'], ['none', 'None']];
  var POS = [['top', 'Top'], ['upper', 'Upper'], ['center', 'Center'], ['lower', 'Lower']];
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function lookById(id) { for (var i = 0; i < LOOKS.length; i++) if (LOOKS[i].id === id) return LOOKS[i]; return null; }
  // which Look the options are (null: a background of your own making, with no Look of that name)
  function lookOf(o) {
    var bg = bgOf(o), B = (o.layout && o.layout.big) || {};
    if (['solar','prism','world','hotel','terminal','atelier','meridian','markets','brief','modular'].indexOf(o.clock_style) >= 0 && o.show === 'clock') return null;
    if (bg === 'landscape') {
      if (o.clock_style === 'planted') return 'planted';
      if (B.kind === 'temp') return 'bigweather';
      return B.kind === 'time' && B.size >= 22 ? 'lock' : 'forecast';
    }
    return { photos: 'photo', color: 'clock', calm: 'glance', paper: 'month', dayart: 'day', black: 'night' }[bg] || null;
  }
  // the big element being edited: the sideways one, or -- upright screens with a layout of their own -- the upright one
  function bigOf(o, upr) {
    var L = o.layout;
    return upr && L.upright && L.upright.big && L.upright.zones ? L.upright.big : L.big;
  }
  // WHAT THE BIG ELEMENT CAN'T DO OVER THIS BACKGROUND, it stops doing (sideways and upright); Planted is the Landscape's face,
  // and the first layouts' Planted depth is that face now
  function tidy(o) {
    var L = o.layout;
    if (!L) return o;
    var bg = bgOf(o);
    [L.big].concat(L.upright && L.upright.big ? [L.upright.big] : []).forEach(function (B) {
      if (B.depth === 'planted') { B.depth = 'front'; if (bg === 'landscape') o.clock_style = 'planted'; }
      if (B.depth === 'behind' && BEHIND_BGS.indexOf(bg) < 0) B.depth = 'front';
      if (B.depth === 'behind' && o.clock_style === 'planted') B.depth = 'front';
      if (B.pos === 'ground' && bg !== 'landscape') B.pos = 'lower';
    });
    if (o.clock_style === 'planted' && bg !== 'landscape') o.clock_style = 'classic';
    return o;
  }
  // A LOOK ONTO THE OPTIONS: the background, the face, the big element -- nothing of the Info
  function applyLook(o, look, upr) {
    var b = BGS.filter(function (x) { return x[0] === look.bg; })[0];
    var keepPattern = look.bg === 'color' && bgOf(o) === 'color' ? o.clock_bg : null, keepBoth = look.bg === 'photos' && o.show === 'both';
    Object.assign(o, b[3]);
    if (keepPattern) o.clock_bg = keepPattern;
    if (keepBoth) o.show = 'both';
    if (look.face) o.clock_style = look.face;
    else if (o.clock_style === 'planted') o.clock_style = 'classic';
    Object.assign(bigOf(o, upr), look.big);
    return tidy(o);
  }
  // a Look's own pieces as a layout (v2): Start Over from This Look
  function lookLayout(look) {
    var M = LM || window.hkSaverLayout;
    var L = { v: 2, big: Object.assign({}, look.big), zones: {}, row_at: 'under', upright: null };
    Object.keys(M.ZONES).forEach(function (z) {
      L.zones[z] = ((look.info || {})[z] || []).map(function (id) {
        var w = M.item(id);
        if (w.shape === 'card') w.back = 'glass';
        return w;
      });
    });
    return M.clean(L);
  }
  // the places this Look has no room for (Month has no row and no line): pieces there wait in Info
  function lacks(o, T) {
    var B = T.big || {}, look = lookById(lookOf(o));
    return B.kind === 'month' ? ['line', 'row'] : look && look.no ? look.no : [];
  }

  // the places, in the order Info lists them; where a shape goes first (a place's own preference among a piece's shapes)
  var ZONE_ORDER = ['line', 'row', 'tl', 'tr', 'bl', 'br', 'bottom'];
  var SHAPE_PREF = { line: ['inline'], row: ['circular', 'rectangular'], tl: ['inline', 'card'], tr: ['inline', 'card'],
                     bl: ['card', 'inline'], br: ['card', 'inline'], bottom: ['band'] };
  // ...and the nearest place when a piece's shape changes and its own place can't take the new shape
  var NEAR = { line: ['row', 'tl', 'tr', 'bl', 'br', 'bottom'], row: ['line', 'tl', 'tr', 'bl', 'br', 'bottom'],
               tl: ['tr', 'bl', 'br', 'line', 'row', 'bottom'], tr: ['tl', 'br', 'bl', 'line', 'row', 'bottom'],
               bl: ['br', 'tl', 'tr', 'row', 'line', 'bottom'], br: ['bl', 'tr', 'tl', 'row', 'line', 'bottom'],
               bottom: ['bl', 'br', 'tl', 'tr', 'row', 'line'] };
  // the library's groups, in order (hkSaverWidgets.PIECES[p].group); a group a file names differently is listed after them
  var GROUPS = ['Time and Calendar', 'Weather and Sky', 'Home', 'People and Travel', 'Energy', 'Media and Photos', 'Cameras', 'Any Sensor'];
  var GROUP_ALIAS = { People: 'People and Travel' };
  var CORNER_NAMES = { time: 'Time', date: 'Date', weather: 'Weather', status: 'House Status' };
  var SLIDE_KINDS = [['', 'None'], ['music', 'Music'], ['forecast', 'Forecast'], ['weather', 'Weather'], ['energy', 'Home Energy'], ['holiday', 'Holidays']];
  var OPS = [['is', 'Is'], ['not', 'Is Not'], ['above', 'Is Above'], ['below', 'Is Below']];
  var OP_WORDS = { is: 'is', not: 'is not', above: 'is above', below: 'is below' };
  // a piece's options, in the words a person uses (a piece's own wording first: 'alarm.entity')
  var OPT_LABELS = {
    reading: 'Reading', when: 'Shown', city: 'City', city2: 'Second City', match: 'Words in the Event', person: 'Person', camera: 'Camera',
    entity: 'Sensor', entity2: 'Second Sensor', name: 'Name', min: 'Ring Minimum', max: 'Ring Maximum',
    'alarm.entity': 'Alarm Sensor', 'trash.entity': 'Trash Calendar or Sensor', 'pollen.entity': 'Pollen Sensor', 'appliance.entity': 'Appliance',
    'appliance.entity2': 'Second Appliance', 'travel.entity': 'Place', 'travel.entity2': 'Second Place', 'price.entity': 'Price Sensor',
    'sensor.entity': 'Entity', 'sensor.entity2': 'Second Entity', 'camera.label': 'Name', 'camera.name': 'Custom Name',
    lines: 'Lines', weekday: 'Weekday', month: 'Month', year: 'Year', weight: 'Weight', case: 'Letters'
  };
  var OPT_SUBS = {
    match: 'The next event with these words in its title; empty, the next all-day event.', name: 'Empty: the entity’s own name.',
    min: 'The number where the ring is empty.', max: 'The number where the ring is full.'
  };
  var CHOICE_WORDS = { aqi: 'AQI', open: 'Only When Open', always: 'Always', normal: 'As Written', upper: 'All Capitals' };
  function titleCase(s) { return String(s).replace(/_/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function choiceName(key, v) {
    if (CHOICE_WORDS[v]) return CHOICE_WORDS[v];
    if (/^city2?$/.test(key)) return String(v).split('/').pop().replace(/_/g, ' ');
    return titleCase(v);
  }
  function listAnd(a) { return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  var CSS = [
    ':host{position:fixed;inset:0;z-index:1000;overflow:hidden}',
    '.editor{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--hk-bg)}',
    '.tools{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--hk-sep);background:var(--hk-cell);flex:none;z-index:4}',
    '.tools h1{font-size:20px;margin:0;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tools button{border:0;border-radius:8px;min-height:44px;padding:0 16px;background:var(--hk-fill);color:var(--hk-label);font:inherit;cursor:pointer}',
    '.tools .save{background:var(--hk-tint);color:white}.tools button:disabled{opacity:.4;cursor:default}',
    '.message{flex:none;color:var(--hk-red);min-height:24px;padding:6px 20px 0}.message.ok{color:var(--hk-label2)}',
    '.work{flex:1;min-height:0;overflow:hidden;box-sizing:border-box;display:grid;grid-template-columns:292px minmax(0,1fr) 352px;gap:20px;padding:16px 20px 0}',
    '@media(max-width:1380px){.work{grid-template-columns:248px minmax(0,1fr) 316px;gap:16px;padding:16px 16px 0}}',
    '.stage{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
    '.palette,aside.sidebar{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-bottom:32px}',
    // ABOVE THE SCREEN: the shapes; See a Slide; Day / Night
    '.bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin:0 0 12px}',
    '.bar .xtras{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}',
    '.bar .seeslide{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--hk-label2)}',
    '.bar .seeslide .pop{color:var(--hk-label);background:var(--hk-fill);border-radius:9px;min-height:32px;padding:0 12px}',
    '.pills{display:flex;background:var(--hk-fill);border-radius:9px;padding:2px;gap:2px}',
    '.pills button{border:0;background:none;border-radius:7px;min-height:32px;padding:0 12px;color:var(--hk-label);font:inherit;font-size:14px;cursor:pointer}',
    '.pills button[aria-pressed=true]{background:var(--hk-cell);box-shadow:0 1px 3px rgba(0,0,0,.18);font-weight:600}',
    '.note{font-size:13px;color:var(--hk-label2);line-height:1.5;margin:0}',
    '.under{flex:none;margin:12px auto 0;min-height:40px;text-align:center}',
    '.under b{color:var(--hk-label);font-weight:600}',
    '.framebox{position:relative;overflow:hidden;margin:0 auto;border-radius:14px;background:#000;outline:1px solid var(--hk-sep);flex:none}',
    '.framebox[data-loading]::after{content:"Loading the screensaver…";position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;font-size:15px;color:#ccc;background:#111}',
    '.frame{position:absolute;left:0;top:0;transform-origin:top left;overflow:hidden}',
    'iframe{position:absolute;inset:0;border:0;width:100%;height:100%;pointer-events:none}',
    // THE PLACES over the screen: the zones as the screen drew them, what is in them, and where a picked piece can go
    '.ov{position:absolute;inset:0;z-index:2}',
    '.ov .z,.ov .w,.ov .big{position:absolute;box-sizing:border-box;border-radius:14px;background:transparent;border:0;padding:0;cursor:pointer;font:inherit;color:#fff}',
    ':host(:not([previewing])) .ov .z{outline:2px dashed rgba(255,255,255,.7);outline-offset:3px;background:rgba(0,0,0,.12)}',
    ':host(:not([previewing])) .ov .z span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:var(--zf,22px);font-weight:600;text-align:center;line-height:1.1;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none}',
    ':host(:not([previewing])) .ov .w:hover,:host(:not([previewing])) .ov .big:hover{outline:2px solid rgba(255,255,255,.55);outline-offset:4px}',
    '.ov [aria-pressed=true]{outline:4px solid var(--hk-tint)!important;outline-offset:5px!important}',
    '.ov .z.want{outline:3px dashed #30d158!important;background:rgba(48,209,88,.18)!important}',
    // (dragged: what it is, at the pointer; the green place under it, brighter)
    '.ov .z.want.hover{background:rgba(48,209,88,.45)!important;outline-style:solid!important}',
    '.dragchip{position:fixed;z-index:20;pointer-events:none;transform:translate(-50%,-50%);padding:8px 14px;border-radius:12px;background:var(--hk-accent,#0a84ff);color:#fff;font-weight:600;font-size:14px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.3)}',
    '.pitem,.ov .w{-webkit-user-select:none;user-select:none}',
    // (the + after what a zone has: round, its sign drawn -- a glyph sits on the font's own math axis, off the middle of its line)
    ':host(:not([previewing])) .ov .z.plus{border-radius:50%}',
    ':host(:not([previewing])) .ov .z.plus span{font-size:0}',
    ':host(:not([previewing])) .ov .z.plus span::before,:host(:not([previewing])) .ov .z.plus span::after{content:"";position:absolute;left:50%;top:50%;width:min(44%,calc(var(--zf,22px) * 1.5));height:max(2px,calc(var(--zf,22px) * .09));border-radius:9px;background:currentColor;box-shadow:0 1px 4px rgba(0,0,0,.45);transform:translate(-50%,-50%)}',
    ':host(:not([previewing])) .ov .z.plus span::after{transform:translate(-50%,-50%) rotate(90deg)}',
    ':host([previewing]) .ov .z{display:none}',
    // (a piece with nothing to show now -- no music, no timer -- still has its place: drawn dotted, with its name and when it shows)
    ':host(:not([previewing])) .ov .w.empty{outline:2px dotted rgba(255,255,255,.8);outline-offset:3px;background:rgba(0,0,0,.18)}',
    ':host(:not([previewing])) .ov .w.empty span,:host(:not([previewing])) .ov .w.claimed span{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:calc(var(--zf,22px) * .8);font-weight:600;text-align:center;line-height:1.15;text-shadow:0 1px 4px rgba(0,0,0,.7);pointer-events:none;padding:0 6px;overflow:hidden}',
    // (a piece another shows the fact of -- the face, the big time -- drawn faded, with who shows it)
    ':host(:not([previewing])) .ov .w.claimed{outline:2px dashed rgba(255,214,10,.85);outline-offset:3px;background:rgba(0,0,0,.34);opacity:.62}',
    ':host(:not([previewing])) .ov .w small{font-size:.78em;font-weight:500;opacity:.9;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    ':host([previewing]) .ov .w.claimed{display:none}',
    '.ov .moved{position:absolute;pointer-events:none;font-size:calc(var(--zf,22px) * .8);font-weight:600;color:#000;background:#ffd60a;border-radius:8px;padding:4px 10px;white-space:nowrap}',
    ':host([previewing]) .ov{pointer-events:none}:host([previewing]) .ov .moved{display:none}',
    // THE LEFT PANE: Looks, then the pieces
    '.pick-banner{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:8px;margin:0 0 16px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--hk-tint) 18%,var(--hk-cell));font-size:14px;box-shadow:var(--hk-shadow)}',
    '.pick-banner[hidden]{display:none}.pick-banner span{flex:1}.pick-banner button{border:0;background:none;color:var(--hk-tint);font:inherit;cursor:pointer;min-height:32px}',
    '.looks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px}',
    '.lk{display:flex;flex-direction:column;gap:6px;min-width:0;padding:5px 5px 6px;border:2px solid transparent;border-radius:12px;background:none;cursor:pointer;text-align:left;color:var(--hk-label);font:inherit}',
    '.lk[aria-pressed=true]{border-color:var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 9%,transparent)}',
    '.lk .th{position:relative;width:100%;aspect-ratio:16/10;border-radius:7px;overflow:hidden;background:#1c1c1e}',
    '.lk .th .sthumb{position:absolute!important;inset:0;margin:0!important}',
    '.lk .th .tm{position:absolute;color:#fff;font-weight:600;line-height:1;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.45);letter-spacing:-.03em}',
    '.lk b{font-size:13px;font-weight:600;padding:0 2px}',
    '.srch{display:block;width:100%;margin:0 0 16px;border:0;border-radius:10px;padding:0 12px;min-height:36px;background:var(--hk-fill);color:var(--hk-label);font:inherit;font-size:15px}',
    '.srch::placeholder{color:var(--hk-label2)}',
    '.pcs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px}',
    '.pitem{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:0;padding:8px;border:2px solid transparent;border-radius:12px;background:var(--hk-fill);text-align:left;color:var(--hk-label);font:inherit;cursor:pointer}',
    '.pitem[aria-pressed=true]{border-color:var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 14%,var(--hk-fill))}',
    '.pitem .pv{display:flex;align-items:center;min-height:50px;max-width:100%;overflow:hidden;border-radius:8px;padding:4px 8px;background:linear-gradient(135deg,#46688f,#6d8aad);color:#fff;--tint:#fff}',
    '.pitem b{font-size:13px;font-weight:600;margin-top:2px}',
    '.pitem .shp{display:flex;gap:4px;flex-wrap:wrap}',
    '.pitem .shp i{font-style:normal;font-size:10px;line-height:15px;color:var(--hk-label2);border:1px solid var(--hk-sep);border-radius:5px;padding:0 5px}',
    '.pitem small{font-size:11px;color:var(--hk-label2);line-height:1.3}',
    // THE INSPECTOR
    '.insp-head{display:flex;align-items:center;gap:12px;padding:4px 4px 20px}',
    '.insp-head hk-icon{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:48px;height:48px;flex:none;border-radius:12px;background:var(--hk-cell);color:var(--hk-tint);--mdc-icon-size:26px}',
    '.insp-head h2{margin:0;font-size:20px;font-weight:700}.insp-head p{margin:2px 0 0;font-size:13px;color:var(--hk-label2)}',
    '.insp-head .done{margin-left:auto;border:0;background:none;color:var(--hk-tint);font:inherit;font-size:15px;cursor:pointer;min-height:44px}',
    '.sec{display:flex;align-items:baseline;gap:8px;margin:8px 4px 12px}',
    '.sec h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-.02em}.sec span{font-size:13px;color:var(--hk-label2)}',
    // Info's rows: the piece's sample, its name, its shape and place
    '.prow{cursor:pointer}',
    '.prow .psw{flex:none;position:relative;width:56px;height:34px;border-radius:8px;overflow:hidden;background:linear-gradient(135deg,#46688f,#6d8aad);--tint:#fff}',
    '.prow .psw .hksw{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.5);transform-origin:center}',
    '.prow .chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}',
    '.chip{font-size:11px;line-height:16px;border-radius:999px;padding:0 8px;background:var(--hk-fill);color:var(--hk-label2)}',
    '.chip.warn{background:color-mix(in srgb,var(--hk-orange) 15%,transparent);color:var(--hk-orange)}',
    '.prow .up{flex:none;border:0;border-radius:999px;width:32px;height:32px;padding:0;background:var(--hk-fill);color:var(--hk-tint);font:inherit;font-size:16px;cursor:pointer}',
    '.prow .up:disabled{opacity:.3;cursor:default}',
    '.seeit{flex:none;border:0;border-radius:999px;min-height:28px;padding:0 12px;background:var(--hk-fill);color:var(--hk-tint);font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
    '.seeit[aria-pressed=true]{background:var(--hk-tint);color:#fff}',
    // A piece's shapes, each drawn
    '.shtiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px}',
    '.shtile{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0;padding:5px 5px 7px;border:2px solid transparent;border-radius:12px;background:none;color:var(--hk-label);font:inherit;text-align:left;cursor:pointer}',
    '.shtile.wide{grid-column:span 2}',
    '.shtile[aria-checked=true]{border-color:var(--hk-tint);background:color-mix(in srgb,var(--hk-tint) 9%,transparent)}',
    '.shtile .swatch{display:flex;align-items:center;justify-content:center;min-height:64px;padding:10px;border-radius:8px;overflow:hidden;background:linear-gradient(135deg,#46688f,#6d8aad);color:#fff;--tint:#fff}',
    '.shtile b{font-size:13px;font-weight:600;padding:0 2px}',
    // THE ENTITY PICKER (a page of the sidebar)
    '.pk-list .cell{min-height:52px}',
    '@media(max-width:600px){.tools h1{display:none}}',
    '.mobile-tabs{display:none}.seeslide button{min-height:36px;border:0;border-radius:8px;padding:6px 10px;background:var(--hk-fill);color:var(--hk-label);font:inherit}',
    '@media(max-width:1100px){.tools{gap:6px;padding:8px}.tools h1{font-size:15px}.tools button{padding:0 9px}.mobile-tabs{display:flex;gap:8px;justify-content:center}.mobile-tabs button{min-height:36px;border:0;border-radius:10px;background:var(--hk-fill);color:var(--hk-label);padding:6px 20px;font:inherit}.work{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(240px,48%) minmax(0,1fr);gap:8px;padding:8px}.stage{grid-area:1/1}.palette,.sidebar{grid-area:2/1}.palette{display:none}:host([mobile-library]) .palette{display:block}:host([mobile-library]) .sidebar{display:none}.bar{margin-bottom:4px}.under{font-size:12px;margin:5px 0}.tools .undo{font-size:12px}.message{font-size:12px;padding:3px 10px;min-height:16px}.bar .xtras{gap:6px}.bar .pills{font-size:12px}.bar{gap:4px}.seeslide{font-size:12px!important}}'
  ].join('\n');

  class SaverEditor extends HTMLElement {
    constructor() {
      super(); this.attachShadow({ mode: 'open' });
      this.undoStack = []; this.sel = null; this.pick = null; this.device = 0; this.busy = false;
      this.slide = ''; this.night = false; this.q = ''; this.picker = null; this.showDraft = null; this.lastSig = '';
    }
    configure(o) {
      this.o = o; this.panel = o.panel; this.K = window.hkSettingsKit; this.h = this.K.h; this.M = window.hkSettingsModel;
      this.galleryOpen = !!o.gallery;
      this.opts = copy(this.M.saverOptions(o.options || {}));
      // (the preview's own, never saved: both start off each time the editor opens)
      this.slide = ''; this.night = false; this.panePreview = null;
      this.ready = Promise.all([
        window.hkSaverLayout ? null : import('/hk/modules/hk-saverlayout.js'),
        window.hkSaverWidgets ? null : import('/hk/modules/hk-saverwidgets.js'),
        window.hkSaverDesigns ? null : import('/hk/panels/hk-saver-designs.js')
      ]).then(() => {
        LM = window.hkSaverLayout; WG = window.hkSaverWidgets;
        // every glance group's pieces, for the library (each on its own: a file that fails leaves its pieces out)
        return Promise.all((LM.FILES || []).map(function (f) { return import('/hk/modules/hk-saverpieces-' + f + '.js').catch(function () { return null; }); }));
      }).then(() => {
        if (this.o.designId) this.opts = window.hkSaverDesigns.activate(this.opts, this.o.designId);
        // a screen with no layout yet opens on what it shows today; the first layouts' Planted depth is the Planted face
        this.opts.layout = (this.opts.layout && LM.clean(this.opts.layout)) || LM.layoutFrom(this.opts);
        // (music_slide and music_first are one key: the editor writes music_first)
        if (this.opts.music_slide && !this.opts.music_first) { this.opts.music_first = true; this.opts.music_slide = false; }
        tidy(this.opts);
        this.initial = JSON.stringify(this.opts);
      });
    }
    connectedCallback() {
      this.toggleAttribute('dark', this.panel.hasAttribute('dark'));
      if (this.ui) { this.fit(); return; }
      this.ready.then(() => {
        if (!this.isConnected || this.ui) return;
        this.draw();
        if (this.galleryOpen) window.hkSaverDesigns.gallery(this);
        this.ro = new ResizeObserver(() => { this.fit(); this.looksMeasure(); });
        this.ro.observe(this.stage); this.ro.observe(this.palette);
        this.unload = (e) => { if (this.dirty()) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', this.unload);
      });
    }
    disconnectedCallback() {
      if (this.ro) this.ro.disconnect();
      clearTimeout(this.ovT); clearInterval(this.waitT);
      window.removeEventListener('beforeunload', this.unload);
      try {
        var S = this.saver();
        if (S) { if (S.previewSlide) S.previewSlide(null); if (S.previewNight) S.previewNight(false); S.preview(false); }
      } catch (e) { /* gone */ }
      this.ui = null;
    }
    dirty() { return JSON.stringify(this.opts) !== this.initial; }
    say(text, ok) { this.message.textContent = text || ''; this.message.classList.toggle('ok', !!ok); }
    saver() { try { return this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.hkSaver; } catch (e) { return null; } }
    // THE PART OF THE LAYOUT BEING EDITED: the sideways one, or -- with upright screens set to their own, and an upright
    // shape shown -- the upright one (hk-saverlayout.js oriented)
    upright() { var d = DEVICES[this.device]; return d[3] > d[2]; }
    T(o) {
      var L = (o || this.opts).layout;
      return this.upright() && L.upright && L.upright.big && L.upright.zones ? L.upright : L;
    }
    rowSize() { return this.opts.layout.row_size || 100; }
    rowAt() { return this.T().row_at || this.opts.layout.row_at || 'under'; }
    // every piece placed: [{ z, i, w }] in the order Info lists them
    placed() {
      var zs = this.T().zones, out = [];
      ZONE_ORDER.forEach(function (z) { (zs[z] || []).forEach(function (w, i) { out.push({ z: z, i: i, w: w }); }); });
      return out;
    }
    client() {
      var c = this.panel && this.panel.client;
      if (c && c.states) return c;
      try { return this.iframe.contentWindow.hkCards.client(); } catch (e) { return null; }
    }
    states() { var c = this.client(); return (c && c.states) || {}; }
    nameOf(id) { var s = this.states()[id]; return (s && s.attributes && s.attributes.friendly_name) || id; }
    pname(w) { return (LM.PIECES[w.piece] || [])[2] || w.piece; }

    // ------------------------------------------------------------ the frame
    draw() {
      var h = this.h, K = this.K;
      this.shadowRoot.replaceChildren(h('style', { text: K.CSS + '\n' + CSS }), WG && WG.sheet ? WG.sheet() : h('style', { text: WG && WG.CSS || '' }));
      this.ui = h('div', { class: 'editor' }); this.shadowRoot.appendChild(this.ui);
      this.saveButton = h('button', { class: 'save', text: 'Save', onclick: () => this.save() });
      this.undoButton = h('button', { class: 'undo', text: 'Undo', title: 'Undo (⌘Z)', onclick: () => this.undo(), disabled: true });
      this.modeButton = h('button', { class: 'mode', text: 'Preview', onclick: () => this.togglePreview() });
      this.ui.appendChild(h('header', { class: 'tools' }, [h('button', { text: 'Cancel', onclick: () => this.cancel() }),
        h('h1', { text: this.o.title + ' · Screensaver' }), h('button', { text: 'Designs', onclick: () => window.hkSaverDesigns.gallery(this) }), this.undoButton, this.modeButton, this.saveButton]));
      this.ui.appendChild(h('nav', { class: 'mobile-tabs', 'aria-label': 'Editor panels' }, [h('button', { text: 'Pieces & Looks', onclick: () => { this.setAttribute('mobile-library', ''); this.fit(); } }), h('button', { text: 'Settings', onclick: () => { this.removeAttribute('mobile-library'); this.fit(); } })]));
      this.message = h('div', { class: 'message', role: 'status', 'aria-live': 'polite' }); this.ui.appendChild(this.message);
      this.palette = h('aside', { class: 'palette', 'aria-label': 'Looks and pieces' });
      this.stage = h('section', { class: 'stage', 'aria-label': 'The screensaver' });
      this.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Settings for what is chosen', tabindex: '0' });
      this.ui.appendChild(h('div', { class: 'work' }, [this.palette, this.stage, this.sidebar]));
      this.devBar = h('div', { class: 'pills', role: 'group', 'aria-label': 'Screen shape' });
      this.slideHost = h('div', { class: 'seeslide' });
      this.todBar = h('div', { class: 'pills', role: 'group', 'aria-label': 'Day or night' });
      this.stage.appendChild(h('div', { class: 'bar' }, [this.devBar, h('div', { class: 'xtras' }, [this.slideHost, this.todBar])]));
      this.box = h('div', { class: 'framebox', 'data-loading': 'yes' }); this.stage.appendChild(this.box);
      this.frame = h('div', { class: 'frame' }); this.box.appendChild(this.frame);
      this.iframe = h('iframe', { title: 'Screensaver preview', tabindex: '-1', 'aria-hidden': 'true' });
      this.iframe.inert = true;
      var x = this.panel.host && this.panel.host();
      this.iframe.src = this.panel.hostScreenBase() + '/' + (this.o.previewPath || this.o.path) + '/0?hk_kiosk=on&kiosk&wp_enabled=false' + (x && x.saverPage === true ? '&hk_preview=saver' : '');
      this.iframe.addEventListener('load', () => this.preview());
      this.frame.appendChild(this.iframe);
      this.ov = h('div', { class: 'ov', 'aria-label': 'Places on the screen' }); this.frame.appendChild(this.ov);
      this.ov.addEventListener('click', (e) => { if (e.target === this.ov) { this.sel = null; this.pick = null; this.redraw(); } });
      this.under = h('p', { class: 'note under' }); this.stage.appendChild(this.under);
      this.shadowRoot.addEventListener('keydown', (e) => this.keys(e));
      this.devices(); this.bars(); this.library(); this.side(); this.underText(); this.fit();
    }
    devices() {
      var h = this.h;
      this.devBar.replaceChildren.apply(this.devBar, DEVICES.map((d, i) => h('button', { type: 'button', text: d[1], 'aria-pressed': i === this.device ? 'true' : 'false',
        onclick: () => { this.device = i; this.devices(); this.fit(); this.redraw(); this.overlaySoon(); } })));
    }
    // SEE A SLIDE and DAY / NIGHT: the preview's alone, never saved
    bars() {
      var h = this.h, K = this.K;
      this.slideHost.replaceChildren(h('span', { text: 'Preview' }), K.popup({ label: 'Preview Slide', options: SLIDE_KINDS.map((x) => [x[0], x[0] ? x[1] : 'Screensaver']), value: this.slide, onChange: (v) => this.setSlide(v) }),
        K.popup({ label: 'Side Pane Preview', value: this.panePreview === null ? 'saved' : this.panePreview ? 'show' : 'hide', options: [['saved', 'As Saved'], ['show', 'Show'], ['hide', 'Hide']], onChange: (v) => { this.panePreview = v === 'saved' ? null : v === 'show'; this.applyExtras(); this.overlaySoon(); } }));
      this.todBar.replaceChildren.apply(this.todBar, [['day', 'Day'], ['night', 'Night']].map((d) => h('button', { type: 'button', text: d[1],
        'aria-pressed': (d[0] === 'night') === this.night ? 'true' : 'false', onclick: () => this.setNight(d[0] === 'night') })));
    }
    setSlide(v) {
      this.slide = v || ''; this.pick = null; this.slideOk = false; this.say('');
      if (this.slide) this.sel = null;
      this.bars(); this.applyExtras(); this.redraw(); this.underText(); this.overlaySoon();
    }
    setNight(on) { this.night = !!on; this.bars(); this.applyExtras(); }
    // (feature-detected: the screensaver gives the preview a slide and a night when it has them)
    applyExtras() {
      var S = this.saver();
      if (!S) return;
      try { if (S.previewPane) S.previewPane(this.panePreview); } catch (e) { /* loading */ }
      // (night first: a slide asked for after it is the one that shows)
      try { if (typeof S.previewNight === 'function') S.previewNight(this.night); } catch (e) { /* not yet */ }
      try { if (typeof S.previewSlide === 'function') this.slideOk = S.previewSlide(this.slide || null) !== false || !this.slide; } catch (e) { /* not yet */ }
    }
    slideKey(kind) { return kind === 'forecast' && this.opts.forecast_layout === 'big' ? 'forecast_big' : kind; }
    cornerWords(kind) {
      var hide = this.opts.corner_hide || [], add = LM.cornerFor(this.slideKey(kind)).filter(function (k) { return hide.indexOf(k) < 0; }).map(function (k) { return CORNER_NAMES[k]; });
      return add.length ? 'Its corner adds ' + listAnd(add) + '.' : 'Its corner adds nothing: the slide shows them.';
    }
    // THE LINE UNDER THE SCREEN: what the screen is, or -- on a slide -- what the slide shows and its corner adds
    underText() {
      if (!this.under) return;
      var h = this.h;
      if (this.slide) {
        var status = this.saver() && this.saver().previewStatus && this.saver().previewStatus();
        var key = this.slideKey(this.slide), S = LM.SLIDES[key];
        this.under.replaceChildren(h('b', { text: 'The ' + (S ? S.name : this.slide) + ' slide. ' }), document.createTextNode((status && status.message ? status.message + ' ' : '') + (status && status.paneMessage ? status.paneMessage + ' ' : '') + this.cornerWords(this.slide) + ' Choose Screensaver to edit the screen.'));
        return;
      }
      var ps = this.saver() && this.saver().previewStatus && this.saver().previewStatus();
      this.under.replaceChildren(document.createTextNode((ps && ps.paneMessage ? ps.paneMessage + ' ' : '') + 'Side Pane: As Saved follows this screen’s settings; Show and Hide affect only this preview. Tap something on it to change it; tap a piece on the left, then a green place, to add one. Nothing here acts on the house.'));
    }
    fit() {
      if (!this.box) return;
      var d = DEVICES[this.device], W = Number(d[2]), H = Number(d[3]);
      var top = this.box.offsetTop - this.stage.offsetTop, below = (this.under ? this.under.offsetHeight : 0) + 24;
      var s = Math.min(1, (this.stage.clientWidth || 800) / W, Math.max(200, this.stage.clientHeight - top - below) / H);
      this.frame.style.width = W + 'px'; this.frame.style.height = H + 'px'; this.frame.style.transform = 'scale(' + s + ')';
      this.box.style.width = W * s + 'px'; this.box.style.height = H * s + 'px';
      this.scale = s;
    }
    // THE SCREENSAVER, WITH THE DRAFT: shown in the frame once its page is there, again after each change
    preview() {
      clearInterval(this.waitT);
      var n = 0, go = () => {
        var S = this.saver();
        if (!S || typeof S.preview !== 'function') return false;
        S.preview(true, null, !!this.o.house, this.still());
        this.applyExtras();
        // (the house's notifications too: hushed in the frame)
        try { var N = this.iframe.contentWindow.hkNotify; if (N && N.hush) N.hush(true); } catch (e) { /* not yet */ }
        this.box.removeAttribute('data-loading');
        this.overlaySoon();
        return true;
      };
      if (!go()) this.waitT = setInterval(() => { if (go() || ++n > 120) clearInterval(this.waitT); }, 250);
    }
    // WHAT THE FRAME IS GIVEN: the options being edited, the slides held back -- the screen is what is being edited,
    // and music playing in the house put Music Full Screen over it (2026-11-01, on the house). See a Slide shows one.
    still() {
      var o = copy(this.opts);
      ['music_first', 'music_slide', 'energy_slide', 'weather_slide', 'holiday_slide', 'extra_music', 'extra_forecast'].forEach(function (k) { o[k] = false; });
      if (o.show === 'both') o.show = 'photos';
      return o;
    }
    // the places, once the screensaver has drawn them (it plans again as the big element and the pieces draw)
    overlaySoon() {
      clearTimeout(this.ovT);
      var tries = 0, step = () => {
        // (a slide asked for before the screen had drawn is asked for again; one that can't show now says why)
        if (this.slide && !this.slideOk) this.applyExtras();
        this.overlay(); this.underText();
        if (++tries < 6 || (this.slide && this.isConnected)) this.ovT = setTimeout(step, tries < 3 ? 350 : 1000);
        else if (this.slide && !this.slideOk && this.saver() && typeof this.saver().previewSlide === 'function') {
          this.say('The ' + (LM.SLIDES[this.slideKey(this.slide)] || { name: this.slide }).name + ' slide has nothing to show right now: Music needs something playing, Home Energy the day’s numbers.');
        }
      };
      this.ovT = setTimeout(step, 250);
    }
    overlay() {
      var h = this.h, self = this;
      this.ov.replaceChildren();
      // (a slide on show: nothing on it to tap)
      if (this.slide) return;
      var S = this.saver(), info = S && S.layoutInfo && S.layoutInfo();
      if (!info) return;
      this.live = info;
      var P = info.plan, zs = info.zones, rs = info.row_size || this.rowSize(), lack = lacks(this.opts, this.T());
      this.ov.style.setProperty('--zf', Math.max(11, Math.min(info.W, info.H) * 0.026).toFixed(1) + 'px');
      // (every box drawn, so what is drawn after stands clear of it: the owner, 2026-11-02, "lots of overlapping elements")
      var taken = [];
      var place = function (el, b) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; el.style.width = b.w + 'px'; el.style.height = b.h + 'px'; taken.push(b); return el; };
      var hits = function (b, pad) { return taken.some(function (t) { return b.x < t.x + t.w + pad && t.x < b.x + b.w + pad && b.y < t.y + t.h + pad && t.y < b.y + b.h + pad; }); };
      // (plus: the place after what a zone has, while it has room -- a + to tap, or Add Here with a piece picked)
      var zone = function (z, b, plus) {
        var want = self.pick && !!self.shapeFor(self.pick, z, zs);
        var e = place(h('button', { type: 'button', class: 'z' + (want ? ' want' : '') + (plus ? ' plus' : ''), 'data-zone': z, 'aria-pressed': self.sel === z ? 'true' : 'false',
                                    'aria-label': plus ? 'Add to ' + self.zoneName(z) : self.zoneName(z), onclick: (ev) => { ev.stopPropagation(); self.tapZone(z); } },
          [h('span', { text: plus ? '' : want ? 'Add Here' : self.zoneName(z) })]), b);
        self.ov.appendChild(e);
      };
      // ...room for one more piece of any kind the zone takes
      var room = function (z) { return Object.keys(LM.PIECES).some(function (p) { return !!self.shapeFor(p, z, zs); }); };
      var open = function (z) { return lack.indexOf(z) < 0; };
      var item = function (z, i, b) {
        var w = zs[z][i];
        if (!w) return;
        var key = z + ':' + i, none = !!(info.emptyAt && info.emptyAt[key]);
        var kids = none ? [h('span', {}, [document.createTextNode(self.pname(w)), h('small', { text: self.whenWords(w) })])] : [];
        self.ov.appendChild(place(h('button', { type: 'button', class: 'w' + (none ? ' empty' : ''), 'aria-pressed': self.sel === key ? 'true' : 'false',
          'aria-label': self.pname(w) + ', ' + self.zoneName(z) + (none ? ', nothing to show now' : ''), title: none ? self.pname(w) + ': ' + self.whenWords(w) : null, onclick: (ev) => { ev.stopPropagation(); self.select(key); },
          onpointerdown: (ev) => self.dragStart(ev, { piece: w.piece, from: { z: z, i: i } }) }, kids), b));
      };
      // the big element, and every place a piece can go: a place with nothing in it is drawn as an outline
      if (P.big) this.ov.appendChild(place(h('button', { type: 'button', class: 'big', 'aria-pressed': this.sel === 'look' ? 'true' : 'false',
        'aria-label': 'The big element, and the Look', onclick: (ev) => { ev.stopPropagation(); this.select('look'); } }), P.big));
      var big = this.T().big.kind !== 'none';
      var claimed = function (z, i) { return !!(info.claims && info.claims[z + ':' + i]); };
      if (zs.line.length && !claimed('line', 0)) item('line', 0, P.line); else if (!zs.line.length && big && open('line')) zone('line', P.line);
      if (zs.row.length) {
        P.row.items.forEach(function (it) { item('row', it.i, it); });
        // ONE MORE, ALWAYS SHOWN while there is room: a + as big as a piece after the last, on its line -- or under the row, a line full
        var last = P.row.items[P.row.items.length - 1];
        if (last && open('row') && (this.pick ? !!this.shapeFor(this.pick, 'row', zs) : room('row'))) {
          var units = zs.row.reduce(function (n, w) { return n + LM.unitsOf(w, rs); }, 0);
          var full = units % LM.ROW_LINE < 1e-9, d = last.h;
          zone('row', full ? { x: P.row.box.x + P.row.box.w / 2 - d / 2, y: P.row.box.y + P.row.box.h + 14, w: d, h: d }
                           : { x: last.x + last.w + 14, y: last.y, w: d, h: d }, true);
        }
      } else if (big && open('row')) zone('row', P.row.box);
      ['tl', 'tr', 'bl', 'br'].forEach(function (z) {
        (P.corners[z] || []).forEach(function (b) { item(z, b.i, b); });
        if (P.ghosts[z]) zone(z, P.ghosts[z]);
        else if ((self.pick ? !!self.shapeFor(self.pick, z, zs) : room(z)) && P.corners[z] && P.corners[z].length) {
          // (after the stack: under a top corner's, over a bottom one's; a + at its side's edge)
          // (by where the stack is: a top corner's moved out of the big element's way stands at the bottom)
          var last = P.corners[z][P.corners[z].length - 1], up = last.y > info.H / 2, d = Math.max(40, Math.min(64, info.H * 0.07)), left = z[1] === 'l';
          zone(z, { x: self.pick ? last.x : left ? last.x : last.x + last.w - d, y: up ? last.y - (self.pick ? 70 : d + 12) : last.y + last.h + 12,
                    w: self.pick ? Math.max(200, last.w) : d, h: self.pick ? 60 : d }, !self.pick);
        }
      });
      // (the band's empty place only while a band is being added: drawn always, it lay over the bottom corners)
      if (zs.bottom.length) { if (!claimed('bottom', 0)) item('bottom', 0, P.bottom); } else if (this.pick && this.shapeFor(this.pick, 'bottom', zs)) zone('bottom', P.bottom);
      P.moved.forEach(function (mv) {
        var b = (P.corners[mv.zone] || []).find(function (c) { return c.i === mv.i; });
        var t = h('div', { class: 'moved', text: mv.to ? 'Moved out of the big element’s way' : 'Left out: no room beside the big element' });
        if (b) { t.style.left = b.x + 'px'; t.style.top = (b.y > info.H / 2 ? b.y - 40 : b.y + b.h + 8) + 'px'; }
        else { t.style.left = '24px'; t.style.top = (mv.zone[0] === 't' ? 24 : info.H - 64) + 'px'; }
        self.ov.appendChild(t);
      });
      // A PIECE ANOTHER SHOWS THE FACT OF is not in the plan: faded, in its place's first spot, with who shows it
      var n = {};
      Object.keys(info.claims || {}).forEach(function (key) {
        var z = key.split(':')[0], i = +key.split(':')[1], w = zs[z] && zs[z][i];
        if (!w || !open(z)) return;
        var u = P.u, cw = 34 * u, ch = 7 * u, k = n[z] || 0, ref = null, x, y;
        n[z] = k + 1;
        if (z === 'line') ref = P.line; else if (z === 'row') ref = P.row.box; else if (z === 'bottom') ref = P.bottom;
        else {
          var stack = P.corners[z] || [], lastB = stack[stack.length - 1];
          ref = lastB || P.ghosts[z];
        }
        if (!ref) return;
        var top = z === 'tl' || z === 'tr', left = z === 'tl' || z === 'bl';
        if (z === 'tl' || z === 'tr' || z === 'bl' || z === 'br') {
          var base = P.corners[z] && P.corners[z].length ? (top ? ref.y + ref.h + P.gap : ref.y - P.gap - ch) : ref.y;
          y = top ? base + k * (ch + P.gap) : base - k * (ch + P.gap);
          x = left ? info.room.x + P.m : info.room.x + info.room.w - P.m - cw;
        } else { x = ref.x + (ref.w - cw) / 2; y = ref.y + ref.h + P.gap + k * (ch + P.gap); if (z === 'bottom') y = ref.y - ch - P.gap - k * (ch + P.gap); }
        // (past whatever is drawn there already -- the place's outline, its + , another piece shown elsewhere -- in the
        // direction its stack grows, kept on the screen)
        var dy = (top || z === 'line' || z === 'row' ? 1 : -1) * (ch + P.gap);
        for (var g = 0; g < 12 && hits({ x: x, y: y, w: cw, h: ch }, 6); g++) y += dy;
        y = Math.max(info.room.y + 4, Math.min(info.room.y + info.room.h - ch - 4, y));
        self.ov.appendChild(place(h('button', { type: 'button', class: 'w claimed', 'aria-pressed': self.sel === key ? 'true' : 'false',
          'aria-label': self.pname(w) + ' is shown by ' + info.claims[key], onclick: (ev) => { ev.stopPropagation(); self.select(key); } },
          [h('span', {}, [document.createTextNode(self.pname(w)), h('small', { text: 'Shown by ' + info.claims[key] })])]), { x: x, y: y, w: cw, h: ch }));
      });
      // the Info list's notes follow what the screen drew (claims, nothing to show, left out)
      var sig = JSON.stringify([info.claims, info.emptyAt, P.moved]);
      if (sig !== this.lastSig) {
        this.lastSig = sig;
        var act = this.shadowRoot.activeElement;
        if (!this.picker && !(act && this.sidebar.contains(act) && /^(input|select|textarea)$/i.test(act.tagName))) this.side();
      }
    }
    whenWords(w) {
      if (w.show) return this.showWords(w.show);
      var d = WG && WG.PIECES[w.piece];
      return d && d.when ? 'Shows ' + d.when : 'Nothing to show now';
    }
    showWords(s) { return 'Shows when ' + this.nameOf(s.entity) + ' ' + OP_WORDS[s.op] + ' ' + s.value; }

    // ------------------------------------------------------------ changes
    change(fn) {
      var before = copy(this.opts);
      fn(this.opts);
      tidy(this.opts);
      if (JSON.stringify(before) === JSON.stringify(this.opts)) return;
      this.undoStack.push({ opts: before, sel: this.sel });
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.undoButton.disabled = false; this.say('');
      this.redraw(); this.preview();
    }
    undo() {
      var last = this.undoStack.pop();
      if (!last || this.busy) return;
      this.opts = last.opts; this.sel = last.sel; this.pick = null; this.picker = null; this.showDraft = null;
      this.undoButton.disabled = !this.undoStack.length;
      this.redraw(); this.preview(); this.say('Undone.', true);
    }
    redraw() { this.libraryMarks(); this.side(); this.overlay(); }
    select(s) { this.removeAttribute('mobile-library'); this.sel = s; this.pick = null; this.picker = null; this.showDraft = null; if (s && this.slide) this.setSlide(''); this.redraw(); }
    zoneName(z) {
      var big = this.T().big.kind;
      var what = big === 'time' ? 'Time' : big === 'none' ? 'Middle' : 'Big Element';
      var names = { line: 'Above the ' + what, row: this.rowAt() === 'bottom' ? 'The Row, Along the Bottom' : 'Under the ' + what,
                    tl: 'Top Left', tr: 'Top Right', bl: 'Bottom Left', br: 'Bottom Right', bottom: 'Along the Bottom' };
      return names[z];
    }
    takes(z) { return LM.ZONES[z][0].map(function (k) { return LM.SHAPE_NAMES[k].toLowerCase(); }).join(' or ') + ' pieces'; }

    // WHICH SHAPE OF A PIECE A PLACE TAKES, the place's own preference first (a card in a bottom corner, a line in a top one);
    // null where none fits (the place is full, or takes none of the piece's shapes). `zs`: the places as they are
    // (without the piece, where it is being moved); `keep`: a shape tried before the rest
    shapeFor(piece, z, zs, keep) {
      var P = LM.PIECES[piece];
      if (!P || !LM.ZONES[z]) return null;
      if (lacks(this.opts, this.T()).indexOf(z) >= 0) return null;
      var rs = this.rowSize(), list = (keep ? [keep] : []).concat(SHAPE_PREF[z]);
      for (var i = 0; i < list.length; i++) {
        var sh = list[i];
        if (P[0].indexOf(sh) >= 0 && LM.ZONES[z][0].indexOf(sh) >= 0 && LM.fits(zs, z, piece + '.' + sh, rs)) return sh;
      }
      return null;
    }
    // a new piece in the place `z`: the shape that place takes; its card gets Glass (a card is read on a backdrop)
    newPiece(piece, shape) {
      var w = LM.item(piece + '.' + shape);
      if (shape === 'card') w.back = 'glass';
      return w;
    }
    tapZone(z) {
      if (this.pick) {
        var piece = this.pick, sh = this.shapeFor(piece, z, this.T().zones);
        if (!sh) { this.say(this.zoneName(z) + ' takes ' + this.takes(z) + ', and ' + this.pname({ piece: piece }) + ' has no room there.'); return; }
        this.pick = null;
        this.change((o) => { var zs = this.T(o).zones; zs[z].push(this.newPiece(piece, sh)); this.sel = z + ':' + (zs[z].length - 1); });
        var d = WG && WG.PIECES[piece];
        this.say('Added ' + this.pname({ piece: piece }) + ' (' + LM.SHAPE_NAMES[sh] + ') ' + this.zoneName(z).toLowerCase() + '.' + (d && d.off ? ' It shows only because you placed it.' : ''), true);
        return;
      }
      this.select(z);
    }
    pickPiece(piece) {
      var z = this.sel && LM.ZONES[this.sel] ? this.sel : null;
      if (z && this.shapeFor(piece, z, this.T().zones)) { this.pick = piece; this.tapZone(z); return; }
      if (this.pick === piece) { this.pick = null; this.redraw(); return; }
      var zs = this.T().zones;
      if (!Object.keys(LM.ZONES).some((zz) => !!this.shapeFor(piece, zz, zs))) { this.say('No room for ' + this.pname({ piece: piece }) + ': remove something from a place that takes ' + LM.PIECES[piece][0].map(function (s) { return LM.SHAPE_NAMES[s].toLowerCase(); }).join(' or ') + ' pieces first.'); return; }
      this.pick = piece; this.sel = null; this.picker = null; this.say('Tap a green place on the screen to put ' + this.pname({ piece: piece }) + ' there.', true);
      if (this.slide) this.setSlide('');
      if (this.hasAttribute('previewing')) this.togglePreview();
      this.redraw();
    }
    // DRAGGED ONTO THE SCREEN (2026-11-01, the owner: "are we not able to drag items from the picker/editor on the left
    // side into the areas we want them like HomeGrid?"): a piece from the left, or one on the screen to another place,
    // with a mouse -- the green places it fits light up, the one under the pointer brighter, and it is put where it is
    // let go; let go anywhere else and nothing changes. A finger keeps tap, then a green place (a touch on the list
    // scrolls it). `src`: { piece } from the left, { piece, from: { z, i } } from the screen
    dragStart(e, src) {
      if (e.button !== 0 || e.pointerType === 'touch' || this.busy) return;
      var self = this, x0 = e.clientX, y0 = e.clientY, chip = null, over = null, armed = false;
      e.preventDefault();
      var move = function (ev) {
        if (!armed) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
          armed = true;
          if (self.hasAttribute('previewing')) self.togglePreview();
          self.pick = src.piece; self.sel = null; self.redraw();
          chip = self.h('div', { class: 'dragchip', text: self.pname({ piece: src.piece }) });
          self.shadowRoot.appendChild(chip);
        }
        chip.style.left = ev.clientX + 'px'; chip.style.top = ev.clientY + 'px';
        var z = self.dropAt(chip, ev.clientX, ev.clientY);
        if (over && over !== z) over.classList.remove('hover');
        over = z;
        if (z) z.classList.add('hover');
      };
      var up = function (ev) {
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        if (!armed) return;                                   // (a click: tap, as before)
        if (chip) chip.remove();
        // (the click that follows a drag is the drag's, not a tap)
        var eat = function (c) { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', eat, true);
        setTimeout(function () { window.removeEventListener('click', eat, true); }, 0);
        var zone = ev.type === 'pointerup' && over ? over.getAttribute('data-zone') : null;
        if (!zone) { self.pick = null; self.redraw(); self.say('Let go on a green place to put ' + self.pname({ piece: src.piece }) + ' there.', true); return; }
        if (src.from) self.moveTo(src.from, zone); else self.tapZone(zone);
      };
      window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    }
    // WHERE A DRAG LANDS (2026-11-02, the owner: "the cursor has to be on the box ... not the actual item you are
    // dragging"): the green place the dragged piece covers most -- it is drawn centered on the pointer -- else the
    // one under the pointer, else the nearest within a finger's width of it
    dropAt(chip, x, y) {
      var zs = [].slice.call(this.ov.querySelectorAll('.z.want'));
      if (!zs.length) return null;
      var c = chip.getBoundingClientRect(), best = null, most = 0;
      zs.forEach(function (z) {
        var r = z.getBoundingClientRect();
        var a = Math.max(0, Math.min(c.right, r.right) - Math.max(c.left, r.left)) * Math.max(0, Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top));
        if (a > most) { most = a; best = z; }
      });
      if (best) return best;
      var el = this.shadowRoot.elementFromPoint(x, y), under = el && el.closest ? el.closest('.z.want') : null;
      if (under) return under;
      var near = null, d0 = 44;
      zs.forEach(function (z) {
        var r = z.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
        if (d < d0) { d0 = d; near = z; }
      });
      return near;
    }
    // a piece on the screen to another place, last in it (its shape changes to one that place takes, where it must)
    moveTo(from, z) {
      this.pick = null;
      if (from.z === z) { this.redraw(); return; }
      var zs = this.without(from.z, from.i), w = this.T().zones[from.z][from.i];
      var sh = w && this.shapeFor(w.piece, z, zs, w.shape);
      if (!sh) { this.redraw(); this.say(this.pname(w) + ' can’t go ' + this.zoneName(z).toLowerCase() + ': it takes ' + this.takes(z) + ', and there is no room for it.'); return; }
      this.change((o) => {
        var L = this.T(o).zones, it = L[from.z].splice(from.i, 1)[0];
        if (!it) return;
        it.shape = sh;
        if (z !== 'row' && it.size === 100) delete it.size;
        L[z].push(it); this.sel = z + ':' + (L[z].length - 1);
      });
      this.say(this.pname(w) + ' moved ' + this.zoneName(z).toLowerCase() + '. Undo (⌘Z) puts it back.', true);
    }
    // the places without one piece (to ask whether it fits somewhere else)
    without(z, i) {
      var zs = {}, src = this.T().zones;
      Object.keys(src).forEach(function (k) { zs[k] = src[k].slice(); });
      zs[z].splice(i, 1);
      return zs;
    }
    remove(z, i) {
      var w = this.T().zones[z][i];
      this.change((o) => { this.T(o).zones[z].splice(i, 1); this.sel = null; });
      if (w) this.say(this.pname(w) + ' removed. Undo (⌘Z) puts it back.', true);
    }
    keys(e) {
      var path = e.composedPath ? e.composedPath() : [e.target];
      if (path.find((el) => el.matches && el.matches('input,select,textarea'))) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
      if (e.key === 'Escape' && (this.pick || this.sel || this.picker)) { e.preventDefault(); this.pick = null; this.sel = null; this.picker = null; this.say(''); this.redraw(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel && this.sel.indexOf(':') > 0) {
        e.preventDefault(); var p = this.sel.split(':'); this.remove(p[0], +p[1]);
      }
    }
    togglePreview() {
      var on = !this.hasAttribute('previewing');
      this.toggleAttribute('previewing', on);
      this.modeButton.textContent = on ? 'Edit' : 'Preview';
      if (on) { this.sel = null; this.pick = null; this.picker = null; this.redraw(); }
    }
    async cancel() {
      if (this.busy) return;
      if (this.dirty() && !await this.K.confirm(this.shadowRoot, { title: 'Discard Changes?', message: 'The screensaver stays as it was.', ok: 'Discard', destructive: true })) return;
      this.o.onCancel();
    }
    async save() {
      if (this.busy) return;
      // (v2, as the model reads it: what it keeps of the draft; the write takes all of it or none)
      var out = copy(this.opts);
      window.hkSaverDesigns.sync(out);
      out.layout = LM.clean(out.layout);
      var code = LM.check(out.layout);
      if (code || !out.layout) { this.say('This can’t be saved: something is in a place that doesn’t take it. Undo the last change and try again.'); return; }
      this.busy = true; this.saveButton.disabled = true; this.say('Saving…', true);
      try {
        var put = this.o.house ? this.panel.saverPutH() : this.panel.saverPutB(this.o.path);
        await put(out);
        this.opts = copy(out); this.initial = JSON.stringify(this.opts);
        this.o.onSaved();
      } catch (e) {
        this.say('Couldn’t save. ' + (e && e.message || e));
      } finally { this.busy = false; this.saveButton.disabled = false; }
    }

    // ------------------------------------------------------------ the left pane
    library() {
      var h = this.h, K = this.K, self = this;
      this.banner = h('div', { class: 'pick-banner', hidden: true });
      this.looksHost = h('div', { class: 'looks', role: 'group', 'aria-label': 'Looks' });
      this.search = h('input', { type: 'search', class: 'srch', placeholder: 'Search Pieces', 'aria-label': 'Search pieces' });
      this.search.value = this.q;
      this.search.addEventListener('input', () => { this.q = this.search.value; this.pieces(); });
      this.piecesHost = h('div', { class: 'pieces' });
      this.palette.replaceChildren(this.banner,
        K.group({ header: 'Looks', footer: 'A Look is the background and the time. Tapping one keeps everything you placed.' }, [this.looksHost]),
        K.group({ header: 'Pieces', footer: 'One piece per fact, each in a few shapes. Tap one, then tap a green place on the screen.' }, []),
        this.search, this.piecesHost);
      this.looksMeasure(true);
      this.pieces();
      this.libraryMarks();
      void self;
    }
    // THE LOOKS, each a picture: the background as the existing small picture draws it, with the Look's time on it where
    // the Look puts it. Drawn at the width the pane gives them
    looksMeasure(force) {
      if (!this.looksHost) return;
      var th = this.looksHost.querySelector('.th'), w = th ? Math.round(th.clientWidth) : 0;
      if (!force && (!w || Math.abs(w - (this.thumbW || 0)) < 3)) return;
      // (before the first are drawn: what the pane leaves them -- its width, the card's padding, the gap, each one's border and padding)
      if (!w) w = Math.max(80, Math.floor(((this.palette.clientWidth || 292) - 15 - 24 - 8) / 2 - 14));
      this.thumbW = w;
      var h = this.h, self = this, tw = this.thumbW, thh = Math.round(tw * 10 / 16);
      var base = Object.assign({}, this.opts);
      this.looksHost.replaceChildren.apply(this.looksHost, LOOKS.map(function (look) {
        var box = h('span', { class: 'th' }), b = BGS.filter(function (x) { return x[0] === look.bg; })[0];
        try {
          var ob = Object.assign({}, base, b[3], look.face ? { clock_style: look.face } : {});
          var t = self.panel.saverThumb(tw, thh, look.id === 'bigweather' ? 'weather' : look.id === 'planted' ? 'forecast' : thumbOf(look.bg, ob), ob);
          if (t) box.appendChild(t);
        } catch (e) { /* a plain one */ }
        // the Look's time: where it stands and how large (a small picture of the big element)
        var B = look.big, bare = ['photos', 'forecast'].indexOf(thumbOf(look.bg, {})) >= 0 && look.id !== 'bigweather';
        if (B.kind !== 'none' && bare) {
          var txt = B.kind === 'time' ? '10:57' : B.kind === 'temp' ? '64°' : B.kind === 'date' ? '2' : 'NOV';
          var tm = h('span', { class: 'tm', text: txt }), fs = Math.max(8, Math.round(thh * B.size / 100 * 1.15));
          var top = { top: 8, upper: 24, center: 40, lower: 58, ground: 56 }[B.pos];
          tm.style.fontSize = fs + 'px'; tm.style.top = top + '%';
          if (B.align === 'left') tm.style.left = '8%'; else if (B.align === 'right') tm.style.right = '8%'; else { tm.style.left = '50%'; tm.style.transform = 'translateX(-50%)'; }
          box.appendChild(tm);
        }
        return h('button', { type: 'button', class: 'lk', 'data-look': look.id, 'aria-pressed': 'false', title: look.about, onclick: () => self.lookTap(look) },
          [box, h('b', { text: look.n })]);
      }));
      this.libraryMarks();
    }
    libraryMarks() {
      if (!this.looksHost) return;
      var cur = lookOf(this.opts), self = this;
      Array.prototype.forEach.call(this.looksHost.querySelectorAll('.lk'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-look') === cur)); });
      Array.prototype.forEach.call(this.piecesHost.querySelectorAll('.pitem'), function (b) { b.setAttribute('aria-pressed', String(self.pick === b.getAttribute('data-piece'))); });
      var banner = this.banner;
      banner.hidden = !this.pick;
      banner.replaceChildren();
      if (this.pick) {
        banner.appendChild(this.h('span', { text: 'Adding ' + this.pname({ piece: this.pick }) }));
        banner.appendChild(this.h('button', { type: 'button', text: 'Cancel', onclick: () => { this.pick = null; this.say(''); this.redraw(); } }));
      }
    }
    // TAPPING A LOOK changes the Look only; tapping the selected one opens its page
    lookTap(look) {
      if (lookOf(this.opts) === look.id) { this.select('look'); return; }
      var before = this.placed(), upr = this.upright() && this.T() !== this.opts.layout;
      this.change((o) => { applyLook(o, look, upr); });
      var lack = lacks(this.opts, this.T()), wait = this.placed().filter(function (p) { return lack.indexOf(p.z) >= 0; });
      var msg = 'Now ' + look.n + '.';
      if (before.length) msg += ' Your ' + before.length + (before.length === 1 ? ' piece stayed' : ' pieces stayed') +
        (wait.length ? '; ' + listAnd(wait.map((p) => this.pname(p.w))) + (wait.length === 1 ? ' waits' : ' wait') + ' in Info: ' + look.n + ' has no ' + lack.slice().reverse().join(' and no ') + '.' : '.');
      this.say(msg + ' Undo (⌘Z) puts back what you had.', true);
    }
    // THE PIECES, grouped as the glance catalog is, one entry per piece
    pieces() {
      var h = this.h, K = this.K, self = this, q = this.q.trim().toLowerCase(), by = {}, order = GROUPS.slice();
      Object.keys(LM.PIECES).forEach(function (p) {
        var d = WG && WG.PIECES[p], g = (d && d.group) || 'Home';
        g = GROUP_ALIAS[g] || g;
        if (order.indexOf(g) < 0) order.push(g);
        (by[g] = by[g] || []).push(p);
      });
      var kids = [];
      order.forEach(function (g) {
        var list = (by[g] || []).filter(function (p) {
          if (!q) return true;
          var shapes = LM.PIECES[p][0].map(function (s) { return LM.SHAPE_NAMES[s]; }).join(' ');
          return (LM.PIECES[p][2] + ' ' + g + ' ' + shapes + ' ' + self.pieceNotes(p).join(' ')).toLowerCase().indexOf(q) >= 0;
        });
        if (!list.length) return;
        kids.push(K.group({ header: g }, [h('div', { class: 'pcs' }, list.map(function (p) { return self.pitem(p); }))]));
      });
      if (!kids.length) kids.push(K.group({ footer: 'No piece matches “' + this.q.trim() + '”.' }, []));
      this.piecesHost.replaceChildren.apply(this.piecesHost, kids);
      this.libraryMarks();
      requestAnimationFrame(() => this.fitSamples());
    }
    // a sample wider than its cell (a line of words) is scaled to fit it, not cut off
    fitSamples() {
      if (!this.piecesHost) return;
      Array.prototype.forEach.call(this.piecesHost.querySelectorAll('.pitem .pv'), function (pv) {
        var el = pv.firstChild, room = pv.clientWidth - 16;
        if (!el || room <= 0) return;
        el.style.transform = '';
        var w = el.scrollWidth || el.offsetWidth;
        if (w > room) { el.style.transformOrigin = 'left center'; el.style.transform = 'scale(' + (room / w).toFixed(3) + ')'; el.style.flex = 'none'; }
      });
    }
    pieceNotes(p) {
      var d = WG && WG.PIECES[p], out = [];
      if (d && d.when) out.push('Shows ' + d.when);
      if (d && d.off) out.push('Off until placed');
      if (d && d.pick) out.push('Pick ' + d.pick);
      return out;
    }
    pitem(p) {
      var h = this.h, self = this, shapes = LM.PIECES[p][0], pv = h('span', { class: 'pv' });
      var el = this.sampleEl(p, shapes[0], { u: { inline: 4.2, circular: 3.6, rectangular: 2.8, card: 2.4, band: 1.3 }[shapes[0]] || 3 });
      if (el) pv.appendChild(el);
      var kids = [pv, h('b', { text: LM.PIECES[p][2] }), h('span', { class: 'shp' }, shapes.map(function (s) { return h('i', { text: LM.SHAPE_NAMES[s] }); }))];
      this.pieceNotes(p).forEach(function (t) { kids.push(h('small', { text: t })); });
      return h('button', { type: 'button', class: 'pitem', 'data-piece': p, 'aria-pressed': 'false', onclick: () => self.pickPiece(p),
                           onpointerdown: (ev) => self.dragStart(ev, { piece: p }) }, kids);
    }
    // a piece in a shape, drawn from the sample (no house data)
    sampleEl(piece, shape, o) {
      if (!WG || !WG.sample) return null;
      try { return WG.sample(piece, shape, Object.assign({ back: 'none', color: 'auto' }, o)); } catch (e) { return null; }
    }

    // ------------------------------------------------------------ the inspector
    head(icon, title, sub, done) {
      var h = this.h;
      var L = this.opts.layout, upr = this.upright() && L.upright && L.upright.big && L.upright.zones;
      if (upr && this.sel) sub = sub + ' · Upright Screens, Their Own';
      return h('div', { class: 'insp-head' }, [h('hk-icon', { icon: icon }), h('div', {}, [h('h2', { text: title }), h('p', { text: sub })]),
        done !== false ? h('button', { class: 'done', type: 'button', text: 'Done', onclick: () => this.select(null) }) : null]);
    }
    sec(title, sub) { return this.h('div', { class: 'sec' }, [this.h('h2', { text: title }), sub ? this.h('span', { text: sub }) : null]); }
    side() {
      var keep = this._for === this.sel && !this.picker ? this.sidebar.scrollTop : 0;
      this._for = this.sel;
      this.sidebar.replaceChildren();
      if (this.picker) this.pickerPage();
      else if (this.sel === 'look' || this.sel === 'big') this.lookPage();
      else if (this.sel && this.sel.indexOf(':') > 0) this.piecePage(this.sel.split(':')[0], +this.sel.split(':')[1]);
      else if (this.sel && LM.ZONES[this.sel]) this.zonePage(this.sel);
      else this.screenPage();
      this.sidebar.scrollTop = keep;
    }
    // WHAT EACH ROW KNOWS: the state a row's applies() is asked of
    state() {
      var o = this.opts, T = this.T(o), bg = bgOf(o);
      return { o: o, T: T, B: T.big, bg: bg, kind: T.big.kind, face: o.clock_style, land: bg === 'landscape', behind: BEHIND_BGS.indexOf(bg) >= 0,
               busy: BUSY_BGS.indexOf(bg) >= 0, placed: this.placed(), rows: T.zones.row.length,
               slidesOver: o.show === 'photos' || o.show === 'both' ? 'photos' : o.show === 'clock' || o.show === 'forecast' ? 'other' : 'face' };
    }
    // THE ROWS THAT APPLY: each declares applies(state); the rest are left out
    rowsOf(st, list) { return list.filter(function (r) { return !r.applies || r.applies(st); }).map(function (r) { return r.make(st); }).filter(Boolean); }
    screenPage() {
      var K = this.K, self = this, add = (n) => this.sidebar.appendChild(n), st = this.state(), look = lookById(lookOf(this.opts));
      add(this.head('mdi:image-multiple', 'Screensaver', this.o.house ? 'All Screens' : this.o.title, false));
      add(this.sec('Look', look ? look.n : ((this.M.CLOCK_STYLES.find((f) => f[0] === this.opts.clock_style) || [])[1] || 'Your own')));
      this.lookGroups(st).forEach(add);
      add(this.sec('Info', st.placed.length + ' placed'));
      this.infoGroups(st).forEach(add);
      add(this.sec('Slides', 'Now and then, over the screen'));
      this.slidesGroups(st).forEach(add);
      add(this.sec('Timing'));
      this.timingGroups().forEach(add);
      add(K.group({ header: 'Reset', footer: 'Back to how this screen’s screensaver looked before you opened the editor.' }, [
        K.button({ label: 'Reset…', destructive: true, fk: 'saver:reset', onClick: function () { self.reset(); } })]));
    }
    async reset() {
      if (!await this.K.confirm(this.shadowRoot, { title: 'Reset the Screensaver?', message: 'It goes back to how it looked before you opened the editor. Undo brings your changes back.', ok: 'Reset', destructive: true })) return;
      var back = this.M.saverOptions(this.o.options || {});
      this.change((o) => {
        Object.keys(o).forEach(function (k) { delete o[k]; });
        Object.assign(o, copy(back));
        o.layout = (o.layout && LM.clean(o.layout)) || LM.layoutFrom(o);
        if (o.music_slide && !o.music_first) { o.music_first = true; o.music_slide = false; }
        this.sel = null; this.pick = null;
      });
      this.say('Reset. Undo (⌘Z) brings your changes back.', true);
    }

    // ---- LOOK
    lookPage() {
      var K = this.K, self = this, add = (n) => this.sidebar.appendChild(n), st = this.state(), look = lookById(lookOf(this.opts));
      add(this.head('mdi:image-multiple', look ? look.n : ((this.M.CLOCK_STYLES.find((f) => f[0] === this.opts.clock_style) || [])[1] || 'Your Own Look'), look ? look.about : 'Customize the face, background and widgets', true));
      this.lookGroups(st).forEach(add);
      if (look) add(K.group({ header: 'Start Over', footer: 'Puts back ' + look.n + '’s own pieces in their places, and its background and time. The albums, the timing and the slides stay. Undo (⌘Z) takes it back.' }, [
        K.button({ label: 'Start Over from ' + look.n + '…', destructive: true, fk: 'saver:startover', onClick: function () { self.startOver(look); } })]));
    }
    async startOver(look) {
      if (!await this.K.confirm(this.shadowRoot, { title: 'Start Over from ' + look.n + '?', message: 'Everything you placed is replaced by ' + look.n + '’s own pieces. Undo brings it back.', ok: 'Start Over', destructive: true })) return;
      this.change((o) => {
        var upr = this.upright() && this.T(o) !== o.layout;
        applyLook(o, look, upr);
        var keep = { ink: o.layout.ink, accents: o.layout.accents, upright: o.layout.upright };
        var L = lookLayout(look);
        // (the Look's pieces and big element, for the shape being edited; the other shape keeps its own)
        if (upr) { o.layout.upright = Object.assign({}, o.layout.upright, { big: L.big, zones: L.zones }); }
        else { o.layout.big = L.big; o.layout.zones = L.zones; o.layout.row_at = 'under'; delete o.layout.row_size; }
        if (keep.ink) o.layout.ink = keep.ink;
        if (keep.accents === false) o.layout.accents = false;
        this.sel = 'look'; this.pick = null;
      });
      this.say(look.n + ': its own pieces are back. Undo (⌘Z) puts back what you had.', true);
    }
    // the Look section's groups: Background (and its options), Big, Legibility
    faceOptions(st) {
      var K = this.K, o = this.opts.clock_options || {}, self = this, style = this.opts.clock_style, rows = [];
      var set = function (key, value) { self.change(function (x) { x.clock_options = Object.assign({}, x.clock_options || {}); x.clock_options[key] = value; }); };
      var pick = function (key, label, values) { rows.push(K.select({ label: label, value: o[key] || values[0][0], options: values, onChange: function (v) { set(key, v); } })); };
      if (style === 'solar') pick('solar_dial', 'Dial', [['rays', 'Rays'], ['edge', 'Orbital'], ['minimal', 'Minimal']]);
      if (style === 'prism') pick('prism_style', 'Prism', [['glass', 'Glass'], ['outline', 'Outline'], ['solid', 'Solid']]);
      if (style === 'world') {
        pick('world_view', 'View', [['globe', 'Globe'], ['horizon', 'Horizon'], ['close', 'Close']]);
        rows.push(K.slider({ label: 'Globe Rotation', value: o.rotation || 0, min: -180, max: 180, step: 5, unit: '°', onChange: function (v) { set('rotation', v); } }));
      }
      if (style === 'hotel') pick('texture', 'Wall', [['linen', 'Linen'], ['paper', 'Paper'], ['dark', 'Dark']]);
      if (style === 'terminal') pick('board', 'Board', [['dark', 'Dark'], ['light', 'Light'], ['amber', 'Amber']]);
      if (style === 'atelier' || style === 'meridian') {
        pick('watch_shape', 'Case', [['round', 'Round'], ['cushion', 'Cushion'], ['rectangle', 'Rectangle']]);
        pick('metal', 'Metal', [['steel', 'Steel'], ['gold', 'Gold'], ['rose', 'Rose Gold']]);
      }
      if (['world', 'hotel', 'terminal'].indexOf(style) >= 0) {
        var cities = o.cities || [{ name: 'Local', zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }], max = style === 'world' ? 3 : style === 'hotel' ? 4 : 6;
        var zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Europe/Paris', 'Australia/Sydney'];
        zones = Array.from(new Set(['UTC'].concat(zones, cities.map(function (c) { return c.zone; })))).sort();
        cities.slice(0, max).forEach(function (city, i) {
          rows.push(K.text({ label: 'City ' + (i + 1), value: city.name, maxlength: 40, onCommit: function (v) { if (v.trim()) { var next = copy(cities); next[i].name = v.trim().slice(0, 40); set('cities', next); } } }));
          rows.push(K.select({ label: 'Time Zone ' + (i + 1), value: city.zone, options: zones.map(function (z) { return [z, z.replace(/_/g, ' ')]; }), onChange: function (v) { var next = copy(cities); next[i].zone = v; set('cities', next); } }));
        });
        if (cities.length < max) rows.push(K.button({ label: 'Add City', onClick: function () { set('cities', copy(cities).concat([{ name: 'London', zone: 'Europe/London' }])); } }));
        if (cities.length > 1) rows.push(K.button({ label: 'Remove Last City', onClick: function () { set('cities', cities.slice(0, -1)); } }));
      }
      if (style === 'markets') {
        var entities = o.market_entities || [];
        entities.forEach(function (id, i) { rows.push(self.entityRow({ label: 'Market ' + (i + 1), value: id, domains: ['sensor', 'input_number', 'number'], none: 'Remove', onPick: function (v) { var next = entities.slice(); if (v) next[i] = v; else next.splice(i, 1); set('market_entities', next); } })); });
        if (entities.length < 6) rows.push(this.entityRow({ label: 'Add Market Sensor', value: '', domains: ['sensor', 'input_number', 'number'], none: 'Choose…', onPick: function (v) { if (v) set('market_entities', entities.concat([v])); } }));
      }
      if (style === 'brief') rows.push(this.entityRow({ label: 'News Sensor', value: o.news_entity || '', domains: ['sensor'], none: 'Choose…', onPick: function (v) { self.change(function (x) { x.clock_options = Object.assign({}, x.clock_options); if (v) x.clock_options.news_entity = v; else delete x.clock_options.news_entity; }); } }));
      return rows.length ? K.group({ header: 'Face Options', footer: style === 'markets' ? 'Live values from your sensors. An optional change_percent attribute shows the daily change.' : style === 'brief' ? 'The sensor supplies headlines in an entries, items or news list. Headlines never open links or act on the house.' : 'These choices belong to this saved design.' }, rows) : null;
    }

    lookGroups(st) {
      var K = this.K, self = this, o = this.opts, M = this.M, B = st.B, out = [];
      var set = function (k) { return function (v) { self.change(function (x) { self.T(x).big[k] = v; }); }; };
      var put = function (k) { return function (v) { self.change(function (x) { x[k] = v; }); }; };
      var more = this.o.house ? '#/house/screensaver' : '#/screens/' + encodeURIComponent(this.o.path) + '/screensaver';
      var colors = (M.CLOCK_COLORS || {})[o.clock_style] || [];
      var bgRows = [
        { make: function () {
          return K.previewPick({ label: 'Background', sk: 'saver:bg', value: st.bg, options: BGS.map(function (b) { return [b[0], b[1]]; }),
            picture: function (v, w, ht) { var b = BGS.filter(function (x) { return x[0] === v; })[0], ob = Object.assign({}, o, b[3]); return self.panel.saverThumb(w, ht, thumbOf(v, ob), ob); },
            onChange: function (v) {
              var b = BGS.filter(function (x) { return x[0] === v; })[0];
              self.change(function (x) {
                var keepBoth = v === 'photos' && x.show === 'both';
                Object.assign(x, b[3]);
                if (keepBoth) x.show = 'both';
              });
            } });
        } },
        // Photos' Darken works at every depth
        { applies: function (s) { return s.bg === 'photos'; }, make: function () {
          return K.slider({ label: 'Darken', sub: 'The photos, behind anything on them', value: o.tb_dim || 0, min: 0, max: 80, step: 5, unit: '%', onChange: put('tb_dim') });
        } },
        { applies: function (s) { return s.bg === 'soft'; }, make: function () {
          return K.slider({ label: 'Darken', value: o.clock_photo_dim, min: 0, max: 80, step: 5, unit: '%', onChange: put('clock_photo_dim') });
        } },
        { applies: function (s) { return s.bg === 'color'; }, make: function () {
          return K.select({ label: 'Pattern', value: COLOR_BGS.some(function (c) { return c[0] === o.clock_bg; }) ? o.clock_bg : 'aurora', options: COLOR_BGS, onChange: put('clock_bg') });
        } },
        { applies: function (s) { return s.bg === 'color'; }, make: function () {
          return K.slider({ label: 'Speed', value: o.clock_speed, min: 0, max: 100, step: 5, unit: '%', onChange: put('clock_speed') });
        } },
        // Moving Color's parallax, which was called Depth: Depth is the time's alone
        { applies: function (s) { return s.bg === 'color'; }, make: function () {
          return K.slider({ label: 'Motion', sub: 'How far the pattern shifts as it moves', value: o.clock_depth, min: 0, max: 100, step: 5, unit: '%', onChange: put('clock_depth') });
        } },
        { applies: function (s) { return s.bg === 'dayart'; }, make: function () {
          return K.seg({ label: 'Art', value: o.day_look || 'auto', options: M.DAY_LOOKS, onChange: put('day_look') });
        } },
        { applies: function (s) { return s.bg === 'wallpaper'; }, make: function () {
          return K.nav({ label: 'Choose the Wallpaper', sub: 'On the Screensaver page', href: more });
        } }
      ];
      out.push(K.group({ header: 'Background' }, this.rowsOf(st, bgRows)));
      var big = [
        { make: function () { return K.seg({ label: 'Big', value: B.kind, options: BIG_KINDS, stack: true, onChange: set('kind') }); } },
        { applies: function (s) { return s.kind === 'time'; }, make: function () {
          var faces = M.CLOCK_STYLES.filter(function (f) { return f[0] !== 'planted' || st.land; }).map(function (f) { return [f[0], f[1]]; });
          return K.previewPick({ label: 'Face', sk: 'saver:face', value: o.clock_style, options: faces,
            picture: function (v, w, ht) { return self.panel.saverThumb(w, ht, 'clock:' + v, o); },
            onChange: function (v) { self.change(function (x) { x.clock_style = v; if (v === 'planted') self.T(x).big.pos = 'ground'; }); } });
        } },
        { applies: function (s) { return s.kind === 'time' && colors.length > 0; }, make: function () {
          return K.select({ label: 'Color', value: (o.clock_colors || {})[o.clock_style] || colors[0][0], options: colors,
            onChange: function (v) { self.change(function (x) { x.clock_colors = Object.assign({}, x.clock_colors || {}); x.clock_colors[x.clock_style] = v; }); } });
        } },
        // (Today's weather and its line of what's playing, under the time; the owner, 2026-11-02: the weather "should be a
        // toggle like What's Playing")
        { applies: function (s) { return s.kind === 'time' && s.face === 'today'; }, make: function () {
          return K.toggle({ label: 'Weather', sub: 'Today shows the weather under the time', on: o.clock_today_weather !== false, onChange: put('clock_today_weather') });
        } },
        { applies: function (s) { return s.kind === 'time' && s.face === 'today'; }, make: function () {
          return K.toggle({ label: 'What’s Playing', sub: 'Today shows the song under the weather', on: o.clock_today_music !== false, onChange: put('clock_today_music') });
        } },
        { applies: function (s) { return s.kind === 'time'; }, make: function () {
          return K.toggle({ label: '24-Hour Time', on: !!o.clock_24, onChange: put('clock_24') });
        } },
        { applies: function (s) { return s.kind !== 'none'; }, make: function () {
          return K.slider({ label: 'Size', value: B.size, min: LM.BIG.size[0], max: LM.BIG.size[1], unit: '%', onChange: set('size') });
        } },
        { applies: function (s) { return s.kind !== 'none'; }, make: function () {
          return K.seg({ label: 'Position', value: B.pos, options: POS.concat(st.land ? [['ground', 'Ground']] : []), stack: true, onChange: set('pos') });
        } },
        { applies: function (s) { return s.kind !== 'none'; }, make: function () {
          return K.seg({ label: 'Align', value: B.align, options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], onChange: set('align') });
        } },
        // DEPTH is the time's alone: Behind where something can stand in front of it, else a line that says why
        { applies: function (s) { return s.kind !== 'none' && s.behind && s.face !== 'planted'; }, make: function () {
          return K.seg({ label: 'Depth', sub: st.bg === 'photos' ? 'Behind: the photo’s subject stands in front of the time' : 'Behind: the land and the trees stand in front of the time',
            value: B.depth === 'behind' ? 'behind' : 'front', options: [['front', 'In Front'], ['behind', 'Behind']], onChange: set('depth') });
        } },
        { applies: function (s) { return s.kind !== 'none' && !s.behind && s.face !== 'planted'; }, make: function () {
          return K.info({ label: 'Depth', sub: 'Behind needs Photos or the Landscape, where something can stand in front of the time.', value: 'In Front' });
        } }
      ];
      if (st.kind === 'time') { var faceOptions = this.faceOptions(st); if (faceOptions) out.push(faceOptions); }
      out.push(K.group({ header: 'Big', footer: st.kind === 'none' ? 'Nothing is very large on the screen.' : 'Everything else moves out of the way: nothing is ever drawn over it.' }, this.rowsOf(st, big)));
      var leg = [
        { applies: function (s) { return s.busy && s.kind !== 'none'; }, make: function () {
          return K.slider({ label: 'Shadow', value: o.clock_text_shadow, min: 0, max: 100, step: 5, unit: '%', onChange: put('clock_text_shadow') });
        } },
        { applies: function (s) { return s.busy && s.kind !== 'none'; }, make: function () {
          return K.slider({ label: 'Outline', value: o.clock_text_outline, min: 0, max: 100, step: 5, unit: '%', onChange: put('clock_text_outline') });
        } }
      ];
      var legRows = this.rowsOf(st, leg);
      if (legRows.length) out.push(K.group({ header: 'Legibility', footer: 'Over a busy background: a soft shadow under the time, and an outline around it.' }, legRows));
      return out;
    }

    // ---- INFO
    infoGroups(st) {
      var K = this.K, self = this, h = this.h, out = [], L = this.opts.layout, lack = lacks(this.opts, st.T), live = this.live || {};
      // what is placed: its sample, name, shape and place; ↑ to move it up within its place; tap to open it
      var rows = st.placed.map(function (p) {
        var w = p.w, key = p.z + ':' + p.i, d = WG && WG.PIECES[w.piece], chips = [];
        var waits = lack.indexOf(p.z) >= 0, claim = live.claims && live.claims[key], empty = live.emptyAt && live.emptyAt[key];
        var moved = (live.plan && live.plan.moved || []).filter(function (m) { return m.zone === p.z && m.i === p.i; })[0];
        if (waits) chips.push(['warn', 'Waits: ' + (lookById(lookOf(self.opts)) || { n: 'Month' }).n + ' has no ' + (p.z === 'row' ? 'row' : 'line')]);
        else if (claim) chips.push(['warn', 'Shown by ' + claim]);
        else if (moved) chips.push(['warn', moved.to ? 'Moved out of the big element’s way' : 'Left out: no room beside the big element']);
        if (w.show) chips.push(['', self.showWords(w.show)]);
        else if (d && d.when) chips.push(['', 'Shows ' + d.when]);
        else if (empty) chips.push(['', 'Nothing to show now']);
        var sw = h('span', { class: 'psw', 'aria-hidden': 'true' }), el = self.sampleEl(w.piece, w.shape, { u: 4, back: w.back, color: w.color, opts: w.opts });
        if (el) sw.appendChild(el);
        var up = h('button', { type: 'button', class: 'up', text: '↑', 'aria-label': 'Move ' + self.pname(w) + ' up', title: 'Move up', disabled: p.i === 0,
          onclick: function (ev) { ev.stopPropagation(); self.change(function (x) { var l = self.T(x).zones[p.z], t = l[p.i - 1]; l[p.i - 1] = l[p.i]; l[p.i] = t; }); } });
        var row = h('div', { class: 'cell prow', role: 'button', tabindex: '0', 'data-key': key, onclick: function () { self.select(key); },
          onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); self.select(key); } } }, [
          sw, h('span', { class: 'lbl' }, [h('span', { class: 't', text: self.pname(w) }),
            h('small', { text: LM.SHAPE_NAMES[w.shape] + ' · ' + self.zoneName(p.z) }),
            chips.length ? h('span', { class: 'chips' }, chips.map(function (c) { return h('span', { class: 'chip' + (c[0] ? ' ' + c[0] : ''), text: c[1] }); })) : null]),
          up]);
        return row;
      });
      if (!rows.length) rows = [K.info({ label: 'Nothing placed', sub: 'Tap a piece on the left, then a green place on the screen.' })];
      out.push(K.group({ footer: st.placed.length > 1 ? 'Tap one to change it. ↑ moves it up within its place.' : null }, rows));
      var more = [
        { make: function () {
          return K.seg({ label: 'Ink', sub: 'One ink for every piece. Auto picks from the background.', value: L.ink || 'auto', options: [['auto', 'Auto'], ['white', 'White'], ['black', 'Black']], stack: true,
            onChange: function (v) { self.change(function (x) { if (v === 'auto') delete x.layout.ink; else x.layout.ink = v; }); } });
        } },
        { make: function () {
          return K.toggle({ label: 'Color Accents', sub: 'A little color where it means something: rings, glyphs and dots.', on: L.accents !== false,
            onChange: function (on) { self.change(function (x) { if (on) delete x.layout.accents; else x.layout.accents = false; }); } });
        } }
      ];
      out.push(K.group({ header: 'The Screen' }, this.rowsOf(st, more)));
      var row = [
        { applies: function (s) { return s.rows > 0; }, make: function () {
          return K.slider({ label: 'Size', sub: 'One size for the whole row', value: L.row_size || 100, min: LM.ITEM_SIZE[0], max: LM.ITEM_SIZE[1], step: 5, unit: '%',
            onChange: function (v) { self.change(function (x) { if (v === 100) delete x.layout.row_size; else x.layout.row_size = v; }); } });
        } },
        { applies: function (s) { return s.rows > 0; }, make: function () { return self.rowAtRow(); } }
      ];
      var rr = this.rowsOf(st, row);
      if (rr.length) out.push(K.group({ header: 'The Row', footer: 'Along the Bottom keeps the middle of a photo clear; the bottom corners stand beside the row, or above it where they would meet.' }, rr));
      var own = !!(L.upright && L.upright.big && L.upright.zones);
      out.push(K.group({ header: 'Upright Screens', footer: own ? 'An iPad held upright and a phone have a place for everything of their own: show iPad Upright or Phone above to change it.'
          : 'An iPad held upright and a phone show the same screen as sideways, fitted to their shape.' }, [
        K.seg({ label: 'Upright Screens', value: own ? 'own' : 'same', options: [['same', 'Same as Sideways'], ['own', 'Its Own']], stack: true, onChange: function (v) {
          self.change(function (x) {
            var own = { big: copy(x.layout.big), zones: copy(x.layout.zones) };
            if (x.layout.row_at) own.row_at = x.layout.row_at;
            x.layout.upright = v === 'own' ? own : null;
          });
          if (v === 'own' && !self.upright()) { self.device = 1; self.devices(); self.fit(); self.redraw(); self.overlaySoon(); }
        } })]));
      return out;
    }
    // WHERE THE ROW GOES (2026-11-01, the owner: "I may want it all the way at the bottom and not below the clock...
    // as that tends to be where faces are in pictures")
    rowAtRow() {
      var self = this;
      return this.K.seg({ label: 'The Row Goes', value: this.rowAt(), options: [['under', 'Under the Big Element'], ['bottom', 'Along the Bottom']], stack: true,
        onChange: function (v) { self.change(function (x) { self.T(x).row_at = v; }); } });
    }

    // ---- SLIDES
    slidesGroups(st) {
      var K = this.K, self = this, o = this.opts, M = this.M, out = [];
      var sky = o.show === 'forecast' || o.clock_bg === 'forecast' || o.clock_bg === 'skyonly';
      // See It: this slide, in the frame (the corner it adds drawn by the screensaver's own)
      var see = function (row, kind) {
        var on = self.slide === kind, b = self.h('button', { type: 'button', class: 'seeit', 'aria-pressed': String(on), text: on ? 'Back to Screen' : 'See It',
          'aria-label': (on ? 'Back to the screen from ' : 'See ') + (SLIDE_KINDS.filter(function (s) { return s[0] === kind; })[0] || ['', kind])[1], onclick: function (ev) { ev.stopPropagation(); self.setSlide(on ? '' : kind); } });
        row.insertBefore(b, row.lastChild);
        return row;
      };
      var forecastOn = st.slidesOver === 'photos' ? o.show === 'both' : !!o.extra_forecast;
      var fc = [
        // the forecast between the photos (a clock: now and then over it); the Landscape is the forecast already
        { applies: function (s) { return s.slidesOver === 'photos' || (s.slidesOver === 'other' && s.o.show === 'clock' && !sky); }, make: function () {
          return see(K.toggle({ label: 'The Forecast', sub: self.cornerWords('forecast'), on: forecastOn, onChange: function (on) {
            self.change(function (x) { if (x.show === 'photos' || x.show === 'both') x.show = on ? 'both' : 'photos'; else x.extra_forecast = on; });
          } }), 'forecast');
        } },
        { applies: function (s) { return (s.slidesOver === 'photos' || (s.slidesOver === 'other' && s.o.show === 'clock' && !sky)) && forecastOn; }, make: function () {
          return K.seg({ label: 'The Forecast', sub: self.cornerWords('forecast'), value: o.forecast_layout === 'big' ? 'big' : 'classic', options: M.FORECAST_LAYOUTS,
            onChange: function (v) { self.change(function (x) { x.forecast_layout = v; }); } });
        } },
        { make: function () {
          return see(K.toggle({ label: 'Music Full Screen', sub: self.cornerWords('music'), on: !!(o.music_first || o.music_slide),
            onChange: function (on) { self.change(function (x) { x.music_first = on; x.music_slide = false; }); } }), 'music');
        } },
        { applies: function () { return !sky; }, make: function () {
          return see(K.toggle({ label: 'Weather', sub: self.cornerWords('weather'), on: !!o.weather_slide,
            onChange: function (on) { self.change(function (x) { x.weather_slide = on; }); } }), 'weather');
        } },
        { make: function () {
          return see(K.toggle({ label: 'Home Energy', sub: self.cornerWords('energy'), on: !!o.energy_slide,
            onChange: function (on) { self.change(function (x) { x.energy_slide = on; }); } }), 'energy');
        } },
        // (the Holiday slide, phase 20: only once a holiday is near; its options on the Screensaver page)
        { make: function () {
          return see(K.toggle({ label: 'Holidays', sub: self.cornerWords('holiday'), on: !!o.holiday_slide,
            onChange: function (on) { self.change(function (x) { x.holiday_slide = on; }); } }), 'holiday');
        } },
        { applies: function () { return !!o.holiday_slide; }, make: function () {
          var pick = { turns: 'Take Turns', one: 'One Holiday' }[o.holiday_pick] || 'Next Up';
          return K.nav({ label: 'Holiday Options', value: pick + ' · ' + (o.holiday_days === 30 || o.holiday_days === 90 ? o.holiday_days : 60) + ' Days',
            href: (self.o.house ? '#/house/screensaver' : '#/screens/' + encodeURIComponent(self.o.path) + '/screensaver') + '/holiday', sk: 'saver:holiday_options' });
        } }
      ];
      var any = o.music_first || o.music_slide || o.weather_slide || o.energy_slide || o.holiday_slide || forecastOn;
      var oft = [
        { applies: function (s) { return any && s.slidesOver === 'photos'; }, make: function () {
          var cur = Number(o.forecast_every) || 5;
          return K.select({ label: 'How Often', value: String(cur), options: [3, 5, 10, 20].concat([3, 5, 10, 20].indexOf(cur) < 0 ? [cur] : []).map(function (n) { return [String(n), 'Every ' + n + ' Photos']; }),
            onChange: function (v) { self.change(function (x) { x.forecast_every = Number(v); }); } });
        } },
        { applies: function (s) { return any && s.slidesOver !== 'photos'; }, make: function () {
          var cur = Number(o.extra_every) || 5, EV = [1, 2, 5, 10, 15, 30];
          return K.select({ label: 'How Often', value: String(cur), options: EV.concat(EV.indexOf(cur) < 0 ? [cur] : []).map(function (n) { return [String(n), n === 1 ? 'Every Minute' : 'Every ' + n + ' Minutes']; }),
            onChange: function (v) { self.change(function (x) { x.extra_every = Number(v); }); } });
        } }
      ];
      out.push(K.group({ footer: 'A slide fades in over the screen now and then; Music Full Screen while something plays. The screen here leaves them out so what you placed stays in view: See It shows one, with its corner.' },
        this.rowsOf(st, fc).concat(this.rowsOf(st, oft))));
      // THE SLIDES' OWN SETTINGS (2026-11-02, the owner: "some configuration to the slide pages... I wouldn't mind the
      // clock being bigger"): the corner over every slide, and what Music Full Screen shows
      var hideOf = function (key) { return Array.isArray(o[key]) ? o[key] : []; };
      var part = function (key, k, label, sub) {
        return K.toggle({ label: label, sub: sub || null, on: hideOf(key).indexOf(k) < 0, onChange: function (on) {
          self.change(function (x) { var h = (Array.isArray(x[key]) ? x[key] : []).filter(function (y) { return y !== k; }); if (!on) h.push(k); x[key] = h; });
        } });
      };
      if (any) {
        var ch = hideOf('corner_hide');
        out.push(K.group({ header: 'The Slide Corner', footer: 'Over every slide, the corner adds what the slide doesn’t show itself. Its time is in the Look’s face and color.' }, [
          K.slider({ label: 'Time Size', value: Number(o.corner_time_size) || 100, min: 100, max: 250, step: 10, unit: '%', onChange: function (v) { self.change(function (x) { x.corner_time_size = v; }); } }),
          part('corner_hide', 'time', 'Time'), part('corner_hide', 'date', 'Date'), part('corner_hide', 'weather', 'Weather'), part('corner_hide', 'status', 'House Status')
        ].filter(function (r, i) { return i !== 0 || ch.indexOf('time') < 0; })));
      }
      if (o.music_first || o.music_slide) {
        out.push(K.group({ header: 'Music Full Screen', footer: 'What the music slide shows beside the album art. The side pane’s music is its own.' }, [
          part('music_hide', 'room', 'Room', 'Where it plays'), part('music_hide', 'album', 'Album'), part('music_hide', 'progress', 'Progress', 'How far in, and how long'),
          part('music_hide', 'buttons', 'Buttons', 'Previous, play or pause, next, speakers and browse'), part('music_hide', 'volume', 'Volume'), part('music_hide', 'next', 'Up Next')
        ]));
      }
      return out;
    }

    // ---- TIMING
    timingGroups() {
      var K = this.K, more = this.o.house ? '#/house/screensaver' : '#/screens/' + encodeURIComponent(this.o.path) + '/screensaver';
      return [K.group({ footer: 'Starts After, Back to Home, Night Mode and This Tablet are on the Screensaver page, with your albums and how the photos show.' }, [
        K.nav({ label: 'Starts After, Night Mode and More', sub: 'On the Screensaver page', href: more, sk: 'saver:timing' })])];
    }

    // ------------------------------------------------------------ a piece's page
    piecePage(z, i) {
      var K = this.K, self = this, h = this.h, add = (n) => this.sidebar.appendChild(n), w = this.T().zones[z][i];
      if (!w) { this.sel = null; return this.screenPage(); }
      var P = LM.PIECES[w.piece], d = WG && WG.PIECES[w.piece] || {}, live = this.live || {}, key = z + ':' + i;
      var edit = function (fn) { self.change(function (x) { fn(self.T(x).zones[z][i], x); }); };
      add(this.head('mdi:view-grid', P[2], (d.group ? (GROUP_ALIAS[d.group] || d.group) + ' · ' : '') + LM.SHAPE_NAMES[w.shape] + ' · ' + this.zoneName(z)));
      var claim = live.claims && live.claims[key];
      if (claim) add(K.group({ footer: 'Shown by ' + claim + ', so this piece is not drawn twice.' }, []));
      if (lacks(this.opts, this.T()).indexOf(z) >= 0) add(K.group({ footer: 'Waits: this Look has no ' + (z === 'row' ? 'row' : 'line') + '. The piece stays here until a Look that has one.' }, []));
      // SHAPE: each drawn; a shape this piece's place can't take moves it to the nearest place that can
      var tiles = h('div', { class: 'shtiles', role: 'radiogroup', 'aria-label': 'Shape' }, P[0].map(function (sh) {
        var sw = h('span', { class: 'swatch' }), el = self.sampleEl(w.piece, sh, { u: { inline: 3.6, circular: 3.4, rectangular: 2.4, card: 2.1, band: 1.1 }[sh], back: sh === 'card' && w.back === 'none' ? 'glass' : w.back, color: w.color, opts: w.opts });
        if (el) { if (sh === 'band') el.style.width = '100%'; sw.appendChild(el); }
        sw.setAttribute('data-acc', '');
        return h('button', { type: 'button', class: 'shtile' + (sh === 'band' ? ' wide' : ''), role: 'radio', 'aria-checked': String(sh === w.shape),
          'data-shape': sh, onclick: function () { if (sh !== w.shape) self.reshape(z, i, sh); } }, [sw, h('b', { text: LM.SHAPE_NAMES[sh] })]);
      }));
      add(K.group({ header: 'Shape', footer: 'The same piece, drawn each way. A shape this place can’t take moves it to the nearest place that can.' }, [tiles]));
      // SIZE, BACKDROP, COLOR
      var rs = this.rowSize(), own = w.size != null, sizeRows = [
        { applies: function () { return z === 'row'; }, make: function () {
          return K.toggle({ label: 'Its Own Size', sub: own ? null : 'Off: the row’s size, ' + rs + '%', on: own,
            onChange: function (on) { edit(function (it) { if (on) it.size = rs; else delete it.size; }); } });
        } },
        { applies: function () { return z !== 'row' || own; }, make: function () {
          return K.slider({ label: 'Size', sub: z === 'row' ? 'This piece alone; the row reflows' : null, value: w.size || 100, min: LM.ITEM_SIZE[0], max: LM.ITEM_SIZE[1], step: 5, unit: '%',
            onChange: function (v) { edit(function (it) { if (v === 100 && z !== 'row') delete it.size; else it.size = v; }); } });
        } },
        { make: function () {
          return K.seg({ label: 'Backdrop', value: w.back, options: [['none', 'None'], ['glass', 'Glass'], ['tint', 'Tinted']], onChange: function (v) { edit(function (it) { it.back = v; }); } });
        } },
        { make: function () {
          return K.seg({ label: 'Color', sub: 'Auto takes the screen’s ink', value: w.color, options: [['auto', 'Auto'], ['accent', 'Accent']], onChange: function (v) { edit(function (it) { it.color = v; }); } });
        } },
        // ITS WORDS ALIGNED (2026-11-03, the owner: on the right, "aligned to the right to match the edge of the screen"):
        // a card's or a rectangle's lines; Auto follows its side
        { applies: function () { return w.shape === 'card' || w.shape === 'rectangular' || (w.piece === 'date' && w.opts && w.opts.lines === 'two'); }, make: function () {
          var side = z === 'tr' || z === 'br' ? 'right' : 'left';
          return K.seg({ label: 'Align', sub: 'Auto lines its words up with its side of the screen (' + side + ' here)', value: w.align || 'auto', stack: true,
            options: [['auto', 'Auto'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
            onChange: function (v) { edit(function (it) { if (v === 'auto') delete it.align; else it.align = v; }); } });
        } },
        // (a card with a heading -- Home Status' HOME -- without it)
        { applies: function () { return w.shape === 'card' && w.piece === 'status'; }, make: function () {
          return K.toggle({ label: 'Title', sub: 'The card’s heading over its words', on: w.title !== false, onChange: function (on) { edit(function (it) { if (on) delete it.title; else it.title = false; }); } });
        } }
      ];
      add(K.group({ header: 'Size and Style' }, this.rowsOf({}, sizeRows)));
      // ITS OPTIONS: choices, words, an entity
      var opts = Object.keys(P[1]).filter(function (k) {
        if (/^(entity2|city2)$/.test(k)) return w.shape === 'rectangular';
        if (/^(min|max)$/.test(k)) return w.shape === 'circular';
        // (the camera's own words only once Custom is chosen)
        if (w.piece === 'camera' && k === 'name') return !!(w.opts && w.opts.label === 'custom');
        return true;
      });
      if (opts.length) {
        var rowsO = opts.map(function (k) { return self.optionRow(w, k, P[1][k], edit); }).filter(Boolean);
        if (rowsO.length) add(K.group({ header: 'Options' }, rowsO));
      }
      add(this.showGroup(w, key, edit));
      // what it is
      var about = [];
      if (d.when) about.push(K.info({ label: 'Shows', value: d.when.charAt(0).toLowerCase() + d.when.slice(1) }));
      if (d.off) about.push(K.info({ label: 'Off Until Placed', sub: 'Off on every screen until someone places it, since anyone walking by sees a screensaver.' }));
      // (what it reads, where that is words -- not the name of the code that reads it)
      if (d.source && /\s/.test(d.source)) about.push(K.info({ label: 'Reads', value: d.source }));
      if (about.length) add(K.group({ header: 'About' }, about));
      // WHERE
      var zs = this.without(z, i), lack = lacks(this.opts, this.T()), places = ZONE_ORDER.filter(function (zz) {
        return zz === z || (lack.indexOf(zz) < 0 && LM.ZONES[zz][0].indexOf(w.shape) >= 0 && LM.fits(zs, zz, w.piece + '.' + w.shape, self.rowSize()));
      });
      var list = this.T().zones[z], horiz = z === 'row' || z === 'line';
      add(K.group({ header: 'Place' }, [
        places.length > 1 ? K.select({ label: 'Where', value: z, options: places.map(function (zz) { return [zz, self.zoneName(zz)]; }), onChange: function (to) {
          self.change(function (x) { var it = self.T(x).zones[z].splice(i, 1)[0]; self.T(x).zones[to].push(it); self.sel = to + ':' + (self.T(x).zones[to].length - 1); });
        } }) : null,
        list.length > 1 && i > 0 ? K.button({ label: horiz ? 'Move Left' : 'Move Toward the Edge', onClick: function () {
          self.change(function (x) { var l = self.T(x).zones[z], t = l[i - 1]; l[i - 1] = l[i]; l[i] = t; self.sel = z + ':' + (i - 1); }); } }) : null,
        list.length > 1 && i < list.length - 1 ? K.button({ label: horiz ? 'Move Right' : 'Move Away from the Edge', onClick: function () {
          self.change(function (x) { var l = self.T(x).zones[z], t = l[i + 1]; l[i + 1] = l[i]; l[i] = t; self.sel = z + ':' + (i + 1); }); } }) : null,
        z === 'row' ? this.rowAtRow() : null]));
      add(K.group({}, [K.button({ label: 'Remove ' + P[2], destructive: true, onClick: function () { self.remove(z, i); } })]));
    }
    // A SHAPE CHANGE: to the new shape; a place that can't take it (or has no room) gives it to the nearest that can
    reshape(z, i, sh) {
      var w = this.T().zones[z][i], zs = this.without(z, i), id = w.piece + '.' + sh, rs = this.rowSize(), to = z, lack = lacks(this.opts, this.T());
      var takes = function (zz) { return lack.indexOf(zz) < 0 && LM.ZONES[zz][0].indexOf(sh) >= 0 && LM.fits(zs, zz, id, rs); };
      if (!takes(z)) {
        to = (NEAR[z] || []).filter(takes)[0];
        if (!to) { this.say(this.pname(w) + ' has no room as ' + LM.SHAPE_NAMES[sh].toLowerCase() + ' in any place: remove something first.'); return; }
      }
      this.change((o) => {
        var Z = this.T(o).zones, it = Z[z][i];
        it.shape = sh;
        if (sh === 'card' && it.back === 'none') it.back = 'glass';
        if (to !== z) { Z[z].splice(i, 1); Z[to].push(it); this.sel = to + ':' + (Z[to].length - 1); }
        if (to !== 'row' && it.size === 100) delete it.size;
      });
      if (to !== z) this.say(this.pname(w) + ' moved ' + this.zoneName(to).toLowerCase() + ': ' + this.zoneName(z).toLowerCase() + ' doesn’t take ' + LM.SHAPE_NAMES[sh].toLowerCase() + ' pieces.', true);
    }
    // ONE OPTION OF A PIECE: its choices (a segmented control for a few, a menu for many), words, or an entity
    optionRow(w, k, spec, edit) {
      var K = this.K, self = this, label = OPT_LABELS[w.piece + '.' + k] || OPT_LABELS[k] || titleCase(k), sub = OPT_SUBS[k] || null;
      var setOpt = function (v) {
        edit(function (it) {
          it.opts = Object.assign({}, it.opts || {});
          if (v === '' || v == null) delete it.opts[k]; else it.opts[k] = v;
          if (!Object.keys(it.opts).length) delete it.opts;
        });
      };
      var d = WG && WG.PIECES[w.piece], eff = d && WG._ && WG._.optsOf ? WG._.optsOf(d, w.opts) : {}, cur = w.opts && w.opts[k] != null ? w.opts[k] : eff[k];
      if (Array.isArray(spec)) {
        if (cur == null || spec.indexOf(cur) < 0) cur = spec[0];
        var options = spec.map(function (c) { return [c, choiceName(k, c)]; });
        return spec.length <= 5 ? K.seg({ label: label, sub: sub, value: cur, options: options, stack: spec.length > 3, onChange: setOpt })
                                : K.select({ label: label, sub: sub, value: cur, options: options, onChange: setOpt });
      }
      if (spec === 'text') return K.text({ label: label, sub: sub, value: w.opts && w.opts[k] || '', placeholder: k === 'name' ? 'Its own name' : '', maxlength: 40,
        onCommit: function (v) { setOpt(v.trim().slice(0, 40)); } });
      if (typeof spec === 'string' && spec.indexOf('entity:') === 0) {
        var domains = spec.slice(7).split(','), suggest = WG && WG._ && WG._.picked && WG._.picked.suggest && WG._.picked.suggest[w.piece];
        return this.entityRow({ label: label, sub: sub, value: w.opts && w.opts[k] || '', domains: domains, none: 'Choose…',
          suggest: suggest ? function () { try { return suggest(self.states(), k) || ''; } catch (e) { return ''; } } : null, onPick: setOpt });
      }
      return null;
    }
    // AN ENTITY ROW: the entity's name (or the suggested default, named), and a page that picks one
    entityRow(o) {
      var K = this.K, self = this, h = this.h, sug = o.suggest ? o.suggest() : '', cur = o.value;
      var val = cur ? (this.states()[cur] ? this.nameOf(cur) : cur + ' (missing)') : sug ? 'Suggested: ' + this.nameOf(sug) : (o.none || 'None');
      var a = h('button', { type: 'button', class: 'cell', 'data-fk': 'entity:' + o.label, onclick: function () {
        self.picker = { title: o.label, domains: o.domains, value: cur, none: o.none, suggest: sug, q: '', onPick: o.onPick, any: !o.domains };
        self.side();
      } }, [K.label(o.label, o.sub), h('span', { class: 'val', text: val }), K.svg(K.CHEV)]);
      return a;
    }
    // THE ENTITY PICKER, a page of the sidebar: a search, the suggestion, and the entities of those domains by name
    pickerPage() {
      var K = this.K, self = this, h = this.h, pk = this.picker, add = (n) => this.sidebar.appendChild(n);
      add(h('div', { class: 'insp-head' }, [h('div', {}, [h('h2', { text: pk.title }), h('p', { text: !pk.domains ? 'Any entity this screen may read' : pk.domains.length > 3 ? 'Any of these kinds of entity' : 'Choose a ' + listAnd(pk.domains.map(function (d) { return d.replace(/_/g, ' '); })).replace(/^a ([aeiou])/, 'an $1') })]),
        h('button', { class: 'done', type: 'button', text: 'Back', onclick: function () { self.picker = null; self.side(); } })]));
      var inp = h('input', { type: 'search', class: 'srch', placeholder: 'Search', 'aria-label': 'Search ' + pk.title });
      inp.value = pk.q;
      var box = h('div', { class: 'pk-list' });
      add(inp); add(box);
      var choose = function (v) { var f = pk.onPick; self.picker = null; self.say(''); if (f) f(v); self.side(); };
      var paint = function () {
        var st = self.states(), words = pk.q.trim().toLowerCase().split(/\s+/).filter(Boolean), rows = [], top = [];
        if (pk.suggest && !words.length) top.push(K.check({ label: 'Use the Suggestion', sub: self.nameOf(pk.suggest) + ' · ' + pk.suggest, on: !pk.value, onClick: function () { choose(''); } }));
        else if (pk.none && !words.length && !pk.any) top.push(K.check({ label: 'None', on: !pk.value, onClick: function () { choose(''); } }));
        var ids = Object.keys(st).filter(function (id) { return !pk.domains || pk.domains.indexOf(id.split('.')[0]) >= 0; });
        var all = ids.map(function (id) { return { id: id, name: self.nameOf(id) }; }).filter(function (e) {
          var t = (e.name + ' ' + e.id).toLowerCase();
          return words.every(function (w) { return t.indexOf(w) >= 0; });
        }).sort(function (a, b) { return a.name.localeCompare(b.name); });
        var CAP = 80;
        rows = all.slice(0, CAP).map(function (e) { return K.check({ label: e.name, sub: e.id, on: e.id === pk.value, onClick: function () { choose(e.id); } }); });
        box.replaceChildren();
        if (top.length) box.appendChild(K.group({}, top));
        box.appendChild(K.group({ footer: !all.length ? 'Nothing matches.' : all.length > CAP ? 'Showing ' + CAP + ' of ' + all.length + '. Search to find more.' : null }, rows));
      };
      inp.addEventListener('input', function () { pk.q = inp.value; paint(); });
      paint();
    }
    // SHOW: always, or when one entity is a value (is / is not / is above / is below): "Shows when Mailbox is Mail"
    showGroup(w, key, edit) {
      var K = this.K, self = this, dr = this.showDraft && this.showDraft.key === key ? this.showDraft : null, cur = dr || w.show || null;
      var rows = [K.seg({ label: 'Show', value: cur ? 'when' : 'always', options: [['always', 'Always'], ['when', 'When…']], onChange: function (v) {
        if (v === 'always') { self.showDraft = null; edit(function (it) { delete it.show; }); self.side(); }
        else { self.showDraft = { key: key, entity: '', op: 'is', value: '' }; self.side(); }
      } })];
      var foot = 'Left out until its condition is met: the rest close up around it.';
      if (cur) {
        var numeric = cur.op === 'above' || cur.op === 'below', bad = numeric && cur.value !== '' && !isFinite(parseFloat(cur.value));
        rows.push(this.entityRow({ label: 'Entity', value: cur.entity, domains: null, none: 'Choose…', onPick: function (id) { self.setShow(w, key, edit, { entity: id }); } }));
        rows.push(K.seg({ label: 'Condition', value: cur.op, options: OPS, onChange: function (v) { self.setShow(w, key, edit, { op: v }); } }));
        rows.push(K.text({ label: 'Value', value: cur.value == null ? '' : String(cur.value), placeholder: numeric ? 'A number' : 'on, Mail, 72…', maxlength: 64,
          error: bad ? 'Enter a number to compare with.' : null, onCommit: function (v) { self.setShow(w, key, edit, { value: v.trim() }); } }));
        var st = cur.entity && this.states()[cur.entity];
        foot = w.show && !dr ? this.showWords(w.show) + '.' + (st ? ' Now it is ' + st.state + '.' : '') : 'Pick an entity and a value to finish.' + (st ? ' Now it is ' + st.state + '.' : '');
      }
      return K.group({ header: 'Show', footer: foot }, rows);
    }
    setShow(w, key, edit, patch) {
      var base = this.showDraft && this.showDraft.key === key ? this.showDraft : Object.assign({ key: key }, w.show || { entity: '', op: 'is', value: '' });
      var d = Object.assign({}, base, patch, { key: key });
      var numeric = d.op === 'above' || d.op === 'below', n = parseFloat(d.value);
      var ok = /^[a-z_]+\.[a-z0-9_]+$/.test(d.entity) && d.value !== '' && String(d.value).length <= 64 && (!numeric || isFinite(n));
      if (ok) {
        this.showDraft = null;
        edit(function (it) { it.show = { entity: d.entity, op: d.op, value: numeric ? n : String(d.value) }; });
      } else { this.showDraft = d; }
      this.side();
    }

    // ------------------------------------------------------------ a place's page (tap a place with nothing picked)
    zonePage(z) {
      var K = this.K, self = this, h = this.h, add = (n) => this.sidebar.appendChild(n), zs = this.T().zones;
      add(this.head('mdi:plus', this.zoneName(z), 'Takes ' + this.takes(z)));
      if (z === 'row') add(K.group({ header: 'The Row', footer: 'Two lines of four: a circular piece is one, a rectangular two, as on the iPhone. A fifth starts the second line.' }, [this.rowAtRow()]));
      var by = {}, order = GROUPS.slice();
      Object.keys(LM.PIECES).forEach(function (p) {
        if (!self.shapeFor(p, z, zs)) return;
        var d = WG && WG.PIECES[p], g = GROUP_ALIAS[d && d.group] || (d && d.group) || 'Home';
        if (order.indexOf(g) < 0) order.push(g);
        (by[g] = by[g] || []).push(p);
      });
      var any = false;
      order.forEach(function (g) {
        if (!by[g]) return;
        any = true;
        add(K.group({ header: g },
          by[g].map(function (p) { return K.button({ label: LM.PIECES[p][2], onClick: function () { self.pick = p; self.tapZone(z); } }); })));
      });
      if (!any) add(h('p', { class: 'note', text: 'This place is full. Remove something from it first.' }));
    }
  }
  window.hkSaverEditor = { BGS: BGS, LOOKS: LOOKS, bgOf: bgOf, lookOf: lookOf, applyLook: applyLook, lookLayout: lookLayout, tidy: tidy, lacks: lacks, GROUPS: GROUPS };
  customElements.define('hk-saver-editor', SaverEditor);
})();
