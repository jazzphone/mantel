// Run by tests/test_intercom_card.py with node: the Intercom's action port and feed on the page's shim -- the real
// hub.js (the feed: intercom/subscribe), mantel-client.js (actions.intercom, client.intercom) and hk-client.js, with a
// fake WebSocket that plays the server's side of them. Prints one JSON object of what was observed.
//
//   node intercom_shim_harness.mjs <hk-client.js> <mantel-client.js> <dir holding hub.mjs and base.mjs>
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [clientSrc, shimSrc] = process.argv.slice(2, 4).map((p) => readFileSync(p, 'utf8'));
const dir = process.argv[4];
const listeners = {};
const events = [];
globalThis.window = globalThis;
globalThis.addEventListener = (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); };
globalThis.dispatchEvent = (ev) => { events.push(ev.type); for (const fn of listeners[ev.type] || []) fn(ev); return true; };
globalThis.CustomEvent = class CustomEvent { constructor(type, o) { this.type = type; this.detail = (o || {}).detail; } };
globalThis.location = { origin: 'https://mantel.test', search: '', protocol: 'https:', host: 'mantel.test', pathname: '/home' };
globalThis.document = { querySelector: () => null, addEventListener() {} };
vm.runInThisContext(clientSrc);
vm.runInThisContext(shimSrc);

const realTimeout = setTimeout;
globalThis.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 3));
const tick = (ms = 30) => new Promise((r) => realTimeout(r, ms));
let sockets = [];
class FakeWS {
  constructor(url) {
    this.url = url; this.sent = []; this.readyState = 0; sockets.push(this);
    realTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); this.onmessage({ data: JSON.stringify({ type: 'capabilities', commands: true, door: 'lan' }) }); }, 1);
  }
  send(d) { this.sent.push(JSON.parse(d)); }
  say(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  drop() { this.readyState = 3; this.onclose && this.onclose(); }
}
globalThis.WebSocket = FakeWS;
const { Hub } = await import(dir + '/hub.mjs');

const out = {};
const snapshot = () => ({ states: {}, connection: {} });

// ---- the feed, over the hub socket
const hub = new Hub();
hkMantelClient.useCommands(hub);
const early = [];
const offEarly = hub.intercomSubscribe((ev, err) => early.push([ev, err]));        // asked for before the socket is open
await hub.connect();
await tick();
const ws = sockets[0];
out.earlySent = ws.sent.filter((f) => f.type && f.type.startsWith('intercom'));
const id = out.earlySent[0].id;
const got = [];
const off = hub.intercomSubscribe((ev, err) => got.push([ev, err]));
const id2 = ws.sent.filter((f) => f.type === 'intercom/subscribe')[1].id;
ws.say({ type: 'intercom_result', id, result: null });
ws.say({ type: 'intercom_event', id, event: { enabled: true, rooms: [] } });
ws.say({ type: 'intercom_event', id: id2, event: { enabled: true, rooms: [{ room: 'media_player.kitchen' }] } });
ws.say({ type: 'intercom_result', id: id2, error: { code: 'intercom_off' } });
ws.say({ type: 'error', id: id2, code: 'unknown_type', message: 'no such feed' });
out.early = early;
out.got = got;
// a new socket asks again, under the same ids
ws.drop();
await tick(60);
const ws2 = sockets[1];
out.resumed = ws2 ? ws2.sent.filter((f) => f.type === 'intercom/subscribe').map((f) => f.id).sort() : null;
out.ids = [id, id2].sort();
offEarly();
off();
out.unsub = (ws2 || ws).sent.filter((f) => f.type === 'intercom/unsubscribe').map((f) => f.id).sort();
out.url = hub.intercomUrl();

// ---- the action port, over a fake hub that records the gateway commands
const sent = [];
let replies = [];
function fakeHub(on, feed) {
  const h = {
    commandsEnabled: () => on,
    command(body) { sent.push(JSON.parse(JSON.stringify(body))); return Promise.resolve(replies.shift() || { type: 'command_result', result: { ok: true } }); },
    write() { return Promise.reject(new Error('not used')); },
    intercomUrl: () => 'wss://mantel.test/ws/intercom',
  };
  if (feed) h.intercomSubscribe = (cb) => { cb({ enabled: true }, null); return () => { out.feedLetGo = true; }; };
  return h;
}
async function outcome(p) { try { return await p; } catch (e) { return { error: e.code, reason: e.reason }; } }

hkMantelClient.useCommands(fakeHub(true, true));
let client = hkMantelClient.from(snapshot());
let act = client.actions;
replies = [{ type: 'command_result', result: { ticket: 'fictional-ticket-9', expires_in: 10 }, audit_id: 12 }];
out.ok = await outcome(act.intercom('message', 24000));
out.okSent = sent.splice(0);
replies = [{ type: 'command_result', result: { ticket: 'x' } }];
out.live = await outcome(act.intercom('live', 48000));
out.liveSent = sent.splice(0);
out.refusals = [];
for (const code of ['commands_disabled', 'forbidden', 'unavailable', 'intercom_off']) {
  replies = [{ type: 'command_result', error: { code, message: 'no', reason: 'r' }, audit_id: 13 }];
  out.refusals.push(await outcome(act.intercom('message', 24000)));
}
sent.splice(0);
replies = [{ type: 'command_result', result: { ok: true } }];                     // an answer with no ticket
out.noTicket = await outcome(act.intercom('message', 24000));
sent.splice(0);
out.bad = [];
for (const args of [['walkie', 24000], ['message', 100], ['message', 'fast'], [], ['message', 1000000]]) out.bad.push(await outcome(act.intercom(...args)));
out.badSent = sent.splice(0).length;
out.feed = typeof client.intercom.subscribe;
let heard = null;
client.intercom.subscribe((ev) => { heard = ev; });
out.fed = heard;
out.actions = hkClient.ACTIONS;

// commands off: the sheet still draws (the feed is a read), the press is refused before anything is sent
hkMantelClient.useCommands(fakeHub(false, true));
client = hkMantelClient.from(snapshot());
out.offFeed = typeof (client.intercom && client.intercom.subscribe);
out.off = await outcome(client.actions.intercom('message', 24000));
out.offSent = sent.splice(0).length;

// a hub without the feed (an older one): no feed, the block says "Intercom needs Mantel"
const old = fakeHub(true, false);
delete old.intercomUrl;
hkMantelClient.useCommands(old);
client = hkMantelClient.from(snapshot());
out.oldFeed = client.intercom;
out.oldAction = await outcome(client.actions.intercom('message', 24000));
// a clip's address on the page's own prefix (HA App mode serves Mantel under Ingress)
globalThis.__mantelBase = '/api/hassio_ingress/abc';
let feedCb = null;
const withFeed = fakeHub(true, false);
withFeed.intercomSubscribe = (cb) => { feedCb = cb; return () => {}; };
hkMantelClient.useCommands(withFeed);
const heardPlay = [];
hkMantelClient.from(snapshot()).intercom.subscribe((ev) => heardPlay.push(ev));
feedCb({ enabled: true, play: { id: 'b1', url: '/api/intercom/clip/b1.wav', volume: 0.5 } }, null);
feedCb({ enabled: true, play: { id: 'b2', url: 'https://elsewhere.example/x.wav', volume: null } }, null);
feedCb({ enabled: true, play: null }, null);
feedCb(null, { code: 'intercom_off' });
out.prefixed = heardPlay;

// ---- a wall tablet's ear (home.js, at a device session): one subscription for the page; the Intercom's code is loaded and told
// to listen only when a snapshot says `listener`, and the page's own subscription is let go after
{
  const asked = [], told = [];
  let cb = null, gone = 0, subscribed = 0;
  const hubA = { intercomSubscribe(f) { subscribed++; cb = f; return () => { gone++; }; } };
  globalThis.hkNeed = { file(name) { asked.push(name); globalThis.hkIntercom = { listen() { told.push('listen'); return true; } }; return Promise.resolve(); } };
  const ear = { none: hkMantelClient.listenAtDevice({}), noFeed: hkMantelClient.listenAtDevice({ nothing: 1 }) };
  out.ear = { ...ear };
  out.earStarted = hkMantelClient.listenAtDevice(hubA);
  out.earTwice = hkMantelClient.listenAtDevice(hubA);
  cb({ enabled: true, listener: false }, null);
  cb(null, { code: 'intercom_off' });
  cb({ enabled: false, listener: false }, null);
  await tick(10);
  out.earQuiet = { asked: asked.slice(), told: told.slice(), gone, subscribed };
  cb({ enabled: true, listener: true }, null);
  cb({ enabled: true, listener: true }, null);                       // (a second snapshot while the file is on its way)
  await tick(10);
  out.earListens = { asked: asked.slice(), told: told.slice(), gone, subscribed };
  delete globalThis.hkNeed; delete globalThis.hkIntercom;
}
process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));
