// Run by tests/test_shim_talk.py with node: the doorbell's talk-back through Mantel's client port
// (web/shim/mantel-client.js) and HKClient's action port (web/client/hk-client.js), both loaded as the
// page loads them, with a fake hub that records every gateway command. The calls are made exactly as
// HK's doorbell card makes them (web/hk/cards/hk-cameras.js _talkSend / _liveStart).
// Prints one JSON object of what was observed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [clientSrc, shimSrc] = process.argv.slice(2).map((p) => readFileSync(p, 'utf8'));
const events = [];
globalThis.window = globalThis;
const listeners = {};
globalThis.addEventListener = (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); };
globalThis.dispatchEvent = (ev) => {
  events.push(ev.type);
  let heard = false;
  for (const fn of listeners[ev.type] || []) { fn(ev); heard = true; }
  return !(heard && ev.cancelable);
};
globalThis.CustomEvent = class CustomEvent { constructor(type, o) { this.type = type; this.detail = (o || {}).detail; this.cancelable = !!(o || {}).cancelable; } };
vm.runInThisContext(clientSrc);
vm.runInThisContext(shimSrc);

const sent = [];
let replies = [];
function fakeHub(on) {
  return {
    commandsEnabled: () => on,
    command(body) { sent.push(JSON.parse(JSON.stringify(body))); return Promise.resolve(replies.shift() || { type: 'command_result', result: { ok: true } }); },
    write() { return Promise.reject(new Error('not used')); },
  };
}
const snapshot = () => ({ states: {}, connection: {} });
const out = {};
const SPEAKER = 'media_player.doorbell_speaker';
const clip = new Uint8Array(70000).map((_, i) => (i * 7) % 256);       // > one 0x8000 chunk
out.clipB64 = Buffer.from(clip).toString('base64');

async function card(act, speaker, blob) {
  // hk-cameras.js _talkSend, verbatim in what it passes
  const url = '/api/hk_frontend/talk?entity_id=' + encodeURIComponent(speaker);
  const init = { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } };
  return act.request(url, init);
}
async function outcome(p) {
  try { const r = await p; return { status: r.status, ok: r.ok, body: await r.text() }; } catch (e) { return { error: e.code }; }
}

// commands on
hkMantelClient.useCommands(fakeHub(true));
let act = hkMantelClient.from(snapshot()).actions;
replies = [{ type: 'command_result', result: { ok: true, bytes: clip.length }, audit_id: 4 }];
out.ok = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/webm;codecs=opus' })));
out.okSent = sent.splice(0);

// a step-up on the tunnel: the prompt answers, the same clip goes again
addEventListener('hk-step-up-required', (e) => setTimeout(() => e.detail.done(), 0));
replies = [{ type: 'step_up_required', reason: 'step_up_required', methods: ['totp'], window: 300, targets: [SPEAKER, 'feature:cameras'] },
           { type: 'command_result', result: { ok: true }, audit_id: 6 }];
out.stepUp = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/mp4' })));
out.stepUpSent = sent.splice(0);

// HA refused it (http_415 / forbidden)
replies = [{ type: 'command_result', error: { code: 'http_415', message: '{"message":"not an audio clip"}' } }];
out.refusedByHa = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/ogg' })));
replies = [{ type: 'command_result', error: { code: 'forbidden', reason: 'explicit_deny', message: 'no' } }];
out.forbidden = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/webm' })));
sent.splice(0);

// refused here, nothing read or sent: another path, another type, too big, not a Blob, not POST
out.local = [];
for (const p of [
  act.request('/api/config/config_entries/flow', { method: 'POST', body: new Blob([clip], { type: 'audio/webm' }) }),
  act.request('/api/hk_frontend/talk?entity_id=lock.front_door', { method: 'POST', body: new Blob([clip], { type: 'audio/webm' }) }),
  act.request('/api/hk_frontend/talk?entity_id=media_player.x&y=1', { method: 'POST', body: new Blob([clip], { type: 'audio/webm' }) }),
  card(act, SPEAKER, new Blob(['<script>'], { type: 'text/html' })),
  card(act, SPEAKER, new Blob([new Uint8Array(512001)], { type: 'audio/webm' })),
  act.request('/api/hk_frontend/talk?entity_id=' + SPEAKER, { method: 'POST', body: clip, headers: { 'Content-Type': 'audio/webm' } }),
  act.request('/api/hk_frontend/talk?entity_id=' + SPEAKER, { method: 'PUT', body: new Blob([clip], { type: 'audio/webm' }) }),
]) out.local.push(await outcome(p));
out.localSent = sent.splice(0).length;

// live talk: refused quietly (no "commands disabled" toast), so the card sends the clip
events.length = 0;
out.live = await outcome(act.liveSocket());
out.liveEvents = events.slice();
out.liveSent = sent.splice(0).length;

// commands off: the port has no request; hkClient refuses, nothing sent
hkMantelClient.useCommands(null);
act = hkMantelClient.from(snapshot()).actions;
events.length = 0;
out.off = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/webm' })));
out.offEvents = events.slice();
out.offSent = sent.length;
process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));   // a pipe: flush before exit
