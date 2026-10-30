// HOME GRID, slice G3 (docs/phase11/HOME-GRID.md): the new cards
// (cards/hk-grid-cards.js) -- the room, the suggested scene, an action and
// Everything -- their catalog entries, and the tablet's room asked of the
// host (hkShell.tabletRoom). A fictional house: nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run gridcards');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

// the settings feed, as the page holds it: the house's lists and this tablet
var FEED = { kinds: { locks: ['lock.front_door', 'lock.back_door'], lights: null, garage: ['cover.garage_door'] },
             accessories: { entities: { 'scene.good_morning': { color: 'orange' } } } };
var TABLET = null;
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return TABLET; }
};

load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');

var ok = H.ok, eq = H.eq;
// the host's card factory (Lovelace's hui-card, Mantel's view host): an HK card by its tag, handed the client
window.hkCards.createCard = function (cfg, client) {
  var el = window.hkCards.create(cfg);
  if (el && client) el.hkSetClient(client);
  return el;
};
var G = window.hkGridCards, P = G._;

// ---- the house
function reg(area) { return { area_id: area }; }
var house = H.house({
  'light.kitchen_pendant': ['on', { friendly_name: 'Kitchen Pendant', brightness: 128, supported_color_modes: ['brightness'] }],
  'light.kitchen_counter': ['off', { friendly_name: 'Kitchen Counter', supported_color_modes: ['brightness'] }],
  'light.kitchen_strip': ['off', { friendly_name: 'Kitchen Strip', supported_color_modes: ['onoff'] }],
  'light.den_lamp': ['on', { friendly_name: 'Den Lamp' }],
  'media_player.kitchen_speaker': ['playing', { friendly_name: 'Kitchen Speaker' }],
  'media_player.kitchen_tv': ['off', { friendly_name: 'Kitchen TV', device_class: 'tv' }],
  'lock.front_door': ['unlocked', { friendly_name: 'Front Door' }],
  'lock.back_door': ['locked', { friendly_name: 'Back Door' }],
  'cover.garage_door': ['closed', { friendly_name: 'Garage Door', device_class: 'garage' }],
  'scene.good_morning': ['2026-10-22T07:00:00', { friendly_name: 'Good Morning' }],
  'scene.dinner_time': ['2026-10-22T18:00:00', { friendly_name: 'Dinner Time' }],
  'scene.good_night': ['2026-10-21T22:30:00', { friendly_name: 'Good Night' }],
  'script.feed_the_cat': ['off', { friendly_name: 'Feed the Cat' }]
});
function hass() {
  var h = house.hass();
  h.areas = { kitchen: { area_id: 'kitchen', name: 'Kitchen' }, den: { area_id: 'den', name: 'Den' } };
  h.entities = { 'light.kitchen_pendant': reg('kitchen'), 'light.kitchen_counter': reg('kitchen'),
                 'light.kitchen_strip': reg('kitchen'), 'light.den_lamp': reg('den'),
                 'media_player.kitchen_speaker': reg('kitchen'), 'media_player.kitchen_tv': reg('kitchen'),
                 'lock.front_door': reg('den'), 'lock.back_door': reg('den'), 'cover.garage_door': reg('den'),
                 'scene.good_morning': reg('kitchen'), 'scene.dinner_time': reg('kitchen'), 'scene.good_night': reg('den'),
                 'script.feed_the_cat': reg('kitchen') };
  h.devices = {};
  return h;
}
var client = window.hkHostClient.from(hass());

H.run('GRID CARDS', [
function () {
  H.section('Centred tiles (2026-10-30, HOMEVIEW-LOOK.md Phase B): the block\'s Tile Style reaches its tile');
  var factory = window.hkCards.createCard;
  window.hkCards.createCard = function (cfg, c) { var el = H.make(cfg.type.slice(7)); el._root.replaceChildren = function (child) { this.innerHTML = ''; this.appendChild(child); }; el.setConfig(cfg); el.client = c; return el; };
  var acc = window.hkCards.createCard(window.hkGridCatalog.config({ card: 'accessory', size: 'S', opts: { entity: 'lock.front_door' } }), client);
  eq('Home: no attribute, no room line (the tile as it was)', [acc._child.getAttribute('tile'), 'room' in acc._child._config], [undefined, false]);
  acc.setAttribute('tile', 'centred'); acc.attributeChangedCallback('tile', null, 'centred'); acc.client = client;
  eq('Centred: on the accessory\'s tile, the name over its room', [acc._child.getAttribute('tile'), acc._child._config.room], ['centred', 'Den']);
  acc.removeAttribute('tile'); acc.attributeChangedCallback('tile', 'centred', null); acc.client = client;
  eq('...and back to Home', [acc._child.getAttribute('tile'), 'room' in acc._child._config], [undefined, false]);
  var sc = window.hkCards.createCard(window.hkGridCatalog.config({ card: 'scene', size: 'S', opts: { scene: 'scene.good_night' } }), client);
  sc.setAttribute('tile', 'centred'); sc.attributeChangedCallback('tile', null, 'centred'); sc.client = client;
  eq('a scene: centred, its line says it is one', [sc._child.getAttribute('tile'), sc._child._config.room], ['centred', 'Scene']);
  window.hkCards.createCard = factory;
  // the CSS: one variant, the tiles' own parts, from the table (hk-base.js TILE.centred)
  var tileCss = customElements.get('hk-tile-card').CSS, keyCss = customElements.get('hk-action-card').CSS, T = window.hkCards.TILE.centred;
  ok('the tile and the key each have the variant, keyed by the attribute', tileCss.indexOf(':host([tile=centred])') >= 0 && keyCss.indexOf(':host([tile=centred])') >= 0);
  ok('...a 196 x 150 cell\'s numbers, then a square cell\'s', tileCss.indexOf('top:' + T.tall.at + '%') >= 0 && tileCss.indexOf('@container hk-cell (min-height:180px){') >= 0 &&
     tileCss.indexOf('width:' + T.square.glyph + 'px !important;height:' + T.square.glyph + 'px !important') >= 0);
  ok('...the lock\'s and Lock Up\'s, the lights\' and the scenes\' tiles: hk-tile\'s and the key\'s', keyCss.indexOf('top:' + T.square.text + '%') >= 0);
  ok('...off, the glyph bare; lit, in its well (the white plate stays)', tileCss.indexOf(':host([tile=centred]) hk-plate.card:not([data-on="1"]) .well{background:none !important}') >= 0);
  ok('a block\'s corners on square cells: the tile and the key read --hk-block-radius', /:host\(\[size\]:not\(\[data-group-fill\]\)\) hk-plate\.card\{border-radius:var\(--hk-block-radius/.test(tileCss) &&
     /hk-plate\.k\{border-radius:var\(--hk-block-radius/.test(keyCss));
},
function () {
  H.section('Big Number and Analog Numbers in the catalog (2026-10-30, Phases C and F)');
  var C = window.hkGridCatalog, ctx = { climate: ['climate.den'] };
  eq('a thermostat block\'s Style: Big Number', C.config({ card: 'thermostat', size: 'L', opts: { style: 'big' } }, ctx), { type: 'custom:hk-control-card', entity: 'climate.den', style: 'big' });
  eq('...the dial when it is not chosen', C.config({ card: 'thermostat', size: 'T' }, ctx), { type: 'custom:hk-control-card', entity: 'climate.den' });
  eq('...Extra Large stays the sheet', C.config({ card: 'thermostat', size: 'XL', opts: { style: 'big' } }, ctx).type, 'custom:hk-grid-panel-card');
  eq('...every thermostat page takes it', C.pages({ card: 'thermostat', size: 'L', opts: { style: 'big' }, pages: { source: 'thermostats' } }, { climate: ['climate.den', 'climate.hall'] })
     .map(function (p) { return p.card.style; }), ['big', 'big']);
  eq('the option, and its kind', [C.table().thermostat.opts, C.THERMOSTAT_STYLES], [{ entity: 'climate', style: 'thermostat_style' }, [['dial', 'Dial'], ['big', 'Big Number']]]);
  eq('Analog Numbers after the faces a block had, then the HomeView-style three', C.CLOCK_FACES.slice(-4).map(function (f) { return f[0]; }), ['numbers', 'liquid', 'giant', 'scattered']);
  eq('...a clock block with it', C.config({ card: 'clock', size: 'S', opts: { clock_style: 'numbers', bare: true } }, {}), { type: 'custom:hk-grid-clock-card', clock_style: 'numbers', bare: true });
},
function () {
  H.section('standalone grid accessories reuse the room tile builder');
  var factory = window.hkCards.createCard;
  window.hkCards.createCard = function (cfg, c) { var el = H.make(cfg.type.slice(7)); el._root.replaceChildren = function (child) { this.innerHTML = ''; this.appendChild(child); }; el.setConfig(cfg); el.client = c; return el; };
  var id = 'light.kitchen_pendant', own = FEED.accessories.entities;
  own[id] = { icon: 'hk:coffee-maker-outline', color: 'orange', size: 'regular' };
  var cfg = window.hkGridCatalog.config({ card: 'accessory', size: 'S', opts: { entity: id, secondary: { mode: 'none' } } });
  var card = window.hkCards.createCard(cfg, client);
  var shared = window.hkStrategy.tileFor(client, id, 'Lamp'), child = card._child;
  eq('room glyph, measured size and color are reused',
    [child._config.type, child._config.icon, child._config.icon_size, child._config.icon_color],
    [shared.type, shared.icon, shared.icon_size, shared.icon_color]);
  eq('the grid keeps its tall geometry and caption override',
    [child._config.size, child._config.secondary.mode, child._config.view_layout], ['tall', 'none', undefined]);
  card.client = client;
  ok('unchanged pushes keep the child mounted', child === card._child);
  own[id] = { icon: 'hk:lamp', color: 'blue' }; window.hkSettings.version++;
  card.client = client;
  eq('saved accessory choices update the mounted tile', [card._child._config.icon, card._child._config.icon_color], ['hk:lamp', 'blue']);
  var lock = window.hkCards.createCard(window.hkGridCatalog.config({ card: 'accessory', size: 'W', opts: { entity: 'lock.front_door' } }), client);
  var roomLock = window.hkStrategy.tileFor(client, 'lock.front_door', 'Door');
  eq('state-specific glyphs come from the room builder too', lock._child._config.icon_states, roomLock.icon_states);
  eq('Wide uses regular pills', lock._child._config.size, 'regular');
  delete own[id]; window.hkSettings.version++; window.hkCards.createCard = factory;
},
function () {
  H.section('the catalog: the real cards, and the options they declare');
  var C = window.hkGridCatalog, ctx = { rooms: ['den', 'kitchen'] };
  var room = C.config({ card: 'room', size: 'L' }, ctx);
  eq('a room block with no room of its own: the tablet\'s, else the screen\'s first',
     [room.type, room.area, room.fallback, room.size], ['custom:hk-grid-room-card', 'tablet_room', 'den', 'L']);
  var pgs = C.pages({ card: 'room', size: 'L', pages: { source: 'rooms', start: 'tablet_room' } }, ctx);
  eq('...and a rooms pager: a room card per room (G4)', pgs.map(function (pg) { return [pg.card.type, pg.card.area]; }),
     [['custom:hk-grid-room-card', 'den'], ['custom:hk-grid-room-card', 'kitchen']]);
  eq('...or its own', C.config({ card: 'room', size: 'W', opts: { area: 'kitchen' } }, ctx).area, 'kitchen');
  var sg = C.config({ card: 'scene_suggested', size: 'W', opts: { windows: [{ start: '05:00', end: '10:00', scene: 'scene.good_morning' }] } }, ctx);
  eq('a suggested scene with its windows', [sg.type, sg.windows.length], ['custom:hk-suggested-scene-card', 1]);
  eq('an action', C.config({ card: 'action', size: 'S', opts: { action: 'lights_off', area: 'tablet_room' } }, ctx),
     { type: 'custom:hk-action-card', action: 'lights_off', area: 'tablet_room' });
  eq('Everything', C.config({ card: 'everything', size: 'S' }, ctx).type, 'custom:hk-everything-card');
  var t = C.table();
  eq('the options each declares (home_grid.CATALOG\'s: a pytest holds them equal)',
     [t.room.opts, t.scene_suggested.opts, t.action.opts, t.everything.opts],
     [{ area: 'area', surface: 'surface', accessory_display: 'room_display' }, { windows: 'windows' }, { action: 'action', area: 'area' }, {}]);
},
function () {
  H.section('the tablet\'s room, through the host');
  ok('the shell has tabletRoom', typeof window.hkShell.tabletRoom === 'function');
  eq('no wall tablet here: no room', window.hkShell.tabletRoom(client), null);
  TABLET = { id: 'kitchen_tablet', room: 'kitchen' };
  eq('Home Assistant: the Wall Tablets entry\'s room', window.hkShell.tabletRoom(client), 'kitchen');
  eq('a block\'s tablet_room is it', P.roomOf('tablet_room', 'den', client), 'kitchen');
  eq('...and so is the pager\'s start page (hkGridCatalog.tabletRoom)', window.hkGridCatalog.tabletRoom(client), 'kitchen');
  eq('a room of its own wins', P.roomOf('den', null, client), 'den');
  TABLET = null;
  eq('no tablet: the fallback', P.roomOf('tablet_room', 'den', client), 'den');
  var was = window.hkShell.tabletRoom;
  window.hkShell.use({ tabletRoom: function () { throw new Error('a broken host'); } });
  eq('a host that throws is no room, not an error', P.roomOf('tablet_room', 'den', client), 'den');
  window.hkShell.use(window.hkHAShell);
  ok('...and the Home Assistant shell is back', window.hkShell.tabletRoom === was);
},
function () {
  H.section('the room: its lights and its speaker, as its page has them');
  var parts = P.roomParts(client, 'kitchen');
  eq('the lights, A to Z', parts.lights.map(function (c) { return c.entity; }),
     ['light.kitchen_counter', 'light.kitchen_pendant', 'light.kitchen_strip']);
  eq('the speaker, not the TV', parts.speakers.map(function (c) { return c.entity; }), ['media_player.kitchen_speaker']);
  ok('the block excludes the room status row', !parts.status);
  eq('W: one row of two, including the speaker', P.layout(parts, 'W', P.fit('W', 141), client).map(function (c) { return c.entity; }),
     ['light.kitchen_counter', 'media_player.kitchen_speaker']);
  eq('L stays at two tall rows on a larger screen', P.fit('L', 334), 4);
  var l = P.layout(parts, 'L', 6, client);
  eq('...every light and the speaker', l.map(function (c) { return c.entity; }),
     ['light.kitchen_counter', 'light.kitchen_pendant', 'light.kitchen_strip', 'media_player.kitchen_speaker']);
  eq('L leaves room for its surrounding plate', P.fit('L', 290), 4);
  eq('XL: three across, two tall rows', P.fit('XL', 334), 6);
  eq('a cell too short for a pill: none', P.fit('W', 100), 0);
  ok('a light pill toggles on a tap, at its regular size', l[0].tap_action.action === 'toggle' && !l[0].hk_place && !l[0].view_layout);
  ok('the speaker\'s pill keeps its own tap', !l[3].tap_action || l[3].tap_action.action !== 'toggle');
},
function () {
  H.section('press and hold: the dimmer');
  var st = client.states;
  eq('a light\'s brightness in percent', [P.percent(st['light.kitchen_pendant']), P.percent(st['light.kitchen_counter'])], [50, 0]);
  eq('which dim', [P.dims('light.kitchen_pendant', st['light.kitchen_pendant']), P.dims('light.kitchen_strip', st['light.kitchen_strip'])],
     [true, false]);
  eq('a drag up brightens, down dims, held to 0..100', [P.dragged(50, -80), P.dragged(50, 80), P.dragged(50, -400), P.dragged(50, 400)],
     [100, 0, 100, 0]);
  eq('letting go sends one call', P.dimCall('light.kitchen_pendant', 35),
     ['light', 'turn_on', { entity_id: 'light.kitchen_pendant', brightness_pct: 35 }]);
  eq('...or turns it off at 0', P.dimCall('light.kitchen_pendant', 0), ['light', 'turn_off', { entity_id: 'light.kitchen_pendant' }]);

  // the card itself: a hold, a drag, a let-go -- one call through the action port
  var card = H.make('hk-grid-room-card');
  card.setAttribute('size', 'L');
  card.setConfig({ area: 'kitchen', size: 'L' });
  hkGive(card, (function () { var h = hass(); return h; })());
  card._h = 334;
  H.attach(card);
  card._render();
  var slots = card._e.tiles.children.filter(function (c) { return c.className === 'slot'; });
  eq('a slot per pill', slots.length, 4);
  var oldHeight = card._h; card._h = 220;
  var ordinary = card._plan().tiles.length;
  card.setAttribute('data-grid-pager', '');
  ok('paged rooms keep accessory targets clear of the dots', card._plan().tiles.length < ordinary);
  card.removeAttribute('data-grid-pager'); card._h = oldHeight;
  var pend = slots[1];                       // light.kitchen_pendant
  var fire = function (el, t, ev) { (el._listeners[t] || []).forEach(function (f) { f(ev); }); };
  house.calls.length = 0;
  fire(pend, 'pointerdown', { button: 0, clientX: 10, clientY: 100, pointerId: 1 });
  H.runTimers();
  fire(pend, 'pointermove', { clientX: 12, clientY: 60, preventDefault: function () {} });
  fire(pend, 'pointerup', {});
  var swallowed = false;
  fire(pend, 'click', { stopPropagation: function () { swallowed = true; }, preventDefault: function () {} });
  return H.tick().then(function () {
    eq('held and dragged up 40 px: one turn_on at 75%', house.calls,
       [{ domain: 'light', service: 'turn_on', data: { entity_id: 'light.kitchen_pendant', brightness_pct: 75 } }]);
    ok('the click after the hold is eaten (no toggle)', swallowed);
    // a quick tap is the pill's: no hold, nothing eaten
    house.calls.length = 0;
    swallowed = false;
    fire(pend, 'pointerdown', { button: 0, clientX: 10, clientY: 100, pointerId: 2 });
    fire(pend, 'pointerup', {});
    fire(pend, 'click', { stopPropagation: function () { swallowed = true; } });
    ok('a tap is left to the pill', !swallowed && house.calls.length === 0);
    // a sideways drag is a swipe: the hold never starts
    fire(pend, 'pointerdown', { button: 0, clientX: 10, clientY: 100, pointerId: 3 });
    fire(pend, 'pointermove', { clientX: 60, clientY: 102 });
    ok('a sideways drag cancels the hold (the pager\'s)', !card._holdT);
    fire(pend, 'pointercancel', {});
    // held still: the light's sheet
    var opened = [];
    var mi = window.hkShell.moreInfo;
    window.hkShell.moreInfo = function (id) { opened.push(id); };
    fire(pend, 'pointerdown', { button: 0, clientX: 10, clientY: 100, pointerId: 4 });
    H.runTimers();
    fire(pend, 'pointerup', {});
    // a light that doesn't dim: its sheet as soon as it is held
    var strip = slots[2];
    fire(strip, 'pointerdown', { button: 0, clientX: 10, clientY: 100, pointerId: 5 });
    H.runTimers();
    fire(strip, 'pointerup', {});
    window.hkShell.moreInfo = mi;
    eq('held still: its sheet; one that doesn\'t dim: its sheet at once', opened, ['light.kitchen_pendant', 'light.kitchen_strip']);
    ok('no call for either', house.calls.length === 0);
    H.detach(card);
    ok('detached: its observer is let go', !card._ro);
  });
},
function () {
  H.section('the suggested scene');
  var M = P.minutes;
  ok('a window holds its start, not its end', P.holds({ start: '05:00', end: '10:00' }, M('05:00')) &&
     !P.holds({ start: '05:00', end: '10:00' }, M('10:00')));
  ok('...and runs past midnight', P.holds({ start: '22:00', end: '05:00' }, M('23:30')) &&
     P.holds({ start: '22:00', end: '05:00' }, M('01:00')) && !P.holds({ start: '22:00', end: '05:00' }, M('12:00')));
  var s = P.suggestion(client, null, M('07:30'));
  eq('the card\'s own windows find their scenes by name: morning', [s.scene, s.label, s.end, s.next, s.art],
     ['scene.good_morning', 'Morning', '10:00', false, 'morning']);
  eq('evening: Dinner Time', P.suggestion(client, null, M('19:00')).scene, 'scene.dinner_time');
  eq('night, past midnight', P.suggestion(client, null, M('02:00')).scene, 'scene.good_night');
  var day = P.suggestion(client, null, M('12:00'));
  eq('no scene for the day: the next one, said as next', [day.scene, day.next, day.start], ['scene.dinner_time', true, '17:00']);
  var own = [{ start: '06:30', end: '09:00', scene: 'script.feed_the_cat', label: 'Breakfast' }];
  var b = P.suggestion(client, own, M('07:00'));
  eq('a block\'s own window, with its label', [b.scene, b.name, b.label], ['script.feed_the_cat', 'Feed the Cat', 'Breakfast']);
  eq('a window whose scene the house lacks is left out', P.suggestion(client, [{ start: '00:00', end: '23:59', scene: 'scene.gone' }], 600), null);

  var card = H.make('hk-suggested-scene-card');
  card.setAttribute('size', 'W');
  card._clock = function () { return new Date(2026, 9, 22, 7, 30); };
  window.hkLocale.zone = function () { return null; };       // the test's own clock, unzoned
  card.setConfig({});
  hkGive(card, hass());
  card._render();
  eq('it says the scene', [card._e.nm.textContent, card._e.lb.textContent], ['Good Morning', 'Morning']);
  ok('the art follows it: a morning sky', /gradient/.test(card._e.art.style.background));
  ok('its own color in its well', !!card._e.well.style.background);
  house.calls.length = 0;
  card._run();
  return H.tick().then(function () {
    eq('a tap sets it, through the action port', house.calls,
       [{ domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.good_morning' } }]);
    H.attach(card);
    var before = H.timers();
    H.detach(card);
    ok('its minute tick is given back on detach', H.timers() < before);
  });
},
function () {
  H.section('an action: one tap, one job, the state it changes');
  var lock = P.plan(client, 'lock_up');
  eq('Lock Up with a door unlocked', [lock.name, lock.state, lock.hot, lock.calls],
     ['Lock Up', '1 Unlocked', true, [['lock', 'lock', { entity_id: ['lock.front_door'] }]]]);
  var chosen = FEED.kinds.locks;
  FEED.kinds.locks = [];
  eq('no locks chosen in Status & Chips: every lock the house has', P.plan(client, 'lock_up').state, '1 Unlocked');
  FEED.kinds.locks = chosen;
  var off = P.plan(client, 'lights_off');
  eq('All Lights Off: every light that is on, one call per kind', [off.state, off.calls],
     ['2 Lights On', [['light', 'turn_off', { entity_id: ['light.den_lamp', 'light.kitchen_pendant'] }]]]);
  var room = P.plan(client, 'lights_off', 'kitchen');
  eq('...in one room', [room.name, room.calls[0][2].entity_id], ['Lights Off', ['light.kitchen_pendant']]);
  var g = P.plan(client, 'garage');
  eq('Garage: never one tap -- its sheet', [g.name, g.state, g.calls, g.sheet],
     ['Garage Door', 'Closed', [], 'cover.garage_door']);
  var sc = P.plan(client, 'script.feed_the_cat');
  eq('a script', [sc.name, sc.state, sc.calls], ['Feed the Cat', 'Script', [['script', 'turn_on', { entity_id: 'script.feed_the_cat' }]]]);
  eq('one the house lacks', P.plan(client, 'scene.gone').state, 'Not Found');

  var card = H.make('hk-action-card');
  card.setConfig({ action: 'lock_up' });
  hkGive(card, hass());
  card._render();
  eq('the key says its name and the state', [card._e.name.textContent, card._e.state.textContent], ['Lock Up', '1 Unlocked']);
  house.calls.length = 0;
  card._tap();
  return H.tick().then(function () {
    eq('a tap locks the one that is unlocked', house.calls,
       [{ domain: 'lock', service: 'lock', data: { entity_id: ['lock.front_door'] } }]);
    house.set('lock.front_door', 'locked');
    hkGive(card, hass());
    card._render();
    eq('...and then says so', card._e.state.textContent, 'All Locked');
    house.calls.length = 0;
    card._tap();
    ok('nothing to lock: nothing sent', house.calls.length === 0);
    // the room's lights, with the tablet's room
    TABLET = { id: 'den_tablet', room: 'den' };
    var c2 = H.make('hk-action-card');
    c2.setConfig({ action: 'lights_off', area: 'tablet_room' });
    hkGive(c2, hass());
    c2._render();
    eq('Lights Off in the tablet\'s room', c2._e.state.textContent, '1 Light On');
    TABLET = null;
    // a command that doesn't go (Mantel with commands off) says so
    var c3 = H.make('hk-action-card');
    c3.setConfig({ action: 'scene.good_night' });
    var h3 = hass();
    h3.callService = function () { return Promise.reject(new Error('commands_disabled')); };
    hkGive(c3, h3);
    c3._render();
    c3._tap();
    return H.tick(10).then(function () {
      c3._render();
      eq('a refused command: said in the state\'s place', c3._e.state.textContent, 'Couldn’t Send');
    });
  });
},
function () {
  H.section('the Cameras face: how many, and how they are arranged (2026-10-30)');
  eq('Extra Large: 3 x 2, six at most', [P.camGrid('XL', 6), P.camGrid('XL', 12)], [[3, 2], [3, 2]]);
  eq('Full Width: 4 x 2, eight at most', [P.camGrid('XXL', 8), P.camGrid('XXL', 9)], [[4, 2], [4, 2]]);
  eq('Full: 3 x 3, nine at most', [P.camGrid('F', 9, 1260, 630, 6), P.camGrid('F', 12, 0, 0, 3)], [[3, 3], [3, 3]]);
  eq('...and 2 x 4 in a view two columns wide (a phone): eight', [P.camGrid('F', 9, 402, 630, 2), P.camGrid('F', 8, 0, 0, 2)], [[2, 4], [2, 4]]);
  eq('fewer cameras, fewer places: four in Full are 2 x 2', P.camGrid('F', 4), [2, 2]);
  eq('...four in Full Width, one row, the tiles nearest 16:9', P.camGrid('XXL', 4, 1260, 310), [4, 1]);
  eq('...six in a landscape Full: 3 x 2, not 2 x 3', P.camGrid('F', 6, 1260, 630, 6), [3, 2]);
  eq('...one camera: the whole block', P.camGrid('XL', 1), [1, 1]);
  var cams = ['camera.driveway', 'camera.front_doorbell', 'camera.garden'];
  eq('a ring names its camera', P.camRing(cams, 'camera.garden'), 'camera.garden');
  eq('...or a camera called doorbell', [P.camRing(cams, null), P.camRing(cams, 'camera.elsewhere')], ['camera.front_doorbell', 'camera.front_doorbell']);
  eq('...and none without one', P.camRing(['camera.driveway'], null), null);
  var C = window.hkGridCatalog, ctx = { cameras: ['camera.driveway', 'camera.garden'] };
  eq('the catalog: every camera in Cameras\' order when it names none', C.config({ card: 'cameras', size: 'F' }, ctx),
     { type: 'custom:hk-grid-cameras-card', cameras: ['camera.driveway', 'camera.garden'] });
  eq('...its own, and its refresh', C.config({ card: 'cameras', size: 'XL', opts: { cameras: ['camera.garden'], refresh: 30 } }, ctx),
     { type: 'custom:hk-grid-cameras-card', cameras: ['camera.garden'], refresh: 30 });
  eq('...a house with no camera: the stand-in', C.config({ card: 'cameras', size: 'XL' }, {}).type, 'custom:hk-key-card');
  eq('...its sizes and options', [C.table().cameras.sizes, C.table().cameras.opts], [['XL', 'XXL', 'F'], { cameras: 'cameras', refresh: 'refresh' }]);
  eq('Full is the grid\'s own columns and rows', [C.SIZES.F, C.span('F', 3, 3), C.span('F', 2, 4), C.span('XL', 6, 4)], [[0, 0], [3, 3], [2, 4], [3, 2]]);
},
function () {
  H.section('the Cameras face: the stills, a tap, the doorbell live in its place (2026-10-30)');
  var factory = window.hkCards.createCard, made = [];
  window.hkCards.createCard = function (cfg) {
    var el = document.createElement('div');
    el.configs = [cfg];
    el.setConfig = function (c) { el.configs.push(c); };
    made.push(el);
    return el;
  };
  var states = {};
  ['driveway', 'front_doorbell', 'garden', 'garage', 'side_gate', 'patio', 'pool', 'shed', 'porch', 'attic'].forEach(function (n) {
    states['camera.' + n] = { entity_id: 'camera.' + n, state: 'idle', attributes: { friendly_name: n } };
  });
  var h = hass();
  Object.keys(states).forEach(function (id) { h.states[id] = states[id]; });
  var card = H.make('hk-grid-cameras-card');
  card.setAttribute('size', 'F');
  card.setConfig({ cameras: Object.keys(states), refresh: 15 });
  hkGive(card, h);
  card._render();
  var m = made[0], cfg = m && m.configs[m.configs.length - 1];
  eq('one mosaic of stills in the block\'s arrangement (nothing before the house is known)', [made.length, cfg.type, cfg.grid, cfg.cameras.length, cfg.refresh, cfg.live],
     [1, 'custom:hk-camera-mosaic-card', [3, 3], 9, 15, undefined]);
  eq('...the first nine, in order', cfg.cameras[1].entity, 'camera.front_doorbell');
  eq('...sized as its block', m.getAttribute('size'), 'F');
  window.hkPopupCover = 0;
  card.connectedCallback();                                         // (on the page: it listens)
  window.dispatchEvent(new CustomEvent('hk-house-event', { detail: { type: 'notification', kind: 'doorbell', camera: 'camera.front_doorbell' } }));
  cfg = m.configs[m.configs.length - 1];
  eq('a ring: the doorbell live in its place, the only live one', [cfg.live, made.length], ['camera.front_doorbell', 1]);
  window.hkPopupCover = 1;
  window.dispatchEvent(new CustomEvent('hk-popup-change', { detail: { cover: 1 } }));
  eq('a sheet over it (the camera sheet, live): its tile a still again', m.configs[m.configs.length - 1].live, undefined);
  window.hkPopupCover = 0;
  window.dispatchEvent(new CustomEvent('hk-popup-change', { detail: { cover: 0 } }));
  eq('...and live again when it closes, while it rings', m.configs[m.configs.length - 1].live, 'camera.front_doorbell');
  window.dispatchEvent(new CustomEvent('hk-house-event', { detail: { type: 'notification', kind: 'motion' } }));
  eq('another notification changes nothing', m.configs[m.configs.length - 1].live, 'camera.front_doorbell');
  card.disconnectedCallback();
  card._render();
  eq('off the page: no ring kept', m.configs[m.configs.length - 1].live, undefined);
  window.hkCards.createCard = factory;
},
function () {
  H.section('Everything');
  var card = H.make('hk-everything-card');
  card.setConfig({});
  hkGive(card, hass());
  var opened = 0, was = window.hkMenu;
  window.hkMenu = { open: function () { opened++; } };
  card._render();
  eq('its name, and the menu\'s pages and rooms', card._e.name.textContent, 'Everything');
  card._tap();
  eq('no tab bar: a tap opens the side menu', opened, 1);
  // with the tab bar showing: its More sheet, not a second menu
  var sheets = [], tb = window.hkCards.menu.tabBar, bar = window.hkTabBar;
  window.hkCards.menu.tabBar = function () { return true; };
  window.hkTabBar = { open: function (k) { sheets.push(k); } };
  card._tap();
  window.hkCards.menu.tabBar = tb; window.hkTabBar = bar; window.hkMenu = was;
  eq('the tab bar showing: its More sheet', [sheets, opened], [['more'], 1]);
}
]);
