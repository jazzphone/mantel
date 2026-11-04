// The Intercom's surroundings, made up, for the browser checks (intercom_check.py / .cjs, and the gallery's intercom shots):
// a feed of fictional rooms, and a microphone session that records nothing and plays nothing -- it counts forty milliseconds
// of silence at a time and says what the server would. Nothing here touches a microphone, a speaker or a network.
//
//   __intercomFake.install({ live, canOverride, secure, firstUse, mem, listener, play })   the fakes in, the sheet's memory set
//   __intercomFake.mic()                                           the session the sheet is using (or null)
//   __intercomFake.press(element, ms)                              a finger's pointerdown and pointerup on it
(function () {
  'use strict';
  var R = function (id, name, floor, o) { return Object.assign({ room: 'media_player.' + id, name: name, floor: floor, state: 'ok', live: true, why: null, reason: '' }, o || {}); };
  function feed(o) {
    o = o || {};
    return {
      enabled: o.enabled !== false, live_allowed: !!o.live, default_mode: 'message', max_live_s: 60, max_message_s: 30, lag_ms: 4000,
      can_override: !!o.canOverride, away: false, here: ['media_player.kitchen'],
      rooms: [R('living_room', 'Living Room', 'Main Floor'), R('kitchen', 'Kitchen', 'Main Floor'), R('dining_room', 'Dining Room', 'Main Floor', { why: 'leads', reason: 'Dining Room plays only together with Office' }),   // a group leader: slash, but pickable
              R('office', 'Office', 'Main Floor', { state: 'skipped', why: 'leads', reason: 'Dining Room leads Office; skipped' }),
              R('bedroom', 'Bedroom', 'Upstairs', { state: 'skipped', why: 'quiet', reason: 'Quiet hours' }),
              R('guest_room', 'Guest Room', 'Upstairs', { state: 'after', live: false })],
      floors: [{ id: 'main', name: 'Main Floor', rooms: ['media_player.living_room', 'media_player.kitchen', 'media_player.dining_room', 'media_player.office'] },
               { id: 'upstairs', name: 'Upstairs', rooms: ['media_player.bedroom', 'media_player.guest_room'] }],
      presets: [{ id: 'dinner', name: 'Dinner', rooms: ['media_player.kitchen', 'media_player.dining_room'] },
                { id: 'bedtime', name: 'Bedtime', rooms: ['media_player.bedroom', 'media_player.guest_room'] }],
      listener: !!o.listener, play: o.play || null
    };
  }

  class FakeMic {
    constructor() { this.on = {}; this.bytes = 0; this.level = 0; this.rate = 24000; this.recording = false; this.calls = []; this.isOpen = false; this.timer = null; this.key = 0; this.closed = false; }
    unlock() { return this.rate; }
    begin() { this.calls.push('begin'); return ++this.key; }
    start() { this.calls.push('start'); return new Promise((r) => setTimeout(() => r(this.rate), 200)); }
    open(url, token, upload) {
      this.calls.push('open');
      setTimeout(() => { this.isOpen = true; if (this.on.ready) this.on.ready({ mode: 'message', rate: this.rate, max_s: 30 }); if (upload && this.on.uploaded) setTimeout(() => this.on.uploaded(), 100); }, 120);
    }
    rec(on) {
      this.recording = !!on;
      clearInterval(this.timer);
      if (on) this.timer = setInterval(() => { this.bytes += 1920; this.level = 0.3 + 0.45 * Math.abs(Math.sin(Date.now() / 170)); }, 40);
      else this.level = 0;
    }
    text(o) {
      this.calls.push(o.type);
      if (o.type === 'cancel') this.bytes = 0;
      if (o.type === 'send') {
        var ev = (e, ms) => setTimeout(() => { if (this.on.event) this.on.event(e); }, ms);
        var rooms = o.rooms || [];
        ev({ type: 'rooms', rooms: rooms.map((r) => ({ room: r, name: r, state: 'ok' })) }, 80);
        ev({ type: 'sending', rooms: rooms.length }, 160);
        ev({ type: 'sent', rooms: rooms.length, failed: [] }, 600);
      }
    }
    sync() { return Promise.resolve({ open: this.isOpen, bytes: this.bytes, dropped: false }); }
    closeSocket() { this.isOpen = false; }
    noSocket() {}
    uploadable() { return { pcm: new ArrayBuffer(this.bytes), rate: this.rate }; }
    pcm() { return new Int16Array(this.bytes / 2); }
    seconds() { return this.bytes / 2 / this.rate; }
    clear() { this.bytes = 0; this.level = 0; }
    play(done) { var t = setTimeout(done, 2500); return { stop: () => clearTimeout(t) }; }
    stopPlay() {}
    close() { this.closed = true; clearInterval(this.timer); }
    // for a still picture: a recording of this length, as if spoken
    speak(secs) { this.bytes = Math.round(secs * this.rate) * 2; }
  }

  var current = null;
  window.__intercomFake = {
    feed: feed,
    install: function (o) {
      o = o || {};
      var H = window.hkIntercom;
      // the fake feed as an override: the page's own subscription (the test server's Intercom is off) may answer after
      // this, now that the card file loads lazily, and must not replace it
      H._.feedIs(feed(o));
      var fake = H._.shared.feed;
      H.use({
        feed: () => fake,
        actions: () => ({
          intercom: () => Promise.resolve({ url: 'wss://mantel.example/ws/intercom', token: 'fictional' }),
          callWS: () => Promise.resolve(null)
        }),
        mic: () => (current = new FakeMic()),
        secure: () => o.secure !== false,
        supported: () => true,
        oneWaySeen: !o.firstUse
      });
      H._.shared.mem = o.mem || { mode: 'message', rooms: ['media_player.living_room', 'media_player.kitchen'] };
      H._.feedIs(feed(o));
    },
    mic: function () { return current; },
    press: function (el, ms) {
      var ev = (type) => new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: 1, clientY: 1 });
      el.dispatchEvent(ev('pointerdown'));
      return new Promise((r) => setTimeout(() => { el.dispatchEvent(ev('pointerup')); r(); }, ms || 60));
    }
  };
})();
