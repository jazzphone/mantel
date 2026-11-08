// hub.js -- the page's connection to Mantel Server: the state hub (/ws) plus reads, and commands
// when the server allows them.
//
// The socket's address follows the page's prefix (shim/base.js: HA App mode serves Mantel under HA's
// Ingress path; '' everywhere else).
// One WebSocket. Frames the page receives: snapshot / diff (states), registry (the registries changed:
// registry-sync.js), read_result / read_event
// (the server's filtered reads), settings_result (HK's own settings saves, `write`), error, and --
// only on a server whose operator turned the command gateway on -- capabilities and command_result
// (step_up_required only from an older server; refused by mantel-client.js). On a server with commands off
// (the default) nothing the page sends can change anything: the server answers every command with
// `commands_disabled`, never says `capabilities`, and the page offers no actions at all.
import { wsUrl } from './base.js';

// A SOCKET THAT DROPS (a Wi-Fi blip, Mantel restarting, a tablet waking): the server streams states only
// after `subscribe`, and a feed only after its `read_subscribe`, per socket. So the hub keeps what the page
// asked for and asks again on the new socket: the last subscription (its snapshot replaces what the page
// holds), and every live feed under its own id (its unsubscribe keeps working). A WebRTC offer is answered
// for one peer connection only: it is ended with an error event instead, and the card starts again. Retries
// back off from 2 to 30 seconds, with jitter, so a house of tablets doesn't come back at the same instant.
const ONE_SHOT = new Set(['camera/webrtc/offer']);
const RETRY_MIN = 2000;
const RETRY_MAX = 30000;
const lost = () => Object.assign(new Error('connection lost'), { code: 'unavailable', message: 'connection lost' });

// A TABLET THAT SLEPT (iPad Safari, Fully Kiosk): on waking its socket can be half-open, still OPEN to the page
// while nothing comes through, so the page kept the states it had when it went to sleep, for good. So the page
// checks: when it is shown again (visibilitychange), restored from the back-forward cache (pageshow), back on
// the network (online) or focused, and every 45 s while it is visible (a wall tablet is "visible" for weeks), it
// pings the server; no pong in 3 s and the socket is let go (cycle), and the reconnect above starts. Never while
// the socket is not open (a reconnect pending or opening), one check at a time, and not again within 10 s of the
// last, so the four events a wake fires together send one ping.
const LIVE_PING = 3000;
const LIVE_EVERY = 45000;
const LIVE_GAP = 10000;
// BACK AT ONCE (2026-11-08, the iPhone app: "things don't load all the way and it is unresponsive"): iOS closes a
// suspended app's sockets, and the page that comes back found its socket closed with the reconnect still waiting out
// its back-off (2 s at best, 30 s after a few refusals while the phone was locked -- a timer iOS froze, not skipped).
// Every press meanwhile was answered "connection lost" and did nothing. So a page shown again, focused or back online
// whose socket is not open reconnects NOW (`wake`), and a silent socket the liveness check let go is replaced at once.
// A PRESS BETWEEN SOCKETS IS HELD, NOT LOST: what the last socket's server said about commands is kept while the next
// one opens (the controls stay live), and a press then waits for that socket, up to HOLD, and is sent on it -- or
// answered `unavailable` if none opened. Nothing is sent before the new socket's server has spoken: `capabilities` is
// the first frame a server with commands on sends (server.py run()), so a new socket whose first frame is anything
// else -- or that says nothing in CAPS_WAIT -- is a server with commands off, and the kept answer goes (the press is
// then refused in the page, sending nothing: the commands-off contract, tests/test_web_lifecycle.py). A socket down
// longer than CAPS_KEEP lets the kept answer go too, so a page cut off for good offers no controls.
const HOLD = 5000;
const CAPS_WAIT = 1500;
const CAPS_KEEP = 10000;

export class Hub {
  constructor() {
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();      // id -> {resolve, reject, cb, command}
    this.intercoms = new Map();    // id -> cb(event, error): the Intercom feed (intercomSubscribe), asked for again by _resume
    this.capabilities = null;      // the server's {commands, door}, when it sends one
    this.wanted = null;            // the last subscribe frame, sent again on each new socket
    this.retry = RETRY_MIN;
    this.onSnapshot = () => {};
    this.onDiff = () => {};
    this.onCapabilities = () => {};
    // the digest of the registry this page may see: every snapshot's, and each `registry` frame's (registry-sync.js)
    this.onRegistry = () => {};
    // after each reconnect, once the new socket is open and the subscription and feeds were asked for again
    // (_resume): for what the page reads once at start and would otherwise keep from before the drop
    this.onReconnect = () => {};
    this.reconnects = 0;           // sockets opened again since this page loaded (page-health.js tells Mantel)
    this.bytes = 0; this.msgs = 0; // what arrived, for the numbers in the page's console
    this._checking = null;         // the liveness check under way (checkAlive)
    this._checked = 0;             // when the last one started
    this._spoken = false;          // this socket's server has said whether commands are on (BACK AT ONCE, above)
    this._spokenWaiters = [];      // presses held for that (command, HOLD)
    this._again = null;            // the reconnect waiting out its back-off: run early by wake()
    this._capsTimer = 0;           // CAPS_WAIT on a new socket
    this._keepTimer = 0;           // CAPS_KEEP on a closed one
    this._watch();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(wsUrl('/ws')));
      const again = this.connected;
      let over = false;
      ws.onopen = () => {
        this.connected = true;
        this.retry = RETRY_MIN;
        clearTimeout(this._keepTimer);
        this._spoken = false;
        clearTimeout(this._capsTimer);
        this._capsTimer = setTimeout(() => this._silent(ws), CAPS_WAIT);
        if (again) { this.reconnects++; this._resume(); }
        else for (const id of this.intercoms.keys()) this._send({ type: 'intercom/subscribe', id });     // (asked for before the socket was open)
        resolve();
      };
      ws.onerror = () => reject(new Error('hub connection failed'));
      // also called by cycle(), before the browser's own close event (late, or never, on a half-open socket)
      this._lose = ws.onclose = () => {
        if (this.ws !== ws || over) return;
        over = true;
        this._dropCommands();
        this._spoken = false;
        clearTimeout(this._capsTimer);
        // what this socket's server said is over with it, but kept while the next one opens (BACK AT ONCE): the
        // next one says again, or its silence takes it away (_silent); down for long, it goes anyway
        clearTimeout(this._keepTimer);
        if (this.closing) { this._forgetCaps(); return; }
        this._keepTimer = setTimeout(() => { if (!this._open()) this._forgetCaps(); }, CAPS_KEEP);
        const wait = this.retry * (0.75 + Math.random() / 2);
        this.retry = Math.min(this.retry * 2, RETRY_MAX);
        const again = () => {
          if (this._again !== again) return;           // run early by wake(), or a newer one took its place
          this._again = null;
          this.connect().then(() => { if (this.onReconnect) this.onReconnect(); }, () => { /* its own close retries */ });
        };
        this._again = again;
        setTimeout(again, wait);
      };
      ws.onmessage = (ev) => {
        this.msgs++; this.bytes += ev.data.length;
        const m = JSON.parse(ev.data);
        // the socket's first frame: `capabilities` from a server with commands on, anything else from one with them off
        if (!this._spoken && this.ws === ws && m.type !== 'capabilities') this._silent(ws);
        if (m.type === 'snapshot') { if (m.registry) this.onRegistry(m.registry); this.onSnapshot(m); }
        else if (m.type === 'diff') this.onDiff(m);
        else if (m.type === 'registry') this.onRegistry(m.digest);
        else if (m.type === 'read_result') {
          const p = this.pending.get(m.id);
          if (!p) return;
          if (!p.cb) this.pending.delete(m.id);
          if (m.error) p.reject(Object.assign(new Error(m.error.message || m.error.code), m.error));
          else p.resolve(m.result);
        } else if (m.type === 'read_event') {
          const p = this.pending.get(m.id);
          if (p && p.cb) p.cb(m.event);
        } else if (m.type === 'capabilities') {
          const had = this.capabilities;
          this.capabilities = m;
          // (the same answer again on a new socket: the page's clients already act on it, nothing to make again)
          if (!had || JSON.stringify(had) !== JSON.stringify(m)) this.onCapabilities(m);
          if (this.ws === ws) this._spoke();
        } else if (m.type === 'settings_result') {
          const p = this.pending.get(m.id);
          if (!p || !p.save) return;
          this.pending.delete(m.id);
          if (m.error) p.reject(Object.assign(new Error(m.error.message || m.error.code), m.error));
          else p.resolve(m.result);
        } else if (m.type === 'screen_result' || m.type === 'notify_mute_result' || m.type === 'tablets_restart_result'
                   || m.type === 'music_used_result' || m.type === 'tv_watching_result'
                   || m.type === 'user_data_set_result' || m.type === 'tablet_act_result') {
          // the feature host's answers to screen_report / notify_mute / tablets_restart / tv_watching, the music
          // host's to music_used (see ask())
          const p = this.pending.get(m.id);
          if (!p || !p.ask) return;
          this.pending.delete(m.id);
          if (m.error) p.reject(Object.assign(new Error(m.error.message || m.error.code), m.error));
          else p.resolve(m.result);
        } else if (m.type === 'command_result' || m.type === 'step_up_required') {
          const p = this.pending.get(m.id);
          if (p && p.command) { this.pending.delete(m.id); p.resolve(m); }
        } else if (m.type === 'intercom_result' || m.type === 'intercom_event') {
          // the Intercom feed (intercom/subscribe): the answer (null, or {error}), then the whole snapshot on every change
          const cb = this.intercoms.get(m.id);
          if (!cb) return;
          try {
            if (m.type === 'intercom_event') cb(m.event, null);
            else if (m.error) cb(null, m.error);
          } catch (e) { console.error('[hub]', e); }
        } else if (m.type === 'pong') {
          const waiting = this.pings || [];
          this.pings = [];
          for (const done of waiting) done();
        } else if (m.type === 'error') {
          const feed = m.id != null ? this.intercoms.get(m.id) : null;
          const p = m.id != null ? this.pending.get(m.id) : null;
          if (feed) { try { feed(null, { code: m.code, message: m.message }); } catch (e) { console.error('[hub]', e); } }
          else if (p && p.command) { this.pending.delete(m.id); p.resolve({ type: 'command_result', error: { code: m.code, message: m.message } }); }
          else console.warn('[hub]', m.code, m.message || '');
        }
      };
    });
  }

  // this socket's server said nothing about commands (its first frame was another, or CAPS_WAIT passed): they are off
  _silent(ws) {
    if (this.ws !== ws || this._spoken) return;
    this._forgetCaps();
    this._spoke();
  }

  _spoke() {
    clearTimeout(this._capsTimer);
    this._spoken = true;
    const w = this._spokenWaiters;
    this._spokenWaiters = [];
    w.forEach((f) => f(true));
  }

  _forgetCaps() {
    if (this.capabilities) { this.capabilities = null; this.onCapabilities(null); }
  }

  // resolves true once a socket is open and its server has spoken (_spoke), false after `ms`
  _whenSpoken(ms) {
    if (this._open() && this._spoken) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const fin = (ok) => { if (done) return; done = true; clearTimeout(t); resolve(ok); };
      const t = setTimeout(() => { this._spokenWaiters = this._spokenWaiters.filter((f) => f !== fin); fin(false); }, ms);
      this._spokenWaiters.push(fin);
    });
  }

  // BACK AT ONCE: a page shown again (the app back to the front, a tablet waking) whose socket is not open
  // reconnects now instead of waiting out its back-off; an open one is checked (checkAlive). The iPhone app also
  // calls this as it comes to the front (HouseWebView.wake).
  wake() {
    if (this.closing) return;
    const ws = this.ws;
    if (ws && ws.readyState >= 2) this.cycle();        // closed, or closing, with its close event not here yet
    if (this._open()) { this.checkAlive(); return; }
    const again = this._again;
    if (!again) return;                                // opening already
    this.retry = RETRY_MIN;
    again();
  }

  // a socket that closed answers no command, save or read: each waiting one is told, none is re-sent. A
  // feed (read_subscribe) stays, to be asked for again on the next socket (_resume), unless it is one-shot.
  _dropCommands() {
    for (const [id, p] of this.pending) {
      if (p.command) {
        this.pending.delete(id);
        p.resolve({ type: 'command_result', error: { code: 'unavailable', message: 'connection lost' } });
      } else if (p.cb && ONE_SHOT.has(p.msg && p.msg.type)) {
        this.pending.delete(id);
        p.reject(lost());
        try { p.cb({ type: 'error', code: 'unavailable', message: 'connection lost' }); } catch (e) { console.error('[hub]', e); }
      } else if (!p.cb) {
        this.pending.delete(id);
        p.reject(lost());
      }
    }
  }

  // a new socket after a dropped one: the subscription and the live feeds again
  _resume() {
    if (this.wanted) this._send(this.wanted);
    for (const [id, p] of this.pending) {
      if (p.cb && p.msg) this._send({ type: 'read_subscribe', id, msg: p.msg });
    }
    for (const id of this.intercoms.keys()) this._send({ type: 'intercom/subscribe', id });
  }

  _open() { return !!this.ws && this.ws.readyState === 1; }

  // let the current socket go and reconnect (the liveness check; a kiosk app's nudge, mantel-host.js): closed,
  // and handled as closed at once, so a half-open socket whose close never completes still gets a new one. A
  // late frame from it is not read.
  cycle() {
    const ws = this.ws;
    if (!ws) return;
    ws.onmessage = null;
    try { ws.close(); } catch (e) { /* closed already */ }
    if (this.ws === ws && this._lose) this._lose();
  }

  // the liveness check (A TABLET THAT SLEPT, above): resolves true when the socket answered (or was checked
  // moments ago), false when it was let go or is not open
  checkAlive() {
    if (this._checking) return this._checking;
    if (!this._open() || this.closing) return Promise.resolve(false);
    const now = Date.now();
    if (now - this._checked < LIVE_GAP) return Promise.resolve(true);
    this._checked = now;
    const ws = this.ws;
    const done = (alive) => { this._checking = null; return alive; };
    this._checking = this.ping(LIVE_PING).then(() => done(true), () => {
      if (this.ws === ws) { console.warn('[hub] no answer from Mantel in 3 s: reconnecting'); this.cycle(); this.wake(); }
      return done(false);
    });
    return this._checking;
  }

  // the page's own events, in a browser only (not in node's tests, which have no document events)
  _watch() {
    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;
    if (!doc || typeof doc.addEventListener !== 'function' || !win || typeof win.addEventListener !== 'function') return;
    const visible = () => doc.visibilityState !== 'hidden';
    const check = () => { this.wake(); };
    doc.addEventListener('visibilitychange', () => { if (visible()) check(); });
    win.addEventListener('pageshow', (e) => { if (e && e.persisted) check(); });
    win.addEventListener('online', check);
    win.addEventListener('focus', check);
    setInterval(() => { if (visible()) check(); }, LIVE_EVERY);
  }

  // the server's ping (server.py answers {type: ping} with a pong, no id): resolves when the socket answers
  // within `ms`, rejects when it is closed or silent (a half-open socket still reads OPEN)
  ping(ms = 5000) {
    if (!this._open()) return Promise.reject(lost());
    return new Promise((resolve, reject) => {
      let done = false;
      const waiter = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        this.pings = (this.pings || []).filter((w) => w !== waiter);     // a silent socket's waiters don't pile up
        reject(new Error('no pong'));
      }, ms);
      (this.pings || (this.pings = [])).push(waiter);
      this._send({ type: 'ping' });
    });
  }

  _send(frame) {
    if (!this._open()) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  // HK's own settings saves (P3.5): `msg` exactly as the page sends it to HA (hk_frontend/settings/set,
  // board/set, ...). Not a house command: Mantel's settings store answers it (RBAC `configure`), on
  // every server, commands on or off, and nothing reaches Home Assistant. Resolves with the store's
  // result, rejects with its error ({code, message}: HA's `invalid_format` field map, `forbidden`, ...).
  write(msg) {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(Object.assign(new Error('not connected'), { code: 'unavailable', message: 'not connected' }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, save: true });
      this.ws.send(JSON.stringify({ type: 'settings_write', id, msg }));
    });
  }

  // Mantel's own feature messages (docs/phase4/MANTEL-FEATURES.md): a screen's report and Mute 1 Hour.
  // Not house commands (nothing reaches Home Assistant): the feature host answers them on every server,
  // commands on or off. Resolve with the host's result, reject with its error ({code}).
  ask(type, body) {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(Object.assign(new Error('not connected'), { code: 'unavailable', message: 'not connected' }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ask: true });
      this.ws.send(JSON.stringify(Object.assign({ type, id }, body)));
    });
  }

  // a frame nobody answers (page_health.py): sent if the socket is open, else dropped
  tell(type, body) { return this._send(Object.assign({ type }, body)); }

  // {tablet, touch?, saver?, black?}: HK's hk_frontend/screensaver/touch and /black, for Mantel
  screenReport(frame) { return this.ask('screen_report', frame); }

  // Mute 1 Hour: {key, seconds}
  notifyMute(key, seconds) { return this.ask('notify_mute', { key, seconds }); }

  // Live TV's viewer heartbeat (HK's hk_tv/watching): the channel playing, or null when it stops.
  // Counted by Mantel (live_tv.py); resolves {viewers, ha} (ha: Home Assistant's Live TV is the interim)
  // `tablet`: the wall tablet this page is, when it is one -- its Sleep Screen keeps it awake while it plays
  tvWatching(channel, tablet) { return this.ask('tv_watching', tablet ? { channel, tablet } : { channel }); }

  // live talk's own socket (talk_relay.py), at the page's prefix like /ws; the card's Worker opens it
  // with a one-time ticket from a gateway `talk_live` command (mantel-client.js liveSocket)
  talkUrl() { return wsUrl('/ws/talk'); }

  // the Intercom's audio socket (intercom/relay.py), at the page's prefix like /ws; hk-mic.js's Worker opens it with a
  // one-time ticket from a gateway `intercom` command (mantel-client.js actions.intercom)
  intercomUrl() { return wsUrl('/ws/intercom'); }

  // THE INTERCOM FEED (docs/phase17/INTERCOM.md): the rooms this person may reach and how each would play, whole on
  // every change -- `cb(snapshot, null)`; a server that refuses or lacks the feed answers `cb(null, {code})`. Kept
  // until the returned function lets go, and asked for again on each new socket (_resume).
  intercomSubscribe(cb) {
    const id = this.nextId++;
    this.intercoms.set(id, cb);
    this._send({ type: 'intercom/subscribe', id });
    return () => { if (this.intercoms.delete(id)) this._send({ type: 'intercom/unsubscribe', id }); };
  }

  // true only after this socket's server said so (capabilities); never assumed
  commandsEnabled() { return !!(this.capabilities && this.capabilities.commands === true); }

  // one gateway command ({kind, ...}); resolves with the server's reply (command_result). Refused here, sending nothing, unless the server enabled commands.
  command(body) {
    if (!this.commandsEnabled()) {
      return Promise.resolve({ type: 'command_result', error: { code: 'commands_disabled', message: 'commands are disabled' } });
    }
    if (!this._open() || !this._spoken) {
      // between sockets (BACK AT ONCE): held for the next one, and its server's word on commands; an answer with a
      // code, never a send that throws, if none comes in time
      if (this.closing) return Promise.resolve({ type: 'command_result', error: { code: 'unavailable', message: 'connection lost' } });
      return this._whenSpoken(HOLD).then((ok) => (ok && this._open()
        ? this.command(body)
        : { type: 'command_result', error: { code: 'unavailable', message: 'connection lost' } }));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, command: true });
      this.ws.send(JSON.stringify(Object.assign({}, body, { type: 'command', id })));
    });
  }

  // kept, and sent at once when the socket is open (else on the next one: _resume)
  subscribe(entityIds, areas, all) {
    this.wanted = { type: 'subscribe', entity_ids: entityIds || [], areas: areas || [], all: !!all };
    this._send(this.wanted);
  }

  read(msg) {
    if (!this._open()) return Promise.reject(lost());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'read', id, msg }));
    });
  }

  // the one REST read Mantel offers (readproxy.REST_READS: GET calendars/<entity>?start&end), as
  // {type: 'read_api', id, method, path}; answered by read_result like read()
  readApi(method, path) {
    if (!this._open()) return Promise.reject(lost());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'read_api', id, method, path }));
    });
  }

  // a feed: kept until unsubscribed, and asked for again on each new socket (_resume) under the same id
  readSubscribe(msg, cb) {
    if (ONE_SHOT.has(msg && msg.type) && !this._open()) return Promise.reject(lost());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(() => { this.pending.delete(id); this._send({ type: 'read_unsubscribe', id }); }), reject, cb, msg });
      this._send({ type: 'read_subscribe', id, msg });
    });
  }
}
