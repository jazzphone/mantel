// hk-stats: one request per equivalent in-flight operation.
//
// THE TRAP THIS PINS. flush() must delete the pending entry before it sends --
// otherwise the next batch accumulates into a job already on the wire. But the
// cache is not written until the response comes back, so for the whole round
// trip get() still sees those ids as missing. Every card rendering in that
// window would ask again, and each ask would send an identical duplicate.
//
// A view change or a MODULE WAKE renders many cards against one key at once,
// which is exactly that window. The history path guards this with
// histInFlight; statistics needs the same guard.
var root = HK_ROOT;
var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }

// A hass whose callWS never resolves on its own -- the test decides when the
// response lands, which is the only way to stand inside the flight.
function makeHass() {
  var calls = [], resolvers = [];
  return {
    calls: calls,
    callWS: function (msg) {
      calls.push(msg);
      return new Promise(function (res, rej) { resolvers.push({ res: res, rej: rej }); });
    },
    settle: function (i, data) { resolvers[i].res(data || {}); },
    reject: function (i, err) { resolvers[i].rej(err || new Error('nope')); }
  };
}
function tick(n) {          // let queued microtasks and the batch timer run
  var p = Promise.resolve();
  for (var i = 0; i < (n || 3); i++) p = p.then(function () {});
  return p;
}

globalThis.window = globalThis;
globalThis.console = { warn: function () {}, error: function () {}, info: function () {} };
load(root + '/frontend/modules/hk-stats.js');
var S = window.hkStats;
var IDS = ['sensor.a', 'sensor.b'];

var hass = makeHass();
// First ask: nothing cached, so this batches and sends after BATCH_MS.
S.daily(hass, IDS, 7, { isConnected: true, requestUpdate: function () {} });

setTimeout(function () {
  check('one request went out for the first ask', hass.calls.length === 1);

  // STANDING INSIDE THE FLIGHT: three more cards ask for the same ids while
  // the socket has not answered. Without the guard each would send its own.
  var extra = [];
  for (var i = 0; i < 3; i++) {
    var c = { n: i, isConnected: true, requestUpdate: function () { extra.push(this.n); } };
    S.daily(hass, IDS, 7, c);
  }

  setTimeout(function () {
    check('no duplicate request while one is in flight', hass.calls.length === 1);

    // A PARTIALLY overlapping ask still fetches only what is missing.
    S.daily(hass, ['sensor.a', 'sensor.c'], 7, { isConnected: true, requestUpdate: function () {} });
    setTimeout(function () {
      check('an overlapping ask requests only the new id',
            hass.calls.length === 2 &&
            hass.calls[1].statistic_ids.length === 1 &&
            hass.calls[1].statistic_ids[0] === 'sensor.c');
      check('the id already in flight was not re-requested',
            hass.calls[1].statistic_ids.indexOf('sensor.a') === -1);

      // Ask for A once more while A/B and C are BOTH in flight. A one-slot
      // implementation forgets the A/B flight as soon as C is sent and issues
      // a third request here.
      S.daily(hass, ['sensor.a'], 7,
        { isConnected: true, requestUpdate: function () {} });
      setTimeout(function () {
        check('a second flight does not hide the first one', hass.calls.length === 2);

        // Resolve C first. Its completion must release only C, leaving the A/B
        // ownership intact until that older response lands.
        hass.settle(1, { 'sensor.c': [] });
        tick(6).then(function () {
          check('out-of-order completion leaves the older flight claimed',
                S.dump().inFlight.size === 1);

          // Now the first response lands. Everyone waiting on it is notified,
          // including the cards that attached mid-flight.
          hass.settle(0, { 'sensor.a': [], 'sensor.b': [] });
          return tick(6);
        }).then(function () {
          check('cards that joined mid-flight were notified', extra.length === 3);
          check('all settled flights are released', S.dump().inFlight.size === 0);

          // Once the flights are over a genuinely new ask is allowed again.
          var h2 = makeHass();
          S.daily(h2, ['sensor.z'], 7, null);
          setTimeout(function () {
            check('a new id after the flight still requests', h2.calls.length === 1);

            // A REJECTION must also release the flight, or the key is wedged
            // forever and the chart never retries.
            h2.settle(0, { 'sensor.z': [] });
            var h3 = makeHass();
            S.daily(h3, ['sensor.err'], 9, null);
            setTimeout(function () {
              h3.reject(0, new Error('boom'));
              tick(6).then(function () {
                check('a failed request releases its flight', S.dump().inFlight.size === 0);
                rollTest(function () {
                  print(fail ? 'FAIL ' + fail + ' STATS TESTS' : 'ALL ' + pass + ' STATS TESTS PASS');
                });
              });
            }, 40);
          }, 40);
        });
      }, 40);
    }, 40);
  }, 40);
}, 40);

// A NEW BUCKET DOES NOT BLANK THE CHART. The key carries the bucket edge, so
// at every hour (and every 5 minutes for the live lines) a card's answer is
// under a new key. Until that answer lands, the same shape's answer from the
// bucket before stands in -- the Energy page used to flash "Loading..." once
// an hour and drop its live lines every five minutes.
function rollTest(done) {
  var realNow = Date.now, T = Date.UTC(2026, 9, 13, 15, 30, 0);
  Date.now = function () { return T; };
  var h = makeHass();
  check('roll: the first ask waits for its answer', S.hourly(h, ['sensor.r'], 24, null) === null);
  setTimeout(function () {
    h.settle(0, { 'sensor.r': [] });
    tick(6).then(function () {
      check('roll: answered', S.hourly(h, ['sensor.r'], 24, null) !== null);
      var firstReceipt = S.freshness(S.hourly(h, ['sensor.r'], 24, null));
      check('freshness: actual successful receipt time', firstReceipt === T);
      check('freshness: unknown arrays have no invented receipt', S.freshness({unknown:[]}) === null);
      T += 3600000;
      check('roll: the next hour draws the last hour\'s answer while it asks', S.hourly(h, ['sensor.r'], 24, null) !== null);
      check('freshness: bucket stand-in retains original receipt', S.freshness(S.hourly(h, ['sensor.r'], 24, null)) === firstReceipt);
      check('roll: a different shape gets no stand-in', S.hourly(h, ['sensor.r'], 12, null) === null);
      setTimeout(function () {
        check('roll: the new hour was asked for', h.calls.length >= 2 && h.calls[1].period === 'hour');
        h.settle(1, { 'sensor.r': [] });
        if (h.calls[2]) h.settle(2, { 'sensor.r': [] });
        tick(6).then(function () {
          S.hourly(h, ['sensor.r'], 24, null);
          var keys = []; S.dump().cache.forEach(function (_v, k) { if (/^hour\|24\|/.test(k)) keys.push(k); });
          check('roll: once the new answer is in, the old hour is evicted', keys.length === 1);
          check('freshness: newly fetched series advances receipt', S.freshness(S.hourly(h, ['sensor.r'], 24, null)) === T);
          Date.now = realNow;
          done();
        });
      }, 40);
    });
  }, 40);
}
