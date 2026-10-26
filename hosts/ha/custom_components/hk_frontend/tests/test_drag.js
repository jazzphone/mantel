// THE SHARED PRESS CLASSIFIER (modules/hk-drag.js), taken out of Home Grid's
// editor (its palette rows) so Edit mode drags the same way: a finger held
// HOLD_MS picks a thing up, a finger that moves first scrolls (or, with an
// axis, picks up when it moves that way), a mouse picks up on a 5 px drag,
// pointercancel is the browser's scroll, and a press that did none of these
// is a tap. Also the "lifted" touchmove blocker and the floating ghost.
// Driven with manual timers and recorded events, like test_gridcards.js.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run drag');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
load(HK_ROOT + '/frontend/modules/hk-drag.js');

var ok = H.ok, eq = H.eq, D = window.hkDrag;

// an element that keeps its listeners, its classes and its captures
function thing() {
  var el = { on: {}, classes: {}, captured: [], style: {}, removed: 0 };
  el.addEventListener = function (t, f, o) { (el.on[t] = el.on[t] || []).push({ f: f, o: o }); };
  el.removeEventListener = function (t, f) { el.on[t] = (el.on[t] || []).filter(function (l) { return l.f !== f; }); };
  el.fire = function (t, ev) { (el.on[t] || []).slice().forEach(function (l) { l.f(ev); }); };
  el.count = function (t) { return (el.on[t] || []).length; };
  el.classList = { add: function (c) { el.classes[c] = 1; }, remove: function (c) { delete el.classes[c]; },
                   contains: function (c) { return !!el.classes[c]; } };
  el.setPointerCapture = function (id) { el.captured.push(id); };
  el.remove = function () { el.removed++; };
  return el;
}
function at(x, y, kind, more) { return Object.assign({ clientX: x, clientY: y, pointerType: kind || 'touch', pointerId: 7, button: 0 }, more || {}); }
// one press with every outcome recorded
function press(el, kind, o) {
  var log = [];
  var opts = Object.assign({
    lift: function (ev) { log.push(['lift', ev.clientX, ev.clientY]); return true; },
    tap: function () { log.push(['tap']); },
    cancel: function () { log.push(['cancel']); }
  }, o || {});
  var p = D.press(el, at(100, 100, kind), opts);
  return { log: log, p: p };
}

H.run('DRAG', [
function () {
  H.section('the numbers');
  eq('HOLD_MS: a finger held this long picks a thing up (the grid editor\'s 350)', D.HOLD_MS, 350);
  eq('slop: 8 px for a finger, 5 for a mouse', [D.SLOP_TOUCH, D.SLOP_MOUSE], [8, 5]);
},
function () {
  H.section('a finger held still: picked up at the hold');
  var el = thing(), t = H.timers(), r = press(el, 'touch');
  eq('captured, try-wrapped', el.captured, [7]);
  eq('a hold timer waits', H.timers(), t + 1);
  el.fire('pointermove', at(103, 104));                      // inside the slop: still a press
  eq('a wobble inside the slop is nothing yet', [r.log, r.p.state()], [[], 'press']);
  H.runTimers();
  eq('the hold picks it up, where the finger is now', r.log, [['lift', 103, 104]]);
  eq('...lifted: the class on, the press listeners gone', [el.classList.contains('lifted'), el.count('pointermove'), r.p.state()],
     [true, 0, 'drag']);
  el.fire('pointerup', at(150, 150));
  eq('let go: the class off, nothing called a tap', [el.classList.contains('lifted'), r.log.length], [false, 1]);
  eq('...and every listener given back', [el.count('pointerup'), el.count('pointercancel')], [0, 0]);
},
function () {
  H.section('a finger that moves first scrolls (no axis: only a hold picks up)');
  var el = thing(), r = press(el, 'touch'), t = H.timers();
  el.fire('pointermove', at(130, 100));                      // sideways, past the slop
  eq('a scroll, not a drag', [r.p.state(), r.log], ['scroll', []]);
  eq('...the hold timer cleared', H.timers(), t - 1);
  H.runTimers();
  el.fire('pointerup', at(130, 100));
  eq('...and lifting the finger is no tap', r.log, []);
},
function () {
  H.section('with an axis: moving that way picks up at once, the other way scrolls (the palette: sideways)');
  var el = thing(), r = press(el, 'touch', { axis: 'x' });
  el.fire('pointermove', at(120, 105));
  eq('sideways: picked up', [r.p.state(), r.log], ['drag', [['lift', 120, 105]]]);
  el.fire('pointerup', at(120, 105));
  el = thing(); r = press(el, 'touch', { axis: 'x' });
  el.fire('pointermove', at(108, 112));                      // |dx| 8 <= |dy| 12 * 1.2: the list's
  eq('up or down: the list scrolls', [r.p.state(), r.log], ['scroll', []]);
  el = thing(); r = press(el, 'touch', { axis: 'y' });
  el.fire('pointermove', at(102, 130));
  eq('axis y: down picks up', r.p.state(), 'drag');
  el = thing(); r = press(el, 'touch', { axis: 'y' });
  el.fire('pointermove', at(130, 102));
  eq('...and sideways scrolls', r.p.state(), 'scroll');
},
function () {
  H.section('a mouse: no hold, any 5 px drag picks up');
  var el = thing(), t = H.timers(), r = press(el, 'mouse');
  eq('no hold timer', H.timers(), t);
  el.fire('pointermove', at(103, 102, 'mouse'));
  eq('4 px: nothing', r.log, []);
  el.fire('pointermove', at(100, 106, 'mouse'));
  eq('up or down is fine for a mouse', r.log, [['lift', 100, 106]]);
},
function () {
  H.section('pointercancel: the browser took it to scroll -- no tap, no drag');
  var el = thing(), r = press(el, 'touch'), t = H.timers();
  el.fire('pointercancel', at(100, 100));
  eq('cancel called, nothing else', r.log, [['cancel']]);
  eq('...the hold cleared and the listeners gone', [H.timers(), el.count('pointermove'), el.count('pointerup')], [t - 1, 0, 0]);
},
function () {
  H.section('a tap: up without a move, a hold or a cancel');
  var el = thing(), r = press(el, 'touch'), t = H.timers();
  el.fire('pointerup', at(101, 101, 'touch', { target: 'the chip' }));
  eq('a tap, with its event', r.log, [['tap']]);
  eq('the hold cleared', H.timers(), t - 1);
  H.runTimers();
  eq('...so no late pick-up', r.log, [['tap']]);
},
function () {
  H.section('a pick-up refused (the editor busy) leaves the press going');
  var el = thing(), n = 0;
  var r = press(el, 'mouse', { lift: function () { n++; return n > 1; } });
  el.fire('pointermove', at(110, 100, 'mouse'));
  eq('refused once: still a press, listening', [r.p.state(), el.count('pointermove')], ['press', 1]);
  el.fire('pointermove', at(120, 100, 'mouse'));
  eq('...the next move asks again', [r.p.state(), n], ['drag', 2]);
  ok('a right button is no press', D.press(thing(), at(1, 1, 'mouse', { button: 2 }), {}) === null);
  el = thing(); r = press(el, 'touch', { lifted: null });
  H.runTimers();
  eq('lifted: null adds no class', Object.keys(el.classes), []);
},
function () {
  H.section('the lifted touchmove blocker and the ghost');
  var el = thing(), stopped = 0;
  D.holdStill(el);
  eq('one non-passive touchmove listener', [el.count('touchmove'), el.on.touchmove[0].o.passive], [1, false]);
  el.fire('touchmove', { preventDefault: function () { stopped++; } });
  eq('not lifted: the page scrolls', stopped, 0);
  el.classList.add('lifted');
  el.fire('touchmove', { preventDefault: function () { stopped++; } });
  eq('lifted: the list stays still under it', stopped, 1);
  var parent = { kids: [], appendChild: function (n) { this.kids.push(n); } }, label = thing();
  var g = D.ghost(parent, label);
  eq('the ghost is put in its parent', parent.kids, [label]);
  g.move(at(10, 20));
  eq('...follows the pointer, 14 px off', label.style.transform, 'translate(24px,34px)');
  g.remove();
  eq('...and goes', label.removed, 1);
}
]);
