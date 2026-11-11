// hk-sheet-lock.js - The lock sheet and its hold ring, the garage and gate sheet, and the button sheet.
//
// PART OF THE DETAIL SHEETS (hk-detail.js). Not a card and not run on its own: it registers one
// function, which hk-detail.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSheets = window.hkSheets || {})['hk-sheet-lock'] = function (K) {
    var at = K.at, C = K.C, domainOf = K.domainOf, glyph = K.glyph, gone = K.gone, num = K.num, Panel = K.Panel,
        PANEL_CSS = K.PANEL_CSS;

    // ------------------------------------------------------------ lock + garage
    // THE HOLD RING. A door that lets someone in is opened by a hold: the ring
    // fills over a second, let go early and nothing happens, so a mis-tap on a
    // wall tablet never opens a door. Securing it again is a tap. The lock and
    // the garage are two specs on one panel so they look and behave the same.
    var HOLD_MS = 1000;

    class RingPanel extends Panel {
      static get CSS() {
        return PANEL_CSS + [
          // 264: a little over 236 (360 is far too big)
          '.lk{position:relative;width:264px;height:264px;border-radius:132px;border:0;padding:0;',
          '  cursor:pointer;background:rgba(48,209,88,0.16);display:flex;align-items:center;',
          '  justify-content:center;-webkit-tap-highlight-color:transparent;touch-action:none;',
          '  -webkit-user-select:none;user-select:none}',
          '.lk svg.ring{position:absolute;inset:0;pointer-events:none}',
          '.lk .trk{fill:none;stroke:rgba(255,255,255,0.12);stroke-width:8}',
          '.lk .prg{fill:none;stroke:#30d158;stroke-width:8;stroke-linecap:round;',
          '  stroke-dasharray:703.7;stroke-dashoffset:703.7;transition:stroke-dashoffset .25s ease}',
          '.lk.holding .prg{stroke-dashoffset:0;transition:stroke-dashoffset ' + HOLD_MS + 'ms linear}',
          '.lk .core{width:192px;height:192px;border-radius:96px;background:#30d158;display:flex;',
          '  align-items:center;justify-content:center;color:#fff;transition:background .25s,transform .15s}',
          '.lk:active .core{transform:scale(.97)}',
          '.lk.open{background:rgba(255,159,10,0.16)}',
          '.lk.open .core{background:#ff9f0a}',
          '.lk.open .prg{stroke:#ff9f0a}',
          '.lk.busy .core{animation:hkd-pulse 1.1s ease-in-out infinite}',
          '.lk.bad{background:rgba(255,69,58,0.16)}.lk.bad .core{background:#ff453a}',
          // tone "water": blue when it runs, grey when it is shut (the Home app's valve)
          // the palette's blue (the header well's), not iOS system blue
          '.lk.water{background:rgba(86,189,228,0.16)}.lk.water .core{background:#56bde4}.lk.water .prg{stroke:#56bde4}',
          '.lk.water.shut{background:rgba(255,255,255,0.08)}.lk.water.shut .core{background:rgba(255,255,255,0.22)}',
          '@keyframes hkd-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
          '.big.lkt{font-size:38px}',
          '.hint{font-size:16px}',
          '@media (max-width:' + C.BP.phone + 'px){.lk{width:228px;height:228px;border-radius:114px}',
          '  .lk .core{width:166px;height:166px;border-radius:83px}.big.lkt{font-size:32px}}',
          // THE ART (2026-11-05; EASE's curves: exit, spring, build -- a door's run is linear, as a door moves):
          // the lock's shackle and the garage's door
          // drawn in parts, so they move as the device does -- the shackle
          // lifts as the hold fills and springs up when it fires, drops with
          // a clunk on a lock; the door rises over a door's run and settles
          '.core svg.art{width:100px;height:100px;display:block;overflow:visible}',
          '.art .shk{transform:translateY(0);transition:transform .38s cubic-bezier(.4,0,.8,.4)}',
          '.core[data-pose=open] .art .shk{transform:translateY(-10px);transition:transform .5s cubic-bezier(.34,1.24,.42,1)}',
          '.lk.holding .core[data-pose=shut] .art .shk{transform:translateY(-4px);transition:transform ' + HOLD_MS + 'ms linear}',
          '.art .gd{transform:translateY(0);transition:transform .7s cubic-bezier(.22,.8,.25,1)}',
          '.core[data-pose=open] .art .gd{transform:translateY(-22.5px)}',
          '.core[data-pose=opening] .art .gd{transform:translateY(-22.5px);transition:transform 14s linear}',
          '.core[data-pose=closing] .art .gd{transform:translateY(0);transition:transform 14s linear}',
          '.lk.holding .core[data-pose=shut] .art .gd{transform:translateY(-4px);transition:transform ' + HOLD_MS + 'ms linear}',
          // FEEDBACK: a press that sends gives (.kick), a device that gets
          // there pops and the ring flashes round (.done), a call that did
          // not go shakes its head (.nope)
          '.lk .fl{fill:none;stroke:#fff;stroke-width:8;opacity:0}',
          '.lk.kick .core{animation:hkd-kick .38s ease-out}',
          '.lk.done .core{animation:hkd-pop .5s cubic-bezier(.34,1.24,.42,1)}',
          '.lk.done .fl{animation:hkd-flash .9s ease-out}',
          '.lk.nope .core{animation:hkd-nope .45s ease-in-out}',
          '@keyframes hkd-kick{0%{transform:scale(1)}35%{transform:scale(.93)}75%{transform:scale(1.03)}100%{transform:scale(1)}}',
          '@keyframes hkd-pop{0%{transform:scale(1)}40%{transform:scale(1.06)}100%{transform:scale(1)}}',
          '@keyframes hkd-flash{0%{opacity:.85;stroke-width:8}100%{opacity:0;stroke-width:16}}',
          '@keyframes hkd-nope{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(9px)}',
          '  60%{transform:translateX(-6px)}80%{transform:translateX(3px)}}',
          '@media (prefers-reduced-motion:reduce){.lk.busy .core{animation:none}',
          '  .art .shk,.art .gd,.core[data-pose] .art .shk,.core[data-pose] .art .gd{transition-duration:.2s!important}',
          '  .lk.kick .core,.lk.done .core,.lk.nope .core{animation:none}}'
        ].join('');
      }
      // spec(st) -> { word, glyph, hint, label, open, busy, bad,
      //               hold: [domain, service] | null, tap: [domain, service] | null, ask }
      _render() {
        var s = this._stateObj, self = this;
        if (!s) return;
        if (!this._built) {
          this._built = true;
          this._root.innerHTML = '<div class="pn"><button class="lk">' +
            '<svg class="ring" viewBox="0 0 236 236" aria-hidden="true"><circle class="trk" cx="118" cy="118" r="112"/>' +
            '<circle class="prg" cx="118" cy="118" r="112" transform="rotate(-90 118 118)"/>' +
            '<circle class="fl" cx="118" cy="118" r="112"/></svg>' +
            '<div class="core"></div></button><div class="big lkt"></div><div class="muted hint"></div></div>';
          var b = this._lk = this._root.querySelector('.lk');
          this._core = this._root.querySelector('.core');
          this._big = this._root.querySelector('.big');
          this._hint = this._root.querySelector('.hint');
          // ONE PRESS, ONE ACTION, DECIDED WHEN THE FINGER LANDS.
          // Reading the spec again on release means a hold that outlasts the
          // device's answer does the OPPOSITE on the way up: the lock reports
          // unlocked under the finger and letting go locks it again; the
          // garage reads open and letting go sends close_cover -- a relay
          // pulse, which stops a moving door. So a press keeps the spec it
          // landed on. A hold spec never taps: let go early and nothing
          // happens, and once the hold has fired the release does nothing.
          var press = null;
          // a sheet that wants to know what was sent (and whether it went: _call's true / false) has sent()
          var call = function (a) {
            if (!a) return;
            var p = self._svc(a[0], a[1]);
            if (typeof self.sent === 'function') self.sent(a, p);
          };
          // the device is still where the press found it (nobody else moved
          // it meanwhile): the same hold is still the one on offer
          var still = function (a) {
            var now = self._stateObj, sp = now && self.spec(now);
            return !!(sp && sp.hold && sp.hold[1] === a[1]);
          };
          var cancel = function () {
            if (press) clearTimeout(press.timer);
            press = null;
            b.classList.remove('holding');
          };
          b.addEventListener('pointerdown', function (e) {
            var st = self._stateObj, sp = st && self.spec(st);
            if (!sp || (!sp.hold && !sp.tap)) return;
            e.preventDefault();
            try { b.setPointerCapture(e.pointerId); } catch (x) { /* ok */ }
            cancel();
            var p = press = { sp: sp, timer: null, fired: false };
            if (!sp.hold) return;
            b.classList.add('holding');
            buzz('selection');
            p.timer = setTimeout(function () {
              p.timer = null;
              p.fired = true;
              b.classList.remove('holding');
              if (still(p.sp.hold)) call(p.sp.hold);
            }, HOLD_MS);
          });
          b.addEventListener('pointerup', function () {
            var p = press;
            cancel();
            if (!p || p.fired || p.sp.hold) return;
            call(p.sp.tap);
          });
          b.addEventListener('pointercancel', cancel);
          b.addEventListener('pointerleave', function () { if (press && press.timer) cancel(); });
          b.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            var st = self._stateObj, sp = st && self.spec(st);
            if (!sp) return;
            // the keyboard cannot hold, so it asks -- and sends only if the
            // device is still where the question found it
            if (sp.hold) C.confirmSheet(sp.ask, function () { if (still(sp.hold)) call(sp.hold); });
            else call(sp.tap);
          });
        }
        var sp = this.spec(s);
        this._arrived(s);
        if (this._failUntil && Date.now() < this._failUntil) sp = Object.assign({}, sp, { hint: 'Didn\u2019t go through. Try again.' });
        this._lk.classList.toggle('open', !!sp.open);
        this._lk.classList.toggle('busy', !!sp.busy);
        this._lk.classList.toggle('bad', !!sp.bad);
        this._lk.classList.toggle('water', sp.tone === 'water');
        this._lk.classList.toggle('shut', !!sp.shut);
        if (sp.art) {
          if (this._glyph !== 'art:' + sp.art) { this._glyph = 'art:' + sp.art; this._core.innerHTML = ART[sp.art]; }
          if (this._core.getAttribute('data-pose') !== sp.pose) this._core.setAttribute('data-pose', sp.pose || 'shut');
        } else {
          this._core.removeAttribute('data-pose');
          if (this._glyph !== sp.glyph) { this._glyph = sp.glyph; this._core.innerHTML = glyph(sp.glyph, 80); }
        }
        this._big.textContent = sp.word;
        this._hint.textContent = sp.hint || '';
        this._lk.setAttribute('aria-label', sp.label || sp.word);
      }
      _who(st, fallback) { return (this._src && this._src.name) || at(st, 'friendly_name') || fallback; }

      // SENT: the press gives at once (.kick); a call that did not go shakes
      // its head and says so under the ring for FAIL_MS; and the state it
      // asked for is watched for (_arrived), so the device getting there is
      // felt too. A sheet whose device moves slowly (_pendTo: the state a
      // service is going to) shows it moving at once:
      //
      // MOVING AS SOON AS IT IS SENT. Many openers never report opening or
      // closing: the state goes from closed straight to open once the door is
      // all the way up, 15 seconds later; a lock goes from locked straight to
      // unlocked. So a sent open or close shows "Opening…" / "Closing…" (the
      // ring pulsing) at once, as the garage header does, until Home
      // Assistant reports anything new, the call fails, or PEND_MS pass (then
      // the real state again).
      sent(a, p) {
        var self = this, now = this._stateObj && this._stateObj.state;
        var to = this._pendTo ? this._pendTo(a) : null;
        this._play('kick');
        this._failUntil = 0;
        this._unpend();
        this._want = to && now !== to ? { to: to, until: Date.now() + WANT_MS } : null;
        Promise.resolve(p).then(function (ok) {
          if (ok !== false) return;
          self._want = null;
          if (self._pend) self._unpend();
          self._failUntil = Date.now() + FAIL_MS;
          self._play('nope');
          buzz('warning');
          clearTimeout(self._failT);
          self._failT = setTimeout(function () { self._render(); }, FAIL_MS + 50);
          self._render();
        });
        if (!to || now === to) { this._render(); return; }          // a stop: the real state again
        var pend = this._pend = { to: to, from: now, timer: null };
        pend.timer = setTimeout(function () {
          if (self._pend !== pend) return;
          self._pend = null;
          self._render();
        }, PEND_MS);
        this._render();
      }
      _unpend() {
        if (this._pend) clearTimeout(this._pend.timer);
        this._pend = null;
      }
      // the wait, for spec(): anything new from Home Assistant ends it (it knows now)
      _pendNow(s) {
        if (this._pend && s.state !== this._pend.from) this._unpend();
        return this._pend;
      }
      // THE DEVICE GOT THERE: what was asked for is what Home Assistant says
      // now -- the ring flashes round and the phone gives a success tap. A
      // lock that jams instead shakes its head.
      _arrived(s) {
        var w = this._want, st = s.state;
        if (!w || st === this._lastSt) { this._lastSt = st; return; }
        this._lastSt = st;
        if (Date.now() > w.until) { this._want = null; return; }
        if (st === w.to) { this._want = null; this._play('done'); buzz('success'); }
        else if (st === 'jammed' || st === 'unavailable') { this._want = null; this._play('nope'); buzz('warning'); }
      }
      // one feedback animation at a time, restarted if it is already playing
      _play(cls) {
        var b = this._lk;
        if (!b) return;
        b.classList.remove('kick', 'done', 'nope');
        void b.offsetWidth;
        b.classList.add(cls);
      }
      disconnectedCallback() {
        this._unpend();
        clearTimeout(this._failT);
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
    }

    var PEND_MS = 60000, WANT_MS = 90000, FAIL_MS = 4000;

    // a moment the finger should feel (the iPhone app's haptics: shim/mantel-native.js; nothing else listens)
    function buzz(kind) {
      try { window.dispatchEvent(new CustomEvent('hk-haptic', { detail: { kind: kind } })); } catch (e) { /* no events */ }
    }

    // the art, white on the ring's core: the shackle (.shk) over the body,
    // its right leg long enough to stay in the body when it lifts; the
    // garage's frame and its door (.gd) in a window of its own that clips it
    var ART = {
      lock: '<svg class="art" viewBox="0 0 80 80" aria-hidden="true">' +
        '<path class="shk" d="M28 37V27a12 12 0 0 1 24 0v20" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>' +
        '<rect x="17" y="36" width="46" height="33" rx="8" fill="currentColor"/></svg>',
      garage: '<svg class="art" viewBox="0 0 80 80" aria-hidden="true">' +
        '<path d="M12 68V33L40 14l28 19v35" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<svg x="22" y="39" width="36" height="29" overflow="hidden"><g class="gd" fill="currentColor">' +
        '<rect x="0" y="0" width="36" height="6" rx="1.5"/><rect x="0" y="7.5" width="36" height="6" rx="1.5"/>' +
        '<rect x="0" y="15" width="36" height="6" rx="1.5"/><rect x="0" y="22.5" width="36" height="6" rx="1.5"/></g></svg></svg>'
    };

    class LockPanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      _pendTo(a) { return a[1] === 'unlock' ? 'unlocked' : a[1] === 'lock' ? 'locked' : null; }
      spec(s) {
        var pend = this._pendNow(s);
        var st = pend ? (pend.to === 'unlocked' ? 'unlocking' : 'locking') : s.state;
        var locked = st === 'locked', open = st === 'unlocked' || st === 'open';
        var jammed = st === 'jammed', bad = jammed || gone(s), unsure = st === 'unknown';
        return {
          word: bad ? (jammed ? 'Jammed' : 'Unavailable') : unsure ? 'Unknown' :
            ({ locked: 'Locked', unlocked: 'Unlocked', locking: 'Locking…', unlocking: 'Unlocking…', open: 'Open', opening: 'Opening…' })[st] || st,
          glyph: open || st === 'unlocking' ? 'hk:lock-open-variant' : 'hk:lock',
          // (the shackle drops the moment a lock is sent: the press is what it answers)
          art: 'lock', pose: open || st === 'unlocking' ? 'open' : 'shut',
          open: open || st === 'unlocking', busy: st === 'locking' || st === 'unlocking' || st === 'opening', bad: bad,
          hold: locked ? ['lock', 'unlock'] : null,
          // JAMMED: try locking again, the safe direction -- HA's dialog is
          // not reachable from here, so this is the only retry there is
          // (not knowing either: locking is the safe way to find out)
          tap: open || jammed || unsure ? ['lock', 'lock'] : null,
          hint: locked ? 'Hold to unlock' : open || jammed || unsure ? 'Tap to lock' : '',
          label: locked ? 'Hold to unlock' : 'Lock',
          ask: 'Unlock ' + this._who(s, 'the door') + '?'
        };
      }
    }

    // A DOOR COVER -- a garage, a gate, a car's frunk or charge port -- is a
    // door too: hold to open, tap to close, and while it moves a tap stops it
    // (when the opener can stop). It shows itself moving as soon as it is
    // sent (RingPanel's sent).
    class GaragePanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      _pendTo(a) { return a[1] === 'open_cover' ? 'open' : a[1] === 'close_cover' ? 'closed' : null; }
      spec(s) {
        var pend = this._pendNow(s);
        var st = pend ? (pend.to === 'open' ? 'opening' : 'closing') : s.state, f = num(at(s, 'supported_features')) || 0;
        var moving = st === 'opening' || st === 'closing';
        // only a move Home Assistant reports can be stopped: on a relay opener a stop is another pulse, which would
        // START a door that never got the first one
        var stop = moving && !pend && (f & 8) ? ['cover', 'stop_cover'] : null;
        var bad = gone(s), door = at(s, 'device_class') === 'door', unsure = st === 'unknown';
        var shut = st === 'closed' || st === 'closing';
        return {
          word: bad ? 'Unavailable' : unsure ? 'Unknown' : ({ open: 'Open', closed: 'Closed', opening: 'Opening…', closing: 'Closing…' })[st] || st,
          glyph: door ? (shut ? 'hk:door-closed' : 'hk:door-open') : shut ? 'hk:garage-variant' : 'hk:garage-open-variant',
          // (a door keeps its glyph: the art is a garage's)
          art: door ? null : 'garage', pose: st === 'open' ? 'open' : st === 'opening' ? 'opening' : st === 'closing' ? 'closing' : 'shut',
          open: st === 'open' || st === 'opening', busy: moving, bad: bad,
          // (not knowing: a tap closes, the safe way -- a ring with a hold
          // takes no tap, so not both)
          hold: st === 'closed' && (f & 1) ? ['cover', 'open_cover'] : null,
          tap: (st === 'open' || unsure) && (f & 2) ? ['cover', 'close_cover'] : stop,
          hint: st === 'closed' ? 'Hold to open' : st === 'open' || (unsure && (f & 2)) ? 'Tap to close' : stop ? 'Tap to stop' : '',
          label: st === 'closed' ? 'Hold to open' : st === 'open' || (unsure && (f & 2)) ? 'Close' : stop ? 'Stop' : '',
          ask: 'Open ' + this._who(s, door ? 'the door' : 'the garage') + '?'
        };
      }
    }

    // A BUTTON -- a computer's Wake on LAN, an input_button -- is the lock's
    // ring with one tap and no hold: it has no state to protect, and pressing
    // it twice only sends the packet twice. Its state is the time it was
    // last pressed, so the ring pulses "Sent" for a moment after a press
    // and the line under it says when that was.
    var SENT_MS = 4000;

    class ButtonPanel extends RingPanel {
      hkWidthKind() { return 'lock'; }
      _wakes() {
        var s = this._stateObj;
        return /wake[\s_-]*on[\s_-]*lan/i.test(String(this._id) + ' ' + String(at(s, 'friendly_name') || ''));
      }
      spec(s) {
        // 'unknown' is a button never pressed since Home Assistant started --
        // not a dead one: only 'unavailable' is
        var bad = !s || s.state === 'unavailable', wake = this._wakes();
        var t = Date.parse(s.state), sent = isFinite(t) && Date.now() - t < SENT_MS && Date.now() >= t - 2000;
        return {
          word: bad ? 'Unavailable' : sent ? (wake ? 'Waking…' : 'Sent') : wake ? 'Wake' : 'Press',
          glyph: this._src.icon || at(s, 'icon') || (wake ? 'hk:desktop-tower' : 'mdi:gesture-tap-button'),
          busy: sent, bad: bad,
          tap: bad ? null : [domainOf(this._id), 'press'],
          hint: bad ? '' : lastText(s.state, wake),
          label: wake ? 'Wake ' + this._who(s, 'the computer') : 'Press ' + this._who(s, 'the button')
        };
      }
      _render() {
        super._render();
        // the pulse ends by itself: no state change comes to end it
        var s = this._stateObj, t = s ? Date.parse(s.state) : NaN, left = t + SENT_MS - Date.now(), self = this;
        clearTimeout(this._sentT);
        if (isFinite(left) && left > 0 && left <= SENT_MS) this._sentT = setTimeout(function () { self._render(); }, left + 50);
      }
      disconnectedCallback() { clearTimeout(this._sentT); if (super.disconnectedCallback) super.disconnectedCallback(); }
    }

    // "Last woken 9:14 PM" today, "Last woken Oct 1, 9:14 PM" before that
    function lastText(iso, wake) {
      var t = Date.parse(iso), verb = wake ? 'Last woken ' : 'Last pressed ';
      if (!isFinite(t)) return wake ? 'Tap to wake' : 'Tap to press';
      var d = new Date(t), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (d.toDateString() === new Date().toDateString()) return verb + time;
      return verb + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
    }

    // what the shell and the later parts use of this one
    K.ButtonPanel = ButtonPanel; K.GaragePanel = GaragePanel; K.LockPanel = LockPanel; K.RingPanel = RingPanel;
  };
})();
