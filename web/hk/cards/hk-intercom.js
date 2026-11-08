// @ts-check
// hk-intercom.js -- the Intercom: speak into the HomePods from a tablet, a phone or an iPad
// (docs/phase17/INTERCOM.md; the wire and the feed: the phase's build spec).
//
//   hk-intercom-card        `intercom` (S, W): a Home Grid block. A button that opens the sheet; Wide also shows the
//                           last rooms picked, as chips.
//   hk-intercom-sheet-card  the sheet's body, in a detail sheet (hkDetail.open, {cards}): opened by the block, by a
//                           `#intercom` address (the apps' menu button loads it), and by hkIntercom.open().
//
// TWO MODES, ONE SHEET. MESSAGE: tap to record, tap to stop, then Play, Re-record, Cancel or Send. LIVE: hold the
// microphone, or tap to start and tap to stop, and idle rooms hear it as you speak. Live is drawn only when the feed
// says `live_allowed` (and the person is not on the tunnel door); until Mantel's side of it is proven it is hidden.
//
// ROOMS come from the feed (client.intercom: the rooms this person may reach, and how each would play right now),
// never from the Music page: the selection is the card's own Set and it never touches the music focus. A pill carries
// a glyph for what will happen to it: a waveform (live now), a clock (after you finish), a moon (quiet hours), a person
// (you are here: left out of Live); a room that leads others says so in a muted second line ("Plays with Office"), and one
// that is unavailable says so. Tapping a skipped pill says why, in one line. The groups (Whole House, a chip for each floor,
// each preset dashed as the speaker picker's -- none that is another group's rooms under a new name) fill the Set. The mode and the rooms are kept per person (user_data key `intercom`).
//
// THE PAGE KEEPS ITS OWN COPY of what it recorded (hk-mic.js) for Play, Send Again and the rescue when the socket drops.
//
// COSTS NOTHING WHERE IT IS NOT USED (2026-11-04). On Mantel this file is a lazy card file (mantel_server/hk_cards.py): a
// page that draws neither the block nor the sheet never loads it. What reaches for it: the block (a Home Grid page),
// `#intercom` on the address (a small stub in hk-loader.js imports it, on any page), and a wall tablet that listens (the
// shim, web/shim/mantel-client.js: it asks the feed once, and calls hkIntercom.listen() when the snapshot says `listener`).
// The microphone module (hk-mic.js) is imported by the sheet when it opens, not by every page. In Home Assistant every
// card file is a resource, so this one is loaded as before; nothing subscribes there (no feed).
//
// WHERE THINGS LIVE. Everything the sheet decides is the Controller (below the header, no DOM): it is given its
// surroundings (the action port, the feed, the microphone session, the clock) and is tested on its own in node
// (tests/test_intercom_card.py). The elements only draw what it says (`view()`) and tell it what was touched.
//
// TOUCH. The owner's main device is an iPad in Safari: pointer events with pointercancel, no hover states, 44 pt
// targets, the AudioContext made and resumed inside the press (hk-mic.js unlock), touch-action:none on the microphone.
(function () {
  'use strict';
  if (window.hkIntercom) return;

  var KEY = 'intercom';                      // the user_data key
  var MODES = ['message', 'live'];
  var ROOMS_MAX = 64;                        // user_data.py INTERCOM_ROOMS_MAX
  var MIN_S = 0.6;                           // shorter than this is a tap, not a message
  var HOLD_MS = 450;                         // Live: a press shorter than this was a tap, not a talk: "Hold to talk"
  var NO_AUDIO_MS = 3000;                    // Recording with nothing captured for this long: the audio is not running (a suspended context)
  var RATES = [16000, 22050, 24000, 32000, 44100, 48000];    // the sample rates the gateway accepts a ticket for (gateway.INTERCOM_RATES)
  var SAID_MS = 4500;                        // how long an explanation stays in the status line
  var SENT_MS = 8000;                        // "Sent to 9 rooms" and its Play / Send Again, then Tap to Talk alone (2026-11-05)
  var SAVE_MS = 600;                         // the rooms are saved this long after the last change
  var LAST = 'hk-intercom';                  // localStorage: the last mode and rooms, for the first paint
  var ONE_WAY = 'hk-intercom-oneway';        // localStorage: the one-way note has been shown

  // THE STATUS LINE'S WORDS (the build spec's "The sheet's words")
  var WORDS = {
    connecting: 'Connecting…',
    recording: 'Recording',
    sending: 'Sending…',
    https: 'Needs HTTPS: open this page by its https:// address',
    needsHost: 'Intercom needs Mantel',
    off: 'Intercom is off',
    oneWay: 'One-way: the rooms can’t answer',
    chooseRooms: 'Choose rooms to send to',
    // THE MICROPHONE, by what is really wrong (the owner, 2026-11-04: "No microphone" on Safari on a Mac over https, said for
    // every cause): refused by the person or the browser, none on this device, the module that records not loaded, or the
    // browser unable to start the audio
    noMic: 'No microphone on this device',
    micDenied: 'Microphone blocked — allow it for this site in your browser’s settings',
    micDeniedSafari: 'Microphone blocked — allow it for this site in Safari Settings → Websites → Microphone',
    micBusy: 'Another app is using the microphone',
    micLoad: 'Couldn’t load the microphone — reload the page',
    micStart: 'This browser couldn’t start recording',
    tooShort: 'Too short. Tap, speak, tap again',
    holdToTalk: 'Hold the button while you talk',
    lost: 'The connection dropped. Send Again',
    commandsOff: 'Turn on Allow Control of the House to use the Intercom',
    forbidden: 'You can’t use the Intercom',
    unreachable: 'Can’t reach ',
    tapAgain: 'Tap the microphone again',
    pickRoom: 'Pick a room first'
  };
  // WHY THE GATEWAY SAID NO, in words. It answers {code: 'unavailable', message: <reason>} (or the reason as the code):
  // none of these is mended by trying again, so the recording ends and the sheet says which it was.
  var REASONS = {
    commands_disabled: WORDS.commandsOff,
    forbidden: WORDS.forbidden,
    intercom_off: WORDS.off,
    intercom_no_address: 'The Intercom isn’t set up yet (Settings → Intercom)',
    intercom_not_listening: 'The Intercom isn’t listening yet (Settings → Intercom)',
    music_assistant_off: 'Music Assistant isn’t connected',
    live_off: 'Live isn’t on',
    live_not_away: 'Live works only at home. Send a message instead'
  };
  function reasonOf(code, err) {
    var c = [code, err && err.message, err && err.reason];
    for (var i = 0; i < c.length; i++) if (typeof c[i] === 'string' && Object.prototype.hasOwnProperty.call(REASONS, c[i])) return c[i];
    return null;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function num(v, fallback) { var n = Number(v); return v === null || v === '' || !isFinite(n) ? fallback : n; }
  function names(list, max) {
    var shown = list.slice(0, max || 2), more = list.length - shown.length;
    return shown.join(', ') + (more > 0 ? ' +' + more : '');
  }
  // "Kitchen leads Office; skipped" -> "Kitchen leads Office"
  function plain(reason) { return String(reason || '').replace(/;\s*skipped\.?$/i, '').replace(/\.$/, ''); }

  // ------------------------------------------------------------------ the feed, as the sheet reads it
  // {enabled, live_allowed, away, default_mode, max_live_s, max_message_s, lag_ms, can_override, here, rooms, floors, presets}
  function normalize(e) {
    if (!e || typeof e !== 'object') return null;
    var list = function (v) { return Array.isArray(v) ? v : []; };
    return {
      enabled: e.enabled !== false,
      away: !!e.away,
      live_allowed: !!e.live_allowed && !e.away,
      default_mode: e.default_mode === 'live' ? 'live' : 'message',
      max_live_s: num(e.max_live_s, 60), max_message_s: num(e.max_message_s, 30),
      lag_ms: e.lag_ms == null ? null : num(e.lag_ms, null),
      can_override: !!e.can_override,
      here: list(e.here).filter(function (x) { return typeof x === 'string'; }),
      rooms: list(e.rooms).filter(function (r) { return r && typeof r.room === 'string'; }).map(function (r) {
        return { room: r.room, name: String(r.name || r.room), floor: r.floor || null,
                 state: r.state === 'skipped' || r.state === 'after' ? r.state : 'ok', live: !!r.live,
                 why: r.why || null, reason: r.reason || '' };
      }),
      floors: list(e.floors).filter(function (f) { return f && Array.isArray(f.rooms); }).map(function (f) { return { id: String(f.id), name: String(f.name || f.id), rooms: f.rooms.slice() }; }),
      presets: list(e.presets).filter(function (p) { return p && Array.isArray(p.rooms); }).map(function (p) { return { id: String(p.id), name: String(p.name || p.id), rooms: p.rooms.slice() }; }),
      listener: !!e.listener, play: e.play || null
    };
  }

  // ONE PILL PER ROOM: what it shows and whether a tap can pick it.
  //   glyph    waveform | clock | moon | person | null: what will happen to it (live now, after you finish, quiet hours, you are here)
  //   cap      a short muted second line under the name, for what a glyph can't say: "Plays with Office" (a room that leads
  //            others plays only together with them), "Quiet hours", "Unavailable"
  //   pickable a tap toggles it; otherwise a tap says why (`line`). A room on quiet hours is pickable for someone who
  //            may Send Anyway: the server skips it at Send, and Send Anyway asks again for it.
  function pillsOf(feed, mode) {
    if (!feed) return [];
    var here = {};
    feed.here.forEach(function (id) { here[id] = 1; });
    // "Dining Room plays only together with Office" / "Dining Room leads Office; skipped" -> "Plays with Office" / "Plays with Dining Room"
    // (one name, then "+N": a whole house in a group must not run past the pill)
    var withWho = function (r) {
      var t = plain(r.reason), m = /together with (.+)$/i.exec(t) || /^(.+?) leads /i.exec(t);
      if (!m) return 'Plays with others';
      var names = m[1].split(/, | and /).filter(Boolean);
      return 'Plays with ' + names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '');
    };
    return feed.rooms.map(function (r) {
      var o = { id: r.room, name: r.name, floor: r.floor, glyph: null, cap: '', pickable: true, quiet: false, note: false, line: '', aria: r.name };
      if (r.state !== 'skipped' && r.why === 'leads') {
        // A GROUP LEADER: it plays only together with the rooms it leads ("Kitchen plays only together with Office"). The pill
        // says so in its second line; it can be picked, the server decides at Send, and a tap says why.
        o.note = true; o.cap = withWho(r);
        var lead = plain(r.reason) || 'it plays only together with other rooms';
        o.line = lead.toLowerCase().indexOf(r.name.toLowerCase()) >= 0 ? lead : r.name + ': ' + lead;
        if (mode === 'live' && here[r.room]) { o.glyph = 'person'; o.cap = ''; o.note = false; o.pickable = false; o.line = r.name + ': you’re here, so it’s left out of Live'; }
      } else if (r.state === 'skipped') {
        var why = plain(r.reason) || (r.why === 'quiet' ? 'quiet hours' : r.why === 'leads' ? 'it leads other rooms’ music' : 'it is unavailable');
        o.line = why.toLowerCase().indexOf(r.name.toLowerCase()) >= 0 ? why : r.name + ': ' + why;
        if (r.why === 'quiet') { o.glyph = 'moon'; o.cap = 'Quiet hours'; }
        else o.cap = r.why === 'leads' ? withWho(r) : 'Unavailable';
        if (r.why === 'quiet' && feed.can_override) { o.quiet = true; o.line += '. Send Anyway to include it'; }
        else o.pickable = false;
      } else if (mode === 'live') {
        if (here[r.room]) {
          o.glyph = 'person'; o.pickable = false;
          o.line = r.name + ': you’re here, so it’s left out of Live';
        } else o.glyph = r.live ? 'waveform' : 'clock';
      }
      o.aria = r.name + (o.glyph === 'moon' ? ', quiet hours' : o.note ? ', plays only together with other rooms' : o.glyph === 'person' ? ', you are here'
        : !o.pickable ? ', skipped' : o.glyph === 'waveform' ? ', live' : o.glyph === 'clock' ? ', after you finish' : '');
      return o;
    });
  }

  // THE CHIPS: Whole House, a chip for each floor, then each preset -- each over the rooms a tap can pick. A chip is on when
  // it is what is chosen: Whole House and a floor when all of their rooms are, a preset when exactly its rooms are.
  // ONE CHIP PER SET OF ROOMS: a floor or a preset with exactly the rooms of Whole House or of an earlier chip is the same
  // target under another name and is left out (the server leaves them out of the feed too; this keeps an older one honest).
  function chipsOf(pills, feed, sel) {
    if (!feed) return [];
    var ok = {}, chosen = {};
    pills.forEach(function (p) { if (p.pickable) ok[p.id] = 1; });
    sel.forEach(function (id) { if (ok[id]) chosen[id] = 1; });
    var nChosen = Object.keys(chosen).length;
    var pick = function (ids) { var seen = {}; return ids.filter(function (id) { if (!ok[id] || seen[id]) return false; seen[id] = 1; return true; }); };
    var setOf = function (ids) { return ids.slice().sort().join('|'); };
    var all = pick(pills.map(function (p) { return p.id; }));
    var taken = {};
    taken[setOf(feed.rooms.map(function (r) { return r.room; }))] = 1;
    var out = [];
    if (all.length > 1) out.push({ kind: 'house', id: 'house', name: 'Whole House', ids: all, on: all.length === nChosen });
    var fresh = function (rooms) {
      var key = setOf(rooms);
      if (!rooms.length || taken[key]) return false;
      taken[key] = 1;
      return true;
    };
    feed.floors.forEach(function (f) {
      var ids = pick(f.rooms);
      if (ids.length && fresh(f.rooms)) out.push({ kind: 'floor', id: f.id, name: f.name, ids: ids, on: ids.every(function (id) { return chosen[id]; }) });
    });
    feed.presets.forEach(function (p) {
      var ids = pick(p.rooms);
      if (ids.length && fresh(p.rooms)) out.push({ kind: 'preset', id: p.id, name: p.name, ids: ids, on: ids.length === nChosen && ids.every(function (id) { return chosen[id]; }) });
    });
    return out;
  }

  // ------------------------------------------------------------------ the Controller (no DOM)
  // deps: { actions() -> the action port | null, feed() -> the normalized snapshot | null, mic() -> a hk-mic session,
  //   store: {load() -> {mode, rooms}|null, save(v)}, secure() -> bool, supported() -> bool, hasPort() -> bool,
  //   loading() -> bool (optional: the microphone module is on its way, so "supported" is not yet known),
  //   oneWay: {seen() -> bool, mark()}, clock: {now, setTimeout, clearTimeout, setInterval, clearInterval},
  //   changed() -> called after every change the sheet should draw }
  /**
   * What the Controller holds (the methods are the CP.* below; the ones not listed here read as any, as the fields set along the way do).
   * @typedef {{ [member: string]: any, d: any, clock: any, mode: any, sel: string[], state: string, said: any, secs: number, level: number,
   *   sentTo: number, failed: string[], quiet: string[], lag: any, fallback: string[], decision: any, socket: string, draftSent: boolean,
   *   playing: boolean, mic: any, tok: number, timer: any, limit: number, pressAt: number, sendTok: number,
   *   saveT: any, sayT: any, disposed: boolean }} Ctl
   */
  /** @type {Ctl[]} */
  var controllers = [];              // the sheets open (a tablet that is itself talking plays no announcement)
  function talking() {
    return controllers.some(function (c) { return c.state === 'connecting' || c.state === 'recording' || c.state === 'sending'; });
  }
  /** @this {Ctl} @param {any} deps */
  function Controller(deps) {
    this.d = deps;
    controllers.push(this);
    this.clock = deps.clock || { now: function () { return Date.now(); }, setTimeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window),
                                 setInterval: setInterval.bind(window), clearInterval: clearInterval.bind(window) };
    this.mode = null;                  // chosen, or remembered, or the feed's default (modeNow)
    this.sel = [];                     // the rooms picked (kept in the order picked), whether or not reachable now
    this.state = 'idle';               // idle | connecting | recording | review | sending | sent | error
    this.said = null;                  // {text, kind}: the last thing said in the status line (explanations, refusals)
    this.secs = 0; this.level = 0;
    this.sentTo = 0; this.failed = []; this.quiet = [];
    this.lag = null;                   // Live: how far behind the rooms are, ms (the server's lag_ms, else the feed's)
    this.fallback = [];                // Live: the rooms that did not connect live and got a Message
    this.decision = null;              // the server's {rooms} event for this send
    this.socket = 'none';              // none | opening | open
    this.draftSent = false;            // the server finished the draft (it is gone there; the page's copy is all there is)
    this.playing = false;
    this.mic = null; this.tok = 0; this.timer = null; this.limit = 0; this.pressAt = 0; this.sendTok = 0;
    this.saveT = null; this.sayT = null; this.disposed = false;
    var mem = deps.store && deps.store.load ? deps.store.load() : null;
    this._remember(mem);
  }
  /** @type {Ctl} */
  var CP = /** @type {any} */ (Controller.prototype);
  /** @this {Ctl} */ CP._changed = function () { if (!this.disposed && this.d.changed) this.d.changed(); };
  /** @this {Ctl} */ CP._remember = function (mem) {
    if (!mem || typeof mem !== 'object') return;
    if (this.state === 'idle' && !this.touchedMode && MODES.indexOf(mem.mode) >= 0) this.mode = mem.mode;
    if (!this.touchedRooms && Array.isArray(mem.rooms)) {
      this.sel = mem.rooms.filter(function (id, i, a) { return typeof id === 'string' && a.indexOf(id) === i; }).slice(0, ROOMS_MAX);
    }
  };
  // the person's remembered mode and rooms arrived (or changed on another screen): taken until this screen has chosen
  /** @this {Ctl} */ CP.remembered = function (mem) { this._remember(mem); this._changed(); };
  /** @this {Ctl} */ CP.feed = function () { return this.d.feed(); };
  /** @this {Ctl} */ CP.liveAvailable = function () { var f = this.feed(); return !!(f && f.enabled && f.live_allowed); };
  /** @this {Ctl} */ CP.modeNow = function () {
    var f = this.feed(), m = this.mode || (f && f.default_mode) || 'message';
    return m === 'live' && this.liveAvailable() ? 'live' : 'message';
  };
  /** @this {Ctl} */ CP.maxSecs = function () {
    var f = this.feed(), m = this.modeNow();
    return this.limit || (f ? (m === 'live' ? f.max_live_s : f.max_message_s) : 30);
  };
  /** @this {Ctl} */ CP.pills = function () { return pillsOf(this.feed(), this.modeNow()); };
  /** @this {Ctl} */ CP.chips = function () { return chipsOf(this.pills(), this.feed(), this.sel); };
  // the rooms a send would go to: the picked ones a tap can pick (in the feed's order)
  /** @this {Ctl} */ CP.chosen = function () {
    var sel = this.sel;
    return this.pills().filter(function (p) { return p.pickable && sel.indexOf(p.id) >= 0; }).map(function (p) { return p.id; });
  };
  /** @this {Ctl} */ CP._nameOf = function (id) {
    var f = this.feed(), r = f && f.rooms.filter(function (x) { return x.room === id; })[0];
    return r ? r.name : id;
  };
  /** @this {Ctl} */ CP.chosenNames = function () { var self = this; return this.chosen().map(function (id) { return self._nameOf(id); }); };

  // ---- what is said
  /** @this {Ctl} */ CP._say = function (text, kind, ms) {
    var self = this;
    this.said = text ? { text: text, kind: kind || 'info' } : null;
    this.clock.clearTimeout(this.sayT);
    if (text && ms !== 0) this.sayT = this.clock.setTimeout(function () { self.said = null; self._changed(); }, ms || SAID_MS);
    this._changed();
  };
  /** @this {Ctl} */ CP.status = function () {
    var f = this.feed(), s = this.said;
    if (!this.d.hasPort()) return { text: WORDS.needsHost, kind: 'warn' };
    if (!this.d.secure()) return { text: WORDS.https, kind: 'warn' };
    if (f && !f.enabled) return { text: WORDS.off, kind: 'warn' };
    if (s && (this.state === 'idle' || this.state === 'review' || this.state === 'sent' || this.state === 'error')) return s;
    var m = this.modeNow(), names = this.chosenNames();
    switch (this.state) {
      case 'connecting': return { text: WORDS.connecting, kind: 'pending' };
      case 'recording':
        if (m === 'live') {
          var lag = this.lag != null ? this.lag : f && f.lag_ms != null ? f.lag_ms : null;
          return { text: lag != null ? 'Live, about ' + Math.max(1, Math.round(lag / 1000)) + ' s behind you' : 'Live', kind: 'live' };
        }
        return { text: '', kind: 'live' };              // the button says it: its word is the time, its hint the time left
      case 'sending': return this.fallback.length ? { text: this._fallbackLine(), kind: 'info' } : { text: WORDS.sending, kind: 'pending' };
      case 'sent': return this._sentLine();
      case 'review': return names.length ? { text: 'Ready to send to ' + names.join(', '), kind: 'info' } : { text: WORDS.chooseRooms, kind: 'info' };
      case 'error': return { text: WORDS.lost, kind: 'failed' };
    }
    if (!f) return { text: WORDS.connecting, kind: 'pending' };
    if (!this.d.supported()) return { text: this._noRecording(), kind: 'warn' };
    if (!this.d.oneWay.seen()) return { text: WORDS.oneWay, kind: 'info' };
    if (m === 'live') {
      var later = this.pills().filter(function (p) { return p.pickable && p.glyph === 'clock' && this.sel.indexOf(p.id) >= 0; }, this).map(function (p) { return p.name; });
      if (later.length) return { text: later.join(', ') + ': after you finish', kind: 'info' };
    }
    if (!names.length) {
      var gone = this._unreachablePicked();
      return gone ? { text: 'Nothing to send to: ' + gone, kind: 'warn' } : { text: WORDS.chooseRooms, kind: 'info' };
    }
    return { text: names.length > 2 ? plural(names.length, 'room', 'rooms') + ' picked' : names.join(', '), kind: 'info' };
  };
  // why the rooms picked cannot be reached ("Kitchen leads Office"), for "Nothing to send to: ..."
  /** @this {Ctl} */ CP._unreachablePicked = function () {
    var sel = this.sel, why = this.pills().filter(function (p) { return !p.pickable && sel.indexOf(p.id) >= 0 && p.line; }).map(function (p) { return p.line; });
    return why.length ? why.join('; ') : '';
  };
  // Live: the rooms that did not connect live heard it as a Message instead
  /** @this {Ctl} */ CP._fallbackLine = function () { return names(this.fallback, 2) + ' didn’t connect live. Sent as a message.'; };
  /** @this {Ctl} */ CP._sentLine = function () {
    var base = this.sentTo ? 'Sent to ' + plural(this.sentTo, 'room', 'rooms') : 'Nothing was sent', extra = [];
    if (this.failed.length) extra.push(names(this.failed, 2) + (this.failed.length === 1 ? ' didn’t play' : ' didn’t play'));
    if (this.fallback.length) extra.push(this._fallbackLine());
    if (this.quiet.length) extra.push(names(this.quiet.map(this._nameOf, this), 2) + (this.quiet.length === 1 ? ' is on quiet hours' : ' are on quiet hours'));
    var text = extra.reduce(function (t, x) { return t + (/\.$/.test(t) ? ' ' : '. ') + x; }, base);
    return { text: text, kind: this.failed.length || !this.sentTo ? 'warn' : 'sent' };
  };

  // ---- rooms
  /** @this {Ctl} */ CP._persist = function () {
    var self = this;
    this.clock.clearTimeout(this.saveT);
    this.saveT = this.clock.setTimeout(function () { self.saveT = null; self.save(); }, SAVE_MS);
  };
  /** @this {Ctl} */ CP.save = function () {
    this.clock.clearTimeout(this.saveT);
    this.saveT = null;
    if (this.d.store && this.d.store.save) this.d.store.save({ mode: this.modeNow(), rooms: this.sel.slice(0, ROOMS_MAX) });
  };
  /** @this {Ctl} */ CP.setMode = function (m) {
    if (MODES.indexOf(m) < 0 || this.state !== 'idle' && this.state !== 'sent' && this.state !== 'error') return;
    if (m === 'live' && !this.liveAvailable()) return;
    this.mode = m; this.touchedMode = true;
    this.said = null;
    if (this.state !== 'idle') this._discard();
    this.save();
    this._changed();
  };
  /** @this {Ctl} */ CP.toggleRoom = function (id) {
    var p = this.pills().filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!p.pickable) { this._say(p.line, 'info'); return; }
    this.touchedRooms = true;
    var i = this.sel.indexOf(id);
    if (i >= 0) this.sel.splice(i, 1); else if (this.sel.length < ROOMS_MAX) this.sel.push(id);
    this.said = null;
    if (p.note || (p.quiet && i < 0)) this._say(p.line, 'info');
    this._afterPick();
  };
  /** @this {Ctl} */ CP.chip = function (kind, id) {
    var c = this.chips().filter(function (x) { return x.kind === kind && x.id === id; })[0];
    if (!c) return;
    this.touchedRooms = true;
    var sel = this.sel, ids = c.ids;
    if (kind === 'preset') sel = c.on ? [] : ids.slice();
    else if (kind === 'house') sel = c.on ? [] : ids.slice();
    else sel = c.on ? sel.filter(function (x) { return ids.indexOf(x) < 0; }) : sel.concat(ids.filter(function (x) { return sel.indexOf(x) < 0; }));
    this.sel = sel.slice(0, ROOMS_MAX);
    this.said = null;
    this._afterPick();
  };
  /** @this {Ctl} */ CP._afterPick = function () { this._persist(); this._changed(); };
  // CLEAR ALL (2026-11-05, the owner): no room picked
  /** @this {Ctl} */ CP.clearRooms = function () {
    if (!this.sel.length || !(this.state === 'idle' || this.state === 'sent' || this.state === 'error' || this.state === 'review')) return;
    this.sel = []; this.touchedRooms = true;
    this._afterPick();
  };
  // how many of the rooms that can be picked are: "2 of 9"
  /** @this {Ctl} */ CP.count = function () {
    var sel = this.sel, can = this.pills().filter(function (p) { return p.pickable || p.quiet; });
    return { on: can.filter(function (p) { return sel.indexOf(p.id) >= 0; }).length, of: can.length };
  };
  // the feed changed: a state with rooms no longer there is simply read again (chosen() keeps to what can be picked)
  /** @this {Ctl} */ CP.fed = function () { this._changed(); };

  // ---- the microphone
  // Message: one tap starts, the next stops and sends. Live is push to talk: down starts, up ends it (2026-11-05, the owner:
  // "a momentary button, not a toggle"); a tap too short to say anything is let go with "Hold to talk".
  /** @this {Ctl} */ CP.micDown = function () {
    var m = this.modeNow();
    this.pressAt = this.clock.now();
    this.pressState = this.state;
    this.unlock();                                       // inside the press: the AudioContext made and resumed
    if (m === 'live') {
      if (this.state === 'idle' || this.state === 'sent' || this.state === 'error') this._start('live');
    }
  };
  /** @this {Ctl} */ CP.micUp = function () {
    this.unlock();             // again: on an iPad a touch's pointerdown is no user activation, its pointerup (and click) is
    var m = this.modeNow(), held = this.clock.now() - this.pressAt;
    if (m === 'live') {
      if (this.state === 'recording' || this.state === 'connecting') {
        if (held >= HOLD_MS) this._stop();
        else { this._abandon(); this._say(WORDS.holdToTalk, 'info'); }
      }
      return;
    }
    if (this.state === 'recording' || this.state === 'connecting') this._stop();
    else if (this.state === 'idle' || this.state === 'sent' || this.state === 'error') this._start('message');
  };
  // the press was taken away (pointercancel: a system gesture, a call): a held Live talk ends; a Message tap does nothing
  /** @this {Ctl} */ CP.micCancel = function () {
    if (this.modeNow() === 'live' && this.state === 'recording') this._stop();
  };
  /** @this {Ctl} */ CP.unlock = function () { return this.d.supported() && this.d.secure() ? this._unlock() : 0; };
  /** @this {Ctl} */ CP._unlock = function () {
    var mic = this.mic || (this.mic = this.d.mic());
    return mic ? mic.unlock() : 0;
  };
  /** @this {Ctl} */ CP._refusal = function () {
    var f = this.feed();
    if (!this.d.hasPort()) return WORDS.needsHost;
    if (!this.d.secure()) return WORDS.https;
    if (f && !f.enabled) return WORDS.off;
    if (!this.d.supported()) return this._noRecording();
    return null;
  };
  // why this page can't record at all: the module that records never came, or the browser lacks what it needs (a microphone
  // API, an AudioContext, the audio worklet, a Worker)
  /** @this {Ctl} */ CP._noRecording = function () { return this.d.loadFailed && this.d.loadFailed() ? WORDS.micLoad : WORDS.micStart; };
  // a microphone that would not start, by the error's name (getUserMedia's, or the audio's); anything else is logged
  /** @this {Ctl} */ CP._startWords = function (err) {
    var name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return this.d.safari && this.d.safari() ? WORDS.micDeniedSafari : WORDS.micDenied;
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return WORDS.noMic;
    if (name === 'NotReadableError' || name === 'TrackStartError') return WORDS.micBusy;
    if (name === 'Suspended') return WORDS.tapAgain;
    try { console.warn('[hk-intercom] the microphone could not start:', name || '(no name)', err && err.message); } catch (e) { /* no console */ }
    return WORDS.micStart;
  };
  /** @this {Ctl} */ CP._start = function (mode) {
    var why = this._refusal();
    if (why) { this._say(why, 'warn'); return; }
    // Live speaks to the rooms picked, named before the first frame: with none picked there is no one to hear it
    if (mode === 'live' && !this.chosen().length) { this._say(WORDS.pickRoom, 'info'); return; }
    var self = this, mic = this.mic || (this.mic = this.d.mic());
    if (!mic || !mic.unlock()) {
      if (!mic && this.d.loading && this.d.loading()) this._say(WORDS.connecting, 'info');       // the microphone module is still on its way
      else this._say(mic ? WORDS.micStart : this._noRecording(), 'warn');
      return;
    }
    this.d.oneWay.mark();
    this._reset();
    var tok = ++this.tok;
    this.state = 'connecting'; this.said = null; this.mode = mode; this.limit = 0;
    this.socket = 'opening';
    this._wire(mic, tok);
    mic.begin();
    // Live: the server is told who to speak to before the first frame (held for it while the socket signs in)
    if (mode === 'live') { this.liveStarted = true; mic.text({ type: 'start', rooms: this.chosen() }); }
    mic.start().then(function () {
      if (self.tok !== tok || self.disposed || self.state !== 'connecting') return;
      // The microphone is built, so the rate is the AudioContext's own (a browser that would not join the rates built it
      // again at its own): the ticket is asked for with that, and only a rate the gateway accepts.
      if (RATES.indexOf(mic.rate) < 0) { self._badRate(mic.rate); return; }
      mic.rec(true);
      self.state = 'recording'; self.t0 = self.clock.now();
      self._tick();
      self.timer = self.clock.setInterval(function () { self._tick(); }, 100);
      self._changed();
      self._ticket(mode, tok, null);
    }, function (err) {
      if (self.tok !== tok) return;
      self._abandon();
      self._say(self._startWords(err), 'warn', 8000);
    });
    this._changed();
  };
  // the microphone's sample rate is one the Intercom has no ticket for
  /** @this {Ctl} */ CP._badRate = function (rate) {
    this._refused('bad_rate', { message: 'This device’s microphone runs at ' + (rate / 1000) + ' kHz, which the Intercom can’t use' });
  };
  // a ticket for a socket (mode, rate), and the socket opened with it; `upload`: the page's copy to send once signed in
  /** @this {Ctl} */ CP._ticket = function (mode, tok, upload) {
    var self = this, mic = this.mic, act = this.d.actions(), rate = mic.rate;
    if (!act || !act.intercom) { this._refused('commands_disabled'); return Promise.resolve(); }
    if (RATES.indexOf(rate) < 0) { this._badRate(rate); return Promise.resolve(); }
    return Promise.resolve().then(function () { return act.intercom(mode, rate); }).then(function (t) {
      if (self.tok !== tok && self.sendTok !== tok) { return; }
      mic.open(t.url, t.token, upload || null);
    }, function (err) {
      if (self.tok !== tok && self.sendTok !== tok) return;
      self._refused(err && err.code, err);
    });
  };
  // the gateway refused the ticket: said; what cannot be mended by trying again ends the recording
  /** @this {Ctl} */ CP._refused = function (code, err) {
    var SH = window.hkShell, host = SH && SH.productName ? SH.productName() : 'the server';
    var reason = reasonOf(code, err);                // a reason the server gave: said in its own words, and trying again would not help
    var text = reason ? REASONS[reason] : code === 'unavailable' ? WORDS.unreachable + host : (err && err.message) || 'Couldn’t start the Intercom';
    this.socket = 'none';
    if (this.mic) this.mic.noSocket();
    if (!reason && code === 'unavailable' && (this.state === 'recording' || this.state === 'connecting' || this.state === 'review')) {
      this._say(text, 'warn');                     // the page's copy is kept; Send tries again
      return;
    }
    if (this.state === 'sending') { this.state = 'error'; this._say(text, 'failed', 0); return; }
    this._abandon();
    this._say(text, 'warn', 8000);
  };
  /** @this {Ctl} */ CP._wire = function (mic, tok) {
    var self = this;
    mic.on = {
      ready: function (r) { if (self.tok !== tok && self.sendTok !== tok) return; self.socket = 'open'; if (r && r.max_s) self.limit = Math.min(self.limit || r.max_s, r.max_s); self._ready(); },
      event: function (e) { if (self.tok === tok || self.sendTok === tok) self._event(e); },
      closed: function () { if (self.tok === tok || self.sendTok === tok) self._closed(); },
      error: function (e) { if (self.tok === tok || self.sendTok === tok) self._socketError(e); },
      uploaded: function () { if (self.sendTok === tok) self._uploaded(); },
      chunk: function () { /* the meter reads mic.level on the tick */ }
    };
  };
  /** @this {Ctl} */ CP._ready = function () { this._changed(); };
  /** @this {Ctl} */ CP._tick = function () {
    var mic = this.mic;
    if (!mic || this.state !== 'recording') return;
    this.secs = mic.seconds(); this.level = mic.level;
    // Recording, and nothing came in: the audio is not running (a context that went back to suspended, a call). Never sit on a
    // Recording that captures 0 s.
    if (!this.secs && this.clock.now() - this.t0 >= NO_AUDIO_MS) { this._abandon(); this._say(WORDS.tapAgain, 'warn', 8000); return; }
    if (this.secs >= this.maxSecs()) this._stop();
    else this._changed();
  };
  /** @this {Ctl} */ CP._stop = function () {
    var mic = this.mic;
    if (!mic) return;
    if (this.state === 'connecting') { this._abandon(); return; }     // let go before the microphone was open: nothing was kept
    this.clock.clearInterval(this.timer); this.timer = null;
    mic.rec(false);
    this.secs = mic.seconds(); this.level = 0;
    if (this.liveStarted) {
      mic.text({ type: 'end' });
      this.state = 'sending';                      // the server answers {sent}
      this._changed();
      return;
    }
    if (this.secs < MIN_S) {
      mic.text({ type: 'cancel' });
      this._abandon();                       // (a ticket still on its way is no longer wanted)
      this._say(WORDS.tooShort, 'info');
      return;
    }
    // sent as soon as it stops (2026-11-05, the owner: too many steps); with no room picked it waits for one and Send
    if (this.chosen().length) { this._send(this.chosen(), false); return; }
    this.state = 'review';
    this._changed();
  };
  // nothing was kept: the sheet is as before the press
  /** @this {Ctl} */ CP._abandon = function () {
    this.tok++;
    this.clock.clearInterval(this.timer); this.timer = null;
    if (this.mic) { this.mic.rec(false); this.mic.closeSocket(); this.mic.clear(); }
    this.state = 'idle'; this.socket = 'none'; this.secs = 0; this.level = 0; this.liveStarted = false;
    this._changed();
  };
  /** @this {Ctl} */ CP._reset = function () {
    if (this.mic) { this.mic.stopPlay(); this.mic.clear(); }
    this.playing = false; this.sentTo = 0; this.failed = []; this.quiet = []; this.fallback = []; this.decision = null; this.draftSent = false;
    this.secs = 0; this.level = 0; this.lag = null; this.liveStarted = false;
  };
  /** @this {Ctl} */ CP._discard = function () {
    if (this.mic) { this.mic.text({ type: 'cancel' }); this.mic.closeSocket(); this.mic.stopPlay(); this.mic.clear(); }
    this.tok++; this.sendTok++;
    this.state = 'idle'; this.socket = 'none'; this.secs = 0; this.playing = false; this.decision = null; this.sentTo = 0; this.failed = []; this.quiet = []; this.fallback = []; this.draftSent = false;
  };

  // ---- the review
  /** @this {Ctl} */ CP.play = function () {
    var self = this, mic = this.mic;
    if (!mic || !mic.bytes) return;
    if (this.playing) { mic.stopPlay(); this.playing = false; this._changed(); return; }
    this.playing = !!mic.play(function () { self.playing = false; self._changed(); });
    this._changed();
  };
  /** @this {Ctl} */ CP.rerecord = function () {
    if (this.state !== 'review' && this.state !== 'error' && this.state !== 'sent') return;
    var reuse = this.socket === 'open' && !this.draftSent, mic = this.mic;
    if (!reuse) { this._start('message'); return; }
    // the same socket: the draft dropped there, the page's copy too, and the next frames are a new draft
    mic.text({ type: 'cancel' });
    this._reset();
    this.said = null; this.state = 'recording'; this.t0 = this.clock.now(); this.tok++;
    this._wire(mic, this.tok);
    mic.rec(true);
    this.timer = this.clock.setInterval(this._tick.bind(this), 100);
    this._changed();
  };
  /** @this {Ctl} */ CP.cancel = function () {
    this._discard();
    this.said = null;
    this._changed();
  };
  CP.done = CP.cancel;

  // ---- send
  // Send finishes the draft the socket holds; when the socket did not keep up (never opened, dropped, lost frames),
  // or the draft has gone (Send Again, Send Anyway), a new socket gets the page's copy first.
  /** @this {Ctl} */ CP.canSend = function () {
    return (this.state === 'review' || this.state === 'sent' || this.state === 'error') && this.chosen().length > 0 && !!this.mic && this.mic.bytes > 0;
  };
  /** @this {Ctl} */ CP.send = function () {
    if (!this.canSend()) { if (this.state === 'review' && !this.chosen().length) this._say(WORDS.chooseRooms, 'info'); return; }
    this._send(this.chosen(), false);
  };
  /** @this {Ctl} */ CP.sendAnyway = function () {
    if (!this.quiet.length || !this.mic || !this.mic.bytes) return;
    this._send(this.quiet.slice(), true);
  };
  /** @this {Ctl} */ CP._send = function (rooms, override) {
    var self = this, mic = this.mic, tok = ++this.sendTok, wasDraft = !this.draftSent;
    this.said = null; this.state = 'sending'; this.decision = null; this.sentTo = 0; this.failed = []; this.quiet = []; this.fallback = [];
    mic.stopPlay(); this.playing = false;
    this._wire(mic, tok);
    this._rooms = rooms; this._override = override;
    this._changed();
    mic.sync().then(function (sy) {
      if (self.sendTok !== tok || self.disposed) return;
      if (wasDraft && sy.open && !sy.dropped && sy.bytes === mic.bytes && self.socket === 'open') {
        mic.text({ type: 'send', rooms: rooms, override: override });
        return;
      }
      // a new socket, the page's own copy, then send
      mic.begin();
      self.socket = 'opening'; self.draftSent = false;
      self._ticket('message', tok, mic.uploadable());
    });
  };
  /** @this {Ctl} */ CP._uploaded = function () {
    if (this.state !== 'sending' || !this.mic) return;
    this.mic.text({ type: 'send', rooms: this._rooms, override: this._override });
  };
  // the server's events (the build spec's /ws/intercom)
  /** @this {Ctl} */ CP._event = function (e) {
    if (!e || typeof e !== 'object') return;
    var f = this.feed();
    switch (e.type) {
      case 'full': if (this.state === 'recording') this._stop(); break;
      case 'rooms':
        this.decision = Array.isArray(e.rooms) ? e.rooms : [];
        if (this.state === 'sending' || this.liveStarted) {
          this.quiet = f && f.can_override ? this.decision.filter(function (r) { return r.state === 'skipped' && r.why === 'quiet'; }).map(function (r) { return r.room; }) : [];
        }
        if (this.modeNow() === 'live') this._changed();
        break;
      case 'lag_ms': this.lag = num(e.value, this.lag); this._changed(); break;
      case 'fallback': this.fallback = Array.isArray(e.rooms) ? e.rooms.slice() : []; this._changed(); break;
      case 'busy':
        this._stopTalk();
        this.socket = 'none';
        if (this.mic) this.mic.closeSocket();            // as after an error: Send Again opens a new one (this one is of no use)
        this.draftSent = false; this.state = 'error'; this._say((e.name || 'Someone') + ' is announcing', 'warn', 0); break;
      case 'sending':
        // Live: {rooms, live, after, lag_ms} comes while the person is still talking -- the lag, nothing else changes
        if (e.lag_ms != null) this.lag = num(e.lag_ms, this.lag);
        if (this.state === 'recording' || this.state === 'connecting') { this._changed(); break; }
        this.state = 'sending'; this._changed(); break;
      case 'sent':
        this._stopTalk();                    // (Live ends by itself too: 10 s of silence, or the limit)
        this.sentTo = num(e.rooms, 0); this.failed = Array.isArray(e.failed) ? e.failed.slice() : [];
        if (Array.isArray(e.fallback) && e.fallback.length) this.fallback = e.fallback.slice();
        this.draftSent = true; this.state = 'sent'; this.said = null;
        if (this.mic) this.mic.closeSocket();
        this.socket = 'none';
        this.save();
        this._afterSent();
        this._changed();
        break;
      case 'error': this._serverError(e); break;
      default: break;
    }
  };
  // BACK TO TAP TO TALK (2026-11-05, the owner: "when you finish sending a message ... should it just return to the
  // microphone?"): the microphone is there at once; "Sent to 9 rooms" with Play and Send Again stays SENT_MS, then goes.
  // A warning (a room that didn't play, quiet hours, a fallback) stays until the next press: it needs reading.
  /** @this {Ctl} */ CP._afterSent = function () {
    var self = this;
    this.clock.clearTimeout(this.sentT);
    if (this._sentLine().kind !== 'sent') return;
    this.sentT = this.clock.setTimeout(function again() {
      if (self.disposed || self.state !== 'sent') return;
      if (self.playing) { self.sentT = self.clock.setTimeout(again, SENT_MS); return; }
      self._discard();
      self._changed();
    }, SENT_MS);
  };
  /** @this {Ctl} */ CP._serverError = function (e) {
    var code = e.code, text;
    if (code === 'no_rooms') {
      var why = (this.decision || []).filter(function (r) { return r.state === 'skipped'; }).map(function (r) { return plain(r.reason); }).filter(Boolean);
      text = 'Nothing to send to' + (why.length ? ': ' + why.join('; ') : '');
    } else if (code === 'too_short') text = WORDS.tooShort;
    else if (code === 'audit_unavailable') text = 'Couldn’t send: the log of what the house does is unavailable';
    else if (code === 'music_assistant_off') text = 'Music Assistant is off';
    else if (code === 'rate') text = 'Too many announcements. Wait a moment';
    else if (code === 'not_allowed') text = 'You can’t announce to those rooms';
    else text = e.message || 'Couldn’t send';
    this.socket = 'none';
    if (this.mic) this.mic.closeSocket();
    if (code === 'too_short') { this._discard(); this._say(text, 'info'); return; }
    this.clock.clearInterval(this.timer); this.timer = null;
    if (this.mic) this.mic.rec(false);
    this.draftSent = false;
    this.state = this.mic && this.mic.bytes ? 'error' : 'idle';
    this._say(text, 'warn', 0);
  };
  // the recording's timer and microphone button off (the talk ended without the person's tap)
  /** @this {Ctl} */ CP._stopTalk = function () {
    this.clock.clearInterval(this.timer); this.timer = null;
    if (this.mic && this.mic.recording !== false) this.mic.rec(false);
    this.level = 0; this.liveStarted = false;
  };
  /** @this {Ctl} */ CP._closed = function () {
    this.socket = 'none';
    if (this.state === 'sending') { this.state = 'error'; this._say(WORDS.lost, 'failed', 0); }
    else if (this.state === 'recording' && this.liveStarted) this._rescue();
    else if (this.state === 'connecting' && this.liveStarted) this.liveStarted = false;
    this._changed();
  };
  // THE SOCKET DROPPED MID-TALK (Live): what was said is the page's own copy, and it goes as a Message on a new ticket
  /** @this {Ctl} */ CP._rescue = function () {
    var mic = this.mic;
    this.secs = mic.seconds();
    this._stopTalk();
    this.draftSent = false;
    if (this.secs < MIN_S || !this.chosen().length) { this._abandon(); this._say(WORDS.lost, 'warn'); return; }
    this._send(this.chosen(), false);
  };
  /** @this {Ctl} */ CP._socketError = function (e) {
    this.socket = 'none';
    var code = e && e.code;
    if (code === 'auth') {
      if (this.state === 'sending') { this.state = 'error'; this._say('Couldn’t sign in to the Intercom', 'failed', 0); }
      else this._say('Couldn’t sign in to the Intercom', 'warn');
    } else if (this.state === 'sending') { this.state = 'error'; this._say(WORDS.lost, 'failed', 0); }
    this._changed();
  };

  // ---- the sheet's view, whole
  /** @this {Ctl} */ CP.view = function () {
    var f = this.feed(), mode = this.modeNow(), st = this.status(), s = this.state;
    var refusal = this._refusal();
    var disabledMic = !!refusal && s === 'idle';
    var live = mode === 'live';
    // the microphone is always there but in a review (recorded with no room picked: Send waits for one)
    var mic = { kind: disabledMic ? 'off' : s === 'connecting' ? 'wait' : s === 'recording' ? (live ? 'live' : 'rec') : s === 'sending' ? 'busy' : 'idle',
                label: '', time: '', level: this.level, hidden: s === 'review', word: '', ring: 0 };
    if (disabledMic) mic.label = refusal === WORDS.https ? 'Needs HTTPS' : refusal === WORDS.needsHost ? 'Needs Mantel' : refusal === WORDS.off ? 'Intercom is off' : 'No microphone';
    else if (s === 'connecting') mic.label = WORDS.connecting;
    else if (s === 'recording') {
      mic.label = live ? 'Release to stop' : 'Tap to send';
      var left = Math.max(0, this.maxSecs() - this.secs);
      mic.time = live ? 'Let go to finish · ' + mmss(left) + ' left' : 'Tap to send · ' + mmss(left) + ' left';
      mic.word = live ? 'Live' : mmss(this.secs);
      mic.ring = Math.min(1, this.secs / Math.max(1, this.maxSecs()));
    } else if (s === 'sending') mic.label = WORDS.sending;
    else mic.label = live ? 'Hold to talk' : 'Tap to record';
    if (!mic.word) mic.word = disabledMic ? mic.label : s === 'connecting' ? 'Starting…' : s === 'sending' ? WORDS.sending : live ? 'Hold to Talk' : 'Tap to Talk';
    var actions = [], has = this.mic && this.mic.bytes > 0, busy = s === 'sending';
    if (s === 'review') {
      actions.push({ id: 'send', label: 'Send', primary: true, disabled: !this.canSend() });
      actions.push({ id: 'play', label: this.playing ? 'Stop' : 'Play', disabled: !has });
      actions.push({ id: 'rerecord', label: 'Re-record', disabled: false });
      actions.push({ id: 'cancel', label: 'Cancel', disabled: false });
    } else if ((s === 'sent' || s === 'error') && has) {
      // under the microphone, small: the next press is a new message
      actions.push({ id: 'play', label: this.playing ? 'Stop' : 'Play', disabled: busy });
      actions.push({ id: 'send', label: 'Send Again', disabled: !this.canSend() });
      if (s === 'sent' && this.quiet.length && f && f.can_override) actions.push({ id: 'anyway', label: 'Send Anyway', disabled: false });
    }
    var free = s === 'idle' || s === 'sent' || s === 'error';
    var modes = f && f.enabled && f.live_allowed ? MODES.map(function (m) { return { id: m, label: m === 'live' ? 'Live' : 'Message', on: m === mode, disabled: !free }; }) : [];
    var n = this.count();
    return { mode: mode, modes: modes, status: st, mic: mic, actions: actions, secs: this.secs, state: s, count: n,
             canClear: n.on > 0 && free,
             pills: this.pills().map(function (p) { p.on = this.sel.indexOf(p.id) >= 0 && p.pickable; return p; }, this), chips: this.chips(),
             stamp: mmss(this.secs),
             enabled: !f || f.enabled };
  };
  /** @this {Ctl} */ CP.do = function (id) {
    if (id === 'send') this.send();
    else if (id === 'play') this.play();
    else if (id === 'rerecord') this.rerecord();
    else if (id === 'cancel') this.cancel();
    else if (id === 'done') this.done();
    else if (id === 'anyway') this.sendAnyway();
  };
  // THE MICROPHONE READY AS THE SHEET OPENS (hk-mic.js warm), only where the browser already allows it: opening a sheet
  // never asks for the microphone. Resolves whether it did.
  /** @this {Ctl} */ CP.warm = function () {
    var self = this, ask = this.d.micAllowed, asked;
    if (this.disposed || !ask) return Promise.resolve(false);
    try { asked = ask(); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(asked).then(function (yes) {
      if (yes !== true || self.disposed || self.state !== 'idle') return false;
      var mic = self.mic || (self.mic = self.d.mic());
      if (!mic || !mic.warm) return false;
      mic.warm();
      return true;
    }, function () { return false; });
  };
  /** @this {Ctl} */ CP.dispose = function () {
    this.disposed = true;
    var at = controllers.indexOf(this);
    if (at >= 0) controllers.splice(at, 1);
    this.clock.clearInterval(this.timer); this.clock.clearTimeout(this.sayT); this.clock.clearTimeout(this.sentT);
    if (this.saveT) this.save();
    this.tok++; this.sendTok++;
    if (this.mic) { this.mic.on = {}; try { this.mic.close(); } catch (e) { /* closed */ } }
    this.mic = null;
  };

  // ------------------------------------------------------------------ what the card is given (the real surroundings)
  function localGet(key) { try { return window.localStorage ? window.localStorage.getItem(key) : null; } catch (e) { return null; } }
  function localSet(key, v) { try { if (window.localStorage) window.localStorage.setItem(key, v); } catch (e) { /* private mode */ } }

  // The feed and the person's memory are shared by every card that wants them (the block, the sheet): one subscription
  // each, asked for by the first card that has a client and let go when none is left.
  /** @type {{ feed: any, mem: any, users: number, offFeed: any, offMem: any, fns: Function[], err?: any }} */
  var shared = { feed: null, mem: null, users: 0, offFeed: null, offMem: null, fns: [] };
  try { shared.mem = JSON.parse(localGet(LAST) || 'null'); } catch (e) { shared.mem = null; }
  function sharedNote() { shared.fns.slice().forEach(function (fn) { try { fn(); } catch (e) { console.error('[hk-intercom]', e); } }); }
  function sharedAttach(client) {
    if (!client) return;
    if (!shared.offFeed && client.intercom) {
      shared.offFeed = client.intercom.subscribe(function (ev, err) {
        shared.feed = err ? null : normalize(ev);
        shared.err = err || null;
        sharedNote();
      });
    }
    if (!shared.offMem) {
      var sub = client.subscriptions;
      if (sub && sub.subscribeMessage) {
        var HS = window.hkSettings, msg = { type: 'frontend/subscribe_user_data', key: KEY };
        var on = function (ev) {
          var v = ev && ev.value;
          if (v && typeof v === 'object') { shared.mem = v; localSet(LAST, JSON.stringify(v)); }
          sharedNote();
        };
        var off = HS && HS.subscribe ? HS.subscribe(sub, msg, on, 'hkIntercom') : (sub.subscribeMessage(on, msg).catch(function () { /* the local copy stands */ }), function () {});
        shared.offMem = off || function () {};
      }
    }
  }
  // (a test's, and the browser checks': a feed as the server would send it)
  function feedIs(raw) { shared.feed = normalize(raw); shared.err = null; sharedNote(); }
  function sharedUse(fn) {
    shared.fns.push(fn);
    shared.users++;
    return function () {
      var i = shared.fns.indexOf(fn);
      if (i >= 0) shared.fns.splice(i, 1);
      if (--shared.users <= 0) {
        shared.users = 0;
        if (shared.offFeed) { try { shared.offFeed(); } catch (e) { /* gone */ } shared.offFeed = null; }
        if (shared.offMem) { try { shared.offMem(); } catch (e) { /* gone */ } shared.offMem = null; }
        shared.feed = null;
      }
    };
  }

  var overrides = {};                   // hkIntercom.use(): a test's stand-ins for the surroundings
  /** the feed as the cards see it: a test's stand-in (hkIntercom.use) wins over the page's own */
  function feedNow() { return overrides.feed ? overrides.feed() : shared.feed; }

  // THE MICROPHONE MODULE, on demand. hk-mic.js is not one of the page's bootstrap modules (hk-loader.js MODULES): the sheet
  // imports it as it opens, so it is here long before a press (a press must make the AudioContext inside the gesture).
  // It takes the address the other modules have (the build's ?v= on Mantel, window.hkV) and says nothing when it is there.
  var micLoad = null, micIs = false, micFailed = false;
  // Safari (a Mac's, an iPad's -- which says "Macintosh" -- or an iPhone's), not Chrome, Firefox or Edge in any of their guises
  function isSafari() {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg|OPR|Android/.test(ua);
  }
  function micLoading() { return micIs && !window.hkMic; }
  function needMic() {
    if (window.hkMic || overrides.mic) return Promise.resolve();
    if (!micLoad) {
      var url = '/hk/modules/hk-mic.js';
      try { if (window.hkV) url = window.hkV(url); } catch (e) { /* the plain address */ }
      micIs = true; micFailed = false;
      micLoad = Promise.resolve().then(function () { return import(url); }).then(function () { micIs = false; }, function (err) {
        micIs = false; micLoad = null; micFailed = true;   // the next sheet tries again; this one says it couldn't load
        console.error('[hk-intercom] could not load the microphone module', err);
      });
    }
    return micLoad;
  }
  function depsFor(client, changed) {
    return {
      actions: function () { return (overrides.actions ? overrides.actions() : client && client.actions) || null; },
      feed: function () { return overrides.feed ? overrides.feed() : shared.feed; },
      mic: function () { return overrides.mic ? overrides.mic() : window.hkMic ? window.hkMic.create() : null; },
      micAllowed: function () {
        var p = window.navigator && window.navigator.permissions;
        if (!p || !p.query) return false;
        return p.query({ name: 'microphone' }).then(function (s) { return s.state === 'granted'; }, function () { return false; });
      },
      store: {
        load: function () { return shared.mem; },
        save: function (v) {
          shared.mem = v; localSet(LAST, JSON.stringify(v));
          var act = (overrides.actions ? overrides.actions() : client && client.actions);
          if (act && act.callWS) Promise.resolve(act.callWS({ type: 'frontend/set_user_data', key: KEY, value: v })).catch(function (e) { console.warn('[hk-intercom] could not save', e && (e.code || e.message)); });
        }
      },
      secure: function () { return overrides.secure ? overrides.secure() : window.isSecureContext !== false; },
      // (while hk-mic.js is on its way the answer is yes: "No microphone" would flash on every first open)
      supported: function () { return overrides.supported ? overrides.supported() : window.hkMic ? !!window.hkMic.supported() : micLoading(); },
      loading: function () { return micLoading(); },
      loadFailed: function () { return micFailed; },
      safari: function () { return isSafari(); },
      hasPort: function () { return overrides.hasPort ? overrides.hasPort() : !!(client && client.intercom); },
      oneWay: { seen: function () { return overrides.oneWaySeen !== undefined ? !!overrides.oneWaySeen : localGet(ONE_WAY) === '1'; }, mark: function () { localSet(ONE_WAY, '1'); } },
      changed: changed
    };
  }

  // ------------------------------------------------------------------ tablets as listeners (docs/phase17/INTERCOM.md, 17.4)
  // A tablet the Owner listed under a room (the feed says `listener: true`) plays that room's announcements itself:
  // when a broadcast is sent to its room the feed carries, once, `play: {id, url, volume}`; the page fetches the clip
  // (it is a signed-in page, the cookie goes with it), decodes it and plays it through WebAudio at `volume` (null is
  // full). One of these runs on a wall tablet that listens (hkIntercom.listen, below), not on every page.
  //
  // AUTOPLAY. A browser that will not start audio without a touch leaves the context suspended: one small pill, "Tap to
  // hear announcements", is drawn once, and the first touch anywhere resumes the context and plays a clip that waited
  // for it -- if it is under a minute old (an announcement read a minute late is no announcement).
  // A tablet that is itself talking plays nothing (the server leaves it out of its own broadcast; this is the second lock).
  //   d: {AudioContext, fetch(url) -> Promise<ArrayBuffer>, clock: {now, setTimeout}, gesture(fn), pill(show), busy()}
  var CLIP_FRESH_MS = 60000;
  /**
   * @typedef {{ [member: string]: any, d: any, ctx: any, lastId: any, pending: any, pillDone: boolean, played: number, last: any }} Lst
   */
  /** @this {Lst} @param {any} d */
  function Listener(d) {
    this.d = d; this.ctx = null; this.lastId = null; this.pending = null; this.pillDone = false; this.played = 0; this.last = null;
  }
  /** @type {Lst} */
  var LP = /** @type {any} */ (Listener.prototype);
  /** @this {Lst} */ LP.feed = function (f) {
    if (!f) return;
    if (f.listener) this._ready();
    var p = f.play;
    if (p && typeof p.id === 'string' && typeof p.url === 'string' && p.id !== this.lastId) { this.lastId = p.id; this._play(p); }
  };
  // the audio made ready: a context, the first touch watched for, and the pill if the context will not run unasked
  /** @this {Lst} */ LP._ready = function () {
    if (this.ctx || this.failed) return;
    var self = this, AC = this.d.AudioContext;
    try { this.ctx = AC ? new AC() : null; } catch (e) { this.ctx = null; }
    if (!this.ctx) { this.failed = true; return; }
    this.d.gesture(function () { self._gesture(); });
    var ctx = this.ctx;
    if (ctx.state !== 'running') { try { Promise.resolve(ctx.resume()).catch(function () { /* wants a touch */ }); } catch (e) { /* old engine */ } }
    this.d.clock.setTimeout(function () { if (ctx.state !== 'running') self._pill(true); }, 300);
  };
  /** @this {Lst} */ LP._pill = function (show) {
    if (show) { if (this.pillDone) return; this.pillDone = true; }
    this.d.pill(!!show);
  };
  /** @this {Lst} */ LP._play = function (p) {
    var self = this, at = this.d.clock.now();
    this._ready();
    if (!this.ctx || this.d.busy()) return;
    var url = p.url;
    var volume = typeof p.volume === 'number' && isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : 1;
    Promise.resolve().then(function () { return self.d.fetch(url); }).then(function (bytes) {
      return new Promise(function (res, rej) {
        var r = self.ctx.decodeAudioData(bytes, res, rej);
        if (r && typeof r.then === 'function') r.then(res, rej);
      });
    }).then(function (buffer) {
      if (self.d.busy()) return;
      var clip = { id: p.id, buffer: buffer, volume: volume, at: at };
      if (self.ctx.state === 'running') self._start(clip);
      else { self.pending = clip; self._pill(true); }
    }).catch(function (e) { console.warn('[hk-intercom] an announcement could not be played:', e && (e.message || e)); });
  };
  /** @this {Lst} */ LP._start = function (clip) {
    var ctx = this.ctx, src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = clip.buffer;
    gain.gain.value = clip.volume;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.played++;
    this.last = { id: clip.id, volume: clip.volume };
  };
  // the first touch: the context runs, the pill goes, and a clip that waited plays if it is still news
  /** @this {Lst} */ LP._gesture = function () {
    var self = this, ctx = this.ctx;
    if (!ctx) return;
    Promise.resolve(ctx.resume()).then(function () {
      self.d.pill(false);
      var clip = self.pending;
      self.pending = null;
      if (clip && !self.d.busy() && self.d.clock.now() - clip.at < CLIP_FRESH_MS) self._start(clip);
    }, function () { /* still not allowed: the next touch */ });
  };

  // ------------------------------------------------------------------ the sheet's opening
  var opened = false;
  function open(o) {
    var D = window.hkDetail;
    if (!D || typeof D.open !== 'function') return false;
    o = o || {};
    var done = function () { opened = false; if (o.onClose) o.onClose(); };
    var ok = D.open(null, { name: 'Intercom', icon: 'mdi:microphone', icon_color: 'rgba(255,255,255,0.92)' },
      Object.assign({ cards: { cards: [{ type: 'custom:hk-intercom-sheet-card' }], width: 'wide', height: 'auto' }, onClose: done }, o.hashed ? { hashed: true } : {}));
    opened = !!ok;
    return !!ok;
  }
  // `#intercom` on the address (the apps' menu button loads it) opens the sheet, as a pop-up's hash does
  function route() {
    if (location.hash !== '#intercom' || opened) return;
    var clear = function () {
      if (location.hash === '#intercom') { try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* ok */ } }
    };
    open({ hashed: true, onClose: clear });
  }
  function wireRoute() {
    var SH = window.hkShell;
    [SH && SH.navEvent, 'hashchange', 'popstate', 'hk-detail-ready'].filter(Boolean).forEach(function (ev) { window.addEventListener(ev, route); });
    setTimeout(route, 0);
  }

  var wantListen = false;               // listen() was called before the base was ready
  window.hkIntercom = {
    version: '1.0.0', KEY: KEY, WORDS: WORDS, open: open,
    listen: function () { wantListen = true; return false; },     // (replaced by the real one once the base is ready, below)
    // a test's stand-ins for the card's surroundings: {actions, feed, mic, secure, supported, hasPort, oneWaySeen}
    use: function (o) { overrides = o || {}; },
    _: { normalize: normalize, pillsOf: pillsOf, chipsOf: chipsOf, Controller: Controller, depsFor: depsFor, shared: shared, feedIs: feedIs, route: route,
         plain: plain, Listener: Listener, needMic: needMic, talking: talking, SENT_MS: SENT_MS, CLIP_FRESH_MS: CLIP_FRESH_MS, HOLD_MS: HOLD_MS, MIN_S: MIN_S, SAID_MS: SAID_MS, SAVE_MS: SAVE_MS }
  };
  if (typeof window.addEventListener === 'function' && typeof location !== 'undefined') wireRoute();

  // ================================================================== the elements
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
    }, { once: true });
  }

  var GLYPHS = {
    mic: 'M12 2A3 3 0 0 1 15 5V11A3 3 0 0 1 12 14A3 3 0 0 1 9 11V5A3 3 0 0 1 12 2M19 11C19 14.53 16.39 17.44 13 17.93V21H11V17.93C7.61 17.44 5 14.53 5 11H7A5 5 0 0 0 12 16A5 5 0 0 0 17 11H19Z',
    stop: 'M6 6H18V18H6Z',
    tick: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z',
    waveform: 'M3 10H5V14H3ZM7 6H9V18H7ZM11 3H13V21H11ZM15 7H17V17H15ZM19 10H21V14H19Z',
    clock: 'M12 2A10 10 0 0 0 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2M16.2 16.2L11 13V7H12.5V12.2L17 14.9L16.2 16.2Z',
    moon: 'M2 12A10 10 0 0 0 15 21.54A10 10 0 0 1 15 2.46A10 10 0 0 0 2 12Z',
    slash: 'M12 2A10 10 0 0 0 2 12A10 10 0 0 0 12 22A10 10 0 0 0 22 12A10 10 0 0 0 12 2M12 4A8 8 0 0 1 18.3 17L7 5.7A8 8 0 0 1 12 4M5.7 7L17 18.3A8 8 0 0 1 5.7 7Z',
    person: 'M12 4A4 4 0 0 1 16 8A4 4 0 0 1 12 12A4 4 0 0 1 8 8A4 4 0 0 1 12 4M12 14C16.42 14 20 15.79 20 18V20H4V18C4 15.79 7.58 14 12 14Z'
  };
  // 0:04, 1:30: the time on the talk button (its own, not the microphone module's, which may not be here yet)
  function mmss(x) { var t = Math.max(0, Math.round(x)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + GLYPHS[name] + '"></path></svg>'; }
  window.hkIntercom._.GLYPHS = GLYPHS;

  whenBase(function (C) {
    if (window.hkIntercom.Card) return;
    // ---------------------------------------------------------------- the listener, on a tablet that listens
    var pillEl = null;
    function pill(show) {
      if (!show) { if (pillEl && pillEl.parentNode) pillEl.parentNode.removeChild(pillEl); pillEl = null; return; }
      if (pillEl || !document.body) return;
      pillEl = document.createElement('div');
      pillEl.id = 'hk-intercom-pill';
      pillEl.setAttribute('role', 'button');
      pillEl.textContent = 'Tap to hear announcements';
      pillEl.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 104px);z-index:9998;' +
        'height:44px;box-sizing:border-box;padding:0 20px;border-radius:22px;display:flex;align-items:center;font:600 14px/1 var(--hk-font-body,-apple-system,system-ui,sans-serif);' +
        'letter-spacing:-0.15px;color:rgba(255,255,255,0.92);background:rgba(36,36,40,0.92);border:1px solid rgba(255,255,255,0.14);' +
        'box-shadow:0 6px 18px rgba(0,0,0,0.28);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:transparent';
      document.body.appendChild(pillEl);
    }
    function gesture(fn) {
      var evs = ['pointerdown', 'touchend', 'keydown', 'click'], done = false;
      var run = function () {
        if (done) return;
        done = true;
        evs.forEach(function (ev) { document.removeEventListener(ev, run, true); });
        fn();
      };
      evs.forEach(function (ev) { document.addEventListener(ev, run, true); });
    }
    // The listener is started by `hkIntercom.listen()`, never by this file's being loaded: the file is loaded by a block or the
    // `#intercom` sheet on any page, and only a wall tablet that listens (the shim asks, once the feed says `listener`) plays
    // announcements. Called before the base is ready, the request waits here.
    var listener = null;
    function startListener(client) {
      client = client || (C.client ? C.client() : null);
      if (listener || !client || !client.intercom) return false;
      listener = /** @type {any} */ (new Listener({
        AudioContext: window.AudioContext || window.webkitAudioContext,
        fetch: function (url) { return fetch(url, { credentials: 'include' }).then(function (r) { if (!r.ok) throw new Error('clip ' + r.status); return r.arrayBuffer(); }); },
        clock: { now: function () { return Date.now(); }, setTimeout: function (fn, ms) { return setTimeout(fn, ms); } },
        gesture: gesture, pill: pill, busy: talking
      }));
      sharedAttach(client);
      sharedUse(function () { listener.feed(shared.feed); });
      listener.feed(shared.feed);
      return true;
    }
    window.hkIntercom._.listener = function () { return listener; };
    window.hkIntercom.listen = function () { wantListen = true; if (!startListener(null) && !listener && C.onClient) C.onClient(function (c) { if (wantListen) startListener(c); }); return !!listener; };
    if (wantListen) window.hkIntercom.listen();
    var HkBase = C.HkBase, v = C.v, esc = C.esc, TILE = C.TILE;

    // ---------------------------------------------------------------- the block
    // THE TILE LANGUAGE OF THE OTHER BLOCKS (2026-11-04, the owner: "it doesn't follow any design of any other card"): the same
    // key as the Lock Up and Lamps blocks (hk-grid-security.js KEY_CSS: the glyph in its well at the top, the name and one line
    // under it at the foot, 15 / 600 on 16.5 px lines), and in the HomeView look (Tile Style Centred, square cells) the centred
    // tile's own numbers (hkCards.centredTile). Wide is that same key on the left, and the rooms last picked as whole chips on
    // the right: the rooms that fit, then "+N", never a name cut in two.
    // THE BLOCK'S GLYPH (2026-11-07, the review): Apple's Intercom is five rounded vertical bars, tall in the middle (a
    // waveform), not a microphone -- drawn here, a stroke each, in the box the glyph has (the bars' ink is 87 % of it)
    var BARS = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9v6M7.75 6v12M12 3v18M16.25 7v10M20.5 10v4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path></svg>';
    var BLOCK_CSS = [
      ':host{display:block;height:100%}',
      'hk-plate.k{box-sizing:border-box;height:100%;display:flex;flex-direction:row;align-items:stretch;gap:12px;',
      '  padding:calc(12.8px + var(--hk-in-t,0px)) calc(12.8px + var(--hk-in-r,0px)) calc(12.8px + var(--hk-in-b,0px)) calc(' + TILE.padL + 'px + var(--hk-in-l,0px));',
      '  cursor:pointer;overflow:hidden;' + C.plate('tile') + ';-webkit-tap-highlight-color:transparent;--ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
      '  transition:transform ' + C.DUR.press + ' ease,filter ' + C.DUR.press + ' ease}',
      'hk-plate.k:active{transform:scale(0.97);filter:brightness(0.93)}',
      'hk-plate.k:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      'hk-plate.k[aria-disabled="true"]{cursor:default}',
      '.lft{display:flex;flex-direction:column;justify-content:space-between;min-width:0;flex:1 1 auto}',
      '.well{width:42px;height:42px;border-radius:50%;background:' + v('key') + ';display:flex;align-items:center;justify-content:center;flex:none}',
      '.icon{width:' + TILE.glyph + 'px;height:' + TILE.glyph + 'px;display:block;color:' + v('glyph') + ';transition:color ' + C.DUR.fade + ' ease}',
      '.tx{display:flex;flex-direction:column;gap:' + TILE.rowGap + 'px;min-width:0}',
      '.name,.state{font-size:15px;line-height:' + TILE.lineH + 'px;letter-spacing:-0.23px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.name{font-weight:600;color:' + v('ink') + '}',
      '.state{font-weight:500;color:' + v('ink-2') + '}',
      // WIDE (2026-11-07, the owner: one Wide tile for the Scene, the Accessory and this), Home style: Apple Home's wide tile -- the
      // 42 px well at the left, the name over the rooms last picked beside it, the pair centered; the rooms are the line, no chips
      ':host([size=W]) .lft{flex-direction:row;align-items:center;justify-content:flex-start;gap:' + TILE.wellGap + 'px}',
      '@media (prefers-reduced-motion:reduce){hk-plate.k,hk-plate.k:active{transition:none;transform:none}}',
      'hk-plate.k{border-radius:var(--hk-block-radius, ' + C.M.radius + ')}',
      // CENTRED (the HomeView look; hk-base.js TILE.centred): the glyph bare over the name and what it says, all centred
      ':host([tile=centred]) hk-plate.k{display:block}',
      ':host([tile=centred]) .lft{display:contents}',
      C.centredTile({ host: ':host([tile=centred])', plate: 'hk-plate.k', lit: 'hk-plate.k.lit', well: '.well', icon: '.icon', name: '.tx .name', sub: ['.tx .state'] }),
      // ...and Wide (2026-11-07, the owner: one Wide tile for the Scene, the Accessory and this): hkTile.wideTile's, the glyph on a
      // quarter of the width, the name over the rooms last picked beside it
      ':host([tile=centred][size=W]) hk-plate.k{display:block}',
      '@@WIDE@@'
    ].join('');

    class HkIntercomCard extends HkBase {
      static get CSS() {
        var T = window.hkTile;
        return BLOCK_CSS.replace('@@WIDE@@', T && T.wideTile ? T.wideTile({ host: ':host([tile=centred][size=W])', well: '.well', icon: '.icon', name: '.tx .name', sub: ['.tx .state'] }) : '');
      }
      static get observedAttributes() { return ['size', 'tile']; }
      attributeChangedCallback() { if (this._config) { this._hkSig = null; this.redraw(); } }
      getCardSize() { return 2; }
      _size() { var s = (this.getAttribute && this.getAttribute('size')) || (this._config || {}).size; return s === 'W' ? 'W' : 'S'; }
      _sigOf() {
        var f = feedNow(), m = shared.mem || {};
        return JSON.stringify([this._size(), this.getAttribute('tile') || '', !!(this.client && this.client.intercom), f ? [f.enabled, f.rooms.map(function (r) { return r.room + r.name; })] : null, m.rooms || null]);
      }
      _receiveClient() {
        super._receiveClient();
        sharedAttach(this.client);
        if (!this._off) {
          var self = this;
          this._off = sharedUse(function () { self._hkSig = null; self.redraw(); });
        }
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this.client) this._receiveClient();
      }
      disconnectedCallback() {
        if (this._off) { this._off(); this._off = null; }
        if (this._ro) { this._ro.disconnect(); this._ro = null; }
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
      _lines() {
        var f = feedNow(), port = !!(this.client && this.client.intercom);
        if (!port) return { state: 'Needs Mantel', label: WORDS.needsHost, off: true };
        if (!f) return { state: shared.err ? 'Unavailable' : '', label: 'Intercom', off: !!shared.err };
        if (!f.enabled) return { state: 'Off', label: WORDS.off, off: true };
        var want = ((shared.mem || {}).rooms || []), ids = {};
        f.rooms.forEach(function (r) { ids[r.room] = r.name; });
        var picked = want.filter(function (id) { return ids[id]; }).map(function (id) { return ids[id]; });
        return { state: 'Everywhere', label: 'Intercom', picked: picked, off: false };
      }
      _render() {
        if (!this._config) return;
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="k" data-hk-role="card" role="button" tabindex="0">' +
            '<div class="lft"><div class="well">' + BARS + '</div><div class="tx"><div class="name">Intercom</div><div class="state"></div></div></div>' +
            '</hk-plate>';
          var self = this, k = this._root.querySelector('.k');
          k.addEventListener('click', function (ev) { ev.stopPropagation(); self._tap(); });
          k.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); self._tap(); } });
          this._e = { k: k, icon: k.querySelector('.icon'), state: k.querySelector('.state') };
          this._built = true;
          // what fits depends on the box: drawn again when it changes (and once the fonts are in)
          if (window.ResizeObserver) {
            var last = '';
            this._ro = new window.ResizeObserver(function () {
              var r = k.getBoundingClientRect(), key = Math.round(r.width) + 'x' + Math.round(r.height);
              if (key !== last) { last = key; self._fit(); }
            });
            this._ro.observe(k);
          }
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self._fit(); });
        }
        var e = this._e, l = this._l = this._lines(), size = this._size();
        e.k.setAttribute('size', size);
        e.k.setAttribute('aria-label', l.label + (l.picked && l.picked.length ? ', ' + names(l.picked, 3) : l.state && !l.off ? ', ' + l.state : l.off && l.state ? ', ' + l.state : ''));
        e.k.setAttribute('aria-disabled', l.off ? 'true' : 'false');
        this._fit();
      }
      // THE WORDS THAT FIT: the rooms last picked on one line, Small and Wide alike (2026-11-07: Wide's chips are gone), or
      // "Everywhere" when none was picked. Whole names only: as many as the line holds, then "+N"; if not even one fits, the count.
      _fit() {
        var e = this._e, l = this._l;
        if (!e || !l) return;
        var picked = l.picked || [];
        var line = picked.length ? names(picked, picked.length) : l.state;
        if (e.state.textContent !== line) e.state.textContent = line;
        if (picked.length > 1 && e.state.clientWidth) {
          var n = picked.length;
          while (n > 1 && e.state.scrollWidth > e.state.clientWidth + 1) { n--; e.state.textContent = names(picked, n); }
          if (e.state.scrollWidth > e.state.clientWidth + 1) e.state.textContent = plural(picked.length, 'room', 'rooms');
        }
      }
      _tap() {
        var l = this._lines();
        if (l.off && !(this.client && this.client.intercom)) return;
        if (!window.hkIntercom.open() && window.hkShell && window.hkShell.toast) window.hkShell.toast({ message: 'The Intercom is not ready yet.' }, this);
      }
    }
    C.register('hk-intercom-card', HkIntercomCard, 'HK Intercom',
      'A button that opens the Intercom: speak a message into the HomePods of the rooms you pick. Made for a Home Grid.', null, function () { return {}; });
    window.hkIntercom.Card = HkIntercomCard;

    // ---------------------------------------------------------------- the sheet
    var GAP = TILE.gridGap, SPC = C.SP;
    // THE SHEET (2026-11-05, the owner's mockup, docs/phase17/mockups/intercom-sheet.html): the talk button is the Lock
    // sheet's (a 264 ring around a 192 core; 228 / 166 narrow), its big word under it, then one status line; the rooms in
    // their own panel ("To", how many, Clear All, the groups, the rooms) beside it where the sheet is wide (a container
    // query: the sheet's own width, whatever the screen), under it where it isn't.
    var TALK = { idle: '#0a84ff', rec: '#ff453a', live: '#30d158', wait: '#ff9f0a' };   // the Lock sheet's literals, as there
    var SHEET_CSS = [
      ':host{display:block}',
      '.sh{container-type:inline-size;display:block;padding:2px 0 0}',
      '.cols{display:flex;flex-direction:column;gap:' + SPC.piece + 'px}',
      '@container (min-width:680px){.cols{display:grid;grid-template-columns:minmax(300px,340px) minmax(0,1fr);align-items:start}',
      // THE TALK GROUP ON THE ROOMS PANEL'S CENTER LINE (2026-11-07, the review): the button, its word and the line were
      // top-weighted ~65 px above the panel's middle on a 1280 x 800 tablet; a taller list of rooms still scrolls past it
      '  .talk{align-self:center}}',
      // the talk side stays in view while a long list of rooms scrolls -- only where it fits: taller than the sheet, its
      // own buttons would never come into view (a phone on its side, 2026-11-05)
      '@media (min-height:760px){@container (min-width:680px){.talk{position:sticky;top:0}}}',
      '@media (max-width:' + C.BP.phone + 'px){.cols{gap:' + SPC.piecePhone + 'px}}',
      C.segCss('.seg', { on: '.sel', fill: true }),
      '.seg{align-self:stretch}',
      '.seg button{min-height:36px}',
      '.seg[hidden]{display:none}',
      '.seg button[aria-disabled="true"]{opacity:.45}',

      // THE TALK SIDE
      '.talk{display:flex;flex-direction:column;align-items:center;gap:' + SPC.piece + 'px;min-width:0}',
      '.mic{display:flex;flex-direction:column;align-items:center;gap:14px}',
      '.mic[hidden]{display:none}',
      '.mb{all:unset;box-sizing:border-box;position:relative;width:264px;height:264px;border-radius:50%;display:grid;place-items:center;',
      '  cursor:pointer;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;',
      '  --c:' + TALK.idle + ';background:color-mix(in srgb,var(--c) 16%,transparent);transition:background-color .2s ease}',
      '.mb svg.ring{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
      '.mb .trk{fill:none;stroke:rgba(255,255,255,0.12);stroke-width:8}',
      '.mb .prg{fill:none;stroke:var(--c);stroke-width:8;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:calc(1 - var(--ring,0));',
      '  transition:stroke-dashoffset .1s linear}',
      '.mb .core{width:192px;height:192px;border-radius:50%;background:var(--c);color:#fff;display:grid;place-items:center;',
      '  box-shadow:0 0 0 calc(var(--lv,0) * 22px) color-mix(in srgb,var(--c) 26%,transparent);transition:transform .12s ease,box-shadow .1s linear,background-color .2s ease}',
      '.mb:active .core{transform:scale(.97)}',
      '.mb .core svg{width:76px;height:76px;fill:currentColor;display:block}',
      '.mic[data-kind="rec"] .mb{--c:' + TALK.rec + '}',
      '.mic[data-kind="live"] .mb{--c:' + TALK.live + '}',
      '.mic[data-kind="wait"] .mb{--c:' + TALK.wait + '}',
      '.mic[data-kind="busy"] .core{animation:hki-pulse 1.1s ease-in-out infinite}',
      '@keyframes hki-pulse{50%{opacity:.6}}',
      '.mic[data-kind="off"] .mb{--c:rgba(255,255,255,0.22);cursor:default}',
      '.wd{font-size:38px;font-weight:600;letter-spacing:-1px;line-height:44px;text-align:center;font-variant-numeric:tabular-nums;color:' + v('ink') + '}',
      '.mt{font-size:15px;font-weight:500;color:' + v('ink-2') + ';min-height:20px;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}',
      '.mt:empty{display:none}',
      '.line{min-height:20px;max-width:100%;font-size:15px;font-weight:600;letter-spacing:-0.15px;line-height:20px;text-align:center;color:' + v('ink-2') + ';',
      '  overflow-wrap:anywhere;transition:color .18s ease}',
      '.line[data-kind="pending"]{color:' + v('ink-3') + '}',
      '.line[data-kind="live"],.line[data-kind="sent"]{color:' + v('ink') + '}',
      '.line[data-kind="warn"]{color:' + v('warn') + '}',
      '.line[data-kind="failed"]{color:' + v('fail') + '}',
      // after a send, small and under the line: Play, Send Again (and Send Anyway); in a review, Send large and the rest
      '.rv{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;width:100%;max-width:420px}',
      '.rv[hidden]{display:none}',
      '.rv button{all:unset;box-sizing:border-box;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;padding:0 18px;cursor:pointer;',
      '  font-size:15px;font-weight:600;letter-spacing:-0.2px;white-space:nowrap;color:' + v('ink') + ';background:' + v('key') + ';touch-action:manipulation;',
      '  -webkit-tap-highlight-color:transparent;transition:background-color .2s ease,transform .12s ease,opacity .2s ease}',
      '.rv button:active{transform:scale(0.96)}',
      '.rv.review{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}',
      '.rv.review[hidden]{display:none}',
      '.rv button.go{grid-column:1 / -1;height:48px;border-radius:24px;background:' + C.SELECTED_BG + ';color:' + C.SELECTED_TEXT + ';font-size:17px}',
      '.rv button[aria-disabled="true"]{opacity:.4;cursor:default}',
      '.rv .tm{grid-column:1 / -1;text-align:center;font-size:13px;font-weight:600;color:' + v('ink-2') + ';font-variant-numeric:tabular-nums;height:17px;line-height:17px}',

      // THE ROOMS: one panel (a card in a sheet: SP's radius and inset)
      '.pick{display:flex;flex-direction:column;gap:' + SPC.block + 'px;min-width:0;padding:' + C.SP.cardPad + ';border-radius:' + C.SP.cardR + 'px;',
      '  background:' + v('key') + '}',
      '.ph{display:flex;align-items:center;gap:12px;min-height:44px;margin:-6px 0 -4px}',
      '.ph .lab{flex:1}',
      '.lab{' + C.labelCss('label') + '}',
      '.cnt{font-size:13px;font-weight:500;color:' + v('ink-3') + ';font-variant-numeric:tabular-nums}',
      '.clr{all:unset;box-sizing:border-box;min-height:44px;padding:0 4px;display:flex;align-items:center;cursor:pointer;font-size:15px;font-weight:600;',
      '  color:#0a84ff;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      '.clr[aria-disabled="true"]{color:' + v('ink-3') + ';cursor:default}',
      '.sec{display:flex;flex-direction:column;gap:' + SPC.block + 'px}',
      '.sec[hidden]{display:none}',
      '.chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.chips:empty{display:none}',
      '.rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:' + GAP + 'px}',
      '.rooms:empty{display:none}',
      '@container (max-width:479px){.rooms{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}}',
      '.pill{min-width:0;position:relative;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
      // a group: a capsule as wide as its name
      '.chips .pill{height:44px;border-radius:22px;padding:0 18px;display:flex;align-items:center}',
      '.chips .pill .l b{font-weight:inherit;white-space:nowrap}',
      // A preset is a shortcut, not another room: the dashed border says "this fills the boxes below" (the speaker picker's)
      '.pill.preset{border:var(--hk-look-dash, ' + C.M.border + ');border-style:dashed}',
      '.pill.preset[aria-pressed="true"]{border-style:solid}',
      // a room: a row with its tick, its name and what's true of it (Plays with ..., Quiet hours), its glyph at the end
      '.rooms .pill{min-height:54px;border-radius:' + C.SP.cardR + 'px;display:flex;align-items:center;gap:10px;padding:8px 14px 8px 10px;text-align:left}',
      '.tk{width:26px;height:26px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 2px ' + v('line-strong') + ';display:grid;place-items:center}',
      '.tk svg{width:15px;height:15px;fill:#fff;display:none}',
      '.pill[aria-pressed="true"] .tk{background:#0a84ff;box-shadow:none}',
      '.pill[aria-pressed="true"] .tk svg{display:block}',
      '.rooms .pill > span.l{flex:1;min-width:0;display:flex;flex-direction:column;line-height:18px}',
      // a name too long for its pill ends in "…", whole names in the aria-label (2026-11-07, the owner: "Names are getting clipped off")
      '.rooms .l b{display:block;min-width:0;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rooms .l i{font-style:normal;font-size:13px;font-weight:500;line-height:16px;color:' + v('ink-3') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pill[aria-pressed="true"] .l i{color:rgba(0,0,0,0.55)}',
      '.pill .pi{flex:none;display:flex;align-items:center;pointer-events:none;color:' + v('glyph') + '}',
      '.pill .pi svg{width:18px;height:18px;display:block;fill:currentColor}',
      '.pill[aria-pressed="true"] .pi{color:rgba(0,0,0,0.68)}',
      '.pill.skip{opacity:0.5}',
      '.pill.skip[aria-pressed="true"]{opacity:1}',
      '.pill:focus-visible,button:focus-visible{outline:2px solid ' + v('ink-2') + ';outline-offset:2px}',
      '.none{color:' + v('ink-2') + ';font-size:15px;text-align:center;padding:36px 12px}',

      // NARROW (a phone): the Lock sheet's phone button, the rooms two across, a long name on two lines
      '@container (max-width:479px){.mb{width:228px;height:228px}.mb .core{width:166px;height:166px}.mb .core svg{width:64px;height:64px}',
      '  .wd{font-size:32px;line-height:38px}.rooms .pill{min-height:48px;padding:7px 10px 7px 8px;gap:8px}.tk{width:22px;height:22px}',
      '  .pick{padding:14px}}',
      // A SHORT SCREEN (a phone on its side, 2026-11-05, the owner: "that doesn't look good at all"): a narrow talk side
      // with a smaller button; the groups one row that scrolls sideways; the rooms scroll in their own panel, so the
      // button stays beside them; everything fits the sheet's height
      '@media (max-height:520px){.mb{width:100px;height:100px}.mb .core{width:74px;height:74px}.mb .core svg{width:32px;height:32px}',
      '  .mb .trk,.mb .prg{stroke-width:10}',
      '  .wd{font-size:22px;line-height:26px;letter-spacing:-0.4px}.mt{font-size:13px;line-height:17px;min-height:17px}.line{font-size:13px;line-height:17px;min-height:0}',
      '  .line:empty{display:none}.talk{gap:8px}.mic{gap:4px}.rv{gap:6px}.rv button{padding:0 14px}',
      // (after a send the button and "Sent to 2 rooms" say it: the word steps aside for Play and Send Again)
      '  .talk:has(.rv:not([hidden])) .wd{display:none}',
      '  .pick{padding:12px 14px;gap:10px;max-height:calc(100dvh - 128px);overflow-y:auto;overscroll-behavior:contain}',
      '  .chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -14px;padding:0 14px;overscroll-behavior-x:contain}',
      '  .chips::-webkit-scrollbar{display:none}.chips .pill{flex:none}',
      '  .rooms{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.rooms .pill{min-height:48px;padding:6px 10px 6px 8px;gap:8px}.tk{width:22px;height:22px}}',
      '@media (max-height:520px){@container (min-width:600px){.cols{display:grid;grid-template-columns:200px minmax(0,1fr);align-items:start;gap:16px}}}',
      '@media (prefers-reduced-motion:reduce){.mb,.mb .core,.mb .prg,.rv button,.line{transition:none}.mb:active .core,.rv button:active{transform:none}',
      '  .mic[data-kind="busy"] .core{animation:none}}'
    ].join('');

    class HkIntercomSheet extends HkBase {
      static get CSS() { return SHEET_CSS; }
      _sigOf() { return null; }
      getCardSize() { return 8; }
      setConfig(config) { super.setConfig(config || {}); }
      _receiveClient() {
        super._receiveClient();
        sharedAttach(this.client);
        var self = this;
        if (!this._off) this._off = sharedUse(function () { self._fed(); });
        if (!this._ctl) {
          this._ctl = /** @type {any} */ (new Controller(depsFor(this.client, function () { self._paint(); })));
          this._clientRef = this.client;
          // the microphone module (hk-mic.js) comes with the sheet; drawn again when it is here
          needMic().then(function () { self._paint(); if (self._ctl) self._ctl.warm(); });
        }
        this._clientRef = this.client;
        this._paint();
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this.client) this._receiveClient();
      }
      disconnectedCallback() {
        // the sheet closed: the microphone off, the socket gone (hk-mic.js), the copy with them
        if (this._off) { this._off(); this._off = null; }
        if (this._ctl) { this._ctl.dispose(); this._ctl = null; }
        if (super.disconnectedCallback) super.disconnectedCallback();
      }
      _fed() {
        if (!this._ctl) return;
        this._ctl.remembered(shared.mem);
        this._ctl.fed();
      }
      _render() { this._build(); this._paint(); }
      _build() {
        if (this._built) return;
        this._built = true;
        this._root.innerHTML =
          '<div class="sh"><div class="cols"><div class="talk foot"><div class="seg" role="tablist" aria-label="Mode" hidden></div>' +
          '<div class="mic" data-kind="idle"><button class="mb" type="button" aria-label="Record">' +
          '<svg class="ring" viewBox="0 0 236 236" aria-hidden="true"><circle class="trk" cx="118" cy="118" r="112"/>' +
          '<circle class="prg" cx="118" cy="118" r="112" pathLength="1" transform="rotate(-90 118 118)"/></svg>' +
          '<span class="core">' + svg('mic') + '</span></button><div class="wd"></div><div class="mt"></div></div>' +
          '<div class="line" role="status" aria-live="polite"></div><div class="rv" hidden></div></div>' +
          '<div class="pick"><div class="ph"><span class="lab">To</span><span class="cnt"></span>' +
          '<button class="clr" type="button">Clear All</button></div>' +
          '<div class="sec gsec" hidden><div class="grid chips"></div></div>' +
          '<div class="sec rsec"><div class="grid rooms"></div></div><div class="none" hidden></div></div></div></div>';
        var self = this, q = this._root.querySelector.bind(this._root);
        this._e = { seg: q('.seg'), pick: q('.pick'), gsec: q('.gsec'), rsec: q('.rsec'), chips: q('.chips'), rooms: q('.rooms'), none: q('.none'), line: q('.line'), mic: q('.mic'), mb: q('.mb'), mt: q('.mt'), rv: q('.rv'), foot: q('.foot'),
          core: q('.core'), wd: q('.wd'), cnt: q('.cnt'), clr: q('.clr') };
        this._e.clr.addEventListener('click', function (e) { e.stopPropagation(); if (self._ctl && self._e.clr.getAttribute('aria-disabled') !== 'true') self._ctl.clearRooms(); });
        var mb = this._e.mb, down = false;
        // POINTER EVENTS, with pointercancel. The press makes and resumes the AudioContext (hk-mic.js unlock) and Message
        // acts on the release, so a finger that slides off or is taken by the system starts nothing.
        mb.addEventListener('pointerdown', function (e) {
          e.preventDefault(); e.stopPropagation();
          if (e.button) return;
          down = true;
          try { mb.setPointerCapture(e.pointerId); } catch (x) { /* old engine */ }
          if (self._ctl) self._ctl.micDown();
        });
        mb.addEventListener('pointerup', function (e) {
          e.stopPropagation();
          if (!down) return;
          down = false;
          if (self._ctl) self._ctl.micUp();
        });
        mb.addEventListener('pointercancel', function (e) {
          e.stopPropagation();
          if (!down) return;
          down = false;
          if (self._ctl) self._ctl.micCancel();
        });
        mb.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        // a keyboard's Enter or Space is a click with no pointer
        mb.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!self._ctl) return;
          if (e.detail === 0) { self._ctl.micDown(); self._ctl.micUp(); }
          else self._ctl.unlock();              // a touch's click is a user activation too: the context is resumed again
        });
        this._e.seg.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('button[data-mode]');
          if (b && self._ctl) { var was = self._e.seg.querySelector('.sel'), from = was && C.segBox ? C.segBox(was) : null; self._ctl.setMode(b.getAttribute('data-mode')); self._slide = from; }
        });
        var pick = function (e) {
          var b = e.target.closest && e.target.closest('[data-room],[data-chip]');
          if (!b || !self._ctl) return;
          if (b.hasAttribute('data-room')) self._ctl.toggleRoom(b.getAttribute('data-room'));
          else self._ctl.chip(b.getAttribute('data-kind'), b.getAttribute('data-chip'));
        };
        this._e.chips.addEventListener('click', pick);
        this._e.rooms.addEventListener('click', pick);
        [this._e.chips, this._e.rooms].forEach(function (g) {
          g.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pill')) { e.preventDefault(); pick(e); } });
        });
        this._e.rv.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('button[data-act]');
          if (b && b.getAttribute('aria-disabled') !== 'true' && self._ctl) self._ctl.do(b.getAttribute('data-act'));
        });
      }
      _pill(p, chip) {
        var on = p.on;
        var cls = 'pill' + (chip && p.kind === 'preset' ? ' preset' : '') + (!chip && (!p.pickable || p.quiet) ? ' skip' : '') + (!chip && p.glyph ? ' hg' : '');
        var attrs = chip ? 'data-chip="' + esc(p.id) + '" data-kind="' + p.kind + '"' : 'data-room="' + esc(p.id) + '"';
        return '<div class="' + cls + '" role="button" tabindex="0" aria-pressed="' + (on ? 'true' : 'false') + '" ' + attrs + ' aria-label="' + esc(chip ? p.name : p.aria) + '">' +
          (chip ? '' : '<span class="tk">' + svg('tick') + '</span>') +
          '<span class="l"><b>' + esc(p.name) + '</b>' + (!chip && p.cap ? '<i>' + esc(p.cap) + '</i>' : '') + '</span>' +
          (!chip && p.glyph ? '<span class="pi">' + svg(p.glyph) + '</span>' : '') + '</div>';
      }
      _paint() {
        if (!this._built || !this._ctl) return;
        var e = this._e, view = this._ctl.view(), self = this;
        // the mode switch: only where Live is offered
        var segKey = JSON.stringify(view.modes);
        if (segKey !== this._segKey) {
          this._segKey = segKey;
          e.seg.hidden = !view.modes.length;
          e.seg.innerHTML = view.modes.map(function (m) { return '<button type="button" role="tab" data-mode="' + m.id + '" aria-selected="' + m.on + '"' + (m.disabled ? ' aria-disabled="true"' : '') + (m.on ? ' class="sel"' : '') + '>' + m.label + '</button>'; }).join('');
          if (this._slide && C.slideSeg) { var now = e.seg.querySelector('.sel'); if (now) C.slideSeg(now, this._slide); this._slide = null; }
        }
        // the chips and pills, drawn again only when they differ
        var cKey = JSON.stringify(view.chips.map(function (c) { return [c.kind, c.id, c.name, c.on]; }));
        if (cKey !== this._cKey) { this._cKey = cKey; e.chips.innerHTML = view.chips.map(function (c) { return self._pill(c, true); }).join(''); }
        var rKey = JSON.stringify(view.pills.map(function (p) { return [p.id, p.name, p.glyph, p.cap, p.on, p.pickable, p.quiet]; }));
        if (rKey !== this._rKey) { this._rKey = rKey; e.rooms.innerHTML = view.pills.map(function (p) { return self._pill(p, false); }).join(''); }
        var empty = !view.pills.length;
        e.gsec.hidden = !view.chips.length;
        e.rsec.hidden = empty;
        e.none.hidden = !empty;
        if (empty) e.none.textContent = !this._ctl.d.hasPort() ? WORDS.needsHost : !view.enabled ? WORDS.off : this._ctl.feed() ? 'No rooms to talk to yet.' : WORDS.connecting;
        // the rooms panel's head: how many, Clear All
        var cnt = view.count.of ? view.count.on + ' of ' + view.count.of : '';
        if (e.cnt.textContent !== cnt) e.cnt.textContent = cnt;
        e.clr.setAttribute('aria-disabled', view.canClear ? 'false' : 'true');
        // the talk side: the button, its word, the status, the buttons after a send
        if (e.line.textContent !== view.status.text) e.line.textContent = view.status.text;
        e.line.setAttribute('data-kind', view.status.kind);
        var m = view.mic;
        e.mic.hidden = m.hidden;
        e.mic.setAttribute('data-kind', m.kind);
        e.mic.style.setProperty('--lv', String(Math.round(m.level * 100) / 100));
        e.mic.style.setProperty('--ring', String(Math.round(m.ring * 1000) / 1000));
        e.mb.setAttribute('aria-label', m.label);
        var glyph = m.kind === 'rec' ? 'stop' : m.kind === 'live' ? 'waveform' : 'mic';
        if (glyph !== this._glyph) { this._glyph = glyph; e.core.innerHTML = svg(glyph); }
        if (e.wd.textContent !== m.word) e.wd.textContent = m.word;
        if (e.mt.textContent !== m.time) e.mt.textContent = m.time;
        var aKey = JSON.stringify([view.actions, view.stamp, view.state]);
        e.rv.hidden = !view.actions.length;
        e.rv.classList.toggle('review', view.state === 'review');
        if (aKey !== this._aKey) {
          this._aKey = aKey;
          e.rv.innerHTML = view.actions.length
            ? (view.state === 'review' ? '<div class="tm">' + esc(view.stamp) + '</div>' : '') + view.actions.map(function (a) {
                return '<button type="button" data-act="' + a.id + '" class="' + (a.primary ? 'go' : '') + '" aria-disabled="' + (a.disabled ? 'true' : 'false') + '">' + esc(a.label) + '</button>';
              }).join('') : '';
        }
      }
    }
    C.register('hk-intercom-sheet-card', HkIntercomSheet, 'HK Intercom Sheet', 'The Intercom’s sheet: rooms, the microphone, review and send.', null, function () { return {}; });
    if (C.unlisted) C.unlisted('hk-intercom-sheet-card');
    window.hkIntercom.Sheet = HkIntercomSheet;
  });
})();
