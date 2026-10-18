// HK'S OWN ELEMENTS (Phase 2, P2.1): the icon and the card plate every HK card draws with,
// so a card needs nothing from the host's frontend to draw (docs/phase2/ROADMAP.md).
//
//   hk-icon    an SVG glyph by name: `hk:` names from HK's own iconset (hk-icons.js:
//              window.customIconsets.hk, Apple's glyphs from "Your files"), `mdi:` names from
//              the host's Material icon database (hkIcons.mdiPath: HA's /static/mdi in HA, HK's
//              committed subset in Mantel), any other set from window.customIconsets[set].
//   hk-plate   a card's plate: the same box, colours and variables as Home Assistant's
//              ha-card (frontend 2026.9), so a card that moves from ha-card to hk-plate looks
//              the same in HA and draws the same in Mantel. `header` and `raised` as ha-card's.
//
// hk-state-icon (an entity's icon from its state) is the HOST's: HA's draws ha-state-icon
// (HA's state- and translation-aware icons), Mantel's a small domain default
// (hosts/ha/frontend/hk-ha-elements.js, web/shim/ha-elements.js). Shared code binds one with
// client.bindStateIcon(element, state).
//
// Plain custom elements, no framework; every global is read at call time.
(function (global) {
  'use strict';
  var ce = global.customElements;
  if (!ce || ce.get('hk-icon')) return;

  // HA's ha-icon is two boxes: the element itself (`:host{fill:currentColor}`, so INLINE) and the
  // ha-svg-icon it renders inside (inline-flex, --mdc-icon-size square). HK's cards were tuned
  // against exactly that (hk-base.js's well, hk-media.js's vOffset), so hk-icon draws the same two
  // boxes with the same rules (frontend 2026.9): `.i` is ha-svg-icon's :host. Nothing is drawn
  // until a name is set, as ha-icon renders nothing without one.
  var ICON_CSS = ':host{fill:currentcolor}' +
    '.i{display:var(--ha-icon-display,inline-flex);vertical-align:middle;fill:var(--icon-primary-color,currentcolor);' +
    'width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);justify-content:center;align-items:center;position:relative}' +
    '.i[hidden]{display:none}' +
    'svg{pointer-events:none;width:100%;height:100%;display:block}' +
    'path.p{opacity:var(--icon-primary-opactity,1)}' +
    'path.s{fill:var(--icon-secondary-color,currentcolor);opacity:var(--icon-secondary-opactity,.5)}';

  // Icons asked for before their set (or the host's MDI database, hkIcons) was registered: they
  // are drawn again when it is (hk-icons.js calls hkElements.iconsetAdded), not left blank.
  var waiting = new Set();
  function known(name) {
    var i = (name || '').indexOf(':'), set = i < 0 ? 'mdi' : name.slice(0, i);
    var custom = global.customIconsets && global.customIconsets[set];
    if (typeof custom === 'function') return true;
    return set === 'mdi' && !!(global.hkIcons && typeof global.hkIcons.mdiPath === 'function');
  }

  // name -> {path, secondaryPath?, viewBox?} or null; never throws
  function resolve(name) {
    if (!name) return Promise.resolve(null);
    var i = name.indexOf(':');
    var set = i < 0 ? 'mdi' : name.slice(0, i), id = i < 0 ? name : name.slice(i + 1);
    var custom = global.customIconsets && global.customIconsets[set];
    var icons = global.hkIcons;
    try {
      if (typeof custom === 'function') return Promise.resolve(custom(id)).then(function (r) { return r || null; }, function () { return null; });
      if (set === 'mdi' && icons && typeof icons.mdiPath === 'function') {
        return Promise.resolve(icons.mdiPath(id)).then(function (p) { return p ? { path: p } : null; }, function () { return null; });
      }
    } catch (e) { /* a missing glyph draws nothing */ }
    return Promise.resolve(null);
  }

  class HkIcon extends HTMLElement {
    static get observedAttributes() { return ['icon']; }
    constructor() {
      super();
      var root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + ICON_CSS + '</style>' +
        '<span class="i" hidden><svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false" role="img" aria-hidden="true">' +
        '<g><path class="p"></path><path class="s"></path></g></svg></span>';
      this._icon = '';
      this._drawn = null;
    }
    get icon() { return this._icon; }
    set icon(v) {
      v = v || '';
      if (v === this._icon) return;
      this._icon = v;
      this._load();
    }
    attributeChangedCallback(name, was, value) { if (name === 'icon') this.icon = value; }
    // what is drawn now ({path, secondaryPath, viewBox} or null), for tests and callers
    get drawn() { return this._drawn; }
    _load() {
      var want = this._icon, self = this, box = this.shadowRoot.querySelector('.i');
      if (box) box.hidden = !want;
      if (want && !known(want)) waiting.add(this); else waiting.delete(this);
      return resolve(want).then(function (icon) { if (want === self._icon) self._paint(icon); });
    }
    _paint(icon) {
      var root = this.shadowRoot, svg = root.querySelector('svg'), p = root.querySelector('.p'), s = root.querySelector('.s');
      this._drawn = icon || null;
      if (!svg || !p || !s) return;
      if (!icon) { p.removeAttribute('d'); s.removeAttribute('d'); return; }
      svg.setAttribute('viewBox', icon.viewBox || '0 0 24 24');
      p.setAttribute('d', icon.path || '');
      if (icon.secondaryPath) s.setAttribute('d', icon.secondaryPath); else s.removeAttribute('d');
    }
  }

  // Home Assistant's ha-card, :host and header rules (frontend 2026.9), with fallbacks for the
  // design tokens a host without HA's theme does not define.
  var PLATE_CSS = ':host{background:var(--ha-card-background,var(--card-background-color,white));' +
    'backdrop-filter:var(--ha-card-backdrop-filter,none);box-shadow:var(--ha-card-box-shadow,none);' +
    'box-sizing:border-box;border-radius:var(--ha-card-border-radius,var(--ha-border-radius-lg,12px));' +
    'border-width:var(--ha-card-border-width,1px);border-style:solid;' +
    'border-color:var(--ha-card-border-color,var(--divider-color,#e0e0e0));color:var(--primary-text-color);' +
    'transition:all .3s ease-out;display:block;position:relative}' +
    ':host([raised]){box-shadow:var(--ha-card-box-shadow,0px 2px 1px -1px #0003, 0px 1px 1px 0px #00000024, 0px 1px 3px 0px #0000001f);border:none}' +
    '.card-header,:host ::slotted(.card-header){color:var(--ha-card-header-color,var(--primary-text-color));' +
    'font-family:var(--ha-card-header-font-family,inherit);font-size:var(--ha-card-header-font-size,var(--ha-font-size-2xl,24px));' +
    'letter-spacing:-.012em;line-height:var(--ha-line-height-expanded,1.5);' +
    'padding:var(--ha-space-3,12px) var(--ha-space-4,16px) var(--ha-space-4,16px);' +
    'font-weight:var(--ha-font-weight-normal,400);margin-block:0;display:block}' +
    ':host ::slotted(.card-content:not(:nth-child(1 of .card-content,.card-header))),slot:not(:first-child)::slotted(.card-content){margin-top:calc(var(--ha-space-2,8px) * -1);padding-top:0}' +
    ':host ::slotted(.card-content){padding:var(--ha-space-4,16px)}' +
    ':host ::slotted(.card-actions){border-top:1px solid var(--divider-color,#e8e8e8);padding:var(--ha-space-2,8px)}';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  class HkPlate extends HTMLElement {
    static get observedAttributes() { return ['header']; }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._header = '';
      this._draw();
    }
    get header() { return this._header; }
    set header(v) { v = v == null ? '' : String(v); if (v !== this._header) { this._header = v; this._draw(); } }
    get raised() { return this.hasAttribute('raised'); }
    set raised(v) { if (v) this.setAttribute('raised', ''); else this.removeAttribute('raised'); }
    attributeChangedCallback(name, was, value) { if (name === 'header') this.header = value; }
    // the plate's own markup: its style, the header if any, the card's content
    markup() {
      return '<style>' + PLATE_CSS + '</style>' +
        (this._header ? '<h1 class="card-header">' + esc(this._header) + '</h1>' : '') + '<slot></slot>';
    }
    _draw() { this.shadowRoot.innerHTML = this.markup(); }
  }

  ce.define('hk-icon', HkIcon);
  ce.define('hk-plate', HkPlate);
  // an iconset (or hkIcons) has just been registered: draw the icons that asked too early
  function iconsetAdded() {
    var again = [];
    waiting.forEach(function (el) { if (known(el._icon)) again.push(el); });
    again.forEach(function (el) { waiting.delete(el); el._load(); });
    return again.length;
  }

  global.hkElements = { version: '1.1.0', resolveIcon: resolve, iconsetAdded: iconsetAdded, PLATE_CSS: PLATE_CSS, ICON_CSS: ICON_CSS };
})(globalThis);
