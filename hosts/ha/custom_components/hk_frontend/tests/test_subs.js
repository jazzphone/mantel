// hk-stats subscriber lifecycle: a card that goes away says so.
//
// WHY RELEASE. Reactive cleanup alone -- notify() pruning whatever set it
// happens to walk when a response resolves, and a high-water sweep bounding a
// set once it grows past 32 -- is bounded and not wrong, but nothing at all
// happens until the NEXT response: up to fifteen minutes for a daily chart,
// and never for a card nobody asks about again. A wall tablet re-creates
// every card on every view change.
//
// So HkBase.disconnectedCallback calls release(). These pin that it is exact
// (only this card, only its own sets), idempotent, and that the reactive
// pruning still works as a backstop for a card that never disconnects.
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

globalThis.window = globalThis;
globalThis.console = { warn: function () {}, error: function () {}, info: function () {}, log: function () {} };
load(root + '/frontend/modules/hk-stats.js');
var S = window.hkStats;

// The batch flush is a real setTimeout(BATCH_MS), so waiting for it needs
// real time rather than microtask turns -- same as tests/test_stats.js.
function after(ms, fn) { setTimeout(fn, ms); }

// A card as far as hk-stats is concerned: connected, and wakeable.
function fakeCard() {
  return { isConnected: true, woke: 0, requestUpdate: function () { this.woke++; } };
}
// A connection whose response the test lands by hand.
function makeHass() {
  var resolvers = [], calls = [];
  return {
    calls: calls,
    config: { time_zone: 'America/New_York' },
    callWS: function (m) { calls.push(m);
      return new Promise(function (res) { resolvers.push(res); }); },
    settle: function (i, d) { resolvers[i](d || {}); }
  };
}
// How many subscriber sets currently hold this card, across the whole module.
// EACH BLOCK USES ITS OWN BUCKET COUNT. The module's cache/pending maps are
// global and keyed by period|count|type, so two blocks that both ask for 7
// days land in ONE pending job -- the second block then finds the first
// block's timer already armed and its own flush never happens. Distinct counts
// keep the blocks independent.
function subCount(card) {
  var d = S.dump(), n = 0;
  d.pending.forEach(function (job) { if (job.cards.has(card)) n++; });
  d.inFlight.forEach(function (flights) {
    flights.forEach(function (f) { if (f.cards.has(card)) n++; });
  });
  return n;
}

// --- a detached card is gone WITHOUT waiting for a fetch ------------------
(function () {
  var hass = makeHass(), a = fakeCard(), b = fakeCard();
  S.daily(hass, 'sensor.a', 7, a);
  S.daily(hass, 'sensor.a', 7, b);
  check('both cards are subscribed while pending', subCount(a) === 1 && subCount(b) === 1);

  // The card goes away. No response has landed, and none is coming yet.
  // release() SAYS SO: HkBase redraws a card on re-attach only when it was
  // released while still waiting, which is what un-sticks a chart that was
  // moved mid-fetch (an Energy chart stuck on "Loading").
  var waiting = S.release(a);
  check('release removes the detached card immediately', subCount(a) === 0);
  check('release reports that the card was still waiting', waiting === true);
  check('release leaves the OTHER card alone', subCount(b) === 1);

  check('releasing twice is harmless', (S.release(a), subCount(a) === 0));
  check('...and the second release reports nothing was waiting', S.release(a) === false);
  check('releasing a card that never subscribed is harmless, and reports false',
        S.release(fakeCard()) === false);
})();

// --- a response landing after disconnection must not notify or retain -----
// THE ACCEPTANCE CRITERION THAT MATTERS MOST: the card is detached mid-flight,
// and the answer arrives afterwards.
var late = (function () {
  var hass = makeHass(), a = fakeCard(), b = fakeCard();
  S.daily(hass, 'sensor.late', 11, a);
  S.daily(hass, 'sensor.late', 11, b);
  return function (done) {
    after(80, function () {
      check('the two asks batched into one call', hass.calls.length === 1);
      S.release(a);
      hass.settle(0, { 'sensor.late': [] });
      after(20, function () {
        check('a response after release does not wake the released card', a.woke === 0);
        check('a connected waiter is still notified', b.woke > 0);
        check('the released card is retained nowhere', subCount(a) === 0);
        done();
      });
    });
  };
})();

// --- re-attaching subscribes ONCE ----------------------------------------
(function () {
  var hass = makeHass(), a = fakeCard();
  S.daily(hass, 'sensor.again', 3, a);
  S.release(a);
  S.daily(hass, 'sensor.again', 3, a);
  S.daily(hass, 'sensor.again', 3, a);
  S.daily(hass, 'sensor.again', 3, a);
  check('a re-attached card counts once however often it renders',
        subCount(a) === 1);
})();

// --- rapid route changes stay bounded ------------------------------------
// A wall tablet re-creates every card on every view change. A hundred of
// those with no disposal is what the high-water backstop bounds; with
// disposal there is simply nothing left behind.
(function () {
  var hass = makeHass(), live = fakeCard();
  S.daily(hass, 'sensor.churn', 5, live);
  for (var i = 0; i < 100; i++) {
    var c = fakeCard();
    S.daily(hass, 'sensor.churn', 5, c);
    c.isConnected = false;
    S.release(c);
  }
  var d = S.dump(), size = 0;
  d.pending.forEach(function (job) { if (job.ids.has('sensor.churn')) size = job.cards.size; });
  d.inFlight.forEach(function (fl) { fl.forEach(function (f) {
    if (f.ids.has('sensor.churn')) size = Math.max(size, f.cards.size); }); });
  check('a hundred create/destroy cycles leave one subscriber (' + size + ')',
        size === 1);
  check('the surviving subscriber is the connected one', subCount(live) === 1);
})();

// --- THE BACKSTOP STILL WORKS --------------------------------------------
// A card replaced wholesale never runs disconnectedCallback, so release() is
// never called for it. The high-water sweep is what still catches those, so
// it stays.
(function () {
  var hass = makeHass();
  for (var i = 0; i < 40; i++) {
    var c = fakeCard();
    S.daily(hass, 'sensor.backstop', 9, c);
    c.isConnected = false;          // vanished without telling anyone
  }
  var size = 0;
  S.dump().pending.forEach(function (job) {
    if (job.ids.has('sensor.backstop')) size = job.cards.size;
  });
  S.dump().inFlight.forEach(function (fl) { fl.forEach(function (f) {
    if (f.ids.has('sensor.backstop')) size = Math.max(size, f.cards.size); }); });
  check('the high-water sweep still bounds cards that never disconnect ('
        + size + ' <= 32)', size > 0 && size <= 32);
})();

// --- the same card in TWO different sets ---------------------------------
// A card can watch a daily chart and an hourly one. Release must clear both
// and must not touch a set it was never in.
(function () {
  var hass = makeHass(), a = fakeCard(), b = fakeCard();
  S.daily(hass, 'sensor.two', 13, a);
  S.hourly(hass, 'sensor.two', 14, a);
  S.hourly(hass, 'sensor.two', 14, b);
  check('a card in two sets is counted twice', subCount(a) === 2);
  S.release(a);
  check('release clears every set the card joined', subCount(a) === 0);
  check('the other card keeps its own subscription', subCount(b) === 1);
})();

late(function () {
  print(fail ? 'FAIL ' + fail + ' SUBSCRIBER TESTS'
             : 'ALL ' + pass + ' SUBSCRIBER TESTS PASS');
});
