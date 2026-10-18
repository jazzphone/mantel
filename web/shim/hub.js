// hub.js -- the page's connection to Mantel Server: the state hub (/ws) plus reads, and commands
// when the server allows them.
//
// The socket's address follows the page's prefix (shim/base.js: HA App mode serves Mantel under HA's
// Ingress path; '' everywhere else).
// One WebSocket. Frames the page receives: snapshot / diff (states), read_result / read_event
// (the server's filtered reads), settings_result (HK's own settings saves, `write`), error, and --
// only on a server whose operator turned the command gateway on -- capabilities, command_result and
// step_up_required. On a server with commands off
// (the default) nothing the page sends can change anything: the server answers every command with
// `commands_disabled`, never says `capabilities`, and the page offers no actions at all.
import { wsUrl } from './base.js';

export class Hub {
  constructor() {
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();      // id -> {resolve, reject, cb, command}
    this.capabilities = null;      // the server's {commands, step_up_window, door}, when it sends one
    this.onSnapshot = () => {};
    this.onDiff = () => {};
    this.onCapabilities = () => {};
    this.bytes = 0; this.msgs = 0; // what arrived, for the numbers in the page's console
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(wsUrl('/ws')));
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('hub connection failed'));
      ws.onclose = () => {
        this._dropCommands();
        if (!this.closing) setTimeout(() => this.connect().then(() => this.onReconnect && this.onReconnect()), 2000);
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
        } else if (m.type === 'screen_result' || m.type === 'notify_mute_result' || m.type === 'tablets_restart_result' || m.type === 'tv_watching_result') {
          // the feature host's answers to screen_report / notify_mute / tablets_restart / tv_watching (see ask())
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

  // a socket that closed answers no command or save: each waiting one is told, none is re-sent
  _dropCommands() {
    for (const [id, p] of this.pending) {
      if (p.command) {
        this.pending.delete(id);
        p.resolve({ type: 'command_result', error: { code: 'unavailable', message: 'connection lost' } });
      } else if (p.save || p.ask) {
        this.pending.delete(id);
        p.reject(Object.assign(new Error('connection lost'), { code: 'unavailable', message: 'connection lost' }));
      }
    }
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

  // {tablet, touch?, saver?, black?}: HK's hk_frontend/screensaver/touch and /black, for Mantel
  screenReport(frame) { return this.ask('screen_report', frame); }

  // Mute 1 Hour: {key, seconds}
  notifyMute(key, seconds) { return this.ask('notify_mute', { key, seconds }); }

  // Live TV's viewer heartbeat (HK's hk_tv/watching): the channel playing, or null when it stops.
  // Counted by Mantel (live_tv.py); resolves {viewers, ha} (ha: Home Assistant's Live TV is the interim)
  tvWatching(channel) { return this.ask('tv_watching', { channel }); }

  // live talk's own socket (talk_relay.py), at the page's prefix like /ws; the card's Worker opens it
  // with a one-time ticket from a gateway `talk_live` command (mantel-client.js liveSocket)
  talkUrl() { return wsUrl('/ws/talk'); }

  // true only after this socket's server said so (capabilities); never assumed
  commandsEnabled() { return !!(this.capabilities && this.capabilities.commands === true); }

  // one gateway command ({kind, ...}); resolves with the server's reply (command_result or
  // step_up_required). Refused here, sending nothing, unless the server enabled commands.
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

  subscribe(entityIds, areas, all) {
    this.ws.send(JSON.stringify({ type: 'subscribe', entity_ids: entityIds || [], areas: areas || [], all: !!all }));
  }

  read(msg) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'read', id, msg }));
    });
  }

  // the one REST read Mantel offers (readproxy.REST_READS: GET calendars/<entity>?start&end), as
  // {type: 'read_api', id, method, path}; answered by read_result like read()
  readApi(method, path) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'read_api', id, method, path }));
    });
  }

  readSubscribe(msg, cb) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(() => { this.pending.delete(id); this.ws.send(JSON.stringify({ type: 'read_unsubscribe', id })); }), reject, cb });
      this.ws.send(JSON.stringify({ type: 'read_subscribe', id, msg }));
    });
  }
}
