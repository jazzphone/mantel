// hk-frosttint.js: Frosted's Tint from Background -- each dashboard card's
// wash is the color behind it (the sky at its height, the scenery's ground
// below), at one lightness; cards outside a view, album art and no sky stay
// gray; off is off.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

globalThis.window = globalThis;
var frames = [];
globalThis.requestAnimationFrame = function (f) { frames.push(f); return frames.length; };
function frame() { var q = frames; frames = []; q.forEach(function (f) { f(); }); }
globalThis.setTimeout = function (f) { f(); return 1; };
globalThis.addEventListener = function () {};
globalThis.innerHeight = 800; globalThis.scrollY = 0;

// ---- a small tree: elements with styles, computed styles and boxes ----------
function Style() { this.v = {}; }
Style.prototype.setProperty = function (k, v) { this.v[k] = v; };
Style.prototype.removeProperty = function (k) { delete this.v[k]; };
Style.prototype.getPropertyValue = function (k) { return this.v[k] || ''; };
function El(tag, opts) {
  opts = opts || {};
  this.tagName = tag; this.id = opts.id || ''; this.children = []; this.parentNode = null; this.parentElement = null;
  this.style = new Style(); this.computed = opts.computed || {}; this.box = opts.box || null; this.isConnected = true;
  this.cls = opts.cls || [];
  var self = this;
  this.classList = { contains: function (c) { return self.cls.indexOf(c) >= 0; } };
}
El.prototype.append = function (c) { this.children.push(c); c.parentNode = this; c.parentElement = this; return c; };
El.prototype.querySelectorAll = function () { var out = []; (function w(n) { n.children.forEach(function (c) { out.push(c); w(c); }); })(this); return out; };
El.prototype.querySelector = function (sel) {
  var cls = sel.replace('.', '');
  return this.querySelectorAll().filter(function (e) { return e.cls.indexOf(cls) >= 0; })[0] || null;
};
El.prototype.getBoundingClientRect = function () { var b = this.box || [0, 0, 0, 0]; return { top: b[1], left: b[0], width: b[2], height: b[3] }; };
globalThis.getComputedStyle = function (el) {
  return { getPropertyValue: function (k) { return el.computed[k] || ''; },
           get display() { return el.computed.display || 'block'; }, get visibility() { return el.computed.visibility || 'visible'; },
           get opacity() { return el.computed.opacity || '1'; } };
};
var DOC = new El('#document');
globalThis.document = { querySelectorAll: function () { return DOC.querySelectorAll(); } };

var SKY = DOC.append(new El('DIV', { id: 'hk-sky', computed: {
  '--sk0': 'rgb(13, 46, 86)', '--sk1': 'rgb(22, 65, 112)', '--sk2': 'rgb(39, 96, 144)', '--sk3': 'rgb(98, 150, 185)', '--artO': '0' } }));
var SCENERY = SKY.append(new El('DIV', { cls: ['near-scenery'], computed: { '--ground-color': '#302919' } }));
var VIEW = DOC.append(new El('HUI-VIEW'));
function card(y, h, parent) { var c = new El('HK-TILE-CARD', { box: [0, y, 200, h || 60] }); (parent || VIEW).append(c); return c; }
var top = card(40), low = card(600), sheet = new El('HK-POPUP'); DOC.append(sheet);
var inSheet = card(300, 60, sheet);
window.__hkCardsOnPage = new Set([top, low, inSheet]);

var tintOn = true, plates = [];
window.hkSettings = {
  frostTint: function () { return tintOn; },
  frostPlate: function (w) { plates.push(w); return 'PLATE(' + w.join(',') + ')'; },
  onChange: function () {}
};
load(HK_ROOT + '/frontend/modules/hk-frosttint.js');
var F = window.hkFrostTint;
function washOf(c) { var m = /PLATE\(([^)]+)\)/.exec(c.style.getPropertyValue('--hk-glass-plate')); return m ? m[1].split(',').map(Number) : null; }
function lightness(c) { var mx = Math.max.apply(null, c) / 255, mn = Math.min.apply(null, c) / 255; return (mx + mn) / 2; }

print('=== the wash ===');
var gold = F._wash([187, 148, 64]), blue = F._wash([22, 65, 112]);
ok('every wash is the same lightness (27%), whatever the color', Math.abs(lightness(gold) - 0.27) < 0.01 && Math.abs(lightness(blue) - 0.27) < 0.01,
   [lightness(gold), lightness(blue)]);
ok('...and keeps its hue: gold stays gold (red over blue), blue stays blue', gold[0] > gold[2] && blue[2] > blue[0], [gold, blue]);

print('\n=== a dashboard ===');
frame();
var w1 = washOf(top), w2 = washOf(low);
ok('a card near the top: the sky\'s blue', w1 && w1[2] > w1[0], w1);
ok('a card low on the screen, over the woodland: the ground\'s brown', w2 && w2[0] > w2[2], w2);
ok('...both on the chips\' plate too', top.style.getPropertyValue('--hk-chip-plate') === top.style.getPropertyValue('--hk-glass-plate'));
ok('a card in a pop-up sheet (not a view): left gray', !inSheet.style.getPropertyValue('--hk-glass-plate'));

SCENERY.computed.display = 'none'; F.refresh(); frame();
var w3 = washOf(low);
ok('the woodland not showing: the low card takes the sky\'s bottom instead', w3 && w3[2] > w3[0], w3);
SCENERY.computed.display = 'block';

var later = card(250); F.joined(later);
ok('a card joining is tinted in the next animation frame, before it is drawn', !washOf(later));
frame();
ok('...then it is', !!washOf(later));

print('\n=== left gray ===');
SKY.computed['--artO'] = '1'; F.refresh(); frame();
ok('album art behind the page (Play Music): every card gray again', !top.style.getPropertyValue('--hk-glass-plate') && !low.style.getPropertyValue('--hk-glass-plate'));
SKY.computed['--artO'] = '0'; F.refresh(); frame();
ok('...and tinted again once it is the sky', !!washOf(top));
tintOn = false; F.refresh(); frame();
ok('Tint from Background off (or not Frosted): nothing tinted', !top.style.getPropertyValue('--hk-glass-plate') && F._tinted().size === 0);
tintOn = true; SKY.isConnected = false; DOC.children = DOC.children.filter(function (c) { return c !== SKY; });
F.refresh(); frame();
ok('no sky on the page: gray', !top.style.getPropertyValue('--hk-glass-plate'));

print(fail ? 'FAIL ' + fail + ' FROST TINT TESTS' : 'ALL ' + pass + ' FROST TINT TESTS PASS');
if (fail) throw new Error('frost tint tests failed');
