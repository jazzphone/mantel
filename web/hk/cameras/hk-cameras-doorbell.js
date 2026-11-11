// hk-cameras-doorbell.js - the doorbell card (live camera with talk-back).
//
// PART OF THE CAMERA CARDS (hk-cameras.js). Not a card and not run on its own: it registers one
// function, which hk-cameras.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkCamerasParts = window.hkCamerasParts || {})['hk-cameras-doorbell'] = function (K) {
    var C = K.C, CAM_FOCUS = K.CAM_FOCUS, HkBase = K.HkBase, restWatch = K.restWatch;

    // ======================================================================
    // hk-doorbell-card -- the #doorbell sheet: the front door, live, WITH its
    // sound, and a hold-to-talk button.
    //
    // WHY THIS CARD OWNS ITS OWN WEBRTC. With a stock picture-entity the
    // door's audio never plays. HA's player asks for a MUTED stream, and
    // although the doorbell sends Opus (the answer offers it and the packets
    // arrive -- ~340 KB in a minute, measured in Chrome), ha-web-rtc-player
    // leaves the audio track out of its <video>. Unmuting ha-camera-stream
    // does not help: it swaps to the HLS player, seconds behind and paused
    // until a tap. So this card negotiates through HA's public camera API
    // itself (camera/webrtc/get_client_config, camera/webrtc/offer and
    // /candidate -- the messages the frontend's own player sends) and plays
    // both tracks in one <video>: audio + video, connected in about a second.
    //
    // SOUND starts muted, because autoplay always allows that, and then tries
    // to unmute. With Fully Kiosk's "Autoplay audio" on, that sticks with no
    // tap. A browser that refuses pauses the video instead, so the card mutes
    // again, keeps playing, and the speaker button shows the sound is off: one
    // tap turns it on.
    //
    // TALK: hold and speak, and the words stream live to `speaker` (a UniFi
    // Protect doorbell, through talk_live.py) -- or, anywhere that cannot,
    // they are recorded and played through talk.py when the button is let go.
    // A press is one or the other, never both (see s.fail in _talkRecord). The
    // microphone needs a secure page (https), so on plain http the button is
    // drawn off, saying Needs HTTPS. While the button is held the door's sound
    // is lowered, not muted, and echo cancellation keeps the tablet from
    // sending the door its own voice back (_duck). The doorbell's session is
    // warm from the moment the sheet opens (_talkWarm), and one person talks at
    // a time: everyone else's button says who (talk_live.py's Floor).

    // LIVE TALK (talk_live.py): how long a press waits for the doorbell to
    // start listening before it goes on as a clip instead.
    var LIVE_WAIT_MS = 1500;
    // The AudioWorklet that turns the microphone into 16-bit PCM for the
    // websocket, CHUNK samples (40 ms) at a time. A worklet, not a
    // ScriptProcessor: it runs off the main thread, so a busy page (a 4K
    // video decoding next to it) cannot starve it into gaps.
    var PCM_TAP = [
      "class P extends AudioWorkletProcessor {",
      "  constructor(o) { super(); this.c = (o.processorOptions || {}).chunk || 1920;",
      "    this.b = new Int16Array(this.c); this.n = 0; this.out = null; var me = this;",
      "    this.port.onmessage = function (e) { if (e.data && e.data.port) me.out = e.data.port; }; }",
      "  process(inputs) {",
      "    var ch = inputs[0] && inputs[0][0];",
      "    if (!ch) return true;",
      "    for (var i = 0; i < ch.length; i++) {",
      "      var v = ch[i] < -1 ? -1 : ch[i] > 1 ? 1 : ch[i];",
      "      this.b[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;",
      "      if (this.n === this.c) {",
      "        if (this.out) this.out.postMessage(this.b.buffer, [this.b.buffer]);",
      "        this.b = new Int16Array(this.c); this.n = 0;",
      "      }",
      "    }",
      "    return true;",
      "  }",
      "}",
      "registerProcessor('hk-pcm-tap', P);"
    ].join('\n');
    // THE SENDER RUNS IN A WORKER, WITH ITS OWN SOCKET. Sent from the page's
    // main thread over HA's websocket, the chunks arrive with gaps: a
    // tablet's main thread stalls -- gaps of 97, 158 and 181 ms measured
    // between chunks the worklet produced exactly 40 ms apart, and one of
    // 1.3 s just after a restart (the dashboard redrawing). HA's cushion
    // runs dry and the door hears it. So the worklet posts straight to this
    // worker through a MessageChannel, and the worker holds its own
    // authenticated websocket to HA: nothing the page does can get between
    // the microphone and the doorbell.
    //
    // A WARM SESSION (2026-11-02, docs/phase13/CAMERAS-DIRECT.md): one socket
    // and one subscription, opened when the sheet opens (`open`), not at the
    // press, so a press waits on nothing. The microphone's port (`port`)
    // stays attached; `talk` on/off is the button, and nothing is sent while
    // it is off. `close` lets go. To the page: {ready, warm} once the doorbell
    // listens, {talker} when someone else takes or leaves the door, {busy}
    // when this one's words were refused for theirs, {error, code} (and
    // {closed}) when the session is gone.
    var TALK_WORKER = [
      "var ws = null, key = 0, hid = 0, talking = false, port = null;",
      "function close() {",
      "  var w = ws; ws = null; talking = false;",
      "  if (w) {",
      "    try { if (w.readyState === 1 && hid) w.send(JSON.stringify({ id: 3, type: 'unsubscribe_events', subscription: 2 })); } catch (x) { /* closing */ }",
      "    try { w.close(); } catch (x) { /* closed */ }",
      "  }",
      "  hid = 0;",
      "}",
      "function open(d) {",
      "  close();",
      "  var k = key = d.key, w = ws = new WebSocket(d.url);",
      "  w.onmessage = function (e) {",
      "    if (ws !== w) return;",
      "    var m = JSON.parse(e.data);",
      "    if (m.type === 'auth_required') w.send(JSON.stringify({ type: 'auth', access_token: d.token }));",
      "    else if (m.type === 'auth_ok') w.send(JSON.stringify({ id: 2, type: 'hk_frontend/talk/live', entity_id: d.entity_id, rate: d.rate }));",
      "    else if (m.type === 'auth_invalid') { postMessage({ id: k, error: 'not signed in' }); close(); }",
      "    else if (m.type === 'result' && m.id === 2 && !m.success) {",
      "      postMessage({ id: k, error: (m.error && m.error.message) || 'refused', code: (m.error && m.error.code) || '' });",
      "      close();",
      "    } else if (m.type === 'event' && m.id === 2) {",
      "      var ev = m.event || {};",
      "      if (ev.handler_id) { hid = ev.handler_id; postMessage({ id: k, ready: true, warm: ev.warm === true }); }",
      "      else if ('talker' in ev) postMessage({ id: k, talker: ev.talker || null });",
      "      else if (ev.busy) postMessage({ id: k, busy: ev.busy });",
      "      else if (ev.error) postMessage({ id: k, error: ev.error });",
      "    }",
      "  };",
      "  w.onclose = function () {",
      "    if (ws !== w) return;",
      "    ws = null; hid = 0; talking = false;",
      "    postMessage({ id: k, error: 'socket closed', closed: true });",
      "  };",
      "}",
      "onmessage = function (e) {",
      "  var d = e.data;",
      "  if (d.cmd === 'open') open(d);",
      "  else if (d.cmd === 'port') {",
      "    if (port) { try { port.close(); } catch (x) { /* closed */ } }",
      "    port = d.port;",
      "    port.onmessage = function (m) {",
      "      if (!talking || !hid || !ws || ws.readyState !== 1) return;",
      "      var pcm = new Uint8Array(m.data), out = new Uint8Array(pcm.length + 1);",
      "      out[0] = hid; out.set(pcm, 1);",
      "      ws.send(out);",
      "    };",
      "  } else if (d.cmd === 'talk') talking = !!d.on && !!hid;",
      "  else if (d.cmd === 'close') close();",
      "};"
    ].join('\n');
    var TALK_MIN_MS = 600;       // shorter than this is a tap: "Hold to talk"
    var TALK_DUCK = 0.3;         // the door's sound while you talk: heard, lowered (echo cancellation does the rest)
    var WARM_RETRY_MS = [1000, 3000, 10000, 30000];
    var VOL_KEY = 'hk-tv-volume';
    var FULLY_MUSIC = 3;         // Android STREAM_MUSIC, for Fully's setAudioVolume
    var TALK_MAX_MS = 30000;
    var RETRY_MS = [2000, 5000, 10000, 20000];

    class HkDoorbellCard extends HkBase {
      // hk-popup opens a sheet holding this card at 1% until hkReady()
      // resolves: the live video has drawn its first frame (and one more), or
      // the stream failed. See hk-popup.js, PREPARED UNSEEN.
      static get hkPrepares() { return true; }

      hkReady() {
        var self = this;
        return new Promise(function (res) {
          if (self._readyDone) { res(); return; }
          var prev = self._readyWait;
          self._readyWait = function () { if (prev) prev(); res(); };
        });
      }

      _markReady() {
        this._readyDone = true;
        var w = this._readyWait;
        this._readyWait = null;
        if (w) w();
      }

      static get CSS() {
        return [
          // Never taller than a pop-up sheet may be (hk-popup caps it at the
          // screen height less 36px): in a short window the video crops a
          // little instead of pushing the buttons below the sheet's clip.
          // When the height cap bites, aspect-ratio narrows the box instead:
          // centred, and rounded like the sheet (the host inherits its radius).
          // The radius has to reach .db through the card's wrapper div too.
          // --hk-vh: the car's real window height in layout px, set only on a
          // zoomed car dashboard (tesla-viewport.js), where 100dvh is zoomed
          // too and would cap the video at ~2/3 of the screen. Unset -- every
          // other screen -- it falls back to the plain unit.
          ':host,:host>div{border-radius:inherit}',
          // --hk-db-max: a host that has more chrome than a pop-up (the camera
          // sheet's header) says how tall the picture may be.
          '.db{position:relative;overflow:hidden;background:#0b0d12;aspect-ratio:var(--db-ar,4/3);',
          '  max-height:var(--hk-db-max, calc(var(--hk-vh, 100dvh) - 36px));margin:0 auto;border-radius:inherit;',
          // NO MASK HERE. A -webkit-mask-image forces the video's corners round,
          // but on an Android tablet it makes the WHOLE sheet and its dim blink
          // out for a frame or three as the WebRTC tracks arrive -- 4 of 4 opens,
          // and 0 of 4 without it (adb screenrecord, frames measured). Rounded
          // overflow on the sheet plus the video's own border-radius keep the
          // corners round, checked on the same recordings with the video playing.
          '  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
          '.db>img,.db>video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;',
          '  display:block}',
          // The still stays under the video until the video is MOVING, so the
          // sheet never shows black while WebRTC connects.
          // NO FADE, and the still goes one frame AFTER the video shows. A video
          // that fades in over .25s from the moment it reports 'playing', while
          // the still under it vanishes at once, leaves a dark flash between the
          // two on a tablet (filmed at 60 fps). So the video appears on its first
          // PRESENTED frame (requestVideoFrameCallback) and the still is hidden on
          // the next, so there is always a picture.
          // 1%, not 0, before the first frame: an element at 0 is not drawn,
          // and the frame that first draws a live video blanks the sheet on
          // a tablet. At 1% that happens unseen (hk-popup: PREPARED UNSEEN).
          '.db>video{opacity:.01;border-radius:inherit}',
          '.db>video.on{opacity:1}',
          // THE STILL IS FOR TUNING ONLY. Once the video moves it goes: a
          // letterboxed TV frame (fill) does not cover the box, and the programme
          // art would show around -- and, in its bars, behind -- the picture. It
          // comes back only if the stream drops and reconnects.
          '.db.moving>img{visibility:hidden}',
          '.bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;',
          // flex-wrap: on a phone the slider + talk button outgrow the sheet,
          // so the talk button takes a second row rather than spilling out.
          '  justify-content:center;flex-wrap:wrap;gap:14px;padding:26px 20px 20px;',
          '  background:linear-gradient(to top,rgba(0,0,0,.5),rgba(0,0,0,0));',
          // The TV player fades these with its own controls (--hk-db-bar-*).
          '  opacity:var(--hk-db-bar-opacity,1);pointer-events:var(--hk-db-bar-events,auto);',
          '  transition:opacity .3s}',
          // VOLUME (the TV player and every camera pop-up): a slider in a plate
          // beside the speaker.
          '.vol{height:56px;padding:0 20px;border-radius:28px;display:flex;align-items:center;',
          '  background:rgba(28,28,30,.66);box-shadow:0 4px 14px rgba(0,0,0,.25)}',
          // (the input a finger's 28 tall, its track the 6 px line drawn in it)
          '.vol input{-webkit-appearance:none;appearance:none;width:180px;height:28px;background:none;',
          '  outline:none;margin:0;touch-action:none}',
          '.vol input::-webkit-slider-runnable-track{height:6px;border-radius:3px;',
          '  background:linear-gradient(to right,#fff var(--v,100%),rgba(255,255,255,.28) var(--v,100%))}',
          '.vol input::-moz-range-track{height:6px;border-radius:3px;',
          '  background:linear-gradient(to right,#fff var(--v,100%),rgba(255,255,255,.28) var(--v,100%))}',
          '.vol input::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:13px;margin-top:-10px;',
          '  background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.35)}',
          '.vol input::-moz-range-thumb{width:26px;height:26px;border:0;border-radius:13px;background:#fff}',
          // A PHONE (tested at 390 px): the live box is only ~206 px tall there,
          // and the bar -- speaker, slider and the talk button wrapped to a second
          // row -- would cover two thirds of it. A phone has volume buttons, so
          // the slider goes, and the bar tightens so the talk button stays on the
          // speaker's row.
          '@media (max-width:' + window.hkCards.BP.phone + 'px){.vol{display:none}.bar{gap:10px;padding:18px 12px 12px}',
          '  .talk{min-width:0;padding:0 18px 0 14px}}',
          // A still that failed (no artwork yet) must not leave a broken-image glyph.
          '.db>img.dead{visibility:hidden}',
          '.bar button{font:inherit;color:#fff;border:0;cursor:pointer;display:flex;',
          '  align-items:center;justify-content:center;gap:10px;height:56px;',
          '  -webkit-tap-highlight-color:transparent;background:rgba(28,28,30,.66);',
          '  box-shadow:0 4px 14px rgba(0,0,0,.25);--mdc-icon-size:26px}',
          '.snd{width:56px;border-radius:28px}',
          '.snd.off{color:rgba(255,255,255,.7)}',
          '.talk{padding:0 26px 0 20px;border-radius:28px;font-size:17px;font-weight:600;',
          '  min-width:200px;touch-action:none}',
          '.talk.rec{background:#ff3b30}',
          // Held, but the microphone is not open yet: nothing said now is kept.
          '.talk.wait{background:rgba(255,159,10,.85)}',
          '.talk.busy{color:rgba(255,255,255,.75)}',
          '.talk.off{opacity:.6}',
          '.talk .dot{display:none;width:10px;height:10px;border-radius:5px;background:#fff;',
          '  animation:hk-db-pulse 1s ease-in-out infinite}',
          '.talk.rec .dot{display:block}',
          '.talk.rec hk-icon{display:none}',
          '@keyframes hk-db-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
          '.msg{position:absolute;left:50%;top:18px;transform:translateX(-50%);padding:8px 14px;',
          '  border-radius:14px;background:rgba(28,28,30,.75);color:#fff;font-size:15px;',
          '  white-space:nowrap;opacity:0;transition:opacity .2s;pointer-events:none}',
          '.msg.on{opacity:1}',
          // `name`: which camera this is, for the camera pop-ups (the doorbell
          // sheet has none -- a ring already says which door).
          // 34px tall at top 16 / left 18: the same line, height and inset as
          // the sheet's X (--hk-popup-x-* in the camera pop-ups' vars).
          '.cap{position:absolute;left:18px;top:16px;height:34px;box-sizing:border-box;',
          '  padding:0 14px;display:flex;align-items:center;border-radius:17px;',
          '  background:rgba(28,28,30,.62);color:#fff;font-size:16px;font-weight:600;',
          '  line-height:1;pointer-events:none}',
          '.snd.none{display:none}',
          // FILL (the live TV player): the whole box, letterboxed not cropped --
          // a broadcast frame must not lose its edges -- and no rounding.
          '.db.fill{aspect-ratio:auto;width:100%;height:100%;max-height:none;border-radius:0;',
          '  background:#000}',
          '.db.fill>img,.db.fill>video{object-fit:contain;border-radius:0}',
          // TUNING: what the player says until the picture moves, and why not.
          '.tune{position:absolute;left:50%;top:50%;translate:-50% -50%;',
          '  padding:14px 22px;border-radius:18px;background:rgba(28,28,30,.72);color:#fff;',
          '  font-size:18px;font-weight:600;text-align:center;max-width:70%;line-height:1.35;',
          '  pointer-events:none;transition:opacity .25s}',
          '.tune.off{opacity:0}'
        ].join('');
      }

      _render() {
        var c = this._config, h = this.client;
        if (!c || !h) return;
        if (!this._built) this._build();
        var st = h.states[c.entity];
        var pic = st && st.attributes && !C.stale(st) && st.attributes.entity_picture;
        // A SIZE FOR THE POSTER TOO (2026-10-29): it was the camera's own
        // address, bare -- the full frame (a 4K still is ~1.8 MB) for a box of a
        // few hundred pixels. The address it was set from is kept, so a resize
        // or a pixel-ratio change never fetches it again.
        if (pic && !this._playing && this._posterPic !== pic) {
          this._posterPic = pic;
          this._poster.setAttribute('src', /^camera\./.test(c.entity) ? this._posterUrl(pic) : pic);
        }
        if (this.isConnected && !this._pc && !this._retryT && !this._rested) this._start();
      }

      // the poster's address with the box's size in device pixels (pixel ratio
      // capped at 2, at most 1920), else the strip's 480x270: the proxy needs
      // both sides or it ignores them (see _srcFor)
      _posterUrl(pic) {
        var r = this.getBoundingClientRect ? this.getBoundingClientRect() : null;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = r && r.width > 0 ? Math.min(1920, Math.round(r.width * dpr)) : 480;
        var h = r && r.height > 0 ? Math.min(1920, Math.round(r.height * dpr)) : 270;
        return pic + (pic.indexOf('?') < 0 ? '?' : '&') + 'width=' + w + '&height=' + h;
      }

      _build() {
        var c = this._config, self = this;
        this._stop();
        this._posterPic = null;
        this._built = true;
        this._root.innerHTML = '';
        var db = document.createElement('div');
        db.className = c.fill ? 'db fill' : 'db';
        this._root.style.height = c.fill ? '100%' : '';
        // aspect_ratio: auto -- the camera's own shape, read off its still and
        // then its video (a doorbell is 4:3, most cameras 16:9); 16:9 until then.
        var auto = String(c.aspect_ratio || '') === 'auto';
        var ar = String(auto ? '16x9' : (c.aspect_ratio || '4x3')).split(/[x:\/]/);
        if (ar.length === 2 && +ar[0] > 0 && +ar[1] > 0) {
          db.style.setProperty('--db-ar', +ar[0] + '/' + +ar[1]);
        }
        var shape = function (w, h) {
          if (auto && w > 0 && h > 0) db.style.setProperty('--db-ar', w + '/' + h);
        };
        var img = document.createElement('img');
        img.alt = '';
        // HIDDEN UNTIL IT HAS A PICTURE: Safari draws a light-gray outline around
        // an <img> with no picture yet, and this one fills the box -- a Live TV
        // channel has no still, so a thin white frame ran round the player's
        // edges until the video moved (filmed, 2026-10-21).
        img.className = 'dead';
        img.addEventListener('error', function () { img.classList.add('dead'); });
        img.addEventListener('load', function () { img.classList.remove('dead'); shape(img.naturalWidth, img.naturalHeight); });
        var v = document.createElement('video');
        v.addEventListener('loadedmetadata', function () { shape(v.videoWidth, v.videoHeight); });
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        var bar = document.createElement('div');
        bar.className = 'bar';
        var msg = document.createElement('div');
        msg.className = 'msg';
        db.append(img, v, bar, msg);
        this._tune = null;
        clearTimeout(this._tuneT);
        if (c.tuning) {
          var tune = document.createElement('div');
          tune.className = 'tune';
          tune.textContent = 'Tuning ' + c.tuning + '\u2026';
          db.append(tune);
          this._tune = tune;
          // A tuner the HDHomeRun cannot give us (all in use -- a media server,
          // another room) never produces a frame; say so instead of spinning forever.
          this._tuneT = setTimeout(function () {
            if (!self._playing && self._tune) {
              self._tune.textContent = 'Could not tune ' + c.tuning +
                '. Every tuner may be in use \u2014 try again in a minute.';
            }
          }, 25000);
        }
        if (c.name) {
          var cap = document.createElement('div');
          cap.className = 'cap';
          cap.textContent = c.name;
          db.append(cap);
        }
        this._root.append(db);
        this._poster = img; this._video = v; this._msg = msg;
        this._sndBtn = null; this._talkBtn = null;
        this._wantSound = c.sound !== false;
        this._blocked = false;
        v.addEventListener('playing', function () {
          self._playing = true;
          var frame = function (fn) {
            if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(fn);
            else requestAnimationFrame(function () { requestAnimationFrame(fn); });
          };
          frame(function () {
            if (!self._playing) return;            // torn down meanwhile
            v.classList.add('on');
            frame(function () {
              if (self._playing) db.classList.add('moving');
              self._markReady();
            });
          });
          if (self._tune) self._tune.classList.add('off');
          self._applySound(false);
          // A camera with no microphone answers video only: no speaker button
          // for a sound that does not exist.
          var src = v.srcObject;
          if (self._sndBtn && src && src.getAudioTracks) {
            self._sndBtn.classList.toggle('none', src.getAudioTracks().length === 0);
          }
        });
        if (c.sound !== false) {
          var snd = document.createElement('button');
          snd.className = 'snd';
          snd.setAttribute('aria-label', 'Sound');
          snd.innerHTML = '<hk-icon></hk-icon>';
          snd.addEventListener('click', function (e) {
            e.stopPropagation();
            // A tap is a user gesture: the browser allows sound from here.
            self._wantSound = self._blocked ? true : !self._wantSound;
            self._blocked = false;
            self._applySound(true);
          });
          bar.append(snd);
          this._sndBtn = snd;
          if (c.volume) {
            // WHICH TABLET: the one this page is on -- the slider is part of it.
            // In Fully Kiosk (JavaScript interface on) it sets the TABLET'S media
            // volume, exactly as its volume buttons do; the <video> stays at
            // full. Anywhere else it sets the video's own volume, remembered
            // per screen.
            var fk = window.fully && typeof window.fully.setAudioVolume === 'function' ? window.fully : null;
            var level = 1;
            if (fk && typeof fk.getAudioVolume === 'function') {
              try { level = Number(fk.getAudioVolume(FULLY_MUSIC)) / 100; } catch (e) { level = 1; }
            } else {
              try { level = parseFloat(localStorage.getItem(VOL_KEY)); } catch (e) { /* none */ }
            }
            if (!(level >= 0 && level <= 1)) level = 1;
            v.volume = fk ? 1 : level;
            var vol = document.createElement('div');
            vol.className = 'vol';
            var r = document.createElement('input');
            r.type = 'range'; r.min = '0'; r.max = '100'; r.step = '1';
            r.value = String(Math.round(level * 100));
            r.setAttribute('aria-label', 'Volume');
            var paint = function () { r.style.setProperty('--v', r.value + '%'); };
            paint();
            r.addEventListener('input', function (e) {
              e.stopPropagation();
              var x = Number(r.value) / 100;
              paint();
              if (fk) {
                try { fk.setAudioVolume(Math.round(x * 100), FULLY_MUSIC); } catch (err) { v.volume = x; }
              } else {
                v.volume = x;
                try { localStorage.setItem(VOL_KEY, String(x)); } catch (err) { /* private mode */ }
              }
              // Dragging the slider up is asking for sound: unmute (a gesture).
              if (x > 0 && !self._audible()) { self._wantSound = true; self._blocked = false; self._applySound(true); }
              if (x === 0 && self._audible()) { self._wantSound = false; self._applySound(true); }
            });
            ['pointerdown', 'click'].forEach(function (ev) {
              r.addEventListener(ev, function (e) { e.stopPropagation(); });
            });
            vol.append(r);
            bar.append(vol);
          }
        }
        // NEEDS HTTPS (2026-11-02): a browser gives the microphone only to a secure page. The button used to
        // vanish on plain http with nothing to say why; it is drawn off now, and a tap says where to look.
        this._talkHttps = !window.isSecureContext;
        if (c.speaker && (this._talkHttps || (navigator.mediaDevices &&
            navigator.mediaDevices.getUserMedia && window.MediaRecorder))) {
          var t = document.createElement('button');
          t.className = 'talk';
          t.innerHTML = '<hk-icon icon="mdi:microphone"></hk-icon><span class="dot"></span><span class="lbl"></span>';
          t.addEventListener('pointerdown', function (e) {
            e.preventDefault(); e.stopPropagation();
            try { t.setPointerCapture(e.pointerId); } catch (x) { /* old engine */ }
            self._talkStart();
          });
          t.addEventListener('pointerup', function (e) { e.stopPropagation(); self._talkEnd(false); });
          t.addEventListener('pointercancel', function (e) { e.stopPropagation(); self._talkEnd(true); });
          t.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          t.addEventListener('click', function (e) { e.stopPropagation(); });
          bar.append(t);
          this._talkBtn = t;
          this._talkUi('idle');
        }
        if (!bar.children.length) bar.style.display = 'none';
        this._paintSound();
      }

      // ------------------------------------------------------------ sound
      _audible() { return this._wantSound && !this._blocked; }       // talking ducks the door, it no longer mutes it (_duck)

      _applySound(fromTap) {
        var v = this._video, self = this;
        if (!v) return;
        if (!this._audible()) { v.muted = true; this._paintSound(); return; }
        if (!v.muted) { this._paintSound(); return; }
        v.muted = false;
        var p = v.play();
        var refused = function () {
          if (fromTap) return;
          self._blocked = true;
          v.muted = true;
          v.play().catch(function () { /* muted autoplay is always allowed */ });
          self._paintSound();
        };
        if (p && p.catch) p.catch(refused);
        // Some engines do not reject: they PAUSE the video they were told to
        // unmute. Look once it has had a moment.
        setTimeout(function () { if (v.isConnected && v.paused && !v.muted) refused(); }, 300);
        this._paintSound();
      }

      _paintSound() {
        var b = this._sndBtn;
        if (!b) return;
        var on = this._audible();
        b.classList.toggle('off', !on);
        var i = b.querySelector('hk-icon');
        if (i) i.setAttribute('icon', on ? 'mdi:volume-high' : 'mdi:volume-off');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }

      // ------------------------------------------------------------ webrtc
      _start() {
        this._talkWarm();                          // the doorbell's talk session, while the video comes up
        // SIGNALING THROUGH THE CLIENT: the client config and our candidates are reads
        // (client.callWS: in HA the frontend's callWS, the same frame on the same socket), the
        // offer a read-only subscription on the client's port (on its allowlist). Viewing a
        // camera changes nothing in the house.
        var cl = this.client, c = this._config, self = this, port = cl && cl.subscriptions;
        if (!port || !cl.callWS || !c || !c.entity || !window.RTCPeerConnection) { this._markReady(); return; }
        var gen = this._gen = (this._gen || 0) + 1;
        this._readyDone = false;
        var entity = c.entity;
        var alive = function () { return self._gen === gen && self.isConnected; };
        this._pc = 'pending';
        cl.callWS({ type: 'camera/webrtc/get_client_config', entity_id: entity })
          .catch(function () { return {}; })
          .then(function (cfg) {
            if (!alive()) return;
            var pc = self._pc = new RTCPeerConnection((cfg && cfg.configuration) || {});
            pc.addTransceiver('audio', { direction: 'recvonly' });
            pc.addTransceiver('video', { direction: 'recvonly' });
            var stream = new MediaStream();
            pc.ontrack = function (e) {
              stream.addTrack(e.track);
              if (self._video && self._video.srcObject !== stream) self._video.srcObject = stream;
            };
            var session = null, pending = [];
            var send = function (cand) {
              cl.callWS({ type: 'camera/webrtc/candidate', entity_id: entity,
                session_id: session, candidate: cand }).catch(function () { /* late */ });
            };
            pc.onicecandidate = function (e) {
              if (!e.candidate) return;
              var cand = e.candidate.toJSON();
              if (session) send(cand); else pending.push(cand);
            };
            pc.onconnectionstatechange = function () {
              if (!alive()) return;
              var s = pc.connectionState;
              if (s === 'connected') self._tries = 0;
              if (s === 'failed' || s === 'closed') self._again();
            };
            return pc.createOffer().then(function (offer) {
              return pc.setLocalDescription(offer).then(function () { return offer; });
            }).then(function (offer) {
              if (!alive()) return;
              return port.subscribeMessage(function (m) {
                if (!alive()) return;
                if (m.type === 'session') {
                  session = m.session_id;
                  pending.splice(0).forEach(send);
                } else if (m.type === 'answer') {
                  pc.setRemoteDescription({ type: 'answer', sdp: m.answer })
                    .catch(function (e) { console.error('[hk-doorbell] answer', e); self._again(); });
                } else if (m.type === 'candidate') {
                  var ic = typeof m.candidate === 'string'
                    ? { candidate: m.candidate, sdpMLineIndex: 0 } : m.candidate;
                  pc.addIceCandidate(ic).catch(function () { /* one bad candidate */ });
                } else if (m.type === 'error') {
                  console.error('[hk-doorbell] camera refused WebRTC:', m.code, m.message);
                  self._again();
                }
              }, (function () {
                // WHICH STREAM (2026-11-02): a pop-up plays a camera's high-quality stream, where the host's own
                // cameras have more than one (client.cameraOffer; a host without it gets the offer as it is)
                var m = { type: 'camera/webrtc/offer', entity_id: entity, offer: offer.sdp };
                return cl && typeof cl.cameraOffer === 'function' ? cl.cameraOffer(m, c.quality || 'high') : m;
              })())
                .then(function (unsub) {
                  if (alive()) { self._unsub = unsub; return; }
                  var r = unsub();
                  if (r && r.catch) r.catch(function () { /* the session already ended */ });
                });
            });
          })
          .catch(function (e) {
            console.error('[hk-doorbell] could not start', e);
            if (alive()) self._again();
          });
      }

      _again() {
        var self = this;
        this._markReady();                         // a failed stream holds no sheet
        this._teardown();
        if (!this.isConnected || this._retryT) return;
        var n = this._tries = (this._tries || 0) + 1;
        this._retryT = setTimeout(function () {
          self._retryT = null;
          if (self.isConnected && !self._rested) self._start();
        }, RETRY_MS[Math.min(n - 1, RETRY_MS.length - 1)]);
      }

      _teardown() {
        this._gen = (this._gen || 0) + 1;
        // unsub() RETURNS A PROMISE: a try/catch never saw its refusal, which
        // surfaced as an uncaught "Subscription not found" when the server had
        // already ended the WebRTC session (or the socket had reconnected)
        if (this._unsub) {
          try { var r = this._unsub(); if (r && r.catch) r.catch(function () { /* already ended */ }); }
          catch (e) { /* socket gone */ }
        }
        this._unsub = null;
        var pc = this._pc;
        this._pc = null;
        if (pc && pc.close) { try { pc.close(); } catch (e) { /* closed */ } }
        if (this._video) { this._video.srcObject = null; this._video.classList.remove('on'); }
        var box = this._video && this._video.parentNode;
        if (box && box.classList) box.classList.remove('moving');
        this._playing = false;
      }

      _stop() {
        clearTimeout(this._retryT);
        this._retryT = null;
        this._tries = 0;
        this._talkAbort();
        this._teardown();
        this._markReady();
      }

      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        // RESTING (2026-10-21): behind the screensaver and the black, always --
        // the screensaver started by its switch while a sheet was open left its
        // stream decoding under the photos -- and, a camera's sheet (not Live
        // TV, often listened to from another window), while another window has
        // the focus as Cameras -> Pause When Not in Focus says
        var self = this, tv = !!(this._config && this._config.tuning);
        if (!this._restOff) this._restOff = restWatch(function () { self._rested = true; self._stop(); },
          function () { self._rested = false; if (self.isConnected && self._built && self.client && !self._pc) self._start(); }, !tv);
        this._rested = (!tv && CAM_FOCUS.away()) || !!(window.hkSaver && window.hkSaver.covered && window.hkSaver.covered());
        if (this._built && this.client && !this._pc && !this._rested) this._start();
      }

      disconnectedCallback() {
        if (super.disconnectedCallback) super.disconnectedCallback();
        // The sheet detaches its cards when it closes: no stream, no mic.
        this._stop();
        if (this._restOff) { this._restOff(); this._restOff = null; }
      }

      // ------------------------------------------------------------ talk
      // THE BUTTON SAYS WHERE THINGS STAND (2026-11-02): Connecting while the
      // microphone or the doorbell is not ready yet, Talking while your words
      // go live, who else is talking when someone is, Can't Reach the Doorbell
      // when the warm session could not open (a press still tries, with the clip
      // as the net), and Needs HTTPS on a page that may not have a microphone.
      _talkUi(mode) {
        var t = this._talkBtn;
        if (!t) return;
        if (mode === 'idle') {
          mode = this._talkHttps ? 'https' : this._talker ? 'other' : this._warmFail ? 'unreachable' : 'idle';
        }
        t.classList.toggle('rec', mode === 'rec' || mode === 'live');
        t.classList.toggle('wait', mode === 'wait');
        t.classList.toggle('busy', mode === 'busy' || mode === 'other' || mode === 'https' || mode === 'unreachable');
        t.classList.toggle('off', mode === 'https' || mode === 'other');
        t.setAttribute('aria-disabled', mode === 'https' || mode === 'other' ? 'true' : 'false');
        t.querySelector('.lbl').textContent =
          mode === 'live' ? 'Talking — release to stop' :
          mode === 'rec' ? 'Talk — release to send' : mode === 'wait' ? 'Connecting…' :
          mode === 'busy' ? 'Sending…' : mode === 'other' ? this._talker + ' is talking' :
          mode === 'https' ? 'Needs HTTPS' : mode === 'unreachable' ? 'Can’t reach the doorbell' : 'Hold to talk';
      }

      _flash(text) {
        var m = this._msg;
        if (!m) return;
        m.textContent = text;
        m.classList.add('on');
        clearTimeout(this._flashT);
        this._flashT = setTimeout(function () { m.classList.remove('on'); }, 1800);
      }

      // THE DOOR IS HEARD WHILE YOU TALK, LOWERED (decision 6, 2026-11-02): a
      // conversation, not a walkie-talkie. The microphone runs with the
      // browser's echo cancellation, which takes the tablet's own speaker out
      // of what it hears, and the door's sound drops to TALK_DUCK so the
      // canceller has little to do. (iPad Safari will not set a video's
      // volume: there the door stays as loud, and the canceller does it all.)
      _duck(on) {
        var v = this._video;
        if (!v) return;
        if (on && this._duckFrom == null) { this._duckFrom = v.volume; v.volume = Math.min(v.volume, TALK_DUCK); }
        else if (!on && this._duckFrom != null) { v.volume = this._duckFrom; this._duckFrom = null; }
      }

      // THE WARM SESSION (2026-11-02): the doorbell's talk session opens when
      // the sheet does, so a press waits on nothing -- not on the client's
      // socket, the auth, Protect handing out a session or the encoder -- and
      // the first word is not clipped. It stays open while the sheet shows
      // (talk_live.py's 120 s limit closes it, and it opens again), and it
      // goes when the sheet closes (_talkAbort). Nothing reaches the doorbell
      // until the button is held. The microphone itself still opens at the
      // first press (once per sheet): opening it earlier would put an Android
      // tablet's sound into call mode for the whole visit.
      _talkWarm() {
        var c = this._config, act = this.client && this.client.actions, self = this;
        if (!this._talkBtn || this._talkHttps || c.live === false || this._liveOff) return;
        if (this._warm || this._warmT || !this.isConnected) return;
        var ctx = this._audioCtx(), worker = ctx && act && act.liveSocket && this._talkWorker();
        if (!worker) { this._liveOff = true; return; }
        var w = this._warm = { key: (this._talkKey = (this._talkKey || 0) + 1), ready: false };
        Promise.resolve().then(function () { return act.liveSocket(c.speaker); }).then(function (live) {
          if (self._warm !== w) return;
          worker.postMessage({ cmd: 'open', key: w.key, url: live.url, token: live.token(),
                               entity_id: c.speaker, rate: ctx.sampleRate });
        }).catch(function (err) {
          if (self._warm !== w) return;
          // refused quietly (Mantel: no grant, commands off; or no live talk on this host): the clip is all there is
          self._warm = null;
          self._liveOff = true;
          console.warn('[hk-doorbell] live talk:', err && (err.message || err.code || err));
          self._talkUi('idle');
        });
      }

      _warmMsg(d) {
        var w = this._warm, s = this._talk;
        if (!w || w.key !== d.id) return;
        if (d.ready) {
          w.ready = true; w.warm = d.warm;
          this._warmFail = false; this._warmTries = 0;
          if (s && !s.ended && !s.liveFailed && s.talking) this._liveGo(s);
          else if (!s) this._talkUi('idle');
          return;
        }
        if ('talker' in d) {
          this._talker = d.talker;
          if (!s) this._talkUi('idle');
          return;
        }
        if (d.busy) {
          // pressed at the same moment as someone else, and they were first: their words go, not these (nor a clip)
          this._talker = d.busy;
          if (s && !s.ended) { s.cancel = true; s.busy = true; this._talkEnd(true); }
          this._flash(d.busy + ' is talking');
          return;
        }
        if (d.error) {
          this._warm = null;
          if (s && s.fail) s.fail(d.error);
          if (d.code === 'not_supported' || d.code === 'unknown_command') {
            this._liveOff = true;                  // not a UniFi Protect doorbell (or no live talk): the clip only
          } else {
            this._warmFail = !w.ready;             // never listened: say so; a session that ends is simply opened again
            this._rewarm(w.ready ? 0 : (this._warmTries = (this._warmTries || 0) + 1));
          }
          this._talker = null;
          if (!this._talk) this._talkUi('idle');
        }
      }

      _rewarm(tries) {
        var self = this;
        clearTimeout(this._warmT);
        this._warmT = setTimeout(function () {
          self._warmT = null;
          // while a press is on, the next session waits for its release (_talkSend)
          if (!self._talk) self._talkWarm();
        }, WARM_RETRY_MS[Math.min(Math.max(tries - 1, 0), WARM_RETRY_MS.length - 1)]);
      }

      _talkClose() {
        clearTimeout(this._warmT);
        this._warmT = null;
        this._warm = null;
        if (this._tw) this._tw.postMessage({ cmd: 'close' });
      }

      // THE MICROPHONE OPENS ONCE PER SHEET. Opening it takes a moment (half a
      // second or more on a tablet), so a button that says "Release to send"
      // at the press loses the first words: clips of 0.8-1.3 s reach the
      // doorbell. The button says "Connecting…" until the words will really be
      // heard, and the stream stays open until the sheet closes (disconnect ->
      // _stop -> _talkAbort), so every hold after the first starts at the
      // press.
      //
      // LIVE, WITH THE CLIP AS A NET. The words stream to the doorbell as they
      // are spoken (talk_live.py: raw PCM over the warm session, paced into
      // the doorbell's own talkback stream). A MediaRecorder clip of the same
      // words is kept all the while; if the live session cannot open, or
      // fails mid-sentence, release sends the clip through talk.py instead. A
      // speaker that is not a UniFi Protect doorbell only ever gets the clip.
      // HOLD ONLY (decision 6, 2026-11-02): no tap to latch.
      _talkStart() {
        if (this._talkHttps) {
          this._flash('Talking at the door needs HTTPS: open this page by its https:// address');
          return;
        }
        if (this._talker) { this._flash(this._talker + ' is talking'); return; }
        if (this._talk || this._sending) return;
        var self = this;
        var s = this._talk = { t0: performance.now(), chunks: [] };
        this._duck(true);
        var ctx = this._audioCtx();                // inside the press: allowed to run
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
        var mic = this._mic;
        if (mic && mic.active) { this._talkRecord(s, mic); return; }
        this._talkUi('wait');
        navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          .then(function (stream) {
            if (!self.isConnected) { self._stopTracks(stream); return; }
            self._stopTracks(self._mic);
            self._mic = stream;                     // kept for the next hold
            self._micNodes = null;
            if (s.ended || self._talk !== s) return;
            self._talkRecord(s, stream);
          })
          .catch(function (err) {
            if (self._talk === s) self._talk = null;
            self._duck(false);
            self._talkUi('idle');
            self._flash(err && err.name === 'NotAllowedError'
              ? 'The microphone is not allowed' : 'No microphone');
            console.error('[hk-doorbell] microphone', err);
          });
      }

      _talkRecord(s, stream) {
        var self = this;
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
          .filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0];
        var rec = s.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
        rec.ondataavailable = function (e) { if (e.data && e.data.size) s.chunks.push(e.data); };
        rec.onstop = function () { self._talkSend(s); };
        rec.start();
        s.recT0 = performance.now();
        s.maxT = setTimeout(function () { self._talkEnd(false); }, TALK_MAX_MS);
        // GIVING UP ON LIVE STOPS IT. Flipping the flags and the label alone is
        // not enough: the session given up on may still be opening, and when it
        // answers the words would stream while the button says "release to
        // send"; on release the clip would go too, and the door would hear the
        // message twice. So the live half stops sending here, and a press is
        // live OR a clip, never both. What already played before a
        // MID-SENTENCE failure is the one overlap left, by design: the clip is
        // the whole message.
        s.fail = function (why) {
          if (s.liveFailed) return;
          s.liveFailed = true;
          if (why) console.warn('[hk-doorbell] live talk:', why);
          self._liveStop(s);
          if (self._talk === s && !s.ended) self._talkUi('rec');
        };
        if (this._config.live === false || this._liveOff) { s.fail(); return; }
        if (!this._warm) {                         // (re)opening: the press waits for it, as long as the host says
          clearTimeout(this._warmT);
          this._warmT = null;
          this._talkWarm();
        }
        var w = this._warm;
        if (!w || !this._micTap(stream)) { s.fail('not available here'); return; }
        s.talking = true;
        if (w.ready) { this._liveGo(s); return; }
        this._talkUi('wait');
        // A HOST WITH MORE STEPS TO THE DOORBELL says how long to wait (actions.liveWaitMs): through Mantel a
        // press also passes its gateway and a socket of its own, and 1.5 s gave up on live there (2026-10-22)
        var act0 = this.client && this.client.actions;
        var wait = act0 && typeof act0.liveWaitMs === 'number' && act0.liveWaitMs > 0 ? Math.min(act0.liveWaitMs, 8000) : LIVE_WAIT_MS;
        s.liveT = setTimeout(function () {
          if (!s.live && !s.ended) s.fail('not listening after ' + wait + ' ms');
        }, wait);
      }

      // the microphone into the worker, once per microphone: the worklet posts 40 ms of PCM to the worker
      // directly (the page is not in the path), and the worker passes it on only while the button is held
      _micTap(stream) {
        if (this._micNodes) return true;
        var ctx = this._audioCtx(), worker = this._tw, self = this;
        if (!ctx || !worker || !this._actxMod) return false;
        this._actxMod.then(function () {
          if (self._mic !== stream || self._micNodes) return;
          var src = ctx.createMediaStreamSource(stream);
          var node = new AudioWorkletNode(ctx, 'hk-pcm-tap',
            { processorOptions: { chunk: Math.round(ctx.sampleRate / 25) } });   // 40 ms
          var mute = ctx.createGain();
          mute.gain.value = 0;                      // pulled by the graph, never heard
          src.connect(node); node.connect(mute); mute.connect(ctx.destination);
          var ch = new MessageChannel();
          node.port.postMessage({ port: ch.port1 }, [ch.port1]);
          worker.postMessage({ cmd: 'port', port: ch.port2 }, [ch.port2]);
          self._micNodes = [src, node, mute];
        }).catch(function (err) { var s = self._talk; if (s && s.fail) s.fail(err && err.message); });
        return true;
      }

      _liveGo(s) {
        if (!this._tw || s.ended || s.liveFailed) return;
        s.live = true;
        clearTimeout(s.liveT);
        this._tw.postMessage({ cmd: 'talk', on: true });
        this._talkUi('live');
      }

      _audioCtx() {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !window.AudioWorkletNode || this._config.live === false) return null;
        if (!this._actx || this._actx.state === 'closed') {
          try { this._actx = new AC(); } catch (e) { return null; }
          this._actxMod = null;
          this._micNodes = null;
        }
        if (!this._actxMod) {
          var ac = this._actx, url = URL.createObjectURL(new Blob([PCM_TAP], { type: 'application/javascript' })), f = '/hk/modules/hk-pcm-tap.js';
          // a blob: worklet refused (a page policy): the file
          this._actxMod = ac.audioWorklet.addModule(url).catch(function () { return ac.audioWorklet.addModule(window.hkV ? window.hkV(f) : f); });
          this._actxMod.catch(function () { /* the press says so */ });
        }
        return this._actx;
      }

      _talkWorker() {
        if (this._tw) return this._tw;
        if (!window.Worker || !window.MessageChannel) return null;
        var self = this, w;
        try {
          w = new Worker(URL.createObjectURL(new Blob([TALK_WORKER], { type: 'application/javascript' })));
        } catch (e) { return null; }
        w.onmessage = function (e) { self._warmMsg(e.data || {}); };
        w.onerror = function () {
          var s = self._talk;
          if (s && s.fail) s.fail('worker');
          self._warm = null; self._liveOff = true;
        };
        this._tw = w;
        return w;
      }

      _liveStop(s) {
        clearTimeout(s.liveT);
        if (s.talking && this._tw) this._tw.postMessage({ cmd: 'talk', on: false });
        s.talking = false;
      }

      _talkEnd(cancel) {
        var s = this._talk;
        if (!s || s.ended) return;
        s.ended = true;
        clearTimeout(s.maxT);
        if (!s.rec) {                              // released before the mic opened
          this._talk = null;
          this._duck(false);
          this._talkUi('idle');
          if (!cancel) this._flash('Wait for the red button, then talk');
          return;
        }
        s.secs = (performance.now() - s.recT0) / 1000;
        s.cancel = s.cancel || cancel || s.secs * 1000 < TALK_MIN_MS;
        this._liveStop(s);
        try { s.rec.stop(); } catch (e) { this._talkSend(s); }
      }

      _stopTracks(stream) {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      }

      _talkAbort() {
        var s = this._talk;
        this._talk = null;
        if (s) {
          s.cancel = true; s.ended = true;
          clearTimeout(s.maxT);
          this._liveStop(s);
          if (s.rec && s.rec.state !== 'inactive') { try { s.rec.stop(); } catch (e) { /* stopped */ } }
        }
        this._talkClose();
        this._duck(false);
        this._stopTracks(this._mic);               // the sheet closed: mic off
        this._mic = null;
        this._micNodes = null;
        if (this._actx) { try { this._actx.close(); } catch (e) { /* closed */ } }
        this._actx = null; this._actxMod = null;
        // Its socket closing ends any session on the server too.
        if (this._tw) { this._tw.terminate(); this._tw = null; }
        this._talker = null; this._warmFail = false; this._warmTries = 0;
      }

      _talkSend(s) {
        var self = this, c = this._config, act = this.client && this.client.actions;
        if (this._talk === s) this._talk = null;
        this._duck(false);
        // A SESSION FROM AN OLDER SERVER (no `warm`) ends at each release, as it always did: open the next now
        var w = this._warm;
        if (w && w.ready && !w.warm && s.live) { this._talkClose(); this._talkWarm(); }
        else if (!w && !this._warmT && !this._liveOff) this._talkWarm();
        if (s.cancel) {
          this._talkUi('idle');
          if (this.isConnected && !s.busy) this._flash('Hold to talk');
          return;
        }
        if (s.live && !s.liveFailed) {             // already heard at the door
          this._talkUi('idle');
          return;
        }
        var blob = new Blob(s.chunks, { type: (s.rec && s.rec.mimeType) || 'audio/webm' });
        this._sending = true;
        this._talkUi('busy');
        var url = '/api/hk_frontend/talk?entity_id=' + encodeURIComponent(c.speaker);
        var init = { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } };
        // a write: the client's action port (HA: the frontend's own authenticated fetch, same path
        // and init; Mantel: refused, nothing sent)
        var req = act ? act.request(url, init) : Promise.reject(new Error('not connected'));
        req.then(function (r) {
          if (!r.ok) {
            return r.json().catch(function () { return {}; }).then(function (b) {
              throw new Error(b.message || ('HTTP ' + r.status));
            });
          }
          self._flash('Sent \u00b7 ' + s.secs.toFixed(1) + ' s');
        }).catch(function (e) {
          console.error('[hk-doorbell] talk', e);
          self._flash('Could not send');
        }).then(function () {
          self._sending = false;
          self._talkUi('idle');
        });
      }

      getCardSize() { return 6; }
    }

    // what the shell and the later parts use of this one
    K.HkDoorbellCard = HkDoorbellCard;
  };
})();
