// hk-settings-add.js - Add a Screen and Custom Chips.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-add'] = function (KIT) {
    var DOMAIN = KIT.DOMAIN, hashOf = KIT.hashOf, SETUP_FIRST = KIT.SETUP_FIRST;

    var h, K, M;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      h = s.h; K = s.K; M = s.M;
    });

    // THE METHODS this part adds to HkSettingsPanel.prototype (KIT.install: not enumerable, as a class body
    // defines them). They are written here exactly as they were in the class. (`extends` an `any`: only so the type
    // checker lets `this` have the properties the shell's class gives it; nothing makes an instance of this.)
    var Methods = class extends /** @type {any} */ (Object) {
      // ---------------------------------------------------------- add a screen
      p_add(sub) {
        var self = this, d = this.data;
        // a host that can't make a screen says why instead
        var addNote = this.hostNote('add_screen');
        if (addNote) {
          return { title: 'Add Screen', back: [this.title(), '#/'], body: function (c) {
            c.appendChild(K.group({ footer: addNote }, []));
          } };
        }
        var others = d.dashboards.filter(function (x) { return !x.item; });
        this._new = this._new || { name: '', kind: 'wall_tablet', admin: false };
        var nw = this._new;
        if (sub[0] === 'kind') {
          return { title: 'Shown On', back: ['Add Screen', '#/add-screen'], body: function (c) {
            c.appendChild(K.group({ footer: 'It starts with the settings that suit it. Everything can be changed afterwards.' },
              Object.keys(M.PRESETS).map(function (k) {
                return K.check({ label: M.PRESETS[k][0], sub: M.PRESETS[k][1], on: nw.kind === k, fk: 'kind:' + k,
                                 onClick: function () {
                                   nw.kind = k;
                                   // an energy display is only the Energy page; leaving it, a whole screen again
                                   if (k === 'energy') nw.shows = 'energy';
                                   else if (nw.shows === 'energy') nw.shows = 'all';
                                   self.back('#/add-screen');
                                 } });
              })));
          } };
        }
        if (sub[0] === 'shows') {
          return { title: 'Shows', back: ['Add Screen', '#/add-screen'], body: function (c) { self.showsChoices(c, nw); } };
        }
        if (sub[0] === 'from') {
          nw.copy = nw.copy || { from: null, groups: M.copyDefaults() };
          var mine = d.dashboards.filter(function (x) { return x.item && d.boards[x.path]; });
          return { title: 'Copy Settings From', back: ['Add Screen', '#/add-screen'], body: function (c) {
            c.appendChild(K.group({ footer: 'The new screen starts from its Shown On preset; what you tick below is then copied from this screen.' },
              [K.check({ label: 'Nothing', sub: 'Just the preset', on: !nw.copy.from, fk: 'newfrom:none',
                         onClick: function () { nw.copy.from = null; self.render(); } })].concat(mine.map(function (x) {
                return K.check({ label: x.title, sub: '/' + x.path, on: nw.copy.from === x.path, fk: 'newfrom:' + x.path,
                                 onClick: function () { nw.copy.from = x.path; self.render(); } });
              }))));
            if (nw.copy.from) self.copyGroups(c, nw.copy);
          } };
        }
        if (sub[0] === 'use' && sub[1]) {
          var x = this.dash(sub[1]);
          this._use = this._use && this._use.path === sub[1] ? this._use : { path: sub[1], kind: 'custom' };
          var use = this._use;
          return { title: x ? 'Set Up ' + x.title : 'Set Up', back: ['Add Screen', '#/add-screen'],
            scope: 'What is it shown on? It starts with the settings that suit it; every one can be changed afterwards.', body: function (c) {
              c.appendChild(K.group({ header: 'Shown On' }, Object.keys(M.PRESETS).map(function (k) {
                return K.check({ label: M.PRESETS[k][0], sub: M.PRESETS[k][1], on: use.kind === k, fk: 'usekind:' + k,
                                 onClick: function () {
                                   use.kind = k;
                                   if (k === 'energy') use.shows = 'energy'; else if (use.shows === 'energy') use.shows = 'all';
                                   self.render();
                                 } });
              })));
              if (x && x.generated) self.showsChoices(c, use, true);
              c.appendChild(K.group({ footer: x && x.generated ? self.showsNote(use) : null }, [K.button({ label: 'Set Up Screen', center: true, fk: 'use:go', onClick: function () {
                self.status('saving');
                self.createItem(sub[1], use.kind).then(function () { return self.applyShows(sub[1], use); }).then(function () {
                  self.status('saved');
                  return self.reload();
                }).then(function () {
                  // from the Setup Assistant's First Screen step: on to its last step
                  if (self.from[hashOf(location.hash)] === '#/setup/' + SETUP_FIRST) { self._created = sub[1]; self.go('#/setup/' + (SETUP_FIRST + 1)); return; }
                  self.go('#/screens/' + encodeURIComponent(sub[1]));
                }, function (e) {
                  self.status('error'); self.announce('Couldn’t set it up: ' + (e && e.message || e));
                });
              } })]));
            } };
        }
        return { title: 'Add Screen', top: true, body: function (c) { self.addScreenBody(c, others); } };
      }
      addScreenBody(c, others, after) {
        var self = this, nw = this._new = this._new || { name: '', kind: 'wall_tablet', admin: false };
        var nameRow = K.text({ label: 'Name', value: nw.name, placeholder: 'Kitchen', sk: 'new:name', maxlength: 40,
                               onCommit: function (v) { nw.name = v; } });
        c.appendChild(K.group({ header: 'New Screen', footer: 'A new dashboard that builds itself from your rooms and devices.' }, [
          nameRow,
          K.nav({ label: 'Shown On', value: M.PRESETS[nw.kind][0], href: '#/add-screen/kind', sk: 'new:kind' }),
          K.nav({ label: 'Shows', value: self.showsLabel(nw), href: '#/add-screen/shows', sk: 'new:shows' }),
          K.nav({ label: 'Copy Settings From', sk: 'new:from', href: '#/add-screen/from',
                  value: nw.copy && nw.copy.from ? ((self.dash(nw.copy.from) || {}).title || nw.copy.from) : 'Nothing' }),
          K.toggle({ label: 'Only Admins Can Open It', on: nw.admin, sk: 'new:admin', onChange: function (on) { nw.admin = on; } })]));
        c.appendChild(K.group({ footer: self.showsNote(nw) }, [K.button({ label: nw.shows && nw.shows !== 'all' ? 'Create Page Screen' : 'Create Screen', center: true, fk: 'new:go',
          onClick: function () {
          var inp = self.shadowRoot.querySelector('[data-fk="new:name"]');
          var title = String((inp && inp.value) || nw.name || '').trim();
          if (!title) { self.errors['new:name'] = 'Give it a name.'; self.render(); return; }
          delete self.errors['new:name'];
          self.status('saving');
          var copy = nw.copy && nw.copy.from ? nw.copy : null;
          var src = copy ? self.data.boards[copy.from] : null;
          var shows = { shows: nw.shows || 'all', kind: nw.kind };
          self.createScreen(title, nw.kind, nw.admin).then(function (path) {
            // the preset first, then what was chosen from the other screen (its accessory names too: copyOnto)
            return copy && src ? self.copyOnto(path, copy).then(function () { return path; }) : path;
          }).then(function (path) {
            // then what it shows: everything, or only some pages
            return self.applyShows(path, shows).then(function () { return path; });
          }).then(function (path) {
            self._new = null;
            self.status('saved');
            return self.reload().then(function () {
              if (after) { after(path); return; }
              // only some pages: on to picking them, with nothing picked yet
              self.go('#/screens/' + encodeURIComponent(path) + (shows.shows === 'pages' ? '/pages' : ''));
            });
          }, function (e) { self.status('error'); self.announce('Couldn’t create it: ' + (e && e.message || e)); });
        } })]));
        if (this.err('new:name')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('new:name') }));
        if (others && others.length) {
          c.appendChild(K.group({ header: 'Existing Dashboards', footer: 'Give a dashboard you already have its own HK settings.' },
            others.map(function (x) {
              return K.nav({ label: x.title, sub: '/' + x.path, href: '#/add-screen/use/' + encodeURIComponent(x.path) });
            })));
        }
      }
      // WHAT A NEW SCREEN SHOWS: everything (Home, rooms, every page -- a
      // normal screen), or only some pages (no Home: an Energy display, a
      // Security panel). Asked when it is made, so a page screen is never made
      // by accident, and never mistaken for a whole one.
      showsLabel(nw) {
        return nw.shows === 'energy' ? 'Only the Energy Page' : nw.shows === 'pages' ? 'Only Some Pages' : 'Everything';
      }
      showsNote(nw) {
        return nw.shows === 'energy' ? 'A page screen: only the Energy page, with no Home page and no rooms.'
          : nw.shows === 'pages' ? 'A page screen: no Home page and no rooms. You pick its pages next; until you do, it shows everything.'
          : 'A whole screen: Home, your rooms and every page your home has.';
      }
      showsChoices(c, nw, inline) {
        var self = this, energyOn = this.energyOn();
        var pick = function (v) { return function () { nw.shows = v; if (inline) self.render(); else self.back('#/add-screen'); }; };
        var rows = [
          K.check({ label: 'Everything', sub: 'Home, your rooms and every page — a normal screen', on: !nw.shows || nw.shows === 'all',
                    fk: 'shows:all', onClick: pick('all') }),
          K.check({ label: 'Only Some Pages', sub: 'No Home page, no rooms: just the pages you pick next — Security and Cameras, say',
                    on: nw.shows === 'pages', fk: 'shows:pages', onClick: pick('pages') })];
        if (energyOn) {
          rows.push(K.check({ label: 'Only the Energy Page', sub: 'An energy display', on: nw.shows === 'energy', fk: 'shows:energy',
                              onClick: pick('energy') }));
        }
        c.appendChild(K.group({ header: inline ? 'Shows' : null,
          footer: 'Either way it can be changed later on its Pages page (Home Page on or off). Nothing is deleted either way.' }, rows));
      }
      applyShows(path, nw) {
        if (nw.shows === 'pages') return this.setB(path, { home_page: false, only_pages: [] });
        if (nw.shows === 'energy') return this.setB(path, { home_page: false, only_pages: ['energy'] });
        // everything: a whole screen, whatever the preset said
        return this.setB(path, { home_page: true });
      }
      // a dashboard's item, through its own flow (what it is shown on, then
      // its menu as that starts it)
      async createItem(path, kind) {
        var base = 'config/config_entries/subentries/flow';
        var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'dashboard'] });
        var fid = r.flow_id;
        try {
          r = await this.rest('POST', base + '/' + fid, { dashboard: path });
          if (r.step_id === 'kind') r = await this.rest('POST', base + '/' + fid, { kind: kind });
          if (r.step_id === 'settings') r = await this.rest('POST', base + '/' + fid, {});
        } catch (e) {
          this.rest('DELETE', base + '/' + fid).catch(function () {});
          throw e;
        }
        if (r.type !== 'create_entry') throw new Error(r.reason || 'not set up');
      }
      async createScreen(title, kind, admin) {
        var slug = 'hk-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
        var taken = this.data.dashboards.map(function (d) { return d.path; });
        var path = slug, n = 2;
        while (taken.indexOf(path) >= 0) path = slug + '-' + (n++);
        await this.actions().callWS({ type: 'lovelace/dashboards/create', url_path: path, title: title,
                            icon: 'mdi:home-heart', show_in_sidebar: true, require_admin: !!admin, mode: 'storage' });
        await this.actions().callWS({ type: 'lovelace/config/save', url_path: path, config: { strategy: { type: 'custom:hk-dashboard' } } });
        await this.createItem(path, kind);
        return path;
      }

      // ---------------------------------------------------------- custom chips
      // CUSTOM CHIPS (Library): the house's own status chips in YAML
      // (settings.py SUBENTRY_CHIP), shown by the screens that list them.
      p_chips(sub) {
        var self = this, lib = this.data.custom_chips || [], base = '#/chips';
        var mk = function (t, body) { return { title: t, back: ['Custom Chips', base], body: body }; };
        var where = function (after) {
          return after === 'start' ? 'At the start' : after === 'end' || !after ? 'At the end' : 'After ' + (M.CHIP_LABELS[after] || after);
        };
        var usedOn = function (key) {
          return self.data.dashboards.filter(function (d) { var bb = self.data.boards[d.path]; return bb && (bb.chips_custom || []).indexOf(key) >= 0; })
            .map(function (d) { return d.title; });
        };
        if (!sub[0]) {
          return { title: 'Custom Chips', top: true, scope: 'Status chips you write yourself, for any screen.', body: function (c) {
            c.appendChild(
              K.group({ footer: 'A chip in YAML — an hk-status-chip-card, or one inside a conditional that shows it only sometimes. A screen shows it once it’s added to that screen’s Status Chips.' },
              lib.map(function (x) {
                var on = usedOn(x.key);
                return K.nav({ label: x.name, sub: where(x.after) + ' · ' + (on.length ? on.join(', ') : 'On no screen yet'),
                               href: base + '/' + encodeURIComponent(x.key), fk: 'chips:' + x.key });
              }).concat([K.nav({ label: 'Add Custom Chip', href: base + '/new', icon: 'mdi:plus-circle-outline', fk: 'chips:new' })])));
          } };
        }
        var key = decodeURIComponent(sub[0]), chip = lib.filter(function (x) { return x.key === key; })[0];
        if (key !== 'new' && !chip) return mk('Custom Chip', function (c) { c.appendChild(K.group({ footer: 'That chip isn’t there any more.' }, [])); });
        var f = (this._chipForms = this._chipForms || {})[key] = this._chipForms[key] ||
          (chip ? { name: chip.name, after: chip.after } : { name: '', after: 'end' });
        var save = function (card) {
          return self.ws(Object.assign({ type: DOMAIN + '/chip/save', name: f.name, after: f.after, card: card },
                                       chip ? { key: chip.key } : {}), ['name', 'card', 'after']);
        };
        return mk(chip ? chip.name : 'Add Custom Chip', function (c) {
          c.appendChild(K.group({}, [
            K.text({ label: 'Name', sk: 'name', value: f.name, placeholder: 'House Battery', maxlength: 40, error: self.err('name'),
                     onCommit: function (v) { f.name = v.trim(); if (chip) save(chip.card); } }),
            K.select({ label: 'Sits', sk: 'after', value: f.after,
                       options: [['start', 'At the Start']].concat(self.data.chip_kinds.map(function (k) { return [k, 'After ' + (M.CHIP_LABELS[k] || k)]; }), [['end', 'At the End']]),
                       onChange: function (v) { f.after = v; if (chip) save(chip.card); else self.render(); } })]));
          // THE DRAFT IS THE PAGE'S (f.card): a redraw -- a name or place
          // committed, a save elsewhere -- rebuilt the editor from the stored
          // card and threw away what was being written.
          self.yamlPage(c, { value: f.card !== undefined ? f.card : (chip ? chip.card : {}), sk: 'card', clear: false,
            saveLabel: chip ? 'Save Chip' : 'Add Chip', onDraft: function (v) { f.card = v; },
            help: 'The chip, as a card. Where it sits applies unless a screen orders its chips itself.',
            example:
              'type: custom:hk-status-chip-card\nentity: sensor.home_battery_level\nname: House Battery\nicon: hk:home-battery\nicon_color: green\ntap_action:\n  action: navigate\n  ' +
              'navigation_path: ./power',
            onSave: function (card) {
              if (!f.name) { self.errors.name = M.errorText('name_needed'); self.render(); return; }
              save(card).then(function (ok) {
                if (!ok) return;
                delete self._chipForms[key];
                self.reload().then(function () { self.back(base); });
              });
            } });
          if (chip) {
            // ITS SCREENS (2026-10-13): where it shows, Always or When Active
            c.appendChild(K.group({ header: 'Screens', footer: 'Each screen that shows it: Always, or only When Active — like the other chips.' }, [
              K.nav({ label: 'On Screens', value: self.chipSays(self.chipScreens('chip:' + chip.key)), icon: 'mdi:label-multiple',
                      href: '#/house/chips/' + encodeURIComponent('chip:' + chip.key), sk: 'chips:screens:' + chip.key })]));
            var on = usedOn(chip.key);
            c.appendChild(K.group({ footer: on.length ? 'On ' + on.join(', ') + '.' : 'No screen shows it yet: add it on a screen’s Status Chips.' }, [
              K.button({ label: 'Delete Chip', destructive: true, fk: 'chips:delete', onClick: function () {
                K.confirm(self.shadowRoot, { title: 'Delete “' + chip.name + '”?', ok: 'Delete', destructive: true,
                  message: on.length ? 'It goes from ' + on.join(', ') + ' too.' : 'No screen shows it.' })
                  .then(function (yes) {
                    if (!yes) return;
                    self.ws({ type: DOMAIN + '/chip/remove', key: chip.key }, ['key'])
                      .then(function (ok) { if (ok) self.reload().then(function () { self.back(base); }); });
                  });
              } })]));
          }
        });
      }
    };
    KIT.install(Methods);
  };
})();
