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
import './shim/mantel-stepup.js';
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
const [registry, user, fixtures, cards] = await Promise.all([
  json(mantelUrl('/api/registry')), json(mantelUrl('/api/me')), json(mantelUrl('/api/fixtures')),
  json(mantelUrl('/api/hk-cards')), hub.connect(),
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
hostForCaps = host;
if (hub.commandsEnabled()) host._publish();     // capabilities came before the host: new clients now act
window.hkMantelShell.install(host);
window.__mantel = host;

// every snapshot (the first, and each after a change of subscription) settles whoever waits for one
let snapshotWaiters = [];
const nextSnapshot = () => new Promise((res) => snapshotWaiters.push(res));
hub.onSnapshot = (m) => { host.applySnapshot(m.entities); const w = snapshotWaiters; snapshotWaiters = []; w.forEach((f) => f()); };
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
const needed = new Set();
let narrowed = false;
let narrowTimer = 0;
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
  slot: document.getElementById('app'),
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
