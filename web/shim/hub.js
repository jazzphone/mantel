// hub.js -- the page's connection to Mantel Server: the state hub (/ws) plus reads, and commands
// when the server allows them.
//
// The socket's address follows the page's prefix (shim/base.js: HA App mode serves Mantel under HA's
// Ingress path; '' everywhere else).
// One WebSocket. Frames the page receives: snapshot / diff (states), read_result / read_event
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

export class Hub {
  constructor() {
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();      // id -> {resolve, reject, cb, command}
    this.capabilities = null;      // the server's {commands, door}, when it sends one
    this.wanted = null;            // the last subscribe frame, sent again on each new socket
    this.retry = RETRY_MIN;
    this.onSnapshot = () => {};
    this.onDiff = () => {};
    this.onCapabilities = () => {};
    this.bytes = 0; this.msgs = 0; // what arrived, for the numbers in the page's console
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(wsUrl('/ws')));
      const again = this.connected;
      ws.onopen = () => {
        this.connected = true;
        this.retry = RETRY_MIN;
        if (again) this._resume();
        resolve();
      };
      ws.onerror = () => reject(new Error('hub connection failed'));
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this._dropCommands();
        if (this.closing) return;
        const wait = this.retry * (0.75 + Math.random() / 2);
        this.retry = Math.min(this.retry * 2, RETRY_MAX);
        setTimeout(() => {
          this.connect().then(() => { if (this.onReconnect) this.onReconnect(); }, () => { /* its own close retries */ });
        }, wait);
      };
      ws.onmessage = (ev) => {
        this.msgs++; this.bytes += ev.data.length;
        const m = JSON.parse(ev.data);
        if (m.type === 'snapshot') this.onSnapshot(m);
        else if (m.type === 'diff') this.onDiff(m);
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
          this.capabilities = m;
          this.onCapabilities(m);
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
        } else if (m.type === 'error') {
          const p = m.id != null ? this.pending.get(m.id) : null;
          if (p && p.command) { this.pending.delete(m.id); p.resolve({ type: 'command_result', error: { code: m.code, message: m.message } }); }
          else console.warn('[hub]', m.code, m.message || '');
        }
      };
    });
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
  }

  _open() { return !!this.ws && this.ws.readyState === 1; }

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

  // true only after this socket's server said so (capabilities); never assumed
  commandsEnabled() { return !!(this.capabilities && this.capabilities.commands === true); }

  // one gateway command ({kind, ...}); resolves with the server's reply (command_result). Refused here, sending nothing, unless the server enabled commands.
  command(body) {
    if (!this.commandsEnabled()) {
      return Promise.resolve({ type: 'command_result', error: { code: 'commands_disabled', message: 'commands are disabled' } });
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
