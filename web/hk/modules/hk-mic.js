// @ts-check
// hk-mic.js -- the microphone for the Intercom (docs/phase17/INTERCOM.md, "The microphone code").
//
// WHAT IT IS. The audio half of the Intercom sheet (cards/hk-intercom.js): a worklet that turns the microphone into
// 16-bit PCM, 40 ms at a time, and a Worker that owns the sheet's socket to Mantel (/ws/intercom) and sends those
// frames. Modeled on the doorbell's talk (cards/hk-cameras.js: hk-pcm-tap, TALK_WORKER), and kept apart from it: the
// doorbell card is not changed by the Intercom, and a later cleanup can make it use this module.
//
// WHY A WORKER. Sent from the page's main thread the frames arrive in gaps: a tablet's main thread stalls (the doorbell
// measured 97, 158 and 181 ms between frames the worklet made exactly 40 ms apart). So the worklet posts straight to the
// Worker through a MessageChannel, and the Worker holds the authenticated socket: nothing the page does can get between
// the microphone and Mantel. The Worker hands the page a copy of every frame it sends.
//
// THE PAGE KEEPS ITS OWN COPY of what was recorded until the sheet closes. That is what Play (the review), Send Again and
// the "connection dropped" rescue use, so Mantel keeps no audio after a broadcast (decision 5). The socket is only a
// transport: at Send, if the socket kept up with the recording (`sync`), the draft is already there and `send` finishes
// it; if not (the socket never opened, dropped, or lost frames), the page opens a new one and uploads its copy.
//
// PACING. The server's relay takes audio through a token bucket: one second of audio at most in hand, refilled at 1.25x
// real time, and frames beyond that are silently dropped. So everything the Worker sends that was not made this very
// moment -- the frames held while the socket signed in, the frames behind a Live `start`, a Send Again upload, the Live
// rescue -- goes through one pacer: at most BURST_S (0.75 s) of audio at once, then no faster than PACE (1.2x) real time.
//
// THE RATE. The page asks for an AudioContext at 24000 Hz and says the rate it got (16000-48000 are accepted). Mantel
// never resamples: the WAV header carries the rate and Music Assistant's ffmpeg converts.
//
// THE WIRE (the server's relay): the first frame from the server is {type:'auth_required'}; the page answers
// {type:'auth', access_token}; {type:'auth_ok', mode, rate, max_s} follows (or {type:'auth_invalid'} and a close). Binary
// frames are [1][s16le mono PCM]. Text frames from the page: cancel, send, start, end. The server's JSON events go to the
// card as they are.
//
// A press must be inside the gesture: `unlock()` makes and resumes the AudioContext synchronously (call it from the
// pointer event, and again from pointerup and click: Safari on an iPad counts a touch's pointerdown for nothing),
// `start()` then opens the microphone, once per sheet, and says no unless the context is running.
(function (global) {
  'use strict';
  if (global.hkMic) return;

  var RATE = 24000;               // asked for
  var CHUNK_MS = 40;
  var FRAME = 1;                  // the first byte of a binary frame to the server
  var BURST_S = 0.75;             // the server's bucket holds a second; stay clear of its edge...
  var PACE = 1.2;                 // ...then a little faster than real time (it refills at 1.25)
  var RESUME_WAIT_MS = 3000;      // how long start() waits for a suspended AudioContext to run (a touch may still come)
  var CLOSE_WAIT_MS = 500;        // how long close() lets the Worker say the socket is closed before it ends the Worker
  var QUEUE_MAX = 4 * 1024 * 1024;   // bytes held while the socket is not yet signed in: ~85 s at 24 kHz

  // The AudioWorklet: CHUNK samples (40 ms) of the microphone as Int16, posted to the Worker's port. A worklet, not a
  // ScriptProcessor: it runs off the main thread, so a busy page cannot starve it into gaps.
  // the worklet module is a file of its own (hk-mic-tap.js): the page policy allows scripts from 'self', never blob:
  var TAP_PATH = '/hk/modules/hk-mic-tap.js';

  // The Worker. To the page: {id, ready: {mode, rate, max_s}} once signed in, {id, event} for each of the server's JSON
  // events, {id, chunk} (a copy of each frame it was given while recording), {id, synced: {open, bytes, dropped}} when
  // asked, {id, uploaded: true}, {id, closed: true, code}, {id, error, code}. `id` is the key `begin` was given: the
  // page ignores an old socket's late words.
  //   begin {key}          a new socket is coming (frames recorded meanwhile are held for it)
  //   open {url, token, upload?}  open it; `upload` {pcm, rate}: once signed in, send that whole recording first
  //   port {port}          the microphone's MessageChannel port
  //   rec {on}             frames from the port go to the socket (and a copy to the page) while on
  //   text {obj}           a JSON text frame, in order with the audio
  //   sync                 answer {synced} once everything recorded has been sent (or at once, if there is no socket)
  //   end                  no socket is coming after all
  //   close                let go of everything (the socket gets a close frame, 1000), then {bye: true}
  var SOCKET_WORKER = [
    "var ws = null, key = 0, authed = false, port = null, rec = false, expecting = false, q = [], qbytes = 0;",
    "var dropped = false, sent = 0, wantSync = false, tm = null, up = null, pending = null, pace = null, arate = 24000;",
    "function say(m) { m.id = key; postMessage(m); }",
    "function reset() { q = []; qbytes = 0; dropped = false; sent = 0; wantSync = false; pending = null; }",
    "function stopPump() { if (tm) { clearTimeout(tm); tm = null; } up = null; }",
    "function close() {",
    "  var w = ws; ws = null; authed = false; expecting = false; stopPump();",
    "  if (w) { try { w.close(1000); } catch (x) { /* closed */ } }",
    "}",
    "function out(it) { ws.send(it[0]); if (it[2]) { sent = 0; dropped = false; } else sent += it[1]; }",
    "function put(item, n, z) {",
    "  if (ws && authed && ws.readyState === 1 && !q.length) { out([item, n, z]); return; }",
    "  if (!ws && !expecting) return;",
    "  if (qbytes + n > QUEUE_MAX) { dropped = true; return; }",
    "  q.push([item, n, z]); qbytes += n;",
    "}",
    "function due(n) {",
    "  var t = ((pace.bytes + n) / (2 * arate) - BURST_S) / PACE * 1000;",
    "  return t - (Date.now() - pace.t0);",
    "}",
    "function pump() {",
    "  tm = null;",
    "  while (ws && authed && ws.readyState === 1) {",
    "    var it = q[0], fromUp = false;",
    "    if (!it && up && up.at < up.all.length) {",
    "      var n = Math.min(up.step, up.all.length - up.at), fr = new Uint8Array(n + 1);",
    "      fr[0] = 1; fr.set(up.all.subarray(up.at, up.at + n), 1);",
    "      it = [fr, n, false]; fromUp = true;",
    "    }",
    "    if (!it) break;",
    "    if (it[1]) {",
    "      var w = due(it[1]);",
    "      if (w > 0) { tm = setTimeout(pump, Math.ceil(w)); return; }",
    "      pace.bytes += it[1];",
    "    }",
    "    if (fromUp) up.at += it[1]; else { q.shift(); qbytes -= it[1]; }",
    "    out(it);",
    "  }",
    "  if (!(ws && authed && ws.readyState === 1)) return;",
    "  if (up && up.at >= up.all.length && !q.length) { up = null; say({ uploaded: true }); }",
    "  if (wantSync && !q.length && !up && !pending) { wantSync = false; sync(); }",
    "}",
    "function sync() {",
    "  if (!ws) { say({ synced: { open: false, bytes: sent, dropped: dropped } }); return; }",
    "  if (authed && !q.length && !up && !pending) say({ synced: { open: true, bytes: sent, dropped: dropped } });",
    "  else wantSync = true;",
    "}",
    "function open(d) {",
    "  var w = ws = new WebSocket(d.url);",
    "  expecting = false; pending = d.upload || null;",
    "  w.binaryType = 'arraybuffer';",
    "  w.onmessage = function (e) {",
    "    if (ws !== w || typeof e.data !== 'string') return;",
    "    var m;",
    "    try { m = JSON.parse(e.data); } catch (x) { return; }",
    "    if (m.type === 'auth_required') w.send(JSON.stringify({ type: 'auth', access_token: d.token }));",
    "    else if (m.type === 'auth_ok') {",
    "      authed = true;",
    "      say({ ready: { mode: m.mode, rate: m.rate, max_s: m.max_s } });",
    "      var p = pending; pending = null;",
    "      pace = { t0: Date.now(), bytes: 0 };",
    "      arate = Number(p && p.rate ? p.rate : m.rate) || 24000;",
    "      arate = Math.max(8000, Math.min(96000, arate));",
    "      if (p) up = { all: new Uint8Array(p.pcm), step: Math.round(arate / 25) * 2, at: 0 };",
    "      pump();",
    "    } else if (m.type === 'auth_invalid') { say({ error: 'not signed in', code: 'auth' }); close(); }",
    "    else say({ event: m });",
    "  };",
    "  w.onclose = function (e) {",
    "    if (ws !== w) return;",
    "    ws = null; authed = false; stopPump();",
    "    if (wantSync) { wantSync = false; say({ synced: { open: false, bytes: sent, dropped: dropped } }); }",
    "    say({ closed: true, code: e && e.code });",
    "  };",
    "}",
    "onmessage = function (e) {",
    "  var d = e.data;",
    "  if (d.cmd === 'begin') { close(); reset(); key = d.key; expecting = true; }",
    "  else if (d.cmd === 'open') { if (key === d.key || !d.key) open(d); }",
    "  else if (d.cmd === 'port') {",
    "    if (port) { try { port.close(); } catch (x) { /* closed */ } }",
    "    port = d.port;",
    "    port.onmessage = function (m) {",
    "      if (!rec) return;",
    "      var pcm = new Uint8Array(m.data), out = new Uint8Array(pcm.length + 1);",
    "      out[0] = 1; out.set(pcm, 1);",
    "      put(out, pcm.length);",
    "      postMessage({ id: key, chunk: m.data }, [m.data]);",
    "    };",
    "  } else if (d.cmd === 'rec') rec = !!d.on;",
    "  else if (d.cmd === 'text') put(JSON.stringify(d.obj), 0, d.obj && d.obj.type === 'cancel');",
    "  else if (d.cmd === 'sync') sync();",
    "  else if (d.cmd === 'end') { expecting = false; if (!ws) { q = []; qbytes = 0; } if (wantSync) { wantSync = false; sync(); } }",
    "  else if (d.cmd === 'close') {",
    "    var w = ws;",
    "    if (w && w.readyState < 3) w.onclose = function () { postMessage({ bye: true }); };",
    "    close(); reset(); rec = false;",
    "    if (!w || w.readyState >= 3) postMessage({ bye: true });",
    "  }",
    "};"
  ].join('\n');
  // (the worker's constants, written in front of its source: it has no other way to know them)
  var WORKER_HEAD = 'var QUEUE_MAX = ' + QUEUE_MAX + ', BURST_S = ' + BURST_S + ', PACE = ' + PACE + ';\n';
  var WORKER_SOURCE = WORKER_HEAD + SOCKET_WORKER;

  // ------------------------------------------------------------------ small pure helpers (tested in node)
  // 0..1 for a frame of 16-bit PCM: its RMS, lifted so ordinary speech reaches most of the range
  function levelOf(pcm) {
    if (!pcm || !pcm.length) return 0;
    var sum = 0;
    for (var i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    var rms = Math.sqrt(sum / pcm.length) / 32768;
    return Math.max(0, Math.min(1, Math.sqrt(rms) * 1.6));
  }
  function join(chunks, bytes) {
    var out = new Int16Array(bytes / 2), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }
  function stamp(secs) {
    var s = Math.max(0, Math.ceil(secs - 1e-6)), m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  function revoke(URLs, url) { try { if (URLs && URLs.revokeObjectURL) URLs.revokeObjectURL(url); } catch (e) { /* gone */ } }

  // ------------------------------------------------------------------ the page's side
  // One session per open sheet. `env` is for tests: { AudioContext, Worker, MessageChannel, mediaDevices, URL }.
  function create(env) {
    return new MicSession(env || {});
  }

  class MicSession {
    constructor(env) {
      this.env = env;
      this.rate = 0;                 // the rate the AudioContext has (known once unlock() has run)
      this.key = 0;                  // the socket in use; an older one's words are ignored
      this.chunks = [];              // the page's own copy
      this.bytes = 0;
      this.level = 0;
      this.recording = false;
      this.on = {};                  // ready, event, closed, error, uploaded, chunk
      this._ctx = null; this._worker = null; this._stream = null; this._nodes = null; this._starting = null;
      this._syncs = []; this._play = null;
    }

    // true where the browser can record at all (a secure page with getUserMedia and the audio worklet); false says Needs HTTPS
    static supported(env) {
      env = env || {};
      var md = env.mediaDevices || (global.navigator && global.navigator.mediaDevices);
      var AC = env.AudioContext || global.AudioContext || global.webkitAudioContext;
      return !!(md && md.getUserMedia && AC && (env.Worker || global.Worker) && (env.hasWorklet !== undefined ? env.hasWorklet : global.AudioWorkletNode));
    }
    static secure() { return global.isSecureContext !== false; }

    // INSIDE THE PRESS: the AudioContext made and resumed at once. Returns its rate (0: no audio here).
    unlock() {
      var ctx = this._ctx;
      if (!ctx || ctx.state === 'closed') ctx = this._makeContext(RATE);
      if (!ctx) return 0;
      // (not 'running': also Safari's 'interrupted'). Call this again from pointerup and click: a touch's pointerdown is no
      // user activation for Safari on an iPad, but its pointerup and click are.
      if (ctx.state !== 'running') { try { ctx.resume().catch(function () { /* start() says so */ }); } catch (e) { /* old engine */ } }
      return this.rate;
    }
    _makeContext(rate) {
      var AC = this.env.AudioContext || global.AudioContext || global.webkitAudioContext, ctx = null;
      if (!AC) return null;
      try { ctx = rate ? new AC({ sampleRate: rate }) : new AC(); } catch (e) {
        try { ctx = new AC(); } catch (e2) { return null; }
      }
      this._ctx = ctx; this._mod = null; this._nodes = null;
      this.rate = Math.round(ctx.sampleRate);
      return ctx;
    }
    _module() {
      var ctx = this._ctx;
      if (!this._mod) {
        var url = this.env.tapUrl || TAP_PATH;
        try { if (!this.env.tapUrl && global.hkV) url = global.hkV(TAP_PATH); } catch (e) { /* the plain address */ }
        this._mod = ctx.audioWorklet.addModule(url);
      }
      return this._mod;
    }
    _worker_() {
      if (this._worker) return this._worker;
      var self = this, URLs = this.env.URL || global.URL, B = this.env.Blob || global.Blob, W = this.env.Worker || global.Worker;
      var url = this._workerUrl = URLs.createObjectURL(new B([WORKER_SOURCE], { type: 'application/javascript' }));
      var w = new W(url);
      w.onmessage = function (e) { self._heard(e.data || {}); };
      w.onerror = function () { self._say('error', { error: 'worker', code: 'worker' }); };
      this._worker = w;
      return w;
    }
    _say(name, data) { if (this.on[name]) { try { this.on[name](data); } catch (e) { console.error('[hk-mic]', e); } } }
    _heard(d) {
      if (d.chunk) {                               // a copy of a frame that went (or was held for) the socket
        var pcm = new Int16Array(d.chunk);
        this.chunks.push(pcm); this.bytes += pcm.length * 2;
        this.level = levelOf(pcm);
        this._say('chunk', pcm);
        return;
      }
      if (d.id !== this.key) return;
      if (d.synced) { var s = this._syncs.splice(0); s.forEach(function (f) { f(d.synced); }); return; }
      if (d.ready) this._say('ready', d.ready);
      else if (d.event) this._say('event', d.event);
      else if (d.uploaded) this._say('uploaded', {});
      else if (d.closed) this._say('closed', { code: d.code });
      else if (d.error) this._say('error', { error: d.error, code: d.code });
    }

    // THE SHEET OPENED where the microphone is already allowed: it is opened now, so a press records at once (opened at the
    // press, it ran about a second later and the first words went, 2026-11-05). The AudioContext still waits for the press.
    // Nothing is recorded or sent before it; the microphone goes off with the sheet (close).
    warm() {
      if (this._closed || this._starting || !MicSession.supported(this.env)) return;
      this._open().catch(function () { /* the press opens it again, and says why if it can't */ });
    }

    // THE MICROPHONE, once per sheet: the stream, the worklet and the port to the Worker. Resolves with the rate, once the
    // context is running; if it is not (a touch that was no user activation, a call that took the audio), rejects with
    // name 'Suspended': the person taps again, and the microphone that is already open is used (not opened twice).
    start() {
      var self = this;
      return this._open().then(function () { return self._running(); });
    }
    _running() {
      var self = this, ctx = this._ctx;
      if (!ctx) return Promise.reject(Object.assign(new Error('closed'), { name: 'Closed' }));
      if (ctx.state === 'running') return Promise.resolve(this.rate);
      var set = this.env.setTimeout || global.setTimeout, clear = this.env.clearTimeout || global.clearTimeout;
      var wait = this.env.resumeWaitMs != null ? this.env.resumeWaitMs : RESUME_WAIT_MS;
      return new Promise(function (res) {
        var t = set(res, wait), ok = function () { clear(t); res(); };
        try { ctx.resume().then(ok, ok); } catch (e) { ok(); }
      }).then(function () {
        if (self._ctx !== ctx || ctx.state !== 'running') throw Object.assign(new Error('the audio is not running'), { name: 'Suspended' });
        return self.rate;
      });
    }
    _open() {
      if (this._starting) return this._starting;
      var self = this, md = this.env.mediaDevices || (global.navigator && global.navigator.mediaDevices);
      if (!this.unlock() || !md || !md.getUserMedia) return Promise.reject(Object.assign(new Error('no microphone'), { name: 'NoMic' }));
      var worker = this._worker_();
      var Node = this.env.AudioWorkletNode || global.AudioWorkletNode;
      var build = function (stream) {
        var ctx = self._ctx, src = ctx.createMediaStreamSource(stream);
        var node = new Node(ctx, 'hk-mic-tap', { processorOptions: { chunk: Math.round(ctx.sampleRate / 25) } });
        var mute = ctx.createGain();
        mute.gain.value = 0;                               // pulled by the graph, never heard
        src.connect(node); node.connect(mute); mute.connect(ctx.destination);
        var Chan = self.env.MessageChannel || global.MessageChannel, ch = new Chan();
        node.port.postMessage({ port: ch.port1 }, [ch.port1]);
        worker.postMessage({ cmd: 'port', port: ch.port2 }, [ch.port2]);
        self._nodes = [src, node, mute];
      };
      this._starting = Promise.all([
        md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }),
        this._module()
      ]).then(function (got) {
        var stream = got[0];
        if (self._closed) { self._stopTracks(stream); throw Object.assign(new Error('closed'), { name: 'Closed' }); }
        self._stream = stream;
        try { build(stream); } catch (e) {
          // a browser that will not join a stream to a context of another rate (Firefox): the context at its own rate
          var old = self._ctx;
          try { old.close(); } catch (x) { /* closed */ }
          if (!self._makeContext(0)) throw e;
          return self._module().then(function () { build(stream); });
        }
        return undefined;
      }).then(function () { return undefined; }, function (err) {
        self._starting = null;
        throw err;
      });
      return this._starting;
    }
    _stopTracks(stream) {
      if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* stopped */ } });
    }

    // A SOCKET IS COMING: frames recorded from now are held for it. Returns the key that names it.
    begin() {
      this.key += 1;
      this._worker_().postMessage({ cmd: 'begin', key: this.key });
      return this.key;
    }
    open(url, token, upload) {
      var msg = { cmd: 'open', key: this.key, url: url, token: token };
      if (upload) { msg.upload = upload; }
      this._worker_().postMessage(msg);
    }
    // the page's recording, as a transferable copy for the upload path
    uploadable() {
      var pcm = this.pcm(), buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
      return { pcm: buf, rate: this.rate };
    }
    noSocket() { if (this._worker) this._worker.postMessage({ cmd: 'end' }); }
    rec(on) {
      this.recording = !!on;
      if (this._worker) this._worker.postMessage({ cmd: 'rec', on: !!on });
      if (!on) this.level = 0;
    }
    text(obj) { if (this._worker) this._worker.postMessage({ cmd: 'text', obj: obj }); }
    // resolves {open, bytes, dropped}: whether the socket is signed in and has been given everything recorded
    sync() {
      var self = this;
      return new Promise(function (res) {
        if (!self._worker) { res({ open: false, bytes: 0, dropped: false }); return; }
        self._syncs.push(res);
        self._worker.postMessage({ cmd: 'sync' });
      });
    }
    // the socket and the held frames let go; the recording (the page's copy) stays
    closeSocket() { if (this._worker) this._worker.postMessage({ cmd: 'close' }); this._syncs.splice(0).forEach(function (f) { f({ open: false, bytes: 0, dropped: false }); }); }

    // THE PAGE'S COPY
    pcm() { return join(this.chunks, this.bytes); }
    seconds() { return this.rate ? this.bytes / 2 / this.rate : 0; }
    clear() { this.chunks = []; this.bytes = 0; this.level = 0; }

    // THE REVIEW: the copy played through the context (inside the press: resumed). {stop(), ended: Promise}.
    play(done) {
      this.stopPlay();
      if (!this.bytes) { if (done) done(); return null; }
      var ctx = this._ctx && this._ctx.state !== 'closed' ? this._ctx : this._makeContext(RATE);
      if (!ctx) { if (done) done(); return null; }
      if (ctx.state === 'suspended') { try { ctx.resume().catch(function () { /* silent */ }); } catch (e) { /* old engine */ } }
      var pcm = this.pcm(), buf = ctx.createBuffer(1, pcm.length, this.rate), ch = buf.getChannelData(0);
      for (var i = 0; i < pcm.length; i++) ch[i] = pcm[i] / (pcm[i] < 0 ? 32768 : 32767);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      var self = this, handle = { stop: function () { try { src.onended = null; src.stop(); } catch (e) { /* ended */ } if (self._play === handle) self._play = null; } };
      src.onended = function () { if (self._play === handle) self._play = null; if (done) done(); };
      this._play = handle;
      src.start();
      return handle;
    }
    stopPlay() { if (this._play) this._play.stop(); this._play = null; }

    // The Worker is asked to close its socket (a close frame, 1000) and says {bye} when that is done; only then is it ended
    // (ending it at once could cut the close frame off), or after CLOSE_WAIT_MS if it never does. Its blob URL is let go then.
    _endWorker() {
      var w = this._worker, url = this._workerUrl, URLs = this.env.URL || global.URL, done = false;
      var set = this.env.setTimeout || global.setTimeout, clear = this.env.clearTimeout || global.clearTimeout;
      this._worker = null; this._workerUrl = null;
      var timer = null;
      var finish = function () {
        if (done) return;
        done = true;
        if (timer !== null) clear(timer);
        try { w.terminate(); } catch (e) { /* gone */ }
        revoke(URLs, url);
      };
      timer = set(finish, CLOSE_WAIT_MS);
      w.onmessage = function (e) { if (e && e.data && e.data.bye) finish(); };
      w.onerror = finish;
      try { w.postMessage({ cmd: 'close' }); } catch (e) { finish(); }
    }

    // THE SHEET CLOSED: the microphone off, the socket gone, the context closed. The copy goes with it.
    close() {
      this._closed = true;
      this.stopPlay();
      this.recording = false;
      if (this._worker) this._endWorker();
      this._stopTracks(this._stream);
      this._stream = null;
      if (this._nodes) this._nodes.forEach(function (n) { try { n.disconnect(); } catch (e) { /* off */ } });
      this._nodes = null;
      if (this._ctx) { try { this._ctx.close(); } catch (e) { /* closed */ } }
      this._ctx = null; this._mod = null; this._starting = null;
      this._syncs.splice(0).forEach(function (f) { f({ open: false, bytes: 0, dropped: false }); });
      this.clear();
    }
  }

  global.hkMic = {
    version: '1.0.0', RATE: RATE, CHUNK_MS: CHUNK_MS, FRAME: FRAME,
    create: create, supported: MicSession.supported, secure: MicSession.secure,
    levelOf: levelOf, stamp: stamp,
    TAP_PATH: TAP_PATH, WORKER_SOURCE: WORKER_SOURCE
  };
  try { global.dispatchEvent(new CustomEvent('hk-module-ready', { detail: 'hkMic' })); } catch (e) { /* no window events (a test) */ }
})(typeof window !== 'undefined' ? window : globalThis);
