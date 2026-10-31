// THE HOME GRID'S BLOCKS AS WIDGETS, the tiles group (2026-10-31, the owner's
// notes on the widget mock-up): Scenes' and Accessories' Height and Color, a
// Scene at Wide, Action on each kind of dashboard, the Room's line and foot,
// Everything as app icons, Security's sizes, and a playing speaker's Centred
// glyph. A fictional house: nothing here names a real one.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run blocks_tiles');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');
window.customCards = [];
window.loadCardHelpers = function () { return new Promise(function () {}); };
globalThis.location.pathname = '/hk-kitchen/0';
globalThis.history = { pushState: function () {} };

var FEED = { kinds: { locks: ['lock.front_door', 'lock.back_door'], garage: ['cover.garage_door'] },
             accessories: { entities: { 'scene.movie_night': { color: 'purple' } } } };
window.hkSettings = {
  version: 1,
  get: function (path, fb) {
    var v = FEED;
    String(path).split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
    return v === undefined || v === null ? fb : v;
  },
  tablet: function () { return null; }
};

load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/cards/hk-room.js');
load(HK_ROOT + '/frontend/cards/hk-strategy.js');
load(HK_ROOT + '/frontend/cards/hk-chip.js');
load(HK_ROOT + '/frontend/cards/hk-grid-catalog.js');
load(HK_ROOT + '/frontend/cards/hk-grid-cards.js');

var ok = H.ok, eq = H.eq;
window.hkCards.createCard = function (cfg, client) {
  var el = window.hkCards.create(cfg);
  if (el && client) el.hkSetClient(client);
  return el;
};
var P = window.hkGridCards._, A = window.hkCards.ACCENTS;

function reg(area) { return { area_id: area }; }
var house = H.house({
  'light.den_lamp': ['on', { friendly_name: 'Den Lamp' }],
  'light.den_ceiling': ['off', { friendly_name: 'Den Ceiling' }],
  'light.kitchen_pendant': ['on', { friendly_name: 'Pendant' }],
  'sensor.den_temperature': ['70.6', { friendly_name: 'Den Temperature', device_class: 'temperature', unit_of_measurement: '°F' }],
  'media_player.den_speaker': ['playing', { friendly_name: 'Den Speaker' }],
  'switch.den_fan': ['off', { friendly_name: 'Den Fan Plug' }],
  'lock.front_door': ['locked', { friendly_name: 'Front Door' }],
  'lock.back_door': ['locked', { friendly_name: 'Back Door' }],
  'cover.garage_door': ['closed', { friendly_name: 'Garage Door', device_class: 'garage' }],
  'binary_sensor.den_window': ['on', { friendly_name: 'Den Window', device_class: 'window' }],
  'alarm_control_panel.house': ['armed_home', { friendly_name: 'House Alarm', code_format: 'number' }],
  'scene.movie_night': ['unknown', { friendly_name: 'Movie Night', entity_id: ['light.den_lamp', 'light.den_ceiling', 'cover.den_shades', 'media_player.den_speaker'] }],
  'scene.reading': ['unknown', { friendly_name: 'Reading' }],
  'scene.away': ['unknown', { friendly_name: 'Away' }]
});
function hass() {
  var h = house.hass();
  h.areas = { den: { area_id: 'den', name: 'Den' }, kitchen: { area_id: 'kitchen', name: 'Kitchen' } };
  h.entities = {};
  ['light.den_lamp', 'light.den_ceiling', 'sensor.den_temperature', 'media_player.den_speaker', 'switch.den_fan', 'binary_sensor.den_window']
    .forEach(function (id) { h.entities[id] = reg('den'); });
  h.entities['light.kitchen_pendant'] = reg('kitchen');
  h.devices = {};
  return h;
}
var client = window.hkHostClient.from(hass());
var plan = window.hkChip.scenes.plan;
function scenePills(n) { var out = []; for (var i = 0; i < n; i++) out.push({ type: 'custom:hk-scene-card', entity: 'scene.s' + i }); return out; }

H.run('BLOCKS (TILES)', [
function () {
  H.section('Scenes: Height and Color, the grid as many as there are');
  var at = function (size, n, o) { return plan(Object.assign({ hk_cell: size, room: true, scenes: scenePills(n) }, o || {}), {}, null).config; };
  eq('Wide, Full: two scenes, not four', [at('W', 6).cols, at('W', 6).rows, at('W', 6).pills.length], [2, 1, 2]);
  eq('Wide, Half: twice as many, two by two', [at('W', 6, { height: 'half' }).cols, at('W', 6, { height: 'half' }).rows], [2, 2]);
  eq('Large, Full four; Half eight', [at('L', 12).pills.length, at('L', 12, { height: 'half' }).pills.length], [4, 8]);
  eq('Extra Large, Full six; Half twelve', [at('XL', 20).pills.length, at('XL', 20, { height: 'half' }).pills.length], [6, 12]);
  eq('fewer than a row: one row of them', [at('XL', 2).cols, at('XL', 2).rows], [2, 1]);
  eq('...else the rows they fill, never an empty one', [at('L', 5, { height: 'half' }).cols, at('L', 5, { height: 'half' }).rows], [2, 3]);
  eq('Color and Half travel with the plan', [at('L', 4, { color: true, height: 'half' }).color, at('L', 4, { color: true, height: 'half' }).half], [true, true]);
  // the block's tiles: Full Centred with "Scene" under the name, Half the scene pill; Color their gradient
  var bp = window.hkChip.scenes.blockPill, one = { type: 'custom:hk-scene-card', entity: 'scene.reading' };
  var full = bp(one, { color: true }), half = bp(one, { half: true });
  eq('Full: a Centred tile, the line says Scene, on its own color', [full.tile, full.room, full.block_color], ['centred', 'Scene', true]);
  eq('Half: the pill, the Home app\'s button', [half.size, half.tile, 'block_color' in half], ['regular', 'home', false]);
},
function () {
  H.section('Accessories: Height and Color');
  var card = H.make('hk-grid-accessories-card');
  var acc = ['light.den_lamp', 'light.den_ceiling', 'media_player.den_speaker', 'switch.den_fan', 'lock.front_door'].map(function (e) { return { entity: e }; });
  card.setAttribute('size', 'L');
  card.setConfig({ accessories: acc, color: true });
  hkGive(card, hass());
  var p = card._plan();
  eq('Full at Large: four, two by two, Centred, no heading, in color', [p.tiles.length, p.cols, p.rows, p.centred, p.head, p.color], [4, 2, 2, true, false, true]);
  card.setConfig({ accessories: acc, height: 'half' });
  p = card._plan();
  eq('Half at Large: all five, the rows they fill', [p.tiles.length, p.cols, p.rows, p.half, p.centred], [5, 2, 3, true, false]);
  card.setAttribute('size', 'W');
  card.setConfig({ accessories: acc.slice(0, 1) });
  p = card._plan();
  eq('one accessory: one tile across the block', [p.cols, p.rows], [1, 1]);
},
function () {
  H.section('a tile in its own color (block_color)');
  var lamp = H.make('hk-light-card');
  lamp.setConfig({ entity: 'light.den_lamp', block_color: true });
  hkGive(lamp, hass()); lamp._render();
  var plate = lamp._els.card;
  ok('a lit accessory stands on its gradient, its glyph white', plate.hasAttribute('data-hk-grad') && /^#/.test(plate.style.getPropertyValue('--hk-grad-a')) &&
     lamp._els.icon.style.color === '#fff');
  var off = H.make('hk-light-card');
  off.setConfig({ entity: 'light.den_ceiling', block_color: true });
  hkGive(off, hass()); off._render();
  ok('...off, it keeps the glass', !off._els.card.hasAttribute('data-hk-grad'));
  var sc = H.make('hk-scene-card');
  sc.setConfig({ entity: 'scene.reading', block_color: true });
  hkGive(sc, hass()); sc._render();
  ok('a scene is always on its gradient (a tint of its own when it has no Color)', sc._els.card.hasAttribute('data-hk-grad'));
  eq('...the same tint for the same scene, every time', window.hkTile.ownTint('scene.reading'), window.hkTile.ownTint('scene.reading'));
  eq('a colour as a hex for its gradient', [window.hkTile.hexOf('rgba(255, 159, 10, 0.98)'), window.hkTile.hexOf('#30d158'), window.hkTile.hexOf('nope')],
     ['#ff9f0a', '#30d158', null]);
},
function () {
  H.section('a playing speaker, Centred: its own color, not grey');
  var sp = H.make('hk-media-card');
  sp.setConfig({ entity: 'media_player.den_speaker', icon: 'hk:speaker', icon_color: 'rgba(255, 255, 255, 0.85)', bare_icon: true, bare_icon_color: 'rgba(152, 152, 157, 1)' });
  hkGive(sp, hass());
  // (in a block's place: the block gives it its Tile Style)
  sp.setAttribute('data-group-fill', ''); sp.setAttribute('tile', 'centred'); sp._render();
  ok('Centred and playing: Music\'s pink (no Color of its own)', sp._els.icon.style.color.indexOf('152') < 0 && sp._ownColour(sp._config) === A.pink, sp._els.icon.style.color);
  sp.removeAttribute('tile'); sp._render();
  ok('...on a Home tile, the HomePod\'s grey as before', /152/.test(sp._els.icon.style.color), sp._els.icon.style.color);
  eq('an accessory\'s Color wins', sp._ownColour({ icon_color: 'teal' }), window.hkCards.PALETTE.icon.teal);
},
function () {
  H.section('a Scene block: Wide says what it does');
  eq('what a scene sets, counted', P.sceneSays(client, 'scene.movie_night'), 'Sets 2 lights, 1 shade and 1 speaker');
  eq('...a scene that says nothing is a Scene', P.sceneSays(client, 'scene.reading'), 'Scene');
  var card = H.make('hk-grid-entity-card');
  card.setAttribute('size', 'W');
  card._root.replaceChildren = function (c) { this.innerHTML = ''; this.appendChild(c); };
  card.setConfig({ entity: 'scene.movie_night', kind: 'scene', size: 'W', color: true });
  hkGive(card, hass());
  var t = card._tile();
  eq('Wide: the line is what it does, on its own color', [t.room, t.block_color], ['Sets 2 lights, 1 shade and 1 speaker', true]);
  card.setAttribute('size', 'S');
  eq('Small: "Scene"', card._tile().room, 'Scene');
},
function () {
  H.section('Action: HomeView\'s tile, or Shortcuts\' button');
  var card = H.make('hk-action-card');
  card.setConfig({ action: 'lights_off' });
  hkGive(card, hass());
  eq('a standard dashboard: Shortcuts\' button, in the action\'s color', card._look().paint, A.yellow);
  card.setAttribute('tile', 'centred');
  eq('a HomeView dashboard: the glass', card._look().paint, null);
  card.setConfig({ action: 'lights_off', color: true });
  card.setAttribute('tile', 'centred');
  eq('...or Color: its gradient', card._look().paint, A.yellow);
  eq('Lock Up and Garage: Security\'s teal; a scene its Color', [P.actionHex(client, 'lock_up'), P.actionHex(client, 'scene.movie_night')], [A.teal, '#bf5af2']);
},
function () {
  H.section('Room: what it is doing, and its foot line');
  var parts = P.roomParts(client, 'den');
  eq('Large: the temperature and the lights on', P.roomLine(client, 'den', parts, 'L'), '71° · 1 light on');
  eq('Wide: the short form', P.roomLine(client, 'den', parts, 'W'), '71° · 1 on');
  eq('Extra Large: a speaker playing as well', P.roomLine(client, 'den', parts, 'XL'), '71° · 1 light on · Speaker playing');
  // a page of a pager: "2 of 4" from the page's own label, the pager to turn
  var card = H.make('hk-grid-room-card');
  ok('no pager, no dots', card._paging() === null);
},
function () {
  H.section('Everything: the screen\'s pages and rooms as app icons');
  var was = window.hkMenu, cfg = window.hkCards.menu.config;
  window.hkCards.menu.config = function () { return { views: [{}, {}] }; };
  window.hkMenu = { _: { model: function () {
    return { top: [{ title: 'Weather', icon: 'mdi:weather-partly-cloudy', path: '/hk/weather', paths: ['1', 'weather'] }],
             categories: [{ title: 'Lights', icon: 'mdi:lightbulb', path: '/hk/lights', paths: ['2', 'lights'] }],
             rooms: [{ title: 'Den', icon: 'mdi:sofa', path: '/hk/den', paths: ['3', 'den'] }, { title: 'Kitchen', icon: 'mdi:fridge', path: '/hk/kitchen', paths: ['4', 'kitchen'] }] };
  } } };
  var items = P.menuItems(client);
  eq('pages in their accents, then rooms in their tints', items.map(function (x) { return [x.title, x.hex]; }),
     [['Weather', A.cyan], ['Lights', A.yellow], ['Den', A[window.hkCards.roomTint(0)]], ['Kitchen', A[window.hkCards.roomTint(1)]]]);
  eq('what is on now: lights, switches, fans on, speakers playing', P.onNow(client), 3);
  var card = H.make('hk-everything-card');
  card.setConfig({});
  hkGive(card, hass());
  var k = card._look();
  eq('Small: a folder of four, "N on now"', [k.folder.length, k.state], [4, '3 on now']);
  window.hkMenu = was; window.hkCards.menu.config = cfg;
},
function () {
  H.section('Security: the one fact, big');
  var look = P.alarmLook(client.states['alarm_control_panel.house']);
  eq('Armed, at Home, in teal', [look.word, look.mode, look.color], ['Armed', 'Home', A.teal]);
  eq('triggered: red', P.alarmLook({ state: 'triggered' }).color, A.red);
  var rows = P.secRows(client);
  eq('the open first, then the locks and the garage', rows.map(function (r) { return r.name + ':' + r.value; }),
     ['Den Window:Open', 'Front Door:Locked', 'Back Door:Locked', 'Garage Door:Closed']);
  eq('...said in a few words', P.secSays(rows), 'Den Window open');
  ok('Extra Large keeps the keypad beside the list; Large is the list with Home, Away and Disarm',
     H.make('hk-grid-keypad-card')._keys() === true && H.make('hk-grid-security-card')._keys() === false);
}
]);
