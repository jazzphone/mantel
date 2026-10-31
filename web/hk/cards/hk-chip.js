// hk-chip.js -- the chip and icon families as native Lovelace cards.
//
// Loads after hk-base.js (it extends window.hkCards.HkBase) and alongside
// hk-tile.js.
//
// WHAT SEPARATES A CHIP FROM A TILE
// Geometry, measured, not what the card does:
//
//   tile  196px wide (hk-base.js TILE.w), 23.5px radius, a 42px icon slot
//   chip  40-43px tall, radius = HALF the height (fully rounded), width from
//         its content or from its grid cell, and NO icon well
//
// Two chips, and they are NOT variants of each other:
//
//   status chip     43px (hk-base.js CHIP.h; the Home app's 42.9), radius
//                   half, fit-content, an 18px glyph plus two text
//                   rows, and THE ONLY CARD that blurs itself (Clear look only)
//   toggle          40px, radius 20, text only, centred, on/off selection
//   segment         40px, radius 20, identical to the toggle EXCEPT that
//                   selection compares the entity's state to a configured
//                   option rather than to 'on'
//
// FIDELITY
// Every number here is measured. Do not tune any of them by eye.
(function () {
  'use strict';

  if (window.hkChip) return;
  window.hkChip = { version: '1.0.0' };

  // Same reasoning as hk-tile.js: hk-base.js is a parallel-loaded Lovelace
  // resource, so wait for its readiness EVENT. Never poll -- rAF does not fire
  // in a hidden tab and setTimeout is throttled there, so a poll silently
  // defines no cards at all in a backgrounded tab.
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.HkBase) return fn(window.hkCards.HkBase);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.HkBase) fn(window.hkCards.HkBase);
      else console.error('[hk-chip] hk-cards-ready fired without HkBase');
    }, { once: true });
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
  // `icon_color_states` is to colour what `icon_states` already is to the
  // glyph: a declarative map keyed on the entity's state, with `default` as
  // the fallback. A colour that follows the state -- yellow while on, gray
  // otherwise -- is config, not code:
  //   icon_color_states: {on: yellow, default: gray}
  // and resolves through the same NAME_MAP as a static icon_color, so the
  // palette stays in one place.
  function colourFor(cfg, st, value) {
    var map = cfg.icon_color_states;
    if (map) {
      var chosen = pick(map, value !== undefined ? value : (st ? st.state : null));
      if (chosen != null) cfg = Object.assign({}, cfg, { icon_color: chosen });
    }
    var f = tile().colourFor;
    return f ? f(cfg, st) : (cfg.icon_color || 'rgba(200, 200, 200, 0.80)');
  }
  if (window.hkCards) window.hkCards.colourForChip = colourFor;

  // THE LOAD RACE, SECOND HALF. Resolving hk-tile's exports at call time
  // (above) is not enough on its own: a chip that renders BEFORE hk-tile.js
  // has run gets the fallback colours and ON_STATES, and the re-render gate
  // then keeps that first frame until a watched entity changes. Folding
  // "is hk-tile loaded" into every chip signature makes the next state push after
  // it loads redraw the chip with the real palette.
  function tileToken() { return tile().colourFor ? 'T;' : 't;'; }

  var ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
  function entityIds(cfg) {
    var out = [], seen = {};
    (function walk(v) {
      if (v == null) return;
      if (typeof v === 'string') {
        if (ENTITY_ID.test(v) && !seen[v]) { seen[v] = true; out.push(v); }
      } else if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) walk(v[i]);
      } else if (typeof v === 'object') {
        Object.keys(v).forEach(function (k) { if (!/_action$/.test(k)) walk(v[k]); });
      }
    })(cfg);
    return out;
  }
  function onStates() { return tile().ON_STATES || ['on']; }

  var CSS = [
    ':host{display:block}',

    // ---- shared chip material ------------------------------------------
    // The lit top rim again -- the glass material is that line, not the
    // gradient. Chips add nothing to that rule; they only differ in size.
    'hk-plate.chip{box-sizing:border-box;margin:0px;',
    '  border:' + window.hkCards.M.border + ';',
    '  display:flex;align-items:center;justify-content:center;',
    '  overflow:hidden;text-align:center;font-size:1.2em;cursor:pointer;',
    '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0;',
    '  transition:background-color .25s ease,transform .12s ease}',
    'hk-plate.chip:active{transform:scale(0.97);filter:brightness(0.93)}',
    // tap_action: none -- a chip that only REPORTS (Mail). It must not press
    // in or show a hand, or it promises an action that never comes.
    'hk-plate.chip.inert{cursor:default}',
    'hk-plate.chip.inert:active{transform:none;filter:none}',
    '.grid{display:grid;width:100%}',

    // ---- status chip -----------------------------------------------------
    // THE ONLY backdrop-filter on a CARD in this frontend (sheets aside: a
    // pop-up's `blur`, the detail and confirm sheets), and deliberately so:
    // it costs a compositing layer per card and hk-sky animates behind it, so
    // the blur cannot be cached between frames. It measures free on a row of
    // chips and NOT affordable across ~1,000 pills, however good it looks
    // there. Do not copy this block onto any other card.
    //
    // THE LOOK TURNS IT OFF: with look.glass = frosted or blur,
    // hk-settings.js sets --hk-chip-backdrop: none -- frosted draws the
    // material instead, and blur puts the chip on hk-glass.js's shared layer
    // (the marker below), which is cheaper than the chip blurring itself.
    //
    // brightness(0.82) is not optional either: blur alone measured LIGHTER
    // than bright cloud, because the plate is purely additive white.
    'hk-plate.chip.status{height:' + window.hkCards.CHIP.h + 'px;width:fit-content;min-width:0px;max-width:none;',
    '  border-radius:' + window.hkCards.CHIP.h / 2 + 'px;padding:5px 22px 5px 7.7px;margin:5px 0px 11px 0px;',
    '  background:var(--hk-chip-plate,linear-gradient(145deg,rgba(255,255,255,0.16),rgba(255,255,255,0.07)));',
    '  backdrop-filter:var(--hk-chip-backdrop,blur(20px) saturate(1.4) brightness(0.82));',
    '  -webkit-backdrop-filter:var(--hk-chip-backdrop,blur(20px) saturate(1.4) brightness(0.82));',
    '  --hk-glass-surface:1;',
    // Three shadows, and the INSETS are what survive: this row lives in a
    // scroller (hk-row-card) that clips on every edge,
    // so an outer shadow is clipped. The margin above is what makes even the
    // 3px outer stop possible -- remove it and the clipped remnant comes back.
    '  box-shadow:var(--hk-look-shadow, inset 0 1px 0 rgba(255,255,255,0.20),',
    '             inset 0 -1px 0 rgba(0,0,0,0.14),',
    '             0 3px 8px rgba(0,0,0,0.22))}',
    // ON A LIGHT PAGE (hk-base.js tone): the house glass, as every other
    // plate there -- not this white plate and a blur that darkens the page
    // behind it (the tone sets --hk-glass-plate and --hk-glass-shadow-chip).
    ':host([data-hk-light]) hk-plate.chip.status{background:var(--hk-glass-plate);',
    '  backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:var(--hk-glass-shadow-chip)}',
    '.status .grid{grid-template-areas:"i n" "i l";grid-template-columns:22px max-content;',
    '  grid-template-rows:min-content min-content;row-gap:1.5px;column-gap:5px;align-content:center}',
    // NO fixed height. `grid-area:i` spans both text rows, so the cell
    // resolves to ~30px tall and the glyph centres against that, not
    // against 22px. Pinning the height puts the icon 4px high.
    '.status .well{grid-area:i;display:flex;align-items:center;justify-content:center;',
    '  width:22px;overflow:hidden}',
    // THE GLYPH WOULD SIT 4px LOW, and not because of the container:
    // hk-state-icon measures 18px and centres correctly, but the icon
    // INSIDE it inherits line-height 26.88px (the chip's font-size:1.2em) and
    // renders as a 20px inline box, baseline-shifted down (measured: glyph
    // centre 252 against a card centre of 248).
    // line-height:0 kills the baseline, flex re-centres what is left.
    '.status .icon{width:18px;height:18px;--mdc-icon-size:100%;',
    '  display:flex;align-items:center;justify-content:center;line-height:0}',
    '.status .name{grid-area:n;justify-self:start;align-self:center;',
    '  font-size:13.3px;font-weight:600;line-height:1.1;letter-spacing:-0.1px;',
    '  color:' + window.hkCards.v('ink') + ';white-space:nowrap;',
    '  overflow:hidden;text-overflow:ellipsis}',
    '.status .label{grid-area:l;justify-self:start;align-self:start;',
    '  font-size:12.6px;font-weight:400;line-height:1.1;letter-spacing:-0.04px;',
    '  color:' + window.hkCards.v('ink-2') + ';white-space:nowrap;',
    '  overflow:hidden;text-overflow:ellipsis}',

    // ---- toggle / segment ------------------------------------------------
    // Text-only, centred, 40px. The two are the same object; only the
    // selection TEST differs, which is why they share every rule here.
    'hk-plate.chip.toggle{height:40px;border-radius:20px;padding:0px 14px;',
    '  ' + window.hkCards.M.glass + ';',
    '  box-shadow:var(--hk-look-shadow, ' + window.hkCards.v('glass-shadow-chip') + ')}',
    'hk-plate.chip.toggle[data-on="1"]{background:rgba(255,255,255,0.96);--hk-glass-backdrop:none}',
    '.toggle .grid{grid-template-areas:"n";grid-template-columns:minmax(0,1fr);align-content:center}',
    '.toggle .name{grid-area:n;justify-self:center;',
    '  font-size:13.5px;font-weight:600;letter-spacing:-0.1px;',
    '  color:' + window.hkCards.v('ink') + ';',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    'hk-plate.chip.toggle[data-on="1"] .name{color:rgba(0,0,0,0.88)}',


    '@keyframes hk-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
    'hk-plate[data-on="1"] .icon.spin{animation:hk-spin 1.35s linear infinite}',
    // Animations off (Sky / Background): upright, as on the tile (hk-tile.js)
    ':host([hk-still]) hk-plate .icon.spin{animation:none}',
    '@media (prefers-reduced-motion:reduce){',
    '  hk-plate,hk-plate:active,.icon{transition:none;transform:none;animation:none}}'
  ].join('');

  // ---------------------------------------------------------------- chips
  class HkChipBase extends HkBase {
    static get CSS() { return CSS; }
    // Toggles and segments use HkBase's entity signature; they read ON_STATES
    // and the palette too, so they carry the same hk-tile token.
    _sigOf() {
      var sig = super._sigOf();
      return sig === null ? null : tileToken() + sig;
    }
    getCardSize() { return 1; }
    setConfig(config) {
      // A SUMMARY CHIP HAS NO SINGLE ENTITY. Lights, Timers, Vacuums and
      // Speakers each stand for a whole set -- they derive their value from
      // `count` (many entities) or `source` (one sensor that is not the chip's
      // subject), and naming one of them as `entity` would be arbitrary and
      // would drive the icon and on-state off the wrong thing.
      //
      // Requiring `entity` unconditionally would make all four throw at
      // setConfig, and Home Assistant would render error cards in their
      // place -- easy to miss, since the row still looks populated while the
      // other chips are fine.
      // ...and `parts` / `label_rules` name their sources INSIDE themselves.
      // Climate is built entirely from parts (temperature, plus a fan count
      // only when a fan is on) and has no top-level source at all.
      var ok = config && (config.kind || config.entity || config.source ||
                          (config.count && (config.count.entities || config.count.music)) ||
                          Array.isArray(config.parts) ||
                          Array.isArray(config.label_rules));
      if (!ok) {
        throw new Error('hk-chip: one of `kind`, `entity`, `source`, `count`, ' +
                        '`parts` or `label_rules` is required');
      }
      // `kind:` is expanded at render time (_kindCfg), against the settings
      // and the dashboard as they are then; the config as written is kept.
      this._raw = config;
      this._kindKey = null;
      super.setConfig(config);
    }
    _isOn(st) { return !!st && onStates().indexOf(st.state) !== -1; }
    // A chip's tap is NOT always more-info: a segment selects an option.
    // Same state->icon map as the tiles: `icon` is the default, icon_states
    // names the exceptions.
    _icon(st) {
      var m = this._config.icon_states;
      if (m && st && m[st.state] != null) return m[st.state];
      return this._config.icon;
    }
    // Per-glyph boxes (ICON_PX) are a size on the icon, not on the card.
    _sizeIcon(el) {
      var px = this._config.icon_size;
      if (px) { el.style.width = px; el.style.height = px; }
    }
  }

  // THE LABEL VOCABULARY.
  //
  // A chip's label is a small computation over states, and those
  // computations are not arbitrary -- they are five shapes repeated:
  //
  //   count entities in a state   Security (unlocked locks), Vacuums, Speakers
  //   read a sensor and format    Lights "3 On", Timers, Energy "2.6 kW"
  //   map a state to two words    Storm "Armed"/"Off", EPS "Enabled"/"Off"
  //   title-case a state          Source "Grid Power"
  //   compose several sources     Climate, House Battery, Packs
  //
  // So the answer is neither JS in YAML nor a template sensor per chip
  // (entities in the state machine whose only job is a display string). It
  // is a small declarative vocabulary here, in code that can be unit tested.
  //
  // Resolution order is deliberate: an explicit `label` wins, and a chip
  // with none of these keys falls back to the entity's state.
  // THE CHIP'S VALUE, resolved once and reused by the label, the icon and the
  // colour. A chip needs THREE values, not one, and all three
  // key off the same number:
  //   label:      n === 0 ? 'Idle' : n + ' Cleaning'
  //   icon:       n > 0 ? 'hk:alert-circle' : 'hk:robot-vacuum'
  //   icon_color: n > 0 ? 'blue' : 'gray'
  // So the maps accept `zero` / `nonzero` alongside literal states, and all
  // three stay in agreement by construction instead of by three copies of the
  // same condition.
  // A DOTTED PATH INTO ATTRIBUTES:
  // the weather alert's title is attributes.Alerts[0].Event. `Alerts.0.Event`
  // reads exactly that, numeric segments indexing arrays. A LIST of paths takes
  // the first that yields something, because that alert exposes Event on some
  // records and only Headline on others.
  function attrPath(obj, path) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length && cur != null; i++) cur = cur[parts[i]];
    return cur;
  }
  function readAttr(st, spec) {
    if (!st || !st.attributes) return null;
    var paths = Array.isArray(spec) ? spec : [spec];
    for (var i = 0; i < paths.length; i++) {
      var v = attrPath(st.attributes, paths[i]);
      if (v != null && v !== '') return v;
    }
    return null;
  }

  function valueOf(card, cfg, st) {
    // `count: {music: true}` -- the house's rooms from the integration
    // (hkMusic), each PHYSICAL speaker once: a sync group's members already
    // report `playing` with it, so counting the group too would read one extra.
    if (cfg.count && cfg.count.music) {
      var mw = cfg.count.match == null ? ['playing'] : [].concat(cfg.count.match);
      var rooms = window.hkMusic ? window.hkMusic.rooms() : [];
      var mn = 0;
      for (var r = 0; r < rooms.length; r++) {
        var rs = card._st(rooms[r].entity);
        if (rs && mw.indexOf(rs.state) >= 0 && !window.hkMusic.ignored(rs)) mn++;
      }
      return mn;
    }
    if (cfg.count && Array.isArray(cfg.count.entities)) {
      var want = cfg.count.match;
      want = (want == null) ? ['on'] : (Array.isArray(want) ? want : [want]);
      var n = 0;
      for (var i = 0; i < cfg.count.entities.length; i++) {
        var c = card._st(cfg.count.entities[i]);
        if (c && want.indexOf(c.state) >= 0) n++;
      }
      return n;
    }
    // SEVERAL SOURCES REDUCED TO ONE NUMBER. A battery chip may read two
    // packs: the hottest of their two temperatures decides the colour, and
    // how far apart their two charge levels are decides whether the label
    // shows one figure or both. Both are a reduction over a list, which is a
    // named operation rather than an expression -- `spread` in particular
    // (max - min) is what would otherwise need JavaScript.
    if (Array.isArray(cfg.source)) {
      var nums = [];
      for (var si = 0; si < cfg.source.length; si++) {
        var so = card._st(cfg.source[si]);
        var sv = so && (cfg.attribute != null ? readAttr(so, cfg.attribute) : so.state);
        var sn = Number(sv);
        if (sv != null && sv !== '' && isFinite(sn)) nums.push(sn);
      }
      if (!nums.length) return null;
      var red = cfg.reduce || 'max';
      if (red === 'min') return Math.min.apply(null, nums);
      if (red === 'sum') {
        var tot = 0;
        for (var ai = 0; ai < nums.length; ai++) tot += nums[ai];
        return tot;
      }
      if (red === 'spread') {
        return Math.max.apply(null, nums) - Math.min.apply(null, nums);
      }
      return Math.max.apply(null, nums);
    }
    var src = cfg.source ? card._st(cfg.source) : st;
    if (cfg.attribute != null) {
      var v = readAttr(src, cfg.attribute);
      // `length` turns a list into its size -- "+2 more alerts" is
      // Alerts.length, and `offset: -1` makes it "the rest".
      if (cfg.length && v != null && v.length != null) v = v.length;
      if (typeof v === 'number' && cfg.offset != null) v = v + Number(cfg.offset);
      return v;
    }
    return src ? src.state : null;
  }

  // Resolve a state-keyed map against that value: an exact state key first,
  // then zero/nonzero for numbers, then `default`.
  function pick(map, v) {
    if (!map) return null;
    if (v != null && Object.prototype.hasOwnProperty.call(map, String(v))) {
      return map[String(v)];
    }
    var n = Number(v);
    if (v !== null && v !== '' && isFinite(n)) {
      var k = n === 0 ? 'zero' : 'nonzero';
      if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
    }
    return Object.prototype.hasOwnProperty.call(map, 'default') ? map['default'] : null;
  }

  // A `when` PREDICATE, and deliberately only three forms. The chips the flat
  // vocabulary cannot express do not need expressions -- they need a
  // condition and a way to join pieces. Anything more than state/above/below
  // is an expression language by another name, and the whole point of this
  // file is that the logic is testable rather than embedded in YAML strings.
  function passes(card, cfg, st, when) {
    if (!when) return true;                       // no condition = always

    // ANY OF THESE ENTITIES, optionally on an ATTRIBUTE rather than the state.
    // Climate's icon is "is either thermostat currently cooling?", which is
    // hvac_action on two entities -- not a state, and not one entity.
    if (Array.isArray(when.any_of)) {
      var want = Array.isArray(when.state) ? when.state
               : (when.state != null ? [when.state] : []);
      for (var i = 0; i < when.any_of.length; i++) {
        var o = card._st(when.any_of[i]);
        if (!o) continue;
        var val = when.attribute ? (o.attributes || {})[when.attribute] : o.state;
        if (want.indexOf(val) >= 0) return true;
      }
      return false;
    }

    var v;
    // A `when` MAY NAME ITS OWN SOURCE. Without this the predicate would
    // silently read the SPEC's value instead -- a battery chip's
    // `{source: [a, b], reduce: spread, at_least: 3}` would measure pack A's
    // charge (86) rather than the gap between the packs (0), match always,
    // and show both figures even when the packs agree.
    if (when.source || when.count) {
      v = valueOf(card, when, st);
    } else if (when.entity || when.attribute) {
      var e = (when.entity ? card._st(when.entity) : (cfg.source ? card._st(cfg.source) : st)) || {};
      v = when.attribute ? readAttr(e, when.attribute) : e.state;
      if (when.length && v != null && v.length != null) v = v.length;
    } else {
      v = valueOf(card, cfg, st);
    }
    // NOT ONE OF THESE: an extra chip is "active" while its entity is
    // anything but off / idle / closed / unavailable.
    if (when.state_not != null) {
      return [].concat(when.state_not).indexOf(v == null ? '' : v) < 0;
    }
    if (when.state != null && when.ignore_case) {
      var w = (Array.isArray(when.state) ? when.state : [when.state])
                .map(function (x) { return String(x).toLowerCase(); });
      return w.indexOf(String(v).toLowerCase()) >= 0;
    }
    if (when.state != null) {
      var want = Array.isArray(when.state) ? when.state : [when.state];
      return want.indexOf(v) >= 0;
    }
    var n = Number(v);
    if (!isFinite(n)) return false;               // a number test on non-number
    if (when.above != null && !(n > Number(when.above))) return false;
    if (when.below != null && !(n < Number(when.below))) return false;
    // INCLUSIVE, and they exist because real thresholds are often
    // inclusive: battery packs diverge "by 3 or more" and run hot "at 122
    // or above". Spelling those as above: 2.999 would be a lie in the config
    // and a trap for whoever tunes it next.
    if (when.at_least != null && !(n >= Number(when.at_least))) return false;
    if (when.at_most != null && !(n <= Number(when.at_most))) return false;
    return when.above != null || when.below != null ||
           when.at_least != null || when.at_most != null;
  }

  // ORDER MATTERS HERE, three ways at once:
  //
  //   * strip the BASE's composition keys FIRST, then apply the spec -- doing
  //     it after also deletes a rule's own `label`;
  //   * a spec that names its own `source` or `count` must DROP the base's,
  //     or the base wins and Security's "triggered" rule returns the lock
  //     count instead of the alarm state;
  //   * `when` must then be tested against THIS merged config, not the base,
  //     or Climate's "fans on" condition tests the temperature.
  // First rule whose `when` passes yields its value. The label has its own
  // path because a rule there carries a whole label spec; icon and colour each
  // carry a single value, so they share this.
  function ruleValue(card, cfg, st, rules, key) {
    if (!Array.isArray(rules)) return null;
    for (var i = 0; i < rules.length; i++) {
      if (!passes(card, cfg, st, rules[i].when)) continue;
      return rules[i][key] != null ? rules[i][key] : null;
    }
    return null;
  }

  function specCfg(base, spec) {
    var cfg = Object.assign({}, base);
    delete cfg.label; delete cfg.parts; delete cfg.label_rules; delete cfg.when;
    // `reduce` travels WITH `source` -- it describes how to combine that
    // list, so inheriting it onto a spec that names its own source would
    // apply the parent's reduction to a different set of entities.
    if (spec.source || spec.count) {
      delete cfg.source; delete cfg.count; delete cfg.reduce;
    }
    return Object.assign(cfg, spec);
  }

  function labelFor(card, cfg, st) {
    if (cfg.label != null) return cfg.label;                    // explicit wins

    // FIRST MATCHING RULE WINS -- a priority branch, which is what Security is:
    //   triggered            -> the alarm state, title-cased
    //   any lock unlocked    -> "2 Unlocked"
    //   otherwise            -> the alarm state, title-cased
    if (Array.isArray(cfg.label_rules)) {
      for (var r = 0; r < cfg.label_rules.length; r++) {
        var rule = cfg.label_rules[r];
        var rcfg = specCfg(cfg, rule);
        if (!passes(card, rcfg, st, rule.when)) continue;
        return labelFor(card, rcfg, st);
      }
      return cfg.fallback != null ? cfg.fallback : '--';
    }

    // SEGMENTS JOINED -- Climate is "79" plus " | 2 Fans" only when a fan is on,
    // House Battery is three readings with a separator. A segment whose `when`
    // fails, or which has no value, is simply absent.
    if (Array.isArray(cfg.parts)) {
      var out = [];
      for (var i = 0; i < cfg.parts.length; i++) {
        var part = cfg.parts[i];
        var pcfg = specCfg(cfg, part);
        if (!passes(card, pcfg, st, part.when)) continue;
        var txt = labelFor(card, pcfg, st);
        if (txt !== '' && txt != null && txt !== (part.fallback != null ? part.fallback : '--')) {
          out.push(txt);
        }
      }
      if (!out.length) return cfg.fallback != null ? cfg.fallback : '--';
      return out.join(cfg.join != null ? cfg.join : ' \u00b7 ');
    }

    var raw = valueOf(card, cfg, st);
    if (typeof raw === 'number') return fmt(cfg, raw);      // a count
    if (raw == null || raw === 'unknown' || raw === 'unavailable') {
      return cfg.fallback != null ? cfg.fallback : '--';
    }
    if (cfg.label_map && Object.prototype.hasOwnProperty.call(cfg.label_map, raw)) {
      return String(cfg.label_map[raw]);
    }
    if (cfg.label_case === 'title') {
      return String(raw).replace(/[-_]/g, ' ').split(' ').filter(Boolean)
        .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
        .join(' ');
    }
    var num = Number(raw);
    // `scale` -- a unit change: the Energy chip shows kW from a W sensor.
    if (cfg.scale != null && raw !== '' && isFinite(num)) num = num * Number(cfg.scale);
    var out = fmt(cfg, isFinite(num) && raw !== '' ? num : raw);
    // `unit: true` (an entity as a chip): a reading keeps its unit -- "86%",
    // "21 kWh" -- which a kind's own `format` spells out for itself
    var u = cfg.unit && cfg.format == null && isFinite(num) && raw !== '' &&
            st && st.attributes && st.attributes.unit_of_measurement;
    if (u) out += (u === '%' || u.charAt(0) === '\u00b0' ? '' : ' ') + u;
    return out;
  }

  // `format` is a plain substitution, NOT an expression: "{v} On", "{v} kW".
  // Keeping it substitution-only is the line between a configurable card and a
  // little language nobody can test.
  function fmt(cfg, v) {
    if (typeof v === 'number' && cfg.decimals != null) v = v.toFixed(cfg.decimals);
    if (cfg.zero != null && Number(v) === 0) return String(cfg.zero);
    // `one` is the singular, and it is not a nicety: the chips say "1 Leak"
    // and "2 Leaks", "1 Door" and "2 Doors". Without it the only options are
    // a wrong plural or another JS block.
    if (cfg.one != null && Number(v) === 1) return String(cfg.one);
    var f = cfg.format;
    return f == null ? String(v) : String(f).replace(/\{v\}/g, String(v));
  }

  // Exposed so the label vocabulary can be unit tested without a DOM: it is a
  // pure function of (config, states) and that is the whole reason it is a
  // function rather than inline in _render.
  if (window.hkCards) {
    window.hkCards.labelFor = labelFor;
    window.hkCards.pickChip = pick;
    window.hkCards.ruleValue = ruleValue;
    window.hkCards.chipValue = valueOf;
    window.hkCards.chipPasses = passes;
  }

  // ============================================================ CHIP KINDS
  //
  // `kind: lights` -- a chip that names WHAT it stands for instead of listing
  // it. Its entities are HK Settings -> Status & Chips, resolved by
  // the integration (kinds.py) and handed over as `kinds`, so the chip, its
  // page and the header's security line count the same things, and a light
  // added to the house is counted without anyone editing a list. A chip
  // that lists its own entities, or reads a template sensor made for it,
  // works in one house only.
  //
  // Each kind is a complete chip -- labels, glyphs, colours and taps.
  // Anything the chip's own config also sets
  // (name, icon, tap_action ...) still wins.
  //
  // `quiet: true` -- shown only when there is something to report: Doors &
  // Windows only while one is open, Water only while a sensor is wet. Which
  // chips a dashboard shows, in what order, and which are quiet, is that
  // dashboard's (its item's Home page; hk-chips-card below) -- all but
  // Smoke & CO, which no screen chooses: it leads every row (rowPlan), quiet.
  var KIND_ORDER = ['weather_alert', 'security', 'doors_windows', 'climate', 'lights', 'blinds',
                    'timers', 'vacuums', 'speakers', 'water', 'energy'];
  var KIND_NAMES = { smoke: 'Smoke & CO', weather_alert: 'Weather Alerts', security: 'Security', doors_windows: 'Doors & Windows',
                     climate: 'Climate', lights: 'Lights', blinds: 'Blinds', timers: 'Timers',
                     vacuums: 'Vacuums', speakers: 'Speakers', water: 'Water', energy: 'Energy' };
  // Quiet unless a dashboard says otherwise: news, not a permanent slot.
  var QUIET_DEFAULT = ['weather_alert', 'doors_windows', 'blinds', 'water'];
  // The page each opens: the first of these the dashboard has. None of them:
  // the chip reports and opens nothing.
  var KIND_PAGES = { weather_alert: ['weather'], security: ['security', 'alarm'],
                     doors_windows: ['doors-windows', 'doors', 'security'], climate: ['climate'], lights: ['lights'],
                     blinds: ['blinds', 'shades', 'climate'], timers: ['timers'], vacuums: ['vacuums'],
                     speakers: ['playmusic', 'speakers'], water: ['water', 'leaks'], energy: ['energy'] };
  var ARMED = ['armed_away', 'armed_home', 'armed_night', 'armed_vacation', 'armed_custom_bypass'];
  var OPEN = ['on', 'open', 'opening', 'closing'];

  function S(path, fallback) { return C0().setting ? C0().setting(path, fallback) : fallback; }
  function C0() { return window.hkCards || {}; }

  // FOUND BY THE INTEGRATION, or -- before it has answered on a brand-new
  // browser, or from a server that predates Status & Chips -- found here by the
  // same rules (kinds.py), less its groups and hidden entities test.
  var FIND = {
    smoke: [['binary_sensor'], ['smoke', 'carbon_monoxide']], lights: [['light']], fans: [['fan']], doors: [['binary_sensor'], ['door']],
    windows: [['binary_sensor'], ['window']], garage: [['cover', 'binary_sensor'], ['garage', 'gate', 'garage_door']],
    locks: [['lock']], blinds: [['cover'], ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window', undefined]],
    leaks: [['binary_sensor'], ['moisture']], thermostats: [['climate']], timers: [['timer']],
    vacuums: [['vacuum']], speakers: [['media_player'], null, ['tv', 'receiver']]
  };
  function kindsLive() {
    var k = S('kinds', null);
    return !!(k && typeof k === 'object' && Object.keys(k).length);
  }
  function found(kind, client) {
    if (kindsLive()) { var k = S('kinds.' + kind, []); return Array.isArray(k) ? k : []; }
    var f = FIND[kind], states = (client && client.states) || {}, ents = (client && client.entities) || {};
    if (!f) return [];
    return Object.keys(states).filter(function (id) {
      if (f[0].indexOf(id.split('.')[0]) < 0) return false;
      var e = ents[id] || {}, a = states[id].attributes || {};
      if (e.hidden || e.entity_category || Array.isArray(a.entity_id)) return false;
      var dc = a.device_class;
      if (f[2] && f[2].indexOf(dc) >= 0) return false;
      if (!f[1]) return true;
      if (dc === undefined && id.indexOf('binary_sensor.') === 0) return false;
      return f[1].indexOf(dc) >= 0;
    }).sort();
  }
  function kindPage(kind) {
    var want = KIND_PAGES[kind] || [];
    var M = C0().menu, cfg = M && M.config ? M.config() : null;
    if (!cfg || !Array.isArray(cfg.views)) return want[0] ? './' + want[0] : null;   // an editor preview
    for (var i = 0; i < want.length; i++) {
      for (var j = 0; j < cfg.views.length; j++) {
        if (cfg.views[j] && cfg.views[j].path === want[i]) return './' + want[i];
      }
    }
    return null;
  }
  function nav(path) { return path ? { action: 'navigate', navigation_path: path } : { action: 'none' }; }

  // One kind's chip, or null when the house has none of it.
  function kindConfig(kind, client) {
    var tap = nav(kindPage(kind));
    var n = function (k) { return found(k, client); };
    switch (kind) {
      case 'smoke': {
        // SMOKE & CO: nothing to say until an alarm goes off, then what it
        // is -- "Smoke Detected", "CO Detected", both -- in red. Opens nothing:
        // there is nothing to do on a screen but leave.
        var sm = n('smoke'), co = [], gas = [], smoke = [];
        if (!sm.length) return null;
        sm.forEach(function (id) {
          var o = client && client.states && client.states[id];
          var dc = o && o.attributes && o.attributes.device_class;
          (dc === 'carbon_monoxide' ? co : dc === 'gas' ? gas : smoke).push(id);
        });
        var parts = [], icons = [];
        [[smoke, 'Smoke Detected', 'hk:smoke-detector'], [co, 'CO Detected', 'hk:molecule-co'],
         [gas, 'Gas Detected', 'hk:smoke-detector']].forEach(function (g) {
          if (!g[0].length) return;
          parts.push({ when: { any_of: g[0], state: 'on' }, label: g[1] });
          icons.push({ when: { any_of: g[0], state: 'on' }, icon: g[2] });
        });
        icons.push({ icon: 'hk:smoke-detector' });
        return { name: 'Smoke & CO', join: ' • ', fallback: 'Clear', parts: parts, icon_rules: icons,
          icon_color: 'red', active: [{ any_of: sm, state: 'on' }], tap_action: { action: 'none' } };
      }
      case 'weather_alert': {
        var al = S('weather.alerts', null);
        if (!al) return null;
        // The sensor's STATE is the alert COUNT; the alerts themselves are its
        // Alerts list (the NWS Alerts integration).
        return { name: 'Weather Alerts', icon: 'hk:alert-circle', entity: al, join: ' ', fallback: '--',
          parts: [{ attribute: ['Alerts.0.Event', 'Alerts.0.Headline'] },
                  { attribute: 'Alerts', length: true, offset: -1,
                    when: { attribute: 'Alerts', length: true, above: 1 }, format: '+{v}' }],
          icon_color_rules: [{ when: { attribute: 'Alerts.0.Severity', state: ['extreme', 'severe'], ignore_case: true },
                               color: 'red' }, { color: 'orange' }],
          active: [{ entity: al, above: 0 }], tap_action: tap };
      }
      case 'security': {
        var alarm = S('security.alarm', null), locks = n('locks');
        if (!alarm && !locks.length) return null;
        var c = { name: 'Security', label_rules: [], icon_rules: [], icon_color_rules: [], active: [], tap_action: tap };
        if (locks.length) c.count = { entities: locks, match: 'unlocked' };
        if (alarm) {
          c.label_rules.push({ when: { entity: alarm, state: 'triggered' }, source: alarm, label_case: 'title' });
          c.icon_rules.push({ when: { entity: alarm, state: 'triggered' }, icon: 'hk:shield-alert' });
          c.active.push({ entity: alarm, state: ['triggered', 'pending', 'arming'] });
        }
        if (locks.length) {
          c.label_rules.push({ when: { above: 0 }, format: '{v} Unlocked' });
          c.icon_rules.push({ when: { above: 0 }, icon: 'hk:lock-open-variant' });
          c.icon_color_rules.push({ when: { above: 0 }, color: 'red' });
          c.active.push({ count: c.count, above: 0 });
        }
        if (alarm) {
          c.label_rules.push({ source: alarm, label_case: 'title' });
          c.icon_rules.push({ when: { entity: alarm, state: ARMED }, icon: 'hk:shield-lock' });
          c.icon_rules.push({ icon: 'hk:shield-off' });
          c.icon_color_rules.push({ when: { entity: alarm, state: ['disarmed', 'triggered'] }, color: 'red' });
          c.icon_color_rules.push({ when: { entity: alarm, state: ARMED }, color: 'green' });
        } else {
          c.label_rules.push({ format: 'All Locked' });
          c.icon_rules.push({ icon: 'hk:lock' });
        }
        c.icon_color_rules.push({ color: 'gray' });
        return c;
      }
      case 'doors_windows': {
        var doors = n('doors'), wins = n('windows'), gar = n('garage');
        if (!doors.length && !wins.length && !gar.length) return null;
        // Each kind counted on its own and joined, each pluralised, a segment
        // dropping out at zero: "2 Doors • 1 Window".
        var parts = [], all = doors.concat(wins, gar);
        if (doors.length) parts.push({ count: { entities: doors, match: OPEN }, when: { above: 0 }, one: '1 Door', format: '{v} Doors' });
        if (wins.length) parts.push({ count: { entities: wins, match: OPEN }, when: { above: 0 }, one: '1 Window', format: '{v} Windows' });
        if (gar.length) parts.push({ count: { entities: gar, match: OPEN }, when: { above: 0 }, one: 'Garage Open', format: '{v} Garage Doors' });
        return { name: 'Doors & Windows', icon: 'hk:door-closed-lock', join: ' • ', fallback: 'All Closed',
          parts: parts, count: { entities: all, match: OPEN },
          icon_color_states: { zero: 'gray', nonzero: 'red' },
          active: [{ count: { entities: all, match: OPEN }, above: 0 }], tap_action: tap };
      }
      case 'climate': {
        var cl = n('thermostats'), fans = n('fans'), temp = S('features.temperature', null);
        if (!cl.length && !temp && !fans.length) return null;
        var p = [];
        if (temp) p.push({ source: temp, decimals: 0, format: '{v}°', fallback: '--' });
        else if (cl.length) p.push({ source: cl[0], attribute: 'current_temperature', decimals: 0, format: '{v}°', fallback: '--' });
        if (fans.length) p.push({ count: { entities: fans, match: 'on' }, when: { above: 0 }, one: '1 Fan', format: '{v} Fans' });
        var cc = { name: 'Climate', parts: p, icon_rules: [], icon_color_rules: [], active: [], tap_action: tap };
        if (cl.length) {
          cc.icon_rules.push({ when: { any_of: cl, attribute: 'hvac_action', state: 'cooling' }, icon: 'hk:snowflake' });
          cc.icon_rules.push({ when: { any_of: cl, attribute: 'hvac_action', state: 'heating' }, icon: 'hk:fire' });
          cc.icon_color_rules.push({ when: { any_of: cl, attribute: 'hvac_action', state: 'heating' }, color: 'red' });
          cc.active.push({ any_of: cl, attribute: 'hvac_action', state: ['cooling', 'heating'] });
        }
        if (fans.length) cc.active.push({ count: { entities: fans, match: 'on' }, above: 0 });
        cc.icon_rules.push({ icon: 'hk:thermostat' });
        cc.icon_color_rules.push({ color: 'blue' });
        return cc;
      }
      case 'lights': {
        var li = n('lights');
        if (!li.length) return null;
        return { name: 'Lights', count: { entities: li, match: 'on' }, format: '{v} On', fallback: '-- On',
          icon_states: { zero: 'hk:lightbulb-outline', nonzero: 'hk:lightbulb-on' },
          icon_color_states: { zero: 'gray', nonzero: 'yellow' },
          active: [{ count: { entities: li, match: 'on' }, above: 0 }], tap_action: tap };
      }
      case 'blinds': {
        var bl = n('blinds'), bm = ['open', 'opening', 'closing'];
        if (!bl.length) return null;
        return { name: 'Blinds', count: { entities: bl, match: bm }, zero: 'All Closed', format: '{v} Open',
          icon_states: { zero: 'hk:blinds-horizontal-closed', nonzero: 'hk:blinds-open' },
          icon_color_states: { zero: 'gray', nonzero: 'blue' },
          active: [{ count: { entities: bl, match: bm }, above: 0 }], tap_action: tap };
      }
      case 'timers': {
        var tm = n('timers');
        if (!tm.length) return null;
        return { name: 'Timers', icon: 'hk:timer-sand', count: { entities: tm, match: 'active' },
          format: '{v} On', zero: 'None', fallback: '--', icon_color_states: { zero: 'gray', nonzero: 'orange' },
          active: [{ count: { entities: tm, match: ['active', 'paused'] }, above: 0 }], tap_action: tap };
      }
      case 'vacuums': {
        var vc = n('vacuums'), vm = ['cleaning', 'returning', 'paused', 'error'];
        if (!vc.length) return null;
        return { name: 'Vacuums', icon: 'hk:robot-vacuum', count: { entities: vc, match: vm },
          format: '{v} Running', zero: 'Idle', icon_color_states: { zero: 'gray', nonzero: 'blue' },
          active: [{ count: { entities: vc, match: vm }, above: 0 }], tap_action: tap };
      }
      case 'speakers': {
        // HK Music's rooms when it is set up (each physical speaker once:
        // a sync group's members report `playing` with it).
        var music = window.hkMusic && window.hkMusic.rooms().length;
        var sp = music ? null : n('speakers');
        if (!music && !sp.length) return null;
        var cnt = music ? { music: true, match: 'playing' } : { entities: sp, match: 'playing' };
        return { name: 'Speakers', icon: 'hk:speaker', count: cnt, format: '{v} Playing', zero: 'None Playing',
          icon_color: 'gray', active: [{ count: cnt, above: 0 }], tap_action: tap };
      }
      case 'water': {
        var lk = n('leaks');
        if (!lk.length) return null;
        return { name: 'Water', icon: 'hk:water-alert', count: { entities: lk, match: 'on' },
          zero: 'No Leaks', one: '1 Leak', format: '{v} Leaks',
          icon_color_states: { zero: 'gray', nonzero: 'red' },
          active: [{ count: { entities: lk, match: 'on' }, above: 0 }], tap_action: tap };
      }
      case 'energy': {
        // Power Use (General), else the Energy feature's whole home
        var pw = S('features.power', null) || ((S('energy', null) || {}).total || {}).power || null;
        if (!pw) return null;
        var st = client && client.states[pw];
        var u = st && st.attributes && st.attributes.unit_of_measurement;
        // Shown in kW whatever the sensor reports (power sensors come in W, kW and MW).
        var scale = u === 'W' ? 0.001 : u === 'MW' ? 1000 : 1;
        return { name: 'Energy', icon: 'hk:lightning-bolt', entity: pw, scale: scale, format: '{v} kW', decimals: 1,
          fallback: '-- kW', icon_color: 'green', active: [{ entity: pw, above: 0 }], tap_action: tap };
      }
    }
    return null;
  }
  // The chips a dashboard shows when its item names none: every kind the
  // house has, in the row's order.
  function autoKinds(client) {
    return KIND_ORDER.filter(function (k) { return !!kindConfig(k, client); });
  }
  // A KIND'S CONFIG, rebuilt only when something it is built from moved:
  // the settings (Status & Chips, the alarm, the page list), HK Music's rooms,
  // the dashboard's views, or -- before the integration's kinds arrive --
  // the set of entities. Not per state push: the chip's signature walks its
  // config, and a new object every push would re-walk it several times a second.
  function expandKind(card) {
    var raw = card._raw;
    if (!raw || !raw.kind) return;
    var HS = window.hkSettings, M = C0().menu;
    var lc = M && M.config ? M.config() : null;
    // (a client at all: Smoke & CO sorts its alarms by their device class)
    var key = [HS ? HS.version : -1, window.hkMusic ? window.hkMusic.rooms().length : -1, card.client ? 1 : 0,
               kindsLive() ? '' : Object.keys((card.client && card.client.states) || {}).length].join('|');
    if (key === card._kindKey && lc === card._kindLc && card._config && card._config.__kind) return;
    card._kindKey = key; card._kindLc = lc;
    var base = kindConfig(raw.kind, card.client) ||
               { name: KIND_NAMES[raw.kind] || String(raw.kind), label: '--', missing: true };
    var over = Object.assign({}, raw);
    delete over.kind;
    card._config = Object.assign({}, base, over, { __kind: raw.kind });
  }

  // A chip for any entity (a dashboard's own extra chips): its name and state.
  // AN ENTITY AS A CHIP ("Also as chips"), drawn as its accessory says:
  // its name, glyph and colour, a label in place of its state,
  // and "show when" -- shown only while its state is that (the Mail chip).
  function accOf(id) {
    var A = S('accessories', null);
    return (A && A.entities && A.entities[id]) || {};
  }
  function entityChip(id, quiet) {
    var a = accOf(id);
    var chip = { type: 'custom:hk-status-chip-card', entity: id, quiet: !!quiet || !!a.when, unit: true,
                 active: a.when ? [{ entity: id, state: a.when }]
                                : [{ entity: id, state_not: ['off', 'unavailable', 'unknown', 'idle', 'closed', 'locked', ''] }] };
    if (a.name) chip.name = a.name;
    if (a.icon) chip.icon = /^mdi:/.test(a.icon) ? 'hk:' + a.icon.slice(4) : a.icon;
    if (a.color) chip.icon_color = a.color;
    if (a.label) chip.label = a.label;
    // an attribute in place of the state (its gear: "Shows"); the state's
    // unit is not the attribute's
    if (a.attribute) { chip.attribute = a.attribute; chip.unit = false; }
    return chip;
  }

  class HkStatusChipCard extends HkChipBase {
    // DECLARE WHAT THE LABEL READS, or the chip renders once and then lies.
    // HkBase's default signature covers `entity` only, so a chip counting six
    // locks would never re-render when one of them unlocked -- it would sit on
    // its first value indefinitely: a card that watches only its own
    // `entity` sees every other input late, whenever that entity next
    // changes.
    //
    // COLLECTED BY WALKING THE WHOLE CONFIG, not from a list of known keys.
    // A list misses something -- `when.any_of` (Climate's icon and colour
    // read hvac_action on both thermostats), a list-valued `source` taken as
    // one id -- and the chip keeps a stale icon and colour until some other
    // watched sensor happens to change, or the page is reloaded. Any
    // entity-shaped string anywhere counts; *_action blocks
    // are skipped, since what a tap calls is not what the chip shows.
    // A `kind:` is expanded first (expandKind), so its entities are walked.
    _sigOf() {
      expandKind(this);
      var h = this.client, c = this._config;
      if (!h || !c) return null;
      if (this._sigCfg !== c) { this._sigCfg = c; this._sigIds = entityIds(c); }
      var ids = this._sigIds;
      // `count: {music: true}` names its rooms nowhere in the config: they are
      // the integration's, read now, so a speaker added in the UI is counted.
      if (c.count && c.count.music && window.hkMusic) {
        ids = ids.concat(window.hkMusic.rooms().map(function (r) { return r.entity; }));
      }
      // No rooms YET (hk_music has not answered) is a stable state, not
      // "unknown": returning null here would redraw the Speakers chip on
      // every state push until the feed arrives. The moment rooms exist the
      // signature changes anyway.
      if (!ids.length) return (c.count && c.count.music) ? tileToken() + 'music:none' : null;
      var out = tileToken();
      for (var i = 0; i < ids.length; i++) {
        var st = h.states[ids[i]];
        out += ids[i] + '=' + (st ? st.last_updated : 'x') + ';';
      }
      return out;
    }

    // SHOWN OR NOT: a quiet chip only while something is active, and a kind
    // the house does not have never. Hidden the way a conditional card is --
    // the host `hidden`, and `card-visibility-changed` so the hui-card around
    // it hides too and the row closes the gap.
    //
    // NOT WHILE HOME ASSISTANT IS STILL BUILDING THE CARD: setConfig renders
    // before hui-card has stored the element, and an event then reaches a
    // hui-card whose element is still null -- it throws, and every chip in
    // the row becomes a "Configuration error". Before the card is on the page the
    // attribute is enough: hui-card reads `hidden` when it first updates.
    _show(on) {
      if (this._shown === on) return;
      this._shown = on;
      this.hidden = !on;
      if (this.style) this.style.display = on ? '' : 'none';
      if (this.isConnected && this.dispatchEvent) {
        this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
      }
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      // Hidden before it was attached: say so now that someone can hear it.
      if (this._shown === false && this.dispatchEvent) {
        this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: false }, bubbles: true, composed: true }));
      }
    }
    _active(cfg, st) {
      var a = cfg.active;
      if (!Array.isArray(a) || !a.length) return true;
      for (var i = 0; i < a.length; i++) if (passes(this, cfg, st, a[i])) return true;
      return false;
    }

    _render() {
      expandKind(this);
      var cfg = this._config, st = this._st(cfg.entity), on = this._isOn(st);
      this._show(!cfg.missing && (!cfg.quiet || this._active(cfg, st)));
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="chip status" data-hk-role="card"><div class="grid">' +
          '<div class="well" data-hk-role="well"><hk-state-icon class="icon" data-hk-role="icon"></hk-state-icon></div>' +
          // The newlines are not cosmetic: without whitespace between these
          // elements the card's text reads "Lights3 On" rather than
          // "Lights 3 On" -- to a screen reader, or in a copy.
          '\n<div class="name" data-hk-role="name"></div>\n' +
          '<div class="label" data-hk-role="label"></div>\n' +
          '</div></hk-plate>';
        this._e = {
          card: this._root.querySelector('.chip'), icon: this._root.querySelector('.icon'),
          name: this._root.querySelector('.name'), label: this._root.querySelector('.label')
        };
        // No hold -- see hk-tile.js. A long press does what a tap does.
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      var e = this._e;
      e.card.classList.toggle('inert', !!cfg.tap_action && cfg.tap_action.action === 'none');
      var val = valueOf(this, cfg, st);
      e.card.setAttribute('data-on', on ? '1' : '0');
      var ruleCol = ruleValue(this, cfg, st, cfg.icon_color_rules, 'color');
      e.icon.style.color = ruleCol
        ? colourFor({ icon_color: ruleCol }, st, val)
        : colourFor(cfg, st, val);
      // Flat's Light: a chip's glyph keeps its own bright color (the
      // user, 2026-10-17 -- a chip says how things are, on or off)
      if (window.hkCards.flatColor) e.icon.style.color = window.hkCards.flatColor(e.icon.style.color, 'on');
      e.icon.classList.toggle('spin', cfg.animation === 'spin');
      var cl = this.client;
      if (cl) cl.bindStateIcon(e.icon, st);
      // SAME FIRST-MATCH BRANCH AS THE LABEL, because Security's icon is a
      // branch too: triggered -> shield-alert, any lock open -> lock-open,
      // armed -> shield-lock, else shield-off. One predicate, three uses.
      var ic = ruleValue(this, cfg, st, cfg.icon_rules, 'icon')
            || pick(cfg.icon_states, val) || this._icon(st);
      if (ic) e.icon.icon = ic;
      this._sizeIcon(e.icon);
      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (e.name.textContent !== nm) e.name.textContent = nm;
      var lb = labelFor(this, cfg, st);
      if (e.label.textContent !== lb) e.label.textContent = lb;
    }
  }

  // The toggle chip. `option` turns it into a segment: with one set,
  // selection compares the entity's STATE to that option instead of testing
  // for 'on'. Same thing, different predicate -- one card with one option.
  class HkToggleCard extends HkChipBase {
    _isOn(st) {
      if (this._config.option != null) {
        return String((st && st.state) || '') === String(this._config.option);
      }
      return !!st && st.state === 'on';
    }
    _render() {
      var cfg = this._config, st = this._st(cfg.entity), on = this._isOn(st);
      if (!this._built) {
        this._root.innerHTML =
          '<hk-plate class="chip toggle" data-hk-role="card"><div class="grid">' +
          '<div class="name" data-hk-role="name"></div></div></hk-plate>';
        this._e = { card: this._root.querySelector('.chip'), name: this._root.querySelector('.name') };
        // No hold -- see hk-tile.js. A long press does what a tap does.
        this._bind(this._e.card, 'tap_action', null);
        this._built = true;
      }
      this._e.card.setAttribute('data-on', on ? '1' : '0');
      var nm = cfg.name || (st && st.attributes && st.attributes.friendly_name) || cfg.entity;
      if (this._e.name.textContent !== nm) this._e.name.textContent = nm;
    }
  }


  // ============================================================ THE CHIP ROW
  //
  // hk-chips-card: the status chips under a dashboard's header, as ONE card
  // with nothing to list. Which chips, in what order and which
  // are quiet is the dashboard's own -- its item under Dashboards on the
  // integration's page (Home: Chips, Only when there is something to report)
  // -- read live, so an edit there reaches an open screen at once. A
  // dashboard with no item, or an item that picks none, shows every kind the
  // house has, in KIND_ORDER.
  //
  //   type: custom:hk-chips-card
  //   chips: [lights, climate, sensor.mailbox]   # optional: the row when the item names none
  //   quiet: [lights]                            # optional: likewise, the quiet ones
  //   extra:                                     # the house's own chips, placed
  //     - after: weather_alert                   #   after a kind, or start / end
  //       card: {type: conditional, ...}
  //
  // The row is an hk-row-card with the chip row's measured geometry
  // (14/30 shadow room, 22 sideways, the 35 px
  // section gaps paid back by the margin) and the menu chip as its lead.
  // The row's config: this card's own lists, else the dashboard's, else
  // every kind the house has; the house's extra chips placed; the geometry.
  // `away`: on someone else's dashboard (HkBase place(): data-hk-foreign).
  // The rows' sideways bleed (-22 px each side, paid back in padding) is for
  // HK's own page padding; in a section it runs past the section's edge.
  function rowPlan(cfg, b, client, away) {
    b = b || {};
    // The dashboard's Home -> Chips -> "Show the status chips": no row.
    if (b.chips_row === false) return null;
    // THE DASHBOARD'S OWN CHOICE FIRST (its item), then this card's YAML as
    // the default, then every kind the house has.
    var tokens = (Array.isArray(b.chips) && b.chips.length) ? b.chips
               : (Array.isArray(cfg.chips) && cfg.chips.length) ? cfg.chips : autoKinds(client);
    // The dashboard's own chips (entities): chips_extra says WHICH, and the
    // item's chips list may place them among the kinds (Order -> Chips);
    // one not placed follows the kinds. An entity the list
    // places but chips_extra no longer names is gone.
    if (Array.isArray(b.chips_extra)) {
      var extra = b.chips_extra;
      if (tokens === b.chips) {
        tokens = tokens.filter(function (t) { return typeof t !== 'string' || t.indexOf('.') < 0 || extra.indexOf(t) >= 0; });
      }
      tokens = tokens.concat(extra.filter(function (e) { return tokens.indexOf(e) < 0; }));
    }
    // CUSTOM CHIPS: the house's own chips in YAML (Library ->
    // Custom Chips); this screen's chips_custom says which. One the chip
    // order places ("chip:<key>") sits there; the rest where the chip says --
    // after a kind, at the start or the end -- as a YAML `extra:` would.
    var lib = {};
    (S('custom_chips', null) || []).forEach(function (c) { if (c && c.key && c.card) lib[c.key] = c; });
    var mine = (Array.isArray(b.chips_custom) ? b.chips_custom : []).filter(function (k) { return lib[k]; });
    var TOK = 'chip:';
    tokens = tokens.filter(function (t) {
      return typeof t !== 'string' || t.indexOf(TOK) !== 0 || mine.indexOf(t.slice(TOK.length)) >= 0;
    });
    // EACH CUSTOM CHIP'S SHOW on this screen (2026-10-13, chips_custom_show):
    // Always or When Active, like the kinds; missing, as written. Always
    // takes a conditional chip out of its condition; When Active makes a
    // status chip quiet -- its own `active:` rules, or for one entity, while
    // it isn't off, closed, idle or unavailable (as an accessory chip).
    var cshow = (b.chips_custom_show && typeof b.chips_custom_show === 'object') ? b.chips_custom_show : {};
    var copyAs = function (key, card) {
      var c = JSON.parse(JSON.stringify(card)), m = cshow[key];
      if (m === 'always' && c.type === 'conditional' && c.card) return c.card;
      if (m === 'active' && c.type === 'custom:hk-status-chip-card') {
        c.quiet = true;
        if (!Array.isArray(c.active) || !c.active.length) {
          if (c.entity) c.active = [{ entity: c.entity, state_not: ['off', 'unavailable', 'unknown', 'idle', 'closed', 'locked', ''] }];
        }
      }
      return c;
    };
    var quiet = Array.isArray(b.chips_quiet) ? b.chips_quiet
              : Array.isArray(cfg.quiet) ? cfg.quiet : QUIET_DEFAULT;
    // SMOKE & CO is no screen's choice: it leads every row of a house that
    // has an alarm, shown only while one is going off.
    tokens = tokens.filter(function (t) { return t !== 'smoke'; });
    var keys = [], cards = [];
    tokens.forEach(function (t) {
      if (t && typeof t === 'object') { keys.push(null); cards.push(t); return; }
      t = String(t);
      if (t.indexOf(TOK) === 0) { keys.push(t); cards.push(copyAs(t.slice(TOK.length), lib[t.slice(TOK.length)].card)); return; }
      keys.push(t);
      cards.push(t.indexOf('.') > 0 ? entityChip(t, quiet.indexOf(t) >= 0)
                                    : { type: 'custom:hk-status-chip-card', kind: t, quiet: quiet.indexOf(t) >= 0 });
    });
    // after: a kind (or an entity) in the row, `start` or `end`. A kind the
    // row does not show puts the chip at the end.
    var placed = keys.filter(function (k) { return k && k.indexOf(TOK) === 0; });
    var extras = (Array.isArray(cfg.extra) ? cfg.extra : []).concat(mine.filter(function (k) {
      return placed.indexOf(TOK + k) < 0; }).map(function (k) { return { after: lib[k].after, card: copyAs(k, lib[k].card) }; }));
    extras.forEach(function (x) {
      if (!x || !x.card) return;
      var at = x.after === 'start' ? 0 : keys.indexOf(x.after) + 1;
      if (at <= 0 && x.after !== 'start') at = cards.length;
      keys.splice(at, 0, null);
      cards.splice(at, 0, x.card);
    });
    if (found('smoke', client).length) cards.unshift({ type: 'custom:hk-status-chip-card', kind: 'smoke', quiet: true });
    var row = { type: 'custom:hk-row-card', card_width: 'fit-content', gap: 10, pad_top: 14,
                pad_bottom: 30, pad_left: 22, pad_right: 22, margin: '-15px -22px -32px -22px',
                cards: cards };
    if (away) { row.margin = '-15px 0px -32px 0px'; row.pad_left = 0; row.pad_right = 0; }
    ROW_KEYS.forEach(function (k) { if (cfg[k] !== undefined) row[k] = cfg[k]; });
    // `lead: true` (the editor's Menu Button switch, on) is the default too
    if (cfg.lead !== false) row.lead = (cfg.lead && cfg.lead !== true) ? cfg.lead : { type: 'custom:hk-menu-button-card' };
    return row;
  }
  var ROW_KEYS = ['align', 'card_width', 'gap', 'pad_top', 'pad_bottom', 'pad_left', 'pad_right', 'margin',
                  'phone_card_width', 'phone_gap'];
  class HkChipsCard extends HTMLElement {
    constructor() {
      super();
      var self = this;
      this._key = null;
      this._row = null;
      this._wake = function () { self._plan(); };
    }
    setConfig(config) {
      this._cfgIn = Object.assign({}, config || {});
      this._key = null;
      this._plan();
    }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (C0().place) C0().place(this);
      this.style.display = 'block';
      window.addEventListener('hk-module-ready', this._wake);
      this._plan();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      window.removeEventListener('hk-module-ready', this._wake);
    }
    // A settings change arrives as `hk-module-ready` (the wake above). The
    // State pushes only matter before the integration's kinds are in, when
    // the kinds are found from the states themselves. EACH NEW CLIENT arrives
    // through the host adapter's entry (below the class).
    _onClient(client) {
      var first = !this._seenClient;
      this._seenClient = client;
      if (C0().tone) C0().tone(this, client);
      if (first || !kindsLive()) this._plan();
      if (this._row) window.hkHostClient.bridge(this._row, client);
    }
    getCardSize() { return 1; }
    _board() {
      var M = C0().menu;
      return (M && M.board ? M.board() : null) || {};
    }
    _plan() {
      var cfg = this._cfgIn;
      if (!cfg) return;
      var row = rowPlan(cfg, this._board(), this.client, this.hasAttribute('data-hk-foreign'));
      var key = JSON.stringify(row);
      if (key === this._key) return;
      var on = !!row;
      this.style.display = on ? '' : 'none';
      if (this.hidden === on) {
        this.hidden = !on;
        // never before connected: hui-card's element is still null then
        if (this.isConnected) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
        }
      }
      if (!on) { this._key = key; return; }
      if (!customElements.get('hk-row-card')) {
        var self = this;
        if (!this._waiting) {
          this._waiting = true;
          customElements.whenDefined('hk-row-card').then(function () {
            self._waiting = false; self._key = null; self._plan();
          });
        }
        return;
      }
      this._key = key;
      if (!this._row) {
        this._row = document.createElement('hk-row-card');
        this.appendChild(this._row);
      }
      this._row.setConfig(row);
      window.hkHostClient.bridge(this._row, this.client);
    }
  }

  // ============================================================ THE SCENES ROW
  //
  // hk-scenes-card: the row of scene pills, with nothing to list (1.7). Which
  // scenes, and their order, are the dashboard's own (its item: Home ->
  // Scenes), read live; with none chosen there, this card's `scenes:`, else
  // every scene the house has, A to Z. `looks:` is how a given entity's pill
  // looks -- a house's own names, glyphs and colours, kept once however many
  // dashboards pick it. An entity without a look is drawn from its own name
  // and icon (HA's entity settings) and runs on a tap: a scene or script is
  // turned on, a button pressed.
  //
  //   type: custom:hk-scenes-card
  //   scenes: [scene.movie, input_button.good_morning]
  //   looks:
  //     input_button.good_morning: {name: Good Morning, icon: hk:white-balance-sunny, icon_color: yellow}
  //
  // The row's measured geometry: the pill
  // width the grids read (--hk-pill), 14/30/22/22 of shadow room paid back by
  // the wrapper's margin, two pills across on a phone.
  var SCENE_ICON = { scene: 'mdi:palette', script: 'mdi:script-text-play', button: 'mdi:gesture-tap-button',
                     input_button: 'mdi:gesture-tap-button', automation: 'mdi:robot' };
  function sceneTap(id) { return window.hkCards.sceneTap(id); }
  function scenePill(client, id, look) {
    var st = client && client.states[id], ent = client && client.entities && client.entities[id];
    var a = (st && st.attributes) || {};
    // its accessory's name, glyph and colour (the gear) before its own
    var own = accOf(id);
    var pill = { type: 'custom:hk-scene-card', elevated: true, entity: id,
                 name: own.name || a.friendly_name || id,
                 icon: (own.icon && (/^mdi:/.test(own.icon) ? 'hk:' + own.icon.slice(4) : own.icon)) ||
                       (ent && ent.icon) || a.icon || SCENE_ICON[id.split('.')[0]] || 'mdi:circle-outline',
                 icon_color: own.color || 'white', tap_action: sceneTap(id) };
    return Object.assign(pill, look || {});
  }
  // A PILL THAT OPENS A PAGE (Home -> Scenes -> Pills that open a page): the
  // house's Live TV / Apple Music / Cameras pills, as settings. Its page on
  // this dashboard (the first of these paths it has), or no pill.
  var PAGE_PILLS = {
    weather: ['Weather', 'hk:weather-partly-cloudy', 'white', ['weather']],
    calendar: ['Calendar', 'mdi:calendar-month', 'white', ['calendar']],
    cameras: ['Cameras', 'hk:camera', 'white', ['cameras']],
    live_tv: ['Live TV', 'hk:television', 'white', ['live-tv']],
    security: ['Security', 'hk:shield-lock', 'white', ['security', 'alarm']],
    doors_windows: ['Doors & Windows', 'hk:door-closed-lock', 'white', ['doors-windows', 'doors', 'security']],
    climate: ['Climate', 'hk:thermostat', 'white', ['climate']],
    lights: ['Lights', 'hk:lightbulb', 'white', ['lights']],
    timers: ['Timers', 'hk:timer-sand', 'white', ['timers']],
    vacuums: ['Vacuums', 'hk:robot-vacuum', 'white', ['vacuums']],
    music: ['Music', 'hk:music', 'white', ['playmusic']],
    water: ['Water', 'hk:water', 'white', ['water']],
    // the Energy feature's page: drawn only where the screen has it (the
    // feature added, the page on its Pages)
    energy: ['Energy', 'mdi:lightning-bolt', 'white', ['energy']]
  };
  function pagePill(key) {
    var p = PAGE_PILLS[key];
    if (!p) return null;
    var M = C0().menu, cfg = M && M.config ? M.config() : null, path = null;
    if (!cfg || !Array.isArray(cfg.views)) path = p[3][0];               // an editor preview
    else {
      for (var i = 0; i < p[3].length && !path; i++) {
        for (var j = 0; j < cfg.views.length; j++) {
          if (cfg.views[j] && cfg.views[j].path === p[3][i]) { path = p[3][i]; break; }
        }
      }
    }
    if (!path) return null;
    // the house's look for this pill (HK Settings, a screen's Scenes)
    var lk = (S('look.page_pills', null) || {})[key] || {};
    return { type: 'custom:hk-scene-card', elevated: true, name: lk.name || p[0], icon: lk.icon || p[1],
             icon_color: lk.color || p[2],
             tap_action: { action: 'navigate', navigation_path: './' + path } };
  }
  function scenesPlan(cfg, b, client, away) {
    b = b || {};
    var T = C0().TILE;
    // A ROOM'S ROW (`room: true`, a room page's): exactly the scenes it was
    // given -- never the screen's Home row, its switch or its page pills
    if (cfg.room) b = { scenes: [], scenes_pages: [] };
    var show = (cfg.room || b.scenes_row !== false) && cfg.show !== false;
    var ids = (Array.isArray(b.scenes) && b.scenes.length) ? b.scenes
            : (Array.isArray(cfg.scenes) && cfg.scenes.length) ? cfg.scenes : null;
    if (cfg.room && !ids) return { auto: false, config: null };
    var auto = !ids;
    if (auto) {
      var st = (client && client.states) || {}, ents = (client && client.entities) || {};
      ids = Object.keys(st).filter(function (id) {
        return id.indexOf('scene.') === 0 && !(ents[id] && (ents[id].hidden || ents[id].entity_category));
      }).sort(function (x, y) {
        return String(st[x].attributes.friendly_name || x).localeCompare(String(st[y].attributes.friendly_name || y));
      });
    }
    var looks = cfg.looks || {};
    // An entry may be a whole card (a pill that opens a page and runs
    // nothing, like Live TV): used as it is.
    // A PILL THAT OPENS A PAGE: scenes_pages says which, and the scenes list
    // may place one among the scenes as "page:<kind>" (Order -> Scenes);
    // one not placed follows the scenes.
    var pages = Array.isArray(b.scenes_pages) ? b.scenes_pages : [];
    var placed = {};
    var pills = [];
    ids.forEach(function (id) {
      if (typeof id === 'object') { pills.push(id); return; }
      if (String(id).indexOf('page:') === 0) {
        var k = id.slice(5);
        if (pages.indexOf(k) < 0 || placed[k]) return;
        placed[k] = true;
        var p = pagePill(k);
        if (p) pills.push(p);
        return;
      }
      if (!client || client.states[id]) pills.push(scenePill(client, id, looks[id]));
    });
    pages.forEach(function (k) {
      if (placed[k]) return;
      var pp = pagePill(k);
      if (pp) pills.push(pp);
    });
    if (!show || !pills.length) return { auto: auto, config: null };
    // ON A HOME GRID (docs/phase11/HOME-GRID.md): the block holds as many
    // scenes as it has cells -- W two, L four, XL six -- each a scene tile the
    // size of one cell (hk-tile.js, on a Home Grid). No heading: the block is
    // the scenes. (More scenes are the pager's pages, G4.)
    var cell = cfg.hk_cell && C0().HOME_GRID.sizes[cfg.hk_cell];
    // (fewer scenes than cells: the cells they need and no holes -- one row of them, else fewer columns, 2026-10-30)
    if (cell) {
      var n = Math.min(pills.length, cell[0] * cell[1]), cols = cell[0], rows = cell[1];
      if (n < cols * rows) { if (n <= cols) { rows = 1; cols = n; } else cols = Math.ceil(n / rows); }
      return { auto: auto, config: { hk_cell: cfg.hk_cell, cols: cols, rows: rows, surface: cfg.surface, pills: pills.slice(0, n) } };
    }
    return { auto: auto, config: { type: 'grid', columns: 1, square: false, cards: [
      { type: 'custom:hk-heading-card', name: cfg.name || 'Scenes' },
      { type: 'custom:hk-grid-card',
        layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': '114px', 'grid-auto-flow': 'row',
                  'grid-column-gap': '12px', 'grid-row-gap': '12px',
                  margin: away ? '-14px 0px -7px 0px' : '-14px -22px -7px -22px', padding: '0px' },
        // the pills' own width and gap (hk-base.js TILE), so the scenes line
        // up with the grids below; on a phone, half the row each (a grid's
        // 2-up track: half its width less half the gap, plus the 4 px of
        // grid-child margin the row has instead of a cell)
        cards: [{ type: 'custom:hk-row-card', card_width: 'var(--hk-pill, ' + T.w + 'px)', gap: T.gridGap,
                  pad_top: 14, pad_bottom: 30, pad_left: away ? 0 : 22, pad_right: away ? 0 : 22,
                  phone_card_width: 'calc((100% - ' + T.gridGap + 'px) / 2 + 4px)', phone_gap: T.gridGap + 'px', cards: pills }] }] } };
  }
  class HkScenesCard extends HTMLElement {
    constructor() {
      super();
      var self = this;
      this._key = null;
      this._wake = function () { self._plan(); };
    }
    setConfig(config) { this._cfgIn = Object.assign({}, config || {}); this._key = null; this._plan(); }
    // a Home Grid block's size (hk-home-grid-view sets it): planned again
    static get observedAttributes() { return ['size']; }
    attributeChangedCallback(name, was, now) { if (was !== now) this._plan(); }
    connectedCallback() {
      if (super.connectedCallback) super.connectedCallback();
      if (C0().place) C0().place(this);
      window.addEventListener('hk-module-ready', this._wake);
      this._plan();
      if (this._box) this._glass();
    }
    disconnectedCallback() {
      if (super.disconnectedCallback) super.disconnectedCallback();
      window.removeEventListener('hk-module-ready', this._wake);
      if (window.__hkGlassCards && window.__hkGlassCards.delete(this) && window.hkGlass) window.hkGlass.changed(this, false);
    }
    _glass() {
      if (this.isConnected && window.__hkGlassCards) { window.__hkGlassCards.add(this); if (window.hkGlass) { window.hkGlass.changed(this, true); window.hkGlass.rendered(this); } }
    }
    // Every scene, A to Z, follows the house's scenes: re-planned when the
    // number of entities moves (cheap), not on every push.
    // The count is taken only while the row follows them (_auto): a screen
    // that picks its own scenes -- every one in this house -- has nothing to
    // re-plan, and 4,195 keys on each of ~12 pushes a second was the cost.
    _onClient(client) {
      var first = !this._seenClient;
      var n = (first || this._auto) && client && client.states ? Object.keys(client.states).length : this._n;
      this._seenClient = client;
      if (C0().tone) C0().tone(this, client);
      if (first || (this._auto && n !== this._n)) { this._n = n; this._plan(); }
      if (this._el) window.hkHostClient.bridge(this._el, client);
      (this._tiles || []).forEach(function (t) { t.hkSetClient(client); });
    }
    getCardSize() { return 2; }
    _plan() {
      if (!this._cfgIn) return;
      var M = C0().menu;
      var size = this.getAttribute('size');
      var p = scenesPlan(size ? Object.assign({}, this._cfgIn, { hk_cell: size }) : this._cfgIn,
                         (M && M.board ? M.board() : null) || {}, this.client, this.hasAttribute('data-hk-foreign'));
      this._auto = p.auto;
      var key = JSON.stringify(p.config);
      if (key === this._key) return;
      this._key = key;
      var on = !!p.config;
      this.style.display = on ? 'block' : 'none';
      if (this.hidden === on) {
        this.hidden = !on;
        if (this.isConnected) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed', { detail: { value: on }, bubbles: true, composed: true }));
        }
      }
      if (!on) return;
      if (p.config.hk_cell) { this._grid(p.config); return; }
      if (this._box) { this.removeChild(this._box); this._box = null; this._tiles = null; }
      var wrapper = window.hkCards.cardWrapper();
      if (!wrapper) {
        // No Lovelace: the card itself (hkCards.createCard), made again for a
        // new plan, as Lovelace's wrapper builds its card again for a new config.
        var next = window.hkCards.createCard(p.config, this.client);
        if (this._el && this._el.parentNode === this) this.replaceChild(next, this._el);
        else this.appendChild(next);
        this._el = next;
        return;
      }
      if (!this._el) {
        this._el = document.createElement(wrapper);
        this._el.preview = false;
        this.appendChild(this._el);
      }
      window.hkHostClient.bridge(this._el, this.client);
      this._el.config = p.config;
      if (this._el.load) this._el.load();
    }
    // A HOME GRID BLOCK: the scene tiles on the block's own cells, made as
    // HK's own cards (never a host wrapper) so each can be told its size
    _grid(plan) {
      if (this._el) { if (this._el.parentNode === this) this.removeChild(this._el); this._el = null; }
      if (!this._box) {
        this._box = document.createElement('div');
        this.appendChild(this._box);
      }
      var box = this._box, client = this.client;
      box.style.cssText = C0().plate('card') + ';box-sizing:border-box;padding:var(--hk-pad-t,12px) var(--hk-pad-r,12px) calc(var(--hk-pad-b,12px) + var(--hk-pager-safe,0px)) var(--hk-pad-l,12px);display:grid;width:100%;height:100%;gap:' + C0().HOME_GRID.gap + 'px;' +
        'grid-template-columns:repeat(' + plan.cols + ',minmax(0,1fr));grid-template-rows:repeat(' + plan.rows + ',minmax(0,1fr));overflow:hidden;--hk-pill:100%';
      delete box._hkGroupBase; C0().groupSurface(box, plan.surface);
      while (box.firstChild) box.removeChild(box.firstChild);
      this._tiles = plan.pills.map(function (pill) {
        var t = window.hkCards.create(pill);
        t.setAttribute('data-group-fill', '');
        t.style.cssText = 'min-width:0;min-height:0;width:100%;height:100%';
        box.appendChild(t);
        if (client) t.hkSetClient(client);
        return t;
      });
      this._glass();
    }
  }

  // register / firstOf are hk-base.js's -- a private copy drifts (the
  // hasOwnProperty stub guard is easy to lose).
  var C = window.hkCards, register = C.register, firstOf = C.firstOf;

  var KIND_OPTIONS = KIND_ORDER.map(function (k) { return { value: k, label: KIND_NAMES[k] }; });
  // A single chip may be Smoke & CO too; the row's lists may not -- it leads
  // every row on its own (rowPlan), so choosing it there would do nothing.
  var CHIP_KIND_OPTIONS = [{ value: 'smoke', label: KIND_NAMES.smoke }].concat(KIND_OPTIONS);
  // Lovelace's entry for the two cards that are not an HkBase: the host adapter
  // turns each object it hands them into a client for `_onClient`.
  window.hkHostClient.entry(HkChipsCard);
  window.hkHostClient.entry(HkScenesCard);
  register('hk-status-chip-card', HkStatusChipCard, 'HK Status Chip',
           'A small header chip with an icon, a title and a one-line summary.',
           [
             // A kind fills in everything else from Status & Chips; set one, or
             // an entity for a chip of your own.
             { name: 'kind', selector: { select: { mode: 'dropdown', options: CHIP_KIND_OPTIONS } } },
             { name: 'quiet', selector: { boolean: {} } },
             { name: 'entity', selector: { entity: {} } },
             { type: 'grid', name: '', schema: [
               { name: 'name', selector: { text: {} } },
               { name: 'label', selector: { text: {} } }
             ] },
             C.section('Appearance', [
               { type: 'grid', name: '', schema: [
                 { name: 'icon', selector: { icon: {} } },
                 { name: 'icon_color', selector: C.selColour() },
                 { name: 'icon_size', selector: { text: {} } },
                 { name: 'animation', selector: C.selOptions(['spin', 'none']) }
               ] },
               { name: 'icon_states', selector: { object: {} } }
             ], 'mdi:palette'),
             // A CHIP OF YOUR OWN (no kind): what it reads and how the
             // number reads. valueOf / fmt above.
             C.section('Your Own Chip', [
               { name: 'source', label: 'Read From',
                 helper: 'Another entity to read instead of the chip\'s own. More in YAML: count, parts, label_rules, active.',
                 selector: { entity: {} } },
               { type: 'grid', name: '', schema: [
                 { name: 'attribute', label: 'Read Attribute',
                   helper: 'Read this attribute instead of the state.', selector: { text: {} } },
                 { name: 'format', label: 'Format',
                   helper: '{v} is the value, e.g. {v} On.', selector: { text: {} } },
                 { name: 'zero', label: 'When Zero',
                   helper: 'Shown instead when the value is 0, e.g. All Off.', selector: { text: {} } },
                 { name: 'one', label: 'When One',
                   helper: 'Shown instead when the value is 1, e.g. 1 Light.', selector: { text: {} } }
               ] }
             ], 'mdi:tune'),
             C.section('Interactions', [
               { name: 'tap_action', selector: { ui_action: {} } }
             ], 'mdi:gesture-tap')
           ],
           function () { return { kind: 'lights' }; });

  register('hk-chips-card', HkChipsCard, 'HK Status Chips',
           'The row of status chips: which ones, their order and which appear only when there is something to report come from this dashboard\'s settings.',
           [
             { name: 'chips', selector: { select: { multiple: true, reorder: true, custom_value: true,
                                                    mode: 'dropdown', options: KIND_OPTIONS } } },
             { name: 'quiet', selector: { select: { multiple: true, mode: 'dropdown', options: KIND_OPTIONS } } },
             // `lead` (rowPlan): unset or true is the menu button, false none.
             // A card of your own there stays YAML (lead: {type: ...}).
             { name: 'lead', label: 'Menu Button', default: true,
               helper: 'Off: the row starts with the first chip, no menu button.',
               selector: { boolean: {} } },
             // the hk-row-card geometry rowPlan passes on (ROW_KEYS)
             C.section('Row Layout', [
               { type: 'grid', name: '', schema: [
                 { name: 'card_width', label: 'Chip Width',
                   helper: 'CSS width of each chip. Default: fit-content.', selector: { text: {} } },
                 { name: 'gap', label: 'Gap',
                   helper: 'Pixels between chips. Default: 10.', selector: { number: { min: 0, max: 48, mode: 'box' } } },
                 { name: 'margin', label: 'Margin',
                   helper: 'CSS margin around the row, e.g. 0px 0px 12px 0px.', selector: { text: {} } }
               ] }
             ], 'mdi:ruler')
           ],
           function () { return {}; });

  register('hk-scenes-card', HkScenesCard, 'HK Scenes Row',
           'The row of scene pills: which scenes, and their order, come from this dashboard\'s settings.',
           [
             { name: 'scenes', selector: { entity: { multiple: true, reorder: true } } },
             { name: 'name', selector: { text: {} } },
             // scenesPlan: exactly these scenes -- never the dashboard's own
             // Scenes choice, its switch or its page pills; none, no row
             { name: 'room', label: 'Just These Scenes',
               helper: 'On: shows only the scenes above, never this dashboard\'s own Scenes choice or its page pills.',
               selector: { boolean: {} } },
             { name: 'looks', selector: { object: {} } }
           ],
           function () { return {}; });

  register('hk-toggle-card', HkToggleCard, 'HK Toggle Chip',
           'A text-only pill that lights up when an entity is on, or is in a chosen state.',
           [
             { name: 'entity', required: true, selector: { entity: {} } },
             { type: 'grid', name: '', schema: [
               { name: 'name', selector: { text: {} } },
               // `option` is the whole difference between a toggle and a
               // segment: with it set, "selected" means state == option
               // instead of state == on.
               { name: 'option', selector: { text: {} } }
             ] },
             C.section('Interactions', [
               { name: 'tap_action', selector: { ui_action: {} } }
             ], 'mdi:gesture-tap')
           ],
           // THE STUB MUST WORK AS PICKED: a toggle that lights while on and
           // switches on a tap -- an input_boolean, else a switch. Only a house
           // with neither gets the segment form: an input_select lit on its
           // current option, a tap choosing it.
           function (client) {
             var ids = client && client.states ? Object.keys(client.states) : [];
             var first = function (d) {
               for (var i = 0; i < ids.length; i++) if (ids[i].indexOf(d + '.') === 0) return ids[i];
               return null;
             };
             var tog = first('input_boolean') || first('switch');
             if (tog) return { entity: tog, tap_action: { action: 'toggle' } };
             var sel = firstOf(client, 'input_select'), st = client && client.states && client.states[sel];
             var opt = st ? st.state : 'Everywhere';
             return { entity: sel, name: opt, option: opt,
                      tap_action: { action: 'perform-action', perform_action: 'input_select.select_option',
                                    target: { entity_id: sel }, data: { option: opt } } };
           });


  window.hkChip.HkChipBase = HkChipBase;
  window.hkChip.HkStatusChipCard = HkStatusChipCard;
  window.hkChip.HkChipsCard = HkChipsCard;
  window.hkChip.HkScenesCard = HkScenesCard;
  window.hkChip.scenes = { plan: scenesPlan, pill: scenePill, page: pagePill };
  window.hkChip.kinds = { ORDER: KIND_ORDER, NAMES: KIND_NAMES, QUIET: QUIET_DEFAULT, PAGES: KIND_PAGES,
                          config: kindConfig, auto: autoKinds, found: found, rowPlan: rowPlan,
                          entityChip: entityChip };
  window.hkChip.HkToggleCard = HkToggleCard;
  });
})();
