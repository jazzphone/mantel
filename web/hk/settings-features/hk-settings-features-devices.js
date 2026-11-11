// hk-settings-features-devices.js - the TV, Clean Areas, alarm and music pages.
//
// PART OF THE FEATURE PAGES OF HK SETTINGS (hk-settings-features.js). Not a card and not run on its own: it registers one
// function, which hk-settings-features.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsFeaturesParts = window.hkSettingsFeaturesParts || {})['hk-settings-features-devices'] = function (KIT) {
    var addHref = KIT.addHref, cap = KIT.cap, haPlace = KIT.haPlace, integrationHref = KIT.integrationHref,
        pairChoices = KIT.pairChoices, pairNote = KIT.pairNote, pairsAfter = KIT.pairsAfter, plural = KIT.plural,
        roomCount = KIT.roomCount, roomLists = KIT.roomLists, speakerLists = KIT.speakerLists,
        speakerName = KIT.speakerName, stateOf = KIT.stateOf, tvCount = KIT.tvCount, tvLists = KIT.tvLists,
        vacuumsAfter = KIT.vacuumsAfter, vacuumSub = KIT.vacuumSub, virtualPair = KIT.virtualPair, WHAT = KIT.WHAT;

    var K;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      K = s.K;
    });

    // A page whose data is still on its way, or could not be read
    function waiting(c, st, name, domain) {
      if (st && st.error) {
        c.appendChild(K.group({ footer: name + ' didn’t answer: ' + st.error + '. It may be restarting; this page tries again when you come back.' }, [
          K.nav({ label: name, sub: 'In ' + haPlace('Devices & Services'), href: integrationHref(domain), icon: 'mdi:open-in-new' })]));
        return;
      }
      c.appendChild(K.group({}, [K.info({ label: 'Loading…' })]));
    }
    // A host whose features are its own (panel/get's `own`): Add and Remove here, saved in that host's feature
    // settings (`<id>/feature/set`), the page's data read again after. In Home Assistant, the integration's Add feature.
    function own(P, domain) {
      var f = P && P.data && (P.data.features || {})[domain];
      return !!(f && f.own);
    }
    function setFeature(P, domain, on) {
      return P.ws({ type: domain + '/feature/set', enabled: on }).then(function (ok) {
        if (!ok) return;
        if (P.feats) delete P.feats[domain];
        return P.reload().then(function () { P.render(true); });
      });
    }
    // not added yet: what it does and the way to add it
    function notAdded(c, name, what, domain, P) {
      if (own(P, domain)) {
        c.appendChild(K.group({ footer: what }, [
          K.button({ label: 'Add ' + name, fk: 'feat:add:' + domain, onClick: function () { setFeature(P, domain, true); } })]));
        return;
      }
      c.appendChild(K.group({ footer: what }, [
        K.nav({ label: 'Add ' + name, sub: haPlace('Devices & Services → HK Frontend → Add feature'), href: addHref(domain),
                icon: 'mdi:plus-circle-outline', fk: 'feat:add:' + domain })]));
    }
    // added, on such a host: Remove, at the foot of the feature's own page (its settings are kept for Add again)
    function removeRow(P, c, name, domain) {
      if (!own(P, domain)) return;
      c.appendChild(K.group({ footer: 'Takes ' + name + ' off every screen. Its settings are kept, for when you add it again.' }, [
        K.button({ label: 'Remove ' + name, destructive: true, fk: 'feat:remove:' + domain, onClick: function () {
          K.confirm(P.shadowRoot, { title: 'Remove ' + name + '?', message: 'It comes off every screen. Its settings are kept.',
                                    destructive: true, ok: 'Remove' }).then(function (yes) { if (yes) setFeature(P, domain, false); });
        } })]));
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
      c.appendChild(K.group({ header: 'Picture', footer: '720p is plenty on a wall tablet or a phone. 1080p uses about 40% more processor for each channel being watched.' }, [
        K.seg({ label: 'Quality', sk: 'f:hk_tv:quality', value: d.quality, options: [['720', '720p'], ['1080', '1080p']],
                onChange: function (v) { set({ quality: v }); } })]));
      c.appendChild(
        K.group(
        { header: 'Tuner & Guide',
        footer: 'The guide is an XMLTV file (from a service such as Schedules Direct, or a program that builds one). With a guide, each channel shows what’s on now and uses the network’s name.' }, [
        K.text({ label: 'Tuner Address', sk: 'f:hk_tv:host', value: d.host, placeholder: 'IP address or host name',
                 error: P.err('f:hk_tv:host'), onCommit: function (v) { set({ host: v }); } }),
        K.text({ label: 'Guide Address', sk: 'f:hk_tv:guide_url', value: d.guide_url, placeholder: 'None',
                 error: P.err('f:hk_tv:guide_url'), onCommit: function (v) { set({ guide_url: v }); } })]));
      // (a page served from outside Home Assistant says its Live TV has no integration there to open)
      if (d.ha_link !== false) openIn(c, 'Live TV', 'hk_tv');
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
      if (state === 'not_added') { notAdded(c, (feats.hk_music || {}).name || 'Music', WHAT.hk_music, 'hk_music', P); return; }
      var st = P.feat('hk_music');
      if (!st.data) { waiting(c, st, 'Music', 'hk_music'); return; }
      var d = st.data;
      if (d.configured === false) { notAdded(c, 'Music', WHAT.hk_music, 'hk_music', P); return; }
      var homes = Object.keys(d.homes || {}).filter(function (u) { return (d.users || []).some(function (x) { return x.id === u; }); }).length;
      c.appendChild(K.group({ header: 'Speakers', footer: 'The rooms music plays in. A wall tablet’s signed-in user starts in its own home room.' }, [
        K.nav({ label: 'Speakers', value: String((d.speakers || []).length), href: '#/features/music/speakers', fk: 'music:speakers' }),
        K.nav({ label: 'Home Rooms', value: homes ? homes + ' of ' + (d.users || []).length : 'None', href: '#/features/music/homes', fk: 'music:homes' })
      ].concat(d.leaders ? [
        K.nav({ label: 'Group Leaders', value: d.leaders.length ? speakerName(d, d.leaders[0]) + (d.leaders.length > 1 ? ' +' + (d.leaders.length - 1) : '') : 'Automatic',
                href: '#/features/music/leaders', fk: 'music:leaders' })] : []).concat([
        K.slider({ label: 'House Volume', sub: 'Where a playlist starts, in every room it plays in.', sk: 'f:hk_music:volume',
                   value: Math.round((d.volume || 0) * 100), min: 0, max: 100, step: 5, unit: '%', fk: 'music:volume',
                   onChange: function (v) { P.featSet('hk_music', { volume: v / 100 }); } })])));
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
      removeRow(P, c, 'Music', 'hk_music');
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
      if (!d.pairs_here) return;           // (a host whose engine plays no pairs says so by leaving this out)
      var perr = P.err('f:hk_music:pairs');
      c.appendChild(K.group({ header: 'Speaker Pairs', footer: (perr ? perr + ' ' : '') +
          'Two speakers in one room, such as two HomePods, shown and played as one speaker everywhere. ' +
          'They’re grouped each time they play, so each stays free to join other rooms.' },
        (d.virtual_pairs || []).map(function (p) {
          return K.nav({ label: p.shown, sub: p.players.map(function (x) { return x.name; }).join(' + ') +
                                              (p.ma_group ? ' · Also a Music Assistant group' : ''),
                         href: '#/features/music/pairs/' + encodeURIComponent(p.room), fk: 'music:pair:' + p.room });
        }).concat([K.nav({ label: 'Pair Two Speakers', href: '#/features/music/pairs/new', icon: 'mdi:plus-circle-outline',
                           fk: 'music:pair:new' })])));
    }
    function musicPair(P, c, d, room) {
      var st = P.feat('hk_music');
      var p = room === 'new' ? null : virtualPair(d, room);
      if (room !== 'new' && !p) { c.appendChild(K.group({ footer: 'That pair is gone.' }, [])); return; }
      var f = form(st, 'pair:' + room, function () {
        return p ? { name: p.name || '', a: p.players[0].entity, b: p.players[1].entity } : { name: '', a: '', b: '' };
      });
      var opts = pairChoices(d, p ? p.room : null);
      var err = P.err('f:hk_music:pairs');
      c.appendChild(K.group({ footer: 'Without a name, the pair is named by the first speaker’s area, as every room is.' }, [
        K.text({ label: 'Name', sk: 'f:hk_music:pair_name', value: f.name, placeholder: 'Its area’s name', maxlength: 60,
                 onCommit: function (v) { f.name = v; } })]));
      c.appendChild(K.group({ header: 'Speakers', footer: (err ? err + ' ' : '') +
          'The first is the room: its place in the speaker list, its floor and its home rooms. ' +
          'Volume goes to both together; play and pause go to the first, which leads the two.' +
          (p && p.ma_group ? ' Music Assistant also has a group of these two, ' + p.ma_group +
           ': the pair plays through it when it plays alone, and as its two speakers with other rooms.' : '') }, [
        K.select({ label: 'First', sk: 'f:hk_music:pair_a', value: f.a, placeholder: 'Choose', options: opts.filter(function (o) { return o[0] !== f.b; }),
                   onChange: function (v) { f.a = v; P.render(); } }),
        K.select({ label: 'Second', sk: 'f:hk_music:pair_b', value: f.b, placeholder: 'Choose', options: opts.filter(function (o) { return o[0] !== f.a; }),
                   onChange: function (v) { f.b = v; P.render(); } })]));
      c.appendChild(K.group({}, [K.button({ label: p ? 'Save Pair' : 'Pair Speakers', fk: 'music:pair:save',
        disabled: !f.a || !f.b || f.a === f.b, onClick: function () {
          P.featSet('hk_music', { pairs: pairsAfter(d, p ? p.room : null, { players: [f.a, f.b], name: f.name }) }, ['pairs'])
            .then(function (ok) { if (ok) { delete st.forms['pair:' + room]; P.back('#/features/music/speakers'); } });
        } })]));
      if (!p) return;
      c.appendChild(K.group({}, [K.button({ label: 'Unpair', destructive: true, fk: 'music:pair:rm', onClick: function () {
        K.confirm(P.shadowRoot, { title: 'Unpair “' + p.shown + '”?', destructive: true, ok: 'Unpair',
          message: 'Both speakers stay, as two speakers of their own.' })
          .then(function (yes) {
            if (!yes) return;
            P.featSet('hk_music', { pairs: pairsAfter(d, p.room, null) }, ['pairs'])
              .then(function (ok) { if (ok) { delete st.forms['pair:' + room]; P.back('#/features/music/speakers'); } });
          });
      } })]));
    }
    // GROUP LEADERS (2026-11-02, hk_core MusicConfig.leader_of): rooms that
    // play together play in step with one of them. Music Assistant plays an
    // announcement to that room on the whole group, so the house says which
    // rooms lead, and which rooms Home Assistant speaks to.
    function musicLeaders(P, c, d) {
      var lead = d.leaders || [], ann = d.announce_rooms || [], err = P.err('f:hk_music:leaders');
      var row = function (x) { return { value: x.entity, label: x.name, sub: x.floor || null }; };
      c.appendChild(K.listEditor({ fk: 'lead', minRows: 0, announce: P.announce.bind(P), shownHeader: 'Lead First',
        moreHeader: 'Other Speakers', emptyText: 'None: the first room picked that isn’t an announcement room leads.',
        shownFooter: (err ? err + ' ' : '') + 'When rooms play together, the first of these among them leads, and the others play in step with it. ' +
                     'A room already playing music keeps leading when rooms join it.',
        rows: lead.map(function (e) { return (d.speakers || []).filter(function (x) { return x.entity === e; })[0]; })
          .filter(Boolean).map(row),
        more: (d.speakers || []).filter(function (x) { return lead.indexOf(x.entity) < 0; }).map(row),
        onChange: function (v) { P.featSet('hk_music', { leaders: v }, ['leaders']); } }));
      var aerr = P.err('f:hk_music:announce_rooms');
      c.appendChild(K.group({ header: 'Announcement Rooms', footer: (aerr ? aerr + ' ' : '') +
          'Rooms Home Assistant speaks to, such as a bedtime reminder. Music Assistant plays an announcement to a group’s leader ' +
          'in every room of the group, so these lead only when no other room can, and hand their music to the room that leads ' +
          'when rooms join them.' },
        (d.speakers || []).map(function (x) {
          var on = ann.indexOf(x.entity) >= 0;
          return K.check({ label: x.name, sub: x.floor || null, multi: true, on: on, fk: 'music:announce:' + x.entity, onClick: function () {
            var v = on ? ann.filter(function (e) { return e !== x.entity; }) : ann.concat(x.entity);
            P.featSet('hk_music', { announce_rooms: v }, ['announce_rooms']);
          } });
        })));
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
      c.appendChild(K.group({ footer: 'A name for rooms that often play together. Choosing it on a screen picks those rooms; they play in step, joined under one of them.' },
        (d.presets || []).map(function (p) {
          return K.nav({ label: p.name, sub: (p.members || []).map(function (m) { return speakerName(d, m); }).join(', '),
                         href: '#/features/music/presets/' + encodeURIComponent(p.id), fk: 'music:preset:' + p.id });
        }).concat([K.nav({ label: 'Add Preset', href: '#/features/music/presets/new', icon: 'mdi:plus-circle-outline', fk: 'music:preset:new' })])));
    }
    function form(st, key, init) { return ((st.forms = st.forms || {})[key] = st.forms[key] || init()); }
    function musicPreset(P, c, d, id) {
      var st = P.feat('hk_music');
      var p = (d.presets || []).filter(function (x) { return x.id === id; })[0];
      if (id !== 'new' && !p) { c.appendChild(K.group({ footer: 'That preset is gone.' }, [])); return; }
      var f = form(st, 'preset:' + id, function () {
        return p ? { name: p.name, members: p.members.slice() } : { name: '', members: [] };
      });
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'f:hk_music:name', value: f.name, placeholder: 'Everywhere', maxlength: 60,
                 error: P.err('f:hk_music:name'), onCommit: function (v) { f.name = v; } })]));
      // ITS ROOMS ARE ITS OWN (hk_core/music/config.py): no Music Assistant group
      // plays a preset, so it can pause and a pair of speakers is one of its rooms
      var memErr = P.err('f:hk_music:members') ? P.err('f:hk_music:members') + ' ' : '';
      c.appendChild(K.group({ header: 'Rooms', footer: memErr || null },
        (d.speakers || []).map(function (x) {
          var on = f.members.indexOf(x.entity) >= 0, pair = (d.pairs || {})[x.entity];
          return K.check({ label: x.name, sub: [x.floor, pair ? cap(pair.kind) : null].filter(Boolean).join(' · ') || null,
                           multi: true, on: on, fk: 'music:member:' + x.entity, onClick: function () {
            f.members = on ? f.members.filter(function (m) { return m !== x.entity; }) : f.members.concat(x.entity);
            P.render();
          } });
        })));
      var save = K.button({ label: p ? 'Save Preset' : 'Add Preset', fk: 'music:preset:save', onClick: function () {
        P.featCall('hk_music', Object.assign({ type: 'hk_music/preset/save', name: f.name, members: f.members },
                                             p ? { item: p.id } : {}), ['name', 'members'])
          .then(function (ok) { if (ok) { delete st.forms['preset:' + id]; P.back('#/features/music/presets'); } });
      } });
      c.appendChild(K.group({}, [save]));
      if (p) removeButton(P, c, p.id, p.name, 'preset', '#/features/music/presets');
    }
    function removeButton(P, c, id, name, what, back) {
      c.appendChild(K.group({}, [K.button({ label: 'Delete ' + (what === 'preset' ? 'Preset' : 'Playlist'), destructive: true,
        fk: 'music:rm:' + id, onClick: function () {
          K.confirm(P.shadowRoot, { title: 'Delete “' + name + '”?', destructive: true, ok: 'Delete',
            message: what === 'preset' ? 'Its rooms stay, as rooms of their own.' : 'The playlists stay in your Music Assistant library.' })
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

    // what the shell and the later parts use of this one
    KIT.alarmAdd = alarmAdd; KIT.alarmMain = alarmMain; KIT.alarmPick = alarmPick; KIT.alarmPin = alarmPin;
    KIT.cleanMain = cleanMain; KIT.cleanRooms = cleanRooms; KIT.form = form; KIT.musicHomes = musicHomes;
    KIT.musicItems = musicItems; KIT.musicLeaders = musicLeaders; KIT.musicPair = musicPair;
    KIT.musicPlaylist = musicPlaylist; KIT.musicPlaylists = musicPlaylists; KIT.musicPreset = musicPreset;
    KIT.musicPresets = musicPresets; KIT.musicSpeakers = musicSpeakers; KIT.musicTop = musicTop;
    KIT.notAdded = notAdded; KIT.openIn = openIn; KIT.own = own; KIT.playlistSub = playlistSub;
    KIT.removeRow = removeRow; KIT.setFeature = setFeature; KIT.tvChannel = tvChannel; KIT.tvChannels = tvChannels;
    KIT.tvMain = tvMain; KIT.waiting = waiting;
  };
})();
