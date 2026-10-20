// Phase 1 slice 8: the host shell (web/client/hk-host-shell.js) and its Home
// Assistant implementation (hosts/ha/frontend/hk-ha-shell.js). Both are in the
// prelude (tests/run), as they are bootstrapped in HA. Pins what the modules
// did by hand before: HA's own path to the dashboard, the event names and
// their inits, and that a page without a host has nothing to reach into.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run hostshell');

var pass = 0, fail = 0;
function ok(name, c, d) {
  if (c) { pass++; print('  PASS  ' + name); }
  else { fail++; print('  FAIL  ' + name + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); }
}

// ---- a small world: events with their inits, a window bus, history
globalThis.window = globalThis;
globalThis.CustomEvent = function (type, init) { this.type = type; this.init = init; this.detail = init && init.detail; };
var bus = {};
globalThis.addEventListener = function (t, f) { (bus[t] = bus[t] || []).push(f); };
globalThis.removeEventListener = function (t, f) { bus[t] = (bus[t] || []).filter(function (x) { return x !== f; }); };
var fired = [];
globalThis.dispatchEvent = function (e) { fired.push({ on: 'window', e: e }); (bus[e.type] || []).slice().forEach(function (f) { f(e); }); return true; };
var pushed = [];
globalThis.history = { pushState: function (s, t, u) { pushed.push(['push', u]); }, replaceState: function (s, t, u) { pushed.push(['replace', u]); } };

function Node_(tag, kids, extra) {
  this.localName = tag; this.tagName = tag.toUpperCase(); this.kids = kids || []; this.got = [];
  Object.assign(this, extra || {});
}
Node_.prototype.querySelector = function (sel) {
  var out = null, id = sel.charAt(0) === '#' ? sel.slice(1) : null;
  (function w(n) { (n.kids || []).forEach(function (c) {
    if (!out && (id ? c.id === id : (c.localName === sel || (sel.charAt(0) === '.' && c.cls === sel.slice(1))))) out = c;
    if (!out) w(c);
  }); })(this);
  return out;
};
Node_.prototype.dispatchEvent = function (e) { this.got.push(e); fired.push({ on: this.localName, e: e }); return true; };
function shadowed(tag, inner, extra) { var e = new Node_(tag, [], extra); e.shadowRoot = new Node_('#shadow', inner || []); return e; }

var bg = new Node_('hui-view-background'), view = new Node_('hui-view');
var container = new Node_('hui-view-container', [bg, view], { id: 'view' });
var header = new Node_('div', [], { cls: 'header' });
var huiRoot = shadowed('hui-root', [header, container]);
var panel = shadowed('ha-panel-lovelace', [huiRoot], { lovelace: { config: { views: [{ path: 'home' }] } } });
var resolver = new Node_('partial-panel-resolver', [panel]);
var drawer = shadowed('ha-drawer'), sidebar = new Node_('ha-sidebar');
var main = shadowed('home-assistant-main', [drawer, sidebar, resolver]);
var ha = shadowed('home-assistant', [main], { hass: { panels: { 'dashboard-kitchen': { component_name: 'lovelace' }, config: { component_name: 'config' } },
                                                       panelUrl: 'dashboard-kitchen' } });
var lookups = 0;
var body = new Node_('body');
globalThis.document = { body: body, querySelector: function (s) { if (s === 'home-assistant') { lookups++; return ha; } return null; } };

var S = window.hkShell;
ok('the HA shell is installed by the prelude', S.kind === 'ha' && window.hkHAShell && S.navEvent === 'location-changed');
ok('...with HA\'s event names', S.events.moreInfo === 'hass-more-info' && S.events.toast === 'hass-notification');

// ---------------------------------------------------------- HA's own path
ok('root and the overlay root (its shadow root)', S.root() === ha && S.overlayRoot() === ha.shadowRoot);
ok('main, its shadow root, drawer, sidebar, resolver',
   S.main() === main && S.mainRoot() === main.shadowRoot && S.drawer() === drawer && S.sidebar() === sidebar && S.resolver() === resolver);
ok('the dashboard panel', S.panel() === panel);
ok('hui-root and its shadow root', S.dashboard() === huiRoot && S.dashboardRoot() === huiRoot.shadowRoot);
ok('...of a panel passed in, and nothing for none', S.dashboard(panel) === huiRoot && S.dashboard(null) === null);
ok('the view container by name and by id: one element', S.viewContainer() === container && S.viewSlot() === container);
ok('the view, the view background, the toolbar', S.view() === view && S.viewBackground() === bg && S.toolbar() === header);
ok('...in a container passed in, and nothing in none', S.view(container) === view && S.view(null) === null && S.viewBackground(null) === null);
ok('the dashboard config', S.dashboardConfig() === panel.lovelace.config);
ok('is(): by name, either case', S.is(container, 'viewContainer') && S.is({ tagName: 'HUI-VIEW-CONTAINER' }, 'viewContainer') &&
   !S.is(view, 'viewContainer') && !S.is(null, 'view') && !S.is(view, 'nonsense'));
ok('tags for selectors written into a stylesheet', S.tags.drawer + ' > ' + S.tags.sidebar === 'ha-drawer > ha-sidebar');
ok('view kinds and the host\'s own pages', S.viewTags.indexOf('hui-sections-view') >= 0 && S.foreignTags.indexOf('hui-card-preview') >= 0 &&
   S.foreignTags.indexOf('ha-panel-lovelace') >= 0);
ok('one root lookup per question, as before (hk-strategy counts them)', (lookups = 0, S.dashboard(), lookups === 1), lookups);

// the panel straight in main's shadow root (older HA), not under the resolver
main.shadowRoot.kids = [drawer, sidebar, panel];
ok('a panel without the resolver is found too', S.panel() === panel && S.resolver() === null);
main.shadowRoot.kids = [drawer, sidebar, resolver];

ok('on a dashboard: by hass.panels', S.onDashboard() === true);
ha.hass.panelUrl = 'config';
ok('...not on Settings', S.onDashboard() === false);
ha.hass.panelUrl = 'dashboard-kitchen';
globalThis.location = { pathname: '/dashboard-kitchen/home' };
ok('isDashboard: by the address\'s first segment', S.isDashboard() === true);
location.pathname = '/config/integrations';
ok('...false on Settings', S.isDashboard() === false);
var panels = ha.hass.panels; ha.hass.panels = null;
ok('...null while hass has no panels', S.isDashboard() === null);
ha.hass.panels = panels;

// ---------------------------------------------------------- navigation
fired = []; pushed = [];
S.navigate('/dashboard-kitchen/lights');
ok('navigate: a pushState, then location-changed on the window with no init (HA\'s navigate)',
   pushed.length === 1 && pushed[0][1] === '/dashboard-kitchen/lights' && fired.length === 1 &&
   fired[0].on === 'window' && fired[0].e.type === 'location-changed' && fired[0].e.init === undefined, fired);
fired = []; pushed = [];
S.navigate('/x', { detail: { replace: false } });
ok('...an init as the caller wrote it', fired[0].e.init.detail.replace === false && pushed[0][0] === 'push');
fired = []; pushed = [];
S.navigate('/y', undefined, { replace: true });
ok('...replace: a replaceState', pushed[0][0] === 'replace' && pushed[0][1] === '/y');
fired = []; pushed = [];
var card = new Node_('hk-energy-card');
S.announce({ bubbles: true, composed: true }, card);
ok('announce from an element: fired there, bubbling and composed, no history entry',
   pushed.length === 0 && card.got.length === 1 && card.got[0].type === 'location-changed' && card.got[0].init.composed === true);
var heard = 0, f = function () { heard++; };
var off = S.onNavigate(f);
S.announce();
off();
S.announce();
S.onNavigate(f); S.offNavigate(f); S.announce();
ok('onNavigate hears location-changed until it is undone (both ways)', heard === 1, heard);

// ---------------------------------------------------------- sheets, toasts
fired = [];
var tile = new Node_('hk-tile-card');
S.moreInfo('light.kitchen', tile);
var e = tile.got[0];
ok('moreInfo from a card: hass-more-info, bubbling, composed, the entity in detail',
   e && e.type === 'hass-more-info' && e.init.bubbles === true && e.init.composed === true && e.detail.entityId === 'light.kitchen');
ha.got = [];
S.moreInfo('lock.front');
ok('...without a card, from <home-assistant>', ha.got.length === 1 && ha.got[0].detail.entityId === 'lock.front');
S.toast({ message: 'Hi', duration: 12000 });
ok('toast: hass-notification from <home-assistant>, its detail as given',
   ha.got[1].type === 'hass-notification' && ha.got[1].detail.message === 'Hi' && ha.got[1].detail.duration === 12000 && ha.got[1].init.composed);
// Phase 2 P2.5: HA's own detail and toasts, behind the shell's capabilities
ok('hostDetail: HA has a detail dialog (more-info) for any entity', S.hostDetail('scene.evening') === true && S.hostDetail('sun.sun') === true);
ha.got = [];
ok('openHostDetail: hass-more-info from <home-assistant>, bubbling, composed, the entity in detail',
   S.openHostDetail('scene.evening') === true && ha.got.length === 1 && ha.got[0].type === 'hass-more-info' &&
   ha.got[0].init.bubbles === true && ha.got[0].init.composed === true && ha.got[0].detail.entityId === 'scene.evening');
ok('...and nothing without an entity', S.openHostDetail('') === false && ha.got.length === 1);
ok('hostToast: HA draws its own toasts', S.hostToast() === true);
ok('dialogRoot: the document\'s body, where HK\'s confirm sheets have always mounted', S.dialogRoot() === body);
main.got = [];
S.showNotifications();
ok('showNotifications: hass-show-notifications on main', main.got.length === 1 && main.got[0].type === 'hass-show-notifications' &&
   main.got[0].init.composed === true);
ha.got = [];
S.keepAwake(ha);
ok('keepAwake: hass-suspend-when-hidden { suspend: false } on the root', ha.got[0].type === 'hass-suspend-when-hidden' &&
   ha.got[0].detail.suspend === false && ha.got[0].init.bubbles === undefined);
ha.got = [];
var rootWas = ha.hass;
ha.hass = { suspendWhenHidden: false };
S.keepAwake(ha);
ok('keepAwake: nothing to ask when the frontend already keeps the page connected', ha.got.length === 0);
ha.hass = { user: { name: 'Jo', is_admin: true }, panels: { map: { title: 'map', icon: 'mdi:map' } },
            localize: function (k) { return k === 'panel.map' ? 'Map' : ''; } };
var side = S.sidebarData();
ok('sidebarData(): the frontend\'s user, panels and their titles', side.user.name === 'Jo' && side.panels.map.icon === 'mdi:map' &&
   side.localize('panel.map') === 'Map');
ha.hass = rootWas;
var sent = [], held = [];
ha.hass = { connection: { sendMessage: function (m) { sent.push(m.type); },
                          sendMessagePromise: function (m) { sent.push(m.type); return Promise.resolve('answer'); } } };
ok('holdWrites: in place on the frontend\'s socket', S.holdWrites(function (m) { return m.type === 'call_service'; },
                                                            function (m) { held.push(m.type); }) === true);
ha.hass.connection.sendMessage({ type: 'call_service' });
ha.hass.connection.sendMessagePromise({ type: 'call_service' });
ha.hass.connection.sendMessage({ type: 'get_states' });
ha.hass.connection.sendMessagePromise({ type: 'get_states' });
ok('...a write is held and told, a read still goes', held.join() === 'call_service,call_service' && sent.join() === 'get_states,get_states');
ha.hass = {};
ok('...without a socket yet: not in place', S.holdWrites(function () { return true; }, function () {}) === false);
ha.hass = rootWas;
globalThis.customElements = { get: function (n) { return n === 'home-assistant' ? function () {} : undefined; } };
ok('defined(): HA\'s element in the current registry', S.defined() === true);

// ---------------------------------------------------------- the sidebar button (P2.4)
// The settings panel's narrow-window button that opens HA's sidebar: HA's own
// element, made and fed here (the panel names no HA element).
var made = [];
document.createElement = function (t) { var n = new Node_(t); made.push(n); return n; };
ok('menuButton: none while HA has not defined its button', S.menuButton(null, { narrow: true }) === null && made.length === 0);
globalThis.customElements = { get: function (n) { return n === 'home-assistant' || n === 'ha-menu-button' ? function () {} : undefined; } };
var frontend = { states: {} }, mb = S.menuButton(null, { narrow: true, client: window.hkHAClient.from(frontend) });
ok('...HA\'s <ha-menu-button>, handed the frontend\'s object for the client, and narrow',
   mb && mb.localName === 'ha-menu-button' && made.length === 1 && mb.hass === frontend && mb.narrow === true, mb);
ok('...the same button again, with only what is given handed to it', S.menuButton(mb, { narrow: false }) === mb &&
   made.length === 1 && mb.narrow === false && mb.hass === frontend);
var frontend2 = { states: {} };
S.menuButton(mb, { client: window.hkHAClient.from(frontend2) });
ok('...a new client: its object, narrow untouched', mb.hass === frontend2 && mb.narrow === false);

// ---------------------------------------------------------- HK's own panel (P2.6)
// hk-ha-panel.js on screen: the dashboard's parts are the panel's and its view host's,
// no Lovelace card wrapper; the rest (root, overlays, sidebar, events) stays HA's.
ok('the Lovelace mode by default', window.hkHAShell.currentMode() === 'lovelace' && S.tags.card === 'hui-card');
var hkPanel = shadowed('hk-ha-panel'), vc = new Node_('hk-view-container', [], { id: 'view' }), gv = new Node_('hk-grid-view');
var viewListeners = [], vhCfg = { views: [{ path: 'home' }] }, shown = null;
var fakeHost = {
  shellParts: function () {
    return { panel: function () { return vc; }, viewContainer: function () { return vc; }, viewSlot: function () { return vc; },
             view: function (c) { return (c === undefined || c === vc) ? shown : null; },
             dashboardConfig: function () { return vhCfg; },
             tags: { viewContainer: 'hk-view-container', view: shown ? shown.localName : null } };
  },
  onView: function (fn) { viewListeners.push(fn); return function () { viewListeners = viewListeners.filter(function (x) { return x !== fn; }); }; }
};
window.hkHAShell.ownPanel(hkPanel, fakeHost, 'hk-panel');
ok('ownPanel: the panel mode, HA\'s kind and events kept', window.hkHAShell.currentMode() === 'panel' && S.kind === 'ha' &&
   S.navEvent === 'location-changed' && S.events.moreInfo === 'hass-more-info');
ok('...the panel is the panel element; no hui-root, toolbar or view background',
   S.panel() === hkPanel && S.dashboard() === null && S.dashboardRoot() === null && S.toolbar() === null && S.viewBackground() === null);
ok('...the view container and the config are the view host\'s', S.viewContainer() === vc && S.viewSlot() === vc &&
   S.dashboardConfig() === vhCfg && S.view() === null);
ok('...no Lovelace card wrapper: children are made by the view host', S.tags.card === null && !S.is(new Node_('hui-card'), 'card'));
ok('...tags: the panel\'s own names, no dashboard', S.tags.panel === 'hk-ha-panel' && S.tags.dashboard === null &&
   S.tags.viewContainer === 'hk-view-container' && S.is(vc, 'viewContainer') && S.tags.viewBackground === null);
ok('...HA\'s root, overlay root, sidebar and drawer as before', S.root() === ha && S.overlayRoot() === ha.shadowRoot &&
   S.sidebar() === sidebar && S.drawer() === drawer);
shown = gv;
viewListeners.slice().forEach(function (fn) { fn(gv, vhCfg.views[0], vhCfg, { first: true, path: 'home' }); });
ok('...a new view: answered again (its name in the tags, the view itself)', S.view() === gv && S.view(vc) === gv &&
   S.tags.view === 'hk-grid-view' && S.is(gv, 'view'));
ha.hass.panelUrl = 'hk-panel';
location.pathname = '/hk-panel/home';
ok('...on the panel: a dashboard (both questions)', S.onDashboard() === true && S.isDashboard() === true);
ha.hass.panelUrl = 'config';
location.pathname = '/config/integrations';
ok('...elsewhere: as HA says', S.onDashboard() === false && S.isDashboard() === false);
ha.hass.panelUrl = 'dashboard-kitchen';
location.pathname = '/dashboard-kitchen/home';
ok('...a Lovelace dashboard is still one', S.onDashboard() === true && S.isDashboard() === true);
window.hkHAShell.lovelace(new Node_('hk-ha-panel'));
ok('lovelace(another panel): the panel in charge stays', window.hkHAShell.currentMode() === 'panel' && S.panel() === hkPanel);
window.hkHAShell.lovelace(hkPanel);
ok('lovelace(): Lovelace\'s answers again, the wrapper back', window.hkHAShell.currentMode() === 'lovelace' &&
   S.panel() === panel && S.dashboard() === huiRoot && S.tags.card === 'hui-card' && S.tags.panel === 'ha-panel-lovelace' &&
   S.viewContainer() === container && S.dashboardConfig() === panel.lovelace.config);
viewListeners.slice().forEach(function (fn) { fn(gv, vhCfg.views[0], vhCfg, { first: false, path: 'home' }); });
ok('...a view after leaving changes nothing (its listener is gone)', viewListeners.length === 0 &&
   window.hkHAShell.currentMode() === 'lovelace' && S.tags.card === 'hui-card');
window.hkHAShell.lovelace();
ok('...and again is nothing', window.hkHAShell.currentMode() === 'lovelace' && S.panel() === panel);

// ---------------------------------------------------------- no host
S.use(null);
ok('without a host: no elements', S.kind === 'none' && S.root() === null && S.overlayRoot() === null && S.panel() === null &&
   S.viewContainer() === null && S.dashboardConfig() === null && !S.is(container, 'viewContainer') && S.isDashboard() === null);
ok('...HK\'s own neutral event names', S.navEvent === 'hk-navigate' && S.events.moreInfo === 'hk-more-info' && S.events.toast === 'hk-toast');
ok('...a sheet or toast with nowhere to go is nothing', S.moreInfo('light.x') === null && S.toast({ message: 'x' }) === null);
ok('...no detail and no toasts of its own (HK\'s generic sheet and toast layer)', S.hostDetail('light.x') === false &&
   S.openHostDetail('light.x') === false && S.hostToast() === false);
ok('...HK\'s dialogs mount on the body when there is no overlay root', S.dialogRoot() === body);
var own = new Node_('div', [], { id: 'hk-shell-root' });
S.use({ kind: 'mantel', overlayRoot: function () { return own; } });
ok('a host with an overlay root and no dialog root of its own: the overlay root', S.dialogRoot() === own && S.hostDetail('x') === false);
S.use({ kind: 'test', hostDetail: function () { throw new Error('boom'); }, hostToast: function () { throw new Error('boom'); },
        dialogRoot: function () { throw new Error('boom'); } });
ok('a throwing capability says no (false), a throwing dialog root null', S.hostDetail('x') === false && S.hostToast() === false && S.dialogRoot() === null);
S.use(null);
fired = [];
S.navigate('/z');
ok('...navigation still moves and announces itself', fired[0].e.type === 'hk-navigate' && pushed[pushed.length - 1][1] === '/z');
ok('...on a dashboard (nothing says otherwise), host not defined', S.onDashboard() === true && S.defined() === false);
ok('...no sidebar button to place', S.menuButton(null, { narrow: true }) === null && S.menuButton(mb, { narrow: true }) === null);
S.use({ kind: 'test', tags: { viewContainer: 'x-view' }, panel: function () { throw new Error('boom'); } });
ok('a host\'s omissions keep the defaults; a throwing lookup is null', S.kind === 'test' && S.tags.view === null &&
   S.tags.viewContainer === 'x-view' && S.panel() === null && S.root() === null);
S.use(window.hkHAShell);
ok('the HA shell back', S.kind === 'ha' && S.panel() === panel);

// ---------------------------------------- the product's name, HA's places, the docs
// Home Assistant's text is HK Frontend's, unchanged: its name, HA's own places
// as they are, and its wiki. (Mantel's answers: tests/test_mantel_product_name.py)
function same(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), got); }
same('in HA the product is HK Frontend', S.productName(), 'HK Frontend');
same('...a place in HA\'s settings is said as it is', S.haPlace('Devices & Services → HK Frontend → Add feature'),
     'Devices & Services → HK Frontend → Add feature');
same('...and a thing of HA\'s own as it is', S.haName('HK Frontend device'), 'HK Frontend device');
same('...the docs are HK Frontend\'s wiki', [S.docsUrl('Sleep-Screen'), S.docsUrl('Your-Own-Dashboard', 'live-tv')],
     ['https://github.com/jazzphone/hk-frontend/wiki/Sleep-Screen', 'https://github.com/jazzphone/hk-frontend/wiki/Your-Own-Dashboard#live-tv']);
S.use({ kind: 'test', productName: function () { return 'Elsewhere'; }, haPlace: function (p) { return 'Home Assistant → ' + p; },
        haName: function (n) { return n + ' in Home Assistant'; }, docsUrl: function () { return null; } });
same('a host names the product its own way', [S.productName(), S.haPlace('A → B'), S.haName('X'), S.docsUrl('Sleep-Screen')],
     ['Elsewhere', 'Home Assistant → A → B', 'X in Home Assistant', null]);
S.use({ kind: 'test', productName: function () { throw new Error('boom'); }, haPlace: function () { throw new Error('boom'); },
        haName: function () { throw new Error('boom'); }, docsUrl: function () { throw new Error('boom'); } });
same('a throwing host leaves HK\'s own words, and no docs link', [S.productName(), S.haPlace('A → B'), S.haName('X'), S.docsUrl('Sleep-Screen')],
     ['HK Frontend', 'A → B', 'X', null]);
S.use(window.hkHAShell);

// HOME ASSISTANT IN HK'S MENU (haNav, haNavigate, openHaMenu): in Home Assistant the section is its own sidebar and a
// row is a navigation of its own, as always; a throwing host offers no rows and opens nothing
pushed.length = 0;
ok('Home Assistant: the section is its own sidebar', S.haNav() === 'own');
S.haNavigate('/config/dashboard');
ok('...a row is Home Assistant\'s own navigation', pushed.length === 1 && pushed[0][1] === '/config/dashboard', pushed);
ok('...and HK opens its sidebar itself (openHaMenu: false)', S.openHaMenu() === false);
S.use({ kind: 'test', haNav: function () { throw new Error('boom'); }, openHaMenu: function () { throw new Error('boom'); } });
ok('a throwing host: no Home Assistant rows, nothing opened', S.haNav() === null && S.openHaMenu() === false);
S.use(window.hkHAShell);

print('');
if (fail) { print('  FAIL ' + fail + ' HOST SHELL TESTS'); throw new Error('host shell tests failed'); }
print('  ALL ' + pass + ' HOST SHELL TESTS PASS');
