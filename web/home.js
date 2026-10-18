// home.js -- draws one HK dashboard page (default: Home) with HK's own card code, no Lovelace.
//
//   /<dashboard>/home   e.g. /dashboard-kitchen/home   (/home goes to the default screen)
//
// What Lovelace did (hui-root, hui-view, hui-card) is a few lines here: run HK's strategy to get the
// view, create each card element, setConfig, give it `hass`, hand the built elements to the view.
import './client/hk-client.js';
import './client/hk-card-state.js';
import './client/hk-host-shell.js';
import './shim/mantel-shell.js';
import './cards/hk-metric.js';
import './shim/mantel-client.js';
import './shim/ha-elements.js';
import { Host, toast } from './shim/hass-shim.js';
import { Hub } from './shim/hub.js';
import { installCardBridge, createCardElement, setCardHost } from './shim/cards-bridge.js';

const T0 = performance.now();
const marks = { module_start: Math.round(T0) };   // ms since navigation start; the others are ms after it
const mark = (n) => { marks[n] = Math.round(performance.now() - T0); };
window.__mantelMarks = marks;
window.__mantelHub = null;

const seg = location.pathname.split('/')[1];
const pageKey = location.pathname.split('/')[2] || 'home';

const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const hub = new Hub();
window.__mantelHub = hub;
const [registry, user, fixtures, cards] = await Promise.all([
  json('/api/hass-registry'), json('/api/me'), json('/api/fixtures'), json('/api/hk-cards'), hub.connect(),
]);
mark('inputs');

const [config, themes] = await Promise.all([
  hub.read({ type: 'get_config' }).catch(() => ({})),
  hub.read({ type: 'frontend/get_themes' }).catch(() => ({ themes: {}, default_theme: 'default' })),
]);
const host = new Host({
  hub, registry, fixtures, user: { id: user.ha_user_id, name: user.name, is_owner: user.role === 'owner',
                                  is_admin: user.role === 'owner' || user.role === 'admin', credentials: [], mfa_modules: [] },
  config, themes,
});
host.installLookups();
window.hkMantelShell.install(host);
installCardBridge();
window.__mantel = host;

const first = new Promise((res) => { hub.onSnapshot = (m) => { host.applySnapshot(m.entities); res(); }; });
hub.onDiff = (m) => host.applyDiff(m);
hub.subscribe([], [], true);
await first;
mark('states');

// HA's frontend keeps /<dashboard>/<view>; so does this page (HK reads the first segment).
const imp = (u) => import(u).catch((e) => console.error('[mantel] could not load', u, e));
for (const m of ['modules/hk-settings.js', 'iconset/hk-icons.js', 'modules/tesla-viewport.js', 'modules/hk-tap.js',
                 'modules/hk-header.js', 'modules/hk-loader.js', 'cards/hk-strategy.js']) await imp('/hk/' + m);
await Promise.all(cards.map((c) => imp('/hk/cards/' + c)));
mark('code');
if (!(window.hkCards && window.hkCards.TILE)) {
  await new Promise((res) => window.addEventListener('hk-cards-ready', res, { once: true }));
}

const app = document.getElementById('app');
const cfg = await window.hkStrategy.generate({}, host.hass);
mark('strategy');
const view = cfg.views.find((v) => v.path === pageKey) || cfg.views[0];
window.__mantelView = view;

function build(cardCfg, hass) {
  const el = createCardElement(cardCfg);
  setCardHost(el, hass);
  return el;
}

const viewEl = document.createElement(view.type.slice(7));
await customElements.whenDefined(view.type.slice(7));
viewEl.setConfig(view);
viewEl.hass = host.hass;
const els = (view.cards || []).map((c) => build(c, host.hass));
app.appendChild(viewEl);
viewEl.cards = els;
// the host shell now knows the view: the sky and the tab bar find it (mantel-shell.js)
window.hkMantelShell.setPage(viewEl, cfg);
mark('rendered');

// every change in the house: a new hass object for the view and each card (as HA does)
host.onHass = (h) => { viewEl.hass = h; for (const el of els) setCardHost(el, h); };

// After the first paint, note which states the screen really reads and narrow the hub subscription
// to those: the strategy needed the whole house to decide what to draw, the cards do not.
if (new URLSearchParams(location.search).get('narrow') !== '0') {
  requestAnimationFrame(() => setTimeout(() => {
    host.reads.clear();
    host.recording = true;
    host.onHass(host.hass);                      // one more pass over every card, recorded
    setTimeout(() => {
      host.recording = false;
      const ids = [...host.reads].filter((k) => host._states[k]);
      window.__mantelNarrow = ids.length;
      hub.subscribe(ids, [], false);             // snapshot arrives again, then only these entities' diffs
      mark('narrowed');
    }, 1500);
  }, 1500));
}
window.__mantelReady = true;
