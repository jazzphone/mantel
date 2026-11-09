// hk-settings-accessories.js - Accessories and Hidden Accessories.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-accessories'] = function (KIT) {
    var DOMAIN = KIT.DOMAIN, loadCards = KIT.loadCards, PAGE_ORDERS = KIT.PAGE_ORDERS, SCENE_POOL = KIT.SCENE_POOL,
        TILE_DOMAINS = KIT.TILE_DOMAINS;

    var F, h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      F = s.F; h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ---------------------------------------------------------- accessories
      accIds() {
        var self = this, client = this.client, ents = client.entities || {}, acc = (this.data.accessories || {}).entities || {};
        var chipIds = {};
        Object.keys(this.data.boards || {}).forEach(function (p) {
          ((self.data.boards[p] || {}).chips_extra || []).forEach(function (id) { chipIds[id] = true; });
        });
        return Object.keys(client.states).filter(function (id) {
          var e = ents[id] || {};
          if (acc[id] || chipIds[id]) return true;
          if (!TILE_DOMAINS.test(id) || e.hidden || e.entity_category) return false;
          return !!self.areaOf(id) || id.indexOf('timer.') === 0;
        });
      }
      p_accessories(sub) {
        var self = this, back = ['Accessories', '#/accessories'];
        if (sub[0] !== 'hidden') this._hr = null;          // Just Now: until the list is left
        // HIDDEN ACCESSORIES (hiding.py): the list, Hide Accessories (pick, then
        // where), and one accessory's or device's own Hide From
        if (sub[0] === 'hidden') {
          var hb = ['Hidden Accessories', '#/accessories/hidden'];
          if (sub[1] !== undefined && sub[1] !== 'edit' && sub[1] !== 'device') this._hr = null;
          if (sub[1] === 'pick') return { title: 'Hide Accessories', back: hb, body: function (c) { self.a_hidePick(c); } };
          if (sub[1] === 'where') return { title: 'Hide From', back: ['Hide Accessories', '#/accessories/hidden/pick'], body: function (c) { self.a_hideWhere(c, null); } };
          if (sub[1] === 'edit' && sub[2]) return { title: 'Hide From', back: hb, scope: K.esc(this.name(sub[2])) + ' · ' + K.esc(sub[2]),
                                                    body: function (c) { self.a_hideWhere(c, sub[2]); } };
          if (sub[1] === 'kind' && sub[2]) return { title: this.placeName(sub[2]), back: hb, scope: 'Hidden from ' + K.esc(this.placeName(sub[2])) + '.',
                                                    body: function (c) { self.a_hideKind(c, sub[2]); } };
          if (sub[1] === 'device' && sub[2]) return { title: this.devName(sub[2]), back: hb, body: function (c) { self.a_hideDevice(c, sub[2]); } };
          return { title: 'Hidden Accessories', back: back, scope: 'Each one stays in Home Assistant. Hidden everywhere, or just from the places listed.',
                   body: function (c) { self.a_hidden(c); } };
        }
        // ADDED ACCESSORIES (was Also Shown, 2026-10-13): tiles for what HK
        // wouldn't show by itself -- generated.include_entities
        if (sub[0] === 'added' || sub[0] === 'also') return { title: 'Added Accessories', back: back,
          scope: 'Tiles for things HK doesn’t show by itself — a script, a scene, a sensor. Hidden Accessories is the other way.',
          body: function (c) { self.a_also(c); } };
        // A TYPE (2026-10-13): what it lists, what its page and chip count, its
        // order -- What Counts' kind pages, folded in
        if (sub[0] === 'type' && M.accType(sub[1])) {
          var T = M.accType(sub[1]), tb = [T[1], '#/accessories/type/' + sub[1]];
          if (sub[2] === 'order' && T[4].order) return { title: 'Tile Order', back: tb, scope: this.orderScope(T[4].order),
                                                         body: function (c) { self.a_pageOrder(c, T[4].order); } };
          return { title: T[1], back: back, scope: K.esc(this.typeSays(T)), body: function (c) { self.a_type(c, T); } };
        }
        if (sub[0] === 'page' && PAGE_ORDERS[sub[1]]) return { title: 'Tile Order', back: back, scope: this.orderScope(sub[1]),
                                                               body: function (c) { self.a_pageOrder(c, sub[1]); } };
        if (sub[0] === 'room' && sub[1]) {
          var nm = sub[1] === '-' ? 'No Room' : sub[1] === '~timers' ? 'Timers' : this.areaName(sub[1]);
          if (sub[2] === 'order') return { title: 'Tile Order', back: [nm, '#/accessories/room/' + encodeURIComponent(sub[1])], body: function (c) { self.a_roomOrder(c, sub[1]); } };
          if (sub[2] === 'scenes') return { title: 'Scenes', back: [nm, '#/accessories/room/' + encodeURIComponent(sub[1])], body: function (c) { self.a_roomScenes(c, sub[1]); } };
          return { title: nm, back: back, body: function (c) { self.a_room(c, sub[1]); } };
        }
        if (sub[0]) {
          var id = sub[0], a = this.areaOf(id);
          return { title: this.name(id), back: a ? [this.areaName(a), '#/accessories/room/' + encodeURIComponent(a)] : back,
            scope: K.esc((a ? this.areaName(a) + ' · ' : '') + id) + ' · the same on every screen',
            body: function (c) { self.a_one(c, id); } };
        }
        return { title: 'Accessories', top: true, scope: 'How each accessory shows on every screen: its name, room, icon and where it appears. Home Assistant’s own names are untouched unless you turn on Also rename in Home Assistant.',
                 body: function (c) { self.a_root(c); } };
      }
      // ACCESSORIES, laid out by type and then by room (2026-10-13). A type's
      // number is what its page and chip count (a kind's `found`), or how
      // many of its domain HK shows.
      typeMembers(T) {
        var self = this, o = T[4], client = this.client;
        if (o.energy) return [];
        if (o.kind) {
          var ck = (this.data.counts || {})[o.kind] || {}, H = this.hid(), seen = {}, out = [];
          var add = function (id) { if (!seen[id] && client.states[id]) { seen[id] = 1; out.push(id); } };
          (ck.found || []).forEach(add);
          (ck.exclude || []).forEach(add);
          // A group is a control even when its members alone count in status.
          self.accIds().forEach(function (id) {
            var a = (client.states[id] || {}).attributes || {}, e = (client.entities || {})[id] || {};
            if ((Array.isArray(a.entity_id) || Array.isArray(a.group_entities)) &&
                self.typeOf(id) === T[0] && !e.hidden && !e.entity_category && !self.hiddenAll(id)) add(id);
          });
          return out;
        }
        return this.accIds().filter(function (id) {
          if (o.domains.indexOf(id.split('.')[0]) < 0 || self.hiddenAll(id)) return false;
          return !o.dc || o.dc.indexOf(((client.states[id] || {}).attributes || {}).device_class) >= 0;
        });
      }
      // hidden everywhere (by itself, its device or its room): one row on a
      // type's page, not a row each in its room -- the old duplicates a house
      // hides would crowd every room
      hiddenAll(id) { return /^(Everywhere|With Its)/.test(this.hideText(id)); }
      typeHidden(T) {
        var self = this, o = T[4], H = this.hid(), client = this.client;
        if (o.energy) return [];
        if (o.kind) return H.everywhere.filter(function (id) { return client.states[id] && (H.can[id] || []).indexOf(o.kind) >= 0; });
        return this.accIds().filter(function (id) {
          if (o.domains.indexOf(id.split('.')[0]) < 0 || !self.hiddenAll(id)) return false;
          return !o.dc || o.dc.indexOf(((client.states[id] || {}).attributes || {}).device_class) >= 0;
        });
      }
      typeCount(T) {
        return this.typeMembers(T).length;
      }
      typeSays(T) {
        if (T[5]) return T[5];
        var k = M.COUNT_KINDS.filter(function (x) { return x[0] === T[4].kind; })[0];
        return k ? k[2] : '';
      }
      orderScope(page) {
        return page === 'security' ? 'The locks and garage doors on the Security page, on every screen.' : 'The vacuums on the Vacuums page, on every screen.';
      }
      // the type an accessory's tile is, for a room's list
      typeOf(id) {
        var dom = id.split('.')[0], dc = ((this.client.states[id] || {}).attributes || {}).device_class;
        if (dom === 'binary_sensor') return { door: 'doors', window: 'windows', garage_door: 'garage', smoke: 'smoke', carbon_monoxide: 'smoke',
                                              moisture: 'leaks', motion: 'motion', moving: 'motion', occupancy: 'occupancy', presence: 'occupancy' }[dc] || null;
        if (dom === 'sensor') return dc === 'temperature' || dc === 'humidity' ? dc : null;
        if (dom === 'cover') return dc === 'garage' || dc === 'gate' ? 'garage' : 'blinds';
        if (dom === 'media_player') return dc === 'tv' || dc === 'receiver' ? 'tvs' : 'speakers';
        return { light: 'lights', switch: 'switches', input_boolean: 'switches', fan: 'fans', climate: 'thermostats', humidifier: 'humidifiers',
                 water_heater: 'water_heaters', lock: 'locks', alarm_control_panel: 'alarm', vacuum: 'vacuums', valve: 'valves',
                 timer: 'timers', camera: 'cameras' }[dom] || null;
      }
      a_root(c) {
        var self = this, client = this.client, areas = client.areas || {}, g = this.data.settings.generated;
        var acc = (this.data.accessories || {}).entities || {};
        var ids = this.accIds();
        var sb = h('div', { class: 'search', style: 'margin:0 0 22px' });
        sb.appendChild(K.icon('mdi:magnify', 'mag'));
        var inp = h('input', { type: 'search', placeholder: 'Search Accessories', 'aria-label': 'Search accessories', 'data-fk': 'acc:search' });
        inp.value = this._aq || '';
        sb.appendChild(inp);
        c.appendChild(sb);
        var box = h('div');
        c.appendChild(box);
        var paint = function () {
          box.innerHTML = '';
          var q = inp.value.trim().toLowerCase();
          if (q) {
            // SEARCH FINDS MORE THAN THE TILES: a sensor a chip could also count
            // (a camera's smoke alarm, a temperature sensor) has its page too --
            // that is where Also Count As is
            var pool = ids.slice(), seen = {};
            ids.forEach(function (id) { seen[id] = 1; });
            var also = {};
            Object.keys(self.data.counts || {}).forEach(function (k) { (self.data.counts[k].also || []).forEach(function (d) { also[d] = 1; }); });
            self.entityIds({ domains: Object.keys(also), shown: true }).forEach(function (id) { if (!seen[id]) { seen[id] = 1; pool.push(id); } });
            var got = pool.filter(function (id) {
              return (self.name(id) + ' ' + id + ' ' + self.areaName(self.areaOf(id))).toLowerCase().indexOf(q) >= 0;
            }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); }).slice(0, 200);
            box.appendChild(K.group({ header: 'Accessories', footer: got.length ? null : 'No accessories match.' }, got.map(function (id) {
              // the entity id beside its room: two "Water Heater"s (its climate
              // and its water_heater entity) are told apart without opening each
              return K.nav({ label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, href: '#/accessories/' + encodeURIComponent(id),
                             icon: self.accGlyph(id), value: self.hideText(id) ? 'Hidden' : acc[id] ? 'Customized' : '' });
            })));
            return;
          }
          var energyOn = F.stateOf(self.data.features, 'hk_energy') === 'added';
          var typeRow = function (T) {
            var n = T[4].energy ? null : self.typeCount(T);
            if (n === 0 && !(T[4].energy && energyOn)) return null;
            if (T[4].energy && !energyOn) return null;
            return K.nav({ label: T[1], tile: [T[2], T[3]], value: n === null ? '' : String(n), href: '#/accessories/type/' + T[0], fk: 'acctype:' + T[0] });
          };
          var kinds = M.ACC_TYPES.filter(function (T) { return !T[6]; }).map(typeRow).filter(Boolean);
          var sensors = M.ACC_TYPES.filter(function (T) { return T[6]; }).map(typeRow).filter(Boolean);
          box.appendChild(K.group({ header: 'Types', footer: 'Each type, room by room: what its page and chip count, and what’s hidden from them or added to them. Cameras and the Energy page’s circuits are accessories too.' }, kinds));
          if (sensors.length) box.appendChild(K.group({ header: 'Sensors', footer: 'What the chips and status rows count: the doors left open, the rooms with motion, the Climate page’s temperatures.' }, sensors));
          var count = {};
          ids.forEach(function (id) { var a = self.areaOf(id) || (id.indexOf('timer.') === 0 ? '~timers' : '-'); count[a] = (count[a] || 0) + 1; });
          var rows = self.areasAZ().filter(function (a) { return count[a]; }).map(function (a) {
            return K.nav({ label: areas[a].name, icon: areas[a].icon || 'mdi:texture-box', value: String(count[a]),
                           href: '#/accessories/room/' + encodeURIComponent(a) });
          });
          if (count['~timers']) rows.push(K.nav({ label: 'Timers', icon: 'mdi:timer-outline', value: String(count['~timers']), href: '#/accessories/room/~timers' }));
          if (count['-']) rows.push(K.nav({ label: 'No Room', icon: 'mdi:help-circle-outline', value: String(count['-']), href: '#/accessories/room/-' }));
          box.appendChild(K.group({ header: 'Rooms' }, rows));
          var hidden = self.hiddenCount(), added = (g.include_entities || []).length;
          box.appendChild(K.group({ header: 'Hidden & Added', footer: 'Hidden: kept off every screen, or off just some pages and chips — it stays in Home Assistant. Added: a tile for something HK doesn’t show by itself, such as a script or a sensor.' }, [
            K.nav({ label: 'Hidden Accessories', icon: 'mdi:eye-off-outline', value: hidden ? String(hidden) : 'None', href: '#/accessories/hidden', sk: 'generated.exclude' }),
            K.nav({ label: 'Added Accessories', icon: 'mdi:plus-circle-outline', value: added ? String(added) : 'None', href: '#/accessories/added', sk: 'generated.include_entities' })]));
          var lk = self.data.settings.look;
          box.appendChild(K.group({ header: 'Tapping an Accessory', footer: 'Tapping an accessory opens an HK detail sheet. Off: Home Assistant’s own dialog. Either way, locks, the alarm, garage doors and thermostats never change from one tap.' }, [
            K.toggle({ label: 'HK Detail Sheets', sk: 'look.details', on: lk.details !== false,
                       onChange: function (on) { self.setH({ 'look.details': on }); } })]));
        };
        inp.addEventListener('input', function () { self._aq = inp.value; paint(); });
        paint();
      }
      // a list of accessories under their rooms, A to Z (a type's page)
      byRoomGroups(c, ids, row, footer) {
        var self = this, by = {}, rooms = [];
        ids.forEach(function (id) { var r = self.areaName(self.areaOf(id)) || 'No Room'; if (!by[r]) { by[r] = []; rooms.push(r); } by[r].push(id); });
        rooms.sort(function (a, b) { return /** @type {any} */ (a === 'No Room') - /** @type {any} */ (b === 'No Room') || a.localeCompare(b); });
        rooms.forEach(function (r, i) {
          c.appendChild(K.group({ header: r, footer: i === rooms.length - 1 ? footer : null },
            by[r].sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); }).map(row)));
        });
        return rooms.length;
      }
      a_type(c, T) {
        var self = this, o = T[4], H = this.hid();
        if (o.link) c.appendChild(K.group({ footer: o.link[2] }, [K.nav({ label: o.link[0], icon: 'mdi:cog-outline', href: '#/' + o.link[1], fk: 'acctype:link' })]));
        if (o.energy) { this.a_typeEnergy(c); return; }
        var ck = o.kind ? (this.data.counts || {})[o.kind] || { found: [], exclude: [], include: [] } : null;
        var ids = this.typeMembers(T);
        var note = function (id) {
          if (self.hiddenAll(id) || (ck && (ck.exclude || []).indexOf(id) >= 0)) return 'Hidden';
          if (ck && (ck.include || []).indexOf(id) >= 0) return 'Added';
          return '';
        };
        var row = function (id) {
          return K.nav({ label: self.name(id), sub: id, icon: self.accGlyph(id), value: note(id), href: '#/accessories/' + encodeURIComponent(id), fk: 'acc:' + id });
        };
        var pname = o.kind ? this.placeName(o.kind) : '';
        var n = this.byRoomGroups(c, ids, row, ck ? 'Hidden: not counted, and not on ' + pname + '. Added: counted though it isn’t found by itself. Tap one for its settings — Where It Shows and Also Count As.'
                                                  : 'Tap one for its name, icon, room and Where It Shows.');
        // (Scenes: what's added is a button or script that runs a routine, 2026-11-09)
        var sc = o.kind === 'scenes';
        if (!n) c.appendChild(K.group({ footer: ck ? 'HK finds none in this house. Add one below — ' + (sc ? 'a button that runs a routine' : 'a group helper') + ', say.' : 'None in this house.' }, []));
        if (ck) c.appendChild(K.group({ header: 'Added', footer: (sc ? 'Count a button or script as a scene — an input_button whose automation runs a routine. It joins the scene blocks, its room’s scene row and Suggested Scene, marked Added.'
                                                                      : 'Count something more as one of these — an outlet with a lamp, a group helper. It joins its room above, marked Added.') }, [this.countAdd(o.kind, ck)]));
        // ITS CHIP (2026-10-13): which chips count this type, and on which
        // screens -- each a tap from Always / When Active for every screen
        if (o.kind) {
          var crow = this.chipsOfType(o.kind).map(function (ch) {
            return K.nav({ label: (M.CHIP_LABELS[ch] || ch) + ' Chip', sub: self.chipSays(self.chipScreens(ch)), href: '#/house/chips/' + ch, sk: 'acctype:chip:' + ch });
          });
          if (o.kind === 'smoke') crow.push(K.info({ label: 'Smoke & CO Chip', sub: 'Leads every screen’s chip row, in red, when one goes off' }));
          if (crow.length) c.appendChild(K.group({ header: 'Chips', footer: 'Which screens show it, and Always or When Active, for every screen at once.' }, crow));
        }
        var every = this.typeHidden(T), hid = [];
        if (every.length) hid.push(K.nav({ label: 'Hidden Everywhere', icon: 'mdi:eye-off-outline', value: String(every.length), href: '#/accessories/hidden', fk: 'acctype:hidden' }));
        if (ck && (ck.exclude || []).length) hid.push(K.nav({ label: 'Show All on ' + pname + ' Again…', icon: 'mdi:eye-outline', href: '#/accessories/hidden/kind/' + o.kind, fk: 'count:showall' }));
        if (hid.length) c.appendChild(K.group({ header: 'Hidden', footer: (every.length ? 'Hidden everywhere: on no screen at all — they’re listed in Hidden Accessories. ' : '') +
            (ck && ck.exclude.length ? ck.exclude.length + ' above are hidden from ' + pname + ' only; Show All Again brings them back there.' : '') }, hid));
        if (o.order) {
          var po = ((this.data.accessories || {}).pages || {})[o.order] || [];
          c.appendChild(K.group({ header: 'Order', footer: 'The order of the ' + PAGE_ORDERS[o.order][0] + ' page’s tiles, on every screen.' }, [
            K.nav({ label: 'Tile Order', sub: 'On the ' + PAGE_ORDERS[o.order][0] + ' page', value: po.length ? 'Custom' : 'Automatic',
                    href: '#/page/' + o.order + '/order', sk: 'accessories.pages.' + o.order })]));
        }
      }
      // CIRCUITS & METERS: the Energy page's devices (hk_energy's own
      // settings) -- listed here, set up in Energy
      a_typeEnergy(c) {
        var self = this;
        if (F.stateOf(this.data.features, 'hk_energy') !== 'added') {
          c.appendChild(K.group({ footer: 'Energy isn’t added yet. It builds an Energy page with a live tile for each circuit, from Home Assistant’s Energy settings.' }, [
            K.nav({ label: 'Energy', icon: 'mdi:lightning-bolt', href: '#/page/energy' })]));
          return;
        }
        var st = this.feat('hk_energy'), d = st.data || {};
        var devs = d.devices || [];
        c.appendChild(K.group({ footer: 'Their names, glyphs, sections and sensors are set in Energy, with the rest of the Energy page.' }, [
          K.nav({ label: 'Energy Devices', icon: 'mdi:cog-outline', value: st.data ? String(devs.length) : '', href: '#/features/energy/devices', fk: 'acctype:link' }),
          K.nav({ label: 'Energy Page', icon: 'mdi:lightning-bolt', href: '#/page/energy' })]));
        if (!st.data) { c.appendChild(K.group({ footer: st.error ? 'Energy’s settings couldn’t load: ' + st.error : 'Loading…' }, [])); return; }
        var byKey = {};
        devs.forEach(function (x) { byKey[x.key] = x; });
        (d.sections || []).forEach(function (s) {
          var rows = s.items.filter(function (k) { return byKey[k]; }).map(function (k) {
            var x = byKey[k];
            return K.nav({ label: x.name, sub: x.hidden ? 'Hidden' : (x.power ? self.name(x.power) : 'No power sensor'), icon: x.icon,
                           href: '#/features/energy/devices/' + encodeURIComponent(k), fk: 'energy:dev:' + k });
          });
          if (rows.length) c.appendChild(K.group({ header: s.name }, rows));
        });
      }
      a_room(c, aid) {
        var self = this, client = this.client, areas = client.areas || {}, acc = (this.data.accessories || {}).entities || {};
        var ids = this.accIds().filter(function (id) {
          var a = self.areaOf(id);
          return aid === '-' ? !a && id.indexOf('timer.') !== 0 : aid === '~timers' ? !a && id.indexOf('timer.') === 0 : a === aid;
        }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
        if (areas[aid]) {
          // the room's own settings live in Rooms (All Screens), one place
          c.appendChild(K.group({ footer: 'Its scenes, tile order, whether it shows and what it’s part of.' }, [
            K.nav({ label: 'Room Settings', href: '#/house/rooms/' + encodeURIComponent(aid), icon: 'mdi:sofa', sk: 'room:settings:' + aid })]));
        }
        // BY TYPE, as Accessories is by type and then by room: a room's page is
        // the other way round
        var by = {}, other = [];
        ids.forEach(function (id) { var t = self.typeOf(id); if (t) (by[t] = by[t] || []).push(id); else other.push(id); });
        var row = function (id) {
          var a = acc[id] || {};
          return K.nav({ label: self.name(id), sub: id, icon: self.accGlyph(id),
                         value: self.hideText(id) ? 'Hidden' : Object.keys(a).length ? 'Customized' : '', href: '#/accessories/' + encodeURIComponent(id) });
        };
        M.ACC_TYPES.forEach(function (T) { if (by[T[0]]) c.appendChild(K.group({ header: T[1] }, by[T[0]].map(row))); });
        if (other.length) c.appendChild(K.group({ header: 'Other' }, other.map(row)));
      }
      // A ROOM'S SCENES ROW on its page (accessories.py `scenes`): Automatic --
      // the Home Assistant scenes in the room -- or its own list, where an
      // empty one is no row at all (a room that uses no scenes).
      roomScenesAuto(aid) {
        // the house's scenes (Accessories -> Scenes: HA's, and the buttons and scripts added as one)
        var self = this, ck = (this.data.counts || {}).scenes, found = ck && Array.isArray(ck.found) ? ck.found : null;
        return (found ? found.filter(function (id) { return !!self.client.states[id]; }) : this.entityIds({ domains: ['scene'], shown: true }))
          .filter(function (id) { return self.areaOf(id) === aid; })
          .sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
      }
      roomScenesLabel(aid) {
        var own = (((this.data.accessories || {}).scenes || {})[aid]);
        if (!Array.isArray(own)) return this.roomScenesAuto(aid).length ? 'Automatic' : 'None';
        return own.length ? String(own.length) : 'None';
      }
      a_roomScenes(c, aid) {
        var self = this, own = (((this.data.accessories || {}).scenes || {})[aid]);
        var auto = !Array.isArray(own), autoIds = this.roomScenesAuto(aid), cur = auto ? autoIds : own;
        var save = function (v) { self.ws({ type: DOMAIN + '/accessory/room_scenes', area_id: aid, entities: v }); };
        var row = function (id) { return { value: id, label: self.name(id), sub: self.client.states[id] ? id : id + ' (missing)' }; };
        c.appendChild(K.listEditor({ fk: 'rs', auto: auto, announce: this.announce.bind(this), shownHeader: 'Scenes',
          autoFooter: 'Automatic: the scenes in this room, A to Z' + (autoIds.length ? '.' : ' — it has none, so there’s no row.'),
          emptyText: auto ? 'No scenes in this room' : 'No scenes row',
          rows: cur.map(row),
          onAuto: function (on) { save(on ? null : autoIds.slice()); },
          onChange: save,
          addLabel: auto ? null : 'Add Scene or Shortcut…', onAddOther: function () {
            self.go(self.picker('room-scene-add', { title: 'Add Scene or Shortcut', value: null, multi: true,
              items: function () {
                return self.entityIds({ re: SCENE_POOL, shown: true }).filter(function (id) { return cur.indexOf(id) < 0; })
                  .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
              },
              onPick: function (v) { if (v) save(cur.concat(v)); } }));
          } }));
        c.appendChild(K.group({ footer: 'A row of scene pills on this room’s page, under its status and cameras, on every generated screen. ' +
          'Turn Automatic off and remove them all for a room with no scenes row. A pill’s name, icon and color are in its settings.' }, []));
      }
      a_roomOrder(c, aid) {
        var self = this;
        var inRoom = this.accIds().filter(function (id) { return self.areaOf(id) === aid; });
        var own = (((this.data.accessories || {}).rooms || {})[aid] || []).filter(function (id) { return inRoom.indexOf(id) >= 0; });
        var auto = !own.length;
        var rest = inRoom.filter(function (id) { return own.indexOf(id) < 0; }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
        var save = function (v) { self.ws({ type: DOMAIN + '/accessory/order', area_id: aid, entities: v }); };
        c.appendChild(K.listEditor({ fk: 'ro', auto: auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: the room’s tiles in the screen’s usual order.',
          rows: own.concat(rest).map(function (id) { return { value: id, label: self.name(id) }; }),
          onAuto: function (on) {
            if (!on) { save(own.concat(rest)); return; }
            self.confirmSwitch({ title: 'Use the automatic order?', message: 'This room’s tile order will be cleared.', ok: 'Use Automatic' },
                function () { save([]); });
          },
          onChange: save }));
        c.appendChild(K.group({ footer: 'On Home and the room’s page, on every generated screen.' }, []));
      }
      a_pageOrder(c, page) {
        var self = this, P = PAGE_ORDERS[page];
        var az = function (a, b) { return self.name(a).localeCompare(self.name(b)); };
        var all = page === 'security'
          ? this.entityIds({ domains: ['lock'], shown: true }).sort(az)
              .concat(this.entityIds({ domains: ['cover'], dc: 'garage', shown: true }).sort(az))
          : this.entityIds({ domains: ['vacuum'], shown: true }).sort(az);
        var own = ((((this.data.accessories || {}).pages || {})[page]) || []).filter(function (id) { return all.indexOf(id) >= 0; });
        var save = function (v) { self.ws({ type: DOMAIN + '/accessory/page_order', page: page, entities: v }); };
        c.appendChild(K.listEditor({ fk: 'po', auto: !own.length, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: ' + P[2] + '.',
          rows: own.concat(all.filter(function (id) { return own.indexOf(id) < 0; })).map(function (id) { return { value: id, label: self.name(id) }; }),
          onAuto: function (on) { save(on ? [] : own.concat(all.filter(function (id) { return own.indexOf(id) < 0; }))); },
          onChange: save }));
      }
      // ------------------------------------------------ hidden accessories
      // What hides what (hiding.py snapshot, in panel/get as `hidden`): each
      // accessory's places (`can`), the ones it is hidden from (`off`), and
      // the house's Hidden from Screens lists (everywhere, devices, areas) --
      // stored as they always were (generated.exclude_*).
      hid() {
        return this.data.hidden || { places: {}, order: [], can: {}, off: {}, everywhere: [], devices: [], areas: [] };
      }
      devName(did) { var d = (this.client.devices || {})[did]; return d ? (d.name_by_user || d.name || did) : 'A Removed Device'; }
      devOf(id) { return ((this.client.entities || {})[id] || {}).device_id || null; }
      // what hides it, in a few words: "" when nothing does
      hideText(id) {
        var H = this.hid(), dv = this.devOf(id), a = this.areaOf(id);
        if (dv && H.devices.indexOf(dv) >= 0) return 'With Its Device';
        if (a && H.areas.indexOf(a) >= 0) return 'With Its Room';
        if (H.everywhere.indexOf(id) >= 0) return 'Everywhere';
        var seen = {}, names = [];
        (H.off[id] || []).forEach(function (k) {
          var n = k === 'room' ? 'Room Page' : (H.places[k] || [k])[0];
          if (!seen[n]) { seen[n] = 1; names.push(n); }
        });
        return names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(', ');
      }
      placeName(k, ids) {
        var H = this.hid();
        if (k !== 'room') return (H.places[k] || [k])[0];
        var a = ids && ids.length === 1 ? this.areaOf(ids[0]) : null;
        return a ? this.areaName(a) + ' Room Page' : 'Room Pages';
      }
      hiddenCount() {
        var H = this.hid(), devs = this.client.devices || {}, areas = this.client.areas || {};
        return this.hiddenEntities().length + H.devices.filter(function (d) { return devs[d]; }).length +
          H.areas.filter(function (a) { return areas[a]; }).length;
      }
      // accessories hidden one by one -- not those hidden with a whole device or room
      hiddenEntities() {
        var H = this.hid(), self = this, seen = {};
        return H.everywhere.concat(Object.keys(H.off)).filter(function (id) {
          if (seen[id] || !self.client.states[id]) return false;
          seen[id] = true;
          var dv = self.devOf(id), a = self.areaOf(id);
          return !(dv && H.devices.indexOf(dv) >= 0) && !(a && H.areas.indexOf(a) >= 0);
        });
      }
      accGlyph(id) {
        var a = ((this.data.accessories || {}).entities || {})[id] || {}, st = this.client.states[id];
        if (a.icon) return String(a.icon).replace(/^mdi:/, 'hk:');
        if (st && st.attributes.icon) return st.attributes.icon;
        return { light: 'mdi:lightbulb', switch: 'mdi:toggle-switch-variant', fan: 'mdi:fan', cover: 'mdi:window-shutter',
                 lock: 'mdi:lock', climate: 'mdi:thermostat', media_player: 'mdi:speaker', vacuum: 'mdi:robot-vacuum',
                 camera: 'mdi:cctv', valve: 'mdi:valve', humidifier: 'mdi:air-humidifier', water_heater: 'mdi:water-boiler',
                 timer: 'mdi:timer-outline', sensor: 'mdi:eye', binary_sensor: 'mdi:radiobox-marked' }[id.split('.')[0]] || 'mdi:circle-small';
      }
      // the answer to hidden/set, for the accessories it was about, over the page's copy
      hideMerge(ids, snap) {
        var H = this.data.hidden;
        if (!H || !snap) return;
        ids.forEach(function (id) {
          H.everywhere = H.everywhere.filter(function (x) { return x !== id; });
          if ((snap.everywhere || []).indexOf(id) >= 0) H.everywhere.push(id);
          if ((snap.off || {})[id]) H.off[id] = snap.off[id]; else delete H.off[id];
          if ((snap.can || {})[id]) H.can[id] = snap.can[id];
        });
      }
      hideSend(ids, everywhere, places) {
        var self = this, H = this.hid();
        // shown at once, as it will be saved; the answer then replaces it
        var guess = { everywhere: everywhere ? ids.slice() : [], off: {}, can: {} };
        if (!everywhere) ids.forEach(function (id) {
          var off = (H.can[id] || []).filter(function (k) { return places[k]; });
          if (off.length) guess.off[id] = off;
        });
        return this.save({ type: DOMAIN + '/hidden/set', entity_ids: ids, everywhere: everywhere, places: everywhere ? {} : places },
          ['hide'], function () { self.hideMerge(ids, guess); }, function (r) { self.hideMerge(ids, r); });
      }
      a_hidden(c) {
        var self = this, H = this.hid(), client = this.client, devs = client.devices || {};
        var v = this._hv || (this._hv = { f: 'all', q: '' });
        c.appendChild(K.group({}, [K.button({ label: 'Hide Accessories…', fk: 'hide:start', onClick: function () {
          self._hp = { ents: [], devs: [], tab: 'acc', q: '' };
          self._hd = null;
          self.go('#/accessories/hidden/pick');
        } })]));
        c.appendChild(K.group({}, [K.seg({ label: 'Show', fk: 'hide:filter', value: v.f,
          options: [['all', 'All'], ['every', 'Everywhere'], ['some', 'Some Places']],
          onChange: function (x) { v.f = x; self.render(); } })]));
        var sb = h('div', { class: 'search', style: 'margin:0 0 22px' });
        sb.appendChild(K.icon('mdi:magnify', 'mag'));
        var inp = h('input', { type: 'search', placeholder: 'Search Hidden', 'aria-label': 'Search hidden accessories', 'data-fk': 'hide:search' });
        inp.value = v.q;
        sb.appendChild(inp);
        c.appendChild(sb);
        var box = h('div');
        c.appendChild(box);
        var paint = function () {
          box.innerHTML = '';
          var q = inp.value.trim().toLowerCase();
          var m = function (s) { return !q || s.toLowerCase().indexOf(q) >= 0; };
          var recent = (self._hr || []).filter(function (id) { return !q; });
          var row = function (id) {
            var why = self.hideText(id);
            return K.nav({ label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, icon: self.accGlyph(id),
                           value: why || 'Shown Everywhere', href: '#/accessories/hidden/edit/' + encodeURIComponent(id), fk: 'hide:' + id });
          };
          if (recent.length) box.appendChild(K.group({ header: 'Just Now', footer: 'What you just changed. It joins the lists below when you leave this page.' },
            recent.map(function (r) {
              if (r.indexOf('dev:') === 0) {
                var did = r.slice(4), hid = H.devices.indexOf(did) >= 0;
                return K.nav({ label: self.devName(did), icon: 'mdi:devices', value: hid ? 'Everywhere' : 'Shown Everywhere',
                               href: '#/accessories/hidden/device/' + encodeURIComponent(did) });
              }
              return row(r);
            })));
          var isRecent = function (x) { return recent.indexOf(x) >= 0; };
          if (v.f !== 'some') {
            var rooms = H.areas.filter(function (a) { return (client.areas || {})[a] && m(self.areaName(a)); });
            if (rooms.length) box.appendChild(K.group({ header: 'Whole Rooms', footer: 'A room is hidden from its own Room Settings, with everything in it.' },
              rooms.map(function (a) {
                return K.nav({ label: self.areaName(a), icon: ((client.areas || {})[a] || {}).icon || 'mdi:texture-box', value: 'Everywhere',
                               href: '#/house/rooms/' + encodeURIComponent(a) });
              })));
            var dl = H.devices.filter(function (d) { return devs[d] && !isRecent('dev:' + d) && m(self.devName(d) + ' ' + self.areaName(devs[d].area_id)); })
              .sort(function (a, b) { return self.devName(a).localeCompare(self.devName(b)); });
            if (dl.length) box.appendChild(K.group({ header: 'Whole Devices', footer: 'Every accessory of a hidden device is hidden everywhere.' },
              dl.map(function (d) {
                var n = Object.keys(client.entities || {}).filter(function (id) { return client.entities[id].device_id === d && client.states[id]; }).length;
                return K.nav({ label: self.devName(d), sub: (self.areaName(devs[d].area_id) || 'No room') + ' · ' + n + (n === 1 ? ' entity' : ' entities'),
                               icon: 'mdi:devices', value: 'Everywhere', href: '#/accessories/hidden/device/' + encodeURIComponent(d), fk: 'hide:dev:' + d });
              })));
          }
          var ents = self.hiddenEntities().filter(function (id) {
            if (isRecent(id)) return false;
            var every = H.everywhere.indexOf(id) >= 0;
            return (v.f === 'all' || (v.f === 'every') === every) && m(self.name(id) + ' ' + id + ' ' + self.areaName(self.areaOf(id)) + ' ' + self.hideText(id));
          }).sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
          if (ents.length) box.appendChild(K.group({ header: 'Accessories', footer: 'On the right: where each one is hidden. Tap one to change it.' }, ents.map(row)));
          // BY PAGE: what each page and chip has hidden from it, with Show All Again
          var byK = {};
          Object.keys(H.off).forEach(function (id) { (H.off[id] || []).forEach(function (k) { if (k !== 'home' && k !== 'room') byK[k] = (byK[k] || 0) + 1; }); });
          var kl = (H.order || []).filter(function (k) { return byK[k] && m(self.placeName(k)); });
          if (kl.length && v.f !== 'every') box.appendChild(K.group({ header: 'By Page', footer: 'What each page and chip has hidden from it.' },
            kl.map(function (k) {
              return K.nav({ label: self.placeName(k), sub: (H.places[k] || ['', ''])[1], value: byK[k] + ' Hidden',
                             href: '#/accessories/hidden/kind/' + k, fk: 'hide:kind:' + k });
            })));
          var goneD = H.devices.filter(function (d) { return !devs[d]; }), goneE = H.everywhere.filter(function (id) { return !client.states[id]; });
          if ((goneD.length || goneE.length) && v.f !== 'some' && !q) {
            box.appendChild(K.group({ header: 'No Longer in Home Assistant', footer: 'Hidden once, then removed from Home Assistant. Nothing shows them now.' },
              goneD.map(function (d) { return K.info({ label: 'A removed device', sub: d, value: 'Gone' }); })
                .concat(goneE.map(function (id) { return K.info({ label: id, value: 'Gone' }); }))
                .concat([K.button({ label: 'Clear These', destructive: true, fk: 'hide:clear', onClick: function () {
                  var g = self.data.settings.generated, ch = {};
                  if (goneD.length) ch['generated.exclude_devices'] = (g.exclude_devices || []).filter(function (d) { return goneD.indexOf(d) < 0; });
                  if (goneE.length) ch['generated.exclude_entities'] = (g.exclude_entities || []).filter(function (id) { return goneE.indexOf(id) < 0; });
                  self.setH(ch);
                } })])));
          }
          if (!box.children.length) box.appendChild(K.group({ footer: q ? 'Nothing hidden matches.' : 'Nothing is hidden.' }, []));
        };
        inp.addEventListener('input', function () { v.q = inp.value; paint(); });
        paint();
      }
      // HIDE ACCESSORIES, step one: tick one or several (or whole devices), then
      // Next -- the picker every other page uses now (pickList); a device is
      // ticked as "dev:<id>"
      a_hidePick(c) {
        var self = this, H = this.hid(), client = this.client, devs = client.devices || {};
        var p = this._hp || (this._hp = { ents: [], devs: [], tab: 'acc', q: '' });
        if (!p.sel) p.sel = p.ents.concat(p.devs.map(function (d) { return 'dev:' + d; }));
        this.pickList(c, { title: 'Accessories', multi: true, sel: p.sel, verb: 'Next',
          tabs: [['acc', 'Accessories'], ['dev', 'Whole Devices']], tab: p.tab,
          onTab: function (x) { p.tab = x; self.render(); },
          query: p.q, onQuery: function (q) { p.q = q; },
          items: function (tab) {
            if (tab === 'dev') {
              return Object.keys(devs).filter(function (d) {
                return Object.keys(client.entities || {}).some(function (id) {
                  return client.entities[id].device_id === d && client.states[id] && !client.entities[id].entity_category; });
              }).map(function (d) {
                return { value: 'dev:' + d, label: self.devName(d), room: self.areaName(devs[d].area_id) || '', icon: 'mdi:devices',
                         note: H.devices.indexOf(d) >= 0 ? 'Hidden · Everywhere' : '' };
              });
            }
            var ids = {};
            self.accIds().concat(Object.keys(H.can), H.everywhere).forEach(function (id) { if (client.states[id]) ids[id] = 1; });
            return Object.keys(ids).map(function (id) {
              var why = self.hideText(id);
              return { value: id, label: self.name(id), note: why ? 'Hidden · ' + why : '' };
            });
          },
          onDone: function (v) {
            p.ents = v.filter(function (x) { return x.indexOf('dev:') !== 0; });
            p.devs = v.filter(function (x) { return x.indexOf('dev:') === 0; }).map(function (x) { return x.slice(4); });
            self._hd = null;
            self.go('#/accessories/hidden/where');
          } });
      }
      // HIDE FROM: Everywhere, or only from the places chosen. For what was just
      // picked (id null) it waits for Hide; for one accessory (id) each switch
      // saves as it changes, as the rest of HK Settings does.
      a_hideWhere(c, id) {
        var self = this, H = this.hid(), client = this.client;
        var p = this._hp || { ents: [], devs: [] };
        var ents = id ? [id] : p.ents.filter(function (x) { return client.states[x]; }), dvs = id ? [] : p.devs.slice();
        if (!ents.length && !dvs.length) { c.appendChild(K.group({ footer: 'Nothing picked.' }, [K.nav({ label: 'Pick Accessories', href: '#/accessories/hidden/pick' })])); return; }
        // the choice: one accessory's is what is saved; a new hide's starts at Everywhere
        var d;
        if (id) d = { every: H.everywhere.indexOf(id) >= 0, places: {} };
        else d = this._hd || (this._hd = { every: true, places: {} });
        if (id && !d.every) (H.off[id] || []).forEach(function (k) { d.places[k] = true; });
        var one = ents.length === 1 && !dvs.length ? ents[0] : null;
        var head = one ? K.info({ label: this.name(one), sub: (this.areaName(this.areaOf(one)) || 'No room') + ' · ' + one, icon: this.accGlyph(one) })
          : K.info({ label: [ents.length ? ents.length + (ents.length === 1 ? ' Accessory' : ' Accessories') : '',
                             dvs.length ? dvs.length + (dvs.length === 1 ? ' Device' : ' Devices') : ''].filter(Boolean).join(' and '),
                     sub: ents.map(function (x) { return self.name(x); }).concat(dvs.map(function (x) { return self.devName(x); })).join(', ') });
        c.appendChild(K.group({}, [head].concat(id ? [K.nav({ label: 'Accessory Settings', href: '#/accessories/' + encodeURIComponent(id) })] : [])));
        var dv = id && this.devOf(id), ar = id && this.areaOf(id);
        if (id && ((dv && H.devices.indexOf(dv) >= 0) || (ar && H.areas.indexOf(ar) >= 0))) {
          var byDev = dv && H.devices.indexOf(dv) >= 0;
          c.appendChild(K.group({ footer: byDev ? 'Its whole device is hidden everywhere.' : 'Its whole room is hidden everywhere.' }, [
            K.nav({ label: byDev ? self.devName(dv) : self.areaName(ar), value: 'Everywhere',
                    href: byDev ? '#/accessories/hidden/device/' + encodeURIComponent(dv) : '#/house/rooms/' + encodeURIComponent(ar) })]));
          return;
        }
        var commit = function () { if (id) self.hideSend([id], d.every, d.places); else self.render(); };
        if (!ents.length) {
          c.appendChild(K.group({ footer: 'A whole device is hidden everywhere. To hide it from just some places, pick its accessories instead.' },
            [K.toggle({ label: 'Everywhere', on: true, disabled: true, onChange: function () {} })]));
        } else {
          c.appendChild(K.group({ footer: 'It stays in Home Assistant, and in its automations.' + (dvs.length ? ' The devices picked are hidden everywhere either way.' : '') }, [
            K.toggle({ label: 'Everywhere', sub: 'Every screen, page and chip', on: d.every, fk: 'hide:every',
                       onChange: function (on) { d.every = on; commit(); } })]));
          var counts = {}, order = H.order || [];
          ents.forEach(function (x) { (H.can[x] || []).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
          var keys = order.filter(function (k) { return counts[k]; });
          var rows = keys.map(function (k) {
            var sub = (H.places[k] || ['', ''])[1];
            if (k === 'room' && one) sub = 'Its tile on the ' + self.areaName(self.areaOf(one)) + ' page';
            if (ents.length > 1 && counts[k] < ents.length) sub += ' · applies to ' + counts[k] + ' of ' + ents.length;
            return K.toggle({ label: self.placeName(k, ents), sub: sub, on: d.every || !!d.places[k], disabled: d.every, fk: 'hide:pl:' + k,
                              onChange: function (on) { d.places[k] = on; commit(); } });
          });
          c.appendChild(K.group({ header: 'Or Only From', footer: !rows.length ? 'There’s nowhere else to hide it from.' :
              d.every ? 'Turn off Everywhere to choose.' : 'Hidden from what’s on. Everywhere else it shows as usual.' }, rows));
        }
        if (this.err('hide')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('hide') }));
        if (id) {
          c.appendChild(K.group({}, [K.button({ label: 'Show Everywhere Again', destructive: true, fk: 'hide:show', onClick: function () {
            self._hr = [id];
            self.hideSend([id], false, {}).then(function (ok) { if (ok) self.back('#/accessories/hidden'); });
          } })]));
          return;
        }
        var n = ents.length + dvs.length;
        var none = !d.every && ents.length && !Object.keys(d.places).some(function (k) { return d.places[k]; });
        c.appendChild(K.group({}, [K.button({ label: n === 1 ? 'Hide' : 'Hide ' + n, fk: 'hide:go', disabled: !!none, onClick: function () {
          var jobs = [];
          if (ents.length) jobs.push(self.hideSend(ents, d.every, d.places));
          if (dvs.length) {
            var cur = self.data.settings.generated.exclude_devices || [];
            jobs.push(self.setH({ 'generated.exclude_devices': cur.concat(dvs.filter(function (x) { return cur.indexOf(x) < 0; })) }));
          }
          Promise.all(jobs).then(function (oks) {
            if (oks.some(function (ok) { return !ok; })) return;
            self._hr = ents.concat(dvs.map(function (x) { return 'dev:' + x; }));
            self._hp = null; self._hd = null;
            self.back('#/accessories/hidden');
          });
        } })]));
      }
      // ONE PAGE'S HIDDEN (By Page): what is hidden from it, and Show All Again
      // (was Status & Chips' Reset to Automatic: what was added stays added)
      a_hideKind(c, kind) {
        var self = this, H = this.hid(), ck = (this.data.counts || {})[kind] || { exclude: [], include: [] };
        var ids = Object.keys(H.off).filter(function (id) { return (H.off[id] || []).indexOf(kind) >= 0; })
          .sort(function (a, b) { return self.name(a).localeCompare(self.name(b)); });
        c.appendChild(K.group({ footer: (H.places[kind] || ['', ''])[1] + '.' }, ids.map(function (id) {
          return K.nav({ label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, icon: self.accGlyph(id),
                         value: self.hideText(id), href: '#/accessories/hidden/edit/' + encodeURIComponent(id) });
        })));
        if (!ids.length) return;
        c.appendChild(K.group({ footer: 'Everything ' + this.placeName(kind) + ' finds is shown there again. What was added with Also Count As stays.' }, [
          K.button({ label: 'Show All Again…', destructive: true, fk: 'hide:kindall', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Show All on ' + self.placeName(kind) + ' Again?', message: ids.length + ' hidden from it will show again.',
                                          ok: 'Show All', destructive: true }).then(function (yes) {
              if (!yes) return;
              var o = {}; o['counts.' + kind] = { exclude: [], include: ck.include || [] };
              self._hr = ids.slice();
              self.setH(o).then(function (ok) { if (ok) self.back('#/accessories/hidden'); });
            });
          } })]));
      }
      a_hideDevice(c, did) {
        var self = this, client = this.client, g = this.data.settings.generated, cur = g.exclude_devices || [], hid = cur.indexOf(did) >= 0;
        var dev = (client.devices || {})[did];
        var ids = Object.keys(client.entities || {}).filter(function (id) { return client.entities[id].device_id === did && client.states[id] && !client.entities[id].entity_category; });
        c.appendChild(K.group({ footer: hid ? 'Every accessory of this device is hidden everywhere. It stays in Home Assistant.' : 'Shown wherever HK puts its accessories.' }, [
          K.info({ label: this.devName(did), sub: dev ? (this.areaName(dev.area_id) || 'No room') : did, icon: 'mdi:devices' }),
          K.toggle({ label: 'Hidden Everywhere', on: hid, fk: 'hide:dev', onChange: function (on) {
            self._hr = ['dev:' + did];
            self.setH({ 'generated.exclude_devices': on ? cur.concat(did) : cur.filter(function (x) { return x !== did; }) });
          } })]));
        if (ids.length) c.appendChild(K.group({ header: 'Its Accessories' }, ids.sort().map(function (id) {
          return K.nav({ label: self.name(id), sub: id, icon: self.accGlyph(id), href: '#/accessories/' + encodeURIComponent(id) });
        })));
      }
      // ADDED ACCESSORIES (generated.include_entities; was Also Shown): a tile
      // for something HK doesn't make one for by itself. Offered: what isn't
      // an accessory already, under its room as every picker has it.
      a_also(c) {
        var self = this, cur = this.data.settings.generated.include_entities || [];
        var set = function (v) { self.setH({ 'generated.include_entities': v }); };
        var tiles = {};
        this.accIds().forEach(function (id) { tiles[id] = 1; });
        c.appendChild(K.listEditor({ fk: 'also', reorder: false, shownHeader: 'Added', emptyText: 'Nothing added', announce: this.announce.bind(this),
          rows: cur.map(function (id) { return { value: id, label: self.name(id), sub: (self.areaName(self.areaOf(id)) || 'No room') + ' · ' + id, icon: self.accGlyph(id) }; }),
          onChange: set, addLabel: 'Add…', onAddOther: function () {
            self.go(self.picker('also-add', { title: 'Add Accessories', value: null, multi: true,
              items: function () {
                var ents = self.client.entities || {};
                return Object.keys(self.client.states).filter(function (id) {
                  var e = ents[id] || {};
                  return cur.indexOf(id) < 0 && !tiles[id] && !e.hidden && !e.entity_category && !self.client.states[id].attributes.plumbing;
                }).map(function (id) { return { value: id, label: self.name(id) }; });
              },
              onPick: function (v) { var add = [].concat(v || []); if (add.length) set(cur.concat(add)); } }));
          } }));
        c.appendChild(K.group({ footer: 'Each one gets a tile in its room on Home and its room’s page, or in a section called More when it has no room. Remove one to take its tile away; it stays in Home Assistant.' }, []));
      }
      a_one(c, id) {
        var self = this;
        if (!this.client.states[id]) { c.appendChild(K.group({ footer: 'This entity doesn’t exist any more.' }, [])); return; }
        var box = h('div', { class: 'accwrap' });
        c.appendChild(box);
        loadCards().then(function () {
          var D = window.hkDetail && window.hkDetail._;
          if (!D || !D.accessoryPane) { box.appendChild(K.group({ footer: 'The accessory settings couldn’t load.' }, [])); return; }
          var st = document.createElement('style');
          st.textContent = D.ACC_CSS || '';
          box.appendChild(st);
          box.appendChild(D.accessoryPane(self.client, id, function () { self.status('saved'); self.soon(); }, { panel: true, onSaved: function (ok) { self.status(ok ? 'saved' : 'error'); } }));
        });
      }
    };
    KIT.install(Methods);
  };
})();
