// hub.js across a dropped socket (tests/test_hub_reconnect.py): a fake WebSocket; the timers run fast.
const sockets = [];
let refuseNext = 0;            // how many of the next sockets fail to open
let answerPings = false;       // the server answers {type: ping} (a healthy socket); else it is silent (half-open)
globalThis.location = { protocol: 'http:', host: 'mantel.example', pathname: '/home' };
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null };
const realTimeout = setTimeout;
const waits = [];
let held = null;               // when a list: the reconnect's wait (anything but a ping's 3 s) is held here
// a ping's 3 s is 20 ms here: longer than a pong takes (1 ms)
globalThis.setTimeout = (fn, ms) => { waits.push(ms); if (ms === 3000) return realTimeout(fn, 20); if (held) { held.push(fn); return 0; } return realTimeout(fn, 1); };
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this);
    if (refuseNext > 0) { refuseNext--; this.refuse = true; }
    realTimeout(() => { if (this.refuse) { this.readyState = 3; this.onerror && this.onerror(); this.onclose && this.onclose(); return; }
                        this.readyState = 1; this.onopen && this.onopen(); }, 2); }
  send(d) { if (this.readyState !== 1) throw new Error('InvalidStateError'); const m = JSON.parse(d); this.sent.push(m);
    if (m.type === 'ping' && answerPings) realTimeout(() => this.onmessage && this.onmessage({ data: '{"type":"pong"}' }), 1); }
  answer(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  drop() { this.readyState = 3; this.onclose && this.onclose(); }
  // the page closing a socket that went half-open while the tablet slept: the closing handshake never comes
  // back, so the browser's own close event is late (or never comes): CLOSING, and no onclose here
  close() { this.readyState = 2; this.closedByPage = true; }
}
globalThis.WebSocket = FakeWS;
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(String(e && e.message)));
const settle = (p) => p.then((v) => ['resolved', v], (e) => ['rejected', e.code || e.message]);
const tick = (ms = 30) => new Promise((r) => realTimeout(r, ms));

const { Hub } = await import('./hub.mjs');
const hub = new Hub();
let reconnected = 0;
hub.onReconnect = () => { reconnected++; };
await hub.connect();
hub.subscribe(['light.kitchen'], [], false);
const events = [], offers = [];
const feed = hub.readSubscribe({ type: 'hk_frontend/events/subscribe' }, (ev) => events.push(ev));
const offer = settle(hub.readSubscribe({ type: 'camera/webrtc/offer', entity_id: 'camera.porch', offer: 'v=0' }, (ev) => offers.push(ev)));
const s1 = sockets[0];
const feedId = s1.sent.find((f) => f.msg && f.msg.type === 'hk_frontend/events/subscribe').id;
s1.answer({ type: 'read_result', id: feedId, result: null });
const unsub = await feed;
const inflight = settle(hub.read({ type: 'get_config' }));
refuseNext = 1;                                  // the first retry fails; the next one opens
s1.drop();
const whileDown = await settle(hub.read({ type: 'get_config' }));
await tick(60);
const s3 = sockets[sockets.length - 1];
s3.answer({ type: 'read_event', id: feedId, event: { type: 'notification', n: 1 } });
unsub();
const first = {
  sockets: sockets.length, reconnected, waits: waits.slice(),
  resent: s3.sent, inflight: await inflight, whileDown, offer: await offer, offers, events,
};

// A TABLET THAT SLEPT: a page in a browser, with its document's and window's events, and its 45 s timer run by
// hand. Each case is a new hub on a new page, so the hubs before it hear none of its events.
function page() {
  const on = {};
  const listen = (n, fn) => { (on[n] = on[n] || []).push(fn); };
  globalThis.document = { querySelector: () => null, visibilityState: 'visible', addEventListener: listen };
  globalThis.addEventListener = listen;                 // window is globalThis here
  const timers = [];
  globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const fire = (n, e = {}) => (on[n] || []).forEach((fn) => fn(e));
  const every = (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn());
  return { fire, every, timers, doc: globalThis.document };
}
const pings = (ws) => ws.sent.filter((m) => m.type === 'ping').length;

// a socket that went silent while the tablet slept: woken, the page pings, hears nothing, and replaces it
answerPings = false;
let pg = page();
const asleep = new Hub();
let asleepBack = 0;
asleep.onReconnect = () => { asleepBack++; };
await asleep.connect();
asleep.subscribe(['light.hall'], [], false);
const before = sockets.length;
const silentWs = sockets[before - 1];
pg.doc.visibilityState = 'hidden'; pg.fire('visibilitychange');    // going to sleep: nothing
const pingsWhileHidden = pings(silentWs);
pg.doc.visibilityState = 'visible'; pg.fire('visibilitychange');   // waking
await tick(60);
const wake = {
  pingsWhileHidden, pinged: pings(silentWs), closed: !!silentWs.closedByPage,
  newSockets: sockets.length - before, resent: sockets[sockets.length - 1].sent, reconnected: asleepBack,
};

// a healthy socket, and every wake event at once (as Safari fires them): one ping, answered; nothing closed
answerPings = true;
pg = page();
const awake = new Hub();
await awake.connect();
const healthyBefore = sockets.length;
const healthyWs = sockets[healthyBefore - 1];
pg.fire('visibilitychange'); pg.fire('pageshow', { persisted: true }); pg.fire('online'); pg.fire('focus');
await tick(30);
pg.fire('focus');                                                    // and again a moment later
await tick(30);
const healthy = { pinged: pings(healthyWs), closed: !!healthyWs.closedByPage, newSockets: sockets.length - healthyBefore };

// a wall tablet that never sleeps stays "visible": the page's 45 s ping finds the dead socket by itself
answerPings = false;
pg = page();
const wall = new Hub();
let wallBack = 0;
wall.onReconnect = () => { wallBack++; };
await wall.connect();
const wallBefore = sockets.length;
const wallWs = sockets[wallBefore - 1];
const timer = pg.timers.map((t) => t.ms);
pg.doc.visibilityState = 'hidden'; pg.every(45000);                 // a hidden page: no ping
const pingsHidden = pings(wallWs);
held = [];
pg.doc.visibilityState = 'visible'; pg.every(45000);
await tick(40);                                                      // the ping gave up; the reconnect waits
const waiting = held.length;
pg.fire('focus'); pg.fire('online'); pg.fire('visibilitychange'); pg.every(45000);   // nothing is pinged meanwhile
const between = pings(wallWs) - 1 + sockets.slice(wallBefore).reduce((n, ws) => n + pings(ws), 0);
const release = held; held = null; release.forEach((fn) => realTimeout(fn, 1));
await tick(60);
const visible = {
  timer, pingsHidden, pinged: pings(wallWs), closed: !!wallWs.closedByPage, between, waiting,
  newSockets: sockets.length - wallBefore, reconnected: wallBack,
};

console.log(JSON.stringify(Object.assign(first, { wake, healthy, visible, unhandled })));
