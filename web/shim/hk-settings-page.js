// hk-settings-page.js -- HK Settings inside Mantel (served at /hk-settings to Owners and Admins).
//
// Mounts HK's <hk-settings-panel> full-window with Mantel's host adapter (the same hass home.js builds), as
// Home Assistant's panel_custom does with its own. Reads and the saves Mantel takes go to Mantel's settings
// store (settings_store.py); a save that needs Home Assistant is refused there and says so.
// first: the page's address prefix (HA App mode, Ingress; '' everywhere else) -- shim/base.js
import { mantelUrl } from './base.js';
import '../client/hk-client.js';
import '../client/hk-card-state.js';
import '../client/hk-host-shell.js';
import './mantel-shell.js';
import '../cards/hk-metric.js';
import './mantel-client.js';
import './ha-elements.js';
import '/hk/elements/hk-elements.js';
import { Host } from './mantel-host.js';
import { Hub } from './hub.js';
// HK's toast layer: a refused save is told there too
import '/hk/shell/hk-overlays.js';

const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const hub = new Hub();
window.__mantelHub = hub;
window.hkMantelClient.useCommands(hub);
let hostForCaps = null;
hub.onCapabilities = () => { if (hostForCaps) hostForCaps._publish(); };
const [registry, user, fixtures, , services] = await Promise.all([
  json(mantelUrl('/api/registry')), json(mantelUrl('/api/me')), json(mantelUrl('/api/fixtures')), hub.connect(),
  json(mantelUrl('/api/services')).catch(() => ({})),
]);
window.hkMantelShell.setServices(services);
window.hkMantelShell.setRole(user.role);
document.getElementById('mantel-back').setAttribute('href', mantelUrl('/home'));
document.documentElement.style.setProperty('--mantel-bar-h', document.getElementById('mantel-bar').offsetHeight + 'px');

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
hostForCaps = host;
if (hub.commandsEnabled()) host._publish();
window.hkMantelShell.install(host);
window.__mantel = host;

let waiters = [];
hub.onSnapshot = (m) => { host.applySnapshot(m.entities); const w = waiters; waiters = []; w.forEach((f) => f()); };
hub.onDiff = (m) => host.applyDiff(m);
const first = new Promise((res) => waiters.push(res));
hub.subscribe([], [], true);
await first;

// the dashboards' modules HK Settings draws with (the panel loads the rest itself)
const imp = (u) => import(u).catch((e) => console.error('[mantel] could not load', u, e));
for (const m of ['modules/hk-settings.js', 'iconset/hk-icons.js']) await imp('/hk/' + m);
for (const f of ['hk-settings-model', 'hk-settings-kit', 'hk-settings-features', 'hk-settings']) await imp('/hk/panels/' + f + '.js');

const el = document.createElement('hk-settings-panel');
el.id = 'proof-hk-settings';
el.narrow = window.innerWidth < 900;
window.addEventListener('resize', () => { el.narrow = window.innerWidth < 900; });
el.hass = host.hass;
document.body.appendChild(el);
host.onSnapshot = (h) => { el.hass = h; };      // the panel follows the house, as HA hands it each new hass
window.__mantelHkSettings = el;
window.__mantelReady = true;
