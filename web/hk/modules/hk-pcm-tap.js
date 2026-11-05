// @ts-check
// hk-pcm-tap.js -- the doorbell's live talk as a worklet file (cards/hk-cameras.js PCM_TAP, the same source): a page whose
// policy refuses blob: worklets (Mantel's, script-src 'self') loads this from its own address instead.
class PcmTap extends AudioWorkletProcessor {
  constructor(o) { super(); this.c = (o.processorOptions || {}).chunk || 1920;
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
registerProcessor('hk-pcm-tap', PcmTap);
