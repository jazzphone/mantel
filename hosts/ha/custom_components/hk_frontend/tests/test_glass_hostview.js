// hk-glass.js ON A HOST WITHOUT HOME ASSISTANT'S VIEW (Mantel, 2026-10-20).
// HK's view host (shell/hk-view-host.js) puts each view straight into the
// host's view container, and the sky goes into that same container, before
// the view: hk-view-container > [sky (fixed, z-index -1), hk-grid-view].
// The shared blur's page layer (z-index -1 as well) is painted after the sky
// only when it comes after it in the tree. Its anchor is the VIEW ELEMENT,
// found by the host shell's view kinds (viewTags). Mantel's shell named
// none: the anchor fell back to the container, the layer went in as its
// first child -- before the sky, painted under it -- and Shared Layer and
// Pre-rendered left every pill on the page clear while the sideways rows
// (layers of their own, inside the view) were frosted. Each Card blurs on
// the card and never saw it.
//
// MANTEL_VIEW_TAGS is what web/shim/mantel-shell.js declares (pinned there by
// tests/test_mantel_shell_views_js.py, which reads this line).
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var MANTEL_VIEW_TAGS = ['hk-grid-view', 'hk-view-fallback'];

// ---- frames and timers (a virtual clock) -----------------------------------
var T = 0, timers = [], tid = 0, rafq = [];
function setTimeout(fn, ms) { var id = ++tid; timers.push({ id: id, at: T + (ms || 0), fn: fn, iv: 0 }); return id; }
function setInterval(fn, ms) { var id = ++tid; timers.push({ id: id, at: T + ms, fn: fn, iv: ms }); return id; }
function clearTimeout(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
var clearInterval = clearTimeout;
function requestAnimationFrame(fn) { rafq.push(fn); return rafq.length; }
function cancelAnimationFrame() {}
var performance = { now: function () { return T; } };
function frame() {
  T += 11;
  for (;;) {
    var due = timers.filter(function (t) { return t.at <= T; }).sort(function (a, b) { return a.at - b.at; })[0];
    if (!due) break;
    if (due.iv) due.at += due.iv; else timers = timers.filter(function (t) { return t !== due; });
    due.fn();
  }
  var q = rafq; rafq = []; q.forEach(function (f) { f(T); });
}
function advance(ms) { var end = T + ms; while (T < end) frame(); }
globalThis.console = globalThis.console || { log: print, warn: print, error: print };
globalThis.window = globalThis;

// ---- elements with boxes ---------------------------------------------------
function Style() {}
Object.defineProperty(Style.prototype, 'setProperty', { enumerable: false, value: function (k, v) { this[k] = v; } });
Object.defineProperty(Style.prototype, 'getPropertyValue', { enumerable: false, value: function (k) { return this[k] || ''; } });
Object.defineProperty(Style.prototype, 'removeProperty', { enumerable: false, value: function (k) { delete this[k]; } });
var DOCUMENT_NODE = { nodeType: 9 };
function E(tag, cs, rect) {
  this.tagName = tag; this.localName = tag.toLowerCase(); this.nodeType = 1; this.children = []; this.parentNode = null;
  this.shadowRoot = null; this.style = new Style(); this.attrs = {}; this._cs = cs || {}; this._rect = rect || null;
  this.scrollLeft = 0; this.scrollTop = 0; this.clientLeft = 0; this.clientTop = 0; this.currentCSSZoom = 1;
}
function SR(host) { this.nodeType = 11; this.host = host; this.children = []; this.parentNode = null; }
[E, SR].forEach(function (C) {
  C.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c; };
  C.prototype.insertBefore = function (c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    var i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentNode = this; return c;
  };
  C.prototype.removeChild = function (c) { this.children = this.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
  Object.defineProperty(C.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
  C.prototype.querySelectorAll = function () {
    var out = [];
    (function w(n) { n.children.forEach(function (c) { out.push(c); w(c); }); })(this);
    return out;
  };
  C.prototype.contains = function (x) { for (var n = x; n; n = n.parentNode) if (n === this) return true; return false; };
});
E.prototype.attachShadow = function () { this.shadowRoot = new SR(this); return this.shadowRoot; };
E.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
E.prototype.getAttribute = function (k) { return k in this.attrs ? this.attrs[k] : null; };
E.prototype.hasAttribute = function (k) { return k in this.attrs; };
E.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
Object.defineProperty(E.prototype, 'isConnected', { get: function () {
  for (var n = this; n; n = n.nodeType === 11 ? n.host : n.parentNode) if (n === DOCUMENT_NODE) return true;
  return false;
} });
E.prototype.getBoundingClientRect = function () {
  if (!this.isConnected || !this._rect) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  var r = this._rect;
  return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, width: r.w, height: r.h };
};
['scrollWidth', 'clientWidth', 'offsetWidth'].forEach(function (k) {
  Object.defineProperty(E.prototype, k, { get: function () { return this._rect ? this._rect.w : 0; } });
});
Object.defineProperty(E.prototype, 'scrollHeight', { get: function () { return this._rect ? this._rect.h : 0; } });
function getComputedStyle(el) {
  var c = el._cs || {};
  return {
    position: c.position || 'static', overflowX: c.overflowX || 'visible', overflowY: c.overflowY || 'visible',
    transform: 'none', borderTopLeftRadius: c.radius || '0px', display: 'block', visibility: 'visible',
    getPropertyValue: function (k) { return k === '--hk-glass-surface' ? (c.glass ? ' 1' : ' 0') : ''; }
  };
}
var HTML = new E('HTML'), BODY = new E('BODY');
HTML.parentNode = DOCUMENT_NODE; HTML.appendChild(BODY);
var document = {
  documentElement: HTML, body: BODY, hidden: false,
  createElement: function (t) { return new E(t.toUpperCase()); },
  addEventListener: function () {}, removeEventListener: function () {}
};
window.addEventListener = function () {};
window.removeEventListener = function () {};
window.devicePixelRatio = 1.5;
window.innerWidth = 1280; window.innerHeight = 800;
function ResizeObserver() {}
ResizeObserver.prototype.observe = ResizeObserver.prototype.unobserve = ResizeObserver.prototype.disconnect = function () {};
var LOOK = 'blur', settingsL = [];
window.hkSettings = { glass: function () { return LOOK; }, onChange: function (fn) { settingsL.push(fn); } };
function setLook(l) { LOOK = l; settingsL.forEach(function (f) { f(); }); }

// ---- Mantel's page ---------------------------------------------------------
// #view (hk-view-container: position relative, the view slot) holding the
// sky first and then the view the view host appended
var CONTAINER = new E('HK-VIEW-CONTAINER', { position: 'relative' }, { x: 0, y: 0, w: 1280, h: 2000 });
BODY.appendChild(CONTAINER);
var SKY = new E('DIV', { position: 'fixed' }, { x: 0, y: 0, w: 1280, h: 800 });
CONTAINER.appendChild(SKY);
window.hkShell.use({
  kind: 'mantel', viewTags: MANTEL_VIEW_TAGS, tags: { viewContainer: 'hk-view-container' },
  viewContainer: function () { return CONTAINER; }, viewSlot: function () { return CONTAINER; },
  onDashboard: function () { return true; }, isDashboard: function () { return true; }
});
function gridView() {
  var v = new E('HK-GRID-VIEW', {}, { x: 0, y: 0, w: 1280, h: 2000 }); v.attachShadow();
  CONTAINER.appendChild(v);
  return v;
}
function card(rect) {
  var c = new E('HK-TILE-CARD', {}, rect); c.attachShadow();
  c.shadowRoot.appendChild(new E('HK-PLATE', { glass: 1, radius: '23.5px' }, rect));
  return c;
}
function row(parent, y) {
  var host = new E('HK-ROW-CARD', { position: 'relative' }, { x: 0, y: y, w: 1280, h: 104 }); host.attachShadow();
  var r = new E('DIV', { position: 'relative', overflowX: 'auto', overflowY: 'hidden' }, { x: 0, y: y, w: 1280, h: 104 });
  host.shadowRoot.appendChild(r); parent.appendChild(host);
  return r;
}
var GL = window.__hkGlassCards = new Set();
function add(parent, c) { parent.appendChild(c); GL.add(c); if (window.hkGlass) window.hkGlass.changed(c, true); return c; }
function leaveAll() { Array.from(GL).forEach(function (c) { GL.delete(c); if (window.hkGlass) window.hkGlass.changed(c, false); }); }
function isLayer(n) { return n.hasAttribute && n.hasAttribute('data-hk-glass-layer'); }
// THE ORDER THE BROWSER PAINTS the container's z-index -1 children in: the
// rendered (flat) tree -- a shadow host draws its shadow tree
function painted(n, out) {
  out = out || [];
  (n.shadowRoot || n).children.forEach(function (c) { out.push(c); painted(c, out); });
  return out;
}
function layersOf(n) { return painted(n).filter(isLayer); }

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

load(HK_ROOT + '/frontend/modules/hk-glass.js');
var G = window.hkGlass;

// ---------------------------------------------------------------------------
print('=== Shared Layer: the page\'s layer is in the view, after the sky ===');
var V = gridView();
for (var i = 0; i < 6; i++) add(V.shadowRoot, card({ x: 20 + i * 204, y: 300, w: 192, h: 70 }));
var R = row(V.shadowRoot, 120);
add(R, card({ x: 20, y: 130, w: 120, h: 44 })); add(R, card({ x: 150, y: 130, w: 120, h: 44 }));
advance(100);
var order = painted(CONTAINER), page = layersOf(V).filter(function (l) { return l.parentNode === V.shadowRoot; });
ok('the shell names Mantel\'s view kinds', JSON.stringify(window.hkShell.viewTags) === JSON.stringify(MANTEL_VIEW_TAGS), window.hkShell.viewTags);
ok('the pills\' layer lives in the view (hk-grid-view), not the container', page.length === 1 &&
   CONTAINER.children.filter(isLayer).length === 0, CONTAINER.children.map(function (c) { return c.tagName; }));
ok('...so it is painted after the sky (it was painted under it: no frost on any pill)',
   page.length === 1 && order.indexOf(page[0]) > order.indexOf(SKY), [order.indexOf(page[0]), order.indexOf(SKY)]);
ok('...cut to the six pills', page.length === 1 && (page[0].style.clipPath.match(/M/g) || []).length >= 6, page[0] && page[0].style.clipPath);
ok('the chips row keeps a layer of its own, in the row, after the sky too',
   R.children.filter(isLayer).length === 1 && order.indexOf(R.children.filter(isLayer)[0]) > order.indexOf(SKY));

print('\n=== Pre-rendered: the same layers, the same place ===');
setLook('blur_pre'); advance(100);
order = painted(CONTAINER); page = layersOf(V).filter(function (l) { return l.parentNode === V.shadowRoot; });
ok('the pills\' layer in the view, after the sky', page.length === 1 && order.indexOf(page[0]) > order.indexOf(SKY) &&
   CONTAINER.children.filter(isLayer).length === 0);
setLook('blur'); advance(100);

print('\n=== another page: its view, its layer ===');
V.remove(); leaveAll(); advance(100);
var V2 = gridView();
add(V2.shadowRoot, card({ x: 20, y: 300, w: 192, h: 70 }));
advance(100);
order = painted(CONTAINER); page = layersOf(V2).filter(function (l) { return l.parentNode === V2.shadowRoot; });
ok('the new view carries the layer, after the sky', page.length === 1 && order.indexOf(page[0]) > order.indexOf(SKY) &&
   CONTAINER.children.filter(isLayer).length === 0, CONTAINER.children.map(function (c) { return c.tagName; }));

print('\n=== a view of another type: the view host\'s fallback (its cards in its light tree) ===');
V2.remove(); leaveAll(); advance(100);
var FB = new E('HK-VIEW-FALLBACK', {}, { x: 0, y: 0, w: 1280, h: 2000 });
CONTAINER.appendChild(FB);
add(FB, card({ x: 20, y: 300, w: 192, h: 70 }));
advance(100);
order = painted(CONTAINER);
var fl = FB.children.filter(isLayer);
ok('its layer is in the fallback view, after the sky', fl.length === 1 && order.indexOf(fl[0]) > order.indexOf(SKY) &&
   CONTAINER.children.filter(isLayer).length === 0, CONTAINER.children.map(function (c) { return c.tagName; }));
FB.remove(); leaveAll(); advance(100);
ok('a page gone: its layer gone with it', layersOf(CONTAINER).length === 0 && G.stats().layers === 0, G.stats());

print(fail ? 'FAIL ' + fail + ' GLASS HOST VIEW TESTS' : 'ALL ' + pass + ' GLASS HOST VIEW TESTS PASS');
if (fail) throw new Error('glass host view tests failed');
