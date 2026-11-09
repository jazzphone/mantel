// @ts-check
// hk-timer-ring.js -- A TIMER THAT ENDED, on this screen (phase 21, docs/phase21/TIMER-SLIDE.md). Mantel says what is ringing, on
// sensor.running_quick_timers (`ringing`: hosts/server/mantel_server/timers.py); this plays the sound if the ring is for this
// tablet's room, and shows Time's Up over a page someone is using. Over the screensaver the Timer slide shows it instead
// (hk-saver-timers.js). Stop on any screen ends it on all of them. Inside Home Assistant nothing ever rings, and this does nothing.
//
// WHAT IT COSTS: one read of one state per update, no element and no sound until something rings.
//
// AUTOPLAY. A browser that won't start audio without a touch leaves the context suspended, so it is made at the first touch
// anywhere, ahead of any ring. A tablet that was never touched shows one small pill, once, and the first touch plays it.
(function () {
  'use strict';
  if (window.hkTimerRing) return;

  // (the same recipes as hk_core/timers TONES: frequency, start, length in seconds)
  var TONES = { bell: [[880, 0, 1.6], [1320, 0, 0.9], [660, 0.9, 1.6]], chime: [[988, 0, 0.6], [1319, 0.16, 0.9]],
                kitchen: [[2100, 0, 0.08], [2100, 0.16, 0.08], [2100, 0.32, 0.08], [2100, 0.48, 0.08]] };
  var EVERY = 2400;

  var CSS = [
    ':host{all:initial}',
    '.scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;',
    '  font-family:"SF Pro","SF Pro Display",-apple-system,system-ui,"Roboto",sans-serif;color:rgba(255,255,255,.94)}',
    '.pop{width:min(460px,100%);box-sizing:border-box;background:#2a2b30;border-radius:28px;padding:26px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.ring{width:150px;height:150px;margin:0 auto 14px;position:relative}',
    '.ring svg{display:block;width:100%;height:100%}.ring circle{animation:glow 1.6s ease-in-out infinite}',
    '.ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:700;letter-spacing:-1px}',
    '@keyframes glow{50%{opacity:.55}}',
    '.nm{font-size:32px;font-weight:700;letter-spacing:-.6px;line-height:1.1;overflow-wrap:anywhere}',
    '.where{font-size:16px;font-weight:500;opacity:.82;margin-top:6px;line-height:1.3}',
    '.acts{display:flex;gap:10px;margin-top:20px;justify-content:center;flex-wrap:wrap}',
    'button{font:inherit;font-size:18px;font-weight:700;min-height:54px;border:0;border-radius:27px;padding:0 22px;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;white-space:nowrap}',
    'button.stop{background:#ff9f0a;color:#1a0f00;min-width:130px}',
    '.pill{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;background:#2a2b30;color:#fff;border-radius:22px;padding:11px 20px;font-size:16px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.4);',
    '  font-family:"SF Pro",-apple-system,system-ui,"Roboto",sans-serif;pointer-events:none}',
    '@media (prefers-reduced-motion:reduce){.ring circle{animation:none}}'
  ].join('');

  /** @type {any} */ var ctx = null;
  /** @type {any} */ var loop = null;
  /** @type {any} */ var host = null;
  /** @type {any} */ var root = null;
  var drawn = '', sounding = '', pillShown = false;
  /** @type {any} */ var lastClient = null;

  function audio() {
    if (ctx) return ctx;
    var AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    return ctx;
  }
  /** @param {string} tone */
  function hit(tone) {
    var c = audio();
    if (!c || c.state !== 'running') return false;
    var t0 = c.currentTime + 0.02;
    (TONES[/** @type {'bell'} */ (tone)] || TONES.bell).forEach(function (p) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = p[0];
      g.gain.setValueAtTime(0.0001, t0 + p[1]);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + p[1] + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p[1] + p[2]);
      o.connect(g); g.connect(c.destination);
      o.start(t0 + p[1]); o.stop(t0 + p[1] + p[2] + 0.05);
    });
    return true;
  }
  // the first touch anywhere allows sound, and the ring starts if it was waiting for that
  function unlock() {
    var c = audio();
    if (c && c.state !== 'running' && c.resume) c.resume();
    if (root) { var p = root.querySelector('.pill'); if (p) p.remove(); }
  }
  try { document.addEventListener('pointerdown', unlock, { capture: true, passive: true }); } catch (e) { /* a harness */ }

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'hk-timer-ring';
    root = host.attachShadow({ mode: 'open' });
    (document.body || document.documentElement).appendChild(host);
    var st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
    root.addEventListener('click', function (/** @type {any} */ e) {
      var b = e.target && e.target.closest && e.target.closest('button[data-a]');
      if (b && window.hkTimers) window.hkTimers.ringAct(lastClient, b.getAttribute('data-a'), b.getAttribute('data-id') || null);
    });
  }
  function pill() {
    if (pillShown) return;
    pillShown = true;
    mount();
    var p = document.createElement('div');
    p.className = 'pill';
    p.textContent = 'Tap to hear the timer';
    root.appendChild(p);
  }
  /** @param {any} s */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return /** @type {any} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // TIME'S UP over a page. Not over the screensaver: its Timer slide shows it.
  /** @param {any[]} rings @param {string} room @param {boolean} tablet */
  function draw(rings, room, tablet) {
    var saver = window.hkSaver, up = !!(saver && saver.running && saver.running());
    var key = up || !rings.length ? '' : JSON.stringify(rings.map(function (r) { return [r.entity_id, r.name, r.tablet, r.speakers]; })) + room + tablet;
    if (key === drawn) return;
    drawn = key;
    if (root) { var old = root.querySelector('.scrim'); if (old) old.remove(); }
    if (!key) return;
    mount();
    var T = window.hkTimers, one = rings.length === 1, r0 = rings[0], c = 2 * Math.PI * 96;
    var where = T.whereWords(r0, room, tablet);
    var el = document.createElement('div');
    el.className = 'scrim';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', 'Time’s up');
    el.innerHTML = '<div class="pop"><div class="ring"><svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="96" fill="none" stroke="' + T.colorOf(r0.entity_id) +
      '" stroke-width="22" stroke-dasharray="' + c.toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><b>Done</b></div>' +
      '<div class="nm">' + esc(rings.map(function (r) { return r.name; }).join(' and ')) + '</div>' +
      (where ? '<div class="where">Ringing on ' + esc(where) + '.</div>' : '') +
      '<div class="acts"><button class="stop" data-a="stop">' + (one ? 'Stop' : 'Stop All') + '</button>' +
      (one ? '<button data-a="more" data-id="' + esc(r0.entity_id) + '">+1 Min</button><button data-a="again" data-id="' + esc(r0.entity_id) + '">Restart</button>' : '') + '</div></div>';
    root.appendChild(el);
  }
  // THE SOUND: only for this tablet's room (or every tablet, for a timer with no room), once for all of them at a time
  /** @param {string} tone */
  function sound(tone) {
    if (sounding === tone) return;
    stopSound();
    sounding = tone;
    if (!tone) return;
    var c = audio();
    if (!c || c.state !== 'running') pill();
    hit(tone);
    loop = setInterval(function () { hit(tone); }, EVERY);
  }
  function stopSound() {
    if (loop) { clearInterval(loop); loop = null; }
    sounding = '';
  }
  /** @param {any} client */
  function update(client) {
    lastClient = client || lastClient;
    var T = window.hkTimers, states = lastClient && lastClient.states;
    if (!T || !T.rings || !states) return;
    var rings = T.rings(states);
    if (!rings.length && !drawn && !sounding) return;
    var HS = window.hkSettings, me = null;
    try { me = HS && HS.tablet ? HS.tablet(lastClient) : null; } catch (e) { /* a settings module from before tablets */ }
    var tablet = !!me, room = (me && me.room) || '';
    var hears = rings.filter(function (r) { return T.rings && T.heardHere(r, room, tablet); });
    sound(hears.length ? hears[0].tone || 'bell' : '');
    draw(rings, room, tablet);
  }
  var tries = 0;
  (function wire() {
    var C = window.hkCards;
    if (!C || !C.onClient) { if (tries++ < 240) setTimeout(wire, 500); return; }
    C.onClient(update);
    try { update(C.client()); } catch (e) { /* not connected yet */ }
    // (the screensaver coming or going moves Time's Up between the slide and the page, with no state changing)
    setInterval(function () { if (drawn || sounding || (lastClient && window.hkTimers && window.hkTimers.rings(lastClient.states).length)) update(lastClient); }, 2000);
  })();

  window.hkTimerRing = { update: update, hear: function (/** @type {string} */ tone) { unlock(); return hit(tone); },
                         _: { state: function () { return { drawn: drawn, sounding: sounding, pill: pillShown }; }, TONES: TONES } };
})();
