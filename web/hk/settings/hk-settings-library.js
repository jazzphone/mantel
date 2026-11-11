// hk-settings-library.js - Pop-ups, Custom Pages and System.
//
// PART OF THE HK SETTINGS PAGE (hk-settings.js). Not a card and not run on its own: it registers one
// function, which hk-settings.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
// @ts-check
(function () {
  'use strict';
  (window.hkSettingsParts = window.hkSettingsParts || {})['hk-settings-library'] = function (KIT) {
    var C = KIT.C, docsLink = KIT.docsLink, DOMAIN = KIT.DOMAIN, haName = KIT.haName, haPlace = KIT.haPlace,
        PN = KIT.PN, SETUP_FIRST = KIT.SETUP_FIRST, SETUP_STEPS = KIT.SETUP_STEPS, slug = KIT.slug,
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
      // ---------------------------------------------------------- pop-ups
      p_popups(sub) {
        var self = this, back = ['Pop-ups', '#/popups'];
        if (sub[0] === 'new') return { title: 'New Pop-up', back: back, body: function (c) { self.pop_new(c); } };
        if (sub[0]) {
          var p = this.data.popups.filter(function (x) { return x.hash === sub[0]; })[0];
          if (!p) return { title: 'Pop-up', back: back, body: function (c) { c.appendChild(K.group({ footer: 'There’s no pop-up #' + sub[0] + '.' }, [])); } };
          if (sub[1] === 'accessories') return { title: 'Accessories', back: [p.name || p.hash, '#/popups/' + p.hash], body: function (c) { self.pop_entities(c, p); } };
          if (sub[1] === 'cards' && p.kind === 'cards') return { title: 'Cards', back: [p.name || p.hash, '#/popups/' + p.hash], body: function (c) {
            self.yamlPage(c, { value: p.cards, sk: 'pop:cards', clear: false,
              help: 'The sheet’s cards, as a list in YAML — any card, one under another. The sheet has its own name and glyph above them.',
              example: '- type: custom:hk-heading-card\n  name: Garage\n- type: tile\n  entity: cover.garage_door\n- type: custom:hk-camera-card\n  entity: camera.garage',
              onSave: function (v) {
                var cards = Array.isArray(v) ? v : v && v.type ? [v] : [];
                self.popupSave(p, { cards: cards }).then(function () { if (!self.err('pop:' + p.hash)) self.back('#/popups/' + p.hash); });
              } });
          } };
          return { title: p.name || '#' + p.hash, back: back, scope: 'Opens on a screen whose address ends in <b>#' + K.esc(p.hash) + '</b>.',
                   body: function (c) { self.pop_one(c, p); } };
        }
        return { title: 'Pop-ups', top: true, scope: 'Sheets an automation can open on any screen — the doorbell, the alarm keypad.', body: function (c) {
          var d = self.data;
          c.appendChild(K.group({ footer: 'An automation opens one with the hk_frontend.show_popup action, or by loading a screen’s address ending in its #.' },
            d.popups.map(function (p) {
              return K.nav({ label: p.name || p.hash, value: '#' + p.hash, href: '#/popups/' + p.hash,
                             icon: p.kind === 'camera' ? 'mdi:doorbell-video' : p.kind === 'alarm' ? 'mdi:shield-home' :
                                   p.kind === 'cards' ? p.icon || 'mdi:card-text-outline' : 'mdi:view-grid' });
            }).concat([K.nav({ label: 'Add Pop-up', href: '#/popups/new', cls: 'tintc', icon: 'mdi:plus' })])));
        } };
      }
      async popupFlow(p, values) {
        var base = 'config/config_entries/subentries/flow';
        var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'popup'], subentry_id: p.item });
        var body = {};
        Object.keys(values).forEach(function (k) {
          var v = values[k];
          if (v === '' || v === null || v === undefined) return;
          body[k] = v;
        });
        var r2;
        try { r2 = await this.rest('POST', base + '/' + r.flow_id, body); } catch (e) {
          this.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
          throw e;
        }
        if (r2.type === 'form') {
          this.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
          var code = r2.errors && Object.keys(r2.errors).map(function (k) { return r2.errors[k]; })[0];
          throw new Error(M.errorText(code || 'unknown'));
        }
      }
      popupSave(p, changes) {
        var self = this;
        var v = { name: p.name, close_after: p.close_after, dashboards: p.dashboards };
        if (p.kind === 'camera') { v.entity = p.entity; v.speaker = p.speaker; v.stream = p.stream; }
        else if (p.kind === 'alarm') v.entity = p.entity;
        else if (p.kind === 'cards') { v.cards = p.cards; v.icon = p.icon; v.width = p.width; }
        else v.entities = p.entities;
        Object.assign(v, changes);
        Object.assign(p, changes);
        this.render();
        this.status('saving');
        return this.popupFlow(p, v).then(function () {
          self.status('saved'); return self.reload().then(function () { self.render(); });
        }, function (e) {
          self.status('error'); self.errors['pop:' + p.hash] = String(e && e.message || e);
          return self.reload().then(function () { self.render(); });
        });
      }
      pop_one(c, p) {
        var self = this, save = function (ch) { delete self.errors['pop:' + p.hash]; return self.popupSave(p, ch); };
        var kind = M.POPUP_KINDS.filter(function (k) { return k[0] === p.kind; })[0] || [p.kind, p.kind];
        c.appendChild(K.group({}, [
          K.text({ label: 'Name', sk: 'pop:name', value: p.name, maxlength: 60, onCommit: function (v) { if (v.trim()) save({ name: v.trim() }); } }),
          K.info({ label: 'Type', value: kind[1] }), K.info({ label: 'Address', value: '#' + p.hash })]));
        if (this.err('pop:' + p.hash)) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('pop:' + p.hash) }));
        if (p.kind === 'camera') {
          c.appendChild(
            K.group(
            { header: 'Camera', footer: 'Live talk-back needs UniFi Protect and the camera’s own speaker; without them it plays a recorded clip. A higher-resolution stream can be shown live.' +
            (this.talkNote() ? ' ' + this.talkNote() : '') }, [
            this.entityRow({ label: 'Camera', sk: 'pop:entity', value: p.entity, none: null, filter: { domains: ['camera'] },
                             onPick: function (v) { if (v) save({ entity: v }); } }),
            this.entityRow({ label: 'Talk-Back Speaker', sk: 'pop:speaker', value: p.speaker, none: 'The Camera’s Own', filter: { domains: ['media_player'] },
                             onPick: function (v) { save({ speaker: v || '' }); } }),
            this.entityRow({ label: 'Live Stream', sk: 'pop:stream', value: p.stream, none: 'Its High-Resolution Channel', filter: { domains: ['camera'] },
                             onPick: function (v) { save({ stream: v || '' }); } })]));
        } else if (p.kind === 'alarm') {
          c.appendChild(K.group({ header: 'Alarm' }, [
            this.entityRow({ label: 'Alarm Panel', sk: 'pop:entity', value: p.entity, none: this.sameAsGeneral(), filter: { domains: ['alarm_control_panel'] },
                             onPick: function (v) { save({ entity: v || '' }); } })]));
        } else if (p.kind === 'cards') {
          c.appendChild(K.group({ header: 'Sheet', footer: 'Any cards — Home Assistant’s own, or a custom card’s.' }, [
            K.nav({ label: 'Cards', value: p.cards.length ? String(p.cards.length) : 'None Yet', href: '#/popups/' + p.hash + '/cards', sk: 'pop:cards' }),
            K.text({ label: 'Icon', sk: 'pop:icon', value: p.icon, placeholder: 'mdi:card-text-outline', maxlength: 60, autocomplete: 'off',
                     error: this.err('pop:icon'),
                     onCommit: function (v) {
                       v = v.trim();
                       if (v && !/^(mdi|hk):[a-z0-9-]+$/.test(v)) { self.errors['pop:icon'] = M.errorText('icon'); self.render(); return; }
                       delete self.errors['pop:icon']; save({ icon: v });
                     } }),
            K.select({ label: 'Width', sk: 'pop:width', value: p.width, options: [['narrow', 'Narrow'], ['wide', 'Wide']],
                       onChange: function (v) { save({ width: v }); } })]));
        } else {
          c.appendChild(K.group({ header: 'Accessories' }, [K.nav({ label: 'Accessories', value: String(p.entities.length),
                                                                    href: '#/popups/' + p.hash + '/accessories' })]));
        }
        var opts = M.CLOSE_AFTER.slice();
        if (!opts.some(function (o) { return o[0] === p.close_after; })) opts.push([p.close_after, p.close_after + ' Seconds']);
        c.appendChild(K.group({}, [K.select({ label: 'Close After', sk: 'pop:close', value: p.close_after,
          options: opts.map(function (o) { return [String(o[0]), o[1]]; }), onChange: function (v) { save({ close_after: Number(v) }); } })]));
        var screens = this.data.dashboards.filter(function (x) { return x.item; });
        var all = !p.dashboards.length;
        var srows = [K.toggle({ label: 'Show on Every Screen', sk: 'pop:all', on: all, onChange: function (on) {
          save({ dashboards: on ? [] : screens.filter(function (x) { return (self.data.boards[x.path] || {}).popups !== false; }).map(function (x) { return x.path; }) });
        } })];
        if (!all) {
          screens.forEach(function (x) {
            var on = p.dashboards.indexOf(x.path) >= 0;
            var answers = (self.data.boards[x.path] || {}).popups !== false;
            srows.push(K.check({ label: x.title, sub: answers ? null : 'Allow Pop-ups is off on this screen', multi: true, on: on, fk: 'pop:d:' + x.path,
              onClick: function () {
                var next = p.dashboards.filter(function (d) { return d !== x.path; });
                if (!on) next.push(x.path);
                if (!next.length) { self.announce('Turn on All Screens instead.'); return; }
                save({ dashboards: next });
              } }));
          });
        }
        c.appendChild(K.group({ header: 'Screens', footer: 'A screen with Allow Pop-ups turned off never shows one.' }, srows));
        c.appendChild(K.group({}, [K.button({ label: 'Delete Pop-up…', destructive: true, sk: 'pop:delete', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Delete #' + p.hash + '?', message: 'Automations that open it will open nothing.', ok: 'Delete', destructive: true })
            .then(function (yes) {
              if (!yes) return;
              self.ws({ type: 'config_entries/subentries/delete', entry_id: self.data.entry_id, subentry_id: p.item }).then(function (ok) {
                if (ok) self.reload().then(function () { self.go('#/popups'); });
              });
            });
        } })]));
      }
      pop_entities(c, p) {
        var self = this;
        c.appendChild(K.listEditor({ fk: 'pe', shownHeader: 'On the Sheet', minRows: 1, announce: this.announce.bind(this),
          rows: p.entities.map(function (id) { return { value: id, label: self.name(id) }; }),
          onChange: function (v) { self.popupSave(p, { entities: v }); },
          addLabel: 'Add Accessory…', onAddOther: function () {
            self.go(self.picker('pe-add', { title: 'Add Accessory', value: null, multi: true,
              items: function () { return self.entityIds({ re: TILE_DOMAINS, shown: true }).filter(function (id) { return p.entities.indexOf(id) < 0; })
                .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; }); },
              onPick: function (id) { if (id) self.popupSave(p, { entities: p.entities.concat(id) }); } }));
          } }));
      }
      pop_new(c) {
        var self = this, np = this._np = this._np || { name: '', hash: '', kind: 'camera', entity: null, speaker: null, stream: null, entities: [] };
        c.appendChild(K.group({ footer: 'The address is what an automation opens: a screen’s address ending in #' + (np.hash || slug(np.name) || 'front-door') + '.' }, [
          K.text({ label: 'Name', sk: 'np:name', value: np.name, placeholder: 'Front Door', maxlength: 60, onCommit: function (v) { np.name = v; self.render(); } }),
          K.text({ label: 'Address', sk: 'np:hash', value: np.hash, placeholder: slug(np.name) || 'front-door', maxlength: 40,
                   onCommit: function (v) { np.hash = v.replace(/^#/, ''); self.render(); } })]));
        c.appendChild(K.group({ header: 'Type' }, M.POPUP_KINDS.map(function (k) {
          return K.check({ label: k[1], sub: k[2], on: np.kind === k[0], fk: 'np:kind:' + k[0], onClick: function () { np.kind = k[0]; self.render(); } });
        })));
        var pick = function (key) { return function (v) { np[key] = v; self.render(); }; };
        if (np.kind === 'camera') {
          c.appendChild(K.group({ header: 'Camera', footer: this.talkNote() }, [
            this.entityRow({ label: 'Camera', sk: 'np:entity', value: np.entity, none: 'Choose…', filter: { domains: ['camera'] }, onPick: pick('entity') }),
            this.entityRow({ label: 'Talk-Back Speaker', sk: 'np:speaker', value: np.speaker, none: 'The Camera’s Own', filter: { domains: ['media_player'] }, onPick: pick('speaker') })]));
        } else if (np.kind === 'alarm') {
          c.appendChild(K.group({ header: 'Alarm' }, [
            this.entityRow({ label: 'Alarm Panel', sk: 'np:entity', value: np.entity, none: this.sameAsGeneral(), filter: { domains: ['alarm_control_panel'] }, onPick: pick('entity') })]));
        } else if (np.kind === 'cards') {
          c.appendChild(K.group({ footer: 'Its cards are written next, in YAML.' }, []));
        } else {
          c.appendChild(K.listEditor({ fk: 'npe', shownHeader: 'Accessories', emptyText: 'None yet', reorder: true,
            rows: np.entities.map(function (id) { return { value: id, label: self.name(id) }; }),
            onChange: function (v) { np.entities = v; self.render(); },
            addLabel: 'Add Accessory…', onAddOther: function () {
              self.go(self.picker('npe-add', { title: 'Add Accessory', value: null, multi: true,
                items: function () { return self.entityIds({ re: TILE_DOMAINS, shown: true }).filter(function (id) { return np.entities.indexOf(id) < 0; })
                  .map(function (id) { return { value: id, label: self.name(id), sub: self.areaName(self.areaOf(id)) || id }; }); },
                onPick: function (id) { if (id) { np.entities = np.entities.concat(id); } } }));
            } }));
        }
        if (this.err('np')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('np') }));
        var ready = np.name.trim() && (np.kind !== 'camera' || np.entity) && (np.kind !== 'accessories' || np.entities.length);
        c.appendChild(K.group({}, [K.button({ label: 'Add Pop-up', center: true, disabled: !ready, fk: 'np:go', onClick: function () {
          self.status('saving');
          self.addPopup(np).then(function (hash) {
            var kind = np.kind;
            self._np = null; delete self.errors.np; self.status('saved');
            return self.reload().then(function () {
              self.go('#/popups/' + hash);
              // then its cards, one step on (so Back is the pop-up's page)
              if (kind === 'cards') setTimeout(function () { self.go('#/popups/' + hash + '/cards'); }, 80);
            });
          }, function (e) { self.errors.np = String(e && e.message || e); self.status('error'); self.render(); });
        } })]));
      }
      async addPopup(np) {
        var base = 'config/config_entries/subentries/flow';
        var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'popup'] });
        var fid = r.flow_id;
        try {
          var first = { name: np.name.trim(), kind: np.kind };
          if (np.hash.trim()) first.hash = np.hash.trim();
          r = await this.rest('POST', base + '/' + fid, first);
          if (r.type === 'form' && r.step_id === 'user') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
          var det = { close_after: np.kind === 'alarm' ? 3600 : 60 };
          if (np.entity) det.entity = np.entity;
          if (np.kind === 'camera' && np.speaker) det.speaker = np.speaker;
          if (np.kind === 'accessories') det.entities = np.entities;
          if (np.kind === 'cards') det.width = 'narrow';
          r = await this.rest('POST', base + '/' + fid, det);
          if (r.type !== 'create_entry') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
          return r.result && r.result.unique_id || first.hash || slug(np.name);
        } catch (e) {
          this.rest('DELETE', base + '/' + fid).catch(function () {});
          throw e;
        }
      }

      // ---------------------------------------------------------- custom pages
      p_pages(sub) {
        var self = this, back = ['Custom Pages', '#/pages'];
        if (sub[0] === 'new') return { title: 'New Page', back: back, body: function (c) { self.pg_new(c); } };
        if (sub[0]) {
          var p = (this.data.custom_pages || []).filter(function (x) { return x.path === sub[0]; })[0];
          if (!p) return { title: 'Page', back: back, body: function (c) { c.appendChild(K.group({ footer: 'There’s no page /' + sub[0] + '.' }, [])); } };
          if (sub[1] === 'content') return { title: 'Page Content', back: [p.title, '#/pages/' + p.path], body: function (c) {
            self.yamlPage(c, { value: p.view, sk: 'pg:view:' + p.path,
              help: 'The page’s cards, in YAML, as a dashboard view without its title, address and icon.',
              onSave: function (v) { return self.pageSave(p, { view: v }); } });
          } };
          return { title: p.title, back: back, scope: 'At <b>/' + K.esc(p.path) + '</b> on the screens that show it.', body: function (c) { self.pg_one(c, p); } };
        }
        return { title: 'Custom Pages', top: true, scope: 'Pages you write yourself, in YAML. Any generated screen can show them.', body: function (c) {
          c.appendChild(K.group({}, (self.data.custom_pages || []).map(function (p) {
            return K.nav({ label: p.title, icon: p.icon || 'mdi:file-document-outline', href: '#/pages/' + p.path,
                           value: p.used_on.length ? 'On ' + p.used_on.length + ' Screen' + (p.used_on.length > 1 ? 's' : '') : 'Not Shown' });
          }).concat([K.nav({ label: 'Add Page', href: '#/pages/new', cls: 'tintc', icon: 'mdi:plus' })])));
        } };
      }
      async pageSave(p, changes) {
        var base = 'config/config_entries/subentries/flow', self = this;
        var v = Object.assign({ title: p.title, icon: p.icon, view: p.view }, changes);
        var body = { title: v.title, view: v.view };
        if (v.icon) body.icon = v.icon;
        this.status('saving');
        try {
          var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'page'], subentry_id: p.item });
          var r2 = await this.rest('POST', base + '/' + r.flow_id, body);
          if (r2.type === 'form') {
            this.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
            throw new Error(M.errorText(Object.keys(r2.errors || {}).map(function (k) { return r2.errors[k]; })[0]));
          }
          delete this.errors['pg:' + p.path];
          this.status('saved');
        } catch (e) {
          this.errors['pg:' + p.path] = String(e && e.message || e);
          this.status('error');
        }
        await this.reload();
        self.render();
      }
      pg_one(c, p) {
        var self = this;
        c.appendChild(K.group({}, [
          K.text({ label: 'Name', sk: 'pg:title', value: p.title, maxlength: 40, onCommit: function (v) { if (v.trim()) self.pageSave(p, { title: v.trim() }); } }),
          K.text({ label: 'Icon', sk: 'pg:icon', value: p.icon, placeholder: 'mdi:file-document', maxlength: 60,
                   onCommit: function (v) { self.pageSave(p, { icon: v.trim() }); } }),
          K.info({ label: 'Address', value: '/' + p.path })]));
        if (this.err('pg:' + p.path)) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('pg:' + p.path) }));
        var shown = this.data.dashboards.filter(function (x) { return p.used_on.indexOf(x.path) >= 0; });
        c.appendChild(K.group({ header: 'Shown On', footer: shown.length ? 'Add or remove it in a screen’s Pages.' : 'Not shown yet. Add it in a generated screen’s Pages.' },
          shown.map(function (x) { return K.nav({ label: x.title, value: 'Pages', href: '#/screens/' + encodeURIComponent(x.path) + '/pages' }); })));
        var cards = (p.view && p.view.cards) ? p.view.cards.length : 0;
        c.appendChild(K.group({}, [K.nav({ label: 'Page Content', value: cards + ' Card' + (cards === 1 ? '' : 's'), href: '#/pages/' + p.path + '/content' })]));
        if (shown.length) {
          c.appendChild(K.group({}, [K.nav({ label: 'Open Page', sub: 'On ' + shown[0].title, href: '/' + shown[0].path + '/' + p.path, icon: 'mdi:open-in-new' })]));
          var a = c.lastChild.querySelector('a'); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
        }
        c.appendChild(K.group({}, [K.button({ label: 'Delete Page…', destructive: true, sk: 'pg:delete', onClick: function () {
          K.confirm(self.shadowRoot, { title: 'Delete ' + p.title + '?', ok: 'Delete', destructive: true,
            message: shown.length ? shown.length + ' screen' + (shown.length > 1 ? 's show' : ' shows') + ' it; it will be gone from ' + (shown.length > 1 ? 'them' : 'it') + '.' :
              'No screen shows it.' })
            .then(function (yes) {
              if (!yes) return;
              self.ws({ type: 'config_entries/subentries/delete', entry_id: self.data.entry_id, subentry_id: p.item }).then(function (ok) {
                if (ok) self.reload().then(function () { self.go('#/pages'); });
              });
            });
        } })]));
      }
      pg_new(c) {
        var self = this, np = this._pgn = this._pgn || { title: '', path: '', icon: '', start: 'blank' };
        if (!this._starts) {
          this._starts = [['blank', 'A Blank Page']];
          var base = 'config/config_entries/subentries/flow';
          this.rest('POST', base, { handler: [this.data.entry_id, 'page'] }).then(function (r) {
            self.rest('DELETE', base + '/' + r.flow_id).catch(function () {});
            var f = (r.data_schema || []).filter(function (x) { return x.name === 'start'; })[0];
            var opts = f && f.selector && f.selector.select && f.selector.select.options || [];
            self._starts = opts.map(function (o) { return [o.value, o.value === 'blank' ? 'A Blank Page' : o.label]; });
            self.render();
          }).catch(function () {});
        }
        c.appendChild(K.group({}, [
          K.text({ label: 'Name', sk: 'pgn:title', value: np.title, placeholder: 'Energy', maxlength: 40, onCommit: function (v) { np.title = v; self.render(); } }),
          K.text({ label: 'Address', sk: 'pgn:path', value: np.path, placeholder: slug(np.title) || 'energy', maxlength: 40, onCommit: function (v) { np.path = v; } }),
          K.text({ label: 'Icon', sk: 'pgn:icon', value: np.icon, placeholder: 'mdi:lightning-bolt', maxlength: 60, onCommit: function (v) { np.icon = v; } }),
          K.select({ label: 'Start From', sk: 'pgn:start', value: np.start, options: this._starts, onChange: function (v) { np.start = v; } })]));
        if (this.err('pgn')) c.appendChild(h('div', { class: 'errline', role: 'alert', text: this.err('pgn') }));
        c.appendChild(K.group({ footer: 'Start from a page of another dashboard to copy its cards. You can edit them afterwards.' }, [
          K.button({ label: 'Create Page', center: true, disabled: !np.title.trim(), fk: 'pgn:go', onClick: function () {
            self.status('saving');
            self.addPage(np).then(function (path) {
              self._pgn = null; delete self.errors.pgn; self.status('saved');
              return self.reload().then(function () { self.go('#/pages/' + path); });
            }, function (e) { self.errors.pgn = String(e && e.message || e); self.status('error'); self.render(); });
          } })]));
      }
      async addPage(np) {
        var base = 'config/config_entries/subentries/flow';
        var r = await this.rest('POST', base, { handler: [this.data.entry_id, 'page'] });
        var fid = r.flow_id;
        try {
          var first = { title: np.title.trim(), start: np.start || 'blank' };
          if (np.path.trim()) first.path = np.path.trim();
          if (np.icon.trim()) first.icon = np.icon.trim();
          r = await this.rest('POST', base + '/' + fid, first);
          if (r.step_id === 'user') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
          // the view step holds the imported (or blank) page: submit it as it is
          var vf = (r.data_schema || []).filter(function (x) { return x.name === 'view'; })[0];
          var view = vf && vf.description && vf.description.suggested_value || { cards: [] };
          r = await this.rest('POST', base + '/' + fid, { view: view });
          if (r.type !== 'create_entry') throw new Error(M.errorText(Object.keys(r.errors || {}).map(function (k) { return r.errors[k]; })[0]));
          return (r.result && r.result.unique_id) || first.path || slug(first.title);
        } catch (e) {
          this.rest('DELETE', base + '/' + fid).catch(function () {});
          throw e;
        }
      }

      // ---------------------------------------------------------- system
      p_advanced() {
        var self = this;
        return { title: 'Advanced', top: true, scope: 'What almost nobody changes. Everything here works when left empty.', body: function (c) {
          var set = function (k) { return function (v) { var o = {}; o[k] = v; self.setH(o); }; };
          var I = self.data.integration || {}, f = I.files || {};
          // every feature on one page, a switch each (hk-settings-features.js featureList)
          var fo = F.featuresOn(self.data.features);
          if (fo.of) c.appendChild(K.group({ header: 'Features', footer: 'Turn the house’s features on and off in one place. Each feature’s own page has the same switch.' }, [
            K.nav({ label: 'Features', icon: 'mdi:puzzle', value: fo.on + ' of ' + fo.of + ' On', href: '#/advanced/features', fk: 'advanced:features' })]));
          c.appendChild(K.group({ header: 'Clock', footer: 'Home Assistant’s Time & Date sensors keep every screen’s clock in step with the house.' }, [
            self.entityRow({ label: 'Time Sensor', sk: 'clock.time', value: self.hs('clock.time'), none: 'Each Screen’s Own Clock', filter: { domains: ['sensor'] }, onPick: set('clock.time') }),
            self.entityRow({ label: 'Date Sensor', sk: 'clock.date', value: self.hs('clock.date'), none: 'Each Screen’s Own Clock', filter: { domains: ['sensor'] }, onPick: set('clock.date') })]));
          // (the Clean-Areas Script and the Wrong-Code Indicator are the
          // Vacuums and Security pages' since 2026-10-16)
          var own = (self.host() && self.host().owns) || {};
          if (!own.sidebar) c.appendChild(K.group({ header: 'HK Settings', footer: 'Off: HK Settings leaves the sidebar for everyone. It’s still in ' +
            haPlace('Settings → Devices & Services → HK Frontend → Configure') + '.' }, [
            K.toggle({ label: 'Show in Sidebar', sk: 'sidebar', on: I.sidebar !== false, onChange: function (on) { self.setH({ sidebar: on }); } })]));
          var fnd = function (v) { return v ? 'Found' : 'Missing'; };
          // a host that keeps the font and glyphs itself checks them on its own
          // page: HK's folder under /config is not where they are (2026-10-31)
          if (own.files) c.appendChild(K.group({ header: 'Your Files' }, [
            K.nav({ label: 'Font and Glyphs', sk: 'files_host', value: 'In Your Files', href: '#/' + own.files })]));
          else c.appendChild(
            K.group(
            { header: 'Your Files',
            footer:
            'Apple’s SF Pro font and the SF Symbols glyphs can’t ship with the integration. Put the font at fonts/SF-Pro.woff2 and the glyphs at iconset/hk-glyphs.js in this folder, under /config.' },
            [
            K.text({ label: 'Folder', sk: 'files_folder', value: I.files_folder, placeholder: 'hk_local', error: self.err('files_folder'),
                     onCommit: function (v) { self.setH({ files_folder: v }); } }),
            K.info({ label: 'SF Pro Font', value: fnd(f.font), valueCls: f.font ? 'ok' : 'warn' }),
            K.info({ label: 'SF Symbols Glyphs', value: fnd(f.glyphs), valueCls: f.glyphs ? 'ok' : 'warn' })]));
          c.appendChild(K.group({ header: 'Your Own Dashboards', footer: 'What a dashboard you write yourself can use, ready to copy: ' +
              'the screensaver, hiding Home Assistant’s header, the live sky, HK cards and more.' }, [
            K.nav({ label: 'YAML Reference', href: '#/advanced/yaml', sk: 'yaml-ref',
                    value: M.YAML_REF.reduce(function (n, g) { return n + g.items.length; }, 0) + ' Snippets' })]));
          c.appendChild(K.group({}, [K.nav({ label: 'Setup Assistant', href: '#/setup' })]));
        } };
      }
      // ADVANCED -> FEATURES: every feature with its switch (featureList)
      p_featureList() {
        var self = this;
        return { title: 'Features', back: ['Advanced', '#/advanced'],
                 scope: 'The house’s features, each on or off for every screen.',
                 body: function (c) { F.featureList(self, c); } };
      }
      // YOUR OWN DASHBOARDS: every snippet of M.YAML_REF, filled in from this
      // house where it can be, each on its own page with Copy and its place in
      // the wiki (docs/Your-Own-Dashboard.md holds the same text).
      p_yamlRef(id) {
        var self = this, list = ['Your Own Dashboards', '#/advanced/yaml'];
        // its place in the documentation, where the host has it ([] where not)
        var wiki = function (anchor) {
          var a = docsLink('Your-Own-Dashboard', anchor, { sub: 'Your Own Dashboard', fk: 'yaml:wiki' });
          return a ? [a] : [];
        };
        var item = id ? M.yamlRefItem(decodeURIComponent(id)) : null;
        if (!item) {
          return { title: 'Your Own Dashboards', back: ['Advanced', '#/advanced'],
            scope: 'What a dashboard you write yourself can use. Open one, copy it, and paste it into the dashboard’s YAML.', body: function (c) {
              // a host with pages of its own adds screens its own way, with no Existing Dashboards
              c.appendChild(K.group({ footer: self.host() ? '' : 'Easier still: HK Settings → Screens → Add Screen → Existing Dashboards gives a dashboard ' +
                  'its menu, its screensaver and Hide Home Assistant Header & Sidebar, with nothing written.' }, wiki('')));
              M.YAML_REF.forEach(function (g) {
                c.appendChild(K.group({ header: g.header, footer: g.footer }, g.items.map(function (it) {
                  return K.nav({ label: it.title, value: it.key, href: '#/advanced/yaml/' + encodeURIComponent(it.id), fk: 'yaml:' + it.id });
                })));
              });
            } };
        }
        var boards = this.data.boards || {};
        var tbs = this.tabs();
        var user = Object.keys(tbs).map(function (k) { return tbs[k].user; }).filter(Boolean)[0];
        var text = M.yamlRefText(item, { weather: this.hs('weather.entity'), user: user, photos: this.hs('look.photos') });
        var group = M.YAML_REF.filter(function (g) { return g.items.indexOf(item) >= 0; })[0];
        return { title: item.title, back: list, body: function (c) {
          var pre = h('pre', { class: 'code', text: text, tabindex: '0', 'aria-label': item.title + ', in YAML' });
          c.appendChild(K.group({ header: group ? group.header : null, footer: item.sub + (group ? ' ' + group.footer : '') }, [
            K.button({ label: 'Copy', fk: 'yaml:copy', onClick: function () {
              var done = function () { self.announce('Copied'); };
              var fallback = function () {
                var r = document.createRange(); r.selectNodeContents(pre);
                var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
                self.announce('Selected — copy it with your keyboard');
              };
              if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
              else fallback();
            } })]));
          c.appendChild(pre);
          if (wiki(item.anchor).length) c.appendChild(K.group({}, wiki(item.anchor)));
        } };
      }
      p_check() {
        var self = this;
        return { title: 'Setup Check', top: true, scope: 'What these pages need from this Home Assistant, and how to fix what’s missing.', body: function (c) {
          var lines = self._check;
          if (!lines) {
            c.appendChild(K.group({}, [K.info({ label: 'Checking…' })]));
            if (!self._checking) {
              self._checking = true;
              self.client.callWS({ type: DOMAIN + '/setup/check' }).then(function (r) { self._check = r.lines; self._checking = false; self.render(); },
                function (e) { self._checking = false; self._check = [{ ok: false, title: 'Setup check failed', detail: String(e && e.message || e) }]; self.render(); });
            }
            return;
          }
          var ic = function (ok) { return ok === true ? ['mdi:check', C.green] : ok === false ? ['mdi:exclamation', C.orange] : ['mdi:information-variant', C.gray]; };
          var groups = [['Needs Doing', false], ['Ready', true], ['Notes', null]];
          groups.forEach(function (g) {
            var ls = lines.filter(function (l) { return l.ok === g[1]; });
            if (!ls.length) return;
            c.appendChild(K.group({ header: g[0] }, ls.map(function (l) {
              // a line may carry a [link](/where) to fix it: the row opens it.
              // ONLY A PATH ON THIS SERVER becomes the row's href -- the names in
              // a line come from integrations (setup_check escapes them), and a
              // javascript: or off-site link must never be one click away.
              var text = String(l.detail || '').replace(/(?<!\\)[*`]/g, ''), link = null;
              text = text.replace(/(?<!\\)\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, words, url) {
                if (!link && /^\/(?!\/)/.test(url)) link = url;
                return words;
              }).replace(/\\([\\`*_\[\]()<>])/g, '$1');
              if (link) return K.nav({ tile: ic(l.ok), label: l.title, sub: text, href: link });
              return K.info({ tile: ic(l.ok), label: l.title, sub: text });
            })));
          });
          c.appendChild(K.group({}, [K.button({ label: 'Check Again', fk: 'check:again', onClick: function () { self._check = null; self.render(); } })]));
        } };
      }
      // THE SETUP ASSISTANT'S FEATURES STEP: the optional features, each as
      // this house has it -- added (its page) or not (Add, through HK Frontend's
      // Add feature).
      // THE SETUP ASSISTANT'S ALARM (General's, until 2026-10-16; the
      // Security page's under Pages now)
      setupAlarm(c) {
        var self = this, set = function (v) { self.setH({ 'security.alarm': v }); };
        var sugg = !this.hs('security.alarm') && (this.data.suggest || {}).alarm;
        c.appendChild(K.group({ footer: 'The header’s security line, the Security chip and page, and the alarm keypad. Later: Pages → Security.' }, [
          this.entityRow({ label: 'Alarm Panel', sk: 'security.alarm', value: this.hs('security.alarm'), none: 'No Alarm',
                           filter: { domains: ['alarm_control_panel'] }, onPick: set }),
          sugg ? K.button({ label: 'Use ' + this.name(sugg), fk: 'alarm:suggest', onClick: function () { set(sugg); } }) : null]));
      }
      setupFeatures(c) {
        var feats = this.data.features || {}, rows = [], missing = [];
        F.LIST.forEach(function (x) {
          var st = F.stateOf(feats, x[1]), name = (feats[x[1]] || {}).name || x[2];
          if (st === 'added' || x[0] === 'music') {
            rows.push(K.nav({ tile: [x[3], x[4]], label: x[2], sub: F.SCOPE[x[1]],
                              href: '#/features/' + x[0], fk: 'setup:feat:' + x[0] }));
          }
          if (st === 'not_added') {
            rows.push(K.nav({ tile: [x[3], x[4]], label: 'Add ' + name, sub: F.SCOPE[x[1]], href: F.addHref(x[1]),
                              fk: 'setup:add:' + x[1] }));
          }
          if (st === 'missing') missing.push(name);
        });
        c.appendChild(K.group({ footer: 'Each is optional, added from ' + haName('HK Frontend’s Add feature') + '. Its settings are on its page under Pages (Notifications: All Screens).' +
            (missing.length ? ' Not available here: ' + missing.join(', ') + '.' : '') }, rows));
      }
      p_setup(step) {
        var self = this;
        var STEPS = SETUP_STEPS;
        step = Math.max(0, Math.min(STEPS.length - 1, step || 0));
        var next = function () { self.go('#/setup/' + (step + 1)); };
        return { title: step ? STEPS[step] : 'Set Up ' + PN(), backLabel: 'Setup',
          back: step ? [STEPS[step - 1], '#/setup/' + (step - 1)] : [this.title(), '#/'],
          scope: step && step < STEPS.length - 1 ? 'Step ' + step + ' of ' + (STEPS.length - 2) + '. Everything here can be changed later.' : null,
          body: function (c) {
            if (step === 0) {
              c.appendChild(h('div', { class: 'big' }, [h('span', { class: 'tile', style: 'background:' + C.orange }, K.icon('mdi:home-heart', '')),
                h('p',
                  {
                  text:
                  'A few questions about your home — its alarm, its weather, how the glass should look — then a first screen, built from your rooms and devices. Everything else is found by itself.' })
                  ]));
              c.appendChild(K.group({}, [K.button({ label: 'Get Started', center: true, fk: 'setup:go', onClick: next })]));
              return;
            }
            if (step === 1) self.setupAlarm(c);
            if (step === 2) self.h_weather(c);
            if (step === 3) self.h_appearance(c);
            if (step === 4) self.setupFeatures(c);
            if (step === SETUP_FIRST) {
              self.addScreenBody(c, null, function (path) { self._created = path; next(); });
              c.appendChild(K.group({}, [K.button({ label: 'Skip', center: true, fk: 'setup:skip', onClick: next })]));
              return;
            }
            if (step === SETUP_STEPS.length - 1) {
              c.appendChild(h('div', { class: 'big' }, [h('span', { class: 'tile', style: 'background:' + C.green }, K.icon('mdi:check', '')),
                h('p', { text: 'Your settings are saved. Everything can be changed later, from the list.' })]));
              if (self._created) {
                var a = K.nav({ label: 'Open ' + self._created, href: '/' + self._created + '/0', icon: 'mdi:open-in-new' });
                c.appendChild(K.group({}, [a]));
              }
              c.appendChild(K.group({}, [K.button({ label: 'Done', center: true, fk: 'setup:done', onClick: function () {
                self.go(self.hasAttribute('wide') ? '#/overview' : '#/');
              } })]));
              if (!self._setupMarked) {
                self._setupMarked = true;
                self.actions().callWS({ type: DOMAIN + '/setup/done', done: true }).catch(function () {});
              }
              return;
            }
            c.appendChild(K.group({}, [K.button({ label: 'Continue', center: true, fk: 'setup:next', onClick: next })]));
          } };
      }
    };
    KIT.install(Methods);
  };
})();
