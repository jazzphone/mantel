// @ts-check
// hk-hv-care.js -- AN APPLE HOMEVIEW'S CARE PAGES (docs/phase36/PLAN.md, 2026-11-26): Security, Timers and Vacuums, each drawn for
// the HomeView from the page the build made (hk-hv.js: the kit, the frame, harvest()).
//
//   hk-hv-security-card   the alarm (its state, Arm Home / Arm Away or Disarm) beside the locks and garage doors; a code's keypad is a
//                         step deeper on the same frame; then Doors & Windows (what is open, lit) and Recent (the alarm's and the locks'
//                         last changes -- from last_changed, no history calls).
//   hk-hv-timers-card     what is running as rings (cancel, pause or resume), Start a Timer (1, 5, 10 min, Other: the wheels a step
//                         deeper), Recent (the quick timers that ran and the House Timers, one tap to start again).
//   hk-hv-vacuums-card    per vacuum: the robot (drawn, its state, battery, water tank) beside its Clean Rooms picker; History and
//                         Maintenance from the sensors on its own device.
//
// Every state is read through this.st() while drawing (rule 13); service calls go through the base's _call / _callErr / _callResp,
// the same services the existing cards send (hk-security.js, hk-home-timers.js, hk-home-shared.js).
(function () {
  'use strict';
  if (window.hkHvCare) return;                     // double-load guard
  window.hkHvCare = { version: '1.0.0' };

  function whenKit(/** @type {(H: any) => void} */ fn) {
    if (window.hkHV && window.hkHV.ready) return fn(window.hkHV);
    window.addEventListener('hk-hv-ready', function () { fn(window.hkHV); }, { once: true });
    if (window.hkNeed && window.hkNeed.file) window.hkNeed.file('hk-hv.js');
  }

  whenKit(function (H) {
  if (window.hkHvCare.ready) return;
  window.hkHvCare.ready = true;
  var esc = H.esc, P = H.P, C = H.C, v = C.v;

  // ------------------------------------------------------------------ small words
  // "Tuesday 10:05 AM", "Yesterday 5:42 PM", "5:42 PM" (today), "Nov 3" (older than a week)
  /** @param {any} when */
  function dayClock(when) {
    var d = new Date(when), n = new Date();
    if (!isFinite(d.getTime())) return '';
    var clk = H.clock(d), y = new Date(n.getTime() - 864e5);
    if (d.toDateString() === n.toDateString()) return clk;
    if (d.toDateString() === y.toDateString()) return 'Yesterday ' + clk;
    try {
      if (n.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'long' }) + ' ' + clk;
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (e) { return clk; }
  }
  // the day alone, for a row's second line
  /** @param {any} when */
  function dayWord(when) {
    var d = new Date(when), n = new Date();
    if (!isFinite(d.getTime())) return '';
    if (d.toDateString() === n.toDateString()) return 'Today';
    if (d.toDateString() === new Date(n.getTime() - 864e5).toDateString()) return 'Yesterday';
    try { return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  // how long, in the Home app's words: "4 min", "2 hr", "3 days"; nothing under a minute
  /** @param {number} ms */
  function lasted(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 1) return '';
    if (m < 60) return m + ' min';
    if (m < 1440) return Math.floor(m / 60) + ' hr';
    var d = Math.floor(m / 1440);
    return d + (d === 1 ? ' day' : ' days');
  }
  /** @param {any} st */
  function since(st) { var t = st ? Date.parse(st.last_changed) : NaN; return isFinite(t) ? t : 0; }
  /** @param {any} st @param {string} id */
  function nameOf(st, id) { return (st && st.attributes && st.attributes.friendly_name) || id; }
  /** @param {any} n */
  function num(n) { var x = parseFloat(n); return isFinite(x) ? x : null; }
  var TEAL = H.hue('teal'), TEAL_DEEP = H.DEEP.teal, AMBER = '#ffb340';
  // a glyph at rest takes the words' color when the screen's Icons are white (the kit's H.whiteGlyphs); one that is on or needs you keeps its own
  /** @param {string} c */
  function rest(c) { return H.whiteGlyphs() ? undefined : c; }

  // the stylesheet these three pages add to the kit's
  function careCss() {
    return [
      // SECURITY: the alarm's plate beside the locks'
      '.sec2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + P(12) + ';align-items:stretch}',
      '.sec2>.pl{min-height:' + P(336) + '}',
      '.al{display:flex;flex-direction:column;padding:' + P(20) + ' ' + P(18) + ' ' + P(18) + '}',
      '.alh{display:block;width:100%;text-align:left}',
      '.al .big{font-size:' + P(34) + ';font-weight:700;letter-spacing:' + P(-0.6) + ';margin-top:' + P(14) + ';line-height:1.1}',
      '.al .since{font-size:' + P(15) + ';font-weight:500;color:' + v('ink-2') + ';margin-top:' + P(2) + '}',
      '.alk{margin-top:auto;display:flex;flex-direction:column;gap:' + P(10) + ';padding-top:' + P(16) + '}',
      '.alk .cap{width:100%}',
      '.sl{padding:' + P(6) + ' ' + P(8) + '}',
      '.ev{display:flex;align-items:center;gap:' + P(12) + ';min-height:' + P(52) + ';padding:0 ' + P(14) + ' 0 ' + P(4) + ';border-top:1px solid ' + v('line') + '}',
      '.ev:first-child{border-top-color:transparent}',
      '.ev .when{width:' + P(64) + ';text-align:right;font-size:' + P(14) + ';font-weight:600;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;flex:none}',
      '.ev>.g{width:' + P(30) + '}',
      '.ev .mid{flex:1;min-width:0}',
      // THE KEYPAD: the shield and the dots at the left, 3 x 4 keys at the right
      '.kg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + P(12) + '}',
      '.kl{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:' + P(336) + ';padding:0 ' + P(8) + '}',
      '.kl .enter{font-size:' + P(22) + ';font-weight:700;margin-top:' + P(16) + '}',
      '.kl .note{font-size:' + P(15) + ';font-weight:500;color:' + v('ink-2') + ';margin-top:' + P(4) + ';min-height:' + P(20) + '}',
      '.kl .note.bad{color:' + v('fail', '#ff6961') + ';font-weight:600}',
      '.pins{display:flex;gap:' + P(14) + ';margin-top:' + P(20) + ';min-height:' + P(16) + ';align-items:center}',
      '.pin{width:' + P(16) + ';height:' + P(16) + ';border-radius:50%;border:2px solid rgba(255,255,255,.7)}',
      '.pin.f{background:#fff;border-color:#fff}',
      '.kl .cap{margin-top:' + P(22) + ';min-width:' + P(190) + '}',
      '.kpad{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(4,' + P(75) + ');gap:' + P(12) + '}',
      '.kpk{display:flex;align-items:center;justify-content:center;font-size:' + P(30) + ';font-weight:500;font-variant-numeric:tabular-nums;border-radius:' + P(20) + '}',
      '.kpk.txt{font-size:' + P(15) + ';font-weight:600;color:' + v('ink') + '}',
      // TIMERS: a ring, the name, the two keys at the plate's upper corners
      '.tmr{padding:0}',
      '.tmb{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;padding:' + P(14) + ' ' + P(10) + ';text-align:center}',
      '.ringw{position:relative;width:' + P(132) + ';height:' + P(132) + ';display:grid;place-items:center;flex:none}',
      '.ringw svg{position:absolute;inset:0;width:100%;height:100%}',
      '.ringw .rt{fill:none;stroke:' + v('line-strong') + ';stroke-width:8}',
      '.ringw .rf{fill:none;stroke:var(--rc,#ff9f0a);stroke-width:8;stroke-linecap:round;stroke-dasharray:100 100;stroke-dashoffset:calc((1 - var(--hk-left,1)) * 100)}',
      '.ringw.hold .rf{stroke:' + v('ink-3') + '}',
      '.ringw.done .rf{stroke-dashoffset:0}',
      '.tt{position:relative;font-size:' + P(32) + ';font-weight:500;letter-spacing:' + P(-0.5) + ';font-variant-numeric:tabular-nums;line-height:1}',
      '.tt.hrs{font-size:' + P(25) + '}',
      '.tmb .hl{margin-top:' + P(12) + ';max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tmr>.key{position:absolute;top:' + P(12) + '}.tmr>.key.l{left:' + P(12) + '}.tmr>.key.r{right:' + P(12) + '}',
      '.qk{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}',
      '.qk .fig{font-size:' + P(34) + ';line-height:' + P(36) + '}',
      '.qk>.g{margin-bottom:' + P(6) + '}',
      '.chips{display:flex;flex-wrap:wrap;gap:' + P(8) + '}',
      '.chip{height:' + P(44) + ';padding:0 ' + P(16) + ';border-radius:' + P(22) + ';display:inline-flex;align-items:center;font-size:' + P(15) + ';font-weight:600;background:' + v('key') +
        ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);white-space:nowrap}',
      '.chip.sel{background:#fff;color:#1c1c1e;box-shadow:none;text-shadow:none}',
      '.tw{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:' + P(8) + ';min-height:' + P(260) + '}',
      '.tw .hkr{--hkr-row:' + P(44) + ';--hkr-fs:' + P(24) + ';--hkr-w:' + P(26) + ';--hkr-uw:' + P(30) + ';--hkr-gap:' + P(8) + ';--hkr-ink:' + v('ink') + ';--hkr-ink2:' + v('ink-2') +
        ';--hkr-band:' + v('key') + ';--hkr-band-r:' + P(14) + '}',
      '.tn{display:flex;flex-direction:column;gap:' + P(14) + ';padding:' + P(18) + ';min-height:' + P(260) + '}',
      '.tn .ends{font-size:' + P(15) + ';font-weight:500;color:' + v('ink-2') + ';min-height:' + P(20) + '}',
      '.tn .cap{margin-top:auto;width:100%}',
      // VACUUMS: the robot's plate and the rooms' plate
      '.vh{display:flex;flex-direction:column;padding:' + P(18) + ' ' + P(18) + ' ' + P(18) + '}',
      '.vh .hero{display:block;width:100%;text-align:left}',
      '.vh .hkva{width:68%;margin:0 auto}',
      '.vh .big{font-size:' + P(30) + ';font-weight:700;letter-spacing:' + P(-0.6) + ';margin-top:' + P(8) + ';line-height:1.1}',
      '.vh .line{font-size:' + P(15) + ';font-weight:500;color:' + v('ink-2') + ';margin-top:' + P(2) + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.vh .pills{display:flex;flex-wrap:wrap;gap:' + P(8) + ';margin-top:' + P(12) + '}',
      '.vp{display:inline-flex;align-items:center;gap:' + P(7) + ';height:' + P(30) + ';padding:0 ' + P(12) + ';border-radius:' + P(15) + ';font-size:' + P(13) + ';font-weight:700;background:' +
        v('key') +
        ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);white-space:nowrap}',
      '.vp.warn{background:rgba(255,179,64,.92);color:#000;box-shadow:none;text-shadow:none}',
      '.vp.err{background:rgba(255,69,58,.9);color:#fff;box-shadow:none;text-shadow:none}',
      '.vp.low{color:' + AMBER + '}',
      '.vcmds{margin-top:auto;padding-top:' + P(16) + ';display:flex;gap:' + P(10) + '}',
      '.vcmds .cap{flex:1;min-width:0}',
      '.vr{display:flex;flex-direction:column;padding:' + P(16) + ' ' + P(14) + ' ' + P(14) + '}',
      '.vr .lbl{padding:0 ' + P(4) + ' ' + P(10) + '}',
      '.rooms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:' + P(8) + '}',
      '.rooms.one{grid-template-columns:minmax(0,1fr)}',
      '.rm{height:' + P(44) + ';border-radius:' + P(22) + ';display:flex;align-items:center;gap:' + P(8) + ';padding:0 ' + P(14) + ' 0 ' + P(12) + ';font-size:' + P(15) +
        ';font-weight:600;background:' + v('key') +
        ';box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);white-space:nowrap;min-width:0}',
      '.rm span.t{overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.rm .ck{width:' + P(18) + ';height:' + P(18) + ';border-radius:50%;border:1.5px solid rgba(255,255,255,.5);display:grid;place-items:center;flex:none;color:#fff}',
      '.rm .ck .g{display:none}',
      '.rm.sel{background:#fff;color:#1c1c1e;text-shadow:none;box-shadow:none}',
      '.rm.sel .ck{background:#2fb8b4;border-color:transparent}.rm.sel .ck .g{display:inline-flex}',
      '.vr .go{margin-top:auto}.vr .go .cap{width:100%}',
      '.vr .rowgap{height:' + P(14) + ';flex:none}',
      '.vr .why{font-size:' + P(13) + ';color:' + v('ink-2') + ';text-align:center;min-height:' + P(18) + ';padding-top:' + P(8) + '}',
      '.vr .why.bad{color:' + v('fail', '#ff6961') + '}',
      '.vr .empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:' + P(6) + ';padding:0 ' + P(10) + '}',
      '.vr .empty .hl{margin-top:' + P(6) + '}',
      '.mt{display:grid;grid-template-columns:' + P(120) + ' 1fr ' + P(52) + ';align-items:center;column-gap:' + P(14) + ';height:' + P(50) + ';border-top:1px solid ' + v('line') + ';padding:0 ' +
        P(10) + ' 0 ' + P(8) + '}',
      '.mt:first-child{border-top-color:transparent}',
      '.mt .bar{height:' + P(6) + ';border-radius:' + P(3) + ';background:' + v('line-strong') + ';position:relative;overflow:hidden}',
      '.mt .bar i{position:absolute;inset:0 auto 0 0;border-radius:' + P(3) + ';background:#63e6e2}',
      '.mt .pc{text-align:right;font-size:' + P(15) + ';font-weight:600;font-variant-numeric:tabular-nums}',
      '.mt.low .bar i{background:' + AMBER + '}.mt.low .pc{color:' + AMBER + '}',
      '.foot{font-size:' + P(13) + ';color:' + v('ink-2') + ';padding:' + P(8) + ' ' + P(10) + ' ' + P(2) + '}'
    ].join('\n');
  }
  var CARE = '';

  // ================================================================== SECURITY
  // THE ALARM (hk-alarm-keypad-card: entity, entries) and the locks and garage doors (the lock and garage tiles), the doors and windows
  // (hk-security-overview-card). Arming and disarming are the keypad card's: alarm_control_panel.alarm_arm_* / alarm_disarm on the
  // panel, with the typed code when its code_format says there is one (a panel with none is sent without), and a refusal that names the
  // code is "Wrong code".
  var ALARM = {
    disarmed: ['hk:alarm-light-off', 'Disarmed', ''], armed_home: ['hk:alarm-light', 'Armed Home', 'teal'], armed_night: ['hk:alarm-light', 'Armed Night', 'teal'],
    armed_away: ['hk:alarm-light', 'Armed Away', 'teal'], armed_vacation: ['hk:alarm-light', 'Armed Vacation', 'teal'], armed_custom_bypass: ['hk:alarm-light', 'Armed', 'teal'],
    arming: ['hk:alarm-light', 'Arming…', 'teal'], pending: ['hk:alarm-light', 'Pending…', 'red'], disarming: ['hk:alarm-light-off', 'Disarming…', ''],
    triggered: ['hk:alarm-light', 'Triggered', 'red']
  };
  // the ways to arm (supported_features), in the order the buttons go
  var MODES = { home: ['Arm Home', 'hk:shield-home', 'alarm_arm_home', 1], away: ['Arm Away', 'hk:shield-lock', 'alarm_arm_away', 2],
                night: ['Arm Night', 'hk:weather-night', 'alarm_arm_night', 4], vacation: ['Arm Vacation', 'hk:bag-suitcase', 'alarm_arm_vacation', 32] };
  /** @param {any} s */
  function modesOf(s) {
    var f = s && s.attributes && s.attributes.supported_features;
    return Object.keys(MODES).filter(function (k) { return typeof f !== 'number' ? k === 'home' || k === 'away' : !!(f & /** @type {any} */ (MODES)[k][3]); });
  }
  var OPEN_RE = /^(on|open|opening)$/;

  class HvSecurity extends H.Page {
    constructor() {
      super();
      this.minutely = true;                        // ("Open 4 min" moves on: the signature carries the minute)
      this._code = ''; this._msg = ''; this._more = false; this._busy = false;
    }
    static get CSS() { return H.CSS + (CARE || (CARE = careCss())); }
    /** @param {boolean} on */
    _clock(on) {
      if (on && !this._tick) { var self = this; this._tick = setInterval(function () { self.redraw(); }, 60000); }
      else if (!on && this._tick) { clearInterval(this._tick); this._tick = null; }
    }
    disconnectedCallback() { clearTimeout(this._msgT); this._clock(false); super.disconnectedCallback(); }
    connectedCallback() { super.connectedCallback(); if (this._open) this._clock(true); }
    // what this page is about: the panel, the guards (locks, then garage doors), the doors and windows
    _ids() {
      var h = this.h, kp = H.cardOf(h, 'hk-alarm-keypad-card') || {}, ov = H.cardOf(h, 'hk-security-overview-card') || {};
      var alarm = kp.entity || ov.alarm || (C.setting && C.setting('security.alarm')) || '';
      /** @type {string[]} */
      var guards = h.tiles.map(function (/** @type {any} */ t) { return t.id; }).filter(function (/** @type {string} */ id) { return /^(lock|cover)\./.test(id); });
      if (!guards.length) guards = [].concat(ov.locks || [], (ov.garage || []).filter(function (/** @type {string} */ id) { return id.indexOf('cover.') === 0; }));
      var isGuard = /** @type {any} */ ({}); guards.forEach(function (id) { isGuard[id] = true; });
      var wins = /** @type {any} */ ({}); (ov.windows || []).forEach(function (/** @type {string} */ id) { wins[id] = true; });
      var dw = ov.doors || ov.windows ? [].concat(ov.doors || [], ov.windows || []) : (kp.entries || []);
      dw = dw.filter(function (/** @type {string} */ id) { return !isGuard[id] && id.indexOf('cover.') !== 0 || (!isGuard[id] && !(ov.garage || []).includes(id)); });
      return { alarm: alarm, bad: kp.bad_code_entity || (C.setting && C.setting('features.alarm_bad_code')) || '', guards: guards, dw: dw, wins: wins };
    }
    /** @param {string} id */
    _gname(id) {
      var t = this.h.byId[id], st = this.st(id);
      return (t && t.cfg && t.cfg.name) || String(nameOf(st, id)).replace(/ Lock$/, '');
    }
    draw() {
      var self = this, x = this._ids(), as = this.st(x.alarm), deep = this.deep();
      this.st(x.bad);
      if (deep && deep.code) return this._keypad(x, as, deep);
      var a = ALARM[as ? as.state : ''] || ['hk:alarm-light-off', !as || as.state === 'unavailable' || as.state === 'unknown' ? 'Unavailable' : H.sentence(as.state), ''];
      var now = Date.now(), live = !!as && as.state !== 'unavailable' && as.state !== 'unknown';
      // the guards: locks that are not locked and doors that are not shut say so in the line under the title
      var rows = x.guards.map(function (/** @type {string} */ id) {
        var st = self.st(id), isLock = id.indexOf('lock.') === 0, s = st ? st.state : '';
        var up = isLock ? /^(unlocked|unlocking|open|jammed)$/.test(s) : /^(open|opening|closing)$/.test(s);
        var ic = isLock ? (up ? 'hk:lock-open-variant' : 'hk:lock') : (up ? 'hk:garage-open-variant' : 'hk:garage-variant');
        return { id: id, up: up, html: H.row({ icon: ic, color: up ? TEAL_DEEP : undefined, name: self._gname(id), val: esc(H.word(st)), lit: up, act: 'sheet', data: { id: id } }), isLock: isLock };
      });
      var unlocked = rows.filter(function (r) { return r.up && r.isLock; }).length, ajar = rows.filter(function (r) { return r.up && !r.isLock; }).length;
      // the doors and windows
      var dws = x.dw.map(function (/** @type {string} */ id) {
        var st = self.st(id), win = !!x.wins[id] || (st && st.attributes && st.attributes.device_class === 'window');
        return { id: id, st: st, win: win, open: !!st && OPEN_RE.test(st.state) };
      }).filter(function (/** @type {any} */ d) { return d.st && d.st.state !== 'unavailable' && d.st.state !== 'unknown'; });
      var open = dws.filter(function (/** @type {any} */ d) { return d.open; }), shut = dws.filter(function (/** @type {any} */ d) { return !d.open; });
      this._open = unlocked + ajar + open.length > 0;
      this._clock(this._open && this.isConnected);
      var warns = [];
      if (unlocked) warns.push(unlocked + ' Unlocked');
      if (ajar + open.length) warns.push((ajar + open.length) + ' Open');
      var sum = '<span class="' + (as && as.state === 'triggered' ? 'bad' : '') + '">' + esc(a[1]) + '</span>' + (warns.length ? ' · <span class="warn">' + esc(warns.join(' · ')) + '</span>' : '');
      var out = H.head({ title: (this._config || {}).title || 'Security', sum: sum });

      // THE ALARM: its state in big words, since when, and the ways to change it
      var codeless = !!as && !(as.attributes && as.attributes.code_format) && live;
      var caps = '';
      if (live) {
        var armed = as && as.state !== 'disarmed';
        if (!armed) {
          // (Home and Away; a panel with neither offers the first way it has)
          var ms = modesOf(as), two = ms.filter(function (k) { return k === 'home' || k === 'away'; });
          caps = (two.length ? two : ms.slice(0, 1)).map(function (k) {
            var m = /** @type {any} */ (MODES)[k];
            return H.cap({ cls: 'lg', g: H.glyph(m[1], 18, rest(TEAL)), t: m[0], act: 'arm', data: { svc: m[2], t: m[0], none: codeless ? 1 : null } });
          }).join('');
        } else {
          caps = H.cap({ cls: 'lg', g: H.glyph('hk:shield-off', 18, rest(TEAL)), t: 'Disarm', act: 'arm', data: { svc: 'alarm_disarm', t: 'Disarm', none: codeless ? 1 : null } });
        }
      }
      var gcol = a[2] === 'teal' ? TEAL : a[2] === 'red' ? H.hue('red') : 'rgba(255,255,255,.62)';
      var when = as ? since(as) : 0;
      var alarm = '<div class="pl al"><button class="alh" data-act="sheet" data-id="' + esc(x.alarm) + '" aria-label="' + esc('Alarm, ' + a[1]) + '">' + H.glyph(a[0], 40, gcol) +
        '<div class="big">' + esc(a[1]) + '</div><div class="since">' + (live && when ? 'Since ' + esc(dayClock(when)) : live ? '&nbsp;' : 'No response') + '</div></button>' +
        (caps ? '<div class="alk">' + caps + '</div>' : '') + '</div>';
      var locks = rows.length ? H.list(rows.map(function (r) { return r.html; }), 'x')
        : '<div class="pl pad quiet">No locks or garage doors on this screen. Add them in ' + H.esc(H.where('Accessories')) + '.</div>';
      out += '<div class="sec2">' + alarm + locks + '</div>';

      // DOORS & WINDOWS: the open ones lit, then the rest as one row (tap to see them)
      if (dws.length) {
        var dr = open.map(function (/** @type {any} */ d) {
          var n = lasted(now - since(d.st));
          return H.row({ icon: d.win ? 'hk:window-open-variant' : 'hk:door-open', color: TEAL_DEEP, name: nameOf(d.st, d.id), val: 'Open' + (n ? ' ' + n : ''), lit: true, act: 'sheet',
            data: { id: d.id } });
        });
        if (shut.length) {
          if (this._more) {
            shut.forEach(function (/** @type {any} */ d) {
              dr.push(H.row({ icon: d.win ? 'hk:window-closed-variant' : 'hk:door-closed', name: nameOf(d.st, d.id), val: 'Closed', act: 'sheet', data: { id: d.id } }));
            });
            dr.push(H.row({ g: H.chev('up', 18), name: 'Hide Closed', act: 'more', cls: 'ink2' }));
          } else {
            dr.push(H.row({ g: H.glyph(open.length ? 'mdi:dots-horizontal' : 'hk:check-bold', 24, open.length ? undefined : rest(TEAL)), name: open.length ? shut.length + ' More' : 'All ' +
              shut.length + ' Closed',
                            val: H.chev('down', 18), act: 'more' }));
          }
        }
        out += H.section('Doors & Windows', open.length ? open.length + ' Open' : 'All Closed') + '<div class="pl sl"><div class="rows">' + dr.join('') + '</div></div>';
      }

      // RECENT: the alarm's and the locks' last changes, newest first (no history: each one's own last_changed)
      /** @type {any[]} */
      var evs = [];
      if (live && when) evs.push({ t: when, icon: a[0], color: a[2] === 'teal' ? TEAL : undefined, name: a[1], sub: dayWord(when) });
      rows.forEach(function (r) {
        var st = self.st(r.id), t = since(st);
        if (!st || !t || st.state === 'unavailable' || st.state === 'unknown') return;
        var verb = r.isLock ? ({ locked: 'locked', unlocked: 'unlocked', jammed: 'jammed', locking: 'locking', unlocking: 'unlocking', open: 'opened' }[/** @type {'locked'} */ (st.state)] ||
          H.word(st).toLowerCase())
          : ({ open: 'opened', closed: 'closed', opening: 'opening', closing: 'closing' }[/** @type {'open'} */ (st.state)] || H.word(st).toLowerCase());
        evs.push({ t: t, icon: r.isLock ? (r.up ? 'hk:lock-open-variant' : 'hk:lock') : (r.up ? 'hk:garage-open-variant' : 'hk:garage-variant'), color: r.up ? TEAL : undefined,
                   name: self._gname(r.id) + ' ' + verb, sub: dayWord(t) });
      });
      evs.sort(function (p, q) { return q.t - p.t; });
      if (evs.length) {
        out += H.section('Recent') + '<div class="pl sl">' + evs.slice(0, 6).map(function (e) {
          return '<div class="ev"><div class="when">' + esc(H.clock(e.t)) + '</div>' + H.glyph(e.icon, 22, e.color) + '<div class="mid"><div class="nm">' + esc(e.name) +
            '</div><div class="st">' + esc(e.sub) + '</div></div></div>';
        }).join('') + '</div>';
      }
      this._x = x;
      return out;
    }
    // THE KEYPAD, a step deeper: the shield and the dots at the left, the keys at the right. Arm Away / Disarm sends the digits
    // typed (there is no Enter key on the alarm's keypad either: the action's own key is what sends)
    /** @param {any} x @param {any} as @param {any} deep */
    _keypad(x, as, deep) {
      var self = this, bad = this.st(x.bad), isBad = !!this._msg || (!!bad && bad.state === 'on');
      var odd = x.guards.concat(x.dw).filter(function (/** @type {string} */ id) {
        var st = self.st(id);
        return st && (id.indexOf('lock.') === 0 ? /^(unlocked|open|jammed)$/.test(st.state) : OPEN_RE.test(st.state));
      });
      var note = odd.length ? odd.slice(0, 2).map(function (/** @type {string} */ id) { return self._gname(id); }).join(', ') + (odd.length > 2 ? ' and ' + (odd.length - 2) + ' more' : '') +
        (odd.length === 1 ? ' is ' : ' are ') + (odd.every(function (/** @type {string} */ id) { return id.indexOf('lock.') === 0; }) ? 'unlocked' : 'open') : '';
      var n = Math.max(4, this._code.length), pins = '';
      for (var i = 0; i < n; i++) pins += '<i class="pin' + (i < this._code.length ? ' f' : '') + '"></i>';
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(function (d) {
        return H.plate({ cls: 'kpk', act: 'kp', data: { k: d }, label: d }, d);
      }).join('') + '<button class="kpk txt" data-act="back">Cancel</button>' + H.plate({ cls: 'kpk', act: 'kp', data: { k: '0' }, label: '0' }, '0') +
        H.plate({ cls: 'kpk', act: 'kdel', label: 'Delete' }, H.svg('x', 22));
      var disarm = deep.svc === 'alarm_disarm';
      return H.head({ title: deep.t, back: true }) + '<div class="kg"><div class="kl">' +
        H.glyph(disarm ? 'hk:shield-off' : 'hk:shield-lock', 64, rest(TEAL)) + '<div class="enter">Enter your code</div>' +
        '<div class="note' + (isBad ? ' bad' : '') + '" role="status">' + esc(isBad ? this._msg || 'Wrong code' : note) + '</div>' +
        '<div class="pins" role="img" aria-label="' + this._code.length + ' digits entered">' + pins + '</div>' +
        H.cap({ cls: 'lg w', t: deep.t, act: 'send', off: !this._code || this._busy }) + '</div><div class="kpad">' + keys + '</div></div>';
    }
    /** @param {string} svc */
    _send(svc) {
      var self = this, x = this._x || this._ids(), as = this.client && this.client.states[x.alarm];
      if (!x.alarm || this._busy) return;
      /** @type {any} */
      var data = { entity_id: x.alarm };
      // (a panel with no code gets none: the keypad card's rule)
      if (as && as.attributes && as.attributes.code_format) data.code = this._code;
      this._busy = true;
      this._callErr('alarm_control_panel', svc, data).then(function (/** @type {any} */ r) {
        self._busy = false; self._code = '';
        if (r.ok) { self._msg = ''; if (self.deep()) self.deep(null); else self.redraw(); return; }
        self._flash(/code/i.test(String(r.error)) ? 'Wrong code' : 'Alarm not responding');
      });
    }
    /** @param {string} text */
    _flash(text) {
      var self = this;
      this._msg = text;
      clearTimeout(this._msgT);
      this._msgT = setTimeout(function () { self._msg = ''; self.redraw(); }, 3000);
      this.redraw();
    }
    /** @param {string} name @param {any} el */
    act(name, el) {
      if (name === 'back') { this._code = ''; this._msg = ''; return false; }
      if (name === 'more') { this._more = !this._more; this.redraw(); return true; }
      if (name === 'arm') {
        var svc = el.getAttribute('data-svc') || '';
        if (el.getAttribute('data-none')) this._send(svc);
        else { this._code = ''; this._msg = ''; this.deep({ code: true, svc: svc, t: el.getAttribute('data-t') }); }
        return true;
      }
      if (name === 'kp') { if (this._code.length < 10) { this._code += el.getAttribute('data-k'); this._msg = ''; this.redraw(); } return true; }
      if (name === 'kdel') { this._code = this._code.slice(0, -1); this.redraw(); return true; }
      if (name === 'send') { var d = this.deep(); if (d && this._code) this._send(d.svc); return true; }
      return false;
    }
  }
  H.register('hk-hv-security-card', HvSecurity, 'HK HomeView Security', 'The Security page on an Apple HomeView: the alarm and its keypad, the locks, doors and windows, what happened.');

  // ================================================================== TIMERS
  // What is running as rings (two to a row), then Start a Timer and the timers that ran. Started as the Timers page starts them:
  // timer.pause / timer.start (resume) / timer.cancel on the timer, a HomePod's through hkTimers.act (to the HomePod, by Mantel), a
  // new one by script.quick_timer_start with the wheels' HH:MM:SS and a name, a House Timer or one that ran by timer.start.
  /** @param {number} t */
  function hms(t) { var p = function (/** @type {number} */ n) { return (n < 10 ? '0' : '') + n; }; return p(Math.floor(t / 3600)) + ':' + p(Math.floor(t % 3600 / 60)) + ':' + p(t % 60); }
  /** @param {number} t */
  function words(t) {
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60, out = [];
    if (h) out.push(h + ' hr');
    if (m) out.push(m + ' min');
    if (s) out.push(s + ' sec');
    return out.join(' ');
  }

  class HvTimers extends H.Page {
    constructor() {
      super();
      this._dur = { h: 0, m: 5, s: 0 }; this._pick = ''; this._note = ''; this._busy = false;
    }
    static get CSS() { return H.CSS + (CARE || (CARE = careCss())) + (window.hkRoller ? window.hkRoller.CSS : ''); }
    disconnectedCallback() { clearTimeout(this._noteT); super.disconnectedCallback(); }
    // the page's timers: the card's list (quick slots, then the others) and the ones Mantel made
    _list() {
      var h = this.h, c = H.cardOf(h, 'hk-timers-card') || H.cardOf(h, 'hk-timers-page-card') || H.cardOf(h, 'hk-timers-order-card') || {}, T = window.hkTimers;
      this.st('sensor.running_quick_timers');
      var base = c.timers || [];
      return T && T.withMade && this.client ? T.withMade(base, this.client.states) : base;
    }
    // its name: the slot's own (the helper beside it), else what the page calls it
    /** @param {any} t */
    _label(t) {
      var raw = t.label_entity ? String((this.st(t.label_entity) || {}).state || '').trim() : '';
      if (raw && raw !== 'unknown' && raw !== 'unavailable') return raw;
      var l = String(t.label || nameOf(this.st(t.entity), t.entity)).replace(/\s*[-–]?\s*timer\s*$/i, '');
      return !l || /^Quick( Timer)? ?\d*$/i.test(l) ? 'Timer' : l;
    }
    draw() {
      var self = this, T = window.hkTimers, deep = this.deep();
      var list = this._list(), quick = !!this.st('script.quick_timer_start');
      if (deep && deep.k === 'other') return this._other(quick);
      /** @type {any[]} */
      var run = [], seen = /** @type {any} */ ({});
      list.forEach(function (/** @type {any} */ t) {
        var st = self.st(t.entity);
        if (!st || seen[t.entity]) return;
        seen[t.entity] = true;
        var hp = T && T.homepod ? T.homepod(self.client && self.client.states, t.entity) : null, ring = !!(hp && hp.ringing);
        if (st.state === 'active' || st.state === 'paused' || ring) run.push({ t: t, st: st, hp: hp, ring: ring });
      });
      run.sort(function (p, q) {
        var pa = p.st.state === 'active' ? Date.parse(p.st.attributes.finishes_at) || 0 : 1e15, qa = q.st.state === 'active' ? Date.parse(q.st.attributes.finishes_at) || 0 : 1e15;
        return pa - qa;
      });
      var paused = run.filter(function (r) { return r.st.state === 'paused'; }).length;
      var out = H.head({ title: (this._config || {}).title || 'Timers',
        sum: run.length ? '<b>' + run.length + ' Running</b>' + (paused ? ' · ' + paused + ' Paused' : '') : 'Nothing Running' });
      if (run.length) out += '<div class="grid">' + run.map(function (r) { return self._ring(r); }).join('') + '</div>';

      // START A TIMER: 1, 5, 10 min and Other (the quick timers' script makes it); a house with no script has only what is below
      if (quick) {
        out += H.section('Start a Timer', this._note ? '<span class="warn">' + esc(this._note) + '</span>' : '');
        out += '<div class="grid">' + [1, 5, 10].map(function (m) {
          return H.plate({ cls: 'qk', act: 'tstart', data: { m: m }, label: m + ' minutes' }, '<div class="fig">' + m + '</div><div class="st">min</div>');
        }).join('') + H.plate({ cls: 'qk', act: 'tother', label: 'Other length' }, H.svg('plus', 28, rest(H.hue('orange'))) + '<div class="st">Other</div>') + '</div>';
      }

      // RECENT: the quick slots that are idle with a length they ran at (newest first), then the House Timers; a tap starts it again
      /** @type {any[]} */
      var rec = [], names = /** @type {any} */ ({});
      list.forEach(function (/** @type {any} */ t) {
        var st = self.st(t.entity);
        if (!st || st.state !== 'idle' || !/^timer\.quick_\d+$/.test(t.entity)) return;
        var d = T && T.secs ? T.secs((st.attributes || {}).duration) : 0, nm = self._label(t);
        if (!d || nm === 'Timer' || names[nm + d]) return;
        names[nm + d] = true;
        rec.push({ id: t.entity, name: nm, sec: d, at: since(st), icon: 'hk:timer-sand', own: true });
      });
      rec.sort(function (p, q) { return q.at - p.at; });
      this._house().forEach(function (/** @type {any} */ t) {
        var st = self.st(t.entity);
        if (!st || st.state !== 'idle') return;
        var d = T && T.secs ? T.secs((st.attributes || {}).duration) : 0;
        rec.push({ id: t.entity, name: t.name || nameOf(st, t.entity), sec: d, icon: t.icon || 'hk:timer-sand', own: false });
      });
      if (rec.length) {
        out += H.section('Recent', 'tap to start again') + '<div class="grid">' + rec.slice(0, 12).map(function (r) {
          return H.tile({ id: r.id, name: r.name, sub: r.sec ? (T && T.pretty ? T.pretty(hms(r.sec)) : words(r.sec)) : 'Start', icon: r.icon, color: rest(H.hue('orange')), act: 'tgo',
            data: { s: r.sec || '', own: r.own ? 1 : '' } });
        }).join('') + '</div>';
      }
      if (!run.length && !quick && !rec.length) {
        out += '<div class="pl pad quiet">Nothing is running. Timers started by voice or by an automation show here while they run.</div>';
      }
      return out;
    }
    // the House Timers (the page's own list of timers people start): [{entity, name, icon}]
    _house() {
      var h = this.h, pg = H.cardOf(h, 'hk-timers-page-card'), out = /** @type {any[]} */ ([]), seen = /** @type {any} */ ({});
      (pg && pg.house || []).forEach(function (/** @type {any} */ t) { if (t && t.entity && !seen[t.entity]) { seen[t.entity] = 1; out.push(t); } });
      h.tiles.forEach(function (/** @type {any} */ t) {
        if (t.id.indexOf('timer.') === 0 && !seen[t.id] && !/^timer\.quick_\d+$/.test(t.id)) { seen[t.id] = 1; out.push({ entity: t.id, name: t.cfg.name, icon: t.cfg.icon }); }
      });
      return out;
    }
    // A RING: the time left drawn round (hkTimers' countdown writes --hk-left, the ring reads it: nothing redraws as it runs)
    /** @param {any} r */
    _ring(r) {
      var T = window.hkTimers, st = r.st, a = st.attributes || {}, id = r.t.entity, name = this._label(r.t), paused = st.state === 'paused';
      var total = T && T.secs ? T.secs(a.duration) : 0, hp = r.hp, hpWords = hp && T && T.homepodWords ? T.homepodWords(hp) : '';
      var rc = T && T.colorOf ? T.colorOf(id) : '#ff9f0a', end = Date.parse(a.finishes_at);
      var clock, left = paused ? (T && T.secs ? T.secs(a.remaining) : 0) : (isFinite(end) ? (end - Date.now()) / 1000 : 0);
      if (r.ring) clock = '<span class="tt">Done</span>';
      else if (paused) clock = '<hk-countdown class="tt' + (left >= 3600 ? ' hrs' : '') + '" hold="' + (T && T.secs ? T.secs(a.remaining) : 0) + '" total="' + total + '"></hk-countdown>';
      else clock = '<hk-countdown class="tt' + (left >= 3600 ? ' hrs' : '') + '" deadline="' + (isFinite(end) ? end : Date.now()) + '" total="' + total + '"></hk-countdown>';
      var sub = r.ring ? 'Ringing' + (hpWords ? ' · ' + hpWords : '') : paused ? 'Paused' + (total ? ' · of ' + words(total) : '') :
        (total ? words(total) + ' · ' : '') + 'done ' + (isFinite(end) ? H.clock(end) : '') + (hpWords ? ' · ' + hpWords : '');
      var ring = '<div class="ringw' + (r.ring ? ' done' : paused ? ' hold' : '') + '" style="--rc:' + rc +
        '"><svg viewBox="0 0 132 132" aria-hidden="true"><circle class="rt" cx="66" cy="66" r="58"/>' +
        '<circle class="rf" cx="66" cy="66" r="58" pathLength="100" transform="rotate(-90 66 66)"/></svg>' + clock + '</div>';
      // (a HomePod's timer only has the keys the HomePod does; with none it is only shown)
      var keys = '';
      if (r.ring) keys = H.key({ cls: 'r', label: 'Stop', act: 'tstop', data: { id: id }, g: H.glyph('mdi:stop', 18) });
      else if (!hp || hp.controls) {
        keys = H.key({ cls: 'l', label: 'Cancel ' + name, act: 'tcancel', data: { id: id }, g: H.svg('x', 16) }) +
          H.key({ cls: 'r', label: (paused ? 'Resume ' : 'Pause ') + name, act: 'tpause', data: { id: id }, g: H.svg(paused ? 'play' : 'pause', 16) });
      }
      return '<div class="pl c2 r2 tmr"><button class="tmb" data-act="sheet" data-id="' + esc(id) + '" aria-label="' + esc(name) + '">' + ring + '<div class="hl">' + esc(name) +
        '</div><div class="st">' +
        esc(sub) + '</div></button>' + keys + '</div>';
    }
    // OTHER: the wheels at the left (hk-roller.js), the quick names and Start at the right
    /** @param {boolean} quick */
    _other(quick) {
      var chips = (H.cardOf(this.h, 'hk-timers-start-card') || H.cardOf(this.h, 'hk-timers-page-card') || {}).name_chips || [];
      var self = this;
      return H.head({ title: 'New Timer', back: true }) + '<div class="kg"><div class="pl tw" data-roller></div><div class="pl tn">' +
        '<div class="ends" data-ends></div>' +
        (chips.length ? '<div class="lbl">Name</div><div class="chips">' + chips.slice(0, 6).map(function (/** @type {string} */ n) {
          return '<button class="chip' + (self._pick === n ? ' sel' : '') + '" data-act="tname" data-n="' + esc(n) + '" aria-pressed="' + (self._pick === n) + '">' + esc(n) + '</button>';
        }).join('') + '</div>' : '') +
        (quick ? H.cap({ cls: 'lg w', t: 'Start Timer', act: 'tbegin', off: true }) : '<div class="st">Quick timers are not set up on this house.</div>') + '</div></div>';
    }
    _render() { super._render(); this._mount(); }
    // the wheels go into their place once the page is drawn, and stay while it only repaints
    _mount() {
      var R = window.hkRoller, at = this._root.querySelector('[data-roller]'), self = this;
      if (!R || !at) { this._roller = null; return; }
      if (!at.firstChild) {
        this._roller = R.create(R.timerCols(this._dur), { label: 'Timer length', onChange: function (/** @type {any} */ d) { self._dur = d; self._paintOther(); } });
        at.appendChild(this._roller.el);
      }
      this._paintOther();
    }
    // when it would end, and what Start says it starts
    _paintOther() {
      var d = this._dur, t = d.h * 3600 + d.m * 60 + d.s, root = this._root;
      var ends = root.querySelector('[data-ends]'), go = root.querySelector('[data-act="tbegin"]');
      if (ends) ends.textContent = t ? 'Ends ' + H.clock(Date.now() + t * 1000) : 'Set a length';
      if (go) {
        go.toggleAttribute('disabled', !t || this._busy);
        go.textContent = this._busy ? 'Starting…' : t ? 'Start ' + words(t) : 'Start Timer';
      }
    }
    /** @param {string} text */
    _say(text) {
      var self = this;
      this._note = text; clearTimeout(this._noteT);
      this._noteT = setTimeout(function () { self._note = ''; self.redraw(); }, 4000);
      this.redraw();
    }
    // a new timer: the quick timers' own script, with the length and a name (it answers whether a slot was free)
    /** @param {number} secs @param {string} [name] @param {() => void} [then] */
    _begin(secs, name, then) {
      var self = this;
      if (!secs || this._busy) return;
      this._busy = true;
      this._paintOther();
      this._callResp('script', 'quick_timer_start', Object.assign({ duration: hms(secs) }, name ? { name: name } : {})).then(function (/** @type {any} */ r) {
        self._busy = false;
        var res = r.response || {};
        if (!r.ok) self._say('Could not reach Home Assistant.');
        else if (res.started === false) self._say(res.reason === 'no_free_slot' ? 'Too many timers are running.' : 'That is no time at all.');
        else { if (then) then(); }
        self._paintOther();
      });
    }
    /** @param {string} name @param {any} el */
    act(name, el) {
      var T = window.hkTimers, id = el.getAttribute('data-id') || '', hp = T && T.isHomePod && T.isHomePod(id);
      if (name === 'tcancel') { if (hp) T.act(id, 'cancel'); else this._call('timer', 'cancel', { entity_id: id }); return true; }
      if (name === 'tstop') { if (T) T.act(id, 'stop'); return true; }
      if (name === 'tpause') {
        var st = this.client && this.client.states[id], active = !!st && st.state === 'active';
        if (hp) T.act(id, active ? 'pause' : 'resume'); else this._call('timer', active ? 'pause' : 'start', { entity_id: id });
        return true;
      }
      if (name === 'tstart') { this._begin(Number(el.getAttribute('data-m')) * 60); return true; }
      if (name === 'tother') { this._pick = ''; this.deep({ k: 'other' }); return true; }
      if (name === 'tname') { var n = el.getAttribute('data-n') || ''; this._pick = this._pick === n ? '' : n; this.redraw(); return true; }
      if (name === 'tbegin') {
        var d = this._dur, self = this;
        this._begin(d.h * 3600 + d.m * 60 + d.s, this._pick, function () { self._pick = ''; self.deep(null); });
        return true;
      }
      if (name === 'tgo') {
        var s = Number(el.getAttribute('data-s')) || 0;
        // (a timer that ran at a length starts again at it; a House Timer, at its own)
        this._call('timer', 'start', Object.assign({ entity_id: id }, s && el.getAttribute('data-own') ? { duration: hms(s) } : {}));
        return true;
      }
      return false;
    }
  }
  H.register('hk-hv-timers-card', HvTimers, 'HK HomeView Timers', 'The Timers page on an Apple HomeView: what is running as rings, Start a Timer, the timers that ran.');

  // ================================================================== VACUUMS
  // Per vacuum: the robot drawn (hk-vacuum-art.js) with its state, battery and water tank, beside the rooms it can clean; below, what
  // its own device says of its runs and its upkeep. The rooms and the way they are sent are the Vacuums page's picker's
  // (hk-home-shared.js areaPicking): Clean Areas' list live, this vacuum's own reach, then vacuum.clean_area, the house's script or
  // hk_frontend.clean_areas.
  var VF = { PAUSE: 4, RETURN_HOME: 16, START: 8192 };
  var VAC_WORDS = /** @type {any} */ ({ docked: 'Docked', cleaning: 'Cleaning', paused: 'Paused', returning: 'Returning', idle: 'Idle', error: 'Error' });
  var VAC_OK = ['no_error', 'none', 'ok', 'unknown', 'unavailable', ''];
  // upkeep parts: name, the id's words, and the hours a part lasts for a sensor that counts time left
  var PARTS = [['Main Brush', /main_brush/, 300], ['Side Brush', /side_brush/, 200], ['Filter', /(^|_)filter/, 150], ['Mop Pad', /(^|_)mop(_pad)?(_|$)|(^|_)rag(_|$)/, 0],
               ['Sensors', /sensor_(dirty|cleaning)|(^|_)sensors?_(time|life|left)/, 30]];
  var SIB = new WeakMap();
  // the sensors on the vacuum's own device (the registry, once per registry object)
  /** @param {any} client @param {string} vid */
  function siblings(client, vid) {
    var ents = client && client.entities;
    if (!ents) return [];
    var m = SIB.get(ents);
    if (!m) SIB.set(ents, m = {});
    if (m[vid]) return m[vid];
    var dev = ents[vid] && ents[vid].device_id, out = /** @type {string[]} */ ([]);
    if (dev) Object.keys(ents).forEach(function (k) { if (k !== vid && ents[k] && ents[k].device_id === dev && /^(sensor|number)\./.test(k)) out.push(k); });
    return (m[vid] = out.sort());
  }
  /** @param {string[]} ids @param {RegExp} re @param {RegExp} [not] */
  function pickId(ids, re, not) { return ids.filter(function (k) { return re.test(k) && !(not && not.test(k)); })[0] || null; }

  class HvVacuums extends H.Page {
    constructor() {
      super();
      this._sel = /** @type {any} */ ({}); this._offer = null; this._cover = null; this._asked = false; this._note = null; this._busy = false;
    }
    static get CSS() { return H.CSS + (CARE || (CARE = careCss())) + (window.hkVacuumArt ? window.hkVacuumArt.CSS : ''); }
    connectedCallback() { super.connectedCallback(); this._subscribe(); }
    disconnectedCallback() {
      clearTimeout(this._noteT);
      var close = this._areaSub; this._areaSub = null;
      if (typeof close === 'function') close();
      super.disconnectedCallback();
    }
    // Clean Areas' rooms, live (the picker's own subscription), and each vacuum's reach, once
    _subscribe() {
      var c = this.client;
      if (!c || !this.isConnected) return;
      var self = this, conn = c.subscriptions, sub = window.hkSettings && window.hkSettings.subscribe;
      if (!this._areaSub && conn && typeof conn.subscribeMessage === 'function' && typeof sub === 'function') {
        this._areaSub = sub(conn, { type: 'hk_clean_areas/subscribe' }, function (/** @type {any} */ ev) { self._offer = ev || { configured: false, areas: [] }; self.redraw(); }, 'hk-hv-vacuums');
      }
      if (!this._asked && typeof c.callWS === 'function') {
        this._asked = true;
        try {
          Promise.resolve(c.callWS({ type: 'hk_clean_areas/coverage' })).then(function (/** @type {any} */ r) {
            var m = /** @type {any} */ ({});
            ((r && r.coverage) || []).forEach(function (/** @type {any} */ x) { if (x && x.vacuum && Array.isArray(x.areas) && x.areas.length) m[x.vacuum] = x.areas; });
            self._cover = m; self.redraw();
          }, function () { self._cover = {}; });
        } catch (e) { this._cover = {}; }
      }
    }
    // the rooms this vacuum can be sent to, floor by floor then by name: null while Clean Areas has not answered, [] when there are none
    /** @param {string} vid */
    _rooms(vid) {
      var o = this._offer, c = this.client;
      if (!c) return null;
      var script = C.setting && C.setting('features.vacuum_script'), A = c.areas || {}, FL = c.floors || {};
      if (!o) return script ? Object.keys(A).map(function (id) { return { id: id, name: A[id].name || id, lv: 0 }; }) : null;
      var ids = (o.missing || o.configured === false) && script ? Object.keys(A) : (o.areas || []);
      var cover = this._cover && this._cover[vid];
      if (cover) ids = ids.filter(function (/** @type {string} */ id) { return cover.indexOf(id) >= 0; });
      var lv = function (/** @type {string} */ id) { var f = FL[(A[id] || {}).floor_id]; return f && typeof f.level === 'number' ? f.level : 1e9; };
      return ids.filter(function (/** @type {string} */ id) { return A[id]; }).map(function (/** @type {string} */ id) { return { id: id, name: A[id].name || id, lv: lv(id) }; })
        .sort(function (/** @type {any} */ p, /** @type {any} */ q) { return p.lv - q.lv || String(p.name).localeCompare(String(q.name)); });
    }
    // the sensors a vacuum reports its runs and its upkeep with (its own device's), each read through st() so the page is told when one moves
    /** @param {string} vid @param {any} cfg */
    _facts(vid, cfg) {
      var self = this, ids = siblings(this.client, vid), f = /** @type {any} */ ({ parts: [] });
      var last = H.cardOf(this.h, 'hk-vacuum-last-card'), vr = ((last && last.vacuums) || []).filter(function (/** @type {any} */ x) { return x.entity === vid; })[0] || {};
      var ts = pickId(ids, /last_(clean|run|mission)(_(end|finish\w*))?$/, /duration|area|count|start/) || pickId(ids, /last_(clean|run|mission)\w*_(end|finish\w*)$/);
      var tst = ts ? this.st(ts) : null, t = tst ? Date.parse(tst.state) : NaN;
      if (isFinite(t)) f.at = t;
      var dr = pickId(ids, /(^|_)(last_)?clean(ing)?_(duration|time)$/, /total|count/), ar = pickId(ids, /(^|_)(last_)?clean(ing|ed)?_area$/, /total/);
      var dst = dr ? this.st(dr) : null, ast = ar ? this.st(ar) : null;
      if (dst && num(dst.state) != null) {
        var u = String((dst.attributes || {}).unit_of_measurement || 'min').toLowerCase(), n = /** @type {number} */ (num(dst.state));
        var mins = /^(s|sec|seconds?)$/.test(u) ? n / 60 : /^(h|hr|hours?)$/.test(u) ? n * 60 : n;
        if (mins >= 1) f.dur = words(Math.round(mins) * 60);
      }
      if (ast && num(ast.state) != null && /** @type {number} */ (num(ast.state)) > 0) {
        var au = String((ast.attributes || {}).unit_of_measurement || '').replace('ft²', 'sq ft').replace('m²', 'm²');
        f.area = Math.round(/** @type {number} */ (num(ast.state))).toLocaleString() + (au ? ' ' + au : '');
      }
      // the runs counted: completed, failed, canceled (the page's counter sensors)
      f.counts = [['Completed', vr.success], ['Failed', vr.failed], ['Canceled', vr.canceled]].map(function (/** @type {any} */ p) {
        var st = p[1] ? self.st(p[1]) : null, n = st ? num(st.state) : null;
        return n == null ? null : [p[0], Math.round(n)];
      }).filter(Boolean);
      var tot = pickId(ids, /total_(clean(ing)?_)?(count|cleans|runs)|cleaning_count|clean_count/), tt = tot ? this.st(tot) : null;
      if (tt && num(tt.state) != null) f.total = Math.round(/** @type {number} */ (num(tt.state)));
      // upkeep: a part's percentage left, or its time left against the hours it lasts
      PARTS.forEach(function (/** @type {any} */ p) {
        var cands = ids.filter(function (/** @type {string} */ k) { return p[1].test(k) && /(left|life|remain|lifespan)/.test(k) && !/reset|total/.test(k); }), pct = null;
        cands.forEach(function (/** @type {string} */ k) {
          var st = self.st(k), n = st ? num(st.state) : null;
          if (n == null) return;
          var u = String((st.attributes || {}).unit_of_measurement || '').toLowerCase();
          if (u === '%') { pct = n; return; }
          if (pct != null || !p[2]) return;
          var hrs = /^(h|hr|hours?)$/.test(u) ? n : /^(min|minutes?)$/.test(u) ? n / 60 : /^(s|sec|seconds?)$/.test(u) ? n / 3600 : /^(d|days?)$/.test(u) ? n * 24 : null;
          if (hrs != null) pct = hrs / p[2] * 100;
        });
        if (pct != null) f.parts.push({ name: p[0], pct: Math.max(0, Math.min(100, Math.round(pct))) });
      });
      return f;
    }
    draw() {
      var self = this, cfgs = H.cardsOf(this.h, 'hk-vacuum-card').filter(function (/** @type {any} */ c) { return c.entity; });
      this._subscribe();
      var Art = window.hkVacuumArt, multi = cfgs.length > 1;
      var title = (this._config || {}).title || 'Vacuums';
      if (!cfgs.length) return H.head({ title: title, sum: 'None' }) + '<div class="pl pad quiet">No vacuums on this screen. Add them in ' + H.esc(H.where('Accessories')) + '.</div>';
      var views = cfgs.map(function (/** @type {any} */ c) { return self._look(c, Art); });
      var cleaning = views.filter(function (/** @type {any} */ w) { return w.state === 'cleaning'; }).length, attn = views.filter(function (/** @type {any} */ w) { return w.warn; }).length;
      var sum = !multi ? esc(views[0].word) + (views[0].bat != null ? ' · ' + (views[0].bat <= 20 ? '<span class="warn">' + views[0].bat + '%</span>' : views[0].bat + '%') : '')
        : '<b>' + views.length + ' Vacuums</b>' + (cleaning ? ' · ' + cleaning + ' Cleaning' : '') +
          (attn ? ' · <span class="warn">' + attn + ' Need' + (attn === 1 ? 's' : '') + ' Help</span>' : '');
      var out = H.head({ title: title, sum: sum });
      views.forEach(function (/** @type {any} */ w, /** @type {number} */ i) { out += self._section(w, multi, i); });
      return out;
    }
    // what a vacuum is doing, in the words and numbers the page draws (everything read through st())
    /** @param {any} cfg @param {any} Art */
    _look(cfg, Art) {
      var id = cfg.entity, st = this.st(id), a = (st && st.attributes) || {}, self = this;
      var art = Art ? Art.ids(this.client, id, cfg) : {};
      [cfg.battery, cfg.room, cfg.progress, cfg.error, cfg.dock_error, art.error, art.charge, art.latch].forEach(function (/** @type {any} */ k) { if (k) self.st(k); });
      var lk = Art ? Art.look(this.client, id, cfg) : { state: 'idle', words: H.sentence(st ? st.state : '') };
      var state = st ? st.state : 'unknown', gone = !st || state === 'unavailable' || state === 'unknown';
      var bst = cfg.battery ? this.st(cfg.battery) : null, bat = bst ? num(bst.state) : num(a.battery_level);
      var errs = [cfg.error, cfg.dock_error].map(function (/** @type {any} */ k) { return k && self.st(k) ? String(self.st(k).state) : ''; })
        .filter(function (/** @type {string} */ e) { return VAC_OK.indexOf(e.toLowerCase()) < 0; });
      var live = state === 'cleaning' || state === 'returning';
      var room = live && cfg.room ? String((this.st(cfg.room) || {}).state || '') : '', prog = live && cfg.progress ? num((this.st(cfg.progress) || {}).state) : null;
      var f = this._facts(id, cfg), f0 = typeof a.supported_features === 'number' ? a.supported_features : 0;
      return { id: id, cfg: cfg, st: st, name: String(cfg.name || nameOf(st, id)).replace(/\s*(robot\s*)?vacuum$/i, '') || nameOf(st, id), state: state, lk: lk, gone: gone,
               word: gone ? 'Unavailable' : VAC_WORDS[state] || H.sentence(state), bat: bat == null ? null : Math.round(bat),
               errs: errs, room: room && room !== 'unknown' && room !== 'unavailable' ? room : '', prog: prog != null && prog > 0 ? Math.round(prog) : null, facts: f, flags: f0,
               warn: lk.state === 'water' || lk.state === 'error' || errs.length > 0 || state === 'error', charging: lk.state === 'charging' };
    }
    /** @param {any} w @param {boolean} multi @param {number} i */
    _section(w, multi, i) {
      var f = w.facts, out = '';
      if (multi) out += H.section(w.name, esc(w.word) + (w.bat != null ? ' · ' + w.bat + '%' : ''));
      else if (i) out += H.section(w.name);
      // THE ROBOT'S PLATE
      var Art = window.hkVacuumArt, draw = Art ? Art.html(w.lk.state, w.name + ', ' + w.lk.words, w.lk.doing) : H.glyph('hk:robot-vacuum', 64, H.hue('mint'));
      var lastWhen = f.at ? 'Last clean ' + dayClock(f.at) + (f.dur ? ' · ' + f.dur : '') : '';
      var line = w.gone ? 'No response' : w.state === 'cleaning' || w.state === 'returning' ? [w.room, w.prog != null ? w.prog + '% done' : ''].filter(Boolean).join(' · ') ||
        (w.state === 'returning' ? 'Heading to its dock' : 'On its way')
        : lastWhen || (w.st ? 'Since ' + dayClock(since(w.st)) : '');
      var pills = '';
      if (w.bat != null) pills += '<span class="vp' + (w.bat <= 20 ? ' low' : '') + '">' + H.glyph(w.charging ? 'hk:battery-charging' : 'mdi:battery', 14) + w.bat + '%' +
        (w.charging ? ' Charging' : '') + '</span>';
      if (w.lk.state === 'water') pills += '<span class="vp warn">' + H.glyph('mdi:water-off', 14) + esc(w.lk.words) + '</span>';
      w.errs.forEach(function (/** @type {string} */ e) { pills += '<span class="vp err">' + esc(H.sentence(e)) + '</span>'; });
      if (w.lk.state === 'error' && !w.errs.length) pills += '<span class="vp err">Needs Help</span>';
      if (w.lk.latched) pills += H.cap({ cls: '', t: 'Clear', act: 'vclear', data: { v: w.id }, style: 'height:' + P(30) + ';padding:0 ' + P(12) + ';font-size:' + P(13) });
      // the commands the vacuum can take now
      var can = function (/** @type {number} */ bit) { return !w.gone && (!w.flags || !!(w.flags & bit)); }, cmds = '';
      if (w.state === 'cleaning') {
        cmds = (can(VF.PAUSE) ? H.cap({ cls: 'lg', g: H.glyph('mdi:pause', 18), t: 'Pause', act: 'vsvc', data: { v: w.id, s: 'pause' } }) : '') +
          (can(VF.RETURN_HOME) ? H.cap({ cls: 'lg', g: H.glyph('mdi:home-import-outline', 18), t: 'Dock', act: 'vsvc', data: { v: w.id, s: 'return_to_base' } }) : '');
      } else if (w.state === 'paused') {
        cmds = (can(VF.START) ? H.cap({ cls: 'lg w', g: H.glyph('mdi:play', 18), t: 'Resume', act: 'vsvc', data: { v: w.id, s: 'start' } }) : '') +
          (can(VF.RETURN_HOME) ? H.cap({ cls: 'lg', g: H.glyph('mdi:home-import-outline', 18), t: 'Dock', act: 'vsvc', data: { v: w.id, s: 'return_to_base' } }) : '');
      } else if (w.state === 'returning') {
        cmds = can(VF.PAUSE) ? H.cap({ cls: 'lg', g: H.glyph('mdi:pause', 18), t: 'Pause', act: 'vsvc', data: { v: w.id, s: 'pause' } }) : '';
      } else if (can(VF.START)) {
        cmds = H.cap({ cls: 'lg', g: H.glyph('hk:robot-vacuum', 18, rest(TEAL)), t: 'Clean Everywhere', act: 'vsvc', data: { v: w.id, s: 'start' } });
      }
      out += '<div class="sec2"><div class="pl vh"><button class="hero" data-act="sheet" data-id="' + esc(w.id) + '" aria-label="' + esc(w.name + ', ' + w.word) + '">' + draw +
        '<div class="big">' + esc(w.word) + '</div><div class="line">' + esc(line) + '</div></button>' + (pills ? '<div class="pills">' + pills + '</div>' : '') +
        (cmds ? '<div class="vcmds">' + cmds + '</div>' : '') + '</div>' + this._picker(w) + '</div>';

      // HISTORY: what the vacuum's own sensors say of its runs (a house whose vacuum says none gets its last change, said so)
      var rows = [];
      if (f.at || f.dur || f.area) {
        rows.push(H.row({ icon: 'hk:robot-vacuum', color: rest(H.hue('mint')), name: 'Last Clean', sub: [f.at ? dayClock(f.at) : '', f.dur].filter(Boolean).join(' · '), val: f.area ? esc(f.area) :
          '' }));
      }
      f.counts.forEach(function (/** @type {any} */ c) { rows.push(H.row({ icon: 'hk:robot-vacuum', color: rest(H.hue('mint')), name: c[0] + ' Cleans', val: String(c[1]) })); });
      if (f.total != null) rows.push(H.row({ icon: 'hk:robot-vacuum', color: rest(H.hue('mint')), name: 'Cleans in All', val: String(f.total) }));
      var ran = rows.length > 0;
      if (w.st && !w.gone) rows.push(H.row({ icon: 'hk:robot-vacuum', color: undefined, name: w.word, sub: 'Since ' + dayClock(since(w.st)), val: w.bat != null ? w.bat + '%' : '' }));
      out += H.section('History', multi ? esc(w.name) : '') + '<div class="pl list c4"><div class="rows">' + rows.join('') + '</div>' +
        (ran ? '' : '<div class="foot">This vacuum does not report its past cleans.</div>') + '</div>';

      // MAINTENANCE: the parts' life left; amber under 20 %
      if (f.parts.length) {
        out += H.section('Maintenance', multi ? esc(w.name) : '') + '<div class="pl sl">' + f.parts.map(function (/** @type {any} */ p) {
          return '<div class="mt' + (p.pct < 20 ? ' low' : '') + '"><div class="nm">' + esc(p.name) + '</div><div class="bar"><i style="width:' + p.pct + '%"></i></div><div class="pc">' + p.pct +
            '%</div></div>';
        }).join('') + '</div>';
      }
      return out;
    }
    // THE ROOMS PLATE: the rooms to tick and the one key that sends them (the page's picker's rules)
    /** @param {any} w */
    _picker(w) {
      var rooms = this._rooms(w.id), sel = this._sel[w.id] || (this._sel[w.id] = new Set()), svcs = this.client && this.client.services;
      var script = C.setting && C.setting('features.vacuum_script'), ca = !!(C.added && C.added('clean_areas'));
      var can = !!script || ca || !!(svcs && svcs.vacuum && svcs.vacuum.clean_area);
      var note = this._note && this._note.v === w.id ? this._note : null;
      if (!can || (rooms && !rooms.length)) {
        return '<div class="pl vr"><div class="lbl">Clean Rooms</div><div class="empty">' + H.glyph('hk:robot-vacuum', 40, 'rgba(255,255,255,.5)') + '<div class="hl">' +
          (can ? 'No Rooms Offered' : 'Rooms Are Not Set Up') + '</div><div class="st" style="white-space:normal">' +
          (can ? 'This vacuum has no mapped rooms yet.' : 'Set up Clean Areas in ' + H.esc(H.where('Accessories → Vacuums')) + ' to clean by room.') + '</div></div></div>';
      }
      if (!rooms) return '<div class="pl vr"><div class="lbl">Clean Rooms</div><div class="empty"><div class="st">Loading rooms…</div></div></div>';
      var n = 0;
      var pills = rooms.map(function (/** @type {any} */ r) {
        var on = sel.has(r.id); if (on) n++;
        return '<button class="rm' + (on ? ' sel' : '') + '" data-act="vroom" data-v="' + esc(w.id) + '" data-a="' + esc(r.id) + '" aria-pressed="' + on + '"><span class="ck">' + H.svg('check', 11) +
          '</span><span class="t">' + esc(r.name) + '</span></button>';
      }).join('');
      var go = H.cap({ cls: 'lg ' + (n ? 'w' : ''), g: n ? H.glyph('mdi:play', 18) : '', t: n ? 'Clean ' + n + (n === 1 ? ' Room' : ' Rooms') : 'Choose Rooms', act: 'vgo', data: { v: w.id },
        off: !n || this._busy || w.gone });
      var wide = rooms.some(function (/** @type {any} */ r) { return String(r.name).length > 8; });
      return '<div class="pl vr"><div class="lbl">Clean Rooms</div><div class="rooms' + (wide ? ' one' : '') + '">' + pills + '</div><div class="go"><div class="why' +
        (note && note.bad ? ' bad' : '') + '">' +
        esc(note ? note.text : '') + '</div>' + go + '</div></div>';
    }
    /** @param {string} v @param {string} text @param {boolean} [bad] */
    _say(v, text, bad) {
      var self = this;
      this._note = { v: v, text: text, bad: !!bad }; clearTimeout(this._noteT);
      this._noteT = setTimeout(function () { self._note = null; self.redraw(); }, 4000);
      this.redraw();
    }
    // SEND THE ROOMS, as the picker does: this vacuum alone where Home Assistant maps its rooms, else the house's script, else Clean Areas
    /** @param {string} vid */
    _clean(vid) {
      var self = this, sel = this._sel[vid], c = this.client;
      if (!sel || !sel.size || !c || this._busy) return;
      var areas = Array.from(sel), svcs = c.services, script = C.setting && C.setting('features.vacuum_script'), ca = !!(C.added && C.added('clean_areas'));
      var sent = function () { sel.clear(); self._busy = false; self._say(vid, areas.length === 1 ? 'Sent 1 room to clean.' : 'Sent ' + areas.length + ' rooms to clean.'); };
      var fail = function (/** @type {string} */ m) { self._busy = false; self._say(vid, m || 'Could not start. Tap to try again.', true); };
      this._busy = true; this.redraw();
      if (ca && svcs && svcs.vacuum && svcs.vacuum.clean_area && svcs.hk_frontend) {
        this._call('vacuum', 'clean_area', { entity_id: vid, cleaning_area_id: areas }).then(function (/** @type {boolean} */ ok) { if (ok) sent(); else fail(''); });
      } else if (script) {
        this._call('script', 'turn_on', { entity_id: script, variables: { areas: areas } }).then(function (/** @type {boolean} */ ok) { if (ok) sent(); else fail(''); });
      } else if (ca) {
        this._callResp('hk_frontend', 'clean_areas', { areas: areas }).then(function (/** @type {any} */ res) {
          var r = (res && res.response) || {};
          if (res.ok && r.ok) sent(); else fail(r.message || '');
        });
      } else fail('Set up Clean Areas in ' + H.esc(H.where('Accessories → Vacuums')) + ' to clean by room.');
    }
    /** @param {string} name @param {any} el */
    act(name, el) {
      var v = el.getAttribute('data-v') || '';
      if (name === 'vsvc') { this._call('vacuum', el.getAttribute('data-s') || 'start', { entity_id: v }); return true; }
      if (name === 'vclear') { this._call('script', 'vacuum_water_clear', { vacuum: v }); return true; }
      if (name === 'vroom') {
        var sel = this._sel[v] || (this._sel[v] = new Set()), a = el.getAttribute('data-a') || '';
        if (sel.has(a)) sel.delete(a); else sel.add(a);
        this.redraw();
        return true;
      }
      if (name === 'vgo') { this._clean(v); return true; }
      return false;
    }
  }
  H.register('hk-hv-vacuums-card', HvVacuums, 'HK HomeView Vacuums', 'The Vacuums page on an Apple HomeView: each robot with its rooms to clean, its history and its upkeep.');

  Object.assign(window.hkHvCare, { Security: HvSecurity, Timers: HvTimers, Vacuums: HvVacuums });
  });
})();
