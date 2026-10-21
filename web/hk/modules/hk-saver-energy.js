// hk-saver-energy.js -- THE SCREENSAVER'S HOME ENERGY (2026-10-14): today so
// far against a usual day -- the Energy page's own rings and sums
// (hk-energy.js window.hkEnergy.summary) -- with what the house draws now, the
// house battery, yesterday by now, and the month so far with where its cost
// is heading. A slide among the photos, or one of the Additional Screens over
// the forecast or the clock (hk-saver.js; settings.py energy_slide,
// energy_hide). Designed in hk_house/docs/mockups/saver-additional-screens.html.
//
// Loaded by hk-saver.js only when a screen shows Home Energy -- never on its own.
//
// WHAT IT COSTS A WALL TABLET, by design:
//   - nothing moves while it is up: the rings and their leader lines draw
//     once as it arrives (DUR.ring, EASE.build), and then sit still
//   - its numbers are the page's statistics (hk-stats batching and cache),
//     house meters and measured top-level circuits, and redrawn at most
//     every REDRAW_MS while it shows
//   - behind it: the photo's blurred copy (the saver's own 96 px canvas),
//     a dark wash over the stilled sky, or a gradient -- no backdrop-filter
//
//   hkSaverEnergy.create({ hide, h24 }) -> ctl
//     ctl.el                  the layer (hk-saver.js puts it in its root)
//     ctl.ready(client)       a summary to show (asking for one if not)
//     ctl.draw(client, look)  fill it in now; look: 'photo' | 'sky' | 'plain'
//     ctl.arrived()           the fade is done: the rings and lines draw
//     ctl.layout(W, H)        the room it has (beside any pane)
//     ctl.setClient(client)   fresh states, while it shows
//     ctl.leave() / destroy()
(function () {
  'use strict';
  if (window.hkSaverEnergy) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  // the layout's own design size: a 1280 x 800 wall tablet (hk-saver.js
  // BAND_W / BAND_H), scaled to the room it has
  var W0 = 1280, H0 = 800;
  var REDRAW_MS = 5000;
  // the photo's blurred copy: this wide (hk-saver.js BACKDROP_W)
  var BG_W = 96;
  // the parts Energy Options can leave out (settings.py SAVER_ENERGY_PARTS)
  var RINGS = ['energy', 'cost', 'solar', 'water', 'gas'];

  var CSS = [
    // ONE LAYER FOR GOOD, hidden by its opacity alone (2026-10-19): with
    // visibility:hidden after each fade out, and a layer only while its
    // opacity animated, every turn made the layer and its photo canvas and
    // dropped them again (headless: +4 as it came in, -4 once it had gone),
    // and the corner cards over it lost theirs and took it back mid-turn --
    // each a re-raster of what sits above on a wall tablet's WebView: the
    // flicker in and out. As the photo layers (hk-saver.js .ph).
    '.en{position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;overflow:hidden;will-change:opacity;',
    '  font-family:' + FONT + ';color:rgba(255,255,255,.94);text-shadow:0 1px 10px rgba(0,0,0,.28);',
    '  transition:opacity var(--hk-en-fade,3000ms) ease;--z:1}',
    '.en.on{opacity:1}',
    // BEHIND IT: the photo's blurred copy, the sky darkened, or its own gradient
    // (the photo's copy is there, unseen, whatever the look: shown and let go
    // of with the look, its layer was made at the first turn -- 2026-10-19)
    '.en .enbg{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0}',
    '.en[look=photo] .enbg{opacity:1;filter:brightness(.5) saturate(1.15)}',
    '.en .enwash{position:absolute;inset:0}',
    '.en[look=photo] .enwash{background:linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.28))}',
    '.en[look=sky] .enwash{background:linear-gradient(180deg,rgba(6,10,18,.62),rgba(6,10,18,.8))}',
    '.en[look=plain] .enwash{background:radial-gradient(ellipse at 20% 110%,#5a3d1d 0,transparent 55%),',
    '  radial-gradient(ellipse at 85% -10%,#1d3f5c 0,transparent 55%),linear-gradient(150deg,#0e1420,#121a26 50%,#0b0f17)}',
    // ITS OWN TIME, DATE AND WEATHER, top left (the user, 2026-10-14: the
    // screensaver's big corner clock left the rings no room; hk-saver.js
    // fades those corner cards while this shows -- Home Status stays)
    '.en .encorner{position:absolute;left:calc(44px * var(--z));top:calc(34px * var(--z))}',
    // (proportional digits: a tabular 1 sits inside a wide cell, off the left edge)
    '.en .ent{font-size:calc(64px * var(--z));font-weight:600;letter-spacing:-2px;line-height:1}',
    '.en .ent small{font-size:calc(24px * var(--z));font-weight:600;letter-spacing:0;margin-left:calc(4px * var(--z));opacity:.85}',
    '.en .end{font-size:calc(20px * var(--z));font-weight:500;margin-top:calc(6px * var(--z));opacity:.85}',
    '.en .enw{font-size:calc(20px * var(--z));font-weight:600;margin-top:calc(4px * var(--z));opacity:.9;display:flex;align-items:center;gap:.4em}',
    '.en .enw svg,.en .enw img{flex:none}',
    '.en .enw:empty{display:none}',
    // THE RINGS AND THE READINGS, side by side (one above the other when tall)
    '.en .enbody{position:absolute;left:var(--left,0px);right:0;top:var(--top,130px);bottom:var(--bot,190px);display:flex;',
    '  align-items:center;justify-content:center;gap:calc(64px * var(--z))}',
    '.en .enrw{position:relative;flex:none}',
    '.en svg.rings{display:block;width:calc(380px * var(--z));height:calc(380px * var(--z))}',
    '.en svg.rings .tick{fill:#fff;filter:drop-shadow(0 0 3px rgba(0,0,0,.6))}',
    '.en .ennote{position:absolute;left:-40px;right:-40px;top:100%;margin-top:calc(10px * var(--z));text-align:center;',
    '  font-size:calc(14px * var(--z));font-weight:500;opacity:.55}',
    '.en .enread{width:calc(560px * var(--z));flex:none}',
    '.en .eneye{font-size:calc(15px * var(--z));font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.7}',
    '.en .enh{font-size:calc(52px * var(--z));font-weight:700;letter-spacing:-1.2px;line-height:1.05;margin:calc(6px * var(--z)) 0 calc(4px * var(--z))}',
    '.en .enlede{font-size:calc(21px * var(--z));font-weight:500;line-height:1.35;opacity:.88;margin-bottom:calc(26px * var(--z))}',
    '.en .encompare{display:block;color:#ffb340;font-weight:600}',
    '.en .encompare[data-trend=down]{color:#75dda0}',
    '.en .encompare[data-trend=same]{color:inherit}',
    '.en .encause{display:block;font-size:.82em;margin-top:5px;opacity:.8}',
    '.en .enfresh{position:absolute;top:100%;left:0;margin-top:calc(5px * var(--z));font-size:calc(12px * var(--z));opacity:.62;white-space:nowrap}',
    '.en .enlede em{font-style:normal;font-weight:600;color:#ff9f0a}',
    // Each reading has its own tracks: values stay right-aligned, while
    // leaders use the space between each label and its actual value.
    '.en .enstats{display:grid;grid-template-columns:1fr;row-gap:calc(20px * var(--z));column-gap:calc(12px * var(--z))}',
    '.en .st{display:grid;grid-column:1/-1;grid-template-columns:calc(12px * var(--z)) auto minmax(24px,1fr) auto;column-gap:calc(12px * var(--z));align-items:center}',
    '.en .st i{width:calc(12px * var(--z));height:calc(12px * var(--z));border-radius:50%}',
    '.en .st .k{font-size:calc(15px * var(--z));font-weight:600;letter-spacing:.4px;text-transform:uppercase;opacity:.75}',
    // (drawn out by its background's width, painted, not by a transform:
    // the compositor's scaleX made the line a layer only while it drew,
    // and the readings beside it with it -- made and dropped at every
    // turn, 2026-10-19)
    '.en .st .ln{grid-column:3;height:2px;border-radius:1px;margin:0 calc(8px * var(--z));min-width:24px;background-repeat:no-repeat}',
    '.en .st .v{grid-column:4;grid-row:1;font-size:calc(40px * var(--z));font-weight:700;letter-spacing:-1px;line-height:1;',
    '  font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.en .st .v u,.en .enfoot .v u{text-decoration:none;font-weight:600;opacity:.75;letter-spacing:0}',
    '.en .st .v u{font-size:calc(20px * var(--z));margin-left:calc(6px * var(--z))}',
    '.en .st .of{grid-column:1/-1;grid-row:2;text-align:right;font-size:calc(15px * var(--z));opacity:.65;margin-top:calc(5px * var(--z));white-space:nowrap}',
    '.en .st i,.en .st .k,.en .st .ln{grid-row:1}',
    // ALONG THE BOTTOM: Right Now, and the month so far
    '.en .enfoot{position:absolute;left:calc(44px * var(--z));right:calc(44px * var(--z));bottom:calc(26px * var(--z));display:flex;',
    '  justify-content:space-between;gap:calc(40px * var(--z));align-items:flex-start;',
    '  border-top:1px solid rgba(255,255,255,.14);padding-top:calc(16px * var(--z))}',
    '.en .enfoot:empty{display:none}',
    '.en .fg .gh{font-size:calc(13px * var(--z));font-weight:700;letter-spacing:.5px;text-transform:uppercase;opacity:.9;margin-bottom:calc(10px * var(--z))}',
    '.en .fg .its{display:flex;gap:calc(40px * var(--z));align-items:flex-start}',
    '.en .fg.mo{margin-left:auto;padding-left:calc(40px * var(--z));border-left:1px solid rgba(255,255,255,.14)}',
    '.en .fg.mo:first-child{margin-left:0;padding-left:0;border-left:0}',
    '.en .enfoot .k{font-size:calc(13px * var(--z));font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.65;white-space:nowrap}',
    '.en .enfoot .k b{display:inline-block;width:calc(8px * var(--z));height:calc(8px * var(--z));border-radius:50%;margin-right:calc(6px * var(--z));vertical-align:1px}',
    '.en .enfoot .v{font-size:calc(30px * var(--z));font-weight:700;letter-spacing:-.6px;margin-top:calc(4px * var(--z));font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.en .enfoot .v u{font-size:calc(17px * var(--z));margin-left:calc(4px * var(--z))}',
    '.en .enfoot .pace{font-size:calc(15px * var(--z));font-weight:500;opacity:.7;margin-left:calc(10px * var(--z));letter-spacing:0}',
    '.en .batt{display:inline-block;width:calc(34px * var(--z));height:calc(16px * var(--z));border:2px solid rgba(255,255,255,.75);',
    '  border-radius:5px;position:relative;margin-right:calc(8px * var(--z));vertical-align:2px;box-sizing:border-box}',
    '.en .batt::after{content:"";position:absolute;right:-5px;top:25%;width:3px;height:50%;background:rgba(255,255,255,.75);border-radius:0 2px 2px 0}',
    '.en .batt b{position:absolute;left:2px;top:2px;bottom:2px;border-radius:2px}',
    // NARROW LANDSCAPE: the 880 x 800 area beside a tablet's pane. Keep
    // the full six-reading footer, in two aligned rows, and fit by height too.
    '.en[narrow] .enbody{flex-direction:column;gap:calc(10px * var(--z))}',
    '.en[narrow] svg.rings{width:calc(250px * var(--z));height:calc(250px * var(--z))}',
    '.en[narrow] .ennote{display:none}',
    '.en[narrow] .enread{width:calc(624px * var(--z))}',
    '.en[narrow] .eneye,.en[narrow] .enh,.en[narrow] .enlede{text-align:center}',
    '.en[narrow] .eneye{font-size:calc(12px * var(--z));letter-spacing:1px}',
    '.en[narrow] .enh{font-size:calc(30px * var(--z));letter-spacing:-.8px}',
    '.en[narrow] .enlede{font-size:calc(17px * var(--z));margin-bottom:calc(10px * var(--z))}',
    '.en[narrow] .enstats{row-gap:calc(4px * var(--z))}',
    '.en[narrow] .st .k{font-size:calc(14px * var(--z))}',
    '.en[narrow] .st .v{font-size:calc(30px * var(--z))}',
    '.en[narrow] .st .v u{font-size:calc(18px * var(--z))}',
    '.en[narrow] .st .of{font-size:calc(12px * var(--z));white-space:normal;margin-top:calc(3px * var(--z))}',
    '.en[narrow] .enfoot{flex-direction:column;gap:calc(12px * var(--z));padding-top:calc(13px * var(--z))}',
    '.en[narrow] .fg{display:grid;width:100%;grid-template-columns:calc(120px * var(--z)) minmax(0,1fr);gap:calc(16px * var(--z));align-items:center}',
    '.en[narrow] .fg .gh{margin:0;line-height:1.5;font-size:calc(12px * var(--z))}',
    '.en[narrow] .fg .its{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:calc(12px * var(--z))}',
    '.en[narrow] .fg.mo{margin:0;padding:calc(12px * var(--z)) 0 0;border-left:0;border-top:1px solid rgba(255,255,255,.14)}',
    '.en[narrow] .fg.mo:first-child{padding-top:0;border-top:0}',
    '.en[narrow] .enfoot .k{font-size:calc(11px * var(--z));white-space:normal}',
    '.en[narrow] .enfoot .v{font-size:calc(26px * var(--z))}',
    '.en[narrow] .enfoot .pace{display:block;margin:calc(2px * var(--z)) 0 0;font-size:calc(12px * var(--z));white-space:normal}',
    // TALL (a portrait screen, the phone preview): the rings above the readings
    '.en[tall] .enbody{flex-direction:column;gap:calc(48px * var(--z))}',
    '.en[tall] .ennote{display:none}',
    '.en[tall] .enfoot{flex-direction:column;gap:calc(18px * var(--z))}',
    '.en[tall] .fg.mo{margin-left:0;padding-left:0;border-left:0}',
    '.en[tall] .fg .its{flex-wrap:wrap;row-gap:calc(14px * var(--z))}'
  ].join('\n');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function E() { return window.hkEnergy; }
  function reduced() { return !!(((window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches))); }

  // THE PAGE'S CODE (hk-energy.js, a Lovelace resource) loads with the
  // cards: wait for it, never poll
  var energyWait = null;
  function energyReady() {
    if (E() && E().summary) return Promise.resolve(E());
    if (!energyWait) {
      energyWait = new Promise(function (res) {
        window.addEventListener('hk-energy-ready', function () { res(E()); }, { once: true });
      });
    }
    return energyWait;
  }

  // WHAT IT SHOWS, from a summary and what is left out: the rings (Energy
  // always), Right Now's readings, the month's
  function view(s, hide) {
    var off = {};
    (hide || []).forEach(function (k) { off[k] = true; });
    var H = E(), fx = H.fx, kwh = H.kwh;
    var rings = s.rings.filter(function (r) { return r.key === 'energy' || !off[r.key]; });
    var val = function (r, v) {
      return r.key === 'cost' ? s.money(v, 2) : r.key === 'water' || r.key === 'gas' ? fx(v, 0) : kwh(v);
    };
    var stats = rings.map(function (r) {
      var typ = r.key === 'cost' ? s.money(r.typ, 2) : fx(r.typ, r.key === 'water' || r.key === 'gas' ? 0 : (r.typ >= 100 ? 0 : 1)) + (r.unit ? ' ' + r.unit : '');
      return '<div class="st"><i style="background:' + r.c + '"></i><span class="k">' + esc(r.name) + '</span>' +
        '<span class="ln" style="background-image:linear-gradient(90deg,' + r.c + ',' + r.c + '40)"></span>' +
        '<span class="v">' + val(r, r.v) + (r.unit ? '<u>' + esc(r.unit) + '</u>' : '') + '</span>' +
        '<span class="of">' + (r.typ > 0 ? 'of a usual day’s ' + typ : 'Learning your usual') + '</span></div>';
    }).join('');
    // the lede: today so far against a usual day by now
    var e = s.today.energy, us = s.usualByNow, lede = 'Used <em>' + kwh(e) + ' kWh</em> since midnight.';
    if (us > 0.05) {
      var pct = Math.round(100 * (e - us) / us);
      lede = '<span class="encompare" data-trend="' + (Math.abs(pct) < 5 ? 'same' : pct > 0 ? 'up' : 'down') + '">' +
        (Math.abs(pct) < 5 ? '→ About the same as usual by this time' : (pct > 0 ? '↗ ' : '↘ ') + Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below') + ' usual by this time') + '</span>';
      if (pct >= 5 && s.contributor) lede += '<span class="encause">Mostly from ' + esc(s.contributor.name) + ' today.</span>';
    }
    var now = [];
    if (!off.power && s.power != null) {
      var w = H.watts(s.power);
      now.push('<div><div class="k">Power Now</div><div class="v">' + w[0] + '<u>' + w[1] + '</u></div></div>');
    }
    if (!off.battery && s.battery != null) {
      var b = Math.max(0, Math.min(100, s.battery));
      now.push('<div><div class="k">House Battery</div><div class="v"><span class="batt"><b style="width:calc(' + b + '% - 4px);background:' +
        (b <= 20 ? '#ff453a' : '#30d158') + '"></b></span>' + fx(b, 0) + '<u>%</u></div></div>');
    }
    if (!off.yday && s.yday != null) now.push('<div><div class="k">Yesterday by Now</div><div class="v">' + kwh(s.yday) + '<u>kWh</u></div></div>');
    var mo = '';
    if (!off.month) {
      mo = rings.map(function (r) {
        var v = s.month[r.key], txt = r.key === 'cost' ? s.money(v, 0) : fx(v, 0);
        var pace = r.key === 'cost' && !off.pace && s.projCost != null ? '<span class="pace">heading for ' + s.money(s.projCost, 0) + '</span>' : '';
        return '<div><div class="k"><b style="background:' + r.c + '"></b>' + esc(r.name) + '</div><div class="v">' + txt +
          (r.unit ? '<u>' + esc(r.unit) + '</u>' : '') + pace + '</div></div>';
      }).join('');
    }
    var foot = (now.length ? '<div class="fg"><div class="gh">Right Now</div><div class="its">' + now.join('') + '</div></div>' : '') +
      (mo ? '<div class="fg mo"><div class="gh">' + esc(s.monthName) + ' So Far</div><div class="its">' + mo + '</div></div>' : '');
    return { rings: rings, stats: stats, lede: lede, foot: foot };
  }

  // THE SCALE THAT FITS (for layout): laid out, measured, and scaled down
  // until the rings and readings fit between `top` and the row along the
  // bottom, `left` to the right edge; returns the scale it came to
  function fitIn(el, w, h, tall, left, top, minTop) {
    var narrow = el.hasAttribute('narrow');
    var z = narrow ? Math.min(w / 880, h / H0) : tall ? Math.min(w / 800, h / 1280) : Math.min(w / W0, h / H0);
    z = Math.max(0.42, Math.min(z, 2.5));
    var rw = el.querySelector('.enrw'), rd = el.querySelector('.enread'), ft = el.querySelector('.enfoot');
    for (var i = 0; i < 3; i++) {
      var t = Math.round(Math.max(top, minTop * z));
      el.style.setProperty('--z', z.toFixed(3));
      el.style.setProperty('--top', t + 'px');
      el.style.setProperty('--left', Math.round(left) + 'px');
      var fh = ft && ft.childNodes.length ? ft.getBoundingClientRect().height : 0;
      var bot = Math.round(fh + (26 + 24) * z);
      el.style.setProperty('--bot', bot + 'px');
      var a = rw.getBoundingClientRect(), b = rd.getBoundingClientRect(), note = 34 * z;
      var need = narrow ? a.height + b.height + 10 * z : tall ? a.height + b.height + 48 * z : Math.max(a.height + note, b.height);
      // and across: the rings and the readings side by side, with their gap
      var needW = tall || narrow ? Math.max(a.width, b.width) : a.width + b.width + 64 * z;
      var k = Math.min((h - t - bot) / Math.max(1, need), (w - left - 60 * z) / Math.max(1, needW));
      if (!a.height || k >= 0.995) break;
      z = Math.max(0.42, z * k * 0.98);
    }
    return { z: z };
  }
  // THE WEATHER LINE: the screen's weather (Weather) as the corner card has
  // it -- its multicolor glyph (hk-header.js wxSvg), the temperature, the
  // conditions -- "<glyph> 85° Sunny"
  var COND = { 'clear-night': 'Clear', partlycloudy: 'Partly Cloudy', sunny: 'Sunny' };
  function weatherLine(client) {
    var HS = window.hkSettings, HD = window.hkHeader, st = client && client.states;
    var id = st && HS && HS.weatherId ? HS.weatherId(st) : null, w = id && st[id];
    if (!w) return '';
    var t = Number(w.attributes && w.attributes.temperature), night = HD && HD.isNight ? HD.isNight(st) : false;
    var name = HD && HD.conditionName ? HD.conditionName(w.state) : (COND[w.state] || w.state);
    return (HD && HD.wxSvg ? HD.wxSvg(w.state, '1.3em', { night: night }) : '') +
      '<span>' + (isFinite(t) ? Math.round(t) + '° ' : '') + esc(name) + '</span>';
  }
  // HOW FAR A LINE'S FIRST LETTER'S INK STARTS INSIDE ITS BOX (a big "1"
  // sits well in from its left edge): measured in its own font, so the time,
  // the date and the weather share one left edge
  var inkCanvas = null;
  function inkLeft(node) {
    var txt = (node.textContent || '').trim();
    if (!txt) return 0;
    try {
      inkCanvas = inkCanvas || document.createElement('canvas');
      var ctx = inkCanvas.getContext('2d'), cs = getComputedStyle(node);
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      var m = ctx.measureText(txt.charAt(0));
      return typeof m.actualBoundingBoxLeft === 'number' ? m.actualBoundingBoxLeft : 0;
    } catch (e) { return 0; }
  }
  function create(opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'en';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<style>' + CSS + '</style><canvas class="enbg"></canvas><div class="enwash"></div>' +
      '<div class="encorner"><div class="ent"></div><div class="end"></div><div class="enw"></div><div class="enfresh"></div></div>' +
      '<div class="enbody"><div class="enrw"><div class="enrs"></div><div class="ennote">The white dots: a usual day by now</div></div>' +
      '<div class="enread"><div class="eneye">Home Energy</div><div class="enh">Today So Far</div><div class="enlede"></div>' +
      '<div class="enstats"></div></div></div><div class="enfoot"></div>';
    // THE PHOTO'S COPY ON ITS LAYER FROM THE START (2026-10-19): a canvas is
    // a layer of its own once drawn into, and a new one at a new size -- so
    // drawn into now, at the size the saver paints it (hk-saver.js
    // drawBackdrop: BG_W wide, the screen's shape), not as the screen first
    // comes in
    try {
      var bg = el.querySelector('.enbg'), t = document.createElement('canvas');
      bg.width = BG_W; bg.height = Math.max(1, Math.round(BG_W * (window.innerHeight || 800) / Math.max(1, window.innerWidth || 1280)));
      t.width = t.height = 1;
      bg.getContext('2d').drawImage(t, 0, 0);
    } catch (e) { /* a canvas without a context */ }
    var layoutW = 0, layoutH = 0;
    var alive = true, showing = false, client = null, last = null, sig = '', drawnAt = 0, redrawT = null, was = null, clockT = null;
    var h24 = !!opts.h24;
    function tick() {
      var now = new Date(), tz = window.hkStats && window.hkStats.tz ? window.hkStats.tz() : undefined;
      var t = now.toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit', hour12: !h24, timeZone: tz })).split(' ');
      var d = now.toLocaleDateString(window.hkLocale.tag(), window.hkLocale.zoned({ weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }));
      var tEl = el.querySelector('.ent'), dEl = el.querySelector('.end'), wEl = el.querySelector('.enw');
      var th = esc(t[0]) + (t[1] ? '<small>' + esc(t[1]) + '</small>' : '');
      if (tEl.innerHTML !== th) tEl.innerHTML = th;
      if (dEl.textContent !== d) dEl.textContent = d;
      var w = weatherLine(client);
      if (wEl.__hkW !== w) { wEl.__hkW = w; wEl.innerHTML = w; }
      freshness();
      align();
    }
    function freshness() {
      var at = last && last.receivedAt, now = Date.now(), cutoff = last && last.asOf;
      var stale = at && now - at > 20 * 6e4 || cutoff && now - cutoff > (last.hasFives ? 20 : 75) * 6e4;
      var stamp = stale && Math.min(at || Infinity, cutoff || Infinity);
      el.querySelector('.enfresh').textContent = stamp ? '◷ Energy · updated ' + Math.max(1, Math.floor((now - stamp) / 6e4)) + ' min ago' : '';
    }
    // the time's and the date's first ink on one line (inkLeft); the
    // weather's glyph starts at its own edge
    function align() {
      [el.querySelector('.ent'), el.querySelector('.end')].forEach(function (n) {
        if (!n) return;
        var k = inkLeft(n);
        n.style.marginLeft = (Math.round(k * 10) / 10) + 'px';
      });
    }
    var hide = Array.isArray(opts.hide) ? opts.hide.slice() : [];
    // the statistics' and the settings' wake-up (hk-stats notify, the
    // Energy page's prefs): a card-shaped object
    var waker = {
      get isConnected() { return alive; },
      requestUpdate: function () { soon(); },
      redraw: function () { soon(); }
    };
    function summary() {
      var H = E();
      if (!H || !H.summary || !client) return null;
      try { return H.summary(client, waker) || null; } catch (e) { console.warn('[hk-saver-energy]', e && e.message); return null; }
    }
    function soon() {
      if (!alive || !showing || redrawT) return;
      var wait = Math.max(0, REDRAW_MS - (Date.now() - drawnAt));
      redrawT = setTimeout(function () { redrawT = null; if (alive && showing) paint(false); }, wait);
    }
    // FILL IT IN: the numbers in place; the rings from where they were
    function paint(fresh) {
      var s = summary();
      if (!s) return false;
      last = s;
      freshness();
      drawnAt = Date.now();
      var v = view(s, hide), H = E();
      var list = v.rings.map(function (r) { return { key: r.key, c: r.c, f: r.typ > 0 ? r.v / r.typ : 0, tick: r.typ > 0 ? r.tick : null }; });
      var key = JSON.stringify([v.stats, v.lede, v.foot, list]);
      if (key === sig && !fresh) return true;
      sig = key;
      var box = el.querySelector('.enrs');
      box.innerHTML = H.ringSvg(list, null, 0);
      el.querySelector('.enlede').innerHTML = v.lede;
      el.querySelector('.enstats').innerHTML = v.stats;
      el.querySelector('.enfoot').innerHTML = v.foot;
      if (layoutW && layoutH) layout(layoutW, layoutH);
      if (fresh) {
        // drawn finished, then put back to nothing until it has arrived
        was = H.sweepRings(box, null, false);
        hold(true);
      } else was = H.sweepRings(box, was, false);
      return true;
    }
    // BEFORE IT HAS ARRIVED: the arcs and lines at nothing, so they draw as
    // it lands (Reduce Motion: finished)
    function hold(on) {
      if (reduced()) return;
      el.querySelectorAll('circle.arc').forEach(function (a) {
        if (on) a.style.strokeDasharray = '0 ' + a.getAttribute('data-c'); else a.style.removeProperty('stroke-dasharray');
      });
      el.querySelectorAll('.st .ln').forEach(function (l) { if (on) l.style.backgroundSize = '0% 100%'; else l.style.removeProperty('background-size'); });
    }
    function layout(w, h) {
      if (!w || !h) return;
      layoutW = w; layoutH = h;
      var tall = h > w * 1.05, narrow = !tall && w < 1000;
      if (tall) el.setAttribute('tall', ''); else el.removeAttribute('tall');
      if (narrow) el.setAttribute('narrow', ''); else el.removeAttribute('narrow');
      fit(w, h, tall, 0, 0, narrow ? 102 : tall ? 170 : 150);
      if (showing) align();
    }
    function fit(w, h, tall, left, top, minTop) { return fitIn(el, w, h, tall, left, top, minTop); }
    function arrived() {
      if (!alive || !showing || !last) return;
      hold(false);
      var H = E(), box = el.querySelector('.enrs');
      was = H.sweepRings(box, null, true);
      if (reduced()) return;
      var D = window.hkCards && window.hkCards.DUR, Ez = window.hkCards && window.hkCards.EASE;
      var dur = (D && parseFloat(D.ring) * 1000) || 850, ease = (Ez && Ez.build) || 'cubic-bezier(.22,.8,.25,1)';
      // THE LEADER LINES DRAW WITH THE RINGS (the user, 2026-10-14: "these
      // should be in sync"): held at nothing through the fade (hold), then
      // out from each name toward its number over the rings' own sweep --
      // the same moment, length and curve
      el.querySelectorAll('.st .ln').forEach(function (l) {
        if (l.animate) l.animate([{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: dur, easing: ease, fill: 'backwards' });
      });
      // (its fill, not its opacity: an opacity animation is the compositor's,
      // and gave the rings a layer of their own only while it ran)
      el.querySelectorAll('svg.rings .tick').forEach(function (t) {
        if (t.animate) t.animate([{ fillOpacity: 0 }, { fillOpacity: 0, offset: 0.6 }, { fillOpacity: 1 }], { duration: dur + 300 });
      });
    }
    return {
      el: el,
      ready: function (h) { if (h) client = h; return !!summary(); },
      // look: 'photo' (paintBg draws the photo's blurred copy into the
      // canvas), 'sky' or 'plain'
      draw: function (h, look, paintBg) {
        if (h) client = h;
        tick();
        if (!clockT) clockT = setInterval(function () { if (alive && showing) tick(); }, 10000);
        el.setAttribute('look', look || 'plain');
        if (look === 'photo' && paintBg) { try { paintBg(el.querySelector('.enbg')); } catch (e) { el.setAttribute('look', 'plain'); } }
        showing = true;
        sig = '';
        return paint(true);
      },
      arrived: arrived,
      setClient: function (h) { client = h; if (showing) soon(); },
      setHide: function (list) { hide = Array.isArray(list) ? list.slice() : []; sig = ''; },
      // THE MOCKUP'S SIZES: a 1280 x 800 screen at 1 (rings 380 px, figures
      // 40 px), scaled with the room it has -- down only if they don't fit
      // below its own corner and above the row along the bottom
      layout: layout,
      leave: function () {
        showing = false;
        if (clockT) { clearInterval(clockT); clockT = null; }
        if (redrawT) { clearTimeout(redrawT); redrawT = null; }
      },
      showing: function () { return showing; },
      destroy: function () {
        alive = false; showing = false;
        if (clockT) { clearInterval(clockT); clockT = null; }
        if (redrawT) { clearTimeout(redrawT); redrawT = null; }
        var c = el.querySelector('.enbg');
        if (c && c.width) { c.width = 0; c.height = 0; }
        if (el.parentNode) el.parentNode.removeChild(el);
        if (window.hkStats && window.hkStats.release) { try { window.hkStats.release(waker); } catch (e) { /* not one of its cards */ } }
      }
    };
  }

  window.hkSaverEnergy = { create: create, ready: energyReady, PARTS: RINGS.slice(1).concat(['power', 'battery', 'yday', 'month', 'pace']), _: { view: view } };
})();
