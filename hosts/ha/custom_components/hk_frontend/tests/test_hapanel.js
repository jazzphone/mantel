// HK as its own Home Assistant panel (Phase 2 P2.6, hosts/ha/frontend/hk-ha-panel.js): the
// element HA's panel_custom makes. From HA's panel object (hass, panel) it makes a client, loads
// the card code (the Lovelace resources and HK's own list), reads the screen's own strategy
// options, generates the dashboard with HK's strategy and draws it with HK's view host in its own
// container, routed under its address, with the HA shell in its panel mode (no card wrapper).
// It follows each new client, builds again on config-refresh, and gives the shell back to
// Lovelace when it leaves the page. No Lovelace element is ever made.
//
// The same small DOM as test_viewhost.js (connected / disconnected callbacks, custom elements).
if (typeof HK_ROOT === 'undefined') throw new Error('HK_ROOT is not set -- run this through tests/run');

var pass = 0, fail = 0;
function ok(name, c, d) {
  if (c) { pass++; print('  ok   ' + name); }
  else { fail++; print('  FAIL ' + name + (d !== undefined ? '   got ' + (function () { try { return JSON.stringify(d); } catch (e) { return String(d); } })() : '')); }
}
function settle() { var p = Promise.resolve(); for (var i = 0; i < 40; i++) p = p.then(function () {}); return p; }

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

// the page's <head>: stylesheets are linked here (HA's resource loader does the same)
document.head = document.root.appendChild(new Node('head'));
document.querySelectorAll = function (sel) {
  return sel.indexOf('link') === 0 ? document.head.childNodes.filter(function (n) { return n.localName === 'link'; }) : [];
};
globalThis.setInterval = globalThis.setInterval || function () { return 0; };
globalThis.clearInterval = globalThis.clearInterval || function () {};
var timers = [];
globalThis.setTimeout = function (f) { timers.push(f); return timers.length; };
globalThis.clearTimeout = function () {};
globalThis.console = globalThis.console || { error: function () {} };
var errors = [];
console.error = function () { errors.push(Array.prototype.slice.call(arguments).map(String).join(' ')); };

// HA's shell from the prelude, in its Lovelace mode (no Lovelace on this page: nothing found)
var S = window.hkShell;
ok('the HA shell, Lovelace mode, with its card wrapper', S.kind === 'ha' && window.hkHAShell.currentMode() === 'lovelace' &&
   S.tags.card === 'hui-card');

// ------------------------------------------------------------ the dashboard's code
var log = [];
class TCard extends HTMLElement {
  setConfig(c) { this.config = c; }
  _onClient(c) { this.got = c; log.push('card:' + (c.states['light.a'] || {}).state); }
}
window.hkHostClient.entry(TCard);
class TView extends HTMLElement {
  setConfig(c) { this.config = c; }
  _onClient(c) { this.got = c; }
  set cards(c) { this._cards = c; var self = this; c.forEach(function (k) { self.appendChild(k); }); }
  get cards() { return this._cards || []; }
}
window.hkHostClient.entry(TView);

// the module loader: what was asked for, in order; the view host loaded from the build
var imported = [];
var gens = [];
var build = 0;
function strategy() {
  return {
    generate: function (opts, client) {
      gens.push({ opts: opts, client: client });
      build++;
      return Promise.resolve({ views: [
        { path: 'home', type: 'custom:t-view', theme: 'HK Kiosk', cards: [{ type: 'custom:t-card', n: build }] },
        { path: 'lights', type: 'custom:t-view', cards: [{ type: 'custom:t-card', n: 'l' }, { type: 'grid', cards: [{ type: 'custom:t-card' }] }] }
      ] });
    },
    shouldRegenerate: function (cfg, a, b) { return Object.keys((a && a.areas) || {}).length !== Object.keys((b && b.areas) || {}).length; }
  };
}

var frontendObj = null;          // the frontend's object, as HA hands a panel
function house(lightState, areas) {
  return {
    states: { 'light.a': { entity_id: 'light.a', state: lightState, attributes: {} } },
    entities: {}, devices: {}, areas: areas || {}, user: { id: 'u1', is_admin: true },
    themes: { themes: { 'HK Kiosk': { 'hk-glass-bg': 'rgba(1,2,3,.4)', modes: { dark: { 'primary-color': '#ff9500' } } } } },
    asked: [],
    callWS: function (msg) {
      wsAsked.push(msg);
      if (msg.type === 'lovelace/config') {
        return Promise.resolve(msg.url_path === 'dashboard-hall'
          ? { strategy: { type: 'custom:hk-dashboard', chips: false } } : { views: [] });
      }
      if (msg.type === 'lovelace/resources') {
        return Promise.resolve([{ id: '1', type: 'module', url: '/hk/cards/hk-tile.js?v=2' },
                                { id: '2', type: 'css', url: '/hk/css/hk-responsive.css' },
                                { id: '3', type: 'module', url: '/local/other-card.js' }]);
      }
      return Promise.reject(new Error('unknown ' + msg.type));
    }
  };
}
var wsAsked = [];

load(HK_ROOT + '/frontend/modules/hk-ha-panel.js');
var P = window.hkHAPanel;
ok('the panel element is defined, once', !!P && customElements.get('hk-ha-panel') && P.tag === 'hk-ha-panel');
P.loader.import = function (url) {
  imported.push(url);
  if (url === '/hk/shell/hk-view-host.js') load(HK_ROOT + '/frontend/shell/hk-view-host.js');
  if (url.split('?')[0] === '/hk/cards/hk-tile.js') {
    // the card code: its elements, HK's cards ready, the strategy
    if (!customElements.get('t-card')) { customElements.define('t-card', TCard); customElements.define('t-view', TView); }
    window.hkCards = { TILE: {} };
    window.hkStrategy = strategy();
  }
  return Promise.resolve({});
};

// ------------------------------------------------------------ HA makes the panel
stack.push('/hk-panel/home');
var el = document.createElement('hk-ha-panel');
frontendObj = house('off');
el.panel = { url_path: 'hk-panel', component_name: 'custom',
             config: { screen: 'dashboard-hall', resources: [['css', '/hk/fonts/sf-pro.css'], ['module', '/hk/cards/hk-tile.js'],
                                                            ['css', '/hk/css/hk-responsive.css']] } };
el.hass = frontendObj;
el.narrow = false;
el.route = { prefix: '/hk-panel', path: '/home' };
document.body.appendChild(el);
settle().then(function () {
  return settle();
}).then(function () {
  var sr = el.shadowRoot;
  var vc = sr && sr.childNodes.filter(function (n) { return n.localName === 'hk-view-container'; })[0];
  var app = vc && vc.childNodes[0];
  var view = app && app.childNodes[0];
  ok('its own container in its shadow root: hk-view-container > #app', !!vc && vc.id === 'view' && app && app.id === 'app');
  ok('the code: the view host first, then the Lovelace resources and HK\'s own list, each once',
     imported[0] === '/hk/shell/hk-view-host.js' && imported.indexOf('/local/other-card.js') > 0 &&
     imported.filter(function (u) { return u.split('?')[0] === '/hk/cards/hk-tile.js'; }).length === 1, imported);
  var links = document.head.childNodes.map(function (n) { return n.href; });
  ok('...the stylesheets linked in the page\'s head, each once', links.length === 2 && links.indexOf('/hk/fonts/sf-pro.css') >= 0 &&
     links.indexOf('/hk/css/hk-responsive.css') >= 0, links);
  var cfgAsk = wsAsked.filter(function (m) { return m.type === 'lovelace/config'; })[0];
  ok('the screen\'s own strategy options read from its dashboard (lovelace/config, a read)', !!cfgAsk && cfgAsk.url_path === 'dashboard-hall');
  ok('...the strategy given that block and HK\'s client, never the frontend\'s object', gens.length === 1 &&
     gens[0].opts.type === 'custom:hk-dashboard' && gens[0].opts.chips === false &&
     window.hkClient.is(gens[0].client) && gens[0].client !== frontendObj && gens[0].client === window.hkHostClient.from(frontendObj));
  ok('the address\'s view drawn by the view host in the panel\'s slot', view instanceof TView && view.config.path === 'home' &&
     view.cards.length === 1 && view.cards[0] instanceof TCard);
  ok('...view and cards handed the client through the host adapter (the frontend\'s object at their entry)',
     view.got === window.hkHostClient.from(frontendObj) && view.cards[0].hass === frontendObj && log.join() === 'card:off', log);
  ok('the HA shell in panel mode: the panel, its container, its view and config', window.hkHAShell.currentMode() === 'panel' &&
     S.panel() === el && S.viewContainer() === vc && S.view() === view && S.dashboardConfig().views.length === 2 &&
     S.dashboard() === null && S.kind === 'ha');
  ok('...no Lovelace card wrapper (containers make children with the view host)', S.tags.card === null &&
     S.tags.viewContainer === 'hk-view-container' && S.tags.view === 't-view' && S.tags.panel === 'hk-ha-panel');
  ok('...the panel\'s address is a dashboard', (frontendObj.panelUrl = 'hk-panel', true) && S.isDashboard() === true);
  ok('the view\'s theme on the container (its own variables, the dark mode\'s over them)',
     vc.style['--hk-glass-bg'] === 'rgba(1,2,3,.4)' && vc.style['--primary-color'] === '#ff9500');

  // ---- each new frontend object: a new client to the view and its cards
  log = [];
  var next = house('on');
  el.hass = next;
  ok('a new frontend object: the view and its cards follow', view.cards[0].hass === next && log.join() === 'card:on' &&
     view.got === window.hkHostClient.from(next), log);

  // ---- routing under the panel's address, in the same slot
  var homeView = view;
  return S.navigate('/hk-panel/lights') && settle().then(function () {
    var lv = app.childNodes[0];
    ok('HK\'s navigation (location-changed) swaps to Lights in the same slot', lv instanceof TView && lv.config.path === 'lights' &&
       app.childNodes.length === 1 && homeView.parentNode === null && S.view() === lv && lv.cards[0].hass === next);
    ok('...Lovelace\'s grid drawn by HK\'s own container', lv.cards[1].localName === 'hk-view-grid');
    ok('...no theme on a view that names none', vc.style['--hk-glass-bg'] === undefined);
    history.back();
    return settle();
  }).then(function () {
    ok('the back button: Home again, the cached element', app.childNodes[0] === homeView);
    // another HA page: HA's own router moves; the panel loads nothing
    S.navigate('/config/integrations');
    return settle();
  }).then(function () {
    ok('an address outside the panel: no page load, the view stays', location.assigned.length === 0 && app.childNodes[0] === homeView);
    history.back();
    return settle();
  }).then(function () {
    // ---- the strategy asks for a new build (a settings change): config-refresh on the panel
    var before = gens.length;
    el.dispatchEvent(new CustomEvent('config-refresh', { bubbles: true }));
    return settle().then(function () { return settle(); }).then(function () {
      var nv = app.childNodes[0];
      ok('config-refresh: built again from the strategy and drawn', gens.length === before + 1 && nv instanceof TView &&
         nv !== homeView && nv.cards[0].config.n === build && app.childNodes.length === 1, gens.length);
      ok('...the shell follows the new view host', S.view() === nv && window.hkHAShell.currentMode() === 'panel');
    });
  }).then(function () {
    // ---- registries changed (shouldRegenerate): built again, after a moment
    var before = gens.length;
    el.hass = house('on', { kitchen: { area_id: 'kitchen' } });
    ok('new registries: a build is due', timers.length > 0);
    timers.splice(0).forEach(function (f) { f(); });
    return settle().then(function () { return settle(); }).then(function () {
      ok('...and made', gens.length === before + 1);
    });
  }).then(function () {
    // ---- leaving the page, and back
    document.body.removeChild(el);
    ok('the panel leaves the page: the shell is Lovelace\'s again', window.hkHAShell.currentMode() === 'lovelace' &&
       S.tags.card === 'hui-card' && S.panel() === null);
    var before = gens.length;
    document.body.appendChild(el);
    ok('...and back: panel mode, the same view host (nothing built again)', window.hkHAShell.currentMode() === 'panel' &&
       S.panel() === el && gens.length === before);
    return settle();
  }).then(function () {
    ok('no Lovelace or HA element was ever made', made.filter(function (t) { return /^(hui|ha)-/.test(t); }).length === 0,
       made.filter(function (t) { return /^(hui|ha)-/.test(t); }));
    ok('no errors', errors.length === 0, errors);

    // ---- a panel with no screen: HK's defaults, no dashboard read
    document.body.removeChild(el);
    wsAsked = [];
    var before = gens.length;
    var el2 = document.createElement('hk-ha-panel');
    el2.panel = { url_path: 'hk-panel', config: { screen: '', resources: [] } };
    el2.hass = house('off');
    document.body.appendChild(el2);
    return settle().then(function () { return settle(); }).then(function () {
      ok('no screen: the strategy with no options, no dashboard read', gens.length === before + 1 &&
         JSON.stringify(gens[gens.length - 1].opts) === '{}' &&
         wsAsked.filter(function (m) { return m.type === 'lovelace/config'; }).length === 0);
      document.body.removeChild(el2);
    });
  }).then(function () {
    // ---- a theme helper: an unknown theme clears what was set
    var box = new HTMLElement('div');
    P.applyTheme(box, { themes: { T: { a: '1' } } }, 'T');
    P.applyTheme(box, { themes: {} }, 'nope');
    ok('applyTheme: an unknown theme leaves nothing behind', box.style['--a'] === undefined);
  });
}).then(function () {
  print('');
  if (fail) { print('  FAIL ' + fail + ' HA PANEL TESTS'); throw new Error('ha panel tests failed'); }
  print('  ALL ' + pass + ' HA PANEL TESTS PASS');
}).catch(function (e) {
  print('  FAIL exception ' + e + '\n' + (e && e.stack));
  throw e;
});
