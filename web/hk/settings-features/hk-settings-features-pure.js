// hk-settings-features-pure.js - what the pages decide, pure.
//
// PART OF THE FEATURE PAGES OF HK SETTINGS (hk-settings-features.js). Not a card and not run on its own: it registers one
// function, which hk-settings-features.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsFeaturesParts = window.hkSettingsFeaturesParts || {})['hk-settings-features-pure'] = function (KIT) {
    // [route, id (the feature's websocket prefix and its key in panel/get
    // `features`), label, icon, tile color]. Music is always listed: its
    // Browse Music settings are the dashboards' own.
    var LIST = [
      ['music', 'hk_music', 'Music', 'mdi:music', '#ff2d55'],
      ['tv', 'hk_tv', 'Live TV', 'mdi:television-classic', '#007aff'],
      ['alarm', 'hk_alarm_pin', 'Alarm PIN', 'mdi:shield-key', '#ff3b30'],
      ['clean', 'hk_clean_areas', 'Clean Areas', 'mdi:robot-vacuum', '#30b0c7'],
      ['energy', 'hk_energy', 'Energy', 'mdi:lightning-bolt', '#34c759'],
      ['notify', 'hk_notify', 'Notifications', 'mdi:bell-badge', '#ff3b30']
    ];
    function byRoute(r) { return LIST.filter(function (x) { return x[0] === r; })[0] || null; }

    // ------------------------------------------------------------------ pure
    // The Features rows the sidebar lists: Music always, the others when the
    // server reports them (every feature is part of HK Frontend, so always).
    function listed(features) {
      features = features || {};
      return LIST.filter(function (x) {
        return x[0] === 'music' || !!(features[x[1]] && features[x[1]].installed);
      });
    }
    // a feature's state on this house: 'missing' (not reported) | 'not_added' |
    // 'added'
    function stateOf(features, domain) {
      var f = (features || {})[domain];
      if (!f || !f.installed) return 'missing';
      return f.entries && f.entries.length ? 'added' : 'not_added';
    }
    // Every feature is an item of HK Frontend's one entry, added with Add
    // feature on the integration's page (which offers the features the house
    // has not added); the same page lists each one, with its gear
    var INTEGRATION = '/config/integrations/integration/hk_frontend';
    function addHref() { return INTEGRATION; }
    function integrationHref() { return INTEGRATION; }

    // LIVE TV: the channels as the list editor shows them. Shown: the saved
    // channels (their own names; the number, and the station when the name is
    // not the station's). More: the rest of the tuner's lineup, by network
    // when the guide names one.
    function tvLists(d) {
      var saved = (d && d.channels) || [], lineup = (d && d.lineup) || [];
      var st = {};
      lineup.forEach(function (c) { st[c.number] = c; });
      var have = {};
      saved.forEach(function (c) { have[c.number] = true; });
      var rows = saved.map(function (c) {
        var l = st[c.number];
        var sub = c.number + (l && l.station && l.station !== c.name ? ' · ' + l.station : '') + (l ? '' : ' · Not in the lineup');
        return { value: c.number, label: c.name, sub: sub };
      });
      var more = lineup.filter(function (c) { return !have[c.number]; }).map(function (c) {
        return { value: c.number, label: c.network || c.station, sub: c.number + (c.network ? ' · ' + c.station : '') };
      });
      return { rows: rows, more: more };
    }
    // CLEAN BY AREA: a vacuum's line (what it does with a chosen room)
    function vacuumSub(v, areaName) {
      if (v.how === 'map') return v.areas.length === 1 ? 'Cleans 1 room on its map' : 'Cleans ' + v.areas.length + ' rooms on its map';
      if (v.how === 'start') return 'Starts when ' + areaName(v.areas[0]) + ' is chosen';
      if (v.how === 'no_map') return 'Can clean by area, but has no room map yet';
      return 'Can’t clean by area and has no room of its own';
    }
    // which vacuums take part after one is ticked or unticked: [] is every
    // vacuum (new ones join by themselves); null when none would be left
    function vacuumsAfter(d, id, on) {
      var all = (d.vacuums || []).map(function (v) { return v.vacuum; });
      var now = (d.chosen_vacuums || []).length ? d.chosen_vacuums.filter(function (x) { return all.indexOf(x) >= 0; }) : all.slice();
      var next = on ? all.filter(function (x) { return now.indexOf(x) >= 0 || x === id; })
                    : now.filter(function (x) { return x !== id; });
      if (!next.length) return null;
      return next.length === all.length ? [] : next;
    }
    // the Rooms list: Shown -- the rooms the picker offers; More -- the rest a
    // vacuum reaches (only while chosen by hand)
    function roomLists(d) {
      var by = {};
      (d.areas || []).forEach(function (a) { by[a.id] = a; });
      var row = function (id) {
        var a = by[id] || { id: id, name: id, by: [] };
        return { value: id, label: a.name, sub: [a.floor, (a.by || []).join(', ')].filter(Boolean).join(' · ') || null };
      };
      var auto = !(d.chosen_areas || []).length;
      // floor by floor (lowest first, no floor last), A to Z: as the screens group them
      var lv = function (a) { return a && typeof a.level === 'number' ? a.level : (a && a.floor ? 1e8 : 1e9); };
      var cmp = function (x, y) {
        var a = by[x], b = by[y];
        return lv(a) - lv(b) || String(a.floor || '').localeCompare(String(b.floor || '')) || String(a.name).localeCompare(String(b.name));
      };
      var shown = (d.offered || []).filter(function (id) { return by[id]; }).sort(cmp);
      return { auto: auto, rows: shown.map(row),
               more: auto ? [] : (d.areas || []).filter(function (a) { return shown.indexOf(a.id) < 0; })
                 .map(function (a) { return a.id; }).sort(cmp).map(row) };
    }
    function roomCount(d) {
      var n = (d.offered || []).length;
      if (!(d.chosen_areas || []).length) return 'Automatic · ' + n;
      return n + ' of ' + (d.areas || []).length;
    }
    // MUSIC: the Speakers list. Shown: the speakers in their order (each named
    // by its area, the player's own name under it when different, and a pair's
    // speakers); More: the other Music Assistant players.
    function speakerLists(d) {
      var have = (d.speakers || []).map(function (x) { return x.entity; });
      // a virtual pair's second player is its room's, never a speaker of its own
      var seconds = (d.virtual_pairs || []).map(function (p) { return p.players[1].entity; });
      return {
        rows: (d.speakers || []).map(function (x) {
          var pair = (d.pairs || {})[x.entity], vp = virtualPair(d, x.entity);
          return { value: x.entity, label: x.name,
                   sub: [x.floor, vp ? null : (x.player && x.player !== x.name ? x.player : null),
                         pair ? cap(pair.kind) + ': ' + pair.parts.join(' + ') : null,
                         vp ? 'Pair: ' + vp.players.map(function (p) { return p.name; }).join(' + ') : null]
                     .filter(Boolean).join(' · ') || null };
        }),
        more: (d.players || []).filter(function (p) {
          return have.indexOf(p.entity) < 0 && seconds.indexOf(p.entity) < 0;
        }).map(function (p) { return { value: p.entity, label: p.name, sub: p.entity }; })
      };
    }
    // VIRTUAL PAIRS (2026-10-31, docs/phase4/VIRTUAL-PAIRS.md): two Music
    // Assistant players made one room here. The owner: "If I create a group in
    // Music Assistant of 2 speakers in 1 room, I can't assign them with other
    // speakers ... So I need to be able to virtually pair 2 speakers to appear
    // as 1 ..."
    function virtualPair(d, room) {
      return (d.virtual_pairs || []).filter(function (p) { return p.room === room; })[0] || null;
    }
    // the players a pair can be made of: the speakers and the other players,
    // never a Music Assistant group, nor another pair's
    function pairChoices(d, room) {
      var groups = Object.keys(d.groups || {}).concat(Object.keys(d.pairs || {}));
      var taken = [];
      (d.virtual_pairs || []).forEach(function (p) {
        if (p.room !== room) p.players.forEach(function (x) { taken.push(x.entity); });
      });
      var mine = virtualPair(d, room), out = [];
      (mine ? mine.players : []).forEach(function (x) { out.push([x.entity, x.name]); });
      (d.speakers || []).concat(d.players || []).forEach(function (x) {
        if (groups.indexOf(x.entity) >= 0 || taken.indexOf(x.entity) >= 0) return;
        if (out.some(function (o) { return o[0] === x.entity; })) return;
        out.push([x.entity, x.player && x.player !== x.name ? x.name + ' (' + x.player + ')' : x.name]);
      });
      return out;
    }
    // the pairs after this one is saved ({players, name}) or removed (null)
    function pairsAfter(d, room, one) {
      var out = (d.virtual_pairs || []).filter(function (p) { return p.room !== room; })
        .map(function (p) { return { players: p.players.map(function (x) { return x.entity; }), name: p.name || '' }; });
      if (one) out.push(one);
      return out;
    }
    function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
    // A PAIR (hk_core/music/groups.py): a Music Assistant group picked as one
    // speaker, its own speakers hidden from the house. What that means, once.
    function pairNote(d) {
      var ids = Object.keys(d.pairs || {});
      if (!ids.length) return '';
      return ids.map(function (e) {
        var p = d.pairs[e];
        return speakerName(d, e) + ' is a ' + p.kind + ' in Music Assistant (' + p.parts.join(' + ') + '), so it’s one room here. ' +
               'It plays on its own. To play it with other rooms, pair its two speakers here instead.';
      }).join(' ');
    }
    function speakerName(d, id) {
      var x = (d.speakers || []).filter(function (s) { return s.entity === id; })[0];
      if (x) return x.name;
      var p = (d.players || []).filter(function (s) { return s.entity === id; })[0];
      return p ? p.name : id;
    }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function tvCount(d) {
      var n = ((d && d.channels) || []).length, of = d && d.lineup ? d.lineup.length : null;
      return of === null ? String(n) : n + ' of ' + of;
    }

    // SEARCH: each installed feature's settings, [label, route, words]
    var SEARCH = {
      hk_tv: [['Live TV', 'page/live_tv', 'television tv hdhomerun tuner'],
              ['Channels', 'features/tv/channels', 'live tv channel lineup rename'],
              ['Picture Quality', 'page/live_tv', 'live tv 720p 1080p resolution'],
              ['Tuner Address', 'page/live_tv', 'live tv hdhomerun ip host'],
              ['Guide Address', 'page/live_tv', 'live tv xmltv schedule epg']],
      hk_music: [['Speakers', 'features/music/speakers', 'music rooms hk music speaker order'],
                 ['Speaker Pairs', 'features/music/speakers', 'music pair two homepods stereo left right one room'],
                 ['Home Rooms', 'features/music/homes', 'music tablet user room home'],
                 ['Group Leaders', 'features/music/leaders', 'music leader sync group lead announcement room announce tts bedtime'],
                 ['House Volume', 'page/music', 'music playlist volume'],
                 ['Presets', 'features/music/presets', 'music sync group everywhere downstairs'],
                 ['Playlists', 'features/music/playlists', 'music pills playlist chooser decades'],
                 ['Keep Playlists Ready', 'page/music', 'music playlist slow loading cache warm apple refresh']],
      hk_alarm_pin: [['Alarm PIN', 'page/security', 'pin code keypad alarm security passcode'],
                     ['Change PIN', 'page/security', 'alarm pin code new passcode'],
                     ['PIN to Arm', 'page/security', 'alarm arm require code']],
      hk_clean_areas: [['Clean Areas', 'page/vacuums', 'vacuum robot clean by area rooms'],
                       ['Vacuums', 'page/vacuums', 'clean by area robots take part'],
                       ['Rooms', 'features/clean/rooms', 'clean by area picker which areas shown']],
      hk_energy: [['Energy', 'page/energy', 'energy power electricity kwh watts page cost'],
                  ['Energy Rings', 'features/energy/rings', 'energy rings summary cost water solar gas usual'],
                  ['Energy Sections', 'features/energy/sections', 'energy rooms appliances outlets circuits groups colors'],
                  ['Energy Devices', 'features/energy/devices', 'energy circuit plug power sensor name glyph'],
                  ['Energy Readings', 'features/energy/top', 'energy cost thermostat outside top row'],
                  ['Energy Tracking', 'features/energy/usages', 'energy tracking daily bars usage runtime chart history'],
                  ['Energy Batteries', 'features/energy/batteries', 'energy car battery range house battery charging'],
                  ['Opens On', 'page/energy', 'energy page first tab now today week month start default'],
                  ['A Usual Day', 'page/energy', 'energy typical usual average days before 30 14 7 rings compare'],
                  ['Highlights', 'page/energy', 'energy highlights stood out summary insights'],
                  ['Daily Runtime', 'features/energy/devices', 'energy runtime hours ac hvac run time duration device'],
                  ['Power Page', 'features/energy/power', 'power page right now house battery grid solar sun flow chart picture'],
                  ['Backed Up', 'features/energy/power', 'power backed up backup battery circuits panel whole house'],
                  ['House Battery', 'features/energy/power', 'power house battery level reserve charge limit eps storm mode'],
                  ['Battery Levels', 'features/energy/power', 'power battery levels sliders reserve charge limit'],
                  ['Car Charging Power', 'features/energy/power', 'power car name charging wall connector charger watts']],
      hk_notify: [['Notifications', 'features/notify', 'notifications banner alert motion doorbell arrived camera snapshot'],
                  ['Add Notification', 'features/notify/new', 'notifications new accessory banner'],
                  ['Notification Screens', 'features/notify/screens', 'notifications screens allow which'],
                  ['Do Not Disturb', 'features/notify/dnd', 'notifications quiet hours dnd schedule silence input boolean timer'],
                  ['Notifications on the Screensaver', 'features/notify', 'notifications screensaver photos important'],
                  ['Stays On Screen', 'features/notify', 'notifications seconds time banner dismiss'],
                  ['Notification Chime', 'features/notify', 'notifications sound chime'],
                  ['Wakes the Screen', 'features/notify', 'notifications wake sleep screen screensaver turn on display'],
                  ['Calendars', 'features/notify/c/calendars', 'notifications calendar events reminder before starts'],
                  ['All-Day Events', 'features/notify/c/calendars', 'notifications calendar all day events morning time'],
                  ['Page', 'features/notify', 'notifications tap opens a page go to dashboard view']]
    };
    function search(features) {
      var out = [];
      LIST.forEach(function (x) {
        if (stateOf(features, x[1]) === 'missing') return;
        (SEARCH[x[1]] || []).forEach(function (e) {
          out.push({ label: e[0], route: e[1], where: x[2], words: e[2] });
        });
      });
      return out;
    }

    // what the shell and the later parts use of this one
    KIT.addHref = addHref; KIT.byRoute = byRoute; KIT.cap = cap; KIT.integrationHref = integrationHref;
    KIT.LIST = LIST; KIT.listed = listed; KIT.pairChoices = pairChoices; KIT.pairNote = pairNote;
    KIT.pairsAfter = pairsAfter; KIT.plural = plural; KIT.roomCount = roomCount; KIT.roomLists = roomLists;
    KIT.search = search; KIT.speakerLists = speakerLists; KIT.speakerName = speakerName; KIT.stateOf = stateOf;
    KIT.tvCount = tvCount; KIT.tvLists = tvLists; KIT.vacuumsAfter = vacuumsAfter; KIT.vacuumSub = vacuumSub;
    KIT.virtualPair = virtualPair;
  };
})();
