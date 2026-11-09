// hk-np-strip.js - the music player's CONTROLS STRIP, one piece every player draws with.
//
// 2026-11-09, the owner: "We probably need more space in general above and below the play button...yesterday when my
// wife went to hit the play button, she missed and hit the volume slider instead." Then "strip first": the controls
// every player shares in ONE place, so the room round them -- and, next, a row of new buttons -- lands in every player
// at once. The players keep their own outer layouts; this is what sits inside them:
//
//   the progress   the song's bar and its times (drawn here, 'bar') or a slot for a player's own (the Now Playing
//                  card's hk-media-control-card, 'slot')
//   the transport  Speakers, back, play / pause (the biggest), next, (stop,) Browse
//   the volume     its track between a small and a big speaker ('bar') or a slot for a player's own slider ('slot')
//   a slot         an empty row under them for a row of buttons later (hidden while empty)
//
// WHO DRAWS WITH IT: the screensaver's music (hk-saver-music.js musicView: the slide, the screensaver's pane, the Now
// Playing page and the Side Pane's Full player), the Now Playing card (hk-media-now.js: the Home Grid blocks and the
// docked bar) and the Side Pane's Less / More mini player (hk-sidepane.js). Each keeps its own event wiring -- the
// screensaver finds a tap by its place (hitAt below, so its hit areas are these boxes exactly), the others by the
// element -- and every control keeps its data-act.
//
// THE TOUCH RULES (the owner's, and the cards audit's): every control at least 44 px on the screen it is drawn on (a
// Home Grid block is drawn at about 0.8 on the house's 1280 x 800 tablets, so a block asks 56: --hks-min); no two
// hit areas overlap; at least 12 px clear between the transport's hit areas and the volume's, and between the progress
// and the transport; play / pause the biggest target. A hit area is the control's own box: nothing reaches past it
// (no slop, no ::before), so what is measured is what a finger gets (check() below, run by the player checks).
//
// Only assigns window.hkNpStrip at load (no DOM work): a bootstrap file, loaded before any card or the screensaver
// (web/home.js, web/shim/settings-page.js; HK Frontend's boot.py CORE; the frontend suites' prelude, tests/run).
// @ts-check
(function (global) {
  'use strict';
  if (global.hkNpStrip) return;

  // the glyphs (Material Design Icons' paths), the same in every player
  var ICON = { prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z', next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6z',
               play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
               pause: 'M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
               stop: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
               search: 'M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.52 6.52 0 0 1 9.5 16 6.5 6.5 0 0 1 3 9.5 6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14 14 12 14 9.5 12 5 9.5 5z',
               queue: 'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v5.2a2.5 2.5 0 1 0 2 2.3V12h2v-2h-4z',
               chevron: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z',
               vlo: 'M7 9v6h4l5 5V4l-5 5H7z',
               vhi: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z' };
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

  // THE MARKUP (2026-11-09, the owner's mockup 12h, "Yes, build it": Browse at the row's left end, Up Next at its right,
  // the Speakers key gone to the speaker line over the title -- lineHtml below). o.prog / o.vol: 'bar' (drawn here),
  // 'slot' (an empty box for the player's own), or nothing; o.ends: false for neither end; o.queue: false where the
  // player has no queue to open, or lists it right under (the right end kept, unseen, so the keys stay centered as a
  // group); o.stop: a stop button after next; o.roles: data-hk-role on each piece (the Now
  // Playing card's, which its suites find them by); o.tag: the buttons' element ('div', or 'button' for a player
  // whose buttons are buttons); o.progHtml / o.volHtml: what a 'slot' holds from the start (a player's own markup);
  // o.playing: drawn with the pause glyph (a player that draws its markup afresh rather than painting it: play());
  // o.keys: an attribute name and, per control, its value, for a player that finds its taps by its own attribute (the
  // Music page's data-k: { attr: 'data-k', brw: 'browse', ... })
  function html(o) {
    o = o || {};
    var tag = o.tag === 'button' ? 'button' : 'div';
    var role = function (r) { return o.roles ? ' data-hk-role="' + r + '"' : ''; };
    var btn = function (act, cls, label, glyph, r) {
      var key = o.keys && o.keys[act] ? ' ' + o.keys.attr + '="' + o.keys[act] + '"' : '';
      return '<' + tag + (tag === 'button' ? ' type="button"' : ' role="button"') + ' class="mbtn' + (cls ? ' ' + cls : '') + '" data-act="' + act +
        '"' + key + ' aria-label="' + label + '"' + role(r) + '>' + glyph + '</' + tag + '>';
    };
    var prog = o.prog === 'bar' ? '<div class="mbar"><i></i></div><div class="mtimes"><span></span><span></span></div>' : o.progHtml || '';
    var vol = o.vol === 'bar' ? svg(ICON.vlo) + '<div class="mvt"><i></i><b></b></div>' + svg(ICON.vhi)
            : svg(ICON.vlo) + '<div class="mvs"' + (o.volHtml ? '' : ' data-act="vol"') + role('meta') + '>' + (o.volHtml || '') + '</div>' + svg(ICON.vhi);
    return '<div class="hks"' + (o.ends === false ? ' noends' : '') + (o.queue === false ? ' noqueue' : '') + (o.stop ? ' stop' : '') + '>' +
      (o.prog ? '<div class="mprog"' + role('sub') + '>' + prog + '</div>' : '') +
      '<div class="mctl">' +
      btn('brw', 'mx', 'Browse Music', svg(ICON.search), 'brw') +
      btn('prev', '', 'Previous', svg(ICON.prev), 'prev') +
      btn('pp', 'mpp', o.playing ? 'Pause' : 'Play', svg(o.playing ? ICON.pause : ICON.play), 'play') +
      btn('next', '', 'Next', svg(ICON.next), 'next') +
      (o.stop ? btn('stop', '', 'Stop', svg(ICON.stop), 'stop') : '') +
      // (its drawing sits a unit low in its 24: drawn a unit up, so its ink is centered in the key as the others')
      btn('queue', 'mx', 'Up Next', svg(ICON.queue).replace('viewBox="0 0 24 24"', 'viewBox="0 1 24 24"'), 'queue') +
      '</div>' +
      (o.vol ? '<div class="mvol"' + (o.vol === 'bar' ? ' data-act="vol"' : '') + '>' + vol + '</div>' : '') +
      '<div class="mslot"></div></div>';
  }

  // THE SPEAKER LINE (mockup 12h): over the title, where the room's name was -- the speaker glyph, where it plays ("Living
  // Room + Kitchen", the rooms joined to it lighter; a narrow place shows the first alone) and a chevron saying it opens:
  // a tap is what the Speakers key's was. Text-sized, its touch area a full target tall round the words (::after: 44,
  // a block's 56 -- --hksl-h). o.keys as html()'s; o.tag 'button' for a player whose buttons are buttons.
  function lineHtml(o) {
    o = o || {};
    var tag = o.tag === 'button' ? 'button' : 'div', key = o.keys && o.keys.spk ? ' ' + o.keys.attr + '="' + o.keys.spk + '"' : '';
    return '<' + tag + (tag === 'button' ? ' type="button"' : ' role="button"') + ' class="hksl" data-act="spk"' + key +
      (o.roles ? ' data-hk-role="spk"' : '') + ' aria-label="Speakers"><hk-icon icon="hk:homepod"></hk-icon><span class="hksl-t"><b></b><i></i></span>' +
      '<svg class="hksl-c" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON.chevron + '"/></svg></' + tag + '>';
  }
  // ...where it plays: the room first, then the rooms joined to it
  function line(root, names) {
    var el = !root ? null : root.classList && root.classList.contains('hksl') ? root : root.querySelector('.hksl');
    if (!el) return;
    names = (names || []).filter(Boolean);
    var b = el.querySelector('b'), i = el.querySelector('i'), one = names[0] || '', rest = names.length > 1 ? ' + ' + names.slice(1).join(' + ') : '';
    if (b && b.textContent !== one) b.textContent = one;
    if (i && i.textContent !== rest) i.textContent = rest;
    var label = 'Speakers: ' + (one + rest || 'none');
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
  }
  // ...and their names: hkMusic's short ones ("Kitchen"), the player first, a virtual pair one room (hkMusic.fold);
  // h the client (its states), key the player, members its rooms where the caller knows them (else its group_members)
  function rooms(h, key, members) {
    var M = global.hkMusic, states = (h && h.states) || {}, a = ((states[key] || {}).attributes) || {};
    var name = function (e) { var x = states[e]; return (M && M.known && M.known(e) && M.nameOf && M.nameOf(e)) || (x && x.attributes && x.attributes.friendly_name) || e; };
    var g = members && members.length ? members : (M && M.fold ? M.fold(a.group_members || []) : (a.group_members || []));
    if (!key) return [];
    return [name(key)].concat((g || []).filter(function (e) { return e !== key; }).map(name));
  }

  // THE GEOMETRY, one source. A player sets the numbers it needs on the strip or anything above it (none is required):
  //   --hks-z      its scale (the screensaver's --z; 1 elsewhere)        --hks-min  the least target (44px; a block 56px)
  //   --hks-b / -pp / -x   back and next / play-pause / Speakers and Browse: each a target, never under --hks-min, and
  //                play / pause always at least 4 px bigger than back and next
  //   --hks-gb / -gpp / -gx   their glyphs                                  --hks-vh   the volume's target (its row)
  //   --hks-tk     the volume's track                                      --hks-th   the times under the progress bar
  //   --hks-g1     the progress bar to the transport's targets             --hks-g2   the transport's targets to the volume's
  //   --hks-ink / -ink2 / -glow / -track / -fill   its colors
  // EVEN ROOM ABOUT PLAY / PAUSE, by default: g1 clears the times by 12 px and g2 is what puts the pause glyph's ink
  // halfway between the progress bar and the volume's track (player_look.js measures it), never under 12 px. The
  // extra room the owner asked for is above and below the transport row, where it reads as air, not between buttons.
  var CSS = [
    '.hks{display:flex;flex-direction:column;min-width:0;--_z:var(--hks-z,1);--_min:var(--hks-min,44px);',
    '  --_b:max(var(--_min),var(--hks-b,calc(60px * var(--_z))));--_pp:max(calc(var(--_b) + 4px),var(--hks-pp,calc(76px * var(--_z))));',
    '  --_x:max(var(--_min),var(--hks-x,calc(48px * var(--_z))));',
    '  --_gb:var(--hks-gb,calc(46px * var(--_z)));--_gpp:var(--hks-gpp,calc(64px * var(--_z)));--_gx:var(--hks-gx,calc(28px * var(--_z)));',
    '  --_vh:max(var(--_min),var(--hks-vh,calc(44px * var(--_z))));--_tk:var(--hks-tk,calc(6px * var(--_z)));',
    '  --_th:var(--hks-th,calc(25px * var(--_z)));',
    '  --_g1:var(--hks-g1,max(calc(var(--_th) + 12px),calc(12px + var(--_vh) / 2 - var(--_tk) / 2)));',
    '  --_g2:var(--hks-g2,max(12px,calc(var(--_g1) - var(--_vh) / 2 + var(--_tk) / 2)))}',
    // the progress: the bar, the times hanging under it (in the room above the transport)
    '.hks .mprog{position:relative;flex:none}',
    '.hks .mbar{height:calc(5px * var(--_z));border-radius:99px;background:var(--hks-track,rgba(255,255,255,.22));overflow:hidden}',
    '.hks .mbar i{display:block;height:100%;background:var(--hks-fill,rgba(255,255,255,.92));transform-origin:0 50%;transform:scaleX(0)}',
    '.hks .mtimes{position:absolute;left:0;right:0;top:100%;display:flex;justify-content:space-between;font-size:var(--hks-tf,calc(15px * var(--_z)));',
    '  line-height:1.2;opacity:.66;margin-top:calc(7px * var(--_z));font-variant-numeric:tabular-nums}',
    // the transport: one row as tall as play / pause, spread across the strip, Speakers' and Browse's ink in line with
    // the bars' ends (the row reaches out by the room round their glyphs); 8 px clear between two targets at least
    '.hks .mctl{display:flex;align-items:center;justify-content:space-between;column-gap:var(--hks-cg,8px);min-height:var(--_pp);flex:none;',
    '  margin:var(--_g1) calc((var(--_x) - var(--_gx)) / -2) 0}',
    '.hks[noends] .mctl{justify-content:center;margin-left:0;margin-right:0}',
    '.hks[noends] .mx,.hks:not([stop]) .mbtn[data-act=stop]{display:none}',
    '.hks[noqueue] .mbtn[data-act=queue]{visibility:hidden;pointer-events:none}',
    '.hks .mbtn{flex:none;box-sizing:border-box;width:var(--_b);height:var(--_b);margin:0;padding:0;border:0;background:none;font:inherit;',
    '  display:flex;align-items:center;justify-content:center;border-radius:50%;color:var(--hks-ink,#fff);cursor:pointer;',
    '  -webkit-tap-highlight-color:transparent;transition:transform .15s ease,opacity .15s ease}',
    '.hks .mbtn svg{width:var(--_gb);height:var(--_gb);fill:currentColor;filter:var(--hks-glow,none)}',
    '.hks .mpp{width:var(--_pp);height:var(--_pp)}',
    '.hks .mpp svg{width:var(--_gpp);height:var(--_gpp)}',
    // SPEAKERS AND BROWSE: smaller and lighter than the transport (they open things), lit while their panel is open
    // (the one well left: a button that is on); targets as big as the rule asks
    '.hks .mx{width:var(--_x);height:var(--_x);color:var(--hks-ink2,rgba(255,255,255,.72))}',
    '.hks .mx svg,.hks .mx hk-icon{width:var(--_gx);height:var(--_gx);--mdc-icon-size:var(--_gx);display:flex;color:inherit;filter:var(--hks-glow,none)}',
    '.hks .mx.on,.hks .mx.lit{background:#fff;color:#111}',
    '.hks .mx.on svg,.hks .mx.on hk-icon{filter:none}',
    '.hks .mbtn.hit,.hks .mbtn:active{transform:scale(.88);opacity:.6}',
    '.hks .mbtn.dis{opacity:.35;pointer-events:none}',
    '@media (hover:hover){.hks .mbtn:hover{opacity:.75}}',
    '.hks .mbtn:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
    // the volume: a row as tall as its target, the track in its middle, the whole row the target (a finger on the
    // speakers sets it to that end)
    '.hks .mvol{display:flex;align-items:center;gap:calc(12px * var(--_z));height:var(--_vh);margin-top:var(--_g2);flex:none}',
    '.hks .mvol[data-act=vol]{touch-action:none;cursor:pointer}',
    '.hks .mvol>svg{flex:none;width:calc(22px * var(--_z));height:calc(22px * var(--_z));fill:var(--hks-ink2,rgba(255,255,255,.72))}',
    '.hks .mvol>svg:first-child{width:calc(18px * var(--_z));height:calc(18px * var(--_z))}',
    '.hks .mvt{position:relative;flex:1 1 auto;height:var(--_tk);border-radius:99px;background:var(--hks-track,rgba(255,255,255,.22))}',
    '.hks .mvt i{position:absolute;left:0;top:0;bottom:0;width:calc(var(--v,0) * 100%);border-radius:99px;background:var(--hks-fill,rgba(255,255,255,.92))}',
    '.hks .mvt b{position:absolute;top:50%;left:calc(var(--v,0) * 100%);width:calc(20px * var(--_z));height:calc(20px * var(--_z));',
    '  margin:calc(-10px * var(--_z)) 0 0 calc(-10px * var(--_z));border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.3);transition:transform .12s ease}',
    '[dragging] .hks .mvt b{transform:scale(1.25)}',
    // (a player's own slider in the slot: as tall as the row, so its target is the row's)
    '.hks .mvs{flex:1 1 auto;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:center;--hk-range-h:var(--_vh);touch-action:pan-y}',
    '.hks .mvs>*{display:block;width:100%}',
    '.hks[novol] .mvol{visibility:hidden}',
    // THE SLOT for a row of buttons (next, designed separately): under the volume, the same room above it
    '.hks .mslot{display:flex;align-items:center;justify-content:space-between;column-gap:var(--hks-cg,8px);margin-top:var(--_g2);flex:none}',
    '.hks .mslot:empty{display:none}',
    // CELLS: a player whose outer grid places each control itself (the docked bar, the card's legacy wide layout) --
    // the strip's boxes and glyphs, its grid's places (areas named as the card has always named them)
    '.hks[cells],.hks[cells] .mctl{display:contents}',
    '.hks[cells] .mslot{display:none}',
    '.hks[cells] .mprog{grid-area:sub}.hks[cells] .mvol{grid-area:meta;margin:0}',
    '.hks[cells] .mbtn{justify-self:center;align-self:center;z-index:2}',
    // (the ends' areas keep their old names as places: spk the left end, brw the right -- Browse and Up Next since 2026-11-09)
    '.hks[cells] [data-act=brw]{grid-area:spk}.hks[cells] [data-act=prev]{grid-area:prev}.hks[cells] [data-act=pp]{grid-area:play}',
    '.hks[cells] [data-act=next]{grid-area:next}.hks[cells] [data-act=stop]{grid-area:stop}.hks[cells] [data-act=queue]{grid-area:brw}',
    // THE SPEAKER LINE: the words at the size the host gives (the room's label had it), the touch area round them
    '.hksl{position:relative;display:inline-flex;align-items:center;gap:.35em;max-width:100%;min-width:0;box-sizing:border-box;margin:0;padding:0;',
    '  border:0;background:none;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;text-align:left;cursor:pointer;',
    '  -webkit-tap-highlight-color:transparent;vertical-align:top;transition:opacity .15s ease}',
    // (--hksl-dy moves the area down where the place's edge is near above the words)
    '.hksl::after{content:"";position:absolute;left:-6px;right:-6px;top:calc(50% - var(--hksl-h,44px) / 2 + var(--hksl-dy,0px));',
    '  bottom:calc(50% - var(--hksl-h,44px) / 2 - var(--hksl-dy,0px))}',
    '.hksl hk-icon{--mdc-icon-size:1em;width:1em;height:1em;flex:none;display:flex;color:inherit}',
    '.hksl-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hksl-t b{font-weight:inherit}.hksl-t i{font-style:normal;font-weight:400;opacity:.72}',
    '.hksl-c{flex:none;width:.85em;height:.85em;fill:currentColor;opacity:.72;transition:transform .2s ease}',
    '.hksl.on .hksl-c{transform:rotate(180deg)}',
    '.hksl:active{opacity:.6}',
    '.hksl.dis{pointer-events:none}.hksl.dis .hksl-c{display:none}',
    '@media (prefers-reduced-motion:reduce){.hks .mbtn,.hks .mvt b,.hksl,.hksl-c{transition:none}}'
  ].join('\n');

  function strip(root) { return !root ? null : root.classList && root.classList.contains('hks') ? root : root.querySelector('.hks'); }
  function attr(el, k, on) { if (!el) return; if (on) { if (!el.hasAttribute(k)) el.setAttribute(k, ''); } else if (el.hasAttribute(k)) el.removeAttribute(k); }

  // PLAY / PAUSE SAYS WHAT IT WILL DO: pause while it plays, play otherwise -- the glyph and the label
  function play(root, playing) {
    // (root: the play / pause button, or the strip that holds it)
    var b = root && root.classList && root.classList.contains('hks') ? root.querySelector('.mpp') : root, p = b && b.querySelector('path');
    if (!b || !p) return;
    var d = playing ? ICON.pause : ICON.play, label = playing ? 'Pause' : 'Play';
    if (p.getAttribute('d') !== d) p.setAttribute('d', d);
    if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
  }
  // the drawn progress: how far (0..1, or null for none) and the two times
  function progress(root, at, t0, t1) {
    var s = strip(root), bar = s && s.querySelector('.mbar i'), times = s ? s.querySelectorAll('.mtimes span') : [];
    if (bar) { var tf = 'scaleX(' + (at == null ? 0 : Math.max(0, Math.min(1, at))).toFixed(4) + ')'; if (bar.style.transform !== tf) bar.style.transform = tf; }
    if (times[0] && times[0].textContent !== (t0 || '')) times[0].textContent = t0 || '';
    if (times[1] && times[1].textContent !== (t1 || '')) times[1].textContent = t1 || '';
  }
  // the drawn volume (0..1), or none (the row keeps its place, unseen)
  function volume(root, v) {
    var s = strip(root), t = s && s.querySelector('.mvt');
    attr(s, 'novol', v == null);
    if (t && v != null) { var vv = Math.max(0, Math.min(1, v)).toFixed(3); if (t.style.getPropertyValue('--v') !== vv) t.style.setProperty('--v', vv); }
  }

  // WHAT IS SHOWN, and each control's hit area: its own box, nothing past it
  function shown(e) {
    var r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    for (var n = e; n && n.nodeType === 1; n = n.parentNode && n.parentNode.nodeType === 11 ? /** @type {any} */ (n.parentNode).host : n.parentNode) {
      var cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return null;
      if (n.classList && n.classList.contains('hks')) break;
    }
    return r;
  }
  // (a control's touch area: its box, out to a transparent ::after's insets -- the speaker line's)
  function touch(e, r) {
    var a = getComputedStyle(e, '::after');
    if (!a || a.content === 'none' || a.content === 'normal' || a.position !== 'absolute') return r;
    // (its insets are the element's own px: on a page drawn scaled -- a Home Grid block -- the screen's are fewer)
    var z = e.offsetWidth ? r.width / e.offsetWidth : 1, f = function (k) { var n = parseFloat(a[k]); return isFinite(n) ? n * z : 0; };
    return { left: Math.min(r.left, r.left + f('left')), right: Math.max(r.right, r.right - f('right')),
             top: Math.min(r.top, r.top + f('top')), bottom: Math.max(r.bottom, r.bottom - f('bottom')),
             get width() { return this.right - this.left; }, get height() { return this.bottom - this.top; } };
  }
  // every control in root (the strip, or a whole view: its speaker line and list rows too) and its touch area
  function hits(root) {
    var s = root && root.querySelectorAll ? root : null, out = [];
    if (!s) return out;
    Array.prototype.forEach.call(s.querySelectorAll('[data-act]'), function (e) {
      var r = shown(e);
      if (r) out.push({ act: e.getAttribute('data-act'), el: e, rect: touch(e, r) });
    });
    return out;
  }
  // (the screensaver finds a tap by its place: the control whose box holds it)
  function hitAt(root, x, y) {
    var hs = hits(root);
    for (var i = 0; i < hs.length; i++) {
      var r = hs[i].rect;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return hs[i];
    }
    return null;
  }

  // THE RULES, MEASURED (the player checks run this on each strip they draw): o.min the least target in the strip's own
  // px (44; a block 56), o.scale what the strip is drawn at (a Home Grid block's), o.clear 12. Returns the numbers and
  // what breaks: [] when the strip keeps them all.
  function check(root, o) {
    o = o || {};
    var s = strip(root), k = o.scale || 1, min = o.min || 44, clear = o.clear == null ? 12 : o.clear;
    var out = { targets: {}, gapTV: null, gapPT: null, gapB: null, gapL: null, breaks: [] };
    if (!s) { out.breaks.push('no strip'); return out; }
    // (o.line: the player's speaker line -- a control too, its touch area measured with the strip's)
    var ln = o.line && shown(o.line), hs = hits(s).concat(ln ? [{ act: 'line', el: o.line, rect: touch(o.line, ln) }] : []), px = function (n) { return Math.round(n / k * 10) / 10; };
    var gap = function (a, b) {
      var gx = Math.max(b.left - a.right, a.left - b.right), gy = Math.max(b.top - a.bottom, a.top - b.bottom);
      return px(gx > 0 && gy > 0 ? Math.hypot(gx, gy) : Math.max(gx, gy));
    };
    var transport = hs.filter(function (h) { return h.act === 'prev' || h.act === 'pp' || h.act === 'next' || h.act === 'stop'; });
    var vol = hs.filter(function (h) { return h.act === 'vol'; })[0];
    hs.forEach(function (h) {
      var w = px(h.rect.width), ht = px(h.rect.height);
      out.targets[h.act] = [w, ht];
      if (Math.min(w, ht) < min - 0.5) out.breaks.push(h.act + ' is ' + w + 'x' + ht + ' (under ' + min + ')');
    });
    for (var i = 0; i < hs.length; i++) for (var j = i + 1; j < hs.length; j++) {
      if (hs[i].el.contains(hs[j].el) || hs[j].el.contains(hs[i].el)) continue;
      var g = gap(hs[i].rect, hs[j].rect);
      if (g < 0) out.breaks.push(hs[i].act + ' and ' + hs[j].act + ' overlap');
      else if (out.gapB === null || g < out.gapB) out.gapB = g;
    }
    var pp = hs.filter(function (h) { return h.act === 'pp'; })[0];
    if (pp) hs.forEach(function (h) {
      if (h !== pp && h.act !== 'vol' && h.act !== 'line' && h.rect.width * h.rect.height > pp.rect.width * pp.rect.height + 1) out.breaks.push(h.act + ' bigger than play / pause');
    });
    if (vol) transport.forEach(function (t) {
      var g = gap(t.rect, vol.rect);
      if (out.gapTV === null || g < out.gapTV) out.gapTV = g;
    });
    if (out.gapTV !== null && out.gapTV < clear - 0.5) out.breaks.push('transport to volume ' + out.gapTV + ' px (under ' + clear + ')');
    var L = hs.filter(function (h) { return h.act === 'line'; })[0];
    if (o.line && !L) out.breaks.push('no speaker line shown');
    if (L) hs.forEach(function (h) {
      if (h === L) return;
      var g = gap(L.rect, h.rect);
      if (out.gapL === null || g < out.gapL) out.gapL = g;
    });
    if (out.gapL !== null && out.gapL < clear - 0.5) out.breaks.push('speaker line to a control ' + out.gapL + ' px (under ' + clear + ')');
    // (the progress: its bar, with the times that hang under it)
    var pr = s.querySelector('.mprog'), prr = pr && shown(pr);
    if (prr) {
      var box = { left: prr.left, top: prr.top, right: prr.right, bottom: prr.bottom };
      Array.prototype.forEach.call(pr.querySelectorAll('.mtimes span'), function (e) {
        var r = e.getBoundingClientRect();
        if (r.height && e.textContent) box.bottom = Math.max(box.bottom, r.bottom);
      });
      transport.forEach(function (t) {
        var g = gap(box, t.rect);
        if (out.gapPT === null || g < out.gapPT) out.gapPT = g;
      });
      if (out.gapPT !== null && out.gapPT < clear - 0.5) out.breaks.push('progress to transport ' + out.gapPT + ' px (under ' + clear + ')');
    }
    return out;
  }

  global.hkNpStrip = { ICON: ICON, svg: svg, html: html, lineHtml: lineHtml, line: line, rooms: rooms, CSS: CSS, strip: strip, attr: attr, play: play, progress: progress,
                       volume: volume, hits: hits, hitAt: hitAt, check: check };
})(globalThis);
