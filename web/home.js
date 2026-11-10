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
import { mantelUrl, hkV } from './shim/base.js';
import './client/hk-client.js';
import './client/hk-card-state.js';
import './client/hk-host-shell.js';
import './shim/mantel-shell.js';
import './cards/hk-metric.js';
import './shim/mantel-client.js';
import './shim/mantel-native.js';     // the iPhone and iPad app's hooks (nothing without its bridge)
import './shim/ha-elements.js';
import '/hk/elements/hk-elements.js';
import '/hk/modules/hk-np-strip.js';    // the music players' controls strip (2026-11-09)
import '/hk/modules/hk-roller.js';      // the timer wheels (2026-11-09)
import '/hk/modules/hk-vacuum-art.js';  // the vacuum drawn (2026-11-09)
import { Host, toast } from './shim/mantel-host.js';
import { Hub } from './shim/hub.js';
import { startAgain, started } from './shim/boot-retry.js';
import { pageHealth } from './shim/page-health.js';
import { loadRegistry, followRegistry } from './shim/registry-sync.js';   // the registries follow the house   // how this page is doing, told to Mantel's log and its Performance page
import '/hk/shell/hk-view-host.js';
// HK's own toast layer: Mantel draws no toast of its own (hkShell.hostToast() is false)
import '/hk/shell/hk-overlays.js';

// THE APP WAITS FOR THE SCREEN, NOT THE FILE (2026-11-08): the iPhone and iPad app showed this page as soon as its file
// had loaded, before the house's states had come, so a slow open showed tiles with no names that did nothing. This page
// says it will tell the app when its first screen is drawn (`mantelNative.drawn`, below); until then the app keeps the
// last screen's still up. (Read by HouseWebView.swift as the file finishes loading; a page without it is shown then.)
window.__mantelWillDraw = true;
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
// ONE failed request at the start (a 503 while Mantel restarts, a socket dropped as it opened) left the page blank
// for good, a wall tablet too: it starts again from the top, a little later each time (shim/boot-retry.js).
const RETRY_KEY = 'mantel_boot_retry';
let boot;
try {
  boot = await Promise.all([
    loadRegistry(mantelUrl('/api/registry')), json(mantelUrl('/api/me')), json(mantelUrl('/api/fixtures')),
    // the card list asked for with the page (shim/early-cards.js); asked for again here if that did not answer
    (window.__mantelCardList || Promise.reject()).catch(() => json(mantelUrl('/api/hk-cards'))), hub.connect(),
    // Music Assistant / go2rtc under Mantel's own address, when this server serves them (media_proxy.py)
    json(mantelUrl('/api/services')).catch(() => ({})),
  ]);
} catch (e) {
  await startAgain(RETRY_KEY, e);                 // this start goes no further
}
started(RETRY_KEY);
const [{ registry, digest: registryDigest }, user, fixtures, cardList, , services] = boot;
// {core, lazy} (mantel_server/hk_cards.py): the core files are imported below, the lazy ones on first use
const cards = cardList.core || [];
const health = pageHealth(hub, 'home', marks);
window.hkMantelShell.setServices(services);
window.hkMantelShell.setRole(user.role);
window.hkMantelShell.setHaAddress(user.ha_address);
window.hkMantelShell.setRoom(user.room);
window.hkMantelShell.setAtTablet(user.at_tablet === true);      // hkShell.atTablet: no Edit mode at a wall tablet
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
// an area renamed in Home Assistant reaches this page without a reload (before the first subscribe: the snapshot
// says which registry this page may see)
followRegistry(hub, host, mantelUrl('/api/registry'), registryDigest);
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
// ...and every entity that joins the house while the whole house is subscribed (a diff's `added`): it is the
// house's as much as a snapshot's, and a card that reads it after the page narrowed must be able to ask again
// (2026-10-29: sensors added after the last snapshot were never kept, and their cards stayed at nothing)
hub.onDiff = (m) => { if (!narrowed) for (const id of Object.keys(m.added || {})) houseIds.add(id); host.applyDiff(m); };
hub.subscribe([], [], true);
await first;
mark('states');

// HA's frontend keeps /<dashboard>/<view>; so does this page (HK reads the first segment).
// (hkV: the build's ?v= on an address put together here, shim/base.js)
// (a file that didn't come is asked for again, twice, at an address of its own: a browser keeps a failed module's
// answer for its address; the third audit pass, 2026-11-01)
const imp = async (u) => {
  for (let n = 0; ; n++) {
    try { return await (n ? import(hkV(u) + (hkV(u).includes('?') ? '&' : '?') + 'retry=' + n) : import(hkV(u))); } catch (e) {
      if (n >= 2) { console.error('[mantel] could not load', u, e); return undefined; }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
    }
  }
};
for (const m of ['modules/hk-settings.js', 'iconset/hk-icons.js', 'modules/tesla-viewport.js', 'modules/hk-tap.js',
                 'modules/hk-header.js', 'modules/hk-loader.js', 'modules/hk-pairs.js', 'cards/hk-strategy.js']) await imp('/hk/' + m);
// ONLY THE CARDS A SCREEN USES (2026-10-29): the other card files are hk-loader.js's to import, the first time
// one of their cards is asked for
if (window.hkNeed) window.hkNeed.arm(cardList.lazy || {});
// A WALL TABLET THAT LISTENS (the Intercom, 17.4): only a device session asks the Intercom's feed on its own, and loads the
// Intercom's code only if the snapshot says this tablet listens. No other page does either (shim/mantel-client.js).
if (user.at_tablet === true) window.hkMantelClient.listenAtDevice(hub);
// THE SCREENSAVER ALONE (?hk_preview=saver, Settings' preview of a screen's screensaver, 2026-10-31): the base of the
// cards only -- the screensaver's corner cards are lazy ones, asked for as it makes them -- no strategy run, no
// view drawn. The screensaver reads this screen's settings itself (hk-saver.js fromSettings) and is shown as soon
// as it is here; Settings hands it each change (hkSaver.preview). A page laid out at the screen's own size, so it
// is drawn exactly as the screen draws it.
const SAVER_ONLY = new URLSearchParams(location.search).get('hk_preview') === 'saver';
if (SAVER_ONLY) cards.splice(0, cards.length, ...cards.filter((c) => c === 'hk-base.js'));
await Promise.all(cards.map((c) => imp('/hk/cards/' + c)));
mark('code');
// shown inside Home Assistant (a Webpage dashboard): its header and sidebar as the screen says, and the way back
// (ha-frame.js; Mantel Link's script listens on Home Assistant's side)
import('./shim/ha-frame.js').then((m) => m.start()).catch((e) => console.error('[mantel] ha-frame', e));

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

if (SAVER_ONLY) {
  window.hkMantelShell.saverOnly();
  // (hk-saver.js sets hkSaver once its parts, web/hk/saver/, have run: a beat after the file itself)
  for (let i = 0; i < 100 && !(window.hkSaver && window.hkSaver.preview); i++) await new Promise((res) => setTimeout(res, 100));
  if (window.hkSaver && window.hkSaver.preview) window.hkSaver.preview(true);
  window.__mantelReady = true;
  await new Promise(() => {});                    // nothing more: no view on this page
}
// (the strategy reads the whole house to decide what to draw: none of it is a surface's own read, Host.seen)
const build = async () => { host.building = true; try { return await window.hkStrategy.generate({}, host.client); } finally { host.building = false; } };
const cfg = await build();
mark('strategy');
// the page about to be drawn: every card file it names asked for now, nested cards' too, together (the view host
// would ask for each as it makes its card, and a container's children only once the container has drawn)
{
  const views = cfg.views || [], at = location.pathname.split('/')[2] || '';
  const first = views.find((v) => v && v.path === at) || views[0];
  if (first && window.hkNeed) window.hkNeed.config(first);
}

// NARROWING: after a page is first drawn, note which states the screen really reads and narrow the hub
// subscription to those (with the pages seen before: a cached page keeps its cards and catches up when
// shown again; a page let go after the last four (hk-view-host.js) is made again from what the screen has
// read -- it counts as seen: `needed` keeps every state any page read, and a miss adds it). The strategy needed the whole house to decide what to draw, the cards do not. A page
// not seen yet widens the subscription again first, so it is drawn with the whole house.
const narrowing = new URLSearchParams(location.search).get('narrow') !== '0';
let narrowTimer = 0, narrowPending = false;
// SELF-HEALING: every entity id the house has (from each whole-house snapshot). A card that reads one
// after the page narrowed -- a timer, a later render, a path the recorded pass missed -- adds it, and the
// hub is asked again (batched), so the card never stays "unknown" (seen on the Vacuums page, 2026-10-18).
host.onMiss = (id) => { if (narrowed) keep(id); };
async function widen() {
  if (!narrowed) return;
  narrowed = false;
  narrowPending = false;
  clearTimeout(narrowTimer);
  host.recording = false;
  const got = nextSnapshot();
  hub.subscribe([], [], true);
  await got;
}
// (`view`: the page's config. Its cards whose code a page loads on first use (hk-loader.js hkNeed) are waited for
// first: a card not defined yet reads nothing in the recorded pass, and the page narrowed to none of its states
// (2026-10-29, a Cameras page opened straight away)
let narrowRun = 0;
async function narrowSoon(view) {
  if (!narrowing) return;
  clearTimeout(narrowTimer);
  narrowPending = true;
  const run = ++narrowRun;
  if (window.hkNeed && view) await window.hkNeed.config(view).catch(() => {});
  if (run !== narrowRun) return;
  const pass = () => requestAnimationFrame(() => {
    // (every card on the page drawn again is no job for under a finger, or for a page on its way home)
    if (window.hkPageSwipe && window.hkPageSwipe.moving && window.hkPageSwipe.moving()) { narrowTimer = setTimeout(pass, 400); return; }
    host.reads.clear();
    host.recording = true;
    viewHost.refresh();                          // one more pass over every card on the page, recorded:
    // ...drawn, not only offered the client: a card's gate passes on an unchanged client, and one whose signature
    // reads no state (Energy's) then read nothing here, so its sensors were left out (hk-base.js redrawAll)
    if (window.hkCards && window.hkCards.redrawAll) window.hkCards.redrawAll();
    narrowTimer = setTimeout(() => {
      host.recording = false;
      for (const k of host.reads) if (host._states[k]) needed.add(k);
      // ...and every state anything on the screen has read so far -- the Side Pane, the menu, the tab bar, the
      // screensaver draw outside the page's cards and its recorded pass (Host.seen)
      for (const k of host.seen) if (host._states[k]) needed.add(k);
      window.__mantelNarrow = needed.size;
      narrowed = true;
      narrowPending = false;
      hub.subscribe([...needed], [], false);     // snapshot arrives again, then only these entities' diffs
      mark('narrowed');
    }, 1500);
  });
  narrowTimer = setTimeout(pass, 1500);
}

const viewHost = window.hkViewHost.create({
  container: document.getElementById('view'),
  config: cfg,
  client: host.client,
  base: '/' + seg,
  willShow: (view, firstVisit) => (firstVisit ? widen() : null),
  // (a page made ready beside this one, for a swipe, was widened for: narrowed again with its states in. A narrowing already
  // on its way takes them too, and isn't put off: the pass reads what every card on the screen has read so far)
  warmed: (view) => { if (!narrowPending) narrowSoon(view); },
});
window.__mantelViewHost = viewHost;
// A PAGE NOT SEEN YET, ONCE THE PAGE HAS NARROWED: the house's states first, then the address. The view host
// waits for them anyway (willShow -> widen), but the address changed at the tap, and everything that reads it
// -- each page's own Highlight Color and its Flat ground -- took the next page's while this one was still up:
// on a slow link, every update from the house redrew Home's cards in Energy's green and its ground went green
// before Energy appeared (seen on an iPhone). So the address waits too, and the page, its color and
// its ground change together. The last tap wins; a page already seen, or nothing narrowed, goes at once.
{
  const S = window.hkShell, go = S.navigate;
  let latest = 0;
  S.navigate = function (path, init, opts) {
    const parts = String(path || '').split(/[?#]/)[0].split('/');
    const unseen = narrowed && parts[1] === seg && viewHost.seen().indexOf(parts[2] || '') < 0;
    const mine = ++latest;
    if (!unseen) return go.call(S, path, init, opts);
    widen().then(() => { if (mine === latest) go.call(S, path, init, opts); });
    return null;
  };
}
// the host shell knows the view host: the sky and the tab bar find the view, the menu the config
window.hkMantelShell.attach(viewHost);
viewHost.onView((el, view, config, info) => {
  window.__mantelView = view;
  if (info.first) narrowSoon(view);
});
await viewHost.start();
mark('rendered');

// A SETTINGS CHANGE THE STRATEGY SAYS NEEDS A NEW BUILD (hk-strategy.js refresh(): `config-refresh` from the
// panel, which is this page's body): the dashboard is generated again and the page shown drawn again from it,
// in place -- as HK Frontend's panel does (hk-ha-panel.js). A save made here (Edit mode's Done, a sheet's gear)
// shows at once; another device's waits until nobody is using the page (the strategy decides when). Changes
// close together are built once, the last one last.
{
  let building = null, again = false;
  const rebuild = () => {
    if (building) { again = true; return; }
    building = (async () => {
      const next = await build();
      await viewHost.reconfigure(next);
    })().catch((e) => console.error('[home] could not build the screen again', e)).then(() => {
      building = null;
      if (again) { again = false; rebuild(); }
    });
  };
  document.addEventListener('config-refresh', (ev) => { ev.stopPropagation(); rebuild(); });
}
health.drawn();                 // the first screen is on the glass: its time goes to Mantel's Performance page
// ...and the iPhone and iPad app shows it now (THE APP WAITS FOR THE SCREEN, above): after the frame it is painted in
// (a timer too, in case a page the app still hides gets no frames)
if (window.mantelNative && typeof window.mantelNative.drawn === 'function') {
  let told = false;
  const tell = () => { if (!told) { told = true; window.mantelNative.drawn(); } };
  requestAnimationFrame(() => requestAnimationFrame(tell));
  setTimeout(tell, 300);
}
// THE HOUSE'S POP-UPS' CARDS, once the first screen is up: they open over any page at any moment (a doorbell's
// camera, live: hk-sheet-security.js makes an hk-doorbell-card) and should not wait for their code then
setTimeout(() => {
  const S = window.hkSettings, N = window.hkNeed;
  if (!S || !N) return;
  const popups = S.get('popups', null) || [];
  N.config(popups);
  if (popups.some((p) => p && p.kind === 'camera')) N('hk-doorbell-card');
}, 4000);

// the house's changes reach the view host as client updates (hkHostClient.current()); the smoke and
// /dev tools hook here to see each new snapshot
host.onSnapshot = (s) => { if (window.__mantelOnSnapshot) window.__mantelOnSnapshot(s); };
window.__mantelReady = true;
