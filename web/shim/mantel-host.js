// mantel-host.js (was hass-shim.js) -- a `hass`-shaped snapshot for HK's cards, built from Mantel Server instead of Home Assistant.
//
// The hub client (hub.js) feeds it: states and diffs from the state hub, the registries as HA's
// frontend holds them, HK's captured feeds (fixtures) and live reads through the server's ReadProxy.
// Everything the Home page touches on `hass` is here; docs/proof1/APPROACH.md lists it.
//
// RULES
//  * A NEW hass object after every change (cards compare `hass` by identity in `set hass`).
//  * callService and every write REFUSE: nothing is sent, a toast says so. Shared code acts through
//    HKClient's action port, which refuses before it reaches this object (mantel-client.js); these
//    stay as the backstop for card families that still hold the snapshot.
//  * `document.querySelector('home-assistant' | 'hui-root' | ...)` returns a stub object (never an
//    element), so HK's lookups work without any HA element existing in the page.

export function iso(ts) { return ts == null ? null : new Date(ts * 1000).toISOString(); }

export function stateObj(entityId, s) {
  return {
    entity_id: entityId, state: String(s.s), attributes: s.a || {},
    last_changed: iso(s.lc), last_updated: iso(s.lu), context: { id: '', parent_id: null, user_id: null },
  };
}

// A wall tablet's screens (see SCREENS in Host): the ids of the two switches the adapter keeps for it
export const SCREEN_SETTLE_MS = 400;
const TABLET_ID =/^[a-z0-9_]{1,40}$/;
const SCREEN_ENTITY = /^switch\.mantel_([a-z0-9_]{1,40})_(?:black_screen|photo_screensaver)$/;
export function screenEntity(tid, kind) { return `switch.mantel_${tid}_${kind === 'black' ? 'black_screen' : 'photo_screensaver'}`; }
function screenState(id, on, attributes) {
  const now = new Date().toISOString();
  return { entity_id: id, state: on ? 'on' : 'off', attributes: Object.assign({}, attributes),
           last_changed: now, last_updated: now, context: { id: '', parent_id: null, user_id: null } };
}

// Writes are never sent. Reads go to the server, which has its own allowlist.
const WRITE_WORDS = /(^|\/|_)(set|save|remove|delete|add|update|create|call_service|order|favorite|touch|black|seen|mute|test|sign|queue|play|transfer|talk|offer|candidate)(_|\/|$)/;

// CAMERA LIVE VIEW (docs/phase3/CONNECTORS.md "Camera flow"): the camera card's WebRTC signaling goes
// to Mantel's camera connector exactly as the card sends it to HA -- the client config and its
// candidates as reads (hub.read), the offer as a read subscription (hub.readSubscribe). The server
// decides each with the camera live-view rules (RBAC, the door) and owns the session checks. These
// are viewing, never commands, so they are answered before the WRITE_WORDS backstop below.
export const CAMERA_READS = new Set(['camera/webrtc/get_client_config', 'camera/webrtc/candidate']);
export const CAMERA_SUBSCRIPTIONS = new Set(['camera/webrtc/offer']);
// MUSIC (interim, until Phase 4 moves the engine): the queue is a read whose name carries a write word.
// The server's allowlist forwards only hk_music/subscribe, /queue and /settings/library (readproxy.py);
// hk_music/queue_play and every other hk_music/* write still meet WRITE_WORDS here.
export const NAMED_READS = new Set(['hk_music/queue']);
// CALENDARS: HK's calendar card reads events with callApi('GET', 'calendars/<entity>?start=&end='),
// Mantel's one REST read (read_api, RBAC `view` of the calendar). Any other REST call stays refused.
// (Camera stills need nothing here: the server already gives each camera state an entity_picture on
// Mantel's own still route, under the page's prefix, and never HA's token.)
const CALENDAR_PATH = /^\/?(?:api\/)?calendars\/calendar\.[a-z0-9_]+\?/;
export function calendarPath(method, path) {
  if (String(method || '').toUpperCase() !== 'GET' || typeof path !== 'string' || !CALENDAR_PATH.test(path)) return null;
  return path.replace(/^\/?(?:api\/)?/, '');
}

// Mantel's refusals ("Commands are disabled") are said in HK's own toast layer once it has loaded
// (web/hk/shell/hk-overlays.js), like every toast of HK's; this box is only the fallback before it.
export function toast(text) {
  if (typeof window !== 'undefined' && window.hkOverlays) { window.hkOverlays.toast({ message: text, duration: 2600 }); return; }
  let box = document.getElementById('mantel-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'mantel-toast';
    box.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483000;' +
      'background:rgba(30,30,32,.94);color:#fff;font:600 14px -apple-system,system-ui,sans-serif;padding:10px 18px;' +
      'border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:none;transition:opacity .25s';
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.style.opacity = '1';
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.style.opacity = '0'; }, 2600);
}

export class Host {
  constructor({ hub, registry, fixtures, user, config, themes }) {
    this.hub = hub;
    this.fixtures = fixtures;               // {message type: captured payload}
    this.refused = [];                      // what the page tried to write (shown by tests and /dev tools)
    this.calls = new Map();                 // message type -> times asked (the measured surface)
    this.reads = new Set();                 // entity ids read through hass.states after the build
    this.recording = false;
    // a read of an id the current (narrowed) subscription does not carry: home.js asks the hub for it
    // (onMiss), so a card that reads something later than the recorded pass still gets its state
    this.onMiss = null;
    this._states = {};
    // Mantel's own screens (see "SCREENS" below): states HK reads as it reads a tablet's switches in HA
    this._overlay = {};                     // entity id -> state object
    this._merged = this._states;            // what hass.states shows: the hub's states plus the overlay
    this._tablets = new Set();              // wall tablets the settings feed named
    this._screensReady = false;             // the events feed answered: the defaults (off) are true
    const self = this;
    const listeners = new Map();
    this.connection = {
      subscribeMessage: (cb, msg) => self._subscribe(cb, msg),
      sendMessagePromise: (msg) => self._call(msg),
      addEventListener: (n, fn) => { (listeners.get(n) || listeners.set(n, new Set()).get(n)).add(fn); },
      removeEventListener: (n, fn) => { const l = listeners.get(n); if (l) l.delete(fn); },
      socket: { readyState: 1 },
      haVersion: 'mantel',
    };
    const raw = {
      states: {}, entities: registry.entities, devices: registry.devices, areas: registry.areas,
      floors: registry.floors, config, themes, user,
      language: 'en',
      locale: { language: 'en', number_format: 'language', time_format: 'language', date_format: 'language',
                time_zone: 'local', first_weekday: 'language' },
      selectedLanguage: null, selectedTheme: null, panelUrl: 'home', panels: {}, services: {},
      connected: true, suspendWhenHidden: false, kioskMode: false, dockedSidebar: 'auto',
      auth: { data: { hassUrl: location.origin + (window.__mantelBase || '') } },
      connection: this.connection,
      callService: (domain, service) => self._refuse(`${domain}.${service}`),
      callWS: (msg) => self._call(msg),
      callApi: (method, path) => self._api(method, path),
      fetchWithAuth: (path) => Promise.reject(new Error('not available: ' + path)),
      // under the page's prefix (shim/base.js): what the page asks for is Mantel's, never HA's own site
      hassUrl: (path = '') => location.origin + (window.__mantelBase || '') + path,
      localize: (key) => key,
      formatEntityState: (s) => (s ? s.state + (s.attributes.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : '') : ''),
      // as HA's own fallbacks: a list joined, a key's words with the first one capitalised (the
      // generic sheet's lines, Phase 2 P2.5)
      formatEntityAttributeValue: (s, a) => {
        const v = s && s.attributes[a];
        return Array.isArray(v) ? v.join(', ') : String(v ?? '');
      },
      formatEntityAttributeName: (s, a) => String(a).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    };
    this._raw = raw;
    // The client's action port refuses every command itself and sends nothing (mantel-client.js);
    // what was refused is noted and shown the same way as a refusal here.
    window.addEventListener('hk-command-refused', (e) => {
      this.refused.push((e.detail && e.detail.what) || 'command');
      toast('Commands are disabled in Mantel (read-only)');
    });
    // With the gateway on (P3.3): a command the server's roles refused, or a step-up nobody answered.
    this.denied = [];
    window.addEventListener('hk-command-denied', (e) => {
      const d = e.detail || {};
      this.denied.push({ what: d.what, reason: d.reason });
      toast(d.reason === 'person_pin_required' ? 'A person has to confirm this' : 'Not allowed');
    });
    if (typeof window.hkMantelClient.useScreens === 'function') {
      window.hkMantelClient.useScreens({
        owns: (id) => this._owns(id), set: (id, on) => this._setScreen(id, on),
        reported: (tid, black) => this._setScreen(screenEntity(tid, 'black'), black),
      });
    }
    this.access = new Map();                // hass field -> times read (only with ?trace=1)
    this.trace = new URLSearchParams(location.search).get('trace') === '1';
    this._wrapStates();
  }

  get client() { return window.hkHostClient.from(this.hass); }
  // the current snapshot (the object the adapter makes clients from), by its neutral name
  get snapshot() { return this.hass; }

  _wrapStates() {
    const self = this;
    // while recording, reading a state by id notes the id (what a screen really needs from the hub)
    this._raw.states = new Proxy(this._merged, {
      get(t, k) {
        if (typeof k === 'string') {
          if (self.recording) self.reads.add(k);
          else if (self.onMiss && !(k in t) && k.indexOf('.') > 0) self.onMiss(k);
        }
        return t[k];
      },
    });
    this.hass = this.trace ? this._traced(this._raw, '') : this._raw;
    window.hkMantelClient.setCurrent(this.hass);
  }

  // ?trace=1: note every hass field (and connection/config/user/locale/themes member) the page reads,
  // which is the measured HKClient surface (docs/proof1/APPROACH.md)
  _traced(obj, prefix) {
    const self = this;
    return new Proxy(obj, {
      get(t, k) {
        const v = t[k];
        if (typeof k !== 'string' || k === 'states') return v;
        const path = prefix + k;
        self.access.set(path, (self.access.get(path) || 0) + 1);
        if (!prefix && ['connection', 'config', 'user', 'locale', 'themes'].includes(k) && v && typeof v === 'object') {
          return self._traced(v, k + '.');
        }
        return v;
      },
    });
  }

  // -- state feed (from the hub) ----------------------------------------------------------------
  applySnapshot(entities) {
    const next = {};
    for (const [id, s] of Object.entries(entities)) next[id] = stateObj(id, s);
    this._states = next;
    this._publish();
  }

  applyDiff(m) {
    const next = Object.assign({}, this._states);
    for (const [id, s] of Object.entries(m.added || {})) next[id] = stateObj(id, s);
    for (const id of m.removed || []) delete next[id];
    for (const [id, ch] of Object.entries(m.changes || {})) {
      const cur = next[id];
      if (!cur) continue;
      const p = ch['+'] || {}, mi = ch['-'] || {};
      const a = Object.assign({}, cur.attributes, p.a || {});
      for (const k of mi.a || []) delete a[k];
      next[id] = {
        entity_id: id, state: 's' in p ? String(p.s) : cur.state, attributes: a,
        last_changed: p.lc != null ? iso(p.lc) : cur.last_changed,
        last_updated: p.lu != null ? iso(p.lu) : cur.last_updated, context: cur.context,
      };
    }
    this._states = next;
    this._publish();
  }

  _publish() {
    this._merged = Object.keys(this._overlay).length ? Object.assign({}, this._states, this._overlay) : this._states;
    this._raw = Object.assign({}, this._raw);
    this._wrapStates();
    this.listeners && this.listeners.forEach((fn) => fn(this.hass));
    if (this.onSnapshot) this.onSnapshot(this.hass);
  }

  // -- messages ---------------------------------------------------------------------------------
  _count(type) { this.calls.set(type, (this.calls.get(type) || 0) + 1); }

  _refuse(what) {
    this.refused.push(what);
    toast('Commands are disabled in Mantel (read-only)');
    return Promise.reject(Object.assign(new Error('commands disabled'), { code: 'commands_disabled' }));
  }

  _api(method, path) {
    const rel = calendarPath(method, path);
    if (rel === null) return this._refuse(`api ${method} ${path}`);
    this._count('read_api calendars');
    return this.hub.readApi('GET', rel);
  }

  _call(msg) {
    this._count(msg.type);
    if (CAMERA_READS.has(msg.type) || NAMED_READS.has(msg.type)) return this.hub.read(msg);
    if (WRITE_WORDS.test(msg.type)) return this._refuse(msg.type);
    if (this.fixtures[msg.type] !== undefined) return Promise.resolve(this.fixtures[msg.type]);
    return this.hub.read(msg);
  }

  _subscribe(cb, msg) {
    this._count(msg.type);
    // The house's events (notifications, pop-ups, and Mantel's own `screen` frames) come from the
    // feature host's feed under the same message type (features.py). The user-data feed stays stood in:
    // it is per HA user and Mantel has no HA user for the viewer.
    if (msg.type === 'hk_frontend/events/subscribe') {
      return this.hub.readSubscribe(msg, (ev) => {
        if (ev && ev.type === 'screen') this._screen(ev); else cb(ev);
      }).then((unsub) => {
        // the server's frames for a screen that is already black follow its answer closely: "off" is
        // only taken to be true once they have had a moment to arrive (until then HK reads "not known")
        setTimeout(() => { this._screensReady = true; this._seedScreens(); }, SCREEN_SETTLE_MS);
        return unsub;
      });
    }
    // the settings feed names no HA switch for a tablet on Mantel: the screens' own are named here
    if (msg.type === 'hk_frontend/settings/subscribe') { const raw = cb; cb = (p) => raw(this._withScreens(p)); }
    if (msg.type === 'frontend/subscribe_user_data') { queueMicrotask(() => cb({ value: null })); return Promise.resolve(() => {}); }
    if (CAMERA_SUBSCRIPTIONS.has(msg.type)) return this.hub.readSubscribe(msg, cb);
    if (WRITE_WORDS.test(msg.type)) return this._refuse(msg.type);
    if (this.fixtures[msg.type] !== undefined) {
      const payload = this.fixtures[msg.type];
      queueMicrotask(() => cb(payload));
      return Promise.resolve(() => {});
    }
    return this.hub.readSubscribe(msg, cb);
  }

  // -- SCREENS ----------------------------------------------------------------------------------
  // In Home Assistant a wall tablet's black screen and photo screensaver are two switches of the
  // hk_frontend integration; HK's page reads their states (hk-saver.js) and reports back with
  // hk_frontend/screensaver/touch|black. Mantel has no such entities, so the host adapter keeps the
  // same two states for each tablet itself, under ids of its own (switch.mantel_<tablet>_black_screen,
  // ..._photo_screensaver), fills them into the settings feed where Home Assistant would, and sets them
  // from the feature host's `screen` frames {tablet, black|photos}. HK's code is untouched: it sees
  // a switch go on or off. The page's reports go out in mantel-client.js (screen_report).
  _owns(id) {
    const m = SCREEN_ENTITY.exec(String(id));
    return !!m && this._tablets.has(m[1]);
  }

  _setScreen(id, on) {
    const m = SCREEN_ENTITY.exec(String(id));
    if (!m || !this._tablets.has(m[1])) return;
    const cur = this._overlay[id];
    if (cur && cur.state === (on ? 'on' : 'off')) return;
    this._overlay[id] = screenState(id, on, cur ? cur.attributes : {});
    this._publish();
  }

  // a `screen` frame: {tablet, black, brightness?} or {tablet, photos}
  _screen(ev) {
    const tid = ev.tablet;
    if (typeof tid !== 'string' || !TABLET_ID.test(tid)) return;
    this._tablets.add(tid);
    if (typeof ev.black === 'boolean') {
      const id = screenEntity(tid, 'black');
      const attrs = typeof ev.brightness === 'number' ? { brightness: ev.brightness } : {};
      this._overlay[id] = screenState(id, ev.black, attrs);
    }
    if (typeof ev.photos === 'boolean') {
      const id = screenEntity(tid, 'photos');
      this._overlay[id] = screenState(id, ev.photos, {});
    }
    this._publish();
  }

  // every known tablet reads "off" for both, once the feed has had its say (until then: not known)
  _seedScreens() {
    if (!this._screensReady) return;
    let added = false;
    for (const tid of this._tablets) {
      for (const kind of ['black', 'photos']) {
        const id = screenEntity(tid, kind);
        if (!this._overlay[id]) { this._overlay[id] = screenState(id, false, {}); added = true; }
      }
    }
    if (added) this._publish();
  }

  // the settings feed with each tablet's two switches named (where the server named none)
  _withScreens(p) {
    if (!p || typeof p !== 'object' || !p.tablet_items || typeof p.tablet_items !== 'object') return p;
    const items = {};
    for (const [tid, t] of Object.entries(p.tablet_items)) {
      if (!t || typeof t !== 'object' || !TABLET_ID.test(tid)) { items[tid] = t; continue; }
      this._tablets.add(tid);
      items[tid] = Object.assign({}, t, {
        screensaver_switch: t.screensaver_switch || screenEntity(tid, 'photos'),
        black_switch: t.black_switch || screenEntity(tid, 'black'),
      });
    }
    this._seedScreens();
    return Object.assign({}, p, { tablet_items: items });
  }

  // -- the stubs HK's DOM lookups land on -------------------------------------------------------
  installLookups() {
    const self = this;
    const stub = {
      get hass() { return self.hass; },
      localName: 'home-assistant', isMantelStub: true,
      // No HA shell exists. A fake shadow root makes current shell modules
      // attempt to mount menus into a non-DOM object; defer those modules instead.
      shadowRoot: null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
    };
    const SELECTORS = /^(home-assistant|home-assistant-main|hui-root|ha-panel-lovelace)$/;
    const qs = Document.prototype.querySelector;
    this.lookups = new Map();               // selector -> times HK looked for it (answered by the stub)
    Document.prototype.querySelector = function (sel) {
      const key = String(sel).trim();
      if (!SELECTORS.test(key)) return qs.call(this, sel);
      self.lookups.set(key, (self.lookups.get(key) || 0) + 1);
      return stub;
    };
    this.stub = stub;
  }
}
