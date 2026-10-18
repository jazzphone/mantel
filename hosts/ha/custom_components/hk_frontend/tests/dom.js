// --- minimal DOM shim, enough to run an hk card for real ---
// `style` is a plain bag so `el.style.opacity = '0.35'` works, plus the two
// CSS-custom-property methods the cards actually call. Non-enumerable, so
// anything walking Object.keys(style) still sees only the properties that
// were set -- which is what the render tests compare.
function Style() {}
Object.defineProperty(Style.prototype, 'setProperty', { enumerable: false,
  value: function (k, v) { this[k] = v; } });
Object.defineProperty(Style.prototype, 'removeProperty', { enumerable: false,
  value: function (k) { delete this[k]; } });
Object.defineProperty(Style.prototype, 'getPropertyValue', { enumerable: false,
  value: function (k) { return this[k] === undefined ? '' : this[k]; } });

var _defined = {};
globalThis.customElements = {
  define: function (n, c) { _defined[n] = c; },
  get: function (n) { return _defined[n]; }
};
function El(tag) {
  this.tagName = tag; this.children = []; this.attrs = {}; this.style = new Style();
  this._text = ''; this._listeners = {}; this.className = '';
}
El.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
El.prototype.replaceChild = function (nu, old) {
  var i = this.children.indexOf(old);
  if (i < 0) return old;
  this.children[i] = nu; nu.parentNode = this; old.parentNode = null; return old;
};
El.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; });
  c.parentNode = null; return c;
};
// append() sets parentNode too, as the real DOM does: without it _remountLive
// (it guards on slot.el.parentNode) looks broken when the card is fine. A
// shim bug that reads as a card bug is the worst kind.
El.prototype.append = function () {
  for (var i=0;i<arguments.length;i++) { this.children.push(arguments[i]);
                                        arguments[i].parentNode = this; }
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); };
El.prototype.removeEventListener = function (t, f) { this._listeners[t] = (this._listeners[t] || []).filter(function (listener) { return listener !== f; }); };
El.prototype.click = function () { (this._listeners.click || []).forEach(function (f) { f({}); }); };
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._text; }, set: function (v) { this._text = String(v); }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return ''; }, set: function (v) { this.children = []; }
});
// querySelector, memoised per selector. innerHTML does not PARSE here, so
// there is nothing real to find -- but a card that builds its markup as a
// string and then reaches for its parts by selector is a shape this shim has
// to model or those cards cannot be tested at all. Each selector resolves to
// one stable stub, which is exactly the contract the card depends on: ask
// twice, get the same element.
El.prototype.querySelector = function (sel) {
  this.__q = this.__q || {};
  if (!this.__q[sel]) {
    var e = new El('stub');
    e.__sel = sel; e.parentNode = this;
    this.__q[sel] = e;
  }
  return this.__q[sel];
};
// Every selector resolves to one stub above, so there is no tree to walk and
// nothing to return here. Cards call it to wire optional controls (segments,
// mode buttons); an empty list is the honest answer and stops _bind throwing.
El.prototype.querySelectorAll = function () { return []; };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.hasAttribute = function (k) { return this.attrs[k] !== undefined; };
// A stub element has a parentNode (the node it was queried from), but cards
// that wrap a control also read parentElement -- hk-control's slider binds its
// pointer handlers to the wrapper, not the <input>. Same node, real name.
Object.defineProperty(El.prototype, 'parentElement',
  { get: function () { return this.parentNode || null; } });
globalThis.document = { createElement: function (t) { return new El(t); } };
// jsc has no console.
globalThis.console = globalThis.console || {
  log: function () {}, warn: function () {}, error: function () {}
};
globalThis.HTMLElement = function () {
  this.children = []; this._listeners = {}; this.style = new Style();
  this.shadowRoot = null;
  // ATTRIBUTES AND TEXT, so anything driven BY its attributes --
  // <hk-countdown>, which reads deadline/hold/since off itself -- is tested as
  // it is rather than extracted and re-implemented in the suite. That would be
  // the duplicate source of truth these suites exist to avoid.
  this.attrs = {};
  this._text = '';
  // Real elements are not connected until something appends them, and
  // attributeChangedCallback checks this before repainting.
  this.isConnected = false;
};
HTMLElement.prototype.attachShadow = function () {
  this.shadowRoot = new El('#shadow'); this.shadowRoot.adoptedStyleSheets = [];
  return this.shadowRoot;
};
HTMLElement.prototype.appendChild = El.prototype.appendChild;
HTMLElement.prototype.replaceChild = El.prototype.replaceChild;
HTMLElement.prototype.removeChild = El.prototype.removeChild;
HTMLElement.prototype.querySelector = El.prototype.querySelector;
HTMLElement.prototype.querySelectorAll = El.prototype.querySelectorAll;
HTMLElement.prototype.setAttribute = El.prototype.setAttribute;
HTMLElement.prototype.removeAttribute = El.prototype.removeAttribute;
HTMLElement.prototype.hasAttribute = El.prototype.hasAttribute;
// toggleAttribute, as the browser has it: force wins, else flip.
HTMLElement.prototype.toggleAttribute = function (k, force) {
  var on = force === undefined ? !this.hasAttribute(k) : !!force;
  if (on) this.setAttribute(k, ''); else this.removeAttribute(k);
  return on;
};
HTMLElement.prototype.addEventListener = El.prototype.addEventListener;
HTMLElement.prototype.removeEventListener = El.prototype.removeEventListener;
// getAttribute returns NULL here, not undefined, and that difference is the
// whole reason this is spelled out instead of borrowed from El: browsers
// return null for a missing attribute, and a shim that returns undefined lets
// a `!== null` guard pass in the suite and fail in a browser.
HTMLElement.prototype.getAttribute = function (k) {
  return this.attrs[k] === undefined ? null : this.attrs[k];
};
Object.defineProperty(HTMLElement.prototype, 'textContent', {
  get: function () { return this._text; }, set: function (v) { this._text = String(v); }
});
Object.defineProperty(HTMLElement.prototype, 'parentElement',
  { get: function () { return this.parentNode || null; } });
// localStorage, and a switch to make it THROW like a private window or a
// browser set to block site data does -- the snapshot cache must survive that,
// and "it is wrapped in try/catch" is only true if something tests it.
var __ls = {};
globalThis.__lsThrows = false;
globalThis.localStorage = {
  getItem: function (k) {
    if (globalThis.__lsThrows) throw new Error('SecurityError');
    return Object.prototype.hasOwnProperty.call(__ls, k) ? __ls[k] : null;
  },
  setItem: function (k, v) {
    if (globalThis.__lsThrows) throw new Error('QuotaExceededError');
    __ls[k] = String(v);
  },
  removeItem: function (k) { delete __ls[k]; },
  clear: function () { __ls = {}; }
};
globalThis.__lsDump = function () { return __ls; };

// A canvas, enough of one for the thumbnail path: the cache draws the loaded
// image into it and reads a data URL back out.
globalThis.__canvasCalls = [];
globalThis.__blitCalls = [];
globalThis.__canvasTaints = false;
var __origCreate = document.createElement;
document.createElement = function (t) {
  var el = __origCreate.call(document, t);
  if (String(t).toLowerCase() === 'canvas') {
    el.getContext = function () {
      return { drawImage: function (img, x, y, w, h) {
        // The 9-argument form is the camera strip painting a tile (source
        // crop -> canvas); it is kept apart so the thumbnail tests, which
        // count the 5-argument form, see only their own calls.
        if (arguments.length === 9) {
          globalThis.__blitCalls.push({ img: img, sx: arguments[1], sy: arguments[2],
            sw: arguments[3], sh: arguments[4], W: arguments[7], H: arguments[8] });
          return;
        }
        globalThis.__canvasCalls.push({ w: w, h: h });
      } };
    };
    el.toDataURL = function (type, q) {
      if (globalThis.__canvasTaints) throw new Error('SecurityError: tainted');
      return 'data:' + (type || 'image/png') + ';base64,AAAA' + (q || '');
    };
  }
  return el;
};

globalThis.CSSStyleSheet = function () { this.replaceSync = function () {}; };
globalThis.window = globalThis;
globalThis.location = { assign: function (u) { globalThis.__nav = u; } };

// --- walk helpers ---
function walk(n, out) {
  out = out || [];
  (n.children || []).forEach(function (c) { out.push(c); walk(c, out); });
  return out;
}
globalThis.walk = walk;
globalThis.pills = function (card) {
  return walk(card.shadowRoot).filter(function (e) {
    return typeof e.className === 'string' && e.className.indexOf('pill') === 0;
  });
};
globalThis.tiles = function (card) {
  return walk(card.shadowRoot).filter(function (e) { return e.className === 'tile'; });
};
globalThis.labelOf = function (el) {
  var t = walk(el).filter(function (c) { return c._text; });
  return t.length ? t[t.length-1]._text : '';
};
globalThis.Event = function (t, o) { this.type = t; Object.assign(this, o || {}); };
globalThis.CustomEvent = function (t, o) { this.type = t; this.detail = (o||{}).detail; };
// A real (tiny) window event bus. A no-op dispatchEvent only works while no
// card listens on window, and the camera strip listens for `hk-popup-change`.
var __winL = {};
globalThis.addEventListener = function (t, f) { (__winL[t] = __winL[t] || []).push(f); };
globalThis.removeEventListener = function (t, f) {
  __winL[t] = (__winL[t] || []).filter(function (x) { return x !== f; });
};
globalThis.dispatchEvent = function (e) {
  (__winL[e && e.type] || []).slice().forEach(function (f) { f(e); });
  return true;
};

// ---- timers / rAF ----------------------------------------------------------
// jsc has none of these; every browser does. Controllable so a test can drive
// the refresh loop by hand instead of waiting ten seconds.
var __timers = [];
function setInterval(fn, ms) { __timers.push({fn: fn, ms: ms}); return __timers.length; }
function clearInterval(id) { if (id) __timers[id-1] = null; }
function setTimeout(fn, ms) { return setInterval(fn, ms); }
function clearTimeout(id) { clearInterval(id); }
function requestAnimationFrame(fn) { /* run later, on demand */ __timers.push({fn:fn, ms:0}); return __timers.length; }
function __runTimers() { __timers.filter(Boolean).forEach(function (t) { t.fn(); }); }
function __timerCount() { return __timers.filter(Boolean).length; }
function __resetTimers() { __timers = []; }

// IntersectionObserver, enough of it to drive _watchReveal by hand. The real
// one also fires on observe() with the initial state; this one does not, which
// is why the card must not depend on that (it does not -- cold slots are
// _tick's job and the observer returns early for them).
var __ios = [];
function IntersectionObserver(cb) { this._cb = cb; this._els = []; __ios.push(this); }
IntersectionObserver.prototype.observe = function (el) { this._els.push(el); };
IntersectionObserver.prototype.unobserve = function (el) {
  this._els = this._els.filter(function (e) { return e !== el; });
};
IntersectionObserver.prototype.disconnect = function () { this._els = []; };
function __observedCount() {
  return __ios.reduce(function (n, o) { return n + o._els.length; }, 0);
}
function __fireIntersect(el, on) {
  __ios.forEach(function (o) {
    if (o._els.indexOf(el) >= 0) o._cb([{ target: el, isIntersecting: on !== false }]);
  });
}
function __resetIos() { __ios = []; }

// document.head, so a card that injects a <script> fallback can be tested for
// WHETHER it injected one -- which is the whole point of the loader test.
document.head = document.createElement('head');

// document-level listeners + visibility, also absent from jsc
document.addEventListener = function (n, fn) {
  (document.__l = document.__l || {})[n] = (document.__l[n] || []).concat([fn]);
};
document.removeEventListener = function (n, fn) {
  if (!document.__l || !document.__l[n]) return;
  document.__l[n] = document.__l[n].filter(function (f) { return f !== fn; });
};
// a document-level event (a page scroll is fired at the document)
document.dispatchEvent = function (e) {
  ((document.__l || {})[e.type] || []).forEach(function (f) { f(e); });
  return true;
};
document.hidden = false;
function __fireVisibility(hidden) {
  document.hidden = !!hidden;
  ((document.__l || {})['visibilitychange'] || []).forEach(function (f) { f(); });
}

// classList, absent from the shim's elements
(function () {
  var proto = document.createElement('div').constructor;
  if (proto && proto.prototype && !('classList' in proto.prototype)) {
    Object.defineProperty(proto.prototype, 'classList', {
      get: function () {
        var el = this;
        if (!el.__cl) el.__cl = {
          _s: function () { return (el.className || '').split(/\s+/).filter(Boolean); },
          add: function (c) { var a = this._s(); if (a.indexOf(c) < 0) a.push(c); el.className = a.join(' '); },
          remove: function (c) { el.className = this._s().filter(function (x) { return x !== c; }).join(' '); },
          contains: function (c) { return this._s().indexOf(c) >= 0; },
          // `force`, as the real one takes: toggle(c, true) ADDS, never flips.
          // Without it every `classList.toggle('on', isOn)` in a card would
          // flip on each paint, and a suite reading classes would read noise.
          toggle: function (c, force) {
            var on = force === undefined ? !this.contains(c) : !!force;
            if (on) this.add(c); else this.remove(c);
            return on;
          }
        };
        return el.__cl;
      }
    });
  }
})();

// devicePixelRatio, for the snapshot-size math
if (typeof window !== 'undefined' && window.devicePixelRatio === undefined) {
  window.devicePixelRatio = 1;
}

// Run only the timers shorter than `ms`. Lets a test drive the request
// stagger (~220ms steps) without also firing the 8s hang-release or the 10s
// refresh interval, which would confuse what is being asserted.
function __runTimersUnder(ms) {
  __timers.filter(Boolean).filter(function (t) { return t.ms < ms; })
          .forEach(function (t) { t.fn(); });
}
