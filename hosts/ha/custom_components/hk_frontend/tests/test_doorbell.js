// hk-doorbell-card (hk-cameras.js): the #doorbell sheet's live video WITH
// the door's sound, and hold-to-talk through talk.py. The WebRTC and the
// microphone need a real browser; this holds the decisions that are easy to
// undo by accident.
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-cameras.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; print('  PASS  ' + n); } else { fail++; print('  FAIL  ' + n + (d !== undefined ? '   got ' + JSON.stringify(d) : '')); } }
var src = readFile(HK_ROOT + '/frontend/cards/hk-cameras.js');
var psrc = readFile(HK_ROOT + '/frontend/cards/hk-popup.js');
var body = src.slice(src.indexOf('class HkDoorbellCard'), src.indexOf("register('hk-doorbell-card'"));

print('=== registered ===');
ok('the element is defined', !!customElements.get('hk-doorbell-card'));
ok('it is in the card picker', (window.customCards || []).some(function (c) { return c.type === 'hk-doorbell-card'; }));

print('\n=== its own WebRTC, through the public camera API ===');
// HA's player drops the audio track of a muted stream, and unmuting it swaps
// to HLS -- so the card must negotiate itself.
ok('asks for the ICE config first', /camera\/webrtc\/get_client_config/.test(body));
ok('receives audio AND video', /addTransceiver\('audio', \{ direction: 'recvonly' \}\)/.test(body) &&
   /addTransceiver\('video', \{ direction: 'recvonly' \}\)/.test(body));
ok('offers through camera/webrtc/offer and trickles candidates with the session id',
   /type: 'camera\/webrtc\/offer'/.test(body) && /type: 'camera\/webrtc\/candidate'[\s\S]{0,80}session_id: session/.test(body));
ok('candidates found before the session id are queued, then sent',
   /if \(session\) send\(cand\); else pending\.push\(cand\)/.test(body) && /pending\.splice\(0\)\.forEach\(send\)/.test(body));
ok('never uses ha-camera-stream or picture-entity for the live view', !/ha-camera-stream|picture-entity/.test(body));
ok('closing the sheet (disconnect) stops the stream and the mic',
   /disconnectedCallback\(\) \{[\s\S]{0,200}this\._stop\(\);/.test(body) && /_stop\(\) \{[\s\S]{0,200}_talkAbort\(\);[\s\S]{0,40}_teardown\(\);/.test(body));
ok('a failed connection retries with back-off', /RETRY_MS\[Math\.min\(n - 1/.test(body));

print('\n=== sound ===');
ok('the video starts muted (autoplay always allows that)', /v\.muted = true;\n\s*v\.autoplay = true;/.test(body));
ok('a refused unmute mutes again and keeps playing', /self\._blocked = true;\n\s*v\.muted = true;/.test(body));
ok('the door is muted while talking', /_audible\(\) \{ return this\._wantSound && !this\._blocked && !this\._talk; \}/.test(body));

// A video that fades in from 'playing' while the still vanishes at once
// leaves a dark flash between them (plain in a 60 fps capture of a tablet).
ok('the video has no fade-in, and is drawn at 1% before its first frame',
   /'\.db>video\{opacity:\.01;border-radius:inherit\}'/.test(src) && !/\.db>video\{[^}]*transition/.test(src));
ok('the video shows on its first presented frame, the still goes on the next',
   /requestVideoFrameCallback\(fn\)/.test(body) &&
   /frame\(function \(\) \{\n\s*if \(!self\._playing\) return;[^\n]*\n\s*v\.classList\.add\('on'\);\n\s*frame\(function \(\) \{\n\s*if \(self\._playing\) db\.classList\.add\('moving'\);\n\s*self\._markReady\(\);/.test(body));

// On a wall tablet the hardware decoder starting, and the first live frame
// being drawn, each blank the sheet. Both happen unseen while the sheet is
// drawn at 1%.
var P = customElements.get('hk-doorbell-card');
ok('the card tells hk-popup it prepares (hkPrepares) and when it is ready (hkReady)',
   P.hkPrepares === true && typeof P.prototype.hkReady === 'function');
ok('ready once the first frame has shown, or the stream failed, or the card stopped',
   /_again\(\) \{\n\s*var self = this;\n\s*this\._markReady\(\);/.test(body) &&
   /_stop\(\) \{[\s\S]{0,200}this\._markReady\(\);/.test(body) &&
   /window\.RTCPeerConnection\) \{ this\._markReady\(\); return; \}/.test(body));
(function () {
  var c = new P(), calls = 0;
  var realPromise = Promise;
  // Count the resolves synchronously: hkReady's executor runs at once.
  window.Promise = function (ex) { return new realPromise(function (res) { ex(function () { calls++; res(); }); }); };
  c.hkReady(); c.hkReady();
  var waiting = typeof c._readyWait === 'function' && calls === 0;
  c._markReady();
  var afterTwo = calls;
  c.hkReady();
  window.Promise = realPromise;
  ok('hkReady: every waiter resolves once ready, and a late call resolves at once',
     waiting && afterTwo === 2 && calls === 3 && c._readyWait === null, [waiting, afterTwo, calls]);
})();
ok('hk-popup opens a preparing sheet at 1% and reveals it on hkReady or PREP_MAX_MS',
   /'\.hkp\.prep\{opacity:\.01\}'/.test(psrc) && /return !!\(C && C\.hkPrepares\);/.test(psrc) &&
   /var cap = setTimeout\(reveal, PREP_MAX_MS\);/.test(psrc) && /return k\.hkReady\(\);/.test(psrc) &&
   /var PREP_MAX_MS = 1200;/.test(psrc));
// ...but its dim DOES catch them, and ignores them: with the dim off too, a
// second tap in the 1.2 s would go through to the dashboard underneath.
ok('an invisible sheet takes no taps; its dim swallows them',
   /'\.hkp\.prep \.sheet,\.hkp\.prep \.x\{pointer-events:none\}'/.test(psrc) &&
   /if \(self\._el && self\._el\.classList\.contains\('prep'\)\) return;/.test(psrc));

// With a mask on .db the whole sheet and its dim blink out on a tablet as
// the tracks arrive, on every open; never without it. The corners stay round
// without it.
ok('no -webkit-mask-image on the live box (it blanks the sheet on a tablet)', !/mask-image/.test(src.replace(/\/\/.*$/mg, '')));

print('\n=== talk ===');
ok('the button exists only on a secure page with a microphone and a speaker',
   /c\.speaker && window\.isSecureContext && navigator\.mediaDevices/.test(body));
ok('a short press is not sent', /s\.secs = \(performance\.now\(\) - s\.recT0\) \/ 1000;\n\s*s\.cancel = cancel \|\| s\.secs \* 1000 < TALK_MIN_MS/.test(body));
// "Release to send" at the press, before the mic has opened, loses the
// first words: the clip that reaches the doorbell is cut short.
ok('the button says Wait until the recorder is really running',
   /this\._talkUi\('wait'\);\n\s*navigator\.mediaDevices\.getUserMedia/.test(body) &&
   /rec\.start\(\);\n\s*s\.recT0 = performance\.now\(\);[\s\S]{0,160}this\._talkUi\('rec'\);/.test(body));

print('\n=== live talk (talk_live.py) ===');
// Main-thread stalls on a tablet (97-181 ms, at times over a second) starve
// HA's cushion, so the sender lives in a Worker with its own socket.
ok('a Worker with its own authenticated websocket sends the words: [handler id][16-bit PCM]',
   /type: 'auth', access_token: d\.token/.test(src) && /type: 'hk_frontend\/talk\/live', entity_id: d\.entity_id, rate: d\.rate/.test(src) &&
   /out\[0\] = s\.hid; out\.set\(pcm, 1\);/.test(src) && /token: auth\.accessToken/.test(body));
ok('the worklet posts straight to the worker (a MessageChannel): the page is not in the path',
   /node\.port\.postMessage\(\{ port: ch\.port1 \}, \[ch\.port1\]\)/.test(body) && /port: ch\.port2 \}, \[ch\.port2\]\)/.test(body) &&
   /if \(this\.out\) this\.out\.postMessage\(this\.b\.buffer/.test(src));
ok('letting go before the subscription opened still stops it', /if \(stopped\[d\.key\]\) \{ d\.port\.close\(\); return; \}/.test(src));
ok('the worker (and its socket) goes with the sheet', /if \(this\._tw\) \{ this\._tw\.terminate\(\); this\._tw = null; \}/.test(body));
ok('the PCM comes from an AudioWorklet in 40 ms chunks, off the main thread',
   /registerProcessor\('hk-pcm-tap', P\)/.test(src) && /chunk: Math\.round\(ctx\.sampleRate \/ 25\)/.test(body));
ok('nothing is queued before the doorbell listens (a backlog is a delay that never goes away)',
   /if \(!s\.hid \|\| !ws \|\| ws\.readyState !== 1\) return;/.test(src));
ok('the button stays Wait until the doorbell listens, then says it is live',
   /s\.live = true;\n\s*clearTimeout\(s\.liveT\);\n\s*self\._talkUi\('live'\);/.test(body));
ok('a clip is recorded all along and sent only if live failed',
   /if \(s\.live && !s\.liveFailed\) \{\s*\/\/ already heard at the door/.test(body) && /rec\.start\(\);/.test(body));
ok('letting go unsubscribes (the server plays out its buffer)', /_talkEnd\(cancel\) \{[\s\S]{0,600}this\._liveStop\(s\);/.test(body));
ok('the audio context starts inside the press (a gesture) and closes with the sheet',
   /_talkStart\(\) \{[\s\S]{0,300}this\._audioCtx\(\);/.test(body) && /_talkAbort\(\) \{[\s\S]{0,700}this\._actx\.close\(\)/.test(body));
ok('live: false keeps the recorded message', /if \(this\._config\.live === false\) \{ this\._talkUi\('rec'\); return; \}/.test(body));
ok('the mic stays open for the next hold, and closes with the sheet',
   /if \(mic && mic\.active\) \{ this\._talkRecord\(s, mic\); return; \}/.test(body) &&
   /_talkAbort\(\) \{[\s\S]{0,400}this\._stopTracks\(this\._mic\);\s*\/\/ the sheet closed: mic off\n\s*this\._mic = null;/.test(body));
ok('a mic that opens after the sheet closed is stopped at once',
   /if \(!self\.isConnected\) \{ self\._stopTracks\(stream\); return; \}/.test(body));
ok('sending does not close the mic', !/_talkSend\(s\) \{[\s\S]{0,200}_stopTracks/.test(body));
ok('the sent message says how long the clip was', /'Sent \\u00b7 ' \+ s\.secs\.toFixed\(1\) \+ ' s'/.test(body));
ok('pointer capture, so sliding off the button still ends the hold', /setPointerCapture/.test(body));
ok('the clip goes to talk.py for the configured speaker',
   /'\/api\/hk_frontend\/talk\?entity_id=' \+ encodeURIComponent\(c\.speaker\)/.test(body) && /fetchWithAuth/.test(body));
ok('recording keeps the voice processing on (unlike the mic test)',
   /echoCancellation: true, noiseSuppression: true, autoGainControl: true/.test(body));

// LIVE OR A CLIP, NEVER BOTH -- DRIVEN, NOT READ. If a slow doorbell only
// flips a flag and the label and leaves the live session opening, then when
// it answers the worker streams the words while the button says "release to
// send", and release sends the clip too: the door hears the message twice.
// A regex over the source can pin exactly that code, so this drives the real
// card through presses, with stand-ins for what jsc lacks (mic, recorder,
// audio graph, worker), and counts what reaches the door: the worker's
// `start`/`stop`s and talk.py POSTs.
print('\n=== live OR a clip, never both (driven) ===');
(function () {
  var now = 0, workers = [], posts = [], track = { stop: function () { this.stopped = true; } };
  var saved = { performance: globalThis.performance, URL: globalThis.URL };
  globalThis.performance = { now: function () { return now; } };
  var U = function () {};
  U.createObjectURL = function () { return 'blob:hk'; };
  globalThis.URL = U;
  globalThis.Blob = globalThis.Blob || function (parts, o) { this.type = (o || {}).type || ''; };
  window.isSecureContext = true;
  var stream = { active: true, getTracks: function () { return [track]; } };
  globalThis.navigator = { mediaDevices: { getUserMedia: function () { return Promise.resolve(stream); } } };
  function Rec() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
  Rec.isTypeSupported = function (m) { return m === 'audio/webm;codecs=opus'; };
  Rec.prototype.start = function () { this.state = 'recording'; };
  Rec.prototype.stop = function () {
    this.state = 'inactive';
    if (this.ondataavailable) this.ondataavailable({ data: { size: 900 } });
    if (this.onstop) this.onstop();
  };
  window.MediaRecorder = Rec;
  function node() { return { connect: function () {}, disconnect: function () { this.gone = true; } }; }
  var moduleGate = null;         // set to hold addModule open (a slow first press)
  function AC() {
    this.state = 'running'; this.sampleRate = 48000; this.destination = {};
    this.audioWorklet = { addModule: function () { return moduleGate || Promise.resolve(); } };
  }
  AC.prototype.createMediaStreamSource = function () { return node(); };
  AC.prototype.createGain = function () { var n = node(); n.gain = {}; return n; };
  AC.prototype.resume = function () { return Promise.resolve(); };
  AC.prototype.close = function () { this.state = 'closed'; };
  window.AudioContext = AC;
  window.AudioWorkletNode = function () { var n = node(); n.port = { postMessage: function () {} }; return n; };
  window.MessageChannel = function () { this.port1 = { close: function () {} }; this.port2 = { close: function () {} }; };
  window.Worker = function () { this.msgs = []; workers.push(this); };
  window.Worker.prototype.postMessage = function (m) { this.msgs.push(m); };
  window.Worker.prototype.terminate = function () { this.dead = true; };

  function card() {
    var d = new P();
    d.setConfig({ entity: 'camera.front_door', speaker: 'media_player.door' });
    d.isConnected = true;
    d.hass = { states: {}, auth: { accessToken: 'T', expired: false, data: { hassUrl: 'https://ha.test' } },
               fetchWithAuth: function (u, init) { posts.push(u); return Promise.resolve({ ok: true }); } };
    return d;
  }
  function cmds(w, c) { return w ? w.msgs.filter(function (m) { return m.cmd === c; }) : []; }
  function liveTimer() { return __timers.filter(function (t) { return t && t.ms === 1500; })[0]; }
  function press(d) { d._talkStart(); drainMicrotasks(); }
  function release(d, at) { now = at; d._talkEnd(false); drainMicrotasks(); }

  var d = card(), lbl = function () { return d._talkBtn.querySelector('.lbl').textContent; };
  ok('the talk button is drawn (a secure page, a mic, a recorder, a speaker)', !!d._talkBtn);

  // A: the doorbell is slow to listen.
  __resetTimers(); now = 0;
  press(d);
  var s = d._talk, w = workers[0];
  ok('a press asks the worker to open the live session', cmds(w, 'start').length === 1 && cmds(w, 'start')[0].key === s.key);
  ok('...and says Wait until the doorbell listens', lbl() === 'Wait…', lbl());
  now = 1500; liveTimer().fn();
  ok('no answer in 1.5 s: the live session is STOPPED, not left opening',
     s.liveFailed === true && cmds(w, 'stop').length === 1 && cmds(w, 'stop')[0].key === s.key, w.msgs);
  ok('...its audio graph is taken down', s.nodes === null);
  ok('...and the button says the words go as a clip', lbl() === 'Talk — release to send', lbl());
  w.onmessage({ data: { id: s.key, live: true } });          // the doorbell answers late
  ok('a late answer is ignored: the press stays a clip', !s.live && lbl() === 'Talk — release to send');
  release(d, 3000);
  ok('release sends the clip, once', posts.length === 1 && /entity_id=media_player\.door/.test(posts[0]), posts);
  ok('...and no second stop (live was already closed)', cmds(w, 'stop').length === 1);

  // B: the doorbell listens in time.
  __resetTimers(); now = 10000;
  press(d);
  var s2 = d._talk;
  ok('the next press reuses the mic and the worker', workers.length === 1 && cmds(w, 'start').length === 2);
  w.onmessage({ data: { id: s2.key, live: true } });
  ok('the doorbell listens in time: the press is live', s2.live === true && lbl() === 'Talking — release to stop', lbl());
  ok('...and the 1.5 s give-up is cancelled', !liveTimer());
  release(d, 13000);
  ok('release stops the live session and sends NO clip', cmds(w, 'stop').length === 2 && posts.length === 1, posts);

  // C: a live session that fails mid-sentence.
  __resetTimers(); now = 20000;
  press(d);
  var s3 = d._talk;
  w.onmessage({ data: { id: s3.key, live: true } });
  w.onmessage({ data: { id: s3.key, error: 'talkback failed' } });
  ok('a live session that fails mid-sentence is stopped at once', s3.liveFailed === true && cmds(w, 'stop').length === 3);
  release(d, 23000);
  ok('...and the clip (the whole message) goes instead', posts.length === 2, posts);

  // D: closing the sheet.
  var ctx = d._actx;
  d.isConnected = false; d.disconnectedCallback();
  ok('closing the sheet: mic off, audio context closed, worker (and its socket) gone',
     track.stopped === true && ctx.state === 'closed' && w.dead === true && d._mic === null);

  // E: given up on before the worker was even asked -- it never is.
  var d2 = card(), gate = {}, w2;
  gate.p = new Promise(function (res) { gate.open = res; });
  moduleGate = gate.p;
  __resetTimers(); now = 30000;
  press(d2);
  w2 = workers[workers.length - 1];
  ok('(the worklet module is still loading: nothing asked yet)', cmds(w2, 'start').length === 0);
  now = 31500; liveTimer().fn();
  gate.open(); drainMicrotasks();
  ok('given up before it opened: the worker is never asked to start', cmds(w2, 'start').length === 0, w2.msgs);
  moduleGate = null;
  d2.isConnected = false; d2.disconnectedCallback();

  globalThis.performance = saved.performance;
  globalThis.URL = saved.URL;
})();

print('\n=== camera pop-ups ===');
ok('a tap on a camera opens its camera sheet (more-info), never a pop-up',
   /_openCam\(cam\) \{\n\s*this\.dispatchEvent\(new CustomEvent\('hass-more-info'/.test(src) && !/hkPopup\.open\(cam\.popup\)/.test(src));
ok('...and the live tile does not also act: its box takes every tap (pop-up or camera sheet)',
   /tap_action: live \? \{ action: 'none' \} : \{ action: 'more-info' \}/.test(src) &&
   /liveBox\.classList\.add\('pop', 'tap'\);\n\s*liveBox\.addEventListener\('click'/.test(src));
ok('a still and the live box both go through _openCam',
   /box\.addEventListener\('click', function \(\) \{ self\._openCam\(cam\); \}\)/.test(src) && /me\._openCam\(liveCam\)/.test(src));
ok('the strip editor has no pop-up field', !/pop\.placeholder/.test(src) && /row\.append\(ent, opt, nm, up, dn, rm\)/.test(src));
ok('a camera with no microphone gets no speaker button', /getAudioTracks\(\)\.length === 0/.test(body));
ok('a label names the camera', /cap\.textContent = c\.name/.test(body));
ok('a live tile with a pop-up lets touches through HA\'s card (its action handler eats the click on touch)',
   /'\.live\.pop>hui-card\{pointer-events:none\}'/.test(src) && /liveBox\.classList\.add\('pop', 'tap'\)/.test(src));
// (what hashes() returns -- the MOUNTED ones -- is driven in test_popup.js)
ok('hkPopup.open and .hashes exist for the strip and its editor', /open: function \(h\) \{ h = norm\(h\); if \(h && location\.hash !== h\) setHash\(h\); \}/.test(psrc) && /hashes: mounted/.test(psrc));
ok('the pop-up group draws nothing and builds ordinary pop-ups',
   /class HkPopupGroupCard[\s\S]{0,120}:host\{display:none\}/.test(psrc) && /type: 'custom:hk-popup-card' \}, pc\)/.test(psrc));

// THE STRIP NEVER RE-ASKS WITH A CREDENTIAL THAT FAILED. After an HA restart
// the page still holds the old states, and their tokens, until the camera
// integration (UniFi Protect, say) re-adds its cameras. Asking the proxy with
// a dead token every tick makes each 401 a ban-log line -- a burst of them
// per restart. Driven through the real strip; the test itself lives here
// because hk-cameras.js is what it drives.
print('\n=== the camera strip: a failed credential is not used again ===');
(function () {
  var orig = document.createElement;
  document.createElement = function (t) {
    var el = orig.call(document, t);
    if (String(t).toLowerCase() === 'hui-card' && !el.load) el.load = function () {};
    return el;
  };
  var M = customElements.get('hk-camera-mosaic-card');
  var cams = ['a', 'b', 'c'].map(function (n) { return { name: n, option: n, entity: 'camera.' + n }; });
  function states(tok, extra) {
    var st = { 'input_select.cameras': { state: 'a', last_updated: 't' } };
    cams.forEach(function (c) {
      st[c.entity] = { state: 'recording', attributes: { entity_picture: '/api/camera_proxy/' + c.entity + '?token=' + tok } };
    });
    return Object.assign(st, extra || {});
  }
  __resetTimers();
  var m = new M();
  m.isConnected = true;
  m.setConfig({ selector: 'input_select.cameras', cameras: cams });
  m.hass = { states: states('OLD') };
  var slot = m._snaps[0], first = slot.imgs[0].src;       // a cold slot loads into imgs[0]
  ok('a cold still asks with the token it has', slot.loading[0] === true && /token=OLD/.test(first), first);
  slot.imgs[0].onerror();                                  // the proxy said 401
  m._tick();
  ok('after a failure the next tick does NOT ask with the same token',
     slot.loading[0] === false && slot.imgs[0].src === first && !slot.imgs[1].src, slot.imgs[0].src);
  ok('...nor does a reveal (the same loader)', m._loadSlot(slot, 10, 0) === false && slot.imgs[0].src === first);
  m.hass = { states: states('NEW') };                      // the restarted HA's state arrives
  ok('a new token (the new HA\'s state) is asked with at once',
     m._loadSlot(slot, 10, 0) === true && /token=NEW/.test(slot.imgs[0].src), slot.imgs[0].src);
  var r = states('NEW');
  r[slot.cam.entity] = { state: 'unavailable', attributes: { restored: true, entity_picture: '/api/camera_proxy/x?token=Z' } };
  m.hass = { states: r };
  ok('a `restored` placeholder (not set up yet) is never fetched', m._srcFor(slot.cam, slot) === null);
  m.disconnectedCallback();
  document.createElement = orig;
})();


// THE EDITOR'S FIELDS, by name (sections and grids flattened)
function editorFields(tag) {
  var K = customElements.get(tag), p = K.getConfigElement(),
      EC = customElements.get(String(p.tagName).toLowerCase());
  var ed = new EC();
  if (!ed.appendChild) ed.appendChild = function () {};
  ed.setConfig({});
  var out = {};
  (function walk(s) { (s || []).forEach(function (f) { if (f.schema) walk(f.schema); else out[f.name] = f; }); })(ed._form.schema);
  return out;
}

print('\n=== its editor shows what the card does: Talk Live and the sound ON unless turned off ===');
var DF = editorFields('hk-doorbell-card');
ok('Talk live: shown on while unset', DF.live && DF.live.default === true, DF.live && DF.live.default);
ok('Play the doorbell sound: shown on while unset', DF.sound && DF.sound.default === true);
var DS = customElements.get('hk-doorbell-card').getStubConfig({ states: { 'camera.door': {} } });
ok('the stub writes both on, too', DS.live === true && DS.sound === true && DS.entity === 'camera.door', DS);
ok('...and the card still treats a missing key as on', /this\._config\.live === false/.test(body) && /c\.sound !== false/.test(body));

print('\n' + (fail ? 'FAIL ' + fail + ' DOORBELL TESTS' : 'ALL ' + pass + ' DOORBELL TESTS PASS'));
if (fail) throw new Error('doorbell tests failed');
