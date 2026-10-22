// hk-grid-catalog.js -- the Home Grid catalog (docs/phase11/HOME-GRID.md)
//
// A Home Grid block names a catalog KEY, not a Lovelace type: `room`, `camera`,
// `scenes`. This file turns a key, a size and the block's options into a real
// HK card config. hk_core/settings/home_grid.py CATALOG is its mirror -- the
// same keys, sizes and page sources, kept equal by a test
// (tests/test_hk_core_home_grid.py) -- so what the settings accept, a screen
// can draw.
//
// G1: each key is today's card, unsized. A card's own layout per size comes
// with G2 (the size attribute and --hk-cell-w/-h, read with container
// queries); pages that swipe with G4 -- until then a block shows its first
// page. The new cards (room, scene_suggested, action, everything) are G3's,
// in hk-grid-cards.js.
//
// Plain data and pure functions, loaded at parse time: no hk-base.js needed.
(function () {
  'use strict';
  if (window.hkGridCatalog) return;            // double-load guard

  // Size classes: [columns, rows] (hkCards.HOME_GRID is the same table)
  var SIZES = { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2] };
  var TABLET_ROOM = 'tablet_room';

  // a block whose card isn't drawn yet (G3), or with nothing in the house to show
  function stand(name, icon) { return { type: 'custom:hk-key-card', name: name, icon: icon }; }
  function own(v) { return v && v !== TABLET_ROOM ? v : null; }

  // key -> its sizes, the page sources it has besides `list`, and
  // card(size, opts, ctx): its card config. ctx is the house as the screen
  // sees it -- { cameras, climate, rooms, weather, vacuum } -- for a block
  // that names nothing of its own.
  var CARDS = {
    accessory: { sizes: ['S', 'W'], sources: [], card: function (s, o) {
      return o.entity ? { type: 'custom:hk-tile-card', entity: o.entity } : stand('Accessory', 'mdi:lightbulb'); } },
    scene: { sizes: ['S', 'W'], sources: [], card: function (s, o) {
      return o.scene ? { type: 'custom:hk-scene-card', entity: o.scene, icon_color: 'white' } : stand('Scene', 'mdi:palette'); } },
    scenes: { sizes: ['W', 'L', 'XL'], sources: ['scenes'], card: function (s, o) {
      return Object.assign({ type: 'custom:hk-scenes-card' }, o.scenes ? { scenes: o.scenes } : {}); } },
    now_playing: { sizes: ['W', 'T', 'L'], sources: ['speakers'], card: function (s, o) {
      return Object.assign({ type: 'custom:hk-now-playing-card', music: true }, own(o.speaker) ? { entity: o.speaker } : {}); } },
    thermostat: { sizes: ['T', 'L'], sources: ['thermostats'], card: function (s, o, ctx) {
      var id = own(o.entity) || (ctx.climate || [])[0];
      return id ? { type: 'custom:hk-climate-card', entity: id, icon_color: 'blue' } : stand('Thermostat', 'hk:thermostat'); } },
    camera: { sizes: ['W', 'L', 'XL'], sources: ['cameras'], card: function (s, o, ctx) {
      var ids = o.entity ? [o.entity] : (ctx.cameras || []);
      return ids.length ? { type: 'custom:hk-camera-mosaic-card', height: 195, seam: 2, snapshot_cap: '480x270',
                            cameras: ids.map(function (id) { return { entity: id }; }) }
                        : stand('Cameras', 'hk:camera'); } },
    security: { sizes: ['S', 'W'], sources: [], card: function () {
      return { type: 'custom:hk-page-status-card', page: 'security' }; } },
    timers: { sizes: ['S', 'W'], sources: [], card: function () {
      return { type: 'custom:hk-timer-strip-card', entity: 'sensor.running_quick_timers' }; } },
    weather: { sizes: ['W', 'XL'], sources: [], card: function (s, o, ctx) {
      var id = o.entity || ctx.weather;
      return id ? { type: 'custom:hk-weather-band-card', section: 'hero', entity: id } : stand('Weather', 'hk:weather-partly-cloudy'); } },
    calendar: { sizes: ['T', 'L'], sources: [], card: function () {
      return { type: 'custom:hk-calendar-pane-card' }; } },
    battery: { sizes: ['S', 'W'], sources: [], card: function () { return stand('Battery', 'mdi:home-battery'); } },
    people: { sizes: ['W'], sources: [], card: function () { return stand('People', 'mdi:account-multiple'); } },
    vacuum: { sizes: ['S', 'W'], sources: [], card: function (s, o, ctx) {
      var id = o.entity || ctx.vacuum;
      return id ? { type: 'custom:hk-vacuum-card', entity: id } : stand('Vacuum', 'hk:robot-vacuum'); } },
    clock: { sizes: ['W', 'XL'], sources: [], card: function () { return { type: 'custom:hk-clock-card' }; } },
    // THE NEW CARDS (G3, hk-grid-cards.js). `opts` names each option and its
    // kind, as home_grid.CATALOG does (a test holds them equal). A card handed
    // `tablet_room` resolves it itself, through the host (hkShell.tabletRoom):
    // the tablet showing the screen may be known only once the page is up.
    // `fallback` is the room it shows on a page that is no wall tablet.
    room: { sizes: ['W', 'L', 'XL'], sources: ['rooms'], opts: { area: 'area' }, card: function (s, o, ctx) {
      // no room of its own: the tablet's, else the screen's first
      return { type: 'custom:hk-grid-room-card', area: o.area || TABLET_ROOM, fallback: (ctx.rooms || [])[0] || null, size: s }; } },
    scene_suggested: { sizes: ['W', 'L'], sources: [], opts: { windows: 'windows' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-suggested-scene-card', size: s }, o.windows ? { windows: o.windows } : {}); } },
    action: { sizes: ['S'], sources: [], opts: { action: 'action', area: 'area' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-action-card', action: o.action || 'lock_up' }, o.area ? { area: o.area } : {}); } },
    everything: { sizes: ['S'], sources: [], opts: {}, card: function () { return { type: 'custom:hk-everything-card' }; } }
  };
  var SOURCES = ['list', 'rooms', 'cameras', 'thermostats', 'speakers', 'scenes'];

  // A BLOCK'S CARD: the item's card at its size, with its options -- or, for
  // a block with `list` pages, its first page's (G4 makes them swipe). A key
  // the catalog doesn't have (a layout saved by a newer HK) is a stand-in,
  // never an error card on a wall tablet.
  function config(item, ctx) {
    var it = item || {}, c = CARDS[it.card];
    if (!c) return stand('Unavailable', 'mdi:help-circle-outline');
    var opts = it.opts || {};
    var p = it.pages;
    if (p && p.source === 'list' && Array.isArray(p.list) && p.list[0]) opts = p.list[0].opts || {};
    return c.card(it.size, opts, ctx || {});
  }

  // the catalog as data, for the parity test and the editor (G5)
  function table() {
    var out = {};
    Object.keys(CARDS).forEach(function (k) {
      out[k] = { sizes: CARDS[k].sizes.slice(), sources: CARDS[k].sources.slice() };
      if (CARDS[k].opts) out[k].opts = Object.assign({}, CARDS[k].opts);
    });
    return out;
  }

  window.hkGridCatalog = { version: '1.0.0', SIZES: SIZES, SOURCES: SOURCES, TABLET_ROOM: TABLET_ROOM,
                           config: config, table: table };
  try { window.dispatchEvent(new CustomEvent('hk-grid-catalog-ready')); } catch (e) { /* a test page without events */ }
})();
