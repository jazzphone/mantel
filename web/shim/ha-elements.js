// ha-elements.js -- the few Home Assistant elements HK's cards draw, as plain stand-ins.
//
//   ha-card        a container with HA's plate variables (HK sets the --ha-card-* ones itself)
//   ha-icon        an SVG; `mdi:` names from the committed subset (/static/mdi), `hk:` names from
//                  window.customIconsets.hk (hk-icons.js, Apple's glyphs from "Your files")
//   ha-state-icon  ha-icon for an entity: its `icon` attribute, else a small domain default
//   ha-svg-icon    an SVG from a path string
//
// Not stood in for (not on the Home page): ha-form, ha-yaml-editor, the more-info dialog. (The HK
// Settings panel needs neither: since Phase 2 P2.4 it draws with the settings kit's own YAML editor.)
const NS = 'http://www.w3.org/2000/svg';

class HaCard extends HTMLElement {
  constructor() {
    super();
    const sr = this.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>:host{display:block;position:relative;box-sizing:border-box;' +
      'background:var(--ha-card-background,var(--card-background-color,#1c1c1e));' +
      'border-radius:var(--ha-card-border-radius,12px);box-shadow:var(--ha-card-box-shadow,none);' +
      'border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,transparent);' +
      'color:var(--primary-text-color,#fff);transition:all .3s ease-in-out}</style><slot></slot>';
  }
}

const svgFor = (root) => {
  root.innerHTML = '<style>:host{display:inline-flex;align-items:center;justify-content:center;position:relative;' +
    'vertical-align:middle;fill:currentcolor;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}' +
    'svg{width:100%;height:100%;pointer-events:none;display:block}</style>' +
    '<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" focusable="false"><path class="p"/><path class="s" style="opacity:.4"/></svg>';
  return { svg: root.querySelector('svg'), p: root.querySelector('.p'), s: root.querySelector('.s') };
};

function paint(parts, icon) {
  if (!icon) { parts.p.removeAttribute('d'); parts.s.removeAttribute('d'); return; }
  parts.svg.setAttribute('viewBox', icon.viewBox || '0 0 24 24');
  parts.p.setAttribute('d', icon.path || '');
  if (icon.secondaryPath) parts.s.setAttribute('d', icon.secondaryPath); else parts.s.removeAttribute('d');
}

async function resolveIcon(name) {
  if (!name) return null;
  const i = name.indexOf(':');
  const set = i < 0 ? 'mdi' : name.slice(0, i), id = i < 0 ? name : name.slice(i + 1);
  const custom = window.customIconsets && window.customIconsets[set];
  if (custom) return custom(id);
  if (set === 'mdi' && window.hkIcons && window.hkIcons.mdiPath) {
    const path = await window.hkIcons.mdiPath(id);
    return path ? { path } : null;
  }
  if (set === 'mdi') {
    // (before hk-icons.js has loaded) the chunk that holds the name, as hkIcons.mdiPath reads it: iconMetadata.json's
    // parts are in name order, each from its `start`
    if (!resolveIcon.meta) resolveIcon.meta = fetch('/static/mdi/iconMetadata.json').then((r) => r.json()).catch(() => null);
    const meta = await resolveIcon.meta;
    if (!meta || !Array.isArray(meta.parts) || !meta.parts.length) return null;
    let file = meta.parts[0].file;
    for (const p of meta.parts) { if (p.start && id < p.start) break; file = p.file; }
    resolveIcon.chunks = resolveIcon.chunks || {};
    if (!resolveIcon.chunks[file]) resolveIcon.chunks[file] = fetch('/static/mdi/' + file + '.json').then((r) => r.json()).catch(() => ({}));
    const all = await resolveIcon.chunks[file];
    return all[id] ? { path: all[id] } : null;
  }
  return null;
}

class HaIcon extends HTMLElement {
  static get observedAttributes() { return ['icon']; }
  constructor() {
    super();
    this._parts = svgFor(this.attachShadow({ mode: 'open' }));
    this._icon = '';
  }
  get icon() { return this._icon; }
  set icon(v) { v = v || ''; if (v !== this._icon) { this._icon = v; this._loadIcon(); } }
  attributeChangedCallback(n, o, v) { if (n === 'icon') this.icon = v; }
  async _loadIcon() {
    const want = this._icon;
    let icon = null;
    try {
      icon = await resolveIcon(want);
      if (!icon && this._fallback && want) icon = await resolveIcon(this._fallback);
    } catch (e) { /* a missing glyph draws nothing */ }
    if (want === this._icon) paint(this._parts, icon);
  }
}

const DOMAIN_ICON = {
  light: 'mdi:lightbulb', switch: 'mdi:toggle-switch', lock: 'mdi:lock', cover: 'mdi:window-shutter',
  climate: 'mdi:thermostat', fan: 'mdi:fan', media_player: 'mdi:speaker', camera: 'mdi:video',
  sensor: 'mdi:eye', binary_sensor: 'mdi:checkbox-blank-circle-outline', vacuum: 'mdi:robot-vacuum',
  person: 'mdi:account', weather: 'mdi:weather-partly-cloudy', alarm_control_panel: 'mdi:shield-home',
  scene: 'mdi:palette', script: 'mdi:script-text-play', automation: 'mdi:robot', button: 'mdi:gesture-tap-button',
  input_button: 'mdi:gesture-tap-button',
  input_boolean: 'mdi:toggle-switch', timer: 'mdi:timer-outline', valve: 'mdi:valve', humidifier: 'mdi:air-humidifier',
  water_heater: 'mdi:water-boiler', remote: 'mdi:remote', siren: 'mdi:alarm-light', device_tracker: 'mdi:account',
};

class HaStateIcon extends HaIcon {
  set stateObj(s) { this._s = s; this._refresh(); }
  get stateObj() { return this._s; }
  set hass(h) { this._h = h; }
  set icon(v) { this._own = v; this._refresh(); }
  get icon() { return this._own; }
  _refresh() {
    const s = this._s;
    const domain = s && s.entity_id ? s.entity_id.split('.')[0] : '';
    const fallback = DOMAIN_ICON[domain] || 'mdi:gesture-tap-button';
    const name = this._own || (s && s.attributes && s.attributes.icon) || fallback;
    if (name !== this._icon || fallback !== this._fallback) {
      this._fallback = fallback; this._icon = name; this._loadIcon();
    }
  }
}

class HaSvgIcon extends HTMLElement {
  constructor() { super(); this._parts = svgFor(this.attachShadow({ mode: 'open' })); }
  set path(p) { this._path = p; paint(this._parts, p ? { path: p } : null); }
  get path() { return this._path; }
  set secondaryPath(p) { this._parts.s.setAttribute('d', p || ''); }
}

// Mantel's hk-state-icon (the host's element; HK's own hk-icon and hk-plate are shared:
// web/hk/elements/hk-elements.js): the same small domain default as the ha-state-icon stand-in.
class HkStateIcon extends HaStateIcon {}

for (const [tag, cls] of [['ha-card', HaCard], ['ha-icon', HaIcon], ['ha-state-icon', HaStateIcon], ['ha-svg-icon', HaSvgIcon],
                          ['hk-state-icon', HkStateIcon]]) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
}
