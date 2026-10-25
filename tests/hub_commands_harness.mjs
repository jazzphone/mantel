// Run by tests/test_web_lifecycle.py with node (the audit's second pass, WEB-1..3). The page's real hub.js, mantel-host.js,
// mantel-client.js and hk-client.js, wired as web/home.js wires them, over a fake WebSocket that plays the server of
// hosts/server/mantel_server/server.py: `capabilities` only when commands are on (run(): gw is not None), none at all when
// they are off, every page socket closed when the Owner flips Control of the House (apply_commands). Prints one JSON object.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [clientSrc, shimSrc] = process.argv.slice(2, 4).map((p) => readFileSync(p, 'utf8'));
const listeners = {};
const events = [];
globalThis.window = globalThis;
globalThis.addEventListener = (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); };
globalThis.dispatchEvent = (ev) => { events.push(ev.type); for (const fn of listeners[ev.type] || []) fn(ev); return true; };
globalThis.CustomEvent = class CustomEvent { constructor(type, o) { this.type = type; this.detail = (o || {}).detail; } };
globalThis.location = { origin: 'http://mantel.test', search: '', protocol: 'http:', host: 'mantel.test', pathname: '/home' };
globalThis.document = { querySelector: () => null, addEventListener() {} };
globalThis.hkOverlays = { toast() {} };
vm.runInThisContext(clientSrc);
vm.runInThisContext(shimSrc);

const realTimeout = setTimeout;
globalThis.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 3));      // the hub's 2 s retry and 5 s ping, fast
const tick = (ms = 40) => new Promise((r) => realTimeout(r, ms));

let sockets = [];
let serverFrames = [];                  // what the next socket's server says on open (a function of the server's setting)
let silent = false;
class FakeWS {
  constructor(url) {
    this.url = url; this.sent = []; this.readyState = 0; sockets.push(this);
    realTimeout(() => {
      this.readyState = 1; this.onopen && this.onopen();
      for (const f of serverFrames) this.onmessage({ data: JSON.stringify(f) });
    }, 1);
  }
  send(d) {
    if (this.readyState !== 1) throw Object.assign(new Error('Failed to execute send on WebSocket: still in CLOSING or CLOSED state.'), { name: 'InvalidStateError' });
    this.sent.push(JSON.parse(d));
  }
  say(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  drop() { this.readyState = 3; this.onclose && this.onclose(); }
}
globalThis.WebSocket = FakeWS;

const { Hub } = await import('./hub.mjs');
const { Host } = await import('./mantel-host.mjs');

// ---- the page, as home.js builds it
async function page(commandsOn) {
  sockets = [];
  serverFrames = commandsOn ? [{ type: 'capabilities', commands: true, door: 'lan' }] : [];
  const hub = new Hub();
  hkMantelClient.useCommands(hub);
  let host = null;
  hub.onCapabilities = () => { if (host) host._publish(); };      // home.js
  await hub.connect();
  await tick();
  host = new Host({ hub, registry: { entities: {}, devices: {}, areas: {}, floors: {} }, fixtures: {}, user: {}, config: {}, themes: {} });
  if (hub.commandsEnabled()) host._publish();                      // home.js: "capabilities came before the host"
  return { hub, host };
}
const commandFrames = (s) => s.sent.filter((m) => m.type === 'command').length;
const outcome = (p) => p.then(() => 'resolved', (e) => (e && (e.code || e.name || e.message)) || String(e));
const tryLight = (host) => outcome(host.client.actions.callService('light', 'turn_on', { entity_id: 'light.kitchen' }));

const out = {};

// ============ Control of the House ON -> OFF while a page is open (server_settings -> app["apply_commands"](False))
{
  const { hub, host } = await page(true);
  out.onFirst = { enabled: hub.commandsEnabled(), result: null };
  const s0 = sockets[0];
  const p = tryLight(host); await tick(); s0.say({ type: 'command_result', id: s0.sent.find((m) => m.type === 'command').id, result: {} });
  out.onFirst.result = await p; out.onFirst.frames = commandFrames(s0);
  // the server turns commands off: it closes every page socket; the replacement socket gets NO capabilities frame
  serverFrames = [];
  s0.drop();
  await tick(60);
  const s1 = sockets[sockets.length - 1];
  out.off = { sockets: sockets.length, enabled: hub.commandsEnabled(), capabilities: hub.capabilities };
  const q = tryLight(host); await tick();
  out.off.result = await Promise.race([q, tick(30).then(() => 'pending')]);
  out.off.frames = commandFrames(s1);                              // a command went to the server of a house that is read-only
  out.off.clientUpdates = events.filter((e) => e === 'hk-client-update').length;
}

// ============ a command pressed while the socket is down (stale capabilities say on)
{
  const { hub, host } = await page(true);
  const s0 = sockets[0];
  serverFrames = [{ type: 'capabilities', commands: true, door: 'lan' }];
  s0.drop();                                                       // the retry is a few ms away
  const r = await tryLight(host);
  out.down = { result: r, pending: [...hub.pending.values()].filter((p) => p.command).length };
  await tick(60);
}

// ============ Control of the House OFF -> ON while a page is open
{
  const { hub, host } = await page(false);
  out.offFirst = { enabled: hub.commandsEnabled(), result: await tryLight(host), frames: commandFrames(sockets[0]) };
  serverFrames = [{ type: 'capabilities', commands: true, door: 'lan' }];
  sockets[0].drop();
  await tick(60);
  const s1 = sockets[sockets.length - 1];
  const p = tryLight(host); await tick();
  out.nowOn = { enabled: hub.commandsEnabled(), frames: commandFrames(s1) };
  s1.say({ type: 'command_result', id: s1.sent.find((m) => m.type === 'command').id, result: {} });
  out.nowOn.result = await p;
}

// ============ the ping's waiters on a socket that never answers (Kiosk Satellite's watchdog pings every few seconds)
{
  const { hub } = await page(false);
  for (let i = 0; i < 40; i++) await outcome(hub.ping(1));
  out.pings = { waiting: (hub.pings || []).length };
}

console.log(JSON.stringify(out));
process.exit(0);
