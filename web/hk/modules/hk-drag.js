// hk-drag.js - PICKING A THING UP WITH A FINGER OR A MOUSE, shared by Home
// Grid's editor (its palette rows, panels/hk-grid-editor.js) and Edit mode
// (hk-edit.js). Taken out of the grid editor unchanged (2026-10-26).
//
// A FINGER SCROLLS (2026-10-24, the owner on an iPad: "it keeps thinking I
// want to move a card"): a finger that moves first is the page's to scroll,
// unless it moves along `axis` ('x' or 'y'; the palette's is 'x', towards the
// grid); a finger held HOLD_MS picks the thing up (iOS's home screen), and
// then it goes any way. A mouse picks it up on any 5 px drag. pointercancel
// is the browser taking the gesture to scroll. A press that did none of these
// is a tap.
//
//   press(el, pointerdown, { lift, tap, cancel, axis, hold, lifted })
//       lift(ev)    pick it up; true if it was (false: not now, the next
//                   move asks again)
//       tap(ev)     the press was a tap (pointerup, nothing else happened)
//       cancel(ev)  pointercancel (the browser scrolled)
//       axis        'x' | 'y' | null (only a hold picks up a finger's press)
//       hold        ms (HOLD_MS)
//       lifted      the class on `el` while carried, until pointerup or
//                   pointercancel ('lifted'; null: none)
//     returns { state() -> 'press' | 'drag' | 'scroll', stop() }, or null for
//     a button other than the main one.
//   holdStill(el, cls)   while `el` has `cls` ('lifted'), a finger moving on
//                        it does not scroll what it is in (touchmove, not
//                        passive)
//   ghost(parent, node)  `node` put in `parent` to follow the pointer, 14 px
//                        off: { node, move(ev), remove() }
//   classify(dx, dy, o)  press()'s own test, for a gesture followed some
//                        other way (the page swipe, hk-pageswipe.js): 'press'
//                        inside o.slop, 'drag' along o.axis by more than
//                        o.ratio (AXIS) times the other way -- any way with
//                        o.free (a mouse) -- else 'scroll'
//   sideways(path, stop) THE ONE LIST of what moves sideways itself (a block
//                        that swipes its pages, a slider, the thermostat's
//                        ring, a field, anything data-hk-control, a row that
//                        scrolls sideways): true when an element of `path`
//                        (an event's composedPath, up to `stop`) is one -- a
//                        swipe that starts there is its, never the page's
//                        (the page swipe) nor the views' (Home Grid)
//
// Every timer is read at call time (the tests drive their own).
(function (global) {
  'use strict';
  if (global.hkDrag) return;

  var HOLD_MS = 350;               // a finger held this long on a thing picks it up
  var SLOP_TOUCH = 8, SLOP_MOUSE = 5;
  var AXIS = 1.2;                  // "along the axis": more than 1.2 times the other way

  function classify(dx, dy, o) {
    o = o || {};
    if (Math.hypot(dx, dy) < (o.slop || SLOP_TOUCH)) return 'press';
    if (o.free) return 'drag';
    if (o.axis === 'x') return Math.abs(dx) > Math.abs(dy) * (o.ratio || AXIS) ? 'drag' : 'scroll';
    if (o.axis === 'y') return Math.abs(dy) > Math.abs(dx) * (o.ratio || AXIS) ? 'drag' : 'scroll';
    return 'scroll';
  }

  // WHAT MOVES SIDEWAYS ITSELF (2026-10-30, Swipe Between Pages): what Home
  // Grid's views already gave way to, and data-hk-control (a light held into
  // its dimmer, any control that drags) and an editable field. Every card
  // that adds a sideways control later carries data-hk-control.
  var SIDEWAYS = '[role="slider"],.ring,.vs,input,select,textarea,[contenteditable="true"],[data-hk-control]';
  function scrollsSideways(n) {
    if (!(n.scrollWidth > n.clientWidth + 1)) return false;
    var ox = '';
    try { ox = typeof getComputedStyle === 'function' ? getComputedStyle(n).overflowX : ''; } catch (e) { ox = ''; }
    return ox === 'auto' || ox === 'scroll';
  }
  function sideways(path, stop) {
    var list = path || [];
    for (var i = 0; i < list.length && list[i] !== stop; i++) {
      var n = list[i];
      if (!n || n.nodeType !== 1 || !n.matches) continue;
      // a block that swipes its own pages, when it has more than one
      if (n.localName === 'hk-pager-card') { if ((n._pages || []).length > 1) return true; continue; }
      if (n.matches(SIDEWAYS)) return true;
      // a row that really scrolls sideways (the scenes row, a camera strip):
      // the browser pans it
      if (scrollsSideways(n)) return true;
    }
    return false;
  }

  function press(el, e, o) {
    if (e.button !== 0) return null;
    o = o || {};
    var cls = o.lifted === undefined ? 'lifted' : o.lifted;
    var x0 = e.clientX, y0 = e.clientY, dragging = false, scrolling = false, last = e;
    var touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    try { el.setPointerCapture(e.pointerId); } catch (x) { /* a test page */ }
    var lift = function (ev) {
      dragging = !!(o.lift && o.lift(ev));
      if (!dragging) return;
      stop();
      if (!cls) return;
      el.classList.add(cls);
      var drop = function () { el.classList.remove(cls); el.removeEventListener('pointerup', drop); el.removeEventListener('pointercancel', drop); };
      el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
    };
    var hold = touch ? setTimeout(function () { if (!dragging && !scrolling) lift(last); }, o.hold || HOLD_MS) : null;
    var move = function (ev) {
      last = ev;
      if (dragging || scrolling) return;
      var k = classify(ev.clientX - x0, ev.clientY - y0, { slop: touch ? SLOP_TOUCH : SLOP_MOUSE, axis: o.axis, free: !touch });
      if (k === 'press') return;
      if (k === 'scroll') { scrolling = true; clearTimeout(hold); return; }
      lift(ev);
    };
    var stop = function () {
      clearTimeout(hold);
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
    };
    // the browser took the gesture to scroll: no tap, no drag
    var cancel = function (ev) { stop(); if (o.cancel) o.cancel(ev); };
    var up = function (ev) {
      stop();
      if (dragging || scrolling) return;
      if (o.tap) o.tap(ev);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel);
    return { state: function () { return dragging ? 'drag' : scrolling ? 'scroll' : 'press'; }, stop: stop };
  }

  // while a thing is carried, the list under it doesn't scroll
  function holdStill(el, cls) {
    var c = cls || 'lifted';
    el.addEventListener('touchmove', function (ev) { if (el.classList.contains(c)) ev.preventDefault(); }, { passive: false });
  }

  // a label that follows the pointer while a thing is carried
  function ghost(parent, node) {
    parent.appendChild(node);
    return {
      node: node,
      move: function (ev) { node.style.transform = 'translate(' + (ev.clientX + 14) + 'px,' + (ev.clientY + 14) + 'px)'; },
      remove: function () { node.remove(); }
    };
  }

  global.hkDrag = { HOLD_MS: HOLD_MS, SLOP_TOUCH: SLOP_TOUCH, SLOP_MOUSE: SLOP_MOUSE,
                    press: press, holdStill: holdStill, ghost: ghost, classify: classify,
                    sideways: sideways, SIDEWAYS: SIDEWAYS };
})(typeof window !== 'undefined' ? window : globalThis);
