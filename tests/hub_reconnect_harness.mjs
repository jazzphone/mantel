// hub.js across a dropped socket (tests/test_hub_reconnect.py): a fake WebSocket; the timers run fast.
const sockets = [];
let refuseNext = 0;            // how many of the next sockets fail to open
globalThis.location = { protocol: 'http:', host: 'mantel.example', pathname: '/home' };
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null };
const realTimeout = setTimeout;
const waits = [];
globalThis.setTimeout = (fn, ms) => { waits.push(ms); return realTimeout(fn, 1); };
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this);
    if (refuseNext > 0) { refuseNext--; this.refuse = true; }
    realTimeout(() => { if (this.refuse) { this.readyState = 3; this.onerror && this.onerror(); this.onclose && this.onclose(); return; }
                        this.readyState = 1; this.onopen && this.onopen(); }, 2); }
  send(d) { if (this.readyState !== 1) throw new Error('InvalidStateError'); this.sent.push(JSON.parse(d)); }
  answer(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  drop() { this.readyState = 3; this.onclose && this.onclose(); }
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
console.log(JSON.stringify({
  sockets: sockets.length, reconnected, waits,
  resent: s3.sent, inflight: await inflight, whileDown, offer: await offer, offers, events, unhandled,
}));
