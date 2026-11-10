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
//                        scrolls sideways, a touch-action of none or pan-y):
//                        true when an element of `path`
//                        (an event's composedPath, up to `stop`) is one -- a
//                        swipe that starts there is its, never the page's
//                        (the page swipe) nor the views' (Home Grid)
//   LET GO, THE SAME PHYSICS (2026-11-04, measured: a finger let go at 0.5 px/ms
//   and the page went off at 9, on one fixed curve, whatever the finger had
//   been doing; docs/development/Motion.md):
//   speed(pts, up)       px/ms over the last 100 ms of [t, x] moves, since the
//                        finger last turned; none if it rested before lifting at `up`
//   lands(dx, width, v, o)  past o.turn of the width (a fifth), or flicked that
//                        way over o.flick px/ms (.5) past o.min px (30) -- and
//                        flicked back, it goes back, however far it had gone
//   spring(x, x1, v)     from x at v px/ms to x1: { ms, at(t), speed(t), w, ... }
//   easing(s, full)      that spring as a CSS curve: linear() (full), or a
//                        cubic-bezier that leaves at the same speed
//   curve(x, x1, v)      { spring, ms, ease } for a transition from x to x1, on
//                        what this browser has
//   glide(x, x1, v, draw, done)  the same spring by requestAnimationFrame, for
//                        what a transition can't move (a scroller's scrollLeft);
//                        returns its stop()
//
// Every timer is read at call time (the tests drive their own).
// @ts-check
(function (global) {
  'use strict';
  if (global.hkDrag) return;

  var HOLD_MS = 350;               // a finger held this long on a thing picks it up
  var SLOP_TOUCH = 8, SLOP_MOUSE = 5;
  var AXIS = 1.2;                  // "along the axis": more than 1.2 times the other way

  // ------------------------------------------------------------ let go
  // THE SPRING: per ms; the fastest it takes up from a finger, px/ms
  var OMEGA = 0.028, V_MAX = 8, FLICK_WINDOW = 100, REST = 60;
  // (the last FLICK_WINDOW ms of the finger's [t, x] moves, from the move at or just past the window's start: a busy
  // tablet hands moves over far apart, and one alone in the window measured nothing. The lift -- `up`, its time -- is no
  // sample: it comes where the last move was, and counted, it slowed every quick flick under FLICK; a finger that
  // rested REST ms before it lifted flicked nothing. Only since it last turned: a flick back isn't averaged with the way
  // it came.)
  function speed(pts, up) {
    if (!pts || pts.length < 2) return 0;
    var last = pts[pts.length - 1], first = last, way = 0;
    if (up != null && up - last[0] > REST) return 0;
    for (var i = pts.length - 2; i >= 0; i--) {
      var step = first[1] - pts[i][1];
      if (way && step && (step < 0) !== (way < 0)) break;
      if (step) way = step;
      first = pts[i];
      if (last[0] - first[0] >= FLICK_WINDOW) break;
    }
    var dt = last[0] - first[0];
    return dt > 0 ? (last[1] - first[1]) / dt : 0;
  }
  function lands(dx, width, v, o) {
    o = o || {};
    if (!dx) return false;
    var flick = o.flick || 0.5, min = o.min === undefined ? 30 : o.min, turn = o.turn || 0.2;
    if (Math.abs(v || 0) > flick) {
      if ((v < 0) !== (dx < 0)) return false;
      if (Math.abs(dx) > min) return true;
    }
    return Math.abs(dx) > width * turn;
  }
  // Critically damped, third order: at 0 its speed is v, whatever that is, and it isn't yet being pulled, so there is no
  // kick in the frame after the lift (a second-order spring went from a finger's 0.5 px/ms to 5 in that frame, measured,
  // 2026-11-04). A page's width settles to the eye in about .33 s, as DUR.standard did. It never passes x1: a flick that
  // would is taken up by a stiffer spring (faster, not further).
  function spring(x, x1, v) {
    var a = x - x1, w = OMEGA;
    v = Math.max(-V_MAX, Math.min(V_MAX, v || 0));
    if (a && v * a < 0) w = Math.max(w, 2 * Math.abs(v / a));
    var b = v + w * a, c = w * b - w * w * a / 2;
    var at = function (t) { return x1 + (a + (b + c * t) * t) * Math.exp(-w * t); };
    var sp = function (t) { return (b + 2 * c * t - w * (a + (b + c * t) * t)) * Math.exp(-w * t); };
    var ms = 0;
    while (ms < 1200 && (Math.abs(at(ms) - x1) > 0.4 || Math.abs(sp(ms)) > 0.02)) ms += 8;
    return { x: x, x1: x1, v: v, w: w, ms: ms, at: at, speed: sp };
  }
  function easing(s, full) {
    var d = s.x1 - s.x;
    if (!d || !s.ms) return 'linear';
    if (full) {
      var n = Math.max(8, Math.min(40, Math.ceil(s.ms / 14))), pts = [];
      for (var i = 0; i <= n; i++) pts.push(i === n ? 1 : +((s.at(s.ms * i / n) - s.x) / d).toFixed(4));
      return 'linear(' + pts.join(',') + ')';
    }
    var slope = s.v * s.ms / d, x1 = 0.22;
    return 'cubic-bezier(' + x1 + ',' + Math.max(0, Math.min(1.4, slope * x1)).toFixed(3) + ',.18,1)';
  }
  // (linear(): Safari 17.2, Chrome 113)
  var LINEAR = null;
  function linearOk() {
    if (LINEAR === null) {
      try { LINEAR = !!(global.CSS && global.CSS.supports && global.CSS.supports('transition-timing-function', 'linear(0, 1)')); } catch (e) { LINEAR = false; }
    }
    return LINEAR;
  }
  function curve(x, x1, v) {
    var s = spring(x, x1, v), full = linearOk();
    return { spring: s, ms: full || !s.ms ? s.ms : Math.max(s.ms, 280), ease: easing(s, full) };
  }
  function glide(x, x1, v, draw, done) {
    var s = spring(x, x1, v), t0 = 0, raf = 0, stopped = false;
    var step = function (t) {
      if (stopped) return;
      if (!t0) t0 = t;
      var e = t - t0;
      if (e >= s.ms) { draw(x1); moEnd(); if (done) done(); return; }
      draw(s.at(e));
      raf = global.requestAnimationFrame(step);
    };
    raf = global.requestAnimationFrame(step);
    return function () { stopped = true; if (global.cancelAnimationFrame) global.cancelAnimationFrame(raf); };
  }

  // A HOME GRID'S VIEWS, FOLLOWING A FINGER (hk-layout.js _swipeViews; here since 2026-11-04, that file may not grow).
  // `grid`: the hk-home-grid-view. Its own rules are in its comment; returned, one handler per event.
  // (--drag, each view's own cell: on the grid itself it reaches everything inside every block, and each move would restyle
  // them all; null: taken away, they go to their places)
  function dragTo(grid, off) {
    var cells = grid._root ? grid._root.querySelectorAll('.cell[data-view]') : [];
    for (var i = 0; i < cells.length; i++) {
      if (off === null) cells[i].style.removeProperty('--drag');
      else cells[i].style.setProperty('--drag', off.toFixed(1) + 'px');
    }
  }
  function viewW(grid) {
    var w = 0;
    try { w = parseFloat(getComputedStyle(grid._root).getPropertyValue('--g-w')); } catch (e) { w = 0; }
    return w || grid._root.offsetWidth || 1;
  }
  // where the first view's cell is drawn now, against where it rests (a slide under way)
  function drawnOff(grid) {
    var c = grid._root.querySelector('.cell[data-view]');
    if (!c) return 0;
    try {
      var m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      return m.m41 - ((parseFloat(c.style.getPropertyValue('--v')) || 0) - (grid._view || 0)) * viewW(grid);
    } catch (e) { return 0; }
  }
  function viewSwipe(grid) {
    var d = null;
    return {
      pointerdown: function (e) {
        if (grid._views() < 2 || (e.button !== undefined && e.button !== 0) || sideways(e.composedPath ? e.composedPath() : [], grid)) return;
        d = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, pts: [[e.timeStamp || Date.now(), e.clientX]], from: 0 };
      },
      pointermove: function (e) {
        if (!d || e.pointerId !== d.id) return;
        var dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.on) {
          if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) { if (Math.abs(dy) > 14) d = null; return; }
          // PAST THE END, ON TO THE NEXT PAGE: the page swipe takes it from here
          var end = dx < 0 ? (grid._view || 0) >= grid._views() - 1 : (grid._view || 0) <= 0;
          var PS = global.hkPageSwipe;
          if (end && PS && PS.takes && PS.takes(dx < 0 ? 1 : -1, grid)) {
            d = null;
            grid.dispatchEvent(new CustomEvent('hk-swipe-past', { bubbles: true, composed: true,
              detail: { dir: dx < 0 ? 1 : -1, dx: dx, dy: dy, x: e.clientX, y: e.clientY, pointerId: e.pointerId,
                        pointerType: e.pointerType, target: e.composedPath ? e.composedPath()[0] : e.target } }));
            return;
          }
          d.on = true;
          moBegin('view');
          // (from here, not with a jump by the 10 px it waited; and a view still sliding is caught where it is)
          d.x += dx < 0 ? -10 : 10;
          d.from = grid._sliding ? drawnOff(grid) : 0;
          try { grid.setPointerCapture(e.pointerId); } catch (x) { /* a test page */ }
          grid._root.classList.add('dragging');
          grid._root.style.removeProperty('--view-ms');
          grid._root.style.removeProperty('--view-ease');
          dx = e.clientX - d.x;
        }
        d.pts.push([e.timeStamp || Date.now(), e.clientX]);
        if (d.pts.length > 30) d.pts.splice(0, d.pts.length - 30);
        var k = grid._gridScale || 1, n = grid._views(), at = grid._view || 0;
        var off = d.from + dx / k;
        // (past the first or the last: a third of the finger's travel)
        if ((at === 0 && off > 0) || (at === n - 1 && off < 0)) off /= 3;
        d.off = off;
        dragTo(grid, off);
      },
      pointerup: function (e) { end(e); },
      pointercancel: function (e) { end(e); },
      // the tap a swipe ends with is no tap on the block under it
      click: function (e) {
        if (grid._eatClick && Date.now() - grid._eatClick < 350) { e.stopPropagation(); e.preventDefault(); }
        grid._eatClick = 0;
      }
    };
    function end(e) {
      if (!d || e.pointerId !== d.id) return;
      var was = d;
      d = null;
      if (!was.on) return;
      var root = grid._root, k = grid._gridScale || 1, w = root.offsetWidth || 1;
      if (was.pts[was.pts.length - 1][1] !== e.clientX) was.pts.push([e.timeStamp || Date.now(), e.clientX]);
      var v = speed(was.pts, e.timeStamp || Date.now()) / k, off = was.off || 0, n = grid._views(), at = grid._view || 0;
      var dir = off < 0 ? 1 : -1, there = at + dir >= 0 && at + dir < n;
      var goes = e.type === 'pointerup' && there && lands(off * k, w * k, v * k);
      // LET GO: from where it is, at the speed it was going, to the view it lands on or back
      var c = curve(off, goes ? -dir * viewW(grid) : 0, there ? v : v / 3);
      root.style.setProperty('--view-ms', c.ms + 'ms');
      root.style.setProperty('--view-ease', c.ease);
      root.classList.remove('dragging');
      dragTo(grid, null);
      grid._slideMs = c.ms;
      if (goes) grid._showView(at + dir);
      else if (Math.abs(off) > 0.5) grid._slideFor(c.ms);
      grid._slideMs = 0;
      grid._eatClick = Date.now();
      setTimeout(moEnd, c.ms);
    }
  }

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
  function style(n) {
    try { return typeof getComputedStyle === 'function' ? getComputedStyle(n) : null; } catch (e) { return null; }
  }
  function scrollsSideways(n, cs) {
    if (!(n.scrollWidth > n.clientWidth + 1)) return false;
    var ox = cs ? cs.overflowX : '';
    return ox === 'auto' || ox === 'scroll';
  }
  // ...and anything that says it takes a sideways drag itself (2026-11-01,
  // the owner: "horizontal sliders like volume, cause the swipe page to
  // trigger"): touch-action `none` (the Music page's volume, the radar's map)
  // or `pan-y` (a chart scrubbed by the finger, the thermostat's dial), as
  // the Home Grid's pager reads it (hk-layout.js pagerControl) -- but not
  // `pan-y` on what scrolls up and down (a list's sideways swipe is the
  // page's), nor on a pager's own parts, nor a row that fits (hkCards.fitPan
  // says `pan-y pinch-zoom`: the page's)
  function claimsSideways(n, cs) {
    var t = cs ? cs.touchAction : '';
    if (t === 'none') return true;
    if (t !== 'pan-y' || n.hasAttribute('data-pager-part')) return false;
    return !(cs.overflowY === 'auto' || cs.overflowY === 'scroll');
  }
  // A ROW THAT KEEPS IT ONLY BECAUSE IT SCROLLS (nothing else on the way in: no control, no pager): the row, else null.
  // At an end it pans only the way it still can (panRow), so the page swipe asks rowTakes at the first move.
  function sidewaysRow(path, stop) {
    var list = path || [];
    for (var i = 0; i < list.length && list[i] !== stop; i++) {
      var n = list[i];
      if (!n || n.nodeType !== 1 || !n.matches) continue;
      if (n.localName === 'hk-pager-card') { if ((n._pages || []).length > 1) return null; continue; }
      if (n.matches(SIDEWAYS)) return null;
      var cs = style(n);
      if (claimsSideways(n, cs)) return null;
      if (scrollsSideways(n, cs)) return /pan-(left|right)/.test(n.style.touchAction || '') ? n : null;
    }
    return null;
  }
  // can row `n` still scroll the way a finger moving dx goes (left: toward its end)?
  function rowTakes(n, dx) {
    var max = n.scrollWidth - n.clientWidth, x = Math.abs(n.scrollLeft);
    return dx < 0 ? x < max - 1 : x > 1;
  }
  // A ROW'S TOUCH-ACTION (hkCards.fitPan, measured in a frame): one that fits takes no sideways pan (the page's), one
  // that scrolls only the pan it can still make at an end (2026-11-08, the owner: on the Music page "the discovery
  // section doesn't allow the page switch"): at its start pan-right (a finger going left), at its end pan-left, in
  // between both -- so a swipe the way it cannot go is the page's (sidewaysRow). Kept as it scrolls. Set ahead: the
  // browser reads it as the finger comes down (set in the pointerdown it was already too late, measured). WebKit has
  // no pan-left / pan-right: there a row keeps every pan.
  var EDGE_PAN = (function () {
    try { return !!(window.CSS && CSS.supports && CSS.supports('touch-action', 'pan-y pan-right')); } catch (e) { return false; }
  })();
  function panOf(el, max) {
    if (max <= 1) return 'pan-y pinch-zoom';
    if (!EDGE_PAN || el.__hkRtl) return '';
    var x = Math.abs(el.scrollLeft), back = x > 1, on = x < max - 1;
    return back && on ? '' : on ? 'pan-y pan-right pinch-zoom' : back ? 'pan-y pan-left pinch-zoom' : '';
  }
  function setPan(el, ta) {
    if (!ta) { if (el.style.touchAction) el.style.removeProperty('touch-action'); }
    else if (el.style.touchAction !== ta) el.style.setProperty('touch-action', ta);
  }
  function panRow(el) {
    el.__hkPanMax = el.scrollWidth - el.clientWidth;
    if (EDGE_PAN && el.__hkPanMax > 1 && !el.__hkPanEdge) {
      el.__hkPanEdge = true;
      el.__hkRtl = (style(el) || {}).direction === 'rtl';
      // (its width as measured here, not on every scroll)
      el.addEventListener('scroll', function () { setPan(el, panOf(el, el.__hkPanMax)); }, { passive: true });
    }
    setPan(el, panOf(el, el.__hkPanMax));
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
      var cs = style(n);
      if (claimsSideways(n, cs) || scrollsSideways(n, cs)) return true;
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

  // HOW A SWIPE WENT, ON THIS DEVICE (2026-11-08). The swipe checks run on a
  // Mac, with its CPU slowed down; a wall tablet's trouble was its GPU, which
  // no slowed CPU shows, and the owner felt what no check caught. So each
  // swipe counts its own frames, from the moment it begins to the frame after
  // it lands: requestAnimationFrame runs at the pace the screen is drawn, and
  // a frame more than LATE_MS after the last one missed a refresh. Nothing
  // runs between swipes. page-health.js (Mantel's page) tells Mantel once a
  // minute what was counted (a `motion` frame), so the log says, per tablet,
  // how its swipes went.
  //   motion.begin(kind)  something starts moving with a finger ('page' a
  //                       page swipe, 'view' Home Grid's views, 'block' a
  //                       block's pages); again while it runs: the same run
  //   motion.end()        it has landed: counted to the next frame (a
  //                       glide's end says it itself)
  //   motion.take()       { swipes, frames, ms, late, worst, p95, kinds } since
  //                       the last take, or null for none
  var LATE_MS = 25, RUN_MAX_MS = 8000, GAPS_MAX = 2000;
  var mo = { run: null, acc: null };
  function moNow() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function moBegin(kind) {
    if (typeof requestAnimationFrame !== 'function') return;
    var r = mo.run;
    if (r) { r.ending = false; return; }
    r = mo.run = { kind: kind || 'page', t0: moNow(), last: 0, frames: 0, late: 0, worst: 0, gaps: [], ending: false };
    var tick = function (t) {
      if (mo.run !== r) return;
      if (r.last) {
        var gap = t - r.last;
        r.frames++;
        r.gaps.push(gap);
        if (gap > LATE_MS) r.late++;
        if (gap > r.worst) r.worst = gap;
      }
      r.last = t;
      if (r.ending || t - r.t0 > RUN_MAX_MS) { moDone(r); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function moEnd() { if (mo.run) mo.run.ending = true; }
  function moDone(r) {
    mo.run = null;
    if (!r.frames) return;
    var a = mo.acc || (mo.acc = { swipes: 0, frames: 0, ms: 0, late: 0, worst: 0, gaps: [], kinds: {} });
    a.swipes++;
    a.frames += r.frames;
    a.ms += r.gaps.reduce(function (s, g) { return s + g; }, 0);
    a.late += r.late;
    a.worst = Math.max(a.worst, r.worst);
    a.kinds[r.kind] = (a.kinds[r.kind] || 0) + 1;
    if (a.gaps.length < GAPS_MAX) a.gaps = a.gaps.concat(r.gaps.slice(0, GAPS_MAX - a.gaps.length));
  }
  function moTake() {
    var a = mo.acc;
    mo.acc = null;
    if (!a || !a.frames) return null;
    var g = a.gaps.slice().sort(function (x, y) { return x - y; });
    return { swipes: a.swipes, frames: a.frames, ms: Math.round(a.ms), late: a.late, worst: Math.round(a.worst),
             p95: Math.round(g[Math.min(g.length - 1, Math.floor(g.length * 0.95))] || 0), kinds: a.kinds };
  }

  // A SIDEWAYS SLIDER IN A LIST THAT SCROLLS (2026-11-10, the owner: "it's real easy to catch a volume slider" scrolling a
  // Volume tab): a finger is the slider's only once it has gone sideways -- SLOP_TOUCH first, more across than down
  // (classify, axis x); down, it was the list's, and the slider never moved. A mouse takes it at once. The element wears
  // touch-action:pan-y (the browser scrolls the list, and says pointercancel) and data-hk-control (the page swipe leaves
  // it be). h: target(e) -> the slider under the press or null, start(t, x), move(t, x), end(t, cancelled).
  // (hk-control.js wireSlider is the same rule, for an <input type=range>.)
  function slider(el, h) {
    var g = null;
    el.addEventListener('pointerdown', function (e) {
      var t = h.target ? h.target(e) : el;
      if (!t || e.isPrimary === false) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: t, live: e.pointerType === 'mouse' };
      if (g.live) { try { el.setPointerCapture(e.pointerId); } catch (x) { /* gone */ } h.start(t, e.clientX); }
    });
    el.addEventListener('pointermove', function (e) {
      if (!g || e.pointerId !== g.id) return;
      if (!g.live) {
        var k = classify(e.clientX - g.x, e.clientY - g.y, { axis: 'x' });
        if (k === 'press') return;
        if (k === 'scroll') { g = null; return; }
        g.live = true;
        try { el.setPointerCapture(e.pointerId); } catch (x) { /* gone */ }
        h.start(g.t, e.clientX);
      }
      h.move(g.t, e.clientX);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    var swallow = 0;
    var end = function (e) {
      if (!g || e.pointerId !== g.id) return;
      var was = g; g = null;
      if (was.live) { swallow = Date.now(); h.end(was.t, e.type === 'pointercancel'); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // a drag is not a tap on what it ended over (the Side Pane's player opened under a mouse let go on its volume)
    el.addEventListener('click', function (e) {
      if (swallow && Date.now() - swallow < 400) { swallow = 0; e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  global.hkDrag = { HOLD_MS: HOLD_MS, SLOP_TOUCH: SLOP_TOUCH, SLOP_MOUSE: SLOP_MOUSE,
                    motion: { begin: moBegin, end: moEnd, take: moTake },
                    press: press, holdStill: holdStill, slider: slider, ghost: ghost, classify: classify,
                    sideways: sideways, sidewaysRow: sidewaysRow, rowTakes: rowTakes, panRow: panRow, EDGE_PAN: EDGE_PAN, SIDEWAYS: SIDEWAYS,
                    speed: speed, lands: lands, spring: spring, easing: easing, curve: curve, glide: glide, viewSwipe: viewSwipe };
  // (a card wired before this file came in waits for it: window 'hk-drag')
  try { global.dispatchEvent(new Event('hk-drag')); } catch (e) { /* no events here */ }
})(typeof window !== 'undefined' ? window : globalThis);
