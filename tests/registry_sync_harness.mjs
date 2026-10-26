// Run by tests/test_registry_sync.py with node: the page's registry follows the house (web/shim/registry-sync.js)
// over the real hub (web/shim/hub.js) and host adapter (web/shim/mantel-host.js), a fake socket and a fake fetch.
// Prints one JSON object of what was observed.
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.location = { origin: 'http://mantel.test', search: '', protocol: 'http:', host: 'mantel.test' };
globalThis.document = { querySelector: () => null };
globalThis.hkMantelClient = { setCurrent() {} };
globalThis.hkHostClient = globalThis.hkMantelClient;
globalThis.hkOverlays = { toast() {} };
const realTimeout = setTimeout;
const sockets = [];
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this);
    realTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
  send(text) { this.sent.push(JSON.parse(text)); }
  answer(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  drop() { this.readyState = 3; this.onclose && this.onclose(); }
  close() { this.drop(); }
}
globalThis.WebSocket = FakeSocket;
globalThis.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 5));
const tick = (ms = 30) => new Promise((r) => realTimeout(r, ms));

// the server's registry, by digest
const house = (kitchen) => ({ entities: { 'light.kitchen': { entity_id: 'light.kitchen', area_id: 'kitchen' } }, devices: {},
                              areas: { kitchen: { area_id: 'kitchen', name: kitchen } }, floors: {} });
let current = { digest: 'd1', body: house('Kitchen') };
const fetches = [];
globalThis.fetch = async (url, opts = {}) => {
  const inm = opts.headers && opts.headers['If-None-Match'];
  fetches.push({ url, inm: inm || null });
  const tag = '"' + current.digest + '"';
  const headers = { get: (k) => (k.toLowerCase() === 'etag' ? tag : null) };
  if (inm === tag) return { ok: false, status: 304, headers, json: async () => { throw new Error('no body'); } };
  return { ok: true, status: 200, headers, json: async () => JSON.parse(JSON.stringify(current.body)) };
};

const { Host } = await import('./mantel-host.mjs');
const { Hub } = await import('./hub.mjs');
const { loadRegistry, followRegistry } = await import('./registry-sync.mjs');

const out = {};
const hub = new Hub();
let reconnected = 0;
hub.onReconnect = () => { reconnected++; };           // the page's own hook stays
const loaded = await loadRegistry('/api/registry');
out.loaded = { digest: loaded.digest, kitchen: loaded.registry.areas.kitchen.name, inm: fetches[0].inm };
await hub.connect();
const host = new Host({ hub, registry: loaded.registry, fixtures: {}, user: {}, config: {}, themes: {} });
let published = 0;
host.onSnapshot = () => { published++; };
hub.onSnapshot = (m) => host.applySnapshot(m.entities);
followRegistry(hub, host, '/api/registry', loaded.digest);
hub.subscribe([], [], true);
const s = () => sockets[sockets.length - 1];
const refreshes = () => window.__mantelRegistryRefreshes || 0;

// 1. the first snapshot names the registry the page already holds: nothing read again
s().answer({ type: 'snapshot', entities: {}, missing: [], registry: 'd1' });
await tick();
out.first = { fetches: fetches.length, refreshes: refreshes() };

// 2. the kitchen renamed in Home Assistant: the server's frame, the page reads it again and republishes
current = { digest: 'd2', body: house('Big Kitchen') };
published = 0;
const hassBefore = host.hass;
s().answer({ type: 'registry', digest: 'd2' });
await tick();
out.renamed = { fetches: fetches.length, inm: fetches[fetches.length - 1].inm, kitchen: host.hass.areas.kitchen.name,
                newHass: host.hass !== hassBefore, published, refreshes: refreshes() };

// 3. the same digest again (a reload that changed nothing for this page): nothing read
s().answer({ type: 'registry', digest: 'd2' });
await tick();
out.same = { fetches: fetches.length, refreshes: refreshes() };

// 4. the socket drops and comes back; the registry did not change meanwhile: the new snapshot says so
s().drop();
await tick(60);
s().answer({ type: 'snapshot', entities: {}, missing: [], registry: 'd2' });
await tick();
out.backUnchanged = { reconnected, sockets: sockets.length, fetches: fetches.length, refreshes: refreshes() };

// 5. it drops again, and the registry changed while it was down: the snapshot's digest differs, so the page reads it
s().drop();
current = { digest: 'd3', body: house('Kitchen & Dining') };
await tick(60);
s().answer({ type: 'snapshot', entities: {}, missing: [], registry: 'd3' });
await tick();
out.backChanged = { reconnected, fetches: fetches.length, kitchen: host.hass.areas.kitchen.name, refreshes: refreshes() };

// 6. a frame for a change already undone (the server is back on what the page holds): a 304, nothing redrawn
published = 0;
s().answer({ type: 'registry', digest: 'd4' });
await tick();
out.notModified = { fetches: fetches.length, inm: fetches[fetches.length - 1].inm, published, refreshes: refreshes(),
                    kitchen: host.hass.areas.kitchen.name };

console.log(JSON.stringify(out));
process.exit(0);
