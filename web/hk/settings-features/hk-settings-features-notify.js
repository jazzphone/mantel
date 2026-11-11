// hk-settings-features-notify.js - the notification pages.
//
// PART OF THE FEATURE PAGES OF HK SETTINGS (hk-settings-features.js). Not a card and not run on its own: it registers one
// function, which hk-settings-features.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsFeaturesParts = window.hkSettingsFeaturesParts || {})['hk-settings-features-notify'] = function (KIT) {
    var alarmAdd = KIT.alarmAdd, alarmMain = KIT.alarmMain, alarmPick = KIT.alarmPick, alarmPin = KIT.alarmPin,
        byRoute = KIT.byRoute, cleanMain = KIT.cleanMain, cleanRooms = KIT.cleanRooms, energyPage = KIT.energyPage,
        musicHomes = KIT.musicHomes, musicItems = KIT.musicItems, musicLeaders = KIT.musicLeaders,
        musicPair = KIT.musicPair, musicPlaylist = KIT.musicPlaylist, musicPlaylists = KIT.musicPlaylists,
        musicPreset = KIT.musicPreset, musicPresets = KIT.musicPresets, musicSpeakers = KIT.musicSpeakers,
        notAdded = KIT.notAdded, removeRow = KIT.removeRow, SCOPE = KIT.SCOPE, stateOf = KIT.stateOf,
        tvChannel = KIT.tvChannel, tvChannels = KIT.tvChannels, tvMain = KIT.tvMain, virtualPair = KIT.virtualPair,
        waiting = KIT.waiting, WHAT = KIT.WHAT;

    var K;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      K = s.K;
    });

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
        c.appendChild(
          K.group({ header: 'Categories', footer: 'Found from your accessories, and any you add later. Turn one on to be notified for all of them alike — then leave out any you don’t want.' },
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
      c.appendChild(
        K.group(
        { header: 'Where They Show',
        footer: 'A notification set to Wakes the Screen wakes a screen from its screensaver or its Sleep Screen whatever these say. Each screen can choose its own in its Behavior.' }, [
        K.nav({ label: 'Screens', value: allow + ' of ' + dash.length, href: '#/features/notify/screens', fk: 'notify:screens' }),
        K.seg({ label: 'On the Screensaver', sub: o.saver === 'important' ? 'Only the Important ones show over the photos' : o.saver === 'off' ? 'None show over the photos' :
          'Every one shows over the photos',
                value: o.saver, sk: 'f:' + NT + ':saver', options: [['all', 'All'], ['important', 'Important'], ['off', 'Off']],
                onChange: function (v) { notifySet(P, { saver: v }); } }),
        K.nav({ label: 'Do Not Disturb', value: dndSummary(o.dnd), href: '#/features/notify/dnd', fk: 'notify:dnd' })]));
      c.appendChild(
        K.group(
        { header: 'Banner',
        footer: 'Each banner slides away by itself after Stays On Screen; each notification can stay longer, shorter or until dismissed. Swipe one away any time, or Clear All when there are several.'
        }, [
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
      c.appendChild(
        K.group(
        { header: 'Banner', footer: cal ? 'Empty Title and Message: the event’s name, then when and where it is (“In 15 minutes · 10:30 – 11:00 AM · the place”). An all-day one: “Today · All Day”.'
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
      c.appendChild(
        K.group(
        { footer: key === 'cameras' ?
        (it ? 'Each camera notifies when its trigger goes off — its own person, doorbell, motion or presence detection unless you choose another — with its own snapshot and live view.'
        : 'Each camera, with the sensor that sets it off and the camera its snapshot and live view come from.')
        : key === 'calendars' && it ?
          'Each event of the ticked calendars notifies the chosen time before it starts — its name, when and where. A calendar added later is included, unless you leave it out.'
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
      c.appendChild(
        K.group(
        {
        footer:
        'While Do Not Disturb is on, no banner shows — except an Important one, which still gets through (and still wakes a screen set to). It is All Screens’;' +
        ' a screen can have its own in its Behavior.' }, r.rows));
      c.appendChild(K.group({ header: 'While This Is On', footer: 'Do Not Disturb is also on while any of these is on: an input_boolean, a switch, a timer while it runs.' }, r.whileRows));
    }

    // The page for a Features route, or null (the page falls back)
    //   P: the settings page; parts: the route after 'features/'
    function page(P, parts) {
      var t = byRoute(parts[0]);
      if (!t) return null;
      if (t[0] === 'music' && ['speakers', 'pairs', 'homes', 'leaders', 'presets', 'playlists'].indexOf(parts[1]) < 0) return null;
      var route = t[0], domain = t[1], name = t[2], sub = parts.slice(1);
      var base = '#/features/' + route;
      var feats = P.data.features || {};
      var state = stateOf(feats, domain);
      var mk = function (title, body, back) { return { title: title, back: back || [name, base], body: body }; };
      var withData = function (fn) {
        return function (c) {
          var st = P.feat(domain);
          if (!st.data) { waiting(c, st, (feats[domain] || {}).name || name, domain); return; }
          if (st.data.configured === false) { notAdded(c, (feats[domain] || {}).name || name, WHAT[domain], domain, P); return; }
          fn(c, st.data);
        };
      };
      if (state !== 'added') {
        return { title: name, top: true, scope: SCOPE[domain], body: function (c) {
          notAdded(c, (feats[domain] || {}).name || name, WHAT[domain], domain, P);
        } };
      }
      if (route === 'tv') {
        if (sub[0] === 'channels' && sub[1]) {
          var num = decodeURIComponent(sub[1]);
          var ch = ((P.feat(domain).data || {}).channels || []).filter(function (x) { return x.number === num; })[0];
          return mk(ch ? ch.name : num, withData(function (c, d) { tvChannel(P, c, d, num); }), ['Channels', base + '/channels']);
        }
        if (sub[0] === 'channels') return mk('Channels', withData(function (c, d) { tvChannels(P, c, d); }));
        return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { tvMain(P, c, d); removeRow(P, c, name, domain); }) };
      }
      if (route === 'music') {
        var back = ['Music', base];
        if (sub[0] === 'speakers') return mk('Speakers', withData(function (c, d) { musicSpeakers(P, c, d); }), back);
        if (sub[0] === 'pairs' && sub[1]) {
          var vr = decodeURIComponent(sub[1]);
          var vp = virtualPair(P.feat(domain).data || {}, vr);
          return mk(vr === 'new' ? 'Pair Two Speakers' : (vp ? vp.shown : 'Pair'), withData(function (c, d) { musicPair(P, c, d, vr); }),
                    ['Speakers', base + '/speakers']);
        }
        if (sub[0] === 'homes') return mk('Home Rooms', withData(function (c, d) { musicHomes(P, c, d); }), back);
        if (sub[0] === 'leaders') return mk('Group Leaders', withData(function (c, d) { musicLeaders(P, c, d); }), back);
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
        return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { alarmMain(P, c, d); removeRow(P, c, name, domain); }) };
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
        return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { notifyMain(P, c, d); removeRow(P, c, name, domain); }) };
      }
      if (route === 'clean') {
        if (sub[0] === 'rooms') return mk('Rooms', withData(function (c, d) { cleanRooms(P, c, d); }));
        return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { cleanMain(P, c, d); removeRow(P, c, name, domain); }) };
      }
      return null;
    }

    // what the shell and the later parts use of this one
    KIT.cooldownLabel = cooldownLabel; KIT.dndRows = dndRows; KIT.dndSummary = dndSummary;
    KIT.notifySummary = notifySummary; KIT.page = page; KIT.stayLabel = stayLabel; KIT.trigWord = trigWord;
    KIT.wakesOf = wakesOf; KIT.whenControl = whenControl;
  };
})();
