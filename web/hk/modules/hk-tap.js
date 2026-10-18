// hk-tap.js - holds a tap "active" look on momentary tiles (scene pills).
//
// Scenes, scripts and playlist buttons have no on-state to settle into, so a
// press has to leave its own trace. CSS :active dies with the finger, so the
// pill would flash for however long the tap lasted and no longer. This module
// adds .hk-tapped to the pressed ha-card and holds it for HOLD_MS, which is
// also exactly how long the progress ring in cards/hk-tile.js (the scene
// pill's `--hk-tap` opt-in) takes to sweep once round the icon.
//
// Opt-in is by marker: a template declares `--hk-tap: 1` on its ha-card and we
// read it back off the computed style. Nothing else is inspected, so this can
// never touch a card that did not ask for it.
(function () {
  'use strict';

  var HOLD_MS = 1050;          // must match hk-ring-sweep's duration
  var CLASS = 'hk-tapped';
  var timers = new WeakMap();

  // ------------------------------------------------- TAP vs SCROLL
  //
  // The held state cannot simply go on at `pointerdown`. On a wall tablet that
  // would be right -- a finger touching a pill is a tap. On a PHONE it is
  // wrong most of the time: the page is many screens tall, so the
  // overwhelmingly common thing a finger does to a pill is push it out of the
  // way. The pill would flip to its solid-white ACTIVE plate and HOLD it for
  // 1,050ms while the page scrolled out from under it, which reads as "I just
  // launched that scene".
  //
  // A touch is ambiguous at the moment it lands and stays ambiguous until the
  // finger either moves or lifts, so the only correct behavior is to WAIT:
  //
  //   * mouse            -- unambiguous, applied immediately.
  //   * touch / pen      -- applied ON POINTERUP, and only if the finger never
  //                         traveled more than SLOP.
  //   * moved past SLOP  -- a drag. Never applied; and if it was already
  //                         applied (mouse), taken back off.
  //   * pointercancel    -- the browser has taken the gesture for scrolling.
  //
  // WHY POINTERUP AND NOT A SHORT TIMER. A 90ms delay is not good enough: on
  // a phone flick, Safari can take longer than 90ms to decide it is
  // scrolling, so the class goes on, the ring starts its sweep, and
  // pointercancel then takes it off again -- a started-and-aborted animation.
  // A timer can only ever shorten that window, never close it.
  //
  // Waiting for the lift closes it, and closing it costs nothing here, because
  // THE SCENE RUNS ON THE LIFT TOO: tap_action fires from `click`, which is
  // dispatched after pointerup. Starting on the press would show the ring
  // BEFORE the thing it reports has happened; this way feedback coincides
  // with the action instead of anticipating it, and the 1,050ms hold and the
  // sweep are the same once it starts.
  //
  // A press-and-hold shows nothing until release. That is correct for these
  // cards: every one of them sets `hold_action: none`, so a hold has no
  // meaning to report.
  var SLOP = 10;               // px of travel that means "this is a drag"
  var gesture = null;          // { card, id, x, y, applied }

  // --hk-ring is animated from 0deg to 360deg by the conic-gradient that draws
  // the ring. An UNREGISTERED custom property is just a token stream and cannot
  // be interpolated - it would jump 0 -> 360 at the halfway mark - so it has to
  // be registered as an <angle>. @property inside a shadow-root stylesheet is
  // not reliably honored, hence doing it here at document scope.
  try {
    if (window.CSS && CSS.registerProperty) {
      CSS.registerProperty({
        name: '--hk-ring',
        syntax: '<angle>',
        inherits: false,
        initialValue: '0deg'
      });
    }
  } catch (e) {
    // Already registered (a second load, or a re-registration after a
    // frontend reload). Harmless - the first registration still stands.
  }

  function optedIn(card) {
    try {
      return getComputedStyle(card).getPropertyValue('--hk-tap').trim() === '1';
    } catch (e) {
      return false;
    }
  }

  function hold(card) {
    var t = timers.get(card);
    if (t) {
      clearTimeout(t);
      // Re-tapping mid-sweep: removing and re-adding the class in the same
      // frame does NOT restart a running animation, so force a reflow between
      // the two so the ring starts over from 0deg.
      card.classList.remove(CLASS);
      void card.offsetWidth;
    }
    card.classList.add(CLASS);
    timers.set(card, setTimeout(function () {
      card.classList.remove(CLASS);
      timers.delete(card);
    }, HOLD_MS));
  }

  // ------------------------------------------------- KILL THE TAP HIGHLIGHT
  //
  // Android WebView paints a gray rounded box over whatever was touched, and on
  // a wall tablet it lands on every chip, every tile and the header clock --
  // a flat gray rectangle with the wrong radius, over a design built on glass.
  //
  // It comes from HA's own frontend, not from us:
  //
  //     partial-panel-resolver, ha-sidebar {
  //       -webkit-tap-highlight-color: rgba(0, 0, 0, 0.1);
  //     }
  //
  // in home-assistant-main's ADOPTED stylesheet. The property is inherited, and
  // partial-panel-resolver is the ancestor of the whole view, so everything
  // below it inherits that color -- which is why a document-level
  // `html { ... }` rule does nothing: inheritance restarts there and wins.
  //
  // So the override has to go into the same shadow root. Appending a
  // constructable sheet leaves HA's own styles intact and needs no element to
  // still exist when we run.
  //
  // NOT `user-select: none` as well: text selection is already off on the cards
  // and turning it off globally would break the code editors in Settings.
  function killTapHighlight() {
    try {
      var ha = document.querySelector('home-assistant');
      var main = ha && ha.shadowRoot && ha.shadowRoot.querySelector('home-assistant-main');
      var root = main && main.shadowRoot;
      if (!root || root.__hkTapHighlightOff) return !!(root && root.__hkTapHighlightOff);
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(
        'partial-panel-resolver,ha-sidebar{-webkit-tap-highlight-color:transparent !important}'
      );
      root.adoptedStyleSheets = root.adoptedStyleSheets.concat(sheet);
      root.__hkTapHighlightOff = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  // home-assistant-main is not guaranteed to exist when a bootstrap module
  // runs, so retry on a short backoff and give up rather than poll forever.
  // rAF is not used: it never fires in a hidden tab, which is exactly the state
  // a tablet is in behind the screensaver.
  if (!killTapHighlight()) {
    var tries = 0;
    var t = setInterval(function () {
      if (killTapHighlight() || ++tries > 40) clearInterval(t);
    }, 250);
  }

  // Take the held state back off, timer and all. Used when a press that had
  // already been applied turns out to have been the start of a drag.
  function release(card) {
    var t = timers.get(card);
    if (t) { clearTimeout(t); timers.delete(card); }
    card.classList.remove(CLASS);
  }

  function abort() {
    if (!gesture) { return; }
    if (gesture.applied) { release(gesture.card); }
    gesture = null;
  }

  function apply() {
    if (!gesture || gesture.applied) { return; }
    gesture.applied = true;
    hold(gesture.card);
  }

  // The first ha-card up the composed path, or null. composedPath is the only
  // way through a card's shadow root; the event target itself is always
  // the host element.
  function cardUnder(ev) {
    var path = ev.composedPath ? ev.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (el && el.localName === 'ha-card') { return el; }
    }
    return null;
  }

  document.addEventListener('pointerdown', function (ev) {
    abort();                            // a new press supersedes the old one
    // A right-click (or a Mac's control-click) opens detail and does not tap
    // the tile, so it shows no tap either.
    if (ev.pointerType === 'mouse' && (ev.button !== 0 || ev.ctrlKey)) { return; }
    var card = cardUnder(ev);
    if (!card || !optedIn(card)) { return; }
    // MOUSE: applied immediately -- a mouse press is not ambiguous the way a
    // touch is, and delaying it would make the desktop feel laggy for no gain.
    // It IS still tracked, so that hk-row-card's mouse click-drag cancels it
    // the same way a finger scroll does: without this, grabbing the chip row
    // and dragging it left leaves whichever pill was under the cursor looking
    // tapped for a second. Same bug as the phone one, different input device.
    if (ev.pointerType === 'mouse') {
      hold(card);
      gesture = {
        card: card, id: ev.pointerId, x: ev.clientX, y: ev.clientY,
        applied: true
      };
      return;
    }
    // Touch: armed only. Nothing is shown until the finger lifts.
    gesture = {
      card: card, id: ev.pointerId, x: ev.clientX, y: ev.clientY,
      applied: false
    };
  }, { capture: true, passive: true });

  document.addEventListener('pointermove', function (ev) {
    if (!gesture || ev.pointerId !== gesture.id) { return; }
    var dx = ev.clientX - gesture.x;
    var dy = ev.clientY - gesture.y;
    if (dx * dx + dy * dy > SLOP * SLOP) { abort(); }
  }, { capture: true, passive: true });

  document.addEventListener('pointerup', function (ev) {
    if (!gesture || ev.pointerId !== gesture.id) { return; }
    apply();                            // lifted without traveling: a tap
    gesture = null;
  }, { capture: true, passive: true });

  // pointercancel is the browser saying "I am scrolling with this now".
  // The scroll listener is belt and braces for the containers that begin
  // scrolling without cancelling the pointer.
  document.addEventListener('pointercancel', abort, { capture: true, passive: true });
  document.addEventListener('scroll', abort, { capture: true, passive: true });
})();
