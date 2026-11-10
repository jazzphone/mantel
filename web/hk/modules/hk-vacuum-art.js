// hk-vacuum-art.js -- THE VACUUM, DRAWN (2026-11-09, the owner: "instead of the battery percentage...which isn't super useful info...
// would it be better to have a vacuum image done that looks like the HomeKit glyph? It can be animated, shown when docked, display water
// empty, it can show charging, and vacuuming as well?" -- the mockup approved: "Yes I love it!!").
//
// Apple's robot-vacuum glyph (hk:robot-vacuum, the house's SF Symbols; Material's robot-vacuum where the home has no glyph file), drawn
// large on a floor shadow, and what it is doing around it: on its dock (the dock behind it, its light steady), charging (the light
// breathes, a charge bolt over the dock), cleaning (the side brush spins, the robot drifts, its path marches along the floor), returning
// (it glides back to the dock), paused (a pause badge), the water tank empty (a red water badge, struck through) and stuck (a red badge,
// a shake now and then). Everything is still where motion is off (prefers-reduced-motion, and Flat's stopped animations).
//
//   hkVacuumArt.CSS                      the styles, for a card's shadow root
//   hkVacuumArt.html(state, words)       the drawing for a state (one of STATES) -- a box of 200 : 140, as wide as its parent makes it
//   hkVacuumArt.look(client, id, cfg)    { state, words } for a vacuum: its own state, its charge state and its error (found on its device)
//   hkVacuumArt.ids(client, id, cfg)     the sensors look() reads, for a card's redraw signature
// @ts-check
(function (global) {
  'use strict';
  if (global.hkVacuumArt) return;

  var STATES = ['docked', 'charging', 'cleaning', 'returning', 'paused', 'water', 'error', 'idle'];
  // a Matter vacuum's operational errors (RVC Operational State) and the other integrations' spellings of "fine"
  var OK = ['no_error', 'none', 'ok', 'unknown', 'unavailable', ''];
  var WATER = /water_tank|clean_water|dirty_water|water_box|mop_(cleaning_)?pad|mop_missing|water_shortage|no_water/i;

  // THE SENSORS ON THE VACUUM'S DEVICE: its operational error (not the dock's) and its battery's charge state
  function find(client, id, re, not) {
    var ents = client && client.entities, states = (client && client.states) || {};
    var dev = ents && ents[id] && ents[id].device_id;
    if (!dev) return null;
    return Object.keys(ents).filter(function (k) {
      return k !== id && ents[k].device_id === dev && k.indexOf('sensor.') === 0 && states[k] && re.test(k) && !(not && not.test(k));
    }).sort()[0] || null;
  }
  function ids(client, id, cfg) {
    var c = cfg || {};
    return { error: c.error || find(client, id, /operational_error|_error$/, /dock/), charge: c.charge || find(client, id, /charge_state|charging_state/) };
  }
  function words(s) { var t = String(s || '').replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }

  // WHAT TO DRAW: the water tank and being stuck first (they need someone), then what it is doing
  function look(client, id, cfg) {
    var states = (client && client.states) || {}, st = states[id], s = (st && st.state) || 'unknown', x = ids(client, id, cfg);
    var err = x.error && states[x.error] ? String(states[x.error].state) : '';
    var chg = x.charge && states[x.charge] ? String(states[x.charge].state) : '';
    var bad = err && OK.indexOf(err.toLowerCase()) < 0;
    if (bad && WATER.test(err)) return { state: 'water', words: words(err) };
    if (s === 'error' || bad) return { state: 'error', words: bad ? words(err) : 'Needs help' };
    if (s === 'cleaning') return { state: 'cleaning', words: 'Cleaning' };
    if (s === 'returning') return { state: 'returning', words: 'Returning' };
    if (s === 'paused') return { state: 'paused', words: 'Paused' };
    if (s === 'docked') return /(^|_)charging$/.test(chg) && !/not_charging/.test(chg) ? { state: 'charging', words: 'Charging' } : { state: 'docked', words: 'Docked' };
    if (s === 'unavailable' || s === 'unknown') return { state: 'idle', words: 'Unavailable' };
    return { state: 'idle', words: words(s) };
  }

  // THE DRAWING: three layers in one 200 x 140 box -- behind (the shadow, the dock, the path), the robot (the glyph and its side brush,
  // moving together) and in front (motion lines, the bolt, a badge). The glyph sits as the mockup drew it: 144 units square at (28, 6)
  var V = '<svg viewBox="0 0 200 140" aria-hidden="true">';
  function html(state, label) {
    var s = STATES.indexOf(state) >= 0 ? state : 'idle', dock = /^(docked|charging|returning)$/.test(s), back = '', front = '', brush = '';
    back += '<ellipse class="sh" cx="100" cy="123" rx="64" ry="6"/>';
    if (dock) back += '<rect class="dk" x="72" y="22" width="56" height="74" rx="14"/><circle class="led" cx="100" cy="36" r="3.2"/>';
    if (s === 'cleaning') back += '<path class="tr" d="M168 121 C150 132 118 134 92 131 C70 129 52 126 40 120"/>';
    if (s === 'cleaning' || s === 'returning') {
      brush = V + '<g transform="translate(50 118)"><g class="sp"><line x1="0" y1="0" x2="0" y2="-11"/><line x1="0" y1="0" x2="9.5" y2="5.5"/>' +
        '<line x1="0" y1="0" x2="-9.5" y2="5.5"/></g></g></svg>';
    }
    if (s === 'returning') front += '<g class="stk"><line x1="170" y1="78" x2="188" y2="78"/><line x1="174" y1="92" x2="194" y2="92"/><line x1="170" y1="106" x2="186" y2="106"/></g>';
    if (s === 'paused') front += '<g class="bg"><circle cx="158" cy="34" r="17"/><rect x="151" y="26" width="4.5" height="16" rx="2" class="mk"/><rect x="160.5" y="26" width="4.5" height="16" rx="2" class="mk"/></g>';
    if (s === 'water') front += '<g class="bg warn"><circle cx="158" cy="34" r="19"/></g>';
    if (s === 'error') front += '<g class="bg warn"><circle cx="158" cy="34" r="17"/><rect x="155.6" y="23" width="4.8" height="15" rx="2.4" class="mk"/><circle cx="158" cy="43.5" r="2.8" class="mk"/></g>';
    var over = s === 'charging' ? '<hk-icon class="bolt" icon="hk:battery-charging"></hk-icon>'
      : s === 'water' ? '<hk-icon class="drop" icon="hk:water"></hk-icon>' + V + '<line class="sl" x1="146" y1="47" x2="171" y2="22"/></svg>' : '';
    return '<div class="hkva s-' + s + '" role="img" aria-label="' + String(label || words(s)).replace(/[&<>"]/g, '') + '">' +
      V + back + '</svg><div class="rb"><hk-icon class="gl" icon="hk:robot-vacuum"></hk-icon>' + brush + '</div>' +
      (front ? V + front + '</svg>' : '') + over + '</div>';
  }

  // (built when a card first asks: this file loads with the core, before hk-base.js has made hkCards)
  var built = '';
  function css() {
    if (built) return built;
    var C = global.hkCards || {}, A = C.ACCENTS || {}, v = C.v || function (n) { return 'var(--hk-' + n + ')'; };
    var MINT = A.mint || '#63e6e2', RED = A.red || '#ff453a';
    return (built = [
    '.hkva{position:relative;width:100%;aspect-ratio:200/140;flex:none;color:' + v('ink') + '}',
    '.hkva>svg,.hkva>.rb,.hkva>.rb>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.hkva .gl{position:absolute;left:14%;top:4.2857%;width:72%;height:102.857%;--mdc-icon-size:100%;display:block;color:inherit}',
    '.hkva .sh{fill:rgba(0,0,0,.28)}.hkva .dk{fill:' + v('key') + ';stroke:' + v('line-strong') + ';stroke-width:1.2}.hkva .led{fill:' + MINT + '}',
    '.hkva .sp line{stroke:' + MINT + ';stroke-width:2.6;stroke-linecap:round}',
    '.hkva .tr{fill:none;stroke:' + MINT + ';stroke-opacity:.55;stroke-width:3;stroke-linecap:round;stroke-dasharray:2 9}',
    '.hkva .stk line{stroke:' + v('ink-2') + ';stroke-width:3;stroke-linecap:round}',
    '.hkva .bg circle:first-child{fill:#fff}.hkva .bg .mk{fill:#1c1c1e}.hkva .bg.warn circle:first-child{fill:' + RED + '}.hkva .bg.warn .mk{fill:#fff}',
    '.hkva .bolt{position:absolute;left:42%;top:-4.3%;width:16.2%;height:23.1%;--mdc-icon-size:100%;display:block;color:' + MINT + '}',
    '.hkva .drop{position:absolute;left:73%;top:15%;width:12.6%;height:18%;--mdc-icon-size:100%;display:block;color:#fff}',
    '.hkva .sl{stroke:#fff;stroke-width:3;stroke-linecap:round}',
    '@media (prefers-reduced-motion:no-preference){',
    '  .hkva .sp{animation:hkva-spin .55s linear infinite}@keyframes hkva-spin{to{transform:rotate(360deg)}}',
    '  .hkva.s-cleaning .rb{animation:hkva-drift 6s ease-in-out infinite}@keyframes hkva-drift{0%,100%{transform:translateX(-3%)}50%{transform:translateX(4%)}}',
    '  .hkva.s-cleaning .tr{animation:hkva-march 1.2s linear infinite}@keyframes hkva-march{to{stroke-dashoffset:-22}}',
    '  .hkva.s-charging .led,.hkva.s-charging .bolt{animation:hkva-breathe 2.4s ease-in-out infinite}@keyframes hkva-breathe{0%,100%{opacity:.35}50%{opacity:1}}',
    '  .hkva.s-returning .rb{animation:hkva-home 3.2s ease-in-out infinite}@keyframes hkva-home{0%{transform:translateX(13%)}70%,100%{transform:translateX(0)}}',
    '  .hkva.s-returning .stk{animation:hkva-fade 3.2s ease-in-out infinite}@keyframes hkva-fade{0%,60%{opacity:.9}75%,100%{opacity:0}}',
    '  .hkva.s-water .bg,.hkva.s-error .bg{transform-origin:79% 24.3%;animation:hkva-pulse 1.8s ease-in-out infinite}@keyframes hkva-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}',
    '  .hkva.s-error .rb{animation:hkva-shake 3s ease-in-out infinite}',
    '  @keyframes hkva-shake{0%,82%,100%{transform:translateX(0)}85%{transform:translateX(-2%)}88%{transform:translateX(2%)}91%{transform:translateX(-1.5%)}94%{transform:translateX(1%)}}',
    '}'
    ].join(''));
  }

  global.hkVacuumArt = { STATES: STATES, get CSS() { return css(); }, html: html, look: look, ids: ids, WATER: WATER };
})(window);
