// hk-detail-frame.js - the sheet's sizes, CSS and looks, and the notification strip.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-detail-frame'] = function (K) {
    var accIcon = K.accIcon, C = K.C, domainOf = K.domainOf, noteEl = K.noteEl;

    // ------------------------------------------------------------ the sheet
    // Widths on a tablet. On a phone every sheet is the screen less 16 px a
    // side (CSS below), whatever its kind.
    // TWO WIDTHS AND ONE HEIGHT: every sheet is STD wide except the two that
    // lay out in two columns, and every sheet is SHEET_H tall -- the X and the
    // name land in the same place whatever opens. The keys stay per kind so a
    // kind can move.
    var STD = 460, WIDE = 820, SHEET_H = 680;
    // A SHORT SCREEN: wider than a phone, under 500 px tall, held sideways
    var SHORT_MQ = '(orientation:landscape) and (max-height:500px) and (min-width:' + (C.BP.phone + 1) + 'px)';
    // ONE SPACING SCALE for every sheet (2026-10-12: gaps intentional, things
    // aligned). 20 between regions -- the header and the body, two columns,
    // a notification and the sheet under it; 20 (a phone 16) between a
    // control sheet's big pieces -- the control, the state, what's under
    // it; 12 between blocks in a column and between buttons side by side;
    // 6 from a title to its line. Cards: radius 20, padding 16 18 14 (a
    // card of rows alone 14 18); text outside a card on the card text's
    // edge, 18 in.
    // (hkCards.SP, hk-base.js: one of the three spacing tiers)
    var SP = C.SP;
    // Full-height light and shade controls share a silhouette. Color lights
    // keep the shorter slider that leaves room for swatches and effects.
    var SLIDER_H = { full: 400, phone: 330 };
    // ONE PHONE HEIGHT TOO, the speaker's, so every sheet is the same size.
    // The whole screen less 80 -- which only the stacked thermostat needs --
    // would leave every other phone sheet in 200-350 px of empty space.
    // 643 = the playing speaker's panel (548, Browse Music the last row) +
    // the header, gap, padding and border (94) + 1: the tallest sheet that
    // does not scroll. Measured with offsetHeight -- a sheet caught mid-open
    // is scaled 0.98 and its rect reads 2% short. The thermostat (668) and
    // the water heater (644) scroll inside theirs; a shorter screen still
    // takes screen - 80 and scrolls more of them.
    var PHONE_H = 643;
    var WIDTH = {
      light: STD, light_colour: STD, toggle: STD, fan: STD, cover: STD,
      cover_buttons: STD, lock: STD, climate: WIDE, media: STD, media_tv: STD, tv: WIDE,
      sensor: WIDE, state: STD, binary: STD, vacuum: STD, vacuum_rooms: WIDE, control: STD, laundry: WIDE,
      // the water heater is the thermostat's sheet: its ring, its size, its
      // two columns -- the two are the same, and the same size
      number: STD, select: STD, humidifier: STD, water_heater: WIDE, alarm: STD,
      // a person (them | where they are) and an event (it | its day): two
      // columns on a tablet, one on a phone
      person: WIDE, event: WIDE, weather: WIDE, automation: STD, timer: STD,
      // HK's generic sheet (Phase 2 P2.5): a state, a few lines, at most a button
      generic: STD,
      // a room's "3 Windows": two full pills a row (2 x 196 + 10 of its ~410)
      group: STD, group_wide: WIDE,
      // a custom pop-up's own cards: narrow or wide, as it asks
      cards: STD, cards_wide: WIDE,
      // a camera: the camera pop-ups' 1200 (16:9 -> 675 of picture);
      // the height is the picture's (hkAutoHeight), never past the screen
      camera: 1200
    };
    var AUTO_CLOSE_MS = 60000;

    var SHEET_CSS = [
      // it takes focus on opening (the keyboard's place to start), with no ring
      '.sheet:focus{outline:none}',
      '.hkd{position:fixed;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;',
      '  pointer-events:none;-webkit-tap-highlight-color:transparent;color:' + window.hkCards.v('ink') + ';',
      // the dashboard's font: the sheet is mounted outside the view
      '  ' + window.hkCards.FONT_ROOT + ';',
      // CENTRED ON THE DASHBOARD, past Home Assistant's sidebar (hk-menu.js
      // publishes where the dashboard starts) -- a docked menu is part of the
      // dashboard, so the sheet centres over it too. The backdrop, inset 0,
      // still covers everything.
      // ...and clear of a side safe area (the iPhone Duo's strip, a phone
      // turned: hk-base.js SAFE, 2026-10-30)
      '  box-sizing:border-box;padding-left:max(var(--hk-content-left,0px), var(--hk-safe-left,env(safe-area-inset-left,0px)));padding-right:var(--hk-safe-right,env(safe-area-inset-right,0px))}',
      // A CARD IN THE SHEET wears the look's plate for a sheet (M.bg), when
      // the look has one: Tinted's dark plate on this dark sheet is a hole
      '.hkd{--hk-plate-here:var(--hk-glass-plate-sheet)}',
      '.hkd .bd{position:absolute;inset:0;background:rgba(17,17,17,0.34);opacity:0;',
      '  transition:opacity .3s ease;pointer-events:auto}',
      '.hkd.open .bd{opacity:1}',
      // THE CAPS ARE THE SCREEN LESS 16 px A SIDE. On the car the document is
      // zoomed (tesla-viewport.js, <html> at ~0.67), and a viewport unit is
      // zoomed with it: 100dvh capped the thermostat at 406 of 638 px. That
      // script sets --hk-vw / --hk-vh in layout px on a zoomed car dashboard
      // only; everywhere else they are unset and the viewport units stand.
      // ONE HEIGHT: SHEET_H on a tablet, the screen less 40 px top and bottom
      // on a phone (below) -- and never past the screen less 16 a side, which
      // is where a short window (the car, a phone on its side) scrolls.
      '.hkd .sheet{position:relative;box-sizing:border-box;pointer-events:auto;',
      '  width:var(--hkd-w,' + STD +
        'px);max-width:calc(var(--hk-vw, 100vw) - max(var(--hk-content-left, 0px), var(--hk-safe-left,env(safe-area-inset-left,0px))) - var(--hk-safe-right,env(safe-area-inset-right,0px)) - 32px);',
      '  height:' + SHEET_H + 'px;max-height:calc(var(--hk-vh, 100dvh) - 32px);',
      '  display:flex;flex-direction:column;gap:20px;padding:24px;border-radius:38px;',
      // THE COLOUR COMES THROUGH: a light tint over a saturated blur, so the
      // sky and the pills behind tint the sheet the way the Home app's cards
      // are tinted. A look may wear its own (--hk-sheet-*: Bright Glass's
      // white .22 over blur(34px) saturate(2) and its rim, 2026-10-30).
      '  background:var(--hk-sheet-plate,rgba(28,28,32,0.52));-webkit-backdrop-filter:var(--hk-sheet-backdrop,blur(34px) saturate(1.9));',
      '  backdrop-filter:var(--hk-sheet-backdrop,blur(34px) saturate(1.9));border:var(--hk-sheet-edge,1px solid rgba(255,255,255,0.12));',
      '  box-shadow:var(--hk-sheet-shadow,0 26px 64px rgba(0,0,0,0.55));overflow:hidden;',
      '  opacity:0;transform:translateY(24px) scale(.98);',
      '  transition:opacity .25s ease,transform .3s cubic-bezier(.32,.72,0,1)}',
      '.hkd.open .sheet{opacity:1;transform:none}',
      // One clip edge for the scroller AND its shadow. A sticky pseudo inside
      // the padded body sat 8 px below that edge, letting content show above
      // it. The frame needs no measured top and stays aligned at Safari zoom.
      '.hkd .body-frame{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      // no shadows at its ends: a list is cut clean (hk-base.js SCROLL EDGES)
      // THE HEADER IS EXACTLY AS TALL AS THE X (44, a phone 40), so the X --
      // centred on the row -- sits the sheet's padding from the top AND from
      // the right. It is the glyph and the NAME, centred together: room, state
      // and speed are all in the sheet itself.
      '.hkd .hd{display:flex;align-items:center;gap:14px;flex-shrink:0;height:44px}',
      '.hkd .well{width:44px;height:44px;border-radius:22px;flex-shrink:0;display:flex;',
      '  align-items:center;justify-content:center;background:rgba(255,255,255,0.12);transition:background .2s}',
      '.hkd .well hk-state-icon{--mdc-icon-size:24px;width:24px;height:24px;display:flex}',
      '.hkd .tx{flex-grow:1;min-width:0}',
      '.hkd .tt{font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:24px;',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // THE X IS THE SAME SIZE AS THE WELL, so centring it on the header row
      // puts it exactly as far from the top as from the right (the sheet's
      // padding either way) -- the rule the alarm pop-up's X broke.
      '.hkd .x{width:44px;height:44px;border-radius:22px;border:0;padding:0;flex-shrink:0;',
      '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
      '  background:rgba(255,255,255,0.14);color:rgba(255,255,255,0.92);--mdc-icon-size:20px}',
      '.hkd .x:active{background:rgba(255,255,255,0.26)}',
      '.hkd .body{flex-grow:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
      '  -webkit-overflow-scrolling:touch;scrollbar-width:none;display:flex;flex-direction:column}',
      '.hkd .body::-webkit-scrollbar{display:none}',
      // ...RIGHT UP TO THE HEADER: the body takes back the sheet's gap above
      // it as padding, so what scrolls slides under the name (the shadow at
      // its foot, shadeCss) instead of being cut off a gap below it. At rest
      // nothing moves. (A bare sheet's header floats: it has no gap to take.)
      // ...but not right against the glyph and the X (2026-10-12: the line
      // touched them): 12 px of the gap stay clear above where it scrolls
      '.hkd .sheet:not(.bare) .body-frame{margin-top:-8px}',
      '.hkd .sheet:not(.bare) .body{padding-top:8px}',
      // THE CONTROL SITS IN THE MIDDLE of what the header leaves. Auto
      // margins, not justify-content:center: when a short window makes the
      // content taller than the body, auto margins fall to zero and the body
      // scrolls from the top; centring would cut the top off unreachably.
      '.hkd .body > *{margin-block:auto}',
      // a panel that FILLS the body instead (a pick list) -- see hkFill
      '.hkd .body > .fill{margin-block:0;flex-grow:1;min-height:0;display:flex;flex-direction:column}',
      // A BARE SHEET (the camera): a camera pop-up, not a control sheet --
      // the picture to every edge, the pop-ups' 30 px corners, no header, the
      // X floating over the picture as the pop-ups' is (rgba(28,28,30,.62),
      // as far from the top as from the right, 18). As wide as --hkd-w, or narrower
      // when the screen is too short for the picture at that width (--hkd-ar
      // is its shape), so there are never bars beside it. Specific enough to
      // win over the phone rules below.
      // opaque: the picture fills it, so the sheet's frost is work nobody sees
      // -- a 34 px blur of everything behind a 1200x675 box, re-run whenever
      // the strip's live tile or the sky moves under it
      '.hkd .sheet.bare{padding:0;gap:0;border-radius:30px;height:auto;background:#0b0d12;',
      '  -webkit-backdrop-filter:none;backdrop-filter:none;',
      '  width:min(var(--hkd-w,1200px), calc((var(--hk-vh, 100dvh) - 32px - var(--hkd-strip, 0px)) * var(--hkd-ar, 1.7778)))}',
      '.hkd .sheet.bare .hd{position:absolute;top:18px;right:18px;z-index:3;height:auto}',
      '.hkd .sheet.bare .well,.hkd .sheet.bare .tx{display:none}',
      // (white on it in every look: Flat's ink glyph vanished on the dark
      // plate, the user 2026-10-17)
      '.hkd .sheet.bare .x{background:rgba(28,28,30,0.62);color:#fff}',
      '.hkd .sheet.bare .body{overflow:hidden}',
      // ...and the pop-ups' dim (hk-popup.js, rgba(17,17,17,.8)): a control
      // sheet's lighter one lets the sky tint its glass; a picture has none.
      '.hkd.bare .bd{background:rgba(17,17,17,0.8)}',
      '@media (max-width:' + C.BP.phone + 'px){',
      '  .hkd .sheet{width:calc(var(--hk-vw, 100vw) - var(--hk-safe-left,env(safe-area-inset-left,0px)) - var(--hk-safe-right,env(safe-area-inset-right,0px)) - 32px);padding:18px;gap:16px;' +
        'border-radius:30px;',
      // (20 above and below on a small phone -- an iPhone SE's 667 -- where 40 left a media sheet's last row under its foot)
      '    height:min(' + PHONE_H + 'px, calc(var(--hk-vh, 100dvh) - 40px))}',
      '}',
      // (a phone's header, glyph, X and title -- a short screen's too)
      '@media (max-width:' + C.BP.phone + 'px),' + SHORT_MQ + '{',
      '  .hkd .well,.hkd .x{width:40px;height:40px;border-radius:20px}',
      '  .hkd .hd{height:40px;gap:12px}',
      '  .hkd .sheet:not(.bare) .body-frame{margin-top:-6px}',
      '  .hkd .sheet:not(.bare) .body{padding-top:6px}',
      '  .hkd .tt{font-size:20px;line-height:22px}',
      '}',
      // A SHORT SCREEN (2026-10-24: a phone on its side, 844 x 390; the
      // car's): the sheet is the screen's height less 12 px a side, wide
      // enough for two columns -- the control on the left at the body's
      // full height, what it reads and its buttons beside it (PANEL_CSS
      // SHORT) -- with a phone's header and corners. HAS_SHORT is the one
      // test, here and in the panels.
      '@media ' + SHORT_MQ + '{',
      '  .hkd .sheet{width:calc(var(--hkd-w,' + STD + 'px) + 120px);height:calc(var(--hk-vh, 100dvh) - 24px);max-height:calc(var(--hk-vh, 100dvh) - 24px);',
      '    padding:16px;gap:12px;border-radius:30px}',
      '  .hkd .sheet:has(hk-detail-media){width:min(760px, calc(var(--hk-vw, 100vw) - max(var(--hk-content-left, 0px), var(--hk-safe-left,env(safe-area-inset-left,0px))) - ' +
        'var(--hk-safe-right,env(safe-area-inset-right,0px)) - 32px))}',
      '}',
      '@media (prefers-reduced-motion:reduce){.hkd .bd,.hkd .sheet,.hkd .body-frame::before,.hkd .body-frame::after{transition:none}}'
    ].join('');

    // Recalculate the footer when content or the viewport changes as well
    // as on scroll. The settings pane and forecasts can grow after opening.
    // No per-frame work; observers/listeners belong to this sheet's lifetime.
    function sheetEdges(body, sheet) {
      var offTop = C.shade(body, sheet), ro, mo;
      function check() {
        var more = body.scrollHeight - body.clientHeight - body.scrollTop > 2;
        if (more === sheet.hasAttribute('hk-scroll-more')) return;
        if (more) sheet.setAttribute('hk-scroll-more', ''); else sheet.removeAttribute('hk-scroll-more');
      }
      function observe() {
        if (ro) {
          ro.disconnect(); ro.observe(body);
          Array.prototype.forEach.call(body.children, function (child) {
            ro.observe(child);
            if (child._root && child._root.nodeType === 1) ro.observe(child._root);
          });
        }
        check();
      }
      body.addEventListener('scroll', check, { passive: true });
      if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(check);
      if (typeof MutationObserver !== 'undefined') { mo = new MutationObserver(observe); mo.observe(body, { childList: true }); }
      observe();
      return function () { offTop(); body.removeEventListener('scroll', check); if (ro) ro.disconnect(); if (mo) mo.disconnect(); };
    }

    // A NOTIFICATION, OPENED (hk-notify.js -> open(id, null, { note })): it
    // rides on the sheet a tile opens, and the sheet keeps its size.
    //   tablet, a one-column sheet: the sheet is WIDE and the notification
    //     is its left column (340 -- the sheet's own 410 stays on the right)
    //   a two-column sheet (a person, an event, the thermostat): the card
    //     at the top of its left column (the panel places it: hkNote), else
    //     at the top of the body
    //   phone: the card first in the sheet's own scroll
    //   the camera (a bare sheet): over the picture's top on a tablet,
    //     under the picture on a phone
    var NOTE_CSS = [
      '.hkd .body.n2{flex-direction:row;gap:' + SP.region + 'px;align-items:stretch}',
      '.hkd .body.n2 > *{margin-block:0}',
      '.hkd .body.n2 > :not(.hkn-col){flex:1;min-width:0;align-self:center}',
      '.hkd .body.n2 > .fill{align-self:stretch}',
      '.hkn-col{width:340px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;',
      '  text-align:center;border-radius:' + SP.cardR + 'px;background:rgba(255,255,255,0.08);padding:24px ' + SP.inset + 'px;box-sizing:border-box}',
      '.hkn-col .hero{width:96px;height:96px;border-radius:48px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.hkn-col .hero hk-icon{--mdc-icon-size:48px;color:#fff;display:flex}',
      '.hkn-col .pic{width:100%;aspect-ratio:16/9;border-radius:12px;object-fit:cover;flex:none;background:rgba(255,255,255,0.06);cursor:pointer}',
      '.hkn-col .imp{margin-top:20px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#ff453a}',
      '.hkn-col .what{margin-top:20px;font-size:22px;font-weight:700;letter-spacing:-0.35px;line-height:26px;overflow-wrap:anywhere}',
      '.hkn-col .imp + .what{margin-top:' + SP.line + 'px}',
      '.hkn-col .msg,.hkn-col .when{margin-top:' + SP.line + 'px;font-size:15px;line-height:20px;color:' + window.hkCards.v('ink-2') + '}',
      '.hkn-col .msg{color:' + window.hkCards.v('ink') + '}',
      '.hkn-col .acts{align-self:stretch;display:flex;flex-direction:column;gap:' + SP.block + 'px;margin-top:24px}',
      '.hkn-b{height:50px;border-radius:25px;border:0;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 18px;',
      '  white-space:nowrap;background:rgba(255,255,255,0.14);color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer;',
      '  -webkit-tap-highlight-color:transparent;min-width:0}',
      '.hkn-b:active{background:rgba(255,255,255,0.24)}',
      '.hkn-b hk-icon{--mdc-icon-size:20px;display:flex;flex:none}',
      '.hkn-b span{overflow:hidden;text-overflow:ellipsis}',
      '.hkn-b .chev{opacity:.5;font-size:19px;margin-left:-2px;flex:none}',
      '.hkn-b.on{background:rgba(255,255,255,0.92);color:rgba(0,0,0,0.85)}',
      // the card: 14 all round, the glyph and the buttons on one left edge
      '.hkn-card{display:flex;flex-direction:column;gap:' + SP.block + 'px;padding:14px;border-radius:' + SP.cardR + 'px;',
      '  background:rgba(255,255,255,0.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.08);flex-shrink:0;color:' + window.hkCards.v('ink') + ';box-sizing:border-box;text-align:left}',
      '.hkd .body > .hkn-card{margin:0 0 ' + SP.region + 'px}',
      '.hkn-card .r1{display:flex;align-items:center;gap:12px}',
      '.hkn-card .r2{display:flex;gap:' + SP.block + 'px}',
      '.hkn-card .r2 .hkn-b{flex:1;height:40px;border-radius:20px;font-size:14px;padding:0 12px;gap:6px}',
      '.hkn-card .r2 .hkn-b hk-icon{--mdc-icon-size:18px}',
      '.hkn-card .ni{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none}',
      '.hkn-card .ni hk-icon{--mdc-icon-size:19px;color:#fff;display:flex}',
      '.hkn-card .nt{flex:1;min-width:0}',
      '.hkn-card .n1{font-size:15px;font-weight:650;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hkn-card .n2{font-size:13px;line-height:18px;color:' + window.hkCards.v('ink-2') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.hkn-card .imp{color:#ff453a;font-weight:700}',
      '.hkn-card img{width:58px;height:40px;border-radius:8px;object-fit:cover;flex:none;cursor:pointer;background:rgba(255,255,255,0.06)}',
      // over the camera's picture (a tablet), its top left -- the foot has
      // the camera's own controls: dark, not a second blur (one blur layer
      // per sheet, the sheet's own)
      '.hkn-card.over{position:absolute;left:' + SP.region + 'px;top:' + SP.region + 'px;width:420px;max-width:calc(100% - 40px);z-index:3;',
      '  background:rgba(24,24,28,0.93)}',
      '.hkn-card.under{margin:' + SP.block + 'px}',
      // a phone: the words alone, a little smaller ("Doors & Windows ›" fits)
      '@media (max-width:' + C.BP.phone + 'px){.hkn-card .r2 .hkn-b hk-icon{display:none}.hkn-card .r2 .hkn-b{font-size:13px;padding:0 10px}}'
    ].join('');

    function haRoot() {
      return window.hkShell.overlayRoot() || document.body;
    }

    // THE ROOM: the media sheet's "Playing on · Living Room" (a pill can be
    // named for a shortcut like "Apple Music", not for where it plays).
    function roomOf(h, id) {
      var e = h && h.entities && h.entities[id];
      if (!e) return '';
      var area = e.area_id;
      if (!area && e.device_id && h.devices && h.devices[e.device_id]) area = h.devices[e.device_id].area_id;
      var a = area && h.areas && h.areas[area];
      return a ? a.name : '';
    }

    // A NEAR-WHITE WELL TAKES A DARK GLYPH. The well is the pill's colour
    // while the thing is on, and a pill can be coloured near-white (the
    // speakers are rgba(255,255,255,0.85)): a white glyph on it vanishes.
    // Near-white = every channel bright, so yellow and mint keep white.
    function nearWhite(c) {
      var t = String(c || '').trim(), rgb = null, m;
      if ((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t))) {
        var x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
        rgb = [0, 2, 4].map(function (i) { return parseInt(x.substr(i, 2), 16); });
      } else if ((m = /^rgba?\(([^)]+)\)$/i.exec(t))) {
        rgb = m[1].split(',').slice(0, 3).map(parseFloat);
      }
      return !!rgb && rgb.length === 3 && Math.min.apply(null, rgb) >= 200;
    }

    // THE HEADER'S GLYPH IS THE ENTITY'S OWN GLYPH: the header icons and the
    // pop-ups' icons match the entity's icons, and the mdi icons are only the
    // fallback. In order:
    //   1. the card it was opened from -- its `icon`, and `icon_states` by
    //      state, exactly as that tile draws it;
    //   2. opened from anywhere else (a chip, a room's status row, #alarm, a
    //      link in another sheet): THIS dashboard's own card for the entity,
    //      the first that names an hk: glyph;
    //   3. the entity's own icon, as its SF Symbol when the glyph set has one
    //      of the same name (mdi:fan -> hk:fan, as the menu does);
    //   4. and only then Home Assistant's own icon for it.
    // The colour follows the same card (icon_color), so the header matches
    // the pill it stands for.
    var LOOKS = typeof WeakMap === 'function' ? new WeakMap() : null;
    function lookOf(id) {
      var cfg = C.menu && typeof C.menu.config === 'function' ? C.menu.config() : null;
      if (!cfg || !id || !LOOKS) return null;
      var map = LOOKS.get(cfg);
      if (!map) {
        map = {};
        (function walk(node, depth) {
          if (!node || typeof node !== 'object' || depth > 14) return;
          if (Array.isArray(node)) { node.forEach(function (n) { walk(n, depth + 1); }); return; }
          if (typeof node.entity === 'string' && typeof node.icon === 'string' && /^hk:/.test(node.icon) &&
              !map[node.entity]) {
            map[node.entity] = { icon: node.icon, icon_states: node.icon_states, icon_color: node.icon_color };
          }
          for (var k in node) {
            if (Object.prototype.hasOwnProperty.call(node, k) && node[k] && typeof node[k] === 'object') walk(node[k], depth + 1);
          }
        })(cfg.views, 0);
        LOOKS.set(cfg, map);
      }
      return map[id] || null;
    }
    // The card whose look the header takes: the one it was opened from when
    // that names a glyph, else the dashboard's card for the entity.
    function lookFor(src, id) {
      return (src && src.icon) ? src : (lookOf(id) || src || {});
    }
    function headIcon(look, s) {
      var m = look && look.icon_states, st = s && s.state;
      if (m && st != null) {
        // `on:` unquoted in YAML is the boolean true (hk-tile.js normalises
        // its own copy; a looked-up config is raw)
        var alias = st === 'on' ? 'true' : st === 'off' ? 'false' : null;
        if (m[st] != null) return m[st];
        if (alias && m[alias] != null) return m[alias];
      }
      if (look && look.icon) return look.icon;
      var acc = s && accIcon(s.entity_id);
      if (acc) return acc;
      var own = s && s.attributes && s.attributes.icon;
      var mm = /^mdi:(.+)$/.exec(String(own || ''));
      var g = window.hkGlyphs && window.hkGlyphs.icons;
      if (mm && g && g[mm[1]]) return 'hk:' + mm[1];
      return null;                          // Home Assistant's own, via stateObj
    }

    // Does this dashboard have a view at `path`? true / false, or null when
    // the config cannot be read.
    function hasView(path) {
      try {
        var conf = window.hkShell.dashboardConfig();
        var views = conf && conf.views;
        if (!views) return null;
        return views.some(function (x) { return x.path === path; });
      } catch (e) { return null; }
    }

    // ============================================================ NOTIFICATION
    // GO TO: the page the screen itself shows the accessory on -- the same
    // lists the generated pages are built from (hkStrategy.pageMembers) --
    // else its room's page, else nothing; a page this dashboard does not
    // have is skipped. A notification's own (its Go To: a page, or "none")
    // wins. A calendar's event: the Calendar page at that day.
    function viewOf(path) {
      try {
        var views = window.hkShell.dashboardConfig().views;
        for (var i = 0; i < views.length; i++) if (views[i].path === path) return views[i];
      } catch (e) { /* no dashboard */ }
      return null;
    }
    function areaOf(h, id) {
      var e = h && h.entities && h.entities[id];
      if (!e) return null;
      return e.area_id || (e.device_id && h.devices && h.devices[e.device_id] ? h.devices[e.device_id].area_id : null);
    }
    // (a door or window goes to Security where there is no Doors & Windows
    // page: the two are one page in a house with an alarm, 2026-10-16)
    var GO_PAGES = [['doors-windows', ['doors', 'windows']], ['security', ['security', 'locks', 'garage', 'doors', 'windows']],
                    ['water', ['leaks', 'valves']], ['lights', ['lights', 'outlets']]];
    var GO_DOMAINS = { vacuum: 'vacuums', camera: 'cameras', calendar: 'calendar', timer: 'timers' };
    function ymdOf(d) {
      return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }
    function goFor(h, n) {
      if (!n || n.go === 'none' || n.kind === 'people') return null;
      var dash = '/' + (String(location.pathname).split('/')[1] || '') + '/';
      var at_ = function (path, q) {
        var v = viewOf(path);
        return v ? { path: dash + path + (q || ''), title: v.title || path, icon: v.icon || 'mdi:arrow-right' } : null;
      };
      if (n.go) return at_(n.go);
      var id = n.entity || n.sheet;
      if (n.kind === 'calendar' || domainOf(id) === 'calendar') {
        var st = n.event && n.event.start ? new Date(String(n.event.start).length <= 10 ? n.event.start + 'T00:00:00' : n.event.start) : null;
        return at_('calendar', st && !isNaN(st) ? '?day=' + ymdOf(st) : '');
      }
      var S = window.hkStrategy, got = null;
      if (S && S.pageMembers && id) {
        GO_PAGES.some(function (g) {
          var m = null;
          try { m = S.pageMembers(h, g[0]); } catch (e) { m = null; }
          if (m && g[1].some(function (k) { return (m[k] || []).indexOf(id) >= 0; })) got = at_(g[0]);
          return !!got;
        });
      }
      if (!got && GO_DOMAINS[domainOf(id)]) got = at_(GO_DOMAINS[domainOf(id)]);
      if (!got && n.sheet && domainOf(n.sheet) === 'camera') got = at_('cameras');
      if (!got) {
        var M = window.hkCards && window.hkCards.menu, area = areaOf(h, id);
        var rp = M && area && M.roomPath ? M.roomPath(area) : null;
        var seg = rp ? rp.split('/').pop() : null;
        var v = seg ? viewOf(seg) : null;
        if (rp && v) got = { path: rp, title: v.title || (h.areas && h.areas[area] && h.areas[area].name) || seg, icon: v.icon || 'mdi:sofa' };
      }
      return got;
    }
    function noteClock(t) {
      try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
    }
    // "now · 8:42 PM", "5 min ago · 8:37 PM"
    function noteWhen(n) {
      var t = n.ts ? n.ts * 1000 : n._at;
      if (!t || isNaN(t)) return '';
      var m = Math.floor((Date.now() - t) / 60000);
      var rel = m < 1 ? 'now' : m < 60 ? m + ' min ago' : '';
      return (rel ? rel + ' · ' : '') + noteClock(t);
    }
    function muteLabel(until) { return until ? 'Muted until ' + noteClock(until * 1000) : 'Mute 1 Hour'; }
    // where the notification goes in an open sheet (see NOTE_CSS)
    function placeNote(h, el, sheet, panel, note, width) {
      var body = sheet.querySelector('.body');
      var phone = matchMedia('(max-width:' + C.BP.phone + 'px)').matches;
      if (panel.hkBare && panel.hkBare()) {
        if (phone) sheet.appendChild(noteEl(h, note, 'under'));
        else sheet.appendChild(noteEl(h, note, 'over'));
        return;
      }
      if (phone || width >= WIDE) {
        var card = noteEl(h, note, 'card');
        if (!phone && panel.hkNote) panel.hkNote(card);
        else { body.insertBefore(card, body.firstChild); body.style.justifyContent = 'flex-start'; }
        return;
      }
      sheet.style.setProperty('--hkd-w', WIDE + 'px');
      body.classList.add('n2');
      body.insertBefore(noteEl(h, note, 'col'), body.firstChild);
    }
    function ours(d) {
      return !!(d && d.tok && history.state && history.state.hkTok === d.tok);
    }

    // what the shell and the later parts use of this one
    K.areaOf = areaOf; K.AUTO_CLOSE_MS = AUTO_CLOSE_MS; K.goFor = goFor; K.haRoot = haRoot; K.hasView = hasView;
    K.headIcon = headIcon; K.lookFor = lookFor; K.lookOf = lookOf; K.muteLabel = muteLabel; K.nearWhite = nearWhite;
    K.NOTE_CSS = NOTE_CSS; K.noteWhen = noteWhen; K.ours = ours; K.PHONE_H = PHONE_H; K.placeNote = placeNote;
    K.roomOf = roomOf; K.SHEET_CSS = SHEET_CSS; K.SHEET_H = SHEET_H; K.sheetEdges = sheetEdges; K.SHORT_MQ = SHORT_MQ;
    K.SLIDER_H = SLIDER_H; K.SP = SP; K.STD = STD; K.WIDE = WIDE; K.WIDTH = WIDTH;
  };
})();
