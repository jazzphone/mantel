// Run by tests/test_shim_kiosk_watchdog.py with node: a kiosk app's watchdog (Kiosk Satellite's checks, as
// its browser_manager.dart runs them in the page) against Mantel's stand-in connection (web/shim/mantel-host.js)
// over the real hub (web/shim/hub.js) and a fake socket. Prints one JSON object of what was observed.
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
let silent = false;                      // the server stops answering (a half-open socket still reads OPEN)
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this);
    realTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
  send(text) {
    const m = JSON.parse(text); this.sent.push(m);
    if (m.type === 'ping' && !silent) realTimeout(() => this.onmessage({ data: JSON.stringify({ type: 'pong' }) }), 1);
  }
  close() { this.readyState = 3; realTimeout(() => this.onclose && this.onclose(), 1); }
}
globalThis.WebSocket = FakeSocket;
// the hub's reconnect waits 2 s and more: fast here
globalThis.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 20));
const tick = (ms = 40) => new Promise((r) => realTimeout(r, ms));

const { Host } = await import('./mantel-host.mjs');
const { Hub } = await import('./hub.mjs');
const hub = new Hub();
await hub.connect();
const host = new Host({ hub, registry: { entities: {}, devices: {}, areas: {}, floors: {} }, fixtures: {}, user: {}, config: {}, themes: {} });
const hass = { connection: host.connection };

// its probe: "connected" only with `connected` and an open socket, else "stale" (the 15-minute reload)
const probe = () => {
  const c = hass.connection;
  return c && c.connected && c.socket && c.socket.readyState === 1 ? 'connected' : 'stale';
};
// its resume check: a ping on the connection, alive or dead
const ping = () => hass.connection.sendMessagePromise({ type: 'ping' }).then(() => 'alive', () => 'dead');

const out = {};
out.up = probe();
out.upPing = await ping();
out.pingSent = sockets[0].sent.filter((m) => m.type === 'ping').length;
silent = true;
out.silentPing = await ping();           // the hub's ping gives up after 5 s
silent = false;
sockets[0].close();                      // Mantel's socket drops
await tick(5);
out.down = probe();
out.downPing = await ping();
await tick();                            // the hub reconnects by itself
out.back = probe();
out.socketsAfterDrop = sockets.length;
hass.connection.reconnect(true);         // its nudge: cycles the socket, which comes back
await tick(5);
out.duringNudge = probe();
await tick();
out.afterNudge = probe();
hass.connection.socket.close();          // its other nudge
await tick();
out.afterClose = probe();
out.sockets = sockets.length;
console.log(JSON.stringify(out));
process.exit(0);
