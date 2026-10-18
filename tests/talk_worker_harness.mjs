// Runs HK's doorbell talk Worker -- the exact TALK_WORKER source from web/hk/cards/hk-cameras.js -- in
// node against a live-talk socket, as the card drives it (_liveStart / _liveStop): `start` with the
// url and token liveSocket() gave, PCM chunks from the worklet over a MessageChannel every 40 ms once
// the doorbell listens, then `stop` (let go). Used by tests/test_talk_live.py (against Mantel's /ws/talk
// with a stand-in Home Assistant) and tools/e2e/talk_e2e.py (against the scratch Home Assistant).
//
//   node talk_worker_harness.mjs <hk-cameras.js> <ws url> <token> <cookie header> <origin> <speaker> <rate> <frames>
//
// The browser sends the page's cookies and Origin with a Worker's WebSocket; node's WebSocket is given
// them as headers. Prints one JSON object: the worker's messages to the page, and how many frames went.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [cardPath, url, token, cookie, origin, speaker, rate, frames] = process.argv.slice(2);
const src = readFileSync(cardPath, 'utf8');
const start = src.indexOf('var TALK_WORKER = [');
const end = src.indexOf("].join('\\n');", start);
if (start < 0 || end < 0) throw new Error('TALK_WORKER not found in hk-cameras.js');
const worker = vm.runInNewContext(src.slice(start + 'var TALK_WORKER = '.length, end + 1)).join('\n');

const said = [];
const headers = {};
if (cookie) headers.Cookie = cookie;
if (origin) headers.Origin = origin;
const Base = globalThis.WebSocket;
const ctx = vm.createContext({
  WebSocket: class extends Base { constructor(u) { super(u, { headers }); } },
  postMessage: (m) => said.push(m),
  JSON, Uint8Array, Promise, String, Error, console,
});
vm.runInContext(worker, ctx);

const ch = new MessageChannel();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ctx.onmessage({ data: { cmd: 'start', key: 1, url, token, entity_id: speaker, rate: Number(rate), port: ch.port2 } });
let live = false;
for (let i = 0; i < 100 && !live; i++) {
  await sleep(20);
  live = said.some((m) => m.live) || said.some((m) => m.error);
}
let sent = 0;
if (said.some((m) => m.live)) {
  const chunk = Math.round(Number(rate) / 25);           // 40 ms, as the worklet posts
  for (let i = 0; i < Number(frames); i++) {
    const pcm = new Int16Array(chunk);
    for (let j = 0; j < chunk; j++) pcm[j] = ((i * chunk + j) * 37) % 20000 - 10000;
    ch.port1.postMessage(pcm.buffer, [pcm.buffer]);
    sent++;
    await sleep(40);
  }
}
await sleep(100);
ctx.onmessage({ data: { cmd: 'stop', key: 1 } });           // let go
await sleep(400);
ch.port1.close();
process.stdout.write(JSON.stringify({ said, sent }) + '\n', () => process.exit(0));
