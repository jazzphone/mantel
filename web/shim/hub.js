// hub.js -- the page's connection to Mantel Server: the state hub (/ws) plus reads.
//
// One WebSocket. Frames the page receives: snapshot / diff (states), read_result / read_event
// (the server's ReadProxy), error. Nothing the page sends can change anything: the server answers
// every command with `commands_disabled` and has a read-only allowlist for `read`.
export class Hub {
  constructor() {
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();      // id -> {resolve, reject, cb}
    this.onSnapshot = () => {};
    this.onDiff = () => {};
    this.bytes = 0; this.msgs = 0; // what arrived, for the numbers in the page's console
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`));
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('hub connection failed'));
      ws.onclose = () => { if (!this.closing) setTimeout(() => this.connect().then(() => this.onReconnect && this.onReconnect()), 2000); };
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
        } else if (m.type === 'error') console.warn('[hub]', m.code, m.message || '');
      };
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

  readSubscribe(msg, cb) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(() => { this.pending.delete(id); this.ws.send(JSON.stringify({ type: 'read_unsubscribe', id })); }), reject, cb });
      this.ws.send(JSON.stringify({ type: 'read_subscribe', id, msg }));
    });
  }
}
