// hk-settings-screen-cameras.js - a screen's cameras, scenes, page headers and favorites.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-screen-cameras'] = function (KIT) {
    var FAV_POOL = KIT.FAV_POOL, haPlace = KIT.haPlace, SCENE_POOL = KIT.SCENE_POOL;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
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
                'screen’s strip. Add ' + (missing === 1 ? 'it' : 'them') + ', spelled as shown, in ' + haPlace('Settings → Devices & Services → Helpers') + '; until then the automation leaves ' +
                  (missing === 1 ? 'it' : 'them') + ' out.'
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
        c.appendChild(K.group({ footer: 'A scene’s name, icon and color on the pill are in its settings. A page pill’s are the same on every screen (All Screens → Appearance → Page Pills): tap it.' },
          []));
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
    };
    KIT.install(Methods);
  };
})();
