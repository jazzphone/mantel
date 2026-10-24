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
  var SIZES = { S: [1, 1], W: [2, 1], T: [1, 2], L: [2, 2], XL: [3, 2], XXL: [6, 2] };
  var TABLET_ROOM = 'tablet_room';

  // a block whose card isn't drawn yet (G3), or with nothing in the house to show
  function stand(name, icon) { return { type: 'custom:hk-key-card', name: name, icon: icon }; }
  function own(v) { return v && v !== TABLET_ROOM ? v : null; }
  // THE CLOCK FACES a block offers (hk-saverclock.js ids; '' is HK's own):
  // the ones that read at a block's size (Poster fills its screen edge to
  // edge and Glass draws a pane of its own: neither sits in a block)
  var CLOCK_FACES = [['', 'Digital'], ['analog', 'Analog'], ['classic', 'Classic'], ['serif', 'Big Serif'], ['flip', 'Flip'],
    ['lcd', 'Retro LCD'], ['neon', 'Neon'], ['nixie', 'Nixie Tubes'], ['dots', 'Dot Matrix'], ['arc', 'Minimal Arc']];
  function panel(kind, more) { return Object.assign({ type: 'custom:hk-grid-panel-card', panel: kind }, more || {}); }

  // key -> its sizes, the page sources it has besides `list`, and
  // card(size, opts, ctx): its card config. ctx is the house as the screen
  // sees it -- { cameras, climate, rooms, weather, vacuum, battery } -- for a block
  // that names nothing of its own.
  var CARDS = {
    accessory: { sizes: ['S', 'W'], sources: [], opts: { entity: 'entity', secondary: 'secondary' }, card: function (s, o) {
      return o.entity ? { type: 'custom:hk-grid-entity-card', entity: o.entity, secondary: o.secondary, kind: 'accessory', size: s } : stand('Accessory', 'mdi:lightbulb'); } },
    accessories: { sizes: ['W', 'L', 'XL', 'XXL'], sources: ['accessories'], opts: { accessories: 'accessories', title: 'title', surface: 'surface' }, card: function (s, o) {
      return { type: 'custom:hk-grid-accessories-card', accessories: o.accessories || [], title: o.title || 'Accessories', surface: o.surface }; } },
    scene: { sizes: ['S', 'W'], sources: [], opts: { scene: 'scene' }, card: function (s, o) {
      return o.scene ? { type: 'custom:hk-grid-entity-card', entity: o.scene, kind: 'scene', size: s } : stand('Scene', 'mdi:palette'); } },
    scenes: { sizes: ['W', 'L', 'XL', 'XXL'], sources: ['scenes'], opts: { scenes: 'scenes', surface: 'surface' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-scenes-card', surface: o.surface }, o.scenes ? { scenes: o.scenes } : {}); } },
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
    // Extra Large: the thermostat's full controls, its sheet (2026-10-24)
    thermostat: { sizes: ['T', 'L', 'XL'], sources: ['thermostats'], opts: { entity: 'climate' }, card: function (s, o, ctx) {
      var id = own(o.entity) || (ctx.climate || [])[0];
      if (s === 'XL') return panel('climate', id ? { entity: id } : {});
      // the dial (hk-control.js), sized to the block (G2)
      return id ? { type: 'custom:hk-control-card', entity: id } : stand('Thermostat', 'hk:thermostat'); } },
    camera: { sizes: ['W', 'L', 'XL'], sources: ['cameras'], opts: { entity: 'camera', follow: 'camera_follow', follow_select: 'select' }, card: function (s, o, ctx) {
      var ids = o.entity ? [o.entity] : (ctx.cameras || []).slice(0, 1);
      return ids.length ? { type: 'custom:hk-camera-mosaic-card', own_cameras: true, height: 195, seam: 2, snapshot_cap: '480x270',
                            cameras: ids.map(function (id) { return { entity: id }; }) }
                        : stand('Cameras', 'hk:camera'); } },
    // Large and Extra Large: the alarm's keypad (2026-10-24)
    security: { sizes: ['S', 'W', 'L', 'XL'], sources: [], opts: { entity: 'alarm' }, card: function (s, o) {
      if (s === 'L' || s === 'XL') return Object.assign({ type: 'custom:hk-grid-keypad-card' }, o.entity ? { entity: o.entity } : {});
      return Object.assign({ type: 'custom:hk-grid-security-card' }, o.entity ? { entity: o.entity } : {}); } },
    timers: { sizes: ['S', 'W'], sources: [], card: function () {
      return { type: 'custom:hk-timer-strip-card', entity: 'sensor.running_quick_timers' }; } },
    // Tall, and Big Temperature at any size: the number large, as StandBy has it (2026-10-24)
    weather: { sizes: ['W', 'T', 'L', 'XL'], sources: [], opts: { entity: 'weather', sky: 'boolean', big: 'boolean' }, card: function (s, o, ctx) {
      var id = o.entity || ctx.weather;
      return id ? Object.assign({ type: 'custom:hk-weather-band-card', section: 'hero', entity: id, sky: o.sky === true }, o.big ? { big: true } : {})
                : stand('Weather', 'hk:weather-partly-cloudy'); } },
    calendar: { sizes: ['T', 'L'], sources: [], opts: { calendars: 'calendars', days: 'days', month: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-calendar-pane-card' }, o.calendars ? { calendars: o.calendars } : {}, o.days ? { days: o.days } : {},
                           o.month ? { month: true } : {}); } },
    battery: { sizes: ['S', 'W'], sources: [], card: function (s, o, ctx) {
      // the house battery the Energy feature names (hk-energy.js), sized to the block (G2)
      var B = ctx.battery;
      return B && B.level ? { type: 'custom:hk-house-battery-card', level: B.level, stored: B.stored, backup: B.backup,
                              reserve: B.reserve, charge: B.charge, discharge: B.discharge }
                          : stand('Battery', 'mdi:home-battery'); } },
    people: { sizes: ['W'], sources: [], card: function () { return { type: 'custom:hk-people-card' }; } },
    // Large and Extra Large: its controls with Clean Areas (2026-10-24)
    vacuum: { sizes: ['S', 'W', 'L', 'XL'], sources: [], opts: { entity: 'vacuum' }, card: function (s, o, ctx) {
      var id = o.entity || ctx.vacuum;
      if (!id) return stand('Vacuum', 'hk:robot-vacuum');
      return { type: s === 'L' || s === 'XL' ? 'custom:hk-grid-vacuum-card' : 'custom:hk-vacuum-card', entity: id }; } },
    // every size, HK's clock or a screensaver face, with or without its box (2026-10-24)
    clock: { sizes: ['S', 'W', 'T', 'L', 'XL', 'XXL'], sources: [], opts: { clock_style: 'clock_style', bare: 'boolean' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-grid-clock-card' }, o.clock_style ? { clock_style: o.clock_style } : {}, o.bare ? { bare: true } : {}); } },
    // THE PAGES' OWN PANELS (2026-10-24; hk-grid-cards.js hk-grid-panel-card),
    // each read live from the house's settings as its page reads them
    power: { sizes: ['W', 'L', 'XL'], sources: [], opts: {}, card: function () { return panel('power'); } },
    music: { sizes: ['L', 'XL'], sources: [], opts: {}, card: function () { return panel('music'); } },
    doors: { sizes: ['L', 'XL'], sources: [], opts: {}, card: function () { return panel('doors'); } },
    live_tv: { sizes: ['L', 'XL'], sources: [], opts: {}, card: function () { return panel('tv'); } },
    water: { sizes: ['L', 'XL'], sources: [], opts: {}, card: function () { return panel('water'); } },
    // THE NEW CARDS (G3, hk-grid-cards.js). `opts` names each option and its
    // kind, as home_grid.CATALOG does (a test holds them equal). A card handed
    // `tablet_room` resolves it itself, through the host (hkShell.tabletRoom):
    // the tablet showing the screen may be known only once the page is up.
    // `fallback` is the room it shows on a page that is no wall tablet.
    room: { sizes: ['W', 'L', 'XL', 'XXL'], sources: ['rooms'], opts: { area: 'area', surface: 'surface', accessory_display: 'room_display' }, card: function (s, o, ctx) {
      // no room of its own: the tablet's, else the screen's first
      return { type: 'custom:hk-grid-room-card', area: o.area || TABLET_ROOM, fallback: (ctx.rooms || [])[0] || null, size: s, surface: o.surface, accessory_display: o.accessory_display || 'summary' }; } },
    scene_suggested: { sizes: ['W', 'L'], sources: [], opts: { windows: 'windows' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-suggested-scene-card', size: s }, o.windows ? { windows: o.windows } : {}); } },
    action: { sizes: ['S'], sources: [], opts: { action: 'action', area: 'area' }, card: function (s, o) {
      return Object.assign({ type: 'custom:hk-action-card', action: o.action || 'lock_up' }, o.area ? { area: o.area } : {}); } },
    everything: { sizes: ['S'], sources: [], opts: {}, card: function () { return { type: 'custom:hk-everything-card' }; } }
  };
  var SOURCES = ['list', 'rooms', 'cameras', 'thermostats', 'speakers', 'scenes', 'accessories'];

  // A BLOCK'S CARD: the item's card at its size, with its options -- or, for
  // a block with pages from a source its card has, an hk-pager-card, which
  // asks pages() for its pages (when it is drawn: a speakers block's
  // speakers come from the Music feature, after the strategy has run). A key
  // the catalog doesn't have (a layout saved by a newer HK) is a stand-in,
  // never an error card on a wall tablet.
  function config(item, ctx) {
    var it = item || {}, c = CARDS[it.card];
    if (!c) return stand('Unavailable', 'mdi:help-circle-outline');
    if ((it.rules && it.rules.length) || (it.when && it.fallback)) return { type: 'custom:hk-grid-conditional-card', item: it, ctx: ctx || {}, force: it._conditionPreview };
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
  var PER_PAGE = { W: 2, L: 4, XL: 6, XXL: 12 };      // a scenes page's scenes, by size
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
    } else if (p.source === 'accessories') {
      var entries = base.accessories || [], count = PER_PAGE[it.size] || 2;
      for (var ai = 0; ai < entries.length; ai += count) out.push(page({ accessories: entries.slice(ai, ai + count) }));
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

  var CONDITIONS = ['music_playing', 'timer_running', 'alarm_armed', 'alarm_disarmed', 'doorbell', 'after_sunset', 'entity_state', 'time'];
  function hhmm(t) { var m = /^(\d{2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  // the time of day in the house's zone, in minutes
  function houseNow(date) {
    var d = date || new Date();
    try {
      var L = window.hkLocale, z = L && L.zone ? L.zone() : null;
      var s = d.toLocaleTimeString('en-GB', Object.assign({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, z ? { timeZone: z } : {}));
      var m = hhmm(s.slice(0, 5));
      if (m !== null) return m;
    } catch (e) { /* no Intl */ }
    return d.getHours() * 60 + d.getMinutes();
  }
  // ONE CONDITION, or a rule's {all: [...]} (each must hold). `now`: minutes
  // into the house's day (a test's), else the clock's
  function matches(when, states, ringing, alarm, now) {
    if (when && Array.isArray(when.all)) return when.all.length > 0 && when.all.every(function (c) { return matches(c, states, ringing, alarm, now); });
    var c = when || {}, st = states || {}, ids = c.entity ? [c.entity] : Object.keys(st);
    if (c.kind === 'time') {
      var a = hhmm(c.from), b = hhmm(c.to), t = now == null ? houseNow() : now;
      if (a === null || b === null || a === b) return false;
      return a < b ? t >= a && t < b : t >= a || t < b;
    }
    if (c.kind === 'alarm_disarmed') return (c.entity ? ids : alarm ? [alarm] : ids).some(function (id) { return id.split('.')[0] === 'alarm_control_panel' && st[id] && st[id].state === 'disarmed'; });
    var any = function (domain, test) { return ids.some(function (id) { return id.split('.')[0] === domain && st[id] && test(st[id].state); }); };
    if (c.kind === 'entity_state') return !!st[c.entity] && st[c.entity].state === c.state;
    if (c.kind === 'music_playing') return any('media_player', function (s) { return s === 'playing'; });
    if (c.kind === 'timer_running') return any('timer', function (s) { return s === 'active' || s === 'paused'; }) ||
      !c.entity && !!st['sensor.running_quick_timers'] && Number(st['sensor.running_quick_timers'].state) > 0;
    if (c.kind === 'alarm_armed') return (c.entity ? ids : alarm ? [alarm] : ids).some(function (id) { return id.split('.')[0] === 'alarm_control_panel' && st[id] && /^(armed_|arming|pending|triggered)/.test(st[id].state); });
    if (c.kind === 'after_sunset') return any('sun', function (s) { return s === 'below_horizon'; });
    if (c.kind === 'doorbell') {
      // a ring (hk-house-event) counts when it was at this camera, or the condition names none
      var rang = ringing && (ringing === true || !c.entity || c.entity.indexOf('camera.') !== 0 || ringing === c.entity);
      return !!rang || !!c.entity && !!st[c.entity] && st[c.entity].state === 'on';
    }
    return false;
  }

  // A BLOCK'S DEFAULT AND ITS RULES, however it was saved: its own card and
  // `rules` (first match wins), or the older `when` + `fallback` read the same
  // way -- the fallback the default, the block's own card its one rule
  function rulesOf(item) {
    var it = item || {}, own = {};
    Object.keys(it).forEach(function (k) { if (['when', 'fallback', 'rules', '_conditionPreview'].indexOf(k) < 0) own[k] = it[k]; });
    if (it.rules && it.rules.length) return { base: own, rules: it.rules };
    if (it.when && it.fallback) return { base: Object.assign({ id: it.id, size: it.size, at: it.at }, it.fallback),
                                          rules: [{ when: it.when, card: it.card, opts: it.opts, pages: it.pages }] };
    return { base: own, rules: [] };
  }
  // which shows now: -1 the default, else the first rule that holds
  function choose(item, states, ringing, alarm, now) {
    var r = rulesOf(item).rules;
    for (var i = 0; i < r.length; i++) if (matches(r[i].when, states, ringing, alarm, now)) return i;
    return -1;
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
                           PAGES_MAX: PAGES_MAX, PER_PAGE: PER_PAGE, CLOCK_FACES: CLOCK_FACES,
                           CONDITIONS: CONDITIONS, matches: matches, rulesOf: rulesOf, choose: choose, houseNow: houseNow, config: config, pages: pages, tabletRoom: tabletRoom, table: table };
  try { window.dispatchEvent(new CustomEvent('hk-grid-catalog-ready')); } catch (e) { /* a test page without events */ }
})();
