// Run by tests/test_intercom_card.py with node: the Intercom's page side, web/hk/modules/hk-mic.js (the PCM worklet's
// source, the socket Worker, the session) and web/hk/cards/hk-intercom.js (the picker's decisions and the sheet's
// Controller), both loaded as the page loads them, with fakes for everything outside them: the action port, the
// feed, the microphone session, the clock, and a WebSocket. No DOM, no sound, no network.
//
//   node intercom_harness.mjs <hk-mic.js> <hk-intercom.js> [--lazy-mic]
//
// With --lazy-mic it runs the one scenario of a page that has not got hk-mic.js yet (the card imports it) and prints its
// observations as one JSON object.
//
// Prints one JSON line: [{name, ok, error?}, ...], one per scenario below (the pytest file names them).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const [micPath, cardPath] = process.argv.slice(2, 4);
const micSrc = readFileSync(micPath, 'utf8'), cardSrc = readFileSync(cardPath, 'utf8');

// ---------------------------------------------------------------- the page, as little of it as the files touch
function page(o = {}) {
  const store = new Map();
  const win = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    addEventListener() {}, dispatchEvent() { return true; }, isSecureContext: true, console, JSON, Promise, Math, Date, Object, Array, Set, Map,
    Int16Array, Uint8Array, Float32Array, ArrayBuffer, String, Number, Error, setTimeout, clearTimeout, setInterval, clearInterval,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = (o || {}).detail; } },
  };
  win.window = win; win.globalThis = win; win.hkShell = { productName: () => 'Mantel' }; win.location = { hash: '', pathname: '/', search: '' }; win.history = { state: null, replaceState() {} };
  const ctx = vm.createContext(win);
  if (o.lazyMic) {
    // the microphone module not yet there: the card imports it (import() is the page's; here a stand-in that runs the module)
    win.__imported = [];
    win.__import = (u) => { win.__imported.push(u); if (o.failMic) return Promise.reject(new Error('offline')); vm.runInContext(micSrc, ctx); return Promise.resolve({}); };
    if (o.stamp) win.hkV = (u) => u + '?v=9';
    win.console = { ...console, error() {} };
    vm.runInContext(cardSrc.replace(/\bimport\(/g, 'window.__import('), ctx);
  } else {
    vm.runInContext(micSrc, ctx);
    vm.runInContext(cardSrc, ctx);
  }
  return { win, store };
}

// ---------------------------------------------------------------- the fakes
function clock() {
  let t = 1000, id = 0;
  const timers = new Map();
  const c = {
    now: () => t,
    setTimeout(fn, ms) { timers.set(++id, { fn, at: t + ms, every: 0 }); return id; },
    clearTimeout(i) { timers.delete(i); },
    setInterval(fn, ms) { timers.set(++id, { fn, at: t + ms, every: ms }); return id; },
    clearInterval(i) { timers.delete(i); },
    // move time on, running what falls due, in order
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [i, x] = due;
        t = x.at;
        if (x.every) x.at += x.every; else timers.delete(i);
        x.fn();
      }
      t = end;
    },
  };
  return c;
}
const flush = () => new Promise((r) => setImmediate(r));

class FakeMic {
  constructor() {
    this.calls = []; this.rate = 24000; this.bytes = 0; this.level = 0; this.on = {}; this.key = 0;
    this.sync_ = { open: true, dropped: false }; this.startError = null; this.unlocks = 0; this.playing = null; this.closed = false;
  }
  unlock() { this.unlocks++; return this.rate; }
  begin() { this.calls.push(['begin']); return ++this.key; }
  start() { this.calls.push(['start']); if (this.startRate) this.rate = this.startRate; return this.startError ? Promise.reject(this.startError) : Promise.resolve(this.rate); }
  open(url, token, upload) { this.calls.push(['open', url, token, !!upload]); }
  rec(on) { this.calls.push(['rec', on]); }
  text(o) { this.calls.push(['text', JSON.parse(JSON.stringify(o))]); if (o.type === 'cancel') this.bytes = 0; }
  sync() { return Promise.resolve({ open: this.sync_.open, bytes: this.bytes, dropped: this.sync_.dropped }); }
  closeSocket() { this.calls.push(['closeSocket']); }
  noSocket() { this.calls.push(['noSocket']); }
  uploadable() { return { pcm: new ArrayBuffer(this.bytes), rate: this.rate }; }
  seconds() { return this.bytes / 2 / this.rate; }
  clear() { this.bytes = 0; this.calls.push(['clear']); }
  play(done) { this.calls.push(['play']); this.playing = done; return { stop() {} }; }
  stopPlay() { this.playing = null; }
  close() { this.closed = true; }
  warm() { this.calls.push(['warm']); }
  // the test's hand
  speak(secs) { this.bytes += Math.round(secs * this.rate) * 2; this.level = 0.5; }
  ready(max) { this.on.ready({ mode: 'message', rate: this.rate, max_s: max || 30 }); }
  server(e) { this.on.event(e); }
  names() { return this.calls.map((c) => c[0]); }
  texts() { return this.calls.filter((c) => c[0] === 'text').map((c) => c[1]); }
}

const ROOM = (id, name, floor, o = {}) => ({ room: 'media_player.' + id, name, floor, state: 'ok', live: true, why: null, reason: '', ...o });
function feed(o = {}) {
  return {
    enabled: true, live_allowed: false, default_mode: 'message', max_live_s: 60, max_message_s: 30, lag_ms: 4000, can_override: false, away: false,
    here: ['media_player.kitchen'],
    rooms: [ROOM('kitchen', 'Kitchen', 'Downstairs'), ROOM('living_room', 'Living Room', 'Downstairs'),
            ROOM('office', 'Office', 'Downstairs', { state: 'skipped', why: 'leads', reason: 'Kitchen leads Office; skipped' }),
            ROOM('den', 'Den', 'Upstairs', { state: 'skipped', why: 'quiet', reason: 'Quiet hours' }),
            ROOM('bedroom', 'Bedroom', 'Upstairs', { state: 'after', live: false }), ROOM('playroom', 'Playroom', 'Upstairs')],
    floors: [{ id: 'down', name: 'Downstairs', rooms: ['media_player.kitchen', 'media_player.living_room', 'media_player.office'] },
             { id: 'up', name: 'Upstairs', rooms: ['media_player.den', 'media_player.bedroom', 'media_player.playroom'] }],
    presets: [{ id: 'kids', name: 'Kids', rooms: ['media_player.bedroom', 'media_player.playroom'] },
              { id: 'party', name: 'Party', rooms: ['media_player.kitchen', 'media_player.living_room'] }],
    listener: false, play: null, ...o,
  };
}
const K = 'media_player.kitchen', L = 'media_player.living_room', O = 'media_player.office', D = 'media_player.den', B = 'media_player.bedroom', P = 'media_player.playroom';

// A sheet with everything around it faked. `o`: feed (the raw feed or null), mem (remembered), secure, supported, hasPort, oneWay, refuse (ticket error)
function sheet(o = {}) {
  const { win } = page();
  const H = win.hkIntercom._;
  const clk = clock(), mic = new FakeMic(), tickets = [], saves = [], oneWay = { seen: o.oneWay !== false, marks: 0 };
  let fed = 'feed' in o ? H.normalize(o.feed) : H.normalize(feed());
  const actions = {
    intercom(mode, rate) {
      tickets.push([mode, rate]);
      return o.refuse ? Promise.reject(Object.assign(new Error(o.refuseMessage || 'refused'), { code: o.refuse })) : Promise.resolve({ url: 'wss://mantel.example/ws/intercom', token: 'T' + tickets.length });
    },
  };
  let paints = 0;
  const deps = {
    actions: () => actions, feed: () => fed, mic: () => (o.noMic ? null : mic), loading: () => !!o.loading, clock: clk,
    micAllowed: () => (o.micAllowed === 'throws' ? Promise.reject(new Error('no')) : !!o.micAllowed),
    store: { load: () => o.mem || null, save: (v) => saves.push(JSON.parse(JSON.stringify(v))) },
    loadFailed: () => !!o.loadFailed, safari: () => !!o.safari,
    secure: () => o.secure !== false, supported: () => o.supported !== false, hasPort: () => o.hasPort !== false,
    oneWay: { seen: () => oneWay.seen, mark: () => { oneWay.seen = true; oneWay.marks++; } },
    changed: () => { paints++; },
  };
  if (o.startRate) mic.startRate = o.startRate;
  const ctl = new H.Controller(deps);
  return { ctl, mic, clk, tickets, saves, H, oneWay, win, paints: () => paints, feedIs(f) { fed = H.normalize(f); } };
}
const tap = (ctl) => { ctl.micDown(); ctl.micUp(); };
// a Message recording of `secs`, started and (the microphone opened) running
async function record(s, secs = 5) {
  tap(s.ctl);
  await flush();
  s.mic.ready();
  s.mic.speak(secs);
  s.clk.advance(100);
  return s;
}

// (a value made inside the page's context has its own Array and Object: compared as JSON)
const eq = (a, b, m) => assert.deepEqual(a === undefined ? a : JSON.parse(JSON.stringify(a)), b, m);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const lines = (s) => s.ctl.view().status.text;

// ================================================================== hk-mic.js: the pure pieces, the Worker, the session
test('mic_level_and_stamp', () => {
  const { win } = page();
  const M = win.hkMic;
  assert.equal(M.levelOf(new Int16Array(0)), 0);
  assert.equal(M.levelOf(new Int16Array(100)), 0);
  assert.ok(M.levelOf(new Int16Array(100).fill(8000)) > 0.5 && M.levelOf(new Int16Array(100).fill(32767)) <= 1);
  assert.equal(M.stamp(0), '0:00');
  assert.equal(M.stamp(7.2), '0:08');
  assert.equal(M.stamp(30), '0:30');
  assert.equal(M.stamp(61), '1:01');
  // the worklet is a file of its own (a blob: module is refused by the page policy, script-src 'self')
  const tap = readFileSync(new URL('../web/hk/modules/hk-mic-tap.js', import.meta.url), 'utf8');
  assert.match(tap, /registerProcessor\('hk-mic-tap'/);
  assert.match(tap, /Int16Array\(this\.c\)/);
  assert.equal(M.TAP_PATH, '/hk/modules/hk-mic-tap.js');
});

class FakeSocket {
  static all = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 1; this.closed = false; this.closeCode = null; FakeSocket.all.push(this); }
  send(x) { this.sent.push(x); }
  close(code) { this.closed = true; this.closeCode = code; this.readyState = 3; if (this.onclose) this.onclose({ code: code || 1000 }); }
  say(o) { this.onmessage({ data: JSON.stringify(o) }); }
}
function worker() {
  const { win } = page();
  FakeSocket.all = [];
  const said = [], wc = clock();                           // the Worker's time is fake: the pacer's waits are advanced by hand
  const ctx = vm.createContext({ WebSocket: FakeSocket, postMessage: (m) => said.push(m), JSON, Uint8Array, Date: { now: wc.now }, Math, setTimeout: wc.setTimeout, clearTimeout: wc.clearTimeout });
  vm.runInContext(win.hkMic.WORKER_SOURCE, ctx);
  const port = { onmessage: null, close() {} };
  const w = {
    cmd: (d) => ctx.onmessage({ data: d }), said, port, ctx, wc,
    frame: (n = 960, v = 100) => { const b = new Int16Array(n).fill(v).buffer; port.onmessage({ data: b }); return b; },
    sock: () => FakeSocket.all[FakeSocket.all.length - 1],
  };
  w.cmd({ cmd: 'port', port });
  return w;
}
const frames = (sock) => sock.sent.filter((x) => typeof x !== 'string');
const texts = (sock) => sock.sent.filter((x) => typeof x === 'string').map((x) => JSON.parse(x));

test('worker_holds_frames_until_signed_in_then_sends_them_in_order', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 1 });
  w.cmd({ cmd: 'text', obj: { type: 'start', rooms: [K] } });
  w.cmd({ cmd: 'rec', on: true });
  w.frame(960, 1); w.frame(960, 2);                       // recorded while the ticket was on its way
  w.cmd({ cmd: 'open', key: 1, url: 'wss://x/ws/intercom', token: 'TICKET' });
  const s = w.sock();
  assert.equal(s.url, 'wss://x/ws/intercom');
  eq(s.sent, [], 'nothing before the server asks');
  s.say({ type: 'auth_required' });
  eq(texts(s), [{ type: 'auth', access_token: 'TICKET' }]);
  w.frame(960, 3);                                         // still not signed in: held too
  s.say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  eq(w.said.filter((m) => m.ready).map((m) => m.ready), [{ mode: 'message', rate: 24000, max_s: 30 }]);
  const all = s.sent.slice(1);                              // after the auth frame: start, then the three frames
  assert.equal(JSON.parse(all[0]).type, 'start');
  assert.equal(all.length, 4);
  all.slice(1).forEach((f, i) => { assert.equal(f[0], 1, 'a binary frame starts with 1'); assert.equal(f.length, 1 + 960 * 2); assert.equal(new Int16Array(f.buffer.slice(f.byteOffset + 1, f.byteOffset + 3))[0], i + 1); });
  w.frame(960, 4);                                         // signed in: straight out
  assert.equal(frames(s).length, 4);
  assert.equal(w.said.filter((m) => m.chunk).length, 4, 'the page is given a copy of every frame');
});

test('worker_sends_nothing_while_not_recording_and_the_copy_matches', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 1 });
  w.cmd({ cmd: 'open', key: 1, url: 'wss://x', token: 'T' });
  w.sock().say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  w.frame();                                               // the microphone runs all along; the button is off
  assert.equal(frames(w.sock()).length, 0);
  w.cmd({ cmd: 'rec', on: true });
  w.frame(); w.frame();
  w.cmd({ cmd: 'rec', on: false });
  w.frame();
  assert.equal(frames(w.sock()).length, 2);
  w.cmd({ cmd: 'sync' });
  eq(w.said.filter((m) => m.synced).map((m) => m.synced), [{ open: true, bytes: 2 * 960 * 2, dropped: false }]);
});

test('worker_sync_waits_for_the_socket_and_says_closed_when_there_is_none', () => {
  const w = worker();
  w.cmd({ cmd: 'sync' });                                  // no socket at all: the page uploads
  eq(w.said.filter((m) => m.synced).map((m) => m.synced.open), [false]);
  w.said.length = 0;
  w.cmd({ cmd: 'begin', key: 2 });
  w.cmd({ cmd: 'rec', on: true });
  w.frame();
  w.cmd({ cmd: 'open', key: 2, url: 'wss://x', token: 'T' });
  w.cmd({ cmd: 'sync' });                                  // not signed in yet: answered when it is
  assert.equal(w.said.filter((m) => m.synced).length, 0);
  w.sock().say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  eq(w.said.filter((m) => m.synced).map((m) => m.synced), [{ open: true, bytes: 1920, dropped: false }]);
  w.said.length = 0;
  w.sock().close();                                        // the server hung up
  assert.ok(w.said.some((m) => m.closed));
  w.cmd({ cmd: 'sync' });
  assert.equal(w.said.filter((m) => m.synced)[0].synced.open, false);
});

test('worker_a_cancel_starts_the_count_again_and_server_events_reach_the_page', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 1 });
  w.cmd({ cmd: 'open', key: 1, url: 'wss://x', token: 'T' });
  const s = w.sock();
  s.say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  w.cmd({ cmd: 'rec', on: true });
  w.frame(); w.frame();
  w.cmd({ cmd: 'text', obj: { type: 'cancel' } });
  w.frame();
  w.cmd({ cmd: 'sync' });
  assert.equal(w.said.filter((m) => m.synced)[0].synced.bytes, 1920, 'only what was recorded since the cancel');
  s.say({ type: 'rooms', rooms: [{ room: K, state: 'ok' }] });
  s.say({ type: 'sent', rooms: 1, failed: [] });
  eq(w.said.filter((m) => m.event).map((m) => m.event.type), ['rooms', 'sent']);
  assert.ok(w.said.filter((m) => m.event).every((m) => m.id === 1));
});

test('worker_auth_invalid_is_an_error_and_a_close', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 3 });
  w.cmd({ cmd: 'open', key: 3, url: 'wss://x', token: 'SPENT' });
  w.sock().say({ type: 'auth_invalid' });
  eq(w.said.filter((m) => m.error).map((m) => [m.error, m.code, m.id]), [['not signed in', 'auth', 3]]);
  assert.ok(w.sock().closed);
});

test('worker_uploads_a_whole_recording_as_forty_millisecond_frames_then_says_so', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 4 });
  const pcm = new Int16Array(960 * 5 + 100).fill(7);
  w.cmd({ cmd: 'open', key: 4, url: 'wss://x', token: 'T', upload: { pcm: pcm.buffer, rate: 24000 } });
  const s = w.sock();
  s.say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  const f = frames(s);
  assert.equal(f.length, 6, 'five whole frames and the end');
  assert.ok(f.slice(0, 5).every((x) => x[0] === 1 && x.length === 1 + 1920) && f[5].length === 1 + 200);
  assert.ok(w.said.some((m) => m.uploaded));
  w.cmd({ cmd: 'sync' });
  assert.equal(w.said.filter((m) => m.synced)[0].synced.bytes, pcm.byteLength);
});

test('worker_a_held_queue_that_overflows_says_it_dropped', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 1 });
  w.cmd({ cmd: 'rec', on: true });
  for (let i = 0; i < 2200; i++) w.frame(960 * 1, 1);       // ~4.2 MB held for a socket that never signs in
  w.cmd({ cmd: 'open', key: 1, url: 'wss://x', token: 'T' });
  w.sock().say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  w.wc.advance(80000);                                      // (what was held goes out paced: 88 s of audio at 1.2x)
  w.cmd({ cmd: 'sync' });
  assert.equal(w.said.filter((m) => m.synced)[0].synced.dropped, true);
});

test('worker_ignores_an_old_sockets_open_and_close_lets_go', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 5 });
  w.cmd({ cmd: 'open', key: 4, url: 'wss://old', token: 'T' });            // a late open for an earlier begin
  assert.equal(FakeSocket.all.length, 0);
  w.cmd({ cmd: 'open', key: 5, url: 'wss://new', token: 'T' });
  w.cmd({ cmd: 'close' });
  assert.ok(w.sock().closed);
  assert.equal(w.sock().closeCode, 1000, 'a close frame, normal closure');
  assert.ok(w.said.some((m) => m.bye), 'and the page is told it is done');
});

// What the server's bucket would do with what the Worker sent: a second of audio in hand, refilled at 1.25x real time, a frame
// beyond that dropped. `step(ms)` moves the Worker's clock on and returns what was dropped (audio seconds that did not fit).
function bucket(w, sock, rate = 24000) {
  let tokens = 1, seen = 0, short = 0, burst = 0, first = true;
  const take = () => {
    const f = frames(sock);
    let secs = 0;
    for (; seen < f.length; seen++) secs += (f[seen].length - 1) / 2 / rate;
    tokens -= secs;
    if (tokens < -1e-9) { short += -tokens; tokens = 0; }
    if (first) { burst = secs; first = false; }
    return secs;
  };
  take();
  return {
    burst: () => burst, dropped: () => short,
    step(ms) { const dt = 0.005; for (let t = 0; t < ms; t += 5) { w.wc.advance(5); tokens = Math.min(1, tokens + 1.25 * dt); take(); } },
    sentSecs: () => frames(sock).reduce((a, f) => a + (f.length - 1) / 2 / rate, 0),
  };
}

test('worker_paces_an_upload_to_the_servers_bucket_a_burst_under_a_second_then_a_little_over_real_time', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 4 });
  const pcm = new Int16Array(24000 * 5).fill(7);               // five seconds: Send Again, Send Anyway, the Live rescue
  w.cmd({ cmd: 'open', key: 4, url: 'wss://x', token: 'T', upload: { pcm: pcm.buffer, rate: 24000 } });
  const s = w.sock();
  s.say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  const b = bucket(w, s);
  assert.ok(b.burst() <= 0.75 + 1e-9 && b.burst() > 0.6, 'at most three quarters of a second at once: ' + b.burst());
  assert.equal(w.said.filter((m) => m.uploaded).length, 0, 'not done yet');
  b.step(1000);
  assert.ok(b.sentSecs() <= 0.75 + 1.2 * 1 + 0.05, 'no faster than 1.2x after that: ' + b.sentSecs());
  b.step(2300);
  assert.equal(b.dropped(), 0, 'the bucket never ran dry: nothing dropped');
  assert.equal(w.said.filter((m) => m.uploaded).length, 0, 'five seconds take (5 - 0.75) / 1.2 = 3.5 s');
  b.step(400);
  assert.equal(b.dropped(), 0);
  assert.equal(w.said.filter((m) => m.uploaded).length, 1);
  assert.ok(Math.abs(b.sentSecs() - 5) < 1e-9);
  w.cmd({ cmd: 'sync' });
  assert.equal(w.said.filter((m) => m.synced)[0].synced.bytes, pcm.byteLength);
});

test('worker_paces_the_frames_held_before_sign_in_and_those_behind_a_live_start_in_order', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 1 });
  w.cmd({ cmd: 'text', obj: { type: 'start', rooms: [K] } });
  w.cmd({ cmd: 'rec', on: true });
  for (let i = 1; i <= 60; i++) w.frame(960, i);                // 2.4 s while the ticket and the sign-in took their time
  w.cmd({ cmd: 'open', key: 1, url: 'wss://x', token: 'T' });
  const s = w.sock();
  s.say({ type: 'auth_required' });
  s.say({ type: 'auth_ok', mode: 'live', rate: 24000, max_s: 60 });
  const b = bucket(w, s);
  assert.equal(JSON.parse(s.sent[1]).type, 'start', 'the start goes first');
  assert.ok(b.burst() <= 0.75 + 1e-9 && b.burst() > 0.6, 'a burst under a second: ' + b.burst());
  // the person is still talking: a frame every 40 ms, behind the held ones
  for (let i = 61; i <= 85; i++) { w.frame(960, i); b.step(40); }
  b.step(4000);
  assert.equal(b.dropped(), 0, 'nothing the bucket would drop');
  const f = frames(s);
  assert.equal(f.length, 85, 'every frame arrived');
  f.forEach((x, i) => assert.equal(new Int16Array(x.buffer.slice(x.byteOffset + 1, x.byteOffset + 3))[0], i + 1, 'in order'));
  // caught up: a frame now goes out at once, as before
  w.frame(960, 90);
  assert.equal(frames(s).length, 86);
});

test('worker_a_close_is_a_normal_closure_and_stops_a_paced_upload', () => {
  const w = worker();
  w.cmd({ cmd: 'begin', key: 4 });
  const pcm = new Int16Array(24000 * 3).fill(7);
  w.cmd({ cmd: 'open', key: 4, url: 'wss://x', token: 'T', upload: { pcm: pcm.buffer, rate: 24000 } });
  const s = w.sock();
  s.say({ type: 'auth_ok', mode: 'message', rate: 24000, max_s: 30 });
  const n = frames(s).length;
  w.cmd({ cmd: 'close' });
  assert.equal(s.closeCode, 1000);
  w.wc.advance(5000);
  assert.equal(frames(s).length, n, 'the rest of the upload is not sent after the close');
  assert.ok(w.said.some((m) => m.bye));
});

class FakeCtx {
  constructor(o) { this.sampleRate = (o && o.sampleRate) || 48000; this.state = 'suspended'; this.resumed = 0; this.closed = false; this.audioWorklet = { modules: [], addModule: (u) => { this.audioWorklet.modules.push(u); return Promise.resolve(); } }; this.destination = {}; FakeCtx.made.push(this); }
  resume() { this.resumed++; if (FakeCtx.stuck) return new Promise(() => {}); this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createMediaStreamSource() { if (FakeCtx.failSource && this.sampleRate !== 48000) throw new Error('different sample rate'); return { connect() {}, disconnect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createBuffer(c, n, rate) { const d = new Float32Array(n); return { getChannelData: () => d, length: n, sampleRate: rate }; }
  createBufferSource() { const s = { buffer: null, connect() {}, start() { s.started = true; }, stop() { s.stopped = true; }, onended: null }; FakeCtx.sources.push(s); return s; }
}
FakeCtx.made = []; FakeCtx.sources = []; FakeCtx.failSource = false; FakeCtx.stuck = false;
class FakeNode { constructor(ctx, name, o) { this.name = name; this.options = o; this.port = { posted: [], postMessage(m) { this.posted.push(m); } }; this.disconnect = () => {}; this.connect = () => {}; } }
function env() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }], posted = [], made = [], revoked = [], timers = [];
  FakeCtx.made = []; FakeCtx.sources = [];
  const workers = [];
  return {
    tracks, posted, workers, made, revoked, timers,
    e: {
      AudioContext: FakeCtx, AudioWorkletNode: FakeNode, hasWorklet: true,
      mediaDevices: { getUserMedia: (c) => { posted.push(['gum', c]); return Promise.resolve({ getTracks: () => tracks }); } },
      Worker: class { constructor(u) { this.url = u; this.msgs = []; this.terminated = false; workers.push(this); } postMessage(m) { this.msgs.push(m); } terminate() { this.terminated = true; } },
      MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {}; } },
      URL: { createObjectURL: (b) => { const u = 'blob:' + made.length + ':' + b.parts; made.push(u); return u; }, revokeObjectURL: (u) => { revoked.push(u); } },
      Blob: class { constructor(p) { this.parts = p.join(''); } },
      setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; }, clearTimeout: (t) => { if (t) t.cleared = true; },
    },
  };
}

test('session_makes_the_context_at_24000_inside_the_press_and_says_the_rate_it_got', async () => {
  const { win } = page();
  const x = env();
  const s = win.hkMic.create(x.e);
  assert.equal(s.unlock(), 24000);
  assert.equal(FakeCtx.made.length, 1);
  assert.equal(FakeCtx.made[0].resumed, 1, 'resumed in the press');
  assert.equal(s.unlock(), 24000);
  assert.equal(FakeCtx.made.length, 1, 'once');
  const rate = await s.start();
  assert.equal(rate, 24000);
  eq(x.posted[0][1].audio.echoCancellation, true);
  assert.equal(x.workers.length, 1);
  assert.ok(x.workers[0].msgs.some((m) => m.cmd === 'port'), 'the microphone\'s port went to the Worker');
  assert.match(x.workers[0].url, /function put/);
});

test('session_warm_opens_the_microphone_before_the_press_and_the_press_uses_it', async () => {
  const { win } = page();
  const x = env();
  const s = win.hkMic.create(x.e);
  s.warm();
  await flush();
  assert.equal(x.posted.filter((p) => p[0] === 'gum').length, 1, 'opened as the sheet opened');
  assert.equal(s.recording, false, 'nothing recorded');
  s.warm();
  assert.equal(s.unlock(), 24000);
  await s.start();
  assert.equal(x.posted.filter((p) => p[0] === 'gum').length, 1, 'the press used it: not opened twice');
  s.close();
  assert.equal(x.tracks[0].stopped, true, 'off with the sheet');
});

test('sheet_makes_the_microphone_ready_only_where_it_is_already_allowed', async () => {
  const yes = sheet({ micAllowed: true });
  assert.equal(await yes.ctl.warm(), true);
  eq(yes.mic.names(), ['warm']);
  for (const o of [{ micAllowed: false }, { micAllowed: 'throws' }, { micAllowed: true, noMic: true }]) {
    const no = sheet(o);
    assert.equal(await no.ctl.warm(), false, JSON.stringify(o));
    assert.ok(!no.mic.names().includes('warm'));
  }
  const busy = sheet({ micAllowed: true });
  await record(busy);
  assert.equal(await busy.ctl.warm(), false, 'not while recording');
  const gone = sheet({ micAllowed: true });
  gone.ctl.dispose();
  assert.equal(await gone.ctl.warm(), false);
});

test('session_a_browser_that_will_not_join_the_rates_gets_the_context_at_its_own', async () => {
  const { win } = page();
  const x = env();
  FakeCtx.failSource = true;
  const s = win.hkMic.create(x.e);
  s.unlock();
  const rate = await s.start();
  FakeCtx.failSource = false;
  assert.equal(rate, 48000);
  assert.equal(s.rate, 48000);
  assert.equal(FakeCtx.made[0].closed, true);
});

test('session_keeps_a_copy_plays_it_and_close_lets_everything_go', async () => {
  const { win } = page();
  const x = env();
  const s = win.hkMic.create(x.e);
  s.unlock();
  await s.start();
  s.begin();
  s._heard({ chunk: new Int16Array(960).fill(1000).buffer });
  s._heard({ chunk: new Int16Array(960).fill(-1000).buffer });
  assert.equal(s.bytes, 3840);
  assert.equal(s.pcm().length, 1920);
  assert.ok(Math.abs(s.seconds() - 0.08) < 1e-9);
  assert.ok(s.level > 0);
  let ended = 0;
  const h = s.play(() => { ended++; });
  assert.ok(h && FakeCtx.sources[0].started);
  FakeCtx.sources[0].onended();
  assert.equal(ended, 1);
  assert.equal(s.uploadable().pcm.byteLength, 3840);
  s.close();
  assert.ok(x.tracks[0].stopped && FakeCtx.made[0].closed);
  assert.ok(x.workers[0].msgs.some((m) => m.cmd === 'close'), 'the Worker is asked to close its socket first');
  assert.equal(x.workers[0].terminated, false, 'and is not cut off before it has');
  x.workers[0].onmessage({ data: { bye: true } });
  assert.equal(x.workers[0].terminated, true);
  assert.equal(s.bytes, 0);
  // the Worker's blob URL is let go with the Worker; the worklet is a file (hk-mic-tap.js), never a blob
  await flush();
  assert.equal(x.revoked.length, 1);
  assert.ok(x.revoked.every((u) => x.made.includes(u)));
  assert.ok(x.made.every((u) => !/registerProcessor/.test(u)), 'no worklet blob');
});

test('session_ends_a_worker_that_never_says_bye_after_a_moment', async () => {
  const { win } = page();
  const x = env();
  const s = win.hkMic.create(x.e);
  s.unlock(); await s.start();
  s.close();
  assert.equal(x.workers[0].terminated, false);
  x.timers.filter((t) => !t.cleared).forEach((t) => t.fn());     // the wait runs out
  assert.equal(x.workers[0].terminated, true);
  assert.ok(x.revoked.length >= 1);
});

test('session_start_says_no_unless_the_context_runs_and_a_later_touch_makes_it_run_without_a_second_microphone', async () => {
  const { win } = page();
  const x = env();
  x.e.setTimeout = setTimeout; x.e.clearTimeout = clearTimeout; x.e.resumeWaitMs = 20;
  FakeCtx.stuck = true;                                       // pointerdown on an iPad: resume() never lands
  const s = win.hkMic.create(x.e);
  s.unlock();
  await assert.rejects(s.start(), (e) => e.name === 'Suspended');
  assert.equal(x.posted.filter((p) => p[0] === 'gum').length, 1);
  FakeCtx.stuck = false;
  s.unlock();                                                 // pointerup: the activation
  assert.equal(await s.start(), 24000);
  assert.equal(x.posted.filter((p) => p[0] === 'gum').length, 1, 'the open microphone is used again, not a second one');
  assert.equal(x.workers.length, 1);
  // a touch that lands while start() waits makes it run
  const y = env();
  y.e.setTimeout = setTimeout; y.e.clearTimeout = clearTimeout; y.e.resumeWaitMs = 2000;
  FakeCtx.stuck = true;
  const t = win.hkMic.create(y.e);
  t.unlock();
  const pending = t.start();
  await flush();
  FakeCtx.stuck = false;
  t.unlock();
  assert.equal(await pending, 24000);
  // an interrupted context (Safari) is resumed by the next press too
  FakeCtx.made[FakeCtx.made.length - 1].state = 'interrupted';
  const before = FakeCtx.made[FakeCtx.made.length - 1].resumed;
  t.unlock();
  assert.equal(FakeCtx.made[FakeCtx.made.length - 1].resumed, before + 1);
});

test('session_reports_the_rate_of_the_context_actually_built', async () => {
  const { win } = page();
  const x = env();
  FakeCtx.failSource = true;
  const s = win.hkMic.create(x.e);
  assert.equal(s.unlock(), 24000, 'unlock knows only what it asked for');
  assert.equal(await s.start(), 48000, 'start says what the rebuilt context has');
  assert.equal(s.rate, 48000);
  assert.equal(s.uploadable().rate, 48000);
  FakeCtx.failSource = false;
});

test('session_ignores_an_old_sockets_words', async () => {
  const { win } = page();
  const x = env();
  const s = win.hkMic.create(x.e);
  const heard = [];
  s.on = { ready: (r) => heard.push(['ready', r.mode]), event: (e) => heard.push(['event', e.type]) };
  s.begin(); s.begin();
  s._heard({ id: 1, ready: { mode: 'message' } });
  s._heard({ id: 2, ready: { mode: 'message' } });
  s._heard({ id: 1, event: { type: 'sent' } });
  eq(heard, [['ready', 'message']]);
});

test('supported_needs_a_microphone_a_worker_and_a_worklet', () => {
  const { win } = page();
  assert.equal(win.hkMic.supported({ mediaDevices: { getUserMedia() {} }, AudioContext: FakeCtx, Worker: class {}, hasWorklet: true }), true);
  assert.equal(win.hkMic.supported({ mediaDevices: null, AudioContext: FakeCtx, Worker: class {}, hasWorklet: true }), false);
  assert.equal(win.hkMic.supported({ mediaDevices: { getUserMedia() {} }, AudioContext: FakeCtx, Worker: class {}, hasWorklet: false }), false);
});

// ================================================================== the picker
test('picker_glyphs_and_what_a_tap_can_pick', () => {
  const s = sheet();
  const pills = Object.fromEntries(s.ctl.pills().map((p) => [p.id, p]));
  assert.equal(pills[K].glyph, null, 'Message: a room that will play shows nothing');
  assert.equal(pills[O].glyph, null, 'no bare slash: the second line says why');
  assert.equal(pills[O].cap, 'Plays with Kitchen');
  assert.equal(pills[O].pickable, false);
  assert.equal(pills[O].line, 'Kitchen leads Office');
  assert.equal(pills[D].glyph, 'moon');
  assert.equal(pills[D].pickable, false, 'quiet hours, and this person cannot Send Anyway');
  assert.equal(pills[D].line, 'Den: Quiet hours');
  assert.equal(pills[B].glyph, null);
  const own = sheet({ feed: feed({ can_override: true }) });
  const den = own.ctl.pills().filter((p) => p.id === D)[0];
  eq([den.glyph, den.pickable, den.quiet], ['moon', true, true]);
  assert.match(den.line, /Send Anyway/);
});

test('picker_live_glyphs_waveform_clock_person', () => {
  const s = sheet({ feed: feed({ live_allowed: true }), mem: { mode: 'live' } });
  assert.equal(s.ctl.modeNow(), 'live');
  const g = Object.fromEntries(s.ctl.pills().map((p) => [p.id, [p.glyph, p.pickable]]));
  eq(g[K], ['person', false], 'you are here: left out of Live');
  eq(g[L], ['waveform', true]);
  eq(g[B], ['clock', true], 'after you finish');
  eq(g[P], ['waveform', true]);
  eq(g[O], [null, false]);
  s.ctl.toggleRoom(K);
  assert.match(lines(s), /Kitchen: you.re here/);
  eq(s.ctl.sel, []);
});

test('picker_floors_presets_and_whole_house', () => {
  const s = sheet();
  const names = s.ctl.chips().map((c) => c.name);
  eq(names, ['Whole House', 'Downstairs', 'Upstairs', 'Kids', 'Party']);
  const house = s.ctl.chips()[0];
  eq(house.ids, [K, L, B, P], 'only what a tap can pick');
  s.ctl.chip('floor', 'down');
  eq(s.ctl.sel, [K, L]);
  assert.equal(s.ctl.chips().filter((c) => c.on).map((c) => c.name).join(), 'Downstairs,Party');
  s.ctl.chip('floor', 'up');
  eq(s.ctl.sel, [K, L, B, P], 'a floor adds to what is picked');
  assert.equal(s.ctl.chips().filter((c) => c.on).map((c) => c.name).join(), 'Whole House,Downstairs,Upstairs', 'a preset is on only when it is exactly what is picked');
  s.ctl.chip('house', 'house');
  eq(s.ctl.sel, [], 'Whole House again puts it back');
  s.ctl.chip('house', 'house');
  assert.equal(s.ctl.sel.length, 4);
  s.ctl.chip('preset', 'kids');
  eq(s.ctl.sel, [B, P], 'a preset is its rooms, not added to');
  s.ctl.chip('preset', 'kids');
  eq(s.ctl.sel, []);
  s.ctl.toggleRoom(L); s.ctl.toggleRoom(K);
  assert.equal(s.ctl.chips().filter((c) => c.on).map((c) => c.name).join(), 'Downstairs,Party', 'picked one by one, the preset lights');
});

test('picker_a_floor_or_preset_that_is_another_target_is_left_out', () => {
  // Everywhere is Whole House, Down is Downstairs' rooms in another order, Same repeats Kids; Mixed is its own
  const every = [K, L, O, D, B, P];
  const s = sheet({ feed: feed({ presets: [
    { id: 'every', name: 'Everywhere', rooms: every.slice().reverse() }, { id: 'down', name: 'Down', rooms: [O, L, K] },
    { id: 'kids', name: 'Kids', rooms: [B, P] }, { id: 'same', name: 'Same', rooms: [P, B] }, { id: 'mixed', name: 'Mixed', rooms: [K, P] },
    { id: 'none', name: 'None', rooms: [] }] }) });
  eq(s.ctl.chips().map((c) => c.name), ['Whole House', 'Downstairs', 'Upstairs', 'Kids', 'Mixed']);
  const one = sheet({ feed: feed({ floors: [{ id: 'all', name: 'Everything', rooms: every }, { id: 'down', name: 'Downstairs', rooms: [K, L, O] }, { id: 'down2', name: 'Ground', rooms: [O, K, L] }], presets: [] }) });
  eq(one.ctl.chips().map((c) => c.name), ['Whole House', 'Downstairs'], 'a floor that is the whole house, or another floor, is no second chip');
});

test('picker_a_skipped_pill_says_why_and_is_not_picked', () => {
  const s = sheet();
  s.ctl.toggleRoom(O);
  eq(s.ctl.sel, []);
  eq(s.ctl.view().status, { text: 'Kitchen leads Office', kind: 'info' });
  s.clk.advance(s.H.SAID_MS + 10);
  assert.notEqual(lines(s), 'Kitchen leads Office', 'the line does not stay');
  s.ctl.toggleRoom(D);
  assert.equal(lines(s), 'Den: Quiet hours');
});

test('picker_nothing_to_send_to_names_why', () => {
  const s = sheet({ mem: { rooms: [O] } });
  eq(s.ctl.chosen(), []);
  assert.equal(lines(s), 'Nothing to send to: Kitchen leads Office');
});

test('picker_a_room_the_feed_no_longer_has_is_not_chosen', () => {
  const s = sheet({ mem: { rooms: [K, 'media_player.gone'] } });
  eq(s.ctl.chosen(), [K]);
  assert.equal(s.ctl.view().pills.filter((p) => p.on).length, 1);
});

// ================================================================== the mode, and what is remembered
test('mode_the_switch_is_hidden_unless_live_is_allowed', () => {
  eq(sheet().ctl.view().modes, []);
  const live = sheet({ feed: feed({ live_allowed: true }) });
  eq(live.ctl.view().modes.map((m) => [m.id, m.on]), [['message', true], ['live', false]]);
  const away = sheet({ feed: feed({ live_allowed: true, away: true }), mem: { mode: 'live' } });
  eq(away.ctl.view().modes, [], 'on the tunnel door: Message only');
  assert.equal(away.ctl.modeNow(), 'message');
  const off = sheet({ feed: feed({ live_allowed: false }), mem: { mode: 'live' } });
  assert.equal(off.ctl.modeNow(), 'message', 'a remembered Live is not used where Live is not offered');
});

test('mode_is_remembered_per_person_with_the_rooms', () => {
  const s = sheet({ feed: feed({ live_allowed: true }), mem: { mode: 'message', rooms: [L] } });
  assert.equal(s.ctl.modeNow(), 'message');
  eq(s.ctl.sel, [L]);
  s.ctl.setMode('live');
  eq(s.saves.at(-1), { mode: 'live', rooms: [L] });
  s.ctl.toggleRoom(P);
  assert.equal(s.saves.length, 1, 'the rooms are saved a moment after the last change');
  s.clk.advance(s.H.SAVE_MS + 5);
  eq(s.saves.at(-1), { mode: 'live', rooms: [L, P] });
  const again = sheet({ feed: feed({ live_allowed: true }), mem: s.saves.at(-1) });
  assert.equal(again.ctl.modeNow(), 'live');
  eq(again.ctl.sel, [L, P]);
  const fresh = sheet({ feed: feed({ live_allowed: true, default_mode: 'live' }) });
  assert.equal(fresh.ctl.modeNow(), 'live', 'the house\'s default when nothing is remembered');
});

test('mode_another_screens_change_is_followed_until_this_one_chooses', () => {
  const s = sheet({ feed: feed({ live_allowed: true }) });
  s.ctl.remembered({ mode: 'live', rooms: [K] });
  eq([s.ctl.modeNow(), s.ctl.sel], ['live', [K]]);
  s.ctl.setMode('message');
  s.ctl.remembered({ mode: 'live', rooms: [L] });
  assert.equal(s.ctl.modeNow(), 'message', 'it chose its mode');
  eq(s.ctl.sel, [L], 'it has picked no room, so the rooms follow');
  s.ctl.toggleRoom(P);
  s.ctl.remembered({ mode: 'live', rooms: [K] });
  eq(s.ctl.sel, [L, P], 'once it has picked, they are its own');
});

test('mode_a_switch_while_a_message_waits_is_not_allowed', async () => {
  const s = sheet({ feed: feed({ live_allowed: true }) });     // no room picked: the message waits for one
  await record(s);
  tap(s.ctl);
  assert.equal(s.ctl.state, 'review');
  s.ctl.setMode('live');
  assert.equal(s.ctl.modeNow(), 'message');
});

// ================================================================== Message: record, stop (it sends), sent
test('message_record_stop_sends_sent', async () => {
  const s = sheet({ mem: { rooms: [K, L] } });
  assert.equal(s.ctl.view().mic.label, 'Tap to record');
  tap(s.ctl);
  assert.equal(s.ctl.state, 'connecting');
  assert.equal(lines(s), 'Connecting…');
  assert.equal(s.mic.unlocks >= 2, true, 'unlocked inside the press (down) and again on starting');
  await flush();
  eq(s.tickets, [['message', 24000]]);
  eq(s.mic.calls.find((c) => c[0] === 'open'), ['open', 'wss://mantel.example/ws/intercom', 'T1', false]);
  assert.equal(s.ctl.state, 'recording');
  assert.equal(lines(s), '', 'the button says it: the line is quiet while a Message records');
  s.mic.ready(); s.mic.speak(4); s.clk.advance(100);
  const v = s.ctl.view();
  assert.equal(v.mic.label, 'Tap to send');
  assert.equal(v.mic.time, 'Tap to send · 0:26 left', 'the countdown to the limit');
  assert.equal(v.mic.word, '0:04', 'the big word is the time recorded');
  assert.ok(Math.abs(v.mic.ring - 4 / 30) < 0.01, 'the ring fills toward the limit');
  assert.ok(v.mic.level > 0);
  tap(s.ctl);                                                // stopping sends it: no review step
  assert.equal(s.ctl.state, 'sending');
  eq(s.mic.calls.filter((c) => c[0] === 'rec').map((c) => c[1]), [true, false]);
  await flush();
  eq(s.mic.texts().at(-1), { type: 'send', rooms: [K, L], override: false });
  assert.equal(lines(s), 'Sending…');
  s.mic.server({ type: 'rooms', rooms: [{ room: K, state: 'ok' }, { room: L, state: 'ok' }] });
  s.mic.server({ type: 'sending', rooms: 2 });
  s.mic.server({ type: 'sent', rooms: 2, failed: [] });
  assert.equal(s.ctl.state, 'sent');
  assert.equal(lines(s), 'Sent to 2 rooms');
  const after = s.ctl.view();
  assert.equal(after.mic.hidden, false, 'the microphone is back at once');
  assert.equal(after.mic.word, 'Tap to Talk');
  eq(after.actions.map((a) => a.label), ['Play', 'Send Again']);
  eq(s.saves.at(-1), { mode: 'message', rooms: [K, L] });
  s.clk.advance(s.H.SENT_MS + 50);                         // then the note goes: Tap to Talk alone
  assert.equal(s.ctl.state, 'idle');
  eq(s.ctl.view().actions, []);
  assert.equal(lines(s), 'Kitchen, Living Room');
});

test('message_a_warning_after_a_send_stays_until_the_next_press', async () => {
  const s = sheet({ mem: { rooms: [K, L] } });
  await record(s); tap(s.ctl); await flush();
  s.mic.server({ type: 'sent', rooms: 1, failed: ['Living Room'] });
  s.clk.advance(s.H.SENT_MS * 3);
  assert.equal(s.ctl.state, 'sent');
  assert.match(lines(s), /Living Room didn’t play/);
  eq(s.ctl.view().actions.map((a) => a.label), ['Play', 'Send Again']);
  tap(s.ctl);                                              // the next press is a new message
  assert.equal(s.ctl.state, 'connecting');
});

test('message_playing_the_copy_keeps_the_note_until_it_ends', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl); await flush();
  s.mic.server({ type: 'sent', rooms: 1, failed: [] });
  s.ctl.do('play');
  s.clk.advance(s.H.SENT_MS + 50);
  assert.equal(s.ctl.state, 'sent', 'still playing: the note stays');
  s.mic.playing();
  s.clk.advance(s.H.SENT_MS + 50);
  assert.equal(s.ctl.state, 'idle');
});

test('rooms_clear_all_and_the_count', () => {
  const s = sheet({ mem: { rooms: [K, L] } });
  const v = s.ctl.view();
  assert.equal(v.count.on, 2);
  assert.ok(v.count.of >= 2 && v.canClear);
  s.ctl.clearRooms();
  eq(s.ctl.chosen(), []);
  assert.equal(s.ctl.view().canClear, false);
  s.clk.advance(5000);
  eq(s.saves.at(-1).rooms, [], 'remembered as none');
});

test('message_too_short_is_dropped_with_a_word', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s, 0.2);
  tap(s.ctl);
  assert.equal(s.ctl.state, 'idle');
  assert.equal(lines(s), 'Too short. Tap, speak, tap again');
  assert.ok(s.mic.texts().some((t) => t.type === 'cancel'));
  assert.ok(s.mic.names().includes('closeSocket'));
});

test('message_play_plays_the_pages_copy_and_stops', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl); await flush();
  s.mic.server({ type: 'sent', rooms: 1, failed: [] });     // Play sits under the microphone after a send
  s.ctl.do('play');
  eq(s.mic.names().filter((n) => n === 'play'), ['play']);
  assert.equal(s.ctl.view().actions.find((a) => a.id === 'play').label, 'Stop');
  s.mic.playing();                                           // it ended by itself
  assert.equal(s.ctl.view().actions.find((a) => a.id === 'play').label, 'Play');
});

test('message_re_record_cancels_the_draft_and_reuses_the_open_socket', async () => {
  const s = sheet();                                         // no room picked: it waits in the review
  await record(s); tap(s.ctl);
  assert.equal(s.ctl.state, 'review');
  const begins = s.mic.names().filter((n) => n === 'begin').length;
  s.ctl.do('rerecord');
  assert.equal(s.ctl.state, 'recording');
  eq(s.mic.texts().at(-1), { type: 'cancel' });
  assert.equal(s.mic.names().filter((n) => n === 'begin').length, begins, 'no new socket');
  assert.equal(s.tickets.length, 1);
  assert.equal(s.mic.bytes, 0);
  s.mic.speak(3); s.clk.advance(100); tap(s.ctl);
  assert.equal(s.ctl.state, 'review');
  assert.equal(s.ctl.view().stamp, '0:03');
});

test('message_cancel_drops_the_draft_and_the_socket', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl);
  s.ctl.do('cancel');
  assert.equal(s.ctl.state, 'idle');
  eq(s.mic.texts().at(-1), { type: 'cancel' });
  assert.ok(s.mic.names().includes('closeSocket'));
  assert.equal(s.mic.bytes, 0);
  assert.equal(s.ctl.view().actions.length, 0);
});

test('message_send_with_nothing_picked_asks_for_rooms', async () => {
  const s = sheet();
  await record(s); tap(s.ctl);
  assert.equal(lines(s), 'Choose rooms to send to');
  assert.equal(s.ctl.view().actions[0].disabled, true);
  s.ctl.send();
  assert.ok(!s.mic.texts().some((t) => t.type === 'send'));
  s.ctl.toggleRoom(L);
  assert.equal(s.ctl.view().actions[0].disabled, false);
});

test('message_a_socket_that_did_not_keep_up_is_replaced_by_an_upload_of_the_copy', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s);
  s.mic.sync_ = { open: false, dropped: false };               // it never opened / it dropped
  tap(s.ctl);
  await flush(); await flush();
  assert.equal(s.tickets.length, 2, 'a new ticket');
  const open = s.mic.calls.filter((c) => c[0] === 'open').at(-1);
  eq(open, ['open', 'wss://mantel.example/ws/intercom', 'T2', true], 'the copy goes with it');
  assert.ok(!s.mic.texts().some((t) => t.type === 'send'), 'send waits for the upload');
  s.mic.on.uploaded();
  eq(s.mic.texts().at(-1), { type: 'send', rooms: [K], override: false });
  s.mic.server({ type: 'sent', rooms: 1, failed: [] });
  assert.equal(lines(s), 'Sent to 1 room');
});

test('message_dropped_frames_are_made_up_by_the_upload_too', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s);
  s.mic.sync_ = { open: true, dropped: true };
  tap(s.ctl); await flush(); await flush();
  assert.equal(s.tickets.length, 2);
});

test('message_send_again_is_a_new_ticket_and_the_copy', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl); s.ctl.send(); await flush();
  s.mic.server({ type: 'sent', rooms: 1, failed: [] });
  s.ctl.do('send');                                         // Send Again
  await flush(); await flush();
  assert.equal(s.tickets.length, 2);
  assert.equal(s.mic.calls.filter((c) => c[0] === 'open').at(-1)[3], true);
  s.mic.on.uploaded();
  eq(s.mic.texts().at(-1), { type: 'send', rooms: [K], override: false });
});

test('message_a_failed_room_is_named', async () => {
  const s = sheet({ mem: { rooms: [K, L] } });
  await record(s); tap(s.ctl); s.ctl.send(); await flush();
  s.mic.server({ type: 'sent', rooms: 1, failed: ['Living Room'] });
  assert.equal(lines(s), 'Sent to 1 room. Living Room didn’t play');
});

test('message_send_anyway_asks_again_for_the_quiet_rooms_with_override', async () => {
  const s = sheet({ feed: feed({ can_override: true }), mem: { rooms: [K, D] } });
  eq(s.ctl.chosen(), [K, D], 'a person who may override can pick a quiet room');
  await record(s); tap(s.ctl); s.ctl.send(); await flush();
  eq(s.mic.texts().at(-1), { type: 'send', rooms: [K, D], override: false });
  s.mic.server({ type: 'rooms', rooms: [{ room: K, name: 'Kitchen', state: 'ok' }, { room: D, name: 'Den', state: 'skipped', why: 'quiet', reason: 'Quiet hours' }] });
  s.mic.server({ type: 'sent', rooms: 1, failed: [] });
  assert.equal(lines(s), 'Sent to 1 room. Den is on quiet hours');
  eq(s.ctl.view().actions.map((a) => a.label), ['Play', 'Send Again', 'Send Anyway']);
  s.ctl.do('anyway');
  await flush(); await flush();
  s.mic.on.uploaded();
  eq(s.mic.texts().at(-1), { type: 'send', rooms: [D], override: true }, 'only the quiet room, and the override says so');
});

test('message_no_send_anyway_for_someone_who_may_not', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl); s.ctl.send(); await flush();
  s.mic.server({ type: 'rooms', rooms: [{ room: K, state: 'ok' }, { room: D, state: 'skipped', why: 'quiet' }] });
  s.mic.server({ type: 'sent', rooms: 1, failed: [] });
  assert.ok(!s.ctl.view().actions.some((a) => a.id === 'anyway'));
});

test('message_the_floor_is_held_by_someone_else', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl); s.ctl.send(); await flush();
  s.mic.server({ type: 'busy', name: 'Kitchen tablet' });
  assert.equal(s.ctl.state, 'error');
  assert.equal(lines(s), 'Kitchen tablet is announcing');
  assert.equal(s.ctl.view().actions.find((a) => a.id === 'send').label, 'Send Again');
  assert.ok(s.mic.bytes > 0, 'the copy is kept');
});

test('message_server_errors_are_said_in_words', async () => {
  const cases = [
    [{ type: 'error', code: 'no_rooms' }, 'Nothing to send to: Kitchen leads Office', true],
    [{ type: 'error', code: 'music_assistant_off' }, 'Music Assistant is off'],
    [{ type: 'error', code: 'audit_unavailable' }, /log of what the house does/],
    [{ type: 'error', code: 'rate' }, /Too many announcements/],
    [{ type: 'error', code: 'not_allowed' }, /can.t announce/],
    [{ type: 'error', code: 'weird', message: 'Something odd' }, 'Something odd'],
  ];
  for (const [ev, want, withDecision] of cases) {
    const s = sheet({ mem: { rooms: [K] } });
    await record(s); tap(s.ctl); s.ctl.send(); await flush();
    if (withDecision) s.mic.server({ type: 'rooms', rooms: [{ room: O, state: 'skipped', why: 'leads', reason: 'Kitchen leads Office; skipped' }] });
    s.mic.server(ev);
    assert.equal(s.ctl.state, 'error', ev.code);
    assert.ok(want instanceof RegExp ? want.test(lines(s)) : lines(s) === want, ev.code + ': ' + lines(s));
    assert.equal(s.ctl.view().actions.find((a) => a.id === 'send').label, 'Send Again');
  }
});

test('message_the_socket_dropping_while_sending_keeps_the_copy_for_send_again', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s); tap(s.ctl); s.ctl.send(); await flush();
  s.mic.on.closed();
  assert.equal(s.ctl.state, 'error');
  assert.equal(lines(s), 'The connection dropped. Send Again');
  assert.ok(s.mic.bytes > 0);
});

test('message_the_limit_ends_the_recording_by_the_clock_and_by_the_servers_word', async () => {
  const a = sheet({ mem: { rooms: [K] } });
  tap(a.ctl); await flush(); a.mic.ready(30);
  a.mic.speak(29.95); a.clk.advance(100);
  assert.equal(a.ctl.state, 'recording');
  a.mic.speak(0.1); a.clk.advance(100);
  assert.equal(a.ctl.state, 'sending', 'the countdown reached 0: it stops and sends');
  const b = sheet({ mem: { rooms: [K] } });
  await record(b, 12);
  b.mic.server({ type: 'full' });
  assert.equal(b.ctl.state, 'sending', 'the draft hit the limit: it stops and sends');
  const c = sheet({ mem: { rooms: [K] } });
  tap(c.ctl); await flush(); c.mic.ready(10);                 // the server's limit is shorter than the feed's
  c.mic.speak(10); c.clk.advance(100);
  assert.equal(c.ctl.state, 'sending');
});

// ================================================================== the words
test('words_https_and_needs_mantel_and_off_and_one_way', async () => {
  const insecure = sheet({ secure: false, mem: { rooms: [K] } });
  assert.equal(lines(insecure), 'Needs HTTPS: open this page by its https:// address');
  assert.equal(insecure.ctl.view().mic.kind, 'off');
  assert.equal(insecure.ctl.view().mic.label, 'Needs HTTPS');
  tap(insecure.ctl); await flush();
  eq(insecure.tickets, []);
  assert.ok(!insecure.mic.names().includes('begin') && insecure.mic.unlocks === 0, 'no microphone is touched');
  const ha = sheet({ hasPort: false });
  assert.equal(lines(ha), 'Intercom needs Mantel');
  const off = sheet({ feed: feed({ enabled: false }) });
  assert.equal(lines(off), 'Intercom is off');
  assert.equal(off.ctl.view().mic.kind, 'off');
  const nomic = sheet({ supported: false });
  assert.equal(lines(nomic), 'This browser couldn’t start recording', 'a browser without what recording needs');
  const unloaded = sheet({ supported: false, loadFailed: true });
  assert.equal(lines(unloaded), 'Couldn’t load the microphone — reload the page', 'the module that records never came');
  const first = sheet({ oneWay: false, mem: { rooms: [K] } });
  assert.equal(lines(first), 'One-way: the rooms can’t answer');
  tap(first.ctl); await flush();
  assert.equal(first.oneWay.marks, 1, 'first use only: remembered from the first recording');
  const second = sheet({ oneWay: true, mem: { rooms: [K] } });
  assert.notEqual(lines(second), 'One-way: the rooms can’t answer');
  const loading = sheet({ feed: null });
  assert.equal(lines(loading), 'Connecting…');
});

test('words_idle_lines', () => {
  assert.equal(lines(sheet()), 'Choose rooms to send to');
  assert.equal(lines(sheet({ mem: { rooms: [K] } })), 'Kitchen');
  assert.equal(lines(sheet({ mem: { rooms: [K, L] } })), 'Kitchen, Living Room');
  assert.equal(lines(sheet({ mem: { rooms: [K, L, B] } })), '3 rooms picked');
  const live = sheet({ feed: feed({ live_allowed: true }), mem: { mode: 'live', rooms: [L, B, P] } });
  assert.equal(lines(live), 'Bedroom: after you finish');
  const live2 = sheet({ feed: feed({ live_allowed: true, here: [], rooms: [ROOM('kitchen', 'Kitchen', 'D', { live: false, state: 'after' }), ROOM('office', 'Office', 'D', { live: false, state: 'after' })] }), mem: { mode: 'live', rooms: [K, O] } });
  assert.equal(lines(live2), 'Kitchen, Office: after you finish', 'the spec\'s own example');
});

// ================================================================== the gateway's refusals, and the microphone's
test('refusals_are_said_and_end_the_recording_unless_trying_again_would_do', async () => {
  const want = { commands_disabled: /Allow Control of the House/, forbidden: /can.t use the Intercom/, intercom_off: 'Intercom is off' };
  for (const [code, text] of Object.entries(want)) {
    const s = sheet({ refuse: code, mem: { rooms: [K] } });
    tap(s.ctl); await flush(); await flush();
    assert.equal(s.ctl.state, 'idle', code);
    assert.ok(text instanceof RegExp ? text.test(lines(s)) : lines(s) === text, code + ': ' + lines(s));
    assert.ok(s.mic.names().includes('closeSocket'));
  }
  const s = sheet({ refuse: 'unavailable', mem: { rooms: [K] } });
  tap(s.ctl); await flush(); await flush();
  assert.equal(s.ctl.state, 'recording', 'no link to Mantel for a moment: the page keeps recording');
  s.mic.speak(3); s.clk.advance(100); tap(s.ctl); await flush(); await flush();
  assert.ok(s.ctl.state !== 'idle' && s.mic.bytes > 0, 'the copy is kept: Send tries again');
  assert.equal(lines(s), 'Can’t reach Mantel');
  assert.ok(s.mic.names().includes('noSocket'));
});

test('refusals_the_microphone_not_allowed_or_missing', async () => {
  const a = sheet({ mem: { rooms: [K] } });
  a.mic.startError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  tap(a.ctl); await flush();
  assert.equal(a.ctl.state, 'idle');
  assert.equal(lines(a), 'Microphone blocked — allow it for this site in your browser’s settings', 'generic words for another browser');
  const safari = sheet({ mem: { rooms: [K] }, safari: true });
  safari.mic.startError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  tap(safari.ctl); await flush();
  assert.equal(lines(safari), 'Microphone blocked — allow it for this site in Safari Settings → Websites → Microphone');
  for (const name of ['NotFoundError', 'OverconstrainedError']) {
    const b = sheet({ mem: { rooms: [K] } });
    b.mic.startError = Object.assign(new Error('none'), { name });
    tap(b.ctl); await flush();
    assert.equal(lines(b), 'No microphone on this device', name);
  }
  const busy = sheet({ mem: { rooms: [K] } });
  busy.mic.startError = Object.assign(new Error('busy'), { name: 'NotReadableError' });
  tap(busy.ctl); await flush();
  assert.equal(lines(busy), 'Another app is using the microphone');
  // the audio or the worklet failing: said as the browser's, and logged with its name and message
  const logged = [], was = console.warn;
  console.warn = (...a) => logged.push(a.join(' '));
  for (const name of ['AbortError', 'InvalidStateError', 'NoMic']) {
    const w = sheet({ mem: { rooms: [K] } });
    w.mic.startError = Object.assign(new Error('the worklet failed: ' + name), { name });
    tap(w.ctl); await flush();
    assert.equal(lines(w), 'This browser couldn’t start recording', name);
    assert.equal(w.ctl.state, 'idle');
  }
  console.warn = was;
  assert.equal(logged.length, 3);
  assert.match(logged[0], /AbortError the worklet failed: AbortError/);
});

test('a_stale_ticket_after_cancel_opens_nothing', async () => {
  let release;
  const s = sheet({ mem: { rooms: [K] } });
  s.ctl.d.actions = () => ({ intercom: () => new Promise((r) => { release = r; }) });
  tap(s.ctl);
  await flush();
  tap(s.ctl);                                                 // stopped before the ticket came: nothing was kept
  assert.equal(s.ctl.state, 'idle');
  release({ url: 'wss://x', token: 'LATE' });
  await flush();
  assert.ok(!s.mic.names().includes('open'));
});

test('pointer_a_message_tap_acts_on_release_and_a_cancel_does_nothing', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  s.ctl.micDown();
  assert.equal(s.ctl.state, 'idle', 'down only unlocks the audio');
  assert.equal(s.mic.unlocks, 1);
  s.ctl.micCancel();                                          // pointercancel: a system gesture took the finger (the card then ignores the up)
  assert.equal(s.ctl.state, 'idle');
  s.ctl.micDown(); s.ctl.micUp();
  await flush();
  assert.equal(s.ctl.state, 'recording');
});

test('dispose_closes_the_microphone_and_saves_what_was_picked', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  await record(s);
  s.ctl.toggleRoom(L);
  s.ctl.dispose();
  assert.ok(s.mic.closed);
  eq(s.saves.at(-1).rooms, [K, L]);
});

test('picker_a_leader_of_many_names_one_and_a_count', () => {
  const lead = ROOM('living_room', 'Living Room', 'Downstairs', { why: 'leads', reason: 'Living Room plays only together with Den, Guest Room, Office, Loft' });
  const rooms = feed().rooms.map((r) => (r.room === L ? lead : r));
  const p = sheet({ feed: feed({ rooms }) }).ctl.pills().find((x) => x.id === L);
  assert.equal(p.cap, 'Plays with Den +3', 'a whole house in a group must not run past the pill');
});

test('picker_a_group_leader_says_who_it_plays_with_but_can_be_picked_and_says_why_on_a_tap', () => {
  const lead = ROOM('living_room', 'Living Room', 'Downstairs', { why: 'leads', reason: 'Living Room plays only together with Den' });
  const rooms = feed().rooms.map((r) => (r.room === L ? lead : r));
  const s = sheet({ feed: feed({ rooms }) });
  const p = s.ctl.pills().find((x) => x.id === L);
  eq([p.glyph, p.pickable, p.note], [null, true, true]);
  assert.equal(p.cap, 'Plays with Den', 'a muted second line on the pill, not a glyph');
  assert.equal(p.line, 'Living Room plays only together with Den');
  assert.match(p.aria, /plays only together/);
  s.ctl.toggleRoom(L);
  eq(s.ctl.sel, [L], 'picked');
  assert.equal(lines(s), 'Living Room plays only together with Den', 'and the reason is said');
  eq(s.ctl.chosen(), [L]);
  // Whole House, a floor and a preset include it
  eq(s.ctl.chips()[0].ids, [K, L, B, P]);
  s.ctl.chip('house', 'house');
  assert.ok(s.ctl.sel.includes(L));
  s.ctl.chip('house', 'house');
  s.ctl.chip('floor', 'down');
  eq(s.ctl.sel, [K, L]);
  s.ctl.chip('preset', 'party');                              // (exactly its rooms are picked: the chip is on, so it clears)
  eq(s.ctl.sel, []);
  s.ctl.chip('preset', 'party');
  eq(s.ctl.sel, [K, L]);
  // Live shows the same slash (the leader is not where the person is)
  const live = sheet({ feed: feed({ rooms, live_allowed: true }), mem: { mode: 'live', rooms: [L] } });
  const lp = live.ctl.pills().find((x) => x.id === L);
  eq([lp.glyph, lp.pickable, lp.cap], [null, true, 'Plays with Den']);
  eq(live.ctl.chosen(), [L]);
  // a leader that is skipped (the older wording) is still not pickable
  assert.equal(sheet().ctl.pills().find((x) => x.id === O).pickable, false);
});

test('refusals_the_gateways_reasons_are_said_in_plain_words', async () => {
  const want = {
    intercom_off: 'Intercom is off',
    intercom_no_address: 'The Intercom isn’t set up yet (Settings → Intercom)',
    intercom_not_listening: 'The Intercom isn’t listening yet (Settings → Intercom)',
    music_assistant_off: 'Music Assistant isn’t connected',
    live_off: 'Live isn’t on',
    live_not_away: 'Live works only at home. Send a message instead',
    commands_disabled: 'Turn on Allow Control of the House to use the Intercom',
  };
  for (const [reason, text] of Object.entries(want)) {
    const s = sheet({ refuse: 'unavailable', refuseMessage: reason, mem: { rooms: [K] } });
    tap(s.ctl); await flush(); await flush();
    assert.equal(lines(s), text, reason);
    assert.equal(s.ctl.state, 'idle', reason + ': trying again would not help, so the recording ends');
    assert.ok(s.mic.names().includes('closeSocket'));
    const live = sheet({ feed: liveFeed(), refuse: 'unavailable', refuseMessage: reason, mem: { mode: 'live', rooms: [L] } });
    live.ctl.micDown(); await flush(); await flush();         // (held: Live is push to talk)
    assert.equal(lines(live), text, 'Live: ' + reason);
    assert.notEqual(live.ctl.state, 'recording');
  }
  // a reason it does not know is still "can't reach", and the copy is kept
  const odd = sheet({ refuse: 'unavailable', refuseMessage: 'something_else', mem: { rooms: [K] } });
  tap(odd.ctl); await flush(); await flush();
  assert.equal(odd.ctl.state, 'recording');
  odd.mic.speak(3); odd.clk.advance(100); tap(odd.ctl); await flush(); await flush();
  assert.equal(lines(odd), 'Can’t reach Mantel');
  // refused when it sends (the socket dropped, a new ticket refused): the copy stays and the line says why
  const again = sheet({ mem: { rooms: [K] } });
  await record(again);
  again.mic.sync_ = { open: false, dropped: false };
  again.ctl.d.actions = () => ({ intercom: () => Promise.reject(Object.assign(new Error('music_assistant_off'), { code: 'unavailable' })) });
  tap(again.ctl); await flush(); await flush();
  assert.equal(again.ctl.state, 'error');
  assert.equal(lines(again), 'Music Assistant isn’t connected');
  assert.ok(again.mic.bytes > 0);
});

test('live_after_busy_the_socket_is_closed_so_send_again_opens_a_new_one', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(2); s.clk.advance(100);
  const closes = s.mic.names().filter((n) => n === 'closeSocket').length;
  s.mic.server({ type: 'busy', name: 'Kitchen tablet' });
  assert.equal(s.mic.names().filter((n) => n === 'closeSocket').length, closes + 1, 'closed, as after an error');
  assert.equal(s.ctl.socket, 'none');
  assert.equal(s.ctl.state, 'error');
  s.ctl.send();                                               // Send Again
  await flush(); await flush();
  assert.equal(s.tickets.length, 2, 'a new ticket');
  eq(s.mic.calls.filter((c) => c[0] === 'open').at(-1), ['open', 'wss://mantel.example/ws/intercom', 'T2', true]);
});

test('ticket_the_rate_is_the_one_of_the_context_built_and_only_a_rate_the_server_accepts', async () => {
  const f = sheet({ mem: { rooms: [K] }, startRate: 48000 });     // a browser that built the context at its own rate
  tap(f.ctl); await flush(); await flush();
  eq(f.tickets, [['message', 48000]], 'not the 24000 the first press asked for');
  for (const rate of [16000, 22050, 24000, 32000, 44100, 48000]) {
    const s = sheet({ mem: { rooms: [K] }, startRate: rate });
    tap(s.ctl); await flush(); await flush();
    eq(s.tickets, [['message', rate]], String(rate));
  }
  for (const rate of [8000, 11025, 96000]) {
    const s = sheet({ mem: { rooms: [K] }, startRate: rate });
    tap(s.ctl); await flush(); await flush();
    assert.deepEqual(s.tickets, [], 'no ticket asked for ' + rate);
    assert.equal(s.ctl.state, 'idle');
    assert.equal(lines(s), 'This device’s microphone runs at ' + (rate / 1000) + ' kHz, which the Intercom can’t use');
    assert.ok(!s.mic.calls.some((c) => c[0] === 'rec' && c[1] === true), 'and it did not record');
  }
});

test('live_with_no_room_picked_opens_no_microphone_and_says_so', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [] } });
  s.ctl.micDown(); s.ctl.micUp(); await flush();
  assert.equal(s.ctl.state, 'idle');
  assert.equal(lines(s), 'Pick a room first');
  assert.ok(!s.mic.names().includes('begin') && !s.mic.names().includes('start'));
  eq(s.tickets, []);
  // a room that cannot be picked is no room either
  const gone = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [K, O] } });         // here, and skipped
  gone.ctl.micDown(); await flush();
  assert.equal(lines(gone), 'Pick a room first');
  assert.equal(gone.mic.names().includes('start'), false);
  // Message is different: rooms are picked in the review
  const msg = sheet();
  tap(msg.ctl); await flush();
  assert.equal(msg.ctl.state, 'recording');
});

test('pointer_the_release_and_the_click_unlock_the_audio_again_for_a_touch', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  s.ctl.micDown();
  assert.equal(s.mic.unlocks, 1);
  s.ctl.micUp();                                              // Message: the release starts it, after unlocking once more
  assert.ok(s.mic.unlocks >= 2, 'unlocked on the release');
  const n = s.mic.unlocks;
  s.ctl.unlock();                                             // the click
  assert.equal(s.mic.unlocks, n + 1);
  const live = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  live.ctl.micDown(); const d = live.mic.unlocks;
  live.ctl.micUp();
  assert.equal(live.mic.unlocks, d + 1, 'Live too');
  const bad = sheet({ secure: false });
  bad.ctl.micUp(); bad.ctl.unlock();
  assert.equal(bad.mic.unlocks, 0, 'nothing on a page that cannot record');
});

test('words_a_suspended_context_or_a_recording_with_nothing_in_it_says_to_tap_again', async () => {
  const a = sheet({ mem: { rooms: [K] } });
  a.mic.startError = Object.assign(new Error('the audio is not running'), { name: 'Suspended' });
  tap(a.ctl); await flush();
  assert.equal(a.ctl.state, 'idle');
  assert.equal(lines(a), 'Tap the microphone again');
  // the context said running but no sound comes: Recording does not stay up with 0 s captured
  const b = sheet({ mem: { rooms: [K] } });
  tap(b.ctl); await flush();
  assert.equal(b.ctl.state, 'recording');
  b.clk.advance(2000);
  assert.equal(b.ctl.state, 'recording', 'a moment is allowed');
  b.clk.advance(1200);
  assert.equal(b.ctl.state, 'idle');
  assert.equal(lines(b), 'Tap the microphone again');
  assert.ok(b.mic.names().includes('closeSocket'));
  // sound that comes keeps it going
  const c = sheet({ mem: { rooms: [K] } });
  tap(c.ctl); await flush();
  c.mic.speak(0.04); c.clk.advance(5000);
  assert.equal(c.ctl.state, 'recording');
  // Live, too
  const d = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  d.ctl.micDown(); await flush(); d.clk.advance(3500);
  assert.equal(d.ctl.state, 'idle');
  assert.equal(d.ctl.liveStarted, false);
});

// ================================================================== Live (drawn only when the feed allows it)
const liveFeed = () => feed({ live_allowed: true });
test('live_hold_to_talk_starts_at_the_press_and_ends_at_the_release', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L, P] } });
  assert.equal(s.ctl.view().mic.label, 'Hold to talk');
  s.ctl.micDown();
  assert.equal(s.ctl.state, 'connecting');
  await flush();
  eq(s.tickets, [['live', 24000]]);
  const t = s.mic.calls.filter((c) => ['text', 'rec', 'start'].includes(c[0])).map((c) => c[0] + (c[1] && c[1].type ? ':' + c[1].type : ''));
  eq(t.slice(0, 2), ['text:start', 'start'], 'the rooms are named before the first frame');
  eq(s.mic.texts()[0], { type: 'start', rooms: [L, P] });
  s.mic.ready(60); s.mic.speak(3);
  s.mic.server({ type: 'lag_ms', value: 4000 });
  s.clk.advance(HOLD() + 10);
  assert.equal(lines(s), 'Live, about 4 s behind you');
  assert.equal(s.ctl.view().mic.label, 'Release to stop');
  s.ctl.micUp();
  eq(s.mic.texts().at(-1), { type: 'end' });
  s.mic.server({ type: 'sent', rooms: 2, failed: [] });
  assert.equal(lines(s), 'Sent to 2 rooms');
});
const HOLD = () => 450;

test('live_is_push_to_talk_and_a_short_tap_says_hold', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(1);
  s.clk.advance(100);
  assert.equal(s.ctl.view().mic.label, 'Release to stop');
  s.ctl.micUp();
  assert.equal(s.ctl.state, 'idle', 'let go at once: nothing was said, so nothing is sent');
  assert.equal(lines(s), 'Hold the button while you talk');
  const h = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  h.ctl.micDown(); await flush(); h.mic.ready(60); h.mic.speak(2); h.clk.advance(HOLD() + 50);
  h.ctl.micUp();                                              // held, then let go: the talk ends
  eq(h.mic.texts().at(-1), { type: 'end' });
});

test('live_a_taken_press_ends_a_held_talk', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(1); s.clk.advance(HOLD() + 50);
  s.ctl.micCancel();                                          // pointercancel: a call, a system gesture
  eq(s.mic.texts().at(-1), { type: 'end' });
});

test('live_the_status_uses_the_feeds_lag_then_the_servers_and_the_servers_sending_frame_changes_nothing_else', async () => {
  const s = sheet({ feed: feed({ live_allowed: true, lag_ms: 8000 }), mem: { mode: 'live', rooms: [L, P] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(2); s.clk.advance(100);
  assert.equal(lines(s), 'Live, about 8 s behind you', 'the feed\'s lag, rounded to whole seconds');
  s.mic.server({ type: 'rooms', rooms: [{ room: L, state: 'ok' }, { room: P, state: 'ok' }] });
  s.mic.server({ type: 'sending', rooms: 2, live: 1, after: ['Playroom'], lag_ms: 7600 });
  assert.equal(s.ctl.state, 'recording', 'the person is still talking');
  assert.equal(lines(s), 'Live, about 8 s behind you');
  s.mic.server({ type: 'lag_ms', value: 4400 });
  assert.equal(lines(s), 'Live, about 4 s behind you');
  s.mic.server({ type: 'sending', rooms: 2, live: 2, after: [], lag_ms: null });
  assert.equal(lines(s), 'Live, about 4 s behind you', 'a null lag leaves what is known');
  const none = sheet({ feed: feed({ live_allowed: true, lag_ms: null }), mem: { mode: 'live', rooms: [L] } });
  none.ctl.micDown(); await flush(); none.mic.ready(60); none.clk.advance(100);
  assert.equal(lines(none), 'Live');
});

test('live_rooms_that_did_not_connect_live_are_named_and_the_talk_ends_on_the_servers_word', async () => {
  const s = sheet({ feed: feed({ live_allowed: true, can_override: true }), mem: { mode: 'live', rooms: [L, P, D] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(5); s.clk.advance(100);
  s.mic.server({ type: 'rooms', rooms: [{ room: L, state: 'ok' }, { room: P, state: 'ok' }, { room: D, state: 'skipped', why: 'quiet', reason: 'Quiet hours' }] });
  s.mic.server({ type: 'fallback', rooms: ['Kitchen'] });
  assert.equal(s.ctl.state, 'recording');
  assert.equal(s.ctl.fallback.length, 1);
  s.clk.advance(11000);                                      // ten seconds of silence: the server ends the talk
  s.mic.server({ type: 'sent', rooms: 3, failed: [], fallback: ['Kitchen'] });
  assert.equal(s.ctl.state, 'sent');
  assert.equal(lines(s), 'Sent to 3 rooms. Kitchen didn\u2019t connect live. Sent as a message. Den is on quiet hours');
  assert.equal(s.mic.calls.filter((c) => c[0] === 'rec').at(-1)[1], false, 'the microphone button is off');
  s.clk.advance(1000);
  assert.equal(s.ctl.view().mic.level, 0);
  const two = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  two.ctl.micDown(); await flush(); two.mic.ready(60); two.mic.speak(3); two.clk.advance(100);
  two.mic.server({ type: 'fallback', rooms: ['Kitchen', 'Office'] });
  two.clk.advance(HOLD()); two.ctl.micUp();                   // let go
  eq(two.mic.texts().at(-1), { type: 'end' });
  assert.equal(lines(two), 'Kitchen, Office didn\u2019t connect live. Sent as a message.', 'while the server finishes');
});

test('live_a_socket_that_drops_mid_talk_sends_the_copy_as_a_message_on_a_new_ticket', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L, P] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(6); s.clk.advance(HOLD() + 50);
  assert.equal(s.tickets.length, 1);
  s.mic.sync_ = { open: false, dropped: false };
  s.mic.on.closed();                                          // the connection dropped
  assert.equal(s.ctl.state, 'sending');
  assert.deepEqual(s.mic.calls.filter((c) => c[0] === 'rec').at(-1), ['rec', false]);
  await flush(); await flush();
  assert.equal(s.tickets.length, 2);
  assert.equal(s.tickets[1][0], 'message', 'a Message, not Live');
  assert.deepEqual(s.mic.calls.filter((c) => c[0] === 'open').at(-1), ['open', 'wss://mantel.example/ws/intercom', 'T2', true]);
  s.mic.on.uploaded();
  eq(s.mic.texts().at(-1), { type: 'send', rooms: [L, P], override: false });
  s.mic.server({ type: 'sent', rooms: 2, failed: [] });
  assert.equal(lines(s), 'Sent to 2 rooms');
  s.ctl.micUp();                                              // (the finger lifting after it all changes nothing)
  assert.equal(s.ctl.state, 'sent');
  // too little said to send
  const t = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  t.ctl.micDown(); await flush(); t.mic.ready(60); t.mic.speak(0.2); t.clk.advance(100);
  t.mic.on.closed();
  assert.equal(t.ctl.state, 'idle');
  assert.equal(t.tickets.length, 1);
});

test('live_someone_else_has_the_floor_and_the_press_goes_no_further', async () => {
  const s = sheet({ feed: liveFeed(), mem: { mode: 'live', rooms: [L] } });
  s.ctl.micDown(); await flush(); s.mic.ready(60); s.mic.speak(1); s.clk.advance(100);
  s.mic.server({ type: 'busy', name: 'Kitchen tablet' });
  assert.equal(s.ctl.state, 'error');
  assert.equal(lines(s), 'Kitchen tablet is announcing');
  assert.equal(s.mic.calls.filter((c) => c[0] === 'rec').at(-1)[1], false);
});

// ================================================================== a tablet that listens (17.4)
class FakeAudio {
  constructor(state) { this.state = state; this.resumed = 0; this.started = []; this.decoded = []; this.destination = {}; FakeAudio.made.push(this); }
  resume() { this.resumed++; if (FakeAudio.allow) this.state = 'running'; return Promise.resolve(); }
  decodeAudioData(bytes) { this.decoded.push(bytes); return Promise.resolve({ duration: 2, bytes }); }
  createBufferSource() { const src = { connect() {}, start: () => this.started.push({ buffer: src.buffer, gain: src.gainValue }) }; src.owner = this; return src; }
  createGain() { const g = { gain: { value: 1 }, connect() {} }; return g; }
}
FakeAudio.made = []; FakeAudio.allow = false;
function listener(o = {}) {
  const { win } = page();
  FakeAudio.made = []; FakeAudio.allow = !!o.allow;
  const clk = clock(), fetched = [], pills = [], gestures = [];
  let busy = false;
  const Ctx = class extends FakeAudio { constructor() { super(o.state || 'suspended'); this.gains = []; } };
  // (the gain the page set on the last gain node is what the source plays at)
  Ctx.prototype.createBufferSource = function () {
    return { connect() {}, start: () => { this.started.push({ gain: this.gains.at(-1).gain.value }); } };
  };
  Ctx.prototype.createGain = function () { const g = { gain: { value: 1 }, connect() {} }; this.gains.push(g); return g; };
  const L = new win.hkIntercom._.Listener({
    AudioContext: Ctx, base: o.base || '', clock: clk, busy: () => busy,
    fetch: (url) => { fetched.push(url); return o.fail ? Promise.reject(new Error('clip 404')) : Promise.resolve(new ArrayBuffer(8)); },
    gesture: (fn) => gestures.push(fn), pill: (show) => pills.push(show),
  });
  return { L, clk, fetched, pills, gestures, ctx: () => FakeAudio.made[0], setBusy: (b) => { busy = b; }, win };
}
const PLAY = (id, volume) => ({ listener: true, play: { id, url: '/api/intercom/clip/' + id + '.wav', volume } });

test('listener_a_tablet_that_is_no_listener_makes_no_audio_and_no_pill', async () => {
  const t = listener();
  t.L.feed({ listener: false, play: null });
  t.L.feed(null);
  t.clk.advance(1000);
  assert.equal(FakeAudio.made.length, 0);
  eq(t.pills, []);
});

test('listener_plays_a_clip_once_at_its_volume_and_never_the_same_id_twice', async () => {
  const t = listener({ allow: true, state: 'running' });
  t.L.feed(PLAY('b1', 0.5));
  await flush(); await flush();
  eq(t.fetched, ['/api/intercom/clip/b1.wav']);
  assert.equal(t.ctx().started.length, 1);
  assert.equal(t.ctx().started[0].gain, 0.5);
  t.L.feed(PLAY('b1', 0.5));                                  // the same broadcast again (another snapshot)
  t.L.feed({ listener: true, play: null });
  await flush();
  assert.equal(t.fetched.length, 1);
  t.L.feed(PLAY('b2', null));                                 // none: full volume
  await flush(); await flush();
  assert.equal(t.ctx().started.at(-1).gain, 1);
  t.L.feed(PLAY('b3', 7));                                    // never louder than full
  await flush(); await flush();
  assert.equal(t.ctx().started.at(-1).gain, 1);
  t.L.feed(PLAY('b4', -1));
  await flush(); await flush();
  assert.equal(t.ctx().started.at(-1).gain, 0);
  eq(t.pills, [], 'a context that runs needs no pill');
  assert.equal(t.L.played, 4);
});

test('listener_a_context_that_wont_start_shows_one_pill_and_the_first_touch_plays_the_clip', async () => {
  const t = listener({ state: 'suspended' });
  t.L.feed({ listener: true, play: null });
  assert.equal(t.gestures.length, 1, 'the first touch is watched for');
  t.clk.advance(400);
  eq(t.pills, [true], 'the pill, once');
  t.L.feed({ listener: true, play: null });
  t.clk.advance(400);
  eq(t.pills, [true]);
  t.L.feed(PLAY('b1', 0.8));
  await flush(); await flush();
  assert.equal(t.fetched.length, 1);
  assert.equal(t.ctx().started.length, 0, 'not played: the browser has not allowed it');
  FakeAudio.allow = true;
  t.gestures[0]();                                            // a touch anywhere
  await flush(); await flush();
  eq(t.pills, [true, false], 'the pill goes');
  assert.equal(t.ctx().started.length, 1);
  assert.equal(t.ctx().started[0].gain, 0.8);
  assert.ok(t.ctx().resumed >= 2);
});

test('listener_a_clip_that_waited_over_a_minute_for_a_touch_is_dropped', async () => {
  const t = listener({ state: 'suspended' });
  t.L.feed(PLAY('b1', 1));
  await flush(); await flush();
  t.clk.advance(61000);
  FakeAudio.allow = true;
  t.gestures[0]();
  await flush(); await flush();
  assert.equal(t.ctx().started.length, 0);
  const u = listener({ state: 'suspended' });
  u.L.feed(PLAY('b1', 1));
  await flush(); await flush();
  u.clk.advance(59000);
  FakeAudio.allow = true;
  u.gestures[0]();
  await flush(); await flush();
  assert.equal(u.ctx().started.length, 1, 'under a minute: still news');
});

test('listener_a_tablet_that_is_itself_talking_plays_nothing', async () => {
  const t = listener({ allow: true, state: 'running' });
  t.setBusy(true);
  t.L.feed(PLAY('b1', 1));
  await flush(); await flush();
  assert.equal(t.fetched.length, 0);
  t.setBusy(false);
  t.L.feed(PLAY('b2', 1));
  await flush(); await flush();
  assert.equal(t.ctx().started.length, 1);
  // ...and one that begins to talk while the clip is on its way
  t.setBusy(false);
  t.L.feed(PLAY('b3', 1));
  t.setBusy(true);
  await flush(); await flush();
  assert.equal(t.ctx().started.length, 1);
});

test('listener_busy_follows_the_open_sheets_state', async () => {
  const s = sheet({ mem: { rooms: [K] } });
  assert.equal(s.H.talking(), false);
  tap(s.ctl); await flush();
  assert.equal(s.H.talking(), true, 'recording');
  s.ctl.dispose();
  assert.equal(s.H.talking(), false);
});

test('listener_a_clip_that_cannot_be_fetched_is_skipped_and_the_next_one_plays', async () => {
  const t = listener({ allow: true, state: 'running', fail: true });
  t.L.feed(PLAY('b1', 1));
  await flush(); await flush();
  assert.equal(t.ctx().started.length, 0);
  t.L.d.fetch = () => Promise.resolve(new ArrayBuffer(8));
  t.L.feed(PLAY('b2', 1));
  await flush(); await flush();
  assert.equal(t.ctx().started.length, 1);
});

test('mic_a_press_while_the_microphone_module_is_on_its_way_says_connecting_not_no_microphone', async () => {
  const s = sheet({ mem: { rooms: [K] }, noMic: true, loading: true });
  tap(s.ctl);
  await flush();
  assert.equal(lines(s), 'Connecting…');
  assert.equal(s.ctl.state, 'idle', 'nothing started');
  const t = sheet({ mem: { rooms: [K] }, noMic: true, loading: false, loadFailed: true });       // it never came: the words say so
  tap(t.ctl);
  await flush();
  assert.equal(lines(t), 'Couldn’t load the microphone — reload the page');
});

test('feed_keeps_the_listener_flag_and_the_play_snapshot', () => {
  const { win } = page();
  const f = win.hkIntercom._.normalize({ enabled: true, listener: true, play: { id: 'x', url: '/api/intercom/clip/x.wav', volume: null }, rooms: [] });
  assert.equal(f.listener, true);
  eq(f.play, { id: 'x', url: '/api/intercom/clip/x.wav', volume: null });
});

// ================================================================== the microphone module on demand (--lazy-mic)
if (process.argv.includes('--lazy-mic')) {
  const seen = {};
  const { win } = page({ lazyMic: true, stamp: true });
  const H = win.hkIntercom._, d = H.depsFor({ intercom: {} }, () => {});
  seen.before = [d.supported(), d.loading()];
  const p = H.needMic();
  seen.during = [d.supported(), d.loading(), d.mic() === null ? 'mic' : 'x'];     // "no microphone" is not said while it is on its way
  await p;
  seen.asked = win.__imported.slice();
  seen.after = [d.loading(), !!win.hkMic];
  await H.needMic();
  seen.again = win.__imported.length;
  const bad = page({ lazyMic: true, failMic: true });
  const e = bad.win.hkIntercom._, dd = e.depsFor({ intercom: {} }, () => {});
  const q = e.needMic();
  await q;
  seen.failed = [dd.loading(), !!bad.win.hkMic];
  await e.needMic();
  seen.retried = bad.win.__imported.length;
  process.stdout.write(JSON.stringify(seen) + '\n');
  process.exit(0);
}

// ================================================================== run
const out = [];
for (const [name, fn] of tests) {
  try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, error: String(e && (e.stack || e.message || e)).split('\n').slice(0, 6).join('\n') }); }
}
process.stdout.write(JSON.stringify(out) + '\n');
