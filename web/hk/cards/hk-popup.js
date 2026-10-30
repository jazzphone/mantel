// hk-popup.js -- a hash-driven sheet over the dashboard, as a native card.
//
// A native replacement for custom:bubble-card's pop-ups: bubble-card is
// about 1 MB -- 40% of a page load on every dashboard -- and three pop-ups
// (#alarm, #media, #doorbell) are all it is needed for.
//
// WHAT A POP-UP NEEDS, from bubble-card's configs and bubble-card.js itself:
//
//   hash                open while location.hash equals it; closing removes it.
//                       An automation can open one by loading ".../0#doorbell"
//                       on a wall tablet, so the hash is a public contract and
//                       is kept exactly.
//   position            center (#alarm, #doorbell) or bottom (#media, which
//                       grows upward from a fixed bottom edge).
//   width / background  e.g. 900px on #1c1c1e; 88% transparent for #media.
//   auto_close          e.g. 60 s on #alarm and #doorbell.
//   close outside       a tap on the dimmed backdrop closes.
//   trigger             #media opens itself when its conditions become true and
//                       (trigger_close) shuts when they become false.
//   close_action        (supported)
//
// AND ONE THING BUBBLE CANNOT DO, for #media:
//   dismissable         a hand-closed sheet stays closed on THAT screen until
//                       the session ends -- not a home-wide input_boolean that
//                       hides it on every screen at once. Level-triggered,
//                       survives a reload. See "dismissal" below.
//   entity_from / grace state conditions that follow a selector's mapped
//                       entity, and stay true N seconds after it leaves.
//
// BUBBLE'S TRIGGER RULES, copied rather than reinvented (its `ro`/`so`):
//   * evaluated only when the result CHANGES;
//   * true  -> open, unless already open;
//   * false -> close if trigger_close -- EXCEPT on the very first evaluation
//     after page load, so a reload never slams shut a sheet that was opened by
//     URL (a tablet told to load "#alarm" while the trigger is false).
// And its close_action rule (`Ga`/`Na`): run on every close, except when the
// hash changed to ANOTHER pop-up's -- switching sheets is not closing.
//
// WHERE THE SHEET LIVES: inside home-assistant's shadow root, NOT document.body.
// The cards in it fire the host's more-info, action and show-dialog events, and
// home-assistant only hears events that bubble through it. Mounted on body, a
// lock tile in the alarm sheet would tap and do nothing. Inside the root the
// events bubble (composed) up to the host and work; the theme still reaches it,
// because HA writes theme variables on <html>. More-info dialogs render in the
// browser's top layer, so they still open ABOVE the sheet.
//
// NOT inside the card's own shadow root: the view can carry a transform or
// opacity, and position:fixed under a transformed ancestor is
// positioned against that ancestor, not the screen.
//
// THE CHILD CARDS are built once, on first open, by HA's own
// createCardElement, and fed their client ONLY while open. Closed, they are detached --
// which is what stops the doorbell's live stream -- and cost nothing.
(function () {
  'use strict';

  var CSS = [
    // NO TAP HIGHLIGHT ANYWHERE IN THE SHEET. hk-tap.js clears Android
    // WebView's highlight on partial-panel-resolver, but this sheet is
    // mounted in home-assistant's shadow root, BESIDE that element, so nothing
    // in a pop-up inherits it: every keypad key would flash the WebView
    // default -- a square blue box that ignores the key's radius. The property
    // inherits, so setting it here covers every card inside.
    '.hkp{-webkit-tap-highlight-color:transparent;',
    // the dashboard's font, and the theme's variable for the cards in it: a
    // pop-up is mounted outside the view (hk-base.js puts --hk-font-body on
    // the root; this sheet is built before hk-base may have loaded)
    '  --ha-font-family-body:var(--hk-font-body);font-family:var(--hk-font-body)}',
    '.hkp{position:fixed;inset:0;z-index:7;display:flex;justify-content:center;',
    '  align-items:center;pointer-events:none;box-sizing:border-box}',
    // A MODAL SHEET CENTRES ON THE DASHBOARD, not the window: past Home
    // Assistant's sidebar (hk-menu.js publishes where the dashboard starts),
    // over the whole dashboard -- a docked menu is part of it. The backdrop,
    // inset 0, still covers everything.
    // ...and clear of a side safe area, a plain bar too (the iPhone Duo's
    // strip, a phone turned: hk-base.js SAFE, 2026-10-30) -- its backdrop
    // still covers everything
    '.hkp:not(.plain){padding-left:max(var(--hk-content-left,0px), var(--hk-safe-left,env(safe-area-inset-left,0px)))}',
    '.hkp{padding-right:var(--hk-safe-right,env(safe-area-inset-right,0px))}',
    '.hkp.plain{padding-left:var(--hk-safe-left,env(safe-area-inset-left,0px))}',
    '.hkp.bottom{align-items:flex-end}',
    // THE TAB BAR (hk-tabbar.js) keeps the bottom of the screen: a bar that
    // grows up from the bottom (the now-playing bar) sits above it, as iOS
    // stacks its mini player over the tab bar. Unset without one.
    '.hkp.bottom.plain{padding-bottom:var(--hk-tabbar-h,0px)}',
    // DOCKED (`dock`): the sheet is the screen's bottom edge, full width, its
    // cards' own frames square to it
    // its hairline and its shadow up onto the page are the whole docked
    // group's -- the timers over the player as much as the player alone
    '.hkp.dock .sheet{overflow:visible;border-top:1px solid rgba(255,255,255,0.10);',
    '  box-shadow:0 -14px 36px rgba(0,0,0,.40),0 -2px 10px rgba(0,0,0,.24)}',
    '.hkp.dock.empty .sheet{border-top-color:transparent;box-shadow:none}',
    // (one plate: no gap between what is docked in it)
    '.hkp.dock .sheet>:not([data-hk-glass-layer]):not(.x)~:not([data-hk-glass-layer]):not(.x){margin-top:0}',
    // the screen's very bottom, under the tab bar: the tab bar rides above it
    '.hkp.bottom.plain.dock{padding-bottom:0;z-index:5}',
    // ...THE WHOLE WIDTH, under a docked menu and a tab bar rail as well:
    // they end above it instead (hk-menu.js, hk-tabbar.js --hk-dock-h), as a
    // bottom tab bar rides over it -- nothing lies over it, and no gap is
    // left beside it (2026-10-10, the user's call)
    '.hkp.bottom.plain.dock{padding-left:0;padding-right:0}',
    // ...its plate under a side safe area too, as a native bar's, and what
    // is on it clear of one (the iPhone Duo's strip, a phone turned:
    // hk-base.js SAFE, 2026-10-30)
    '.hkp.dock .sheet>:not([data-hk-glass-layer]){margin-left:var(--hk-safe-left,env(safe-area-inset-left,0px));margin-right:var(--hk-safe-right,env(safe-area-inset-right,0px))}',
    // A DOCKED BAR'S BOX IS THE BAR, NOT THE WINDOW. Composited, the box is a
    // layer of its own, and at inset:0 that layer was the whole window and
    // more (its shadow's overflow): 1388 x 840 on a 1280 x 800 tablet, 1.14
    // screens of tile memory for a 105 px bar, repainted on every tick of the
    // progress bar. A wall tablet's WebView has about one screen to spare on
    // Home, so coming back to Home it ran out ("tile memory limits exceeded")
    // and left the bar undrawn for a frame or two -- the bar blinking off and
    // on as it came up. Ending the box at the bar's top edge makes the layer
    // the bar and its shadow (~1280 x 210). Nothing above the bar is the
    // sheet's to catch: a non-modal sheet's backdrop is never drawn or
    // touched, so it goes (it was a full-window box of its own).
    '.hkp.bottom.plain.dock{top:auto}',
    '.hkp.dock .bd{display:none}',
    // NOW PLAYING AS A PANE (2026-10-15; the screen's Show As: Side Pane,
    // placeFor below): the docked bar's sheet stood up as a column down one
    // side of the screen, the whole height, the screensaver's music pane in
    // it (hk-music-pane-card, hk-saver.js) -- the page beside it is narrowed
    // by its width (hk-menu.js, --hk-pane-l / -r). The player bar in the
    // same sheet steps aside; the timers stay at the pane's top.
    '.hkp.side{top:0;bottom:0;left:auto;right:0;width:var(--hk-pane-w,400px);padding:0!important;',
    '  align-items:stretch;justify-content:stretch;z-index:5}',
    // (a left pane beside a docked menu, past Home Assistant's sidebar)
    '.hkp.side.sl{right:auto;left:var(--hk-menu-right,0px)}',
    '.hkp.side .sheet{width:100%!important;max-width:none!important;height:100%;max-height:none;display:flex;flex-direction:column;',
    // (overflow visible: the pane's own shadow falls onto the page)
    '  overflow:visible;border-top:0;box-shadow:none;transform:translateX(104%)}',
    '.hkp.side.sl .sheet{transform:translateX(-104%)}',
    '.hkp.side.open .sheet{transform:none}',
    // (it SLIDES in from its edge, solid all the way -- no fade on top of
    // the slide: a pane comes in, it doesn't appear)
    '.hkp.side .sheet{opacity:1;transition:transform .34s cubic-bezier(.32,.72,0,1)}',
    '.hkp.side .sheet>hk-now-playing-card{display:none}',
    '.hkp:not(.side) .sheet>hk-music-pane-card{display:none}',
    '.hkp.side .sheet>hk-music-pane-card{flex:1 1 auto;min-height:0}',
    // THE BAR ALONG THE TOP (Bar Position: Top): the docked bar's mirror --
    // the screen's top edge, its hairline and shadow down onto the page,
    // which starts below it (dockRoom)
    '.hkp.dock.top{top:0;bottom:auto;align-items:flex-start;padding:0;z-index:5}',
    '.hkp.dock.top .sheet{transform:translateY(-100%);border-top:0;border-bottom:1px solid rgba(255,255,255,0.10);',
    '  box-shadow:0 14px 36px rgba(0,0,0,.40),0 2px 10px rgba(0,0,0,.24)}',
    '.hkp.dock.top.open .sheet{transform:none}',
    '.hkp.dock.top.empty .sheet{border-bottom-color:transparent;box-shadow:none}',
    // ...and beside a tab bar RAIL (left or right, --hk-tabbar-l / -r while
    // it shows): it keeps the rail's column, so it never lies over the
    // rail's foot -- its More tab, or its small button (the bar is 100% wide,
    // so it fits what is left by itself)
    // (and a side safe area's: hk-base.js SAFE)
    '.hkp.bottom.plain{padding-left:max(var(--hk-tabbar-l,0px), var(--hk-safe-left,env(safe-area-inset-left,0px)));padding-right:max(var(--hk-tabbar-r,0px), var(--hk-safe-right,env(safe-area-inset-right,0px)))}',
    // Bubble's backdrop, measured: rgba(17,17,17,0.8), 0.3s opacity fade.
    '.hkp .bd{position:absolute;inset:0;background:rgba(17,17,17,0.8);opacity:0;',
    '  transition:opacity .3s ease;pointer-events:auto;-webkit-tap-highlight-color:transparent}',
    '.hkp.open .bd{opacity:1}',
    // Opacity + transform only: compositor properties, no layout per frame.
    // --hk-vh: the car dashboards zoom <html> (tesla-viewport.js), and a
    // viewport unit is zoomed with it -- 100dvh there is 67% of the screen.
    // tesla-viewport.js publishes the real height in layout px; unset
    // everywhere else, so this is plain 100dvh.
    '.hkp .sheet{position:relative;box-sizing:border-box;pointer-events:auto;',
    '  max-height:calc(var(--hk-vh, 100dvh) - 36px);overflow-y:auto;overscroll-behavior:contain;',
    '  -webkit-overflow-scrolling:touch;opacity:0;transform:translateY(24px) scale(.98);',
    '  transition:opacity .25s ease,transform .3s cubic-bezier(.32,.72,0,1)}',
    '.hkp.bottom .sheet{transform:translateY(100%)}',
    '.hkp.open .sheet{opacity:1;transform:none}',
    '.hkp.instant .sheet{transition:none}',
    '.hkp .sheet>*{display:block}',
    // Between CARDS only. hk-glass.js puts its frost layer (absolute, out of
    // flow) first in the sheet, and a plain `*+*` would give the first card
    // an 8px top margin the moment the layer arrives -- after the frost has
    // been measured, so the pills would move off their own frost.
    // ...and not after the X either: it sits first in the sheet (absolute,
    // out of flow), and the rule would give the camera card under it 8px,
    // opening a gap at the top of the camera pop-ups.
    '.hkp .sheet>:not([data-hk-glass-layer]):not(.x)~:not([data-hk-glass-layer]):not(.x){margin-top:8px}',
    '.hkp .sheet::-webkit-scrollbar{display:none}',
    // ---- NON-MODAL (`modal: false`) -----------------------------------------
    // The now-playing bar: it sits over the dashboard and the dashboard KEEPS
    // WORKING under it. Two properties do that, and both are on the backdrop
    // rather than the container -- `.hkp` is already pointer-events:none, so
    // the backdrop is the only thing that blocks taps.
    //
    //   no background   nothing is dimmed
    //   pointer-events  taps fall through to the dashboard
    //
    // close_outside is meaningless here and is ignored: with nothing to catch
    // the tap, "outside" is just the dashboard. That is what close_button is
    // for.
    '.hkp.plain .bd{background:none;pointer-events:none}',
    // The X. In the sheet's top-right corner, over whatever the sheet draws,
    // because the sheet's content is a card that knows nothing about being in
    // a pop-up.
    // --hk-popup-x-top/-right: the camera pop-ups put the X on the same line
    // as their name label (16px / 18px); everything else keeps 10 / 12.
    '.hkp .x{position:absolute;top:var(--hk-popup-x-top,10px);right:var(--hk-popup-x-right,12px);',
    '  z-index:3;width:34px;',
    '  height:34px;border-radius:17px;display:flex;align-items:center;',
    '  justify-content:center;cursor:pointer;pointer-events:auto;',
    // --hk-popup-x-bg: a sheet's own plate for it, through `vars`
    '  background:var(--hk-popup-x-bg,rgba(255,255,255,.16));color:rgba(255,255,255,.92);',
    '  --mdc-icon-size:19px}',
    '.hkp .x:active{background:rgba(255,255,255,.30)}',
    // OVER LIVE VIDEO (a sheet with a camera, .video) the white wash
    // vanished against a bright lawn or sky (the user, 2026-10-17): the X
    // sits on the dark plate the camera's name does, in every look
    '.hkp.video .x{background:rgba(28,28,30,.66);color:#fff}',
    // PREPARED UNSEEN: a sheet with a live camera opens at 1% until the
    // camera's first frame has been drawn -- see _show.
    '.hkp{transition:opacity .2s ease}',
    '.hkp.prep{opacity:.01}',
    // The dim still CATCHES taps while the sheet prepares (its click handler
    // ignores them): with pointer-events off, a second tap in that 1.2 s would
    // go straight through to the dashboard underneath -- another camera, a pill.
    '.hkp.prep .sheet,.hkp.prep .x{pointer-events:none}',
    '@media (prefers-reduced-motion:reduce){.hkp,.hkp .bd,.hkp .sheet{transition:none}}'
  ].join('');

  // ---------------------------------------------------------------- conditions
  // The subset of HA's condition vocabulary these configs use, plus the obvious
  // neighbours. Unknown condition types evaluate FALSE and say so once, rather
  // than silently opening a sheet.
  var warned = {};
  // ctx carries the clock and collects the soonest moment a `grace` window
  // runs out, so the card can re-evaluate exactly then instead of waiting for
  // an unrelated state change that may never come.
  function met(conds, states, ctx) {
    ctx = ctx || { now: Date.now(), next: Infinity };
    return (conds || []).every(function (c) { return one(c, states, ctx); });
  }

  // `grace`: how long a state condition STAYS true after the entity leaves the
  // state -- the equivalent of an automation's `from: playing, for: 20s`, which
  // keeps the widget up across a track change or a pause-and-resume.
  //
  // Timed from when THIS SCREEN SAW the change, not from last_changed. A wall
  // tablet's clock can be minutes off the server's, and a server timestamp
  // compared with Date.now() would stretch or skip the window by that much.
  // Consequence, and the right one: an entity already stopped when the page
  // loads is simply stopped -- no grace is invented for a stop nobody saw.
  var GRACE = {};

  function resolve(c, states) {
    if (c.entity) return c.entity;
    var f = c.entity_from;
    // `music: true` -- the player THIS screen shows, per hkMusic
    // (cards/hk-base.js).
    if (f && f.music) return window.hkMusic ? window.hkMusic.player({ states: states }) : null;
    if (!f || !f.selector) return null;
    var sel = states[f.selector];
    return sel && f.map ? (f.map[sel.state] || null) : null;
  }

  function one(c, states, ctx) {
    var kind = c.condition || (c.entity || c.entity_from ? 'state' : '');
    var id = resolve(c, states);
    var st = id && states[id];
    var v = st ? st.state : undefined;
    switch (kind) {
      case 'and': return met(c.conditions, states, ctx);
      case 'or': return (c.conditions || []).some(function (x) { return one(x, states, ctx); });
      case 'not': return !(c.conditions || []).some(function (x) { return one(x, states, ctx); });
      case 'state':
        if (c.state_not != null) {
          return [].concat(c.state_not).map(String).indexOf(String(v)) === -1;
        }
        var hit = v !== undefined && [].concat(c.state).map(String).indexOf(String(v)) !== -1;
        if (!c.grace) return hit;
        // (`grace: now_playing`: the house's Hide After a Pause, read live)
        var gsec = c.grace === 'now_playing' ? npGraceSec() : Number(c.grace);
        // (THIS SCREEN'S MUSIC is one window whichever player it resolves
        // to: a pause that reads as idle -- Music Assistant's AirPlay
        // speakers -- can move the answer to another player, and a window kept
        // per player closed the bar at once instead of after its grace)
        var key = (c.entity_from && c.entity_from.music ? 'music' : id) + '|' + [].concat(c.state).join(',');
        var g = GRACE[key] || (GRACE[key] = { was: false, left: 0 });
        if (hit) { g.was = true; g.left = 0; return true; }
        if (g.was) { g.was = false; g.left = ctx.now; }
        if (!g.left) return false;
        var until = g.left + gsec * 1000;
        if (ctx.now >= until) { g.left = 0; return false; }
        ctx.next = Math.min(ctx.next, until);
        return true;
      // A PAGE'S SAY (`condition: flag, flag: <name>`): an attribute a card on
      // the page sets on <html> while it wants the sheet -- the Music page's
      // `hk-music-mini` while it is one column (a phone), where the docked
      // bar is its mini player; at two or three columns its own player is
      // the page and the bar would only repeat it. The card fires
      // `hk-popup-flags` when it changes, which re-evaluates (no state push
      // carries it).
      case 'flag':
        var de = document.documentElement;
        return !!(c.flag && de && de.hasAttribute && de.hasAttribute(c.flag));
      case 'numeric_state':
        var n = Number(v);
        if (v === undefined || v === '' || !isFinite(n)) return false;
        if (c.above != null && !(n > Number(c.above))) return false;
        if (c.below != null && !(n < Number(c.below))) return false;
        return true;
      default:
        if (!warned[kind]) {
          warned[kind] = true;
          console.warn('[hk-popup] unsupported condition, treated as false:', c);
        }
        return false;
    }
  }

  // ------------------------------------------------------------- dismissal
  // `dismissable`: closing the sheet by hand keeps it closed ON THIS SCREEN
  // for the rest of this session. A shared input_boolean would be ONE switch
  // for the whole home: dismiss the player on the kitchen tablet and it would
  // vanish from every tablet and phone at once.
  //
  // THE SESSION ends when the trigger goes false (playback stopped past its
  // grace, no timer running) or when the dismiss_scope signature changes (a
  // different speaker is selected, a timer starts) -- either reopens it.
  //
  // SURVIVES A RELOAD, via localStorage. The stored record carries `seen`, the
  // last time this screen confirmed the session was still running; a record
  // older than STALE_MS is a session that ended while nothing was watching (a
  // phone put away, music stopped, started again hours later) and is ignored.
  // STALE_MS is minutes, not seconds, because a hidden page's timers are
  // throttled to about one a minute and the screensaver hides the page.
  var STALE_MS = 5 * 60 * 1000, TOUCH_MS = 20 * 1000;
  // How long a sheet opened BY THE URL is given to see its own trigger become
  // true before it closes itself. Long enough for a cold tablet to receive its
  // first full state dump, short enough that a stale hash is not a bar you
  // cannot get rid of. See the first-evaluation grace in _evalTrigger.
  var FIRST_CLOSE_MS = 5000;
  // The longest a sheet with a live camera stays invisible waiting for the
  // first frame (see _show: PREPARED UNSEEN). Typically ready in ~0.6 s.
  var PREP_MAX_MS = 1200;

  // THE SCREENSAVER ENDS THE SESSION: once WallPanel has started again, a
  // hand-closed bar reappears the next time the dashboard comes up.
  //
  // Without this a hand-closed bar stays closed essentially forever on a wall
  // tablet. STALE_MS cannot save it: the dismissed card refreshes `seen` every
  // TOUCH_MS, so a live page never goes stale -- that refresh exists so a
  // BACKGROUNDED page (a phone in a pocket) expires and a watched one does not.
  // Walking away and coming back is the one case where the record should be
  // forgotten, and the screensaver is precisely that event.
  //
  // `screensaverRunning` is a plain boolean property on WallPanel's
  // `wallpanel-view` element. The element lives inside nested shadow roots
  // and the screensaver's container div stays in the DOM whether or not it
  // is showing, so presence is NOT the signal -- the flag is.
  //
  // COSTS NOTHING WHEN NOT DISMISSED. This is only ever called from the
  // dismissable branch of _evalTrigger, which already re-evaluates on its own
  // TOUCH_MS timer while a record exists. No new timer, no observer, and no
  // work at all on a screen that has not closed the sheet by hand.
  var wpView = null, wpMissUntil = 0;
  function screensaverOn() {
    // HK Frontend's own screensaver (hk-saver.js) says so directly
    if (window.hkSaver && window.hkSaver.running && window.hkSaver.running()) return true;
    try {
      if (!wpView || !wpView.isConnected) {
        // A screen with no WallPanel (the phone, a desktop, the car) would
        // otherwise walk every shadow root on the page on every evaluation
        // while a dismissal record exists; remember the miss for a minute.
        if (Date.now() < wpMissUntil) return false;
        wpView = (function find(root) {
          var hit = root.querySelector('wallpanel-view');
          if (hit) return hit;
          var all = root.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) { var h = find(all[i].shadowRoot); if (h) return h; }
          }
          return null;
        })(document);
        if (!wpView) wpMissUntil = Date.now() + 60000;
      }
      return !!(wpView && wpView.screensaverRunning);
    } catch (e) { return false; }   // no WallPanel here (phone, desktop, car)
  }

  // A NON-MODAL SHEET MUST NOT COVER THE APP CHROME. `.hkp` is position:fixed
  // inset:0, so it spans the whole window -- including HA's sidebar rail,
  // which the now-playing bar's album art and the timer strip's first pill
  // would sit straight on top of.
  //
  // A wall tablet that sets `kiosk_mode.hide_sidebar` never shows this: there
  // is nothing to overlap. But `admin_settings` un-hides it, so an admin
  // looking at a tablet dashboard in a browser sees it too -- and a dashboard
  // with no kiosk_mode always does.
  //
  // MODAL SHEETS ARE LEFT ALONE. Covering everything is what a modal is for,
  // and HA's own dialogs do the same. This is only for `modal: false`, whose
  // whole premise is that the rest of the UI stays usable underneath.
  //
  // Measured rather than read from a variable: HA exposes no reliable custom
  // property for the rail's width (--mdc-drawer-width and --app-drawer-width
  // both come back empty), and it differs between the collapsed rail and the
  // expanded drawer.
  function sidebarWidth() {
    try {
      var sb = window.hkShell.sidebar();
      if (!sb) return 0;
      var b = sb.getBoundingClientRect();
      // Only a rail actually drawn at the left edge counts. A hidden sidebar
      // measures 0, and one pushed off-screen must not inset anything.
      return (b.width > 0 && b.left <= 1 && b.height > 0) ? Math.round(b.right) : 0;
    } catch (e) { return 0; }
  }
  // THE BAR RUNS THE DASHBOARD'S FULL WIDTH while every menu item stays
  // reachable -- past Home Assistant's own sidebar only (hk-menu.js
  // publishes --hk-content-left), the docked menu's column included, not
  // past the menu (--hk-page-left). It lies over the menu's foot, and says
  // how much of the screen's bottom it covers (publishBar): the docked menu
  // pads its list by that much, so every row still scrolls up clear of it.
  // (--hk-content-left is hk-menu's, written on <html>'s own style: read
  // there, not through getComputedStyle, which restyles the whole document
  // when anything is pending -- every page change)
  function insetLeft() {
    var c = 0;
    try { c = parseFloat(document.documentElement.style.getPropertyValue('--hk-content-left')) || 0; }
    catch (e) { c = 0; }
    return Math.max(sidebarWidth(), Math.round(c));
  }
  // --hk-bar-h on the root: from the bar's top edge to the bottom of the
  // window, while a non-modal sheet (the #media bar) is up; gone when it is
  // not. From LAYOUT (offsetTop in its full-window container), not from the
  // bounding box, which the open animation's translateY would shrink.
  function publishBar(el, sheet) {
    var de = document.documentElement;
    if (!de || !de.style) return;
    if (!el || !sheet || !sheet.isConnected) { de.style.removeProperty('--hk-bar-h'); dockRoom(0); return; }
    // A PANE takes no room at the bottom: its width is the page's to give
    // (publishPane); a bar along the TOP has its own (dockRoom's top)
    if (el.classList.contains('side')) { de.style.removeProperty('--hk-bar-h'); dockRoom(0); return; }
    var top = el.classList.contains('top');
    // (a docked bar's box ends at its top edge -- see .hkp.dock in CSS -- so
    // its height IS the bar's, and an empty one is 0, not "the window")
    var dock = el.classList.contains('dock');
    var h = Math.max(0, Math.round((dock ? (el.offsetHeight || 0) : (el.clientHeight || window.innerHeight || 0)) - (sheet.offsetTop || 0)));
    var v = h + 'px';
    // (--hk-bar-h is the bottom's: the docked menu's list and the stash
    // stand on it -- a bar at the top covers none of the bottom)
    if (top) de.style.removeProperty('--hk-bar-h');
    else if (de.style.getPropertyValue('--hk-bar-h') !== v) de.style.setProperty('--hk-bar-h', v);
    if (dock) {
      // NOTHING IN IT (the music stopped, no timers, the bar still up for its
      // grace): its hairline and shadow go too, and the page's room
      // (no cards in it YET -- a page's bar still being built -- is not
      // empty: what it shows is not known, and the room stays as it is)
      var built = Array.prototype.some.call(sheet.children, function (k) {
        return !k.hasAttribute('data-hk-glass-layer') && !k.classList.contains('x');
      });
      if (!built) return;
      var none = (sheet.offsetHeight || 0) <= 2;
      el.classList.toggle('empty', none);
      dockRoom(none ? 0 : sheet.offsetHeight, top);
    }
  }
  // A DOCKED BAR (`dock: true`, the now-playing bar since 2026-10-10) is the
  // bottom of the screen, and the page ends above it: the view on screen gets
  // that much room after it, so its last row scrolls up clear of the bar.
  // (A tab bar's own room is on the view's container -- hk-tabbar.js -- so
  // the two add up, and the bar sits above the tab bar.) Every view given
  // room is remembered: Home Assistant keeps views it has shown, and one
  // shown again after the bar has gone must not keep it.
  var dockH = 0, dockTop = false, docked = new Set();
  // ONE DOCKED BAR FROM PAGE TO PAGE (On Every Page): each page holds its own
  // pop-up, so changing pages takes one down and puts the next up. By hash:
  // how many are open, and when the last went because its page did. A bar
  // opening while another is open, or just after its page went, is the same
  // bar: it is there at once, no slide, and the one leaving goes at once.
  var CARRY = {}, CARRY_MS = 1500;
  // WHERE THE STASH SITS (on <html>, so the tab bar's state can move it):
  // the bottom-right corner, above a tab bar along the bottom
  // (--hk-tabbar-top) or clear of an iPhone's home-indicator strip. A tab
  // bar FOLDED to its small button (hk-tabbar.js `hk-tabbar-fold`): in its
  // row, at the other end, the same size -- iOS's folded tab bar and its
  // player side by side; hidden: the bare corner.
  var STASH_EASE = 'cubic-bezier(.32,.72,0,1)';
  var STASH_PAGE_CSS = [
    '.hk-stash{position:fixed;z-index:5;--s:48px;',
    '  right:max(16px, calc(var(--hk-safe-right, env(safe-area-inset-right, 0px)) + 8px));',
    '  bottom:max(var(--hk-tabbar-top, 0px), 16px, calc(env(safe-area-inset-bottom, 0px) + 10px));',
    '  transition:bottom .42s ' + STASH_EASE + ',opacity .22s ease,transform .3s cubic-bezier(.32,.72,0,1)}',
    'html[hk-tabbar-fold=start] .hk-stash,html[hk-tabbar-fold=end] .hk-stash{--s:calc(var(--hk-tabbar-bh, 54px) - 6px);',
    '  bottom:var(--hk-tabbar-row, 14px)}',
    // (the bar's own gutter, 21 px: the two buttons mirror each other)
    'html[hk-tabbar-fold=start] .hk-stash{right:max(21px, calc(var(--hk-safe-right, env(safe-area-inset-right, 0px)) + 8px))}',
    'html[hk-tabbar-fold=end] .hk-stash{right:auto;left:max(21px, calc(var(--hk-safe-left, env(safe-area-inset-left, 0px)) + 8px))}',
    'html[hk-tabbar-fold=gone] .hk-stash{bottom:max(16px, calc(env(safe-area-inset-bottom, 0px) + 10px))}',
    // ...and BESIDE A FULL BAR that leaves the corner free (a tablet's,
    // centered; hk-tabbar.js `hk-tabbar-room`): in its row, its size, as
    // beside the folded bar -- not floating above it over the page
    // (the bar's own height: a round button the size of its Rooms button)
    'html[hk-tabbar-room]:not([hk-tabbar-fold]) .hk-stash{--s:var(--hk-tabbar-bh, 60px);',
    '  bottom:var(--hk-tabbar-row, 14px);right:max(21px, calc(var(--hk-safe-right, env(safe-area-inset-right, 0px)) + 8px))}',
    // ACROSS THE SCREEN (folded to the right, and back) it does not slide
    // or jump: it pops up where it now goes -- a new animation name
    // restarts the pop; up and down the same side, `bottom` eases instead
    '@keyframes hkStashL{from{opacity:0;transform:scale(.6)}}@keyframes hkStashR{from{opacity:0;transform:scale(.6)}}',
    '.hk-stash.in{animation:hkStashR .3s cubic-bezier(.32,.72,0,1)}',
    'html[hk-tabbar-fold=end] .hk-stash.in{animation-name:hkStashL}'
  ].join('');
  // the stash's button: the dashboard's round glass, a glyph in it. NO
  // BLUR (2026-10-12): at .78 it barely showed, and a fixed button over the
  // scrolling page and the moving sky blurred again on every frame it was
  // up -- .94 with none looks the same and costs nothing
  var STASH_CSS = [
    '.b{box-sizing:border-box;width:var(--s,48px);height:var(--s,48px);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;',
    '  background:rgba(24,24,28,0.93);',
    '  border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 24px rgba(0,0,0,.38);color:#fff;',
    '  -webkit-tap-highlight-color:transparent;transition:transform .12s ease}',
    '.b:active{transform:scale(.94)}',
    '.b hk-icon{--mdc-icon-size:24px;width:24px;height:24px;opacity:.92}'
  ].join('');
  // Does the page now on the address have a pop-up of this hash? A bar is
  // carried only to a page that has one (not Play Music, its own player the
  // page); to any other it goes as it always has.
  // the view the URL shows, from the dashboard's config (null: not found)
  function shownView() {
    try {
      var cfg = window.hkShell.dashboardConfig(), views = cfg && cfg.views;
      if (!Array.isArray(views)) return null;
      var seg = String(location.pathname).split('/')[2] || '';
      return views.filter(function (x, i) { return x && (x.path === seg || (!x.path && String(i) === seg)); })[0] || (!seg ? views[0] : null);
    } catch (e) { return null; }
  }
  // every sheet config with this hash in a view
  function sheetsIn(v, hash) {
    var out = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.hash === hash) { out.push(o); return; }
      Object.keys(o).forEach(function (k) { walk(o[k]); });
    })(v);
    return out;
  }
  function pageHas(hash) {
    try {
      var v = shownView();
      if (!v) return false;
      // A SHEET THERE THAT WAITS ON A PAGE'S SAY (`flag`: the Music page's
      // bar, a phone's only) may or may not take it over, and the page has
      // not said yet -- it lays itself out after this. So: the flags it
      // waits on, and the bar stays up till the page says (see FLAGS
      // below): taken over in place on a phone, slid away on a tablet.
      var de = document.documentElement, wait = [], sure = false;
      sheetsIn(v, hash).forEach(function (o) {
        var f = [].concat(o.trigger || []).filter(function (c) { return c && c.condition === 'flag' && c.flag; })
          .map(function (c) { return c.flag; })
          .filter(function (n) { return !(de && de.hasAttribute && de.hasAttribute(n)); });
        if (!f.length) sure = true; else wait = wait.concat(f);
      });
      return sure || (wait.length ? wait : false);
    } catch (e) { return false; }
  }
  // A PAGE HAS SAID (hk-popup-flags): a bar kept up for a sheet waiting on a
  // flag the page did not raise goes now -- slid away, as a bar leaving
  // with its page always has -- not at CARRY_MS. One the page did raise is
  // the next sheet's to take over (it opens on the same event).
  window.addEventListener('hk-popup-flags', function () {
    var de = document.documentElement;
    Object.keys(CARRY).forEach(function (h) {
      var cr = CARRY[h], g = cr && cr.ghost;
      if (!g || !g.wait) return;
      if (g.wait.some(function (n) { return de && de.hasAttribute && de.hasAttribute(n); })) return;
      dropGhost(cr, true);
      if (!(cr.open > 0)) publishBar(null);
    });
  });
  // IS THIS SHEET THE SHOWN PAGE'S? A page's bar can still be connected for
  // a moment after the URL has moved on (a focus change, a flag, landing in
  // that moment), and it must not put its hash on the next page: there, a
  // sheet of the same hash would open by the URL whatever its own trigger
  // says -- the Music page's phone-only bar, up on a tablet. Yes when that
  // page has a sheet of this hash with the same trigger (a bar On Every Page
  // is the same everywhere), or when the dashboard cannot be read.
  function shownIsMine(cfg, hash) {
    var v = shownView();
    if (!v) return true;
    var t = JSON.stringify(cfg.trigger || null);
    return sheetsIn(v, hash).some(function (o) { return JSON.stringify(o.trigger || null) === t; });
  }
  function dropGhost(cr, slide) {
    var g = cr && cr.ghost;
    if (!g) return;
    cr.ghost = null;
    clearTimeout(g.t);
    var gone = function () {
      // (only what is still in it: a page gone back to has taken its cards)
      g.kids.forEach(function (k) { if (k.parentNode && g.el.contains(k)) k.parentNode.removeChild(k); });
      if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
    };
    // (slide: nothing takes it over -- away as a closing sheet goes)
    if (slide) { g.el.classList.remove('open'); setTimeout(gone, 320); } else gone();
  }
  function viewNow() {
    try {
      var v = window.hkShell.viewSlot();
      // the view itself, not the background beside it (fixed, first)
      return (v && (v.querySelector(':scope > ' + window.hkShell.tags.view) || v.lastElementChild)) || null;
    } catch (e) { return null; }
  }
  function dockRoom(h, top) {
    if (top === undefined) top = dockTop;
    dockH = h > 0 ? h : 0;
    dockTop = !!top && !!dockH;
    // ...and the tab bar rides above it (hk-tabbar.js lifts itself by this);
    // a bar along the top: --hk-dock-top, what a tab bar at the top and the
    // page's top stand on
    var de = document.documentElement, dv = dockH && !dockTop ? dockH + 'px' : '', tv = dockTop ? dockH + 'px' : '';
    if (de && de.style && (de.style.getPropertyValue('--hk-dock-h') !== dv || de.style.getPropertyValue('--hk-dock-top') !== tv)) {
      if (dv) de.style.setProperty('--hk-dock-h', dv); else de.style.removeProperty('--hk-dock-h');
      if (tv) de.style.setProperty('--hk-dock-top', tv); else de.style.removeProperty('--hk-dock-top');
      try { window.dispatchEvent(new Event('hk-dock')); } catch (e) { /* no listeners */ }
    }
    // (a tab bar along the bottom gives the page the room for both: its
    // lift takes the bar's height in)
    // (hk-tabbar's, on <html>'s own style -- as insetLeft)
    var tabbed = de && de.style.getPropertyValue('--hk-tabbar-h').trim();
    var view = dockH && (dockTop || !tabbed) ? viewNow() : null;
    docked.forEach(function (v) { if (v !== view) { v.style.removeProperty('margin-bottom'); v.style.removeProperty('margin-top'); docked.delete(v); } });
    if (!view) return;
    var m = dockH + 'px';
    // (at the top: the page starts below it -- its header, clock and all)
    if (dockTop) { if (view.style.marginTop !== m) view.style.marginTop = m; view.style.removeProperty('margin-bottom'); }
    else { if (view.style.marginBottom !== m) view.style.marginBottom = m; view.style.removeProperty('margin-top'); }
    docked.add(view);
  }
  // ...and the next page, as it comes: the view is swapped some frames after
  // the address changes, and a generated view says when it is up
  // (hk-view-ready, hk-layout.js) -- the room is given then, once. (It was
  // looked for ten times over 1.5 s, each look restyling the document in the
  // middle of the page's build.) A view of another kind says nothing: one
  // look once the page change is surely done.
  var dockWait = null;
  window.hkShell.onNavigate(function () {
    if (!dockH) return;
    clearTimeout(dockWait);
    dockWait = setTimeout(function () { dockWait = null; dockRoom(dockH); }, 1500);
  });
  window.addEventListener('hk-view-ready', function () {
    if (dockWait) { clearTimeout(dockWait); dockWait = null; }
    if (dockH) dockRoom(dockH);
  });

  // ------------------------------------------------------- NOW PLAYING'S PLACE
  // THE DOCKED BAR, A PANE OR A BAR ALONG THE TOP (2026-10-15). A docked
  // sheet with `pane` (the generated #media) asks the screen where Now
  // Playing goes (hkCards.menu.nowPlaying: All Screens' choice, or the
  // screen's own; a phone always the bar). A PANE only while music is up
  // (the timers alone are a bar) and only where it FITS: the page beside it
  // keeps PANE_PAGE_MIN, a docked menu and Home Assistant's sidebar taken
  // (--hk-menu-right, hk-menu.js), on a screen wider than tall. Otherwise the
  // bar, at the screen's Bar Position. Its width: the screensaver's pane,
  // 400 at a 1280 tablet, scaled with the screen's width.
  var PANE_W = 400, PANE_PAGE_MIN = 680;
  // the music gone, the pane stays as long as the bar would (its trigger's
  // grace), then the sheet closes -- or, with timers still running, is the bar
  var PANE_ARRIVE_MS = 1500;
  function npGraceSec() {
    var Mn = window.hkCards && window.hkCards.menu;
    return Mn && Mn.npGrace ? Mn.npGrace() : 30;
  }
  function paneWidth() {
    var W = window.innerWidth || 1280;
    return Math.round(PANE_W * Math.max(0.9, Math.min(1.25, W / 1280)));
  }
  function menuRight() {
    var n = 0;
    try { n = parseFloat(document.documentElement.style.getPropertyValue('--hk-menu-right')) || 0; } catch (e) { n = 0; }
    return Math.max(n, insetLeft());
  }
  function paneFits(w) {
    var W = window.innerWidth || 0, H = window.innerHeight || 0;
    return W > H && H >= 480 && W - menuRight() - w >= PANE_PAGE_MIN;
  }
  function placeFor(cfg, music) {
    var Mn = window.hkCards && window.hkCards.menu, np = Mn && Mn.nowPlaying ? Mn.nowPlaying() : null;
    if (!np || !cfg || !cfg.dock) return { kind: 'bar', bar: 'bottom' };
    if (cfg.pane && music && np.style === 'pane') {
      var w = paneWidth();
      if (paneFits(w)) return { kind: 'pane', side: np.side, w: w };
    }
    return { kind: 'bar', bar: np.bar };
  }
  // is there music for a pane (hk-saver.js: what plays, or is paused, that
  // this screen follows -- what the pane would show)
  function paneMusic(h) {
    var S = window.hkSaver;
    try { return !!(h && S && S.music && S.music.has && S.music.has(h)); } catch (e) { return false; }
  }
  // the pane's width on its side of <html> (hk-menu.js narrows the page,
  // hk-tabbar.js keeps clear of it), and the word that it changed
  function publishPane(side, w) {
    var de = document.documentElement;
    if (!de || !de.style) return;
    var l = side === 'left' && w ? w + 'px' : '', r = side === 'right' && w ? w + 'px' : '';
    if (de.style.getPropertyValue('--hk-pane-l') === l && de.style.getPropertyValue('--hk-pane-r') === r) return;
    if (l) de.style.setProperty('--hk-pane-l', l); else de.style.removeProperty('--hk-pane-l');
    if (r) de.style.setProperty('--hk-pane-r', r); else de.style.removeProperty('--hk-pane-r');
    if (l || r) de.setAttribute('hk-pane', l ? 'left' : 'right'); else de.removeAttribute('hk-pane');
    try { window.dispatchEvent(new Event('hk-pane')); } catch (e) { /* no listeners */ }
  }

  var memStore = {};
  function dget(h) {
    try { var j = localStorage.getItem('hk-popup-dismissed' + h); return j ? JSON.parse(j) : null; }
    catch (e) { return memStore[h] || null; }
  }
  function dset(h, rec) {
    try {
      if (rec) localStorage.setItem('hk-popup-dismissed' + h, JSON.stringify(rec));
      else localStorage.removeItem('hk-popup-dismissed' + h);
    } catch (e) { if (rec) memStore[h] = rec; else delete memStore[h]; }
  }

  // Every hash any hk-popup owns, so a close can tell "switched to another
  // sheet" from "closed".
  var HASHES = {};
  // ...and how many of each are ON THE PAGE right now, which is what
  // hkPopup.hashes() answers. A pop-up only works in the view it lives in,
  // and HASHES never forgets one: on the Alarm page (or a Lights page after
  // the home view) '#alarm' would still be "there", so the alarm's detail
  // tap would push a hash nothing answers -- a dead tap, with HA's own
  // dialog swallowed too.
  var MOUNTED = {};
  function mounted() {
    return Object.keys(MOUNTED).filter(function (h) { return MOUNTED[h] > 0; });
  }

  // How many sheets are open on this screen, for anything underneath that
  // should stop repainting while covered (the camera strip). Broadcast as
  // `hk-popup-change` so a paused card can catch up the moment it is uncovered.
  //
  // TWO COUNTS, and the second is the one that matters. The camera strip
  // pauses its snapshot refresh while a sheet is up, because swapping a
  // decoded snapshot under #alarm's backdrop-filter makes the whole screen
  // flash on the strip's 10s beat. "The strip is under the dimmed backdrop
  // anyway, so nothing is lost" is true of a MODAL sheet and false of a
  // `modal: false` one, which dims nothing and covers ~80px of a 800px
  // screen.
  //
  // Counting every sheet, a non-modal now-playing bar that stays up would
  // freeze every snapshot tile for as long as it is up, while the one LIVE
  // tile kept running because it is not a snapshot. So `hkPopupOpen` still
  // counts every sheet, and `hkPopupCover` counts only the ones that
  // actually cover the page. Cards that pause to avoid repaint cost should
  // read hkPopupCover.
  function openCount(delta, covers) {
    window.hkPopupOpen = Math.max(0, (window.hkPopupOpen || 0) + delta);
    if (covers) {
      window.hkPopupCover = Math.max(0, (window.hkPopupCover || 0) + delta);
    }
    window.dispatchEvent(new CustomEvent('hk-popup-change',
      { detail: { open: window.hkPopupOpen, cover: window.hkPopupCover || 0 } }));
  }

  // EVERY ENTITY A CONFIG'S TRIGGER DEPENDS ON, collected once from the config.
  //
  // This is what lets `_receiveClient` gate like every other card in the library.
  // Both halves of `entity_from` go in -- the SELECTOR (whose state chooses the
  // target) and EVERY entity its map can choose -- so a change to either the
  // choice or the chosen speaker wakes the card. `dismiss_scope` too, because
  // a change there is what re-opens a dismissed sheet.
  function triggerEntities(cfg) {
    var ids = [];
    (function walk(c) {
      if (!c) return;
      if (Array.isArray(c)) return c.forEach(walk);
      if (c.entity) ids.push(c.entity);
      var f = c.entity_from;
      if (f) {
        if (f.music && window.hkMusic) {
          window.hkMusic.speakers().forEach(function (s) { ids.push(s.entity); });
        }
        if (f.selector) ids.push(f.selector);
        if (f.map) Object.keys(f.map).forEach(function (k) { ids.push(f.map[k]); });
      }
      if (c.conditions) walk(c.conditions);
    })(cfg.trigger);
    (cfg.dismiss_scope || []).forEach(function (sc) {
      if (sc.entity) ids.push(sc.entity);
      if (sc.music && window.hkMusic) {
        window.hkMusic.speakers().forEach(function (s) { ids.push(s.entity); });
      }
    });
    // De-duplicated so the signature is stable and as short as it can be.
    return ids.filter(function (v, i) { return v && ids.indexOf(v) === i; });
  }

  function norm(h) { h = String(h || ''); return h && h.charAt(0) !== '#' ? '#' + h : h; }
  // IS THIS HASH ANOTHER SHEET'S? Two things own hashes: a YAML hk-popup-card
  // (HASHES) and the home's pop-up items, which hk-detail.js's router opens
  // (#doorbell, #alarm). Asking only the first, the now-playing bar on a
  // dashboard whose doorbell is an item would take the hash from the
  // doorbell sheet, close it under a ring, and count the ring as the user
  // dismissing the bar.
  function sheetHash(h) {
    if (!h) return false;
    if (HASHES[h]) return true;
    var D = window.hkDetail;
    return !!(D && typeof D.answers === 'function' && D.answers(h));
  }

  // A NEW ENTRY GETS ITS OWN (EMPTY) STATE, as HA's own navigate() does.
  // Copying history.state would let a pop-up opened over a detail sheet
  // inherit the sheet's {hkDetail} marker, and closing the sheet would then
  // take the pop-up's entry with it.
  function setHash(h) {
    var base = location.href.split('#')[0];
    if (h) history.pushState(null, '', base + h);
    else history.replaceState(history.state, '', base);
    window.hkShell.announce({ detail: { replace: !h } });
  }

  function boot() {
    var C = window.hkCards;
    if (!C || !C.HkBase) return false;
    if (customElements.get('hk-popup-card')) return true;

    class HkPopupCard extends C.HkBase {
      static get CSS() { return ':host{display:none}'; }

      setConfig(config) {
        if (!config || !config.hash) throw new Error('hk-popup: `hash` is required');
        // `detail: <entity>` in place of cards: the hash opens that entity's
        // detail sheet (hk-detail.js) instead of a sheet of this card's own
        if (!config.detail && !Array.isArray(config.cards)) throw new Error('hk-popup: `cards` must be a list');
        super.setConfig(config);
        this._hash = norm(config.hash);
        HASHES[this._hash] = true;
        if (this._mountedAs && this._mountedAs !== this._hash) {   // re-configured on the page
          MOUNTED[this._mountedAs] = Math.max(0, (MOUNTED[this._mountedAs] || 0) - 1);
          MOUNTED[this._hash] = (MOUNTED[this._hash] || 0) + 1;
          this._mountedAs = this._hash;
        }
        this._trigIds = triggerEntities(config);
        this._trigSig = null;          // a new config always re-evaluates
      }

      getCardSize() { return 0; }
      _render() {}                     // the host draws nothing, ever
      _sigOf() { return null; }        // see _receiveClient below

      // GATED LIKE EVERY OTHER CARD IN THIS LIBRARY.
      //
      // Ungated, _evalTrigger() runs on EVERY state push. The frontend hands a
      // card a new client ~10x a second, so the three pop-ups on a view run ~300
      // evaluations in 10s -- and #media's `dismissable` branch does a
      // synchronous localStorage.getItem + JSON.parse inside each one (150
      // reads in 15s), over a stretch in which the ENTIRE card library renders
      // 4 times. That is exactly what HkBase's gate exists to prevent.
      //
      // The signature is the last_updated of every entity the trigger and the
      // dismiss_scope name -- the same shape HkBase._sigOf uses. Everything
      // else that must re-evaluate is TIME, not state (a `grace` window
      // expiring, a dismissal's TOUCH_MS refresh), and _evalTrigger already
      // schedules itself for those through _graceTimer. So nothing is lost.
      //
      // A card with no trigger has no ids and no signature, and skips outright.
      // (HkBase calls it from Lovelace's entry and from a client set directly; it
      // does NOT chain to HkBase's own, which would tone and track a card that draws nothing.)
      _receiveClient() {
        var c = this.client;
        if (this._open && this._kids) {
          this._kids.forEach(function (k) { window.hkHostClient.bridge(k, c); });
        }
        if (this._open && this._config && this._config.pane) this._place();
        // NO TRIGGER AT ALL -> nothing to evaluate, ever. #alarm and #doorbell
        // are opened by their hash (an automation navigates the tablet to it),
        // so two of the three sheets on a view fall out here and never enter
        // _evalTrigger, which would only return on its own first line anyway.
        if (!this._config || !this._config.trigger) return;
        // A PENDING GRACE WINDOW BYPASSES THE GATE. `grace` and the dismissal's
        // TOUCH_MS refresh are due on TIME, not on a state change, so while one
        // is outstanding the answer can differ from last time with no entity
        // having moved. _graceTimer covers that on its own in a live browser,
        // but the gate must not be the only thing standing between a stopped
        // speaker and a sheet that closes -- tests/test_popup.js drives exactly
        // that case ("21 s after stopping: closed") through a state push with a
        // fake clock, and it is the honest expression of the requirement.
        var ids = this._timePending ? null : this._trigIds;
        if (ids && ids.length) {
          // STATE *AND* last_updated. HkBase._sigOf uses last_updated alone,
          // which is right for a tile (it moves on an attribute change too).
          // Here it is not enough on its own: a state object without that
          // field -- every fixture in tests/test_popup.js, and anything that
          // synthesises a state -- would give a signature of `id=undefined;`
          // that NEVER changes, and the trigger would be dead. Conditions only
          // ever read `state`, so including it is both the honest dependency
          // and the thing that keeps the gate working when last_updated is
          // missing.
          // The FOCUS is an input too: it is this screen's own choice, so it
          // can change with no entity moving (see the hkMusic listener in
          // connectedCallback, which also forces a re-evaluation).
          var sig = window.hkMusic ? 'focus=' + window.hkMusic.focus() + ';' : '', st;
          for (var i = 0; i < ids.length; i++) {
            st = c && c.states[ids[i]];
            sig += ids[i] + '=' + (st ? st.state + '@' + st.last_updated : 'x') + ';';
          }
          if (sig === this._trigSig) return;
          this._trigSig = sig;
        }
        this._evalTrigger();
      }

      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        var self = this;
        if (this._hash && !this._mountedAs) {
          this._mountedAs = this._hash;
          MOUNTED[this._hash] = (MOUNTED[this._hash] || 0) + 1;
        }
        if (!this._onLoc) {
          this._onLoc = function () { self._sync(); };
        }
        [window.hkShell.navEvent, 'hashchange', 'popstate'].forEach(function (ev) {
          window.addEventListener(ev, self._onLoc);
        });
        // _evalTrigger bails while disconnected, so a card that has just come
        // back must re-evaluate even if no entity moved in the meantime.
        // Clearing the gate's signature is what guarantees the next push does.
        this._trigSig = null;
        // ARRIVING WITH THE PAGE: until the trigger has been looked at since
        // this card joined the page, a sheet that opens is part of the page
        // appearing (see _show), not something that just happened on it.
        this._settled = false;
        // A FOCUS CHANGE IS A TRIGGER CHANGE when the trigger follows the
        // music (`entity_from: {music: true}`): tapping another context on the
        // Play Music page must move the bar with it, and nothing in the states moved.
        if (!this._onFlags) {
          this._onFlags = function () { if (self.client) self._evalTrigger(); };
          window.addEventListener('hk-popup-flags', this._onFlags);
        }
        if (!this._musicOff && window.hkMusic) {
          this._musicOff = window.hkMusic.onChange(function () {
            // The speaker list is part of the trigger's entity list: read it
            // again. A card configured before the music settings have arrived
            // keeps an EMPTY list, and with nothing to sign the gate in
            // `_receiveClient` never engages -- every push would re-evaluate the trigger
            // for the life of the page.
            self._trigIds = triggerEntities(self._config);
            self._trigSig = null;
            if (self.client) self._evalTrigger();
          });
        }
        this._sync();
        // ...and re-evaluate NOW rather than on the next state push. Coming back
        // from the Play Music page, the hash is empty, so _sync has nothing to
        // match and only the trigger can re-open the sheet.
        if (this.client) this._evalTrigger();
      }

      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        var self = this;
        if (this._mountedAs) {
          MOUNTED[this._mountedAs] = Math.max(0, (MOUNTED[this._mountedAs] || 0) - 1);
          this._mountedAs = null;
        }
        [window.hkShell.navEvent, 'hashchange', 'popstate'].forEach(function (ev) {
          window.removeEventListener(ev, self._onLoc);
        });
        if (this._onFlags) { window.removeEventListener('hk-popup-flags', this._onFlags); this._onFlags = null; }
        this._stashShow(false);
        if (this._musicOff) { this._musicOff(); this._musicOff = null; }
        clearTimeout(this._graceTimer);
        clearTimeout(this._dismissTimer);
        clearTimeout(this._firstTimer);
        if (this._onInset) {
          window.removeEventListener('resize', this._onInset);
          window.removeEventListener('hk-module-ready', this._onInset);
          this._onInset = null;
        }
        // The view went away (navigated to a page). Take the sheet down, but
        // leave the hash and run no close_action -- nobody closed it.
        this._leaving = (this._config && this._config.carry && pageHas(this._hash)) || false;
        this._close(false);
        this._leaving = false;
      }

      // Match the sheet to the URL.
      _sync() {
        if (!this.isConnected || !this._config) return;
        var want = location.hash === this._hash;
        if (this._config.detail) { this._syncDetail(want); return; }
        if (want && !this._open) this._show();
        else if (!want && this._open) {
          var h = location.hash;
          // NAVIGATING AWAY IS NOT A DISMISSAL, or the now-playing bar would
          // stay gone. Tapping the album art opens the Play Music page: that
          // clears the hash, this runs BEFORE disconnectedCallback can take
          // the sheet down quietly, and an empty hash on its own reads as
          // "the user closed it by hand". The bar would then write a dismissal
          // and stay shut on the way back until the track changed.
          //
          // The pathname is what separates the two. A hand close leaves the
          // page alone; a trip to another page does not.
          var moved = this._openPath && location.pathname !== this._openPath;
          // (a bar carried from page to page leaves with its page)
          this._leaving = (moved && this._config.carry && pageHas(this._hash)) || false;
          this._close(!moved && !(h && h !== this._hash && sheetHash(h)));
          this._leaving = false;
        }
      }

      // A HASH THAT OPENS A DETAIL SHEET (#alarm). The hash keeps every way in
      // -- an alarm automation's ".../0#alarm", the room pages, hkPopup.open --
      // and the sheet is hk-detail's, so it is the same size, header and X as
      // every other. The hash's own history entry is the one Back leaves (the
      // sheet pushes none of its own: `hashed`); closing the sheet any other
      // way clears the hash, as closing one of this card's own sheets does.
      _syncDetail(want) {
        var D2 = window.hkDetail, self = this, hash = this._hash;
        if (want && !this._dopen && D2) {
          this._dopen = true;
          var src = this._config.name ? { name: this._config.name } : {};
          var ok = D2.open(this._config.detail, src, { direct: true, hashed: true, onClose: function () {
            self._dopen = false;
            if (location.hash === hash) setHash('');
          } });
          if (!ok) { this._dopen = false; if (location.hash === hash) setHash(''); }
        } else if (!want && this._dopen) {
          this._dopen = false;
          if (D2) D2.close(true);
        }
      }

      _scopeSig() {
        var client = this.client, st = client.states;
        return (this._config.dismiss_scope || []).map(function (sc) {
          if (sc.music) return window.hkMusic ? String(window.hkMusic.player(client)) : '';
          var e = st[sc.entity], v = e ? e.state : '';
          if (sc.above != null) return Number(v) > Number(sc.above) ? '1' : '0';
          return v;
        }).join('|');
      }

      // THE WAY BACK (`stash: {icon, label}`): a dismissable sheet put away
      // while its trigger holds leaves a small round button in the bottom
      // right corner -- as iOS leaves a tab for a picture-in-picture video
      // pushed off the screen -- and a tap brings it back (the dismissal
      // dropped, the trigger looked at again). Above the tab bar when there
      // is one (--hk-tabbar-top, its own gap included), else clear of an
      // iPhone's home-indicator strip. Gone when the trigger is (the music
      // stopped) or the sheet is back. On <body>: it needs no
      // home-assistant events, and it is a single button.
      _stashShow(on) {
        var st = this._config && this._config.stash, self = this, b = this._stashEl;
        if (!st || !on || !this.isConnected) {
          if (b) {
            this._stashEl = null;
            b.classList.remove('in'); b.style.opacity = '0'; b.style.transform = 'scale(.6)';
            setTimeout(function () { b.remove(); }, 260);
          }
          return;
        }
        if (b) return;
        b = this._stashEl = document.createElement('div');
        b.className = 'hk-stash';
        var sr = b.attachShadow({ mode: 'open' });
        sr.innerHTML = '<style>' + STASH_CSS + '</style><div class="b" role="button" tabindex="0" aria-label="' +
          String(st.label || 'Show').replace(/"/g, '&quot;') + '"><hk-icon icon="' +
          String(st.icon || 'mdi:chevron-up').replace(/"/g, '') + '"></hk-icon></div>';
        if (!document.getElementById('hk-stash-css')) {
          var css = document.createElement('style');
          css.id = 'hk-stash-css';
          css.textContent = STASH_PAGE_CSS;
          document.head.appendChild(css);
        }
        b.style.opacity = '0'; b.style.transform = 'scale(.6)';
        var back = function () {
          dset(self._hash, null);
          self._stashShow(false);
          self._trigSig = null;
          if (self.client) self._evalTrigger();
        };
        sr.querySelector('.b').addEventListener('click', back);
        sr.querySelector('.b').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') back(); });
        document.body.appendChild(b);
        // (in after the sheet has gone down)
        setTimeout(function () { if (self._stashEl === b) { b.style.opacity = '1'; b.style.transform = 'none'; b.classList.add('in'); } }, 180);
      }

      _evalTrigger() {
        var cfg = this._config, self = this;
        if (!cfg || !cfg.trigger || !this.client || !this.isConnected) return;
        var ctx = { now: Date.now(), next: Infinity };
        var now = met([].concat(cfg.trigger), this.client.states, ctx);
        var first = this._prevTrigger === undefined;
        var rose = now && !this._prevTrigger;
        this._prevTrigger = now;

        var dismissed = false;
        if (cfg.dismissable) {
          var rec = dget(this._hash);
          if (rec && (!now || rec.sig !== this._scopeSig() ||
                      ctx.now - rec.seen > STALE_MS || screensaverOn())) {
            dset(this._hash, null);
            rec = null;
          }
          if (rec) {
            dismissed = true;
            if (ctx.now - rec.seen > TOUCH_MS) { rec.seen = ctx.now; dset(this._hash, rec); }
            // Keep confirming while dismissed, even if no state changes arrive.
            //
            // ITS OWN TIMER, NOT ctx.next. ctx.next sets _timePending, and
            // _timePending makes `_receiveClient` skip the gate -- which is right for a
            // 20s grace window and wrong for a dismissal, because a dismissal
            // lasts until somebody walks away. It would put this card back on the
            // ungated path the gate exists to avoid: ~10 evaluations a second,
            // each with a localStorage read.
            clearTimeout(this._dismissTimer);
            this._dismissTimer = setTimeout(function () { self._evalTrigger(); },
                                            TOUCH_MS);
          } else {
            clearTimeout(this._dismissTimer);
          }
        }
        // put away while it would be up: its way back, in the corner
        this._stashShow(now && dismissed);

        clearTimeout(this._graceTimer);
        // Read by the gate in `_receiveClient` above: true while this card owes
        // itself another look on the clock alone.
        this._timePending = ctx.next !== Infinity;
        if (this._timePending) {
          this._graceTimer = setTimeout(function () { self._evalTrigger(); },
                                        Math.max(50, ctx.next - Date.now() + 50));
        }

        var h = location.hash;
        if (h !== this._hash) {
          // LEVEL, not edge, for a dismissable sheet: it should be open whenever
          // the trigger holds and it has not been dismissed -- including after
          // a reload or a trip to a subview and back, which an edge never sees.
          // It does not take the screen from another sheet that is open.
          var other = sheetHash(h);
          if (now && !dismissed && (cfg.dismissable ? !other : rose) && shownIsMine(cfg, this._hash)) setHash(this._hash);
        } else if (!now && cfg.trigger_close !== false) {
          // FIRST-EVALUATION GRACE, AND WHY IT NEEDS A TIMER.
          //
          // The rule is: never slam shut a sheet the URL asked for before its
          // own state has been seen. As a bare `&& !first` that leaves a page
          // loaded AT `#media` with nothing playing showing the bar FOREVER --
          // the first pass refuses to close, and the gate in `_receiveClient` then
          // blocks every later push because, with the home idle, no trigger
          // entity ever moves again. Nothing gives it a second look.
          //
          // Invisible while #media is a modal (you tap it away). With a
          // persistent bar it is a bar that will not go away while no music is
          // playing. Loading /dashboard-home/0#media while idle reproduces it.
          //
          // So the grace is a DELAY rather than a permanent exemption.
          // Look again in FIRST_CLOSE_MS, by which point `first` is false and
          // the ordinary close runs. A hash the URL genuinely meant survives
          // the page settling; one left over from a trigger that has since
          // gone false does not.
          var used = this._lastUse(), hold = used ? used + npGraceSec() * 1000 - ctx.now : 0;
          if (first) {
            clearTimeout(this._firstTimer);
            this._firstTimer = setTimeout(function () { self._evalTrigger(); },
                                          FIRST_CLOSE_MS);
          } else if (hold > 0) {
            // IN USE (Speakers / Browse open, a touch on it): not closed till
            // a whole grace after the last of it -- looked at again then
            clearTimeout(this._useTimer);
            this._useTimer = setTimeout(function () { self._evalTrigger(); }, Math.min(hold, 2000) + 50);
          } else {
            this._triggerClosing = true;
            setHash('');
          }
        }
        this._settled = true;
      }

      _build() {
        var self = this, cfg = this._config;
        this._kids = [];
        if (typeof window.loadCardHelpers !== 'function') {
          // Reached from `_receiveClient`; a throw here would error the whole card.
          console.error('hk-popup: loadCardHelpers is not available; the sheet stays empty');
          return Promise.resolve();
        }
        return window.loadCardHelpers().then(function (helpers) {
          cfg.cards.forEach(function (cc) {
            var el = helpers.createCardElement(cc);
            if (self.client) window.hkHostClient.bridge(el, self.client);
            self._kids.push(el);
            self._sheet.appendChild(el);
          });
        });
      }

      _show() {
        var cfg = this._config, self = this;
        this._open = true;
        this._openAt = Date.now();
        // The PAGE the sheet opened on -- see _sync. Leaving that page is not
        // a dismissal.
        this._openPath = location.pathname;
        openCount(1, this._config.modal !== false);
        // Keep a non-modal sheet clear of the sidebar, and keep it clear when
        // the window is resized or the drawer is expanded. One measurement per
        // open plus one listener while open; nothing at all for a modal.
        if (cfg.modal === false && !this._onInset) {
          this._onInset = function () {
            if (!self._el) return;
            self._place();
            self._el.style.left = self._el.classList.contains('side') ? '' : insetLeft() + 'px';
            if (self._open) self._publish();
          };
          window.addEventListener('resize', this._onInset);
          // a menu docking or undocking moves the content edge without a resize
          window.addEventListener('hk-module-ready', this._onInset);
        }
        if (!this._el) {
          this._mount = window.hkShell.overlayRoot() || document.body;
          var el = document.createElement('div');
          el.className = 'hkp' + (cfg.position === 'bottom' ? ' bottom' : '') +
                         (cfg.modal === false ? ' plain' : '') +
                         (cfg.dock && cfg.position === 'bottom' && cfg.modal === false ? ' dock' : '');
          window.hkCards.flatSurface(el, 'popup');
          el.innerHTML = '<style>' + CSS + window.hkCards.flatCss('.hkp[hk-flat]') +
            '.hkp[hk-flat] .sheet{background:var(--hk-flat-elevated)!important;color:var(--hk-ink);box-shadow:var(--hk-flat-elevated-shadow)!important}' +
            '.hkp[hk-flat].plain .sheet{background:transparent!important;box-shadow:none!important}' + '</style><div class="bd"></div><div class="sheet"></div>';
          var sheet = el.querySelector('.sheet');
          var bottom = cfg.position === 'bottom';
          var r = cfg.radius || '42px';
          sheet.style.width = cfg.width || '900px';
          // `max_width` overrides the default inset. The default keeps a
          // centred dialog off the screen edges; the now-playing BAR wants
          // the opposite -- its own 18px padding IS the margin, so capping
          // the sheet at 100vw - 24 would add 12px to the sides and leave
          // them unequal with the bottom.
          // --hk-vw: see .hkp .sheet in CSS (the car's zoomed viewport).
          sheet.style.maxWidth = cfg.max_width ||
            'calc(var(--hk-vw, 100vw) - max(var(--hk-content-left, 0px), var(--hk-safe-left,env(safe-area-inset-left,0px))) - var(--hk-safe-right,env(safe-area-inset-right,0px)) - 24px)';
          sheet.style.padding = cfg.padding || '18px';
          sheet.style.background = cfg.background || '#1c1c1e';
          // a card on the sheet's own plate wears the look's plate for a
          // sheet (M.bg; Tinted's dark plate on #1c1c1e is a hole); a sheet
          // with none (the docked bar's, transparent) keeps the page's
          if (/^(transparent|none)$/i.test(String(sheet.style.background || '').trim())) sheet.style.removeProperty('--hk-plate-here');
          else sheet.style.setProperty('--hk-plate-here', 'var(--hk-glass-plate-sheet)');
          var rad = bottom ? r + ' ' + r + ' 0 0' : r;
          if (cfg.background === 'transparent') sheet.style.overflowY = 'visible';
          // clip: the content IS the sheet (the doorbell camera). No box
          // around it -- the sheet's own radius cuts the content's corners.
          if (cfg.clip) sheet.style.overflow = 'hidden';
          // A SCROLLING SHEET IS ROUNDED BY clip-path, NOT border-radius.
          // border-radius on a scroll container is a ROUNDED overflow clip,
          // and Chrome (153, measured) then ignores the clip-path: path() of
          // any backdrop-filter inside it and filters the path's whole
          // bounding box: hk-glass's frost layer in #alarm draws one dark
          // square-cornered block behind the keypad and the locks instead of
          // a frost under each pill. clip-path: inset(round) rounds the
          // sheet, its background and its own blur exactly as border-radius
          // does, and leaves the scroll clip square. Stripe-tested: rounded
          // scroller -> bounding box; this -> per-pill.
          // A transparent sheet does not scroll-clip, and a `clip` sheet is a
          // camera (no glass inside, and its video was measured with the
          // radius as it is), so both keep border-radius.
          if (cfg.background === 'transparent' || cfg.clip) sheet.style.borderRadius = rad;
          else sheet.style.clipPath = 'inset(0 round ' + rad + ')';
          // blur: frosted glass. The sheet's background must be translucent for
          // it to show, and the backdrop dim must be light enough that there is
          // something behind to blur. It is on the SHEET only, never the
          // full-screen backdrop -- a fade-in blur there is a 0.4s hitch on open.
          if (cfg.blur) {
            var f = 'blur(' + cfg.blur + ') saturate(1.6)';
            sheet.style.backdropFilter = f;
            sheet.style.webkitBackdropFilter = f;
          }
          // vars: theme variables for the cards INSIDE, set on the sheet so
          // they inherit -- e.g. clearing a native card's own plate.
          var vars = cfg.vars || {};
          Object.keys(vars).forEach(function (k) {
            sheet.style.setProperty(k.slice(0, 2) === '--' ? k : '--' + k, String(vars[k]));
          });
          if (cfg.backdrop != null) {
            el.querySelector('.bd').style.background = 'rgba(17, 17, 17, ' + Number(cfg.backdrop) + ')';
          }
          sheet.addEventListener('pointerdown', function () { self._armAuto(); }, true);
          el.querySelector('.bd').addEventListener('click', function () {
            if (self._el && self._el.classList.contains('prep')) return;   // caught, not a close -- see .prep
            if (cfg.close_outside !== false) setHash('');
          });
          // THE X CLOSES EXACTLY AS A BACKDROP TAP DOES -- setHash(''), which
          // is the same path `dismissable` already hangs off, so a hand-closed
          // sheet stays closed on THIS screen until playback stops or the
          // dismiss_scope changes. No new dismissal logic; this is a visible
          // way into machinery otherwise reachable only by tapping the dim.
          if (cfg.close_button) {
            var x = document.createElement('div');
            x.className = 'x';
            x.setAttribute('role', 'button');
            x.setAttribute('aria-label', 'Close');
            x.setAttribute('tabindex', '0');
            x.innerHTML = '<hk-icon icon="mdi:close"></hk-icon>';
            x.addEventListener('click', function (e) {
              e.stopPropagation();
              setHash('');
            });
            sheet.appendChild(x);
          }
          // NO Escape handler, deliberately: a more-info dialog opened FROM the
          // sheet also closes on Escape, and one keypress would shut both.
          // The browser's back button closes the sheet (it is a URL).
          this._el = el;
          this._sheet = sheet;
        }
        if (cfg.dock) { this._placeSig = null; this._place(); }
        var kidsReady = this._kids ? Promise.resolve() : this._build();
        if (this._kids) {
          this._kids.forEach(function (k) {
            if (self.client) window.hkHostClient.bridge(k, self.client);
            self._sheet.appendChild(k);
          });
        }
        // PREPARED UNSEEN. A live camera can blank the whole sheet for a
        // frame or three on an Android wall tablet -- twice per open: once
        // when the tablet starts its hardware video decoder (~0.3 s in,
        // snapshot still showing) and once when the first live frame is
        // drawn. Measured with adb screenrecord: video-only 3 of 3 opens,
        // audio-only 0 of 3, no stream 0 of 4 -- it is the decoder, and no
        // CSS on the sheet changes it. What does: both glitches happen
        // while the sheet is drawn at 1% (invisible, but drawn --
        // visibility:hidden only moves the second glitch to the reveal).
        // So a sheet whose cards say they prepare (hkPrepares) opens at 1%
        // and fades in once every such card's hkReady() resolves -- about
        // 0.6 s after the tap -- or after PREP_MAX_MS, whichever first.
        // A camera slow to send its first keyframe (up to ~4.5 s seen) gets
        // the snapshot at the cap.
        var prep = cfg.cards.some(function (cc) {
          var C = customElements.get(String(cc && cc.type || '').replace(/^custom:/, ''));
          return !!(C && C.hkPrepares);
        });
        var el = this._el, gen = this._prepGen = (this._prepGen || 0) + 1;
        el.classList.toggle('prep', prep);
        el.classList.toggle('video', prep);
        // the bar already up on the page before: this one is it, in place
        var carry = false;
        if (cfg.dock && cfg.carry) {
          var cr = CARRY[this._hash] || (CARRY[this._hash] = { open: 0, gone: 0, ghost: null });
          carry = cr.open > 0 || Date.now() - cr.gone < CARRY_MS;
          cr.open++;
          this._carried = true;
        }
        this._mount.appendChild(el);
        // (a pane narrows the page now, as it starts to slide in over the room)
        if (cfg.dock && this._placeNow && this._placeNow.kind === 'pane') publishPane(this._placeNow.side, this._placeNow.w);
        // AFTER the mount: a detached element measures nothing, and so would
        // the sidebar read taken before it. In the coming frame, before it is
        // drawn: a sheet opening with its page is mounted in the middle of
        // the page's build, and measuring then laid the half-built page out
        // once more than the frame itself does.
        if (this._onInset) {
          var inset = this._onInset;
          requestAnimationFrame(function () { if (self._onInset === inset) inset(); });
        }
        // The bar's height follows its content (a timer strip above the
        // player grows it): re-published whenever the sheet changes size.
        if (cfg.modal === false && this._sheet && typeof ResizeObserver === 'function') {
          if (!this._barRO) this._barRO = new ResizeObserver(function () { if (self._open) self._publish(); });
          this._barRO.observe(this._sheet);
        }
        // Two frames: the first paints the closed state, so the transition runs.
        // (Carried: open now, with no transition -- it is already up.)
        // ARRIVING WITH ITS PAGE (back to Home with the music on, a reload
        // onto it): up with the page, in place, as the page's own cards are.
        // A slide started then is started while the page is being built, and
        // a wall tablet's main thread is busy for half a second with it: the
        // compositor's slide has run out before the frame is shown, so the
        // bar is first drawn already up, then the main thread starts the
        // transition again from its first frame -- the bar off screen, for a
        // frame -- and it ends up again. Recorded on the Living Room tablet,
        // every return to Home: up, gone a frame, up. The slide is for a bar
        // that comes up while the page is already there (music starting).
        var arriving = !this._settled && cfg.modal === false;
        // A PANE ARRIVING WITH ITS PAGE (a reload with the music on) slides
        // in once its art is in -- placed at once it showed the placeholder,
        // then the art faded in over it (2026-10-15). At most PANE_ARRIVE_MS.
        var paneArrive = arriving && !carry && this._placeNow && this._placeNow.kind === 'pane';
        if (el.hasAttribute('hk-flat')) {
          el.classList.add('instant', 'open');
          if (carry) dropGhost(CARRY[this._hash]);
        } else if (paneArrive) {
          var went = false, goPane = function () {
            if (went) return;
            went = true;
            requestAnimationFrame(function () { requestAnimationFrame(function () { if (self._open && self._el === el) el.classList.add('open'); }); });
          };
          setTimeout(goPane, PANE_ARRIVE_MS);
          kidsReady.then(function () {
            var pc = (self._kids || []).filter(function (k) { return k.localName === 'hk-music-pane-card'; })[0];
            return pc && pc.whenReady ? pc.whenReady() : null;
          }).then(goPane, goPane);
        } else if (carry || arriving) {
          el.classList.add('instant', 'open');
          // ...and the last page's, kept up till now, goes once this is drawn
          var hash0 = this._hash;
          requestAnimationFrame(function () { requestAnimationFrame(function () {
            el.classList.remove('instant');
            if (carry) dropGhost(CARRY[hash0]);
          }); });
        } else {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { if (self._open) el.classList.add('open'); });
          });
        }
        if (prep) {
          var reveal = function () { if (self._prepGen === gen) el.classList.remove('prep'); };
          var cap = setTimeout(reveal, PREP_MAX_MS);
          kidsReady.then(function () {
            var waits = (self._kids || []).filter(function (k) { return typeof k.hkReady === 'function'; })
              .map(function (k) { return k.hkReady(); });
            return Promise.all(waits);
          }).then(function () { clearTimeout(cap); reveal(); }, function () { clearTimeout(cap); reveal(); });
        }
        this._armAuto();
        kidsReady.catch(function (e) { console.error('[hk-popup] could not build', cfg.cards, e); });
        // (the cards built: each told its place -- the player's top, the pane's side)
        if (cfg.dock) kidsReady.then(function () { if (self._el === el) { self._placeSig = null; self._place(); } });
      }

      // WHERE IT GOES NOW (placeFor): the classes on the sheet's box, the
      // pane's width, the player's own top or bottom; published while open.
      // Cheap and idempotent: on every push while open, a resize, a
      // settings change, the music in the pane coming or going.
      _place() {
        var cfg = this._config, el = this._el;
        if (!el || !cfg || !cfg.dock) return;
        var has = !!cfg.pane && paneMusic(this.client), self = this, now = Date.now(), playing = this._musicPlaying();
        if (has && playing) this._musicAt = now;
        // PAUSED OR GONE, the pane up: it stays the grace (Hide After a
        // Pause) from the last of the music playing, the sheet opening and its
        // use -- as the bar does -- then gives way (to the timers' bar, or the
        // sheet closes)
        if (!playing && this._open && this._placeNow && this._placeNow.kind === 'pane') {
          var since = Math.max(this._musicAt || 0, this._openAt || 0, this._lastUse()), gms = npGraceSec() * 1000;
          has = now - since < gms;
          clearTimeout(this._graceT);
          if (has) this._graceT = setTimeout(function () { self._place(); }, gms - (now - since) + 50);
        }
        var p = placeFor(cfg, has);
        var sig = p.kind + ':' + (p.side || p.bar) + ':' + (p.w || 0);
        if (sig === this._placeSig) return;
        this._placeSig = sig;
        this._placeNow = p;
        var pane = p.kind === 'pane', top = !pane && p.bar === 'top';
        el.classList.toggle('side', pane);
        el.classList.toggle('sl', pane && p.side === 'left');
        el.classList.toggle('top', top);
        el.classList.toggle('bottom', !top && !pane && cfg.position === 'bottom');
        if (pane) { el.style.setProperty('--hk-pane-w', p.w + 'px'); el.style.left = ''; }
        else el.style.removeProperty('--hk-pane-w');
        // the player along the top: its own inset and swipe (hk-media.js)
        var sh = this._sheet, tv = cfg.top_vars || {};
        Object.keys(tv).forEach(function (k) {
          var name = k.slice(0, 2) === '--' ? k : '--' + k, own = (cfg.vars || {})[k];
          if (top) sh.style.setProperty(name, String(tv[k]));
          else if (own != null) sh.style.setProperty(name, String(own));
          else sh.style.removeProperty(name);
        });
        (this._kids || []).forEach(function (k) {
          if (k.localName === 'hk-now-playing-card') { if (top) k.setAttribute('np-top', ''); else k.removeAttribute('np-top'); }
          if (k.localName === 'hk-music-pane-card') {
            if (pane) k.setAttribute('side', p.side); else k.removeAttribute('side');
            if (typeof k.active === 'function') k.active(pane);
          }
        });
        if (this._open) this._publish();
      }
      // is this screen's music playing (not paused, not gone)
      _musicPlaying() {
        var S = window.hkSaver, h = this.client;
        try { return !!(h && S && S.music && S.music.playing && S.music.playing(h)); } catch (e) { return false; }
      }
      // WHEN ITS CARDS WERE LAST IN USE (hkLastUse: a panel open is now, a
      // touch is its moment): the sheet stays up a whole grace after it, the
      // music paused or stopped -- a search on Browse is not cut off
      _lastUse() {
        var t = 0;
        (this._kids || []).forEach(function (k) { if (typeof k.hkLastUse === 'function') t = Math.max(t, k.hkLastUse() || 0); });
        return t;
      }
      _publish() {
        var p = this._placeNow;
        if (p && p.kind === 'pane') publishPane(p.side, p.w); else publishPane(null);
        publishBar(this._el, this._sheet);
      }

      // auto_close counts from the LAST TOUCH, not from the open. Counted
      // from the open, the doorbell sheet would close 60 s in whatever was
      // happening -- mid-way through a hold-to-talk reply. Any pointerdown
      // inside the sheet restarts it (wired where the sheet is built).
      _armAuto() {
        var self = this, ms = Number(this._config.auto_close);
        clearTimeout(this._auto);
        if (!(ms > 0) || !this._open) return;
        this._auto = setTimeout(function () {
          if (self._open && location.hash === self._hash) setHash('');
        }, ms);
      }

      // runAction: false when nobody closed it (view gone, switched to another
      // sheet) -- Bubble's close_action rule.
      _close(runAction) {
        if (!this._open) return;
        this._open = false;
        openCount(-1, this._config.modal !== false);
        var leaving = !!(this._leaving && this._carried);
        if (this._carried) {
          var cr = CARRY[this._hash];
          if (cr) { cr.open = Math.max(0, cr.open - 1); if (this._leaving) cr.gone = Date.now(); }
          this._carried = false;
        }
        if (this._config.modal === false) {
          if (this._barRO) this._barRO.disconnect();
          // (leaving with its page: the next page's bar takes the room over;
          // let it go only if none has)
          if (!leaving) { publishBar(null); publishPane(null); }
          else setTimeout(function () { var c2 = CARRY[self._hash]; if (!(c2 && c2.open > 0)) { publishBar(null); publishPane(null); } }, CARRY_MS);
        }
        clearTimeout(this._auto);
        var el = this._el, kids = this._kids || [];
        var self = this;
        if (el && leaving) {
          // CARRIED TO THE NEXT PAGE: it stays up, as it is, until the next
          // page's bar is (no frame without one), then goes at once -- never
          // slid away; gone by CARRY_MS if no page takes it over
          var crg = CARRY[this._hash];
          if (crg) {
            dropGhost(crg);
            crg.ghost = { el: el, kids: kids, t: setTimeout(function () { dropGhost(crg, true); }, CARRY_MS),
                          wait: Array.isArray(this._leaving) ? this._leaving : null };
          }
          this._el = null;
        } else if (el) {
          el.classList.remove('open');
          // Detach after the fade. A reopen inside the fade cancels this.
          setTimeout(function () {
            if (self._open) return;
            kids.forEach(function (k) { if (k.parentNode) k.parentNode.removeChild(k); });
            if (el.parentNode) el.parentNode.removeChild(el);
          }, el.hasAttribute('hk-flat') ? 0 : 320);
        }
        // A close by hand while the trigger still holds is a DISMISSAL. Not a
        // trigger close (the session ended), not a switch to another sheet,
        // not the view going away.
        if (runAction && this._config.dismissable && !this._triggerClosing &&
            this._prevTrigger === true && this.client) {
          dset(this._hash, { sig: this._scopeSig(), seen: Date.now() });
          // START THE LOOP HERE, or it never starts at all. The record is
          // written AFTER the last _evalTrigger, so that run saw no record,
          // armed no timer, and left _timePending false -- and the gate in
          // the gate in `_receiveClient` then blocks every push until a trigger entity moves.
          // The refresh-and-expire loop is what notices the screensaver, so
          // without this the dismissal would be effectively permanent.
          //
          // ARM THE TIMER, do NOT call _evalTrigger() here: that can undo the
          // close in the same tick. The first thing _evalTrigger does is
          // decide whether to DISCARD the record, and if the screensaver
          // happens to be up it discards the one just written and re-opens
          // the sheet. A finger cannot reach the X through the screensaver,
          // so that state is unreachable in practice -- but the close path
          // should not depend on that being true.
          var self2 = this;
          clearTimeout(this._dismissTimer);
          this._dismissTimer = setTimeout(function () { self2._evalTrigger(); },
                                          TOUCH_MS);
          this._stashShow(true);
        }
        this._triggerClosing = false;
        if (runAction && this._config.close_action && this.client) {
          this._act(this._config.close_action);
        }
      }
    }

    customElements.define('hk-popup-card', HkPopupCard);

    // hk-popup-group-card: SEVERAL POP-UPS FROM ONE FILE.
    // The camera pop-ups (#camera-driveway and the rest) belong on every
    // home page AND on the Cameras page. A shared file must be ONE card, and
    // wrapping them in a grid would add a box with margins wherever it went.
    // This holds the pop-ups and draws nothing -- display:none, like each
    // pop-up -- so an include adds no space anywhere. Each entry is an
    // ordinary hk-popup-card config (its `type` may be left out).
    class HkPopupGroupCard extends C.HkBase {
      static get CSS() { return ':host{display:none}'; }
      // it takes no space (display:none), so it asks for none
      getCardSize() { return 0; }
      _sigOf() { return null; }              // each pop-up gates its own renders
      _render() {
        var h = this.client, cfg = this._config || {};
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '';
          var root = this._root;
          this._kids = (Array.isArray(cfg.popups) ? cfg.popups : []).map(function (pc) {
            return C.create(Object.assign({ type: 'custom:hk-popup-card' }, pc));
          }).filter(Boolean);
          this._kids.forEach(function (k) { root.appendChild(k); });
        }
        if (h) this._kids.forEach(function (k) { window.hkHostClient.bridge(k, h); });
      }
    }
    customElements.define('hk-popup-group-card', HkPopupGroupCard);
    C.wireEditor('hk-popup-group-card', HkPopupGroupCard, [
      { name: 'popups', required: true, selector: { object: {} },
        helper: 'A YAML list of pop-ups, each with its own #name and cards.' }
    ], function () { return { popups: [] }; });
    // AN EDITOR, so the card picker does not offer the pop-up and then show
    // only a YAML box. What opens it and what is in it come first; the look
    // and the automatic behaviour are sections.
    C.wireEditor('hk-popup-card', HkPopupCard, [
      { name: 'hash', required: true, selector: { text: {} } },
      // NOT required: `detail:` stands in for it (setConfig takes either),
      // and ha-form cannot say "one of these two"
      { name: 'cards', selector: { object: {} },
        helper: 'The cards inside the pop-up, as a YAML list. Or set Detail below.' },
      { name: 'detail', label: 'Opens This Accessory\'s Sheet', selector: { entity: {} },
        helper: 'Instead of Cards: the hash opens this entity\'s detail sheet.' },
      C.section('Appearance', [
        { type: 'grid', name: '', schema: [
          { name: 'position', selector: C.selOptions(['center', 'bottom']) },
          { name: 'dock', label: 'Dock at the Bottom', selector: { boolean: {} },
            helper: 'With Position Bottom and Modal off: full width at the screen\'s bottom edge, like the Now Playing bar.' },
          { name: 'width', selector: { text: {} }, helper: 'Default 900px.' },
          { name: 'max_width', label: 'Maximum Width', selector: { text: {} },
            helper: 'Default: the screen\'s width, less a margin.' },
          { name: 'padding', selector: { text: {} }, helper: 'Default 18px.' },
          { name: 'radius', selector: { text: {} }, helper: 'Default 42px.' },
          { name: 'background', selector: { text: {} }, helper: 'Default #1c1c1e. transparent shows the cards only.' },
          { name: 'blur', selector: { text: {} }, helper: 'e.g. 40px.' },
          { name: 'backdrop', selector: { number: { min: 0, max: 1, step: 0.05, mode: 'box' } } },
          { name: 'clip', selector: { boolean: {} } },
          { name: 'close_button', label: 'Close Button', selector: { boolean: {} },
            helper: 'An X in the corner.' }
        ] },
        { name: 'vars', selector: { object: {} } }
      ], 'mdi:palette'),
      C.section('Opening and closing', [
        { type: 'grid', name: '', schema: [
          // on unless `modal: false` -- shown on while the key is absent
          { name: 'modal', label: 'Modal', selector: { boolean: {} }, default: true,
            helper: 'On: dims the page and holds the taps. Off: the page stays usable around it.' },
          { name: 'auto_close', selector: { number: { min: 0, step: 1000, mode: 'box' } } },
          { name: 'close_outside', default: true, selector: { boolean: {} } },   // on unless false (~1150)
          { name: 'trigger_close', selector: { boolean: {} } },
          { name: 'dismissable', selector: { boolean: {} } }
        ] },
        { name: 'trigger', selector: { object: {} } },
        { name: 'dismiss_scope', selector: { object: {} },
          helper: 'YAML list of entities; a change reopens a dismissed pop-up.' },
        { name: 'close_action', selector: { ui_action: {} } }
      ], 'mdi:gesture-tap')
    ], function () { return { hash: '#example', cards: [] }; });
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: 'hk-popup-card', name: 'HK Pop-up',
      description: 'A sheet that opens over the dashboard when the page address ends in its #name, or when its conditions are met.',
      preview: false
    });
    window.customCards.push({
      type: 'hk-popup-group-card', name: 'HK Pop-up Group',
      description: 'Several pop-ups kept together in one card, which takes no space on the page.',
      preview: false
    });
    // open(): what a camera tap uses to open its pop-up by hash. Asking for
    // the sheet that is already up is a no-op: a second entry would take two
    // Backs to close it. hashes(): the pop-ups on the page NOW (see MOUNTED).
    window.hkPopup = { version: '1.2.0',
      open: function (h) { h = norm(h); if (h && location.hash !== h) setHash(h); },
      hashes: mounted, met: met, _GRACE: GRACE, HkPopupCard: HkPopupCard };
    return true;
  }

  if (!boot()) window.addEventListener('hk-cards-ready', boot, { once: true });
})();
