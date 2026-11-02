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

// THE POWER PAGE'S PICTURE THROUGH HA'S SIDEBAR (2026-10-19): its folder comes in the settings feed (the
// Energy plan's power.art, '/hk/power-house/'), data that ingress.py's rewrite of HK's files never sees, so
// under the Ingress prefix the page asked Home Assistant's own /hk/ for art.json and the layers (drawn only
// where HK in HA happened to have that folder). Moved under the prefix here (base.js's window.__mantelBase).
const HK_ROOT = /^\/hk\//;
export function withArtBase(p, base = (typeof window !== 'undefined' && window.__mantelBase) || '') {
  const power = p && typeof p === 'object' && p.energy && typeof p.energy === 'object' ? p.energy.power : null;
  const art = power && typeof power === 'object' ? power.art : null;
  // (a pattern, not a '/hk/' string: ingress.py moves those under the prefix in the files it serves)
  if (!base || typeof art !== 'string' || !HK_ROOT.test(art)) return p;
  return Object.assign({}, p, { energy: Object.assign({}, p.energy, { power: Object.assign({}, power, { art: base + art }) }) });
}

// THE PLAYLISTS' COVERS THROUGH HA'S SIDEBAR (2026-11-01): a pill's `image` in the music feed (hk_music/subscribe) is
// Mantel's /ma image path, as Browse's pictures are; under the Ingress prefix the prefix goes in front here. Anything
// else (a web address, which the art route fetches) is as it came.
const MA_IMAGE = /^\/ma\/imageproxy[?/]/;
export function withMusicBase(p, base = (typeof window !== 'undefined' && window.__mantelBase) || '') {
  if (!base || !p || !Array.isArray(p.playlists)) return p;
  const moved = (x) => (x && typeof x.image === 'string' && MA_IMAGE.test(x.image) ? Object.assign({}, x, { image: base + x.image }) : x);
  return Object.assign({}, p, { playlists: p.playlists.map((pl) => {
    const one = moved(pl);
    return one && Array.isArray(one.options) ? Object.assign({}, one, { options: one.options.map(moved) }) : one;
  }) });
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
// HK's per-person user data that Mantel keeps itself (user_data.KEYS; mantel-client.js USER_DATA_KEYS)
export const USER_DATA_KEYS = new Set(['hk_music_focus', 'favorites']);
// NOTIFICATION SNAPSHOTS (hk-notify.js): HK asks hk_notify/snap/sign {snaps: [id]} for paths an <img> can
// load. A read (its name carries "sign"): the server answers with Mantel's own route for each picture of
// a camera the person may see (/api/notify/snap/<id>, no HA token), and the page's prefix goes in front
// here, as it does for every address Mantel gives a page (HA App mode serves Mantel under Ingress).
export const SNAP_SIGN = 'hk_notify/snap/sign';
const DIFF_FALLBACK_MS = 250;      // a hidden page draws no frames: the hub's diffs are applied by this timer then
export const ART_SIGN = 'hk_frontend/art/sign';
// ALBUM ART SCALED BY MANTEL (2026-10-29; connectors/media_art.py, hk_core/art): a remote cover (Apple's CDN,
// Music Assistant's image proxy) is fetched by the server and scaled to the tile's size bucket, so a tablet
// without internet shows it and no tile downloads a multi-megabyte cover to draw 150 px. The page makes the
// address itself -- the session authorises the fetch, nothing is signed: the base64url of the cover's address,
// the next bucket up (hk_core/art/resize.py SIZES), under the page's prefix.
export const ART_SIZES = [150, 300, 600, 1000];
export function artBucket(size) {
  const n = Math.floor(Number(size));
  if (!Number.isFinite(n) || n <= 0) return 300;
  return ART_SIZES.find((s) => s >= n) || ART_SIZES[ART_SIZES.length - 1];
}
export function artPath(url, size, base = '') {
  const bytes = new TextEncoder().encode(url);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const e = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base || ''}/api/media/art?e=${e}&s=${artBucket(size)}`;
}
export function artSigned(urls, size, base = '') {
  const signed = {};
  for (const u of Array.isArray(urls) ? urls.slice(0, 200) : []) {
    if (typeof u === 'string' && u.length < 2048 && /^https?:\/\//i.test(u)) signed[u] = artPath(u, size, base);
  }
  return { signed };
}
const SNAP_PATH = /^\/api\/notify\/snap\/[0-9a-f]{32}$/;     // notify_snaps.PATH, nothing else
// THE SCREENSAVER'S PHOTOS (hk-saver.js load): media_source/resolve_media is answered by Mantel itself
// (connectors/media_photos.py) with its own short-lived photo route, never HA's signed address; the page's
// prefix goes in front here. Anything else in the answer is dropped.
export const PHOTO_RESOLVE = 'media_source/resolve_media';
const PHOTO_PATH = /^\/api\/photo\/[0-9a-f]{32}$/;          // media_photos.PATH, nothing else
export function prefixPhoto(result, base) {
  const url = result && typeof result.url === 'string' && PHOTO_PATH.test(result.url) ? (base || '') + result.url : null;
  if (!url) throw Object.assign(new Error('not a photo'), { code: 'not_found' });
  return { url, mime_type: typeof result.mime_type === 'string' ? result.mime_type : 'image/jpeg' };
}
export function prefixSigned(result, base) {
  const signed = result && typeof result.signed === 'object' && result.signed ? result.signed : {};
  const out = {};
  for (const [id, path] of Object.entries(signed)) {
    if (typeof path === 'string' && SNAP_PATH.test(path)) out[id] = (base || '') + path;
  }
  return { signed: out };
}
// CALENDARS: HK's calendar card reads events with callApi('GET', 'calendars/<entity>?start=&end='),
// Mantel's one REST read (read_api, RBAC `view` of the calendar). Any other REST call stays refused.
// (Camera stills need nothing here: the server already gives each camera state an entity_picture on
// Mantel's own still route, under the page's prefix, and never HA's token.)
const CALENDAR_PATH = /^\/?(?:api\/)?calendars\/calendar\.[a-z0-9_]+\?/;
export function calendarPath(method, path) {
  if (String(method || '').toUpperCase() !== 'GET' || typeof path !== 'string' || !CALENDAR_PATH.test(path)) return null;
  return path.replace(/^\/?(?:api\/)?/, '');
}

// HISTORY: a detail sheet's Hour and Day charts (hk-stats.js history()) read HA's REST history,
// GET history/period/<start>?filter_entity_id=<ids>[&end_time=][&minimal_response][&no_attributes]. Mantel
// has no REST history: it is asked as the WebSocket read history/history_during_period (readproxy.py, RBAC
// `history` on each id) and the answer is given back in the REST shape ([[{entity_id, state,
// last_changed, last_updated}, ...]], one list per id that has rows). Any other history path stays refused.
const HISTORY_PATH = /^\/?(?:api\/)?history\/period\/([^/?]+)\?(.*)$/;
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
export function historyRequest(method, path) {
  if (String(method || '').toUpperCase() !== 'GET' || typeof path !== 'string') return null;
  const m = HISTORY_PATH.exec(path);
  if (!m) return null;
  let start;
  try { start = decodeURIComponent(m[1]); } catch (e) { return null; }
  if (!Number.isFinite(Date.parse(start))) return null;
  const q = new URLSearchParams(m[2]);
  const ids = String(q.get('filter_entity_id') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length || ids.length > 50 || !ids.every((id) => ENTITY_ID.test(id))) return null;
  for (const k of q.keys()) {
    if (!['filter_entity_id', 'end_time', 'minimal_response', 'no_attributes', 'significant_changes_only'].includes(k)) return null;
  }
  const msg = { type: 'history/history_during_period', start_time: start, entity_ids: ids,
                minimal_response: q.has('minimal_response'), no_attributes: q.has('no_attributes'),
                // as HA's REST view: on unless the query says 0
                significant_changes_only: q.get('significant_changes_only') !== '0' };
  const end = q.get('end_time');
  if (end !== null) {
    if (!Number.isFinite(Date.parse(end))) return null;
    msg.end_time = end;
  }
  return msg;
}
// the WebSocket answer ({id: [{s, a?, lu, lc?}, ...]}) in the REST shape HK reads
export function historyAsRest(ids, res) {
  const iso = (sec) => (typeof sec === 'number' && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : null);
  const out = [];
  for (const id of ids) {
    const rows = res && Array.isArray(res[id]) ? res[id] : [];
    if (!rows.length) continue;
    out.push(rows.map((r) => {
      const row = { entity_id: id, state: r.s !== undefined ? r.s : r.state,
                    last_changed: iso(r.lc !== undefined ? r.lc : r.lu) || r.last_changed || null,
                    last_updated: iso(r.lu) || r.last_updated || null };
      if (r.a) row.attributes = r.a;
      return row;
    }));
  }
  return out;
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

// The house's language with its country's region when the language has none ('en' + GB = en-GB), as the
// formatters (hkLocale.tag in client/hk-client.js) read it; a tag this browser does not know stays as it was.
function regionalTag(config) {
  const lang = String((config && config.language) || 'en').replace(/_/g, '-');
  const cc = String((config && config.country) || '').toUpperCase();
  if (lang.includes('-') || !/^[A-Z]{2}$/.test(cc)) return lang;
  try { return Intl.DateTimeFormat.supportedLocalesOf([lang + '-' + cc]).length ? lang + '-' + cc : lang; } catch (e) { return lang; }
}

// WHAT A REFUSED OR FAILED COMMAND SAYS (the gateway's error codes, gateway.py; the hub's own `unavailable`)
const DENIED_TEXT = {
  alarm_pin_not_set: 'No Alarm PIN is set in Mantel yet (HK Settings, Alarm PIN)',
  unavailable: 'Couldn’t reach Mantel. Try again in a moment.',
  unauthenticated: 'You’re signed out. Reload to sign in again.',
  step_up_required: 'Sign in again to do that.',
  audit_unavailable: 'Not sent: Mantel couldn’t write it to the Audit Log.',
};
const DENIED_ROLES = ['forbidden', 'read_only', 'not_allowed', undefined];
export function deniedText(code) {
  if (DENIED_TEXT[code]) return DENIED_TEXT[code];
  return DENIED_ROLES.indexOf(code) >= 0 ? 'Not allowed' : 'That didn’t work. Try again.';
}

export class Host {
  constructor({ hub, registry, fixtures, user, config, themes }) {
    this.hub = hub;
    this.fixtures = fixtures;               // {message type: captured payload}
    this.refused = [];                      // what the page tried to write (shown by tests and /dev tools)
    this.calls = new Map();                 // message type -> times asked (the measured surface)
    this.reads = new Set();                 // entity ids read through hass.states after the build
    this.recording = false;
    // EVERY id read through hass.states with a state, at any time: the Side Pane, the menu, the tab bar and the
    // screensaver draw outside the page's cards, so the recorded pass missed what they read -- narrowing dropped
    // it, their next read missed and asked again, and their data went away and came back (the owner,
    // 2026-10-30: "lots of the data seems to just disappear and come back"). home.js keeps these too.
    this.seen = new Set();
    this.building = false;                  // the strategy's whole-house pass: its reads are no surface's
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
    // A kiosk app's watchdog reads this as HA's own connection (Kiosk Satellite: `connected` and
    // `socket.readyState === 1`, a `ping`, then `reconnect(true)` or `socket.close()`, and a page reload
    // after 15 minutes "down"; the wall tablets reloaded every 15 or 16 minutes, 2026-10-22). So it tells
    // the truth about Mantel's own socket: up while the hub's is, its ping is the server's, and a nudge
    // cycles the hub's socket, which reconnects by itself.
    const open = () => !!(self.hub && self.hub._open && self.hub._open());
    // (the hub's cycle: handled as closed at once, so a half-open socket whose close never completes is replaced
    // too; the hub's own liveness check, hub.js "A TABLET THAT SLEPT", uses the same one)
    const cycle = () => {
      if (self.hub && self.hub.cycle) { self.hub.cycle(); return; }
      try { if (self.hub && self.hub.ws) self.hub.ws.close(); } catch (e) { /* reconnecting anyway */ }
    };
    this.connection = {
      subscribeMessage: (cb, msg) => self._subscribe(cb, msg),
      sendMessagePromise: (msg) => (msg && msg.type === 'ping'
        ? (self.hub && self.hub.ping ? self.hub.ping() : Promise.reject(new Error('not connected'))).then(() => ({ type: 'pong' }))
        : self._call(msg)),
      addEventListener: (n, fn) => { (listeners.get(n) || listeners.set(n, new Set()).get(n)).add(fn); },
      removeEventListener: (n, fn) => { const l = listeners.get(n); if (l) l.delete(fn); },
      get connected() { return open(); },
      socket: { get readyState() { return open() ? 1 : 3; }, close: cycle },
      reconnect: cycle,
      haVersion: 'mantel',
    };
    const raw = {
      states: {}, entities: registry.entities, devices: registry.devices, areas: registry.areas,
      floors: registry.floors, config, themes, user,
      // what HA's own client holds, from the house's configuration (language, country, time zone): Mantel has
      // no per-person locale, so every format follows the language (and the country's region) and the clock
      // and zone are the house's ('server': HA's own word for it)
      language: config.language || 'en',
      locale: { language: regionalTag(config), number_format: 'language', time_format: 'language',
                date_format: 'language', time_zone: 'server', first_weekday: 'language' },
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
      if (this.refused.length > 50) this.refused.splice(0, this.refused.length - 50);
      toast('Commands are disabled in Mantel (read-only)');
    });
    // With the gateway on (P3.3): a command the server's roles refused (no PIN is ever asked: decision 25), or one that
    // failed -- each in its own words (every one said "Not allowed", a dropped connection too: the third audit pass,
    // 2026-11-01). Both lists keep the last 50.
    this.denied = [];
    window.addEventListener('hk-command-denied', (e) => {
      const d = e.detail || {};
      this.denied.push({ what: d.what, reason: d.reason });
      if (this.denied.length > 50) this.denied.splice(0, this.denied.length - 50);
      toast(deniedText(d.code));
    });
    if (typeof window.hkMantelClient.useScreens === 'function') {
      window.hkMantelClient.useScreens({
        owns: (id) => this._owns(id), set: (id, on) => this._setScreen(id, on),
        // which tablet and which of its two switches an id is ({tablet, kind: 'black'|'photos'}), or null
        which: (id) => {
          const m = SCREEN_ENTITY.exec(String(id));
          return m && this._tablets.has(m[1]) ? { tablet: m[1], kind: /_black_screen$/.test(id) ? 'black' : 'photos' } : null;
        },
        reported: (tid, black) => this._setScreen(screenEntity(tid, 'black'), black),
      });
    }
    this._diffs = [];                       // the hub's diffs waiting for the next frame (applyDiff)
    this._armed = 0;
    this._gen = 0;
    this._diffTimer = 0;
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
          if (!self.building && k in t) self.seen.add(k);
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
    // a snapshot is the whole house as of now: a diff still waiting for its frame is older than it, and would undo it
    this._diffs.length = 0;
    this._disarm();
    const next = {};
    for (const [id, s] of Object.entries(entities)) next[id] = stateObj(id, s);
    this._states = next;
    this._publish();
  }

  // UPDATES BATCHED PER FRAME (2026-10-29). Each diff from the hub used to be applied and published at once: a house
  // with a power meter and a few busy sensors sends several a second, and every one rebuilt the states object and
  // told every card, so a wall tablet repainted for each. Diffs now wait for the next animation frame and are applied
  // together, in the order they came, in ONE new states object and one publish. A hidden page draws no frames, so
  // a timer is set beside the frame request and whichever comes first applies them: the state of a tablet whose
  // screen is off (or a tab in the background) does not stall, and is not left to pile up. applySnapshot drops what
  // waits (it is older), and flushDiffs() applies it now (tests, and anything that must read the newest).
  applyDiff(m) {
    this._diffs.push(m);
    if (this._armed) return;
    const gen = this._armed = ++this._gen;
    const go = () => { if (this._armed === gen) this.flushDiffs(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    this._diffTimer = setTimeout(go, typeof requestAnimationFrame === 'function' ? DIFF_FALLBACK_MS : 0);
  }

  _disarm() {
    this._armed = 0;
    if (this._diffTimer) clearTimeout(this._diffTimer);
    this._diffTimer = 0;
  }

  flushDiffs() {
    this._disarm();
    if (!this._diffs.length) return;
    const next = Object.assign({}, this._states);
    for (const m of this._diffs.splice(0)) this._applyOne(next, m);
    this._states = next;
    this._publish();
  }

  _applyOne(next, m) {
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
  }

  // the registries changed in Home Assistant (registry-sync.js): HK reads them from the new hass
  applyRegistry(reg) {
    if (!reg) return;
    Object.assign(this._raw, { entities: reg.entities || {}, devices: reg.devices || {}, areas: reg.areas || {},
                               floors: reg.floors || {} });
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
    const hist = historyRequest(method, path);
    if (hist) {
      this._count('history/history_during_period');
      return this.hub.read(hist).then((res) => historyAsRest(hist.entity_ids, res));
    }
    const rel = calendarPath(method, path);
    if (rel === null) return this._refuse(`api ${method} ${path}`);
    this._count('read_api calendars');
    return this.hub.readApi('GET', rel);
  }

  _call(msg) {
    this._count(msg.type);
    if (CAMERA_READS.has(msg.type) || NAMED_READS.has(msg.type)) return this.hub.read(msg);
    if (msg.type === SNAP_SIGN) {
      const base = (typeof window !== 'undefined' && window.__mantelBase) || '';
      return this.hub.read(msg).then((r) => prefixSigned(r, base));
    }
    if (msg.type === PHOTO_RESOLVE) {
      const base = (typeof window !== 'undefined' && window.__mantelBase) || '';
      return this.hub.read(msg).then((r) => prefixPhoto(r, base));
    }
    // ARTWORK SIGNING (hk-base.js artSign): in HA, HK asks for a signed proxy path for remote now-playing art.
    // Answered here, on the page, and never refused as a write for the "sign" in its name ("Commands are
    // disabled" on the Music page with commands on or off: the house, 2026-10-18). Until 2026-10-29 it was
    // "nothing signed" (HK used the art's own address, which a tablet without internet can't reach); now each
    // address is Mantel's own art route with the size bucket, and the server fetches and scales it.
    if (msg.type === ART_SIGN) {
      const base = (typeof window !== 'undefined' && window.__mantelBase) || '';
      return Promise.resolve(artSigned(msg.urls, msg.size, base));
    }
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
    if (msg.type === 'hk_frontend/settings/subscribe') { const raw = cb; cb = (p) => raw(withArtBase(this._withScreens(p))); }
    if (msg.type === 'hk_music/subscribe') { const raw = cb; cb = (p) => raw(withMusicBase(p)); }
    // HK's per-person user data (the Music page's speaker) is Mantel's own, per person or tablet (user_data.py):
    // the value first, then every change. Any other key, or a server without it, stays the stand-in (no value).
    if (msg.type === 'frontend/subscribe_user_data') {
      const none = () => { queueMicrotask(() => cb({ value: null })); return () => {}; };
      if (!USER_DATA_KEYS.has(msg.key)) return Promise.resolve(none());
      return this.hub.readSubscribe(msg, cb).catch(() => none());
    }
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
      // whether the page's black was heard (Mantel's own copy): a page already black says so again (hk-saver)
      if (typeof ev.confirmed === 'boolean') attrs.confirmed = ev.confirmed;
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
