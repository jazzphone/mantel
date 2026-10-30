// hk-settings-features.js -- THE FEATURES' OWN SETTINGS on the HK Settings
// page.
//
// Each page belongs to one of HK Frontend's optional features -- Music, Live
// TV, Alarm PIN, Clean Areas -- each an ITEM of the integration's one entry,
// added from Settings -> Devices & services -> HK Frontend -> Add feature
// (features/__init__.py). A page reads and saves through that feature's own
// commands (`<id>/settings/get` and `/set`, e.g. hk_tv/settings/get), which
// check each change the way the feature's gear does and store it where the
// gear stores it -- in the feature's item. panel/get `features` lists each
// feature with its items; not yet added, its page offers Add.
// Every choice comes from the house as it is -- the tuner's lineup, the
// vacuums, the alarm panels, Music Assistant's players -- never from a list
// written here.
//
// The page (hk-settings.js) owns drawing and saving; this file is the pages'
// content, and the pure parts are tested in tests/test_features.js.
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  // the product's name, and Home Assistant's own places, as the host says
  // them (web/client/hk-host-shell.js): HK Frontend in HA, the host's own elsewhere
  function PN() { return root.hkShell.productName(); }
  function haPlace(path) { return root.hkShell.haPlace(path); }
  if (root.hkSettingsFeatures) return;

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
  // speakers); More: the other Music Assistant players, but never a preset's
  // sync group.
  function speakerLists(d) {
    var groups = (d.presets || []).map(function (p) { return p.group; });
    var have = (d.speakers || []).map(function (x) { return x.entity; });
    return {
      rows: (d.speakers || []).map(function (x) {
        var pair = (d.pairs || {})[x.entity];
        return { value: x.entity, label: x.name,
                 sub: [x.floor, x.player && x.player !== x.name ? x.player : null,
                       pair ? cap(pair.kind) + ': ' + pair.parts.join(' + ') : null].filter(Boolean).join(' · ') || null };
      }),
      more: (d.players || []).filter(function (p) { return have.indexOf(p.entity) < 0 && groups.indexOf(p.entity) < 0; })
        .map(function (p) { return { value: p.entity, label: p.name, sub: p.entity }; })
    };
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
             'It plays on its own through its group, and with other rooms through a preset whose Music Assistant group holds all of it.';
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
               ['Home Rooms', 'features/music/homes', 'music tablet user room home'],
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

  // ----------------------------------------------------------------- pages
  var K = null;
  function use(kit) { K = kit; }

  // A page whose data is still on its way, or could not be read
  function waiting(c, st, name, domain) {
    if (st && st.error) {
      c.appendChild(K.group({ footer: name + ' didn’t answer: ' + st.error + '. It may be restarting; this page tries again when you come back.' }, [
        K.nav({ label: name, sub: 'In ' + haPlace('Devices & Services'), href: integrationHref(domain), icon: 'mdi:open-in-new' })]));
      return;
    }
    c.appendChild(K.group({}, [K.info({ label: 'Loading…' })]));
  }
  // not added yet: what it does and the way to add it
  function notAdded(c, name, what, domain) {
    c.appendChild(K.group({ footer: what }, [
      K.nav({ label: 'Add ' + name, sub: haPlace('Devices & Services → HK Frontend → Add feature'), href: addHref(domain),
              icon: 'mdi:plus-circle-outline', fk: 'feat:add:' + domain })]));
  }
  function openIn(c, name, domain, sub) {
    c.appendChild(K.group({}, [K.nav({ label: name, sub: sub || 'In ' + haPlace('Devices & Services'), href: integrationHref(domain),
                                       icon: 'mdi:open-in-new', fk: 'feat:open:' + domain })]));
  }

  // ---- LIVE TV
  function tvMain(P, c, d) {
    var set = function (ch) { return P.featSet('hk_tv', ch); };
    c.appendChild(K.group({ header: 'Channels', footer: d.lineup_error
        ? d.lineup_error + ' The channels below are what is saved; they can’t be changed until the tuner answers.'
        : 'The channels on every screen’s Live TV page, from the tuner’s own lineup.' }, [
      K.nav({ label: 'Channels', value: tvCount(d), href: '#/features/tv/channels', sk: 'f:hk_tv:channels',
              fk: 'tv:channels' })]));
    c.appendChild(K.group({ header: 'Picture', footer: '720p is plenty on a wall tablet or a phone. 1080p uses about 40% more of Home Assistant’s processor for each channel being watched.' }, [
      K.seg({ label: 'Quality', sk: 'f:hk_tv:quality', value: d.quality, options: [['720', '720p'], ['1080', '1080p']],
              onChange: function (v) { set({ quality: v }); } })]));
    c.appendChild(K.group({ header: 'Tuner & Guide', footer: 'The guide is an XMLTV file (from a service such as Schedules Direct, or a program that builds one). With a guide, each channel shows what’s on now and uses the network’s name.' }, [
      K.text({ label: 'Tuner Address', sk: 'f:hk_tv:host', value: d.host, placeholder: 'IP address or host name',
               error: P.err('f:hk_tv:host'), onCommit: function (v) { set({ host: v }); } }),
      K.text({ label: 'Guide Address', sk: 'f:hk_tv:guide_url', value: d.guide_url, placeholder: 'None',
               error: P.err('f:hk_tv:guide_url'), onCommit: function (v) { set({ guide_url: v }); } })]));
    openIn(c, 'Live TV', 'hk_tv');
  }
  function tvChannels(P, c, d) {
    var L = tvLists(d);
    if (!d.lineup) {
      c.appendChild(K.group({ footer: d.lineup_error || 'The tuner didn’t answer.' },
        L.rows.map(function (r) { return K.info({ label: r.label, sub: r.sub }); })));
      return;
    }
    var err = P.err('f:hk_tv:channels') || P.err('f:hk_tv:names');
    c.appendChild(K.listEditor({ fk: 'tv', reorder: false, minRows: 1, announce: P.announce.bind(P),
      shownHeader: 'Shown', moreHeader: 'More Channels',
      shownFooter: (err ? err + ' ' : '') + 'In the tuner’s order. Tap a channel to rename it.',
      rows: L.rows.map(function (r) { return Object.assign({ href: '#/features/tv/channels/' + encodeURIComponent(r.value) }, r); }),
      more: L.more,
      onChange: function (v) { P.featSet('hk_tv', { channels: v }, ['channels']); } }));
  }
  function tvChannel(P, c, d, num) {
    var ch = ((d && d.channels) || []).filter(function (x) { return x.number === num; })[0];
    if (!ch) { c.appendChild(K.group({ footer: 'That channel isn’t shown any more.' }, [])); return; }
    var l = ((d && d.lineup) || []).filter(function (x) { return x.number === num; })[0] || {};
    var names = {};
    c.appendChild(K.group({ footer: 'The name on the Live TV page and its guide.' }, [
      K.text({ label: 'Name', sk: 'f:hk_tv:names', value: ch.name, maxlength: 40, error: P.err('f:hk_tv:names'),
               onCommit: function (v) { names[num] = v; P.featSet('hk_tv', { names: names }, ['names']); } })]));
    var rows = [K.info({ label: 'Channel', value: num })];
    if (l.station) rows.push(K.info({ label: 'Station', value: l.station }));
    if (l.network) rows.push(K.info({ label: 'Network', value: l.network }));
    c.appendChild(K.group({ header: 'From the Tuner' }, rows));
    var usable = [l.network, l.station].filter(function (x) { return x && x !== ch.name; });
    if (usable.length) {
      c.appendChild(K.group({}, usable.map(function (n) {
        return K.button({ label: 'Use “' + n + '”', fk: 'tv:use:' + n, onClick: function () {
          var o = {}; o[num] = n; P.featSet('hk_tv', { names: o }, ['names']);
        } });
      })));
    }
  }

  // ---- CLEAN BY AREA
  function cleanMain(P, c, d) {
    var names = {};
    (d.areas || []).concat(d.unreached || []).forEach(function (a) { names[a.id] = a.name; });
    var areaName = function (id) { return names[id] || ((P.client.areas || {})[id] || {}).name || id; };
    var err = P.err('f:hk_clean_areas:vacuums');
    c.appendChild(K.group({ header: 'Vacuums', footer: (err ? err + ' ' : '') +
        'A vacuum that cleans by area gets the chosen rooms on its room map; one that can’t starts when its own room is chosen. ' +
        'Map a vacuum’s rooms in its entity settings in Home Assistant. While every vacuum is checked, a new one joins by itself.' },
      (d.vacuums || []).map(function (v) {
        return K.check({ label: v.name, sub: vacuumSub(v, areaName), multi: true, on: v.taking_part,
                         fk: 'clean:v:' + v.vacuum, onClick: function (on) {
          var next = vacuumsAfter(d, v.vacuum, on);
          if (next === null) { P.announce('At least one vacuum takes part.'); return; }
          P.featSet('hk_clean_areas', { vacuums: next });
        } });
      })));
    if (!(d.vacuums || []).length) c.appendChild(K.group({ footer: 'This house has no vacuums yet.' }, []));
    c.appendChild(K.group({ header: 'Rooms', footer: 'The rooms the Clean Areas picker shows on every screen.' }, [
      K.nav({ label: 'Rooms', value: roomCount(d), href: '#/features/clean/rooms', sk: 'f:hk_clean_areas:areas', fk: 'clean:rooms' })]));
    var st = P.feat('hk_clean_areas');
    var rows = [K.button({ label: 'Show What Would Be Cleaned', fk: 'clean:test', disabled: !(d.offered || []).length,
      onClick: function () {
        st.test = { busy: true }; P.render();
        P.actions().callWS({ type: 'call_service', domain: 'hk_frontend', service: 'clean_areas',
                         service_data: { areas: d.offered, dry_run: true }, return_response: true })
          .then(function (r) { st.test = { res: (r && r.response) || {} }; P.render(); },
                function (e) { st.test = { error: String((e && e.message) || e) }; P.render(); });
      } })];
    var t = st.test;
    if (t && t.busy) rows.push(K.info({ label: 'Asking…' }));
    if (t && t.error) rows.push(K.info({ label: t.error }));
    if (t && t.res) {
      var vn = {};
      (d.vacuums || []).forEach(function (v) { vn[v.vacuum] = v.name; });
      // the rooms under the name: a long list as the value squeezed the name
      (t.res.plan || []).forEach(function (step) {
        rows.push(K.info({ label: vn[step.vacuum] || step.vacuum,
                           sub: (step.action === 'start' ? 'Starts: ' : '') + step.areas.map(areaName).join(', ') }));
      });
      if ((t.res.unreachable || []).length) {
        rows.push(K.info({ label: 'No vacuum reaches', sub: t.res.unreachable.map(areaName).join(', ') }));
      }
      if (!(t.res.plan || []).length && t.res.message) rows.push(K.info({ label: t.res.message }));
    }
    c.appendChild(K.group({ header: 'Check', footer: 'Every room the picker shows, as a dry run: which vacuum would clean what. Nothing moves.' }, rows));
    openIn(c, 'Clean Areas', 'hk_clean_areas');
  }
  function cleanRooms(P, c, d) {
    var L = roomLists(d);
    var err = P.err('f:hk_clean_areas:areas');
    c.appendChild(K.listEditor({ fk: 'rooms', auto: L.auto, reorder: false, minRows: 1, announce: P.announce.bind(P),
      autoFooter: 'Automatic: every room a vacuum that takes part can reach. Off: only the rooms you choose.',
      shownFooter: (err ? err + ' ' : '') + 'By floor and name on the screens. Under each: the vacuums that reach it.',
      moreHeader: 'Other Rooms a Vacuum Reaches',
      emptyText: 'No room is reached by a vacuum yet. Map each vacuum’s rooms in its entity settings in Home Assistant.',
      rows: L.rows, more: L.more,
      onAuto: function (on) { P.featSet('hk_clean_areas', { areas: on ? [] : (d.offered || []).slice() }); },
      onChange: function (v) { P.featSet('hk_clean_areas', { areas: v }); } }));
    if ((d.unreached || []).length) {
      c.appendChild(K.group({ header: 'No Vacuum Reaches', footer: 'Add a room to a vacuum’s room map (its entity settings in Home Assistant) to offer it here.' },
        d.unreached.map(function (a) { return K.info({ label: a.name, sub: a.floor || null }); })));
    }
  }

  // ---- ALARM PIN
  // A PIN typed on this page lives only in these two fields until it is
  // saved (then forgotten); nothing ever reads one back.
  function pinForm(st, key) { return ((st.forms = st.forms || {})[key] = st.forms[key] || { pin: '', again: '' }); }
  function alarmMain(P, c, d) {
    var st = P.feat('hk_alarm_pin');
    st.forms = {};
    var house = ((P.data.settings || {}).security || {}).alarm || null;
    (d.alarms || []).forEach(function (a) {
      var uses = house && house === a.panel;
      var rows = [
        K.nav({ label: 'Change PIN', value: a.pin_set ? 'Set' : 'Not Set', href: '#/features/alarm/' + a.entry_id + '/pin',
                fk: 'alarm:pin:' + a.entry_id }),
        K.toggle({ label: 'PIN to Arm', sub: 'Off: arming needs no PIN. Disarming always does.', on: a.arm_required,
                   sk: 'f:hk_alarm_pin:arm_required', fk: 'alarm:arm:' + a.entry_id, onChange: function (on) {
          P.featCall('hk_alarm_pin', { type: 'hk_alarm_pin/settings/set', entry_id: a.entry_id, changes: { arm_required: on } }, ['arm_required']);
        } }),
        K.nav({ label: 'Protects', value: a.alarm_name || a.alarm, href: '#/features/alarm/' + a.entry_id + '/alarm',
                fk: 'alarm:alarm:' + a.entry_id }),
        // its name and entity id under the label: beside it, a phone squeezed them over each other
        K.info({ label: 'Keypad Panel', sub: a.panel ? (a.panel_name && a.panel_name !== a.panel ? a.panel_name + ' · ' : '') + a.panel : 'Starting…' })];
      if (a.panel && !uses) {
        rows.push(K.button({ label: 'Use on All Screens', fk: 'alarm:use:' + a.entry_id, onClick: function () {
          P.setH({ 'security.alarm': a.panel });
        } }));
      }
      c.appendChild(K.group({ header: a.alarm_name || a.title, footer: uses
          ? 'The screens’ alarm keypad and Security page use this PIN panel.'
          : 'Point keypads and screens at the PIN panel: it asks for the PIN, then arms or disarms the alarm. ' +
            (house ? 'The screens use ' + (P.name ? P.name(house) : house) + ' now.' : 'The screens have no alarm chosen yet.') }, rows));
      c.appendChild(K.group({}, [K.button({ label: 'Remove PIN', destructive: true, fk: 'alarm:rm:' + a.entry_id, onClick: function () {
        K.confirm(P.shadowRoot, { title: 'Remove the PIN from ' + (a.alarm_name || a.title) + '?', destructive: true, ok: 'Remove',
          message: 'Its PIN panel goes too. The alarm itself stays, and arms and disarms for anyone who can reach it, as before.' })
          .then(function (yes) {
            if (yes) P.featCall('hk_alarm_pin', { type: 'hk_alarm_pin/remove', entry_id: a.entry_id }, ['entry_id']);
          });
      } })]));
    });
    if (!(d.alarms || []).length) c.appendChild(K.group({ footer: 'No alarm has a PIN yet.' }, []));
    var free = (d.choices || []).filter(function (x) { return !x.entry; });
    c.appendChild(K.group({ footer: free.length ? 'For an alarm that arms and disarms for anyone who can reach it.'
                                                : 'Every alarm panel in this house has a PIN.' },
      free.length ? [K.nav({ label: 'Add PIN', href: '#/features/alarm/add', icon: 'mdi:plus-circle-outline', fk: 'alarm:add' })] : []));
    openIn(c, 'Alarm PIN', 'hk_alarm_pin');
  }
  function pinFields(P, c, form, footer) {
    c.appendChild(K.group({ footer: footer }, [
      K.text({ label: 'New PIN', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', sk: 'f:hk_alarm_pin:pin', value: form.pin,
               error: P.err('f:hk_alarm_pin:pin'), placeholder: 'Required', onCommit: function (v) { form.pin = v; } }),
      K.text({ label: 'Type It Again', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', sk: 'f:hk_alarm_pin:pin_again', value: form.again,
               error: P.err('f:hk_alarm_pin:pin_again'), placeholder: 'Required', onCommit: function (v) { form.again = v; } })]));
  }
  var PIN_NOTE = function (d) {
    return 'At least ' + (d.min_length || 4) + ' characters. Only a salted hash is kept, so nothing can show the PIN again: type it the same way twice.';
  };
  function alarmPin(P, c, d, id) {
    var a = (d.alarms || []).filter(function (x) { return x.entry_id === id; })[0];
    if (!a) { c.appendChild(K.group({ footer: 'That alarm has no PIN any more.' }, [])); return; }
    var st = P.feat('hk_alarm_pin'), form = pinForm(st, id);
    pinFields(P, c, form, PIN_NOTE(d));
    c.appendChild(K.group({}, [K.button({ label: 'Change PIN', fk: 'alarm:save:' + id, onClick: function () {
      P.featCall('hk_alarm_pin', { type: 'hk_alarm_pin/settings/set', entry_id: id,
                                   changes: { pin: form.pin, pin_again: form.again } }, ['pin', 'pin_again'])
        .then(function (done) {
          if (!done) return;
          delete st.forms[id];
          P.announce('PIN changed');
          P.back('#/page/security');
        });
    } })]));
  }
  function alarmPick(P, c, d, id) {
    var a = (d.alarms || []).filter(function (x) { return x.entry_id === id; })[0];
    if (!a) { c.appendChild(K.group({ footer: 'That alarm has no PIN any more.' }, [])); return; }
    c.appendChild(K.group({ footer: (P.err('f:hk_alarm_pin:alarm') ? P.err('f:hk_alarm_pin:alarm') + ' ' : '') +
        'The alarm this PIN protects. The PIN and the arm rule stay the same.' },
      (d.choices || []).map(function (x) {
        if (x.entry && x.entry !== id) return K.info({ label: x.name, sub: 'Has its own PIN' });
        return K.check({ label: x.name, sub: x.entity_id, on: x.entity_id === a.alarm, fk: 'alarm:pick:' + x.entity_id, onClick: function () {
          if (x.entity_id === a.alarm) return;
          P.featCall('hk_alarm_pin', { type: 'hk_alarm_pin/settings/set', entry_id: id, changes: { alarm: x.entity_id } }, ['alarm'])
            .then(function (done) { if (done) P.back('#/page/security'); });
        } });
      })));
  }
  function alarmAdd(P, c, d) {
    var st = P.feat('hk_alarm_pin'), form = pinForm(st, 'add');
    var free = (d.choices || []).filter(function (x) { return !x.entry; });
    if (form.alarm === undefined) form.alarm = free.length === 1 ? free[0].entity_id : '';
    if (form.arm === undefined) form.arm = true;
    c.appendChild(K.group({ footer: P.err('f:hk_alarm_pin:alarm') || 'The alarm to protect. Its PIN panel then stands in front of it.' }, [
      K.select({ label: 'Alarm', sk: 'f:hk_alarm_pin:alarm', value: form.alarm, placeholder: 'Choose',
                 options: free.map(function (x) { return [x.entity_id, x.name]; }),
                 onChange: function (v) { form.alarm = v; P.render(); } })]));
    pinFields(P, c, form, PIN_NOTE(d));
    c.appendChild(K.group({}, [K.toggle({ label: 'PIN to Arm', sub: 'Off: arming needs no PIN. Disarming always does.', on: form.arm,
                                          fk: 'alarm:add:arm', onChange: function (on) { form.arm = on; P.render(); } })]));
    c.appendChild(K.group({}, [K.button({ label: 'Add PIN', fk: 'alarm:add:go', disabled: !form.alarm, onClick: function () {
      P.featCall('hk_alarm_pin', { type: 'hk_alarm_pin/add', alarm: form.alarm, pin: form.pin, pin_again: form.again,
                                   arm_required: form.arm }, ['alarm', 'pin', 'pin_again'])
        .then(function (done) {
          if (!done) return;
          delete st.forms.add;
          P.announce('PIN added');
          P.back('#/page/security');
        });
    } })]));
  }

  // ---- MUSIC (the Music feature's own; Browse Music is the page's, drawn by it)
  function musicTop(P, c) {
    var feats = P.data.features || {}, state = stateOf(feats, 'hk_music');
    if (state === 'missing') return;
    if (state === 'not_added') { notAdded(c, (feats.hk_music || {}).name || 'Music', WHAT.hk_music, 'hk_music'); return; }
    var st = P.feat('hk_music');
    if (!st.data) { waiting(c, st, 'Music', 'hk_music'); return; }
    var d = st.data;
    if (d.configured === false) { notAdded(c, 'Music', WHAT.hk_music, 'hk_music'); return; }
    var homes = Object.keys(d.homes || {}).filter(function (u) { return (d.users || []).some(function (x) { return x.id === u; }); }).length;
    c.appendChild(K.group({ header: 'Speakers', footer: 'The rooms music plays in. A wall tablet’s signed-in user starts in its own home room.' }, [
      K.nav({ label: 'Speakers', value: String((d.speakers || []).length), href: '#/features/music/speakers', fk: 'music:speakers' }),
      K.nav({ label: 'Home Rooms', value: homes ? homes + ' of ' + (d.users || []).length : 'None', href: '#/features/music/homes', fk: 'music:homes' }),
      K.slider({ label: 'House Volume', sub: 'Where a playlist starts, in every room it plays in.', sk: 'f:hk_music:volume',
                 value: Math.round((d.volume || 0) * 100), min: 0, max: 100, step: 5, unit: '%', fk: 'music:volume',
                 onChange: function (v) { P.featSet('hk_music', { volume: v / 100 }); } })]));
    c.appendChild(K.group({ header: 'Now Playing', footer: P.err('f:hk_music:ignore_announcements') ||
      'Applies to every screen. Recognized announcements stay out of Now Playing and the screensaver music view.' }, [
      K.toggle({ label: 'Ignore Announcements', sub: 'Keep spoken reminders out of the music displays',
        on: d.ignore_announcements !== false, sk: 'f:hk_music:ignore_announcements', fk: 'music:ignore_announcements',
        onChange: function (on) { P.featSet('hk_music', { ignore_announcements: on }); } })]));
    c.appendChild(K.group({ header: 'Presets & Playlists' }, [
      K.nav({ label: 'Presets', value: String((d.presets || []).length), href: '#/features/music/presets', fk: 'music:presets' }),
      K.nav({ label: 'Playlists', value: String((d.playlists || []).length), href: '#/features/music/playlists', fk: 'music:playlists' })]));
    // KEEP PLAYLISTS READY (features/music/warm.py): Music Assistant keeps a
    // streaming playlist's songs for 3 hours, then asks Apple Music again
    // when it is opened or played -- 7-45 s, measured.
    c.appendChild(K.group({ footer: (P.err('f:hk_music:keep_ready') ? P.err('f:hk_music:keep_ready') + ' ' : '') + keepReadyNote(d) }, [
      K.toggle({ label: 'Keep Playlists Ready', sub: 'Their songs fetched ahead, so they open and start at once', on: !!d.keep_ready,
                 sk: 'f:hk_music:keep_ready', fk: 'music:keep_ready',
                 onChange: function (on) { P.featSet('hk_music', { keep_ready: on }); } })]));
  }
  function keepReadyNote(d) {
    var what = 'Your playlists and the ones played this week, refreshed every 2½ hours: one at a time, ' +
               'paused while someone is using Music, and later when Apple Music is busy.';
    if (!d.keep_ready) return what;
    var l = d.keep_ready_last;
    if (!l) return what + ' The first refresh runs shortly.';
    var at = new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return what + ' Last refresh ' + at + ': ' + l.ready + ' of ' + l.wanted + ' ready.' + (l.note ? ' ' + l.note : '');
  }
  function musicSpeakers(P, c, d) {
    var L = speakerLists(d), err = P.err('f:hk_music:speakers');
    c.appendChild(K.listEditor({ fk: 'spk', minRows: 1, announce: P.announce.bind(P), moreHeader: 'Other Music Assistant Players',
      shownFooter: (err ? err + ' ' : '') + 'Each is named by its area and grouped by its floor on the screens; within a floor, in this order.' +
                   (pairNote(d) ? ' ' + pairNote(d) : ''),
      emptyText: 'Music Assistant has no other players.',
      rows: L.rows, more: L.more, onChange: function (v) { P.featSet('hk_music', { speakers: v }); } }));
  }
  function musicHomes(P, c, d) {
    var opts = [['', 'No Home Room']].concat((d.speakers || []).map(function (x) { return [x.entity, x.name]; }));
    c.appendChild(K.group({ footer: (P.err('f:hk_music:homes') ? P.err('f:hk_music:homes') + ' ' : '') +
        'The room a person starts in when they play music. A wall tablet signs in as its own user, so this is where each tablet hangs.' },
      (d.users || []).map(function (u) {
        return K.select({ label: u.name, sk: 'music:home:' + u.id, value: (d.homes || {})[u.id] || '', options: opts,
                          onChange: function (v) { var h = {}; h[u.id] = v || null; P.featSet('hk_music', { homes: h }, ['homes']); } });
      })));
  }
  function musicPresets(P, c, d) {
    var odd = (d.presets || []).filter(function (p) { return (p.problems || []).length; });
    c.appendChild(K.group({ footer: 'A Music Assistant sync group and the rooms it plays in. Choosing exactly those rooms on a screen plays through the group, in step.' +
        (odd.length ? ' ' + odd.map(function (p) { return p.name; }).join(', ') + ' ' + (odd.length === 1 ? 'needs' : 'need') + ' a look.' : '') },
      (d.presets || []).map(function (p) {
        return K.nav({ label: p.name, sub: (p.members || []).map(function (m) { return speakerName(d, m); }).join(', '),
                       badge: (p.problems || []).length ? 'Check' : null,
                       href: '#/features/music/presets/' + encodeURIComponent(p.id), fk: 'music:preset:' + p.id });
      }).concat([K.nav({ label: 'Add Preset', href: '#/features/music/presets/new', icon: 'mdi:plus-circle-outline', fk: 'music:preset:new' })])));
  }
  function form(st, key, init) { return ((st.forms = st.forms || {})[key] = st.forms[key] || init()); }
  function musicPreset(P, c, d, id) {
    var st = P.feat('hk_music');
    var p = (d.presets || []).filter(function (x) { return x.id === id; })[0];
    if (id !== 'new' && !p) { c.appendChild(K.group({ footer: 'That preset is gone.' }, [])); return; }
    var f = form(st, 'preset:' + id, function () {
      return p ? { name: p.name, group: p.group, members: p.members.slice() } : { name: '', group: '', members: [] };
    });
    var rooms = (d.speakers || []).map(function (x) { return x.entity; });
    var groups = (d.players || []).filter(function (x) { return rooms.indexOf(x.entity) < 0; });
    c.appendChild(K.group({}, [
      K.text({ label: 'Name', sk: 'f:hk_music:name', value: f.name, placeholder: 'Everywhere', maxlength: 60,
               error: P.err('f:hk_music:name'), onCommit: function (v) { f.name = v; } }),
      K.select({ label: 'Sync Group', sk: 'f:hk_music:group', value: f.group, placeholder: 'Choose',
                 options: groups.map(function (x) { return [x.entity, x.name]; }), onChange: function (v) { f.group = v; P.render(); } })]));
    if (P.err('f:hk_music:group')) c.appendChild(K.group({ footer: P.err('f:hk_music:group') }, []));
    // ITS ROOMS ARE ITS GROUP'S (hk_core/music/groups.py): read from Music
    // Assistant, a pair's speakers counted as the pair. Chosen here only when
    // Music Assistant's groups can't be read.
    var ma = f.group && d.groups ? d.groups[f.group] : null;
    var memErr = P.err('f:hk_music:members') ? P.err('f:hk_music:members') + ' ' : '';
    if (ma) {
      var said = memErr + (ma.rooms.length ? 'The rooms in Music Assistant’s ' + speakerName(d, f.group) + ' group. Change the group there; this follows it.'
                                           : 'None of the speakers in Music Assistant’s ' + speakerName(d, f.group) + ' group are Music’s speakers.');
      c.appendChild(K.group({ header: 'Rooms', footer: [said].concat(ma.problems).join(' ') },
        ma.rooms.map(function (e) {
          var x = (d.speakers || []).filter(function (s) { return s.entity === e; })[0] || { name: e };
          var pair = (d.pairs || {})[e];
          return K.info({ label: x.name, sub: [x.floor, pair ? cap(pair.kind) : null].filter(Boolean).join(' · ') || null });
        })));
    } else {
      c.appendChild(K.group({ header: 'Rooms', footer: memErr + (d.ma_groups
          ? (f.group ? 'Music Assistant doesn’t list that player as a group, so its rooms are chosen here.' : 'Choose the sync group: its rooms come from Music Assistant.')
          : 'Music Assistant’s groups can’t be read right now, so the rooms are chosen here.') },
        (d.speakers || []).map(function (x) {
          var on = f.members.indexOf(x.entity) >= 0;
          return K.check({ label: x.name, sub: x.floor || null, multi: true, on: on, fk: 'music:member:' + x.entity, onClick: function () {
            f.members = on ? f.members.filter(function (m) { return m !== x.entity; }) : f.members.concat(x.entity);
            P.render();
          } });
        })));
    }
    var save = K.button({ label: p ? 'Save Preset' : 'Add Preset', fk: 'music:preset:save', onClick: function () {
      P.featCall('hk_music', Object.assign({ type: 'hk_music/preset/save', name: f.name, group: f.group, members: ma ? ma.rooms : f.members },
                                           p ? { item: p.id } : {}), ['name', 'group', 'members'])
        .then(function (ok) { if (ok) { delete st.forms['preset:' + id]; P.back('#/features/music/presets'); } });
    } });
    c.appendChild(K.group({}, [save]));
    if (p) removeButton(P, c, p.id, p.name, 'preset', '#/features/music/presets');
  }
  function removeButton(P, c, id, name, what, back) {
    c.appendChild(K.group({}, [K.button({ label: 'Delete ' + (what === 'preset' ? 'Preset' : 'Playlist'), destructive: true,
      fk: 'music:rm:' + id, onClick: function () {
        K.confirm(P.shadowRoot, { title: 'Delete “' + name + '”?', destructive: true, ok: 'Delete',
          message: what === 'preset' ? 'The sync group itself stays in Music Assistant.' : 'The playlists stay in your Music Assistant library.' })
          .then(function (yes) {
            if (!yes) return;
            P.featCall('hk_music', { type: 'hk_music/item/remove', item: id }, ['item'])
              .then(function (ok) { if (ok) P.back(back); });
          });
      } })]));
  }
  function playlistSub(p) {
    var n = (p.items || []).length;
    return [p.chooser ? 'In ' + p.chooser : null, plural(n, 'playlist', 'playlists')].filter(Boolean).join(' · ');
  }
  function musicPlaylists(P, c, d) {
    var st = P.feat('hk_music');
    c.appendChild(K.listEditor({ fk: 'pls', minRows: 1, announce: P.announce.bind(P),
      shownFooter: 'Your Playlists on the Music page, in this order. Pills with the same chooser become one pill that asks which (like Decades).',
      rows: (d.playlists || []).map(function (p) {
        return { value: p.id, label: p.name, sub: playlistSub(p), icon: p.icon, removable: true,
                 href: '#/features/music/playlists/' + encodeURIComponent(p.id) };
      }),
      more: [],
      onRemove: function (id) {
        var p = (d.playlists || []).filter(function (x) { return x.id === id; })[0];
        K.confirm(P.shadowRoot, { title: 'Delete “' + (p ? p.name : id) + '”?', destructive: true, ok: 'Delete',
                                  message: 'The playlists stay in your Music Assistant library.' })
          .then(function (yes) { if (yes) P.featCall('hk_music', { type: 'hk_music/item/remove', item: id }, ['item']); });
      },
      onChange: function (ids) { P.featCall('hk_music', { type: 'hk_music/playlists/order', ids: ids }, ['ids']); } }));
    c.appendChild(K.group({}, [K.nav({ label: 'Add Playlist', href: '#/features/music/playlists/new', icon: 'mdi:plus-circle-outline',
                                       fk: 'music:playlist:new' })]));
    void st;
  }
  function libraryOf(P) {
    var st = P.feat('hk_music');
    if (!st.library && !st.libLoading) {
      st.libLoading = true;
      P.client.callWS({ type: 'hk_music/settings/library' }).then(function (r) {
        st.library = (r && r.items) || []; st.libLoading = false; P.render(true);
      }, function () { st.library = []; st.libLoading = false; P.render(true); });
    }
    return st.library || null;
  }
  function musicPlaylist(P, c, d, id) {
    var st = P.feat('hk_music');
    var p = (d.playlists || []).filter(function (x) { return x.id === id; })[0];
    if (id !== 'new' && !p) { c.appendChild(K.group({ footer: 'That playlist is gone.' }, [])); return; }
    var f = form(st, 'playlist:' + id, function () {
      return p ? { name: p.name, icon: p.icon, items: p.items.slice(), chooser: p.chooser || '' } : { name: '', icon: '', items: [], chooser: '' };
    });
    var lib = libraryOf(P) || [], names = {};
    lib.forEach(function (i) { names[i.uri] = i.name; });
    c.appendChild(K.group({}, [
      K.text({ label: 'Name', sk: 'f:hk_music:name', value: f.name, placeholder: 'Road Trip', maxlength: 60,
               error: P.err('f:hk_music:name'), onCommit: function (v) { f.name = v; } }),
      K.text({ label: 'Icon', sk: 'f:hk_music:icon', value: f.icon, placeholder: 'mdi:playlist-music', maxlength: 60,
               onCommit: function (v) { f.icon = v; } }),
      K.text({ label: 'Chooser', sub: 'Optional', sk: 'f:hk_music:chooser', value: f.chooser, placeholder: 'None', maxlength: 60,
               error: P.err('f:hk_music:chooser'), onCommit: function (v) { f.chooser = v; } })]));
    c.appendChild(K.group({ header: 'Plays', footer: (P.err('f:hk_music:items') ? P.err('f:hk_music:items') + ' ' : '') +
        'Library playlists, played as one queue.' },
      f.items.map(function (u) { return K.info({ label: names[u] || u, sub: names[u] ? null : 'Not in the library' }); })
        .concat([K.nav({ label: f.items.length ? 'Choose Playlists' : 'Choose a Playlist', value: String(f.items.length),
                         href: '#/features/music/playlists/' + encodeURIComponent(id) + '/items', fk: 'music:items' })])));
    c.appendChild(K.group({}, [K.button({ label: p ? 'Save Playlist' : 'Add Playlist', fk: 'music:playlist:save', onClick: function () {
      P.featCall('hk_music', Object.assign({ type: 'hk_music/playlist/save', name: f.name, icon: f.icon || null, items: f.items,
                                             chooser: f.chooser || null }, p ? { item: p.id } : {}), ['name', 'items', 'chooser'])
        .then(function (ok) { if (ok) { delete st.forms['playlist:' + id]; P.back('#/features/music/playlists'); } });
    } })]));
    if (p) removeButton(P, c, p.id, p.name, 'playlist', '#/features/music/playlists');
  }
  function musicItems(P, c, d, id) {
    var st = P.feat('hk_music');
    var f = (st.forms || {})['playlist:' + id];
    if (!f) { P.go('#/features/music/playlists/' + encodeURIComponent(id)); return; }
    var lib = libraryOf(P);
    if (!lib) { c.appendChild(K.group({}, [K.info({ label: 'Reading the library…' })])); return; }
    var q = String(st.libQ || '').trim().toLowerCase();
    var inp = K.text({ label: 'Search', sk: 'music:libq', value: st.libQ || '', placeholder: 'Playlist name',
                       onCommit: function (v) { st.libQ = v; P.render(); } });
    c.appendChild(K.group({}, [inp]));
    var pick = function (u, on) {
      f.items = on ? f.items.filter(function (x) { return x !== u; }) : f.items.concat(u);
      P.render();
    };
    // two library playlists with one name (Music Assistant keeps duplicates):
    // each says which it is
    var seen = {};
    lib.forEach(function (i) { seen[i.name] = (seen[i.name] || 0) + 1; });
    var subOf = function (i) { return seen[i.name] > 1 ? i.uri : null; };
    var chosen = f.items.map(function (u) {
      var i = lib.filter(function (x) { return x.uri === u; })[0];
      return K.check({ label: i ? i.name : u, sub: i ? subOf(i) : 'Not in the library', multi: true, on: true, fk: 'music:item:' + u,
                       onClick: function () { pick(u, true); } });
    });
    if (chosen.length) c.appendChild(K.group({ header: 'Chosen', footer: 'Played in this order, as one queue.' }, chosen));
    var rest = lib.filter(function (i) { return f.items.indexOf(i.uri) < 0 && (!q || i.name.toLowerCase().indexOf(q) >= 0); });
    c.appendChild(K.group({ header: 'Library', footer: lib.length ? (rest.length > 200 ? 'The first 200; search for the rest.' : null)
                                                     : 'The Music Assistant library has no playlists, or couldn’t be read.' },
      rest.slice(0, 200).map(function (i) {
        return K.check({ label: i.name, sub: subOf(i), multi: true, on: false, fk: 'music:item:' + i.uri, onClick: function () { pick(i.uri, false); } });
      })));
  }

  // ---------------------------------------------------------------- energy
  // ENERGY (features/energy): the Energy page a screen shows, built from
  // Home Assistant's Energy settings. Its page here sorts the devices into
  // sections, names them and picks the rows; each change goes through
  // hk_energy/settings/set (or /device/set for one device), whose answer is
  // the page again. `d`: options (as stored), plan (what the screens draw),
  // devices (every one, hidden too), batteries, sections (as resolved).
  var EN = 'hk_energy';
  var EN_COLORS = [['', 'Automatic'], ['white', 'White'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['red', 'Red'],
                   ['pink', 'Pink'], ['purple', 'Purple'], ['blue', 'Blue'], ['teal', 'Teal'], ['mint', 'Mint'],
                   ['green', 'Green'], ['cyan', 'Cyan']];
  // how a device's power sensor was found, in the page's words
  function energyFound(dev) {
    return { own: 'Chosen here', energy: 'From Home Assistant’s Energy settings',
             source: 'Found through its meter’s source', device: 'Found on its meter’s device' }[dev.found] ||
           'None found: its tile shows today’s kWh';
  }
  // the sections as resolved, with one device moved to another (or out of
  // every section: back to where its guess puts it) -- what is saved once a
  // device is placed by hand
  function sectionsAfter(d, key, to) {
    var out = (d.sections || []).map(function (s) {
      return { id: s.id, name: s.name, items: s.items.filter(function (k) { return k !== key; }),
               link: s.link || undefined, color: s.color || undefined };
    });
    if (to) {
      var s = out.filter(function (x) { return x.id === to; })[0];
      if (!s) {
        var kinds = {};
        (d.section_kinds || []).forEach(function (k) { kinds[k[0]] = k[1]; });
        s = { id: to, name: kinds[to] || to, items: [] };
        out.push(s);
      }
      s.items.push(key);
    }
    return out.map(function (x) {
      var y = { id: x.id, name: x.name, items: x.items };
      if (x.link) y.link = x.link;
      if (x.color) y.color = x.color;
      return y;
    });
  }
  function energySet(P, changes) { return P.featSet(EN, changes); }
  // an entity's name; one with none of its own (Home Assistant's own cost
  // sensor) by its id, not a made-up one
  function enName(P, id) {
    var st = P.client && P.client.states[id];
    return st && st.attributes && st.attributes.friendly_name ? P.name(id) : id;
  }
  function energyDev(P, key, changes) {
    return P.featCall(EN, { type: 'hk_energy/device/set', key: key, changes: changes }, Object.keys(changes));
  }
  function devByKey(d, key) { return (d.devices || []).filter(function (x) { return x.key === key; })[0] || null; }
  function sectionOf(d, key) {
    return (d.sections || []).filter(function (s) { return s.items.indexOf(key) >= 0; })[0] || null;
  }
  function plural2(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function energyMain(P, c, d) {
    var o = d.options || {}, pl = d.plan || {}, T = pl.total || {}, en = d.energy || {};
    var ha = en.grid || en.devices
      ? [en.grid ? 'the grid meter' : null, en.devices ? plural2(en.devices, 'device', 'devices') : null].filter(Boolean).join(' and ')
      : null;
    c.appendChild(K.group({ header: 'Home Assistant’s Energy Settings',
        footer: ha ? 'The page starts from ' + ha + ' in Home Assistant’s Energy settings: their meters, which device is inside which, and their power sensors.'
                   : 'Home Assistant’s Energy settings list nothing yet. Add the grid and your devices there, or add devices here.' }, [
      K.toggle({ label: 'List Their Devices', sub: 'Every device there gets a tile, new ones too', on: o.follow !== false,
                 sk: 'f:' + EN + ':follow', onChange: function (on) { energySet(P, { follow: on }); } }),
      K.nav({ label: 'Energy Settings', sub: 'In Home Assistant', href: en.url || '/config/energy', icon: 'mdi:open-in-new',
              fk: 'energy:ha' })]));
    var pg = o.page || {};
    var pageSet = function (ch) { return energySet(P, { page: ch }); };
    var ringNames = { energy: 'Energy', cost: 'Cost', solar: 'Solar', water: 'Water', gas: 'Gas' };
    c.appendChild(K.group({ header: 'The Page', footer: 'Now is live power; Today, This Week and This Month are energy from Home Assistant\u2019s statistics.' }, [
      K.text({ label: 'Title', sk: 'f:' + EN + ':title', value: o.title || '', placeholder: 'Energy', maxlength: 40,
               error: P.err('f:' + EN + ':title'), onCommit: function (v) { energySet(P, { title: v.trim() || null }); } }),
      K.select({ label: 'Opens On', sk: 'f:' + EN + ':page:opens_on', value: pg.opens_on || '',
                 options: [['', 'Automatic (Now)'], ['now', 'Now'], ['day', 'Today'], ['week', 'This Week'], ['month', 'This Month']],
                 onChange: function (v) { pageSet({ opens_on: v || null }); } }),
      K.nav({ label: 'Rings', sub: 'Each fills toward a usual day', value: Array.isArray(pg.rings) && pg.rings.length
                ? pg.rings.map(function (k) { return ringNames[k]; }).join(', ') : 'Automatic',
              href: '#/features/energy/rings', fk: 'energy:rings' }),
      K.select({ label: 'A Usual Day', sk: 'f:' + EN + ':page:typical', value: pg.typical ? String(pg.typical) : '',
                 options: [['', 'The 30 Days Before'], ['14', 'The 14 Days Before'], ['7', 'The 7 Days Before']],
                 onChange: function (v) { pageSet({ typical: v ? Number(v) : null }); } }),
      K.toggle({ label: 'Highlights', sub: 'What stood out, beside the summary', on: pg.highlights !== false,
                 sk: 'f:' + EN + ':page:highlights', onChange: function (on) { pageSet({ highlights: on ? null : false }); } }),
      K.nav({ label: 'Readings', sub: 'Today\u2019s cost, thermostats, outside \u00b7 on Now', value: String((pl.top || []).length),
              href: '#/features/energy/top', fk: 'energy:top' }),
      K.nav({ label: 'Tracking', sub: pl.usages_auto === false ? 'A row each on the page, following the tabs' : 'None: each device\u2019s sheet has its bars',
              value: pl.usages_auto === false ? String((pl.usages || []).length) : 'Automatic',
              href: '#/features/energy/usages', fk: 'energy:usages' }),
      K.nav({ label: 'Sections', value: String((pl.sections || []).length), href: '#/features/energy/sections', fk: 'energy:sections' }),
      K.nav({ label: 'Devices', value: String((d.devices || []).length), href: '#/features/energy/devices', fk: 'energy:devices' }),
      K.nav({ label: 'Batteries', value: String((d.batteries || []).length), href: '#/features/energy/batteries', fk: 'energy:batteries' }),
      K.toggle({ label: 'Home Assistant’s Charts', sub: 'Its own four energy cards, at the end', on: o.detail === true,
                 sk: 'f:' + EN + ':detail', onChange: function (on) { energySet(P, { detail: on }); } })]));
    var pwo = o.power && typeof o.power === 'object' ? o.power : null;
    c.appendChild(K.group({ footer: 'Right now and the controls, beside this page: the house, the battery, the cars, and what the battery backs up.' }, [
      K.nav({ label: 'Power Page', value: pwo && pwo.on !== false ? 'On' : 'Off', href: '#/features/energy/power', fk: 'energy:power' })]));
    var tot = o.total || {};
    c.appendChild(K.group({ header: 'Whole Home', footer: 'Automatic: the grid meter in Home Assistant’s Energy settings, its cost, and the power sensor behind it (or the Energy chip’s Power Use).' }, [
      P.entityRow({ label: 'Power', sk: 'f:' + EN + ':total:power', value: tot.power || null,
                    none: 'Automatic' + (T.power && !tot.power ? ' (' + enName(P, T.power) + ')' : ''),
                    filter: { domains: ['sensor'], dc: 'power' },
                    onPick: function (v) { energySet(P, { total: Object.assign({}, tot, { power: v || '' }) }); } }),
      P.entityRow({ label: 'Energy Meter', sk: 'f:' + EN + ':total:stat', value: tot.stat || null,
                    none: 'Automatic' + (T.stat && !tot.stat ? ' (' + enName(P, T.stat) + ')' : ''),
                    filter: { domains: ['sensor'], dc: 'energy' },
                    onPick: function (v) { energySet(P, { total: Object.assign({}, tot, { stat: v || '' }) }); } }),
      P.entityRow({ label: 'Cost', sk: 'f:' + EN + ':total:cost', value: tot.cost || null,
                    none: 'Automatic' + (T.cost && !tot.cost ? ' (' + enName(P, T.cost) + ')' : T.price ? ' (meter × price)' : ''),
                    filter: { domains: ['sensor'], dc: 'monetary' },
                    onPick: function (v) { energySet(P, { total: Object.assign({}, tot, { cost: v || '' }) }); } })]));
    // WHERE IT IS SHOWN: the screens that list it
    var boards = (P.data && P.data.boards) || {};
    var on = (P.data.dashboards || []).filter(function (x) {
      var b = boards[x.path];
      if (!b) return false;
      if (b.home_page === false) {
        return (b.only_pages || []).length ? b.only_pages.indexOf('energy') >= 0 : (b.custom_pages || []).indexOf('energy') >= 0;
      }
      return !(b.pages || []).length || (b.pages || []).indexOf('energy') >= 0;
    });
    c.appendChild(K.group({ header: 'Screens', footer: 'A screen shows it once Energy is on its Pages (Automatic pages include it). An Energy Display is a screen that is only this page.' },
      on.map(function (x) {
        return K.nav({ label: x.title, sub: '/' + x.path, href: '#/screens/' + encodeURIComponent(x.path) + '/pages', fk: 'energy:screen:' + x.path });
      }).concat([K.button({ label: 'Add an Energy Display', fk: 'energy:display', onClick: function () {
        P._new = { name: 'Energy', kind: 'energy', admin: false, shows: 'energy' };
        P.go('#/add-screen');
      } })])));
    openIn(c, 'Energy', EN);
  }

  // THE RINGS: in this order, each only where the house has its source (four
  // at most); Automatic is every one it has
  function energyRings(P, c, d) {
    var o = d.options || {}, pg = o.page || {}, pl = d.plan || {}, src = pl.sources || {};
    var have = { energy: true, cost: src.cost !== false, solar: !!src.solar, water: !!src.water, gas: !!src.gas };
    var ORDER = [['energy', 'Energy', 'What the house used'], ['cost', 'Cost', 'What it cost'], ['solar', 'Solar', 'What the sun made'],
                 ['water', 'Water', 'From Home Assistant\u2019s Energy settings'], ['gas', 'Gas', 'From Home Assistant\u2019s Energy settings']];
    var auto = !Array.isArray(pg.rings) || !pg.rings.length;
    var on = auto ? ORDER.map(function (r) { return r[0]; }).filter(function (k) { return have[k]; }).slice(0, 4) : pg.rings;
    c.appendChild(K.group({ footer: 'Automatic: every one the house has, up to four.' }, [
      K.toggle({ label: 'Automatic', on: auto, sk: 'f:' + EN + ':rings:auto',
                 onChange: function (v) { energySet(P, { page: { rings: v ? null : on } }); } })]));
    if (auto) return;
    c.appendChild(K.group({ header: 'Rings', footer: 'Each fills toward a usual day, from the outside in. One the house has no source for is left out.' },
      ORDER.map(function (r) {
        var lit = on.indexOf(r[0]) >= 0;
        return K.check({ label: r[1], sub: have[r[0]] ? r[2] : 'Not in this house', multi: true, on: lit, sk: 'f:' + EN + ':rings:' + r[0],
          onClick: function (want) {
            var next = ORDER.map(function (x) { return x[0]; }).filter(function (k) { return k === r[0] ? want : on.indexOf(k) >= 0; });
            if (!next.length || next.length > 4) return;
            energySet(P, { page: { rings: next } });
          } });
      })));
  }
  function energyTop(P, c, d) {
    var o = d.options || {}, pl = d.plan || {};
    var auto = !Array.isArray(o.top);
    var ids = (pl.top || []).filter(function (t) { return t.entity; }).map(function (t) { return t.entity; });
    c.appendChild(K.group({}, [K.toggle({ label: 'Today’s Cost', sub: 'First, from the whole home’s meter', on: o.cost !== false,
      sk: 'f:' + EN + ':cost', onChange: function (on) { energySet(P, { cost: on }); } })]));
    c.appendChild(K.listEditor({ fk: 'entop', auto: auto, minRows: 0, announce: P.announce.bind(P),
      autoFooter: 'Automatic: the first two thermostats (Accessories → Thermostats) and the outside temperature (Weather).',
      shownFooter: 'Up to four readings, today’s cost among them.',
      rows: ids.map(function (id) { return { value: id, label: P.name(id), sub: id }; }),
      onAuto: function (on) { energySet(P, { top: on ? null : ids }); },
      onChange: function (v) { energySet(P, { top: v }); },
      addLabel: ids.length < 4 - (o.cost !== false ? 1 : 0) ? 'Add Reading' : null,
      onAddOther: function () {
        P.go(P.picker('energy-top', { title: 'Add Reading', value: null, items: function () {
          return P.entityIds({ domains: ['climate', 'sensor'], shown: true }).filter(function (id) {
            var a = (P.client.states[id] || {}).attributes || {};
            return id.indexOf('climate.') === 0 || a.device_class === 'temperature' || a.device_class === 'humidity' ||
                   a.device_class === 'power';
          }).map(function (id) { return { value: id, label: P.name(id), sub: id }; });
        }, onPick: function (v) { if (v) energySet(P, { top: ids.concat(v).slice(0, 4) }); } }));
      } }));
  }

  function energyUsages(P, c, d) {
    var o = d.options || {}, pl = d.plan || {};
    var auto = !Array.isArray(o.usages);
    var rows = (pl.usages || []).map(function (u) { return { entity: u.entity, stat: u.stat, name: u.name, color: u.color }; });
    var save = function (list) {
      energySet(P, { usages: list.map(function (u) {
        var x = { entity: u.entity };
        if (u.stat && u.stat !== u.entity) x.stat = u.stat;
        if (u.name) x.name = u.name;
        if (u.color) x.color = u.color;
        return x;
      }) });
    };
    c.appendChild(K.listEditor({ fk: 'enuse', auto: auto, minRows: 0, announce: P.announce.bind(P),
      autoFooter: 'Automatic: no Tracking card; each device\u2019s sheet has its own bars. Turn this off to follow meters and runtimes of your own.',
      shownFooter: 'A row each on the page\u2019s Tracking card: its figure and bars for the tab, against its usual. A runtime sensor (hours) shows its hours.',
      rows: rows.map(function (u, i) {
        return { value: String(i), label: u.name, sub: u.entity, href: auto ? null : '#/features/energy/usages/' + i };
      }),
      onAuto: function (on) { if (on) energySet(P, { usages: null }); else save(rows); },
      onChange: function (v) { save(v.map(function (i) { return rows[Number(i)]; })); },
      addLabel: rows.length < 9 ? 'Add to Tracking' : null,
      onAddOther: function () {
        P.go(P.picker('energy-usage', { title: 'Add to Tracking', value: null, items: function () {
          return P.entityIds({ domains: ['sensor'], shown: true }).filter(function (id) {
            var a = (P.client.states[id] || {}).attributes || {};
            return ['power', 'energy', 'duration'].indexOf(a.device_class) >= 0;
          }).map(function (id) { return { value: id, label: P.name(id), sub: id }; });
        }, onPick: function (v) {
          if (!v) return;
          var dev = (d.devices || []).filter(function (x) { return x.power === v || x.stat === v; })[0];
          save(rows.concat([{ entity: v, stat: dev ? dev.stat : null, name: dev ? dev.name : null }]));
        } }));
      } }));
  }
  function energyUsage(P, c, d, i) {
    var o = d.options || {};
    var list = Array.isArray(o.usages) ? o.usages.slice() : null;
    var u = list && list[i];
    if (!u) { c.appendChild(K.group({ footer: 'That bar is gone.' }, [])); return; }
    var put = function (ch) {
      list[i] = Object.assign({}, u, ch);
      Object.keys(list[i]).forEach(function (k) { if (list[i][k] === '' || list[i][k] == null) delete list[i][k]; });
      energySet(P, { usages: list });
    };
    var shown = ((d.plan || {}).usages || [])[i] || {};
    c.appendChild(K.group({}, [
      K.text({ label: 'Name', sk: 'f:' + EN + ':usage:name', value: u.name || '', placeholder: shown.name || '', maxlength: 40,
               onCommit: function (v) { put({ name: v.trim() }); } }),
      K.select({ label: 'Color', sk: 'f:' + EN + ':usage:color', value: u.color || '', options: EN_COLORS,
                 onChange: function (v) { put({ color: v }); } }),
      P.entityRow({ label: 'Reading', sk: 'f:' + EN + ':usage:entity', value: u.entity, required: true,
                    filter: { domains: ['sensor'] }, onPick: function (v) { if (v) put({ entity: v }); } }),
      P.entityRow({ label: 'Daily Use From', sk: 'f:' + EN + ':usage:stat', value: u.stat || null, none: 'The reading itself',
                    filter: { domains: ['sensor'] }, onPick: function (v) { put({ stat: v || '' }); } })]));
  }

  function energySections(P, c, d) {
    var o = d.options || {};
    var auto = !Array.isArray(o.sections);
    var secs = d.sections || [];
    var names = {};
    (d.devices || []).forEach(function (x) { names[x.key] = x.name; });
    (d.batteries || []).forEach(function (x) { names[x.key] = x.name; });
    var asStored = function (list) {
      return list.map(function (s) {
        var y = { id: s.id, name: s.name, items: s.items };
        if (s.link) y.link = s.link;
        if (s.color) y.color = s.color;
        return y;
      });
    };
    c.appendChild(K.listEditor({ fk: 'ensec', auto: auto, minRows: 1, announce: P.announce.bind(P),
      autoFooter: 'Automatic: each device in the section its name suggests — Heating & Cooling, Rooms, Appliances, Outlets, Charging.',
      shownFooter: 'The page’s sections, in this order. A device in none goes to the section its name suggests, or Other.',
      rows: secs.map(function (s) {
        return { value: s.id, label: s.name, sub: s.items.map(function (k) { return names[k] || k; }).join(', ') || 'Empty',
                 href: '#/features/energy/sections/' + encodeURIComponent(s.id) };
      }),
      onAuto: function (on) { energySet(P, { sections: on ? null : asStored(secs) }); },
      onChange: function (v) {
        energySet(P, { sections: asStored(v.map(function (id) { return secs.filter(function (s) { return s.id === id; })[0]; })) });
      },
      addLabel: 'Add Section',
      onAddOther: function () {
        var n = 1, id = 'section-1';
        while (secs.some(function (s) { return s.id === id; })) id = 'section-' + (++n);
        energySet(P, { sections: asStored(secs).concat([{ id: id, name: 'New Section', items: [] }]) })
          .then(function (done) { if (done) P.go('#/features/energy/sections/' + id); });
      } }));
  }
  function energySection(P, c, d, id) {
    var secs = d.sections || [];
    var s = secs.filter(function (x) { return x.id === id; })[0];
    if (!s) { c.appendChild(K.group({ footer: 'That section is gone.' }, [])); return; }
    var names = {}, subs = {};
    (d.devices || []).forEach(function (x) { names[x.key] = x.name; subs[x.key] = x.hidden ? 'Hidden' : null; });
    (d.batteries || []).forEach(function (x) { names[x.key] = x.name; subs[x.key] = 'Battery'; });
    var asStored = function (list) {
      return list.map(function (x) {
        var y = { id: x.id, name: x.name, items: x.items };
        if (x.link) y.link = x.link;
        if (x.color) y.color = x.color;
        return y;
      });
    };
    var put = function (ch) {
      energySet(P, { sections: asStored(secs.map(function (x) { return x.id === id ? Object.assign({}, x, ch) : x; })) });
    };
    var link = s.link || {};
    c.appendChild(K.group({}, [
      K.text({ label: 'Name', sk: 'f:' + EN + ':section:name', value: s.name, maxlength: 40, error: P.err('f:' + EN + ':sections'),
               onCommit: function (v) { if (v.trim()) put({ name: v.trim() }); } })]));
    // ITS COLOR: its part of Where it went and its tiles' lines
    var autoCol = { hvac: 'Light Blue', rooms: 'Purple', appliances: 'Pink', outlets: 'Yellow', charging: 'Green' }[s.id] || 'One of HK\u2019s';
    c.appendChild(K.group({ footer: 'Its part of Where it went, and its tiles\u2019 lines.' }, [
      K.select({ label: 'Color', sk: 'f:' + EN + ':section:color', value: s.color || '',
                 options: [['', 'Automatic (' + autoCol + ')']].concat(EN_COLORS.slice(1)),
                 onChange: function (v) { put({ color: v || null }); } })]));
    c.appendChild(K.group({ header: 'Link', footer: 'Optional: its heading opens another page — a panel’s own dashboard, say (“/dashboard-home/my-page”).' }, [
      K.text({ label: 'Page', sk: 'f:' + EN + ':section:link', value: link.path || '', placeholder: 'None', maxlength: 120,
               onCommit: function (v) { put({ link: v.trim() ? { path: v.trim(), text: link.text || '' } : null }); } }),
      K.text({ label: 'Link Text', sk: 'f:' + EN + ':section:linktext', value: link.text || '', placeholder: 'More', maxlength: 40,
               onCommit: function (v) { if (link.path) put({ link: { path: link.path, text: v.trim() } }); } })]));
    var others = [];
    secs.forEach(function (x) {
      if (x.id !== id) x.items.forEach(function (k) { others.push({ value: k, label: names[k] || k, sub: 'In ' + x.name }); });
    });
    c.appendChild(K.listEditor({ fk: 'ensecitems', minRows: 0, announce: P.announce.bind(P), shownHeader: 'Tiles',
      shownFooter: 'In this order. A device taken out goes back to the section its name suggests.',
      rows: s.items.map(function (k) {
        return { value: k, label: names[k] || k, sub: subs[k],
                 href: devByKey(d, k) ? '#/features/energy/devices/' + encodeURIComponent(k) : null };
      }),
      more: others, moreHeader: 'Move Here',
      onChange: function (v) {
        // a tile moved here leaves its old section
        var moved = asStored(secs.map(function (x) {
          return x.id === id ? Object.assign({}, x, { items: v }) : Object.assign({}, x, { items: x.items.filter(function (k) { return v.indexOf(k) < 0; }) });
        }));
        energySet(P, { sections: moved });
      } }));
    if (secs.length > 1) {
      c.appendChild(K.group({}, [K.button({ label: 'Delete Section', destructive: true, fk: 'energy:section:rm', onClick: function () {
        K.confirm(P.shadowRoot, { title: 'Delete “' + s.name + '”?', destructive: true, ok: 'Delete',
                                  message: 'Its tiles go back to the sections their names suggest.' })
          .then(function (yes) {
            if (!yes) return;
            energySet(P, { sections: asStored(secs.filter(function (x) { return x.id !== id; })) })
              .then(function (done) { if (done) P.back('#/features/energy/sections'); });
          });
      } })]));
    }
  }

  function energyDevices(P, c, d) {
    var secs = d.sections || [];
    var byKey = {};
    (d.devices || []).forEach(function (x) { byKey[x.key] = x; });
    secs.forEach(function (s) {
      var rows = s.items.filter(function (k) { return byKey[k]; }).map(function (k) {
        var x = byKey[k];
        return K.nav({ label: x.name, sub: x.hidden ? 'Hidden' : (x.power ? P.name(x.power) : 'No power sensor'), icon: x.icon,
                       href: '#/features/energy/devices/' + encodeURIComponent(k), fk: 'energy:dev:' + k });
      });
      if (rows.length) c.appendChild(K.group({ header: s.name }, rows));
    });
    c.appendChild(K.group({ footer: 'A device Home Assistant’s Energy settings don’t list: a circuit or a plug with its own power sensor.' }, [
      K.nav({ label: 'Add Device', href: '#/features/energy/add', icon: 'mdi:plus-circle-outline', fk: 'energy:add' })]));
  }
  function energyDevice(P, c, d, key) {
    var x = devByKey(d, key);
    if (!x) { c.appendChild(K.group({ footer: 'That device isn’t listed any more.' }, [])); return; }
    var own = ((d.options || {}).devices || {})[key] || {};
    var e = function (f) { return P.err('f:' + EN + ':' + f); };
    c.appendChild(K.group({}, [
      K.text({ label: 'Name', sk: 'f:' + EN + ':name', value: own.name || '', placeholder: x.name, maxlength: 40, error: e('name'),
               onCommit: function (v) { energyDev(P, key, { name: v.trim() || null }); } }),
      K.text({ label: 'Glyph', sk: 'f:' + EN + ':icon', value: own.icon || '', placeholder: x.icon, maxlength: 60, error: e('icon'),
               onCommit: function (v) { energyDev(P, key, { icon: v.trim() || null }); } }),
      K.select({ label: 'Color', sk: 'f:' + EN + ':color', value: own.color || '', options: EN_COLORS,
                 onChange: function (v) { energyDev(P, key, { color: v || null }); } }),
      K.toggle({ label: 'Show on the Energy Page', on: !x.hidden, sk: 'f:' + EN + ':hidden',
                 onChange: function (on) { energyDev(P, key, { hidden: !on }); } })]));
    var sec = sectionOf(d, key);
    c.appendChild(K.group({ header: 'Section' }, [
      K.select({ label: 'Section', sk: 'f:' + EN + ':section', value: sec ? sec.id : '',
                 options: (d.sections || []).map(function (s) { return [s.id, s.name]; }).concat(
                   (d.section_kinds || []).filter(function (k) {
                     return !(d.sections || []).some(function (s) { return s.id === k[0]; });
                   }).map(function (k) { return [k[0], k[1] + ' (new)']; })),
                 onChange: function (v) { if (v) energySet(P, { sections: sectionsAfter(d, key, v) }); } })]));
    // POWER AND ENERGY, KEPT APART: what each tab of the page reads
    c.appendChild(K.group({ header: 'Now \u00b7 Live Power', footer: energyFound(x) + '. Watts as they happen; without one, Now shows today\u2019s kWh on this tile.' }, [
      P.entityRow({ label: 'Power Sensor', sk: 'f:' + EN + ':power', value: own.power || null,
                    none: 'Automatic' + (x.power && !own.power ? ' (' + P.name(x.power) + ')' : ''),
                    filter: { domains: ['sensor'], dc: 'power' },
                    onPick: function (v) { energyDev(P, key, { power: v || null }); } })]));
    c.appendChild(K.group({ header: 'Today, This Week, This Month \u00b7 Energy',
        footer: x.stat ? 'kWh from Home Assistant\u2019s statistics: the same numbers as its Energy dashboard.'
                       : 'No energy meter: this tile shows only Now. Add one in Home Assistant\u2019s Energy settings to give it history.' }, [
      x.stat ? K.info({ label: 'Energy Meter', sub: x.stat, value: P.name(x.stat) }) : K.info({ label: 'Energy Meter', value: 'None' }),
      P.entityRow({ label: 'Daily Runtime', sub: 'An AC\u2019s hours, beside its kWh', sk: 'f:' + EN + ':runtime', value: own.runtime || null,
                    none: 'Automatic' + (x.runtime && !own.runtime ? ' (' + P.name(x.runtime) + ')' : ''),
                    filter: { domains: ['sensor'], dc: 'duration' },
                    onPick: function (v) { energyDev(P, key, { runtime: v || null }); } })]));
    c.appendChild(K.group({}, [
      P.entityRow({ label: 'Switched By', sub: 'A power button on its tile; its sheet shows the switch', sk: 'f:' + EN + ':control', value: own.control || null,
                    none: 'Automatic' + (x.control && !own.control ? ' (' + P.name(x.control) + ')' : ''),
                    filter: { domains: ['switch'] },
                    onPick: function (v) { energyDev(P, key, { control: v || null }); } })]));
    energyBacked(P, c, d, key);
    var rel = [];
    if (x.parent_name) rel.push(K.info({ label: 'Part Of', value: x.parent_name }));
    (x.children || []).forEach(function (k) {
      var y = devByKey(d, k);
      rel.push(K.nav({ label: 'Includes', value: y ? y.name : k, href: '#/features/energy/devices/' + encodeURIComponent(k) }));
    });
    if (rel.length) c.appendChild(K.group({ header: 'In Home Assistant’s Energy Settings' }, rel));
    if (x.extra) {
      c.appendChild(K.group({}, [K.button({ label: 'Remove Device', destructive: true, fk: 'energy:dev:rm', onClick: function () {
        var extra = ((d.options || {}).extra || []).filter(function (y) { return y.key !== key; });
        energySet(P, { extra: extra }).then(function (done) { if (done) P.back('#/features/energy/devices'); });
      } })]));
    }
  }
  function energyAdd(P, c, d) {
    var st = P.feat(EN), f = form(st, 'add', function () { return { name: '', power: null, stat: null }; });
    c.appendChild(K.group({ footer: 'A power sensor gives its tile live watts; an energy meter gives its kWh today and its daily bars. Either will do.' }, [
      K.text({ label: 'Name', sk: 'f:' + EN + ':extra', value: f.name, placeholder: 'Network Rack', maxlength: 40,
               error: P.err('f:' + EN + ':extra'), onCommit: function (v) { f.name = v; } }),
      P.entityRow({ label: 'Power Sensor', sk: 'energy-add-power', value: f.power, none: 'None',
                    filter: { domains: ['sensor'], dc: 'power' }, onPick: function (v) { f.power = v; P.render(); } }),
      P.entityRow({ label: 'Energy Meter', sk: 'energy-add-stat', value: f.stat, none: 'None',
                    filter: { domains: ['sensor'], dc: 'energy' }, onPick: function (v) { f.stat = v; P.render(); } })]));
    c.appendChild(K.group({}, [K.button({ label: 'Add Device', fk: 'energy:add:go', disabled: !(f.power || f.stat), onClick: function () {
      var inp = P.shadowRoot && P.shadowRoot.querySelector('[data-fk="f:' + EN + ':extra"]');
      var name = String((inp && inp.value) || f.name || '').trim();
      if (!name) { P.errors['f:' + EN + ':extra'] = 'Give it a name.'; P.render(); return; }
      var key = f.stat || f.power;
      var extra = ((d.options || {}).extra || []).filter(function (y) { return y.key !== key; })
        .concat([{ key: key, name: name, power: f.power || null, stat: f.stat || null }]);
      energySet(P, { extra: extra }).then(function (done) {
        if (!done) return;
        delete st.forms.add;
        P.go('#/features/energy/devices/' + encodeURIComponent(key));
      });
    } })]));
  }

  // THE BATTERIES AS STORED, from rows as shown (d.batteries, resolved):
  // only what the house set itself -- a battery already in the stored list
  // keeps its own entry; one taken from Automatic is just its entity, and
  // the house battery's flag (the plan's own, else its automatic glyph).
  // Never the resolved name, label, suffix or glyph: pinned, they outlived
  // the choice that made them (The House Battery off kept the house glyph,
  // and the next save turned it back on).
  var HOUSE_GLYPH = 'hk:home-battery-outline', BATTERY_GLYPH = 'hk:battery-high';
  function batteriesStored(d, list) {
    var own = {};
    var o = (d && d.options) || {};
    (Array.isArray(o.batteries) ? o.batteries : []).forEach(function (b) { if (b && b.entity) own[b.entity] = b; });
    return list.filter(Boolean).map(function (b) {
      var key = b.entity || b.key;
      if (own[key]) return Object.assign({}, own[key]);
      var y = { entity: key };
      if (b.house === true || (b.house === undefined && b.icon === HOUSE_GLYPH)) y.house = true;
      return y;
    });
  }
  function energyBatteries(P, c, d) {
    var o = d.options || {};
    var auto = !Array.isArray(o.batteries);
    var bats = d.batteries || [];
    var asStored = function (list) { return batteriesStored(d, list); };
    c.appendChild(K.listEditor({ fk: 'enbat', auto: auto, minRows: 0, announce: P.announce.bind(P),
      autoFooter: 'Automatic: the house battery’s level (Home Assistant’s Energy settings) and every car’s — a battery level on a device that also reports a range.',
      shownFooter: 'Their level, colored by it, in the Charging section (or where Sections places them).',
      rows: bats.map(function (b) {
        return { value: b.key, label: b.name, sub: b.label ? 'With ' + enName(P, b.label) : b.key,
                 href: auto ? null : '#/features/energy/batteries/' + encodeURIComponent(b.key) };
      }),
      onAuto: function (on) { energySet(P, { batteries: on ? null : asStored(bats) }); },
      onChange: function (v) {
        energySet(P, { batteries: asStored(v.map(function (k) { return bats.filter(function (b) { return b.key === k; })[0]; })) });
      },
      addLabel: 'Add Battery',
      onAddOther: function () {
        P.go(P.picker('energy-battery', { title: 'Add Battery', value: null, items: function () {
          return P.entityIds({ domains: ['sensor'], dc: 'battery', shown: true })
            .map(function (id) { return { value: id, label: P.name(id), sub: id }; });
        }, onPick: function (v) { if (v) energySet(P, { batteries: asStored(bats).concat([{ entity: v }]) }); } }));
      } }));
  }
  function energyBattery(P, c, d, key) {
    var o = d.options || {};
    var list = Array.isArray(o.batteries) ? o.batteries.slice() : [];
    var i = -1;
    list.forEach(function (b, j) { if (b.entity === key) i = j; });
    var shown = (d.batteries || []).filter(function (b) { return b.key === key; })[0];
    if (i < 0 || !shown) { c.appendChild(K.group({ footer: 'That battery isn’t listed any more.' }, [])); return; }
    var b = list[i];
    var put = function (ch) {
      list[i] = Object.assign({}, b, ch);
      Object.keys(list[i]).forEach(function (k) { if (list[i][k] === '' || list[i][k] == null) delete list[i][k]; });
      energySet(P, { batteries: list });
    };
    c.appendChild(K.group({}, [
      K.text({ label: 'Name', sk: 'f:' + EN + ':bat:name', value: b.name || '', placeholder: shown.name, maxlength: 40,
               onCommit: function (v) { put({ name: v.trim() }); } }),
      P.entityRow({ label: 'Under Its Name', sub: 'A range, or the energy stored', sk: 'f:' + EN + ':bat:label',
                    value: b.label || null, none: shown.label && !b.label ? 'Automatic (' + P.name(shown.label) + ')' : 'Nothing',
                    filter: { domains: ['sensor'] }, onPick: function (v) { put({ label: v || '' }); } }),
      K.text({ label: 'After It', sk: 'f:' + EN + ':bat:suffix', value: b.label_suffix != null ? b.label_suffix : '',
               placeholder: shown.label_suffix || ' mi range', maxlength: 40, onCommit: function (v) { put({ label_suffix: v }); } }),
      K.toggle({ label: 'The House Battery', sub: 'Its glyph is the house’s', on: !!b.house, sk: 'f:' + EN + ':bat:house',
                 // a default glyph saved by an older page goes with it, or
                 // the house's glyph would stay after turning this off
                 onChange: function (on) {
                   put({ house: on || null, icon: b.icon === HOUSE_GLYPH || b.icon === BATTERY_GLYPH ? null : b.icon });
                 } })]));
  }

  // ---- THE POWER PAGE (features/energy/power.py): the Energy feature's
  // second page, right now and the controls. Every reading Automatic until
  // chosen; the battery's own controls as named. Stored whole as the
  // feature's `power` option.
  function powerOf(d) { var o = (d.options || {}).power; return o && typeof o === 'object' ? o : null; }
  function powerSet(P, d, changes) {
    var cur = powerOf(d) || {}, next = Object.assign({}, cur);
    Object.keys(changes).forEach(function (k) {
      var v = changes[k];
      if (v === null || v === '' || v === undefined) delete next[k]; else next[k] = v;
    });
    return energySet(P, { power: next });
  }
  function energyPower(P, c, d) {
    var o = powerOf(d), pl = (d.plan || {}).power || null;
    var on = !!o && o.on !== false;
    c.appendChild(K.group({ footer: 'Right now and the controls: the whole house, the grid, the sun, the house battery and its own controls, the cars, ' +
        'and every device marked when the battery backs it up. The Energy page is the same devices over time.' }, [
      K.toggle({ label: 'Show the Power Page', on: on, sk: 'f:' + EN + ':power:on',
                 onChange: function (v) { powerSet(P, d, { on: v ? null : false }); } })]));
    if (!on) return;
    var B = o.battery || {};
    var bat = function (k, v) { var b = Object.assign({}, B); if (v) b[k] = v; else delete b[k]; return powerSet(P, d, { battery: Object.keys(b).length ? b : null }); };
    var auto = function (cur) { return 'Automatic' + (cur ? ' (' + enName(P, cur) + ')' : ''); };
    var PWR = { domains: ['sensor'], dc: 'power' };
    c.appendChild(K.group({ header: 'The Page' }, [
      K.text({ label: 'Title', sk: 'f:' + EN + ':power:title', value: o.title || '', placeholder: 'Power', maxlength: 40,
               onCommit: function (v) { powerSet(P, d, { title: v.trim() || null }); } }),
      K.text({ label: 'Picture Folder', sk: 'f:' + EN + ':power:art', value: o.art || '', placeholder: 'Built In',
               sub: 'Your own house: a folder of your files with art.json and its layers, e.g. /hk/art/my-house/. Empty: the house that comes with ' + PN(), error: P.err('f:' + EN + ':power:art'),
               onCommit: function (v) { v = v.trim(); if (v && v.charAt(0) !== '/') v = '/' + v; if (v && v.slice(-1) !== '/') v += '/'; powerSet(P, d, { art: v || null }); } })]
      .concat([K.select({ label: 'Picture', sk: 'f:' + EN + ':power:picture', value: o.picture || 'house',
                 options: [['house', 'The House'], ['chart', 'A Flow Chart']], onChange: function (v) { powerSet(P, d, { picture: v === 'house' ? null : v }); } })])
      .concat([
      K.select({ label: 'Devices', sk: 'f:' + EN + ':power:groups', value: o.groups || 'type',
                 options: [['type', 'By Type'], ['backup', 'Backed Up First']], onChange: function (v) { powerSet(P, d, { groups: v === 'type' ? null : v }); } }),
      K.info({ label: 'Address', sub: 'Screens show it where they list it', value: '/' + ((pl && pl.path) || 'power') })])));
    var row = function (label, sub, key, filter, cur) {
      return P.entityRow({ label: label, sub: sub, sk: 'f:' + EN + ':power:' + key, value: o[key] || null, none: auto(cur), filter: filter,
                           onPick: function (v) { var ch = {}; ch[key] = v || null; powerSet(P, d, ch); } });
    };
    c.appendChild(K.group({ header: 'Readings', footer: 'Whole House is everything the house uses: the main meter, never a battery panel’s own output.' }, [
      row('Whole House', 'Power', 'home', PWR, pl && pl.home),
      row('The Grid', 'Power in; negative is out', 'grid', PWR, pl && pl.grid),
      row('To the Grid', 'Only with a sensor of its own', 'grid_export', PWR, null),
      row('Grid Up', 'On while the grid is up', 'grid_status', { domains: ['binary_sensor'] }, null),
      row('The Sun', 'Power', 'solar', PWR, pl && pl.solar),
      row('Battery Panel Output', 'What the battery’s circuits draw', 'backed_power', PWR, null)]));
    var brow = function (label, k, filter) {
      return P.entityRow({ label: label, sk: 'f:' + EN + ':power:battery:' + k, value: B[k] || null, none: 'None', filter: filter,
                           onPick: function (v) { bat(k, v || null); } });
    };
    var NUM = { domains: ['number', 'input_number', 'sensor'] }, SW = { domains: ['switch', 'binary_sensor'] };
    c.appendChild(K.group({ header: 'House Battery', footer: 'Its level, its power in and out, and what it says about itself. Without a level the page has no battery.' }, [
      brow('Level', 'level', { domains: ['sensor'], dc: 'battery' }), brow('Charging', 'charge', PWR), brow('Giving', 'discharge', PWR),
      brow('Reserve', 'reserve', NUM), brow('Charge Limit', 'limit', NUM), brow('Stored Energy', 'stored', { domains: ['sensor'] }),
      brow('Backup Time', 'backup', { domains: ['sensor'] }), brow('Charging Speed', 'speed', NUM), brow('EPS', 'eps', SW),
      brow('Storm Mode', 'storm', SW), brow('Fault', 'problem', { domains: ['binary_sensor'] }),
      K.select({ label: 'Backs Up', sk: 'f:' + EN + ':power:backs_up', value: o.backs_up || '',
                 options: [['', 'Automatic' + (pl ? ' (' + ({ some: 'Some Circuits', all: 'The Whole House', none: 'Nothing' })[pl.backs_up] + ')' : '')],
                           ['some', 'Some Circuits'], ['all', 'The Whole House'], ['none', 'Nothing']],
                 onChange: function (v) { powerSet(P, d, { backs_up: v || null }); } })]));
    var mode = o.mode || null;
    c.appendChild(K.group({ header: 'Battery Controls', footer: 'Its mode as the page’s choice, with what each one does; its levels as sliders. Each device’s own page says whether the battery backs it up.' }, [
      P.entityRow({ label: 'Mode', sk: 'f:' + EN + ':power:mode', value: mode ? mode.entity : null, none: 'None', filter: { domains: ['select', 'input_select'] },
                    onPick: function (v) { powerSet(P, d, { mode: v ? Object.assign({}, mode && mode.entity === v ? mode : {}, { entity: v }) : null }); } }),
      K.info({ label: 'Its Choices', value: mode && mode.options ? String(mode.options.length) : 'The select’s own' })]));
    // ITS LEVELS: a slider each (a number the battery takes: its reserve for
    // backup, a charge limit, a discharge floor), in the order added
    var lv = o.levels || [], lsk = 'f:' + EN + ':power:levels';
    var lvRows = lv.map(function (x) {
      return K.check({ label: x.name || P.name(x.entity), sub: x.entity + ' · tap to remove', multi: true, on: true, fk: lsk + ':' + x.entity,
                       onClick: function () { var left = lv.filter(function (y) { return y.entity !== x.entity; }); powerSet(P, d, { levels: left.length ? left : null }); } });
    });
    lvRows.push(K.nav({ label: 'Add…', icon: 'mdi:plus-circle-outline', fk: lsk + ':add',
      href: P.picker('power-levels', { title: 'Battery Levels', value: null, multi: true,
        items: function () {
          var have = lv.map(function (x) { return x.entity; });
          return P.entityIds({ domains: ['number', 'input_number'], shown: true }).filter(function (id) { return have.indexOf(id) < 0; })
            .map(function (id) { return { value: id, label: P.name(id), sub: id }; });
        },
        onPick: function (v) {
          var have = lv.map(function (x) { return x.entity; });
          var add = [].concat(v || []).filter(function (id) { return have.indexOf(id) < 0; }).map(function (id) { return { entity: id }; });
          if (add.length) powerSet(P, d, { levels: lv.concat(add) });
        } }) }));
    c.appendChild(K.group({ header: 'Battery Levels', footer: 'Sliders on the page for the numbers the battery takes, such as its backup reserve or charge limit.' }, lvRows));
    // EACH CAR: its name (blank: its integration's) and what reads its
    // charging -- Automatic, a Wall Connector or a monitored circuit, or the
    // car's own reading
    var cars = (pl && pl.cars) || [], CO = o.car_opts || {};
    var carSet = function (lvl, k, v) {
      var all = Object.assign({}, CO), one = Object.assign({}, all[lvl] || {});
      if (v) one[k] = v; else delete one[k];
      if (Object.keys(one).length) all[lvl] = one; else delete all[lvl];
      return powerSet(P, d, { car_opts: Object.keys(all).length ? all : null });
    };
    if (!cars.length) c.appendChild(K.group({ header: 'Cars' }, [K.info({ label: 'No cars found' })]));
    cars.forEach(function (k, i) {
      var co = CO[k.level] || {}, found = k.found_name || k.name || P.name(k.level), cur = co.charger || null;
      var sk = 'f:' + EN + ':power:car:' + i;
      var href = P.picker(sk + ':charger', { title: 'Charging Power', value: cur, none: 'Automatic',
        items: function () {
          return (k.power ? [{ value: 'car', label: 'The Car’s Own Reading', sub: P.name(k.power) }] : [])
            .concat(P.entityIds(PWR).map(function (id) { return { value: id, label: P.name(id), sub: id }; }));
        },
        onPick: function (v) { carSet(k.level, 'charger', v || null); } });
      var val = cur === 'car' ? 'The Car’s Own Reading' : cur ? (P.client.states[cur] ? P.name(cur) : cur + ' (missing)') : 'Automatic';
      var where = k.home && P.client && P.client.states[k.home] ? (P.client.states[k.home].state === 'home' ? 'Home' : 'Away') : '';
      c.appendChild(K.group({ header: co.name || found, footer: i < cars.length - 1 ? null :
          'Name: blank is the name its integration gives it. Charging Power: what reads its charging. Automatic shares the chargers’ watts among the cars that say they are ' +
          'charging, so with two cars charging it can guess wrong; choose its charger, the circuit it charges on, or its own reading (minutes behind) to know.' }, [
        K.text({ label: 'Name', sk: sk + ':name', value: co.name || '', placeholder: found, maxlength: 40,
                 onCommit: function (v) { carSet(k.level, 'name', v.trim() || null); } }),
        P.withError(K.nav({ label: 'Charging Power', value: val, href: href, sk: sk + ':charger' }), sk + ':charger'),
        K.info({ label: 'Found', sub: [k.home ? 'location' : null, k.plugged ? 'cable' : null, k.charge ? 'charge switch' : null, k.power ? 'its own charging power' : null].filter(Boolean).join(', ') || 'its level',
                 value: where })]));
    });
  }
  // a device's Backed Up row (its own page): Automatic says why
  function energyBacked(P, c, d, key) {
    var o = powerOf(d), pl = (d.plan || {}).power;
    if (!o || o.on === false || !pl || pl.backs_up !== 'some') return;
    var it = null;
    (pl.sections || []).forEach(function (s) { (s.items || []).forEach(function (i) { if (i.key === key) it = i; }); });
    var own = (o.backed || {})[key];
    var autoText = it && it.why !== 'chosen' ? (it.backed ? 'Yes: ' + it.why : 'No') : 'Automatic';
    c.appendChild(K.group({ header: 'On the Power Page', footer: 'Automatic is Yes when its power sensor or switch is on the battery’s device, its switch is a group of the battery’s circuits, or it sits inside a backed-up circuit. Choose Yes or No where Home Assistant can’t tell (a plug on a backed-up circuit).' }, [
      K.select({ label: 'Backed Up', sk: 'f:' + EN + ':power:backed', value: own === true ? 'yes' : own === false ? 'no' : '',
                 options: [['', own === undefined ? autoText : 'Automatic'], ['yes', 'Yes'], ['no', 'No']],
                 onChange: function (v) {
                   var b = Object.assign({}, o.backed || {});
                   if (v === 'yes') b[key] = true; else if (v === 'no') b[key] = false; else delete b[key];
                   powerSet(P, d, { backed: Object.keys(b).length ? b : null });
                 } })]));
  }

  function energyPage(P, sub, mk, withData, name, domain) {
    var back = ['Energy', '#/page/energy'];
    var d0 = P.feat(domain).data || {};
    if (sub[0] === 'top') return mk('Readings', withData(function (c, d) { energyTop(P, c, d); }), back);
    if (sub[0] === 'rings') return mk('Rings', withData(function (c, d) { energyRings(P, c, d); }), back);
    if (sub[0] === 'power') return mk('Power Page', withData(function (c, d) { energyPower(P, c, d); }), back);
    if (sub[0] === 'usages' && sub[1] !== undefined) {
      return mk('Tracked', withData(function (c, d) { energyUsage(P, c, d, Number(sub[1])); }), ['Tracking', '#/features/energy/usages']);
    }
    if (sub[0] === 'usages') return mk('Tracking', withData(function (c, d) { energyUsages(P, c, d); }), back);
    if (sub[0] === 'sections' && sub[1]) {
      var sid = decodeURIComponent(sub[1]);
      var ss = (d0.sections || []).filter(function (x) { return x.id === sid; })[0];
      return mk(ss ? ss.name : 'Section', withData(function (c, d) { energySection(P, c, d, sid); }), ['Sections', '#/features/energy/sections']);
    }
    if (sub[0] === 'sections') return mk('Sections', withData(function (c, d) { energySections(P, c, d); }), back);
    if (sub[0] === 'devices' && sub[1]) {
      var key = decodeURIComponent(sub[1]);
      var dv = devByKey(d0, key);
      return mk(dv ? dv.name : 'Device', withData(function (c, d) { energyDevice(P, c, d, key); }), ['Devices', '#/features/energy/devices']);
    }
    if (sub[0] === 'devices') return mk('Devices', withData(function (c, d) { energyDevices(P, c, d); }), back);
    if (sub[0] === 'add') return mk('Add Device', withData(function (c, d) { energyAdd(P, c, d); }), ['Devices', '#/features/energy/devices']);
    if (sub[0] === 'batteries' && sub[1]) {
      var bk = decodeURIComponent(sub[1]);
      return mk('Battery', withData(function (c, d) { energyBattery(P, c, d, bk); }), ['Batteries', '#/features/energy/batteries']);
    }
    if (sub[0] === 'batteries') return mk('Batteries', withData(function (c, d) { energyBatteries(P, c, d); }), back);
    return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { energyMain(P, c, d); }) };
  }

  // ---- NOTIFICATIONS (features/notifications): the list, each one, the
  // screens that allow them, Do Not Disturb
  var NT = 'hk_notify';
  var STAY_WORDS = { 0: 'Until Dismissed', 10: '10 s', 30: '30 s', 60: '1 Minute', 120: '2 Minutes', 300: '5 Minutes' };
  function stayLabel(v) { return STAY_WORDS[v] || (v + ' s'); }
  var COOL_WORDS = { 0: 'Every Time', 60: '1 Minute', 300: '5 Minutes', 900: '15 Minutes', 3600: '1 Hour' };
  function cooldownLabel(v) { return COOL_WORDS[v] || (v + ' s'); }
  var ONLY_WORDS = { always: 'Always', home: 'Someone Is Home', away: 'Nobody Is Home', night: 'At Night' };
  var TAP_WORDS = { camera: 'Live Camera', sheet: 'Accessory Sheet', none: 'Nothing' };
  function notifyItemOf(d, id) { return ((d && d.items) || []).filter(function (x) { return x.id === id; })[0] || null; }
  function notifyTitle(it) { return (it.title || '').trim() || it.auto_title || it.name || it.entity; }
  function choiceWord(it) {
    var c = (it.choices || []).filter(function (x) { return x[0] === it.when; })[0];
    return c ? c[1] : it.when;
  }
  // under each one in the list: what sets it off, and what it carries
  // o: All Notifications' (a notification that follows its Wakes the Screen)
  function wakesOf(it, o) { return typeof it.wake === 'boolean' ? it.wake : !!(o && o.wake); }
  function notifySummary(it, o) {
    var out = [choiceWord(it)];
    if (it.snap && it.camera) out.push('with a snapshot');
    if (it.important) out.push('Important');
    if (wakesOf(it, o)) out.push('wakes the screen');
    if (it.only && it.only !== 'always') out.push(ONLY_WORDS[it.only] || it.only);
    if (it.missing) out.push('the accessory is missing');
    return out.join(' · ');
  }
  // Goes Off When: tabs for a few short choices, else a drop-down
  function whenControl(choices) {
    var words = (choices || []).map(function (c) { return c[1]; }).join('');
    return (choices || []).length <= 3 && words.length <= 30 ? 'seg' : 'select';
  }
  function dndSummary(dnd) {
    if (!dnd) return 'Off';
    var bits = [];
    if (dnd.schedule) bits.push(dnd.from === dnd.to ? 'All Day' : hm(dnd.from) + '–' + hm(dnd.to));
    var w = (dnd['while'] || []).length;
    if (w) bits.push('while ' + (w === 1 ? '1 is on' : w + ' are on'));
    return bits.length ? bits.join(', ') : 'Off';
  }
  function hm(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
    if (!m) return String(v || '');
    var h = +m[1], ap = h < 12 ? 'AM' : 'PM';
    return ((h % 12) || 12) + ':' + m[2] + ' ' + ap;
  }
  // DO NOT DISTURB's rows, for All Screens and a screen's own: Scheduled,
  // From, To, and While (entities: on is quiet -- an input_boolean, a timer
  // while it runs). save(dnd) writes the whole thing.
  var DND_DOMAINS = ['input_boolean', 'timer', 'switch', 'binary_sensor', 'media_player', 'schedule'];
  function dndRows(P, dnd, save, sk) {
    dnd = dnd || { schedule: false, from: '22:00', to: '07:00', 'while': [] };
    var put = function (ch) { save(Object.assign({}, dnd, ch)); };
    var rows = [K.toggle({ label: 'Scheduled', sub: 'Every day, at these times', on: !!dnd.schedule, sk: sk + ':schedule',
                           onChange: function (on) { put({ schedule: on }); } })];
    if (dnd.schedule) {
      rows.push(K.text({ label: 'From', type: 'time', value: dnd.from, sk: sk + ':from', error: P.err(sk),
                         onCommit: function (v) { if (v) put({ from: v.slice(0, 5) }); } }));
      rows.push(K.text({ label: 'To', type: 'time', value: dnd.to, sk: sk + ':to',
                         onCommit: function (v) { if (v) put({ to: v.slice(0, 5) }); } }));
    }
    var w = dnd['while'] || [];
    var whileRows = w.map(function (id) {
      return K.check({ label: P.name(id), sub: id + ' · tap to remove', multi: true, on: true, fk: sk + ':while:' + id,
                       onClick: function () { put({ 'while': w.filter(function (x) { return x !== id; }) }); } });
    });
    whileRows.push(K.nav({ label: 'Add…', icon: 'mdi:plus-circle-outline', fk: sk + ':while:add',
      href: P.picker(sk + '-while', { title: 'While This Is On', value: null, multi: true,
        items: function () {
          return P.entityIds({ domains: DND_DOMAINS, shown: true }).filter(function (id) { return w.indexOf(id) < 0; })
            .map(function (id) { return { value: id, label: P.name(id), sub: id }; });
        },
        onPick: function (v) {
          var add = [].concat(v || []).filter(function (id) { return w.indexOf(id) < 0; });
          if (add.length) { w = w.concat(add); put({ 'while': w }); }
        } }) }));
    return { rows: rows, whileRows: whileRows };
  }
  function notifySet(P, changes) { return P.featSet(NT, changes); }
  function notifySave(P, id, changes, keys) {
    return P.featCall(NT, { type: 'hk_notify/item/save', item: id, changes: changes }, keys || Object.keys(changes));
  }
  function notifyMain(P, c, d) {
    var o = d.options || {}, items = (d.items || []).filter(function (it) { return !it.category; });
    var cats = d.categories || [];
    if (cats.length) {
      c.appendChild(K.group({ header: 'Categories', footer: 'Found from your accessories, and any you add later. Turn one on to be notified for all of them alike — then leave out any you don’t want.' },
        cats.map(function (ct) {
          var it = ct.item ? notifyItemOf(d, ct.item) : null;
          var n = ct.accessories.length, left = it ? n - ct.accessories.filter(function (a) { return (it.exclude || []).indexOf(a.entity) >= 0; }).length : 0;
          return K.nav({ label: ct.label, sub: it ? notifySummary(it, o) : null, value: it ? left + ' of ' + n : 'Off',
                         tile: [ct.icon, ct.tint], href: '#/features/notify/c/' + encodeURIComponent(ct.key), fk: 'notify:cat:' + ct.key });
        })));
    }
    var rows = items.map(function (it) {
      return K.nav({ label: notifyTitle(it), sub: notifySummary(it, o), href: '#/features/notify/' + encodeURIComponent(it.id),
                     tile: [it.icon || 'hk:bell', it.tint || '#8e8e93'], fk: 'notify:item:' + it.id });
    });
    rows.push(K.nav({ label: 'Add Notification', icon: 'mdi:plus-circle-outline', href: '#/features/notify/new', fk: 'notify:add' }));
    c.appendChild(K.group({ header: cats.length ? 'One Accessory' : 'Notifications', footer: items.length
      ? 'Each goes off when its accessory does — once for the whole house — on every screen that allows notifications.'
      : 'Pick an accessory: a door, a lock, a person, a camera’s motion or the doorbell. A banner shows at the top of the screens when it goes off.' }, rows));
    // HK Frontend's screens only (a dashboard of Home Assistant's own has no board)
    var boards = (P.data && P.data.boards) || {};
    var dash = ((P.data && P.data.dashboards) || []).filter(function (x) { return boards[x.path]; });
    var allow = dash.filter(function (x) { return (boards[x.path] || {}).notify !== false; }).length;
    c.appendChild(K.group({ header: 'Where They Show', footer: 'A notification set to Wakes the Screen wakes a screen from its screensaver or its Sleep Screen whatever these say. Each screen can choose its own in its Behavior.' }, [
      K.nav({ label: 'Screens', value: allow + ' of ' + dash.length, href: '#/features/notify/screens', fk: 'notify:screens' }),
      K.seg({ label: 'On the Screensaver', sub: o.saver === 'important' ? 'Only the Important ones show over the photos' : o.saver === 'off' ? 'None show over the photos' : 'Every one shows over the photos',
              value: o.saver, sk: 'f:' + NT + ':saver', options: [['all', 'All'], ['important', 'Important'], ['off', 'Off']],
              onChange: function (v) { notifySet(P, { saver: v }); } }),
      K.nav({ label: 'Do Not Disturb', value: dndSummary(o.dnd), href: '#/features/notify/dnd', fk: 'notify:dnd' })]));
    c.appendChild(K.group({ header: 'Banner', footer: 'Each banner slides away by itself after Stays On Screen; each notification can stay longer, shorter or until dismissed. Swipe one away any time, or Clear All when there are several.' }, [
      K.select({ label: 'Stays On Screen', value: String(o.stay), sk: 'f:' + NT + ':stay',
                 options: (d.limits && d.limits.stays || [10, 30, 60, 120, 300]).map(function (v) { return [String(v), stayLabel(v)]; }),
                 onChange: function (v) { notifySet(P, { stay: Number(v) }); } }),
      K.toggle({ label: 'Wakes the Screen', sub: 'From its Sleep Screen, up to its screensaver, the banner over the photos. Each notification can choose its own.',
                 on: !!o.wake, sk: 'f:' + NT + ':wake', onChange: function (on) { notifySet(P, { wake: on }); } }),
      K.toggle({ label: 'Chime', sub: o.chime !== false ? 'Wall tablets and computers play a soft chime; an Important one plays it twice'
                   : 'Off: only an Important one chimes', on: o.chime !== false,
                 sk: 'f:' + NT + ':chime', onChange: function (on) { notifySet(P, { chime: on }); } })]));
  }
  function notifyNew(P, c, d) {
    void d;
    c.appendChild(K.group({ footer: 'What it can go off for, its words and its camera are suggested from the accessory; change any of them next.' }, [
      P.entityRow({ label: 'Accessory', sk: 'f:' + NT + ':entity', value: null, none: 'Choose…', title: 'Notify When',
        filter: { domains: ['binary_sensor', 'event', 'person', 'lock', 'cover', 'alarm_control_panel', 'input_boolean',
                            'switch', 'timer', 'sensor', 'light', 'fan', 'vacuum'], shown: true },
        onPick: function (v) {
          if (!v) return;
          P.featCall(NT, { type: 'hk_notify/item/save', changes: { entity: v } }, ['entity']).then(function (ok) {
            var st = P.feat(NT);
            if (ok && st.data && st.data.saved) P.go('#/features/notify/' + encodeURIComponent(st.data.saved));
          });
        } })]));
  }
  // THE PAGES a notification can open or go to: the generated dashboards'
  // own -- the category pages and a page per room (hk-strategy.js) -- by
  // path, the same on every screen that has them
  var NOTIFY_PAGES = [['security', 'Security'], ['doors-windows', 'Doors & Windows'], ['lights', 'Lights'], ['climate', 'Climate'],
                      ['water', 'Water'], ['cameras', 'Cameras'], ['calendar', 'Calendar'], ['vacuums', 'Vacuums'], ['timers', 'Timers']];
  function notifyPages(P) {
    var areas = (P.client && P.client.areas) || {};
    var slug = function (v) { return String(v || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    var rooms = Object.keys(areas).map(function (k) { return ['room-' + slug(k), areas[k].name || k]; })
      .sort(function (a, b) { return a[1].localeCompare(b[1]); });
    return NOTIFY_PAGES.concat(rooms);
  }
  function notifyClock(ts) {
    try { return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function notifyItem(P, c, d, id) {
    var it = notifyItemOf(d, id);
    if (!it) { c.appendChild(K.group({}, [K.info({ label: 'That notification isn’t there any more.' })])); return; }
    var save = function (ch) { return notifySave(P, id, ch); };
    var sk = function (k) { return 'f:' + NT + ':' + k; };
    var whenOpts = (it.choices || []).map(function (x) { return [x[0], x[1]]; });
    var when = whenOpts.length === 1 ? K.info({ label: 'Goes Off When', value: whenOpts[0][1] })
      : whenControl(it.choices) === 'seg'
        ? K.seg({ label: 'Goes Off When', value: it.when, sk: sk('when'), options: whenOpts, onChange: function (v) { save({ when: v }); } })
        : K.select({ label: 'Goes Off When', value: it.when, sk: sk('when'), options: whenOpts, onChange: function (v) { save({ when: v }); } });
    c.appendChild(K.group({ header: 'When', footer: it.missing ? 'The accessory isn’t in Home Assistant right now; this goes off again once it is.'
        : it.kind === 'calendar' ? 'Each event notifies once. All-Day Events: the morning one starts, at that time.'
        : 'Not Again For: a camera that sees someone for a minute sends one notification, not twenty.' }, [
      it.category ? null : P.entityRow({ label: 'Accessory', sk: sk('entity'), value: it.entity, title: 'Notify When',
        filter: { domains: ['binary_sensor', 'event', 'person', 'lock', 'cover', 'alarm_control_panel', 'input_boolean',
                            'switch', 'timer', 'sensor', 'light', 'fan', 'vacuum'], shown: true },
        onPick: function (v) { if (v) save({ entity: v }); } }),
      when,
      K.select({ label: 'Only When', value: it.only || 'always', sk: sk('only'),
                 options: Object.keys(ONLY_WORDS).map(function (k) { return [k, ONLY_WORDS[k]]; }), onChange: function (v) { save({ only: v }); } }),
      it.kind === 'calendar' ? K.select({ label: 'All-Day Events', value: it.allday || '', sk: sk('allday'),
        options: [['', 'Off'], ['06:00', '6:00 AM'], ['07:00', '7:00 AM'], ['08:00', '8:00 AM'], ['09:00', '9:00 AM'], ['10:00', '10:00 AM']],
        onChange: function (v) { save({ allday: v || null }); } }) :
      K.select({ label: 'Not Again For', value: String(it.cooldown || 0), sk: sk('cooldown'),
                 options: Object.keys(COOL_WORDS).map(function (k) { return [k, COOL_WORDS[k]]; }), onChange: function (v) { save({ cooldown: Number(v) }); } })]));
    var o = (d.options || {});
    var stays = [['', 'Default (' + stayLabel(o.stay) + ')', stayLabel(o.stay)]].concat(
      [10, 30, 60, 120, 300, 0].map(function (v) { return [String(v), stayLabel(v)]; }));
    var banner = [
      K.text({ label: 'Title', value: it.title || '', placeholder: it.auto_title || '', sk: sk('title'), maxlength: (d.limits || {}).title || 40,
               error: P.err(sk('title')), onCommit: function (v) { save({ title: v }); } }),
      K.text({ label: 'Message', value: it.message || '', placeholder: it.auto_message || '', sk: sk('message'), maxlength: (d.limits || {}).message || 120,
               error: P.err(sk('message')), onCommit: function (v) { save({ message: v }); } }),
      K.select({ label: 'Stays On Screen', sub: it.stay === null || it.stay === undefined ? 'Same as All Notifications' : 'Just This Notification',
                 value: it.stay === null || it.stay === undefined ? '' : String(it.stay), sk: sk('stay'), options: stays,
                 onChange: function (v) { save({ stay: v === '' ? null : Number(v) }); } }),
      K.toggle({ label: 'Important', sub: 'Outlined red; gets through Do Not Disturb, always chimes, and shows on a screensaver set to Important', on: !!it.important,
                 sk: sk('important'), onChange: function (on) { save({ important: on }); } })];
    // WAKES THE SCREEN: All Notifications', or its own (Do Not Disturb still
    // holds back one that isn't Important)
    var hw = o.wake ? 'On' : 'Off', own = typeof it.wake === 'boolean';
    banner.push(K.select({ label: 'Wakes the Screen', sub: own ? 'Just This Notification' : 'Same as All Notifications',
      value: own ? (it.wake ? 'on' : 'off') : '', sk: sk('wake'),
      options: [['', 'Default (' + hw + ')', hw], ['on', 'On'], ['off', 'Off']],
      onChange: function (v) { save({ wake: v === '' ? null : v === 'on' }); } }));
    // A CALENDAR'S: an event, not an accessory -- no pop-up, no snapshot, nothing to open
    var cal = it.kind === 'calendar';
    c.appendChild(K.group({ header: 'Banner', footer: cal ? 'Empty Title and Message: the event’s name, then when and where it is (“In 15 minutes · 10:30 – 11:00 AM · the place”). An all-day one: “Today · All Day”.'
      : 'Empty Title and Message: the accessory’s name and what it just did, as shown in gray.' }, banner));
    var pops = ((P.data && P.data.popups) || []).map(function (p) { return p.hash; }).filter(Boolean);
    if (it.pop && pops.indexOf(it.pop) < 0) pops.push(it.pop);
    if (!cal) c.appendChild(K.group({ header: 'Where', footer: it.pop
      ? 'A screen that opens the #' + it.pop + ' pop-up for it shows the pop-up alone; screens without it (a phone, a computer) show the banner.'
      : 'For the doorbell: its pop-up on the wall tablets, the banner everywhere else.' }, [
      K.select({ label: 'Not Where a Pop-up Shows', value: it.pop || '', sk: sk('pop'),
                 options: [['', 'None']].concat(pops.map(function (hh) { return [hh, '#' + hh]; })),
                 onChange: function (v) { save({ pop: v || null }); } })]));
    // NO CAMERA OF ITS OWN (a washer): turning the snapshot on chooses one
    // first -- the snapshot and its camera are saved together (registered as
    // the page draws: the picker's page finds it there)
    var firstCam = !it.snap && !it.camera && !it.suggested_camera && !it.category
      ? P.picker(sk('camera') + ':first', { title: 'Snapshot From', value: null,
          items: function () {
            return P.entityIds({ domains: ['camera'], shown: true })
              .map(function (id) { return { value: id, label: P.name(id), sub: id }; });
          },
          onPick: function (v) { if (v) save({ snap: true, camera: v }); } })
      : null;
    var snapRows = [K.toggle({ label: 'Camera Snapshot', sub: 'Taken the moment it goes off', on: !!it.snap, sk: sk('snap'),
                               onChange: function (on) {
                                 if (on && firstCam) { P.go(firstCam); return; }
                                 save(on && !it.camera && it.suggested_camera ? { snap: true, camera: it.suggested_camera } : { snap: on });
                               } })];
    if (it.snap) {
      snapRows.push(P.entityRow({ label: 'Camera', sk: sk('camera'), value: it.camera, title: 'Snapshot From',
        none: it.category ? 'Each One’s Own Camera' : null,
        sub: it.category ? (it.camera ? 'One camera for all of them' : null)
          : it.camera && it.camera === it.suggested_camera ? 'The camera on the same device' : null,
        filter: { domains: ['camera'], shown: true },
        onPick: function (v) { if (v || it.category) save({ camera: v || null }); } }));
    }
    if (!cal) c.appendChild(K.group({ header: 'Snapshot', footer: it.snap ? 'Every screen shows the same picture: the moment it went off.'
      : 'Any notification can carry a snapshot — someone arriving can show the driveway.' }, snapRows));
    // OPENED: what a tap on the banner opens -- its sheet (the notification
    // at its top, the page it lives on, Mute 1 Hour), a page, the live
    // camera, nothing -- and where its sheet's Go To goes
    var pages = notifyPages(P);
    var pageOpts = function (cur) {
      var o2 = pages.slice();
      if (cur && !o2.some(function (x) { return x[0] === cur; })) o2.push([cur, cur]);
      return o2;
    };
    var tap = it.tap === 'camera' && !it.snap ? 'sheet' : (it.tap || 'sheet');
    var taps = [['sheet', cal ? 'The Event' : 'Its Sheet'], ['page', 'A Page'], ['camera', 'Live Camera'], ['none', 'Nothing']]
      .filter(function (x) { return x[0] !== 'camera' || it.snap; });
    var opened = [K.select({ label: 'Tap Opens', value: tap, sk: sk('tap'), options: taps,
      onChange: function (v) { save(v === 'page' ? { tap: 'page', page: it.page || pages[0][0] } : { tap: v }); } })];
    if (tap === 'page') {
      opened.push(K.select({ label: 'Page', value: it.page || '', sk: sk('page'), options: pageOpts(it.page),
        onChange: function (v) { save({ page: v }); } }));
    } else if (tap !== 'none') {
      opened.push(K.select({ label: 'Go To', sub: it.go ? null : (cal ? 'The Calendar, at that day' : 'The page it’s on, else its room'),
        value: it.go || '', sk: sk('go'),
        options: [['', 'Automatic'], ['none', 'None']].concat(pageOpts(it.go && it.go !== 'none' ? it.go : null)),
        onChange: function (v) { save({ go: v || null }); } }));
    }
    // MUTED from a sheet (Mute 1 Hour): until when, and Unmute
    (it.muted || []).forEach(function (m) {
      opened.push(K.button({ label: 'Muted until ' + notifyClock(m.until) + (it.category && m.name ? ' · ' + m.name : ''),
        sub: 'Unmute', fk: 'notify:unmute:' + m.key, onClick: function () {
          P.ws({ type: 'hk_notify/mute', key: m.key, minutes: 0 }).then(function (ok) { if (ok) P.featLoad(NT, true); });
        } }));
    });
    c.appendChild(K.group({ header: 'Opened', footer: tap === 'page' ? 'A tap on the banner opens that page of the screen’s own dashboard.'
      : tap === 'none' ? 'A tap does nothing; the banner just goes when its time is up, or with a swipe.'
      : 'A tap opens ' + (cal ? 'the event' : tap === 'camera' ? 'the camera, live,' : 'its sheet') + ' with the notification on it: when it went off, ' +
        'the snapshot, its page, and Mute 1 Hour (that accessory quiet on every screen for an hour).' }, opened));
    if (it.category) {
      c.appendChild(K.group({ footer: it.kind === 'calendar' ? 'Send Test shows the next event of its calendars (within a week) now, on every screen that allows notifications.'
        : 'Send Test shows it now — for one of its accessories — on every screen that allows notifications, as if it went off.' }, [
        K.button({ label: 'Send Test', fk: 'notify:test:' + id, onClick: function () {
          P.ws({ type: 'hk_notify/test', item: id }).then(function (ok) { if (ok) P.announce('Sent.'); });
        } })]));
      return;
    }
    c.appendChild(K.group({ footer: 'Send Test shows it now on every screen that allows notifications, as if it went off.' }, [
      K.button({ label: 'Send Test', fk: 'notify:test:' + id, onClick: function () {
        P.ws({ type: 'hk_notify/test', item: id }).then(function (ok) { if (ok) P.announce('Sent.'); });
      } }),
      K.button({ label: 'Delete Notification…', destructive: true, fk: 'notify:delete:' + id, onClick: function () {
        K.confirm(P.shadowRoot, { title: 'Delete “' + notifyTitle(it) + '”?', message: 'It won’t go off any more.', ok: 'Delete', destructive: true })
          .then(function (yes) {
            if (!yes) return;
            P.featCall(NT, { type: 'hk_notify/item/remove', item: id }).then(function (ok) { if (ok) P.back('#/features/notify'); });
          });
      } })]));
  }
  // A CATEGORY: one switch (on: one notification for all of them, as
  // features/notifications rules.CATEGORIES starts it), its accessories, then
  // the same settings as a single accessory's
  function notifyCategory(P, c, d, key) {
    var ct = (d.categories || []).filter(function (x) { return x.key === key; })[0];
    if (!ct) { c.appendChild(K.group({}, [K.info({ label: 'No accessories of this kind right now.' })])); return; }
    var it = ct.item ? notifyItemOf(d, ct.item) : null;
    var n = ct.accessories.length;
    var left = it ? ct.accessories.filter(function (a) {
      return key === 'cameras' ? a.on : (it.exclude || []).indexOf(a.entity) < 0;
    }).length : n;
    var rows = [K.toggle({ label: 'Notify', sub: it ? 'For ' + left + ' of ' + n : 'For all ' + n + ', alike', on: !!it, sk: 'f:' + NT + ':cat:' + key,
      onChange: function (on) {
        if (on) P.featCall(NT, { type: 'hk_notify/item/save', changes: { category: key } }, ['category']);
        else if (it) P.featCall(NT, { type: 'hk_notify/item/remove', item: it.id });
      } })];
    rows.push(K.nav({ label: key === 'cameras' ? 'Cameras' : key === 'calendars' ? 'Calendars' : 'Accessories', value: left + ' of ' + n,
                      href: '#/features/notify/c/' + encodeURIComponent(key) + '/accessories',
                      fk: 'notify:cat:acc:' + key }));
    c.appendChild(K.group({ footer: key === 'cameras' ? (it ? 'Each camera notifies when its trigger goes off — its own person, doorbell, motion or presence detection unless you choose another — with its own snapshot and live view.'
      : 'Each camera, with the sensor that sets it off and the camera its snapshot and live view come from.')
      : key === 'calendars' && it ? 'Each event of the ticked calendars notifies the chosen time before it starts — its name, when and where. A calendar added later is included, unless you leave it out.'
      : it ? 'Each banner names its own accessory. An accessory of this kind added later is included, unless you leave it out.'
      : ct.accessories.slice(0, 6).map(function (a) { return a.name; }).join(', ') + (n > 6 ? ' and ' + (n - 6) + ' more' : '') + '.' }, rows));
    if (it) notifyItem(P, c, d, it.id);
  }
  function notifyCategoryAccessories(P, c, d, key) {
    var ct = (d.categories || []).filter(function (x) { return x.key === key; })[0];
    if (!ct) return;
    var it = ct.item ? notifyItemOf(d, ct.item) : null;
    var ex = it ? (it.exclude || []) : [];
    var byArea = {};
    ct.accessories.forEach(function (a) { (byArea[a.area || 'No Room'] = byArea[a.area || 'No Room'] || []).push(a); });
    Object.keys(byArea).sort().forEach(function (area) {
      c.appendChild(K.group({ header: area }, byArea[area].map(function (a) {
        var on = ex.indexOf(a.entity) < 0;
        return K.check({ label: a.name, sub: a.note || a.entity, multi: true, on: on, disabled: !it, fk: 'notify:cat:' + key + ':' + a.entity,
          onClick: function () {
            if (!it) { P.announce('Turn the category on first.'); return; }
            var next = on ? ex.concat([a.entity]) : ex.filter(function (x) { return x !== a.entity; });
            notifySave(P, it.id, { exclude: next });
          } });
      })));
    });
    // an alarm and its PIN panel: one alarm (features/notifications members)
    var pinned = ct.accessories.filter(function (a) { return a.note && / with a PIN · /.test(a.note); });
    c.appendChild(K.group({ footer: (it ? 'Ticked ones notify. An accessory of this kind added later is ticked until you untick it.'
      : 'Turn the category on to choose.') + (pinned.length ? ' An alarm and its PIN keypad are the same alarm: with both ticked you’re notified once, and a tap opens the keypad.' : '') }, []));
  }
  // CAMERAS: every camera, what sets it off and its live view
  function camCat(d) { return (d.categories || []).filter(function (x) { return x.key === 'cameras'; })[0]; }
  function notifyCameraList(P, c, d) {
    var ct = camCat(d);
    if (!ct) return;
    var it = ct.item ? notifyItemOf(d, ct.item) : null;
    c.appendChild(K.group({ footer: it ? 'A camera with nothing to set it off needs a trigger: open it and choose one.' : 'Turn Cameras on to choose.' },
      ct.accessories.map(function (a) {
        return K.nav({ label: a.name, sub: !a.trigger ? 'No trigger — choose one' : (a.on ? trigWord(P, a.trigger, a.name) : 'Off'),
                       value: a.on ? 'On' : 'Off', tile: ['hk:camera', a.on ? '#0a84ff' : '#636366'],
                       href: '#/features/notify/c/cameras/cam/' + encodeURIComponent(a.entity), fk: 'notify:cam:' + a.entity });
      })));
  }
  // the suggested trigger's kind in words (features/notifications trigger_for)
  var TRIG_KIND = { person: 'person detection', doorbell: 'doorbell', motion: 'motion detection',
                    presence: 'presence detection', vehicle: 'vehicle detection', animal: 'animal detection' };
  // a trigger in its own words: "Person detected", not the camera's name again
  function trigWord(P, id, cam) {
    var n = String(P.name(id) || id);
    var low = n.toLowerCase(), pre = String(cam || '').toLowerCase() + ' ';
    if (pre.length > 1 && low.indexOf(pre) === 0 && n.length > pre.length) n = n.slice(pre.length);
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  function notifyCamera(P, c, d, cam) {
    var ct = camCat(d);
    var a = ct && ct.accessories.filter(function (x) { return x.entity === cam; })[0];
    var it = ct && ct.item ? notifyItemOf(d, ct.item) : null;
    if (!a || !it) { c.appendChild(K.group({}, [K.info({ label: 'Turn Cameras on first.' })])); return; }
    var pairs = (it.pairs || []).filter(function (p) { return p.camera !== cam; });
    var mine = (it.pairs || []).filter(function (p) { return p.camera === cam; })[0] || { camera: cam };
    var put = function (ch) {
      var p = Object.assign({}, mine, ch);
      Object.keys(p).forEach(function (k) { if (!p[k]) delete p[k]; });
      p.camera = cam;
      notifySave(P, it.id, { pairs: pairs.concat([p]) }, ['pairs']);
    };
    var ex = it.exclude || [];
    var sk = 'f:' + NT + ':cam:' + cam;
    c.appendChild(K.group({ footer: a.trigger ? null : 'Choose what sets it off below.' }, [
      K.toggle({ label: 'Notify', on: ex.indexOf(cam) < 0, sk: sk + ':on', onChange: function (on) {
        notifySave(P, it.id, { exclude: on ? ex.filter(function (x) { return x !== cam; }) : ex.concat([cam]) }, ['exclude']);
      } })]));
    c.appendChild(K.group({ footer: a.suggested ? 'Suggested: this camera’s own ' + (TRIG_KIND[a.suggested_kind] || 'detection') + '.'
        : 'Any motion, person or doorbell sensor, or an event.' }, [
      P.entityRow({ label: 'Goes Off When', sk: sk + ':trigger', value: mine.trigger || null, title: 'Goes Off When',
                    none: 'Suggested' + (a.suggested ? ' (' + trigWord(P, a.suggested, a.name) + ')' : ''),
                    filter: { domains: ['binary_sensor', 'event'], shown: true },
                    onPick: function (v) { put({ trigger: v || null }); } }),
      P.entityRow({ label: 'Live View', sk: sk + ':view', value: mine.view || null, title: 'Live View & Snapshot',
                    none: 'This Camera (' + a.name + ')', filter: { domains: ['camera'], shown: true },
                    onPick: function (v) { put({ view: v || null }); } })]));
  }
  function notifyScreens(P, c, d) {
    void d;
    var boards = (P.data && P.data.boards) || {};
    var rows = ((P.data && P.data.dashboards) || []).filter(function (x) { return boards[x.path]; }).map(function (x) {
      var b = boards[x.path];
      return K.toggle({ label: x.title || x.path, on: b.notify !== false, sk: 'b:' + x.path + ':notify',
                        onChange: function (on) { P.setB(x.path, { notify: on }); } });
    });
    c.appendChild(K.group({ footer: 'Each screen’s Allow Notifications, all on one page — the same switch as in the screen’s Behavior. A screen with it off never shows one.' }, rows));
  }
  function notifyDnd(P, c, d) {
    var o = d.options || {};
    var r = dndRows(P, o.dnd, function (dnd) { notifySet(P, { dnd: dnd }); }, 'f:' + NT + ':dnd');
    c.appendChild(K.group({ footer: 'While Do Not Disturb is on, no banner shows — except an Important one, which still gets through (and still wakes a screen set to). It is All Screens’; a screen can have its own in its Behavior.' }, r.rows));
    c.appendChild(K.group({ header: 'While This Is On', footer: 'Do Not Disturb is also on while any of these is on: an input_boolean, a switch, a timer while it runs.' }, r.whileRows));
  }

  // The page for a Features route, or null (the page falls back)
  //   P: the settings page; parts: the route after 'features/'
  function page(P, parts) {
    var t = byRoute(parts[0]);
    if (!t) return null;
    if (t[0] === 'music' && ['speakers', 'homes', 'presets', 'playlists'].indexOf(parts[1]) < 0) return null;
    var route = t[0], domain = t[1], name = t[2], sub = parts.slice(1);
    var base = '#/features/' + route;
    var feats = P.data.features || {};
    var state = stateOf(feats, domain);
    var mk = function (title, body, back) { return { title: title, back: back || [name, base], body: body }; };
    var withData = function (fn) {
      return function (c) {
        var st = P.feat(domain);
        if (!st.data) { waiting(c, st, (feats[domain] || {}).name || name, domain); return; }
        if (st.data.configured === false) { notAdded(c, (feats[domain] || {}).name || name, WHAT[domain], domain); return; }
        fn(c, st.data);
      };
    };
    if (state !== 'added') {
      return { title: name, top: true, scope: SCOPE[domain], body: function (c) {
        notAdded(c, (feats[domain] || {}).name || name, WHAT[domain], domain);
      } };
    }
    if (route === 'tv') {
      if (sub[0] === 'channels' && sub[1]) {
        var num = decodeURIComponent(sub[1]);
        var ch = ((P.feat(domain).data || {}).channels || []).filter(function (x) { return x.number === num; })[0];
        return mk(ch ? ch.name : num, withData(function (c, d) { tvChannel(P, c, d, num); }), ['Channels', base + '/channels']);
      }
      if (sub[0] === 'channels') return mk('Channels', withData(function (c, d) { tvChannels(P, c, d); }));
      return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { tvMain(P, c, d); }) };
    }
    if (route === 'music') {
      var back = ['Music', base];
      if (sub[0] === 'speakers') return mk('Speakers', withData(function (c, d) { musicSpeakers(P, c, d); }), back);
      if (sub[0] === 'homes') return mk('Home Rooms', withData(function (c, d) { musicHomes(P, c, d); }), back);
      if (sub[0] === 'presets' && sub[1]) {
        var pid = decodeURIComponent(sub[1]);
        var pp = ((P.feat(domain).data || {}).presets || []).filter(function (x) { return x.id === pid; })[0];
        return mk(pid === 'new' ? 'Add Preset' : (pp ? pp.name : 'Preset'), withData(function (c, d) { musicPreset(P, c, d, pid); }),
                  ['Presets', base + '/presets']);
      }
      if (sub[0] === 'presets') return mk('Presets', withData(function (c, d) { musicPresets(P, c, d); }), back);
      if (sub[0] === 'playlists' && sub[1] && sub[2] === 'items') {
        var iid = decodeURIComponent(sub[1]);
        return mk('Playlists', withData(function (c, d) { musicItems(P, c, d, iid); }), ['Playlist', base + '/playlists/' + sub[1]]);
      }
      if (sub[0] === 'playlists' && sub[1]) {
        var lid = decodeURIComponent(sub[1]);
        var lp = ((P.feat(domain).data || {}).playlists || []).filter(function (x) { return x.id === lid; })[0];
        return mk(lid === 'new' ? 'Add Playlist' : (lp ? lp.name : 'Playlist'), withData(function (c, d) { musicPlaylist(P, c, d, lid); }),
                  ['Playlists', base + '/playlists']);
      }
      if (sub[0] === 'playlists') return mk('Playlists', withData(function (c, d) { musicPlaylists(P, c, d); }), back);
    }
    if (route === 'alarm') {
      if (sub[0] === 'add') return mk('Add PIN', withData(function (c, d) { alarmAdd(P, c, d); }));
      if (sub[0] && sub[1] === 'pin') return mk('Change PIN', withData(function (c, d) { alarmPin(P, c, d, sub[0]); }));
      if (sub[0] && sub[1] === 'alarm') return mk('Protects', withData(function (c, d) { alarmPick(P, c, d, sub[0]); }));
      return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { alarmMain(P, c, d); }) };
    }
    if (route === 'energy') return energyPage(P, sub, mk, withData, name, domain);
    if (route === 'notify') {
      var nback = ['Notifications', base];
      if (sub[0] === 'new') return mk('Add Notification', withData(function (c, d) { notifyNew(P, c, d); }), nback);
      if (sub[0] === 'screens') return mk('Screens', withData(function (c, d) { notifyScreens(P, c, d); }), nback);
      if (sub[0] === 'dnd') return mk('Do Not Disturb', withData(function (c, d) { notifyDnd(P, c, d); }), nback);
      if (sub[0] === 'c' && sub[1] && sub[1][0] !== '~') {
        var ck = decodeURIComponent(sub[1]);
        var cc = ((P.feat(domain).data || {}).categories || []).filter(function (x) { return x.key === ck; })[0];
        if (sub[2] === 'cam' && sub[3] && sub[3][0] !== '~') {
          var camId = decodeURIComponent(sub[3]);
          var ca = cc ? cc.accessories.filter(function (a) { return a.entity === camId; })[0] : null;
          return mk(ca ? ca.name : 'Camera', withData(function (c, d) { notifyCamera(P, c, d, camId); }),
                    ['Cameras', base + '/c/cameras/accessories']);
        }
        if (sub[2] === 'accessories') {
          return mk(ck === 'cameras' ? 'Cameras' : ck === 'calendars' ? 'Calendars' : 'Accessories', withData(function (c, d) {
            if (ck === 'cameras') notifyCameraList(P, c, d); else notifyCategoryAccessories(P, c, d, ck);
          }), [cc ? cc.label : 'Category', base + '/c/' + sub[1]]);
        }
        return mk(cc ? cc.label : 'Category', withData(function (c, d) { notifyCategory(P, c, d, ck); }), nback);
      }
      if (sub[0] && sub[0][0] !== '~') {
        var nid = decodeURIComponent(sub[0]);
        var nit = notifyItemOf(P.feat(domain).data, nid);
        return mk(nit ? notifyTitle(nit) : 'Notification', withData(function (c, d) { notifyItem(P, c, d, nid); }), nback);
      }
      return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { notifyMain(P, c, d); }) };
    }
    if (route === 'clean') {
      if (sub[0] === 'rooms') return mk('Rooms', withData(function (c, d) { cleanRooms(P, c, d); }));
      return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { cleanMain(P, c, d); }) };
    }
    return null;
  }
  var SCOPE = {
    hk_tv: 'An HDHomeRun tuner’s channels, live on every screen.',
    hk_alarm_pin: 'A PIN in front of the alarm, asked for on every screen.',
    hk_clean_areas: 'Clean chosen rooms with whichever vacuum reaches them.',
    hk_energy: 'An Energy page for your screens, built from Home Assistant’s Energy settings.',
    hk_music: 'Whole-home music through Music Assistant.',
    hk_notify: 'A banner at the top of your screens when something happens at home.'
  };
  var WHAT = {
    hk_tv: 'Live TV isn’t added yet. It plays an HDHomeRun tuner’s channels on your screens, with a guide.',
    hk_alarm_pin: 'Alarm PIN isn’t added yet. It puts a PIN in front of an alarm panel.',
    hk_clean_areas: 'Clean Areas isn’t added yet. It sends each vacuum the chosen rooms on its own map.',
    hk_energy: 'Energy isn’t added yet. It builds an Energy page — whole-home power, today’s cost, daily use and a live tile per circuit — from Home Assistant’s Energy settings.',
    hk_music: 'Music isn’t added yet. It plays music in chosen rooms through Music Assistant.',
    hk_notify: 'Notifications isn’t added yet. It shows a banner at the top of your screens when an accessory does something — a door opens, someone arrives, a camera sees a person — with a camera’s snapshot.'
  };

  root.hkSettingsFeatures = {
    LIST: LIST, listed: listed, stateOf: stateOf, page: page, use: use, addHref: addHref, search: search, musicTop: musicTop,
    integrationHref: integrationHref, SCOPE: SCOPE, WHAT: WHAT, dndRows: dndRows, dndSummary: dndSummary,
    _: { tvLists: tvLists, tvCount: tvCount, speakerLists: speakerLists, speakerName: speakerName, pairNote: pairNote, playlistSub: playlistSub, vacuumSub: vacuumSub, vacuumsAfter: vacuumsAfter,
         roomLists: roomLists, roomCount: roomCount, energyFound: energyFound, sectionsAfter: sectionsAfter,
         batteriesStored: batteriesStored, stayLabel: stayLabel, notifySummary: notifySummary, whenControl: whenControl,
         cooldownLabel: cooldownLabel, wakesOf: wakesOf, trigWord: trigWord }
  };
})();
