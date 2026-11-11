// hk-tile-helpers.js - the tiles' helpers, the editor's schema and the labels.
//
// PART OF THE TILE CARDS (hk-tile.js). Not a card and not run on its own: it registers one
// function, which hk-tile.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkTileParts = window.hkTileParts || {})['hk-tile-helpers'] = function (K) {
    // THE COLOUR MAP: hk-base.js's icon palette (hkCards.PALETTE.icon). It
    // feeds several properties (the well's background, the glyph's colour) --
    // which is why it lives in one place.
    var NAME_MAP = window.hkCards.PALETTE.icon;

    var DOMAIN_MAP = {
      light: NAME_MAP.yellow,
      switch: NAME_MAP.orange,
      fan: NAME_MAP.blue,
      cover: NAME_MAP.blue,
      lock: NAME_MAP.green,
      climate: NAME_MAP.red,
      input_button: NAME_MAP.purple,
      media_player: NAME_MAP.red,
      sensor: NAME_MAP.blue,
      weather: NAME_MAP.yellow,
      script: NAME_MAP.purple
    };

    // The states that light a tile: 'on', and every state that means open,
    // unlocked, armed or busy.
    var ON_STATES = [
      'on',
      'open', 'opening', 'closing',
      'unlocked',
      'armed_home', 'armed_away', 'armed_night', 'armed_vacation',
      'cleaning', 'returning', 'paused'
    ];

    var LAYOUTS = {
      action:    '"i n"',
      standard:  '"i n" "i l"',
      favourite: '"i room" "i n" "i l"',
      tall:      '"i" "." "n" "l"',
      // THE THERMOSTATS PUT THE TEMPERATURE WHERE THE GLYPH GOES. Same two
      // shapes as above with `i` swapped for `temp`; the well is display:none
      // under .climate so it takes no track.
      climate:      '"temp room" "temp n" "temp l"',
      climate_tall: '"temp" "." "n" "l"',
      // a thermostat as a regular pill (size: regular): the favourite's shape
      // without its room line
      climate_pill: '"temp n" "temp l"'
    };
    // THE TILE'S HEIGHT, A CHOICE (`size`, 2026-10-01): any tile can be tall
    // or regular, whatever its card draws by default -- a light as a tall tile,
    // a lock as a pill. The layout swaps for its other-height twin; the grid
    // cell it sits in is the dashboard's to size (`view_layout: {grid-row:
    // span 2}`, which the generated dashboard sets from the accessory's Size).
    var TALL_OF = { standard: 'tall', action: 'tall', climate: 'climate_tall', climate_pill: 'climate_tall' };
    var SHORT_OF = { tall: 'standard', climate_tall: 'climate_pill' };
    function sizedLayout(layout, size) {
      if (size === 'tall') return TALL_OF[layout] || layout;
      if (size === 'regular') return SHORT_OF[layout] || layout;
      return layout;
    }

    // THE ONE COLOUR MAP: a named colour maps, an arbitrary CSS colour passes
    // through, otherwise the domain decides. The same expression feeds the
    // well and the glyph, which is why it is one function here.
    function colourFor(cfg, stateObj) {
      var override = cfg.icon_color ? String(cfg.icon_color).toLowerCase().trim() : '';
      if (override) return NAME_MAP[override] || cfg.icon_color;
      var d = stateObj && stateObj.entity_id ? stateObj.entity_id.split('.')[0] : '';
      return DOMAIN_MAP[d] || NAME_MAP.gray;
    }

    // A COLOUR AS #rrggbb, for a gradient of it (hkCards.iconGradient): a hex,
    // an rgb()/rgba() (the palette's own), or a palette name; null otherwise
    function hexOf(c) {
      var s = String(c || '').trim().toLowerCase();
      if (NAME_MAP[s]) s = String(NAME_MAP[s]).toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(s)) return s;
      var m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
      if (!m) return null;
      return '#' + [m[1], m[2], m[3]].map(function (x) { var n = Math.max(0, Math.min(255, +x)); return (n < 16 ? '0' : '') + n.toString(16); }).join('');
    }
    // A COLOUR FOR SOMETHING THAT HAS NONE OF ITS OWN (a scene no one gave a
    // Color): one of the app icons' tints, the same one every time for the same
    // scene, so Movie Night is one color in every block (2026-10-31)
    function ownTint(key) {
      var s = String(key || ''), h = 0, C = window.hkCards;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      var name = C.roomTint ? C.roomTint(Math.abs(h)) : 'purple';
      return (C.ACCENTS && C.ACCENTS[name]) || '#bf5af2';
    }

    // THE LEVEL A TALL BLOCK DRAGS (2026-11-07, the review: an Accessory's T size, HomeView's Tall tile): what an
    // accessory has that runs from 0 to 100 -- a light's brightness, a fan's speed, a shade's position, a speaker's
    // volume -- and the calls that set it and toggle it (through the card's action port, HkBase._call). null: nothing
    // to drag (a switch, a lock, a door), the tile stays a tall tile that toggles.
    var DOOR_CLASSES = { garage: 1, gate: 1, door: 1 };
    function levelOf(id, st) {
      if (!id || !st || st.state === 'unavailable' || st.state === 'unknown') return null;
      var d = String(id).split('.')[0], a = st.attributes || {}, f = Number(a.supported_features) || 0, n = function (x) { return typeof x === 'number' && isFinite(x); };
      var data = function (extra) { return Object.assign({ entity_id: id }, extra); };
      if (d === 'light') {
        var modes = a.supported_color_modes;
        if (!(Array.isArray(modes) ? modes.some(function (m) { return m !== 'onoff'; }) : n(a.brightness))) return null;
        return { what: 'brightness', pct: st.state === 'on' ? (n(a.brightness) ? Math.max(1, Math.round(a.brightness / 2.55)) : 100) : 0,
                 set: function (p) { return p <= 0 ? ['light', 'turn_off', data()] : ['light', 'turn_on', data({ brightness_pct: p })]; },
                 toggle: ['homeassistant', 'toggle', data()] };
      }
      if (d === 'fan') {
        if (!(n(a.percentage) || (f & 1))) return null;
        return { what: 'speed', pct: st.state === 'on' ? Math.round(Number(a.percentage) || 0) : 0,
                 set: function (p) { return p <= 0 ? ['fan', 'turn_off', data()] : ['fan', 'set_percentage', data({ percentage: p })]; },
                 toggle: ['homeassistant', 'toggle', data()] };
      }
      if (d === 'cover') {
        if (DOOR_CLASSES[a.device_class] || !(n(a.current_position) || (f & 4))) return null;
        return { what: 'position', pct: Math.round(Number(a.current_position) || (st.state === 'open' ? 100 : 0)),
                 set: function (p) { return ['cover', 'set_cover_position', data({ position: p })]; },
                 toggle: ['cover', 'toggle', data()], words: ['Closed', 'Open'] };
      }
      if (d === 'media_player') {
        if (!(n(a.volume_level) || (f & 4))) return null;
        return { what: 'volume', pct: Math.round((Number(a.volume_level) || 0) * 100), off: st.state === 'off' || st.state === 'standby',
                 set: function (p) { return ['media_player', 'volume_set', data({ volume_level: p / 100 })]; },
                 toggle: ['media_player', 'volume_mute', data({ is_volume_muted: !a.is_volume_muted })] };
      }
      return null;
    }
    // a light's own color, as css, unless it is near white (on the white plate it would not show)
    function lightRgb(st) {
      var c = st && st.state === 'on' && st.attributes && st.attributes.rgb_color;
      if (!Array.isArray(c) || c.length < 3) return null;
      return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.85 ? null : 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }

    // BARE_ICON IS AN ON-STATE RULE ONLY, and getting this wrong is invisible
    // until something is playing. Transparency belongs to the ON state's well
    // colour alone -- OFF stays rgba(0,0,0,0.14). A card that wants a
    // well-less glyph while OFF says so itself with `well_background:
    // transparent`.
    // (the look's well first -- Tinted's Dark or Light, hk-settings.js --
    // then the page's: a light page's gray, the theme's; the literal last)
    var OFF_WELL = 'var(--hk-look-well, ' + window.hkCards.v('well-bg') + ')';
    function wellColour(cfg, stateObj, on) {
      if (!on) return OFF_WELL;
      if (cfg.bare_icon) return 'transparent';
      return window.hkCards.flatColor(colourFor(cfg, stateObj), 'well');
    }

    // OFF uses the same map as the well. ON is white unless the glyph is bare,
    // in which case bare_icon_color wins -- that is the only place it applies.
    // `off_icon_color`: the glyph's own color while off, where the lit color
    // would alarm (a quiet leak sensor's drop is calm blue; its leak is red)
    function iconColour(cfg, stateObj, on) {
      if (!on && cfg.off_icon_color) {
        var o = String(cfg.off_icon_color).toLowerCase().trim();
        return window.hkCards.flatColor(NAME_MAP[o] || cfg.off_icon_color, 'glyph');
      }
      // (Bright Glass, 2026-10-30: white, the background supplies the color --
      // --hk-look-glyph-off, unset in every other look)
      if (!on) return 'var(--hk-look-glyph-off, ' + window.hkCards.flatColor(colourFor(cfg, stateObj), 'glyph') + ')';
      // A WHITE OWN COLOR ON THE WHITE PLATE (2026-11-09, the owner: a tapped Routines button's glyph vanished): a lit tile's
      // plate is white, so a glyph that is white -- an input_button or a light given `icon_color: white` -- takes the lit
      // tiles' near-black for as long as it is lit (a tap's PRESS_MS too), bare or on its own white circle
      var own = cfg.bare_icon ? (cfg.bare_icon_color || colourFor(cfg, stateObj)) : colourFor(cfg, stateObj);
      if (nearWhite(own)) return 'rgba(0, 0, 0, 0.95)';
      if (!cfg.bare_icon) return 'white';
      // (lit and bare: Flat's Light takes the bright color, hk-base flatColor)
      return window.hkCards.flatColor(own, 'on');
    }
    // a color (a #rrggbb, an rgb()/rgba(), a palette name) the white plate would swallow: luminance over 0.85, as lightRgb's
    function nearWhite(c) {
      var h = hexOf(c);
      if (!h) return false;
      var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.85;
    }

    // TWO LEVELS, not one:
    //
    //   hk-plate#card  material box -- flex, overflow:hidden, text-align:center
    //     div.grid     the grid -- areas, gaps, align-content:center
    //       .well / .name / .label
    //
    // The material box centres and the grid lays out: one element cannot be
    // both a flex box and a grid box.
    //
    // <hk-plate> rather than a div: it carries the card plate's styling (HA's
    // ha-card rules under HK's name, elements/hk-elements.js) and the
    // --ha-card-* variables, as every HK card's plate does.
    var TILE = window.hkCards.TILE;
    // THE WIDE TILE, CENTERED (2026-11-07, the owner: every block uses its space and keeps equal margins all the way
    // round; a Scene, an Accessory and the Intercom at Wide are one layout): HomeView's tile laid sideways -- the glyph
    // bare at the size the Small tile draws it on that cell (TILE.centred: 64 on tiles, 82 on square cells), its box
    // centered on a third of the block's width (a quarter left the pair 70 px from the left and 140 from the right; a third balances a name of usual length -- 2026-11-07); the name over the room or
    // state (17 / 16 on tiles, 21 / 20 on
    // squares: the Small tile's) left-aligned a gutter (16 px) right of the glyph's box, the pair centered on the glyph's
    // middle, ending in an ellipsis at the block's right inset (--hk-pad-r). `s`: { host, well, icon, name, sub (a list),
    // temp (a thermostat's reading, in the glyph's place) } -- as hkCards.centredTile's, over its rules.
    // (a sensor's reading for a Centered tile's glyph: a temperature rounded with its degree, a humidity with its percent)
    function readingOf(id, st) {
      var n = st ? Number(st.state) : NaN, dc = st && st.attributes && st.attributes.device_class;
      if (String(id || '').indexOf('sensor.') !== 0 || !st || st.state === '' || isNaN(n)) return null;
      return dc === 'temperature' ? Math.round(n) + '\u00b0' : dc === 'humidity' ? Math.round(n) + '%' : null;
    }
    function wideTile(s) {
      var C0 = window.hkCards.TILE.centred, I = ' !important';
      var at = function (parts) { return parts.map(function (p) { return s.host + ' ' + p; }).join(','); };
      var one = function (g) {
        var left = 'calc(33.33% + ' + (g.box / 2 + 16) + 'px)' + I;
        var text = 'left:' + left + ';right:var(--hk-pad-r,14px)' + I + ';text-align:left' + I + ';line-height:' + g.line + 'px' + I;
        return at([s.well]) + '{left:33.33%' + I + ';top:50%' + I + ';width:' + g.box + 'px' + I + ';height:' + g.box + 'px' + I + '}' +
          at([s.icon]) + '{width:' + g.glyph + 'px' + I + ';height:' + g.glyph + 'px' + I + '}' +
          at([s.name]) + '{' + text + ';top:calc(50% - ' + g.line + 'px)' + I + ';font-size:' + g.name + 'px' + I + '}' +
          at(s.sub) + '{' + text + ';top:50%' + I + ';font-size:' + g.sub + 'px' + I + '}' +
          (s.temp ? at([s.temp]) + '{left:33.33%' + I + ';top:50%' + I + '}' : '');
      };
      return one(C0.tall) + '@container hk-cell (min-height:180px) or style(--hk-cell-shape: square){' + one(C0.square) + '}';
    }

    // THE TINY TILE, CENTERED (2026-11-08, the owner: "a half height accessory card on its own"; then "We don't have to have the
    // circle/well ... leave room for a bigger glyph ... it has to look like it belongs"): HomeView's tile in half a cell -- the
    // glyph bare (DESIGN.md: never in a circle or well), as large as the half's height lets it (56 % of it, 40 to 52 px: 40 on a
    // 70 px half of a tile cell, 51 on a square cell's), a block's inset from the left; the name over the state (the short
    // tile's 17 / 16 on 21 px lines) a gutter right of it, left-aligned, the pair centered on the height as one ("your 2 line
    // names with status also aren't vertically aligned"): the tile's own grid, not the centered tile's absolute places. A
    // square cell's half (84 px or more) gives a name two lines -- not under a block's page dots ("it should just default to 1
    // line truncated there")
    function tinyTile(s) {
      var g = window.hkCards.TILE.centred.short, I = ' !important', box = 'calc(var(--hk-tg) + 6px)';
      var at = function (parts, host) { return parts.map(function (p) { return (host || s.host) + ' ' + p; }).join(','); };
      var flow = 'position:static' + I + ';transform:none' + I + ';left:auto' + I + ';right:auto' + I + ';top:auto' + I + ';bottom:auto' + I + ';margin:0' + I;
      var text = flow + ';text-align:left' + I + ';line-height:' + g.line + 'px' + I + ';white-space:nowrap' + I + ';overflow:hidden;text-overflow:ellipsis;min-width:0';
      return s.host.replace(/\)$/, ':not([data-group-pill]))') + '{--hk-tg:clamp(40px,56cqh,52px)}' +
        at([s.plate]) + '{padding:0 var(--hk-pad-r,14px) 0 var(--hk-pad-l,14px)' + I + '}' +
        // (the glyph off the grid, centered on the height a block's inset in -- in the grid it stretched one-line rows apart)
        at([s.grid]) + '{display:grid' + I + ';height:100%' + I + ';grid-template-columns:' + box + ' minmax(0,1fr)' + I + ';grid-template-rows:auto auto' + I +
          ';grid-template-areas:". n" ". l"' + I + ';column-gap:14px' + I + ';row-gap:0' + I + ';align-content:center' + I + '}' +
        at([s.well]) + '{position:absolute' + I + ';left:calc(var(--hk-pad-l,14px) + var(--hk-tg) / 2 + 3px)' + I + ';top:50%' + I + ';translate:-50% -50%' + I +
          ';width:' + box + I + ';height:' + box + I + '}' +
        at([s.icon]) + '{width:var(--hk-tg)' + I + ';height:var(--hk-tg)' + I + '}' +
        at([s.name]) + '{' + text + ';grid-area:n' + I + ';font-size:' + g.name + 'px' + I + '}' +
        at(s.sub) + '{' + text + ';grid-area:l' + I + ';font-size:' + g.sub + 'px' + I + '}' +
        (s.temp ? at([s.temp]) + '{position:absolute' + I + ';left:calc(var(--hk-pad-l,14px) + var(--hk-tg) / 2 + 3px)' + I + ';top:50%' + I + ';translate:-50% -50%' + I + ';font-size:22px' + I +
          '}' : '') +
        '@container hk-cell (min-height:84px){' + at([s.name], s.host.replace(/\)$/, ':not([data-grid-pager]):not([data-group-pill]))')) + '{white-space:normal' + I +
          ';display:-webkit-box' + I + ';-webkit-line-clamp:2;-webkit-box-orient:vertical}}';
    }

    // THE TALL TILE'S TOPS (Centered, a level under the words): from the block's top inset (--hk-pad-t) the glyph's box
    // (g.box), the name a gutter under it, the second line a line under that, the capsule 10 px under that -- g: a cell's
    // numbers (TILE.centred.tall / .square), `pad`: that cell's inset, `q`: the container query it holds for ('' for tiles)
    function levelTile(g, pad, q) {
      var H = ':host([tile=centred][level][size=T])', T = 'calc(var(--hk-pad-t,' + pad + 'px) + ', I = ' !important', name = g.box + 6;
      var css = H + ' .lvl{position:absolute;margin:0;left:var(--hk-pad-l,' + pad + 'px);right:var(--hk-pad-r,' + pad + 'px);bottom:var(--hk-pad-b,' + pad + 'px);top:' + T + (name + 2 * g.line + 10) +
        'px)}' +
        H + ' .well{top:' + T + g.box / 2 + 'px)' + I + '}' +
        H + ' .name{top:' + T + name + 'px)' + I + '}' +
        H + ' .label,' + H + ' .room{top:' + T + (name + g.line) + 'px)' + I + '}';
      return q ? q + '{' + css + '}' : css;
    }
    // THE WIDE TILE'S WORDS (Centered, a level beside them): the glyph, the name and the second line stacked as the Tall's
    // (g: the cell's numbers, TILE.centred.tall / .square) and centered on the plate's height, each centered in the column left
    // of the capsule -- from the block's inset (--hk-pad-l, `pad` by default) to a gutter (10 px) short of the capsule's left edge
    // (--hk-wcol); a name too long for it ends in an ellipsis
    function wideLevelTile(g, pad, q) {
      var H = ':host([tile=centred][level][size=W])', I = ' !important', total = g.box + 6 + 2 * g.line,
          T = 'calc(50% - ' + total / 2 + 'px + ', name = g.box + 6, col = 'left:var(--hk-pad-l,' + pad + 'px)' + I + ';right:calc(100% - var(--hk-wcol) + 10px)' + I + ';text-align:center' + I;
      var css = H + ' .well{left:calc((var(--hk-pad-l,' + pad + 'px) + var(--hk-wcol) - 10px) / 2)' + I + ';top:' + T + g.box / 2 + 'px)' + I + '}' +
        H + ' .name{' + col + ';top:' + T + name + 'px)' + I + '}' +
        H + ' .label,' + H + ' .room{' + col + ';top:' + T + (name + g.line) + 'px)' + I + '}';
      return q ? q + '{' + css + '}' : css;
    }

    // ---------------------------------------------------------------- cards
    // One class per kind of tile. They are SUBCLASSES, not options on one
    // card, because the per-kind deltas are real: see the scene note above.
    // A subclass is ~15 lines and its
    // differences are legible; an options bag covering all of them would not be.

    // ------------------------------------------------------------- editors
    // One schema shared by the whole tile family, plus the per-card
    // deltas. Kept deliberately short: these configs are often written by
    // hand, and a card needing a scrollbar of options is a card with
    // too many options.
    var C = window.hkCards;
    // The dropdown in every tile editor. `brightness` and `humidity` read
    // ATTRIBUTES rather than mapping the state, which is why they are handled
    // before the state->text table -- but they are still label modes and belong
    // in the list. `source_first` is media-only and lives in that card's schema.
    var LABEL_MODE_VALUES = ['on_off', 'state', 'sentence', 'title',
                             'on_off_sentence', 'open_closed', 'leak', 'alarm',
                             'brightness', 'humidity', 'vacuum', 'laundry', 'position',
                             'duration', 'group_brightness', 'group_count',
                             'setpoint', 'setpoint_verb'];

    // THE TILE EDITOR, grouped the way HA's own tile editor is: what the tile
    // IS up top, then Appearance, Group and Interactions as collapsible
    // sections. Everything stays flat in the YAML.
    //
    // labelModes: omit for the full list; [] when the card computes its own
    // status text (light, fan, cover) -- the field is then LEFT OUT, not shown
    // as a Status text dropdown with no options in it (and `[] || x` would
    // keep the empty array: an array is truthy).
    // appearanceExtra: fields that belong with the icon (circle colour, well,
    // animation); extraTop: fields that belong beside the name (room line).
    // opts (the per-card deltas the shared schema cannot guess):
    //   domains   the entity picker's filter -- a light tile offers lights.
    //             Omitted: any entity (the plain, tall and favorite tiles).
    //   climate   a thermostat tile: no icon circle (CSS hides .well) and lit
    //             by its own _isOn, so the icon, Group and icon-tap fields
    //             would edit nothing. The code still reads them; only the
    //             editor leaves them out.
    //   map       offer label_map / label_default -- only where the status
    //             text goes through HkTileCard's state->text table (a light,
    //             fan or cover tile computes its own and never reads them).
    //   spin      offer `animation` -- a switch drawn as a fan spins too.
    function tileSchema(extraTop, labelModes, appearanceExtra, opts) {
      opts = opts || {};
      var pick = opts.domains
        ? { filter: opts.domains.map(function (d) { return { domain: d }; }) } : {};
      var top = [
        { name: 'entity', required: true, selector: { entity: pick } },
        { type: 'grid', name: '', schema: [
          { name: 'name', selector: { text: {} } }
        ].concat(extraTop || []) }
      ];
      var modes = labelModes === undefined ? LABEL_MODE_VALUES : labelModes;
      if (modes.length) {
        top.push({ type: 'grid', name: '', schema: [
          { name: 'label_mode', selector: C.selOptions(modes) },
          { name: 'label', selector: { text: {} } }
        ] });
      } else {
        top.push({ name: 'label', selector: { text: {} } });
      }
      // OFF-BY-DEFAULT EXTRAS, folded away: a hand-written map, the detail
      // sheet switch, the spin.
      var advanced = [];
      if (opts.map) {
        advanced.push(
          { name: 'label_map', label: 'Status Text for Each State',
            helper: 'A state -> text map, e.g. on: Running. Replaces the Status Text choice\'s own map.',
            selector: { object: {} } },
          { name: 'label_default', label: 'Status Text Fallback',
            helper: 'For a state the map does not list: fixed text, or sentence, title or spaces to reword the state.',
            selector: { text: {} } });
      }
      if (opts.spin) {
        advanced.push({ name: 'animation', label: 'Icon Animation',
          helper: 'Spin: the icon turns while it is on, for a fan on a switch.',
          selector: C.selOptions(['spin', 'none']) });
      }
      advanced.push({ name: 'detail', label: 'Detail Sheet', default: true,
        helper: 'Off: a tap does what Tap Action says, never the HK sheet.',
        selector: { boolean: {} } });

      if (opts.climate) {
        // the temperature stands where the icon would: size is all there is
        return top.concat([
          C.section('Appearance', [
            { name: 'size', selector: C.selOptions(['regular', 'tall']) }
          ].concat(appearanceExtra || []), 'mdi:palette'),
          C.section('Interactions', [
            { name: 'tap_action', selector: { ui_action: {} } }
          ], 'mdi:gesture-tap'),
          C.section('Advanced', advanced, 'mdi:cog')
        ]);
      }
      return top.concat([
        C.section('Appearance', [
          { type: 'grid', name: '', schema: [
            { name: 'icon', selector: { icon: {} } },
            { name: 'icon_color', selector: C.selColour() },
            { name: 'icon_size', selector: { text: {} } },
            { name: 'bare_icon', selector: { boolean: {} } },
            { name: 'size', selector: C.selOptions(['regular', 'tall']) }
          ].concat(appearanceExtra || []) },
          // A state -> icon map. An object selector (a small YAML editor) rather
          // than a bespoke row builder: the map is two or three lines and this is
          // the one place a free-form shape is honest.
          { name: 'icon_states', selector: { object: {} } }
        ], 'mdi:palette'),
        // A tile standing for SEVERAL entities: the group_* status texts read
        // these, and group_lit: any lights the plate when any member is on.
        C.section('Group', [
          { name: 'group', selector: { entity: { multiple: true } } },
          { name: 'group_lit', selector: C.selOptions(['entity', 'any']) }
        ], 'mdi:group'),
        // The split tap target: the Home app toggles from the glyph and opens detail
        // from the rest of the pill. Its own two actions, so the card can say so.
        C.section('Interactions', [
          { name: 'tap_action', selector: { ui_action: {} } },
          { name: 'icon_tap_action', selector: { ui_action: {} } }
        ], 'mdi:gesture-tap'),
        C.section('Advanced', advanced, 'mdi:cog')
      ]);
    }

    // ------------------------------------------------------------ label modes
    //
    // Most status texts are ONE shape: a state->text map with a fallback. So
    // each is a named mode rather than a map repeated in every config -- these
    // files are often authored by hand, and an eight-entry map per tile reads
    // badly.
    //
    // `label_map` and `label_default` are the mechanism underneath, for anything
    // a preset does not cover. A default of 'sentence', 'title' or 'spaces' is a
    // transform of the state; anything else is a literal.
    var LOCK_MAP = {
      on: 'On', off: 'Off', open: 'Open', opening: 'Open',
      closed: 'Closed', closing: 'Closed', unlocked: 'Unlocked', locked: 'Locked'
    };
    var LABEL_MODES = {
      // `entity.state === 'on' ? 'On' : 'Off'` -- note that anything NOT on,
      // including unavailable, reads "Off". That is intended.
      on_off: { map: { on: 'On' }, dflt: 'Off' },
      state: { map: LOCK_MAP, dflt: 'title' },
      sentence: { map: {}, dflt: 'sentence' },
      title: { map: {}, dflt: 'title' },
      on_off_sentence: { map: { on: 'On', off: 'Off' }, dflt: 'sentence' },
      // `brightness` and `humidity` are handled before this table -- they read
      // attributes, not just the state, so they are not state->text maps.
      open_closed: { map: { on: 'Open', off: 'Closed' }, dflt: 'sentence' },
      // MOISTURE. The default is deliberately NOT 'sentence' -- it would render
      // "Unknown", and for many leak sensors unknown is the ORDINARY state, not
      // a fault. Sleepy battery Zigbee devices only report on a
      // change, so they sit at `unknown` from one restart to the next and read
      // that way for days at a time. "No Report" says the honest thing (nothing
      // has come in) without implying the device is broken. The distinction
      // matters because it is the whole reason the Water page can be a status
      // list at all.
      leak: { map: { on: 'Leak Detected', off: 'Dry' }, dflt: 'No Report' },
      alarm: {
        map: {
          armed_home: 'Home', armed_away: 'Away', armed_night: 'Night',
          armed_vacation: 'Vacation', armed_custom_bypass: 'Custom',
          disarmed: 'Off', triggered: 'Triggered', arming: 'Arming',
          pending: 'Pending', unavailable: 'Unavailable'
        },
        // Underscores to spaces, with NO capitalisation -- the alarm mode is the
        // only one that does not title-case its fallback.
        dflt: 'spaces'
      },
      // THE VACUUMS. `docked` and `idle` both read "Ready": on a wall tile the
      // useful distinction is "will start when asked" against "is working", and
      // a robot sitting on its dock is no more or less ready than one parked
      // mid-floor. Anything unlisted title-cases, so a new firmware state shows
      // up legibly instead of vanishing.
      vacuum: {
        map: {
          cleaning: 'Cleaning', returning: 'Returning', paused: 'Paused',
          docked: 'Ready', idle: 'Ready', error: 'Error'
        },
        dflt: 'title'
      }
    };

    // Every hvac_mode that means "make it warmer". `eco`, `performance`, `gas`
    // and `electric` are water-heater modes -- the same card draws those.
    var HEAT_STATES = ['heat', 'heat_pump', 'eco', 'performance', 'gas', 'electric'];

    // THE TEMPERATURE'S INK TRACKS WHAT THE SYSTEM IS DOING, not what it is set
    // to: blue while the compressor runs, red while the heat does, and the
    // ordinary text colour when it is simply holding. hvac_action, not state --
    // a thermostat set to `heat` and idle is not heating right now.
    function tempColour(st, on) {
      var action = st && st.attributes && st.attributes.hvac_action;
      if (action === 'cooling') return 'rgba(86, 189, 228, 0.98)';
      if (action === 'heating') return 'rgba(255, 69, 58, 0.98)';
      return on ? 'rgba(0, 0, 0, 0.92)' : '' + window.hkCards.v('ink') + '';
    }

    var sentence = C.sentenceCase;
    function titled(s) {
      return String(s).replace(/_/g, ' ').split(' ')
        .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
        .join(' ');
    }

    // The light tile's status: brightness while on. The rule lives here once,
    // not in every light's config.
    //
    // Also reachable as `label_mode: brightness` on any tile, because the
    // favourites row wants a light's brightness on a FAVOURITE tile (which has a
    // room line and so is not an hk-light-card).
    function brightnessLabel(st) {
      var s = (st && st.state) || 'unknown';
      if (s === 'unknown' || s === 'unavailable') return titled(s);
      if (s === 'on') {
        var b = st.attributes && st.attributes.brightness;
        if (b !== undefined && b !== null && !isNaN(Number(b))) {
          return Math.round((Number(b) / 255) * 100) + '%';
        }
      }
      return s === 'on' ? 'On' : 'Off';
    }

    // what the shell and the later parts use of this one
    K.brightnessLabel = brightnessLabel; K.C = C; K.colourFor = colourFor; K.HEAT_STATES = HEAT_STATES;
    K.hexOf = hexOf; K.iconColour = iconColour; K.LABEL_MODES = LABEL_MODES; K.LAYOUTS = LAYOUTS; K.levelOf = levelOf;
    K.levelTile = levelTile; K.lightRgb = lightRgb; K.NAME_MAP = NAME_MAP; K.OFF_WELL = OFF_WELL;
    K.ON_STATES = ON_STATES; K.ownTint = ownTint; K.readingOf = readingOf; K.sentence = sentence;
    K.sizedLayout = sizedLayout; K.tempColour = tempColour; K.TILE = TILE; K.tileSchema = tileSchema;
    K.tinyTile = tinyTile; K.titled = titled; K.wellColour = wellColour; K.wideLevelTile = wideLevelTile;
    K.wideTile = wideTile;
  };
})();
