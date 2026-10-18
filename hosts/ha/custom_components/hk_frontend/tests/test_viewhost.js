// HK's view host (Phase 2 P2.3, web/hk/shell/hk-view-host.js): draws an HK dashboard from the
// strategy's output with no Lovelace -- the card factory (custom cards by tag, HK's drawings of
// Lovelace's grid, stacks and conditional, a placeholder for any other Lovelace type, a card whose
// code arrives late), the views (Lovelace's order: setConfig, the client, narrow, index, cards),
// following the client, routing on HK's own navigation and the back button, the shell's parts, and
// that no host element is ever made.
//
// A small DOM of its own (tests/dom.js has no connected tree or custom-element construction): what
// the view host touches, with connectedCallback / disconnectedCallback as a browser runs them.
if (typeof HK_ROOT === 'undefined') throw new Error('HK_ROOT is not set -- run this through tests/run');

var pass = 0, fail = 0;
function ok(name, c, d) {
  if (c) { pass++; print('  ok   ' + name); }
  else { fail++; print('  FAIL ' + name + (d !== undefined ? '   got ' + (function () { try { return JSON.stringify(d); } catch (e) { return String(d); } })() : '')); }
}
function settle() { var p = Promise.resolve(); for (var i = 0; i < 12; i++) p = p.then(function () {}); return p; }

// ------------------------------------------------------------------ the DOM
var made = [];                       // every element name created
var registry = {}, byCtor = new Map(), waiting = {};
function Style() {}
Style.prototype.setProperty = function (k, v) { this[k] = v; };
Style.prototype.getPropertyValue = function (k) { return this[k] || ''; };
Style.prototype.removeProperty = function (k) { delete this[k]; };

class Node {
  constructor(tag) {
    this.localName = tag || byCtor.get(new.target) || 'div';
    this.tagName = this.localName.toUpperCase();
    this.childNodes = []; this.parentNode = null; this.attrs = {}; this.style = new Style();
    this._l = {}; this._text = ''; this.hidden = false;
  }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] || null; }
  get isConnected() { var n = this; while (n) { if (n === document.root) return true; n = n.parentNode || n.host || null; } return false; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    var was = c.isConnected;
    if (c.parentNode) c.parentNode.removeChild(c);
    var i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    if (!was && c.isConnected) connect(c, true);
    return c;
  }
  removeChild(c) {
    var i = this.childNodes.indexOf(c);
    if (i < 0) return c;
    var was = c.isConnected;
    this.childNodes.splice(i, 1); c.parentNode = null;
    if (was) connect(c, false);
    return c;
  }
  replaceChild(nu, old) { this.insertBefore(nu, old); this.removeChild(old); return old; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, f) { var on = f === undefined ? !this.hasAttribute(k) : !!f; if (on) this.attrs[k] = ''; else delete this.attrs[k]; return on; }
  attachShadow() { this.shadowRoot = new Node('#shadow'); this.shadowRoot.host = this; return this.shadowRoot; }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(function (x) { return x !== f; }); }
  dispatchEvent(e) { e.target = e.target || this; (this._l[e.type] || []).slice().forEach(function (f) { f(e); }); if (e.bubbles && this.parentNode) this.parentNode.dispatchEvent(e); return true; }
}
function connect(n, on) {
  var cb = on ? 'connectedCallback' : 'disconnectedCallback';
  if (typeof n[cb] === 'function') n[cb]();
  n.childNodes.slice().forEach(function (c) { connect(c, on); });
}
globalThis.HTMLElement = class HTMLElement extends Node {};
globalThis.customElements = {
  define: function (name, Ctor) {
    registry[name] = Ctor; byCtor.set(Ctor, name);
    (waiting[name] || []).forEach(function (r) { r(Ctor); }); delete waiting[name];
  },
  get: function (name) { return registry[name]; },
  whenDefined: function (name) {
    return registry[name] ? Promise.resolve(registry[name]) : new Promise(function (r) { (waiting[name] = waiting[name] || []).push(r); });
  },
  // a browser upgrades in place; here the element takes the class's prototype
  upgrade: function (el) { var C = registry[el.localName]; if (C && !(el instanceof C)) Object.setPrototypeOf(el, C.prototype); }
};
globalThis.document = {
  root: new Node('#document'),
  createElement: function (tag) {
    tag = String(tag).toLowerCase();
    made.push(tag);
    var C = registry[tag];
    return C ? new C() : new HTMLElement(tag);
  }
};
document.body = document.root.appendChild(new Node('body'));
globalThis.CustomEvent = function (type, init) { this.type = type; init = init || {}; this.detail = init.detail; this.bubbles = !!init.bubbles; };
var winL = {};
globalThis.addEventListener = function (t, f) { (winL[t] = winL[t] || []).push(f); };
globalThis.removeEventListener = function (t, f) { winL[t] = (winL[t] || []).filter(function (x) { return x !== f; }); };
globalThis.dispatchEvent = function (e) { (winL[e.type] || []).slice().forEach(function (f) { f(e); }); return true; };
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
var scrolled = 0;
globalThis.scrollTo = function () { scrolled++; };
globalThis.matchMedia = function (q) { return { matches: q === '(min-width: 640px)' }; };
var stack = ['/dashboard-test/home'];
globalThis.location = {
  get pathname() { return stack[stack.length - 1].split('#')[0]; },
  get href() { return 'http://hk.test' + stack[stack.length - 1]; },
  assigned: [], assign: function (u) { this.assigned.push(u); }
};
function resolvePath(p) {
  if (p.charAt(0) === '/') return p;
  var dir = location.pathname.replace(/[^/]*$/, '');
  return dir + p.replace(/^\.\//, '');
}
globalThis.history = {
  pushState: function (s, t, p) { stack.push(resolvePath(p)); },
  replaceState: function (s, t, p) { stack[stack.length - 1] = resolvePath(p); },
  back: function () { stack.pop(); dispatchEvent(new CustomEvent('popstate')); }
};

// No Lovelace here: a host shell with no card wrapper, HK's own event names.
window.hkShell.use({ kind: 'test' });
ok('the test host has no card wrapper; HK\'s own navigation event', window.hkShell.tags.card === null &&
   window.hkShell.navEvent === 'hk-navigate');

// ------------------------------------------------------------ HK test cards
var log = [];
function house(states, user) { return { states: states || {}, user: user || { id: 'u1' }, entities: {}, devices: {}, areas: {} }; }
class TCard extends HTMLElement {
  setConfig(c) { if (c.boom) throw new Error('bad config'); this.config = c; log.push(this.localName + ':setConfig'); }
  _onClient(c) { this.got = c; log.push(this.localName + ':client'); }
}
window.hkHostClient.entry(TCard);
customElements.define('t-card', TCard);
class TView extends HTMLElement {
  setConfig(c) { this.config = c; this.order = ['setConfig']; }
  _onClient(c) { this.got = c; (this.order = this.order || []).push('client'); }
  set narrow(n) { this._narrow = n; this.order.push('narrow'); }
  set index(i) { this._index = i; this.order.push('index'); }
  set cards(c) { this._cards = c; this.order.push('cards'); var self = this; c.forEach(function (k) { self.appendChild(k); }); }
  get cards() { return this._cards || []; }
  connectedCallback() { this.attachedTimes = (this.attachedTimes || 0) + 1; }
}
window.hkHostClient.entry(TView);
customElements.define('t-view', TView);

load(HK_ROOT + '/frontend/shell/hk-view-host.js');
var V = window.hkViewHost;
ok('the view host is defined: create, the card factory, conditions', !!V && typeof V.create === 'function' &&
   typeof V.createCardElement === 'function' && typeof V.holds === 'function');

var h1 = house({ 'light.a': { entity_id: 'light.a', state: 'off', attributes: {} } });
var c1 = window.hkHostClient.from(h1);

// ------------------------------------------------------------------ the card factory
log = [];
var card = V.createCardElement({ type: 'custom:t-card', name: 'A' }, c1);
ok('a custom: card is its own element, by its tag', card instanceof TCard && card.localName === 't-card');
ok('...configured, then handed the client (through the host adapter\'s bridge)', log.join() === 't-card:setConfig,t-card:client' &&
   card.config.name === 'A' && card.client === c1 && card.got === c1, log);

var ph = V.createCardElement({ type: 'picture-glance', entity: 'camera.x' }, c1);
ok('a Lovelace card type HK does not draw: a labelled placeholder', ph.localName === 'hk-card-placeholder' &&
   ph.getAttribute('data-type') === 'picture-glance' && /picture-glance/.test(ph.textContent) && /Home Assistant/.test(ph.textContent), ph.textContent);
var pe = V.createCardElement({ type: 'picture-entity', entity: 'camera.x', show_name: false, show_state: false }, c1);
ok('Lovelace\'s picture-entity (HK\'s camera tiles): HK\'s own hk-picture-entity, fed the client (tests/test_pictureentity.js)',
   pe.localName === 'hk-picture-entity' && pe.client === c1 && V.BUILT_IN['picture-entity'] === 'hk-picture-entity', pe.localName);
var bad = V.createCardElement({ type: 'custom:t-card', boom: true }, c1);
ok('a card whose config throws: a placeholder that says so', bad.localName === 'hk-card-placeholder' && /could not be drawn/.test(bad.textContent));
ok('no type at all: a placeholder', V.createCardElement({}, c1).localName === 'hk-card-placeholder');

log = [];
var grid = V.createCardElement({ type: 'grid', columns: 2, title: 'Rooms', cards: [{ type: 'custom:t-card', n: 1 }, { type: 'entities' }] }, c1);
var box = grid.shadowRoot && grid.shadowRoot.childNodes.filter(function (n) { return n.id === 'box'; })[0];
ok('Lovelace\'s grid card, drawn by HK: hk-view-grid with its cards in a box', grid.localName === 'hk-view-grid' && !!box &&
   box.childNodes.length === 2 && box.childNodes[0] instanceof TCard && box.childNodes[1].localName === 'hk-card-placeholder');
var gridCss = grid.shadowRoot.childNodes[0].textContent;
ok('...two equal tracks, Lovelace\'s gap variable, its title', /repeat\(2,minmax\(0,1fr\)\)/.test(gridCss) &&
   /--grid-card-gap,8px/.test(gridCss) && grid.shadowRoot.childNodes[1].textContent === 'Rooms', gridCss);
ok('...and its children are fed the grid\'s client', box.childNodes[0].got === c1 && grid.client === c1);
var three = V.createCardElement({ type: 'grid', cards: [] });
ok('...three columns unless it says', /repeat\(3,/.test(three.shadowRoot.childNodes[0].textContent));
var hs = V.createCardElement({ type: 'horizontal-stack', cards: [{ type: 'custom:t-card' }, { type: 'custom:t-card' }] }, c1);
var vs = V.createCardElement({ type: 'vertical-stack', cards: [{ type: 'custom:t-card' }] }, c1);
ok('Lovelace\'s stacks: a row and a column', hs.localName === 'hk-view-stack' && /flex-direction:row/.test(hs.shadowRoot.childNodes[0].textContent) &&
   vs.localName === 'hk-view-stack' && /flex-direction:column/.test(vs.shadowRoot.childNodes[0].textContent));

var seen = [];
var cond = V.createCardElement({ type: 'conditional', conditions: [{ condition: 'state', entity: 'light.a', state: 'on' }],
                                 card: { type: 'custom:t-card', n: 'c' } }, c1);
cond.addEventListener('card-visibility-changed', function (e) { seen.push(e.detail.value); });
ok('Lovelace\'s conditional card: hidden while its conditions do not hold, its card not on the page',
   cond.localName === 'hk-view-conditional' && cond.hidden === true && cond.childNodes.length === 0);
var h2 = house({ 'light.a': { entity_id: 'light.a', state: 'on', attributes: {} } }), c2 = window.hkHostClient.from(h2);
window.hkHostClient.bridge(cond, c2);
ok('...shown when they hold: its card on the page and fed, and it says so', cond.hidden === false && cond.childNodes.length === 1 &&
   cond.childNodes[0].got === c2 && seen.join() === 'true', seen);
window.hkHostClient.bridge(cond, c1);
ok('...hidden again', cond.hidden === true && cond.childNodes.length === 0 && seen.join() === 'true,false', seen);

ok('conditions: state, state_not, numeric, screen, user, and / or / not, the legacy form', [
  V.holds({ condition: 'state', entity: 'light.a', state: ['on', 'off'] }, c1),
  !V.holds({ condition: 'state', entity: 'light.a', state_not: 'off' }, c1),
  !V.holds({ condition: 'numeric_state', entity: 'light.a', above: 1 }, c1),
  V.holds({ condition: 'screen', media_query: '(min-width: 640px)' }, c1),
  V.holds({ condition: 'user', users: ['u1'] }, c1) && !V.holds({ condition: 'user', users: ['u2'] }, c1),
  V.holds({ condition: 'and', conditions: [{ condition: 'state', entity: 'light.a', state: 'off' }] }, c1),
  V.holds({ condition: 'or', conditions: [{ condition: 'state', entity: 'light.a', state: 'x' }, { condition: 'state', entity: 'light.a', state: 'off' }] }, c1),
  V.holds({ condition: 'not', conditions: [{ condition: 'state', entity: 'light.a', state: 'on' }] }, c1),
  V.holds({ entity: 'light.a', state: 'off' }, c1),
  !V.holds({ condition: 'state', entity: 'light.missing', state: 'off' }, c1)
].every(Boolean));

// A card whose code has not arrived: configured and fed (the newest client) once it is defined.
log = [];
var lateGrid = V.createCardElement({ type: 'grid', cards: [{ type: 'custom:late-card', n: 'late' }] }, c1);
var late = lateGrid._kids[0];
ok('a card whose code is not loaded yet waits (no setConfig, nothing fed)', !late.config && log.length === 0 && !!late.__hkWaiting);
window.hkHostClient.bridge(lateGrid, c2);          // a newer client while it waits
var lateThen = function () { class LateCard extends TCard {} customElements.define('late-card', LateCard); };

// ------------------------------------------------------------------ the view host
var cfg = { views: [
  { path: 'home', type: 'custom:t-view', cards: [{ type: 'custom:t-card', n: 'h1' }, { type: 'grid', cards: [{ type: 'custom:t-card', n: 'h2' }] }] },
  { path: 'lights', type: 'custom:t-view', cards: [{ type: 'custom:t-card', n: 'l1' }, { type: 'tile', entity: 'light.a' }] },
  { title: 'Old', cards: [{ type: 'custom:t-card', n: 'm1' }] },
  { path: 'sections', type: 'sections', sections: [{ cards: [{ type: 'custom:t-card', n: 's1' }] }, { cards: [{ type: 'custom:t-card', n: 's2' }] }] },
  { path: 'bad', type: 'custom:t-bad-view', cards: [{ type: 'custom:t-card', n: 'b1' }] }
] };
customElements.define('t-bad-view', class extends HTMLElement { setConfig() { throw new Error('no layout'); } });
var container = document.body.appendChild(document.createElement('hk-view-container'));
var slot = container.appendChild(document.createElement('div'));
var told = [], leaves = [], willShow = [], gate = null;
var current = c1;
window.hkHostClient.current = function () { return current; };
var vh = V.create({ container: container, slot: slot, config: cfg, client: c1,
                    willShow: function (view, first) { willShow.push((view.path || view.title) + ':' + first); return gate; },
                    leave: function (p) { leaves.push(p); } });
vh.onView(function (el, view, config, info) {
  told.push({ path: info.path, first: info.first, attached: el.isConnected, shellView: vh.shellParts().view() === el, config: config === cfg });
});

var homeEl;
lateThen();
settle().then(function () {
  ok('...defined late: upgraded, configured, then fed the newest client', late.config && late.config.n === 'late' && late.got === c2 &&
     !late.__hkWaiting && log.join() === 'late-card:setConfig,late-card:client', log);
  return vh.start();
}).then(function (el) {
  homeEl = el;
  var cur = vh.current();
  ok('start(): the view the address names (/dashboard-test/home)', cur.path === 'home' && el instanceof TView && el.parentNode === slot);
  ok('...in Lovelace\'s order: setConfig, the client, narrow, index, cards', el.order.join() === 'setConfig,client,narrow,index,cards', el.order);
  ok('...narrow (a wide window: false) and its index', el._narrow === false && el._index === 0);
  ok('...its cards made by the factory and fed the client', cur.cards.length === 2 && cur.cards[0].got === c1 &&
     cur.cards[1].localName === 'hk-view-grid' && cur.cards[1].client === c1);
  ok('...the shell was told before the view was attached, and knows it', told.length === 1 && told[0].attached === false &&
     told[0].shellView && told[0].first && told[0].config, told);
  var parts = vh.shellParts();
  ok('shellParts: the container, the view shown, its tag, the config', parts.viewContainer() === container && parts.panel() === container &&
     parts.view() === el && parts.view(container) === el && parts.view(slot) === null && parts.dashboardConfig() === cfg &&
     parts.tags.view === 't-view' && parts.tags.viewContainer === 'hk-view-container');
  ok('willShow asked for a first visit', willShow.join() === 'home:true', willShow);
  ok('no scroll on the first view', scrolled === 0);
  // a new client follows to the view and its cards
  current = c2;
  dispatchEvent(new CustomEvent('hk-client-update'));
  ok('a client update (hkHostClient.current()) reaches the view and every card', el.got === c2 && vh.current().cards[0].got === c2 &&
     vh.client() === c2);
  // HK's own navigation: the router hears hkShell.navigate
  window.hkShell.navigate('/dashboard-test/lights');
  return settle();
}).then(function () {
  var cur = vh.current();
  ok('hkShell.navigate moves to the view: Lights in the same slot', cur.path === 'lights' && cur.element.parentNode === slot &&
     slot.childNodes.length === 1 && homeEl.parentNode === null);
  ok('...made with the current client; a placeholder for the Lovelace tile', cur.cards[0].got === c2 &&
     cur.cards[1].localName === 'hk-card-placeholder' && cur.element._index === 1);
  ok('...the shell told first; scrolled to the top', told.length === 2 && told[1].path === 'lights' && !told[1].attached && scrolled === 1);
  ok('...Home is kept (cached)', vh.cached().join() === 'home,lights', vh.cached());
  current = window.hkHostClient.from(house({}));
  var c3 = current;
  dispatchEvent(new CustomEvent('hk-client-update'));
  ok('a client update goes to the view shown only', cur.cards[0].got === c3 && homeEl.got === c2);
  history.back();
  return settle().then(function () { return c3; });
}).then(function (c3) {
  var cur = vh.current();
  ok('the back button (popstate): Home again, the same element', cur.path === 'home' && cur.element === homeEl && homeEl.parentNode === slot);
  ok('...caught up with the client it missed', homeEl.got === c3 && cur.cards[0].got === c3);
  ok('...not a first visit', willShow.join() === 'home:true,lights:true,home:false' && told[2].first === false, willShow);
  var before = told.length;
  stack.push('/dashboard-test/home#doorbell');
  dispatchEvent(new CustomEvent('popstate'));
  return settle().then(function () { return before; });
}).then(function (before) {
  ok('a hash (a pop-up) is not a page change', vh.current().element === homeEl && told.length === before);
  window.hkShell.navigate('/dashboard-test/nowhere');
  return settle();
}).then(function () {
  ok('an unknown view: the first, as Lovelace does', vh.current().path === 'home');
  window.hkShell.navigate('2');           // relative, as a card's ./path is
  return settle();
}).then(function () {
  var cur = vh.current();
  ok('a view without a path is addressed by its index', cur.path === '2' && cur.index === 2);
  ok('...a view type HK cannot draw: its cards in a column, under a note', cur.element.localName === 'hk-view-fallback' &&
     cur.element.childNodes.length === 2 && cur.element.childNodes[1] instanceof TCard, cur.element.localName);
  window.hkShell.navigate('/dashboard-test/sections');
  return settle();
}).then(function () {
  var cur = vh.current();
  ok('a sections view: every section\'s cards', cur.cards.length === 2 && cur.cards[0].config.n === 's1' && cur.cards[1].config.n === 's2');
  window.hkShell.navigate('/dashboard-test/bad');
  return settle();
}).then(function () {
  var cur = vh.current();
  ok('a view whose config throws: its cards in a column, under a note that says so', cur.path === 'bad' &&
     cur.element.localName === 'hk-view-fallback' && /could not be drawn \(no layout\)/.test(cur.element.childNodes[0].textContent) &&
     cur.cards.length === 1 && cur.cards[0].config.n === 'b1', cur.element.childNodes[0] && cur.element.childNodes[0].textContent);
  window.hkShell.navigate('/dashboard-other/home');
  return settle();
}).then(function () {
  ok('another dashboard\'s address leaves', leaves.join() === '/dashboard-other/home' && vh.current().path === 'bad', leaves);
  stack.push('/dashboard-test/home');
  // the newest show wins: a slow first visit is overtaken
  var release;
  gate = new Promise(function (r) { release = r; });
  var slow = vh.show('lights');           // cached: willShow still asked, and awaited
  var fast = vh.show('home');
  release();
  return Promise.all([slow, fast]);
}).then(function (r) {
  gate = null;
  ok('show(): the newest wins; the overtaken one resolves null', r[0] === null && r[1] === homeEl && vh.current().path === 'home');
  ok('willShow is awaited before a view is shown', willShow.slice(-2).join() === 'lights:false,home:false', willShow);
  ok('navigate(path) is hkShell.navigate within this dashboard', (function () {
    var heard = null, off = window.hkShell.onNavigate(function () { heard = location.pathname; });
    vh.navigate('lights'); off();
    return heard === '/dashboard-test/lights';
  })());
  return settle();
}).then(function () {
  ok('...and the router follows it', vh.current().path === 'lights');
  vh.stop();
  window.hkShell.navigate('/dashboard-test/home');
  return settle();
}).then(function () {
  ok('stop(): no more routing', vh.current().path === 'lights');
  ok('Lovelace\'s card helpers, for the cards that ask, when the host has none: the factory', typeof window.loadCardHelpers === 'function');
  return window.loadCardHelpers().then(function (helpers) {
    var el = helpers.createCardElement({ type: 'custom:t-card', n: 'helper' });
    ok('...a custom card made by it, configured', el instanceof TCard && el.config.n === 'helper');
  });
}).then(function () {
  var host = made.filter(function (t) { return /^(hui-|ha-)/.test(t); });
  ok('not one host element made (no hui-*, no ha-*)', host.length === 0, host);
  var threw = false;
  try { V.create({ config: cfg }); } catch (e) { threw = true; }
  ok('create() needs a container', threw);
  print('');
  if (fail) { print('  FAIL ' + fail + ' VIEW HOST TESTS'); throw new Error('view host tests failed'); }
  print('  ALL ' + pass + ' VIEW HOST TESTS PASS');
}).catch(function (e) {
  print('  FAIL the suite threw: ' + e + '\n' + (e && e.stack));
  throw e;
});
