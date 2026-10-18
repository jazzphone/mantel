// hk-glass.js BEHAVIOR: the shared blur run for real against a small DOM
// that has geometry, with a virtual clock, timers and animation frames.
// test_glass.js checks the pure helpers and the source; this checks what the
// module DOES -- the hold and release of a new view, the press loop, the
// layer sizes, the row promotions -- each case a specific failure mode, so a
// regression that brings one back fails here.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');

// ---- clock, timers, frames -------------------------------------------------
var T = 0, timers = [], tid = 0, rafq = [];
function setTimeout(fn, ms) { var id = ++tid; timers.push({ id: id, at: T + (ms || 0), fn: fn, iv: 0 }); return id; }
function setInterval(fn, ms) { var id = ++tid; timers.push({ id: id, at: T + ms, fn: fn, iv: ms }); return id; }
function clearTimeout(id) { timers = timers.filter(function (t) { return t.id !== id; }); }
var clearInterval = clearTimeout;
function requestAnimationFrame(fn) { rafq.push(fn); return rafq.length; }
function cancelAnimationFrame() {}
var performance = { now: function () { return T; } };
function runTimers() {
  for (;;) {
    var due = timers.filter(function (t) { return t.at <= T; }).sort(function (a, b) { return a.at - b.at; })[0];
    if (!due) return;
    if (due.iv) due.at += due.iv; else timers = timers.filter(function (t) { return t !== due; });
    due.fn();
  }
}
var FRAME = 11;                                  // ~90 fps, a wall tablet's rate
function frame() { T += FRAME; runTimers(); var q = rafq; rafq = []; q.forEach(function (f) { f(T); }); }
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
  this.tagName = tag; this.nodeType = 1; this.children = []; this.parentNode = null;
  this.shadowRoot = null; this.style = new Style(); this.attrs = {};
  this._cs = cs || {}; this._rect = rect || null;
  this.scrollLeft = 0; this.scrollTop = 0; this.clientLeft = 0; this.clientTop = 0;
  this.currentCSSZoom = 1;
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
  var r = typeof this._rect === 'function' ? this._rect() : this._rect;
  return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, width: r.w, height: r.h };
};
function layersIn(el) { return (el.shadowRoot || el).children.filter(function (c) { return c.hasAttribute && c.hasAttribute('data-hk-glass-layer'); }); }
// What a browser reports: the content's extent, or an absolutely positioned
// layer's far edge, whichever is larger (the layer is scrollable overflow).
Object.defineProperty(E.prototype, 'scrollWidth', { get: function () {
  var m = this._contentW || (this._rect ? this.getBoundingClientRect().width : 0);
  layersIn(this).forEach(function (l) { m = Math.max(m, parseFloat(l.style.left) + parseFloat(l.style.width)); });
  return m;
} });
Object.defineProperty(E.prototype, 'scrollHeight', { get: function () {
  var m = this._contentH || (this._rect ? this.getBoundingClientRect().height : 0);
  layersIn(this).forEach(function (l) { m = Math.max(m, parseFloat(l.style.top) + parseFloat(l.style.height)); });
  return m;
} });
Object.defineProperty(E.prototype, 'clientWidth', { get: function () { return this._rect ? this.getBoundingClientRect().width : 0; } });
Object.defineProperty(E.prototype, 'offsetWidth', { get: function () { return this._rect ? Math.round(this.getBoundingClientRect().width) : 0; } });
var computed = 0;                                // getComputedStyle calls (collect()'s cost)
function getComputedStyle(el) {
  computed++;
  var c = el._cs || {};
  return {
    position: c.position || 'static', overflowX: c.overflowX || 'visible', overflowY: c.overflowY || 'visible',
    transform: c.transform || 'none', borderTopLeftRadius: c.radius || '0px',
    getPropertyValue: function (k) { return k === '--hk-glass-surface' ? (c.glass ? ' 1' : ' 0') : ((c.vars || {})[k] || ''); }
  };
}
var docL = {};
var HTML = new E('HTML'), BODY = new E('BODY');
HTML.parentNode = DOCUMENT_NODE; HTML.appendChild(BODY);
var document = {
  documentElement: HTML, body: BODY, hidden: false,
  createElement: function (t) { return new E(t.toUpperCase()); },
  addEventListener: function (t, f) { (docL[t] = docL[t] || []).push(f); },
  removeEventListener: function (t, f) { docL[t] = (docL[t] || []).filter(function (x) { return x !== f; }); }
};
var winL = {};                                   // window's listeners, to fire by hand
window.addEventListener = function (t, f) { (winL[t] = winL[t] || []).push(f); };
window.removeEventListener = function (t, f) { winL[t] = (winL[t] || []).filter(function (x) { return x !== f; }); };
window.removeEventListener = function () {};
window.devicePixelRatio = 1.5;                   // a 1920 x 1200 tablet at 1280 x 800 CSS
// (each one kept, with what it watches, so a test can say a box changed size)
var ROS = [];
function ResizeObserver(cb) { this.cb = cb; this.els = new Set(); ROS.push(this); }
ResizeObserver.prototype.observe = function (el) { this.els.add(el); };
ResizeObserver.prototype.unobserve = function (el) { this.els.delete(el); };
ResizeObserver.prototype.disconnect = function () { this.els.clear(); };
function resized(el) { ROS.forEach(function (o) { if (o.els.has(el)) o.cb([{ target: el }]); }); }

var LOOK = 'blur', settingsL = [];
window.hkSettings = { glass: function () { return LOOK; }, onChange: function (fn) { settingsL.push(fn); } };
function setLook(l) { LOOK = l; settingsL.forEach(function (f) { f(); }); }

// A view as Home Assistant builds it: hui-view > hk-grid-view (shadow) > cards.
function view() {
  var v = new E('HUI-VIEW', {}, { x: 0, y: 0, w: 1280, h: 2000 });
  var gv = new E('HK-GRID-VIEW', {}, { x: 0, y: 0, w: 1280, h: 2000 }); gv.attachShadow();
  v.appendChild(gv);
  BODY.appendChild(v);
  return { v: v, grid: gv.shadowRoot };
}
// A card with one glass plate (rect may be a function: a press animation).
function card(rect, opts) {
  opts = opts || {};
  var c = new E('HK-TILE-CARD', {}, rect); c.attachShadow();
  if (!opts.noPlate) { var p = new E('HA-CARD', { glass: 1, radius: '23.5px' }, rect); c.shadowRoot.appendChild(p); c._plate = p; }
  return c;
}
// A sideways row (hk-row-card's .row) holding cards.
function row(parent, y) {
  var host = new E('HK-ROW-CARD', {}, { x: 0, y: y, w: 1280, h: 104 }); host.attachShadow();
  var r = new E('DIV', { overflowX: 'auto', overflowY: 'hidden' }, { x: 0, y: y, w: 1280, h: 104 });
  host.shadowRoot.appendChild(r); parent.appendChild(host);
  return r;
}
var GL = window.__hkGlassCards = new Set();
// What HkBase's glassJoin does on connect / disconnect.
function join(c) { GL.add(c); if (window.hkGlass) window.hkGlass.changed(c, true); }
function leave(c) { GL.delete(c); if (window.hkGlass) window.hkGlass.changed(c, false); }
function add(parent, c) { parent.appendChild(c); join(c); return c; }
function drop(c) { c.remove(); leave(c); }
function fire(t, ev) { (docL[t] || []).slice().forEach(function (f) { f(ev); }); }
function pathOf(el) { var out = []; for (var n = el; n && n !== DOCUMENT_NODE; n = n.nodeType === 11 ? n.host : n.parentNode) out.push(n); return out; }
function down(c, id) { fire('pointerdown', { pointerId: id, composedPath: function () { return pathOf(c._plate); } }); }
function up(id) { fire('pointerup', { pointerId: id }); }
function pathOfLayer(el, i) { var L = layersIn(el)[i || 0]; return L ? L.getAttribute('data-path') : ''; }
function hidden(v) { return v.style.visibility === 'hidden'; }

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

// ---------------------------------------------------------------------------
print('=== a view painted before hk-glass loaded is never held later ===');
// HkBase joins cards whichever loads first; here the cards are on screen first.
var V0 = view();
var c0 = card({ x: 20, y: 40, w: 192, h: 70 }); V0.grid.appendChild(c0); GL.add(c0);
globalThis.CSS = { supports: function (p, v) { return /-webkit-cross-fade/.test(v); } };   // WebKit and Chrome both
load(HK_ROOT + '/frontend/modules/hk-glass.js');
var G = window.hkGlass;
advance(100);
ok('the module starts with the blur look and frosts the view already there', G.stats().active && layersIn(V0.v).length === 1, G.stats());
add(V0.grid, card({ x: 20, y: 140, w: 192, h: 70 }));
ok('a conditional card appearing later does not hide the page', !hidden(V0.v), V0.v.style.visibility);
V0.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== a page is shown as soon as it is built, frosted from its first frame (2026-10-11) ===');
var V1 = view();
for (var i = 0; i < 6; i++) add(V1.grid, card({ x: 20 + i * 204, y: 40, w: 192, h: 70 }));
ok('a new view: never hidden, never faint', !hidden(V1.v) && !V1.v.style.opacity && !V1.v.style.animation);
frame();
ok('...its layer in place on the first frame', layersIn(V1.v).length === 1 && !hidden(V1.v));
V1.v.remove(); Array.from(GL).forEach(leave); advance(300);
var VK = view(), kc = [];
for (i = 0; i < 4; i++) kc.push(add(VK.grid, card({ x: 20 + i * 204, y: 40, w: 192, h: 70 })));
advance(400);
BODY.removeChild(VK.v); Array.from(GL).forEach(leave);            // navigated away; the page kept
advance(100);
BODY.appendChild(VK.v); kc.forEach(join);                          // and back
ok('a kept page coming back: shown at once, never faint or hidden', !VK.v.style.opacity && !hidden(VK.v), VK.v.style.opacity);
VK.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== a view on screen when the blur is switched on is never held ===');
setLook('clear'); advance(50);
var V3 = view();
add(V3.grid, card({ x: 20, y: 40, w: 192, h: 70 }));
advance(200);
ok('clear: nothing held, nothing layered', !hidden(V3.v) && layersIn(V3.v).length === 0);
setLook('blur'); advance(100);
ok('blur switched on live: the view is frosted in place', layersIn(V3.v).length === 1 && !hidden(V3.v));
add(V3.grid, card({ x: 20, y: 140, w: 192, h: 70 }));
ok('a conditional card appearing does not hide the page', !hidden(V3.v), V3.v.style.visibility);
V3.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== a tap that navigates does not run a full pass per frame ===');
var V4 = view(), taps = [];
for (i = 0; i < 20; i++) taps.push(add(V4.grid, card({ x: 20 + (i % 6) * 204, y: 40 + Math.floor(i / 6) * 82, w: 192, h: 70 })));
advance(400);
down(taps[0], 1);
var u4 = G.stats().updates; advance(88);
ok('while the card is pressed: no full pass, the press pass runs', G.stats().updates === u4 && G.stats().pressMs !== undefined,
   { updates: G.stats().updates - u4 });
up(1);
// the click navigates: the old view goes, the new one arrives
V4.v.remove(); taps.forEach(leave);
var V4b = view(); add(V4b.grid, card({ x: 20, y: 40, w: 192, h: 70 }));
var b4 = G.stats().updates; advance(330);
ok('the 300 ms tail after it runs at most the new view\'s own passes', G.stats().updates - b4 <= 3, G.stats().updates - b4);
advance(300);
ok('...and the press loop has stopped (nothing queued for the next frame)', rafq.length === 0, rafq.length);
V4b.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== a second tap inside the first one\'s release ===');
var V5 = view(), sA = 1, sB = 1;
function scaled(x, y, w, h, s) { return function () { var S = s(); return { x: x + w * (1 - S) / 2, y: y + h * (1 - S) / 2, w: w * S, h: h * S }; }; }
var A = add(V5.grid, card(scaled(20, 40, 192, 70, function () { return sA; })));
var B = add(V5.grid, card(scaled(224, 40, 192, 70, function () { return sB; })));
advance(400);
var FULL_A = 'M43.5,40', SMALL_A = 'M47.3,';      // A's first point, whole and at .96
down(A, 1); sA = 0.96; advance(150);
ok('the pressed card\'s cut-out shrinks with it', pathOfLayer(V5.v).indexOf(SMALL_A) >= 0);
up(1); down(B, 2); sB = 0.96;                    // B tapped the moment A lifts
advance(30); sA = 1; advance(22);                // A's release ends; B still held
ok('A is still followed while B is held: its cut-out is whole again', pathOfLayer(V5.v).indexOf(FULL_A) >= 0,
   pathOfLayer(V5.v).slice(0, 60));
advance(100); up(2); advance(40); sB = 1; advance(400);
ok('after both, both cut-outs are whole without waiting for the 2 s backstop',
   pathOfLayer(V5.v).indexOf(FULL_A) >= 0 && pathOfLayer(V5.v).indexOf('M247.5,40') >= 0);
V5.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== layers are sized from their shapes, never from scrollWidth ===');
var V6 = view(), r6 = row(V6.grid, 40), chips = [];
for (i = 0; i < 10; i++) chips.push(add(r6, card({ x: 10 + i * 204, y: 47, w: 192, h: 70 })));
r6._contentW = 10 + 10 * 204;
advance(300);
var w0 = parseFloat(layersIn(r6)[0].style.width);
chips.slice(5).forEach(drop); r6._contentW = 10 + 5 * 204;
advance(300);
var w1 = parseFloat(layersIn(r6)[0].style.width);
ok('a row that loses cards gives the width back (no scrolling into an empty end)',
   w0 > 2000 && w1 <= r6._contentW, { before: w0, after: w1, content: r6._contentW });
var tall = [];
for (i = 0; i < 20; i++) tall.push(add(V6.grid, card({ x: 20, y: 200 + i * 82, w: 192, h: 70 })));
advance(300);
var h0 = Math.max.apply(null, layersIn(V6.v).map(function (l) { return parseFloat(l.style.top) + parseFloat(l.style.height); }));
tall.slice(5).forEach(drop);
advance(300);
var h1 = Math.max.apply(null, layersIn(V6.v).map(function (l) { return parseFloat(l.style.top) + parseFloat(l.style.height); }));
ok('a page that gets shorter gives the height back', h1 <= 200 + 4 * 82 + 70 + 1 && h0 > h1, { before: h0, after: h1 });
V6.v.remove(); Array.from(GL).forEach(leave); advance(300);

var Bn = G._bands, topRow = [], botRow = [];
for (i = 0; i < 6; i++) topRow.push({ x: 20 + i * 204, y: 40, w: 192, h: 70, r: 23.5 });
for (i = 0; i < 6; i++) botRow.push({ x: 20 + i * 204, y: 5800, w: 192, h: 70, r: 23.5 });
var bt = Bn(topRow, 1280, 6000, 1.5), bb = Bn(botRow, 1280, 6000, 1.5);
ok('pills only at the top of a 6000 px extent: a band as tall as the pills, not the page',
   bt.length === 1 && bt[0].start === 40 && bt[0].len === 70, bt.map(function (b) { return [b.start, b.len]; }));
ok('pills only at the bottom: the band starts at them, not at 0',
   bb.length === 1 && bb[0].start === 5800 && bb[0].len * 1.5 <= 4096, bb.map(function (b) { return [b.start, b.len]; }));

// ---------------------------------------------------------------------------
print('\n=== will-change: sideways rows only, and given back ===');
var V7 = view(), r7 = row(V7.grid, 40);
var rc = add(r7, card({ x: 20, y: 47, w: 192, h: 70 }));
var own = add(r7, card({ x: 224, y: 47, w: 192, h: 70 })); own.style.willChange = 'opacity';
advance(300);
ok('a card in a sideways row gets its own layer', rc.style.willChange === 'transform' && own.style.willChange === 'transform');
var fx = new E('DIV', { position: 'fixed' }, { x: 0, y: 0, w: 1280, h: 800 });
// hk-popup's .sheet: overflow-y:auto, and overflow-x COMPUTES to auto with it
var sheet = new E('DIV', { position: 'relative', overflowX: 'auto', overflowY: 'auto' }, { x: 190, y: 100, w: 900, h: 480 });
BODY.appendChild(fx); fx.appendChild(sheet);
var sc = add(sheet, card({ x: 210, y: 170, w: 192, h: 70 }));
advance(100);
ok('a pop-up sheet\'s card is frosted in the sheet but NOT promoted',
   layersIn(sheet).length === 1 && !sc.style.willChange, { layers: layersIn(sheet).length, wc: sc.style.willChange });
V7.v.remove(); leave(rc); leave(own); advance(50);
ok('a promoted card that leaves the page gives it back at once (HA keeps the view)',
   rc.style.willChange === '' && own.style.willChange === 'opacity', [rc.style.willChange, own.style.willChange]);
setLook('clear'); advance(50);
BODY.appendChild(V7.v); GL.add(rc); GL.add(own);   // revisited in the clear look
ok('...so a revisit in the clear look carries none', rc.style.willChange === '');
V7.v.remove(); GL.delete(rc); GL.delete(own); fx.remove(); leave(sc);
setLook('blur'); advance(300);

// ---------------------------------------------------------------------------
print('\n=== cards are collected again only when they change ===');
var V8 = view(), plain = [];
for (i = 0; i < 10; i++) {
  var pc = card({ x: 0, y: 300 + i * 50, w: 1200, h: 40 }, { noPlate: true });
  for (var k = 0; k < 8; k++) pc.shadowRoot.appendChild(new E('DIV'));
  plain.push(add(V8.grid, pc));
}
var g8 = add(V8.grid, card({ x: 20, y: 40, w: 192, h: 70 }));
advance(300);
var cs0 = computed; advance(5 * 2000 + 50);       // five backstop passes at rest
ok('at rest, a pass reads no card\'s tree again (only each plate\'s radius and anchor)',
   computed - cs0 <= 5 * 2 * 2, computed - cs0);
var late = new E('HA-CARD', { glass: 1, radius: '20px' }, { x: 0, y: 300, w: 300, h: 40 });
plain[0].shadowRoot.appendChild(late);           // a card that renders its plate late
G.rendered(plain[0]);                            // (HkBase says so after every draw)
advance(50);
ok('...but a card whose tree changed is collected again: its late plate is frosted',
   (pathOfLayer(V8.v).match(/M/g) || []).length === 2, pathOfLayer(V8.v).slice(0, 80));
// A PAGE COMING BACK (Home Assistant re-attaches a cached view): its cards
// leave and join again, unchanged -- what was collected is kept, not read
// again element by element; a card that changed while away is collected.
var gParent = g8.parentNode;
g8.remove(); leave(g8); advance(50);
var cs1 = computed;
gParent.appendChild(g8); join(g8); advance(50);
var backCost = computed - cs1;
ok('...and still frosted', (pathOfLayer(V8.v).match(/M/g) || []).length === 2, pathOfLayer(V8.v).slice(0, 80));
g8.remove(); leave(g8); advance(50);
g8.shadowRoot.appendChild(new E('DIV'));          // drawn again while away
var cs2 = computed;
gParent.appendChild(g8); join(g8); advance(50);
ok('a card back with its page, unchanged: not collected again (a pass measures each plate only)', backCost <= 2 * 3, backCost);
ok('...one that changed while away is collected again', computed - cs2 > backCost, (computed - cs2) + ' vs ' + backCost);
// A CARD THAT GROWS says so itself (its own box observed): the plates below
// it are measured again on the next frame, with no backstop to wait for.
var upG = G.stats().updates;
resized(plain[3]);
advance(50);
ok('a card growing above a plate: measured again at once', G.stats().updates - upG === 1, G.stats().updates - upG);
// BEHIND THE PHOTO SCREENSAVER (an overlay: document.hidden stays false) the
// backstop has nobody to measure for: it pauses, and resumes with the screen.
var up0 = G.stats().updates;
window.hkSky = { asleep: function () { return true; } };
advance(5 * 30000 + 50);
ok('the backstop does not run while the photo screensaver is up', G.stats().updates - up0 === 0, G.stats().updates - up0);
window.hkSky.asleep = function () { return false; };
advance(30050);
ok('...and runs again once it is down', G.stats().updates - up0 >= 1, G.stats().updates - up0);
delete window.hkSky;
V8.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== a detail sheet mid-open: the scale is on the sheet, the scroller inside ===');
// hk-detail: .sheet (scale .98 while it opens, translateY 24) > .body
// (overflow-y:auto, the cards' anchor) > the group's tiles. The boxes are what
// a browser reports mid-open: the body 2% smaller, a tile 204 px in at 98%.
var dfx = new E('DIV', { position: 'fixed' }, { x: 0, y: 0, w: 1280, h: 800 });
var dsheet = new E('DIV', { position: 'relative', transform: 'matrix(0.98, 0, 0, 0.98, 0, 24)' },
                   { x: 419.2, y: 84, w: 450.8, h: 666.4 });
var dbody = new E('DIV', { position: 'relative', overflowX: 'auto', overflowY: 'auto' },
                  { x: 429, y: 142.8, w: 431, h: 588 });
BODY.appendChild(dfx); dfx.appendChild(dsheet); dsheet.appendChild(dbody);
var dt = add(dbody, card({ x: 429 + 204 * 0.98, y: 142.8 + 2 * 0.98, w: 192 * 0.98, h: 70 * 0.98 }));
advance(100);
ok('the frost is cut in the sheet\'s own layout: 204 px in, 192 wide, as the tile will be',
   /^path\('M227\.5,2H372\.5A23\.5/.test(pathOfLayer(dbody)), pathOfLayer(dbody).slice(0, 40));
ok('scaleOf multiplies the anchor\'s and its ancestors\' transforms',
   Math.abs(G._scaleOf(dbody).x - 0.98) < 1e-9 && G._scaleOf(dsheet).y === 0.98 && G._scaleOf(dfx).x === 1);
dfx.remove(); leave(dt); advance(300);

// ---------------------------------------------------------------------------
print('\n=== a plate whose row is no longer above it ===');
var V9 = view(), r9 = row(V9.grid, 40);
var mv = add(r9, card({ x: 20, y: 47, w: 192, h: 70 }));
advance(300);
var plainDiv = new E('DIV', {}, { x: 0, y: 200, w: 1280, h: 100 }); V9.grid.appendChild(plainDiv);
plainDiv.children.push(mv); mv.parentNode.removeChild(mv); mv.parentNode = plainDiv; plainDiv.children = [mv];
var threw = null;
try { advance(2050); } catch (e) { threw = String(e); }
ok('promote() stops at the document instead of throwing inside update()', threw === null, threw);
V9.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
print('\n=== Pre-rendered: the same layers, a picture of the sky pinned in each ===');
window.innerWidth = 1280; window.innerHeight = 800;
var imgRect = { x: 0, y: 0, w: 1280, h: 800 }, mkEl = document.createElement;
document.createElement = function (t) { var e = mkEl(t); if (t === 'img' || t === 'canvas') e._rect = imgRect; return e; };
// (the picture is a canvas holding it: data-src names it)
var imgsOf = function (l) { return l.children.filter(function (c) { return c.tagName === 'CANVAS' && c.getAttribute('data-src'); })
  .map(function (c) { c.src = c.getAttribute('data-src'); return c; }); };
var live = function (l) { return /blur\(/.test(l.style.backdropFilter) && !imgsOf(l).length; };
var V10 = view();
add(V10.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
setLook('blur_pre'); advance(300);
var pl = layersIn(V10.v);
ok('blur_pre runs the shared layers, as Shared Layer does', G.stats().active && G.stats().pre && pl.length > 0, G.stats());
ok('...blurring live until there is a picture to wear', pl.every(live));
G._pre.show('blob:one');
ok('a picture: each layer wears it, pinned to the screen, and blurs nothing live',
   pl.every(function (l) { return l.style.backdropFilter === 'none' && imgsOf(l).length === 1 && imgsOf(l)[0].src === 'blob:one'; }) &&
   /position:fixed/.test(imgsOf(pl[0])[0].style.cssText) && /100vw/.test(imgsOf(pl[0])[0].style.cssText));
ok('...the first picture is whole, not faded in', pl.every(function (l) { return imgsOf(l)[0].style.opacity !== '0'; }));
G._pre.show('blob:two');
ok('a new picture arrives transparent over the old', pl.every(function (l) { var i = imgsOf(l); return i.length === 2 && i[1].style.opacity === '0'; }));
advance(1000);
ok('...slowly: still both a second in (a 2.5 s fade on the same page, a drift and not a jump)',
   pl.every(function (l) { return imgsOf(l).length === 2; }));
advance(1800);
ok('...fades in and the old one goes', pl.every(function (l) { var i = imgsOf(l); return i.length === 1 && i[0].src === 'blob:two' && i[0].style.opacity === '1'; }));
// a late frame (a tablet busy just after a page load): the timers run on, no
// frame comes
G._pre.show('blob:late');
T += 3000; runTimers();
ok('the next frame late: the old picture stays -- the new one has not started its fade (it left the pills bare for two frames)',
   pl.every(function (l) { var i = imgsOf(l); return i.length === 2 && i[0].src === 'blob:two' && i[1].style.opacity === '0'; }));
advance(1000);
ok('...the frame comes, the fade starts: both still on, a second in', pl.every(function (l) { return imgsOf(l).length === 2; }));
advance(1800);
ok('...and the old one goes once the new one is in', pl.every(function (l) { var i = imgsOf(l); return i.length === 1 && i[0].src === 'blob:late' && i[0].style.opacity === '1'; }));
G._pre.show('blob:three', undefined, 600);
ok('a change (a new page, a new cover, rain) fades in quickly', pl.every(function (l) { var i = imgsOf(l); return i.length === 2 && /opacity 600ms/.test(i[1].style.transition); }),
   imgsOf(pl[0]).map(function (i) { return i.style.transition; }));
advance(900);
ok('...done in well under a second', pl.every(function (l) { var i = imgsOf(l); return i.length === 1 && i[0].src === 'blob:three'; }));
imgRect = { x: 30, y: 24, w: 1200, h: 760 };       // a sheet sliding in: its transform is the fixed child's box
var r10 = row(V10.grid, 500);
add(r10, card({ x: 20, y: 507, w: 192, h: 70 })); advance(300);
ok('a layer whose picture cannot be pinned to the screen blurs live instead', layersIn(r10).length > 0 && layersIn(r10).every(live));
ok('...and the others keep their picture', pl.every(function (l) { return imgsOf(l).length === 1; }));
G._pre.none();
ok('no sky to paint (a page in its own color): every layer blurs live again', pl.every(live));
imgRect = { x: 0, y: 0, w: 1280, h: 800 };
G._pre.show('blob:three'); setLook('blur'); advance(300);
ok('back to Shared Layer: the layers are rebuilt, live, no pictures anywhere',
   G.stats().active && !G.stats().pre && layersIn(V10.v).every(live) && layersIn(V10.v).length > 0);
V10.v.remove(); Array.from(GL).forEach(leave); advance(300);
document.createElement = mkEl;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
print('\n=== a page change: no gap -- the last picture stays until the new one is painted ===');
globalThis.location = { pathname: '/dashboard-home/home' };
imgRect = { x: 0, y: 0, w: 1280, h: 800 }; document.createElement = function (t) { var e = mkEl(t); if (t === 'img' || t === 'canvas') e._rect = imgRect; return e; };
var V12 = view(); add(V12.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
setLook('blur_pre'); advance(300); G._pre.show('blob:home');
var hl = layersIn(V12.v);
ok('(Home wears Home\'s picture)', hl.length > 0 && hl.every(function (l) { return imgsOf(l).length === 1; }));
location.pathname = '/dashboard-home/climate'; G._pre.nav();
ok('the page moves: the layers keep the last picture (taking it off left the sky unblurred for a third of a second)',
   hl.every(function (l) { return imgsOf(l).length === 1 && imgsOf(l)[0].src === 'blob:home' && l.style.backdropFilter === 'none'; }));
G._pre.show('blob:climate'); advance(1000);
ok('the new picture: the last page\'s layers keep theirs until they leave (they wore it while Home Assistant swapped the page)',
   hl.every(function (l) { return imgsOf(l).length === 1 && imgsOf(l)[0].src === 'blob:home'; }));
var V12b = view(); add(V12b.grid, card({ x: 20, y: 300, w: 192, h: 70 })); advance(300);
ok('...and the new page\'s layers wear the new picture', layersIn(V12b.v).length > 0 &&
   layersIn(V12b.v).every(function (l) { return imgsOf(l).length === 1 && imgsOf(l)[0].src === 'blob:climate'; }));
V12b.v.remove();
location.pathname = '/dashboard-home/lights'; G._pre.nav();
ok('another page change: the layers still on screen keep a picture -- never bare', hl.every(function (l) { return imgsOf(l).length === 1 && l.style.backdropFilter === 'none'; }));
setLook('blur'); V12.v.remove(); Array.from(GL).forEach(leave); advance(300);
document.createElement = mkEl; delete globalThis.location;

// ---------------------------------------------------------------------------
print('\n=== back on a page: its last picture goes on with the page, before any paint ===');
globalThis.location = { pathname: '/dashboard-home/home' };
imgRect = { x: 0, y: 0, w: 1280, h: 800 }; document.createElement = function (t) { var e = mkEl(t); if (t === 'img' || t === 'canvas') e._rect = imgRect; return e; };
var srcOf = function (v) { var ls = layersIn(v); return ls.length ? ls.map(function (l) { var i = imgsOf(l); return i.length ? i[i.length - 1].src : ''; }).join(' ') : 'no layers'; };
var V14 = view(); add(V14.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
var side = new E('DIV', {}, { x: 0, y: 0, w: 300, h: 800 }); BODY.appendChild(side);
setLook('blur_pre'); advance(300);
G.pin(side, 'linear-gradient(red,red)');
G._pre.show('blob:home-1');
location.pathname = '/dashboard-home/weather'; G._pre.nav(); G._pre.show('blob:weather-1');
ok('the sidebar keeps Home\'s picture while Home is still the page on screen', /blob:home-1/.test(side.style.background || ''), side.style.background);
ok('on Weather: Home\'s layers keep Home\'s picture while they are still on screen', /^(blob:home-1 ?)+$/.test(srcOf(V14.v)), srcOf(V14.v));
var V14w = view(), cw = add(V14w.grid, card({ x: 20, y: 300, w: 192, h: 70 })); advance(300);
ok('...and Weather\'s layers wear Weather\'s', /^(blob:weather-1 ?)+$/.test(srcOf(V14w.v)), srcOf(V14w.v));
var sideMid = side.style.background || '';
ok('...and as Weather\'s view shows the sidebar fades across: Home\'s picture and Weather\'s blended, part way',
   /^linear-gradient\(red,red\), -webkit-cross-fade\(url\("blob:home-1"\), url\("blob:weather-1"\), ([1-9]\d?)%\) -?0\.0px -?0\.0px \/ 1280px 800px no-repeat$/.test(sideMid), sideMid);
advance(400);
ok('...ending on Weather\'s alone', /blob:weather-1/.test(side.style.background || '') && !/blob:home-1|cross-fade/.test(side.style.background), side.style.background);
V14w.v.remove(); leave(cw);
location.pathname = '/dashboard-home/home'; G._pre.nav();
var V14b = view(); add(V14b.grid, card({ x: 20, y: 300, w: 192, h: 70 })); advance(300);
ok('back on Home: Home\'s remembered picture is on at once, no paint awaited', /^(blob:home-1 ?)+$/.test(srcOf(V14b.v)), srcOf(V14b.v));
advance(1600);
ok('...and the sidebar follows, at the latest when no view ever says it is up', /blob:home-1/.test(side.style.background || ''), side.style.background);
G.unpin(side); side.remove();
setLook('blur'); V14.v.remove(); V14b.v.remove(); Array.from(GL).forEach(leave); advance(300);
document.createElement = mkEl; delete globalThis.location;

print('\n=== what is behind a layer decides it: the sky (a picture) or the page (live) ===');
imgRect = { x: 0, y: 0, w: 1280, h: 800 }; document.createElement = function (t) { var e = mkEl(t); if (t === 'img' || t === 'canvas') e._rect = imgRect; return e; };
var V22 = view(); add(V22.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
var bar = new E('DIV', { position: 'fixed' }, { x: 0, y: 700, w: 1280, h: 100 }); V22.grid.appendChild(bar);
var inBar = add(bar, card({ x: 20, y: 710, w: 192, h: 70 }));
setLook('blur_pre'); advance(300); G._pre.show('blob:sky');
var barL = layersIn(bar), pageL = layersIn(V22.v).filter(function (l) { return barL.indexOf(l) < 0; });
ok('a layer held over the page (in a fixed box) blurs live, though its picture would line up',
   barL.length > 0 && barL.every(live), barL.map(function (l) { return l.style.backdropFilter; }));
ok('...while the page\'s own layers wear the picture', pageL.length > 0 && pageL.every(function (l) { return imgsOf(l).length === 1 && !live(l); }));
var r22 = row(V22.grid, 450); add(r22, card({ x: 20, y: 457, w: 192, h: 70 }));
imgRect = { x: 30, y: 24, w: 1200, h: 760 };    // something above it moving: its picture out of line
advance(300);
ok('a page layer whose picture is out of line blurs live meanwhile', layersIn(r22).length > 0 && layersIn(r22).every(live));
imgRect = { x: 0, y: 0, w: 1280, h: 800 };       // still again
G.refresh(); advance(300);
ok('...and wears the picture again once it lines up (it stayed live for good)', layersIn(r22).every(function (l) { return imgsOf(l).length === 1 && !live(l); }));
setLook('blur'); V22.v.remove(); Array.from(GL).forEach(leave); advance(300);
document.createElement = mkEl;

print('\n=== pinned glass: the menu and tab bar wear the picture too ===');
var V13 = view(); add(V13.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
var mat = new E('DIV', {}, { x: 0, y: 0, w: 300, h: 800 }); BODY.appendChild(mat);
setLook('blur'); advance(300);
G.pin(mat, 'linear-gradient(red,red)');
ok('Shared Layer: a pinned surface keeps its own live blur (nothing set on it)', !mat.style.background && !mat.style['backdrop-filter']);
setLook('blur_pre'); advance(300); G._pre.show('blob:pin');
ok('Pre-rendered: the pinned panel wears its slice under its own tint, its live blur off',
   /^linear-gradient\(red,red\), url\("blob:pin"\) -?0\.0px -?0\.0px \/ 1280px 800px no-repeat$/.test(mat.style.background || '') && mat.style['backdrop-filter'] === 'none', mat.style.background);
setLook('blur'); advance(300);
ok('back to Shared Layer: its own background and blur back', !mat.style.background && !mat.style['backdrop-filter']);
G.unpin(mat); mat.remove(); V13.v.remove(); Array.from(GL).forEach(leave); advance(300);

// ---------------------------------------------------------------------------
// LAST: a paint started here never finishes in this harness (pre.busy stays)
print('\n=== painted again on what changes it, never by looking every few seconds ===');
globalThis.location = { pathname: '/dashboard-home/home' };
var realNow = Date.now, BASE = realNow(); Date.now = function () { return BASE + T; };
var skyN = new E('DIV', {}, { x: 0, y: 0, w: 1280, h: 800 }); BODY.appendChild(skyN);
var SB = 'weather|8c1', SL = '--sk0: #123';
window.hkSky = { element: function () { return skyN; }, asleep: function () { return false; }, cloudsPending: function () { return false; },
                 sig: function () { return { big: SB, small: SL }; } };
var V21 = view(); add(V21.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
setLook('blur_pre'); advance(300);
var st21 = G._pre.state(), paints = function () { return st21.busy; };
var painted = function () {                       // as a finished paint leaves it
  st21.busy = false; st21.again = false; st21.url = 'blob:p'; st21.path = st21.drawn = '/dashboard-home/home';
  var sg = G._pre.sigs(); st21.big = sg.big; st21.small = sg.small; st21.at = Date.now();
};
var skyPaint = function () { (winL['hk-sky-paint'] || []).forEach(function (f) { f(); }); };
painted(); skyPaint();
advance(60000);
ok('nothing changes for a minute: no paint (it looked every 5 s)', !paints());
painted(); SL = '--sk0: #124'; skyPaint();
ok('the light moves just after a paint: not painted at once (at most every 45 s)...', !paints());
advance(43000);
ok('...nor before its 45 s are up', !paints());
advance(3000);
ok('...but painted by then, with nothing else to say so', paints(), [Date.now() - st21.at]);
painted(); skyPaint(); SB = 'weather rain|8c1'; skyPaint();
ok('what the sky shows changes (rain): painted at once', paints());
var g0 = st21.gen; SB = 'weather snow|8c1'; skyPaint();
ok('it changes again while that paint runs: a new paint starts at once, not queued behind it', st21.gen === g0 + 1 && paints(), st21.gen - g0);
var g1 = st21.gen; skyPaint();
ok('...but asked again with nothing new, it waits for the running one', st21.gen === g1 && st21.again === true);
painted(); var g2 = st21.gen; SB = 'weather snow wind|8c1'; (winL['hk-sky-change'] || []).forEach(function (f) { f(); });
ok('the sky saying it changed (hk-sky-change, at once) paints it', st21.gen === g2 + 1 && paints());
painted(); st21.unsettled = true; var g3 = st21.gen; skyPaint();
ok('a picture that read a slow fade half-way: painted again once the sky has settled', st21.gen === g3 + 1 && st21.unsettled === false);
painted(); var g4 = st21.gen; skyPaint();
ok('...and a settled one is not', st21.gen === g4 && !paints());
painted(); advance(121000);
ok('and every 2 minutes whatever (the clouds drift with nothing to say so)', paints());
var ANIM = false, DRIFT = false;
window.hkSettings.skyLook = function () { return { animations: ANIM }; };
window.hkSky.drifting = function () { return DRIFT; };
ANIM = true; DRIFT = true; painted(); skyPaint();
advance(1500);
ok('the clouds drifting (Animations on): not painted again before 2 s...', !paints());
advance(600);
ok('...but every 2 s, so the pills follow them', paints());
painted(); skyPaint(); advance(1000);
(winL.pointerdown || []).forEach(function (f) { f({ type: 'pointerdown' }); });
advance(3000);
ok('a finger on the page: no paint for the clouds while it is down', !paints());
(winL.pointerup || []).forEach(function (f) { f({ type: 'pointerup' }); });
advance(400);
ok('...nor straight after it lifts', !paints());
advance(500);
ok('...painted once the page has been still a moment', paints());
painted(); skyPaint(); advance(1900);
(winL.scroll || []).forEach(function (f) { f({ type: 'scroll' }); });
advance(500);
ok('scrolling: the 2 s paint waits for it to stop', !paints());
advance(400);
ok('...and comes once it has', paints());
painted(); (winL.pointerdown || []).forEach(function (f) { f({ type: 'pointerdown' }); }); skyPaint();
SB = 'weather fog|8c1'; skyPaint();
ok('a change of what the sky shows is painted at once, finger down or not', paints());
(winL.pointerup || []).forEach(function (f) { f({ type: 'pointerup' }); });
DRIFT = false; painted(); skyPaint(); advance(3000);
ok('nothing drifting (a still page, its clouds paused): no 2 s paints', !paints());
advance(28000);
ok('...the 30 s of a moving sky instead', paints());
ANIM = false; delete window.hkSettings.skyLook;
painted(); window.innerWidth = 1100; (winL.resize || []).forEach(function (f) { f(); });
ok('a new window size: painted at once', paints());
window.innerWidth = 1280;
setLook('blur'); V21.v.remove(); skyN.remove(); Array.from(GL).forEach(leave); advance(300);
Date.now = realNow; delete window.hkSky; delete globalThis.location;

print('\n=== the first picture waits for the realistic clouds ===');
globalThis.location = { pathname: '/dashboard-home/home' };
var skyNode = new E('DIV', {}, { x: 0, y: 0, w: 1280, h: 800 }); BODY.appendChild(skyNode);
var pending = true;
window.hkSky = { element: function () { return skyNode; }, asleep: function () { return false; },
                 cloudsSig: function () { return pending ? '' : '6c1'; }, cloudsPending: function () { return pending; } };
var V20 = view(); add(V20.grid, card({ x: 20, y: 300, w: 192, h: 70 }));
G._pre.state().busy = false; G._pre.state().again = false;   // left by earlier paints this harness never finishes
setLook('blur_pre'); advance(300);
ok('at load, with the clouds still on their way, no picture is painted (it wore a cloudless sky, darker, for 5 s)',
   !G._pre.state().url && !G._pre.state().busy, G._pre.state());
pending = false;
(winL['hk-sky-paint'] || []).forEach(function (f) { f(); });
ok('...the sky saying they are up paints it at once', G._pre.state().busy === true);
setLook('blur'); V20.v.remove(); skyNode.remove(); Array.from(GL).forEach(leave); advance(300);
delete window.hkSky; delete globalThis.location;

print(fail ? 'FAIL ' + fail + ' GLASS BEHAVIOUR TESTS' : 'ALL ' + pass + ' GLASS BEHAVIOUR TESTS PASS');
if (fail) throw new Error('glass behaviour tests failed');
