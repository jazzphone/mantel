// hk-chip-base.js - the chips' CSS, base class, values, rules and labels.
//
// PART OF THE CHIP CARDS (hk-chip.js). Not a card and not run on its own: it registers one
// function, which hk-chip.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkChipParts = window.hkChipParts || {})['hk-chip-base'] = function (K) {
    var HkBase = K.HkBase;

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
                            (config.count && (config.count.entities || config.count.music || config.count.laundry)) ||
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
      // `count: {laundry: true}` -- the house's washers and dryers (hk-laundry.js) that run, wait to be unloaded or need a look
      if (cfg.count && cfg.count.laundry) {
        var LA = window.hkLaundry, cl = card.client || (window.hkCards && window.hkCards.client ? window.hkCards.client() : null);
        if (!LA || !cl) return 0;
        return LA.lookAll(cl).filter(function (o) { return o.runs || o.state === 'done' || o.state === 'wrinkle' || o.state === 'leak' || o.state === 'error'; }).length;
      }
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
      // ONE MACHINE SAYS ITS OWN WORDS ("24 min left", "Done", "Leak"); several, how many
      if (cfg.count && cfg.count.laundry && window.hkLaundry) {
        var cl0 = card.client || (window.hkCards && window.hkCards.client ? window.hkCards.client() : null);
        var lit = cl0 ? window.hkLaundry.lookAll(cl0).filter(function (o) { return o.runs || o.state === 'done' || o.state === 'wrinkle' || o.state === 'leak' || o.state === 'error'; }) : [];
        if (!lit.length) return String(cfg.zero || 'Off');
        return lit.length === 1 ? lit[0].short : lit.length + ' Machines';
      }

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
                      'timers', 'vacuums', 'laundry', 'speakers', 'water', 'energy'];
    var KIND_NAMES = { smoke: 'Smoke & CO', weather_alert: 'Weather Alerts', security: 'Security', doors_windows: 'Doors & Windows',
                       climate: 'Climate', lights: 'Lights', blinds: 'Blinds', timers: 'Timers',
                       vacuums: 'Vacuums', laundry: 'Laundry', speakers: 'Speakers', water: 'Water', energy: 'Energy' };
    // Quiet unless a dashboard says otherwise: news, not a permanent slot.
    var QUIET_DEFAULT = ['weather_alert', 'doors_windows', 'blinds', 'laundry', 'water'];
    // The page each opens: the first of these the dashboard has. None of them:
    // the chip reports and opens nothing.
    var KIND_PAGES = { weather_alert: ['weather'], security: ['security', 'alarm'],
                       doors_windows: ['doors-windows', 'doors', 'security'], climate: ['climate'], lights: ['lights'],
                       blinds: ['blinds', 'shades', 'climate'], timers: ['timers'], vacuums: ['vacuums'], laundry: [],
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

    // THE INTERCOM'S ENTRY (Settings: a screen's Status Chips, `intercom` among its chips_extra, or its Scenes, `intercom`
    // among its scenes_pages; both under More, never in Automatic). A status chip among the header's, or a pill in the
    // scenes row, that opens the Intercom sheet (tap_action `intercom`, hk-base.js:
    // the `#intercom` address; the sheet's code, cards/hk-intercom.js, is loaded by that address and not before). This is
    // all of the Intercom a page carries until the tap: the feed and the person's remembered rooms are asked for here,
    // only by a row whose screen has the entry (icWatch), and let go of when none is left. Drawn only where the page
    // has the Intercom (client.intercom: Mantel; none in Home Assistant), the feed says it is on, and this person may
    // use it (a refused feed is an error, not a snapshot).
    var IC = { feed: null, bad: false, mem: null, users: 0, offFeed: null, offMem: null, fns: [] };
    function icNote() { IC.fns.slice().forEach(function (fn) { try { fn(); } catch (e) { console.error('[hk-chip]', e); } }); }
    function icLocal() {
      try { return JSON.parse((window.localStorage && window.localStorage.getItem('hk-intercom')) || 'null'); } catch (e) { return null; }
    }
    function icAttach(client) {
      if (!IC.offFeed && client.intercom) {
        IC.offFeed = client.intercom.subscribe(function (ev, err) {
          IC.bad = !!err || !ev || typeof ev !== 'object';
          IC.feed = IC.bad ? null : ev;
          icNote();
        });
      }
      // (the person's last rooms, user_data `intercom`: the line under the chip's name. The first paint uses the copy the
      // sheet keeps in this browser; without a subscription for it the chip just says "Tap to Talk".)
      if (!IC.offMem) {
        IC.mem = IC.mem || icLocal();
        var sub = client.subscriptions;
        if (sub && sub.subscribeMessage) {
          var HS = window.hkSettings, msg = { type: 'frontend/subscribe_user_data', key: 'intercom' };
          var on = function (ev) {
            var v = ev && ev.value;
            if (v && typeof v === 'object') { IC.mem = v; icNote(); }
          };
          var off = HS && HS.subscribe ? HS.subscribe(sub, msg, on, 'hkIntercomEntry') : (sub.subscribeMessage(on, msg).catch(function () { /* the local copy stands */ }), function () {});
          IC.offMem = off || function () {};
        }
      }
    }
    function icUse(client, fn) {
      IC.fns.push(fn);
      IC.users++;
      icAttach(client);
      return function () {
        var i = IC.fns.indexOf(fn);
        if (i >= 0) IC.fns.splice(i, 1);
        if (--IC.users <= 0) {
          IC.users = 0;
          if (IC.offFeed) { try { IC.offFeed(); } catch (e) { /* gone */ } IC.offFeed = null; }
          if (IC.offMem) { try { IC.offMem(); } catch (e) { /* gone */ } IC.offMem = null; }
          IC.feed = null; IC.bad = false;
        }
      };
    }
    // A row asks for the feed only while its screen has the entry (`list`: chips_extra | scenes_pages) and the page has one
    function icWatch(card, board, list) {
      var want = !!(card.client && card.client.intercom && board && Array.isArray(board[list]) && board[list].indexOf('intercom') >= 0);
      if (want && !card._icOff) card._icOff = icUse(card.client, function () { card._plan(); });
      else if (!want && card._icOff) { card._icOff(); card._icOff = null; }
    }
    // one room picked, its name; several, how many ("9 Speakers": the owner, 2026-11-10, "Guest Bedroom +8" was too long); none: "Tap to Talk"
    function icLine() {
      var f = IC.feed, want = (IC.mem && Array.isArray(IC.mem.rooms)) ? IC.mem.rooms : [], ids = {};
      ((f && f.rooms) || []).forEach(function (r) { if (r && typeof r.room === 'string') ids[r.room] = String(r.name || r.room); });
      var names = want.filter(function (id, i, a) { return ids[id] && a.indexOf(id) === i; }).map(function (id) { return ids[id]; });
      if (!names.length) return 'Tap to Talk';
      return names.length > 1 ? names.length + ' Speakers' : names[0];
    }
    // null: draw nothing
    function icEntry(client) {
      if (!client || !client.intercom) return null;
      if (IC.bad || !IC.feed || IC.feed.enabled === false) return null;
      return { label: icLine() };
    }
    var ICON_INTERCOM = 'hk:microphone';

    // One kind's chip, or null when the house has none of it.
    function kindConfig(kind, client) {
      var tap = nav(kindPage(kind));
      var n = function (k) { return found(k, client); };
      switch (kind) {
        // (a screen adds it from More, so it is not in KIND_ORDER -- never part of Automatic; rowPlan draws it, icEntry)
        case 'intercom':
          return { name: 'Intercom', icon: ICON_INTERCOM, label: 'Tap to Talk', icon_color: 'white', tap_action: { action: 'intercom' } };
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
        // LAUNDRY (phase 22, hk-laundry.js): while a machine runs, waits to be unloaded or needs a look -- "24 min left", "Done",
        // "2 Running"; a tap opens the laundry sheet. Quiet by default: there only while it says something
        case 'laundry': {
          var LL = window.hkLaundry;
          if (!LL || !LL.machines(client).length) return null;
          return { name: 'Laundry', icon: 'hk:washing-machine', count: { laundry: true }, zero: 'Off', icon_color_states: { zero: 'gray', nonzero: 'blue' },
            active: [{ count: { laundry: true }, above: 0 }], tap_action: { action: 'laundry' } };
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

    // what the shell and the later parts use of this one
    K.accOf = accOf; K.autoKinds = autoKinds; K.C0 = C0; K.colourFor = colourFor; K.entityChip = entityChip;
    K.entityIds = entityIds; K.expandKind = expandKind; K.found = found; K.HkChipBase = HkChipBase; K.IC = IC;
    K.icEntry = icEntry; K.icLine = icLine; K.ICON_INTERCOM = ICON_INTERCOM; K.icUse = icUse; K.icWatch = icWatch;
    K.KIND_NAMES = KIND_NAMES; K.KIND_ORDER = KIND_ORDER; K.KIND_PAGES = KIND_PAGES; K.kindConfig = kindConfig;
    K.kindsLive = kindsLive; K.labelFor = labelFor; K.OPEN = OPEN; K.passes = passes; K.pick = pick;
    K.QUIET_DEFAULT = QUIET_DEFAULT; K.ruleValue = ruleValue; K.S = S; K.tileToken = tileToken; K.valueOf = valueOf;
  };
})();
