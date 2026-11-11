// hk-settings-model-lists.js - the lists, the sky, your own dashboards and the Pages screen.
//
// PART OF THE SETTINGS MODEL (hk-settings-model.js). Not a card and not run on its own: it registers one
// function, which hk-settings-model.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsModelParts = window.hkSettingsModelParts || {})['hk-settings-model-lists'] = function (K) {
    var haName = K.haName, MONTHS = K.MONTHS, PAGE_LABELS = K.PAGE_LABELS, PN = K.PN,
        SKY_PAGE_LABELS = K.SKY_PAGE_LABELS;

    // ------------------------------------------------------------ the lists
    // Each list model: { auto, rows: [{value, label?, kind, ...}], more: [...] }
    // `rows` are what shows, in order; `more` what can be added.

    // CHIPS: `chips` orders kinds and own chips (entities); `chips_extra` says
    // which own chips exist; `chips_quiet` which kinds wait for news.
    // CUSTOM CHIPS: the house's own chips in YAML ({key, name,
    // after}); a screen's chips_custom says which it shows, and its chip order
    // may place one as "chip:<key>" -- unplaced, one sits where it says (after a
    // kind, at the start or the end), as the chip row puts it (hk-chip.js).
    var CHIP_TOKEN = 'chip:';
    function isCustomTok(k) { return String(k).indexOf(CHIP_TOKEN) === 0; }
    function libOf(custom) { var o = {}; (custom || []).forEach(function (c) { if (c && c.key) o[c.key] = c; }); return o; }
    // the order the chip row draws: kinds (or the screen's order), own chips
    // after them, then each unplaced custom chip where it says
    function chipOrder(base, extra, mineC, lib) {
      var order = base.slice();
      extra.forEach(function (e) { if (order.indexOf(e) < 0) order.push(e); });
      mineC.forEach(function (k) {
        var t = CHIP_TOKEN + k;
        if (order.indexOf(t) >= 0) return;
        var a = (lib[k] || {}).after, at = a === 'start' ? 0 : order.indexOf(a) + 1;
        if (at <= 0 && a !== 'start') at = order.length;
        order.splice(at, 0, t);
      });
      return order;
    }
    function isOwn(k) { return k.indexOf('.') >= 0 || k === 'intercom'; }  // an entity, or the Intercom (chips_extra; from More only)
    // `intercom`: the page has the Intercom, so More offers it
    function chipsModel(b, kinds, custom, intercom) {
      var lib = libOf(custom);
      var extra = (b.chips_extra || []).slice();
      var mineC = (b.chips_custom || []).filter(function (k) { return lib[k]; });
      var chips = (b.chips || []).filter(function (k) {
        return isCustomTok(k) ? mineC.indexOf(k.slice(CHIP_TOKEN.length)) >= 0 : !isOwn(k) || extra.indexOf(k) >= 0;
      });
      var auto = !chips.length;
      var order = chipOrder(auto ? kinds : chips, extra, mineC, lib);
      var quiet = b.chips_quiet || [];
      var rows = order.map(function (k) {
        if (isCustomTok(k)) { var key = k.slice(CHIP_TOKEN.length); return { value: k, custom: true, key: key, name: lib[key].name }; }
        return { value: k, own: isOwn(k), quiet: !isOwn(k) && quiet.indexOf(k) >= 0 };
      });
      var more = (auto ? [] : kinds.filter(function (k) { return order.indexOf(k) < 0; })
        .map(function (k) { return { value: k, own: false }; })).concat(intercom && order.indexOf('intercom') < 0 ? [{ value: 'intercom', own: true }] : [])
        .concat((custom || []).filter(function (c) { return mineC.indexOf(c.key) < 0; })
          .map(function (c) { return { value: CHIP_TOKEN + c.key, custom: true, key: c.key, name: c.name }; }));
      return { auto: auto, rows: rows, more: more };
    }
    // the Shown list, in order -> what is saved. A list that is the automatic
    // order (the kinds, own chips after them, custom chips where they say)
    // stays automatic, so a kind the house gains later still shows.
    function chipsSave(values, kinds, custom) {
      var lib = libOf(custom);
      var mine = values.filter(function (k) { return !isCustomTok(k) && isOwn(k); });
      var mineC = values.filter(isCustomTok).map(function (k) { return k.slice(CHIP_TOKEN.length); });
      var asAuto = chipOrder(kinds, mine, mineC, lib).join() === values.join();
      return { chips_extra: mine, chips_custom: mineC, chips: asAuto ? [] : values };
    }
    function chipsAddCustom(b, key) {
      return { chips_custom: (b.chips_custom || []).filter(function (k) { return k !== key; }).concat(key) };
    }
    function chipsRemoveCustom(b, key) {
      return { chips_custom: (b.chips_custom || []).filter(function (k) { return k !== key; }),
               chips: (b.chips || []).filter(function (k) { return k !== CHIP_TOKEN + key; }) };
    }
    // own chips come and go without leaving automatic
    // one accessory chip, or several (a picker's Select)
    function chipsAddOwn(b, ids) {
      ids = [].concat(ids);
      var extra = (b.chips_extra || []).concat(ids).filter(function (x, i, a) { return a.indexOf(x) === i; });
      var chips = (b.chips || []).length ? b.chips.concat(ids.filter(function (id, i) {
        return b.chips.indexOf(id) < 0 && ids.indexOf(id) === i; })) : [];
      return { chips_extra: extra, chips: chips };
    }
    function chipsRemoveOwn(b, id) {
      return { chips_extra: (b.chips_extra || []).filter(function (x) { return x !== id; }),
               chips: (b.chips || []).filter(function (x) { return x !== id; }) };
    }
    function chipQuiet(b, kind, quiet) {
      var q = (b.chips_quiet || []).filter(function (k) { return k !== kind; });
      if (quiet) q.push(kind);
      return { chips_quiet: q };
    }

    // SCENES: `scenes` orders scene entities and "page:<kind>" pills;
    // `scenes_pages` says which page pills exist. Automatic (no scenes): every
    // scene A to Z on a generated screen, the YAML's list on a hand-written
    // one -- with the page pills after them.
    var PAGE_TOKEN = 'page:';
    function scenesModel(b, autoScenes, scenePages) {
      var sp = b.scenes_pages || [];
      var scenes = (b.scenes || []).filter(function (id) {
        return id.indexOf(PAGE_TOKEN) !== 0 || sp.indexOf(id.slice(PAGE_TOKEN.length)) >= 0;
      });
      var auto = !scenes.length;
      var order = (auto ? autoScenes.slice() : scenes.slice());
      sp.forEach(function (k) { if (order.indexOf(PAGE_TOKEN + k) < 0) order.push(PAGE_TOKEN + k); });
      var more = scenePages.filter(function (k) { return sp.indexOf(k) < 0; })
        .map(function (k) { return { value: PAGE_TOKEN + k, page: k }; });
      return {
        auto: auto,
        rows: order.map(function (v) { return v.indexOf(PAGE_TOKEN) === 0 ? { value: v, page: v.slice(PAGE_TOKEN.length) } : { value: v }; }),
        more: more
      };
    }
    function scenesSave(values) {
      return { scenes: values,
               scenes_pages: values.filter(function (v) { return v.indexOf(PAGE_TOKEN) === 0; })
                 .map(function (v) { return v.slice(PAGE_TOKEN.length); }) };
    }
    // a page pill added or removed while automatic: only scenes_pages changes
    function scenesPagePill(b, page, on) {
      var sp = (b.scenes_pages || []).filter(function (k) { return k !== page; });
      if (on) sp.push(page);
      var out = { scenes_pages: sp };
      if ((b.scenes || []).length && !on) out.scenes = b.scenes.filter(function (v) { return v !== PAGE_TOKEN + page; });
      if ((b.scenes || []).length && on && b.scenes.indexOf(PAGE_TOKEN + page) < 0) out.scenes = b.scenes.concat(PAGE_TOKEN + page);
      return out;
    }

    // PAGES (a generated screen): the kinds and the house's custom pages, in
    // one order; `custom_pages` says which custom pages this screen shows.
    // BROWSE MUSIC IS NOT A PAGE OF ITS OWN since 2026-10-11 (it is part of the
    // Music page): never a row, never saved -- an older saved order's `browse`
    // is dropped as it is read.
    function noBrowse(list) { return list.filter(function (k) { return k !== 'browse'; }); }
    function pagesModel(b, pageOrder, custom) {
      pageOrder = noBrowse(pageOrder);
      var pages = noBrowse(b.pages || []), cp = (b.custom_pages || []).filter(function (k) { return custom[k] !== undefined; });
      var auto = !pages.length;
      var order;
      if (auto) {
        order = pageOrder.slice();
        var ri = order.indexOf('rooms');
        cp.forEach(function (k) { order.splice(ri < 0 ? order.length : ri++, 0, k); });
      } else {
        order = pages.filter(function (k) { return pageOrder.indexOf(k) >= 0 || custom[k] !== undefined; })
          .filter(function (k) { return custom[k] === undefined || cp.indexOf(k) >= 0; });
        cp.forEach(function (k) {
          if (order.indexOf(k) >= 0) return;
          var r = order.indexOf('rooms');
          order.splice(r >= 0 ? r : order.length, 0, k);
        });
      }
      var more = pageOrder.filter(function (k) { return k !== 'browse' && order.indexOf(k) < 0; })
        .map(function (k) { return { value: k }; })
        .concat(Object.keys(custom).filter(function (k) { return order.indexOf(k) < 0; })
          .map(function (k) { return { value: k, custom: true }; }));
      return { auto: auto,
               rows: order.map(function (k) { return { value: k, custom: custom[k] !== undefined }; }),
               more: more };
    }
    // A SCREEN WITH NO HOME PAGE: the pages it is only, in order -- any page
    // kind and any custom page. Its `only_pages`; a screen set up before
    // 2026-10-04 has only `custom_pages`, where `energy` is the Energy
    // feature's page (energyOn). `pageOrder` is the kinds the house can have.
    function onlyModel(b, pageOrder, custom, energyOn) {
      pageOrder = noBrowse(pageOrder);
      var kind = function (k) { return pageOrder.indexOf(k) >= 0; };
      var cur = (b.only_pages || []).length
        ? b.only_pages.filter(function (k) { return kind(k) || custom[k] !== undefined; })
        : (b.custom_pages || []).filter(function (k) { return custom[k] !== undefined || (k === 'energy' && energyOn && kind(k)); });
      cur = noBrowse(cur);
      var more = pageOrder.filter(function (k) { return k !== 'browse' && cur.indexOf(k) < 0; })
        .map(function (k) { return { value: k }; })
        .concat(Object.keys(custom).filter(function (k) { return cur.indexOf(k) < 0; })
          .map(function (k) { return { value: k, custom: true }; }));
      return { rows: cur.map(function (k) { return { value: k, custom: custom[k] !== undefined }; }),
               more: more };
    }
    // EACH PAGE'S BACKGROUND (Sky / Background -> Page Backgrounds): the pages
    // there are, each with whether it has a color of its own (hk-sky.js
    // STATIC -- Automatic keeps it) or shows the live sky by default. `keys`:
    // the pages to list (page kinds, `rooms`, custom page addresses);
    // `custom`: address -> title.
    var SKY_OWN = { cameras: 1, live_tv: 1, security: 1, doors_windows: 1, climate: 1, lights: 1, timers: 1, calendar: 1,
                    vacuums: 1, music: 1, water: 1, energy: 1 };
    function skyPageRows(keys, custom) {
      return keys.filter(function (k) { return k !== 'browse'; }).map(function (k) {
        var isCustom = custom && custom[k] !== undefined;
        return { key: k, label: isCustom ? custom[k] : (SKY_PAGE_LABELS[k] || PAGE_LABELS[k] || k), custom: isCustom,
                 own: !isCustom && !!SKY_OWN[k] };
      });
    }
    // what Automatic means for a page, in words
    // (a page left alone says Automatic: the user, 2026-10-17 -- "Page
    // Color" there read as if Page Color had been picked)
    function skyAutoLabel(row) {
      return 'Automatic';
    }
    // a mode in words: 'own', 'live', 'photo' or a backdrop id (backdrops: [{id, label}])
    function skyModeLabel(mode, backdrops) {
      if (mode === 'own') return 'Page Color';
      if (mode === 'photo') return 'Photo';
      if (mode === 'landscapes') return 'Landscapes';
      if (mode === 'wallpaper') return 'Wallpaper';
      var b = (backdrops || []).filter(function (x) { return x.id === mode; })[0];
      return b ? b.label : mode === 'live' ? 'Live Sky' : mode;
    }
    // the choices for one page: Automatic (or Same as All Screens), Page Color
    // where it has one, the live sky, then every fixed backdrop
    function skyModeOptions(row, backdrops, first) {
      var out = [['', first]];
      if (row.own) out.push(['own', 'Page Color']);
      (backdrops || []).forEach(function (b) { out.push([b.id, b.label]); });
      return out;
    }
    // WHAT A SCREEN SHOWS, in a few words: null for a whole screen (Home,
    // rooms, every page); for one with no Home page, "Only Energy", "Only
    // Security & Cameras", "Only 4 Pages" -- or "No Pages Picked Yet" (it
    // shows everything until one is). `label(k)`: a page's name.
    function onlySummary(b, pageOrder, custom, energyOn, label) {
      if (!b || b.home_page !== false) return null;
      var keys = onlyModel(b, pageOrder, custom, energyOn).rows.map(function (r) { return r.value; })
        .filter(function (k) { return k !== 'browse'; });
      if (!keys.length) return { keys: [], text: 'No Pages Picked Yet' };
      var names = keys.map(label);
      return { keys: keys, text: keys.length === 1 ? 'Only ' + names[0] : keys.length === 2 ? 'Only ' + names[0] + ' & ' + names[1]
                                                    : 'Only ' + keys.length + ' Pages', names: names };
    }
    function pagesSave(values, custom) {
      var keep = noBrowse(values);
      return { pages: keep, custom_pages: keep.filter(function (k) { return custom[k] !== undefined; }) };
    }
    // a custom page shown or not while automatic: only custom_pages changes
    function pagesCustom(b, path, on) {
      var cp = (b.custom_pages || []).filter(function (k) { return k !== path; });
      if (on) cp.push(path);
      var out = { custom_pages: cp };
      if ((b.pages || []).length) {
        var p = b.pages.filter(function (k) { return k !== path; });
        if (on) { var r = p.indexOf('rooms'); p.splice(r >= 0 ? r : p.length, 0, path); }
        out.pages = p;
      }
      return out;
    }

    // WHERE A PAGE SITS IN THE MENU: at the TOP (right under
    // Home, above Categories), under CATEGORIES, or NOT in the menu (still one
    // tap away on its chip). Two settings say it: `menu_top` -- the view paths
    // at the top (empty: the views' own `menu: top`, a generated screen's
    // Weather, Cameras and Live TV) -- and `categories` -- the view paths listed
    // under Categories (empty: automatic: the pages Home's chips open, or on a
    // generated screen, whose chip row names none, every page).
    // `items`: the pages that can be placed, in menu order:
    //   [{path, top: its own default, auto: listed when automatic}]
    var MENU_PATHS = { weather: 'weather', calendar: 'calendar', cameras: 'cameras', live_tv: 'live-tv', security: 'security',
                       doors_windows: 'doors-windows', climate: 'climate', lights: 'lights', timers: 'timers',
                       vacuums: 'vacuums', music: 'playmusic', water: 'water', energy: 'energy',
                       // (the Power page, 2026-10-14: missing here, its row had no
                       // place in the menu to pick -- hk-menu.js PAGE_PATHS has it)
                       power: 'power' };
    var MENU_TOPS = { weather: 1, cameras: 1, live_tv: 1 };
    var MENU_FIXED = { rooms: 'Under Rooms' };
    var MENU_PLACES = [['top', 'Top of Menu'], ['list', 'Categories'], ['off', 'Not in Menu']];
    var NO_TOP = '-';
    function menuPathOf(k, custom) { return MENU_PATHS[k] || (custom && custom[k] !== undefined ? k : null); }
    // a generated screen's pages (kinds and custom pages, in its order) as items
    function menuItems(keys, custom) {
      var out = [];
      keys.forEach(function (k) {
        var p = menuPathOf(k, custom);
        if (p) out.push({ path: p, key: k, top: !!MENU_TOPS[k], auto: true });
      });
      return out;
    }
    function topsOf(b, items) {
      return (b.menu_top || []).length ? b.menu_top.slice()
        : items.filter(function (it) { return it.top; }).map(function (it) { return it.path; });
    }
    function placeOf(b, it, items) {
      if (topsOf(b, items).indexOf(it.path) >= 0) return 'top';
      var c = b.categories || [];
      if (c.length) return c.indexOf(it.path) >= 0 ? 'list' : 'off';
      return it.auto ? 'list' : 'off';
    }
    // one page to a place -> {menu_top, categories}; null when that cannot be
    // said (no page left under Categories, where empty means automatic)
    function placeSet(b, items, path, place) {
      var order = items.map(function (it) { return it.path; });
      var tops = topsOf(b, items).filter(function (p) { return p !== path && order.indexOf(p) >= 0; });
      var listed = items.filter(function (it) {
        return it.path !== path && tops.indexOf(it.path) < 0 && placeOf(b, it, items) === 'list';
      }).map(function (it) { return it.path; });
      if (place === 'top') tops.push(path);
      if (place === 'list') listed.push(path);
      tops = order.filter(function (p) { return tops.indexOf(p) >= 0; });
      listed = order.filter(function (p) { return listed.indexOf(p) >= 0; });
      var same = function (x, y) { return x.length === y.length && x.every(function (p) { return y.indexOf(p) >= 0; }); };
      var defTops = items.filter(function (it) { return it.top; }).map(function (it) { return it.path; });
      var auto = items.filter(function (it) { return it.auto && tops.indexOf(it.path) < 0; }).map(function (it) { return it.path; });
      // nothing at the top at all is NO_TOP: an empty list means "the views' own"
      var out = { menu_top: same(tops, defTops) ? [] : tops.length ? tops : [NO_TOP] };
      if (same(listed, auto)) out.categories = [];
      else if (!listed.length) return null;
      else out.categories = listed;
      return out;
    }

    // ROOMS: `room_order` (areas, in order) and `home_rooms`: Shown = the
    // rooms on Home. All shown in order = "order"; some = "only".
    function roomsModel(b, areasAZ) {
      var ro = (b.room_order || []).filter(function (a) { return areasAZ.indexOf(a) >= 0; });
      var auto = !ro.length;
      var only = b.home_rooms === 'only' && !auto;
      var rows = auto ? areasAZ.slice() : only ? ro : ro.concat(areasAZ.filter(function (a) { return ro.indexOf(a) < 0; }));
      var more = auto || !only ? [] : areasAZ.filter(function (a) { return ro.indexOf(a) < 0; });
      return { auto: auto, rows: rows.map(function (a) { return { value: a }; }),
               more: more.map(function (a) { return { value: a }; }) };
    }
    function roomsSave(values, areasAZ) {
      return { room_order: values, home_rooms: values.length < areasAZ.length ? 'only' : 'order' };
    }
    // back to automatic: no order, Home as the screen lists its rooms
    function roomsAuto() { return { room_order: [], home_rooms: 'as_is' }; }
    // ALL SCREENS' ROOMS (settings `rooms`) as a screen's keys, and back: the
    // same list editor and model serve both
    function houseRoomsAsBoard(r) {
      r = r || {};
      return { room_order: r.order || [], home_rooms: r.home || 'as_is', menu_rooms: r.menu || 'az', page_rooms: r.pages || 'floor' };
    }
    function houseRoomsSave(ch) {
      var out = {};
      if ('room_order' in ch) out['rooms.order'] = ch.room_order;
      if ('home_rooms' in ch) out['rooms.home'] = ch.home_rooms;
      if ('menu_rooms' in ch) out['rooms.menu'] = ch.menu_rooms;
      if ('page_rooms' in ch) out['rooms.pages'] = ch.page_rooms;
      return out;
    }
    // ONE ROOM ON HOME, or not (a room's own Show on Home): the order as it
    // stands, with the room taken out or added at its end
    function roomOnHome(b, areasAZ, area, on) {
      var rows = roomsModel(b, areasAZ).rows.map(function (r) { return r.value; });
      var has = rows.indexOf(area) >= 0;
      if (on === has) return null;
      return roomsSave(on ? rows.concat(area) : rows.filter(function (a) { return a !== area; }), areasAZ);
    }
    function roomsSummary(b) {
      return !(b.room_order || []).length ? 'Automatic' : b.home_rooms === 'only' ? b.room_order.length + ' on Home' : 'Custom Order';
    }

    // CAMERAS: automatic = one of every camera (its low channel)
    function camerasModel(b, ok, autoCams) {
      var cams = (b.cameras || []).filter(function (id) { return ok.indexOf(id) >= 0; });
      var auto = !cams.length;
      var rows = auto ? autoCams.slice() : cams;
      return { auto: auto, rows: rows.map(function (id) { return { value: id }; }),
               more: auto ? [] : ok.filter(function (id) { return rows.indexOf(id) < 0; }).map(function (id) { return { value: id }; }) };
    }
    // one camera per device, its low-resolution channel when it has several
    function autoCameras(ids, deviceOf) {
      var byDev = {}, out = [];
      ids.slice().sort().forEach(function (id) {
        var d = deviceOf(id) || id;
        if (!(d in byDev)) { byDev[d] = id; out.push(id); }
        else if (/low/.test(id) && !/low/.test(byDev[d])) { out[out.indexOf(byDev[d])] = id; byDev[d] = id; }
      });
      return out;
    }

    // LIVE CAMERA FOLLOWS (a screen's Cameras): a dropdown helper whose option
    // names the camera the strip plays live. An option names a camera when it
    // is the camera's name or the start of it (hk-cameras.js _optionOf: "Deck"
    // is "Deck Low resolution channel"). For each camera: the option to give
    // it -- its device's name, which its entities' names start with, else its
    // own name -- and the sensor on the same device to follow, a person sensor
    // before a motion one. With a dropdown already chosen (`have`: its
    // options), a camera keeps the option the dropdown has for it (the longest
    // that names it, as the strip picks); one it has none for is `missing`.
    //   cams     [{entity, name, device, deviceName}]
    //   sensors  [{entity, device, kind: 'person' | 'motion'}]
    function liveNames(option, names) {
      var t = String(option || '').toLowerCase();
      return !!t && names.some(function (n) {
        n = String(n || '').toLowerCase();
        return n === t || n.indexOf(t + ' ') === 0;
      });
    }
    function livePlan(cams, sensors, have) {
      var taken = {};
      return (cams || []).map(function (c) {
        var name = String(c.name || c.entity);
        var option = String(c.deviceName || '').trim();
        if (!option || !liveNames(option, [name]) || taken[option.toLowerCase()]) option = name;
        var missing = false;
        if (have) {
          var best = null;
          have.forEach(function (o) {
            if (liveNames(o, [name]) && (!best || String(o).length > best.length)) best = String(o);
          });
          if (best) option = best; else missing = true;
        }
        taken[option.toLowerCase()] = true;
        var mine = (sensors || []).filter(function (s) { return c.device && s.device === c.device; });
        var pick = mine.filter(function (s) { return s.kind === 'person'; })[0] ||
                   mine.filter(function (s) { return s.kind === 'motion'; })[0] || null;
        return { entity: c.entity, name: name, option: option, sensor: pick ? pick.entity : null, missing: missing };
      });
    }
    // The automation, as YAML to paste into the automation editor: each
    // camera's sensor turning on picks that camera; five quiet minutes on all
    // of them go back to the first camera. Only cameras the dropdown has an
    // option for (a missing one would fail). Null when no camera has a sensor.
    // Every string is written as JSON, which YAML reads as a quoted string.
    function liveYaml(plan, selector) {
      var q = JSON.stringify;
      var usable = (plan || []).filter(function (p) { return !p.missing; });
      var withSensor = usable.filter(function (p) { return p.sensor; });
      if (!withSensor.length) return null;
      var domain = String(selector || '').split('.')[0] === 'select' ? 'select' : 'input_select';
      var all = withSensor.map(function (p) { return p.sensor; });
      var list = function (pad) { return all.map(function (s) { return pad + '- ' + s; }).join('\n'); };
      var pickLines = function (pad, option) {
        return [pad + '- action: ' + domain + '.select_option', pad + '  target:', pad + '    entity_id: ' + selector,
                pad + '  data:', pad + '    option: ' + option].join('\n');
      };
      var out = ['alias: Live camera follows motion',
        'description: ' + q('Plays the camera where a person or motion was just seen live on the camera strip, ' +
                            'and the first camera again after five quiet minutes.'),
        'mode: queued', 'triggers:'];
      withSensor.forEach(function (p) {
        out.push('  - trigger: state', '    entity_id: ' + p.sensor, '    to: "on"', '    id: ' + q(p.option));
      });
      out.push('  - trigger: state', '    entity_id:', list('      '), '    to: "off"', '    for:', '      minutes: 5',
               '    id: all quiet', 'actions:', '  - if:', '      - condition: trigger', '        id: all quiet', '    then:',
               '      - condition: state', '        entity_id:', list('          '), '        state: "off"',
               pickLines('      ', q(usable[0].option)), '    else:', pickLines('      ', q('{{ trigger.id }}')));
      return out.join('\n') + '\n';
    }

    // A LIST'S REORDER: the Shown values after moving `from` to `to`
    function move(values, from, to) {
      var v = values.slice();
      if (from < 0 || from >= v.length) return v;
      to = Math.max(0, Math.min(v.length - 1, to));
      var m = v.splice(from, 1)[0];
      v.splice(to, 0, m);
      return v;
    }

    // ------------------------------------------------------------ the sky
    function mmdd(v) {
      var m = /^(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? { month: Number(m[1]), day: Number(m[2]) } : null;
    }
    function dateLabel(v) {
      if (v === 'thanksgiving') return 'Thanksgiving Day';
      var d = mmdd(v);
      return d ? MONTHS[d.month - 1].slice(0, 3) + ' ' + d.day : String(v || '');
    }
    // a theme's date: what is saved, else built in (for the hemisphere)
    function skyDate(sky, builtIn, prefix, end) {
      var own = sky[prefix + '_' + end];
      var hemi = sky.hemisphere === 'south' ? 'south' : 'north';
      var b = builtIn[prefix] ? builtIn[prefix][hemi][end === 'from' ? 0 : 1] : null;
      return { own: !!own, value: own || b, builtIn: b };
    }

    // ------------------------------------------------------------ your own dashboards
    // WHAT A DASHBOARD YOU WRITE YOURSELF CAN USE (Advanced -> Your Own
    // Dashboards, and the wiki's Your-Own-Dashboard page, which a test holds to
    // exactly these snippets). {weather}, {user}, {photos}: filled in from the
    // house on the settings page, the defaults below in the wiki.
    var YAML_DEFAULTS = { weather: 'weather.home', user: 'Kitchen Tablet', photos: 'media-source://media_source/local/photos' };
    var YAML_REF = [
      { header: 'The Dashboard', footer: 'At the top of the dashboard’s raw configuration (Edit Dashboard → ⋮ → Raw Configuration Editor), beside views:.',
        items: [
          { id: 'kiosk', title: 'Hide Header & Sidebar', key: 'hk_kiosk', anchor: 'hide-home-assistants-header-and-sidebar',
            sub: 'Or turn on Hide Home Assistant Header & Sidebar in the screen’s HK settings, with nothing written. A kiosk_mode block (the Kiosk Mode plugin’s) wins over both.',
            yaml: 'hk_kiosk:\n  header: true        # Home Assistant’s header\n  sidebar: true       # ...and its sidebar\n  admins: true        # false: an admin still sees them' },
          { id: 'screensaver', title: 'Photo Screensaver', key: 'hk_screensaver', anchor: 'photo-screensaver',
            sub: 'Or turn on Screensaver in the screen’s HK settings, with nothing written, and get its switch and In Use sensor too.',
            yaml: 'hk_screensaver:\n  user: {user}   # the tablet’s Home Assistant user\n' +
                  '  tablet: kitchen        # optional, instead of user: the wall tablet’s id\n' +
                  '  entity: input_boolean.kitchen_photos   # optional: yours, kept in step\n' +
                  '  photos: {photos}\n  starts_after: 180\n  each_photo: 30\n  order: random        # or sorted\n' +
                  '  zoom: false          # Slow Zoom\n' +
                  '  photo_layout: single # or mosaic (mosaic_count: 2 to 5)\n' +
                  '  fill: true           # landscape photos fill the screen\n' +
                  '  portrait_fill: false # portrait photos whole, over a blurred copy\n' +
                  '  portrait_y: top      # the part kept when cropped: top, center, bottom (and portrait_x)\n' +
                  '  show: photos         # photos, both (the forecast slide on), forecast or clock\n' +
                  '  clock_over: corner   # over the photos: corner or large (clock: false for none)\n' +
                  '  clock_style: classic # for show: clock and a large clock\n' +
                  '  clock_bg: gradient   # behind show: clock\n' +
                  '  clock_night: "off"   # "night" (clock_night_from to clock_night_to) or "always"\n' +
                  '  forecast_every: 5    # a slide (the forecast, the music) after this many photos\n' +
                  '  music_slide: false   # what plays, full screen: a slide among the photos\n' +
                  '  music_first: false   # ...or the music fills the screen while it plays\n' +
                  '  fallback: true       # no photos: the forecast (false: a dark screen)\n' +
                  '  band: true           # the forecast’s details on the forecast\n' +
                  '  band_photos: false   # ...and over the photos\n' +
                  '  calendar: false      # the calendar pane, down the right\n' +
                  '  calendar_days: 2     # ...today and tomorrow (1 to 7 days)\n' +
                  '  music_pane: false    # what plays, in the pane (under the calendar)\n' +
                  '  fade_back: 500       # ms back to the dashboard (0: at once)\n' +
                  '  cards:\n    - type: custom:hk-clock-card\n    - type: custom:hk-weather-strip-card\n      variant: inline\n' +
                  '    - type: custom:hk-screensaver-now-card\n      music: true\n    - type: custom:hk-timer-strip-card\n' +
                  '      entity: sensor.running_quick_timers\n      fixed: true\n    - type: custom:hk-screensaver-status-card' },
          { id: 'sky', title: 'Live Sky', key: 'sky', anchor: 'live-sky',
            sub: 'The dashboard opts in with sky:, and each view that wants it says sky: true.',
            yaml: 'sky:\n  enable: input_boolean.live_sky   # optional: off hides the sky\nviews:\n  - title: Home\n    path: home\n' +
                  '    type: custom:hk-grid-view\n    sky: true\n    cards: []' }] },
      { header: 'Views', footer: 'Each view in views:. The menu lists them: the first view is Home.',
        items: [
          { id: 'view', title: 'A Page in the Menu', key: 'hk-grid-view', anchor: 'a-page-in-the-menu',
            sub: haName('HK Frontend’s grid view') + ', placed in the menu. A view with area: is a room.',
            yaml: '- title: Kitchen\n  path: kitchen\n  type: custom:hk-grid-view\n  area: kitchen       # a room, in the menu’s Rooms\n' +
                  '  menu: top           # right under Home (false: not listed)\n  cards: []' },
          { id: 'room', title: 'A Room Page, Built for You', key: 'hk-room', anchor: 'a-room-page-built-for-you',
            sub: 'Built from the area every time it opens.',
            yaml: '- title: Kitchen\n  path: room-kitchen\n  subview: true\n  strategy:\n    type: custom:hk-room\n    area: kitchen' }] },
      { header: 'Cards', footer: 'Anywhere in a view’s cards:. Every HK card is in the card picker too, with a visual editor.',
        items: [
          { id: 'header', title: 'Clock, Weather & Chips', key: 'hk-header-card', anchor: 'clock-weather-and-chips',
            sub: 'The header, and the status chips under it. The chips and scenes follow the screen’s HK settings.',
            yaml: '- type: custom:hk-header-card\n- type: custom:hk-chips-card\n- type: custom:hk-scenes-card' },
          { id: 'cameras', title: 'Cameras', key: 'hk-camera-mosaic-card', anchor: 'cameras',
            sub: 'The camera strip: one camera live, the others as stills. Its cameras follow the screen’s HK settings.',
            yaml: '- type: custom:hk-camera-mosaic-card' },
          { id: 'weather', title: 'Forecast', key: 'hk-weather-band-card', anchor: 'forecast',
            sub: 'Now, the next hours and the coming days.',
            yaml: '- type: custom:hk-weather-band-card\n  entity: {weather}' },
          { id: 'live_tv', title: 'Live TV', key: 'hk-tv-guide-card', anchor: 'live-tv',
            sub: 'Every channel with what is on; a tap plays one full screen. Needs the Live TV feature.',
            yaml: '- type: custom:hk-tv-guide-card\n  title: Live TV' },
          { id: 'clean_areas', title: 'Clean Areas', key: 'hk-area-select-card', anchor: 'clean-areas',
            sub: 'Pick rooms floor by floor, then clean just those. Needs the Clean Areas feature.',
            yaml: '- type: custom:hk-area-select-card' },
          { id: 'music', title: 'Music', key: 'hk-music-card', anchor: 'music',
            sub: 'The whole Music page as one card: what plays and where, with Browse Music beside it. Or just what is playing. Needs the Music feature.',
            yaml: '- type: custom:hk-music-card   # the whole Music page\n# ...or just what is playing:\n' +
                  '# - type: custom:hk-now-playing-card\n#   music: true' },
          { id: 'media_bar', title: 'The Now Playing Bar', key: 'hk-popup-card', anchor: 'the-now-playing-bar',
            sub: 'The player docked along the bottom while music plays, as on the screens ' + PN() + ' builds. It shows on the views it is placed in: put it in each one. Needs the Music feature.',
            yaml: '- type: custom:hk-popup-card\n  hash: \'#media\'\n  position: bottom\n  modal: false\n  dock: true\n' +
                  '  padding: \'0\'\n  radius: \'0\'\n  width: 100%\n  max_width: 100%\n  background: transparent\n' +
                  '  vars:\n    hk-np-height: calc(104px + env(safe-area-inset-bottom, 0px))\n' +
                  '    hk-np-pad: 12px 24px calc(12px + env(safe-area-inset-bottom, 0px))\n' +
                  '    hk-np-radius: \'0\'\n    hk-np-plate: rgb(22,23,26)\n' +
                  '    hk-np-areas: \'"art title . spk prev play next stop brw . meta" "art artist . spk prev play next stop brw . meta" "art sub . spk prev play next stop brw . meta"\'\n' +
                  '    hk-np-cols: 72px minmax(220px, max-content) 1fr 56px 64px 64px 64px 64px 56px 1fr minmax(0, 380px)\n' +
                  '    hk-np-rows: auto auto auto\n    hk-np-gap: 14px\n' +
                  '  trigger:             # open while the music plays...\n    - condition: state\n      entity_from:\n        music: true\n' +
                  '      state: playing\n      grace: 20\n  trigger_close: true # ...and close when it stops\n' +
                  '  dismissable: true   # swiped down, it stays away until the music stops\n' +
                  '  dismiss_scope:\n    - music: true\n  stash:              # ...with a button in the corner to bring it back\n' +
                  '    icon: hk:homepod\n    label: Show Now Playing\n' +
                  '  cards:\n    - type: custom:hk-now-playing-card\n      bar: true\n      music: true\n      hide_idle: true\n' +
                  '      meta_card:\n        type: custom:hk-media-control-card\n        color: purple\n        bare: true\n        parts: [volume]\n' +
                  '        entity_from:\n          music: true\n' +
                  '      sub_card:\n        type: custom:hk-media-control-card\n        color: purple\n        bare: true\n        parts: [progress]\n' +
                  '        phone_times: false\n        entity_from:\n          music: true' },
          { id: 'timers', title: 'Timers', key: 'hk-timers-page-card', anchor: 'timers',
            sub: 'Quick start, the running timers and the New Timer keypad, as one card.',
            yaml: '- type: custom:hk-timers-page-card' }] },
      { header: 'Automations', footer: 'Actions of ' + haName('HK Frontend’s') + ', for your automations and scripts.',
        items: [
          { id: 'clean_action', title: 'Clean Some Rooms', key: 'hk_frontend.clean_areas', anchor: 'clean-some-rooms',
            sub: 'Each vacuum cleans the rooms on its own map.',
            yaml: 'action: hk_frontend.clean_areas\ndata:\n  areas:\n    - kitchen\n    - dining_room' },
          { id: 'saver_action', title: 'Start or Stop the Photos', key: 'switch.turn_on', anchor: 'start-or-stop-the-photos',
            sub: 'A screen’s Photo Screensaver switch (HK settings’ screensaver only): on starts the photos, off closes them.',
            yaml: 'action: switch.turn_on\ntarget:\n  entity_id: switch.kitchen_photo_screensaver' }] },
      { header: 'The Address', footer: 'After a screen’s address, for one visit.',
        items: [
          { id: 'address', title: 'For One Visit', key: '?hk_kiosk=off', anchor: 'for-one-visit',
            sub: 'Home Assistant’s header and sidebar back, or no screensaver, while you work on a tablet. A reload is the screen as set again.',
            yaml: '/dashboard-kitchen/0?hk_kiosk=off   # the header and sidebar, until a reload\n' +
                  '/dashboard-kitchen/0?hk_saver=off   # no screensaver on this page' }] }
    ];
    // one snippet, filled in (`ctx` over YAML_DEFAULTS)
    function yamlRefText(item, ctx) {
      var c = Object.assign({}, YAML_DEFAULTS, ctx || {});
      return String(item.yaml).replace(/\{(weather|user|photos)\}/g, function (m, k) { return c[k] || YAML_DEFAULTS[k]; });
    }
    function yamlRefItem(id) {
      var out = null;
      YAML_REF.forEach(function (g) { g.items.forEach(function (it) { if (it.id === id) out = it; }); });
      return out;
    }

    // ------------------------------------------------------------ the Pages screen
    // THE PAGES SCREEN (docs/phase11/HOMEVIEW-LOOK.md, Phase J; settings.py
    // PAGES_SCREEN_*): All Screens' every field; a screen's only the fields it
    // sets (b.pages_screen, null: Same as All Screens), each resolved on its own
    var PAGES_SCREEN_DEFAULTS = { show: 'off', icons: 'menu', rooms: 'folder', widgets: [], pill: 'auto', clock: 'off' };
    var PAGES_SCREEN_SHOW = [['off', 'Off'], ['on', 'On']];
    var PAGES_SCREEN_ROOMS = [['folder', 'A Rooms Folder'], ['each', 'Each Room Its Own Icon'], ['none', 'None']];
    var PAGES_SCREEN_PILL = [['auto', 'When There\u2019s No Tab Bar'], ['on', 'Always'], ['off', 'Never']];
    // the time, large and faint, behind the icons (settings.py PAGES_SCREEN_CLOCK; Off unless chosen)
    var PAGES_SCREEN_CLOCK = [['off', 'Off'], ['on', 'On']];
    // the Side Pane's sections (Phase A2's PANE_SECTIONS, its order), as widgets
    var PAGES_SCREEN_WIDGETS = [['clock', 'Clock'], ['weather', 'Weather'], ['calendar', 'Calendar'], ['now_playing', 'Now Playing'],
      ['security', 'Security'], ['camera', 'Camera'], ['timers', 'Timers'], ['energy', 'Energy'], ['climate', 'Climate'],
      ['people', 'Who\u2019s Home'], ['todo', 'To-do'], ['notifications', 'Notifications']];
    // a widget's size and side, as one choice: More is 2 x 2, Less 2 x 1
    var PAGES_SCREEN_SPOTS = [['more:right', 'Large, Right'], ['more:left', 'Large, Left'], ['less:right', 'Small, Right'], ['less:left', 'Small, Left']];
    var PAGES_SCREEN_WIDGETS_MAX = 4;
    // the house's (`house`, the settings' pages_screen) and a screen's own
    // (`own`, its b.pages_screen) as it shows: { value, own: {field: true} }
    function pagesScreenOf(house, own) {
      var h = house || {}, o = own || {}, value = {}, mine = {};
      Object.keys(PAGES_SCREEN_DEFAULTS).forEach(function (k) {
        var d = PAGES_SCREEN_DEFAULTS[k];
        if (o[k] !== undefined && o[k] !== null) { value[k] = o[k]; mine[k] = true; }
        else value[k] = h[k] !== undefined && h[k] !== null ? h[k] : (Array.isArray(d) ? d.slice() : d);
      });
      return { value: value, own: mine };
    }
    // a screen's own after one field changed: `v` undefined drops the field
    // (Same as All Screens); none left is null
    function pagesScreenSet(own, field, v) {
      var out = Object.assign({}, own || {});
      if (v === undefined) delete out[field]; else out[field] = v;
      return Object.keys(out).length ? out : null;
    }
    // the row's value on a screen's page and All Screens'
    function pagesScreenSummary(value) {
      if (!value || value.show !== 'on') return 'Off';
      var w = (value.widgets || []).length;
      return 'On' + (Array.isArray(value.icons) ? ' \u00b7 ' + value.icons.length + ' Pages' : '') + (w ? ' \u00b7 ' + w + (w === 1 ? ' Widget' : ' Widgets') : '');
    }
    // the widgets with one changed: `spot` 'more:right'..., or 'remove'
    function pagesWidgetSet(list, kind, spot) {
      var out = (list || []).map(function (w) { return Object.assign({}, w); });
      var i = -1;
      out.forEach(function (w, j) { if (w.kind === kind) i = j; });
      if (spot === 'remove') { if (i >= 0) out.splice(i, 1); return out; }
      var p = String(spot || 'more:right').split(':'), w = { kind: kind, size: p[0] === 'less' ? 'less' : 'more', place: p[1] === 'left' ? 'left' : 'right' };
      if (i >= 0) out[i] = w; else if (out.length < PAGES_SCREEN_WIDGETS_MAX) out.push(w);
      return out;
    }

    // what the shell and the later parts use of this one
    K.autoCameras = autoCameras; K.camerasModel = camerasModel; K.CHIP_TOKEN = CHIP_TOKEN; K.chipQuiet = chipQuiet;
    K.chipsAddCustom = chipsAddCustom; K.chipsAddOwn = chipsAddOwn; K.chipsModel = chipsModel;
    K.chipsRemoveCustom = chipsRemoveCustom; K.chipsRemoveOwn = chipsRemoveOwn; K.chipsSave = chipsSave;
    K.dateLabel = dateLabel; K.houseRoomsAsBoard = houseRoomsAsBoard; K.houseRoomsSave = houseRoomsSave;
    K.liveNames = liveNames; K.livePlan = livePlan; K.liveYaml = liveYaml; K.MENU_FIXED = MENU_FIXED;
    K.MENU_PLACES = MENU_PLACES; K.menuItems = menuItems; K.menuPathOf = menuPathOf; K.mmdd = mmdd; K.move = move;
    K.onlyModel = onlyModel; K.onlySummary = onlySummary; K.PAGE_TOKEN = PAGE_TOKEN;
    K.PAGES_SCREEN_CLOCK = PAGES_SCREEN_CLOCK; K.PAGES_SCREEN_DEFAULTS = PAGES_SCREEN_DEFAULTS;
    K.PAGES_SCREEN_PILL = PAGES_SCREEN_PILL; K.PAGES_SCREEN_ROOMS = PAGES_SCREEN_ROOMS;
    K.PAGES_SCREEN_SHOW = PAGES_SCREEN_SHOW; K.PAGES_SCREEN_SPOTS = PAGES_SCREEN_SPOTS;
    K.PAGES_SCREEN_WIDGETS = PAGES_SCREEN_WIDGETS; K.PAGES_SCREEN_WIDGETS_MAX = PAGES_SCREEN_WIDGETS_MAX;
    K.pagesCustom = pagesCustom; K.pagesModel = pagesModel; K.pagesSave = pagesSave; K.pagesScreenOf = pagesScreenOf;
    K.pagesScreenSet = pagesScreenSet; K.pagesScreenSummary = pagesScreenSummary; K.pagesWidgetSet = pagesWidgetSet;
    K.placeOf = placeOf; K.placeSet = placeSet; K.roomOnHome = roomOnHome; K.roomsAuto = roomsAuto;
    K.roomsModel = roomsModel; K.roomsSave = roomsSave; K.roomsSummary = roomsSummary; K.scenesModel = scenesModel;
    K.scenesPagePill = scenesPagePill; K.scenesSave = scenesSave; K.skyAutoLabel = skyAutoLabel; K.skyDate = skyDate;
    K.skyModeLabel = skyModeLabel; K.skyModeOptions = skyModeOptions; K.skyPageRows = skyPageRows; K.topsOf = topsOf;
    K.YAML_DEFAULTS = YAML_DEFAULTS; K.YAML_REF = YAML_REF; K.yamlRefItem = yamlRefItem; K.yamlRefText = yamlRefText;
  };
})();
