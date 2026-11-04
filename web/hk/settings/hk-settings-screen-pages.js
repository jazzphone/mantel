// hk-settings-screen-pages.js - a screen's pages: chips, cameras, scenes, sleep, rooms, pages, glass, the screensaver, kiosk.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-pages'] = function (KIT) {
    var CHIP_POOL = KIT.CHIP_POOL, docsLink = KIT.docsLink, FAV_POOL = KIT.FAV_POOL, haName = KIT.haName,
        haPlace = KIT.haPlace, MIN = KIT.MIN, optGet = KIT.optGet, optSet = KIT.optSet, PN = KIT.PN,
        SCENE_POOL = KIT.SCENE_POOL, SLEEP_LISTS = KIT.SLEEP_LISTS;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // A CHIP ACROSS THE SCREENS: each screen with a Home page -- its chip row
      // on or off, and this chip in it (Always or When Active) or not
      chipScreens(kind) {
        var self = this, d = this.data, kinds = d.chip_kinds || [], lib = d.custom_chips || [];
        return Object.keys(d.boards || {}).map(function (p) {
          var b = d.boards[p], x = self.dash(p);
          if (!x || b.home_page === false) return null;
          if (!b.chips_row) return { path: p, title: x.title, b: b, row: false };
          var m = M.chipsModel(b, kinds, lib), r = m.rows.filter(function (y) { return y.value === kind; })[0];
          var quiet = !!(r && r.quiet);
          // a custom chip's: this screen's Show for it, else as written
          if (r && r.custom) quiet = self.customShow(b, r.key) === 'active';
          return { path: p, title: x.title, b: b, row: true, on: !!r, quiet: quiet, auto: m.auto };
        }).filter(Boolean).sort(function (a, b) { return a.title.localeCompare(b.title); });
      }
      // A CUSTOM CHIP'S SHOW (2026-10-13; hk-chip.js copyAs): this screen's
      // choice, else as written -- a conditional one When Active, the rest
      // Always. Only a status chip (or one in a conditional) can be either.
      customChip(key) { return (this.data.custom_chips || []).filter(function (x) { return x.key === key; })[0] || null; }
      customShow(b, key) {
        var mine = (b && b.chips_custom_show || {})[key];
        if (mine) return mine;
        var ch = this.customChip(key);
        return ch && ch.card && ch.card.type === 'conditional' ? 'active' : 'always';
      }
      customSwitchable(key) {
        var c = (this.customChip(key) || {}).card || {};
        return c.type === 'custom:hk-status-chip-card' || (c.type === 'conditional' && c.card && c.card.type === 'custom:hk-status-chip-card');
      }
      // in a few words: "Always on 2 · When Active on 1"
      chipSays(list) {
        var a = list.filter(function (s) { return s.on && !s.quiet; }).length, q = list.filter(function (s) { return s.on && s.quiet; }).length;
        var parts = [];
        if (a) parts.push('Always on ' + a);
        if (q) parts.push('When Active on ' + q);
        return parts.join(' · ') || 'On No Screens';
      }
      // the chips a type feeds (M.CHIP_SOURCES turned around; a garage door is
      // counted by Doors & Windows too)
      chipsOfType(kind) {
        var out = Object.keys(M.CHIP_SOURCES).filter(function (ch) { return (M.CHIP_SOURCES[ch].kinds || []).indexOf(kind) >= 0; });
        if (kind === 'garage' && out.indexOf('doors_windows') < 0) out.push('doors_windows');
        return out.filter(function (ch) { return (this.data.chip_kinds || []).indexOf(ch) >= 0; }, this);
      }
      h_chips(c) {
        var self = this, d = this.data, kinds = d.chip_kinds || [];
        var screens = Object.keys(d.boards || {}).map(function (p) { return { p: p, b: d.boards[p], x: self.dash(p) }; })
          .filter(function (o) { return o.x && o.b.home_page !== false; })
          .sort(function (a, b) { return a.x.title.localeCompare(b.x.title); });
        c.appendChild(K.group({ header: 'Screens', footer: 'Each screen’s chip row: on or off, Automatic (a chip for everything the house has) or its own chips in its own order.' },
          screens.map(function (o) {
            var b = o.b, v = !b.chips_row ? 'Off' : (b.chips || []).length ? b.chips.length + ' Chips' : 'Automatic';
            return K.nav({ label: o.x.title, value: v, href: '#/screens/' + encodeURIComponent(o.p) + '/chips', sk: 'chips:screen:' + o.p });
          })));
        c.appendChild(K.group({ header: 'Chips', footer: 'Each chip on every screen: Always, or only When Active — while something is on, open, running or wet. Smoke & CO needs nothing here: it leads every screen’s row, in red, when an alarm goes off.' },
          kinds.map(function (k) {
            return K.nav({ label: M.CHIP_LABELS[k] || k, value: self.chipSays(self.chipScreens(k)), href: '#/house/chips/' + k, sk: 'chips:kind:' + k });
          })));
        var lib = d.custom_chips || [];
        if (lib.length) c.appendChild(K.group({ header: 'Custom Chips', footer: 'Your own chips, set the same way. Always takes a conditional chip out of its condition; When Active shows one only while its entity is on, open or running — or as its own active: rules say.' },
          lib.map(function (x) {
            return K.nav({ label: x.name, value: self.chipSays(self.chipScreens('chip:' + x.key)), href: '#/house/chips/' + encodeURIComponent('chip:' + x.key),
                           sk: 'chips:kind:chip:' + x.key });
          })));
        c.appendChild(this.chipCountsGroup());
      }
      // WHAT THE CHIPS COUNT, a tap away (2026-10-13): adding to a chip or
      // hiding from it is Accessories', type by type -- said and linked on
      // every Status Chips page
      chipCountsGroup() {
        return K.group({ header: 'What the Chips Count', footer: 'To count something more in a chip — an outlet with a lamp, a group helper — or hide something from it, open its type in Accessories: Add… and Hidden are there. The same on every screen. Your own chips are in Custom Chips.' }, [
          K.nav({ label: 'Accessories', sub: 'Add to a chip, or hide from it, type by type', icon: 'mdi:lightbulb-group', href: '#/accessories', sk: 'chips:accessories' }),
          K.nav({ label: 'Custom Chips', sub: 'Chips you write yourself', icon: 'mdi:label-variant', href: '#/chips', sk: 'chips:custom' })]);
      }
      h_chipOne(c, kind) {
        var self = this, list = this.chipScreens(kind), wide = this.hasAttribute('wide');
        var on = list.filter(function (s) { return s.on; }), off = list.filter(function (s) { return !s.on; });
        var ckey = kind.indexOf('chip:') === 0 ? kind.slice(5) : null, cchip = ckey ? this.customChip(ckey) : null;
        if (ckey && !cchip) { c.appendChild(K.group({ footer: 'That chip isn’t there any more.' }, [])); return; }
        var setShow = function (s, quiet) {
          if (!ckey) return self.setB(s.path, M.chipQuiet(s.b, kind, quiet));
          var m = Object.assign({}, s.b.chips_custom_show || {});
          m[ckey] = quiet ? 'active' : 'always';
          return self.setB(s.path, { chips_custom_show: m });
        };
        var can = !ckey || this.customSwitchable(ckey);
        if (on.length) c.appendChild(K.group({ header: 'Shown On', footer: !can
            ? 'It is written as another kind of card, so it shows as written. A status chip (custom:hk-status-chip-card), or one inside a conditional, can be Always or When Active.'
            : ckey ? 'When Active: only while ' + (cchip.card.type === 'conditional' ? 'its condition is met' : 'its entity is on, open or running — or as its own active: rules say') +
                     '. Always: all the time' + (cchip.card.type === 'conditional' ? ', out of its condition.' : '.')
            : 'When Active: only while something is on, open, running or wet — Doors & Windows only while one is open.' },
          on.map(function (s) {
            if (!can) return K.info({ label: s.title, value: 'As Written' });
            return K.seg({ label: s.title, sk: 'chips:quiet:' + s.path, value: s.quiet ? 'quiet' : 'always', stack: !wide,
                           options: [['always', 'Always'], ['quiet', 'When Active']],
                           onChange: function (v) { setShow(s, v === 'quiet'); } });
          })));
        if (ckey) {
          c.appendChild(K.group({ footer: 'Its name, where it sits and its YAML.' }, [
            K.nav({ label: 'Edit ' + cchip.name, icon: 'mdi:code-braces', href: '#/chips/' + encodeURIComponent(ckey), sk: 'chips:edit:' + ckey })]));
        }
        if (off.length) c.appendChild(K.group({ header: 'Not Shown On', footer: 'Add it on the screen’s Status Chips.' },
          off.map(function (s) {
            return K.nav({ label: s.title, value: s.row ? 'Not in Its Row' : 'Chip Row Off', href: '#/screens/' + encodeURIComponent(s.path) + '/chips', sk: 'chips:add:' + s.path });
          })));
        var src = M.CHIP_SOURCES[kind] || {};
        var counts = (src.kinds || []).concat(kind === 'doors_windows' ? ['garage'] : []).filter(function (k, i, a) { return a.indexOf(k) === i; });
        // a chip that reads one setting (Weather Alerts, Energy): no types to open
        if (!counts.length && !ckey) c.appendChild(K.group({ header: 'What It Counts', footer: 'This chip reads one setting rather than a type of accessory: set it on any screen’s page for this chip.' }, []));
        if (counts.length) c.appendChild(K.group({ header: 'What It Counts', footer: 'Tap a type to change what this chip counts: Add… counts something more (an outlet with a lamp, a group helper); open an accessory to hide it from the chip. The same on every screen.' }, counts.map(function (k) {
          var T = M.accType(k);
          return K.nav({ label: T ? T[1] : k, tile: T ? [T[2], T[3]] : null, value: String((((self.data.counts || {})[k] || {}).found || []).length),
                         href: '#/accessories/type/' + k });
        })));
      }
      s_chips(c, x, b) {
        var self = this, path = x.path, base = '#/screens/' + encodeURIComponent(path);
        var set = function (ch) { return self.setB(path, ch); };
        var kinds = this.data.chip_kinds;
        c.appendChild(K.group({ footer: b.chips_row ? null : 'No chip row on this screen.' }, [
          K.toggle({ label: 'Show Status Chips', sk: 'b:chips_row', on: b.chips_row, onChange: function (on) { set({ chips_row: on }); } })]));
        if (!b.chips_row) return;
        var lib = this.data.custom_chips || [];
        // (the Intercom is More's, where the page has one -- never in Hosts without it, Home Assistant)
        var mdl = M.chipsModel(b, kinds, lib, !!(this.client && this.client.intercom));
        var lab = function (r) { return r.custom ? r.name : r.value === 'intercom' ? M.CHIP_LABELS.intercom : r.own ? self.name(r.value) : M.CHIP_LABELS[r.value] || r.value; };
        c.appendChild(K.listEditor({
          fk: 'chips', auto: mdl.auto, announce: this.announce.bind(this), minRows: 1,
          autoFooter: 'Automatic shows a chip for everything the house has, in the usual order. A kind the house has nothing of never shows.',
          rows: mdl.rows.map(function (r) {
            return { value: r.value, label: lab(r), removable: r.own || r.custom,
                     sub: r.custom ? 'Custom chip' + (self.customShow(b, r.key) === 'active' ? ' · Only When Active' : '') : r.value === 'intercom' ? 'Opens the Intercom' : r.own ? 'Accessory chip' : r.quiet ? 'Only When Active' : null,
                     href: r.custom ? '#/chips/' + encodeURIComponent(r.key) : r.value === 'intercom' ? null
                                    : r.own ? '#/accessories/' + encodeURIComponent(r.value) : base + '/chips/' + r.value };
          }),
          more: mdl.more.map(function (r) { return { value: r.value, label: lab(r), sub: r.custom ? 'Custom chip' : r.value === 'intercom' ? 'Opens the Intercom' : null }; }),
          onAdd: function (v) {
            if (v.indexOf(M.CHIP_TOKEN) === 0) { set(M.chipsAddCustom(b, v.slice(M.CHIP_TOKEN.length))); return; }
            set(M.chipsSave(mdl.rows.map(function (r) { return r.value; }).concat(v), kinds, lib));
          },
          onAuto: function (on) {
            if (!on) { set({ chips: mdl.rows.map(function (r) { return r.value; }) }); return; }
            self.confirmSwitch({ title: 'Use Automatic Chips?', message: 'This screen’s chip order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set({ chips: [] }); });
          },
          onChange: function (v) { set(M.chipsSave(v, kinds, lib)); },
          onRemove: function (v) {
            if (v.indexOf(M.CHIP_TOKEN) === 0) { set(M.chipsRemoveCustom(b, v.slice(M.CHIP_TOKEN.length))); return; }
            set(M.chipsRemoveOwn(b, v));
          },
          addLabel: 'Add Accessory Chip…', onAddOther: function () {
            self.go(self.picker('chip-add', { title: 'Add Accessory Chip', value: null, multi: true,
              items: function () {
                return self.entityIds({ re: CHIP_POOL, shown: true }).filter(function (id) { return (b.chips_extra || []).indexOf(id) < 0; })
                  .map(function (id) { return { value: id, label: self.name(id), sub: id }; });
              },
              onPick: function (id) { if (id) set(M.chipsAddOwn(b, id)); } }));
          }
        }));
        c.appendChild(this.chipCountsGroup());
        c.appendChild(K.group({ footer: h('span', {}, ['Every screen’s chips side by side: ', h('a', { href: '#/house/chips', text: 'All Screens → Status Chips' }),
          '. An accessory chip’s look is in its settings.']) }, [
          K.nav({ label: 'All Screens’ Status Chips', icon: 'mdi:label-multiple', href: '#/house/chips', sk: 'chips:all' })]));
      }
      s_chip(c, x, b, kind) {
        var self = this, quiet = (b.chips_quiet || []).indexOf(kind) >= 0;
        c.appendChild(K.group({ footer: 'When Active: the chip appears only while something is on, open, running or wet — Doors & Windows only while one is open.' }, [
          K.seg({ label: 'Show', sk: 'b:chips_quiet:' + kind, value: quiet ? 'quiet' : 'always', stack: !this.hasAttribute('wide'),
                  options: [['always', 'Always'], ['quiet', 'When Active']],
                  onChange: function (v) { self.setB(x.path, M.chipQuiet(b, kind, v === 'quiet')); } })]));
        var src = M.CHIP_SOURCES[kind] || {}, rows = [];
        (src.kinds || []).forEach(function (k) {
          var ck = (self.data.counts || {})[k] || { found: [] };
          var lbl = M.COUNT_KINDS.filter(function (y) { return y[0] === k; })[0];
          rows.push(K.nav({ label: lbl ? lbl[1] : k, value: String(ck.found.length), href: '#/accessories/type/' + k }));
        });
        if (src.setting && src.setting[0] === 'here') {
          // THE CHIP'S READING, chosen here (was Status & Chips -> Readings): the
          // house's, the same on every screen
          var rk = src.setting[1] === 'Indoor Temperature' ? 'features.temperature' : 'features.power';
          rows.push(this.entityRow({ label: src.setting[1], sk: rk, value: this.hs(rk),
            none: rk === 'features.temperature' ? 'First Thermostat’s' : 'None',
            filter: { domains: ['sensor'], dc: rk === 'features.temperature' ? 'temperature' : 'power' },
            onPick: function (v) { var o = {}; o[rk] = v; self.setH(o); } }));
        } else if (src.setting) {
          var map = { 'Alarm Panel': 'security.alarm', 'Weather Alerts Sensor': 'weather.alerts' };
          var v = this.hs(map[src.setting[1]]);
          rows.push(K.nav({ label: src.setting[1], value: v ? this.name(v) : 'None', href: '#/' + src.setting[0] }));
        }
        c.appendChild(K.group({ header: 'What It Counts', footer: (src.kinds || []).length ? 'Tap a type to change what this chip counts: Add… counts something more (an outlet with a lamp, a group helper); open an accessory to hide it from the chip. The same on every screen.' : 'The same on every screen.' }, rows));
      }
      // NOT THE HOUSE'S CAMERAS (hk-strategy.js notHouseCamera: its rule, when it is loaded):
      // a wall tablet's own -- Fully Kiosk's, or Kiosk Satellite's, which comes
      // through ESPHome and is told apart by its device's manufacturer -- and
      // Live TV's channels.
      notHouseCamera(id) {
        var hs = this.client || {}, e = (hs.entities || {})[id] || {};
        var S = window.hkStrategy;
        if (S && typeof S.notHouseCamera === 'function') return S.notHouseCamera(hs, e);
        if ({ fully_kiosk: 1, hk_frontend: 1, hk_tv: 1 }[e.platform]) return true;
        var d = e.device_id && (hs.devices || {})[e.device_id];
        return !!d && d.manufacturer === 'kiosk_satellite';
      }
      s_cameras(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); }, ents = this.client.entities || {};
        var ok = this.entityIds({ domains: ['camera'], shown: true }).filter(function (id) { return !self.notHouseCamera(id); }).sort();
        var autoCams = M.autoCameras(ok, function (id) { return (ents[id] || {}).device_id; });
        var top = [];
        if (x.generated) top.push(K.toggle({ label: 'Show Camera Strip', sk: 'b:camera_strip', on: b.camera_strip,
                                             onChange: function (on) { set({ camera_strip: on }); } }));
        top.push(this.entityRow({ label: 'Live Camera Follows', sk: 'b:camera_live', value: b.camera_live || null, none: 'First Camera',
          filter: { domains: ['input_select', 'select'] }, onPick: function (v) { set({ camera_live: v || '' }); } }));
        top.push(K.nav({ label: 'Set Up Live Camera Follows', href: '#/screens/' + encodeURIComponent(x.path) + '/cameras/live',
                         icon: 'mdi:cctv', fk: 'cams:live' }));
        // LIVE FIRST CAMERA, this screen's own or All Screens' (2026-10-10)
        var hLive = (this.data.settings.cameras || {}).live !== false, ownLive = typeof b.camera_live_video === 'boolean';
        top.push(K.toggle({ label: 'Live First Camera', sk: 'b:camera_live_video', on: ownLive ? b.camera_live_video : hLive,
          sub: ownLive ? 'Just This Screen' : 'Same as All Screens', onChange: function (on) { set({ camera_live_video: on }); } }));
        if (ownLive) top.push(K.button({ label: 'Reset to All Screens (' + (hLive ? 'On' : 'Off') + ')', sk: 'b:camera_live_video:reset',
                                         onClick: function () { set({ camera_live_video: null }); } }));
        c.appendChild(K.group({ footer: 'The first tile plays live video; the others show snapshots. A dropdown helper can choose which camera is first — the one where someone was just seen, say. ' +
            'Live First Camera off makes the first tile a snapshot too: no video to decode, lighter on a computer or an older tablet.' }, top));
        if (x.generated && !b.camera_strip) { this.cameraRelated(c, x); return; }
        // WHICH CAMERAS: All Screens' (Cameras, on the sidebar), or this
        // screen's own. Turning Same off starts from All Screens' as they are.
        var follows = !b.cameras_custom;
        c.appendChild(K.group({ footer: follows ? 'This screen’s cameras follow Cameras (All Screens). Turn this off to choose them here, for this screen only.'
            : 'This screen sets its own. Turn this on to follow Cameras (All Screens) again.' }, [
          K.toggle({ label: 'Same as All Screens', sk: 'b:cameras_custom', on: follows, onChange: function (on) {
            if (!on) { set({ cameras_custom: true, cameras: (b.cameras || []).slice() }); return; }
            self.confirmSwitch({ title: 'Follow All Screens’ Cameras?', message: 'This screen’s own camera order and choices will be replaced.', ok: 'Follow All Screens' },
                function () { set({ cameras_custom: false }); });
          } })]));
        if (follows) {
          this.fromAllScreens(c, [K.info({ label: 'Cameras', value: (b.cameras || []).length ? b.cameras.length + ' Cameras' : 'Automatic' })],
                              'Cameras', '#/page/cameras');
          this.cameraRelated(c, x);
          return;
        }
        var mdl = M.camerasModel(b, ok, autoCams);
        c.appendChild(K.listEditor({ fk: 'cams', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic shows one of every camera, its low-resolution channel. The Cameras page shows the same ones.',
          rows: mdl.rows.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
          more: mdl.more.map(function (r) { return { value: r.value, label: self.name(r.value) }; }),
          onAuto: function (on) {
            if (!on) { set({ cameras: mdl.rows.map(function (r) { return r.value; }) }); return; }
            self.confirmSwitch({ title: 'Use Automatic Cameras?', message: 'This screen’s camera order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set({ cameras: [] }); });
          },
          onChange: function (v) { set({ cameras: v }); } }));
        this.cameraRelated(c, x);
      }
      // LIVE CAMERA FOLLOWS, explained where it is set: what it does, the
      // dropdown's options for this screen's cameras (made for you, if you
      // like), and the automation that moves it, written for your cameras'
      // own person and motion sensors (M.livePlan, M.liveYaml).
      s_cameraLive(c, x, b) {
        var self = this, hs = this.client, ents = hs.entities || {}, devs = hs.devices || {};
        var set = function (ch) { return self.setB(x.path, ch); };
        var ok = this.entityIds({ domains: ['camera'], shown: true }).filter(function (id) { return !self.notHouseCamera(id); }).sort();
        var mdl = M.camerasModel(b, ok, M.autoCameras(ok, function (id) { return (ents[id] || {}).device_id; }));
        var cams = mdl.rows.map(function (r) {
          var dev = devs[(ents[r.value] || {}).device_id] || {};
          return { entity: r.value, name: self.name(r.value), device: (ents[r.value] || {}).device_id || null,
                   deviceName: dev.name_by_user || dev.name || null };
        });
        var onCam = {};
        cams.forEach(function (x2) { if (x2.device) onCam[x2.device] = true; });
        var sensors = Object.keys(ents).filter(function (id) {
          return id.indexOf('binary_sensor.') === 0 && onCam[ents[id].device_id];
        }).map(function (id) {
          var st = hs.states[id], dc = st && st.attributes.device_class;
          var kind = /person/.test(id) ? 'person' : (dc === 'motion' || dc === 'occupancy' || /motion/.test(id)) ? 'motion' : null;
          return { entity: id, device: ents[id].device_id, kind: kind };
        }).filter(function (s2) { return s2.kind; });
        var sel = b.camera_live || '';
        var selSt = sel && hs.states[sel];
        var have = selSt && Array.isArray(selSt.attributes.options) ? selSt.attributes.options.map(String) : null;
        var plan = M.livePlan(cams, sensors, have);

        c.appendChild(K.group({ header: 'How It Works', footer: 'The camera strip’s first tile plays live; the others are snapshots. ' +
            'Live Camera Follows is a dropdown helper (an input_select) whose options are your cameras’ names. Whichever option is ' +
            'chosen, that camera plays live. An automation that chooses the camera where a person or motion was just seen makes ' +
            'the strip follow what’s happening. Nothing chosen, or an option that names no camera: the first camera plays.' }, [
          this.entityRow({ label: 'Live Camera Follows', sk: 'b:camera_live', value: sel || null, none: 'First Camera',
            filter: { domains: ['input_select', 'select'] }, onPick: function (v) { set({ camera_live: v || '' }); } })]));

        if (!plan.length) {
          c.appendChild(K.group({ footer: 'This screen has no cameras in its strip yet. Add them on the Cameras page first.' }, []));
          return;
        }
        var opts = plan.map(function (p) { return p.option; });
        var rows = plan.map(function (p) {
          return K.info({ label: p.option, sub: p.name + ' · ' + (p.missing ? 'not in the dropdown yet — add this option'
            : p.sensor ? 'follows ' + self.name(p.sensor) : 'no motion sensor found'), valueCls: p.missing ? 'warn' : null,
            value: p.missing ? 'Missing' : undefined });
        });
        var missing = plan.filter(function (p) { return p.missing; }).length;
        if (!sel) {
          rows.push(K.button({ label: 'Create the Dropdown', fk: 'cams:live:create', onClick: function () {
            self.actions().callWS({ type: 'input_select/create', name: 'Live Camera', icon: 'mdi:cctv', options: opts }).then(function (item) {
              return set({ camera_live: 'input_select.' + item.id }).then(function () { self.announce('Live Camera made and chosen'); });
            }, function (e) { self.announce('Couldn’t make it: ' + ((e && e.message) || e)); });
          } }));
        }
        c.appendChild(K.group({ header: '1. The Dropdown’s Options', footer: sel
            ? (missing ? 'The dropdown has no option for ' + (missing === 1 ? 'one camera' : missing + ' cameras') + ' in this ' +
                'screen’s strip. Add ' + (missing === 1 ? 'it' : 'them') + ', spelled as shown, in ' + haPlace('Settings → Devices & Services → Helpers') + '; until then the automation leaves ' + (missing === 1 ? 'it' : 'them') + ' out.'
              : 'The dropdown has an option for every camera in this screen’s strip.')
            : 'Create the Dropdown makes a dropdown helper called Live Camera with these options, and chooses it above. ' +
              'Or make your own in ' + haPlace('Settings → Devices & Services → Helpers → Create Helper → Dropdown') + '.' }, rows));

        var yaml = M.liveYaml(plan, sel || 'input_select.live_camera');
        if (!yaml) {
          c.appendChild(K.group({ header: '2. The Automation', footer: 'None of these cameras has a person or motion sensor on its ' +
            'device, so there’s nothing to write for you. Make an automation that sets the dropdown to a camera’s option when ' +
            'something happens there.' }, []));
          return;
        }
        var pre = h('pre', { class: 'code', text: yaml, tabindex: '0', 'aria-label': 'The automation, in YAML' });
        c.appendChild(K.group({ header: '2. The Automation', footer: 'Copy it, then in Settings → Automations & Scenes choose ' +
            'Create Automation → Create New Automation → ⋮ → Edit in YAML, paste it over everything there, and save. It chooses the ' +
            'camera where a person (or motion) was just seen, and the first camera again after five quiet minutes. ' +
            (sel ? '' : 'It sets Live Camera; if you name your dropdown differently, change input_select.live_camera in it.') }, [
          K.button({ label: 'Copy Automation', fk: 'cams:live:copy', onClick: function () {
            var done = function () { self.announce('Copied'); };
            var fallback = function () {
              var r = document.createRange(); r.selectNodeContents(pre);
              var s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(r);
              self.announce('Selected — copy it with your keyboard');
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(yaml).then(done, fallback);
            else fallback();
          } }),
          K.nav({ label: 'Open Automations', href: '/config/automation/dashboard', icon: 'mdi:open-in-new', fk: 'cams:live:auto' })]));
        c.appendChild(pre);
      }
      s_scenes(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); }, ents = this.client.entities || {};
        c.appendChild(K.group({}, [K.toggle({ label: 'Show Scenes Row', sk: 'b:scenes_row', on: b.scenes_row,
                                              onChange: function (on) { set({ scenes_row: on }); } })]));
        if (!b.scenes_row) return;
        var autoScenes = x.generated ? this.entityIds({ domains: ['scene'], shown: true })
          .sort(function (p, q) { return self.name(p).localeCompare(self.name(q)); }) : [];
        void ents;
        // the Energy page's pill only while the Energy feature gives it a page
        var energyOn = this.energyOn(), powerOn = this.powerOn();
        // (the Intercom's pill is More's where the page has the Intercom; the house's list, from Home Assistant, may name it)
        var icOn = !!(this.client && this.client.intercom);
        var scenePages = (this.data.scene_pages || []).filter(function (k) { return k !== 'intercom' && (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); })
          .concat(icOn ? ['intercom'] : []);
        var mdl = M.scenesModel(b, autoScenes, scenePages);
        var pills = this.hs('look.page_pills') || {};
        var lab = function (r) { return r.page ? (pills[r.page] || {}).name || M.PAGE_LABELS[r.page] || r.page : self.name(r.value); };
        c.appendChild(K.listEditor({ fk: 'scenes', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: x.generated ? 'Automatic shows every scene, A to Z, then any page pills.' :
            'Automatic shows the scenes this screen’s YAML lists, then any page pills. Choosing scenes here replaces the YAML’s list.',
          emptyText: x.generated ? 'No scenes' : 'The scenes in this screen’s YAML',
          rows: mdl.rows.map(function (r) {
            return { value: r.value, label: lab(r), sub: r.page ? (r.page === 'intercom' ? 'Opens the Intercom' : 'Opens the page') : null, removable: !!r.page,
                     href: r.page ? (r.page === 'intercom' ? null : '#/page/' + r.page + '/pill')
                                  : '#/accessories/' + encodeURIComponent(r.value) };
          }),
          more: mdl.more.map(function (r) { return { value: r.value, label: lab(r), sub: r.page === 'intercom' ? 'A pill that opens the Intercom' : 'A pill that opens the page' }; }),
          onAuto: function (on) {
            if (!on) { set(M.scenesSave(mdl.rows.map(function (r) { return r.value; }))); return; }
            self.confirmSwitch({ title: 'Use Automatic Scenes?', message: 'This screen’s scene order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set({ scenes: [] }); });
          },
          onAdd: mdl.auto ? function (v) { set(M.scenesPagePill(b, v.slice(M.PAGE_TOKEN.length), true)); } : null,
          onRemove: function (v) { set(M.scenesPagePill(b, v.slice(M.PAGE_TOKEN.length), false)); },
          onChange: function (v) { set(M.scenesSave(v)); },
          addLabel: 'Add Scene or Shortcut…', onAddOther: function () {
            self.go(self.picker('scene-add', { title: 'Add Scene or Shortcut', value: null, multi: true,
              items: function () {
                return self.entityIds({ re: SCENE_POOL, shown: true })
                  .filter(function (id) { return mdl.rows.every(function (r) { return r.value !== id; }); })
                  .map(function (id) { return { value: id, label: self.name(id), sub: id }; });
              },
              onPick: function (id) { if (id) set(M.scenesSave(mdl.rows.map(function (r) { return r.value; }).concat(id))); } }));
          } }));
        c.appendChild(K.group({ footer: 'A scene’s name, icon and color on the pill are in its settings. A page pill’s are the same on every screen (All Screens → Appearance → Page Pills): tap it.' }, []));
      }
      // A PAGE PILL'S LOOK: its name, icon and color, the same on
      // every screen (look.page_pills) -- "Play Music" can be "Apple Music"
      // A SCREEN'S PAGE HEADERS (2026-10-16): each page's header Same as All
      // Screens or Off on This Screen (its `headers`, {page: false}). What a
      // header held comes back when it is off (the Water page's main valve,
      // Timers' Quick Start).
      s_pageHeaders(c, x, b) {
        var self = this, S = this.data.settings || {}, own = b.headers || {};
        var listed = this.pagesListed().filter(function (p) { return M.HEADER_PAGES[p[0]] && M.screenShows(b, p[0]); });
        if (!listed.length) { c.appendChild(K.group({ footer: 'None of this screen’s pages has a header.' }, [])); return; }
        c.appendChild(K.group({ footer: 'Off here, a page’s header is off on this screen alone; what it held comes back to the page — the Water page’s main valve as a tile, ' +
            'the Timers page’s Quick Start beside what runs. A header off for All Screens is off everywhere (its page, under Pages).' },
          listed.map(function (p) {
            var house = ((S.headers || {})[p[0]] || {}).show !== false, mine = own[p[0]] === false;
            return K.toggle({ label: p[1], sub: !house ? 'Off for All Screens' : mine ? 'Off on This Screen' : 'Same as All Screens',
              on: house && !mine, disabled: !house, sk: 'b:headers', fk: 'pghd:' + p[0],
              onChange: function (on) {
                var next = Object.assign({}, own);
                if (on) delete next[p[0]]; else next[p[0]] = false;
                self.setB(x.path, { headers: next });
              } });
          })));
      }
      s_pill(c, x, b, kind) {
        var self = this, all = Object.assign({}, this.hs('look.page_pills') || {}), mine = Object.assign({}, all[kind] || {});
        var put = function (k, v) {
          var next = Object.assign({}, mine);
          if (v) next[k] = v; else delete next[k];
          var out = Object.assign({}, all);
          if (Object.keys(next).length) out[kind] = next; else delete out[kind];
          self.setH({ 'look.page_pills': out });
        };
        var def = M.PAGE_PILL_DEFAULTS[kind] || ['', '', 'white'];
        c.appendChild(K.group({ footer: 'The pill on every screen that shows it. Empty: its own ' + (def[0] ? '“' + def[0] + '”' : 'name') + '.' }, [
          K.text({ label: 'Name', sk: 'look.page_pills', value: mine.name || '', placeholder: def[0], maxlength: 40,
                   error: this.err('look.page_pills'), onCommit: function (v) { put('name', v.trim()); } }),
          K.text({ label: 'Icon', sk: 'look.page_pills.icon', value: mine.icon || '', placeholder: def[1], maxlength: 60,
                   onCommit: function (v) { put('icon', v.trim()); } }),
          K.select({ label: 'Color', sk: 'look.page_pills.color', value: mine.color || '', placeholder: 'Default',
                     options: [['', 'Default (' + M.colorLabel(def[2]) + ')']].concat(M.PILL_COLORS.map(function (k) { return [k, M.colorLabel(k)]; })),
                     onChange: function (v) { put('color', v); } })]));
        void x; void b;
      }
      s_favorites(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); };
        c.appendChild(K.listEditor({ fk: 'favs', announce: this.announce.bind(this), emptyText: 'No Favorites section',
          shownHeader: 'Favorites',
          rows: b.favorites.map(function (id) { return { value: id, label: self.name(id), href: '#/accessories/' + encodeURIComponent(id) }; }),
          onChange: function (v) { set({ favorites: v }); },
          addLabel: 'Add Favorite…', onAddOther: function () {
            self.go(self.picker('fav-add', { title: 'Add Favorite', value: null, multi: true,
              items: function () {
                return self.entityIds({ re: FAV_POOL, shown: true }).filter(function (id) { return b.favorites.indexOf(id) < 0; })
                  .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
              },
              onPick: function (id) { if (id) set({ favorites: b.favorites.concat(id) }); } }));
          } }));
        c.appendChild(K.group({ footer: 'A Favorites section above the rooms. A favorite’s own name and icon there are in its settings.' }, []));
      }
      // SLEEP SCREEN (2026-10-09; sleep_rules.py, sleep_engine.py): HOW the
      // tablet goes dark (Drawn By, While Dark), WHO decides when (an
      // automation, or HK Frontend), and -- HK Frontend deciding -- the rules:
      // the kiosk, the photos' time, quiet hours, presence and the lists, and
      // the brightness. Every write sends the whole Sleep Screen (the server
      // keeps no half of it).
      // WHOSE SLEEP SCREEN: a tablet's (1.14: x.tablet), else -- a screen
      // from before -- the screen's
      sleepCtx(x) {
        var self = this;
        if (x.tablet) {
          var tid = x.tablet;
          return { key: tid, base: '#/house/tablets/' + encodeURIComponent(tid) + '/sleep', err: 't:sleep',
                   set: function (ch) { return self.setT(tid, ch); } };
        }
        return { key: x.path, base: '#/screens/' + encodeURIComponent(x.path) + '/sleep', err: 'b:sleep',
                 set: function (ch) { return self.setB(x.path, ch); } };
      }
      s_sleep(c, x, b) {
        var self = this, ctx = this.sleepCtx(x), base = ctx.base, wide = this.hasAttribute('wide');
        var sl = b.sleep || {}, hk = sl.decided_by === 'hk' || sl.decided_by === 'shadow';
        var put = function (ch) { return ctx.set({ sleep: Object.assign({}, sl, ch) }); };
        var ids = (this.data.screensavers || {})[ctx.key] || {};
        var choices = (this.data.choices || {}).sleep || {};
        var mins = function (m) { return m < 60 ? m + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours'); };
        var secs = function (v) { return v === 0 ? 'None' : v < 60 ? v + ' s' : mins(v / 60); };
        c.appendChild(K.group({ header: 'Going Dark', footer: 'Drawn By: Kiosk Satellite puts its own Black screensaver up; ' + PN() + ' draws the black on this page and turns the backlight down itself, then fades back in with it (Kiosk Satellite’s is its fallback). ' +
            'While Dark: a display that is off has no glow at all, but a tap cannot wake it — the power button, the doorbell or somebody walking in can.' }, [
          K.seg({ label: 'Drawn By', sk: 'b:black_screen', stack: !wide, value: b.black_screen || 'kiosk',
                  options: [['kiosk', 'Kiosk Satellite'], ['hk', PN()]], onChange: function (v) { ctx.set({ black_screen: v }); } }),
          K.seg({ label: 'While Dark', sk: 'b:sleep.dark_display', stack: !wide, value: sl.dark_display || 'lowest',
                  options: [['lowest', 'Lowest Backlight'], ['off', 'Display Off'], ['off_quiet', 'Off in Quiet Hours']],
                  onChange: function (v) { put({ dark_display: v }); } })]));
        var sw = b.black_switch || ids.black, sens = ids.sleep;
        c.appendChild(K.group({ header: 'Decided By', footer: sl.decided_by === 'shadow'
            ? 'Trying it out: ' + PN() + ' decides by the rules below but does not act yet' + (sens ? ' — ' + sens + ' shows what it would do, and why.' : '.') + ' Choose ' + PN() + ' to let it.'
            : hk ? PN() + ' sleeps and wakes this tablet itself, by the rules below' + (sens ? ' — ' + sens + ' says what it decides, and why.' : '.')
            : 'An automation of yours decides: it turns ' + (sw || 'the tablet’s black screen switch') + ' on to sleep and off to wake — the Set black screen action also takes the brightness to wake to. Nothing here makes the tablet sleep by itself.' }, [
          K.seg({ label: 'Decided By', sk: 'b:sleep.decided_by', stack: !wide, value: hk ? 'hk' : 'automation',
                  options: [['automation', 'An Automation'], ['hk', PN()]], onChange: function (v) { put({ decided_by: v }); } })]));
        if (hk) {
          var ks = (this.data.choices || {}).kiosks || [];
          var kfoot = 'The tablet’s Kiosk Satellite: how ' + PN() + ' powers its display, sets its brightness, brings the dashboard back in front, and knows another app is in front (it then leaves the tablet alone).';
          if (x.tablet) {
            // the tablet's own Kiosk App and Device (its page's Setup)
            var kd = ks.filter(function (k) { return k.id === sl.kiosk; })[0];
            c.appendChild(K.group({ header: 'Kiosk', footer: kfoot + (kd ? '' : ' Choose it on the tablet’s page: Kiosk App, Kiosk Satellite, and its Device.') }, [
              K.nav({ label: 'Kiosk Satellite', value: kd ? kd.name : 'None', sk: 't:sleep.kiosk',
                      href: '#/house/tablets/' + encodeURIComponent(x.tablet) })]));
          } else {
            c.appendChild(K.group({ header: 'Kiosk', footer: kfoot }, [
              K.select({ label: 'Kiosk Satellite', sk: 'b:sleep.kiosk', value: sl.kiosk || '',
                         options: [['', 'None']].concat(ks.map(function (k) { return [k.id, k.name]; })),
                         onChange: function (v) { put({ kiosk: v }); } })]));
          }
          var after = (choices.after_saver || [0, 15, 30, 60, 120]).map(function (m) { return [m, m ? 'After ' + mins(m) : 'Never']; });
          var sched = [K.select({ label: 'After the Screensaver', sk: 'b:sleep.after_saver', value: sl.after_saver || 0, options: after,
                                  onChange: function (v) { put({ after_saver: Number(v) }); } }),
                       K.toggle({ label: 'Quiet Hours Schedule', sk: 'b:sleep.schedule', on: !!sl.schedule,
                                  onChange: function (on) { put({ schedule: on }); } })];
          if (sl.schedule) {
            sched.push(K.text({ label: 'From', sk: 'b:sleep.quiet_from', value: sl.quiet_from, placeholder: '22:00', error: this.err(ctx.err),
                                onCommit: function (v) { put({ quiet_from: v.trim() }); } }));
            sched.push(K.text({ label: 'To', sk: 'b:sleep.quiet_to', value: sl.quiet_to, placeholder: '07:00',
                                onCommit: function (v) { put({ quiet_to: v.trim() }); } }));
          }
          sched.push(K.nav({ label: 'Quiet While', href: base + '/quiet', sk: 'b:sleep.quiet_while', value: self.sleepCount(sl.quiet_while) }));
          c.appendChild(K.group({ header: 'When It Goes Dark', footer: 'After the Screensaver: dark once the photos have shown that long with nobody touching it (with Presence, nobody new coming in). Quiet hours, by the clock and while anything in Quiet While is on: dark even with somebody in the room — a tap still wakes it.' }, sched));
          var linger = (choices.linger || [0, 30, 60, 120, 300]).map(function (v) { return [v, secs(v)]; });
          c.appendChild(K.group({ header: 'Who Is There', footer: 'Somebody in the room: the photos (a dark tablet wakes to the dashboard, and the photos follow on their own); somebody touching it: the dashboard; nobody: dark.' }, [
            K.nav({ label: 'Presence', href: base + '/presence', sk: 'b:sleep.presence', value: (sl.presence || []).length ? self.sleepCount(sl.presence) : 'Always Occupied' }),
            K.select({ label: 'Linger', sk: 'b:sleep.linger', value: sl.linger == null ? 60 : sl.linger, options: linger,
                       onChange: function (v) { put({ linger: Number(v) }); } }),
            K.nav({ label: 'Only While Lit', href: base + '/lit', sk: 'b:sleep.lit', value: self.sleepCount(sl.lit) }),
            K.nav({ label: 'Sleep Until Re-entered', href: base + '/reset', sk: 'b:sleep.reset', value: self.sleepCount(sl.reset) })]));
          this.sleepNear(c, sl, base, put);
          c.appendChild(K.group({ header: 'Overrides', footer: 'In this order: Wake For, Hold While, Keep Awake While, Stay Dark While — all before who is in the room. Another app in front is always left alone.' }, [
            K.nav({ label: 'Wake For', href: base + '/wake', sk: 'b:sleep.wake_for', value: self.sleepCount(sl.wake_for) }),
            K.nav({ label: 'Hold While', href: base + '/hold', sk: 'b:sleep.hold_while', value: self.sleepCount(sl.hold_while) }),
            K.nav({ label: 'Keep Awake While', href: base + '/awake', sk: 'b:sleep.awake_while', value: self.sleepCount(sl.awake_while) }),
            K.nav({ label: 'Stay Dark While', href: base + '/dark', sk: 'b:sleep.dark_while', value: self.sleepCount(sl.dark_while) })]));
          // BRIGHTNESS: Day and Night, each its level (in %; the display's
          // 0-255 underneath), its start time when by the clock, and its list
          // that forces it -- Day While, then Night While, then the clock
          var bm = sl.brightness || 'leave';
          var bOpts = [['leave', 'Leave It'], ['fixed', 'Day and Night']];
          if (bm === 'sensor') bOpts.push(['sensor', 'From an Entity']);
          var pct = function (v) { return Math.max(1, Math.round((v || 0) / 2.55)); };
          var raw = function (p) { return Math.max(1, Math.min(255, Math.round(p * 2.55))); };
          c.appendChild(K.group({ header: 'Brightness', footer: bm === 'leave'
              ? PN() + ' never changes the screen’s brightness. (The tablet’s own adaptive brightness, if it is on, still does.)'
              : 'The screen’s brightness while awake, and what it wakes to — set on the screen itself, as Fully Kiosk did, and checked again at every sleep and wake. Under ' + PN() + '’s black the backlight stays at its lowest until the wake. Turn the tablet’s own adaptive brightness off, or the two will fight.' }, [
            K.seg({ label: 'Brightness', sk: 'b:sleep.brightness', stack: !wide, value: bm, options: bOpts,
                    onChange: function (v) { put({ brightness: v }); } })].concat(bm === 'fixed' ? [
            K.toggle({ label: 'Day and Night by the Clock', sk: 'b:sleep.bright_clock', on: !!sl.bright_clock,
                       onChange: function (on) { put({ bright_clock: on }); } })] : []).concat(bm === 'sensor' ? [
            this.entityRow({ label: 'Entity', sk: 'b:sleep.bright_sensor', value: sl.bright_sensor, title: 'Brightness From',
                             filter: { domains: ['sensor', 'input_number', 'number'] }, onPick: function (id) { put({ bright_sensor: id || '' }); } })] : [])));
          if (bm === 'fixed') {
            var clock = !!sl.bright_clock;
            c.appendChild(K.group({ header: 'Day', footer: (clock ? 'From ' + (sl.day_from || '07:00') + ', and always' : 'Whenever it is not night (below) — and always') + ' while anything in Day While is on.' }, [
              K.slider({ label: 'Brightness', sk: 'b:sleep.bright_day', min: 1, max: 100, unit: '%', value: pct(sl.bright_day || 174),
                         onChange: function (v) { put({ bright_day: raw(v) }); } })].concat(clock ? [
              K.text({ label: 'Starts At', sk: 'b:sleep.day_from', value: sl.day_from || '07:00', placeholder: '07:00', error: this.err(ctx.err),
                       onCommit: function (v) { put({ day_from: v.trim() }); } })] : []).concat([
              K.nav({ label: 'Day While', href: base + '/day', sk: 'b:sleep.day_while', value: self.sleepCount(sl.day_while) })])));
            c.appendChild(K.group({ header: 'Night', footer: (clock ? 'From ' + (sl.night_from || '22:00') + ', ' : 'Not by the clock: ') + 'whenever anything in Night While is on (Day While still wins).' }, [
              K.slider({ label: 'Brightness', sk: 'b:sleep.bright_night', min: 1, max: 100, unit: '%', value: pct(sl.bright_night || 75),
                         onChange: function (v) { put({ bright_night: raw(v) }); } })].concat(clock ? [
              K.text({ label: 'Starts At', sk: 'b:sleep.night_from', value: sl.night_from || '22:00', placeholder: '22:00',
                       onCommit: function (v) { put({ night_from: v.trim() }); } })] : []).concat([
              K.nav({ label: 'Night While', href: base + '/night', sk: 'b:sleep.night_while', value: self.sleepCount(sl.night_while) })])));
          }
        }
        // (Near the Screen is one of the rules: an automation deciding has none of them)
        if (!hk) {
          c.appendChild(K.group({ header: 'Near the Screen', footer: 'The dashboard when somebody comes near the screen, the screensaver again when they go: this needs Decided By ' +
              PN() + '. An automation of yours decides this tablet now.' }, []));
        }
        var wk = docsLink('Sleep-Screen', '', { sub: 'Sleep Screen', sk: 'b:sleep:wiki' });
        if (wk) c.appendChild(K.group({ footer: 'How Sleep Screen works, and ready-made automations for deciding it yourself.' }, [wk]));
      }
      sleepCount(list) { var n = (list || []).length; return n ? n + (n === 1 ? ' Entity' : ' Entities') : 'None'; }
      // MORE WHEN NEAR (sleep_rules.py rule 9a): the sensors that see the space
      // in front of the tablet; Closer Than for a distance sensor's reading (in
      // cm, sleep_rules.NEAR_CM) and Back to the Screensaver (s, NEAR_LINGER)
      sleepNear(c, sl, base, put) {
        var self = this, near = sl.near || [];
        var distance = near.some(function (id) { return id.split('.')[0] === 'sensor'; });
        var cm = function (v) { return v >= 100 ? (v / 100).toFixed(v % 100 ? 1 : 0) + ' m' : v + ' cm'; };
        var CM = [30, 50, 80, 100, 120, 150, 200, 250, 300], BACK = [10, 20, 30, 60, 120, 180, 300];
        var with_ = function (list, v) { return list.indexOf(v) >= 0 ? list : list.concat(v).sort(function (a, b) { return a - b; }); };
        var rows = [K.nav({ label: 'Near the Screen', href: base + '/near', sk: 'b:sleep.near', value: self.sleepCount(near) })];
        if (near.length && distance) {
          rows.push(K.select({ label: 'Closer Than', sk: 'b:sleep.near_cm', value: sl.near_cm || 120,
                               options: with_(CM, sl.near_cm || 120).map(function (v) { return [v, cm(v)]; }),
                               onChange: function (v) { put({ near_cm: Number(v) }); } }));
        }
        if (near.length) {
          rows.push(K.select({ label: 'Back to the Screensaver', sk: 'b:sleep.near_linger', value: sl.near_linger || 30,
                               options: with_(BACK, sl.near_linger || 30).map(function (v) { return [v, v < 60 ? v + ' s' : (v / 60) + ' min']; }),
                               onChange: function (v) { put({ near_linger: Number(v) }); } }));
        }
        c.appendChild(K.group({ header: 'Near the Screen', footer: near.length
            ? 'Somebody near the screen: the dashboard, before a touch (while lit, never in quiet hours). With nobody near and no touch for Back to the Screensaver, the photos come back — sooner than Starts After.'
            : 'A sensor that sees the space in front of the tablet — an mmWave zone, or a distance sensor — brings the dashboard up as somebody walks up to it. The tablet’s own camera is never used.' }, rows));
      }
      // ONE OF SLEEP SCREEN'S LISTS: as many entities as the house has; Hold
      // While and Wake For say which of theirs also work in quiet hours
      s_sleep_list_t(c, x, tid, which) { return this.s_sleepList(c, x, this.tabs()[tid] || {}, which); }
      s_sleepList(c, x, b, which) {
        var self = this, ctx = this.sleepCtx(x), spec = SLEEP_LISTS[which], sl = b.sleep || {};
        var list = (sl[spec.key] || []).slice(), qok = (sl.quiet_ok || []).slice();
        var put = function (ch) { return ctx.set({ sleep: Object.assign({}, sl, ch) }); };
        var setList = function (v) {
          var ch = {}; ch[spec.key] = v;
          if (spec.quiet) ch.quiet_ok = qok.filter(function (id) { return v.indexOf(id) >= 0 || self.sleepElsewhere(sl, spec.key, id); });
          return put(ch);
        };
        c.appendChild(K.listEditor({ fk: 'sleep-' + which, announce: this.announce.bind(this), emptyText: 'None', shownHeader: spec.title, reorder: false,
          rows: list.map(function (id) { return { value: id, label: self.name(id), sub: id }; }),
          onChange: setList,
          addLabel: 'Add…', onAddOther: function () {
            self.go(self.picker('sleep-add-' + which, { title: 'Add to ' + spec.title, value: null, multi: true,
              items: function () {
                return self.entityIds({ domains: spec.domains, shown: true }).filter(function (id) { return list.indexOf(id) < 0; })
                  .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; });
              },
              onPick: function (id) { if (id) setList(list.concat(id)); } }));
          } }));
        if (spec.quiet && list.length) {
          c.appendChild(K.group({ header: 'Also in Quiet Hours', footer: 'Ticked: works in quiet hours too (smoke, the doorbell). The rest wait until quiet hours end.' },
            list.map(function (id) {
              return K.check({ label: self.name(id), multi: true, on: qok.indexOf(id) >= 0, sk: 'b:sleep.quiet_ok:' + id,
                onClick: function (on) { put({ quiet_ok: on ? qok.concat(id) : qok.filter(function (q) { return q !== id; }) }); } });
            })));
        }
        c.appendChild(K.group({ footer: spec.help }, []));
      }
      // an entity also in the other quiet-capable list keeps its tick
      sleepElsewhere(sl, key, id) {
        var other = key === 'hold_while' ? 'wake_for' : 'hold_while';
        return (sl[other] || []).indexOf(id) >= 0;
      }
      // A SCREEN'S ROOMS: Same as All Screens (Rooms, on the sidebar), or this
      // screen's own -- its room order and Home's rooms, the menu's and the
      // pages'. Turning Same off starts from All Screens' as they are.
      s_rooms(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); }, wide = this.hasAttribute('wide');
        var follows = !b.rooms_custom;
        var MENU = [['az', 'A to Z'], ['order', 'Room Order']], PAGES = [['floor', 'By Floor'], ['order', 'Room Order']];
        var label = function (opts, v) { return (opts.filter(function (o) { return o[0] === v; })[0] || [v, v])[1]; };
        c.appendChild(K.group({ footer: follows ? 'This screen’s rooms follow Rooms (All Screens). Turn this off to set them here, for this screen only.'
            : 'This screen sets its own. Turn this on to follow Rooms (All Screens) again.' }, [
          K.toggle({ label: 'Same as All Screens', sk: 'b:rooms_custom', on: follows, onChange: function (on) {
            if (!on) { set({ rooms_custom: true, room_order: (b.room_order || []).slice(), home_rooms: b.home_rooms,
                             menu_rooms: b.menu_rooms, page_rooms: b.page_rooms }); return; }
            self.confirmSwitch({ title: 'Follow All Screens’ Rooms?', message: 'This screen’s own room order and choices will be replaced.', ok: 'Follow All Screens' },
                function () { set({ rooms_custom: false }); });
          } })]));
        if (follows) {
          this.fromAllScreens(c, [
            K.info({ label: 'Room Order', value: M.roomsSummary(b) }),
            K.info({ label: 'Rooms in Menu', value: label(MENU, b.menu_rooms) })].concat(x.generated ? [
            K.info({ label: 'Rooms on Pages', value: label(PAGES, b.page_rooms) })] : []), 'Rooms', '#/house/rooms');
          return;
        }
        var az = this.areasAZ(), areas = this.client.areas || {};
        var mdl = M.roomsModel(b, az);
        c.appendChild(K.listEditor({ fk: 'rooms', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: Home shows its rooms as the screen lists them' + (x.generated ? ' (floor by floor, then A to Z).' : '.'),
          shownHeader: 'On Home', moreHeader: 'Not on Home',
          moreFooter: 'A room that isn’t on Home keeps its page and its row in the menu. Tap a room for its own settings, the same on every screen.',
          rows: mdl.rows.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: (areas[r.value] || {}).icon || 'mdi:texture-box', href: self.roomHref(r.value) }; }),
          more: mdl.more.map(function (r) { return { value: r.value, label: self.areaName(r.value), icon: (areas[r.value] || {}).icon || 'mdi:texture-box' }; }),
          onAuto: function (on) {
            if (!on) { set({ room_order: az.slice(), home_rooms: 'order' }); return; }
            self.confirmSwitch({ title: 'Use Automatic Rooms?', message: 'This screen’s room order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set(M.roomsAuto()); });
          },
          onChange: function (v) { set(M.roomsSave(v, az)); } }));
        c.appendChild(K.group({ header: 'Menu and Pages', footer: 'Room Order is the order above.' }, [
          K.seg({ label: 'Rooms in Menu', sk: 'b:menu_rooms', value: b.menu_rooms, stack: !wide, options: MENU,
                  onChange: function (v) { set({ menu_rooms: v }); } })].concat(x.generated ? [
          K.seg({ label: 'Rooms on Pages', sub: 'Lights, Climate, Water and the other pages that group by room.', sk: 'b:page_rooms',
                  value: b.page_rooms, stack: !wide, options: PAGES, onChange: function (v) { set({ page_rooms: v }); } })] : [])));
      }
      // THE ENERGY FEATURE IS ADDED: its page (and its page pill) exist
      energyOn() {
        var feats = (this.data && this.data.features) || {};
        return !!(feats.hk_energy && (feats.hk_energy.entries || []).length);
      }
      // THE POWER PAGE IS ON (the Energy plan has one): its page kind exists
      powerOn() {
        var E = this.energyOn() && window.hkSettings && window.hkSettings.get('energy', null);
        return !!(E && E.power);
      }
      // WHAT A SCREEN SHOWS (hk-settings-model.js onlySummary): null for a
      // whole screen; for one with no Home page, its pages in a few words
      onlyOf(b) {
        var d = this.data || {}, custom = {};
        (d.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
        var energyOn = this.energyOn(), powerOn = this.powerOn();
        if (energyOn) delete custom.energy;
        var kinds = (d.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
        return M.onlySummary(b, kinds, custom, energyOn, function (k) { return custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); });
      }
      // HOME PAGE OFF / ON: asked first, and said what changes. The two lists
      // are apart (only_pages / pages), so either way the other is kept.
      setHomePage(path, on) {
        var self = this;
        return this.confirmSwitch(on
          ? { title: 'Make It a Whole Screen?', ok: 'Whole Screen',
              message: 'Its Home page, its rooms and its other pages come back, as they were. The pages it shows now are kept, for if you turn Home Page off again.' }
          : { title: 'Show Only Some Pages?', ok: 'Only Some Pages',
              message: 'This screen will have no Home page and no room pages — only the pages you pick next, opening on the first. ' +
                       'Until you pick one it still shows everything. Nothing is deleted: turn Home Page back on to get the whole screen back.' },
          function () {
            return self.setB(path, { home_page: !!on }).then(function () {
              if (!on) self.go('#/screens/' + encodeURIComponent(path) + '/pages');
              return true;
            });
          });
      }
      dwInSecurity(b) { return !!this.hs('security.alarm') && M.screenShows(b, 'security'); }
      s_pages(c, x, b) {
        var self = this, set = function (ch) { return self.setB(x.path, ch); };
        var custom = {};
        (this.data.custom_pages || []).forEach(function (p) { custom[p.path] = p.title; });
        // THE ENERGY PAGE: with the Energy feature, the generated page has the
        // address `energy` -- a custom page there is not a page of its own
        // (hk-strategy.js shows the generated one); without it, no Energy page
        // to offer
        var energyOn = this.energyOn(), powerOn = this.powerOn();
        var homeCustom = Object.assign({}, custom);
        custom = Object.assign({}, custom);
        if (energyOn) delete custom.energy;
        var kinds = (this.data.page_kinds || []).filter(function (k) { return (k !== 'energy' || energyOn) && (k !== 'power' || powerOn); });
        // DOORS & WINDOWS IS SECURITY'S where the house has an alarm and this
        // screen shows Security (hk-strategy.js withSecurity): no page of its own
        if (this.dwInSecurity(b)) kinds = kinds.filter(function (k) { return k !== 'doors_windows'; });
        var lab = function (k) { return custom[k] !== undefined ? custom[k] : (M.PAGE_LABELS[k] || k); };
        // HOME PAGE: off, the screen is only the pages it lists -- any of them
        var om = b.home_page === false ? M.onlyModel(b, kinds, custom, energyOn) : null;
        var firstOnly = om && om.rows.length ? lab(om.rows[0].value) : null;
        c.appendChild(K.group({ footer: b.home_page === false
            ? (firstOnly ? 'This screen is only these pages, and opens on ' + firstOnly + '.'
                         : 'Add a page below: with none, the screen is a whole screen as usual.')
            : 'Off: the screen is only the pages you pick, and opens on the first — the Energy page alone, say, or Security and Cameras.' }, [
          K.toggle({ label: 'Home Page', sk: 'b:home_page', on: b.home_page !== false,
                     sub: b.home_page === false ? 'Off: only the pages below' : 'On: a whole screen',
                     onChange: function (on) { self.setHomePage(x.path, on); } })]));
        // WHICH HOME: the generated one, or one of the house's custom pages, with
        // the screen's other pages generated as usual (a car's own first page)
        if (b.home_page !== false && Object.keys(homeCustom).length) {
          var hv = b.home_view && homeCustom[b.home_view] !== undefined ? b.home_view : '';
          c.appendChild(K.group({ footer: hv
              ? 'The screen opens on ' + homeCustom[hv] + '; its other pages are generated as usual.'
              : 'A custom page can be this screen’s Home, with its other pages generated as usual — a car’s own first page, say.' }, [
            K.select({ label: 'Home', sk: 'b:home_view', value: hv,
                       options: [['', 'Generated']].concat(Object.keys(homeCustom).map(function (k) { return [k, homeCustom[k]]; })),
                       onChange: function (v) { set({ home_view: v }); } })]));
        }
        if (om) {
          var subOf = function (r) { return r.custom ? 'Custom page' : r.value === 'rooms' ? 'A page for every room' : null; };
          var hrefOf = function (r) {
            return r.custom ? '#/pages/' + encodeURIComponent(r.value) : r.value === 'energy' ? '#/page/energy' : null;
          };
          c.appendChild(K.listEditor({ fk: 'opages', minRows: 0, announce: this.announce.bind(this), shownHeader: 'This Screen Shows Only',
            emptyText: 'No pages yet — add one from More. Until then the screen shows everything.',
            shownFooter: 'In this order; the screen opens on the first. Any page a generated screen can have, and your custom pages.',
            rows: om.rows.map(function (r) {
              return { value: r.value, label: lab(r.value), sub: subOf(r), href: hrefOf(r) };
            }),
            more: om.more.map(function (r) { return { value: r.value, label: lab(r.value), sub: subOf(r) }; }),
            onChange: function (v) { set({ only_pages: v }); } }));
          return;
        }
        var mdl = M.pagesModel(b, kinds, custom);
        var keys = mdl.rows.map(function (r) { return r.value; });
        var menuOn = b.menu !== 'off';
        // WHERE EACH PAGE SITS IN THE MENU: top (right under
        // Home), Categories, or not in the menu -- its row's own pop-up menu
        var items = M.menuItems(keys, custom);
        var placeCtl = function (k) {
          var p = M.menuPathOf(k, custom);
          if (!p || !menuOn) return null;
          var it = items.filter(function (y) { return y.path === p; })[0];
          return K.popup({ label: lab(k) + ' in the menu', options: M.MENU_PLACES, value: M.placeOf(b, it, items),
                           fk: 'place:' + k, onChange: function (v) {
              var ch = M.placeSet(b, items, p, v);
              if (!ch) { self.announce('Categories keeps at least one page: move it to the top, or use the automatic menu.'); self.render(); return; }
              set(ch);
            } });
        };
        c.appendChild(K.listEditor({ fk: 'pages', auto: mdl.auto, minRows: 1, announce: this.announce.bind(this),
          autoFooter: 'Automatic: every page the house has something for, in the usual order.',
          shownFooter: menuOn ? 'Top of Menu: right under Home, above Categories. Not in Menu: still one tap away on its chip. ' +
            'The order here is the menu’s order.' : 'This screen has no menu (Menu is Off).',
          rows: mdl.rows.map(function (r) {
            return { value: r.value, label: lab(r.value),
                     sub: r.custom ? 'Custom page' : null, removable: r.custom,
                     href: r.custom ? '#/pages/' + encodeURIComponent(r.value) : null,
                     control: placeCtl(r.value), value2: menuOn && M.MENU_FIXED[r.value] && !r.fixed ? M.MENU_FIXED[r.value] : null };
          }),
          more: mdl.more.filter(function (r) { return !mdl.auto || r.custom; })
            .map(function (r) { return { value: r.value, label: lab(r.value), sub: r.custom ? 'Custom page' : null }; }),
          onAuto: function (on) {
            if (!on) { set(M.pagesSave(mdl.rows.map(function (r) { return r.value; }), custom)); return; }
            self.confirmSwitch({ title: 'Use Automatic Pages?', message: 'This screen’s page order and choices will be replaced.', ok: 'Use Automatic' },
                function () { set({ pages: [] }); });
          },
          onAdd: mdl.auto ? function (v) { set(M.pagesCustom(b, v, true)); } : null,
          onRemove: function (v) { set(M.pagesCustom(b, v, false)); },
          onChange: function (v) { set(M.pagesSave(v, custom)); } }));
        if (menuOn && ((b.menu_top || []).length || (b.categories || []).length)) {
          c.appendChild(K.group({ footer: 'Automatic: Weather, Cameras and Live TV at the top, every other page under Categories.' }, [
            K.button({ label: 'Reset to Automatic Menu', fk: 'menu:auto', onClick: function () { set({ menu_top: [], categories: [] }); } })]));
        }
        c.appendChild(K.group({ footer: h('span', {}, ['Custom pages are written in ',
          h('a', { href: '#/pages', text: 'Custom Pages' }), '.']) }, []));
      }
      // THE GLASS STYLE, All Screens' or a screen's (2026-10-10): Glass,
      // Frosted or Blur, and -- while Blur is chosen -- how it blurs (Blur
      // Mode), each with what it costs. `cur`: the stored value shown as
      // chosen (null: none -- a screen following All Screens); `fallback`: the
      // blur mode Blur starts from; `pick(v)` saves; `fk` prefixes the keys.
      glassChoices(c, cur, fallback, pick, fk, header) {
        var style = cur ? M.glassStyle(cur) : null;
        c.appendChild(K.group({ header: header || 'Style' }, M.GLASS_STYLES.map(function (g) {
          return K.check({ label: g[1], sub: g[2], on: style === g[0], fk: fk + g[0], onClick: function () {
            // Blur and Bright Glass keep the mode already chosen
            pick(M.styleValue(g[0], cur, fallback));
          } });
        })));
        // (Bright Glass has Blur's three modes, 2026-10-30)
        var modes = M.modesFor(style);
        if (!modes) return;
        c.appendChild(K.group({ header: 'Blur Mode', footer: 'Shared Layer and Each Card blur live; Pre-rendered blurs a picture of the sky once. ' +
            'On a wall tablet, anything but Each Card. Pop-up sheets blur live in Shared Layer and Pre-rendered.' }, modes.map(function (m) {
          return K.check({ label: m[1], sub: m[2], on: cur === m[0], fk: fk + 'mode:' + m[0], onClick: function () { pick(m[0]); } });
        })));
      }
      s_glass(c, x, b) {
        var self = this, look = this.data.settings.look;
        var pick = function (v) {
          self.setB(x.path, v === 'flat' ? { flat: true } : v === 'house' ? { flat: null, glass: 'house' } : { flat: false, glass: v });
        };
        var gl = M.glassOf(b, look), follows = !gl.own;
        c.appendChild(K.group({ footer: 'Same as All Screens follows All Screens → Appearance, so this screen changes with the others.' }, [
          K.check({ label: 'Same as All Screens', sub: 'Now ' + M.glassLabel(gl.house), on: follows, fk: 'glass:house',
                    onClick: function () { pick('house'); } })]));
        // Blur here starts from All Screens' mode when theirs is a blur too
        this.glassChoices(c, follows ? null : gl.value, M.isBlur(look.glass) || M.isBright(look.glass) ? look.glass : 'blur', pick, 'glass:', 'Just This Screen');
      }

      // AN OPTIONS PAGE: OPTION_PAGES' controls over the options mapping, then
      // the way to the rest of it in YAML
      // THE SCREENSAVER'S OPTIONS (HK Frontend's own, hk-saver.js). Every
      // control saves the whole set; the defaults are settings.py's.
      // A SCREEN'S SCREENSAVER OPTIONS: the settings for All Screens (the
      // default -- `screensaver_options` null), or its own.
      // WHAT IS SAVED: only the options Home Assistant's running HK Frontend
      // knows (the keys of All Screens' options, which it fills in). These
      // files are served the moment they change, its Python only after a
      // restart: a new option sent to an older one had every save refused
      // (Fade Back, 2026-10-04).
      saverKnown(k) {
        var h = this.hs('look.saver');
        return !h || typeof h !== 'object' || Object.prototype.hasOwnProperty.call(h, k);
      }
      saverOut(o) {
        var self = this, out = {};
        Object.keys(o).forEach(function (k) { if (self.saverKnown(k)) out[k] = o[k]; });
        return out;
      }
      // one option saved, for a screen of its own or for All Screens
      saverPutB(path) {
        var self = this;
        return function (k, v) {
          var b = (self.data.boards || {})[path] || {}, o = M.saverOptions(b.screensaver_options);
          if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setB(path, { screensaver_options: self.saverOut(o) });
        };
      }
      saverPutH() {
        var self = this;
        return function (k, v) {
          var o = M.saverOptions(self.hs('look.saver'));
          if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setH({ 'look.saver': self.saverOut(o) });
        };
      }
      // CLOCK STYLE (2026-10-13): the fourteen faces, the preview showing the
      // one chosen -- the same style for Show: Clock and a Large clock
      // (2026-10-30: each with a small picture of itself; Liquid, Giant and
      // Scattered Numerals bring their own colour)
      saverStyle(c, cur, put) {
        var self = this, cr = this.clockColorRow(cur, put);
        if (cr) c.appendChild(K.group({ footer: 'Each style keeps its own color.' }, [cr]));
        c.appendChild(K.group({ footer: 'The same style for Show: Clock and a Large clock over the photos or the forecast. Every style shows the date' +
            (M.CLOCK_OWN_GROUND ? ' but Liquid and Scattered Numerals. Liquid, Giant Numerals and Scattered Numerals bring their own color, in place of the background behind the clock.' : '.') },
          M.CLOCK_STYLES.map(function (st) {
            return K.check({ label: st[1], sub: st[2], on: (cur.clock_style || 'classic') === st[0], fk: 'saver:clock_style:' + st[0],
                             thumb: self.saverThumb(64, 44, 'clock:' + st[0], cur),
                             onClick: function () { put('clock_style', st[0]); } });
          })));
        // Today's line of what's playing, under its weather (2026-11-01, the owner: "I don't see a place to turn this off")
        if ((cur.clock_style || 'classic') === 'today') {
          c.appendChild(K.group({ footer: 'Today shows the weather under the time, and the song playing in the house under it, while something plays.' },
            [K.toggle({ label: 'Weather', sk: 'saver:clock_today_weather', on: cur.clock_today_weather !== false,
                       onChange: function (on) { put('clock_today_weather', on); } }),
             K.toggle({ label: 'What’s Playing', sk: 'saver:clock_today_music', on: cur.clock_today_music !== false,
                        onChange: function (on) { put('clock_today_music', on); } })]));
        }
      }
      // THE SCREENSAVER'S FACES, SMALL (2026-10-30; docs/phase11/HOMEVIEW-LOOK.md, Phase I): a picture of a Show or a
      // clock face for Clock Style's rows and Show's strip -- the face itself, drawn once (still) at a 1180 x 820
      // tablet's size and scaled down whole, so it is exactly the face. Its modules load the first time one shows.
      // `what`: photos, forecast, clock (the clock as chosen), clock:<style>, glance, month or day
      saverFaceModules() {
        var self = this;
        if (window.hkSaverClock && window.hkSaverFaces) return Promise.resolve(true);
        if (!this._fxLoad) {
          this._fxLoad = Promise.all([window.hkSaverClock ? null : import('/hk/modules/hk-saverclock.js'),
                                      window.hkSaverFaces ? null : import('/hk/modules/hk-saverfaces.js')])
            .then(function () { return true; }, function () { self._fxLoad = null; return false; });
        }
        return this._fxLoad;
      }
      saverThumb(w, h, what, cur) {
        var self = this, W = 1180, H = 820;
        var box = document.createElement('span'), inner = document.createElement('div');
        box.className = 'sthumb';
        box.setAttribute('aria-hidden', 'true');
        box.style.cssText = 'flex:none;position:relative;display:block;width:' + w + 'px;height:' + h + 'px;border-radius:' + Math.round(h / 7) + 'px;overflow:hidden;' +
          'background:#1c1c1e;box-shadow:inset 0 0 0 .5px rgba(127,127,127,.35);margin-right:12px';
        inner.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;transform-origin:0 0;transform:scale(' + (w / W).toFixed(4) + ',' + (h / H).toFixed(4) + ');pointer-events:none';
        box.appendChild(inner);
        // the two that are pictures of their own: the photos, the forecast
        if (what === 'photos') {
          inner.style.background = 'linear-gradient(#8fb3d6,#e9c09a)';
          inner.innerHTML = '<svg viewBox="0 0 1180 820" width="1180" height="820"><circle cx="880" cy="230" r="80" fill="#fff4d6"/><path d="M0 640L260 360 470 560 700 300 1180 700V820H0z" fill="#58745f"/><path d="M0 820V700L340 560 620 700 900 600 1180 760V820z" fill="#3c5747"/></svg>';
          return box;
        }
        if (what === 'forecast') {
          inner.style.background = 'linear-gradient(#2f74ba,#a7d2ef)';
          inner.innerHTML = '<svg viewBox="0 0 1180 820" width="1180" height="820"><path d="M300 330h300a110 110 0 0 0 10-219 160 160 0 0 0-308 34A100 100 0 0 0 300 330z" fill="#fff" opacity=".92"/>' +
            '<path d="M0 640C260 560 420 600 620 560S980 520 1180 580V820H0z" fill="#4f7a55"/><rect y="700" width="1180" height="120" fill="rgba(6,10,18,.55)"/>' +
            '<g fill="#fff" font-family="-apple-system,system-ui,sans-serif" font-weight="600" font-size="64">' +
            [0, 1, 2, 3, 4].map(function (i) { return '<text x="' + (110 + i * 230) + '" y="785">' + (54 + i) + '°</text>'; }).join('') + '</g></svg>';
          return box;
        }
        // (the clock's Background, 2026-10-31: the live sky alone, and a landscape -- behind the clock as chosen)
        if (what === 'bg:skyonly') inner.style.background = 'linear-gradient(#1f4f8f,#5f9bd0 60%,#b9d9ef)';
        if (what === 'bg:landscapes') { inner.style.background = 'center/cover url("/hk/landscapes/thumbs/01.webp"),#05070e'; }
        if (what === 'bg:photos') return this.saverThumb(w, h, 'photos', cur);
        if (what === 'bg:forecast') return this.saverThumb(w, h, 'forecast', cur);
        // Big Weather: a picture of it, as the forecast's is (the face needs the weather's readings, not loaded here)
        if (what === 'weather') {
          inner.style.background = 'linear-gradient(#2f74ba,#4f93cf 60%,#a7d2ef)';
          inner.innerHTML = '<svg viewBox="0 0 1180 820" width="1180" height="820" font-family="-apple-system,system-ui,sans-serif" fill="#fff">' +
            '<path d="M0 640C260 560 420 600 620 560S980 520 1180 580V820H0z" fill="#4f7a55"/>' +
            '<text x="60" y="80" font-size="34" font-weight="600">Sunny</text><text x="1120" y="94" font-size="44" font-weight="600" text-anchor="end">9:41</text>' +
            '<text x="40" y="520" font-size="400" font-weight="600" letter-spacing="-20" opacity=".92">64°</text>' +
            '<g font-size="40" font-weight="600" text-anchor="middle">' + [210, 470, 730, 990].map(function (x, i) { return '<text x="' + x + '" y="740">' + ['6:37', '10', '60%', '21'][i] + '</text>'; }).join('') + '</g></svg>';
          return box;
        }
        var tries = 0, draw = function () {
          if (!box.isConnected) { if (++tries < 20) requestAnimationFrame(draw); return; }
          var C = window.hkSaverClock, F = window.hkSaverFaces, o = cur || {};
          try {
            if (/^bg:/.test(what)) {
              // the clock as chosen over each Background (the two pictures above: the clock over them, no ground)
              var bgId = what.slice(3), own = bgId === 'skyonly' || bgId === 'landscapes';
              C.mount(inner, { style: o.clock_style || 'classic', still: true, drift: false, h24: !!o.clock_24, bg: own ? 'none' : bgId, speed: 0,
                               ground: !own, scrim: false, color: (o.clock_colors || {})[o.clock_style || 'classic'] || '', client: self.client,
                               wallpaper: { id: o.clock_wallpaper || 'aurora', color: o.clock_wallpaper_color || 'blue' } });
            } else if (/^clock/.test(what)) {
              var style = what.indexOf(':') > 0 ? what.split(':')[1] : (o.clock_style || 'classic');
              C.mount(inner, { style: style, still: true, drift: false, h24: !!o.clock_24, bg: 'gradient', speed: 0,
                               color: (o.clock_colors || {})[style] || '', client: self.client });
            } else {
              F.mount(inner, { kind: what, still: true, h24: !!o.clock_24, look: o.day_look, client: self.client, clocks: C });
            }
          } catch (e) { /* no picture: the frame alone */ }
        };
        this.saverFaceModules().then(function (ok) { if (ok) draw(); });
        return box;
      }
      // THE SCREENSAVER EDITOR (2026-11-01, docs/phase12/SCREENSAVER-EDITOR.md): hk-saver-editor.js, loaded the first time it
      // is opened; one per screen (or All Screens), kept while its page shows. `house`: All Screens' screensaver
      saverEditorPage(key, o) {
        var self = this;
        return {
          title: 'Edit Screensaver', back: o.back,
          body: function (c) {
            var made = function () {
              if (!self._saverEditors) self._saverEditors = {};
              var ed = self._saverEditors[key];
              if (!ed) {
                ed = document.createElement('hk-saver-editor');
                self._saverEditors[key] = ed;
                ed.configure(Object.assign({ panel: self, onCancel: function () { delete self._saverEditors[key]; self.leaveTo(o.back[1]); },
                                             onSaved: function () { delete self._saverEditors[key]; self.leaveTo(o.back[1]); } }, o));
              }
              c.appendChild(ed);
            };
            if (window.customElements.get('hk-saver-editor')) made();
            else import('/hk/panels/hk-saver-editor.js').then(made, function (e) { c.textContent = 'The editor couldn\u2019t load: ' + (e && e.message || e); });
          }
        };
      }
      // THE EDITOR'S ROW, first on a Screensaver page; with a layout saved, what of the page it takes the place of, and the
      // way back (the Show drawn as it was)
      saverEditRow(c, href, cur, put, note) {
        var self = this, lay = !!(cur && cur.layout);
        // (the page below is what can't be laid out: the photos, the slides, Night Mode and the timing)
        c.appendChild(K.group({ footer: (note ? note + ' ' : '') + 'What shows and how it looks \u2014 the background, the time, the widgets and the corners \u2014 is set in the editor' +
            (lay ? '.' : ', starting from how it looks today.') + ' Below: the photos, the slides, Night Mode and the timing.' },
          [K.nav({ label: 'Edit Screensaver', sub: 'The background, the big time and the widgets, on the screen itself', icon: 'mdi:pencil', href: href, sk: 'saver:editor' })]
            .concat(lay && put ? [K.button({ label: 'Remove the Layout\u2026', destructive: true, fk: 'saver:layout-off', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Remove the Layout?', message: 'The screensaver is drawn as its Show was before the editor. Its other settings stay.', ok: 'Remove', destructive: true })
                .then(function (yes) { if (yes) put('layout', null); });
            } })] : [])));
      }
      saverPage(c, x, b, path) {
        var self = this, house = M.saverFollows(b);
        var cur = M.saverOptions(house ? this.hs('look.saver') : b.screensaver_options);
        // THE EDITOR (2026-11-01): the whole screensaver laid out on the screen itself
        this.saverEditRow(c, '#/screens/' + encodeURIComponent(path) + '/screensaver/editor', cur, house ? null : function (k, v) {
          var o = M.saverOptions(cur); o[k] = v; return self.setB(path, { screensaver_options: self.saverOut(o) });
        }, house ? 'Editing gives this screen a screensaver of its own, starting from All Screens\u2019.' : null);
        c.appendChild(K.group({ footer: house
            ? 'This screen uses the screensaver settings for All Screens (All Screens → Screensaver). Off: it gets its own, starting from these.'
            : 'This screen has its own screensaver settings. On: it uses the settings for All Screens again.' }, [
          K.toggle({ label: 'Same as All Screens', sk: 'saver:house', on: house, onChange: function (on) {
            self.setB(path, { screensaver_options: on ? null : self.saverOut(cur) });
          } })].concat(house ? [K.nav({ label: 'Screensaver for All Screens', value: M.saverSummary(cur),
                                        href: '#/house/screensaver', sk: 'saver:house-page' })] : [])));
        // THE HOST'S OWN, for this screen's screensaver (extend): nothing in
        // Home Assistant. Where the Photos group is while the screen has
        // options of its own (2026-10-30), else under Same as All Screens
        var hx = this.host();
        // (with options of its own, only where its show has photos: the Photos
        // show, or the clock over them)
        var usesPhotos = house || cur.show === 'photos' || cur.show === 'both' || (cur.show === 'clock' && cur.clock_bg === 'photos');
        var photoSrc = function (c2) {
          if (!hx || typeof hx.extend !== 'function' || !usesPhotos) return false;
          var n = c2.childElementCount;
          try { hx.extend('saver', c2, { screen: path, title: x.title }, self); } catch (e) { /* the host's own group */ }
          return c2.childElementCount > n;
        };
        if (house) photoSrc(c);
        // (the Side Pane is the screen's own even while its screensaver is All Screens': what this screen shows beside it)
        if (house) c.appendChild(K.group({ header: 'Side Pane', footer: 'This screen’s Side Pane in the screensaver, set on its Side Pane page: it is the screen’s own even while the rest follows All Screens.' },
          [this.paneLink(path, 'saver', 'saver:side_pane')]));
        if (!house) {
          this.saverGroups(c, cur, function (k, v) {
            var o = M.saverOptions(cur); if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
            return self.setB(path, { screensaver_options: self.saverOut(o) });
          }, '#/screens/' + encodeURIComponent(path) + '/screensaver/clock-style', b.idle_room ? this.areaName(b.idle_room) : x.title, photoSrc);
          if (M.saverCustom(cur)) {
            c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:reset', onClick: function () {
              K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?', message: 'Every option on this page goes back to its default.',
                                           ok: 'Use Defaults', destructive: true }).then(function (yes) {
                if (yes) self.setB(path, { screensaver_options: self.saverOut(M.saverOptions(null)) });
              });
            } })]));
          }
        }
        c.appendChild(this.saverEntities(b, path));
        if (x.generated) this.engineGroup(c, b, path);
      }
      // THE OPTIONS THAT LIVE OUTSIDE THE EDITOR, for a screen of its own or for All Screens: `cur` the options in
      // force, `put(key, value)` saves one. EDIT SCREENSAVER IS WHERE IT IS LAID OUT (2026-11-01, the owner: "The editor
      // should be the primary source for modifications. Only things that really need to live outside the editor to
      // function should be on the settings page"): the background, the time and its face, colors and depth, the widgets
      // and the corners, Time Behind, the darkening and the legibility are the editor's (a screen with no layout opens
      // there as it is drawn today). Here: where the photos come from and how they show, the wallpaper chosen, what comes
      // between and how often, Night Mode, the Side Pane and the timing
      saverGroups(c, cur, put, styleHref, room, photoSrc) {
        var self = this;
        var sel = function (label, k, choices, sub) {
          var opts = choices.map(function (n) { return [String(n), MIN(n)]; });
          if (!choices.some(function (n) { return n === cur[k]; })) opts.push([String(cur[k]), MIN(cur[k])]);
          return K.select({ label: label, sub: sub, value: String(cur[k]), options: opts, sk: 'saver:' + k,
                            onChange: function (v) { put(k, Number(v)); } });
        };
        var tog = function (label, k, sub) {
          return K.toggle({ label: label, sub: sub, on: !!cur[k], sk: 'saver:' + k, onChange: function (on) { put(k, on); } });
        };
        // ONE TIMER: Starts After also decides how long a touch keeps the screen
        // In Use (a minute less, never under 15 s -- screensaver.py window_of)
        var win = Math.max(15, cur.starts_after - 60);
        var show = cur.show, fc = show === 'forecast', both = show === 'both', ck = show === 'clock', bg = cur.clock_bg || 'gradient';
        var face = show === 'glance' || show === 'month' || show === 'day';
        // (photos where the background is photos: the Photos show, Photos with the forecast between, the clock over them)
        var photos = show === 'photos' || both || (ck && (bg === 'photos' || bg === 'landscapes'));
        var mf = !!cur.music_first, muKnown = self.saverKnown('music_slide'), mu = muKnown && !!cur.music_slide;
        var enKnown = self.saverKnown('energy_slide'), en = enKnown && !!cur.energy_slide;
        var energyHref = String(styleHref || '').replace(/clock-style$/, 'energy');
        var weatherHref = String(styleHref || '').replace(/clock-style$/, 'weather');
        var every = function (n) { return 'Every ' + n + ' Photos'; };
        // PHOTOS: where they come from (All Screens' folder, a host's album), then how they show (Slideshow)
        var srcDrew = photoSrc ? photoSrc(c) : false;
        if (photos) {
          if (!ck) c.appendChild(K.group({ footer: cur.fallback ? 'When the photos folder has none, or can’t be read, the forecast shows instead.'
              : 'When the photos folder has none, or can’t be read, the screen stays dark.' }, [tog('Forecast When There Are No Photos', 'fallback')]));
          this.saverPhotoGroups(c, cur, put, tog, ck, srcDrew);
        }
        // THE WALLPAPER, where the background is one (the editor's Background: Wallpaper): the dashboard's own picker --
        // the four wallpapers and the six motion themes, one Color; its night version follows the sun, its motion the Speed
        if (ck && bg === 'wallpaper' && self.saverKnown('clock_wallpaper')) {
          self.wallpaperGroup(c, { value: cur.clock_wallpaper || 'aurora', color: cur.clock_wallpaper_color || 'blue', fk: 'swall', sk: 'saver:clock_wallpaper',
            saver: true, moving: (cur.clock_speed != null ? cur.clock_speed : (cur.clock_motion === 'still' ? 0 : 35)) > 0,
            onSet: function (v) { put('clock_wallpaper', v); }, onColor: function (v) { put('clock_wallpaper_color', v); } });
        }
        // NOW AND THEN: the slides among the photos, how often, and their own options; over the forecast or a clock, the
        // screens that come in now and then (saverExtras)
        if (photos && !ck) {
          var muSlide = mu && !mf;
          var wxKnown = self.saverKnown('weather_slide'), wx = wxKnown && !!cur.weather_slide;
          var turns = [muSlide && 'the music', both && 'the forecast', wx && 'the weather', en && 'Home Energy'].filter(Boolean);
          c.appendChild(K.group({ header: 'Now and Then', footer: turns.length
              ? 'After every few photos a slide fades in for as long as a photo shows, then the photos go on.' +
                (turns.length > 1 ? ' ' + M.listText(turns).replace(/^t/, 'T') + ' take turns.' : '') +
                (muSlide ? ' The music only while something plays; its buttons skip or pause without closing the screensaver, and a tap on its album art opens Music.' : '') +
                (en ? ' Home Energy skips its turn until it has the day’s numbers; a tap on it opens Energy.' : '')
              : 'Slides among the photos: the forecast' + (mf ? '' : ', what’s playing') + (wxKnown ? ', the weather' : '') + (enKnown ? ', and Home Energy.' : '.') }, [
            K.toggle({ label: 'Forecast', sub: 'The forecast over the live sky, as one of the photos. Its sky only moves while it is on screen.',
                       on: both, sk: 'saver:slide_forecast', onChange: function (on) { put('show', on ? 'both' : 'photos'); } })
          // (one key for Music Full Screen, phase 13: the editor's and this page's are the same choice -- music_first)
          ].concat(muKnown ? [tog('Music Full Screen', 'music_first', 'While something plays: the album art, the song and what’s up next, with buttons for the previous or next song.')] : [],
                   wxKnown ? this.weatherRows(cur, tog, weatherHref) : [],
                   enKnown ? this.energyRows(cur, tog, energyHref) : [],
                   turns.length ? [K.select({ label: 'A Slide', sk: 'saver:forecast_every', value: String(cur.forecast_every),
                                      options: [3, 5, 10, 20].concat([3, 5, 10, 20].indexOf(cur.forecast_every) < 0 ? [cur.forecast_every] : [])
                                        .map(function (n) { return [String(n), every(n)]; }),
                                      onChange: function (v) { put('forecast_every', Number(v)); } })] : [])));
        } else if ((fc || ck) && enKnown) this.saverExtras(c, cur, put, tog, fc ? 'forecast' : 'clock', mf, energyHref);
        // THE FORECAST WHERE IT COMES IN (2026-11-01, the owner: "there is no way of setting Big layout for forecast with
        // Photos"): between the photos, in their place when there are none, now and then over a clock -- a slide's look,
        // not a layout's (the forecast as the background is laid out in the editor)
        var fcSlide = photos && !ck && (both || cur.fallback);
        if (fcSlide && self.saverKnown('forecast_layout')) {
          var bigFc = cur.forecast_layout === 'big';
          c.appendChild(K.group({ header: 'The Forecast', footer: 'How the forecast looks where it comes in among the photos, or in their place' +
              '. Classic: the live sky and the land, today, the next hours and the coming days along the bottom. Big: Big Weather, the temperature or the time very large, standing on the ground.' },
            [K.previewPick({ label: 'Layout', sk: 'saver:forecast_layout', value: bigFc ? 'big' : 'classic', options: M.FORECAST_LAYOUTS,
               picture: function (v, w, ht) { return self.saverThumb(w, ht, v === 'big' ? 'weather' : 'forecast', cur); },
               onChange: function (v) { put('forecast_layout', v); } })].concat(
              bigFc && self.saverKnown('forecast_big') ? [K.seg({ label: 'Big Number', sk: 'saver:forecast_big', value: cur.forecast_big === 'clock' ? 'clock' : 'temp',
                options: M.FORECAST_BIG, onChange: function (v) { put('forecast_big', v); } })] : [],
              bigFc && cur.forecast_big === 'clock' && self.saverKnown('forecast_planted') ? [K.toggle({ label: 'Planted Numerals',
                sub: 'The time as solid figures standing in the meadow, with shadows from the sky’s sun and grass at their feet.',
                on: cur.forecast_planted !== false, sk: 'saver:forecast_planted', onChange: function (on) { put('forecast_planted', on); } })] : [],
              !bigFc ? [tog('Details on the Forecast', 'band', 'Today, the next hours and the coming days along the bottom. Off: the sky and the landscape alone.')] : [])));
        }
        // NIGHT MODE: the clock dim red on black at night -- a time of day, not a look
        var night = this.clockNightRows(cur, put);
        if (night.length) c.appendChild(K.group({ header: 'Night Mode', footer: 'Wherever the screensaver shows the time large: the Clock, a big time in the editor, Glance and Month.' }, night));
        // THE PANE (the Side Pane's In the Screensaver group since 2026-10-30; its page has it -- this screen's, or All
        // Screens'). ALL SCREENS' NAMES THE SCREENS WITH THEIR OWN (2026-11-01, the owner: "the kitchen keeps showing the
        // Side Pane for the screensaver, even though it's disabled" -- All Screens' was off, the Kitchen's its own)
        var panePath = this.panePath(styleHref), bds = this.data.boards || {};
        var housePane = panePath ? '' : M.paneSaverSummary(this.paneNow(null));
        var ownPane = panePath ? [] : Object.keys(bds).filter(function (pth) {
          return !!(bds[pth].screensaver && bds[pth].side_pane && bds[pth].side_pane.saver) && M.paneSaverSummary(self.paneNow(pth)) !== housePane;
        });
        c.appendChild(K.group({ header: 'Side Pane', footer: 'Sections down one side of the screen — the events, what’s playing, the weather and more — with the ' +
            (ck ? 'clock' : face ? M.showName(show) + ' face' : fc ? 'forecast' : 'photos or the forecast') + ' beside it. Set on the Side Pane page, with the Dashboard’s.' +
            (ownPane.length ? ' ' + (ownPane.length === 1 ? 'This screen has' : 'These screens have') + ' a Side Pane of their own in the screensaver, whatever All Screens’ says:' : '') },
          [this.paneLink(panePath, 'saver', 'saver:side_pane')].concat(ownPane.map(function (pth) {
            return K.nav({ label: (self.dash(pth) || { title: pth }).title, value: M.paneSaverSummary(self.paneNow(pth)),
                           href: '#/screens/' + encodeURIComponent(pth) + '/sidepane', sk: 'saver:side_pane:' + pth });
          }))));
        // BACK TO THE DASHBOARD (hk-saver.js stop): a touch or the switch
        var FADES = [[0, 'Instant'], [500, '0.5 Seconds'], [1000, '1 Second'], [2000, '2 Seconds']];
        var fadeOpts = FADES.concat(FADES.some(function (f) { return f[0] === cur.fade_back; }) ? []
          : [[cur.fade_back, (cur.fade_back / 1000) + ' Seconds']]);
        c.appendChild(K.group({ header: 'Timing', footer: 'Starts After is the one timer. The screen also counts as In Use for ' + MIN(win).toLowerCase() +
            ' after each touch (a minute less than Starts After), so the photos never come up while someone is using it, and an automation reading ' +
            'In Use never disagrees with the screensaver.' }, [
          sel('Starts After', 'starts_after', [60, 120, 180, 300, 600, 900, 1800], 'Untouched for this long.')].concat(
            photos && !ck ? [sel('Each Photo For', 'each_photo', [10, 20, 30, 60, 120, 300])] : [],
            !self.saverKnown('fade_back') ? [] : [K.select({ label: 'Fade Back', sub: 'From the screensaver to the dashboard, after a touch or when the switch turns off.',
                        value: String(cur.fade_back), sk: 'saver:fade_back',
                        options: fadeOpts.map(function (f) { return [String(f[0]), f[1]]; }),
                        onChange: function (v) { put('fade_back', Number(v)); } })])));
      }
      // HOME ENERGY'S ROWS (2026-10-14): its switch, and its options once on
      energyRows(cur, tog, href) {
        var rows = [tog('Home Energy', 'energy_slide', 'Today so far: energy, cost and water against a usual day.')];
        if (cur.energy_slide) rows.push(K.nav({ label: 'Home Energy Options', value: M.energyShown(cur), href: href, sk: 'saver:energy_options' }));
        return rows;
      }
      // WEATHER'S ROWS (2026-10-14): its switch, and its options once on
      weatherRows(cur, tog, href) {
        var rows = [tog('Weather', 'weather_slide', 'Today’s weather at a glance, over the live sky.')];
        if (cur.weather_slide) rows.push(K.nav({ label: 'Weather Options', value: M.weatherShown(cur), href: href, sk: 'saver:weather_options' }));
        return rows;
      }
      // WEATHER'S OPTIONS (2026-10-14; hk-saver-weather.js): the readings, and
      // what is along the bottom. The preview holds the screen.
      saverWeather(c, cur, put) {
        var hide = Array.isArray(cur.weather_hide) ? cur.weather_hide : [];
        var part = function (k, label, sub) {
          return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:weather_hide:' + k,
            onChange: function (on) {
              var next = hide.filter(function (x) { return x !== k; });
              if (!on) next.push(k);
              put('weather_hide', M.WEATHER_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
            } });
        };
        c.appendChild(K.group({ header: 'Readings', footer: 'Temperature always shows: now, with today’s high and low. Each reading has its leader line and a line in words underneath. Rain reads Snow when it snows.' }, [
          part('rain', 'Rain', 'The chance today, and when.'),
          part('wind', 'Wind', 'Its speed, direction and gusts.')]));
        c.appendChild(K.group({ header: 'Along the Bottom', footer: 'From the weather in Weather, as the forecast’s details have them. Behind it all, the live sky as it is outside (Sky Only). A tap on the screen opens the Weather page.' }, [
          part('hours', 'Next Hours'), part('days', 'Coming Days')]));
      }
      // ADDITIONAL SCREENS (2026-10-14): over the forecast or the clock, now
      // and then -- the forecast (on Show: Clock), the music and Home Energy,
      // taking turns on one timer. `mf`: Music First, which covers the music
      saverExtras(c, cur, put, tog, base, mf, href) {
        var rows = [], bgSky = cur.clock_bg === 'forecast' || cur.clock_bg === 'skyonly';
        if (base === 'clock' && !bgSky) rows.push(tog('Forecast', 'extra_forecast', 'Today, the next hours and the coming days, over the live sky.'));
        if (!mf) rows.push(tog('Music', 'extra_music', 'What’s playing, full screen. Only while something plays; otherwise it skips its turn.'));
        // (Weather over the clock; over the forecast it is the weather already)
        var wxOn = base === 'clock' && this.saverKnown('weather_slide');
        if (wxOn) rows = rows.concat(this.weatherRows(cur, tog, String(href).replace(/energy$/, 'weather')));
        rows = rows.concat(this.energyRows(cur, tog, href));
        var on = [base === 'clock' && !bgSky && cur.extra_forecast && 'the forecast', !mf && cur.extra_music && 'the music',
                  wxOn && cur.weather_slide && 'the weather', cur.energy_slide && 'Home Energy'].filter(Boolean);
        var mins = function (n) { return n === 1 ? '1 Minute' : n + ' Minutes'; };
        var secs = function (n) { return n < 60 ? n + ' Seconds' : n === 60 ? '1 Minute' : (n % 60 ? Math.round(n / 6) / 10 : n / 60) + ' Minutes'; };
        if (on.length) {
          var EV = [1, 2, 5, 10, 15, 30], FOR = [15, 30, 60, 120];
          rows.push(K.select({ label: 'Every', sk: 'saver:extra_every', value: String(cur.extra_every),
            options: EV.concat(EV.indexOf(cur.extra_every) < 0 ? [cur.extra_every] : []).map(function (n) { return [String(n), mins(n)]; }),
            onChange: function (v) { put('extra_every', Number(v)); } }));
          rows.push(K.select({ label: 'Show For', sk: 'saver:extra_for', value: String(cur.extra_for),
            options: FOR.concat(FOR.indexOf(cur.extra_for) < 0 ? [cur.extra_for] : []).map(function (n) { return [String(n), secs(n)]; }),
            onChange: function (v) { put('extra_for', Number(v)); } }));
        }
        c.appendChild(K.group({ header: 'Now and Then', footer: on.length
            ? 'Every ' + mins(cur.extra_every).toLowerCase() + ', ' + (on.length > 1 ? 'one of these' : on[0]) + ' fades in over the ' + base +
              ' for ' + secs(cur.extra_for).toLowerCase() + ', then the ' + base + ' comes back.' +
              (on.length > 1 ? ' ' + M.listText(on).replace(/^t/, 'T') + ' take turns, so each comes around every ' + mins(cur.extra_every * on.length).toLowerCase() + '.' : '') +
              ' They wait while music plays first' + (base === 'clock' ? ' and during Night Mode.' : '.') +
              (mf ? ' Music First covers the music, so it isn’t listed here.' : '')
            : 'Other screens, now and then, over the ' + base + '.' + (mf ? ' Music First covers the music.' : '') }, rows));
      }
      // HOME ENERGY'S OPTIONS (2026-10-14; hk-saver-energy.js): which rings,
      // what is along the bottom, the month. The preview holds the screen.
      saverEnergy(c, cur, put) {
        var self = this, hide = Array.isArray(cur.energy_hide) ? cur.energy_hide : [];
        var src = this.energySources();
        var part = function (k, label, sub) {
          return K.toggle({ label: label, sub: sub, on: hide.indexOf(k) < 0, sk: 'saver:energy_hide:' + k,
            onChange: function (on) {
              var next = hide.filter(function (x) { return x !== k; });
              if (!on) next.push(k);
              put('energy_hide', M.ENERGY_PARTS.filter(function (x) { return next.indexOf(x) >= 0; }));
            } });
        };
        var rings = [part('cost', 'Cost', null), part('water', 'Water', null)];
        if (src && src.solar) rings.push(part('solar', 'Solar', null));
        if (src && src.gas) rings.push(part('gas', 'Gas', null));
        c.appendChild(K.group({ header: 'Rings', footer: 'Energy always shows. Each ring is today so far against a usual whole day; the white dot is where a usual day is by this time. A ring shows only where Home Assistant’s Energy settings have it.' }, rings));
        c.appendChild(K.group({ header: 'Right Now', footer: 'Along the bottom, left. Each shows only where there is one: House Battery needs a house battery on the Energy page.' }, [
          part('power', 'Power Now', 'What the house draws right now.'),
          part('battery', 'House Battery', 'Its charge.'),
          part('yday', 'Yesterday by Now', 'Yesterday’s use up to this time.')]));
        var mo = hide.indexOf('month') < 0, cost = hide.indexOf('cost') < 0;
        var also = ' The numbers are the Energy page’s Today and This Month, up to the last five minutes. A tap on Home Energy opens the Energy page.';
        c.appendChild(K.group({ header: 'This Month', footer: (!mo ? 'Off: today only.'
            : 'Along the bottom, right: the month since the 1st, for each ring that shows.' + (cost && hide.indexOf('pace') < 0
              ? ' Heading for is the Energy page’s own estimate: what the month has cost so far, plus a usual day for each day left. It firms up as the month goes on.' : '')) + also },
          [part('month', 'Month So Far', 'Energy, cost and water since the 1st.')].concat(mo && cost ? [part('pace', 'Where the Cost Is Heading', 'The month’s cost so far, plus a usual day’s for each day left.')] : [])));
      }
      // WHICH SOURCES THE HOUSE HAS (Home Assistant's Energy settings), for
      // Home Energy's rings: asked once, the page drawn again when they land
      energySources() {
        var self = this;
        if (this._enSrc !== undefined) return this._enSrc;
        this._enSrc = null;
        var client = this.client;
        if (client && client.callWS) {
          client.callWS({ type: 'energy/get_prefs' }).then(function (pr) {
            var t = {};
            ((pr && pr.energy_sources) || []).forEach(function (x) { t[x.type] = true; });
            self._enSrc = t;
            self.render();
          }).catch(function () { /* the rings it always has */ });
        }
        return null;
      }
      // THE CLOCK'S COLOR (2026-10-13): the chosen style's own colors; each
      // face keeps its own (clock_colors), so trying another style loses none
      clockColorRow(cur, put) {
        var style = cur.clock_style || 'classic', set = M.CLOCK_COLORS[style] || [];
        if (!set.length || !this.saverKnown('clock_colors')) return null;
        var mine = (cur.clock_colors || {})[style], val = set.some(function (c) { return c[0] === mine; }) ? mine : set[0][0];
        return K.select({ label: 'Color', sub: 'This style’s own colors', sk: 'saver:clock_color', value: val,
          options: set.map(function (c, i) { return [c[0], c[1] + (i ? '' : ' (Default)'), c[1]]; }),
          onChange: function (v) { var o = Object.assign({}, cur.clock_colors || {}); o[style] = v; put('clock_colors', o); } });
      }
      // SHOW: CLOCK's groups (2026-10-13): the clock, what's behind it, and
      // what's over it -- each corner its own switch, so it can be the clock
      // alone
      // NIGHT MODE's rows: Off / At Night / Always, and the night's hours
      clockNightRows(cur, put) {
        if (!this.saverKnown('clock_night')) return [];
        var self = this, mode = cur.clock_night || 'off', rows = [
          K.seg({ label: 'Night Mode', sub: 'A dim red clock on black, as StandBy has it', sk: 'saver:clock_night', value: mode, stack: !this.hasAttribute('wide'),
                  options: [['off', 'Off'], ['night', 'At Night'], ['always', 'Always']], onChange: function (v) { put('clock_night', v); } })];
        if (mode === 'night') {
          var hhmm = function (label, k, dflt) {
            return K.text({ label: label, sk: 'saver:' + k, value: cur[k] || dflt, placeholder: dflt, maxlength: 5, error: self.err('look.saver'),
                            onCommit: function (v) { v = v.trim(); if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) put(k, v); else self.render(); } });
          };
          rows.push(hhmm('From', 'clock_night_from', '22:00'), hhmm('Until', 'clock_night_to', '07:00'));
        }
        return rows;
      }
      // THE PHOTOS' OWN SETTINGS (Layout, the mosaic, Order, Slow Zoom, then
      // Portrait and Landscape): the Photo Screensaver's -- and, the same rows,
      // the clock's when Photos is behind it (2026-10-13, the user: mimic them)
      saverPhotoGroups(c, cur, put, tog, clockMode, afterSrc) {
        var self = this, wideP = this.hasAttribute('wide');
        // THE MOSAIC (2026-10-13): 2-5 photos at once, in a layout picked at
        // random; portraits in the tall cells
        var moKnown = self.saverKnown('photo_layout'), mo = moKnown && cur.photo_layout === 'mosaic';
        var prow = [];
        if (moKnown) prow.push(K.seg({ label: 'Layout', sk: 'saver:photo_layout', value: mo ? 'mosaic' : 'single', stack: !wideP,
          options: [['single', 'One at a Time'], ['mosaic', 'Mosaic']], onChange: function (v) { put('photo_layout', v); } }));
        var upTo = mo && self.saverKnown('mosaic_random') && !!cur.mosaic_random;
        if (mo) {
          prow.push(K.seg({ label: upTo ? 'Up to' : 'Photos per Mosaic', sk: 'saver:mosaic_count', value: String(cur.mosaic_count || 3),
            options: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], onChange: function (v) { put('mosaic_count', Number(v)); } }));
          if (self.saverKnown('mosaic_random')) {
            prow.push(K.toggle({ label: 'Up To', sub: 'A different number of photos now and then — from one, full screen, up to this many.',
                                 on: upTo, sk: 'saver:mosaic_random', onChange: function (on) { put('mosaic_random', on); } }));
            if (upTo) {
              var EV = [1, 5, 10, 15, 30, 60], ev = cur.mosaic_every || 10;
              prow.push(K.select({ label: 'A New Number Every', sk: 'saver:mosaic_every', value: String(ev),
                options: EV.concat(EV.indexOf(ev) < 0 ? [ev] : []).map(function (m) { return [String(m), m === 1 ? '1 Minute' : m + ' Minutes']; }),
                onChange: function (v) { put('mosaic_every', Number(v)); } }));
            }
          }
          prow.push(K.seg({ label: 'Spacing', sk: 'saver:mosaic_gap', value: cur.mosaic_gap || 'thin', stack: !wideP,
            options: [['none', 'None'], ['thin', 'Thin'], ['rounded', 'Rounded']], onChange: function (v) { put('mosaic_gap', v); } }));
          if ((cur.mosaic_gap || 'thin') !== 'none' && self.saverKnown('mosaic_line')) {
            var lw = cur.mosaic_line > 0 ? cur.mosaic_line : (cur.mosaic_gap === 'rounded' ? 12 : 3);
            prow.push(K.slider({ label: 'Line Thickness', sk: 'saver:mosaic_line', value: lw, min: 1, max: 24, unit: ' px',
                                 onChange: function (v) { put('mosaic_line', v); } }));
            prow.push(K.select({ label: 'Line Color', sk: 'saver:mosaic_color', value: cur.mosaic_color || 'black',
              options: [['black', 'Black'], ['white', 'White'], ['gray', 'Gray'], ['charcoal', 'Charcoal'], ['cream', 'Cream'], ['navy', 'Navy']],
              onChange: function (v) { put('mosaic_color', v); } }));
          }
          prow.push(K.seg({ label: 'Changes', sk: 'saver:mosaic_change', value: cur.mosaic_change === 'all' ? 'all' : 'one', stack: !wideP,
            options: [['one', 'One Photo at a Time'], ['all', 'All at Once']], onChange: function (v) { put('mosaic_change', v); } }));
        }
        prow.push(K.seg({ label: 'Order', value: cur.order, sk: 'saver:order', options: [['random', 'Random'], ['sorted', 'In Order']],
                          onChange: function (v) { put('order', v); } }));
        if (clockMode) {
          var EP = [10, 20, 30, 60, 120, 300], ep = cur.each_photo;
          prow.push(K.select({ label: 'Each Photo For', sk: 'saver:each_photo', value: String(ep),
            options: EP.concat(EP.indexOf(ep) < 0 ? [ep] : []).map(function (n) { return [String(n), MIN(n)]; }),
            onChange: function (v) { put('each_photo', Number(v)); } }));
        }
        prow.push(tog('Slow Zoom', 'zoom', 'A slow zoom across each photo. The tablet keeps drawing the whole time, so it runs warmer.'));
        // (Titles and Time Behind -- its size, height and darkening -- are the editor's since 2026-11-01: the Photo Title
        // widget, the big time Behind the Subject)
        // (under the photos' source groups -- a folder, a host's album and its
        // import -- this one is how they show: Slideshow, never a second Photos)
        c.appendChild(K.group({ header: afterSrc ? 'Slideshow' : 'Photos', footer: (mo
            ? (upTo ? 'Up To: a new number of photos every ' + (cur.mosaic_every || 10) + ' minutes, one of them full screen now and then. ' : '') +
              'A new layout each time, picked at random — portraits in the tall cells, landscapes in the wide ones. One Photo at a Time changes one cell every ' +
              MIN(cur.each_photo).toLowerCase() + ', and after a while the whole mosaic. '
            : '') + (clockMode ? 'The same settings as the Photos show’s, for the photos behind the clock.'
            : 'Tap the left or right edge of the screensaver for the previous or next ' + (mo ? 'mosaic' : 'photo') + ', or the forecast details for the Weather page; anywhere else closes it.') }, prow));
        this.saverShape(c, cur, put, 'portrait', mo);
        this.saverShape(c, cur, put, 'landscape', mo);
      }
      // PORTRAIT OR LANDSCAPE PHOTOS (2026-10-13), each their own: Whole (over
      // a blurred copy: its Blur and Dim) or Fill the Screen, a Zoom, and the
      // Focus -- which part stays when it's cropped, or where a whole one sits.
      // A change here turns the preview to a photo of that shape.
      saverShape(c, cur, put, side, mosaic) {
        var self = this, P = side === 'portrait';
        if (!this.saverKnown(side + '_zoom')) return;    // Home Assistant not restarted yet
        var k = function (x) { return side + '_' + x; };
        var fillKey = P ? 'portrait_fill' : 'fill', fill = P ? !!cur.portrait_fill : cur.fill !== false;
        var set = function (key, v) {
          if (self._saverShape !== side) { self._saverShape = side; self.saverPreview(true); }
          put(key, v);
        };
        // (in a mosaic every photo fills its cell: Show As and the copy behind
        // a whole one don't apply -- the Zoom and Focus do, in each cell)
        if (mosaic) fill = true;
        var rows = mosaic ? [] : [K.seg({ label: 'Show As', sk: 'saver:' + fillKey, value: fill ? 'fill' : 'whole', options: [['whole', 'Whole'], ['fill', 'Fill the Screen']],
                            onChange: function (v) { set(fillKey, v === 'fill'); } })];
        if (!fill) {
          rows.push(K.slider({ label: 'Background Blur', sub: 'The blurred copy around it', sk: 'saver:' + k('blur'), value: cur[k('blur')], min: 0, max: 100, step: 5, unit: '%',
                               onChange: function (v) { set(k('blur'), v); } }));
          rows.push(K.slider({ label: 'Background Dim', sk: 'saver:' + k('dim'), value: cur[k('dim')], min: 0, max: 80, step: 5, unit: '%',
                               onChange: function (v) { set(k('dim'), v); } }));
        }
        rows.push(K.slider({ label: 'Zoom', sk: 'saver:' + k('zoom'), value: cur[k('zoom')], min: 100, max: 200, step: 5, unit: '%',
                             onChange: function (v) { set(k('zoom'), v); } }));
        var cropped = fill || cur[k('zoom')] > 100;
        rows.push(K.seg({ label: cropped ? 'Vertical Focus' : 'Vertical Position', sk: 'saver:' + k('y'), value: cur[k('y')] || 'center',
                          options: [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']], onChange: function (v) { set(k('y'), v); } }));
        rows.push(K.seg({ label: cropped ? 'Horizontal Focus' : 'Horizontal Position', sk: 'saver:' + k('x'), value: cur[k('x')] || 'center',
                          options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], onChange: function (v) { set(k('x'), v); } }));
        var def = P ? { portrait_fill: false } : { fill: true };
        def[k('blur')] = 50; def[k('dim')] = 20; def[k('zoom')] = 100; def[k('x')] = 'center'; def[k('y')] = 'center';
        var custom = Object.keys(def).some(function (x) { return cur[x] !== def[x]; });
        if (custom) rows.push(K.button({ label: 'Reset to Default', sk: 'saver:' + side + ':default', onClick: function () { set(def); } }));
        c.appendChild(K.group({ header: P ? 'Portrait Photos' : 'Landscape Photos', footer: mosaic
            ? 'In the mosaic each photo fills its cell; Focus is the part that stays' + (P ? ' — Top keeps faces in most portraits' : '') + ', and Zoom closes in on it.'
            : (fill
            ? 'Fill the Screen crops it to the screen’s shape; Focus is the part that stays' + (P ? ' — Top keeps faces in most portraits.' : '.')
            : 'Whole: all of it, over a blurred copy of itself; Position is where it sits when there’s room around it.') +
          ' Zoom closes in on the ' + (cropped ? 'focus' : 'position') + '. Choose ' + (P ? 'Portrait' : 'Landscape') + ' above the preview to see one.' }, rows));
      }
      // ALL SCREENS' SCREENSAVER (All Screens → Screensaver): every screen whose
      // Same as All Screens is on uses these. The preview shows the first such
      // screen's screensaver.
      h_saver(c) {
        var self = this, cur = M.saverOptions(this.hs('look.saver')), boards = this.data.boards || {};
        var savers = Object.keys(boards).filter(function (p) { return boards[p].screensaver; });
        var follow = savers.filter(function (p) { return M.saverFollows(boards[p]); });
        // THE EDITOR (2026-11-01), for every screen that uses these
        if (savers.length) this.saverEditRow(c, '#/house/screensaver/editor', cur, this.saverPutH(), null);
        // THE PHOTOS (2026-10-09: on Wall Tablets before): where they come from,
        // in the Photos group's place (2026-10-30: first on the page before) --
        // drawn on every show, as screens with their own may show photos
        var hx = this.host();
        var photoSrc = function (c2) {
          c2.appendChild(K.group({ header: 'Photos', footer: 'A media folder (media-source://…) of the photos every screen’s screensaver shows.' }, [
            K.text({ label: 'Screensaver Photos', sk: 'look.photos', value: self.hs('look.photos'), placeholder: 'media-source://…', error: self.err('look.photos'),
                     onCommit: function (v) { self.setH({ 'look.photos': v }); } })]));
          // THE HOST'S OWN beside the photos (extend): nothing in Home Assistant
          if (hx && typeof hx.extend === 'function') {
            try { hx.extend('house-saver', c2, { photos: self.hs('look.photos'), set: function (v) { return self.setH({ 'look.photos': v }); } }, self); } catch (e) { /* the host's own group */ }
          }
          return true;
        };
        this.saverGroups(c, cur, function (k, v) {
          var o = M.saverOptions(cur); if (k && typeof k === 'object') Object.assign(o, k); else o[k] = v;
          return self.setH({ 'look.saver': self.saverOut(o) });
        }, '#/house/screensaver/clock-style', null, photoSrc);
        var name = function (p) { return (self.dash(p) || { title: p }).title; };
        c.appendChild(K.group({ header: 'Screens', footer: savers.length
            ? 'A screen with its own settings keeps them; turn on Same as All Screens on its Screensaver Options to use these.'
            : 'No screen has its Screensaver on yet (on the screen’s page).' },
          savers.map(function (p) {
            var own = follow.indexOf(p) < 0;
            return K.nav({ label: name(p), value: own ? 'Just This Screen' : 'Same as All Screens',
                           href: '#/screens/' + encodeURIComponent(p) + '/screensaver', sk: 'saver:screen:' + p });
          })));
        if (M.saverCustom(cur)) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Defaults…', destructive: true, fk: 'saver:house-reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the default screensaver options?', message: 'The settings for All Screens go back to their defaults.',
                                         ok: 'Use Defaults', destructive: true }).then(function (yes) {
              if (yes) self.setH({ 'look.saver': self.saverOut(M.saverOptions(null)) });
            });
          } })]));
        }
      }
      // FOR AUTOMATIONS: the screen's own switch and in-use sensor, which HK
      // Frontend makes for it (screensaver.py) -- nothing to create by hand
      saverEntities(b, path) {
        var self = this, mine = (b.tablets || []).filter(function (tid) { return self.tabs()[tid]; });
        if (!mine.length) {
          return K.group({ header: 'For Automations', footer: 'Add the wall tablet that shows this screen (Wall Tablets) and ' + haName('HK Frontend') + ' adds its screensaver switch and In Use sensor.' }, []);
        }
        var row = function (label, id, sub) {
          if (!id) return K.info({ label: label, sub: sub, value: 'Being added…' });
          var a = K.nav({ label: label, sub: id, href: '#', sk: 'saver:ent:' + id, value: self.stateLabel(id) });
          a.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            window.hkShell.moreInfo(id, self);
          });
          return a;
        };
        var rows = [];
        mine.forEach(function (tid) {
          var e = (self.data.screensavers || {})[tid] || {}, nm = mine.length > 1 ? self.tabs()[tid].name + ': ' : '';
          rows.push(row(nm + 'Photo Screensaver', e['switch'], 'On while the photos show'));
          rows.push(row(nm + 'In Use', e.in_use, 'Touched within its window'));
        });
        var room = b.idle_room, leg = room && this.client && this.client.states['input_boolean.wallpanel_screensaver_' + room];
        return K.group({ header: 'For Automations', footer: 'Each wall tablet’s own. Photo Screensaver is on while the photos show: turn it on to start them now ' +
            '(bedtime, say), off to close them (the doorbell). In Use is on while the tablet was touched within its window.' +
            (leg ? ' The older input_boolean.wallpanel_screensaver_' + room + ' follows it both ways until you delete it.' : '') }, rows);
      }
      stateLabel(id) {
        var st = this.client && this.client.states[id];
        return st ? (st.state === 'on' ? 'On' : st.state === 'off' ? 'Off' : st.state) : '';
      }
      // HEADER & SIDEBAR: what HK Frontend hides (hk-kiosk.js) -- and, on a
      // generated screen where the Kiosk Mode plugin is installed (or already
      // chosen), the plugin instead, with its own options page.
      kioskPage(c, x, b, path) {
        var self = this, base = '#/screens/' + encodeURIComponent(path);
        var set = function (o) { return self.setB(path, o); };
        var plugin = x.generated && b.kiosk_engine === 'kiosk_mode';
        // ON OR OFF first; what is hidden, and how, only while on
        c.appendChild(K.group({ footer: b.kiosk ? null : 'When this screen is shown in Home Assistant, Home Assistant’s own header and sidebar show around it.' }, [
          K.toggle({ label: 'Hide Header & Sidebar', sk: 'b:kiosk', on: b.kiosk, onChange: function (on) { set({ kiosk: on }); } })]));
        if (!b.kiosk) return;
        if (!plugin) {
          c.appendChild(K.group({ footer: 'Whatever is hidden, the menu’s Home Assistant section still reaches Home Assistant ' +
              '(Show Menu opens its sidebar). To see them on one visit, add ?\u2060hk_kiosk=off to the screen’s address.' +
              (x.generated ? '' : ' This dashboard’s own YAML can say it instead (hk_kiosk), and then that is used; ' +
               'if it has a kiosk_mode block, the Kiosk Mode plugin does it and these do nothing.') }, [
            K.toggle({ label: 'Hide Header', sub: 'The bar along the top with the dashboard’s name, its views and its menu.',
                       sk: 'b:kiosk_header', on: b.kiosk_header !== false, onChange: function (on) { set({ kiosk_header: on }); } }),
            K.toggle({ label: 'Hide Sidebar', sk: 'b:kiosk_sidebar', on: b.kiosk_sidebar !== false,
                       onChange: function (on) { set({ kiosk_sidebar: on }); } }),
            K.toggle({ label: 'For Admins Too', sub: 'Off: someone signed in as an admin still sees them.',
                       sk: 'b:kiosk_admins', on: b.kiosk_admins !== false, onChange: function (on) { set({ kiosk_admins: on }); } })]));
        }
        if (!x.generated) return;
        var tp = (this.data.thirdparty || {}).kiosk || {};
        if (!plugin && (!tp.state || tp.state === 'missing')) return;
        var rows = [K.toggle({ label: 'Use the Kiosk Mode Plugin Instead', sk: 'b:kiosk_engine', on: plugin, onChange: function (on) {
          set({ kiosk_engine: on ? 'kiosk_mode' : 'hk' });
        } })];
        if (plugin) rows.push(K.nav({ label: 'Kiosk Mode Options', href: base + '/kiosk-mode', sk: 'b:kiosk_options',
                                      value: Object.keys(b.kiosk_options || {}).length ? 'Custom' : 'Default' }));
        c.appendChild(K.group({ header: 'Kiosk Mode Plugin', footer: plugin
          ? 'The Kiosk Mode plugin (HACS) hides them on this screen, with its own options. Off: ' + PN() + ' does it.' +
            (tp.state !== 'ready' && tp.note ? ' ' + tp.note : '')
          : PN() + ' hides them itself. The Kiosk Mode plugin (HACS) can do it instead, for its own options.' }, rows));
      }
      // WALLPANEL INSTEAD: only where WallPanel (HACS) is installed, for a screen
      // that prefers it; its own options page then takes over.
      engineGroup(c, b, path) {
        var self = this, tp = (this.data.thirdparty || {}).wallpanel || {};
        var wp = b.screensaver_engine === 'wallpanel';
        if (!wp && (!tp.state || tp.state === 'missing')) return;
        c.appendChild(K.group({ header: 'WallPanel', footer: wp
          ? 'WallPanel (HACS) draws this screen’s screensaver, with the options below. Off: ' + PN() + '’s own.'
          : 'Draw this screen’s screensaver with WallPanel (HACS) instead of ' + PN() + '’s own.' }, [
          K.toggle({ label: 'Use WallPanel Instead', on: wp, sk: 'b:screensaver_engine', onChange: function (on) {
            self.setB(path, { screensaver_engine: on ? 'wallpanel' : 'hk' }).then(function () {
              self.go('#/screens/' + encodeURIComponent(path) + (on ? '/wallpanel' : '/screensaver'));
            });
          } })]));
      }
      optionsPage(c, spec, cur, save, yamlHref, tp) {
        var self = this;
        if (tp && tp.state && tp.state !== 'ready') c.appendChild(K.group({ footer: tp.note }, []));
        spec.groups.forEach(function (g, gi) {
          var rows = g.rows.map(function (r, ri) {
            var fk = 'opt:' + (r.key || r.fk || gi + '-' + ri), v = optGet(r, cur);
            var put = function (nv) { save(optSet(r, cur, nv)); };
            if (r.type === 'switch') return K.toggle({ label: r.label, sub: r.sub, on: !!v, sk: fk, onChange: put });
            if (r.type === 'seg') return K.seg({ label: r.label, sub: r.sub, value: v, options: r.options, sk: fk, onChange: put });
            var opts = r.options.map(function (op) { return [String(op[0]), op[1]]; });
            if (v !== '' && !opts.some(function (op) { return op[0] === String(v); })) opts.push([String(v), String(v)]);
            return K.select({ label: r.label, sub: r.sub, value: String(v), options: opts, sk: fk, onChange: put });
          });
          c.appendChild(K.group({ header: g.header, footer: gi === spec.groups.length - 1 ? spec.footer : null }, rows));
        });
        var n = Object.keys(cur || {}).length;
        c.appendChild(K.group({ header: 'More', footer: 'Any other option the card has, written in YAML.' }, [
          K.nav({ label: 'Options in YAML', value: n ? n + ' Set' : 'None', href: yamlHref, sk: 'opt:yaml' })]));
        if (n) {
          c.appendChild(K.group({}, [K.button({ label: 'Reset to Tuned Setup…', destructive: true, fk: 'opt:reset', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the tuned setup?', message: 'Every option changed here and in YAML goes back.',
                                         ok: 'Use Tuned Setup', destructive: true }).then(function (yes) { if (yes) save({}); });
          } })]));
        }
      }
      // A YAML PAGE: the options as written, Save / Revert / Use Default
      yamlPage(c, o) {
        var self = this, cur = o.value || {}, valid = true;
        if (o.example) {
          var ex = K.group({ header: 'For Example', footer: o.docs ? h('span', {}, ['Every option: ',
            h('a', { href: o.docs, target: '_blank', rel: 'noopener', text: 'the card’s documentation' }), '.']) : null }, []);
          ex.querySelector('.cells').appendChild(h('pre', { class: 'ex', text: o.example }));
          c.appendChild(ex);
          var dl = ex.querySelector('.gf a'); if (dl) dl.setAttribute('href', o.docs);
        }
        var box = h('div', { class: 'yaml' });
        // what to write goes under the editor, with the group's other notes
        // (not in the page-subtitle style: after other groups that sat at the
        // page's margin, out of line with every footer)
        var grp = K.group({ footer: [o.help, o.note].filter(Boolean).join(' ') || null }, []);
        grp.querySelector('.cells').replaceWith(box);
        c.appendChild(grp);
        var err = this.err(o.sk);
        if (err) c.appendChild(h('div', { class: 'errline', role: 'alert', text: err }));
        var saveBtn = K.button({ label: o.saveLabel || 'Save', fk: o.sk + ':save', onClick: function () {
          if (!valid) { self.announce('The YAML has a mistake.'); return; }
          o.onSave(cur && typeof cur === 'object' ? cur : {});
        } });
        var rows = [saveBtn];
        if (o.clear !== false && Object.keys(o.value || {}).length) {
          rows.push(K.button({ label: 'Reset to Default Options…', destructive: true, fk: o.sk + ':clear', onClick: function () {
            K.confirm(self.shadowRoot, { title: 'Use the default options?', message: 'What’s written here will be removed.',
                                         ok: 'Use Default', destructive: true }).then(function (yes) { if (yes) o.onSave({}); });
          } }));
        }
        c.appendChild(K.group({}, rows));
        // THE KIT'S YAML EDITOR (Phase 2 P2.4; Home Assistant's before): the
        // value written out, read back at every change -- empty is {}, a
        // mistake leaves Save saying so
        box.appendChild(K.yaml({ value: cur, label: o.label || 'YAML', fk: o.sk + ':yaml', sk: o.sk + ':yaml',
          onChange: function (v, ok) {
            valid = ok; cur = v;
            if (valid && o.onDraft) o.onDraft(cur);
          } }));
      }
    };
    KIT.install(Methods);
  };
})();
