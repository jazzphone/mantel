// THE SMALL MODEL OF THE DOM that Edit mode's page suites draw into
// (test_edit.js and test_edit_pages.js share this one copy):
// elements with listeners, a 4-column grid's layout, a tile with a shadow
// root, and pointer events as they reach a grid's root. Each suite builds its
// page itself. Loaded after card_harness.js.
// ------------------------------------------------- a small model of the DOM
// Elements with children, listeners (capture recorded), pointer capture,
// classes, attributes, a style bag, and a layout: a grid root lays its
// children out as CSS grid does with `grid-auto-flow: row` (sparse) -- 4
// columns of 200 x 80, a `grid-row: span 2` child two rows tall.
function EStyle() {}
Object.defineProperty(EStyle.prototype, 'setProperty', { value: function (k, v) { this[k] = v; } });
Object.defineProperty(EStyle.prototype, 'removeProperty', { value: function (k) { delete this[k]; } });
Object.defineProperty(EStyle.prototype, 'getPropertyValue', { value: function (k) { return this[k] === undefined ? '' : this[k]; } });
function N(tag) {
  this.localName = tag; this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
  this.attrs = {}; this.style = new EStyle(); this.on = []; this.className = ''; this.captured = []; this.isConnected = true;
}
N.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c; };
N.prototype.append = function () { for (var i = 0; i < arguments.length; i++) this.appendChild(arguments[i]); };
N.prototype.insertBefore = function (c, ref) {
  if (c.parentNode) c.parentNode.removeChild(c);
  var i = ref ? this.children.indexOf(ref) : -1;
  if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
  c.parentNode = this; return c;
};
N.prototype.removeChild = function (c) { this.children = this.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
N.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
Object.defineProperty(N.prototype, 'nextSibling', { get: function () {
  var p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; } });
Object.defineProperty(N.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Object.defineProperty(N.prototype, 'parentElement', { get: function () { return this.parentNode; } });
Object.defineProperty(N.prototype, 'classList', { get: function () {
  var el = this;
  var s = function () { return (el.className || '').split(/\s+/).filter(Boolean); };
  return { add: function (c) { var a = s(); if (a.indexOf(c) < 0) a.push(c); el.className = a.join(' '); },
           remove: function (c) { el.className = s().filter(function (x) { return x !== c; }).join(' '); },
           contains: function (c) { return s().indexOf(c) >= 0; },
           toggle: function (c, f) { var on = f === undefined ? s().indexOf(c) < 0 : !!f; if (on) this.add(c); else this.remove(c); return on; } };
} });
N.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
N.prototype.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
N.prototype.hasAttribute = function (k) { return this.attrs[k] !== undefined; };
N.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
N.prototype.toggleAttribute = function (k, f) { var on = f === undefined ? !this.hasAttribute(k) : !!f; if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; };
N.prototype.addEventListener = function (t, f, o) { this.on.push({ t: t, f: f, cap: o === true || !!(o && o.capture), o: o }); };
N.prototype.removeEventListener = function (t, f, o) {
  var cap = o === true || !!(o && o.capture);
  this.on = this.on.filter(function (l) { return !(l.t === t && l.f === f && l.cap === cap); });
};
N.prototype.count = function (t) { return this.on.filter(function (l) { return l.t === t; }).length; };
N.prototype.fire = function (t, ev) { ev.type = t; this.on.filter(function (l) { return l.t === t; }).forEach(function (l) { l.f(ev); }); return ev; };
N.prototype.setPointerCapture = function (id) { this.captured.push(id); };
N.prototype.releasePointerCapture = function () {};
N.prototype.focus = function () { FOCUSED = this; };
N.prototype.click = function () { this.fire('click', mkEv({})); };
N.prototype.querySelector = function () { return null; };
N.prototype.querySelectorAll = function () { return []; };
N.prototype.getBoundingClientRect = function () {
  if (this.parentNode && this.parentNode.layout) return this.parentNode.layout(this);
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
};
var FOCUSED = null;
if (!document.documentElement) document.documentElement = new N('html');
function tallEl(el) { return /span\s*2/.test(String(el.style['grid-row'] || '')); }
function gridRoot() {
  var root = new N('div');
  root.id = 'root';
  root.layout = function (child) {
    var COLS = 4, taken = {}, row = 0, col = 0, out = null;
    root.children.filter(function (c) { return !c.notLaidOut; }).forEach(function (c) {
      var span = tallEl(c) ? 2 : 1;
      for (;;) {
        if (col >= COLS) { col = 0; row++; }
        if (!taken[row + ':' + col] && (span === 1 || !taken[(row + 1) + ':' + col])) break;
        col++;
      }
      for (var k = 0; k < span; k++) taken[(row + k) + ':' + col] = 1;
      var r = { left: 20 + col * 200, top: 100 + row * 80 - window.scrollY, width: 196, height: span * 80 - 10 };
      r.right = r.left + r.width; r.bottom = r.top + r.height;
      if (c === child) out = r;
      col++;
    });
    return out || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  return root;
}
// a tile: its config, a shadow root (the badge goes there), its layout
function tileEl(cfg, sizable) {
  var t = new N('hk-light-card');
  t._config = cfg;
  t.shadowRoot = new N('#shadow');
  t.configs = 0;
  t.setConfig = function (c) { t._config = Object.assign({}, c); t.configs++; };
  if (sizable !== false) t._layout = function () { return t._config.size === 'tall' ? 'tall' : t._config.size === 'regular' ? 'standard' : (tallEl(t) ? 'tall' : 'standard'); };
  var vl = cfg.view_layout || {};
  Object.keys(vl).forEach(function (k) { t.style.setProperty(k, vl[k]); });
  return t;
}
function isStyle(c) { return String(c.localName || c.tagName).toLowerCase() === 'style'; }
function ids(g) { return g._e.children.filter(function (c) { return c._config && c._config.entity; }).map(function (c) { return c._config.entity; }); }
function tileOf(g, id) { return g._e.children.filter(function (c) { return c._config && c._config.entity === id; })[0]; }
function centre(el) { var r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
function mkEv(o) {
  var ev = Object.assign({ button: 0, pointerId: 3, pointerType: 'mouse', stopped: 0, prevented: 0 }, o);
  ev.stopPropagation = function () { ev.stopped++; };
  ev.stopImmediatePropagation = function () { ev.stopped++; };
  ev.preventDefault = function () { ev.prevented++; };
  ev.composedPath = function () { return o.path || []; };
  return ev;
}
// a press on a tile, as it reaches the grid's root (the tile's inside first)
function down(g, tile, kind, at) {
  var p = at || centre(tile);
  return g._e.fire('pointerdown', mkEv({ clientX: p[0], clientY: p[1], pointerType: kind || 'mouse', target: tile,
                                         path: [tile.shadowRoot, tile, g._e, g.shadowRoot, g] }));
}
function move(g, x, y, kind) { return g._e.fire('pointermove', mkEv({ clientX: x, clientY: y, pointerType: kind || 'mouse', path: [g._e] })); }
function up(g, x, y, kind) { return g._e.fire('pointerup', mkEv({ clientX: x, clientY: y, pointerType: kind || 'mouse', path: [g._e] })); }
