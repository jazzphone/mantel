// The menu's list of round buttons on the page (hk-base menu.chipShown /
// chips, read by the scrolled edge tab): a card is in it while it is on the
// page, and out of it once it leaves. Until 2026-09-28 a card was added when
// it drew and never removed, so every card a rebuild or a chip-row replan
// threw away stayed alive with the whole state snapshot it last had.
if (typeof HK_ROOT === 'undefined')
  throw new Error('HK_ROOT is not set -- run this through tests/run, not jsc directly');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
var SETTINGS = { boards: { 'dashboard-hall': { menu: 'chip_scroll' } } };
window.hkSettings = { get: function (path, fb) { var v = SETTINGS, p = String(path).split('.');
  for (var i = 0; i < p.length; i++) { if (v == null) break; v = v[p[i]]; } return v == null ? fb : v; } };
location.pathname = '/dashboard-hall/kitchen';
window.innerWidth = 1280; window.innerHeight = 800;
// find the registry by what is added to it
var sets = [], RealSet = Set;
globalThis.Set = function (it) { var s = new RealSet(it); sets.push(s); return s; };
Set.prototype = RealSet.prototype;
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-layout.js');
globalThis.Set = RealSet;
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }

var M = window.hkCards.menu;
ok('this board draws the round menu button beside the back chevron', M.round('page') === true);
var house = H.house({ 'sensor.x': ['1', {}] });
var Back = customElements.get('hk-back-card'), Btn = customElements.get('hk-menu-button-card');
// THE registry: the one Set a marker handed to chipShown lands in (other Sets
// in hk-base track attached cards too, and would pass for it)
var marker = { shadowRoot: null };
M.chipShown(marker);
var reg = sets.filter(function (s) { return s.has(marker); })[0];
reg.delete(marker);
var first = null;
function registry() { return reg; }

first = new Back(); first.setConfig({ type: 'custom:hk-back-card' });
first.hass = house.hass(); H.attach(first);
ok('a back card that drew the button is in the list while on the page', !!registry() && registry().has(first));
H.detach(first);
ok('...and out of it once it leaves the page', !registry().has(first), registry().size);
H.attach(first);
ok('a cached view coming back (attached, not redrawn) puts it back', registry().has(first));
H.detach(first);

for (var i = 0; i < 50; i++) {
  var c = new (i % 2 ? Btn : Back)(); c.setConfig({ type: i % 2 ? 'custom:hk-menu-button-card' : 'custom:hk-back-card' });
  c.hass = house.hass(); H.attach(c); H.detach(c);
}
ok('50 cards drawn and thrown away (a rebuild): none held', registry().size === 0, registry().size);

print(fail ? 'FAIL ' + fail + ' MENU CHIP TESTS' : 'ALL ' + pass + ' MENU CHIP TESTS PASS');
