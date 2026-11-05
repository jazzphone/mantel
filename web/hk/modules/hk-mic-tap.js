// @ts-check
// hk-mic-tap.js -- the Intercom's microphone tap: an AudioWorklet that turns the microphone into 16-bit PCM chunks and
// posts each one to the port hk-mic.js hands it (docs/phase17/INTERCOM.md, "The microphone code"). A file of its own,
// not a blob: Mantel's page policy is `script-src 'self'`, and a worklet module is a script (a blob: one was refused,
// which Safari reports as NotAllowedError: "Microphone blocked" with the microphone in fact allowed).
/* global AudioWorkletProcessor, registerProcessor */
class MicTap extends AudioWorkletProcessor {
  constructor(o) { super(); this.c = (o.processorOptions || {}).chunk || 960;
    this.b = new Int16Array(this.c); this.n = 0; this.out = null; var me = this;
    this.port.onmessage = function (e) { if (e.data && e.data.port) me.out = e.data.port; }; }
  process(inputs) {
    var ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (var i = 0; i < ch.length; i++) {
      var v = ch[i] < -1 ? -1 : ch[i] > 1 ? 1 : ch[i];
      this.b[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.c) {
        if (this.out) this.out.postMessage(this.b.buffer, [this.b.buffer]);
        this.b = new Int16Array(this.c); this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('hk-mic-tap', MicTap);
