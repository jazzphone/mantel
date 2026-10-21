// hk-stat.js -- headings and metric readouts as native Lovelace cards.
//
// WHY THESE ARE CARDS, THOUGH THEY HOLD ALMOST NO LOGIC
// A heading could be plain YAML, but a surface where some things are cards
// and some are templates is its own maintenance cost: one card system for
// every surface keeps a template engine from being a hard dependency of
// every heading.
//
// What needs care is the shadows: the heading carries a MEASURED
// text-shadow, and the metric carries a `filter: drop-shadow()` that exists
// because its name and state are both overflow:hidden with an ellipsis -- a
// text-shadow there is clipped into a hard band. Both values are measured.
// Do not tune either by eye.
//
// NOT HERE, deliberately: the weather and usage tiles. They are SHELLS around
// charts drawn by hk-charts.js, which is a different job from formatting a
// state (see hk-weather.js and hk-energy.js).
(function () {
  'use strict';

  if (window.hkStat) return;
  window.hkStat = { version: '1.0.0' };

  // Event, never a poll -- see hk-tile.js for why rAF is wrong here.
  function whenBase(fn) {
    var events = ['hk-cards-ready', 'hk-client-ready', 'hk-host-client-ready', 'hk-metric-ready'];
    var done = false;
    function ready() {
      if (done || !window.hkCards || !window.hkCards.HkBase ||
          !window.hkClient || !window.hkHostClient || !window.hkCreateMetricCard) return;
      done = true;
      events.forEach(function (event) { window.removeEventListener(event, ready); });
      fn(window.hkCards.HkBase);
    }
    events.forEach(function (event) { window.addEventListener(event, ready); });
    ready();
  }

  whenBase(function (HkBase) {

  // RESOLVE hk-tile's EXPORTS AT CALL TIME, NEVER AT LOAD TIME.
  //
  // hk-tile.js is a sibling Lovelace resource, so it may not have run yet when
  // this file does -- and `var colourFor = window.hkTile.colourFor || fallback`
  // captures the FALLBACK permanently when it loses that race. The symptom is
  // subtle and survives review: colours still appear, but as the raw CSS
  // keyword ("yellow" -> rgb(255,255,0)) instead of the Home app's mapped
  // rgba(255,204,0,0.98). A per-card test misses it whenever it happens to
  // run after hk-tile has loaded.
  //
  // Same lesson as the HkBase race, one level up: waiting on load order is the
  // bug. Look the dependency up when you need it.
  function tile() { return window.hkTile || {}; }
  function colourFor(cfg, st) {
    var f = tile().colourFor;
    return f ? f(cfg, st) : (cfg.icon_color || 'rgba(200, 200, 200, 0.80)');
  }
  function nameMap() { return tile().NAME_MAP || {}; }

  // hk_metric DOES NOT USE THE DOMAIN MAP, and that is the difference from
  // every tile: its rule is `override -> named colour or literal, else GRAY`,
  // full stop. Reusing hk-tile's colourFor would tint a unit-less sensor
  // blue, because the domain fallback fires.
  //
  // A metric is a readout on the energy page, where a dozen of them sit in a
  // row; letting the domain pick would paint that row in five colours.
  function metricColour(cfg) {
    var o = cfg.icon_color ? String(cfg.icon_color).toLowerCase().trim() : '';
    var M = nameMap();
    if (o) return M[o] || cfg.icon_color;
    return M.gray || 'rgba(200, 200, 200, 0.80)';
  }

  var CSS = [
    ':host{display:block}',

    // ---- heading ---------------------------------------------------------
    // overflow:visible at EVERY level, and it is load-bearing. Where an
    // hk-plate clips, a text-shadow that reaches outside the 21px line box
    // comes out as a hard rectangular band; this card simply never closes the
    // clip.
    'hk-plate.heading{background:none;border:none;box-shadow:none;',
    '  height:21px;margin:0px;padding:0px 0px 0px 3px;overflow:visible;',
    '  display:flex;align-items:center;justify-content:center;',
    '  font-size:1.2em;text-align:center;',
    '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
    // width:100% is load-bearing. hk-plate is flex with justify-content:center,
    // so a min-content grid gets CENTRED in the full card width and the
    // heading lands 600px to the right.
    '.heading .grid{display:grid;width:100%;overflow:visible;align-items:center;',
    '  justify-content:start;grid-template-areas:"n";',
    '  grid-template-columns:min-content;grid-template-rows:21px}',
    // align-self:stretch, because hk-plate is a flex box with
    // align-items:center. When a call site makes the card TALLER than the 21px
    // row -- a 42px heading with 18px of lead, as on the energy page -- a
    // CENTRED grid puts the text 2.5px high. Filling the content box and
    // letting the row overflow keeps it on its line. Equal sizes stretch and
    // centre alike, which is why an ordinary heading never shows it.
    '.heading .grid{align-self:stretch}',
    // THE TEXT-SHADOW IS MEASURED. One value covers pages and pop-ups: over an
    // opaque dark sheet it is simply invisible, so there is no second variant.
    // text-shadow rather than filter:drop-shadow here because the name is NOT
    // clipped -- nothing sets overflow:hidden on it, so the shadow escapes on
    // its own. (hk_metric below is the opposite case.)
    '.heading .name{grid-area:n;justify-self:start;align-self:center;',
    '  font-size:19.7px;font-weight:700;line-height:1;letter-spacing:-0.45px;',
    '  color:' + window.hkCards.v('ink') + ';overflow:visible;',
    // nowrap + ellipsis: without them a long heading WRAPS TO FOUR LINES
    // instead of truncating -- an 80px name box against 20.7px.
    '  white-space:nowrap;text-overflow:ellipsis;',
    // content-box so the 1px of padding does not grow the measured box, the
    // same trap as the favourite label in hk-tile.js.
    '  box-sizing:content-box;padding-left:1px;padding-top:1px;',
    '  text-shadow:' + window.hkCards.v('glow') + '}',
    // The link variant adds a chevron chip beside the name.
    '.heading.link .grid{grid-template-areas:"n c";',
    '  grid-template-columns:max-content max-content;column-gap:6px}',
    'hk-plate.heading.link{cursor:pointer}',
    // MEASURED, not written by eye. Every property below moves the box:
    // letter-spacing is 0.2px over ~17 glyphs, the chevron is heavier than
    // the words, the line-height adds almost a pixel, and the colour is 0.62
    // (0.82 reads as a second heading).
    //
    // margin-top:2px nudges the whole chip down so its optical centre lines
    // up with a 19.7px heading rather than its box centre.
    '.heading .extra{grid-area:c;align-self:center;display:inline-flex;',
    '  align-items:center;gap:3px;padding:3px 9px 3px 10px;border-radius:11px;',
    '  background:' + window.hkCards.v('key') + ';font-size:11.5px;font-weight:600;',
    '  letter-spacing:0.2px;line-height:1.25;white-space:nowrap;margin-top:2px;',
    '  color:' + window.hkCards.v('ink-2') + '}',
    // The chevron is its OWN span -- lighter and bolder than
    // the words beside it. Rendering the whole string as one run makes it a
    // weight-600 glyph at full opacity, which reads as part of the label.
    '.heading .extra .chev{opacity:0.75;font-weight:700}',
    // A ROOM HEADING: "Living Room ›", the Home app's way into a
    // room. A bare chevron, not the chip above -- grey, a little over half the
    // heading's cap height, centred on the name's optical middle. Only the
    // name and chevron take the tap (not the empty width of the row), with
    // the target grown to 44px tall by an invisible margin.
    '.heading.room .grid{grid-template-areas:"n c";grid-template-columns:max-content max-content;',
    '  column-gap:7px;justify-self:start;position:relative;cursor:pointer;',
    '  -webkit-tap-highlight-color:transparent}',
    '.heading.room .grid::after{content:"";position:absolute;inset:-12px -14px -12px -8px}',
    '.heading .rchev{grid-area:c;align-self:center;display:flex;margin-top:1px;',
    '  filter:var(--hk-glow,drop-shadow(0 1px 2px rgba(0,0,0,0.30)))}',
    '.heading.room .grid:active{opacity:0.6}',
    // AN ENERGY SECTION'S HEADING (`energy_section`): the section's dot and
    // its total on the Energy page's tab -- "1.63 kW now", "9.0 kWh today" --
    // after the name (and its link chip), on the name's line. The dot is the
    // section's part of Where it went.
    '.heading.esec .grid{grid-template-areas:"n c e";grid-template-columns:max-content max-content max-content;column-gap:10px}',
    '.heading.esec:not(.link) .grid{grid-template-areas:"n e";grid-template-columns:max-content max-content}',
    '.heading .esub{grid-area:e;align-self:center;display:inline-flex;align-items:center;gap:7px;margin-top:2px;',
    '  font-size:15px;font-weight:500;line-height:1;color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;',
    '  font-variant-numeric:tabular-nums;text-shadow:' + window.hkCards.v('glow') + '}',
    '.heading .esub:empty{display:none}',
    '.heading .esub i{width:9px;height:9px;border-radius:50%;flex:none}',
    // ON A PHONE THE TOTAL TAKES ITS OWN LINE under the name: a long section
    // name, its link chip and "550 W now" are wider than a phone's column
    // ("Outlets & Infrastructure" ran 43 px off a 375 px page). Every section
    // the same way, not only the ones too long for the line. The card grows
    // with it: an energy section heading's `height` is its minimum (_render).
    '@media (max-width:' + window.hkCards.BP.phone + 'px){',
    '  .heading.esec .grid{grid-template-areas:"n c" "e e";grid-template-columns:max-content max-content;',
    '    grid-template-rows:21px auto;row-gap:6px}',
    '  .heading.esec:not(.link) .grid{grid-template-areas:"n" "e";grid-template-columns:max-content}',
    '  .heading.esec .esub{justify-self:start;margin-top:0}',
    '}',
    'hk-plate.heading{transition:opacity .2s}',

    // ---- metric ----------------------------------------------------------
    // filter:drop-shadow, NOT text-shadow, and the reason is specific: this
    // card's name and state are both overflow:hidden with an ellipsis, and a
    // text-shadow is clipped by the box that paints it -- a 34px blur on a
    // 21px line box comes out as a hard band. A filter applies AFTER the
    // element has rendered and clipped, so the ellipsis still works and the
    // shadow escapes. Moving it to a wrapper does not help: text-shadow
    // INHERITS, so every line paints and clips its own copy.
    'hk-plate.metric{background:none;border:none;box-shadow:none;border-radius:0px;',
    '  height:78px;margin:0px;padding:0px 4px 0px 3px;overflow:visible;',
    '  display:flex;align-items:center;justify-content:center;',
    '  font-size:1.2em;text-align:center;cursor:pointer;',
    '  filter:var(--hk-glow,drop-shadow(0 1px 3px rgba(0,0,0,0.30)) drop-shadow(0 2px 8px rgba(0,0,0,0.22)));',
    '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
    '.metric .grid{display:grid;width:100%;overflow:visible;',
    '  grid-template-areas:"i n" "i s";grid-template-columns:40px minmax(0,1fr);',
    '  grid-template-rows:min-content min-content;row-gap:3px;column-gap:14px;',
    '  align-content:center;justify-content:start}',
    // width:100%, not 42px. The grid track is 40 and the well resolves to the
    // TRACK -- a literal 42 here is 2px too wide and sits 1px left.
    '.metric .well{grid-area:i;width:100%;height:42px;border-radius:50%;',
    '  background:rgba(0,0,0,0.14);align-self:center;justify-self:center;',
    '  display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '.metric .icon{width:23px;height:23px;--mdc-icon-size:100%;display:flex;align-items:center;justify-content:center;line-height:0;}',
    // The label is the one label (hkCards.TYPE label: 13 / 600 / 0.3px,
    // uppercase, secondary ink) -- a caption, not a name. Positive tracking,
    // the opposite of every tile: small uppercase needs opening up.
    '.metric .name{grid-area:n;justify-self:start;align-self:end;',
    '  font-size:13px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;',
    '  color:' + window.hkCards.v('ink-2') + ';text-align:left;width:100%;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.metric .state{grid-area:s;justify-self:start;align-self:start;',
    '  font-size:25px;font-weight:700;line-height:1.05;letter-spacing:-0.4px;',
    '  color:' + window.hkCards.v('ink') + ';text-align:left;width:100%;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

    // ---- hero / pct / rank pill -----------------------------------------
    // One card, three modes: the hero, percent and rank pills share every
    // style exactly and differ only in what their `hero` cell renders.
    'hk-plate.rank{box-sizing:border-box;height:' + window.hkCards.TILE.tall + 'px;width:' + window.hkCards.TILE.css + ';',
    '  min-width:' + window.hkCards.TILE.css + ';max-width:' + window.hkCards.TILE.css + ';border-radius:' + window.hkCards.M.radius + ';',
    // the well starts at the pills' inset (hk-tile.js): left 10.3, as a tall tile
    '  padding:12.8px 12.8px 12.8px 10.3px;margin:0px;',
    '  border:' + window.hkCards.M.border + ';',
    '  ' + window.hkCards.M.glass + ';',
    '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-tall') + ');',
    '  display:flex;align-items:center;justify-content:center;',
    '  overflow:hidden;text-align:center;font-size:1.2em;cursor:pointer;',
    '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
    '  transition:background-color .25s ease,transform .12s ease}',
    // in a section: fills its cell, like the tiles (hk-tile.js)
    ':host([data-hk-cell]) hk-plate.rank{width:100%;min-width:0;max-width:none}',
    'hk-plate.rank:active{transform:scale(0.97);filter:brightness(0.93)}',
    'hk-plate.rank[data-on="1"]{background:white}',
    // The reading sits top-left and the well top-RIGHT -- the mirror of a
    // tall tile, which is why this is not a hk_pill_tall variant.
    '.rank .grid{display:grid;width:100%;align-self:stretch;',
    '  grid-template-areas:"hero i" ". ." "n n" "l l";',
    '  grid-template-columns:minmax(0,1fr) 42px;',
    '  grid-template-rows:46px 1fr min-content min-content;',
    '  row-gap:0px;column-gap:8px;align-content:stretch}',
    '.rank .well{grid-area:i;width:42px;height:42px;border-radius:50%;',
    '  background:var(--hk-look-well, ' + window.hkCards.v('well-bg') + ');align-self:start;justify-self:end;',
    '  display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '.rank .icon{width:23px;height:23px;--mdc-icon-size:100%;display:flex;align-items:center;justify-content:center;line-height:0;}',
    '.rank .hero{grid-area:hero;justify-self:start;align-self:start;',
    '  line-height:1;white-space:nowrap;font-size:30px;font-weight:700;',
    '  letter-spacing:-0.6px;overflow:hidden;text-overflow:ellipsis}',
    '.rank .unit{font-size:0.40em;font-weight:600;letter-spacing:0;',
    '  margin-left:3px;opacity:0.62}',
    '.rank .unit.pct{font-size:0.42em;margin-left:2px}',
    '.rank .name{grid-area:n;justify-self:stretch;align-self:center;',
    '  font-size:14px;font-weight:600;line-height:1.1;letter-spacing:-0.15px;',
    '  color:' + window.hkCards.v('ink') + ';text-align:left;min-width:0;width:100%;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    'hk-plate.rank[data-on="1"] .name{color:black}',
    '.rank .label{grid-area:l;justify-self:stretch;align-self:start;',
    '  font-size:14px;font-weight:400;line-height:1.1;letter-spacing:-0.15px;',
    '  color:' + window.hkCards.v('ink-2') + ';text-align:left;min-width:0;width:100%;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    'hk-plate.rank[data-on="1"] .label{color:rgba(0,0,0,0.65)}',
    // ON THE ENERGY PAGE (`energy: true`) the empty middle row carries the
    // tile's line: the last three hours of its watts on Now, its last two
    // weeks of kWh on the other tabs; a battery's level as a bar. The tile
    // keeps its size and its every other row.
    '.rank.en .grid{grid-template-areas:"hero i" "s s" "n n" "l l"}',
    '.rank .spark{grid-area:s;align-self:end;width:100%;height:30px;margin-bottom:9px;overflow:visible;display:none}',
    '.rank.en .spark{display:block}',
    '.rank .lvl{grid-area:s;align-self:end;height:8px;margin-bottom:12px;border-radius:4px;overflow:hidden;display:none;',
    '  background:' + window.hkCards.v('key') + '}',
    '.rank.en .lvl.on{display:block}',
    '.rank.en .lvl.on ~ .spark{display:none}',
    '.rank .lvl i{display:block;height:100%;border-radius:4px}',
    '.rank .label b{font-weight:600}',
    '.rank .label b.up{color:#ffb340}.rank .label b.down{color:#4cd964}',
    // THE POWER BUTTON, bottom right: 34 px, a 44 px target; the name and
    // label keep clear of it. Off, the tile steps back.
    'hk-plate.rank{position:relative}',
    '.rank .pwr{position:absolute;right:12.8px;bottom:12.8px;width:34px;height:34px;border-radius:50%;border:0;padding:0;',
    '  display:grid;place-items:center;cursor:pointer;color:#fff;background:#30d158;',
    '  box-shadow:0 2px 6px rgba(0,0,0,0.25);transition:background-color .2s ease,color .2s ease,transform .12s ease;',
    '  -webkit-tap-highlight-color:transparent}',
    '.rank .pwr::after{content:"";position:absolute;inset:-5px}',
    '.rank .pwr:active{transform:scale(0.9)}',
    '.rank .pwr[data-on="0"]{background:' + window.hkCards.v('key-strong') + ';color:' + window.hkCards.v('ink-2') + ';box-shadow:none}',
    'hk-plate.rank.haspwr .name,hk-plate.rank.haspwr .label{padding-right:42px;box-sizing:border-box}',
    // BACKED UP BY THE HOUSE BATTERY (`backed`, the Power page and the
    // Energy page): a small green battery at the start of the kWh line -- a
    // picture anyone reads, nothing on the glyph, no name cut short. A
    // pseudo-element, so the line's text can change under it. On a tile too
    // narrow for the battery and "12.4 kWh today" (under 164 px inside its
    // padding: the desk with its sidebar, the iPads, the car, a phone) the
    // word "today" steps aside rather than the line ending in "to...".
    'hk-plate.rank.bkd{container-type:inline-size}',
    '.rank.bkd .label::before{content:"";display:inline-block;width:15px;height:10px;margin-right:5px;vertical-align:-0.5px;',
    '  background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 10%27%3E%3Crect x=%27.75%27 y=%27.75%27 width=%2712.5%27 height=%278.5%27 rx=%272.2%27 fill=%27none%27 stroke=%27%2330d158%27 stroke-width=%271.5%27/%3E%3Crect x=%2714%27 y=%273.3%27 width=%271.6%27 height=%273.4%27 rx=%27.6%27 fill=%27%2330d158%27/%3E%3Crect x=%272.6%27 y=%272.6%27 width=%276.4%27 height=%274.8%27 rx=%271%27 fill=%27%2330d158%27/%3E%3C/svg%3E") no-repeat center/contain}',
    '@container (max-width:163px){.rank.bkd .label .td{display:none}}',
    '.rank .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
    'hk-plate.rank.pwroff .hero,hk-plate.rank.pwroff .well,hk-plate.rank.pwroff .spark{opacity:0.45}',
    // on a new Energy tab its line draws in, left to right (a clip: no layout)
    '@keyframes hkWipe{from{clip-path:inset(0 100% 0 0)}}',
    '.rank .spark.wipe{animation:hkWipe .7s cubic-bezier(.22,.8,.25,1) backwards}',
    '@media (prefers-reduced-motion: reduce){.rank .spark.wipe{animation:none}}',
    'hk-plate.rank{transition:background-color .25s ease,transform .12s ease,opacity .2s}',
    // ================================================ PHONE: FILL THE TRACK
    // Below 640px the room grids switch to `repeat(auto-fill, minmax(168px,
    // 1fr))` (see frontend/css/hk-responsive.css), so the track is no longer
    // the pill's width (196, the table's) and a pill pinned to it would overflow.
    // Here the pill fills whatever track it is given instead.
    //
    // WHY `calc(100% + 8px)` AND NOT `100%`: layout-card gives every grid child
    // 4px side margins, so the cell is always 8px narrower than the track
    // (layout-card's card_margin cannot change it). At 1280 the pill is 196px in a 188px
    // cell -- it already overflows by exactly 8px, and that is what makes the
    // visible gap come out at the grid's own (TILE.gridGap, 10). Plain `100%`
    // would shrink every pill to the cell and change the gap.
    //
    // `--hk-cell-bleed` exists because that 8px is NOT universal: inside
    // hk-row-card the child is sized directly with no layout-card margin, so
    // that card sets the bleed to 0 for its own children. Default 8px = the
    // grid case.
    //
    // No max-width: capping at the pill's width makes the track wider than the
    // pill on a large phone and the gap jumps (12px -> 25px, measured at 192).
    // Verified 375/402/440/1280.
    '@media (max-width:' + window.hkCards.BP.phone + 'px){',
    // NO `:host{width:100%}` HERE. These hosts are already `display:block`, so
    // an auto width fills the grid area MINUS the 4px side margins layout-card
    // gives every child -- which is exactly the cell (8 px under the track)
    // the pill is built to overflow by 8. Forcing width:100% resolves against
    // the full grid AREA instead and every tile comes out 8px too wide (190.95
    // measured against a 182.95 track), eating the gap (then 12px) to 4px.
    '  :host{max-width:none !important}',
    '  hk-plate.rank{width:calc(100% + var(--hk-cell-bleed, 8px));min-width:0;max-width:none}',
    '}',
  ].join('');

  // THE ENERGY PAGE (hk-energy.js), when it is loaded: the tab, the lit
  // section and a tile's figures. A card here can draw before hk-energy.js has
  // run (they are separate resources, fetched in parallel), so it asks again
  // when that file says it is ready.
  function energyPage(card) {
    var EP = window.hkEnergyPage;
    if (EP && EP.tile) { EP.join(card); return EP; }
    if (!card._hkWaitEnergy) {
      card._hkWaitEnergy = true;
      window.addEventListener('hk-energy-ready', function () { card._hkWaitEnergy = false; if (card.isConnected) card.redraw(); }, { once: true });
    }
    return null;
  }
  // what an energy card's drawing depends on beyond its entities: the tab,
  // the lit section, the page's data, and -- on Now -- a five-second clock
  function energySig(pin) {
    var EP = window.hkEnergyPage;
    if (!EP || !EP.tile) return 'energy:none';
    var p = pin || EP.getPeriod();
    return 'energy:' + p + '|' + EP.pick + '|' + EP.ver + (p === 'now' ? '|' + Math.floor(Date.now() / 5e3) : '');
  }

  class HkStatBase extends HkBase {


    // Flat keeps its motion: the drawing in IS the chart (hk-base flatCss)

    static get FLAT_MOTION() { return true; }
    static get CSS() { return CSS; }
    getCardSize() { return 1; }
  }

  // The section heading, and the section link.
  //
  // `navigation_path` turns it into the link variant. Dashboards have
  // different url_paths and one shared config has to work on all of them --
  // so a relative path ("./cameras") is resolved against the CURRENT
  // dashboard rather than hardcoded.
  class HkHeadingCard extends HkStatBase {
    setConfig(config) {
      if (!config || !config.name) throw new Error('hk-heading: `name` is required');
      super.setConfig(config);
    }
    _sigOf() {
      // No entity: a heading depends on its config alone, so it never needs to
      // re-render on a state change. Returning a constant means the base class
      // gates it out of every state push. A ROOM heading also
      // depends on where its room page is (and whether headings link at all).
      if (this._config && this._config.energy_section) return energySig(this._config.energy_period);
      return this._config && this._config.area ? 'room=' + this._roomPath() : 'static';
    }
    // `area:` -- this dashboard's room page for it (hk-base.js menu.roomPath).
    _roomPath() {
      var M = window.hkCards && window.hkCards.menu;
      return (M && this._config.area) ? M.roomPath(this._config.area) : null;
    }
    _render() {
      var cfg = this._config;
      var room = cfg.navigation_path ? null : this._roomPath();
      var isLink = !!cfg.navigation_path;
      if (this._built && room !== this._roomWas) this._built = false;
      if (!this._built) {
        this._roomWas = room;
        this._root.innerHTML =
          '<hk-plate class="heading' + (isLink ? ' link' : '') + (room ? ' room' : '') + (cfg.energy_section ? ' esec' : '') + '" data-hk-role="card">' +
          '<div class="grid"' + (room ? ' role="link" tabindex="0"' : '') + '>\n<div class="name" data-hk-role="name"></div>\n' +
          (cfg.chevron ? '<div class="extra" data-hk-role="extra"></div>\n' : '') +
          (cfg.energy_section ? '<div class="esub" data-hk-role="esub"></div>\n' : '') +
          (room ? '<div class="rchev" aria-hidden="true"><svg viewBox="0 0 8 13" width="8" height="13" fill="none"' +
                  ' style="stroke:var(--hk-mark,rgba(255,255,255,0.55))" stroke-width="2.2" stroke-linecap="round"' +
                  ' stroke-linejoin="round"><path d="M1.6 1.6 L6.4 6.5 L1.6 11.4"/></svg></div>\n' : '') +
          '</div></hk-plate>';
        this._e = {
          card: this._root.querySelector('.heading'),
          name: this._root.querySelector('.name'),
          extra: this._root.querySelector('.extra'),
          esub: this._root.querySelector('.esub')
        };
        if (isLink) this._e.card.addEventListener('click', this._go.bind(this));
        if (room) {
          var self = this, grid = this._root.querySelector('.grid');
          var go = function () {
            self._act({ action: 'navigate', navigation_path: self._roomWas }, false);
          };
          grid.addEventListener('click', go);
          grid.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        }
        this._built = true;
      }
      // A HEADING IS NOT ALWAYS 21px. Call sites override its box -- a 44px
      // row on the timers page, a 42px one with 18px of lead where the
      // heading sits under something. Those are per-site geometry, not a
      // second design, so they stay per-site options rather than becoming
      // variants; `padding` is passed through verbatim.
      // `height` sizes the CARD only and leaves grid-template-rows at 21px:
      // defaulting the row to the card height re-centres the text and pushes
      // the heading 2.5px up. The row moves only when the call site sets
      // `grid_rows` itself.
      // An energy section's heading can take a second line (on a phone), so
      // its `height` is a minimum and the card grows to fit.
      if (cfg.height && cfg.energy_section) {
        this._e.card.style.minHeight = cfg.height;
        this._e.card.style.height = 'auto';
      } else if (cfg.height) this._e.card.style.height = cfg.height;
      if (cfg.grid_rows) {
        this._e.card.querySelector('.grid').style.gridTemplateRows = cfg.grid_rows;
      }
      if (cfg.padding) this._e.card.style.padding = cfg.padding;
      if (this._e.name.textContent !== cfg.name) this._e.name.textContent = cfg.name;
      if (this._e.esub) this._energySub();
      // A TRAILING CHEVRON IS ITS OWN RUN. `chevron: "See all\u203a"`
      // is one string in the config because that reads well in YAML; it
      // draws as two spans, so it is split apart here.
      if (this._e.extra && this._e.extra.getAttribute('data-txt') !== cfg.chevron) {
        this._e.extra.setAttribute('data-txt', cfg.chevron);
        var txt = String(cfg.chevron), tail = '';
        if (/[\u203a\u276f>]$/.test(txt)) {
          tail = txt.slice(-1);
          txt = txt.slice(0, -1);
        }
        this._e.extra.textContent = txt;
        if (tail) {
          var cv = document.createElement('span');
          cv.className = 'chev';
          cv.textContent = tail;
          this._e.extra.appendChild(cv);
        }
      }
    }
    // THE SECTION'S TOTAL ON THE TAB, and the section dimmed while another
    // is lit on the page (hk-energy.js window.hkEnergyPage)
    _energySub() {
      var EP = energyPage(this), id = this._config.energy_section, pin = this._config.energy_period;
      var x = EP ? EP.section(this.client, this, id, pin) : null;
      var html = x && x.text ? '<i style="background:' + x.color + '"></i>' + x.text : '';
      if (this._e.esub._h !== html) { this._e.esub.innerHTML = html; this._e.esub._h = html; }
      this._e.card.style.opacity = !pin && EP && EP.pick && EP.pick !== id ? '0.28' : '';
    }
    // The same navigate every tile uses (HkBase._act): "./x" is relative to
    // the CURRENT dashboard, and `navigation_path_map` names the one
    // dashboard where that is the wrong answer. One copy means a heading and
    // a tile with the same path always land on the same page.
    _go() {
      this._act({ action: 'navigate', navigation_path: this._config.navigation_path,
                  navigation_path_map: this._config.navigation_path_map }, false);
    }
  }

  // hk_metric -- an icon well, an uppercase caption and a big value, with no
  // plate under it. Used on the energy and battery pages.
  var FLOW_FLOOR = 5;
  var HkMetricCard = window.hkCreateMetricCard(HkStatBase, metricColour, FLOW_FLOOR);

  // 5 W. Below this a battery is not meaningfully charging or discharging --
  // it is the same floor the rank pills use to decide a circuit is idle.


  // hk_hero_pill / hk_pct_pill / hk_rank_pill.
  //
  //   mode: hero  the value as given (or the entity state)
  //   mode: pct   a rounded percentage with a small % suffix
  //   mode: rank  live watts via hkChart.power(), with kWh-today as the label
  //               via hkStats.daily()
  //
  // `rank` is the only card in this library that INTEGRATES other modules
  // rather than formatting state, which is why it needs HkBase.requestUpdate:
  // hkStats resolves asynchronously and wakes the card when the data lands.
  class HkRankCard extends HkStatBase {
    setConfig(config) {
      if (!config || !config.entity) throw new Error('hk-rank: `entity` is required');
      super.setConfig(config);
    }
    // a tall tile (150 px): three of Lovelace's ~50 px rows, not the base's one
    getCardSize() { return 3; }

    // A SWITCH THAT IS ON INVERTS THE PILL TO WHITE, so the reading has to
    // invert with it. Only switches -- a sensor is never "on" in this sense.
    _lit(st) {
      if (!st) return false;
      return String(st.entity_id || '').indexOf('switch.') === 0 &&
             ['off', 'unavailable', 'unknown'].indexOf(st.state) === -1;
    }

    // THE RANK PILLS INHERIT hk_pill's COLOUR RULE -- with the domain map --
    // not hk_metric's override-or-gray. They are tall tiles, not metrics.
    //
    // icon_color_steps is a threshold list in the CARD's config:
    //
    //   icon_color_steps:
    //     - {above: 60, color: green}
    //     - {above: 25, color: yellow}
    //     - {color: red}
    //
    // First match wins; an entry with no threshold is the fallback. A battery
    // level's colour, say, made declarative -- a config written by hand in
    // YAML needs no expression for it.
    //
    // THE CHIPS' WORDS, THE CHIPS' MEANINGS: `above` is STRICT
    // and `at_least` is inclusive, exactly as in hk-status-chip-card's `when`
    // (and Home Assistant's own numeric_state `above`), so `above: 0` means
    // "more than nothing" on a chip and on this card alike.
    _colour(st) {
      var cfg = this._config;
      var steps = cfg.icon_color_steps;
      if (Array.isArray(steps) && steps.length) {
        var v = Number(st && st.state);
        for (var i = 0; i < steps.length; i++) {
          var sp = steps[i];
          var hit = (sp.above == null && sp.at_least == null) ||
                    (Number.isFinite(v) &&
                     (sp.above == null || v > Number(sp.above)) &&
                     (sp.at_least == null || v >= Number(sp.at_least)));
          if (hit) return colourFor({ icon_color: sp.color }, st);
        }
      }
      return colourFor(cfg, st);
    }

    _watts(st) {
      var cfg = this._config;
      var pid = cfg.power || cfg.entity;
      if (!window.hkChart || !this.client) return null;
      return window.hkChart.power(this.client.states, pid, { watts: true, fallback: null });
    }

    _render() {
      var cfg = this._config, st = this._st(cfg.entity);
      var mode = cfg.mode || (cfg.power || cfg.stat ? 'rank' : 'hero');
      var lit = this._lit(st);

      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="rank" data-hk-role="card"><div class="grid">' +
          '<div class="well" data-hk-role="well"><hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon></div>\n' +
          '<div class="name" data-hk-role="name"></div>\n' +
          '<div class="label" data-hk-role="label"></div>\n' +
          '<div class="lvl" aria-hidden="true"><i></i></div>' +
          '<svg class="spark" viewBox="0 0 156 30" preserveAspectRatio="none" aria-hidden="true"></svg>' +
          // LAST in the DOM, after the name and the label. grid-area places
          // it top-left either way; DOM order only shows in the card's text
          // order.
          '<div class="hero" data-hk-role="hero"></div>\n' +
          '</div></hk-plate>';
        this._e = {
          card: this._root.querySelector('.rank'), hero: this._root.querySelector('.hero'),
          icon: this._root.querySelector('.icon'), name: this._root.querySelector('.name'),
          label: this._root.querySelector('.label'), well: this._root.querySelector('.well'),
          spark: this._root.querySelector('.spark'), lvl: this._root.querySelector('.lvl')
        };
        this._bind(this._e.card, 'tap_action', null);
        if (cfg.backed) {
          var bk = document.createElement('span');
          bk.className = 'sr';
          bk.textContent = 'Backed up by the house battery';
          this._e.card.appendChild(bk);
          this._e.card.classList.add('bkd');
        }
        // THE CIRCUIT'S POWER BUTTON (`control`, the Energy page's Switched
        // By): only on a tile that has something to switch, so a tile without
        // one never looks like it does. On is one tap; off cuts a room's
        // power, so it asks first.
        if (cfg.control) {
          var selfC = this, pb = document.createElement('button');
          pb.className = 'pwr';
          pb.setAttribute('role', 'switch');
          pb.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5v8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
            '<path d="M7.2 6.6a7.5 7.5 0 1 0 9.6 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
          this._e.card.appendChild(pb);
          this._e.pwr = pb;
          this._e.card.classList.add('haspwr');
          pb.addEventListener('click', function (ev) {
            ev.stopPropagation();
            var cs = selfC._st(selfC._config.control), on = cs && cs.state === 'on';
            var nm2 = selfC._config.name || selfC._config.control;
            if (!on) { selfC._call('homeassistant', 'turn_on', { entity_id: selfC._config.control }); return; }
            window.hkCards.confirmSheet('Turn off ' + nm2 + '?', function () {
              selfC._call('homeassistant', 'turn_off', { entity_id: selfC._config.control });
            }, { yes: selfC._config.control_yes || 'Turn Off', destructive: true, detail: selfC._config.control_detail || 'Everything on this circuit loses power.' });
          });
        }
        this._built = true;
      }

      var e = this._e;
      e.card.setAttribute('data-on', lit ? '1' : '0');
      var EP = cfg.energy ? energyPage(this) : null;
      e.card.classList.toggle('en', !!EP);
      // LIT = THE TILES' ON STATE: a coloured well with a WHITE glyph, the same
      // wellColour/iconColour rule every hk tile uses. Keeping the OFF well --
      // the 0.14 grey disc with the colour on the glyph -- on the white plate
      // would read as a grey circle with a coloured icon, unlike every other
      // lit tile. Unlit: grey well, coloured glyph, as an off tile is.
      var col = this._colour(st);
      e.well.style.background = lit ? col : '';
      e.icon.style.color = lit ? 'white' : col;
      // the power button: green while the circuit is on, gray while off
      var ctl = cfg.control ? this._st(cfg.control) : null, ctlOn = !!(ctl && ctl.state === 'on');
      if (e.pwr) {
        e.pwr.setAttribute('data-on', ctlOn ? '1' : '0');
        e.pwr.setAttribute('aria-checked', ctlOn ? 'true' : 'false');
        e.pwr.setAttribute('aria-label', 'Power, ' + (cfg.name || '') + (ctlOn ? ', on' : ', off'));
        e.card.classList.toggle('pwroff', !!ctl && !ctlOn);
      }
      var cl = this.client; if (cl) cl.bindStateIcon(e.icon, st);
      if (cfg.icon) e.icon.icon = cfg.icon;

      // ---- the reading
      var html = '--', idle = true;
      if (mode === 'rank') {
        var w = this._watts(st);
        // IDLE CIRCUITS RECEDE. A dozen cards all shouting "0 W" at full
        // contrast is a wall of noise; dimming them makes the two or three
        // actually drawing power the thing you see first.
        idle = (w === null || Math.abs(w) < 5);
        if (w !== null) {
          var kilo = Math.abs(w) >= 1000;
          var val = kilo ? (w / 1000).toFixed(2) : String(Math.round(w));
          html = val + '<span class="unit">' + (kilo ? 'kW' : 'W') + '</span>';
        }
      } else if (mode === 'energy') {
        // NO POWER SENSOR: today's kWh is the reading, and the label says so
        var td = this._today();
        idle = !(td > 0.05);
        if (td !== null) html = td.toFixed(1) + '<span class="unit">kWh</span>';
      } else if (mode === 'pct') {
        var v = Number(st && st.state);
        idle = false;
        html = Number.isFinite(v) ? (Math.round(v) + '<span class="unit pct">%</span>') : '--';
      } else {
        idle = false;
        html = cfg.value != null ? String(cfg.value) : (st ? st.state : '--');
      }
      window.hkCards.morph(e.hero, html);
      e.hero.style.color = lit
        ? (idle ? 'rgba(0, 0, 0, 0.30)' : 'rgba(0, 0, 0, 0.92)')
        : (idle ? '' + window.hkCards.v('ink-3') + '' : '' + window.hkCards.v('ink') + '');

      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (e.name.textContent !== nm) e.name.textContent = nm;

      // ---- the label: kWh so far today, fetched asynchronously
      var lb = cfg.label != null ? cfg.label : '', lbHtml = null;
      // label_entity + label_suffix: "the range sensor, rounded, with
      // ' mi range' after it".
      if (!cfg.label && cfg.label_entity) {
        var ls = this._st(cfg.label_entity);
        var lv = Number(ls && ls.state);
        // label_decimals: the range sensors read whole miles, the stored-energy
        // sensor reads "1.5 kWh". Default 0 keeps every existing config.
        var dp = Number(cfg.label_decimals || 0);
        lb = Number.isFinite(lv)
          ? ((dp > 0 ? lv.toFixed(dp) : String(Math.round(lv))) +
             (cfg.label_suffix || ''))
          : '';
      }
      if (mode === 'energy' && !cfg.label && !cfg.label_entity) {
        lb = this._today() !== null ? 'Today' : '';
      } else if (!cfg.label && !cfg.label_entity && cfg.stat && window.hkStats && this.client) {
        var t = this._today();
        lb = Number.isFinite(t) ? (t.toFixed(1) + ' kWh today') : '';
        // "today" its own span: a narrow backed-up tile sets it aside
        if (lb && cfg.backed) lbHtml = t.toFixed(1) + ' kWh<span class="td"> today</span>';
      }
      // on the Energy page's Today, This Week and This Month the label is the
      // tab's (_energy below), not today's kWh
      if (!(EP && cfg.energy !== 'now' && EP.getPeriod() !== 'now' && mode !== 'pct') && e.label.textContent !== lb) {
        if (lbHtml) e.label.innerHTML = lbHtml; else e.label.textContent = lb;
        e.label._h = null;
      }
      if (EP) this._energy(EP, mode, st);
    }

    // ON THE ENERGY PAGE'S TABS. Now: the reading above (live watts, kWh
    // today) with the last three hours as its line. Today, This Week, This
    // Month: the tab's kWh, two weeks as its line, and how that compares with
    // its usual -- energy from the meter, never integrated watts. A battery
    // shows its level as a bar on every tab. While another section is lit on
    // the page, the tile steps back.
    _energy(EP, mode, st) {
      // `energy: now` pins the tile to Now (the EcoFlow page: live watts,
      // whichever tab the Energy page was left on), and the page's lit
      // section does not dim it
      var cfg = this._config, e = this._e, pinned = cfg.energy === 'now', p = pinned ? 'now' : EP.getPeriod();
      var color = cfg.line_color || EP.sectionColor(cfg.section) || '#ff9f0a';
      e.card.style.opacity = !pinned && EP.pick && cfg.section && EP.pick !== cfg.section ? '0.28' : '';
      if (mode === 'pct') {
        var lv = Number(st && st.state);
        e.lvl.classList.add('on');
        var bar = e.lvl.firstChild;
        bar.style.width = (isFinite(lv) ? Math.max(0, Math.min(100, lv)) : 0) + '%';
        bar.style.background = isFinite(lv) && lv < 20 ? '#ff453a' : '#30d158';
        return;
      }
      e.lvl.classList.remove('on');
      var x = EP.tile(this.client, this, { stat: cfg.stat, power: cfg.power || (mode === 'rank' ? cfg.entity : null), period: p });
      var line = x && x.line;
      if (p !== 'now' && x && typeof x.v === 'number') {
        var idle = x.v < 0.05;
        window.hkCards.morph(e.hero, (x.v >= 100 ? Math.round(x.v).toLocaleString(window.hkLocale.numTag()) : x.v.toFixed(1)) + '<span class="unit">kWh</span>');
        e.hero.style.color = idle ? '' + window.hkCards.v('ink-3') + '' : '' + window.hkCards.v('ink') + '';
        if (e.label._h !== x.cmp) { e.label.innerHTML = x.cmp; e.label._h = x.cmp; }
      } else if (p !== 'now' && cfg.stat) {
        if (e.label._h !== '') { e.label.textContent = ''; e.label._h = ''; }
      } else if (p === 'now' && x && x.ran) {
        // Now: today's kWh and the hours it has run
        var td = this._today(), txt = (td != null ? td.toFixed(1) + ' kWh \u00b7 ' : '') + x.ran;
        if (e.label.textContent !== txt) e.label.textContent = txt;
        e.label._h = null;
      } else {
        e.label._h = null;
      }
      var flat = !line || !line.some(function (z) { return typeof z === 'number' && z > (p === 'now' ? 5 : 0.05); });
      var svg = flat
        ? '<path d="M0 28H156" stroke="' + window.hkCards.v('line-strong') + '" stroke-width="2" vector-effect="non-scaling-stroke"/>'
        : EP.lineSvg(line, 156, 30, color, { min: p === 'now' ? 20 : 0.05 });
      if (e.spark._h !== svg) { e.spark.innerHTML = svg; e.spark._h = svg; }
      if (this._sparkTab !== p && !flat) {
        this._sparkTab = p;
        EP.restartAnim(e.spark, 'wipe');      // batched with the page's cards: one layout
      }
    }

    // TODAY'S kWh from the meter's statistics (with its section's peers, in
    // one request); null until they arrive
    _today() {
      var cfg = this._config, id = cfg.stat || cfg.entity;
      // ON THE ENERGY PAGE, from the page's own statistics (one request for
      // every tile), not a fortnight of its section's of its own
      var EP = cfg.energy && window.hkEnergyPage;
      if (EP && EP.todayOf && cfg.stat) return EP.todayOf(this.client, this, cfg.stat);
      if (!window.hkStats || !this.client || !id) return null;
      var all = window.hkStats.daily(this.client, cfg.peers || [id], 14, this);
      var a = all && all[id], t = (a && a.length) ? a[a.length - 1].v : null;
      return Number.isFinite(t) ? t : null;
    }

    // The reading changes when the POWER entity moves, which may not be the
    // card's own entity -- so the default signature would gate out exactly the
    // updates this card exists to show.
    _sigOf() {
      var h = this.client, c = this._config;
      if (!h || !c) return null;
      var ids = [c.entity, c.power, c.label_entity, c.control].filter(Boolean);
      var out = c.energy ? energySig(c.energy === 'now' ? 'now' : null) + ';' : '';
      for (var i = 0; i < ids.length; i++) {
        var s = h.states[ids[i]];
        out += ids[i] + '=' + (s ? s.last_updated : 'x') + ';';
      }
      return out;
    }
  }

  // register / firstOf are hk-base.js's.
  var C2 = window.hkCards, register = C2.register, firstOf = C2.firstOf;

  register('hk-heading-card', HkHeadingCard, 'HK Section Heading',
           'A section title, optionally linking to another page.',
           [
             { name: 'name', required: true, selector: { text: {} } },
             // A room heading: opens this dashboard's room page for the area
             // (a view with `area:`), with a › -- see docs/Menu.md.
             { name: 'area', selector: { area: {} },
               helper: 'A room heading: links to this area\'s room page when the dashboard has one.' },
             // "./cameras" is relative to the CURRENT dashboard, which is how
             // one shared heading navigates correctly on every dashboard.
             { type: 'grid', name: '', schema: [
               { name: 'navigation_path', selector: { text: {} } },
               { name: 'chevron', selector: { text: {} } }
             ] },
             C2.section('Layout', [
               { type: 'grid', name: '', schema: [
                 { name: 'height', selector: { text: {} } },
                 { name: 'padding', selector: { text: {} } },
                 { name: 'grid_rows', selector: { text: {} } }
               ] }
             ], 'mdi:ruler')
           ],
           function () { return { name: 'Living Room' }; });

  register('hk-stat-card', HkMetricCard, 'HK Metric',
           'An icon, a caption and a large reading with no background, such as temperature or power.',
           [
             { name: 'entity', required: true, selector: { entity: {} } },
             { type: 'grid', name: '', schema: [
               { name: 'name', selector: { text: {} } },
               { name: 'value_mode', selector: C2.selOptions(
                   ['temperature', 'power', 'runtime', 'cost', 'cost_today', 'flow']) }
             ] },
             C2.section('Appearance', [
               { type: 'grid', name: '', schema: [
                 { name: 'icon', selector: { icon: {} } },
                 { name: 'icon_color', selector: C2.selColour() }
               ] }
             ], 'mdi:palette'),
             C2.section('Value options', [
               { name: 'value', selector: { text: {} } },
               { type: 'grid', name: '', schema: [
                 { name: 'value_attribute', selector: { text: {} } },
                 { name: 'value_suffix', selector: { text: {} },
                   helper: 'Temperature format: default is the sensor\'s own unit, else this home\'s.' },
                 { name: 'idle_text', selector: { text: {} } },
                 { name: 'value_peer', selector: { entity: { filter: { domain: 'sensor' } } } },
                 { name: 'charge', selector: { entity: { filter: { domain: 'sensor' } } } },
                 { name: 'discharge', selector: { entity: { filter: { domain: 'sensor' } } } },
                 { name: 'stat', selector: { entity: { filter: { domain: 'sensor' } } } },
                 { name: 'cost_stat', selector: { entity: { filter: { domain: 'sensor' } } } },
                 { name: 'power', selector: { entity: { filter: { domain: 'sensor' } } },
                   helper: 'Power format: the live reading. Defaults to the entity.' },
                 // a fixed number stays YAML (price: 0.15): a text field
                 // would hand the card a string, read as an entity id
                 { name: 'price', label: 'Price Per kWh',
                   helper: 'Cost today format, with no cost statistic: today\'s kWh times this.',
                   selector: { entity: { filter: [{ domain: 'sensor' }, { domain: 'input_number' }] } } }
               ] }
             ], 'mdi:tune'),
             C2.section('Interactions', [
               { name: 'tap_action', selector: { ui_action: {} } }
             ], 'mdi:gesture-tap')
           ],
           function (client) { return { entity: firstOf(client, 'sensor') }; });

  register('hk-rank-card', HkRankCard, 'HK Reading Tile',
           'A tile with a large reading: a value, a percentage, or a device\'s power use ranked against others.',
           [
             { name: 'entity', required: true, selector: { entity: {} } },
             { type: 'grid', name: '', schema: [
               { name: 'name', selector: { text: {} } },
               { name: 'mode', selector: C2.selOptions(['hero', 'pct', 'rank', 'energy']),
                 helper: 'Value: the state. Percent: a 0–100 reading. Power use: live watts, with today\'s energy below. Energy: today\'s kWh, for a meter with no power sensor.' }
             ] },
             C2.section('Power use', [
               { name: 'power', selector: { entity: { filter: { domain: 'sensor' } } } },
               { name: 'stat', selector: { entity: { filter: { domain: 'sensor' } } } },
               { name: 'peers', selector: { entity: { multiple: true, filter: { domain: 'sensor' } } } },
               { name: 'energy', label: 'Follow the Energy tabs', selector: { boolean: {} },
                 helper: 'With HK\'s Energy cards on the page: Now shows its watts and last three hours; Today, This Week and This Month its kWh against its usual.' },
               { type: 'grid', name: '', schema: [
                 { name: 'section', selector: { text: {} }, helper: 'Its Energy section, for Where it went\'s lit section.' },
                 { name: 'line_color', selector: { text: {} }, helper: 'Its line\'s color, e.g. #5ac8fa.' }
               ] },
               { name: 'control', label: 'Switched By', selector: { entity: { filter: [{ domain: 'switch' }, { domain: 'input_boolean' }] } },
                 helper: 'Gives the tile a power button: on with one tap, off after asking.' }
             ], 'mdi:flash'),
             C2.section('Appearance', [
               { type: 'grid', name: '', schema: [
                 { name: 'icon', selector: { icon: {} } },
                 { name: 'icon_color', selector: C2.selColour() }
               ] },
               // Colour thresholds, e.g. for a battery level:
               // [{above: 60, color: green}, ...], first match
               // wins, an entry with no `above` is the fallback.
               { name: 'icon_color_steps', selector: { object: {} } }
             ], 'mdi:palette'),
             C2.section('Status text', [
               { type: 'grid', name: '', schema: [
                 { name: 'label_entity', selector: { entity: {} } },
                 { name: 'label_suffix', selector: { text: {} } },
                 { name: 'label_decimals', selector: { number: { min: 0, max: 3, mode: 'box' } } }
               ] }
             ], 'mdi:format-text'),
             C2.section('Interactions', [
               { name: 'tap_action', selector: { ui_action: {} } }
             ], 'mdi:gesture-tap')
           ],
           function (client) { return { entity: firstOf(client, 'sensor'), mode: 'hero' }; });

  window.hkStat.HkHeadingCard = HkHeadingCard;
  window.hkStat.HkMetricCard = HkMetricCard;
  window.hkStat.HkRankCard = HkRankCard;
  });
})();
