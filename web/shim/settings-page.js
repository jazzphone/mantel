// settings-page.js -- Mantel Settings (served at /settings to every signed-in person, never to a wall tablet).
//
// HK's <hk-settings-panel> full-window with Mantel's host adapter (the same hass home.js builds), as Home
// Assistant's panel_custom mounts it, plus Mantel's own pages (mantel-settings.js), which the panel asks for
// through hkShell.settingsHost(). Who gets what:
//   * an Owner or Admin: HK's settings for the house (reads and the saves Mantel takes go to Mantel's
//     settings store, settings_store.py; a save that needs Home Assistant is refused there and says so)
//     and Mantel's pages their role may use (GET /api/admin/overview `sections`);
//   * everyone else: Me only, and HK's settings are never read;
//   * the first run, before Home Assistant is connected: Mantel's pages only, opening on Connections.
// /hk-settings and /admin send browsers here (server.py), their fragments kept (#/screens/..., #connections).
// first: the page's address prefix (HA App mode, Ingress; '' everywhere else) -- shim/base.js
import { mantelUrl, hkV } from './base.js';
import '../client/hk-client.js';
import '../client/hk-card-state.js';
import '../client/hk-host-shell.js';
import './mantel-shell.js';
import '../cards/hk-metric.js';
import './mantel-client.js';
import './ha-elements.js';
import '/hk/elements/hk-elements.js';
import '/hk/modules/hk-np-strip.js';    // the music players' controls strip (2026-11-09)
import '/hk/modules/hk-roller.js';      // the timer wheels (2026-11-09)
import { Host } from './mantel-host.js';
import { Hub } from './hub.js';
import { startAgain, started } from './boot-retry.js';
import { pageHealth } from './page-health.js';
import { loadRegistry, followRegistry } from './registry-sync.js';
import * as mantelSettings from './mantel-settings.js';
// HK's toast layer: a refused save is told there too
import '/hk/shell/hk-overlays.js';

const darkNow = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
const json = (u) => fetch(u, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });

// `wait` (ms): the page starts again by itself then (boot-retry.js), and says so
function failed(e, wait) {
  const box = document.createElement('main');
  box.id = 'mantel-failed';
  const h = document.createElement('h1');
  h.textContent = 'Mantel Settings couldn’t open';
  const p = document.createElement('p');
  p.textContent = String((e && e.message) || e) + '. ';
  const a = document.createElement('a');
  a.href = mantelUrl('/admin?plain=1');
  a.textContent = 'Open the plain settings page';
  p.append(a, '.');
  if (wait) p.append(' Trying again in ' + Math.round(wait / 1000) + ' s.');
  box.append(h, p);
  document.body.appendChild(box);
}

// ONE failed request at the start (a 503 while Mantel restarts, a socket dropped as it opened) left the page on
// "couldn't open" for good: as the dashboard (web/home.js), it starts again from the top, a little later each
// time, and says when (boot-retry.js). What fails after the start is shown, as before.
const RETRY_KEY = 'mantel_settings_boot_retry';
const hub = new Hub();
window.__mantelHub = hub;
let hostForCaps = null;
let me, inputs = null;
try {
  me = await mantelSettings.start();
  if (mantelSettings.manages()) {
    // the house's settings: Mantel's copy of the house, as the dashboard reads it
    hub.onCapabilities = () => { if (hostForCaps) hostForCaps._publish(); };
    inputs = await Promise.all([
      loadRegistry(mantelUrl('/api/registry')), json(mantelUrl('/api/fixtures')), hub.connect(),
      json(mantelUrl('/api/services')).catch(() => ({})),
    ]);
  }
} catch (e) {
  console.error('[mantel] settings', e);
  await startAgain(RETRY_KEY, e, (wait) => failed(e, wait));      // this start goes no further
}
started(RETRY_KEY);

try {
  window.hkMantelShell.setRole(me.user ? me.user.role : '');
  window.hkMantelShell.setAtTablet(me.at_tablet === true);        // GET /api/admin/overview's, as /api/me's
  window.hkMantelShell.setSettings(mantelSettings.host);
  window.hkMantelClient.useCommands(hub);
  mantelSettings.useCommands(() => hub.commandsEnabled());
  const user = { id: me.user && me.user.ha_user_id, name: me.user && me.user.name, is_owner: me.user && me.user.role === 'owner',
                 is_admin: !!me.user && (me.user.role === 'owner' || me.user.role === 'admin'), credentials: [], mfa_modules: [] };
  let host;
  if (inputs) {
    const [{ registry, digest: registryDigest }, fixtures, , services] = inputs;
    window.hkMantelShell.setServices(services);
    const [config, themes] = await Promise.all([
      hub.read({ type: 'get_config' }).catch(() => ({})),
      hub.read({ type: 'frontend/get_themes' }).catch(() => ({ themes: {}, default_theme: 'default' })),
    ]);
    // DARK OR LIGHT: the device's own appearance. Home Assistant's theme list
    // never says which (its frontend decides that itself), so without this
    // Mantel Settings was always light here (2026-10-24)
    themes.darkMode = darkNow();
    host = new Host({ hub, registry, fixtures, user, config, themes });
    host.installLookups();
    followRegistry(hub, host, mantelUrl('/api/registry'), registryDigest);   // as the dashboard: rooms renamed in HA
    hostForCaps = host;
    if (hub.commandsEnabled()) host._publish();
    window.hkMantelShell.install(host);
    let waiters = [];
    hub.onSnapshot = (m) => { host.applySnapshot(m.entities); const w = waiters; waiters = []; w.forEach((f) => f()); };
    hub.onDiff = (m) => host.applyDiff(m);
    const first = new Promise((res) => waiters.push(res));
    hub.subscribe([], [], true);
    await first;
  } else {
    // Mantel's own pages only: no house connection, nothing of the house read
    host = new Host({ hub, registry: { entities: {}, devices: {}, areas: {}, floors: {} }, fixtures: {}, user,
                      config: {}, themes: { themes: {}, default_theme: 'default', darkMode: darkNow() } });
    window.hkMantelShell.install(host);
  }
  window.__mantel = host;

  // the dashboards' modules HK Settings draws with (the panel loads the rest itself)
  const imp = (u) => import(hkV(u)).catch((e) => console.error('[mantel] could not load', u, e));   // (hkV: base.js)
  for (const m of ['modules/hk-settings.js', 'iconset/hk-icons.js']) await imp('/hk/' + m);
  for (const f of ['hk-settings-model', 'hk-settings-kit', 'hk-settings-features', 'hk-settings']) await imp('/hk/panels/' + f + '.js');

  const el = document.createElement('hk-settings-panel');
  el.id = 'mantel-settings';
  // narrow: one column (the panel's own measure, hk-settings.js: under 700 px wide or 500 px tall)
  const narrow = () => window.innerWidth < 700 || window.innerHeight < 500;
  el.narrow = narrow();
  window.addEventListener('resize', () => { el.narrow = narrow(); });
  el.hass = host.hass;
  document.body.appendChild(el);
  host.onSnapshot = (h) => { el.hass = h; };      // the panel follows the house, as HA hands it each new hass
  window.__mantelSettings = el;
  pageHealth(hub, 'settings').drawn();     // as the dashboard does (a house manager's page has the socket; the others' is dropped)
  // ...and it follows the device when that changes (the evening's switch to dark)
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const t = host.hass && host.hass.themes;
    if (t) t.darkMode = darkNow();
    el.toggleAttribute('dark', darkNow());
  });
  window.__mantelReady = true;
} catch (e) {
  console.error('[mantel] settings', e);
  failed(e);
}
