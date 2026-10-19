// Run by tests/test_shim_talk.py with node: the doorbell's talk-back through Mantel's client port
// (web/shim/mantel-client.js) and HKClient's action port (web/client/hk-client.js), both loaded as the
// page loads them, with a fake hub that records every gateway command. The calls are made exactly as
// HK's doorbell card makes them (web/hk/cards/hk-cameras.js _talkSend / _liveStart).
// Prints one JSON object of what was observed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [clientSrc, shimSrc] = process.argv.slice(2, 4).map((p) => readFileSync(p, 'utf8'));
const hubUrl = 'file://' + process.argv[4];
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
    talkUrl: () => 'wss://mantel.test/ws/talk',
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

// no step-up (decision 25): a step_up_required from an older server is a refusal -- no prompt, no resend
let prompted = 0;
addEventListener('hk-step-up-required', () => { prompted += 1; });
replies = [{ type: 'step_up_required', reason: 'step_up_required', methods: ['totp'], window: 300, targets: [SPEAKER, 'feature:cameras'] },
           { type: 'command_result', result: { ok: true }, audit_id: 6 }];
out.stepUp = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/mp4' })));
out.stepUpSent = sent.splice(0);
out.stepUpPrompted = prompted;

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

// live talk without a speaker (an older card): refused quietly, nothing sent, so the card sends the clip
events.length = 0;
out.live = await outcome(act.liveSocket());
out.liveEvents = events.slice();
out.liveSent = sent.splice(0).length;

// LIVE TALK, as hk-cameras.js _liveStart asks for it: act.liveSocket(this._config.speaker), then the
// Worker gets {url: live.url, token: live.token()}
async function live(speaker) {
  try { const l = await act.liveSocket(speaker); return { url: l.url, token: l.token() }; } catch (e) { return { error: e.code, reason: e.reason }; }
}
events.length = 0;
replies = [{ type: 'command_result', result: { ticket: 'fictional-ticket-1', expires_in: 10 }, audit_id: 9 }];
out.liveOk = await live(SPEAKER);
out.liveOkSent = sent.splice(0);
// refused, step-up wanted, HA-side errors, a malformed answer: all quiet (no toast, no prompt), nothing more sent
const quiet = [
  { type: 'command_result', error: { code: 'forbidden', reason: 'no_grant', target: SPEAKER }, audit_id: 10 },
  { type: 'step_up_required', reason: 'step_up_required', methods: ['totp'], window: 300 },
  { type: 'command_result', error: { code: 'commands_disabled', message: 'off' } },
  { type: 'command_result', result: { ok: true } },
];
out.liveQuiet = [];
for (const r of quiet) { replies = [r]; out.liveQuiet.push(await live(SPEAKER)); }
out.liveQuietSent = sent.splice(0).length;
out.liveQuietEvents = events.slice();
// not the speaker entity: refused here, nothing sent
out.liveBad = [];
for (const s of ['lock.front_door', 'media_player.x;y', '', null]) out.liveBad.push(await live(s));
out.liveBadSent = sent.splice(0).length;
// a hub without talkUrl (an older page): refused here
hkMantelClient.useCommands(Object.assign(fakeHub(true), { talkUrl: undefined }));
const kept = act;
act = hkMantelClient.from(snapshot()).actions;
out.liveNoUrl = await live(SPEAKER);
out.liveNoUrlSent = sent.splice(0).length;
act = kept;

// the real hub.js under HA's Ingress prefix (base.js reads <meta name="mantel-base">): /ws/talk there
globalThis.document = { querySelector: () => ({ getAttribute: () => '/api/hassio_ingress/Fict_ional-1' }), addEventListener() {} };
globalThis.location = { protocol: 'https:', host: 'ha.test:8123' };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.open = () => null;
const { Hub } = await import(new URL(hubUrl));
out.hubTalkUrl = new Hub().talkUrl();

// commands off: the port has no request; hkClient refuses, nothing sent
hkMantelClient.useCommands(null);
act = hkMantelClient.from(snapshot()).actions;
events.length = 0;
out.off = await outcome(card(act, SPEAKER, new Blob([clip], { type: 'audio/webm' })));
out.offEvents = events.slice();
out.offSent = sent.length;
process.stdout.write(JSON.stringify(out) + '\n', () => process.exit(0));   // a pipe: flush before exit
