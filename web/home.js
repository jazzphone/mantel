// home.js -- Mantel's bootstrap for an HK dashboard: every page of it, with HK's own card code and
// no Lovelace.
//
//   /<dashboard>/<view>   e.g. /dashboard-kitchen/home, /dashboard-kitchen/lights
//                         (/home goes to the default screen's Home)
//
// What Lovelace does (hui-root, hui-view, hui-card) is HK's view host (web/hk/shell/hk-view-host.js):
// it draws the view the address names from the strategy's output, makes each card, hands it the
// client through the host adapter's bridge, follows client updates and swaps views on HK's own
// navigation. This file only connects Mantel's pieces: the hub, the host snapshot and its client,
// the host shell, and the narrowing of the hub subscription to what the pages seen so far read.
// first: the page's address prefix (HA App mode, Ingress; '' everywhere else) -- shim/base.js
import { mantelUrl } from './shim/base.js';
import './client/hk-client.js';
import './client/hk-card-state.js';
import './client/hk-host-shell.js';
import './shim/mantel-shell.js';
import './cards/hk-metric.js';
import './shim/mantel-client.js';
import './shim/ha-elements.js';
import '/hk/elements/hk-elements.js';
import { Host, toast } from './shim/mantel-host.js';
import { Hub } from './shim/hub.js';
import '/hk/shell/hk-view-host.js';
// HK's own toast layer: Mantel draws no toast of its own (hkShell.hostToast() is false)
import '/hk/shell/hk-overlays.js';

const T0 = performance.now();
const marks = { module_start: Math.round(T0) };   // ms since navigation start; the others are ms after it
const mark = (n) => { marks[n] = Math.round(performance.now() - T0); };
window.__mantelMarks = marks;
window.__mantelHub = null;

const seg = location.pathname.split('/')[1];

const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const hub = new Hub();
window.__mantelHub = hub;
// Commands: only a server whose operator turned the gateway on sends `capabilities` (commands: true);
// clients made after that carry actions (mantel-client.js). Until then, and on every other server,
// the action port refuses with commands_disabled and nothing is sent.
window.hkMantelClient.useCommands(hub);
let hostForCaps = null;
hub.onCapabilities = () => { if (hostForCaps) hostForCaps._publish(); };
const [registry, user, fixtures, cards, , services] = await Promise.all([
  json(mantelUrl('/api/registry')), json(mantelUrl('/api/me')), json(mantelUrl('/api/fixtures')),
  json(mantelUrl('/api/hk-cards')), hub.connect(),
  // Music Assistant / go2rtc under Mantel's own address, when this server serves them (media_proxy.py)
  json(mantelUrl('/api/services')).catch(() => ({})),
]);
window.hkMantelShell.setServices(services);
window.hkMantelShell.setRole(user.role);
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
hostForCaps = host;
if (hub.commandsEnabled()) host._publish();     // capabilities came before the host: new clients now act
window.hkMantelShell.install(host);
window.__mantel = host;

// every snapshot (the first, and each after a change of subscription) settles whoever waits for one
let snapshotWaiters = [];
let narrowed = false;                  // (narrowing: below) declared here, read by every snapshot
const houseIds = new Set();            // every entity id of the house, from each whole-house snapshot
const needed = new Set();              // the states the narrowed subscription keeps (narrowing: below)
let missTimer = 0;
// KEEP ONE MORE STATE: added to what the narrowed subscription keeps, and, once the page has narrowed,
// the hub asked again (batched). Before that the whole house is here, and narrowing keeps `needed`.
function keep(id) {
  if (typeof id !== 'string' || needed.has(id) || !houseIds.has(id)) return;
  needed.add(id);
  if (!narrowed) return;
  window.__mantelNarrow = needed.size;
  clearTimeout(missTimer);
  missTimer = setTimeout(() => { if (narrowed) hub.subscribe([...needed], [], false); }, 150);
}
// A NOTIFICATION'S SHEET (hk-notify.js): a tap on the banner opens its accessory's sheet -- for what a
// camera sees, the camera's, live -- or its camera's from the picture. Often nothing on the pages seen
// reads that entity (the alarm, a doorbell's camera, a door on another page), so the narrowed page has
// no state for it: the sheet could not open, nor HK's generic one, and the tap only took the banner
// away (2026-10-19). Kept as the notification arrives, so its state is here well before the tap.
window.addEventListener('hk-house-event', (e) => {
  const n = e && e.detail;
  if (n && n.type === 'notification') [n.sheet, n.entity, n.camera].forEach(keep);
});
const nextSnapshot = () => new Promise((res) => snapshotWaiters.push(res));
hub.onSnapshot = (m) => { if (!narrowed) for (const id of Object.keys(m.entities || {})) houseIds.add(id); host.applySnapshot(m.entities); const w = snapshotWaiters; snapshotWaiters = []; w.forEach((f) => f()); };
const first = nextSnapshot();
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

// THE HOUSE'S POP-UPS (hk-detail.js, `popup` through the same event): asked for on whatever page is up, the
// sheet opens at once and needs the state of what it shows -- a doorbell's camera, the alarm, the accessories
// of a group (those without a state are left out of the sheet), a card's entities. Nothing on the pages seen
// need read them, so the narrowed page held none of it (a camera pop-up opened nothing, 2026-10-19). Unlike a
// notification, nothing arrives ahead of it to keep them on: every one a pop-up names is kept from the start
// (any string of a pop-up that is an entity of the house: its entity, entities, cards), and again when the
// pop-ups change.
function keepPopups() {
  const S = window.hkSettings;
  const walk = (v) => {
    if (typeof v === 'string') keep(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  if (S) walk([S.get('popups', null) || [], S.get('security.alarm', null)]);
}
keepPopups();
if (window.hkSettings && window.hkSettings.onChange) window.hkSettings.onChange(keepPopups);
if (!(window.hkCards && window.hkCards.TILE)) {
  await new Promise((res) => window.addEventListener('hk-cards-ready', res, { once: true }));
}

const cfg = await window.hkStrategy.generate({}, host.client);
mark('strategy');

// NARROWING: after a page is first drawn, note which states the screen really reads and narrow the hub
// subscription to those (with the pages seen before: a cached page keeps its cards and catches up when
// shown again). The strategy needed the whole house to decide what to draw, the cards do not. A page
// not seen yet widens the subscription again first, so it is drawn with the whole house.
const narrowing = new URLSearchParams(location.search).get('narrow') !== '0';
let narrowTimer = 0;
// SELF-HEALING: every entity id the house has (from each whole-house snapshot). A card that reads one
// after the page narrowed -- a timer, a later render, a path the recorded pass missed -- adds it, and the
// hub is asked again (batched), so the card never stays "unknown" (seen on the Vacuums page, 2026-10-18).
host.onMiss = (id) => { if (narrowed) keep(id); };
async function widen() {
  if (!narrowed) return;
  narrowed = false;
  clearTimeout(narrowTimer);
  host.recording = false;
  const got = nextSnapshot();
  hub.subscribe([], [], true);
  await got;
}
function narrowSoon() {
  if (!narrowing) return;
  clearTimeout(narrowTimer);
  narrowTimer = setTimeout(() => requestAnimationFrame(() => {
    host.reads.clear();
    host.recording = true;
    viewHost.refresh();                          // one more pass over every card on the page, recorded
    narrowTimer = setTimeout(() => {
      host.recording = false;
      for (const k of host.reads) if (host._states[k]) needed.add(k);
      window.__mantelNarrow = needed.size;
      narrowed = true;
      hub.subscribe([...needed], [], false);     // snapshot arrives again, then only these entities' diffs
      mark('narrowed');
    }, 1500);
  }), 1500);
}

const viewHost = window.hkViewHost.create({
  container: document.getElementById('view'),
  config: cfg,
  client: host.client,
  base: '/' + seg,
  willShow: (view, firstVisit) => (firstVisit ? widen() : null),
});
window.__mantelViewHost = viewHost;
// the host shell knows the view host: the sky and the tab bar find the view, the menu the config
window.hkMantelShell.attach(viewHost);
viewHost.onView((el, view, config, info) => {
  window.__mantelView = view;
  if (info.first) narrowSoon();
});
await viewHost.start();
mark('rendered');

// the house's changes reach the view host as client updates (hkHostClient.current()); the smoke and
// /dev tools hook here to see each new snapshot
host.onSnapshot = (s) => { if (window.__mantelOnSnapshot) window.__mantelOnSnapshot(s); };
window.__mantelReady = true;
