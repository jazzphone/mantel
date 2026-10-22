// hk-idle.js - put a wall tablet back on its dashboard when nobody is using it.
//
// WHY THIS EXISTS
// A pop-up can close itself on a timer; a page cannot. Nothing else returns a
// tablet to the dashboard after somebody opens Lights, walks away, and leaves
// it sitting there -- not a screensaver, not any automation. The chips open
// pages, so without this that would be the normal case, on the most-tapped
// chips on the screen.
//
// WHY NOT FULLY KIOSK'S "LOAD START URL" BUTTON
// Because it is a full browser navigation: white flash, the whole frontend
// bootstrapped again, every card rebuilt, the sky refetched and remounted.
// It is the correct tool for "this tablet is wedged" and much too violent for
// "nobody is looking at this page any more".
//
// This does what the back chevron does instead -- a SOFT navigation. HA's own
// navigate() is history.pushState plus a `location-changed` event, and hui-root
// swaps the view in place. No reload, nothing refetched, and because the sky
// survives a view change (see watch() in hk-sky.js) the background
// simply cross-fades from the page's palette back to the live one.
//
// THE TIMING, AND WHY IT IS WHERE IT IS
// Each wall tablet reads input_select.<room>_tablet_idle_return whenever
// activity resets this timer. Auto follows that room's Room Idle preference
// minus 10 seconds (with a 10-second floor), so the page is already back on
// the dashboard BEFORE the screensaver drops. Quick, Normal and Relaxed are
// fixed choices; Never disables the return. A tablet with no room, or whose
// helpers do not exist, gets the 50-second default. A dashboard whose item
// (its gear -> Screen) does not turn the return on gets no return at all.
//
// It is deliberately NOT tied to the screensaver booleans. Those describe the
// room; this describes the page. Someone standing in the room reading the
// Lights page keeps motion alive but touches nothing, and this should still
// eventually tidy up after them -- scrolling or tapping resets it, which is
// the signal that actually means "I am still using this".
(function () {
  'use strict';

  if (window.hkIdle) return;          // hk-loader may import this more than once
  var SH = window.hkShell;            // the host's page: navigation

  var DEFAULT_IDLE_MS = 50000;
  var IDLE_OVERRIDE_MS = null;
  var currentIdleMs = DEFAULT_IDLE_MS;

  // WHICH DASHBOARDS, AND WHICH ROOM EACH TABLET IS: each dashboard item's
  // gear -> Screen, sent as settings.py `idle` (legacy_screens builds it from
  // the items), read per call so an edit applies at the next check.
  //   dashboards  the url paths this applies to at all -- a wall tablet's,
  //               never a desktop's, a phone's or a car's: a page someone is
  //               sitting at is in use, and yanking one mid-read is worse
  //               than leaving it;
  //   rooms       dashboard -> room slug. Dashboard names are not entity-name
  //               slugs (livingroom has no underscore), so this is a table.
  //               The slug names that tablet's own helpers below.
  function idleSetting(key, fallback) {
    var HS = window.hkSettings;
    return HS ? HS.get('idle.' + key, fallback) : fallback;
  }
  function roomFor(dash) {
    var rooms = idleSetting('rooms', {}) || {};
    return Object.prototype.hasOwnProperty.call(rooms, dash) ? rooms[dash] : null;
  }

  var FIXED_OPTIONS = {
    'Quick 30s': 30000,
    'Normal 50s': 50000,
    'Relaxed 2 min (may return behind screensaver)': 120000,
    'Never': 0
  };

  // The main view is the one to come home TO, and it is always view 0. It can
  // be addressed by index (`/0`, how kiosk browsers and automations open it)
  // or by its own path, so either spelling counts as "already home" -- or this
  // would bounce a tablet sitting exactly where it belongs. The path is read
  // from the dashboard's config.
  function parts() {
    var p = location.pathname.split('/').filter(Boolean);
    return { dash: p[0] || '', view: p[1] || '' };
  }

  function firstViewPath() {
    // the host's own answer first (hkShell.dashboardConfig: Mantel's view host has no Lovelace panel to
    // find, so the walk below found nothing there and Home itself counted as a subpage, sent "home" again)
    try {
      var S = window.hkShell;
      var cfg = S && S.dashboardConfig ? S.dashboardConfig(S.panel ? S.panel() : undefined) : null;
      var v0 = cfg && cfg.views && cfg.views[0];
      if (v0 && v0.path) return v0.path;
    } catch (e) { /* the walk below */ }
    try {
      var seen = new Set(), panel = null;
      (function walk(root, d) {
        if (!root || d > 40 || panel) return;
        var kids = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (var i = 0; i < kids.length && !panel; i++) {
          var e = kids[i];
          if (SH.is(e, 'panel')) { panel = e; return; }
          if (e.shadowRoot && !seen.has(e.shadowRoot)) { seen.add(e.shadowRoot); walk(e.shadowRoot, d + 1); }
        }
      })(document, 0);
      var views = panel && panel.lovelace && panel.lovelace.config && panel.lovelace.config.views;
      return (views && views[0] && views[0].path) || null;
    } catch (e) {
      return null;
    }
  }

  // ONCE PER DASHBOARD, not per touch. reset() runs on every touchmove, wheel
  // and pointer event, and firstViewPath() walks every shadow root on the
  // page -- 37-73 ms of walking per second of finger scroll on a subview. A dashboard's first view cannot
  // change under a running page, so the answer is kept per url_path segment;
  // a lookup that found nothing (config not loaded yet) is simply asked again.
  var firstCache = { dash: null, path: null };
  function firstViewFor(dash) {
    if (firstCache.dash === dash && firstCache.path !== null) return firstCache.path;
    var p = firstViewPath();
    firstCache = { dash: dash, path: p };
    return p;
  }

  // THIS PAGE'S TABLET (1.14, hkSettings.tablet()): the idle return is a
  // tablet's, never a desk's, a phone's or a car's -- a page someone is
  // sitting at is in use, and yanking one mid-read is worse than leaving it.
  // A server from before 1.14 sends no tablets: the screens' lists above.
  function tabletHere() {
    var HS = window.hkSettings;
    var t = HS && typeof HS.tablet === 'function' ? HS.tablet() : null;
    return t && !t.legacy ? t : null;
  }
  function legacyFeed() {
    var HS = window.hkSettings;
    return !HS || HS.get('tablet_items', null) === null;
  }
  // does this page come home at all -- a tablet's, with the return on
  function returns() {
    if (legacyFeed()) return (idleSetting('dashboards', []) || []).indexOf(parts().dash) !== -1;
    var t = tabletHere();
    return !!(t && t.idle_return);
  }
  function onSubview() {
    if (!returns()) return false;
    var q = parts();
    if (!q.view || q.view === '0') return false;
    return q.view !== firstViewFor(q.dash);
  }
  // HOME, WITH A BLOCK OFF ITS START PAGE (a Home Grid's pager, hk-layout.js:
  // the kitchen tablet left on the den's thermostat). away(key, true) says
  // so; the timer then arms on Home too, and its firing only sends the
  // return -- there is nowhere to navigate.
  var aways = {};
  function awayHome() { return Object.keys(aways).length > 0 && returns() && !onSubview(); }


  // The host's current client (in Home Assistant, the frontend's root element's).
  function currentClient() {
    var HC = window.hkHostClient;
    return (HC && HC.current && HC.current()) || null;
  }

  // IS SOMEBODY ACTUALLY USING THIS TABLET? binary_sensor.<room>_tablet_in_use
  // answers, when the house defines one -- for example Fully Kiosk's
  // lastUserInteractionTime, gated on its screensaver flag.
  //
  // WHY THIS MODULE NEEDS IT. Without it the page switches back to the main
  // dashboard while someone is still using it. The listeners below reset on
  // pointerdown/touchmove/wheel/keydown/click, which is every way of
  // TOUCHING a page and no way of READING one. Sit on the Lights page for 50
  // seconds taking it in and this module decides you left.
  //
  // Returns null when it cannot tell -- no client, no room, no such entity, or
  // the sensor is unknown/unavailable -- and the caller then goes by the timer
  // alone. A tablet we cannot ask about is not one to start second-guessing
  // the timer on.
  function inUse() {
    if (!legacyFeed()) return null;      // 1.14: touches reset the timer themselves
    var room = roomFor(parts().dash);
    if (!room) return null;
    try {
      var client = currentClient();
      if (!client || !client.states) return null;
      var e = client.states['binary_sensor.' + room + '_tablet_in_use'];
      if (!e || e.state === 'unknown' || e.state === 'unavailable') return null;
      return e.state === 'on';
    } catch (err) {
      return null;
    }
  }

  // RE-CHECK, not a longer timeout. The in-use window is minutes and the
  // sensor behind it polls every 10s, so the honest shape is "ask again
  // shortly" rather than picking a single number that has to be right for
  // both cases.
  var RECHECK_MS = 15000;

  function goHome() {
    var sub = onSubview();
    if (!sub && !awayHome()) return;
    // Still being used -- do not yank the page. Come back and ask again.
    if (inUse() === true) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(goHome, RECHECK_MS);
      return;
    }
    if (sub) {
      // The query string stays (?kiosk, a probe flag): it is how the page was
      // opened, not where it was.
      var target = '/' + parts().dash + '/0' + (location.search || '');
      // Exactly what HA's own navigate() does. The event has to be composed, or
      // it will not cross the shadow boundary out of whatever fired it.
      SH.navigate(target, { bubbles: true, composed: true });
    }
    // THE RETURN, said: a block that swipes goes back to its start page
    try { window.dispatchEvent(new CustomEvent('hk-idle-return')); } catch (e) { /* no event bus */ }
  }

  var timer = null;

  function numberState(client, entityId) {
    var entity = client.states[entityId];
    if (!entity) return 0;
    var value = Number(entity.state);
    return isFinite(value) && value > 0 ? value : 0;
  }

  function preferenceMs() {
    if (IDLE_OVERRIDE_MS !== null) return IDLE_OVERRIDE_MS;
    // 1.14: the tablet's own Idle Time (else All Tablets'), in seconds; 0 never
    if (!legacyFeed()) {
      var t = tabletHere();
      var s = t && typeof t.idle_time === 'number' ? t.idle_time : DEFAULT_IDLE_MS / 1000;
      return s > 0 ? s * 1000 : 0;
    }
    var room = roomFor(parts().dash);
    if (!room) return DEFAULT_IDLE_MS;
    try {
      var client = currentClient();
      if (!client || !client.states) return DEFAULT_IDLE_MS;
      var pref = client.states['input_select.' + room + '_tablet_idle_return'];
      if (!pref) return DEFAULT_IDLE_MS;
      if (Object.prototype.hasOwnProperty.call(FIXED_OPTIONS, pref.state)) {
        return FIXED_OPTIONS[pref.state];
      }
      if (pref.state === 'Auto (10s before Room Idle)') {
        var seconds = numberState(client, 'input_number.' + room + '_tablet_room_idle') ||
          numberState(client, idleSetting('default', null)) || 60;
        return Math.max(10, seconds - 10) * 1000;
      }
    } catch (err) {
      // HA can briefly be absent while the frontend is bootstrapping.
    }
    return DEFAULT_IDLE_MS;
  }

  var holds = {};
  function reset() {
    if (timer) clearTimeout(timer);
    timer = null;
    currentIdleMs = preferenceMs();
    // HELD: something on screen is being WATCHED, not read --
    // live TV, with no touches for an hour. A hold keeps the tablet where it
    // is until it is released; see hold() below.
    if (Object.keys(holds).length) return;
    // 0 MEANS OFF, not "go home now". hkIdle.set(0) is documented
    // below as the way to disable this for a debugging session, and without
    // this guard it would do the exact opposite: setTimeout(goHome, 0) fires
    // on the next tick, so the one call meant to stop the navigation would
    // trigger it.
    if (!(currentIdleMs > 0)) return;
    // Only arm on a subview, or on Home with a block away from its start
    // page. Otherwise on the dashboard there is nowhere to go, and an armed
    // timer there would be a periodic wakeup for no reason.
    if (onSubview() || awayHome()) timer = setTimeout(goHome, currentIdleMs);
  }

  // Touch and pointer cover a wall tablet; wheel and keydown cover a desktop
  // browser looking at the same dashboard. `touchmove` and `wheel` matter as
  // much as the taps -- scrolling a long page IS using it, and without them a
  // slow read of the Lights page would be navigated away mid-scroll.
  ['pointerdown', 'touchstart', 'touchmove', 'wheel', 'keydown', 'click']
    .forEach(function (e) {
      window.addEventListener(e, reset, { passive: true, capture: true });
    });

  // A view change is itself activity, and it is also what arms the timer when
  // you first open a subview. Both HA's navigate() and the browser's own back
  // button land here.
  SH.onNavigate(reset);
  window.addEventListener('popstate', reset);

  // Coming back from the screensaver should not immediately fire a countdown
  // that was already most of the way through when the screen went dark.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) reset();
  });

  window.hkIdle = {
    // Console helpers. hkIdle.now() tests the navigation without waiting, and
    // hkIdle.set(0) disables it for a debugging session. hkIdle.set(null)
    // clears the override and returns to the Home Assistant preference.
    now: goHome,
    set: function (ms) {
      IDLE_OVERRIDE_MS = ms === null ? null : Number(ms);
      reset();
      return currentIdleMs;
    },
    // hold(key, true) keeps the tablet on this page until hold(key, false):
    // the live TV player holds while it is open. Keyed, so two holders
    // cannot release each other's hold.
    // what is holding the page (a detail sheet, Live TV): the screensaver
    // does not start while anything is
    held: function () { return Object.keys(holds); },
    hold: function (key, on) {
      if (on) holds[key] = true; else delete holds[key];
      reset();
      return Object.keys(holds);
    },
    // away(key, on): a block on Home is off its start page (a Home Grid's
    // pager) until away(key, false); keyed, as hold() is. The return then
    // comes on Home too, as the window event hk-idle-return.
    away: function (key, on) {
      if (on) aways[key] = true; else delete aways[key];
      reset();
      return Object.keys(aways);
    },
    status: function () {
      return { onSubview: onSubview(), armed: !!timer, idleMs: currentIdleMs,
        overridden: IDLE_OVERRIDE_MS !== null, holds: Object.keys(holds), aways: Object.keys(aways) };
    }
  };

  reset();
})();
