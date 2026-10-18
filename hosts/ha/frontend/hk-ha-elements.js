// HK's host elements, Home Assistant's side (Phase 2, P2.1; web/hk/elements/hk-elements.js has the
// shared ones). An entity's icon from its state is the host's own knowledge -- HA's state- and
// translation-aware icons -- so here hk-state-icon is a thin box around HA's ha-state-icon, and
// HK's cards look exactly as before. client.bindStateIcon (hk-ha-client.js) hands it HA's object
// and the state; Mantel's hk-state-icon is a stand-in (web/shim/ha-elements.js).
(function (global) {
  'use strict';
  var ce = global.customElements;
  if (!ce || ce.get('hk-state-icon')) return;

  class HkStateIcon extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>:host{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;' +
        'width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}' +
        'ha-state-icon{width:100%;height:100%;--mdc-icon-size:100%}</style>';
      this._inner = null;
    }
    // HA's own state icon inside (made on first use)
    get inner() { return this._el(); }
    _el() {
      if (!this._inner) {
        this._inner = global.document.createElement('ha-state-icon');
        this.shadowRoot.appendChild(this._inner);
      }
      return this._inner;
    }
    set hass(h) { this._el().hass = h; }
    get hass() { return this._inner ? this._inner.hass : undefined; }
    set stateObj(s) { this._el().stateObj = s; }
    get stateObj() { return this._inner ? this._inner.stateObj : undefined; }
    set icon(v) { this._el().icon = v; }
    get icon() { return this._inner ? this._inner.icon : undefined; }
  }
  ce.define('hk-state-icon', HkStateIcon);
})(globalThis);
