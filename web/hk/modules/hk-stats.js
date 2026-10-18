// hk-stats.js - long-term statistics and history for the hk card set.
//
// THE CONTRACT: ASK SYNCHRONOUSLY, GET WOKEN LATER.
// A card's _render() is synchronous and its return value is drawn at once, so
// it can never await. Every function here is therefore a cache read that
// returns immediately -- the data if it is held, or null -- and starts a fetch
// in the background. When that lands, the cards that asked are woken and draw
// again from the now-warm cache.
//
// WHO GETS WOKEN. Whatever the caller passed as `card`. Nothing is discovered:
// no DOM walk, no shadow-root piercing, and a card that never called here is
// never touched. A card says when it is going away (see release/subsOf below).
//
// USAGE
//   const d = window.hkStats && window.hkStats.daily(client, 'sensor.foo', 14, this);
//   if (!d) return 'Loading...';        // first render only
//   // d = [{ t: <Date, HA-local bucket start>, v: <kWh or null> }, ...]
//   //     oldest first, always exactly 14 entries, gaps filled with null so
//   //     bars line up with dates rather than sliding when a day is missing.
//
//   window.hkStats.daily(client, id, 14, this, { type: 'mean' })  // temperature
//
// BUCKETS ARE IN HOME ASSISTANT'S TIMEZONE, not the browser's -- see the long
// note above floorTZ. `tz()` and `fields()` are exported so whoever LABELS a
// bucket uses the same zone it was cut in.
//
// BATCHING
// A popup full of usage cards renders in one pass, so every card calls in
// within the same tick. Requests are collected and flushed on a timer, which
// turns eight cards into ONE websocket call -- recorder/statistics_during_period
// takes a list of statistic_ids. Without this the energy popup would fire a
// dozen round trips every time it opened.
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Tuning
  // ---------------------------------------------------------------------
  // Long-term statistics are written once an hour, so anything under an hour
  // of TTL is re-fetching data that cannot have changed. Daily buckets also
  // get invalidated at local midnight (see cacheKey) regardless of TTL.
  // THE KEY ALREADY ROLLS AT EVERY NEW BUCKET (cacheKey), so a TTL only
  // re-asks INSIDE a bucket -- for data that changes when the recorder
  // compiles it, not more often. Five-minute statistics close every five
  // minutes: asking twice a bucket catches one compiled late. Hourly ones are
  // compiled once an hour: fifteen minutes catches an hour compiled after its
  // key rolled, without asking eleven times for an hour that cannot change.
  // Measured on the Energy page left open (2026-10-12): 60 s / 5 min here
  // was ~7 MB an hour of statistics over the websocket.
  var TTL = { day: 15 * 60 * 1000, hour: 15 * 60 * 1000, '5minute': 150 * 1000 };
  // The bucket each period is cut into.
  var SIZE = { day: 864e5, hour: 36e5, '5minute': 3e5 };

  // How long to sit on incoming requests before firing one combined call.
  // A render pass completes well inside this, and it is short enough that the
  // placeholder is never actually seen.
  var BATCH_MS = 40;

  // After a failed call, refuse to retry for this long. Without it a broken
  // statistic_id would be re-requested on every single re-render, which on a
  // busy dashboard is several times a second.
  var ERROR_BACKOFF_MS = 60 * 1000;

  // Ask the recorder to normalize units so a template never has to care what
  // the source sensor happens to be recorded in. This is also what rescues
  // the Wh-based meters -- they come back in kWh like everything else.
  var UNITS = { energy: 'kWh', temperature: '°F', power: 'W' };

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  // cache: key -> { at, data: {statId: [{t, v}]}, error }
  var cache = new Map();
  // pending: key -> { ids: Set, cards: Set, period, count, type, timer }
  var pending = new Map();

  // IN FLIGHT: key -> Set({ ids: Set, cards: Set }), requests that have been
  // SENT and are waiting on the socket.
  //
  // WHY THIS EXISTS. flush() deletes the pending entry before it calls
  // callWS -- it has to, or the next batch would keep accumulating into a job
  // that has already gone out. But the cache is not written until the response
  // arrives, so for the length of the round trip get() still sees those ids as
  // missing and asks for them again. A view change or a MODULE WAKE renders
  // many cards at once against the same key, and every one of them inside that
  // window would start an identical second request.
  //
  // A key can have more than one flight when a later card asks for a partially
  // overlapping set. With only one flight per key the second would overwrite
  // the first; whichever response landed first would then delete the other's
  // claim and let duplicate requests escape. Each flight therefore owns its
  // own lifetime.
  var inFlight = new Map();

  // =====================================================================
  // TIME BUCKETS BELONG TO HOME ASSISTANT, NOT TO THE BROWSER
  // =====================================================================
  //
  // The recorder buckets `period: day` at midnight in HA's CONFIGURED
  // timezone. Verified: with America/New_York a day bucket comes back as
  // ...T04:00:00Z, which is midnight EDT, not midnight UTC and not midnight
  // anywhere else.
  //
  // An axis built with `setHours(0,0,0,0)` -- midnight in the BROWSER's
  // timezone -- that then matches rows by exact timestamp:
  //
  //     byTime.get(startOfDay(new Date(r.start)).getTime())
  //
  // works on a wall tablet, where the two zones are the same. On a phone in
  // another timezone NOT ONE KEY MATCHES, so every bucket stays null and the
  // chart is empty. That is the failure mode: not a shifted bar, a blank
  // chart with no error anywhere.
  //
  // DST IS WORSE, because it needs no travel at all. Stepping an hourly axis
  // with `t.setHours(t.getHours() - i)` is WALL-CLOCK arithmetic. Run across
  // the fall-back boundary (measured, America/New_York):
  //
  //     ...T05:00:00Z  local 01:00 EDT
  //     ...T07:00:00Z  local 02:00 EST      <- 06:00Z never appears
  //
  // The repeated 01:00 hour has a real recorder bucket at 06:00Z and such an
  // axis has no slot for it, so one hour of every fall-back night is silently
  // dropped, once a year.
  //
  // THE FIX IS THE SAME ONE TWICE: stop doing arithmetic on wall-clock fields.
  // Bucket boundaries are found by asking Intl where the boundary IS in HA's
  // zone, and stepping between buckets is done in absolute milliseconds. An
  // hour is always 3600000ms of real time; a day is 23, 24 or 25 of those, so
  // days step by re-flooring rather than by adding a constant.

  // The zone every bucket in this module is expressed in. Set from
  // client.config.time_zone the first time a caller hands us a client --
  // there is no other documented frontend source for it, and it cannot be
  // read before a connection exists.
  //
  // Until then, and if HA ever reports none, this stays null and every
  // function below falls back to the browser's own zone. That fallback is the
  // honest answer rather than a guess: on a wall tablet in the house it is
  // also the RIGHT answer.
  var HA_TZ = null;

  function useTZ(client) {
    var tz = client && client.config && client.config.time_zone;
    if (tz && tz !== HA_TZ && supported(tz)) HA_TZ = tz;
    return HA_TZ;
  }

  // A named zone is required -- a fixed offset cannot express DST, which is
  // the whole point. If this browser's Intl cannot do zones at all (or does
  // not know this one), we say so ONCE and keep using browser-local time.
  var tzOK = {};
  function supported(tz) {
    if (tz in tzOK) return tzOK[tz];
    var ok = false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit' }).format(0);
      ok = true;
    } catch (e) {
      console.warn('[hk-stats] this browser cannot resolve the Home Assistant '
                 + 'timezone "' + tz + '"; falling back to browser-local buckets', e);
    }
    tzOK[tz] = ok;
    return ok;
  }

  // Cached because formatToParts is not cheap and this runs per row.
  var FMT = {};
  function fmt(tz) {
    if (!FMT[tz]) {
      FMT[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return FMT[tz];
  }

  // How far `tz` is from UTC at a given INSTANT, in ms. Reading the offset at
  // the instant rather than from a table is what makes every function here
  // DST-correct without knowing any DST rules.
  function offsetAt(tz, at) {
    var p = {};
    fmt(tz).formatToParts(new Date(at)).forEach(function (x) { p[x.type] = x.value; });
    // hour12:false still renders midnight as "24" in some ICU versions.
    var h = +p.hour % 24;
    var asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
    return asIfUTC - Math.floor(at / 1000) * 1000;
  }

  // Floor an instant to the start of its containing bucket, in HA's zone.
  // `size` is 864e5 for a day or 36e5 for an hour.
  //
  // The two-step correction is the DST part: shifting the wall clock back by
  // the offset we measured INSIDE the bucket can land outside it when the
  // offset changed at the boundary, so we re-measure at the candidate and try
  // again. Two passes is enough for every real zone -- transitions are at most
  // an hour and never adjacent.
  function floorTZ(at, size) {
    // FIVE MINUTES NEED NO ZONE: every real offset is a whole number of
    // quarter hours, so a five-minute edge in UTC is one in every zone.
    if (size < 36e5) return Math.floor(at / size) * size;
    var tz = HA_TZ;
    if (!tz) {                       // browser-local: no zone known
      var d = new Date(at);
      if (size === 864e5) d.setHours(0, 0, 0, 0); else d.setMinutes(0, 0, 0);
      return d.getTime();
    }
    var off = offsetAt(tz, at);
    var wall = Math.floor((at + off) / size) * size;
    var guess = wall - off;
    var off2 = offsetAt(tz, guess);
    if (off2 !== off) guess = wall - off2;
    return guess;
  }

  // Kept as Date-returning wrappers: everything downstream (align, the public
  // API's {t: Date}, hk-charts) speaks Date, and the contract that `t` is a
  // Date is documented at the top of this file.
  function startOfDay(d) { return new Date(floorTZ(+new Date(d), 864e5)); }

  // "Is this instant inside the first hour of its own day, in HA's zone?"
  // Expressed as the two floors agreeing rather than as `getHours() === 0`,
  // which is the browser's midnight and the wrong midnight for a remote
  // client. It is also DST-proof by construction: on a spring-forward day the
  // first hour is still the first hour, whatever number it wears.
  function isFirstHourOfDay(at) {
    return floorTZ(at, 36e5) === floorTZ(at, 864e5);
  }

  // Whole hours from HA-local midnight to now -- how far back an hourly
  // request has to reach to cover today.
  function hoursSinceMidnight(at) {
    return Math.round((floorTZ(at, 36e5) - floorTZ(at, 864e5)) / 36e5);
  }

  // The cache key carries the current bucket boundary, so at midnight every
  // daily key changes and yesterday's answer is abandoned without needing a
  // separate expiry pass.  Same trick on the hour for hourly.
  //
  // Abandoned alone would leave the entry in the Map for the life of the
  // page. One dead key per chart shape per hour is small, but a wall tablet's
  // page lives for weeks, so it would only ever grow. Building a key also
  // evicts every entry for the same shape at an OLDER edge -- the rollover
  // itself is the expiry pass.
  function cacheKey(period, count, type) {
    var edge = floorTZ(Date.now(), SIZE[period] || 36e5);
    var prefix = period + '|' + count + '|' + type + '|';
    var key = prefix + edge;
    var now = cache.get(key), ready = !!(now && now.data);
    // Evict every entry of this period and type whose edge is OLDER -- at
    // any count. dailyPeak asks for a count that grows by one every hour, so
    // an eviction keyed on the count would never match the previous hour's
    // entry and the cache would grow by one dead row an hour. Two live shapes
    // at the same edge but different counts keep each other.
    // EXCEPT THE STAND-IN: until the new edge's answer has landed, the older
    // entry of the SAME shape stays -- get() draws it meanwhile (standIn), so
    // a roll does not blank every chart for the round trip. It goes on the
    // first call after the new answer is in.
    cache.forEach(function (_v, k) {
      var p = k.split('|');
      if (k !== key && p[0] === period && p[2] === type && Number(p[3]) < edge &&
          (ready || Number(p[1]) !== count)) cache.delete(k);
    });
    return key;
  }
  // the newest older entry of this shape holding every id: what was on screen
  // a moment ago, one bucket behind
  function standIn(key, list) {
    var p = key.split('|'), best = null, bestEdge = -Infinity;
    cache.forEach(function (v, k) {
      var q = k.split('|');
      if (k === key || q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2] || !v.data) return;
      if (Number(q[3]) > bestEdge && list.every(function (id) { return v.data[id]; })) { best = v; bestEdge = Number(q[3]); }
    });
    return best;
  }

  // Build the fixed, gap-filled axis the caller was promised: exactly `count`
  // buckets ending with the one we are in now.
  // HOURS STEP IN ABSOLUTE TIME, DAYS STEP BY RE-FLOORING.
  //
  // An hour is always 3600000ms, DST or not -- the fall-back night genuinely
  // has 25 hourly buckets and the recorder returns 25, so stepping by a
  // constant is not an approximation here, it is the correct answer. Two of
  // them render as "1 AM", which is honest.
  //
  // A DAY IS NOT A CONSTANT (23, 24 or 25 hours), so days cannot step that
  // way. Going back a notional 12 hours from a midnight always lands somewhere
  // inside the previous day -- the shortest real day is 23 hours -- and
  // flooring from there gives that day's true midnight in HA's zone.
  function axis(period, count) {
    var out = [];
    var size = SIZE[period] || 36e5;
    var t = floorTZ(Date.now(), size);
    out.push(new Date(t));
    for (var i = 1; i < count; i++) {
      t = period === 'day' ? floorTZ(t - 12 * 36e5, 864e5) : t - size;
      out.unshift(new Date(t));
    }
    return out;
  }

  // HA returns only the buckets it has. Place each returned row into the slot
  // whose RANGE contains it, so a missing day leaves a hole rather than
  // shifting every later bar one place to the left.
  //
  // BY RANGE, NOT BY EXACT TIMESTAMP. A Map keyed on the exact bucket start
  // drops anything that does not hit a key, which turns a one-hour offset
  // difference into a chart of nothing at all. A slot owns everything from
  // its own start up to the next slot's start, which
  // is the definition of a bucket and needs no agreement about how the two
  // sides rounded. It also handles the 23- and 25-hour days for free, because
  // the slot boundaries came from HA's zone in the first place.
  function align(rows, period, count, type) {
    var slots = axis(period, count);
    var ms = slots.map(function (t) { return t.getTime(); });
    var out = slots.map(function (t) { return { t: t, v: null }; });

    (rows || []).forEach(function (r) {
      var t = +new Date(r.start);
      if (!isFinite(t)) return;
      // Last slot starting at or before this row.
      var lo = 0, hi = ms.length - 1, idx = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (ms[mid] <= t) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (idx < 0) return;                       // older than the window
      // The newest slot is the one we are still inside, so it has no upper
      // bound to test against.
      if (idx + 1 < ms.length && t >= ms[idx + 1]) return;
      var v = r[type];
      out[idx].v = (typeof v === 'number' && isFinite(v)) ? v : null;
    });
    return out;
  }

  // WAKING A SUBSCRIBER.
  //
  // The contract is `card.requestUpdate()`. HkBase implements it as a shim
  // that clears its render gate and redraws (it is not a Lit component); a
  // real Lit component implements it natively.
  //
  // NAMING A PROPERTY FIRST is the part worth keeping. A bare requestUpdate()
  // produces an EMPTY changedProperties map, and a component whose
  // shouldUpdate() tests that map will drop the update -- the card then sits
  // on cached data it never draws. Passing a property the component actually
  // declares puts an entry in the map and gets through such a gate. The
  // sentinel {} as oldValue makes Lit's notEqual() record it rather than
  // discard it as a no-op. Nothing is mutated; this only marks it dirty.
  //
  // `_spinnerActive` is button-card's name. It is harmless -- `in` skips it
  // on every card here -- and it is kept as the documented example of the
  // gate this list exists for.
  var WAKE = ['_spinnerActive', '_config'];

  function nudge(card) {
    for (var i = 0; i < WAKE.length; i++) {
      var name = WAKE[i];
      // Only use a property this build actually has; fall through otherwise.
      if (!(name in card)) continue;
      card.requestUpdate(name, {});
      return;
    }
    card.requestUpdate();
  }

  // `cards` may be a Set we own (histSubs) or a throwaway from a pending job.
  // If it is a Set, detached cards are DROPPED as we go: histSubs lives for the
  // life of the page, and a wall tablet re-creates every card on every
  // navigation, so holding a torn-down card holds its whole shadow subtree.
  // Skipping the render is not the problem -- the strong reference is.
  function notify(cards) {
    var dead = [];
    cards.forEach(function (card) {
      try {
        // A popup that was closed mid-flight leaves detached cards behind.
        if (card && card.isConnected && card.requestUpdate) nudge(card);
        else dead.push(card);
      } catch (e) {
        // A card that has been torn down can throw here. There is nothing to
        // do about it and nothing depends on it, so it is swallowed rather
        // than allowed to abort the rest of the notify loop.
        dead.push(card);
      }
    });
    // Through unlink, not cards.delete, so the card -> sets map stays in
    // step. A stale entry there would make a later release() walk a set it is
    // no longer in -- harmless, but it would also keep the entry alive.
    if (cards && typeof cards.delete === 'function') {
      dead.forEach(function (card) { unlink(card, cards); });
    }
  }

  // Per-series receipt times survive cache merges, errors and bucket stand-ins.
  var received = new WeakMap();
  function freshness(series) {
    var list = Array.isArray(series) ? [series] : Object.keys(series || {}).map(function (id) { return series[id]; });
    var times = list.map(function (rows) { return received.get(rows) || 0; });
    return times.length && times.every(Boolean) ? Math.min.apply(null, times) : null;
  }

  function flush(key) {
    var job = pending.get(key);
    if (!job) return;
    pending.delete(key);

    var ids = Array.from(job.ids);
    // Claim these ids for the duration of the round trip. job.cards is passed
    // BY REFERENCE on purpose: cards that ask during the flight are added to
    // it, and the notify() in both handlers below then reaches them.
    var flight = { ids: new Set(ids), cards: job.cards };
    var flights = inFlight.get(key);
    if (!flights) { flights = new Set(); inFlight.set(key, flights); }
    flights.add(flight);
    var start = axis(job.period, job.count)[0];
    // The recorder treats start_time as inclusive of the bucket that contains
    // it, so the first bucket on our axis is safely included.
    var msg = {
      type: 'recorder/statistics_during_period',
      start_time: new Date(start).toISOString(),
      period: job.period,
      statistic_ids: ids,
      types: [job.type],
      units: UNITS
    };

    job.client.callWS(msg).then(function (res) {
      var data = {};
      ids.forEach(function (id) {
        data[id] = align(res && res[id], job.period, job.count, job.type);
        received.set(data[id], Date.now());
      });
      var prev = cache.get(key);
      // Merge rather than replace: a second card may have asked for a
      // different statistic under the same key while this call was in flight.
      cache.set(key, {
        at: Date.now(),
        error: 0,
        data: Object.assign({}, (prev && prev.data) || {}, data)
      });
      flights.delete(flight);
      if (!flights.size) inFlight.delete(key);
      notify(job.cards);
    }).catch(function (err) {
      cache.set(key, {
        at: Date.now(),
        error: Date.now(),
        data: (cache.get(key) || {}).data || {}
      });
      // Surfaced once per backoff window rather than silently swallowed --
      // a wrong statistic_id is otherwise invisible, the chart just stays
      // empty forever with no clue why.
      console.warn('[hk-stats] statistics_during_period failed for', ids, err);
      flights.delete(flight);
      if (!flights.size) inFlight.delete(key);
      notify(job.cards);
    });
  }

  function request(client, key, period, count, type, ids, card) {
    // Anything already on the wire for this key is dropped from the ask, and
    // the caller is attached to the flight instead. If that accounts for
    // everything it wanted, there is nothing to batch and no timer to arm.
    var flights = inFlight.get(key);
    if (flights) {
      var fresh = [];
      ids.forEach(function (id) {
        var owners = [];
        flights.forEach(function (flight) {
          if (flight.ids.has(id)) owners.push(flight);
        });
        if (!owners.length) fresh.push(id);
        else if (card) owners.forEach(function (flight) { subscribe(flight.cards, card); });
      });
      if (!fresh.length) return;
      ids = fresh;
    }
    var job = pending.get(key);
    if (!job) {
      job = {
        client: client, period: period, count: count, type: type,
        ids: new Set(), cards: new Set(), timer: null
      };
      pending.set(key, job);
    }
    job.client = client;                       // always use the freshest client
    ids.forEach(function (id) { job.ids.add(id); });
    if (card) subscribe(job.cards, card);
    // Armed LAST, and only once. Arming it at construction time would let a
    // zero-delay timer fire before the ids above were added, sending an empty
    // statistic_ids list.
    if (!job.timer) job.timer = setTimeout(function () { flush(key); }, BATCH_MS);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  // `ids` may be a single statistic_id or an array. An array returns an object
  // keyed by id, which is how the "rank every circuit by today's kWh" cards
  // pull thirty series in a single call.
  function get(client, ids, count, card, opts) {
    if (!client || !client.callWS) return null;
    // THE ONE PLACE THE ZONE IS ADOPTED. Every public entry point funnels
    // through here, and it runs before cacheKey below -- which matters,
    // because the key carries the current bucket edge and that edge is
    // zone-dependent. Learning the zone late would otherwise leave one stale
    // entry keyed at the browser's midnight.
    var wasTZ = HA_TZ;
    if (useTZ(client) !== wasTZ) cache.clear();
    opts = opts || {};
    var period = opts.period || 'day';
    var type = opts.type || 'change';
    var many = Array.isArray(ids);
    var list = many ? ids : [ids];
    if (!list.length) return many ? {} : null;

    var key = cacheKey(period, count, type);
    var hit = cache.get(key);
    var missing = list.filter(function (id) {
      return !hit || !hit.data || !hit.data[id];
    });

    if (missing.length) {
      var backedOff = hit && hit.error && (Date.now() - hit.error) < ERROR_BACKOFF_MS;
      if (!backedOff) request(client, key, period, count, type, missing, card);
      // A NEW BUCKET: the same shape's answer from the bucket before, whole,
      // while this one is asked for (cacheKey keeps it until then).
      var prev = !hit || !hit.data ? standIn(key, list) : null;
      if (prev) {
        if (!many) return prev.data[list[0]];
        var was = {};
        list.forEach(function (id) { was[id] = prev.data[id]; });
        return was;
      }
      // Partial answers are not returned: a chart drawn from half its series
      // rescales the moment the rest arrives, which reads as a glitch. Wait.
      return null;
    }

    if (hit && (Date.now() - hit.at) > (TTL[period] || TTL.day)) {
      // Stale but usable. Refresh in the background and return what we have,
      // so a re-opened popup draws instantly instead of flashing a placeholder.
      request(client, key, period, count, type, list, card);
    }

    if (!many) return hit.data[list[0]];
    var out = {};
    list.forEach(function (id) { out[id] = hit.data[id]; });
    return out;
  }

  // -------------------------------------------------------------------------
  // dailyPeak(client, ids, days, card) -- daily totals for a sensor that
  // ACCUMULATES through the day and resets at midnight, e.g. the
  // history_stats HVAC run-time sensors.
  //
  // DO NOT use daily() with type 'max' for these. Measured: the 00:00
  // statistics bucket reads min=0.00 max=<yesterday's final total>, because
  // the sensor still holds yesterday's number for a moment before its window
  // rolls. So a day whose runtime is lower than the day before inherits the
  // higher figure -- always too high, and on five days in a twelve-day
  // sample, checked against independent run-time-yesterday sensors.
  //
  // Reading hour buckets and skipping hour 0 is exact rather than a patch: the
  // accumulator is monotonic WITHIN a day, so the maximum over 01:00-23:59 is
  // the value it ended the day on -- and whatever ran between midnight and
  // 01:00 is already counted inside that total.
  function dailyPeak(client, ids, days, card) {
    // Enough hour buckets to reach back to HA-local midnight `days-1` days
    // ago. `days-1` whole days is at most 25 hours each across a fall-back, so
    // this asks for one extra hour per day rather than counting exactly -- a
    // slightly longer window costs one bucket and cannot come up short.
    var hours = (days - 1) * 25 + hoursSinceMidnight(Date.now()) + 1;
    var many = Array.isArray(ids);
    var h = get(client, ids, hours, card, { period: 'hour', type: 'max' });
    if (!h) return null;

    var fold = function (rows) {
      var byDay = new Map();
      rows.forEach(function (r) {
        // The first hour of the day is the reset artifact and is never
        // representative. HA's day, not the browser's.
        if (isFirstHourOfDay(+r.t)) return;
        var k = startOfDay(r.t).getTime();
        var cur = byDay.get(k);
        if (typeof r.v === 'number' && (cur == null || r.v > cur)) byDay.set(k, r.v);
        else if (!byDay.has(k)) byDay.set(k, null);
      });
      // The SAME day boundaries the rest of the module uses, rather than a
      // second hand-rolled ladder -- `setDate` here would be the day-stepping
      // twin of the `setHours` trap described above axis().
      var out = axis('day', days).map(function (t) {
        var v = byDay.get(t.getTime());
        return { t: t, v: (typeof v === 'number' ? v : null) };
      });
      return out;
    };

    // MEMOIZED PER ROW ARRAY. fold() floors every one of ~340 hour rows twice
    // in HA's zone -- about 1,400 Intl formatToParts calls -- and without this
    // it runs on every render of every runtime card: 30ms each on a Mac,
    // several times that on a tablet. The rows are immutable once cached (a
    // refresh stores new arrays), so the array itself is the cache key and a
    // stale answer is impossible. `days` and the current day are the only other inputs.
    var memo = function (rows) {
      var today = axisEdgeDay();
      var m = peakMemo.get(rows);
      if (m && m.days === days && m.today === today) return m.out;
      var out = fold(rows);
      peakMemo.set(rows, { days: days, today: today, out: out });
      return out;
    };
    if (!many) return memo(h);
    var res = {};
    Object.keys(h).forEach(function (k) { res[k] = memo(h[k]); });
    return res;
  }
  var peakMemo = new WeakMap();
  function axisEdgeDay() { return floorTZ(Date.now(), 864e5); }

  // ---------------------------------------------------------- the calendar
  // Calendar fields of an instant AS HOME ASSISTANT SEES THEM. getDay() and
  // getHours() on a Date are the browser's answer; these are HA's.
  var FIELDS_FMT = {};
  function fields(at) {
    var ms = +new Date(at);
    var tz = HA_TZ;
    if (!tz) {
      var d = new Date(ms);
      return { hour: d.getHours(), weekday: d.getDay(), day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
    }
    var f = FIELDS_FMT[tz] || (FIELDS_FMT[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric'
    }));
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return {
      hour: +p.hour % 24,
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
      day: +p.day, month: +p.month, year: +p.year
    };
  }
  // DAYS STEP BY RE-FLOORING, as the axis does: back 12 hours from a
  // midnight is inside the day before, ahead 36 is inside the day after,
  // whatever DST did to either day's length
  function addDays(at, k) {
    var t = floorTZ(+new Date(at), 864e5);
    for (var i = 0; i < Math.abs(k); i++) t = floorTZ(k < 0 ? t - 12 * 36e5 : t + 36 * 36e5, 864e5);
    return t;
  }
  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  // the languages whose week starts on a Sunday, where a browser cannot say
  // (Intl.Locale's week info is newer than some wall tablets' WebViews)
  var SUNDAY_FIRST = /^(en(-(us|ca|au|nz|ph|za|in))?|ja|ko|he|zh-(tw|hk)|pt-br|es-(mx|us)|ar|hi|th)$/i;
  function weekStart(client) {
    var L = (client && client.locale) || {}, w = String(L.first_weekday || 'language').toLowerCase();
    var i = WEEKDAYS.indexOf(w);
    if (i >= 0) return i;
    var lang = L.language || (client && client.language) || (typeof navigator !== 'undefined' && navigator.language) || 'en';
    try {
      var loc = new Intl.Locale(lang), info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
      if (info && info.firstDay) return info.firstDay % 7;
    } catch (e) { /* an old engine: the list below */ }
    return SUNDAY_FIRST.test(lang) ? 0 : 1;
  }
  function period(per, back, now, ws) {
    var t0 = floorTZ(+new Date(now || Date.now()), 864e5), f = fields(t0), start, len;
    back = Math.max(0, back || 0);
    if (per === 'week') {
      start = addDays(t0, -(((f.weekday - (ws || 0)) % 7 + 7) % 7) - 7 * back);
      len = 7;
    } else {
      start = addDays(t0, 1 - f.day);
      for (var b = 0; b < back; b++) {
        var last = addDays(start, -1);
        start = addDays(last, 1 - fields(last).day);
      }
      var g = fields(start);
      len = new Date(Date.UTC(g.year, g.month, 0)).getUTCDate();
    }
    return { start: start, len: len };
  }

  // -------------------------------------------------------------------------
  // history(client, entityId, hours, card) -- RAW recorded states, not statistics.
  //
  // Statistics are hourly at best, which is far too coarse for a live trace --
  // an hour bucket would flatten the very steps the chart exists to show. This
  // goes to the REST history endpoint instead, which returns every recorded
  // state change. `minimal_response&no_attributes` keeps the payload small.
  //
  // Bounded by recorder.purge_keep_days, so do not ask for more than it keeps.
  //
  // Same contract as daily(): returns null on the first call, caches, and
  // wakes the card when the data lands. Stale data is returned while a
  // refresh runs, so a revisit draws instantly.
  // notify() prunes as it goes, but it only runs when a fetch RESOLVES -- at
  // most once per HIST_TTL per key. Between fetches every render adds its card
  // again, so a page left on a chart view accumulates in between. Adding
  // through here keeps that bounded without walking the set on every render:
  // it only sweeps once the set is implausibly large for the number of cards
  // one page can actually show.
  var SUBS_HIGH_WATER = 32;

  // WHERE EACH CARD IS SUBSCRIBED, so it can be removed from exactly those
  // places and nowhere else.
  //
  // Everything above is defensive cleanup: notify() prunes what it walks, and
  // the high-water sweep bounds a set between fetches. Both are reactive --
  // nothing happens until the NEXT response, which for a daily chart is up to
  // fifteen minutes away, and a card that is detached and never asked for
  // again is simply held until something else triggers a pass.
  //
  // So a card says when it is done, from disconnectedCallback (see
  // HkBase). This map is what makes that cheap: release() walks the handful of
  // sets this card actually joined instead of every set in the module, and
  // there is no DOM scan anywhere -- the card tells us, we do not go looking.
  //
  // WEAK, so an element that is dropped without ever disconnecting (a whole
  // view torn out at once) does not pin its entry here. The Sets inside are
  // held by the module anyway; this only maps card -> which of them.
  var subsOf = new WeakMap();

  function subscribe(set, card) {
    if (!set || !card) return;
    set.add(card);
    var mine = subsOf.get(card);
    if (!mine) { mine = new Set(); subsOf.set(card, mine); }
    mine.add(set);
    // KEPT AS A BACKSTOP, not as the mechanism. It still catches the cards
    // that never disconnect cleanly -- a card whose element is replaced
    // wholesale, or one whose own disconnectedCallback forgets to chain.
    if (set.size > SUBS_HIGH_WATER) {
      var dead = [];
      set.forEach(function (c) { if (!c || !c.isConnected) dead.push(c); });
      dead.forEach(function (c) { unlink(c, set); });
    }
  }

  function unlink(card, set) {
    set.delete(card);
    var mine = card && subsOf.get(card);
    if (mine) {
      mine.delete(set);
      if (!mine.size) subsOf.delete(card);
    }
  }

  // THE EXPLICIT DISPOSAL. Called by a card that is going away; safe to call
  // more than once, and safe to call on a card that never subscribed.
  //
  // A response that lands after this does not reach the card and does not
  // retain it: it is gone from every set the notify loops walk. A card that is
  // re-attached simply subscribes again on its next render, and a Set makes
  // that idempotent.
  //
  // RETURNS TRUE WHEN THE CARD WAS STILL WAITING. That is not a detail: a card
  // released while it waits will never be woken by the response, and a card
  // that is merely MOVED (detached and re-attached in the same task, as a
  // grid view can do on the first build of a view) keeps showing "Loading"
  // until its sensor happens to change -- 40 minutes, measured, for an HVAC
  // runtime card whose data sat in the cache the whole time. HkBase
  // uses the answer to redraw on re-attach.
  function release(card) {
    if (!card) return false;
    var mine = subsOf.get(card);
    if (!mine) return false;
    mine.forEach(function (set) { set.delete(card); });
    subsOf.delete(card);
    return mine.size > 0;
  }

  var HIST_TTL = 5 * 60 * 1000;
  var histCache = new Map();   // key -> { at, used, data: [{t: Date, v: number}] }
  var histSubs = new Map();    // key -> Set(card)
  var histInFlight = new Set();

  // A BOUND ON THE RAW HISTORY KEPT. The dashboards' own charts
  // ask for a fixed handful of series; the detail sheets (hk-detail.js) ask
  // for whichever sensor was opened, up to four ranges each, and a day of a
  // power sensor is ~11,000 points (811 KB of JSON, measured). Unbounded,
  // nothing would ever leave this map, and a wall tablet that stays up for
  // weeks would keep them all.
  // Past HIST_MAX keys, entries nobody has READ for HIST_IDLE_MS go, oldest
  // first -- never one in flight or in use, so a series a page is drawing is
  // not dropped from under it (that would refetch on every render). The
  // bound is soft: with everything in use it is exceeded, not enforced.
  var HIST_MAX = 24, HIST_IDLE_MS = 10 * 60 * 1000;
  function histPut(key, entry) {
    entry.used = Date.now();
    histCache.set(key, entry);
    if (histCache.size <= HIST_MAX) return;
    var cut = Date.now() - HIST_IDLE_MS;
    histCache.forEach(function (e, k) {
      if (histCache.size <= HIST_MAX || k === key || e.used >= cut || histInFlight.has(k)) return;
      histCache.delete(k);
      histSubs.delete(k);
    });
  }

  function history(client, entityId, hours, card) {
    if (!client || !client.callApi || !entityId) return null;
    hours = hours || 3;
    var key = entityId + '|' + hours;
    var hit = histCache.get(key);
    if (hit) hit.used = Date.now();
    var stale = !hit || (Date.now() - hit.at) > HIST_TTL;

    if (stale && !histInFlight.has(key)) {
      histInFlight.add(key);
      if (!histSubs.has(key)) histSubs.set(key, new Set());
      subscribe(histSubs.get(key), card);

      var start = new Date(Date.now() - hours * 3600000).toISOString();
      var url = 'history/period/' + encodeURIComponent(start) +
                '?filter_entity_id=' + encodeURIComponent(entityId) +
                '&minimal_response&no_attributes';

      client.callApi('GET', url).then(function (res) {
        var rows = (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : [];
        var vals = [];
        rows.forEach(function (r) {
          var v = Number(r.state);
          var t = new Date(r.last_changed || r.last_updated || 0);
          if (typeof v === 'number' && isFinite(v) && isFinite(t.getTime())) {
            vals.push({ t: t, v: v });
          }
        });
        histInFlight.delete(key);
        histPut(key, { at: Date.now(), data: vals });
        notify(histSubs.get(key) || []);
      }).catch(function (err) {
        // Cache the failure so a bad entity_id is not re-requested on every
        // render -- same reasoning as the statistics backoff above.
        histInFlight.delete(key);
        histPut(key, { at: Date.now(), data: (hit && hit.data) || [] });
        console.warn('[hk-stats] history/period failed for', entityId, err);
        notify(histSubs.get(key) || []);
      });
    } else if (card && histSubs.has(key)) {
      subscribe(histSubs.get(key), card);
    }

    return hit ? hit.data : null;
  }

  window.hkStats = {
    history: history,
    // Called by HkBase.disconnectedCallback. See the note on subsOf: this is
    // the mechanism, and the pruning above is the backstop.
    release: release,
    dailyPeak: dailyPeak,
    freshness: freshness,
    daily: function (client, ids, days, card, opts) {
      return get(client, ids, days, card, Object.assign({ period: 'day' }, opts || {}));
    },
    hourly: function (client, ids, hours, card, opts) {
      return get(client, ids, hours, card, Object.assign({ period: 'hour' }, opts || {}));
    },
    // THE RECORDER'S SHORT-TERM STATISTICS: five-minute buckets, kept ten
    // days. What a live line of the last few hours is drawn from -- one
    // batched call for a whole page of circuits, where history/period would
    // be one request per sensor. The newest bucket is still open, so it is
    // null until the recorder closes it.
    fiveMinute: function (client, ids, count, card, opts) {
      return get(client, ids, count, card, Object.assign({ period: '5minute', type: 'mean' }, opts || {}));
    },
    // THE ZONE EVERY BUCKET IS EXPRESSED IN, for whoever has to LABEL them.
    // A bucket that starts at HA's midnight must not be captioned with the
    // browser's date, or a remote client gets correct bars under the wrong
    // day names -- which is worse than a blank chart, because it looks right.
    //
    // Returns null until a connection has been seen, and null on a browser
    // whose Intl cannot resolve the zone. Both mean "use browser-local", which
    // is what an undefined `timeZone` option does -- so callers can pass the
    // result straight into toLocaleDateString without a branch.
    tz: function () { return HA_TZ || undefined; },

    // calendar fields of an instant in HA's zone: hour, weekday, day, month, year
    fields: fields,
    // HA-local midnight `k` days from the midnight of `at` (k < 0: back)
    addDays: addDays,
    // THE FIRST DAY OF THE WEEK, 0 (Sunday) to 6, as the signed-in user set
    // it in their Home Assistant profile (client.locale.first_weekday);
    // "language" is the language's own (Sunday for English)
    weekStart: weekStart,
    // A CALENDAR PERIOD: { start (HA-local midnight), len (days) } of the
    // week or month `back` periods before the one `now` is in
    period: period,

    // Escape hatch for debugging from the console: hkStats.dump()
    dump: function () { return { cache: cache, pending: pending, inFlight: inFlight }; },

    // TEST SEAMS. The bucket boundaries are the thing most worth pinning and
    // the least reachable from outside: get() needs a live websocket, and the
    // interesting days (a fall-back, a spring-forward) are not today. These
    // two let tests/test_tzbuckets.js drive the axis directly against a fixed
    // clock. Double underscore so nothing takes them for public API.
    __axis: axis,
    __align: align
  };
  // Tell already-drawn cards this module exists -- see MODULE WAKE in hk-base.js.
  try { window.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkStats' })); } catch (e) {}
})();
