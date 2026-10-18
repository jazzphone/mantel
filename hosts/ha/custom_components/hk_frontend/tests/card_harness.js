// THE CARD LIFECYCLE HARNESS -- what a suite needs to drive a real card the
// way Lovelace does: construct, setConfig, a stream of hass objects, attach,
// detach, re-attach. Load AFTER tests/dom.js:
//
//     load(HK_ROOT + '/tests/dom.js');
//     load(HK_ROOT + '/tests/card_harness.js');
//
// Not a suite (tests/run only runs test_*.js). It drives the cards that
// have no suite of their own beyond their editors: alert, clock, weather
// band/strip, battery strip, trace, usage, stat, rank, key, spacer, media
// tile, slider, thermostat, timer strip.
//
// EVERYTHING HERE IS ADDED TO THE SHIM, NEVER CHANGED IN IT. dom.js is shared
// by every other suite; the features below are ones only these suites need:
//
//   * tracked timers -- dom.js's fake setTimeout never forgets a one-shot
//     timer (it is an interval that is simply never run), so "how many timers
//     are pending" cannot be read from it. These can.
//   * <template> + childNodes, so hkCards.morph() -- which the clock, the
//     energy cards, the rank tile and the timer strip all draw through -- runs
//     FOR REAL instead of throwing on `tpl.content`. The template does not
//     parse: its content is one text node holding the markup, so after a
//     morph the element's text child IS the markup the card asked for.
//   * El.remove(), which the tile family calls on the parts it does not draw.
//   * an innerHTML recorder per element (dom.js's innerHTML is write-only).
//   * ResizeObserver, a websocket connection with subscribeMessage, and a
//     "house" that hands out fresh hass objects the way the frontend does.
(function () {
  'use strict';
  if (typeof El !== 'function') throw new Error('load tests/dom.js before card_harness.js');
  var H = {};
  globalThis.H = H;

  // ------------------------------------------------------------ assertions
  var pass = 0, fail = 0;
  // JSON, or a tag name for a shim element (their parentNode links are cyclic).
  function show(v) {
    try { var j = JSON.stringify(v); return j === undefined ? 'undefined' : j; }
    catch (e) { return '<' + ((v && v.tagName) || typeof v) + '>'; }
  }
  H.ok = function (name, cond, detail) {
    if (cond) { pass++; print('  PASS  ' + name); }
    else {
      fail++;
      print('  FAIL  ' + name + (detail !== undefined ? '   got ' + show(detail) : ''));
    }
    return !!cond;
  };
  H.eq = function (name, got, want) {
    var sg = show(got), sw = show(want);
    // An element cannot be serialised, so for one only identity counts.
    var same = sg.charAt(0) === '<' ? got === want : sg === sw;
    if (same) { pass++; print('  PASS  ' + name + '   ' + sg); }
    else {
      fail++;
      print('  FAIL  ' + name + '\n          got  ' + sg + '\n          want ' + sw);
    }
    return same;
  };
  H.throws = function (name, fn) {
    var threw = false;
    try { fn(); } catch (e) { threw = true; }
    return H.ok(name, threw);
  };
  H.noThrow = function (name, fn) {
    try { fn(); return H.ok(name, true); }
    catch (e) { return H.ok(name, false, String(e && e.stack || e)); }
  };
  H.section = function (t) { print('\n=== ' + t + ' ==='); };

  // Steps run in order; a step may return a promise. The summary line is the
  // LAST line printed, which is what both runners read.
  H.run = function (label, steps) {
    var p = Promise.resolve();
    steps.forEach(function (s) {
      p = p.then(function () { return s(); }).catch(function (e) {
        fail++;
        print('  FAIL  step threw: ' + String(e && e.stack || e));
      });
    });
    return p.then(function () {
      print(fail ? 'FAIL ' + fail + ' ' + label + ' TESTS (' + pass + ' passed)'
                 : 'ALL ' + pass + ' ' + label + ' TESTS PASS');
    });
  };

  // Let queued promise callbacks run.
  H.tick = function (n) {
    var p = Promise.resolve();
    for (var i = 0; i < (n || 6); i++) p = p.then(function () {});
    return p;
  };

  // ---------------------------------------------------------------- timers
  var T = { seq: 0, live: {} };
  function add(fn, ms, once) {
    var id = ++T.seq;
    T.live[id] = { fn: fn, ms: Number(ms) || 0, once: once };
    return id;
  }
  globalThis.setTimeout = function (fn, ms) { return add(fn, ms, true); };
  globalThis.setInterval = function (fn, ms) { return add(fn, ms, false); };
  globalThis.clearTimeout = globalThis.clearInterval = function (id) { delete T.live[id]; };
  globalThis.requestAnimationFrame = function (fn) { return add(fn, 0, true); };
  globalThis.cancelAnimationFrame = function (id) { delete T.live[id]; };
  // How many timers are pending right now: an interval until it is cleared,
  // a one-shot until it has fired or been cleared.
  H.timers = function () { return Object.keys(T.live).length; };
  // Fire what is due. `under` (ms) limits it to the short ones.
  H.runTimers = function (under) {
    Object.keys(T.live).forEach(function (id) {
      var t = T.live[id];
      if (!t || (under !== undefined && t.ms >= under)) return;
      if (t.once) delete T.live[id];
      t.fn();
    });
  };

  // ------------------------------------------------ DOM additions (not changes)
  El.prototype.remove = function () {
    if (this.parentNode && this.parentNode.removeChild) this.parentNode.removeChild(this);
  };
  El.prototype.nodeType = 1;
  Object.defineProperty(El.prototype, 'nodeName', {
    get: function () { return String(this.tagName || '').toUpperCase(); }
  });
  Object.defineProperty(El.prototype, 'childNodes', { get: function () { return this.children; } });
  Object.defineProperty(El.prototype, 'lastChild', {
    get: function () { return this.children[this.children.length - 1] || null; }
  });
  function TextNode(v) { this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = v; this.children = []; }
  H.TextNode = TextNode;

  var make = document.createElement;
  document.createElement = function (t) {
    var el = make.call(document, t);
    if (String(t).toLowerCase() === 'template') {
      var content = new El('#fragment');
      Object.defineProperty(el, 'innerHTML', {
        get: function () { return ''; },
        set: function (v) { content.children = [new TextNode(String(v))]; }
      });
      el.content = content;
    }
    return el;
  };
  document.body = document.body || new El('body');

  // What hkCards.morph() last drew into `el`: its text child (see above).
  H.morphed = function (el) {
    return (el && el.children || []).filter(function (c) { return c.nodeType === 3; })
      .map(function (c) { return c.nodeValue; }).join('');
  };
  // Record every innerHTML written to `el` (an own accessor; dom.js's is on the
  // prototype and not configurable). Clears children like the shim does.
  H.record = function (el) {
    el.__html = '';
    el.__writes = 0;
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get: function () { return el.__html; },
      set: function (v) { el.__html = String(v); el.__writes++; el.children = []; }
    });
    return el;
  };
  // The memoised stub dom.js hands back for `sel` -- what the card holds as
  // `this._e.<part>` after `querySelector(sel)`.
  H.part = function (root, sel) { return (root.__q || {})[sel]; };

  // ------------------------------------------------------- ResizeObserver
  var ROS = [];
  globalThis.ResizeObserver = function (cb) { this.cb = cb; this.els = []; ROS.push(this); };
  ResizeObserver.prototype.observe = function (el) { this.els.push(el); };
  ResizeObserver.prototype.unobserve = function (el) {
    this.els = this.els.filter(function (e) { return e !== el; });
  };
  ResizeObserver.prototype.disconnect = function () { this.els = []; };
  H.observed = function () { return ROS.reduce(function (n, r) { return n + r.els.length; }, 0); };
  H.resize = function (el, width) {
    ROS.forEach(function (r) {
      if (r.els.indexOf(el) >= 0) r.cb([{ target: el, contentRect: { width: width } }]);
    });
  };

  // ------------------------------------------------------------- the house
  // A fixed clock for last_updated, so a changed entity gets a later stamp and
  // an unchanged one keeps its own -- which is what every signature reads.
  var STAMP = Date.UTC(2026, 8, 26, 12, 0, 0), seq = 0;
  function stamp() { seq++; return new Date(STAMP + seq * 1000).toISOString(); }
  function stateObj(id, state, attrs) {
    var t = stamp();
    return { entity_id: id, state: String(state), attributes: attrs || {},
             last_updated: t, last_changed: t };
  }
  H.stateObj = stateObj;

  // house(rows): rows is {entity_id: [state, attributes]}.
  //   h.hass()            a fresh hass object over the current states
  //   h.set(id, s, a)     change one entity (new stamp), returns a fresh hass
  //   h.calls / h.ws / h.api / h.subs   what the cards asked for
  H.house = function (rows) {
    var states = {};
    Object.keys(rows || {}).forEach(function (id) {
      states[id] = stateObj(id, rows[id][0], rows[id][1]);
    });
    var house = { calls: [], ws: [], api: [], subs: [] };
    function pending(list, entry) {
      return new Promise(function (res, rej) { entry.resolve = res; entry.reject = rej; list.push(entry); });
    }
    var readyL = [];
    var conn = {
      subscribeMessage: function (cb, msg, opts) {
        var sub = { cb: cb, msg: msg, opts: opts || {}, active: true };
        house.subs.push(sub);
        return Promise.resolve(function () { sub.active = false; return Promise.resolve(); });
      },
      // the websocket library's reconnect event
      addEventListener: function (t, f) { if (t === 'ready') readyL.push(f); },
      removeEventListener: function (t, f) { if (t === 'ready') readyL = readyL.filter(function (x) { return x !== f; }); }
    };
    house.conn = conn;
    // A RECONNECT: the server forgets every subscription; listeners hear 'ready'.
    house.reconnect = function () {
      house.subs.forEach(function (s) { s.active = false; });
      readyL.slice().forEach(function (f) { f(); });
    };
    house.readyListeners = function () { return readyL.length; };
    house.activeSubs = function () { return house.subs.filter(function (s) { return s.active; }).length; };
    house.hass = function () {
      var snap = {};
      Object.keys(states).forEach(function (k) { snap[k] = states[k]; });
      return {
        states: snap,
        config: { time_zone: 'America/New_York', location_name: 'Home' },
        connection: conn,
        connected: true,
        callService: function (d, s, data) {
          house.calls.push({ domain: d, service: s, data: data });
          return Promise.resolve();
        },
        callWS: function (msg) { return pending(house.ws, { msg: msg }); },
        callApi: function (method, path) { return pending(house.api, { method: method, path: path }); }
      };
    };
    house.set = function (id, state, attrs) {
      var prev = states[id];
      states[id] = stateObj(id, state, attrs !== undefined ? attrs : (prev ? prev.attributes : {}));
      return house.hass();
    };
    // The SAME state and attributes, a new stamp: HA does this when an
    // attribute the card does not draw moves.
    house.touch = function (id) {
      var prev = states[id];
      return house.set(id, prev.state, prev.attributes);
    };
    house.drop = function (id) { delete states[id]; return house.hass(); };
    return house;
  };

  // ---------------------------------------------------------------- a card
  // new Card(), with its render counted and its root's innerHTML recorded.
  H.make = function (tag) {
    var C = customElements.get(tag);
    if (!C) throw new Error(tag + ' is not registered');
    var card = new C();
    card.__renders = 0;
    var orig = card._render;
    card._render = function () { card.__renders++; return orig.apply(this, arguments); };
    if (card._root) H.record(card._root);
    return card;
  };

  // Lovelace's order: attach to a parent, then connectedCallback.
  H.attach = function (card) {
    if (!card.parentNode) card.parentNode = new El('div');
    card.isConnected = true;
    if (card.connectedCallback) card.connectedCallback();
  };
  H.detach = function (card) {
    card.isConnected = false;
    if (card.disconnectedCallback) card.disconnectedCallback();
  };

  // Everything a card can leave behind that outlives it.
  function winListeners() {
    var n = 0;
    try { Object.keys(__winL).forEach(function (k) { n += __winL[k].length; }); } catch (e) {}
    return n;
  }
  function docListeners() {
    var n = 0, l = document.__l || {};
    Object.keys(l).forEach(function (k) { n += l[k].length; });
    return n;
  }
  H.snapshot = function (house) {
    return {
      timers: H.timers(),
      window: winListeners(),
      document: docListeners(),
      resize: H.observed(),
      subs: house ? house.activeSubs() : 0
    };
  };
  H.glassHas = function (card) {
    return !!(window.__hkGlassCards && window.__hkGlassCards.has(card));
  };

  // THE LIFECYCLE CONTRACT, the same for every card: attach (it may join the
  // shared glass), detach (it must leave it and give back every timer,
  // listener, observer and subscription it took), re-attach, detach again --
  // none of it throwing, and the house left exactly as it was found.
  // `during(card)` runs while attached (a hass push, say).
  H.lifecycle = function (name, card, house, during) {
    var before = H.snapshot(house), err = null;
    try {
      H.attach(card);
      if (during) during(card);
    } catch (e) { err = e; }
    H.ok(name + ': attach does not throw', !err, err && String(err));
    var joined = H.glassHas(card);
    H.ok(name + ': an attached card joins the shared glass', joined);
    err = null;
    try { H.detach(card); } catch (e) { err = e; }
    H.ok(name + ': detach does not throw', !err, err && String(err));
    return H.tick().then(function () {
      H.ok(name + ': detached card has left the shared glass', !H.glassHas(card));
      H.eq(name + ': nothing left behind after detach', H.snapshot(house), before);
      err = null;
      try { H.attach(card); if (during) during(card); } catch (e) { err = e; }
      H.ok(name + ': re-attach does not throw', !err, err && String(err));
      H.ok(name + ': re-attached card is back in the glass as before', H.glassHas(card) === joined);
      try { H.detach(card); } catch (e) { err = e; }
      return H.tick();
    }).then(function () {
      H.eq(name + ': nothing left behind after the second detach', H.snapshot(house), before);
      return joined;
    });
  };

  // THE RENDER GATE, from the outside: an unrelated entity must neither move
  // the signature nor redraw; a relevant one must do both. `sig` reads the
  // card's gate (HkBase: _sigOf(); the control cards keep _signature).
  H.gate = function (name, card, house, relevant, unrelated, sig) {
    sig = sig || function (c) { return c._sigOf(); };
    var s0 = sig(card), r0 = card.__renders;
    H.ok(name + ': the signature is not null (the gate is on)', s0 !== null && s0 !== undefined, s0);
    card.hass = unrelated();
    H.eq(name + ': an unrelated entity leaves the signature alone', sig(card), s0);
    H.eq(name + ': ...and does not redraw', card.__renders - r0, 0);
    card.hass = relevant();
    var s1 = sig(card);
    H.ok(name + ': a relevant entity moves the signature', s1 !== s0, s1);
    H.eq(name + ': ...and redraws once', card.__renders - r0, 1);
    return s1;
  };
})();
