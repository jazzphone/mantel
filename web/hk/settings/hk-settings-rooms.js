// hk-settings-rooms.js - Rooms and Wall Tablets.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-rooms'] = function (KIT) {
    var C = KIT.C, DOMAIN = KIT.DOMAIN, haPlace = KIT.haPlace, PN = KIT.PN, restWrite = KIT.restWrite;

    var F, h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      F = s.F; h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ---------------------------------------------------------- rooms
      // ROOMS, ALL SCREENS (2026-10-01): one place for everything about rooms.
      // The order and which are on Home, the menu's and the pages' -- for every
      // screen whose Rooms are Same as All Screens -- the room pages' headings
      // and status row, and every room, each with a page of its own settings
      // (on every screen): shown or hidden, on Home, part of another room,
      // its tile order and its scenes.
      houseRooms() { return M.houseRoomsAsBoard(this.data.settings.rooms); }
      // a room's own page (Rooms, All Screens), from any list of rooms
      roomHref(a) { return '#/house/rooms/' + encodeURIComponent(a); }
      roomFollowers() {
        var bd = this.data.boards || {};
        return Object.keys(bd).filter(function (p) { return !bd[p].rooms_custom; });
      }
      // ALL SCREENS' CAMERAS (2026-10-09): which cameras and in what order --
      // every screen's Home strip and Cameras page, and the room pages' cameras
      // in that order -- unless a screen sets its own (that screen -> Cameras).
      h_cameras(c) {
        var self = this, ents = this.client.entities || {};
        var ok = this.entityIds({ domains: ['camera'], shown: true }).filter(function (id) { return !self.notHouseCamera(id); }).sort();
        var autoCams = M.autoCameras(ok, function (id) { return (ents[id] || {}).device_id; });
        var save = function (v) { return self.setH({ 'cameras.order': v }); };
        var bd = this.data.boards || {}, own = Object.keys(bd).filter(function (p) { return bd[p].cameras_custom; });
        c.appendChild(K.group({ footer: own.length
            ? 'Every screen follows these except ' + own.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
              ', which set' + (own.length === 1 ? 's its' : ' their') + ' own (that screen → Home Page → Cameras).'
            : 'Every screen follows these: its camera strip on Home, its Cameras page, and the cameras on the room pages, in this order. A screen can set its own in its Cameras.' }, [
          K.info({ label: 'Screens Following', value: (Object.keys(bd).length - own.length) + ' of ' + Object.keys(bd).length })]));
        // LIVE FIRST CAMERA (2026-10-10): the strip's first tile live, or a
        // snapshot like the others (hk-cameras.js _liveOn)
        var live = (this.data.settings.cameras || {}).live !== false;
        var ownLive = Object.keys(bd).filter(function (p) { return typeof bd[p].camera_live_video === 'boolean'; });
        c.appendChild(K.group({ header: 'Camera Strip on Home', footer: 'On, the first tile plays live video and the others show snapshots. ' +
            'Off, the first tile is a snapshot too — no video to decode, which is lighter on a computer or an older tablet. ' +
            'The Cameras page and the camera pop-ups still play live.' +
            (ownLive.length ? ' ' + ownLive.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
              (ownLive.length === 1 ? ' sets its own.' : ' set their own.') : ' A screen can set its own in its Cameras.') }, [
          K.toggle({ label: 'Live First Camera', sk: 'cameras.live', on: live, onChange: function (on) { self.setH({ 'cameras.live': on }); } })]));
        // PAUSE WHEN NOT IN FOCUS (2026-10-21): a computer's live cameras rest
        // while another window is in front -- the sky's own setting is apart,
        // since a window of cameras is often kept beside other work
        c.appendChild(K.group({ footer: 'On a computer, live cameras stop while another window is in front, and start again when you come back. ' +
            'Turn this off to keep watching cameras in a window beside your work. Behind the screensaver, cameras always stop.' }, [
          K.toggle({ label: 'Pause When Not in Focus', sk: 'cameras.focus_pause', on: (this.data.settings.cameras || {}).focus_pause !== false,
            onChange: function (on) { self.setH({ 'cameras.focus_pause': on }); } })]));
        var mdl = M.camerasModel({ cameras: ((this.data.settings.cameras || {}).order || []) }, ok, autoCams);
        c.appendChild(K.listEditor({ fk: 'house-cams', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic shows one of every camera, its low-resolution channel.',
          rows: mdl.rows.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
          more: mdl.more.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
          onAuto: function (on) {
            if (!on) { save(mdl.rows.map(function (r) { return r.value; })); return; }
            self.confirmSwitch({ title: 'Use Automatic Cameras?', message: 'All Screens’ camera order and choices will be replaced.', ok: 'Use Automatic' },
                function () { save([]); });
          },
          onChange: function (v) { save(v); } }));
        this.cameraRelated(c, null);
      }
      // EVERYTHING ELSE ABOUT CAMERAS, from either Cameras page (2026-10-10):
      // the pop-ups that show one, each screen's own strip (its Live Camera
      // Follows, its own list), the Cameras page's background, and cameras
      // hidden from every screen. `x`: the screen whose Cameras this is.
      cameraRelated(c, x) {
        var self = this, bd = this.data.boards || {}, pops = this.data.popups || [];
        var camPops = pops.filter(function (p) { return p.kind === 'camera'; }).length;
        var rows = [K.nav({ label: 'Pop-ups', sub: 'The doorbell and other camera sheets an automation opens',
                            value: camPops ? camPops + (camPops === 1 ? ' Camera Pop-up' : ' Camera Pop-ups') : 'None Yet',
                            href: '#/popups', icon: 'mdi:doorbell-video', fk: 'cams-rel:popups' })];
        if (x) {
          rows.push(K.nav({ label: 'Cameras for All Screens', sub: 'The camera list and Live First Camera every screen starts from',
                            href: '#/page/cameras', icon: 'mdi:cctv', fk: 'cams-rel:house' }));
        } else {
          // the screens with a Home strip: not a page screen (no Home) nor one
          // whose Home is a page of its own (the car's)
          this.data.dashboards.filter(function (d) {
            var b = d.item && bd[d.path];
            return b && b.home_page !== false && !b.home_view;
          }).forEach(function (d) {
            var b = bd[d.path], notes = [];
            if (b.camera_strip === false) notes.push('No Strip');
            else {
              if (b.camera_live) notes.push('Live Follows ' + self.name(b.camera_live));
              if (b.cameras_custom) notes.push('Own Cameras');
              if (typeof b.camera_live_video === 'boolean') notes.push(b.camera_live_video ? 'Live' : 'No Live');
            }
            rows.push(K.nav({ label: d.title + ' Camera Strip', value: notes.join(' · '), icon: 'mdi:monitor-dashboard',
                              href: '#/screens/' + encodeURIComponent(d.path) + '/cameras', fk: 'cams-rel:' + d.path }));
          });
        }
        rows.push(K.nav({ label: 'Cameras Page Background', sub: 'Its own color, the live sky or a backdrop',
                          href: x ? '#/screens/' + encodeURIComponent(x.path) + '/sky/page/cameras' : '#/page/cameras/background',
                          icon: 'mdi:palette', fk: 'cams-rel:bg' }));
        rows.push(K.nav({ label: 'Hidden Accessories', sub: 'A camera hidden there shows on no screen', href: '#/accessories/hidden',
                          icon: 'mdi:eye-off', fk: 'cams-rel:hidden' }));
        c.appendChild(K.group({ header: 'Related' }, rows));
      }
      h_rooms(c) {
        var self = this, rooms = this.data.settings.rooms, hb = this.houseRooms(), wide = this.hasAttribute('wide');
        var setR = function (ch) { return self.setH(M.houseRoomsSave(ch)); };
        var bd = this.data.boards || {}, own = Object.keys(bd).filter(function (p) { return bd[p].rooms_custom; });
        c.appendChild(K.group({ header: 'Order', footer: own.length
            ? 'Every screen follows these except ' + own.map(function (p) { var d = self.dash(p); return d ? d.title : p; }).join(', ') +
              ', which set' + (own.length === 1 ? 's its' : ' their') + ' own (that screen → Rooms).'
            : 'Every screen follows these. A screen can set its own in its Rooms.' }, [
          K.nav({ label: 'Room Order', value: M.roomsSummary(hb), href: '#/house/rooms/order', sk: 'rooms.order' }),
          K.seg({ label: 'Rooms in Menu', sk: 'rooms.menu', value: hb.menu_rooms, stack: !wide,
                  options: [['az', 'A to Z'], ['order', 'Room Order']], onChange: function (v) { setR({ menu_rooms: v }); } }),
          K.seg({ label: 'Rooms on Pages', sub: 'Lights, Climate, Water and the other pages that group by room.', sk: 'rooms.pages',
                  value: hb.page_rooms, stack: !wide, options: [['floor', 'By Floor'], ['order', 'Room Order']],
                  onChange: function (v) { setR({ page_rooms: v }); } })]));
        var st = rooms.status || [];
        c.appendChild(K.group({ header: 'Room Pages', footer: 'A room page shows its readings and what’s open or on at the top. Temperature and humidity are the area’s own sensors (Settings → Areas).' }, [
          K.toggle({ label: 'Room Headings Open Room Pages', sk: 'rooms.headings', on: rooms.headings !== false,
                     onChange: function (on) { self.setH({ 'rooms.headings': on }); } }),
          K.nav({ label: 'Status Row', value: M.statusSummary(st), href: '#/house/rooms/status', sk: 'rooms.status' })]));
        var areas = (this.client && this.client.areas) || {}, az = this.areasAZ();
        var g = this.data.settings.generated || {}, hidden = g.exclude_areas || [];
        var into = ((this.data.accessories || {}).into) || {};
        var onHome = M.roomsModel(hb, az).rows.map(function (r) { return r.value; });
        c.appendChild(K.group({ header: 'Rooms', footer: 'Each room’s own settings — its scenes, its tile order, whether it shows — on every screen.' },
          az.map(function (a) {
            var notes = [];
            if (hidden.indexOf(a) >= 0) notes.push('Hidden');
            else if (into[a] && areas[into[a]]) notes.push('In ' + self.areaName(into[a]));
            else if (onHome.indexOf(a) < 0) notes.push('Not on Home');
            var sc = (((self.data.accessories || {}).scenes || {})[a]);
            if (!notes.length && Array.isArray(sc) && sc.length) notes.push(sc.length + (sc.length === 1 ? ' Scene' : ' Scenes'));
            return K.nav({ label: areas[a].name, icon: areas[a].icon || 'mdi:texture-box', value: notes.join(' · '),
                           href: '#/house/rooms/' + encodeURIComponent(a), sk: 'room:' + a });
          })));
      }
      h_roomOrder(c) {
        var self = this, hb = this.houseRooms(), az = this.areasAZ(), areas = (this.client && this.client.areas) || {};
        var mdl = M.roomsModel(hb, az);
        var setR = function (ch) { return self.setH(M.houseRoomsSave(ch)); };
        var icon = function (a) { return (areas[a] || {}).icon || 'mdi:texture-box'; };
        c.appendChild(K.listEditor({ fk: 'hrooms', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: Home shows its rooms floor by floor, then A to Z.',
          shownHeader: 'On Home', moreHeader: 'Not on Home',
          moreFooter: 'A room that isn’t on Home keeps its page and its row in the menu. Tap a room for its own settings.',
          rows: mdl.rows.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: icon(r.value), href: self.roomHref(r.value) }; }),
          more: mdl.more.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: icon(r.value) }; }),
          onAuto: function (on) {
            if (!on) { setR({ room_order: az.slice(), home_rooms: 'order' }); return; }
            self.confirmSwitch({ title: 'Use Automatic Rooms?', message: 'The room order and choices for All Screens will be replaced.', ok: 'Use Automatic' },
                function () { setR(M.roomsAuto()); });
          },
          onChange: function (v) { setR(M.roomsSave(v, az)); } }));
        c.appendChild(K.group({ footer: 'For every screen whose Rooms are Same as All Screens. The order is also the menu’s and the pages’, where those say Room Order.' }, []));
      }
      h_room(c, aid) {
        var self = this, client = this.client, areas = client.areas || {}, az = this.areasAZ();
        var g = this.data.settings.generated || {}, hidden = (g.exclude_areas || []).slice(), shown = hidden.indexOf(aid) < 0;
        var hb = this.houseRooms(), onHome = M.roomsModel(hb, az).rows.some(function (r) { return r.value === aid; });
        var into = ((this.data.accessories || {}).into || {})[aid] || '';
        var order = ((this.data.accessories || {}).rooms || {})[aid] || [];
        var nAcc = this.accIds().filter(function (id) { return self.areaOf(id) === aid; }).length;
        var own = Object.keys(this.data.boards || {}).filter(function (p) { return self.data.boards[p].rooms_custom; });
        c.appendChild(K.group({ header: 'On Screens', footer: (shown ? 'Show on Home is All Screens’ room order' +
            (own.length ? '; a screen with Rooms of its own keeps its own.' : '.') + ' ' : '') +
            'Hidden: left off every generated screen, with its accessories, and never counted by a chip.' }, [
          K.toggle({ label: 'Show on Screens', sk: 'room:shown:' + aid, on: shown, onChange: function (on) {
            self.setH({ 'generated.exclude_areas': on ? hidden.filter(function (a) { return a !== aid; }) : hidden.concat(aid) });
          } })].concat(shown ? [
          K.toggle({ label: 'Show on Home', sk: 'room:home:' + aid, on: onHome, onChange: function (on) {
            var ch = M.roomOnHome(hb, az, aid, on);
            if (ch) self.setH(M.houseRoomsSave(ch));
          } }),
          K.select({ label: 'Show As Part Of', sk: 'into:' + aid, value: into,
            options: [['', 'Its Own Room']].concat(az.filter(function (a) { return a !== aid; }).map(function (a) { return [a, areas[a].name]; })),
            onChange: function (v) { self.ws({ type: DOMAIN + '/accessory/into', area_id: aid, into: v || null }); } })] : [])));
        if (shown) {
          c.appendChild(K.group({ header: 'Room Page', footer: into ? 'Shown as part of ' + this.areaName(into) + ': its scenes and tile order join that room’s.' :
              'A row of scene pills under the room’s status and cameras, and the order of its tiles — here and on Home.' }, [
            K.nav({ label: 'Scenes', value: this.roomScenesLabel(aid), sk: 'accessories.scenes.' + aid,
                    href: '#/house/rooms/' + encodeURIComponent(aid) + '/scenes' }),
            K.nav({ label: 'Tile Order', value: order.length ? 'Custom' : 'Automatic',
                    href: '#/house/rooms/' + encodeURIComponent(aid) + '/order', sk: 'room:order:' + aid })]));
        }
        c.appendChild(K.group({ footer: 'Each accessory’s name, icon, tile size and more.' }, [
          K.nav({ label: 'Accessories', value: String(nAcc), href: '#/accessories/room/' + encodeURIComponent(aid), icon: 'mdi:lightbulb-group' })]));
        // ITS PAGE'S BACKGROUND (2026-10-13): a photo of the room, say -- the
        // same page as Sky / Background -> Room Pages -> Each Room
        var rk = this.roomKey(aid);
        if (shown && rk) {
          var rflat = this.flatHere(null), rm = rflat ? this.flatPageNow({ key: rk, room: true }, null) : this.skyPageNow({ key: rk, room: true }, null);
          c.appendChild(K.group({ footer: 'Behind this room’s page on every screen: Same as Room Pages, ' + (rflat ? 'Automatic' : 'the Live Sky') + ', a Color or a Photo. A screen can choose its own.' }, [
            K.nav({ label: 'Background', icon: 'mdi:image-outline', sk: (rflat ? 'sky.flat_pages:' : 'sky.pages:') + rk, href: '#/house/appearance/sky/page/' + encodeURIComponent(rk),
                    value: rm.own ? (rflat ? this.flatModeLabel(rm.mode, this.flatTheme(null)) : M.skyModeLabel(rm.mode, (this.data.choices || {}).sky_backdrops || [])) : 'Same as Room Pages' })]
            .concat(this.flatAnywhere() ? [this.flatColorsNav(this.flatScope('house-page', null, null, rk), { icon: 'mdi:palette-outline', inherited: 'Same as Room Pages' })] : [])));
        }
      }
      // A ROOM PAGE'S OWN BACKGROUND KEY: its address, as the screens name it
      // (hk-strategy.js: 'room-' + slug(area id)) -- null if too long to store
      roomKey(aid) {
        var k = 'room-' + String(aid || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return k.length <= 40 && k.length > 5 ? k : null;
      }
      // a page row for its background page: one of the screen's pages, or a
      // room ({key: 'room-...', room: true, label: its name})
      skyRow(key, b) {
        var row = this.skyPageKeys(b).rows.filter(function (r) { return r.key === key; })[0];
        if (row || !/^room-/.test(key)) return row || null;
        var self = this, aid = this.areasAZ().filter(function (a) { return self.roomKey(a) === key; })[0];
        return aid ? { key: key, label: this.areaName(aid), room: true, aid: aid } : null;
      }
      h_music(c) {
        var self = this, browse = this.data.settings.browse, look = this.data.settings.look;
        // THE MUSIC FEATURE'S OWN SETTINGS first (hk-settings-features.js)
        F.musicTop(this, c);
        var cats = (this.data.choices || {}).browse_categories || [];
        c.appendChild(K.group({ header: 'Browse', footer: 'The Browse side of every screen’s Music page. A page whose YAML lists its own keeps them.' }, [
          K.nav({ label: 'Categories', value: (cats.length - (browse.hide || []).length) + ' of ' + cats.length + ' Shown', href: '#/features/music/categories', sk: 'browse.hide' }),
          K.nav({ label: 'Discover Rows', value: (browse.discover || []).length ? String(browse.discover.length) : 'None', href: '#/features/music/discover', sk: 'browse.discover' })]));
        c.appendChild(K.group({ header: 'Advanced', footer: 'The page a speaker’s sheet opens with Browse, on screens written in YAML (generated screens always use their own). Empty: no Browse button.' }, [
          K.text({ label: 'Browse Page', sk: 'look.browse_view', value: look.browse_view, placeholder: 'None', error: this.err('look.browse_view'),
                   onCommit: function (v) { self.setH({ 'look.browse_view': v }); } })]));
        if (F.stateOf(this.data.features, 'hk_music') === 'added') {
          c.appendChild(K.group({}, [K.nav({ label: 'Music', sub: 'In ' + haPlace('Devices & Services'), href: F.integrationHref('hk_music'),
                                             icon: 'mdi:open-in-new', fk: 'feat:open:hk_music' })]));
        }
      }
      h_categories(c) {
        var self = this, cats = (this.data.choices || {}).browse_categories || [], hide = this.data.settings.browse.hide || [];
        c.appendChild(K.group({ header: 'Shown', footer: 'The Library categories on the Music page’s Browse side.' }, cats.map(function (k) {
          var on = hide.indexOf(k) < 0;
          return K.check({ label: M.BROWSE_LABELS[k] || k, multi: true, on: on, fk: 'cat:' + k, onClick: function () {
            self.setH({ 'browse.hide': cats.filter(function (y) { return y === k ? on : hide.indexOf(y) >= 0; }) });
          } });
        })));
      }
      h_discover(c) {
        var self = this, rows = this.data.settings.browse.discover || [], shelves = this.data.shelves || {};
        c.appendChild(K.listEditor({ fk: 'disc', shownHeader: 'Shown', emptyText: 'No Discover section', announce: this.announce.bind(this),
          rows: rows.map(function (k) { return { value: k, label: shelves[k] || k }; }),
          more: Object.keys(shelves).filter(function (k) { return rows.indexOf(k) < 0; }).map(function (k) { return { value: k, label: shelves[k] }; }),
          shownFooter: 'A row with nothing in it yet (no favorite albums) isn’t shown.',
          onChange: function (v) { self.setH({ 'browse.discover': v }); } }));
      }
      // ---------------------------------------------------------- wall tablets (1.14)
      // A TABLET is its own item (settings.py SUBENTRY_TABLET), apart from the
      // screen it runs: its user, room, kiosk app, idle and Sleep Screen.
      tabs() { return (this.data && this.data.tablets) || {}; }
      tabIds() {
        var t = this.tabs();
        return Object.keys(t).sort(function (a, b) { return String(t[a].name).localeCompare(String(t[b].name)); });
      }
      setT(tid, changes) {
        var d = this.data, house = (d.settings && d.settings.tablets) || {};
        return this.save({ type: DOMAIN + '/tablet/set', tablet: tid, changes: changes },
          Object.keys(changes).map(function (k) { return 't:' + k; }), function () {
            var t = d.tablets[tid] = Object.assign({}, d.tablets[tid] || {}, changes);
            if ('idle_time' in changes) {
              t.idle_time_own = changes.idle_time;
              if (changes.idle_time === null) t.idle_time = typeof house.idle_time === 'number' ? house.idle_time : 50;
            }
            if ('idle_return' in changes) {
              t.idle_return_own = changes.idle_return;
              if (changes.idle_return === null) t.idle_return = house.idle_return !== false;
            }
          }, function (r) { if (r && r.tablet) d.tablets[tid] = Object.assign({}, d.tablets[tid] || {}, r.tablet); });
      }
      tabletStatusOf(tid) {
        return M.tabletStatus(this.tabs()[tid], this.client.states, (this.data.screensavers || {})[tid]);
      }
      // a time from Home Assistant, as the house reads it: 8:16 PM; another
      // day's with its day
      when(iso) {
        var d = new Date(iso);
        if (!iso || isNaN(d.getTime())) return '';
        var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        var now = new Date();
        if (d.toDateString() === now.toDateString()) return t;
        var y = new Date(now.getTime() - 86400000);
        return (d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + ', ' + t;
      }
      screenTitle(path) { var x = path && this.dash(path); return x ? x.title : (path || 'No Screen'); }
      tabTile(st) { return { off: C.red, dark: C.gray, photos: C.purple, awake: C.green }[st] || C.blue; }
      // press a kiosk app's buttons (the tablets' own Reload, Clear Cache ...):
      // HA's buttons, or the host's own parts (its press). Resolves true, or
      // false once a failure has been said (`what`: "Couldn't Reload")
      press(ids, what) {
        var self = this;
        ids = (ids || []).filter(Boolean);
        if (!ids.length) return Promise.resolve(true);
        var hx = this.host(), go = null;
        if (hx && typeof hx.press === 'function') { try { go = hx.press(ids, this); } catch (e) { go = Promise.reject(e); } }
        if (!go) go = this.actions().callService('button', 'press', { entity_id: ids });
        return Promise.resolve(go).then(function () { return true; }, function (e) {
          var msg = (e && e.message) || String(e || 'It failed.');
          self.announce('Couldn’t: ' + msg);
          K.confirm(self.shadowRoot, { title: 'Couldn’t ' + (what || 'Do That'), message: msg, ok: 'OK', cancel: false });
          return false;
        });
      }
      // THE ACTION PORT (HKClient) of this panel's client: every save, service
      // call, config flow and upload goes through it. A host that cannot act
      // refuses there, sending nothing.
      actions() { return this.client.actions; }
      // AN HTTP WRITE to the host's API (the config flows: start a step,
      // answer it, abandon it), through the action port; see restWrite.
      rest(method, path, body) { return restWrite(this.actions(), method, path, body); }
      // the kiosk apps' Clear Cache, then -- once it has had a moment -- Reload:
      // the way a tablet picks up new HK files (a reload alone keeps them)
      clearAndReload(tids) {
        var self = this, tabs = this.tabs();
        var parts = tids.map(function (t) { return (tabs[t] || {}).parts || {}; });
        return this.press(parts.map(function (p) { return p.clear_cache; }), 'Clear the Cache').then(function (ok) {
          if (!ok) return false;
          return new Promise(function (r) { setTimeout(r, 5000); }).then(function () {
            return self.press(parts.map(function (p) { return p.reload; }), 'Reload');
          });
        });
      }
      h_tablets(c) {
        var self = this, tabs = this.tabs(), ids = this.tabIds(), st = this.client.states;
        var hs = (this.data.settings && this.data.settings.tablets) || {};
        // WHAT MAY BE A TABLET that isn't one (tablets.py suggestions)
        (this.data.tablet_suggest || []).forEach(function (sg) {
          var app = M.tabletApp(sg.app)[1];
          var what = sg.device
            ? 'The ' + app + ' device “' + sg.name + '”' + (sg.ip ? ' (' + sg.ip + ')' : '') + ' isn’t on a wall tablet yet' +
              (sg.screen ? '. It’s showing ' + self.screenTitle(sg.screen) + '.' : '.')
            : app + ' is showing ' + (sg.screen ? self.screenTitle(sg.screen) : 'a screen') + ', signed in as ' + sg.user + '.';
          c.appendChild(K.group({ header: 'This Looks Like a Wall Tablet', footer: what + ' Not a Tablet: it won’t be suggested again.' }, [
            K.button({ label: 'Add Tablet…', fk: 'sug:add:' + sg.key, onClick: function () { self._addFrom = sg; self.go('#/house/tablets/add'); } }),
            K.button({ label: 'Not a Tablet', fk: 'sug:no:' + sg.key, onClick: function () {
              self.data.tablet_suggest = (self.data.tablet_suggest || []).filter(function (x) { return x.key !== sg.key; });
              self.setH({ 'tablets.dismissed': (hs.dismissed || []).concat(sg.key) });
              self.render();
            } })]));
        });
        var rows = ids.map(function (tid) {
          var t = tabs[tid], ts = self.tabletStatusOf(tid);
          var v = !ts.known ? '' : ts.st === 'off' ? 'Offline' : ts.word + (ts.batt !== null ? ' · ' + ts.batt + '%' : '');
          return K.nav({ tile: ['mdi:tablet', ts.known ? self.tabTile(ts.st) : C.blue], label: t.name,
                         sub: self.screenTitle(t.screen) + ' screen · ' + M.tabletApp(t.app)[1], value: v,
                         href: '#/house/tablets/' + encodeURIComponent(tid), fk: 'tab:' + tid });
        });
        rows.push(K.nav({ tile: ['mdi:plus', C.gray], label: 'Add Tablet…', href: '#/house/tablets/add', sk: 'tablet:add' }));
        c.appendChild(K.group({ header: 'Tablets', footer: ids.length
            ? 'Dark: nobody’s in the room, or it’s quiet hours. Each tablet’s page says why, and since when.'
            : 'A wall tablet runs a screen. Its idle time, its screensaver and how it sleeps are its own.' }, rows));
        // THE HOST'S OWN, for the tablets as a whole (extend 'tablets'): nothing in Home Assistant
        var hxs = this.host();
        if (hxs && typeof hxs.extend === 'function') {
          try { hxs.extend('tablets', c, { tablets: tabs }, this); } catch (e) { /* the host's own page */ }
        }
        if (ids.length) {
          var probs = [];
          ids.forEach(function (tid) {
            M.tabletChecks(tabs[tid], st).forEach(function (ch) { if (!ch.ok) probs.push([tid, ch]); });
          });
          c.appendChild(K.group({ footer: 'Each tablet’s kiosk app, checked against what HK needs. They’re in System → Setup Check too.' }, [
            K.nav({ tile: [probs.length ? 'mdi:alert' : 'mdi:check', probs.length ? C.orange : C.green], label: 'Setup Check', sk: 'tablets:check',
                    value: probs.length ? probs.length + ' to look at: ' + tabs[probs[0][0]].name : 'All Set Up Right',
                    href: probs.length ? '#/house/tablets/' + encodeURIComponent(probs[0][0]) : '#/check' })]));
        }
        var it = typeof hs.idle_time === 'number' ? hs.idle_time : 50;
        var saver = M.saverOptions(this.hs('look.saver'));
        c.appendChild(K.group({ header: 'All Tablets', footer: 'A tablet uses these unless its own page sets its own. Untouched this long on any page but Home, it goes back to Home.' }, [
          K.toggle({ label: 'Return to Home When Idle', sk: 'tablets.idle_return', on: hs.idle_return !== false,
                     onChange: function (on) { self.setH({ 'tablets.idle_return': on }); } }),
          K.select({ label: 'Idle Time', sk: 'tablets.idle_time', value: it, disabled: hs.idle_return === false,
                     options: M.IDLE_TIMES.map(function (o) { return [o[0], o[1]]; }),
                     onChange: function (v) { self.setH({ 'tablets.idle_time': Number(v) }); } }),
          K.nav({ label: 'Screensaver', sub: 'What it shows, and when it starts.', value: M.saverSummary(saver),
                  href: '#/house/screensaver', sk: 'tablets:saver' })]));
        c.appendChild(K.group({ header: 'Alerts', footer: 'In Home Assistant’s notifications until it’s put right — and, with Notifications added, as an Important banner on the screens.' }, [
          K.toggle({ label: 'Tablet Offline', sub: 'Its kiosk app not heard from for 10 minutes.', sk: 'tablets.alert_offline',
                     on: hs.alert_offline !== false, onChange: function (on) { self.setH({ 'tablets.alert_offline': on }); } }),
          K.toggle({ label: 'Didn’t Come Back After a Restart', sub: 'Not in front 3 minutes after the scheduled restart.', sk: 'tablets.alert_restart',
                     on: hs.alert_restart !== false, onChange: function (on) { self.setH({ 'tablets.alert_restart': on }); } }),
          K.toggle({ label: 'Not Charging', sub: 'Unplugged for 10 minutes.', sk: 'tablets.alert_charging',
                     on: hs.alert_charging !== false, onChange: function (on) { self.setH({ 'tablets.alert_charging': on }); } })]));
        var times = (hs.restart_times || ['00:02', '15:00']);
        var rs = [K.toggle({ label: 'Scheduled Restart', sub: 'Clear the cache, then restart each tablet.', sk: 'tablets.restart', on: !!hs.restart,
                             onChange: function (on) { self.setH({ 'tablets.restart': on }); } })];
        if (hs.restart) {
          rs.push(K.text({ label: 'At', sk: 'tablets.restart_times', value: times.join(', '), placeholder: '00:02, 15:00',
                           error: this.err('tablets.restart_times') ? 'Times like 00:02, 15:00 (up to four).' : null,
                           onCommit: function (v) {
                             self.setH({ 'tablets.restart_times': v.split(/[,\s]+/).filter(Boolean) });
                           } }));
        }
        c.appendChild(K.group({ header: 'Upkeep', footer: 'Every tablet whose kiosk app can restart (Restart Tablet needs Kiosk Satellite as the device owner, else its app restarts). If your own automation already does this, leave it off.' }, rs));
        var withReload = ids.filter(function (tid) { return (tabs[tid].parts || {}).reload; });
        c.appendChild(K.group({ header: 'All at Once', footer: 'After updating ' + PN() + ', Clear Cache & Reload: a plain reload keeps the old HK files.' }, [
          K.button({ label: 'Reload All', fk: 'tablets:reload', disabled: !withReload.length, onClick: function () {
            var p = withReload.map(function (tid) { return tabs[tid].parts.reload; });
            self.press(p, 'Reload').then(function (ok) { if (ok) self.announce('Reloading ' + p.length + (p.length === 1 ? ' tablet' : ' tablets')); });
          } }),
          K.button({ label: 'Clear Cache & Reload All', fk: 'tablets:clear', disabled: !withReload.length, onClick: function () {
            self.announce('Clearing the cache, then reloading. Each takes up to a minute.');
            self.clearAndReload(withReload);
          } })]));
      }
      // ONE TABLET'S PAGE: how it's doing, when it's left alone, its idle,
      // setup, checks and actions
      t_one(c, tid) {
        var self = this, t = this.tabs()[tid];
        if (!t) { c.appendChild(K.group({ footer: 'There is no such tablet. It may have been removed.' }, [])); return; }
        var client = this.client, st = client.states, p = t.parts || {}, base = '#/house/tablets/' + encodeURIComponent(tid);
        var ts = this.tabletStatusOf(tid), ids = (this.data.screensavers || {})[tid] || {};
        var house = (this.data.settings && this.data.settings.tablets) || {};
        var set = function (ch) { return self.setT(tid, ch); };
        var val = function (id) { var x = id && st[id]; return x && x.state !== 'unknown' && x.state !== 'unavailable' ? x.state : null; };
        var sl = t.sleep || {}, hk = sl.decided_by === 'hk' || sl.decided_by === 'shadow', acting = sl.decided_by === 'hk';
        // NOW
        var now = [];
        if (ts.known) {
          now.push(K.info({ label: ts.word, sub: ts.why ? ts.why.charAt(0).toUpperCase() + ts.why.slice(1) : null,
                            value: ts.since ? 'Since ' + this.when(ts.since) : '', valueCls: ts.st === 'off' ? 'warn' : '',
                            tile: ['mdi:tablet', this.tabTile(ts.st)] }));
        }
        if (p.battery) {
          now.push(K.info({ label: 'Battery', value: (ts.batt !== null ? ts.batt + '%' : '—') +
                            (ts.charging ? ' · Charging' : ts.charging === false ? ' · Not Charging' : ''),
                            valueCls: ts.charging && ts.batt > 85 ? 'warn' : '' }));
        }
        if (p.brightness && val(p.brightness) !== null) {
          var bv = Number(val(p.brightness));
          now.push(K.info({ label: 'Brightness', value: (t.app === 'fully' ? Math.round(bv / 2.55) : Math.round(bv)) + '%' }));
        }
        if (val(p.touched)) now.push(K.info({ label: 'Last Touched', value: this.when(val(p.touched)) }));
        if (val(p.uptime)) now.push(K.info({ label: 'Running Since', sub: 'Its last restart.', value: this.when(val(p.uptime)) }));
        if (val(p.model) || val(p.version)) {
          now.push(K.info({ label: 'Device', value: [val(p.model), val(p.version) ? M.tabletApp(t.app)[1] + ' ' + val(p.version) : ''].filter(Boolean).join(' · ') }));
        }
        if (now.length) {
          c.appendChild(K.group({ header: 'Now', footer: ids.sleep ? 'Why comes from ' + ids.sleep + ', which automations can read too.' : null }, now));
        }
        // WHEN IT'S LEFT ALONE: Home, the screensaver, dark -- in order
        var b = (this.data.boards || {})[t.screen] || null;
        var saverOn = !!(b && b.screensaver && b.screensaver_engine !== 'wallpanel');
        var so = b ? M.saverOptions(M.saverFollows(b) ? this.hs('look.saver') : b.screensaver_options) : null;
        var tl = M.idleTimeline({ idle: t.idle_return ? t.idle_time : null, saver: saverOn ? so.starts_after : null, hk: hk,
                                  after: sl.after_saver, quiet: !!(sl.schedule || (sl.quiet_while || []).length) });
        var tot = tl.segs.reduce(function (n, x) { return n + x.flex; }, 0), at = 0;
        var track = h('div', { class: 'track' }), ticks = h('div', { class: 'ticks' });
        tl.segs.forEach(function (x, i) {
          track.appendChild(h('div', { class: 'seg ' + x.cls, style: 'flex:' + x.flex, text: x.label }));
          if (i) ticks.appendChild(h('span', { style: 'left:' + (at / tot * 100).toFixed(1) + '%' }, [h('b', { text: x.at }), x.says]));
          at += x.flex;
        });
        var tlEl = h('div', { class: 'cell tl', 'data-sk': 't:timeline' }, [track, ticks,
          tl.warn ? h('div', { class: 'tlwarn', text: 'Home comes after the screensaver starts, so the screensaver can come up over another page and it goes Home behind it. An Idle Time shorter than ' + M.idleLabel(so.starts_after).toLowerCase() + ' puts Home first.' }) : null]);
        c.appendChild(K.group({ header: 'When It’s Left Alone', footer: 'Home: Idle Time, below. The screensaver: its screen’s Screensaver Options → Starts After. Dark: Sleep Screen.' }, [tlEl,
          K.nav({ label: 'Sleep Screen', sub: 'When it goes dark, who counts as there, its brightness.', href: base + '/sleep', sk: 't:sleep',
                  value: acting ? PN() + ' Decides' : sl.decided_by === 'shadow' ? 'Trying It Out' : 'An Automation Decides' })]));
        // WHEN IDLE: its own, or All Tablets'
        var ownRet = t.idle_return_own, ownIt = t.idle_time_own;
        var hRet = house.idle_return !== false ? 'On' : 'Off', hIt = M.idleLabel(typeof house.idle_time === 'number' ? house.idle_time : 50);
        var idleRows = [
          K.select({ label: 'Return to Home When Idle', sub: ownRet === null || ownRet === undefined ? 'Same as All Tablets' : 'Just This Tablet',
                     sk: 't:idle_return', value: ownRet === null || ownRet === undefined ? '' : ownRet ? 'on' : 'off',
                     options: [['', 'Same as All Tablets (' + hRet + ')', hRet], ['on', 'On'], ['off', 'Off']],
                     onChange: function (v) { set({ idle_return: v === '' ? null : v === 'on' }); } })];
        if (t.idle_return) {
          idleRows.push(K.select({ label: 'Idle Time', sub: ownIt === null || ownIt === undefined ? 'Same as All Tablets' : 'Just This Tablet',
            sk: 't:idle_time', value: ownIt === null || ownIt === undefined ? '' : ownIt,
            options: [['', 'Same as All Tablets (' + hIt + ')', hIt]].concat(M.IDLE_TIMES.map(function (o) { return [o[0], o[1]]; })),
            onChange: function (v) { set({ idle_time: v === '' ? null : Number(v) }); } }));
        }
        if (b && b.screensaver) {
          idleRows.push(K.nav({ label: 'Screensaver Options', sub: 'The ' + this.screenTitle(t.screen) + ' screen’s: what it shows here.',
            href: '#/screens/' + encodeURIComponent(t.screen) + (b.screensaver_engine === 'wallpanel' ? '/wallpanel' : '/screensaver'),
            value: M.saverFollows(b) ? 'Same as All Screens' : 'Just This Screen', sk: 't:saver' }));
        } else if (t.screen) {
          idleRows.push(K.nav({ label: 'Screensaver', sub: 'Off on the ' + this.screenTitle(t.screen) + ' screen.', value: 'Off',
                                href: '#/screens/' + encodeURIComponent(t.screen), sk: 't:saver' }));
        }
        c.appendChild(K.group({ header: 'When Idle' }, idleRows));
        // SETUP
        var dashes = (this.data.dashboards || []).filter(function (x) { return x.item || x.path === t.screen; });
        var users = (this.data.users || []).slice();
        if (t.user && users.indexOf(t.user) < 0) users.push(t.user);
        var devArea = t.device && client.devices && client.devices[t.device] ? client.devices[t.device].area_id : '';
        var hostOwn = (this.host() && this.host().owns) || {};
        var setup = [
          K.text({ label: 'Name', sk: 't:name', value: t.name, error: this.err('t:name') ? 'Give it a name.' : null,
                   onCommit: function (v) { if (v.trim()) set({ name: v.trim() }); } }),
          K.select({ label: 'Screen', sub: 'What it shows. A screen can run on several tablets.', sk: 't:screen', value: t.screen || '',
                     options: [['', 'None']].concat(dashes.map(function (x) { return [x.path, x.title]; })),
                     onChange: function (v) { set({ screen: v }); } }),
          K.select({ label: 'Room', sk: 't:room', value: t.room || '',
                     sub: devArea && devArea !== t.room ? 'Its kiosk device is in ' + this.areaName(devArea) + ' in Home Assistant.' : 'Calm When Nobody’s Around looks here.',
                     options: [['', 'None']].concat(this.areasAZ().map(function (a) { return [a, self.areaName(a)]; })),
                     onChange: function (v) { set({ room: v }); } }),
          hostOwn.tablet_user ? null : K.select({ label: 'Tablet User', sub: 'The person it signs in as. Its own is best.', sk: 't:user', value: t.user || '',
                     options: [['', 'None']].concat(users.map(function (u) { return [u, u]; })),
                     onChange: function (v) { set({ user: v }); } }),
          K.select({ label: 'Kiosk App', sk: 't:app', value: t.app, options: M.TABLET_APPS.map(function (a) { return [a[0], a[1]]; }),
                     onChange: function (v) { set(v === 'kiosk_satellite' || v === 'fully' ? { app: v } : { app: v, device: '' }); } })];
        if (t.app === 'kiosk_satellite' || t.app === 'fully') {
          var devs = (this.data.kiosk_devices || []).filter(function (d) { return d.app === t.app; });
          setup.push(K.select({ label: 'Device', sk: 't:device', value: t.device || '', placeholder: 'Choose…',
                                options: [['', 'None']].concat(devs.map(function (d) { return [d.id, d.name]; })),
                                onChange: function (v) { set({ device: v }); } }));
        }
        var url = M.tabletUrl(location.origin, t.screen, tid);
        setup.push(K.button({ label: 'Copy Start URL', fk: 't:url', onClick: function () { self.copyText(url); } }));
        c.appendChild(K.group({ header: 'Setup', footer: h('span', {}, [
          'Its start URL, for the kiosk app’s start page: ', h('span', { class: 'url', text: url }),
          '. It tells the page which tablet it is, even when two tablets share a user or a screen.']) }, setup));
        // THE HOST'S OWN, for this tablet (extend, above): nothing in Home Assistant
        var hx = this.host();
        if (hx && typeof hx.extend === 'function') {
          try { hx.extend('tablet', c, { tablet: tid, name: t.name, app: t.app }, this); } catch (e) { /* the host's own page */ }
        }
        // SETUP CHECK, with Fix where HK can set it right
        var checks = M.tabletChecks(t, st);
        if (checks.length) {
          var cr = [];
          checks.forEach(function (ch) {
            cr.push(K.info({ icon: ch.ok ? 'mdi:check-circle' : 'mdi:alert-circle', label: ch.title, sub: ch.detail || null,
                             value: ch.ok ? 'OK' : 'To Fix', valueCls: ch.ok ? 'ok' : 'warn' }));
            if (!ch.ok && ch.fix) {
              cr.push(K.button({ label: 'Fix: ' + ch.title, fk: 't:fix:' + ch.key, onClick: function () {
                var go = ch.fix[0] === 'hk'
                  ? self.actions().callWS({ type: DOMAIN + '/tablet/act', tablet: tid, act: 'kiosk_saver' })
                  : self.actions().callService(ch.fix[0], ch.fix[1], ch.fix[2]);
                Promise.resolve(go).then(function () { self.announce('Done: ' + ch.title); setTimeout(function () { self.render(true); }, 1500); },
                                         function (e) { self.announce('Couldn’t: ' + ((e && e.message) || e)); });
              } }));
            }
          });
          c.appendChild(K.group({ header: 'Setup Check', footer: 'Fix sets the kiosk app’s own setting from here. Protect Battery is set on the tablet itself.' }, cr));
        }
        // ACTIONS: what its kiosk app (and Sleep Screen) can do
        var act = [];
        var ask = function (what) {
          return self.actions().callWS({ type: DOMAIN + '/tablet/act', tablet: tid, act: what }).then(function () {
            self.announce(what === 'wake' ? t.name + ' is waking' : t.name + ' is going dark');
          }, function (e) { self.announce('Couldn’t: ' + ((e && e.message) || e)); });
        };
        if (acting) {
          act.push(K.button({ label: 'Wake Now', fk: 't:wake', onClick: function () { ask('wake'); } }));
          act.push(K.button({ label: 'Sleep Now', fk: 't:sleepnow', onClick: function () { ask('sleep'); } }));
        }
        if (p.reload) act.push(K.button({ label: 'Reload', fk: 't:reload', onClick: function () { self.press([p.reload], 'Reload').then(function (ok) { if (ok) self.announce('Reloading ' + t.name); }); } }));
        if (p.reload && p.clear_cache) act.push(K.button({ label: 'Clear Cache & Reload', fk: 't:clear', onClick: function () { self.announce('Clearing the cache, then reloading'); self.clearAndReload([tid]); } }));
        if (p.restart_app) act.push(K.button({ label: 'Restart App', fk: 't:restartapp', onClick: function () { self.press([p.restart_app], 'Restart the App').then(function (ok) { if (ok) self.announce('Restarting the app'); }); } }));
        if (p.restart_device) {
          act.push(K.button({ label: 'Restart Tablet…', destructive: true, fk: 't:restart', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Restart ' + t.name + '?', message: 'The tablet restarts and comes back to its screen in about a minute.',
                                         ok: 'Restart', destructive: true }).then(function (yes) {
              if (yes) self.press([p.restart_device], 'Restart the Tablet').then(function (ok) { if (ok) self.announce('Restarting ' + t.name); });
            });
          } }));
        }
        if (act.length) {
          c.appendChild(K.group({ header: 'Actions', footer: acting ? 'Wake Now and Sleep Now: Sleep Screen decides again after — somebody in the room wakes it.' : null }, act));
        }
        if (hk && this.tabIds().length > 1) {
          c.appendChild(K.group({}, [K.nav({ label: 'Copy Sleep Screen To…', sub: 'Its rules and brightness, onto other tablets.', href: base + '/copy', sk: 't:copy' })]));
        }
        c.appendChild(K.group({ footer: 'Its screen and its kiosk app stay. Its own entities go.' }, [
          K.button({ label: 'Remove Tablet…', destructive: true, fk: 't:remove', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Remove ' + t.name + '?', message: 'Its idle, screensaver and Sleep Screen settings and its own entities go. Its screen and its kiosk app stay.',
                                         ok: 'Remove', destructive: true }).then(function (yes) {
              if (!yes) return;
              self.ws({ type: DOMAIN + '/tablet/remove', tablet: tid }).then(function (ok) {
                if (ok) self.reload().then(function () { self.go('#/house/tablets'); });
              });
            });
          } })]));
      }
      copyText(text) {
        var self = this;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { self.announce('Copied'); }, function () { self.announce(text); });
        } else self.announce(text);
      }
      // ADD TABLET: its name, screen, room, kiosk app (and device) and user
      t_add(c) {
        var self = this, sg = this._addFrom || null;
        var n = this._newT = this._newT || {
          name: sg && sg.name ? sg.name.replace(/\s*Kiosk\s*$/i, '') : '', screen: (sg && sg.screen) || this._addScreen || '',
          room: '', user: (sg && sg.user) || '', app: (sg && sg.app) || 'kiosk_satellite', device: (sg && sg.device) || ''
        };
        this._addFrom = null; this._addScreen = null;
        var redraw = function () { self.render(); };
        var dashes = (this.data.dashboards || []).filter(function (x) { return x.item; });
        var used = {};
        Object.keys(this.tabs()).forEach(function (k) { if (self.tabs()[k].device) used[self.tabs()[k].device] = true; });
        var rows = [
          K.text({ label: 'Name', sk: 'new:name', value: n.name, placeholder: 'Garage', onCommit: function (v) { n.name = v.trim(); redraw(); } }),
          K.select({ label: 'Screen', sk: 'new:screen', value: n.screen, options: [['', 'None']].concat(dashes.map(function (x) { return [x.path, x.title]; })),
                     onChange: function (v) { n.screen = v; } }),
          K.select({ label: 'Room', sk: 'new:room', value: n.room, options: [['', 'None']].concat(this.areasAZ().map(function (a) { return [a, self.areaName(a)]; })),
                     onChange: function (v) { n.room = v; } })];
        c.appendChild(K.group({}, rows));
        var app = [K.select({ label: 'Kiosk App', sk: 'new:app', value: n.app, options: M.TABLET_APPS.map(function (a) { return [a[0], a[1]]; }),
                              onChange: function (v) { n.app = v; n.device = ''; redraw(); } })];
        if (n.app === 'kiosk_satellite' || n.app === 'fully') {
          var devs = (this.data.kiosk_devices || []).filter(function (d) { return d.app === n.app; });
          devs.sort(function (a, b) { return (used[a.id] ? 1 : 0) - (used[b.id] ? 1 : 0); });
          app.push(K.select({ label: 'Device', sk: 'new:device', value: n.device, placeholder: 'Choose…',
                              options: [['', 'Choose…']].concat(devs.map(function (d) { return [d.id, d.name + (used[d.id] ? ' (on a tablet)' : '')]; })),
                              onChange: function (v) { n.device = v; } }));
        }
        c.appendChild(K.group({ header: 'Kiosk App', footer: M.tabletApp(n.app)[2] + (n.app === 'browser' ? ' Choose this for a screen HK can’t see a kiosk app on: an old iPad, or a car.' : '') }, app));
        var users = (this.data.users || []).slice();
        c.appendChild(K.group({ header: 'Signs In As', footer: 'Best: a person of its own in Home Assistant (Settings → People → Add Person, with a login), so it gets its own music room and screensaver, and nobody’s phone counts as it.' }, [
          K.select({ label: 'Tablet User', sk: 'new:user', value: n.user, options: [['', 'None']].concat(users.map(function (u) { return [u, u]; })),
                     onChange: function (v) { n.user = v; } }),
          K.nav({ label: 'Add a Person in Home Assistant', icon: 'mdi:open-in-new', href: '/config/person', sk: 'new:person' })]));
        c.appendChild(K.group({ footer: 'Its page then has its start URL to put in the kiosk app.' }, [
          K.button({ label: 'Add Tablet', fk: 'new:add', disabled: !n.name, onClick: function () {
            var got = null;
            self.save({ type: DOMAIN + '/tablet/add', tablet: { name: n.name, screen: n.screen, room: n.room, user: n.user, app: n.app, device: n.device } },
                      ['t:name'], function () {}, function (r) { got = r; }).then(function (ok) {
              if (!ok || !got || !got.id) return;
              self._newT = null;
              self.reload().then(function () { self.go('#/house/tablets/' + encodeURIComponent(got.id)); });
            });
          } })]));
      }
      // COPY SLEEP SCREEN onto other tablets: its rules, Black Screen and
      // brightness (each keeps its own kiosk)
      t_copySleep(c, tid) {
        var self = this, tabs = this.tabs(), src = tabs[tid];
        var pick = this._copyT = this._copyT && this._copyT.from === tid ? this._copyT : { from: tid, to: [] };
        var others = this.tabIds().filter(function (x) { return x !== tid; });
        c.appendChild(K.group({ header: 'Copy To', footer: 'Presence, Only While Lit and the other lists are copied as they are: change each room’s own sensors afterwards.' },
          others.map(function (x) {
            var on = pick.to.indexOf(x) >= 0;
            return K.check({ label: tabs[x].name, multi: true, on: on, fk: 'copyt:' + x, onClick: function () {
              if (on) pick.to = pick.to.filter(function (y) { return y !== x; }); else pick.to.push(x);
              self.render();
            } });
          })));
        c.appendChild(K.group({}, [K.button({ label: pick.to.length ? 'Copy to ' + pick.to.length + (pick.to.length === 1 ? ' Tablet' : ' Tablets') : 'Copy',
          fk: 'copyt:go', disabled: !pick.to.length, onClick: function () {
            Promise.all(pick.to.map(function (x) {
              return self.setT(x, { sleep: JSON.parse(JSON.stringify(src.sleep || {})), black_screen: src.black_screen || 'kiosk' });
            })).then(function () { self._copyT = null; self.announce('Copied'); self.go('#/house/tablets/' + encodeURIComponent(tid)); });
          } })]));
      }
    };
    KIT.install(Methods);
  };
})();
