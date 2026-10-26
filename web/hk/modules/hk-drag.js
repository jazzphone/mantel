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
//
// Every timer is read at call time (the tests drive their own).
(function (global) {
  'use strict';
  if (global.hkDrag) return;

  var HOLD_MS = 350;               // a finger held this long on a thing picks it up
  var SLOP_TOUCH = 8, SLOP_MOUSE = 5;
  var AXIS = 1.2;                  // "along the axis": more than 1.2 times the other way

  function along(axis, dx, dy) {
    if (axis === 'x') return Math.abs(dx) > Math.abs(dy) * AXIS;
    if (axis === 'y') return Math.abs(dy) > Math.abs(dx) * AXIS;
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
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (Math.hypot(dx, dy) < (touch ? SLOP_TOUCH : SLOP_MOUSE)) return;
      if (touch && !along(o.axis, dx, dy)) { scrolling = true; clearTimeout(hold); return; }
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
                    press: press, holdStill: holdStill, ghost: ghost };
})(typeof window !== 'undefined' ? window : globalThis);
