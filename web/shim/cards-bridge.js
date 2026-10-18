// cards-bridge.js -- what HK's cards ask Lovelace to build for them, answered without Lovelace.
//
//  * window.loadCardHelpers().createCardElement(cfg)   (hk-grid-card, hk-frame)
//  * <hui-card> created with document.createElement    (hk-chip, hk-cameras): Mantel returns its own
//    <mantel-card> with the same contract (.config, .hass, .preview, .load()), so no hui-* element
//    exists in the page
//  * `type: grid`, HA's native grid card, which HK's strategy uses once at the top of Home
//
// Only `custom:` (HK) cards are built. A native HA card type is drawn as a labelled placeholder.

function unsupported(cfg) {
  const d = document.createElement('div');
  d.textContent = 'not built in Mantel: ' + cfg.type;
  d.style.cssText = 'color:#f99;font:12px monospace;padding:6px;border:1px dashed #f99;border-radius:6px';
  d.setConfig = () => {};
  return d;
}

export function createCardElement(cfg) {
  const t = String((cfg && cfg.type) || '');
  if (t === 'conditional') return document.createElement('mantel-conditional-card').__init(cfg);
  if (t === 'grid') return Object.assign(document.createElement('mantel-grid-card'), {}).__init(cfg);
  if (!t.startsWith('custom:')) return unsupported(cfg);
  const el = document.createElement(t.slice(7));
  try { el.setConfig(cfg); } catch (e) {
    console.error('[mantel] setConfig failed for', t, e);
    el.textContent = 'error: ' + e.message;
  }
  return el;
}

// HA's grid card: columns equal tracks, 8 px gap, children are cards.
class MantelGridCard extends HTMLElement {
  constructor() { super(); this._sr = this.attachShadow({ mode: 'open' }); this._kids = []; this._hass = null; }
  __init(cfg) { this.setConfig(cfg); return this; }
  setConfig(cfg) {
    this._cfg = cfg;
    const cols = Number(cfg.columns) || 1;
    this._sr.innerHTML = '<style>:host{display:block}#g{display:grid;gap:var(--grid-card-gap,8px);' +
      `grid-template-columns:repeat(${cols},minmax(0,1fr))}</style><div id="g"></div>`;
    const g = this._sr.getElementById('g');
    this._kids = (cfg.cards || []).map((c) => createCardElement(c));
    this._kids.forEach((k) => g.appendChild(k));
  }
  set hass(h) { this._hass = h; this._kids.forEach((k) => { k.hass = h; }); }
  get hass() { return this._hass; }
  getCardSize() { return 1; }
}

// HA's conditional card: shows its card while the conditions hold (state, numeric_state, screen, and, or, not).
export function holds(cond, hass) {
  if (!cond) return true;
  const st = (id) => hass.states[id];
  const list = (v) => (Array.isArray(v) ? v : [v]);
  switch (cond.condition || (cond.entity ? 'state' : '')) {
    case 'state': {
      const s = st(cond.entity); const v = s ? s.state : 'unavailable';
      if (cond.state !== undefined && !list(cond.state).map(String).includes(v)) return false;
      if (cond.state_not !== undefined && list(cond.state_not).map(String).includes(v)) return false;
      return true;
    }
    case 'numeric_state': {
      const s = st(cond.entity); const n = s ? Number(s.state) : NaN;
      if (Number.isNaN(n)) return false;
      return (cond.above === undefined || n > Number(cond.above)) && (cond.below === undefined || n < Number(cond.below));
    }
    case 'screen': return window.matchMedia(cond.media_query || 'all').matches;
    case 'and': return (cond.conditions || []).every((c) => holds(c, hass));
    case 'or': return (cond.conditions || []).some((c) => holds(c, hass));
    case 'not': return !(cond.conditions || []).some((c) => holds(c, hass));
    default: return true;
  }
}

class MantelConditionalCard extends HTMLElement {
  constructor() { super(); this._hass = null; this._on = null; }
  __init(cfg) { this.setConfig(cfg); return this; }
  setConfig(cfg) {
    this._cfg = cfg;
    this._el = createCardElement(cfg.card);
    this.appendChild(this._el);
    this.style.display = 'none';
    this.hidden = true;
  }
  set hass(h) {
    this._hass = h;
    const on = (this._cfg.conditions || []).every((c) => holds(c, h));
    if (on) setCardHost(this._el, h);
    if (on !== this._on) {
      this._on = on;
      this.hidden = !on;
      this.style.display = on ? '' : 'none';
      this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
    }
  }
  get hass() { return this._hass; }
  getCardSize() { return 1; }
}

// hui-card's contract, enough for HK: set .hass, set .config, call .load()
class MantelCard extends HTMLElement {
  constructor() {
    super();
    this.preview = false; this._hass = null; this._config = null; this._el = null;
    // hui-card hides itself while its card says it is hidden (HK's chips hide themselves when they have
    // nothing to show); without that the empty wrapper still takes its flex gap and the row drifts
    this.addEventListener('card-visibility-changed', (e) => {
      if (e.target === this._el) this._show(!!e.detail.value);
    });
  }
  _show(on) { this.hidden = !on; this.style.display = on ? 'block' : 'none'; }
  // (a card may show itself by its `hidden` attribute alone, so it is read after every hass, as hui-card does)
  set hass(h) { this._hass = h; if (this._el) { setCardHost(this._el, h); this._show(!this._el.hidden); } }
  get hass() { return this._hass; }
  set config(c) { this._config = c; }
  get config() { return this._config; }
  // hui-card builds its card again when the config it was given has changed (hk-scenes-card re-plans
  // and hands over a new config); a repeat of the same config leaves the card alone
  load() {
    if (!this._config) return;
    const key = JSON.stringify(this._config);
    if (this._el && key === this._built) return;
    if (this._el) this._el.remove();
    this._built = key;
    this._el = createCardElement(this._config);
    this.appendChild(this._el);
    if (this._hass) setCardHost(this._el, this._hass);
    this._show(!this._el.hidden);
  }
  connectedCallback() { if (!this.style.display) this.style.display = 'block'; }
}

export function installCardBridge() {
  if (!customElements.get('mantel-grid-card')) customElements.define('mantel-grid-card', MantelGridCard);
  if (!customElements.get('mantel-conditional-card')) customElements.define('mantel-conditional-card', MantelConditionalCard);
  if (!customElements.get('mantel-card')) customElements.define('mantel-card', MantelCard);
  window.loadCardHelpers = () => Promise.resolve({ createCardElement });
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, opts) {
    return create.call(this, String(tag).toLowerCase() === 'hui-card' ? 'mantel-card' : tag, opts);
  };
}

// Migrated metrics receive HKClient explicitly. The compatibility snapshot remains for card
// families that still read it (slice 9); their actions go through HKClient's action port,
// which refuses them in Mantel before anything is sent (Host stays the backstop).
export function setCardHost(element, snapshot) {
  element.hass = snapshot;
  if (element.localName === 'hk-stat-card') element.client = window.hkHostClient.from(snapshot);
}
