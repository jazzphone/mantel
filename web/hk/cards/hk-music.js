// hk-music.js -- the Music page: Play Music and Browse Music on one page.
//
// hk-music-card (2026-10-11, the user's design from the mockups in
// hk_house/docs/mockups/music-page.html). One card, the whole page under its
// title bar:
//
//   LEFT     what plays, always there. At its top "Playing on <rooms>" (or
//            "Ready on", nothing playing) with Change; under it, when more
//            than one thing plays in the house, a card for each (the one this
//            page controls lit, the others' Switch hands the page to them);
//            then the art, the song, the progress, Speakers / previous /
//            play-pause / next / Queue, the volume and Up Next.
//   BACK     Speakers (and Change) turns what plays over to the panel the
//            screensaver has (modules/hk-saver-panel.js): Speakers -- what's
//            ticked is where it plays: the next pick, and Update moves what
//            plays there; Reset, Stop -- each room's Volume, and the Queue.
//            With nothing playing, Speakers picks where the next music plays.
//   RIGHT    Browse Music (hk-library-card, `layout: music`): search, Your
//            Playlists (the Play Music tiles, here), Discover, the Library --
//            everything it plays goes where the left side says.
//   ROOMS    on a desk-wide page, the Speakers panel in a column of its own
//            (Change points at it).
//
// One column on a phone: what plays, then Browse; the panel opens as a sheet.
//
// WHERE MUSIC GOES. Playing: what this page shows (hkMusic's answer, as every
// music card). Nothing playing: the rooms picked in Speakers, this screen's
// own room until then -- a per-screen choice, never written to the house
// (the Play Music picker's rule). A playlist is hk_frontend.music_play on those
// rooms; a library item is music_play_media on one player (a preset's group,
// or the one room), then music_transfer for the other rooms of an ad-hoc set.
(function () {
  'use strict';

  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-music] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
  if (window.hkMusicPage) return;
  var HkBase = C.HkBase, M = C.M, register = C.register, esc = C.esc;

  // MUSIC NOT ADDED (2026-10-12): one line saying so, instead of a page of empty rooms.
  // ONLY ON THE INTEGRATION'S OWN ANSWERS -- hkMusic.configured() is false
  // until hk_music/subscribe answers, and the settings feed's `added` is a
  // stored copy until it is live -- so a house WITH Music never sees it while
  // a page loads. (The same rule as hk-media.js's.)
  // (a place in Home Assistant's settings, as the host says it: hk-host-shell.js haPlace)
  function NO_MUSIC() { return 'Add the Music feature to play music here (' + window.hkShell.haPlace('Settings → Devices & services → HK Frontend → Add feature') + ').'; }
  function musicMissing() {
    var Mu = window.hkMusic, HS = window.hkSettings;
    if (!Mu || !Mu.configured || Mu.configured()) return false;
    return !!(HS && HS.live && !(C.added && C.added('music')));
  }
  function drawNoMusic(card) {
    card._root.innerHTML = '';
    var el = document.createElement('hk-plate');
    el.setAttribute('data-hk-role', 'no-music');
    el.style.cssText = 'display:block;padding:24px;box-sizing:border-box;border-radius:' + M.radius + ';' +
      M.glass + ';border:' + M.border + ';text-align:center;font-size:15px;line-height:1.4;' +
      'color:' + window.hkCards.v('ink-2') + '';
    el.textContent = NO_MUSIC();
    card._root.appendChild(el);
    card._built = false;
  }

  var ICON = {
    prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z', next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6z',
    play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
    pause: 'M7 5h3.2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm6.8 0H17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    vlo: 'M7 9v6h4l5 5V4l-5 5H7z',
    vhi: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z',
    queue: 'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v5.2a2.5 2.5 0 1 0 2 2.3V12h2v-2h-4z',
    note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z'
  };
  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }
  function mmss(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  // the page's 16 px foot while a tab bar along the bottom shows, else 0
  var BAR_GAP = 'min(16px, var(--hk-tabbar-h, 0px))';
  var COLS3 = 1500, COLS2 = 760;          // the card's width for three / two columns
  var MIN_COL = 296;                       // the left column never narrower (its five buttons)
  var TICK = 1000, VOL_EVERY = 250, VOL_HOLD = 4000, TURN_MS = 620;
  // the cover's least size beside a long house list (.artbox's min-height:
  // more, and two cards no longer fit the Kitchen tablet); a capped list's
  // card pitch (.cx 52 + the gap 6) and how much of the next card it shows,
  // so it plainly scrolls -- a sliver of one read as a glitch
  var ART_MIN = 120, CX_PITCH = 58, CX_PEEK = 24;

  // ------------------------------------------------------------ pure (tests)
  // "Kitchen", "Kitchen and Loft", "Kitchen, Loft and Office"
  function list(n) { return n.length <= 2 ? n.join(' and ') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; }
  // AS MANY ROOM NAMES AS FIT ON ONE LINE, then "and N more" -- `width(s)`
  // measures a string in the line's own font
  // ...and when even one name and "and N more" does not, "Kitchen +4"
  function fitNames(names, room, width) {
    var txt = list(names);
    for (var k = names.length - 1; k >= 1 && width(txt) > room; k--) {
      txt = names.slice(0, k).join(', ') + ' and ' + (names.length - k) + ' more';
    }
    if (names.length > 1 && width(txt) > room) txt = names[0] + ' +' + (names.length - 1);
    return txt;
  }
  // WHERE A LIBRARY ITEM PLAYS, nothing playing: a preset's own group when
  // the rooms are exactly its rooms, the one room, or the first of an ad-hoc
  // set -- and the rooms to bring in after it (music_transfer)
  function playTarget(rooms, presets) {
    var same = function (a, b) { return a.length === b.length && a.every(function (r) { return b.indexOf(r) >= 0; }); };
    for (var i = 0; i < presets.length; i++) if (presets[i].entity && same(rooms, presets[i].members)) return { player: presets[i].entity, then: null };
    return { player: rooms[0] || null, then: rooms.length > 1 ? rooms.slice() : null };
  }
  // THE GROUP'S VOLUME (the room card's rule, hk-control.js): one room, the
  // room; an ad-hoc group, every member in one call; a preset's sync group,
  // the group then its rooms (the group scales them, the rooms level it)
  function volumeCalls(ctx, presets, level) {
    if (!ctx) return [];
    if (ctx.kind === 'preset') {
      var p = presets.filter(function (x) { return x.entity === ctx.key; })[0];
      var mem = (p && p.members) || ctx.members;
      return [{ entity_id: ctx.key, volume_level: level }, { entity_id: mem, volume_level: level }];
    }
    if (ctx.members.length > 1) return [{ entity_id: ctx.members.slice(), volume_level: level }];
    return [{ entity_id: ctx.key, volume_level: level }];
  }

  // (after the panel's own CSS: see _panelCss)
  var PANEL_PAGE_CSS = [
    // THE PANEL (the screensaver's, hk-saver-panel.js), turned over in place
    // of the left column -- glass here, as the page's other cards
    '.mpanel.pg{left:0;top:0;width:100%;height:100%;border-radius:26px;background:rgba(40,26,58,.55);border:' + M.border + ';',
    '  box-shadow:0 24px 60px rgba(0,0,0,.35);box-sizing:border-box}',
    '.mpanel.pg .mpbg,.mpanel.pg .mpshade{display:none}',
    '.mpanel.pg.back{transform:rotateY(180deg)}',
    // (its inside fills it, within its border: sized from the column, it ran
    // 2 px past it and the close button sat 1 px nearer the edge)
    '.mpanel.pg .mpin{width:100%!important;height:100%!important;zoom:1!important}',
    // (Reset and Update a little smaller in the column; Stop's square as the panel's)
    '.mpanel.pg .mpact,.mpanel.sheet .mpact{font-size:15px;gap:6px}',
    '.mpanel.pg .mpact svg,.mpanel.sheet .mpact svg{width:16px;height:16px}',
    '.mpanel.pg .mpact.stop svg,.mpanel.sheet .mpact.stop svg{width:18px;height:18px}',
    // ...the desk's rooms column: always open, Speakers and Volume as the
    // pop-up's tabs (the user's ask, 2026-10-14) -- no close button
    '.rooms .mpanel{display:block;position:absolute;inset:0}',
    '.rooms .mpx{display:none}',
    // ...and a panel of one tab (the desk's Queue, its Volume in the
    // column): that tab as its title
    '.mpanel.one .mptabs{background:none;border:0;padding:0}',
    '.mpanel.one .mptabs div.on{color:#fff;font-size:17px;padding:0 2px;justify-content:flex-start}',
    '.mpanel.one .mptabs div.on::before{display:none}',
    '.rooms.hl .mpanel{animation:muhl .9s ease}',
    '@keyframes muhl{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}40%{box-shadow:0 0 0 3px rgba(255,255,255,.7)}}',
    // ...and on a phone a sheet from the foot
    '.scrim{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:20;opacity:0;pointer-events:none;transition:opacity .3s}',
    '.scrim.on{opacity:1;pointer-events:auto}',
    '.mpanel.sheet{position:fixed;left:0;right:0;bottom:0;top:auto;height:min(640px,86vh);z-index:21;border-radius:28px 28px 0 0;',
    '  background:#22162f;box-shadow:0 -10px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.14);transform:translateY(100%);transition:transform .38s cubic-bezier(.32,.72,0,1)}',
    '.mpanel.sheet.in{transform:none}',
    '.mpanel.sheet .mpbg,.mpanel.sheet .mpshade{display:none}',
    ''
  ].join('');

  // PLAYS ON'S DROP-DOWN (2026-10-14): the Speakers panel (Speakers and
  // Volume, as the desk's column has them) under the button -- an opaque
  // plate of its own, the panel inside it as on the page (.pg)
  var PICK_CSS = [
    '.pkscrim{position:fixed;inset:0;z-index:24}',
    '.pk{position:absolute;z-index:25;width:380px;border-radius:26px;overflow:hidden;color:#fff;',
    '  background:rgba(36,24,52,.97);box-shadow:0 24px 60px rgba(0,0,0,.5);',
    '  transform-origin:top right;animation:pkin .22s cubic-bezier(.32,.72,0,1)}',
    '@keyframes pkin{from{opacity:0;transform:scale(.94) translateY(-6px)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.pk{animation:none}}'
  ].join('');

  // FLAT (2026-10-16): the Speakers panel -- the column, Plays on's drop-down
  // and the phone's sheet -- on the theme's own opaque surface, not the
  // screensaver's plum glass (it read as a purple slab on Light). Dark keeps
  // the panel's white-on-dark rules over raised gray; Light turns them over:
  // ink on the plate, the stone keys, a dark tick and a dark chosen chip.
  var FLAT_PANEL_CSS = (function () {
    var F = ':host([hk-flat]) ', L = ':host([hk-flat="light"]) ';
    return [
      F + '.pk,' + F + '.mpanel.pg,' + F + '.mpanel.sheet{background:var(--hk-flat-elevated);border:0;box-shadow:var(--hk-flat-elevated-shadow);animation:none}',
      F + '.mpin{text-shadow:none}',
      F + '.mpanel.one .mptabs div.on{color:var(--hk-ink)}',
      L + '.pk{color:var(--hk-ink)}',
      L + '.mptabs{background:var(--hk-key);border-color:transparent}',
      // (a panel of one tab -- the Queue -- has its tab as a title, no strip)
      L + '.mpanel.one .mptabs{background:none}',
      L + '.mptabs div{color:var(--hk-ink-2)}',
      L + '.mptabs div.on{color:var(--hk-ink)}',
      L + '.mptabs div.on::before{box-shadow:0 1px 3px rgba(28,26,22,.16)}',
      L + '.mpx{background:var(--hk-key);border-color:transparent}',
      L + '.mpx svg,' + L + '.mpsub svg{fill:var(--hk-ink-2)}',
      L + '.mpfoot,' + L + '.mpmini{border-top-color:var(--hk-line)}',
      L + '.mpchip{border-color:var(--hk-line-strong)}',
      L + '.mpchip.on{background:var(--hk-ink);color:var(--hk-flat-elevated)}',
      L + '.mpchip.clr{background:var(--hk-key)}',
      L + '.mproom{background:var(--hk-glass-plate)}',
      L + '.mproom.sel{background:var(--hk-key)}',
      L + '.mproom .ri{background:var(--hk-key-strong)}',
      L + '.mproom .ri hk-icon,' + L + '.mppill hk-icon{color:var(--hk-glyph)}',
      L + '.mproom .mpck{box-shadow:inset 0 0 0 2px var(--hk-line-strong)}',
      L + '.mproom.sel .mpck{background:var(--hk-ink)}',
      L + '.mproom.sel .mpck svg{fill:var(--hk-flat-elevated)}',
      L + '.mpeq i{background:var(--hk-ink)}',
      L + '.mpcap.err{color:var(--hk-warn)}',
      L + '.mpact.rst{background:var(--hk-key);box-shadow:none}',
      L + '.mpact.upd{background:var(--hk-ink);color:var(--hk-flat-elevated)}',
      L + '.mpact.stop{background:rgba(196,35,35,.12);color:var(--hk-fail)}',
      L + '.mpvrow{border-bottom-color:var(--hk-line)}',
      L + '.mpvs .tr{background:var(--hk-key-strong)}',
      L + '.mpvs .tr i{background:var(--hk-ink-2)}',
      L + '.mpvs .tr b{box-shadow:0 1px 4px rgba(28,26,22,.3)}',
      L + '.mppill{background:var(--hk-key)}',
      L + '.mppill.on{background:var(--hk-ink);color:var(--hk-flat-elevated)}',
      L + '.mppill.on hk-icon{color:var(--hk-flat-elevated)}',
      L + '.mpmini .ia,' + L + '.mpq .th{background-color:var(--hk-key)}',
      L + '.mpmini .b{background:var(--hk-key)}',
      L + '.mpmini .b svg{fill:var(--hk-ink)}',
      L + '.mpmini .b.pp{background:var(--hk-ink)}',
      L + '.mpmini .b.pp svg{fill:var(--hk-flat-elevated)}',
      L + '.mpq.now{background:var(--hk-key)}',
      L + '.mpq .th svg{fill:var(--hk-ink-3)}'
    ].join('');
  })();

  var CSS = [
    ':host{display:block}',
    'hk-plate{background:none;box-shadow:none;border:none;padding:0;position:relative}',
    // (its one row exactly the page's height below the title: an auto row
    // grew to everything Browse holds, so Browse never scrolled in itself --
    // a finger on it moved nothing; a wheel moved the whole page)
    '.mu{position:relative;display:grid;column-gap:36px;height:var(--mu-h,auto);color:' + window.hkCards.v('ink') + '}',
    '.mu:not([cols="1"]){grid-template-rows:minmax(0,1fr)}',
    // A TAB BAR ALONG THE BOTTOM (2026-10-14; _layout): the frame runs on
    // under it by the page's 16 px foot (BAR_GAP: 16 px with a bar, 0
    // without); Browse gets the bar's room at the end of its own scroll
    // (hk-library.js --hk-lib-foot) and scrolls behind it; Now Playing and
    // the Speakers column end above it, the 16 px foot clear of it; and the
    // card gives back what the view already pads for the bar, or the whole
    // page could be scrolled up by it
    '.mu:not([cols="1"]){margin-bottom:calc(0px - var(--hk-tabbar-h, 0px) - ' + BAR_GAP + ')}',
    '.mu:not([cols="1"]) .right{--hk-lib-foot:var(--hk-tabbar-h, 0px)}',
    '.mu:not([cols="1"]) .left,.mu[cols="3"] .rooms{margin-bottom:calc(var(--hk-tabbar-h, 0px) + ' + BAR_GAP + ')}',
    '.mu[cols="2"]{grid-template-columns:352px minmax(0,1fr)}',
    '.mu[cols="3"]{grid-template-columns:400px minmax(0,1fr) 380px;column-gap:48px}',
    '.mu[cols="1"]{grid-template-columns:minmax(0,1fr);row-gap:22px}',
    '.left{position:relative;min-height:0;display:flex;flex-direction:column;transform-style:preserve-3d}',
    '.left > .pon,.left > .house,.left > .front{-webkit-backface-visibility:hidden;backface-visibility:hidden}',
    // (while it turns nothing in it blurs what is behind it: a backdrop does
    // not follow a turn)
    '.left.turning *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}',
    '.right{min-width:0;min-height:0}',
    '.mu[cols="1"] .right{height:auto}',
    '.rooms{position:relative;min-height:0;display:none}',
    '.mu[cols="3"] .rooms{display:block}',
    // (a plate of its own, not the shared blur -- see _turn; the page behind
    // it is the blurred cover already)
    '.glass{background:' + M.bg + ';border:' + M.border + ';box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,0.10))}',
    // PLAYING ON: as tall as the search beside it and level with it; Change
    // a button inside it, inset 7 px and concentric with it (18 - 7 = 11)
    '.pon{flex:none;display:flex;align-items:center;gap:10px;height:50px;padding:0 7px 0 14px;border-radius:18px;margin-bottom:14px;box-sizing:border-box}',
    '.pon hk-icon{--mdc-icon-size:22px;width:22px;height:22px;color:var(--hk-glyph,#fff);flex:none;display:flex}',
    '.pon .tx{flex:1;min-width:0;line-height:1.2}',
    '.pon .tx small{display:block;font-size:11px;font-weight:600;letter-spacing:0.4px;opacity:.6;text-transform:uppercase}',
    '.pon .tx b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pon .chg{flex:none;height:36px;padding:0 15px;border-radius:11px;background:#fff;color:#1d1426;font-size:14px;font-weight:700;',
    '  display:flex;align-items:center;cursor:pointer;border:0;font-family:inherit}',
    '.pon .chg:active{filter:brightness(.9)}',
    // ...ONLY WHILE SOMETHING PLAYS (2026-10-14): nothing playing, "Ready on"
    // said what Plays on (or the Speakers column) already says
    '.mu.idle .pon{display:none}',
    // THE HOUSE: a card for each thing playing
    // (capped on two or three columns, scrolling within itself: _houseFit)
    '.house{flex:none;display:flex;flex-direction:column;gap:6px;margin-bottom:12px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}',
    '.house::-webkit-scrollbar{display:none}',
    '.house > *{flex:none}',
    '.house:empty{display:none}',
    '.house .hl{font-size:11px;font-weight:600;letter-spacing:0.4px;opacity:.6;text-transform:uppercase;margin:0 2px 2px}',
    '.cx{display:flex;align-items:center;gap:10px;height:52px;padding:0 10px 0 6px;border-radius:12px;cursor:pointer;box-sizing:border-box;',
    '  background:' + window.hkCards.v('key') + ';box-shadow:inset 0 0 0 1px ' + window.hkCards.v('line') + '}',
    '.cx.on{background:' + window.hkCards.v('key-strong') + ';box-shadow:inset 0 0 0 1.5px var(--hk-mark,rgba(255,255,255,.55));cursor:default}',
    '.cx .th{width:40px;height:40px;border-radius:8px;background:' + window.hkCards.v('key') + ';flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.cx .th img{width:100%;height:100%;object-fit:cover;display:block}',
    '.cx .th hk-icon,.cx .th svg{--mdc-icon-size:20px;width:20px;height:20px;fill:var(--hk-glyph,rgba(255,255,255,.5));color:var(--hk-glyph,rgba(255,255,255,.5))}',
    '.cx .t{flex:1;min-width:0;line-height:1.2}',
    '.cx .t b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cx .t small{display:block;font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden}',
    '.cx .sw{font-size:12px;font-weight:600;opacity:.75;flex:none}',
    '.cx .eq{display:flex;gap:2px;align-items:flex-end;height:12px;flex:none}',
    '.cx .eq i{width:3px;height:12px;background:var(--hk-glyph,#fff);border-radius:1px;transform-origin:50% 100%;animation:mueq 1s ease-in-out infinite}',
    '.cx .eq i:nth-child(2){animation-delay:-.3s}.cx .eq i:nth-child(3){animation-delay:-.6s}',
    '.cx.paused .eq i{animation:none;transform:scaleY(.3)}',
    '@keyframes mueq{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}',
    // WHAT PLAYS
    '.front{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
    // EVERYTHING IN THE COLUMN AS WIDE AS THE ART (--mu-aw, measured): a bar
    // wider than the cover below it looked off
    '.mu:not([cols="1"]) .left > .pon,.mu:not([cols="1"]) .left > .house,.mu:not([cols="1"]) .front > :not(.artbox){width:var(--mu-aw,100%);max-width:100%;align-self:center;box-sizing:border-box}',
    '.artbox{flex:1 1 auto;min-height:120px;container-type:size;display:flex;align-items:center;justify-content:center}',
    '.mu[cols="1"] .artbox{flex:none;height:min(78vw,330px)}',
    // ...on two or three columns, as tall as it is wide and no more (shrinking
    // when the window is short): the song and the controls right under it,
    // the spare room at the column's foot -- not centered in it, which left a
    // band of empty above and below the art on a desk
    '.mu:not([cols="1"]) .artbox{flex:0 1 auto;aspect-ratio:1 / 1;min-height:120px}',
    '.art{width:min(100cqw,100cqh);height:min(100cqw,100cqh);border-radius:22px;overflow:hidden;background:' + window.hkCards.v('key') + ';',
    // (the look's own shadow, as every card's: Flat's contact shadow,
    // Tinted's, the glass cards' -- the user, 2026-10-17)
    '  box-shadow:var(--hk-look-shadow,' + window.hkCards.v('glass-shadow-lg') + ');display:flex;align-items:center;justify-content:center}',
    '.art img{width:100%;height:100%;object-fit:cover;display:block}',
    '.art hk-icon{--mdc-icon-size:72px;width:72px;height:72px;color:var(--hk-glyph,rgba(255,255,255,.4))}',
    '.tt{font-size:26px;font-weight:700;letter-spacing:-.3px;margin-top:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
    '.st{font-size:17px;opacity:.75;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}',
    '.prog{margin-top:16px;flex:none}',
    '.prog .b{height:5px;border-radius:3px;background:' + window.hkCards.v('line-strong') + ';overflow:hidden}',
    '.prog .b i{display:block;height:100%;background:rgba(255,255,255,.92);transform-origin:0 50%;transform:scaleX(0)}',
    '.prog .t{display:flex;justify-content:space-between;font-size:12px;opacity:.6;margin-top:6px;font-variant-numeric:tabular-nums}',
    // the transport across the column, room round each button
    '.tr{display:flex;align-items:center;justify-content:space-between;margin-top:18px;padding:0 2px;flex:none}',
    '.tr .p{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .15s}',
    '.tr .p:active{background:' + window.hkCards.v('key-strong') + '}',
    '.tr .p svg{width:30px;height:30px;fill:var(--hk-glyph,#fff)}',
    '.tr .p.big svg{width:42px;height:42px}',
    '.tr .x{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;',
    '  box-shadow:inset 0 0 0 1.5px ' + window.hkCards.v('mark') + ';background:' + window.hkCards.v('key') + '}',
    '.tr .x svg{width:21px;height:21px;fill:var(--hk-glyph,#fff)}',
    '.tr .x hk-icon{--mdc-icon-size:22px;width:22px;height:22px;color:var(--hk-glyph,#fff);display:flex}',
    '.tr .x.on{background:#fff;box-shadow:none}',
    '.tr .x.on svg{fill:#1d1426}.tr .x.on hk-icon{color:#1d1426}',
    '.tr .x.gone{visibility:hidden}',
    // FLAT: the empty art and the Speakers and Queue buttons sit on the page
    // itself, so they are raised as the playlist pills beside them are -- the
    // cards' surface and their one contact shadow, no ring (DESIGN.md
    // "Raised or set in"; the user, 2026-10-17: the stone and its ring read
    // as another gray). Lit, a button stays white.
    ':host([hk-flat]) .art{background:' + window.hkCards.M.bg + '}',
    ':host([hk-flat]) .tr .x:not(.on){background:' + window.hkCards.M.bg + ';box-shadow:var(--hk-look-shadow)}',
    ':host([hk-flat]) .tr .x.on{box-shadow:var(--hk-look-shadow)}',
    '.idle .tr .p:not(.big){opacity:.35;pointer-events:none}',
    '.vol{display:flex;align-items:center;gap:12px;margin-top:20px;flex:none;touch-action:none}',
    '.vol svg{width:18px;height:18px;fill:var(--hk-glyph,rgba(255,255,255,.7));flex:none}',
    '.vol .tk{position:relative;flex:1;height:30px;cursor:pointer}',
    '.vol .tk::before{content:"";position:absolute;left:0;right:0;top:12px;height:6px;border-radius:3px;background:' + window.hkCards.v('line-strong') + '}',
    '.vol .tk i{position:absolute;left:0;top:12px;height:6px;width:calc(var(--v,0) * 100%);border-radius:3px;background:#c26df0}',
    '.vol .tk b{position:absolute;top:3px;left:calc(var(--v,0) * 100%);width:24px;height:24px;margin-left:-12px;border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.3)}',
    '.idle .vol,[novol] .vol{visibility:hidden}',
    '.nx{display:flex;align-items:center;gap:12px;margin-top:16px;min-width:0;flex:none}',
    '.nx[hidden]{display:none}',
    '.nx .th{width:40px;height:40px;border-radius:7px;background:' + window.hkCards.v('key') + ';flex:none;overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.nx .th img{width:100%;height:100%;object-fit:cover;display:block}',
    '.nx .th svg{width:50%;height:50%;fill:var(--hk-glyph,rgba(255,255,255,.45))}',
    '.nx small{display:block;font-size:11px;font-weight:600;letter-spacing:0.4px;opacity:.55}',
    '.nx .t{min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // A PHONE (one column): Browse is the page; what plays is a sheet over
    // it (Now Playing), opened from the mini player at the foot -- the
    // dashboard's own docked bar, or this page's when there is none
    '.grab{display:none}',
    '.mu.relay,.mu.relay *{transition:none!important}',
    // ...and nothing is drawn before the page knows its columns: built as two,
    // its first frame on a phone was the two-column page (_layout sets cols)
    '.mu:not([cols]){visibility:hidden}',
    '.mu[cols="1"] .left{position:fixed;left:0;right:0;top:0;bottom:0;z-index:19;box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;',
    '  padding:max(10px,env(safe-area-inset-top,0px)) 20px max(24px,env(safe-area-inset-bottom,0px));transform:translateY(100%);visibility:hidden;',
    '  transition:transform .42s cubic-bezier(.32,.72,0,1),visibility 0s linear .42s;',
    '  background:rgba(20,13,30,.80);-webkit-backdrop-filter:blur(40px) saturate(1.5);backdrop-filter:blur(40px) saturate(1.5)}',
    '.mu[cols="1"] .left.sheetup{transform:none;visibility:visible;transition:transform .42s cubic-bezier(.32,.72,0,1)}',
    // ...A SHEET OF ITS OWN, dark whatever the page: on a light page (hk-base.js
    // tone()) it stays exactly as it is anywhere else -- every tone property
    // back to nothing inside it (`initial` is no value, so each var() takes
    // today's literal) and its own white to inherit. Light pages only: HK's
    // own screens set some of the glass ones themselves (Frosted, Blur).
    // (Flat: no blur, so no veil -- the sheet's own ground, solid)
    ':host([hk-flat]) .mu[cols="1"] .left{background:#140d1e}',
    ':host([data-hk-light]) .mu[cols="1"] .left{color:#fff;' + Object.keys(C.LIGHT || {}).map(function (k) { return k + ':initial'; }).join(';') + '}',
    '.mu[cols="1"] .grab{display:block;flex:none;width:100%;height:26px;margin:-4px 0 6px;cursor:pointer;touch-action:none;position:relative}',
    '.mu[cols="1"] .grab::before{content:"";position:absolute;left:50%;top:8px;width:42px;height:5px;margin-left:-21px;border-radius:3px;background:rgba(255,255,255,.5)}',
    '.mu[cols="1"] .front{flex:none}',
    // ...its own, when the dashboard's bar is not up (none on this screen,
    // or dismissed): a row in the page under the search -- never over the
    // tab bar or anything else (a floating one covered a floating tab bar)
    '.mini{display:none;margin:0 0 14px;height:64px;border-radius:18px;align-items:center;gap:12px;padding:0 6px 0 7px;box-sizing:border-box;color:' + window.hkCards.v('ink') + ';',
    '  background:' + M.bg + ';border:' + M.border + ';box-shadow:var(--hk-look-shadow, 0 6px 18px rgba(0,0,0,.10))}',
    '.mini.on{display:flex}',
    '.mini .th{width:50px;height:50px;border-radius:10px;overflow:hidden;flex:none;background:' + window.hkCards.v('key') + ';display:flex;align-items:center;justify-content:center;cursor:pointer}',
    '.mini .th img{width:100%;height:100%;object-fit:cover;display:block}',
    '.mini .th svg{width:50%;height:50%;fill:var(--hk-glyph,rgba(255,255,255,.45))}',
    '.mini .t{flex:1;min-width:0;cursor:pointer}',
    '.mini .t b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mini .t small{display:block;font-size:13px;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mini .pp{width:44px;height:44px;display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer}',
    '.mini .pp svg{width:26px;height:26px;fill:var(--hk-glyph,#fff)}',
    '.mini .rb{width:44px;height:44px;border-radius:50%;background:' + window.hkCards.v('key') + ';display:flex;align-items:center;justify-content:center;flex:none;cursor:pointer}',
    '.mini .rb hk-icon{--mdc-icon-size:22px;width:22px;height:22px;color:var(--hk-glyph,#fff);display:flex}',

    // THE TOAST IS IN THE WINDOW, ABOVE THE TAB BAR. At the frame's foot it
    // was drawn behind a bar along the bottom (the frame runs on under the
    // bar) and below the window on a phone, whose page scrolls: "Starting
    // <playlist>…" was never seen (house, 2026-10-20). Fixed, on the bar's
    // top edge (hk-tabbar.js --hk-tabbar-top, its gap included), else 20 px
    // over the window's foot.
    '.toast{position:fixed;left:50%;bottom:var(--hk-tabbar-top,calc(20px + env(safe-area-inset-bottom, 0px)));transform:translate(-50%,10px);background:rgba(255,255,255,.96);color:#111;font-weight:600;',
    '  font-size:14px;padding:10px 18px;border-radius:99px;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;z-index:30;',
    '  white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis;box-shadow:0 8px 24px rgba(0,0,0,.35)}',
    '.toast.on{opacity:1;transform:translate(-50%,0)}',
    '@media (prefers-reduced-motion:reduce){.cx .eq i{animation:none}}'
  ].join('');

  class HkMusicCard extends HkBase {
    static get CSS() { return CSS; }
    // the panel's own look (and the shadow its list rides under), once there
    // is a panel: its module may load after this card is first drawn
    _panelCss() {
      var P = window.hkSaverPanel;
      if (!P || this._pcss) return !!P;
      var st = document.createElement('style');
      st.textContent = P.CSS + (C.shadeCss ? C.shadeCss('.mpanel') : '') + PANEL_PAGE_CSS + PICK_CSS + FLAT_PANEL_CSS;
      this.shadowRoot.appendChild(st);
      this._pcss = true;
      return true;
    }
    setConfig(config) {
      this._target = null;            // nothing playing: where the next music plays
      this._pnl = null; this._roomsPnl = null;
      super.setConfig(config || {});
    }
    getCardSize() { return 12; }

    // EACH NEW CLIENT (HkBase calls this from Lovelace's entry and from a client set
    // directly): the music model follows its subscription port, and the library
    // card inside the page gets what goes with it.
    _receiveClient() {
      var c = this.client;
      if (window.hkMusic) window.hkMusic.attach(c);
      super._receiveClient();
      if (this._lib && c && this._lib.client !== c) window.hkHostClient.bridge(this._lib, c);
    }

    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      var self = this;
      if (!this._musicOff && window.hkMusic) {
        this._musicOff = window.hkMusic.onChange(function () { self._hkSig = null; if (self.client) self.redraw(); });
      }
      if (!this._ro && window.ResizeObserver) {
        this._ro = new ResizeObserver(function () { self._layout(); });
        this._ro.observe(this);
        if (this._e) this._ro.observe(this._e.art.parentNode);
      }
      if (!this._onBar) {
        this._onBar = function (ev) {
          var w = ev.detail && ev.detail.what;
          if (w === 'now') self._sheet(true); else if (w === 'speakers') self._openPanel('speakers');
        };
        window.addEventListener('hk-music-bar', this._onBar);
      }
      // the docked bar coming or going: this page's own Now Playing row stands
      // in while it is not up
      if (!this._onDock) {
        this._onDock = function () { self._hkSig = null; if (self.client) self.redraw(); };
        window.addEventListener('hk-dock', this._onDock);
      }
      if (!this._onWin) {
        this._onWin = function () { self._layout(); };
        window.addEventListener('resize', this._onWin);
        // the panel's module arriving after this card (the desk's rooms column)
        window.addEventListener('hk-saver-panel', this._onWin);
      }
      this._tickOn();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      if (this._musicOff) { this._musicOff(); this._musicOff = null; }
      if (this._onBar) { window.removeEventListener('hk-music-bar', this._onBar); this._onBar = null; }
      this._sheet(false);
      this._sheetFlag(false);
      this._closePick();
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      if (this._onWin) { window.removeEventListener('resize', this._onWin); window.removeEventListener('hk-saver-panel', this._onWin); this._onWin = null; }
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
      this._closePanel(false);
      this._miniFlag(false);
      this._flagSaid = false;
      if (this._onDock) { window.removeEventListener('hk-dock', this._onDock); this._onDock = null; }
    }
    // ONE COLUMN, THE DASHBOARD'S DOCKED BAR IS THIS PAGE'S MINI PLAYER: the
    // bar's pop-up on this page opens only while <html> carries
    // `hk-music-mini` (hk-strategy.js, hk-popup.js's `flag` condition)
    // (say: tell the pop-ups even when it has not changed -- the page's first
    // layout, which a bar kept up for this page waits on)
    _miniFlag(on, say) {
      var de = document.documentElement;
      if (!de || (de.hasAttribute('hk-music-mini') === !!on && !say)) return;
      de.toggleAttribute('hk-music-mini', !!on);
      try { window.dispatchEvent(new Event('hk-popup-flags')); } catch (x) { /* none */ }
    }

    // ------------------------------------------------------------ the house
    _M() { return window.hkMusic; }
    // what this page shows: hkMusic's answer (a context playing or paused),
    // else nothing
    _ctx() {
      var Mu = this._M(), h = this.client;
      if (!Mu || !h) return null;
      var r = Mu.resolve(h);
      return r && r.context ? r.context : null;
    }
    // nothing playing: the rooms the next music plays on (this screen's
    // answer -- its focus, its room -- until Speakers changes them)
    _targetRooms() {
      var Mu = this._M();
      if (this._target && this._target.length) return this._target;
      var p = Mu && this.client ? Mu.resolve(this.client).player : null;
      var pre = p && Mu.presets().filter(function (x) { return x.entity === p; })[0];
      return pre ? pre.members.slice() : p ? [p] : [];
    }
    // WHERE THE NEXT PICK PLAYS (Play Next On, 2026-10-11): the rooms picked
    // for it, while music plays elsewhere; else what plays; else where the
    // page is ready. Plays on and the Speakers panel's ticks set it
    // (_setNext); Update in the panel moves what plays to it.
    _rooms() {
      var c = this._ctx();
      if (c && this._nextRooms && this._nextRooms.length) return this._nextRooms.slice();
      return c ? c.members.slice() : this._targetRooms();
    }
    _nextSet() { return !!(this._ctx() && this._nextRooms && this._nextRooms.length); }
    _nameOf(e) { var Mu = this._M(); return Mu && Mu.nameOf ? Mu.nameOf(e) : e; }
    // the music's name for its rooms ("Living Room +3", a preset's own name);
    // nothing playing, the rooms picked, named the same way
    _label() {
      var Mu = this._M(), c = this._ctx();
      if (c && Mu) return Mu.label(c);
      return this._roomsLabel(this._targetRooms());
    }
    // rooms named as the music cards name them: a preset's own name,
    // "Kitchen + Office", "Kitchen +3"
    _roomsLabel(g) {
      var Mu = this._M();
      var pre = Mu && Mu.presets().filter(function (p) { return p.members.length === g.length && g.every(function (r) { return p.members.indexOf(r) >= 0; }); })[0];
      if (pre) return pre.name;
      if (g.length === 2) return this._nameOf(g[0]) + ' + ' + this._nameOf(g[1]);
      return g.length ? this._nameOf(g[0]) + (g.length > 2 ? ' +' + (g.length - 1) : '') : '';
    }
    _nextLabel() { return this._nextSet() ? this._roomsLabel(this._nextRooms) : this._label(); }
    _player() {
      var c = this._ctx();
      if (this._nextSet()) return playTarget(this._nextRooms, this._M() ? this._M().presets() : []).player;
      if (c) return c.key;
      return playTarget(this._targetRooms(), this._M() ? this._M().presets() : []).player;
    }

    _sigOf() {
      var Mu = this._M(), h = this.client;
      if (!Mu || !h || !this._config) return null;
      var r = Mu.resolve(h), st = r.player && h.states[r.player];
      return [r.player, r.reason, st ? st.last_updated : '',
              Mu.contexts(h).map(function (c) { return c.key + c.state + c.title + c.members.join(','); }).join(';'),
              (this._target || []).join(','), (this._nextRooms || []).join(','), this._cols,
              musicMissing() ? 'no-music' : ''].join('|');
    }

    // ------------------------------------------------------------ build
    _render() {
      if (!this._config) return;
      // NO MUSIC FEATURE: the line, not a page of empty rooms (built again
      // from scratch once it is added)
      if (musicMissing()) {
        if (this._built) {
          this._closePanel(false); this._sheet(false); this._closePick();
          if (this._roomsPnl) { this._roomsPnl.destroy(); this._roomsPnl = null; }
          this._miniFlag(false);
        }
        this._e = null; this._lib = null; this._cols = null; this._pos = null;
        this._tickOn();
        drawNoMusic(this);
        return;
      }
      if (!this._built) this._build();
      this._draw();
    }
    _build() {
      var self = this;
      this._root.innerHTML =
        '<hk-plate><div class="mu">' +
          '<section class="left">' +
            '<div class="grab" role="button" aria-label="Close Now Playing"></div>' +
            '<div class="pon glass"><hk-icon icon="hk:homepod"></hk-icon><div class="tx"><small></small><b></b></div>' +
              '<button class="chg" data-k="change">Change</button></div>' +
            '<div class="house"></div>' +
            '<div class="front">' +
              '<div class="artbox"><div class="art"><hk-icon icon="mdi:music"></hk-icon></div></div>' +
              '<div class="tt"></div><div class="st"></div>' +
              '<div class="prog"><div class="b"><i></i></div><div class="t"><span></span><span></span></div></div>' +
              '<div class="tr"><div class="x" data-k="speakers" role="button" aria-label="Speakers"><hk-icon icon="hk:homepod"></hk-icon></div>' +
                '<div class="p" data-k="previous" role="button" aria-label="Previous">' + svg(ICON.prev) + '</div>' +
                '<div class="p big" data-k="play_pause" role="button" aria-label="Play or pause">' + svg(ICON.play) + '</div>' +
                '<div class="p" data-k="next" role="button" aria-label="Next">' + svg(ICON.next) + '</div>' +
                '<div class="x" data-k="queue" role="button" aria-label="Queue">' + svg(ICON.queue) + '</div></div>' +
              '<div class="vol">' + svg(ICON.vlo) + '<div class="tk"><i></i><b></b></div>' + svg(ICON.vhi) + '</div>' +
              '<div class="nx" hidden><div class="th">' + svg(ICON.note) + '</div><div style="min-width:0"><small>UP NEXT</small><div class="t"></div></div></div>' +
            '</div>' +
          '</section>' +
          '<section class="right"><div class="mini"><div class="th" data-k="now">' + svg(ICON.note) + '</div><div class="t" data-k="now"><b></b><small></small></div>' +
            '<div class="pp" data-k="play_pause" role="button" aria-label="Play or pause">' + svg(ICON.play) + '</div>' +
            '<div class="rb" data-k="speakers" role="button" aria-label="Speakers"><hk-icon icon="hk:homepod"></hk-icon></div></div></section>' +
          '<section class="rooms"></section>' +
        '</div><div class="scrim"></div><div class="toast"></div></hk-plate>';
      var q = this._root.querySelector.bind(this._root);
      if (this._ro) this._ro.observe(q('.artbox'));
      // the page's font, once it has loaded (measured before, a name was cut)
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self._fitLines(); });
      this._e = { mu: q('.mu'), left: q('.left'), pon: q('.pon'), ponS: q('.pon small'), ponB: q('.pon b'), house: q('.house'),
                  front: q('.front'), art: q('.art'), tt: q('.tt'), st: q('.st'), bar: q('.prog i'), t0: q('.prog .t span:first-child'),
                  t1: q('.prog .t span:last-child'), pp: q('[data-k="play_pause"] path'), vol: q('.vol'), tk: q('.vol .tk'),
                  nx: q('.nx'), nxT: q('.nx .t'), nxTh: q('.nx .th'), right: q('.right'), rooms: q('.rooms'),
                  scrim: q('.scrim'), toast: q('.toast'), spk: q('.tr [data-k="speakers"]'), qbtn: q('[data-k="queue"]'),
                  mini: q('.mini'), miniTh: q('.mini .th'), miniB: q('.mini .t b'), miniS: q('.mini .t small'), miniPP: q('.mini .pp path'), grab: q('.grab') };
      this._built = true;
      this._artUrl = undefined; this._houseSig = null; this._nextFor = ''; this._next = null;
      // taps
      this._root.addEventListener('click', function (ev) {
        var t = ev.target.closest && ev.target.closest('[data-k],[data-ctx]');
        if (!t) return;
        if (t.hasAttribute('data-ctx')) { self._switchTo(t.getAttribute('data-ctx')); return; }
        var k = t.getAttribute('data-k');
        if (k === 'now') { self._sheet(true); return; }
        if (k === 'change' || k === 'speakers') { self._openPanel('speakers'); return; }
        if (k === 'queue') { self._openPanel('queue'); return; }
        if (k === 'play_pause' || k === 'next' || k === 'previous') self._transport(k);
      });
      this._e.scrim.addEventListener('click', function () { self._closePanel(true); });
      var gy = null, g = this._e.grab;
      g.addEventListener('pointerdown', function (ev) { gy = ev.clientY; try { g.setPointerCapture(ev.pointerId); } catch (x) { /* a mouse */ } });
      g.addEventListener('pointermove', function (ev) {
        if (gy === null) return;
        var d = Math.max(0, ev.clientY - gy);
        self._e.left.style.transition = 'none';
        self._e.left.style.transform = 'translateY(' + d + 'px)';
      });
      var gEnd = function (ev) {
        if (gy === null) return;
        var d = ev.clientY - gy; gy = null;
        self._e.left.style.transition = ''; self._e.left.style.transform = '';
        if (d > 80 || Math.abs(d) < 6) self._sheet(false);
      };
      g.addEventListener('pointerup', gEnd);
      g.addEventListener('pointercancel', function () { gy = null; self._e.left.style.transition = ''; self._e.left.style.transform = ''; });
      this._wireVolume();
      // the library: Browse Music, the page's right column
      var make = function () {
        if (self._lib || !self._e) return;
        var lib = document.createElement('hk-library-card');
        lib.playerFor = function () { return self._player(); };
        lib.playerNameFor = function () { return self._nextLabel(); };
        lib.playVia = function (node) { self._playNode(node); };
        // where it plays, in the trail's row while searching or inside an album
        // beside the search: where it plays, and the line under them
        lib.routeEl = self._routeEl();
        lib.noteEl = document.createElement('div'); lib.noteEl.className = 'nextnote';
        self._noteEl = lib.noteEl;
        lib.rootExtra = self._playlistsEl();
        lib.setConfig({ type: 'custom:hk-library-card', music: true, layout: 'music' });
        if (self.client) window.hkHostClient.bridge(lib, self.client);
        // its messages, here (Home Assistant's toast is under the page's own)
        lib.addEventListener(window.hkShell.events.toast, function (e) {
          e.stopPropagation();
          if (e.detail && e.detail.message) self._toast(e.detail.message);
        });
        self._e.right.appendChild(lib);
        self._lib = lib;
        lib.toggleAttribute('flow', self._cols === 1);
        // (three columns already: no Plays on beside the search -- _layout)
        if (self._cols === 3) { lib.routeEl.style.display = 'none'; lib.noteEl.style.display = 'none'; }
        if (self._config.focus_search) setTimeout(function () {
          var s = lib.shadowRoot && lib.shadowRoot.querySelector('.search');
          if (s) try { s.focus(); } catch (e) { /* not focusable yet */ }
        }, 400);
      };
      if (customElements.get('hk-library-card')) make(); else customElements.whenDefined('hk-library-card').then(make);
      this._layout();
    }

    // ------------------------------------------------------------ layout
    _layout() {
      if (!this._e) return;
      var w = this.clientWidth || this.getBoundingClientRect().width;
      if (!w) return;
      var cols = w >= COLS3 ? 3 : w >= COLS2 ? 2 : 1, changed = cols !== this._cols;
      if (changed) {
        this._cols = cols;
        // A NEW COLUMN COUNT IS LAID, NOT ANIMATED (2026-10-13): the page is
        // built as two columns, and on a phone turning to one slid Now
        // Playing off the foot over .42 s -- a sheet popping up and away on
        // every first visit to Music (the user's screen recording). Its
        // transitions are off while the new layout's styles are applied
        // (one style read), and back on for what is pressed after.
        var mu = this._e.mu;
        mu.classList.add('relay');
        mu.setAttribute('cols', String(cols));
        // FLAT ON A PHONE: Now Playing is a sheet over Browse, and Flat takes
        // every blur -- its veil let the page show through, and a light theme
        // made its plates light (seen on an iPhone). A dark Flat
        // surface of its own, as the screensaver's music is; beside Browse
        // (two or three columns) it is the page's again.
        if (this._e.left && C.flatSurface) C.flatSurface(this._e.left, cols === 1 ? 'music' : 'page');
        if (this._e.left) void getComputedStyle(this._e.left).transform;
        requestAnimationFrame(function () { mu.classList.remove('relay'); });
        this._closePanel(false);
        this._closePick();
        if (this._e.left) this._e.left.classList.remove('sheetup');
        this._sheetUp = false;
        this._sheetFlag(false);
        this._hkSig = null;
      }
      this._miniFlag(cols === 1, !this._flagSaid);
      this._flagSaid = true;
      this._wanted();
      // TWO OR THREE COLUMNS FILL THE WINDOW BELOW THE TITLE: what plays
      // stays, Browse scrolls in its own column. With a tab bar along the
      // bottom (hk-tabbar.js --hk-tabbar-h) the frame runs to the window's
      // foot and Browse scrolls BEHIND the bar, with the bar's room at its
      // end, as every page does (CSS, BAR_GAP); the columns that do not
      // scroll end above it.
      var vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hk-vh')) || window.innerHeight;
      var top = this.getBoundingClientRect().top + (document.scrollingElement ? 0 : 0);
      // (rounded DOWN: the card's top is fractional -- 23.19 on a 1280 x 800
      // tablet -- and rounded to nearest it ended 0.19 px past the window,
      // which a finger could scroll, 2026-10-15)
      if (cols >= 2) this.style.setProperty('--mu-h', 'max(420px, calc(' + Math.floor(vh - Math.max(0, top) - 16) + 'px + ' + BAR_GAP + '))');
      else { this.style.removeProperty('--mu-h'); this.style.setProperty('--mu-rh', Math.round(vh - 90) + 'px'); }
      // ...and so the page ends the 16 px foot below this card's box, where
      // the window (or the bar's room) begins -- not a page gutter below the
      // frame that runs on under the bar, which counted the bar's room twice
      // and scrolled a page that fits (hk-layout.js data-hk-foot,
      // 2026-10-18). One column is an ordinary page and ends at its gutter.
      if (cols >= 2) { if (this.getAttribute('data-hk-foot') !== '16') this.setAttribute('data-hk-foot', '16'); }
      else if (this.hasAttribute('data-hk-foot')) this.removeAttribute('data-hk-foot');
      // THREE COLUMNS: the Speakers column ticks where the next pick plays
      // (and moves what plays), so Plays on and its line go and the search
      // takes the row (the user's design, 2026-10-14)
      if (this._routeBtn) this._routeBtn.style.display = cols === 3 ? 'none' : '';
      if (this._noteEl) this._noteEl.style.display = cols === 3 ? 'none' : '';
      if (this._lib) {
        this._lib.toggleAttribute('flow', cols === 1);
        // (a phone's field says less: the button beside it takes the room)
        var sx = this._lib.shadowRoot && this._lib.shadowRoot.querySelector('.search');
        if (sx) sx.placeholder = cols === 1 ? 'Search' : 'Search artists, albums, songs\u2026';
      }
      if (changed || (cols === 3 && !this._roomsPnl)) this._roomsColumn(cols === 3);
      if (this._roomsPnl) this._roomsPnl.size(this._e.rooms.clientWidth, this._e.rooms.clientHeight, 1);
      if (this._pnl && !this._pnl.sheet) this._pnl.p.size(this._e.left.clientWidth, this._e.left.clientHeight, 1);
      this._houseFit(true);
      this._artWidth();
      this._fitLines();
    }
    // the art's size (a square, as large as its box allows), for the column
    _artWidth() {
      var e = this._e, b = e && e.art && e.art.parentNode;
      if (!b || !b.clientWidth) return;
      var s = Math.round(Math.min(b.clientWidth, b.clientHeight || b.clientWidth));
      var w = Math.min(b.clientWidth, Math.max(s, MIN_COL)) + 'px';
      if (this.style.getPropertyValue('--mu-aw') !== w) { this.style.setProperty('--mu-aw', w); this._fitLines(); }
    }
    _roomsColumn(on) {
      var P = window.hkSaverPanel;
      if (this._roomsPnl) { this._roomsPnl.destroy(); this._roomsPnl = null; }
      if (!on || !P || !this._panelCss()) return;
      this._roomsPnl = P.create(this._panelOpts(['speakers', 'volume'], true));
      this._roomsPnl.el.classList.add('pg');
      this._e.rooms.appendChild(this._roomsPnl.el);
      this._roomsPnl.size(this._e.rooms.clientWidth || 380, this._e.rooms.clientHeight || 700, 1);
      this._roomsPnl.show('speakers');
    }
    _panelOpts(tabs, fixed) {
      var self = this;
      return {
        tabs: tabs,
        client: function () { return self.client; },
        ctx: function () { return self._ctx(); },
        art: function () { return null; },
        stop: true,
        target: function () { return self._targetRooms(); },
        setTarget: function (rooms) { self._target = rooms.slice(); self._hkSig = null; if (self.client) self.redraw(); },
        // PLAYING, ITS TICKS ARE WHERE THE NEXT PICK PLAYS (2026-10-14): the
        // same rooms as Plays on's (null: back to what plays)
        next: function () { return self._rooms(); },
        setNext: function (rooms) { self._setNext(rooms); },
        follow: function (key) { var Mu = self._M(); if (key && Mu && Mu.known(key)) Mu.setFocus(key); },
        done: function (ms) {
          if (fixed) return;
          clearTimeout(self._doneT);
          self._doneT = setTimeout(function () { self._closePanel(true); }, ms || 0);
        },
        wide: function () { return false; }
      };
    }

    // ------------------------------------------------------------ drawing
    _draw() {
      var e = this._e, h = this.client, Mu = this._M();
      if (!e || !h || !Mu) return;
      var c = this._ctx(), st = c ? h.states[c.key] || {} : {}, a = st.attributes || {};
      // music started: the rooms picked for it have done their job (stopped,
      // the page is ready on where it played -- this screen's focus)
      if (c && this._target) this._target = null;
      e.mu.classList.toggle('idle', !c);
      // PLAYING ON / READY ON
      e.ponS.textContent = c ? 'Playing on' : 'Ready on';
      // (where the music IS -- never the rooms picked for the next pick)
      e.ponB.setAttribute('data-fit', (c ? c.members : this._targetRooms()).join(','));
      // THE HOUSE: a card for each thing playing, when there is more than
      // this page's -- or when what plays is not this page's
      this._drawHouse(c);
      this._fitLines();
      // WHAT PLAYS
      var pic = c ? (a.entity_picture_local || a.entity_picture || '') : '';
      if (pic && pic.charAt(0) === '/') pic = location.origin + pic;
      // THE PAGE'S BLURRED BACKGROUND IS THIS COVER (hk-sky.js, playmusic,
      // listens for hk-now-art). Only the now-playing bar said it, and on a
      // tablet the bar is not on this page -- so the background followed
      // the music only when some bar happened to redraw (the user,
      // 2026-10-14: "sometimes, not always"). Said here too, in the bar's
      // exact form (hk-media.js _art), so the two never disagree on a phone,
      // where both are up; nothing playing clears it.
      var pub = c ? (a.entity_picture_local || a.entity_picture || a.media_image_url || a.thumbnail || '') : '';
      if (pub && pub.charAt(0) === '/') pub = location.origin + pub;
      if (window.hkNowArt !== (pub || null)) {
        window.hkNowArt = pub || null;
        window.dispatchEvent(new CustomEvent('hk-now-art', { detail: { url: pub || null } }));
      }
      if (pic !== this._artUrl) {
        this._artUrl = pic;
        e.art.innerHTML = '<hk-icon icon="mdi:music"></hk-icon>';
        if (pic) { var box = e.art; box.innerHTML = ''; this._artImage(pic, box, '<hk-icon icon="mdi:music"></hk-icon>', 700); }
      }
      e.tt.textContent = c ? (c.title || a.media_title || this._label()) : 'Nothing Playing';
      e.st.textContent = c ? [c.artist || a.media_artist, a.media_album_name].filter(Boolean).join(' · ') : 'Pick a playlist, or search, to start';
      e.pp.setAttribute('d', c && c.playing ? ICON.pause : ICON.play);
      this._pos = c ? { dur: Number(a.media_duration) || 0, pos: Number(a.media_position) || 0,
                        at: Date.parse(a.media_position_updated_at) || 0, playing: !!c.playing } : null;
      this._progress();
      // the volume: the group's (the leader's level), unless a finger is on it
      var lv = typeof a.volume_level === 'number' ? a.volume_level : null;
      if (this._vol && Date.now() < this._vol.until) lv = this._vol.val;
      if (lv === null) e.mu.setAttribute('novol', ''); else { e.mu.removeAttribute('novol'); e.tk.style.setProperty('--v', Math.max(0, Math.min(1, lv)).toFixed(3)); }
      this._upNext(c);
      // the desk's rooms column: Speakers there, so not here
      e.spk.classList.toggle('gone', this._cols === 3);
      this._drawMini(c, a, pic);
      this._wanted();
      this._buttons();
      if (this._pnl) this._pnl.p.update();
      if (this._roomsPnl) this._roomsPnl.update();
      // what plays now holds the picked rooms only while it plays elsewhere
      if (this._nextRooms && !c) this._nextRooms = null;
      this._refreshPlaylists();
      this._drawPick();
      this._tickOn();
    }
    _drawHouse(c) {
      var Mu = this._M(), h = this.client, self = this;
      // ONE CARD PER THING PLAYING, not per player (hkMusic.streams): nine
      // HomePods AirPlayed to from one iPhone are one "Dynamite" card, its
      // line "Kitchen, Living Room and 7 more"
      var ss = Mu.streams(Mu.contexts(h)), mine = c ? c.key : null;
      var isMine = function (x) { return !!mine && x.ctxs.some(function (y) { return y.key === mine; }); };
      // ...shown when there is more than this page's -- other music, or this
      // page's song in rooms its buttons do not reach -- or when what plays
      // is not this page's
      var show = ss.length > 1 || (ss.length === 1 && (!c || ss[0].ctxs.length > 1));
      var sig = show ? ss.map(function (x) { return x.ctxs.map(function (y) { return y.key; }).join('+') + '|' + x.state + '|' + x.title + '|' + x.image + '|' + x.members.join(','); }).join(';') + '#' + mine + '#' + this._targetRooms().join(',') : '';
      if (sig === this._houseSig) return;
      var el = this._e.house, top = el.scrollTop, was = (this._houseSig || '').split('#')[1];
      this._houseSig = sig;
      el.innerHTML = '';
      if (!show) { this._houseFit(); return; }
      var hl = document.createElement('div'); hl.className = 'hl'; hl.textContent = 'Playing in the house'; el.appendChild(hl);
      var home = Mu.home(), lit = null;
      var card = function (x, on, idle) {
        var d = document.createElement('div');
        d.className = 'cx' + (on ? ' on' : '') + (x && !x.playing ? ' paused' : '');
        // A TAP HANDS THE PAGE ONE PLAYER of the stream: this tablet's own
        // room when it is one of them, else the first -- its buttons then act
        // on that player, as "Playing on" says
        if (!on && x) d.setAttribute('data-ctx', (x.ctxs.filter(function (y) { return home && y.members.indexOf(home) >= 0; })[0] || x.ctxs[0]).key);
        var th = document.createElement('div'); th.className = 'th';
        if (x && x.image) self._artImage(x.image.charAt(0) === '/' ? location.origin + x.image : x.image, th, svg(ICON.note), 80);
        else th.innerHTML = svg(ICON.note);
        d.appendChild(th);
        var t = document.createElement('div'); t.className = 't';
        var b = document.createElement('b'); b.textContent = idle ? 'Nothing Playing' : (x.title || Mu.label(x.ctxs[0]));
        var s = document.createElement('small'); s.setAttribute('data-fit', (idle ? self._targetRooms() : x.members).join(','));
        t.appendChild(b); t.appendChild(s); d.appendChild(t);
        if (on && !idle) d.insertAdjacentHTML('beforeend', '<span class="eq"><i></i><i></i><i></i></span>');
        if (!on) d.insertAdjacentHTML('beforeend', '<span class="sw">Switch</span>');
        el.appendChild(d);
        if (on) lit = d;
      };
      if (!c) card(null, true, true);
      ss.forEach(function (x) { card(x, isMine(x), false); });
      this._houseFit();
      // (a redraw keeps where the list was scrolled; a new choice brings its card into view)
      el.scrollTop = top;
      if (lit && String(mine) !== was) {
        if (lit.offsetTop < el.scrollTop) el.scrollTop = lit.offsetTop;
        else if (lit.offsetTop + lit.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = lit.offsetTop + lit.offsetHeight - el.clientHeight;
      }
    }
    // THE PLAYER IS ALWAYS THERE (2026-10-14): on two or three columns the
    // house list gets what the column has left once the song, its controls
    // and an ART_MIN cover are in, and scrolls within that -- a long list ran
    // the controls off the column's foot and under the tab bar. Measured
    // only when what it depends on changes (the column, the list, Up Next).
    _houseFit(force) {
      var e = this._e;
      if (!e) return;
      var el = e.house, n = el.children.length;
      var key = this._cols + '|' + n + '|' + e.nx.hidden + '|' + e.mu.classList.contains('idle');
      if (!force && key === this._houseKey) return;
      this._houseKey = key;
      if (this._cols === 1 || !n) { el.style.maxHeight = ''; return; }
      var ab = e.art.parentNode;
      var need = e.front.scrollHeight - ab.offsetHeight + ART_MIN;
      var pon = e.mu.classList.contains('idle') ? 0 : e.pon.offsetHeight + 14;
      var room = Math.floor(e.left.clientHeight - pon - 12 - need);
      el.style.maxHeight = '';
      if (el.scrollHeight <= room) { el.style.maxHeight = room + 'px'; return; }
      // too long: whole cards, then part of the next (at least one card)
      var head = el.children[1].offsetTop - el.offsetTop;
      var k = Math.max(1, Math.floor((room - head - CX_PEEK) / CX_PITCH));
      el.style.maxHeight = (head + k * CX_PITCH + CX_PEEK) + 'px';
    }
    // NOW PLAYING ON A PHONE: what plays, as a sheet over Browse
    // THE BAR'S TAP FROM ANOTHER PAGE (hk-media.js: window.hkMusicWant):
    // Now Playing, open on arrival -- once this page knows its columns and
    // has the music; a few seconds, then it is stale. Two or three columns:
    // the player is already the page.
    _wanted() {
      var w = window.hkMusicWant;
      if (!w || !this._e || !this._cols) return;
      if (Date.now() - w.at > 4000) { window.hkMusicWant = null; return; }
      if (this._cols !== 1) { window.hkMusicWant = null; return; }
      if (!this._ctx()) return;
      window.hkMusicWant = null;
      if (w.what === 'now') this._sheet(true);
    }
    _sheet(on) {
      var e = this._e;
      if (!e || this._cols !== 1) return;
      if (on && !this._ctx()) return;
      // A HOST WITH A PLAYER OF ITS OWN (a phone app sets window.hkHostPlayer) shows that one instead
      var nat = window.hkHostPlayer;
      if (on && typeof nat === 'function') { nat(); return; }
      e.left.classList.toggle('sheetup', !!on);
      this._sheetUp = !!on;
      this._sheetFlag(!!on);
      if (on) { this._artWidth(); this._fitLines(); }
    }
    // ...and <html> says so (`hk-music-sheet`) while it is up: a host whose
    // view is a stacking context of its own lifts the view over its tab bar
    // and pop-ups then, and holds the page behind still (the sheet's
    // z-index alone cannot leave that context)
    _sheetFlag(on) {
      var de = document.documentElement;
      if (de && de.hasAttribute('hk-music-sheet') !== !!on) de.toggleAttribute('hk-music-sheet', !!on);
    }
    // THE MINI PLAYER (a phone): the dashboard's own docked bar is it when
    // there is one (it covers the foot: --hk-bar-h); else this page's own
    _drawMini(c, a, pic) {
      var e = this._e;
      if (!e.mini) return;
      // (<html>'s own style, where hk-popup.js writes it: a computed read
      // restyles the document when anything is pending)
      var dash = !!document.documentElement.style.getPropertyValue('--hk-bar-h').trim();
      var on = this._cols === 1 && !!c && !dash;
      e.mini.classList.toggle('on', on);
      if (!on) { if (!c) this._sheet(false); return; }
      e.miniB.textContent = c.title || a.media_title || '';
      e.miniS.textContent = this._label();
      e.miniPP.setAttribute('d', c.playing ? ICON.pause : ICON.play);
      if (pic !== this._miniArt) {
        this._miniArt = pic;
        e.miniTh.innerHTML = '';
        if (pic) this._artImage(pic, e.miniTh, svg(ICON.note), 120); else e.miniTh.innerHTML = svg(ICON.note);
      }
    }
    // every [data-fit] line: as many room names as fit, then "and N more" --
    // measured on the line itself (a canvas measure in the page's font came
    // out narrower than the page drew it, and a name was cut)
    _fitLines() {
      var self = this, root = this._root;
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('[data-fit]').forEach(function (el) {
        var names = el.getAttribute('data-fit').split(',').filter(Boolean).map(self._nameOf, self);
        el.textContent = list(names);
        if (!el.clientWidth) return;
        el.textContent = fitNames(names, el.clientWidth, function (s) { el.textContent = s; return el.scrollWidth; });
      });
    }
    _progress() {
      var e = this._e, p = this._pos;
      if (!e) return;
      if (!p || !p.dur) { e.bar.style.transform = 'scaleX(0)'; e.t0.textContent = p ? mmss(p.pos) : '--:--'; e.t1.textContent = '--:--'; return; }
      var t = Math.min(p.dur, Math.max(0, p.pos + (p.playing && p.at ? (Date.now() - p.at) / 1000 : 0)));
      e.bar.style.transform = 'scaleX(' + (t / p.dur).toFixed(4) + ')';
      e.t0.textContent = mmss(t); e.t1.textContent = mmss(p.dur);
    }
    _tickOn() {
      var self = this, want = this.isConnected && this._pos && this._pos.playing && !document.hidden;
      if (want && !this._tick) this._tick = setInterval(function () { self._progress(); self._tickOn(); }, TICK);
      else if (!want && this._tick) { clearInterval(this._tick); this._tick = null; }
    }
    // UP NEXT: Music Assistant's queue, asked once a song
    _upNext(c) {
      var e = this._e, sig = c ? c.key + '|' + c.title : '', self = this;
      if (sig !== this._nextFor) {
        this._nextFor = sig;
        var act = this._actions();
        if (!c || !act) { this._next = null; }
        else {
          // a service call (it only answers): through the action port
          act.callWS({ type: 'call_service', domain: 'music_assistant', service: 'get_queue',
                              service_data: { entity_id: c.key }, return_response: true }).then(function (r) {
            if (self._nextFor !== sig) return;
            var q = r && r.response && r.response[c.key], n = q && q.next_item, mi = n && n.media_item;
            self._next = n ? { title: (mi && mi.name) || n.name || '', artist: mi && mi.artists && mi.artists[0] ? mi.artists[0].name : '',
                               image: (mi && (mi.image || (mi.album && mi.album.image))) || '' } : null;
            self._drawNext();
          }).catch(function () { if (self._nextFor === sig) { self._next = null; self._drawNext(); } });
        }
      }
      this._drawNext();
    }
    _drawNext() {
      var e = this._e, n = this._next;
      if (!e) return;
      // (a page whose house cards are showing has less room: no Up Next there,
      // as in the mockup, on two columns)
      var room = !(this._cols === 2 && this._e.house.children.length);
      e.nx.hidden = !(n && n.title && room);
      this._houseFit();
      if (!n) return;
      e.nxT.textContent = n.title + (n.artist ? ' — ' + n.artist : '');
      var img = typeof n.image === 'string' && /^https?:|^\//.test(n.image) ? n.image : '';
      if (img !== this._nxImg) {
        this._nxImg = img;
        e.nxTh.innerHTML = '';
        if (img) this._artImage(img, e.nxTh, svg(ICON.note), 80); else e.nxTh.innerHTML = svg(ICON.note);
      }
    }
    _buttons() {
      var t = this._pnl ? this._pnl.p.tab() : '';
      this._e.spk.classList.toggle('on', t === 'speakers');
      this._e.qbtn.classList.toggle('on', t === 'queue');
    }

    // ------------------------------------------------------------ actions
    _transport(cmd) {
      var c = this._ctx(), h = this.client;
      if (!h) return;
      if (!c) {
        // nothing playing: play starts where the page says, with the first playlist
        if (cmd === 'play_pause') { var pl = (this._M().playlists() || [])[0]; if (pl) this._playPlaylist(pl, pl.options && pl.options[0] ? pl.options[0] : null); }
        return;
      }
      this._callResp('hk_frontend', 'music_transport', { player: c.key, command: cmd });
      if (cmd === 'play_pause' && this._pos) {
        var p = this._pos;
        p.pos = Math.min(p.dur || Infinity, p.pos + (p.playing && p.at ? (Date.now() - p.at) / 1000 : 0)); p.at = Date.now(); p.playing = !p.playing;
        this._e.pp.setAttribute('d', p.playing ? ICON.pause : ICON.play);
        this._tickOn();
      }
    }
    _wireVolume() {
      var self = this, tk = this._e.tk;
      var at = function (x) {
        var r = tk.getBoundingClientRect();
        if (!r.width) return null;
        return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100) / 100;
      };
      var send = function () {
        var d = self._drag, c = self._ctx();
        if (d && d.t) { clearTimeout(d.t); d.t = null; }
        if (!self._vol || !c || self._vol.sent === self._vol.val) return;
        if (d) d.sent = Date.now();
        self._vol.sent = self._vol.val;
        var calls = volumeCalls(c, self._M().presets(), self._vol.val), act = self._actions();
        calls.reduce(function (p, data) {
          return p.then(function () { return act.callService('media_player', 'volume_set', data); });
        }, Promise.resolve()).catch(function (err) { console.error('hk-music: volume_set failed', err); });
      };
      var move = function (x) {
        var v = at(x);
        if (v === null) return;
        self._vol = { val: v, until: Date.now() + VOL_HOLD, sent: self._vol ? self._vol.sent : null };
        tk.style.setProperty('--v', v.toFixed(3));
        var d = self._drag, now = Date.now();
        if (!d) { send(); return; }
        if (now - d.sent >= VOL_EVERY) send(); else if (!d.t) d.t = setTimeout(send, VOL_EVERY - (now - d.sent));
      };
      tk.addEventListener('pointerdown', function (ev) {
        if (!self._ctx()) return;
        self._drag = { id: ev.pointerId, sent: 0, t: null };
        try { tk.setPointerCapture(ev.pointerId); } catch (e) { /* a mouse */ }
        move(ev.clientX);
      });
      tk.addEventListener('pointermove', function (ev) { if (self._drag && ev.pointerId === self._drag.id) move(ev.clientX); });
      var end = function (ev) {
        if (!self._drag || (ev && ev.pointerId !== self._drag.id)) return;
        send(); self._drag = null;
        if (self._vol) self._vol.until = Date.now() + VOL_HOLD;
      };
      tk.addEventListener('pointerup', end);
      tk.addEventListener('pointercancel', end);
    }
    _switchTo(key) {
      var Mu = this._M();
      if (!Mu || !Mu.known(key)) return;
      Mu.setFocus(key);
      this._closePanel(false);
      this._toast('Now showing ' + Mu.label(Mu.contexts(this.client).filter(function (x) { return x.key === key; })[0] || { key: key, kind: 'room', members: [key], leader: key }));
    }

    // ------------------------------------------------------------ playing
    // THE OTHER ROOMS, LEFT PLAYING SOMETHING ELSE: asked once, as Play
    // Music asks it (hk-media.js _askThenPlay)
    _askThenPlay(rooms, go) {
      var Mu = this._M(), c = this._ctx(), self = this;
      var others = Mu.contexts(this.client).filter(function (x) {
        return (!c || x.key !== c.key) && x.members.some(function (r) { return rooms.indexOf(r) < 0; });
      });
      if (!others.length || !C.confirmSheet) { go(); return; }
      var left = [];
      others.forEach(function (x) { x.members.forEach(function (r) { if (rooms.indexOf(r) < 0) left.push(r); }); });
      var detail = others.length === 1 ? Mu.label(others[0]) + (others[0].title ? ' · ' + others[0].title : '')
                                        : others.map(function (x) { return Mu.label(x); }).join(', ');
      C.confirmSheet('Also stop the other rooms?', function () {
        self._callResp('hk_frontend', 'music_stop', { rooms: left }).then(function () { go(); });
      }, { detail: detail, yes: 'Stop Playing', no: 'Leave Playing', onNo: go });
    }
    _playPlaylist(pl, opt) {
      var rooms = this._rooms(), self = this, Mu = this._M(), c = this._ctx();
      if (!rooms.length) return;
      // (what plays now, left on rooms of its own: said once it has started)
      var left = this._nextSet() && c.members.some(function (r) { return rooms.indexOf(r) < 0; }) ? (c.title || Mu.label(c)) : '';
      var key = opt ? opt.key : pl.key, name = opt ? opt.name : pl.name;
      this._askThenPlay(rooms, function () {
        self._busyPl = pl.name; self._refreshPlaylists(true);
        self._toast('Starting ' + name + '…');
        var guess = playTarget(rooms, Mu.presets()).player;
        if (guess && Mu.known(guess)) Mu.setFocus(guess, { hold: true });
        self._callResp('hk_frontend', 'music_play', { rooms: rooms, playlist: key }).then(function (res) {
          var r = (res && res.response) || {};
          self._busyPl = null; self._openOpts = null; self._refreshPlaylists(true);
          if (!res.ok || r.ok === false) { if (guess) Mu.release(guess); self._toast('Could not play ' + name + (r.message ? ': ' + r.message : '')); return; }
          if (r.leader && Mu.known(r.leader)) Mu.setFocus(r.leader, { hold: true });
          self._toast('Playing ' + name + ' on ' + self._roomsLabel(rooms) + (left ? ' \u2014 ' + left + ' plays on' : ''));
          self._nextRooms = null; self._refreshPlaylists(true);
        });
      });
    }
    // A LIBRARY ITEM: on what plays; nothing playing, on the rooms picked --
    // one player first (a preset's group, the room, or the first of a set),
    // then the others brought in
    _playNode(node) {
      var c = this._ctx(), self = this, Mu = this._M();
      var rooms = this._rooms(), next = this._nextSet(), t, free = null;
      if (c && !next) t = { player: c.key, then: null };
      else if (next) {
        // ON ROOMS OF ITS OWN: what plays first moves off the rooms picked
        // (music_transfer to the rooms it keeps -- the engine releases the
        // rest), then the item plays there; picked rooms that are all of it
        // replace it on its own player
        var keep = c.members.filter(function (r) { return rooms.indexOf(r) < 0; });
        if (!keep.length) t = { player: c.key, then: rooms.length > c.members.length ? rooms.slice() : null };
        else {
          t = playTarget(rooms, Mu.presets());
          if (c.members.some(function (r) { return rooms.indexOf(r) >= 0; })) free = { rooms: keep, source: c.key };
        }
      } else t = playTarget(rooms, Mu.presets());
      if (!t.player) return;
      var label = this._roomsLabel(rooms);
      var go = function () {
        self._toast('Playing ' + node.title + ' on ' + label);
        (free ? self._callResp('hk_frontend', 'music_transfer', free) : Promise.resolve({ ok: true })).then(function (fr) {
          var fa = (fr && fr.response) || {};
          if (fr && (!fr.ok || fa.ok === false)) { self._toast('Could not free ' + label + (fa.message ? ': ' + fa.message : '')); return; }
          return play();
        });
      };
      var play = function () {
        self._nextRooms = null; self._refreshPlaylists(true);
        return self._callResp('hk_frontend', 'music_play_media', { player: t.player, media_content_id: node.media_content_id,
                                                           media_content_type: node.media_content_type }).then(function (res) {
          var r = (res && res.response) || {};
          if (!res.ok || r.ok === false) { self._toast('Could not play ' + node.title + (r.message ? ': ' + r.message : '')); return; }
          if (Mu.known(t.player)) Mu.setFocus(t.player);
          if (t.then) {
            self._callResp('hk_frontend', 'music_transfer', { rooms: t.then, source: t.player }).then(function (r2) {
              var a = (r2 && r2.response) || {};
              if (a.leader && Mu.known(a.leader)) Mu.setFocus(a.leader);
            });
          }
        });
      };
      if (c && !next) go(); else this._askThenPlay(rooms, go);
    }

    // ------------------------------------------------------------ Your Playlists
    // In Browse's first level (its rootExtra): the Play Music tiles, saying
    // where they play, with Change
    _playlistsEl() {
      var self = this, el = document.createElement('div');
      el.className = 'sec yp';
      el.addEventListener('click', function (ev) {
        var x = ev.target.closest && ev.target.closest('.rx');
        if (x) { self._nextRooms = null; self._refreshPlaylists(true); return; }
        var t = ev.target.closest && ev.target.closest('[data-pl],[data-opt],.chgl');
        if (!t) return;
        if (t.classList.contains('chgl')) { self._openPick(self._routeBtn || t); return; }
        var pls = self._M().playlists() || [];
        if (t.hasAttribute('data-opt')) {
          var ij = t.getAttribute('data-opt').split(':'), p0 = pls[+ij[0]];
          if (p0) self._playPlaylist(p0, p0.options[+ij[1]]);
          return;
        }
        var p = pls[+t.getAttribute('data-pl')];
        if (!p || self._busyPl) return;
        if (p.options && p.options.length) { self._openOpts = self._openOpts === p.name ? null : p.name; self._refreshPlaylists(true); return; }
        self._playPlaylist(p, null);
      });
      this._plEl = el;
      return el;
    }
    _refreshPlaylists(force) {
      var el = this._plEl, Mu = this._M();
      if (!el || !Mu) return;
      var pls = Mu.playlists() || [], self = this;
      var c = this._ctx(), set = this._nextSet();
      var keep = set ? c.members.filter(function (r) { return self._nextRooms.indexOf(r) < 0; }) : [];
      // the button beside the search, and its line (whatever the playlists)
      if (this._routeBtn) {
        var ri = this._routeInner();
        if (this._routeBtn.__t !== ri) { this._routeBtn.innerHTML = ri; this._routeBtn.__t = ri; }
      }
      if (this._noteEl) {
        var note = set ? '<hk-icon icon="mdi:volume-high"></hk-icon><span>' + esc(keep.length ? (c.title || Mu.label(c)) + ' keeps playing on ' + this._roomsLabel(keep) + '.'
                                                                                         : (c.title || Mu.label(c)) + ' stops: your next pick replaces it.') + '</span>' : '';
        if (this._noteEl.__t !== note) { this._noteEl.innerHTML = note; this._noteEl.__t = note; }
      }
      var sig = JSON.stringify([pls, this._label(), this._nextLabel(), set, keep, c && c.title, this._openOpts, this._busyPl]);
      if (!force && sig === el.__sig) return;
      el.__sig = sig;
      if (!pls.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
      el.style.display = '';
      var html = '<div class="yph"><h3>Your Playlists</h3></div><div class="grid cats">';
      pls.forEach(function (p, i) {
        var open = self._openOpts === p.name, busy = self._busyPl === p.name;
        html += '<div class="it cat tile' + (open ? ' on' : '') + (busy ? ' busy' : '') + '" data-pl="' + i + '"><div class="well"><hk-icon icon="' + esc(p.icon || 'mdi:playlist-music') + '"></hk-icon></div>' +
                '<div class="txt">' + esc(p.name) + '</div></div>';
        if (open && p.options) html += '<div class="opts">' + p.options.map(function (o, j) { return '<div class="opt" data-opt="' + i + ':' + j + '">' + esc(o.name) + '</div>'; }).join('') + '</div>';
      });
      el.innerHTML = html + '</div>';
    }
    // "PLAYS ON <rooms>" (or, picked, "Next plays on" white with its X): one
    // button, in Your Playlists' heading and in the trail's row
    // what is in it: the glyph, "Plays on <rooms>" (a phone folds it to the
    // count while searching), and > -- or, picked, "Next plays on" and an X
    _routeInner() {
      var set = this._nextSet(), nl = this._nextLabel(), n = this._rooms().length;
      var el = this._routeBtn;
      if (el) {
        el.classList.toggle('set', set);
        el.setAttribute('aria-label', (set ? 'Next plays on ' : 'Plays on ') + nl + '. Change');
      }
      return '<hk-icon icon="hk:homepod"></hk-icon><span class="full"><span>' + (set ? 'Next plays on' : 'Plays on') + '</span><b>' + esc(nl) + '</b></span>' +
             '<span class="num">' + n + '</span>' +
             (set ? '<i class="rx" role="button" aria-label="Back to what is playing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></i>'
                  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>');
    }
    _routeEl() {
      var self = this, el = document.createElement('div');
      el.className = 'route chgl';
      el.setAttribute('role', 'button');
      this._routeBtn = el;
      el.innerHTML = this._routeInner();
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (ev.target.closest && ev.target.closest('.rx')) { self._nextRooms = null; self._refreshPlaylists(true); return; }
        self._openPick(el);
      });
      return el;
    }

    // ------------------------------------------------------------ Plays on
    // A TAP ON "Plays on" OPENS THE SPEAKERS PANEL (2026-10-14, the user's
    // ask: the same one as the desk's column) -- dropped down under the
    // button on two columns, the page's own Speakers sheet on a phone. Its
    // ticks are where the next pick plays (_setNext), and Update moves what
    // plays there. On three columns the column is always up instead.
    _openPick(anchor) {
      var self = this, e = this._e, P = window.hkSaverPanel;
      if (!e || !P || !this._panelCss()) return;
      if (this._cols === 1) { if (!(this._pnl && this._pnl.p.tab() === 'speakers')) this._openPanel('speakers'); return; }
      if (this._cols === 3) { this._openPanel('speakers'); return; }
      this._closePick();
      this._closePanel(false);
      var card = this._root.querySelector('hk-plate');
      var scrim = document.createElement('div'); scrim.className = 'pkscrim';
      var box = document.createElement('div'); box.className = 'pk';
      var cr = card.getBoundingClientRect(), ar = (anchor || card).getBoundingClientRect();
      // AS TALL AS THE SCREEN ALLOWS: down to where the player's column ends
      // -- the window's foot, or above a tab bar along the bottom -- so its
      // foot lines up with Now Playing's
      var foot = e.left.getBoundingClientRect().bottom || (window.innerHeight || 800) - 16;
      var w = Math.min(380, Math.round(cr.width - 16)), h = Math.round(Math.max(320, foot - ar.bottom - 8));
      box.style.right = Math.max(0, Math.round(cr.right - ar.right)) + 'px';
      box.style.top = Math.round(ar.bottom - cr.top + 8) + 'px';
      box.style.width = w + 'px'; box.style.height = h + 'px';
      card.appendChild(scrim); card.appendChild(box);
      var o = this._panelOpts(['speakers', 'volume'], true);
      // (its X, and a moment after Update has landed, close it)
      o.done = function (ms) { clearTimeout(self._pickT); self._pickT = setTimeout(function () { self._closePick(); }, ms || 0); };
      var p = P.create(o);
      p.el.classList.add('pg', 'up');
      box.appendChild(p.el);
      p.size(w, h, 1);
      p.show('speakers');
      this._pk = { el: box, scrim: scrim, p: p };
      scrim.addEventListener('click', function () { self._closePick(); });
    }
    // the rooms picked: back to "what plays" when they are just that (null:
    // back to it). Plays on's panel, the Speakers panel and the desk's
    // column all set them, and each shows what the others picked.
    _setNext(rooms) {
      var c = this._ctx(), same = function (a, b) { return a.length === b.length && a.every(function (r) { return b.indexOf(r) >= 0; }); };
      if (c) this._nextRooms = !rooms || same(rooms, c.members) ? null : rooms.slice();
      else if (rooms) { this._target = rooms.slice(); this._hkSig = null; }
      this._drawPick();
      this._refreshPlaylists(true);
      if (this._roomsPnl) this._roomsPnl.update();
      if (this._pnl) this._pnl.p.update();
      if (!c && this.client) this.redraw();
    }
    _drawPick() { if (this._pk) this._pk.p.update(); }
    _closePick() {
      var p = this._pk;
      if (!p) return;
      this._pk = null;
      clearTimeout(this._pickT);
      p.p.destroy(); p.el.remove(); p.scrim.remove();
    }

    // ------------------------------------------------------------ the panel
    // Turned over in place of the left column (a sheet on a phone); its tabs
    // Speakers, Volume, Queue -- Queue alone with the desk's rooms column
    // showing (Speakers and Volume are its tabs)
    _openPanel(tab) {
      var P = window.hkSaverPanel, self = this;
      if (!this._e) return;                 // not built (the Music feature is not added)
      if (this._cols === 3 && (tab === 'speakers' || tab === 'volume')) {
        if (this._roomsPnl && this._roomsPnl.tab() !== tab) this._roomsPnl.show(tab);
        var r = this._e.rooms; r.classList.remove('hl'); void r.offsetWidth; r.classList.add('hl');
        return;
      }
      if (!P || !this._panelCss()) return;
      if (this._pnl) {
        if (this._pnl.p.tab() === tab) this._closePanel(true); else { this._pnl.p.show(tab); this._buttons(); }
        return;
      }
      var tabs = this._cols === 3 ? ['queue'] : ['speakers', 'volume', 'queue'];
      var p = P.create(this._panelOpts(tabs, false));
      if (tabs.length === 1) p.el.classList.add('one');
      var sheet = this._cols === 1;
      p.el.classList.add(sheet ? 'sheet' : 'pg');
      p.el.classList.add('up');
      var me = this._pnl = { p: p, sheet: sheet };
      if (sheet) {
        this._root.querySelector('hk-plate').appendChild(p.el);
        p.size(window.innerWidth, Math.min(640, window.innerHeight * 0.86), 1);
        p.show(tab);
        this._e.scrim.classList.add('on');
        requestAnimationFrame(function () { requestAnimationFrame(function () { p.el.classList.add('in'); }); });
      } else {
        this._e.left.appendChild(p.el);
        p.size(this._e.left.clientWidth, this._e.left.clientHeight, 1);
        p.show(tab);
        this._turn(true, me);
      }
      this._buttons();
    }
    _closePanel(animated) {
      var me = this._pnl, self = this;
      if (!me) return;
      this._pnl = null;
      clearTimeout(this._doneT);
      var finish = function () { me.p.destroy(); if (self._e) { self._e.front.style.visibility = ''; self._e.pon.style.visibility = ''; self._e.house.style.visibility = ''; } };
      if (me.sheet) {
        this._e.scrim.classList.remove('on');
        me.p.el.classList.remove('in');
        if (animated) setTimeout(finish, 380); else finish();
      } else if (animated) this._turn(false, me, finish);
      else finish();
      if (this._e) this._buttons();
    }
    // THE TURN: ONE CARD, TWO FACES. The column turns over in one motion
    // (preserve-3d): what plays is its front, the panel its back (turned
    // 180 degrees, its back face hidden), so neither is ever swapped in
    // mid-turn -- the two-step turn showed nothing at all for a few frames
    // between its halves. Done, the column is flat again with only the face
    // in front showing, so text is never drawn turned. (Glass here is a plate
    // of its own, never the dashboard's shared blur: that is cut to a
    // surface's flat box, and stayed flat while it turned -- solid boxes in
    // the recording, 2026-10-11.)
    _turn(opening, me, done) {
      var e = this._e, el = me.p.el, left = e.left, parts = [e.pon, e.house, e.front], self = this;
      var reduce = ((window.hkSettings && window.hkSettings.rendering && !window.hkSettings.rendering().motion) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
      var show = function (front) { parts.forEach(function (x) { x.style.visibility = front ? '' : 'hidden'; }); el.style.visibility = front ? 'hidden' : ''; };
      if (reduce || typeof left.animate !== 'function') { show(!opening); if (done) done(); return; }
      if (this._turnAnim) { try { this._turnAnim.cancel(); } catch (x) { /* done */ } }
      // both faces up, the panel on the back
      parts.forEach(function (x) { x.style.visibility = ''; });
      el.style.visibility = '';
      el.classList.add('back');
      left.classList.add('turning');
      var from = opening ? 0 : 180, to = opening ? 180 : 0;
      var a = this._turnAnim = left.animate([{ transform: 'perspective(1800px) rotateY(' + from + 'deg)' },
                                             { transform: 'perspective(1800px) rotateY(' + to + 'deg)' }],
                                            { duration: TURN_MS, easing: 'cubic-bezier(.45,.05,.25,1)' });
      a.onfinish = a.oncancel = function () {
        if (self._turnAnim === a) self._turnAnim = null;
        left.classList.remove('turning');
        el.classList.remove('back');
        show(!opening);
        if (done) done();
      };
    }

    _toast(t) {
      var e = this._e;
      if (!e) return;
      e.toast.textContent = t;
      e.toast.classList.add('on');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(function () { e.toast.classList.remove('on'); }, 2400);
    }
  }

  register('hk-music-card', HkMusicCard, 'HK Music',
    'The Music page: what plays and where (Speakers, Volume, Queue), with Browse Music beside it.',
    [{ name: 'focus_search', label: 'Start in the search box', selector: { boolean: {} } }],
    function () { return {}; });

  window.hkMusicPage = { version: '1.0.0', _: { fitNames: fitNames, playTarget: playTarget, volumeCalls: volumeCalls, list: list } };
  });
})();
