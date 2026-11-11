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
        c.appendChild(
          K.group(
          { header: 'Chips',
          footer:
          'Each chip on every screen: Always, or only When Active — while something is on, open, running or wet. Smoke & CO needs nothing here: it leads every screen’s row, in red, when an alarm ' +
          'goes off.' },
          kinds.map(function (k) {
            return K.nav({ label: M.CHIP_LABELS[k] || k, value: self.chipSays(self.chipScreens(k)), href: '#/house/chips/' + k, sk: 'chips:kind:' + k });
          })));
        var lib = d.custom_chips || [];
        if (lib.length) c.appendChild(
          K.group(
          { header: 'Custom Chips',
          footer:
          'Your own chips, set the same way. Always takes a conditional chip out of its condition;' +
          ' When Active shows one only while its entity is on, open or running — or as its own active: rules say.' },
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
        return K.group(
          { header: 'What the Chips Count',
          footer:
          'To count something more in a chip — an outlet with a lamp, a group helper — or hide something from it, open its type in Accessories: Add… and Hidden are there. The same on every screen. ' +
          'Your own chips are in Custom Chips.' }, [
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
        if (!counts.length && !ckey) c.appendChild(K.group({ header: 'What It Counts',
          footer: 'This chip reads one setting rather than a type of accessory: set it on any screen’s page for this chip.' }, []));
        if (counts.length) c.appendChild(K.group({ header: 'What It Counts', footer:
          'Tap a type to change what this chip counts: Add… counts something more (an outlet with a lamp, a group helper); open an accessory to hide it from the chip. The same on every screen.' },
          counts.map(function (k) {
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
                     sub: r.custom ? 'Custom chip' + (self.customShow(b, r.key) === 'active' ? ' · Only When Active' : '') : r.value === 'intercom' ? 'Opens the Intercom' : r.own ? 'Accessory chip' :
                       r.quiet || r.value === 'laundry' ? 'Only When Active' : null,
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
        // LAUNDRY (phase 22): always When Active -- "Off" says nothing -- and what it counts is Accessories -> Laundry's machines
        if (kind === 'laundry') {
          var nL = this.laundryList().length;
          c.appendChild(K.group({ footer: 'The Laundry chip appears only while a washer or dryer runs, is done or needs a look: “24 min left”, “Done”, “2 Machines”. A tap opens the laundry sheet.' },
            [
            K.info({ label: 'Show', value: 'When Active' })]));
          c.appendChild(K.group({ header: 'What It Counts', footer: 'The same on every screen.' }, [
            K.nav({ label: 'Laundry', icon: 'mdi:washing-machine', value: nL ? nL + (nL === 1 ? ' Machine' : ' Machines') : 'None', href: '#/accessories/laundry', sk: 'chip:laundry' })]));
          return;
        }
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
        c.appendChild(K.group({ header: 'What It Counts', footer: (src.kinds || []).length ?
          'Tap a type to change what this chip counts: Add… counts something more (an outlet with a lamp, a group helper); open an accessory to hide it from the chip. The same on every screen.' :
          'The same on every screen.' }, rows));
      }
    };
    KIT.install(Methods);
  };
})();
