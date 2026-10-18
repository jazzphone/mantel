// HK's host elements, Home Assistant's side (Phase 2, P2.1; web/hk/elements/hk-elements.js has the
// shared ones). An entity's icon from its state is the host's own knowledge -- HA's state- and
// translation-aware icons -- so here hk-state-icon is a transparent box around HA's ha-state-icon,
// and HK's cards look exactly as before. client.bindStateIcon (hk-ha-client.js) hands it HA's object
// and the state; Mantel's hk-state-icon is a stand-in (web/shim/ha-elements.js).
(function (global) {
  'use strict';
  var ce = global.customElements;
  if (!ce || ce.get('hk-state-icon')) return;

  class HkStateIcon extends HTMLElement {
    constructor() {
      super();
      // A box that is not there (Phase 2 P2.2): the host takes ha-state-icon's place (HA's has no
      // styles of its own, so it is an inline box the cards' CSS sizes and lays out), and the
      // ha-state-icon inside is display:contents, so its ha-icon lays out exactly as it did when
      // the cards made ha-state-icon themselves.
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>' + HkStateIcon.CSS + '</style>';
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
  HkStateIcon.CSS = 'ha-state-icon{display:contents}';
  ce.define('hk-state-icon', HkStateIcon);
})(globalThis);
