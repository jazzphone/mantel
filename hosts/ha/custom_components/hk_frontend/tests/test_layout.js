// The owned grid must rebuild in place when the visual editor reuses it.
var root = HK_ROOT;
load(root + '/tests/dom.js');
var create = document.createElement;
document.createElement = function (tag) {
  var el = create(tag);
  el.style.setProperty = function (k, v) { this[k] = v; };
  return el;
};
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
load(root + '/frontend/cards/hk-base.js');
load(root + '/frontend/cards/hk-layout.js');

var pass = 0, fail = 0;
function check(name, cond) { print((cond ? 'PASS ' : 'FAIL ') + name); cond ? pass++ : fail++; }
var Grid = customElements.get('hk-grid-card');
var card = new Grid();
card.setConfig({ layout: { 'grid-template-columns': '1fr' }, cards: [] });
check('first config creates one style/root pair', card._root.children.length === 2);
card.setConfig({ layout: { 'grid-template-columns': '1fr 1fr' }, cards: [] });
check('second config replaces rather than duplicates the grid', card._root.children.length === 2);
check('the new layout is applied', card._e.style['grid-template-columns'] === '1fr 1fr');

// Navigation-aware headers: preserve the grid and its children in place.
(function () {
  var mode = window.hkLayout.pageHeaderMode;
  check('smart hides a repeated title in persistent navigation', mode('smart', {available:true,exact:true}, false) === 'none');
  check('smart keeps context for More or a room under Rooms', mode('smart', {available:true,exact:false}, false) === 'context');
  check('a folded menu restores Back and title', mode('smart', {available:false,exact:false}, false) === 'current');
  check('No Header also keeps navigation when the menu folds', mode('none', {available:false}, false) === 'current');
  check('explicit No Header hides even unmatched titles', mode('none', {available:true,exact:false}, false) === 'none');
  check('Music browsing retains its internal Back control', mode('smart', {available:true,exact:true}, true) === 'current');
  var oldMenu = window.hkCards.menu, oldNav = window.hkMenu;
  var exact = true, available = true, setting = 'smart';
  window.hkCards.menu = { sig:function(){return '';}, board:function(){return {page_header:setting};} };
  window.hkMenu = {headerContext:function(){return {available:available,exact:exact};}};
  var h = new Grid();
  h.setConfig({page_header:true,cards:[{type:'custom:hk-back-card'},{type:'custom:hk-heading-card',name:'Climate'}]});
  var root = h._e;
  check('header hides its own grid host', h.getAttribute('data-page-header') === 'none');
  exact=false;h._updatePageHeader();
  check('unmatched page gets a compact accessible heading', h.getAttribute('data-page-header') === 'context' && h._contextLabel.textContent === 'Climate' && h._contextLabel.getAttribute('role') === 'heading');
  available=false;h._updatePageHeader();
  check('responsive changes restore the same header children', h.getAttribute('data-page-header') === 'current' && h._e === root);
  window.hkCards.menu=oldMenu;window.hkMenu=oldNav;
})();

// --- hk-grid-view: reconcile, never empty-and-refill ----------------------
// HA sets `cards` and `badges` separately and repeatedly while a view builds
// (five _place() calls measured on one first visit). Emptying the root each
// time would detach every card, and a detach releases a chart's pending
// hk-stats request -- the Energy page's charts would then sit on "Loading". A
// card already in place must never be removed.
(function () {
  var E = Object.getPrototypeOf(document.createElement('div'));
  if (!E.insertBefore) {
    E.insertBefore = function (c, ref) {
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; return c;
    };
    Object.defineProperty(E, 'childNodes', { get: function () { return this.children; } });
    Object.defineProperty(E, 'lastChild', { get: function () { return this.children[this.children.length - 1] || null; } });
  }
  var removed = 0;
  var rm = E.removeChild;
  E.removeChild = function (c) { removed++; return rm.call(this, c); };
  function kid(n) { var k = document.createElement('card' + n); k.style = { setProperty: function () {} }; return k; }

  var View = customElements.get('hk-grid-view');
  check('hk-grid-view is registered', !!View);
  if (!View) return;
  var ready = [];
  window.addEventListener('hk-view-ready', function (e) { ready.push(e.detail.view); });

  var v = new View();
  v.isConnected = false;
  var a = kid('a'), b = kid('b'), c = kid('c');
  v.setConfig({ cards: [{}, {}, {}] });
  v.cards = [];                                  // HA can hand an empty list first
  v.badges = [];
  v.isConnected = true;
  v.connectedCallback();
  check('a view with cards configured does not announce before it has them', ready.length === 0);

  v.cards = [a, b, c];
  check('it announces once its cards are in', ready.length === 1 && ready[0] === v);
  var root = v._root;
  check('cards are placed in order', root.children[0] === a && root.children[1] === b && root.children[2] === c);

  removed = 0;
  v.cards = [a, b, c];
  v.badges = [];
  v.cards = [a, b, c];
  check('re-setting the same cards removes nothing (' + removed + ' removals)', removed === 0);
  check('...and does not announce again while attached', ready.length === 1);

  var d = kid('d');
  v.cards = [a, d, c];
  check('a changed list is reconciled in place',
        root.children.length === 3 && root.children[0] === a && root.children[1] === d && root.children[2] === c);
  v.cards = [a];
  check('a shorter list drops the extras', root.children.length === 1 && root.children[0] === a);

  v.disconnectedCallback();
  v.isConnected = false;
  v.isConnected = true;
  v.connectedCallback();
  check('re-attaching a cached view announces again', ready.length === 2);

  var empty = new View();
  empty.isConnected = true;
  empty.setConfig({ cards: [] });
  empty.connectedCallback();
  check('a view configured with no cards announces on attach', ready.length === 3 && ready[2] === empty);
})();
// --- Rooms on Home in the room order ---------------------------------------
(function () {
  var View = customElements.get('hk-grid-view');
  var sec = function (area) { return { type: 'grid', cards: [{ type: 'custom:hk-heading-card', name: area, area: area }, { type: 'custom:hk-grid-card' }] }; };
  var cfg = [{ type: 'custom:hk-header-card' }, sec('living_room'), { type: 'custom:hk-grid-card' },
             sec('kitchen'), sec('office'), sec('garage')];
  var els = cfg.map(function (c, i) { var e = document.createElement('div'); e.tag = (c.cards ? c.cards[0].area : 'x' + i); return e; });
  var M = window.hkCards.menu, was = M.board;
  var names = function (list) { return list.map(function (e) { return e.tag; }).join(','); };
  M.board = function () { return { home_rooms: 'as_is', room_order: ['office', 'kitchen'] }; };
  check('as the dashboard lists them (the default): nothing moves', names(View.roomOrder(els, 0, cfg)) === names(els));
  M.board = function () { return { home_rooms: 'order', room_order: ['office', 'kitchen'] }; };
  check('in room order: the listed rooms first, the rest after, in the slots rooms already held',
        names(View.roomOrder(els, 0, cfg)) === 'x0,office,x2,kitchen,living_room,garage');
  M.board = function () { return { home_rooms: 'order', room_order: [] }; };
  check('an empty room order moves nothing', names(View.roomOrder(els, 0, cfg)) === names(els));
  check('a room section is a card whose first card is a heading naming an area',
        View.sectionArea(sec('den')) === 'den' && View.sectionArea({ type: 'grid', cards: [{ type: 'custom:hk-heading-card', name: 'Scenes' }] }) === null &&
        View.sectionArea({ type: 'custom:hk-header-card' }) === null);
  M.board = was;
})();
function editorFields(tag) {
  var C = customElements.get(tag), probe = C.getConfigElement();
  var EC = customElements.get(String(probe.tagName || '').toLowerCase());
  var ed = EC ? new EC() : probe;
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.hass = { states: {} }; ed.setConfig({ type: 'custom:' + tag });
  var out = {};
  (function walk(list) { (list || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
  return out;
}
// THE EDITORS offer what the cards read.
(function () {
  var g = editorFields('hk-grid-card'), f = editorFields('hk-frame-card'), i = editorFields('hk-info-card');
  check('hk-grid-card: its cards, as a YAML list', !!g.cards && !!g.cards.selector.object && /view_layout/.test(g.cards.helper));
  check('hk-frame-card: vars', !!f.vars && !!f.vars.selector.object);
  check('hk-info-card: cool_below and warm_above, as numbers',
        !!i.cool_below && !!i.cool_below.selector.number && !!i.warm_above && !!i.warm_above.selector.number);
})();
// A BLOCK WITH RULES: its gate is a cheap comparison (2026-10-29) -- the rule shown and which config this is, not
// JSON.stringify of the whole block on every push of the house
(function () {
  var Cond = customElements.get('hk-grid-conditional-card');
  var oldCat = window.hkGridCatalog, oldCreate = window.hkCards.createCard, shown = -1, chose = 0, built = 0;
  var item = { size: 'small', rules: [{ type: 'a', when: {} }, { type: 'b', when: {} }], base: { type: 'base' } };
  window.hkGridCatalog = {
    rulesOf: function () { return { rules: item.rules, base: item.base }; },
    choose: function () { chose++; return shown; },
    config: function (c) { return c; }
  };
  window.hkCards.createCard = function () { built++; var el = document.createElement('div'); el.setAttribute = function () {}; return el; };
  var stringified = 0, real = JSON.stringify;
  var cfg = { item: item, ctx: { big: new Array(500).join('x') } };
  var c = new Cond();
  if (c._root && !c._root.replaceChildren) c._root.replaceChildren = function () {};
  c.setConfig(cfg);
  if (c._root && !c._root.replaceChildren) c._root.replaceChildren = function () {};
  c.isConnected = true;
  c.hass = { states: {} };
  var s0 = c._sigOf();
  check('the conditional block: its signature is the rule shown and the config\'s identity', typeof s0 === 'string' && /^-1\|\d+$/.test(s0), s0);
  check('...the same on another push of the house', c._sigOf() === s0);
  JSON.stringify = function () { stringified++; return real.apply(JSON, arguments); };
  for (var i = 0; i < 50; i++) c._sigOf();
  JSON.stringify = real;
  check('...and it builds no JSON of the block to learn that', stringified === 0, stringified);
  shown = 1;
  check('...another rule shown: another signature', c._sigOf() !== s0 && /^1\|/.test(c._sigOf()));
  shown = -1;
  var b0 = built;
  c.setConfig(Object.assign({}, cfg));
  check('...a new config (set whole): another signature', c._sigOf() !== s0);
  c.hass = { states: { a: 1 } };
  check('a push that changes neither draws nothing more', built - b0 <= 1 && c._sigOf() === c._sigOf());
  window.hkGridCatalog = oldCat; window.hkCards.createCard = oldCreate;
})();
print(fail ? 'FAIL ' + fail + ' LAYOUT TESTS' : 'ALL ' + pass + ' LAYOUT TESTS PASS');
