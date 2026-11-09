// hkTimers.userTimers -- which timers count for the Timer slide (phase 21, docs/phase21/TIMER-SLIDE.md), and the last-minute
// hold's deciding (hk-saver-helpers.js timerHold), with the shell's steps faked. The slide's look is
// tools/headless/timer_slide_check.py's.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/modules/hk-timers.js');
var pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (detail !== undefined ? '   ' + JSON.stringify(detail) : '')); }
}
var T = window.hkTimers, NOW = Date.parse('2026-11-08T18:00:00Z');
function iso(s) { return new Date(NOW + s * 1000).toISOString(); }
function on(s, name) { return { state: 'active', attributes: { finishes_at: iso(s), duration: '0:15:00', friendly_name: name } }; }
function ids(list) { return list.map(function (r) { return r.id; }).join(); }

var HOUSE = {
  'timer.quick_1': on(300, 'Quick Timer 1'), 'input_text.quick_timer_1_name': { state: 'Pasta', attributes: {} },
  'timer.quick_2': on(30, 'Quick Timer 2'), 'input_text.quick_timer_2_name': { state: 'unknown', attributes: {} },
  'timer.quick_3': { state: 'paused', attributes: { remaining: '0:05:00', duration: '0:10:00', friendly_name: 'Quick Timer 3' } },
  'timer.quick_4': { state: 'idle', attributes: { duration: '0:00:00' } },
  'timer.hk_timer_7': on(90, 'Oven'),
  'timer.kitchen_no_motion': on(5, 'Kitchen - No Motion'), 'timer.nap_timer': on(10, 'Nap'), 'light.kitchen': { state: 'on', attributes: {} }
};
var got = T.userTimers(HOUSE, [], NOW);
ok('only the timers people set: not an automation\'s, not an idle slot', ids(got) === 'timer.quick_2,timer.hk_timer_7,timer.quick_1,timer.quick_3');
ok('soonest first, paused last', got[0].left === 30 && got[1].left === 90 && got[2].left === 300 && got[3].paused === true && got[3].left === 300);
ok('a quick slot\'s name from its helper, else the timer\'s', got[2].name === 'Pasta' && got[0].name === 'Quick Timer 2' && got[1].name === 'Oven');
ok('its length, for the ring', got[0].total === 900 && got[3].total === 600);
ok('House Timers are ignored, even a quick slot on the list', ids(T.userTimers(HOUSE, ['timer.quick_2', 'timer.nap_timer'], NOW)) === 'timer.hk_timer_7,timer.quick_1,timer.quick_3');
ok('a running timer past its end reads 0 until the house says it ended', T.userTimers({ 'timer.quick_1': on(-5, 'x') }, [], NOW)[0].left === 0);
ok('a timer with no end time is left out, and nothing at all is nothing', T.userTimers({ 'timer.quick_1': { state: 'active', attributes: {} } }, [], NOW).length === 0 && T.userTimers(null, null, NOW).length === 0);
ok('a timer whose id only starts the same is not one', T.userTimers({ 'timer.quick_x': on(5, 'a'), 'timer.hk_timer_': on(5, 'b'), 'timer.quick_1_old': on(5, 'c') }, [], NOW).length === 0);

// ---- the hold
load(HK_ROOT + '/frontend/saver/hk-saver-helpers.js');
var K = {};
window.hkSaverParts['hk-saver-helpers'](K);
function world(left, opts) {
  var w = { log: [], t: 0, left: left, blocked: false, wanted: true, up: true, night: false, showOk: true };
  w.slot = { showing: false, ctl: { setClient: function () {}, setNight: function (n) { w.nightSet = n; } } };
  if (opts && opts.noCtl) w.slot.ctl = null;
  w.hold = K.timerHold({
    up: function () { return w.up; }, wanted: function () { return w.wanted; }, now: function () { return w.t; },
    client: function () { var s = {}; if (w.left !== null) s['timer.quick_1'] = { state: 'active', attributes: { finishes_at: new Date(Date.now() + w.left * 1000).toISOString(), duration: '1:00:00' } }; return { states: s }; },
    slot: w.slot, prep: function () { w.log.push('prep'); }, night: function () { return w.night; }, blocked: function () { return w.blocked; },
    show: function () { w.log.push('show'); if (w.showOk) w.slot.showing = true; return w.showOk; }, clear: function () { w.log.push('clear'); },
    hold: function () { w.log.push('hold'); }, again: function () { w.log.push('again'); },
    leave: function (ended) { w.log.push('leave:' + ended); w.slot.showing = false; }
  });
  w.go = function () { w.t += 2000; w.hold.watch(); };
  return w;
}
var a = world(600);
a.go();
ok('far off: nothing shows', a.log.join() === '' && !a.hold.held());
a.left = 45; a.go();
ok('in its last minute: everything makes way, then it shows and holds', a.log.join() === 'clear,show,hold' && a.hold.held());
a.log.length = 0; a.left = 44; a.night = true; a.go();
ok('...held: it isn\'t shown again, and follows Night Mode', a.log.length === 0 && a.nightSet === true);
a.left = null; a.go();
ok('it ended: let go, the timer gone', a.log.join() === 'leave:true' && !a.hold.held());
var b = world(40); b.blocked = true; b.go();
ok('under the black or a hidden page: not shown', b.log.length === 0 && !b.hold.held());
b.blocked = false; b.go();
ok('...and shown once that lifts', b.log.join() === 'clear,show,hold');
var c = world(40); c.showOk = false; c.go();
ok('it could not show: the turns carry on, not held', c.log.join() === 'clear,show,again' && !c.hold.held());
var d = world(40); d.wanted = false; d.go();
ok('Timers turned off: no last minute either', d.log.length === 0);
var e = world(600, { noCtl: true }); e.go(); e.go();
ok('its module asked for once, only once a timer runs', e.log.join() === 'prep');
var f = world(null, { noCtl: true }); f.go();
ok('no timer: its module is not even asked for', f.log.length === 0);
var g = world(45); g.go(); g.log.length = 0; g.left = 1000; g.go();
ok('given more time, out of the minute: let go, a timer still running', g.log.join() === 'leave:false' && !g.hold.held());
var h = world(null); h.slot.showing = true; h.go();
ok('its ordinary turn up with nothing left to count: it goes', h.log.join() === 'leave:true');
var i = world(45); i.up = false; i.go();
ok('a preview, or the saver down: nothing', i.log.length === 0);
[a, b, c, d, e, f, g, h, i].forEach(function (w) { w.hold.leave(); });
print('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' TIMER LIST TESTS PASS');
if (fail) throw new Error(fail + ' failed');
