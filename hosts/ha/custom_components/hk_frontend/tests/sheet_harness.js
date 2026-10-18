// THE SHEET HARNESS (Phase 2 P2.5) -- what test_sheets.js (Home Assistant's shell) and
// test_sheets_mantel.js (a host with no detail and no toasts of its own) share: the DOM shim of
// test_detail_behaviour.js (custom tags made as their classes, innerHTML kept, a history whose
// back() is async), a holder for the frontend's object the HA client adapter reads the client
// from, and a more-info request as a card makes it. Load AFTER tests/dom.js. Not a suite.
(function () {
  'use strict';
  function aug(el) {
    Object.defineProperty(el, 'innerHTML', { configurable: true,
      get: function () { return this._html || ''; },
      set: function (v) { this.children = []; this._html = String(v); this.__q = {}; } });
    return el;
  }
  var ce = document.createElement;
  var El0 = ce.call(document, 'div').constructor;
  document.createElement = function (t) {
    var K = customElements.get(String(t).toLowerCase());
    if (K) {
      var k = new K(); k.tagName = String(t).toUpperCase();
      if (!k.classList) k.classList = ce.call(document, 'div').classList;
      return k;
    }
    return aug(ce.call(document, t));
  };
  El0.prototype.querySelector = function (sel) {
    this.__q = this.__q || {};
    if (!this.__q[sel]) { var e = aug(new El0('stub')); e.__sel = sel; e.parentNode = this; this.__q[sel] = e; }
    return this.__q[sel];
  };
  El0.prototype.insertBefore = function (el, ref) {
    var i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? 0 : i, 0, el); el.parentNode = this; return el;
  };
  HTMLElement.prototype.querySelector = El0.prototype.querySelector;
  var as = HTMLElement.prototype.attachShadow;
  HTMLElement.prototype.attachShadow = function () { var r = as.apply(this, arguments); aug(r); this.shadowRoot = r; return r; };

  // ---- history / location (back() is async: popstate fires on flushPops)
  var HIST = globalThis.HIST = { stack: [{ state: null, url: 'http://ha/dashboard-kitchen/0' }], i: 0, pops: [] };
  globalThis.resetHistory = function () { HIST.stack = [{ state: null, url: 'http://ha/dashboard-kitchen/0' }]; HIST.i = 0; HIST.pops = []; };
  globalThis.location = {
    get href() { return HIST.stack[HIST.i].url; },
    get pathname() { return HIST.stack[HIST.i].url.replace(/^http:\/\/ha/, '').split('#')[0]; },
    get hash() { var u = HIST.stack[HIST.i].url, k = u.indexOf('#'); return k < 0 ? '' : u.slice(k); },
    host: 'ha'
  };
  globalThis.history = {
    get state() { return HIST.stack[HIST.i].state; },
    pushState: function (s, t, u) {
      HIST.stack = HIST.stack.slice(0, HIST.i + 1);
      HIST.stack.push({ state: s == null ? null : JSON.parse(JSON.stringify(s)), url: u }); HIST.i++;
    },
    replaceState: function (s, t, u) { HIST.stack[HIST.i] = { state: s == null ? null : s, url: u }; },
    back: function () {
      HIST.pops.push(function () { if (HIST.i > 0) { HIST.i--; dispatchEvent({ type: 'popstate' }); } });
    }
  };
  globalThis.flushPops = function () { var p = HIST.pops; HIST.pops = []; p.forEach(function (f) { f(); }); };

  // ---- the frontend's object, where the HA client adapter reads the current client from; an
  // event fired at it is recorded and goes on up to the window (bubbling, composed)
  var HA = globalThis.HA = { hass: null, shadowRoot: aug(ce.call(document, '#shadow')), got: [] };
  HA.dispatchEvent = function (e) { HA.got.push(e); dispatchEvent(e); return true; };
  document.querySelector = function (sel) { return sel === 'home-assistant' ? HA : null; };
  document.body = document.createElement('body');
  globalThis.matchMedia = function () { return { matches: false }; };
  globalThis.WeakRef = globalThis.WeakRef || function (o) { this.deref = function () { return o; }; };
  globalThis.requestAnimationFrame = function (fn) { __timers.push({ fn: fn, ms: 0, raf: true }); return __timers.length; };
  // run (once) the queued timers that match; new ones queued meanwhile wait
  globalThis.fire = function (pred) {
    var due = [];
    __timers.forEach(function (t, i) { if (t && pred(t)) { due.push(t); __timers[i] = null; } });
    due.forEach(function (t) { t.fn(); });
  };

  var pass = 0, fail = 0;
  globalThis.ok = function (n, c, d) {
    if (c) { pass++; print('  PASS  ' + n); }
    else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); }
  };
  globalThis.sheetResult = function (label) {
    print('');
    if (fail) { print('  FAIL ' + fail + ' ' + label + ' TESTS'); throw new Error(label + ' tests failed'); }
    print('  ALL ' + pass + ' ' + label + ' TESTS PASS');
  };

  // ---- a house as the frontend holds it: states, the user, the formatters, and every service
  // call recorded (never sent anywhere)
  globalThis.CALLS = [];
  globalThis.house = function (map, opts) {
    opts = opts || {};
    var states = {};
    Object.keys(map).forEach(function (id) {
      states[id] = { entity_id: id, state: map[id][0], attributes: map[id][1] || {},
                     last_updated: 't1', last_changed: '2026-10-18T12:00:00+00:00' };
    });
    return {
      states: states, entities: {}, devices: {}, areas: {},
      user: { id: 'u1', name: 'Test', is_admin: !!opts.admin },
      panels: { 'dashboard-kitchen': { component_name: 'lovelace' } },
      formatEntityState: function (s) { return 'F:' + s.state; },
      formatEntityAttributeName: function (s, a) { return 'N:' + a; },
      formatEntityAttributeValue: function (s, a) { return 'V:' + String(s.attributes[a]); },
      callService: function (d, s, data) { CALLS.push(d + '.' + s + ' ' + (data && data.entity_id)); return Promise.resolve(); }
    };
  };

  // A more-info request as a card makes it (hkShell.moreInfo from an hk card on a dashboard),
  // through the window's listeners: `path` the composed path's tag names. Says whether HK took it.
  globalThis.request = function (type, id, path) {
    var e = {
      type: type, detail: { entityId: id }, taken: false,
      composedPath: function () { return (path || []).map(function (t) { return { tagName: t }; }); },
      stopPropagation: function () { this.taken = true; },
      stopImmediatePropagation: function () { this.taken = true; }
    };
    dispatchEvent(e);
    return e;
  };
})();
