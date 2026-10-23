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
// queries); the new cards (room, scene_suggested, action, everything) are
// G3's, in hk-grid-cards.js. A block with `pages` is an hk-pager-card
// (hk-layout.js, G4) holding one of its card per page: pages() below says which.
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
  // sees it -- { cameras, climate, rooms, weather, vacuum, battery } -- for a block
  // that names nothing of its own.
  var CARDS = {
    accessory: { sizes: ['S', 'W'], sources: [], opts: { entity: 'entity' }, card: function (s, o) {
      return o.entity ? { type: 'custom:hk-tile-card', entity: o.entity } : stand('Accessory', 'mdi:lightbulb'); } },
    scene: { sizes: ['S', 'W'], sources: [], opts: { scene: 'scene' }, card: function (s, o) {
      return o.scene ? { type: 'custom:hk-scene-card', entity: o.scene, icon_color: 'white' } : stand('Scene', 'mdi:palette'); } },
    scenes: { sizes: ['W', 'L', 'XL'], sources: ['scenes'], opts: { scenes: 'scenes' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-scenes-card' }, o.scenes ? { scenes: o.scenes } : {}); } },
    now_playing: { sizes: ['W', 'T', 'L'], sources: ['speakers'], opts: { speaker: 'speaker' }, card: function (s, o) {
      // T and L: the progress above the transport (the Home app's and Apple
      // Music's order); L the volume under it as well. Its speaker's own
      // controls, or the screen's music.
      var sp = own(o.speaker), ctl = function (parts) {
        return Object.assign({ type: 'custom:hk-media-control-card', color: 'purple', bare: true, parts: parts },
                             sp ? { entity: sp } : { entity_from: { music: true } });
      };
      var extra = s === 'L' ? { sub_card: ctl(['progress']), meta_card: ctl(['volume']) }
                : s === 'T' ? { sub_card: ctl(['progress']) } : {};
      return Object.assign({ type: 'custom:hk-now-playing-card', music: true }, sp ? { entity: sp } : {}, extra); } },
    thermostat: { sizes: ['T', 'L'], sources: ['thermostats'], opts: { entity: 'climate' }, card: function (s, o, ctx) {
      var id = own(o.entity) || (ctx.climate || [])[0];
      // the dial (hk-control.js), sized to the block (G2)
      return id ? { type: 'custom:hk-control-card', entity: id } : stand('Thermostat', 'hk:thermostat'); } },
    camera: { sizes: ['W', 'L', 'XL'], sources: ['cameras'], opts: { entity: 'camera' }, card: function (s, o, ctx) {
      var ids = o.entity ? [o.entity] : (ctx.cameras || []);
      return ids.length ? { type: 'custom:hk-camera-mosaic-card', height: 195, seam: 2, snapshot_cap: '480x270',
                            cameras: ids.map(function (id) { return { entity: id }; }) }
                        : stand('Cameras', 'hk:camera'); } },
    security: { sizes: ['S', 'W'], sources: [], card: function () {
      return { type: 'custom:hk-page-status-card', page: 'security' }; } },
    timers: { sizes: ['S', 'W'], sources: [], card: function () {
      return { type: 'custom:hk-timer-strip-card', entity: 'sensor.running_quick_timers' }; } },
    weather: { sizes: ['W', 'XL'], sources: [], opts: { entity: 'weather' }, card: function (s, o, ctx) {
      var id = o.entity || ctx.weather;
      return id ? { type: 'custom:hk-weather-band-card', section: 'hero', entity: id } : stand('Weather', 'hk:weather-partly-cloudy'); } },
    calendar: { sizes: ['T', 'L'], sources: [], opts: { calendars: 'calendars' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-calendar-pane-card' }, o.calendars ? { calendars: o.calendars } : {}); } },
    battery: { sizes: ['S', 'W'], sources: [], card: function (s, o, ctx) {
      // the house battery the Energy feature names (hk-energy.js), sized to the block (G2)
      var B = ctx.battery;
      return B && B.level ? { type: 'custom:hk-house-battery-card', level: B.level, stored: B.stored, backup: B.backup,
                              reserve: B.reserve, charge: B.charge, discharge: B.discharge }
                          : stand('Battery', 'mdi:home-battery'); } },
    people: { sizes: ['W'], sources: [], card: function () { return { type: 'custom:hk-people-card' }; } },
    vacuum: { sizes: ['S', 'W'], sources: [], opts: { entity: 'vacuum' }, card: function (s, o, ctx) {
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
  // a block with pages from a source its card has, an hk-pager-card, which
  // asks pages() for its pages (when it is drawn: a speakers block's
  // speakers come from the Music feature, after the strategy has run). A key
  // the catalog doesn't have (a layout saved by a newer HK) is a stand-in,
  // never an error card on a wall tablet.
  function config(item, ctx) {
    var it = item || {}, c = CARDS[it.card];
    if (!c) return stand('Unavailable', 'mdi:help-circle-outline');
    if (paged(it)) return { type: 'custom:hk-pager-card', item: it, ctx: ctx || {} };
    return c.card(it.size, it.opts || {}, ctx || {});
  }
  function paged(it) {
    var p = it.pages, c = CARDS[it.card];
    return !!(c && p && (p.source === 'list' ? Array.isArray(p.list) && p.list.length
                                             : c.sources.indexOf(p.source) >= 0));
  }

  // PAGES THAT SWIPE (docs/phase11/HOME-GRID.md, "Blocks that swipe"): a
  // block's pages, each { card, area, entity } -- the page's card config, and
  // the room and the thing it shows, for the pager's start page and the
  // doorbell's jump. At most PAGES_MAX, as hk_core checks a `list`.
  //   list         the pages set up, each the block's card with its own options
  //   rooms        one per room, in the screen's order (ctx.rooms)
  //   cameras      one per camera, in Cameras' order (ctx.cameras)
  //   thermostats  one per climate entity, in room order (ctx.areas: entity -> room)
  //   speakers     one per speaker, then each group (ctx.speakers: [{entity, area}])
  //   scenes       the scenes (ctx.scenes), as many to a page as the size holds
  // The block's own options go to every page, under the page's. Nothing in
  // the house to show: one page, the block's card as it is without pages.
  var PAGES_MAX = 12;
  var PER_PAGE = { W: 2, L: 4, XL: 6 };      // a scenes page's scenes, by size
  function pages(item, ctx) {
    var it = item || {}, c = CARDS[it.card], x = ctx || {};
    if (!c) return [{ card: stand('Unavailable', 'mdi:help-circle-outline') }];
    var p = it.pages || {}, base = it.opts || {}, areas = x.areas || {};
    function page(opts, extra) {
      var o = Object.assign({}, base, opts), cfg = c.card(it.size, o, x);
      // a scenes page shows just its scenes, never the screen's Scenes choice
      if (it.card === 'scenes' && o.scenes) cfg.room = true;
      return Object.assign({ card: cfg }, extra || {});
    }
    var out = [], rooms = x.rooms || [];
    if (!paged(it)) { /* no pages: the block's card, below */ }
    else if (p.source === 'list') {
      out = p.list.map(function (pg) { return page((pg && pg.opts) || {}); });
    } else if (p.source === 'rooms') {
      out = rooms.map(function (a) { return page({ area: a }, { area: a }); });
    } else if (p.source === 'cameras') {
      out = (x.cameras || []).map(function (id) { return page({ entity: id }, { entity: id, area: areas[id] || null }); });
    } else if (p.source === 'thermostats') {
      var rank = function (id) { var i = rooms.indexOf(areas[id]); return i < 0 ? rooms.length : i; };
      out = (x.climate || []).map(function (id, i) { return { id: id, i: i }; })
        .sort(function (a, b) { return (rank(a.id) - rank(b.id)) || (a.i - b.i); })
        .map(function (t) { return page({ entity: t.id }, { entity: t.id, area: areas[t.id] || null }); });
    } else if (p.source === 'speakers') {
      out = (x.speakers || []).filter(function (s) { return s && s.entity; })
        .map(function (s) { return page({ speaker: s.entity }, { entity: s.entity, area: s.area || null }); });
    } else if (p.source === 'scenes') {
      var per = PER_PAGE[it.size] || 4, all = (x.scenes || []).slice(0, per * PAGES_MAX);
      for (var i = 0; i < all.length; i += per) out.push(page({ scenes: all.slice(i, i + per) }));
    }
    out = out.slice(0, PAGES_MAX);
    return out.length ? out : [{ card: c.card(it.size, base, x) }];
  }

  // THE TABLET'S ROOM (`tablet_room` in a block's options and `pages.start`):
  // the room of the wall tablet showing this page -- an area id, or null on a
  // page that is no tablet's. The host answers (hkShell.tabletRoom: Home
  // Assistant's Wall Tablets entry, Mantel's tablet device); without that
  // call, hkSettings.tablet(), the settings' own answer to "which tablet is
  // this" (never the host's object).
  function tabletRoom(client) {
    var SH = window.hkShell, here = null;
    try { here = SH && typeof SH.tabletRoom === 'function' ? SH.tabletRoom(client) : null; } catch (e) { here = null; }
    if (here) return here;
    var HS = window.hkSettings, t = null;
    try { t = HS && typeof HS.tablet === 'function' ? HS.tablet(client) : null; } catch (e) { t = null; }
    return (t && t.room) || null;
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
                           PAGES_MAX: PAGES_MAX, PER_PAGE: PER_PAGE,
                           config: config, pages: pages, tabletRoom: tabletRoom, table: table };
  try { window.dispatchEvent(new CustomEvent('hk-grid-catalog-ready')); } catch (e) { /* a test page without events */ }
})();
