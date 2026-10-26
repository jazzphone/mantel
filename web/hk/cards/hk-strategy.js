// hk-strategy.js -- A WHOLE HOME APP-STYLE DASHBOARD FROM THE HOUSE ITSELF.
//
//     # a new dashboard, in its raw configuration editor:
//     strategy:
//       type: custom:hk-dashboard
//
// A Lovelace dashboard STRATEGY: Home Assistant asks it for the dashboard and
// it answers from the house's own registries -- floors, areas, devices and
// entities -- so a house with none of this configuration gets a working
// dashboard on day one, and a new light appears on its own. It is curated on
// the HK Settings page (each screen's item, the accessories' gear), not in
// YAML: since 2026-09-28 every screen of this house but the car's is one.
//
// WHAT IT BUILDS
//   Home      the wall header (clock, weather, security) and the status chips,
//             then one section per area -- a heading and its tiles -- ordered
//             by floor level, then area name. Areas with nothing are left out.
//   Lights, Climate, Doors & Windows, Timers, Vacuums
//             a page per category the house has, opened from its chip.
//   Weather   the band, and wind / sun / moon / UV tiles.       (./weather)
//   Security  the alarm keypad, when there is an alarm panel.   (./security)
//   Music     Play and Browse, when Music is set up with speakers. (./playmusic)
//   Rooms     a page per area: its status row, cameras and devices grouped as
//             the Home app groups them (./room-<area>); each room heading on
//             Home opens its page. The same page is a view strategy of its own
//             for hand-built dashboards: `strategy: {type: custom:hk-room,
//             area: kitchen}` (docs/Menu.md).
//   The menu  (the dashboard item's gear -> Menu) lists all of it: the chip
//             row carries its button, Weather sits beside Home, Browse Music
//             is left out unless its Categories pick it.
//
// THE TILES follow hand-curated conventions (card type, glyph,
// colour, tall tiles for locks, thermostats, vacuums and garage doors) and the
// MEASURED glyph sizes -- see TILE below. A glyph without a measured size keeps
// the card default rather than a guessed one.
//
// OPTIONS (all optional) -- normally set on the HK Settings page (Accessories
// -> Hidden from Screens / Also Shown, and each screen's Pages); the same keys
// in the dashboard's raw configuration add to those (lists) or win (yes/no).
//   areas:           [area_id, ...]   only these, in this order
//   exclude_areas:   [area_id, ...]
//   exclude_entities:[entity_id, ...]
//   exclude_devices: [device_id, ...]
//   include_entities:[entity_id, ...]  shown in their room, or in "More"
//   theme:           a theme name     (default: HK Kiosk when installed)
//   sky:             false            no live sky
//   music:           false            no music pages even when music is set up
//   chips:           false            no status chips under the header
//   pages:           false            no category pages
//   rooms:           false            no room pages
//
// It reads the client's floors / areas / devices / entities, which every
// user -- including a non-admin wall tablet -- already has. One subscription
// (hk_music/subscribe, bounded to 4 s) asks whether music is configured.
//
// THE CLIENT. Lovelace calls a strategy's static hooks (generate,
// shouldRegenerate) with its own frontend object; each hook converts it at
// the door (clientOf below: the host adapter's client, one per object) and
// everything inside reads only that client. The helpers exported on
// window.hkStrategy take either, converted the same way.
(function () {
  'use strict';

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
    paw: 26, 'ev-station': 26, clock: 24, alarm: 25, 'trash-can': 24
  };
  Object.keys(PX_KIN).forEach(function (k) { if (!PX[k]) PX[k] = PX_KIN[k]; });
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
      var armed = {};
      ['armed_home', 'armed_away', 'armed_night', 'armed_vacation', 'armed_custom_bypass',
       'arming', 'triggered'].forEach(function (s) { armed[s] = 'hk:alarm-light'; });
      // A tap opens the alarm's keypad sheet, as any device's tap opens its
      // sheet.
      return sized({ type: 'custom:hk-tall-card', entity: id, name: name, icon: 'hk:alarm-light-off',
        icon_states: armed, icon_color: 'mint', bare_icon: true, well_background: 'transparent',
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
    if (d === 'button' || d === 'input_button') {
      return { type: 'custom:hk-scene-card', entity: id, name: name, icon: icon, icon_color: 'white',
               elevated: true, tap_action: call(d + '.press') };
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
    var t;
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
      t = fn(id, name, client.states[id], dv && dv.model);
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
    return (st && st.attributes && st.attributes.friendly_name) || (ent && ent.name) || id;
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
    var hide = hideOf(opts), into = INTO(), build = opts && opts.__build;
    var key = JSON.stringify([opts.exclude_entities || [], opts.exclude_devices || [], opts.exclude_areas || [],
                              opts.include_entities || [], into]);
    var memo = build && build.byArea;
    if (memo && memo.key === key && memo.client === client) return memo;
    var ents = client.entities || {}, devs = client.devices || {}, areas = client.areas || {};
    var by = {}, more = [], seen = {};
    Object.keys(ents).concat(Object.keys(hide.include)).forEach(function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var e = ents[id] || {}, dom = id.split('.')[0];
      var added = !!hide.include[id];
      if (!client.states[id] || hidden(client, opts, id)) return;
      if (!added && (!TILE[dom] || e.hidden || e.entity_category)) return;
      if (!added && dom === 'button' && !isTileButton(e)) return;
      var area = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
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
  function rooms(client, opts) {
    var areas = client.areas || {}, floors = client.floors || {};
    var hide = hideOf(opts), sorted = byArea(client, opts);
    var by = sorted.by, more = sorted.more;
    var list = Object.keys(by);
    if (Array.isArray(opts.areas) && opts.areas.length) {
      list = opts.areas.filter(function (a) { return by[a]; });
    } else {
      var level = function (a) {
        var f = areas[a].floor_id && floors[areas[a].floor_id];
        return (f && typeof f.level === 'number') ? f.level : 1e6;
      };
      list.sort(function (x, y) {
        return (level(x) - level(y)) || String(areas[x].name).localeCompare(String(areas[y].name));
      });
    }
    var rank = function (id) {
      var i = ORDER.indexOf(id.split('.')[0]);
      return i < 0 ? ORDER.length : i;              // added kinds after the built-in ones
    };
    // BY THE NAME THE TILE SHOWS (named: the accessory's own, else the room
    // dropped), so a renamed accessory takes its new place, as on its page
    var sortIds = function (ids, area) {
      var key = {};
      ids.forEach(function (x) { key[x] = named(client, x, area || ''); });
      return ids.slice().sort(function (x, y) {
        return (rank(x) - rank(y)) || key[x].localeCompare(key[y]);
      });
    };
    // A ROOM'S OWN ORDER (the accessories' room order): the ones it lists,
    // in its order, then the rest as usual.
    // A room shown inside it (the accessories' `into`) brings its own order
    // along, after the room's -- or the Deck's lights would stay in the
    // Backyard's automatic order.
    var inOrder = function (a, ids, inside) {
      var own = null;
      [a].concat(inside || []).forEach(function (r) {
        var o = roomOrder(r);
        if (o) own = (own || []).concat(o.filter(function (x) { return !own || own.indexOf(x) < 0; }));
      });
      if (!own) return sortIds(ids, areas[a].name);
      var rankOf = {};
      own.forEach(function (x, i) { rankOf[x] = i; });
      var listed = ids.filter(function (x) { return x in rankOf; })
                      .sort(function (x, y) { return rankOf[x] - rankOf[y]; });
      return listed.concat(sortIds(ids.filter(function (x) { return !(x in rankOf); }), areas[a].name));
    };
    var out = list.filter(function (a) { return !hide.areas[a]; }).map(function (a) {
      var inside = Object.keys(INTO()).filter(function (x) { return INTO()[x] === a; });
      return { id: a, name: areas[a].name, entities: inOrder(a, by[a], inside), areas: [a].concat(inside) };
    });
    if (more.length) out.push({ id: '', name: 'More', entities: sortIds(more) });
    return out;
  }

  // THE NAME A TILE SHOWS: the accessory's own (its gear), else the entity's
  // with the room's name dropped ("Kitchen Table Light" -> "Table Light").
  function named(client, id, area) {
    return accName(id) || shortName(nameOf(client, id, (client.entities || {})[id]), area);
  }
  function roomSection(client, room) {
    // "Show in Home" off (the accessory's gear): not on Home -- its room's
    // page and the category pages still list it, as the Home app does.
    var tiles = room.entities.filter(function (id) {
      var a = accOf(id);
      return !(a && a.home === false);
    }).map(function (id) {
      return placed(tileFor(client, id, named(client, id, room.name)), room.id ? { area: room.id } : null);
    }).filter(Boolean);
    var head = heading(room.name);
    if (room.id) head.area = room.id;         // "Living Room ›" when it has a page
    return { type: 'grid', columns: 1, square: false, view_layout: COL2,
             cards: [head, { type: 'custom:hk-grid-card', layout: pillGrid(19), cards: tiles }] };
  }

  // WHERE A TILE LIVES, for Arrange in its sheet's settings (hk-detail.js,
  // 2026-10-01): a room section on Home ({area}), a group on a room page
  // ({area, group}) or the Favorites ({fav: true}). The order it moves in
  // is the room's Tile Order (accessories `rooms`) or the screen's
  // favorites. A category page's tile says its place too, with its `page`
  // (catPlace, for Edit mode), and has no Arrange in its sheet.
  function placed(t, place) {
    if (t && place) t.hk_place = place;
    return t;
  }

  // ------------------------------------------------------------ room pages
  // A ROOM PAGE, the Home app's: the room's name under a back button, its
  // status row, its cameras, then its devices grouped as the Home app groups
  // them -- Climate, Lights, Speakers & TVs, Security, Water, Other. Lights
  // run A to Z (as the Home app lists them); every other group keeps the
  // room's own order. `areas` may be several (a backyard and its deck).
  var GROUPS = ['Climate', 'Lights', 'Speakers & TVs', 'Security', 'Water', 'Other'];
  var DOORS = { garage: 1, gate: 1, door: 1 };
  function groupOf(client, id) {
    var d = id.split('.')[0], st = client.states[id];
    var dc = st && st.attributes && st.attributes.device_class;
    if (d === 'valve' || d === 'water_heater') return 'Water';
    if (d === 'fan' || d === 'climate' || d === 'humidifier' || (d === 'cover' && !DOORS[dc])) return 'Climate';
    if (d === 'light') return 'Lights';
    if (d === 'media_player') return 'Speakers & TVs';
    if (d === 'lock' || d === 'alarm_control_panel' || d === 'cover') return 'Security';
    return 'Other';
  }
  function roomCameras(client, areas, opts) {
    var want = {};
    areas.forEach(function (a) { want[a] = true; });
    return houseCameras(client, opts, function (id) { return want[areaOf(client, id)]; });
  }

  // THE HOUSE'S CAMERAS, ONE TILE PER CAMERA. A UniFi Protect
  // camera offers the same picture as three camera entities -- its high,
  // medium and low resolution channels -- so a room page listing every
  // camera entity in the area would give a front yard 14 tiles for 5
  // cameras. And two kinds of "camera" are not the house's at all: a wall
  // tablet's own (Fully Kiosk's front camera; Kiosk Satellite's Camera and
  // Screenshot) and Live TV's channels (the Live TV page).
  //
  // One per DEVICE, picked in this order: the one this screen lists for its
  // strip, one any screen lists, a low-resolution channel (a still refreshes
  // faster from it), then A to Z. The
  // screen's own list also sets the order; the rest follow A to Z.
  // not the house's cameras: a wall tablet's own, and Live TV's channels
  // (HK Frontend's only cameras; hk_tv before 1.0), and those the host names
  // (hkShell.notHouseCameraPlatforms: its own integration's Live TV channels)
  var NOT_HOUSE_CAMERAS = { fully_kiosk: 1, hk_frontend: 1, hk_tv: 1 };
  // A KIOSK SATELLITE TABLET'S CAMERAS come through ESPHome, the platform an
  // ESP32 camera on the porch uses too -- so it is the DEVICE that tells them
  // apart: Kiosk Satellite registers itself with manufacturer
  // `kiosk_satellite`. Never the platform alone.
  function notHouseCamera(client, e) {
    if (NOT_HOUSE_CAMERAS[e.platform]) return true;
    var sh = window.hkShell, more = sh && typeof sh.notHouseCameraPlatforms === 'function' && sh.notHouseCameraPlatforms();
    if (e.platform && Array.isArray(more) && more.indexOf(e.platform) >= 0) return true;
    var d = e.device_id && (client.devices || {})[e.device_id];
    return !!d && d.manufacturer === 'kiosk_satellite';
  }
  function houseCameras(client, opts, pred) {
    var ents = client.entities || {};
    var mine = listOf((opts && opts.board) || {}, 'cameras');
    var anyList = {}, boards = setting('boards') || {};
    Object.keys(boards).forEach(function (k) {
      listOf(boards[k] || {}, 'cameras').forEach(function (id) { anyList[id] = true; });
    });
    var byDev = {}, devs = [];
    shown(client, opts, 'camera').forEach(function (id) {
      var e = ents[id] || {};
      if (notHouseCamera(client, e) || (pred && !pred(id))) return;
      var d = e.device_id || id;
      if (!byDev[d]) { byDev[d] = []; devs.push(d); }
      byDev[d].push(id);
    });
    function score(id) {
      var i = mine.indexOf(id);
      if (i >= 0) return i;
      if (anyList[id]) return 1000;
      return /low/.test(id) ? 2000 : 3000;
    }
    var picked = devs.map(function (d) {
      return byDev[d].slice().sort(function (a, b) { return score(a) - score(b) || (a < b ? -1 : 1); })[0];
    });
    return picked.sort(function (a, b) {
      var x = mine.indexOf(a), y = mine.indexOf(b);
      if (x < 0) x = Infinity;
      if (y < 0) y = Infinity;
      return x - y || (a < b ? -1 : a > b ? 1 : 0);
    });
  }
  function roomCards(client, areas, name, opts) {
    areas = [].concat(areas || []).filter(Boolean);
    var ents = client.entities || {}, seen = {}, groups = {};
    rooms(client, Object.assign({}, opts, { areas: areas })).forEach(function (r) {
      if (!r.id) return;                        // "More" is not a room
      r.entities.forEach(function (id) {
        if (seen[id]) return;
        // HIDDEN FROM ITS ROOM PAGE only (Hidden Accessories, `room: false`):
        // still on Home and the category pages
        var acc = accOf(id);
        if (acc && acc.room === false) return;
        seen[id] = true;
        var g = groupOf(client, id);
        (groups[g] = groups[g] || []).push(placed(tileFor(client, id, named(client, id, name)), { area: areas[0], group: g }));
      });
    });
    // Lights A to Z -- unless the room has an order of its own (the gear)
    var ordered = areas.some(function (a) { return roomOrder(a); });
    if (groups.Lights && !ordered) {
      groups.Lights.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    }
    // the status row counts the accessories ON THIS PAGE (hk-room.js
    // `entities`), and its sensors less what this dashboard leaves out --
    // its own YAML's exclusions (the house's Hidden from Screens the card
    // reads live as well)
    var status = { type: 'custom:hk-room-status-card', area: areas.length === 1 ? areas[0] : areas,
                   entities: Object.keys(seen), view_layout: COL2 };
    ['exclude_entities', 'exclude_devices', 'exclude_areas'].forEach(function (k) {
      var l = ((opts || {})[k] || []);
      if (l.length) status[k] = l.slice();
    });
    var cards = [titleBar(name), status];
    // THE CAMERAS AS SNAPSHOTS: stills that refresh, never a live stream --
    // in the camera strip's pattern (below), in a row that scrolls sideways
    // when it is wider than the page. A tap opens the camera, live.
    var cams = roomCameras(client, areas, opts);
    if (cams.length) {
      cards.push({ type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [heading('Cameras'),
        // the row reaches out by the tiles' shadow and pads it back inside,
        // as the scenes row does (a scroller clips at its own edge); 26 at the
        // sides lines the first camera up with the tiles, which sit 4 px in
        // THE ROOM'S CAMERAS AS A STRIP (2026-10-09), Home's camera strip
        // with no live tile: one tall, then two stacked, and so on, as the Home
        // app draws a room. Stills only -- a tap opens the camera, live --
        // and the room's own cameras, not the screen's Home strip list.
        // The row pads 14/30 for the strip's shadow; the margins give back
        // all but 6 above and 20 below, so the strip sits from its heading
        // and from the next one as a row of tiles does.
        { type: 'custom:hk-row-card', card_width: 'fit-content', pad_top: 14, pad_bottom: 30,
          pad_left: 26, pad_right: 26, margin: '-8px -22px -10px -22px',
          cards: [{ type: 'custom:hk-camera-mosaic-card', height: 195, seam: 2, snapshot_cap: '480x270',
                    max_upscale: 1.2, show_age: true, stills_only: true, own_cameras: true,
                    cameras: cams.map(function (id) { return { entity: id, name: fullName(client, id) }; }) }] }] });
    }
    // THE ROOM'S SCENES (2026-10-01): a row of scene pills under the status
    // row -- under the cameras when it has some -- that scrolls sideways, as
    // Home's does (hk-scenes-card in room mode). Each room's own (HK Settings
    // -> Accessories -> the room -> Scenes): its own list, none, or
    // Automatic -- the Home Assistant scenes in the room.
    var scenes = roomScenes(client, areas, opts);
    if (scenes.length) cards.push({ type: 'custom:hk-scenes-card', room: true, scenes: scenes, view_layout: COL2 });
    GROUPS.forEach(function (g) { if (groups[g]) cards.push(section(g, groups[g])); });
    return cards;
  }
  // A ROOM'S SCENES: the lists its areas have of their own (the Deck's
  // after the Backyard's), else every shown scene in them, A to Z. A list
  // that is empty is a room with no row.
  function roomScenes(client, areas, opts) {
    var A = setting('accessories'), own = (A && A.scenes && typeof A.scenes === 'object') ? A.scenes : {};
    var mine = areas.filter(function (a) { return Array.isArray(own[a]); });
    if (mine.length) {
      var out = [];
      mine.forEach(function (a) {
        own[a].forEach(function (id) { if (out.indexOf(id) < 0 && client.states[id] && !hidden(client, opts, id)) out.push(id); });
      });
      return out;
    }
    var want = {};
    areas.forEach(function (a) { want[a] = true; });
    var st = client.states;
    return shown(client, opts, 'scene', null).filter(function (id) { return want[areaOf(client, id)]; })
      .sort(function (x, y) {
        return String(st[x].attributes.friendly_name || x).localeCompare(String(st[y].attributes.friendly_name || y));
      });
  }
  function slug(v) {
    return String(v || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function firstOf(client, domain) {
    return Object.keys(client.states).filter(function (k) { return k.indexOf(domain + '.') === 0; }).sort()[0] || null;
  }

  function setting(path) {
    var HS = window.hkSettings;
    return HS ? HS.get(path, null) : null;
  }
  // THE THEME a generated view wears: HK Kiosk when it is loaded, else the
  // house's default
  function kioskTheme(themes) {
    return themes && themes['HK Kiosk'] ? 'HK Kiosk' : undefined;
  }
  // a feature of HK Frontend added and set up (the settings feed's `added`)
  function added(kind) {
    var a = setting('added');
    return Array.isArray(a) && a.indexOf(kind) >= 0;
  }
  // THE HOUSE BATTERY the Energy feature names (its plan's power.battery),
  // for a Home Grid's `battery` block; null without one
  function houseBattery() {
    var P = added('energy') ? setting('energy') : null, B = P && P.power && P.power.battery;
    return B && typeof B === 'object' && B.level ? B : null;
  }

  // Every shown entity of a domain (same rules as the rooms: not hidden, not a
  // config/diagnostic entity, has a state), optionally filtered, sorted by id.
  // The house's entity ids by domain, once per build (as byArea): shown() is
  // asked for a dozen domains and each call walked every state.
  function idsOf(client, opts, domain) {
    var build = opts && opts.__build, idx = build && build.client === client ? build.domains : null;
    if (!idx) {
      idx = {};
      Object.keys(client.states).forEach(function (id) {
        var d = id.split('.')[0];
        (idx[d] = idx[d] || []).push(id);
      });
      if (build) { build.domains = idx; build.client = client; }
    }
    return idx[domain] || [];
  }
  function shown(client, opts, domain, pred) {
    var ents = client.entities || {};
    return idsOf(client, opts, domain).filter(function (id) {
      var e = ents[id] || {};
      if (e.hidden || e.entity_category || hidden(client, opts, id)) return false;
      return !pred || pred(client.states[id]);
    }).sort();
  }
  function dc(st) { return st && st.attributes && st.attributes.device_class; }

  // A sensor on the same DEVICE with this device_class -- a vacuum's battery.
  function sibling(client, id, deviceClass) {
    var ents = client.entities || {}, dev = ents[id] && ents[id].device_id;
    if (!dev) return null;
    var hit = Object.keys(ents).filter(function (k) {
      return k !== id && ents[k].device_id === dev && k.indexOf('sensor.') === 0 &&
             dc(client.states[k]) === deviceClass;
    }).sort();
    return hit[0] || null;
  }

  // A sensor on the same device whose entity id matches -- a vacuum's
  // current room, its cleaning progress, its dock error.
  function siblingLike(client, id, re, not) {
    var ents = client.entities || {}, dev = ents[id] && ents[id].device_id;
    if (!dev) return null;
    return Object.keys(ents).filter(function (k) {
      return k !== id && ents[k].device_id === dev && k.indexOf('sensor.') === 0 && client.states[k] &&
             re.test(k) && !(not && not.test(k));
    }).sort()[0] || null;
  }
  function friendly(client, id, area) {
    var ents = client.entities || {}, areas = client.areas || {}, devs = client.devices || {};
    var e = ents[id] || {};
    var a = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
    return accName(id) || shortName(nameOf(client, id, e), area || (a && areas[a] && areas[a].name));
  }

  // --------------------------------------------------------- what exists
  // One pass over the house, shared by the chips, the pages and the header.
  //
  // STATUS & CHIPS FIRST (kinds.py): the integration resolves each
  // kind for the whole house -- the chips read the same lists -- and this
  // keeps the ones this dashboard shows (its own YAML may leave out more).
  // Before the integration has answered, the rules below.
  function inventory(client, opts) {
    var K = setting('kinds') || {};
    if (K && typeof K === 'object' && Object.keys(K).length) {
      var mine = function (kind) {
        return (Array.isArray(K[kind]) ? K[kind] : []).filter(function (id) {
          return client.states[id] && !hidden(client, opts, id);
        });
      };
      var gar = mine('garage');
      return { lights: mine('lights'), climates: mine('thermostats'), fans: mine('fans'),
               blinds: mine('blinds'), locks: mine('locks'), doors: mine('doors'), windows: mine('windows'),
               garage: gar, vacuums: mine('vacuums'), timers: mine('timers'), speakers: mine('speakers'),
               leaks: mine('leaks'), motion: mine('motion'), occupancy: mine('occupancy'), valves: mine('valves') };
    }
    var sec = window.hkSettings ? window.hkSettings.get('security', {}) : {};
    var has = function (l) { return Array.isArray(l) && l.length; };
    var keep = function (l) { return l.filter(function (id) { return !hidden(client, opts, id); }); };
    var contact = function (kind) {
      return function (st) { return dc(st) === kind; };
    };
    var classes = function (list) {
      return function (st) { return list.indexOf(dc(st)) >= 0; };
    };
    return {
      leaks: shown(client, opts, 'binary_sensor', contact('moisture')),
      motion: shown(client, opts, 'binary_sensor', classes(['motion', 'moving'])),
      occupancy: shown(client, opts, 'binary_sensor', classes(['occupancy', 'presence'])),
      // a water valve (the Water page's), not a gas one
      valves: shown(client, opts, 'valve', function (st) { return dc(st) !== 'gas'; }),
      lights: shown(client, opts, 'light'),
      climates: (function () {
        var t = window.hkSettings ? window.hkSettings.get('features.thermostats', []) : [];
        return has(t) ? keep(t).filter(function (id) { return client.states[id]; }) : shown(client, opts, 'climate');
      })(),
      fans: shown(client, opts, 'fan'),
      blinds: shown(client, opts, 'cover', function (st) {
        var d = dc(st);
        return d !== 'garage' && d !== 'gate' && d !== 'door';
      }),
      locks: has(sec.locks) ? keep(sec.locks) : shown(client, opts, 'lock'),
      doors: has(sec.doors) ? keep(sec.doors) : shown(client, opts, 'binary_sensor', contact('door')),
      windows: has(sec.windows) ? keep(sec.windows) : shown(client, opts, 'binary_sensor', contact('window')),
      garage: has(sec.garage) ? keep(sec.garage) : shown(client, opts, 'cover', function (st) {
        return dc(st) === 'garage' || dc(st) === 'gate';
      }),
      vacuums: shown(client, opts, 'vacuum'),
      timers: shown(client, opts, 'timer'),
      speakers: shown(client, opts, 'media_player', function (st) { return dc(st) !== 'tv' && dc(st) !== 'receiver'; })
    };
  }

  // ------------------------------------------------------------- the views
  // Climate summaries and their open sheets share these exact lists. The
  // server resolves Status & Chips; before it answers, prefer related sensors
  // and then a room's thermostat, never every temperature sensor in a house.
  //
  // TWO QUESTIONS, kept apart: what the HOUSE has (climateFound -- the build
  // asks it whether there is a Climate page at all) and what the Climate
  // ROW counts (climateMembers -- that, less the rooms the row leaves out,
  // status_rows.climate, read live by the row). A row's exclusions are never
  // a reason for the page to exist or not, so the build reads no status_rows.
  function climateMembers(client, o) {
    var cl = (setting('status_rows') || {}).climate || {};
    return climateFound(client, o, cl.exclude_areas || []);
  }
  function climateFound(client, o, rowAreas) {
    o = o || {};
    var K = setting('kinds') || {}, A = client.areas || {}, st = client.states || {};
    var G = setting('generated') || {};
    var opts = {};
    ['exclude_entities', 'exclude_devices', 'exclude_areas'].forEach(function (k) {
      opts[k] = [].concat(G[k] || [], o[k] || [], k === 'exclude_areas' ? rowAreas || [] : []);
    });
    function visible(id) {
      var e = (client.entities || {})[id] || {}, own = accOf(id) || {};
      return st[id] && !e.hidden && !e.entity_category && !e.disabled_by && own.status !== false &&
        !membersOf(st[id]) && !hidden(client, opts, id);
    }
    function reading(k) {
      if (Array.isArray(K[k])) return K[k].filter(function (id) { return st[id] && !hidden(client, opts, id); });
      var ids = [];
      Object.keys(A).forEach(function (a) {
        if (opts.exclude_areas.indexOf(a) >= 0) return;
        var id = A[a][k + '_entity_id'];
        if (id) { if (visible(id)) ids.push(id); return; }
        // (an unavailable thermostat has lost its current_* attributes: every
        // thermostat reads a temperature, so it stays in that list)
        Object.keys(st).forEach(function (eid) {
          var s = st[eid], off = s.state === 'unavailable' || s.state === 'unknown';
          if (eid.indexOf('climate.') === 0 && areaOf(client, eid) === a && visible(eid) &&
              (('current_' + k) in s.attributes || (off && k === 'temperature'))) ids.push(eid);
        });
      });
      return ids.filter(function (id, i) { return ids.indexOf(id) === i; }).sort();
    }
    function accessories(k, d) {
      if (Array.isArray(K[k])) return K[k].filter(function (id) { return st[id] && !hidden(client, opts, id); });
      return Object.keys(st).filter(function (id) {
        return id.indexOf(d + '.') === 0 && visible(id) && (k !== 'blinds' ||
          ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window', undefined].indexOf(dc(st[id])) >= 0);
      }).sort();
    }
    return { temperature: reading('temperature'), humidity: reading('humidity'),
             blinds: accessories('blinds', 'cover'), fans: accessories('fans', 'fan') };
  }
  // A CATEGORY PAGE'S STATUS ROW (hk-room.js pageItems): each kind it may
  // show, from the same lists the page and the chips are built from
  // (inventory: Status & Chips', or found before the server answers), less
  // the screen's and the row's own rooms left out (status_rows.<page>).
  // Lights and outlets are the Lights page's two halves: what is a light
  // (or drawn as one), and the switches Status & Chips counts with them.
  function pageMembers(client, page, o) {
    o = o || {};
    if (page === 'climate') return climateMembers(client, o);
    var G = setting('generated') || {}, row = (setting('status_rows') || {})[page] || {};
    var opts = {};
    ['exclude_entities', 'exclude_devices', 'exclude_areas'].forEach(function (k) {
      opts[k] = [].concat(G[k] || [], o[k] || [], k === 'exclude_areas' ? row.exclude_areas || [] : []);
    });
    var inv = inventory(client, opts);
    var isLight = function (id) {
      var as = (accOf(id) || {}).show_as;
      return as ? as === 'light' : id.split('.')[0] === 'light';
    };
    var alarm = setting('security.alarm') || firstOf(client, 'alarm_control_panel');
    if (alarm && (!client.states[alarm] || hidden(client, opts, alarm))) alarm = null;
    return { lights: inv.lights.filter(isLight), outlets: inv.lights.filter(function (id) { return !isLight(id); }),
             doors: inv.doors, windows: inv.windows, garage: inv.garage, locks: inv.locks, leaks: inv.leaks,
             motion: inv.motion || [], occupancy: inv.occupancy || [], valves: inv.valves || [],
             vacuums: inv.vacuums || [], timers: inv.timers || [],
             security: alarm ? [alarm] : [] };
  }
  // THE PAGE HEADERS (hk-headers.js; hk_house/docs/PLAN-2026-10-15-page-headers.md):
  // the cards between a page's status row and its accessories, on the Energy
  // page's three columns (two in the iPad band, one on a phone -- the same
  // --hk-energy-* spans), so the pages' cards line up with Energy's. Each
  // card is 240 px tall. Shown unless HK Settings turns the page's off.
  var HEADER_H = '240px';
  // A SCREEN'S OWN SWITCH first (its item's `headers`, {page: false}:
  // HK Settings -> the screen -> Page Headers), then the house's.
  function headerOn(page) {
    if ((boardOf().headers || {})[page] === false) return false;
    var hd = (setting('headers') || {})[page];
    return !hd || hd.show !== false;
  }
  // a header's own settings (settings.HEADERS), null Automatic
  function headerOpts(page) {
    var hd = (setting('headers') || {})[page];
    return hd && typeof hd === 'object' ? hd : {};
  }
  function headerGrid(cards) {
    var grid = { type: 'custom:hk-grid-card', layout: {
      'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))',
      'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' }, cards: cards };
    // the column pays back its children's 4 px side margins, as Energy's
    var col = column([grid]);
    col.layout = Object.assign({}, col.layout, { margin: '0px -4px' });
    return col;
  }
  var SPAN2 = { 'grid-column': 'var(--hk-energy-hero, span 2)' }, SPAN1 = { 'grid-column': 'var(--hk-energy-hl, auto)' },
      SPAN_ALL = { 'grid-column': '1 / -1' };

  // the row under a category page's title (hk-room.js hk-page-status-card)
  function pageRow(page, opts) {
    return { type: 'custom:hk-page-status-card', page: page, view_layout: COL2,
             exclude_entities: opts.exclude_entities, exclude_devices: opts.exclude_devices,
             exclude_areas: opts.exclude_areas };
  }


  // ------------------------------------------------------------ the chips
  // hk-chips-card (hk-chip.js): the kinds from Status & Chips, in this
  // dashboard's order.

  // ------------------------------------------------------- category pages
  function section(name, tiles, three) {
    return { type: 'grid', columns: 1, square: false, view_layout: COL2,
             cards: [heading(name), { type: 'custom:hk-grid-card', layout: pillGrid(19, three), cards: tiles }] };
  }
  // Pages that MIX rooms (doors, locks, thermostats, timers) keep the full
  // name: under no room heading, "Door" twice says nothing.
  // THE NAME ON A PAGE THAT MIXES ROOMS (Security, Doors & Windows, Climate):
  // the entity's full name -- or the accessory's, which is room-relative the
  // way a room's tiles are ("Lock"), so the room goes in front unless it is
  // already there ("Crawl Space Lock", "Front Door Lock").
  function fullName(client, id) {
    var own = accName(id);
    if (!own) return nameOf(client, id, (client.entities || {})[id]);
    var room = areaName(client, id);
    return room && fold(own).indexOf(fold(room)) < 0 ? room + ' ' + own : own;
  }
  // A door, window or garage sensor: its open glyph, and its closed one
  // while shut. A glyph picked in its gear brings its own pair (a door into
  // the garage drawn as a garage); one with no pair is drawn in
  // both states.
  var CONTACT_PAIRS = {
    'door-closed': ['hk:door-open', 'hk:door-closed'], 'door-open': ['hk:door-open', 'hk:door-closed'],
    'window-closed-variant': ['hk:window-open-variant', 'hk:window-closed-variant'],
    'window-open-variant': ['hk:window-open-variant', 'hk:window-closed-variant'],
    garage: ['hk:garage-open', 'hk:garage'], 'garage-open': ['hk:garage-open', 'hk:garage'],
    'garage-variant': ['hk:garage-open-variant', 'hk:garage-variant'],
    'garage-open-variant': ['hk:garage-open-variant', 'hk:garage-variant'],
    'window-closed': ['hk:window-open', 'hk:window-closed'], 'window-open': ['hk:window-open', 'hk:window-closed'],
    'door-sliding': ['hk:door-sliding-open', 'hk:door-sliding'],
    'door-sliding-open': ['hk:door-sliding-open', 'hk:door-sliding'],
    gate: ['hk:gate-open', 'hk:gate'], 'gate-open': ['hk:gate-open', 'hk:gate']
  };
  function contactGlyphs(id, open, closed) {
    var own = accIcon(id);
    if (!own) return [open, closed];
    var p = CONTACT_PAIRS[own.replace(/^hk:/, '')];
    return p ? p.slice() : [own, own];
  }
  function contactTile(client, id, open, closed) {
    var g = contactGlyphs(id, open, closed), room = areaName(client, id);
    var t = { type: 'custom:hk-favorite-card', entity: id, name: named(client, id, room), room: room, icon: g[0],
              icon_color: 'red', label_mode: 'open_closed' };
    if (g[1] !== g[0]) t.icon_states = { off: g[1] };
    return sized(t);
  }
  // A CATEGORY PAGE'S OWN ORDER (the accessories' `pages`, set on the
  // HK Settings page -- the Vacuums, Security's locks): the ones it lists, in its order,
  // then the rest as they were.
  function ownOrder(page, ids) {
    var A = setting('accessories'), list = A && A.pages && A.pages[page];
    if (!Array.isArray(list) || !list.length) return ids;
    var rank = {};
    list.forEach(function (x, i) { rank[x] = i; });
    return ids.filter(function (x) { return x in rank; }).sort(function (x, y) { return rank[x] - rank[y]; })
      .concat(ids.filter(function (x) { return !(x in rank); }));
  }
  // Rooms, keeping only the entities `keep` accepts; empty rooms drop out.
  // THE PAGES' ROOMS IN THIS DASHBOARD'S ROOM ORDER when its item asks
  // (Home -> Rooms -> Rooms on pages: In room order); else floor by floor, A
  // to Z, as rooms() lists them. A room not in the order keeps its place
  // after those that are -- HkGridView.roomOrder's rule for Home.
  function pageOrder(list, opts) {
    var b = opts.board || {};
    var order = b.page_rooms === 'order' && Array.isArray(b.room_order) ? b.room_order : [];
    if (!order.length) return list;
    var rank = {};
    order.forEach(function (a, i) { if (!(a in rank)) rank[a] = i; });
    return list.map(function (r, i) { return { r: r, k: r.id in rank ? rank[r.id] : order.length, i: i }; })
      .sort(function (x, y) { return x.k - y.k || x.i - y.i; }).map(function (x) { return x.r; });
  }
  function roomsWith(client, opts, keep) {
    return pageOrder(rooms(client, opts).map(function (r) {
      return { id: r.id, name: r.name, entities: r.entities.filter(keep) };
    }).filter(function (r) { return r.entities.length; }), opts);
  }
  // A category page's room section; `group`/`page` say where its tiles
  // belong (catPlace)
  function roomTiles(client, r, group, page) {
    return r.entities.map(function (id) {
      return placed(tileFor(client, id, friendly(client, id, r.name)), catPlace(r, group, page));
    });
  }
  // WHERE A CATEGORY PAGE'S TILE BELONGS (Edit mode, 2026-10-26): a room
  // section on Lights, Climate or Water follows that room's Tile Order
  // ({area, group, page}: accessory/order); Security and Vacuums keep a page
  // order ({page}: accessory/page_order). The `page` keeps the sheet's
  // Arrange to the room pages and Home (hk-detail.js arrangeOf).
  function catPlace(r, group, page) {
    return r && r.id ? { area: r.id, group: group, page: page } : null;
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

  // Group controls belong on category pages even though status inventories
  // count their members only. Respect registry and screen exclusions.
  function categoryGroups(client, opts, ids, domains, kind) {
    var out = ids.slice(), ents = client.entities || {};
    var excluded = (((setting('counts') || {})[kind] || {}).exclude) || [];
    Object.keys(client.states || {}).forEach(function (id) {
      var e = ents[id] || {};
      if (domains.indexOf(id.split('.')[0]) < 0 || !membersOf(client.states[id]) ||
          e.hidden || e.entity_category || e.disabled_by || excluded.indexOf(id) >= 0 || hidden(client, opts, id)) return;
      if (out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }

  // withSecurity: this screen has a Security page (an alarm, the page wanted)
  function categoryPages(client, opts, inv, view, withSecurity) {
    var out = [];
    var dom = function (list) { return function (id) { return list.indexOf(id.split('.')[0]) !== -1; }; };
    var lightTiles = categoryGroups(client, opts, inv.lights, ['light'], 'lights');
    if (lightTiles.length) {
      // Status & Chips' lights -- which may be an outlet the house thinks of as
      // a light -- room by room, as the chip counts them.
      var lit = {};
      lightTiles.forEach(function (id) { lit[id] = true; });
      // LIGHTS & OUTLETS when Status & Chips has an outlet (a switch) among the
      // lights; "Lights" in the menu
      var outlets = inv.lights.some(function (id) { return id.split('.')[0] !== 'light'; });
      var ltitle = outlets ? 'Lights & Outlets' : 'Lights';
      var litRooms = roomsWith(client, opts, function (id) { return !!lit[id]; });
      var lcards = [titleBar(ltitle), pageRow('lights', opts)];
      // THE HEADER: the rooms lit longest today, and what is left on and
      // coming tonight -- of the page's lights (not its outlets: a light is
      // a light, or an accessory shown as one, as the status row counts)
      if (headerOn('lights')) {
        var isLit = function (id) { var as = (accOf(id) || {}).show_as; return as ? as === 'light' : id.split('.')[0] === 'light'; };
        var hdRooms = litRooms.map(function (r) {
          var icons = {}, ls = r.entities.filter(function (id) { return isLit(id) && inv.lights.indexOf(id) >= 0; });
          ls.forEach(function (id) { var t = tileFor(client, id, ''); if (t && t.icon) icons[id] = t.icon; });
          return { name: r.name, lights: ls, icons: icons };
        }).filter(function (r) { return r.lights.length; });
        if (hdRooms.length) {
          lcards.push(headerGrid([
            { type: 'custom:hk-lights-day-card', rooms: hdRooms, height: HEADER_H, view_layout: SPAN2 },
            { type: 'custom:hk-lights-tonight-card', rooms: hdRooms, height: HEADER_H, view_layout: SPAN1 }]));
        }
      }
      out.push(view({ title: ltitle, menu_title: outlets ? 'Lights' : undefined, icon: 'mdi:lightbulb', path: 'lights',
        subview: true, sky_variant: 'lights',
        background: '#1c1608', cards: lcards.concat(litRooms.map(function (r) {
            return section(r.name, roomTiles(client, r, 'Lights', 'lights')); })) }));
    }
    // the house's readings, not the row's (its rooms left out are the row's)
    var climateSources = climateFound(client, opts, []);
    var blindTiles = categoryGroups(client, opts, inv.blinds, ['cover'], 'blinds').filter(function (id) {
      return ['garage', 'gate', 'door'].indexOf(dc(client.states[id])) < 0;
    });
    if (inv.climates.length || inv.fans.length || blindTiles.length ||
        climateSources.temperature.length || climateSources.humidity.length) {
      var blinds = {};
      blindTiles.forEach(function (b) { blinds[b] = 1; });
      // THE CLIMATE PAGE (2026-10-15): the header -- the day's heating and
      // cooling beside the weather ahead -- then, under it, the rooms' fans,
      // humidifiers and blinds on the left and the thermostats right beside
      // them (2026-10-16, the user: as it was before the header), both
      // stacks top-aligned; --hk-page-split stacks them on a phone.
      var cards = [titleBar('Climate'), { type: 'custom:hk-climate-status-card', view_layout: COL2,
        exclude_entities: opts.exclude_entities, exclude_devices: opts.exclude_devices, exclude_areas: opts.exclude_areas }];
      var thermos = inv.climates.filter(function (id) { return id.indexOf('climate.') === 0; });
      var wx = (window.hkSettings && window.hkSettings.weatherId && window.hkSettings.weatherId(client.states)) || firstOf(client, 'weather');
      if (wx && hidden(client, opts, wx)) wx = null;
      if (headerOn('climate') && (thermos.length || wx)) {
        var hc = [];
        if (thermos.length) hc.push({ type: 'custom:hk-climate-runtime-card', thermostats: thermos, height: HEADER_H, view_layout: wx ? SPAN2 : SPAN_ALL });
        if (wx) hc.push({ type: 'custom:hk-climate-outside-card', weather: wx, height: HEADER_H, view_layout: thermos.length ? SPAN1 : SPAN_ALL });
        cards.push(headerGrid(hc));
      }
      // NO SIDE MARGINS OF THEIR OWN (2026-10-16, the user: Climate's pills
      // sat 12 px right of Lights'): layout-card's 4 px on each nested grid
      // -- the split, the stack, the room's grid -- added up. The stack keeps
      // the vertical 4 / 8 (a heading's room above its pills, as on Lights)
      // and drops the sides, so the room grids sit where Lights' do, the
      // tiles' own 4 px lining them up with the header cards (DESIGN.md,
      // Exact gaps)
      var stack = function (list) {
        return { type: 'custom:hk-grid-card', cards: list,
          layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': 'min-content',
                    'place-content': 'start stretch', 'grid-row-gap': '0px', 'card-margin': '4px 0px 8px', margin: '0px', padding: '0px' } };
      };
      var left = [], widest = 0;
      roomsWith(client, opts, function (id) {
        var d = id.split('.')[0];
        return d === 'fan' || d === 'humidifier' || (d === 'cover' && blinds[id]);
      }).forEach(function (r) {
        widest = Math.max(widest, r.entities.length);
        left.push(heading(r.name));
        left.push({ type: 'custom:hk-grid-card', cards: roomTiles(client, r, 'Climate', 'climate'), layout: pillGrid(27) });
      });
      var right = [];
      if (inv.climates.length) {
        right.push(heading('Thermostats'));
        right.push({ type: 'custom:hk-grid-card',
          // COUNTED BY THE NARROWEST DIAL (2026-10-16, the user: two nearly
          // fit at 1728): an `auto` track is counted by its minimum, 340, where
          // a 364 maximum counted one fewer; each dial asks for 364 and takes
          // its cell where that is less (dial_width), so the tracks grow to
          // 364 and no further, packed to the start the pills' gap apart
          layout: { 'grid-template-columns': 'repeat(auto-fill, minmax(min(100%, var(--hk-dial-min, 340px)), auto))',
                    'grid-auto-rows': 'min-content', 'place-content': 'start start',
                    // THE HOUSE GAP EXACTLY (DESIGN.md: 10 px both ways): no
                    // child margins, so the gaps are the grid's own; the
                    // padding puts the dials where the margins had them
                    'grid-column-gap': TL().gridGap + 'px', 'grid-row-gap': TL().gridGap + 'px', 'card-margin': '0px',
                    margin: '0px', padding: '4px 0px 15px 4px' },
          cards: inv.climates.map(function (id) {
            return { type: 'custom:hk-thermostat-card', entity: id, name: fullName(client, id), dial_width: 'var(--hk-dial, 364px)' };
          }) });
      }
      // THE ROOMS AS WIDE AS THEIR WIDEST ROOM NEEDS: two to four pills and
      // the gaps between them (no nested margins now); more than four wrap. The thermostats take the rest, as many dials across
      // as fit. On a narrower page the rooms give way first and the rail
      // keeps one dial (--hk-climate-dials in the iPad band, hk-responsive.css).
      var roomsW = (TL().w + TL().gridGap) * Math.max(2, Math.min(4, widest)) - TL().gridGap;
      var body = left.length && right.length
        ? { type: 'custom:hk-grid-card', cards: [stack(left), stack(right)],
            layout: { 'grid-template-columns': 'var(--hk-page-split, minmax(0, ' + roomsW + 'px) minmax(min(var(--hk-climate-dials, 364px), 364px), 1fr))',
                      // (-4 px at the side: its own margin in the page's
                      // column, which Lights' room grids, a level up, never
                      // pay; -8 px on top: that, and the stack's first 4 px)
                      'grid-column-gap': '28px', 'grid-row-gap': '0px', 'card-margin': '0px', margin: '-8px 0px 0px -4px', padding: '0px' } }
        : stack(left.length ? left : right);
      if (left.length || right.length) cards.push(column([body]));
      out.push(view({ title: 'Climate', icon: 'mdi:home-thermometer', path: 'climate', subview: true, sky_variant: 'climate',
                      background: '#0d1a1c', cards: cards }));
    }
    // DOORS & WINDOWS: the doors and the windows -- not the locks and the
    // garage door, which are Security's. Each tile carries its room as a
    // line above its name,
    // as the favorites do, so a name stays the accessory's own ("Left
    // Window", "Entry") however many rooms the page mixes.
    // ONE PAGE WITH SECURITY (2026-10-16, the user: the two covered the same
    // thing): where the house has an alarm, Security is where the doors and
    // windows are -- its status row counts them, its house shows them, its
    // chips open them as a list -- and there is no page of their own. A
    // house without an alarm (or a screen without its Security page) keeps
    // this page.
    if ((inv.doors.length || inv.windows.length) && !withSecurity) {
      var dw = [titleBar('Doors & Windows'), pageRow('doors_windows', opts)];
      if (inv.doors.length) dw.push(section('Doors', inv.doors.map(function (id) { return contactTile(client, id, 'hk:door-open', 'hk:door-closed'); }), true));
      if (inv.windows.length) dw.push(section('Windows', inv.windows.map(function (id) { return contactTile(client, id, 'hk:window-open-variant', 'hk:window-closed-variant'); }), true));
      out.push(view({ title: 'Doors & Windows', icon: 'mdi:window-closed-variant', path: 'doors-windows', subview: true, sky_variant: 'doors',
                      background: '#1c0e10', cards: dw }));
    }
    if (inv.timers.length) {
      // THE TIMERS PAGE: with the quick timers (helpers/quick_timers.yaml)
      // the whole page -- presets, what is running, the New Timer keypad;
      // without them, what is running.
      var quick = !!client.states['script.quick_timer_start'];
      var slots = ['timer.quick_1', 'timer.quick_2', 'timer.quick_3', 'timer.quick_4'];
      var tlist = [];
      if (quick) slots.forEach(function (id, i) {
        if (!client.states[id]) return;
        var t = { entity: id, label: 'Quick Timer ' + (i + 1), glyph: 'mdi:timer-outline' };
        if (client.states['input_text.quick_timer_' + (i + 1) + '_name']) t.label_entity = 'input_text.quick_timer_' + (i + 1) + '_name';
        tlist.push(t);
      });
      // ONE NAME PER TIMER on this page, in the running list and the house
      // row alike: "Nap - Timer" is a Nap under a Timers heading, as a tile
      // drops its room's name (the accessory's own name wins).
      var timerName = function (id) {
        var at = client.states[id].attributes || {};
        return accName(id) || String(at.friendly_name || id).replace(/\s*[-\u2013]?\s*timer\s*$/i, '') ||
          fullName(client, id);
      };
      // THE HOUSE TIMERS (Configure -> Your home -> House timers): one tap
      // each, named and pictured as the timers themselves are -- and first in
      // the running list, in their own order, as the hand-written page had them.
      var houseIds = (setting('features.house_timers') || []).filter(function (id) { return client.states[id]; });
      var running = inv.timers.filter(function (id) { return !(quick && slots.indexOf(id) >= 0); });
      houseIds.filter(function (id) { return running.indexOf(id) >= 0; })
        .concat(running.filter(function (id) { return houseIds.indexOf(id) < 0; }))
        .forEach(function (id) {
          var ent = (client.entities || {})[id] || {};
          tlist.push({ entity: id, label: timerName(id),
                       glyph: ent.icon || (client.states[id].attributes || {}).icon || 'hk:timer-sand' });
        });
      var house = houseIds.map(function (id) {
        var ent = (client.entities || {})[id] || {}, at = client.states[id].attributes || {};
        return { entity: id, name: timerName(id), icon: accIcon(id) || ent.icon || at.icon || 'mdi:timer-outline' };
      });
      // THE TIMERS PAGE (2026-10-16, PLAN-2026-10-16-utility-pages.md): the
      // status row; the header -- what finishes when, beside the quick
      // durations and Create a Timer (with the quick-timer helpers); then
      // what is running, each card at its own 388 px, and the House
      // Timers ready to start. Without the helpers, Finishing Order across.
      var tcards = [titleBar('Timers'), pageRow('timers', opts)];
      var TINT = 'rgba(255, 159, 10, 0.95)';
      // Quick Start's durations and names (HK Settings -> Pages -> Timers)
      var ht = headerOpts('timers');
      var presets = Array.isArray(ht.presets) && ht.presets.length ? ht.presets.slice(0, 6) : [5, 10, 15, 20, 30, 60];
      var chips = Array.isArray(ht.names) ? ht.names.slice(0, 6) : ['Pasta', 'Oven', 'Laundry', 'Tea', 'Kids', 'Break'];
      var theader = headerOn('timers');
      if (theader) {
        // the line's past: the quick timers and the House Timers -- the ones
        // people start -- not the automations' that cycle all day
        var mineT = (quick ? slots.filter(function (id) { return client.states[id]; }) : []).concat(houseIds);
        var th = [{ type: 'custom:hk-timers-order-card', timers: tlist, past: mineT, tint: TINT, height: HEADER_H, view_layout: quick ? SPAN2 : SPAN_ALL }];
        if (quick) th.push({ type: 'custom:hk-timers-start-card', tint: TINT, presets: presets,
          name_chips: chips, height: HEADER_H, view_layout: SPAN1 });
        tcards.push(headerGrid(th));
      }
      // A HIDDEN HEADER GIVES BACK WHAT IT HELD: Quick Start is the page's
      // own again -- the one-page Timers layout, presets beside what runs,
      // the House Timers under them
      if (!theader && quick) {
        tcards.push(column([{ type: 'custom:hk-timers-page-card', tint: TINT, empty_text: 'Nothing is running.',
          presets: presets, name_chips: chips, house: house, timers: tlist }]));
        out.push(view({ title: 'Timers', icon: 'mdi:timer-sand', path: 'timers', subview: true, sky_variant: 'timers',
          background: '#1e1408', cards: tcards }));
      } else {
        // (its own grid of 388 px cards, not the pills' 196 px tracks)
        tcards.push({ type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [heading('Running'),
          { type: 'custom:hk-grid-card', layout: { 'grid-template-columns': 'minmax(0, 1fr)', margin: '0px', padding: '0px' },
            cards: [{ type: 'custom:hk-timers-card', tint: TINT, timers: tlist,
              empty_text: quick ? 'Nothing is running. Start one above.' : 'Nothing is running.' }] }] });
        // the house timers that are idle; a running one is a card in Running
        if (house.length) {
          var hsec = section('House Timers', house.map(function (t) {
            return { type: 'conditional', conditions: [{ condition: 'state', entity: t.entity, state: 'idle' }],
              card: { type: 'custom:hk-tile-card', entity: t.entity, name: t.name, icon: t.icon, icon_color: 'orange', label_mode: 'duration',
                      tap_action: { action: 'perform-action', perform_action: 'timer.start', target: { entity_id: t.entity } } } };
          }));
          tcards.push({ type: 'conditional', view_layout: COL2,
            conditions: [{ condition: 'or', conditions: house.map(function (t) { return { condition: 'state', entity: t.entity, state: 'idle' }; }) }],
            card: hsec });
        }
        out.push(view({ title: 'Timers', icon: 'mdi:timer-sand', path: 'timers', subview: true, sky_variant: 'timers',
          background: '#1e1408', cards: tcards }));
      }
    }
    if (inv.vacuums.length) {
      // THE VACUUMS PAGE (2026-10-16, PLAN-2026-10-16-utility-pages.md): the
      // status row; the header -- the week's cleaning beside each vacuum's
      // last run; then the vacuums at their own 388 px, one under another,
      // with Clean Areas' rooms on a plate beside them (under them on a
      // phone). Each vacuum card carries the readings its own device has.
      // In the page's own order (the HK Settings page's drag list), the
      // rest after it.
      var vorder = ownOrder('vacuums', inv.vacuums);
      var vcards = vorder.map(function (id) {
        var v = { type: 'custom:hk-vacuum-card', entity: id, hk_place: { page: 'vacuums' } };
        var bat = sibling(client, id, 'battery');
        if (bat) v.battery = bat;
        var find = function (re, not) { return siblingLike(client, id, re, not); };
        var err = find(/operational_error|_error$/, /dock/);
        if (err) v.error = err;
        var dock = find(/dock.*error/);
        if (dock) v.dock_error = dock;
        var room = find(/current_room/);
        if (room) v.room = room;
        var prog = find(/cleaning_progress/);
        if (prog) v.progress = prog;
        return v;
      });
      // what the header reads for each: the vacuum, its error sensor, and
      // the mission counters a vacuum that keeps them has (a Roomba's), the
      // one sure word that a run finished
      // Counters chosen on HK Settings -> Pages -> Vacuums are read in place
      // of those found: each goes to the vacuum on its device (to the only
      // vacuum when there is one), and says by its name which it counts.
      var picked = (headerOpts('vacuums').counters || []).filter(function (id) { return client.states[id]; });
      var devOf = function (id) { return ((client.entities || {})[id] || {}).device_id || null; };
      var vruns = vorder.map(function (id, i) {
        var mine = picked.filter(function (c) { return vorder.length === 1 || (devOf(c) && devOf(c) === devOf(id)); });
        var find = picked.length
          ? function (re) { return mine.filter(function (c) { return re.test(c); })[0] || null; }
          : function (re) { return siblingLike(client, id, re); };
        var r = { entity: id };
        if (vcards[i].error) r.error = vcards[i].error;
        var ok = find(/successful_(missions|cleans?)$/), bad = find(/failed_(missions|cleans?)$/), cut = find(/cancel+ed_(missions|cleans?)$/);
        if (ok) r.success = ok;
        if (bad) r.failed = bad;
        if (cut) r.canceled = cut;
        return r;
      });
      var vpage = [titleBar('Vacuums'), pageRow('vacuums', opts)];
      if (headerOn('vacuums')) {
        vpage.push(headerGrid([
          { type: 'custom:hk-vacuum-week-card', vacuums: vruns, height: HEADER_H, view_layout: SPAN2 },
          { type: 'custom:hk-vacuum-last-card', vacuums: vruns, height: HEADER_H, view_layout: SPAN1 }]));
      }
      // the vacuums' column: 388 px cards, 10 px apart, never stretched to
      // fill a wide page -- 412 of track: the card sits three grids deep and
      // each gives a child 4 px a side (measured 2026-10-16)
      var VAC_W = 388 + 24;
      // 10 APART: each in a grid of its own, whose margins collapse against
      // its neighbors' (hk-layout.js) -- the card's own 4 px top and 8 px
      // bottom, less 1 px each way, are the 10
      var vstack = { type: 'custom:hk-grid-card', cards: vcards.map(function (v, i) {
          // (the first one's top level with the plate beside it)
          return { type: 'custom:hk-grid-card', cards: [v],
            layout: { 'grid-template-columns': 'minmax(0, 1fr)', margin: (i ? '-1px' : '-4px') + ' -4px -1px -4px', padding: '0px' } };
        }),
        layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': 'min-content',
                  'grid-row-gap': '0px', margin: '0px', padding: '0px' } };
      // CLEAN BY AREA: the picker's rooms are Clean Areas': the
      // ones a vacuum's room map reaches, or those chosen on HK Settings
      // -> Clean by Area -- asked live by the card, so a change there reaches
      // an open screen, and an area no vacuum reaches is not offered.
      var picker = added('clean_areas') || setting('features.vacuum_script');
      // each column its heading and its body, so a phone reads them in order
      // (the second loses the 4 px top margin a grid's first child keeps:
      // `top` puts it back, so the two headings share a line)
      var vst = function (list, top, left) {
        return { type: 'custom:hk-grid-card', cards: list,
          layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-rows': 'min-content', 'place-content': 'start stretch',
                    'grid-row-gap': '0px', margin: left ? '0px 0px 0px var(--hk-split-pull, ' + left + 'px)' : '0px', padding: (top || 0) + 'px 0px 0px 0px' } };
      };
      var vbody = picker
        ? { type: 'custom:hk-grid-card',
            layout: { 'grid-template-columns': 'var(--hk-page-split, minmax(0, ' + VAC_W + 'px) minmax(var(--hk-rail, 0px), 1fr))',
                      'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' },
            cards: [vst([heading('Vacuums'), vstack]), vst([heading('Clean Areas'), { type: 'custom:hk-area-select-card', layout: 'panel' }], 4, -12)] }
        : { type: 'custom:hk-grid-card', cards: [vst([heading('Vacuums'), vstack])],
            layout: { 'grid-template-columns': 'minmax(0, ' + VAC_W + 'px)', 'grid-row-gap': '0px', margin: '0px', padding: '0px' } };
      // the column pays back the nesting so the cards' left edge is the
      // header's and the plate's right edge is too (the headings keep their
      // usual 4 px inset)
      var vcol = column([vbody]);
      vcol.layout = Object.assign({}, vcol.layout, { margin: '0px var(--hk-split-r, -8px) 0px -12px' });
      vpage.push(vcol);
      out.push(view({ title: 'Vacuums', icon: 'mdi:robot-vacuum', path: 'vacuums', subview: true, sky_variant: 'vacuums',
        background: '#170f14', cards: vpage }));
    }
    return out;
  }

  // IS MUSIC SET UP? Asked of the feature itself, once; if it is not
  // installed the subscribe is refused, which answers no. The page's own
  // hkMusic has not been handed its configuration yet when a dashboard is
  // generated (no card has attached it), so it cannot say.
  function musicConfigured(client) {
    return new Promise(function (resolve) {
      // the client's subscription port (its read allowlist offers hk_music/subscribe)
      var conn = client && client.subscriptions, done = false, unsub = null;
      // an unsubscribe the server refuses (the socket reconnected meanwhile)
      // is not an error: never an uncaught rejection
      var end = function (u) { var r = u(); if (r && r.catch) r.catch(function () {}); };
      function finish(v) {
        if (done) return;
        done = true;
        if (unsub) end(unsub);
        resolve(v);
      }
      if (!conn || typeof conn.subscribeMessage !== 'function') return finish(false);
      // THE BOUND STARTS NOW, not once the subscribe is accepted: on a
      // connection that is down, that acceptance waits for the reconnect.
      setTimeout(function () { finish(false); }, 4000);
      conn.subscribeMessage(function (ev) {
        finish(!!(ev && ev.configured && ev.speakers && ev.speakers.length));
      }, { type: 'hk_music/subscribe' }).then(function (u) {
        unsub = u;
        if (done) end(u);
      }, function () { finish(false); });
    });
  }

  // ------------------------------------------------ this dashboard's item
  // Its Home and Pages settings (1.7): the item under Dashboards whose url
  // path is this one. None: every default.
  function dashSeg() {
    try { return String(location.pathname).split('/')[1] || ''; } catch (e) { return ''; }
  }
  function boardOf(seg) {
    var all = setting('boards') || {};
    var b = all[seg === undefined ? dashSeg() : seg];
    return (b && typeof b === 'object') ? b : {};
  }
  function listOf(b, k) { return Array.isArray(b[k]) ? b[k] : []; }

  // A HOME GRID SCREEN'S HOME (docs/phase11/HOME-GRID.md): the screen's
  // home_grid (checked by hk_core) as an hk-home-grid-view -- the band's card
  // first when the band is on, a card per block from the catalog
  // (hk-grid-catalog.js) with its cell, then the cards that only listen.
  // `ctx`: the house as this screen sees it, for a block naming nothing.
  function homeGridView(grid, o, header, listeners, ctx) {
    var cards = [];
    if (grid.band !== false && header) {
      // A Home Grid has 60 px for its band, not the full page header's 150+.
      var parts = header.cards || [], chip = parts.find(function (c) { return c.type === 'custom:hk-chips-card'; });
      var band = { type: 'custom:hk-header-card', grid_band: true, show_clock: grid.header_clock !== false,
        show_weather: grid.header_weather !== false, chips: chip || null, hk_band: true };
      cards.push(band);
    }
    (grid.items || []).forEach(function (it) {
      // (Hide Box: the block's own, or the screen's No Boxes -- the cell says so to every card inside it)
      cards.push(Object.assign(window.hkGridCatalog.config(it, ctx),
                               { hk_cell: { id: it.id, size: it.size, at: it.at, bare: !!it.bare || grid.boxes === false, view: it.view || 0 } }));
    });
    (listeners || []).forEach(function (c) { cards.push(c); });
    return Object.assign({}, o, { type: 'custom:hk-home-grid-view', layout: undefined, cards: cards, grid_ctx: ctx,
                                  grid: Object.assign({ cols: grid.cols, rows: grid.rows, band: grid.band !== false, scale: grid.scale },
                                                      grid.grow === true ? { grow: true } : {}, grid.night && grid.night.mode !== 'off' ? { night: grid.night } : {},
                                                      grid.views > 1 ? { views: grid.views } : {}) });
  }
  // the catalog, when a Home Grid screen needs it: a parallel-loaded
  // resource, waited for by its ready event, never polled (cardsReady)
  function gridReady() {
    if (window.hkGridCatalog) return Promise.resolve();
    return new Promise(function (res) {
      window.addEventListener('hk-grid-catalog-ready', function () { res(); }, { once: true });
    });
  }

  // THE CAMERA STRIP: its measured structure and numbers
  // (one live tile, the rest stills, in a mosaic that scrolls), inside the
  // per-dashboard wrapper that sets the nesting depth the rows align by.
  function cameraStrip(client, opts, b, page) {
    if (b.camera_strip === false) return null;
    var ids = listOf(b, 'cameras').length ? listOf(b, 'cameras').filter(function (id) { return client.states[id]; })
                                          : houseCameras(client, opts);
    ids = ids.filter(function (id) { return !hidden(client, opts, id); });
    if (!ids.length) return null;
    var head = heading('Cameras');
    if (page) head.navigation_path = './cameras';
    return { type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [
      { type: 'grid', columns: 1, square: false, cards: [head, {
        type: 'custom:hk-grid-card',
        layout: { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-auto-flow': 'row', 'grid-column-gap': '12px',
                  'grid-row-gap': '12px', margin: '-14px -22px -49px -22px', padding: '0px' },
        cards: [{ type: 'custom:hk-row-card', card_width: 'fit-content', pad_top: '14px', pad_bottom: '30px',
                  pad_left: '22px', pad_right: '22px', cards: [{
                    type: 'custom:hk-camera-mosaic-card', height: 195, seam: 2, snapshot_cap: '480x270',
                    max_upscale: 1.2, show_age: true,
                    cameras: ids.map(function (id) { return { entity: id, name: fullName(client, id) }; }) }] }] },
        // ...and the strip's closing 22 px: 30 px to the scenes with the gap.
        { type: 'custom:hk-spacer-card', height: '22px' }] }] };
  }
  // FAVORITES: the tiles the item picked, as the Home app's Favorites draws
  // them -- one height, the ROOM above the name (hk-favorite-card) -- in the
  // favorite shapes: a lock says
  // "Locked", a garage door "Closed", a thermostat its reading and setpoint.
  function areaName(client, id) {
    var ents = client.entities || {}, devs = client.devices || {}, areas = client.areas || {};
    var e = ents[id] || {};
    var a = e.area_id || (e.device_id && devs[e.device_id] && devs[e.device_id].area_id);
    return (a && areas[a] && areas[a].name) || '';
  }
  // A FAVORITE is its room tile on the favorites row, with what the
  // accessory's gear gives it AS a favorite: its name and glyph
  // there ("Garage Door" where its room tile is "Door"), and the lights it
  // controls together with ("Main + Table Lights") -- and the state text a
  // favorite reads: a light its brightness, a switch On / Off.
  function favTile(client, id) {
    var fa = accOf(id) || {};
    // its room line: the accessory's own as a favorite (a helper with no
    // area), else its area's
    var d = id.split('.')[0], st = client.states[id], area = areaName(client, id), room = fa.fav_room || area;
    // shortened by its real room only: a room line of its own is just words
    // ("Office" over Office Lights, a group with no area)
    var name = fa.fav_name || accName(id) || shortName(nameOf(client, id, (client.entities || {})[id]), area);
    var dc = st && st.attributes && st.attributes.device_class;
    if (d === 'climate' || d === 'water_heater') {
      return { type: 'custom:hk-climate-card', entity: id, name: name, room: room, icon_color: 'blue',
               label_mode: 'setpoint' };
    }
    var base = { type: 'custom:hk-favorite-card', entity: id, name: name, room: room };
    // the accessory's own glyph (its gear) over the favourite's usual one, at
    // that glyph's measured size (without it every picked glyph would draw 23 px)
    var mine = function (t) {
      var own = favIcon(fa) || accIcon(id);
      if (own && own !== t.icon) { t.icon = own; delete t.icon_states; delete t.icon_size; sized(t, FAV_PX); }
      return t;
    };
    if (d === 'lock') {
      return mine(Object.assign(base, { icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open-variant' },
                                        icon_size: '23px', icon_color: 'mint', label_mode: 'sentence' }));
    }
    if (d === 'cover' && (dc === 'garage' || dc === 'gate')) {
      return mine(Object.assign(base, { icon: 'hk:garage-variant', icon_size: '26px', icon_color: 'mint',
        icon_states: { open: 'hk:garage-open-variant', opening: 'hk:garage-open-variant' }, label_mode: 'open_closed' }));
    }
    var t = tileFor(client, id, name);
    if (!t) return base;
    t = Object.assign({}, t, { type: 'custom:hk-favorite-card', room: room });
    delete t.view_layout;                     // one height, like every favorite
    delete t.size;                            // ...whatever the accessory's own size
    delete t.hk_place;                        // its place here is the favorites'
    delete t.animation;                       // ...and its still glyph (a fan's Spin is its tile's)
    // A LIGHT GROUP (its members: membersOf) reads how many are on, "2 On",
    // as the hand-written favorites did; a blind its position.
    var members = d === 'light' && membersOf(st)
      ? membersOf(st).filter(function (x) { return x !== id && client.states[x]; }) : [];
    if (members.length) { t.label_mode = 'group_count'; t.group = members; }
    else if (d === 'light') t.label_mode = 'brightness';
    else if (d === 'switch' || d === 'input_boolean') t.label_mode = 'on_off';
    else if (d === 'cover') t.label_mode = 'position';
    mine(t);
    var together = (Array.isArray(fa.fav_with) ? fa.fav_with : []).filter(function (x) {
      return x !== id && client.states[x];
    });
    if (together.length && (d === 'light' || d === 'switch' || d === 'input_boolean')) {
      var all = [id].concat(together);
      var lights = all.every(function (x) { return x.split('.')[0] === 'light'; });
      t.group = all;
      t.group_lit = 'any';
      if (d === 'light') t.label_mode = 'group_brightness';
      t.tap_action = { action: 'perform-action', perform_action: lights ? 'light.toggle' : 'homeassistant.toggle',
                       target: { entity_id: all } };
    }
    return t;
  }
  function favIcon(fa) {
    var v = fa && fa.fav_icon ? String(fa.fav_icon) : '';
    return v ? (/^mdi:/.test(v) ? 'hk:' + v.slice(4) : v) : null;
  }
  function favorites(client, opts, b) {
    var tiles = listOf(b, 'favorites').filter(function (id) { return client.states[id]; }).map(function (id) {
      return placed(favTile(client, id), { fav: true });
    });
    if (!tiles.length) return null;
    // The favorites grid: 9 px below, where a room's is 11.
    return { type: 'grid', columns: 1, square: false, view_layout: COL2, cards: [heading('Favorites'),
      { type: 'custom:hk-grid-card', layout: pillGrid(17, true), cards: tiles }] };
  }

  // ONE PAGE THAT CANNOT BE BUILT IS ONE PAGE, NOT THE DASHBOARD. Home
  // Assistant replaces EVERY view with one "Error loading the dashboard
  // strategy" card when generate() throws -- on a wall tablet, the whole
  // screen until it is reloaded. So the category pages and each room page are
  // built guarded: one that throws is logged and left out (a room page says
  // so in its place, as its heading on Home still links to it).
  function guarded(label, build, instead) {
    try { return build(); } catch (e) {
      try { console.error('[hk-strategy] could not build ' + label, e); } catch (x) { /* no console */ }
      return instead ? instead(e) : null;
    }
  }

  function views(client, opts, music) {
    var themes = (client.themes && client.themes.themes) || {};
    var theme = opts.theme || kioskTheme(themes);
    var sky = opts.sky !== false;
    var weather = (window.hkSettings && window.hkSettings.weatherId(client.states)) || firstOf(client, 'weather');
    var alarm = setting('security.alarm') || firstOf(client, 'alarm_control_panel');
    // Left out means left out everywhere -- its page and its header link too.
    if (weather && hidden(client, opts, weather)) weather = null;
    if (alarm && hidden(client, opts, alarm)) alarm = null;

    function view(o) {
      var v = Object.assign({ type: 'custom:hk-grid-view', layout: VIEW_LAYOUT, background: '#05070e' }, o);
      if (theme) v.theme = theme;
      if (o.sky_variant) { delete v.sky; if (!sky) delete v.sky_variant; }
      else if (sky && o.sky !== false) v.sky = true; else delete v.sky;
      return v;
    }

    var inv = inventory(client, opts);
    // THE CHIP ROW is the dashboard's own (hk-chips-card): which chips, their
    // order and which are quiet come from its item, live -- no rebuild.
    // `in_menu: false`: a generated screen's menu lists every page under
    // Categories, not only the chips' pages (hk-menu.js chipPaths).
    var row = opts.chips === false || (opts.board || {}).chips_row === false ? null
            : { type: 'custom:hk-chips-card', in_menu: false };
    // THIS DASHBOARD'S PAGES (its item's Pages; empty: every page the house
    // has something for), in its order. A page left out is left out of the
    // menu and of every link to it.
    var b = opts.board || {};
    var picked = listOf(b, 'pages');
    var want = function (k) { return picked.length ? picked.indexOf(k) >= 0 : true; };
    // The cameras the item picked for its strip are the Cameras page's too
    // (a house's high-resolution channels and tablet cameras stay off both).
    var cams = listOf(b, 'cameras').length
      ? listOf(b, 'cameras').filter(function (id) { return client.states[id] && !hidden(client, opts, id); })
      : houseCameras(client, opts);
    var hasCams = cams.length > 0 && want('cameras');
    if (!want('weather')) weather = null;
    var alarmId = alarm;                // the #alarm pop-up needs no Security page
    if (!want('security')) alarm = null;
    if (!want('music')) music = false;
    var hdr = { type: 'custom:hk-header-card', weather_path: weather ? './weather' : undefined,
                alarm_path: alarm ? './security' : undefined };
    // ON PHONES (its Home Page's setting): the clock and weather
    // header, or under 640 px the one-line weather strip in its place
    // IN A CAR'S BROWSER, ITS OWN HOME (the screen's Car Layout: Car Home):
    // the weather and the house's status in one line -- no clock, the car
    // shows the time -- then the chips, the camera strip where it is on,
    // Scenes, Security and Favorites, and no rooms: what the car needs in
    // one screen.
    var carHome = !!(b.car && b.car_layout === 'car');
    if (carHome) hdr.clock = false;
    var tops = b.phone_header === 'strip' && !carHome
      ? [{ type: 'conditional', conditions: [{ condition: 'screen', media_query: '(min-width: 640px)' }], card: hdr },
         { type: 'conditional', conditions: [{ condition: 'screen', media_query: '(max-width: 639.98px)' }],
           card: Object.assign({ type: 'custom:hk-weather-strip-card', margin: '30px 0px 23px 0px' },
                               weather ? { tap_action: { action: 'navigate', navigation_path: './weather' } } : {}) }]
      : [hdr];
    var header = { type: 'grid', columns: 1, square: false, view_layout: COL2, cards: tops.concat(row ? [row] : [], [
      { type: 'custom:hk-spacer-card', height: '2px' }]) };
    // HOME, in this order: the header and
    // chips, the camera strip, the scenes, the favorites, then the rooms.
    var home = [header];
    var strip = cameraStrip(client, opts, b, hasCams);
    if (strip) home.push(strip);
    home.push({ type: 'custom:hk-scenes-card', view_layout: COL2 });
    // CAR HOME'S SECURITY: the house's garage doors, its alarm and its locks
    // (Status & Chips' lists, the Security page's own order), as a room draws
    // them -- tall tiles -- so arriving and leaving are one look and a tap
    if (carHome) {
      var gates = inv.garage.filter(function (id) { return id.indexOf('cover.') === 0; });
      var guardIds = ownOrder('security', gates).concat(alarmId ? [alarmId] : [], ownOrder('security', inv.locks));
      guardIds = guardIds.filter(function (id) { return client.states[id]; });
      // the names the Security page gives them ("Front Door", not "Front Door
      // Lock"), but the house's alarm without a room in front of it, and a
      // lock that would read like another tile keeping its "Lock" (Garage
      // Door Lock beside the Garage Door)
      var full = guardIds.map(function (id) {
        return id.indexOf('alarm_control_panel.') === 0 ? (accName(id) || nameOf(client, id, (client.entities || {})[id])) : fullName(client, id);
      });
      var short = full.map(function (n, i) { return guardIds[i].indexOf('lock.') === 0 ? n.replace(/ Lock$/, '') : n; });
      var guardTiles = guardIds.map(function (id, i) {
        var clash = short.some(function (n, j) { return j !== i && fold(n) === fold(short[i]); });
        return tileFor(client, id, clash ? full[i] : short[i]);
      }).filter(Boolean);
      if (guardTiles.length) home.push(section('Security', guardTiles));
    }
    var fav = favorites(client, opts, b);
    if (fav) home.push(fav);
    // Play Music is reached from the Speakers chip, the menu and a scene pill
    // (Home -> Scenes -> Pills that open a page) -- not a heading of its own
    // between Favorites and the rooms.
    if (!carHome) rooms(client, opts).forEach(function (r) {
      var sec = guarded('the ' + r.name + ' section of Home', function () { return roomSection(client, r); });
      if (sec) home.push(sec);
    });
    // THE #alarm POP-UP. An alarm automation may open
    // `<dashboard>/0#alarm` on the tablets, and a Home with nothing
    // listening would just show Home. An Alarm pop-up ITEM (HK Settings
    // -> Pop-ups) answers #alarm on every dashboard with its own Close
    // after -- and a card here would claim the hash first, so the item's
    // settings would never apply on a generated dashboard (the keypad would
    // close after the default minute, not the item's). So this card is only
    // for a house with no Alarm item for this dashboard, and not where the
    // dashboard refuses pop-ups.
    var popups = [];
    var seg = dashSeg();
    var alarmItem = (setting('popups') || []).some(function (p) {
      return p && p.hash === 'alarm' && (!p.dashboards || !p.dashboards.length || p.dashboards.indexOf(seg) >= 0);
    });
    if (alarmId && !alarmItem && b.popups !== false) {
      popups.push({ type: 'custom:hk-popup-card', hash: '#alarm', detail: alarmId, name: 'Alarm' });
    }
    // its Screen page's Now Playing Bar (with music set up) and Timer Bar (with
    // the quick timers) -- one docked bar, either part or both. (A screen
    // saved before the Timer Bar had it with its Now Playing Bar.)
    var npOn = !!(b.now_playing && music);
    var tbOn = (b.timer_bar === undefined ? !!b.now_playing : !!b.timer_bar) && !!client.states['sensor.running_quick_timers'];
    var dockBar = npOn || tbOn ? mediaBar(npOn, tbOn) : null;
    if (dockBar) popups.push(dockBar);
    if (popups.length) {
      home.push({ type: 'custom:hk-grid-card', view_layout: COL2,
        layout: { 'grid-template-columns': '1fr', 'grid-column-gap': '0px', 'grid-row-gap': '0px',
                  margin: '0px', padding: '0px' },
        cards: popups });
    }

    var out = [view({ title: 'Home', path: 'home', cards: home })];
    // A HOME OF ITS OWN (its Pages page -> Home): one of the house's custom
    // pages in place of the generated Home, and the rest of the screen
    // generated as usual -- a car's own first page, say, over the house's
    // Lights, Climate and Cameras. The page keeps its address and is called
    // Home, as the generated one is (the menu, HA's header, the tab). A page
    // that is gone leaves the generated Home.
    var own = (opts.board || {}).home_view ? customView(opts.board.home_view) : null;
    if (own) {
      own.title = own.menu_title = 'Home';
      if (!own.icon) own.icon = 'mdi:home';
      out[0] = own;
    }
    // HOME GRID (its Home Style: Home Grid, with a layout): Home is the
    // screen's own grid (hk-home-grid-view) -- its band the header above, its
    // blocks from the catalog, and the pop-ups Home listens for -- and the
    // rest of the screen as usual
    else if (b.home_style === 'grid' && b.home_grid && window.hkGridCatalog) {
      var gridClimate = Object.keys(client.states).filter(function (id) {
        return id.indexOf('climate.') === 0 && !hidden(client, opts, id);
      }).sort();
      // for pages that swipe (G4): the room of each camera and thermostat,
      // and the scenes -- the screen's Scenes choice, else every scene A to Z
      var gridAreas = {};
      (cams || []).concat(gridClimate).forEach(function (id) { gridAreas[id] = areaOf(client, id); });
      var gridScenes = listOf(b, 'scenes').filter(function (id) {
        return typeof id === 'string' && id.indexOf('scene.') === 0 && client.states[id];
      });
      if (!gridScenes.length) {
        gridScenes = Object.keys(client.states).filter(function (id) {
          var e = (client.entities || {})[id];
          return id.indexOf('scene.') === 0 && !hidden(client, opts, id) && !(e && (e.hidden || e.entity_category));
        }).sort(function (x, y) { return named(client, x, '').localeCompare(named(client, y, '')); });
      }
      out[0] = view(homeGridView(b.home_grid, { title: 'Home', path: 'home' }, header, popups, {
        cameras: cams, weather: weather || firstOf(client, 'weather'), vacuum: firstOf(client, 'vacuum'),
        battery: houseBattery(),
        climate: gridClimate, areas: gridAreas, scenes: gridScenes,
        rooms: rooms(client, opts).map(function (r) { return r.id; }).filter(Boolean)
      }));
    }
    var pages = {};
    if (opts.pages !== false) {
      guarded('the category pages', function () {
        categoryPages(client, opts, inv, view, !!alarm).forEach(function (v) { pages[v.path] = v; });
      });
    }

    if (weather) {
      // THE WEATHER PAGE (2026-10-16, hk_house/docs/PLAN-2026-10-16-weather-page.md):
      // the conditions over the sky, any alert in effect, the hours, the
      // radar beside the days, then the details -- each part as
      // weather.page says (hkSettings.weatherPage), the radar as
      // weather.radar_native says (HK's own, hk-radar.js; the Weather Radar
      // Card from HACS is no longer drawn here). 10 px between the cards
      // both ways (card-margin 0: DESIGN.md, Exact gaps). `enter`: each
      // card's place in the page's entrance (hk-weather.js wxEnter).
      var HSW = window.hkSettings;
      var wpg = HSW && HSW.weatherPage ? HSW.weatherPage()
        : { show_current: true, show_hourly: true, show_daily: true, show_alerts: true, details: ['wind', 'sun', 'uv', 'humidity', 'moon', 'pressure'] };
      var radarOn = !!(HSW && HSW.radarNative && HSW.radarNative().enabled);
      var gap = { 'grid-row-gap': '10px', 'grid-column-gap': '10px', 'card-margin': '0px', margin: '0px', padding: '0px' };
      var body = [], enter = 0;
      if (wpg.show_current) body.push({ type: 'custom:hk-weather-band-card', section: 'hero', entity: weather, enter: enter++ });
      var alerts = setting('weather.alerts');
      if (alerts && wpg.show_alerts) {
        body.push({ type: 'conditional',
          conditions: [{ condition: 'numeric_state', entity: alerts, above: 0 }],
          card: { type: 'custom:hk-alert-card', entity: alerts, title: 'Severe Weather', icon: 'mdi:alert', details: true } });
      }
      if (wpg.show_hourly) body.push({ type: 'custom:hk-weather-band-card', section: 'hourly', entity: weather, enter: enter++ });
      var pair = [];
      if (radarOn) pair.push({ type: 'custom:hk-radar-card' });
      if (wpg.show_daily) pair.push({ type: 'custom:hk-weather-band-card', section: 'daily', entity: weather });
      if (pair.length) {
        pair.forEach(function (c) { c.enter = enter; });
        enter++;
        body.push({ type: 'custom:hk-grid-card', cards: pair, layout: Object.assign({
          'grid-template-columns': pair.length > 1 ? 'var(--hk-wx-pair, minmax(0, 2fr) minmax(310px, 1fr))' : 'minmax(0, 1fr)' }, gap) });
      }
      if (wpg.details && wpg.details.length) body.push({ type: 'custom:hk-weather-details-card', entity: weather, enter: enter++ });
      pages.weather = view({ title: 'Weather', path: 'weather', subview: true, icon: 'mdi:weather-partly-cloudy',
                      menu: 'top', cards: [titleBar('Weather'), column([{ type: 'custom:hk-grid-card', cards: body,
                        layout: Object.assign({ 'grid-template-columns': 'minmax(0, 1fr)' }, gap) }])] });
    }

    // CAMERAS: every camera live, three across -- opened one after another
    // (hk-camera-live-card, hk-cameras.js: nine at once never connected in
    // desktop Safari).
    if (hasCams) {
      pages.cameras = view({ title: 'Cameras', path: 'cameras', subview: true, icon: 'mdi:camera', menu: 'top',
        sky_variant: 'cameras', background: '#080a0e', cards: [titleBar('Cameras'), column([{
          type: 'custom:hk-grid-card',
          // the house's gap both ways and no margins of their own, so the
          // tiles sit on the page's edges as every plate does (DESIGN.md
          // "Page edges"; their default 4 px put them 4 px in)
          layout: { 'grid-template-columns': 'var(--hk-cameras, repeat(3, minmax(0, 1fr)))', 'grid-column-gap': TL().gridGap + 'px',
                    'grid-row-gap': TL().gridGap + 'px', 'card-margin': '0px', margin: '0px', padding: '0px' },
          cards: cams.map(function (id) {
            return { type: 'custom:hk-camera-live-card', entity: id, aspect_ratio: '16x9', fit_mode: 'cover' };
          }) }])] });
    }

    // THE CALENDAR, when the house has a calendar (All Screens -> Calendar
    // chooses which, and their colours -- read live by the card, so neither
    // rebuilds anything): the month, week or day, and its events to add,
    // change and delete.
    var HS0 = window.hkSettings;
    var cals = (HS0 && HS0.calendarIds ? HS0.calendarIds(client.states)
                : Object.keys(client.states).filter(function (k) { return k.indexOf('calendar.') === 0; }))
      .filter(function (id) { return !hidden(client, opts, id); });
    if (want('calendar') && cals.length) {
      pages.calendar = view({ title: 'Calendar', path: 'calendar', subview: true, icon: 'mdi:calendar-month', sky_variant: 'calendar', background: '#0e1a18',
        cards: [titleBar('Calendar'), column([{ type: 'custom:hk-calendar-card' }])] });
    }

    // LIVE TV, when the Live TV feature is added (its guide knows the channels).
    if (want('live_tv') && added('live_tv')) {
      pages.live_tv = view({ title: 'Live TV', path: 'live-tv', subview: true, icon: 'mdi:television', menu: 'top',
        sky_variant: 'cameras', background: '#080a0e', cards: [titleBar('Live TV'), column([
          // (on the page's own edges, as every page: DESIGN.md "Page edges")
          { type: 'custom:hk-tv-guide-card' }], { layout: { 'grid-template-columns': 'minmax(0, 1fr)',
            margin: '0px', padding: '0px' } })] });
    }

    // SECURITY: the keypad and the page's header, then the locks and garage
    // doors -- from the page's left edge, under its title and status row, as
    // every other page's content starts.
    if (alarm) {
      // the locks, then the garage doors -- or the page's own order
      // (Accessories -> Locks -> Tile Order)
      var guards = ownOrder('security', inv.locks.concat(inv.garage.filter(function (id) { return id.indexOf('cover.') === 0; })))
        .map(function (id) {
          // (its place: Security's own page order, accessory/page_order)
          if (id.indexOf('lock.') === 0) {
            return { type: 'custom:hk-tile-card', entity: id, name: fullName(client, id).replace(/ Lock$/, ''),
                     icon: 'hk:lock', icon_states: { unlocked: 'hk:lock-open-variant' }, icon_color: 'mint',
                     label_mode: 'title', hk_place: { page: 'security' } };
          }
          return { type: 'custom:hk-tile-card', entity: id, name: fullName(client, id), icon: 'hk:garage-variant',
                   icon_states: { open: 'hk:garage-open-variant', opening: 'hk:garage-open-variant' },
                   icon_color: 'mint', label_mode: 'title', hk_place: { page: 'security' } };
        });
      // THE SECURITY PAGE (2026-10-15): the keypad in its own box (the
      // state as its badge, whether the entry points are closed under it),
      // beside it the header -- the house with its ways in and today's
      // activity, and Device Care while something needs it -- at the
      // keypad's height; then the locks and garage doors, full width. The
      // keypad's column is 360 (the iPad band and a phone: --hk-sec-cols).
      var entries = inv.doors.concat(inv.windows, inv.garage);
      var keypad = { type: 'custom:hk-alarm-keypad-card', entity: alarm, boxed: true, entries: entries };
      var top = headerOn('security')
        ? { type: 'custom:hk-grid-card', cards: [keypad, { type: 'custom:hk-security-overview-card', alarm: alarm,
              locks: inv.locks, doors: inv.doors, windows: inv.windows, garage: inv.garage, leaks: inv.leaks || [] }],
            // (368: the keypad's 360 box and its 4 px side margins)
            layout: { 'grid-template-columns': 'var(--hk-sec-cols, 368px minmax(0, 1fr))', 'grid-column-gap': (TL().gridGap - 8) + 'px',
                      'grid-row-gap': '0px', 'place-items': 'stretch', margin: '0px', padding: '0px' } }
        : { type: 'custom:hk-grid-card', cards: [keypad],
            layout: { 'grid-template-columns': 'minmax(0, 368px)', 'grid-column-gap': '0px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' } };
      var topCol = column([top]);
      topCol.layout = Object.assign({}, topCol.layout, { margin: '0px -4px' });
      var scards = [titleBar('Security'), pageRow('security', opts), topCol];
      if (guards.length) scards.push(section('Locks', guards));
      pages.security = view({ title: 'Security', path: 'security', subview: true, icon: 'mdi:lock',
        sky_variant: 'security', background: '#161823', cards: scards });
    }

    // WATER (2026-10-16, PLAN-2026-10-16-utility-pages.md): the status row;
    // the header -- the day's water from the Energy settings' meter beside
    // the main supply valve -- then any other valves, then the leak sensors
    // room by room. A quiet sensor's "No Report" is how these sensors are
    // between events (the user, 2026-10-16), so it is said plainly in its
    // tile and never raised as a warning; a leak is the tile's red.
    var valves = inv.valves || [];
    if (opts.pages !== false && ((inv.leaks && inv.leaks.length) || valves.length)) {
      var wet = {};
      inv.leaks.forEach(function (id) { wet[id] = true; });
      var byRoom = roomsWith(client, Object.assign({}, opts, { include_entities: [].concat(opts.include_entities || [], inv.leaks) }),
                             function (id) { return !!wet[id]; });
      // THE MAIN SUPPLY: the water valve named for it (main, supply,
      // shut-off), else the only one -- unless that one waters a garden
      // (a sprinkler is never the house's supply)
      var vname = function (id) { return fullName(client, id) + ' ' + id; };
      // (or the one chosen on HK Settings -> Pages -> Water)
      var hw = headerOpts('water');
      var supply = (hw.supply && client.states[hw.supply] ? hw.supply : null) ||
                   valves.filter(function (id) { return /main|supply|shut.?off/i.test(vname(id)); })[0] ||
                   (valves.length === 1 && !/sprinkl|irrigat|garden|drip|hose|lawn|zone|pool/i.test(vname(valves[0])) ? valves[0] : null);
      var wcards = [titleBar('Water'), pageRow('water', opts)];
      if (headerOn('water')) {
        // the usage card leaves itself out when no water meter is set up
        var wday = { type: 'custom:hk-water-day-card', height: HEADER_H, view_layout: supply ? SPAN2 : SPAN_ALL };
        if (hw.meter) wday.meter = hw.meter;
        wcards.push(headerGrid([wday]
          .concat(supply ? [{ type: 'custom:hk-water-supply-card', entity: supply, height: HEADER_H, view_layout: SPAN1 }] : [])));
      }
      var others = valves.filter(function (id) { return !headerOn('water') || id !== supply; });
      // (a chosen supply that is a switch, not one of the valves, too)
      if (!headerOn('water') && supply && valves.indexOf(supply) < 0) others.unshift(supply);
      if (others.length) wcards.push(section('Valves', others.map(function (id) { return tileFor(client, id, fullName(client, id)); })));
      byRoom.forEach(function (r) {
        wcards.push(section(r.name, r.entities.map(function (id) {
          return placed({ type: 'custom:hk-tile-card', entity: id, name: friendly(client, id, r.name), icon: 'hk:water',
                          icon_states: { on: 'hk:water-alert' }, icon_color: 'red', off_icon_color: 'blue', label_mode: 'leak' },
                        catPlace(r, 'Water', 'water'));
        })));
      });
      pages.water = view({ title: 'Water', path: 'water', subview: true, icon: 'mdi:water', sky_variant: 'water',
        background: '#0c1526', cards: wcards });
    }

    // ENERGY: the Energy feature's page, from its plan (the settings feed's
    // `energy`, features/energy/plan.py) -- while the feature is added
    if (opts.pages !== false && want('energy')) {
      var ev = guarded('the Energy page', function () {
        return energyView(client, view, { climate: !!pages.climate });
      });
      if (ev) pages.energy = ev;
    }
    // POWER: the Energy feature's second page, while its plan has one -- as
    // a kind (`power`), and in place of a custom page at its address
    var pw0 = added('energy') && setting('energy') && setting('energy').power;
    if (opts.pages !== false && pw0 && (want('power') || listOf(b, 'custom_pages').indexOf(pw0.path) >= 0)) {
      var pwv = guarded('the Power page', function () { return powerView(client, view); });
      if (pwv) pages.power = pwv;
    }

    if (music) {
      // MUSIC (2026-10-11): Play Music and Browse Music on one page
      // (hk-music.js) -- what plays and where on the left, Browse beside it.
      // The cover is still the page's background (the playmusic sky).
      out.push(view({ title: 'Music', path: 'playmusic', subview: true, sky_variant: 'playmusic',
        icon: 'mdi:speaker', menu_title: 'Music',
        // (in the page's column, as every page's content: on its edges --
        // DESIGN.md "Page edges")
        background: '#150e1f', cards: [titleBar('Music'),
          column([{ type: 'custom:hk-music-card' }])] }));
      // BROWSE MUSIC'S ADDRESS STAYS (links, chips and tap actions that open
      // it): the same page, starting in the search box -- out of the menu,
      // where Music is the page
      out.push(view({ title: 'Music', path: 'music-browse', subview: true, sky_variant: 'playmusic',
        menu_follows: 'playmusic', icon: 'mdi:music-box-multiple', menu: false,
        background: '#150e1f', cards: [titleBar('Music'),
          column([{ type: 'custom:hk-music-card', focus_search: true }])] }));
    }
    // THE PAGES IN THIS DASHBOARD'S ORDER (Order -> Pages): the
    // kinds, Browse Music where it is placed (else right after Play Music --
    // it comes with it, never on its own), and a custom page where it is
    // placed; custom pages not placed come before the rooms (customPages).
    var play = out.filter(function (v) { return v.path === 'playmusic'; });
    var browse = out.filter(function (v) { return v.path === 'music-browse'; });
    out = out.filter(function (v) { return play.indexOf(v) < 0 && browse.indexOf(v) < 0; });
    var KEY = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', live_tv: 'live_tv', security: 'security',
                doors_windows: 'doors-windows', climate: 'climate', lights: 'lights', timers: 'timers',
                vacuums: 'vacuums', water: 'water', energy: 'energy', power: 'power' };
    var order = picked.length ? picked : ['weather', 'calendar', 'cameras', 'live_tv', 'security', 'doors_windows', 'climate',
                                          'lights', 'timers', 'vacuums', 'music', 'water', 'energy', 'power', 'rooms'];
    var browsePlaced = order.indexOf('browse') >= 0;
    var mine = listOf(b, 'custom_pages');
    order.forEach(function (k) {
      if (k === 'music') { out = out.concat(play, browsePlaced ? [] : browse); play = []; if (!browsePlaced) browse = []; return; }
      if (k === 'browse') { out = out.concat(browse); browse = []; return; }
      if (KEY[k]) {
        var v = pages[KEY[k]];
        if (v) { out.push(v); delete pages[KEY[k]]; return; }
        // no Energy feature: a custom page of the same address, as before it
        if (k !== 'energy') return;
      }
      // the Power page in place of a custom page at its address
      if (pages.power && pages.power.path === k) { out.push(pages.power); delete pages.power; return; }
      // a custom page, when this dashboard shows it -- never a second page
      // at an address a generated one has
      if (mine.indexOf(k) >= 0 && !out.some(function (x) { return x && x.path === k; })) {
        var cv = customView(k); if (cv) out.push(cv);
      }
    });
    // THE POWER PAGE NOT PLACED (a screen that lists the custom page at its
    // address but not where): where that custom page would have gone, before
    // the rooms -- never the custom page itself
    if (pages.power) { out.push(pages.power); delete pages.power; }
    // A PAGE PER ROOM (Parts -> Room pages): each room heading on Home opens it.
    if (opts.rooms !== false && want('rooms')) {
      rooms(client, opts).forEach(function (r) {
        if (!r.id) return;
        var head = { title: r.name, path: 'room-' + slug(r.id), subview: true,
                     area: r.areas && r.areas.length > 1 ? r.areas : r.id };
        out.push(guarded('the ' + r.name + ' page', function () {
          return view(Object.assign({}, head, { cards: roomCards(client, r.areas || [r.id], r.name, opts) }));
        }, function (e) {
          return view(Object.assign({}, head, { cards: [{ type: 'markdown',
            content: 'This room page could not be built (' + String((e && e.message) || e).replace(/[<>&]/g, '') + ').' }] }));
        }));
      });
    }
    // THE DOCKED BAR ON EVERY PAGE (a screen's On Every Page): each page of
    // HK's own kind gets the bar too -- a pop-up lives in its page -- and
    // hk-popup.js carries it from one to the next without a slide
    if (dockBar && b.bar_all_pages) {
      dockBar.carry = true;
      out.forEach(function (v) {
        // (not the Music page: below)
        if (!v || v.path === 'home' || MUSIC_PAGE[v.path] || v.type !== 'custom:hk-grid-view' || !Array.isArray(v.cards)) return;
        v.cards = v.cards.concat([dockCard(dockBar)]);
      });
    }
    // THE MUSIC PAGE gets the bar on a phone only, on or off On Every Page:
    // one column, the bar is its mini player (hk-music.js says so with the
    // `hk-music-mini` flag on <html>); at two or three its own player is the
    // page and the bar would only repeat it. No Now Playing Bar on this
    // screen: the page's own Now Playing row stands in.
    // CARRIED to it and from it (a phone's: Home's bar becomes the page's
    // in place -- it waits there for the page's say, hk-popup.js)
    if (dockBar && npOn) {
      dockBar.carry = true;
      // (no stash there: the page's own Now Playing row stands in)
      var musicBar = Object.assign({}, dockBar, { carry: true, stash: null,
        trigger: [{ condition: 'flag', flag: 'hk-music-mini' }].concat(dockBar.trigger) });
      out.forEach(function (v) {
        if (v && MUSIC_PAGE[v.path] && Array.isArray(v.cards)) v.cards = v.cards.concat([dockCard(musicBar)]);
      });
    }
    return out;
  }

  // THE ROOM PAGE AS A VIEW STRATEGY, for a hand-built dashboard:
  //
  //     - title: Kitchen
  //       path: room-kitchen
  //       subview: true
  //       sky: true                  # the live sky, as on any HK view
  //       strategy:
  //         type: custom:hk-room
  //         area: kitchen            # or a list: [backyard, deck]
  //
  // Built from the area every time the page opens. The menu lists it as a
  // room (it reads the strategy's `area`).
  // WHEN HOME ASSISTANT SHOULD BUILD THE DASHBOARD AGAIN.
  // A strategy that says nothing is rebuilt whenever the entity, device, area
  // or floor registry changes at all -- anywhere in the house, for any field
  // (a firmware version, an integration's own bookkeeping) -- and HA hands
  // the view a new config without comparing it, so every card on an open
  // screen is made again: the camera strip's live tile reconnects, the sky
  // and glass rebuild. What the build reads of the registries is small, so
  // it is compared instead: an entity's area, device, platform, name, icon,
  // hidden and category; a device's area; an area's name and floor; a
  // floor's name and level. Worked out once per registry object (HA
  // replaces the object when it changes), so an unchanged registry costs a
  // lookup per push of the frontend's object.
  var REG_FIELDS = {
    entities: ['area_id', 'device_id', 'platform', 'name', 'icon', 'hidden', 'entity_category'],
    // a device's names are its tiles' names (friendly_name), its model picks
    // the Apple TV / HomePod glyph
    devices: ['area_id', 'name', 'name_by_user', 'model'], areas: ['name', 'floor_id'], floors: ['name', 'level']
  };
  var regSeen = new WeakMap();
  function regView(reg, fields) {
    if (!reg || typeof reg !== 'object') return '';
    var hit = regSeen.get(reg);
    if (hit !== undefined) return hit;
    var out = Object.keys(reg).sort().map(function (k) {
      var r = reg[k] || {};
      return k + '=' + fields.map(function (f) { return r[f] == null ? '' : String(r[f]); }).join('|');
    }).join(';');
    regSeen.set(reg, out);
    return out;
  }
  function regChanged(config, oldClient, newClient) {
    if (!oldClient || !newClient) return true;
    return Object.keys(REG_FIELDS).some(function (k) {
      var was = oldClient[k], now = newClient[k];
      return was !== now && regView(was, REG_FIELDS[k]) !== regView(now, REG_FIELDS[k]);
    });
  }

  class HkRoomViewStrategy extends HTMLElement {
    static shouldRegenerate(config, oldInput, newInput) { return regChanged(config, clientOf(oldInput), clientOf(newInput)); }
    static async generate(config, input) {
      var client = clientOf(input);   // Lovelace's entry: from here on, the client only
      if (window.hkSettings && window.hkSettings.whenLive) await window.hkSettings.whenLive(3000);
      await cardsReady();
      var c = config || {};
      var areas = [].concat(c.area || []).filter(Boolean);
      var A = client.areas || {};
      var name = c.name || (A[areas[0]] && A[areas[0]].name) || 'Room';
      var themes = (client.themes && client.themes.themes) || {};
      var v = { type: 'custom:hk-grid-view', layout: VIEW_LAYOUT, background: '#05070e',
                cards: roomCards(client, areas, name, Object.assign({}, c, { __build: {} })) };
      var theme = c.theme || kioskTheme(themes);
      if (theme) v.theme = theme;
      return v;
    }
  }
  if (!customElements.get('ll-strategy-view-hk-room')) {
    customElements.define('ll-strategy-view-hk-room', HkRoomViewStrategy);
  }

  class HkDashboardStrategy extends HTMLElement {
    static shouldRegenerate(config, oldInput, newInput) { return regChanged(config, clientOf(oldInput), clientOf(newInput)); }
    static async generate(config, input) {
      var client = clientOf(input);   // Lovelace's entry: from here on, the client only
      // THE SETTINGS FIRST. This runs once per load, so it cannot redraw when
      // they arrive: on a browser with no cached copy it waits (up to 3 s)
      // for the integration's answer instead of building from the defaults.
      if (window.hkSettings && window.hkSettings.whenLive) await window.hkSettings.whenLive(3000);
      await cardsReady();
      // WHAT THIS BUILD READS, fingerprinted BEFORE it reads it, and the
      // listener hooked before the first await below: a settings push that
      // lands while the build waits (on music, up to 4 s) is then seen as a
      // change and rebuilds. Fingerprinted at the end, as it was, the push
      // was in the fingerprint but not in the build, and nothing followed.
      var seg = dashSeg();
      watch(seg, inputs(seg));
      // Accessories -> Hidden from Screens / Also Shown (the house's), then
      // the dashboard's own YAML: the lists ADD together. The parts (chips,
      // pages, sky, music, rooms) are the YAML's and the screen's own --
      // there are no house-wide switches for them.
      var G = (window.hkSettings && window.hkSettings.get('generated', null)) || {};
      var y = config || {};
      var both = function (k) { return [].concat(G[k] || [], y[k] || []); };
      var opts = Object.assign({}, y, {
        exclude_areas: both('exclude_areas'), exclude_entities: both('exclude_entities'),
        exclude_devices: both('exclude_devices'), include_entities: both('include_entities'),
        __build: {}                     // this build's one pass over the house (byArea)
      });
      opts.board = boardOf(seg);
      // The desktop editor's frame only: a draft is never put in the settings feed.
      if (y.home_grid_preview) opts.board = Object.assign({}, opts.board, {
        home_style: 'grid', home_grid: y.home_grid_preview, home_page: true, home_view: null, only_pages: []
      });
      if (opts.board.sky === false) opts.sky = false;
      var b = opts.board;
      // HOME PAGE OFF (its Pages page): the screen is only the pages it
      // lists, in its order, and opens on the first -- any of them: the
      // Energy page, Climate, Cameras, a custom page. With none listed it is
      // a whole screen as usual.
      //   only_pages listed (Pages): the screen built as usual from that list
      //     -- views() keeps only the listed pages, in their order -- less
      //     its Home
      //   none (a screen set up before 2026-10-04): its custom pages, where
      //     `energy` is the Energy feature's page (onlyPages)
      var only = [];
      if (b.home_page === false && listOf(b, 'only_pages').length) {
        var mus = opts.music === false ? false : await musicConfigured(client);
        var keep = listOf(b, 'only_pages');
        // its own list as the page list; a key that is no kind is a custom page
        var ob = Object.assign({}, b, { pages: keep, custom_pages: keep });
        only = views(client, Object.assign({}, opts, { board: ob }), mus).slice(1);
        if (only.length) standalone(only[0], b);
      } else if (b.home_page === false) {
        only = onlyPages(client, opts, b);
      }
      // (a Home Grid screen waits for its catalog -- a few seconds at most:
      // without it, Home is the generated one)
      if (b.home_style === 'grid' && b.home_grid && !window.hkGridCatalog) {
        await Promise.race([gridReady(), new Promise(function (res) { setTimeout(res, 3000); })]);
      }
      var cfg;
      if (only.length) {
        // the menu's first item is this page, under its own name -- not "Home"
        only[0].menu_title = only[0].title;
        if (only[0].icon) only[0].menu_icon = only[0].icon;
        cfg = { views: only };
      } else {
        var music = opts.music === false ? false : await musicConfigured(client);
        cfg = { views: views(client, opts, music) };
        customPages(cfg.views, listOf(b, 'custom_pages'));
      }
      energyLinks(cfg.views, seg);
      skyPages(cfg.views);
      var saver = screensaverOf(client, b);
      if (opts.sky !== false) {
        // THE SKY (hk-sky.js): off everywhere with the house's switch (Look ->
        // Live sky switch), and paused behind this tablet's screensaver
        cfg.sky = {};
        if (setting('look.sky_switch')) cfg.sky.enable = setting('look.sky_switch');
        if (saver && saver.entity) cfg.sky.sleep = saver.entity;
      }
      // Its Screen page's "Hide Home Assistant Header & Sidebar": HK
      // Frontend's own (hk-kiosk.js reads cfg.hk_kiosk), or the Kiosk Mode
      // plugin for a screen that chooses it -- the tuned settings, then the
      // screen's own options for it (Kiosk Mode Options, YAML).
      var kiosk = kioskOf(b);
      if (kiosk === 'kiosk_mode') cfg.kiosk_mode = overlay({ hide_header: true, hide_sidebar: true }, b.kiosk_options);
      else if (kiosk) cfg.hk_kiosk = kiosk;
      // THE PHOTO SCREENSAVER: HK Frontend's own (hk-saver.js reads
      // cfg.hk_screensaver), or WallPanel for a screen that chooses it.
      if (saver && b.screensaver_engine === 'wallpanel') cfg.wallpanel = overlay(wallpanel(saver), b.wallpanel_options);
      else if (saver) cfg.hk_screensaver = hkSaver(saver, b.screensaver_options);
      return cfg;
    }
  }

  // THE HOUSE'S CUSTOM PAGES this dashboard lists (its Pages page; Custom
  // pages on the HK Settings page): each page's own view --
  // its cards, as the house wrote them -- under its title, address and icon,
  // after the category pages and before the rooms. A chip whose page it is
  // (Energy) opens it. An address this dashboard already has is left out.
  // Nothing is fetched from another dashboard.
  // One custom page's view: its cards as the house wrote them, under its
  // title, address and icon; null when the house has no such page.
  function customView(k) {
    var all = setting('custom_pages') || [], p = null;
    (Array.isArray(all) ? all : []).forEach(function (x) { if (x && x.path === k) p = x; });
    if (!p) return null;
    var v = JSON.parse(JSON.stringify(p.view || {}));
    v.title = p.title || k;
    v.path = k;
    if (p.icon) v.icon = p.icon;
    if (!Array.isArray(v.cards) && !Array.isArray(v.sections)) v.cards = [];
    return v;
  }
  function customPages(list, keys) {
    if (!keys.length) return;
    var all = setting('custom_pages') || [], by = {};
    (Array.isArray(all) ? all : []).forEach(function (p) { if (p && p.path) by[p.path] = p; });
    var have = {};
    list.forEach(function (v) { if (v && v.path) have[v.path] = true; });
    var at = list.length;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && /^room-/.test(list[i].path || '')) { at = i; break; }
    }
    keys.forEach(function (k) {
      var p = by[k];
      if (!p || have[k]) return;
      var v = JSON.parse(JSON.stringify(p.view || {}));
      v.title = p.title || k;
      v.path = k;
      if (p.icon) v.icon = p.icon;
      if (!Array.isArray(v.cards) && !Array.isArray(v.sections)) v.cards = [];
      list.splice(at++, 0, v);
      have[k] = true;
    });
  }

  // WHICH PAGE EACH VIEW IS, for its background (Sky / Background -> Pages,
  // read by hk-sky.js on every tick): the page kind, `rooms` for a room's
  // page, a custom page's own address. Home has none -- it is the screen's
  // own sky.
  var SKY_PAGE = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', 'live-tv': 'live_tv',
                   security: 'security', 'doors-windows': 'doors_windows', climate: 'climate', lights: 'lights',
                   timers: 'timers', vacuums: 'vacuums', playmusic: 'music', 'music-browse': 'music', water: 'water',
                   energy: 'energy', power: 'power' };
  function skyPages(list) {
    var custom = {};
    (setting('custom_pages') || []).forEach(function (p) { if (p && p.path) custom[p.path] = true; });
    list.forEach(function (v) {
      if (!v || v.sky_page || !v.path) return;
      var p = String(v.path);
      var k = SKY_PAGE[p] || (/^room-/.test(p) ? 'rooms' : custom[p] ? p : null);
      if (k) v.sky_page = k;
      // a room's page can have a background of its own: its address
      if (k === 'rooms') v.sky_room = p;
    });
  }

  // THE FIRST PAGE OF A SCREEN WITH NO HOME: not a sub-page, and -- with no
  // menu -- no back button (there is nowhere to go back to)
  function standalone(v, b) {
    v.subview = false;
    if (b.menu !== 'off') return;
    var bar = v.cards && v.cards[0];
    var kids = bar && bar.type === 'custom:hk-grid-card' && Array.isArray(bar.cards) ? bar.cards : null;
    if (kids && kids[0] && kids[0].type === 'custom:hk-back-card') {
      v.cards[0] = Object.assign({}, bar, { cards: kids.slice(1),
        layout: Object.assign({}, bar.layout, { 'grid-template-columns': 'minmax(0, 1fr)' }) });
    }
  }

  // A SCREEN WITH NO HOME PAGE: its custom pages, in its order -- and
  // `energy` among them is the Energy feature's page while it is added (a
  // generated page wins its address, as on a whole screen). The first page
  // has no back button while the screen has no menu (nowhere to go back to).
  function onlyPages(client, opts, b) {
    var mine = listOf(b, 'custom_pages'), keys = mine;
    var themes = (client.themes && client.themes.themes) || {};
    var theme = opts.theme || kioskTheme(themes);
    var sky = opts.sky !== false;
    var mk = function (o) {
      var v = Object.assign({ type: 'custom:hk-grid-view', layout: VIEW_LAYOUT, background: '#05070e' }, o);
      if (theme) v.theme = theme;
      if (o.sky_variant) { delete v.sky; if (!sky) delete v.sky_variant; }
      return v;
    };
    var out = [];
    keys.forEach(function (k) {
      var v = null;
      if (k === 'energy') {
        v = guarded('the Energy page', function () { return energyView(client, mk, {}, !out.length && b.menu === 'off'); });
      }
      var pp = added('energy') && setting('energy') && setting('energy').power;
      if (!v && pp && (k === 'power' || k === pp.path)) v = guarded('the Power page', function () { return powerView(client, mk); });
      if (!v && mine.indexOf(k) >= 0) v = customView(k);
      if (v && !out.some(function (x) { return x.path === v.path; })) out.push(v);
    });
    return out;
  }

  // A LINK TO A PAGE THIS SCREEN DOES NOT HAVE (the Energy page's "Power ›"
  // on a screen that is only the Energy page, the Power page's "Every
  // device ›" on a screen that is only Power): the same page on a screen
  // that shows it -- a screen of only it first -- and no link when none does.
  // A screen shows a page by its Pages list (empty: every page), its Only
  // Pages when it has no Home, or its custom pages.
  function energyLinks(list, seg) {
    var have = {};
    list.forEach(function (v) { if (v && v.path) have[v.path] = true; });
    var pages = list.filter(function (v) { return v && (v.path === 'energy' || v.path === 'power'); });
    if (!pages.length) return;
    var boards = setting('boards') || {};
    var shows = function (b, p) {
      if (listOf(b, 'custom_pages').indexOf(p) >= 0) return true;
      if (b.home_page === false && listOf(b, 'only_pages').length) return listOf(b, 'only_pages').indexOf(p) >= 0;
      var ps = listOf(b, 'pages');
      return !ps.length || ps.indexOf(p) >= 0;
    };
    var elsewhere = function (p) {
      var keys = Object.keys(boards).filter(function (k) { return k !== seg && shows(boards[k] || {}, p); });
      keys.sort(function (x, y) { return (boards[y].home_page === false) - (boards[x].home_page === false); });
      return keys.length ? '/' + keys[0] + '/' + p : null;
    };
    var local = function (path) { return typeof path === 'string' && /^\.\/[a-z0-9-]+$/.test(path) ? path.slice(2) : null; };
    pages.forEach(function walk(n) {
      if (!n || typeof n !== 'object') return;
      var p;
      if (n.type === 'custom:hk-heading-card' && (p = local(n.navigation_path)) && !have[p]) {
        var to = elsewhere(p);
        if (to) n.navigation_path = to; else { delete n.navigation_path; delete n.chevron; }
      }
      if (n.type === 'custom:hk-power-load-card' && (p = local(n.link)) && !have[p]) {
        var to2 = elsewhere(p);
        if (to2) n.link = to2; else delete n.link;
      }
      Object.keys(n).forEach(function (k) { walk(n[k]); });
    });
  }

  // THE ENERGY PAGE (the Energy feature's), drawn from its plan -- the
  // settings feed's `energy` (features/energy/plan.py): the readings row
  // (today's cost, thermostats, outside), the whole home's live graph, a
  // fortnight of daily use for the devices that matter, a section of live
  // tiles for each group of devices, and Home Assistant's own energy charts.
  // null when the feature is not added. `has`: the pages this screen has
  // (a thermostat opens Climate when there is one, else its sheet);
  // `first`: the screen's first page, with no menu -- no back button.
  // the reading tiles' grid: a tall tile and the gap a row. The last row
  // keeps its gap, as a room's pills keep theirs (pillGrid's `space`): with
  // the heading's 21 px above its text, the next section's name sits 32 px
  // below these tiles and 11 px above its own, as on Lights, Climate and
  // every room-style page (it was paid back, and Energy's and Power's
  // sections sat 13 px closer -- 2026-10-18; client_smoke measures both)
  function trackGrid() {
    var T = TL();
    return { 'grid-auto-flow': 'dense', 'grid-auto-rows': (T.tall + T.gridGap) + 'px', 'grid-column-gap': T.gridGap + 'px',
             'grid-row-gap': '0px', 'grid-template-columns': 'repeat(auto-fill, var(--hk-track, ' + T.w + 'px))',
             margin: '0px', padding: '0px var(--hk-pill-end, 0px) 0px 0px' };
  }
  var BATTERY_STEPS = [{ at_least: 60, color: 'green' }, { at_least: 25, color: 'yellow' }, { color: 'red' }];
  function energyHeading(name, link) {
    // the 21px row with 21 above it and none below: the text at a room
    // heading's place in the section's rhythm (trackGrid)
    var hd = { type: 'custom:hk-heading-card', name: name, height: '42px', padding: '21px 0px 0px 3px' };
    if (link && link.path) {
      hd.navigation_path = link.path;
      hd.chevron = (link.text || 'More') + (/›$/.test(link.text || '') ? '' : '›');
    }
    return hd;
  }
  function energyView(client, view, has, first) {
    var P = added('energy') ? setting('energy') : null;
    if (!P || typeof P !== 'object') return null;
    has = has || {};
    var body = [];
    // ONE PAGE, FOUR TABS (hk-energy.js THE ENERGY PAGE): the tabs, then one
    // three-column grid -- the summary across two columns and the highlights
    // beside it, Where it went across all three, and the period's shape with
    // the battery and water (or gas) beside it. Every card keeps its size and
    // place on every tab; only what is in it changes. The readings and the
    // whole home's live line are the summary's Now. The cards read the plan
    // and HA's Energy settings themselves, so they carry no config here.
    var src = P.sources || {};
    var hasHouse = (P.sections || []).some(function (s) {
      return (s.items || []).some(function (i) { return i.kind === 'battery' && i.house; });
    });
    // WHAT SITS BESIDE YOUR DAY: the house battery (HA's battery, or the
    // plan's house battery before HA's settings reached the plan), then water,
    // then gas -- two at most. Your Day takes the columns they leave.
    var beside = [];
    if (src.battery || hasHouse) beside.push({ type: 'custom:hk-energy-battery-card' });
    if (src.water) beside.push({ type: 'custom:hk-energy-water-card', source: 'water' });
    if (src.gas && beside.length < 2) beside.push({ type: 'custom:hk-energy-water-card', source: 'gas' });
    beside = beside.slice(0, 2);
    var page = P.page || {};
    var showHl = page.highlights !== false;
    // THE COLUMNS AT EACH WIDTH: three on a wall tablet and a computer, two
    // in the iPad band, one on a phone (css/hk-responsive.css sets the
    // --hk-energy-* spans there; elsewhere each var() falls back to its own
    // value here). The pills' gap less 8 px between columns: every grid
    // child has 4 px side margins, so the gap you see is the tiles' own.
    var grid = { type: 'custom:hk-grid-card', layout: {
      'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))',
      'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' }, cards: [
        { type: 'custom:hk-energy-hero-card', view_layout: { 'grid-column': showHl ? 'var(--hk-energy-hero, span 2)' : '1 / -1' } }
      ] };
    // a thermostat in the readings opens this screen's Climate page, as the
    // readings row's tiles did (no Climate page: its sheet)
    if (has.climate) grid.cards[0].climate_path = './climate';
    if (showHl) grid.cards.push({ type: 'custom:hk-energy-highlights-card', view_layout: { 'grid-column': 'var(--hk-energy-hl, auto)' } });
    grid.cards.push({ type: 'custom:hk-energy-where-card', view_layout: { 'grid-column': '1 / -1' } });
    grid.cards.push({ type: 'custom:hk-energy-day-card', view_layout: {
      'grid-column': beside.length ? 'var(--hk-energy-day, span ' + (3 - beside.length) + ')' : '1 / -1' } });
    beside.forEach(function (c) {
      if (beside.length === 1) c.view_layout = { 'grid-column': 'var(--hk-energy-one, auto)' };
      grid.cards.push(c);
    });
    // NOTHING TO DRAW YET (no meter, no device): where to start, below
    var T = P.total || {};
    if (T.stat || T.power || (P.sections || []).length) {
      body.push({ type: 'custom:hk-energy-period-card' });
      body.push(grid);
    }
    // TRACKING: the meters and runtimes a house chose to follow (HK Settings
    // -> Energy -> Tracking; the plan's own daily bars), one card of rows that
    // follow the tabs. Automatic ones are each device's sheet.
    if (P.usages_auto === false && (P.usages || []).some(function (u) { return u && (u.stat || u.entity); })) {
      body.push(energyHeading('Tracking'));
      body.push({ type: 'custom:hk-energy-tracking-card' });
    }
    // THE SECTIONS: a tile per device that follows the tabs (watts and the
    // last three hours on Now, kWh against its usual on the others), and the
    // batteries (their level, and a car's range). The heading carries the
    // section's dot and total.
    var backedKeys = {}, PW = P.power;
    if (PW && PW.backs_up === 'some') (PW.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (i) { if (i.backed) backedKeys[i.key] = true; });
    });
    (P.sections || []).forEach(function (s) {
      var peers = (s.items || []).filter(function (i) { return i.kind === 'device' && i.stat; })
        .map(function (i) { return i.stat; });
      var tiles = (s.items || []).map(function (i) {
        if (i.kind === 'battery') {
          var bt = { type: 'custom:hk-rank-card', entity: i.entity, name: i.name, icon: i.icon, mode: 'pct',
                     icon_color_steps: BATTERY_STEPS, energy: true, section: s.id };
          if (i.label) {
            bt.label_entity = i.label;
            bt.label_suffix = i.label_suffix || '';
            if (i.label_decimals) bt.label_decimals = i.label_decimals;
          }
          return bt;
        }
        var t = { type: 'custom:hk-rank-card', entity: i.power || i.stat, name: i.name, icon: i.icon,
                  icon_color: i.color, energy: true, section: s.id };
        if (i.stat) { t.stat = i.stat; t.peers = peers; }
        if (!i.power) t.mode = 'energy';
        if (i.control) t.control = i.control;
        // BACKED UP BY THE HOUSE BATTERY (the Power page's own finding): the
        // same small badge as there
        if (backedKeys[i.key]) t.backed = true;
        return t;
      }).filter(function (t) { return t.entity; });
      if (!tiles.length) return;
      var hd = energyHeading(s.name, s.link);
      hd.energy_section = s.id;
      // its height is a minimum (hk-stat.js): the same 42px, and room for
      // the total's own line on a phone
      body.push(hd);
      body.push({ type: 'custom:hk-grid-card', cards: tiles, layout: trackGrid() });
    });
    // HOME ASSISTANT'S OWN CHARTS, at the end (HK Settings -> Energy -> Home
    // Assistant's Charts)
    if (P.detail) {
      body.push(energyHeading('Home Assistant’s Charts'));
      body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-date-selection' }, margin: '0px 0px 12px 0px' });
      body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-sources-table' }, margin: '0px 0px 12px 0px',
                  phone: 'hide', vars: { 'card-background-color': 'transparent', 'divider-color': 'rgba(255,255,255,0.13)' } });
      body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-devices-detail-graph' }, margin: '0px 0px 12px 0px' });
      body.push({ type: 'custom:hk-frame-card', card: { type: 'energy-devices-graph' } });
    }
    if (!body.length) {
      body.push({ type: 'markdown', content: 'Nothing to show yet: add devices in Home Assistant’s Energy settings, ' +
        'or on HK Settings → Features → Energy.' });
    }
    var title = P.title || 'Energy';
    var bar = titleBar(title);
    if (first) bar.cards = bar.cards.slice(1);
    if (first) bar.layout = Object.assign({}, bar.layout, { 'grid-template-columns': 'minmax(0, 1fr)' });
    // THE COLUMN PAYS BACK ITS CHILDREN'S 4 px SIDE MARGINS, so the page's
    // headings, cards and reading tiles start where Home's do and its tile
    // grid is as wide as Home's -- one nesting level deeper it was 8 px
    // narrower, which at 1,280 is six 196 px pills or five
    var col = column(body);
    col.layout = Object.assign({}, col.layout, { margin: '0px -4px' });
    return view({ title: title, path: 'energy', subview: !first, icon: 'mdi:lightning-bolt', sky_variant: 'energy',
                  background: '#171d12', cards: [bar, col] });
  }

  // THE POWER PAGE (features/energy/power.py; PLAN-2026-10-12-home-power):
  // right now and the controls, beside the Energy page (over time). The house
  // full width; the status beside the house battery, then The House beside
  // Where the Sun Goes; the battery's own Mode and Levels; a tile per car;
  // every device, each marked when the house battery backs it up. Its
  // address is the plan's `path`, so the page can take over a custom page's
  // address on every screen that lists it.
  function powerView(client, view) {
    var P = added('energy') ? setting('energy') : null, W = P && P.power;
    if (!W || typeof W !== 'object') return null;
    var B = W.battery || {}, hasBat = !!B.level, hasSun = !!W.solar;
    var cars = Array.isArray(W.cars) ? W.cars : [];
    var span = function (v) { return { 'grid-column': v }; };
    var body = [];
    // THE HOUSE: the layered picture, or the flow chart
    var carsOf = cars.map(function (c) { return { name: c.name, level: c.level, power: c.power, home: c.home, plugged: c.plugged, charge: c.charge, charger: c.charger }; });
    // THE WALL CHARGERS (the plan's own, else the Energy plan's charging
    // devices that are chargers): their watts are live, a car's own lag
    var CHG = /wall.?connector|charger|evse|wallbox/i, chargers = Array.isArray(W.chargers) ? W.chargers.slice() : [];
    if (!chargers.length) (W.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (i) {
        if (i.power && (CHG.test(i.power) || CHG.test(i.name || '')) && i.power !== B.charge && i.power !== B.discharge) chargers.push(i.power);
      });
    });
    if (W.picture !== false) {
      body.push({ type: 'custom:hk-power-house-card', art: W.art, home: W.home, grid: W.grid, grid_export: W.grid_export,
                  grid_status: W.grid_status, solar: W.solar, level: B.level, charge: B.charge, discharge: B.discharge,
                  reserve: B.reserve, cars: carsOf, chargers: chargers });
    } else {
      body.push({ type: 'custom:hk-power-flow-card', grid: W.grid, home: W.home, level: B.level, grid_status: W.grid_status,
                  charge: B.charge, discharge: B.discharge });
    }
    // THE CARDS UNDER IT, in pairs as tall as each other
    var devices = [];
    (W.sections || []).forEach(function (s) {
      (s.items || []).forEach(function (i) { if (i.power) devices.push({ name: i.name, power: i.power, backed: !!i.backed, parent: !!i.parent }); });
    });
    var status = { type: 'custom:hk-power-status-card', grid_status: W.grid_status, problem: B.problem, level: B.level,
                   backup: B.backup, home: W.home, charge: B.charge, discharge: B.discharge, eps: B.eps, storm: B.storm,
                   solar: W.solar, grid: W.grid, cars: carsOf, chargers: chargers };
    var load = { type: 'custom:hk-power-load-card', home: W.home, backed_power: W.backed_power, grid_status: W.grid_status,
                 devices: devices, cars: carsOf, chargers: chargers, link: './energy' };
    var sun = hasSun ? { type: 'custom:hk-power-sun-card', solar: W.solar, grid: W.grid, grid_export: W.grid_export,
                         home: W.home, charge: B.charge, discharge: B.discharge } : null;
    var cards = [];
    if (hasBat) {
      cards.push(Object.assign(status, { view_layout: span('var(--hk-energy-hl, auto)') }));
      cards.push({ type: 'custom:hk-house-battery-card', level: B.level, stored: B.stored, backup: B.backup, reserve: B.reserve,
                   limit: B.limit, speed: B.speed, charge: B.charge, discharge: B.discharge, eps: B.eps, packs: B.packs,
                   view_layout: span('var(--hk-energy-hero, span 2)') });
      cards.push(Object.assign(load, { view_layout: span(sun ? 'var(--hk-energy-hl, auto)' : '1 / -1') }));
      if (sun) cards.push(Object.assign(sun, { view_layout: span('var(--hk-energy-hero, span 2)') }));
    } else {
      cards.push(Object.assign(status, { view_layout: span('var(--hk-energy-hl, auto)') }));
      cards.push(Object.assign(load, { view_layout: span('var(--hk-energy-hero, span 2)') }));
      if (sun) cards.push(Object.assign(sun, { view_layout: span('1 / -1') }));
    }
    // each pair as tall as its taller card
    cards.forEach(function (c) { c.fill = true; });
    body.push({ type: 'custom:hk-grid-card', layout: {
      'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))',
      'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' }, cards: cards });
    var oneCol = { 'grid-template-columns': 'minmax(0, 1fr)', 'grid-column-gap': (TL().gridGap - 8) + 'px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' };
    // THE BATTERY'S OWN CONTROLS: its mode, its levels
    if (W.mode && W.mode.entity) {
      body.push(energyHeading('Mode'));
      var seg = { type: 'custom:hk-segment-card', entity: W.mode.entity };
      if (W.mode.options) seg.options = W.mode.options;
      body.push({ type: 'custom:hk-grid-card', layout: oneCol, cards: [seg] });
    }
    if ((W.levels || []).length) {
      body.push(energyHeading('Levels'));
      body.push({ type: 'custom:hk-grid-card', layout: Object.assign({}, oneCol, { 'grid-template-columns': 'var(--hk-energy-cols, repeat(3, minmax(0, 1fr)))' }),
        cards: W.levels.map(function (l, i) {
          var s = { type: 'custom:hk-slider-card', entity: l.entity, name: l.name, layout: 'tile' };
          if (l.icon) s.icon = l.icon;
          if (l.color) s.color = l.color;
          // the last of an odd number: alone in its row in two columns, the row's whole width
          if (W.levels.length % 2 === 1 && i === W.levels.length - 1) s.view_layout = { 'grid-column': 'var(--hk-energy-one, auto)' };
          return s;
        }) });
    }
    // THE CARS: each its level against its limit, its range, and a power
    // button for charging that asks before stopping
    // (in the Energy plan's own Charging section, before its chargers, when
    // the devices are by type; else a Charging heading of their own)
    var carTiles = cars.map(function (c) {
      var t = { type: 'custom:hk-rank-card', entity: c.level, name: c.name, icon: 'hk:car', mode: 'pct', icon_color_steps: BATTERY_STEPS };
      if (c.range) { t.label_entity = c.range; t.label_suffix = ' mi range'; }
      if (c.charge) { t.control = c.charge; t.control_yes = 'Stop Charging'; t.control_detail = 'The car stops charging until you start it again.'; }
      return t;
    });
    var byType = !(W.groups === 'backup' && W.backs_up === 'some');
    var chargingSec = byType && (W.sections || []).some(function (s) { return s.id === 'charging'; });
    if (carTiles.length && !chargingSec) {
      body.push(energyHeading('Charging'));
      body.push({ type: 'custom:hk-grid-card', layout: trackGrid(), cards: carTiles });
    }
    // EVERY DEVICE, by type (as on the Energy page) or backed up first
    var tile = function (i) {
      var t = { type: 'custom:hk-rank-card', entity: i.power || i.stat, name: i.name, icon: i.icon, icon_color: i.color, energy: 'now' };
      if (i.stat) t.stat = i.stat;
      if (!i.power) t.mode = 'energy';
      if (i.control) t.control = i.control;
      if (i.backed && W.backs_up === 'some') t.backed = true;
      return t;
    };
    var groups = (W.sections || []).map(function (s) { return { id: s.id, name: s.name, items: s.items || [] }; });
    if (!byType) {
      var all = [].concat.apply([], groups.map(function (g) { return g.items; }));
      groups = [{ name: 'Backed Up', items: all.filter(function (i) { return i.backed; }) },
                { name: 'Not Backed Up', items: all.filter(function (i) { return !i.backed; }) }];
    }
    groups.forEach(function (g) {
      var tiles = g.items.map(tile).filter(function (t) { return t.entity; });
      if (g.id === 'charging' && chargingSec) tiles = carTiles.concat(tiles);
      if (!tiles.length) return;
      body.push(energyHeading(g.name));
      body.push({ type: 'custom:hk-grid-card', cards: tiles, layout: trackGrid() });
    });
    var title = W.title || 'Power';
    var col = column(body);
    col.layout = Object.assign({}, col.layout, { margin: '0px -4px' });
    return view({ title: title, path: W.path || 'power', subview: true, icon: 'mdi:home-lightning-bolt', sky_variant: 'power',
                  background: '#121634', cards: [titleBar(title), col] });
  }

  // THE PHOTO SCREENSAVER (a generated wall tablet's Screen page):
  // HK Frontend's own (hk-saver.js), or WallPanel (HACS) for a screen that
  // chooses it -- either way for the tablet's own user only (a desk opening
  // the same dashboard never gets it), with the house's photos, and the wall
  // tablet's screensaver content (the clock, the weather, what is playing,
  // the running timers). Its helper, the one a tablet's automations read, is
  // input_boolean.wallpanel_screensaver_<its room> -- the name predates
  // HK's own screensaver and is kept, so no automation has to change.
  function screensaverOf(client, b) {
    // 1.14: the screensaver is a WALL TABLET's -- this page's
    // (hkSettings.tablet(): its ?hk_tablet=, else its user), whatever screen
    // it shows; the block names it, and only that tablet runs it
    var HS = window.hkSettings;
    if (HS && HS.get && HS.get('tablet_items', null) !== null) {
      var t = typeof HS.tablet === 'function' ? HS.tablet(client) : null;
      if (!b || !b.screensaver) return null;
      // NOT A TABLET (a desk, HK Settings' preview): the block names the
      // screen's own tablet, or none -- the gate keeps it from running here,
      // and the preview (hkSaver.preview, forced) still has it to show
      if (!t) {
        var items = HS.get('tablet_items', {}) || {}, first = (b.tablets || []).filter(function (k) { return items[k]; })[0];
        t = first ? Object.assign({ id: first }, items[first]) : { id: '-', user: '', room: '', screensaver_switch: null };
      }
      if (b.screensaver_engine === 'wallpanel' && !t.room) return null;
      var old = t.room ? 'input_boolean.wallpanel_screensaver_' + t.room : null;
      if (old && !client.states[old]) old = null;
      var mineSw = t.screensaver_switch && client.states[t.screensaver_switch] ? t.screensaver_switch : null;
      var temp1 = String((client.config && client.config.unit_system && client.config.unit_system.temperature) || '');
      return { user: t.user, tablet: t.id, entity: b.screensaver_engine === 'wallpanel' ? old : (mineSw || old),
               unit: /C/.test(temp1) ? 'C' : /F/.test(temp1) ? 'F' : '',
               photos: setting('look.photos') || 'media-source://media_source/local/photos' };
    }
    if (!b || !b.screensaver || !b.tablet_user) return null;
    // HK Frontend's own switch for the screen (screensaver.py), else the old
    // input_boolean.wallpanel_screensaver_<Tablet Room> a house may still
    // have (and WallPanel can only use an input_boolean)
    var legacy = b.idle_room ? 'input_boolean.wallpanel_screensaver_' + b.idle_room : null;
    if (legacy && !client.states[legacy]) legacy = null;
    var own = b.screensaver_switch && client.states[b.screensaver_switch] ? b.screensaver_switch : null;
    var ent = b.screensaver_engine === 'wallpanel' ? legacy : (own || legacy);
    // the temperature's letter on the screensaver ("68°F"): Home
    // Assistant's unit system's
    var temp = String((client.config && client.config.unit_system && client.config.unit_system.temperature) || '');
    return { user: b.tablet_user, entity: ent, unit: /C/.test(temp) ? 'C' : /F/.test(temp) ? 'F' : '',
             photos: setting('look.photos') || 'media-source://media_source/local/photos' };
  }
  var SAVER_CARDS = [
    { type: 'custom:hk-clock-card', time_size: '150px', ampm_size: '40px', date_size: '40px',
      time_letter_spacing: '0px', ampm_letter_spacing: '0.37px', date_letter_spacing: '0.37px',
      time_line_height: '1', date_format: 'monthday', date_gap: '4px', gap: '8px',
      color: 'rgba(255,255,255,0.95)', ampm_color: 'rgba(255,255,255,0.70)', date_color: 'rgba(255,255,255,0.85)',
      margin: '0px 0px 0px 20px', clip: false, layer: true },
    { type: 'custom:hk-weather-strip-card', variant: 'inline', unit: 'F', main_size: '36px', main_letter_spacing: '0.37px',
      glyph_size: '60px', temp_gap: '36px', icon_gap: '12px', color: 'rgba(255,255,255,0.95)',
      margin: '-4px 0px 0px 20px', layer: true },
    { type: 'custom:hk-screensaver-now-card', music: true },
    { type: 'custom:hk-timer-strip-card', entity: 'sensor.running_quick_timers', scale: 1.6, fixed: true },
    // top-right: the house at a glance (HK's own screensaver only)
    { type: 'custom:hk-screensaver-status-card' }
  ];
  // HK FRONTEND'S OWN SCREENSAVER (hk-saver.js): the block it reads from the
  // dashboard's config. `cards` are the same four as WallPanel's, less the
  // ones the screen turned off (Over the Photos).
  function hkSaver(sv, o) {
    o = o || {};
    var cards = JSON.parse(JSON.stringify(SAVER_CARDS));
    if (sv.unit) cards[1].unit = sv.unit; else delete cards[1].unit;
    // the corner clock: not under a Large clock, nor on Show: Clock (the
    // clock is the screensaver there) -- except while the music slide
    // covers that clock (Music First), when it tells the time as it does
    // over the photos (music_only: hk-saver.js shows it only then)
    var big = o.clock_over === 'large' || o.show === 'clock';
    if (big) cards[0].music_only = true;
    var keep = [o.clock !== false, o.weather !== false, o.music !== false, o.timers !== false, o.status !== false];
    return {
      user: sv.user, entity: sv.entity || null, photos: sv.photos,
      // 1.14: the wall tablet it runs on (hk-saver.js gate)
      tablet: sv.tablet || '',
      starts_after: o.starts_after || 180, each_photo: o.each_photo || 30,
      order: o.order === 'sorted' ? 'sorted' : 'random',
      fill: o.fill !== false, zoom: o.zoom === true,
      show: o.show === 'forecast' || o.show === 'both' || o.show === 'clock' ? o.show : 'photos', fallback: o.fallback !== false,
      // the clocks (hk-saverclock.js; hk-saver.js readCfg checks them)
      clock: o.clock !== false, clock_over: o.clock_over, clock_style: o.clock_style, clock_bg: o.clock_bg,
      clock_motion: o.clock_motion, clock_24: o.clock_24 === true, clock_colors: o.clock_colors, clock_speed: o.clock_speed, clock_depth: o.clock_depth,
      clock_night: o.clock_night, clock_night_from: o.clock_night_from, clock_night_to: o.clock_night_to,
      // the mosaic (hk-saver.js readCfg checks them)
      photo_layout: o.photo_layout, mosaic_count: o.mosaic_count, mosaic_gap: o.mosaic_gap, mosaic_change: o.mosaic_change,
      mosaic_line: o.mosaic_line, mosaic_color: o.mosaic_color, mosaic_random: o.mosaic_random, mosaic_every: o.mosaic_every,
      clock_photo_soft: o.clock_photo_soft, clock_photo_dim: o.clock_photo_dim, clock_text_shadow: o.clock_text_shadow, clock_text_outline: o.clock_text_outline,
      // Home Energy and the additional screens (hk-saver.js readCfg checks them)
      energy_slide: o.energy_slide === true, extra_music: o.extra_music === true, extra_forecast: o.extra_forecast === true,
      extra_every: o.extra_every, extra_for: o.extra_for, energy_hide: Array.isArray(o.energy_hide) ? o.energy_hide.slice() : [],
      weather_slide: o.weather_slide === true, weather_hide: Array.isArray(o.weather_hide) ? o.weather_hide.slice() : [],
      forecast_every: o.forecast_every || 5,
      band: o.band !== false, band_photos: o.band_photos === true,
      calendar: o.calendar === true, calendar_days: o.calendar_days || 2,
      music_slide: o.music_slide === true, music_pane: o.music_pane === true, music_first: o.music_first === true,
      fade_back: typeof o.fade_back === 'number' ? o.fade_back : 500,
      // portrait and landscape photos, each their own (hk-saver.js shapeCfg
      // checks them): passed as they are
      portrait_fill: o.portrait_fill === true,
      portrait_blur: o.portrait_blur, portrait_dim: o.portrait_dim, portrait_zoom: o.portrait_zoom, portrait_x: o.portrait_x, portrait_y: o.portrait_y,
      landscape_blur: o.landscape_blur, landscape_dim: o.landscape_dim, landscape_zoom: o.landscape_zoom, landscape_x: o.landscape_x, landscape_y: o.landscape_y,
      cards: cards.filter(function (c, i) { return keep[i]; })
    };
  }
  // HIDE HOME ASSISTANT'S HEADER AND SIDEBAR (a screen's Hide Home Assistant
  // Header & Sidebar): null, 'kiosk_mode' (the plugin does it), or the block
  // hk-kiosk.js reads -- the same one a YAML dashboard can write as hk_kiosk.
  function kioskOf(b) {
    if (!b || !b.kiosk) return null;
    // (no kiosk_engine: an integration older than 1.3 -- its screens with
    // Kiosk Mode Options of their own were the plugin's, as settings.py says)
    var eng = b.kiosk_engine || (b.kiosk_options && Object.keys(b.kiosk_options).length ? 'kiosk_mode' : 'hk');
    if (eng === 'kiosk_mode') return 'kiosk_mode';
    return { header: b.kiosk_header !== false, sidebar: b.kiosk_sidebar !== false, admins: b.kiosk_admins !== false };
  }
  // A SCREEN'S hk_screensaver BLOCK FROM ITS SETTINGS ALONE, for a dashboard
  // HK Frontend does not draw (an existing dashboard given HK settings):
  // hk-saver.js asks for it when the dashboard's own config has no
  // hk_screensaver. HK Frontend's own screensaver only -- WallPanel reads its
  // block from the dashboard itself. null: no screensaver for this screen.
  function saverBlock(client, b) {
    if (!client || !b || b.screensaver_engine === 'wallpanel') return null;
    var sv = screensaverOf(client, b);
    return sv ? hkSaver(sv, b.screensaver_options) : null;
  }
  // A THIRD-PARTY CARD'S OWN OPTIONS over the tuned settings:
  // key by key, into nested mappings; a list or a value replaces; `key: null`
  // removes one. Never changes `base`.
  function overlay(base, over) {
    var out = JSON.parse(JSON.stringify(base || {}));
    if (!over || typeof over !== 'object' || Array.isArray(over)) return out;
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (v === null) { delete out[k]; return; }
      var plain = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
      out[k] = plain(v) && plain(out[k]) ? overlay(out[k], v) : JSON.parse(JSON.stringify(v));
    });
    return out;
  }
  function wallpanel(sv) {
    var cards = JSON.parse(JSON.stringify(SAVER_CARDS)).slice(0, 4);
    if (sv.unit) cards[1].unit = sv.unit; else delete cards[1].unit;
    var profiles = {};
    profiles['user.' + sv.user] = { enabled: true };
    var wp = {
      enabled: false, profiles: profiles, idle_time: 180, display_time: 30, control_reactivation_time: 3,
      fade_out_time_motion_detected: 0.1, fade_out_time_screensaver_entity: 0.1,
      image_animation_ken_burns: true, image_animation_ken_burns_zoom: 1.1,
      image_url: sv.photos, image_fit_landscape: 'cover', image_background: 'image', media_order: 'random',
      cards: cards,
      style: {
        'wallpanel-screensaver-info-box-content': { '--ha-card-background': 'none', '--ha-card-box-shadow': 'none',
          '--ha-card-border-width': '0px', '--primary-text-color': '#ffffff', '--secondary-text-color': '#dddddd',
          'text-shadow': '0px 2px 8px rgba(0, 0, 0, 0.30), 0px 6px 28px rgba(0, 0, 0, 0.26), 0px 12px 68px rgba(0, 0, 0, 0.34)',
          '--font-weight': 'bold', 'font-size': '15px', 'letter-spacing': '-0.23px' },
        'wallpanel-screensaver-info-box': { '--wp-card-width': '600px', background: 'none', 'box-shadow': 'none' },
        'wallpanel-screensaver-image-background': { filter: 'blur(40px) brightness(80%)', 'will-change': 'transform' },
        'wallpanel-screensaver-image-one': { 'will-change': 'transform' },
        'wallpanel-screensaver-image-two': { 'will-change': 'transform' },
        'wallpanel-screensaver-image-one-container': { 'will-change': 'opacity' },
        'wallpanel-screensaver-image-two-container': { 'will-change': 'opacity' }
      }
    };
    // THE HELPER IS WRITTEN FROM THE TABLET'S OWN USER ONLY. WallPanel's element
    // connects in every browser that opens the dashboard, enabled or not, and
    // sets screensaver_entity to "is MY screensaver running" -- so a desk
    // opening /dashboard-kitchen turned the kitchen tablet's helper off (107
    // times from one desk user, 09-27..29) until the tablet's own idle timer
    // put it back 180 s later. WallPanel merges the user's profile before it
    // connects, so in the profile only the tablet has a helper to write.
    if (sv.entity) profiles['user.' + sv.user].screensaver_entity = sv.entity;
    return wp;
  }
  // THE DOCKED BAR along the bottom: the Now Playing Bar (the player, while
  // music plays) and the Timer Bar (the running quick timers, a slim row over
  // it) -- a screen's two switches, each its own part of the one bar.
  var MUSIC_PAGE = { playmusic: true, 'music-browse': true };
  function dockCard(bar) {
    return { type: 'custom:hk-grid-card', view_layout: COL2,
      layout: { 'grid-template-columns': '1fr', 'grid-column-gap': '0px', 'grid-row-gap': '0px', margin: '0px', padding: '0px' },
      cards: [bar] };
  }
  function mediaBar(withMusic, withTimers) {
    var bar = { type: 'custom:hk-now-playing-card', bar: true, music: true, hide_idle: true,
      meta_card: { type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: ['volume'], entity_from: { music: true } },
      sub_card: { type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: ['progress'], phone_times: false, entity_from: { music: true } } };
    // DOCKED (2026-10-10): the screen's bottom edge, full width, square, a
    // hairline on top and a shadow up onto the page, which ends above it --
    // not a rounded bar floating over it. The very bottom of the screen (its
    // controls clear of a phone's home indicator); a tab bar rides above it.
    return { type: 'custom:hk-popup-card', hash: '#media', position: 'bottom', modal: false, dock: true,
      padding: '0', radius: '0',
      vars: { 'hk-np-height': 'calc(104px + env(safe-area-inset-bottom, 0px))',
              'hk-np-pad': '12px 24px calc(12px + env(safe-area-inset-bottom, 0px))',
              'hk-np-radius': '0', 'hk-np-plate': 'rgb(22,23,26)',
              // Speakers and Browse on either side of the transport, as on
              // the screensaver (2026-10-11); the volume gives up the room
              // (no close button: swiped down to put away, hk-media.js)
              'hk-np-areas': '"art title . spk prev play next stop brw . meta" "art artist . spk prev play next stop brw . meta" "art sub . spk prev play next stop brw . meta"',
              'hk-np-cols': '72px minmax(220px, max-content) 1fr 56px 64px 64px 64px 64px 56px 1fr minmax(0, 380px)',
              'hk-np-rows': 'auto auto auto', 'hk-np-gap': '14px' },
      width: '100%', max_width: '100%', background: 'transparent', dismissable: true,
      // swiped away, a speaker in the corner brings it back (hk-popup.js)
      stash: { icon: 'hk:homepod', label: 'Show Now Playing' },
      dismiss_scope: [].concat(withMusic ? [{ music: true }] : [], withTimers ? [{ entity: 'sensor.running_quick_timers', above: 0 }] : []),
      trigger: [{ condition: 'or', conditions: [].concat(
        withTimers ? [{ condition: 'numeric_state', entity: 'sensor.running_quick_timers', above: 0 }] : [],
        // (grace: the house's Hide After a Pause, read live -- hk-popup.js)
        withMusic ? [{ condition: 'state', entity_from: { music: true }, state: 'playing', grace: 'now_playing' }] : []) }],
      trigger_close: true,
      // NOW PLAYING'S PLACE (2026-10-15, the screen's Now Playing; hk-popup.js
      // placeFor): a pane down one side -- the screensaver's music pane, the
      // card after the player -- or this bar along the bottom or the top
      // (top_vars: its inset at the top of the screen, not the bottom)
      pane: !!withMusic,
      top_vars: { 'hk-np-height': 'calc(104px + env(safe-area-inset-top, 0px))',
                  'hk-np-pad': 'calc(12px + env(safe-area-inset-top, 0px)) 24px 12px' },
      // the timers on the same plate, a slim row over the player (docked)
      cards: [].concat(withTimers ? [{ type: 'custom:hk-timer-strip-card', docked: true }] : [],
                       withMusic ? [bar, { type: 'custom:hk-music-pane-card' }] : []) };
  }

  // REBUILT WHEN ITS SETTINGS CHANGE. A strategy builds the dashboard once,
  // when it opens -- so an edit to this dashboard's item (its pages, camera
  // strip, favorites), to Status & Chips or to the hidden / also-shown lists would wait
  // for a reload. Instead, when what it was built from changes, it asks
  // Home Assistant to rebuild it (`config-refresh`, what the dashboard
  // menu's own Refresh does), at most every 10 s. The chips and scenes are
  // live cards and need none of this.
  // WHAT A BUILD READS, not every setting it could: reading the
  // whole of every item and every accessory would make one chip reorder on
  // one screen, or one glyph picked anywhere, rebuild every open generated
  // screen. This item's keys that live cards and modules follow by
  // themselves are left out (the chips row, scenes, menu, look, pop-ups);
  // of the other items only their cameras, which pick the channel this one
  // shows (houseCameras); of the accessories not `status`, which only Status
  // & Chips reads (and that arrives as `kinds`). Any key not named here still
  // rebuilds, so a new one is safe by default.
  // (`popups` is NOT live -- it decides this build's own #alarm
  // card, so it rebuilds, and so does the house's pop-up list; the look's
  // amounts, the car viewport's width and the idle return are applied by
  // their modules, so they do not rebuild -- a rebuild reconnects every
  // camera. Car Browser itself rebuilds: with Car Home it is another Home.)
  var LIVE_KEYS = { chips: 1, chips_quiet: 1, chips_extra: 1, scenes: 1, scenes_pages: 1, scenes_row: 1,
                    categories: 1, menu: 1, menu_rooms: 1, dock_min: 1, time_weather: 1, ha_row: 1,
                    tab_position: 1, home_rooms: 1, flat: 1, flat_theme: 1, glass: 1, frost: 1, frost_tint: 1, blur: 1, tint: 1, well: 1, black_screen: 1, camera_live: 1, camera_live_video: 1,
                    car_width: 1, idle_return: 1, narrow: 1, menu_top: 1, chips_custom: 1, chips_custom_show: 1,
                    // notifications: hk-notify.js reads them as each one comes
                    notify: 1, notify_saver: 1, notify_dnd: 1,
                    // THE MENU'S OWN LOOK (2026-10-04: All Screens' unless the
                    // screen sets its own -- settings.py resolved()): hk-base's
                    // menuState reads each live and no build reads one, so an
                    // accent picked for the house no longer rebuilds every
                    // screen (closing its sheets, reconnecting its cameras)
                    accent: 1, swipe: 1, glyph: 1, clock: 1, tab_size: 1, tab_size_phone: 1,
                    menu_custom: 1, menu_house: 1, page_header: 1,
                    // ...and the tab bar's and the Home Assistant section's
                    // (hk-tabbar.js / hk-menu.js read them live). Every key
                    // of settings.py MENU_KEYS but `menu` belongs here:
                    // test_strategy_rebuild.js reads that list and fails on
                    // one left out
                    ha_place: 1, tab_bar_scroll: 1, tab_bar_rooms: 1, tab_bar_glass: 1, tab_bar_more: 1,
                    tab_bar_more_phone: 1, tab_bar_pos: 1, tab_bar_fold: 1, tab_bar_start: 1,
                    tab_bar_adjust: 1, tab_bar_scroll_phone: 1, tab_bar_tabs: 1, tab_bar_tabs_rail: 1,
                    tab_bar_size: 1, tab_bar_labels: 1,
                    // ...and Phones' own menu (hk-base.js phoneMenu, 2026-10-08)
                    menu_phone: 1, button_phone: 1, tab_bar_rooms_phone: 1,
                    // ...and Now Playing's place (hk-popup.js placeFor reads it live)
                    np_style: 1, np_side: 1, np_bar: 1, np_bar_phone: 1,
                    // ...and the screen's own sky: hk-settings.js skyLook() /
                    // skyPage() read every sky_* key live and the sky repaints
                    // on its next tick; no build reads one (`sky` itself, the
                    // live sky on or off, does: it stays out). Every sky_* key
                    // of settings.py BOARD_DEFAULTS belongs here, held by
                    // test_strategy_rebuild.js
                    sky_animations: 1, sky_weather: 1, sky_precipitation: 1, sky_focus_pause: 1, sky_decorations: 1, sky_decoration_style: 1, sky_moving: 1,
                    sky_cloud_style: 1, sky_daytime: 1, sky_gradient: 1, sky_custom: 1, sky_pages: 1,
                    sky_liveliness: 1, sky_liveliness_occ: 1, sky_liveliness_custom: 1, sky_calm_empty: 1,
                    sky_background: 1, sky_color: 1, sky_photo: 1, sky_page_photos: 1, sky_photo_look: 1, sky_page_looks: 1, sky_landscape: 1, sky_landscape_look: 1,
                    sky_flat_background: 1, sky_flat_color: 1, sky_flat_fade: 1, sky_flat_tint: 1, sky_flat_tint_amount: 1, sky_flat_tint_light: 1, sky_flat_pages: 1,
                    sky_flat_image_look: 1, sky_flat_page_image_looks: 1, sky_image_look: 1 };
  // an accessory's fields only the chips read (Status & Chips' status, a custom
  // chip's when / label / attribute): changing one rebuilds nothing
  var CHIP_ONLY = { status: 1, when: 1, label: 1, attribute: 1 };
  // Status & Chips' kinds only live cards read -- the pages' status rows
  // (pageMembers, per push) and the Smoke & CO chip: no page, tile or link
  // is built from them, so a sensor found or left out rebuilds nothing
  var LIVE_KINDS = { motion: 1, occupancy: 1, smoke: 1 };
  function inputs(seg) {
    var b = boardOf(seg), mine = {};
    Object.keys(b).forEach(function (k) { if (!LIVE_KEYS[k]) mine[k] = b[k]; });
    // ...but a screen with no Home reads `menu` as it builds: with no menu its
    // first page has no back button (standalone, onlyPages)
    if (b.home_page === false) mine.menu = b.menu;
    var K = setting('kinds'), kinds = K;
    if (K && typeof K === 'object') {
      kinds = {};
      Object.keys(K).forEach(function (k) { if (!LIVE_KINDS[k]) kinds[k] = K[k]; });
    }
    var all = setting('boards') || {}, cams = {};
    Object.keys(all).forEach(function (k) { if (all[k] && all[k].cameras) cams[k] = all[k].cameras; });
    var acc = setting('accessories') || {}, ents = {}, rest = {};
    Object.keys(acc).forEach(function (k) { if (k !== 'entities') rest[k] = acc[k]; });
    Object.keys(acc.entities || {}).forEach(function (id) {
      var a = acc.entities[id] || {}, o = {};
      Object.keys(a).forEach(function (k) { if (!CHIP_ONLY[k]) o[k] = a[k]; });
      ents[id] = o;
    });
    return JSON.stringify([mine, cams, kinds, setting('generated'),
                           setting('security'), setting('sky.moon'), setting('weather'), setting('features'),
                           ents, rest, setting('look.sky_switch'), setting('look.photos'),
                           setting('extras'), setting('custom_pages'), setting('popups'), setting('added'),
                           // the Energy page's plan (features/energy/plan.py)
                           setting('energy'),
                           // which calendars there are decides whether there is a Calendar page
                           (setting('calendar') || {}).entities]);
  }
  var built = { seg: null, sig: null, at: 0, timer: null };
  // NOT UNDER A FINGER. A rebuild re-creates every card -- an open sheet
  // closes, a live camera reconnects, a scrolled page jumps to the top -- so
  // while someone is using the screen (touched in the last 30 s, or a sheet
  // or pop-up covering the page) it waits, and runs once it is left alone,
  // as the tablets are only ever reloaded when nobody is looking.
  var BUSY_MS = 30000, touched = 0;
  ['pointerdown', 'keydown', 'wheel'].forEach(function (t) {
    try { window.addEventListener(t, function () { touched = Date.now(); }, { capture: true, passive: true }); }
    catch (e) { /* no window (tests) */ }
  });
  function busy() {
    return Date.now() - touched < BUSY_MS || (window.hkPopupCover || 0) > 0 || editing();
  }
  // EDIT MODE (hk-edit.js) holds the page as it is being arranged: a rebuild
  // waits until it is done or cancelled
  function editing() { return !!(window.hkEdit && window.hkEdit.active && window.hkEdit.active()); }
  // A CHANGE MADE ON THIS SCREEN (2026-10-01: an accessory's gear, on a
  // sheet here -- its Tile Size, name, icon): the person who made it is
  // looking for it, so it is built the moment the sheet closes, not after
  // the 30 s of nobody touching an unattended change waits for -- and the
  // page stays where it was scrolled to. Good for MINE_MS after the change.
  var MINE_MS = 120000, MINE_POLL = 300;
  function ownChange() { built.mine = Date.now(); }
  function ownRecent() { return !!built.mine && Date.now() - built.mine < MINE_MS; }
  function refreshKeepingPlace() {
    var y = window.scrollY || 0;
    refresh();
    if (!y) return;
    // the rebuilt view draws over a frame or two; put the page back each
    // time until it is tall enough to be put back
    [80, 250, 600, 1200].forEach(function (ms) {
      setTimeout(function () { if (Math.abs((window.scrollY || 0) - y) > 2) window.scrollTo(0, y); }, ms);
    });
  }
  function watch(seg, sig) {
    built.seg = seg; built.sig = sig; built.at = Date.now();
    if (built.hooked || !window.hkSettings || !window.hkSettings.onChange) return;
    built.hooked = true;
    var due = function () {
      built.timer = null;
      if (dashSeg() !== built.seg || inputs(built.seg) === built.sig) return;
      var own = ownRecent();
      if (own ? (window.hkPopupCover || 0) > 0 || editing() : busy()) { built.timer = setTimeout(due, own ? MINE_POLL : 5000); return; }
      built.sig = inputs(built.seg);
      built.mine = 0;
      if (own) refreshKeepingPlace(); else refresh();
    };
    window.hkSettings.onChange(function () {
      if (!built.seg || dashSeg() !== built.seg || inputs(built.seg) === built.sig) return;
      if (built.timer && !ownRecent()) return;
      clearTimeout(built.timer);
      built.timer = setTimeout(due, ownRecent() ? 0 : Math.max(0, 10000 - (Date.now() - built.at)));
    });
  }
  function refresh() {
    try {
      var panel = window.hkShell.panel();
      var root = panel ? window.hkShell.dashboard(panel) : null;
      (root || panel).dispatchEvent(new CustomEvent('config-refresh', { bubbles: true, composed: true }));
    } catch (e) { /* not on a dashboard */ }
  }
  // LATE ARRIVAL. Home Assistant waits 5 s for this element, then draws
  // "Error loading the dashboard strategy: ... Timeout waiting for strategy
  // element" and never asks again. A page opened while Home Assistant is
  // restarting, or on a slow phone connection, can get this file after that
  // (2026-09-29 15:17: a phone and the Kitchen tablet, right after an
  // update's restart). So when it does arrive: a generated dashboard showing
  // that error is built again, now that the element is here.
  function lateError(panel) {
    var L = panel && panel.lovelace;
    var raw = L && L.rawConfig, s = raw && raw.strategy;
    if (!s || s.type !== 'custom:hk-dashboard' || !L.config) return false;
    try { return JSON.stringify(L.config).indexOf('ll-strategy-dashboard-hk-dashboard') >= 0; }
    catch (e) { return false; }
  }
  function lovelacePanel() { return window.hkShell.panel(); }
  function recoverLate() {
    try {
      if (lateError(lovelacePanel())) { refresh(); kioskAgain(); }
    } catch (e) { /* not on a dashboard */ }
  }
  // KIOSK MODE LOOKS AGAIN. The kiosk-mode plugin reads the dashboard's
  // kiosk_mode when the page changes (location-changed); on the error page
  // there was none, so Home Assistant's header and sidebar showed -- and a
  // rebuild is not a page change, so they stayed (2026-09-29, the Kitchen
  // tablet). Once the rebuilt dashboard is in place, the same signal again.
  function kioskAgain() {
    var n = 0;
    var iv = setInterval(function () {
      var p = null;
      try { p = lovelacePanel(); } catch (e) { /* gone */ }
      var built = p && p.lovelace && !lateError(p) && p.lovelace.config && p.lovelace.config.views &&
                  p.lovelace.config.views.length > 0;
      if (built) window.hkShell.announce({ detail: { replace: true } });
      if (built || ++n >= 40) clearInterval(iv);
    }, 250);
  }
  if (!customElements.get('ll-strategy-dashboard-hk-dashboard')) {
    customElements.define('ll-strategy-dashboard-hk-dashboard', HkDashboardStrategy);
    recoverLate();
  }
  // HOME ASSISTANT SWAPS THE REGISTRY. Its frontend replaces
  // window.customElements with a polyfill (scoped custom elements) that keeps
  // a list of its own: a definition made BEFORE the swap -- this file,
  // served from the browser's cache ahead of the frontend's own code -- is
  // invisible to it, so Home Assistant waits 5 s for an element it can
  // never see and draws "Timeout waiting for strategy element". Measured
  // 2026-09-29 on the wall tablets: most cached loads, all four tablets
  // (the file ran fine; `customElements.get` on the swapped registry still
  // said undefined). So until the frontend has started, both strategies are
  // defined again in whichever registry is current -- as subclasses, since a
  // constructor may be registered only once -- and a page already stuck is
  // rebuilt. At most a minute; nothing to do once Home Assistant's own
  // element and ours are in the same registry.
  function defineHere() {
    var made = false;
    if (!customElements.get('ll-strategy-view-hk-room')) {
      customElements.define('ll-strategy-view-hk-room', class extends HkRoomViewStrategy {});
      made = true;
    }
    if (!customElements.get('ll-strategy-dashboard-hk-dashboard')) {
      customElements.define('ll-strategy-dashboard-hk-dashboard', class extends HkDashboardStrategy {});
      made = true;
    }
    if (made) recoverLate();
    return made;
  }
  (function () {
    var n = 0;
    var iv = setInterval(function () {
      try { defineHere(); } catch (e) { /* the registry is mid-swap: next tick */ }
      if (++n >= 600 || (window.hkShell.defined() &&
                         customElements.get('ll-strategy-dashboard-hk-dashboard'))) clearInterval(iv);
    }, 100);
  })();
  // For tests, the console and the other cards: hkStrategy.generate(config,
  // client). Every helper here that reads the house takes a client or the
  // host's object, converted at the door like the strategy's own hooks.
  function viaClient(fn) {
    return function (input) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = clientOf(input);
      return fn.apply(null, args);
    };
  }
  window.hkStrategy = { generate: HkDashboardStrategy.generate, tile: TILE, shortName: shortName,
    notHouseCamera: notHouseCamera,
                        lateError: lateError, recoverLate: recoverLate, defineHere: defineHere,
                        tileFor: viaClient(tileFor), roomCards: viaClient(roomCards), inventory: viaClient(inventory),
                        climateMembers: viaClient(climateMembers), pageMembers: viaClient(pageMembers),
                        batteryOf: viaClient(function (client, id) { return sibling(client, id, 'battery'); }),
                        groupOf: viaClient(groupOf), ownChange: ownChange,
                        // built again now, from the settings as they are (Edit mode's Reload)
                        rebuild: refreshKeepingPlace,
                        room: HkRoomViewStrategy.generate,
                        rooms: viaClient(rooms), contactGlyphs: contactGlyphs, overlay: overlay,
                        kioskOf: kioskOf, saverBlock: viaClient(saverBlock),
                        shouldRegenerate: HkDashboardStrategy.shouldRegenerate, inputs: inputs,
                        _built: built, _busy: busy };
})();
