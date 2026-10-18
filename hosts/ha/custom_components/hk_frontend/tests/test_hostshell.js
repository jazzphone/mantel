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
globalThis.document = { querySelector: function (s) { if (s === 'home-assistant') { lookups++; return ha; } return null; } };

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
globalThis.customElements = { get: function (n) { return n === 'home-assistant' ? function () {} : undefined; } };
ok('defined(): HA\'s element in the current registry', S.defined() === true);

// ---------------------------------------------------------- no host
S.use(null);
ok('without a host: no elements', S.kind === 'none' && S.root() === null && S.overlayRoot() === null && S.panel() === null &&
   S.viewContainer() === null && S.dashboardConfig() === null && !S.is(container, 'viewContainer') && S.isDashboard() === null);
ok('...HK\'s own neutral event names', S.navEvent === 'hk-navigate' && S.events.moreInfo === 'hk-more-info' && S.events.toast === 'hk-toast');
ok('...a sheet or toast with nowhere to go is nothing', S.moreInfo('light.x') === null && S.toast({ message: 'x' }) === null);
fired = [];
S.navigate('/z');
ok('...navigation still moves and announces itself', fired[0].e.type === 'hk-navigate' && pushed[pushed.length - 1][1] === '/z');
ok('...on a dashboard (nothing says otherwise), host not defined', S.onDashboard() === true && S.defined() === false);
S.use({ kind: 'test', tags: { viewContainer: 'x-view' }, panel: function () { throw new Error('boom'); } });
ok('a host\'s omissions keep the defaults; a throwing lookup is null', S.kind === 'test' && S.tags.view === null &&
   S.tags.viewContainer === 'x-view' && S.panel() === null && S.root() === null);
S.use(window.hkHAShell);
ok('the HA shell back', S.kind === 'ha' && S.panel() === panel);

print('');
if (fail) { print('  FAIL ' + fail + ' HOST SHELL TESTS'); throw new Error('host shell tests failed'); }
print('  ALL ' + pass + ' HOST SHELL TESTS PASS');
