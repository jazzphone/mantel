// hk-timers.js - a live countdown a card cannot draw on its own.
//
// WHY THIS EXISTS
// A card render is a pure function of the states, and it runs when one of the
// entities it watches CHANGES STATE (HkBase gates on last_updated). A running
// timer changes state exactly twice -- once when it starts and once when it
// finishes. In between, the only thing moving is the wall clock, and no state
// update arrives. So a countdown drawn at render time is a number that is correct
// for one frame and then wrong for an hour, which is worse than showing
// nothing.
//
// hk-stats.js has the same shape of problem (data that arrives after a
// synchronous render) and solves it by waking the card. That is the wrong fix
// here: re-rendering a whole card every second, on a page that can hold thirty
// of them, on a wall tablet, is a lot of layout work to move one glyph.
//
// WHAT IT DOES INSTEAD
// Defines <hk-countdown>, a custom element that owns one text node and
// repaints only that. A timer card emits the element; this file keeps a single
// document-wide interval and writes to each live instance.
//
// WHY A CUSTOM ELEMENT AND NOT A querySelectorAll SWEEP
// These cards render into their own shadow roots, nested inside more shadow
// roots again (hui-view and friends). document.querySelectorAll cannot see any
// of it, so a sweep would mean walking every shadowRoot in the document once a
// second -- the expensive, fragile version of what the platform already does
// for free. Custom elements upgrade wherever they are constructed, shadow DOM
// included, and connectedCallback / disconnectedCallback give exact
// registration and, more importantly, exact CLEANUP: a card that rebuilds its
// subtree destroys instances constantly, and anything holding them by hand
// would leak one per render.
//
// THE INTERVAL RUNS ONLY WHEN SOMETHING IS COUNTING
// It starts on the first connect and stops on the last disconnect. On a
// dashboard where this module is loaded but no countdown exists, nothing ticks
// at all. Same reason the sky's poll is conditional.
//
// TAB VISIBILITY
// No visibilitychange handling on purpose -- but NOT for the reason that is
// easy to assume. MEASURED: the browser does NOT throttle the interval by
// itself here. The WallPanel screensaver is a DOM overlay in the SAME document, so
// `document.hidden` stays false and Chromium never throttles anything. This is
// the whole reason hk-sky has to take an explicit screensaver boolean instead
// of listening to visibilitychange; see the long note there.
//
// The real grounds for skipping it: the interval only
// EXISTS while a countdown does (start()/stop() below), and a tick is a few
// short-circuiting no-ops a second over a handful of elements. If that ever
// stops being true, the fix is the screensaver boolean, not visibilitychange,
// which would do nothing here. paint() also recomputes from the deadline
// rather than an accumulated count, so a throttled or missed hour costs
// nothing but a stale frame.
(function () {
  'use strict';

  if (window.hkTimers) return;   // double-load guard, as in hk-sky.js

  var live = new Set();
  var tick = null;

  // The whole point of the module, in one line: time is read from the
  // DEADLINE, never accumulated. A missed tick, a throttled tab and a
  // suspended tablet all self-correct on the next frame.
  //
  // `hold` is the PAUSED case and it takes priority. A paused timer has no
  // deadline -- it has a fixed number of seconds left that does not move until
  // somebody resumes it -- so there is nothing to compute and the interval must
  // not be allowed to walk it down. (Expressing pause as
  // "deadline = now + remaining" reads correctly for exactly one frame and
  // then ticks away merrily, because the card only re-renders on a STATE
  // change and pausing is the last one that happens.)
  // `since` COUNTS UP instead of down, and it is the same idea read the other
  // way: time comes from a fixed point and the clock, never accumulated.
  // It exists for the media player's elapsed time: rendered as TEXT it would
  // freeze while the progress bar beside it, a CSS animation, kept moving --
  // a track playing on visibly while "1:02" sat still until something forced
  // the card to re-render.
  //
  // `since` is the epoch ms at which the track was at 0:00, i.e.
  // now - position. Capped at `total` so a finished track reads its duration
  // rather than counting past it while HA catches up.
  //
  // `hold` still wins, and serves both directions: for a countdown it is the
  // seconds remaining on a paused timer, for this it is the seconds elapsed on
  // a paused track. Either way it is a fixed number the interval must not walk.
  function remaining(el) {
    // `!= null`, LOOSELY, catches undefined as well as null. A browser hands
    // back null for a missing attribute; not every host does, and reading a
    // stray undefined as "the attribute is set" makes it Number()-to-NaN and
    // then 0, which is a frozen clock rather than a visible error.
    var hold = el.getAttribute('hold');
    if (hold != null && hold !== '') return Math.max(0, Number(hold) || 0);
    var since = el.getAttribute('since');
    if (since != null && since !== '') {
      var up = Math.max(0, Math.round((Date.now() - Number(since)) / 1000));
      var cap = Number(el.getAttribute('total')) || 0;
      return cap > 0 ? Math.min(up, cap) : up;
    }
    var end = Number(el.getAttribute('deadline')) || 0;
    return Math.max(0, Math.round((end - Date.now()) / 1000));
  }

  // H:MM:SS above an hour, M:SS below it -- Apple's Clock app, and the format
  // HA's own timer state uses, so a card and its more-info dialog agree.
  // Seconds are NOT dropped on long timers: a countdown whose last digit does
  // not move reads as frozen, which is the exact impression this file exists
  // to avoid.
  function fmt(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = (h && m < 10 ? '0' : '') + m;
    return (h ? h + ':' : '') + mm + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function paint(el) {
    var s = remaining(el);
    var txt = fmt(s);
    // Guard the write. Assigning identical text still invalidates layout in
    // some engines, and with thirty instances at 1Hz that is thirty needless
    // reflows a second on a paused timer.
    if (el._hkLast !== txt) {
      el._hkLast = txt;
      el.textContent = txt;
    }
    // Hand the fraction back to CSS so the progress bar is driven by the same
    // clock, without a second element type and without a second interval.
    //
    // The var goes on the PARENT, not on this element. The bar is a SIBLING of
    // the countdown and custom properties only inherit downward, so setting it
    // here would be invisible to the bar. The parent is guaranteed to be the
    // wrapper html() emits, which is the nearest common ancestor of both.
    //
    // Deliberately NOT el.closest('...') up to the card: `closest` stops dead
    // at a shadow boundary, and the cards render inside their own shadow
    // roots, so it would find nothing and fail silently.
    var total = Number(el.getAttribute('total')) || 0;
    var host = el.parentElement;
    // --hk-left means "fraction REMAINING", which is what a timer's bar
    // shrinks by. A count-up has no such thing -- publishing s/total here
    // would drive a sibling bar backwards -- and the media player's progress
    // fill is a CSS animation that needs no help, so skip it entirely.
    if (el.hasAttribute('since')) return;
    if (total > 0 && host) {
      var frac = Math.max(0, Math.min(1, s / total));
      // Two decimals. The bar is at most ~400px wide, so anything finer than
      // 1/100 cannot move a pixel, and rounding keeps this from invalidating
      // style on every one of the four samples per second.
      var q = frac.toFixed(2);
      if (host._hkFrac !== q) {
        host._hkFrac = q;
        host.style.setProperty('--hk-left', q);
      }
    }
  }

  function start() {
    if (tick) return;
    // 250ms, not 1000. At exactly 1Hz the displayed second lags the true one by
    // up to a full second depending on when the interval happened to start,
    // which is visible when two cards start together and disagree. Sampling
    // four times as often costs nothing (paint() short-circuits on unchanged
    // text) and keeps every card within 250ms of the truth and of each other.
    tick = setInterval(function () { live.forEach(paint); }, 250);
    // Note this deliberately keeps running when every instance is paused. It is
    // four no-op sweeps a second over a handful of elements, and the
    // bookkeeping to stop and restart it correctly (a card can be paused and
    // resumed without ever disconnecting) costs more than it saves.
  }

  function stop() {
    if (tick) { clearInterval(tick); tick = null; }
  }

  var Countdown = class extends HTMLElement {
    static get observedAttributes() { return ['deadline', 'hold', 'total', 'since']; }

    connectedCallback() {
      // Inline so it sits in the text flow beside a label without the card
      // needing to know this is a custom element. `tabular-nums` is the
      // load-bearing one: SF Pro's proportional digits are different widths, so
      // an untreated countdown JITTERS sideways every time a 1 ticks past.
      this.style.fontVariantNumeric = 'tabular-nums';
      this.style.fontFeatureSettings = '"tnum"';
      live.add(this);
      paint(this);
      start();
    }

    disconnectedCallback() {
      live.delete(this);
      if (!live.size) stop();
    }

    // A paused timer's card re-renders with a NEW deadline (HA moves it forward
    // by however long the pause lasted). Without this the element would keep
    // counting to the old one until something else forced a repaint.
    attributeChangedCallback() {
      if (this.isConnected) paint(this);
    }
  };

  if (!customElements.get('hk-countdown')) {
    customElements.define('hk-countdown', Countdown);
  }

  // ---- THE DOCKED STRIP (2026-10-10): the timers as part of the docked
  // now-playing bar (hk-popup `dock`), on its plate, one slim row (52 px) on
  // every screen -- the user asked that it take hardly more room than the
  // player. Soonest to finish first. Wide (>= 600 px of row): one column each,
  // up to four across, hairlines between. Narrow (a phone): one timer at a
  // time, swiped across, dots saying how many. Each timer's time left is a
  // ring round its glyph, driven by the countdown's own tick (--hk-left on
  // the countdown's parent, the segment).
  var DOCK_CSS = [
    '.td{position:relative;container-type:inline-size;background:var(--hk-td-plate,rgb(22,23,26));',
    '  border-bottom:1px solid rgba(255,255,255,0.08)}',
    '.td .sc{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}',
    '.td .sc::-webkit-scrollbar{display:none}',
    // a quarter of the row each, whatever the count, from the left (in line
    // with the player's art): one timer stretched across it read as a strange
    // empty bar with its buttons far from its name
    '.td .sg{position:relative;flex:0 0 25%;min-width:0;height:52px;box-sizing:border-box;padding:0 16px;',
    '  display:grid;grid-template-columns:30px minmax(0,1fr) auto;grid-template-rows:auto auto;',
    '  grid-template-areas:"g n c" "g t c";column-gap:12px;align-content:center;scroll-snap-align:start}',
    '.td .sg+.sg::before{content:"";position:absolute;left:0;top:10px;bottom:10px;border-left:1px solid rgba(255,255,255,0.10)}',
    '.td .rg{grid-area:g;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    '  background:conic-gradient(#ff9f0a calc(var(--hk-left,1) * 360deg),rgba(255,255,255,0.14) 0)}',
    '.td .gl{width:24px;height:24px;border-radius:50%;background:#ff9f0a;display:flex;align-items:center;justify-content:center;',
    '  box-shadow:0 0 0 2px var(--hk-td-plate,rgb(22,23,26))}',
    '.td .gl hk-icon{--mdc-icon-size:15px;color:rgba(0,0,0,0.82)}',
    '.td .nm{grid-area:n;font-size:12px;font-weight:600;line-height:1.15;color:rgba(255,255,255,0.6);',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}',
    '.td hk-countdown{grid-area:t;font-size:18px;line-height:1.1;letter-spacing:-0.3px;color:rgba(255,255,255,0.97);text-align:left}',
    '.td .ct{grid-area:c;display:flex;align-items:center;gap:6px;pointer-events:auto}',
    '.td .ct button{width:36px;height:36px;border-radius:18px;border:0;padding:0;cursor:pointer;background:rgba(255,255,255,0.14);',
    '  display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}',
    '.td .ct hk-icon{--mdc-icon-size:18px;color:rgba(255,255,255,0.92)}',
    '.td .dt{display:none}',
    // NARROW: one at a time, swiped; Restart goes (the Timers page has it)
    '@container (max-width:599px){',
    '  .td .sg{flex:0 0 100%}',
    '  .td .sg+.sg::before{display:none}',
    '  .td .ct .rs{display:none}',
    '  .td .dt{display:flex;position:absolute;left:0;right:0;bottom:4px;justify-content:center;gap:5px;pointer-events:none}',
    '  .td .dt i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,0.28)}',
    '  .td .dt i.on{background:rgba(255,255,255,0.85)}}'
  ].join('');
  function docked(rows, o) {
    var esc = function (v) {
      return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    };
    rows = rows.slice().sort(function (a, b) { return Date.parse(a.finishes_at) - Date.parse(b.finishes_at); });
    var btn = function (id, cls, icon, what, label) {
      return '<button type="button" class="' + cls + '" aria-label="' + label + '" ' +
        'data-hk-timer="' + esc(id) + '" data-hk-timer-act="' + what + '">' +
        '<hk-icon icon="' + icon + '"></hk-icon></button>';
    };
    var segs = rows.map(function (r) {
      var end = Date.parse(r.finishes_at);
      if (isNaN(end)) return '';
      var total = r.total ? ' total="' + Number(r.total) + '"' : '';
      return '<div class="sg">' +
        '<div class="rg"><div class="gl"><hk-icon icon="mdi:timer-outline"></hk-icon></div></div>' +
        '<div class="nm">' + esc(r.name || 'Timer') + '</div>' +
        '<hk-countdown deadline="' + end + '"' + total + '></hk-countdown>' +
        (r.entity_id ? '<div class="ct">' + btn(r.entity_id, 'rs', 'mdi:restart', 'restart', 'Restart timer') +
          btn(r.entity_id, 'pl', 'mdi:plus', 'plus', 'Add one minute') +
          btn(r.entity_id, 'fn', 'mdi:flag-checkered', 'finish', 'Finish timer') + '</div>' : '') +
        '</div>';
    }).join('');
    var dots = rows.length > 1 ? '<div class="dt">' + rows.map(function (r, i) { return '<i' + (i ? '' : ' class="on"') + '></i>'; }).join('') + '</div>' : '';
    return '<style>' + DOCK_CSS + '</style><div class="td"><div class="sc" data-hk-timer-dots>' +
      segs + '</div>' + dots + '</div>';
  }

  window.hkTimers = {
    DOCK_CSS: DOCK_CSS,                      // tests (test_csssnapshot)
    // THE DOCKED STRIP'S DOTS follow its swipe
    dots: function (sc) {
      var d = sc && sc.nextElementSibling;
      if (!d || !sc.clientWidth) return;
      var n = Math.round(sc.scrollLeft / sc.clientWidth);
      Array.prototype.forEach.call(d.children, function (dot, i) { dot.classList.toggle('on', i === n); });
    },
    // Called from the card templates. Returns the markup for one countdown.
    //
    // `finishes_at` is an ISO string on a RUNNING timer and absent on a paused
    // or idle one; `remaining` is an H:MM:SS string that is present on a paused
    // timer and is the only source of truth there. Handling both here rather
    // than in every card that shows a timer.
    html: function (attrs, opts) {
      var o = opts || {};
      var a = attrs || {};
      var total = window.hkTimers.secs(a.duration);
      var end, running = false;

      if (a.finishes_at) {
        end = Date.parse(a.finishes_at);
        running = !isNaN(end);
      }
      var hold = null;
      if (!running) {
        // Paused, or any state with no deadline. `remaining` is the only truth
        // here and it is a fixed number, so it is passed as `hold` and the
        // element stops counting -- see remaining() above for why this is not
        // expressed as a deadline.
        hold = window.hkTimers.secs(a.remaining);
        if (!hold) return '';
      }

      var num = 'font-size:' + (o.size || 30) + 'px;font-weight:' +
        (o.weight || 300) + ';letter-spacing:' + (o.tracking || '-0.8') +
        'px;line-height:1;color:' + (o.color || 'var(--hk-ink,rgba(255,255,255,0.94))') +
        ';display:block;';

      // The wrapper is load-bearing, not cosmetic: paint() writes --hk-left to
      // this element so the bar below can read it. Do not flatten it away.
      //
      // text-align:left is explicit because a host may center its content,
      // and a centered countdown over a full-width bar leaves the one big
      // number on the card out of line with the name above it and the buttons
      // below -- the only centered thing on an otherwise left-aligned page.
      var clock = running ? 'deadline="' + end + '"' : 'hold="' + hold + '"';
      var out = '<div style="display:block;width:100%;text-align:left;">' +
                '<hk-countdown ' + clock + ' total="' + total +
                '" style="' + num + '"></hk-countdown>';

      if (o.bar !== false && total > 0) {
        // Track + fill. The fill SHRINKS as time runs out rather than an
        // elapsed bar growing: a bar that empties is the shape "you have this
        // much left", which is what the number above it says, and the two
        // moving the same direction is the whole reason to draw both.
        //
        // The 1 fallback in var(--hk-left, 1) matters. Between the card's
        // render and hk-timers.js's first tick there is one frame with no
        // value; defaulting to 0 would flash an empty bar on every render, and
        // a card re-renders on every state change.
        var fill = running ? (o.fill || 'rgba(255,159,10,0.95)')
                           : 'var(--hk-ink-3,rgba(255,255,255,0.40))';
        out += '<div style="margin-top:10px;height:4px;border-radius:2px;' +
               'background:var(--hk-line-strong,rgba(255,255,255,0.18));overflow:hidden;">' +
               '<div style="height:100%;border-radius:2px;background:' + fill +
               ';width:calc(var(--hk-left, 1) * 100%);"></div></div>';
      }
      return out + '</div>';
    },

    // Timer actions from the strip's pills. These are inline handlers in an
    // HTML string (hkTimers.strip), which run in global scope with no client
    // in reach -- hence the host adapter's current client.
    //
    // LIVE REMAINING COMES FROM finishes_at, NOT from the `remaining`
    // attribute. On an ACTIVE timer `remaining` is frozen at whatever it was
    // when the timer started (a 2-minute timer reads 0:02:00 at t+3s, t+25s
    // and t+45s while the real remaining ticks 116 -> 96 -> 76). Only finishes_at moves. Adding a
    // minute to `remaining` would therefore RESET a long-running timer to its
    // original length plus one minute instead of extending what is left.
    // `remaining` IS the truth on a PAUSED timer, where finishes_at is null --
    // hence the branch.
    //
    // There is no service that adds time: timer.start with a duration restarts
    // at that duration (and rewrites the `duration` attribute), so an extension
    // has to be expressed as an absolute new length.
    act: function (entityId, what) {
      // The host's current client (in Home Assistant, the frontend's root
      // element's, as before); its action port makes the call -- refused in
      // Mantel, where commands are disabled.
      var HC = window.hkHostClient;
      var client = HC && HC.current ? HC.current() : null;
      if (!client || !client.actions) {
        console.error('[hk-timers] no client for ' + what + ' on ' + entityId);
        return false;
      }
      var st = client.states && client.states[entityId];
      if (!st) return false;

      if (what === 'finish') {
        // finish, not cancel: it FIRES the finished event, so whatever the
        // timer was for actually happens. Cancel is the silent one and is
        // deliberately not offered here, exactly as on the Timers page.
        client.actions.callService('timer', 'finish', { entity_id: entityId });
        return true;
      }

      var left;
      if (st.state === 'active' && st.attributes.finishes_at) {
        left = Math.max(0, (Date.parse(st.attributes.finishes_at) - Date.now()) / 1000);
      } else {
        left = this.secs(st.attributes.remaining);
      }

      var total;
      if (what === 'restart') total = this.secs(st.attributes.duration);
      else if (what === 'plus') total = Math.round(left) + 60;
      else return false;

      if (!(total > 0)) return false;
      var p = function (n) { return String(n).padStart(2, '0'); };
      var hhmmss = Math.floor(total / 3600) + ':' +
                   p(Math.floor((total % 3600) / 60)) + ':' + p(total % 60);
      client.actions.callService('timer', 'start', { entity_id: entityId, duration: hhmmss });
      return true;
    },

    // The floating widget's row list, shared by the #media pop-up and the
    // WallPanel screensaver so the two cannot drift apart.
    //
    // `list` is sensor.running_quick_timers's `running` attribute: already
    // filtered to timers a person created, already sorted by finishes_at.
    // Taking the prepared list rather than walking `states` here keeps the
    // "which timers count" rule in exactly one place (the sensor), where the
    // pop-up's trigger condition also reads it.
    strip: function (list, opts) {
      var o = opts || {};
      var rows = (list || []).filter(function (r) { return r && r.finishes_at; });
      if (!rows.length) return '';
      if (o.docked) return docked(rows, o);

      var scale = o.scale || 1;                 // screensaver draws it larger
      var px = function (n) { return Math.round(n * scale) + 'px'; };

      // PILL CONTROLS (plated only). Restart / +1 min / Finish.
      //
      // The strip is an HTML string, so its buttons carry data-hk-timer and
      // one delegated listener (bottom of this file) calls act() -- never an
      // inline onclick, which Mantel's CSP (script-src 'self') refuses: the
      // buttons did nothing there. It stops the tap: without that it would
      // also reach the card underneath.
      //
      // NOT on the screensaver: that row is a glance from across a room behind
      // a photo, it is pointer-events:none, and nobody is tapping it.
      //
      // No Cancel, matching the Timers page: cancel ends a timer SILENTLY while
      // finish fires the event the rest of the house is waiting on, and two
      // buttons that look alike but differ in whether anything happens is a trap.
      // 44px normally; 36 once a FOURTH timer is running, which is the only
      // count where three full-size buttons plus the countdown do not fit in
      // a quarter of the pop-up (measured: 274px pill, and the countdown alone
      // is ~51px). Four quick-timer slots is the hard maximum, so this is the
      // one narrow case rather than an open-ended problem.
      var bsz = rows.length >= 4 ? 36 : 44;
      var controls = function (id) {
        if (!o.plated || !id) return '';
        var btn = function (icon, what, label) {
          // SINGLE quotes inside the double-quoted attribute. With &quot;
          // entities instead, the buttons do nothing at all.
          return '<button type="button" aria-label="' + label + '" ' +
            'data-hk-timer="' + String(id).replace(/[&<>"]/g, '') + '" data-hk-timer-act="' + what + '" ' +
            // These are wall-tablet touch targets, so they are sized for a
            // finger rather than to match the timer dot: 34 is too easy to
            // miss. See bsz above for the four-timer exception.
            'style="flex:0 0 auto;width:' + px(bsz) + ';height:' + px(bsz) +
            ';border-radius:' + px(bsz / 2) + ';border:0;padding:0;cursor:pointer;' +
            'pointer-events:auto;' +
            'background:rgba(255,255,255,0.16);display:flex;align-items:center;' +
            'justify-content:center;-webkit-tap-highlight-color:transparent;">' +
            '<hk-icon icon="' + icon + '" style="--mdc-icon-size:' + px(Math.round(bsz * 0.5)) +
            ';color:rgba(255,255,255,0.92);"></hk-icon></button>';
        };
        // pointer-events:auto is THE thing that makes these work wherever an
        // ancestor sets `pointer-events: none` (a card with no tap action
        // often does). pointer-events INHERITS, so every descendant --
        // including these buttons -- would be un-hit-testable and a tap would
        // land on whatever is underneath, with the onclick never the problem.
        //
        // Re-enabling it on the buttons ONLY is deliberate: the rest of the
        // pill stays inert, so a stray tap on the name or the countdown still
        // does nothing.
        return '<div style="flex:0 0 auto;display:flex;align-items:center;' +
               'pointer-events:auto;gap:' +
               px(5) + ';margin-inline-start:' + px(8) + ';">' +
                 btn('mdi:restart', 'restart', 'Restart timer') +
                 btn('mdi:plus', 'plus', 'Add one minute') +
                 btn('mdi:flag-checkered', 'finish', 'Finish timer') +
               '</div>';
      };

      var html = rows.map(function (r) {
        var end = Date.parse(r.finishes_at);
        if (isNaN(end)) return '';
        var name = String(r.name || 'Timer').replace(/[&<>"]/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
        // No `total` attribute, so no progress bar: this is a glance, not a
        // control surface. The bar belongs on the Timers page where there is
        // room for it to mean something.
        return '<div style="display:flex;align-items:center;gap:' + px(12) + ';' +
               // THREE MATERIALS, and the pill has to wear the one its
               // NEIGHBOR is wearing:
               //
               //   glass    the now-playing BAR's own tint, which it rides
               //            above. The two are one visual stack and an opaque
               //            strip over a translucent bar read as a mistake.
               //            Same recipe as hk-plate.np.bar in cards/hk-media.js
               //            -- change one, change both. NO BACKDROP BLUR,
               //            like the bar: fixed over a scrolling page, a blur
               //            re-blurs every frame.
               //   plated   the opaque gradient, for the MODAL #media pop-up
               //            (phone, car), whose player is opaque. Glass pills
               //            on that sheet would be the same mismatch the other
               //            way round.
               //   neither  the WallPanel screensaver's corner overlay: no
               //            plate at all, on somebody's holiday photo.
               'min-width:0;' + (o.plated
                 ? 'flex:1 1 0;box-sizing:border-box;' + (o.glass
                     ? 'background:rgba(22,23,26,.92);'
                     : 'background:linear-gradient(125deg,#2a2524,#14161c);') +
                   'border-radius:999px;padding:' + px(10) + ' ' + px(14) + ';'
                 : '') + '">' +
                 '<div style="flex:0 0 auto;width:' + px(34) + ';height:' + px(34) +
                 ';border-radius:' + px(17) + ';background:rgba(255,159,10,0.95);' +
                 'display:flex;align-items:center;justify-content:center;">' +
                   '<hk-icon icon="mdi:timer-outline" style="--mdc-icon-size:' +
                   px(20) + ';color:rgba(0,0,0,0.82);"></hk-icon></div>' +
                 // text-align:left for the same reason the screensaver's
                 // now-playing card needs it: WallPanel's info box centers its
                 // content and these two lines would inherit that, so the name
                 // and the countdown would center against each other instead
                 // of sharing a left edge. Harmless in the pop-up, required on
                 // the screensaver.
                 '<div style="min-width:0;text-align:left;' +
                 (o.plated ? 'flex:1 1 auto;' : '') + '">' +
                   '<div style="font-size:' + px(14) + ';font-weight:600;' +
                   'letter-spacing:-0.2px;line-height:1.15;' +
                   'color:' + (o.plated ? 'rgba(255,255,255,0.62)' : 'var(--hk-ink-2,rgba(255,255,255,0.68))') + ';white-space:nowrap;' +
                   'overflow:hidden;text-overflow:ellipsis;">' + name + '</div>' +
                   '<hk-countdown deadline="' + end + '" style="font-size:' +
                   px(20) + ';font-weight:400;letter-spacing:-0.4px;line-height:1.1;' +
                   'color:' + (o.plated ? 'rgba(255,255,255,0.97)' : 'var(--hk-ink,rgba(255,255,255,0.94))') + ';"></hk-countdown>' +
                 '</div>' + controls(r.entity_id) + '</div>';
      }).join('');

      // One horizontal row, not a stack. Stacked, four timers would add ~250px
      // to the #media pop-up and push the player off the bottom of an 800px
      // tablet; across, four fit in the pop-up's width and the height is
      // constant however many are running -- which is what lets the pop-up's
      // top margin be a single fixed number.
      //
      // PLATED (the #media pop-up) SPREADS; unplated (the screensaver) HUGS.
      // Left-packed with a fixed gap, a fourth timer would run past the
      // pop-up's width and `overflow:hidden` would simply CUT it off -- running
      // and invisible. Each item takes `flex:1 1 0` instead, so they divide the
      // width evenly however many there are, and a long name ellipsizes inside
      // its own column (the name already has text-overflow) rather than
      // pushing its neighbor off the end.
      //
      // ONE PILL PER TIMER, not one slab holding all of them. Two timers
      // sharing a single plate have nothing between them but whitespace and
      // read as one object with a gap in it. A hairline divider does not fix
      // that: separate objects want separate plates, not a shared plate with
      // rules drawn on it. So the plate is on each ITEM, not on the ROW.
      //
      // Contents sit LEFT inside each pill. Centered, a lone timer's content
      // floats in the middle of a full-width pill with nothing anchoring it.
      // Left-aligned, every pill starts its content at the same offset
      // whatever the count, which is what makes a row of them scan.
      //
      // Fully rounded (999px), not the player's 23.5px, so the row below reads
      // as one card and these read as several chips -- the same distinction
      // the dashboard's own status-chip row makes.
      //
      // The screensaver keeps a hug and NO pill: it is a corner overlay
      // with max-width:46vw over a photo, where plates would be boxes floating
      // on someone's holiday snap, and stretching items across that box would
      // leave a ragged void between two timers instead of a tight glance.
      //
      // Nothing here draws when nothing is running -- this function has already
      // returned '' above. That is why the plate lives in this markup and not
      // on the host card's own style, which would paint an empty slab above
      // the player on every music-only open.
      var row = '<div style="display:flex;align-items:center;gap:' +
                px(o.plated ? 10 : 26) + ';flex-wrap:nowrap;overflow:hidden;' +
                (o.plated ? 'width:100%;' : '') + '">' + html + '</div>';

      // `fixed` pins the row to a viewport corner for the WallPanel
      // screensaver, whose cards live in an info box at the top-left with no
      // layout route to the opposite corner.
      //
      // The positioning is done HERE, in the markup, and deliberately not on
      // the host card: the screensaver's now-playing card does it the same
      // way, while styling a containing CELL is a different mechanism with a
      // different containing block.
      if (!o.fixed) return row;
      // SHADOW ON THIS WRAPPER, NOT ON THE TEXT, and only on the screensaver.
      //
      // The WallPanel info box sets a text-shadow tuned for its 150px clock
      // (a 68px blur), and these two lines inherit it into boxes that are
      // `overflow:hidden` for their ellipsis -- so it comes out as a hard band
      // round the name. text-shadow is painted per element and clipped by that
      // element, so moving it up the tree does not help: it inherits.
      //
      // A filter does help. It applies to an element AFTER that element and
      // its descendants have rendered and clipped, so the ellipsis still works
      // and the shadow escapes. It has to go HERE rather than on the inner
      // text div, because `row` above is itself `overflow:hidden` and would
      // clip a filter applied any deeper. It also covers the icon, which a
      // text-shadow never would.
      //
      // Safe on a position:fixed element: `filter` makes an element a
      // containing block for its fixed DESCENDANTS, not for itself, so the
      // corner pinning is unaffected. There are no fixed descendants here.
      //
      // Radii go through px() so they track `scale` (1.6 on the screensaver),
      // and are sized for 22-32px type -- not for the clock the info box value
      // was written for. text-shadow:none cancels that inherited value so the
      // two do not stack.
      //
      // The PLATED pop-up variant deliberately gets none of this: it sits on
      // an opaque sheet and inherits no shadow to begin with.
      // will-change: its own compositing layer on the screensaver, for the
      // same photo-change flicker as `layer` on hk-clock-card. On this element
      // itself, never an ancestor: see the containing-block note above.
      // (--hk-ss-timers-*: the screensaver's calendar pane, which takes the
      // row into its foot -- hk-saver.js layoutPane)
      return '<div style="position:fixed;left:var(--hk-ss-timers-left,auto);right:var(--hk-ss-timers-right,' + (o.right || '20px') + ')' +
             ';bottom:var(--hk-ss-timers-bottom,var(--hk-ss-corner-bottom,' + (o.bottom || '22px') + '));transition:bottom 1.2s ease;z-index:5;will-change:transform;' +
             'pointer-events:none;max-width:var(--hk-ss-timers-max,46vw);text-shadow:none;' +
             'filter:drop-shadow(0 ' + px(1) + ' ' + px(3) + ' rgba(0,0,0,0.34)) ' +
             'drop-shadow(0 ' + px(3) + ' ' + px(14) + ' rgba(0,0,0,0.30));">' + row + '</div>';
    },

    // "H:MM:SS" or "MM:SS" or a bare number of seconds -> seconds.
    // HA is inconsistent about which of these a timer attribute holds
    // depending on how the timer was configured, so every read goes through
    // here rather than assuming.
    secs: function (v) {
      if (v === undefined || v === null || v === '') return 0;
      if (typeof v === 'number') return v;
      var s = String(v);
      if (/^\d+$/.test(s)) return Number(s);
      var p = s.split(':').map(Number);
      if (p.some(isNaN)) return 0;
      while (p.length < 3) p.unshift(0);
      return p[0] * 3600 + p[1] * 60 + p[2];
    },

    // "1:00:00" -> "1 hr", "0:15:00" -> "15 min". For the SET duration on a
    // card face, where the exact seconds are noise -- the countdown beside it
    // is the precise number.
    pretty: function (v) {
      var s = window.hkTimers.secs(v);
      if (!s) return '';
      var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      if (h && m) return h + ' hr ' + m + ' min';
      if (h) return h + ' hr';
      return m + ' min';
    },

    _live: live
  };

  // ANNOUNCE YOURSELF. Loaded as a hk-loader module there is no script
  // `onload` to borrow, and a card that renders before this file arrives
  // would sit empty forever waiting for a signal nobody sends.
  // Same contract as hk-cards-ready.
  // THE STRIPS' TAPS AND DOTS, delegated: one listener for every strip, wherever its HTML lands (a card's shadow
  // root too: composedPath). Capture, so the tap is stopped before the card underneath sees it. A scroll event
  // doesn't leave its shadow root, so the dots follow the gestures that scroll the strip instead.
  var within = function (ev, attr) {
    var path = ev.composedPath ? ev.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].hasAttribute && path[i].hasAttribute(attr)) return path[i];
    }
    return null;
  };
  if (typeof document !== 'undefined' && document.addEventListener && !window.__hkTimersDelegated) {
    window.__hkTimersDelegated = true;
    document.addEventListener('click', function (ev) {
      var b = within(ev, 'data-hk-timer');
      if (!b) return;
      ev.stopPropagation();
      ev.preventDefault();
      window.hkTimers.act(b.getAttribute('data-hk-timer'), b.getAttribute('data-hk-timer-act'));
    }, true);
    var follow = function (ev) {
      var sc = within(ev, 'data-hk-timer-dots');
      if (!sc) return;
      setTimeout(function () { window.hkTimers.dots(sc); }, 120);
      setTimeout(function () { window.hkTimers.dots(sc); }, 450);   // after the snap settles
    };
    ['touchend', 'pointerup', 'wheel'].forEach(function (t) {
      document.addEventListener(t, follow, { capture: true, passive: true });
    });
  }
  try {
    window.dispatchEvent(new Event('hk-timers-ready'));
    window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkTimers' }));
  } catch (e) { /* pre-Event environments: the cards poll their signature */ }
})();
