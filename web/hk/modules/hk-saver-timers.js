// @ts-check
// hk-saver-timers.js -- THE SCREENSAVER'S TIMER SLIDE (phase 21, docs/phase21/TIMER-SLIDE.md): the timer ending first
// on a big ring, as Home Energy draws its rings, and the others beside it as small rings, soonest first. It comes only
// while a timer runs, every other turn, and hk-saver.js holds it up for a timer's last minute. The approved mock-up
// (docs/phase21/mockup/timer-slide.html) is the reference. Which timers count is hkTimers.userTimers' (hk-timers.js).
//
// It draws NO time, date, weather or status of its own: the slide corner does (hkSaverLayout SLIDES.timer).
// TIME'S UP: a timer that ended (Mantel says, hkTimers.rings) has the big ring, closed and pulsing, and Stop, +1 Min and Restart.
// A tap anywhere else on it stops the sound first and doesn't leave the screensaver. The sound itself is hk-timer-ring.js's.
//
// Loaded by hk-saver.js only once a timer runs -- never on its own.
//
// WHAT IT COSTS A WALL TABLET, by design:
//   - ONE LAYER FOR GOOD, hidden by its opacity, as .en and .wx are: never rebuilt at a turn
//   - only the digits and the arcs change, and only those whose second changed; nothing animates, so no frame is drawn
//     between seconds (an animated dash would repaint the ring on every frame)
//   - no ticking at all unless the slide is up
//
//   hkSaverTimers.create({ h24, sample }) -> ctl
//     ctl.el                       the layer (hk-saver.js puts it in its root)
//     ctl.ready(client)            a timer is counting (or, in a preview, sample ones)
//     ctl.draw(client, look, bg)   fill it in now; look: 'photo' | 'sky' | 'plain' (as Home Energy's)
//     ctl.arrived()                the fade is done (nothing further to do: it holds still)
//     ctl.layout(W, H)             the room it has (beside any pane)
//     ctl.tap(x, y)                a touch while it rings: acted on (true), nothing to do with it (false)
//     ctl.setClient(client), setNight(on), leave(), destroy(), info()
(function () {
  'use strict';
  if (window.hkSaverTimers) return;

  var FONT = '"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif';
  var LAST = 60, RED = 10;                     // the last minute; the ring reddens for its last ten seconds
  var ORANGE = '#ff9f0a', RED_C = '#ff453a', PAUSED = 'rgba(255,255,255,.5)';
  var SAMPLE = [{ id: 'sample.1', name: 'Pasta', left: 738, total: 900 }, { id: 'sample.2', name: 'Oven', left: 1520, total: 2700 },
                { id: 'sample.3', name: 'Laundry', left: 1390, total: 2700, paused: true }];

  var CSS = [
    '.tm{position:absolute;inset:0;z-index:3;opacity:0;pointer-events:none;overflow:hidden;will-change:opacity;',
    '  font-family:' + FONT + ';color:rgba(255,255,255,.94);text-shadow:0 1px 10px rgba(0,0,0,.28);',
    '  transition:opacity var(--hk-tm-fade,3000ms) ease;--z:1}',
    '.tm.on{opacity:1}',
    // BEHIND IT: as Home Energy's, the photo's blurred copy, the sky darkened, or its own gradient
    '.tm .tmbg{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0}',
    '.tm[look=photo] .tmbg{opacity:1;filter:brightness(.5) saturate(1.15)}',
    '.tm .tmwash{position:absolute;inset:0}',
    '.tm[look=photo] .tmwash{background:linear-gradient(180deg,rgba(6,10,18,.3),rgba(0,0,0,.28))}',
    '.tm[look=sky] .tmwash{background:linear-gradient(180deg,rgba(6,10,18,.62),rgba(6,10,18,.8))}',
    '.tm[look=plain] .tmwash{background:radial-gradient(ellipse at 20% 110%,#5a3d1d 0,transparent 55%),',
    '  radial-gradient(ellipse at 85% -10%,#1d3f5c 0,transparent 55%),linear-gradient(150deg,#0e1420,#121a26 50%,#0b0f17)}',
    // OVER NIGHT MODE, the last minute dimmed (a plain sheet, no filter: nothing re-rasters)
    '.tm .tmnight{position:absolute;inset:0;background:rgba(0,0,0,.5);display:none;z-index:2}',
    '.tm[night] .tmnight{display:block}',
    '.tm .tmbody{position:absolute;left:0;right:0;top:calc(120px * var(--z));bottom:calc(36px * var(--z));display:flex;',
    '  align-items:center;justify-content:center;gap:calc(64px * var(--z))}',
    '.tm .tmrw{position:relative;flex:none;width:calc(380px * var(--z));height:calc(380px * var(--z))}',
    '.tm[last] .tmrw{width:calc(470px * var(--z));height:calc(470px * var(--z))}',
    '.tm svg{display:block;width:100%;height:100%}',
    '.tm .tmticks{display:none}.tm[last] .tmticks{display:inline;opacity:.5}',
    '.tm .tmctr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}',
    '.tm .tmdg{font-size:calc(92px * var(--z));font-weight:700;letter-spacing:-3px;line-height:1;font-variant-numeric:tabular-nums}',
    '.tm[last] .tmdg{font-size:calc(136px * var(--z));letter-spacing:-4px}',
    // (past an hour, h:mm:ss needs more room in the ring)
    '.tm .tmdg.long{font-size:calc(66px * var(--z));letter-spacing:-2px}',
    '.tm .tmcs{font-size:calc(17px * var(--z));font-weight:600;opacity:.72;margin-top:calc(8px * var(--z))}',
    '.tm[last] .tmcs{font-size:calc(19px * var(--z))}',
    '.tm .tmread{width:calc(560px * var(--z));flex:none;min-width:0}',
    '.tm .tmeye{font-size:calc(15px * var(--z));font-weight:600;letter-spacing:.5px;text-transform:uppercase;opacity:.7}',
    '.tm .tmnm{font-size:calc(52px * var(--z));font-weight:700;letter-spacing:-1.2px;line-height:1.05;margin:calc(6px * var(--z)) 0 calc(4px * var(--z));',
    '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // one timer: Home Energy's readings
    '.tm .tmstats{margin-top:calc(22px * var(--z))}',
    '.tm .tmst{display:grid;grid-template-columns:calc(12px * var(--z)) auto minmax(24px,1fr) auto;column-gap:calc(12px * var(--z));align-items:center;margin-top:calc(18px * var(--z))}',
    '.tm .tmst i{width:calc(12px * var(--z));height:calc(12px * var(--z));border-radius:50%}',
    '.tm .tmst .k{font-size:calc(15px * var(--z));font-weight:600;letter-spacing:.4px;text-transform:uppercase;opacity:.75;white-space:nowrap}',
    '.tm .tmst .ln{height:2px;border-radius:1px;margin:0 calc(8px * var(--z));background:rgba(255,255,255,.22)}',
    '.tm .tmst .v{font-size:calc(36px * var(--z));font-weight:700;letter-spacing:-1px;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}',
    // several: the others, as small rings
    '.tm .tmsubs{display:flex;gap:calc(26px * var(--z));margin-top:calc(26px * var(--z));padding-top:calc(22px * var(--z));border-top:1px solid rgba(255,255,255,.14)}',
    '.tm .tmsb{width:calc(150px * var(--z));text-align:center;flex:none;min-width:0}',
    '.tm .tmsbr{position:relative;width:calc(116px * var(--z));height:calc(116px * var(--z));margin:0 auto}',
    '.tm .tmsd{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:calc(25px * var(--z));font-weight:700;letter-spacing:-.6px;' +
      'font-variant-numeric:tabular-nums}',
    '.tm .tmsb.long .tmsd{font-size:calc(18px * var(--z))}',
    '.tm .tmsn{font-size:calc(17px * var(--z));font-weight:600;margin-top:calc(9px * var(--z));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tm .tmse{font-size:calc(13.5px * var(--z));opacity:.62;margin-top:calc(1px * var(--z));white-space:nowrap}',
    '.tm .tmlede{font-size:calc(21px * var(--z));font-weight:500;line-height:1.35;opacity:.88}',
    '.tm .tmlede b{display:inline-block;vertical-align:.08em;margin-right:.45em;width:.55em;height:.55em;border-radius:50%;background:#ff9f0a;animation:tmglow 1.1s ease-in-out infinite}',
    '.tm[done] circle.arc{animation:tmglow 1.6s ease-in-out infinite}',
    '@keyframes tmglow{50%{opacity:.55}}',
    '.tm .tmacts{display:flex;gap:calc(12px * var(--z));margin-top:calc(26px * var(--z))}',
    '.tm .tmacts button{white-space:nowrap;font:inherit;font-weight:700;font-size:calc(22px * var(--z));height:calc(66px * var(--z));min-height:44px;border:0;border-radius:calc(33px * var(--z));' +
      'padding:0 calc(30px * var(--z));background:rgba(255,255,255,.18);color:#fff}',
    '.tm .tmacts button.stop{background:#ff9f0a;color:#1a0f00;min-width:calc(190px * var(--z))}',
    '@media (prefers-reduced-motion:reduce){.tm[done] circle.arc,.tm .tmlede b{animation:none}}',
    '.tm .tmsb.more .tmsbr{display:flex;align-items:center;justify-content:center;font-size:calc(30px * var(--z));font-weight:700;opacity:.7}',
    // NARROW: beside a tablet's Side Pane
    '.tm[shape=narrow] .tmbody{flex-direction:column;gap:calc(14px * var(--z));top:calc(112px * var(--z));bottom:calc(20px * var(--z))}',
    '.tm[shape=narrow] .tmrw{width:calc(290px * var(--z));height:calc(290px * var(--z))}',
    '.tm[shape=narrow][last] .tmrw{width:calc(340px * var(--z));height:calc(340px * var(--z))}',
    '.tm[shape=narrow] .tmdg{font-size:calc(72px * var(--z))}',
    '.tm[shape=narrow][last] .tmdg{font-size:calc(100px * var(--z))}',
    '.tm[shape=narrow] .tmdg.long{font-size:calc(50px * var(--z))}',
    '.tm[shape=narrow] .tmread{width:calc(680px * var(--z));text-align:center}',
    '.tm[shape=narrow] .tmnm{font-size:calc(40px * var(--z))}',
    '.tm[shape=narrow] .tmsubs{justify-content:center;margin-top:calc(14px * var(--z));padding-top:calc(14px * var(--z))}',
    '.tm[shape=narrow] .tmstats{text-align:left;margin-top:calc(8px * var(--z))}',
    '.tm[shape=narrow] .tmst{margin-top:calc(9px * var(--z))}',
    // TALL: an iPad upright, a phone
    '.tm[shape=tall] .tmbody{flex-direction:column;gap:calc(34px * var(--z));top:calc(150px * var(--z));bottom:calc(30px * var(--z))}',
    '.tm[shape=tall] .tmrw{width:calc(560px * var(--z));height:calc(560px * var(--z))}',
    '.tm[shape=tall][last] .tmrw{width:calc(590px * var(--z));height:calc(590px * var(--z))}',
    '.tm[shape=tall] .tmdg{font-size:calc(136px * var(--z))}',
    '.tm[shape=tall][last] .tmdg{font-size:calc(170px * var(--z))}',
    '.tm[shape=tall] .tmdg.long{font-size:calc(96px * var(--z))}',
    '.tm[shape=tall] .tmcs{font-size:calc(26px * var(--z))}',
    '.tm[shape=tall] .tmread{width:calc(720px * var(--z));text-align:center}',
    '.tm[shape=tall] .tmeye{font-size:calc(22px * var(--z))}',
    '.tm[shape=tall] .tmnm{font-size:calc(74px * var(--z))}',
    '.tm[shape=tall] .tmsubs{justify-content:center}',
    '.tm[shape=tall] .tmsb{width:calc(220px * var(--z))}',
    '.tm[shape=tall] .tmsbr{width:calc(164px * var(--z));height:calc(164px * var(--z))}',
    '.tm[shape=tall] .tmsd{font-size:calc(36px * var(--z))}',
    '.tm[shape=tall] .tmsb.long .tmsd{font-size:calc(25px * var(--z))}',
    '.tm[shape=tall] .tmsn{font-size:calc(26px * var(--z))}',
    '.tm[shape=tall] .tmse{font-size:calc(21px * var(--z))}',
    '.tm[shape=tall] .tmst .k{font-size:calc(22px * var(--z))}',
    '.tm[shape=tall] .tmst .v{font-size:calc(44px * var(--z))}',
    '.tm[shape=tall] .tmstats{text-align:left}',
    '.tm[shape=tall] .tmlede{font-size:calc(30px * var(--z))}',
    '.tm[shape=tall] .tmacts,.tm[shape=narrow] .tmacts{justify-content:center}',
    '.tm[shape=tall] .tmacts button{font-size:calc(34px * var(--z));height:calc(100px * var(--z));border-radius:calc(50px * var(--z))}',
    '.tm[shape=tall][done] .tmrw{width:calc(440px * var(--z));height:calc(440px * var(--z))}',
    '.tm[shape=tall][done] .tmdg{font-size:calc(110px * var(--z))}',
    '.tm[shape=narrow] .tmlede{font-size:calc(18px * var(--z))}',
    '.tm[shape=narrow] .tmacts{margin-top:calc(14px * var(--z))}',
    '.tm[shape=short] .tmacts{margin-top:calc(12px * var(--z))}',
    // SHORT: a phone on its side, the corner on the left and the rings to its right
    '.tm[shape=short] .tmbody{top:calc(26px * var(--z));bottom:calc(8px * var(--z));justify-content:flex-end;padding-right:calc(70px * var(--z))}',
    '.tm[shape=short] .tmrw,.tm[shape=short][last] .tmrw{width:calc(420px * var(--z));height:calc(420px * var(--z))}',
    '.tm[shape=short][last] .tmdg{font-size:calc(110px * var(--z))}',
    '.tm[shape=short] .tmsubs{margin-top:calc(14px * var(--z));padding-top:calc(14px * var(--z))}',
    '.tm[shape=short] .tmstats{margin-top:calc(8px * var(--z))}',
    '.tm[shape=short] .tmst{margin-top:calc(8px * var(--z))}',
    '.tm[shape=short] .tmsbr{width:calc(100px * var(--z));height:calc(100px * var(--z))}',
    '.tm[shape=short] .tmsd{font-size:calc(20px * var(--z));letter-spacing:-.4px}',
    '.tm[shape=short] .tmsb.long .tmsd{font-size:calc(15px * var(--z))}',
    '.tm[shape=short] .tmdg.long{font-size:calc(70px * var(--z))}',
    '.tm[shape=short] .tmread{width:calc(520px * var(--z))}',
    '.tm[shape=short] .tmsn{margin-top:calc(4px * var(--z))}'
  ].join('');

  /** @param {any} s */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return /** @type {any} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  // m:ss, h:mm:ss past an hour; a second is shown until it has fully gone (0:00 only at the end)
  /** @param {number} s */
  function clockOf(s) {
    s = Math.max(0, Math.ceil(s));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  // a small ring's words: past an hour, 2h 30m (h:mm:ss wouldn't fit inside it, and it needn't count seconds)
  /** @param {number} s */
  function smallOf(s) {
    if (s < 3600) return clockOf(s);
    s = Math.ceil(s / 60);
    return Math.floor(s / 60) + 'h ' + s % 60 + 'm';
  }
  // how full a ring is. THE BIG RING'S LAST MINUTE IS ONE FULL SWEEP of its own: on a two-hour timer the true fraction
  // would be a sliver nobody could read
  /** @param {any} r @param {number} left @param {boolean} big */
  function fraction(r, left, big) {
    if (big && !r.paused && left <= LAST && r.total > LAST) return Math.max(0, Math.min(1, left / LAST));
    return r.total > 0 ? Math.max(0, Math.min(1, left / r.total)) : 0;
  }
  // a color for this timer (hk-timers.js: the same on the slide and the pop-up)
  /** @param {string} id */
  function colorOf(id) { return window.hkTimers && window.hkTimers.colorOf ? window.hkTimers.colorOf(id) : ORANGE; }
  // the shape, as Home Energy's sizes are chosen: 1 at the wall tablet's 1280 x 800
  /** @param {number} W @param {number} H */
  function shapeOf(W, H) {
    var tall = H > 1.05 * W, short = H < 500, narrow = !tall && !short && W < 1000;
    var z = tall ? Math.min(W / 800, H / 1280) : (narrow || short) ? Math.min(W / 880, H / 800) : Math.min(W / 1280, H / 800);
    return { shape: short ? 'short' : tall ? 'tall' : narrow ? 'narrow' : 'wide', z: Math.max(0.42, Math.min(2.5, z)) };
  }
  /** @param {string} id @param {number} r @param {number} w @param {string} color @param {number} f */
  function circle(id, r, w, color, f) {
    var c = 2 * Math.PI * r;
    return '<circle cx="110" cy="110" r="' + r + '" fill="none" stroke="' + color + '" stroke-opacity=".18" stroke-width="' + w + '"/>' +
      '<circle class="arc" data-t="' + esc(id) + '" data-c="' + c.toFixed(1) + '" cx="110" cy="110" r="' + r + '" fill="none" stroke="' + color +
      '" stroke-width="' + w + '" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 110 110)"/>';
  }
  function ticks() {
    var o = '';
    for (var i = 0; i < 12; i++) {
      var a = i * Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
      o += '<line x1="' + (110 + 76 * c).toFixed(1) + '" y1="' + (110 + 76 * s).toFixed(1) + '" x2="' + (110 + 71 * c).toFixed(1) + '" y2="' + (110 + 71 * s).toFixed(1) +
        '" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>';
    }
    return '<g class="tmticks">' + o + '</g>';
  }
  /** @param {any} h */
  function zoneOf(h) { return h && h.config && h.config.time_zone; }

  /** @param {{ h24?: boolean, sample?: () => boolean }} o */
  function create(o) {
    var el = document.createElement('div');
    el.className = 'tm';
    el.setAttribute('look', 'plain');
    el.innerHTML = '<style>' + CSS + '</style><canvas class="tmbg"></canvas><div class="tmwash"></div><div class="tmbody"></div><div class="tmnight"></div>';
    var body = /** @type {HTMLElement} */ (el.querySelector('.tmbody'));
    /** @type {any} */ var client = null;
    var alive = true, showing = false, W = 1280, H = 800, built = '';
    /** @type {any} */ var tick = null;
    /** @type {any[]} */ var rows = [];
    /** @type {any[]} */ var rings = [];
    var room = '', onTablet = false;

    // the house's list, soonest first (hk-timers.js), or a preview's samples while none runs
    /** @param {any} h */
    function read(h) {
      var T = window.hkTimers, S = window.hkSettings;
      rings = T && T.rings && h ? T.rings(h.states) : [];
      var me = null;
      try { me = S && S.tablet && h ? S.tablet(h) : null; } catch (e) { /* no tablets here */ }
      onTablet = !!me; room = (me && me.room) || '';
      var list = T && T.userTimers && h ? T.userTimers(h.states, T.rulesOf(S), Date.now()) : [];
      if (!list.some(function (/** @type {any} */ r) { return !r.paused; }) && o.sample && o.sample()) {
        var now = Date.now();
        return SAMPLE.map(function (r) { return r.paused ? { id: r.id, name: r.name, total: r.total, left: r.left, paused: true } :
          { id: r.id, name: r.name, total: r.total, end: now + r.left * 1000, left: r.left }; });
      }
      return list;
    }
    /** @param {any} r */
    function leftOf(r) { return r.paused ? r.left : Math.max(0, (r.end - Date.now()) / 1000); }
    /** @param {number} ms */
    function endsAt(ms) {
      var d = new Date(ms), L = window.hkLocale;
      try {
        return L ? d.toLocaleTimeString(L.tag(), L.clock({ hour: 'numeric', minute: '2-digit', hour12: !o.h24, timeZone: zoneOf(client) }))
          : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !o.h24 });
      } catch (e) { return ''; }
    }
    /** @param {any} r */
    function sub(r) {
      var left = leftOf(r), txt = smallOf(left), color = r.paused ? PAUSED : colorOf(r.id);
      return '<div class="tmsb' + (left >= 3600 ? ' long' : '') + '"><div class="tmsbr"><svg viewBox="0 0 220 220" aria-hidden="true">' + circle(r.id, 92, 24, color, fraction(r, left, false)) +
        '</svg>' +
        '<div class="tmsd" data-v="' + esc(r.id) + '">' + txt + '</div></div>' +
        '<div class="tmsn">' + esc(r.name) + '</div><div class="tmse">' + (r.paused ? 'Paused' : 'Ends ' + esc(endsAt(r.end))) + '</div></div>';
    }
    // THE WHOLE OF IT, only when what it holds changes: who, in what order, paused or not, the last minute's size
    function buildDone() {
      el.setAttribute('done', ''); el.removeAttribute('last');
      var T = window.hkTimers, others = rows.filter(function (r) { return !rings.some(function (g) { return g.entity_id === r.id; }); });
      var key = JSON.stringify(['done', rings.map(function (g) { return [g.entity_id, g.name, g.tablet, g.speakers]; }), others.map(function (r) { return [r.id, !!r.paused, r.end || 0]; }), W, H,
        room]);
      if (key === built) return;
      built = key;
      var hero = rings[0], one = rings.length === 1, where = T.whereWords(hero, room, onTablet), shape = shapeOf(W, H).shape;
      var max = W < 500 || (others.length > 3 && (shape === 'tall' || shape === 'short')) ? 2 : 3, shown = others.slice(0, max), more = others.length - shown.length;
      body.innerHTML = '<div class="tmrw"><svg viewBox="0 0 220 220" role="img" aria-label="' + esc(hero.name) + ' timer has ended">' + circle(hero.entity_id, 96, 22, colorOf(hero.entity_id), 1) +
        '</svg>' +
        '<div class="tmctr"><div class="tmdg">Done</div></div></div>' +
        '<div class="tmread"><div class="tmeye">' + (one ? 'Time\u2019s Up' : 'Time\u2019s Up, ' + rings.length + ' Timers') + '</div>' +
        '<div class="tmnm">' + esc(rings.map(function (g) { return g.name; }).join(' and ')) + '</div>' +
        '<div class="tmlede">' + (where ? '<b></b>Ringing on ' + esc(where) + '.' : 'Silent, as set.') + '</div>' +
        '<div class="tmacts"><button class="stop" data-a="stop">' + (one ? 'Stop' : 'Stop All') + '</button>' +
        (one ? '<button data-a="more" data-id="' + esc(hero.entity_id) + '">+1 Min</button><button data-a="again" data-id="' + esc(hero.entity_id) + '">Restart</button>' : '') + '</div>' +
        (others.length ? '<div class="tmsubs">' + shown.map(sub).join('') + (more ? '<div class="tmsb more"><div class="tmsbr">+' + more + '</div><div class="tmsn">More</div></div>' : '') + '</div>' :
          '') + '</div>';
    }
    function build() {
      if (rings.length) { buildDone(); return; }
      el.removeAttribute('done');
      var hero = rows[0];
      if (!hero) { body.innerHTML = ''; built = ''; return; }
      var left = leftOf(hero), last = !hero.paused && left <= LAST;
      if (last) el.setAttribute('last', ''); else el.removeAttribute('last');
      var long = left >= 3600;
      var key = JSON.stringify([rows.map(function (r) { return [r.id, r.name, !!r.paused, r.end || 0, leftOf(r) >= 3600]; }), last, W, H, o.h24]);
      if (key === built) return;
      built = key;
      // (three small rings across, or two and +N where a fourth place wouldn't fit)
      var others = rows.slice(1), shape = shapeOf(W, H).shape, max = W < 500 || (others.length > 3 && (shape === 'tall' || shape === 'short')) ? 2 : 3;
      var shown = others.slice(0, max), more = others.length - shown.length;
      var read1 = '<div class="tmeye">' + (others.length ? 'Ends First' : 'Timer') + '</div><div class="tmnm">' + esc(hero.name) + '</div>' + ledeOf(hero);
      if (others.length) {
        read1 += '<div class="tmsubs">' + shown.map(sub).join('') +
          (more ? '<div class="tmsb more"><div class="tmsbr">+' + more + '</div><div class="tmsn">More</div></div>' : '') + '</div>';
      } else {
        read1 += '<div class="tmstats"><div class="tmst"><i style="background:' + colorOf(hero.id) + '"></i><span class="k">Ends At</span><span class="ln"></span><span class="v">' +
          esc(endsAt(hero.end)) + '</span></div>' +
          '<div class="tmst"><i style="background:' + PAUSED + '"></i><span class="k">Set For</span><span class="ln"></span><span class="v">' + esc(clockOf(hero.total)) + '</span></div></div>';
      }
      body.innerHTML = '<div class="tmrw"><svg viewBox="0 0 220 220" role="img" aria-label="' + esc(hero.name) + ' timer">' + circle(hero.id, 96, 22, colorOf(hero.id), fraction(hero, left, true)) +
        ticks() + '</svg>' +
        '<div class="tmctr"><div class="tmdg' + (long ? ' long' : '') + '" data-v="' + esc(hero.id) + '">' + clockOf(left) + '</div><div class="tmcs">' +
          (last ? 'Last Minute' : 'Ends ' + esc(endsAt(hero.end))) + '</div></div></div>' +
        '<div class="tmread">' + read1 + '</div>';
    }
    // Rings on... under its name: on Mantel, which says where. Nothing in Home Assistant, where it doesn't ring.
    /** @param {any} hero */
    function ledeOf(hero) {
      var q = client && client.states && client.states['sensor.running_quick_timers'], run = (q && q.attributes && q.attributes.running) || [];
      var row = run.filter(function (r) { return r.entity_id === hero.id; })[0];
      if (!row || row.tablet === undefined) return '';
      var where = window.hkTimers.whereWords(row, room, onTablet);
      return '<div class="tmlede">' + (where ? 'Rings on ' + esc(where) + '.' : 'Won\u2019t make a sound.') + '</div>';
    }
    // ONE SECOND'S WORTH: only what changed. The size of the whole changes at the last minute (build), once.
    function paint() {
      if (!alive || !showing) return;
      build();
      var heroAt = rings.length ? -1 : 0;
      rows.forEach(function (r, i) {
        if (r.paused) return;
        var left = leftOf(r), txt = i === heroAt ? clockOf(left) : smallOf(left);
        body.querySelectorAll('[data-v="' + r.id + '"]').forEach(function (n) { if (n.textContent !== txt) n.textContent = txt; });
        body.querySelectorAll('circle.arc[data-t="' + r.id + '"]').forEach(function (a) {
          var c = Number(a.getAttribute('data-c')), dash = (c * fraction(r, left, i === heroAt)).toFixed(1) + ' ' + c.toFixed(1);
          if (a.getAttribute('stroke-dasharray') !== dash) a.setAttribute('stroke-dasharray', dash);
          var col = i === heroAt && left <= RED ? RED_C : '';
          if (a.getAttribute('data-red') !== col) { a.setAttribute('data-red', col); a.setAttribute('stroke', col || colorOf(r.id)); }
        });
      });
    }
    function startTick() { if (!tick) tick = setInterval(paint, 500); }
    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

    return {
      el: el,
      ready: function (/** @type {any} */ h) { client = h || client; rows = read(client); return !!rings.length || rows.some(function (r) { return !r.paused; }); },
      draw: function (/** @type {any} */ h, /** @type {string=} */ look, /** @type {any=} */ paintBg) {
        client = h || client;
        rows = read(client);
        if (!rings.length && !rows.some(function (r) { return !r.paused; })) return false;
        el.setAttribute('look', look || 'plain');
        if (look === 'photo' && paintBg) { try { paintBg(el.querySelector('.tmbg')); } catch (e) { el.setAttribute('look', 'plain'); } }
        showing = true;
        built = '';
        paint();
        startTick();
        return true;
      },
      arrived: function () { /* it holds still: nothing draws in */ },
      tap: function (/** @type {number} */ x, /** @type {number} */ y) {
        if (!rings.length) return false;
        var T = window.hkTimers, hit = null;
        body.querySelectorAll('button[data-a]').forEach(function (b) { var r = b.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = b; });
        /** @type {any} */ var on = hit;
        T.ringAct(client, on ? on.getAttribute('data-a') : 'stop', on ? on.getAttribute('data-id') : null);
        return true;
      },
      layout: function (/** @type {number} */ w, /** @type {number} */ h) {
        W = w || W; H = h || H;
        var s = shapeOf(W, H);
        el.setAttribute('shape', s.shape);
        el.style.setProperty('--z', String(s.z));
        if (showing) { built = ''; paint(); }
      },
      setClient: function (/** @type {any} */ h) { client = h; rows = read(h); if (showing) paint(); },
      setH24: function (/** @type {boolean} */ v) { if (o.h24 !== v) { o.h24 = v; built = ''; } },
      setNight: function (/** @type {boolean} */ on) { if (on) el.setAttribute('night', ''); else el.removeAttribute('night'); },
      leave: function () { showing = false; stopTick(); el.removeAttribute('night'); },
      info: function () { return { rings: rings.map(function (g) { return g.name; }), done: el.hasAttribute('done'),
        rows: rows.map(function (r) { return { id: r.id, name: r.name, paused: !!r.paused, left: Math.round(leftOf(r)) }; }), last: el.hasAttribute('last'), shape: el.getAttribute('shape'), W: W,
        H: H, showing: showing }; },
      destroy: function () {
        alive = false; showing = false; stopTick();
        var c = /** @type {HTMLCanvasElement|null} */ (el.querySelector('.tmbg'));
        if (c && c.width) { c.width = 0; c.height = 0; }
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }

  window.hkSaverTimers = { create: create, _: { clockOf: clockOf, smallOf: smallOf, fraction: fraction, colorOf: colorOf, shapeOf: shapeOf } };
})();
