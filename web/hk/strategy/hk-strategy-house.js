// hk-strategy-house.js - the house: its kinds, tiles and names.
//
// PART OF THE DASHBOARD STRATEGY (hk-strategy.js). Not a card and not run on its own: it registers one
// function, which hk-strategy.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkStrategyParts = window.hkStrategyParts || {})['hk-strategy-house'] = function (K) {
    // THE PILL'S NUMBERS are hk-base.js's (hkCards.TILE: the pill's width, its
    // grid row, the gap between pills), read when a page is built -- never at
    // load: hk-base.js is a parallel-loaded resource, and generate() waits for
    // it (cardsReady below).
    function TL() { return window.hkCards.TILE; }
    // LOVELACE'S OBJECT -> THE CLIENT, at each entry (null for neither). A
    // client is taken as it is; anything else goes through the host adapter
    // (hkHostClient, loaded at bootstrap before this file), which makes one
    // client per object -- so a cache keyed on what a build was handed keeps
    // its identity. Not hkCards.asClient: shouldRegenerate can run before
    // hk-base.js has loaded.
    function clientOf(input) {
      if (!input) return null;
      var K = window.hkClient, H = window.hkHostClient;
      if (K && typeof K.is === 'function' && K.is(input)) return input;
      return H && typeof H.from === 'function' ? H.from(input) : null;
    }
    function cardsReady() {
      if (window.hkCards && window.hkCards.TILE) return Promise.resolve();
      // its readiness EVENT, never a poll: a hidden tab throttles timers
      return new Promise(function (res) {
        window.addEventListener('hk-cards-ready', function () { res(); }, { once: true });
      });
    }
    // A GRID OF PILLS. `space`: from the last pill's bottom to whatever comes
    // next -- a room's section 19 px, the favorites 17, the Climate rooms 27.
    // The grid's bottom padding is what the last row doesn't already leave
    // under its pill: a row is the pill, the 4 px top margin every grid child
    // has, and the rest below it (6 px in an 80 px row). `three`: three-line
    // pills (the favorites, Doors & Windows), on their own taller row.
    function pillGrid(space, three) {
      var T = TL(), row = three ? T.favRow : T.row, h = three ? T.fav : T.h;
      return {
        'grid-template-columns': 'repeat(auto-fill, var(--hk-track, ' + T.w + 'px))',
        'grid-auto-rows': row + 'px',
        'grid-auto-flow': 'dense',
        'grid-column-gap': T.gridGap + 'px',
        'grid-row-gap': '0px',
        margin: '0px',
        // (--hk-pill-end: a phone's pills bleed 8 px right into the next
        // track -- hk-tile.js -- and the last one into the page's edge; the
        // grid keeps that room so the edge matches the left: DESIGN.md "Page edges")
        padding: '0px var(--hk-pill-end, 0px) ' + (space - (row - h - 4)) + 'px 0px'
      };
    }
    // THE PAGE'S SIDE MARGINS: --hk-side of the page's width on each side
    // (css/hk-responsive.css: 2 % on a phone and in the car, 1.5 % from 641 px
    // up -- 19.2 px at 1,280, room for six of the Home app's 196 px pills), the
    // content between. A fraction, not a percentage, so the gutter clamps
    // (hk-layout.js, hk-row.js) can multiply the page's width by it too.
    var SIDE = 'calc(var(--hk-side, 0.02) * 100%)';
    var VIEW_LAYOUT = {
      'grid-template-columns': SIDE + ' calc(100% - 2 * var(--hk-side, 0.02) * 100%) ' + SIDE,
      'grid-column-gap': '0px', 'grid-row-gap': '0px',
      margin: '0px', padding: '0px', 'grid-auto-flow': 'row', 'grid-auto-rows': 'auto'
    };
    var COL2 = { 'grid-column': '2' };
    var TALL = { 'grid-row': 'span 2' };
    var TEAL = 'rgba(88, 192, 206, 0.98)';

    // Measured glyph boxes: each glyph's size in the tile's well, measured against
    // the Home app, not guessed. An unlisted glyph keeps the card default -- so
    // every glyph the accessory gear offers belongs here, or a Fire or Sword
    // picked there draws at the flat 23 px default.
    var PX = {
      'blinds-horizontal': 26, 'blinds-horizontal-closed': 26, 'ceiling-light': 28,
      chandelier: 32, 'desk-lamp': 30, 'floor-lamp': 30, lamp: 30, 'led-strip-variant': 27,
      'light-recessed': 32, lightbulb: 28, 'lightbulb-group': 42, 'lightbulb-multiple': 28,
      lock: 23, 'lock-open-variant': 24, 'outdoor-lamp': 30, 'power-socket-us': 21,
      'string-lights': 30, 'vanity-light': 32, 'wall-sconce': 26, coffee: 26,
      'motion-sensor': 31, garage: 26, 'garage-open': 26, 'air-humidifier': 31,
      'robot-vacuum': 38, 'alarm-light-off': 27, television: 29,
      amplifier: 25, bed: 32, 'blinds-open': 26, 'desktop-tower': 25, fire: 26, 'gamepad-variant': 28,
      'printer-3d': 23, 'roller-shade': 26, 'run-fast': 26, server: 26, 'server-network': 24, sword: 27,
      // the players, at the Home app's sizes
      speaker: 36, homepod: 36, 'homepod-mini': 40, 'apple-tv': 35
    };
    // THE HOME GLYPHS ADDED 2026-10-01 (Apple's Home symbols, offered by the
    // gear): NOT MEASURED against the Home app -- each is sized like its
    // nearest measured kin (a chandelier like the chandelier, a shade like the
    // blinds), so none draws at the flat 23 px. Replace one with a measurement
    // when it is taken.
    var PX_KIN = {
      'ceiling-light-multiple': 32, 'ceiling-fan': 30, 'ceiling-fan-light': 30, 'light-switch': 24,
      'lightbulb-variant': 28, 'lightbulb-fluorescent-tube': 28, 'lightbulb-spot': 28, 'wall-sconce-flat': 26,
      'fan-desk': 28, 'fan-floor': 30, 'air-purifier': 30, dehumidifier: 30, radiator: 28, fireplace: 28,
      'heat-wave': 26, 'blinds-vertical': 26, 'blinds-vertical-closed': 26, 'window-shutter': 26,
      'window-shutter-open': 26, 'roman-shade': 26, 'roman-shade-open': 26, curtains: 26, 'curtains-closed': 26,
      'window-closed': 26, 'window-open': 26, awning: 26, skylight: 26, 'door-sliding': 26, 'door-sliding-open': 26,
      'door-french': 26, 'garage-double': 26, gate: 26, 'gate-open': 26, 'lock-smart': 24, 'contact-sensor': 26,
      'smoke-detector': 30, 'molecule-co': 30, 'molecule-co2': 30, 'air-filter': 26, 'doorbell-video': 26,
      webcam: 26, bell: 24, 'power-strip': 30, 'power-plug': 26, 'gesture-tap-button': 24, remote: 24,
      sprinkler: 26, 'pipe-leak': 26, pool: 30, waves: 26, 'tumble-dryer': 25, 'toaster-oven': 26, 'pot-steam': 25,
      pot: 30, popcorn: 26, dresser: 25, seat: 26, 'audio-video': 32, projector: 32, 'remote-tv': 26,
      'television-speaker': 30, 'speaker-multiple': 30, radio: 28, 'volume-high': 26, 'router-wireless': 30,
      wifi: 26, laptop: 30, cellphone: 24, tablet: 25, watch: 24, printer: 26, 'party-popper': 26, balloon: 26,
      paw: 26, 'ev-station': 26, clock: 24, alarm: 25, 'trash-can': 24, 'homepod-pair': 48, 'homepod-mini-pair': 48,
      'homepod-and-homepod-mini': 48, 'shield-off': 24, 'shield-home': 24, 'shield-lock': 24, 'shield-alert': 24
    };
    // ON A FAVORITE, where the hand-written favorites drew a glyph at a size of
    // its own: the gamepad is 28 on a room tile (the Arcade) and was 24 on the
    // Roblocks favorite, beside its two-line room and name.
    var FAV_PX = { 'gamepad-variant': 24 };
    function sized(tile, over) {
      var g = String(tile.icon || '').replace(/^hk:/, '');
      var px = (over && over[g]) || PX[g];
      if (px) tile.icon_size = px + 'px';
      return tile;
    }

    // A GROUP's members, or null: a helper's (attributes.entity_id) or, since
    // Home Assistant 2026, any integration's -- a Hue room, a Zigbee group --
    // in attributes.group_entities.
    function membersOf(st) {
      var a = (st && st.attributes) || {};
      return Array.isArray(a.entity_id) ? a.entity_id : Array.isArray(a.group_entities) ? a.group_entities : null;
    }
    // A light's glyph from what it is called -- the one place a guess is made,
    // and only between glyphs the Home app itself uses for lights.
    function lightGlyph(st, name) {
      var n = (name || '').toLowerCase();
      if (membersOf(st)) return 'hk:lightbulb-group';
      if (/floor lamp/.test(n)) return 'hk:floor-lamp';
      if (/desk lamp/.test(n)) return 'hk:desk-lamp';
      if (/lamp/.test(n)) return 'hk:lamp';
      if (/chandelier/.test(n)) return 'hk:chandelier';
      if (/sconce/.test(n)) return 'hk:wall-sconce';
      if (/strip|led/.test(n)) return 'hk:led-strip-variant';
      if (/string|christmas|tree/.test(n)) return 'hk:string-lights';
      if (/recessed|can light|pot light/.test(n)) return 'hk:light-recessed';
      if (/vanity/.test(n)) return 'hk:vanity-light';
      if (/porch|outdoor|flood|landscape/.test(n)) return 'hk:outdoor-lamp';
      if (/ceiling/.test(n)) return 'hk:ceiling-light';
      return 'hk:lightbulb';
    }

    // THE TILE for one entity, or null for one this dashboard does not show.
    var TILE = {
      light: function (id, name, st) {
        return sized({ type: 'custom:hk-light-card', entity: id, name: name,
          icon: lightGlyph(st, name), icon_color: 'yellow', icon_tap_action: { action: 'toggle' } });
      },
      switch: function (id, name) {
        return sized({ type: 'custom:hk-tile-card', entity: id, name: name, icon: 'hk:power-socket-us',
          icon_color: 'yellow', label_mode: 'state', icon_tap_action: { action: 'toggle' } });
      },
      fan: function (id, name) {
        return { type: 'custom:hk-fan-card', entity: id, name: name, icon: 'hk:fan',
          icon_color: 'blue', icon_tap_action: { action: 'toggle' } };
      },
      cover: function (id, name, st) {
        var dc = st && st.attributes && st.attributes.device_class;
        if (dc === 'garage' || dc === 'gate') {
          return sized({ type: 'custom:hk-tall-card', entity: id, name: name, icon: 'hk:garage-open',
            icon_states: { closed: 'hk:garage' }, icon_color: 'mint', label_mode: 'title', view_layout: TALL });
        }
        return sized({ type: 'custom:hk-cover-card', entity: id, name: name, icon: 'hk:blinds-horizontal',
          icon_states: { closed: 'hk:blinds-horizontal-closed' }, icon_color: 'blue',
          icon_tap_action: { action: 'toggle' } });
      },
      lock: function (id, name) {
        return sized({ type: 'custom:hk-tall-card', entity: id, name: name, icon: 'hk:lock',
          icon_states: { unlocked: 'hk:lock-open-variant' }, icon_color: 'mint', label_mode: 'title',
          view_layout: TALL });
      },
      // THE DEVICE SAYS WHAT IT IS: a HomePod and a HomePod mini
      // are drawn as themselves, an Apple TV as the box (hk:homepod 36 px,
      // hk:homepod-mini 40 px, hk:apple-tv 35 px) -- read off the device's model.
      media_player: function (id, name, st, model) {
        var dc = st && st.attributes && st.attributes.device_class;
        var m = String(model || '').toLowerCase();
        // An Apple TV reads as the HomePods do -- its state, not the
        // televisions' source_first.
        if (/apple tv/.test(m)) {
          return { type: 'custom:hk-media-card', entity: id, name: name, icon: 'hk:apple-tv', icon_size: '35px',
            icon_color: 'rgba(255, 255, 255, 0.88)', bare_icon: true, bare_icon_color: 'rgba(152, 152, 157, 1)',
            well_background: 'transparent' };
        }
        if (dc === 'tv' || dc === 'receiver') {
          return sized({ type: 'custom:hk-media-card', entity: id, name: name, icon: 'hk:television',
            icon_color: TEAL, label_mode: 'source_first', icon_tap_action: { action: 'toggle' } });
        }
        // A speaker is drawn at 36 px like a HomePod, not at the 23 px
        // default.
        var mini = /homepod mini/.test(m), pod = !mini && /homepod/.test(m);
        return { type: 'custom:hk-media-card', entity: id, name: name,
          icon: mini ? 'hk:homepod-mini' : pod ? 'hk:homepod' : 'hk:speaker',
          icon_size: mini ? '40px' : '36px',
          icon_color: 'rgba(255, 255, 255, 0.85)', bare_icon: true,
          bare_icon_color: 'rgba(152, 152, 157, 1)', well_background: 'transparent' };
      },
      climate: function (id, name) {
        return { type: 'custom:hk-climate-tall-card', entity: id, name: name, icon_color: 'red',
          label_mode: 'setpoint_verb', view_layout: TALL };
      },
      water_heater: function (id, name) { return TILE.climate(id, name); },
      humidifier: function (id, name) {
        return sized({ type: 'custom:hk-tile-card', entity: id, name: name, icon: 'hk:air-humidifier',
          icon_states: { on: 'hk:air-humidifier-active' }, icon_color: 'blue', label_mode: 'humidity',
          icon_tap_action: { action: 'toggle' } });
      },
      vacuum: function (id, name) {
        return sized({ type: 'custom:hk-tall-card', entity: id, name: name, icon: 'hk:robot-vacuum',
          icon_color: 'rgba(242, 144, 105, 0.98)', bare_icon: true, well_background: 'transparent',
          label_mode: 'vacuum', view_layout: TALL });
      },
      valve: function (id, name) {
        return { type: 'custom:hk-tall-card', entity: id, name: name, icon: 'hk:spigot',
          icon_color: 'rgba(58, 134, 247, 0.98)', label_mode: 'title', view_layout: TALL };
      },
      // A COMPUTER'S WAKE-ON-LAN BUTTON: a tile that wakes it. Only the Wake
      // on LAN integration's buttons: every other button (a car's horn, an
      // energy meter's reset, a restart) is not a thing in a room (see isTileButton).
      button: function (id, name) {
        // "Office PC - Wake On Lan" is the Office PC
        name = String(name || '').replace(/\s*[-\u2013]?\s*wake[\s-]*on[\s-]*lan\s*$/i, '') || name;
        // A light's split: the GLYPH wakes it, the name opens its sheet (one
        // big Wake button and when it was last woken), as a light's glyph
        // toggles and its name opens its sheet.
        return sized({ type: 'custom:hk-tile-card', entity: id, name: name, icon: 'hk:desktop-tower',
          icon_color: 'yellow', label: 'Wake',
          tap_action: { action: 'more-info' },
          icon_tap_action: { action: 'perform-action', perform_action: 'button.press', target: { entity_id: id } } });
      },
      alarm_control_panel: function (id, name) {
        var glyphs = Object.assign({}, (window.hkCards && window.hkCards.ALARM_GLYPHS) || {});   // the state's shield, as everywhere (hk-security.js)
        // A tap opens the alarm's keypad sheet, as any device's tap opens its sheet.
        return sized({ type: 'custom:hk-tall-card', entity: id, name: name, icon: 'hk:shield-off',
          icon_states: glyphs, icon_color: 'mint', bare_icon: true, well_background: 'transparent',
          label_mode: 'alarm', view_layout: TALL });
      }
    };
    // THE ONE "IS THIS HIDDEN?" RULE: an excluded entity, anything on an
    // excluded device, anything in an excluded area -- read from the options
    // THIS build was given (the HK Settings page's Hidden from Screens plus the
    // dashboard's own YAML, merged in generate()). Derived per options object
    // and passed along, never kept in module state: two builds at once (the
    // editor's preview and the dashboard) cannot see each other's exclusions,
    // and a direct call (hkStrategy.rooms) uses exactly what it is given.
    var HIDES = new WeakMap();
    function hideOf(opts) {
      opts = opts || {};
      var h = HIDES.get(opts);
      if (h) return h;
      h = { entities: {}, devices: {}, areas: {}, include: {} };
      (opts.exclude_entities || []).forEach(function (e) { h.entities[e] = true; });
      (opts.exclude_devices || []).forEach(function (d) { h.devices[d] = true; });
      (opts.exclude_areas || []).forEach(function (a) { h.areas[a] = true; });
      (opts.include_entities || []).forEach(function (e) { if (!h.entities[e]) h.include[e] = true; });
      if (typeof opts === 'object') HIDES.set(opts, h);
      return h;
    }
    function areaOf(client, id) {
      var e = (client.entities || {})[id] || {}, devs = client.devices || {};
      return e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || null;
    }
    function hidden(client, opts, id) {
      var hide = hideOf(opts);
      if (hide.entities[id]) return true;
      var e = (client.entities || {})[id] || {};
      if (e.device_id && hide.devices[e.device_id]) return true;
      var a = areaOf(client, id);
      return !!(a && hide.areas[a]);
    }
    function PR() { var no = function () { return null; }; return window.hkPairs || { area: no, name: no, model: no, folded: no, learn: no }; }

    // A tile for something the house ADDED (Configure -> Also show) that has no
    // tile of its own: scenes and scripts run on a tap, buttons press, toggles
    // toggle, and anything else shows its state and opens its details.
    var ANY_ICON = { scene: 'mdi:palette', script: 'mdi:script-text-play', button: 'mdi:gesture-tap-button',
                     input_button: 'mdi:gesture-tap-button', sensor: 'mdi:eye', binary_sensor: 'mdi:checkbox-blank-circle-outline',
                     input_boolean: 'mdi:toggle-switch', automation: 'mdi:robot', person: 'mdi:account' };
    function anyTile(id, name, st) {
      var d = id.split('.')[0];
      var icon = (st && st.attributes && st.attributes.icon) || ANY_ICON[d] || 'mdi:circle-outline';
      var call = function (service) {
        return { action: 'call-service', service: service, target: { entity_id: id } };
      };
      if (d === 'scene' || d === 'script') {
        return { type: 'custom:hk-scene-card', entity: id, name: name, icon: icon, icon_color: 'white',
                 elevated: true, tap_action: call(d + '.turn_on') };
      }
      // A BUTTON is a tile with a second line, "Tap", as the accessories beside
      // it have their state (2026-10-30, the owner: an input_button "looks a bit
      // funny next to the other entities with a status line"); a tap anywhere
      // presses it, and it lights a moment (HkTileBase._momentary). In a scenes
      // row it is still a scene's pill (hk-scenes.js).
      if (d === 'button' || d === 'input_button') {
        return { type: 'custom:hk-tile-card', entity: id, name: name, icon: icon, icon_color: 'white', label: 'Tap',
                 tap_action: call(d + '.press'), icon_tap_action: call(d + '.press') };
      }
      var t = { type: 'custom:hk-tile-card', entity: id, name: name, icon: icon, icon_color: 'white',
                label_mode: 'state' };
      if (d === 'input_boolean' || d === 'automation') {
        t.icon_color = 'yellow';
        t.icon_tap_action = { action: 'toggle' };
      }
      return t;
    }
    // AN `hk:` ICON SET IN HOME ASSISTANT'S ENTITY SETTINGS is the tile's
    // glyph. Only `hk:`: other icons (mdi:, the Hue set's phu:) are chosen
    // for Home Assistant's own screens, and drawing them here matches the
    // Home app's tiles LESS often than the name guess (measured) -- the Home
    // app glyph of each accessory is a choice of its own (the accessory
    // settings). A chosen icon
    // is the icon in every state, as it is in Home Assistant, unless it IS the
    // tile's own default glyph.
    function ownIcon(icon) {
      var v = String(icon || '');
      return /^hk:/.test(v) ? v : null;
    }

    // ACCESSORY SETTINGS (Configure lives in each detail sheet's gear;
    // accessories.py): the house's own name and glyph for a thing,
    // what it is shown as, whether Home shows it, and each room's tile order.
    // They beat everything worked out here -- they are a person's choice.
    function accOf(id) {
      var A = setting('accessories');
      return (A && A.entities && A.entities[id]) || null;
    }
    function accName(id) {
      var a = accOf(id);
      if (!a) return null;
      var dash = dashSeg();
      return (a.names && a.names[dash]) || a.name || null;
    }
    function accIcon(id) {
      var a = accOf(id), v = a && a.icon ? String(a.icon) : '';
      return v ? (/^mdi:/.test(v) ? 'hk:' + v.slice(4) : v) : null;
    }
    // "Show as": a switch drawn as a light or a fan, a light as an outlet.
    var SHOW_GLYPH = { light: 'hk:lightbulb', fan: 'hk:fan', switch: 'hk:toggle-switch', outlet: 'hk:power-socket-us' };
    function INTO() {
      var A = setting('accessories');
      return (A && A.into && typeof A.into === 'object') ? A.into : {};
    }
    function roomOrder(area) {
      var A = setting('accessories'), list = A && A.rooms && A.rooms[area];
      return Array.isArray(list) ? list : null;
    }
    function tileFor(client, id, name) { return stateNames(tileOf(client, id, name), id); }
    function tileOf(client, id, name) {
      var d = id.split('.')[0];
      var e = (client.entities || {})[id], dv = e && e.device_id && (client.devices || {})[e.device_id];
      var a = accOf(id), show = a && a.show_as;
      var t, lm = window.hkLaundry && window.hkLaundry.placed(client).by[id]; if (lm) return sized(Object.assign(window.hkLaundry.tile(lm, name), { entity: id, view_layout: TALL }));
      if (show && (d === 'switch' || d === 'light' || d === 'input_boolean')) {
        // drawn as what it is shown as: a switch's tile, with that glyph and,
        // for a fan, the fans' blue
        t = TILE.switch(id, name);
        t.icon = SHOW_GLYPH[show];
        if (show === 'fan') t.icon_color = 'blue';
        if (show === 'light' && d === 'light') t = TILE.light(id, name, client.states[id]);
        delete t.icon_size;
        sized(t);
      } else {
        // a button that is not a computer's wake is the generic pressable tile
        var fn = d === 'button' && !isTileButton(e) ? anyTile : (TILE[d] || anyTile);
        t = fn(id, name, client.states[id], PR().model(client, id) || (dv && dv.model));
      }
      var own = accIcon(id) || (e && ownIcon(e.icon));
      if (t && own && 'icon' in t && own !== t.icon) {
        t.icon = own;
        delete t.icon_states;
        delete t.icon_size;
        sized(t);
      }
      // THE ACCESSORY'S SPIN (its gear, 2026-10-03): a fan's tile glyph turns
      // while it is on by DEFAULT, and a chosen icon is not always one that
      // reads as spinning -- so the setting is per accessory. Only when set:
      // a hand-written tile's own animation (the card's option) still wins on
      // a dashboard the strategy does not build, and an unset setting changes
      // nothing. For a switch drawn as a fan, the tile's own default is still,
      // so only an explicit 'spin' is new behaviour.
      if (t && a && a.anim && (d === 'fan' || show === 'fan')) t.animation = a.anim;
      // THE ACCESSORY'S COLOR (its detail sheet): one choice, worn by every
      // tile it is drawn as -- its room's, Home's, a category page's and its
      // favorite (which is built from this) -- as by its chip and its pill
      if (t && a && a.color) t.icon_color = a.color;
      if (t && t.icon_size === undefined) delete t.icon_size;
      return t && a && a.size ? resized(t, a.size) : t;
    }
    // THE ACCESSORY'S SIZE (its gear, 2026-10-01): Regular or Tall, over what
    // its kind is drawn as -- a light as a tall tile, a lock as a pill. The
    // card swaps its layout (hk-tile.js `size`); the tile's cell here spans
    // two rows of the room grid, or one.
    function resized(t, size) {
      if (size !== 'tall' && size !== 'regular') return t;
      t.size = size;
      if (size === 'tall') t.view_layout = TALL;
      else delete t.view_layout;
      return t;
    }

    // Display order inside a room: what a person reaches for first.
    var ORDER = ['light', 'switch', 'fan', 'cover', 'media_player', 'climate', 'water_heater',
                 'humidifier', 'lock', 'alarm_control_panel', 'vacuum', 'valve', 'button'];
    function isTileButton(e) { return !!e && e.platform === 'wake_on_lan'; }

    // "Kitchen Table Light" in the Kitchen is a "Table Light" -- the Home app
    // never repeats the room on its tiles.
    // The area's name is matched with its apostrophes folded: the area
    // registry may spell it "Emma’s Room" (curly) and the entity names
    // "Emma's Room Lamp" (straight), and unfolded the prefix would never be
    // dropped. Same length either way, so the slice below still lines up.
    function fold(v) { return String(v).toLowerCase().replace(/[’‘`]/g, "'"); }
    function shortName(full, area) {
      var n = String(full || '').trim(), a = String(area || '').trim();
      if (a && fold(n).indexOf(fold(a) + ' ') === 0 && n.length > a.length + 1) {
        n = n.slice(a.length + 1);
        n = n.charAt(0).toUpperCase() + n.slice(1);
      }
      return n;
    }

    // The FULL name ("Family Car Climate"), not the registry's short entity
    // name ("Climate"), which leaves out the device and makes two cars' climate
    // controls indistinguishable. The room prefix is then dropped by shortName.
    function nameOf(client, id, ent) {
      var st = client.states[id];
      return PR().name(client, id) || (st && st.attributes && st.attributes.friendly_name) || (ent && ent.name) || id;   // (a stereo pair's own)
    }

    function heading(name) {
      return { type: 'custom:hk-heading-card', name: name };
    }

    function titleBar(name) {
      return { type: 'custom:hk-grid-card', page_header: true, view_layout: COL2,
        // 20 px between the back button (and the menu button beside it) and
        // the title -- room enough that a tap meant for one cannot land on
        // the other.
        layout: { 'grid-template-columns': 'max-content minmax(0, 1fr)', 'grid-column-gap': '20px',
                  'grid-row-gap': '0px', margin: '0px', padding: '10px 0px 6px 0px' },
        cards: [{ type: 'custom:hk-back-card', parents: { 'music-browse': 'playmusic' } },
                { type: 'custom:hk-heading-card', name: name, height: '44px',
                  padding: '0px 0px 0px 3px', grid_rows: '44px' }] };
    }

    function column(cards, extra) {
      return Object.assign({ type: 'custom:hk-grid-card', view_layout: COL2,
        layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-column-gap': '0px',
                  'grid-row-gap': '0px', margin: '0px', padding: '0px' },
        cards: cards }, extra || {});
    }

    // ------------------------------------------------------------ the house
    // area -> [entity ids] from the registries: an entity's own area, else its
    // device's. Hidden, disabled, config and diagnostic entities are left out.
    // ONE PASS OVER THE HOUSE PER BUILD. rooms() is asked once for Home and
    // once for every room page (27 times on this house), and each pass walked
    // every entity (4,195): 113k visits, ~170 ms of a tablet's generate().
    // What it sorts into rooms depends only on the build's client and its
    // exclusions -- not on which areas one caller wants -- so a build keeps the
    // one pass in its options (`__build`, copied into every per-room options
    // object by Object.assign) and rooms() only picks and orders from it. Kept
    // per BUILD, not per client: a second build always looks again.
    function byArea(client, opts) {
      var hide = hideOf(opts), into = INTO(), build = opts && opts.__build, laundry = window.hkLaundry ? window.hkLaundry.placed(client) : { by: {}, area: {} };   // (washers, dryers)
      var key = JSON.stringify([opts.exclude_entities || [], opts.exclude_devices || [], opts.exclude_areas || [],
                                opts.include_entities || [], into, Object.keys(laundry.by)]);
      var memo = build && build.byArea;
      if (memo && memo.key === key && memo.client === client) return memo;
      var ents = client.entities || {}, devs = client.devices || {}, areas = client.areas || {};
      var by = {}, more = [], seen = {};
      Object.keys(ents).concat(Object.keys(hide.include)).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        var e = ents[id] || {}, dom = id.split('.')[0];
        var added = !!hide.include[id] || !!laundry.by[id];
        if (!client.states[id] || hidden(client, opts, id) || PR().folded(client, id, hidden.bind(null, client, opts))) return;   // (a stereo pair's half, hk-pairs.js)
        if (!added && (!TILE[dom] || e.hidden || e.entity_category)) return;
        if (!added && dom === 'button' && !isTileButton(e)) return;
        var area = (laundry.by[id] && laundry.area[id]) || e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id) || PR().area(client, id);
        // A ROOM SHOWN AS PART OF ANOTHER (the accessories' `into`): the Deck's
        // things are the Backyard's, its section and page the Backyard's
        if (area && into[area] && areas[into[area]]) area = into[area];
        if (!area || !areas[area]) { if (added) more.push(id); return; }
        (by[area] = by[area] || []).push(id);
      });
      memo = { key: key, client: client, by: by, more: more };
      if (build) build.byArea = memo;
      return memo;
    }

    function setting(path) {
      var HS = window.hkSettings;
      return HS ? HS.get(path, null) : null;
    }
    // WHAT ITS STATES ARE CALLED (the accessory's On Says / Off Says):
    // "Blocked" / "Allowed" in place of On / Off on a switch or
    // helper's tile and favorite (a light keeps its brightness). Only the
    // words: whether it is lit is still its state.
    function stateNames(t, id) {
      var a = accOf(id) || {};
      if (!t || (!a.on_text && !a.off_text) || !/^(switch|input_boolean)\./.test(id)) return t;
      t.label_map = Object.assign({}, t.label_map || {}, a.on_text ? { on: a.on_text } : {}, a.off_text ? { off: a.off_text } : {});
      return t;
    }

    // ------------------------------------------------ this dashboard's item
    // Its Home and Pages settings (1.7): the item under Dashboards whose url
    // path is this one. None: every default.
    function dashSeg() {
      try { return String(location.pathname).split('/')[1] || ''; } catch (e) { return ''; }
    }

    // what the shell and the later parts use of this one
    K.accIcon = accIcon; K.accName = accName; K.accOf = accOf; K.areaOf = areaOf; K.byArea = byArea;
    K.cardsReady = cardsReady; K.clientOf = clientOf; K.COL2 = COL2; K.column = column; K.dashSeg = dashSeg;
    K.FAV_PX = FAV_PX; K.fold = fold; K.heading = heading; K.hidden = hidden; K.hideOf = hideOf; K.INTO = INTO;
    K.membersOf = membersOf; K.nameOf = nameOf; K.ORDER = ORDER; K.pillGrid = pillGrid; K.PR = PR; K.PX = PX;
    K.PX_KIN = PX_KIN; K.roomOrder = roomOrder; K.setting = setting; K.shortName = shortName; K.sized = sized;
    K.TILE = TILE; K.tileFor = tileFor; K.titleBar = titleBar; K.TL = TL; K.VIEW_LAYOUT = VIEW_LAYOUT;
  };
})();
